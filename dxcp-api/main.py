import os
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from config import SETTINGS
from idempotency import IdempotencyStore
from models import BuildRegistration, BuildUploadCapability, BuildUploadRequest, DeploymentIntent
from policy import Guardrails, PolicyError
from rate_limit import RateLimiter
from storage import Storage, utc_now


REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SPINNAKER_PATH = os.path.join(REPO_ROOT, "spinnaker-adapter")
if SPINNAKER_PATH not in sys.path:
    sys.path.append(SPINNAKER_PATH)

from spinnaker_adapter.adapter import SpinnakerAdapter, normalize_failures


app = FastAPI(title="DXCP API", version="1.0.0")
storage = Storage(SETTINGS.db_path)
rate_limiter = RateLimiter()
idempotency = IdempotencyStore()
spinnaker = SpinnakerAdapter(SETTINGS.spinnaker_base_url, SETTINGS.spinnaker_mode)
guardrails = Guardrails(storage)


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
    if state in ["PENDING", "ACTIVE", "SUCCEEDED", "FAILED", "ROLLED_BACK"]:
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

    guardrails.validate_service(intent.service)
    guardrails.validate_environment(intent.environment)
    guardrails.validate_version(intent.version)
    guardrails.enforce_global_lock()

    execution = spinnaker.trigger_deploy(intent.dict(), idempotency_key)
    record = {
        "id": str(uuid.uuid4()),
        "service": intent.service,
        "environment": intent.environment,
        "version": intent.version,
        "state": "ACTIVE",
        "changeSummary": intent.changeSummary,
        "createdAt": utc_now(),
        "updatedAt": utc_now(),
        "spinnakerExecutionId": execution["executionId"],
        "spinnakerExecutionUrl": execution["executionUrl"],
        "failures": [],
    }
    storage.insert_deployment(record, [])
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

    guardrails.validate_service(deployment["service"])
    guardrails.validate_environment(deployment["environment"])
    guardrails.enforce_global_lock()

    execution = spinnaker.trigger_rollback(deployment, idempotency_key)
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

    guardrails.validate_service(reg.service)
    guardrails.validate_version(reg.version)
    guardrails.validate_artifact(reg.sizeBytes, reg.sha256, reg.contentType)

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
