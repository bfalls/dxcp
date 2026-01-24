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

## Configuration

Set these env vars before running the dev server:

```
export VITE_API_BASE=http://127.0.0.1:8000/v1
export VITE_API_TOKEN=demo-token
export VITE_ALLOWLIST=demo-service
export VITE_SERVICE_URL_BASE=
```

Notes:
- Environment is fixed to sandbox.
- Version input is validated locally before submit.
- Rollback prompts for confirmation and uses idempotency keys.
