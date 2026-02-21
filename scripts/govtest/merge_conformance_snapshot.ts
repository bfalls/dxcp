#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type RuntimeSnapshot = {
  contract_version?: string;
  conformance_profile?: string;
  summary?: {
    total?: number;
    passed?: number;
    failed?: number;
    skipped?: number;
    required_failed?: number;
  };
  checks?: Array<{
    id?: string;
    status?: string;
    classification?: string;
    required?: boolean;
    detail?: string;
  }>;
};

type UnitSnapshot = {
  contract_version?: string;
  summary?: {
    total?: number;
    passed?: number;
    failed?: number;
    skipped?: number;
  };
  tests?: Array<{
    nodeid?: string;
    outcome?: string;
    duration_seconds?: number;
  }>;
};

function parseArgs(argv: string[]): {
  runtimePath: string;
  unitPath: string;
  outputPath: string;
  allowMissingRuntime: boolean;
  allowMissingUnit: boolean;
} {
  const config = {
    runtimePath: ".govtest.contract.snapshot.json",
    unitPath: ".dxcpapi.governance.snapshot.json",
    outputPath: ".governance.conformance.snapshot.json",
    allowMissingRuntime: false,
    allowMissingUnit: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--runtime" && argv[i + 1]) {
      config.runtimePath = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--unit" && argv[i + 1]) {
      config.unitPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--output" && argv[i + 1]) {
      config.outputPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--allow-missing-runtime") {
      config.allowMissingRuntime = true;
      continue;
    }
    if (token === "--allow-missing-unit") {
      config.allowMissingUnit = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  return config;
}

function readJsonFile<T>(path: string): T {
  const text = readFileSync(path, "utf8");
  return JSON.parse(text) as T;
}

function readContractVersionFromDoc(): string {
  const docPath = join(process.cwd(), "docs", "governance-tests", "GOVERNANCE_CONTRACT.md");
  if (!existsSync(docPath)) {
    return "unknown";
  }
  const text = readFileSync(docPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(/^GovernanceContractVersion\s*:\s*([A-Za-z0-9._-]+)\s*$/i);
    if (match?.[1]) {
      return match[1];
    }
  }
  return "unknown";
}

function normalizeRuntimeSummary(runtime: RuntimeSnapshot | null): {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  required_failed: number;
} {
  const checks = Array.isArray(runtime?.checks) ? runtime!.checks! : [];
  const requiredFailedFromChecks = checks.filter((check) => {
    const required = typeof check.required === "boolean" ? check.required : check.classification === "CONTRACT";
    return required && check.status === "FAILED";
  }).length;
  return {
    total: Number(runtime?.summary?.total ?? checks.length ?? 0),
    passed: Number(runtime?.summary?.passed ?? checks.filter((check) => check.status === "PASSED").length),
    failed: Number(runtime?.summary?.failed ?? checks.filter((check) => check.status === "FAILED").length),
    skipped: Number(runtime?.summary?.skipped ?? checks.filter((check) => check.status === "SKIPPED").length),
    required_failed: Number(runtime?.summary?.required_failed ?? requiredFailedFromChecks),
  };
}

function normalizeUnitSummary(unit: UnitSnapshot | null): {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
} {
  const tests = Array.isArray(unit?.tests) ? unit!.tests! : [];
  return {
    total: Number(unit?.summary?.total ?? tests.length ?? 0),
    passed: Number(unit?.summary?.passed ?? tests.filter((test) => test.outcome === "passed").length),
    failed: Number(unit?.summary?.failed ?? tests.filter((test) => test.outcome === "failed").length),
    skipped: Number(unit?.summary?.skipped ?? tests.filter((test) => test.outcome === "skipped").length),
  };
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  const runtimePath = join(process.cwd(), args.runtimePath);
  const unitPath = join(process.cwd(), args.unitPath);
  const outputPath = join(process.cwd(), args.outputPath);

  const runtimeExists = existsSync(runtimePath);
  const unitExists = existsSync(unitPath);

  if (!runtimeExists && !args.allowMissingRuntime) {
    throw new Error(`Missing runtime snapshot: ${runtimePath}`);
  }
  if (!unitExists && !args.allowMissingUnit) {
    throw new Error(`Missing unit snapshot: ${unitPath}`);
  }

  const runtime = runtimeExists ? readJsonFile<RuntimeSnapshot>(runtimePath) : null;
  const unit = unitExists ? readJsonFile<UnitSnapshot>(unitPath) : null;

  const runtimeSummary = normalizeRuntimeSummary(runtime);
  const unitSummary = normalizeUnitSummary(unit);
  const runtimeChecks = Array.isArray(runtime?.checks) ? runtime!.checks! : [];
  const unitTests = Array.isArray(unit?.tests) ? unit!.tests! : [];
  const docVersion = readContractVersionFromDoc();
  const runtimeVersion = runtime?.contract_version ?? "unknown";
  const unitVersion = unit?.contract_version ?? "unknown";

  if (runtimeVersion !== "unknown" && unitVersion !== "unknown" && runtimeVersion !== unitVersion) {
    throw new Error(
      `Contract version mismatch between runtime and unit snapshots: runtime=${runtimeVersion}, unit=${unitVersion}`,
    );
  }
  if (docVersion !== "unknown") {
    if (runtimeVersion !== "unknown" && runtimeVersion !== docVersion) {
      throw new Error(`Runtime snapshot contract_version ${runtimeVersion} does not match contract doc version ${docVersion}`);
    }
    if (unitVersion !== "unknown" && unitVersion !== docVersion) {
      throw new Error(`Unit snapshot contract_version ${unitVersion} does not match contract doc version ${docVersion}`);
    }
  }

  const runtimeStrictPassed =
    runtime?.conformance_profile === "strict" &&
    runtimeSummary.required_failed === 0 &&
    runtimeSummary.failed === 0;
  const unitPassed = unitSummary.failed === 0;
  const overallStatus = runtimeStrictPassed && unitPassed ? "PASS" : "FAIL";

  const governanceContractVersion =
    docVersion !== "unknown"
      ? docVersion
      : runtime?.contract_version && runtime.contract_version !== "unknown"
        ? runtime.contract_version
        : unit?.contract_version && unit.contract_version !== "unknown"
          ? unit.contract_version
          : "unknown";

  const payload: { [key: string]: JsonValue } = {
    governance_contract_version: governanceContractVersion,
    timestamp: new Date().toISOString(),
    runtime_conformance: {
      summary: runtimeSummary,
      checks: runtimeChecks,
    },
    unit_conformance: {
      summary: unitSummary,
      tests: unitTests,
    },
    overall_conformance: {
      status: overallStatus,
      runtime_strict_passed: runtimeStrictPassed,
      unit_passed: unitPassed,
    },
    traceability: {
      runtime_snapshot_path: args.runtimePath,
      unit_snapshot_path: args.unitPath,
      merged_snapshot_path: args.outputPath,
    },
  };

  writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`[INFO] Wrote merged conformance snapshot: ${args.outputPath}`);
  console.log(
    `[INFO] GovernanceContractVersion taken from docs/governance-tests/GOVERNANCE_CONTRACT.md: ${governanceContractVersion}`,
  );

  if (overallStatus !== "PASS") {
    console.error("[ERROR] Governance conformance status is FAIL.");
    return 1;
  }
  return 0;
}

try {
  process.exit(main());
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[ERROR] ${message}`);
  process.exit(1);
}
