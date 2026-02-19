import type { RunContext } from "../types.ts";
import { announceStep, apiRequest, assertStatus, buildRegisterExistingPayload, markStepEnd, markStepStart } from "../common.ts";

export async function stepA_proveCiGateNegative(context: RunContext, ownerToken: string): Promise<void> {
  const step = "A";
  announceStep("A) Prove CI gate blocks non-CI identity on /v1/builds/register");
  markStepStart(context, step);

  const response = await apiRequest("POST", "/v1/builds/register", ownerToken, {
    idempotencyKey: context.idempotencyKeys.gateNegative,
    body: buildRegisterExistingPayload(context),
  });

  await assertStatus(response, 403, "A: POST /v1/builds/register (owner token)", "CI_ONLY");
  markStepEnd(context, step);
}
