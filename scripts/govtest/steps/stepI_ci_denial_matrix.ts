import type { RunContext } from "../types.ts";
import {
  announceStep,
  apiRequest,
  assert,
  assertStatus,
  isStrictConformance,
  markStepEnd,
  markStepStart,
  optionalEnv,
} from "../common.ts";

const DEFAULT_ROLES_CLAIM = "https://dxcp.example/claims/roles";

function extractRolesFromCiClaims(ciTokenClaims: Record<string, unknown>): string[] {
  const claimKey = optionalEnv("DXCP_OIDC_ROLES_CLAIM") ?? DEFAULT_ROLES_CLAIM;
  const value = ciTokenClaims[claimKey];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

export async function stepI_ciDenialMatrixEnforcement(
  context: RunContext,
  ciToken: string,
  ciTokenClaims: Record<string, unknown>,
): Promise<void> {
  const step = "I";
  announceStep("I) CI denial matrix: deploy/rollback/admin mutations must return ROLE_FORBIDDEN");
  markStepStart(context, step);

  const ciRoles = extractRolesFromCiClaims(ciTokenClaims);
  assert(
    ciRoles.includes("dxcp-ci-publishers"),
    `I: ci claims sanity expected dxcp-ci-publishers; got ${JSON.stringify(ciRoles)}`,
  );

  const validate = await apiRequest("POST", "/v1/deployments/validate", ciToken, {
    body: {
      service: context.service,
      environment: context.environment,
      version: context.runVersion,
      changeSummary: `govtest ${context.runId} ci-denial validate`,
      recipeId: context.recipeId,
    },
  });
  await assertStatus(validate, 403, "I: CI POST /v1/deployments/validate", "ROLE_FORBIDDEN");

  const deploy = await apiRequest("POST", "/v1/deployments", ciToken, {
    idempotencyKey: `govtest-${context.runId}-ci-deploy-denied`,
    body: {
      service: context.service,
      environment: context.environment,
      version: context.runVersion,
      changeSummary: `govtest ${context.runId} ci-denial deploy`,
      recipeId: context.recipeId,
    },
  });
  await assertStatus(deploy, 403, "I: CI POST /v1/deployments", "ROLE_FORBIDDEN");

  const deploymentId = context.deployment.id;
  if (!deploymentId) {
    const message = "I: CI rollback denial probe requires existing deployment id from step F";
    if (isStrictConformance(context)) {
      throw new Error(`${message} (strict conformance)`);
    }
    console.log(`[INFO] ${message}; skipping rollback denial probe in diagnostic mode.`);
  } else {
    const rollback = await apiRequest(
      "POST",
      `/v1/deployments/${encodeURIComponent(deploymentId)}/rollback`,
      ciToken,
      {
        idempotencyKey: `govtest-${context.runId}-ci-rollback-denied`,
      },
    );
    await assertStatus(
      rollback,
      403,
      `I: CI POST /v1/deployments/${deploymentId}/rollback`,
      "ROLE_FORBIDDEN",
    );
  }

  const ciPublishersPut = await apiRequest("PUT", "/v1/admin/system/ci-publishers", ciToken, {
    body: { publishers: [] },
  });
  await assertStatus(ciPublishersPut, 403, "I: CI PUT /v1/admin/system/ci-publishers", "ROLE_FORBIDDEN");

  markStepEnd(context, step);
}
