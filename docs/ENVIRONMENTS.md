# DXCP environments

Use one code path across environments. Differences are config-only.
Local uses env files. AWS uses SSM when `DXCP_SSM_PREFIX` is set.

---

## Set local env (API)

Create `dxcp-api/.env` from `dxcp-api/.env.example`.

Required:
- DXCP_OIDC_ISSUER
- DXCP_OIDC_AUDIENCE
- DXCP_OIDC_ROLES_CLAIM

Optional:
- DXCP_OIDC_JWKS_URL
- DXCP_UI_DEFAULT_REFRESH_SECONDS (default 300)
- DXCP_UI_MIN_REFRESH_SECONDS (default 60)
- DXCP_UI_MAX_REFRESH_SECONDS (default 3600)
- DXCP_SPINNAKER_GATE_URL (required only if testing engine calls)
- DXCP_RUNTIME_ARTIFACT_BUCKET (required only for version refresh)

Notes:
- Leave `DXCP_SSM_PREFIX` unset for local runs.
- Auth0 is real (no mock).

---

## Set local env (UI)

Create `ui/.env.local` from `ui/.env.example`.

Required:
- VITE_API_BASE
- VITE_AUTH0_DOMAIN
- VITE_AUTH0_CLIENT_ID
- VITE_AUTH0_AUDIENCE
- VITE_AUTH0_ROLES_CLAIM

Optional:
- VITE_BACKSTAGE_BASE_URL

---

## Run local

API:
1. `cd dxcp-api`
2. `pip install -r requirements.txt`
3. `uvicorn main:app --reload --env-file .env`

UI:
1. `cd ui`
2. `npm install`
3. `npm run dev`

---

## Set AWS env

Set `DXCP_SSM_PREFIX` (example: `/dxcp/config`).
Do not use interactive CDK in prod.

---

## Bootstrap AWS config

Use the bootstrap script to populate SSM once:
1. `export DXCP_SSM_PREFIX=/dxcp/config`
2. `./scripts/bootstrap_config.sh`

Notes:
- Script is idempotent and will not overwrite without confirmation.
- Values are not echoed back to the console.
- `deploy_aws.sh` and `bootstrap_config.sh` share SSM helpers and the same prefix logic.
- `deploy_aws.sh` fails fast if required SSM parameters are missing.

---

## Store SSM parameters

Store values under `DXCP_SSM_PREFIX` using keys from `dxcp-api/config.py`.
Examples:
- `oidc/issuer`
- `oidc/audience`
- `oidc/jwks_url`
- `oidc/roles_claim`
- `ui_default_refresh_seconds`
- `ui_min_refresh_seconds`
- `ui_max_refresh_seconds`
- `runtime/artifact_bucket`
- `api/cors_origins`
- `spinnaker/gate_url`

UI env vars are still set at build time (Vite).

---

## Check config sanity

Use the API to confirm runtime configuration:
- `GET /v1/config/sanity`

Returns booleans only:
- `oidc_configured`
- `spinnaker_configured`
- `artifact_discovery_configured`
