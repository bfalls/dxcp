const assert = require("node:assert/strict");
const { detectCapabilities, detectColorLevel, detectSymbolMode, makeSymbols } = require("../term/style.cjs");

function run() {
  assert.equal(
    detectColorLevel({
      isTTY: true,
      env: { NO_COLOR: "1", FORCE_COLOR: "3", TERM: "xterm-256color", COLORTERM: "truecolor" },
    }),
    0,
    "NO_COLOR should force level 0",
  );

  assert.equal(
    detectColorLevel({
      isTTY: true,
      env: { FORCE_COLOR: "0", TERM: "xterm-256color" },
    }),
    0,
    "FORCE_COLOR=0 should force level 0",
  );

  assert.deepEqual(
    detectCapabilities({
      isTTY: true,
      env: { NO_COLOR: "1", TERM: "xterm-256color" },
    }),
    { color: false, unicode: false },
    "NO_COLOR should disable color and unicode symbols",
  );

  assert.deepEqual(
    detectCapabilities({
      isTTY: false,
      env: { TERM: "xterm-256color" },
    }),
    { color: false, unicode: false },
    "non-TTY should disable color and unicode symbols",
  );

  assert.deepEqual(
    detectCapabilities({
      isTTY: true,
      env: { TERM: "dumb", FORCE_COLOR: "1" },
    }),
    { color: false, unicode: false },
    "TERM=dumb should disable color and unicode symbols",
  );

  assert.deepEqual(
    detectCapabilities({
      isTTY: true,
      env: { TERM: "xterm-256color", FORCE_COLOR: "1" },
    }),
    { color: true, unicode: true },
    "FORCE_COLOR should force color",
  );

  assert.equal(
    detectColorLevel({
      isTTY: false,
      env: { FORCE_COLOR: "3", TERM: "xterm-256color", COLORTERM: "truecolor" },
    }),
    0,
    "non-TTY should force level 0",
  );

  assert.equal(
    detectColorLevel({
      isTTY: true,
      env: { TERM: "xterm-kitty", COLORTERM: "truecolor" },
    }),
    3,
    "COLORTERM=truecolor should detect level 3",
  );

  assert.equal(
    detectColorLevel({
      isTTY: true,
      env: { TERM: "xterm-256color" },
    }),
    2,
    "TERM=*-256color should detect level 2",
  );

  assert.equal(
    detectColorLevel({
      isTTY: true,
      env: { TERM: "xterm" },
    }),
    1,
    "normal TERM should detect level 1",
  );

  assert.equal(
    detectColorLevel({
      isTTY: true,
      env: {},
    }),
    0,
    "missing TERM should detect level 0",
  );

  assert.equal(
    detectColorLevel({
      isTTY: true,
      env: { TERM: "xterm", FORCE_COLOR: "2" },
    }),
    2,
    "FORCE_COLOR=2 should raise minimum to level 2",
  );

  assert.equal(
    detectColorLevel({
      isTTY: true,
      env: { TERM: "dumb", FORCE_COLOR: "1" },
    }),
    0,
    "TERM=dumb should disable color even when FORCE_COLOR=1",
  );

  assert.equal(
    detectSymbolMode({
      isTTY: true,
      env: { NO_COLOR: "1", TERM: "xterm-256color" },
    }),
    "ascii",
    "NO_COLOR should use ascii symbols",
  );

  assert.equal(
    detectSymbolMode({
      isTTY: true,
      env: { TERM: "xterm-256color", FORCE_COLOR: "1" },
    }),
    "unicode",
    "TTY + color enabled should use unicode symbols",
  );

  assert.equal(
    detectSymbolMode({
      isTTY: false,
      env: { TERM: "xterm-256color", FORCE_COLOR: "1" },
    }),
    "ascii",
    "non-TTY should use ascii symbols",
  );

  assert.equal(
    detectSymbolMode({
      isTTY: true,
      env: { TERM: "dumb", FORCE_COLOR: "1" },
    }),
    "ascii",
    "TERM=dumb should use ascii symbols",
  );

  assert.equal(makeSymbols("unicode").success, String.fromCodePoint(0x2713), "unicode success symbol should be checkmark");
  assert.equal(makeSymbols("ascii").success, "+", "ascii success symbol should be plus");

  console.log("term_style.test: all assertions passed");
}

run();
