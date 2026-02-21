#!/usr/bin/env node

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const forwardedArgs = process.argv.slice(2);

function runOrExit(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.error && result.error.code === "ENOENT") {
    return { ok: false, code: 1 };
  }
  if (typeof result.status === "number" && result.status === 0) {
    return { ok: true, code: 0 };
  }
  return { ok: false, code: typeof result.status === "number" ? result.status : 1 };
}

function findPython() {
  const candidates = [];
  const explicitPython = process.env.DXCP_PYTHON;
  if (explicitPython) {
    candidates.push({ cmd: explicitPython, args: [] });
  }
  const venvPath = process.env.DXCP_VENV || process.env.VIRTUAL_ENV;
  if (venvPath) {
    const venvPython =
      process.platform === "win32"
        ? path.join(venvPath, "Scripts", "python.exe")
        : path.join(venvPath, "bin", "python");
    if (fs.existsSync(venvPython)) {
      candidates.push({ cmd: venvPython, args: [] });
    }
  }
  if (process.platform === "win32") {
    candidates.push({ cmd: "py", args: ["-3.11"] });
    candidates.push({ cmd: "py", args: ["-3"] });
    candidates.push({ cmd: "python", args: [] });
  } else {
    candidates.push({ cmd: "python3", args: [] });
    candidates.push({ cmd: "python", args: [] });
  }

  for (const candidate of candidates) {
    const probe = spawnSync(candidate.cmd, [...candidate.args, "--version"], {
      cwd: repoRoot,
      stdio: "ignore",
      shell: false,
    });
    if (!probe.error && probe.status === 0) {
      return candidate;
    }
  }
  return null;
}

function main() {
  console.log("\x1b[1;36mRunning Unified Governance Conformance (unit + runtime + merge)\x1b[0m");

  const python = findPython();
  if (!python) {
    console.error("Unable to locate a usable Python interpreter for governance contract unit tests.");
    return 1;
  }

  const unit = runOrExit(python.cmd, [...python.args, "dxcp-api/scripts/governance_contract_unit.py"]);
  if (!unit.ok) {
    return unit.code;
  }

  const runtime = runOrExit("node", ["--experimental-strip-types", "scripts/govtest/run.ts", ...forwardedArgs]);
  if (!runtime.ok) {
    return runtime.code;
  }

  const merged = runOrExit("node", ["--experimental-strip-types", "scripts/govtest/merge_conformance_snapshot.ts"]);
  if (!merged.ok) {
    return merged.code;
  }

  return 0;
}

process.exit(main());
