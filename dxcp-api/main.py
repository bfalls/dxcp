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
from fastapi.exceptions import HTTPException as FastAPIHTTPException

from auth import get_actor
from config import SETTINGS
from idempotency import IdempotencyStore
from models import (
    Actor,
    BuildRegisterExistingRequest,
    BuildRegistration,
    BuildUploadCapability,
    BuildUploadRequest,
    DeliveryGroup,
    DeploymentIntent,
    Recipe,
    Role,
    TimelineEvent,
)
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

@app.exception_handler(FastAPIHTTPException)
async def http_exception_handler(request: Request, exc: FastAPIHTTPException):
    if isinstance(exc.detail, dict) and "code" in exc.detail:
        return JSONResponse(status_code=exc.status_code, content=exc.detail)
    return JSONResponse(status_code=exc.status_code, content={"code": "HTTP_ERROR", "message": str(exc.detail)})


def require_role(actor: Actor, allowed: set[Role], action: str):
    if actor.role in allowed:
        return None
    return error_response(403, "ROLE_FORBIDDEN", f"Role {actor.role.value} cannot {action}")


def can_deploy(actor: Actor) -> bool:
    return actor.role in {Role.DELIVERY_OWNER, Role.PLATFORM_ADMIN}


def can_rollback(actor: Actor) -> bool:
    return actor.role in {Role.DELIVERY_OWNER, Role.PLATFORM_ADMIN}


def can_view(actor: Actor) -> bool:
    return actor.role in {Role.OBSERVER, Role.DELIVERY_OWNER, Role.PLATFORM_ADMIN}


def resolve_delivery_group(service: str):
    group = storage.get_delivery_group_for_service(service)
    if not group:
        return None, error_response(
            403,
            "SERVICE_NOT_IN_DELIVERY_GROUP",
            f"Service {service} is not assigned to a delivery group",
        )
    return group, None


def resolve_recipe(recipe_id: Optional[str], group: dict):
    if not recipe_id:
        return None, error_response(400, "RECIPE_ID_REQUIRED", "recipeId is required")
    resolved_id = recipe_id
    recipe = storage.get_recipe(resolved_id)
    if not recipe:
        return None, error_response(404, "RECIPE_NOT_FOUND", f"Recipe {resolved_id} not found")
    allowed = group.get("allowed_recipes", [])
    if resolved_id not in allowed:
        return None, error_response(
            403,
            "RECIPE_NOT_ALLOWED",
            f"Recipe {resolved_id} not allowed for delivery group {group.get('id')}",
        )
    return recipe, None


def _group_guardrail_value(group: dict, key: str, default_value: int) -> int:
    guardrails = group.get("guardrails") or {}
    value = guardrails.get(key)
    if isinstance(value, int) and value > 0:
        return value
    return default_value


def _apply_recipe_mapping(payload: dict, recipe: dict) -> None:
    if recipe.get("spinnaker_application"):
        payload["spinnakerApplication"] = recipe.get("spinnaker_application")
    if recipe.get("deploy_pipeline"):
        payload["spinnakerPipeline"] = recipe.get("deploy_pipeline")


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


def _timeline_event(key: str, label: str, occurred_at: str, detail: Optional[str] = None) -> dict:
    return TimelineEvent(key=key, label=label, occurredAt=occurred_at, detail=detail).dict()


def derive_timeline(deployment: dict) -> list:
    created_at = deployment.get("createdAt") or utc_now()
    updated_at = deployment.get("updatedAt") or created_at
    state = deployment.get("state")
    events = [
        _timeline_event("submitted", "Submitted", created_at, "Deployment intent received."),
        _timeline_event("validated", "Validated", created_at, "Guardrails and inputs validated."),
    ]
    if deployment.get("rollbackOf"):
        events.append(_timeline_event("rollback_started", "Rollback started", created_at, "Rollback requested."))
        if state == "SUCCEEDED":
            events.append(_timeline_event("rollback_succeeded", "Rollback succeeded", updated_at, "Rollback completed."))
        elif state == "FAILED":
            events.append(_timeline_event("rollback_failed", "Rollback failed", updated_at, "Rollback failed."))
        elif state in ["ACTIVE", "IN_PROGRESS"]:
            events.append(_timeline_event("in_progress", "In progress", updated_at, "Rollback executing."))
        return events

    if state in ["ACTIVE", "IN_PROGRESS", "SUCCEEDED", "FAILED", "CANCELED", "ROLLED_BACK"]:
        events.append(_timeline_event("in_progress", "In progress", created_at, "Deployment executing."))
    if state == "ACTIVE":
        events.append(_timeline_event("active", "Active", updated_at, "Deployment is active."))
    if state == "SUCCEEDED":
        events.append(_timeline_event("succeeded", "Succeeded", updated_at, "Deployment completed."))
    elif state == "FAILED":
        events.append(_timeline_event("failed", "Failed", updated_at, "Deployment failed."))
    elif state == "CANCELED":
        events.append(_timeline_event("failed", "Failed", updated_at, "Deployment canceled."))
    elif state == "ROLLED_BACK":
        events.append(_timeline_event("rollback_succeeded", "Rollback succeeded", updated_at, "Rollback completed."))
    return events


def _normalize_failure_category(value: Optional[str]) -> str:
    if not value:
        return "UNKNOWN"
    category = str(value).strip().upper()
    mapping = {
        "INFRA": "INFRASTRUCTURE",
        "INFRASTRUCTURE": "INFRASTRUCTURE",
        "CONFIG": "CONFIG",
        "APP": "APP",
        "POLICY": "POLICY",
        "VALIDATION": "VALIDATION",
        "ARTIFACT": "ARTIFACT",
        "TIMEOUT": "TIMEOUT",
        "ROLLBACK": "ROLLBACK",
        "UNKNOWN": "UNKNOWN",
    }
    return mapping.get(category, "UNKNOWN")


def _parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _rollup_counts(items: list[tuple[str, int]]) -> list[dict]:
    return [
        {"key": key, "count": count}
        for key, count in sorted(items, key=lambda item: item[1], reverse=True)
    ]


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


def _ui_refresh_settings() -> dict:
    default_value = SETTINGS.ui_default_refresh_seconds or 300
    min_value = SETTINGS.ui_min_refresh_seconds or 60
    max_value = SETTINGS.ui_max_refresh_seconds or 3600
    if min_value <= 0:
        min_value = 60
    if max_value < min_value:
        max_value = min_value
    if default_value < min_value:
        default_value = min_value
    if default_value > max_value:
        default_value = max_value
    return {
        "default_refresh_interval_seconds": int(default_value),
        "min_refresh_interval_seconds": int(min_value),
        "max_refresh_interval_seconds": int(max_value),
    }


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
    actor = get_actor(authorization)
    role_error = require_role(actor, {Role.DELIVERY_OWNER, Role.PLATFORM_ADMIN}, "deploy")
    if role_error:
        return role_error
    guardrails.require_mutations_enabled()
    guardrails.require_idempotency_key(idempotency_key)
    service_entry = guardrails.validate_service(intent.service)
    guardrails.validate_environment(intent.environment, service_entry)
    guardrails.validate_version(intent.version)
    group, group_error = resolve_delivery_group(intent.service)
    if group_error:
        return group_error
    recipe, recipe_error = resolve_recipe(intent.recipeId, group)
    if recipe_error:
        return recipe_error
    max_concurrent = _group_guardrail_value(group, "max_concurrent_deployments", 1)
    daily_deploy_quota = _group_guardrail_value(group, "daily_deploy_quota", SETTINGS.daily_quota_deploy)
    rate_limiter.check_mutate(actor.actor_id, "deploy", quota_scope=group["id"], quota_limit=daily_deploy_quota)
    cached = enforce_idempotency(request, idempotency_key)
    if cached:
        return cached
    guardrails.enforce_delivery_group_lock(group["id"], max_concurrent)

    payload = intent.dict()
    payload.pop("spinnakerApplication", None)
    payload.pop("spinnakerPipeline", None)
    payload.pop("recipeId", None)
    _apply_recipe_mapping(payload, recipe)
    if spinnaker.mode == "http":
        if not payload.get("spinnakerApplication") and not SETTINGS.spinnaker_application:
            return error_response(400, "INVALID_REQUEST", "spinnakerApplication is required for deploy")
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
        "recipeId": recipe.get("id"),
        "state": "IN_PROGRESS",
        "changeSummary": intent.changeSummary,
        "createdAt": utc_now(),
        "updatedAt": utc_now(),
        "spinnakerExecutionId": execution["executionId"],
        "spinnakerExecutionUrl": execution["executionUrl"],
        "spinnakerApplication": payload.get("spinnakerApplication"),
        "spinnakerPipeline": payload.get("spinnakerPipeline"),
        "deliveryGroupId": group["id"],
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
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    deployments = storage.list_deployments(service, state)
    return deployments


@app.get("/v1/services")
def list_services(request: Request, authorization: Optional[str] = Header(None)):
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    return storage.list_services()


@app.get("/v1/delivery-groups")
def list_delivery_groups(request: Request, authorization: Optional[str] = Header(None)):
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    groups = storage.list_delivery_groups()
    return [DeliveryGroup(**group).dict() for group in groups]


@app.get("/v1/delivery-groups/{group_id}")
def get_delivery_group(
    group_id: str,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    group = storage.get_delivery_group(group_id)
    if not group:
        return error_response(404, "NOT_FOUND", "Delivery group not found")
    return DeliveryGroup(**group).dict()


@app.get("/v1/recipes")
def list_recipes(request: Request, authorization: Optional[str] = Header(None)):
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    recipes = storage.list_recipes()
    return [Recipe(**recipe).dict() for recipe in recipes]


@app.get("/v1/recipes/{recipe_id}")
def get_recipe(recipe_id: str, request: Request, authorization: Optional[str] = Header(None)):
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    recipe = storage.get_recipe(recipe_id)
    if not recipe:
        return error_response(404, "NOT_FOUND", "Recipe not found")
    return Recipe(**recipe).dict()


@app.get("/v1/services/{service}/versions")
def list_service_versions(
    service: str,
    request: Request,
    refresh: Optional[bool] = Query(False),
    authorization: Optional[str] = Header(None),
):
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
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


@app.get("/v1/services/{service}/delivery-status")
def get_service_delivery_status(
    service: str,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    guardrails.validate_service(service)
    deployments = storage.list_deployments(service, None)
    if not deployments:
        return {
            "service": service,
            "hasDeployments": False,
            "latest": None,
        }
    latest = deployments[0]
    return {
        "service": service,
        "hasDeployments": True,
        "latest": {
            "id": latest.get("id"),
            "state": latest.get("state"),
            "version": latest.get("version"),
            "recipeId": latest.get("recipeId"),
            "createdAt": latest.get("createdAt"),
            "updatedAt": latest.get("updatedAt"),
            "spinnakerExecutionUrl": latest.get("spinnakerExecutionUrl"),
            "rollbackOf": latest.get("rollbackOf"),
        },
    }


@app.get("/v1/services/{service}/allowed-actions")
def get_service_allowed_actions(
    service: str,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    guardrails.validate_service(service)
    return {
        "service": service,
        "actions": {
            "view": can_view(actor),
            "deploy": can_deploy(actor),
            "rollback": can_rollback(actor),
        },
        "role": actor.role.value,
    }


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
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
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
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    deployment = storage.get_deployment(deployment_id)
    if not deployment:
        return error_response(404, "NOT_FOUND", "Deployment not found")
    deployment = refresh_from_spinnaker(deployment)
    return deployment.get("failures", [])


@app.get("/v1/deployments/{deployment_id}/timeline")
def get_deployment_timeline(
    deployment_id: str,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    deployment = storage.get_deployment(deployment_id)
    if not deployment:
        return error_response(404, "NOT_FOUND", "Deployment not found")
    deployment = refresh_from_spinnaker(deployment)
    return derive_timeline(deployment)


@app.get("/v1/settings/public")
def get_public_settings(request: Request, authorization: Optional[str] = Header(None)):
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    return _ui_refresh_settings()


@app.get("/v1/settings/admin")
def get_admin_settings(request: Request, authorization: Optional[str] = Header(None)):
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "view admin settings")
    if role_error:
        return role_error
    return _ui_refresh_settings()


@app.get("/v1/insights/failures")
def get_failure_insights(
    request: Request,
    windowDays: Optional[int] = Query(7),
    groupId: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    if windowDays is None or windowDays < 1 or windowDays > 30:
        return error_response(400, "INVALID_REQUEST", "windowDays must be between 1 and 30")
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=windowDays)
    deployments = storage.list_deployments(None, None)
    filtered = []
    for deployment in deployments:
        if groupId and deployment.get("deliveryGroupId") != groupId:
            continue
        created_at = _parse_iso(deployment.get("createdAt"))
        if not created_at:
            continue
        if not (start <= created_at <= end):
            continue
        filtered.append(deployment)

    failures_by_category = {}
    by_recipe = {}
    by_group = {}
    rollbacks = 0
    primary = 0
    for deployment in filtered:
        recipe_id = deployment.get("recipeId") or "unknown"
        by_recipe[recipe_id] = by_recipe.get(recipe_id, 0) + 1
        group_id = deployment.get("deliveryGroupId") or "unknown"
        by_group[group_id] = by_group.get(group_id, 0) + 1
        if deployment.get("rollbackOf"):
            rollbacks += 1
        else:
            primary += 1
        for failure in deployment.get("failures", []):
            category = _normalize_failure_category(failure.get("category"))
            failures_by_category[category] = failures_by_category.get(category, 0) + 1

    rollback_rate = round((rollbacks / primary) if primary else 0.0, 4)
    return {
        "windowDays": windowDays,
        "windowStart": start.isoformat().replace("+00:00", "Z"),
        "windowEnd": end.isoformat().replace("+00:00", "Z"),
        "totalDeployments": primary,
        "totalRollbacks": rollbacks,
        "rollbackRate": rollback_rate,
        "failuresByCategory": _rollup_counts(list(failures_by_category.items())),
        "deploymentsByRecipe": _rollup_counts(list(by_recipe.items())),
        "deploymentsByGroup": _rollup_counts(list(by_group.items())),
    }


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
    actor = get_actor(authorization)
    role_error = require_role(actor, {Role.DELIVERY_OWNER, Role.PLATFORM_ADMIN}, "rollback")
    if role_error:
        return role_error
    guardrails.require_mutations_enabled()
    guardrails.require_idempotency_key(idempotency_key)
    deployment = storage.get_deployment(deployment_id)
    if not deployment:
        return error_response(404, "NOT_FOUND", "Deployment not found")

    service_entry = guardrails.validate_service(deployment["service"])
    guardrails.validate_environment(deployment["environment"], service_entry)
    group, group_error = resolve_delivery_group(deployment["service"])
    if group_error:
        return group_error
    max_concurrent = _group_guardrail_value(group, "max_concurrent_deployments", 1)
    daily_rollback_quota = _group_guardrail_value(group, "daily_rollback_quota", SETTINGS.daily_quota_rollback)
    rate_limiter.check_mutate(actor.actor_id, "rollback", quota_scope=group["id"], quota_limit=daily_rollback_quota)
    cached = enforce_idempotency(request, idempotency_key)
    if cached:
        return cached
    guardrails.enforce_delivery_group_lock(group["id"], max_concurrent)

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
    recipe = storage.get_recipe(deployment.get("recipeId") or "default")
    if recipe:
        if recipe.get("spinnaker_application"):
            payload["spinnakerApplication"] = recipe.get("spinnaker_application")
        if recipe.get("rollback_pipeline"):
            payload["spinnakerPipeline"] = recipe.get("rollback_pipeline")
    if not payload.get("spinnakerApplication") and not SETTINGS.spinnaker_application:
        return error_response(
            400,
            "MISSING_SPINNAKER_TARGET",
            "Deployment is missing spinnakerApplication; redeploy with a recipe configured",
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
        "recipeId": deployment.get("recipeId") or "default",
        "state": "IN_PROGRESS",
        "changeSummary": f"rollback of {deployment_id} to {prior['version']}",
        "rollbackOf": deployment_id,
        "createdAt": utc_now(),
        "updatedAt": utc_now(),
        "spinnakerExecutionId": execution["executionId"],
        "spinnakerExecutionUrl": execution["executionUrl"],
        "deliveryGroupId": group["id"],
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
    actor = get_actor(authorization)
    role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "register builds")
    if role_error:
        return role_error
    guardrails.require_mutations_enabled()
    guardrails.require_idempotency_key(idempotency_key)
    rate_limiter.check_mutate(actor.actor_id, "upload_capability")
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
    actor = get_actor(authorization)
    role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "register builds")
    if role_error:
        return role_error
    guardrails.require_mutations_enabled()
    guardrails.require_idempotency_key(idempotency_key)
    rate_limiter.check_mutate(actor.actor_id, "build_register")
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
    actor = get_actor(request, authorization)
    role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "register builds")
    if role_error:
        return role_error
    guardrails.require_mutations_enabled()
    guardrails.require_idempotency_key(idempotency_key)
    rate_limiter.check_mutate(actor.actor_id, "build_register")
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
