const style = require("./term/style.cjs");

const ANSI = {
  reset: style.reset(),
  green: style.ansi16Fg(32),
  red: style.ansi16Fg(31),
  yellow: style.ansi16Fg(33),
  blue: style.ansi16Fg(34),
  boldCyan: `${style.bold()}${style.ansi16Fg(36)}`,
};

function colorize(text, color) {
  return style.wrap(text, color);
}

function formatTag(label, color) {
  return colorize(`[${label}]`, color);
}

module.exports = {
  ANSI,
  colorize,
  formatTag,
  ...style,
};
