import { spawnSync } from "node:child_process";

const uiRoot = process.cwd();
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const forwardedArgs = process.argv.slice(2);
const runtimeOnlyArgs = new Set(["--strict", "--diagnostic", "--dry-run"]);
const playwrightKnownFlags = new Set(["--ui", "--headed", "--debug"]);
const playwrightValuePrefixes = ["--retries=", "--video=", "--screenshot=", "--grep=", "--grep-invert=", "--workers="];

function splitForwardedArgs(args) {
  const runtimeArgs = [];
  const playwrightArgs = [];
  for (const arg of args) {
    if (runtimeOnlyArgs.has(arg)) {
      runtimeArgs.push(arg);
      continue;
    }
    if (playwrightKnownFlags.has(arg) || playwrightValuePrefixes.some((prefix) => arg.startsWith(prefix))) {
      playwrightArgs.push(arg);
    }
  }
  return { runtimeArgs, playwrightArgs };
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.error) {
    throw result.error;
  }
  return typeof result.status === "number" ? result.status : 1;
}

const { runtimeArgs, playwrightArgs } = splitForwardedArgs(forwardedArgs);
const runtimeStatus = run(npmCommand, ["run", "e2e-gov:runtime", ...(runtimeArgs.length > 0 ? ["--", ...runtimeArgs] : [])], uiRoot);
const playwrightStatus = run(
  npmCommand,
  ["run", "e2e-gov:playwright", ...(playwrightArgs.length > 0 ? ["--", ...playwrightArgs] : [])],
  uiRoot,
);
process.exit(runtimeStatus !== 0 ? runtimeStatus : playwrightStatus);
