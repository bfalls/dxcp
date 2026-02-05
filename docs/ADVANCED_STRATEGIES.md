# DXCP Advanced Deployment Strategies (Recipes)

DXCP represents advanced deployment strategies as Recipes. Recipes are
user-facing, intent-safe descriptions of deployment behavior that map to an
engine workflow internally (Spinnaker in v1). Users select a recipe by id; the
engine mapping details are admin-only and never required to deploy.

This document defines the initial recipe set and the contract-level semantics
DXCP guarantees for each strategy.

## Core Semantics

- Recipes are safe by default and centrally defined by platform admins.
- A recipe describes effective behavior, not engine stages.
- Deployment outcomes are normalized and engine-agnostic.
- Auto-rollback is represented as a separate rollback DeploymentRecord
  (deploymentKind = ROLLBACK) that references the failed deployment via
  rollbackOf. The original deployment outcome becomes ROLLED_BACK after a
  successful rollback.
- Only the sandbox environment is supported in v1.

## Shared Guardrails (All Recipes)

The following validations are enforced before any engine call:

- Service must be allowlisted.
- Environment must be "sandbox".
- Version must be registered for the service.
- Recipe must be allowed by the DeliveryGroup.
- Recipe must be compatible with the service (RECIPE_INCOMPATIBLE when not).
- Concurrency limit per DeliveryGroup must not be exceeded.
- Daily quotas per DeliveryGroup and per client must not be exceeded.

## Recipe Promises

### Standard

What it does:
- Deploys the requested version directly to the running environment using the
  standard, single-pass workflow.

Success means:
- The new version becomes the current running version and the deployment
  outcome is SUCCEEDED.
- If rollback is triggered (manual or automated), a rollback DeploymentRecord
  is created and the original deployment outcome becomes ROLLED_BACK after a
  successful rollback.

Guardrails:
- All shared guardrails apply. No additional recipe-specific constraints.

### Canary

What it does:
- Releases the requested version in a controlled canary progression with
  automated verification steps, then completes or rolls back based on results.

Success means:
- The canary progression and verification complete successfully and the new
  version becomes the current running version (outcome SUCCEEDED).
- If verification fails, DXCP records the original deployment as FAILED, then
  initiates a rollback. After a successful rollback, the original deployment
  outcome becomes ROLLED_BACK and the rollback DeploymentRecord is SUCCEEDED.

Guardrails:
- All shared guardrails apply.
- Canary recipe may be restricted to services that have required metrics or
  analysis configuration; otherwise validation returns RECIPE_INCOMPATIBLE.

### BlueGreen

What it does:
- Brings up a new version alongside the existing version and performs a
  controlled cutover to the new version with defined rollback semantics.

Success means:
- The cutover completes successfully and the new version becomes the current
  running version (outcome SUCCEEDED).
- If validation or cutover fails, DXCP records the original deployment as
  FAILED and initiates a rollback. After a successful rollback, the original
  deployment outcome becomes ROLLED_BACK and the rollback DeploymentRecord is
  SUCCEEDED.

Guardrails:
- All shared guardrails apply.
- Blue/Green recipe may be restricted to services that support side-by-side
  capacity and cutover validation; otherwise validation returns
  RECIPE_INCOMPATIBLE.

## Recipe Catalog

| name      | recipe_revision | effective_behavior_summary | required_validations | expected_outcomes |
|-----------|-----------------|----------------------------|----------------------|-------------------|
| Standard  | 1               | Direct deploy to sandbox with single-pass execution. | Allowlisted service; sandbox environment; registered version; recipe allowed by delivery group; recipe compatible with service; concurrency and quota limits. | SUCCEEDED if deployment completes; FAILED or CANCELED on error; ROLLED_BACK if later rolled back; SUPERSEDED when a later success becomes current. |
| Canary    | 1               | Progressive rollout with automated verification and rollback on failed analysis. | All Standard validations plus canary compatibility checks for required analysis/metrics. | SUCCEEDED if verification completes; FAILED if verification fails; ROLLED_BACK when auto-rollback succeeds; CANCELED if terminated. |
| BlueGreen | 1               | Parallel rollout with controlled cutover and rollback capability. | All Standard validations plus blue/green compatibility checks for dual-capacity and cutover readiness. | SUCCEEDED if cutover completes; FAILED if validation or cutover fails; ROLLED_BACK when rollback succeeds; CANCELED if terminated. |

## Non-Goals

- No UI changes.
- No engine workflow details in the user model.
- No pipeline editing or custom strategy authoring in v1.
