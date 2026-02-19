# Governance Tests (Phase 3 Harness)

## Purpose

This harness establishes a deterministic, fail-fast governance test entrypoint for DXCP.
Phase 3 converts manual governance curl checks into automated API assertions (no browser/UI).

No Playwright/browser automation is implemented in this phase.

## Prerequisites

- DXCP API reachable (`GOV_DXCP_API_BASE`)
- DXCP UI reachable (`GOV_DXCP_UI_BASE`)
- Spinnaker running and reachable from DXCP
- AWS environment reachable in `GOV_AWS_REGION`
- Node 24+ available locally (`--experimental-strip-types` support)

## Configuration

1. Copy `.env.govtest.example` to `.env.govtest`.
2. Fill in real values for all `GOV_` keys.
3. Keep `.env.govtest` local only (gitignored).

### Auth0 M2M Setup

Create four Auth0 Machine-to-Machine applications (or equivalent confidential clients), one for each role:

- admin
- owner
- observer
- ci

For each app:

1. Authorize it for the DXCP API (`GOV_AUTH0_AUDIENCE`).
2. Grant role-specific permissions/claims expected by DXCP governance policies.
3. Record `client_id` and `client_secret`.

Store values as:

- Local: `.env.govtest` (`GOV_*`)
- GitHub Actions: repository variables/secrets (`GOV_*`)

Tokens can be provided directly or minted at runtime:

- `GOV_ADMIN_TOKEN`
- `GOV_OWNER_TOKEN`
- `GOV_OBSERVER_TOKEN`
- `GOV_CI_TOKEN`

If those token env vars are not present, the harness mints tokens using:

- `GOV_AUTH0_DOMAIN`
- `GOV_AUTH0_AUDIENCE`
- `GOV_*_CLIENT_ID`
- `GOV_*_CLIENT_SECRET`

Optional run overrides:

- `GOV_SERVICE` (default: `demo-service`)
- `GOV_ENVIRONMENT` (default: `sandbox`)
- `GOV_RECIPE_ID` (default: `default`)
- `GOV_DEPLOY_TIMEOUT_SECONDS` (default: `300`)
- `GOV_DEPLOY_POLL_SECONDS` (default: `5`)

## Run Locally

Dry-run (default-safe):

```bash
npm run govtest:dry
```

Full mode:

```bash
npm run govtest
```

Notes:

- The runner auto-loads `.env.govtest` for local runs.
- In dry-run mode, it validates identity wiring and run planning only.
- In full mode, it runs all Phase 3 governance assertions.
- Any failed assertion stops the run immediately (fail fast).

## What This Phase Verifies

The full run executes the following invariant checks in order:

1. Gate negative: non-CI identity (`GOV_OWNER_TOKEN`) cannot call `POST /v1/builds/register` (`403 CI_ONLY`).
2. CI allowlist admin setup: `PUT /v1/admin/system/ci-publishers` using `GOV_ADMIN_TOKEN`, with matcher fields populated from `GET /v1/whoami` using `GOV_CI_TOKEN` (`iss`, `aud`, `azp`, `sub`).
3. Build registration happy path: `POST /v1/builds/register` for computed `GOV_RUN_VERSION` returns `201`; replay with same `Idempotency-Key` returns `201` and `Idempotency-Replayed: true`.
4. Build conflict: same idempotency key with different `git_sha` returns `409 BUILD_REGISTRATION_CONFLICT`.
5. Deploy-side enforcement for unregistered version (`0.<runMinor>.999`): both `POST /v1/deployments/validate` and `POST /v1/deployments` return `400 VERSION_NOT_FOUND`.
6. Deploy happy path for registered version: validate succeeds, deploy is accepted, and deployment status is polled until terminal state or timeout.

## Run In GitHub Actions

Use workflow: `.github/workflows/governance-tests.yml`

- Trigger: **Actions -> Governance Tests -> Run workflow** (`workflow_dispatch` only)
- The workflow runs full mode only when all required `GOV_*` values are present; otherwise it runs dry-run.
- Set non-secret values as repository variables and secret values as repository secrets.

Expected output includes run plan details and a minimal summary with run/version/deployment state.
