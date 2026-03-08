# Screen Spec - Deployments

## Purpose

Define the concrete UI screen specification for the Deployments collection surface in DXCP.

This screen is the browse and access layer for [[DXCP Core Vocabulary#Deployment|Deployment]] records. It helps users scan recent deployment activity, narrow the list intentionally, understand outcome and timing quickly, and enter [[Deployment Detail Screen]] without turning DXCP into an archive-heavy operations table.

This screen preserves confirmed implemented product capability from [[Product Behavior Alignment]] while explicitly refusing to inherit the current bad UI’s dense, generic collection posture.

---

## Dominant User Question

Which deployments matter right now, what state are they in, and which one should I open?

Secondary questions:

- What changed recently across deployments?
- Can I quickly narrow the list to the application, environment, outcome, or time window I care about?
- Is this a rollback, a failure, or a normal successful deployment?
- What is the fastest path into the full deployment story?

---

## Why This Screen Exists

The Deployments surface exists because DXCP needs a first-class browse layer for [[DXCP Core Vocabulary#Deployment|Deployment]] objects.

[[Product Behavior Alignment]] confirms that the implemented product already supports a recent deployments collection, filtering/scanning, refresh behavior, visible state/version/timing, and opening specific deployment detail. That capability is real and should remain. However, the same note also requires moderate reshape so the screen does not become a purely archive-driven table or the dominant mental model of the product.

This screen therefore exists as a restrained collection surface:
- broader than the [[Application Screen]]
- shallower than [[Deployment Detail Screen]]
- operational rather than archival
- filterable without becoming analytics-heavy
- history-aware without making long history the default story

This also aligns with [[Decision History is never the default page shape]].

---

## Relationship to Other Screens and Flows

This screen is:

- the browse surface for many [[DXCP Core Vocabulary#Deployment|Deployment]] records
- the system-level access point into [[Deployment Detail Screen]]
- a cross-application recent activity surface
- a place where outcome and recency are more important than deep explanation

This screen is not:

- a replacement for [[Application Screen]]
- a replacement for [[Deployment Detail Screen]]
- a system analytics wall like [[Insights Screen]]
- a workflow entry point that replaces [[Deploy Workflow]]

This screen should often be the answer to “show me recent deployments,” while [[Application Screen]] answers “what is happening with this application?” and [[Deployment Detail Screen]] answers “what happened in this specific deployment?”

---

## Page Header

### Header content

Left side:

- page title: `Deployments`
- optional compact subtitle describing the current result scope only when filters materially narrow the collection

Right side:

- **Refresh** as the primary page-level action

### Header rules

- Filters belong below the header, not inside it
- No competing page-level primary action such as `Deploy`
- The header should stay short and collection-oriented
- Current scope text should be compact and factual, not sentence-heavy

### User question answered

What collection am I looking at, and what global action is available here?

### Implemented capability preserved

- deployments collection
- refresh behavior

### Why it belongs in default view

The page must immediately identify itself as a collection surface and expose the one shared page action.

### Pattern alignment

Uses [[Shared UI Patterns#1. Page Header Pattern]] and [[Shared UI Patterns#11. Action Placement Pattern]].

---

## Dominant Page Composition

This screen uses a single dominant browse column with restrained collection controls above it.

Ordered from top to bottom:

1. Filter and scope controls
2. Results summary
3. Deployment collection
4. Progressive history continuation controls

### Composition rule

The page should read as:
- first, narrow the collection if needed
- second, understand what the current result set represents
- third, scan deployments and open one

It must not read as:
- a dashboard of cards above a table
- a heavy archive browser
- a diagnostics console
- a metrics surface

### Why this composition is correct

Deployments is a browse surface, so the collection must dominate. But DXCP still requires summary-first restraint, so controls and result framing must keep the list meaningful rather than infinite and shapeless.

---

## Default View

The default Deployments view shows:

- a recent deployment slice rather than all-time history
- visible filter controls with sensible default scope
- a results summary line
- a readable collection of deployment rows or compact cards
- clear status and outcome visibility
- obvious entry into [[Deployment Detail Screen]]

The default view does not show:

- deep failure narratives inline
- raw engine diagnostics
- policy detail walls
- analytics summaries competing with the collection
- full-width all-time archive behavior
- bulk admin controls
- multi-panel dashboard cards above the results list

This preserves the implemented collection capability while keeping the screen operational and recent-history oriented. [[Product Behavior Alignment]]

---

## Section Specifications

### Filter and Scope Controls

#### Purpose

Answer: How do I narrow the deployment collection to the slice I care about?

#### Content

Visible controls for the most meaningful browse dimensions:

- Application
- Environment
- Outcome or state
- Deployment kind when useful, especially rollback visibility
- time window or recent-history range
- optional text search only if it remains restrained and high-value

#### User question answered

How do I get from “all recent deployments” to the exact slice I need?

#### Implemented capability preserved

[[Product Behavior Alignment]] confirms filtering and scanning of deployment records.

#### Why it belongs in default view

Filtering is not advanced behavior on a collection screen. It is core browse behavior and should be immediately available.

#### Why some controls remain restrained

The filter bar should expose only the highest-value dimensions by default. Anything lower-value or infrequently used belongs behind progressive disclosure so the top of the page stays calm.

#### Pattern alignment

Uses [[Shared UI Patterns#9. Filter and Search Pattern]] and layout behavior from [[DXCP Layout Behavior]].

#### Additional rules

- Filters should be horizontal on standard desktop
- They should collapse cleanly on narrower widths without changing meaning
- The default state should prefer “recent deployments” over open-ended history
- Filters should never feel like an analytics query builder
- Avoid exposing backend model names in filter labels

---

### Results Summary

#### Purpose

Answer: What does the current result set represent?

#### Content

A compact line or small summary block containing:

- result count
- active time window or recent-history framing
- active application/environment scope when narrowed
- optional note when results are partial, stale, permission-limited, or degraded

#### User question answered

What am I actually looking at after the current filters are applied?

#### Implemented capability preserved

This supports the implemented browse and scan behavior by making filter state and result scope understandable.

#### Why it belongs in default view

A filtered collection without result framing quickly becomes ambiguous. This small summary prevents confusion without adding bulk.

#### Pattern alignment

Uses section framing from [[Shared UI Patterns#2. Section Header Pattern]] and restrained summary treatment from [[Shared UI Patterns#5. Summary Card Pattern]].

#### Additional rules

- Keep to one compact line or small block
- No metric tiles
- No chart-like treatment
- If no filters are applied, the summary should still make the recent-history scope explicit

---

### Deployment Collection

#### Purpose

Answer: Which deployments should I scan and open?

#### Content

A readable collection of deployment entries showing only the fields needed for fast scanning:

- primary outcome or state
- application name
- version
- environment
- deployment strategy label
- deployment kind, especially rollback when applicable
- created time
- optional deployment identifier in lower visual weight
- clear row click or `Open` action into [[Deployment Detail Screen]]

#### User question answered

What happened, to which application, and which deployment should I inspect next?

#### Implemented capability preserved

[[Product Behavior Alignment]] confirms:
- recent deployments collection
- visible state
- visible version
- visible creation timing
- opening a specific deployment detail

#### Why it belongs in default view

This is the core object collection of the screen.

#### Why it should be the dominant region

The screen exists to browse deployments. The collection should therefore dominate visually, but it must still be bounded and recent-history aware.

#### Pattern alignment

Uses [[Shared UI Patterns#6. Table and Collection Pattern]] with a restrained, stable collection layout rather than a generic archive grid.

#### Additional rules

- Prefer stable columns on desktop
- Do not let wide viewports cause uncontrolled column sprawl
- The collection must remain scannable with short rows and stable alignment
- Keep the first visible columns focused on meaning, not identifiers
- Application and outcome should visually outrank internal record reference information
- Row interaction should make entry into [[Deployment Detail Screen]] obvious without extra instruction

---

### Status and Outcome Readability

#### Purpose

Answer: Did this deployment succeed, fail, roll back, or remain in progress?

#### Content

Outcome treatment embedded into each deployment entry using:

- one primary state or outcome badge
- optional secondary indicator for rollback or superseded meaning when needed
- relative or absolute time for recency comprehension

#### User question answered

What is the status of this deployment, and how serious or relevant is it?

#### Implemented capability preserved

[[Product Behavior Alignment]] confirms visible state and timing in the collection.

#### Why it belongs in the default row shape

Outcome is the first thing users scan in a deployments collection.

#### Why policy detail does not belong here

Policy is not the dominant question on this screen. The collection should show deployment results, not become a policy browser.

#### Pattern alignment

Uses [[Shared UI Patterns#4. Status and Badge Pattern]].

#### Additional rules

- Use one dominant status treatment per row
- Do not stack multiple competing badges
- Outcome labels should remain small, repeated, and predictable
- Status color should support scanning without turning the page into a color field
- Rollback entries should be understandable at a glance without requiring detail view

---

### Detail Entry

#### Purpose

Answer: How do I move from collection scanning into full deployment understanding?

#### Content

Each deployment entry must provide an obvious path into [[Deployment Detail Screen]] through row click, title click, or a compact `Open` affordance.

#### User question answered

How do I inspect this deployment properly?

#### Implemented capability preserved

[[Product Behavior Alignment]] confirms opening a specific deployment detail.

#### Why it belongs in default view

This is the purpose of the screen. The collection must hand off cleanly into the full investigation surface.

#### Pattern alignment

Uses object-to-object navigation behavior from [[Interaction Patterns]].

#### Additional rules

- Do not hide detail entry behind overflow menus
- Entry behavior should be consistent across all rows
- A user should not need to interpret multiple destination options to inspect a deployment
- The row should hand off to detail, not to diagnostics

---

### Policy Context in Collection View

#### Purpose

Answer: How much governance explanation belongs here?

#### Content

Only minimal policy context when directly relevant to collection comprehension, such as:

- a blocked or permission-limited read notice in the alert rail
- a small inline indicator when a row reflects rollback context or other meaningful governance-constrained state
- no full guardrail summaries in the row set

#### User question answered

Is policy affecting what I can see or do on this page?

#### Implemented capability preserved

This supports the product’s role-aware and governance-aware behavior without pulling deploy-time policy explanation into the wrong surface.

#### Why it stays minimal

Deployments is not the place for full guardrail teaching. Rich governance explanation belongs in [[Application Screen]], [[Deploy Workflow]], and [[Deployment Detail Screen]] where policy is closer to action or investigation.

#### Pattern alignment

Uses [[Shared UI Patterns#3. Alert Rail Pattern]] and the general governance posture from [[Guardrails UX]].

#### Additional rules

- No persistent policy side rail
- No per-row quota prose
- No deployment-group explanation blocks above the collection
- Only page-relevant policy conditions should appear here

---

### Progressive History Continuation

#### Purpose

Answer: How does the screen handle long deployment history without becoming endless?

#### Content

A deliberate continuation model such as:

- load more
- next page
- bounded page size
- explicit older-history access

#### User question answered

How do I continue into older deployment history when I truly need it?

#### Implemented capability preserved

Preserves deployment history access while preventing the default surface from becoming archive-heavy.

#### Why it belongs behind progression

[[Decision History is never the default page shape]] requires recent and meaningful activity to dominate, not unbounded archive depth.

#### Pattern alignment

Uses restrained collection continuation behavior from [[Shared UI Patterns#6. Table and Collection Pattern]].

#### Additional rules

- The initial load should be intentionally bounded
- Older history should require deliberate continuation
- Do not auto-grow the page into a very tall historical scroll
- Keep the user aware that they are moving from recent activity into deeper history

---

## Actions

### Primary actions

- **Refresh**

### Row-level actions

- **Open** deployment detail, or equivalent direct row interaction

### Filter actions

- apply, clear, or reset behavior only as needed by the control pattern
- filter interaction should feel lightweight, not workflow-heavy

### Blocked actions

This page has few heavy actions, but blocked conditions may still exist.

Examples include:

- permission-limited read scope
- degraded refresh
- partial result availability
- filter values that produce no results

### Action rules

- Refresh is the only page-level action
- Opening detail is the dominant row-level action
- There should be no page-level rollback or deploy action competing with the collection
- Page actions must not imply the screen owns deployment submission or investigation

---

## State Model

### Loading

The page loads with stable structure preserved:

- page header remains visible
- filter rail renders in place
- results summary placeholder remains in place
- collection skeleton rows preserve row rhythm and column structure

Loading should not replace the whole page with a blank shell.

### Empty

If the system has no deployments in the current recent-history range:

- show a purposeful empty collection state
- explain that no deployments exist in the selected scope
- keep filters visible
- offer a path back to broader browsing or to a likely next object, such as [[Application Screen]] or [[Deploy Workflow]] when appropriate

This should feel like a calm product state, not a failure.

### No results

If filters narrow the list to zero:

- keep the page header, filters, and current scope summary visible
- show a no-results state in the collection region
- explain that no deployments match the current filters
- make clearing or adjusting filters obvious

No-results should be distinct from true empty history.

### Read-failure

If deployment records cannot be read:

- use the page alert rail for the page-level failure
- preserve page identity and controls when possible
- show a focused state block in the collection region
- allow retry through Refresh

Do not replace the entire page with a global shell error.

### Degraded-read

If some deployment data can be shown but refresh or supporting read paths are degraded:

- preserve visible rows whenever safe and truthful
- show a restrained degraded-data notice
- indicate that data may be stale or partial
- do not collapse the page into a full failure state if core collection data still exists

### Permission-limited

If the user can access the screen but only part of the result space:

- explain the scope limitation clearly in the alert rail or results summary
- keep visible rows readable
- do not imply missing rows are simply absent without explanation

This is especially important for role- or scope-limited behavior.

---

## History Access

This screen is history-aware but not archive-first.

History access is provided through:

- a recent default result scope
- explicit filter narrowing or widening
- deliberate continuation into older results
- handoff into [[Deployment Detail Screen]] for narrative understanding
- application-specific continuation back into [[Application Screen]] when the user wants object context rather than system-wide browsing

Rules:

- do not render full deep history by default
- do not place an analytics summary wall above the collection
- do not make older results visually equal to recent deployments
- do not turn the page into a passive record dump

---

## Responsive Behavior

### Standard desktop

- header at top
- filter rail directly below
- compact results summary
- stable collection table or list with meaningful fields visible in one scan line
- outcome, application, version, and time remain immediately visible

### Narrow desktop and tablet

- filters wrap or collapse into a compact control block
- results summary remains above the collection
- collection reduces lower-priority fields before core fields
- row interaction remains obvious
- status and application identity remain first-class

### Small screens

- the collection may shift from table posture to stacked compact cards if needed
- each entry still preserves the same information order:
  1. outcome/state
  2. application
  3. version
  4. environment
  5. strategy
  6. time
  7. detail entry
- filters should collapse cleanly without becoming a separate workflow
- recent-history framing must remain visible
- older-history continuation remains deliberate

Responsive behavior must preserve the same browse story, not invent a different product.

---

## Density and Restraint Rules

- keep the page collection-dominant, not dashboard-dominant
- show recent deployments first, not unbounded archive depth
- use stable, compact row rhythm
- avoid oversized cards or equal-weight summary panels
- keep policy explanation minimal and page-relevant only
- do not add charts, trend blocks, or insight metrics above the collection
- avoid long prose in filters, summaries, or empty states
- keep identifiers secondary to application, outcome, and timing
- preserve a calm first screenful with filters and a meaningful recent deployment slice visible

---

## Role-Aware Behavior

### Delivery owner

- can browse visible deployments within permitted scope
- can open [[Deployment Detail Screen]]
- receives clear explanation if some read scope is restricted
- does not get admin diagnostics from the collection page

### Observer

- can browse deployments as allowed by product rules
- can open [[Deployment Detail Screen]]
- experiences a read-only posture naturally because the page itself is not action-heavy
- does not see admin diagnostics or admin-only action framing

### Platform admin

- uses the same default collection surface as everyone else
- may see broader result scope where product rules allow
- still does not get a diagnostics-heavy collection by default
- admin-only depth belongs in downstream detail or admin surfaces, not in this collection screen

This follows the governance posture and read model established by GOVERNANCE_CONTRACT.md.

---

## Shared Patterns Used

- [[Shared UI Patterns#1. Page Header Pattern]]
- [[Shared UI Patterns#2. Section Header Pattern]]
- [[Shared UI Patterns#3. Alert Rail Pattern]]
- [[Shared UI Patterns#4. Status and Badge Pattern]]
- [[Shared UI Patterns#6. Table and Collection Pattern]]
- [[Shared UI Patterns#8. State Block Pattern]]
- [[Shared UI Patterns#9. Filter and Search Pattern]]
- [[Shared UI Patterns#10. Progressive Disclosure Pattern]]
- [[Shared UI Patterns#11. Action Placement Pattern]]
- [[Interaction Patterns]]
- [[DXCP Layout Behavior]]

---

## Implemented Capabilities Preserved from Product Behavior Alignment

Preserved:

- recent deployments collection
- filtering and scanning of deployment records
- opening a specific deployment detail
- refresh behavior
- visible state
- visible version
- visible creation timing

Preserved but reshaped:

- the collection is explicitly recent-history led rather than archive-led
- filtering is made visible and intentional without turning into a complex query builder
- row information priority favors outcome, application, version, and timing over record-like density
- detail entry is made more obvious and consistent
- policy context is kept minimal and only page-relevant
- long history remains accessible, but only through deliberate continuation

---

## Old UI Structures Intentionally Not Inherited

The future Deployments screen intentionally does **not** inherit:

- a generic archive-table posture as the dominant page identity
- dense record-first columns that make deployments feel like backend rows
- oversized filter bulk or control clutter above the results
- diagnostics-heavy collection treatment
- dashboard cards or metric blocks competing with the list
- policy rails or governance walls on a browse surface
- unbounded long-scroll history as the default experience
- vocabulary drift into backend or engine-oriented terms

This is required by [[Product Behavior Alignment]], [[DXCP Core Vocabulary]], [[DXCP UX Grammar]], and [[Decision History is never the default page shape]].

---

## Anti-Patterns to Avoid

- treating the page as a raw deployment archive
- making filters look like an observability query builder
- burying outcome status behind identifiers or excessive metadata
- placing analytics cards above the collection
- showing full policy summaries on each row or in a persistent side rail
- making older history visually equal to recent activity
- forcing users through menus to open deployment detail
- exposing backend nouns such as service, recipe, delivery group model names, deployment record, or engine execution as default browse labels
- letting the screen become the product’s primary home instead of a supporting object collection surface

---

## Summary

The future DXCP Deployments screen is a calm, recent-history-led collection surface for [[DXCP Core Vocabulary#Deployment|Deployment]] records. It preserves the implemented capabilities that matter: filtering, scanning, refresh, clear state and timing visibility, and fast entry into [[Deployment Detail Screen]]. It intentionally reshapes those capabilities so the screen stays operational rather than archival, keeps governance explanation restrained, and presents deployment history as a deliberate browse surface rather than a generic enterprise data table.