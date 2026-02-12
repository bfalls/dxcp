export type DxcpApiOptions = {
  basePath?: string;
  requestTimeoutMs?: number;
};

export type DxcpApiResponse = {
  deliveryStatus: unknown;
  allowedActions: unknown;
};

const DEFAULT_TIMEOUT_MS = 8000;

export async function fetchDxcpData(
  service: string,
  options: DxcpApiOptions = {},
): Promise<DxcpApiResponse> {
  const basePath = options.basePath ?? "/api/dxcp";
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const encoded = encodeURIComponent(service);
    const [deliveryStatus, allowedActions] = await Promise.all([
      fetch(`${basePath}/services/${encoded}/delivery-status`, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
      }).then((res) => {
        if (!res.ok) {
          throw new Error(`DXCP delivery-status failed (${res.status})`);
        }
        return res.json();
      }),
      fetch(`${basePath}/services/${encoded}/allowed-actions`, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
      }).then((res) => {
        if (!res.ok) {
          throw new Error(`DXCP allowed-actions failed (${res.status})`);
        }
        return res.json();
      }),
    ]);

    return { deliveryStatus, allowedActions };
  } finally {
    clearTimeout(timeout);
  }
}
