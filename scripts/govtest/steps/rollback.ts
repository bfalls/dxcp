import type { RunContext } from "../types.ts";
import {
  announceStep,
  apiRequest,
  assert,
  assertStatus,
  buildDeploymentIntent,
  decodeJson,
  isStrictConformance,
  markStepEnd,
  markStepStart,
  optionalEnv,
  requiredEnv,
} from "../common.ts";

type RollbackTarget = {
  version: string;
  deploymentId: string;
};

type SubmittedRollback = {
  deploymentId: string;
};

const TERMINAL_STATES = new Set(["SUCCEEDED", "FAILED", "CANCELED", "ROLLED_BACK"]);

function toInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function listDeploymentsForScope(context: RunContext, ownerToken: string): Promise<any[]> {
  const path = `/v1/deployments?service=${encodeURIComponent(context.service)}&environment=${encodeURIComponent(context.environment)}`;
  const response = await apiRequest("GET", path, ownerToken);
  const payload = await assertStatus(response, 200, "G: GET /v1/deployments (rollback discovery)");
  assert(Array.isArray(payload), "G: expected deployment history array from GET /v1/deployments");
  return payload;
}

export async function discoverRollbackTarget(context: RunContext, ownerToken: string): Promise<RollbackTarget | null> {
  const history = await listDeploymentsForScope(context, ownerToken);
  const candidate = history.find(
    (item) =>
      item?.state === "SUCCEEDED" &&
      typeof item?.version === "string" &&
      item.version !== context.runVersion &&
      item?.deploymentKind !== "ROLLBACK" &&
      !item?.rollbackOf,
  );
  if (!candidate) {
    return null;
  }
  const version = typeof candidate.version === "string" ? candidate.version : "";
  const deploymentId = typeof candidate.id === "string" ? candidate.id : "";
  assert(version.length > 0, "G: rollback target discovery found a record without version");
  assert(deploymentId.length > 0, "G: rollback target discovery found a record without deployment id");
  return { version, deploymentId };
}

export async function validateRollback(context: RunContext, ownerToken: string, target: RollbackTarget): Promise<void> {
  const byDeploymentId = await apiRequest(
    "POST",
    `/v1/deployments/${encodeURIComponent(target.deploymentId)}/rollback/validate`,
    ownerToken,
  );
  if (byDeploymentId.status === 200) {
    context.rollback.validationMode = "rollback-endpoint";
    return;
  }
  if (byDeploymentId.status === 404 || byDeploymentId.status === 405) {
    const payload = await decodeJson(byDeploymentId);
    if (payload?.code === "NOT_FOUND") {
      throw new Error(
        `G: POST /v1/deployments/${target.deploymentId}/rollback/validate failed with HTTP ${byDeploymentId.status}; body=${JSON.stringify(payload)}`,
      );
    }
  } else {
    const payload = await decodeJson(byDeploymentId);
    throw new Error(
      `G: POST /v1/deployments/${target.deploymentId}/rollback/validate failed with HTTP ${byDeploymentId.status}; body=${JSON.stringify(payload)}`,
    );
  }

  assert(typeof target.version === "string" && target.version.length > 0, "G: rollback validation requires target version");
  const validate = await apiRequest("POST", "/v1/deployments/validate", ownerToken, {
    body: buildDeploymentIntent(context, target.version),
  });
  const validateBody = await assertStatus(validate, 200, "G: POST /v1/deployments/validate (rollback target)");
  assert(validateBody?.versionRegistered === true, "G: rollback target validate did not confirm versionRegistered=true");
  context.rollback.validationMode = "deployment-validate";
}

export async function submitRollback(
  context: RunContext,
  ownerToken: string,
  target: RollbackTarget,
): Promise<SubmittedRollback> {
  const rollbackPath = `/v1/deployments/${encodeURIComponent(target.deploymentId)}/rollback`;
  const missingIdempotency = await apiRequest("POST", rollbackPath, ownerToken);
  await assertStatus(
    missingIdempotency,
    400,
    `G: POST ${rollbackPath} (missing idempotency key)`,
    "IDMP_KEY_REQUIRED",
  );

  const baseApi = requiredEnv("GOV_DXCP_API_BASE").replace(/\/$/, "");
  const emptyIdempotency = await fetch(`${baseApi}${rollbackPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ownerToken}`,
      "Idempotency-Key": "",
    },
  });
  await assertStatus(
    emptyIdempotency,
    400,
    `G: POST ${rollbackPath} (empty idempotency key)`,
    "IDMP_KEY_REQUIRED",
  );

  const rollbackById = await apiRequest("POST", rollbackPath, ownerToken, {
    idempotencyKey: context.idempotencyKeys.rollbackSubmit,
  });
  const body = await assertStatus(
    rollbackById,
    201,
    `G: POST /v1/deployments/${target.deploymentId}/rollback`,
  );
  const deploymentId = body?.id;
  assert(typeof deploymentId === "string" && deploymentId.length > 0, "G: rollback submit response missing id");
  context.rollback.submissionMode = "rollback-endpoint";
  return { deploymentId };
}

export async function pollRollback(
  context: RunContext,
  ownerToken: string,
  submitted: SubmittedRollback,
): Promise<void> {
  const timeoutSeconds = toInt(optionalEnv("GOV_DEPLOY_TIMEOUT_SECONDS"), 300);
  const pollSeconds = toInt(optionalEnv("GOV_DEPLOY_POLL_SECONDS"), 5);
  const deadline = Date.now() + timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    const status = await apiRequest("GET", `/v1/deployments/${encodeURIComponent(submitted.deploymentId)}`, ownerToken);
    const statusBody = await assertStatus(status, 200, `G: GET /v1/deployments/${submitted.deploymentId}`);
    const state = statusBody?.state;
    const outcome = statusBody?.outcome ?? null;
    if (typeof state === "string" && TERMINAL_STATES.has(state)) {
      context.rollback.finalState = state;
      context.rollback.finalOutcome = outcome;
      if (state !== "SUCCEEDED") {
        throw new Error(`G: rollback reached terminal state=${state}, outcome=${outcome ?? "null"}`);
      }
      return;
    }
    await sleep(pollSeconds * 1000);
  }

  throw new Error(`G: rollback polling timed out after ${timeoutSeconds}s (deploymentId=${submitted.deploymentId})`);
}

async function assertRollbackRecordShape(
  context: RunContext,
  ownerToken: string,
  submitted: SubmittedRollback,
): Promise<void> {
  const response = await apiRequest("GET", `/v1/deployments/${encodeURIComponent(submitted.deploymentId)}`, ownerToken);
  const rollbackRecord = await assertStatus(
    response,
    200,
    `G: GET /v1/deployments/${submitted.deploymentId} (post-rollback record)`,
  );

  const deploymentKind = rollbackRecord?.deploymentKind;
  assert(
    deploymentKind === "ROLLBACK",
    `G: rollback deploymentKind expected ROLLBACK, got ${String(deploymentKind)}`,
  );

  const priorDeploymentId = context.rollback.targetDeploymentId;
  assert(
    typeof priorDeploymentId === "string" && priorDeploymentId.length > 0,
    "G: rollback target deployment id missing; cannot assert rollbackOf linkage",
  );
  const rollbackOf = rollbackRecord?.rollbackOf;
  assert(typeof rollbackOf === "string" && rollbackOf.length > 0, "G: rollback record missing rollbackOf");
  assert(rollbackOf === priorDeploymentId, `G: rollbackOf mismatch; expected ${priorDeploymentId}, got ${String(rollbackOf)}`);
}

export async function stepG_rollbackAfterDeploy(context: RunContext, ownerToken: string): Promise<void> {
  const step = "G";
  announceStep("G) Rollback governance check: discover prior successful target, validate, submit, and poll");
  markStepStart(context, step);

  const target = await discoverRollbackTarget(context, ownerToken);
  if (!target) {
    const reason = `No prior SUCCEEDED deployment with version != ${context.runVersion} for ${context.service}/${context.environment}`;
    if (isStrictConformance(context)) {
      throw new Error(
        `G: rollback contract invariant requires an eligible prior deployment target in strict conformance mode. ${reason}`,
      );
    }
    context.rollback.skipped = true;
    context.rollback.skipReason = reason;
    console.log(`[INFO] Rollback skipped: ${context.rollback.skipReason}`);
    markStepEnd(context, step);
    return;
  }

  context.rollback.targetVersion = target.version;
  context.rollback.targetDeploymentId = target.deploymentId;

  await validateRollback(context, ownerToken, target);
  const submitted = await submitRollback(context, ownerToken, target);
  context.rollback.deploymentId = submitted.deploymentId;
  await pollRollback(context, ownerToken, submitted);
  await assertRollbackRecordShape(context, ownerToken, submitted);

  markStepEnd(context, step);
}
