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

from typing import Callable, Optional

from fastapi import Header, Request

from models import Role


def register_admin_system_routes(
    app,
    *,
    get_actor: Callable,
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
        return error_response(501, "NOT_IMPLEMENTED", "Admin system rate limits API is not implemented yet")

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
        return error_response(501, "NOT_IMPLEMENTED", "Admin system rate limits API is not implemented yet")
