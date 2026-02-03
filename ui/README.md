# DXCP UI (Phase 5)

This is a minimal React UI for DXCP with deploy, deployments list, detail, failures, and rollback.

## Local run

Install dependencies:

```
cd dxcp/ui
npm install
```

Start dev server:

```
npm run dev
```

Open http://127.0.0.1:5173

## Tests

Run UI tests:

```
npm run test:run
```

## Configuration

Create `ui/.env.local` with the Auth0 and API configuration:

```
VITE_API_BASE=http://127.0.0.1:8000
VITE_AUTH0_DOMAIN=<tenant>.us.auth0.com
VITE_AUTH0_CLIENT_ID=<client_id>
VITE_AUTH0_AUDIENCE=https://dxcp-api
VITE_AUTH0_ROLES_CLAIM=https://dxcp.example/claims/roles
VITE_SERVICE_URL_BASE=
```

Notes:
- Environment is fixed to sandbox.
- Version input is validated locally before submit.
- Rollback prompts for confirmation and uses idempotency keys.
- Services come from the backend registry (/v1/services).
- Production uses /config.json for runtime Auth0 and API configuration (see docs/AUTH.md).
