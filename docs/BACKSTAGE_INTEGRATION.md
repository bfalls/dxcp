# Backstage integration (read-first)

DXCP is the delivery control plane. Backstage remains the catalog and surface for service ownership.
This integration is read-first and optional. DXCP runs without Backstage.

## Responsibility split

DXCP owns:
- Delivery intent, guardrails, and normalized delivery records.
- Read endpoints for status, actions, and insights.

Backstage owns:
- Catalog, ownership, and discovery.
- Rendering DXCP read data in service-centric views.

Backstage should not perform write actions in DXCP.

## Conceptual mapping

- Backstage system/group -> DXCP DeliveryGroup
- Backstage component/service -> DXCP service

Recommended link: store the DXCP DeliveryGroup id in Backstage metadata and use it when
requesting insights or listing DeliveryGroup details.

## Service registry fields

DXCP can surface Backstage links in the Service detail view when these optional fields
are present in the service registry. All fields are read-only in the UI.

- `backstage_entity_ref`: Backstage entity ref (example: `component:default/demo-service`).
- `backstage_entity_url_template`: Optional URL template. Supports `{service}` and SSM
  resolution via `ssm:/path` entries (same pattern as `stable_service_url_template`).
- `VITE_BACKSTAGE_BASE_URL`: Optional UI config. When set and no explicit URL template
  is provided, the UI builds `https://<base>/catalog/<namespace>/<kind>/<name>`.

## Required endpoints

These endpoints are safe for OBSERVER role.

### Service delivery status

GET /v1/services/{service}/delivery-status

Response example:
```
{
  "service": "demo-service",
  "hasDeployments": true,
  "latest": {
    "id": "dep-123",
    "state": "SUCCEEDED",
    "version": "1.0.0",
    "recipeId": "default",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:05:00Z",
    "engineExecutionUrl": "https://spinnaker.example/pipelines/dep-123",
    "rollbackOf": null
  }
}
```

### Allowed actions for service

GET /v1/services/{service}/allowed-actions

Response example:
```
{
  "service": "demo-service",
  "role": "OBSERVER",
  "actions": {
    "view": true,
    "deploy": false,
    "rollback": false
  }
}
```

### Failure insights (optional card)

GET /v1/insights/failures?windowDays=7&groupId=default

Render:
- rollbackRate
- failuresByCategory
- deploymentsByRecipe
- deploymentsByGroup

## Auth expectations

Use a Bearer token. OBSERVER role is sufficient for read access.

## Backstage plugin guidance

Minimal card ideas:
- Delivery status: show latest state, version, and updatedAt.
- Actions: show which actions are allowed (read-only for OBSERVER).
- Insights: show rollback rate and top failure categories.
