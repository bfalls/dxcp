# DXCP Admin Surfaces

This document defines how PLATFORM_ADMIN configures DXCP.
It pairs with UI_SPEC.md and the intent-first product philosophy.

Status legend:
- Current: implemented in the API or UI today
- Planned: not implemented yet

---

## DeliveryGroup management

Status: Current (create and edit)

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
- Use the guardrail preview endpoint before saving changes.

Lifecycle:
- Create and edit are supported by admin surfaces.
- Delete is discouraged; prefer deactivation or migration to another group.

Audit expectations:
- Required fields: updatedAt, updatedBy.
- Append-only audit events for create and edit actions.

## Recipe management

Status: Current (create, edit, deprecate)

Purpose:
- Define approved deployment paths, mapped to the execution engine.

Fields:
- id (immutable)
- name
- description (optional)
- spinnaker_application
- deploy_pipeline
- rollback_pipeline
- status (active, deprecated)

Validation expectations:
- spinnaker_application must exist in the engine.
- deploy_pipeline and rollback_pipeline must exist under the application.
- Use the guardrail preview endpoint to validate mapping consistency.

Lifecycle:
- Create and edit are supported by admin surfaces.
- Deprecate recipes instead of deleting them.
- Deprecated recipes cannot be used for new deployments.
- Engine mapping is locked while a recipe is in use by a delivery group.

Role enforcement:
- PLATFORM_ADMIN only for create, edit, and deprecate actions.

## Admin safety principles

Required:
- Validate proposed changes before saving.
- Block save on validation errors.
- Require explicit confirmation for warnings.
- Keep admin controls disabled for non-admin roles.

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

## System settings (global rate limits)

Status: Current (read and write)

Purpose:
- Manage global API rate limits as governance policy.
- Keep abuse and cost controls centralized in platform admin workflows.

Fields:
- read_rpm
- mutate_rpm
- daily_quota_build_register

Validation:
- Integers only.
- Minimum: 1 for RPM values, 0 for daily build registration quota.
- Maximum: 5000.
- Negative and fractional values are rejected.

Storage and source of truth:
- Values are persisted in SSM and read from `DXCP_SSM_PREFIX`.
- Expected keys:
  - `/dxcp/config/read_rpm`
  - `/dxcp/config/mutate_rpm`
  - `/dxcp/config/daily_quota_build_register`
- If `daily_quota_build_register` is unset in SSM, runtime falls back to
  `DXCP_DAILY_QUOTA_BUILD_REGISTER`, then default `50`.

Operator notes:
- Changes typically propagate to enforcement within about 60 seconds.
- High values increase abuse and cost risk and should be changed carefully.

## System settings (CI publishers)

Status: Current (read and write)

Purpose:
- Manage the runtime allowlist for CI identities authorized to publish/register builds.
- Keep build certification authority in admin-governed platform settings.

Fields:
- ci_publishers (array of caller subject/client IDs)

Storage and source of truth:
- Value is persisted in SSM and read from `DXCP_SSM_PREFIX`.
- Expected key:
  - `/dxcp/config/ci_publishers`
- Stored format in SSM is comma-separated IDs.

Operator notes:
- Updates apply to runtime authorization immediately in the API process.
- `POST /v1/builds/upload-capability`, `POST /v1/builds`, and `POST /v1/builds/register`
  require caller identity to be present in `ci_publishers`.
- CI integration onboarding, helper usage, and validation checklist:
  `docs/integrations/ci/overview.md`

---

## Minimum API needed

DeliveryGroup admin endpoints (planned):
- POST /v1/delivery-groups
- PUT /v1/delivery-groups/{id}
- PATCH /v1/delivery-groups/{id}
- DELETE /v1/delivery-groups/{id} (discouraged, optional)

Recipe admin endpoints (current):
- POST /v1/recipes
- PUT /v1/recipes/{id}
- Deprecation is handled by setting status=deprecated via PUT.

Validation endpoints (planned):
Current:
- POST /v1/admin/guardrails/validate

---

## Current admin surfaces

Current:
- Admin UI supports DeliveryGroup create and edit.
- Admin CRUD endpoints exist for DeliveryGroup create and update.
- Admin UI supports Recipe create, edit, and deprecation.
- Admin CRUD endpoints exist for Recipe create and update.
- Admin UI supports System Settings for global read/mutate RPM and daily build registration quota.
- Admin API supports GET and PUT for system rate limits.
- Admin API supports GET and PUT for CI publisher allowlist.
- Recipes and delivery groups are seeded in storage by the platform.
- Admin UI exposes read-only audit events for PLATFORM_ADMIN.
