# Spinnaker pipeline configuration (demo-service)

This directory contains minimal pipeline configurations for the reference service.
They are placeholders for a real Spinnaker deployment and rollback pipeline.

Constraints:
- Single environment: sandbox
- Single service: demo-service
- Deploy updates an existing target
- No new infrastructure provisioning

Pipelines:
- deploy-demo-service.json
- rollback-demo-service.json

The pipelines use a webhook stage to call a reference deployer endpoint that
updates the running service in place. Replace the webhook target with your
runtime deployer of choice.
