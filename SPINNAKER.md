# Spinnaker (Local Demo) - DXCP Integration

This guide documents the local Spinnaker setup used for DXCP demos. DXCP does not deploy Spinnaker; it only needs the Gate base URL to trigger pipelines.

## Local endpoints

- Gate (API): `http://127.0.0.1:8084`
- Deck (UI): `http://localhost:9000/`
- Gate health: `http://127.0.0.1:8084/health`

Quick health check:

```bash
curl -sS http://127.0.0.1:8084/health
```

Windows PowerShell:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8084/health
```

## Start Spinnaker locally

Use your preferred local install (Docker or Kubernetes). Ensure Gate is reachable on `127.0.0.1:8084` and Deck is reachable on `localhost:9000`.

If you are using the Docker quickstart, confirm the Gate container is running and port `8084` is published to localhost.

## Local K8s checklist (pods + services)

Quick pods check:

```powershell
kubectl -n spinnaker get pods -o wide
```

Expected core services are up (example names):
- `spin-gate`
- `spin-deck`
- `spin-orca`
- `spin-front50`
- `spin-redis`
- `spin-clouddriver`
- `spin-echo`
- `spin-rosco`

Quick services check:

```powershell
kubectl -n spinnaker get svc
```

Confirm:
- Gate service exposes port `8084`.
- Deck service exposes port `9000`.

Quick deployments check:

```powershell
kubectl -n spinnaker get deploy
```

Confirm deployments show `READY` as `n/n` for the core services.

If pods are crash-looping, check logs for the failing deployment:

```powershell
kubectl -n spinnaker logs deploy/<deployment-name> --tail=200
```

## Configure DXCP to use Gate

DXCP reads the Gate URL from config or environment variables.

Option A: SSM (recommended)

```bash
aws ssm put-parameter --name /dxcp/config/spinnaker_gate_url --type String --value http://127.0.0.1:8084 --overwrite
```

DXCP still needs the mode switch:

```bash
export DXCP_SPINNAKER_MODE=http
```

Option B: Environment variables

```bash
export DXCP_SPINNAKER_MODE=http
export DXCP_SPINNAKER_GATE_URL=http://127.0.0.1:8084
```

Windows PowerShell:

```powershell
$env:DXCP_SPINNAKER_MODE = 'http'
$env:DXCP_SPINNAKER_GATE_URL = 'http://127.0.0.1:8084'
```

## ngrok (UI access without port forwarding)

This setup uses ngrok for UI access and does not use Cloudflare or local port forwarding.

Install ngrok (choose one):

```powershell
winget install --id Ngrok.Ngrok
```

```powershell
choco install ngrok
```

Authenticate once:

```powershell
ngrok config add-authtoken <your-ngrok-authtoken>
```

Expose Deck (UI):

```powershell
ngrok http 9000 --domain <your-subdomain>.ngrok-free.dev
```

Access the UI at:

```
https://<your-subdomain>.ngrok-free.dev/applications
```

If you also expose Gate through ngrok, set the optional Gate header values in DXCP to bypass the ngrok browser interstitial.

SSM:

```bash
aws ssm put-parameter --name /dxcp/config/spinnaker_gate_header_name --type String --value "<header-name>" --overwrite
aws ssm put-parameter --name /dxcp/config/spinnaker_gate_header_value --type String --value "<header-value>" --overwrite
```

Environment variables:

```bash
export DXCP_SPINNAKER_GATE_HEADER_NAME="<header-name>"
export DXCP_SPINNAKER_GATE_HEADER_VALUE="<header-value>"
```

Windows PowerShell:

```powershell
$env:DXCP_SPINNAKER_GATE_HEADER_NAME = '<header-name>'
$env:DXCP_SPINNAKER_GATE_HEADER_VALUE = '<header-value>'
```

Notes:
- The header is only sent if both name and value are configured.
- DXCP logs whether a custom header is configured, but never logs the value.
- DXCP always includes `ngrok-skip-browser-warning: 1` on Gate requests.

## DXCP pipeline contract

DXCP requires both `spinnakerApplication` and `spinnakerPipeline` on deploy requests.
Rollback uses the stored values from the deployment record; if they are missing, rollback fails with a clear error.

DXCP supplies intent (service + artifact/version). Spinnaker owns engine configuration (URLs, tokens, credentials).

## Engine controller config (Spinnaker-side)

Spinnaker pipelines call the Lambda execution engine controller. The controller URL is a pipeline parameter (defaulted in the pipeline config).
Do not pass the controller token as a pipeline parameter.

After importing the pipelines (`spinnaker/deploy-demo-service.json` and `spinnaker/rollback-demo-service.json`), set:
- `engineUrl` default to the controller Function URL.

Option A: SSM (recommended)

```bash
controllerUrl=$(aws ssm get-parameter --name /dxcp/config/runtime/controller_url --query Parameter.Value --output text)
aws ssm put-parameter --name /dxcp/config/engine/lambda/url --type String --value "$controllerUrl" --overwrite
```

Windows PowerShell:

```powershell
$controllerUrl = aws ssm get-parameter --name /dxcp/config/runtime/controller_url --query Parameter.Value --output text
aws ssm put-parameter --name /dxcp/config/engine/lambda/url --type String --value $controllerUrl --overwrite
```

Option B: Environment variables

```bash
export DXCP_ENGINE_LAMBDA_URL=<controller-function-url>
```

Windows PowerShell:

```powershell
$env:DXCP_ENGINE_LAMBDA_URL = '<controller-function-url>'
```

### Controller auth header (required)

Every controller request must include:

```
X-DXCP-Controller-Token: <TOKEN>
```

## Spinnaker secrets (S3 backend)

Spinnaker resolves the controller token from an S3-backed secret reference at execution time.
The pipeline JSONs store only the secret reference, not the value.

Example secrets file:

```
s3://dxcp-secrets-<account>-<region>/dxcp/secrets.yml
```

Expected YAML key:

```
controller_token: <TOKEN>
```

Secret reference format:

```
encrypted:s3!r:<region>!b:<bucket>!f:<path to file>!k:<yaml key>
```

Spinnaker needs `s3:GetObject` on the referenced object.

### Preferred approach: preconfigured webhook stages

Spinnaker does not reliably resolve `encrypted:s3!` references inside pipeline JSON at execution time.
Use Orca preconfigured webhook stages so the S3 secret reference lives in Orca config.

Orca config (example snippet):

```
webhook:
  preconfigured:
    - label: DXCP Deploy
      type: dxcpDeploy
      enabled: true
      method: POST
      url: ${parameters.engineUrl}deploy
      customHeaders:
        X-DXCP-Controller-Token:
          - encrypted:s3!r:<region>!b:dxcp-secrets-<account>-<region>!f:dxcp/secrets.yml!k:controller_token
      payload:
        service: ${parameters.service}
        version: ${parameters.version}
        artifactRef: ${parameters.artifactRef}
```

Required for the S3 secrets engine:

```
secrets:
  enabled: true
  s3:
    enabled: true
    endpointUrl: https://s3.<region>.amazonaws.com
```

Update the pipeline JSONs to use the preconfigured stage types:
- Deploy: `dxcpDeploy`
- Rollback: `dxcpRollback`

## Pipeline import (Spinnaker UI)

1) Create or select your Spinnaker application.
2) Import `spinnaker/deploy-demo-service.json`.
3) Import `spinnaker/rollback-demo-service.json`.
4) Set the `engineUrl` parameter default.
5) Save the pipelines.

DXCP discovers applications and pipelines from Gate on UI load.

## Troubleshooting

401 from controller with `encrypted:s3!` in headers:
- The S3 secret reference is not being resolved.
- Confirm the S3 secrets engine jar exists in Orca.
- Confirm `secrets.s3.enabled: true` in Orca config.

Apps missing after restart:
- Spinnaker application state is stored in Front50 (S3/MinIO).
- If MinIO uses ephemeral storage, state is lost on restart. Use a PVC or persistent volume.

## Verification checklist

1) Trigger a deploy through DXCP.
2) Fetch the execution JSON from Gate (`/pipelines/{executionId}`).
3) Confirm the token value is not visible in the execution context.

## Security notes

- Gate does not enforce auth by default. Bind it to `127.0.0.1` or a private network only.
- Treat the engine token as a secret. Never commit it to source control.
- Do not expose the controller Function URL publicly without an additional network boundary.
