# DXCP Object Model

## Purpose
Define the core product objects and the user-facing relationships between them.
This is a UX model first: it should match how users think, not how the engine works.

## Primary objects (user-facing)

### Application
A deployable unit users recognize (their "thing").
User questions:
- What is currently running?
- What changed recently?
- What can I deploy next?

### Deployment
A single instance of intent that produced an outcome.
User questions:
- What happened, in what order?
- Why did it succeed/fail/rollback?
- What is the current state?

### Version
A versioned build identifier that may be eligible to deploy.
User questions:
- Which versions exist?
- Is this version eligible under policy?
- What version am I deploying?

### Deployment Strategy
A named deployment strategy with user-facing semantics.
User questions:
- What will happen if I choose this?
- Is it allowed for this application or deployment group?

### Deployment Group
The governance boundary that scopes what applications can do.
User questions:
- What rules apply to this application?
- What deployment strategies are allowed?
- What are the guardrails (quota, concurrency)?

### Environment
A named target where deployments run.
User questions:
- What is allowed here?
- What is currently running here?
(Do not imply promotions or workflow automation unless explicitly built.)

## Relationships (user-facing)
- An **Application** belongs to one **Deployment Group**.
- A **Deployment Group** allows specific **Deployment Strategies** and enforces guardrails.
- A **Deployment** targets an **Application** + **Environment** and uses a **Deployment Strategy**.
- A **Deployment** references a **Version**.
- A blocked or allowed action must always be explained in clear DXCP language.
- A **Deployment Strategy** has stable user semantics; behavior changes are visible over time.

## Canonical "object pages"
Each primary object gets a first-class page with:
- Overview (what it is)
- Current state (if applicable)
- Timeline / history (where meaning accumulates)
- Policy context (what constrains it)
- Actions (what can be done next)

## Invariants for the UI
- Users should never need to interpret engine identifiers to answer their questions.
- Any blocked state must have a clear reason and next-step explanation.
- History is presented as a narrative timeline with normalized outcomes.
- Admin-only engine details may exist, but must never be required for comprehension.

## Navigation implications
Global navigation should default to objects + workflows, not tool categories.
Examples:
- Applications -> Application page -> Deploy / History / Failures
- Deployments -> Deployment page -> Timeline / Outcome / Rollback
- Admin -> Deployment Groups / Strategies / System Settings

## References
- Link: [[UX-Principles]]
- Link: [[Deploy Workflow]]
