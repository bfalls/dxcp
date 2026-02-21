import type { RunContext } from "../types.ts";
import {
  announceStep,
  apiRequest,
  assert,
  assertStatus,
  decodeJson,
  decodeJwtClaims,
  markStepEnd,
  markStepStart,
  optionalEnv,
  printIdentity,
  requiredEnv,
  whoAmI,
} from "../common.ts";

const STALE_GOVTEST_ENTRY_RE = /^govtest-\d+-[a-f0-9]+-ci$/;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function putCiPublishersWithRetry(adminToken: string, updated: any[], idempotencyKey: string): Promise<any> {
  const maxAttempts = 3;
  let lastPayload: any = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const put = await apiRequest("PUT", "/v1/admin/system/ci-publishers", adminToken, {
      idempotencyKey,
      body: { publishers: updated },
    });

    if (put.status === 200) {
      return assertStatus(put, 200, "B: PUT /v1/admin/system/ci-publishers");
    }

    lastPayload = await decodeJson(put);
    const isRetriableSsmWriteError =
      put.status === 500 &&
      lastPayload?.code === "INTERNAL_ERROR" &&
      typeof lastPayload?.message === "string" &&
      lastPayload.message.includes("Unable to update system CI publishers in SSM");

    if (!isRetriableSsmWriteError || attempt === maxAttempts) {
      throw new Error(
        `B: PUT /v1/admin/system/ci-publishers failed: expected HTTP 200, got ${put.status}; body=${JSON.stringify(lastPayload)}`,
      );
    }

    await sleep(500 * attempt);
  }

  throw new Error(`B: PUT /v1/admin/system/ci-publishers failed after retries; body=${JSON.stringify(lastPayload)}`);
}

export async function stepB_configureCiPublishersAllowlist(context: RunContext, adminToken: string, ciToken: string): Promise<void> {
  const step = "B";
  announceStep("B) Configure CI publishers allowlist using CI identity from /v1/whoami");
  markStepStart(context, step);

  const claims = decodeJwtClaims(ciToken);
  const me = await whoAmI(ciToken);
  context.identity.ciWhoAmI = me;
  printIdentity("ci", ciToken, claims, me);

  const audValues = Array.isArray(me.aud) ? me.aud : typeof me.aud === "string" ? [me.aud] : [];
  const issuer = typeof me.iss === "string" ? me.iss : undefined;
  const subject = typeof me.sub === "string" ? me.sub : undefined;
  const azp = typeof me.azp === "string" ? me.azp : undefined;

  assert(issuer || audValues.length || subject || azp, "B: /v1/whoami did not return identity fields needed for allowlist update.");

  const current = await apiRequest("GET", "/v1/admin/system/ci-publishers", adminToken);
  const currentPayload = await assertStatus(current, 200, "B: GET /v1/admin/system/ci-publishers");
  const existing = Array.isArray(currentPayload?.publishers) ? currentPayload.publishers : [];

  const entryName = optionalEnv("GOV_CI_PUBLISHER_ENTRY_NAME") ?? "govtest-ci";
  const updated = existing.filter((p: any) => {
    const name = typeof p?.name === "string" ? p.name : "";
    if (!name) return true;
    if (name === entryName) return false;
    if (STALE_GOVTEST_ENTRY_RE.test(name)) return false;
    return true;
  });
  updated.push({
    name: entryName,
    provider: "custom",
    issuers: issuer ? [issuer] : undefined,
    audiences: audValues.length ? audValues : undefined,
    authorized_party_azp: azp ? [azp] : undefined,
    subjects: subject ? [subject] : undefined,
    description: `govtest run ${context.runId}`,
  });

  const missingIdempotency = await apiRequest("PUT", "/v1/admin/system/ci-publishers", adminToken, {
    body: { publishers: updated },
  });
  await assertStatus(
    missingIdempotency,
    400,
    "B: PUT /v1/admin/system/ci-publishers (missing idempotency key)",
    "IDMP_KEY_REQUIRED",
  );

  const baseApi = requiredEnv("GOV_DXCP_API_BASE").replace(/\/$/, "");
  const emptyIdempotency = await fetch(`${baseApi}/v1/admin/system/ci-publishers`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": "",
    },
    body: JSON.stringify({ publishers: updated }),
  });
  await assertStatus(
    emptyIdempotency,
    400,
    "B: PUT /v1/admin/system/ci-publishers (empty idempotency key)",
    "IDMP_KEY_REQUIRED",
  );

  const putPayload = await putCiPublishersWithRetry(adminToken, updated, `govtest-${context.runId}-ci-publishers-update`);

  const found = Array.isArray(putPayload?.publishers) && putPayload.publishers.some((p: any) => p?.name === entryName);
  assert(found, "B: Updated CI publishers response did not include govtest publisher entry.");

  markStepEnd(context, step);
}
