# UI Planning Overview

## Purpose

This note defines the planning posture for DXCP UI work.

Its role is to keep future screen specs consistent, restrained, and aligned to the confirmed DXCP product model, [[DXCP Core Vocabulary]], [[DXCP Object Model]], [[DXCP UX Grammar]], [[DXCP Layout Behavior]], and [[Interaction Patterns]].

This is not a visual design system and not an implementation guide.
It is the planning layer that sits between UX architecture and later mockups or implementation planning.

## Why This Exists

DXCP is a governed, intent-first control plane.
That means screen specs cannot be written as isolated page descriptions or generic dashboard plans.
They need a shared structure that preserves:

- object-first understanding
- calm, high-signal hierarchy
- visible guardrails at the moment of action
- consistent blocked-action behavior
- restrained history access
- predictable page composition across screen families

Without a planning system, enterprise UI work drifts toward bulky one-off screens.
This note prevents that drift.

## Planning Principles

### 1. Every screen must answer one dominant user question

Each DXCP screen spec must declare the main question the screen is built to answer.

Examples:

- [[Application Screen]] answers: what is running, what changed recently, and what can I do next?
- [[Deployment Detail Screen]] answers: what happened in this deployment, why, and what should I do next?
- [[Deploy Workflow]] answers: can I safely submit this deployment intent?
- [[Insights Screen]] answers: where does delivery health need attention?
- [[Admin Screen]] answers: what configuration exists now, what can change, and what risk does the change carry?

A screen may support secondary questions, but the dominant question must drive layout priority.

### 2. Screen specs describe composition before appearance

DXCP UI planning should define:

- page purpose
- region hierarchy
- information priority
- action placement
- state behavior
- responsive behavior

It should not prematurely lock visual styling.
The goal is strong planning that can support later wireframes and mockups without reopening structure.

### 3. Default page shape favors present-tense understanding

Future screen specs must align with [[Decision History is never the default page shape]].

Default views should prioritize:

- current state
- recent activity
- current exceptions
- next actions

Historical depth must be intentionally accessed, not allowed to consume the main page shape.

### 4. Composition must preserve the DXCP spatial story

Future screen specs must align with [[Layout Grid]] and [[DXCP Layout Behavior]].

Every screen spec should assume:

- bounded content container
- full-width top navigation aligned to the same internal content width
- top navigation includes product identity, primary section navigation, and a compact authenticated user menu
- the authenticated user menu shows signed-in identity and logout
- unified alert rail below navigation
- predictable page header zone
- primary content region that tells the main story
- secondary context region that supports without competing

Wide screens may add breathing room, but must not change meaning.

### 5. Actions stay predictable

Primary page actions belong in the page header.
Section actions belong in section headers.
Blocked actions remain visible when users would reasonably expect them, with explanation aligned to [[Interaction Patterns]] and [[Guardrails UX]].

DXCP should not hide meaningful actions merely because they are blocked.
The user should understand:

- what is blocked
- why it is blocked
- what rule caused it
- what they should do next

### 6. Governance is visible at decision points

Guardrails are product features, not after-the-fact warnings.
Future screen specs must show how policy context appears where it materially affects user choice, especially in [[Deploy Workflow]], [[Deployment Detail Screen]], and [[Application Screen]].

Policy visibility should be informative and calm.
It must not dominate the page when no decision is being made.

### 7. Detail is progressive, not sprawling

DXCP screen specs should favor summary-first composition with deeper inspection available through:

- drill-in links
- drawer or modal use only when it reduces disruption
- progressive disclosure inside a section
- intentional history views
- time-range controls or filters where appropriate

Screen specs should resist solving every case by adding another persistent panel.

### 8. Screen specs must define default state and alternate states explicitly

A strong DXCP screen spec is incomplete if it only describes the happy path.
Every future screen spec must define:

- default state
- loading state
- empty state
- no-results state where applicable
- blocked or read-only state where applicable
- error or degraded-read state where applicable

These state definitions must preserve the same page identity rather than replacing the screen with generic placeholders.

### 9. Density is a planning concern, not a final polish pass

DXCP must avoid bulky enterprise UI drift.
Screen specs must describe:

- what deserves persistent space
- what can be condensed
- what should move behind intentional access
- what should never become a long-scroll default region

Restraint is part of the spec quality bar, not an optional cleanup step.

### 10. Screen specs should be comparable across the product

A spec for [[Application Screen]], [[Deployment Detail Screen]], [[Deploy Workflow]], [[Insights Screen]], and [[Admin Screen]] should be easy to compare because they use the same planning frame.

This makes DXCP easier to review, mock, and implement coherently.

## What a DXCP UI Screen Spec Must Achieve

A future screen spec is strong enough when it can do all of the following:

- explain what the screen is for in one sentence
- identify the dominant user question
- describe the page header and main regions clearly
- define the default view and the most important alternate states
- identify primary, secondary, and blocked actions
- explain what belongs in the primary region versus the secondary region
- describe history access without letting history become the default page shape
- define responsive behavior without inventing a different product on narrow widths
- reference shared patterns instead of re-specifying them ad hoc
- provide enough structure for wireframes or mockups to start without guessing

## Planning Boundaries

### This planning layer should define

- purpose
- hierarchy
- composition
- interaction expectations
- state expectations
- density expectations
- responsive expectations
- relationship to shared patterns and related screens

### This planning layer should avoid

- implementation details
- component API definitions
- speculative visual decoration
- backend terminology as UI copy
- ad hoc screen-specific language that violates [[DXCP Core Vocabulary]]

## Screen Families in Scope

This framework is designed to cover the main DXCP screen families already established in the vault:

- [[Application Screen]]
- [[Deployment Detail Screen]]
- [[Deploy Workflow]]
- [[Deployment Screen]]
- [[Insights Screen]]
- [[Admin Screen]]

## How To Use This Note

When writing a new DXCP screen spec:

1. Start from [[Screen_Spec_Framework]].
2. Align wording to [[DXCP Core Vocabulary]] and [[DXCP UX Grammar]].
3. Align page composition to [[Layout Grid]] and [[DXCP Layout Behavior]].
4. Reuse existing behavior from [[Interaction Patterns]], [[Guardrails UX]], and [[Failure UX]].
5. Reference existing screen or flow notes when the spec extends rather than replaces them.
6. Add a design decision note only if the session introduces a reusable rule that should govern more than one future screen.

## Quality Bar

A DXCP UI plan should feel:

- premium, not busy
- stable, not improvised
- explainable, not overloaded
- governance-aware, not governance-dominated
- object-first, not dashboard-first
- ready for mockups, without pretending mockups already exist

## Related

- [[DXCP Vision]]
- [[DXCP Core Vocabulary]]
- [[DXCP Object Model]]
- [[DXCP UX Grammar]]
- [[DXCP Layout Behavior]]
- [[Layout Grid]]
- [[Interaction Patterns]]
- [[Guardrails UX]]
- [[Failure UX]]
- [[Screen_Spec_Framework]]
