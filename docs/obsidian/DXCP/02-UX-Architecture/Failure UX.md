# Failure UX

## Confirmed Existing Notes Relevant to This Session

- [[DXCP UX Grammar]]
- [[DXCP Core Vocabulary]]
- [[DXCP Information Architecture]]
- [[DXCP Layout Behavior]]
- [[DXCP Object Model]]
- [[UX-Principles]]
- [[Deployment Timeline]]
- [[Deployment Detail Screen]]
- [[Deployment Screen]]
- [[Deploy Workflow]]
- [[Application Screen]]
- [[Application Screen Wireframe]]
- [[DXCP Vision]]
- [[Decision Deployment detail screens are timeline-centric]]

## Purpose

Define how DXCP surfaces, explains, and guides users through deployment failures.

Failure UX in DXCP must help developers answer:

- what failed
- why it failed
- what they should do next
- whether the failure is retryable
- whether the failure was caused by policy, validation, execution, or platform conditions

The failure experience must stay aligned with the DXCP product model:
DXCP explains the deployment outcome using normalized language while the execution engine remains secondary.

This note extends and connects:
- [[Deployment Timeline]]
- [[Deployment Detail Screen]]
- [[Deploy Workflow]]
- [[Interaction Patterns]]

---

## UX Position

Failure explanation is a product feature in DXCP.

A failure must not appear as raw execution output that users are expected to decode.

DXCP should always provide:

1. a clear outcome signal
2. a normalized explanation
3. one recommended next step
4. explicit retryability guidance
5. deeper diagnostics only when needed

This keeps the product intent-first and avoids turning failure handling into engine archaeology.

---

## Failure UX Architecture

Failure UX has four layers.

### 1. Outcome signal

The UI must make deployment failure obvious before the user reads details.

Surfaces:
- deployment header state
- outcome badge
- alert rail when appropriate
- status indicators in timeline and lists

### 2. Failure summary

DXCP should provide one primary normalized explanation block that answers:

- what failed
- why it failed
- what to do next
- whether retry makes sense

This is the primary failure card on [[Deployment Detail Screen]].

### 3. Failure narrative

The detailed explanation belongs in the chronological story.

Failures must attach to the exact point in [[Deployment Timeline]] where DXCP observed them.

The timeline remains the primary narrative for “what happened.”

### 4. Deep diagnostics

Engine and request-level debugging information is secondary.

These details are visible only in admin contexts and must not replace the normalized explanation.

---

## Failure Explanation Model

DXCP should present failures using a fixed explanation structure.

### Primary explanation block

Each primary failure explanation should contain:

- Category
- What failed
- Why it failed
- What to do next
- Retryability
- Observed time

### Field guidance

#### Category

Category is shown as a short user-facing label.

#### What failed

A one-line normalized summary.

Example:
`Version not found`

#### Why it failed

A short explanation sentence.

Example:
`The selected version has not been registered for this application.`

#### What to do next

Exactly one recommended next step.

Example:
`Register the version, then deploy again.`

#### Retryability

A clear status that tells the user whether retry makes sense.

#### Observed time

The time DXCP observed the failure.

---

## User-Facing Failure Categories

DXCP stores normalized failure categories, but the UI should group them into clearer buckets.

### Blocked by policy

Used when policy prevents deployment before execution.

Examples:
- strategy not allowed
- environment not allowed
- delivery group scope restriction

### Blocked before deploy

Used when validation or artifact requirements fail before execution.

Examples:
- version not found
- configuration invalid
- strategy incompatible

### Failed during deploy

Used when execution began but did not complete successfully.

Examples:
- application startup failure
- execution timeout

### Platform problem

Used when the platform or underlying environment prevented completion.

Examples:
- infrastructure unavailable
- engine unavailable
- dependency outage

### Rollback problem

Used when a rollback attempt fails or cannot complete.

### Unknown problem

Used when DXCP cannot confidently normalize the failure further.

---

## Retryability Model

Retryability must be explicit in the UI.

DXCP should use one of four retryability states.

### Retry now

The user can safely retry immediately.

### Retry later

The problem may be transient, but immediate retry is not recommended.

### Fix and retry

A user or platform change is required before retry.

### Do not retry

Retry is not useful until the system state changes.

---

## Retryability Guidance by Failure Type

### Blocked by policy
Retryability: Fix and retry

Typical next action:
- choose an approved [[DXCP Core Vocabulary#Deployment Strategy|Deployment Strategy]]
- use an allowed [[DXCP Core Vocabulary#Environment|Environment]]
- contact platform support if policy appears incorrect

### Blocked before deploy
Retryability: Fix and retry

Typical next action:
- register the version
- correct configuration
- choose a compatible strategy

### Failed during deploy
Retryability: Retry now or Fix and retry

Typical next action:
- retry deployment
- rollback
- inspect current state

### Platform problem
Retryability: Retry later

Typical next action:
- retry later
- check platform status
- contact platform support

### Rollback problem
Retryability: Retry later or Fix and retry

### Unknown problem
Retryability: Retry once

---

## Failure state behavior

Failure-related states should remain consistent across DXCP.

Rules:

- use the alert rail for page-level failure or refresh conditions that affect
  the current screen
- keep the normalized primary failure explanation in the main content area
- preserve page structure while failure details are loading
- if no failures exist for the deployment or current scope, say so plainly
  rather than leaving an unexplained gap
- request identifiers and engine links remain secondary and admin-facing

## Summary vs Detail

Failure UX must separate fast understanding from deep inspection.

### Summary

Every failed deployment should show one primary failure card near the top of the page.

The card answers:
- what failed
- why it failed
- what to do next
- retryability

### Detail

Detailed failure information appears through progressive disclosure:

- timeline row expansion
- failure list items
- admin diagnostics panel

Users should not need diagnostics to understand the problem.

---

## Timeline Correlation

[[Deployment Timeline]] remains the canonical explanation surface.

### Correlation rules

1. Every normalized failure must attach to the first relevant timeline event.
2. The failure should appear where it became observable, not only at the final outcome row.
3. The terminal outcome should confirm the deployment result, not replace the earlier explanation.
4. If multiple failures exist, one should be designated as the primary failure for the summary card.

### Expected timeline behavior

#### Policy failure
Timeline row:
`Policy check failed`

Expansion shows:
- normalized reason
- recommended next step
- retryability

#### Validation failure
Timeline row:
`Validation failed`

Expansion shows:
- normalized reason
- recommended next step
- retryability

#### Execution or platform failure
Timeline rows:
- `Execution started`
- `Failure observed`
- `Execution failed`
- `Outcome: Failed`

This preserves causal understanding.

---

## Deployment Detail Pattern

Failure information should appear in three coordinated places on [[Deployment Detail Screen]].

### 1. Header status

The page header must make the failed outcome obvious.

Show:
- state
- outcome
- whether the running version changed

### 2. Primary failure summary card

Position:
above the timeline or directly between deployment summary and timeline

Contents:
- category
- what failed
- why it failed
- next step
- retryability
- primary action if allowed

### 3. Timeline-linked failure detail

The relevant timeline row expands to show:
- summary
- detail
- next action
- retryability

### 4. Failure list

If multiple failures exist, a separate failure section below the timeline may list all normalized failures.

This section is for completeness and should not compete with the primary failure card.

---

## Suggested Next-Action Patterns

Every failure shown in DXCP should have exactly one primary recommended next step.

### Policy failures
- Choose an approved strategy
- Deploy to an allowed environment
- Contact platform support

### Validation or artifact failures
- Register the version, then deploy again
- Correct the configuration, then deploy again
- Choose a compatible strategy

### Execution failures
- Retry deployment
- Rollback to the last successful deployment
- Open the application context

### Platform failures
- Retry later
- Contact platform support

### Unknown failures
- Retry once
- If it fails again, open diagnostics or contact support

---

## Guardrails Relationship

Failures caused by policy should feel like a continuation of guardrail explanation, not a separate error system.

When policy blocks a deployment, DXCP should explain:

- which guardrail or policy blocked the action
- why it applied in this context
- what the user can do next

The language should remain consistent with [[Deploy Workflow]] and the existing guardrail model.

Example:

`Blocked by policy`

`This deployment strategy is not allowed for this application’s deployment group.`

`Next step: Choose an approved deployment strategy.`

`Retryability: Fix and retry`

---

## Admin Diagnostics Pattern

Admin diagnostics are visible only to platform admins.

They should appear in a clearly labeled secondary panel and may include:

- engine type
- execution id
- execution link
- request id
- operator hint

These diagnostics support deeper debugging but must remain visually secondary.

DXCP explanation comes first.
Engine diagnostics come second.

---

## Role-Aware Behavior

### Platform Admin
Can see:
- full failure explanation
- admin diagnostics
- execution links
- rollback actions when allowed

### Delivery Owner
Can see:
- full normalized failure explanation
- suggested next steps
- retry and rollback actions when allowed

Cannot see:
- admin-only engine diagnostics

### Observer
Can see:
- full normalized failure explanation
- current outcome
- timeline narrative

Cannot see:
- retry or rollback as primary actions
- admin-only diagnostics

If an action is unavailable, DXCP should explain why.

---

## Failure UX Rules

1. Always explain the failure in normalized DXCP language first.
2. Do not require engine knowledge to understand what happened.
3. Always provide one primary next action.
4. Always state retryability explicitly.
5. Keep the timeline as the primary narrative.
6. Keep admin diagnostics secondary.
7. Use policy language for policy failures and execution language for execution failures.
8. If multiple failures exist, provide one primary failure summary and then list the rest.

---

## Examples

### Policy block

Category: Blocked by policy

What failed:
`Deployment strategy not allowed`

Why it failed:
`This application’s deployment group does not allow the selected deployment strategy.`

What to do next:
`Choose an approved deployment strategy.`

Retryability:
`Fix and retry`

### Validation block

Category: Blocked before deploy

What failed:
`Version not found`

Why it failed:
`The selected version has not been registered for this application.`

What to do next:
`Register the version, then deploy again.`

Retryability:
`Fix and retry`

### Platform problem

Category: Platform problem

What failed:
`Capacity unavailable`

Why it failed:
`The deployment could not secure the required capacity in the target environment.`

What to do next:
`Retry later.`

Retryability:
`Retry later`

---

## Links

- [[DXCP UX Grammar]]
- [[DXCP Core Vocabulary]]
- [[UX-Principles]]
- [[Deploy Workflow]]
- [[Deployment Timeline]]
- [[Deployment Detail Screen]]
- [[Decision Deployment detail screens are timeline-centric]]