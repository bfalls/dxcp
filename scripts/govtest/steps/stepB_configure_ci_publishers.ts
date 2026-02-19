import type { RunContext } from "../types.ts";
import {
  announceStep,
  apiRequest,
  assert,
  assertStatus,
  decodeJwtClaims,
  markStepEnd,
  markStepStart,
  printIdentity,
  whoAmI,
} from "../common.ts";

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

  const entryName = `govtest-${context.runId}-ci`;
  const updated = existing.filter((p: any) => p?.name !== entryName);
  updated.push({
    name: entryName,
    provider: "custom",
    issuers: issuer ? [issuer] : undefined,
    audiences: audValues.length ? audValues : undefined,
    authorized_party_azp: azp ? [azp] : undefined,
    subjects: subject ? [subject] : undefined,
    description: `govtest run ${context.runId}`,
  });

  const put = await apiRequest("PUT", "/v1/admin/system/ci-publishers", adminToken, {
    body: { publishers: updated },
  });
  const putPayload = await assertStatus(put, 200, "B: PUT /v1/admin/system/ci-publishers");

  const found = Array.isArray(putPayload?.publishers) && putPayload.publishers.some((p: any) => p?.name === entryName);
  assert(found, "B: Updated CI publishers response did not include govtest publisher entry.");

  markStepEnd(context, step);
}
