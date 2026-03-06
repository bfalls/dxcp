# DXCP UX Principles

## Purpose
Set the UX bar for an enterprise control plane with a modern, Linear-quality feel:
fast, calm, minimal, and deeply explainable.

## Principles (non-negotiable)

### 1) Explainability is a product feature
If DXCP blocks an action, it must provide:
- the exact reason
- what the user can do about it
- what a platform admin can do about it (only visible to admins)

No vague errors. No "try again later" without structured context.

### 2) Intent-first workflows
Users choose:
- application
- version
- deployment strategy
- environment
- change summary
DXCP handles the rest. The UI does not surface engine primitives as a requirement.

### 3) Progressive disclosure without hidden surprises
Default UI is minimal.
Depth is available via:
- "Details" drawers
- expandable timeline items
- contextual panels
Never via scattered tabs that hide critical state.

### 4) Deterministic navigation and state
- URL state is meaningful and stable.
- Back/forward always works.
- Refresh never changes meaning.
- The UI should feel "stateful" and reliable, not like a collection of pages.

### 5) Object-centric pages, not tool-centric screens
Users should feel like they are navigating a system model:
Application, Deployment, Deployment Strategy, Deployment Group, Environment.

Menus exist to reach objects, not to replace them.

### 6) Calm, high-signal visual hierarchy
- One primary action per page header.
- Secondary actions are available but not competing.
- Dense information is grouped and scannable.
- Use whitespace intentionally; reduce borders and boxes.

### 7) Policy is visible at the moment of choice
Guardrails and eligibility must be visible:
- before an action is taken
- in the same context as the action
Avoid burying policy in separate admin pages or post-failure logs.

### 8) Timelines over logs
The default explanation format for "what happened" is:
- ordered timeline
- normalized event names
- consistent outcome semantics
Logs are a drill-down, not the primary story.

### 9) Role-aware UX without role confusion
- If a user cannot perform an action, do not tease it as primary.
- Disabled controls must explain why.
- Admin-only diagnostics must be clearly labeled and never required for primary workflows.

## Linear-quality interaction patterns to emulate (in spirit)
- Fast global search / jump
- Command palette navigation
- Crisp page headers with a single primary CTA
- Keyboard-first efficiency for power users
- Minimal chrome, high information density with clarity

## Default layout stance (high-level)
- Stable layout across viewport sizes.
- Bounded content width.
- Predictable page header zones.
- A single global area for non-field-specific alerts.

(Track the concrete layout contract in a dedicated note later.)

## References
- Link: [[DXCP Vision]]
- Link: [[DXCP Object Model]]
