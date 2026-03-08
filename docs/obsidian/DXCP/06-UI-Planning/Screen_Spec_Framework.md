# Screen Spec Framework

## Purpose

This note defines the standard template and writing rules for all future DXCP screen specs.

It ensures every screen spec uses the same structure, asks for the same level of rigor, and stays aligned to the DXCP product model.

## Standard DXCP Screen Spec Template

Use the following structure for all future UI screen spec notes.

---

# Screen name

## Purpose

State what the screen is for in one sentence.
Use confirmed DXCP vocabulary only.

## Dominant User Question

Name the primary question this screen answers.
If needed, include up to three tightly related secondary questions.

## Why This Screen Exists

Explain the operational role of the screen inside DXCP.
Clarify how it differs from nearby screens so ownership stays clean.
Reference related notes when needed.

## Relationship to Other Screens and Flows

Link to the most relevant related notes.
Typical references may include:

- related object page
- related workflow
- shared UX pattern note
- design decision note that constrains the page shape

## Page Header

Define the page header clearly:

- object identity or page title
- key supporting metadata in the header, if any
- primary page action on the right
- secondary page actions if truly needed

The page header should make the screen legible before the user scrolls.

## Dominant Page Composition

Describe the main page shape in terms of regions.
At minimum, specify:

- alert rail usage
- page header
- primary region
- secondary context region, if present
- section order

This section should explain which region tells the main story and which region provides durable support.

## Default View

Describe what the user sees in the normal case.
Specify:

- the opening information hierarchy
- the first meaningful block or section
- summary versus detail balance
- what is intentionally visible by default
- what is intentionally not shown by default

## Section Specifications

Define each major section using this sub-structure:

### Section name
- purpose
- contents
- why it belongs here
- action behavior
- density or restraint rule
- link to shared pattern if applicable

Use this repeatedly for each major page section.

## Actions

Describe actions in three levels:

### Primary actions
Actions that move the main job forward.
Where they appear and when they are enabled.

### Secondary actions
Supporting actions that should be easy to find but should not compete with the primary action.

### Blocked actions
Actions that remain visible but cannot proceed.
For each blocked action, define:

- what is blocked
- why it is blocked
- where the explanation appears
- whether there is a next-step hint

## State Model

Every screen spec must define these states when applicable:

### Loading
What skeleton or placeholder structure appears while data loads.
The screen should preserve its identity.

### Empty
What appears when the object or collection has no meaningful content yet.

### No results
What appears when filters or search return nothing.

### Read-only or blocked
How the page behaves when the user can view but not act.

### Error or degraded-read
How read failures or partial failures are surfaced without collapsing the page into generic error handling.

## History Access

Describe how the screen gives access to deeper history without making history the default page shape.
Specify:

- what historical material is visible by default
- what requires intentional access
- which control pattern is used for deeper history
- why the default page remains summary-first

Reference [[Decision History is never the default page shape]] when relevant.

## Responsive Behavior

Define behavior for:

### Standard desktop
Expected two-column or single-column composition.

### Narrow desktop and tablet
How columns stack or condense while preserving reading order.

### Small screens
What simplifies, collapses, or moves behind intentional access.

Responsive behavior must preserve the same spatial story rather than inventing a different product.

## Density and Restraint Rules

State what this screen must do to avoid bulk.
Examples:

- limit persistent side content
- summarize before expanding
- keep tables scoped and purposeful
- avoid stacking too many equal-weight cards
- avoid default long-scroll archives

## Role-Aware Behavior

When roles matter, define:

- what all users can see
- what actions differ by role
- what diagnostics are admin-only
- how blocked access is explained in DXCP language

Do not use internal role constants as user-facing copy unless a note explicitly requires that representation.

## Shared Patterns Used

Reference the shared notes this screen relies on instead of re-defining them.
Common examples:

- [[Interaction Patterns]]
- [[Guardrails UX]]
- [[Failure UX]]
- [[Layout Grid]]
- [[DXCP Layout Behavior]]

## Anti-Patterns to Avoid

List the mistakes most likely to degrade the screen.
These should be specific to the screen and consistent with DXCP principles.

## Summary

Close with a brief description of the intended screen feel and what the screen should make easy.

---

## How To Write Screen Specs Well

### 1. Start with the user question, not the component list

A good screen spec is anchored in the question the user is trying to answer.
A weak screen spec is a shopping list of panels.

### 2. Describe hierarchy in plain language

State what must be understood first, second, and third.
This is more important than listing every element.

### 3. Be explicit about what is not default

Future mockups go wrong when the spec is vague about hidden depth.
Call out what is intentionally deferred behind drill-in, tab, modal, filter, or history access.

### 4. Treat blocked states as first-class behavior

In DXCP, blocked actions are part of the product experience.
Do not leave them as implementation leftovers.

### 5. Reuse shared patterns aggressively, but not blindly

If a shared pattern exists, reference it.
Only add page-specific behavior when the screen has a real reason to differ.

### 6. Preserve vocabulary discipline

Use the nouns and grammar from [[DXCP Core Vocabulary]] and [[DXCP UX Grammar]].
Do not slip into internal model names or engine language.

### 7. Preserve object ownership

Do not let one screen absorb the job of another screen.
If the page starts answering a different dominant question, the spec is probably drifting.

### 8. Keep the page at one information altitude

Do not mix:

- summary dashboard blocks
- dense operational forms
- deep archival history
- advanced diagnostics

unless the page truly needs all of them and the hierarchy is still clear.

### 9. Write for comparison across screens

A strong DXCP spec can be placed next to another spec and reviewed quickly.
That means the same section structure should recur across notes.

### 10. Write with mockups in mind

The spec should be concrete enough that a designer can sketch the page without inventing meaning.
If layout or behavior still requires guessing, the spec is not done.

## What A Strong Screen Spec Produces Downstream

A strong DXCP screen spec should support:

- wireframes
- mockups
- implementation planning
- review for role-aware behavior
- review for policy visibility
- review for density and anti-bulk discipline

## Related

- [[UI_Planning_Overview]]
- [[DXCP Core Vocabulary]]
- [[DXCP UX Grammar]]
- [[DXCP Object Model]]
- [[DXCP Layout Behavior]]
- [[Layout Grid]]
- [[Interaction Patterns]]
- [[Decision History is never the default page shape]]
