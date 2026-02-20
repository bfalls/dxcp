import type { RunContext, JwtClaims } from "../types.ts";
import { announceStep, apiRequest, assert, assertStatus, buildDeploymentIntent, markStepEnd, markStepStart, optionalEnv } from "../common.ts";

const DEFAULT_ROLES_CLAIM = "https://dxcp.example/claims/roles";

function extractRolesFromClaims(claims: JwtClaims): string[] {
  const claimKey = optionalEnv("DXCP_OIDC_ROLES_CLAIM") ?? DEFAULT_ROLES_CLAIM;
  const value = (claims as Record<string, unknown>)[claimKey];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function assertContainsRole(claims: JwtClaims, expectedRole: string, contextLabel: string): void {
  const roles = extractRolesFromClaims(claims);
  assert(roles.includes(expectedRole), `${contextLabel}: expected roles claim to include ${expectedRole}; got ${JSON.stringify(roles)}`);
}

async function assertRoleForbiddenOnCiPublishersPut(token: string, label: string): Promise<void> {
  const response = await apiRequest("PUT", "/v1/admin/system/ci-publishers", token, {
    body: { publishers: [] },
  });
  const payload = await assertStatus(response, 403, `R: ${label} PUT /v1/admin/system/ci-publishers`, "ROLE_FORBIDDEN");
  assert(payload?.code === "ROLE_FORBIDDEN", `R: ${label} expected ROLE_FORBIDDEN, got ${payload?.code ?? "<missing>"}`);
}

export async function stepR_roleAuthorizationChecks(
  context: RunContext,
  tokens: { admin: string; owner: string; observer: string; ci: string },
  claimsByRole: { admin: JwtClaims; owner: JwtClaims; observer: JwtClaims; ci: JwtClaims },
): Promise<void> {
  const step = "R";
  announceStep("R) Role and claims sanity checks (admin/owner/observer authorization)");
  markStepStart(context, step);

  assertContainsRole(claimsByRole.admin, "dxcp-platform-admins", "R: admin claims sanity");
  assertContainsRole(claimsByRole.owner, "dxcp-delivery-owners", "R: owner claims sanity");
  assertContainsRole(claimsByRole.observer, "dxcp-observers", "R: observer claims sanity");
  assertContainsRole(claimsByRole.ci, "dxcp-ci-publishers", "R: ci claims sanity");

  const adminCiPublishersGet = await apiRequest("GET", "/v1/admin/system/ci-publishers", tokens.admin);
  await assertStatus(adminCiPublishersGet, 200, "R: admin GET /v1/admin/system/ci-publishers");

  await assertRoleForbiddenOnCiPublishersPut(tokens.owner, "owner");
  await assertRoleForbiddenOnCiPublishersPut(tokens.observer, "observer");

  const observerValidate = await apiRequest("POST", "/v1/deployments/validate", tokens.observer, {
    body: buildDeploymentIntent(context, context.runVersion),
  });
  await assertStatus(observerValidate, 403, "R: observer POST /v1/deployments/validate", "ROLE_FORBIDDEN");

  const observerDeploy = await apiRequest("POST", "/v1/deployments", tokens.observer, {
    idempotencyKey: `govtest-${context.runId}-observer-deploy-negative`,
    body: buildDeploymentIntent(context, context.runVersion),
  });
  await assertStatus(observerDeploy, 403, "R: observer POST /v1/deployments", "ROLE_FORBIDDEN");

  const ownerValidate = await apiRequest("POST", "/v1/deployments/validate", tokens.owner, {
    body: buildDeploymentIntent(context, context.unregisteredVersion),
  });
  await assertStatus(ownerValidate, 400, "R: owner POST /v1/deployments/validate (permission sanity)", "VERSION_NOT_FOUND");

  const ownerDeploy = await apiRequest("POST", "/v1/deployments", tokens.owner, {
    idempotencyKey: `govtest-${context.runId}-owner-deploy-permission`,
    body: buildDeploymentIntent(context, context.unregisteredVersion),
  });
  await assertStatus(ownerDeploy, 400, "R: owner POST /v1/deployments (permission sanity)", "VERSION_NOT_FOUND");

  const observerVersions = await apiRequest("GET", `/v1/services/${encodeURIComponent(context.service)}/versions`, tokens.observer);
  await assertStatus(observerVersions, 200, "R: observer GET /v1/services/{service}/versions");

  const observerDeployments = await apiRequest(
    "GET",
    `/v1/deployments?service=${encodeURIComponent(context.service)}&environment=${encodeURIComponent(context.environment)}`,
    tokens.observer,
  );
  const deploymentsPayload = await assertStatus(observerDeployments, 200, "R: observer GET /v1/deployments");
  assert(Array.isArray(deploymentsPayload), "R: observer deployment list response was not an array");

  if (deploymentsPayload.length > 0 && typeof deploymentsPayload[0]?.id === "string") {
    const observerDeploymentStatus = await apiRequest(
      "GET",
      `/v1/deployments/${encodeURIComponent(deploymentsPayload[0].id)}`,
      tokens.observer,
    );
    await assertStatus(observerDeploymentStatus, 200, "R: observer GET /v1/deployments/{id}");
  } else {
    const health = await apiRequest("GET", "/v1/health", tokens.observer);
    const healthPayload = await assertStatus(health, 200, "R: observer GET /v1/health fallback");
    assert(healthPayload?.status === "ok", "R: observer /v1/health fallback did not return status=ok");
  }

  const whoamiAdmin = await apiRequest("GET", "/v1/whoami", tokens.admin);
  const whoamiOwner = await apiRequest("GET", "/v1/whoami", tokens.owner);
  const whoamiObserver = await apiRequest("GET", "/v1/whoami", tokens.observer);
  const whoamiAdminPayload = await assertStatus(whoamiAdmin, 200, "R: admin GET /v1/whoami");
  const whoamiOwnerPayload = await assertStatus(whoamiOwner, 200, "R: owner GET /v1/whoami");
  const whoamiObserverPayload = await assertStatus(whoamiObserver, 200, "R: observer GET /v1/whoami");

  const whoamiRolesSources = [whoamiAdminPayload?.roles, whoamiOwnerPayload?.roles, whoamiObserverPayload?.roles];
  const hasWhoamiRoles = whoamiRolesSources.some((value) => Array.isArray(value));
  if (hasWhoamiRoles) {
    if (Array.isArray(whoamiAdminPayload?.roles)) {
      assert(
        whoamiAdminPayload.roles.includes("dxcp-platform-admins"),
        `R: admin whoami.roles missing dxcp-platform-admins; got ${JSON.stringify(whoamiAdminPayload.roles)}`,
      );
    }
    if (Array.isArray(whoamiOwnerPayload?.roles)) {
      assert(
        whoamiOwnerPayload.roles.includes("dxcp-delivery-owners"),
        `R: owner whoami.roles missing dxcp-delivery-owners; got ${JSON.stringify(whoamiOwnerPayload.roles)}`,
      );
    }
    if (Array.isArray(whoamiObserverPayload?.roles)) {
      assert(
        whoamiObserverPayload.roles.includes("dxcp-observers"),
        `R: observer whoami.roles missing dxcp-observers; got ${JSON.stringify(whoamiObserverPayload.roles)}`,
      );
    }
  } else {
    const adminRoles = extractRolesFromClaims(claimsByRole.admin);
    const ownerRoles = extractRolesFromClaims(claimsByRole.owner);
    const observerRoles = extractRolesFromClaims(claimsByRole.observer);
    assert(adminRoles.includes("dxcp-platform-admins"), "R: admin equivalent roles check failed");
    assert(ownerRoles.includes("dxcp-delivery-owners"), "R: owner equivalent roles check failed");
    assert(observerRoles.includes("dxcp-observers"), "R: observer equivalent roles check failed");
  }

  markStepEnd(context, step);
}
