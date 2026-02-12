# DXCP Backstage Frontend Plugin (Component Card)

This plugin renders a DXCP card on Backstage Component pages. It reads the `dxcp.io/service` annotation and renders read-only delivery state from DXCP.

## Config
Optional config keys in `app-config.local.yaml`:
- `dxcp.uiBaseUrl`: DXCP UI base URL used to build the "Open in DXCP" link
- `dxcp.uiServiceUrlTemplate`: Optional template for Open-in-DXCP URL (example: `https://dxcp.example.com/services/{service}`)

If neither is set, the "Open in DXCP" link is omitted.

## Usage (Frontend)
```tsx
import { DxcpCard } from "@dxcp/backstage-plugin";

// In your Component page layout
<DxcpCard />
```

## Example Component Page Snippet
```tsx
import { EntityLayout } from "@backstage/plugin-catalog";
import { DxcpCard } from "@dxcp/backstage-plugin";

<EntityLayout.Route path="/dxcp" title="DXCP">
  <DxcpCard />
</EntityLayout.Route>
```
