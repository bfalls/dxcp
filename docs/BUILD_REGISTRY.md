# DXCP Build Registry Governance

This document defines the governance model for build registration and deploy eligibility in DXCP.
It is normative for DXCP v1.

## Purpose

DXCP is the source of truth for build eligibility and deployment eligibility.
A deploy request must reference a build version that is registered in DXCP for the target service.

Build registration is CI certification, not manual admin approval.
The registration event certifies that the build passed the required delivery controls and is eligible to deploy through DXCP.

## Definitions

- Build
  - A versioned, immutable artifact candidate for deployment (for example, `1.2.3` for a service).
- Build Registry
  - DXCP-owned record of deploy-eligible builds per service, including artifact reference and metadata.
- ArtifactRef
  - Opaque URI reference to the artifact location (`s3://bucket/key` in v1).
- Certified build
  - A build that has been registered in DXCP by an authorized CI identity with required provenance metadata.

## Trust Boundary

Only CI identities can register builds.
Human user identities, UI users, and ad hoc scripts are not trusted registrars.

Why:
- CI registration creates a consistent, auditable certification point.
- It prevents bypass of test and policy controls enforced in delivery pipelines.
- It preserves a clear custody chain from source revision to deployed artifact.

Operationally, a registration must include provenance metadata sufficient to audit origin and integrity.
Required metadata:
- service
- version
- artifactRef
- git_sha
- git_branch
- ci_provider
- ci_run_id
- built_at

Also required for artifact integrity enforcement in DXCP v1:
- sha256
- sizeBytes
- contentType

Optional metadata:
- checksum_sha256
- repo
- actor

## Deploy Eligibility Rule

Deploy requires a registered build.
If the requested version is not registered for the service, DXCP returns `VERSION_NOT_FOUND`.

`VERSION_NOT_FOUND` is an action-required state, not a transient platform failure.
Required action is to run the CI registration flow for that exact service/version and retry deploy.

## Expected Drift Scenario

Scenario:
1. A team triggers a direct Spinnaker deploy with a version not registered in DXCP.
2. DXCP receives the deploy intent for that version and checks registry eligibility.
3. DXCP blocks the deploy with `VERSION_NOT_FOUND`.

Resolution:
1. CI publishes or references the artifact and registers the build in DXCP.
2. CI provides required provenance and integrity metadata during registration.
3. The team retries deploy through DXCP; eligibility now passes.

This guardrail is intentional. It prevents deployment paths that bypass DXCP governance.

## Demo Artifact Retention and Missing Artifacts

In demo mode, artifact objects in S3 may expire (for example, 14 days) to control storage cost.
Retention is configured in infrastructure (CDK-defined S3 lifecycle rules), not in DXCP runtime behavior.
DXCP can still have a valid build registry entry after the artifact object has been deleted by retention policy.

Consequence:
- Deploy or rollback can fail when the registry has `service/version` but S3 no longer has the object.
- This is expected when retention windows are shorter than rollback/audit horizons.
- For enterprise usage, increase S3 retention windows (or disable expiration) to match operational requirements.

Troubleshooting:
- `VERSION_NOT_FOUND`: the requested `service/version` is not registered in DXCP build registry. Run CI registration for that exact version, then retry.
- `ARTIFACT_NOT_FOUND`: the `service/version` is registered, but the artifact object is no longer retrievable from the artifact store. Rebuild/publish and register again via CI, then deploy the new version.
- API failures include `request_id`; provide that id to platform support for trace correlation.

## Minimal CI Integration (Conceptual)

```text
CI pipeline stages:
1) Build artifact
2) Validate tests and policy gates
3) Register build in DXCP
   POST /v1/builds
   {
     service,
     version,
     artifactRef,
     sha256,
     sizeBytes,
     contentType,
     provenance: {
       ciSystem,
       pipelineId,
       runId,
       sourceRevision
     }
   }
4) Trigger deploy via DXCP using the same service/version
```

Notes:
- The snippet is conceptual and does not prescribe CI vendor or workflow syntax.
- Registration and deploy must be executed with authorized non-human CI credentials.
