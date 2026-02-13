# @dxcp/backstage-plugin-backend

Backend router for DXCP integration.

Provides:

/api/dxcp/\*

## Responsibilities

-   Validate Backstage credentials
-   Exchange M2M token
-   Call DXCP API
-   Return JSON

## Health Check

GET /api/dxcp/health

Returns:

{ "status": "ok" }

## Common Errors

401 Missing credentials → frontend token not forwarded HTML instead of
JSON → proxy not configured AUTHZ_ROLE_REQUIRED → missing roles claim in
Auth0
