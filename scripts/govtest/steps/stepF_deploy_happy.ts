import type { RunContext } from "../types.ts";
import {
  announceStep,
  apiRequest,
  assert,
  assertStatus,
  buildDeploymentIntent,
  decodeJson,
  isStrictConformance,
  logInfo,
  markStepEnd,
  markStepStart,
  optionalEnv,
} from "../common.ts";

const TERMINAL_STATES = new Set(["SUCCEEDED", "FAILED", "CANCELED", "ROLLED_BACK"]);

function toInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

type RequestFactory = () => Promise<Response>;

async function requestWithEngineRetry(
  label: string,
  requestFactory: RequestFactory,
  attempts: number,
  backoffMs: number,
): Promise<{ response: Response; payload: any; attemptsUsed: number }> {
  let lastResponse: Response | null = null;
  let lastPayload: any = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await requestFactory();
    const payload = await decodeJson(response);
    lastResponse = response;
    lastPayload = payload;
    if (!isEngineUnavailableFailure(response.status, payload)) {
      return { response, payload, attemptsUsed: attempt };
    }
    if (attempt < attempts) {
      logInfo(`${label}: engine unavailable (${response.status}); retrying attempt ${attempt + 1}/${attempts}.`);
      await sleep(backoffMs * attempt);
    }
  }
  return {
    response: lastResponse as Response,
    payload: lastPayload,
    attemptsUsed: attempts,
  };
}

function isEngineUnavailableFailure(status: number, payload: any): boolean {
  if (status < 500) return false;
  if (payload?.details?.engine_unavailable === true) return true;
  if (payload?.code === "ENGINE_CALL_FAILED") return true;
  if (payload?.error_code === "ENGINE_CALL_FAILED") return true;
  if (payload?.details?.diagnostics?.engine === "spinnaker") return true;
  return false;
}

export async function stepF_deployHappyPath(
  context: RunContext,
  ownerToken: string,
  observerToken: string,
  nonMemberOwnerToken?: string,
): Promise<void> {
  const step = "F";
  announceStep("F) Deploy happy path for runVersion plus polling to terminal state");
  markStepStart(context, step);

  const timeoutSeconds = toInt(optionalEnv("GOV_DEPLOY_TIMEOUT_SECONDS"), 300);
  const pollSeconds = toInt(optionalEnv("GOV_DEPLOY_POLL_SECONDS"), 5);
  const engineRetryAttempts = toInt(optionalEnv("GOV_ENGINE_RETRY_ATTEMPTS"), 4);
  const engineRetryBackoffMs = toInt(optionalEnv("GOV_ENGINE_RETRY_BACKOFF_MS"), 1500);
  const validateIntent = buildDeploymentIntent(context, context.runVersion);
  const deployIntent = buildDeploymentIntent(context, context.runVersion);

  const { response: validate, payload: validateBody } = await requestWithEngineRetry(
    "F validate",
    () =>
      apiRequest("POST", "/v1/deployments/validate", ownerToken, {
        body: validateIntent,
      }),
    engineRetryAttempts,
    engineRetryBackoffMs,
  );
  if (validate.status !== 200) {
    if (!isStrictConformance(context) && isEngineUnavailableFailure(validate.status, validateBody)) {
      logInfo(
        `F: diagnostic mode: skipping deploy happy path because validate returned engine unavailable (${validate.status}).`,
      );
      markStepEnd(context, step);
      return;
    }
    throw new Error(
      `F: POST /v1/deployments/validate (registered) failed: expected HTTP 200, got ${validate.status}; body=${JSON.stringify(validateBody)}`,
    );
  }
  assert(validateBody?.versionRegistered === true, "F: validate response did not confirm versionRegistered=true");

  const { response: deploy, payload: deployBody } = await requestWithEngineRetry(
    "F deploy",
    () =>
      apiRequest("POST", "/v1/deployments", ownerToken, {
        idempotencyKey: context.idempotencyKeys.deployRegistered,
        body: deployIntent,
      }),
    engineRetryAttempts,
    engineRetryBackoffMs,
  );
  if (deploy.status !== 201) {
    if (!isStrictConformance(context) && isEngineUnavailableFailure(deploy.status, deployBody)) {
      logInfo(
        `F: diagnostic mode: skipping deploy happy path because deploy returned engine unavailable (${deploy.status}).`,
      );
      markStepEnd(context, step);
      return;
    }
    throw new Error(
      `F: POST /v1/deployments (registered) failed: expected HTTP 201, got ${deploy.status}; body=${JSON.stringify(deployBody)}`,
    );
  }

  const deploymentId = deployBody?.id;
  assert(typeof deploymentId === "string" && deploymentId.length > 0, "F: deployment response missing id");
  context.deployment.id = deploymentId;

  const ownerStatus = await apiRequest("GET", `/v1/deployments/${encodeURIComponent(deploymentId)}`, ownerToken);
  await assertStatus(ownerStatus, 200, `F: owner GET /v1/deployments/${deploymentId}`);

  const observerStatus = await apiRequest("GET", `/v1/deployments/${encodeURIComponent(deploymentId)}`, observerToken);
  await assertStatus(observerStatus, 200, `F: observer GET /v1/deployments/${deploymentId}`);

  if (nonMemberOwnerToken) {
    const nonMemberStatus = await apiRequest("GET", `/v1/deployments/${encodeURIComponent(deploymentId)}`, nonMemberOwnerToken);
    await assertStatus(
      nonMemberStatus,
      403,
      `F: non-member owner GET /v1/deployments/${deploymentId}`,
      "DELIVERY_GROUP_SCOPE_REQUIRED",
    );
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
        let failureSummary = "n/a";
        try {
          const failuresResp = await apiRequest(
            "GET",
            `/v1/deployments/${encodeURIComponent(deploymentId)}/failures`,
            ownerToken,
          );
          const failuresBody = await decodeJson(failuresResp);
          if (failuresResp.status === 200) {
            failureSummary = JSON.stringify(failuresBody);
          } else {
            failureSummary = `failed to fetch failures: status=${failuresResp.status} body=${JSON.stringify(failuresBody)}`;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failureSummary = `failed to fetch failures: ${message}`;
        }
        throw new Error(
          `F: deployment reached terminal state=${state}, outcome=${outcome ?? "null"} (deploymentId=${deploymentId}); failures=${failureSummary}`,
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
