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

## Configure the engine controller URL + token

Spinnaker pipelines call the Lambda execution engine controller. DXCP supplies intent only (service + artifact/version).
Engine configuration (URL + token) lives in Spinnaker as pipeline parameter defaults. DXCP does not require these values.
DXCP only considers a deployment triggered when Gate returns a real execution id; otherwise it reports a trigger failure and no deployment record is created.

After importing the pipelines (`spinnaker/deploy-demo-service.json` and `spinnaker/rollback-demo-service.json`), set:
- `engineUrl` default to the controller Function URL.
- `engineToken` default to the controller token.

If you prefer to keep these values in SSM or environment variables, copy them into the Spinnaker UI defaults.

Option A: SSM (recommended)

```bash
# Controller URL (value comes from /dxcp/config/runtime/controller_url)
controllerUrl=$(aws ssm get-parameter --name /dxcp/config/runtime/controller_url --query Parameter.Value --output text)
aws ssm put-parameter --name /dxcp/config/engine/lambda/url --type String --value "$controllerUrl" --overwrite

# Controller token (value stored as a SecureString in /dxcp/config/runtime/controller_token)
tokenParam=$(aws ssm get-parameter --name /dxcp/config/runtime/controller_token --with-decryption --query Parameter.Value --output text)
if [[ "$tokenParam" == arn:aws:secretsmanager:* ]]; then
  tokenParam=$(aws secretsmanager get-secret-value --secret-id "$tokenParam" --query SecretString --output text)
fi
aws ssm put-parameter --name /dxcp/config/engine/lambda/token --type SecureString --value "$tokenParam" --overwrite
```

Windows PowerShell:

```powershell
$controllerUrl = aws ssm get-parameter --name /dxcp/config/runtime/controller_url --query Parameter.Value --output text
aws ssm put-parameter --name /dxcp/config/engine/lambda/url --type String --value $controllerUrl --overwrite

$tokenParam = aws ssm get-parameter --name /dxcp/config/runtime/controller_token --with-decryption --query Parameter.Value --output text
if ($tokenParam -like 'arn:aws:secretsmanager:*') {
  $tokenParam = aws secretsmanager get-secret-value --secret-id $tokenParam --query SecretString --output text
}
aws ssm put-parameter --name /dxcp/config/engine/lambda/token --type SecureString --value $tokenParam --overwrite
```

Option B: Environment variables

```bash
export DXCP_ENGINE_LAMBDA_URL=<controller-function-url>
export DXCP_ENGINE_LAMBDA_TOKEN=<controller-token>
```

Windows PowerShell:

```powershell
$env:DXCP_ENGINE_LAMBDA_URL = '<controller-function-url>'
$env:DXCP_ENGINE_LAMBDA_TOKEN = '<controller-token>'
```

### Controller auth header (required)

The runtime controller requires a secret header on every request:
`X-DXCP-Controller-Token: <TOKEN>`.

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
   - `engineToken` -> runtime controller token
5) Save pipelines. DXCP will pass only `service`, `version`, and `artifactRef` (deploy) or `service` + `version` (rollback).

DXCP discovers applications and pipelines from Gate on UI load. The user selects
the application + pipeline to execute for the deploy.

To filter out system apps, tag your Spinnaker application and set the UI filter:
- Tag name: `dxcp`
- Tag value: `deployable`

Webhook stage headers (Spinnaker):
- Header name: `X-DXCP-Controller-Token`
- Header value: `<TOKEN>` (do not commit real tokens in pipeline JSON)

DXCP supplies intent (service + artifact/version). Spinnaker owns engine configuration (URLs, tokens, credentials).

Contract enforced in code:
- `spinnaker-adapter/spinnaker_adapter/adapter.py` (`SpinnakerAdapter._http_trigger`) only forwards `engineUrl`/`engineToken` when configured.
- `dxcp-api/main.py` (`create_deployment`) passes intent and does not require engine plumbing.
- `spinnaker-adapter/spinnaker_adapter/adapter.py` (`SpinnakerAdapter._http_trigger`) requires a real execution id from Gate; if missing, it fails the trigger.
- `dxcp-api/main.py` (`create_deployment`, `rollback_deployment`) returns `SPINNAKER_TRIGGER_FAILED` and does not create a deployment record.

## Security warnings

- Gate does not enforce auth by default. Bind it to `127.0.0.1` or a private network only.
- Treat the engine token as a secret. Do not commit it to source control.
- Do not expose the Lambda Function URL publicly without an additional network boundary.
- Use different tokens for each environment and rotate them if they leak.

## Known scaling limits

- Build lookup uses a DynamoDB scan; replace with a GSI or monotonic key before production. See `dxcp-api/storage.py` (`DynamoStorage.find_latest_build`).
