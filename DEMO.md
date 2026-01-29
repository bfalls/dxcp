# DXCP Demo - Reference Service

This demo validates DXCP end to end with a single reference service.
This document does not provide product direction.

## 1) Change one function

Edit the calculation in demo-service/app.py:

- Function: calculate_result
- Example change: return x + 10 instead of x + 7

This is a visible change in the response payload.

## 2) Publish a new build

Run the publish script from the repo root:

```
./scripts/publish_build.sh
```

Optional: provide a specific version (must match the version format):

```
./scripts/publish_build.sh 1.0.1
```

If you need to re-run the same version, add a randomized idempotency suffix:

```
DXCP_IDEMPOTENCY_RANDOMIZE=1 ./scripts/publish_build.sh 1.0.1
```

This script:
- builds a Lambda-compatible .zip artifact
- requests an upload capability
- registers the build so it appears in the UI

## Register existing artifact

DXCP auto-registers existing artifacts during deploy when it finds:

`s3://<runtime-artifact-bucket>/<service>/<service>-<version>.zip`

The API validates the object (bucket allowlist, size, checksum, .zip) and stores it
in the DXCP build registry so it can be deployed. No manual curl step is required.

## 3) Deploy via the UI

Start the API and UI, then:
- Open the UI Deploy view
- Select demo-service
- Enter the version you published
- Deploy

The UI will show the DeploymentRecord id and execution link.

## 4) Verify output at the service URL

For the deployed demo, the public URL is stored in SSM:

```
aws ssm get-parameter --name /dxcp/config/runtime/service_url/demo-service --query Parameter.Value --output text
```

This Function URL is intended to be publicly reachable for the demo.

Run the reference service locally (optional):

```
cd dxcp/demo-service
python3 app.py
```

Open http://127.0.0.1:9000

Expected JSON:
- version matches the build you deployed
- result reflects your change in calculate_result

## Notes on Spinnaker

Deployment and rollback run through the Spinnaker adapter.
Spinnaker pipeline configs are in spinnaker/:
- deploy-demo-service.json
- rollback-demo-service.json

If you need a runtime deployer, configure the webhook endpoints in those
pipelines to point to your existing target updater.
