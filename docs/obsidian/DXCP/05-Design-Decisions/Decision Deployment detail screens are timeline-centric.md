# Decision: Deployment detail screens are timeline-centric

## Problem

Deployment systems often present execution details as tables or raw pipeline output.

This forces users to interpret engine mechanics instead of understanding the deployment story.

## Options

Option A  
Show raw pipeline stages.

Option B  
Show deployment history tables.

Option C  
Use a normalized timeline as the primary narrative.

## Decision

Deployment detail screens use a canonical deployment timeline as the primary UX.

Failures attach to timeline events through FailureModel entries.

Engine execution details are linked but not embedded.

## Consequences

Positive:

- Faster operational understanding
- Consistent behavior across engines
- Clear failure visualization

Tradeoff:

- Some deep debugging requires opening the execution engine.