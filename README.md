# Delivery Experience Control Plane (DXCP)

DXCP is a thin, opinionated developer experience layer on top of Spinnaker.
It reduces cognitive load for engineers by providing a small, stable interface for:

- Triggering deployments by intent
- Querying status in a normalized view
- Surfacing failures with actionable guidance
- Triggering rollbacks safely and quickly

This repository is intentionally scoped as a realistic demo and proposal, not a production platform.

## Problem statement

Engineers often need to deploy and troubleshoot quickly, but deployment engines can be:
- Too coupled to internal engine concepts
- Too easy to misconfigure without guardrails
- Too noisy to debug without normalized status and failures

DXCP addresses this by providing a small, opinionated interface that encodes intent,
applies safe defaults, and presents high signal status and failure information.

## Try it live (public demo)

UI:
<PUBLIC_DEMO_URL>

What you can do:
- Trigger a deployment through DXCP (which triggers a Spinnaker pipeline execution)
- Watch status progress in a normalized timeline
- Inspect failures with suggested next actions
- Roll back with one click

Notes:
- The public demo is rate limited and abuse resistant
- Deployments are serialized (one active deploy at a time)

## Five minute reviewer flow

Target: complete all steps in under 5 minutes.

### Step 1: Deploy from the UI (no setup)
1. Open the UI
2. Click Deploy
3. Watch the deployment complete
4. Click the Service URL and verify output

### Step 2: Clone the repo and make a small change
1. Clone the repo:
   git clone <THIS_REPO_URL>
   cd <REPO_ROOT>

2. Edit the demo service calculation:
   File: demo-service/src/calc.ts
   Change a single function (for example tweak the risk score formula)

3. Publish a new build:
   ./scripts/publish_demo_build.sh

This registers a new version that appears in the UI.

### Step 3: Deploy your build and verify
1. Select your published version in the UI
2. Click Deploy
3. Open the service URL and confirm the output changed

Important notes:
- No write access to this repo is required
- No AWS credentials are required
- Publishing uses a demo scoped token with strict quotas

## Repository structure

- dxcp-api/        DXCP backend
- ui/              Web UI
- spinnaker/       Pipeline definitions and notes
- demo-service/    Demo service (Release Budget Calculator)
- cdk/             Optional public demo hosting
- scripts/         Build and demo utilities
- Docs:
  - DELIVERY_VISION.md
  - ARCHITECTURE.md
  - API_DESIGN.md
  - DECISIONS.md
  - EVAL_SCORECARD.md

## How DXCP improves developer experience

DXCP provides:
- A stable API surface engineers can learn once
- Opinionated defaults that reduce misconfiguration
- Normalized deployment records that capture intent and outcome
- Actionable failure summaries
- Fast rollback as a first class action

Spinnaker remains the execution engine.
DXCP improves how engineers interact with it.

## Guardrails

To prevent abuse and unexpected cost:
- Allowlisted service only
- Single environment only
- One active deployment at a time
- Rate limits and daily quotas
- No per deploy infrastructure creation
- Kill switch for mutating operations

## Non-goals

- Not a replacement for Spinnaker
- Not a full CI system
- Not an infrastructure provisioning tool
- Not a production hardened platform

## Running locally

Local run instructions will be added as implementation lands.

See ARCHITECTURE.md and API_DESIGN.md for system details.
