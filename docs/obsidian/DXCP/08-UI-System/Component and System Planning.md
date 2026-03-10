# Component and System Planning

## Purpose

This note translates the validated DXCP mockup package into the minimum serious component and screen-system planning package required before implementation planning begins.

The goal is to define the reusable UI system needed to implement DXCP with consistency, restraint, and high-confidence behavior without reopening settled decisions about:
- UX architecture
- layout structure
- navigation structure
- responsive rules
- visual language direction
- validated mockup conclusions

This note builds on:
- [[DXCP Vision]]
- [[DXCP Core Vocabulary]]
- [[DXCP Object Model]]
- [[DXCP UX Grammar]]
- [[DXCP Information Architecture]]
- [[DXCP Layout Behavior]]
- [[Interaction Patterns]]
- [[Guardrails UX]]
- [[Failure UX]]
- [[Shared UI Patterns]]
- [[Navigation and Cross-Screen Behavior]]
- [[Responsive and Density Rules]]
- [[Visual Language Direction]]
- [[Mockup Planning]]
- [[Screen Spec - Application]]
- [[Screen Spec - Deploy Workflow]]
- [[Screen Spec - Deployment Detail]]
- [[Screen Spec - Deployments]]
- [[Screen Spec - Insights]]
- [[Screen Spec - Admin]]

---

## System planning stance

DXCP should not be implemented as a broad generic design system with many interchangeable widgets.

It should be implemented as:
- a restrained product system
- a small number of reusable component families
- strong composition rules by screen family
- explicit state behavior for blocked, read-only, failure, and review-heavy moments

The implementation goal is not maximum flexibility.

The implementation goal is preserving:
- object-first hierarchy
- intent-first action clarity
- guardrail explainability
- calm enterprise tone
- stable cross-screen behavior

---

## Planning principles

### 1. Reuse should protect product quality, not maximize abstraction

A pattern should become a shared component only when reuse improves:
- consistency
- readability
- state handling
- implementation safety

A pattern should not become a generic component when it would weaken:
- hierarchy
- screen-specific meaning
- role-aware behavior
- visual restraint

### 2. Screen compositions remain important even after components exist

DXCP quality depends on consistent page composition rules, not only on components.

The shell, page header zone, alert rail, primary/secondary layout, timeline dominance, and review-before-save posture must remain composition rules even when built from shared parts.

### 3. Stateful behavior must be designed before implementation, not patched in later

The most important DXCP behavior is not default display.

It is:
- blocked actions
- read-only states
- degraded read states
- failure explanation
- review-before-save editing
- permission-limited admin access

These states must be defined as first-class component behavior.

### 4. Flexibility must be constrained where DXCP can easily drift

DXCP is at highest risk when teams improvise:
- page headers
- action placement
- status treatments
- guardrail messaging
- timeline event rendering
- alert weight
- admin editing flows

Those areas need tighter standardization than the rest of the system.

---

## Component model

DXCP components should be planned in four layers:

1. Structural components  
   The stable page and region scaffolding that preserves DXCP’s spatial story.

2. Content components  
   Reusable renderers for object identity, state, summary, policy, failure, and history information.

3. Stateful interaction components  
   Components whose value is in behavior across blocked, loading, review, confirm, and read-only conditions.

4. Composition rules  
   Reusable screen formulas that should not be over-generalized into free-form components.

---

## Prioritized component families

## Tier 1 — must standardize first

These families carry the most product risk and should be settled before implementation planning begins.

### 1. Product shell and structural frame family

**Type**  
Structural

**Includes**
- top navigation shell
- bounded content container
- alert rail container
- page header frame
- two-column page frame
- secondary rail frame
- section stack rhythm

**Why first**
This family preserves the stable spatial story across every screen.

If this is loose, DXCP will immediately drift into screen-by-screen inconsistency.

**Must be standardized**
- shell width contract
- alignment between top navigation and page body
- alert rail placement
- page header slots
- column priority and stacking order
- section spacing rhythm

**Do not generalize into**
- arbitrary multi-column builders
- per-page container overrides
- freeform dashboard grids

---

### 2. Page header and action hierarchy family

**Type**  
Structural + stateful

**Includes**
- page title block
- object identity line
- primary action slot
- secondary action slot
- status adjacency rules
- action compression behavior

**Why first**
DXCP depends on immediate understanding of object, state, and next action.

The header is where this is established.

**Must be standardized**
- what belongs in the header
- what never belongs in the header
- primary versus secondary action rules
- blocked-action visibility in header actions
- responsive action collapse priorities

**Role-aware or blocked behavior**
- hidden versus disabled versus visible-with-explanation action handling
- read-only posture for non-mutating roles
- restricted admin mutation posture

**Do not generalize into**
- a generic toolbar
- arbitrary action clusters with no priority model

---

### 3. Alert, guardrail, and blocked-state explanation family

**Type**  
Stateful

**Includes**
- global alert rail items
- blocked action explanation blocks
- section-level risk or warning blocks
- role-limited access messaging
- mutation-disabled system state treatment

**Why first**
DXCP guardrails are product features, not incidental warnings.

This family carries the explanation posture of the product. It must feel consistent across deploy, deployment detail, and admin. 

**Must be standardized**
- message structure
- severity levels
- title/body/action structure
- when to use global rail versus inline explanation
- operator/admin diagnostics disclosure rules

**Role-aware or blocked behavior**
- deploy blocked by policy
- rollback blocked
- non-admin admin-route blocked-access state
- system mutations disabled
- restricted object mutation state

**Do not generalize into**
- a generic banner system with no policy semantics
- toast-driven critical messaging

---

### 4. Status and semantic indicator family

**Type**  
Content

**Includes**
- deployment outcome badges
- in-progress status indicators
- failure category badges
- scope or object metadata tags where allowed
- muted supporting indicators

**Why first**
DXCP depends on fast state recognition, but the visual language requires restraint.

**Must be standardized**
- approved indicator families
- intensity hierarchy
- pairing rules between badges and surrounding text
- status wording
- icon pairing rules if any

**Needs visual-state definitions**
- default
- success
- failed
- in progress
- blocked
- warning
- read-only
- deprecated
- disabled

**Do not generalize into**
- decorative chip libraries
- arbitrary color-coded tags without semantic limits

---

### 5. Timeline and event narrative family

**Type**  
Content + stateful

**Includes**
- deployment timeline container
- timeline event row
- event timestamp treatment
- event state marker
- linked failure event treatment
- expandable detail area
- admin-only diagnostic affordance

**Why first**
[[Deployment Detail Screen]] depends on timeline dominance.
This is one of the highest-risk shared components in the product.

**Must be standardized**
- event density
- sentence structure
- marker behavior
- relation between outcome, failure, and event detail
- admin diagnostic expansion rules

**Role-aware or blocked behavior**
- admin-only execution detail exposure
- observer and delivery-owner detail restraint
- failed-event emphasis without visual noise

**Do not generalize into**
- a generic activity feed
- a multi-purpose audit/event widget used everywhere

---

### 6. Failure explanation family

**Type**  
Content + stateful

**Includes**
- primary failure summary block
- failure detail row or stack
- suggested next action area
- retryability treatment when present
- correlation with timeline event

**Why first**
The product promise is normalized, actionable failure comprehension.

This must not fragment into per-screen custom error cards.

**Must be standardized**
- single primary explanation posture
- failure field order
- action guidance placement
- relation to timeline and deployment summary

**Role-aware or blocked behavior**
- admin diagnostics disclosure
- non-admin simplified explanation
- platform problem versus policy block differentiation

**Do not generalize into**
- raw exception renderers
- generic expandable debug panels in delivery-facing surfaces

---

## Tier 2 — shared components required soon after Tier 1

### 7. Object summary and metadata family

**Type**  
Content

**Includes**
- application summary block
- deployment summary block
- deployment group summary block
- strategy summary block
- integration summary block
- compact metadata rows

**Why this becomes shared**
DXCP repeatedly needs calm, high-signal summary surfaces.

**Must be standardized**
- summary card rhythm
- label/value density
- ordering by object type
- when summary remains inline versus card-framed

**Do not generalize into**
- key-value walls
- overly configurable summary schemas at runtime

---

### 8. Collection and row family

**Type**  
Content + structural

**Includes**
- comfortable object list rows
- constrained data table shell
- row status placement
- row action slot
- filter-row integration
- empty/no-results state attachment

**Why this becomes shared**
[[Application Screen]], [[Deployment Screen]], [[Insights Screen]], and admin browse surfaces all depend on controlled collections.

**Must be standardized**
- row height families
- stable column rules
- action column behavior
- truncation rules
- default sort and scan posture

**Responsive variants needed**
- table to stacked-list conversion where already allowed by screen rules
- compact filter attachment
- preserved object identity on narrow layouts

**Do not generalize into**
- infinitely configurable data grid infrastructure
- dashboard tables with per-screen styling drift

---

### 9. Filter and scope control family

**Type**  
Stateful

**Includes**
- time window selector
- status filter
- scope filter
- search input where justified
- filter summary chips or applied-filter text
- clear/reset affordances

**Why this becomes shared**
Filtering exists across deploy history, insights, and admin browse, but must remain restrained.

**Must be standardized**
- placement
- compression order
- default density
- when search is justified versus unnecessary
- no-results connection

**Responsive variants needed**
- compressed filter bar
- stacked filter controls under header when needed
- small-screen summarization of active filters

**Do not generalize into**
- large faceted-filter frameworks
- analytics-style query builders

---

### 10. State block family

**Type**  
Stateful

**Includes**
- loading block
- empty block
- no-results block
- read-failure block
- permission-limited block
- degraded-read notice

**Why this becomes shared**
State inconsistency is one of the fastest ways to make enterprise products feel improvised.

**Must be standardized**
- tone
- density
- CTA rules
- relation to alert rail
- icon and visual weight rules

**Do not generalize into**
- highly decorative empty states
- success-marketing illustrations

---

### 11. Review-before-save editing family

**Type**  
Stateful + compositional

**Includes**
- editable object sections
- pending change summaries
- before/after comparison blocks
- validation summary
- warnings requiring confirmation
- save / cancel / review actions

**Why this becomes shared**
This family is essential to admin quality and risk control.

**Must be standardized**
- editing posture
- review step shape
- validation layering
- warning versus blocking distinction
- confirmation requirements

**Role-aware or blocked behavior**
- admin-only mutation
- read-only visibility for non-admins
- object lock or in-use restrictions
- mutation kill-switch handling

**Do not generalize into**
- inline casual editing for all admin objects
- auto-save patterns for high-risk governance changes

---

## Tier 3 — useful shared families after the core system is stable

### 12. Modal, drawer, and confirmation family

**Type**  
Stateful

Use this family only where already justified by the planning notes:
- rollback confirmation
- destructive admin confirmation
- focused secondary inspection
- lightweight supporting detail

This family should stay small.

---

### 13. Analytical visualization family

**Type**  
Content

**Includes**
- restrained trend chart shell
- category breakdown visual
- summary metric tile for insights only
- drill-down affordances

This family is needed for [[Insights Screen]], but should remain narrow and intentionally limited.

It must not become a generic dashboard chart kit.

---

### 14. Integration boundary family

**Type**  
Content + stateful

**Includes**
- integration inventory row
- integration detail summary
- trust/boundary explanation block
- recent activity or health surface where defined

This is needed because integrations are present in admin and some delivery-facing detail surfaces, but should remain a controlled extension family rather than a broad plugin canvas.

---

## Patterns that should become shared components

The following should become explicit shared components or tightly-scoped component families:

- product shell frame
- alert rail item
- page header
- section header
- status badge and semantic indicator set
- summary block family
- controlled list/table family
- filter bar family
- state block family
- blocked action explanation block
- failure summary block
- timeline event renderer
- review-before-save comparison block
- confirmation dialog family
- restrained insight chart shell

---

## Patterns that must remain composition rules

The following should remain screen-level composition rules, even if built from shared components:

### 1. [[Application Screen]] composition
Why:
The value is in the balance between current running understanding, recent meaningful activity, deploy entry, and restrained supporting context.

This should not be reduced to a reusable “overview dashboard” component.

### 2. [[Deploy Workflow]] composition
Why:
The workflow depends on ordered intent entry, policy visibility, validation posture, and clear submit readiness.

It should not become a generic form wizard or stepper framework.

### 3. [[Deployment Detail Screen]] composition
Why:
Timeline dominance, failure explanation, summary framing, and rollback context are specific to deployment investigation.

It should not become a general “detail page template.”

### 4. [[Insights Screen]] composition
Why:
The restraint of summary, trend, breakdown, and attention is a screen rule, not a generic analytics layout component.

### 5. [[Admin Screen]] composition
Why:
Admin is a governance workspace with stronger caution, review, and mutation control posture.

It should not be flattened into the same composition formula as delivery-facing screens.

### 6. Cross-screen handoff behavior
Why:
Workflow success handoff, filtered browse continuation, and return behavior are navigation and composition rules, not component behavior.

---

## Structural versus content versus stateful classification

## Structural components
These define placement and rhythm more than meaning.

- product shell
- bounded page container
- alert rail container
- page header frame
- section stack
- two-column frame
- secondary rail frame
- list/table shell
- filter bar frame

## Content components
These primarily render stable information.

- status badge
- semantic category badge
- object summary block
- metadata row
- timeline event content
- failure summary content
- insight metric display
- breakdown item
- integration summary row

## Stateful components
These primarily manage user comprehension across changing conditions.

- blocked action explanation block
- alert rail item
- loading / empty / no-results / degraded / restricted state blocks
- review-before-save comparison block
- confirmation modal
- editable field groups with validation states
- filter state summary
- action group with disabled and blocked states

---

## Highest-risk shared components

These need the strongest definition before implementation planning.

### 1. Timeline event renderer
Risk:
If too generic, it loses narrative clarity.
If too custom, detail screens fragment.

### 2. Blocked action explanation block
Risk:
If inconsistent, guardrails feel random rather than authoritative.

### 3. Review-before-save editing family
Risk:
If under-designed, admin mutations will feel unsafe and improvised.

### 4. Page header and action hierarchy family
Risk:
If loose, primary actions will drift into cards, rails, or local sections.

### 5. Failure explanation family
Risk:
If fragmented, DXCP loses one of its main product differentiators.

### 6. Status and semantic indicator family
Risk:
If overextended, the UI becomes noisy.
If underdefined, states become hard to scan.

### 7. Controlled collection family
Risk:
If it becomes a generic data-grid platform, DXCP will drift into dashboard behavior.

---

## Component-state coverage

Every shared component family does not need every state.
The families below do.

## Must-have state coverage before implementation

### Product shell and frame
- default
- global alert present
- narrow-width compression
- small-screen stacked layout

### Page header and action hierarchy
- default
- primary action available
- primary action blocked with explanation path
- read-only
- multiple actions compressed by priority
- long-title truncation

### Alert and blocked-state explanation family
- info
- warning
- blocking error
- permission-limited
- degraded read
- admin diagnostic disclosure available
- admin diagnostic disclosure hidden

### Status and semantic indicators
- neutral
- in progress
- succeeded
- failed
- rolled back
- blocked
- deprecated
- disabled

### Timeline family
- default event
- active/in-progress event
- failed event
- event with linked failure
- event with expandable detail
- event with admin-only diagnostics
- dense history stack

### Failure explanation family
- policy block
- validation block
- execution failure
- platform problem
- rollback problem
- unknown problem
- with next action
- without next action
- admin diagnostics expanded
- non-admin simplified

### Collection family
- loading
- empty
- no results
- default rows
- filtered rows
- row action available
- row action blocked
- long text truncation
- narrow-width adaptation

### Filter family
- default
- one filter applied
- multiple filters applied
- cleared state
- unavailable filter option
- compressed narrow-width layout

### State block family
- loading
- empty
- no results
- read failure
- degraded read
- permission-limited
- blocked mutation

### Review-before-save editing family
- view state
- edit in progress
- inline validation issue
- section warning
- blocking validation
- review before save
- confirmation required
- save disabled
- read-only non-admin
- object restricted or in-use

---

## Role-aware component requirements

The following families need explicit role-aware behavior, not ad hoc screen logic:

### Delivery-facing role awareness
- page header action group
- blocked action explanation block
- failure explanation block
- timeline diagnostics disclosure
- row action slots in deployment collections

### Admin role awareness
- admin section entry state
- editable object sections
- review-before-save block
- confirmation flows
- system setting mutation surfaces
- integration configuration surfaces
- audit drill-down affordances

### Role-aware behavior rules
- expected actions should remain visible when useful, even if unavailable
- blocked actions should explain why
- diagnostics should come second to operator comprehension
- admin-only detail should not leak into default delivery-facing layouts
- read-only should feel intentional, not broken

---

## Responsive variant requirements

Not every component should adapt independently.
Responsive change should follow the settled screen rules.

The following component families need explicit responsive variants:

### Must have responsive variants
- page header action group
- two-column frame
- secondary rail frame
- collection/table family
- filter bar family
- summary block family where metadata density changes
- state block family for narrow layouts
- review-before-save comparison block for constrained width

### Responsive rules
- preserve primary story first
- stack primary before supporting context
- compress actions before relocating them
- preserve object identity and action clarity under truncation
- do not invent alternate mobile-only product structures
- do not allow responsive behavior to create a second visual system

---

## Visual-state definitions required before implementation

The following need explicit visual-state definition before component build-out begins:

### 1. Status intensity scale
How much visual emphasis belongs to:
- success
- failure
- in progress
- warning
- blocked
- deprecated
- disabled

### 2. Alert severity scale
How alert rail items differ between:
- informational
- cautionary
- blocking
- degraded-read
- restricted-access

### 3. Failure emphasis model
How the primary failure explanation differs from:
- surrounding summary content
- timeline-linked evidence
- admin-only diagnostics

### 4. Read-only versus blocked versus disabled distinction
These must not collapse into one visual treatment.

### 5. Review-before-save emphasis model
How pending changes, warnings, and final confirmation are signaled without becoming visually heavy.

### 6. Narrow-layout adaptation rules
How component density changes when width compresses, especially for:
- headers
- metadata rows
- collections
- comparison blocks

---

## Standardization checklist before implementation planning

The following must be standardized before implementation planning begins:

### Structural standards
- shell/container measurements
- page header slot structure
- section rhythm
- two-column behavior contract
- alert rail placement contract

### Semantic standards
- object naming in UI
- status language
- blocked-state language structure
- failure explanation field order
- review and confirmation language posture

### Behavioral standards
- blocked action visibility rules
- read-only rules
- degraded-read rules
- success confirmation rules
- admin diagnostics disclosure rules
- responsive compression order
- edit versus review versus save sequencing

### Component standards
- component family inventory
- ownership of component families versus composition rules
- required states per family
- responsive variants per family
- role-aware behaviors per family

---

## Constrained flexibility rules

To preserve DXCP quality, implementation flexibility should be explicitly constrained in these areas:

### Highly constrained
- page header composition
- primary action placement
- alert rail usage
- blocked action explanation
- status semantics
- failure explanation
- timeline rendering
- review-before-save behavior
- admin mutation posture

### Moderately constrained
- summary block layouts
- metadata density by screen family
- collection row composition
- filter arrangement

### Flexible within bounds
- exact internal spacing inside a standardized family
- minor screen-family tuning of summary density
- insight chart internals within restrained visual rules
- integration-specific detail blocks inside the approved integration family

---

## Implementation planning implication

Implementation planning should not start by asking:
“What components can we build?”

It should start by asking:
“What minimum component families and composition rules are required to implement the validated screens faithfully?”

The recommended implementation planning order is:

1. structural frame and shell
2. page header and action hierarchy
3. alert / blocked / state system
4. status and semantic indicators
5. summary and metadata family
6. collections and filters
7. timeline and failure family
8. admin review-before-save family
9. restrained insights visualization family
10. integration boundary family

This order reduces the highest product risk first.

---

## Summary

DXCP needs a deliberately small but high-confidence UI system.

The minimum reusable system is not a broad component library.
It is a controlled set of:
- structural frames
- semantic renderers
- stateful explanation components
- review-heavy admin editing parts
- screen composition rules that preserve the product’s aligned posture

The most important implementation planning outcome is not component count.

It is preserving:
- stable hierarchy
- action clarity
- guardrail explainability
- timeline-led investigation
- restrained insight presentation
- admin caution posture
- one coherent premium enterprise product language
