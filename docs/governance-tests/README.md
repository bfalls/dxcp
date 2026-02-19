# Governance Tests (Phase 2 Harness)

## Purpose

This harness establishes a deterministic, fail-fast governance test entrypoint for DXCP.
Phase 2 validates test plumbing plus Auth0 M2M identity bootstrap:

- GOV_ configuration loading
- local/CI execution wiring
- runtime token minting for admin/owner/observer/ci
- `/v1/whoami` sanity checks per role
- run-version selection for `demo-service`
- dry-run planning output

No Playwright/browser automation is implemented yet.

## Prerequisites

- DXCP API reachable (`GOV_DXCP_API_BASE`)
- DXCP UI reachable (`GOV_DXCP_UI_BASE`)
- Spinnaker running and reachable from DXCP
- AWS environment reachable in `GOV_AWS_REGION`
- Python 3.10+ available locally

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

Tokens are never stored in files; they are minted at runtime only:

- `GOV_ADMIN_TOKEN`
- `GOV_OWNER_TOKEN`
- `GOV_OBSERVER_TOKEN`
- `GOV_CI_TOKEN`

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
- If required Auth0 GOV_ keys are missing, the runner automatically switches to dry-run.
- In full mode, the runner mints four tokens via `client_credentials`, calls `/v1/whoami` for each token, and logs `actor_id/sub/azp/aud/iss` (without printing full tokens).
- Any validation or fetch error exits immediately (fail fast).

## Run In GitHub Actions

Use workflow: `.github/workflows/governance-tests.yml`

- Trigger: **Actions -> Governance Tests -> Run workflow** (`workflow_dispatch` only)
- The workflow runs full mode only when all required `GOV_*` values are present; otherwise it runs dry-run.
- Set non-secret values as repository variables and secret values as repository secrets.

Expected output includes a "Run Plan" with computed `GOV_RUN_VERSION`.
