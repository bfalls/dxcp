import type { RunContext } from "../types.ts";
import { announceStep, apiRequest, assertStatus, buildRegisterExistingPayload, markStepEnd, markStepStart } from "../common.ts";

export async function stepD_sameIdempotencyKeyDifferentBodyReturnsConflict(
  context: RunContext,
  ciToken: string,
): Promise<void> {
  const step = "D";
  announceStep("D) Same Idempotency-Key with different body must return conflict");
  markStepStart(context, step);

  const payload = buildRegisterExistingPayload(context, {
    version: context.conflictVersion,
    git_sha: "c".repeat(40),
  });

  const first = await apiRequest("POST", "/v1/builds/register", ciToken, {
    idempotencyKey: context.idempotencyKeys.ciConflict,
    body: payload,
  });
  await assertStatus(first, 201, "D: first POST /v1/builds/register for conflict setup");

  const conflictPayload = buildRegisterExistingPayload(context, {
    version: context.conflictVersion,
    git_sha: "d".repeat(40),
  });

  const second = await apiRequest("POST", "/v1/builds/register", ciToken, {
    idempotencyKey: context.idempotencyKeys.ciConflict,
    body: conflictPayload,
  });

  await assertStatus(second, 409, "D: conflicting POST /v1/builds/register", "BUILD_REGISTRATION_CONFLICT");
  markStepEnd(context, step);
}
