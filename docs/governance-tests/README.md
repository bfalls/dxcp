# Governance Tests (Phase 1 Harness)

## Purpose

This harness establishes a deterministic, fail-fast governance test entrypoint for DXCP.
Phase 1 validates test plumbing only:

- GOV_ configuration loading
- local/CI execution wiring
- run-version selection for `demo-service`
- dry-run planning output

No Auth0 token exchange or browser automation is implemented yet.

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

## Run Locally

Dry-run (default-safe):

```bash
npm run govtest:dry
```

Full mode (placeholder token path only for now):

```bash
npm run govtest
```

Notes:

- The runner auto-loads `.env.govtest` for local runs.
- If `GOV_CI_CLIENT_SECRET` is missing, the runner automatically switches to dry-run.
- Any validation or fetch error exits immediately (fail fast).

## Run In GitHub Actions

Use workflow: `.github/workflows/governance-tests.yml`

- Trigger: **Actions -> Governance Tests -> Run workflow** (`workflow_dispatch` only)
- The workflow runs dry-run automatically when required secrets are absent.
- Set non-secret values as repository variables and secret values as repository secrets.

Expected phase-1 output includes a "Run Plan" with computed `GOV_RUN_VERSION`.
