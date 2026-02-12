export const DXCP_BACKEND_PLUGIN_ID = "dxcp-backend";

export type DxcpBackendOptions = {
  dxcpApiBaseUrl?: string;
};

/**
 * Placeholder factory for a Backstage backend router/plugin.
 * Keep DXCP as the delivery authority; this should only proxy to DXCP APIs.
 */
export function createDxcpBackendPlugin(options: DxcpBackendOptions = {}) {
  return {
    id: DXCP_BACKEND_PLUGIN_ID,
    dxcpApiBaseUrl: options.dxcpApiBaseUrl ?? "",
  };
}

// TODO: Implement router wiring and DXCP API client configuration.
// TODO: Publish to a registry / move to Backstage community plugins later.
