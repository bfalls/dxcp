#!/usr/bin/env node

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  announceStep,
  assert,
  buildRunContext,
  decodeJwtClaims,
  ensureTokens,
  loadLocalDotenv,
  printIdentity,
  printRunPlan,
  whoAmI,
} from "./common.ts";
import type { RunContext } from "./types.ts";
import { stepA_proveCiGateNegative } from "./steps/stepA_gate_negative.ts";
import { stepB_configureCiPublishersAllowlist } from "./steps/stepB_configure_ci_publishers.ts";
import { stepC_registerBuildHappyPath } from "./steps/stepC_register_build.ts";
import { stepD_conflictDifferentGitShaSameIdempotencyKey } from "./steps/stepD_conflict.ts";
import { stepE_deployEnforcementUnregisteredVersion } from "./steps/stepE_deploy_enforcement.ts";
import { stepF_deployHappyPath } from "./steps/stepF_deploy_happy.ts";

const LAST_RUN_ARTIFACT = ".govtest.last-run.json";

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

function writeRunArtifact(context: RunContext, dryRun: boolean): void {
  const payload = {
    runId: context.runId,
    runVersion: context.runVersion,
    conflictVersion: context.conflictVersion,
    unregisteredVersion: context.unregisteredVersion,
    service: context.service,
    environment: context.environment,
    recipeId: context.recipeId,
    deploymentId: context.deployment.id ?? null,
    deploymentFinalState: context.deployment.finalState ?? null,
    deploymentFinalOutcome: context.deployment.finalOutcome ?? null,
    dryRun,
    writtenAt: new Date().toISOString(),
  };
  writeFileSync(join(process.cwd(), LAST_RUN_ARTIFACT), JSON.stringify(payload, null, 2), "utf8");
  console.log(`[INFO] Wrote run artifact: ${LAST_RUN_ARTIFACT}`);
}

function printSummary(context: RunContext): void {
  console.log("\n[SUMMARY] Governance API run complete");
  console.log(`runId=${context.runId}`);
  console.log(`runVersion=${context.runVersion}`);
  console.log(`conflictVersion=${context.conflictVersion}`);
  console.log(`unregisteredVersion=${context.unregisteredVersion}`);
  console.log(`service=${context.service} environment=${context.environment} recipeId=${context.recipeId}`);
  console.log(`deploymentId=${context.deployment.id ?? "n/a"}`);
  console.log(`deploymentFinalState=${context.deployment.finalState ?? "n/a"}`);
  console.log(`deploymentFinalOutcome=${context.deployment.finalOutcome ?? "n/a"}`);
}

async function main(): Promise<number> {
  loadLocalDotenv();

  const dryRun = hasArg("--dry-run");
  const tokens = await ensureTokens();

  for (const role of ["admin", "owner", "observer", "ci"] as const) {
    const claims = decodeJwtClaims(tokens[role]);
    const me = await whoAmI(tokens[role]);
    printIdentity(role, tokens[role], claims, me);
  }

  const context = await buildRunContext(tokens);
  printRunPlan(context);

  if (dryRun) {
    console.log("[INFO] Dry-run requested; skipping phase 3 governance mutation steps.");
    printSummary(context);
    writeRunArtifact(context, true);
    return 0;
  }

  announceStep("Executing Phase 3 governance API assertions (fail-fast)");

  await stepA_proveCiGateNegative(context, tokens.owner);
  await stepB_configureCiPublishersAllowlist(context, tokens.admin, tokens.ci);
  await stepC_registerBuildHappyPath(context, tokens.ci);
  await stepD_conflictDifferentGitShaSameIdempotencyKey(context, tokens.ci);
  await stepE_deployEnforcementUnregisteredVersion(context, tokens.owner);
  await stepF_deployHappyPath(context, tokens.owner);

  assert(Object.keys(context.timings.stepStart).length === 6, "Expected 6 steps to run");
  printSummary(context);
  writeRunArtifact(context, false);
  return 0;
}

main().then(
  (code) => {
    process.exit(code);
  },
  (error) => {
    console.error(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
