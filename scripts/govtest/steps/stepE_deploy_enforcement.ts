import type { RunContext } from "../types.ts";
import { announceStep, apiRequest, assertStatus, buildDeploymentIntent, decodeJson, markStepEnd, markStepStart } from "../common.ts";

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function recipePolicyIntent(context: RunContext, recipeId: string): any {
  const intent = buildDeploymentIntent(context, context.unregisteredVersion);
  return { ...intent, recipeId };
}

async function getDeliveryGroupForService(adminToken: string, service: string): Promise<any> {
  const response = await apiRequest("GET", "/v1/delivery-groups", adminToken);
  const groups = await assertStatus(response, 200, "E: GET /v1/delivery-groups");
  if (!Array.isArray(groups)) {
    throw new Error("E: Expected /v1/delivery-groups to return an array");
  }

  const group = groups.find((candidate: any) => Array.isArray(candidate?.services) && candidate.services.includes(service));
  if (!group) {
    throw new Error(`E: No delivery group found for service=${service}`);
  }
  return group;
}

async function updateDeliveryGroupAllowedRecipes(
  adminToken: string,
  group: any,
  allowedRecipes: string[],
  changeReason: string,
): Promise<any> {
  const payload = {
    id: group.id,
    name: group.name,
    description: group.description,
    owner: group.owner,
    services: Array.isArray(group.services) ? group.services : [],
    allowed_environments: Array.isArray(group.allowed_environments) ? group.allowed_environments : undefined,
    allowed_recipes: allowedRecipes,
    guardrails: group.guardrails,
    change_reason: changeReason,
  };
  const response = await apiRequest("PUT", `/v1/delivery-groups/${encodeURIComponent(group.id)}`, adminToken, { body: payload });
  return assertStatus(response, 200, `E: PUT /v1/delivery-groups/${group.id}`);
}

async function ensureTemporaryRecipe(adminToken: string, recipeId: string, runId: string): Promise<void> {
  const recipe = {
    id: recipeId,
    name: `Govtest Decision 7 ${runId}`,
    description: "Temporary recipe for Decision 7 precedence assertion",
    spinnaker_application: "dxcp",
    deploy_pipeline: "demo-deploy-default",
    rollback_pipeline: "rollback-demo-service",
    effective_behavior_summary: "Govtest Decision 7 compatibility vs policy precedence probe.",
    status: "active",
    change_reason: `govtest ${runId} decision-7 probe`,
  };
  const response = await apiRequest("POST", "/v1/recipes", adminToken, { body: recipe });
  if (response.status === 409) {
    const payload = await decodeJson(response);
    if (payload?.code === "RECIPE_EXISTS") {
      return;
    }
  }
  await assertStatus(response, 200, "E: POST /v1/recipes (decision-7 temporary recipe)");
}

export async function stepE_deployEnforcementUnregisteredVersion(
  context: RunContext,
  ownerToken: string,
  adminToken: string,
): Promise<void> {
  const step = "E";
  announceStep("E) Deploy enforcement: unregistered checks plus policy-before-compatibility ordering");
  markStepStart(context, step);

  const validate = await apiRequest("POST", "/v1/deployments/validate", ownerToken, {
    body: buildDeploymentIntent(context, context.unregisteredVersion),
  });
  await assertStatus(validate, 400, "E: POST /v1/deployments/validate (unregistered)", "VERSION_NOT_FOUND");

  const deploy = await apiRequest("POST", "/v1/deployments", ownerToken, {
    idempotencyKey: context.idempotencyKeys.deployUnregistered,
    body: buildDeploymentIntent(context, context.unregisteredVersion),
  });
  await assertStatus(deploy, 400, "E: POST /v1/deployments (unregistered)", "VERSION_NOT_FOUND");

  const temporaryRecipeId = `govtest-decision7-${context.runId}`;
  await ensureTemporaryRecipe(adminToken, temporaryRecipeId, context.runId);

  const group = await getDeliveryGroupForService(adminToken, context.service);
  const originalAllowedRecipes = Array.isArray(group.allowed_recipes) ? [...group.allowed_recipes] : [];
  const withTemporaryRecipeAllowed = unique([...originalAllowedRecipes, temporaryRecipeId]);

  await updateDeliveryGroupAllowedRecipes(
    adminToken,
    group,
    withTemporaryRecipeAllowed,
    `govtest ${context.runId} decision-7 allow temporary recipe`,
  );
  try {
    const compatibilityOnly = await apiRequest("POST", "/v1/deployments/validate", ownerToken, {
      body: recipePolicyIntent(context, temporaryRecipeId),
    });
    await assertStatus(
      compatibilityOnly,
      400,
      "E: POST /v1/deployments/validate (Decision 7 compatibility-only path)",
      "RECIPE_INCOMPATIBLE",
    );
  } finally {
    await updateDeliveryGroupAllowedRecipes(
      adminToken,
      group,
      originalAllowedRecipes,
      `govtest ${context.runId} decision-7 restore recipe policy`,
    );
  }

  const policyWins = await apiRequest("POST", "/v1/deployments/validate", ownerToken, {
    body: recipePolicyIntent(context, temporaryRecipeId),
  });
  await assertStatus(
    policyWins,
    403,
    "E: POST /v1/deployments/validate (Decision 7 policy-before-compatibility)",
    "RECIPE_NOT_ALLOWED",
  );

  markStepEnd(context, step);
}
