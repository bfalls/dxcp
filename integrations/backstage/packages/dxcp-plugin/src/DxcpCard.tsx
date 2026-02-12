import React from "react";
import { InfoCard, Link, Progress, WarningPanel } from "@backstage/core-components";
import { configApiRef, Config, useApi } from "@backstage/core-plugin-api";
import { useEntity } from "@backstage/plugin-catalog-react";
import { fetchDxcpData } from "./api";
import { buildDxcpViewModel, getDxcpServiceAnnotation } from "./utils";

type DxcpCardProps = {
  requestTimeoutMs?: number;
};

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; data: ReturnType<typeof buildDxcpViewModel> };

function buildOpenInDxcpUrl(
  config: Config,
  service: string,
  dxcpUiUrl?: string,
): string | undefined {
  if (dxcpUiUrl) {
    return dxcpUiUrl;
  }
  const template = config.getOptionalString("dxcp.uiServiceUrlTemplate");
  if (template) {
    return template.replace("{service}", encodeURIComponent(service));
  }
  const baseUrl = config.getOptionalString("dxcp.uiBaseUrl");
  if (!baseUrl) {
    return undefined;
  }
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/services/${encodeURIComponent(service)}`;
}

export function DxcpCard(props: DxcpCardProps = {}) {
  const { entity } = useEntity();
  const configApi = useApi<Config>(configApiRef);
  const service = getDxcpServiceAnnotation(entity);
  const [state, setState] = React.useState<LoadState>({ status: "idle" });

  React.useEffect(() => {
    let alive = true;
    if (!service) {
      return () => undefined;
    }
    setState({ status: "loading" });
    fetchDxcpData(service, { requestTimeoutMs: props.requestTimeoutMs })
      .then((result) => {
        if (!alive) return;
        setState({ status: "loaded", data: buildDxcpViewModel(result.deliveryStatus, result.allowedActions) });
      })
      .catch((err: Error) => {
        if (!alive) return;
        setState({ status: "error", message: err.message });
      });

    return () => {
      alive = false;
    };
  }, [service, props.requestTimeoutMs]);

  if (!service) {
    return (
      <InfoCard title="DXCP">
        <WarningPanel title="DXCP not configured for this component">
          Add the annotation <code>dxcp.io/service</code> to enable DXCP visibility.
        </WarningPanel>
      </InfoCard>
    );
  }

  if (state.status === "loading" || state.status === "idle") {
    return (
      <InfoCard title="DXCP">
        <Progress />
      </InfoCard>
    );
  }

  if (state.status === "error") {
    return (
      <InfoCard title="DXCP">
        <WarningPanel title="DXCP data unavailable">{state.message}</WarningPanel>
      </InfoCard>
    );
  }

  const { deliveryStatus, allowedActions } = state.data;
  const openInDxcpUrl = buildOpenInDxcpUrl(configApi, service, deliveryStatus?.dxcpUiUrl);

  return (
    <InfoCard title="DXCP">
      <div>
        <div>
          <strong>Service</strong>: {service}
        </div>
        <div>
          <strong>State</strong>: {deliveryStatus?.state ?? "Unknown"}
        </div>
        {deliveryStatus?.version && (
          <div>
            <strong>Version</strong>: {deliveryStatus.version}
          </div>
        )}
        {deliveryStatus?.updatedAt && (
          <div>
            <strong>Updated</strong>: {deliveryStatus.updatedAt}
          </div>
        )}
        {deliveryStatus?.engineExecutionUrl && (
          <div>
            <Link to={deliveryStatus.engineExecutionUrl}>Execution</Link>
          </div>
        )}
        {openInDxcpUrl && (
          <div>
            <Link to={openInDxcpUrl}>Open in DXCP</Link>
          </div>
        )}
      </div>
      <div style={{ marginTop: "12px" }}>
        <strong>Allowed actions</strong>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "8px" }}>
          {allowedActions.length === 0 && <span>None</span>}
          {allowedActions.map((action) => (
            <button
              key={action.name}
              type="button"
              disabled={!action.allowed}
              title="Read-only in v1"
              style={{ padding: "6px 10px", borderRadius: "6px" }}
            >
              {action.name}
            </button>
          ))}
        </div>
      </div>
    </InfoCard>
  );
}
