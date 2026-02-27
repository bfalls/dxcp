# DXCP CI Build Registration

DXCP requires explicit CI build registration before a version is deploy-eligible.
Deploy attempts for unregistered versions fail with `VERSION_NOT_FOUND`.

Use `scripts/ci/register_build.py` to register existing artifacts with:
- CI identity (Auth0 client credentials)
- Idempotency key
- Build provenance metadata

## Required environment

Set these in CI:

- `DXCP_API_BASE`
- `GOV_AUTH0_DOMAIN`
- `GOV_AUTH0_AUDIENCE`
- `GOV_CI_CLIENT_ID`
- `GOV_CI_CLIENT_SECRET` (secret)

## Minimal invocation

```bash
python3 scripts/ci/register_build.py \
  --service demo-service \
  --version 1.2.3 \
  --artifact-ref "s3://my-artifact-bucket/demo-service/demo-service-1.2.3.zip" \
  --git-sha "$GITHUB_SHA" \
  --git-branch "$GITHUB_REF_NAME" \
  --ci-provider github \
  --ci-run-id "$GITHUB_RUN_ID" \
  --built-at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --commit-url "${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/commit/${GITHUB_SHA}" \
  --run-url "${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
```

Notes:
- `DXCP_API_BASE` is normalized to include `/v1` if omitted.
- For `ci-provider=github`, default idempotency key is `github-<ci_run_id>-<service>-<version>`.
- By default the helper validates CI identity with `GET /v1/whoami`.
- Metadata fallback is enabled by default: on `400 INVALID_REQUEST`, retry once without `commit_url` and `run_url`.
