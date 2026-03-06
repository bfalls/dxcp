## Purpose  
  
The Admin area defines how DXCP supports platform management without polluting the standard delivery experience.  
  
Admin is where platform teams manage the central rules and configuration that shape delivery behavior across DXCP.  
  
It exists to answer:  
  
- what can be configured centrally  
- how policy is managed safely  
- how deployment groups are created and maintained  
- how deployment strategies are defined and controlled  
- how system settings are reviewed and changed  
- how audit visibility works  
- how blocked changes and warnings are explained  
  
The Admin area is intentionally separate from the default delivery path used in [[Application Screen]], [[Deployment Screen]], and [[Deploy Workflow]].  
  
---  
  
## Core UX Principle  
  
Admin is a distinct configuration workspace, not an extension of day-to-day deployment screens.  
  
DXCP keeps delivery work object-first around Applications and Deployments.  
  
Admin keeps platform management object-first around configuration objects:  
  
- Deployment Groups  
- Strategies  
- System Settings  
- Audit Log  
  
This preserves a clean mental boundary between:  
  
- operating software  
- changing the rules that govern software delivery  
  
---  
  
## Navigation Model  
  
Admin appears as a top-level navigation item, consistent with [[DXCP UX Grammar]] and [[DXCP Information Architecture]].  
  
Admin contains a grouped set of screens, not one long screen.  
  
Recommended structure:  
  
- Overview  
- Deployment Groups  
- Strategies  
- Policy Preview  
- System Settings  
- Audit Log  
  
Navigation inside Admin should use plural nouns, not verbs.  
  
Examples:  
  
- Deployment Groups  
- Strategies  
- System Settings  
- Audit Log  
  
Avoid generic labels such as:  
  
- Manage  
- Configure  
- Tools  
  
---  
  
## What the Admin Area Is For  
  
The Admin area is used to control platform-wide delivery behavior safely.  
  
It should support:  
  
- defining policy boundaries  
- defining allowed deployment behavior  
- reviewing global settings  
- previewing the impact of policy changes  
- auditing who changed what and when  
- inspecting advanced configuration diagnostics when needed  
  
Shared state behavior should remain consistent with [[Interaction Patterns]].

It should not become:  
  
- a default landing area for developers  
- a dense CRUD console  
- a place where users must understand engine mechanics  
- a substitute for the standard delivery workflow  
  
---  
  
## Screen Grouping Model  
  
### Admin Overview  
  
The Overview screen is the entry point for platform administrators.  
  
It should summarize:  
  
- recently changed Deployment Groups  
- recently changed Strategies  
- settings with warnings or unusual values  
- recent blocked saves or validation issues  
- recent audit activity  
  
The Overview should be mostly read-first.  
It should stay intentionally light rather than becoming a dashboard wall.  
  
Its purpose is orientation, not bulk editing.  
  
---  
  
### Deployment Groups  
  
Deployment Groups are the primary policy objects in Admin.  
  
Each item in the browse view should communicate:  
  
- name  
- owner  
- applications count  
- allowed environments  
- allowed strategies count  
- guardrail summary  
- last changed time  
  
The browse view should avoid a dense table as the primary experience.  
  
Preferred pattern:  
  
- compact summary cards  
- or a comfortable list with a strong summary line and secondary metadata  
  
Primary action:  
  
- Open Deployment Group  
  
Secondary actions may include:  
  
- Edit  
- Duplicate  
- Disable  
  
Opening a Deployment Group should lead to a detail screen with structured sections.  
  
Recommended sections:  
  
- Overview  
- Applications  
- Environments  
- Allowed Strategies  
- Guardrails  
- Change History (secondary)  
  
The right-side context column may show:  
  
- policy summary  
- validation state  
- recent audit activity  
- impacted Applications count  
  
---  
  
### Deployment Group Editing  
  
Deployment Group editing should be section-based, not raw JSON or flat field lists.  
  
Recommended editable sections:  
  
#### Overview  
- name  
- description  
- owner  
  
#### Applications  
- allowed applications  
- application count  
- add/remove behavior with validation  
  
#### Environments  
- allowed environments  
- ordering if relevant  
  
#### Allowed Strategies  
- selected Strategies  
- short explanation of each selected Strategy  
  
#### Guardrails  
- max concurrent deployments  
- daily deploy quota  
- daily rollback quota  
  
Validation should happen inline and before save.  
  
Policy impact should be previewed before save.  
  
---  
  
### Strategies  
  
Strategies are presented as named deployment behaviors with clear operational meaning.  
  
A Strategy browse item should show:  
  
- name  
- short purpose  
- effective behavior summary  
- status  
- revision  
- number of Deployment Groups using it  
  
Primary action:  
  
- Open Strategy  
  
Strategy detail should answer:  
  
- what this Strategy does  
- where it is allowed  
- whether it is active or deprecated  
- what changed in the current revision  
  
Recommended sections:  
  
- Overview  
- Behavior Summary  
- Usage  
- Revision History (secondary)  
- Advanced Diagnostics  
  
Advanced Diagnostics is admin-only progressive disclosure.  
  
It may include engine-linked information, but that information must not be required to understand the Strategy.  
  
---  
  
### Policy Preview  
  
Policy Preview is a dedicated review surface for understanding the impact of admin changes before save.  
  
It should be reachable while editing:  
  
- Deployment Groups  
- Strategies  
- selected System Settings  
  
Policy Preview should show:  
  
- current state versus proposed state  
- what becomes newly allowed  
- what becomes newly blocked  
- warnings  
- blocked conditions  
- affected objects or counts when available  
  
Policy Preview should use plain language.  
  
It should explain outcomes in terms of DXCP behavior, not backend internals.  
  
Examples:  
  
- 3 Applications would no longer be allowed to use this Strategy  
- Deployments in sandbox would be blocked after the daily quota is reached  
- This change does not affect current deployments  
  
---  
  
### System Settings  
  
System Settings are global controls that affect platform behavior.  
  
This area should be intentionally narrow and high signal.  
  
Settings should be grouped by impact, not by storage shape.  
  
Recommended groupings:  
  
- Delivery Limits  
- Publisher Controls  
- Platform Defaults  
- Advanced  
  
Each setting row or card should show:  
  
- setting name  
- short explanation  
- current value  
- impact scope  
- risk level  
- last changed time  
  
High-risk settings should include stronger pre-save review.  
  
System Settings should emphasize the scope of impact.  
  
Users should be able to answer:  
  
- what does this setting control  
- how broad is the impact  
- is this safe to change now  
  
---  
  
### Audit Log  
  
Audit Log is the append-only history of important admin and delivery actions.  
  
Inside Admin, the focus should be on platform-relevant changes and investigations.  
  
Audit entries should show:  
  
- timestamp  
- actor  
- actor role  
- target type  
- target id  
- outcome  
- summary  
  
Helpful filters:  
  
- actor  
- target type  
- target id  
- outcome  
- time range  
- Deployment Group  
- Application  
- Environment  
  
Audit drill-in should support:  
  
- open the affected Deployment Group  
- open the affected Strategy  
- open the related Deployment  
- open filtered history for a specific object  
  
Audit Log should default to readable narrative summaries, with deeper fields visible on open.  
Use time scopes, filters, and pagination to keep the default view readable.  
  
Avoid making raw log schema the main experience.  
  
---  
  
## Editing Model  
  
Admin editing uses a review-first model.  
  
Pattern:  
  
1. Open object  
2. Review current state  
3. Enter Edit mode  
4. Make changes  
5. Review validation  
6. Open Policy Preview  
7. Save  
8. Confirm when risk requires it  
  
Screens should be read-only by default.  
  
Edit mode must be explicit.  
  
This reduces accidental changes and keeps the default experience understandable.  
  
---  
  
## Cross-screen state rules  
  
Admin interactions should follow the same DXCP state model used elsewhere.  
  
Rules:  
  
- page-level blocked saves and warning summaries belong in the Alert Rail  
- field-specific issues stay inline within the edited section  
- read-only and blocked-access states should be explicit, not implied through disabled shells  
- save success should be brief and return focus to the updated object state  
- advanced diagnostics remain secondary to the main explanation  
  
---  
  
## Validation Model  
  
Validation appears at three levels.  
  
### Inline Validation  
  
Used for:  
  
- required fields  
- invalid values  
- duplicate names  
- malformed limits  
  
### Section Validation  
  
Used for:  
  
- inconsistent combinations  
- incomplete policy sections  
- empty allowed behavior where not permitted  
  
### Impact Validation  
  
Used for:  
  
- changes that alter what users can do  
- changes that affect multiple Applications or groups  
- changes that introduce warnings or blocked outcomes  
  
Validation states:  
  
- Blocked  
- Warning  
- Info  
  
Blocked issues prevent save.  
  
Warnings allow save but must remain visible in both the edit screen and Policy Preview.  
  
---  
  
## Save and Confirmation Behavior  
  
Save behavior should reflect risk.  
  
### Low-risk changes  
Use normal Save.  
  
### Medium-risk changes  
Use Save with warning review.  
  
### High-risk changes  
Use confirmation with explicit impact summary.  
  
Confirmation should explain:  
  
- what changed  
- what is affected  
- whether existing running state is unchanged  
- whether future deploy behavior changes  
  
Avoid generic confirmation text such as:  
  
- Are you sure?  
  
Prefer concrete language such as:  
  
- Save changes to this Deployment Group?  
- 5 Applications will lose access to Rolling.  
  
---  
  
## Role-Aware Visibility  
  
The Admin area is primarily for platform administrators.  
  
### PLATFORM_ADMIN  
  
Can:  
  
- see Admin in navigation  
- browse Admin screens  
- edit and save changes  
- access advanced diagnostics  
- view Audit Log  
  
### Non-admin users  
  
Should not see Admin as part of their normal navigation.  
  
If a non-admin user reaches an Admin route directly, the screen should show a blocked-access state.  
  
Blocked-access state should include:  
  
- a clear title  
- a short explanation  
- safe navigation back to standard delivery areas  
- placement in the primary content area below the header, not as a broken shell  
  
Example:  
  
- Open Applications  
- Open Deployments  
  
Do not show broken forms, disabled pages, or partial admin shells.  
  
---  
  
## Blocked-Access Pattern  
  
Recommended content:  
  
Title:  
`Admin access required`  
  
Body:  
This area is limited to platform administration. Use Applications, Deployments, or Insights for standard delivery work.  
  
Actions:  
- Open Applications  
- Open Deployments  
  
This makes access limits understandable without exposing implementation or role constant vocabulary.  
  
---  
  
## Layout and density rules  
  
Admin should follow the same spatial contract as the rest of DXCP.  
  
Rules:  
  
- one dominant primary surface per page  
- secondary column for validation, policy preview, impact summary, and recent history only when it materially helps  
- avoid stacking many equal-weight cards  
- default views should emphasize current configuration and current impact over deep history  
- wide screens add breathing room, not more permanent admin content  
  
## Diagnostics Boundaries  
  
DXCP may expose advanced diagnostics for admins, but those diagnostics must not pollute standard delivery understanding.  
  
Rules:  
  
- keep diagnostics behind progressive disclosure  
- show them only in Admin or explicit advanced admin panels  
- never require them to understand an Application or Deployment outcome  
- prefer human-readable summaries first, internal references second  
  
This remains consistent with [[DXCP Object Model]] and [[Decision Deployment detail screens are timeline-centric]].  
  
---  
  
## Layout Guidance  
  
Admin screens follow the global structure defined in [[DXCP Layout Behavior]]:  
  
- Top Navigation  
- Alert Rail  
- Page Header  
- Primary Content Column  
- Secondary Context Column  
  
Admin screens should preserve the same spatial grammar as the rest of DXCP.  
  
They should still feel like DXCP, not a separate internal tool.  
  
Recommended emphasis:  
  
- primary column for configuration understanding and editing  
- secondary column for validation, policy preview, impact summary, and recent history  
  
This keeps configuration readable and safe.  
  
---  
  
## Relationship to Standard Delivery UX  
  
Admin must remain connected to DXCP, but clearly separate from daily delivery work.  
  
Standard delivery areas answer:  
  
- what is running  
- what changed  
- what failed  
- can I deploy  
  
Admin answers:  
  
- what rules govern delivery  
- what platform behaviors are allowed  
- what changed centrally  
- who changed it  
- whether a proposed change is safe  
  
This boundary keeps the product coherent.  
  
Admin shapes delivery behavior.  
  
It does not replace delivery screens.  
  
---  
  
## Summary  
  
The Admin area in DXCP is a grouped set of configuration screens that let platform teams safely manage policy, deployment behavior, global settings, and audit visibility.  
  
It should:  
  
- stay separate from day-to-day delivery work  
- use the same DXCP layout and vocabulary  
- favor read-first detail screens over dense CRUD tables  
- make validation and policy impact visible before save  
- keep diagnostics available but secondary  
- explain blocked access clearly for non-admins