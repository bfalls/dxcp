# Delivery Experience Control Plane - Key Decisions

This document records non-negotiable product and technical decisions for DXCP.
These decisions prioritize developer experience, safety, and platform leverage.

---

## Decision 1: Intent-first API

DXCP models deployment intent explicitly and hides engine mechanics.

We do:
- Require explicit intent objects
- Keep the API small and opinionated

We do not:
- Expose engine pipelines or stages directly

Tradeoff:
- Reduced flexibility
- Dramatically lower cognitive load

---

## Decision 2: DXCP owns delivery records

DXCP is the source of truth for delivery status and failures.

We do:
- Persist normalized DeploymentRecords
- Link to engine executions for deep debug

We do not:
- Force users to interpret raw engine output

Tradeoff:
- Possible state drift
- Mitigated through execution references and refresh

---

## Decision 3: Opinionated deployment recipes

Only a small, approved set of deployment paths exists.

We do:
- Evolve recipes centrally
- Enforce recipes via policy

We do not:
- Allow ad hoc pipeline composition

Tradeoff:
- Less customization
- Higher consistency and safety

---

## Decision 4: Guardrails are product features

Safety constraints are part of the product surface.

We do:
- Validate intent before execution
- Enforce blast radius limits
- Provide fast rollback

We do not:
- Rely on user discipline alone

Tradeoff:
- Fewer degrees of freedom
- Safer delivery at scale

---

## Decision 4a: Guardrails are first-class product features

DXCP is an intent-based control plane that triggers real deployments, not a dry-run API.
Guardrails (rate limits, serialization, quotas) are part of the API contract and the product experience.
They exist to control blast radius, protect shared execution engines, and ensure predictable behavior.
Demo defaults are intentionally conservative, but limits are configurable per environment.
The concept of guardrails is permanent even as values evolve.

---

## Decision 5: Deployment engine remains external

DXCP never replaces the execution engine.

We do:
- Integrate via a strict adapter boundary

We do not:
- Reimplement orchestration logic

Tradeoff:
- Dependency on engine availability
- Clear separation of concerns

---

## Decision 6: Infrastructure depth is minimized

DXCP optimizes for experience, not infra sophistication.

We do:
- Prefer simple, debuggable implementations

We do not:
- Optimize for maximum scale prematurely

Tradeoff:
- MVP scale limits
- Faster iteration and clarity

---

## Reinforced non-goals

- CI system ownership
- Infrastructure provisioning
- Cluster management
- Arbitrary pipeline authoring
