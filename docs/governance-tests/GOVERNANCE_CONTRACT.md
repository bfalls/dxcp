# DXCP Governance Contract

This document defines the authoritative governance invariants for DXCP.

All governance tests enforce this contract.
Implementation must conform to it.

---------------------------------------------------------------------

1. Role Model

Roles:

- PLATFORM_ADMIN
- DELIVERY_OWNER
- OBSERVER
- CI publisher (M2M identity)

1.1 PLATFORM_ADMIN

Allowed:

- All read endpoints
- All mutating endpoints
- Admin endpoints
- Engine diagnostic endpoints

May configure:

- Rate limits
- CI publisher allowlist
- System settings

---------------------------------------------------------------------

1.2 DELIVERY_OWNER

Allowed:

- POST /v1/deployments/validate
- POST /v1/deployments
- POST /v1/deployments/{id}/rollback
- Read deployments within delivery group scope

Not allowed:

- Admin endpoints
- Build publishing endpoints

Read rule:

If not in deployment delivery group,
return 403 DELIVERY_GROUP_SCOPE_REQUIRED.

---------------------------------------------------------------------

1.3 OBSERVER

Allowed:

- GET /v1/deployments
- GET /v1/deployments/{id}
- GET service read endpoints
- GET insights endpoints

Not allowed:

- Validate
- Deploy
- Rollback
- Admin endpoints
- Build publishing

Observer read access is NOT delivery group scoped.

---------------------------------------------------------------------

1.4 CI Publisher

Allowed:

- POST /v1/builds/upload-capability
- POST /v1/builds
- POST /v1/builds/register

Denied:

- Deploy
- Rollback
- Admin endpoints

Must be allowlisted.

---------------------------------------------------------------------

2. Enforcement Ordering

Policy enforcement must occur in this order:

1) Delivery group policy
2) Compatibility validation
3) Quota checks
4) Concurrency checks
5) Engine execution
6) Engine execution must not be invoked if any prior governance invariant fails.

Example:

If recipe is not allowed by delivery group,
return 403 RECIPE_NOT_ALLOWED,
not 400 RECIPE_INCOMPATIBLE.

---------------------------------------------------------------------

3. Build Publishing

3.1 CI Gate

- Non-CI identity calling register returns 403 CI_ONLY.
- CI identity denied before allowlist configuration.
- Allowlist configured by admin via API.
- Allowlist persists via SSM-backed configuration.

3.2 Idempotency

All mutating endpoints require Idempotency-Key.

Missing key:
400 IDMP_KEY_REQUIRED

Same key plus same body:
replay accepted

Same key plus different body:
409 BUILD_REGISTRATION_CONFLICT

---------------------------------------------------------------------

4. Deployment Governance

4.1 Version Registration

Unregistered version:

validate -> 400 VERSION_NOT_FOUND
deploy -> 400 VERSION_NOT_FOUND

4.2 Concurrency

Default:

One active deployment per delivery group.

Second deployment attempt:
409 CONCURRENCY_LIMIT_REACHED

4.3 Quotas

Global:

- read_rpm
- mutate_rpm
- daily_quota_build_register

Delivery group:

- daily_deploy_quota
- daily_rollback_quota

Quota failures must return 429 QUOTA_EXCEEDED.

---------------------------------------------------------------------

5. Deployment Read Access

PLATFORM_ADMIN:
always allowed

OBSERVER:
always allowed

DELIVERY_OWNER:
delivery group scoped

Non-member owner:
403 DELIVERY_GROUP_SCOPE_REQUIRED

---------------------------------------------------------------------

6. Rollback

Rollback requires:

- Prior successful deployment in same service and environment
- Same concurrency enforcement
- Same quota enforcement

Rollback must create a new DeploymentRecord
with deploymentKind = ROLLBACK.

Rollback record linkage:

- Rollback record must reference the prior deployment id.
- Canonical linkage field is rollbackOf.
- rollbackOf must equal the prior deployment id.

---------------------------------------------------------------------

7. Claims Sanity

Tests must verify role resolution from token claims.

If token does not resolve to expected role,
fail test.

---------------------------------------------------------------------

8. Mutation Kill Switch

If enabled,
all mutating endpoints return 503 MUTATIONS_DISABLED.
This includes platform admin mutation endpoints.

---------------------------------------------------------------------

9. Guardrail Philosophy

SAFE mode:

- Non-destructive validation
- Policy shape verification
- No limit pushing

ACTIVE mode:

- Explicit opt-in
- Bounded limit probing
- Must clean up

Tests are sequential.
Token acquisition is not concurrent.
These are correctness tests, not load tests.

---------------------------------------------------------------------

10. Conformance Profiles

The harness supports two conformance profiles:

- `strict`
- `diagnostic`

`strict` is the contract conformance mode.
Contract invariants MUST NOT be skipped.
If a required prerequisite for a contract invariant is missing,
the run must fail with a clear message.

`diagnostic` is a best-effort operational mode.
Diagnostic checks may be skipped for environment limitations.
Contract checks still run, but prerequisite-driven skips are tolerated.

This profile model removes ambiguity between local health probing
and contract conformance verification.

---------------------------------------------------------------------

11. Change Control

If implementation and tests disagree:

1) Check this contract
2) Update this contract first if product intent changes
3) Then update API
4) Then update tests

This file is authoritative.
