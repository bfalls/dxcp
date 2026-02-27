# DXCP CI Build Registration Overview

DXCP deploy eligibility requires prior build registration.
If a `service/version` is not registered, deploy is denied with `VERSION_NOT_FOUND`.

## Contract

Register existing artifacts with:
- `POST /v1/builds/register`
- `Authorization: Bearer <ci-token>`
- `Idempotency-Key: <client-generated-key>`

Required request fields (model-required):
- `service`
- `version`
- `artifactRef`
- `git_sha`
- `git_branch`
- `ci_provider`
- `ci_run_id`
- `built_at`

Optional request fields:
- `commit_url`
- `run_url`
- `checksum_sha256`
- `repo`
- `actor`
- `sha256`
- `sizeBytes`
- `contentType`
- `s3Bucket`
- `s3Key`

Compatibility note:
- `commit_url` and `run_url` are optional.
- `scripts/ci/register_build.py` supports fallback mode (`auto`): if registration returns `400 INVALID_REQUEST`, it retries once without `commit_url` and `run_url`.

## CI Identity Gate

Only allowlisted CI publisher identities can call build registration endpoints.

- `403 CI_ONLY` usually means:
  - token is not a CI publisher identity, or
  - CI identity is not on the admin-managed CI publisher allowlist.

Use `GET /v1/whoami` to inspect token identity fields (`sub`, `iss`, `aud`, `azp`) when debugging allowlist matches.

## Idempotency Semantics

- Same `Idempotency-Key` + same request body: replay accepted.
- Same `Idempotency-Key` + different request body: `409 BUILD_REGISTRATION_CONFLICT`.

`BUILD_REGISTRATION_CONFLICT` means the key was reused for a different effective request and must be changed.

## Recommended Helper-Based Approach

Use the repo helper:

`python3 scripts/ci/register_build.py ...`

References:
- Helper: `scripts/ci/register_build.py`
- Template: `docs/integrations/ci/github-actions-build-register.yml`
- Validation checklist: `docs/integrations/ci/validation.md`

## Minimal curl Example

This example assumes `DXCP_TOKEN` already contains a valid CI publisher token.

```bash
curl -sS -X POST "${DXCP_API_BASE_V1}/builds/register" \
  -H "Authorization: Bearer ${DXCP_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: github-${CI_RUN_ID}-demo-service-1.2.3" \
  -d '{
    "service":"demo-service",
    "version":"1.2.3",
    "artifactRef":"s3://artifact-bucket/demo-service/demo-service-1.2.3.zip",
    "git_sha":"<git_sha>",
    "git_branch":"main",
    "ci_provider":"github",
    "ci_run_id":"<ci_run_id>",
    "built_at":"2026-02-27T00:00:00Z"
  }'
```
