# DXCP API Design - Phase 3

This document defines the external API contract and policy surface for DXCP.
It is intentionally small, opinionated, and guardrail-first.

All text is ASCII and describes the Phase 3 contract only.

---

## Goals

- Trigger deployments by intent, not by engine detail
- Query normalized deployment status and failures
- Provide rollback with strong guardrails
- Publish builds in a controlled, auditable flow
- Encode policy in the API surface itself

---

## API Overview

Base URL:
- /v1

Authentication:
- Bearer token (Authorization: Bearer <token>)

Roles (demo):
- PLATFORM_ADMIN: full access
- DELIVERY_OWNER: deploy and rollback only
- OBSERVER: read-only

Spinnaker discovery endpoints:
- /v1/spinnaker/* requires PLATFORM_ADMIN.
- PLATFORM_ADMIN only.
- Non-admin requests return 403.

Idempotency:
- Mutating endpoints require Idempotency-Key header
- Idempotency-Key must be a unique, client-generated string
- Server enforces 24h idempotency window per key

Rate limits and quotas (defaults):
- Read requests: 60 requests per minute per client
- Mutating requests: 10 requests per minute per client
- Daily quotas per delivery group:
  - Deployments: 25 per day
  - Rollbacks: 10 per day
- Daily quotas per client:
  - Build registrations: 50 per day
  - Upload capability requests: 50 per day

Kill switch:
- A server-side kill switch can disable all mutating operations
- When enabled, mutating endpoints return 503 with code MUTATIONS_DISABLED

---

## Policy and Guardrails (enforced by API)

- Allowlisted service only
  - service must be in server allowlist
  - non-allowlisted services return 403 SERVICE_NOT_ALLOWLISTED

- Single environment only
  - environment must be "sandbox"
  - any other value returns 400 INVALID_ENVIRONMENT

- One active deployment at a time per delivery group (default)
  - when a deployment is in ACTIVE or IN_PROGRESS in a group, new deploy/rollback requests return 409 CONCURRENCY_LIMIT_REACHED

- Idempotency keys required
  - missing Idempotency-Key on mutating endpoints returns 400 IDMP_KEY_REQUIRED

- Input validation
  - version format: ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$
  - version must be registered for the service before deploy
  - artifact size max: 200MB
  - artifact types allowlist: zip, tar.gz
  - artifact checksum required: sha256

- Strict artifact validation
  - upload capability includes expected size, checksum, and content type
  - server validates size, checksum, and allowlisted type on register
  - invalid artifacts return 400 INVALID_ARTIFACT

---

## Resources

### DeploymentIntent

Fields:
- service (string, allowlisted)
- environment (string, must be "sandbox")
- version (string, validated format)
- changeSummary (string, required, max 240 chars)
- recipeId (string, required)

Notes:
- Engine application and pipeline identifiers are mapped from the Recipe and not user-provided.
- Deploy rejects versions that are not registered for the service.

### DeploymentRecord

Fields:
- id
- service
- environment
- version
- recipeId
- state (PENDING | IN_PROGRESS | ACTIVE | SUCCEEDED | FAILED | CANCELED | ROLLED_BACK)
- deploymentKind (ROLL_FORWARD | ROLLBACK)
- outcome (SUCCEEDED | FAILED | ROLLED_BACK | CANCELED | SUPERSEDED; null while in progress)
- changeSummary
- createdAt
- updatedAt
- deliveryGroupId
- engineExecutionId (admin-only)
- engineExecutionUrl (admin-only)
- rollbackOf (optional; deployment id being rolled back)
- failures (list of NormalizedFailure)

### TimelineEvent

Fields:
- key
- label
- occurredAt
- detail (optional)

### NormalizedFailure

Fields:
- category (INFRASTRUCTURE | CONFIG | APP | POLICY | VALIDATION | ARTIFACT | TIMEOUT | ROLLBACK | UNKNOWN)
- summary (string)
- detail (string)
- actionHint (string)
- observedAt

### BuildUploadCapability

Fields:
- uploadType (SIGNED_URL | TOKEN)
- uploadUrl or uploadToken
- expiresAt
- expectedSizeBytes
- expectedSha256
- expectedContentType

### BuildRegistration

Fields:
- service (allowlisted)
- version (validated format)
- artifactRef (string, storage path or handle)
- sha256
- sizeBytes
- contentType
- registeredAt

### BuildRegisterExisting

Fields:
- service (allowlisted)
- version (validated format)
- artifactRef (s3://bucket/key) OR s3Bucket + s3Key

### DeliveryGroup

Fields:
- id
- name
- description (optional)
- owner (optional)
- services (list of allowlisted service names)
- allowed_recipes (list of recipe ids or names)
- guardrails (optional, DeliveryGroupGuardrails)
- created_at
- created_by
- updated_at
- updated_by
- last_change_reason

Notes:
- Update requests may include change_reason (optional). The API stores the most recent value as last_change_reason.

### DeliveryGroupGuardrails

Fields:
- max_concurrent_deployments
- daily_deploy_quota
- daily_rollback_quota

### Recipe

Fields:
- id
- name
- description (optional)
- spinnaker_application
- deploy_pipeline
- rollback_pipeline
- status
- created_at
- created_by
- updated_at
- updated_by
- last_change_reason

Notes:
- Update requests may include change_reason (optional). The API stores the most recent value as last_change_reason.

### AuditEvent

Fields:
- event_id
- event_type
- actor_id
- actor_role
- target_type
- target_id
- timestamp
- outcome (SUCCESS, DENIED, FAILED)
- summary
- delivery_group_id (optional)
- service_name (optional)
- environment (optional)

---

## Endpoints

### Deployments

- POST /v1/deployments/validate
  - Validate intent against current policy and guardrails
  - Request: DeploymentIntent
  - Response: DeploymentPreflight (quota + concurrency snapshot)

- POST /v1/deployments
  - Trigger deployment by intent
  - Requires Idempotency-Key header
  - Request: DeploymentIntent
  - Response: DeploymentRecord

- GET /v1/deployments/{deploymentId}
  - Query deployment status
  - Response: DeploymentRecord

- GET /v1/deployments
  - List deployments (optional filters: service, state)
  - Response: list of DeploymentRecord

- GET /v1/deployments/{deploymentId}/failures
  - View normalized failures
  - Response: list of NormalizedFailure

- GET /v1/deployments/{deploymentId}/timeline
  - View normalized timeline events
  - Response: list of TimelineEvent

### Delivery Groups (read-only)

- GET /v1/delivery-groups
  - List delivery groups
  - Response: list of DeliveryGroup

- GET /v1/delivery-groups/{id}
  - Get delivery group by id
  - Response: DeliveryGroup

### Recipes (read-only)

- GET /v1/recipes
  - List recipes
  - Response: list of Recipe

- GET /v1/recipes/{id}
  - Get recipe by id
  - Response: Recipe

### Services (Backstage)

- GET /v1/services/{service}/delivery-status
  - Latest deployment summary for a service
  - Response: { service, hasDeployments, latest, currentRunning }

- GET /v1/services/{service}/allowed-actions
  - Allowed actions for the service and caller role
  - Response: { service, role, actions }

### Insights (read-only)

- GET /v1/insights/failures?windowDays=7&groupId=...
  - Aggregate failures and rollback rate over the window.
  - Response: { windowDays, windowStart, windowEnd, totalDeployments, totalRollbacks, rollbackRate, failuresByCategory, deploymentsByRecipe, deploymentsByGroup }

- POST /v1/deployments/{deploymentId}/rollback
  - Trigger rollback for a prior deployment
  - Requires Idempotency-Key header
  - Response: DeploymentRecord (new record with state ACTIVE)

- GET /v1/spinnaker/applications
  - List Spinnaker applications (Gate)
  - Optional query: tagName, tagValue (filter applications by tag)
  - Response: list of { name }
  - Authz: PLATFORM_ADMIN only

- GET /v1/spinnaker/applications/{application}/pipelines
  - List Spinnaker pipeline configs for an application
  - Response: list of { id, name }
  - Authz: PLATFORM_ADMIN only

- GET /v1/spinnaker/status
  - Spinnaker health check
  - Authz: PLATFORM_ADMIN only

### Audit (admin-only)

- GET /v1/audit/events
  - List audit events (append-only)
  - Filters: event_type, delivery_group_id, start_time, end_time, limit
  - Authz: PLATFORM_ADMIN only

### Build Publish Flow

- POST /v1/builds/upload-capability
  - Obtain upload capability (token or signed URL)
  - Requires Idempotency-Key header
  - Request: service, version, expectedSizeBytes, expectedSha256, contentType
  - Response: BuildUploadCapability

- Upload artifact
  - Upload performed directly to storage using provided capability
  - Server validates size, checksum, and allowlisted content type on register

- POST /v1/builds
  - Register a build/version so it appears in the UI
  - Requires Idempotency-Key header
  - Request: BuildRegistration (service, version, artifactRef, sha256, sizeBytes, contentType)
  - Response: BuildRegistration

- POST /v1/builds/register
  - Register an existing S3 artifact without upload capability
  - Requires Idempotency-Key header
  - Request: BuildRegisterExisting (service, version, artifactRef OR s3Bucket+s3Key)
  - Response: BuildRegistration

---

## Errors (common)

Error response schema:
```
{
  "code": "ENGINE_CALL_FAILED",
  "message": "Unable to retrieve Spinnaker applications.",
  "operator_hint": "Spinnaker HTTP 403 (redacted).",
  "request_id": "<uuid>"
}
```

Notes:
- message is safe for end users and never includes secrets.
- operator_hint is only included for PLATFORM_ADMIN (or demo mode) and is redacted.
- request_id is always present for correlation.

- 400 INVALID_REQUEST
- 400 INVALID_VERSION
- 400 INVALID_ENVIRONMENT
- 400 IDMP_KEY_REQUIRED
- 400 INVALID_ARTIFACT
- 400 NO_PRIOR_SUCCESSFUL_VERSION
- 400 RECIPE_ID_REQUIRED
- 400 VERSION_NOT_FOUND
- 401 UNAUTHORIZED
- 403 SERVICE_NOT_ALLOWLISTED
- 403 SERVICE_NOT_IN_DELIVERY_GROUP
- 403 ROLE_FORBIDDEN
- 403 RECIPE_NOT_ALLOWED
- 403 ENVIRONMENT_NOT_ALLOWED
- 404 RECIPE_NOT_FOUND
- 409 CONCURRENCY_LIMIT_REACHED
- 429 QUOTA_EXCEEDED
- 503 MUTATIONS_DISABLED
- 400 RECIPE_INCOMPATIBLE

Engine error codes:
- ENGINE_CALL_FAILED
- ENGINE_UNAVAILABLE
- ENGINE_UNAUTHORIZED
- ENGINE_TIMEOUT

Enforcement order:
1) DeliveryGroup policy checks (service, environment, recipe) -> 403
2) Service/recipe compatibility checks -> 400

---

## Engine Integration Requirements

- DeploymentRecords include engine execution identifiers for PLATFORM_ADMIN diagnostics.

---

## Phase 3 Exit Criteria

- API contract is stable and documented
- Guardrails are explicit and enforceable
- Engine linkage is captured for PLATFORM_ADMIN diagnostics
