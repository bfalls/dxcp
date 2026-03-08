# Navigation and Cross-Screen Behavior

## Purpose

Define the final navigation behavior, transition rules, deep-link expectations, back-navigation model, and cross-screen continuity for DXCP so the product reads as one coherent system rather than a set of adjacent screens.

This note aligns navigation to [[DXCP Core Vocabulary]], [[DXCP Information Architecture]], [[DXCP UX Grammar]], [[Interaction Patterns]], [[Shared UI Patterns]], and the settled screen specs in `03-Screens`.

It preserves implemented capability already confirmed in [[Product Behavior Alignment]] while preventing accidental inheritance from the prior bad UI.

---

## Core navigation principles

### 1. DXCP stays object-first

Navigation moves users toward the right object context, not toward generic workflow destinations.

Default top-level sections remain:

- Applications
- Deployments
- Insights
- Admin

The top navigation uses plural nouns and never becomes a workflow rail.

### 2. One persistent shell, different screen families

DXCP uses one stable product shell across standard delivery screens and Admin.

Continuity comes from:

- stable top navigation
- stable alert rail placement
- stable page header zone
- stable bounded layout width
- stable primary-versus-secondary content rhythm

Continuity does not require breadcrumb stacks on every page.

### 3. Return should feel intentional, not fragile

When a user drills in from a scoped collection or workflow, DXCP should preserve enough route state to return them to the same useful browse context.

When no route state exists, DXCP should fall back to the canonical parent object or collection.

### 4. Deep links must stand on their own

Any directly opened route must be understandable without prior navigation history.

That means deep-linked screens must show:

- full object identity
- current page title
- safe primary actions for the current role
- direct links to the most relevant related object

### 5. Cross-screen continuity should stay restrained

DXCP should not use bulky breadcrumb bars, stacked tab memory, or multi-level navigation chrome to communicate continuity.

Preferred continuity devices:

- stable shell
- stable vocabulary
- stable object naming
- scoped result summaries
- one contextual return affordance when helpful
- preserved filters and time windows where they materially improve return flow

---

## Route families

### Standard delivery routes

These are the main product routes for everyday delivery work:

- Applications collection
- [[Application Screen]]
- [[Deploy Workflow]]
- [[Deployment Screen]]
- [[Deployment Detail Screen]]
- [[Insights Screen]]

### Governance routes

These are separate platform-governance routes:

- [[Admin Screen]]
- Admin subsections and admin object detail routes

Admin remains a separate workspace rather than a sibling workflow inside the standard delivery surfaces.

---

## Top navigation behavior

### Purpose

Make the highest-level areas of DXCP predictable without turning navigation into a second page header.

### Rules

- Top navigation is persistent across all DXCP routes.
- Navigation labels use DXCP nouns.
- The currently active top-level section is visually clear.
- Moving between top-level sections resets page-local transient UI such as open drawers or inline edit mode.
- Moving between top-level sections should preserve only durable state that improves comprehension:
  - user-selected time range in [[Insights Screen]]
  - recent browse filters in [[Deployment Screen]]
  - current admin subsection only while the user remains in Admin
- Top navigation should not expose a top-level `Deploy` destination.
- Admin appears in top navigation for platform administrators only.
- Non-admin direct-route entry to Admin shows the blocked-access treatment already defined by the Admin spec rather than a partial shell.

### User question answered

Where can I go in DXCP, and which major workspace am I in now?

### Implemented capability preserved

- existing section-based movement across application, deployment, insights, and admin areas
- role-aware admin access behavior
- stable shell expectations

### Why direct, contextual, or progressive

Direct. Top navigation is primary orientation and should not require intermediate choices.

### Alignment

- [[DXCP Core Vocabulary]]
- [[DXCP UX Grammar]]
- [[DXCP Information Architecture]]
- [[Shared UI Patterns]]

---

## Cross-screen continuity model

DXCP uses three continuity layers.

### 1. Object continuity

When moving between related objects, the destination header immediately names the new object.

Examples:

- Application -> Deployment
- Deployment -> Application
- Audit event -> Deployment Group
- Insights breakdown -> Deployment collection

### 2. Browse continuity

When moving from a collection or filtered summary into an object detail screen, DXCP preserves originating browse state.

Examples:

- selected deployment filters
- selected Insights time window
- selected Insights scope filters
- selected Admin audit filters

### 3. Workflow continuity

When moving from a workflow into the created object, DXCP preserves submission understanding.

Examples:

- deployment created successfully
- rollback created successfully
- blocked by concurrency with direct entry into active deployment when known

---

## Context preservation rules

### Preserve

Preserve route state when it helps the user return to unfinished browse or investigation work:

- collection filters
- time range
- scope filters
- originating section
- sort order when relevant
- selected row or highlighted object when feasible

### Do not preserve

Do not preserve transient UI that becomes stale or noisy across routes:

- open confirmation dialogs
- unsaved inline admin edits when the user leaves the route intentionally
- drawer open state across top-level section changes
- temporary hover or row expansion state

### Storage posture

Context should prefer route-state and URL-state first.

Use durable client storage only for user preferences that are broader than one route session.

---

## Major navigation behaviors

## 1. Application collection to [[Application Screen]]

### User question answered

Which application should I open to understand current state or deploy next?

### Implemented capability preserved

- application discovery
- object-first entry into application context
- deploy entry from application context rather than generic workflow-first entry

### Behavior

- Applications collection rows open directly into [[Application Screen]].
- The collection may preserve list scroll position and active collection filters on return.
- The destination does not need a breadcrumb trail because the application header is sufficient object identity.
- If the user arrived from a filtered Applications collection, a compact contextual return affordance may appear near the page header:
  - `Back to Applications`
- If there is no originating collection state, the page stands alone with no synthetic breadcrumb.

### Why direct, contextual, or progressive

Direct into the object.
Contextual on return.

### Alignment

- [[DXCP Information Architecture]]
- [[Application Screen]]
- [[Interaction Patterns]]

---

## 2. [[Application Screen]] to [[Deploy Workflow]]

### User question answered

Can I deploy this application now, and how do I do it without losing context?

### Implemented capability preserved

- deploy entry from application context
- visible guardrail and strategy context
- no duplicate workflow hidden inside the application page

### Behavior

- The primary `Deploy` action on [[Application Screen]] opens [[Deploy Workflow]] in application-context mode.
- Application selection is prefilled and locked or strongly anchored to the originating application.
- Guardrail context, strategy availability, and environment context carry forward from the application.
- The workflow must expose a clear secondary action back to the originating [[Application Screen]].
- If the user cancels before submission, returning to the application restores the application page as it was, including recent activity view position when possible.

### Why direct, contextual, or progressive

Direct entry because deploy is the expected next action.
Contextual because the workflow should inherit the application instead of asking the user to re-establish it.

### Alignment

- [[Application Screen]]
- [[Deploy Workflow]]
- [[Guardrails UX]]
- [[Shared UI Patterns]]

---

## 3. [[Application Screen]] to [[Deployment Detail Screen]]

### User question answered

What happened in that specific recent deployment?

### Implemented capability preserved

- recent deployment activity
- failure summary entry
- direct entry into detailed deployment investigation

### Behavior

- Recent activity rows and failure-linked deployment rows open directly into [[Deployment Detail Screen]].
- When entered from the application, the detail screen preserves application-origin context.
- The detail screen should expose:
  - `Open Application`
  - and, when route state exists, a contextual return affordance such as `Back to Application`
- `Open Application` is the durable related-object action.
- `Back to Application` is optional and origin-aware.

### Why direct, contextual, or progressive

Direct into the deployment object.
Contextual on return because the user often wants to resume the parent application narrative.

### Alignment

- [[Application Screen]]
- [[Deployment Detail Screen]]
- [[Deployment Timeline]]

---

## 4. [[Application Screen]] to [[Deployment Screen]]

### User question answered

I need more than recent activity. Where do I browse this application’s broader deployment history?

### Implemented capability preserved

- explicit history access from the application surface
- bounded recent activity on the application page
- fuller deployment browse in a dedicated collection surface

### Behavior

- `View deployment history` opens [[Deployment Screen]] with application scope already applied.
- The deployments collection should clearly state the active result scope.
- Returning from a deployment detail entered from this filtered history should preserve that application filter and time window.

### Why direct, contextual, or progressive

Direct into scoped history.
Contextual because this is still history about the same application, not a fresh global browse.

### Alignment

- [[Application Screen]]
- [[Deployment Screen]]
- [[Interaction Patterns]]

---

## 5. [[Deployment Screen]] to [[Deployment Detail Screen]]

### User question answered

Which deployment matters, and what exactly happened in it?

### Implemented capability preserved

- recent deployment scanning
- filtering
- direct detail entry

### Behavior

- Row click or `Open` enters [[Deployment Detail Screen]].
- The deployment detail route preserves originating browse context:
  - time window
  - application filter
  - outcome filter
  - deployment-group filter if present
- On return, the user lands back in the same filtered deployment collection state.
- If the deployment detail was opened via a copied link or external deep link, no artificial `Back to Deployments` state is fabricated. The page instead offers a durable `Open Deployments` related-object action.

### Why direct, contextual, or progressive

Direct into the deployment object.
Contextual on return because deployment investigation commonly begins from a scoped deployment browse.

### Alignment

- [[Deployment Screen]]
- [[Deployment Detail Screen]]
- [[Interaction Patterns]]

---

## 6. [[Deployment Detail Screen]] to [[Application Screen]]

### User question answered

Now that I understand this deployment, what is the application-level situation?

### Implemented capability preserved

- durable object relationship between deployment and application
- application as the main operational workspace

### Behavior

- [[Deployment Detail Screen]] includes a durable `Open Application` action.
- This action always opens the canonical parent [[Application Screen]] for the deployment’s application.
- It does not depend on origin state.
- If the deployment was opened from an application, the optional contextual return affordance can coexist, but `Open Application` remains the stable related-object action.

### Why direct, contextual, or progressive

Direct. The parent application is the natural object-level continuation.

### Alignment

- [[Deployment Detail Screen]]
- [[Application Screen]]
- [[DXCP Information Architecture]]

---

## 7. [[Deployment Detail Screen]] return behavior

### User question answered

How do I get back to where I came from without losing my place?

### Implemented capability preserved

- deployment detail entry from multiple surfaces
- intentional return to application or deployment browse
- lineage-aware investigation

### Behavior

Return precedence:

1. browser back should work normally
2. if origin route-state exists, show one contextual return affordance:
   - `Back to Deployments`
   - or `Back to Application`
   - or `Back to Insights`
   - or `Back to Audit Log`
3. always provide durable related-object actions:
   - `Open Application`
   - `Open Deployments`
   - rollback lineage links when applicable

The page must never require a breadcrumb stack to make return understandable.

### Why direct, contextual, or progressive

Contextual. Return should honor origin when known.
Direct for durable fallback actions.

### Alignment

- [[Deployment Detail Screen]]
- [[Interaction Patterns]]
- [[Deployment Timeline]]

---

## 8. [[Insights Screen]] drill-in behavior

### User question answered

I see an elevated trend or notable event. Where should I open next?

### Implemented capability preserved

- time-window filtering
- application and deployment-group filtering
- drill-down from trends and breakdowns
- notable activity entry into deployment detail

### Behavior

- notable activity items open [[Deployment Detail Screen]]
- breakdown rows or segments open [[Deployment Screen]] with scope applied
- application-oriented attention items may open [[Application Screen]] when the next question is application health rather than deployment browsing
- the selected Insights time window persists across drill-in when useful
- selected Insights scope filters persist into the destination when they map cleanly to destination filters
- destination pages must make inherited scope visible in result framing

Examples:

- failure category spike -> filtered [[Deployment Screen]]
- rollback item -> [[Deployment Detail Screen]]
- application needing attention -> [[Application Screen]]
- deployment-group concentration -> filtered [[Deployment Screen]] or relevant application context depending on granularity

### Why direct, contextual, or progressive

Contextual. Insights is a summary surface, so drill-in should carry the analytical context that caused the user to move.

### Alignment

- [[Insights Screen]]
- [[Deployment Screen]]
- [[Deployment Detail Screen]]
- [[Application Screen]]

---

## 9. Admin audit-event drill-in behavior

### User question answered

This audit event matters. What object changed, and where do I inspect it?

### Implemented capability preserved

- audit visibility
- drill-in into affected governance objects
- linkage into related delivery objects where relevant

### Behavior

Audit rows may open:

- affected Deployment Group
- affected Deployment Strategy
- related [[Deployment Detail Screen]]
- filtered audit history for the same target

Rules:

- admin governance targets stay in Admin
- delivery objects open in their normal object screens
- drill-in should preserve audit filters on return
- a direct-route delivery object opened from audit should still look like a normal DXCP object screen, not an admin-themed variant

### Why direct, contextual, or progressive

Direct into the affected object.
Contextual on return because audit review often involves comparing several events within one filtered audit slice.

### Alignment

- [[Admin Screen]]
- [[Deployment Detail Screen]]
- [[Application Screen]]
- [[Interaction Patterns]]

---

## 10. Deep-link expectations

### User question answered

What should happen if I land directly on a specific object or filtered state?

### Implemented capability preserved

- direct object access
- sharable deployment and application routes
- durable admin review routes for authorized users

### Behavior

All deep links must be self-sufficient.

#### Direct object deep links

A direct link to [[Application Screen]] or [[Deployment Detail Screen]] must show:

- full object identity
- current state
- role-appropriate actions
- safe related-object links

#### Direct filtered collection deep links

A direct link to [[Deployment Screen]] or [[Insights Screen]] with filters/time scope must show:

- the filters as visible current scope
- a calm result framing summary
- removable filters

#### Direct admin deep links

- authorized admins see the requested admin page
- non-admin users see the blocked-access state, not a partial disabled admin shell

### Why direct, contextual, or progressive

Direct. Deep links must not rely on hidden prior state.

### Alignment

- [[Interaction Patterns]]
- [[Deployment Screen]]
- [[Insights Screen]]
- [[Admin Screen]]

---

## 11. Back-navigation expectations

### Purpose

Define the relationship between browser back behavior and in-product return actions.

### Rules

- Browser back remains the primary low-friction return behavior.
- In-product return actions are supplements, not replacements.
- DXCP should never fight browser history by forcing unexpected intermediate redirects.
- Automatic redirects are reserved for successful workflow handoff where the destination object is the next logical place.
- If a route was entered directly, in-product return uses durable fallbacks rather than pretending there is previous DXCP history.

### Return hierarchy

1. browser back
2. one contextual return link when origin state exists
3. durable related-object actions
4. top navigation

### Why contextual, not breadcrumb-heavy

This keeps DXCP premium and calm.
Users get reliable return behavior without a bulky navigation bar competing with page content.

### Alignment

- [[Interaction Patterns]]
- [[Shared UI Patterns]]

---

## 12. Preserving filters and browse context

### User question answered

Will DXCP remember what I was looking at when I open something and come back?

### Rules

Preserve on object drill-in and return:

- deployment filters
- Insights time range
- Insights scope filters
- Admin audit filters
- result framing context

Do not preserve across unrelated top-level navigation jumps unless the state is a durable preference or a section-level expectation.

Examples:

- leave [[Insights Screen]] and come back later through top navigation:
  - keep last selected time range
  - clear ephemeral section-local UI
- leave a filtered [[Deployment Screen]] for a deployment detail and return:
  - restore the filtered collection
- leave Admin entirely:
  - preserve current subsection only when the user returns soon in the same session
  - do not preserve unfinished edit mode

### Alignment

- [[Deployment Screen]]
- [[Insights Screen]]
- [[Admin Screen]]
- [[Interaction Patterns]]

---

## 13. Success handoff from [[Deploy Workflow]] to [[Deployment Detail Screen]]

### User question answered

What happened after I deployed, and where do I follow it now?

### Implemented capability preserved

- deployment submission creates a deployment object
- immediate movement into detail
- durable success handoff

### Behavior

Preferred flow:

1. user submits deploy
2. workflow shows brief success confirmation in-place
3. deployment identifier is confirmed
4. user is automatically redirected to [[Deployment Detail Screen]]
5. the new deployment detail becomes the canonical place to follow progress

If redirect fails:

- preserve entered workflow values
- show `Open Deployment`
- keep `Open Application` available

DXCP should never end deployment success with only a toast and no durable object link.

### Why direct, contextual, or progressive

Direct after brief local confirmation.
The workflow is not the right place for ongoing execution watching.

### Alignment

- [[Deploy Workflow]]
- [[Deployment Detail Screen]]
- [[Interaction Patterns]]

---

## 14. Role-aware route access behavior

### User question answered

Why can I open this screen but not act, or why can I not open it at all?

### Implemented capability preserved

- role-aware action visibility
- blocked-action explanation
- admin route restriction
- observer read access to application/deployment/insights surfaces

### Behavior

#### Applications, deployments, and insights

- readable routes remain readable for authorized non-admin roles
- expected actions remain visible when appropriate but may be unavailable with explanation
- blocked actions use the standard DXCP blocked-action treatment

#### Deploy workflow

- if intentionally exposed to read-only users, the workflow stays read-only and explanatory
- otherwise deploy entry is withheld upstream and direct-route access resolves to a clear blocked or read-only state consistent with settled workflow rules

#### Admin

- admin navigation appears only for platform administrators
- non-admin direct-route entry shows blocked-access state with safe exits to standard delivery areas

This route model aligns the stricter admin separation with the governance contract while preserving readable delivery surfaces for non-admin roles.

---

## 15. Premium continuity without excess breadcrumbs

### Purpose

Define how DXCP feels connected without clutter.

### Rules

Use these continuity devices:

- same bounded shell
- same alert rail placement
- same page header structure
- same noun-based titles
- same action placement logic
- one contextual return affordance when origin matters
- visible inherited scope when filters/time range carry across screens

Avoid:

- permanent multi-level breadcrumb bars
- duplicate navigation in page headers
- tab-memory hacks across unrelated screens
- admin-themed versions of standard object pages
- route transitions that erase user context without explanation

### Result

DXCP feels premium because movement is predictable, context is preserved when it matters, and every destination stands on its own without needing bulky navigation scaffolding.

---

## Route transition summary

### Preferred transition map

- Applications -> [[Application Screen]]
- [[Application Screen]] -> [[Deploy Workflow]]
- [[Application Screen]] -> [[Deployment Detail Screen]]
- [[Application Screen]] -> [[Deployment Screen]] with application scope
- [[Deployment Screen]] -> [[Deployment Detail Screen]]
- [[Deployment Detail Screen]] -> [[Application Screen]]
- [[Insights Screen]] -> [[Deployment Screen]] with inherited scope
- [[Insights Screen]] -> [[Deployment Detail Screen]]
- Admin Audit Log -> admin object detail or [[Deployment Detail Screen]] as appropriate

### Return summary

- preserve originating scope on drill-in
- use one contextual return affordance when origin is known
- always provide durable related-object actions
- let browser back work naturally

---

## Summary

DXCP navigation should feel like one calm system because the shell is stable, the nouns stay consistent, object routes are canonical, browse context is preserved on drill-in, deep links stand on their own, workflow success hands off directly into durable objects, and return behavior favors one smart contextual affordance over breadcrumb clutter.

## Related

- [[DXCP Core Vocabulary]]
- [[DXCP Information Architecture]]
- [[DXCP UX Grammar]]
- [[Interaction Patterns]]
- [[Shared UI Patterns]]
- [[Application Screen]]
- [[Deploy Workflow]]
- [[Deployment Screen]]
- [[Deployment Detail Screen]]
- [[Insights Screen]]
- [[Admin Screen]]
- [[Deployment Timeline]]
- [[Product Behavior Alignment]]