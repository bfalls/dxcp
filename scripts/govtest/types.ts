export type JwtClaims = {
  sub?: string;
  email?: string;
  iss?: string;
  aud?: string | string[];
  azp?: string;
};

export type WhoAmI = {
  actor_id?: string;
  sub?: string;
  email?: string;
  iss?: string;
  aud?: string | string[];
  azp?: string;
  roles?: string[];
};

export type RunContext = {
  runId: string;
  startedAtIso: string;
  service: string;
  environment: string;
  recipeId: string;
  runVersion: string;
  conflictVersion: string;
  runMinor: number;
  unregisteredVersion: string;
  idempotencyKeys: {
    gateNegative: string;
    ciRegister: string;
    ciConflict: string;
    deployUnregistered: string;
    deployRegistered: string;
    rollbackSubmit: string;
  };
  timings: {
    stepStart: Record<string, string>;
    stepEnd: Record<string, string>;
  };
  discovered: {
    versionsEndpoint: string;
    discoveredVersions: string[];
    seedVersion?: string;
    seedArtifactRef?: string;
  };
  identity: {
    ciWhoAmI?: WhoAmI;
  };
  deployment: {
    id?: string;
    finalState?: string;
    finalOutcome?: string | null;
  };
  rollback: {
    skipped?: boolean;
    skipReason?: string;
    targetVersion?: string;
    targetDeploymentId?: string;
    validationMode?: "rollback-endpoint" | "deployment-validate";
    submissionMode?: "rollback-endpoint" | "redeploy";
    deploymentId?: string;
    finalState?: string;
    finalOutcome?: string | null;
  };
  guardrails: {
    mode: "safe" | "active";
    checks: Array<{
      id: string;
      status: "PASSED" | "FAILED" | "SKIPPED";
      detail: string;
    }>;
  };
};
