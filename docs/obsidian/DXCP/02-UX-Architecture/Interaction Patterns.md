# Interaction Patterns

## Purpose

Define the shared interaction and state rules used across DXCP so repeated
behaviors feel intentional and predictable.

This note aligns the cross-screen experience for:

- blocked actions
- warnings and page-level errors
- loading states
- empty states
- no-results states
- read-only and access-limited states
- success confirmations
- admin-only diagnostics

It complements:
- [[DXCP UX Grammar]]
- [[DXCP Information Architecture]]
- [[DXCP Layout Behavior]]
- [[Guardrails UX]]
- [[Failure UX]]
- [[Layout Grid]]

---

## Interaction Principles

### 1. Use one consistent surface for page-level conditions

DXCP uses the Alert Rail for page-level conditions that affect understanding
or action.

This includes:
- blocked actions
- warnings
- read failures
- refresh failures
- policy explanations that apply to the page as a whole

Field-specific issues stay inline near the field.

### 2. Explain blocked actions the same way everywhere

When DXCP blocks an action, explain in this order:

1. what is blocked
2. why it is blocked
3. what rule or condition caused it
4. what to do next

The user should not have to infer the reason from a disabled button alone.

### 3. Keep unavailable actions visible when users would reasonably expect them

If a user can see that an action normally exists for this object, keep it
visible and unavailable with explanation rather than making it disappear.

Preferred examples:
- disabled `Deploy` on [[Application Screen]] for read-only users
- disabled `Rollback` on [[Deployment Detail Screen]] when policy blocks it

Hide actions only when they are irrelevant to the object or screen.

### 4. Distinguish loading, empty, no-results, and unavailable states

These states mean different things and must not share the same treatment.

- **Loading**: data is still being fetched; preserve page structure with
  skeletons or placeholders.
- **Empty**: there is no content yet for this object or time range.
- **No results**: the user applied filters or a scope that returned nothing.
- **Unavailable**: the system cannot currently provide the data or action.

### 5. Success should be brief and local

Successful actions should confirm what happened without becoming a second
workflow.

Preferred examples:
- `Deployment created`
- `Changes saved`
- `Rollback created`

Success confirmation should appear near the page header or action source,
then return focus to the object state.

### 6. Diagnostics come second

Request identifiers, engine links, and operator hints are secondary.

They may be visible to platform admins through progressive disclosure, but
must not replace the primary explanation shown to all users.

---

## Shared State Rules

## Alert Rail

Use the Alert Rail when:
- the whole page is affected
- an action is blocked
- a save or refresh fails
- a warning changes decision-making
- a system state must be understood before the user continues

Do not use the Alert Rail for:
- required field errors
- local validation tied to one input
- informational noise that does not change action

## Inline validation

Use inline validation for:
- required fields
- malformed values
- incompatible combinations scoped to one section

Inline validation may be accompanied by a summary in the Alert Rail when the
page cannot proceed.

## Loading states

Rules:
- preserve the page header and general layout structure while loading
- prefer skeletons or placeholders over spinner-only pages
- keep supporting context in its real location if the structure is known
- avoid replacing object identity with a blank screen when route context is known

## Empty states

Rules:
- place empty states in the content region they belong to
- explain what is absent in direct operational language
- avoid celebratory or decorative empty-state copy
- include one useful next step when appropriate

## No-results states

Rules:
- make it clear that content exists in general but not for the current scope
- show the active filter or time scope when helpful
- offer a clear recovery path such as clearing filters or widening the time range

## Read-only and access-limited states

Rules:
- explain read-only status in product language
- keep safe navigation available
- do not show broken shells, dead buttons, or partial forms without explanation
- for direct-route access failures, use a blocked-access state in the primary content area

## Success confirmations

Rules:
- confirm the object and outcome in one short message
- do not interrupt the main workflow unless the user must make a second decision
- after success, return emphasis to the updated object state

---

## Screen Expectations

### [[Application Screen]]

Should make these states obvious:
- read-only deploy unavailable
- no recent deployments
- no recent failures
- page-level refresh or policy issues in the Alert Rail

### [[Deploy Workflow]]

Should make these states obvious:
- validating intent
- blocked by policy or quota
- field-level validation failures
- deploy submitted successfully

### [[Deployment Screen]] and [[Deployment Detail Screen]]

Should make these states obvious:
- rollback unavailable and why
- refresh or read failure in the Alert Rail
- no failures on the deployment
- admin-only diagnostics as secondary disclosure

### [[Insights Screen]]

Should make these states obvious:
- loading the current time window
- no activity in the selected range
- no results from scoped filters
- read failure in the Alert Rail

### [[Admin Screens]]

Should make these states obvious:
- blocked access for non-admin users on direct route entry
- save blocked by validation
- warning-level changes that still allow save
- save succeeded

---

## Language Rules

Interaction copy should stay aligned with [[DXCP UX Grammar]].

Use:
- short titles
- direct reasons
- one next step when helpful
- core nouns such as Application, Deployment, Deployment Strategy, and Deployment Group

Avoid:
- raw API payload language
- role constants in user-facing copy
- engine terminology as the primary explanation

---

## Summary

DXCP should react to common situations the same way across screens.

Users should be able to predict:
- where blocked actions are explained
- how loading feels
- where warnings appear
- what empty versus unavailable means
- where deeper diagnostics live

That consistency is part of the product quality bar, not just implementation detail.
