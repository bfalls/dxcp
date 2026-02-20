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
- Enforcement ordering
- Deployment invariants
- Rollback invariants
- Quota and concurrency guardrails

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

## Governance Philosophy

Governance tests are not adjustable knobs.

If a test fails:

1) Check GOVERNANCE_CONTRACT.md
2) Correct the API if it violates the contract
3) Only revise the contract if product intent changes

The API conforms to the contract.
The tests enforce the contract.
