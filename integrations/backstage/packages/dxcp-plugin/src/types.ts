export type DeliveryStatusView = {
  state?: string;
  version?: string;
  updatedAt?: string;
  engineExecutionUrl?: string;
  dxcpUiUrl?: string;
};

export type AllowedAction = {
  name: string;
  allowed: boolean;
};

export type DxcpViewModel = {
  deliveryStatus?: DeliveryStatusView;
  allowedActions: AllowedAction[];
};
