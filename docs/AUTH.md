# DXCP Auth0 setup (local)

This guide configures Auth0 for local DXCP UI + API testing. DXCP validates
JWTs via JWKS and derives DXCP roles from a custom claim in the access token.

## Auth0 prerequisites (dashboard)

Auth0 SPA application:
- Allowed Callback URLs: http://localhost:5173
- Allowed Logout URLs: http://localhost:5173
- Allowed Web Origins: http://localhost:5173

Auth0 API (resource server):
- Identifier (audience): https://dxcp-api
- Signing algorithm: RS256

Auth0 roles created and assigned to users:
- dxcp-platform-admins
- dxcp-observers

Auth0 Post-Login Action (add roles to access token):
```
exports.onExecutePostLogin = async (event, api) => {
  const ns = "https://dxcp.example/claims";
  const roles = event.authorization?.roles || [];
  api.accessToken.setCustomClaim(`${ns}/roles`, roles);
  if (event.user?.email) api.accessToken.setCustomClaim(`${ns}/email`, event.user.email);
};
```

Authorize the DXCP UI application to call the DXCP API:
- Applications -> DXCP UI -> APIs -> Authorize DXCP API (User Access)

## Local environment variables

API:
- DXCP_OIDC_ISSUER=https://<tenant>.us.auth0.com/
- DXCP_OIDC_AUDIENCE=https://dxcp-api
- DXCP_OIDC_JWKS_URL=https://<tenant>.us.auth0.com/.well-known/jwks.json
- DXCP_OIDC_ROLES_CLAIM=https://dxcp.example/claims/roles

Example file: dxcp-api/.env.example

Run with env file:
```
uvicorn main:app --reload --port 8000 --env-file .env
```

UI (.env.local in ui/):
- VITE_API_BASE=http://localhost:8000
- VITE_AUTH0_DOMAIN=<tenant>.us.auth0.com
- VITE_AUTH0_CLIENT_ID=<client_id>
- VITE_AUTH0_AUDIENCE=https://dxcp-api
- VITE_AUTH0_ROLES_CLAIM=https://dxcp.example/claims/roles

## Notes

- All protected endpoints require Authorization: Bearer <JWT>.
- JWTs must be issued by the configured issuer and audience.
- DXCP roles are derived from the roles claim in the access token.
- The UI shows a derived role for convenience; the API is authoritative.
