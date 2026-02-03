# DXCP UI Specification

This document defines the enterprise UI specification for DXCP.
It is intent-first, guardrail-aware, and avoids exposing engine internals.

Status legend:
- Current: implemented in the UI today
- Planned: not implemented yet

---

## Product UI principles

- Intent-first workflows over engine mechanics.
- Guardrails are product features, not warnings.
- Progressive disclosure of detail, no pipeline editing.
- Normalize failures and timelines into clear, actionable signals.
- Readability and predictability over configuration breadth.

## Personas and roles

- PLATFORM_ADMIN: full access, configures delivery groups and recipes.
- DELIVERY_OWNER: deploy and rollback within policy.
- OBSERVER: read-only visibility.

Role handling is enforced by the API. The UI should surface allowed actions and clear reasons when blocked.

## Navigation and information architecture

Current:
- Primary navigation: Services, Deploy, Deployments, Detail, Insights.
- Admin appears for PLATFORM_ADMIN only.
- Global scope is a single environment (sandbox).
- Admin section includes Delivery Groups and Recipes.
- Role-based visibility in navigation (admin screens only for PLATFORM_ADMIN).

Planned:
- Dashboard as landing view.

---

## Screen specifications

### Dashboard

Status: Planned

User goal:
- Get a quick read on delivery health and recent activity.

Key data:
- Recent deployments by state.
- Rollback rate summary.
- Top failure categories.

Primary actions:
- Navigate to Services, Deployments, Insights.

Blocked-action UX:
- If user is OBSERVER, show view-only state with no action buttons.

### Services list

Status: Current

User goal:
- Discover services available for deployment and observe their status.

Key data:
- Service name.
- Latest deployment state and version.
- DeliveryGroup name.
- Updated time (latest deployment).

Primary actions:
- Open service detail.

Blocked-action UX:
- For non-allowed services, do not show deploy actions.

### Service detail

Status: Current (deploy tab placeholder)

Tabs:
- Overview
- Deploy
- History
- Failures
- Insights

Overview tab
- Goal: quick status and latest activity.
- Key data: latest deployment state, version, updatedAt, rollbackOf if any.
- Actions: open deployment detail, open Spinnaker deep link.
- Integrations: show Backstage entity ref and link when configured.

Deploy tab
- Goal: submit deployment intent.
- Key data: service, recipe, environment, version, change summary.
- Actions: deploy (DELIVERY_OWNER, PLATFORM_ADMIN only).
- Blocked-action UX: show reason from API if role or policy blocks action.
Current behavior: Deploy tab links to Deploy view (no duplicate deploy form).

History tab
- Goal: scan recent deployment records for the service.
- Key data: deployment id, state, version, recipe, rollback indicator, createdAt.
- Actions: open deployment detail.

Failures tab
- Goal: see normalized failures for the service.
- Key data: category badge, summary, suggested action, observedAt.
- Secondary action: open Spinnaker execution when available.
Current behavior: Failures are derived from the latest deployment for the service.

Insights tab
- Goal: understand failure trends and rollback rate.
- Key data: failuresByCategory, rollbackRate, deploymentsByRecipe, deploymentsByGroup.
- Actions: adjust time window and filters.
Current behavior: Service-level insights are not available yet; use the Insights view.

### Deploy intent

Status: Current

User goal:
- Submit a deployment intent without managing engine details.

Key data:
- Service (allowlisted).
- Recipe (required).
- Environment (sandbox only).
- Version (auto-discovered or custom).
- Change summary (required).

Primary actions:
- Deploy now.
- Refresh services, recipes, and versions.

Form behavior:
- Recipe list is filtered by the selected service's DeliveryGroup allowlist.
- Change summary is required before deploy is enabled.

Policy side panel:
- DeliveryGroup name and owner.
- Guardrails (max concurrent deployments, daily deploy/rollback quotas).
- Quota remaining for today (derived from deployment activity).
- Selected recipe description.

Blocked-action UX:
- Show API error codes and messages in the UI shell when blocked.
- Examples: RECIPE_ID_REQUIRED, RECIPE_NOT_ALLOWED, DEPLOYMENT_LOCKED.

### Deployments list

Status: Current

User goal:
- View recent deployments and open details.

Key data:
- State, service, version, createdAt.

Primary actions:
- Open deployment detail.
- Refresh list.

Blocked-action UX:
- If API read is blocked, show error response to the user.

### Deployment detail

Status: Current

User goal:
- Understand a specific deployment, timeline, and failures, and decide on rollback.

Key data:
- State, service, version, createdAt, updatedAt.
- Spinnaker execution id and deep link.
- Timeline events (normalized, ordered by timestamp).
- Failures (normalized with category badge and suggested action).

Primary actions:
- Rollback (DELIVERY_OWNER, PLATFORM_ADMIN only).
- Open Spinnaker deep link.
- Open service URL (if available).

Blocked-action UX:
- Rollback confirmation required.
- If rollback is blocked, show API error code and message.

### Insights

Status: Current

User goal:
- Understand system-wide delivery health over the last 7 days.

Key data:
- Rollback rate.
- Failures by category.
- Deployments by recipe.
- Deployments by delivery group.

Primary actions:
- Refresh insights.

Blocked-action UX:
- If API read fails, show error response to the user.

### Settings

Status: Current (refresh interval only)

User goal:
- Control UI auto-refresh cadence without affecting backend policy.

Key data:
- Auto-refresh interval (minutes).
- Resolved refresh interval after admin bounds.

Primary actions:
- Update refresh interval (stored per-user in local storage).

Role-aware sections:
- User settings: visible to all authenticated roles.
- Admin defaults: visible to PLATFORM_ADMIN only (read-only).

Defaults and bounds:
- Default refresh interval is 5 minutes.
- Admin-defined minimum and maximum bounds are enforced in the UI.
  When the user value is outside bounds, it is clamped and a note is shown.

### Admin section

Status: Current (Delivery Groups and Recipes)

Entry visibility:
- Visible to PLATFORM_ADMIN only.

Subsections:
- Delivery Groups
- Recipes

#### Delivery Groups

User goal:
- Manage group membership and guardrails for services.

Key data:
- Group id, name, description, owner.
- Services in the group.
- Allowed recipes and guardrails.

Primary actions:
- Create and edit groups.
- Update service membership with impact preview before save.

Blocked-action UX:
- If a service is already assigned to another group, show a clear validation error.

#### Recipes

User goal:
- Manage approved deployment paths.

Key data:
- Recipe id, name, description.
- Spinnaker application and deploy/rollback pipelines.
- Status (active, deprecated).
- Used-by count (delivery groups).

Primary actions:
- Create, edit, deprecate recipes.
- View engine mapping and usage before changes.

Blocked-action UX:
- If a recipe is deprecated or not allowed for a group, block deploy and explain why.
- Engine mapping is read-only while the recipe is in use.
