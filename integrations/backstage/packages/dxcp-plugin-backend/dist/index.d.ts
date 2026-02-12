export declare const DXCP_BACKEND_PLUGIN_ID = "dxcp-backend";
export type { DxcpBackendConfig, DxcpAuthConfig, Logger, FetchLike, } from "./types";
export { createDxcpRouter, createDxcpHandlers } from "./router";
export { createTokenManager } from "./tokenManager";
