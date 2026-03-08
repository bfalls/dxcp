# Screen Spec - Admin

## Purpose

This note defines the concrete UI screen spec for the DXCP Admin surface as the platform governance and configuration workspace.

The Admin surface exists to help platform administrators safely manage the rules, limits, and centrally controlled delivery behavior that shape DXCP.

This screen family must preserve implemented admin capability without polluting the normal delivery UX used in [[Application Screen]], [[Deployment Screen]], [[Deployment Detail Screen]], [[Insights Screen]], and [[Deploy Workflow]].

This screen spec builds on:
- [[DXCP Core Vocabulary]]
- [[DXCP UX Grammar]]
- [[DXCP Information Architecture]]
- [[DXCP Layout Behavior]]
- [[Interaction Patterns]]
- [[Guardrails UX]]
- [[Failure UX]]
- [[Admin Screen]]
- [[Shared UI Patterns]]
- [[Product Behavior Alignment]]
- [[Decision Admin is a separate configuration workspace]]

---

## Screen Role in the Product

Admin is a separate configuration workspace inside DXCP.

It is not a general operational dashboard.
It is not a developer default workspace.
It is not the place where users should learn engine behavior.

Admin owns the platform-governance story for:
- [[DXCP Core Vocabulary#Deployment Group|Deployment Group]]
- [[DXCP Core Vocabulary#Deployment Strategy|Deployment Strategy]]
- [[Application Screen Wireframe#Alert Rail|Alert Rail]]
- System Settings
- Integrations

Admin may also expose advanced platform controls and diagnostics through progressive disclosure, but those controls must never define the default page shape.

---

## Primary User Question

The Admin surface helps a platform administrator answer:

- what platform delivery rules exist now
- what object should I change
- what risk does this change introduce
- what will become newly allowed, warned, or blocked
- who changed what and when
- what deeper diagnostics exist if a change needs investigation

---

## Screen Ownership

This screen family owns:
- governance object browsing
- governance object detail
- governance object editing
- review-before-save flows
- policy impact preview
- audit visibility for configuration actions
- access-limited admin routing
- advanced admin diagnostics through secondary disclosure

This screen family does not own:
- day-to-day application operation
- deployment investigation
- deployment submission
- system-wide observability as a primary experience
- engine execution as a first-class UX concept

---

## Implemented Capability Preserved

This spec preserves the implemented capability identified in [[Product Behavior Alignment]]:

- admin editing for policy objects
- deployment group management
- recipe-backed strategy management, reshaped into [[DXCP Core Vocabulary#Deployment Strategy|Deployment Strategy]] language
- system rate-limit governance
- mutation kill switch
- CI publisher allowlist and related publisher controls
- build provenance exposure policy for outbound links and artifact visibility
- optional Backstage context linking when configured
- audit event viewing
- environment-policy foundations where they materially affect governance objects
- advanced diagnostics when needed by platform admins

This spec intentionally preserves capability while changing presentation, hierarchy, and language.

---

## Old UI Structures Intentionally Not Inherited

This screen spec does not inherit:

- equal-weight admin subsection sprawl
- one bulky admin shell full of unrelated controls
- raw backend or storage grouping as navigation
- diagnostics density as the default view
- engine mapping or execution detail as a primary explanation
- partial read-only shells for non-admin users
- direct inheritance of the term `Recipe` as the default user-facing noun
- dense CRUD-console posture

The Admin surface should feel premium, calm, and safe rather than broad, noisy, or diagnostic-first.

---

## Entry and Navigation Model

Admin appears as a top-level navigation destination for administrators.

Inside Admin, navigation is object-first and grouped by governance purpose.

Default Admin navigation:

- Overview
- Deployment Groups
- Strategies
- System Settings
- Integrations
- Audit Log

Advanced controls are not equal-weight top-level navigation items.
They belong inside:
- progressive disclosure within object detail
- advanced subsections inside System Settings
- explicit admin-only diagnostic drawers or panels

The navigation model must preserve the separation defined in [[Admin Screen]]:
- governance objects first
- system-wide controls second
- integrations as a distinct platform configuration area
- diagnostics third

---

## Page-Level Structure

All Admin screens follow the shared DXCP layout contract.

### Top Navigation

Use the standard product shell from [[Shared UI Patterns]].

### Alert Rail

Use the page-level [[Shared UI Patterns#3. Alert Rail Pattern|Alert Rail]] directly below top navigation for:
- blocked saves
- warning summaries
- failed loads
- permission blocks
- risk explanations that affect the whole page

### Page Header

Every Admin page uses a predictable header:
- title left
- primary action right

Examples:
- `Admin`
- `Deployment Group: Payments Core`
- `Strategy: Rolling`
- `System Settings`
- `Audit Log`

Primary actions vary by page:
- `Create Deployment Group`
- `Create Strategy`
- `Edit`
- `Save`
- `Refresh`

### Body Layout

Admin pages use one dominant primary surface.

Two-column layouts are used only when the secondary rail materially improves comprehension.

Primary column:
- browse list
- object detail
- sectioned edit form
- audit table or narrative event list

Secondary column:
- validation summary
- impact summary
- policy preview status
- recent related audit activity
- advanced diagnostics entry points

The secondary column must remain clearly secondary and never compete with the main editing task.

---

## Screen Family Structure

## 1. Admin Overview

### User question

What governance areas need my attention right now?

### Why it exists

This is the orientation surface for platform administration.
It is read-first and intentionally restrained.

### Implemented capability preserved

- recent audit activity
- visibility into changed governance objects
- visibility into warning-worthy settings
- visibility into blocked or failed admin saves when available

### Default view vs disclosure

Belongs in the default view because it helps admins orient before choosing an object.
It must not become a dashboard wall.

### Default composition

Primary column:
- Changed recently
  - recently changed [[DXCP Core Vocabulary#Deployment Group|Deployment Groups]]
  - recently changed [[DXCP Core Vocabulary#Deployment Strategy|Strategies]]
- Attention needed
  - settings with warnings
  - blocked validation outcomes needing follow-up
- Recent audit activity
  - short narrative list with links into object detail or full [[Admin Screen#Audit Log|Audit Log]]

Secondary column:
- compact admin guidance
- current platform safety posture summary
- optional short explanation of what belongs in Admin vs standard delivery UX

### Notes

This page is not for editing.
It is for triage and orientation.

---

## 2. Deployment Groups browse

### User question

Which [[DXCP Core Vocabulary#Deployment Group|Deployment Groups]] exist, and which one should I open or change?

### Implemented capability preserved

- browse existing policy groups
- create and edit groups
- see group ownership and summary policy state
- understand where applications are governed

### Why default view

This belongs in the default view because Deployment Groups are the primary policy objects in DXCP.

### Default composition

Primary column:
- searchable list or comfortable table-like list
- each row/card shows:
  - name
  - owner
  - application count
  - allowed environments summary
  - allowed strategies count
  - guardrail summary
  - last changed time

Page-level actions:
- `Create Deployment Group`
- `Refresh`

Secondary column:
- selected-item summary only when a row is selected
- otherwise keep empty or use compact instructional context

### Pattern choice

Use a comfortable browse list with stable columns rather than summary cards if the object count is expected to grow.
The list should still feel readable and not like a raw admin grid.

---

## 3. Deployment Group detail

### User question

How is this [[DXCP Core Vocabulary#Deployment Group|Deployment Group]] configured, what does it govern, and what changes would matter?

### Implemented capability preserved

- view current group configuration
- view governed applications
- view allowed environments
- view allowed strategies
- view guardrails
- view recent audit activity for the object

### Why default view

This belongs in the default view because object understanding must come before editing.

### Default composition

Primary column sections:
- Overview
- Applications
- Environments
- Allowed Strategies
- Guardrails

Secondary column:
- validation state
- impact summary placeholder
- recent audit activity
- quick facts
  - applications affected
  - environments affected
  - strategies allowed

### View state

Read-only by default.

Header actions:
- `Edit`
- optional `Duplicate`
- optional `Disable` only if the product truly supports disabling as a durable object behavior

### Section guidance

#### Overview
Shows:
- name
- description
- owner
- last changed

#### Applications
Shows:
- governed applications
- count
- membership note if changes affect policy scope

#### Environments
Shows:
- allowed environments
- order if meaningful
- enabled/disabled state if that concept is confirmed

#### Allowed Strategies
Shows:
- allowed [[DXCP Core Vocabulary#Deployment Strategy|Deployment Strategies]]
- short purpose summary for each strategy

#### Guardrails
Shows:
- max concurrent deployments
- daily deploy quota
- daily rollback quota

---

## 4. Deployment Group edit

### User question

How do I safely change this group without accidentally expanding or breaking delivery policy?

### Implemented capability preserved

- edit group metadata
- update application membership
- update environments
- update allowed strategies
- update guardrails
- preview validation before save

### Why default vs disclosure

Editing is not default.
It requires explicit `Edit` mode.

### Edit model

Editing is section-based, not raw field CRUD.

Sections:
- Overview
- Applications
- Environments
- Allowed Strategies
- Guardrails

Inline validation handles:
- required fields
- malformed values
- duplicate names
- impossible limits

Section validation handles:
- incomplete policy combinations
- conflicting membership or environment rules
- invalid allowed-strategy combinations

Impact validation handles:
- newly blocked applications
- newly allowed strategies
- quota or concurrency effects
- policy consequences across multiple objects

### Secondary rail during edit

Shows:
- validation summary
- impact summary
- affected object counts
- recent save status
- entry into full preview when needed

### Primary actions

Header:
- `Save`
- `Cancel`

Save enablement:
- enabled only when changes are valid and the object is dirty

---

## 5. Strategies browse

### User question

Which [[DXCP Core Vocabulary#Deployment Strategy|Deployment Strategies]] exist, and which ones are active, deprecated, or widely used?

### Implemented capability preserved

- browse strategy objects
- create and edit strategies
- see status and usage
- preserve recipe-backed strategy behavior

### Why default view

This belongs in the default view because strategies are the centrally governed delivery behaviors exposed by DXCP.

### Default composition

Primary column:
- browse list with:
  - strategy name
  - short purpose
  - effective behavior summary
  - status
  - revision
  - usage count across Deployment Groups

Page-level actions:
- `Create Strategy`
- `Refresh`

Secondary column:
- selected-item usage summary
- selected-item status explanation

### Terminology rule

Use `Deployment Strategy` as the primary UX noun.
`Recipe` may appear only inside advanced diagnostics or implementation detail areas when needed by platform admins.

---

## 6. Strategy detail

### User question

What does this [[DXCP Core Vocabulary#Deployment Strategy|Deployment Strategy]] do, where is it used, and is it safe to change?

### Implemented capability preserved

- view strategy description and effective behavior
- view status and revision
- view usage across Deployment Groups
- view advanced mapping diagnostics when needed
- preserve deprecate/edit behavior

### Why default view

Belongs in the default view because strategy understanding must not depend on engine mapping literacy.

### Default composition

Primary column sections:
- Overview
- Behavior Summary
- Usage
- Revision History

Secondary column:
- validation state
- impact summary
- recent audit activity
- advanced diagnostics entry point

### Advanced diagnostics

Advanced diagnostics are progressive disclosure only.

They may include:
- engine mapping
- underlying recipe identity
- revision internals
- compatibility notes

They must not be required to understand the strategy as a DXCP object.

### Header actions

- `Edit`
- `Deprecate` when supported
- `Restore` only if supported

---

## 7. Strategy edit

### User question

How do I change this strategy safely without causing confusing or unsafe downstream delivery behavior?

### Implemented capability preserved

- create/edit strategy definition
- preview mapping validation
- warn when usage creates risk
- restrict changes when the strategy is in active use where appropriate

### Why default vs disclosure

Not default.
Requires explicit edit mode.

### Edit composition

Primary sections:
- Overview
- Behavior Summary
- Usage Impact
- Advanced Diagnostics

The main edit experience should stay focused on human-readable behavior, not engine mapping.

### Validation and risk rules

Inline validation:
- required fields
- status constraints
- malformed values

Impact validation:
- Deployment Groups newly affected
- applications losing access
- deprecated strategy consequences
- whether existing running state is unchanged but future deploy behavior changes

### Progressive disclosure

If engine-linked fields are needed, show them in an advanced section or drawer.
Do not place raw mapping fields in the main edit sections.

---

## 8. System Settings

### User question

Which global controls affect DXCP platform behavior, and what is safe to change now?

### Implemented capability preserved

- system rate limits
- mutation kill switch
- CI publisher controls or allowlist controls
- other platform-level governance settings confirmed by implementation

### Why default view

Belongs in the default view because system settings are a real admin capability, but the page itself must stay narrow and grouped.

### Grouping rule

System Settings are grouped by impact, not storage shape.

Recommended groups:
- Delivery Limits
- Platform Defaults
- Advanced Controls

System Settings should not become the catch-all home for every external connection.
When a configuration is primarily about an external system relationship, inventory posture, or DXCP-to-tool visibility boundary, it belongs in Integrations even if the underlying storage lives next to other runtime settings today.

### Default composition

Primary column:
- grouped settings sections
- each setting row/card shows:
  - name
  - short explanation
  - current value
  - impact scope
  - risk level
  - last changed time

Secondary column:
- risk summary
- pending changes summary
- affected platform scope
- recent audit activity

### High-risk settings

Examples:
- mutation kill switch
- wide-scope rate limits
- publisher controls affecting build registration eligibility

High-risk settings require stronger review before save.

### Edit model

Read-only by default.
Explicit `Edit` mode for mutable setting groups.

---

## 9. Integrations

### User question

Which external systems are connected to DXCP, what boundary does each integration have, and what needs configuration or review?

### Implemented capability preserved

- optional Backstage entity linking from [[Application Screen]] when configured
- organization-level control over whether DXCP shows outbound external links derived from build provenance
- CI publisher onboarding and authorization controls
- future support for additional integrations without reshaping Admin navigation again

### Why default view

Belongs in the default view because integrations are durable platform configuration, but they should remain lighter-weight than core governance objects.

Integrations deserve their own Admin area because they answer a different user question than [[DXCP Core Vocabulary#Deployment Group|Deployment Groups]], [[DXCP Core Vocabulary#Deployment Strategy|Deployment Strategies]], or System Settings.

### Default composition

Primary column:
- integration inventory list with stable columns
- each row shows:
  - integration name
  - category
  - direction
  - status
  - scope
  - last changed time

Recommended categories:
- Developer Portal
- CI / Build
- Notifications
- Observability
- Catalog / Metadata

Recommended direction values:
- DXCP shown in external tool
- external tool links into DXCP
- external identity trusted by DXCP
- DXCP emits events outward

Secondary column:
- selected integration summary
- boundary statement
- recent audit activity
- warnings or configuration gaps

### Inventory rule

Integrations should open with an inventory view, not a wall of provider-specific forms.

The inventory view should make it clear:
- what the integration is for
- whether it is active
- whether it affects delivery authority, visibility, or identity
- whether additional review is needed

### Backstage treatment

Backstage should appear as a `Developer Portal` integration.

The default Backstage row should summarize:
- DXCP remains the delivery authority
- Backstage is a visibility and entry-point client
- service context links are optional and configuration-dependent
- no governance editing happens in Backstage

### Extensibility rule

This area should support future integrations through a common inventory and detail model rather than by adding a new top-level Admin subsection for each new tool.

---

## 10. Integration detail

### User question

How is this integration configured, what does it expose or trust, and what risks would a change introduce?

### Implemented capability preserved

- explain current Backstage relationship in product language
- expose link-visibility policy as integration-facing configuration
- preserve CI publisher matching and authorization controls as integration-specific trust configuration

### Why default view

Belongs in the default view once an integration is selected because integrations need a readable summary before any edit path.

### Default composition

Primary column sections:
- Overview
- Boundary
- Configuration
- Visibility and Trust
- Recent Activity

Secondary column:
- validation state
- impact summary
- recent audit activity
- advanced diagnostics entry point when needed

### Section guidance

#### Overview
Shows:
- integration name
- category
- owner if any
- status
- last changed

#### Boundary
Shows:
- what DXCP remains authoritative for
- what the external system is allowed to read, initiate, or display
- what the integration explicitly must not do

#### Configuration
Shows only the settings the admin can safely reason about in DXCP language.

Examples:
- Backstage base URL or entity-linking posture when supported
- CI publisher named identities and matching rules
- visibility toggles for outbound provenance links

#### Visibility and Trust
Separates read-only visibility integrations from trust-bearing integrations.

Examples:
- Backstage is visibility-oriented
- CI publisher onboarding is trust-bearing because DXCP authorizes build registration based on it

#### Recent Activity
Shows:
- recent admin changes
- recent validation failures
- recent authorization-related audit events when available

### Edit model

Read-only by default.

Editing should be section-based and review-first.
The screen should not devolve into raw JSON editing except as a clearly marked advanced fallback for integration types that do not yet have structured forms.

### Progressive disclosure

Provider-specific protocol detail, tokens, claim shapes, or low-level transport data belong behind advanced disclosure.

The default detail view should answer what the integration does and why it is safe or unsafe.

---

## 11. Audit Log

### User question

Who changed what, when, and what happened?

### Implemented capability preserved

- append-only admin and delivery audit visibility
- filtering
- drill-down into affected objects

### Why default view

Belongs in the default view because auditability is a core governance capability.

### Default composition

Primary column:
- audit list or table with stable readable columns:
  - timestamp
  - actor
  - actor role
  - target type
  - target id
  - outcome
  - summary

Filters:
- actor
- target type
- target id
- outcome
- time range
- Deployment Group
- Application
- Environment

Secondary column:
- selected-event detail
- object links
- quick drill actions

### Drill-down behavior

Audit entries should support:
- open the affected Deployment Group
- open the affected Strategy
- open the related Deployment
- open filtered audit history for the selected object

The default view should prefer narrative summaries over raw schema detail.

---

## Review-Before-Save Pattern

### Purpose

Admin changes must be review-first.

### Standard flow

1. Open object
2. Review current state
3. Enter `Edit`
4. Make changes
5. Review validation
6. Review impact
7. Save
8. Confirm when risk requires it

### Review surface

Use an inline page review region or dedicated side summary by default.

Use a dedicated full preview state only when the change is broad enough to need comparative review.

### Comparison model

Preview should show:
- current state
- proposed state
- newly allowed outcomes
- newly blocked outcomes
- warnings
- blocked conditions
- affected object counts when available

This preview must use DXCP language, not backend language.

---

## Validation, Warning, and Blocked State Behavior

### User question

Why can I not save this, and what do I need to change?

### Shared rules

Use [[Interaction Patterns]] and the [[Shared UI Patterns#3. Alert Rail Pattern|Alert Rail]] consistently.

### Validation levels

#### Inline
Used for:
- required fields
- malformed values
- duplicate names

#### Section
Used for:
- inconsistent combinations
- incomplete configuration sections

#### Impact
Used for:
- changed access or governance behavior
- newly blocked or newly allowed outcomes
- cross-object risk

### State model

- Blocked
- Warning
- Info

Blocked:
- prevents save
- appears inline and in the Alert Rail summary

Warning:
- allows save
- remains visible through review and confirmation

Info:
- explains consequences without stopping the action

---

## Confirmation Behavior

### Purpose

High-risk admin changes require concrete confirmation.

### Confirmation rules

Low-risk change:
- normal `Save`

Medium-risk change:
- `Save` with visible warning review

High-risk change:
- explicit confirmation with impact summary

### Confirmation language

Use concrete statements such as:
- `Save changes to this Deployment Group?`
- `5 Applications will lose access to Rolling.`
- `Future deployments will be blocked after the lower quota is reached.`

Do not use generic confirmation language.

---

## Role-Aware Behavior

### Platform administrators

Can:
- access Admin through normal navigation
- browse and inspect all admin pages
- enter edit mode
- save changes when valid
- access advanced diagnostics
- view full Audit Log

### Non-admin users

Admin is not part of the normal navigation for non-admin users.

If a non-admin reaches an Admin route directly:
- show a full blocked-access state in the primary content area
- do not show a broken or disabled admin shell
- provide safe navigation back to standard delivery areas

### Blocked-access state

Title:
`Admin access required`

Body:
This area is limited to platform administration. Use Applications, Deployments, or Insights for standard delivery work.

Actions:
- `Open Applications`
- `Open Deployments`
- `Open Insights`

This keeps access restrictions understandable without exposing backend or token terminology.

---

## Read-Only, Blocked, and Restricted Mutation States

### Read-only object state

Use read-only as the default object mode for admins before edit is chosen.

### Blocked mutation state

If a save is blocked by validation or policy:
- keep the current page intact
- show a short Alert Rail summary
- retain inline problem markers
- preserve entered edits until the user resolves or cancels

### Restricted object state

If a supported restriction exists, such as engine-linked fields locked while a strategy is in use:
- explain the restriction in product language
- show which parts remain editable
- place deeper technical rationale in admin-only secondary disclosure if needed

---

## Responsive Behavior

### Wide desktop

- bounded centered container
- page header with action right-aligned inside container
- two-column detail/edit layouts only when the secondary rail materially helps
- stable list columns
- restrained card use

### Narrow desktop / tablet

- secondary rail drops below primary content
- primary sections remain first
- sticky secondary behavior disables when it becomes unhelpful
- action placement stays in page header

### Small screens

Admin is not optimized as a bulk-management mobile experience.

Small-screen behavior should:
- preserve comprehension
- stack sections vertically
- keep edit flows usable for focused changes
- avoid side-by-side comparison layouts
- move advanced diagnostics into drawers or separate views

Default mobile posture should emphasize inspection over broad editing.

---

## Density and Restraint Rules

Admin must feel premium and calm.

Rules:
- one dominant working surface at a time
- no dashboard wall composition
- no more than one secondary rail per page
- section headers stay short
- avoid large summary-card grids
- keep supporting counts compact
- use tables only where scanning history or structured objects materially benefits from them
- advanced controls do not share equal emphasis with core governance objects

The screen should communicate control and safety, not raw system breadth.

---

## Shared Patterns Used

This screen relies on:
- [[Shared UI Patterns]]
- [[Interaction Patterns]]
- [[Guardrails UX]]
- [[Failure UX]]
- [[DXCP Layout Behavior]]
- [[Layout Grid]]

It should reuse those patterns rather than inventing Admin-specific exceptions.

---

## Anti-Patterns to Avoid

- turning Admin into one long multi-section console
- exposing engine or storage structures as the main information architecture
- using `Recipe` as the only visible object name
- showing partial disabled admin shells to non-admin users
- treating diagnostics as equal-weight to governance objects
- placing save controls inside random cards instead of the page header
- using raw log schema as the default Audit Log experience
- hiding policy impact until after save
- making every admin subsection a dense table by default

---

## Summary

The Admin surface should feel like a separate, high-trust governance workspace inside DXCP.

It should make platform configuration understandable before it becomes editable, make risk visible before save, preserve auditability and advanced control depth, and keep the default product experience clean by separating governance work from everyday delivery work.