# Decision: DXCP uses a restrained shared pattern system

## Problem

As DXCP expands across operational, workflow, insights, and admin surfaces, it risks accumulating bespoke layouts and screen-specific interaction treatments.

That would weaken predictability, increase implementation drift, and make the product feel heavier and less trustworthy.

## Options

Option A  
Allow each screen family to define its own UI composition patterns.

Option B  
Create a large enterprise component catalog with many interchangeable patterns.

Option C  
Use a small, restrained shared pattern system reused across DXCP.

## Decision

DXCP uses a small shared pattern system across screen families.

The shared pattern system includes:
- page headers
- section headers
- alert rail
- status and badge rules
- summary cards
- collection patterns
- timeline pattern
- repeated state blocks
- progressive disclosure rules
- filter and search patterns
- action placement rules
- anti-bulk restraint rules

Screen specs may compose these patterns differently, but should not invent new default patterns without a strong reason.

## Consequences

Positive:
- stronger cross-screen consistency
- faster user learning
- calmer product feel
- better implementation discipline
- clearer mockup and component planning

Tradeoffs:
- less visual freedom screen-by-screen
- new patterns require more scrutiny before introduction

## Affected Notes

- [[Shared UI Patterns]]
- [[DXCP Layout Behavior]]
- [[Interaction Patterns]]
- [[Application Screen]]
- [[Deployment Detail Screen]]
- [[Deployment Screen]]
- [[Insights Screen]]
- [[Admin Screen]]
- [[Deploy Workflow]]