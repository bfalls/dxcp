"""
# Discovery Notes (Temporary)

- `read_rpm` and `mutate_rpm` are loaded in `dxcp-api/config.py` via:
- `read_rpm`, `mutate_rpm`, and `daily_quota_build_register` are loaded in `dxcp-api/config.py` via:
  - `Settings._get("read_rpm", "DXCP_READ_RPM", 60, int)`
  - `Settings._get("mutate_rpm", "DXCP_MUTATE_RPM", 10, int)`
  - `Settings._get("daily_quota_build_register", "DXCP_DAILY_QUOTA_BUILD_REGISTER", 50, int)`
- When `DXCP_SSM_PREFIX` is set, keys are read from:
  - `<DXCP_SSM_PREFIX>/read_rpm`
  - `<DXCP_SSM_PREFIX>/mutate_rpm`
  - `<DXCP_SSM_PREFIX>/daily_quota_build_register`
- In AWS CDK defaults, this resolves to:
  - `/dxcp/config/read_rpm`
  - `/dxcp/config/mutate_rpm`
  - `/dxcp/config/daily_quota_build_register`
- Rate limiting is enforced in `dxcp-api/rate_limit.py`:
  - `check_read()` uses `SETTINGS.read_rpm`
  - `check_mutate()` uses `SETTINGS.mutate_rpm`
  - `check_mutate(..., quota_key="build_register")` uses `daily_quota_build_register`
- Enforcement is invoked throughout request handlers in `dxcp-api/main.py`
  via `rate_limiter.check_read(...)` / `rate_limiter.check_mutate(...)`.
"""

import logging
import json
import os
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

from fastapi import Header, Request

from config import SETTINGS
from models import CiPublisher, CiPublisherProvider, Role
from policy import PolicyError

try:
    import boto3
    from botocore.config import Config
except Exception:  # pragma: no cover - optional dependency for local mode
    boto3 = None
    Config = None


MIN_RPM = 1
MAX_RPM = 5000
MIN_DAILY_QUOTA_BUILD_REGISTER = 0
MAX_DAILY_QUOTA_BUILD_REGISTER = 5000
DEFAULT_DAILY_QUOTA_BUILD_REGISTER = 50
logger = logging.getLogger("dxcp.api")
UI_EXPOSURE_POLICY_KEY = "/dxcp/policy/ui/exposure"


def _ui_exposure_policy_key() -> str:
    prefix = (SETTINGS.ssm_prefix or "").strip().rstrip("/")
    if prefix:
        return f"{prefix}/policy/ui/exposure"
    return UI_EXPOSURE_POLICY_KEY


def _ssm_client():
    if not boto3:
        raise RuntimeError("boto3 is required for SSM operations")
    if Config:
        cfg = Config(connect_timeout=1, read_timeout=1, retries={"max_attempts": 1, "mode": "standard"})
        try:
            return boto3.client("ssm", config=cfg)
        except TypeError:
            # Test doubles may not accept boto3 kwargs.
            return boto3.client("ssm")
    return boto3.client("ssm")


def _ssm_prefix() -> str:
    prefix = (SETTINGS.ssm_prefix or "").strip().rstrip("/")
    if not prefix:
        raise RuntimeError("DXCP_SSM_PREFIX is required for admin system rate limits")
    return prefix


def _ssm_get_parameter(name: str) -> str:
    response = _ssm_client().get_parameter(Name=name, WithDecryption=True)
    value = response.get("Parameter", {}).get("Value")
    if value is None:
        raise RuntimeError(f"SSM parameter missing value: {name}")
    return value


def _ssm_put_parameter(name: str, value: str) -> None:
    _ssm_client().put_parameter(Name=name, Value=value, Type="String", Overwrite=True)


def _parse_boolean(value: object, field: str, allow_string: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if allow_string and isinstance(value, str):
        text = value.strip().lower()
        if text in {"1", "true"}:
            return True
        if text in {"0", "false"}:
            return False
    raise ValueError(f"{field} must be a boolean")


def _read_mutations_disabled_from_ssm() -> dict:
    prefix = _ssm_prefix()
    raw = _ssm_get_parameter(f"{prefix}/mutations_disabled")
    parsed = _parse_boolean(raw, "mutations_disabled", allow_string=True)
    return {"mutations_disabled": parsed, "source": "ssm"}


def read_mutations_disabled_with_fallback() -> dict:
    try:
        return _read_mutations_disabled_from_ssm()
    except Exception:
        return {"mutations_disabled": bool(SETTINGS.mutations_disabled), "source": "runtime"}


def _write_mutations_disabled_to_ssm(value: bool) -> None:
    prefix = _ssm_prefix()
    _ssm_put_parameter(f"{prefix}/mutations_disabled", "true" if value else "false")


def _default_ui_exposure_policy() -> dict:
    return {
        "artifactRef": {
            "display": False,
        },
        "externalLinks": {
            "display": False,
        },
    }


def _parse_ui_exposure_policy(value: object) -> dict:
    parsed: object = value
    if isinstance(value, str):
        parsed = json.loads(value)
    if not isinstance(parsed, dict):
        raise ValueError("policy must be an object")
    artifact_ref_value = parsed.get("artifactRef")
    artifact_ref_display = False
    if isinstance(artifact_ref_value, dict):
        if "display" in artifact_ref_value:
            candidate = artifact_ref_value.get("display")
            if not isinstance(candidate, bool):
                raise ValueError("artifactRef.display must be a boolean")
            artifact_ref_display = candidate
    elif artifact_ref_value is not None:
        raise ValueError("artifactRef must be an object")
    external_links_value = parsed.get("externalLinks")
    external_links_display = False
    if isinstance(external_links_value, dict):
        if "display" in external_links_value:
            candidate = external_links_value.get("display")
            if not isinstance(candidate, bool):
                raise ValueError("externalLinks.display must be a boolean")
            external_links_display = candidate
    elif external_links_value is not None:
        raise ValueError("externalLinks must be an object")
    return {
        "artifactRef": {"display": artifact_ref_display},
        "externalLinks": {"display": external_links_display},
    }


def _read_ui_exposure_policy_from_ssm() -> dict:
    try:
        raw = _ssm_get_parameter(_ui_exposure_policy_key())
    except Exception:
        return {"policy": _default_ui_exposure_policy(), "source": "ssm"}
    policy = _parse_ui_exposure_policy(raw)
    return {"policy": policy, "source": "ssm"}


def read_ui_exposure_policy() -> dict:
    return _read_ui_exposure_policy_from_ssm().get("policy", _default_ui_exposure_policy())


def _write_ui_exposure_policy_to_ssm(policy: dict) -> None:
    normalized = _parse_ui_exposure_policy(policy)
    _ssm_put_parameter(_ui_exposure_policy_key(), json.dumps(normalized))


def _parse_rpm_value(value: object, field: str, allow_string: bool = False) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{field} must be an integer")
    if isinstance(value, int):
        parsed = value
    elif allow_string and isinstance(value, str):
        parsed = int(value.strip())
    else:
        raise ValueError(f"{field} must be an integer")
    if parsed < MIN_RPM or parsed > MAX_RPM:
        raise ValueError(f"{field} must be between {MIN_RPM} and {MAX_RPM}")
    return parsed


def _parse_daily_quota_build_register_value(value: object, field: str, allow_string: bool = False) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{field} must be an integer")
    if isinstance(value, int):
        parsed = value
    elif allow_string and isinstance(value, str):
        parsed = int(value.strip())
    else:
        raise ValueError(f"{field} must be an integer")
    if parsed < MIN_DAILY_QUOTA_BUILD_REGISTER or parsed > MAX_DAILY_QUOTA_BUILD_REGISTER:
        raise ValueError(
            f"{field} must be between {MIN_DAILY_QUOTA_BUILD_REGISTER} and {MAX_DAILY_QUOTA_BUILD_REGISTER}"
        )
    return parsed


def _fallback_daily_quota_build_register() -> int:
    raw = os.getenv("DXCP_DAILY_QUOTA_BUILD_REGISTER")
    if raw is None:
        return DEFAULT_DAILY_QUOTA_BUILD_REGISTER
    try:
        return _parse_daily_quota_build_register_value(raw, "daily_quota_build_register", allow_string=True)
    except Exception:
        return DEFAULT_DAILY_QUOTA_BUILD_REGISTER


def _read_rate_limits_from_ssm() -> dict:
    prefix = _ssm_prefix()
    read_rpm = _parse_rpm_value(_ssm_get_parameter(f"{prefix}/read_rpm"), "read_rpm", allow_string=True)
    mutate_rpm = _parse_rpm_value(_ssm_get_parameter(f"{prefix}/mutate_rpm"), "mutate_rpm", allow_string=True)
    daily_raw = None
    try:
        daily_raw = _ssm_get_parameter(f"{prefix}/daily_quota_build_register")
    except Exception:
        daily_raw = None
    if daily_raw is None:
        daily_quota_build_register = _fallback_daily_quota_build_register()
    else:
        daily_quota_build_register = _parse_daily_quota_build_register_value(
            daily_raw,
            "daily_quota_build_register",
            allow_string=True,
        )
    return {
        "read_rpm": read_rpm,
        "mutate_rpm": mutate_rpm,
        "daily_quota_build_register": daily_quota_build_register,
        "source": "ssm",
    }


def _read_rate_limits_from_ssm_for_audit() -> dict:
    """Best-effort read for audit logging; tolerates invalid existing values."""
    prefix = _ssm_prefix()
    read_raw = _ssm_get_parameter(f"{prefix}/read_rpm")
    mutate_raw = _ssm_get_parameter(f"{prefix}/mutate_rpm")
    try:
        daily_raw = _ssm_get_parameter(f"{prefix}/daily_quota_build_register")
    except Exception:
        daily_raw = _fallback_daily_quota_build_register()

    def _coerce_int(value: str):
        try:
            return int(str(value).strip())
        except Exception:
            return value

    return {
        "read_rpm": _coerce_int(read_raw),
        "mutate_rpm": _coerce_int(mutate_raw),
        "daily_quota_build_register": _coerce_int(daily_raw),
        "source": "ssm",
    }


def _write_rate_limits_to_ssm(read_rpm: int, mutate_rpm: int, daily_quota_build_register: int) -> None:
    prefix = _ssm_prefix()
    _ssm_put_parameter(f"{prefix}/read_rpm", str(read_rpm))
    _ssm_put_parameter(f"{prefix}/mutate_rpm", str(mutate_rpm))
    _ssm_put_parameter(f"{prefix}/daily_quota_build_register", str(daily_quota_build_register))


def _publisher_to_dict(publisher: CiPublisher) -> dict:
    return publisher.dict(exclude_none=True)


def _read_ci_publishers_from_ssm() -> dict:
    prefix = _ssm_prefix()
    raw = _ssm_get_parameter(f"{prefix}/ci_publishers")
    parsed = json.loads(raw)
    if not isinstance(parsed, list):
        raise ValueError("ci_publishers SSM value must be a JSON array")
    publishers: list[dict] = []
    for item in parsed:
        if not isinstance(item, dict):
            raise ValueError("ci_publishers SSM array must contain publisher objects")
        payload = dict(item)
        if "provider" not in payload:
            payload["provider"] = CiPublisherProvider.CUSTOM.value
        publishers.append(_publisher_to_dict(CiPublisher(**payload)))
    return {"publishers": publishers, "source": "ssm"}


def _read_ci_publishers_with_fallback() -> dict:
    try:
        return _read_ci_publishers_from_ssm()
    except Exception:
        logger.warning("event=admin.system_ci_publishers.read_fallback source=runtime")
        runtime = []
        for publisher in list(SETTINGS.ci_publishers):
            if isinstance(publisher, CiPublisher):
                runtime.append(_publisher_to_dict(publisher))
            elif isinstance(publisher, dict):
                try:
                    runtime.append(_publisher_to_dict(CiPublisher(**publisher)))
                except Exception:
                    continue
        return {"publishers": runtime, "source": "runtime"}


def _write_ci_publishers_to_ssm(publishers: list[CiPublisher]) -> None:
    prefix = _ssm_prefix()
    payload = json.dumps([_publisher_to_dict(publisher) for publisher in publishers])
    _ssm_put_parameter(f"{prefix}/ci_publishers", payload)


def _validate_update_payload(payload: object) -> tuple[Optional[dict], Optional[str]]:
    if not isinstance(payload, dict):
        return None, "Payload must be an object"
    if "read_rpm" not in payload or "mutate_rpm" not in payload or "daily_quota_build_register" not in payload:
        return None, "read_rpm, mutate_rpm, and daily_quota_build_register are required"
    try:
        read_rpm = _parse_rpm_value(payload.get("read_rpm"), "read_rpm")
        mutate_rpm = _parse_rpm_value(payload.get("mutate_rpm"), "mutate_rpm")
        daily_quota_build_register = _parse_daily_quota_build_register_value(
            payload.get("daily_quota_build_register"),
            "daily_quota_build_register",
        )
    except ValueError as exc:
        return None, str(exc)
    return {
        "read_rpm": read_rpm,
        "mutate_rpm": mutate_rpm,
        "daily_quota_build_register": daily_quota_build_register,
    }, None


def _validate_ci_publishers_payload(payload: object) -> tuple[Optional[list[CiPublisher]], Optional[str]]:
    if not isinstance(payload, dict):
        return None, "Payload must be an object"
    if "publishers" not in payload:
        return None, "publishers is required"
    values = payload.get("publishers")
    if not isinstance(values, list):
        return None, "publishers must be an array of publisher objects"
    cleaned: list[CiPublisher] = []
    seen_names: set[str] = set()
    for value in values:
        if not isinstance(value, dict):
            return None, "publishers must be an array of publisher objects"
        payload_item = dict(value)
        if "provider" not in payload_item:
            payload_item["provider"] = CiPublisherProvider.CUSTOM.value
        try:
            publisher = CiPublisher(**payload_item)
        except Exception:
            return None, "publishers must be valid publisher objects"
        name = publisher.name.strip()
        if not name:
            return None, "publishers must have a non-empty name"
        publisher.name = name
        if publisher.name in seen_names:
            return None, "publisher names must be unique"
        seen_names.add(publisher.name)
        cleaned.append(publisher)
    return cleaned, None


def _validate_ui_exposure_policy_payload(payload: object) -> tuple[Optional[dict], Optional[str]]:
    if not isinstance(payload, dict):
        return None, "Payload must be an object"
    try:
        normalized = _parse_ui_exposure_policy(payload)
    except ValueError as exc:
        return None, str(exc)
    return normalized, None


def _validate_mutations_disabled_payload(payload: object) -> tuple[Optional[dict], Optional[str]]:
    if not isinstance(payload, dict):
        return None, "Payload must be an object"
    if "mutations_disabled" not in payload:
        return None, "mutations_disabled is required"
    try:
        mutations_disabled = _parse_boolean(payload.get("mutations_disabled"), "mutations_disabled")
    except ValueError as exc:
        return None, str(exc)
    reason = payload.get("reason")
    normalized_reason: Optional[str] = None
    if reason is not None:
        if not isinstance(reason, str):
            return None, "reason must be a string"
        stripped = reason.strip()
        if stripped:
            normalized_reason = stripped
    return {"mutations_disabled": mutations_disabled, "reason": normalized_reason}, None


def _audit_admin_config_changes(
    *,
    actor,
    claims: dict,
    request: Request,
    request_id_provider: Callable[[], str],
    changes: dict[str, tuple[object, object]],
    record_audit_event: Optional[Callable[[dict], None]],
    reason: Optional[str] = None,
) -> None:
    request_id = request_id_provider() or request.headers.get("X-Request-Id") or str(uuid.uuid4())
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
        if reason is not None:
            detail["reason"] = reason
        logger.info(
            "event=admin.config_change request_id=%s actor_id=%s actor_sub=%s actor_email=%s actor_azp=%s actor_role=%s setting_key=%s old_value=%s new_value=%s timestamp=%s",
            request_id,
            actor.actor_id,
            actor_sub,
            actor_email,
            actor_azp,
            actor.role.value,
            setting_key,
            old_value,
            new_value,
            timestamp,
        )
        if callable(record_audit_event):
            record_audit_event(
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


def register_admin_system_routes(
    app,
    *,
    get_actor: Callable,
    get_actor_and_claims: Callable,
    guardrails,
    request_id_provider: Callable[[], str],
    rate_limiter,
    require_role: Callable,
    error_response: Callable,
    record_audit_event: Optional[Callable[[dict], None]] = None,
) -> None:
    @app.get("/v1/admin/system/rate-limits")
    def get_system_rate_limits(request: Request, authorization: Optional[str] = Header(None)):
        actor = get_actor(authorization)
        rate_limiter.check_read(actor.actor_id)
        role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "view system rate limits")
        if role_error:
            return role_error
        try:
            return _read_rate_limits_from_ssm()
        except ValueError as exc:
            return error_response(500, "INTERNAL_ERROR", str(exc))
        except Exception:
            return error_response(500, "INTERNAL_ERROR", "Unable to read system rate limits from SSM")

    @app.put("/v1/admin/system/rate-limits")
    def update_system_rate_limits(
        payload: dict,
        request: Request,
        authorization: Optional[str] = Header(None),
    ):
        actor, claims = get_actor_and_claims(authorization)
        rate_limiter.check_mutate(actor.actor_id, "admin_system_rate_limits_update")
        role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "update system rate limits")
        if role_error:
            return role_error
        try:
            guardrails.require_mutations_enabled()
        except PolicyError as exc:
            return error_response(exc.status_code, exc.code, exc.message)
        validated, validation_error = _validate_update_payload(payload)
        if validation_error:
            return error_response(400, "INVALID_REQUEST", validation_error)
        try:
            old_values = _read_rate_limits_from_ssm_for_audit()
            _write_rate_limits_to_ssm(
                validated["read_rpm"],
                validated["mutate_rpm"],
                validated["daily_quota_build_register"],
            )
            SETTINGS.read_rpm = validated["read_rpm"]
            SETTINGS.mutate_rpm = validated["mutate_rpm"]
            SETTINGS.daily_quota_build_register = validated["daily_quota_build_register"]
            if hasattr(rate_limiter, "set_runtime_limits"):
                rate_limiter.set_runtime_limits(validated["read_rpm"], validated["mutate_rpm"])
            if hasattr(rate_limiter, "set_runtime_build_register_quota"):
                rate_limiter.set_runtime_build_register_quota(validated["daily_quota_build_register"])
            new_values = {
                "read_rpm": validated["read_rpm"],
                "mutate_rpm": validated["mutate_rpm"],
                "daily_quota_build_register": validated["daily_quota_build_register"],
                "source": "ssm",
            }
            _audit_admin_config_changes(
                actor=actor,
                claims=claims,
                request=request,
                request_id_provider=request_id_provider,
                changes={
                    "read_rpm": (old_values.get("read_rpm"), new_values["read_rpm"]),
                    "mutate_rpm": (old_values.get("mutate_rpm"), new_values["mutate_rpm"]),
                    "daily_quota_build_register": (
                        old_values.get("daily_quota_build_register"),
                        new_values["daily_quota_build_register"],
                    ),
                },
                record_audit_event=record_audit_event,
            )
            return new_values
        except ValueError as exc:
            return error_response(500, "INTERNAL_ERROR", str(exc))
        except Exception:
            return error_response(500, "INTERNAL_ERROR", "Unable to update system rate limits in SSM")

    @app.get("/v1/admin/system/ci-publishers")
    def get_system_ci_publishers(request: Request, authorization: Optional[str] = Header(None)):
        actor = get_actor(authorization)
        rate_limiter.check_read(actor.actor_id)
        role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "view system CI publishers")
        if role_error:
            return role_error
        return _read_ci_publishers_with_fallback()

    @app.put("/v1/admin/system/ci-publishers")
    def update_system_ci_publishers(
        payload: dict,
        request: Request,
        idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
        authorization: Optional[str] = Header(None),
    ):
        actor, claims = get_actor_and_claims(authorization)
        rate_limiter.check_mutate(actor.actor_id, "admin_system_ci_publishers_update")
        role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "update system CI publishers")
        if role_error:
            return role_error
        try:
            guardrails.require_mutations_enabled()
            guardrails.require_idempotency_key(idempotency_key)
        except PolicyError as exc:
            return error_response(exc.status_code, exc.code, exc.message)
        validated, validation_error = _validate_ci_publishers_payload(payload)
        if validation_error:
            return error_response(400, "INVALID_REQUEST", validation_error)
        try:
            old_values = _read_ci_publishers_with_fallback()
            _write_ci_publishers_to_ssm(validated)
            SETTINGS.ci_publishers = list(validated)
            new_values = {
                "publishers": [_publisher_to_dict(publisher) for publisher in validated],
                "source": "ssm",
            }
            _audit_admin_config_changes(
                actor=actor,
                claims=claims,
                request=request,
                request_id_provider=request_id_provider,
                changes={
                    "ci_publishers": (
                        old_values.get("publishers", []),
                        new_values["publishers"],
                    ),
                },
                record_audit_event=record_audit_event,
            )
            return new_values
        except Exception:
            return error_response(500, "INTERNAL_ERROR", "Unable to update system CI publishers in SSM")

    @app.get("/v1/admin/system/ui-exposure-policy")
    def get_system_ui_exposure_policy(request: Request, authorization: Optional[str] = Header(None)):
        actor = get_actor(authorization)
        rate_limiter.check_read(actor.actor_id)
        role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "view system UI exposure policy")
        if role_error:
            return role_error
        try:
            return _read_ui_exposure_policy_from_ssm()
        except ValueError as exc:
            return error_response(500, "INTERNAL_ERROR", str(exc))
        except Exception:
            return error_response(500, "INTERNAL_ERROR", "Unable to read system UI exposure policy from SSM")

    @app.put("/v1/admin/system/ui-exposure-policy")
    def update_system_ui_exposure_policy(
        payload: dict,
        request: Request,
        authorization: Optional[str] = Header(None),
    ):
        actor, claims = get_actor_and_claims(authorization)
        rate_limiter.check_mutate(actor.actor_id, "admin_system_ui_exposure_policy_update")
        role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "update system UI exposure policy")
        if role_error:
            return role_error
        try:
            guardrails.require_mutations_enabled()
        except PolicyError as exc:
            return error_response(exc.status_code, exc.code, exc.message)
        validated, validation_error = _validate_ui_exposure_policy_payload(payload)
        if validation_error:
            return error_response(400, "INVALID_REQUEST", validation_error)
        try:
            try:
                old_policy = _read_ui_exposure_policy_from_ssm().get("policy", _default_ui_exposure_policy())
            except Exception:
                old_policy = _default_ui_exposure_policy()
            _write_ui_exposure_policy_to_ssm(validated)
            _audit_admin_config_changes(
                actor=actor,
                claims=claims,
                request=request,
                request_id_provider=request_id_provider,
                changes={"ui_exposure_policy": (old_policy, validated)},
                record_audit_event=record_audit_event,
            )
            return {"policy": validated, "source": "ssm"}
        except ValueError as exc:
            return error_response(500, "INTERNAL_ERROR", str(exc))
        except Exception:
            return error_response(500, "INTERNAL_ERROR", "Unable to update system UI exposure policy in SSM")

    @app.get("/v1/admin/system/mutations-disabled")
    def get_system_mutations_disabled(request: Request, authorization: Optional[str] = Header(None)):
        actor = get_actor(authorization)
        rate_limiter.check_read(actor.actor_id)
        role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "view system mutation kill switch")
        if role_error:
            return role_error
        return read_mutations_disabled_with_fallback()

    def _update_mutations_disabled(
        payload: dict,
        request: Request,
        authorization: Optional[str] = Header(None),
    ):
        actor, claims = get_actor_and_claims(authorization)
        rate_limiter.check_mutate(actor.actor_id, "admin_system_mutations_disabled_update")
        role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "update system mutation kill switch")
        if role_error:
            return role_error
        validated, validation_error = _validate_mutations_disabled_payload(payload)
        if validation_error:
            return error_response(400, "INVALID_REQUEST", validation_error)
        try:
            old_values = read_mutations_disabled_with_fallback()
            old_value = bool(old_values.get("mutations_disabled"))
            new_value = bool(validated["mutations_disabled"])
            _write_mutations_disabled_to_ssm(new_value)
            SETTINGS.mutations_disabled = new_value
            SETTINGS.kill_switch = new_value
            _audit_admin_config_changes(
                actor=actor,
                claims=claims,
                request=request,
                request_id_provider=request_id_provider,
                changes={"mutations_disabled": (old_value, new_value)},
                reason=validated.get("reason"),
                record_audit_event=record_audit_event,
            )
            return {"mutations_disabled": new_value, "source": "ssm"}
        except ValueError as exc:
            return error_response(500, "INTERNAL_ERROR", str(exc))
        except Exception:
            return error_response(500, "INTERNAL_ERROR", "Unable to update system mutation kill switch in SSM")

    @app.put("/v1/admin/system/mutations-disabled")
    def update_system_mutations_disabled_put(
        payload: dict,
        request: Request,
        authorization: Optional[str] = Header(None),
    ):
        return _update_mutations_disabled(payload, request, authorization)

    @app.patch("/v1/admin/system/mutations-disabled")
    def update_system_mutations_disabled_patch(
        payload: dict,
        request: Request,
        authorization: Optional[str] = Header(None),
    ):
        return _update_mutations_disabled(payload, request, authorization)

    @app.get("/v1/ui/policy/ui-exposure")
    def get_ui_exposure_policy(request: Request, authorization: Optional[str] = Header(None)):
        actor = get_actor(authorization)
        rate_limiter.check_read(actor.actor_id)
        try:
            return _read_ui_exposure_policy_from_ssm()
        except ValueError as exc:
            return error_response(500, "INTERNAL_ERROR", str(exc))
        except Exception:
            return error_response(500, "INTERNAL_ERROR", "Unable to read UI exposure policy from SSM")
