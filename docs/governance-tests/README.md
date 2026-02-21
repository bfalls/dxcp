# Governance Tests (Phase 3 Harness)

This directory contains the deterministic, fail-fast governance harness for DXCP.

DXCP is an enterprise delivery control plane. Governance behavior is not optional and is not configurable per environment. The harness enforces explicit invariants defined in the governance contract.

---------------------------------------------------------------------

## Document Structure

This documentation is split intentionally:

- GOVERNANCE_CONTRACT.md
  Authoritative invariants and enforcement rules.
  This is the source of truth for governance behavior.

- SETUP_AND_OPERATIONS.md
  Environment setup, Auth0 configuration, runtime notes, and CI usage.

The governance contract must be updated before API or test expectations are changed.

---------------------------------------------------------------------

## What This Harness Does

The harness validates:

- Role enforcement
- Delivery group scoping
- Build publish gating
- Idempotency behavior
- Admin config auditability for CI publishers and mutation kill switch
- Enforcement ordering
- Deployment invariants
- Rollback invariants
- Quota and concurrency guardrails

Admin config auditability conformance in govtest intentionally excludes live system rate-limit mutation assertions.
Changing global `read_rpm` / `mutate_rpm` / `daily_quota_build_register` values during a run can throttle unrelated steps and destabilize fail-fast contract checks.

The harness is fail-fast. Any invariant violation stops execution.

These tests validate correctness, not performance.

---------------------------------------------------------------------

## Run Modes

Dry run:

    npm run govtest:dry

Full mode:

    npm run govtest

Conformance profile:

- `GOV_CONFORMANCE_PROFILE=diagnostic` (default for local runs)
- `GOV_CONFORMANCE_PROFILE=strict` (default in GitHub Actions / CI)

See SETUP_AND_OPERATIONS.md for configuration details.

---------------------------------------------------------------------

## Unified Conformance Snapshot

Governance conformance is evaluated in two layers:

- Runtime conformance (`govtest`, live AWS/Spinnaker/Auth0): writes `.govtest.contract.snapshot.json`
- Unit conformance (`dxcp-api` governance contract subset): writes `.dxcpapi.governance.snapshot.json`

Both snapshots are merged into:

- `.governance.conformance.snapshot.json`

The manual GitHub Actions workflow (`.github/workflows/governance-tests.yml`) runs both layers, uploads all snapshots as artifacts, and fails unless overall merged conformance is `PASS`.

Governance badge/status should track this workflow result (the merged overall conformance result), not either layer in isolation.

---------------------------------------------------------------------

## Governance Philosophy

Governance tests are not adjustable knobs.

If a test fails:

1) Check GOVERNANCE_CONTRACT.md
2) Correct the API if it violates the contract
3) Only revise the contract if product intent changes

The API conforms to the contract.
The tests enforce the contract.
