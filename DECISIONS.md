# Delivery Experience Control Plane - Key Decisions

This document records the major product and technical decisions behind DXCP.
All decisions prioritize developer experience, clarity, and safety over infrastructure depth.

---

## Reviewer Experience Contract

A reviewer must be able to complete this flow in under 5 minutes:

1. Open a public demo UI and trigger a deployment for a single allowlisted service
2. Observe deployment status in a normalized, high-signal view
3. View failures with clear cause and suggested next action
4. Clone one repository, make a small code change, and publish a new build with one command
5. Deploy that build via the UI and verify the public URL reflects the change

If this flow requires platform credentials, multiple repositories, or complex setup,
the demo has failed its primary goal.

---

## Decision 1: Intent-first, contract-first API

We do:
- Model deployment intent explicitly (service, version, environment, recipe)
- Keep the public API small, stable, and opinionated

We do not:
- Expose raw deployment engine concepts as the primary user interface

Tradeoff:
- Reduced flexibility for edge cases
- Significantly lower cognitive load and safer defaults

---

## Decision 2: First-class deployment records

We do:
- Persist a normalized DeploymentRecord that captures intent, status, and references
- Treat the deployment engine as the execution backend, not the UX source of truth

We do not:
- Force users to read raw execution graphs to understand outcomes

Tradeoff:
- Potential drift between record and engine state
- Mitigated by linking execution IDs and refreshing status on read

---

## Decision 3: Opinionated delivery recipes

We do:
- Support a very small set of approved deployment recipes
- Evolve recipes centrally over time

We do not:
- Allow arbitrary pipeline composition through the DX layer

Tradeoff:
- Less customization
- Much higher consistency, safety, and supportability

---

## Decision 4: Minimal but professional UI

We do:
- Provide a clean web UI for deploy, status, failures, and rollback
- Treat the UI as the primary reviewer experience

We do not:
- Require curl or raw API usage to understand the system

Tradeoff:
- Slightly more implementation work
- Stronger product signal and usability

---

## Decision 5: Public demo abuse guardrails

Public demos get abused. Guardrails are part of the product.

We do:
- Allowlisted service only
- Single environment only (sandbox)
- One active deployment at a time
- Strict rate limits and daily quotas
- No infrastructure creation per deploy
- Idempotency keys for deploy and rollback
- Kill switch to disable mutations

We do not:
- Accept unbounded user input that can create cost or state explosion

Tradeoff:
- Reduced generality
- Strong safety and predictable operating cost

---

## Decision 6: AWS usage is optional and low cost

We do:
- Use CDK for all AWS resources
- Prefer serverless and event-driven services
- Provide one-command deploy and destroy

We do not:
- Use EKS
- Run large always-on fleets

Tradeoff:
- Some runtime targets are less Kubernetes-like
- Demo remains inexpensive and reliable

---

## Decision 7: Deployment engine is always Spinnaker

We do:
- Trigger deployments by creating Spinnaker pipeline executions
- Read status and failures from Spinnaker and normalize them

We do not:
- Bypass the engine for demo convenience

Tradeoff:
- Spinnaker must be running
- The demo is honest and domain-correct

---

## Decision 8: No repo permissions or cloud credentials required

Reviewers do not have write access to this repo and do not need cloud credentials.

We do:
- Provide a publish script that uploads artifacts using a demo-scoped token
- Enforce strict validation and quotas on uploads

We do not:
- Require pushing to the maintainer repo
- Require local cloud configuration

Tradeoff:
- Slightly more surface area in the control plane
- Dramatically lower friction for reviewers

---

## Reinforced non-goals

- Not a replacement for the deployment engine
- Not a full CI system
- Not an infrastructure provisioning tool
- Not a production hardened platform
