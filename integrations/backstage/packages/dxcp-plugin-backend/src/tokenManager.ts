import { DxcpAuthConfig, FetchLike, Logger } from "./types";

type TokenState = {
  accessToken: string;
  expiresAtMs: number;
};

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_REFRESH_BUFFER_SEC = 60;

export type TokenManagerOptions = {
  auth: DxcpAuthConfig;
  fetchFn?: FetchLike;
  logger?: Logger;
};

export function createTokenManager(options: TokenManagerOptions) {
  const fetchFn = options.fetchFn ?? fetch;
  const logger = options.logger;
  let tokenState: TokenState | undefined;

  async function fetchToken(): Promise<TokenState> {
    const controller = new AbortController();
    const timeoutMs = options.auth.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: options.auth.clientId,
        client_secret: options.auth.clientSecret,
        audience: options.auth.audience,
      });

      const response = await fetchFn(options.auth.tokenUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        logger?.warn?.("DXCP token fetch failed", {
          status: response.status,
        });
        throw new Error(`Token fetch failed with status ${response.status}`);
      }

      const json = (await response.json()) as {
        access_token?: string;
        expires_in?: number;
      };

      if (!json.access_token || !json.expires_in) {
        throw new Error("Token response missing access_token or expires_in");
      }

      const expiresAtMs = Date.now() + json.expires_in * 1000;
      return { accessToken: json.access_token, expiresAtMs };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function getAccessToken(): Promise<string> {
    const bufferSec = options.auth.tokenRefreshBufferSec ?? DEFAULT_REFRESH_BUFFER_SEC;
    const bufferMs = bufferSec * 1000;
    if (tokenState && Date.now() < tokenState.expiresAtMs - bufferMs) {
      return tokenState.accessToken;
    }

    tokenState = await fetchToken();
    return tokenState.accessToken;
  }

  return {
    getAccessToken,
    _unsafeGetState: () => tokenState,
  };
}
