# DXCP Domain Model

This document defines the core domain objects used by DXCP. These models are
engine-agnostic and are owned by DXCP.

## Responsibility split

- Services define what is deployable and how (technical constraints).
- DeliveryGroups define who can deploy and when (governance).

## DeploymentIntent

Represents what a user wants to deploy and how.

Fields (required unless noted):
- service: allowlisted service name
- version: registered build version
- environment: single allowed environment (sandbox)
- changeSummary: required change summary
- recipeId: selects a Recipe by id

Notes:
- Intent is validated by guardrails before any engine call.
- Intent does not include engine-specific fields.
- Version must already be registered for the service.

## DeploymentRecord

Normalized record of an attempted deployment, stored by DXCP.

Fields:
- id: unique identifier for this record
- service: allowlisted service name
- environment: resolved environment
- version: artifact version
- recipeId: recipe id used
- state: one of PENDING, ACTIVE, IN_PROGRESS, SUCCEEDED, FAILED, CANCELED, ROLLED_BACK
- deploymentKind: one of ROLL_FORWARD, ROLLBACK
- outcome (optional): one of SUCCEEDED, FAILED, ROLLED_BACK, CANCELED, SUPERSEDED
- changeSummary: user-provided change summary
- createdAt: timestamp
- updatedAt: timestamp
- deliveryGroupId: delivery group policy scope
- engineExecutionId (admin-only): reference to engine execution
- engineExecutionUrl (admin-only): deep link to engine execution
- rollbackOf (optional): original deployment id
- failures: list of FailureModel entries (can be empty)

Notes:
- Record is the primary status source for the UI.
- Engine details are referenced, not embedded.
- deploymentKind is derived from rollbackOf (present => ROLLBACK).
- outcome is a normalized terminal result; in-flight states have no outcome.

## CurrentRunningState

Authoritative "what is running" snapshot for a single service.

Fields:
- service: allowlisted service name
- environment: always "sandbox"
- scope: always "service"
- version: currently running version (latest successful deployment)
- deploymentId: deployment record that established the running version
- deploymentKind: ROLL_FORWARD or ROLLBACK
- derivedAt: timestamp when DXCP computed the running state

Notes:
- CurrentRunningState is derived from DeploymentRecord history only.
- It is not a runtime health check or traffic split indicator.
- If no successful deployment exists, current running state is null.

## DeploymentOutcome

Normalized outcome for a deployment record.

Values:
- SUCCEEDED: deployment completed successfully and is the current running version.
- FAILED: deployment failed and did not change the running version.
- CANCELED: deployment was canceled before completion.
- ROLLED_BACK: deployment completed but was later rolled back.
- SUPERSEDED: deployment succeeded but is no longer the running version.

## FailureModel

Normalized representation of a failure, regardless of engine source.

Fields:
- category: one of VALIDATION, POLICY, ARTIFACT, INFRASTRUCTURE, CONFIG, APP, TIMEOUT, ROLLBACK, UNKNOWN
- summary: one line description of what failed
- detail (optional): short explanation
- actionHint (optional): suggested next step
- observedAt: timestamp

Notes:
- Multiple failures can be associated with a single record.
- FailureModel is shown directly in the UI.

## DeploymentHistory Semantics

Ordering:
- Sorted by createdAt (descending), then id (descending) as a stable tie-breaker.

Dedupe:
- No dedupe beyond idempotency behavior; each unique intent produces one record.

Correlation:
- A DeploymentIntent always results in a DeploymentRecord with the same service, version, recipeId, and environment.
- Idempotency-Key retries return the same DeploymentRecord.

Supersession:
- The latest successful deployment for a service supersedes earlier successful deployments for "current running" purposes.

## Roll-forward vs Rollback Representation

- deploymentKind = ROLL_FORWARD when rollbackOf is null.
- deploymentKind = ROLLBACK when rollbackOf references a prior deployment id.
- rollbackOf captures the lineage for rollback operations.

## Recipe

Engine-mapped delivery patterns with a stable DXCP-facing contract.

Fields:
- id: unique identifier
- name: human readable name
- description: short purpose statement
- spinnaker_application: engine application identifier
- deploy_pipeline: engine pipeline identifier for deploy
- rollback_pipeline: engine pipeline identifier for rollback
- status: active or deprecated
- created_at
- created_by
- updated_at
- updated_by
- last_change_reason (optional)

Notes:
- Only a small, approved set of recipes exist.
- Recipes evolve centrally to preserve safety and consistency.
- Engine mapping fields are admin-only diagnostics.

## DeliveryGroup

Named grouping of allowlisted services for discovery and policy attachment.

Fields:
- id: unique identifier for the delivery group
- name: human readable name
- description (optional): short summary of the group
- owner (optional): team or user identifier
- services: list of allowlisted service names
- allowed_recipes: list of recipe ids or names (can be empty)
- guardrails (optional): policy limits scoped to the group
  - max_concurrent_deployments
  - daily_deploy_quota
  - daily_rollback_quota
- created_at
- created_by
- updated_at
- updated_by
- last_change_reason (optional)

Notes:
- DeliveryGroups do not change deploy semantics in Phase A.
- Service membership must align with the service allowlist.

## AuditEvent

Append-only record of admin and delivery actions.

Fields:
- event_id: unique identifier
- event_type: action category (for example ADMIN_UPDATE, DEPLOY_SUBMIT)
- actor_id: authenticated user identifier
- actor_role: DXCP role at time of action
- target_type: DeliveryGroup, Recipe, Deployment
- target_id: resource identifier
- timestamp: ISO8601
- outcome: SUCCESS, DENIED, FAILED
- summary: short human-readable summary
- delivery_group_id (optional)
- service_name (optional)
- environment (optional)

Notes:
- Audit events are immutable and retained as the system of record for actions.

## Contract Notes

- CurrentRunningState is computed from DeploymentRecord history stored by DXCP.
- Deployment state is refreshed from the engine only when specific deployment records are fetched; list endpoints do not poll the engine.
- DXCP exposes a single environment ("sandbox") and does not model traffic splits or multi-environment rollouts in Phase 3.
