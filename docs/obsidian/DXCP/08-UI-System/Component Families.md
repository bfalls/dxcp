# Component Families

## Purpose

This note defines the formal DXCP UI component family inventory required to implement the validated DXCP product system with consistency, restraint, and high-confidence behavior.

It translates the aligned planning foundation into reusable UI families and explicit composition boundaries so implementation can proceed without drifting into a generic dashboard design system.

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
- [[Component and System Planning]]
- [[Screen Spec - Application]]
- [[Screen Spec - Deploy Workflow]]
- [[Screen Spec - Deployment Detail]]
- [[Screen Spec - Deployments]]
- [[Screen Spec - Insights]]
- [[Screen Spec - Admin]]
- [[Deploy Workflow]]

---

## System planning stance

DXCP should be implemented as a restrained product system, not as a wide general-purpose UI kit.

The goal is not maximum abstraction.

The goal is preserving:
- object-first hierarchy
- intent-first action clarity
- guardrail explanation quality
- timeline-led investigation
- restrained insights behavior
- review-before-save discipline in admin
- stable responsive hierarchy
- one premium, calm, enterprise-grade product language

Shared component families should exist where reuse protects comprehension, consistency, state behavior, and implementation safety.

Patterns should remain composition rules where generalization would weaken hierarchy, blur purpose, or invite screen-level drift.

---

## Component family classification model

DXCP component families are classified into four system types.

### Structural

Structural families define the stable spatial story of DXCP.

They control:
- shell behavior
- page scaffolding
- header zones
- section rhythm
- primary and supporting regions
- bounded layout continuity across widths

Structural families must stay tightly standardized because layout inconsistency is one of the fastest ways DXCP can drift toward generic dashboard behavior.

### Content

Content families render DXCP objects, states, and summaries in reusable but restrained ways.

They control:
- object identity
- semantic state
- summary content
- timeline content
- policy and failure explanation content
- collections and analytical readouts

These families should preserve meaning, not create interchangeable “cards” with weak semantics.

### Stateful

Stateful families derive most of their value from behavior across loading, blocked, read-only, degraded, review, confirmation, and failure-heavy situations.

These are especially important in DXCP because the product’s credibility depends on:
- clear blocked-action handling
- explicit read-only posture
- strong failure explanation
- safe admin mutation behavior
- controlled disclosure of diagnostics

### Composition-bound

Some patterns must remain composition rules rather than becoming freely reusable components.

These patterns preserve the product’s screen-specific hierarchy and should not be reduced to generic layout builders.

DXCP quality depends as much on composition discipline as on component reuse.

---

## Prioritized component family inventory

### Tier 1 — highest-priority families

These families carry the most product risk and should be treated as implementation-shaping foundations.

#### 1. Product shell and structural frame family

**Classification**  
Structural

**Purpose**  
Preserves DXCP’s stable spatial story across the product.

**Intended use**  
Used on every major DXCP screen to establish:
- top shell alignment
- bounded content width
- unified alert rail placement
- page header placement
- section stacking rhythm
- primary and supporting region hierarchy

**Boundary**  
This family should define the shell and page scaffold only. It must not become a free-form page layout builder or dashboard grid system.

**Includes**
- top navigation shell
- bounded page container
- alert rail container
- page content frame
- two-column page frame
- secondary rail frame
- section stack rhythm

#### 2. Page header and action hierarchy family

**Classification**  
Structural + stateful

**Purpose**  
Defines the first comprehension layer of each screen by making object identity, current state, and next action immediately legible.

**Intended use**  
Used on all top-level screens and object screens where title, state adjacency, and action priority matter.

**Boundary**  
This family must not become a generic toolbar or arbitrary action cluster. It exists to preserve DXCP action discipline.

**Includes**
- page title block
- object identity line
- state adjacency zone
- primary action slot
- secondary action slot
- action compression behavior

#### 3. Alert, guardrail, and blocked-state explanation family

**Classification**  
Stateful

**Purpose**  
Provides the canonical system for communicating policy, safety, degraded conditions, and blocked actions.

**Intended use**  
Used across delivery-facing and admin surfaces whenever a user needs to understand:
- why an action is blocked
- what system condition matters
- what risk or warning should be reviewed
- what can be done next

**Boundary**  
This family must not collapse into a generic banner library or toast system. Critical explanation should remain anchored, durable, and context-aware.

**Includes**
- global alert rail item
- blocked-action explanation block
- section-level risk block
- permission-limited state explanation
- mutation-disabled explanation
- optional diagnostics disclosure affordance where allowed

#### 4. Status and semantic indicator family

**Classification**  
Content

**Purpose**  
Enables fast, restrained recognition of state without creating a loud monitoring-dashboard aesthetic.

**Intended use**  
Used anywhere DXCP renders deployment state, failure category, deprecation, blocked condition, or muted supporting status.

**Boundary**  
This family must stay semantically narrow. It should not expand into decorative labels for arbitrary metadata.

**Includes**
- deployment state badge
- in-progress indicator
- outcome indicator
- failure category badge
- deprecated or disabled indicator
- muted semantic tags where explicitly justified

#### 5. Summary block family

**Classification**  
Content

**Purpose**  
Renders high-value object summaries in a repeatable, calm, readable structure.

**Intended use**  
Used for present-tense summaries across:
- running version
- recent deployment outcome
- deployment group context
- guardrail summaries
- key admin object summaries
- restrained insight summaries

**Boundary**  
This family must not become a generic card framework with arbitrary internals. Summary blocks should remain semantically purposeful and screen-controlled.

**Includes**
- title + value summary
- object-summary cluster
- metadata stack
- compact support text
- optional linked secondary action

#### 6. Timeline and event-rendering family

**Classification**  
Content + stateful

**Purpose**  
Supports DXCP’s timeline-led investigation model for deployments and related evidence.

**Intended use**  
Used primarily in [[Deployment Detail Screen]] and any narrowly scoped timeline reuse that preserves narrative sequencing.

**Boundary**  
This family must not become a generic activity feed. It is specifically for ordered operational evidence with strong state and failure semantics.

**Includes**
- event row structure
- timestamp handling
- state transition rendering
- event detail expansion
- event-linked failure summary
- admin diagnostic disclosure slot

#### 7. Failure explanation family

**Classification**  
Content + stateful

**Purpose**  
Standardizes how DXCP explains failures in operator language first, with optional deeper diagnostics second.

**Intended use**  
Used in deployment detail, recent failure summaries, blocked-action contexts, and admin investigation surfaces where normalized failure understanding matters.

**Boundary**  
This family must not surface raw engine detail as the primary explanation. Admin diagnostics may exist, but normalized explanation remains primary.

**Includes**
- normalized failure headline
- category framing
- short explanation
- next-step guidance
- linked evidence path
- secondary admin-only diagnostic disclosure

---

### Tier 2 — core shared families after the foundation is fixed

#### 8. Controlled collection family

**Classification**  
Content + structural

**Purpose**  
Provides repeatable collection behavior for deployment lists, object rows, and admin inventories without drifting into generic enterprise data-grid complexity.

**Intended use**  
Used for:
- deployment collections
- recent activity lists
- admin object inventories
- integrations inventory when implemented

**Boundary**  
This family should support stable, DXCP-specific rows and table shells. It must not become a feature-maximized grid framework.

**Includes**
- table/list shell
- row composition rules
- controlled action column behavior
- truncation rules
- stable width rules
- narrow-width adaptation

#### 9. Filter and scope control family

**Classification**  
Stateful + composition-supporting

**Purpose**  
Supports restrained filtering and scoping where they materially improve comprehension.

**Intended use**  
Used mainly in [[Screen Spec - Deployments]] and [[Screen Spec - Insights]], and in tightly bounded admin inventories where filtering is justified.

**Boundary**  
This family must not become an analytics-style query-builder system or a faceted exploration framework.

**Includes**
- time window selector
- status filter
- scope filter
- search input where justified
- applied-filter summary
- clear/reset affordance

#### 10. State block family

**Classification**  
Stateful

**Purpose**  
Standardizes loading, empty, no-results, permission-limited, degraded-read, and failure-to-load treatments.

**Intended use**  
Used anywhere a major region or surface needs a non-default state.

**Boundary**  
This family must remain calm and utilitarian. It must not become decorative empty-state theater.

**Includes**
- loading block
- empty block
- no-results block
- read-failure block
- permission-limited block
- degraded-read notice
- blocked-mutation notice

#### 11. Review-before-save editing family

**Classification**  
Stateful

**Purpose**  
Supports the caution-first admin editing posture across high-risk governance surfaces.

**Intended use**  
Used in [[Screen Spec - Admin]] for editing [[Deployment Group]]-, [[Deployment Strategy]]-, system-setting-, and future integration-related objects where review and confirmation matter.

**Boundary**  
This family must not devolve into casual inline editing or auto-save behavior. It is specifically for deliberate governance changes.

**Includes**
- editable section shell
- pending change summary
- before/after comparison block
- validation summary
- warning confirmation block
- save/cancel/review action group

---

### Tier 3 — shared families with narrower scope

#### 12. Confirmation surface family

**Classification**  
Stateful

**Purpose**  
Supports focused, high-confidence confirmation for destructive or high-risk actions.

**Intended use**  
Used for rollback confirmation and high-risk admin mutations.

**Boundary**  
This family should stay narrow and decision-focused. It must not become a catch-all modal system for arbitrary content.

#### 13. Restrained analytical visualization family

**Classification**  
Content + composition-supporting

**Purpose**  
Supports the restrained system-observability posture of DXCP.

**Intended use**  
Used in [[Screen Spec - Insights]] and tightly bounded summary analytics elsewhere only when already justified by screen planning.

**Boundary**  
This family must not turn DXCP into a metric-tile wall or generalized dashboard chart library.

**Includes**
- restrained trend chart shell
- category breakdown visual
- summary metric display
- drill-down handoff affordance

#### 14. Integration boundary family

**Classification**  
Content + stateful

**Purpose**  
Provides a controlled way to represent external integration inventory, trust boundary, and configuration context.

**Intended use**  
Used in admin integration management and on delivery-facing screens only where an integration meaningfully supports user understanding.

**Boundary**  
This family must preserve DXCP as the primary system. Integrations should appear as bounded adjuncts, not as competing product surfaces.

**Includes**
- integration inventory row
- integration summary block
- trust-boundary explanation
- configuration context block
- optional health or activity summary where intentionally defined

---

## Component family definitions and usage boundaries

### Shared components

The following families should be built as true shared components because reuse directly protects product quality:

- product shell and structural frame
- page header and action hierarchy
- alert, guardrail, and blocked-state explanation
- status and semantic indicators
- summary blocks
- timeline event renderer
- failure explanation blocks
- controlled collections
- filter and scope controls
- state blocks
- review-before-save editing blocks
- confirmation surfaces
- restrained analytical visualization shells
- integration boundary surfaces

These should share:
- semantic meaning
- state behavior
- density expectations
- responsive behavior rules
- role-aware behavior rules
- visual-state rules

### Composition rules

The following patterns must remain composition rules rather than freely configurable shared components:

#### [[Application Screen]] composition

Must preserve present-tense object summary, visible deploy path, compact governance context, and restrained recent activity.

#### [[Deploy Workflow]] composition

Must preserve intent-first submission, primary form ownership, and supporting policy context as subordinate but clearly available.

#### [[Deployment Detail Screen]] composition

Must preserve timeline dominance, outcome comprehension, failure explanation, and rollback decision support.

#### [[Insights Screen]] composition

Must preserve restrained observability, strong comparison clarity, and explicit drill-down paths without dashboard sprawl.

#### [[Admin Screen]] composition

Must preserve governance workspace posture, review-before-save discipline, progressive disclosure, and clear read-only treatment for non-mutating roles.

#### Cross-screen handoff behavior

Must preserve navigation continuity, deep-link coherence, back-navigation expectations, and object-to-object transitions already defined in [[Navigation and Cross-Screen Behavior]].

These patterns may use shared parts, but their assembly should remain rule-based and screen-specific.

---

## Highest-risk component families

The highest-risk families are the ones most likely to degrade DXCP quality if generalized poorly or implemented loosely.

### Timeline and event-rendering family

Risk:
- can become a generic feed
- can bury causal understanding
- can overexpose diagnostics

Why it matters:
DXCP depends on ordered, comprehensible operational narrative.

### Alert, guardrail, and blocked-state explanation family

Risk:
- can fragment across screens
- can become vague or noisy
- can obscure why something is blocked versus unavailable

Why it matters:
Guardrails are part of the product, not incidental messaging.

### Review-before-save editing family

Risk:
- can collapse into casual edit/save behavior
- can reduce confidence in governance changes
- can make warnings feel optional

Why it matters:
Admin trust depends on deliberate change review.

### Page header and action hierarchy family

Risk:
- can drift into per-screen action placement inconsistency
- can hide primary action intent
- can weaken current-state comprehension

Why it matters:
This is the top-level comprehension layer for every major screen.

### Failure explanation family

Risk:
- can leak backend language
- can overcompress nuance
- can create different explanation styles across surfaces

Why it matters:
Failure comprehension is a core DXCP value proposition.

### Controlled collection family

Risk:
- can over-expand into a generic enterprise grid
- can pull screens toward archive-first behavior
- can create responsive clutter

Why it matters:
Collections are present, but should never dominate the product.

---

## Constrained flexibility guidance

DXCP quality depends on deliberately constrained flexibility.

### Highly constrained

These areas should have very little implementation freedom:

- page header composition
- primary action placement
- alert rail usage
- blocked-action explanation structure
- status semantics
- failure explanation structure
- timeline rendering
- review-before-save posture
- admin mutation posture

### Moderately constrained

These areas may vary within a defined family shape:

- summary block density
- metadata grouping
- collection row composition
- filter arrangement
- analytical breakdown layout within restrained limits
- integration detail depth within approved boundaries

### Flexible within bounds

These areas may allow measured tuning:

- internal spacing within standardized family shells
- screen-family tuning of metadata density
- chart internals within the restrained insights family
- integration-specific detail blocks inside the integration family

Flexibility should never create:
- alternate page-header logic
- free-form dashboard grids
- competing status vocabularies
- custom warning patterns
- bespoke screen-level state handling

---

## Implementation planning implications

This component family inventory implies a build strategy centered on product safety, not widget quantity.

Implementation should proceed by first stabilizing:
- shell and structural frame
- page header and action hierarchy
- alert and blocked-state explanation
- status semantics
- summary blocks
- state blocks

Then implementation can safely move into:
- timeline and failure explanation
- collections and filters
- review-before-save admin editing
- restrained analytical visualization
- integration boundary surfaces

Screen implementation should assemble from these families while preserving the screen-level compositions defined in the vault.

The important implementation consequence is that engineering should not “solve” DXCP by inventing a generic design system first.

DXCP needs:
- a restrained shared system
- explicit state behavior
- composition discipline
- strong semantic consistency

---

## Summary

DXCP’s reusable UI system should be small, deliberate, and strongly bounded.

The core shared families are the ones that preserve:
- stable structure
- semantic clarity
- blocked and read-only behavior
- timeline-led investigation
- restrained insights presentation
- review-first admin mutation

Everything else should stay controlled by composition rules so DXCP continues to feel like one coherent control plane rather than a flexible enterprise dashboard shell.