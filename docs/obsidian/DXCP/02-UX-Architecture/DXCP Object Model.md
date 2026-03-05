# DXCP Object Model

## Purpose
Define the core product objects and the user-facing relationships between them.
This is a UX model first: it should match how users think, not how the engine works.

## Primary objects (user-facing)

### Service
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

### Artifact
A versioned build that may be eligible to deploy.
User questions:
- Which versions exist?
- Is this version eligible under policy?
- What is this artifact and where did it come from?

### Recipe
A named deployment strategy with user-facing semantics.
User questions:
- What will happen if I choose this?
- Is it allowed for this service/group?

### Governance Decision
A normalized, explainable evaluation result that answers:
- Can I do this?
- If not, exactly why not?
- What would make it allowed?

### Delivery Group (policy boundary)
The governance boundary that scopes what services can do.
User questions:
- What rules apply to this service?
- What recipes are allowed?
- What are the guardrails (quota, concurrency)?

### Environment
A named target where deployments run.
User questions:
- What is allowed here?
- What is currently running here?
(Do not imply promotions or workflow automation unless explicitly built.)

## Relationships (user-facing)
- A **Service** belongs to one **Delivery Group**.
- A **Delivery Group** allows specific **Recipes** and enforces guardrails.
- A **Deployment** targets a **Service** + **Environment** and uses a **Recipe**.
- A **Deployment** references an **Artifact**.
- A **Governance Decision** evaluates an intent (deploy, rollback, publish) and produces allow/deny with reasons.
- A **Recipe** has stable user semantics; behavior changes are visible over time (revisioned/snapshotted).

## Canonical "object pages"
Each primary object gets a first-class page with:
- Overview (what it is)
- Current state (if applicable)
- Timeline / history (where meaning accumulates)
- Policy context (what constrains it)
- Actions (what can be done next)

## Invariants for the UI
- Users should never need to interpret engine identifiers to answer their questions.
- Any "blocked" state must be tied to a Governance Decision (or equivalent).
- History is presented as a narrative timeline with normalized outcomes.
- Admin-only engine details may exist, but must never be required for comprehension.

## Navigation implications
Global navigation should default to objects + workflows, not tool categories.
Examples:
- Services -> Service page -> Deploy / History / Failures
- Deployments -> Deployment page -> Timeline / Outcome / Rollback
- Admin -> Delivery Groups / Recipes / System Settings

## References
- Link: [[UX-Principles]]
- Link: [[04-Flows/Deployment-Flow]] (create later)
- Link: [[05-Design-Decisions]] (ADRs attach to objects)
