# DXCP Application Screen

## Purpose

The **Application screen** is the primary operational workspace in DXCP. This screen represents an [[DXCP Core Vocabulary#Application|Application]] and allows users to create a [[DXCP Core Vocabulary#Deployment|Deployment]] using a selected [[DXCP Core Vocabulary#Deployment Strategy|Deployment Strategy]] governed by a [[DXCP Core Vocabulary#Deployment Group|Deployment Group]]. The Application screen shows a summarized recent history, not a full archive. Detailed lifecycle behavior is defined in [[Deployment Timeline]].

Most user workflows begin and end on this screen.

The screen allows developers to:

- understand the current running version
- review recent deployments
- identify failures
- deploy a new version
- understand policy constraints

The screen must answer the most important operational questions quickly.

```
What is running?
What changed recently?
What failed?
Can I deploy?
What guardrails apply?
```

---

# Layout Structure

The Application screen follows the DXCP layout contract:

- bounded content container
- stable page header
- primary vs secondary columns
- alert rail above page header

Primary content appears on the **left**.  
Supporting policy and metadata appear on the **right**.

---

# Page Header

The page header identifies the application and exposes primary actions.

Example:

```
Application: payments-api
```

Right side actions:

```
Deploy
Refresh
```

Deploy is the primary action.

---

# Screen Layout

Example layout:

```
----------------------------------------------------
Alert Rail
----------------------------------------------------

Application: payments-api                Deploy

----------------------------------------------------

Primary Column (left)

Running Version
Deployment Timeline
Failures

----------------------------------------------------

Secondary Column (right)

Deployment Group
Guardrails
Allowed Strategies
```

Primary content must visually dominate the screen.

The secondary column provides supporting context.

It should stay compact and selective so the page remains calm and operational.

---

# Running Version

The Running Version section answers the question:

```
What is currently running?
```

Example:

```
Running Version

v1.32.1
Environment: sandbox
Deployment: 9831
Deployed: 12 minutes ago
```

This information reflects DXCP's current running version for the application.

Users should be able to click the deployment ID to open the deployment detail.

---

# Recent Deployment Activity

This section shows recent deployments in chronological order.

Example:

```
Recent Deployment Activity

SUCCEEDED  v1.32.1   12 minutes ago
FAILED     v1.32.0   1 hour ago
SUCCEEDED  v1.31.4   yesterday

View Full History
```

Each entry displays:

```
Deployment state
Version
Strategy
Timestamp
Rollback indicator (if applicable)
```

Primary action:

```
Open Deployment
```

This section should prioritize readability over table density.

Rules:

- show a bounded recent slice by default
- keep the list short enough to preserve above-the-fold meaning
- make full history an intentional action rather than the default page shape

---

# Failures

The Failures section surfaces notable normalized failures related to recent deployments.

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

Failure entries are normalized by DXCP so they can be read consistently across deployments.

Primary action:

```
Inspect Deployment
```

Failures should link to the associated deployment.

This section should highlight what needs attention now rather than restating every historical failure.

---

# Deploy Action

Deploy is the primary action for the Application screen. Deployment actions follow the process defined in [[Deploy Workflow]].

Pressing **Deploy** opens the deployment intent form.

Example deploy form:

```
Deploy Application

Application: payments-api
Environment: sandbox
Strategy: Blue-Green
Version: v1.33.0

Change Summary
[ text field ]

[ Deploy ]
```

The form must show policy context in a side panel.

That side panel should stay concise and decision-focused.

---

# Policy Panel

The policy panel shows governance information derived from the Deployment Group.
It should support the deploy decision without becoming a tall second workspace.

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

Guardrails are visible so users understand why deployments may be blocked.

DXCP treats guardrails as product features, not hidden rules.

---

# Blocked Deployment UX

If deployment validation fails, the UI must clearly explain why.

Example:

```
Deployment blocked by policy

Reason: concurrency limit reached
Deployment Group: payments
```

If additional diagnostics exist, they may be visible to platform admins.

---

# Role Awareness

The Application screen adapts to the user role.

Platform admin

```
Deploy
Rollback
Open execution diagnostics
```

Delivery owner

```
Deploy
Rollback
```

Observer

```
Read-only view
Deploy unavailable with explanation
```

Blocked actions should display explanatory messages rather than disappearing.
Page-level blocking reasons belong in the alert rail.

---

# Shared states

The Application screen should distinguish loading, empty, no-results, and
read-only states clearly.

Loading:

- preserve the page header and main layout
- use placeholders for Running Version, recent deployments, and failures

Empty states:

- if the application has no deployment history, say so in the recent deployment area
- if there are no recent failures, say so in the failures section rather than leaving it blank

No-results states:

- if a scoped filter or time window returns nothing, explain that the current scope has no matching deployments

Read-only state:

- keep deploy-related affordances understandable
- explain unavailable actions in product language

---

# Interaction Patterns

Key interaction patterns include:

```
Deploy Application
Open Deployment
Inspect Failure
Refresh Application
```

The screen should never expose deployment engine mechanics.

Shared state behavior should remain consistent with [[Interaction Patterns]].

---

# Anti-Patterns to Avoid

The Application screen should avoid the following patterns.

Table-first layouts

```
Large deployment tables with dozens of columns
```

Pipeline-centric UX

```
Pipeline stages
Pipeline editing
Pipeline configuration
```

Hidden governance

```
Policy violations without explanation
```

These patterns expose engine complexity and violate DXCP design goals.

---

# Visual Priority

The screen should emphasize operational signal over configuration.

Priority order:

```
Running Version
Recent Deployment Activity
Recent Failures
Policy Context
```

Users should understand system state within seconds of opening the screen.

---

# Future Enhancements

Possible future improvements include:

```
Deployment health indicators
Environment promotion visualization
Delivery health score
Application-level insights
```

These enhancements should preserve the object-first design of the screen.

---

# Summary

The Application screen serves as the operational hub for DXCP.

It provides:

```
Current running state
Recent deployment activity
Recent failure visibility
Deployment intent
Policy context
```

By centering the UI around Applications rather than pipelines, DXCP
maintains its intent-first design and hides deployment engine complexity.

## Related

[[Application Screen Wireframe]]

[[Deployment Screen]]

[[Deploy Workflow]]

[[DXCP Layout Behavior]]