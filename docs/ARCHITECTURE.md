# DXCP Architecture

DXCP is a thin, opinionated layer on top of Spinnaker. It exposes a small,
stable interface for deployment intent, status, failures, and rollback. It does
not replace the engine and does not surface raw engine complexity to users.

## System diagram (ASCII)

User
  |
  v
DXCP UI
  |
  v
DXCP API --------------------+
  |                           |
  |  (guardrails, intent,     |
  |   normalization)          |
  v                           |
Persistence (records)         |
  |                           |
  +--------> Spinnaker Adapter -----> Spinnaker
                     (engine API)     (pipelines)
  |
  +--------> Artifact Store (demo build publish)

Legend:
- Solid lines are direct calls.
- Adapter isolates DXCP from engine specifics.

## Primary components

1) DXCP UI
- Owned interface for the reviewer flow.
- Shows intent-driven deploy actions and normalized status.
- Does not expose raw engine graphs.

2) DXCP API
- Owned contract-first API for deploy, status, failures, rollback.
- Enforces guardrails and validation.
- Translates intent into engine execution via the adapter.
- Normalizes engine status and failures into DXCP records.

3) Persistence (DeploymentRecord store)
- Stores normalized deployment records.
- Source of truth for status and failure summaries.
- References underlying engine execution IDs.

4) Spinnaker Adapter
- Thin boundary that maps DXCP intent to Spinnaker pipeline executions.
- Reads engine status and translates it to DXCP FailureModel.
- Hides engine-specific stages, fields, and pagination.

5) Artifact Store (demo build publish)
- Stores published demo builds and metadata.
- Access is controlled by demo-scoped token and quotas.

## Boundaries and ownership

DXCP owns:
- Public UI and API contracts
- Deployment intent schema
- Deployment records and failure normalization
- Guardrails and validation policies
- Reviewer flow and usability

Spinnaker owns:
- Pipeline execution and orchestration
- Stage execution details and retries
- Low-level execution logs and graphs

## Adapter boundary (DXCP to Spinnaker)

Inputs from DXCP to adapter:
- DeploymentIntent with a specific Recipe
- Idempotency key and requested action (deploy or rollback)

Outputs from adapter to DXCP:
- Engine execution ID and normalized status
- Failure details translated into FailureModel
- Links to engine execution for deep debug

The adapter is the only component that understands raw engine schemas.

## Extensibility seams (Phase 4)

Engine-agnostic in DXCP means the user-facing contract is stable and intent-shaped, not that the engine is interchangeable today.
The adapter boundary is the seam for future engines, but DXCP v1 is intentionally Spinnaker-only.

ArtifactSource is the seam for artifact discovery and validation.
Today it is constrained to AWS S3 semantics and S3-backed artifactRef formats.

Future engines or artifact stores would be added by implementing new adapters or sources and mapping recipes to them.
Engine selection is not supported in v1 and would require a deliberate contract change.

## Guardrails mapped to system boundaries

DXCP API boundary:
- Allowlisted service only
- Single environment only
- One active deployment at a time
- Rate limits and daily quotas
- Idempotency keys for deploy and rollback
- Validation of recipe and version inputs

Spinnaker adapter boundary:
- Only approved pipelines are callable
- Engine responses are normalized and filtered
- No raw engine fields leak to the UI or API

Artifact publish boundary:
- Demo-scoped token
- Size and rate limits
- Only approved artifact formats

## Hidden complexity

DXCP intentionally hides:
- Spinnaker stage graphs, internal IDs, and retries
- Engine-specific error codes and transient noise
- Pipeline templating and low-level configuration knobs

DXCP exposes:
- Deployment intent, status, failures, and rollback
- Normalized timeline and actionable failure guidance
- Links to engine execution for deep debug when needed
