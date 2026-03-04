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

## Artifact Lifecycle (Self-Contained)

Runtime govtest artifact handling is intentionally self-contained and deterministic.
No manual AWS CLI artifact copy step is required during a normal run.

- Before build registration/deploy checks, the harness resolves a run artifact reference.
- Default behavior is `GOV_ARTIFACT_PREP_MODE=reuse-baseline`:
  the harness verifies a known baseline artifact exists in S3 and reuses that baseline artifactRef for build registration and deploy.
- Optional copy mode (`GOV_ARTIFACT_PREP_MODE=copy-baseline`) performs a server-side S3 copy from baseline key to run-version key and uses the copied target key.

Cleanup behavior:

- If the harness created a run-version artifact object during prep, it deletes that object at run end (best effort).
- If the target/baseline object was pre-existing, cleanup does not delete it.
  This prevents test cleanup from removing artifacts required by other workflows.

Optional env controls:

- `GOV_RUN_VERSION`:
  optional run-version override; if already registered, harness falls back to a computed unregistered version to preserve first-register invariants.
- `GOV_BASELINE_ARTIFACT_VERSION`:
  preferred baseline artifact version for prep.
- `GOV_ARTIFACT_BASELINE_VERSION`:
  legacy alias for baseline version.
- `GOV_ARTIFACT_KEY_TEMPLATE`:
  artifact key template; default `demo-service/demo-service-{version}.zip`.
- `GOV_ARTIFACT_BASELINE_REF`:
  explicit `s3://bucket/key` baseline override in the same bucket.
- `GOV_ARTIFACT_PREP_MODE`:
  `reuse-baseline` (default) or `copy-baseline`.

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
