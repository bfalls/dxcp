import hashlib
import json
import logging
import os
import re
import sys
import time
import types
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import urlparse

from fastapi import FastAPI, Header, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.exceptions import HTTPException as FastAPIHTTPException, RequestValidationError
try:
    import boto3
    from botocore.config import Config as BotoConfig
    from botocore.exceptions import (
        BotoCoreError,
        ClientError,
        ConnectTimeoutError,
        EndpointConnectionError,
        NoCredentialsError,
        PartialCredentialsError,
        ReadTimeoutError,
    )
except Exception:  # pragma: no cover - optional dependency behavior in local environments
    boto3 = None
    BotoConfig = None
    BotoCoreError = Exception
    ClientError = Exception
    ConnectTimeoutError = Exception
    EndpointConnectionError = Exception
    NoCredentialsError = Exception
    PartialCredentialsError = Exception
    ReadTimeoutError = Exception

from auth import get_actor, get_actor_and_claims
from ci_publisher_matcher import match_ci_publisher
from config import SETTINGS
from idempotency import IdempotencyStore
from models import (
    Actor,
    AuditOutcome,
    BuildRegisterExistingRequest,
    BuildRegistration,
    CiPublisher,
    CiPublisherProvider,
    BuildUploadCapability,
    BuildUploadRequest,
    DeliveryGroup,
    DeliveryGroupUpsert,
    DeploymentIntent,
    Environment,
    EnvironmentLifecycleState,
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
from execution_plan import ServiceEnvironmentRoute, apply_execution_plan, execution_plan_from_recipe
from storage import ImmutableDeploymentError, build_storage, utc_now
from admin_system_routes import (
    register_admin_system_routes,
    read_mutations_disabled_with_fallback,
    read_ui_exposure_policy,
)


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
    auth0_domain=SETTINGS.spinnaker_auth0_domain,
    auth0_client_id=SETTINGS.spinnaker_auth0_client_id,
    auth0_client_secret=SETTINGS.spinnaker_auth0_client_secret,
    auth0_audience=SETTINGS.spinnaker_auth0_audience,
    auth0_scope=SETTINGS.spinnaker_auth0_scope,
    auth0_refresh_skew_seconds=SETTINGS.spinnaker_auth0_refresh_skew_seconds,
    mtls_cert_path=SETTINGS.spinnaker_mtls_cert_path,
    mtls_key_path=SETTINGS.spinnaker_mtls_key_path,
    mtls_ca_path=SETTINGS.spinnaker_mtls_ca_path,
    mtls_server_name=SETTINGS.spinnaker_mtls_server_name,
    request_id_provider=get_request_id,
)
logger = logging.getLogger("dxcp.api")
guardrails = Guardrails(storage)
artifact_source = None
_ENGINE_INVOKE_COUNTER = 0
IDEMPOTENCY_REPLAYED_HEADER = "Idempotency-Replayed"
IDEMPOTENCY_OBSERVABLE_PATHS = {
    "/v1/deployments",
    "/v1/builds/register",
    "/v1/builds",
    "/v1/builds/upload-capability",
    "/v1/promotions",
}
DEPLOYMENT_FINGERPRINT_FIELDS = (
    "service",
    "environment",
    "version",
    "changeSummary",
    "recipeId",
)
BUILD_REGISTER_FINGERPRINT_FIELDS = (
    "service",
    "version",
    "artifactRef",
    "git_sha",
    "git_branch",
    "ci_provider",
    "ci_run_id",
    "built_at",
    "sha256",
    "sizeBytes",
    "contentType",
    "repo",
    "commit_url",
    "run_url",
)
PROMOTION_FINGERPRINT_FIELDS = (
    "service",
    "source_environment",
    "target_environment",
    "version",
    "changeSummary",
)

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


def error_response(
    status_code: int,
    code: str,
    message: str,
    operator_hint: Optional[str] = None,
    details: Optional[dict] = None,
) -> JSONResponse:
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
    if details is not None:
        payload["details"] = details
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
    missing_fields: list[str] = []
    invalid_fields: list[str] = []
    for error in exc.errors():
        loc = error.get("loc") or ()
        err_type = error.get("type")
        if loc and loc[0] == "body" and len(loc) >= 2:
            field_name = str(loc[1])
            if err_type in {"missing", "value_error.missing"}:
                missing_fields.append(field_name)
            else:
                invalid_fields.append(field_name)
    if request.method == "POST" and request.url.path in {"/v1/builds", "/v1/builds/register"}:
        details = {
            "missing_fields": sorted(set(missing_fields)),
            "invalid_fields": sorted(set(invalid_fields)),
        }
        return error_response(
            400,
            "INVALID_BUILD_REGISTRATION",
            "Build registration request is invalid",
            details=details,
        )
    if request.method == "GET" and request.url.path == "/v1/builds":
        return error_response(400, "INVALID_REQUEST", "service and version are required")
    return error_response(400, "INVALID_REQUEST", "Invalid request")


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("request.unhandled_exception path=%s error=%s", request.url.path, str(exc))
    return error_response(500, "INTERNAL_ERROR", "Unexpected server error")


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


@app.middleware("http")
async def attach_idempotency_replayed_header(request: Request, call_next):
    response = await call_next(request)
    if request.method == "POST" and request.url.path in IDEMPOTENCY_OBSERVABLE_PATHS:
        replayed = getattr(request.state, "idempotency_replayed", None)
        if replayed is not None:
            response.headers[IDEMPOTENCY_REPLAYED_HEADER] = "true" if replayed else "false"
    return response


def require_role(actor: Actor, allowed: set[Role], action: str):
    if actor.role in allowed:
        return None
    return error_response(403, "ROLE_FORBIDDEN", f"Role {actor.role.value} cannot {action}")


def _coerce_ci_publishers(values: Any) -> list[CiPublisher]:
    publishers: list[CiPublisher] = []
    if not isinstance(values, list):
        return publishers
    for value in values:
        if isinstance(value, CiPublisher):
            publishers.append(value)
            continue
        if isinstance(value, dict):
            candidate = dict(value)
            if "provider" not in candidate:
                candidate["provider"] = CiPublisherProvider.CUSTOM.value
            try:
                publishers.append(CiPublisher(**candidate))
            except Exception:
                continue
            continue
        if isinstance(value, str):
            item = value.strip()
            if not item:
                continue
            publishers.append(
                CiPublisher(
                    name=item,
                    provider=CiPublisherProvider.CUSTOM,
                    subjects=[item],
                )
            )
    return publishers


def _read_ci_publishers_from_ssm() -> Optional[list[CiPublisher]]:
    prefix = (SETTINGS.ssm_prefix or "").strip().rstrip("/")
    if not prefix:
        return None
    if boto3 is None:
        return None
    try:
        if BotoConfig is not None:
            cfg = BotoConfig(connect_timeout=1, read_timeout=1, retries={"max_attempts": 1, "mode": "standard"})
            try:
                client = boto3.client("ssm", config=cfg)
            except TypeError:
                client = boto3.client("ssm")
        else:
            client = boto3.client("ssm")
        response = client.get_parameter(Name=f"{prefix}/ci_publishers", WithDecryption=True)
        raw = response.get("Parameter", {}).get("Value", "")
    except Exception:
        return None

    payload: Any = None
    try:
        payload = json.loads(raw)
    except Exception:
        payload = [item.strip() for item in str(raw).split(",") if item.strip()]
    publishers = _coerce_ci_publishers(payload)
    return publishers if publishers else None


def _configured_ci_publishers() -> list[CiPublisher]:
    publishers = _read_ci_publishers_from_ssm()
    if publishers is not None:
        return publishers
    return _coerce_ci_publishers(SETTINGS.ci_publishers)


def require_ci_publisher(claims: dict, action: str) -> tuple[Optional[str], Optional[JSONResponse]]:
    publishers = _configured_ci_publishers()
    publisher_name = match_ci_publisher(claims, publishers)
    if publisher_name:
        return publisher_name, None
    return None, error_response(403, "CI_ONLY", f"Only CI publisher identities can {action}")


def require_ci_role_and_publisher(
    actor: Actor,
    claims: dict,
    action: str,
) -> tuple[Optional[str], Optional[JSONResponse]]:
    if actor.role != Role.CI_PUBLISHER:
        return None, error_response(403, "CI_ONLY", f"Only CI publisher identities can {action}")
    return require_ci_publisher(claims, action)


def can_deploy(actor: Actor) -> bool:
    return actor.role in {Role.DELIVERY_OWNER, Role.PLATFORM_ADMIN}


def can_rollback(actor: Actor) -> bool:
    return actor.role in {Role.DELIVERY_OWNER, Role.PLATFORM_ADMIN}


def can_view(actor: Actor) -> bool:
    return actor.role in {Role.OBSERVER, Role.DELIVERY_OWNER, Role.PLATFORM_ADMIN}


register_admin_system_routes(
    app,
    get_actor=get_actor,
    get_actor_and_claims=get_actor_and_claims,
    guardrails=guardrails,
    request_id_provider=get_request_id,
    rate_limiter=rate_limiter,
    require_role=require_role,
    error_response=error_response,
    record_audit_event=lambda event: storage.insert_audit_event(event),
)


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
    group_id = group.get("id")
    if group_id:
        group = {
            **group,
            "environments": storage.list_delivery_group_environment_policy(group_id),
        }
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


def resolve_recipe_execution_plan(
    recipe_id: Optional[str],
    actor: Optional[Actor] = None,
) -> tuple[Optional[dict], Optional[dict], Optional[JSONResponse]]:
    recipe, recipe_error = resolve_recipe(recipe_id, actor)
    if recipe_error:
        return None, None, recipe_error
    return recipe, execution_plan_from_recipe(recipe), None


def resolve_service_environment_route(service: str, environment: str) -> Optional[dict]:
    route = storage.get_service_environment_routing(service, environment)
    if not route:
        return None
    typed_route = ServiceEnvironmentRoute(
        service_id=route["service_id"],
        environment_id=route["environment_id"],
        recipe_id=route["recipe_id"],
    )
    return {
        **route,
        "service_id": typed_route.service_id,
        "environment_id": typed_route.environment_id,
        "recipe_id": typed_route.recipe_id,
    }


def resolve_routed_execution_plan_for_service_environment(
    service: str,
    environment: str,
    actor: Optional[Actor] = None,
) -> tuple[Optional[dict], Optional[dict], Optional[dict], Optional[JSONResponse]]:
    route = resolve_service_environment_route(service, environment)
    if not route:
        return None, None, None, error_response(
            400,
            "SERVICE_ENVIRONMENT_NOT_ROUTED",
            "No recipe is routed for the service and target environment",
        )
    recipe, execution_plan, recipe_error = resolve_recipe_execution_plan(route.get("recipe_id"), actor)
    if recipe_error:
        return None, route, None, recipe_error
    return recipe, route, execution_plan, None


def resolve_routed_recipe_for_service_environment(
    service: str,
    environment: str,
    actor: Optional[Actor] = None,
) -> tuple[Optional[dict], Optional[dict], Optional[JSONResponse]]:
    recipe, route, _, recipe_error = resolve_routed_execution_plan_for_service_environment(service, environment, actor)
    if recipe_error:
        return None, route, recipe_error
    return recipe, route, None


def _validate_transitional_recipe_id(
    routed_recipe_id: str,
    requested_recipe_id: Optional[str],
) -> Optional[JSONResponse]:
    if not requested_recipe_id:
        return None
    if requested_recipe_id == routed_recipe_id:
        return None
    return error_response(
        400,
        "RECIPE_ID_MISMATCH",
        "recipeId does not match the routed recipe for the requested service and environment",
    )


def resolve_deployment_execution_selection(
    service: str,
    environment: str,
    requested_recipe_id: Optional[str],
    actor: Optional[Actor] = None,
) -> tuple[Optional[dict], Optional[dict], Optional[dict], Optional[JSONResponse]]:
    recipe, route, execution_plan, route_error = resolve_routed_execution_plan_for_service_environment(
        service,
        environment,
        actor,
    )
    if route_error:
        return None, None, None, route_error
    _ = requested_recipe_id
    return recipe, route, execution_plan, None


def resolve_environment_for_group(
    group: dict,
    environment: str,
    actor: Optional[Actor] = None,
) -> tuple[Optional[dict], Optional[JSONResponse]]:
    if not environment:
        return None, error_response(400, "ENVIRONMENT_REQUIRED", "environment is required")
    env_entry = storage.get_environment_for_group(environment, group.get("id"))
    if not env_entry:
        return None, _policy_denied(
            "ENVIRONMENT_NOT_ALLOWED",
            f"Environment {environment} not configured for delivery group {group.get('id')}",
            actor,
        )
    lifecycle_state = _normalize_environment_lifecycle_state(
        env_entry.get("lifecycle_state"),
        env_entry.get("is_enabled", True),
    )
    if lifecycle_state == EnvironmentLifecycleState.RETIRED.value:
        return None, _policy_denied(
            "ENVIRONMENT_RETIRED",
            f"Environment {environment} is retired for delivery group {group.get('id')}",
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


def _policy_snapshot_for_environment(
    group: dict,
    environment: Optional[dict],
    *,
    deploy_quota: Optional[dict] = None,
) -> dict:
    env_name = environment.get("name") if environment else None
    max_concurrent = _environment_guardrail_value(group, environment, "max_concurrent_deployments", 1)
    daily_deploy_quota = _environment_guardrail_value(group, environment, "daily_deploy_quota", SETTINGS.daily_quota_deploy)
    throttling = (
        rate_limiter.get_live_throttling_settings()
        if hasattr(rate_limiter, "get_live_throttling_settings")
        else {"daily_quota_build_register": SETTINGS.daily_quota_build_register}
    )
    active = storage.count_active_deployments_for_group(group["id"], env_name)
    quota = deploy_quota or rate_limiter.get_daily_remaining(
        _quota_scope(group["id"], env_name),
        "deploy",
        daily_deploy_quota,
    )
    return {
        "max_concurrent_deployments": max_concurrent,
        "current_concurrent_deployments": active,
        "daily_deploy_quota": daily_deploy_quota,
        "deployments_used": quota["used"],
        "deployments_remaining": quota["remaining"],
        "daily_quota_build_register": int(
            throttling.get("daily_quota_build_register", SETTINGS.daily_quota_build_register)
        ),
    }


def _environment_sort_key(environment: dict) -> tuple[int, str]:
    promotion_order = environment.get("promotion_order")
    if isinstance(promotion_order, int) and promotion_order > 0:
        return promotion_order, str(environment.get("name", ""))
    return 1_000_000, str(environment.get("name", ""))


def _group_environment_names(group: dict, enabled_only: bool = True) -> list[str]:
    ordered: list[str] = []
    for env in _group_environment_entries(group, include_disabled=not enabled_only):
        if enabled_only and not env.get("is_enabled", True):
            continue
        name = env.get("name")
        if isinstance(name, str) and name and name not in ordered:
            ordered.append(name)
    return ordered


def _group_environment_entries(group: dict, include_disabled: bool = True) -> list[dict]:
    group_id = group.get("id")
    if not group_id:
        return []
    bindings = group.get("environments")
    entries: list[dict] = []
    if isinstance(bindings, list) and bindings:
        for binding in sorted(
            bindings,
            key=lambda row: (
                row.get("order_index") if isinstance(row.get("order_index"), int) else 1_000_000,
                str(row.get("environment_id") or ""),
            ),
        ):
            env_id = binding.get("environment_id")
            if not isinstance(env_id, str) or not env_id:
                continue
            canonical = storage.get_environment(env_id)
            if not canonical:
                continue
            merged = {
                **canonical,
                "promotion_order": binding.get("order_index"),
                "delivery_group_id": group_id,
                "is_enabled": bool(canonical.get("is_enabled", True) and binding.get("is_enabled", True)),
            }
            if merged.get("lifecycle_state") == EnvironmentLifecycleState.RETIRED.value:
                merged["is_enabled"] = False
            if include_disabled or merged.get("is_enabled", True):
                entries.append(merged)
        if entries:
            return entries
    configured = group.get("allowed_environments")
    if not isinstance(configured, list):
        return entries
    for index, env_id in enumerate(configured, start=1):
        if not isinstance(env_id, str) or not env_id:
            continue
        canonical = storage.get_environment(env_id)
        if not canonical:
            continue
        merged = {**canonical, "promotion_order": index, "delivery_group_id": group_id}
        if merged.get("lifecycle_state") == EnvironmentLifecycleState.RETIRED.value:
            merged["is_enabled"] = False
        if include_disabled or merged.get("is_enabled", True):
            entries.append(merged)
    return entries


def _accessible_environments_for_actor(actor: Actor, include_disabled: bool = True) -> list[dict]:
    if actor.role == Role.PLATFORM_ADMIN:
        environments = storage.list_environments()
        if not include_disabled:
            environments = [env for env in environments if env.get("is_enabled", True)]
        environments.sort(key=_environment_sort_key)
        return environments
    deduped: dict[str, dict] = {}
    for group in _delivery_groups_for_actor(actor):
        scoped = _group_environment_entries(group, include_disabled=include_disabled)
        for env in scoped:
            env_id = env.get("id") or env.get("name")
            if not isinstance(env_id, str) or not env_id:
                continue
            current = deduped.get(env_id)
            if not current:
                deduped[env_id] = env
                continue
            current_enabled = bool(current.get("is_enabled", True))
            next_enabled = bool(env.get("is_enabled", True))
            if next_enabled and not current_enabled:
                deduped[env_id] = env
                continue
            current_order = current.get("promotion_order")
            next_order = env.get("promotion_order")
            if isinstance(next_order, int) and (
                not isinstance(current_order, int) or next_order < current_order
            ):
                deduped[env_id] = env
    environments = list(deduped.values())
    environments = [
        env
        for env in environments
        if env.get("lifecycle_state") != EnvironmentLifecycleState.RETIRED.value
    ]
    environments.sort(key=_environment_sort_key)
    return environments


def _promotion_environment_sequence(group: dict) -> list[str]:
    bound = group.get("environments")
    if isinstance(bound, list) and bound:
        ordered_bound = sorted(
            [
                row
                for row in bound
                if row.get("is_enabled", True)
                and isinstance(row.get("order_index"), int)
                and row.get("order_index") > 0
                and isinstance(row.get("environment_id"), str)
                and row.get("environment_id")
            ],
            key=lambda row: (row.get("order_index"), row.get("environment_id")),
        )
        sequence = [row.get("environment_id") for row in ordered_bound]
        if sequence:
            return sequence
    configured_from_environments = _group_environment_names(group, enabled_only=True)
    if configured_from_environments:
        return configured_from_environments
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
    recipe, routing, execution_plan, recipe_error = resolve_routed_execution_plan_for_service_environment(
        intent.service,
        intent.target_environment,
        actor,
    )
    if recipe_error:
        return None, recipe_error
    policy_recipe_error = _policy_check_recipe_allowed(group, execution_plan.recipe_id, actor)
    if policy_recipe_error:
        return None, policy_recipe_error
    try:
        service_entry = guardrails.validate_service(intent.service)
        guardrails.validate_environment(intent.source_environment, service_entry, group)
        guardrails.validate_environment(intent.target_environment, service_entry, group)
        guardrails.validate_version(intent.version)
    except PolicyError as exc:
        return None, _capability_error(exc.code, exc.message, actor)
    recipe_capability_error = _capability_check_recipe_service(service_entry, execution_plan.recipe_id, actor)
    if recipe_capability_error:
        return None, recipe_capability_error
    build = storage.find_latest_build(intent.service, intent.version)
    if not build:
        return None, error_response(
            400,
            "VERSION_NOT_FOUND",
            "Version is not registered in the build registry for this service",
        )
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
        "execution_plan": execution_plan,
        "routing": routing,
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
    routed_recipe, _, routed_recipe_error = resolve_routed_recipe_for_service_environment(
        service,
        target_environment,
        actor,
    )
    if routed_recipe_error:
        return {"eligible": False, "reason": _error_code_from_response(routed_recipe_error), "target_environment": target_environment}
    return {
        "eligible": True,
        "source_environment": source_environment,
        "target_environment": target_environment,
        "version": promotable.get("version"),
        "recipeId": routed_recipe.get("id"),
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
    actor_email = (actor.email or "").strip().lower()
    if not actor_email:
        logger.warning(
            "delivery_group_scope_missing_email actor_id=%s role=%s",
            actor.actor_id,
            actor.role.value,
        )
        return []
    return [group for group in storage.list_delivery_groups() if actor_email in _owner_emails(group.get("owner"))]


def _actor_can_read_deployment(actor: Actor, deployment: dict) -> bool:
    if actor.role == Role.PLATFORM_ADMIN:
        return True
    if actor.role == Role.OBSERVER:
        return True
    if actor.role != Role.DELIVERY_OWNER:
        return False
    actor_email = (actor.email or "").strip().lower()
    if not actor_email:
        return False
    delivery_group_id = deployment.get("deliveryGroupId")
    group: Optional[dict] = None
    if isinstance(delivery_group_id, str) and delivery_group_id:
        group = storage.get_delivery_group(delivery_group_id)
    if not group:
        service_name = deployment.get("service")
        if isinstance(service_name, str) and service_name:
            group = storage.get_delivery_group_for_service(service_name)
    if not group:
        return False
    return actor_email in _owner_emails(group.get("owner"))


def _owner_emails(owner_value: Any) -> list[str]:
    values: list[str] = []
    if isinstance(owner_value, str):
        values = owner_value.split(",")
    elif isinstance(owner_value, list):
        for item in owner_value:
            if isinstance(item, str):
                values.extend(item.split(","))
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values:
        email = value.strip().lower()
        if not email or email in seen:
            continue
        seen.add(email)
        normalized.append(email)
    return normalized


def _is_email_like(value: str) -> bool:
    if "@" not in value:
        return False
    local, _, domain = value.partition("@")
    if not local or not domain:
        return False
    return "." in domain


def _normalize_owner_value(owner_value: Any) -> Optional[str]:
    emails = _owner_emails(owner_value)
    if not emails:
        return None
    invalid = [email for email in emails if not _is_email_like(email)]
    if invalid:
        raise ValueError("Owner must be one or more email addresses separated by commas.")
    return ", ".join(emails)


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
        seen_envs: set[str] = set()
        normalized_envs: list[str] = []
        for env in allowed_envs:
            if not isinstance(env, str) or not env.strip():
                return error_response(400, "INVALID_ENVIRONMENTS", "allowed_environments must be a list of strings")
            normalized = env.strip()
            if normalized in seen_envs:
                return error_response(400, "INVALID_ENVIRONMENTS", "allowed_environments must not contain duplicates")
            seen_envs.add(normalized)
            normalized_envs.append(normalized)
        group["allowed_environments"] = normalized_envs
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
    try:
        group["owner"] = _normalize_owner_value(group.get("owner"))
    except ValueError as exc:
        return error_response(400, "INVALID_OWNER", str(exc))
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
        "RECIPE_ID_MISMATCH",
        "ENVIRONMENT_TYPE_LOCKED",
        "ENVIRONMENT_DELETE_BLOCKED_REFERENCED",
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
        "INVALID_BUILD_REGISTRATION",
        "BUILD_REGISTRATION_CONFLICT",
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
        "ARTIFACT_NOT_FOUND",
        "ENGINE_MISCONFIGURED",
        "SERVICE_NOT_ALLOWLISTED",
        "SERVICE_NOT_IN_DELIVERY_GROUP",
          "ENVIRONMENT_NOT_ALLOWED",
          "ENVIRONMENT_DISABLED",
          "ENVIRONMENT_RETIRED",
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
        "RECIPE_IN_USE",
    }
    if error_code in user_error_codes:
        return "USER_ERROR"
    if error_code in policy_change_codes:
        return "POLICY_CHANGE"
    return "UNKNOWN"


def _include_operator_hint(actor: Actor) -> bool:
    return actor.role == Role.PLATFORM_ADMIN or SETTINGS.demo_mode


def _artifact_preflight_timeout_seconds() -> int:
    raw_value = os.getenv("DXCP_ARTIFACT_PREFLIGHT_TIMEOUT_SECONDS", "2")
    try:
        parsed = int(raw_value)
    except ValueError:
        return 2
    return max(1, min(parsed, 5))


def _check_s3_artifact_availability(bucket: str, key: str) -> str:
    # In local/test environments with real boto3 credentials available, probing
    # arbitrary artifact refs can create nondeterministic behavior. If no runtime
    # artifact bucket is configured, skip real boto3 preflight checks.
    if not SETTINGS.runtime_artifact_bucket and isinstance(boto3, types.ModuleType):
        return "skip"
    if boto3 is None or BotoConfig is None:
        return "skip"
    timeout_seconds = _artifact_preflight_timeout_seconds()
    try:
        client = boto3.client(
            "s3",
            config=BotoConfig(
                connect_timeout=timeout_seconds,
                read_timeout=timeout_seconds,
                retries={"max_attempts": 1},
            ),
        )
        client.head_object(Bucket=bucket, Key=key)
        return "found"
    except (NoCredentialsError, PartialCredentialsError, ConnectTimeoutError, ReadTimeoutError, EndpointConnectionError):
        return "skip"
    except ClientError as exc:
        response = getattr(exc, "response", {}) or {}
        error_code = str(response.get("Error", {}).get("Code") or "").strip()
        http_status = response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        if http_status == 404 or error_code in {"404", "NoSuchKey", "NotFound", "NoSuchVersion"}:
            return "not_found"
        if http_status == 403 or error_code in {"403", "AccessDenied"}:
            return "forbidden"
        return "skip"
    except BotoCoreError:
        return "skip"
    except Exception:
        return "skip"


def _preflight_artifact_availability(build: Optional[dict], actor: Actor) -> Optional[JSONResponse]:
    if not isinstance(build, dict):
        return None
    artifact_ref = build.get("artifactRef")
    if not isinstance(artifact_ref, str) or not artifact_ref.strip():
        return None
    try:
        bucket, key = parse_s3_artifact_ref(artifact_ref, SETTINGS.artifact_ref_schemes)
    except ValueError:
        return None
    check_result = _check_s3_artifact_availability(bucket, key)
    if check_result == "found" or check_result == "skip":
        return None
    if check_result == "not_found":
        operator_hint = None
        if _include_operator_hint(actor):
            operator_hint = "If using demo artifact retention, older artifacts may expire."
        return error_response(
            409,
            "ARTIFACT_NOT_FOUND",
            "Artifact is no longer available in the artifact store. Rebuild and publish again, then deploy the new version.",
            operator_hint=operator_hint,
        )
    if check_result == "forbidden":
        operator_hint = None
        if _include_operator_hint(actor):
            operator_hint = "Artifact preflight could not confirm access. Verify artifact store permissions."
        return error_response(
            409,
            "ARTIFACT_NOT_FOUND",
            "Artifact is not available",
            operator_hint=operator_hint,
        )
    return None


def _classify_engine_error(message: str) -> tuple[str, int]:
    lowered = (message or "").lower()
    artifact_context = (
        "artifact" in lowered
        or "object" in lowered
        or "bucket" in lowered
        or "key" in lowered
        or "s3" in lowered
    )
    artifact_missing = (
        "nosuchkey" in lowered
        or "not found" in lowered
        or "does not exist" in lowered
        or "missing object" in lowered
    )
    artifact_denied = (
        "access denied" in lowered
        or "accessdenied" in lowered
        or "forbidden" in lowered
    )
    if (
        ("http 404" in lowered and (artifact_context or artifact_missing))
        or ("http 403" in lowered and artifact_context and artifact_denied)
        or (artifact_context and artifact_missing)
    ):
        return "ARTIFACT_NOT_FOUND", 409
    if "timeout" in lowered or "timed out" in lowered:
        return "ENGINE_TIMEOUT", 504
    if "redirect blocked" in lowered or "http 301" in lowered or "http 302" in lowered:
        return "ENGINE_MISCONFIGURED", 502
    if "http 401" in lowered or "http 403" in lowered:
        return "ENGINE_UNAUTHORIZED", 502
    if "connection failed" in lowered or "base url is required" in lowered or "stub mode" in lowered:
        return "ENGINE_UNAVAILABLE", 503
    return "ENGINE_CALL_FAILED", 502


def _extract_upstream_status(message: str) -> Optional[int]:
    match = re.search(r"\bhttp\s+(\d{3})\b", message or "", flags=re.IGNORECASE)
    if not match:
        return None
    try:
        return int(match.group(1))
    except ValueError:
        return None


def _extract_redirect_field(message: str, field_name: str) -> Optional[str]:
    if not message:
        return None
    match = re.search(rf"\b{re.escape(field_name)}=([^;]+)", message)
    if not match:
        return None
    value = match.group(1).strip()
    return value or None


def _engine_host() -> str:
    base = (SETTINGS.spinnaker_base_url or "").strip()
    if not base:
        return ""
    parsed = urlparse(base)
    return parsed.hostname or ""


def _engine_unavailable_discriminator(code: str, raw_message: str, upstream_status: Optional[int]) -> bool:
    if code in {"ENGINE_UNAVAILABLE", "ENGINE_TIMEOUT"}:
        return True
    lowered = (raw_message or "").lower()
    if "connection failed" in lowered or "base url is required" in lowered or "stub mode" in lowered:
        return True
    if "timeout" in lowered or "timed out" in lowered:
        return True
    if code == "ENGINE_CALL_FAILED" and upstream_status is not None and upstream_status >= 500:
        return True
    return False


def _is_test_mode() -> bool:
    return os.getenv("DXCP_TEST_MODE", "").strip() == "1"


def _reset_engine_invocation_counter() -> None:
    global _ENGINE_INVOKE_COUNTER
    _ENGINE_INVOKE_COUNTER = 0


def _get_engine_invocation_counter() -> int:
    if not _is_test_mode():
        return 0
    return _ENGINE_INVOKE_COUNTER


def _invoke_engine(
    kind: str,
    payload: dict,
    idempotency_key: str,
    user_bearer_token: Optional[str] = None,
    user_principal: Optional[str] = None,
) -> dict:
    global _ENGINE_INVOKE_COUNTER
    if _is_test_mode():
        _ENGINE_INVOKE_COUNTER += 1
    if kind == "deploy":
        return _call_gate_with_user_token(
            spinnaker.trigger_deploy,
            payload,
            idempotency_key,
            user_bearer_token=user_bearer_token,
            user_principal=user_principal,
        )
    if kind == "rollback":
        return _call_gate_with_user_token(
            spinnaker.trigger_rollback,
            payload,
            idempotency_key,
            user_bearer_token=user_bearer_token,
            user_principal=user_principal,
        )
    raise ValueError(f"Unsupported engine invocation kind: {kind}")


def _extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    parts = authorization.split(" ")
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1].strip()
    return token or None


def _derive_gate_user_from_claims(claims: dict) -> Optional[str]:
    if not isinstance(claims, dict):
        return None
    custom_email = claims.get("https://dxcp.example/claims/email")
    if isinstance(custom_email, str) and custom_email.strip():
        return custom_email.strip().lower()
    email = claims.get("email")
    if isinstance(email, str) and email.strip():
        return email.strip().lower()
    sub = claims.get("sub")
    if isinstance(sub, str) and sub.strip():
        return sub.strip()
    return None


def _call_gate_with_user_token(
    callable_obj,
    *args,
    user_bearer_token: Optional[str] = None,
    user_principal: Optional[str] = None,
    **kwargs,
):
    call_variants: list[dict[str, Optional[str]]] = []
    if user_bearer_token is not None or user_principal is not None:
        call_variants.append(
            {
                "user_bearer_token": user_bearer_token,
                "user_principal": user_principal,
            }
        )
    if user_principal is not None:
        call_variants.append({"user_principal": user_principal})
    if user_bearer_token is not None:
        call_variants.append({"user_bearer_token": user_bearer_token})
    call_variants.append({})

    last_type_error: Optional[TypeError] = None
    for variant in call_variants:
        try:
            return callable_obj(*args, **variant, **kwargs)
        except TypeError as exc:
            message = str(exc)
            if "unexpected keyword argument" not in message:
                raise
            if "user_bearer_token" not in message and "user_principal" not in message:
                raise
            last_type_error = exc
            continue
    if last_type_error:
        raise last_type_error
    return callable_obj(*args, **kwargs)


def _preflight_engine_readiness(
    actor: Actor,
    user_bearer_token: Optional[str] = None,
    user_principal: Optional[str] = None,
) -> Optional[JSONResponse]:
    if spinnaker.mode != "http":
        return None
    if not SETTINGS.spinnaker_base_url:
        return None
    last_exc: Optional[Exception] = None
    # Allow brief engine restarts/port-forward churn without failing validation immediately.
    for wait_seconds in (0.0, 0.5, 1.0, 2.0):
        if wait_seconds > 0:
            time.sleep(wait_seconds)
        try:
            _call_gate_with_user_token(
                spinnaker.check_health,
                timeout_seconds=2.0,
                user_bearer_token=user_bearer_token,
                user_principal=user_principal,
            )
            return None
        except Exception as exc:
            last_exc = exc
    if last_exc is not None:
        return _engine_error_response(actor, "Unable to validate deployment", last_exc)
    return None


def _engine_error_response(actor: Actor, user_message: str, exc: Exception) -> JSONResponse:
    raw_message = str(exc) if exc else ""
    redacted = redact_text(raw_message)
    code, status = _classify_engine_error(raw_message)
    upstream_status = _extract_upstream_status(raw_message)
    engine_unavailable = _engine_unavailable_discriminator(code, raw_message, upstream_status)
    response_message = user_message
    operator_hint = None
    request_id = request_id_ctx.get() or str(uuid.uuid4())
    if code == "ARTIFACT_NOT_FOUND":
        response_message = (
            "Artifact is no longer available in the artifact store. "
            "Rebuild and publish again, then deploy the new version."
        )
        if _include_operator_hint(actor):
            operator_hint = "If using demo artifact retention, older artifacts may expire."
    elif code == "ENGINE_MISCONFIGURED" and _include_operator_hint(actor):
        redirect_location = _extract_redirect_field(raw_message, "location") or "unknown"
        gate_base_url = _extract_redirect_field(raw_message, "gate_base_url") or (SETTINGS.spinnaker_base_url or "unknown")
        request_path = _extract_redirect_field(raw_message, "request_path") or "unknown"
        upstream_request_id = _extract_redirect_field(raw_message, "requestId") or "unknown"
        operator_hint = (
            "upstream_status="
            f"{upstream_status if upstream_status is not None else 'unknown'}; "
            f"location={redirect_location}; gate_base_url={gate_base_url}; "
            f"request_path={request_path}; upstream_request_id={upstream_request_id}"
        )
    elif _include_operator_hint(actor) and redacted:
        operator_hint = redacted
    details = {
        "engine_unavailable": engine_unavailable,
    }
    if engine_unavailable:
        diagnostics = {
            "upstream_status": upstream_status,
            "engine": "spinnaker",
            "request_id": request_id,
        }
        if actor.role == Role.PLATFORM_ADMIN:
            diagnostics["engine_host"] = _engine_host()
        details["diagnostics"] = diagnostics
        logger.warning(
            "engine.unavailable request_id=%s engine=spinnaker engine_host=%s upstream_status=%s",
            request_id,
            _engine_host(),
            upstream_status if upstream_status is not None else "unknown",
        )
    log_event(
        "engine_error",
        outcome="FAILED",
        summary=redacted or "none",
        error_code=code,
        status_code=status,
    )
    payload = {
        "code": code,
        "error_code": code,
        "failure_cause": classify_failure_cause(code),
        "message": response_message,
        "request_id": request_id,
        "details": details,
    }
    if operator_hint:
        payload["operator_hint"] = operator_hint
    return JSONResponse(status_code=status, content=payload)


def _extract_engine_execution(execution: object) -> tuple[Optional[str], Optional[str]]:
    if not isinstance(execution, dict):
        return None, None
    execution_id = execution.get("executionId")
    execution_url = execution.get("executionUrl")
    if not isinstance(execution_id, str) or not execution_id.strip():
        return None, None
    if not isinstance(execution_url, str) or not execution_url.strip():
        return None, None
    return execution_id.strip(), execution_url.strip()


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


ENVIRONMENT_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def _require_admin_read(actor: Actor, action: str) -> Optional[JSONResponse]:
    return require_role(actor, {Role.PLATFORM_ADMIN}, action)


def _validate_admin_environment_id(environment_id: str) -> Optional[JSONResponse]:
    if not isinstance(environment_id, str) or not ENVIRONMENT_ID_RE.fullmatch(environment_id.strip()):
        return error_response(
            400,
            "INVALID_ENVIRONMENT_ID",
            "environment_id must match ^[a-z0-9]+(?:-[a-z0-9]+)*$",
        )
    return None


def _validate_environment_type(value: Any) -> Optional[JSONResponse]:
    if value not in {"non_prod", "prod"}:
        return error_response(400, "INVALID_ENVIRONMENT_TYPE", "type must be one of: non_prod, prod")
    return None


def _normalize_environment_lifecycle_state(
    lifecycle_state: Optional[str],
    is_enabled: Optional[bool],
) -> str:
    value = str(lifecycle_state or "").strip().lower()
    if value in {
        EnvironmentLifecycleState.ACTIVE.value,
        EnvironmentLifecycleState.DISABLED.value,
        EnvironmentLifecycleState.RETIRED.value,
    }:
        return value
    return (
        EnvironmentLifecycleState.ACTIVE.value
        if is_enabled is not False
        else EnvironmentLifecycleState.DISABLED.value
    )


def _lifecycle_state_from_payload(payload: dict, existing: Optional[dict] = None) -> tuple[Optional[str], Optional[JSONResponse]]:
    requested_state = payload.get("lifecycle_state")
    requested_enabled = payload.get("is_enabled")
    if requested_state is not None:
        normalized = str(requested_state).strip().lower()
        if normalized not in {
            EnvironmentLifecycleState.ACTIVE.value,
            EnvironmentLifecycleState.DISABLED.value,
            EnvironmentLifecycleState.RETIRED.value,
        }:
            return None, error_response(
                400,
                "INVALID_ENVIRONMENT_LIFECYCLE_STATE",
                "lifecycle_state must be one of: active, disabled, retired",
            )
        return normalized, None
    if "is_enabled" in payload:
        if not isinstance(requested_enabled, bool):
            return None, error_response(400, "INVALID_REQUEST", "is_enabled must be a boolean")
        if requested_enabled:
            return EnvironmentLifecycleState.ACTIVE.value, None
        if existing and str(existing.get("lifecycle_state") or "").lower() == EnvironmentLifecycleState.RETIRED.value:
            return EnvironmentLifecycleState.RETIRED.value, None
        return EnvironmentLifecycleState.DISABLED.value, None
    existing_state = _normalize_environment_lifecycle_state(
        existing.get("lifecycle_state") if existing else None,
        existing.get("is_enabled") if existing else True,
    )
    return existing_state, None


def _environment_delete_blocked_response(environment_id: str, references: dict) -> JSONResponse:
    detail_rows = []
    deployment_references = references.get("deployments") or []
    if deployment_references:
        detail_rows.append(
            {
                "reference_type": "deployments",
                "count": len(deployment_references),
                "examples": deployment_references[:5],
                "message": "Historical deployment records still reference this environment.",
            }
        )
    routing_references = references.get("service_environment_routing") or []
    if routing_references:
        detail_rows.append(
            {
                "reference_type": "service_environment_routing",
                "count": len(routing_references),
                "examples": routing_references[:5],
                "message": "Service-environment routing still targets this environment.",
            }
        )
    binding_references = references.get("delivery_group_environment_policy") or []
    if binding_references:
        detail_rows.append(
            {
                "reference_type": "delivery_group_environment_policy",
                "count": len(binding_references),
                "examples": binding_references[:5],
                "message": "Delivery-group environment policy still attaches this environment.",
            }
        )
    allowlist_references = references.get("delivery_group_allowed_environments") or []
    if allowlist_references:
        detail_rows.append(
            {
                "reference_type": "delivery_group_allowed_environments",
                "count": len(allowlist_references),
                "examples": allowlist_references[:5],
                "message": "Delivery-group policy still lists this environment as an allowed target.",
            }
        )
    return error_response(
        409,
        "ENVIRONMENT_DELETE_BLOCKED_REFERENCED",
        "Environment deletion is blocked because DXCP still has references to this environment. Retire it to remove it from new deploy use while preserving history and auditability.",
        details={
            "environment_id": environment_id,
            "retire_instead": True,
            "references": detail_rows,
        },
    )


def _apply_recipe_mapping(payload: dict, recipe: dict) -> None:
    resolved = apply_execution_plan(payload, execution_plan_from_recipe(recipe), "deploy")
    payload.clear()
    payload.update(resolved)


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


def _recipe_in_use_response(recipe_id: str, reference_type: str, references: list[dict]) -> JSONResponse:
    details = {
        "recipe_id": recipe_id,
        "reference_type": reference_type,
        "reference_count": len(references),
    }
    if reference_type == "service_environment_routing":
        details["references"] = [
            {
                "service_id": reference.get("service_id"),
                "environment_id": reference.get("environment_id"),
            }
            for reference in references[:5]
        ]
    elif reference_type == "delivery_group_allowed_recipes":
        details["references"] = [
            {
                "delivery_group_id": reference.get("id"),
            }
            for reference in references[:5]
        ]
    return error_response(
        409,
        "RECIPE_IN_USE",
        f"Recipe {recipe_id} is still referenced by {reference_type}",
        details=details,
    )


def _normalize_fingerprint_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, str):
        return " ".join(value.split())
    if isinstance(value, list):
        return [_normalize_fingerprint_value(item) for item in value]
    if isinstance(value, dict):
        return {
            key: _normalize_fingerprint_value(value[key])
            for key in sorted(value.keys())
        }
    return value


def _build_register_request_fingerprint(req: BuildRegisterExistingRequest) -> str:
    try:
        canonical_built_at = _normalize_timestamp(req.built_at)
    except ValueError:
        canonical_built_at = _normalize_fingerprint_value(req.built_at)
    payload = {
        "service": req.service,
        "version": req.version,
        "artifactRef": req.artifactRef,
        "git_sha": req.git_sha,
        "git_branch": req.git_branch,
        "ci_provider": req.ci_provider,
        "ci_run_id": req.ci_run_id,
        "built_at": canonical_built_at,
        "sha256": getattr(req, "sha256", None),
        "sizeBytes": getattr(req, "sizeBytes", None),
        "contentType": getattr(req, "contentType", None),
        "repo": req.repo,
        "commit_url": req.commit_url,
        "run_url": req.run_url,
    }
    normalized_payload = {
        field: _normalize_fingerprint_value(payload.get(field))
        for field in BUILD_REGISTER_FINGERPRINT_FIELDS
    }
    canonical_json = json.dumps(normalized_payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


def _promotion_request_fingerprint(intent: PromotionIntent) -> str:
    payload = intent.dict()
    normalized_payload = {
        field: _normalize_fingerprint_value(payload.get(field))
        for field in PROMOTION_FINGERPRINT_FIELDS
    }
    canonical_json = json.dumps(normalized_payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


def _deployment_request_fingerprint(intent: DeploymentIntent) -> str:
    payload = intent.dict()
    normalized_payload = {
        field: _normalize_fingerprint_value(payload.get(field))
        for field in DEPLOYMENT_FINGERPRINT_FIELDS
    }
    canonical_json = json.dumps(normalized_payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


def _deployment_actor_identity(actor: Actor, claims: dict) -> dict:
    return {
        "actorId": actor.actor_id,
        "role": actor.role.value,
        "email": claims.get("email") or claims.get("https://dxcp.example/claims/email") or actor.email,
        "sub": claims.get("sub"),
        "azp": claims.get("azp"),
    }


def enforce_idempotency(
    request: Request,
    idempotency_key: str,
    request_fingerprint: Optional[str] = None,
    conflict_code: str = "IDEMPOTENCY_CONFLICT",
    conflict_message: str = "Conflicting request body for idempotency key",
):
    key = f"{idempotency_key}:{request.method}:{request.url.path}"
    cached = idempotency.get(key)
    if cached:
        cached_fingerprint = cached.get("request_fingerprint")
        if (
            request_fingerprint is not None
            and cached_fingerprint is not None
            and request_fingerprint != cached_fingerprint
        ):
            return error_response(409, conflict_code, conflict_message)
        if request.method == "POST" and request.url.path in IDEMPOTENCY_OBSERVABLE_PATHS:
            request.state.idempotency_replayed = True
        return JSONResponse(status_code=cached["status_code"], content=cached["response"])
    return None


def store_idempotency(
    request: Request,
    idempotency_key: str,
    response: dict,
    status_code: int,
    request_fingerprint: Optional[str] = None,
) -> None:
    if request.method == "POST" and request.url.path in IDEMPOTENCY_OBSERVABLE_PATHS:
        request.state.idempotency_replayed = False
    key = f"{idempotency_key}:{request.method}:{request.url.path}"
    idempotency.set(key, response, status_code, request_fingerprint=request_fingerprint)


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


def refresh_from_spinnaker(
    deployment: dict,
    user_bearer_token: Optional[str] = None,
    user_principal: Optional[str] = None,
) -> dict:
    try:
        execution = _call_gate_with_user_token(
            spinnaker.get_execution,
            deployment["spinnakerExecutionId"],
            user_bearer_token=user_bearer_token,
            user_principal=user_principal,
        )
    except Exception as exc:
        logger.warning("engine.refresh_failed deployment_id=%s error=%s", deployment.get("id"), redact_text(str(exc)))
        return deployment
    state = execution.get("state")
    if state in ["PENDING", "ACTIVE", "IN_PROGRESS", "SUCCEEDED", "FAILED", "CANCELED", "ROLLED_BACK"]:
        failures = normalize_failures(execution.get("failures"))
        outcome = base_outcome_from_state(state)
        try:
            storage.update_deployment(deployment["id"], state, failures, outcome=outcome)
        except ImmutableDeploymentError as exc:
            logger.warning(
                "deployment.immutable_blocked deployment_id=%s state=%s error=%s",
                deployment.get("id"),
                state,
                redact_text(str(exc)),
            )
            return deployment
        deployment = storage.get_deployment(deployment["id"]) or deployment
        if state == "SUCCEEDED":
            storage.apply_supersession(deployment)
    return deployment


def _deployment_lock_stale_seconds() -> int:
    raw_value = os.getenv("DXCP_DEPLOYMENT_LOCK_STALE_SECONDS", "900")
    try:
        parsed = int(raw_value)
    except (TypeError, ValueError):
        return 900
    return parsed if parsed > 0 else 900


def _active_deployments_for_group(group_id: str, environment: Optional[str]) -> list[dict]:
    deployments = storage.list_deployments(None, None, environment)
    return [
        item
        for item in deployments
        if item.get("deliveryGroupId") == group_id and item.get("state") in {"ACTIVE", "IN_PROGRESS"}
    ]


def _reap_stale_group_locks(
    group_id: str,
    environment: Optional[str],
    user_bearer_token: Optional[str] = None,
    user_principal: Optional[str] = None,
) -> None:
    stale_seconds = _deployment_lock_stale_seconds()
    now = datetime.now(timezone.utc)
    for deployment in _active_deployments_for_group(group_id, environment):
        refreshed = refresh_from_spinnaker(
            deployment,
            user_bearer_token=user_bearer_token,
            user_principal=user_principal,
        )
        # Only reap stale in-progress locks. Active deployments can be legitimately long-running
        # and should continue to enforce concurrency limits.
        if refreshed.get("state") != "IN_PROGRESS":
            continue
        reference_time = _parse_iso(refreshed.get("updatedAt")) or _parse_iso(refreshed.get("createdAt"))
        if not reference_time:
            continue
        age_seconds = (now - reference_time).total_seconds()
        if age_seconds < stale_seconds:
            continue
        storage.update_deployment(
            refreshed["id"],
            "FAILED",
            [
                {
                    "category": "INFRASTRUCTURE",
                    "summary": "Deployment lock expired due to stale in-progress state.",
                    "detail": "No terminal engine status was observed before lock timeout.",
                    "actionHint": "Review engine health, then retry deployment.",
                    "observedAt": utc_now(),
                }
            ],
            outcome=base_outcome_from_state("FAILED"),
        )
        logger.warning(
            "deployment.lock_reaped deployment_id=%s group_id=%s environment=%s stale_seconds=%s",
            refreshed.get("id"),
            group_id,
            environment or "",
            stale_seconds,
        )


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


def _normalize_timestamp(value: str) -> str:
    candidate = str(value).strip()
    if candidate.endswith("Z"):
        candidate = f"{candidate[:-1]}+00:00"
    parsed = datetime.fromisoformat(candidate)
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _build_registration_conflict(existing: dict, artifact_ref: str, git_sha: str) -> Optional[JSONResponse]:
    existing_artifact_ref = existing.get("artifactRef")
    existing_git_sha = existing.get("git_sha")
    if existing_artifact_ref == artifact_ref and existing_git_sha == git_sha:
        return None
    return error_response(
        409,
        "BUILD_REGISTRATION_CONFLICT",
        "Conflicting build registration for service/version",
        details={
            "service": existing.get("service"),
            "version": existing.get("version"),
            "existing_artifactRef": existing_artifact_ref,
            "existing_git_sha": existing_git_sha,
        },
    )


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
    kill_switch = read_mutations_disabled_with_fallback()
    mutations_disabled = bool(kill_switch.get("mutations_disabled", SETTINGS.mutations_disabled))
    SETTINGS.mutations_disabled = mutations_disabled
    SETTINGS.kill_switch = mutations_disabled
    return {
        "default_refresh_interval_seconds": int(default_value),
        "min_refresh_interval_seconds": int(min_value),
        "max_refresh_interval_seconds": int(max_value),
        "mutations_disabled": mutations_disabled,
    }


ENGINE_ADAPTER_MODES = {"http", "mtls", "stub"}


def _engine_adapter_source_label() -> str:
    return "ssm" if (SETTINGS.ssm_prefix or "").strip() else "runtime"


def _engine_config_from_settings() -> dict:
    return {
        "mode": str(SETTINGS.spinnaker_mode or "http").strip().lower() or "http",
        "gate_url": SETTINGS.spinnaker_base_url or "",
        "gate_header_name": SETTINGS.spinnaker_header_name or "",
        "gate_header_value_configured": bool(SETTINGS.spinnaker_header_value),
        "auth0_domain": SETTINGS.spinnaker_auth0_domain or "",
        "auth0_client_id": SETTINGS.spinnaker_auth0_client_id or "",
        "auth0_client_secret_configured": bool(SETTINGS.spinnaker_auth0_client_secret),
        "auth0_audience": SETTINGS.spinnaker_auth0_audience or "",
        "auth0_scope": SETTINGS.spinnaker_auth0_scope or "",
        "auth0_refresh_skew_seconds": int(SETTINGS.spinnaker_auth0_refresh_skew_seconds or 0),
        "mtls_cert_path": SETTINGS.spinnaker_mtls_cert_path or "",
        "mtls_key_path": SETTINGS.spinnaker_mtls_key_path or "",
        "mtls_ca_path": SETTINGS.spinnaker_mtls_ca_path or "",
        "mtls_server_name": SETTINGS.spinnaker_mtls_server_name or "",
        "engine_lambda_url": SETTINGS.engine_lambda_url or "",
        "engine_lambda_token_configured": bool(SETTINGS.engine_lambda_token),
    }


def _read_engine_config_from_ssm() -> Optional[dict]:
    prefix = (SETTINGS.ssm_prefix or "").strip().rstrip("/")
    if not prefix or boto3 is None:
        return None
    if BotoConfig is not None:
        cfg = BotoConfig(connect_timeout=1, read_timeout=1, retries={"max_attempts": 1, "mode": "standard"})
        try:
            client = boto3.client("ssm", config=cfg)
        except TypeError:
            client = boto3.client("ssm")
    else:
        client = boto3.client("ssm")

    def _get_value(name: str) -> Optional[str]:
        try:
            response = client.get_parameter(Name=f"{prefix}/{name}", WithDecryption=True)
        except Exception:
            return None
        value = response.get("Parameter", {}).get("Value")
        if value is None:
            return None
        return str(value)

    refresh_skew_raw = _get_value("spinnaker/auth0_refresh_skew_seconds")
    try:
        refresh_skew = int(refresh_skew_raw) if refresh_skew_raw not in (None, "") else int(SETTINGS.spinnaker_auth0_refresh_skew_seconds or 0)
    except Exception:
        refresh_skew = int(SETTINGS.spinnaker_auth0_refresh_skew_seconds or 0)

    return {
        "mode": (_get_value("spinnaker/mode") or str(SETTINGS.spinnaker_mode or "http")).strip().lower() or "http",
        "gate_url": _get_value("spinnaker/gate_url") or "",
        "gate_header_name": _get_value("spinnaker/gate_header_name") or "",
        "gate_header_value_configured": _get_value("spinnaker/gate_header_value") not in (None, ""),
        "auth0_domain": _get_value("spinnaker/auth0_domain") or "",
        "auth0_client_id": _get_value("spinnaker/auth0_client_id") or "",
        "auth0_client_secret_configured": _get_value("spinnaker/auth0_client_secret") not in (None, ""),
        "auth0_audience": _get_value("spinnaker/auth0_audience") or "",
        "auth0_scope": _get_value("spinnaker/auth0_scope") or "",
        "auth0_refresh_skew_seconds": refresh_skew,
        "mtls_cert_path": _get_value("spinnaker/mtls_cert_path") or "",
        "mtls_key_path": _get_value("spinnaker/mtls_key_path") or "",
        "mtls_ca_path": _get_value("spinnaker/mtls_ca_path") or "",
        "mtls_server_name": _get_value("spinnaker/mtls_server_name") or "",
        "engine_lambda_url": _get_value("engine/lambda/url") or "",
        "engine_lambda_token_configured": _get_value("engine/lambda/token") not in (None, ""),
    }


def _current_engine_adapter_config() -> dict:
    source = _engine_adapter_source_label()
    config = _read_engine_config_from_ssm() if source == "ssm" else None
    if config is None:
        config = _engine_config_from_settings()
    return {
        "adapter_id": "main",
        "label": "Primary deployment engine",
        "engine_type": EngineType.SPINNAKER.value,
        "engine_options": [
            {"id": EngineType.SPINNAKER.value, "label": "Spinnaker", "availability": "active"},
            {"id": "ARGO_CD", "label": "Argo CD", "availability": "planned"},
            {"id": "FLUX", "label": "Flux", "availability": "planned"},
            {"id": "OCTOPUS", "label": "Octopus", "availability": "planned"},
            {"id": "HARNESS", "label": "Harness", "availability": "planned"},
        ],
        "config": config,
        "source": source,
    }


def _normalize_optional_string(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _engine_adapter_mode_feedback_fields(mode: str) -> set[str]:
    shared = {
        "payload",
        "engine_type",
        "mode",
        "gate_url",
        "gate_header_name",
        "gate_header_value",
        "engine_lambda_url",
        "engine_lambda_token",
        "auth0_refresh_skew_seconds",
    }
    if mode == "mtls":
        return shared | {"mtls_cert_path", "mtls_key_path", "mtls_ca_path", "mtls_server_name"}
    if mode == "http":
        return shared | {"auth0_domain", "auth0_client_id", "auth0_client_secret", "auth0_audience", "auth0_scope"}
    return shared


def _filter_engine_adapter_feedback(mode: str, items: list[dict]) -> list[dict]:
    allowed_fields = _engine_adapter_mode_feedback_fields(mode)
    return [item for item in items if item.get("field") in allowed_fields]


def _validate_engine_adapter_normalized(config: dict) -> tuple[list[dict], list[dict]]:
    errors: list[dict] = []
    warnings: list[dict] = []
    mode = config["mode"]

    if config["gate_header_name"] and not config["gate_header_value"]:
        warnings.append({"field": "gate_header_value", "message": "Header value was not provided in this request. DXCP will keep the existing value if one is already configured."})
    if config["gate_header_value"] and not config["gate_header_name"]:
        errors.append({"field": "gate_header_name", "message": "Header name is required when a header value is provided."})

    if mode in {"http", "mtls"}:
        if not config["gate_url"]:
            errors.append({"field": "gate_url", "message": "Gate URL is required for live Spinnaker connectivity."})
        else:
            parsed = urlparse(config["gate_url"])
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                errors.append({"field": "gate_url", "message": "Gate URL must be a valid http or https URL."})
            if mode == "mtls" and parsed.scheme != "https":
                errors.append({"field": "gate_url", "message": "mTLS mode requires an https Gate URL."})

    auth0_fields = [
        config["auth0_domain"],
        config["auth0_client_id"],
        config["auth0_client_secret"],
        config["auth0_audience"],
    ]
    has_any_auth0 = any(auth0_fields)
    has_all_auth0 = all(auth0_fields)
    if has_any_auth0 and not has_all_auth0:
        errors.append({"field": "auth0_client_secret", "message": "Auth0 domain, client ID, client secret, and audience must all be set together."})

    has_any_mtls = any(
        [
            config["mtls_cert_path"],
            config["mtls_key_path"],
            config["mtls_ca_path"],
            config["mtls_server_name"],
        ]
    )
    if mode == "mtls" and (not config["mtls_cert_path"] or not config["mtls_key_path"]):
        errors.append({"field": "mtls_cert_path", "message": "mTLS mode requires both client certificate and client key paths."})
    elif mode not in {"mtls", "stub"} and has_any_mtls:
        warnings.append({"field": "mtls_cert_path", "message": "mTLS settings are only used when mode is mtls."})

    if config["engine_lambda_token"] and not config["engine_lambda_url"]:
        warnings.append({"field": "engine_lambda_token", "message": "Engine lambda token is configured without an engine lambda URL."})

    return _filter_engine_adapter_feedback(mode, errors), _filter_engine_adapter_feedback(mode, warnings)


def _parse_engine_adapter_payload(payload: object) -> tuple[Optional[dict], list[dict]]:
    errors: list[dict] = []
    if not isinstance(payload, dict):
        return None, [{"field": "payload", "message": "Payload must be an object."}]

    config_payload = payload.get("config") if isinstance(payload.get("config"), dict) else payload
    engine_type = _normalize_optional_string(payload.get("engine_type") or payload.get("engineType") or EngineType.SPINNAKER.value)
    if engine_type != EngineType.SPINNAKER.value:
        errors.append({"field": "engine_type", "message": "Only Spinnaker is supported for the primary deployment engine today."})

    mode = _normalize_optional_string(config_payload.get("mode")).lower() or str(SETTINGS.spinnaker_mode or "http").strip().lower() or "http"
    if mode not in ENGINE_ADAPTER_MODES:
        errors.append({"field": "mode", "message": "Mode must be one of http, mtls, or stub."})

    normalized = {
        "engine_type": EngineType.SPINNAKER.value,
        "mode": mode,
        "gate_url": _normalize_optional_string(config_payload.get("gate_url") or config_payload.get("gateUrl")),
        "gate_header_name": _normalize_optional_string(
            config_payload.get("gate_header_name") or config_payload.get("gateHeaderName")
        ),
        "gate_header_value": _normalize_optional_string(
            config_payload.get("gate_header_value") or config_payload.get("gateHeaderValue")
        ),
        "auth0_domain": _normalize_optional_string(config_payload.get("auth0_domain") or config_payload.get("auth0Domain")),
        "auth0_client_id": _normalize_optional_string(
            config_payload.get("auth0_client_id") or config_payload.get("auth0ClientId")
        ),
        "auth0_client_secret": _normalize_optional_string(
            config_payload.get("auth0_client_secret") or config_payload.get("auth0ClientSecret")
        ),
        "auth0_audience": _normalize_optional_string(
            config_payload.get("auth0_audience") or config_payload.get("auth0Audience")
        ),
        "auth0_scope": _normalize_optional_string(config_payload.get("auth0_scope") or config_payload.get("auth0Scope")),
        "mtls_cert_path": _normalize_optional_string(
            config_payload.get("mtls_cert_path") or config_payload.get("mtlsCertPath")
        ),
        "mtls_key_path": _normalize_optional_string(config_payload.get("mtls_key_path") or config_payload.get("mtlsKeyPath")),
        "mtls_ca_path": _normalize_optional_string(config_payload.get("mtls_ca_path") or config_payload.get("mtlsCaPath")),
        "mtls_server_name": _normalize_optional_string(
            config_payload.get("mtls_server_name") or config_payload.get("mtlsServerName")
        ),
        "engine_lambda_url": _normalize_optional_string(
            config_payload.get("engine_lambda_url") or config_payload.get("engineLambdaUrl")
        ),
        "engine_lambda_token": _normalize_optional_string(
            config_payload.get("engine_lambda_token") or config_payload.get("engineLambdaToken")
        ),
    }
    refresh_skew = config_payload.get("auth0_refresh_skew_seconds")
    if refresh_skew is None:
        refresh_skew = config_payload.get("auth0RefreshSkewSeconds")
    if refresh_skew in (None, ""):
        normalized["auth0_refresh_skew_seconds"] = int(SETTINGS.spinnaker_auth0_refresh_skew_seconds or 0)
    else:
        try:
            normalized["auth0_refresh_skew_seconds"] = max(0, int(refresh_skew))
        except Exception:
            errors.append({"field": "auth0_refresh_skew_seconds", "message": "Refresh skew seconds must be a non-negative integer."})
            normalized["auth0_refresh_skew_seconds"] = int(SETTINGS.spinnaker_auth0_refresh_skew_seconds or 0)

    return normalized, errors


def _normalize_engine_adapter_payload(payload: object) -> tuple[Optional[dict], list[dict], list[dict]]:
    normalized, errors = _parse_engine_adapter_payload(payload)
    if normalized is None:
        return None, errors, []
    validation_errors, validation_warnings = _validate_engine_adapter_normalized(normalized)
    return normalized, [*errors, *validation_errors], validation_warnings


def _spinnaker_from_normalized_engine_config(config: dict) -> SpinnakerAdapter:
    mode = config.get("mode", "http")
    use_auth0 = mode == "http"
    use_mtls = mode == "mtls"
    return SpinnakerAdapter(
        config.get("gate_url", ""),
        mode,
        config.get("engine_lambda_url", ""),
        config.get("engine_lambda_token", ""),
        application=SETTINGS.spinnaker_application,
        header_name=config.get("gate_header_name", ""),
        header_value=config.get("gate_header_value", ""),
        auth0_domain=config.get("auth0_domain", "") if use_auth0 else "",
        auth0_client_id=config.get("auth0_client_id", "") if use_auth0 else "",
        auth0_client_secret=config.get("auth0_client_secret", "") if use_auth0 else "",
        auth0_audience=config.get("auth0_audience", "") if use_auth0 else "",
        auth0_scope=config.get("auth0_scope", "") if use_auth0 else "",
        auth0_refresh_skew_seconds=config.get("auth0_refresh_skew_seconds", 60),
        mtls_cert_path=config.get("mtls_cert_path", "") if use_mtls else "",
        mtls_key_path=config.get("mtls_key_path", "") if use_mtls else "",
        mtls_ca_path=config.get("mtls_ca_path", "") if use_mtls else "",
        mtls_server_name=config.get("mtls_server_name", "") if use_mtls else "",
        request_id_provider=get_request_id,
    )


def _apply_runtime_engine_config(config: dict) -> None:
    global spinnaker
    SETTINGS.spinnaker_mode = config["mode"]
    SETTINGS.spinnaker_base_url = config["gate_url"]
    SETTINGS.spinnaker_header_name = config["gate_header_name"]
    SETTINGS.spinnaker_header_value = config["gate_header_value"]
    SETTINGS.spinnaker_auth0_domain = config["auth0_domain"]
    SETTINGS.spinnaker_auth0_client_id = config["auth0_client_id"]
    SETTINGS.spinnaker_auth0_client_secret = config["auth0_client_secret"]
    SETTINGS.spinnaker_auth0_audience = config["auth0_audience"]
    SETTINGS.spinnaker_auth0_scope = config["auth0_scope"]
    SETTINGS.spinnaker_auth0_refresh_skew_seconds = config["auth0_refresh_skew_seconds"]
    SETTINGS.spinnaker_mtls_cert_path = config["mtls_cert_path"]
    SETTINGS.spinnaker_mtls_key_path = config["mtls_key_path"]
    SETTINGS.spinnaker_mtls_ca_path = config["mtls_ca_path"]
    SETTINGS.spinnaker_mtls_server_name = config["mtls_server_name"]
    SETTINGS.engine_lambda_url = config["engine_lambda_url"]
    SETTINGS.engine_lambda_token = config["engine_lambda_token"]
    spinnaker = _spinnaker_from_normalized_engine_config(config)


def _engine_adapter_validation_candidate(normalized: dict) -> dict:
    candidate = dict(normalized)
    if candidate.get("gate_header_name") and not candidate.get("gate_header_value"):
        candidate["gate_header_value"] = SETTINGS.spinnaker_header_value or ""
    if (
        any(
            [
                candidate.get("auth0_domain"),
                candidate.get("auth0_client_id"),
                candidate.get("auth0_audience"),
                candidate.get("auth0_scope"),
            ]
        )
        and not candidate.get("auth0_client_secret")
    ):
        candidate["auth0_client_secret"] = SETTINGS.spinnaker_auth0_client_secret or ""
    if candidate.get("engine_lambda_url") and not candidate.get("engine_lambda_token"):
        candidate["engine_lambda_token"] = SETTINGS.engine_lambda_token or ""
    return candidate


def _engine_config_ssm_items(config: dict) -> dict[str, str]:
    return {
        "spinnaker/mode": config["mode"],
        "spinnaker/gate_url": config["gate_url"],
        "spinnaker/gate_header_name": config["gate_header_name"],
        "spinnaker/auth0_domain": config["auth0_domain"],
        "spinnaker/auth0_client_id": config["auth0_client_id"],
        "spinnaker/auth0_audience": config["auth0_audience"],
        "spinnaker/auth0_scope": config["auth0_scope"],
        "spinnaker/auth0_refresh_skew_seconds": str(config["auth0_refresh_skew_seconds"]),
        "spinnaker/mtls_cert_path": config["mtls_cert_path"],
        "spinnaker/mtls_key_path": config["mtls_key_path"],
        "spinnaker/mtls_ca_path": config["mtls_ca_path"],
        "spinnaker/mtls_server_name": config["mtls_server_name"],
        "engine/lambda/url": config["engine_lambda_url"],
    }


def _persist_engine_config_to_ssm(config: dict) -> None:
    prefix = (SETTINGS.ssm_prefix or "").strip().rstrip("/")
    if not prefix:
        return
    if boto3 is None:
        raise RuntimeError("boto3 is required for SSM operations")
    if BotoConfig is not None:
        cfg = BotoConfig(connect_timeout=1, read_timeout=1, retries={"max_attempts": 1, "mode": "standard"})
        try:
            client = boto3.client("ssm", config=cfg)
        except TypeError:
            client = boto3.client("ssm")
    else:
        client = boto3.client("ssm")
    for key, value in _engine_config_ssm_items(config).items():
        name = f"{prefix}/{key}"
        if value is None or value == "":
            try:
                client.delete_parameter(Name=name)
            except Exception:
                pass
            continue
        client.put_parameter(Name=name, Value=value, Type="String", Overwrite=True)
    secure_items = {
        "spinnaker/gate_header_value": config.get("gate_header_value"),
        "spinnaker/auth0_client_secret": config.get("auth0_client_secret"),
        "engine/lambda/token": config.get("engine_lambda_token"),
    }
    for key, value in secure_items.items():
        name = f"{prefix}/{key}"
        if value is None or value == "":
            try:
                client.delete_parameter(Name=name)
            except Exception:
                pass
            continue
        client.put_parameter(Name=name, Value=value, Type="SecureString", Overwrite=True)


def _audit_engine_adapter_changes(actor: Actor, claims: dict, request: Request, changes: dict[str, tuple[object, object]]) -> None:
    request_id = get_request_id() or request.headers.get("X-Request-Id") or str(uuid.uuid4())
    timestamp = datetime.now(timezone.utc).isoformat()
    actor_sub = claims.get("sub")
    actor_email = claims.get("email") or claims.get("https://dxcp.example/claims/email") or actor.email
    actor_azp = claims.get("azp")
    for setting_key, (old_value, new_value) in changes.items():
        detail = {
            "request_id": request_id,
            "timestamp": timestamp,
            "setting_key": setting_key,
            "old_value": old_value,
            "new_value": new_value,
            "actor_id": actor.actor_id,
            "actor_sub": actor_sub,
            "actor_email": actor_email,
            "actor_azp": actor_azp,
            "actor_role": actor.role.value,
        }
        storage.insert_audit_event(
            {
                "event_id": str(uuid.uuid4()),
                "event_type": "ADMIN_CONFIG_CHANGE",
                "actor_id": actor.actor_id,
                "actor_role": actor.role.value,
                "target_type": "AdminSetting",
                "target_id": setting_key,
                "timestamp": timestamp,
                "outcome": "SUCCESS",
                "summary": json.dumps(detail, sort_keys=True),
            }
        )


def _validate_optional_http_url(field_name: str, value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str):
        raise PolicyError(400, "INVALID_URL", f"{field_name} must be an http:// or https:// URL")
    normalized = value.strip()
    if not normalized:
        raise PolicyError(400, "INVALID_URL", f"{field_name} must be an http:// or https:// URL")
    parsed = urlparse(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise PolicyError(400, "INVALID_URL", f"{field_name} must be an http:// or https:// URL")
    return normalized


def _external_links_display_enabled() -> bool:
    try:
        policy = read_ui_exposure_policy()
    except Exception:
        return False
    if not isinstance(policy, dict):
        return False
    external_links = policy.get("externalLinks")
    if not isinstance(external_links, dict):
        return False
    return external_links.get("display") is True


def _build_public_view(build: Optional[dict]) -> Optional[dict]:
    if not isinstance(build, dict):
        return build
    payload = dict(build)
    if not _external_links_display_enabled():
        payload["commit_url"] = None
        payload["run_url"] = None
    return payload


def _register_existing_build_internal(
    service_entry: dict,
    service: str,
    version: str,
    artifact_ref: str,
    s3_bucket: Optional[str],
    s3_key: Optional[str],
    git_sha: str,
    git_branch: str,
    ci_provider: str,
    ci_run_id: str,
    built_at: str,
    checksum_sha256: Optional[str],
    repo: Optional[str],
    actor: Optional[str],
    ci_publisher: Optional[str],
    commit_url: Optional[str],
    run_url: Optional[str],
) -> dict:
    if not SETTINGS.runtime_artifact_bucket:
        raise ValueError("Runtime artifact bucket is not configured")

    bucket, key = parse_s3_artifact_ref(artifact_ref, SETTINGS.artifact_ref_schemes)

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
        "git_sha": git_sha,
        "git_branch": git_branch,
        "ci_provider": ci_provider,
        "ci_run_id": ci_run_id,
        "built_at": built_at,
        "sha256": sha256,
        "sizeBytes": size_bytes,
        "contentType": content_type,
        "checksum_sha256": checksum_sha256,
        "repo": repo,
        "actor": actor,
        "ci_publisher": ci_publisher,
        "commit_url": commit_url,
        "run_url": run_url,
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
    actor, claims = get_actor_and_claims(authorization)
    user_bearer_token = _extract_bearer_token(authorization)
    user_principal = _derive_gate_user_from_claims(claims)
    if not user_principal:
        return error_response(401, "UNAUTHORIZED", "Authenticated principal claim is required")
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
    recipe, _, execution_plan, selection_error = resolve_deployment_execution_selection(
        intent.service,
        intent.environment,
        intent.recipeId,
        actor,
    )
    if selection_error:
        _record_deploy_denied(actor, intent, _error_code_from_response(selection_error), group.get("id"))
        return selection_error
    policy_recipe_error = _policy_check_recipe_allowed(group, execution_plan.recipe_id, actor)
    if policy_recipe_error:
        _record_deploy_denied(actor, intent, _error_code_from_response(policy_recipe_error), group.get("id"))
        return policy_recipe_error
    recipe_id_error = _validate_transitional_recipe_id(execution_plan.recipe_id, intent.recipeId)
    if recipe_id_error:
        _record_deploy_denied(actor, intent, _error_code_from_response(recipe_id_error), group.get("id"))
        return recipe_id_error
    try:
        service_entry = guardrails.validate_service(intent.service)
        guardrails.validate_environment(intent.environment, service_entry, group)
        guardrails.validate_version(intent.version)
    except PolicyError as exc:
        return _capability_error(exc.code, exc.message, actor)
    build = storage.find_latest_build(intent.service, intent.version)
    if not build:
        _record_deploy_denied(actor, intent, "VERSION_NOT_FOUND", group.get("id"))
        return error_response(
            400,
            "VERSION_NOT_FOUND",
            "Version is not registered in the build registry for this service",
        )
    recipe_capability_error = _capability_check_recipe_service(service_entry, execution_plan.recipe_id, actor)
    if recipe_capability_error:
        return recipe_capability_error
    request_fingerprint = _deployment_request_fingerprint(intent)
    cached = enforce_idempotency(
        request,
        idempotency_key,
        request_fingerprint=request_fingerprint,
    )
    if cached:
        return cached
    max_concurrent = _environment_guardrail_value(group, env_entry, "max_concurrent_deployments", 1)
    daily_deploy_quota = _environment_guardrail_value(group, env_entry, "daily_deploy_quota", SETTINGS.daily_quota_deploy)
    pre_submit_quota = rate_limiter.get_daily_remaining(
        _quota_scope(group["id"], env_entry.get("name")),
        "deploy",
        daily_deploy_quota,
    )
    try:
        rate_limiter.check_mutate(
            actor.actor_id,
            "deploy",
            quota_scope=_quota_scope(group["id"], env_entry.get("name")),
            quota_limit=daily_deploy_quota,
        )
        _reap_stale_group_locks(
            group["id"],
            env_entry.get("name"),
            user_bearer_token=user_bearer_token,
            user_principal=user_principal,
        )
        guardrails.enforce_delivery_group_lock(group["id"], max_concurrent, env_entry.get("name"))
    except PolicyError as exc:
        _record_deploy_denied(actor, intent, exc.code, group.get("id"))
        raise
    policy_snapshot = _policy_snapshot_for_environment(
        group,
        env_entry,
        deploy_quota=pre_submit_quota,
    )

    payload = intent.dict()
    payload.pop("recipeId", None)
    payload = apply_execution_plan(payload, execution_plan, "deploy")
    if spinnaker.mode == "http":
        if not payload.get("spinnakerApplication") and not SETTINGS.spinnaker_application:
            _record_deploy_denied(actor, intent, "INVALID_REQUEST", group.get("id"))
            return error_response(400, "INVALID_REQUEST", "spinnakerApplication is required for deploy")
        payload["artifactRef"] = build["artifactRef"]

    try:
        execution = _invoke_engine(
            "deploy",
            payload,
            idempotency_key,
            user_bearer_token=user_bearer_token,
            user_principal=user_principal,
        )
    except Exception as exc:
        return _engine_error_response(actor, "Unable to start deployment", exc)
    execution_id, execution_url = _extract_engine_execution(execution)
    if not execution_id or not execution_url:
        return _engine_error_response(
            actor,
            "Unable to start deployment",
            RuntimeError("Spinnaker trigger failed: missing execution metadata"),
        )
    record = {
        "id": str(uuid.uuid4()),
        "service": intent.service,
        "environment": intent.environment,
        "version": intent.version,
        "recipeId": execution_plan.recipe_id,
        "recipeRevision": execution_plan.recipe_revision,
        "effectiveBehaviorSummary": execution_plan.effective_behavior_summary,
        "state": "IN_PROGRESS",
        "deploymentKind": "ROLL_FORWARD",
        "outcome": None,
        "intentCorrelationId": idempotency_key,
        "supersededBy": None,
        "changeSummary": intent.changeSummary,
        "createdAt": utc_now(),
        "updatedAt": utc_now(),
        "engine_type": execution_plan.engine_type,
        "spinnakerExecutionId": execution_id,
        "spinnakerExecutionUrl": execution_url,
        "spinnakerApplication": payload.get("spinnakerApplication"),
        "spinnakerPipeline": payload.get("spinnakerPipeline"),
        "deliveryGroupId": group["id"],
        "actorIdentity": _deployment_actor_identity(actor, claims),
        "policySnapshot": policy_snapshot,
        "failures": [],
    }
    storage.insert_deployment(record, [])
    public_record = _deployment_public_view(actor, record)
    logger.info(
        "deployment.created deployment_id=%s spinnaker_execution_id=%s service=%s version=%s idempotency_key=%s",
        record["id"],
        record["spinnakerExecutionId"],
        record["service"],
        record["version"],
        idempotency_key,
    )
    store_idempotency(
        request,
        idempotency_key,
        public_record,
        201,
        request_fingerprint=request_fingerprint,
    )
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
    return public_record


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
    recipe, routing, execution_plan, selection_error = resolve_deployment_execution_selection(
        req.service,
        req.environment,
        req.recipeId,
        actor,
    )
    if selection_error:
        return selection_error
    policy_recipe_error = _policy_check_recipe_allowed(group, execution_plan.recipe_id, actor)
    if policy_recipe_error:
        return policy_recipe_error
    recipe_id_error = _validate_transitional_recipe_id(execution_plan.recipe_id, req.recipeId)
    if recipe_id_error:
        return recipe_id_error
    try:
        service_entry = guardrails.validate_service(req.service)
        guardrails.validate_environment(req.environment, service_entry, group)
    except PolicyError as exc:
        return _capability_error(exc.code, exc.message, actor)
    recipe_capability_error = _capability_check_recipe_service(service_entry, execution_plan.recipe_id, actor)
    if recipe_capability_error:
        return recipe_capability_error

    policy_snapshot = _policy_snapshot_for_environment(group, env_entry)
    return {
        "service": req.service,
        "environment": req.environment,
        "recipeId": execution_plan.recipe_id,
        "deliveryGroupId": group.get("id"),
        "resolvedRecipe": {
            "id": execution_plan.recipe_id,
            "name": recipe.get("name"),
            "status": recipe.get("status"),
            "revision": execution_plan.recipe_revision,
            "effectiveBehaviorSummary": execution_plan.effective_behavior_summary,
            "routing": routing,
        },
        "policy": policy_snapshot,
        "generatedAt": utc_now(),
    }


@app.post("/v1/deployments/validate")
def validate_deployment(
    intent: DeploymentIntent,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    actor, claims = get_actor_and_claims(authorization)
    user_bearer_token = _extract_bearer_token(authorization)
    user_principal = _derive_gate_user_from_claims(claims)
    if not user_principal:
        return error_response(401, "UNAUTHORIZED", "Authenticated principal claim is required")
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
    recipe, _, execution_plan, selection_error = resolve_deployment_execution_selection(
        intent.service,
        intent.environment,
        intent.recipeId,
        actor,
    )
    if selection_error:
        return selection_error
    policy_recipe_error = _policy_check_recipe_allowed(group, execution_plan.recipe_id, actor)
    if policy_recipe_error:
        return policy_recipe_error
    recipe_id_error = _validate_transitional_recipe_id(execution_plan.recipe_id, intent.recipeId)
    if recipe_id_error:
        return recipe_id_error
    try:
        service_entry = guardrails.validate_service(intent.service)
        guardrails.validate_environment(intent.environment, service_entry, group)
        guardrails.validate_version(intent.version)
    except PolicyError as exc:
        return _capability_error(exc.code, exc.message, actor)
    recipe_capability_error = _capability_check_recipe_service(service_entry, execution_plan.recipe_id, actor)
    if recipe_capability_error:
        return recipe_capability_error
    build = storage.find_latest_build(intent.service, intent.version)
    if not build:
        return error_response(
            400,
            "VERSION_NOT_FOUND",
            "Version is not registered in the build registry for this service",
        )
    preflight_artifact_error = _preflight_artifact_availability(build, actor)
    if preflight_artifact_error:
        return preflight_artifact_error
    preflight_engine_error = _preflight_engine_readiness(
        actor,
        user_bearer_token=user_bearer_token,
        user_principal=user_principal,
    )
    if preflight_engine_error:
        return preflight_engine_error

    policy_snapshot = _policy_snapshot_for_environment(group, env_entry)
    if policy_snapshot["current_concurrent_deployments"] >= policy_snapshot["max_concurrent_deployments"]:
        return error_response(409, "CONCURRENCY_LIMIT_REACHED", "Delivery group has active deployments")
    if policy_snapshot["deployments_remaining"] <= 0:
        return error_response(429, "QUOTA_EXCEEDED", "Daily quota exceeded")

    return {
        "service": intent.service,
        "environment": intent.environment,
        "version": intent.version,
        "recipeId": execution_plan.recipe_id,
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
    actor, claims = get_actor_and_claims(authorization)
    user_bearer_token = _extract_bearer_token(authorization)
    user_principal = _derive_gate_user_from_claims(claims)
    if not user_principal:
        return error_response(401, "UNAUTHORIZED", "Authenticated principal claim is required")
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
    execution_plan = context["execution_plan"]
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
    _reap_stale_group_locks(
        group["id"],
        target_env.get("name"),
        user_bearer_token=user_bearer_token,
        user_principal=user_principal,
    )
    guardrails.enforce_delivery_group_lock(group["id"], max_concurrent, target_env.get("name"))
    request_fingerprint = _promotion_request_fingerprint(intent)
    cached = enforce_idempotency(
        request,
        idempotency_key,
        request_fingerprint=request_fingerprint,
    )
    if cached:
        return cached
    payload = {
        "service": intent.service,
        "environment": intent.target_environment,
        "version": intent.version,
        "sourceEnvironment": intent.source_environment,
        "targetEnvironment": intent.target_environment,
    }
    payload = apply_execution_plan(payload, execution_plan, "deploy")
    if spinnaker.mode == "http":
        if not payload.get("spinnakerApplication") and not SETTINGS.spinnaker_application:
            _record_promotion_denied(actor, intent, "INVALID_REQUEST", group.get("id"))
            return error_response(400, "INVALID_REQUEST", "spinnakerApplication is required for promotion")
        payload["artifactRef"] = build["artifactRef"]
    try:
        execution = _invoke_engine(
            "deploy",
            payload,
            idempotency_key,
            user_bearer_token=user_bearer_token,
            user_principal=user_principal,
        )
    except Exception as exc:
        return _engine_error_response(actor, "Unable to start promotion", exc)
    execution_id, execution_url = _extract_engine_execution(execution)
    if not execution_id or not execution_url:
        return _engine_error_response(
            actor,
            "Unable to start promotion",
            RuntimeError("Spinnaker trigger failed: missing execution metadata"),
        )
    record = {
        "id": str(uuid.uuid4()),
        "service": intent.service,
        "environment": intent.target_environment,
        "sourceEnvironment": intent.source_environment,
        "version": intent.version,
        "recipeId": execution_plan.recipe_id,
        "recipeRevision": execution_plan.recipe_revision,
        "effectiveBehaviorSummary": execution_plan.effective_behavior_summary,
        "state": "IN_PROGRESS",
        "deploymentKind": "PROMOTE",
        "outcome": None,
        "intentCorrelationId": idempotency_key,
        "supersededBy": None,
        "changeSummary": intent.changeSummary,
        "createdAt": utc_now(),
        "updatedAt": utc_now(),
        "engine_type": execution_plan.engine_type,
        "spinnakerExecutionId": execution_id,
        "spinnakerExecutionUrl": execution_url,
        "spinnakerApplication": payload.get("spinnakerApplication"),
        "spinnakerPipeline": payload.get("spinnakerPipeline"),
        "deliveryGroupId": group["id"],
        "actorIdentity": _deployment_actor_identity(actor, claims),
        "policySnapshot": policy_snapshot,
        "failures": [],
    }
    storage.insert_deployment(record, [])
    store_idempotency(
        request,
        idempotency_key,
        record,
        201,
        request_fingerprint=request_fingerprint,
    )
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
    return [Environment(**env).dict() for env in _accessible_environments_for_actor(actor, include_disabled=True)]


@app.get("/v1/environments/{environment_id}")
def get_environment(environment_id: str, request: Request, authorization: Optional[str] = Header(None)):
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    env_id_error = _validate_admin_environment_id(environment_id)
    if env_id_error:
        return env_id_error
    environment = storage.get_environment(environment_id)
    if not environment:
        return error_response(404, "NOT_FOUND", "Environment not found")
    if actor.role != Role.PLATFORM_ADMIN:
        allowed_ids = {
            env.get("id") or env.get("name")
            for env in _accessible_environments_for_actor(actor, include_disabled=True)
        }
        if environment_id not in allowed_ids:
            return error_response(404, "NOT_FOUND", "Environment not found")
    return Environment(**environment).dict()


@app.post("/v1/environments", status_code=201)
def create_environment(payload: dict, request: Request, authorization: Optional[str] = Header(None)):
    actor = get_actor(authorization)
    role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "create environments")
    if role_error:
        return role_error
    guardrails.require_mutations_enabled()
    rate_limiter.check_mutate(actor.actor_id, "environment_create")

    environment_id = (payload.get("environment_id") or payload.get("id") or payload.get("name") or "").strip()
    env_id_error = _validate_admin_environment_id(environment_id)
    if env_id_error:
        return env_id_error
    if storage.get_environment(environment_id):
        return error_response(409, "ENVIRONMENT_EXISTS", "Environment already exists")

    display_name = (payload.get("display_name") or payload.get("displayName") or environment_id).strip()
    if not display_name:
        return error_response(400, "INVALID_REQUEST", "display_name is required")
    type_value = payload.get("type")
    type_error = _validate_environment_type(type_value)
    if type_error:
        return type_error
    lifecycle_state, lifecycle_error = _lifecycle_state_from_payload(payload)
    if lifecycle_error:
        return lifecycle_error

    now = utc_now()
    row = {
        "environment_id": environment_id,
        "display_name": display_name,
        "type": type_value,
        "lifecycle_state": lifecycle_state,
        "is_enabled": lifecycle_state == EnvironmentLifecycleState.ACTIVE.value,
        "created_at": now,
        "updated_at": now,
    }
    storage.insert_admin_environment(row)
    environment = storage.get_environment(environment_id)
    return Environment(**environment).dict() if environment else Environment(
        id=environment_id,
        name=environment_id,
        display_name=display_name,
        type=type_value,
        lifecycle_state=lifecycle_state,
        promotion_order=None,
        is_enabled=lifecycle_state == EnvironmentLifecycleState.ACTIVE.value,
        guardrails=None,
        created_at=now,
        updated_at=now,
    ).dict()


@app.patch("/v1/environments/{environment_id}")
def patch_environment(
    environment_id: str,
    payload: dict,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    actor = get_actor(authorization)
    role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "update environments")
    if role_error:
        return role_error
    guardrails.require_mutations_enabled()
    rate_limiter.check_mutate(actor.actor_id, "environment_update")

    env_id_error = _validate_admin_environment_id(environment_id)
    if env_id_error:
        return env_id_error
    existing = storage.get_environment(environment_id)
    if not existing:
        return error_response(404, "NOT_FOUND", "Environment not found")

    next_display_name = existing.get("display_name") or environment_id
    if "display_name" in payload or "displayName" in payload:
        next_display_name = (payload.get("display_name") or payload.get("displayName") or "").strip()
        if not next_display_name:
            return error_response(400, "INVALID_REQUEST", "display_name must be non-empty")

    next_type = existing.get("type")
    if "type" in payload:
        next_type = payload.get("type")
        type_error = _validate_environment_type(next_type)
        if type_error:
            return type_error
        references = storage.environment_reference_summary(environment_id)
        if next_type != existing.get("type") and any(references.get(key) for key in references):
            return error_response(
                409,
                "ENVIRONMENT_TYPE_LOCKED",
                "Environment type cannot be changed after DXCP has historical or policy references for this environment.",
            )

    next_lifecycle_state, lifecycle_error = _lifecycle_state_from_payload(payload, existing)
    if lifecycle_error:
        return lifecycle_error

    storage.update_admin_environment(
        {
            "environment_id": environment_id,
            "display_name": next_display_name,
            "type": next_type,
            "lifecycle_state": next_lifecycle_state,
            "is_enabled": next_lifecycle_state == EnvironmentLifecycleState.ACTIVE.value,
            "created_at": existing.get("created_at"),
            "updated_at": utc_now(),
        }
    )
    updated = storage.get_environment(environment_id)
    return Environment(**updated).dict() if updated else None


@app.delete("/v1/environments/{environment_id}", status_code=204)
def delete_environment(environment_id: str, request: Request, authorization: Optional[str] = Header(None)):
    actor = get_actor(authorization)
    role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "delete environments")
    if role_error:
        return role_error
    guardrails.require_mutations_enabled()
    rate_limiter.check_mutate(actor.actor_id, "environment_delete")

    env_id_error = _validate_admin_environment_id(environment_id)
    if env_id_error:
        return env_id_error
    if not storage.get_environment(environment_id):
        return error_response(404, "NOT_FOUND", "Environment not found")
    references = storage.environment_reference_summary(environment_id)
    if any(references.get(key) for key in references):
        return _environment_delete_blocked_response(environment_id, references)
    if not storage.delete_environment(environment_id):
        return error_response(404, "NOT_FOUND", "Environment not found")
    return Response(status_code=204)


@app.get("/v1/admin/delivery-groups/{dg}/environments")
def list_admin_delivery_group_environment_policy(
    dg: str,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    role_error = _require_admin_read(actor, "view delivery group environment policy")
    if role_error:
        return role_error
    if not storage.get_delivery_group(dg):
        return error_response(404, "NOT_FOUND", "Delivery group not found")
    return storage.list_delivery_group_environment_policy(dg)


@app.put("/v1/admin/delivery-groups/{dg}/environments/{environment_id}")
@app.patch("/v1/admin/delivery-groups/{dg}/environments/{environment_id}")
def upsert_admin_delivery_group_environment_policy(
    dg: str,
    environment_id: str,
    payload: dict,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    actor = get_actor(authorization)
    role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "update delivery group environment policy")
    if role_error:
        return role_error
    guardrails.require_mutations_enabled()
    rate_limiter.check_mutate(actor.actor_id, "admin_delivery_group_environment_policy_update")

    env_id_error = _validate_admin_environment_id(environment_id)
    if env_id_error:
        return env_id_error
    if not storage.get_delivery_group(dg):
        return error_response(404, "NOT_FOUND", "Delivery group not found")
    if not storage.get_admin_environment(environment_id):
        return error_response(404, "NOT_FOUND", "Environment not found")
    environment = storage.get_environment(environment_id)
    if environment and environment.get("lifecycle_state") == EnvironmentLifecycleState.RETIRED.value:
        requested_enabled = payload.get("is_enabled", True)
        if requested_enabled:
            return error_response(
                409,
                "ENVIRONMENT_RETIRED",
                "Retired environments cannot be re-enabled in delivery-group policy. Change lifecycle state first if the environment should return to active use.",
            )

    existing_rows = storage.list_delivery_group_environment_policy(dg)
    existing = next((row for row in existing_rows if row.get("environment_id") == environment_id), None)
    is_enabled = payload.get("is_enabled", existing.get("is_enabled", True) if existing else True)
    order_index = payload.get("order_index", existing.get("order_index", 0) if existing else len(existing_rows))

    if not isinstance(is_enabled, bool):
        return error_response(400, "INVALID_REQUEST", "is_enabled must be a boolean")
    if isinstance(order_index, bool) or not isinstance(order_index, int) or order_index < 0:
        return error_response(400, "INVALID_REQUEST", "order_index must be an integer >= 0")

    row = {
        "delivery_group_id": dg,
        "environment_id": environment_id,
        "is_enabled": is_enabled,
        "order_index": order_index,
    }
    storage.upsert_delivery_group_environment_policy(row)
    return row


@app.get("/v1/admin/services/{service}/environments")
def list_admin_service_environment_routing(
    service: str,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    role_error = _require_admin_read(actor, "view service environment routing")
    if role_error:
        return role_error
    if not storage.get_service(service):
        return error_response(404, "NOT_FOUND", "Service not found")

    routes = storage.list_service_environment_routing(service)
    route_map = {row.get("environment_id"): row for row in routes}
    response = []
    for env in storage.list_admin_environments():
        env_id = env.get("environment_id")
        route = route_map.get(env_id)
        response.append(
            {
                "service_id": service,
                "environment_id": env_id,
                "display_name": env.get("display_name"),
                "type": env.get("type"),
                "lifecycle_state": env.get("lifecycle_state"),
                "is_enabled": env.get("is_enabled"),
                "recipe_id": route.get("recipe_id") if route else None,
            }
        )
    return response


@app.put("/v1/admin/services/{service}/environments/{environment_id}")
@app.patch("/v1/admin/services/{service}/environments/{environment_id}")
def upsert_admin_service_environment_routing(
    service: str,
    environment_id: str,
    payload: dict,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    actor = get_actor(authorization)
    role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "update service environment routing")
    if role_error:
        return role_error
    guardrails.require_mutations_enabled()
    rate_limiter.check_mutate(actor.actor_id, "admin_service_environment_routing_update")

    env_id_error = _validate_admin_environment_id(environment_id)
    if env_id_error:
        return env_id_error
    if not storage.get_service(service):
        return error_response(404, "NOT_FOUND", "Service not found")
    if not storage.get_admin_environment(environment_id):
        return error_response(404, "NOT_FOUND", "Environment not found")
    environment = storage.get_environment(environment_id)
    if environment and environment.get("lifecycle_state") == EnvironmentLifecycleState.RETIRED.value:
        return error_response(
            409,
            "ENVIRONMENT_RETIRED",
            "Retired environments are preserved for history and diagnostics and cannot be configured as normal routing targets for new deploys.",
        )

    recipe_id = (payload.get("recipe_id") or "").strip()
    if not recipe_id:
        return error_response(400, "INVALID_REQUEST", "recipe_id is required")
    if not storage.get_recipe(recipe_id):
        return error_response(404, "NOT_FOUND", "Recipe not found")

    row = {
        "service_id": service,
        "environment_id": environment_id,
        "recipe_id": recipe_id,
    }
    storage.upsert_service_environment_routing(row)
    return row


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
    guardrails.require_mutations_enabled()
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
    guardrails.require_mutations_enabled()
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
    guardrails.require_mutations_enabled()
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
    guardrails.require_mutations_enabled()
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


@app.delete("/v1/admin/recipes/{recipe_id}", status_code=204)
def delete_admin_recipe(
    recipe_id: str,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    actor = get_actor(authorization)
    role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "delete recipes")
    if role_error:
        return role_error
    guardrails.require_mutations_enabled()
    rate_limiter.check_mutate(actor.actor_id, "recipe_delete")

    existing = storage.get_recipe(recipe_id)
    if not existing:
        return error_response(404, "NOT_FOUND", "Recipe not found")

    routing_references = storage.list_service_environment_routing_by_recipe(recipe_id)
    if routing_references:
        return _recipe_in_use_response(recipe_id, "service_environment_routing", routing_references)

    delivery_group_references = storage.list_delivery_groups_by_allowed_recipe(recipe_id)
    if delivery_group_references:
        return _recipe_in_use_response(recipe_id, "delivery_group_allowed_recipes", delivery_group_references)

    storage.delete_recipe(recipe_id)
    _record_audit_event(
        actor,
        "ADMIN_DELETE",
        "Recipe",
        recipe_id,
        AuditOutcome.SUCCESS,
        f"Recipe {recipe_id} deleted",
    )
    return Response(status_code=204)


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
    def _empty_delivery_status(promotion_candidate_override=None):
        return {
            "service": service,
            "environment": environment,
            "hasDeployments": False,
            "latest": None,
            "currentRunning": None,
            "promotionCandidate": promotion_candidate_override,
        }

    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    service_entry = guardrails.validate_service(service)
    group, group_error = resolve_delivery_group(service, actor)
    if group_error:
        return _empty_delivery_status()
    env_entry, env_error = resolve_environment_for_group(group, environment, actor)
    if env_error:
        return _empty_delivery_status()
    try:
        guardrails.validate_environment(environment, service_entry, group)
    except PolicyError as exc:
        return _empty_delivery_status()
    deployments = storage.list_deployments(service, None, environment)
    promotion_candidate = _promotion_candidate_for_service(service, environment, actor)
    if not deployments:
        return _empty_delivery_status(promotion_candidate)
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
    actor, claims = get_actor_and_claims(authorization)
    user_bearer_token = _extract_bearer_token(authorization)
    user_principal = _derive_gate_user_from_claims(claims)
    if not user_principal:
        return error_response(401, "UNAUTHORIZED", "Authenticated principal claim is required")
    rate_limiter.check_read(actor.actor_id)
    role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "view spinnaker status")
    if role_error:
        return role_error
    if spinnaker.mode != "http":
        return {"status": "DOWN", "error": f"Spinnaker mode is {spinnaker.mode}"}
    try:
        _call_gate_with_user_token(
            spinnaker.check_health,
            user_bearer_token=user_bearer_token,
            user_principal=user_principal,
        )
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
    actor, claims = get_actor_and_claims(authorization)
    user_bearer_token = _extract_bearer_token(authorization)
    user_principal = _derive_gate_user_from_claims(claims)
    if not user_principal:
        return error_response(401, "UNAUTHORIZED", "Authenticated principal claim is required")
    rate_limiter.check_read(actor.actor_id)
    deployment = storage.get_deployment(deployment_id)
    if not deployment:
        return error_response(404, "NOT_FOUND", "Deployment not found")
    if not _actor_can_read_deployment(actor, deployment):
        return error_response(
            403,
            "DELIVERY_GROUP_SCOPE_REQUIRED",
            "Deployment not in actor delivery group scope",
        )
    deployment = refresh_from_spinnaker(
        deployment,
        user_bearer_token=user_bearer_token,
        user_principal=user_principal,
    )
    deployments = storage.list_deployments(deployment.get("service"), None, deployment.get("environment"))
    latest_success_by_scope = _latest_success_by_scope(deployments)
    return _deployment_public_view(actor, deployment, latest_success_by_scope)


@app.get("/v1/deployments/{deployment_id}/failures")
def get_deployment_failures(
    deployment_id: str,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    actor, claims = get_actor_and_claims(authorization)
    user_bearer_token = _extract_bearer_token(authorization)
    user_principal = _derive_gate_user_from_claims(claims)
    if not user_principal:
        return error_response(401, "UNAUTHORIZED", "Authenticated principal claim is required")
    rate_limiter.check_read(actor.actor_id)
    deployment = storage.get_deployment(deployment_id)
    if not deployment:
        return error_response(404, "NOT_FOUND", "Deployment not found")
    if not _actor_can_read_deployment(actor, deployment):
        return error_response(
            403,
            "DELIVERY_GROUP_SCOPE_REQUIRED",
            "Deployment not in actor delivery group scope",
        )
    deployment = refresh_from_spinnaker(
        deployment,
        user_bearer_token=user_bearer_token,
        user_principal=user_principal,
    )
    return deployment.get("failures", [])


@app.get("/v1/deployments/{deployment_id}/timeline")
def get_deployment_timeline(
    deployment_id: str,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    actor, claims = get_actor_and_claims(authorization)
    user_bearer_token = _extract_bearer_token(authorization)
    user_principal = _derive_gate_user_from_claims(claims)
    if not user_principal:
        return error_response(401, "UNAUTHORIZED", "Authenticated principal claim is required")
    rate_limiter.check_read(actor.actor_id)
    deployment = storage.get_deployment(deployment_id)
    if not deployment:
        return error_response(404, "NOT_FOUND", "Deployment not found")
    if not _actor_can_read_deployment(actor, deployment):
        return error_response(
            403,
            "DELIVERY_GROUP_SCOPE_REQUIRED",
            "Deployment not in actor delivery group scope",
        )
    deployment = refresh_from_spinnaker(
        deployment,
        user_bearer_token=user_bearer_token,
        user_principal=user_principal,
    )
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


@app.get("/v1/admin/system/engine-adapters/main")
def get_engine_adapter_settings(request: Request, authorization: Optional[str] = Header(None)):
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "view engine adapter settings")
    if role_error:
        return role_error
    return _current_engine_adapter_config()


@app.put("/v1/admin/system/engine-adapters/main")
def update_engine_adapter_settings(
    payload: dict,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    actor, claims = get_actor_and_claims(authorization)
    rate_limiter.check_mutate(actor.actor_id, "admin_system_engine_adapter_update")
    role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "update engine adapter settings")
    if role_error:
        return role_error
    try:
        guardrails.require_mutations_enabled()
    except PolicyError as exc:
        return error_response(exc.status_code, exc.code, exc.message)

    normalized, errors, _warnings = _normalize_engine_adapter_payload(payload)
    if errors:
        return error_response(400, "INVALID_REQUEST", "Engine adapter settings are invalid", details={"errors": errors})
    assert normalized is not None

    previous = _current_engine_adapter_config()
    current_config = previous.get("config", {})
    previous_runtime = {
        "mode": current_config.get("mode", "http"),
        "gate_url": current_config.get("gate_url", ""),
        "gate_header_name": current_config.get("gate_header_name", ""),
        "gate_header_value": SETTINGS.spinnaker_header_value or "",
        "auth0_domain": current_config.get("auth0_domain", ""),
        "auth0_client_id": current_config.get("auth0_client_id", ""),
        "auth0_client_secret": SETTINGS.spinnaker_auth0_client_secret or "",
        "auth0_audience": current_config.get("auth0_audience", ""),
        "auth0_scope": current_config.get("auth0_scope", ""),
        "auth0_refresh_skew_seconds": current_config.get("auth0_refresh_skew_seconds", 60),
        "mtls_cert_path": current_config.get("mtls_cert_path", ""),
        "mtls_key_path": current_config.get("mtls_key_path", ""),
        "mtls_ca_path": current_config.get("mtls_ca_path", ""),
        "mtls_server_name": current_config.get("mtls_server_name", ""),
        "engine_lambda_url": current_config.get("engine_lambda_url", ""),
        "engine_lambda_token": SETTINGS.engine_lambda_token or "",
    }
    merged = dict(previous_runtime)
    merged.update(normalized)
    if not merged.get("gate_header_value"):
        merged["gate_header_value"] = ""
    if not normalized.get("auth0_client_secret"):
        merged["auth0_client_secret"] = previous_runtime["auth0_client_secret"]
    if not normalized.get("engine_lambda_token"):
        merged["engine_lambda_token"] = previous_runtime["engine_lambda_token"]
    if not normalized.get("gate_header_value") and normalized.get("gate_header_name"):
        merged["gate_header_value"] = previous_runtime["gate_header_value"]

    try:
        if _engine_adapter_source_label() == "ssm":
            _persist_engine_config_to_ssm(merged)
        runtime_apply_warning = None
        try:
            _apply_runtime_engine_config(merged)
        except Exception as exc:
            runtime_apply_warning = redact_text(str(exc)) or "Runtime adapter could not be fully reloaded."
        current = _current_engine_adapter_config()
        previous_config = previous.get("config", {})
        current_config = current.get("config", {})
        _audit_engine_adapter_changes(
            actor,
            claims,
            request,
            {
                "engine_adapter.engine_type": (previous.get("engine_type"), current.get("engine_type")),
                "engine_adapter.spinnaker.mode": (previous_config.get("mode"), current_config.get("mode")),
                "engine_adapter.spinnaker.gate_url": (previous_config.get("gate_url"), current_config.get("gate_url")),
                "engine_adapter.spinnaker.gate_header_name": (
                    previous_config.get("gate_header_name"),
                    current_config.get("gate_header_name"),
                ),
                "engine_adapter.spinnaker.gate_header_value_configured": (
                    previous_config.get("gate_header_value_configured"),
                    current_config.get("gate_header_value_configured"),
                ),
                "engine_adapter.spinnaker.auth0_domain": (
                    previous_config.get("auth0_domain"),
                    current_config.get("auth0_domain"),
                ),
                "engine_adapter.spinnaker.auth0_client_id": (
                    previous_config.get("auth0_client_id"),
                    current_config.get("auth0_client_id"),
                ),
                "engine_adapter.spinnaker.auth0_client_secret_configured": (
                    previous_config.get("auth0_client_secret_configured"),
                    current_config.get("auth0_client_secret_configured"),
                ),
                "engine_adapter.spinnaker.auth0_audience": (
                    previous_config.get("auth0_audience"),
                    current_config.get("auth0_audience"),
                ),
                "engine_adapter.spinnaker.auth0_scope": (
                    previous_config.get("auth0_scope"),
                    current_config.get("auth0_scope"),
                ),
                "engine_adapter.spinnaker.auth0_refresh_skew_seconds": (
                    previous_config.get("auth0_refresh_skew_seconds"),
                    current_config.get("auth0_refresh_skew_seconds"),
                ),
                "engine_adapter.spinnaker.mtls_cert_path": (
                    previous_config.get("mtls_cert_path"),
                    current_config.get("mtls_cert_path"),
                ),
                "engine_adapter.spinnaker.mtls_key_path": (
                    previous_config.get("mtls_key_path"),
                    current_config.get("mtls_key_path"),
                ),
                "engine_adapter.spinnaker.mtls_ca_path": (
                    previous_config.get("mtls_ca_path"),
                    current_config.get("mtls_ca_path"),
                ),
                "engine_adapter.spinnaker.mtls_server_name": (
                    previous_config.get("mtls_server_name"),
                    current_config.get("mtls_server_name"),
                ),
                "engine_adapter.runtime.engine_lambda_url": (
                    previous_config.get("engine_lambda_url"),
                    current_config.get("engine_lambda_url"),
                ),
                "engine_adapter.runtime.engine_lambda_token_configured": (
                    previous_config.get("engine_lambda_token_configured"),
                    current_config.get("engine_lambda_token_configured"),
                ),
            },
        )
        if runtime_apply_warning:
            current["runtime_apply_warning"] = runtime_apply_warning
        return current
    except Exception as exc:
        return error_response(500, "INTERNAL_ERROR", redact_text(str(exc)) or "Unable to update engine adapter settings")


@app.post("/v1/admin/system/engine-adapters/main/validate")
def validate_engine_adapter_settings(
    payload: dict,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    actor, claims = get_actor_and_claims(authorization)
    user_bearer_token = _extract_bearer_token(authorization)
    user_principal = _derive_gate_user_from_claims(claims)
    rate_limiter.check_read(actor.actor_id)
    role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "validate engine adapter settings")
    if role_error:
        return role_error

    normalized, errors = _parse_engine_adapter_payload(payload)
    if errors:
        return {
            "status": "INVALID",
            "summary": "Engine adapter settings are incomplete or inconsistent.",
            "errors": errors,
            "warnings": [],
        }
    assert normalized is not None
    candidate = _engine_adapter_validation_candidate(normalized)
    candidate_errors, candidate_warnings = _validate_engine_adapter_normalized(candidate)
    if candidate_errors:
        return {
            "status": "INVALID",
            "summary": "Engine adapter settings are incomplete or inconsistent.",
            "errors": candidate_errors,
            "warnings": candidate_warnings,
        }
    if normalized["mode"] != "stub" and not user_principal:
        return error_response(401, "UNAUTHORIZED", "Authenticated principal claim is required")
    if normalized["mode"] == "stub":
        return {
            "status": "WARNING",
            "summary": "Stub mode preserves local development behavior but does not perform a live Spinnaker connection check.",
            "errors": [],
            "warnings": candidate_warnings,
        }

    try:
        adapter = _spinnaker_from_normalized_engine_config(candidate)
        health = adapter.check_health(
            timeout_seconds=5,
            user_bearer_token=user_bearer_token,
            user_principal=user_principal,
        )
        if health.get("status") == "UP":
            return {
                "status": "VALID" if not candidate_warnings else "WARNING",
                "summary": "DXCP reached the configured Spinnaker Gate endpoint.",
                "errors": [],
                "warnings": candidate_warnings,
            }
        return {
            "status": "INVALID",
            "summary": "DXCP could not confirm the configured Spinnaker Gate endpoint.",
            "errors": [{"field": "gate_url", "message": "Gate health did not return an operational status."}],
            "warnings": candidate_warnings,
        }
    except Exception as exc:
        return {
            "status": "INVALID",
            "summary": "DXCP could not validate the configured Spinnaker connection.",
            "errors": [{"field": "gate_url", "message": redact_text(str(exc)) or "Connection attempt failed."}],
            "warnings": candidate_warnings,
        }


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


@app.get("/v1/whoami")
def whoami(request: Request, authorization: Optional[str] = Header(None)):
    actor, claims = get_actor_and_claims(authorization)
    rate_limiter.check_read(actor.actor_id)
    return {
        "actor_id": actor.actor_id,
        "sub": claims.get("sub"),
        "email": claims.get("email") or claims.get("https://dxcp.example/claims/email"),
        "iss": claims.get("iss"),
        "aud": claims.get("aud"),
        "azp": claims.get("azp"),
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
    actor, claims = get_actor_and_claims(authorization)
    user_bearer_token = _extract_bearer_token(authorization)
    user_principal = _derive_gate_user_from_claims(claims)
    if not user_principal:
        return error_response(401, "UNAUTHORIZED", "Authenticated principal claim is required")
    rate_limiter.check_read(actor.actor_id)
    role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "view engine mapping")
    if role_error:
        return role_error
    if spinnaker.mode != "http":
        return error_response(503, "ENGINE_UNAVAILABLE", "Spinnaker is not available in the current mode")
    try:
        apps = _call_gate_with_user_token(
            spinnaker.list_applications,
            user_bearer_token=user_bearer_token,
            user_principal=user_principal,
        )
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
    actor, claims = get_actor_and_claims(authorization)
    user_bearer_token = _extract_bearer_token(authorization)
    user_principal = _derive_gate_user_from_claims(claims)
    if not user_principal:
        return error_response(401, "UNAUTHORIZED", "Authenticated principal claim is required")
    rate_limiter.check_read(actor.actor_id)
    role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "view engine mapping")
    if role_error:
        return role_error
    if spinnaker.mode != "http":
        return error_response(503, "ENGINE_UNAVAILABLE", "Spinnaker is not available in the current mode")
    try:
        pipelines = _call_gate_with_user_token(
            spinnaker.list_pipeline_configs,
            application,
            user_bearer_token=user_bearer_token,
            user_principal=user_principal,
        )
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
    actor, claims = get_actor_and_claims(authorization)
    user_bearer_token = _extract_bearer_token(authorization)
    user_principal = _derive_gate_user_from_claims(claims)
    if not user_principal:
        return error_response(401, "UNAUTHORIZED", "Authenticated principal claim is required")
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
    recipe, execution_plan, recipe_error = resolve_recipe_execution_plan(deployment.get("recipeId") or "default", actor)
    if recipe_error:
        return recipe_error
    recipe_id = execution_plan.recipe_id
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
    cached = enforce_idempotency(request, idempotency_key)
    if cached:
        return cached
    max_concurrent = _environment_guardrail_value(group, env_entry, "max_concurrent_deployments", 1)
    daily_rollback_quota = _environment_guardrail_value(group, env_entry, "daily_rollback_quota", SETTINGS.daily_quota_rollback)
    rate_limiter.check_mutate(
        actor.actor_id,
        "rollback",
        quota_scope=_quota_scope(group["id"], env_entry.get("name")),
        quota_limit=daily_rollback_quota,
    )
    policy_snapshot = _policy_snapshot_for_environment(group, env_entry)
    _reap_stale_group_locks(
        group["id"],
        env_entry.get("name"),
        user_bearer_token=user_bearer_token,
        user_principal=user_principal,
    )
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
    payload = apply_execution_plan(payload, execution_plan, "rollback")
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
        execution = _invoke_engine(
            "rollback",
            payload,
            idempotency_key,
            user_bearer_token=user_bearer_token,
            user_principal=user_principal,
        )
    except Exception as exc:
        return _engine_error_response(actor, "Unable to start rollback", exc)
    execution_id, execution_url = _extract_engine_execution(execution)
    if not execution_id or not execution_url:
        return _engine_error_response(
            actor,
            "Unable to start rollback",
            RuntimeError("Spinnaker trigger failed: missing execution metadata"),
        )
    record = {
        "id": str(uuid.uuid4()),
        "service": deployment["service"],
        "environment": deployment["environment"],
        "version": prior["version"],
        "recipeId": execution_plan.recipe_id,
        "recipeRevision": execution_plan.recipe_revision,
        "effectiveBehaviorSummary": execution_plan.effective_behavior_summary,
        "state": "IN_PROGRESS",
        "deploymentKind": "ROLLBACK",
        "outcome": None,
        "intentCorrelationId": idempotency_key,
        "supersededBy": None,
        "changeSummary": f"rollback of {deployment_id} to {prior['version']}",
        "rollbackOf": deployment_id,
        "createdAt": utc_now(),
        "updatedAt": utc_now(),
        "engine_type": execution_plan.engine_type,
        "spinnakerExecutionId": execution_id,
        "spinnakerExecutionUrl": execution_url,
        "deliveryGroupId": group["id"],
        "actorIdentity": _deployment_actor_identity(actor, claims),
        "policySnapshot": policy_snapshot,
        "failures": [],
    }
    storage.insert_deployment(record, [])
    public_record = _deployment_public_view(actor, record)
    store_idempotency(request, idempotency_key, public_record, 201)
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
    return public_record


@app.post("/v1/builds/upload-capability", status_code=201)
def create_upload_capability(
    req: BuildUploadRequest,
    request: Request,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    authorization: Optional[str] = Header(None),
):
    actor, claims = get_actor_and_claims(authorization)
    guardrails.require_mutations_enabled()
    _, ci_error = require_ci_role_and_publisher(actor, claims, "request build upload capability")
    if ci_error:
        return ci_error
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


@app.get("/v1/builds")
def get_build(
    request: Request,
    service: str = Query(...),
    version: str = Query(...),
    authorization: Optional[str] = Header(None),
):
    actor = get_actor(authorization)
    rate_limiter.check_read(actor.actor_id)
    build = storage.find_latest_build(service, version)
    if not build:
        return error_response(404, "NOT_FOUND", "Build not found")
    return _build_public_view(build)


@app.post("/v1/builds", status_code=201)
def register_build(
    reg: BuildRegistration,
    request: Request,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    authorization: Optional[str] = Header(None),
):
    actor, claims = get_actor_and_claims(authorization)
    guardrails.require_mutations_enabled()
    publisher_name, ci_error = require_ci_role_and_publisher(actor, claims, "register builds")
    if ci_error:
        return ci_error
    guardrails.require_idempotency_key(idempotency_key)
    rate_limiter.check_mutate(actor.actor_id, "build_register")
    cached = enforce_idempotency(request, idempotency_key)
    if cached:
        return cached

    service_entry = guardrails.validate_service(reg.service)
    guardrails.validate_version(reg.version)
    try:
        built_at = _normalize_timestamp(reg.built_at)
    except ValueError:
        return error_response(
            400,
            "INVALID_BUILD_REGISTRATION",
            "built_at must be a valid ISO-8601 timestamp",
            details={"invalid_fields": ["built_at"]},
        )
    guardrails.validate_artifact(reg.sizeBytes, reg.sha256, reg.contentType)
    guardrails.validate_artifact_source(reg.artifactRef, service_entry)
    try:
        commit_url = _validate_optional_http_url("commit_url", reg.commit_url)
        run_url = _validate_optional_http_url("run_url", reg.run_url)
    except PolicyError as exc:
        return error_response(exc.status_code, exc.code, exc.message)

    existing = storage.find_latest_build(reg.service, reg.version)
    if existing:
        conflict = _build_registration_conflict(existing, reg.artifactRef, reg.git_sha)
        if conflict:
            return conflict
        response_payload = _build_public_view(existing)
        store_idempotency(request, idempotency_key, response_payload, 200)
        return JSONResponse(status_code=200, content=response_payload)

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
    record["built_at"] = built_at
    record["commit_url"] = commit_url
    record["run_url"] = run_url
    record["ci_publisher"] = publisher_name
    record["registeredAt"] = utc_now()
    record = storage.insert_build(record)
    logger.info(
        "event=build.registration.succeeded request_id=%s publisher_name=%s actor_id=%s sub=%s email=%s service=%s version=%s artifactRef=%s",
        request_id_ctx.get() or str(uuid.uuid4()),
        publisher_name,
        actor.actor_id,
        claims.get("sub"),
        claims.get("email") or claims.get("https://dxcp.example/claims/email"),
        record.get("service"),
        record.get("version"),
        record.get("artifactRef"),
    )
    storage.delete_upload_capability(cap["id"])
    response_payload = _build_public_view(record)
    store_idempotency(request, idempotency_key, response_payload, 201)
    return response_payload


@app.post("/v1/builds/register", status_code=201)
def register_existing_build(
    req: BuildRegisterExistingRequest,
    request: Request,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    authorization: Optional[str] = Header(None),
):
    actor, claims = get_actor_and_claims(authorization)
    guardrails.require_mutations_enabled()
    publisher_name, ci_error = require_ci_role_and_publisher(actor, claims, "register builds")
    if ci_error:
        return ci_error
    guardrails.require_idempotency_key(idempotency_key)
    rate_limiter.check_mutate(actor.actor_id, "build_register")
    request_fingerprint = _build_register_request_fingerprint(req)
    cached = enforce_idempotency(
        request,
        idempotency_key,
        request_fingerprint=request_fingerprint,
        conflict_code="BUILD_REGISTRATION_CONFLICT",
        conflict_message="Conflicting build registration for idempotency key",
    )
    if cached:
        return cached

    service_entry = guardrails.validate_service(req.service)
    guardrails.validate_version(req.version)
    try:
        built_at = _normalize_timestamp(req.built_at)
    except ValueError:
        return error_response(
            400,
            "INVALID_BUILD_REGISTRATION",
            "built_at must be a valid ISO-8601 timestamp",
            details={"invalid_fields": ["built_at"]},
        )
    guardrails.validate_artifact_source(req.artifactRef, service_entry)
    try:
        commit_url = _validate_optional_http_url("commit_url", req.commit_url)
        run_url = _validate_optional_http_url("run_url", req.run_url)
    except PolicyError as exc:
        return error_response(exc.status_code, exc.code, exc.message)

    existing = storage.find_latest_build(req.service, req.version)
    if existing:
        conflict = _build_registration_conflict(existing, req.artifactRef, req.git_sha)
        if conflict:
            return conflict
        response_payload = _build_public_view(existing)
        store_idempotency(
            request,
            idempotency_key,
            response_payload,
            200,
            request_fingerprint=request_fingerprint,
        )
        return JSONResponse(status_code=200, content=response_payload)

    try:
        record = _register_existing_build_internal(
            service_entry,
            req.service,
            req.version,
            req.artifactRef,
            req.s3Bucket,
            req.s3Key,
            req.git_sha,
            req.git_branch,
            req.ci_provider,
            req.ci_run_id,
            built_at,
            req.checksum_sha256,
            req.repo,
            req.actor,
            publisher_name,
            commit_url,
            run_url,
        )
    except ValueError as exc:
        return error_response(400, "INVALID_ARTIFACT", str(exc))
    except RuntimeError as exc:
        return error_response(500, "INTERNAL_ERROR", str(exc))

    logger.info(
        "event=build.registration.succeeded request_id=%s publisher_name=%s actor_id=%s sub=%s email=%s service=%s version=%s artifactRef=%s",
        request_id_ctx.get() or str(uuid.uuid4()),
        publisher_name,
        actor.actor_id,
        claims.get("sub"),
        claims.get("email") or claims.get("https://dxcp.example/claims/email"),
        record.get("service"),
        record.get("version"),
        record.get("artifactRef"),
    )
    response_payload = _build_public_view(record)
    store_idempotency(
        request,
        idempotency_key,
        response_payload,
        201,
        request_fingerprint=request_fingerprint,
    )
    return response_payload
