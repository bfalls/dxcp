# Decision History is never the default page shape

## Problem

DXCP must support long-lived operational history.

Applications may accumulate hundreds or thousands of deployments over time.
If that history is rendered directly into the default page shape, the product
will drift toward long-scroll archive screens that feel bulky, hard to scan,
and difficult to understand.

This creates several UX failures:
- the current situation is buried under historical volume
- pages become harder to understand at a glance
- users lose the main action and the main question
- wide screens still feel heavy because the problem is vertical sprawl
- the product starts to feel like an audit database instead of an intent-first
  control plane

## Decision

History is never the default page shape.

DXCP default screens should prioritize:
1. current state
2. recent activity
3. active issues or exceptions
4. next actions

Historical depth should remain available, but only through intentional access.

## Rationale

Users usually arrive on a screen to answer a present-tense question, such as:
- what is happening right now
- did my deployment succeed
- what needs attention
- what should I do next

They do not usually need a full chronological archive before they can act.

A premium UX should make the present clear first and allow deeper historical
inspection second.

This approach keeps DXCP aligned with:
- intent-first interaction
- fast operational comprehension
- lower visual weight
- stronger page hierarchy
- better scalability over time

## What this means in practice

### Default pages should show

- current status
- recent activity
- notable failures or blocked states
- compact summaries
- time-scoped views when history is relevant

### Default pages should avoid

- unbounded historical lists
- infinitely growing timelines as the main page body
- mixing current status and full archive in one long surface
- making users scroll deep just to understand the current situation

## Allowed history patterns

Historical depth should be accessed through one or more of these patterns:

- time-range controls
- paginated tables
- explicit "Load more" behavior
- separate history or archive views
- search and filter views
- condensed timeline summaries with drill-in access
- tabs when the distinction between current and history is strong

## Not allowed as the default pattern

These patterns should not define the main shape of a DXCP page:

- endless vertical history feeds
- detail pages that become historical archives
- showing a year of deployments inline by default
- stacking old records ahead of current meaning

## Screen implications

### Application pages

Application pages should emphasize:
- current health
- recent deployments
- notable issues
- easy access to more history

They should not default to a full deployment archive.

### Deployment pages

Deployment pages should emphasize one deployment story.

They may reference related history, but should not center the entire historical
record of an application.

### Workflow pages

Workflow pages should focus on the action being taken now.

Historical material should only appear when it materially improves the current
decision.

### Admin pages

Admin pages may require historical context for auditability, but the default
page should still center the current configuration or current change context.

## Consequences

### Positive

- faster comprehension
- lower scroll burden
- cleaner visual hierarchy
- better long-term scalability
- more premium product feel
- clearer distinction between overview, detail, workflow, and archive access

### Tradeoffs

- users must intentionally enter deeper history views
- some historical context will be one click farther away
- designers must exercise discipline and avoid adding “just one more” history
  block to default pages

## Relationship to other notes

This decision strengthens:
- [[DXCP Layout Behavior]]
- [[Layout Grid]]
- [[Application Screen]]
- [[Deployment Screen]]
- [[Deployment Detail Screen]]
- [[Deploy Workflow]]

It should be used whenever a screen risks turning into a long-scroll history
surface.

## Rule of thumb

If a page is becoming tall because it is trying to preserve too much history,
the design should move from default surface to intentional history access.