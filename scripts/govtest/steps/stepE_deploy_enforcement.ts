import type { RunContext } from "../types.ts";
import { announceStep, apiRequest, assertStatus, buildDeploymentIntent, markStepEnd, markStepStart } from "../common.ts";

export async function stepE_deployEnforcementUnregisteredVersion(context: RunContext, ownerToken: string): Promise<void> {
  const step = "E";
  announceStep("E) Deploy-side enforcement: unregistered version rejected by validate and deploy");
  markStepStart(context, step);

  const validate = await apiRequest("POST", "/v1/deployments/validate", ownerToken, {
    body: buildDeploymentIntent(context, context.unregisteredVersion),
  });
  await assertStatus(validate, 400, "E: POST /v1/deployments/validate (unregistered)", "VERSION_NOT_FOUND");

  const deploy = await apiRequest("POST", "/v1/deployments", ownerToken, {
    idempotencyKey: context.idempotencyKeys.deployUnregistered,
    body: buildDeploymentIntent(context, context.unregisteredVersion),
  });
  await assertStatus(deploy, 400, "E: POST /v1/deployments (unregistered)", "VERSION_NOT_FOUND");

  markStepEnd(context, step);
}
