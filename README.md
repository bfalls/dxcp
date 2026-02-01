# Delivery Experience Control Plane (DXCP)

DXCP is an opinionated delivery experience platform built on top of Spinnaker.
It provides a stable interface for deploying services safely and observing
delivery outcomes without requiring deep engine knowledge.
DXCP does not deploy Spinnaker. Execution engines are external.

---

## Why DXCP exists

Deployment engines are powerful but complex.
DXCP reduces cognitive load by:
- Encoding deployment intent
- Enforcing guardrails
- Normalizing status and failures
- Making rollback fast and obvious

## Product philosophy

Guardrails are first-class product features: DXCP is an intent-based control plane that triggers real deployments, so limits and serialization are part of the API contract, not optional add-ons. The defaults are conservative, but the guardrail concept is permanent even as values evolve. See Decision 4a in DECISIONS.md.

---

## What this repository contains

This repository contains:
- The DXCP control plane implementation
- API and UI owned by the platform
- Integration adapters for Spinnaker as the execution engine (external)
- Reference artifacts to validate behavior

---

## Demo mode

DXCP can be run in a constrained demo mode that:
- Uses strict quotas
- Limits blast radius
- Allows safe experimentation

Demo mode exists to validate product behavior,
not as the primary product goal.

## Delivery group seeding (local)

Use the seed script to insert DeliveryGroups into the local sqlite DB:
```
python scripts/seed_delivery_groups.py scripts/seed_delivery_groups.example.json
```

The seed file is a JSON list of DeliveryGroups. Entries are inserted if the id
does not already exist.

## Roles (demo)

DXCP uses a simple demo role override applied to all requests:
- PLATFORM_ADMIN: full access (default)
- DELIVERY_OWNER: deploy and rollback only
- OBSERVER: read-only

Set the role with:
```
export DXCP_ROLE=DELIVERY_OWNER
```

---

## Secrets handling

Secrets are never passed as pipeline parameters; Spinnaker resolves controller tokens from an external secret backend at execution time. This keeps execution payloads free of raw credentials. See `SPINNAKER.md`.

---

## Non-goals

- CI system
- Infrastructure provisioning
- Pipeline authoring tool

---

## UI local run

```
cd dxcp/ui
npm install
export VITE_API_BASE=http://127.0.0.1:8000/v1
export VITE_API_TOKEN=demo-token
npm run dev
```

Open http://127.0.0.1:5173

---

## API local run

```
cd dxcp/dxcp-api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export DXCP_API_TOKEN=demo-token
export DXCP_ALLOWLIST=demo-service
uvicorn main:app --reload
```

Open http://127.0.0.1:8000/docs

---

## Artifact discovery + versions

DXCP auto-discovers deployable versions by scanning the runtime artifact bucket for:

```
s3://<artifact_bucket>/<service>/<service>-<version>.zip
```

List versions for a service:

```
curl -sS https://YOUR_API_BASE/v1/services/demo-service/versions
```

Force a refresh (re-scan S3):

```
curl -sS "https://YOUR_API_BASE/v1/services/demo-service/versions?refresh=1"
```

Upload a new artifact and verify it appears:

```
aws s3 cp demo-service/build/demo-service-0.1.4.zip s3://<artifact_bucket>/demo-service/demo-service-0.1.4.zip
curl -sS "https://YOUR_API_BASE/v1/services/demo-service/versions?refresh=1"
```

---

## AWS deploy (CDK)

Prereqs (from scratch):
1) AWS CLI configured: `aws sts get-caller-identity` succeeds
2) Node.js installed
3) CDK bootstrap (once per account/region):
```
cd dxcp/cdk
npx cdk bootstrap aws://ACCOUNT_ID/us-east-1
```

Optional config (examples):
```
export DXCP_API_TOKEN=your-token
export DXCP_CORS_ORIGINS=https://your-ui-url
```
DXCP does not deploy Spinnaker. Execution engines are external.

Deploy:
```
cd dxcp
./scripts/deploy_aws.sh
```

The script prints a summary block with UI URL, API base, and resource IDs.

Sanity checks:
```
curl -sS https://YOUR_API_BASE/v1/health
curl -sS https://YOUR_API_BASE/v1/deployments
```

Destroy everything:
```
./scripts/destroy_aws.sh
```
