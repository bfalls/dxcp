# Decision: failure UX uses one normalized primary explanation

## Problem

Deployment systems often expose multiple overlapping error surfaces:
status badges, logs, pipeline stages, validation messages, and engine errors.

This makes it hard for users to quickly determine what failed, why it failed, and what to do next.

## Options

Option A  
Show all normalized failures equally and let the user interpret them.

Option B  
Use engine diagnostics as the main explanation surface.

Option C  
Present one normalized primary failure explanation, then provide timeline correlation and secondary diagnostics.

## Decision

DXCP presents one primary normalized failure explanation for each failed deployment.

This explanation is supported by:
- timeline correlation
- explicit retryability
- one recommended next action
- secondary admin diagnostics when needed

## Consequences

Positive:

- Faster failure comprehension
- More consistent failure UX across policy, validation, and execution
- Less dependence on engine knowledge

Tradeoff:

- DXCP must choose and maintain a primary failure when multiple failures are present
- Some advanced operators may still need deeper diagnostics for edge cases