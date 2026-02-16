"""
# Discovery Notes (Temporary)

- `read_rpm` and `mutate_rpm` are loaded in `dxcp-api/config.py` via:
  - `Settings._get("read_rpm", "DXCP_READ_RPM", 60, int)`
  - `Settings._get("mutate_rpm", "DXCP_MUTATE_RPM", 10, int)`
- When `DXCP_SSM_PREFIX` is set, keys are read from:
  - `<DXCP_SSM_PREFIX>/read_rpm`
  - `<DXCP_SSM_PREFIX>/mutate_rpm`
- In AWS CDK defaults, this resolves to:
  - `/dxcp/config/read_rpm`
  - `/dxcp/config/mutate_rpm`
- Rate limiting is enforced in `dxcp-api/rate_limit.py`:
  - `check_read()` uses `SETTINGS.read_rpm`
  - `check_mutate()` uses `SETTINGS.mutate_rpm`
- Enforcement is invoked throughout request handlers in `dxcp-api/main.py`
  via `rate_limiter.check_read(...)` / `rate_limiter.check_mutate(...)`.
"""

import logging
import uuid
from typing import Callable, Optional

from fastapi import Header, Request

from config import SETTINGS
from models import Role

try:
    import boto3
    from botocore.config import Config
except Exception:  # pragma: no cover - optional dependency for local mode
    boto3 = None
    Config = None


MIN_RPM = 1
MAX_RPM = 5000
logger = logging.getLogger("dxcp.api")


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


def _read_rate_limits_from_ssm() -> dict:
    prefix = _ssm_prefix()
    read_rpm = _parse_rpm_value(_ssm_get_parameter(f"{prefix}/read_rpm"), "read_rpm", allow_string=True)
    mutate_rpm = _parse_rpm_value(_ssm_get_parameter(f"{prefix}/mutate_rpm"), "mutate_rpm", allow_string=True)
    return {"read_rpm": read_rpm, "mutate_rpm": mutate_rpm, "source": "ssm"}


def _write_rate_limits_to_ssm(read_rpm: int, mutate_rpm: int) -> None:
    prefix = _ssm_prefix()
    _ssm_put_parameter(f"{prefix}/read_rpm", str(read_rpm))
    _ssm_put_parameter(f"{prefix}/mutate_rpm", str(mutate_rpm))


def _validate_update_payload(payload: object) -> tuple[Optional[dict], Optional[str]]:
    if not isinstance(payload, dict):
        return None, "Payload must be an object"
    if "read_rpm" not in payload or "mutate_rpm" not in payload:
        return None, "read_rpm and mutate_rpm are required"
    try:
        read_rpm = _parse_rpm_value(payload.get("read_rpm"), "read_rpm")
        mutate_rpm = _parse_rpm_value(payload.get("mutate_rpm"), "mutate_rpm")
    except ValueError as exc:
        return None, str(exc)
    return {"read_rpm": read_rpm, "mutate_rpm": mutate_rpm}, None


def register_admin_system_routes(
    app,
    *,
    get_actor: Callable,
    request_id_provider: Callable[[], str],
    rate_limiter,
    require_role: Callable,
    error_response: Callable,
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
        actor = get_actor(authorization)
        rate_limiter.check_mutate(actor.actor_id, "admin_system_rate_limits_update")
        role_error = require_role(actor, {Role.PLATFORM_ADMIN}, "update system rate limits")
        if role_error:
            return role_error
        validated, validation_error = _validate_update_payload(payload)
        if validation_error:
            return error_response(400, "INVALID_REQUEST", validation_error)
        try:
            old_values = _read_rate_limits_from_ssm()
            _write_rate_limits_to_ssm(validated["read_rpm"], validated["mutate_rpm"])
            SETTINGS.read_rpm = validated["read_rpm"]
            SETTINGS.mutate_rpm = validated["mutate_rpm"]
            if hasattr(rate_limiter, "set_runtime_limits"):
                rate_limiter.set_runtime_limits(validated["read_rpm"], validated["mutate_rpm"])
            new_values = {"read_rpm": validated["read_rpm"], "mutate_rpm": validated["mutate_rpm"], "source": "ssm"}
            request_id = request_id_provider() or request.headers.get("X-Request-Id") or str(uuid.uuid4())
            logger.info(
                "event=admin.system_rate_limits.updated request_id=%s actor_id=%s actor_role=%s old_read_rpm=%s old_mutate_rpm=%s new_read_rpm=%s new_mutate_rpm=%s",
                request_id,
                actor.actor_id,
                actor.role.value,
                old_values["read_rpm"],
                old_values["mutate_rpm"],
                new_values["read_rpm"],
                new_values["mutate_rpm"],
            )
            return new_values
        except ValueError as exc:
            return error_response(500, "INTERNAL_ERROR", str(exc))
        except Exception:
            return error_response(500, "INTERNAL_ERROR", "Unable to update system rate limits in SSM")
