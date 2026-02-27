# DXCP CI Build Registration Validation Checklist

Use this checklist to validate CI registration wiring before relying on deploy eligibility.

## 1) Required vars and secrets

Required environment:
- `DXCP_API_BASE`
- `GOV_AUTH0_DOMAIN`
- `GOV_AUTH0_AUDIENCE`
- `GOV_CI_CLIENT_ID`
- `GOV_CI_CLIENT_SECRET` (secret)

Reference template and examples:
- `docs/integrations/ci/github-actions-build-register.yml`
- `docs/integrations/ci/env.example`

## 2) Local dry-run guidance

If you already have the required env vars, run:

```bash
python3 scripts/ci/register_build.py \
  --service demo-service \
  --version 1.2.3 \
  --artifact-ref "s3://artifact-bucket/demo-service/demo-service-1.2.3.zip" \
  --git-sha "<git_sha>" \
  --git-branch main \
  --ci-provider github \
  --ci-run-id local-1 \
  --built-at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

## 3) Expected success signals

- HTTP status: `201` (new) or `200` (idempotent replay / existing equivalent registration).
- Response should include `ci_publisher`.
- `Idempotency-Replayed` response header may be present:
  - `true` for replayed response
  - `false` for non-replayed response
  - helper reports `missing` if header is absent

## 4) Common error mapping

- `401 UNAUTHORIZED`
  - Token mint failed, expired token, wrong audience/issuer, or missing Authorization header.

- `403 CI_ONLY`
  - Non-CI token or CI identity not allowlisted in system CI publishers.

- `400 INVALID_REQUEST`
  - Request schema mismatch or invalid field shape.
  - With helper default fallback mode (`auto`), one retry is attempted without `commit_url` and `run_url`.

- `409 BUILD_REGISTRATION_CONFLICT`
  - Same `Idempotency-Key` reused with a different effective request body.
  - Use a new idempotency key for changed payloads.
