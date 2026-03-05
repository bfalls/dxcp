const fs = require("fs");
const path = require("path");

const RESET = "\x1b[0m";
const THEME_SPEC = JSON.parse(fs.readFileSync(path.join(__dirname, "theme_spec.json"), "utf8"));

/**
 * Quick manual verification:
 * - NO_COLOR=1 npm run govtest:dry
 * - FORCE_COLOR=1 npm run govtest:dry
 * - FORCE_COLOR=2 npm run govtest:dry
 * - FORCE_COLOR=3 npm run govtest:dry
 * - FORCE_ASCII=1 npm run govtest:dry
 * - FORCE_UNICODE=1 npm run govtest:dry
 * - npm run govtest:dry > .tmp-govtest.log
 */

function reset() {
  return RESET;
}

function bold() {
  return "\x1b[1m";
}

function dim() {
  return "\x1b[2m";
}

function ansi16Fg(code) {
  return `\x1b[${code}m`;
}

function ansi256Fg(n) {
  return `\x1b[38;5;${n}m`;
}

function truecolorFg(r, g, b) {
  return `\x1b[38;2;${r};${g};${b}m`;
}

function wrap(text, open, close) {
  if (!open) return text;
  return `${open}${text}${typeof close === "string" ? close : RESET}`;
}

function hasOwn(env, key) {
  return Object.prototype.hasOwnProperty.call(env, key);
}

function parseForceColor(raw) {
  if (typeof raw === "undefined") return undefined;
  const value = String(raw).trim().toLowerCase();
  if (!value) return 1;
  if (value === "true") return 1;
  if (value === "false") return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(0, Math.min(3, Math.floor(parsed)));
}

function detectCapabilities(opts = {}) {
  const env = opts.env ?? process.env;
  const isTTY = typeof opts.isTTY === "boolean" ? opts.isTTY : Boolean(process.stdout && process.stdout.isTTY);
  const term = String(opts.term ?? env.TERM ?? "").trim().toLowerCase();

  if (hasOwn(env, "NO_COLOR")) return { color: false, unicode: false };
  if (!isTTY) return { color: false, unicode: false };
  if (!term || term === "dumb") return { color: false, unicode: false };

  const force = parseForceColor(env.FORCE_COLOR);
  if (force === 0) return { color: false, unicode: true };
  if (typeof force === "number" && force > 0) return { color: true, unicode: true };

  return { color: true, unicode: true };
}

function detectColorLevel(opts = {}) {
  const env = opts.env ?? process.env;
  const caps = detectCapabilities(opts);
  if (!caps.color) return 0;

  const force = parseForceColor(env.FORCE_COLOR);
  const term = String(opts.term ?? env.TERM ?? "").trim();
  const colorTerm = String(opts.colorTerm ?? env.COLORTERM ?? "").trim();

  let detected = 1;
  if (/(truecolor|24bit)/i.test(colorTerm)) {
    detected = 3;
  } else if (/256color/i.test(term)) {
    detected = 2;
  }

  if (typeof force === "number" && force > 0) {
    return Math.max(detected, force);
  }
  return detected;
}

function detectSymbolMode(opts = {}) {
  return detectCapabilities(opts).unicode ? "unicode" : "ascii";
}

function makeSymbols(mode) {
  if (mode === "ascii") {
    return { ...THEME_SPEC.symbols.ascii, info: THEME_SPEC.symbols.info };
  }
  return { ...THEME_SPEC.symbols.unicode, info: THEME_SPEC.symbols.info };
}

function joinCodes(...codes) {
  return codes.filter(Boolean).join("");
}

function makeKindOpen(level, kind) {
  if (level === 0) return "";
  const palette = THEME_SPEC.palette[String(level)] || null;
  const token = palette ? palette[kind] : null;
  if (!token) return "";
  const codes = [];
  if (token.bold) codes.push(bold());
  if (token.dim) codes.push(dim());
  if (typeof token.ansi16 === "number") {
    codes.push(ansi16Fg(token.ansi16));
  } else if (typeof token.ansi256 === "number") {
    codes.push(ansi256Fg(token.ansi256));
  } else if (Array.isArray(token.rgb) && token.rgb.length === 3) {
    codes.push(truecolorFg(token.rgb[0], token.rgb[1], token.rgb[2]));
  }
  return joinCodes(...codes);
}

function makeTheme(level, symbolsInput) {
  const symbolMode = symbolsInput ? (symbolsInput.success === "+" ? "ascii" : "unicode") : detectSymbolMode();
  const symbolsMap = symbolsInput ?? makeSymbols(symbolMode);
  const apply = (kind, text) => wrap(text, makeKindOpen(level, kind));
  const symbols = {
    info: apply("info", symbolsMap.info),
    step: apply("step", `[${symbolsMap.step}]`),
    substep: apply("substep", `  [${symbolsMap.substep}]`),
    success: apply("success", `[${symbolsMap.success}]`),
    fail: apply("fail", `[${symbolsMap.fail}]`),
  };

  return {
    level,
    symbolMode,
    symbolMap: symbolsMap,
    symbols,
    title(text) {
      return apply("title", text);
    },
    info(text) {
      return apply("info", text);
    },
    step(text) {
      return apply("step", text);
    },
    substep(text) {
      return apply("substep", text);
    },
    success(text) {
      return apply("success", text);
    },
    fail(text) {
      return apply("fail", text);
    },
  };
}

module.exports = {
  detectCapabilities,
  detectColorLevel,
  detectSymbolMode,
  makeSymbols,
  wrap,
  reset,
  ansi16Fg,
  ansi256Fg,
  truecolorFg,
  bold,
  dim,
  makeTheme,
};
