# Screen Spec - Insights

## Purpose

Define the concrete UI screen specification for the [[Insights Screen]] as the system-level delivery observability surface in DXCP.

This screen helps users understand recent delivery health across the system, identify what deserves attention, and move into the right object-level screen without turning DXCP into a bulky dashboard wall.

This screen preserves confirmed implemented product capability from [[Product Behavior Alignment]] while explicitly refusing to inherit the current bad UI’s list-of-metrics density, loose grouping, and generic analytics posture.

---

## Dominant User Question

How is delivery health changing across DXCP, what is driving it, and where should I open next?

Secondary questions:

- Are failures increasing or stabilizing?
- Are rollbacks becoming more common?
- Which [[DXCP Core Vocabulary#Deployment Group|Deployment Groups]] or [[DXCP Core Vocabulary#Deployment Strategy|Deployment Strategies]] deserve attention?
- Is the issue system-wide or concentrated in a filtered slice?
- What is the best drill-down path into object-level investigation?

---

## Why This Screen Exists

The [[Insights Screen]] exists because DXCP needs one restrained system-wide observability surface that summarizes delivery behavior without replacing object ownership.

[[Product Behavior Alignment]] confirms that the implemented product already supports meaningful insights capability:
- rollback rate
- failure category breakdown
- deployments by strategy
- deployments by deployment group
- time-window filtering
- application and deployment-group filtering

Those capabilities are real and remain part of DXCP. What changes is the composition and hierarchy.

This screen is not:
- a default landing dashboard
- a metrics warehouse
- a long-scroll analytics wall
- a replacement for [[Application Screen]]
- a replacement for [[Deployment Detail Screen]]

This screen exists to answer system-level questions first, then hand the user into the correct object surface.

---

## Relationship to Other Screens and Flows

This screen must remain aligned with:
- [[Insights Screen]]
- [[Application Screen]]
- [[Deployment Screen]]
- [[Deployment Detail Screen]]
- [[Deployment Timeline]]
- [[Deploy Workflow]]
- [[Shared UI Patterns]]
- [[DXCP Layout Behavior]]
- [[Layout Grid]]
- [[Failure UX]]
- [[Product Behavior Alignment]]

Ownership boundaries:

- [[Insights Screen]] owns system-level delivery observability
- [[Application Screen]] owns present-tense operational understanding for one application
- [[Deployment Screen]] owns browsing a collection of deployments
- [[Deployment Detail Screen]] owns investigation of one deployment
- [[Deploy Workflow]] owns intent submission

Insights may point to these surfaces, but must not absorb their responsibilities.

---

## Page Header

Header title:

`Insights`

Header controls on the right:

- Time window selector
- Scope filter entry point
- Refresh

Header rules:

- The header remains calm and sparse
- Time window is page-level, not per-card
- Scope filters affect the entire screen, not isolated regions
- Refresh is a page action, not embedded inside individual sections

No deploy action belongs here.

---

## Dominant Page Composition

The page follows the shared DXCP layout contract:

1. Top Navigation
2. Alert Rail when needed
3. Page Header
4. Main content stack inside the bounded content container

Insights uses a single dominant content column by default.

A secondary rail is not the default structure for this screen because the main task is reading trend and breakdown relationships, not consulting durable side context. If supporting explanatory context is needed, it should appear as compact inline framing near the relevant section or through progressive disclosure.

Default section order:

1. Summary strip
2. Trend section
3. Breakdown section
4. Attention section
5. Drill-down destinations

The screen must feel like one guided operational read, not a card marketplace.

---

## Default View

### Opening hierarchy

The default view should answer three things quickly:

1. Is delivery health changing?
2. What is driving the change?
3. Where should I investigate next?

### Default time and scope

Default time window:
- Last 7 days

Default scope:
- All visible applications
- All visible deployment groups
- Current environment scope as defined by the product

The page opens system-wide first, then narrows only when the user applies scope filters.

### Default section model

#### 1. Summary strip

A restrained horizontal summary strip appears first.

It contains only the smallest set of signals needed to orient the user:

- Deployments
- Failures
- Rollbacks

Each signal includes:
- current count in selected window
- directional comparison against previous equivalent window
- plain-language framing, not KPI theater

This section is intentionally small.
It preserves implemented trend capability but does not become a tile wall.

#### 2. Trend section

This is the dominant section of the screen.

It answers:
- is delivery health improving or degrading over time

Default content:
- failure trend over the selected time window
- rollback trend over the selected time window

Rules:
- show trend as the main story, not as decoration
- keep the number of simultaneous trend views small
- prefer one clear timeline-oriented visual treatment per metric rather than multiple competing mini-charts
- use shared status and anomaly emphasis patterns consistently

#### 3. Breakdown section

This section explains what is driving the trend.

Default content:
- failures by category
- deployments by deployment strategy
- deployments by deployment group

Rules:
- these are grouped as explanatory breakdowns, not independent dashboard widgets
- the section should read as “what is behind the change” rather than “more things to scan”
- each breakdown supports a drill-down path

#### 4. Attention section

This section identifies notable concentrations or anomalies that deserve inspection.

Examples:
- deployment group with unusually elevated failures
- deployment strategy with increased rollback share
- filtered slice with unusually low successful completion rate

Rules:
- keep this section short
- show only issues that change operator attention
- avoid simulating an alert feed
- do not duplicate the alert rail
- do not present raw anomaly scores without explanation

#### 5. Drill-down destinations

The bottom of the default view provides the strongest object-level paths:
- open related [[Application Screen]]
- open filtered [[Deployment Screen]]
- open specific [[Deployment Detail Screen]] when a breakdown or notable point maps directly to a deployment story

Insights should always end in a next move.

---

## Major Regions

## Region 1: Summary Strip

### User question it answers

What is the overall shape of delivery health in this window?

### Implemented capability it preserves

- system-wide insights
- rollback rate
- time-window filtering

### Why it belongs in the default view

Users need a compact orientation before reading deeper trend and breakdown material.

### Alignment

- Uses [[DXCP Core Vocabulary]] language
- Follows restraint rules from [[Shared UI Patterns]]
- Supports the summary-first posture required by [[Product Behavior Alignment]]

### Composition rules

- One row
- Three primary signals maximum
- No dense sub-metrics
- No independent card actions
- No executive-style color saturation

---

## Region 2: Trend Section

### User question it answers

Is the system getting healthier or less healthy over time?

### Implemented capability it preserves

- system-wide insights
- rollback rate
- time-window filtering

### Why it belongs in the default view

Trend is the main observability question for this screen. It is more important than raw categorical breakdowns because it tells the user whether something is changing.

### Alignment

- Aligns to [[Insights Screen]] ownership
- Keeps the screen observability-focused rather than collection-focused
- Uses the calm explanatory posture established across [[Screen Spec - Application]] and [[Screen Spec - Deployment Detail]]

### Composition rules

- Trend appears before breakdown
- Trend is readable at a glance
- Trend uses one consistent axis/time interpretation across the screen
- Trend never competes with multiple unrelated summaries above it

---

## Region 3: Breakdown Section

### User question it answers

What is driving the trend I am seeing?

### Implemented capability it preserves

- failure category breakdown
- deployments by strategy
- deployments by deployment group

### Why it belongs in the default view

These are part of the confirmed implemented insights surface and are necessary to convert abstract trend into diagnosis direction.

### Alignment

- Uses [[DXCP Core Vocabulary#Deployment Strategy|Deployment Strategy]] and [[DXCP Core Vocabulary#Deployment Group|Deployment Group]] as user-facing nouns
- Preserves real product capability while reshaping old presentation
- Keeps ownership clear by stopping at explanation and routing out to object views for actual investigation

### Composition rules

- Treat as one explanatory family of sections
- Use consistent section rhythm and sizing
- Each breakdown row or segment must expose a clear drill-down affordance
- Do not overfill with secondary metrics or legends that weaken comprehension

---

## Region 4: Attention Section

### User question it answers

What specifically deserves my attention right now?

### Implemented capability it preserves

This region does not introduce new backend capability. It is a presentation rule that uses already implemented summary, trend, and breakdown data to emphasize meaningful concentrations.

### Why it belongs in the default view

Without an attention layer, the user has to manually interpret all changes. A restrained attention section improves scan efficiency while preserving calmness.

### Alignment

- Must follow [[Failure UX]] principles of clear explanation without theatrics
- Must not turn into alert fatigue or pseudo-monitoring
- Must not displace the alert rail for actual page-level read failures or blocked states

### Composition rules

- Show only a small number of notable items
- Each item states what changed and why it matters
- Each item links to a scoped destination
- No persistent badge storms
- No animated urgency language

---

## Region 5: Drill-down Destinations

### User question it answers

Where do I go next to investigate properly?

### Implemented capability it preserves

- application filtering
- deployment-group filtering
- opening deployment and application-level surfaces

### Why it belongs in the default view

Insights without next-step ownership becomes a dead end. DXCP requires observability to lead into action or investigation.

### Alignment

- [[Application Screen]] for object-level operational understanding
- [[Deployment Screen]] for scoped browsing
- [[Deployment Detail Screen]] for narrative investigation of one deployment

### Composition rules

- Every trend or breakdown region should support a next-step path
- Drill-down labels use DXCP grammar: Open, View, Inspect
- Routing should preserve current time window and scope where it is helpful

---

## System-wide Versus Filtered Scope

Insights opens system-wide by default.

Supported filters:
- Application
- Deployment Group
- Deployment Strategy
- Outcome or failure-oriented narrowing when supported by the product model
- Time window

Rules:

- Filters apply to the whole screen
- Filters must be visible as active scope once applied
- Filters must never fracture the page into competing local scopes
- Reset to system-wide scope must be obvious
- Filtered scope should feel like narrowing the observability lens, not changing the screen into a different product

Behavioral stance:

- System-wide scope answers “how is DXCP behaving overall”
- Filtered scope answers “is the problem concentrated somewhere specific”

Filtered Insights must still remain an Insights surface, not a replacement for the [[Application Screen]].

---

## Trend Versus Breakdown Hierarchy

The hierarchy is strict:

1. Summary orientation
2. Trend
3. Breakdown
4. Attention
5. Drill-down

Rationale:

- Summary tells the user where to look
- Trend tells the user whether health is changing
- Breakdown explains what is contributing
- Attention highlights what merits action
- Drill-down routes into owned object screens

What is intentionally not allowed:

- starting with multiple equal-weight charts
- promoting all breakdowns to the same importance as trend
- placing a large card grid above the trend
- showing more summary than explanation

This is the main anti-dashboard rule for the screen.

---

## Default Insight Versus Progressive Disclosure

### Default view includes

- summary strip
- failure trend
- rollback trend
- failures by category
- deployments by deployment strategy
- deployments by deployment group
- compact attention list
- drill-down paths

### Progressive disclosure includes

- deeper breakdown detail
- methodology or comparison explanation
- lower-priority historical context
- expanded legends or definitions
- admin-only diagnostic context if ever applicable
- raw data export or audit-style detail if later introduced

Rules:

- the default view contains only decision-relevant signals
- progressive disclosure reveals more detail, not more clutter
- disclosures should open inline, in drawers, or in scoped destination screens rather than extending the page into an archive wall

---

## Anomaly and Attention Treatment

Attention handling must be informative, not theatrical.

Rules:

- Use attention emphasis only when a change is meaningful relative to recent baseline or current scope
- Phrase anomalies in operational language
- Explain why the item surfaced
- Prefer “Elevated rollback share in Payments applications” over abstract analytics phrasing
- Never present flashing urgency or alarm-heavy color use
- Do not surface a high volume of minor anomalies

Attention items should help the user choose where to look next, not imply that Insights is an alert console.

---

## Time Window and Scope Filter Behavior

### Time window

Supported presets:
- Last 24 hours
- Last 7 days
- Last 30 days

Rules:
- one shared time window for the whole screen
- changing time window updates every region together
- comparison framing uses the immediately preceding equivalent period
- the selected window persists across drill-down when useful and safe

### Scope filters

Rules:
- filters sit at page level
- selected filters remain visible after application
- filters must be removable individually
- the screen must not silently retain stale filters across unrelated entry paths
- filter complexity should remain restrained; the user should not need a query-builder mindset to use Insights

---

## Drill-down Behavior

Drill-down paths must be strong, specific, and predictable.

### From summary strip

- View matching [[Deployment Screen]] slice

### From failure trend

- View filtered [[Deployment Screen]] focused on failed deployments in the selected period

### From rollback trend

- View filtered [[Deployment Screen]] focused on rollback deployments in the selected period

### From failure category breakdown

- View filtered [[Deployment Screen]] for deployments with matching failure category
- Open relevant [[Application Screen]] when the category concentration is application-led

### From deployment strategy breakdown

- View filtered [[Deployment Screen]]
- Open related [[Application Screen]] when the user wants object-level operational context

### From deployment group breakdown

- View filtered [[Deployment Screen]]
- Open relevant [[Application Screen]] collection context where supported

### From attention items

- Open the most specific useful destination:
  - [[Application Screen]]
  - [[Deployment Screen]]
  - [[Deployment Detail Screen]]

Rules:

- preserve selected time window on drill-down
- preserve active scope when it improves continuity
- avoid dead-end modal previews for destinations that deserve full screen context
- do not route users into admin surfaces from Insights by default

---

## States

## Loading

When Insights is loading:
- preserve page header and filter chrome
- preserve section skeleton structure
- avoid replacing the whole page with a spinner
- keep the spatial story stable

## Empty

If there is truly no delivery activity in the selected scope and window:
- explain that no deployments occurred
- suggest widening the time window or clearing filters
- do not show decorative empty-state treatment

## No results

If data exists generally but not for the selected filter combination:
- say that no results match the current filters
- show the active filters clearly
- provide a fast reset path

## Read failure

If the page cannot load insights:
- use the Alert Rail
- explain that Insights could not be loaded
- allow retry from the page header
- avoid hiding the entire page frame

## Degraded read

If some regions load but one or more regions fail:
- keep successful regions visible
- mark failed regions inline with clear read-failure treatment
- do not collapse the whole page into an error state
- explain which section could not be loaded

## Permission-limited

If the user can read Insights but some scoped data is not available:
- show the allowed data normally
- explain the restricted scope in calm product language
- do not imply system failure

This screen should remain usable under partial visibility.

---

## Responsive Behavior

## Wide desktop

- Use the full bounded container
- Keep one clear vertical reading order
- Summary may render as a compact horizontal strip
- Breakdown sections may use a balanced two-up arrangement only when doing so does not weaken order or readability

## Narrow desktop

- Keep the same section order
- Compress summary spacing, not meaning
- Stack breakdown regions earlier if horizontal density becomes tight

## Tablet or constrained layout

- Stack all regions vertically
- Keep filters and time controls accessible at the top
- Preserve trend before breakdown
- Preserve drill-down affordances without forcing horizontal scrolling

## Small-screen rule

Insights is not optimized as a mobile-first dashboard.
On constrained layouts it should simplify into a single readable vertical flow, not miniaturize chart density into cramped cards.

Across all widths:
- wider screens add breathing room, not new meaning
- the screen must keep the same spatial story

---

## Role Awareness

Insights is read-focused.

Expected role posture:
- delivery owners can read the surface within their permitted visibility rules
- observers can read the surface
- platform admins can read the surface and may see additional diagnostic routes elsewhere in the product, but Insights itself should not become an admin diagnostics page

No mutating action originates here.

Blocked or limited visibility must be explained clearly without changing the fundamental shape of the page.

---

## Preserved Implemented Capability

This screen explicitly preserves the following confirmed capabilities from [[Product Behavior Alignment]]:

- system-wide insights
- rollback rate
- failure category breakdown
- deployments by deployment strategy
- deployments by deployment group
- time-window filtering
- application and deployment-group filtering
- compact analytics posture as a starting point for restrained observability

---

## Intentionally Not Inherited

This screen intentionally does **not** inherit the following old UI structures:

- a generic dashboard wall of equal-weight cards
- list-of-metrics bulk treatment
- loose grouping that hides the main observability story
- dense multi-widget scanning as the default user task
- screen composition that feels more like reporting than operational understanding
- any structure that makes Insights compete with [[Application Screen]] or [[Deployment Detail Screen]] for object ownership

---

## Evaluation by Region Summary

### Summary strip
- Answers: what is the overall health shape
- Preserves: rollback rate, time-windowed system summary
- Default or disclosure: default, because orientation is required
- Alignment: restrained summary pattern, DXCP vocabulary only

### Trend section
- Answers: is health changing over time
- Preserves: trend-aware system insights
- Default or disclosure: default, because it is the primary question of the screen
- Alignment: observability-first, not dashboard-first

### Breakdown section
- Answers: what is driving the change
- Preserves: failures by category, deployments by strategy, deployments by deployment group
- Default or disclosure: default, because explanation is necessary after trend
- Alignment: uses Deployment Strategy and Deployment Group as user-facing nouns

### Attention section
- Answers: what deserves attention now
- Preserves: interpretation of confirmed implemented metrics without adding new backend dependency
- Default or disclosure: default, but tightly restrained
- Alignment: follows [[Failure UX]] tone and avoids alert fatigue

### Drill-down destinations
- Answers: where should I investigate next
- Preserves: object-level navigation into existing surfaces
- Default or disclosure: default, because Insights must not be a dead end
- Alignment: preserves clean ownership of [[Application Screen]], [[Deployment Screen]], and [[Deployment Detail Screen]]

---

## Design Notes

This screen should feel calm, purposeful, and investigative.

The user should leave with:
- a quick understanding of whether delivery health changed
- a clear idea of what is driving the change
- an obvious next destination for deeper work

If the page ever begins to feel like a dashboard wall, the screen has drifted out of DXCP alignment.