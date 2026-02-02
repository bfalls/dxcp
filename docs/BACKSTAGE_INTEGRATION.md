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
    "spinnakerExecutionUrl": "https://spinnaker.example/pipelines/dep-123",
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
