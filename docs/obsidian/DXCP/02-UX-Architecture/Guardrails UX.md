# Guardrails UX

Guardrails are a core DXCP product capability.

They explain whether a deployment action is allowed and why before execution
starts. DXCP treats guardrails as part of the product surface, not as backend
warnings.

Guardrails answer the operational question:

**Can I deploy right now? If not, why?**

This note extends the interaction model defined in [[Deploy Workflow]] and
applies to the supporting policy context shown in [[Deployment Detail Screen]]
and the event narrative defined by [[Deployment Timeline]].

---

# Purpose

This document defines how policy and safety constraints should be surfaced
across DXCP.

Guardrails must be:

- visible at decision time
- understandable without engine knowledge
- attached to the workflow where they matter
- consistent with the UX language defined in [[DXCP UX Grammar]]

They are supporting context within the information architecture defined in
[[DXCP Information Architecture]], not primary navigation.

---

# Core Concepts

Guardrails apply to an [[DXCP Core Vocabulary#Application|Application]] in a
specific [[DXCP Core Vocabulary#Environment|Environment]] and are governed by
a [[DXCP Core Vocabulary#Deployment Group|Deployment Group]].

A deployment may also be constrained by the selected
[[DXCP Core Vocabulary#Deployment Strategy|Deployment Strategy]].

When DXCP evaluates whether an action is allowed, the user-facing result
should be a clear allow-or-block explanation with reasons and a next step.

These repeated patterns should remain consistent with [[Interaction Patterns]].

---

# What Guardrails Need To Explain

Guardrails should answer these questions:

- What rules apply to this application?
- Which deployment strategies are allowed?
- Is deployment currently blocked?
- Is quota still available today?
- Is another deployment already active?
- What should I do next?

Guardrails are not a settings surface for most users. They are decision support.

---

# Where Guardrails Appear

## 1. Deploy workflow

The primary place guardrails appear is in [[Deploy Workflow]].

A persistent policy context panel should show:

- deployment group
- allowed deployment strategies
- deployment quota remaining today
- rollback quota remaining today
- concurrent deployment limit
- current concurrency status, when available

This information should be visible before the user clicks **Deploy**.

If deployment is blocked, the blocking reason should appear in the alert rail,
with the policy context panel still visible beside the form.

Field-specific validation stays inline, but page-level blocking states belong in
the alert rail.

Example:

> Deployment blocked  
> Reason: This deployment group has reached its daily deployment quota.  
> Next step: Retry after the daily quota resets.

---

## 2. Deployment detail

[[Deployment Detail Screen]] is the main place to understand a blocked or
completed [[DXCP Core Vocabulary#Deployment|Deployment]].

The secondary column should include a **Policy Context** section that explains:

- deployment group
- selected deployment strategy
- relevant guardrails
- whether the deployment was blocked by policy, quota, or concurrency

The detail view should answer:

- What happened?
- Why did it happen?
- What should I do next?

---

## 3. Deployment timeline

Deployment Timeline is the operational
narrative for guardrail enforcement.

Guardrail-related events should appear as normalized milestones such as:

- policy check passed
- policy check failed
- quota check passed
- quota exceeded
- concurrency check passed
- concurrency limit reached

If a guardrail blocks a deployment, later execution events must not appear.

This keeps the timeline aligned with the policy-first ordering in the product model.

---

# Blocked Action Pattern

Whenever DXCP blocks an action, the UI must explain four things in order.

## What is blocked

State the action clearly.

Examples:

- Deploy Application
- Rollback Deployment

## Why it is blocked

State the immediate reason.

Examples:

- This deployment strategy is not allowed for the deployment group.
- The daily deployment quota has been reached.
- Another deployment is already active.

## What rule caused it

State the governing rule in product language.

Examples:

- Deployment group policy
- Daily deployment quota
- Concurrent deployment limit

## What to do next

Provide exactly one next step.

Examples:

- Choose an allowed deployment strategy.
- Retry after the quota resets.
- Wait for the active deployment to complete.

---

# Deployment Group Policy Visibility

Each deploy-capable view should make the governing deployment group visible.

Users should not need to infer policy from a disabled button alone.

Minimum visible policy context:

- deployment group name
- allowed deployment strategies
- quota status
- concurrency status

This is supporting context, not a standalone dashboard.

---

# Quota Visibility

Quota should be expressed as remaining actions.

Preferred examples:

- Deployments remaining today: 3
- Rollbacks remaining today: 1

Avoid percentage-heavy displays or large telemetry panels.

When quota is exhausted:

- the primary action becomes unavailable
- the alert rail explains why
- the next step is explicit

---

# Concurrency Explanation

Concurrency should be presented as a current guardrail state.

Preferred explanation:

> Deployment blocked  
> Reason: Another deployment is already active for this deployment group.  
> Next step: Wait for the active deployment to complete.

When possible, show supporting context:

- active deployment identifier
- start time
- application involved

This makes concurrency feel explainable rather than arbitrary.

---

# Guardrails in the User Journey

Guardrails should be visible in this sequence:

1. Before deploy, as policy context
2. During deploy, as validation feedback
3. After deploy, in deployment detail
4. In history, as timeline events

This sequence keeps guardrails attached to action and outcome.

---

# Admin Diagnostics

Advanced diagnostics may be available to administrators, but they are not the
primary explanation.

Examples of advanced diagnostics:

- policy error code
- request identifier
- operator hint
- execution reference

These details should expand from a calm user-facing explanation, not replace it.

---

# UX Principles

Guardrails UX follows these rules:

- Explain decisions in product language
- Show policy in context
- Keep the interface object-first and intent-first
- Avoid engine mechanics
- Prefer one clear next step
- Use the alert rail for blocking messages
- Keep policy context in the secondary column

---

# Related Notes

- [[DXCP UX Grammar]]
- [[DXCP Core Vocabulary]]
- [[DXCP Information Architecture]]
- [[Deploy Workflow]]
- [[Deployment Detail Screen]]
---

# State consistency

Guardrail behavior should match the shared DXCP interaction model.

Rules:

- page-level blocked states use the alert rail
- field-specific issues stay inline
- a blocked primary action remains visible with explanation when users would
  reasonably expect it
- quota, concurrency, and policy states should use the same explanation order:
  what is blocked, why, what rule caused it, and what to do next
- deeper diagnostics such as request identifiers or operator hints remain
  secondary and admin-facing
