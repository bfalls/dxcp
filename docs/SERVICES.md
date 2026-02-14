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
- allowed_environments (optional, deprecated for policy)
  - Accepted for backward compatibility, but not used to authorize deployment environments.
  - Environment authorization is enforced by Delivery Groups and the environments table.
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
- Environment validation is server-side and delivery-group scoped:
  - service must belong to a delivery group
  - environment must be allowed/configured for that delivery group
  - environment must be enabled
- Build registration is rejected unless artifactRef matches allowed_artifact_sources.
- UI only shows services returned by /v1/services.
DeliveryGroup policy is authoritative; service allowlists are constraints, not governance.

## How to add a new environment now

1) Update the target Delivery Group `allowed_environments` (admin API/UI).
2) Ensure an enabled environment record exists for that delivery group in the `environments` table (created automatically when using delivery-group updates, or seeded directly in storage by platform admin workflows).
3) No `services.json` changes are required.
