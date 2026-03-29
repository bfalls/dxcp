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
- Operator confidence through restraint.
- Explain when needed, not by default.

## Cross-screen restraint and density rules

These rules are normative across DXCP screens.

- Use one loading signal per major surface.
- Use one issue surface per condition class.
- Keep page-level context controls compact and close to the page header.
- Do not present simple filters or selectors as oversized summary cards.
- For repeated structured data, prefer dense table or list layouts over card grids.
- Do not repeat page-level context as row-level metadata when the whole surface is already scoped.
- Do not render developer-narration or design-explainer copy in product UI.
- Keep primary actions in the page header or other explicitly defined action zone.
- Do not duplicate global navigation in page-level action areas.
- Keep supporting context subordinate to the main task.

## Personas and roles

- PLATFORM_ADMIN: full access, configures delivery groups and recipes.
- DELIVERY_OWNER: deploy and rollback within policy.
- OBSERVER: read-only visibility.

Role handling is enforced by the API. The UI should surface allowed actions and clear reasons when blocked.

## Navigation and information architecture

Current:
- Primary navigation: Applications, Deployments, Insights, Admin.
- Admin appears for all authenticated roles (read-only for non-admins).
- Environment is an explicit operating context for delivery-facing routes.
- Environment scope should be selected at the page or route-family level, not repeated as row metadata when a screen is already scoped.
- Role-based access is enforced by the API; non-admins see admin screens as read-only.

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
- Navigate to Applications, Deployments, Insights.

Blocked-action UX:
- If user is OBSERVER, show view-only state with no action buttons.

### Applications list

Status: Current

User goal:
- Discover applications available for deployment and observe their status in the selected environment.

Page context:
- Environment selector under the page header.
- Search.

Key data:
- Application name.
- Latest deployment state and version for the selected environment.
- DeliveryGroup name.
- Updated time when available.

Primary actions:
- Open application detail.
- Refresh list.

Presentation rules:
- Use a dense table or list for repeated structured data.
- Make the application row the default action surface.
- Keep one optional secondary state line only when it adds immediate operational value.
- Do not repeat environment as a row column when the page is already scoped to one environment.

Blocked-action UX:
- For non-allowed applications, do not show deploy actions.

Loading and empty-state UX:
- Use one table-body loading treatment.
- Do not duplicate loading text in separate summary fields.
- Keep passive result counts in quiet table metadata rather than in a second toolbar row.

### Application detail

Status: Current

User goal:
- Understand the selected application in the current environment context and decide what to do next.

Page context:
- Application detail is environment-scoped for current-running state, recent deployment state, deploy readiness, and rollback lineage.
- The environment context must be visible and changeable for delivery-facing workflows.

Key data:
- Current running version and deployment.
- Latest deployment state and latest finished deployment in the selected environment.
- DeliveryGroup and supporting context.

Primary actions:
- Deploy (DELIVERY_OWNER, PLATFORM_ADMIN only).
- Refresh.

Presentation rules:
- Keep the page summary-first and object-first.
- Prefer one main overview card and one smaller supporting-context card by default.
- Do not render route-origin narration.
- Do not render repeated navigation buttons that duplicate the top navigation.
- Do not render developer-explainer copy under section titles.

Issues and blocked-action UX:
- Use one compact page-context issue surface directly under the page header for object-level or page-level issues.
- Keep action-level blocked explanation near the affected control when needed.
- Do not render multiple banners or cards for the same issue.

Loading UX:
- Use one loading treatment per major card.
- Do not render multiple nested loading blocks for subsections inside the same card.
- Do not use unavailable or failure language during normal loading.

### Deploy intent

Status: Current

User goal:
- Submit a deployment intent without managing engine details.

Key data:
- Application or service (allowlisted).
- Recipe (required).
- Environment (current selected environment context).
- Version (auto-discovered or custom).
- Change summary (required).

Primary actions:
- Deploy now.
- Refresh services, recipes, and versions.

Form behavior:
- Recipe list is filtered by the selected service's DeliveryGroup allowlist.
- Change summary is required before deploy is enabled.
- Environment should be expressed as explicit page or route context, not hidden row metadata.

Policy side panel:
- DeliveryGroup name and owner.
- Guardrails (max concurrent deployments, daily deploy and rollback quotas).
- Quota remaining for today (derived from deployment activity).
- Selected recipe description.

Blocked-action UX:
- Show normalized deploy-block reasons in the page context rail or near the affected action.
- Keep raw API error codes and backend language out of standard operator UI.
- If operator_hint is present and the user is PLATFORM_ADMIN, show it in bounded admin diagnostics only.

Loading UX:
- Use one loading treatment for the main form surface and one for the supporting context surface when needed.
- Do not duplicate loading messages across nested sections.

### Deployments list

Status: Current

User goal:
- View recent deployments and open details for the selected environment context.

Page context:
- Environment context is selected at the page or route-family level.

Key data:
- State, service, version, createdAt.

Primary actions:
- Open deployment detail.
- Refresh list.

Presentation rules:
- Keep the collection dense and calm.
- Do not let the table define the entire product identity.
- Do not repeat environment as a row column when the whole list is already scoped.

Blocked-action UX:
- If API read is blocked, show normalized error response to the user.

### Deployment detail

Status: Current

User goal:
- Understand a specific deployment, timeline, and failures, and decide on rollback.

Key data:
- State, service, version, environment, createdAt, updatedAt.
- Execution id and deep link (PLATFORM_ADMIN only).
- Timeline events (normalized, ordered by timestamp).
- Failures (normalized with category badge and suggested action).

Primary actions:
- Rollback (DELIVERY_OWNER, PLATFORM_ADMIN only).
- Open execution detail (PLATFORM_ADMIN only).
- Open service URL (if available).

Presentation rules:
- Timeline should read as product narrative, not raw logs.
- Long identifiers should be secondary metadata, not the primary action label.
- Keep page-level issues in the page context rail, not in mid-page banners.

Blocked-action UX:
- Rollback confirmation required.
- If rollback is blocked, show normalized reason in the page context rail and near the affected action as needed.

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
- If API read fails, show normalized error response to the user.

Presentation rules:
- Keep insights restrained.
- Metrics should not become the loudest visual surface in the product.

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

Status: Current (Delivery Groups, Recipes, and System Settings)

Entry visibility:
- Visible to all authenticated roles; controls are disabled unless PLATFORM_ADMIN.

Subsections:
- Delivery Groups
- Recipes
- System Settings

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
- Preview guardrail validation before saving changes.

Blocked-action UX:
- If a service is already assigned to another group, show a clear validation error.
- If validation returns warnings, require explicit confirmation before saving.
- If validation returns errors, block save.

Presentation rules:
- Preserve review-before-save.
- Do not regress into generic CRUD forms.

#### Recipes

User goal:
- Manage approved deployment paths.

Key data:
- Recipe id, name, description.
- Engine mapping (PLATFORM_ADMIN only).
- Status (active, deprecated).
- Used-by count (delivery groups).

Primary actions:
- Create, edit, deprecate recipes.
- View engine mapping and usage before changes.
- Preview mapping validation before saving changes.

Blocked-action UX:
- If a recipe is deprecated or not allowed for a group, block deploy and explain why.
- Engine mapping is read-only while the recipe is in use.
- If validation returns warnings, require explicit confirmation before saving.
- If validation returns errors, block save.

#### System Settings

User goal:
- Manage global rate-limit governance without direct infrastructure access.

Key data:
- Read RPM.
- Mutate RPM.
- API request_id when errors occur.

Primary actions:
- Load current values.
- Save updated values.

Validation:
- Integer values only.
- Allowed range: 1 to 5000.
- Save is enabled only when values are changed.

Safety text:
- "Changing rate limits affects platform safety and cost controls."

Blocked-action UX:
- Non-admin users cannot access this subsection.
- On API failure, show clear error text with request_id when available.

Operator note:
- Changes typically take effect within about 60 seconds.
- High values increase abuse and cost risk.
