const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const pytestArgs = ["-m", "pytest", verbose ? "-vv" : "-q", "-p", "no:cacheprovider"];
const cwd = path.join(__dirname, "..", "dxcp-api");

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

let lastResult = null;
for (const candidate of candidates) {
  const result = spawnSync(candidate.cmd, [...candidate.args, ...pytestArgs], {
    cwd,
    stdio: "inherit",
    shell: false,
  });
  lastResult = result;
  if (result.error && result.error.code === "ENOENT") {
    continue;
  }
  process.exit(result.status === null ? 1 : result.status);
}

if (lastResult && lastResult.error) {
  console.error(`Unable to locate a usable Python interpreter. Last error: ${lastResult.error.message}`);
}
process.exit(1);
