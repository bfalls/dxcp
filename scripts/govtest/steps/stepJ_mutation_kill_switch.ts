import type { RunContext } from "../types.ts";
import { announceStep, apiRequest, assert, assertStatus, buildDeploymentIntent, decodeJson, markStepEnd, markStepStart } from "../common.ts";

async function setMutationsDisabled(adminToken: string, disabled: boolean, reason: string): Promise<void> {
  const response = await apiRequest("PUT", "/v1/admin/system/mutations-disabled", adminToken, {
    body: {
      mutations_disabled: disabled,
      reason,
    },
  });
  const payload = await assertStatus(
    response,
    200,
    `J: PUT /v1/admin/system/mutations-disabled (${disabled ? "on" : "off"})`,
  );
  assert(
    payload?.mutations_disabled === disabled,
    `J: expected mutations_disabled=${disabled}, got ${JSON.stringify(payload)}`,
  );
}

export async function stepJ_mutationKillSwitch(
  context: RunContext,
  adminToken: string,
  ownerToken: string,
  ciToken: string,
): Promise<void> {
  const step = "J";
  announceStep("J) Mutation kill switch strict conformance (enable, enforce, restore)");
  markStepStart(context, step);

  let cleanupAttempted = false;
  try {
    await setMutationsDisabled(adminToken, false, `govtest ${context.runId} precheck`);
    await setMutationsDisabled(adminToken, true, `govtest ${context.runId} contract check`);

    const ownerDeploy = await apiRequest("POST", "/v1/deployments", ownerToken, {
      idempotencyKey: `govtest-${context.runId}-kill-switch-owner-deploy`,
      body: buildDeploymentIntent(context, context.runVersion),
    });
    await assertStatus(ownerDeploy, 503, "J: POST /v1/deployments while mutations disabled", "MUTATIONS_DISABLED");

    const ciBuildRegister = await apiRequest("POST", "/v1/builds/register", ciToken, {
      idempotencyKey: `govtest-${context.runId}-kill-switch-ci-register`,
      body: {
        service: context.service,
        version: context.runVersion,
        artifactRef: context.discovered.seedArtifactRef ?? `s3://dxcp-test-bucket/${context.service}/${context.runVersion}.zip`,
        git_sha: "a".repeat(40),
        git_branch: "main",
        ci_provider: "github_actions",
        ci_run_id: context.runId,
        built_at: new Date().toISOString(),
      },
    });
    await assertStatus(
      ciBuildRegister,
      503,
      "J: POST /v1/builds/register while mutations disabled",
      "MUTATIONS_DISABLED",
    );

    const adminCiPublishers = await apiRequest("PUT", "/v1/admin/system/ci-publishers", adminToken, {
      idempotencyKey: `govtest-${context.runId}-kill-switch-admin-ci-publishers`,
      body: { publishers: [] },
    });
    await assertStatus(
      adminCiPublishers,
      503,
      "J: PUT /v1/admin/system/ci-publishers while mutations disabled",
      "MUTATIONS_DISABLED",
    );
  } finally {
    cleanupAttempted = true;
    await setMutationsDisabled(adminToken, false, `govtest ${context.runId} cleanup`);
  }

  assert(cleanupAttempted, "J: cleanup path was not executed");

  const smoke = await apiRequest("POST", "/v1/deployments/validate", ownerToken, {
    body: buildDeploymentIntent(context, context.runVersion),
  });
  const smokePayload = await decodeJson(smoke);
  if (smoke.status === 503 && smokePayload?.code === "MUTATIONS_DISABLED") {
    throw new Error("J: kill switch cleanup failed; mutations remain disabled after cleanup");
  }

  markStepEnd(context, step);
}
