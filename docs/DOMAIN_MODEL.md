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
- version: artifact version or build ID
- environment: single allowed environment (sandbox)
- changeSummary: required change summary
- recipeId (optional): selects a Recipe by id
- spinnakerApplication (optional): engine application name (resolved by recipe)
- spinnakerPipeline (optional): engine pipeline name (resolved by recipe)

Notes:
- Intent is validated by guardrails before any engine call.
- Intent does not include engine-specific fields.

## DeploymentRecord

Normalized record of an attempted deployment, stored by DXCP.

Fields:
- id: unique identifier for this record
- service: allowlisted service name
- environment: resolved environment
- version: artifact version
- recipeId (optional): recipe id used
- state: one of PENDING, ACTIVE, IN_PROGRESS, SUCCEEDED, FAILED, CANCELED, ROLLED_BACK
- createdAt: timestamp
- updatedAt: timestamp
- spinnakerExecutionId: reference to engine execution
- spinnakerExecutionUrl: deep link to engine execution
- rollbackOf (optional): original deployment id
- failures: list of FailureModel entries (can be empty)

Notes:
- Record is the primary status source for the UI.
- Engine details are referenced, not embedded.

## FailureModel

Normalized representation of a failure, regardless of engine source.

Fields:
- category: one of VALIDATION, POLICY, ARTIFACT, INFRASTRUCTURE, TIMEOUT, ROLLBACK, UNKNOWN
- summary: one line description of what failed
- detail (optional): short explanation
- actionHint (optional): suggested next step
- observedAt: timestamp

Notes:
- Multiple failures can be associated with a single record.
- FailureModel is shown directly in the UI.

## Recipe

Engine-mapped delivery patterns with a stable DXCP-facing contract.

Fields:
- id: unique identifier
- name: human readable name
- description: short purpose statement
- allowed_parameters: explicit allowlist of parameters DXCP will pass to the adapter
- spinnaker_application: engine application identifier
- deploy_pipeline: engine pipeline identifier for deploy
- rollback_pipeline: engine pipeline identifier for rollback
- status: active or deprecated
- created_at
- created_by
- updated_at
- updated_by

Notes:
- Only a small, approved set of recipes exist.
- Recipes evolve centrally to preserve safety and consistency.

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

Notes:
- DeliveryGroups do not change deploy semantics in Phase A.
- Service membership must align with the service allowlist.
