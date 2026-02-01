# Spinnaker Gate (Local Demo)

This guide assumes Spinnaker runs externally (not deployed by DXCP). DXCP only needs the Gate base URL to trigger pipelines.

## Start Gate locally

Use your preferred local Spinnaker installation (Docker, Kubernetes, or a local install).
Ensure Gate is reachable on a loopback address (for example `http://127.0.0.1:8084`).

Quick health check:

```bash
curl -sS http://127.0.0.1:8084/health
```

Windows PowerShell:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8084/health
```

If you are using the Spinnaker Docker quickstart, confirm the Gate container is running and port `8084` is published to localhost.

## Configure DXCP to use Gate

DXCP reads the Gate URL from config or environment variables.
Choose one of the following:

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

### Optional ngrok header

If Gate is exposed via ngrok and shows a browser protection/interstitial page, configure
an extra header for all DXCP → Gate requests.

SSM (recommended):

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
- DXCP auto-discovers applications and pipelines from Gate; no manual pipeline wiring is required in the UI.

## Configure the engine controller URL + secret reference

Spinnaker pipelines call the Lambda execution engine controller. DXCP supplies intent only (service + artifact/version).
Engine configuration (URL) lives in Spinnaker as a pipeline parameter. The controller token is resolved by Spinnaker from an external secret backend.
DXCP only considers a deployment triggered when Gate returns a real execution id; otherwise it reports a trigger failure and no deployment record is created.

Note: DXCP requires `spinnakerApplication` and `spinnakerPipeline` in deploy requests (and stores them on deployments).
Rollback uses those stored values; if they are missing, rollback will fail with a clear error.

After importing the pipelines (`spinnaker/deploy-demo-service.json` and `spinnaker/rollback-demo-service.json`), set:
- `engineUrl` default to the controller Function URL.

Do not pass the controller token as a pipeline parameter.

Option A: SSM (recommended)

```bash
# Controller URL (value comes from /dxcp/config/runtime/controller_url)
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

The runtime controller requires a secret header on every request:
`X-DXCP-Controller-Token: <TOKEN>`.

### Spinnaker secrets (S3 backend)

Spinnaker resolves the controller token from an S3-backed secret reference at execution time. The pipeline JSON
uses an `encrypted:s3!` reference (see the pipeline files) that points to an object such as:

```
s3://dxcp-secrets-<account>-<region>/dxcp/secrets.yml
```

The secrets bucket name is stored in SSM at:
`<configPrefix>/spinnaker/secrets_bucket`

Fetch it (bash):

```bash
aws ssm get-parameter --name <configPrefix>/spinnaker/secrets_bucket --query Parameter.Value --output text
```

Expected key inside the YAML:

```
controller_token: <TOKEN>
```

Update the secret reference in the pipeline JSONs to match your region, bucket, and key.
Secret reference format for literal values:

```
encrypted:s3!r:<region>!b:<bucket>!f:<path to file>!k:<yaml key>
```

The Spinnaker service role needs `s3:GetObject` on the referenced object.
Ensure the Spinnaker services are configured to use the S3 secrets backend and have access to the bucket.
The pipeline JSONs contain only secret references, not secret values.

### Preferred approach: preconfigured webhook stages

Spinnaker does not reliably resolve `encrypted:s3!` references inside pipeline JSON at
execution time. To keep secrets out of pipeline parameters/logs, use Orca preconfigured
webhook stages that store the S3 secret reference in Orca's service config instead.

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
          - encrypted:s3!r:us-east-1!b:dxcp-secrets-<account>-us-east-1!f:dxcp/secrets.yml!k:controller_token
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
    endpointUrl: https://s3.us-east-1.amazonaws.com
```

Update your pipeline JSON to use the preconfigured stage type:
`dxcpDeploy` (deploy) and `dxcpRollback` (rollback). The pipeline stage should only
specify `type`, `name`, `refId`, and `requisiteStageRefIds`.

### Troubleshooting: 401 from controller with S3 secrets

If the webhook stage returns 401 and the execution JSON still shows
`encrypted:s3!r:...` in the headers, Spinnaker is sending the literal
reference string instead of resolving it.

Quick checks:

1) Confirm the S3 secrets engine jar is present in Orca:

```
kubectl -n spinnaker exec deploy/spin-orca -- sh -c "ls /opt/orca/lib | grep -i s3"
```

You should see a `kork-secrets-s3-*.jar`. If it is missing, the S3
secret engine is not available in the image, even if `secrets.s3.enabled`
is set to true.

2) Confirm Orca is configured for S3 secrets:

```
kubectl -n spinnaker exec deploy/spin-orca -- sh -c "tail -n 20 /opt/spinnaker/config/spinnaker.yml"
```

Expected:

```
secrets:
  enabled: true
  s3:
    enabled: true
```

3) If the jar is missing, redeploy Spinnaker with an image or build that
includes the S3 secrets engine. This is required for `encrypted:s3!` to
resolve at runtime.

### Halyard setup (S3 secrets)

Enable the S3 secrets backend (Halyard):

```bash
hal config secret s3 enable
hal config deploy edit --type distributed --account-name <aws-account-name>
```

Provide Spinnaker with AWS credentials that can read the secrets bucket (for local dev, standard AWS env vars work):

```bash
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_DEFAULT_REGION=us-east-1
```

Upload the secret file (example):

```bash
cat > secrets.yml <<'EOF'
controller_token: <TOKEN>
EOF

aws s3 cp secrets.yml s3://dxcp-secrets-<account>-<region>/dxcp/secrets.yml
```

Then re-deploy Spinnaker:

```bash
hal deploy apply
```

Runtime controller IAM: the controller execution role must have `s3:GetObject` on the runtime artifact bucket
(`/dxcp/config/runtime/artifact_bucket`) so `UpdateFunctionCode` can pull artifacts.

Fetch the token locally without printing it (bash):

```bash
tokenParam=$(aws ssm get-parameter --name /dxcp/config/runtime/controller_token --with-decryption --query Parameter.Value --output text)
if [[ "$tokenParam" == arn:aws:secretsmanager:* ]]; then
  controllerToken=$(aws secretsmanager get-secret-value --secret-id "$tokenParam" --query SecretString --output text)
else
  controllerToken="$tokenParam"
fi
```

Example curl (deploy):

```bash
curl -sS -X POST "$controllerUrl/deploy" \
  -H "Content-Type: application/json" \
  -H "X-DXCP-Controller-Token: <TOKEN>" \
  -d '{"service":"demo-service","artifactRef":"s3://bucket/key"}'
```

Note: the S3 key used with `artifactRef` (or `s3Key`) must point to a Lambda-compatible `.zip`.

## Pipeline import notes

1) In Spinnaker, create or select the `dxcp-demo` application.
2) Import `spinnaker/deploy-demo-service.json`.
3) Import `spinnaker/rollback-demo-service.json`.
4) Edit each pipeline and set parameter defaults:
   - `engineUrl` -> runtime controller Function URL
5) Save pipelines. DXCP will pass only `service`, `version`, and `artifactRef` (deploy) or `service` + `version` (rollback).

DXCP discovers applications and pipelines from Gate on UI load. The user selects
the application + pipeline to execute for the deploy.

To filter out system apps, tag your Spinnaker application and set the UI filter:
- Tag name: `dxcp`
- Tag value: `deployable`

Webhook stage headers (Spinnaker):
- Header name: `X-DXCP-Controller-Token`
- Header value: S3 secret reference (do not commit real tokens in pipeline JSON)

DXCP supplies intent (service + artifact/version). Spinnaker owns engine configuration (URLs, tokens, credentials).

Contract enforced in code:
- `spinnaker-adapter/spinnaker_adapter/adapter.py` (`SpinnakerAdapter._http_trigger`) only forwards `engineUrl` when configured.
- `dxcp-api/main.py` (`create_deployment`) passes intent and does not require engine plumbing.
- `spinnaker-adapter/spinnaker_adapter/adapter.py` (`SpinnakerAdapter._http_trigger`) requires a real execution id from Gate; if missing, it fails the trigger.
- `dxcp-api/main.py` (`create_deployment`, `rollback_deployment`) returns `SPINNAKER_TRIGGER_FAILED` and does not create a deployment record.

## Verification checklist

1) Trigger a deploy or rollback through DXCP.
2) Fetch the execution JSON from Gate (`/pipelines/{executionId}`) and confirm the token value is not present.
3) Confirm the webhook stage succeeds (token resolved at runtime).

## Security warnings

- Gate does not enforce auth by default. Bind it to `127.0.0.1` or a private network only.
- Treat the engine token as a secret. Do not commit it to source control.
- Do not expose the Lambda Function URL publicly without an additional network boundary.
- Use different tokens for each environment and rotate them if they leak.

## Known scaling limits

- Build lookup uses a DynamoDB scan; replace with a GSI or monotonic key before production. See `dxcp-api/storage.py` (`DynamoStorage.find_latest_build`).
