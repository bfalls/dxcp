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
export DXCP_ALLOWLIST=demo-service
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
- DXCP_ALLOWLIST: comma-separated service allowlist (default: demo-service)
- DXCP_KILL_SWITCH: set to 1 to disable mutating operations
- DXCP_DB_PATH: SQLite path (default: ./data/dxcp.db)

Spinnaker adapter:
- DXCP_SPINNAKER_MODE: stub (default) or http
- DXCP_SPINNAKER_BASE_URL: base URL for Spinnaker API in http mode

## Notes

- Rate limits and quotas are in-memory and reset on process restart.
- Idempotency is in-memory with a 24h window.
- Upload capability and build registration are enforced via SQLite.
