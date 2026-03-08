# Decision: UI screen specs use a standard structure

## Problem

DXCP now has aligned UX architecture, but future UI planning can still drift if each screen spec is written in a different format or at a different level of depth.

That drift would make screen specs harder to compare, weaken density discipline, and increase the chance that mockups or implementation planning reintroduce bulky enterprise patterns.

## Options considered

### Option A
Allow each screen spec to use whatever structure seems appropriate for that page.

### Option B
Use a standard screen spec structure for all major DXCP UI screens, with page-specific variation inside a shared template.

## Decision

DXCP screen specs use a standard structure.

Every major screen spec must define:

- purpose
- dominant user question
- relationship to adjacent screens and flows
- page header
- dominant page composition
- default view
- section specifications
- actions, including blocked actions
- state model
- history access
- responsive behavior
- density and restraint rules
- role-aware behavior
- shared patterns used
- anti-patterns to avoid
- summary

## Consequences

### Positive

- Screen specs become comparable across [[Application Screen]], [[Deployment Detail Screen]], [[Deploy Workflow]], [[Deployment Screen]], [[Insights Screen]], and [[Admin Screen]].
- Density and anti-bulk expectations become part of the planning structure instead of a late correction.
- Shared DXCP behavior becomes easier to preserve.
- Later mockups and implementation planning require less guesswork.

### Tradeoffs

- Authors have less freedom to improvise the structure of a note.
- Some screens may not need every section in equal depth, so writers still need judgment.

## Related

- [[UI_Planning_Overview]]
- [[Screen_Spec_Framework]]
- [[DXCP UX Grammar]]
- [[Layout Grid]]
- [[Interaction Patterns]]
