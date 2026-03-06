# DXCP Vision

## One sentence
DXCP is the intent-first delivery control plane that makes deploying software feel predictable, safe, and explainable, without requiring engineers to understand the underlying execution engine.

## Product promise
- **Safety by default**: users cannot accidentally do unsafe things.
- **Clarity at decision time**: users always know what they can do next and why.
- **Authoritative truth**: "what is running" and "what happened" are definitive in DXCP.
- **Engine independence (for users)**: the execution engine exists, but it is never a required mental model.

## Who DXCP is for
### Primary
Product engineers deploying and rolling back applications.
- Minimal onboarding.
- No tribal knowledge.
- Wants speed, but not at the expense of correctness.

### Secondary
Platform engineers shaping governance, deployment strategies, and guardrails.
- Operates at the system-design layer, not day-to-day deployments.

## What success looks like
- Engineers prefer DXCP over direct engine access.
- "Why can't I deploy?" becomes a fast, resolved question.
- Incidents are debugged from DXCP timelines without spelunking engine internals.
- Governance evolves without retraining users.

## How DXCP should *feel*
- Like a modern control plane, not an admin dashboard.
- Fast, calm, and precise.
- Confident in its answers. No ambiguous state.
- Minimal UI that reveals depth only when needed.

## Core UX north stars
1. **Intent-first**: the UI is organized around what the user is trying to do.
2. **Explainability**: every block has a reason, and the reason is actionable.
3. **Determinism**: the same inputs produce the same outcomes and the UI reflects that stability.
4. **Object-centric**: users navigate by core objects (Application, Deployment, Deployment Group, Deployment Strategy).
5. **Operational narrative**: history is presented as a timeline with meaning, not raw logs.

## Out of scope (product posture)
DXCP is not a pipeline editor, CI system, build system, or "DevOps toolbox."
If a feature would teach engine concepts to be useful, it is not a DXCP feature.

## Key constraints (v1 posture)
- Single execution engine (explicit, not user-selectable).
- Explicit environment semantics (no implied promotion workflows).
- Versions are validated and eligible under policy before execution.
- Governance is enforced server-side; UI reflects, never defines.

## References
- Link: [[DXCP Object Model]]
- Link: [[UX-Principles]]
