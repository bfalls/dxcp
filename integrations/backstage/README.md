# DXCP Backstage Integration (Optional)

This folder contains **optional** Backstage packages. DXCP runs fully without Backstage, and DXCP runtime code must not import anything from here.

V1 is **read-first**: Backstage renders DXCP state and allowed actions as evaluated by DXCP. Any action initiation still flows through DXCP APIs and policy enforcement.

**Identity mapping**
- Backstage owns service identity.
- DXCP maps via the Backstage entity annotation `dxcp.io/service`.

## Packages
- `packages/dxcp-plugin`: Frontend plugin (catalog/entity view surface)
- `packages/dxcp-plugin-backend`: Backend router/plugin (DXCP API proxy + policy-aware endpoints)

## Local Consumption In A Backstage App
These packages are intentionally standalone so you can copy or reference them from a Backstage app repo.

Example with local path dependencies:
```json
{
  "dependencies": {
    "@dxcp/backstage-plugin": "file:../dxcp/integrations/backstage/packages/dxcp-plugin",
    "@dxcp/backstage-plugin-backend": "file:../dxcp/integrations/backstage/packages/dxcp-plugin-backend"
  }
}
```

You can then wire them into your Backstage app's frontend and backend plugin registries.
For example, import `DxcpCard` in your app's component page and
`createDxcpRouter` in the backend router setup.

## Build/Test (from this folder)
```bash
npm install
npm run build
npm run test
```

## Step-by-Step Wiring (Backstage App)
1. Add local dependencies in the Backstage app repo:
   - `@dxcp/backstage-plugin`
   - `@dxcp/backstage-plugin-backend`
2. Configure DXCP + Auth0 in `app-config.local.yaml`:
   - `dxcp.baseUrl`
   - `dxcp.auth0.tokenUrl` (or Auth0 issuer/token URL)
   - `dxcp.auth0.clientId`
   - `dxcp.auth0.clientSecret`
   - `dxcp.auth0.audience`
   - Optional: `dxcp.uiBaseUrl` or `dxcp.uiServiceUrlTemplate`
3. Mount the backend router under `/api/dxcp`:
   - Use `createDxcpRouter` from the backend package.
4. Render the DXCP card on the Component page:
   - Add `<DxcpCard />` to your Component page layout.
5. Add annotation to a component YAML:
```yaml
metadata:
  annotations:
    dxcp.io/service: demo-service
```

## Frontend Snippet (app/src/App.tsx)
Example using `@backstage/core-app-api@1.19.4` with a Component route:
```tsx
// app/src/App.tsx
import React from "react";
import { Route } from "react-router";
import { EntityLayout } from "@backstage/plugin-catalog";
import { DxcpCard } from "@dxcp/backstage-plugin";

// Inside your component entity page definition
const ComponentEntityPage = () => (
  <EntityLayout>
    {/* ...existing routes... */}
    <EntityLayout.Route path="/dxcp" title="DXCP">
      <DxcpCard />
    </EntityLayout.Route>
  </EntityLayout>
);

export const AppRoutes = () => (
  <>
    {/* ...existing routes... */}
    <Route path="/catalog/:namespace/:kind/:name" element={<ComponentEntityPage />} />
  </>
);
```

## Backend Snippet (packages/backend/src/index.ts)
Mount the router under `/api/dxcp`:
```ts
// packages/backend/src/index.ts
import { createDxcpRouter } from "@dxcp/backstage-plugin-backend";

// ...inside your backend initialization
const dxcpRouter = createDxcpRouter({
  config: {
    baseUrl: config.getString("dxcp.baseUrl"),
    auth0: {
      tokenUrl: config.getString("dxcp.auth0.tokenUrl"),
      clientId: config.getString("dxcp.auth0.clientId"),
      clientSecret: config.getString("dxcp.auth0.clientSecret"),
      audience: config.getString("dxcp.auth0.audience"),
      timeoutMs: config.getOptionalNumber("dxcp.auth0.timeoutMs"),
      tokenRefreshBufferSec: config.getOptionalNumber("dxcp.auth0.tokenRefreshBufferSec"),
    },
    requestTimeoutMs: config.getOptionalNumber("dxcp.requestTimeoutMs"),
  },
  logger,
});

backendApp.use("/api/dxcp", dxcpRouter);
```

## Backend Snippet (packages/backend/src/plugins/dxcp.ts)
Alternative plugin file you can wire into your backend:
```ts
// packages/backend/src/plugins/dxcp.ts
import { Router } from "express";
import { PluginEnvironment } from "../types";
import { createDxcpRouter } from "@dxcp/backstage-plugin-backend";

export default async function createPlugin(env: PluginEnvironment): Promise<Router> {
  return createDxcpRouter({
    config: {
      baseUrl: env.config.getString("dxcp.baseUrl"),
      auth0: {
        tokenUrl: env.config.getString("dxcp.auth0.tokenUrl"),
        clientId: env.config.getString("dxcp.auth0.clientId"),
        clientSecret: env.config.getString("dxcp.auth0.clientSecret"),
        audience: env.config.getString("dxcp.auth0.audience"),
        timeoutMs: env.config.getOptionalNumber("dxcp.auth0.timeoutMs"),
        tokenRefreshBufferSec: env.config.getOptionalNumber("dxcp.auth0.tokenRefreshBufferSec"),
      },
      requestTimeoutMs: env.config.getOptionalNumber("dxcp.requestTimeoutMs"),
    },
    logger: env.logger,
  });
}
```

## Example Backstage Config Snippet
```yaml
dxcp:
  baseUrl: https://dxcp.internal.example.com
  auth0:
    tokenUrl: https://your-tenant.us.auth0.com/oauth/token
    clientId: ${DXCP_AUTH0_CLIENT_ID}
    clientSecret: ${DXCP_AUTH0_CLIENT_SECRET}
    audience: https://dxcp-api
  uiBaseUrl: https://dxcp.internal.example.com
```

## Smoke Test Checklist
- Backend route `/api/dxcp/health` returns DXCP health JSON.
- Component **with** `dxcp.io/service` annotation renders state and allowed actions.
- Component **without** annotation renders “DXCP not configured for this component”.

## V2 Guidance (Not Implemented)
- Per-user tokens / on-behalf-of calls.
- Write actions (deploy/rollback).
- Org-level overview page inside Backstage.

## TODO
- Publish to a registry.
- Move to Backstage community plugins later.
