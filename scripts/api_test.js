const { spawnSync } = require("child_process");
const path = require("path");

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const pytestArgs = ["-m", "pytest", verbose ? "-vv" : "-q", "-p", "no:cacheprovider"];
const cwd = path.join(__dirname, "..", "dxcp-api");

const candidates =
  process.platform === "win32"
    ? [
        { cmd: "py", args: ["-3.11"] },
        { cmd: "py", args: ["-3"] },
        { cmd: "python", args: [] },
      ]
    : [
        { cmd: "python3", args: [] },
        { cmd: "python", args: [] },
      ];

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
