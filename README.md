# Delivery Experience Control Plane (DXCP)

DXCP is an opinionated delivery experience platform built on top of Spinnaker.
It provides a stable interface for deploying services safely and observing
delivery outcomes without requiring deep engine knowledge.

---

## Why DXCP exists

Deployment engines are powerful but complex.
DXCP reduces cognitive load by:
- Encoding deployment intent
- Enforcing guardrails
- Normalizing status and failures
- Making rollback fast and obvious

---

## What this repository contains

This repository contains:
- The DXCP control plane implementation
- API and UI owned by the platform
- Integration with Spinnaker as the execution engine
- Reference artifacts to validate behavior

---

## Demo mode

DXCP can be run in a constrained demo mode that:
- Uses strict quotas
- Limits blast radius
- Allows safe experimentation

Demo mode exists to validate product behavior,
not as the primary product goal.

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
export DXCP_SPINNAKER_BASE_URL=http://localhost:8084
export DXCP_CORS_ORIGINS=https://your-ui-url
```

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
