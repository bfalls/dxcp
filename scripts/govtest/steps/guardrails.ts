import type { RunContext } from "../types.ts";
import {
  announceStep,
  apiRequest,
  assertStatus,
  buildDeploymentIntent,
  decodeJson,
  markStepEnd,
  markStepStart,
  optionalEnv,
} from "../common.ts";

type CheckStatus = "PASSED" | "FAILED" | "SKIPPED";

const TERMINAL_STATES = new Set(["SUCCEEDED", "FAILED", "CANCELED", "ROLLED_BACK"]);
const ACTIVE_STATES = new Set(["ACTIVE", "IN_PROGRESS"]);

function toInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function record(context: RunContext, id: string, status: CheckStatus, detail: string): void {
  context.guardrails.checks.push({ id, status, detail });
}

async function policySummary(context: RunContext, ownerToken: string): Promise<{ supported: boolean; payload?: any }> {
  const response = await apiRequest("POST", "/v1/policy/summary", ownerToken, {
    body: {
      service: context.service,
      environment: context.environment,
      recipeId: context.recipeId,
    },
  });
  if (response.status === 404 || response.status === 405) {
    return { supported: false };
  }
  const payload = await decodeJson(response);
  if (response.status !== 200) {
    throw new Error(`policy summary failed: expected HTTP 200, got ${response.status}; body=${JSON.stringify(payload)}`);
  }
  return { supported: true, payload };
}

async function validateIntent(context: RunContext, ownerToken: string, version: string): Promise<Response> {
  return apiRequest("POST", "/v1/deployments/validate", ownerToken, {
    body: buildDeploymentIntent(context, version),
  });
}

function hasNumericPolicyFields(
  payload: any,
  fields: Array<
    | "daily_deploy_quota"
    | "deployments_used"
    | "deployments_remaining"
    | "max_concurrent_deployments"
    | "current_concurrent_deployments"
    | "daily_quota_build_register"
  >,
): boolean {
  const policy = payload?.policy;
  return fields.every((field) => typeof policy?.[field] === "number");
}

async function pollDeploymentTerminal(context: RunContext, ownerToken: string, deploymentId: string): Promise<{ state: string; outcome: string | null }> {
  const timeoutSeconds = toInt(optionalEnv("GOV_DEPLOY_TIMEOUT_SECONDS"), 300);
  const pollSeconds = toInt(optionalEnv("GOV_DEPLOY_POLL_SECONDS"), 5);
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const status = await apiRequest("GET", `/v1/deployments/${encodeURIComponent(deploymentId)}`, ownerToken);
    const payload = await assertStatus(status, 200, `H: GET /v1/deployments/${deploymentId}`);
    const state = payload?.state;
    if (typeof state === "string" && TERMINAL_STATES.has(state)) {
      return { state, outcome: payload?.outcome ?? null };
    }
    await sleep(pollSeconds * 1000);
  }
  throw new Error(`H: deployment polling timed out after ${timeoutSeconds}s (deploymentId=${deploymentId})`);
}

async function waitForActiveOrTerminal(ownerToken: string, deploymentId: string): Promise<{ kind: "active" | "terminal"; state: string }> {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const status = await apiRequest("GET", `/v1/deployments/${encodeURIComponent(deploymentId)}`, ownerToken);
    const payload = await assertStatus(status, 200, `H: GET /v1/deployments/${deploymentId} (active wait)`);
    const state = payload?.state;
    if (typeof state === "string" && ACTIVE_STATES.has(state)) {
      return { kind: "active", state };
    }
    if (typeof state === "string" && TERMINAL_STATES.has(state)) {
      return { kind: "terminal", state };
    }
    await sleep(1000);
  }
  return { kind: "terminal", state: "UNKNOWN" };
}

export async function checkQuotaSafe(context: RunContext, ownerToken: string): Promise<void> {
  const summary = await policySummary(context, ownerToken);
  if (!summary.supported) {
    record(context, "quota.safe.policy_summary_available", "SKIPPED", "POST /v1/policy/summary is not supported");
    record(context, "quota.safe.policy_quota_shape", "SKIPPED", "Quota shape check skipped without policy endpoint");
    record(context, "quota.safe.validate_quota_shape", "SKIPPED", "Validate quota check skipped without policy endpoint");
    return;
  }

  record(context, "quota.safe.policy_summary_available", "PASSED", "POST /v1/policy/summary returned 200");
  if (hasNumericPolicyFields(summary.payload, ["daily_deploy_quota", "deployments_used", "deployments_remaining"])) {
    record(context, "quota.safe.policy_quota_shape", "PASSED", "Policy summary includes quota fields");
  } else {
    record(context, "quota.safe.policy_quota_shape", "FAILED", "Policy summary missing quota fields");
  }
  if (hasNumericPolicyFields(summary.payload, ["daily_quota_build_register"])) {
    record(
      context,
      "quota.safe.policy_daily_build_register_shape",
      "PASSED",
      "Policy summary includes daily_quota_build_register as a number",
    );
  } else {
    record(
      context,
      "quota.safe.policy_daily_build_register_shape",
      "FAILED",
      "Policy summary missing daily_quota_build_register",
    );
  }

  const validate = await validateIntent(context, ownerToken, context.runVersion);
  if (validate.status !== 200) {
    const payload = await decodeJson(validate);
    if (validate.status === 409 && payload?.code === "CONCURRENCY_LIMIT_REACHED") {
      record(context, "quota.safe.validate_quota_shape", "SKIPPED", "Validate blocked by active deployment concurrency");
      return;
    }
    if (validate.status === 429 && payload?.code === "QUOTA_EXCEEDED") {
      record(context, "quota.safe.validate_quota_shape", "SKIPPED", "Validate blocked by exhausted deploy quota");
      return;
    }
    record(
      context,
      "quota.safe.validate_quota_shape",
      "FAILED",
      `POST /v1/deployments/validate expected 200, got ${validate.status}; body=${JSON.stringify(payload)}`,
    );
    return;
  }
  const payload = await decodeJson(validate);
  if (hasNumericPolicyFields(payload, ["daily_deploy_quota", "deployments_used", "deployments_remaining"])) {
    record(context, "quota.safe.validate_quota_shape", "PASSED", "Validate response includes quota fields");
  } else {
    record(context, "quota.safe.validate_quota_shape", "FAILED", "Validate response missing quota fields");
  }
}

export async function checkQuotaActive(context: RunContext, ownerToken: string): Promise<void> {
  if (context.guardrails.mode !== "active") {
    record(context, "quota.active.mode", "SKIPPED", "GOV_GUARDRAILS_MODE is not active");
    record(context, "quota.active.validate_enforces_quota", "SKIPPED", "Active quota probing disabled in safe mode");
    record(context, "quota.active.n_plus_one", "SKIPPED", "Active quota probing disabled in safe mode");
    return;
  }
  record(context, "quota.active.mode", "PASSED", "GOV_GUARDRAILS_MODE=active");

  const first = await validateIntent(context, ownerToken, context.runVersion);
  const firstPayload = await decodeJson(first);
  if (first.status !== 200) {
    if (first.status === 409 && firstPayload?.code === "CONCURRENCY_LIMIT_REACHED") {
      record(context, "quota.active.validate_enforces_quota", "SKIPPED", "Initial validate blocked by active deployment concurrency");
      record(context, "quota.active.n_plus_one", "SKIPPED", "N+1 skipped because concurrency is currently saturated");
      return;
    }
    if (first.status === 429 && firstPayload?.code === "QUOTA_EXCEEDED") {
      record(context, "quota.active.validate_enforces_quota", "SKIPPED", "Initial validate blocked by exhausted deploy quota");
      record(context, "quota.active.n_plus_one", "SKIPPED", "N+1 skipped because quota is already exhausted");
      return;
    }
    record(
      context,
      "quota.active.validate_enforces_quota",
      "FAILED",
      `initial validate expected 200, got ${first.status}; body=${JSON.stringify(firstPayload)}`,
    );
    record(context, "quota.active.n_plus_one", "SKIPPED", "N+1 skipped because initial validate failed");
    return;
  }
  const firstRemaining = firstPayload?.policy?.deployments_remaining;

  const second = await validateIntent(context, ownerToken, context.runVersion);
  const secondPayload = await decodeJson(second);
  if (second.status !== 200) {
    if (second.status === 409 && secondPayload?.code === "CONCURRENCY_LIMIT_REACHED") {
      record(context, "quota.active.validate_enforces_quota", "SKIPPED", "Second validate blocked by active deployment concurrency");
      record(context, "quota.active.n_plus_one", "SKIPPED", "N+1 skipped because concurrency is currently saturated");
      return;
    }
    if (second.status === 429 && secondPayload?.code === "QUOTA_EXCEEDED") {
      record(context, "quota.active.validate_enforces_quota", "SKIPPED", "Second validate blocked by exhausted deploy quota");
      record(context, "quota.active.n_plus_one", "SKIPPED", "N+1 skipped because quota exhausted before probe");
      return;
    }
    record(
      context,
      "quota.active.validate_enforces_quota",
      "FAILED",
      `second validate expected 200, got ${second.status}; body=${JSON.stringify(secondPayload)}`,
    );
    record(context, "quota.active.n_plus_one", "SKIPPED", "N+1 skipped because second validate failed");
    return;
  }
  const secondRemaining = secondPayload?.policy?.deployments_remaining;
  if (typeof firstRemaining !== "number" || typeof secondRemaining !== "number") {
    record(context, "quota.active.validate_enforces_quota", "FAILED", "Validate response missing deployments_remaining");
    record(context, "quota.active.n_plus_one", "SKIPPED", "N+1 skipped because remaining quota is unavailable");
    return;
  }

  if (secondRemaining >= firstRemaining) {
    record(context, "quota.active.validate_enforces_quota", "SKIPPED", "Validate does not consume quota on this deployment API");
    record(context, "quota.active.n_plus_one", "SKIPPED", "N+1 skipped because validate quota is not decrementing");
    return;
  }

  record(context, "quota.active.validate_enforces_quota", "PASSED", "Validate decremented deployments_remaining");
  if (secondRemaining > 3) {
    record(context, "quota.active.n_plus_one", "SKIPPED", `Remaining quota is ${secondRemaining}; bounded run avoids exhausting it`);
    return;
  }

  let attempts = 0;
  const maxAttempts = Math.max(1, Math.min(secondRemaining + 1, 5));
  for (; attempts < maxAttempts; attempts += 1) {
    const response = await validateIntent(context, ownerToken, context.runVersion);
    const payload = await decodeJson(response);
    if (response.status === 429 && payload?.code === "QUOTA_EXCEEDED") {
      record(context, "quota.active.n_plus_one", "PASSED", `Hit QUOTA_EXCEEDED after ${attempts + 1} additional validate calls`);
      return;
    }
    if (response.status === 409 && payload?.code === "CONCURRENCY_LIMIT_REACHED") {
      record(context, "quota.active.n_plus_one", "SKIPPED", "N+1 probe interrupted by concurrency saturation");
      return;
    }
    if (response.status !== 200) {
      record(
        context,
        "quota.active.n_plus_one",
        "FAILED",
        `expected 200/429 QUOTA_EXCEEDED, got ${response.status}; body=${JSON.stringify(payload)}`,
      );
      return;
    }
  }
  record(context, "quota.active.n_plus_one", "FAILED", `Did not reach QUOTA_EXCEEDED within ${maxAttempts} additional validate calls`);
}

export async function checkConcurrencySafe(context: RunContext, ownerToken: string): Promise<void> {
  const summary = await policySummary(context, ownerToken);
  if (!summary.supported) {
    record(context, "concurrency.safe.policy_summary_available", "SKIPPED", "POST /v1/policy/summary is not supported");
    record(context, "concurrency.safe.policy_shape", "SKIPPED", "Concurrency shape check skipped without policy endpoint");
    record(context, "concurrency.safe.validate_shape", "SKIPPED", "Validate concurrency check skipped without policy endpoint");
    return;
  }
  record(context, "concurrency.safe.policy_summary_available", "PASSED", "POST /v1/policy/summary returned 200");
  if (hasNumericPolicyFields(summary.payload, ["max_concurrent_deployments", "current_concurrent_deployments"])) {
    record(context, "concurrency.safe.policy_shape", "PASSED", "Policy summary includes concurrency fields");
  } else {
    record(context, "concurrency.safe.policy_shape", "FAILED", "Policy summary missing concurrency fields");
  }

  const validate = await validateIntent(context, ownerToken, context.runVersion);
  if (validate.status !== 200) {
    const payload = await decodeJson(validate);
    if (validate.status === 409 && payload?.code === "CONCURRENCY_LIMIT_REACHED") {
      record(context, "concurrency.safe.validate_shape", "SKIPPED", "Validate blocked by active deployment concurrency");
      return;
    }
    if (validate.status === 429 && payload?.code === "QUOTA_EXCEEDED") {
      record(context, "concurrency.safe.validate_shape", "SKIPPED", "Validate blocked by exhausted deploy quota");
      return;
    }
    record(
      context,
      "concurrency.safe.validate_shape",
      "FAILED",
      `POST /v1/deployments/validate expected 200, got ${validate.status}; body=${JSON.stringify(payload)}`,
    );
    return;
  }
  const payload = await decodeJson(validate);
  if (hasNumericPolicyFields(payload, ["max_concurrent_deployments", "current_concurrent_deployments"])) {
    record(context, "concurrency.safe.validate_shape", "PASSED", "Validate response includes concurrency fields");
  } else {
    record(context, "concurrency.safe.validate_shape", "FAILED", "Validate response missing concurrency fields");
  }
}

export async function checkConcurrencyActive(context: RunContext, ownerToken: string): Promise<void> {
  if (context.guardrails.mode !== "active") {
    record(context, "concurrency.active.mode", "SKIPPED", "GOV_GUARDRAILS_MODE is not active");
    record(context, "concurrency.active.second_deploy_blocked", "SKIPPED", "Active concurrency probing disabled in safe mode");
    record(context, "concurrency.active.cleanup", "SKIPPED", "Active concurrency probing disabled in safe mode");
    return;
  }
  record(context, "concurrency.active.mode", "PASSED", "GOV_GUARDRAILS_MODE=active");

  const intent = buildDeploymentIntent(context, context.runVersion);
  const keyBase = `govtest-${context.runId}-guardrails-concurrency`;

  const first = await apiRequest("POST", "/v1/deployments", ownerToken, {
    idempotencyKey: `${keyBase}-first`,
    body: intent,
  });
  const firstPayload = await decodeJson(first);
  if (first.status === 409 && firstPayload?.code === "CONCURRENCY_LIMIT_REACHED") {
    record(context, "concurrency.active.second_deploy_blocked", "SKIPPED", "Environment already has an active deployment; probe not started");
    record(context, "concurrency.active.cleanup", "SKIPPED", "No guardrail probe deployment to clean up");
    return;
  }
  if (first.status === 429 && firstPayload?.code === "QUOTA_EXCEEDED") {
    record(context, "concurrency.active.second_deploy_blocked", "SKIPPED", "Quota already exhausted; concurrency probe skipped");
    record(context, "concurrency.active.cleanup", "SKIPPED", "No guardrail probe deployment to clean up");
    return;
  }
  if (first.status !== 201) {
    record(
      context,
      "concurrency.active.second_deploy_blocked",
      "FAILED",
      `first deploy expected 201, got ${first.status}; body=${JSON.stringify(firstPayload)}`,
    );
    record(context, "concurrency.active.cleanup", "SKIPPED", "Cleanup skipped because first deploy was not created");
    return;
  }
  const firstId = firstPayload?.id;
  if (typeof firstId !== "string" || !firstId) {
    record(context, "concurrency.active.second_deploy_blocked", "FAILED", "First deploy response missing id");
    record(context, "concurrency.active.cleanup", "SKIPPED", "Cleanup skipped because first deploy id is missing");
    return;
  }

  let secondCreatedId: string | undefined;
  const firstState = await waitForActiveOrTerminal(ownerToken, firstId);
  if (firstState.kind === "terminal") {
    record(
      context,
      "concurrency.active.second_deploy_blocked",
      "SKIPPED",
      `First deploy reached terminal state=${firstState.state} before concurrency probe`,
    );
  } else {
    const second = await apiRequest("POST", "/v1/deployments", ownerToken, {
      idempotencyKey: `${keyBase}-second`,
      body: intent,
    });
    const secondPayload = await decodeJson(second);
    if (second.status === 409 && secondPayload?.code === "CONCURRENCY_LIMIT_REACHED") {
      record(context, "concurrency.active.second_deploy_blocked", "PASSED", "Second deploy was blocked by CONCURRENCY_LIMIT_REACHED");
    } else if (second.status === 429 && secondPayload?.code === "QUOTA_EXCEEDED") {
      record(context, "concurrency.active.second_deploy_blocked", "SKIPPED", "Second deploy was blocked by quota before concurrency");
    } else if (second.status === 201) {
      secondCreatedId = typeof secondPayload?.id === "string" ? secondPayload.id : undefined;
      record(context, "concurrency.active.second_deploy_blocked", "FAILED", "Second deploy was accepted; concurrency limit was not enforced");
    } else {
      record(
        context,
        "concurrency.active.second_deploy_blocked",
        "FAILED",
        `second deploy expected 409 CONCURRENCY_LIMIT_REACHED, got ${second.status}; body=${JSON.stringify(secondPayload)}`,
      );
    }
  }

  try {
    await pollDeploymentTerminal(context, ownerToken, firstId);
    if (secondCreatedId) {
      await pollDeploymentTerminal(context, ownerToken, secondCreatedId);
    }
    record(context, "concurrency.active.cleanup", "PASSED", "Probe deployment cleanup completed (terminal state reached)");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    record(context, "concurrency.active.cleanup", "FAILED", detail);
  }
}

function printGuardrailSummary(context: RunContext): void {
  console.log(`[INFO] Guardrails mode=${context.guardrails.mode}`);
  for (const check of context.guardrails.checks) {
    console.log(`[GUARDRAIL] ${check.status} ${check.id} :: ${check.detail}`);
  }
}

export async function stepH_guardrailSpotChecks(context: RunContext, ownerToken: string): Promise<void> {
  const step = "H";
  announceStep("H) Guardrail spot checks (quota + concurrency; safe-by-default)");
  markStepStart(context, step);

  await checkQuotaSafe(context, ownerToken);
  await checkQuotaActive(context, ownerToken);
  await checkConcurrencySafe(context, ownerToken);
  await checkConcurrencyActive(context, ownerToken);

  printGuardrailSummary(context);
  markStepEnd(context, step);
}
