export type Logger = {
  warn: (message: string, meta?: Record<string, unknown>) => void;
  info?: (message: string, meta?: Record<string, unknown>) => void;
};

export type DxcpAuthConfig = {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  audience: string;
  timeoutMs?: number;
  tokenRefreshBufferSec?: number;
};

export type DxcpBackendConfig = {
  baseUrl: string;
  auth0: DxcpAuthConfig;
  requestTimeoutMs?: number;
};

export type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

export type FetchLike = (input: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string | URLSearchParams;
  signal?: AbortSignal;
}) => Promise<FetchResponse>;
