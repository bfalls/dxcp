import logging
import os
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import SETTINGS
from idempotency import IdempotencyStore
from models import BuildRegistration, BuildUploadCapability, BuildUploadRequest, DeploymentIntent
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
    header_name=SETTINGS.spinnaker_header_name,
    header_value=SETTINGS.spinnaker_header_value,
)
logger = logging.getLogger("dxcp.api")
guardrails = Guardrails(storage)

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
    return token or request.client.host or "anonymous"


def enforce_idempotency(request: Request, idempotency_key: str):
    key = f"{idempotency_key}:{request.method}:{request.url.path}"
    cached = idempotency.get(key)
    if cached:
        return JSONResponse(status_code=cached["status_code"], content=cached["response"])
    return None


def store_idempotency(request: Request, idempotency_key: str, response: dict, status_code: int) -> None:
    key = f"{idempotency_key}:{request.method}:{request.url.path}"
    idempotency.set(key, response, status_code)


def refresh_from_spinnaker(deployment: dict) -> dict:
    execution = spinnaker.get_execution(deployment["spinnakerExecutionId"])
    state = execution.get("state")
    if state in ["PENDING", "ACTIVE", "IN_PROGRESS", "SUCCEEDED", "FAILED", "CANCELED", "ROLLED_BACK"]:
        failures = normalize_failures(execution.get("failures"))
        storage.update_deployment(deployment["id"], state, failures)
        deployment = storage.get_deployment(deployment["id"]) or deployment
    return deployment


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
        build = storage.find_latest_build(intent.service, intent.version)
        if not build:
            return error_response(400, "MISSING_BUILD", "No build registered for this service and version")
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

    try:
        execution = spinnaker.trigger_rollback(deployment, idempotency_key)
    except Exception as exc:
        message = f"Spinnaker trigger failed: {exc}"
        return error_response(502, "SPINNAKER_TRIGGER_FAILED", message[:240])
    record = {
        "id": str(uuid.uuid4()),
        "service": deployment["service"],
        "environment": deployment["environment"],
        "version": deployment["version"],
        "state": "ACTIVE",
        "changeSummary": f"rollback of {deployment_id}",
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
