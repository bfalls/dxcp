# Responsive Component Rules

## Purpose

This note defines the formal responsive behavior rules for DXCP shared component families and key screen compositions.

It translates the already aligned responsive planning guidance into implementation-enabling system rules so DXCP can adapt across widths without breaking:
- object-first hierarchy
- action clarity
- blocked explanation visibility
- read-only posture
- restrained diagnostic disclosure
- the calm premium tone of the product

This note aligns with [[DXCP Vision]], [[DXCP Core Vocabulary]], [[DXCP Object Model]], [[DXCP UX Grammar]], [[Responsive and Density Rules]], [[Shared UI Patterns]], [[Navigation and Cross-Screen Behavior]], [[Component Families]], [[Component State Coverage]], [[Role-Aware Behavior Rules]], and [[Component and System Planning]].

---

## Responsive stance

DXCP responsive behavior is compressive, not transformative.

Widths may change layout expression, density, and disclosure depth.
They must not change:
- the conceptual order of the screen
- the ownership of the primary action
- the visibility of blocked or read-only explanation
- the distinction between primary work and supporting context
- the product’s premium restraint

Responsive adaptation exists to preserve the same DXCP story under pressure, not to invent alternate page concepts.

---

## Width-behavior model

DXCP should be implemented with width-behavior thresholds rather than device-named design logic.

The system should ask one question repeatedly:

At this width, can the same screen still tell the same story with clear hierarchy and calm scanability?

If yes, retain the current structure with lighter compression.
If no, adapt in this order:

1. reduce decorative or supporting density
2. shorten or truncate secondary text
3. compress lower-priority controls
4. stack supporting regions below the primary region
5. collapse advanced or infrequent disclosure
6. preserve the primary story and primary action

The system should not jump directly from wide layout to mobile-style transformation.

---

## Stable behavior versus adaptive behavior

### Stable behavior

These rules remain stable across widths:

- bounded product frame remains centered and aligned
- top navigation aligns to the same content frame as the page body
- page header remains the page-level action anchor
- alert rail remains the global location for page-level blocked, warning, and failure messaging
- primary content remains before supporting context
- normalized explanation remains before diagnostics
- read-only and blocked states remain explicit rather than implied
- screen-specific story order remains intact

### Adaptive behavior

These behaviors may change under width pressure:

- section spacing may tighten modestly
- supporting descriptors may truncate before core identity does
- secondary actions may collapse into overflow
- two-column layouts may stack
- filters may wrap, condense, or move lower-priority controls behind disclosure
- collections may shift from row-first scan to compact stacked items
- supporting rails may move below the primary region
- advanced diagnostics may collapse before primary explanation does

Adaptation must always preserve meaning before density.

---

## Shared responsive rules by component family

## 1. [[Component Families#1. Product shell and structural frame family|Product shell and structural frame family]]

### Stable rules
- The shell remains bounded.
- Wide monitors add margin and breathing room, not stretched content.
- The alert rail, page header, and body remain vertically ordered in the same way.

### Adaptive rules
- Interior spacing may tighten modestly at narrower widths.
- Two-column body structures may stack when the secondary region begins to compete with the main reading flow.

### Never allowed
- full-width stretched body content
- a secondary column that visually becomes equal to the primary region
- per-screen responsive frame logic that breaks the shared product structure

---

## 2. [[Component Families#2. Page header and action hierarchy family|Page header and action hierarchy family]]

### Stable rules
- The page header remains the first comprehension zone after the alert rail.
- Object identity remains on the left.
- The primary page action remains in the header.
- State adjacency stays near identity, not detached into remote cards.

### Adaptive rules
- supporting descriptors may truncate before title identity is lost
- secondary actions compress before the primary action does
- low-frequency actions move behind overflow before common actions do
- header content may wrap into a second line only if it still reads as one unified header zone

### Compression order
1. supporting metadata
2. optional status-adjacent descriptors
3. low-priority secondary actions
4. medium-priority secondary actions
5. preserve primary action visibility

### Never allowed
- moving the primary action into a card or lower section
- splitting the header into unrelated toolbar fragments
- hiding blocked action state when the action remains conceptually important

---

## 3. [[Component Families#3. Alert, guardrail, and blocked-state explanation family|Alert, guardrail, and blocked-state explanation family]]

### Stable rules
- Page-level blocked, warning, and failure explanation stays in the alert rail.
- A blocked condition remains visible even when the triggering action is compressed.
- Guardrail explanation remains in DXCP language first.

### Adaptive rules
- alert items may stack vertically
- secondary detail may collapse behind disclosure
- diagnostics may be reduced for non-admin roles or constrained widths

### Visibility rule under compression
Blocked and read-only explanation must remain visible before optional context, metadata, or diagnostics.
The product must never compress into a state where an action looks absent or inert without explanation.

### Never allowed
- replacing critical blocked explanation with ephemeral toast behavior
- hiding policy explanation because the layout became narrow
- surfacing admin diagnostics as the first layer of explanation on constrained layouts

---

## 4. [[Component Families#4. Status and semantic indicator family|Status and semantic indicator family]]

### Stable rules
- semantic meaning stays consistent across widths
- primary status remains scannable and short
- indicator placement stays attached to the object or event it describes

### Adaptive rules
- supporting badges or secondary semantic tags may drop before primary status does
- muted metadata indicators may be removed from crowded rows
- indicator groups may simplify to the most important one or two signals

### Never allowed
- truncating or collapsing the main state label into ambiguity
- adding responsive-only decorative indicators
- turning status into dense badge clutter on narrow layouts

---

## 5. [[Component Families#5. Summary block family|Summary block family]]

### Stable rules
- summary blocks preserve calm object understanding
- high-signal fields remain visible first
- summary order stays object-led, not metadata-led

### Adaptive rules
- summary grids may become vertical stacks
- lower-priority fields may move below primary summary content
- descriptive text may line-clamp before core fields wrap excessively

### Priority rule
Preserve:
1. object identity
2. current state or current meaning
3. immediate action relevance
4. supporting metadata
5. deeper explanatory copy

### Never allowed
- key-value walls caused by narrow stacking
- summary sections growing taller than the primary object story
- responsive variants inventing new object summaries not present in the settled screen logic

---

## 6. [[Component Families#6. Timeline and event-rendering family|Timeline and event-rendering family]]

### Stable rules
- narrative sequence remains vertically readable
- event order remains explicit
- summary and failure framing remain above or adjacent to timeline entry into the investigation story
- timeline remains the dominant structure on [[Screen Spec - Deployment Detail]]

### Adaptive rules
- side context moves below the timeline before the timeline itself is compressed into a less readable form
- event metadata may tighten
- secondary event details may collapse behind expansion
- admin diagnostics remain optional disclosure, not default visible density

### Never allowed
- timeline becoming a compressed feed that loses narrative meaning
- timeline markers and event text separating so far that scanability breaks
- diagnostics overtaking event narrative in constrained layouts

---

## 7. [[Component Families#7. Failure explanation family|Failure explanation family]]

### Stable rules
- one normalized primary explanation remains visible
- action guidance stays attached to the failure summary
- failure explanation remains readable before diagnostics

### Adaptive rules
- optional detail may collapse
- multiple supporting failure details may reduce to one primary summary plus disclosure
- admin-only deeper evidence may move behind expansion

### Never allowed
- raw diagnostic detail becoming the first visible layer on narrow widths
- action guidance dropping before supporting metadata does
- separate responsive failure components per screen

---

## 8. [[Component Families#8. Controlled collection family|Controlled collection family]]

### Stable rules
- collections remain object-led and scanable
- row or item actions stay subordinate to object identity
- empty, no-results, degraded-read, and blocked states remain explicit per [[Component State Coverage]]

### Adaptive rules
- stable row layouts may tighten first
- low-priority columns may drop next
- collections may become compact stacked items only when row comparison is no longer readable
- row actions may simplify to one visible action plus overflow

### Conversion rule
A row-based collection may convert to stacked items only when the stacked form preserves the same field priority and the same entry affordance.

### Never allowed
- verbose card walls that change the nature of the collection
- broad horizontal scrolling for ordinary use
- responsive-only fields or summaries that alter the object story

---

## 9. [[Component Families#9. Filter and scope control family|Filter and scope control family]]

### Stable rules
- filters remain clearly subordinate to the page header and collection or analysis body
- applied scope remains visible
- filters do not become the primary visual story of the page

### Adaptive rules
- horizontal filter bars wrap compactly first
- lower-priority filters collapse next
- advanced filters move behind disclosure after that
- active filter summary remains concise and visible above the body content

### Never allowed
- giant responsive drawers as the default filter pattern
- filters pushing the primary screen story too far below the fold
- hiding active scope on constrained layouts

---

## 10. [[Component Families#10. State block family|State block family]]

### Stable rules
- loading, empty, no-results, blocked, degraded-read, and read-failure states remain recognizable and distinct
- state blocks remain attached to the affected region unless the issue is page-level, in which case the alert rail carries it

### Adaptive rules
- illustration-like or decorative content should not appear
- supporting copy may shorten
- secondary recovery suggestions may collapse if the main state explanation remains clear

### Never allowed
- ambiguous empty states caused by over-compression
- loss of distinction between blocked and read-only
- replacing meaningful state explanation with icon-only placeholders

---

## 11. [[Component Families#11. Review-before-save editing family|Review-before-save editing family]]

### Stable rules
- object understanding remains before edit
- review remains before save
- validation, warning, and impact summaries remain visible before confirmation
- admin caution remains intact under width pressure

### Adaptive rules
- comparison regions may stack vertically
- secondary impact detail may collapse behind disclosure
- validation summary and pending-change summary may move below the editable form if needed, but must remain immediately discoverable before save

### Never allowed
- direct save emphasis overtaking review emphasis on narrow layouts
- validation becoming hidden behind tabs or distant accordions
- diagnostics compressing ahead of the change summary

---

## Header and action compression rules

## Header identity rules
- preserve the first readable object identity at all widths
- preserve primary state adjacency where the screen depends on it
- truncate secondary descriptors before core identity
- do not let adjacent metadata push the primary action out of view

## Action priority rules
The header compression model is:

1. preserve the primary action
2. preserve one safety-critical adjacent action if present
3. preserve one or two common secondary actions if space permits
4. move lower-priority actions into overflow
5. keep blocked explanation visible even when the action itself compresses

## Action label rules
Use the short action language from [[DXCP UX Grammar]].
Do not rely on icon-only header actions where the action meaning matters for safety or governance.

## Blocked action rules
When a primary or high-value secondary action is blocked:
- keep the action concept visible
- explain the block clearly
- do not silently hide the capability when the user needs to understand it exists but is not available now

---

## Secondary rail and supporting-context rules

### Responsive order
Supporting context follows this progression:

- visible side rail when clearly subordinate
- stacked below the primary region when side placement stops helping
- collapsed to selective disclosure for advanced or infrequent material on tighter layouts

### Content priority inside supporting context
Preserve first:
1. guardrails relevant to the current action
2. current object support context
3. pending validation or impact summaries
4. recent related evidence
5. advanced diagnostics

### Admin rule
On admin pages, diagnostics and deeper configuration rationale compress before core object understanding, pending changes, validation summary, and impact summary.

### Never allowed
- a support rail visually competing with the main workflow
- advanced diagnostics remaining expanded while core support context collapses
- supporting context jumping ahead of the primary task under stack order

---

## Blocked, read-only, and diagnostic presentation rules under compression

## Blocked states
Blocked states remain explicit, visible, and attached to the relevant page or region.
Compression must not reduce a blocked state to a disabled-looking control with no explanation.

## Read-only states
Read-only posture remains visible through:
- explicit mode framing
- absent mutation affordances where appropriate
- preserved explanation when a user expects a mutation path but cannot use it

Read-only should remain calm, not punitive, and should not be mistaken for missing data.

## Diagnostic disclosure
Diagnostics remain:
- subordinate to normalized explanation
- progressive, not default
- more available for platform administration per [[Role-Aware Behavior Rules]]

Under compression:
- diagnostics collapse before primary explanation
- diagnostics collapse before key guardrail understanding
- diagnostics never become the visual anchor of the screen

---

## Collection and timeline adaptation rules

## Collections
For browse-heavy surfaces such as [[Screen Spec - Deployments]] and admin inventories:

- preserve object identity, state, and entry affordance first
- drop low-priority columns before converting the structure
- convert to compact stacked items only when row scanning no longer works
- keep actions restrained and subordinate
- keep no-results and filtered-empty explanation clear

## Timelines
For investigative surfaces such as [[Screen Spec - Deployment Detail]]:

- preserve summary and failure framing above the timeline
- preserve chronological readability
- reduce metadata density before collapsing narrative detail
- keep event detail expandable rather than permanently expanded
- move secondary context below the timeline before weakening timeline dominance

## Historical depth
Historical depth compresses before it expands.
Constrained layouts should show recent, meaningful history first, with explicit continuation into older depth, consistent with [[Decision History is never the default page shape]].

---

## Screen-level responsive implications

## [[Screen Spec - Application]]
- Preserve present-tense operational comprehension first.
- Keep current state, recent change, and deploy path high in the story.
- Let supporting governance and contextual summary stack below the primary region when needed.
- Keep recent activity intentional rather than letting history dominate constrained layouts.

## [[Screen Spec - Deployment Detail]]
- Preserve summary and failure framing before the timeline.
- Keep the timeline dominant.
- Move supporting context below the timeline on tighter widths.
- Keep rollback as a clear header action when allowed.
- Keep diagnostics progressive and subordinate.

## [[Screen Spec - Deploy Workflow]]
- Preserve intent entry as the first task.
- Keep guardrail and strategy context supportive rather than equal-weight.
- Preserve the submit anchor.
- Collapse optional supporting explanation before weakening field clarity or blocked explanation.

## [[Screen Spec - Deployments]]
- Keep the recent deployment collection central.
- Preserve outcome, application, version, and time as the highest-priority browse fields.
- Use compact stacked items only when row comparison breaks down.
- Keep active scope visible when filters compress.

## [[Screen Spec - Insights]]
- Preserve one vertical analytical story.
- Keep trend before breakdown and breakdown before drill-in.
- Stack or simplify supporting analytical sections before miniaturizing them into clutter.
- Keep summary framing concise.

## [[Screen Spec - Admin]]
- Preserve object understanding before edit, and edit before diagnostics.
- Move secondary rails below the main region earlier than on operational screens.
- Compress advanced diagnostics and deeper disclosure before validation, impact, and review surfaces.
- Preserve review-before-save posture under all widths.

---

## Implementation planning implications

Implementation should treat responsive behavior as a first-class system concern, not late visual cleanup.

The planning implications are:

- shared families need explicit responsive variants where adaptation changes structure rather than spacing
- state handling must be tested under constrained widths, not only in default desktop conditions
- blocked, read-only, and diagnostic behavior need dedicated responsive acceptance checks
- page headers need priority-driven action compression rules, not ad hoc overflow
- collections need defined field-preservation order before any row-to-stack conversion
- supporting rails need collapse rules based on hierarchy, not arbitrary breakpoints
- admin compositions need stronger compression discipline than delivery-facing surfaces where diagnostics and secondary governance detail could otherwise grow noisy

This note should guide implementation planning, screen assembly sequencing, and later UI quality gates.

---

## Short summary

DXCP responsive behavior preserves one calm object-first product story across widths.

The system adapts by compressing secondary density, stacking supporting context, and collapsing advanced disclosure before it ever sacrifices:
- primary object understanding
- action clarity
- blocked or read-only explanation
- timeline narrative
- review-before-save discipline
- restrained premium tone