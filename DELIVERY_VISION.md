# Delivery Experience Control Plane (DXCP) Vision

## Problem Statement

Modern deployment engines are powerful, but the engineer experience around deploying and troubleshooting services often becomes:

- Too coupled to the engine internal model (pipelines, stages, execution graphs)
- Too easy to misconfigure (missing guardrails, inconsistent rollout patterns)
- Too noisy to debug (raw stage output, fragmented logs, unclear failure causes)
- Too dependent on tribal knowledge (how to deploy, what to click, what to roll back)

The result is higher cognitive load, slower delivery, inconsistent safety posture, and longer time to recovery.

DXCP provides a thin, opinionated developer experience layer on top of a deployment engine (Spinnaker) that:
- Encodes deployment intent
- Applies safe defaults and guardrails
- Normalizes status and failures into actionable signal
- Makes rollback fast and obvious
- Treats delivery as a product with interfaces, metrics, and evolution

## Target Users

Primary users
- Service engineers shipping changes frequently
- Oncall engineers diagnosing failed or unhealthy deployments

Secondary users
- Platform engineers maintaining delivery templates and guardrails
- Engineering leaders who want consistent delivery outcomes and visibility

## Developer Experience Goals

1. Intent first deployments  
Engineers express what they want to deploy (service, version, environment) and how safely.  
DXCP translates intent into the correct Spinnaker execution.

2. Opinionated defaults  
A small number of supported deployment recipes.  
A safe baseline path that is the easiest path.

3. High signal deployment visibility  
One place to see:
- Current state
- What changed
- Stage level progress in a normalized timeline
- A stable link to the underlying Spinnaker execution

4. Actionable failure experience  
Failures are classified into a small set of categories.  
Each failure includes:
- A one line cause
- Suggested next actions
- Links to evidence (execution and logs)

5. Fast rollback  
Rollback is a first class action with clear safety checks.  
Rollback should be triggerable in under 60 seconds.

6. Delivery as a product  
Stable APIs and UI  
Clear non goals and constraints  
Measurable success metrics  
Explicit guardrails for safe public use

## Non Goals

- Replacing Spinnaker or re implementing deployment orchestration
- Building a full CI system
- Supporting every Spinnaker stage or configuration
- Infrastructure provisioning or production hardening
- Multi tenant governance at scale

## Ownership Boundaries

DXCP owns:
- Public interfaces (API and UI)
- Deployment intent and record schemas
- Opinionated recipes and guardrails
- Developer experience and observability

Spinnaker owns:
- Pipeline execution and orchestration
- Retries and stage execution
- Deep debug views and raw execution graphs

DXCP improves how engineers interact with the engine.

## Success Metrics

Developer experience
- Time to trigger a deployment less than 30 seconds
- Time to identify why it failed less than 3 minutes
- Rollback initiation under 2 minutes

Safety and consistency
- Deployments use supported recipes by default
- Risky actions blocked by policy are tracked

Debuggability
- Every deployment produces a durable record with:
  - Intent inputs
  - Execution reference
  - Normalized status and failures
  - Evidence links

## Principles

- Opinionated over configurable
- Progressive disclosure
- Safe behavior is the default
- Hide complexity intentionally
- Prefer clarity over completeness

## Public Demo Constraints

The public demo is intentionally constrained:
- Allowlisted service only
- Single environment (sandbox)
- One active deployment at a time
- Strict rate limits and daily quotas
- No resource creation per deploy
- Kill switch to disable mutations

These constraints are part of the product story.
