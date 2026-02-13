# DXCP Backstage Integration

This directory contains the DXCP integration for Backstage.

## Architecture

Backstage UI (3000) → Backstage Backend (7007) → DXCP Backend Router →
DXCP API

The frontend never talks directly to DXCP.

------------------------------------------------------------------------

## Backend Endpoint

Mounted at:

/api/dxcp

Example:

GET /api/dxcp/services/`<serviceId>`{=html}/delivery-status

------------------------------------------------------------------------

## Required Entity Annotation

annotations: dxcp.io/service-id: demo-service

------------------------------------------------------------------------

## Install Plugins

yarn workspace backend add "@dxcp/backstage-plugin-backend@workspace:*"
yarn workspace app add "@dxcp/backstage-plugin@workspace:*" yarn install

------------------------------------------------------------------------

## Backend Registration

Create:

packages/backend/src/plugins/dxcp.ts

Register router with httpRouter.use('/dxcp', router)

Add in backend index.ts:

backend.add(import('./plugins/dxcp'));

------------------------------------------------------------------------

## app-config.local.yaml

dxcp: baseUrl: https://your-dxcp-api auth0: tokenUrl:
https://tenant.auth0.com/oauth/token clientId:
\${AUTH_M2M_AUTH0_CLIENT_ID} clientSecret:
\${AUTH_M2M_AUTH0_CLIENT_SECRET} audience: https://dxcp-api

------------------------------------------------------------------------

## Dev Proxy (Required for Local Dev)

Add to packages/app/package.json:

"proxy": \[ { "context": \["/api/dxcp"\], "target":
"http://localhost:7007", "changeOrigin": true }\]

------------------------------------------------------------------------

## Security Model

Backstage validates user. Backend exchanges M2M token. DXCP enforces
RBAC.

Identity authority: Backstage. Delivery authority: DXCP.
