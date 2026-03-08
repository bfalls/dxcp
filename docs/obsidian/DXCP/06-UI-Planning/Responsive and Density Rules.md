# Responsive and Density Rules

**Status**: Completed — UI planning roadmap work finished

## Purpose

This note defines the final responsive and density rules for DXCP so the product remains premium, restrained, and predictable across desktop, narrow desktop, tablet, and smaller layouts.

These rules preserve one spatial story across widths.
They do not create alternate information architecture by breakpoint.

This note aligns with:
- [[DXCP Core Vocabulary]]
- [[DXCP UX Grammar]]
- [[DXCP Layout Behavior]]
- [[Layout Grid]]
- [[Shared UI Patterns]]
- [[Navigation and Cross-Screen Behavior]]
- [[Product Behavior Alignment]]

---

## Core Principle

Responsive behavior in DXCP is **compressive, not transformative**.

Wider layouts may add breathing room.
Narrower layouts may stack, condense, defer, or collapse supporting detail.
But the product must still answer the same user questions in the same conceptual order.

The user should feel:
- the same product
- the same object ownership
- the same page structure
- the same action locations
- the same hierarchy of primary work versus supporting context

---

## Responsive posture

DXCP is desktop-first, but not desktop-only.

The intended posture across widths is:

- **Wide desktop**: full expression of the bounded layout contract, with breathing room but no new meaning
- **Standard desktop**: preferred planning baseline for all screen specs
- **Narrow desktop**: same screen story under horizontal pressure, usually through earlier stacking and condensed controls
- **Tablet / constrained layout**: single-column or near-single-column reading flow with preserved section order
- **Small screens**: focused inspection and essential action support, not full-density broad administration or archive browsing

DXCP should not become a mobile-first dashboard, nor a miniature admin console.

---

## Stable rules across all widths

The following rules remain stable across all viewport widths.

### 1. Bounded product frame stays stable

**User question answered**  
Where does the product begin and where should I read?

**Implemented capability preserved**  
All primary views already rely on a bounded content container and aligned page header structure.

**Behavior type**  
Stable

**Rule**  
The product shell remains centered and bounded across widths.
The top navigation stays visually aligned to the same content frame as the page body.
Wide screens add margin, not stretched content fields, giant tables, or drifting action zones.

**Alignment**  
Matches [[DXCP Layout Behavior]], [[Layout Grid]], and [[Shared UI Patterns]].

---

### 2. Page header ownership does not move

**User question answered**  
Where is the primary action for this page?

**Implemented capability preserved**  
Application, Deployment Detail, Deploy Workflow, Deployments, Insights, and Admin all establish the page header as the action anchor.

**Behavior type**  
Stable

**Rule**  
Primary page actions remain in the page header across widths.
Responsive behavior may compress spacing, shorten supporting text, or reduce action count visibility through overflow for secondary actions, but must not relocate the primary action into random cards, lower sections, or secondary rails.

**Alignment**  
Matches [[DXCP UX Grammar]], [[Shared UI Patterns]], and [[Navigation and Cross-Screen Behavior]].

---

### 3. Alert rail keeps one global location

**User question answered**  
Where do I look when something blocks, warns, or fails at page level?

**Implemented capability preserved**  
Blocked deploys, blocked saves, failed loads, policy explanations, and platform warnings.

**Behavior type**  
Stable

**Rule**  
Global alerts remain in the alert rail under top navigation and above the page header.
They may stack vertically on narrower widths, but they do not move into scattered local cards unless the issue is truly local to one field or one section.

**Alignment**  
Matches [[Shared UI Patterns]], [[Guardrails UX]], and [[Failure UX]].

---

### 4. Primary story always comes before supporting context

**User question answered**  
What should I understand first on this screen?

**Implemented capability preserved**  
Application operational story, deployment investigation story, deploy submission story, deployments browse story, insights reading order, and admin governance editing flow.

**Behavior type**  
Stable

**Rule**  
When layouts collapse, the primary task region remains first and supporting context remains second.
A secondary rail may move below the primary content, but must not jump ahead of the main operational or governance story unless the context is critical to safe action at that exact moment.

**Alignment**  
Matches [[DXCP Core Vocabulary]], [[Layout Grid]], and [[Screen_Spec_Framework]].

---

## Adaptive rules by layout pressure

### 5. Two-column layouts stack only when the secondary column stops helping

**User question answered**  
When should a two-column screen become one column?

**Implemented capability preserved**  
Secondary rails on [[Screen Spec - Application]], [[Screen Spec - Deployment Detail]], [[Screen Spec - Deploy Workflow]], and qualifying [[Screen Spec - Admin]] pages.

**Behavior type**  
Adaptive

**Rule**  
Two-column layouts may remain only while the primary region is still comfortably readable and the secondary rail still feels subordinate.
Once the secondary rail becomes cramped, sticky behavior becomes awkward, or line length and control wrapping begin to compete with the main task, the page should stack.

Stack order:
1. page-level framing
2. primary task content
3. supporting context
4. advanced diagnostics or optional disclosure

**Alignment**  
Matches [[Layout Grid]], [[Shared UI Patterns]], and the screen specs for Application, Deployment Detail, Deploy Workflow, and Admin.

---

### 6. Secondary rail behavior is adaptive, then collapsed

**User question answered**  
What happens to policy, context, and diagnostics when space gets tight?

**Implemented capability preserved**  
Guardrails, running context, strategy context, validation summary, impact summary, recent related audit activity, and diagnostics.

**Behavior type**  
Adaptive, then collapsed

**Rule**  
Secondary rails follow this progression:

- **Wide and standard desktop**: visible as a restrained side rail
- **Narrow desktop**: rail remains only if still clearly secondary and not vertically noisy
- **Tablet / constrained layout**: rail drops below primary content in the same reading story
- **Small screens**: only the highest-value support content remains expanded; advanced diagnostics, verbose rationale, or low-frequency metadata collapse behind progressive disclosure

The secondary rail must never become a second primary column.

**Alignment**  
Matches [[Layout Grid]], [[Shared UI Patterns]], [[Guardrails UX]], and [[Screen Spec - Admin]].

---

### 7. Filter bars compress before they fragment

**User question answered**  
How do I narrow the screen without the filter controls taking over the page?

**Implemented capability preserved**  
Deployments filters, Insights filters and time controls, and any admin browse filtering.

**Behavior type**  
Adaptive

**Rule**  
Filter bars stay horizontal on standard desktop when they can remain calm and scannable.
At narrower widths they should:
- wrap compactly first
- reduce lower-priority controls next
- move infrequent or advanced filters behind disclosure after that

Filters must not become a separate workflow or a giant drawer by default.
Applied scope should remain visible as concise summary framing above the collection or analysis body.

**Alignment**  
Matches [[Shared UI Patterns]], [[Screen Spec - Deployments]], and [[Screen Spec - Insights]].

---

### 8. Page header actions compress by priority

**User question answered**  
How does the header stay usable when space is tight?

**Implemented capability preserved**  
Deploy, Rollback, Save, Create, Refresh, and view-specific secondary actions.

**Behavior type**  
Adaptive

**Rule**  
Header actions collapse by priority, not arbitrarily.

Order of preservation:
1. primary action
2. safety-critical adjacent action if needed
3. one or two common secondary actions
4. lower-value secondary actions behind overflow

Page titles may truncate supporting descriptors before the primary action loses visibility.
The page header should remain one recognizable zone, not split into multiple stacked toolbars unless the screen would otherwise become unusable.

**Alignment**  
Matches [[DXCP UX Grammar]], [[Shared UI Patterns]], and [[Navigation and Cross-Screen Behavior]].

---

## Small-screen rules

### 9. Small screens preserve inspection and focused action, not full breadth

**User question answered**  
What is DXCP expected to support well on smaller layouts?

**Implemented capability preserved**  
Readability for Application, Deployment Detail, Deployments, Insights, and focused Admin inspection; deploy and rollback remain possible when safe.

**Behavior type**  
Collapsed

**Rule**  
Small-screen DXCP should support:
- reading current state
- inspecting one object or one deployment
- submitting a focused deployment intent
- scanning recent history
- reviewing governance objects in a focused way

Small-screen DXCP should not optimize for:
- broad admin editing across many fields at once
- wide comparison views
- dense audit browsing as a default
- giant data grids requiring lateral scanning across many columns

The product becomes more focused, not different.

**Alignment**  
Matches [[Product Behavior Alignment]], [[Screen Spec - Admin]], and [[Screen Spec - Insights]].

---

### 10. The same spatial story must survive collapse

**User question answered**  
How do I know this is still the same page when the width changes?

**Implemented capability preserved**  
Cross-screen continuity already defined in [[Navigation and Cross-Screen Behavior]].

**Behavior type**  
Stable in meaning, adaptive in arrangement

**Rule**  
Each screen family keeps its same story across widths:

- **Application**: running state and recent change first, deeper history intentionally later
- **Deployment Detail**: summary and failure framing first, timeline dominant, support context after
- **Deploy Workflow**: intent entry first, guardrail understanding second, submit last
- **Deployments**: recent collection and narrowing first, deeper history deliberately continued
- **Insights**: trend before breakdown, breakdown before drill-in
- **Admin**: object understanding before edit, edit before diagnostics

Responsive behavior may reorder supporting context inside a safe hierarchy, but must not reorder the core story.

**Alignment**  
Matches the full screen spec set and [[Navigation and Cross-Screen Behavior]].

---

## Density rules by screen family

### 11. Density is screen-family specific, not globally uniform

**User question answered**  
Why does one screen feel tighter than another without becoming inconsistent?

**Implemented capability preserved**  
Different jobs across operational, investigative, browse, observability, and admin surfaces.

**Behavior type**  
Stable by family

**Rule**  
DXCP uses distinct density targets by screen family:

#### Application
Comfortable operational density.
Prioritize quick comprehension, recent change, current running state, and a restrained context rail.

#### Deployment Detail
Moderately dense, but vertically disciplined.
The timeline can be information-rich because it is the main investigation surface, but summary and failure framing stay concise.

#### Deploy Workflow
Lower-density than detail pages.
Whitespace and grouping should support confidence and safe submission, not broad scanning.

#### Deployments
Compact browse density.
Rows can be tighter than cards, but never to the point that status, application identity, and timing become muddy.

#### Insights
Moderate density with visual restraint.
Trend and breakdown sections can be rich, but summary framing stays compact and the page should never feel like a metrics wall.

#### Admin
Controlled density with review-first posture.
Enough structure to support real governance work, but never bulk-console density by default.

**Alignment**  
Matches [[Shared UI Patterns]], [[Layout Grid]], and each screen spec.

---

### 12. Table versus stacked-card choice depends on the user’s question

**User question answered**  
When should DXCP keep a table and when should it switch to compact cards?

**Implemented capability preserved**  
Deployments browse, admin browse lists, audit viewing, recent activity lists.

**Behavior type**  
Adaptive

**Rule**  
Use tables or table-like rows when the main task is:
- scanning many peer records
- comparing a stable set of fields
- opening one record from a collection
- keeping recent history compact

Use stacked compact cards when:
- the viewport is too narrow for stable scan lines
- field comparison is less important than quick per-item comprehension
- preserving row meaning matters more than preserving columns

The switch is appropriate only when the card preserves the same field priority as the row.

Card conversion should not:
- invent new card summaries
- duplicate all row metadata in verbose form
- add dashboard styling
- bury detail entry

**Alignment**  
Matches [[Screen Spec - Deployments]], [[Screen Spec - Admin]], and [[Shared UI Patterns]].

---

## Truncation and overflow rules

### 13. Truncation protects scanability, not meaning

**User question answered**  
What gets shortened first when labels, values, and controls become too wide?

**Implemented capability preserved**  
Application names, strategy names, deployment identifiers, audit summaries, and long configuration labels.

**Behavior type**  
Adaptive

**Rule**  
Truncation priority should be:

1. decorative or supporting text
2. long secondary descriptors
3. low-priority metadata labels
4. long identifiers with full value available on inspect or hover where supported

Do not truncate:
- primary status meaning
- destructive or safety-relevant action labels
- policy-blocking reason labels
- the first readable identity of the object currently being viewed

Prefer line clamping for descriptive text.
Prefer single-line truncation for browse metadata.
Do not produce multi-line row chaos in history collections just to preserve every character.

**Alignment**  
Matches [[Shared UI Patterns]], [[Failure UX]], and the screen specs.

---

### 14. Overflow handling should preserve object identity and action clarity

**User question answered**  
How should long content behave without making the UI feel broken or bulky?

**Implemented capability preserved**  
Long version strings, long summaries, long audit text, long strategy descriptions, and extended diagnostics.

**Behavior type**  
Adaptive

**Rule**  
Overflow behavior should follow content type:

- **browse rows**: truncate low-priority fields and preserve scan line clarity
- **detail metadata**: wrap in controlled short groups where comprehension benefits
- **descriptions and rationale**: line clamp by default, expand on demand
- **diagnostics**: keep collapsed until requested
- **history and timeline items**: show concise summary first, detail second

Horizontal scrolling should be avoided except where the content is inherently structured and impossible to summarize safely.

**Alignment**  
Matches [[Layout Grid]], [[Shared UI Patterns]], and [[Screen Spec - Deployment Detail]].

---

## Long-history handling in constrained layouts

### 15. Historical depth compresses before it expands

**User question answered**  
How does DXCP keep history useful without turning narrow layouts into endless scrolling archives?

**Implemented capability preserved**  
Deployment history, audit history, recent activity, timeline continuity, and older-history access.

**Behavior type**  
Collapsed

**Rule**  
On constrained layouts:
- show recent, meaningful history first
- keep default visible depth bounded
- provide explicit continuation into older history
- avoid auto-expanding long historical sections inline

This is especially important for:
- [[Screen Spec - Application]]
- [[Screen Spec - Deployments]]
- [[Screen Spec - Admin]]
- audit views
- timeline-adjacent supporting history

Timeline detail is the exception only when the timeline is the primary screen purpose, as on [[Screen Spec - Deployment Detail]].

**Alignment**  
Matches [[Decision History is never the default page shape]], [[Deployment Timeline]], and [[Product Behavior Alignment]].

---

## Screen-family responsive summaries

## [[Screen Spec - Application]]

- two-column on desktop
- stack on narrow desktop or tablet
- keep running state, recent activity, and Deploy high in the story
- secondary context follows the main operational story
- history stays intentional on small screens

## [[Screen Spec - Deployment Detail]]

- keep summary and failure framing above the timeline
- stack side context below timeline on constrained layouts
- keep Rollback in the page header
- diagnostics remain progressive and subordinate

## [[Screen Spec - Deploy Workflow]]

- keep intent entry first
- keep guardrail and strategy context supportive, not dominant
- preserve a strong submit anchor
- avoid wizard chrome or fragmented mobile-only reflow logic

## [[Screen Spec - Deployments]]

- keep the collection central
- use stable rows on desktop
- collapse to compact cards only when row comparison breaks down
- preserve outcome, application, version, and time as highest-priority entry fields

## [[Screen Spec - Insights]]

- keep one vertical analytical story
- preserve trend before breakdown
- stack breakdowns earlier on constrained layouts
- do not miniaturize charts into dashboard clutter

## [[Screen Spec - Admin]]

- preserve object-first understanding and review-first editing
- allow focused editing on constrained layouts
- drop the secondary rail below primary content
- move advanced diagnostics into disclosure or separate focused surfaces on small screens

---

## Anti-patterns explicitly disallowed

DXCP responsive behavior must not introduce:

- a different information architecture on smaller layouts
- mobile-only navigation concepts that conflict with top-level noun navigation
- page actions moved into random cards
- giant accordion stacks as a substitute for hierarchy
- full-width stretched content on very wide monitors
- secondary rails that visually compete with primary content
- broad horizontal scrolling for ordinary use
- verbose cards replacing compact lists without preserving field priority
- history becoming the default page shape just because the viewport is tall
- admin-console density leaking into standard delivery surfaces

---

## Design implication for future mockups

Mockups and implementation planning should treat breakpoints as **hierarchy-preservation thresholds**, not cosmetic device categories.

The main responsive question for each screen should be:

What is the narrowest layout at which the same DXCP story still reads clearly?

If the answer is no longer clear, the correct response is:
- stack earlier
- condense secondary material
- defer diagnostics
- preserve the primary story

not:
- invent a different page

---

## Decision note requirement

No separate design decision note is required from this session.

The rules here are the durable reusable system-level guidance for responsive behavior and density across DXCP.

---

## Continuation prompt for next UI session

**Session Title**  
DXCP UI — Visual Language Direction

**Session Goal**  
Define the intended visual character of DXCP so mockups can express the product as premium, calm, restrained, and enterprise-grade without drifting into generic dashboard styling.

**Context**  
DXCP is an intent-first deployment control plane for governed, explainable software delivery at enterprise scale.

The UX architecture is already aligned in the Obsidian vault.
UI Session 1 established the UI planning system and screen spec framework.
UI Session 2 established the shared UI pattern system.
UI Session 3 established the Application screen spec.
UI Session 4 established the Deployment Detail screen spec.
UI Session 5 established the Deploy Workflow screen spec.
UI Session 6 established the Deployments screen spec.
UI Session 7 established the Insights screen spec.
UI Session 8 established the Admin screen spec.
UI Session 9 established navigation and cross-screen behavior.
UI Session 10 established responsive and density rules, including:
- desktop-first but not stretch-heavy layout behavior
- stable page header action ownership
- alert rail consistency
- primary-story-first responsive collapse
- earlier stacking of two-column layouts when the secondary rail stops helping
- adaptive filter and header compression by priority
- screen-family-specific density rules
- table-to-card switching only when field priority is preserved
- bounded historical depth on constrained layouts
- one preserved spatial story across all widths

This session must define the visual language direction that makes DXCP feel premium and coherent before mockups begin.

This is a UI planning session.
This is not an implementation session.

**Input Context (Read all `.md` documents)**  
- `DXCP_CHATGPT_SESSION_FRAMEWORK.md`
- `DXCP_UI_SESSION_ROADMAP.md`
- `OBSIDIAN_LINKING_PROTOCOL.md`
- `DXCP-Obsidian-Vault.zip`
- `PRODUCT_VISION.md`
- `DOMAIN_MODEL.md`
- `GOVERNANCE_CONTRACT.md`
- `DECISIONS.md`
- `06-UI-Planning/Product Behavior Alignment.md`
- `06-UI-Planning/Screen_Spec_Framework.md`
- `06-UI-Planning/Shared UI Patterns.md`
- `06-UI-Planning/Navigation and Cross-Screen Behavior.md`
- `06-UI-Planning/Responsive and Density Rules.md`
- `03-Screens/Screen Spec - Application.md`
- `03-Screens/Screen Spec - Deployment Detail.md`
- `03-Screens/Screen Spec - Deploy Workflow.md`
- `03-Screens/Screen Spec - Deployments.md`
- `03-Screens/Screen Spec - Insights.md`
- `03-Screens/Screen Spec - Admin.md`
- relevant aligned notes in:
  - `01-Product`
  - `02-UX-Architecture`
  - `03-Screens`
  - `04-Flows`
  - `05-Design-Decisions`
  - `06-UI-Planning`

**Important Rules**
- Read `DXCP_CHATGPT_SESSION_FRAMEWORK.md` first
- Ignore every file whose name begins with `BAD_`
- Read all relevant Obsidian notes first
- Treat the vault as the design source of truth
- Use `Product Behavior Alignment.md` to preserve implemented capability
- Do not reopen settled screen ownership unless a real contradiction is found
- Use only confirmed Obsidian note names for wiki links
- Do not invent note names
- Do not produce code

**Required Response Pattern**
At the beginning of the session, explicitly do these steps:

1. Confirm `DXCP_CHATGPT_SESSION_FRAMEWORK.md` was read
2. Confirm `BAD_*` files are excluded
3. List confirmed existing notes relevant to this session
4. State the UX vocabulary source note
5. Summarize DXCP UX Grammar in one sentence
6. State how `Product Behavior Alignment.md` must be used in this session
7. Then perform the work and produce the requested Obsidian note

**Work Phase**
Act as an expert Senior UI Designer for DXCP.

Define the visual language direction.

**Topics to solve**
1. premium enterprise tone
2. calmness and restraint
3. contrast and hierarchy
4. spacing feel
5. typography posture
6. icon usage
7. status color usage
8. visual treatment of alerts and guardrails
9. charts and analytical visuals restraint
10. admin visual posture versus delivery surface posture
11. how DXCP avoids bulky enterprise dashboard aesthetics
12. how visual language reinforces object-first, intent-first comprehension

**Required Evaluation Method**
For each major visual rule:
- identify the user question it answers
- identify which implemented capability it preserves
- explain why the rule should be stable, adaptive, or restrained
- align it to DXCP vocabulary and shared UI patterns

**Outputs**
ChatGPT should produce:

1. Main Obsidian note:
   - `06-UI-Planning/Visual Language Direction.md`

2. A design decision note only if this session introduces a durable reusable visual rule worth preserving

3. A continuation prompt for the next UI session

**Quality Bar**
- Premium enterprise product quality
- Calm, intentional, non-bulky planning language
- Strong consistency with the aligned DXCP vault
- No invented note names
- No accidental inheritance from the current bad UI