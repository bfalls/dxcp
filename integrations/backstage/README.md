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
For example, import `createDxcpPlugin` in your app's plugin list and
`createDxcpBackendPlugin` in the backend plugin router setup.

## Build/Test (from this folder)
```bash
npm install
npm run build
npm run test
```

## TODO
- Publish to a registry.
- Move to Backstage community plugins later.
