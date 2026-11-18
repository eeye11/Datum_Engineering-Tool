/*
 * ========================================================
 * THE MATH EXPRESSION TYPESETTER
 * ========================================================
 *
 * The requirement lists the exact expressions a Heat Transfer label must render.
 * They are checked here against the SHIPPED parser, so "T_1 draws as T with a
 * subscript" is a property rather than a hope.
 *
 * The parser is shared: the canvas turns its runs into <tspan>, the Features
 * field shows the source, and the Source tab writes TeX - so these checks cover
 * all three by covering the one parse they all read.
 */
const path = require("path");
const { JSDOM } = require("jsdom");

const projectRoot = path.join(__dirname, "..");

let pass = 0;
let fail = 0;

const check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`);
  }
};

const { createHarness } = require("./support/harness-renderer.cjs");

createHarness(projectRoot, JSDOM, require);

const { loadModule } = require("./helpers/source-path.cjs");

const math = loadModule("math-expression.js");

const parse = math.parseMathExpression;
const plain = math.mathExpressionToPlainText;

/* The runs of one type, for a concise assertion. */
const runsOf = (expression, type) =>
  parse(expression).filter((run) => run.type === type);

/* ---------------------------------------------------------- subscripts */

console.log("\nSubscripts");
console.log("----------");

for (const [expression, base, script] of [
  ["T_1", "T", "1"],
  ["T_s", "T", "s"],
  ["T_\\infty", "T", "∞"],
  ["T_{sur}", "T", "sur"],
  ["R_{th}", "R", "th"],
  ["T_{s,1}", "T", "s,1"],
]) {
  const runs = parse(expression);
  const text = runs
    .filter((r) => r.type === "text")
    .map((r) => r.value)
    .join("");
  const subs = runsOf(expression, "sub");

  check(
    `${expression} renders as "${base}" with subscript "${script}"`,
    text === base && subs.length === 1 && subs[0].value === script,
    JSON.stringify(runs),
  );
}

check(
  "multi-character subscripts are grouped by braces",
  runsOf("R_{th,1}", "sub")[0].value === "th,1",
);

/* ---------------------------------------------------------- superscripts */

console.log("\nSuperscripts");
console.log("-------------");

for (const [expression, base, script] of [
  ["T^2", "T", "2"],
  ["x^3", "x", "3"],
  ["m^2", "m", "2"],
  ["10^{-3}", "10", "-3"],
]) {
  const runs = parse(expression);
  const text = runs
    .filter((r) => r.type === "text")
    .map((r) => r.value)
    .join("");
  const sups = runsOf(expression, "sup");

  check(
    `${expression} renders as "${base}" with superscript "${script}"`,
    text === base && sups.length === 1 && sups[0].value === script,
    JSON.stringify(runs),
  );
}

check(
  "a signed superscript keeps its sign",
  runsOf("10^{-3}", "sup")[0].value === "-3",
);

/* ---------------------------------------------------------- combined */

console.log("\nSubscript and superscript together");
console.log("----------------------------------");

for (const expression of [
  "T_s^4",
  "T_{s,1}^{max}",
  "q''_{in}",
  "q''_{out}",
  "R_{th,1}",
]) {
  const runs = parse(expression);

  check(
    `${expression} parses without leftover markup`,
    runs.every((run) => !/[_^{}]/.test(run.value)),
    JSON.stringify(runs),
  );
}

check(
  "T_s^4 carries BOTH a subscript and a superscript",
  runsOf("T_s^4", "sub").length === 1 && runsOf("T_s^4", "sup").length === 1,
  JSON.stringify(parse("T_s^4")),
);

check(
  "T_{s,1}^{max} groups both scripts correctly",
  runsOf("T_{s,1}^{max}", "sub")[0].value === "s,1" &&
    runsOf("T_{s,1}^{max}", "sup")[0].value === "max",
  JSON.stringify(parse("T_{s,1}^{max}")),
);

check(
  "q''_{in} keeps its double prime AND its subscript",
  plain("q''_{in}").startsWith("q''") &&
    runsOf("q''_{in}", "sub")[0].value === "in",
  JSON.stringify(parse("q''_{in}")),
);

/* ---------------------------------------------------------- Greek and accents */

console.log("\nGreek symbols and accents");
console.log("-------------------------");

for (const [expression, expected] of [
  ["\\alpha", "α"],
  ["\\beta", "β"],
  ["\\epsilon", "ϵ"],
  ["\\varepsilon", "ε"],
  ["\\sigma", "σ"],
  ["\\Delta", "Δ"],
  ["\\infty", "∞"],
]) {
  check(
    `${expression} renders as ${expected}`,
    plain(expression) === expected,
    plain(expression),
  );
}

for (const [expression, value] of [
  ["\\dot{Q}", "Q"],
  ["\\bar{T}", "T"],
  ["\\hat{T}", "T"],
  ["\\vec{v}", "v"],
]) {
  const accents = runsOf(expression, "accent");

  check(
    `${expression} is an accent over "${value}"`,
    accents.length === 1 && accents[0].value === value,
    JSON.stringify(parse(expression)),
  );
}

/* ---------------------------------------------------------- no raw markup */

console.log("\nNo raw markup on the sheet");
console.log("--------------------------");

for (const expression of [
  "T_1",
  "T_{s,1}",
  "\\dot{Q}_2",
  "\\varepsilon_1",
  "R_{th,3}",
  "q''_{in}",
  "T_s^4",
]) {
  check(
    `${expression} has no baseline underscores, carets or braces`,
    !/[_^{}\\]/.test(plain(expression)),
    plain(expression),
  );
}

/* ---------------------------------------------------------- real notation */

console.log("\nThe Heat Transfer notation");
console.log("--------------------------");

const notation = loadModule("heat-notation.js");

for (const [family, expected] of [
  ["Q", "\\dot{Q}_1"],
  ["q", "q''_1"],
  ["T", "T_1"],
  ["Ts", "T_{s,1}"],
  ["h", "h_1"],
  ["e", "\\varepsilon_1"],
  ["Rc", "R_{c,1}"],
  ["Rth", "R_{th,1}"],
  ["Cth", "C_{th,1}"],
  ["CV", "CV_1"],
]) {
  check(
    `the ${family} family starts at ${expected}`,
    notation.HEAT_NOTATION_FAMILIES[family].label(1) === expected,
  );
}

check(
  "every family's own label is recognised by its counter",
  Object.keys(notation.HEAT_NOTATION_FAMILIES).every((family) => {
    const sample = notation.HEAT_NOTATION_FAMILIES[family].label(1);
    return notation.HEAT_NOTATION_FAMILIES[family].match.test(sample);
  }),
);

check(
  "a student's rewritten label is NOT counted",
  !notation.HEAT_NOTATION_FAMILIES.T.match.test("T_\\infty") &&
    !notation.HEAT_NOTATION_FAMILIES.T.match.test("T_{hot}"),
);

/* ---------------------------------------------------------- the source */

console.log("\nThe notation as TeX source");
console.log("----------------------------");

const model = loadModule("heat-model.js");
const labels = loadModule("heat-labels.js");
const annotateWriter = loadModule("annotations.js");

/*
 * EVERY NOTATION'S SOURCE FORM.
 *
 * The compiled picture must show the SYMBOL, not the command's name. Greek and
 * accented commands are therefore written as their own characters - ``\u0307``
 * for an accent, ``ε`` for epsilon - because the picture's compiler does not
 * accept `\dot{Q}` in a node: it emits the command, its argument and the script
 * as three disconnected texts at nonsense coordinates, so a notation meant to
 * read Q̇ becomes stray `_`, `Q` and `1` fragments around the drawing.
 *
 * The subscript stays as `_1`, which the compiler DOES render as a real
 * <tspan>. The editor keeps the markup the student typed; only the written
 * source is resolved.
 */
for (const [name, parent, expected] of [
  [
    "Heat Transfer Rate",
    model.createThermalArrow({
      start: { x: 0, y: 0 },
      end: { x: 40, y: 0 },
      variant: "heat-rate",
    }),
    "$Q\u0307_1$",
  ],
  [
    "Fixed Temperature",
    model.createThermalBoundary({
      start: { x: 0, y: 0 },
      end: { x: 40, y: 0 },
      variant: "fixed-temperature",
    }),
    "$T_{s,1}$",
  ],
  [
    "Radiation Boundary",
    model.createThermalBoundary({
      start: { x: 0, y: 0 },
      end: { x: 40, y: 0 },
      variant: "radiation",
    }),
    "$ε_1$",
  ],
  [
    "Thermal Resistance",
    model.createCircuitElement({ center: { x: 0, y: 0 }, variant: "resistance" }),
    "$R_{th,1}$",
  ],
]) {
  const label = labels.createHeatLabel(parent, { objects: [parent] });
  const source = annotateWriter.annotationSourceWriter(label);

  check(
    `${name}'s notation is written as ${expected} in the source`,
    source.includes(expected),
    source.split("\n").filter((line) => line.includes("node")).join(" | "),
  );

  /*
   * NO ACCENT COMMAND SURVIVES into the written source. Matched as the literal
   * five characters `\dot` etc., not as a regex-with-brace - the node's own
   * closing `}` made a brace-anchored pattern match a perfectly good label.
   */
  /*
   * The backslash is built from its character code, so no layer of string
   * escaping between here and the assertion can quietly turn it into something
   * else - which is exactly what made this check report a false failure.
   */
  const BACKSLASH = String.fromCharCode(92);
  const accentNames = ["dot", "ddot", "bar", "hat", "tilde", "vec"];

  /*
   * ONLY the drawn node matters. The label's own stored `text` legitimately
   * keeps the markup the student typed - that is the editable source - so the
   * check is on the CONTENT the picture is told to draw.
   */
  const nodeLine = source.split("\n").find((line) => line.includes("node")) || "";
  const content = (nodeLine.match(/\{(.*)\}/) || ["", ""])[1];

  const hasAccent = accentNames.some((accent) =>
    content.includes(BACKSLASH + accent),
  );

  check(
    `${name}'s drawn node carries no unsupported accent command`,
    !hasAccent,
    nodeLine,
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
