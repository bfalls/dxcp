# DXCP Information Architecture

## Purpose

This document defines the **information architecture (IA)** for the DXCP user interface.

The IA describes:

- primary navigation
- object hierarchy
- screen relationships
- administrative structure

The goal is to align the UI structure with the DXCP domain model while
keeping the interface **intent-first, guardrail-aware, and engine-agnostic**.

DXCP is a **deployment control plane**, not a DevOps dashboard.

The interface should revolve around **Applications and Deployments**, not
pipelines or engine mechanics.

---

# Design Principles

DXCP IA follows several guiding principles.

## Object-first navigation

Navigation is organized around **system objects**, not workflows.

Correct:

```
Applications
Deployments
Insights
Admin
```

Avoid:

```
Deploy
Execute
Manage
```

---

## Intent-first workflows

Users should always operate within the context of an object.

Example flow:

```
Applications
  -> Application Detail
     -> Deploy
```

Users should not start from a generic deployment page without context.

---

## Guardrails visible but not overwhelming

Policy and governance must be visible in the UI.

However they should appear as **supporting context**, not primary navigation.

Guardrails belong in:

- policy panels
- deployment forms
- deployment validation messages

---

# Primary Navigation

The primary navigation defines the top-level sections of DXCP.

```
Applications
Deployments
Insights
Admin
```

Each navigation item represents a collection of objects.

---

# Applications

The **Applications** section is the primary workspace for developers.

Users begin here when they want to:

- inspect an application
- deploy a new version
- review deployment history
- investigate failures

Applications list displays:

```
Application Name
Running Version
Deployment Group
Last Deployment Time
```

Primary action:

```
Open Application
```

---

# Application Detail

The Application detail view is the **core operational screen** of DXCP.

Operational work for an [[DXCP Core Vocabulary#Application|Application]] occurs primarily in the [[Application Screen]].

Investigation of an individual [[DXCP Core Vocabulary#Deployment|Deployment]] occurs in the [[Deployment Screen]].

Creation of deployments follows the process defined in [[Deploy Workflow]].

It answers the most important operational questions:

```
What is currently running?
What changed recently?
What failed?
Can I deploy?
What policy governs this application?
```

Application detail contains the following sections.

```
Overview
Deploy
Deployments
Failures
Insights
```

These sections are implemented as tabs or sub-views.

---

# Application Detail Sections

## Overview

Purpose:

Provide a quick operational snapshot.

Displays:

```
Running Version
Deployment Group
Recent Deployments
Recent Failures
```

Primary action:

```
Deploy
```

---

## Deploy

Purpose:

Submit a deployment intent.

Displays:

```
Application
Environment
Deployment Strategy
Version
Change Summary
```

Supporting context panel:

```
Deployment Group
Allowed Strategies
Deployment Guardrails
Remaining Quotas
```

Primary action:

```
Deploy
```

---

## Deployments

Purpose:

Show recent deployment activity for the application.

Displays a chronological list or timeline of deployments.

Each entry contains:

```
Deployment ID
State
Version
Strategy
Created Time
Rollback Indicator
```

Primary action:

```
Open Deployment
```

---

## Failures

Purpose:

Expose normalized failures related to deployments.

Each failure entry displays:

```
Failure Category
Summary
Suggested Action
Observed Time
```

Primary action:

```
Inspect Deployment
```

---

## Insights

Purpose:

Provide aggregated operational insights for the application.

Examples:

```
Failure categories
Rollback rate
Deployments by strategy
```

This section may initially link to the global Insights view.

---

# Deployments

The **Deployments** section displays a global list of deployment records.

Users visit this section to:

- audit recent deployments
- investigate cross-application failures
- open a specific deployment record

Deployment list displays:

```
State
Application
Version
Environment
Created Time
```

Primary action:

```
Open Deployment
```

---

# Deployment Detail

Deployment detail explains a single deployment.

The screen contains:

```
Deployment Summary
Timeline
Failures
Diagnostics
```

Deployment summary includes:

```
Application
Environment
Version
Strategy
Outcome
Created Time
```

Primary actions:

```
Rollback
Open Application
```

Diagnostics may include links to engine execution details for platform admins.

---

# Insights

The **Insights** section provides system-wide delivery analytics.

Examples:

```
Rollback rate
Failures by category
Deployments by strategy
Deployments by deployment group
```

Purpose:

Provide platform-level visibility into delivery health.

Primary action:

```
Refresh Insights
```

---

# Admin

The **Admin** section contains platform configuration.

Admin controls are visible only to platform administrators.

Admin sections include:

```
Deployment Groups
Strategies
System Settings
Audit Log
```

---

# Deployment Groups

Purpose:

Define governance policy for applications.

Displays:

```
Group Name
Description
Owner
Applications
Allowed Strategies
Guardrails
```

Primary actions:

```
Create Group
Edit Group
```

Guardrails include:

```
Max concurrent deployments
Daily deploy quota
Daily rollback quota
```

---

# Strategies

Purpose:

Define approved deployment strategies.

Displays:

```
Strategy Name
Description
Status
Usage Count
```

Primary actions:

```
Create Strategy
Edit Strategy
Deprecate Strategy
```

Strategies map to deployment engine pipelines but hide engine details.

---

# System Settings

Purpose:

Configure global platform limits and behavior.

Displays:

```
Read request rate limit
Mutate request rate limit
```

Primary actions:

```
Load Settings
Save Settings
```

---

# Audit Log

Purpose:

Provide a permanent record of administrative and delivery actions.

Displays:

```
Event Type
Actor
Timestamp
Target Resource
Outcome
Summary
```

Audit logs are append-only and represent the authoritative record of
administrative actions.

---

# Object Relationship Summary

The DXCP system can be summarized with the following relationships.

```
Application
  belongs to
Deployment Group

Application
  deployed to
Environment

Application
  deployed using
Deployment Strategy

Deployment
  records the result of
Deploy Application

Deployment
  may produce
Failure
```

This structure defines the conceptual model of the system.

---

# Future Evolution

As DXCP evolves, the IA may expand to include:

```
Dashboard
Multi-environment promotions
Team ownership views
Delivery health analytics
```

However the following structure should remain stable:

```
Applications
Deployments
Insights
Admin
```

This ensures the UI remains predictable and easy to navigate.

## Related

[[Application Screen]]

[[Deployment Screen]]

[[Deploy Workflow]]

[[DXCP Layout Behavior]]