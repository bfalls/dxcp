import type { RunContext } from "../types.ts";
import { announceStep, apiRequest, assertStatus, buildRegisterExistingPayload, requiredEnv, markStepEnd, markStepStart } from "../common.ts";

export async function stepC_registerBuildHappyPath(context: RunContext, ciToken: string): Promise<void> {
  const step = "C";
  announceStep("C) Build registration negatives for idempotency key plus happy path replay");
  markStepStart(context, step);

  const payload = buildRegisterExistingPayload(context, {
    version: context.runVersion,
    git_sha: "b".repeat(40),
  });
  const baseApi = requiredEnv("GOV_DXCP_API_BASE").replace(/\/$/, "");

  const missingIdempotency = await apiRequest("POST", "/v1/builds/register", ciToken, {
    body: payload,
  });
  await assertStatus(
    missingIdempotency,
    400,
    "C: POST /v1/builds/register (missing idempotency key)",
    "IDMP_KEY_REQUIRED",
  );

  const invalidEmptyIdempotency = await fetch(`${baseApi}/v1/builds/register`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ciToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": "",
    },
    body: JSON.stringify(payload),
  });
  await assertStatus(
    invalidEmptyIdempotency,
    400,
    "C: POST /v1/builds/register (invalid empty idempotency key)",
    "IDMP_KEY_REQUIRED",
  );

  const first = await apiRequest("POST", "/v1/builds/register", ciToken, {
    idempotencyKey: context.idempotencyKeys.ciRegister,
    body: payload,
  });
  await assertStatus(first, 201, "C: first POST /v1/builds/register");

  const firstReplay = first.headers.get("Idempotency-Replayed")?.toLowerCase();
  if (firstReplay && firstReplay !== "false") {
    throw new Error(`C: expected first Idempotency-Replayed=false when present; got ${firstReplay}`);
  }

  const second = await apiRequest("POST", "/v1/builds/register", ciToken, {
    idempotencyKey: context.idempotencyKeys.ciRegister,
    body: payload,
  });
  await assertStatus(second, 201, "C: replay POST /v1/builds/register");

  const replayed = second.headers.get("Idempotency-Replayed")?.toLowerCase();
  if (replayed !== "true") {
    throw new Error(`C: expected Idempotency-Replayed=true on replay, got ${replayed ?? "<missing>"}`);
  }

  markStepEnd(context, step);
}
