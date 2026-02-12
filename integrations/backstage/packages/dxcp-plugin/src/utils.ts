import { Entity } from "@backstage/catalog-model";
import { AllowedAction, DeliveryStatusView, DxcpViewModel } from "./types";

export const DXCP_SERVICE_ANNOTATION = "dxcp.io/service";

export function getDxcpServiceAnnotation(entity: Entity): string | undefined {
  return entity?.metadata?.annotations?.[DXCP_SERVICE_ANNOTATION];
}

function pickString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function buildDeliveryStatus(raw: unknown): DeliveryStatusView | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const data = raw as Record<string, unknown>;
  return {
    state: pickString(data, ["state", "status"]),
    version: pickString(data, ["version", "artifactVersion"]),
    updatedAt: pickString(data, ["updatedAt", "updated_at", "lastUpdatedAt"]),
    engineExecutionUrl: pickString(data, ["engineExecutionUrl", "executionUrl"]),
    dxcpUiUrl: pickString(data, ["dxcpUiUrl", "uiUrl"]),
  };
}

function buildAllowedActions(raw: unknown): AllowedAction[] {
  if (!raw || typeof raw !== "object") {
    return [];
  }
  const data = raw as Record<string, unknown>;
  const list = (data.allowedActions ?? data.actions) as unknown;
  if (!Array.isArray(list)) {
    return [];
  }
  return list.map((item) => {
    if (typeof item === "string") {
      return { name: item, allowed: true };
    }
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const name =
        typeof obj.name === "string"
          ? obj.name
          : typeof obj.action === "string"
            ? obj.action
            : "unknown";
      const allowed =
        typeof obj.allowed === "boolean"
          ? obj.allowed
          : typeof obj.permitted === "boolean"
            ? obj.permitted
            : true;
      return { name, allowed };
    }
    return { name: "unknown", allowed: false };
  });
}

export function buildDxcpViewModel(
  deliveryStatus: unknown,
  allowedActions: unknown,
): DxcpViewModel {
  return {
    deliveryStatus: buildDeliveryStatus(deliveryStatus),
    allowedActions: buildAllowedActions(allowedActions),
  };
}
