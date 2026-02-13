export interface DxcpDeliveryStatus {
  service: string;
  hasDeployments: boolean;
  latest?: {
    id: string;
    state: string;
    version: string;
    recipeId: string;
    createdAt: string;
    updatedAt: string;
    rollbackOf?: string | null;
    deploymentKind: string;
    outcome?: string | null;
  };
  currentRunning?: {
    service: string;
    environment: string;
    scope: string;
    version: string;
    deploymentId: string;
    deploymentKind: string;
    derivedAt: string;
  };
}
