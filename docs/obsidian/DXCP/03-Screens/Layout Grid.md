# Layout Grid

## Confirmed Existing Notes Relevant to This Session

- [[DXCP UX Grammar]]
- [[DXCP Core Vocabulary]]
- [[DXCP Information Architecture]]
- [[DXCP Layout Behavior]]
- [[UX-Principles]]
- [[Application Screen]]
- [[Deployment Screen]]
- [[Deployment Detail Screen]]
- [[Deploy Workflow]]
- [[Deployment Timeline]]
- [[Decision Deployment detail screens are timeline-centric]]

## Purpose

Define the final layout grid and page structure rules for DXCP so all major
screens share a stable spatial contract.

This note turns the high-level rules from [[DXCP Layout Behavior]],
[[DXCP Information Architecture]], and [[UX-Principles]] into a concrete
layout system that can be applied consistently across screen types.

DXCP is an intent-first control plane. Layout should reinforce that by making
object identity, action placement, policy visibility, and supporting context
predictable from page to page.

The layout grid must also protect DXCP from common enterprise UX failure modes:
vertical sprawl, overloaded side panels, mixed information levels, and history
that turns pages into long-scroll archives.

---

## Layout Grid Principles

### 1. One spatial story across DXCP

Every major DXCP page should follow the same top-to-bottom structure:

1. Top Navigation
2. Alert Rail (only when needed)
3. Page Header
4. Main content grid

This keeps the product readable and reduces page-by-page layout drift.

### 2. Wide screens add margin, not meaning

Larger viewports should provide breathing room, not a different layout model.

More width must not change:
- where the user looks first
- where the primary action appears
- where supporting context lives
- where warnings and blocked states are explained

### 3. The header owns object identity

The [[DXCP UX Grammar]] defines the page header as the place where the current
object is named and the primary action appears.

Examples:
- `Application: payments-api`
- `Deployment 9831`

The header should never be replaced by a card buried in page content.

### 4. The alert rail is the shared place for page-level messages

The Alert Rail is the one consistent location for:
- blocked actions
- system warnings
- validation summaries
- temporary page-level notices

It should not be reinvented per screen.

### 5. The primary column tells the main story

The primary column contains the operational or investigative story of the page.

Examples:
- recent deployment activity on [[Application Screen]]
- deployment investigation on [[Deployment Detail Screen]]
- deploy form editing in [[Deploy Workflow]]

### 6. The secondary column holds durable supporting context

The secondary column contains context that improves decisions while the user
works through the primary story.

Examples:
- guardrails
- deployment group context
- allowed strategies
- environment context
- compact summary cards

This column supports the task. It should not compete with the main narrative.

### 7. The layout must resist vertical sprawl

A clean grid is not enough if page content grows into a long stack of cards,
tables, filters, logs, and explanations.

DXCP pages should show the current decision-relevant story first and defer
lower-priority material through progressive disclosure.

Preferred mechanisms:
- section collapse
- tabbed modes when content types are distinct
- "View all" transitions
- dedicated drill-in views
- explicit history views instead of endlessly extending the main page

The goal is to let users understand the current situation without excessive
scrolling.

### 8. History should be summarized first, browsed second

Historical information should not dominate the default layout.

DXCP should prefer:
- recent activity windows
- compact summaries
- scoped history controls
- drill-in archive views

The default page should answer what matters now.
Historical depth should remain available, but not forced into the main reading
path.

### 9. Each page should stay at one information altitude

DXCP pages should avoid mixing too many levels of information at once.

Preferred altitude types:
- overview: what is happening
- object detail: what happened to this application or deployment
- action: what the user is about to do
- admin configuration: what controls system behavior

Each page may reference adjacent levels, but should clearly center one of them.
This keeps the UI intuitive and reduces "What is this?" moments.

### 10. Premium UX comes from subtraction

The layout should support calm, high-confidence usage.

This means:
- fewer always-visible sections
- fewer competing status treatments
- fewer boxes and visual containers than a typical enterprise UI
- fewer explanations unless the context truly needs one
- stronger defaults and clearer placement

The grid should make restraint easier, not encourage fill-in-the-space design.

---

## Layout Contract

### Content container

DXCP page content should live inside a bounded container.

Rules:
- Max width: `1280px`
- Default horizontal page padding: `24px`
- Wider screens may use `32px` outer padding
- Narrow desktop widths may reduce to `16px`

The bounded container keeps the UI calm, readable, and consistent with
the layout stance described in [[UX-Principles]].

### Main grid

Default desktop content grid:

- Primary column: `8`
- Secondary column: `4`

Interpretation:
- Primary column is visually dominant
- Secondary column is clearly subordinate but still useful

Default gap:
- `24px`

### Vertical rhythm

Use a stable spacing scale across pages.

Recommended rhythm:
- `24px` between major sections
- `16px` between stacked items within a section
- `12px` between dense metadata rows
- `20px` internal padding for standard cards
- `24px` internal padding for hero or workflow cards

This rhythm should make DXCP feel like one product rather than a set of
independently designed screens.

### Content density rule

The spacing system should support a lighter, more premium feel rather than a
dense dashboard wall.

Rules:
- do not stack many equal-weight cards in a long vertical chain
- avoid creating sections that exist only because there is room
- prefer fewer, stronger sections with clear hierarchy
- use whitespace to clarify importance, not to decorate emptiness

---

## Layout Regions

### Top Navigation

Behavior remains as defined in [[DXCP Layout Behavior]]:
- fixed
- always visible
- stable height

### Alert Rail

Placement:
- below Top Navigation
- above Page Header
- inside the bounded content area

Behavior:
- scrolls with page content
- appears only when needed
- stacks vertically when multiple alerts exist

Rules:
- reserved for page-level conditions
- should not become a second header
- should not contain routine informational noise

### Page Header

Placement:
- directly below Alert Rail when alerts are present
- directly below Top Navigation offset when no alerts exist

Rules:
- contains page identity
- contains the single primary action when applicable
- may include a small number of secondary actions
- scrolls with page content

Spacing:
- `16px` from Alert Rail to header
- `24px` from header to main grid

### Primary Content Column

Rules:
- contains the main operational or investigative content
- first section should answer the page's primary question above the fold
- sections stack vertically
- should visually dominate the page

Additional rules:
- the first screenful should establish meaning quickly
- lower-priority sections should be deferred or condensed
- the page should not require long scrolling just to understand the current state

### Secondary Context Column

Rules:
- contains supporting context that benefits from visibility while scrolling
- sticky within viewport on desktop layouts
- should not become a dumping ground for unrelated metadata
- should be omitted when it does not improve task performance

Additional rules:
- keep the number of stacked cards low
- prefer compact, durable context over verbose explanation
- if content is not relevant across most of the page, it should not live here
- a sparse secondary rail is preferable to a complete but bulky one

---

## Screen-Type Layout Rules

## List pages

Examples:
- Applications
- Deployments
- Insights collection views

Rules:
- default to a single dominant primary column
- use a secondary column only when persistent context materially helps
- place filters below the header or at the top of the primary content area
- keep collection empty states inside the list region

The list itself is the primary story.

Additional rules:
- avoid turning list pages into combined overview, analytics, and archive screens
- keep summary metrics small in number and tightly related to list interpretation
- long history should be handled through scope controls, pagination, or archive access

## Detail pages

Examples:
- [[Application Screen]]
- [[Deployment Screen]]
- [[Deployment Detail Screen]]

Rules:
- default to the `8 / 4` grid
- keep identity and primary action in the header
- use the primary column for the object story
- use the secondary column for persistent context and explanation

The user should be able to predict where to look for:
- main timeline or activity
- current summary
- policy or environment context

Additional rules:
- detail pages should show the current object story, not become history archives
- historical depth should be structured into scoped sections, tabs, or linked views
- above-the-fold content should answer the most important operational question first

## Workflow pages

Example:
- [[Deploy Workflow]]

Rules:
- use the `8 / 4` grid as the standard workflow layout
- place form content in the primary column
- place policy and supporting decision context in the secondary column
- use the Alert Rail for blocked or page-level validation messages
- keep field-level help close to fields

Workflow pages must keep policy visible at the moment of choice.

Additional rules:
- workflows should avoid long uninterrupted forms when possible
- group steps by decision intent
- keep explanation minimal and contextual
- do not place large historical content blocks on workflow pages

## Admin pages

Admin is a confirmed navigation section in [[DXCP UX Grammar]] and
[[DXCP Information Architecture]].

Rules:
- use the same page structure as the rest of DXCP
- index views may use a single-column list layout
- edit/detail views should use the `8 / 4` grid when persistent warnings,
  explanation, or impact context are needed
- warnings and blocked changes belong in the Alert Rail
- admin-specific depth should not break the global layout contract

Admin work should feel structurally familiar even when the content is
different from developer-facing screens.

Additional rules:
- do not expose every system concept at once
- configuration pages should center one change context at a time
- use impact explanation sparingly and where it changes decision quality

---

## Overview versus history rules

### Default page stance

Default screens should emphasize:
- current status
- recent activity
- active issues
- next actions

### Historical depth

Historical depth should be available through:
- time-scope controls
- paginated or explicitly loaded tables
- archive or history views
- search and filter patterns where relevant

### Anti-archive rule

No primary DXCP page should become an unbounded scroll surface for historical
records.

A year of deployments should be reachable, but not rendered as one continuous
page.

### Recommended history pattern

For deployment-heavy objects, prefer this order:

1. current state
2. recent activity
3. exceptions or failures
4. intentionally accessed history

This keeps the page useful in the present while preserving auditability.

---

## Sticky and Scrolling Rules

### Fixed
- Top Navigation

### Scroll with page content
- Alert Rail
- Page Header
- Primary content

### Sticky within viewport
- Secondary Context Column on desktop detail and workflow pages

### Disable sticky behavior when
- the layout collapses to a single column
- viewport height is too small to make stickiness useful
- the secondary panel becomes taller than the available viewport in a way
  that harms readability

### Scrolling discipline

Rules:
- do not rely on page height as the primary organization model
- prefer information reduction before adding more scrolling
- use scrolling for reading depth, not for basic comprehension
- the user should understand where they are and what matters before deep scroll

---

## Responsive Behavior

### Very wide screens

Rules:
- keep the content container capped at `1280px`
- add outer whitespace only
- do not stretch reading lines excessively
- do not increase the distance between primary and secondary content

### Standard desktop

Rules:
- use the default two-column layout for detail, workflow, and qualifying
  admin pages
- maintain the standard `24px` column gap

### Narrow desktop and tablet

Rules:
- collapse to a single-column layout when the secondary column becomes cramped
- move critical support context below the header and before lower-priority
  primary sections when needed
- preserve the same content order and meaning

### Small screens

Rules:
- keep the page order predictable:
  1. Alert Rail
  2. Page Header
  3. Primary content
  4. Supporting context
- disable sticky side behavior
- preserve one clear primary action in the header region

### Responsive priority rule

Responsive collapse should preserve meaning, not just fit.

When content collapses:
- primary story remains first
- warnings remain obvious
- supporting context remains secondary
- historical depth remains deferred

---

## Empty and Loading States

### Empty states

Rules:
- place empty states in the content region they belong to
- collection empty states go in the list area
- detail empty states go in the primary content area below the header
- supporting guidance may appear in the secondary column, but the main message
  belongs in the primary column

### Loading states

Rules:
- preserve the final page skeleton while loading
- render header placeholders in the real header zone
- render primary placeholders in the primary column
- render secondary placeholders in the secondary column when applicable

Avoid replacing stable page structure with a full-screen spinner unless the
route itself has not resolved.

### State clarity rule

Loading and empty states should make the page immediately understandable.

Users should not have to infer:
- what object they are on
- what area is loading
- whether something is empty, unavailable, or blocked

---

## Comprehension Rules

DXCP layout should reduce the chance that users ask "What is this?"

Rules:
- use stable placement for identity, status, action, warning, and history
- keep each page centered on one dominant question
- avoid backend or engine-facing nouns in surface layout labels
- prefer immediate meaning through placement and hierarchy over heavy tooltip use
- do not introduce a new visual region unless it removes confusion

The product should feel learnable through repetition, not explanation density.

---

## Spatial Story

DXCP layout should make the product feel predictable.

Users should always know:

- where object identity lives: Page Header
- where page-level warnings live: Alert Rail
- where the main story lives: Primary Content Column
- where supporting context lives: Secondary Context Column
- that more screen width adds calm, not layout drift

This is the core spatial contract of DXCP.

---

## Consequences for screen design

This layout contract should guide future screen work:

- [[Application Screen]] should keep recent activity and operational story in
  the primary column
- [[Deployment Detail Screen]] should keep timeline investigation primary
- [[Deploy Workflow]] should keep editing primary and policy context secondary
- any future Admin screen should follow the same regional structure
- history-heavy pages should separate present understanding from long-range
  archive access
- secondary rails should remain selective and compact

This note complements [[DXCP Layout Behavior]] by defining concrete grid,
spacing, anti-sprawl rules, and screen-type layout guidance.