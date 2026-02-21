#!/usr/bin/env node

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  announceStep,
  assert,
  buildRunContext,
  decodeJwtClaims,
  ensureCiToken,
  fail,
  isStrictConformance,
  loadLocalDotenv,
  optionalEnv,
  printIdentity,
  printRunPlan,
  requiredEnv,
  whoAmI,
} from "./common.ts";
import type { RunContext } from "./types.ts";
import { getUserAccessTokenViaCustomCredentials, getUserAccessTokenViaPlaywright } from "./ui_auth.ts";
import { stepA_proveCiGateNegative } from "./steps/stepA_gate_negative.ts";
import { stepB_configureCiPublishersAllowlist } from "./steps/stepB_configure_ci_publishers.ts";
import { stepC_registerBuildHappyPath } from "./steps/stepC_register_build.ts";
import { stepD_sameIdempotencyKeyDifferentBodyReturnsConflict } from "./steps/stepD_conflict.ts";
import { stepE_deployEnforcementUnregisteredVersion } from "./steps/stepE_deploy_enforcement.ts";
import { stepF_deployHappyPath } from "./steps/stepF_deploy_happy.ts";
import { stepG_rollbackAfterDeploy } from "./steps/rollback.ts";
import { stepH_guardrailSpotChecks } from "./steps/guardrails.ts";
import { stepR_roleAuthorizationChecks } from "./steps/stepRole_authorization.ts";

const LAST_RUN_ARTIFACT = ".govtest.last-run.json";
const ANSI = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
} as const;

type ResultKind = "success" | "failure" | "information";

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

function colorFor(kind: ResultKind): string {
  if (kind === "success") return ANSI.green;
  if (kind === "failure") return ANSI.red;
  return ANSI.blue;
}

function labelFor(kind: ResultKind): string {
  if (kind === "success") return "✓";
  if (kind === "failure") return "✗";
  return "i";
}

function printEvaluatedLine(kind: ResultKind, message: string): void {
  const color = colorFor(kind);
  const label = labelFor(kind);
  console.log(`${color}[${label}]${ANSI.reset} ${message}`);
}

function printSummaryField(kind: ResultKind, key: string, value: string | number | boolean): void {
  printEvaluatedLine(kind, `${key}=${value}`);
}

function evaluateTimingsResult(context: RunContext): { kind: ResultKind; message: string } {
  const started = Object.keys(context.timings.stepStart).length;
  const ended = Object.keys(context.timings.stepEnd).length;
  if (started === 0) {
    return { kind: "information", message: "timings: no mutation steps executed" };
  }
  if (ended === started) {
    return { kind: "success", message: `timings: ${ended}/${started} steps completed` };
  }
  return { kind: "failure", message: `timings: ${ended}/${started} steps completed` };
}

function evaluateDeploymentField(context: RunContext, key: "deploymentId" | "deploymentFinalState" | "deploymentFinalOutcome"): ResultKind {
  if (key === "deploymentId") {
    if (!context.deployment.id) return "information";
    return context.deployment.finalState === "SUCCEEDED" ? "success" : "information";
  }
  if (key === "deploymentFinalState") {
    const state = context.deployment.finalState;
    if (!state) return "information";
    return state === "SUCCEEDED" ? "success" : "failure";
  }
  const outcome = context.deployment.finalOutcome;
  if (!outcome) return "information";
  return outcome === "SUCCEEDED" ? "success" : "failure";
}

function evaluateRollbackField(
  context: RunContext,
  key:
    | "rollbackSkipped"
    | "rollbackSkipReason"
    | "rollbackTargetVersion"
    | "rollbackTargetDeploymentId"
    | "rollbackValidationMode"
    | "rollbackSubmissionMode"
    | "rollbackDeploymentId"
    | "rollbackFinalState"
    | "rollbackFinalOutcome",
): ResultKind {
  const skipped = context.rollback.skipped ?? false;
  if (key === "rollbackSkipped") {
    return skipped ? "information" : "success";
  }
  if (key === "rollbackSkipReason") {
    return "information";
  }
  if (key === "rollbackTargetVersion" || key === "rollbackTargetDeploymentId") {
    if (skipped) return "information";
    const hasValue = key === "rollbackTargetVersion" ? Boolean(context.rollback.targetVersion) : Boolean(context.rollback.targetDeploymentId);
    return hasValue ? "success" : "information";
  }
  if (key === "rollbackValidationMode" || key === "rollbackSubmissionMode" || key === "rollbackDeploymentId") {
    if (skipped) return "information";
    const hasValue =
      key === "rollbackValidationMode"
        ? Boolean(context.rollback.validationMode)
        : key === "rollbackSubmissionMode"
          ? Boolean(context.rollback.submissionMode)
          : Boolean(context.rollback.deploymentId);
    return hasValue ? "success" : "information";
  }
  if (key === "rollbackFinalState") {
    if (skipped || !context.rollback.finalState) return "information";
    return context.rollback.finalState === "SUCCEEDED" ? "success" : "failure";
  }
  if (skipped || !context.rollback.finalOutcome) return "information";
  return context.rollback.finalOutcome === "SUCCEEDED" ? "success" : "failure";
}

function writeRunArtifact(context: RunContext, dryRun: boolean): void {
  const payload = {
    runId: context.runId,
    conformanceProfile: context.conformanceProfile,
    runVersion: context.runVersion,
    conflictVersion: context.conflictVersion,
    unregisteredVersion: context.unregisteredVersion,
    service: context.service,
    environment: context.environment,
    recipeId: context.recipeId,
    deploymentId: context.deployment.id ?? null,
    deploymentFinalState: context.deployment.finalState ?? null,
    deploymentFinalOutcome: context.deployment.finalOutcome ?? null,
    rollbackSkipped: context.rollback.skipped ?? false,
    rollbackSkipReason: context.rollback.skipReason ?? null,
    rollbackTargetVersion: context.rollback.targetVersion ?? null,
    rollbackTargetDeploymentId: context.rollback.targetDeploymentId ?? null,
    rollbackValidationMode: context.rollback.validationMode ?? null,
    rollbackSubmissionMode: context.rollback.submissionMode ?? null,
    rollbackDeploymentId: context.rollback.deploymentId ?? null,
    rollbackFinalState: context.rollback.finalState ?? null,
    rollbackFinalOutcome: context.rollback.finalOutcome ?? null,
    guardrailsMode: context.guardrails.mode,
    guardrailChecks: context.guardrails.checks,
    guardrailPassed: context.guardrails.checks.filter((c) => c.status === "PASSED").length,
    guardrailFailed: context.guardrails.checks.filter((c) => c.status === "FAILED").length,
    guardrailSkipped: context.guardrails.checks.filter((c) => c.status === "SKIPPED").length,
    guardrailContractSkipped: context.guardrails.checks.filter(
      (c) => c.classification === "CONTRACT" && c.status === "SKIPPED",
    ).length,
    dryRun,
    writtenAt: new Date().toISOString(),
  };
  writeFileSync(join(process.cwd(), LAST_RUN_ARTIFACT), JSON.stringify(payload, null, 2), "utf8");
  console.log(`[INFO] Wrote run artifact: ${LAST_RUN_ARTIFACT}`);
}

function printSummary(context: RunContext): void {
  console.log("\n[SUMMARY] Governance API run complete");
  printSummaryField("information", "runId", context.runId);
  printSummaryField("information", "conformanceProfile", context.conformanceProfile);
  printSummaryField("information", "runVersion", context.runVersion);
  printSummaryField("information", "conflictVersion", context.conflictVersion);
  printSummaryField("information", "unregisteredVersion", context.unregisteredVersion);
  printSummaryField("information", "service", context.service);
  printSummaryField("information", "environment", context.environment);
  printSummaryField("information", "recipeId", context.recipeId);

  printSummaryField(evaluateDeploymentField(context, "deploymentId"), "deploymentId", context.deployment.id ?? "n/a");
  printSummaryField(
    evaluateDeploymentField(context, "deploymentFinalState"),
    "deploymentFinalState",
    context.deployment.finalState ?? "n/a",
  );
  printSummaryField(
    evaluateDeploymentField(context, "deploymentFinalOutcome"),
    "deploymentFinalOutcome",
    context.deployment.finalOutcome ?? "n/a",
  );

  printSummaryField(evaluateRollbackField(context, "rollbackSkipped"), "rollbackSkipped", context.rollback.skipped ?? false);
  printSummaryField(
    evaluateRollbackField(context, "rollbackSkipReason"),
    "rollbackSkipReason",
    context.rollback.skipReason ?? "n/a",
  );
  printSummaryField(
    evaluateRollbackField(context, "rollbackTargetVersion"),
    "rollbackTargetVersion",
    context.rollback.targetVersion ?? "n/a",
  );
  printSummaryField(
    evaluateRollbackField(context, "rollbackTargetDeploymentId"),
    "rollbackTargetDeploymentId",
    context.rollback.targetDeploymentId ?? "n/a",
  );
  printSummaryField(
    evaluateRollbackField(context, "rollbackValidationMode"),
    "rollbackValidationMode",
    context.rollback.validationMode ?? "n/a",
  );
  printSummaryField(
    evaluateRollbackField(context, "rollbackSubmissionMode"),
    "rollbackSubmissionMode",
    context.rollback.submissionMode ?? "n/a",
  );
  printSummaryField(
    evaluateRollbackField(context, "rollbackDeploymentId"),
    "rollbackDeploymentId",
    context.rollback.deploymentId ?? "n/a",
  );
  printSummaryField(
    evaluateRollbackField(context, "rollbackFinalState"),
    "rollbackFinalState",
    context.rollback.finalState ?? "n/a",
  );
  printSummaryField(
    evaluateRollbackField(context, "rollbackFinalOutcome"),
    "rollbackFinalOutcome",
    context.rollback.finalOutcome ?? "n/a",
  );

  printSummaryField("information", "guardrailsMode", context.guardrails.mode);
  for (const check of context.guardrails.checks) {
    const kind = check.status === "PASSED" ? "success" : check.status === "FAILED" ? "failure" : "information";
    printEvaluatedLine(kind, `guardrail ${check.status} ${check.classification} ${check.id}`);
  }

  const timingResult = evaluateTimingsResult(context);
  printEvaluatedLine(timingResult.kind, timingResult.message);
}

async function main(): Promise<number> {
  loadLocalDotenv();
  for (const key of [
    "GOV_DXCP_UI_BASE",
    "GOV_DXCP_API_BASE",
    "GOV_AWS_REGION",
    "GOV_AUTH0_DOMAIN",
    "GOV_AUTH0_AUDIENCE",
    "GOV_DXCP_UI_CLIENT_ID",
    "GOV_ADMIN_USERNAME",
    "GOV_ADMIN_PASSWORD",
    "GOV_OWNER_USERNAME",
    "GOV_OWNER_PASSWORD",
    "GOV_OBSERVER_USERNAME",
    "GOV_OBSERVER_PASSWORD",
    "GOV_CI_CLIENT_ID",
    "GOV_CI_CLIENT_SECRET",
  ] as const) {
    requiredEnv(key);
  }

  const dryRun = hasArg("--dry-run");
  const tokens = {
    ci: await ensureCiToken(),
    admin: await getUserAccessTokenViaPlaywright("admin"),
    owner: await getUserAccessTokenViaPlaywright("owner"),
    observer: await getUserAccessTokenViaPlaywright("observer"),
  };
  const context = await buildRunContext(tokens);
  const strictConformance = isStrictConformance(context);

  let nonMemberOwnerToken: string | undefined;
  let nonMemberOwnerClaims: ReturnType<typeof decodeJwtClaims> | undefined;
  const nonMemberOwnerUsername = optionalEnv("GOV_NON_MEMBER_OWNER_USERNAME");
  const nonMemberOwnerPassword = optionalEnv("GOV_NON_MEMBER_OWNER_PASSWORD");
  if (!dryRun && strictConformance && (!nonMemberOwnerUsername || !nonMemberOwnerPassword)) {
    fail(
      "Strict conformance requires non-member owner scope probe credentials. Set GOV_NON_MEMBER_OWNER_USERNAME and GOV_NON_MEMBER_OWNER_PASSWORD.",
    );
  }
  if (nonMemberOwnerUsername && nonMemberOwnerPassword) {
    nonMemberOwnerToken = await getUserAccessTokenViaCustomCredentials(
      "non-member-owner",
      nonMemberOwnerUsername,
      nonMemberOwnerPassword,
    );
    nonMemberOwnerClaims = decodeJwtClaims(nonMemberOwnerToken);
  } else {
    console.log(
      "[INFO] Non-member owner deployment status probe skipped: GOV_NON_MEMBER_OWNER_USERNAME/PASSWORD not configured.",
    );
  }

  const claimsByRole = {
    admin: decodeJwtClaims(tokens.admin),
    owner: decodeJwtClaims(tokens.owner),
    observer: decodeJwtClaims(tokens.observer),
    ci: decodeJwtClaims(tokens.ci),
  };

  for (const role of ["admin", "owner", "observer", "ci"] as const) {
    const claims = claimsByRole[role];
    const me = await whoAmI(tokens[role]);
    printIdentity(role, tokens[role], claims, me);
  }

  if (nonMemberOwnerToken && nonMemberOwnerClaims) {
    const me = await whoAmI(nonMemberOwnerToken);
    printIdentity("non-member-owner", nonMemberOwnerToken, nonMemberOwnerClaims, me);
  }

  printRunPlan(context);

  if (dryRun) {
    console.log("[INFO] Dry-run requested; skipping phase 3 governance mutation steps.");
    printSummary(context);
    writeRunArtifact(context, true);
    return 0;
  }

  announceStep("Executing Phase 3 governance API assertions (fail-fast)");

  await stepR_roleAuthorizationChecks(context, tokens, claimsByRole);
  await stepA_proveCiGateNegative(context, tokens.owner, tokens.ci, tokens.admin);
  await stepB_configureCiPublishersAllowlist(context, tokens.admin, tokens.ci);
  await stepC_registerBuildHappyPath(context, tokens.ci);
  await stepD_sameIdempotencyKeyDifferentBodyReturnsConflict(context, tokens.ci);
  await stepE_deployEnforcementUnregisteredVersion(context, tokens.owner, tokens.admin);
  await stepF_deployHappyPath(context, tokens.owner, tokens.observer, nonMemberOwnerToken);
  await stepG_rollbackAfterDeploy(context, tokens.owner);
  await stepH_guardrailSpotChecks(context, tokens.owner);

  const failedGuardrails = context.guardrails.checks.filter((c) => c.status === "FAILED");
  const skippedContractGuardrails = context.guardrails.checks.filter(
    (c) => c.classification === "CONTRACT" && c.status === "SKIPPED",
  );
  if (strictConformance) {
    assert(
      skippedContractGuardrails.length === 0,
      `Contract guardrail checks were skipped in strict mode: ${skippedContractGuardrails.map((c) => c.id).join(", ")}`,
    );
  }
  assert(failedGuardrails.length === 0, `Guardrail checks failed: ${failedGuardrails.map((c) => c.id).join(", ")}`);
  assert(Object.keys(context.timings.stepStart).length === 9, "Expected 9 steps to run");
  printSummary(context);
  writeRunArtifact(context, false);
  return 0;
}

main().then(
  (code) => {
    process.exit(code);
  },
  (error) => {
    printEvaluatedLine("failure", `${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
