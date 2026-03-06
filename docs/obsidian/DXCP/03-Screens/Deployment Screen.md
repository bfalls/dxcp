# Deployment Screen

## Purpose

The **Deployment screen** explains a single deployment. This screen explains a single [[DXCP Core Vocabulary#Deployment|Deployment]] created from an [[DXCP Core Vocabulary#Application|Application]].

It provides the authoritative record of:

- what was requested
- what happened during execution
- whether the deployment succeeded or failed
- what failures occurred
- whether rollback is possible

This screen provides the baseline deployment object view. Detailed investigation behavior is further refined in [[Deployment Detail Screen]].

Shared state behavior should remain consistent with [[Interaction Patterns]].

---

# Primary Questions

The screen must answer immediately:

```
What deployment is this?
Did it succeed?
What version was deployed?
When did it run?
What happened during execution?
What failed?
Can it be rolled back?
```

---

# Layout Structure

The screen follows the DXCP layout model:

- page header
- primary timeline column
- secondary context column

Example layout:

```
---------------------------------------------------
Alert Rail
---------------------------------------------------

Deployment: 9831     SUCCEEDED

Application: payments-api
Version: v1.32.1

---------------------------------------------------

Primary Column (left)

Deployment Timeline
Failures

---------------------------------------------------

Secondary Column (right)

Deployment Summary
Policy Snapshot
Actions
```

The right column should remain compact and supportive rather than becoming a second investigation surface.

---

# Page Header

The header identifies the deployment and exposes primary actions.

Example:

```
Deployment: 9831

Application: payments-api
Environment: sandbox
Version: v1.32.1
Strategy: Blue-Green
State: SUCCEEDED
```

Primary actions (right side):

```
Rollback
Open Application
Refresh
```

If rollback is not allowed, the button remains visible but disabled with explanation.
Page-level blocking reasons belong in the alert rail.

---

# Deployment Summary

The summary panel provides the immutable deployment intent.

Fields:

```
Application
Environment
Version
Strategy
Deployment Group
Change Summary
Created Time
Requested By
```

This information comes from the immutable deployment details captured when the deployment was created.

---

# Policy Snapshot

The deployment must record the policy state that governed the deployment.

This ensures audits remain accurate even if policy changes later.

Example:

```
Deployment Group: payments

Guardrails

Max concurrent deployments: 1
Daily deploy quota: 10
Daily rollback quota: 3

Allowed Strategies

Blue-Green
Rolling
```

This panel is read-only.

---

# Deployment Timeline

The timeline is the **core visual element** of the screen.
Its structure and event model are defined in [[Deployment Timeline]].
Deployment lifecycle follows the process defined in [[Deploy Workflow]].

It represents the lifecycle of the deployment.

Example:

```
Deployment Timeline

Deployment requested
Policy validated
Execution started
Verification started
Deployment succeeded
```

Timeline rules:

- chronological order
- newest events appear at top or bottom depending on layout preference
- events must be short sentences
- events must be engine-agnostic

---

# Timeline Event Types

Suggested event set:

```
Deployment requested
Policy validated
Validation failed
Execution started
Verification started
Deployment succeeded
Deployment failed
Deployment canceled
Rollback triggered
Rollback completed
```

Events should include timestamps.

Example:

```
Execution started
12:41:03 UTC
```

---

# Failures Section

If failures occur they appear below the timeline.

Example:

```
Failures

INFRASTRUCTURE
ASG capacity exhausted
Suggested action: increase instance limit

CONFIG
Health check misconfigured
Suggested action: verify target group settings
```

Each failure entry contains:

```
Failure category
Summary
Suggested action (optional)
Observed time
```

Failures should link to related diagnostic information when available.

---

# Actions Panel

The right column contains available actions.
Actions and diagnostics should stay concise so the timeline remains visually dominant.

Typical actions:

```
Rollback
Open Application
Refresh
```

Admin-only actions:

```
Open execution diagnostics
View engine execution
```

These should be hidden from non-admin users.
Admin diagnostics should remain progressive disclosure rather than a permanently expanded panel.

---

# Rollback UX

Rollback should only be available when:

- deployment succeeded
- policy allows rollback
- rollback quota is not exceeded

Rollback flow:

```
User clicks Rollback
Confirm dialog appears
Rollback Deployment created
```

Example confirmation:

```
Rollback deployment

Application: payments-api
Rollback to version: v1.31.4

[ Cancel ]   [ Confirm Rollback ]
```

The rollback action creates a new Deployment record.

---

# Deployment States

The deployment state appears prominently in the header.

Recommended states:

```
PENDING
IN PROGRESS
SUCCEEDED
FAILED
CANCELED
ROLLED BACK
SUPERSEDED
```

State coloring should be consistent across the system.

Example mapping:

```
SUCCEEDED   green
FAILED      red
IN PROGRESS blue
PENDING     gray
```

---

# Diagnostics (Admin Only)

Platform admins may access engine diagnostics.

Examples:

```
Execution logs
Pipeline run ID
Engine execution link
```

These details should be visually separated so that the normal user
interface remains engine-agnostic.

---

# Shared interaction states

### Read and loading states

- preserve the page header and layout while deployment data loads
- use placeholders for summary, timeline, and policy snapshot rather than a spinner-only page
- if refresh fails, show the page-level problem in the alert rail

### No failures

If no failures exist for the deployment, state that clearly in the failures area.

### Rollback unavailable

When rollback is unavailable:

- keep the action visible
- explain why it is unavailable
- place page-level blocking explanation in the alert rail when needed

---

# Empty / Edge States

The screen must handle unusual cases gracefully.

### Deployment Pending

```
Deployment requested
Waiting for execution to begin
```

### Deployment Canceled

```
Deployment canceled by user
```

### Deployment Superseded

```
A newer deployment has replaced this one
```

---

# UX Anti-Patterns to Avoid

The Deployment screen must avoid:

```
Pipeline stage lists
Engine-specific terminology
Large configuration tables
Hidden failure details
```

The focus must remain on **deployment outcome**, not engine execution.

---

# Visual Priority

The visual hierarchy should emphasize operational signal and fast comprehension.

Priority order:

```
Deployment state
Timeline
Failures
Summary
Policy snapshot
Diagnostics
```

Users should understand deployment status within seconds.

---

# Summary

The Deployment screen provides the authoritative explanation
of a single deployment.

It includes:

```
Deployment summary
Timeline of events
Failures
Policy snapshot
Rollback action
```

This screen allows developers and operators to quickly understand
what happened during a deployment and what to do next.

## Related

[[Application Screen]]

[[Deploy Workflow]]

[[DXCP Layout Behavior]]