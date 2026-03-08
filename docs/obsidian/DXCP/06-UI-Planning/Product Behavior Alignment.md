# Product Behavior Alignment

## Purpose

This note translates the currently implemented DXCP product behavior into aligned UI planning guidance.

It exists to preserve real product capability from the current implementation while explicitly preventing the current bad UI structure from becoming design law.

This note should be used together with [[DXCP Core Vocabulary]], [[DXCP UX Grammar]], [[DXCP Object Model]], [[DXCP Information Architecture]], [[Guardrails UX]], [[Failure UX]], [[Interaction Patterns]], [[Shared UI Patterns]], [[Application Screen]], [[Deployment Screen]], [[Deployment Detail Screen]], [[Insights Screen]], [[Admin Screen]], and [[Deploy Workflow]].

---

## Source hierarchy

1. The Obsidian vault and aligned product docs define intended DXCP product language, UX structure, and planning direction.
2. The current implementation defines what behavior exists today.
3. The current UI presentation is not authoritative.

### Product truth

DXCP is an intent-first control plane that should let users understand what is running, submit safe deployment intent, understand deployment outcomes, and act within policy without learning engine mechanics.

### Implementation truth

The current product already implements meaningful operational and governance behavior across application browsing, deployment submission, deployment history/detail, insights, settings, and admin configuration.

### Bad UI anti-pattern truth

The current implementation also contains presentation decisions that must not be inherited automatically:
- top-level navigation that exposes workflow surfaces too early
- vocabulary drift from DXCP UX language
- placeholder tabs that imply ownership without delivering full capability
- admin and diagnostics surfaces mixed into default navigation density
- current grouping and layout that over-exposes secondary detail

---

## Confirmed implemented product surfaces

## 1. Application collection and application detail

### Implemented behavior

The product currently exposes:
- a top-level collection of deployable services
- a detail view for a single service
- latest deployment status and version visibility
- delivery-group visibility
- recent deployment history
- failure visibility
- links into deployment detail
- optional external/context links such as Backstage and service URL when configured
- a deploy entry point from application context
- promotion behavior tied to environment order

### DXCP restatement

This is the implemented basis for the [[Application Screen]].
In DXCP vocabulary, the current “service” behavior is really [[DXCP Core Vocabulary#Application|Application]] behavior.

### Judgment

**Preserve**, with major **Reshape**.

### Why

The object-centered operational workspace is correct.
The current implementation already proves the product needs an application-level workspace.
However:
- `Service` must not survive as the primary UX noun
- the current tab shape should not be treated as the final page structure
- placeholder tabs must not define future ownership
- promotion behavior introduces an environment-model contradiction that must be resolved explicitly

---

## 2. Deploy intent submission

### Implemented behavior

The product currently supports:
- deployment intent entry
- service/application selection
- strategy selection through recipes
- version selection and refresh
- required change summary
- policy-first review and preflight validation
- visible guardrail context
- blocked deploy explanation
- submission to create a deployment record
- admin-only diagnostics such as deeper error/request detail when present

### DXCP restatement

This is the implemented basis for [[Deploy Workflow]].

### Judgment

**Preserve**, with major **Reshape**.

### Why

This is core product capability and aligns strongly with intent-first DXCP.
What must change is not the capability but the framing:
- deploy should live primarily in application context
- user-facing strategy language should align to [[DXCP Core Vocabulary]]
- policy explanation should use consistent shared patterns rather than page-specific treatment
- admin diagnostics must remain secondary and role-gated

---

## 3. Deployment collection

### Implemented behavior

The product currently supports:
- a recent deployments collection
- filtering/scanning of deployment records
- opening a specific deployment detail
- refresh behavior
- visible state, version, and creation timing

### DXCP restatement

This is the implemented basis for [[Deployment Screen]].

### Judgment

**Preserve**, with moderate **Reshape**.

### Why

A deployment collection is clearly a real product surface.
It matches the object model.
The redesign should preserve the capability while avoiding a purely archive/table-first feel.
The collection should remain a browse surface, not become the default primary story for the product.

---

## 4. Deployment detail and rollback

### Implemented behavior

The product currently supports:
- a specific deployment detail view
- normalized summary information
- ordered timeline events
- normalized failures
- rollback initiation when allowed
- rollback explanation and linkage
- admin-only engine execution detail access
- service URL access when available

### DXCP restatement

This is the implemented basis for [[Deployment Detail Screen]] and depends on the model in [[Deployment Timeline]] and [[Failure UX]].

### Judgment

**Preserve**.

### Why

This is one of the strongest alignments between implementation and vault architecture.
The timeline, normalized failure treatment, and rollback linkage are real product capability and must survive intact.
The redesign should refine structure and hierarchy, not alter ownership.

---

## 5. System-wide insights

### Implemented behavior

The product currently supports:
- system-wide insights
- rollback rate
- failure category breakdown
- deployments by strategy/recipe
- deployments by deployment group
- time-window filtering
- service and deployment-group filtering

### DXCP restatement

This is the implemented basis for [[Insights Screen]].

### Judgment

**Preserve**, with moderate **Reshape**.

### Why

The capability is real and valuable.
The current implementation confirms DXCP already has a system-level observability surface.
What must change is presentation:
- avoid list-of-metrics bulk treatment
- use the screen ownership defined by [[Insights Screen]]
- keep drill-down paths clear
- prevent insights from becoming a generic dashboard wall

---

## 6. User settings

### Implemented behavior

The product currently supports:
- per-user refresh interval control
- bounded/clamped refresh behavior
- admin visibility into configured defaults

### DXCP restatement

This is legitimate product behavior, but not a primary operational surface.

### Judgment

**Preserve**, with strong **Reshape**.

### Why

The capability is fine.
The current top-level prominence is not.
This should not shape the primary product IA.
It should be treated as secondary product chrome or a lightweight settings surface, not a first-class core workflow destination.

---

## 7. Admin configuration workspace

### Implemented behavior

The product currently supports meaningful admin behavior for:
- deployment groups
- recipes
- system rate limits
- CI publisher allowlists/match rules
- mutation kill switch
- UI exposure policy toggles
- audit event viewing
- environment foundations
- deployment-group environment policy
- service environment routing
- identity diagnostics

### DXCP restatement

This is the implemented basis for [[Admin Screen]] and aligns with [[Decision Admin is a separate configuration workspace]].

### Judgment

Mixed:
- **Preserve**
- **Reshape**
- **Hide from default UX**
- some items are **Open product question**

### Why

The product clearly has a real admin workspace.
That is correct.
But the current implementation blends:
- durable product admin capability
- advanced platform diagnostics
- future environment-management foundations
- exposure-policy and identity-debugging controls

These should not all carry equal weight in the redesigned UX.

---

## Behavior to preserve

## A. Application as a real operational object

Preserve:
- application list
- application detail
- current running/latest deployment understanding
- recent history access
- failure visibility
- deploy entry from application context

Why:
This matches [[DXCP Object Model]] and [[DXCP Information Architecture]].

## B. Deployment intent with policy-first validation

Preserve:
- required change summary
- version selection
- strategy selection
- visible guardrails
- preflight review
- blocked deploy explanation
- deployment creation as a deliberate act

Why:
This is core DXCP product value and aligns with [[Deploy Workflow]] and [[Guardrails UX]].

## C. Deployment detail as the investigation surface

Preserve:
- deployment summary
- normalized timeline
- normalized failures
- rollback action when allowed
- rollback lineage
- admin-only execution deep links

Why:
This is the clearest current implementation of DXCP’s explainability model and aligns with [[Deployment Detail Screen]], [[Deployment Timeline]], and [[Failure UX]].

## D. System-wide insights

Preserve:
- rollback rate
- failure category breakdown
- deployment-group and strategy breakdown
- time-window filtering

Why:
These are real implemented observability capabilities and belong in [[Insights Screen]].

## E. Role-aware blocked action behavior

Preserve:
- read-only admin experience for non-admin users where intentionally exposed
- hidden or disabled mutating actions based on role/policy
- clear blocked reasons on deploy and rollback
- admin-only access to engine-linked diagnostics

Why:
This aligns with [[Interaction Patterns]], [[Guardrails UX]], and DXCP’s role-aware product model.

## F. Auditability and governance configuration

Preserve:
- admin editing for policy objects
- preview/validation before saving
- audit visibility for admin actions
- global governance settings such as rate limits and mutation kill switch

Why:
These are meaningful platform-governance capabilities and belong in the product.

---

## Behavior to reshape

## A. “Services” must become “Applications”

### Implemented behavior

The product uses service-oriented labeling.

### DXCP restatement

Use [[DXCP Core Vocabulary#Application|Application]] in the UX.

### Judgment

**Reshape**

### Why

The vault explicitly establishes `Application` as the user-facing noun.
Current implementation proves the object exists.
Only the language is wrong for DXCP UX.

---

## B. “Recipes” must not automatically remain the primary user-facing noun

### Implemented behavior

Deploy and admin surfaces use `Recipe` heavily.

### DXCP restatement

In aligned DXCP UX, users choose a [[DXCP Core Vocabulary#Deployment Strategy|Deployment Strategy]].
Recipe may remain an implementation/admin construct if needed.

### Judgment

**Reshape** / **Open product question**

### Why

The vault vocabulary and admin architecture lean toward Strategy language while current implementation and docs use Recipe.
Future UI specs must not assume the current term is canon.
An explicit decision is required on:
- whether standard users only ever see `Deployment Strategy`
- whether platform admins see `Strategy` with recipe diagnostics beneath it
- whether `Recipe` survives anywhere in the UI

---

## C. Standalone Deploy navigation

### Implemented behavior

The current UI exposes a top-level Deploy page.

### DXCP restatement

Deploy is primarily a workflow entered from application context via [[Deploy Workflow]].

### Judgment

**Reshape**

### Why

Current implementation confirms deploy capability exists.
It does not justify a top-level workflow-first navigation model.
Future UI specs should treat deploy as an action-first flow, not as proof that generic standalone deploy navigation is correct.

---

## D. Application detail tab model

### Implemented behavior

The current detail view uses Overview, Deploy, History, Failures, and Insights tabs, including placeholders and redirect-like behavior.

### DXCP restatement

The [[Application Screen]] should own the primary application story with clear section hierarchy and links to deeper screens.

### Judgment

**Reshape**

### Why

The tabs expose legitimate capability categories, but the current ownership is not the design authority.
Future specs should preserve capability while using the page shapes and summary-first rules already established in the vault.

---

## E. Insights presentation

### Implemented behavior

Insights are rendered as a compact list-style analytics surface.

### DXCP restatement

[[Insights Screen]] should remain system-level observability, not metric clutter.

### Judgment

**Reshape**

### Why

Keep the metrics and filters, improve hierarchy and drill-down paths, and prevent dashboard sprawl.

---

## F. Settings prominence

### Implemented behavior

Settings is primary-nav visible.

### DXCP restatement

Refresh preferences are secondary product controls.

### Judgment

**Reshape**

### Why

Preserve capability.
Reduce IA prominence.

---

## G. Admin information architecture

### Implemented behavior

Admin currently exposes many subsections at similar weight.

### DXCP restatement

[[Admin Screen]] should separate:
- core governance objects
- advanced system controls
- diagnostics
- future or foundation-only environment tooling

### Judgment

**Reshape**

### Why

The capability exists, but equal-weight navigation inside Admin would carry bad structure forward.

---

## Behavior to hide from default UX

## A. Engine-linked diagnostics

Hide from default UX:
- execution ids
- execution URLs
- raw engine mapping
- low-level diagnostic payload detail

Why:
These are valid admin/operator tools but violate default DXCP comprehension if made primary.

## B. Identity and exposure-policy diagnostics

Hide from default UX:
- who-am-I token/identity diagnostics
- UI exposure-policy toggles
- CI publisher matching details

Why:
These are platform diagnostics and governance internals, not default delivery UX.

## C. Advanced system controls

Hide from default UX:
- mutation kill switch
- rate-limit editing
- advanced publisher configuration

Why:
These belong in deep admin context, not near normal operator workflows.

## D. Environment foundation and routing tools

Hide from default UX:
- environment foundations
- deployment-group environment policy editors
- service environment routing editors

Why:
These are advanced admin/foundation capabilities and currently sit in tension with the stated v1 product model.
They must not bleed into the standard delivery UX.

---

## Behavior to remove

## A. Current UI structure as inherited law

Remove from future specs:
- current top-level grouping as precedent
- current tab count as precedent
- current card/list density as precedent
- current wording as precedent

Why:
This note exists specifically to prevent that inheritance.

## B. Placeholder ownership surfaces

Remove from future specs:
- placeholder tabs or sections that imply full ownership without delivering a real surface
- duplicate deploy framing that does not add product value

Why:
Screen ownership should be explicit and aligned to the vault.

## C. User-facing backend terminology

Remove from future specs:
- `Service` as the primary user-facing noun
- `Recipe` as an unexamined default noun
- raw engine labels as normal UI language

Why:
This contradicts [[DXCP Core Vocabulary]] and [[DXCP UX Grammar]].

---

## Governance and explainability alignment

The current implementation already demonstrates several aligned governance behaviors that future UI specs must preserve:

- policy-first validation before action
- visible quota/concurrency context
- blocked-action explanation
- role-sensitive mutating access
- admin-only deeper diagnostic context
- audit visibility for governance changes
- rollback as a governed, explainable product action
- normalized failure categorization rather than raw engine output

This aligns strongly with [[Guardrails UX]], [[Failure UX]], and [[UX-Principles]].

Future UI specs should treat these as product features, not secondary warning text.

---

## Role and blocked-state alignment

The current implementation confirms the need for explicit state handling across roles and access conditions.

Future specs must preserve:

## Loading
- collection loading
- detail loading
- policy/preflight loading
- admin settings loading

## Empty
- no deployments yet
- no failures
- no insights for filters
- no admin objects configured

## Read failure
- API failure surfaces
- request correlation when useful
- actionable retry paths

## Permission-limited
- observer cannot mutate
- non-admin users cannot perform admin changes
- admin-only diagnostics remain visible only where justified

## Policy-blocked
- deploy blocked by policy, compatibility, quota, concurrency, or kill switch
- rollback blocked by policy or prerequisite failure

These states should be normalized through [[Interaction Patterns]] and shared UI patterns, not reinvented per screen.

---

## Future UI spec guidance

### Core rule

Preserve capability.
Do not preserve the current bad UI.

### Screen-spec implications

Future screen specs must preserve these confirmed capabilities:
- application collection and application detail
- deployment submission with preflight and guardrail context
- deployment collection
- deployment detail with timeline, failures, and rollback
- system-wide insights
- governance/admin configuration
- role-aware blocked-state behavior

Future screen specs must explicitly avoid inheriting:
- current navigation wording
- current standalone deploy framing as default law
- current tab taxonomy as default law
- current admin grouping as default law
- current diagnostic exposure as default law
- current visual density and card/list structure as default law

### How to use this note in future UI screen spec sessions

Use this note to preserve implemented product capability.

Do not use the current bad UI structure as law.

Screen specs must reuse [[Shared UI Patterns]].

Screen specs may improve structure if product capability is preserved and UX alignment is improved.

---

## Open product contradictions requiring explicit decisions

## 1. Single-environment v1 vs implemented multi-environment foundations

Contradiction:
- aligned product docs and decisions describe a v1 single-environment model
- implementation already contains environment foundations, routing, policy, selection, and promotion behavior

Why it matters:
This affects navigation, page header context, application detail, deploy flow, and admin IA.

Decision needed:
- treat multi-environment capability as future/admin-foundation only
- or acknowledge that product reality has already moved beyond the original v1 assumption

---

## 2. Application-context deploy vs standalone Deploy page

Contradiction:
- aligned IA says deploy should primarily start from application context
- implementation has a first-class top-level deploy route

Why it matters:
This affects top nav, entry points, and how intent-first DXCP feels.

Decision needed:
- remove standalone deploy from primary navigation
- keep it as a secondary shortcut
- or formalize a justified hybrid model

---

## 3. Deployment Strategy vs Recipe terminology

Contradiction:
- vault UX language centers on Deployment Strategy
- implementation and some product docs use Recipe

Why it matters:
This affects deploy, admin, insights, and all future screen specs.

Decision needed:
- whether Recipe is fully hidden behind Deployment Strategy
- whether admins see both layers
- whether a migration note/design decision is needed

---

## 4. Admin visibility model for non-admin users

Contradiction:
- current implementation exposes Admin entry broadly with read-only behavior for many users
- the final DXCP admin IA may want stricter separation

Why it matters:
This affects discoverability, role comprehension, and product polish.

Decision needed:
- keep read-only visibility for awareness
- or limit Admin entry to admins and move non-admin explanation elsewhere

---

## 5. Promotion as a first-class workflow

Contradiction:
- current implementation includes promotion behavior on the application surface
- aligned docs do not yet treat promotion as a settled first-class UX surface

Why it matters:
This affects [[Application Screen]], [[Deploy Workflow]], environment modeling, and history semantics.

Decision needed:
- formalize promotion as a first-class flow
- or treat current behavior as implementation lead-time that should remain hidden until architecture catches up

---