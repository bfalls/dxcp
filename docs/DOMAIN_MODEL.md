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
- environment: canonical environment name (for example sandbox, staging, prod)
- changeSummary: required change summary
- recipeId (optional): explicit execution-pattern override for advanced or admin-driven flows when allowed by policy

Notes:
- Intent is validated by guardrails before any engine call.
- Intent does not include engine-specific fields.
- Version must already be registered for the service.
- In the common deploy path, operators provide service + environment and DXCP resolves the execution pattern through authoritative service-environment routing.
- If provided, recipeId is validated as an override against the resolved routing and policy model rather than treated as a required baseline input.

## DeploymentRecord

Normalized record of an attempted deployment, stored by DXCP.

Fields:
- id: unique identifier for this record
- service: allowlisted service name
- environment: resolved environment
- version: artifact version
- recipeId: recipe id used
- recipeRevision: recipe revision used for this deployment (nullable)
- effectiveBehaviorSummary: frozen recipe behavior summary used at deployment time (nullable)
- engine_type: execution engine identity (informational; SPINNAKER in v1)
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
- environment: canonical environment name
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
- A DeploymentIntent always results in a DeploymentRecord with the same service, version, and environment.
- DeploymentRecord.recipeId stores the resolved Recipe actually used for execution.
- Idempotency-Key retries return the same DeploymentRecord.

Supersession:
- The latest successful deployment for a service supersedes earlier successful deployments for "current running" purposes.

## Roll-forward vs Rollback Representation

- deploymentKind = ROLL_FORWARD when rollbackOf is null.
- deploymentKind = ROLLBACK when rollbackOf references a prior deployment id.
- rollbackOf captures the lineage for rollback operations.

## Recipe

Adapter-backed execution patterns with a stable DXCP-facing contract.

Fields:
- id: unique identifier
- name: human readable name
- description: short purpose statement
- engine_type: execution engine identity (informational; SPINNAKER in v1)
- spinnaker_application: engine application identifier
- deploy_pipeline: engine pipeline identifier for deploy
- rollback_pipeline: engine pipeline identifier for rollback
- recipe_revision: monotonic recipe revision
- effective_behavior_summary: short, user-facing description of effective behavior
- status: active or deprecated
- created_at
- created_by
- updated_at
- updated_by
- last_change_reason (optional)

Notes:
- Only a small, approved set of recipes exist.
- Recipes evolve centrally to preserve safety and consistency.
- Recipes define governed execution behavior, not a required operator-facing choice in the common deploy flow.
- In v1, every Recipe resolves through the Spinnaker adapter and therefore carries Spinnaker mapping fields.
- The domain meaning of Recipe is broader than Spinnaker pipeline shape; engine mapping fields are adapter-specific admin diagnostics.

## ServiceEnvironmentRouting

Authoritative DXCP routing object that bridges governed environment context to execution behavior.

Fields:
- service: allowlisted service name
- environment: canonical environment name
- deliveryGroupId: governing delivery group
- recipeId: Recipe selected for this service + environment context
- engine_type: execution engine identity (informational; SPINNAKER in v1)
- status: active or disabled

Notes:
- Service-environment routing is authoritative for execution selection in the common deploy path.
- Routing is where DXCP connects governed environment context to the execution pattern that will be run.
- Routing is owned by DXCP, not by the external engine.
- In v1, routing resolves to a Spinnaker-backed Recipe, but environment remains a DXCP concept rather than an engine-native one.

## DeliveryGroup

Named grouping of allowlisted services for discovery and policy attachment.

Fields:
- id: unique identifier for the delivery group
- name: human readable name
- description (optional): short summary of the group
- owner (optional): team or user identifier
- services: list of allowlisted service names
- allowed_environments (optional): ordered list of allowed environment names for policy and implicit environment creation
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
- DeliveryGroups are authoritative for environment policy scope.

## Environment

Fields:
- id: internal storage identifier
- name: canonical environment name (authoritative deploy intent identifier)
- display_name (optional): UI label
- type: non_prod or prod
- promotion_order (optional): explicit promotion ordering within a delivery group
- delivery_group_id: parent delivery group
- is_enabled: disable/enable lifecycle flag
- guardrails (optional): per-environment overrides

Notes:
- Environment `name` is the single identifier used in deployment intent, running state, and deployment history filters.
- Environment records are managed by DXCP storage workflows; static service registry files are not authoritative for environment lifecycle.
- Disable is preferred to deletion for safety and auditability.

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
- DXCP supports multiple named environments under delivery-group policy.
- ArtifactRef is a URI with a scheme and opaque reference.
- ArtifactRef is AWS S3-scoped today (s3://bucket/key) and validated against allowlisted sources.
- Only the s3 scheme is supported in v1.
