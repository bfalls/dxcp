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
cd /Users/bfalls/github/dxcp/ui
npm install
export VITE_API_BASE=http://127.0.0.1:8000/v1
export VITE_API_TOKEN=demo-token
export VITE_ALLOWLIST=demo-service
npm run dev
```

Open http://127.0.0.1:5173
