import type { RunContext } from "../types.ts";
import {
  announceStep,
  apiRequest,
  assert,
  assertStatus,
  decodeJwtClaims,
  isStrictConformance,
  markStepEnd,
  markStepStart,
} from "../common.ts";

type AuditEvent = {
  target_id?: string;
  actor_id?: string;
  summary?: string;
};

function parseSummary(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || !raw.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function assertAdminConfigEventShape(
  context: string,
  event: AuditEvent | undefined,
  expectedSettingKey: string,
  expectedActorId?: string,
): void {
  assert(event, `${context}: expected event for setting_key=${expectedSettingKey}`);
  const summary = parseSummary(event?.summary);
  assert(summary.setting_key === expectedSettingKey, `${context}: missing setting_key=${expectedSettingKey}`);
  assert(typeof summary.request_id === "string" && summary.request_id.length > 0, `${context}: missing request_id`);
  assert(typeof summary.timestamp === "string" && summary.timestamp.length > 0, `${context}: missing timestamp`);
  assert("old_value" in summary, `${context}: missing old_value`);
  assert("new_value" in summary, `${context}: missing new_value`);
  assert(typeof summary.actor_sub === "string" && summary.actor_sub.length > 0, `${context}: missing actor_sub`);
  assert(typeof summary.actor_email === "string" && summary.actor_email.length > 0, `${context}: missing actor_email`);
  if (expectedActorId) {
    assert(event?.actor_id === expectedActorId, `${context}: actor_id mismatch in event row`);
    assert(summary.actor_id === expectedActorId, `${context}: actor_id mismatch in summary`);
  } else {
    assert(typeof summary.actor_id === "string" && summary.actor_id.length > 0, `${context}: missing actor_id`);
  }
}

export async function stepK_adminConfigAuditConformance(context: RunContext, adminToken: string): Promise<void> {
  const step = "K";
  announceStep("K) Admin config audit conformance (ci-publishers + mutation kill switch)");
  markStepStart(context, step);

  // Intentionally exclude rate-limit mutation assertions here. Changing read/mutate quotas mid-run
  // can throttle unrelated govtest steps and create false conformance failures.
  const adminClaims = decodeJwtClaims(adminToken);
  const expectedActorId = typeof adminClaims.sub === "string" ? adminClaims.sub : undefined;
  const response = await apiRequest(
    "GET",
    "/v1/audit/events?event_type=ADMIN_CONFIG_CHANGE&limit=500",
    adminToken,
  );
  const payload = await assertStatus(response, 200, "K: GET /v1/audit/events?event_type=ADMIN_CONFIG_CHANGE");
  assert(Array.isArray(payload), "K: audit events payload must be an array");

  const events = payload as AuditEvent[];
  const isRunEvent = (event: AuditEvent): boolean => typeof event?.summary === "string" && event.summary.includes(context.runId);
  const ciPublishersEvent = events.find((event) => event?.target_id === "ci_publishers" && isRunEvent(event));
  const mutationsDisabledEvents = events.filter((event) => event?.target_id === "mutations_disabled" && isRunEvent(event));
  const strict = isStrictConformance(context);

  if (!ciPublishersEvent || mutationsDisabledEvents.length < 2) {
    if (!strict) {
      console.log(
        `[INFO] K: diagnostic mode: admin config audit assertions skipped for this runId (${context.runId}) due to missing run-scoped audit events.`,
      );
      markStepEnd(context, step);
      return;
    }
  }

  assertAdminConfigEventShape("K: ci_publishers", ciPublishersEvent, "ci_publishers", expectedActorId);
  assert(
    mutationsDisabledEvents.length >= 2,
    `K: expected at least 2 mutations_disabled events (enable + cleanup), got ${mutationsDisabledEvents.length}`,
  );
  for (const event of mutationsDisabledEvents) {
    assertAdminConfigEventShape("K: mutations_disabled", event, "mutations_disabled", expectedActorId);
  }

  markStepEnd(context, step);
}
