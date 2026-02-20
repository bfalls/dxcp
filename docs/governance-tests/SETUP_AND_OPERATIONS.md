# Governance Harness Setup and Operations

This document contains operational and configuration guidance.

---------------------------------------------------------------------

## Purpose

The harness establishes a deterministic, fail-fast governance test entrypoint for DXCP.

Authentication model:

- admin, owner, observer tokens obtained via headless Playwright login against SPA Auth0 PKCE flow.
- ci token minted using Auth0 client_credentials (M2M).
- Demo artifact publisher workflow follows same CI idempotency pattern.

---------------------------------------------------------------------

## Prerequisites

- DXCP API reachable (GOV_DXCP_API_BASE)
- DXCP UI reachable (GOV_DXCP_UI_BASE)
- Spinnaker reachable
- AWS environment reachable (GOV_AWS_REGION)
- Node 24+ available locally

---------------------------------------------------------------------

## Configuration

1) Copy .env.govtest.example to .env.govtest
2) Fill in GOV_ keys
3) Keep file local only
4) Ensure Playwright Chromium installed

Required keys:

- GOV_DXCP_UI_BASE
- GOV_DXCP_API_BASE
- GOV_AWS_REGION
- GOV_AUTH0_DOMAIN
- GOV_AUTH0_AUDIENCE
- GOV_DXCP_UI_CLIENT_ID
- GOV_ADMIN_USERNAME
- GOV_ADMIN_PASSWORD
- GOV_OWNER_USERNAME
- GOV_OWNER_PASSWORD
- GOV_OBSERVER_USERNAME
- GOV_OBSERVER_PASSWORD
- GOV_CI_CLIENT_ID
- GOV_CI_CLIENT_SECRET

Optional key:

- GOV_CONFORMANCE_PROFILE
  - `diagnostic` (default for local/non-CI runs)
  - `strict` (default in GitHub Actions / CI)

---------------------------------------------------------------------

## Auth0 Setup

Create M2M application:

- ci

Authorize it for DXCP API audience.
Grant required CI publisher claims.

Create real users:

- admin
- owner
- observer
- optional non-member-owner

Store credentials securely.

---------------------------------------------------------------------

## Run Modes

Dry run:

    npm run govtest:dry

Full mode:

    npm run govtest

Full mode executes all invariants defined in GOVERNANCE_CONTRACT.md.

Conformance behavior:

- `strict`: contract invariants cannot be skipped. Missing contract prerequisites fail the run.
- `diagnostic`: environment-limited checks may be skipped for operational diagnostics.

---------------------------------------------------------------------

## Guardrail Modes

SAFE (default):

- Non-destructive checks only.

ACTIVE:

- Bounded quota and concurrency probing.
- Must clean up.
- Must not leave system in bad state.

---------------------------------------------------------------------

## GitHub Actions

Workflow:
.github/workflows/governance-tests.yml

Triggered manually via workflow_dispatch.

Full mode runs only when all GOV_ variables present.
Otherwise dry-run.

---------------------------------------------------------------------

## Operational Notes

- Runner auto-loads .env.govtest.
- User tokens obtained via Playwright login.
- Fail-fast on first invariant violation.
- Run artifact written to .govtest.last-run.json.
- Print request_id on failure for diagnostics.
