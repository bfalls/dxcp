# Advanced Strategies Setup (Spinnaker Pipelines)

This guide wires the Standard, Canary, and Blue/Green DXCP recipes to Spinnaker
pipeline assets. The pipelines call the runtime-controller webhook and accept
the DXCP parameter contract used today.

## Prerequisites

- Spinnaker Gate and Deck are running (see `docs/SPINNAKER.md`).
- Runtime controller URL is available (Function URL or equivalent).
- Controller token is available as a secret value.

## Pipeline Assets

Pipelines live under `docs/spinnaker/pipelines/`:

- `docs/spinnaker/pipelines/standard-deploy.json`
- `docs/spinnaker/pipelines/canary-deploy.json`
- `docs/spinnaker/pipelines/bluegreen-deploy.json`

Each pipeline accepts these parameters (DXCP contract):

- `service`
- `version`
- `artifactRef`
- `engineUrl`
- `engineToken`
- `s3Bucket` (optional)
- `s3Key` (optional)

## Import Pipelines

Spinnaker 2025.4.0 Deck does not expose a pipeline import action in the UI.
Use the Gate API to import pipeline configs.

### Gate API (recommended)

Set the Gate base URL and an Auth0 access token (if required):

```bash
export SPINNAKER_GATE_URL=http://127.0.0.1:8084
export SPINNAKER_BEARER_TOKEN="<auth0-access-token>"
```

Import the pipelines:

```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SPINNAKER_BEARER_TOKEN}" \
  "${SPINNAKER_GATE_URL}/pipelines" \
  --data-binary @docs/spinnaker/pipelines/standard-deploy.json

curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SPINNAKER_BEARER_TOKEN}" \
  "${SPINNAKER_GATE_URL}/pipelines" \
  --data-binary @docs/spinnaker/pipelines/canary-deploy.json

curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SPINNAKER_BEARER_TOKEN}" \
  "${SPINNAKER_GATE_URL}/pipelines" \
  --data-binary @docs/spinnaker/pipelines/bluegreen-deploy.json

curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SPINNAKER_BEARER_TOKEN}" \
  "${SPINNAKER_GATE_URL}/pipelines" \
  --data-binary @spinnaker/rollback-demo-service.json
```

Windows PowerShell:

```powershell
$env:SPINNAKER_GATE_URL = "http://127.0.0.1:8084"
$env:SPINNAKER_BEARER_TOKEN = "<auth0-access-token>"

Invoke-RestMethod -Method Post `
  -Uri "$env:SPINNAKER_GATE_URL/pipelines" `
  -Headers @{ Authorization = "Bearer $env:SPINNAKER_BEARER_TOKEN" } `
  -ContentType "application/json" `
  -InFile "docs/spinnaker/pipelines/standard-deploy.json"

Invoke-RestMethod -Method Post `
  -Uri "$env:SPINNAKER_GATE_URL/pipelines" `
  -Headers @{ Authorization = "Bearer $env:SPINNAKER_BEARER_TOKEN" } `
  -ContentType "application/json" `
  -InFile "docs/spinnaker/pipelines/canary-deploy.json"

Invoke-RestMethod -Method Post `
  -Uri "$env:SPINNAKER_GATE_URL/pipelines" `
  -Headers @{ Authorization = "Bearer $env:SPINNAKER_BEARER_TOKEN" } `
  -ContentType "application/json" `
  -InFile "docs/spinnaker/pipelines/bluegreen-deploy.json"

Invoke-RestMethod -Method Post `
  -Uri "$env:SPINNAKER_GATE_URL/pipelines" `
  -Headers @{ Authorization = "Bearer $env:SPINNAKER_BEARER_TOKEN" } `
  -ContentType "application/json" `
  -InFile "spinnaker/rollback-demo-service.json"
```

After importing, refresh Deck and verify the pipelines appear under your
application.

## Configure Parameters

Set defaults in each pipeline:

- `engineUrl`: runtime controller base URL (must end with `/`).
- `engineToken`: controller token secret.

Notes:

- For local demo usage, a plain token value is acceptable.
- For production/demo parity, prefer an Orca preconfigured webhook stage that
  resolves the token from S3 secrets (see `docs/SPINNAKER.md`).
- If you use the preconfigured `dxcpDeploy`/`dxcpRollback` types, keep the
  parameter list the same and move the token into Orca config. The payload
  contract remains unchanged.

## Map Pipelines to DXCP Recipes

In the DXCP Admin UI (Recipe management):

1. Standard recipe:
   - `spinnaker_application`: your application (example: `dxcp-demo`)
   - `deploy_pipeline`: `dxcp-standard-deploy`
   - `rollback_pipeline`: `rollback-demo-service`
2. Canary recipe:
   - `spinnaker_application`: your application
   - `deploy_pipeline`: `dxcp-canary-deploy`
   - `rollback_pipeline`: `rollback-demo-service`
3. BlueGreen recipe:
   - `spinnaker_application`: your application
   - `deploy_pipeline`: `dxcp-bluegreen-deploy`
   - `rollback_pipeline`: `rollback-demo-service`

Save each recipe after validation succeeds.

## Run Demo Scenarios

Standard:

1. Register or select a build for the target service.
2. Trigger a deployment with recipe `Standard`.
3. Expected outcome: pipeline runs `dxcp-standard-deploy`, controller updates
   the runtime, and DXCP shows `SUCCEEDED`.

Canary (success path):

1. Trigger a deployment with recipe `Canary`.
2. When the pipeline reaches `canary-verdict`, click Continue.
3. Expected outcome: the promote stage runs and DXCP shows `SUCCEEDED`.

Canary (intentional failure path):

1. Trigger a deployment with recipe `Canary`.
2. At `canary-verdict`, click Stop.
3. Expected outcome: pipeline fails deterministically. DXCP marks the deployment
   as `FAILED`, and if rollback is configured it will trigger rollback and show
   `ROLLED_BACK` after completion.

Blue/Green:

1. Trigger a deployment with recipe `BlueGreen`.
2. When the pipeline reaches `cutover-traffic`, click Continue to represent
   traffic switch approval.
3. Expected outcome: pipeline completes and DXCP shows `SUCCEEDED`.

## Assumptions and Limitations

- The blue/green cutover stage is a deliberate placeholder in sandbox. In a
  real environment, replace it with a traffic switch stage (target group flip,
  load balancer API call, etc.).
- The pipelines expect the controller URL to be reachable and the token to be
  valid. A missing or incorrect token will cause a deterministic failure.
