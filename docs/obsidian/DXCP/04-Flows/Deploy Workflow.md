# Deploy Workflow

## Purpose

Define the end-to-end **Deploy Application** workflow in DXCP. This workflow creates a [[DXCP Core Vocabulary#Deployment|Deployment]] for an [[DXCP Core Vocabulary#Application|Application]] using a [[DXCP Core Vocabulary#Deployment Strategy|Deployment Strategy]] governed by a [[DXCP Core Vocabulary#Deployment Group|Deployment Group]].

This flow is intent-first, guardrail-aware, and avoids exposing engine mechanics.
It defines user actions, validation stages, failure handling, and the resulting
Deployment record lifecycle.

Core nouns used:

Application
Environment
Deployment
Deployment Strategy
Deployment Group

---

# Entry Points

The deploy workflow is entered from:

1. **Application screen**
   - Primary action: `Deploy`

2. (Optional) **Applications list**
   - Secondary action: `Deploy` (only if the user has permission)
   - If present, it must immediately require application selection and then behave identically.

DXCP should avoid a standalone "Deploy" navigation item in v1. Deploy is an action
performed in Application context.

---

# Preconditions

Before a deploy can be submitted:

- User is authenticated.
- User role allows deploy:
  - PLATFORM_ADMIN: allowed
  - DELIVERY_OWNER: allowed (within scope)
  - OBSERVER: not allowed
- Version is registered for the Application.
- Deployment Strategy is selected.
- Change Summary is provided (required).

---

# Flow Overview

High-level phases:

1. Open deploy form (in Application context)
2. Enter intent fields
3. Validate intent (policy-first ordering)
4. Submit deployment (creates Deployment record)
5. Observe deployment progress (via Deployment detail / timeline)
6. Terminal outcome (succeeded/failed/canceled/etc.)

---

# Step-by-Step Flow

## Step 1 - Start Deploy

User action:

- Open Application
- Click `Deploy`

UI behavior:

- Open Deploy form
- Preserve Application context (do not navigate away to a generic deploy screen unless required)

---

## Step 2 - Enter Deployment Intent

Intent fields:

- Application (preselected, read-only)
- Environment (defaulted; user selects if multiple are available)
- Deployment Strategy (required)
- Version (required; may be selected from registered versions or entered)
- Change Summary (required)

Primary action:

- `Deploy`

Secondary actions:

- `Refresh` (reload allowed versions/strategies/policy snapshot)

Policy context panel (always visible while editing intent):

- Deployment Group name
- Guardrails summary
- Allowed strategies list
- Quota remaining (if available)
- Concurrency status (if available)

---

## Step 3 - Validate Intent (Policy-First Ordering)

DXCP must validate and fail in this exact order:

1) Deployment Group policy
2) Compatibility validation
3) Quota checks
4) Concurrency checks
5) Engine execution (only after all above pass)

This ordering is user-visible: the first failure encountered is the one presented.

### 3.1 Policy Validation

What is checked:

- Application is in a Deployment Group
- Selected Strategy is allowed by that Deployment Group
- Environment allowed (if group restricts environments)

If blocked:

- Show a blocking message in the alert rail:

Example:

```
Deployment blocked by policy

Deployment Group: payments
Reason: strategy not allowed
```

No engine calls occur.

### 3.2 Compatibility Validation

What is checked:

- Strategy is compatible with the Application (if applicable)
- Version exists and is registered for the Application

If blocked:

Example:

```
Deployment blocked

Reason: version not registered for this application
```

### 3.3 Quota Checks

What is checked:

- Daily deploy quota (group-scoped)
- Any global quota limits (if applicable)

If blocked:

Example:

```
Deployment blocked by quota

Reason: daily deploy quota exceeded
Reset: tomorrow
```

### 3.4 Concurrency Checks

What is checked:

- Max concurrent deployments for the Deployment Group

If blocked:

Example:

```
Deployment blocked

Reason: concurrency limit reached
Try again after the active deployment completes
```

---

## Step 4 - Submit Deploy

User action:

- Click `Deploy`

System behavior:

- Create a new Deployment record (immutable record of intent + policy snapshot)
- Begin execution through the engine adapter only after validations pass

UI behavior:

- Navigate to Deployment detail (or show "Deployment created" and deep-link)
- Show the Deployment in `PENDING` or `ACTIVE` state immediately

Success message:

```
Deployment created
Deployment: 9831
```

---

# Deployment Record Lifecycle (User-Visible)

A deployment progresses through states visible in the UI.

Recommended user-facing state progression:

- PENDING (created, waiting)
- IN PROGRESS (execution started)
- SUCCEEDED (terminal)
- FAILED (terminal)
- CANCELED (terminal)
- ROLLED BACK (terminal, applied later as outcome)
- SUPERSEDED (derived outcome when a later deployment becomes current)

Notes:

- DXCP records are the source of truth for status.
- Engine details are referenced for admins only.

---

# Observability During Deploy

## Application Screen

While a deployment is active:

- Running Version remains the last successful deployment.
- Timeline shows the active deployment at the top with "IN PROGRESS".

Deployment progress is explained on [[Deployment Screen]] through the [[Deployment Timeline]].

## Deployment Detail Screen

Deployment detail must provide:

- Summary (Application, Environment, Version, Strategy, timestamps)
- Timeline (ordered events)
- Failures (normalized)
- Actions:
  - Rollback (if allowed and valid)
  - Open execution diagnostics (admins only)

---

# Timeline Event Grammar

Timeline events should read like short sentences (engine-agnostic).

Suggested event set:

- Deployment requested
- Policy validated
- Validation failed (with reason)
- Execution started
- Verification started (if applicable)
- Deployment succeeded
- Deployment failed
- Deployment canceled
- Rollback triggered
- Rollback completed

Timeline entries must not reference pipelines, stages, or engine terminology.

---

# Failure Handling

Failures are represented as normalized Failure items.

Failure categories include:

VALIDATION
POLICY
ARTIFACT
INFRASTRUCTURE
CONFIG
APP
TIMEOUT
ROLLBACK
UNKNOWN

When failures exist:

- Show them prominently in Deployment detail
- Also surface the most recent failure summary on the Application screen

Each failure entry should include:

- category
- summary
- action hint (if available)
- observed time

---

# Blocked Actions UX

Blocked deploy scenarios:

1. Role blocked (OBSERVER)
2. Policy blocked
3. Compatibility blocked
4. Quota blocked
5. Concurrency blocked
6. Mutations disabled (global kill switch)

UX rules:

- Do not hide the Deploy button without explanation.
- If blocked, disable the primary action and display the reason in a consistent location
  (alert rail or form-level message).

---

# Idempotency (UX Implications)

Deploy submissions are idempotent.

If the user retries and the request is treated as a replay:

- Show:

```
Deployment already created
Deployment: 9831
```

and navigate to the existing Deployment.

If the user retries with conflicting payload:

- Show a clear error:

```
Deployment request conflict
A deployment already exists for this request key with different details.
```

---

# Role Variants

## PLATFORM_ADMIN

- Can deploy any application
- Can view admin diagnostics and engine references

## DELIVERY_OWNER

- Can deploy within Deployment Group scope
- Can rollback (subject to policy)

If out of scope:

- Show:

```
Access denied
Reason: deployment group scope required
```

## OBSERVER

- Read-only
- Deploy action is disabled with:

```
Read-only access
Your role does not allow deployments.
```

---

# Definition of Done

The deploy workflow is complete when:

- Deploy can be initiated from Application
- Intent fields match the domain model (no engine fields)
- Validation ordering matches governance contract
- Blocked states are clear and explainable
- A Deployment record is created and becomes the status source
- Timeline and failures are visible and actionable

## Related

[[Application Screen]]

[[Deployment Screen]]