# Role-Aware Behavior Rules

## Purpose

This note defines the formal role-aware behavior rules for DXCP shared component families and key screen compositions so implementation preserves action clarity, read-only posture, blocked explanation, and diagnostics boundaries across delivery-facing and platform-governance experiences.

It extends [[Component Families]], [[Component State Coverage]], and [[Component and System Planning]] without reopening settled decisions already defined in [[Screen Spec - Application]], [[Screen Spec - Deployment Detail]], [[Screen Spec - Deploy Workflow]], [[Screen Spec - Deployments]], [[Screen Spec - Insights]], [[Screen Spec - Admin]], [[Shared UI Patterns]], [[Navigation and Cross-Screen Behavior]], [[Responsive and Density Rules]], and [[Visual Language Direction]].

[[DXCP UX Grammar]] in one sentence: DXCP uses short verb-plus-core-noun language so actions, statuses, and explanations stay clear without exposing engine mechanics.

---

## Role-behavior stance

DXCP is role-aware, but it should not feel role-fragmented.

The product should preserve one calm, coherent operational language across roles while changing only what materially affects:
- what the user can safely do
- what the user can understand
- what the user can investigate
- what the user should not see as an available next step

Role differences should not create different products.

They should create different action depth, explanation depth, and governance depth inside the same product system.

The default posture is:
- preserve shared object comprehension whenever safe
- preserve visible action clarity when the user is close to an allowed task
- explain blocked actions in DXCP language
- use read-only posture when the user is intentionally allowed to understand but not mutate
- withhold actions or routes when visibility would create false affordance or governance noise
- keep advanced diagnostics secondary even for administrators

---

## Role model summary for DXCP UX

### Delivery owner

The delivery owner is the primary delivery actor.

The delivery owner should be able to:
- browse delivery-facing screens
- deploy where policy and scope allow
- rollback where policy and history allow
- understand why a deployment or rollback is blocked
- investigate deployment outcomes through normalized DXCP explanations

The delivery owner should not receive admin-governance controls or engine-centric diagnostic surfaces as default product behavior.

### Observer

The observer is a visibility-first user.

The observer should be able to:
- understand what is running
- inspect recent and historical delivery outcomes
- read failure and guardrail explanations where those explanations help comprehension
- follow delivery history without being invited into mutation flows

The observer should not be presented as a frustrated deployer.
Read-only visibility should feel intentional, not like a broken workflow.

### Platform admin

The platform admin is a system-governance user who also retains delivery visibility.

The platform admin should be able to:
- do everything needed for platform governance
- inspect delivery-facing screens with the same object model as other roles
- access deeper diagnostics through progressive disclosure where DXCP already authorizes them
- review high-risk changes before saving
- understand admin consequences in DXCP language first

Admin depth must remain secondary to object comprehension and safe action structure.
Admin access should not turn ordinary delivery screens into diagnostic consoles.

---

## Shared behavior rules by component family

## 1. Product shell and structural frame family

Role changes must not alter the structural frame.

The following remain stable across roles:
- top navigation shell
- bounded content container
- alert rail placement
- page header zone
- primary and secondary layout hierarchy
- section rhythm

Role awareness may change:
- which destinations appear in navigation
- whether a route resolves to a screen or a blocked-access state
- whether header actions are present, blocked, or absent

Role awareness must not change:
- the page’s spatial story
- primary versus secondary region meaning
- the location of major explanations

## 2. Page header and action hierarchy family

Page headers should expose the clearest truthful next step for the current role.

Rules:
- keep the primary action slot stable even when the action is blocked
- use visible-but-blocked treatment when the user is reasonably expected to attempt that action in this context
- use no-action treatment when the action does not belong to the role’s job on that screen
- do not fill the header with substitute actions merely because the primary action is unavailable
- keep admin-only technical actions secondary to the main object action hierarchy

Examples:
- [[Screen Spec - Application]] keeps `Deploy` visible for delivery actors and may keep it visible with explanation when blocked
- [[Screen Spec - Deployment Detail]] keeps `Rollback` as the meaningful object action when that action is relevant to the role and record state
- [[Screen Spec - Admin]] keeps create, edit, save, and confirm actions only for platform administrators

## 3. Alert, guardrail, and blocked-state explanation family

This family carries the most important role-aware behavior.

Rules:
- blocked-action explanation is used when an action is in-context, meaningful, and currently prevented
- read-only explanation is used when the screen is intentionally viewable without mutation authority
- blocked-access explanation is used when the user should not enter the route or workspace at all
- operator-facing explanation comes first
- admin-only deeper rationale may appear second through progressive disclosure
- raw backend terms do not become the primary explanation

Role-sensitive behavior:
- delivery owner sees policy, scope, quota, concurrency, and compatibility explanations in DXCP language
- observer sees read-only posture where visibility is intentional, not action-block language for tasks they are not meant to perform
- platform admin may see deeper hints, request identifiers, or diagnostic detail only after the primary explanation is already clear

## 4. Status and semantic indicator family

Status meaning should remain role-stable.

Rules:
- deployment outcome, failure category, warning state, blocked condition, read-only state, and deprecation status use the same semantic system across roles
- role may affect adjacent actions or supporting explanation depth
- role must not change what a status means

Admin-only depth may add:
- linked diagnostic path
- implementation-specific evidence label
- deeper cause trace

But the base status rendering stays shared.

## 5. Summary block family

Summary blocks should preserve shared comprehension first.

Rules:
- core object summary content should remain visible across roles where the object itself is visible
- supporting action hints inside summaries must respect role and scope
- summary blocks should not turn into stealth editing surfaces for admins
- read-only viewers still receive the same object answer, minus mutation affordances

Role changes typically affect:
- presence of inline action links
- supporting explanation for blocked or read-only conditions
- access to advanced evidence paths

## 6. Timeline family

The timeline is primarily about understanding what happened, so visibility should be preserved broadly.

Rules:
- timeline narrative remains normalized and operator-readable for all allowed viewers
- deployment investigation should not require admin privileges for the primary story
- admin-only diagnostics may attach as secondary disclosure on relevant events
- observers should not lose the core timeline because they cannot mutate
- timeline actions that cause change, such as rollback, remain role-gated in the surrounding page action model, not embedded into each event by default

## 7. Failure explanation family

Failure explanation is shared first, deeper second.

Rules:
- the normalized failure headline, explanation, and next-step guidance should remain available wherever the failure itself is visible
- role changes the depth of supporting evidence, not the existence of the main explanation
- delivery owners and observers should not be forced into hidden technical detail to understand a failure
- platform admins may access deeper evidence through secondary disclosure
- engine or adapter detail is never the lead sentence

## 8. Collection family

Collections should preserve browse clarity without over-signaling unavailable work.

Rules:
- rows for visible objects remain visible across roles where read access is allowed
- row-level mutating controls appear only when the role can act from that collection
- where mutation is not a valid browse task, actions should simply be absent rather than sprayed as disabled controls
- use blocked or disabled row actions only when the collection is genuinely a launch point for that action and the user is close to being able to use it

This prevents observers from seeing collections full of meaningless disabled controls.

## 9. Filter and time-control family

Filters and time controls are primarily comprehension tools.

Rules:
- preserve them across roles where they improve reading and investigation
- withhold only those controls that reveal admin-only diagnostics partitions or governance-only views
- do not collapse ordinary read behavior merely because the user is non-mutating

## 10. Form, edit, and review family

This family has the strongest role separation.

Rules:
- delivery forms appear only where the role can meaningfully submit or where explicit read-only preview is part of the product posture
- admin edit forms are available only to platform admins
- review-before-save remains admin-only for governance mutation work
- non-admins do not receive partial editable shells for admin surfaces
- disabled fields inside a legitimate review flow are different from a user lacking access to the edit flow altogether

## 11. Confirmation and consequence family

Confirmation appears only for users who can actually complete the action.

Rules:
- do not show destructive confirmation patterns to read-only users
- do not simulate confirmation for blocked users
- preserve consequence summaries for admins before save and for delivery actors before rollback when allowed
- use concise, concrete consequence language grounded in DXCP nouns

---

## Screen-level role behavior implications

## [[Screen Spec - Application]]

The screen is broadly visible because application understanding is a shared delivery need.

Role implications:
- delivery owner: sees normal operational view and the primary `Deploy` action when in scope
- observer: sees the same object summary and recent activity without deploy affordances
- platform admin: sees the same application story as the default, with any deeper diagnostics remaining secondary

Rules:
- preserve visible running context, recent deployment activity, deployment group context, and strategy availability where the application is visible
- keep `Deploy` visible with blocked explanation for delivery actors when deployment is in-context but currently prevented
- do not turn the application view into an admin inspection surface

## [[Screen Spec - Deploy Workflow]]

The workflow is an action surface, so role handling must be explicit.

Role implications:
- delivery owner: may complete the workflow when scope and policy allow
- observer: may receive read-only workflow only if the product intentionally exposes deploy visibility; otherwise the workflow should not be presented as an actionable path
- platform admin: may use the workflow and may access deeper diagnostics secondarily

Rules:
- preserve the workflow shape even when submit is blocked
- use blocked-action explanation for delivery actors who are allowed to understand the task but prevented now
- use read-only posture only when intentional visibility has product value
- keep admin diagnostics behind progressive disclosure
- after successful submit, hand all roles into the same [[Screen Spec - Deployment Detail]] object narrative when they are allowed to read it

## [[Screen Spec - Deployment Detail]]

This screen is the primary investigation surface and should remain broadly readable.

Role implications:
- delivery owner: sees normalized deployment story and rollback when allowed
- observer: sees the deployment story without rollback
- platform admin: sees the same primary story, plus deeper diagnostics paths

Rules:
- preserve the normalized timeline, outcome, failure explanation, and object identity broadly
- keep `Rollback` role- and record-gated in the header action model
- use blocked-action explanation if rollback is materially in-context for the role but prevented now
- reserve execution-depth links and deep diagnostics for admin disclosure paths

## [[Screen Spec - Deployments]]

This is a browse-and-open surface.

Role implications:
- preserve collection visibility wherever read access is allowed
- keep row actions narrow and meaningful
- avoid disabled-control clutter for observers
- let role differences mostly affect launch actions and detail depth, not the browse structure itself

## [[Screen Spec - Insights]]

Insights is primarily a read surface.

Role implications:
- preserve summary, trend, and breakdown comprehension broadly
- withhold only those drill-ins that cross into admin-governance or diagnostics depth
- keep the page restrained for every role
- do not create “admin mode” insights density

## [[Screen Spec - Admin]]

Admin is a platform-governance workspace, not a universal destination.

Role implications:
- platform admin: receives the full admin navigation, browse, detail, review, and save model
- non-admin user: does not receive a partial admin shell

Rules:
- non-admin direct route access resolves to a full blocked-access state in the primary content area
- do not expose read-only admin browse as the normal posture for non-admin roles
- for platform admins, default object posture is inspect first, then edit, then review, then save
- advanced diagnostics remain secondary even on admin screens

---

## Blocked vs read-only vs withheld action rules

## Visible and allowed

Use when:
- the action belongs to the screen’s primary job
- the user can execute it now
- no blocking condition currently prevents it

Examples:
- `Deploy` for an in-scope delivery owner on [[Screen Spec - Deploy Workflow]]
- `Rollback` for an allowed deployment on [[Screen Spec - Deployment Detail]]
- `Save` for an admin after valid changes in [[Screen Spec - Admin]]

## Visible but blocked

Use when:
- the action is part of the user’s legitimate workflow
- understanding why it is unavailable helps immediate decision-making
- the user is close enough to action that withholding would reduce clarity

Required explanation:
- what is blocked
- why it is blocked
- what to do next when possible

Typical uses:
- deploy blocked by policy, scope, compatibility, quota, or concurrency
- rollback blocked because prerequisite conditions are not met
- save blocked in an admin review flow due to validation or governance conflict

## Read-only posture

Use when:
- the user is intentionally allowed to view the object or screen
- mutation is not the point of the role on that surface
- comprehension still has clear value

Rules:
- do not phrase read-only posture as a failure
- do not overuse disabled controls to communicate read-only mode
- let the screen feel complete and intentional without edit pressure

Typical uses:
- observer visibility on delivery detail and insights
- delivery-facing object understanding without mutation affordance
- admin inspect-first mode before edit is chosen

## Withheld action

Use when:
- the action does not belong to the role’s job on this surface
- showing it would create noise or false expectation
- no immediate explanatory value is gained from revealing it

Typical uses:
- mutating row controls in passive browse collections for observers
- admin-only governance actions on delivery-facing screens
- destructive confirmations for users who cannot act

## Blocked-access state

Use when:
- the route or workspace itself is not intended for the role
- partial rendering would create confusion or governance leakage

Typical uses:
- non-admin user deep-linking into [[Screen Spec - Admin]]

---

## Diagnostics disclosure boundaries by role

## Shared to all allowed readers

These should remain primary and broadly visible:
- object identity
- normalized deployment status
- normalized timeline story
- normalized failure explanation
- guardrail or policy explanation in DXCP language
- next-step guidance when relevant

## Delivery owner depth

May receive:
- human-readable blocked reasons
- policy scope explanation
- practical next-step guidance
- links into related DXCP objects

Should not receive by default:
- engine execution identifiers as the primary story
- backend request detail as standard screen content
- admin-governance editing context

## Observer depth

May receive:
- the same normalized reading model as delivery owners for visible objects
- read-only posture where needed
- trend and history comprehension

Should not receive:
- mutation affordances
- destructive confirmations
- admin diagnostics disclosure

## Platform admin depth

May additionally receive:
- deeper operator hints
- request identifiers where already part of the product surface
- engine-adjacent execution references
- advanced mapping or configuration diagnostics on admin surfaces

Rules:
- deeper diagnostics must be progressive disclosure
- diagnostics must never replace the normalized product explanation
- admin depth must remain subordinate to the primary object story
- diagnostic terminology must not leak outward into general user-facing language

---

## Route and deep-link behavior rules

Route behavior should reflect workspace intent, not only API capability.

Rules:
- delivery-facing routes should resolve wherever read access is intentionally allowed
- read-allowed deep links should preserve the same object narrative regardless of role, with role-sensitive action changes
- admin routes are role-exclusive destinations
- unauthorized admin route access resolves to a blocked-access state, not to a crippled admin shell
- route denial explanation should be calm, short, and object-aware
- deep links into admin-only diagnostic views should follow the same rule as admin routes
- component-level hiding must not be used as a substitute for route-level restriction when the whole workspace is out of role scope

This preserves two levels of control:
- route-level exclusion for role-inappropriate workspaces
- component-level role handling inside valid shared workspaces

---

## Responsive implications

Responsive behavior should not change the underlying role model.

Only these presentation changes are allowed when space tightens:
- blocked explanations may compress from full block to shorter summary plus expansion
- secondary diagnostic disclosure may collapse more aggressively on smaller widths
- read-only notes may become shorter, but should remain visible when they materially affect comprehension
- admin diagnostic depth is the first role-specific content to collapse behind disclosure on constrained layouts

Responsive behavior must not:
- hide the main blocked explanation near the relevant action
- remove the core read-only posture cue when the page would otherwise imply editability
- promote diagnostics above the primary object story
- change a route-level denial into a partially rendered shell

---

## Implementation planning implications

Implementation should treat role awareness as a system rule layered onto shared compositions, not as ad hoc per-screen improvisation.

This means:
- shared component families need explicit support for allowed, blocked, read-only, withheld, and admin-diagnostic variants
- screen assemblies should decide role-sensitive behavior through composition rules, not scattered local overrides
- route guards and component behavior guards should be modeled separately
- diagnostics disclosure should use one consistent progressive-disclosure pattern
- blocked-action messaging should use one message structure across deploy, rollback, and admin save moments
- observer experiences should be intentionally complete where visibility is preserved
- admin depth should be added as secondary layers rather than parallel screen systems

Areas that need strongest implementation discipline:
- header action visibility rules
- blocked versus read-only distinction
- admin route denial behavior
- deployment detail diagnostic depth
- admin inspect/edit/review/save sequencing

---

## Summary

DXCP role-aware behavior should preserve one calm product language across delivery owner, observer, and platform admin experiences.

The main system rules are:
- preserve shared object comprehension broadly where safe
- keep in-context actions visible when blocked explanation materially helps
- use read-only posture for intentional visibility without mutation
- withhold actions that do not belong to the role’s job on that surface
- reserve route-level denial for role-inappropriate workspaces such as Admin
- keep deeper diagnostics secondary and progressively disclosed, even for administrators

These rules protect DXCP’s intent-first, explainable, enterprise-grade behavior as implementation begins.