# Visual State Definitions

## Purpose

This note defines the formal visual-state rules for DXCP so semantic conditions are rendered with one coherent emphasis model across delivery-facing and admin surfaces.

It exists to make [[Component Families]], [[Component State Coverage]], [[Role-Aware Behavior Rules]], [[Responsive Component Rules]], and [[Component and System Planning]] visually executable without reopening settled composition, hierarchy, navigation, or responsive decisions already captured in [[Screen Spec - Application]], [[Screen Spec - Deployment Detail]], [[Screen Spec - Deploy Workflow]], [[Screen Spec - Deployments]], [[Screen Spec - Insights]], [[Screen Spec - Admin]], [[Shared UI Patterns]], [[Navigation and Cross-Screen Behavior]], [[Responsive and Density Rules]], and [[Visual Language Direction]].

---

## Visual-state stance

DXCP visual state handling must feel calm, premium, and intentional even when the product is communicating risk, blockage, degradation, or failure.

The governing stance is:

- visual emphasis is earned, not ambient
- structure and typography carry most hierarchy before color does
- semantic states must be easy to distinguish without turning the product into a loud dashboard
- blocked, disabled, unavailable, and read-only remain separate meanings
- primary explanation stays normalized and user-facing
- diagnostics remain secondary disclosure
- review-heavy admin moments gain seriousness through framing and sequencing, not alarm styling

DXCP should look like a trustworthy delivery control plane under stress, not a flashing monitoring console.

---

## State emphasis model

DXCP uses a five-level visual emphasis scale.

### Level 0 — Quiet baseline

Used for normal stable content, supporting metadata, secondary labels, and neutral chrome.

This is the default visual state of the product.
Most surfaces should live here most of the time.

### Level 1 — Semantic signal

Used for ordinary status communication that matters to scanning but does not demand interruption.

Typical use:
- current deployment outcome
- in-progress state
- deprecation markers
- category labels
- secondary operational cues in collections and summaries

This level should support recognition without becoming a page accent system.

### Level 2 — Caution and changed conditions

Used when the user should notice a meaningful condition but should not interpret it as immediate failure.

Typical use:
- warning states
- degraded-read notices
- review-needed signals
- elevated but not blocking policy conditions
- stale or partial supporting evidence

This level should feel firm and visible, not alarming.

### Level 3 — Blocking or failed conditions

Used when DXCP must clearly communicate that an action cannot proceed or that a core read or mutation path has failed.

Typical use:
- blocked submit
- blocked rollback
- read failure for a primary page region
- save failure
- terminal deployment failure summary
- route-level access restriction when relevant

This level should be unmistakable, but still controlled.

### Level 4 — Destructive confirmation and high-risk commit moments

Used sparingly for explicit irreversible or governance-sensitive decision points.

Typical use:
- destructive confirmation
- admin review-before-save when material scope expansion or policy impact is present
- changes that newly allow, newly block, or materially widen platform behavior

This is the rarest emphasis level in DXCP.
It must feel serious through contrast and containment, not through theatrics.

---

## Semantic status rules

Status should be legible at a glance and calm at rest.

### Stable and in-progress states

Stable success, normal activity, and in-progress conditions should use restrained semantic indication with one primary state marker near the object identity or object row.

Rules:
- prefer one primary state indicator per object
- state indicator plus short adjacent text is preferred over badge clusters
- in-progress should feel active but controlled, never animated into noise
- successful state should read as resolved and trustworthy, not celebratory

### Warning states

Warnings indicate meaningful caution without implying immediate failure.

Rules:
- use warning treatment for heightened attention, not for every non-ideal condition
- warning should not visually overpower the object identity
- warning language should explain what needs review, not only that caution exists

### Deprecated and muted support states

Deprecated, secondary, or informational state markers should remain visually subordinate to current operational state.

Rules:
- deprecation should be recognizable but not louder than current object state
- supporting tags should stay muted and semantically narrow
- semantic indicators must not become a generic labeling system

---

## Alert and severity rules

The [[Shared UI Patterns#3. Alert Rail Pattern|Alert Rail]] remains the canonical page-level condition surface.

Severity should be distinguished by meaning first, then by emphasis.

Per [[Sticky Shell and Alert Presentation Decision]], page-level and route-level conditions use a compact sticky global alert strip, while action-level and section-level conditions use local explanation blocks near the affected work.

### Informational

Use for non-blocking context that helps interpretation.

Examples:
- refresh completed with older supporting data
- saved preference explanation
- route context note when needed

Informational alerts should stay visually light and short-lived in attention demand.

### Warning

Use when the user should pause, review, or understand elevated risk, but the page still works and the action may still proceed.

Examples:
- partial policy preview
- configuration change with downstream implications
- degraded supporting read
- limit-adjacent or stale conditions

Warnings should feel noticeable and calm.

### Blocking

Use when DXCP prevents the user from doing the intended action now.

Examples:
- policy denial
- concurrency lock
- quota exhaustion
- mutation kill switch
- access restriction on a route or subsection

Blocking alerts must state:
- what is blocked
- why it is blocked
- what governing rule or condition caused it
- what to do next when possible

### Failure

Use when DXCP cannot complete a core read or mutation responsibility.

Examples:
- page read failure
- submit failure
- save failure
- unresolved deployment failure outcome
- unavailable required dependency for a core screen path

Failure treatment should be strong enough to be clear, but still subordinate to the product frame and page hierarchy.

---

## Blocked vs disabled vs unavailable vs read-only rules

These meanings must never collapse into one visual treatment.

### Blocked

Blocked means the user can understand the action and would reasonably expect to use it, but DXCP or policy prevents it now.

Visual rule:
- keep the action visible when expectation is high
- pair the blocked condition with a clear explanation in the compact global alert strip or a local explanation block, depending on scope
- preserve the action’s identity so the user understands what is being denied

Blocked should feel denied with explanation, not merely inactive.

### Disabled

Disabled means the control cannot act yet because prerequisites are incomplete, missing, or still resolving.

Visual rule:
- show inactive control treatment without failure-level emphasis
- use nearby inline guidance when the missing prerequisite is local to the control or form
- do not use blocked language unless policy or governance actually denied the action

Disabled should feel unfinished, not forbidden.

### Unavailable

Unavailable means the capability, route, or subsection is not present or not enterable in the current product or access context.

Visual rule:
- prefer absence or focused unavailable-state treatment over a field of dead controls
- do not render full partial shells just to show denial
- when deep-linked into an unavailable area, provide a focused explanation and durable next path

Unavailable should feel structurally out of scope, not temporarily inactive.

### Read-only

Read-only means the user may inspect the object or screen fully enough to understand it, but mutation is intentionally not allowed.

Visual rule:
- keep content fully legible
- remove or downgrade mutation affordances without making the page look broken
- use quiet read-only framing where needed, not warning or failure framing by default

Read-only should feel intentional and valid.

---

## Degraded-read and failure presentation rules

DXCP must distinguish partial usefulness from core failure.

### Degraded-read

Degraded-read means meaningful primary content is still available, but freshness, supporting evidence, or secondary reads are incomplete.

Presentation rules:
- preserve the normal page structure
- keep the main object or collection visible
- identify the degraded region or supporting dependency clearly
- use caution-level emphasis rather than failure-level emphasis
- avoid collapsing the whole page into an error state when the primary story can still be told

Degraded-read should help the user continue working with informed caution.

### Failure

Failure means the primary job of the region or page cannot be completed.

Presentation rules:
- use a focused failure state block for the failed region or page
- preserve shell, page title, and action geography when possible
- explain the failure in normalized product language first
- expose diagnostics only as secondary disclosure where the product already authorizes them
- do not let raw backend detail become the first thing the user sees

Failure should feel clear and contained, not chaotic.

### Failure inside timelines and collections

When failure appears inside [[Deployment Timeline]] or object collections:
- the local failure cue should support scan and drill-in
- the full explanation belongs in the destination detail or designated failure explanation area
- timeline failure moments should remain part of the narrative, not detached alarm artifacts

---

## Review and confirmation emphasis rules

DXCP must distinguish ordinary editing from review-heavy commitment.

### Review-before-save emphasis

Review-heavy moments matter most in [[Screen Spec - Admin]] and other governed mutation flows.

Rules:
- review emphasis should increase contrast, framing clarity, and comparison legibility
- emphasis should come from ordered structure, impact preview, and changed-state framing
- warnings may be present, but review posture must not look like system failure
- the product should help the user see what changed, what risk exists, and what becomes newly allowed, warned, or blocked

Review should feel deliberate and high-confidence.

### Confirmation emphasis

Confirmation surfaces should scale their emphasis to consequence.

Rules:
- ordinary confirmation remains compact and calm
- destructive or high-governance confirmation may step up to the highest emphasis level
- confirmation must restate the action, target object, and meaningful consequence
- confirmation should not introduce new diagnostic density unless the action specifically requires it

Confirmation should feel decisive, not dramatic.

---

## Diagnostic disclosure rules

Diagnostics support comprehension, but they do not own the page.

Rules:
- normalized explanation always comes first
- request identifiers, operator hints, validation traces, or engine-adjacent details remain secondary disclosure
- delivery-facing screens keep diagnostics minimal and explicitly subordinate
- admin surfaces may expose deeper detail, but only behind progressive disclosure or advanced sections
- diagnostics should never visually outrank the main user-facing explanation

Admin diagnostics must remain secondary to the normalized explanation posture established in [[Failure UX]] and [[Guardrails UX]].

---

## Interaction with component families and screen compositions

This note defines stable visual-state rules for shared families.
It does not redefine screen composition.

### Shared families governed here

These rules directly govern:
- [[Component Families#3. Alert, guardrail, and blocked-state explanation family|alert, guardrail, and blocked-state explanation family]]
- [[Component Families#4. Status and semantic indicator family|status and semantic indicator family]]
- [[Component Families#10. State block family|state block family]]
- [[Component Families#11. Review-before-save editing family|review-before-save editing family]]
- [[Component Families#12. Confirmation surface family|confirmation surface family]]
- supporting use across summary, timeline, collection, and integration families

### Composition-specific usage remains elsewhere

This note does not decide:
- which screen gets which alert first
- where a specific summary block sits in a layout
- how a specific screen sequences its sections
- which exact fields appear in a review surface

Those decisions remain in:
- [[Screen Spec - Application]]
- [[Screen Spec - Deployment Detail]]
- [[Screen Spec - Deploy Workflow]]
- [[Screen Spec - Deployments]]
- [[Screen Spec - Insights]]
- [[Screen Spec - Admin]]
- [[Navigation and Cross-Screen Behavior]]
- [[Responsive and Density Rules]]

---

## Implementation planning implications

This note has direct implementation-planning consequences.

### 1. Semantic state tokens must be finite

Implementation should use a small, explicit set of visual state categories rather than per-screen invention.

### 2. Explanation layers must be separate from raw diagnostics

The implementation model should distinguish:
- normalized user-facing explanation
- optional diagnostic disclosure
- local component-state presentation

### 3. Blocked, disabled, unavailable, and read-only require separate render paths

They are not stylistic variants of one inactive state.

### 4. Degraded-read needs a real visual path

Implementation must support partial usefulness without forcing full failure rendering.

### 5. Review-heavy and destructive confirmation need stronger framing primitives

Implementation should support elevated review and confirmation treatment without borrowing failure styling for every serious moment.

### 6. Visual restraint is a quality gate

Any implementation that increases badge density, uses severity color as the main hierarchy system, or turns diagnostics into first-view content is out of alignment with DXCP.

---

## Summary

DXCP visual state handling should create one restrained emphasis system across delivery and admin surfaces.

The system must:
- keep calmness as the baseline
- escalate deliberately
- preserve semantic distinctions between blocked, disabled, unavailable, and read-only
- distinguish degraded-read from failure
- make review-before-save serious without making it alarming
- keep diagnostics subordinate to normalized explanation

The result should be a product that remains high-confidence and legible even when it is communicating risk, denial, or failure.