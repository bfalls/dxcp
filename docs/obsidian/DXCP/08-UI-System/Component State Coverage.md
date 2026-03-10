# Component State Coverage

## Purpose

This note defines the formal state coverage model for the highest-value DXCP shared component families so implementation can preserve calmness, explainability, and consistency under normal, blocked, degraded, read-only, and review-heavy conditions.

It extends [[Component Families]] and [[Component and System Planning]] without reopening settled hierarchy, screen ownership, or composition decisions already captured in [[Screen Spec - Application]], [[Screen Spec - Deployment Detail]], [[Screen Spec - Deploy Workflow]], [[Screen Spec - Deployments]], [[Screen Spec - Insights]], [[Screen Spec - Admin]], [[Shared UI Patterns]], [[Responsive and Density Rules]], and [[Visual Language Direction]].

## State-planning stance

DXCP state handling must be designed as product behavior, not left to local screen improvisation.

The governing stance is:

- default state should feel stable, readable, and unsurprising
- state changes should preserve the same spatial story rather than replacing it with a different layout
- blocked, read-only, degraded-read, and failure conditions must remain distinguishable
- normalized operator explanation comes first
- advanced diagnostics come second, and only where the product already authorizes them
- admin surfaces may expose deeper diagnostics through progressive disclosure, but diagnostics must not become the default page shape
- responsive compression may shorten or collapse state presentation, but must not hide the main explanation

This follows the language discipline of [[DXCP UX Grammar]], the object hierarchy in [[DXCP Object Model]], the guardrail posture in [[Guardrails UX]], and the normalized explanation model in [[Failure UX]].

## State classification model

DXCP shared components use the following state classes.

### 1. Default

The component has enough valid data and permission to perform its intended job.

### 2. Loading

The component is waiting for required data or validation and preserves the expected layout shape with restrained placeholders.

### 3. Empty

The system has no meaningful content yet for that component, but the state is valid and calm.

Example posture:
- no prior deployments
- no recent failures
- no configured integrations

### 4. No results

The component has data in general, but current filters, scope, or search return nothing.

This must be distinct from true empty history.

### 5. Degraded-read

The component can still show meaningful primary content, but some evidence, freshness, or supporting reads are incomplete, stale, or unavailable.

This is not a full failure state.

### 6. Failure

The component cannot fulfill its core read or mutation purpose and must say so clearly.

Failure may be:
- read failure
- validation failure
- submission failure
- save failure
- load failure for required supporting data

### 7. Blocked

The user can understand the intended action, but the product or policy prevents it now.

Blocked states require:
- what is blocked
- why it is blocked
- what to do next when possible

### 8. Disabled

The control is not currently actionable because a prerequisite is missing, incomplete, or still computing.

Disabled is not the same as blocked. Disabled usually resolves through completion or readiness, not policy denial.

### 9. Read-only

The user may view the component or screen, but mutation is intentionally not available for that role or context.

Read-only is an intentional valid product state, not a broken state.

### 10. Unavailable

The component, route, or capability is not available in the current product or current access context.

Unavailable is broader than read-only. It may mean:
- the surface does not exist for the user
- the route is access-restricted
- the capability is not exposed in this context
- the product intentionally withholds the feature upstream

### 11. Review-heavy

The component is in a pre-commit moment where DXCP requires careful inspection before save or submit.

This matters most in admin editing and confirm-heavy changes, not in ordinary browse surfaces.

## Prioritized component family state coverage

State coverage is required first for these families:

1. product shell and structural frame family
2. page header and action hierarchy family
3. alert, guardrail, and blocked-state explanation family
4. status and semantic indicator family
5. summary block family
6. timeline and event-rendering family
7. failure explanation family
8. controlled collection family
9. filter and scope control family
10. state block family
11. review-before-save editing family
12. confirmation surface family
13. restrained analytical visualization family
14. integration boundary family

The first seven families are the highest-risk consistency layer and must be implemented with the strongest state discipline.

## Family-by-family required state definitions

## 1. Product shell and structural frame family

Used across all major delivery and admin routes.

Required states:
- default
- loading during first route load
- degraded-read when shell-level supporting data is incomplete but the primary screen can still render
- failure only when the route cannot meaningfully render its primary screen
- unavailable for route-level access restriction

Rules:
- shell loading must preserve the page frame, header zone, and alert rail position
- shell failure should be rare and should not be used for ordinary section-level read failures
- non-admin deep-link entry to [[Admin Screen]] should resolve to a focused blocked-access or unavailable treatment, not a partial disabled shell
- shell state must never create visual uncertainty about where page title, actions, and alerts belong

Responsive implication:
- under compression, shell state messaging may shorten, but alert location and header ownership stay fixed

## 2. Page header and action hierarchy family

Used in all major screen specs.

Required states:
- default
- loading placeholder for title or key identity fields
- disabled action
- blocked action
- read-only action posture
- unavailable action when the action should not be shown at all

Rules:
- expected primary actions should remain visible when helpful, even when blocked
- blocked action states must prefer visible action plus explanation over silent removal when user expectation is high
- disabled is for missing prerequisites or incomplete form state
- read-only is for legitimate viewer posture
- unavailable is for actions that should not be presented in that context at all
- header action state must not displace page identity

Material role difference:
- delivery-facing users may see blocked deploy or rollback actions with explanation
- observers may see read-only posture where the workflow is intentionally visible
- admin mutation actions appear only where the admin surface has entered edit or review posture

Responsive implication:
- lower-priority actions may collapse into overflow, but blocked or read-only explanation for the primary action must remain discoverable without opening deep menus first

## 3. Alert, guardrail, and blocked-state explanation family

This is the system’s main explanation layer for policy, safety, blocked action, and degraded-read notice.

Required states:
- default quiet state
- informational notice
- warning
- blocked-action explanation
- degraded-read notice
- read failure
- mutation-disabled notice
- review caution in admin save flows

Rules:
- page-level alerts belong in the alert rail
- component-local blocked explanation may appear near the affected control, but must stay consistent with the rail
- blocked language must stay operational and specific
- read-only should not use blocked-alert language unless a specific attempted action is being denied
- degraded-read must not sound like full system failure when useful content still exists
- raw API or engine detail must not be the primary explanation layer

Diagnostics disclosure boundary:
- delivery surfaces may expose concise follow-up detail only where already sanctioned by screen specs
- admin surfaces may add progressive disclosure for request ids, validation details, or engine-adjacent evidence when needed
- diagnostics must never replace the primary normalized explanation

Responsive implication:
- alert copy may tighten
- multiple notices should compress into a stable stack rather than fragmenting across the page

## 4. Status and semantic indicator family

Used for deployment outcome, failure category, deprecation, muted support state, and related semantic markers.

Required states:
- default status
- success
- in-progress
- warning
- failure
- blocked
- deprecated
- disabled
- muted supporting status

Rules:
- indicators communicate meaning, not full explanation
- indicators must not carry the whole blocked or failure story without nearby text
- status emphasis stays restrained in browse surfaces and stronger in investigation or review moments
- deprecation and disabled semantics must remain distinct from failure

Material role difference:
- role rarely changes the indicator itself
- role changes whether deeper explanation or diagnostic routes are available around the indicator

Responsive implication:
- labels may shorten to stable compact forms, but semantic distinction must survive compression

## 5. Summary block family

Used for object summaries, running version, deployment summary, policy context, and admin object summaries.

Required states:
- default
- loading
- empty where the underlying object is valid but no summary evidence exists yet
- degraded-read when some supporting fields are unavailable
- read failure only when the summary cannot establish object comprehension

Rules:
- summary blocks should usually preserve structure even when fields are missing
- degraded summary should prefer field-level omission plus a restrained degraded notice instead of collapsing the whole block
- summary blocks must not become mini-dashboards or log containers

Material role difference:
- admin users may see additional metadata or review context
- delivery-facing users should still receive the same object-first summary before any diagnostics

Responsive implication:
- lower-priority metadata may collapse or truncate, but object identity and primary state must remain intact

## 6. Timeline and event-rendering family

Used most strongly in [[Deployment Detail Screen]] and related recent activity presentations.

Required states:
- default
- loading
- short-history valid state
- empty only where the timeline concept legitimately has no events yet
- degraded-read when some event evidence is missing or partial
- failure-to-load when the timeline cannot tell the deployment story
- event with linked normalized failure
- event with optional admin-only diagnostics

Rules:
- timeline remains the dominant investigation surface
- linked failures belong near the relevant event, not in disconnected diagnostic walls
- degraded-read may mark missing or partial evidence inline without erasing the rest of the timeline
- blocked deployments must show policy stop points clearly and must not imply downstream execution evidence that never happened

Diagnostics disclosure boundary:
- admin-only diagnostics may exist behind progressive disclosure at the event level
- raw engine evidence must stay secondary to the normalized narrative

Responsive implication:
- timeline density may compress
- secondary metadata and diagnostics stay collapsed first
- the event sequence and main failure moment must remain readable

## 7. Failure explanation family

Used in deployment detail, recent failures, blocked submission contexts, and investigation-oriented admin moments.

Required states:
- no failure present
- primary normalized failure present
- multiple failures with one primary explanation
- blocked outcome explanation
- degraded investigative explanation
- failure to retrieve failure detail when core deployment data still exists
- admin diagnostics hidden
- admin diagnostics expanded

Rules:
- one primary normalized explanation comes first
- multiple competing failure panels are not allowed
- blocked, failed, canceled, superseded, and degraded situations must not all look the same
- use concise outcome messaging when there is no true failure
- the failure block is a summary lens, not a replacement for timeline evidence

Diagnostics disclosure boundary:
- admin diagnostics may expose deeper request or engine-adjacent detail
- diagnostics stay collapsed by default
- delivery-facing roles should not need diagnostics to understand what happened

Responsive implication:
- keep the primary failure explanation near the top of the investigation story
- diagnostics remain subordinate and collapsed under narrow layouts

## 8. Controlled collection family

Used for deployment lists, recent activity rows, admin inventories, and bounded browse collections.

Required states:
- default
- loading
- empty
- no results
- degraded-read
- read failure
- row action blocked
- permission-limited collection context when applicable

Rules:
- collections should not collapse into generic data-grid behavior
- empty and no-results must remain distinct
- row actions should hand off to object detail, not become a local action console
- partial data availability should prefer degraded-read notice over full-page failure where scan value remains

Material role difference:
- admin inventories may show edit affordances and review entry points
- observer and delivery-facing collection states stay browse-first, not diagnostics-first

Responsive implication:
- collection shape may switch from table to stacked row treatment according to [[Responsive and Density Rules]]
- state meaning must not change when the row layout changes

## 9. Filter and scope control family

Used in [[Screen Spec - Deployments]], [[Screen Spec - Insights]], and bounded admin browse contexts.

Required states:
- default
- loading available values
- empty available values
- no results after filter application
- unavailable filter option
- degraded-read for incomplete count or option metadata
- disabled while prerequisite data is absent

Rules:
- filters support comprehension but do not become the page story
- unavailable options should be explained only when that distinction materially helps the user
- filter state must not masquerade as collection state
- filter controls should compress before fragmenting

Responsive implication:
- lower-priority controls may collapse
- the active scope still needs to remain visible without ambiguity

## 10. State block family

This is the reusable rendering family for calm loading, empty, no-results, blocked-mutation, degraded-read, and read-failure treatments.

Required states:
- loading block
- empty block
- no-results block
- blocked block
- read-only explanatory block where screen posture requires it
- degraded-read notice block
- read-failure block

Rules:
- state blocks are calm and utilitarian
- they should preserve the product’s tone without decorative theater
- blocked and read-only variants must remain distinct
- state blocks should be attachable at page, section, rail, or collection scope depending on what failed

Responsive implication:
- wording may shorten
- blocks should not expand into bulky banners on small widths

## 11. Review-before-save editing family

Used primarily in [[Screen Spec - Admin]].

Required states:
- default read-only viewing state
- edit mode
- dirty state
- review-required state
- save enabled
- save disabled due to incomplete or unchanged data
- save blocked by validation or policy
- save failure
- save success with calm confirmation
- mutations disabled
- discard / cancel confirmation when meaningful

Rules:
- admin starts in read-only object understanding mode before edit is chosen
- changes should move through explicit review before commit where the screen spec requires it
- blocked save and failed save must remain distinct
- warnings may require explicit acknowledgement without being treated as hard failures
- review-heavy posture should increase attention around impact, changed fields, and blocked outcomes, not around diagnostics

Diagnostics disclosure boundary:
- admin may reveal deeper validation detail, request ids, or object dependency context
- diagnostics must stay secondary to changed-value review and impact comprehension

Responsive implication:
- review summaries and warnings stay above advanced diagnostics
- field-level editing may compress, but review clarity must not be sacrificed for density

## 12. Confirmation surface family

Used for rollback confirmation, risky admin save moments, and other bounded commit checks.

Required states:
- default confirmation
- warning confirmation
- blocked confirmation
- disabled confirm action
- failure after confirm attempt when inline retry is appropriate

Rules:
- confirmations should clarify consequence, not restate the whole screen
- blocked confirmation should explain why the intended action cannot proceed now
- confirmation surfaces must not become hidden diagnostics drawers

## 13. Restrained analytical visualization family

Used in [[Screen Spec - Insights]].

Required states:
- default
- loading
- empty
- no results
- degraded-read for partial chart or metric availability
- read failure

Rules:
- charts remain supporting comprehension tools, not the entire observability story
- degraded chart regions may be marked inline while preserving the rest of the page
- Insights should not become an admin diagnostics page

Material role difference:
- role differences are minimal
- platform admins may have downstream diagnostic routes elsewhere, not inside the chart treatment itself

Responsive implication:
- visual summaries may simplify under compression, but filters, trend meaning, and drill-in continuity must remain stable

## 14. Integration boundary family

Used for Backstage and future bounded integrations.

Required states:
- configured and available
- configured but unreachable or degraded-read
- not configured
- read-only visibility
- unavailable because the integration is not enabled for this object or context

Rules:
- integration blocks remain secondary to the core DXCP object story
- unreachable integration should not imply the underlying DXCP object is invalid
- not configured is a valid empty-like state, not a failure
- integration controls in admin should follow review-before-save rules when editable

## Read-only vs unavailable distinction

DXCP must preserve a strict difference between read-only and unavailable.

### Read-only

Use read-only when:
- the user may inspect the object or workflow
- mutation is intentionally not offered
- the product wants the user to understand the shape of the capability even without acting

Examples:
- visible deploy workflow with no submit capability for a role that may inspect intent requirements
- admin object view before edit is chosen
- non-mutating visibility into settings bounded by product rules

### Unavailable

Use unavailable when:
- the capability or route is not exposed in this context
- the product should not present a partial tool that suggests action is almost possible
- direct-route access must resolve to a focused denial state rather than a half-usable screen

Examples:
- restricted admin route for non-admin users where the product does not intend a browse posture
- hidden actions that would mislead if shown without any valid path to use
- integration functions not enabled for the current object

### Blocked compared with read-only and unavailable

Blocked is different again:
- the user can understand and often see the intended action
- the system is saying “not now” or “not under current policy”
- explanation is required because user expectation is active

## Degraded-read and failure handling guidance

DXCP should prefer degraded-read when meaningful primary comprehension still exists.

Use degraded-read when:
- core object identity is known
- part of the evidence is missing, stale, or partial
- the screen can still answer the dominant user question well enough to remain useful

Use failure when:
- the component cannot answer its core user question
- the primary story collapses without the missing read
- continuing to render normal structure would create false confidence

Guidance:
- degraded-read notices should be restrained and local to the affected region when possible
- page-level read failure belongs in the alert rail plus the affected primary region
- delivery surfaces should keep normalized explanation first
- admin surfaces may add deeper technical evidence only after the default explanation layer is complete
- failure language should distinguish between inability to read, inability to validate, inability to save, and policy denial

## Diagnostics disclosure boundaries

Diagnostics disclosure must remain tightly controlled.

### May expand in admin

Admin surfaces may progressively disclose:
- request identifiers
- validation detail
- dependency or impact detail
- engine-adjacent references already sanctioned by the product
- advanced evidence needed for safe governance editing or investigation

This is most appropriate in:
- [[Screen Spec - Admin]]
- focused investigation moments linked from [[Screen Spec - Deployment Detail]]
- explicitly secondary diagnostic slots already captured in the screen specs

### Must stay hidden by default

The following must stay hidden or collapsed by default:
- raw codes as primary blocked explanation
- long diagnostic dumps
- engine-shaped evidence that competes with DXCP’s normalized story
- secondary admin detail on broad browse surfaces
- diagnostic density in [[Screen Spec - Insights]] and [[Screen Spec - Deployments]]

### Delivery surfaces

Delivery-facing screens may expose selected deeper detail only when the screen spec already calls for it, but the default posture remains:
- operator language first
- action meaning second
- diagnostics third

## Responsive state implications

Responsive behavior remains compressive, not transformative.

State-specific implications:
- blocked, read-only, and degraded explanations must remain visible without requiring deep drilling through overflow-only controls
- alert rail location stays stable across widths
- summary, failure framing, and action meaning stay above deep detail in narrow layouts
- advanced diagnostics collapse earlier than primary explanation
- collection states may switch presentation shape, but empty, no-results, degraded-read, and read-failure meaning must remain unchanged
- review-before-save moments in admin must keep changed-value review and blocked-save meaning above optional diagnostics even under compression

## Implementation planning implications

Implementation should treat state coverage as a shared system contract.

This means:
- component APIs should explicitly model state classes rather than relying on ad hoc booleans
- blocked, disabled, read-only, and unavailable should not be conflated in shared primitives
- degraded-read requires dedicated support and should not be emulated with generic warning styling
- family-level state rules should be enforced before screen assembly work proceeds
- high-risk shared families should be proved first:
  - header and action hierarchy
  - blocked explanation
  - failure explanation
  - timeline
  - state block
  - review-before-save editing
- role-aware behavior should be layered on top of these state definitions rather than redefining them per screen

## Summary

DXCP state coverage is part of the product system, not a late implementation detail.

The required model distinguishes default, loading, empty, no-results, degraded-read, failure, blocked, disabled, read-only, unavailable, and review-heavy conditions across the highest-value shared component families. It preserves the settled DXCP posture: object-first, intent-first, guardrail-aware, role-conscious, diagnostics-restrained, and stable under responsive compression.