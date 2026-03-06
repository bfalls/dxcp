# Deployment Detail Screen

## Purpose

The Deployment Detail Screen explains a single [[DXCP Core Vocabulary#Deployment|Deployment]].

It is the detailed operational view for understanding what happened,
what failed, what is currently true, and what the operator should do next.

This note refines and extends the canonical [[Deployment Screen]] model.

The screen prioritizes operational narrative over execution mechanics.

DXCP owns the deployment story while the underlying engine remains a referenced diagnostic system, not the primary UX. See [[Deployment Timeline]] and [[Deploy Workflow]].

---

## Primary Questions

The screen must answer within seconds:

- What happened in this deployment?
- What is the current outcome?
- What failed?
- What should I do next?
- Can I rollback?

These questions align with the intent-first product philosophy and the requirement that failures be surfaced as actionable information rather than raw engine output. See [[DXCP Vision]].

---

## Screen Layout

The screen follows the DXCP layout contract:

- bounded content container
- page header
- unified alert rail
- two-column body
  - primary column for operational narrative
  - secondary column for supporting context

This follows the layout behavior established in [[DXCP Layout Behavior]] and the product layout rules.

---

## Page Header

The page header identifies the deployment and exposes primary actions.

Header fields:

- [[DXCP Core Vocabulary#Application|Application]]
- [[DXCP Core Vocabulary#Environment|Environment]]
- version
- [[DXCP Core Vocabulary#Deployment Strategy|Deployment Strategy]]
- state
- deployment kind

Primary actions appear on the right side of the header.

Typical actions:

- Rollback
- Open Application
- Open Service URL
- Open execution detail (admin only)

The header must make the current outcome obvious before the user reads the timeline.

---

## Primary Column

The left column contains the primary operational narrative.

Sections:

1. Deployment Summary
2. Deployment Timeline
3. Failures

Rules:

- the first screenful should establish outcome and meaning before deep reading begins
- the summary should stay concise and avoid competing with the timeline

### Deployment Summary

The summary explains the immutable deployment intent and result.

Fields:

- Application
- Environment
- version
- Deployment Strategy
- [[DXCP Core Vocabulary#Deployment Group|Deployment Group]]
- change summary
- created time
- updated time
- requested by
- outcome

This section should allow a developer to understand the deployment at a glance.

### Deployment Timeline

The timeline is the dominant element of the screen.

Its event taxonomy and ordering are defined in Deployment Timeline.

The timeline must:

- remain chronological
- remain engine-agnostic
- attach failures to the relevant point in the narrative
- expose only normalized, developer-readable detail

The timeline is the primary explanation surface for the deployment.

### Failures

Failures appear beneath the timeline when present.

Each failure entry should contain:

- category
- summary
- detail if needed
- suggested action
- observed time

Failures should be normalized and actionable.

The screen must not force users to interpret engine-specific failures in order to decide what to do next.

---

## Secondary Column

The right column contains supporting context.

Sections:

1. Running Version
2. Policy Context
3. Deployment Strategy Information
4. Actions
5. Admin Diagnostics

This column supports comprehension but must not visually compete with the timeline.
It should stay selective, compact, and clearly secondary.

### Running Version

Purpose:

Answer what is running now.

Displays:

- current version
- deployment that established it
- deployment kind
- derived timestamp

This is supporting context, not runtime health.

### Policy Context

Purpose:

Show the governance boundary that applied to this deployment.

Displays:

- Deployment Group
- owner
- allowed strategies
- max concurrent deployments
- daily deploy quota
- daily rollback quota

This is a policy snapshot, not a live editor.

### Deployment Strategy Information

Purpose:

Explain the delivery behavior chosen for this deployment.

Displays:

- strategy name
- revision used
- frozen behavior summary

This preserves operator understanding even if the strategy evolves later.
When space is tight, this information may collapse into a shorter summary rather than claiming equal visual weight with the timeline.

### Actions

This area contains role-aware actions relevant to the deployment.

Typical actions:

- Rollback
- Open Application
- Open Service URL

Admin-only:

- Open execution diagnostics
- View engine execution

### Admin Diagnostics

Visible only to platform administrators.

Displays:

- engine type
- execution id
- execution URL
- request id
- operator hint if available

These details are referenced only for deep debugging.
They must remain visually secondary so the screen stays engine-agnostic for normal users.
Default presentation should be collapsed or compact by default.

---

## Role-Aware Actions

The screen must reflect role-aware capability clearly.

### Platform admin

Allowed:

- Rollback
- Open execution detail
- Open Service URL
- Open Application

### Delivery owner

Allowed:

- Rollback
- Open Service URL
- Open Application

### Observer

Allowed:

- Open Service URL
- Open Application

Not allowed:

- rollback
- engine diagnostics
- mutating deployment actions

If an action is blocked, the reason should be clearly explained in the alert rail or the action affordance.

---

## Rollback Behavior

Rollback is only available when policy and deployment state allow it.

Rollback must be presented as creating a new deployment record rather than mutating the original deployment.

The confirmation should clearly state:

- the Application
- the target version
- that a new rollback deployment will be created

Rollback remains a first-class operational action, not a hidden admin tool.

---

## Interaction Behavior

### Default reading flow

The user should read the screen in this order:

1. Header
2. Outcome and summary
3. Timeline
4. Failures
5. Current running state
6. Policy context
7. Diagnostics if needed

### Progressive disclosure

The screen should show high-signal narrative by default.
It should not grow into a dense catalog of equal-weight panels.

Expanded detail may reveal:

- failure detail
- short explanatory text
- admin diagnostics

### Alert rail

Global blocking or explanatory messages should appear in the unified alert rail above the page header.

Examples:

- rollback blocked by quota
- policy violation explanation
- engine refresh error

---

## Wireframe

```text
---------------------------------------------------------------
Alert Rail
---------------------------------------------------------------

Deployment: 9831                                 [Rollback] [Open Application]

Application: payments-api
Environment: sandbox
Version: v1.32.1
Strategy: Blue-Green
State: FAILED

---------------------------------------------------------------
Left column                                  Right column

Deployment Summary                           Current Running State

Deployment Timeline                          Policy Context

Failures                                     Deployment Strategy Information

                                             Actions

                                             Admin Diagnostics
---------------------------------------------------------------