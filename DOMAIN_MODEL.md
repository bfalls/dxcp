# DXCP Domain Model

This document defines the core domain objects used by DXCP. These models are
engine-agnostic and are owned by DXCP.

## DeploymentIntent

Represents what a user wants to deploy and how.

Fields (required unless noted):
- intent_id: unique identifier for the intent
- service: allowlisted service name
- version: artifact version or build ID
- environment: single allowed environment (sandbox)
- recipe: Recipe reference (see Recipe)
- requested_by: user identifier or actor
- requested_at: timestamp
- idempotency_key: stable key for retries and duplicate submits
- metadata (optional): small set of key/value pairs for traceability

Notes:
- Intent is validated by guardrails before any engine call.
- Intent does not include engine-specific fields.

## DeploymentRecord

Normalized record of an attempted deployment, stored by DXCP.

Fields:
- record_id: unique identifier for this record
- intent_id: link to DeploymentIntent
- status: one of queued, running, succeeded, failed, canceled
- environment: resolved environment
- recipe: Recipe reference used
- engine_execution_id: reference to Spinnaker execution
- started_at: timestamp
- finished_at (optional): timestamp
- status_timeline: ordered list of normalized stage status entries
- failures: list of FailureModel entries (can be empty)
- artifact: resolved artifact reference
- links: URLs for UI or deep debug (engine execution, logs)

Notes:
- Record is the primary status source for the UI.
- Engine details are referenced, not embedded.

## FailureModel

Normalized representation of a failure, regardless of engine source.

Fields:
- failure_id: unique identifier
- category: one of validation, policy, artifact, infrastructure, timeout, rollback, unknown
- summary: one line description of what failed
- details (optional): short explanation
- suggested_actions: list of next steps
- evidence_links (optional): list of URLs to logs or engine execution
- occurred_at: timestamp
- stage (optional): normalized stage name

Notes:
- Multiple failures can be associated with a single record.
- FailureModel is shown directly in the UI.

## Recipe

DXCP abstraction that selects an approved deployment path.

Fields:
- recipe_id: unique identifier
- name: human readable name
- description: short purpose statement
- policy: validation and guardrails applied for this recipe
- spinnaker_pipeline_id: engine pipeline template identifier
- parameters: allowed parameters that DXCP will pass to the adapter

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

Notes:
- DeliveryGroups do not change deploy semantics in Phase A.
- Service membership must align with the service allowlist.
