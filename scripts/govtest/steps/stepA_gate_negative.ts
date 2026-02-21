import type { RunContext } from "../types.ts";
import { announceStep, apiRequest, assertStatus, buildRegisterExistingPayload, decodeJson, markStepEnd, markStepStart } from "../common.ts";

async function putCiPublishersWithRetry(adminToken: string, publishers: any[], idempotencyKey: string): Promise<any> {
  const maxAttempts = 3;
  let lastPayload: any = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await apiRequest("PUT", "/v1/admin/system/ci-publishers", adminToken, {
      idempotencyKey,
      body: { publishers },
    });

    if (response.status === 200) {
      return assertStatus(response, 200, "A: PUT /v1/admin/system/ci-publishers");
    }

    lastPayload = await decodeJson(response);
    const isRetriableSsmWriteError =
      response.status === 500 &&
      lastPayload?.code === "INTERNAL_ERROR" &&
      typeof lastPayload?.message === "string" &&
      lastPayload.message.includes("Unable to update system CI publishers in SSM");

    if (!isRetriableSsmWriteError || attempt === maxAttempts) {
      throw new Error(
        `A: PUT /v1/admin/system/ci-publishers failed: expected HTTP 200, got ${response.status}; body=${JSON.stringify(lastPayload)}`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
  }

  throw new Error(`A: PUT /v1/admin/system/ci-publishers failed after retries; body=${JSON.stringify(lastPayload)}`);
}

export async function stepA_proveCiGateNegative(
  context: RunContext,
  ownerToken: string,
  ciToken: string,
  adminToken: string,
): Promise<void> {
  const step = "A";
  announceStep("A) Prove CI gate negatives: non-CI denied and non-allowlisted CI denied on /v1/builds/register");
  markStepStart(context, step);

  const response = await apiRequest("POST", "/v1/builds/register", ownerToken, {
    idempotencyKey: context.idempotencyKeys.gateNegative,
    body: buildRegisterExistingPayload(context),
  });
  await assertStatus(response, 403, "A: POST /v1/builds/register (owner token)", "CI_ONLY");

  const current = await apiRequest("GET", "/v1/admin/system/ci-publishers", adminToken);
  const currentPayload = await assertStatus(current, 200, "A: GET /v1/admin/system/ci-publishers");
  const originalPublishers = Array.isArray(currentPayload?.publishers) ? currentPayload.publishers : [];
  const denyAllPublishers = [
    {
      name: `govtest-deny-${context.runId}`,
      provider: "custom",
      subjects: [`never-match-${context.runId}`],
      description: `govtest deny probe ${context.runId}`,
    },
  ];

  await putCiPublishersWithRetry(adminToken, denyAllPublishers, `govtest-${context.runId}-ci-gate-deny`);
  try {
    const ciDenied = await apiRequest("POST", "/v1/builds/register", ciToken, {
      idempotencyKey: `${context.idempotencyKeys.gateNegative}-ci-not-allowlisted`,
      body: buildRegisterExistingPayload(context),
    });
    await assertStatus(ciDenied, 403, "A: POST /v1/builds/register (ci token not allowlisted)", "CI_ONLY");
  } finally {
    await putCiPublishersWithRetry(adminToken, originalPublishers, `govtest-${context.runId}-ci-gate-restore`);
  }

  markStepEnd(context, step);
}
