# Decision: Admin is a separate configuration workspace

## Problem

Platform administration in DXCP must be available without polluting the standard delivery workflow used by developers.

If admin behavior is mixed into Application and Deployment screens, the product becomes harder to learn, noisier to operate, and riskier to change.

## Options

Option A  
Embed admin controls broadly into standard delivery screens.

Option B  
Create one large Admin screen with many subsections.

Option C  
Create a separate Admin workspace organized around configuration objects.

## Decision

DXCP uses a separate Admin workspace organized around configuration objects such as Deployment Groups, Strategies, System Settings, and Audit Log.

Standard delivery screens remain focused on Applications, Deployments, and deployment understanding.

Admin diagnostics and high-risk configuration are available through Admin and progressive disclosure, not through the default delivery path.

## Consequences

Positive:

- Preserves a clean boundary between operating software and changing delivery rules
- Reduces clutter in standard delivery screens
- Improves safety for high-impact changes
- Keeps DXCP consistent with object-first navigation in [[DXCP Information Architecture]]

Tradeoffs:

- Some users must navigate to a distinct area for platform tasks
- Admin workflows require an additional layer of information architecture

## Affected Notes

- [[DXCP Information Architecture]]
- [[DXCP UX Grammar]]
- [[DXCP Layout Behavior]]
- [[Application Screen]]
- [[Deployment Screen]]