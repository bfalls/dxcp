import type { RunContext } from "../types.ts";
import { announceStep, apiRequest, assert, assertStatus, buildDeploymentIntent, markStepEnd, markStepStart, optionalEnv } from "../common.ts";

const TERMINAL_STATES = new Set(["SUCCEEDED", "FAILED", "CANCELED", "ROLLED_BACK"]);

function toInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function stepF_deployHappyPath(
  context: RunContext,
  ownerToken: string,
  observerToken: string,
  nonMemberOwnerToken?: string,
): Promise<void> {
  const step = "F";
  announceStep("F) Deploy happy path for GOV_RUN_VERSION plus polling to terminal state");
  markStepStart(context, step);

  const timeoutSeconds = toInt(optionalEnv("GOV_DEPLOY_TIMEOUT_SECONDS"), 300);
  const pollSeconds = toInt(optionalEnv("GOV_DEPLOY_POLL_SECONDS"), 5);

  const validate = await apiRequest("POST", "/v1/deployments/validate", ownerToken, {
    body: buildDeploymentIntent(context, context.runVersion),
  });
  const validateBody = await assertStatus(validate, 200, "F: POST /v1/deployments/validate (registered)");
  assert(validateBody?.versionRegistered === true, "F: validate response did not confirm versionRegistered=true");

  const deploy = await apiRequest("POST", "/v1/deployments", ownerToken, {
    idempotencyKey: context.idempotencyKeys.deployRegistered,
    body: buildDeploymentIntent(context, context.runVersion),
  });
  const deployBody = await assertStatus(deploy, 201, "F: POST /v1/deployments (registered)");

  const deploymentId = deployBody?.id;
  assert(typeof deploymentId === "string" && deploymentId.length > 0, "F: deployment response missing id");
  context.deployment.id = deploymentId;

  const ownerStatus = await apiRequest("GET", `/v1/deployments/${encodeURIComponent(deploymentId)}`, ownerToken);
  await assertStatus(ownerStatus, 200, `F: owner GET /v1/deployments/${deploymentId}`);

  const observerStatus = await apiRequest("GET", `/v1/deployments/${encodeURIComponent(deploymentId)}`, observerToken);
  await assertStatus(observerStatus, 200, `F: observer GET /v1/deployments/${deploymentId}`);

  if (nonMemberOwnerToken) {
    const nonMemberStatus = await apiRequest("GET", `/v1/deployments/${encodeURIComponent(deploymentId)}`, nonMemberOwnerToken);
    await assertStatus(nonMemberStatus, 403, `F: non-member owner GET /v1/deployments/${deploymentId}`);
  }

  const deadline = Date.now() + timeoutSeconds * 1000;
  let lastState: string | null = null;
  let lastOutcome: string | null = null;

  while (Date.now() < deadline) {
    const status = await apiRequest("GET", `/v1/deployments/${encodeURIComponent(deploymentId)}`, ownerToken);
    const statusBody = await assertStatus(status, 200, `F: GET /v1/deployments/${deploymentId}`);
    const state = statusBody?.state;
    const outcome = statusBody?.outcome ?? null;
    lastState = typeof state === "string" ? state : null;
    lastOutcome = typeof outcome === "string" ? outcome : outcome === null ? null : String(outcome);
    if (typeof state === "string" && TERMINAL_STATES.has(state)) {
      context.deployment.finalState = state;
      context.deployment.finalOutcome = outcome;
      if (state !== "SUCCEEDED") {
        throw new Error(
          `F: deployment reached terminal state=${state}, outcome=${outcome ?? "null"} (deploymentId=${deploymentId})`,
        );
      }
      markStepEnd(context, step);
      return;
    }
    await sleep(pollSeconds * 1000);
  }

  throw new Error(
    `F: deployment polling timed out after ${timeoutSeconds}s (deploymentId=${deploymentId}, lastState=${lastState ?? "unknown"}, lastOutcome=${lastOutcome ?? "null"})`,
  );
}
