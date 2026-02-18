# DXCP API (Phase 4 MVP)

This is a minimal FastAPI backend that implements the Phase 3 API contract
and enforces guardrails. It uses SQLite for persistence and a Spinnaker adapter
for engine interactions.

## Quick start (local)

- Install deps from requirements.txt
- Run: uvicorn main:app --reload

## Install and initial test

Install dependencies:

```
cd dxcp/dxcp-api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Start the server:

```
uvicorn main:app --reload
```

Minimal API test (adjust token and service as needed):

```
export DXCP_API_TOKEN=demo-token
uvicorn main:app --reload
```

POST /v1/deployments:

```
curl -s -X POST http://127.0.0.1:8000/v1/deployments \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer demo-token' \\
  -H 'Idempotency-Key: deploy-001' \\
  -d '{\"service\":\"demo-service\",\"environment\":\"sandbox\",\"version\":\"1.0.0\",\"changeSummary\":\"demo deploy\"}'
```

GET /v1/deployments:

```
curl -s http://127.0.0.1:8000/v1/deployments \\
  -H 'Authorization: Bearer demo-token'
```

## Environment variables

- DXCP_API_TOKEN: if set, requests require Authorization: Bearer <token>
- DXCP_KILL_SWITCH: set to 1 to disable mutating operations
- DXCP_DB_PATH: SQLite path (default: ./data/dxcp.db)
- DXCP_SERVICE_REGISTRY_PATH: registry file path (default: ./data/services.json)

Spinnaker adapter:
- DXCP_SPINNAKER_MODE: stub (default) or http
- DXCP_SPINNAKER_GATE_URL: base URL for Spinnaker Gate in http mode

## Notes

- Rate limits and quotas are in-memory and reset on process restart.
- Idempotency is in-memory with a 24h window.
- Upload capability and build registration are enforced via SQLite.

## Tests

DXCP tests are safe-by-default and runnable without tribal knowledge. The default
test harness uses local SQLite and a fake engine adapter (no real Spinnaker or
AWS calls).

Install dev dependencies (from repo root):

```
pip install -r dxcp-api/requirements.txt -r requirements-dev.txt
```

Run the same API tests CI runs (from repo root):

```
npm test
```

API invariant suite only (from repo root):

```
pytest dxcp-api/tests/test_*_invariants.py
```

## CI publishers and build registration

DXCP only allows build registration from caller identities that match a configured
CI Publisher object.

### Add CI publishers

1. Call `GET /v1/admin/system/ci-publishers` as a Platform Admin.
2. Update and save with `PUT /v1/admin/system/ci-publishers` using:
   - `{ "publishers": [ ... ] }`
3. Prefer matching on stable token claims such as `authorized_party_azp`, then
   `iss`/`aud`, and use `sub`/`email` when appropriate.

### Verify token identity without decoding JWTs

Use:

```
curl -sS https://<api-base>/v1/whoami \
  -H "Authorization: Bearer <token>"
```

Response fields are the same identity values DXCP uses for CI publisher matching:
`actor_id`, `sub`, `email`, `iss`, `aud`, `azp`.

### Build registration flow

1. Upload artifact to S3 (for example `s3://<bucket>/<service>/<service>-<version>.zip`).
2. Register with `POST /v1/builds/register` including:
   - `service`, `version`, `artifactRef`
   - `git_sha`, `git_branch`
   - `ci_provider` (for GitHub Actions, `"github"`)
   - `ci_run_id`, `built_at` (UTC ISO-8601)
3. Send an idempotency key (example:
   `github-<run_id>-demo-service-<version>`).
4. Read back a single build with `GET /v1/builds?service=<service>&version=<version>`.
   The response matches build registration shape and includes `ci_publisher` plus
   provenance fields such as `git_sha`, `git_branch`, `ci_provider`, `ci_run_id`,
   `built_at`, `checksum_sha256`, `repo`, `actor`, `registeredAt`, and `id`.

If the caller token does not match any configured publisher, DXCP returns `CI_ONLY`.
