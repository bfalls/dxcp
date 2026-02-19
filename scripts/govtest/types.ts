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
};
