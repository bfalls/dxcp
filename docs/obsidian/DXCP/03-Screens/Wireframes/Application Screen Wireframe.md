# Application Screen Wireframe

## Purpose

Define the structural layout of the [[Application Screen]] using ASCII wireframes.

This document translates the conceptual Application screen design into a
stable layout contract that engineers can implement.

The screen answers the most important operational questions:

What is running?
What changed recently?
What failed?
Can I deploy?
What policy applies?

---

# Top Navigation

Global navigation appears at the top of the application.

Example:

```
+------------------------------------------------------------------+
| DXCP | Applications | Deployments | Insights | Admin | (User)    |
+------------------------------------------------------------------+
```

Rules:

- Navigation is object based, not action based
- Deploy is not a top level navigation item
- User menu appears on the far right

---

# Page Layout

The Application screen uses a two column layout.

Example structure:

```
+------------------------------------------------------------------+
| Alert Rail                                                       |
+------------------------------------------------------------------+

+------------------------------------------------------------------+
| Application: payments-api                          [ Deploy ]    |
+------------------------------------------------------------------+

+------------------------------------+-----------------------------+
| Primary Column                     | Secondary Column            |
|                                    |                             |
| Running Version                    | Deployment Group            |
| Recent Deployment Activity         | Guardrails                  |
| Recent Failures                    | Allowed Strategies          |
+------------------------------------+-----------------------------+
```

Rules:

- Primary column contains operational signal
- Secondary column contains context and policy
- Primary column must visually dominate
- Keep the number of context cards low
- Avoid long explanatory blocks in the secondary column

---

# Alert Rail

The alert rail appears above the page header.

Example:

```
+------------------------------------------------------------------+
| Deployment blocked by policy                                     |
| Reason: concurrency limit reached                                |
+------------------------------------------------------------------+
```

Rules:

- Used for system messages and policy blocks
- Appears only when necessary
- Does not push navigation off screen

---

# Page Header

The page header identifies the application and exposes the primary action.

Example:

```
+------------------------------------------------------------------+
| Application: payments-api                          [ Deploy ]    |
+------------------------------------------------------------------+
```

Rules:

- Deploy is the primary action
- Refresh may appear as a secondary action
- Application name is always visible

---

# Primary Column

The primary column contains the operational status of the application.

Order of sections:

1. Running Version
2. Recent Deployment Activity
3. Recent Failures

Example layout:

```
+------------------------------------+
| Running Version                    |
|                                    |
| v1.32.1                            |
| Environment: sandbox               |
| Deployment: 9831                   |
| Deployed: 12 minutes ago           |
+------------------------------------+

+------------------------------------+
| Recent Deployment Activity        |
|                                    |
| SUCCEEDED   v1.32.1   12m ago      |
| FAILED      v1.32.0   1h ago       |
| SUCCEEDED   v1.31.4   yesterday    |
| View Full History                  |
+------------------------------------+

+------------------------------------+
| Recent Failures                    |
|                                    |
| INFRASTRUCTURE                     |
| ASG capacity exhausted             |
|                                    |
| CONFIG                             |
| Health check misconfigured         |
+------------------------------------+
```

Rules:

- Sections are stacked vertically
- Recent activity remains readable and concise
- Failures highlight actionable information
- The default screen should not become a long-scroll archive

---

# Running Version Panel

The running version panel answers:

What is currently running?

Example:

```
Running Version

Version: v1.32.1
Environment: sandbox
Deployment: 9831
Deployed: 12 minutes ago
```

Rules:

- Must be visible without scrolling
- Links to Deployment detail
- Represents CurrentRunningState

---

# Recent Deployment Activity Panel

The panel shows recent deployments for the application.

Example:

```
Recent Deployment Activity

SUCCEEDED   v1.32.1   12m ago
FAILED      v1.32.0   1h ago
SUCCEEDED   v1.31.4   yesterday
View Full History
```

Rules:

- Most recent deployments appear first
- Each entry links to Deployment detail
- Avoid table layouts with many columns
- Keep the default list intentionally short and summary-first

---

# Failures Panel

Recent failures summarize deployment related problems.

Example:

```
Failures

INFRASTRUCTURE
ASG capacity exhausted

CONFIG
Health check misconfigured
```

Rules:

- Highlight actionable failures
- Link failures to the related deployment
- Avoid excessive diagnostic detail

---

# Secondary Column

The secondary column provides policy context.
It should stay sparse enough that the primary story still dominates.

Example layout:

```
+-----------------------------+
| Deployment Group            |
|                             |
| payments                    |
+-----------------------------+

+-----------------------------+
| Guardrails                  |
|                             |
| Max concurrent: 1           |
| Daily deploy quota: 10      |
| Daily rollback quota: 3     |
+-----------------------------+

+-----------------------------+
| Allowed Strategies          |
|                             |
| Blue-Green                  |
| Rolling                     |
+-----------------------------+

+-----------------------------+
| Environment Info            |
|                             |
| sandbox                     |
+-----------------------------+
```

Rules:

- Panels are stacked vertically
- Information is read only
- Policy information must be visible before deployment

---

# Responsive Behavior

If the screen width decreases:

Two column layout collapses to single column.

Example:

```
Running Version
Deployment Timeline
Failures
Deployment Group
Guardrails
Allowed Strategies
Environment Info
```

Primary column sections appear first.

---

# Interaction Model

Primary interactions on this screen:

Open Deployment  
Deploy Application  
Inspect Failure  
Refresh Application

The screen must not expose pipeline or engine mechanics.

---

# Anti Patterns to Avoid

Avoid the following UI patterns:

Large deployment tables

```
Deployment | Version | Strategy | Duration | Node Count | Pipeline
```

Pipeline stage visualization

```
Stage 1 -> Stage 2 -> Stage 3
```

Engine specific terminology

```
Pipeline
Execution graph
Task
```

The Application screen focuses on **deployment outcomes**, not engine mechanics.

---

# Visual Priority

The screen should emphasize signal over configuration.

Priority order:

Running Version  
Deployment Timeline  
Failures  
Policy Context

Users should understand system state within seconds.

---

# Summary

The Application screen wireframe defines the stable layout for the primary
DXCP operational screen.

It contains:

Running Version  
Deployment Timeline  
Failures  
Deployment Group context  
Guardrails  
Allowed Strategies

This structure keeps the interface focused on application state and
deployment outcomes.

## Related

[[Application Screen]]

[[DXCP Layout Behavior]]