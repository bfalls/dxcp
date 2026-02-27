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

Guardrails are first-class product features: DXCP is an intent-based control plane that triggers real deployments, so limits and serialization are part of the API contract, not optional add-ons. The defaults are conservative, but the guardrail concept is permanent even as values evolve. See Decision 4a in docs/DECISIONS.md.

---

## Project Status

DXCP is an actively developed delivery experience control plane designed for enterprise-scale internal platforms.

The project implements a complete, end-to-end model for governed deployments, including role-based access control, policy enforcement, reusable delivery patterns, and integration with established delivery engines such as Spinnaker.

DXCP is suitable for teams and organizations interested in evaluating or piloting a policy-driven delivery platform. Ongoing work focuses on production hardening, operational maturity, and expanded ecosystem integration.

Feedback, experimentation, and early adoption are welcome.

---

## What this repository contains

This repository contains:
- The DXCP control plane implementation
- API and UI owned by the platform
- Integration adapters for Spinnaker as the execution engine (external)
- Reference artifacts to validate behavior

## Docs

- Product & decisions
  - docs/PRODUCT_VISION.md
  - docs/DECISIONS.md
- Architecture & domains
  - docs/ARCHITECTURE.md
  - docs/DOMAIN_MODEL.md
  - docs/SERVICES.md
- Extensibility & evolution
  - docs/EXTENSIBILITY_AND_EVOLUTION.md
- API & integrations
  - docs/API_DESIGN.md
  - docs/OBSERVABILITY.md
  - docs/SPINNAKER.md
  - docs/BACKSTAGE_INTEGRATION.md
- UI & admin
  - docs/UI_SPEC.md
  - docs/ADMIN_SURFACES.md
- Demo & evaluation
  - docs/DEMO.md
  - docs/EVAL_SCORECARD.md
- Environments
  - docs/ENVIRONMENTS.md
- Migrations
  - docs/MIGRATIONS.md
- CI
  - GitHub Actions runs lint and tests on every push and PR.
  - Demo artifact publish workflow: `.github/workflows/build-demo-artifacts.yml`
- Tests
  - dxcp-api/README.md (test harness + invariant suite)

---

## Evaluation mode

DXCP can be run in a constrained evaluation mode that:
- Uses strict quotas
- Limits blast radius
- Enables safe validation of workflows

Evaluation mode exists to validate product behavior
prior to broader enablement.

## Delivery group seeding (local)

Use the seed script to insert DeliveryGroups into the local sqlite DB:
```
python scripts/seed_delivery_groups.py scripts/seed_delivery_groups.example.json
```

The seed file is a JSON list of DeliveryGroups. Entries are inserted if the id
does not already exist.

## Secrets handling

Secrets are never passed as pipeline parameters; Spinnaker resolves controller tokens from an external secret backend at execution time. This keeps execution payloads free of raw credentials. See `docs/SPINNAKER.md`.

---

## Non-Goals

DXCP is intentionally opinionated. The following are explicitly out of scope:

- Building or replacing a CI system
  (DXCP assumes artifacts already exist.)

- Acting as a general-purpose pipeline engine
  (Spinnaker remains the execution engine.)

- Abstracting Kubernetes or cloud infrastructure
  (DXCP operates at the delivery intent layer.)

- Providing a generic workflow DSL
  (Recipes are curated, productized patterns.)

- Supporting ad-hoc or manual bypasses of guardrails
  (Policy enforcement is a core feature, not optional.)

- Solving every release strategy
  (DXCP focuses on paved-road, repeatable delivery.)

These constraints are intentional. They keep DXCP focused on governed delivery, not undifferentiated orchestration.

---

## Environment configuration

See docs/ENVIRONMENTS.md for local vs AWS configuration, required variables, and SSM guidance.
Use scripts/bootstrap_config.sh for first-run SSM population.

## Demo artifact publish workflow

On pushes to `main`, GitHub Actions publishes demo artifacts when changes touch
`demo-service/**`, `demo-service-2/**`, or `scripts/publish_build.sh`.
The workflow requires repo secrets: `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, and `DXCP_ARTIFACT_BUCKET`.
Artifacts are uploaded as:
- `s3://$DXCP_ARTIFACT_BUCKET/demo-service/demo-service-<version>.zip`
- `s3://$DXCP_ARTIFACT_BUCKET/demo-service-2/demo-service-2-<version>.zip`
Version is tag-authoritative per service (`<service>/vX.Y.Z`).
CI bumps patch from the latest service tag, publishes that version, then creates/pushes the new tag.

## CI build registration integration

For the canonical CI integration contract, helper usage, templates, and validation checklist, see:
- `docs/integrations/ci/overview.md`
- `docs/integrations/ci/validation.md`

---

## UI local run

```
cd dxcp/ui
npm install
# Create ui/.env.local (see docs/AUTH.md)
npm run dev
```

Open http://127.0.0.1:5173

UI tests:
```
cd dxcp/ui
npm run test:run
```

Deployment detail view includes a normalized timeline (no engine stages).
Insights view summarizes failure categories, rollback rate, and deployment counts by recipe and delivery group (last 7 days).

## UI overview

See docs/UI_SPEC.md for the enterprise UI specification and role-aware behavior.

## Local Auth0 setup

See docs/AUTH.md for required Auth0 configuration and environment variables.

## Admin configuration

See docs/ADMIN_SURFACES.md for DeliveryGroup and Recipe administration expectations.

## Backstage integration

See docs/BACKSTAGE_INTEGRATION.md for read-first endpoints and mapping guidance.

---

## API local run

```
cd dxcp/dxcp-api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# Create dxcp-api/.env (see dxcp-api/.env.example)
uvicorn main:app --reload --env-file .env
```

Open http://127.0.0.1:8000/docs

List recipes:
```
curl -sS http://127.0.0.1:8000/v1/recipes \
  -H "Authorization: Bearer <access_token>"
```

Deploy using a recipe:
```
curl -sS -X POST http://127.0.0.1:8000/v1/deployments \
  -H "Authorization: Bearer <access_token>" \
  -H "Idempotency-Key: demo-deploy-1" \
  -H "Content-Type: application/json" \
  -d '{"service":"demo-service","environment":"sandbox","version":"1.0.0","changeSummary":"demo","recipeId":"default"}'
```

---

## Artifact discovery + versions

DXCP can discover candidate versions by scanning the runtime artifact bucket for:

```
s3://<artifact_bucket>/<service>/<service>-<version>.zip
```

Deployments require versions to be registered in DXCP before use. Use the build
registration endpoints to publish versions so they can be selected and deployed.

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
export DXCP_CORS_ORIGINS=https://your-ui-url
export DXCP_CONFIG_PREFIX=/dxcp/config
export DXCP_UI_DEFAULT_REFRESH_SECONDS=300
export DXCP_UI_MIN_REFRESH_SECONDS=60
export DXCP_UI_MAX_REFRESH_SECONDS=3600
```
DXCP does not deploy Spinnaker. Execution engines are external.
When using `scripts/deploy_aws.sh`, the CORS allowlist is sourced from SSM at `${DXCP_CONFIG_PREFIX}/api/cors_origins`.

Deploy:
```
cd dxcp
./scripts/deploy_aws.sh
```
Deploy preflight requires SSM config. Run scripts/bootstrap_config.sh first.
Check runtime configuration: `GET /v1/config/sanity`.

The script prints a summary block with UI URL, API base, and resource IDs.
Set OIDC parameters in SSM before first login (see docs/AUTH.md).

Infra-only environment VPC deploy (dev/staging/prod only):
```
./scripts/deploy_env_infra.sh
```
This provisions only environment VPC stacks (`dxcp-env-vpc-dev`, `dxcp-env-vpc-staging`, `dxcp-env-vpc-prod`).
It is safe to run repeatedly and applies CloudFormation updates when CDK definitions change.

Sanity checks:
```
curl -sS https://YOUR_API_BASE/v1/health
curl -sS https://YOUR_API_BASE/v1/deployments
```

Destroy everything:
```
./scripts/destroy_aws.sh
```
## Governance

[![Governance Conformance](../../actions/workflows/governance-tests.yml/badge.svg?branch=main)](../../actions/workflows/governance-tests.yml)

DXCP enforces authoritative, deterministic deployment governance before any execution engine is invoked. All policy decisions are evaluated server-side and must pass strict invariants covering role boundaries, idempotency, immutability, quota enforcement, kill-switch safety, and auditability.

Governance failures short-circuit before engine dispatch. No deployment can proceed unless it conforms to the frozen governance contract, which is validated via both unit-level invariants and runtime conformance tests. The result is machine-verifiable, enterprise-grade control with contained blast radius and zero side effects on policy failure. See [DXCP Governance Contract](docs/governance-tests/GOVERNANCE_CONTRACT.md).
