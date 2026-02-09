# DXCP Phase 4: Extensibility and Platform Evolution

This document is the authoritative Phase 4 inventory of DXCP extensibility and
evolution. It reflects current implementation and intentional constraints.
It does not introduce new features or commitments.

## What Is Extensible Today

### Engine boundary
- DXCP integrates with the execution engine exclusively through the
  `spinnaker-adapter` boundary. The adapter owns engine HTTP calls,
  pipeline triggers, status mapping, and failure normalization.
- Engine-specific identifiers exist in admin-only fields:
  `spinnaker_application`, `deploy_pipeline`, `rollback_pipeline` on Recipe,
  and `engineExecutionId/engineExecutionUrl` on DeploymentRecord.
- Engine identity is explicit but informational only (`engine_type=SPINNAKER`).

### Recipe model
- Recipes are first-class, centrally managed objects with:
  `recipe_revision` and `effective_behavior_summary` captured at deploy time.
- Recipe updates increment `recipe_revision` and preserve a frozen
  `effective_behavior_summary` on each DeploymentRecord.
- Deprecated recipes are blocked by policy and reported with explicit error
  codes.

### Policy model
- Policy is enforced at the API boundary:
  allowlists, delivery-group guardrails, single environment, rate limits,
  and idempotency.
- DeliveryGroup acts as the governance boundary; Service capabilities are
  compatibility checks, not permission grants.
- Audit events are recorded for admin and delivery actions.

### Artifact model
- Artifact discovery and validation are abstracted behind `ArtifactSource`.
- v1 is AWS S3-only, enforced by artifactRef scheme validation and
  artifact source allowlists.

### API compatibility
- Public API is versioned at `/v1` and defined in `openapi.yaml`.
- The external contract is intent-first; engine primitives are not exposed.
- Admin-only fields are explicitly filtered in API responses for non-admins.

### UI architecture
- The UI is route-driven and uses URL state for Deploy and Deployments
  filters to keep navigation and refresh deterministic.
- Deployment detail and service detail views render normalized outcomes,
  recipe revisions, and frozen behavior summaries.

## What Is Intentionally NOT Extensible

- Multi-engine execution or user-selectable engines.
- Non-S3 artifact sources or non-AWS cloud providers.
- Multi-environment delivery (only `sandbox` is allowed in v1).
- Pipeline editing, pipeline graphs, or raw engine configuration exposure.
- Arbitrary deployment parameters or free-form pipeline composition.

## How To Add X Safely

### Add or evolve recipes (safe, no breaking changes)
1. Update or create a Recipe via admin APIs.
2. Ensure `effective_behavior_summary` is accurate and user-facing.
3. Confirm `recipe_revision` increments on update.
4. Update DeliveryGroup `allowed_recipes` to permit use.
5. Verify UI shows recipe revision and behavior summary on deployment detail.

Notes:
- Behavior changes must be visible via `effective_behavior_summary`.
- Deprecated recipes should remain in history; do not delete prior records.

### Evolve policy or guardrails (safe, visible changes)
1. Update DeliveryGroup guardrails through admin APIs.
2. Ensure audit events capture the change and the change reason.
3. Validate policy preview responses before applying changes.
4. Keep policy errors explicit and user-readable in API responses.

Notes:
- Policy is enforced before compatibility checks to keep feedback consistent.

### Change execution engine integration (bounded change)
1. Keep the public API contract stable (`/v1` intent and records).
2. Implement changes inside the adapter boundary.
3. Preserve `engine_type` as informational-only, and keep engine fields
   admin-only.
4. Update failure normalization to preserve user-facing categories.
5. Maintain or expand adapter tests for request/response mapping.

Notes:
- Adding a new engine as a first-class option is out of scope for v1.

### Add a new artifact source (not supported in v1)
1. Implement a new `ArtifactSource` and validation path.
2. Extend `artifactRef` scheme allowlists and parsing.
3. Update the adapter to avoid S3-specific assumptions.
4. Update policy to enforce allowlists for the new scheme.
5. Add tests for discovery, validation, and registration flows.

Notes:
- Non-S3 sources are intentionally out of scope for v1.

## Compatibility Rules (What Can Change vs What Cannot)

### Stable and must not change in v1
- `/v1` intent-based API structure and required fields.
- Policy error codes and user-facing error semantics.
- Normalized deployment outcomes and failure categories.
- `engine_type` remains informational only.
- Single environment (`sandbox`) semantics and enforcement.
- S3-only artifactRef in v1.

### Can evolve without breaking users
- Recipe behavior and guardrails, as long as
  `effective_behavior_summary` updates and is snapshotted.
- Admin-only engine diagnostics and mapping fields.
- Internal engine mapping and adapter behavior.
- UI layout refinements that preserve route behavior and state determinism.

## Open Gaps / TODO List

None identified beyond documentation and explicit scope limits as of 2026-02-09.

## Appendix A: Safe Recipe Change Workflow

Preconditions:
- A recipe change means changing delivery behavior semantics, not just label text.
- Intent shape and user-facing meaning must remain stable for engineers.

Required steps:
1. Decide if the change is behavior-impacting or cosmetic.
2. Increment `recipe_revision` on update (see `dxcp-api/main.py` recipe update).
3. Update `effective_behavior_summary` to describe the new behavior.
4. Confirm compatibility rules still hold:
   - DeliveryGroup policy allowlist in `dxcp-api/main.py`.
   - Service capability allowlist in `dxcp-api/main.py`.
5. Validate preflight still rejects invalid deploys (`/v1/deployments/validate` in `openapi.yaml`).

Required checks:
- `openapi.yaml` contract for Recipe and DeploymentRecord remains unchanged.
- A new DeploymentRecord snapshots `recipeRevision` and `effectiveBehaviorSummary`.
- Historical deployments remain interpretable via stored revision + summary.

Rollout guidance:
- Apply to a single DeliveryGroup first, then expand.
- Communicate the behavior summary change to affected teams (one short note).

Anti-patterns:
- Silent behavior changes without a `recipe_revision` bump.
- Accepting the same intent but changing its meaning without updating the summary.

## Appendix B: Safe Guardrail/Policy Change Workflow

Preconditions:
- Guardrails cover quotas, concurrency, and allowlists today.
- Server-side enforcement is authoritative; UI is advisory.

Required steps:
1. Identify affected delivery groups and services.
2. Make the policy change in the canonical enforcement path:
   - Guardrails in `dxcp-api/policy.py`
   - Policy ordering in `dxcp-api/main.py`
3. Ensure preflight reflects the new constraints
   (`/v1/deployments/validate` behavior in `dxcp-api/main.py`).
4. Ensure error responses differentiate POLICY_CHANGE vs USER_ERROR
   (`ErrorResponse.failure_cause` in `dxcp-api/models.py`).

Required checks:
- Back/forward UI navigation does not bypass server checks (route-driven UI in `ui/src/App.jsx`).
- Remaining quota surfaces correctly in preflight and UI policy panel
  (`/v1/deployments/validate` + `ui/src/App.jsx`).

Anti-patterns:
- Policy changes that only appear at execution time.
- Vague errors that force users to infer policy intent.
