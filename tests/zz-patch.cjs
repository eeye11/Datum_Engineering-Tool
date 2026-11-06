const fs = require("fs");

const file = "src/shared/rendering/latex/source-model.js";
const text = fs.readFileSync(file, "utf8");

const start = text.indexOf("function colourOf(options, statementText) {");
const endMarker = "\n}\n\n/* `\\node at (x,y) {$text$};`";
const end = text.indexOf(endMarker, start);

if (start < 0 || end < 0) {
  console.error("markers not found", start, end);
  process.exit(1);
}

const replacement = [
  "function colourOf(options, statementText) {",
  "  /*",
  "   * A NAMED LOCAL COLOUR IS RESOLVED BEFORE A BARE HEX.",
  "   *",
  "   * DAETUM writes a hex colour as `daetumC112233`, and THAT NAME CONTAINS SIX",
  "   * HEX DIGITS (`C112233`) - so a hex matcher run first finds them inside the",
  "   * identifier and reports the wrong colour, or none at all. The definition a",
  "   * statement carries is the authority: when the option names a colour this",
  "   * statement defined, that definition IS the colour.",
  "   */",
  "  const defined = definedColour(statementText);",
  "",
  "  if (",
  "    defined &&",
  '    new RegExp(`(?:draw|color|fill)\\\\s*=\\\\s*\\\\{?\\\\s*${defined.name}(?![0-9A-Za-z])`).test(options || "")',
  "  ) {",
  "    return defined.value;",
  "  }",
  "",
  '  const direct = /#([0-9a-fA-F]{6})\\b|(?:draw|color|fill)\\s*=\\s*\\{?\\s*#?([0-9a-fA-F]{6})\\b/.exec(options || "");',
  "",
  "  if (direct) {",
  "    return `#${(direct[1] || direct[2]).toLowerCase()}`;",
  "  }",
  "",
  "  return null;",
  "}",
  "",
  "/*",
  " * The fill colour a statement names, when it fills with one.",
  " *",
  ' * `filled` alone says "this shape is filled"; the COLOUR is what a round trip',
  " * has to carry, and DAETUM writes it as `fill=<name>` joined to the same local",
  " * definition the stroke uses. `fill=none` is no fill at all.",
  " */",
  "function fillColourOf(options, statementText) {",
  '  const option = /\\bfill\\s*=\\s*\\{?\\s*([A-Za-z0-9#_]+)/.exec(options || "");',
  "",
  '  if (!option || option[1] === "none") {',
  "    return null;",
  "  }",
  "",
  "  const defined = definedColour(statementText);",
  "",
  "  if (defined && defined.name === option[1]) {",
  "    return defined.value;",
  "  }",
  "",
  "  return /^[0-9a-fA-F]{6}$/.test(option[1]) ? `#${option[1].toLowerCase()}` : null;",
  "}",
].join("\n");

fs.writeFileSync(file, text.slice(0, start) + replacement + text.slice(end));

console.log(
  "replaced colourOf; new length",
  (text.slice(0, start) + replacement + text.slice(end)).length,
);
