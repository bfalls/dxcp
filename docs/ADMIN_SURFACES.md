# DXCP Admin Surfaces

This document defines how PLATFORM_ADMIN configures DXCP.
It pairs with UI_SPEC.md and the intent-first product philosophy.

Status legend:
- Current: implemented in the API or UI today
- Planned: not implemented yet

---

## DeliveryGroup management

Status: Planned

Purpose:
- Organize services for discovery and policy enforcement.
- Attach guardrails and recipe allowlists.

Fields:
- id (immutable)
- name
- description (optional)
- owner (optional)
- services (list of allowlisted services)
- allowed_recipes (list of recipe ids)
- guardrails:
  - max_concurrent_deployments
  - daily_deploy_quota
  - daily_rollback_quota

Constraints:
- A service belongs to exactly one DeliveryGroup.
- Services must be allowlisted.
- Guardrails must be positive integers when provided.

Lifecycle:
- Create and edit are supported by admin surfaces.
- Delete is discouraged; prefer deactivation or migration to another group.

Audit expectations:
- Required fields: updatedAt, updatedBy.
- Minimal audit log for create and edit actions.

## Recipe management

Status: Planned

Purpose:
- Define approved deployment paths, mapped to the execution engine.

Fields:
- id (immutable)
- name
- description (optional)
- allowed_parameters (list)
- spinnaker_application
- deploy_pipeline
- rollback_pipeline
- status (active, deprecated)

Validation expectations:
- spinnaker_application must exist in the engine.
- deploy_pipeline and rollback_pipeline must exist under the application.

Lifecycle:
- Create and edit are supported by admin surfaces.
- Deprecate recipes instead of deleting them.
- Deprecated recipes cannot be used for new deployments.

Role enforcement:
- PLATFORM_ADMIN only for create, edit, and deprecate actions.

## Admin settings (refresh defaults)

Status: Current (read-only)

Purpose:
- Define org-wide defaults and guardrails for UI auto-refresh.

Configuration:
- Settings are sourced from environment variables and SSM.
- UI displays these settings to PLATFORM_ADMIN only.
- No UI or API write path exists yet.
SSM keys (when `DXCP_SSM_PREFIX` is configured):
- `/dxcp/config/ui_default_refresh_seconds`
- `/dxcp/config/ui_min_refresh_seconds`
- `/dxcp/config/ui_max_refresh_seconds`

---

## Minimum API needed

DeliveryGroup admin endpoints (planned):
- POST /v1/delivery-groups
- PUT /v1/delivery-groups/{id}
- PATCH /v1/delivery-groups/{id}
- DELETE /v1/delivery-groups/{id} (discouraged, optional)

Recipe admin endpoints (planned):
- POST /v1/recipes
- PUT /v1/recipes/{id}
- PATCH /v1/recipes/{id}
- POST /v1/recipes/{id}/deprecate

Validation endpoints (planned):
- GET /v1/recipes/validate?spinnakerApplication=...&deployPipeline=...&rollbackPipeline=...

---

## Current admin surfaces

Current:
- No admin UI exists.
- No admin CRUD endpoints exist.
- Recipes and delivery groups are seeded in storage by the platform.
