import hashlib
import json
import logging
import os
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import FastAPI, Header, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import HTTPException as FastAPIHTTPException, RequestValidationError

from auth import get_actor
from config import SETTINGS
from idempotency import IdempotencyStore
from models import (
    Actor,
    AuditOutcome,
    BuildRegisterExistingRequest,
    BuildRegistration,
    BuildUploadCapability,
    BuildUploadRequest,
    DeliveryGroup,
    DeliveryGroupUpsert,
    DeploymentIntent,
    Environment,
    EngineType,
    PolicySummaryRequest,
    PromotionIntent,
    Recipe,
    RecipeUpsert,
    Role,
    TimelineEvent,
)
from policy import Guardrails, PolicyError
from rate_limit import RateLimiter
from delivery_state import base_outcome_from_state, normalize_deployment_kind, resolve_outcome
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
from artifact_ref import parse_s3_artifact_ref
from spinnaker_adapter.adapter import SpinnakerAdapter, normalize_failures
from spinnaker_adapter.redaction import redact_text

from observability import get_request_id, log_event, request_id_ctx


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
    request_id_provider=get_request_id,
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


def error_response(status_code: int, code: str, message: str, operator_hint: Optional[str] = None) -> JSONResponse:
    request_id = request_id_ctx.get() or str(uuid.uuid4())
    payload = {
        "code": code,
        "error_code": code,
        "failure_cause": classify_failure_cause(code),
        "message": message,
        "request_id": request_id,
    }
    if operator_hint:
        payload["operator_hint"] = operator_hint
    return JSONResponse(status_code=status_code, content=payload)


@app.exception_handler(PolicyError)
async def policy_error_handler(request: Request, exc: PolicyError):
    return error_response(exc.status_code, exc.code, exc.message)

@app.exception_handler(FastAPIHTTPException)
async def http_exception_handler(request: Request, exc: FastAPIHTTPException):
    if isinstance(exc.detail, dict) and "code" in exc.detail:
        payload = dict(exc.detail)
        code = payload.get("code")
        payload.setdefault("error_code", code)
        payload.setdefault("failure_cause", classify_failure_cause(code))
        payload["request_id"] = request_id_ctx.get() or str(uuid.uuid4())
        return JSONResponse(status_code=exc.status_code, content=payload)
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "code": "HTTP_ERROR",
            "error_code": "HTTP_ERROR",
            "failure_cause": classify_failure_cause("HTTP_ERROR"),
            "message": str(exc.detail),
            "request_id": request_id_ctx.get() or str(uuid.uuid4()),
        },
    )


@app.exception_handler(RequestValidationError)
async def request_validation_handler(request: Request, exc: RequestValidationError):
    for error in exc.errors():
        loc = error.get("loc") or ()
        err_type = error.get("type")
        if loc == ("body", "recipeId") and err_type in {"missing", "value_error.missing"}:
            return error_response(400, "RECIPE_ID_REQUIRED", "recipeId is required")
    return error_response(400, "INVALID_REQUEST", "Invalid request")


@app.middleware("http")
async def attach_request_id(request: Request, call_next):
    request_id = request.headers.get("X-Request-Id") or str(uuid.uuid4())
    token = request_id_ctx.set(request_id)
    try:
        response = await call_next(request)
    finally:
        request_id_ctx.reset(token)
    response.headers["X-Request-Id"] = request_id
    return response


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


def _policy_denied(code: str, detail: str, actor: Optional[Actor] = None) -> JSONResponse:
    operator_hint = None
    if actor and _include_operator_hint(actor):
        operator_hint = redact_text(detail)
    return error_response(403, code, "Action not permitted by DeliveryGroup policy", operator_hint=operator_hint)


def _capability_error(code: str, detail: str, actor: Optional[Actor] = None) -> JSONResponse:
    operator_hint = None
    if actor and _include_operator_hint(actor):
        operator_hint = redact_text(detail)
    return error_response(400, code, "Service or recipe is incompatible with this request", operator_hint=operator_hint)


def resolve_delivery_group(service: str, actor: Optional[Actor] = None):
    group = storage.get_delivery_group_for_service(service)
    if not group:
        return None, _policy_denied(
            "SERVICE_NOT_IN_DELIVERY_GROUP",
            f"Service {service} is not assigned to a delivery group",
            actor,
        )
    return group, None


def resolve_recipe(recipe_id: Optional[str], actor: Optional[Actor] = None):
    if not recipe_id:
        return None, error_response(400, "RECIPE_ID_REQUIRED", "recipeId is required")
    resolved_id = recipe_id
    recipe = storage.get_recipe(resolved_id)
    if not recipe:
        return None, error_response(404, "RECIPE_NOT_FOUND", f"Recipe {resolved_id} not found")
    if recipe.get("status") == "deprecated":
        return None, _policy_denied("RECIPE_DEPRECATED", f"Recipe {resolved_id} is deprecated", actor)
    return recipe, None


def resolve_environment_for_group(
    group: dict,
    environment: str,
    actor: Optional[Actor] = None,
) -> tuple[Optional[dict], Optional[JSONResponse]]:
    if not environment:
        return None, error_response(400, "ENVIRONMENT_REQUIRED", "environment is required")
    allowed = group.get("allowed_environments")
    if allowed is not None and environment not in allowed:
        return None, _policy_denied(
            "ENVIRONMENT_NOT_ALLOWED",
            f"Environment {environment} not allowed for delivery group {group.get('id')}",
            actor,
        )
    env_entry = storage.get_environment_for_group(environment, group.get("id"))
    if not env_entry:
        return None, _policy_denied(
            "ENVIRONMENT_NOT_ALLOWED",
            f"Environment {environment} not configured for delivery group {group.get('id')}",
            actor,
        )
    if not env_entry.get("is_enabled", True):
        return None, _policy_denied(
            "ENVIRONMENT_DISABLED",
            f"Environment {environment} is disabled for delivery group {group.get('id')}",
            actor,
        )
    return env_entry, None


def _policy_check_recipe_allowed(group: dict, recipe_id: str, actor: Optional[Actor] = None) -> Optional[JSONResponse]:
    allowed = group.get("allowed_recipes", [])
    if recipe_id not in allowed:
        return _policy_denied(
            "RECIPE_NOT_ALLOWED",
            f"Recipe {recipe_id} not allowed for delivery group {group.get('id')}",
            actor,
        )
    return None


def _capability_check_recipe_service(service_entry: dict, recipe_id: str, actor: Optional[Actor] = None) -> Optional[JSONResponse]:
    allowed = service_entry.get("allowed_recipes")
    if not isinstance(allowed, list):
        allowed = []
    if not allowed or recipe_id not in allowed:
        return _capability_error(
            "RECIPE_INCOMPATIBLE",
            f"Recipe {recipe_id} not allowed for service {service_entry.get('service_name')}",
            actor,
        )
    return None


def _group_guardrail_value(group: dict, key: str, default_value: int) -> int:
    guardrails = group.get("guardrails") or {}
    value = guardrails.get(key)
    if isinstance(value, int) and value > 0:
        return value
    return default_value


def _environment_guardrail_value(group: dict, environment: Optional[dict], key: str, default_value: int) -> int:
    if environment:
        guardrails = environment.get("guardrails") or {}
        value = guardrails.get(key)
        if isinstance(value, int) and value > 0:
            return value
    return _group_guardrail_value(group, key, default_value)


def _quota_scope(group_id: str, environment_name: Optional[str]) -> str:
    if environment_name:
        return f"{group_id}:{environment_name}"
    return group_id


def _policy_snapshot_for_environment(group: dict, environment: Optional[dict]) -> dict:
    env_name = environment.get("name") if environment else None
    max_concurrent = _environment_guardrail_value(group, environment, "max_concurrent_deployments", 1)
    daily_deploy_quota = _environment_guardrail_value(group, environment, "daily_deploy_quota", SETTINGS.daily_quota_deploy)
    active = storage.count_active_deployments_for_group(group["id"], env_name)
    quota = rate_limiter.get_daily_remaining(_quota_scope(group["id"], env_name), "deploy", daily_deploy_quota)
    return {
        "max_concurrent_deployments": max_concurrent,
        "current_concurrent_deployments": active,
        "daily_deploy_quota": daily_deploy_quota,
        "deployments_used": quota["used"],
        "deployments_remaining": quota["remaining"],
    }


def _promotion_environment_sequence(group: dict) -> list[str]:
    configured = group.get("allowed_environments")
    if isinstance(configured, list) and configured:
        return [item for item in configured if isinstance(item, str) and item]
    return list(SETTINGS.promotion_environment_order or [])


def _promotion_path_allowed(group: dict, source_environment: str, target_environment: str) -> bool:
    if SETTINGS.promotion_allow_jumps:
        return True
    sequence = _promotion_environment_sequence(group)
    try:
        source_index = sequence.index(source_environment)
        target_index = sequence.index(target_environment)
    except ValueError:
        return False
    return target_index == source_index + 1


def _version_successful_in_environment(service: str, environment: str, version: str) -> bool:
    deployments = storage.list_deployments(service, None, environment)
    return any(
        deployment.get("version") == version and deployment.get("state") == "SUCCEEDED"
        for deployment in deployments
    )


def _resolve_promotion_context(intent: PromotionIntent, actor: Actor) -> tuple[Optional[dict], Optional[JSONResponse]]:
    if intent.source_environment == intent.target_environment:
        return None, error_response(400, "PROMOTION_TARGET_REQUIRED", "source and target environments must differ")
    group, group_error = resolve_delivery_group(intent.service, actor)
    if group_error:
        return None, group_error
    source_env, source_error = resolve_environment_for_group(group, intent.source_environment, actor)
    if source_error:
        return None, source_error
    target_env, target_error = resolve_environment_for_group(group, intent.target_environment, actor)
    if target_error:
        return None, target_error
    if not _promotion_path_allowed(group, intent.source_environment, intent.target_environment):
        return None, error_response(
            400,
            "PROMOTION_PATH_NOT_ALLOWED",
            "Promotion target is not the next configured environment",
        )
    recipe, recipe_error = resolve_recipe(intent.recipeId, actor)
    if recipe_error:
        return None, recipe_error
    policy_recipe_error = _policy_check_recipe_allowed(group, recipe.get("id"), actor)
    if policy_recipe_error:
        return None, policy_recipe_error
    try:
        service_entry = guardrails.validate_service(intent.service)
        guardrails.validate_environment(intent.source_environment, service_entry, group)
        guardrails.validate_environment(intent.target_environment, service_entry, group)
        guardrails.validate_version(intent.version)
    except PolicyError as exc:
        return None, _capability_error(exc.code, exc.message, actor)
    recipe_capability_error = _capability_check_recipe_service(service_entry, recipe.get("id"), actor)
    if recipe_capability_error:
        return None, recipe_capability_error
    build = storage.find_latest_build(intent.service, intent.version)
    if not build:
        return None, error_response(400, "VERSION_NOT_FOUND", "Version is not registered for this service")
    if not _version_successful_in_environment(intent.service, intent.source_environment, intent.version):
        return None, error_response(
            400,
            "PROMOTION_VERSION_INELIGIBLE",
            "Version must be running or previously successful in source environment",
        )
    return {
        "group": group,
        "source_env": source_env,
        "target_env": target_env,
        "recipe": recipe,
        "build": build,
    }, None


def _promotion_candidate_for_service(service: str, source_environment: str, actor: Actor) -> dict:
    group, group_error = resolve_delivery_group(service, actor)
    if group_error:
        return {"eligible": False, "reason": _error_code_from_response(group_error)}
    source_env, source_error = resolve_environment_for_group(group, source_environment, actor)
    if source_error:
        return {"eligible": False, "reason": _error_code_from_response(source_error)}
    _ = source_env
    sequence = _promotion_environment_sequence(group)
    if source_environment not in sequence:
        return {"eligible": False, "reason": "PROMOTION_SOURCE_NOT_CONFIGURED"}
    source_index = sequence.index(source_environment)
    if source_index >= len(sequence) - 1:
        return {"eligible": False, "reason": "PROMOTION_AT_HIGHEST_ENVIRONMENT"}
    target_environment = sequence[source_index + 1]
    target_env, target_error = resolve_environment_for_group(group, target_environment, actor)
    if target_error:
        return {"eligible": False, "reason": _error_code_from_response(target_error)}
    _ = target_env
    deployments = storage.list_deployments(service, None, source_environment)
    promotable = next((item for item in deployments if item.get("state") == "SUCCEEDED"), None)
    if not promotable:
        return {"eligible": False, "reason": "PROMOTION_NO_SUCCESSFUL_SOURCE_VERSION", "target_environment": target_environment}
    if not promotable.get("recipeId"):
        return {"eligible": False, "reason": "RECIPE_ID_REQUIRED", "target_environment": target_environment}
    return {
        "eligible": True,
        "source_environment": source_environment,
        "target_environment": target_environment,
        "version": promotable.get("version"),
        "recipeId": promotable.get("recipeId"),
    }


def _with_guardrail_defaults(group: dict) -> dict:
    guardrails = group.get("guardrails") or {}
    max_concurrent = guardrails.get("max_concurrent_deployments")
    daily_deploy = guardrails.get("daily_deploy_quota")
    daily_rollback = guardrails.get("daily_rollback_quota")
    if max_concurrent is None:
        max_concurrent = 1
    if daily_deploy is None:
        daily_deploy = SETTINGS.daily_quota_deploy
    if daily_rollback is None:
        daily_rollback = SETTINGS.daily_quota_rollback
    return {
        **group,
        "guardrails": {
            "max_concurrent_deployments": int(max_concurrent),
            "daily_deploy_quota": int(daily_deploy),
            "daily_rollback_quota": int(daily_rollback),
        },
    }


def _validate_guardrails(guardrails: Optional[dict]) -> Optional[JSONResponse]:
    if guardrails is None:
        return None
    for key, value in guardrails.items():
        if value is None:
            continue
        if not isinstance(value, int) or value <= 0:
            return error_response(400, "INVALID_GUARDRAIL", f"Guardrail {key} must be a positive integer")
    return None


def _validate_guardrails_preview(group: dict) -> dict:
    messages = []
    status = "OK"
    guardrails = group.get("guardrails") or {}
    max_concurrent = guardrails.get("max_concurrent_deployments")
    daily_deploy = guardrails.get("daily_deploy_quota")
    daily_rollback = guardrails.get("daily_rollback_quota")

    for key, value in [
        ("max_concurrent_deployments", max_concurrent),
        ("daily_deploy_quota", daily_deploy),
        ("daily_rollback_quota", daily_rollback),
    ]:
        if value is None:
            continue
        if not isinstance(value, int) or value <= 0:
            messages.append({"type": "ERROR", "field": key, "message": "Must be a positive integer."})
            status = "ERROR"

    if max_concurrent is None:
        messages.append({"type": "WARNING", "field": "max_concurrent_deployments", "message": "Defaults to 1 if unset."})
        if status != "ERROR":
            status = "WARNING"
    if daily_deploy is None:
        messages.append({"type": "WARNING", "field": "daily_deploy_quota", "message": "Defaults to system quota if unset."})
        if status != "ERROR":
            status = "WARNING"
    if daily_rollback is None:
        messages.append({"type": "WARNING", "field": "daily_rollback_quota", "message": "Defaults to system quota if unset."})
        if status != "ERROR":
            status = "WARNING"

    services = group.get("services") or []
    recipes = group.get("allowed_recipes") or []
    environments = group.get("allowed_environments")
    if not services:
        messages.append({"type": "WARNING", "field": "services", "message": "No services selected; this group will be inert."})
        if status != "ERROR":
            status = "WARNING"
    if not recipes:
        messages.append({"type": "WARNING", "field": "allowed_recipes", "message": "No recipes allowed; deployments will be blocked."})
        if status != "ERROR":
            status = "WARNING"
    if environments is not None and not environments:
        messages.append({"type": "WARNING", "field": "allowed_environments", "message": "No environments allowed; deployments will be blocked."})
        if status != "ERROR":
            status = "WARNING"
    return {"validation_status": status, "messages": messages}


def _validate_recipe_preview(recipe: dict) -> dict:
    messages = []
    status = "OK"
    recipe_id = recipe.get("id")
    name = recipe.get("name")
    spinnaker_application = recipe.get("spinnaker_application")
    deploy_pipeline = recipe.get("deploy_pipeline")
    rollback_pipeline = recipe.get("rollback_pipeline")

    if not recipe_id:
        messages.append({"type": "ERROR", "field": "id", "message": "Recipe id is required."})
        status = "ERROR"
    if not name:
        messages.append({"type": "ERROR", "field": "name", "message": "Recipe name is required."})
        status = "ERROR"

    if not deploy_pipeline:
        messages.append({"type": "ERROR", "field": "deploy_pipeline", "message": "Deploy pipeline is required."})
        status = "ERROR"
    if (deploy_pipeline or rollback_pipeline) and not spinnaker_application:
        messages.append(
            {
                "type": "ERROR",
                "field": "spinnaker_application",
                "message": "Spinnaker application is required when pipelines are set.",
            }
        )
        status = "ERROR"
    if spinnaker_application and not deploy_pipeline:
        messages.append(
            {
                "type": "ERROR",
                "field": "deploy_pipeline",
                "message": "Deploy pipeline is required when application is set.",
            }
        )
        status = "ERROR"

    if not spinnaker_application and not deploy_pipeline:
        messages.append(
            {
                "type": "WARNING",
                "field": "spinnaker_application",
                "message": "No engine mapping configured; deployments will be blocked.",
            }
        )
        if status != "ERROR":
            status = "WARNING"
    return {"validation_status": status, "messages": messages}


def _delivery_groups_for_actor(actor: Actor) -> list[dict]:
    if actor.role == Role.PLATFORM_ADMIN:
        return storage.list_delivery_groups()
    actor_id = actor.actor_id
    if not actor_id:
        return []
    return [group for group in storage.list_delivery_groups() if group.get("owner") == actor_id]


def _spinnaker_scope_for_actor(actor: Actor) -> tuple[Optional[dict], Optional[JSONResponse]]:
    groups = _delivery_groups_for_actor(actor)
    if not groups:
        return None, error_response(
            403,
            "DELIVERY_GROUP_SCOPE_REQUIRED",
            "No delivery groups assigned to actor",
        )
    allowed_recipes: set[str] = set()
    for group in groups:
        group_recipes = set(group.get("allowed_recipes") or [])
        for service_name in group.get("services") or []:
            service_entry = storage.get_service(service_name)
            if not service_entry:
                continue
            service_recipes = set(service_entry.get("allowed_recipes") or [])
            if service_recipes:
                allowed_recipes.update(group_recipes & service_recipes)
    if not allowed_recipes:
        return None, error_response(
            403,
            "DELIVERY_GROUP_SCOPE_REQUIRED",
            "No allowed recipes in delivery group scope",
        )
    allowed_apps: set[str] = set()
    pipelines_by_app: dict[str, set[str]] = {}
    for recipe_id in allowed_recipes:
        recipe = storage.get_recipe(recipe_id)
        if not recipe or recipe.get("status") == "deprecated":
            continue
        application = recipe.get("spinnaker_application")
        if not application:
            continue
        allowed_apps.add(application)
        for pipeline_key in ("deploy_pipeline", "rollback_pipeline"):
            pipeline = recipe.get(pipeline_key)
            if pipeline:
                pipelines_by_app.setdefault(application, set()).add(pipeline)
    if not allowed_apps:
        return None, error_response(
            403,
            "DELIVERY_GROUP_SCOPE_REQUIRED",
            "No spinnaker applications in delivery group scope",
        )
    return {"apps": allowed_apps, "pipelines": pipelines_by_app}, None


def _validate_delivery_group_payload(group: dict, group_id: Optional[str] = None) -> Optional[JSONResponse]:
    if not group.get("id"):
        return error_response(400, "MISSING_ID", "Delivery group id is required")
    if not group.get("name"):
        return error_response(400, "MISSING_NAME", "Delivery group name is required")
    services = group.get("services") or []
    recipes = group.get("allowed_recipes") or []
    allowed_envs = group.get("allowed_environments")
    if not isinstance(services, list):
        return error_response(400, "INVALID_SERVICES", "services must be a list")
    if allowed_envs is not None:
        if not isinstance(allowed_envs, list):
            return error_response(400, "INVALID_ENVIRONMENTS", "allowed_environments must be a list")
        for env in allowed_envs:
            if not isinstance(env, str) or not env.strip():
                return error_response(400, "INVALID_ENVIRONMENTS", "allowed_environments must be a list of strings")
    if not isinstance(recipes, list):
        return error_response(400, "INVALID_RECIPES", "allowed_recipes must be a list")
    allowlisted_services = {entry.get("service_name") for entry in storage.list_services()}
    for service in services:
        if service not in allowlisted_services:
            return error_response(400, "SERVICE_NOT_ALLOWLISTED", f"Service {service} is not allowlisted")
        existing = storage.get_delivery_group_for_service(service)
        if existing and existing.get("id") != group_id:
            return error_response(
                409,
                "SERVICE_ALREADY_ASSIGNED",
                f"Service {service} already belongs to delivery group {existing.get('id')}",
            )
    recipe_ids = {recipe.get("id") for recipe in storage.list_recipes()}
    for recipe_id in recipes:
        if recipe_id not in recipe_ids:
            return error_response(400, "RECIPE_NOT_FOUND", f"Recipe {recipe_id} not found")
    guardrail_error = _validate_guardrails(group.get("guardrails"))
    if guardrail_error:
        return guardrail_error
    return None


def _apply_create_audit(payload: dict, actor: Actor) -> None:
    now = utc_now()
    payload["created_at"] = now
    payload["created_by"] = actor.actor_id
    payload["updated_at"] = now
    payload["updated_by"] = actor.actor_id
    payload["last_change_reason"] = None


def _apply_update_audit(payload: dict, actor: Actor, existing: dict) -> None:
    payload["created_at"] = existing.get("created_at")
    payload["created_by"] = existing.get("created_by")
    payload["updated_at"] = utc_now()
    payload["updated_by"] = actor.actor_id
    change_reason = payload.pop("change_reason", None)
    if isinstance(change_reason, str):
        trimmed = change_reason.strip()
        payload["last_change_reason"] = trimmed if trimmed else existing.get("last_change_reason")
    else:
        payload["last_change_reason"] = existing.get("last_change_reason")


def _record_audit_event(
    actor: Actor,
    event_type: str,
    target_type: str,
    target_id: str,
    outcome: AuditOutcome,
    summary: str,
    delivery_group_id: Optional[str] = None,
    service_name: Optional[str] = None,
    environment: Optional[str] = None,
) -> None:
    event = {
        "event_id": str(uuid.uuid4()),
        "event_type": event_type,
        "actor_id": actor.actor_id,
        "actor_role": actor.role.value,
        "target_type": target_type,
        "target_id": target_id,
        "timestamp": utc_now(),
        "outcome": outcome.value,
        "summary": summary,
        "delivery_group_id": delivery_group_id,
        "service_name": service_name,
        "environment": environment,
    }
    if hasattr(storage, "insert_audit_event"):
        storage.insert_audit_event(event)


def _record_deploy_denied(actor: Actor, intent: DeploymentIntent, code: str, group_id: Optional[str] = None) -> None:
    summary = f"Deploy rejected ({code}) for {intent.service}"
    log_event(
        "deploy_intent_denied",
        actor_id=actor.actor_id,
        actor_role=actor.role.value,
        delivery_group_id=group_id,
        service_name=intent.service,
        recipe_id=intent.recipeId,
        environment=intent.environment,
        outcome="DENIED",
        summary=summary,
    )
    _record_audit_event(
        actor,
        "DEPLOY_DENIED",
        "Deployment",
        intent.service,
        AuditOutcome.DENIED,
        summary,
        delivery_group_id=group_id,
        service_name=intent.service,
        environment=intent.environment,
    )


def _record_promotion_denied(actor: Actor, intent: PromotionIntent, code: str, group_id: Optional[str] = None) -> None:
    summary = (
        f"Promotion rejected ({code}) for {intent.service} "
        f"{intent.source_environment}->{intent.target_environment}"
    )
    log_event(
        "promotion_intent_denied",
        actor_id=actor.actor_id,
        actor_role=actor.role.value,
        delivery_group_id=group_id,
        service_name=intent.service,
        recipe_id=intent.recipeId,
        environment=intent.target_environment,
        outcome="DENIED",
        summary=summary,
    )
    _record_audit_event(
        actor,
        "PROMOTION_DENIED",
        "Deployment",
        intent.service,
        AuditOutcome.DENIED,
        summary,
        delivery_group_id=group_id,
        service_name=intent.service,
        environment=intent.target_environment,
    )


def _error_code_from_response(response: JSONResponse) -> str:
    try:
        payload = json.loads(response.body.decode("utf-8"))
        if isinstance(payload, dict) and payload.get("code"):
            return payload["code"]
    except Exception:
        return "UNKNOWN"
    return "UNKNOWN"


def classify_failure_cause(error_code: Optional[str]) -> str:
    if not error_code:
        return "UNKNOWN"
    user_error_codes = {
        "INVALID_REQUEST",
        "RECIPE_ID_REQUIRED",
        "RECIPE_NAME_REQUIRED",
        "RECIPE_BEHAVIOR_REQUIRED",
        "ID_MISMATCH",
        "MISSING_ENGINE_APP",
        "MISSING_ENGINE_PIPELINE",
        "INVALID_STATUS",
        "INVALID_ENVIRONMENT",
        "ENVIRONMENT_REQUIRED",
        "INVALID_VERSION",
        "INVALID_ARTIFACT",
        "IDMP_KEY_REQUIRED",
        "VERSION_NOT_FOUND",
        "RECIPE_NOT_FOUND",
        "PROMOTION_TARGET_REQUIRED",
        "PROMOTION_PATH_NOT_ALLOWED",
        "PROMOTION_VERSION_INELIGIBLE",
        "PROMOTION_SOURCE_NOT_CONFIGURED",
        "PROMOTION_AT_HIGHEST_ENVIRONMENT",
        "PROMOTION_NO_SUCCESSFUL_SOURCE_VERSION",
    }
    policy_change_codes = {
        "SERVICE_NOT_ALLOWLISTED",
        "SERVICE_NOT_IN_DELIVERY_GROUP",
        "ENVIRONMENT_NOT_ALLOWED",
        "ENVIRONMENT_DISABLED",
        "RECIPE_NOT_ALLOWED",
        "RECIPE_INCOMPATIBLE",
        "RECIPE_DEPRECATED",
        "CONCURRENCY_LIMIT_REACHED",
        "QUOTA_EXCEEDED",
        "RATE_LIMITED",
        "MUTATIONS_DISABLED",
        "ROLE_FORBIDDEN",
        "AUTHZ_ROLE_REQUIRED",
        "UNAUTHORIZED",
    }
    if error_code in user_error_codes:
        return "USER_ERROR"
    if error_code in policy_change_codes:
        return "POLICY_CHANGE"
    return "UNKNOWN"


def _include_operator_hint(actor: Actor) -> bool:
    return actor.role == Role.PLATFORM_ADMIN or SETTINGS.demo_mode


def _classify_engine_error(message: str) -> tuple[str, int]:
    lowered = (message or "").lower()
    if "timeout" in lowered or "timed out" in lowered:
        return "ENGINE_TIMEOUT", 504
    if "http 401" in lowered or "http 403" in lowered:
        return "ENGINE_UNAUTHORIZED", 502
    if "connection failed" in lowered or "base url is required" in lowered or "stub mode" in lowered:
        return "ENGINE_UNAVAILABLE", 503
    return "ENGINE_CALL_FAILED", 502


def _engine_error_response(actor: Actor, user_message: str, exc: Exception) -> JSONResponse:
    raw_message = str(exc) if exc else ""
    redacted = redact_text(raw_message)
    code, status = _classify_engine_error(raw_message)
    operator_hint = None
    if _include_operator_hint(actor) and redacted:
        operator_hint = redacted
    log_event(
        "engine_error",
        outcome="FAILED",
        summary=redacted or "none",
        error_code=code,
        status_code=status,
    )
    request_id = request_id_ctx.get() or str(uuid.uuid4())
    payload = {
        "code": code,
        "error_code": code,
        "failure_cause": classify_failure_cause(code),
        "message": user_message,
        "request_id": request_id,
    }
    if operator_hint:
        payload["operator_hint"] = operator_hint
    return JSONResponse(status_code=status, content=payload)


def _validate_recipe_payload(payload: dict, recipe_id: Optional[str] = None) -> Optional[JSONResponse]:
    if not payload.get("id"):
        return error_response(400, "RECIPE_ID_REQUIRED", "Recipe id is required")
    if recipe_id and payload["id"] != recipe_id:
        return error_response(400, "ID_MISMATCH", "Recipe id cannot be changed")
    if not payload.get("name"):
        return error_response(400, "RECIPE_NAME_REQUIRED", "Recipe name is required")
    spinnaker_application = payload.get("spinnaker_application")
    deploy_pipeline = payload.get("deploy_pipeline")
    rollback_pipeline = payload.get("rollback_pipeline")
    if not deploy_pipeline:
        return error_response(400, "RECIPE_DEPLOY_PIPELINE_REQUIRED", "deploy_pipeline is required")
    if (deploy_pipeline or rollback_pipeline) and not spinnaker_application:
        return error_response(
            400,
            "MISSING_ENGINE_APP",
            "spinnaker_application is required when pipelines are set",
        )
    if spinnaker_application and not deploy_pipeline:
        return error_response(
            400,
            "MISSING_ENGINE_PIPELINE",
            "deploy_pipeline is required when spinnaker_application is set",
        )
    status = payload.get("status") or "active"
    if status not in {"active", "deprecated"}:
        return error_response(400, "INVALID_STATUS", "status must be active or deprecated")
    payload["status"] = status
    behavior_summary = payload.get("effective_behavior_summary")
    if not isinstance(behavior_summary, str) or not behavior_summary.strip():
        return error_response(
            400,
            "RECIPE_BEHAVIOR_REQUIRED",
            "effective_behavior_summary is required",
        )
    payload["effective_behavior_summary"] = behavior_summary.strip()
    return None


def _apply_recipe_mapping(payload: dict, recipe: dict) -> None:
    if recipe.get("spinnaker_application"):
        payload["spinnakerApplication"] = recipe.get("spinnaker_application")
    if recipe.get("deploy_pipeline"):
        payload["spinnakerPipeline"] = recipe.get("deploy_pipeline")


def _deployment_kind(deployment: dict) -> str:
    return normalize_deployment_kind(
        deployment.get("deploymentKind"),
        deployment.get("rollbackOf"),
    )


def _deployment_outcome(deployment: dict, latest_success_id: Optional[str]) -> Optional[str]:
    return resolve_outcome(
        deployment.get("state"),
        deployment.get("outcome"),
        deployment.get("id"),
        latest_success_id,
    )


def _latest_success_by_scope(deployments: list[dict]) -> dict[tuple[str, str], dict]:
    latest: dict[tuple[str, str], dict] = {}
    for deployment in deployments:
        if deployment.get("state") != "SUCCEEDED":
            continue
        if deployment.get("outcome") == "SUPERSEDED":
            continue
        service = deployment.get("service")
        environment = deployment.get("environment")
        key = (service, environment)
        if service and environment and key not in latest:
            latest[key] = deployment
    return latest


def _current_running_state(
    service: str,
    environment: str,
    deployments: list[dict],
    latest_success_id: Optional[str],
) -> Optional[dict]:
    for deployment in deployments:
        if deployment.get("environment") != environment:
            continue
        outcome = _deployment_outcome(deployment, latest_success_id)
        if outcome == "SUCCEEDED":
            return {
                "service": service,
                "environment": environment,
                "scope": "service",
                "version": deployment.get("version"),
                "deploymentId": deployment.get("id"),
                "deploymentKind": _deployment_kind(deployment),
                "derivedAt": utc_now(),
            }
    return None


def _deployment_public_view(
    actor: Actor,
    deployment: dict,
    latest_success_by_scope: Optional[dict[tuple[str, str], dict]] = None,
) -> dict:
    delivery_group_id = deployment.get("deliveryGroupId")
    if not delivery_group_id and deployment.get("service"):
        group = storage.get_delivery_group_for_service(deployment["service"])
        if group:
            delivery_group_id = group.get("id")
    latest_success_id = None
    if latest_success_by_scope is not None:
        latest = latest_success_by_scope.get((deployment.get("service"), deployment.get("environment")))
        if latest:
            latest_success_id = latest.get("id")
    payload = {
        "id": deployment.get("id"),
        "service": deployment.get("service"),
        "environment": deployment.get("environment"),
        "version": deployment.get("version"),
        "sourceEnvironment": deployment.get("sourceEnvironment"),
        "recipeId": deployment.get("recipeId"),
        "recipeRevision": deployment.get("recipeRevision"),
        "effectiveBehaviorSummary": deployment.get("effectiveBehaviorSummary"),
        "state": deployment.get("state"),
        "deploymentKind": _deployment_kind(deployment),
        "outcome": _deployment_outcome(deployment, latest_success_id),
        "changeSummary": deployment.get("changeSummary"),
        "createdAt": deployment.get("createdAt"),
        "updatedAt": deployment.get("updatedAt"),
        "rollbackOf": deployment.get("rollbackOf"),
        "deliveryGroupId": delivery_group_id,
        "engine_type": deployment.get("engine_type") or EngineType.SPINNAKER.value,
        "failures": deployment.get("failures") or [],
    }
    if actor.role == Role.PLATFORM_ADMIN:
        payload["engineExecutionId"] = deployment.get("spinnakerExecutionId")
        payload["engineExecutionUrl"] = deployment.get("spinnakerExecutionUrl")
    return payload


def _recipe_public_view(actor: Actor, recipe: dict) -> dict:
    payload = Recipe(**recipe).dict()
    if actor.role != Role.PLATFORM_ADMIN:
        payload.pop("spinnaker_application", None)
        payload.pop("deploy_pipeline", None)
        payload.pop("rollback_pipeline", None)
    return payload


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
    try:
        execution = spinnaker.get_execution(deployment["spinnakerExecutionId"])
    except Exception as exc:
        logger.warning("engine.refresh_failed deployment_id=%s error=%s", deployment.get("id"), redact_text(str(exc)))
        return deployment
    state = execution.get("state")
    if state in ["PENDING", "ACTIVE", "IN_PROGRESS", "SUCCEEDED", "FAILED", "CANCELED", "ROLLED_BACK"]:
        failures = normalize_failures(execution.get("failures"))
        outcome = base_outcome_from_state(state)
        storage.update_deployment(deployment["id"], state, failures, outcome=outcome)
        deployment = storage.get_deployment(deployment["id"]) or deployment
        if state == "SUCCEEDED" and deployment.get("rollbackOf"):
            original = storage.get_deployment(deployment["rollbackOf"])
            if original and original.get("state") != "ROLLED_BACK":
                storage.update_deployment(
                    original["id"],
                    "ROLLED_BACK",
                    original.get("failures", []),
                    outcome=base_outcome_from_state("ROLLED_BACK"),
                    superseded_by=deployment.get("id"),
                )
        if state == "SUCCEEDED":
            storage.apply_supersession(deployment)
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
        bucket, key = parse_s3_artifact_ref(artifact_ref, SETTINGS.artifact_ref_schemes)
    else:
        if not s3_key:
            raise ValueError("s3Key is required when artifactRef is omitted")
        bucket = s3_bucket or SETTINGS.runtime_artifact_bucket
        key = s3_key
        artifact_ref = f"s3://{bucket}/{key}"
        parse_s3_artifact_ref(artifact_ref, SETTINGS.artifact_ref_schemes)

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
    guardrails.validate_artifact_source(artifact_ref, service_entry)

    record = {
        "service": service,
        "version": version,
        "artifactRef": artifact_ref,
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
    try:
        guardrails.require_mutations_enabled()
        guardrails.require_idempotency_key(idempotency_key)
    except PolicyError as exc:
        _record_deploy_denied(actor, intent, exc.code)
        raise
    group, group_error = resolve_delivery_group(intent.service, actor)
    if group_error:
        _record_deploy_denied(actor, intent, _error_code_from_response(group_error))
        return group_error
    env_entry, env_error = resolve_environment_for_group(group, intent.environment, actor)
    if env_error:
        _record_deploy_denied(actor, intent, _error_code_from_response(env_error), group.get("id"))
        return env_error
    recipe, recipe_error = resolve_recipe(intent.recipeId, actor)
    if recipe_error:
        _record_deploy_denied(actor, intent, _error_code_from_response(recipe_error), group.get("id"))
        return recipe_error
    policy_recipe_error = _policy_check_recipe_allowed(group, recipe.get("id"), actor)
    if policy_recipe_error:
        _record_deploy_denied(actor, intent, _error_code_from_response(policy_recipe_error), group.get("id"))
        return policy_recipe_error
    try:
        service_entry = guardrails.validate_service(intent.service)
        guardrails.validate_environment(intent.environment, service_entry, group)
        guardrails.validate_version(intent.version)
    except PolicyError as exc:
        return _capability_error(exc.code, exc.message, actor)
    build = storage.find_latest_build(intent.service, intent.version)
    if not build:
        _record_deploy_denied(actor, intent, "VERSION_NOT_FOUND", group.get("id"))
        return error_response(400, "VERSION_NOT_FOUND", "Version is not registered for this service")
    recipe_capability_error = _capability_check_recipe_service(service_entry, recipe.get("id"), actor)
    if recipe_capability_error:
        return recipe_capability_error
    max_concurrent = _environment_guardrail_value(group, env_entry, "max_concurrent_deployments", 1)
    daily_deploy_quota = _environment_guardrail_value(group, env_entry, "daily_deploy_quota", SETTINGS.daily_quota_deploy)
    try:
        rate_limiter.check_mutate(
            actor.actor_id,
            "deploy",
            quota_scope=_quota_scope(group["id"], env_entry.get("name")),
            quota_limit=daily_deploy_quota,
        )
        guardrails.enforce_delivery_group_lock(group["id"], max_concurrent, env_entry.get("name"))
    except PolicyError as exc:
        _record_deploy_denied(actor, intent, exc.code, group.get("id"))
        raise
    cached = enforce_idempotency(request, idempotency_key)
    if cached:
        return cached

    payload = intent.dict()
    payload.pop("recipeId", None)
    _apply_recipe_mapping(payload, recipe)
    if spinnaker.mode == "http":
        if not payload.get("spinnakerApplication") and not SETTINGS.spinnaker_application:
            _record_deploy_denied(actor, intent, "INVALID_REQUEST", group.get("id"))
            return error_response(400, "INVALID_REQUEST", "spinnakerApplication is required for deploy")
        payload["artifactRef"] = build["artifactRef"]

    try:
        execution = spinnaker.trigger_deploy(payload, idempotency_key)
    except Exception as exc:
        return _engine_error_response(actor, "Unable to start deployment", exc)
    record = {
        "id": str(uuid.uuid4()),
        "service": intent.service,
        "environment": intent.environment,
        "version": intent.version,
        "recipeId": recipe.get("id"),
        "recipeRevision": recipe.get("recipe_revision"),
        "effectiveBehaviorSummary": recipe.get("effective_behavior_summary"),
        "state": "IN_PROGRESS",
        "deploymentKind": "ROLL_FORWARD",
        "outcome": None,
        "intentCorrelationId": idempotency_key,
        "supersededBy": None,
        "changeSummary": intent.changeSummary,
        "createdAt": utc_now(),
        "updatedAt": utc_now(),
        "engine_type": recipe.get("engine_type") or EngineType.SPINNAKER.value,
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
    _record_audit_event(
        actor,
        "DEPLOY_SUBMIT",
        "Deployment",
        record["id"],
        AuditOutcome.SUCCESS,
        f"Deploy submitted for {intent.service}",
        delivery_group_id=group.get("id"),
        service_name=intent.service,
        environment=intent.environment,
    )
    log_event(
        "deploy_intent_submitted",
        actor_id=actor.actor_id,
        actor_role=actor.role.value,
        delivery_group_id=group.get("id"),
        service_name=intent.service,
        recipe_id=recipe.get("id"),
        environment=intent.environment,
        outcome="SUCCESS",
        summary=f"Deploy submitted for {intent.service}",
    )
    return _deployment_public_view(actor, record)


@app.post("/v1/policy/summary")
def get_policy_summary(
    req: PolicySummaryRequest,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    actor = get_actor(authorization)
    role_error = require_role(actor, {Role.DELIVERY_OWNER, Role.PLATFORM_ADMIN}, "view policy")
    if role_error:
        return role_error
    rate_limiter.check_read(actor.actor_id)
    group, group_error = resolve_delivery_group(req.service, actor)
    if group_error:
        return group_error
    env_entry, env_error = resolve_environment_for_group(group, req.environment, actor)
    if env_error:
        return env_error
    recipe = None
    if req.recipeId:
        recipe, recipe_error = resolve_recipe(req.recipeId, actor)
        if recipe_error:
            return recipe_error
        policy_recipe_error = _policy_check_recipe_allowed(group, recipe.get("id"), actor)
        if policy_recipe_error:
            return policy_recipe_error
    try:
        service_entry = guardrails.validate_service(req.service)
        guardrails.validate_environment(req.environment, service_entry, group)
    except PolicyError as exc:
        return _capability_error(exc.code, exc.message, actor)
    if recipe:
        recipe_capability_error = _capability_check_recipe_service(service_entry, recipe.get("id"), actor)
        if recipe_capability_error:
            return recipe_capability_error

    policy_snapshot = _policy_snapshot_for_environment(group, env_entry)
    return {
        "service": req.service,
        "environment": req.environment,
        "recipeId": recipe.get("id") if recipe else None,
        "deliveryGroupId": group.get("id"),
        "policy": policy_snapshot,
        "generatedAt": utc_now(),
    }


@app.post("/v1/deployments/validate")
def validate_deployment(
    intent: DeploymentIntent,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    actor = get_actor(authorization)
    role_error = require_role(actor, {Role.DELIVERY_OWNER, Role.PLATFORM_ADMIN}, "deploy")
    if role_error:
        return role_error
    rate_limiter.check_read(actor.actor_id)
    guardrails.require_mutations_enabled()
    group, group_error = resolve_delivery_group(intent.service, actor)
    if group_error:
        return group_error
    env_entry, env_error = resolve_environment_for_group(group, intent.environment, actor)
    if env_error:
        return env_error
    recipe, recipe_error = resolve_recipe(intent.recipeId, actor)
    if recipe_error:
        return recipe_error
    policy_recipe_error = _policy_check_recipe_allowed(group, recipe.get("id"), actor)
    if policy_recipe_error:
        return policy_recipe_error
    try:
        service_entry = guardrails.validate_service(intent.service)
        guardrails.validate_environment(intent.environment, service_entry, group)
        guardrails.validate_version(intent.version)
    except PolicyError as exc:
        return _capability_error(exc.code, exc.message, actor)
    recipe_capability_error = _capability_check_recipe_service(service_entry, recipe.get("id"), actor)
    if recipe_capability_error:
        return recipe_capability_error
    build = storage.find_latest_build(intent.service, intent.version)
    if not build:
        return error_response(400, "VERSION_NOT_FOUND", "Version is not registered for this service")

    policy_snapshot = _policy_snapshot_for_environment(group, env_entry)
    if policy_snapshot["current_concurrent_deployments"] >= policy_snapshot["max_concurrent_deployments"]:
        return error_response(409, "CONCURRENCY_LIMIT_REACHED", "Delivery group has active deployments")
    if policy_snapshot["deployments_remaining"] <= 0:
        return error_response(429, "QUOTA_EXCEEDED", "Daily quota exceeded")

    return {
        "service": intent.service,
        "environment": intent.environment,
        "version": intent.version,
        "recipeId": recipe.get("id"),
        "deliveryGroupId": group.get("id"),
        "versionRegistered": True,
        "policy": policy_snapshot,
        "validatedAt": utc_now(),
    }


@app.post("/v1/promotions/validate")
def validate_promotion(
    intent: PromotionIntent,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    actor = get_actor(authorization)
    role_error = require_role(actor, {Role.DELIVERY_OWNER, Role.PLATFORM_ADMIN}, "promote")
    if role_error:
        return role_error
    rate_limiter.check_read(actor.actor_id)
    guardrails.require_mutations_enabled()
    context, context_error = _resolve_promotion_context(intent, actor)
    if context_error:
        _record_promotion_denied(actor, intent, _error_code_from_response(context_error))
        return context_error
    group = context["group"]
    target_env = context["target_env"]
    recipe = context["recipe"]
    policy_snapshot = _policy_snapshot_for_environment(group, target_env)
    if policy_snapshot["current_concurrent_deployments"] >= policy_snapshot["max_concurrent_deployments"]:
        return error_response(409, "CONCURRENCY_LIMIT_REACHED", "Delivery group has active deployments")
    if policy_snapshot["deployments_remaining"] <= 0:
        return error_response(429, "QUOTA_EXCEEDED", "Daily quota exceeded")
    return {
        "service": intent.service,
        "source_environment": intent.source_environment,
        "target_environment": intent.target_environment,
        "version": intent.version,
        "recipeId": recipe.get("id"),
        "deliveryGroupId": group.get("id"),
        "versionEligible": True,
        "policy": policy_snapshot,
        "validatedAt": utc_now(),
    }


@app.post("/v1/promotions", status_code=201)
def create_promotion(
    intent: PromotionIntent,
    request: Request,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    authorization: Optional[str] = Header(None),
):
    actor = get_actor(authorization)
    role_error = require_role(actor, {Role.DELIVERY_OWNER, Role.PLATFORM_ADMIN}, "promote")
    if role_error:
        return role_error
    try:
        guardrails.require_mutations_enabled()
        guardrails.require_idempotency_key(idempotency_key)
    except PolicyError as exc:
        _record_promotion_denied(actor, intent, exc.code)
        raise
    context, context_error = _resolve_promotion_context(intent, actor)
    if context_error:
        _record_promotion_denied(actor, intent, _error_code_from_response(context_error))
        return context_error
    group = context["group"]
    target_env = context["target_env"]
    recipe = context["recipe"]
    build = context["build"]
    policy_snapshot = _policy_snapshot_for_environment(group, target_env)
    if policy_snapshot["current_concurrent_deployments"] >= policy_snapshot["max_concurrent_deployments"]:
        _record_promotion_denied(actor, intent, "CONCURRENCY_LIMIT_REACHED", group.get("id"))
        return error_response(409, "CONCURRENCY_LIMIT_REACHED", "Delivery group has active deployments")
    if policy_snapshot["deployments_remaining"] <= 0:
        _record_promotion_denied(actor, intent, "QUOTA_EXCEEDED", group.get("id"))
        return error_response(429, "QUOTA_EXCEEDED", "Daily quota exceeded")
    max_concurrent = _environment_guardrail_value(group, target_env, "max_concurrent_deployments", 1)
    daily_deploy_quota = _environment_guardrail_value(
        group,
        target_env,
        "daily_deploy_quota",
        SETTINGS.daily_quota_deploy,
    )
    rate_limiter.check_mutate(
        actor.actor_id,
        "promote",
        quota_scope=_quota_scope(group["id"], target_env.get("name")),
        quota_limit=daily_deploy_quota,
    )
    guardrails.enforce_delivery_group_lock(group["id"], max_concurrent, target_env.get("name"))
    cached = enforce_idempotency(request, idempotency_key)
    if cached:
        return cached
    payload = {
        "service": intent.service,
        "environment": intent.target_environment,
        "version": intent.version,
        "sourceEnvironment": intent.source_environment,
        "targetEnvironment": intent.target_environment,
    }
    _apply_recipe_mapping(payload, recipe)
    if spinnaker.mode == "http":
        if not payload.get("spinnakerApplication") and not SETTINGS.spinnaker_application:
            _record_promotion_denied(actor, intent, "INVALID_REQUEST", group.get("id"))
            return error_response(400, "INVALID_REQUEST", "spinnakerApplication is required for promotion")
        payload["artifactRef"] = build["artifactRef"]
    try:
        execution = spinnaker.trigger_deploy(payload, idempotency_key)
    except Exception as exc:
        return _engine_error_response(actor, "Unable to start promotion", exc)
    record = {
        "id": str(uuid.uuid4()),
        "service": intent.service,
        "environment": intent.target_environment,
        "sourceEnvironment": intent.source_environment,
        "version": intent.version,
        "recipeId": recipe.get("id"),
        "recipeRevision": recipe.get("recipe_revision"),
        "effectiveBehaviorSummary": recipe.get("effective_behavior_summary"),
        "state": "IN_PROGRESS",
        "deploymentKind": "PROMOTE",
        "outcome": None,
        "intentCorrelationId": idempotency_key,
        "supersededBy": None,
        "changeSummary": intent.changeSummary,
        "createdAt": utc_now(),
        "updatedAt": utc_now(),
        "engine_type": recipe.get("engine_type") or EngineType.SPINNAKER.value,
        "spinnakerExecutionId": execution["executionId"],
        "spinnakerExecutionUrl": execution["executionUrl"],
        "spinnakerApplication": payload.get("spinnakerApplication"),
        "spinnakerPipeline": payload.get("spinnakerPipeline"),
        "deliveryGroupId": group["id"],
        "failures": [],
    }
    storage.insert_deployment(record, [])
    store_idempotency(request, idempotency_key, record, 201)
    _record_audit_event(
        actor,
        "PROMOTION_SUBMIT",
        "Deployment",
        record["id"],
        AuditOutcome.SUCCESS,
        (
            f"Promotion submitted for {intent.service} "
            f"{intent.source_environment}->{intent.target_environment}"
        ),
        delivery_group_id=group.get("id"),
        service_name=intent.service,
        environment=intent.target_environment,
    )
    log_event(
        "promotion_intent_submitted",
        actor_id=actor.actor_id,
        actor_role=actor.role.value,
        delivery_group_id=group.get("id"),
        service_name=intent.service,
        recipe_id=recipe.get("id"),
        environment=intent.target_environment,
        outcome="SUCCESS",
        summary=(
            f"Promotion submitted for {intent.service} "
            f"{intent.source_environment}->{intent.target_environment}"
        ),
    )
    return _deployment_public_view(actor, record)


@app.get("/v1/deployments")
def list_deployments(
    request: Request,
    service: Optional[str] = None,
    state: Optional[str] = None,
    environment: Optional[str] = None,
    authorization: Optional[str] = Header(None),
):
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    deployments = storage.list_deployments(service, state, environment)
    latest_success_by_scope = _latest_success_by_scope(deployments)
    return [
        _deployment_public_view(actor, deployment, latest_success_by_scope)
        for deployment in deployments
    ]


@app.get("/v1/services")
def list_services(request: Request, authorization: Optional[str] = Header(None)):
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    return storage.list_services()


@app.get("/v1/environments")
def list_environments(request: Request, authorization: Optional[str] = Header(None)):
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    environments = storage.list_environments()
    return [Environment(**env).dict() for env in environments]


@app.get("/v1/delivery-groups")
def list_delivery_groups(request: Request, authorization: Optional[str] = Header(None)):
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    groups = storage.list_delivery_groups()
    return [DeliveryGroup(**_with_guardrail_defaults(group)).dict() for group in groups]


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
    return DeliveryGroup(**_with_guardrail_defaults(group)).dict()


@app.post("/v1/delivery-groups", status_code=201)
def create_delivery_group(
    group: DeliveryGroupUpsert,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    actor = get_actor(authorization)
    role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "create delivery groups")
    if role_error:
        return role_error
    rate_limiter.check_mutate(actor.actor_id, "delivery_group_create")
    payload = group.dict()
    payload.pop("change_reason", None)
    if storage.get_delivery_group(payload["id"]):
        return error_response(409, "DELIVERY_GROUP_EXISTS", "Delivery group id already exists")
    validation_error = _validate_delivery_group_payload(payload, None)
    if validation_error:
        return validation_error
    _apply_create_audit(payload, actor)
    storage.insert_delivery_group(payload)
    _record_audit_event(
        actor,
        "ADMIN_CREATE",
        "DeliveryGroup",
        payload["id"],
        AuditOutcome.SUCCESS,
        f"Delivery group {payload['id']} created",
        delivery_group_id=payload["id"],
    )
    return DeliveryGroup(**payload).dict()


@app.put("/v1/delivery-groups/{group_id}")
def update_delivery_group(
    group_id: str,
    group: DeliveryGroupUpsert,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    actor = get_actor(authorization)
    role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "update delivery groups")
    if role_error:
        return role_error
    rate_limiter.check_mutate(actor.actor_id, "delivery_group_update")
    payload = group.dict()
    if payload.get("id") and payload["id"] != group_id:
        return error_response(400, "ID_MISMATCH", "Delivery group id cannot be changed")
    existing = storage.get_delivery_group(group_id)
    if not existing:
        return error_response(404, "NOT_FOUND", "Delivery group not found")
    payload["id"] = group_id
    if payload.get("allowed_environments") is None:
        payload["allowed_environments"] = existing.get("allowed_environments")
    validation_error = _validate_delivery_group_payload(payload, group_id)
    if validation_error:
        return validation_error
    _apply_update_audit(payload, actor, existing)
    if hasattr(storage, "update_delivery_group"):
        storage.update_delivery_group(payload)
    else:
        storage.insert_delivery_group(payload)
    _record_audit_event(
        actor,
        "ADMIN_UPDATE",
        "DeliveryGroup",
        payload["id"],
        AuditOutcome.SUCCESS,
        f"Delivery group {payload['id']} updated",
        delivery_group_id=payload["id"],
    )
    return DeliveryGroup(**payload).dict()


@app.post("/v1/recipes")
def create_recipe(
    recipe: RecipeUpsert,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    actor = get_actor(authorization)
    role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "create recipes")
    if role_error:
        return role_error
    rate_limiter.check_mutate(actor.actor_id, "recipe_create")
    payload = recipe.dict()
    payload.pop("change_reason", None)
    payload["engine_type"] = EngineType.SPINNAKER.value
    validation_error = _validate_recipe_payload(payload)
    if validation_error:
        return validation_error
    if storage.get_recipe(payload["id"]):
        return error_response(409, "RECIPE_EXISTS", "Recipe already exists")
    payload["recipe_revision"] = payload.get("recipe_revision") or 1
    _apply_create_audit(payload, actor)
    storage.insert_recipe(payload)
    _record_audit_event(
        actor,
        "ADMIN_CREATE",
        "Recipe",
        payload["id"],
        AuditOutcome.SUCCESS,
        f"Recipe {payload['id']} created",
    )
    return Recipe(**payload).dict()


@app.put("/v1/recipes/{recipe_id}")
def update_recipe(
    recipe_id: str,
    recipe: RecipeUpsert,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    actor = get_actor(authorization)
    role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "update recipes")
    if role_error:
        return role_error
    rate_limiter.check_mutate(actor.actor_id, "recipe_update")
    payload = recipe.dict()
    payload["engine_type"] = EngineType.SPINNAKER.value
    validation_error = _validate_recipe_payload(payload, recipe_id)
    if validation_error:
        return validation_error
    existing = storage.get_recipe(recipe_id)
    if not existing:
        return error_response(404, "NOT_FOUND", "Recipe not found")
    payload["id"] = recipe_id
    payload["recipe_revision"] = (existing.get("recipe_revision") or 1) + 1
    _apply_update_audit(payload, actor, existing)
    if hasattr(storage, "update_recipe"):
        storage.update_recipe(payload)
    else:
        storage.insert_recipe(payload)
    _record_audit_event(
        actor,
        "ADMIN_UPDATE",
        "Recipe",
        payload["id"],
        AuditOutcome.SUCCESS,
        f"Recipe {payload['id']} updated",
    )
    return Recipe(**payload).dict()


@app.get("/v1/recipes")
def list_recipes(request: Request, authorization: Optional[str] = Header(None)):
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    recipes = storage.list_recipes()
    return [_recipe_public_view(actor, recipe) for recipe in recipes]


@app.get("/v1/recipes/{recipe_id}")
def get_recipe(recipe_id: str, request: Request, authorization: Optional[str] = Header(None)):
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    recipe = storage.get_recipe(recipe_id)
    if not recipe:
        return error_response(404, "NOT_FOUND", "Recipe not found")
    return _recipe_public_view(actor, recipe)


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
    environment: str = Query(...),
    authorization: Optional[str] = Header(None),
):
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    service_entry = guardrails.validate_service(service)
    group, group_error = resolve_delivery_group(service, actor)
    if group_error:
        return group_error
    env_entry, env_error = resolve_environment_for_group(group, environment, actor)
    if env_error:
        return env_error
    try:
        guardrails.validate_environment(environment, service_entry, group)
    except PolicyError as exc:
        return _capability_error(exc.code, exc.message, actor)
    deployments = storage.list_deployments(service, None, environment)
    promotion_candidate = _promotion_candidate_for_service(service, environment, actor)
    if not deployments:
        return {
            "service": service,
            "environment": environment,
            "hasDeployments": False,
            "latest": None,
            "currentRunning": None,
            "promotionCandidate": promotion_candidate,
        }
    latest = deployments[0]
    latest_success_by_scope = _latest_success_by_scope(deployments)
    latest_success_id = latest_success_by_scope.get((service, environment), {}).get("id")
    payload = {
        "service": service,
        "environment": environment,
        "hasDeployments": True,
        "latest": {
            "id": latest.get("id"),
            "state": latest.get("state"),
            "version": latest.get("version"),
            "sourceEnvironment": latest.get("sourceEnvironment"),
            "recipeId": latest.get("recipeId"),
            "createdAt": latest.get("createdAt"),
            "updatedAt": latest.get("updatedAt"),
            "rollbackOf": latest.get("rollbackOf"),
            "deploymentKind": _deployment_kind(latest),
            "outcome": _deployment_outcome(
                latest,
                latest_success_id,
            ),
        },
        "currentRunning": _current_running_state(service, environment, deployments, latest_success_id),
        "promotionCandidate": promotion_candidate,
    }
    if actor.role == Role.PLATFORM_ADMIN:
        payload["latest"]["engineExecutionId"] = latest.get("spinnakerExecutionId")
        payload["latest"]["engineExecutionUrl"] = latest.get("spinnakerExecutionUrl")
    return payload


@app.get("/v1/services/{service}/running")
def get_service_running(
    service: str,
    request: Request,
    environment: str = Query(...),
    authorization: Optional[str] = Header(None),
):
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    service_entry = guardrails.validate_service(service)
    group, group_error = resolve_delivery_group(service, actor)
    if group_error:
        return group_error
    env_entry, env_error = resolve_environment_for_group(group, environment, actor)
    if env_error:
        return env_error
    try:
        guardrails.validate_environment(environment, service_entry, group)
    except PolicyError as exc:
        return _capability_error(exc.code, exc.message, actor)
    deployments = storage.list_deployments(service, None, environment)
    if not deployments:
        return None
    latest_success_id = _latest_success_by_scope(deployments).get((service, environment), {}).get("id")
    return _current_running_state(service, environment, deployments, latest_success_id)


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
def spinnaker_status(request: Request, authorization: Optional[str] = Header(None)):
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "view spinnaker status")
    if role_error:
        return role_error
    if spinnaker.mode != "http":
        return {"status": "DOWN", "error": f"Spinnaker mode is {spinnaker.mode}"}
    try:
        spinnaker.check_health()
        return {"status": "UP"}
    except Exception as exc:
        log_event("spinnaker_health_failed", outcome="FAILED", summary=redact_text(str(exc)))
        return {"status": "DOWN", "error": "Spinnaker health check failed"}


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
    deployments = storage.list_deployments(deployment.get("service"), None, deployment.get("environment"))
    latest_success_by_scope = _latest_success_by_scope(deployments)
    return _deployment_public_view(actor, deployment, latest_success_by_scope)


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
    payload = _ui_refresh_settings()
    payload["daily_deploy_quota"] = SETTINGS.daily_quota_deploy
    payload["daily_rollback_quota"] = SETTINGS.daily_quota_rollback
    return payload


@app.get("/v1/audit/events")
def list_audit_events(
    request: Request,
    event_type: Optional[str] = Query(None),
    delivery_group_id: Optional[str] = Query(None),
    start_time: Optional[str] = Query(None),
    end_time: Optional[str] = Query(None),
    limit: Optional[int] = Query(200),
    authorization: Optional[str] = Header(None),
):
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "view audit events")
    if role_error:
        return role_error
    if limit is None or limit < 1 or limit > 500:
        return error_response(400, "INVALID_REQUEST", "limit must be between 1 and 500")
    events = storage.list_audit_events(
        event_type=event_type,
        delivery_group_id=delivery_group_id,
        start_time=start_time,
        end_time=end_time,
        limit=limit,
    )
    return events


@app.post("/v1/admin/guardrails/validate")
def validate_guardrails(
    payload: dict,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "validate guardrails")
    if role_error:
        return role_error
    if not isinstance(payload, dict):
        return error_response(400, "INVALID_REQUEST", "Payload must be an object")
    if (
        "guardrails" in payload
        or "allowed_recipes" in payload
        or "services" in payload
        or "allowed_environments" in payload
    ):
        return _validate_guardrails_preview(payload)
    if (
        "spinnaker_application" in payload
        or "deploy_pipeline" in payload
        or "rollback_pipeline" in payload
        or "status" in payload
        or "id" in payload
        or "name" in payload
    ):
        return _validate_recipe_preview(payload)
    return error_response(400, "INVALID_REQUEST", "Payload must be a delivery group or recipe object")


@app.get("/v1/config/sanity")
def get_config_sanity(request: Request, authorization: Optional[str] = Header(None)):
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    oidc_ready = bool(SETTINGS.oidc_issuer and SETTINGS.oidc_audience and SETTINGS.oidc_roles_claim)
    jwks_ready = bool(SETTINGS.oidc_jwks_url or SETTINGS.oidc_issuer)
    return {
        "request_id": request_id_ctx.get(),
        "oidc_configured": bool(oidc_ready and jwks_ready),
        "spinnaker_configured": bool(SETTINGS.spinnaker_base_url),
        "artifact_discovery_configured": bool(SETTINGS.runtime_artifact_bucket),
    }


@app.get("/v1/insights/failures")
def get_failure_insights(
    request: Request,
    windowDays: Optional[int] = Query(7),
    groupId: Optional[str] = Query(None),
    service: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    if windowDays is None or windowDays < 1 or windowDays > 30:
        return error_response(400, "INVALID_REQUEST", "windowDays must be between 1 and 30")
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=windowDays)
    if service:
        guardrails.validate_service(service)
    deployments = storage.list_deployments(None, None)
    filtered = []
    for deployment in deployments:
        if service and deployment.get("service") != service:
            continue
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
def list_spinnaker_applications(
    request: Request,
    authorization: Optional[str] = Header(None),
    tagName: Optional[str] = Query(None),
    tagValue: Optional[str] = Query(None),
):
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "view engine mapping")
    if role_error:
        return role_error
    if spinnaker.mode != "http":
        return error_response(503, "ENGINE_UNAVAILABLE", "Spinnaker is not available in the current mode")
    try:
        apps = spinnaker.list_applications()
    except Exception as exc:
        return _engine_error_response(actor, "Unable to retrieve Spinnaker applications", exc)
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
def list_spinnaker_pipelines(
    application: str,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "view engine mapping")
    if role_error:
        return role_error
    if spinnaker.mode != "http":
        return error_response(503, "ENGINE_UNAVAILABLE", "Spinnaker is not available in the current mode")
    try:
        pipelines = spinnaker.list_pipeline_configs(application)
    except Exception as exc:
        return _engine_error_response(actor, "Unable to retrieve Spinnaker pipelines", exc)
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
    if deployment.get("rollbackOf") or deployment.get("deploymentKind") == "ROLLBACK":
        return error_response(400, "ROLLBACK_OF_ROLLBACK", "Cannot roll back a rollback deployment")

    group, group_error = resolve_delivery_group(deployment["service"], actor)
    if group_error:
        return group_error
    env_entry, env_error = resolve_environment_for_group(group, deployment["environment"], actor)
    if env_error:
        return env_error
    recipe_id = deployment.get("recipeId") or "default"
    policy_recipe_error = _policy_check_recipe_allowed(group, recipe_id, actor)
    if policy_recipe_error:
        return policy_recipe_error
    try:
        service_entry = guardrails.validate_service(deployment["service"])
        guardrails.validate_environment(deployment["environment"], service_entry, group)
    except PolicyError as exc:
        return _capability_error(exc.code, exc.message, actor)
    recipe_capability_error = _capability_check_recipe_service(service_entry, recipe_id, actor)
    if recipe_capability_error:
        return recipe_capability_error
    max_concurrent = _environment_guardrail_value(group, env_entry, "max_concurrent_deployments", 1)
    daily_rollback_quota = _environment_guardrail_value(group, env_entry, "daily_rollback_quota", SETTINGS.daily_quota_rollback)
    rate_limiter.check_mutate(
        actor.actor_id,
        "rollback",
        quota_scope=_quota_scope(group["id"], env_entry.get("name")),
        quota_limit=daily_rollback_quota,
    )
    cached = enforce_idempotency(request, idempotency_key)
    if cached:
        return cached
    guardrails.enforce_delivery_group_lock(group["id"], max_concurrent, env_entry.get("name"))

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
        return _engine_error_response(actor, "Unable to start rollback", exc)
    record = {
        "id": str(uuid.uuid4()),
        "service": deployment["service"],
        "environment": deployment["environment"],
        "version": prior["version"],
        "recipeId": deployment.get("recipeId") or "default",
        "recipeRevision": recipe.get("recipe_revision") if recipe else None,
        "effectiveBehaviorSummary": recipe.get("effective_behavior_summary") if recipe else None,
        "state": "IN_PROGRESS",
        "deploymentKind": "ROLLBACK",
        "outcome": None,
        "intentCorrelationId": idempotency_key,
        "supersededBy": None,
        "changeSummary": f"rollback of {deployment_id} to {prior['version']}",
        "rollbackOf": deployment_id,
        "createdAt": utc_now(),
        "updatedAt": utc_now(),
        "engine_type": (recipe.get("engine_type") if recipe else None) or EngineType.SPINNAKER.value,
        "spinnakerExecutionId": execution["executionId"],
        "spinnakerExecutionUrl": execution["executionUrl"],
        "deliveryGroupId": group["id"],
        "failures": [],
    }
    storage.insert_deployment(record, [])
    store_idempotency(request, idempotency_key, record, 201)
    _record_audit_event(
        actor,
        "ROLLBACK_SUBMIT",
        "Deployment",
        record["id"],
        AuditOutcome.SUCCESS,
        f"Rollback submitted for {deployment['service']}",
        delivery_group_id=group.get("id"),
        service_name=deployment["service"],
        environment=deployment["environment"],
    )
    return _deployment_public_view(actor, record)


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
