# DXCP Core Vocabulary

## Purpose

DXCP uses a deliberately **small and tightly controlled vocabulary** in the UI.

The goal is to reduce cognitive load and ensure that developers can
understand the system quickly without learning internal platform terminology.

The UX vocabulary intentionally hides internal domain model names and
engine-specific concepts.

This vocabulary is the **authoritative language of the DXCP user interface**.

---

# Core Vocabulary

The DXCP UI is built around a small set of core nouns.

These nouns represent the primary objects that users interact with.

Core nouns:

DXCP
Application
Environment
Deployment
Deployment Strategy
Deployment Group

These nouns should appear consistently throughout the UI and documentation.

---

# Conceptual Model

The DXCP deployment model can be described with a single sentence:

`Application` is deployed to `Environment` via `Deployment` using `Deployment Strategy` and governed by `Deployment Group`.

This conceptual model defines the mental model for DXCP.

---

# Definitions

## DXCP

DXCP (Delivery Experience Control Plane) is the platform that provides a
safe, intent-driven interface for deploying applications.

DXCP owns:

- deployment intent
- deployment governance
- normalized deployment records
- failure visibility
- developer experience

The underlying execution engine performs the actual deployment work.

---

## Application

An **Application** is the primary deployable unit managed by DXCP.

Examples:
```payments-api
billing-worker
web-frontend
```


Applications are:

- registered in DXCP
- associated with a Deployment Group
- deployed using a Deployment Strategy
- deployed to an Environment

Applications replace the internal domain term **Service** in the UI.

---

## Environment

An **Environment** represents a deployment target.

Examples:
```sandbox
staging
production
```


Environment names are used in:

- deployment intent
- deployment records
- running state calculations

Environments are scoped within a Deployment Group.

---

## Deployment

A **Deployment** is a record of an attempt to deploy an Application.

Deployments represent both successful and failed attempts.

A deployment contains:

- application
- environment
- version
- strategy used
- outcome
- timeline events
- normalized failures (if any)

Deployments are immutable records and serve as the primary history
for delivery activity.

---

## Deployment Strategy

A **Deployment Strategy** defines how a deployment is executed.

Examples:
```Blue-Green
Rolling
Canary
```


Strategies are centrally defined and approved by platform engineers.

Strategies map to deployment engine behavior but hide engine
implementation details from users.

Strategies replace the internal domain concept **Recipe** in the UI.

---

## Deployment Group

A **Deployment Group** defines the governance policy applied to a set of
applications.

A Deployment Group controls:

- which applications belong to the group
- which strategies are allowed
- deployment guardrails

Guardrails include:

- max concurrent deployments
- daily deployment quota
- daily rollback quota

Applications belong to exactly **one Deployment Group**.

Deployment Groups replace the internal domain concept **DeliveryGroup**
in the UI.

---

# Derived UI Concepts

These concepts appear in the UI but are not considered core nouns.

Running Version
Failure
Timeline
Insights
Audit Log
System Settings

These represent views, states, or supporting information derived from
core objects.

---

# UX Naming Rules

DXCP follows strict naming rules to preserve clarity.

## Rule 1 - Do not expose internal model names

Internal names such as:

Service
DeploymentRecord
CurrentRunningState
FailureModel
Recipe
DeliveryGroup

must not appear in the user interface.

---

## Rule 2 - Prefer developer language

The UI vocabulary should match the language developers already use when
talking about deployments.

Example:

Use:
`Application`

instead of:

`Service`

---

## Rule 3 - Navigation uses nouns

Primary navigation should use nouns representing system objects.

Example navigation:

```Applications
Deployments
Insights
Admin
```


Avoid verb-based navigation such as:

```Deploy
Manage
Execute
```

---

## Rule 4 - Guardrails are visible product features

Deployment governance should be clearly visible in the UI.

Deployment Groups and their guardrails should be surfaced when users:

- deploy an application
- inspect a deployment
- review policy restrictions

---

# Example UX Language

Example deploy workflow language:

Deploy Application

```Application: payments-api
Environment: sandbox
Strategy: Blue-Green
Version: v1.32.1
```


Example application view:
```Application: payments-api
Running Version: v1.32.1
Deployment Group: payments
Recent Deployments
```

Example deployment detail:
```Deployment 9831

Application: payments-api
Environment: sandbox
Strategy: Blue-Green
Outcome: SUCCEEDED
```

---

# Why This Vocabulary Exists

DXCP intentionally limits vocabulary to keep the platform easy to reason
about.

This supports the product goals:

- express deployment intent rather than engine mechanics
- keep deployments safe and predictable
- reduce cognitive load for engineers
- make delivery failures easier to diagnose

The vocabulary ensures the system feels like a **coherent product**
rather than a thin UI over a complex deployment engine.

---

# Future Evolution

The vocabulary may evolve as DXCP grows.

However the following principles should remain stable:

- small number of core nouns
- developer-centered language
- clear mapping to deployment intent
- governance visible but not overwhelming
