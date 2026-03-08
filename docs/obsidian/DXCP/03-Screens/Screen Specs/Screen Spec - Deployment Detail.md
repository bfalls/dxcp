# Screen Spec - Deployment Detail

## Purpose

Define the concrete UI screen specification for the [[Deployment Detail Screen]] as the primary deployment investigation surface in DXCP.

This screen is the place where a developer, delivery owner, or platform admin understands one [[DXCP Core Vocabulary#Deployment|Deployment]] as a coherent story: what happened, why it happened, what changed, and what should happen next.

This screen preserves implemented product capability already confirmed in [[Product Behavior Alignment]] while explicitly refusing to inherit the current bad UI grouping, diagnostics posture, or bulky structure as design law.

---

## Dominant User Question

What happened in this deployment, why did it happen, and what should I do next?

Secondary questions:

- Did this deployment succeed, fail, cancel, or get superseded?
- Did it change what is running?
- Is rollback available and appropriate?
- What policy context governed the result?
- Is deeper diagnostics access available for my role?

---

## Why This Screen Exists

The [[Deployment Detail Screen]] is the investigation surface for one deployment.

It exists because DXCP is object-first and narrative-first. A deployment is not primarily a row in a table or an engine execution to decode. It is a developer-readable operational story owned by DXCP. [[Product Behavior Alignment]] confirms that the current implementation already has strong aligned capability here: specific deployment detail, normalized summary information, ordered timeline events, normalized failures, rollback initiation when allowed, rollback linkage, admin-only engine execution access, and service URL access when available.

This screen preserves that capability and sharpens its hierarchy using the rules already established in [[Deployment Timeline]], [[Failure UX]], [[Guardrails UX]], [[DXCP Layout Behavior]], and [[Shared UI Patterns]]. It must remain timeline-centric, use one primary failure explanation, and keep deep diagnostics secondary. It must explain one deployment story, not become a generic archive or raw engine console.

---

## Relationship to Other Screens and Flows

This screen is:

- the deep investigation view for a single [[DXCP Core Vocabulary#Deployment|Deployment]]
- the narrative realization of [[Deployment Timeline]]
- the primary detailed application of [[Failure UX]]
- the main post-submit destination from [[Deploy Workflow]]
- a drill-in target from [[Application Screen]]
- a drill-in target from [[Deployment Screen]]

This screen is not:

- a deployment archive surface
- a replacement for [[Application Screen]]
- a generic diagnostics console
- an admin configuration surface
- a raw engine execution detail page

---

## Page Header

### Header content

Left side:

- `Deployment <id>` as the primary title
- compact identity row beneath title:
  - Application
  - Environment
  - Version
  - Deployment Strategy
- compact current outcome/state treatment
- compact rollback lineage label when relevant:
  - `Rollback of <deployment id>` for rollback deployments
  - `Rolled back by <deployment id>` when the current deployment was later rolled back
  - `Superseded by a newer deployment` when relevant

Right side:

- **Rollback** as the primary action when allowed and meaningful
- **Open Application** as a secondary action
- optional **Open Service URL** when configured
- admin-only secondary action for execution diagnostics

### Header rules

- Title uses DXCP vocabulary: `Deployment <id>`
- Rollback remains visible when a user could reasonably expect it, even if unavailable
- blocked rollback explanation uses shared blocked-action behavior rather than hiding the action
- admin-only diagnostics must not displace Rollback or Open Application
- header must establish current meaning before the user reads the timeline

### User question answered

What deployment am I looking at, what is its current outcome, and what is the main next action?

### Implemented capability preserved

- specific deployment detail view
- normalized summary information
- rollback initiation
- service URL access
- admin-only execution detail access

### Why it belongs in default view

The page header establishes object identity and decision posture immediately. Without this, the timeline starts without context.

### Pattern alignment

Uses [[Shared UI Patterns#1. Page Header Pattern]], [[Shared UI Patterns#4. Status and Badge Pattern]], and [[Shared UI Patterns#11. Action Placement Pattern]].

---

## Dominant Page Composition

The page uses the DXCP two-column layout defined by [[DXCP Layout Behavior]] and [[Layout Grid]].

### Primary column

Ordered from highest narrative value to lower-supporting detail:

1. Deployment Summary
2. Primary Failure Explanation
3. Deployment Timeline

### Secondary column

Compact supporting context only:

1. Current Running Context
2. Policy Context
3. Deployment Strategy Snapshot
4. Action Context
5. Admin Diagnostics

### Composition rule

The primary column tells the deployment story. The secondary column explains the consequences, governance context, and role-gated deep links around that story. The screen must read as “one deployment investigation” rather than a wall of cards or a split-screen diagnostic workspace.

### Timeline dominance rule

The timeline is the dominant body region of the page. Summary and failure explanation establish framing above it, but they must stay concise enough that the timeline remains the visual and investigative center of gravity.

---

## Default View

The default Deployment Detail view shows:

- clear deployment identity and outcome
- concise immutable deployment summary
- one primary normalized failure explanation when failure or blocked outcome exists
- the canonical chronological deployment timeline
- current running context in the secondary rail
- policy context in the secondary rail
- visible rollback posture
- admin diagnostics only if role permits, and behind restraint

The default view does not show:

- full raw engine diagnostics inline
- a large log-style failure dump
- full application deployment history
- equal-weight side panels competing with the timeline
- policy editing controls
- raw backend nouns as UI labels
- tabbed subnavigation that fragments one deployment story into separate co-equal surfaces

This preserves implemented capability while intentionally not inheriting old page grouping or diagnostics-heavy posture. [[Product Behavior Alignment]]

---

## Section Specifications

### Deployment Summary

#### Purpose

Answer: What deployment was attempted, by whom, and what result did DXCP record?

#### Content

- Application
- Environment
- Version
- Deployment Strategy
- deployment kind
- outcome/state
- created time
- updated time
- requested by
- change summary
- deployment group name
- compact rollback lineage reference when relevant

#### User question answered

What was this deployment, and what is its recorded outcome?

#### Implemented capability preserved

[[Product Behavior Alignment]] confirms preservation of normalized summary information for deployment detail.

#### Why it belongs in default view

The timeline is strongest when the reader already knows the deployment intent and outcome frame.

#### Why it stays concise

This block is framing, not the main story. If it grows too large, it competes with the timeline and weakens investigation speed.

#### Pattern alignment

Uses [[Shared UI Patterns#5. Summary Card Pattern]] and [[Shared UI Patterns#4. Status and Badge Pattern]].

#### Additional rules

- keep the section short enough to remain above the fold with part of the failure or timeline visible on standard desktop
- use compact metadata rows, not a verbose description stack
- preserve immutability posture in tone: this is a recorded deployment, not an editable form

---

### Primary Failure Explanation

#### Purpose

Answer: If something went wrong or was blocked, what failed, why, and what should I do next?

#### Content

Shown only when the deployment has a blocked, failed, rollback-problem, or degraded investigative state.

Contains exactly one primary normalized explanation block with:

- category
- what failed
- why it failed
- one recommended next step
- retryability
- observed time
- optional pointer into the relevant timeline event

#### User question answered

What is the main problem with this deployment, and what is the best next move?

#### Implemented capability preserved

[[Product Behavior Alignment]] confirms normalized failures on deployment detail. [[Failure UX]] requires one normalized primary explanation rather than multiple competing failure surfaces.

#### Why it belongs in default view

When a deployment fails or is blocked, this is the fastest way to make the outcome actionable before the user reads the whole timeline.

#### Why it does not replace the timeline

The failure block explains the main problem. The timeline still tells the full chronological story. This section is a summary lens, not the narrative body.

#### Pattern alignment

Uses [[Failure UX]], [[Shared UI Patterns#5. Summary Card Pattern]], and [[Shared UI Patterns#4. Status and Badge Pattern]].

#### Additional rules

- show only one primary explanation even if multiple failures exist
- secondary failures belong inside expanded timeline detail
- no raw engine dumps here
- for success outcomes, omit this section entirely
- for canceled or superseded outcomes without a true failure, use concise outcome messaging instead of forcing a failure card

---

### Deployment Timeline

#### Purpose

Answer: What happened, in order?

#### Content

Chronological timeline using the canonical event model from [[Deployment Timeline]]:

- intent submitted
- policy checks
- validation events
- quota events
- concurrency events
- execution milestones
- failure observations
- outcome set
- running state update
- rollback lineage events when applicable

Default presentation:

- milestone-first
- chronological
- developer-readable
- normalized wording
- compact timestamps
- expandable detail per event

Expanded event detail may show:

- short explanation text
- related normalized failure details
- one next-step hint near the first failure observation
- admin-only diagnostics references when role permits

#### User question answered

What happened during this deployment, step by step?

#### Implemented capability preserved

[[Product Behavior Alignment]] confirms preservation of ordered timeline events. [[Deployment Timeline]] defines the event grammar and ordering. The current implementation’s timeline behavior is preserved and promoted to the dominant narrative surface.

#### Why it belongs in default view

This is the screen’s primary reason to exist.

#### Why it is dominant

[[Decision Deployment detail screens are timeline-centric]] establishes the timeline as the canonical narrative rather than tables or raw engine stages.

#### Pattern alignment

Uses [[Deployment Timeline]], [[Shared UI Patterns#7. Timeline Pattern]], [[Failure UX]], and [[Shared UI Patterns#10. Progressive Disclosure Pattern]].

#### Additional rules

- timeline must visually dominate the page body
- do not turn the timeline into a dense audit log
- collapse repeatable progress noise into summarized groups when needed
- attach failures to the relevant moment in the timeline
- policy-blocked deployments must stop before any execution milestones
- canceled deployments must end with a clear canceled outcome path
- superseded deployments should still preserve their full own story, with supersession shown as later consequence rather than rewriting history

---

### Current Running Context

#### Purpose

Answer: Did this deployment change what is running now?

#### Content

Compact current running snapshot for the same application/environment:

- running version now
- deployment that established it
- deployment kind
- derived timestamp
- short relationship label relative to the current deployment:
  - `This deployment is the running version`
  - `Running version did not change`
  - `This deployment was later rolled back`
  - `A newer deployment is now running`

#### User question answered

What is running now, and how does that relate to this deployment?

#### Implemented capability preserved

The current product already supports running-state style understanding around deployment investigation. This is aligned with the model in [[DXCP Object Model]] and the post-outcome meaning of deployment detail.

#### Why it belongs in default view

A deployment investigation is incomplete without understanding its consequence on the current running state.

#### Why it is secondary

This is consequential context, not the main chronological story of what happened.

#### Pattern alignment

Uses [[Shared UI Patterns#5. Summary Card Pattern]] and outcome/status treatment from [[Shared UI Patterns#4. Status and Badge Pattern]].

#### Additional rules

- keep compact
- do not present as runtime health
- do not duplicate the deployment summary
- if no successful deployment exists yet, show a purposeful null-running-state treatment

---

### Policy Context

#### Purpose

Answer: What governance context applied to this deployment?

#### Content

Compact policy snapshot showing:

- Deployment Group
- owner if available
- allowed deployment strategies summary
- relevant guardrails:
  - concurrent deployment limit
  - daily deployment quota
  - daily rollback quota
- policy-result emphasis when relevant:
  - blocked by policy
  - blocked by quota
  - blocked by concurrency

#### User question answered

What rules governed this deployment, and did policy affect the result?

#### Implemented capability preserved

[[Product Behavior Alignment]] confirms rollback explanation and role-aware behavior, and current product behavior preserves policy/governance context. [[Guardrails UX]] requires policy context to remain visible in deployment detail.

#### Why it belongs in default view

Governance context materially changes how users interpret blocked and failed outcomes.

#### Why it stays in the secondary rail

Policy context supports interpretation, but the deployment story itself still belongs to the timeline.

#### Pattern alignment

Uses [[Guardrails UX]], [[Shared UI Patterns#5. Summary Card Pattern]], and [[Shared UI Patterns#3. Alert Rail Pattern]] when a page-level policy explanation is needed.

#### Additional rules

- this is a policy snapshot, not a live editor
- keep counts and limits readable, not telemetry-heavy
- if policy was not materially involved in the outcome, keep the section concise and calm

---

### Deployment Strategy Snapshot

#### Purpose

Answer: What delivery behavior was used for this deployment?

#### Content

Compact display of:

- Deployment Strategy name
- revision used, if available
- frozen behavior summary / effective behavior summary

#### User question answered

What deployment strategy was used, and what behavior did it represent at the time?

#### Implemented capability preserved

Current implementation preserves recipe/revision style behavior context. This is retained but reshaped into [[DXCP Core Vocabulary#Deployment Strategy]] language.

#### Why it belongs behind restraint

Useful for investigation, but still secondary to summary, failure explanation, and timeline.

#### Pattern alignment

Vocabulary aligns to [[DXCP Core Vocabulary#Deployment Strategy]] rather than backend recipe terminology.

#### Additional rules

- use user-facing strategy language only
- do not expose engine mapping here
- keep brief enough that it does not compete with policy context

---

### Action Context

#### Purpose

Answer: What can I do from here?

#### Content

Contextual action block with:

- Rollback posture
- Open Application
- Open Service URL when configured
- compact explanation when Rollback is unavailable

Rollback posture states may include:

- available
- unavailable because no prior successful deployment exists
- unavailable because concurrency blocks it
- unavailable because rollback quota is exhausted
- unavailable because mutations are disabled
- unavailable because role does not permit it
- unavailable because the deployment outcome does not make rollback meaningful

#### User question answered

What action is appropriate from this deployment right now?

#### Implemented capability preserved

[[Product Behavior Alignment]] confirms rollback initiation when allowed and role-aware behavior.

#### Why it belongs in default view

The deployment detail page must end in a clear next step, not just explanation.

#### Why Rollback is primary

DXCP exists to make rollback fast, obvious, and safe. When appropriate, rollback is the consequential primary action for this screen.

#### Pattern alignment

Uses [[Shared UI Patterns#11. Action Placement Pattern]], [[Guardrails UX]], and [[Interaction Patterns]].

#### Additional rules

- the page header owns the actual primary action
- this section reinforces action meaning and blocked explanation
- do not add unrelated actions that dilute rollback posture
- explicitly state that rollback creates a new deployment, not a mutation of this record

---

### Admin Diagnostics

#### Purpose

Answer: If I am a platform admin and the normalized story is not enough, what deeper references can I open?

#### Content

Role-gated, collapsed-by-default section containing only when available:

- engine type
- execution id
- execution deep link
- request id
- operator hint
- compact reason codes where materially useful

#### User question answered

What deeper diagnostics are available to an admin without polluting the default reading path?

#### Implemented capability preserved

[[Product Behavior Alignment]] confirms admin-only engine execution detail access and admin-only diagnostics.

#### Why it belongs behind progressive disclosure

These details are important for advanced debugging but violate DXCP’s default engine-agnostic reading path if always visible.

#### Pattern alignment

Uses [[Shared UI Patterns#10. Progressive Disclosure Pattern]] and [[Failure UX]] deep-diagnostics layer.

#### Additional rules

- hidden entirely for non-admin roles
- collapsed by default for admins
- no raw engine logs inline
- should feel like referenced deep debug, not part of the main story

---

## Actions

### Primary actions

- **Rollback**
- creates a new rollback deployment when allowed
- requires explicit confirmation

### Secondary actions

- **Open Application**
- **Open Service URL** when configured
- admin-only **Open execution diagnostics**
- event-level expand/collapse within the timeline

### Blocked actions

Rollback remains visible when the user would expect it.

Blocked rollback states must explain:

- what is blocked
- why it is blocked
- what rule or condition caused it
- what to do next

Examples of blocked causes include:

- no prior successful deployment in the same application/environment
- concurrent deployment already active
- rollback quota exhausted
- mutation kill switch enabled
- read-only role
- delivery-group scope restriction
- permission-limited diagnostics

### Action rules

- Rollback is the only page-level primary action
- Open Application is always secondary
- execution diagnostics are always secondary and admin-only
- no action should require users to understand engine internals

---

## State Model

### Loading

The page loads with deployment identity preserved:

- page header remains visible
- section placeholders preserve final spatial story
- summary, failure, timeline, and secondary rail placeholders load in place
- no generic blank-screen replacement

If timeline data loads after summary data, keep the timeline region reserved so the page does not recompose unpredictably.

### Empty

This screen does not use a generic empty state for a valid deployment id. A found deployment always has a summary and a timeline shape, even if the timeline is very short.

If timeline evidence is unusually sparse:

- show the deployment summary
- show the available milestones
- add a concise degraded-evidence note rather than a full empty-state treatment

### Read-failure

If the deployment cannot be read:

- use the page alert rail for the page-level failure
- preserve page identity if the deployment id is known
- show a focused read-failure state in the main column
- do not replace the whole surface with a generic application-level error shell

If secondary context fails separately, preserve the timeline and summary whenever possible.

### Canceled

If the deployment was canceled:

- header shows `Canceled`
- no failure card unless a normalized failure materially explains the cancellation
- timeline ends in a canceled outcome
- current running context clarifies whether anything changed
- rollback posture is typically unavailable unless product rules explicitly support it

### Superseded

If the deployment succeeded but is no longer current:

- header and current running context make supersession explicit
- timeline remains the story of this deployment itself
- no large warning treatment unless user needs corrective action
- rollback posture is evaluated on real policy/state, not assumed from superseded status alone

### Rollback-unavailable

If rollback cannot be performed:

- keep Rollback visible when expectation is reasonable
- explain the specific reason in the alert rail when page-level
- reinforce the reason in Action Context
- do not imply that rollback mutates this deployment

### Permission-limited

If the user can read the deployment but cannot rollback:

- show read-only or blocked action posture
- explain the role-based restriction clearly
- keep admin diagnostics hidden unless the role allows them
- do not hide the existence of the action when that would create confusion

### Degraded-read

If DXCP can read the deployment record but cannot refresh supporting engine-adjacent metadata:

- preserve summary, failure, and timeline narrative
- show a restrained diagnostic/degraded alert
- allow admin deep links only when actually available

---

## History Access

This screen explains one deployment story.

History access is provided through:

- direct object links back to [[Application Screen]]
- intentional return to [[Deployment Screen]]
- lineage links when rollback or supersession relationships exist

Rules:

- do not embed full application deployment history inline
- do not add a historical side table beneath the timeline
- do not turn the page into a mixed detail-plus-archive surface

This directly follows [[Decision History is never the default page shape]].

---

## Responsive Behavior

### Standard desktop

- two-column layout
- primary column visibly dominant
- summary and primary failure explanation above the timeline
- secondary rail compact and clearly subordinate
- timeline remains the dominant body region

### Narrow desktop and tablet

- columns stack
- order remains:
  1. summary
  2. primary failure explanation
  3. timeline
  4. current running context
  5. policy context
  6. strategy snapshot
  7. action context
  8. admin diagnostics
- Rollback remains in the page header
- diagnostics remain progressive, not promoted

### Small screens

- preserve one deployment story, not a different IA
- page header remains compact with Rollback still primary when allowed
- summary condenses into short metadata groups
- failure explanation stays short and high-signal
- timeline uses compact milestone rows with tap-to-expand detail
- secondary context follows the timeline, never before it
- admin diagnostics remain collapsed and low-prominence

Responsive behavior must preserve the same investigation story across widths.

---

## Density and Restraint Rules

- timeline is the dominant body region
- summary and failure framing must stay concise
- no equal-weight wall of side panels
- no raw log blocks in the default view
- no tabbed fragmentation of one deployment story
- no large telemetry treatment for guardrails
- no archive table under the detail page
- admin diagnostics must not visually compete with the timeline
- the first screenful on standard desktop should establish outcome, main problem if any, and entry into the timeline without long scrolling

---

## Role-Aware Behavior

### Delivery owner

- can inspect deployment story
- sees Rollback as the main action when allowed
- receives blocked rollback explanations when policy or state disallow action
- does not see admin diagnostics

### Observer

- can inspect deployment story and current running context
- sees read-only action posture
- does not see Rollback as available
- does not see admin diagnostics

### Platform admin

- same primary deployment investigation experience as other roles
- may open admin diagnostics through progressive disclosure
- may access execution detail links
- admin-only detail must not distort the default page into a diagnostics console

This follows the role model and governance behavior established in GOVERNANCE_CONTRACT.md.

---

## Shared Patterns Used

- [[Shared UI Patterns#1. Page Header Pattern]]
- [[Shared UI Patterns#2. Section Header Pattern]]
- [[Shared UI Patterns#3. Alert Rail Pattern]]
- [[Shared UI Patterns#4. Status and Badge Pattern]]
- [[Shared UI Patterns#5. Summary Card Pattern]]
- [[Shared UI Patterns#7. Timeline Pattern]]
- [[Shared UI Patterns#8. State Block Pattern]]
- [[Shared UI Patterns#10. Progressive Disclosure Pattern]]
- [[Shared UI Patterns#11. Action Placement Pattern]]
- [[Failure UX]]
- [[Guardrails UX]]
- [[Deployment Timeline]]
- [[Interaction Patterns]]

---

## Implemented Capabilities Preserved from Product Behavior Alignment

Preserved:

- specific deployment detail view
- normalized summary information
- ordered timeline events
- normalized failures
- rollback initiation when allowed
- rollback explanation and lineage/linkage
- admin-only engine execution detail access
- service URL access when available
- role-aware behavior
- timeline-centered investigation posture

Preserved but reshaped:

- failure explanation is elevated into one primary normalized block before deeper timeline detail
- policy context remains visible but restrained in the secondary rail
- rollback is treated as the consequential primary action rather than just one action among peers
- admin diagnostics remain available but intentionally hidden by default
- current running consequence is made explicit as supporting context

---

## Old UI Structures Intentionally Not Inherited

The new Deployment Detail screen intentionally does **not** inherit:

- diagnostics-heavy default layouts
- engine-oriented grouping as the primary page shape
- equal-weight summary, diagnostics, and timeline panels
- raw API or engine terminology as the main explanatory copy
- history/archive material mixed into the page body
- any assumption that failures should be explained by multiple competing surfaces
- any old grouping that makes policy context or admin detail compete with the timeline

This is required by [[Product Behavior Alignment]], [[Deployment Timeline]], [[Failure UX]], and [[DXCP Core Vocabulary]].

---

## Anti-Patterns to Avoid

- raw pipeline or stage views as the main explanation
- long diagnostic dumps above the timeline
- making policy context as visually strong as the narrative
- hiding rollback entirely when the user expects to see it
- making the page a split archive plus detail surface
- exposing backend nouns such as service, recipe, delivery group model names, deployment record, or engine execution as default UX labels
- forcing users to open diagnostics before understanding the normalized story
- using tabs to break one deployment into disconnected subpages

---

## Summary

The future DXCP Deployment Detail screen is a calm, timeline-dominant investigation surface centered on one deployment story. It preserves the strongest implemented capability already present in DXCP: normalized deployment detail, ordered timeline narrative, normalized failure explanation, rollback linkage, and role-aware deep diagnostics. It reshapes that capability into a clearer hierarchy where concise summary framing and one primary failure explanation lead into the canonical timeline, while policy context, running consequence, rollback posture, and admin diagnostics remain supportive rather than competitive.