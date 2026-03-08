# Screen Spec - Application

## Purpose

Define the concrete UI screen specification for the [[Application Screen]] as the primary operational workspace in DXCP.

This screen is the default place where a developer or delivery owner understands what is running now, what changed recently, what needs attention, and whether a new deployment can be started safely.

This screen preserves implemented product capability already confirmed in [[Product Behavior Alignment]] while explicitly refusing to inherit the current bad UI structure as design law.

---

## Dominant User Question

What is happening with this application right now, and what can I do next?

Secondary questions:

- What version is currently running?
- What changed recently?
- Is there an active problem I need to care about?
- Can I deploy now?
- What governance context applies?

---

## Why This Screen Exists

The [[Application Screen]] is the primary object workspace in DXCP.

It exists because DXCP is object-first and intent-first, not workflow-first or dashboard-first. The Application surface is where current understanding and next action meet. [[Product Behavior Alignment]] confirms that the currently implemented service detail surface already proves the need for an application-level operational workspace, including running state, recent deployment visibility, failure visibility, links into deployment detail, deploy entry, delivery group context, and optional external links. Those capabilities are preserved here, but reshaped into aligned DXCP vocabulary and composition. [[DXCP Information Architecture]] also makes clear that users should begin from Applications and operate within object context rather than from a generic deploy destination. [[Decision History is never the default page shape]] further requires the page to stay present-tense and summary-first. [[Product Behavior Alignment]]

---

## Relationship to Other Screens and Flows

This screen is:

- the object workspace for a single [[DXCP Core Vocabulary#Application|Application]]
- the primary entry into [[Deploy Workflow]]
- the main object-side entry into [[Deployment Detail Screen]]
- a summary surface that references, but does not duplicate, the deeper story defined by [[Deployment Timeline]]
- a place where governance context from [[Guardrails UX]] and failure explanation from [[Failure UX]] appear in restrained form

This screen is not:

- a replacement for [[Deploy Workflow]]
- a deployment archive surface
- a system-wide observability surface
- an admin workspace

---

## Page Header

### Header content

Left side:

- Application name
- optional compact sublabel for current environment only when needed for clarity
- optional compact metadata line for last refresh or external identity if materially useful and non-bulky

Right side:

- **Deploy** as the primary action
- **Refresh** as a secondary action

### Header rules

- The title uses DXCP vocabulary: `Application: <name>`
- Deploy remains visible even when blocked, with explanation handled through shared blocked-action patterns
- Refresh never displaces Deploy
- No tab strip appears under the page header
- No history, failures, or insights tabs are used as the default structure

### User question answered

What object am I looking at, and what is the main thing I can do here?

### Implemented capability preserved

- application/service detail entry
- deploy entry from application context
- refresh behavior

### Why it belongs in default view

This is the entry point to the Application workspace and establishes the page’s intent immediately.

### Pattern alignment

Uses [[Shared UI Patterns#1. Page Header Pattern]] and [[Shared UI Patterns#11. Action Placement Pattern]].

---

## Dominant Page Composition

The page uses the DXCP two-column layout defined by [[DXCP Layout Behavior]].

### Primary column

Ordered from highest present-tense value to lower priority supporting signal:

1. Running Version
2. Recent Deployment Activity
3. Failure Summary

### Secondary column

Compact supporting context only:

1. Deployment Group context
2. Guardrail summary
3. Deployment Strategy availability summary
4. Optional integrations/context links only if configured and compact

### Composition rule

The primary column tells the operational story. The secondary column explains the constraints around that story. The page must feel like one calm operational workspace, not a set of equal competing panels.

---

## Default View

The default Application view shows:

- current running version for the application
- a bounded recent deployment slice
- notable recent failures needing attention
- a visible Deploy action
- restrained governance context that explains what governs deploy without dominating the page

The default view does not show:

- full deployment history
- multi-tab application subnavigation
- standalone deploy form embedded into the page body
- insights-heavy trend analysis
- deep diagnostics
- admin controls
- promotion workflow as a default section

This preserves the implemented application object workspace while intentionally not inheriting the old overview/deploy/history/failures/insights tab model. [[Product Behavior Alignment]]

---

## Section Specifications

### Running Version

#### Purpose

Answer: What is currently running?

#### Content

- running version
- current deployment outcome/state indicator as appropriate
- environment label
- deployment kind where meaningful
- deployment link that established current running state
- derived time
- compact explanatory text only when needed to clarify that the running state comes from DXCP’s normalized record model

#### User question answered

What version is running right now, and what deployment established it?

#### Implemented capability preserved

[[Product Behavior Alignment]] confirms preservation of latest deployment status and version visibility and current running state behavior at the application/service level.

#### Why it belongs in default view

This is the highest-value operational fact on the page. The Application screen fails if this is not quickly visible.

#### Pattern alignment

Uses [[Shared UI Patterns#5. Summary Card Pattern]] and status treatment from [[Shared UI Patterns#4. Status and Badge Pattern]].

#### Additional rules

- Must appear above the fold on standard desktop
- Must not be visually buried under explanatory copy
- If no successful deployment exists, show a purposeful empty state rather than a blank panel

---

### Recent Deployment Activity

#### Purpose

Answer: What changed recently?

#### Content

A bounded recent collection of deployments for this application showing:

- outcome/state
- version
- deployment strategy label
- created time
- rollback indicator where applicable
- entry action to open [[Deployment Detail Screen]]

#### User question answered

What are the most recent deployments I should know about?

#### Implemented capability preserved

[[Product Behavior Alignment]] confirms preservation of recent deployment history, deployment detail entry, state/version/timing visibility, and rollback linkage.

#### Why it belongs in default view

Recent change is part of present-tense understanding. It belongs on the page, but only as a short operational slice.

#### Why full history is not default

[[Decision History is never the default page shape]] explicitly says Application pages should emphasize current health, recent deployments, notable issues, and easy access to more history rather than a full archive.

#### Pattern alignment

Uses [[Shared UI Patterns#6. Table and Collection Pattern]] in comfortable-list form, not a dense archive table.

#### Additional rules

- Show only a short recent slice by default
- Include a clear “View deployment history” path into [[Deployment Screen]] or equivalent scoped history view
- Do not let this region grow into a tall archive feed
- Keep action labels simple: `Open Deployment` or row click equivalent

---

### Failure Summary

#### Purpose

Answer: Is there a problem that needs attention?

#### Content

A bounded recent failure summary for this application showing only notable recent failures tied to the recent deployment slice:

- failure category
- one-line summary
- short next-step/action hint when available
- link to inspect the related [[Deployment Detail Screen]]

#### User question answered

What is failing or recently failed, and what should I inspect next?

#### Implemented capability preserved

[[Product Behavior Alignment]] confirms preservation of failure visibility on the application/service surface, and [[Failure UX]] defines normalized failure explanation as a product feature.

#### Why it belongs in default view

A developer should not need to enter deployment detail just to realize that recent delivery has a meaningful problem.

#### Why it stays summary-level

This screen should surface actionable awareness, not become the full failure investigation surface. Deep narrative and diagnostics belong in [[Deployment Detail Screen]].

#### Pattern alignment

Uses [[Failure UX]], [[Shared UI Patterns#5. Summary Card Pattern]], and [[Shared UI Patterns#4. Status and Badge Pattern]].

#### Additional rules

- Only recent and relevant failures appear
- No raw engine diagnostics in this section
- If recent activity has no failures, the section becomes a calm positive state rather than disappearing entirely

---

### Deployment Group Context

#### Purpose

Answer: What policy scope governs this application?

#### Content

Compact display of:

- deployment group name
- owner if present
- short governance framing sentence only when needed

#### User question answered

Which deployment group governs this application?

#### Implemented capability preserved

[[Product Behavior Alignment]] confirms preservation of delivery-group visibility at the application/service level.

#### Why it belongs in default view

The governing object is important, but it is supporting context, not the primary story.

#### Pattern alignment

Uses the secondary context rail from [[DXCP Layout Behavior]] and section framing from [[Shared UI Patterns#2. Section Header Pattern]].

#### Additional rules

- Keep this section compact
- It should not become an editable mini-admin surface
- Avoid long descriptions by default

---

### Guardrail Summary

#### Purpose

Answer: What limits or policy conditions affect deploy from here?

#### Content

Compact summary of the most decision-relevant guardrails, such as:

- max concurrent deployments
- daily deploy quota
- daily rollback quota
- current blocked reason when applicable

#### User question answered

What could stop me from deploying, and why?

#### Implemented capability preserved

[[Product Behavior Alignment]] confirms preservation of visible guardrail context and blocked deploy explanation, while [[Guardrails UX]] requires guardrails to be visible at decision points.

#### Why it belongs in default view

Deploy is the primary page action, so the page must provide immediate policy context. But it remains supportive because the page is not itself the deploy form.

#### Pattern alignment

Uses [[Guardrails UX]] and [[Shared UI Patterns#5. Summary Card Pattern]] in a restrained secondary-rail treatment.

#### Additional rules

- Show the summary, not full policy prose
- Only show richer explanation when a real block or warning exists
- Use the alert rail for page-level blocking conditions that materially affect action

---

### Deployment Strategy Availability

#### Purpose

Answer: What approved deployment paths are available for this application?

#### Content

Compact list or count of allowed deployment strategies for this application’s deployment group.

#### User question answered

What deployment strategies can this application use?

#### Implemented capability preserved

The current product exposes recipe allowlists. [[Product Behavior Alignment]] says this capability should be preserved but reshaped so `Recipe` does not remain the primary user-facing noun.

#### Why it belongs behind restraint

Availability context is useful near Deploy, but it is secondary to running state and recent activity.

#### Pattern alignment

Vocabulary aligns to [[DXCP Core Vocabulary#Deployment Strategy]] rather than backend recipe terminology.

#### Additional rules

- Use “Deployment Strategy” in user-facing copy
- Do not expose engine mapping here
- Keep the section compact and scannable

---

### Integrations and Context Links

#### Purpose

Answer: Is there an external system I may need to open from here?

#### Content

Optional compact external/context links such as Backstage or service URL when configured.

#### User question answered

What adjacent context can I open for this application?

#### Implemented capability preserved

[[Product Behavior Alignment]] confirms optional external/context links such as Backstage and service URL when configured.

#### Why it is secondary

Helpful, but not central to DXCP’s operational story.

#### Additional rules

- Only render if configured
- Keep it below governance context
- Do not let integration links become visual clutter

---

## Actions

### Primary actions

- **Deploy**
- opens [[Deploy Workflow]] already scoped to this application when possible

### Secondary actions

- **Refresh**
- **View deployment history**
- **Open Deployment** from recent activity or failures
- optional external links

### Blocked actions

Deploy remains visible when unavailable.

Blocked deploy states must explain:

- what is blocked
- why
- what rule caused it
- what the user should do next

This follows [[Interaction Patterns]] and [[Guardrails UX]].

### Action rules

- Deploy is the only page-level primary action
- History access is secondary and intentional
- Investigation actions are local to recent activity and failures
- No action should require learning engine internals

---

## State Model

### Loading

The page loads with the full Application identity preserved:

- page header remains visible
- section placeholders preserve final layout
- no generic blank page replacement

If running state, recent activity, and failure summary load at different speeds, keep section-level loading distinct without changing page identity.

This preserves the same spatial story required by [[DXCP Layout Behavior]] and [[Interaction Patterns]].

### Empty

If the application has no successful deployment yet:

- Running Version shows a clear empty state
- Recent Deployment Activity may still show attempts if they exist
- Failure Summary shows either recent failures or a calm empty state
- Deploy remains visible if allowed

### No results

This screen does not use a broad no-results mode in its default state. Any filtered or scoped history behavior should move to the history surface, not distort the default Application screen.

### Read failure

If the page cannot read one or more sections:

- use the page alert rail for page-level read failure
- preserve already available sections when possible
- show section-level read-failure blocks where a single section failed
- avoid collapsing the whole page into a generic error state

### Permission-limited

If the user can view the Application but cannot deploy:

- keep Deploy visible in a disabled or blocked state
- explain the reason using role-aware blocked-action language
- do not hide the action entirely when a reasonable user would expect it

### Policy-blocked

If deploy is blocked by current policy or state, surface that in the alert rail and reinforce it near the Deploy action and guardrail summary.

---

## History Access

History exists, but is not the default page shape.

History access is provided through:

- a bounded recent deployment slice in default view
- clear intentional path to scoped deployment history
- direct entry into [[Deployment Detail Screen]] from recent items and failures

Rules:

- do not embed the full deployment archive inline
- do not use tabs to make history co-equal with present-tense understanding
- do not let failure history become a second archive on the same page

This directly follows [[Decision History is never the default page shape]] and the Application guidance in [[Product Behavior Alignment]].

---

## Responsive Behavior

### Standard desktop

- two-column layout
- primary column visibly dominant
- secondary rail narrow and restrained
- Running Version and Deploy remain visible high on the page

### Narrow desktop and tablet

- columns stack
- primary content remains first
- secondary context follows after the primary operational story
- Deploy remains in the page header
- section order remains unchanged in meaning

### Small screens

- preserve the same story, not a different information architecture
- page header remains compact with Deploy still primary
- recent activity uses compact rows/cards rather than a wide table
- guardrail summary remains short
- history remains intentional, not expanded inline

Responsive behavior must add compression, not new page logic. This follows [[DXCP Layout Behavior]] and [[Shared UI Patterns#12. Anti-Bulk and Restraint Rules]].

---

## Density and Restraint Rules

- The page must feel summary-first and operational
- No tabbed subnavigation on the default Application screen
- No equal-weight wall of cards
- No archive table in the default view
- No large explanatory hero content
- Secondary context must remain compact enough that the user still reads the page as “running state and recent change first”
- Integration and governance sections must not compete with the primary story
- Keep failure summary recent and bounded
- Default page should be readable without long scrolling on normal desktop

---

## Role-Aware Behavior

### Delivery owner

- can inspect application state
- sees Deploy as the main action when allowed
- receives policy-block explanations when blocked

### Observer

- can inspect current running state, recent deployments, and failures
- sees view-only action posture
- Deploy remains visible only if that improves clarity, but blocked/read-only treatment must explain that deployment is unavailable for this role

### Platform admin

- same primary operational experience as other roles
- may receive additional linked diagnostics only through progressive disclosure or linked investigation surfaces
- admin-only details must not distort the default Application page into an admin workspace

This follows the role model and blocked-action principles in the governance docs and shared interaction rules. GOVERNANCE_CONTRACT.md [[Interaction Patterns]]

---

## Shared Patterns Used

- [[Shared UI Patterns#1. Page Header Pattern]]
- [[Shared UI Patterns#2. Section Header Pattern]]
- [[Shared UI Patterns#3. Alert Rail Pattern]]
- [[Shared UI Patterns#4. Status and Badge Pattern]]
- [[Shared UI Patterns#5. Summary Card Pattern]]
- [[Shared UI Patterns#6. Table and Collection Pattern]]
- [[Shared UI Patterns#8. State Block Pattern]]
- [[Shared UI Patterns#11. Action Placement Pattern]]
- [[Guardrails UX]]
- [[Failure UX]]
- [[Interaction Patterns]]

---

## Implemented Capabilities Preserved from Product Behavior Alignment

Preserved:

- application as a real operational object
- current running state visibility
- latest status/version visibility
- recent deployment visibility
- failure visibility
- links into deployment detail
- deploy entry from application context
- deployment group visibility
- visible guardrail context
- blocked deploy explanation
- optional integration/context links when configured

Preserved but reshaped:

- service detail becomes Application detail
- recipe visibility becomes Deployment Strategy visibility
- deploy remains application-contextual, not generic top-level workflow-first navigation
- recent activity remains summary-first instead of tab/archive-first
- promotion behavior is not made a default Application section until the open product contradiction is resolved explicitly

---

## Old UI Structures Intentionally Not Inherited

The new Application screen intentionally does **not** inherit:

- the existing application detail tab model
- the old “Services” noun
- the old “Recipe” noun as the primary user-facing term
- the assumption that history, failures, deploy, and insights should each be separate co-equal tabs
- the current standalone top-level Deploy framing as the primary product posture
- admin or deep diagnostic density mixed into the default object workspace
- any old layout grouping purely because it exists today

This is required by [[Product Behavior Alignment]], [[DXCP Core Vocabulary]], and [[DXCP Information Architecture]].

---

## Anti-Patterns to Avoid

- generic dashboard card wall
- tabs as a substitute for hierarchy
- embedding the full deploy form in the default page body
- making the secondary rail as tall and visually strong as the primary column
- showing long history lists inline
- exposing backend nouns such as service, recipe, delivery group model names, deployment record, or current running state as UI labels
- surfacing engine diagnostics in the default operational reading path
- adding promotion UI by default before the product contradiction is settled

---

## Summary

The future DXCP Application screen is a calm, summary-first operational workspace centered on current running state, recent deployment activity, recent failure awareness, and a visible Deploy action. It preserves the real implemented product capability already present in DXCP, but reshapes that capability into the aligned DXCP vocabulary, object ownership, and present-tense page structure established by the vault.