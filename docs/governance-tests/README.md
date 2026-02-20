# Governance Tests (Phase 3 Harness)

## Purpose

This harness establishes a deterministic, fail-fast governance test entrypoint for DXCP.
Phase 3 converts manual governance curl checks into automated API assertions.

Authentication model used by this harness:

- `admin`, `owner`, and `observer` tokens are obtained automatically via headless Playwright login against the real DXCP SPA/Auth0 PKCE flow.
- `ci` token is minted with Auth0 `client_credentials` (M2M).
- The demo artifact publisher workflow (`.github/workflows/build-demo-artifacts.yml`) follows the same CI publisher pattern with stable idempotency (`github-<run_id>-<service>-<version>`) and commit/run metadata when supported by the API.

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
4. Ensure Playwright Chromium is installed (`cd ui && npx playwright install chromium`) if not already present.

Required keys for full mode:

- `GOV_DXCP_UI_BASE`
- `GOV_DXCP_API_BASE`
- `GOV_AWS_REGION`
- `GOV_AUTH0_DOMAIN`
- `GOV_AUTH0_AUDIENCE`
- `GOV_DXCP_UI_CLIENT_ID`
- `GOV_ADMIN_USERNAME`
- `GOV_ADMIN_PASSWORD`
- `GOV_OWNER_USERNAME`
- `GOV_OWNER_PASSWORD`
- `GOV_OBSERVER_USERNAME`
- `GOV_OBSERVER_PASSWORD`
- `GOV_CI_CLIENT_ID`
- `GOV_CI_CLIENT_SECRET`

### Auth0 M2M Setup

Create one Auth0 Machine-to-Machine application for CI publishing:

- `ci`

For that app:

1. Authorize it for the DXCP API (`GOV_AUTH0_AUDIENCE`).
2. Grant CI publisher permissions/claims expected by DXCP governance policies.
3. Record `client_id` and `client_secret`.

Create/use three real Auth0 users for:

- `admin`
- `owner`
- `observer`

Store those users' credentials for automated login (`GOV_*_USERNAME`, `GOV_*_PASSWORD`).

Store values as:

- Local: `.env.govtest` (`GOV_*`)
- GitHub Actions: repository variables/secrets (`GOV_*`)

`GOV_CI_TOKEN` can be provided directly, but if absent, CI token is minted at runtime using:

- `GOV_AUTH0_DOMAIN`
- `GOV_AUTH0_AUDIENCE`
- `GOV_CI_CLIENT_ID`
- `GOV_CI_CLIENT_SECRET`

User tokens (`admin`/`owner`/`observer`) are always obtained by browser login and token capture from SPA cache; no manual token copy/paste is required.

Optional run overrides:

- `GOV_SERVICE` (default: `demo-service`)
- `GOV_ENVIRONMENT` (default: `sandbox`)
- `GOV_RECIPE_ID` (default: `default`)
- `GOV_DEPLOY_TIMEOUT_SECONDS` (default: `300`)
- `GOV_DEPLOY_POLL_SECONDS` (default: `5`)
- `GOV_GUARDRAILS_MODE` (default: `safe`, options: `safe` or `active`)

Guardrails mode behavior:

- `safe` (default): non-destructive quota/concurrency spot checks only; no limit-pushing submissions.
- `active`: bounded guardrail probes are enabled:
  - quota: attempts N+1 validation only when validation itself decrements quota and remaining budget is small.
  - concurrency: starts one deploy and probes a second deploy for `CONCURRENCY_LIMIT_REACHED`, then waits for terminal cleanup.

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
- The runner uses Playwright headless to obtain user tokens via SPA login.
- In dry-run mode, it validates identity wiring and run planning only.
- In full mode, it runs all Phase 3 governance assertions.
- Any failed assertion stops the run immediately (fail fast).

## What This Phase Verifies

The full run executes the following invariant checks in order:

1. Role and claims sanity checks:
   - admin token can call admin endpoint `GET /v1/admin/system/ci-publishers` (`200`).
   - owner and observer are denied for `PUT /v1/admin/system/ci-publishers` (`403 ROLE_FORBIDDEN`).
   - observer is denied for `POST /v1/deployments/validate` and `POST /v1/deployments` (`403 ROLE_FORBIDDEN`).
   - owner can call deploy endpoints in scope (permission sanity check uses unregistered version and expects `400 VERSION_NOT_FOUND`, not role denial).
   - observer can call read-only APIs (`GET /v1/services/{service}/versions`, `GET /v1/deployments`, and deployment status when available).
   - claims sanity requires expected role values via `whoami.roles` when present, or equivalent JWT roles claim.
2. Gate negative: non-CI owner identity cannot call `POST /v1/builds/register` (`403 CI_ONLY`).
3. CI allowlist admin setup: `PUT /v1/admin/system/ci-publishers` using admin user token, with matcher fields populated from `GET /v1/whoami` using CI M2M token (`iss`, `aud`, `azp`, `sub`).
4. Build registration happy path: `POST /v1/builds/register` for computed `GOV_RUN_VERSION` returns `201`; replay with same `Idempotency-Key` returns `201` and `Idempotency-Replayed: true`.
5. Build conflict: same idempotency key with different `git_sha` returns `409 BUILD_REGISTRATION_CONFLICT`.
6. Deploy enforcement invariants:
   - Unregistered version (`0.<runMinor>.999`): both `POST /v1/deployments/validate` and `POST /v1/deployments` return `400 VERSION_NOT_FOUND`.
   - Decision 7 ordering: a compatibility-only mismatch returns `400 RECIPE_INCOMPATIBLE`, and the same mismatching intent returns `403 RECIPE_NOT_ALLOWED` once DeliveryGroup policy denies the recipe (policy check before compatibility check).
7. Deploy happy path for registered version: validate succeeds, deploy is accepted, and deployment status is polled until terminal state or timeout.
8. Rollback governance check after successful deploy:
   - Discover rollback target from deployment history (`GET /v1/deployments`) for the same service/environment by selecting the most recent `SUCCEEDED` deployment whose `version != GOV_RUN_VERSION`.
   - Validate rollback using rollback-specific validation endpoint if available; otherwise validate the target version with `POST /v1/deployments/validate`.
   - Submit rollback using `POST /v1/deployments/{deploymentId}/rollback` when supported, otherwise submit a redeploy intent for the discovered target version.
   - Poll rollback deployment to terminal state and require terminal success.
9. Guardrail spot checks (12 compact checks; sequential execution):
   - Quota safe checks: policy endpoint availability, quota policy shape, validate quota shape.
   - Quota active checks: active mode gate, validate quota-enforcement detection, bounded N+1 verification.
   - Concurrency safe checks: policy endpoint availability, concurrency policy shape, validate concurrency shape.
   - Concurrency active checks: active mode gate, second-deploy concurrency block probe, cleanup confirmation.
   - Each check reports `PASSED`, `FAILED`, or `SKIPPED` in the run summary.

Rollback is intentionally skipped (not failed) when no prior successful deployment target exists for the same service/environment with a version different from `GOV_RUN_VERSION`.

## Run In GitHub Actions

Use workflow: `.github/workflows/governance-tests.yml`

- Trigger: **Actions -> Governance Tests -> Run workflow** (`workflow_dispatch` only)
- The workflow runs full mode only when all required `GOV_*` values are present; otherwise it runs dry-run.
- Set non-secret values as repository variables and secret values as repository secrets.

Expected output includes run plan details and a minimal summary with run/version/deployment state.
