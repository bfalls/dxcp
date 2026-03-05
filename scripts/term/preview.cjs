#!/usr/bin/env node

const { detectColorLevel, detectSymbolMode, makeSymbols, makeTheme } = require("./style.cjs");

function printHelp() {
  console.log("DXCP Terminal Theme Preview");
  console.log("");
  console.log("Usage:");
  console.log("  node scripts/term/preview.cjs [options]");
  console.log("");
  console.log("Options:");
  console.log("  --help                     Show this help.");
  console.log("  --color-level <0|1|2|3>   Force a color level.");
  console.log("  --symbol-mode <unicode|ascii>  Force symbol mode.");
  console.log("  --force-color <0|1|2|3>   Simulate FORCE_COLOR.");
  console.log("  --no-color                Simulate NO_COLOR=1.");
  console.log("  --force-ascii             Simulate FORCE_ASCII=1.");
  console.log("  --force-unicode           Simulate FORCE_UNICODE=1.");
  console.log("  --term <value>            Override TERM for detection.");
  console.log("  --colorterm <value>       Override COLORTERM for detection.");
  console.log("  --lang <value>            Override LANG for symbol detection.");
  console.log("  --lc-all <value>          Override LC_ALL for symbol detection.");
  console.log("  --lc-ctype <value>        Override LC_CTYPE for symbol detection.");
  console.log("  --tty <true|false>        Override TTY detection.");
  console.log("  --show-detected           Show terminal detection details.");
  console.log("  --matrix                  Print all color levels (0-3) with current symbols.");
  console.log("");
  console.log("Customize:");
  console.log("  Update scripts/term/theme_spec.json to change palette colors and symbols.");
  console.log("");
  console.log("Examples:");
  console.log("  npm run term:preview");
  console.log("  npm run term:preview -- --color-level 1 --symbol-mode ascii");
  console.log("  npm run term:preview -- --force-color 3 --force-unicode");
  console.log("  npm run term:preview -- --no-color --force-ascii --tty false");
  console.log("  npm run term:preview -- --lang en_US.UTF-8 --lc-all C --lc-ctype en_US.UTF-8");
  console.log("  npm run term:preview -- --show-detected");
}

function fail(message) {
  console.error(`[preview] ${message}`);
  process.exit(1);
}

function parseBool(value, name) {
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  fail(`Invalid ${name}: expected true|false, got "${value}"`);
}

function parseLevel(value, name) {
  const n = Number(value);
  if (Number.isInteger(n) && n >= 0 && n <= 3) {
    return n;
  }
  fail(`Invalid ${name}: expected 0|1|2|3, got "${value}"`);
}

function parseMode(value, name) {
  const mode = String(value).trim().toLowerCase();
  if (mode === "unicode" || mode === "ascii") {
    return mode;
  }
  fail(`Invalid ${name}: expected unicode|ascii, got "${value}"`);
}

function parseArgs(argv) {
  const opts = {
    help: false,
    matrix: false,
    colorLevel: undefined,
    symbolMode: undefined,
    forceColor: undefined,
    noColor: false,
    forceAscii: false,
    forceUnicode: false,
    term: undefined,
    colorTerm: undefined,
    lang: undefined,
    lcAll: undefined,
    lcCtype: undefined,
    tty: undefined,
    showDetected: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      opts.help = true;
      continue;
    }
    if (token === "--matrix") {
      opts.matrix = true;
      continue;
    }
    if (token === "--show-detected") {
      opts.showDetected = true;
      continue;
    }
    if (token === "--no-color") {
      opts.noColor = true;
      continue;
    }
    if (token === "--force-ascii") {
      opts.forceAscii = true;
      continue;
    }
    if (token === "--force-unicode") {
      opts.forceUnicode = true;
      continue;
    }
    if (token === "--color-level") {
      opts.colorLevel = parseLevel(argv[++i], "--color-level");
      continue;
    }
    if (token === "--symbol-mode") {
      opts.symbolMode = parseMode(argv[++i], "--symbol-mode");
      continue;
    }
    if (token === "--force-color") {
      opts.forceColor = String(parseLevel(argv[++i], "--force-color"));
      continue;
    }
    if (token === "--term") {
      opts.term = String(argv[++i] ?? "");
      continue;
    }
    if (token === "--colorterm") {
      opts.colorTerm = String(argv[++i] ?? "");
      continue;
    }
    if (token === "--lang") {
      opts.lang = String(argv[++i] ?? "");
      continue;
    }
    if (token === "--lc-all") {
      opts.lcAll = String(argv[++i] ?? "");
      continue;
    }
    if (token === "--lc-ctype") {
      opts.lcCtype = String(argv[++i] ?? "");
      continue;
    }
    if (token === "--tty") {
      opts.tty = parseBool(argv[++i], "--tty");
      continue;
    }
    fail(`Unknown argument: ${token}`);
  }
  return opts;
}

function makeEnv(baseEnv, opts) {
  const env = { ...baseEnv };
  if (opts.noColor) env.NO_COLOR = "1";
  if (typeof opts.forceColor === "string") env.FORCE_COLOR = opts.forceColor;
  if (opts.forceAscii) env.FORCE_ASCII = "1";
  if (opts.forceUnicode) env.FORCE_UNICODE = "1";
  if (typeof opts.term === "string") env.TERM = opts.term;
  if (typeof opts.colorTerm === "string") env.COLORTERM = opts.colorTerm;
  if (typeof opts.lang === "string") env.LANG = opts.lang;
  if (typeof opts.lcAll === "string") env.LC_ALL = opts.lcAll;
  if (typeof opts.lcCtype === "string") env.LC_CTYPE = opts.lcCtype;
  return env;
}

function printTheme(theme) {
  console.log(theme.title("Terminal Theme Preview"));
  console.log(`${theme.symbols.info} Info line (metadata, plan, notes)`);
  console.log(`${theme.symbols.step} Step line (major phase)`);
  console.log(`${theme.symbols.substep} Substep line (detail item)`);
  console.log(`${theme.symbols.success} Success line`);
  console.log(`${theme.symbols.fail} Failure line`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return 0;
  }

  const env = makeEnv(process.env, opts);
  const detectionOpts = {
    isTTY: typeof opts.tty === "boolean" ? opts.tty : undefined,
    env,
    term: opts.term,
    colorTerm: opts.colorTerm,
  };
  const symbolDetectionOpts = {
    isTTY: typeof opts.tty === "boolean" ? opts.tty : undefined,
    env,
    term: opts.term,
    locale: opts.lang || opts.lcAll || opts.lcCtype,
  };

  const detectedLevel = detectColorLevel(detectionOpts);
  const detectedSymbolMode = detectSymbolMode(symbolDetectionOpts);
  const colorLevel = typeof opts.colorLevel === "number" ? opts.colorLevel : detectedLevel;
  const symbolMode = opts.symbolMode || detectedSymbolMode;
  const symbols = makeSymbols(symbolMode);
  const theme = makeTheme(colorLevel, symbols);

  if (opts.showDetected) {
    console.log("Detected terminal:");
    console.log(`  tty=${typeof opts.tty === "boolean" ? opts.tty : Boolean(process.stdout && process.stdout.isTTY)}`);
    console.log(`  TERM=${env.TERM ?? "<unset>"}`);
    console.log(`  COLORTERM=${env.COLORTERM ?? "<unset>"}`);
    console.log(`  LANG=${env.LANG ?? "<unset>"}`);
    console.log(`  LC_ALL=${env.LC_ALL ?? "<unset>"}`);
    console.log(`  LC_CTYPE=${env.LC_CTYPE ?? "<unset>"}`);
    console.log(`  detectedColorLevel=${detectedLevel}`);
    console.log(`  detectedSymbolMode=${detectedSymbolMode}`);
    console.log("");
  }

  console.log("Resolved:");
  console.log(`  colorLevel=${colorLevel} (detected=${detectedLevel})`);
  console.log(`  symbolMode=${symbolMode} (detected=${detectedSymbolMode})`);
  console.log(`  tty=${typeof opts.tty === "boolean" ? opts.tty : Boolean(process.stdout && process.stdout.isTTY)}`);
  console.log("");

  if (opts.matrix) {
    for (const level of [0, 1, 2, 3]) {
      const matrixTheme = makeTheme(level, symbols);
      console.log(`level ${level}:`);
      printTheme(matrixTheme);
      console.log("");
    }
    return 0;
  }

  printTheme(theme);
  return 0;
}

process.exit(main());
