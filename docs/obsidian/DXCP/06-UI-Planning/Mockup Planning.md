# Mockup Planning

## Purpose

This note defines the minimum serious mockup package required to validate DXCP before component or system planning begins.

The goal is to prove:
- the product reads as an intent-first control plane rather than a generic delivery dashboard
- the major screen families carry one coherent spatial story
- object hierarchy, action clarity, and guardrail explainability are visually credible
- the highest-risk screen states are resolved at mockup level before the UI is broken into components

This note builds on:
- [[DXCP Vision]]
- [[DXCP Core Vocabulary]]
- [[DXCP Object Model]]
- [[DXCP UX Grammar]]
- [[Application Screen]]
- [[Deployment Detail Screen]]
- [[Deployment Screen]]
- [[Insights Screen]]
- [[Admin Screen]]
- [[Deploy Workflow]]
- [[Screen Spec - Application]]
- [[Screen Spec - Deployment Detail]]
- [[Screen Spec - Deploy Workflow]]
- [[Screen Spec - Deployments]]
- [[Screen Spec - Insights]]
- [[Screen Spec - Admin]]
- [[Navigation and Cross-Screen Behavior]]
- [[Responsive and Density Rules]]
- [[Visual Language Direction]]
- [[Shared UI Patterns]]

---

## Mockup planning principles

### 1. Mockups should validate product posture before visual polish

The first mockup pass exists to prove hierarchy, transitions, and clarity.

It should not begin with:
- component tokenization
- exhaustive control states
- advanced interaction specs
- decorative visual exploration

### 2. The first mockups should prove DXCP’s primary operational story

The first sequence should prove that a user can:
- understand an [[DXCP Core Vocabulary#Application|Application]] quickly
- initiate a deploy confidently
- understand why a deploy is blocked when it is blocked
- follow a created [[DXCP Core Vocabulary#Deployment|Deployment]] into the canonical detail view
- investigate progress or failure without engine leakage

### 3. Screen priority should follow product risk, not screen count

The first mocked screens should be the ones that carry the highest risk of:
- generic dashboard drift
- unclear action hierarchy
- weak guardrail explainability
- broken cross-screen continuity
- excessive bulk

### 4. Alternate-state mockups are required where they change comprehension

Some screens do not need many separate mockups.

Others require dedicated alternate-state mockups because the visual answer materially changes when:
- an action is blocked
- the object is empty
- the object is active or failed
- the screen becomes read-only
- the screen must hand off into another screen

### 5. Fidelity should rise only where ambiguity would otherwise survive

Early mockups should remain low-to-mid fidelity where structure is the main question.

Fidelity should become more concrete only when it is necessary to validate:
- emphasis
- restraint
- alert weight
- status intensity
- dense information readability
- delivery-versus-admin visual family consistency

---

## What must be proven before component or system planning begins

Before component planning starts, the mockup package must prove all of the following:

1. The DXCP shell, page header, alert rail, and two-column rules read as one stable product system.

2. [[Application Screen]], [[Deploy Workflow]], and [[Deployment Detail Screen]] form a coherent primary flow with no ambiguity about where action begins and where execution is followed.

3. Guardrails are visually first-class without turning the product into a warning-heavy control surface.

4. Blocked actions are understandable in one pass and always answer:
   - what happened
   - why it is blocked
   - what to do next

5. [[Deployment Detail Screen]] clearly owns deployment investigation.

6. [[Application Screen]] clearly owns current state and recent meaningful activity, not archive depth.

7. [[Insights Screen]] reads as restrained system understanding, not card sprawl.

8. [[Admin Screen]] reads as a separate governance workspace in the same product family, with stronger review posture and more deliberate caution.

9. Responsive mockups preserve hierarchy rather than inventing alternate products.

10. The mockups establish enough visual confidence that later component work can reuse a real screen language instead of reverse-engineering one from prose.

---

## Minimum mockup set required to validate the product

The minimum serious mockup set is:

1. [[Application Screen]] — default state
2. [[Deploy Workflow]] — ready-to-submit state
3. [[Deploy Workflow]] — blocked-by-policy state
4. [[Deployment Detail Screen]] — active or in-progress state
5. [[Deployment Detail Screen]] — failed state with normalized failure explanation
6. [[Deployment Screen]] — filtered collection state entered from another screen
7. [[Insights Screen]] — default restrained system-level view
8. [[Admin Screen]] — governance overview or object detail default state
9. [[Admin Screen]] — edit/review-before-save state for a high-risk admin object

This is the minimum set because it proves:
- the main user journey
- the main blocked journey
- the canonical detail screen
- the main collection browse surface
- the system-level understanding surface
- the governance surface
- the difference between delivery posture and admin posture

---

## Highest-risk screens and states

### Highest-risk screens

#### 1. [[Deploy Workflow]]
Highest risk because it must make policy, eligibility, review, and submission feel calm and deterministic instead of form-heavy or mysterious.

#### 2. [[Deployment Detail Screen]]
Highest risk because it must become the unmistakable canonical place for following execution, failure, and rollback without collapsing into either a log dump or a dashboard summary.

#### 3. [[Application Screen]]
Highest risk because it establishes the product’s default object posture and is the screen most likely to drift into tab sprawl, metrics sprawl, or buried primary actions.

#### 4. [[Admin Screen]]
Highest risk because it must feel more governed and review-oriented without looking like a separate product or a bulky internal tool.

#### 5. [[Insights Screen]]
Highest risk because it is the easiest place for generic dashboard habits to re-enter the system.

### Highest-risk states

- blocked deploy
- active deployment follow state
- failed deployment investigation state
- empty application state with deploy still visible
- admin edit with warnings or blocked save
- insights with real drill targets but restrained summary
- filtered deployment browse entered from insights or application context

---

## Prioritized mockup sequence

## Sequence 1 — Product spine

### 1. [[Application Screen]] — default state

#### Why first
This screen establishes the default DXCP object posture.

It must prove:
- object-first hierarchy
- visible primary action
- running version prominence
- bounded recent activity
- restrained governance context
- no archive-first or tab-heavy drift

#### What to validate visually
- page header ownership
- primary versus secondary column clarity
- the visual weight of `Deploy`
- the relative quietness of governance context
- recent activity density
- failure summary restraint

#### Fidelity target
Low-to-mid fidelity.

This mockup should prove hierarchy and layout, not final surface finish.

---

### 2. [[Deploy Workflow]] — ready-to-submit state

#### Why second
This is the highest-value intent screen and the main proof that DXCP is not exposing engine mechanics.

#### What to validate visually
- concise structured workflow posture
- application context clarity
- deploy intent grouping
- pre-submit review readability
- secondary rail usefulness
- action clarity without wizard bulk

#### Fidelity target
Mid fidelity.

This screen needs enough specificity to judge review clarity, guardrail visibility, and submission emphasis.

---

### 3. [[Deploy Workflow]] — blocked-by-policy state

#### Why third
This is the single most important alternate-state mockup in the product.

It proves the system can say no clearly, calmly, and usefully.

#### What to validate visually
- alert rail weight
- blocked explanation hierarchy
- relation between page-level alert and in-flow explanation
- whether the page still feels actionable and understandable
- whether guardrail explanation feels productized rather than error-like

#### Fidelity target
Mid fidelity tending toward concrete.

Alert treatment, blocked-action emphasis, and next-step clarity need more than wireframe abstraction.

---

### 4. [[Deployment Detail Screen]] — active state

#### Why fourth
This screen is the handoff destination from deploy and the canonical follow surface.

#### What to validate visually
- timeline dominance
- summary block restraint
- action placement
- current progress readability
- relation between deployment summary, timeline, and supporting context
- whether the screen clearly becomes the ongoing operational home

#### Fidelity target
Mid fidelity.

The timeline shape and summary relationship need concrete structure, but not final design detailing.

---

### 5. [[Deployment Detail Screen]] — failed state

#### Why fifth
This mockup proves failure explanation, action clarity, and diagnostic restraint.

#### What to validate visually
- failure explanation hierarchy
- relationship between failure summary and timeline
- rollback action prominence without alarmism
- depth of secondary context
- normalization of failure language

#### Fidelity target
Mid-to-higher fidelity.

Failure emphasis, status intensity, and alert posture need enough concreteness to judge calmness versus urgency.

---

## Sequence 2 — Supporting surfaces that prove product breadth

### 6. [[Deployment Screen]] — filtered browse state

#### Why next
This proves that browse surfaces remain subordinate to object flows while still supporting history and drill-in.

#### What to validate visually
- summary-versus-list balance
- filter containment
- row scanability
- durable links into [[Deployment Detail Screen]]
- inherited context from other screens

#### Fidelity target
Low-to-mid fidelity.

This is mainly about hierarchy, filter containment, and row behavior.

---

### 7. [[Insights Screen]] — default state

#### Why next
This proves DXCP can show system-level understanding without falling into bulky analytics patterns.

#### What to validate visually
- restrained summary strip
- trend and breakdown rhythm
- chart restraint
- attention section weight
- obvious drill paths
- lack of dashboard-card sprawl

#### Fidelity target
Mid fidelity.

Enough detail is needed to judge analytical restraint and chart posture.

---

## Sequence 3 — Governance surface validation

### 8. [[Admin Screen]] — default overview or object-detail state

#### Why next
This proves the governance surface belongs to the same product family but has its own slower, review-oriented posture.

#### What to validate visually
- stronger review posture than delivery surfaces
- denser information without visual heaviness
- obvious subsection structure
- read-only default posture
- relationship between primary object content and secondary trust/risk context

#### Fidelity target
Mid fidelity.

The family resemblance and administrative caution need to be visible.

---

### 9. [[Admin Screen]] — edit/review-before-save state

#### Why last in the minimum set
This is the final proof needed before component planning because it validates higher-risk mutation patterns and warning hierarchy.

#### What to validate visually
- review-before-save posture
- inline versus section versus impact warnings
- blocked save treatment
- retained edit state during validation failure
- action hierarchy between save, cancel, and review affordances

#### Fidelity target
Mid-to-higher fidelity.

This state needs enough specificity to validate warning posture, edit density, and the difference between caution and clutter.

---

## State coverage requiring dedicated mockups

## 1. [[Application Screen]]

### Required dedicated mockups
- default state
- empty state with no successful deployment yet
- permission-limited or policy-blocked state if deploy remains visible but unavailable

### Why
The presence of `Deploy` in allowed versus blocked posture materially changes the page’s meaning.

### Optional inline-only states
- loading
- partial read failure if already covered elsewhere in the system

---

## 2. [[Deploy Workflow]]

### Required dedicated mockups
- ready-to-submit state
- blocked-by-policy state
- success handoff moment before redirect

### Why
This screen must prove:
- confident submission
- deterministic blocked explanation
- durable handoff into [[Deployment Detail Screen]]

### Optional inline-only states
- field validation details
- admin diagnostics expanded state, unless it becomes visually dominant

---

## 3. [[Deployment Detail Screen]]

### Required dedicated mockups
- active or in-progress state
- failed state
- rollback-unavailable or permission-limited state if action treatment changes materially

### Why
The screen’s emotional and operational posture changes meaningfully between active follow, failed investigation, and blocked recovery.

### Optional inline-only states
- loading skeleton
- degraded-read state if already represented by shared patterns

---

## 4. [[Deployment Screen]]

### Required dedicated mockups
- default filtered browse state
- no-results state only if the filter bar and empty-result explanation materially affect the page rhythm

### Why
This screen is less state-heavy than object and workflow screens, but it must still prove that browsing remains calm and subordinate to object investigation.

---

## 5. [[Insights Screen]]

### Required dedicated mockups
- default state
- filtered or narrowed-scope state only if drill-in inheritance materially changes the hierarchy
- empty or low-signal state only if analytics restraint is hard to judge without it

### Why
This screen’s main risk is default-state posture, not state explosion.

---

## 6. [[Admin Screen]]

### Required dedicated mockups
- read-only default object or overview state
- edit/review-before-save state
- blocked-save or warning-heavy state for a high-risk admin edit

### Why
These states are required to prove governance seriousness, edit caution, and warning hierarchy.

---

## Transitions that matter most

## Critical transition set

### 1. [[Application Screen]] -> [[Deploy Workflow]]
Must prove that deploying feels like the natural next action from the application object, not a context break.

### 2. [[Deploy Workflow]] blocked state -> related next action
Must prove that blocked submission still leaves the user with a clear path forward.

### 3. [[Deploy Workflow]] success handoff -> [[Deployment Detail Screen]]
Must prove that the workflow ends cleanly and the deployment object becomes the canonical follow destination.

### 4. [[Application Screen]] -> [[Deployment Detail Screen]]
Must prove recent deployment activity can hand off directly into investigation without losing object continuity.

### 5. [[Deployment Screen]] -> [[Deployment Detail Screen]]
Must prove collection browsing resolves into object detail cleanly and preserves browse context for return.

### 6. [[Insights Screen]] -> [[Deployment Screen]] with inherited scope
Must prove system insight drill-down becomes operationally actionable rather than analytically detached.

### 7. Admin audit or integration context -> related object detail
Must prove governance records lead to readable objects rather than dead-end records.

---

## What each transition must prove visually

### Object continuity
The destination header should immediately tell the user what object they are now in.

### Context continuity
The user should understand what context carried over:
- application scope
- filters
- time range
- originating insight or audit context

### Action continuity
The next meaningful action should still be obvious after transition.

### Return continuity
There should be one restrained return path when origin is known, without breadcrumb excess.

---

## Where fidelity should stay low

Keep fidelity low in these areas during the first pass:
- structural page framing
- region ordering
- placeholder table density
- basic loading shapes
- filter bar containment
- early empty-state composition

Low fidelity is enough when the question is:
- what goes first
- what is primary
- what belongs in the secondary rail
- how many regions the page really needs

---

## Where fidelity should become more concrete

Increase fidelity sooner in these areas:
- alert rail treatment
- blocked deploy explanation
- failure emphasis
- status color usage
- timeline event rhythm
- chart restraint on [[Insights Screen]]
- admin warning and review states
- top navigation and page header balance
- primary action prominence

More concrete mockups are needed when the question is:
- how strong should emphasis be
- whether the product still feels calm
- whether warnings are useful without being noisy
- whether delivery and admin still feel like one visual family

---

## Recommended mockup package by pass

## Pass 1 — Structural validation
Use low-to-mid fidelity mockups for:
- [[Application Screen]] default
- [[Deploy Workflow]] ready-to-submit
- [[Deployment Detail Screen]] active
- [[Deployment Screen]] filtered browse
- [[Insights Screen]] default
- [[Admin Screen]] read-only default

Goal:
Prove page shape, hierarchy, transitions, and product-family consistency.

## Pass 2 — Risk-state validation
Use mid fidelity or more concrete mockups for:
- [[Deploy Workflow]] blocked-by-policy
- [[Deployment Detail Screen]] failed
- [[Application Screen]] empty or policy-blocked
- [[Admin Screen]] edit/review-before-save
- [[Admin Screen]] blocked-save or warning-heavy edit

Goal:
Prove alert posture, failure posture, warning posture, and calmness under stress.

## Pass 3 — Narrow-layout validation
Create selected narrow-layout variants for:
- [[Application Screen]]
- [[Deploy Workflow]]
- [[Deployment Detail Screen]]
- [[Admin Screen]]

Goal:
Prove compression preserves hierarchy rather than inventing alternate page logic.

---

## What should not be mocked yet

The following should wait until after the core mockup package is validated:
- exhaustive component variants
- full design system token work
- provider-specific integration subflows beyond the common admin pattern
- deep admin diagnostics views
- highly specialized analytical variants
- speculative future multi-environment or approval flows
- implementation-facing component API planning

---

## Readiness check before component/system planning begins

DXCP is ready to move into component or system planning only when reviewers can say yes to all of the following:

- The first mockup sequence already makes DXCP feel like the intended product.
- The core delivery journey is visually coherent from application to deploy to deployment detail.
- The blocked journey is more understandable in mockup form than in prose.
- The investigation journey is clearly centered on [[Deployment Detail Screen]].
- The governance journey feels deliberate and review-oriented without becoming a separate design language.
- The insights journey is operational and restrained.
- The narrow-layout variants preserve the same page meaning.
- No critical screen still depends on component invention to resolve its hierarchy.
