# DXCP Application Screen

## Purpose

The **Application screen** is the primary operational workspace in DXCP. This screen represents an [[DXCP Core Vocabulary#Application|Application]] and allows users to create a [[DXCP Core Vocabulary#Deployment|Deployment]] using a selected [[DXCP Core Vocabulary#Deployment Strategy|Deployment Strategy]] governed by a [[DXCP Core Vocabulary#Deployment Group|Deployment Group]].

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
Environment Info
```

Primary content must visually dominate the screen.

The secondary column provides supporting context.

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

This information is derived from **CurrentRunningState**. :contentReference[oaicite:1]{index=1}

Users should be able to click the deployment ID to open the deployment detail.

---

# Deployment Timeline

The Deployment Timeline shows recent deployments in chronological order.

Example:

```
Deployment Timeline

SUCCEEDED  v1.32.1   12 minutes ago
FAILED     v1.32.0   1 hour ago
SUCCEEDED  v1.31.4   yesterday
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

The timeline should prioritize readability over table density.

---

# Failures

The Failures section surfaces normalized failures related to deployments.

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

Failure entries come from **FailureModel** records. :contentReference[oaicite:2]{index=2}

Primary action:

```
Inspect Deployment
```

Failures should link to the associated deployment.

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

---

# Policy Panel

The policy panel shows governance information derived from the Deployment Group.

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

DXCP treats guardrails as product features, not hidden rules. :contentReference[oaicite:3]{index=3}

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

PLATFORM_ADMIN

```
Deploy
Rollback
Open execution diagnostics
```

DELIVERY_OWNER

```
Deploy
Rollback
```

OBSERVER

```
Read-only view
No deploy actions
```

Blocked actions should display explanatory messages rather than disappearing.

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
Recent Deployments
Failures
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
Deployment history
Failure visibility
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