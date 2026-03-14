# Shared UI Patterns

## Purpose

This note defines the shared UI building blocks and repeated composition patterns used across DXCP.

The goal is to keep future screen specs consistent, restrained, and implementation-ready without turning DXCP into a generic enterprise dashboard.

This note builds on:
- [[DXCP Vision]]
- [[DXCP Core Vocabulary]]
- [[DXCP Object Model]]
- [[DXCP UX Grammar]]
- [[DXCP Information Architecture]]
- [[DXCP Layout Behavior]]
- [[Interaction Patterns]]
- [[Application Screen]]
- [[Deployment Detail Screen]]
- [[Deployment Screen]]
- [[Deployment Timeline]]
- [[Insights Screen]]
- [[Deploy Workflow]]
- [[Admin Screen]]

---

## Shared UI Pattern Principles

### 1. One product, one spatial story

DXCP should feel like the same product across all screens.

The user should be able to predict:
- where the page title lives
- where the main action lives
- where alerts appear
- where supporting policy context lives
- where deeper history begins

Layout changes should not change the meaning of the page.

### 2. Current understanding before archive depth

Default screen shape should emphasize:
- present state
- recent meaningful activity
- active issues
- next actions

Historical depth must remain available, but should not dominate the default page.

This keeps DXCP aligned with [[Decision History is never the default page shape]].

### 3. Primary task first, supporting context second

DXCP screens should make one thing visually dominant.

The main operational task belongs in the primary column.

Supporting governance, metadata, and secondary explanation belong in the secondary context column when present.

### 4. Explainability is a pattern, not a special case

Policy blocks, failures, read errors, and warnings should use a shared treatment model.

DXCP should not invent a different explanation surface on every screen.

### 5. Small pattern set, many reuses

DXCP should use a limited set of repeated patterns rather than bespoke screen compositions.

This improves:
- learnability
- implementation consistency
- visual calm
- mockup readiness

### 6. Restraint is part of the system

Every pattern should support high-signal operation with low visual bulk.

That means:
- short headers
- limited badge vocabulary
- compact summaries
- selective context rails
- deliberate use of tables
- progressive disclosure for advanced detail

---

## Top Navigation Baseline

The system-wide top navigation is a persistent product shell, not a page-specific workspace.

Per [[Sticky Shell and Alert Presentation Decision]], it remains sticky so users never lose navigation, authenticated account actions, or route orientation while scrolling.

It should contain:
- product identity on the left
- primary section navigation in the middle or left-center
- a compact authenticated user menu on the right

The authenticated user menu should expose:
- signed-in identity
- logout

The top navigation does not need to show role by default.
Role can remain implicit unless a later screen or permission pattern proves that explicit role display materially improves comprehension.

This keeps authenticated account behavior predictable without adding bulk to every page header.

---

## Standard DXCP Shared Pattern Set

## 1. Page Header Pattern

### Purpose

Identify the current page or object and expose the primary page-level action.

### Structure

Left:
- page title
- optional short subtitle or object meta line

Right:
- primary action
- optional secondary actions

### Rules

- The page header appears below the Alert Rail.
- The title should use confirmed DXCP vocabulary.
- The primary action belongs in the page header, not inside a random section.
- Do not overload the header with status chips, filters, and dense metadata.
- Use one dominant primary action when the page clearly supports one.

### Typical examples

- Application screen: title on left, `Deploy` on right
- Deployment detail: deployment identifier or object title on left, `Rollback` or `Refresh` on right
- Deployments: collection title on left, `Refresh` on right
- Admin detail: object title on left, `Edit` or `Save` on right when appropriate

### Avoid

- multiple equal-weight primary buttons
- embedding page actions inside summary cards
- very tall hero headers
- mixing filters into the header unless the page is fundamentally a browse surface

---

## 2. Section Header Pattern

### Purpose

Introduce a content block with clear hierarchy and optional local actions.

### Structure

Top row:
- section title
- optional compact section action or link

Optional second line:
- one short sentence of framing or count/context text

### Rules

- Section headers should be visually consistent across screens.
- Local actions must remain secondary to the section title.
- Section headers should not become mini page headers.
- Use concise titles such as:
  - Running Version
  - Recent Deployments
  - Failures
  - Guardrails
  - Audit Log

### Good use cases

- opening a recent activity section
- introducing a table or timeline
- framing a right-rail context block

---

## 3. Alert Rail Pattern

### Purpose

Provide one consistent place for page-level conditions that affect understanding or action while preserving local explanation near the affected work.

### Placement

Directly below the sticky top navigation and above the page header.

### Used for

Global alert strip:
- route-level blocked posture
- policy explanations that affect the page as a whole
- route unavailable or route-level permission limitation
- page-level degraded-read, read failure, or refresh failure
- warning states that change whole-page interpretation

Local in-page explanation:
- blocked actions tied to one action or section
- field-group validation or save blockers
- row-level or section-level degraded evidence
- section-local diagnostics or artifact problems

### Rules

- Per [[Sticky Shell and Alert Presentation Decision]], the page-level rail is a compact sticky global alert strip when an active global condition exists.
- Multiple global alerts may stack vertically.
- Field-specific and section-specific issues stay inline and do not move into the rail unless they escalate to page-level impact.
- Use the global strip when the condition changes how the user should interpret the whole page or route.
- Use local explanation when the condition only matters near the affected action, section, field group, or record.
- Alerts should explain:
  1. what happened
  2. why
  3. what to do next
- Alerts should be short and operational, not verbose diagnostics.
- The sticky strip must stay compact by default and must not become a permanent oversized card.

### Notes

This pattern is shared across [[Deploy Workflow]], [[Application Screen]], [[Deployment Detail Screen]], [[Deployment Screen]], [[Insights Screen]], and [[Admin Screen]].

---

## 4. Status and Badge Pattern

### Purpose

Expose state quickly without turning pages into color-heavy dashboards.

### Badge families

#### Outcome badges
Used for deployment or object state.

Examples:
- Succeeded
- Failed
- In Progress
- Pending
- Rolled Back
- Canceled

#### Category badges
Used for normalized failure category or object classification.

Examples:
- Policy
- Validation
- Infrastructure
- Deprecated

#### Scope badges
Used sparingly for role, environment, or admin-only markers.

### Rules

- Badge vocabulary must remain small and repeated.
- Badges should support scanning, not carry the whole explanation.
- Use one primary status badge per object row or summary block.
- Avoid badge clusters that require decoding.
- Prefer adjacent text for nuance instead of stacking multiple chips.

### Avoid

- showing five badges where one badge plus text would do
- relying on color alone
- inventing screen-specific badge semantics

---

## 5. Summary Card Pattern

### Purpose

Provide a compact high-signal summary of one object, metric, or operational state.

### Common uses

- running version summary
- deployment summary
- insight snapshot
- deployment group summary
- strategy summary
- settings summary

### Structure

- title
- primary value or state
- one or two supporting lines
- optional compact action

### Rules

- Summary cards should be compact and uniform.
- They should summarize, not become containers for entire workflows.
- Prefer a small number of cards with strong meaning.
- Cards should not create a dashboard wall.
- On overview pages, use cards for orientation, then hand off quickly to richer content.

### Avoid

- many equal cards competing for attention
- putting dense forms inside cards
- long explanatory paragraphs inside cards

---

## 6. Table and Collection Pattern

### Purpose

Support intentional browsing of collections without making the product table-first.

### Collection types

#### Comfortable list
Used when each item needs a little narrative context.

Good for:
- Applications
- Deployment Groups
- Strategies
- Audit items with summary emphasis

#### Table
Used when comparison across repeated columns matters.

Good for:
- Deployments
- filtered audit history
- usage lists
- longer browse surfaces

### Table rules

- Use stable columns.
- Keep action columns aligned and predictable.
- Prefer compact, readable rows over dense data packing.
- Support sorting or filtering only when it materially helps the browse task.
- Do not widen columns just because the screen is wide.
- Limit visible columns to the ones needed for the main question.

### Collection row shape

A good DXCP collection row usually includes:
- object name or identifier
- primary status
- one or two supporting metadata items
- timestamp or recency cue
- open action or row navigation

### Avoid

- turning every browse screen into a wide admin grid
- exposing backend identifiers as default columns
- using large card mosaics for long-lived collections

---

## 7. Timeline Pattern

### Purpose

Show the narrative of a single [[DXCP Core Vocabulary#Deployment|Deployment]] or a tightly scoped recent activity stream.

### Primary use

The timeline is the dominant pattern for [[Deployment Detail Screen]] and a supporting pattern for recent deployment activity elsewhere.

### Structure

Per item:
- timestamp
- event title
- short explanation
- associated state or failure cue
- optional expansion for more detail

### Rules

- Timelines are for narrative understanding, not archive dumping.
- Use clear chronological sequencing.
- Keep the event title readable without engine knowledge.
- Attach failure explanation to the relevant event rather than creating a disconnected failure wall when possible.
- For recent activity on other screens, use condensed timeline summaries with intentional drill-in.

### Avoid

- using the timeline as a general-purpose history feed for months of data
- exposing raw engine stage names as the visible narrative
- mixing unrelated object histories into one timeline

---

## 8. State Block Pattern

### Purpose

Handle repeated page and section states consistently.

### Required states

#### Empty
Used when there is no data yet.

Example meanings:
- no deployments yet
- no failures recorded
- no deployment groups created

#### Loading
Used while content is being fetched.

Rules:
- preserve page structure
- avoid dramatic layout jumps
- use skeletons or reserved space where possible

#### No results
Used when filters or search return nothing.

Rules:
- distinguish from true emptiness
- show the active filter context
- provide a clear next step such as clearing filters

#### Blocked
Used when the user can see the object or action but cannot proceed.

Rules:
- keep the expected action visible when appropriate
- explain the reason clearly
- prefer alert rail plus local disabled control explanation

#### Read failure
Used when the system cannot load needed information.

Rules:
- make the failure explicit
- preserve the page shell
- offer `Refresh` when meaningful

### Shared rule

Do not let these states collapse into one generic “nothing here” treatment.

---

## 9. Modal, Drawer, and Progressive Disclosure Rules

### Purpose

Keep the default page calm while still allowing detail, confirmation, and editing.

### Use a modal when

- confirming a consequential action
- collecting a very small, focused set of inputs
- showing a short blocking decision

Examples:
- Rollback confirmation
- confirm risky admin change
- confirm deprecation

### Use a drawer when

- the user needs contextual detail without losing the current page
- the content is secondary, inspectable, and dismissible
- the interaction is not the primary workflow

Examples:
- activity detail
- audit event detail
- supporting diagnostics
- previewing object impact

### Use inline progressive disclosure when

- extra detail is useful but optional
- the user benefits from seeing it in context
- the content is short and closely related to the parent block

Examples:
- strategy behavior summary
- policy explanation details
- advanced diagnostics
- additional failure context

### Rules

- Do not use modals for full-page workflows.
- Do not hide critical policy context behind disclosure.
- Advanced diagnostics may be collapsed by default, especially in Admin.
- Default users should not need to open progressive disclosure to understand the main state of the page.

---

## 10. Filter and Search Pattern

### Purpose

Support browse and investigation without pushing filters into every screen.

### Where filters belong

Filters belong on collection-oriented screens such as:
- [[Deployment Screen]]
- [[Insights Screen]]
- audit views in [[Admin Screen]]

Search belongs where users are finding objects, not on every detail page.

### Structure

- compact filter row above the collection
- active filter summary when applied
- clear reset or clear behavior

### Common filter types

- time window
- status
- application
- deployment group
- environment
- failure category

### Rules

- Keep the filter set small and task-specific.
- Show active filters clearly.
- Prefer progressive filtering over advanced search builders.
- Do not make filter bars taller than the section they control.
- On small screens, filters may collapse, but active constraints must stay visible.

---

## 11. Action Placement Pattern

### Purpose

Make actions predictable across DXCP.

### Placement hierarchy

#### Page-level primary action
Top right of the page header.

#### Section-level action
Top right of the section header.

#### Row-level action
End of row or within row-open behavior.

#### Consequential action
Confirmed through modal or deliberate confirmation pattern.

### Rules

- High-frequency primary actions must be easy to find.
- Actions should appear near the object they affect.
- Avoid duplicate actions in multiple places on the same screen unless one is sticky utility behavior.
- Keep action labels short and aligned with [[DXCP UX Grammar]].

### Examples

- `Deploy` in Application page header
- `Refresh` in collection page header
- `Open` or row navigation inside collections
- `Save` inside edit mode, not scattered across subsections

---

## 12. Anti-Bulk and Restraint Rules

### Purpose

Keep DXCP premium, calm, and operationally precise.

### Rules

1. Default to fewer sections.
2. Prefer one strong primary region over several equal panels.
3. Use the secondary column only for supporting context.
4. Keep summary surfaces compact.
5. Avoid card walls and metric mosaics.
6. Do not stack full history into default pages.
7. Limit simultaneous colors, badges, and icon accents.
8. Use progressive disclosure for advanced or admin-only detail.
9. Preserve whitespace outside content before adding more containers inside content.
10. Every added block must answer a real operational question.

### Practical test

If a screen starts to feel like:
- a dashboard
- a console
- a settings dump
- an archive wall

then the design has drifted away from DXCP.

---

## Usage Guidance by Screen Family

## [[Application Screen]]

Use:
- page header with `Deploy`
- compact current-state summary
- recent activity collection or condensed timeline
- recent failures block
- selective secondary context for Deployment Group and guardrails

Avoid:
- full deployment history as the default body
- large tab suites of equal weight

## [[Deployment Detail Screen]]

Use:
- page header with contextual actions
- deployment summary block
- timeline as the dominant primary block
- failure explanation tied closely to timeline context
- compact sticky secondary context when helpful

Avoid:
- replacing the timeline with tables
- broad unrelated system metrics

## [[Deploy Workflow]]

Use:
- page header with action framing
- form sections with clear section headers
- persistent policy context while editing
- alert rail for page-level blocks
- inline validation for field-specific problems

Avoid:
- hiding policy until submit
- generic engine-oriented terminology

## [[Deployment Screen]]

Use:
- collection-oriented header
- compact filters
- stable table or comfortable list
- deliberate entry into deployment detail

Avoid:
- oversized metrics row above the collection
- turning the page into an archive without navigation aids

## [[Insights Screen]]

Use:
- restrained summary cards
- trend/breakdown sections with clear drill paths
- scoped filters
- explicit anomaly or failure emphasis where relevant

Avoid:
- dashboard-wall layouts
- duplicate detail that belongs on Application or Deployment pages

## [[Admin Screen]]

Use:
- object-first browse and detail views
- summary-first overview
- section-based editing
- change review and validation emphasis
- progressive disclosure for advanced diagnostics

Avoid:
- raw CRUD density
- default exposure of backend or engine concepts
- treating Admin like a separate visual product

---

## Pattern Selection Heuristics

When choosing patterns for a future screen spec:

1. Start with the page header.
2. Decide the dominant primary block.
3. Decide whether a secondary context column is truly needed.
4. Choose one collection pattern only where browsing is core.
5. Add the Alert Rail only as conditions require.
6. Use progressive disclosure before adding more permanent surface area.
7. Check the result against the anti-bulk rules.

---

## Relationship to Future UI Specs

This note defines the shared pattern language that later screen specs should reuse.

Future screen notes should reference this note instead of redefining:
- header behavior
- alert treatment
- state handling
- summary blocks
- collection behavior
- action placement
- progressive disclosure logic

This keeps the DXCP UI planning system coherent and reusable.