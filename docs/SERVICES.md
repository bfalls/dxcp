# DXCP Service Registry

DXCP uses a local service registry to enforce allowlists and guardrails for
multi-service support.

Registry location (default):
- dxcp-api/data/services.json

## Service entry fields

Each entry is a JSON object with:

- service_name
  - Unique name used in deployments and builds.
- allowed_recipes
  - Enforced allowlist of recipe ids compatible with the service.
  - A recipe must be both compatible with the Service and permitted by the Delivery Group.
- allowed_artifact_sources
  - List of allowed artifactRef prefixes, such as "s3://bucket/".
- stable_service_url_template (optional)
  - Template used by the UI for the service link.
  - Supports {service} and {version} placeholders.

## Example entry

```
{
  "service_name": "demo-service",
  "allowed_recipes": ["default"],
  "allowed_artifact_sources": ["s3://demo-artifacts/"],
  "stable_service_url_template": "http://127.0.0.1:9000"
}
```

## How to add a service

1) Edit dxcp-api/data/services.json and add a new entry.
2) The DXCP API reads the registry file on each request, so changes are picked up without database maintenance.

## Guardrail enforcement

- Deployments are rejected unless the service exists in the registry.
- Environment is always sandbox.
- Build registration is rejected unless artifactRef matches allowed_artifact_sources.
- UI only shows services returned by /v1/services.
DeliveryGroup policy is authoritative; service allowlists are constraints, not governance.
