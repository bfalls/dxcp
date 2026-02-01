import hashlib
import logging
import os
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import SETTINGS
from idempotency import IdempotencyStore
from models import BuildRegisterExistingRequest, BuildRegistration, BuildUploadCapability, BuildUploadRequest, DeploymentIntent
from policy import Guardrails, PolicyError
from rate_limit import RateLimiter
from storage import build_storage, utc_now


HERE = os.path.abspath(os.path.dirname(__file__))
SPINNAKER_CANDIDATES = [
    os.path.join(HERE, "spinnaker-adapter"),
    os.path.join(os.path.dirname(HERE), "spinnaker-adapter"),
]
for candidate in SPINNAKER_CANDIDATES:
    if os.path.isdir(candidate) and candidate not in sys.path:
        sys.path.append(candidate)
        break

from artifacts import build_artifact_source, semver_sort_key
from spinnaker_adapter.adapter import SpinnakerAdapter, normalize_failures


app = FastAPI(title="DXCP API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=SETTINGS.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
storage = build_storage()
print(f"DXCP:     service registry loaded: {len(storage.list_services())} services")
rate_limiter = RateLimiter()
idempotency = IdempotencyStore()
spinnaker = SpinnakerAdapter(
    SETTINGS.spinnaker_base_url,
    SETTINGS.spinnaker_mode,
    SETTINGS.engine_lambda_url,
    SETTINGS.engine_lambda_token,
    application=SETTINGS.spinnaker_application,
    header_name=SETTINGS.spinnaker_header_name,
    header_value=SETTINGS.spinnaker_header_value,
)
logger = logging.getLogger("dxcp.api")
guardrails = Guardrails(storage)
artifact_source = None

logger.info(
    "config.engine loaded engine_url=%s engine_token=%s",
    "set" if SETTINGS.engine_lambda_url else "missing",
    "set" if SETTINGS.engine_lambda_token else "missing",
)

if os.getenv("DXCP_LAMBDA", "") == "1":
    try:
        from mangum import Mangum

        handler = Mangum(app)
    except Exception:
        handler = None


def error_response(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"code": code, "message": message})


@app.exception_handler(PolicyError)
async def policy_error_handler(request: Request, exc: PolicyError):
    return error_response(exc.status_code, exc.code, exc.message)


def get_client_id(request: Request, authorization: Optional[str]) -> str:
    token = ""
    if authorization:
        parts = authorization.split(" ")
        if len(parts) == 2 and parts[0].lower() == "bearer":
            token = parts[1]
    if SETTINGS.api_token:
        if token != SETTINGS.api_token:
            raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED", "message": "Unauthorized"})
    client_host = request.client.host if request.client else None
    return token or client_host or "anonymous"


def enforce_idempotency(request: Request, idempotency_key: str):
    key = f"{idempotency_key}:{request.method}:{request.url.path}"
    cached = idempotency.get(key)
    if cached:
        return JSONResponse(status_code=cached["status_code"], content=cached["response"])
    return None


def store_idempotency(request: Request, idempotency_key: str, response: dict, status_code: int) -> None:
    key = f"{idempotency_key}:{request.method}:{request.url.path}"
    idempotency.set(key, response, status_code)


def _get_artifact_source():
    global artifact_source
    if artifact_source is None:
        artifact_source = build_artifact_source(SETTINGS.runtime_artifact_bucket)
    return artifact_source


def _versions_from_cache(builds: list) -> list:
    latest = {}
    for build in builds:
        version = build.get("version")
        if not version or version in latest:
            continue
        latest[version] = {
            "version": version,
            "artifactRef": build.get("artifactRef"),
            "sizeBytes": build.get("sizeBytes"),
            "lastModified": build.get("registeredAt"),
        }
    versions = list(latest.values())
    versions.sort(key=lambda item: semver_sort_key(item.get("version", "")), reverse=True)
    return versions


def refresh_from_spinnaker(deployment: dict) -> dict:
    execution = spinnaker.get_execution(deployment["spinnakerExecutionId"])
    state = execution.get("state")
    if state in ["PENDING", "ACTIVE", "IN_PROGRESS", "SUCCEEDED", "FAILED", "CANCELED", "ROLLED_BACK"]:
        failures = normalize_failures(execution.get("failures"))
        storage.update_deployment(deployment["id"], state, failures)
        deployment = storage.get_deployment(deployment["id"]) or deployment
        if deployment.get("rollbackOf") and state == "SUCCEEDED":
            original = storage.get_deployment(deployment["rollbackOf"])
            if original and original.get("state") != "ROLLED_BACK":
                storage.update_deployment(original["id"], "ROLLED_BACK", original.get("failures", []))
    return deployment


def _parse_s3_ref(artifact_ref: str) -> tuple[str, str]:
    if not artifact_ref.startswith("s3://"):
        raise ValueError("artifactRef must start with s3://")
    without_scheme = artifact_ref[len("s3://") :]
    if "/" not in without_scheme:
        raise ValueError("artifactRef must include bucket and key")
    bucket, key = without_scheme.split("/", 1)
    if not bucket or not key:
        raise ValueError("artifactRef must include bucket and key")
    return bucket, key


def _compute_sha256(client, bucket: str, key: str) -> tuple[str, int, float]:
    start = time.monotonic()
    response = client.get_object(Bucket=bucket, Key=key)
    body = response["Body"]
    hasher = hashlib.sha256()
    total = 0
    for chunk in iter(lambda: body.read(1024 * 1024), b""):
        hasher.update(chunk)
        total += len(chunk)
    duration = time.monotonic() - start
    return hasher.hexdigest(), total, duration


def _register_existing_build_internal(service_entry: dict, service: str, version: str, artifact_ref: Optional[str], s3_bucket: Optional[str], s3_key: Optional[str]) -> dict:
    if not SETTINGS.runtime_artifact_bucket:
        raise ValueError("Runtime artifact bucket is not configured")

    if artifact_ref:
        bucket, key = _parse_s3_ref(artifact_ref)
    else:
        if not s3_key:
            raise ValueError("s3Key is required when artifactRef is omitted")
        bucket = s3_bucket or SETTINGS.runtime_artifact_bucket
        key = s3_key

    if bucket != SETTINGS.runtime_artifact_bucket:
        raise ValueError("Artifact source not allowlisted")

    if not key.endswith(".zip"):
        raise ValueError("Artifact must be a .zip for Lambda deployments")

    try:
        import boto3
        from botocore.exceptions import ClientError
    except Exception as exc:
        raise RuntimeError("boto3 is required to validate artifacts") from exc

    client = boto3.client("s3")
    try:
        head = client.head_object(Bucket=bucket, Key=key)
    except ClientError as exc:
        logger.warning("artifact.head failed bucket=%s key=%s error=%s", bucket, key, exc)
        raise ValueError("Artifact does not exist") from exc

    size_bytes = int(head.get("ContentLength", 0))
    content_type = head.get("ContentType") or "application/zip"
    logger.info(
        "artifact.head bucket=%s key=%s size_bytes=%s etag=%s content_type=%s",
        bucket,
        key,
        size_bytes,
        head.get("ETag"),
        content_type,
    )

    try:
        sha256, bytes_hashed, duration = _compute_sha256(client, bucket, key)
    except Exception as exc:
        logger.warning("artifact.hash failed bucket=%s key=%s error=%s", bucket, key, exc)
        raise RuntimeError("Failed to compute artifact checksum") from exc

    logger.info(
        "artifact.hash bucket=%s key=%s bytes=%s duration_ms=%.1f",
        bucket,
        key,
        bytes_hashed,
        duration * 1000,
    )

    guardrails.validate_artifact(size_bytes, sha256, content_type)
    guardrails.validate_artifact_source(f"s3://{bucket}/{key}", service_entry)

    record = {
        "service": service,
        "version": version,
        "artifactRef": f"s3://{bucket}/{key}",
        "sha256": sha256,
        "sizeBytes": size_bytes,
        "contentType": content_type,
        "registeredAt": utc_now(),
    }
    record = storage.insert_build(record)
    logger.info(
        "artifact.registered build_id=%s service=%s version=%s",
        record.get("id"),
        service,
        version,
    )
    return record


def _extract_tags(app: dict) -> list:
    tags = app.get("tags")
    if tags is None:
        tags = app.get("attributes", {}).get("tags")
    if tags is None:
        tags = app.get("attributes", {}).get("applicationAttributes", {}).get("tags")
    if tags is None:
        tags = app.get("defaultFilteredTags")
    if tags is None:
        tags = app.get("attributes", {}).get("defaultFilteredTags")
    if tags is None:
        return []
    if isinstance(tags, dict):
        return [{"name": key, "value": value} for key, value in tags.items()]
    if isinstance(tags, list):
        return tags
    return []


def _matches_tag(app: dict, tag_name: Optional[str], tag_value: Optional[str]) -> bool:
    if not tag_name:
        return True
    for tag in _extract_tags(app):
        if not isinstance(tag, dict):
            continue
        name = tag.get("name") or tag.get("key") or tag.get("label") or tag.get("tagName")
        value = tag.get("value") or tag.get("val") or tag.get("tagValue")
        if name == tag_name:
            if tag_value is None or tag_value == "":
                return True
            if value == tag_value:
                return True
    return False


@app.post("/v1/deployments", status_code=201)
def create_deployment(
    intent: DeploymentIntent,
    request: Request,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    authorization: Optional[str] = Header(None),
):
    guardrails.require_mutations_enabled()
    guardrails.require_idempotency_key(idempotency_key)
    client_id = get_client_id(request, authorization)
    rate_limiter.check_mutate(client_id, "deploy")
    cached = enforce_idempotency(request, idempotency_key)
    if cached:
        return cached
    if storage.has_active_deployment():
        return error_response(409, "DEPLOYMENT_IN_PROGRESS", "Another deployment is already in progress")

    service_entry = guardrails.validate_service(intent.service)
    guardrails.validate_environment(intent.environment, service_entry)
    guardrails.validate_version(intent.version)
    guardrails.enforce_global_lock()

    payload = intent.dict()
    if spinnaker.mode == "http":
        if not payload.get("spinnakerApplication") or not payload.get("spinnakerPipeline"):
            return error_response(
                400,
                "INVALID_REQUEST",
                "spinnakerApplication and spinnakerPipeline are required for deploy",
            )
        build = storage.find_latest_build(intent.service, intent.version)
        if not build:
            auto_key = f"{intent.service}/{intent.service}-{intent.version}.zip"
            try:
                build = _register_existing_build_internal(
                    service_entry,
                    intent.service,
                    intent.version,
                    None,
                    None,
                    auto_key,
                )
            except ValueError as exc:
                return error_response(400, "MISSING_BUILD", f"No build registered; expected s3://{SETTINGS.runtime_artifact_bucket}/{auto_key} ({exc})")
            except RuntimeError as exc:
                return error_response(500, "INTERNAL_ERROR", str(exc))
        payload["artifactRef"] = build["artifactRef"]

    try:
        execution = spinnaker.trigger_deploy(payload, idempotency_key)
    except Exception as exc:
        message = f"Spinnaker trigger failed: {exc}"
        return error_response(502, "SPINNAKER_TRIGGER_FAILED", message[:240])
    record = {
        "id": str(uuid.uuid4()),
        "service": intent.service,
        "environment": intent.environment,
        "version": intent.version,
        "state": "IN_PROGRESS",
        "changeSummary": intent.changeSummary,
        "createdAt": utc_now(),
        "updatedAt": utc_now(),
        "spinnakerExecutionId": execution["executionId"],
        "spinnakerExecutionUrl": execution["executionUrl"],
        "spinnakerApplication": payload.get("spinnakerApplication"),
        "spinnakerPipeline": payload.get("spinnakerPipeline"),
        "failures": [],
    }
    storage.insert_deployment(record, [])
    logger.info(
        "deployment.created deployment_id=%s spinnaker_execution_id=%s service=%s version=%s idempotency_key=%s",
        record["id"],
        record["spinnakerExecutionId"],
        record["service"],
        record["version"],
        idempotency_key,
    )
    store_idempotency(request, idempotency_key, record, 201)
    return record


@app.get("/v1/deployments")
def list_deployments(
    request: Request,
    service: Optional[str] = None,
    state: Optional[str] = None,
    authorization: Optional[str] = Header(None),
):
    client_id = get_client_id(request, authorization)
    rate_limiter.check_read(client_id)
    deployments = storage.list_deployments(service, state)
    return deployments


@app.get("/v1/services")
def list_services(request: Request, authorization: Optional[str] = Header(None)):
    client_id = get_client_id(request, authorization)
    rate_limiter.check_read(client_id)
    return storage.list_services()


@app.get("/v1/services/{service}/versions")
def list_service_versions(
    service: str,
    request: Request,
    refresh: Optional[bool] = Query(False),
    authorization: Optional[str] = Header(None),
):
    client_id = get_client_id(request, authorization)
    rate_limiter.check_read(client_id)
    guardrails.validate_service(service)
    versions = []
    source = "cache"
    if not refresh:
        builds = storage.list_builds_for_service(service)
        if builds:
            versions = _versions_from_cache(builds)
    if refresh or not versions:
        source = "s3"
        try:
            versions = [item.to_dict() for item in _get_artifact_source().list_versions(service)]
        except Exception as exc:
            return error_response(502, "ARTIFACT_DISCOVERY_FAILED", str(exc)[:240])
    return {"service": service, "source": source, "versions": versions, "refreshedAt": utc_now()}


@app.get("/v1/health")
def health():
    return {"status": "ok"}


@app.get("/v1/spinnaker/status")
def spinnaker_status():
    if spinnaker.mode != "http":
        return {"status": "DOWN", "error": f"Spinnaker mode is {spinnaker.mode}"}
    try:
        spinnaker.check_health()
        return {"status": "UP"}
    except Exception as exc:
        message = str(exc)
        logger.warning("Spinnaker health check failed: %s", message)
        return {"status": "DOWN", "error": message[:240]}


@app.get("/v1/deployments/{deployment_id}")
def get_deployment(
    deployment_id: str,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    client_id = get_client_id(request, authorization)
    rate_limiter.check_read(client_id)
    deployment = storage.get_deployment(deployment_id)
    if not deployment:
        return error_response(404, "NOT_FOUND", "Deployment not found")
    deployment = refresh_from_spinnaker(deployment)
    return deployment


@app.get("/v1/deployments/{deployment_id}/failures")
def get_deployment_failures(
    deployment_id: str,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    client_id = get_client_id(request, authorization)
    rate_limiter.check_read(client_id)
    deployment = storage.get_deployment(deployment_id)
    if not deployment:
        return error_response(404, "NOT_FOUND", "Deployment not found")
    deployment = refresh_from_spinnaker(deployment)
    return deployment.get("failures", [])


@app.get("/v1/spinnaker/applications")
def list_spinnaker_applications(tagName: Optional[str] = Query(None), tagValue: Optional[str] = Query(None)):
    if spinnaker.mode != "http":
        return {"status": "DOWN", "error": f"Spinnaker mode is {spinnaker.mode}"}
    try:
        apps = spinnaker.list_applications()
    except Exception as exc:
        return {"status": "DOWN", "error": str(exc)[:240]}
    if tagName:
        apps = [app for app in apps if isinstance(app, dict) and _matches_tag(app, tagName, tagValue)]
    return {
        "applications": [
            {"name": app.get("name")}
            for app in apps
            if isinstance(app, dict) and app.get("name")
        ]
    }


@app.get("/v1/spinnaker/applications/{application}/pipelines")
def list_spinnaker_pipelines(application: str):
    if spinnaker.mode != "http":
        return {"status": "DOWN", "error": f"Spinnaker mode is {spinnaker.mode}"}
    try:
        pipelines = spinnaker.list_pipeline_configs(application)
    except Exception as exc:
        return {"status": "DOWN", "error": str(exc)[:240]}
    return {
        "pipelines": [
            {
                "id": pipeline.get("id"),
                "name": pipeline.get("name"),
            }
            for pipeline in pipelines
            if isinstance(pipeline, dict) and pipeline.get("name")
        ]
    }


@app.post("/v1/deployments/{deployment_id}/rollback", status_code=201)
def rollback_deployment(
    deployment_id: str,
    request: Request,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    authorization: Optional[str] = Header(None),
):
    guardrails.require_mutations_enabled()
    guardrails.require_idempotency_key(idempotency_key)
    client_id = get_client_id(request, authorization)
    rate_limiter.check_mutate(client_id, "rollback")
    cached = enforce_idempotency(request, idempotency_key)
    if cached:
        return cached

    deployment = storage.get_deployment(deployment_id)
    if not deployment:
        return error_response(404, "NOT_FOUND", "Deployment not found")

    service_entry = guardrails.validate_service(deployment["service"])
    guardrails.validate_environment(deployment["environment"], service_entry)
    guardrails.enforce_global_lock()

    prior = storage.find_prior_successful_deployment(deployment_id)
    if not prior:
        return error_response(400, "NO_PRIOR_SUCCESSFUL_VERSION", "No prior successful version to roll back to")

    payload = {
        "service": deployment["service"],
        "environment": deployment["environment"],
        "version": prior["version"],
        "targetVersion": prior["version"],
        "spinnakerApplication": deployment.get("spinnakerApplication"),
        "spinnakerPipeline": deployment.get("spinnakerPipeline"),
    }
    if not payload.get("spinnakerApplication") or not payload.get("spinnakerPipeline"):
        return error_response(
            400,
            "MISSING_SPINNAKER_TARGET",
            "Deployment is missing spinnakerApplication/spinnakerPipeline; redeploy with those fields set",
        )
    if spinnaker.mode == "http":
        build = storage.find_latest_build(deployment["service"], prior["version"])
        if build:
            payload["artifactRef"] = build["artifactRef"]

    try:
        execution = spinnaker.trigger_rollback(payload, idempotency_key)
    except Exception as exc:
        message = f"Spinnaker trigger failed: {exc}"
        return error_response(502, "SPINNAKER_TRIGGER_FAILED", message[:240])
    record = {
        "id": str(uuid.uuid4()),
        "service": deployment["service"],
        "environment": deployment["environment"],
        "version": prior["version"],
        "state": "IN_PROGRESS",
        "changeSummary": f"rollback of {deployment_id} to {prior['version']}",
        "rollbackOf": deployment_id,
        "createdAt": utc_now(),
        "updatedAt": utc_now(),
        "spinnakerExecutionId": execution["executionId"],
        "spinnakerExecutionUrl": execution["executionUrl"],
        "failures": [],
    }
    storage.insert_deployment(record, [])
    store_idempotency(request, idempotency_key, record, 201)
    return record


@app.post("/v1/builds/upload-capability", status_code=201)
def create_upload_capability(
    req: BuildUploadRequest,
    request: Request,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    authorization: Optional[str] = Header(None),
):
    guardrails.require_mutations_enabled()
    guardrails.require_idempotency_key(idempotency_key)
    client_id = get_client_id(request, authorization)
    rate_limiter.check_mutate(client_id, "upload_capability")
    cached = enforce_idempotency(request, idempotency_key)
    if cached:
        return cached

    guardrails.validate_service(req.service)
    guardrails.validate_version(req.version)
    guardrails.validate_artifact(req.expectedSizeBytes, req.expectedSha256, req.contentType)

    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat().replace("+00:00", "Z")
    token = str(uuid.uuid4())
    cap = storage.insert_upload_capability(
        req.service,
        req.version,
        req.expectedSizeBytes,
        req.expectedSha256,
        req.contentType,
        expires_at,
        token,
    )
    response = BuildUploadCapability(
        uploadType="TOKEN",
        uploadToken=cap["token"],
        expiresAt=cap["expiresAt"],
        expectedSizeBytes=cap["expectedSizeBytes"],
        expectedSha256=cap["expectedSha256"],
        expectedContentType=cap["expectedContentType"],
    ).dict()
    store_idempotency(request, idempotency_key, response, 201)
    return response


@app.post("/v1/builds", status_code=201)
def register_build(
    reg: BuildRegistration,
    request: Request,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    authorization: Optional[str] = Header(None),
):
    guardrails.require_mutations_enabled()
    guardrails.require_idempotency_key(idempotency_key)
    client_id = get_client_id(request, authorization)
    rate_limiter.check_mutate(client_id, "build_register")
    cached = enforce_idempotency(request, idempotency_key)
    if cached:
        return cached

    service_entry = guardrails.validate_service(reg.service)
    guardrails.validate_version(reg.version)
    guardrails.validate_artifact(reg.sizeBytes, reg.sha256, reg.contentType)
    guardrails.validate_artifact_source(reg.artifactRef, service_entry)

    cap = storage.find_upload_capability(
        reg.service,
        reg.version,
        reg.sizeBytes,
        reg.sha256,
        reg.contentType,
    )
    if not cap:
        return error_response(400, "INVALID_ARTIFACT", "No matching upload capability")

    if cap["expiresAt"] < utc_now():
        storage.delete_upload_capability(cap["id"])
        return error_response(400, "INVALID_ARTIFACT", "Upload capability expired")

    record = reg.dict()
    record["registeredAt"] = utc_now()
    record = storage.insert_build(record)
    storage.delete_upload_capability(cap["id"])
    store_idempotency(request, idempotency_key, record, 201)
    return record


@app.post("/v1/builds/register", status_code=201)
def register_existing_build(
    req: BuildRegisterExistingRequest,
    request: Request,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    authorization: Optional[str] = Header(None),
):
    guardrails.require_mutations_enabled()
    guardrails.require_idempotency_key(idempotency_key)
    client_id = get_client_id(request, authorization)
    rate_limiter.check_mutate(client_id, "build_register")
    cached = enforce_idempotency(request, idempotency_key)
    if cached:
        return cached

    service_entry = guardrails.validate_service(req.service)
    guardrails.validate_version(req.version)

    existing = storage.find_latest_build(req.service, req.version)
    if existing:
        store_idempotency(request, idempotency_key, existing, 200)
        return existing

    try:
        record = _register_existing_build_internal(
            service_entry,
            req.service,
            req.version,
            req.artifactRef,
            req.s3Bucket,
            req.s3Key,
        )
    except ValueError as exc:
        return error_response(400, "INVALID_ARTIFACT", str(exc))
    except RuntimeError as exc:
        return error_response(500, "INTERNAL_ERROR", str(exc))

    store_idempotency(request, idempotency_key, record, 201)
    return record
