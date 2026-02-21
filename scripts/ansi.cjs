const ANSI = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  boldCyan: "\x1b[1;36m",
};

function colorize(text, color) {
  return `${color}${text}${ANSI.reset}`;
}

function formatTag(label, color) {
  return colorize(`[${label}]`, color);
}

module.exports = {
  ANSI,
  colorize,
  formatTag,
};
