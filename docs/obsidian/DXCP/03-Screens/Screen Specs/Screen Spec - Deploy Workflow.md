# Screen Spec - Deploy Workflow

## Purpose

The [[Deploy Workflow]] is the primary intent submission surface in DXCP.

It allows a user to express a deployment request clearly, understand policy and eligibility before submission, resolve issues before action, and move directly into [[Deployment Detail Screen]] after submission.

This screen is a workflow surface, not a configuration surface and not a raw form shell over engine mechanics.

The workflow must preserve real implemented capability while staying aligned to [[DXCP Core Vocabulary]], [[DXCP UX Grammar]], [[DXCP Object Model]], [[Guardrails UX]], [[Failure UX]], [[Shared UI Patterns]], and [[Layout Grid]].

---

## Dominant User Question

```text
Can I safely deploy this Application now, and what will happen if I do?
```

Secondary questions:

```text
Which version should I deploy?
Which Deployment Strategy is allowed?
What policy applies right now?
Why is submission blocked?
What happens next after I submit?
```

---

## Why This Screen Exists

DXCP needs one deliberate place where deployment intent becomes a real [[DXCP Core Vocabulary#Deployment|Deployment]].

The user should not need to:
- understand engine stages
- interpret raw diagnostics
- infer policy ordering
- guess whether a block is fixable
- wonder where to go after submission

This screen exists to make deployment intent explicit, safe, explainable, and calm.

---

## Relationship to Other Screens and Flows

The deploy workflow is related to but distinct from adjacent screens.

- [[Application Screen]] is the primary operational workspace and the preferred place to enter this workflow.
- [[Deployment Detail Screen]] is the post-submit handoff destination and the investigation surface for a created deployment.
- [[Deployment Timeline]] defines the deployment story model that the user enters after submission.
- [[Guardrails UX]] defines how policy and blocked states are explained.
- [[Failure UX]] informs how validation and submission failures are normalized and explained.
- [[Interaction Patterns]] and [[Shared UI Patterns]] define the shared structure for alerts, sections, actions, and disclosure.

The workflow should feel like a short, intentional action path between understanding an [[DXCP Core Vocabulary#Application|Application]] and opening the resulting [[DXCP Core Vocabulary#Deployment|Deployment]].

---

## Page Header

### Header content

Preferred application-context entry:

```text
Deploy Application: payments-api
```

Standalone entry when application is not preselected:

```text
Deploy Application
```

Right-side actions:

```text
Deploy
Cancel
Refresh
```

`Deploy` is the only primary action.

`Refresh` is secondary and refreshes selectable source data such as available versions or strategy choices.

`Cancel` returns the user to the most relevant prior object context.

### Header rules

- The page header owns the workflow identity.
- The title uses DXCP vocabulary only.
- The header does not carry dense metadata.
- Submission remains in the page header so the user always knows where the main action lives.
- The primary action remains visible even when the form scrolls.
- If submission is blocked, the `Deploy` action stays visible but disabled with the blocking explanation surfaced in the Alert Rail and relevant inline locations.

### User question answered

```text
What action am I taking here, and how do I complete it?
```

### Implemented capability preserved

- real deploy submission
- refresh behavior
- deliberate action confirmation posture
- clear path from intent entry to record creation

### Why it belongs in default view

The workflow exists to culminate in a single deliberate action.
Hiding submit or scattering actions into lower sections would weaken clarity.

### Pattern alignment

- [[Shared UI Patterns#1. Page Header Pattern]]
- [[DXCP UX Grammar]]
- [[Layout Grid]]

---

## Dominant Page Composition

### Primary column

The primary column contains the intent-entry story:

1. Application Context
2. Deployment Intent
3. Pre-Submit Review
4. Validation and Blocking Feedback when present

### Secondary column

The secondary column contains durable supporting context:

1. Deployment Group Context
2. Guardrails
3. Allowed Deployment Strategy context
4. compact environment context when needed
5. progressive admin diagnostics when allowed

### Composition rule

The left side is always where the user edits and decides.

The right side explains policy, governance, and secondary meaning.

The workflow must not become a symmetrical two-column page.
The right rail supports the decision but never competes with the form.

### Entry-mode rule

The workflow has two entry modes but one canonical structure:

- **Application-context entry**  
  The Application is already known. The workflow begins with a compact locked application context section.
- **Standalone entry**  
  The user arrives without application context. The workflow begins by selecting an Application, then resolves the rest of the workflow around that choice.

The structure remains the same after application selection resolves.
DXCP should not create two different deploy experiences.

---

## Default View

Default desktop shape:

```text
----------------------------------------------------
Alert Rail
----------------------------------------------------

Deploy Application: payments-api                 Deploy

----------------------------------------------------

Primary Column (left)

Application Context
Deployment Intent
Pre-Submit Review

----------------------------------------------------

Secondary Column (right)

Deployment Group Context
Guardrails
Allowed Deployment Strategy Context
Admin Diagnostics (only when allowed and opened)
```

Default behavior rules:

- if entered from [[Application Screen]], prefill and lock the application
- if standalone, require application selection before the rest of the workflow fully expands
- keep the page short enough that the complete decision story fits within a restrained workflow surface
- do not turn the screen into a multi-step wizard unless future product complexity forces it

The default experience should feel like a structured review-and-submit workflow, not a long enterprise form.

---

## Section Specifications

### Application Context

#### Purpose

Establish what [[DXCP Core Vocabulary#Application|Application]] is being deployed and what fixed context is already known before the user edits deployment intent.

#### Content

Application-context entry:
- Application
- Environment
- current running version summary
- entry link back to [[Application Screen]]

Standalone entry:
- Application selector
- after selection, resolved Environment
- compact current running version summary once known

#### User question answered

```text
What Application am I deploying, and what is already true before I choose anything else?
```

#### Implemented capability preserved

- service/application selection
- application-context deploy entry
- visibility into current application target before submission

#### Why it belongs in default view

The workflow cannot be understood without clear object ownership.
This must appear first.

#### Why it stays concise

This section should orient the user, not re-create the full [[Application Screen]].
Only the minimum context needed for safe deployment belongs here.

#### Pattern alignment

- [[DXCP Object Model]]
- [[Application Screen]]
- [[Shared UI Patterns#2. Section Header Pattern]]

#### Additional rules

- Use `Application`, never internal service terminology.
- If only one environment exists in v1, show it as fixed context rather than a decision burden.
- The current running version is summary-only here and should link outward for deeper context.

---

### Deployment Intent

#### Purpose

Collect the editable deployment choices that define the [[DXCP Core Vocabulary#Deployment|Deployment]] request.

#### Content

Fields in order:

1. Deployment Strategy
2. Version
3. Change Summary

Field behavior:

- **Deployment Strategy**
  - required
  - filtered to allowed choices for the resolved [[DXCP Core Vocabulary#Deployment Group|Deployment Group]]
  - show short strategy description
- **Version**
  - required
  - selectable from registered versions
  - supports refresh
  - may support direct entry only if the version model remains validated the same way
- **Change Summary**
  - required
  - multi-line text field
  - concise, human-authored explanation of what is changing

Resolved non-editable context:

- Application
- Environment

#### User question answered

```text
What exactly am I asking DXCP to deploy?
```

#### Implemented capability preserved

- strategy selection
- version selection
- version refresh
- required change summary
- deployment intent entry

#### Why it belongs in default view

This is the core of the workflow.
Without it there is no deploy action.

#### Why this grouping is default

These fields define the actual intent object and should stay together.
Splitting them across multiple cards or unrelated regions would weaken comprehension.

#### Pattern alignment

- [[DXCP Object Model]]
- [[Deploy Workflow]]
- [[Shared UI Patterns]]
- [[DXCP UX Grammar]]

#### Additional rules

- Present `Deployment Strategy` as the user-facing noun even if implementation uses recipe underneath.
- Do not expose engine mappings, pipeline names, or recipe internals in the default form.
- Change Summary should explain why the summary matters in operational terms, not compliance jargon.
- Environment should not appear as a heavy selector in v1 if it is fixed.

---

### Pre-Submit Review

#### Purpose

Provide a compact confirmation region that shows the resolved deployment request before submission.

#### Content

Review rows:

- Application
- Environment
- Deployment Strategy
- Version
- Change Summary
- Deployment Group
- immediate policy outcome summary when known

Optional confirmation text:

```text
DXCP will validate this deployment against policy before execution.
```

#### User question answered

```text
What is about to happen if I press Deploy?
```

#### Implemented capability preserved

- policy-first review
- deliberate submission posture
- clear final intent confirmation

#### Why it belongs in default view

Deploy is a high-consequence action.
A compact review region reduces accidental submission without turning the flow into ceremony.

#### Why it stays compact

This is not a second copy of the form.
It is a concise confidence-building checkpoint.

#### Pattern alignment

- [[Deploy Workflow]]
- [[Guardrails UX]]
- [[Shared UI Patterns#6. Summary Card Pattern]]

#### Additional rules

- Update live as fields change.
- Keep rows stable and scannable.
- If policy checks have not yet run, do not fabricate certainty.
- If validation has run and passed, reflect that clearly but quietly.

---

### Deployment Group Context

#### Purpose

Explain which [[DXCP Core Vocabulary#Deployment Group|Deployment Group]] governs the deployment and why that matters.

#### Content

- Deployment Group name
- owner if available
- short explanation of governance scope
- allowed [[DXCP Core Vocabulary#Environment|Environment]] context when relevant
- link to more detail only for users who can open governance views

#### User question answered

```text
What governance boundary applies to this deployment?
```

#### Implemented capability preserved

- visible deployment-group context
- policy scope visibility during deployment

#### Why it belongs in default view

Governance is part of DXCP product value.
Users should not have to discover policy only after a block happens.

#### Why it stays in the secondary rail

This is critical context, but it supports the decision rather than being the main task.

#### Pattern alignment

- [[DXCP Core Vocabulary]]
- [[DXCP Object Model]]
- [[Guardrails UX]]
- [[Shared UI Patterns]]

#### Additional rules

- Keep wording calm and explanatory.
- Do not overload this section with admin editing affordances.
- This section explains scope, not governance internals.

---

### Guardrails

#### Purpose

Show the policy limits and safety rules that affect this deployment before submission.

#### Content

- max concurrent deployments
- daily deployment quota
- daily rollback quota when relevant as reference context
- current remaining quota when available
- high-level eligibility state such as:
  - allowed now
  - review needed
  - blocked now

#### User question answered

```text
What guardrails apply right now, and are they likely to stop this deployment?
```

#### Implemented capability preserved

- visible guardrail context
- pre-submit policy visibility
- blocked deploy explanation basis

#### Why it belongs in default view

Guardrails are a first-class DXCP feature.
Users should see governing limits before they try to act.

#### Why it stays in the secondary rail

It informs the decision continuously without interrupting primary form entry.

#### Pattern alignment

- [[Guardrails UX]]
- [[DXCP Core Vocabulary]]
- [[Shared UI Patterns]]
- [[Failure UX]]

#### Additional rules

- Show policy in user language, not raw error codes.
- Use concise labels and one-sentence explanatory text where needed.
- When a limit is already exceeded, the section should reflect that visibly before submit.

---

### Guardrail Explanation and Blocked Submit

#### Purpose

Explain why submission is blocked, what DXCP checked, and what the user can do next.

#### Content

Page-level blocking state uses the Alert Rail and may be reinforced with an in-flow explanation block.

Possible explanations include:
- selected strategy is not allowed for this Application's Deployment Group
- version is not registered
- daily quota has been reached
- another deployment is already active
- mutations are disabled
- the user does not have permission to deploy

Explanation structure:

1. what happened
2. why it is blocked
3. what the user can do next

Examples:

```text
Deployment blocked by policy

This Application already has an active deployment in its Deployment Group.
Wait for the current deployment to finish, or open the active Deployment for details.
```

```text
Deployment blocked

The selected version is not registered for this Application.
Choose a registered version or refresh available versions.
```

#### User question answered

```text
Why can’t I deploy, and what should I do next?
```

#### Implemented capability preserved

- blocked deploy explanation
- policy-first behavior
- validation-before-submit behavior
- role-aware blocked reasons

#### Why it belongs in default view

A blocked deployment is still the main story of the workflow.
The explanation must be immediate and unmissable.

#### Why it uses shared explanation patterns

DXCP should not invent one-off blocking treatments per workflow.
Policy and failure explanation should remain consistent across screens.

#### Pattern alignment

- [[Guardrails UX]]
- [[Failure UX]]
- [[Shared UI Patterns#3. Alert Rail Pattern]]
- [[Interaction Patterns]]

#### Additional rules

- Explain enforcement ordering in user terms:
  - governance first
  - eligibility next
  - availability limits after that
  - execution only after earlier checks pass
- Do not expose raw engine sequencing.
- Raw API codes may exist only in admin diagnostics.
- A blocked state must never leave the user guessing whether retry is useful.

---

### Validation Ordering and Explainability

#### Purpose

Make the workflow feel deterministic without exposing engine mechanics or backend jargon.

#### Content

A compact explanatory note associated with validation and blocked states:

```text
DXCP checks deployment policy and eligibility before starting execution.
If a requirement fails, DXCP stops there and explains the first blocking issue.
```

Optional ordered labels for admin-visible detail may map to:
- policy
- compatibility
- quota
- concurrency

#### User question answered

```text
In what order does DXCP decide whether this deployment can proceed?
```

#### Implemented capability preserved

- policy-first validation
- blocked-submit ordering
- preflight validation posture

#### Why it belongs in default view

Users need a stable mental model for why one issue is shown first and why some later checks are not shown yet.

#### Why it stays lightweight

The workflow should communicate sequence without becoming a backend explainer page.

#### Pattern alignment

- [[Guardrails UX]]
- [[DXCP UX Grammar]]
- [[Failure UX]]

#### Additional rules

- Never show engine execution as part of the pre-submit story unless validation has passed and submission has occurred.
- The default explanation should use DXCP language only.
- The workflow should feel rule-driven, not mysterious.

---

### Admin Diagnostics

#### Purpose

Expose deeper request and diagnostic detail only for users who need it, without polluting the default deployment path.

#### Content

Progressively disclosed panel for allowed users only:

- request id
- deeper operator hint
- raw error code
- low-level validation detail
- underlying implementation identifiers only when materially useful

#### User question answered

```text
Is there deeper operator detail I can use to troubleshoot this blocked or failed submission?
```

#### Implemented capability preserved

- admin-only diagnostics
- deeper error or request detail when present

#### Why it belongs behind progressive disclosure

This is valid capability, but not part of the default DXCP comprehension model.

#### Pattern alignment

- [[Failure UX]]
- [[Guardrails UX]]
- [[Shared UI Patterns#11. Progressive Disclosure Pattern]]

#### Additional rules

- Hidden by default.
- Never required to understand whether deployment is allowed.
- Must be clearly role-gated.
- Must not displace the human-readable explanation.

---

### Success Handoff

#### Purpose

Move the user cleanly from intent submission into the created [[DXCP Core Vocabulary#Deployment|Deployment]].

#### Content

On success:
- success confirmation
- created deployment identifier
- immediate link or redirect to [[Deployment Detail Screen]]
- optional note that live execution progress will continue there

Example:

```text
Deployment started

Deployment 9831 was created for payments-api.
Open Deployment
```

Preferred behavior:
- automatic redirect to [[Deployment Detail Screen]] after a brief visible confirmation state
- preserve enough confirmation that the user understands the handoff was intentional

#### User question answered

```text
What happened after I pressed Deploy, and where do I follow it now?
```

#### Implemented capability preserved

- submission creates deployment record
- post-submit movement into deployment detail
- clear handoff into investigation surface

#### Why it belongs in default view

Submission completion is part of the primary workflow story.
The user should not be left on the form wondering what changed.

#### Why it should hand off quickly

The deploy workflow is not the long-term place to watch execution.
That responsibility belongs to [[Deployment Detail Screen]].

#### Pattern alignment

- [[Deployment Detail Screen]]
- [[Deployment Timeline]]
- [[Shared UI Patterns]]
- [[Interaction Patterns]]

#### Additional rules

- Avoid a dead-end success toast with no durable object link.
- Preserve entered values if the redirect fails.
- If duplicate submission or idempotent replay semantics surface in UX later, explain that in deployment terms rather than API language.

---

## Actions

### Primary actions

- Deploy
- Open Deployment (after success)

### Secondary actions

- Cancel
- Refresh
- Open Application
- View active Deployment when blocked by concurrency

### Blocked actions

The `Deploy` action may be disabled or intercepted by a blocking explanation when:
- required fields are incomplete
- the user is read-only
- policy blocks the request
- validation detects a non-retryable issue
- a request conflict prevents safe submission

### Action rules

- Only one primary action at a time.
- `Deploy` remains the dominant action until a deployment record exists.
- After success, `Open Deployment` becomes the clear next action if automatic redirect is not immediate.
- Do not place alternative high-weight actions beside `Deploy`.
- Avoid action wording like `Execute`, `Run pipeline`, or `Submit record`.

---

## State Model

### Loading

Use loading skeletons for:
- application context
- strategy availability
- available versions
- guardrails
- deployment-group context

Rules:
- preserve page structure while data loads
- keep the header visible
- show that the workflow is resolving context, not frozen

### Empty

Possible empty states:
- no deployable Applications available
- no registered versions available
- no allowed Deployment Strategies available

Each empty state should explain:
- what is missing
- whether the user can fix it
- where to go next

### Validation-failure

Use inline field guidance for field-level issues and Alert Rail messaging for page-level blocks.

Examples:
- missing change summary
- no strategy selected
- invalid or unknown version

### Blocked-submit

Use the Alert Rail plus the Guardrail Explanation block.

This state must be explicit, actionable, and calm.

### Request-conflict

When submission cannot proceed because another request already owns the action or idempotency semantics conflict:

- explain that DXCP could not safely create a new Deployment
- preserve the entered form state
- offer refresh or open-related-deployment action if known

### Read-failure

If supporting read data cannot load:
- explain which context could not be loaded
- keep already loaded sections usable when safe
- do not silently degrade important policy context

If the workflow cannot be trusted without that context, block submission.

### Permission-limited

If the user can view but not deploy:
- show the workflow in read-only mode
- explain why deploy is unavailable
- keep policy context visible
- avoid hiding the workflow entirely if the product intentionally exposes it

---

## History Access

The deploy workflow is not a history surface.

History access should remain intentional and shallow:

- link back to [[Application Screen]] for recent activity
- link to [[Deployment Detail Screen]] after submit
- link to active blocking deployment when concurrency explains a block

Do not embed recent deployment tables or long history feeds into this workflow.

This screen exists to create the next deployment, not browse old ones.

---

## Responsive Behavior

### Standard desktop

Use a two-column layout:
- primary intent-entry column on the left
- secondary governance column on the right

The right rail remains visible while editing if space allows.

### Narrow desktop and tablet

Stack the sections in this order:

1. Alert Rail
2. Page Header
3. Application Context
4. Deployment Intent
5. Pre-Submit Review
6. Deployment Group Context
7. Guardrails
8. Allowed Deployment Strategy Context
9. Admin Diagnostics when opened

Ordering must preserve the same action story:
edit first, understand policy second, submit last.

### Small screens

Use a single-column layout with the same narrative order.

Rules:
- keep the primary action anchored in a stable footer or header treatment
- avoid turning right-rail context into collapsible chaos
- use progressive disclosure for admin diagnostics and longer explanatory text
- ensure blocked-submit explanations remain visible near the action

---

## Density and Restraint Rules

- Keep the workflow short, structured, and calm.
- Use concise section headers.
- Avoid large helper paragraphs.
- Avoid duplicate summary cards.
- Avoid showing all possible diagnostics by default.
- Keep guardrails readable, not encyclopedic.
- Do not introduce wizard chrome, step counters, or progress bars unless truly needed.
- Do not mix admin controls into the deploy path.
- Do not add historical collections just because space exists.
- Prefer one resolved screen over many expanding panels.

---

## Role-Aware Behavior

### Delivery owner

- can edit deployable fields
- can validate and submit when policy allows
- sees human-readable blocked reasons
- does not need admin diagnostics by default

### Observer

- may see read-only workflow only if the product intentionally exposes deploy visibility
- cannot submit
- sees why deploy is unavailable
- should still understand the guardrails and allowed strategy context

### Platform admin

- can submit like a delivery owner
- can view progressively disclosed diagnostics
- may see deeper operator hints and request identifiers
- should still receive the same default human-readable workflow as everyone else

---

## Shared Patterns Used

- [[Shared UI Patterns]]
- Page Header Pattern
- Section Header Pattern
- Alert Rail Pattern
- Summary Card Pattern
- Progressive Disclosure Pattern
- Inline Validation Pattern
- Empty / Loading / Error State Pattern
- Primary vs Secondary Column Pattern

---

## Implemented Capabilities Preserved from Product Behavior Alignment

This screen spec explicitly preserves the following implemented capabilities from [[Product Behavior Alignment]]:

- deployment intent entry
- application selection or application-context entry
- deployment strategy selection through the approved strategy set
- version selection and refresh
- required change summary
- policy-first review
- visible guardrail context
- blocked deploy explanation
- deliberate submission to create a deployment record
- admin-only diagnostics as a secondary, role-gated layer
- clear post-submit handoff into [[Deployment Detail Screen]]

It also preserves the role-aware product behavior described across DXCP:
- blocked actions explained clearly
- admin-only deeper diagnostics
- governance visible before execution starts

---

## Old UI Structures Intentionally Not Inherited

This screen spec intentionally does **not** inherit the following old UI structures:

- workflow-first navigation as proof that top-level Deploy must remain primary navigation
- old field grouping or card grouping from the current implementation
- recipe-heavy wording as default end-user language
- diagnostics-heavy default presentation
- raw API or engine terminology in default explanations
- exposing secondary detail before the user understands the intent story
- turning the deploy screen into a general operational dashboard
- mixing admin troubleshooting controls into the default deploy path
- long history or archive sections inside the workflow

---

## Anti-Patterns to Avoid

- giant enterprise form stacks
- multi-column form chaos
- policy explained only after submit fails
- hiding the deployment group or guardrails until late
- using internal names like Service, Recipe, or DeliveryGroup in default user-facing copy
- exposing engine stage terms
- making users decode raw error objects first
- leaving success in place as a toast with no durable handoff
- showing full deployment history inline
- using tab shells to paper over ownership confusion

---

## Summary

The deploy workflow should feel like a short, high-confidence decision surface.

It starts from an [[DXCP Core Vocabulary#Application|Application]] -whenever possible, collects the minimum deployment intent needed to act, keeps governance visible throughout editing, explains blocked states in calm DXCP language, hides advanced diagnostics behind progressive disclosure, and hands the user directly into [[Deployment Detail Screen]] once a [[DXCP Core Vocabulary#Deployment|Deployment]] is created.

This preserves the real product behavior while replacing the old UI posture with a restrained, policy-first, object-aligned workflow.