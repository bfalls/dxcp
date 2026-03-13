# Non-Admin Admin Posture Decision

## Decision summary

DXCP does **not** support read-only Admin route access as a normal posture for non-admin users.

The [[Admin Screen]] is a separate platform-governance workspace, not an extension of day-to-day delivery work. Non-admin users should not receive a partial Admin shell or read-only Admin browse as their default experience. If a non-admin user reaches an Admin route directly, that route should resolve to a focused blocked-access state instead of rendering the Admin workspace in read-only form.

Read-only remains a valid posture inside DXCP, but not for non-admin access to Admin routes. In Admin, read-only is the default object posture for platform administrators before they choose to edit. For non-admin users, Admin is route-inappropriate work and should be denied at the route level. This resolves the contradiction by treating the Slice 8 wording as superseded by the vault’s stricter role-aware rule set.

## Final rule

Non-admin users may not access Admin routes in read-only posture as a normal supported experience.

For Admin routes:

- platform administrators may enter the Admin workspace and view objects in read-only mode before choosing to edit
- non-admin users must not receive a partial Admin shell
- non-admin direct access to an Admin route must resolve to a blocked-access state in the primary content area
- Admin must not appear in normal navigation for non-admin users

Read-only posture is reserved for screens and objects the product intentionally allows a role to inspect without mutation. Route-level denial is reserved for role-inappropriate workspaces such as Admin.

## Allowed read-only cases

### 1. Platform administrator default Admin object state

Within [[Admin Screen]], platform administrators should see governance objects in read-only mode by default before entering edit mode. This preserves object understanding, review-first mutation posture, and safe editing discipline.

### 2. Delivery-facing read-only visibility where the product intentionally preserves understanding

Read-only remains valid in delivery-facing routes when the object or workflow is intentionally visible without mutation authority. Examples include delivery detail or insights-style visibility for roles that should understand the object but not act on it.

### 3. Explicit future exception only if the vault defines a scoped non-admin Admin-adjacent view

A future note could intentionally introduce a narrow exception, but only if all of the following are true:

- it is explicitly defined in the vault
- it is not the Admin workspace as such
- it has product value beyond curiosity
- it does not create false governance affordance
- it preserves clear separation between delivery work and platform administration

That exception does not exist in the current vault guidance. Under current guidance, there are no supported non-admin read-only Admin routes.

## Blocked-route cases

Use blocked route access rather than read-only Admin visibility when any of the following are true:

- the route is part of the [[Admin Screen]] workspace
- the route exposes platform-governance objects or governance mutation framing
- the route would create a partial Admin shell for a non-admin user
- the route is an admin-only diagnostic or advanced governance view
- the route is not intended as part of the user’s normal delivery path

For current DXCP design, this means:

- non-admin direct navigation to Admin
- non-admin deep links to Admin subsections
- non-admin deep links to admin-only diagnostic views

These should resolve to a calm blocked-access state, not to disabled forms, stripped controls, or read-only Admin browse.

## Distinction between unavailable, read-only, and blocked mutation

### Unavailable admin route

Use when the workspace or route is not enterable for the current role.

For this decision, non-admin access to Admin routes is treated as unavailable at the workspace level and should render as a focused blocked-access state.

User-facing meaning:
- this area is not part of your allowed workspace
- use standard delivery areas instead

Typical example:
- non-admin user opens an Admin URL directly

### Read-only admin route

Not supported for non-admin users under the current vault.

Read-only means the user may inspect the screen or object fully enough to understand it, but mutation is intentionally not offered. That posture is valid for platform administrators before edit inside Admin. It is not the non-admin Admin posture.

User-facing meaning:
- you are allowed to view this object
- editing is not currently the point of this screen state

Typical example:
- platform administrator viewing a Deployment Group before selecting `Edit`

### Blocked mutation inside an otherwise visible admin route

Use when the user is allowed to be on the screen, but a specific save or confirm action cannot proceed.

This applies inside Admin for platform administrators when validation, policy, or governance conflict prevents a change.

User-facing meaning:
- you are in the right workspace
- this specific mutation cannot proceed now
- the page remains intact and explains what is blocked and why

Typical examples:
- save blocked by validation
- save blocked by policy conflict
- mutations disabled

## Implementation guidance for UI

- Do not show `Admin` in normal navigation for non-admin users.
- Treat Admin routes as role-exclusive destinations.
- If a non-admin user reaches an Admin route directly, render a focused blocked-access state in the primary content area rather than a crippled or read-only Admin shell.
- The blocked-access state should be calm, short, and route-aware.
- Keep safe recovery actions visible, such as:
  - `Open Applications`
  - `Open Deployments`
  - `Open Insights`
- Do not render disabled Admin forms or hollowed-out Admin lists for non-admin users.
- Do not use component-level hiding as a substitute for route-level restriction when the whole workspace is out of role scope.
- Preserve read-only as a distinct state for intentionally visible screens and for admin default object viewing before edit.
- Preserve blocked mutation as a separate state from route denial. A blocked save should keep the current page intact, show alert-rail summary plus inline markers, and preserve the entered edits.
- Keep the language in DXCP product terms. Do not expose backend, token, or engine terminology.

## Impact on existing Slice 8 implementation

Slice 8 should be corrected as follows:

Replace:
- `read-only admin posture for non-admin roles where allowed`

With:
- `blocked-access posture for non-admin Admin route access`
- `read-only default object posture for platform administrators before edit`
- `blocked-save and review-before-save posture for platform administrator mutations`

Practical effect on Slice 8:

- non-admin example should be a blocked-access route example, not a read-only Admin example
- acceptance criteria should require that non-admin Admin access does not appear broken and does not render a partial Admin shell
- handoff language should distinguish:
  - route denial for non-admin Admin access
  - read-only Admin object mode for platform administrators
  - blocked mutation inside platform-admin review flows

This change narrows Slice 8 to the posture already established by the vault and removes the contradiction introduced by the earlier implementation note.

## Linked notes

- [[Admin Screen]]
- [[DXCP UX Grammar]]
- [[DXCP Core Vocabulary]]
- [[Role-Aware Behavior Rules]]
- [[Component State Coverage]]
- [[Visual State Definitions]]
- [[Shared UI Patterns]]
- [[Decision Admin is a separate configuration workspace]]
- [[Application Screen]]
- [[Deployment Screen]]
- [[Deployments Screen]]
- [[Insights Screen]]

This resolves the current contradiction in favor of the vault as the design source of truth and keeps Admin as a distinct governance workspace rather than a normal read-only destination for non-admin roles.