# Sticky Shell and Alert Presentation Decision

## Decision summary

DXCP should use a sticky top-level product shell so users never lose global navigation, authenticated account actions, or active route-level risk framing while scrolling.

The sticky shell includes:
- product identity
- top-level navigation
- authenticated user menu with logout
- compact rollout or environment status when needed

[[Shared UI Patterns#3. Alert Rail Pattern|Alert Rail]] behavior is split into two layers:
- a compact sticky global alert strip for active page-level or route-level conditions
- local in-page explanation blocks for action-level, section-level, or record-level conditions

This keeps DXCP usable as an enterprise delivery control plane without turning the top of the product into a stack of persistent cards.

## Final rule

[[DXCP Layout Behavior#Top Navigation|Top Navigation]] is sticky on all major DXCP screens.

The sticky shell must preserve access to:
- product identity
- top-level section navigation
- authenticated user actions including logout
- compact rollout or environment posture when needed

[[Shared UI Patterns#3. Alert Rail Pattern|Alert Rail]] behavior follows scope:
- global route-level or page-level conditions use a compact sticky alert strip directly under the sticky shell
- local conditions stay in the page near the affected action, section, field group, or record

The global alert strip must stay compact by default. It may expand or link to more detail, but it must not become a large permanent card unless a later decision explicitly requires that treatment.

## Why this decision

DXCP is a governed delivery surface, not a long-form document. Users should not need to scroll back to the top to change sections, logout, or recover orientation.

A sticky shell strengthens:
- constant navigation and escape hatch access
- stable cross-route continuity
- awareness of active route-level risk or blocked posture
- enterprise control-plane predictability

At the same time, pinning every explanation card would waste vertical space and make the product louder than necessary. The compact global alert plus local explanation split preserves calmness and seriousness together.

## Global alert layer

Use the sticky global alert strip when a condition changes how the user should interpret the whole page or route.

Typical cases:
- route-level blocked posture
- route unavailable
- global permission limitation
- page-level degraded read
- page-level warning or failure that affects the main reading of the screen

Presentation rules:
- directly below the sticky [[DXCP Layout Behavior#Top Navigation|Top Navigation]]
- compact one-line or two-line summary by default
- may stack if multiple global alerts are active
- may expand or link to more detail
- must remain subordinate to the shell and page header

## Local explanation layer

Use local explanation blocks inside the page when a condition affects a specific action, section, field group, or record.

Typical cases:
- deploy blocked by one readiness condition
- save blocked by one validation or policy issue
- artifact not found for a specific path
- row-level or section-level degraded evidence
- diagnostics unavailable for one subsection

Presentation rules:
- render near the affected action or content region
- scroll with the page
- explain consequence and next step
- do not move into the global alert strip unless the condition changes the whole page or route meaning

## Scope rule

Global changes meaning.

Local explains impact.

Use the global sticky strip only when the condition affects whole-page comprehension, route enterability, or shared action posture.

Use local explanation when the condition is narrow enough that the user only needs it while working in one specific region.

## Shell guidance

The sticky shell should remain compact.

Rules:
- keep height stable across screens
- do not place bulky supporting cards in the sticky area
- do not duplicate page-header content in the shell
- keep role display optional and quiet rather than structurally required
- keep rollout posture visible without competing with active warning, blocked, or failure conditions

## Impact on current implementation

Implementation should be corrected toward this model:
- keep the top-level product shell sticky
- keep logout and top-level navigation always reachable
- move persistent rollout preview posture out of the alert rail when it is not an active route-level condition
- use the sticky alert strip only for global page or route conditions
- keep action-level blocked explanations and section-level warnings in the page near the affected area

This decision does not require every page header to be sticky.

It does require the top-level shell to remain visible during scroll.

## Implementation guidance for UI

- Treat sticky shell behavior as part of the [[Component Families#1. Product shell and structural frame family|product shell and structural frame family]].
- Keep the sticky shell visually calm and compact.
- Preserve the vertical order: sticky shell, compact global alert strip when active, page header, page body.
- Do not use the global alert strip for ordinary informational chrome.
- Do not replace local blocked or validation explanation with only a global alert when the user still needs local context.
- When a route is blocked or unavailable, the global alert strip may summarize the condition while the primary content area provides the focused next-step explanation.
- Preserve semantic distinctions between blocked, disabled, unavailable, read-only, degraded-read, warning, and failure.

## Linked notes

- [[Shared UI Patterns]]
- [[DXCP Layout Behavior]]
- [[Responsive Component Rules]]
- [[Visual State Definitions]]
- [[Component Families]]
- [[Application Screen]]
- [[Deployment Screen]]
- [[Deployments Screen]]
- [[Insights Screen]]
- [[Admin Screen]]
- [[DXCP Core Vocabulary]]
- [[DXCP UX Grammar]]
