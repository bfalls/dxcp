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

Idempotency:
- Mutating endpoints require Idempotency-Key header
- Idempotency-Key must be a unique, client-generated string
- Server enforces 24h idempotency window per key

Rate limits and quotas (defaults):
- Read requests: 60 requests per minute per client
- Mutating requests: 10 requests per minute per client
- Daily quotas per client:
  - Deployments: 25 per day
  - Rollbacks: 10 per day
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

- One active deployment at a time (global lock)
  - when a deployment is in ACTIVE state, new deploy/rollback requests return 409 DEPLOYMENT_LOCKED

- Idempotency keys required
  - missing Idempotency-Key on mutating endpoints returns 400 IDMP_KEY_REQUIRED

- Input validation
  - version format: ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$
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

### DeploymentRecord

Fields:
- id
- service
- environment
- version
- state (PENDING | ACTIVE | SUCCEEDED | FAILED | ROLLED_BACK)
- createdAt
- updatedAt
- spinnakerExecutionId (required)
- spinnakerExecutionUrl (required, deep-linkable)
- failures (list of NormalizedFailure)

### NormalizedFailure

Fields:
- category (INFRA | CONFIG | APP | POLICY | UNKNOWN)
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

---

## Endpoints

### Deployments

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

- POST /v1/deployments/{deploymentId}/rollback
  - Trigger rollback for a prior deployment
  - Requires Idempotency-Key header
  - Response: DeploymentRecord (new record with state ACTIVE)

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

---

## Errors (common)

- 400 INVALID_REQUEST
- 400 INVALID_ENVIRONMENT
- 400 IDMP_KEY_REQUIRED
- 400 INVALID_ARTIFACT
- 401 UNAUTHORIZED
- 403 SERVICE_NOT_ALLOWLISTED
- 409 DEPLOYMENT_LOCKED
- 429 RATE_LIMITED
- 503 MUTATIONS_DISABLED

---

## Spinnaker Integration Requirements

- Every DeploymentRecord must include spinnakerExecutionId
- Every DeploymentRecord must include spinnakerExecutionUrl for UI deep-link

---

## Phase 3 Exit Criteria

- API contract is stable and documented
- Guardrails are explicit and enforceable
- Spinnaker linkage is captured in the DeploymentRecord

