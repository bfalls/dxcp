# DXCP Backstage Backend Plugin (Read-First Proxy)

This backend plugin exposes read-only DXCP endpoints to Backstage. It fetches an Auth0 client-credentials token (service-to-service OBSERVER role), calls DXCP read APIs, and returns JSON to the frontend. DXCP remains the delivery authority.

## Config
Required config keys (Backstage `app-config.local.yaml`):
- `dxcp.baseUrl`: DXCP API base URL (example: `https://dxcp.internal.example.com`)
- `dxcp.auth0.tokenUrl`: Auth0 token endpoint
- `dxcp.auth0.clientId`: Auth0 client ID for Backstage service
- `dxcp.auth0.clientSecret`: Auth0 client secret for Backstage service
- `dxcp.auth0.audience`: DXCP API audience

Optional:
- `dxcp.auth0.timeoutMs`: Token request timeout (default 8000)
- `dxcp.auth0.tokenRefreshBufferSec`: Refresh buffer in seconds (default 60)
- `dxcp.requestTimeoutMs`: DXCP request timeout (default 8000)

## Example app-config.local.yaml
```yaml
dxcp:
  baseUrl: https://dxcp.internal.example.com
  auth0:
    tokenUrl: https://your-tenant.us.auth0.com/oauth/token
    clientId: ${DXCP_AUTH0_CLIENT_ID}
    clientSecret: ${DXCP_AUTH0_CLIENT_SECRET}
    audience: https://dxcp-api
```

## Usage (Backend)
```ts
import { createDxcpRouter } from "@dxcp/backstage-plugin-backend";

// Example in your Backstage backend setup
const router = createDxcpRouter({
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

// Mount under /api/dxcp
backendApp.use("/api/dxcp", router);
```

## Routes
- `GET /api/dxcp/health` -> DXCP `/v1/health`
- `GET /api/dxcp/services/:service/delivery-status`
- `GET /api/dxcp/services/:service/allowed-actions`
