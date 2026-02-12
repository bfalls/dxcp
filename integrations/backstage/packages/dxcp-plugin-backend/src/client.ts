import { FetchLike } from "./types";

export type DxcpClientOptions = {
  baseUrl: string;
  getAccessToken: () => Promise<string>;
  fetchFn?: FetchLike;
  requestTimeoutMs?: number;
};

export type DxcpError = {
  status: number;
  message: string;
};

export function createDxcpClient(options: DxcpClientOptions) {
  const fetchFn = options.fetchFn ?? fetch;

  async function get(path: string): Promise<unknown> {
    const controller = new AbortController();
    const timeoutMs = options.requestTimeoutMs ?? 8000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const token = await options.getAccessToken();
      const url = new URL(path, options.baseUrl);
      const response = await fetchFn(url.toString(), {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const message = `DXCP request failed with status ${response.status}`;
        throw { status: response.status, message } satisfies DxcpError;
      }

      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    get,
  };
}
