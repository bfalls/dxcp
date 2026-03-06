# DXCP Insights Screen

## Purpose

The **Insights** screen is the system-level delivery observability view in DXCP.

It helps users understand recent delivery health across the system and decide where to investigate next.

It answers questions such as:

- how healthy delivery has been recently
- whether failures are increasing
- whether rollbacks are increasing
- which [[DXCP Core Vocabulary#Deployment Strategy|Deployment Strategies]] are being used
- which [[DXCP Core Vocabulary#Deployment Group|Deployment Groups]] need attention
- where to drill into operational detail next

Insights is not a generic dashboard.

It is an operational summary surface that routes users toward [[Application Screen]] and [[Deployment Detail Screen]] for deeper investigation.

---

## Relationship to Other Screens

The Insights screen complements other DXCP views.

- [[Application Screen]] is the primary operational workspace for a single application
- [[Deployment Detail Screen]] is the investigation view for a single deployment
- [[Deployment Timeline]] defines the normalized story model for deployment behavior
- [[Deploy Workflow]] defines how deployment actions are started

Insights should summarize recent system behavior without replacing object-focused screens.

---

## Core UX stance

Insights should feel like DXCP.

It is:

- operational
- object-aware
- trend-aware
- drill-down oriented

It is not:

- a generic DevOps dashboard
- an executive reporting page
- a data-table-first analytics screen

The page should help users answer:

1. is delivery health changing
2. what is driving the change
3. where should I open next

---

## Default time model

The Insights screen uses a page-level time range selector.

Default:

```text
Last 7 days
```

Supported presets:

```text
Last 24 hours
Last 7 days
Last 30 days
```

Rules:

- the selected time range applies to the entire screen
- all summaries and sections update together
- the default range should feel operational, not historical

---

## Page structure

```text
----------------------------------------------------
Alert Rail
----------------------------------------------------

Insights                               Time Range

----------------------------------------------------

Delivery Health
Failure Trend
Rollbacks
Deployment Strategies
Deployment Groups Needing Attention
Recent Notable Activity
```

The page should follow the DXCP layout rules:

- bounded content width
- stable page header
- consistent section cards
- strong vertical reading order
- summary-first section density

---

## Delivery Health

The top of the page provides a compact operational summary.

Example:

```text
Delivery Health

Deployments: 84      up from previous period
Failures: 9          down from previous period
Rollbacks: 3         up from previous period
```

Rules:

- use only a small number of summary signals
- keep language operational and plain
- avoid turning the page into a KPI wall

These summaries help users decide which section deserves attention first.
They should stay compact enough that the page still feels like one operational read, not a KPI grid.

---

## Failure Trend

The Failure Trend section shows whether failure activity is increasing or decreasing.

Example:

```text
Failure Trend

Recent failures are increasing compared with the previous 7-day period.
```

It should also show a category breakdown.

Example:

```text
POLICY            2
CONFIG            4
INFRASTRUCTURE    3
```

Rules:

- show trend first, categories second
- emphasize scanability over chart density
- support drill-down to related [[Deployment Detail Screen]] views

This section helps users answer:

```text
Are failures increasing, and what kind are they?
```

---

## Rollbacks

The Rollbacks section highlights recent rollback activity.

Example:

```text
Rollbacks

3 rollbacks in the selected time range
Higher than the previous 7-day period
```

Recent rollback items may be shown below the summary in a short bounded list.

Example:

```text
payments-api     production    2 hours ago
billing-worker   staging       yesterday
```

Rules:

- show rollback activity as an operational signal
- support drill-down to [[Deployment Detail Screen]]
- avoid presenting rollback rate as abstract analytics

This section helps users answer:

```text
Are rollbacks increasing, and where are they happening?
```

---

## Deployment Strategies

This section shows how recent deployments are distributed across approved deployment strategies.

Example:

```text
Deployment Strategies

Blue-Green    42
Rolling       31
Canary        11
```

Rules:

- emphasize comparison and scanability
- keep the section tied to recent deployment activity
- support drill-down into related deployments

This section helps users answer:

```text
Which deployment strategies are being used recently?
```

---

## Deployment Groups Needing Attention

This section surfaces deployment groups whose recent activity suggests investigation is needed.

Each item should summarize:

- deployment count
- failure count
- rollback count
- a short attention cue

Example:

```text
Deployment Group: payments
Deployments: 18
Failures: 4
Rollbacks: 2
Attention: rollback activity increased
```

Rules:

- rank groups by operational attention, not alphabetically
- keep summaries concise
- support drill-down toward the relevant [[Application Screen]] or related deployment investigation path

This section helps users answer:

```text
Which deployment groups need attention?
```

---

## Recent Notable Activity

This section provides a compact list of recent events worth opening next.
It should remain a short queue of notable items rather than a raw chronological feed.

Examples:

```text
Rollback completed for payments-api in production
Failure observed for billing-worker in staging
Deployment succeeded for web-frontend after prior failure
```

Rules:

- each item should read like an operational statement
- items should open the relevant [[Deployment Detail Screen]]
- the list should feel like guided investigation, not a raw event stream

---

## Drill-down model

Insights should never be a dead end.

Expected drill-down paths:

- failure item -> [[Deployment Detail Screen]]
- rollback item -> [[Deployment Detail Screen]]
- strategy segment -> related deployment investigation path
- deployment group item -> related [[Application Screen]] context
- notable activity item -> [[Deployment Detail Screen]]

Insights summarizes the system, but detail lives in object screens.

Shared state behavior should remain consistent with [[Interaction Patterns]].

---

## Role behavior

### OBSERVER

Can:

- view all allowed Insights content
- open applications and deployments

Cannot:

- deploy from Insights

### DELIVERY_OWNER

Can:

- view Insights
- use it to identify where to investigate next

Deployment actions should occur only after entering [[Application Screen]].

### PLATFORM_ADMIN

Can additionally see:

- broader system scope
- richer diagnostics when appropriate

Admin detail must remain secondary to the main operational story.

---

## Loading and unavailable states

### Loading current scope

When Insights is loading a time window or refreshed scope:

- preserve the page header and main section structure
- use placeholders for summary blocks and trend sections
- avoid a spinner-only replacement for the full page

### Read failure

If Insights data cannot be loaded:

- explain the page-level problem in the alert rail
- keep the current scope visible
- allow retry from the standard page action area

---

## Empty and sparse-data states

### No recent delivery activity

```text
No deployments in this time range.
```

### Sparse activity

```text
Delivery activity is limited in this time range.
Trend comparisons may be less meaningful.
```

### No recent failures

```text
No recent failures.
```

### No recent rollbacks

```text
No recent rollbacks.
```

Rules:

- empty states should remain calm and informative
- do not overstate confidence when activity is low
- keep language operational and neutral
- distinguish no activity from no results caused by the current filters or time range

---

## Anti-patterns to avoid

The Insights screen should avoid:

- generic dashboard styling
- too many KPI cards
- large dense tables as the primary view
- charts without drill-down value
- engine terminology
- action-heavy workflow controls
- long-scroll event feeds pretending to be insight

Insights should support investigation, not distract from it.

---

## Summary

The Insights screen gives DXCP a system-level operational summary without abandoning object-first UX.

It provides:

- recent delivery health
- failure trend visibility
- rollback visibility
- deployment strategy distribution
- deployment group attention signals
- clear drill-down paths into object detail

This keeps DXCP observability aligned with the rest of the product:
understand the system, then open the right object.

## Related

- [[DXCP UX Grammar]]
- [[DXCP Core Vocabulary]]
- [[DXCP Information Architecture]]
- [[DXCP Layout Behavior]]
- [[Application Screen]]
- [[Deployment Screen]]
- [[Deployment Detail Screen]]
- [[Deployment Timeline]]
- [[Deploy Workflow]]
- [[Decision Deployment detail screens are timeline-centric]]