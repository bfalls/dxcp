# @dxcp/backstage-plugin-backend

Backend router for DXCP integration.

Provides:

/api/dxcp/\*

## Responsibilities

If your DXCP deployment does not issue non-interactive tokens, this backend plugin is not applicable.

-   Validate Backstage credentials
-   Fetch service access token
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
