export const DXCP_PLUGIN_ID = "dxcp";
export const DXCP_SERVICE_ANNOTATION = "dxcp.io/service";

export type DxcpPluginOptions = {
  dxcpApiBaseUrl?: string;
};

/**
 * Placeholder factory for a Backstage frontend plugin.
 * This intentionally avoids Backstage runtime dependencies so it can be
 * copied into a Backstage app repo without pulling DXCP runtime code.
 */
export function createDxcpPlugin(options: DxcpPluginOptions = {}) {
  return {
    id: DXCP_PLUGIN_ID,
    dxcpApiBaseUrl: options.dxcpApiBaseUrl ?? "",
  };
}

// TODO: Replace the placeholder with a real Backstage plugin implementation.
// TODO: Publish to a registry / move to Backstage community plugins later.
