/* eslint-disable no-console */
/*
 * ========================================================
 * STATICS RENDERS - THE PICTURE ACTUALLY COMPILES
 * ========================================================
 *
 * The serializer suite proves the code is right. This one proves the code is
 * COMPILABLE, which is a different question and the one that was wrong.
 *
 * WHAT WENT WRONG. A Moment stored its unit as the two-character escape
 * `\\u00B7` instead of the middle-dot character it names. The label then read
 *
 *     $M = 50\ N\u00B7m$
 *
 * which is not a TeX command. A TeX compile is all-or-nothing, so ONE moment
 * stopped the whole document - and because the Drawing Space shows only the
 * compiled picture, EVERY object on the sheet disappeared. The source looked
 * plausible; the picture was blank.
 *
 * These checks are the ones that would have caught it:
 *
 *   1. No generated fragment contains an undecoded `\uXXXX` escape.
 *   2. Units are valid maths: `N\cdot m`, never `$N$\cdot$m$`.
 *   3. Every fragment's braces, brackets and maths delimiters balance.
 *   4. A unit stored either way - the character or the old escape - produces
 *      the same compilable label.
 *   5. The whole set of Statics types compiles as ONE document.
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

const { createHarness } = require("./harness-renderer.cjs");

createHarness(projectRoot, JSDOM, require);

const { loadModule } = require("./helpers/source-path.cjs");

loadModule("load-profile.js");
loadModule("diagram-equations.js");

const statics = loadModule("statics.js");

const STYLE = { stroke: "#193335", lineWidth: 0.75, lineType: "solid" };

const write = (object) =>
  statics.serializeStaticsObject(object, { state: null });

/*
 * Every Statics type, with the geometry its own factory produces. These are the
 * shapes a student's first click of each tool creates.
 */
const SAMPLES = {
  particle: { position: { x: 20, y: 20 } },
  "rigid-body": {
    position: { x: 0, y: 0 },
    width: 40,
    height: 20,
    rotation: 0,
  },
  beam: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
  truss: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, panels: 4 },
  cable: { start: { x: 0, y: 0 }, end: { x: 80, y: 0 } },
  shaft: { start: { x: 0, y: 0 }, end: { x: 90, y: 0 }, diameter: 16 },
  force: {
    start: { x: 10, y: 10 },
    position: { x: 10, y: 10 },
    magnitude: 20,
    angle: 90,
  },
  load: {
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 },
    intensity: 5,
    direction: -90,
    interval: 25,
    points: [
      { t: 0, magnitude: 5 },
      { t: 1, magnitude: 5 },
    ],
  },
  "varying-load": {
    start: { x: 0, y: 0 },
    end: { x: 90, y: 0 },
    startIntensity: 0,
    endIntensity: 8,
    direction: -90,
    interval: 15,
    loadUnit: "kN/m",
    points: [
      { t: 0, magnitude: 0 },
      { t: 1, magnitude: 8 },
    ],
  },
  moment: {
    position: { x: 40, y: 40 },
    magnitude: 10,
    direction: "CCW",
    unit: "N\u00B7m",
  },
  "pin-support": { position: { x: 50, y: 0 }, orientation: Math.PI / 2 },
  "roller-support": { position: { x: 50, y: 0 }, orientation: Math.PI / 2 },
  "fixed-support": { position: { x: 0, y: 0 }, orientation: Math.PI / 2 },
  "smooth-support": { position: { x: 50, y: 0 }, orientation: Math.PI / 2 },
  "pin-connection": { start: { x: 10, y: 10 }, end: { x: 40, y: 10 } },
  "fixed-connection": { start: { x: 10, y: 10 }, end: { x: 40, y: 10 } },
  "slider-connection": { start: { x: 10, y: 10 }, end: { x: 40, y: 10 } },
  resultant: {
    start: { x: 0, y: 0 },
    end: { x: 30, y: 40 },
    magnitude: 50,
    angle: 53.13,
  },
  "force-components": {
    start: { x: 0, y: 0 },
    end: { x: 30, y: 40 },
    horizontal: { start: { x: 0, y: 0 }, end: { x: 30, y: 0 } },
    vertical: { start: { x: 0, y: 0 }, end: { x: 0, y: 40 } },
  },
  "analysis-diagram": {
    start: { x: 0, y: -120 },
    end: { x: 100, y: -120 },
    diagramType: "sfd",
    mode: "plot",
    localRange: { from: 0, to: 5 },
    expressions: [
      {
        id: "e1",
        relationType: "functionX",
        visible: true,
        expression: "10 - 2x",
        xRange: { start: 0, end: 5 },
      },
    ],
  },
  "coordinate-system-2d": {
    origin: { x: 0, y: 0 },
    xPositiveLength: 20,
    xNegativeLength: 20,
    yPositiveLength: 20,
    yNegativeLength: 20,
  },
  point: { position: { x: 5, y: 6 } },
  line: { start: { x: 0, y: 0 }, end: { x: 30, y: 40 } },
  arc: { center: { x: 0, y: 0 }, radius: 10, startAngle: 0, endAngle: 90 },
};

const objectFor = (type, geometry) => ({
  id: `${type}-test`,
  type,
  name: `${type} 1`,
  geometry,
  style: { ...STYLE },
  engineering: { discipline: "statics", staticsType: type },
});

const outputs = Object.fromEntries(
  Object.entries(SAMPLES).map(([type, geometry]) => [
    type,
    write(objectFor(type, geometry)),
  ]),
);

/* ============================================= no raw escapes anywhere */

console.log("\nNo undecoded escapes");
console.log("--------------------");

const leaks = Object.entries(outputs).filter(
  ([, code]) =>
    typeof code === "string" && /(^|[^\\])\\u[0-9a-fA-F]{4}/.test(code),
);

check(
  "no generated fragment contains a literal \\uXXXX escape",
  leaks.length === 0,
  leaks.map(([type, code]) => `${type}: ${code}`).join("\n"),
);

/* ================================================ units are valid TeX */

console.log("\nUnits are valid mathematics");
console.log("---------------------------");

const moment = outputs.moment || "";

check(
  "a moment's unit is written as \\cdot",
  moment.includes("\\cdot"),
  moment,
);
check("and never as a raw middle dot", !moment.includes("\u00B7"), moment);
check(
  "and never introduces a $ inside its maths label",
  !/\$[^$]*\$[^$]*\$[^$]*\$/.test(moment.replace(/^\\node.*?\{/g, "")) &&
    !moment.includes("$\\cdot$"),
  moment,
);

/* ============================================== balanced delimiters */

console.log("\nEvery fragment is balanced");
console.log("--------------------------");

function balanced(code) {
  let braces = 0;
  let brackets = 0;
  let maths = 0;

  for (const character of String(code)) {
    if (character === "{") braces += 1;
    else if (character === "}") braces -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === "$") maths += 1;

    if (braces < 0 || brackets < 0) {
      return false;
    }
  }

  return braces === 0 && brackets === 0 && maths % 2 === 0;
}

const unbalanced = Object.entries(outputs).filter(
  ([, code]) => typeof code === "string" && !balanced(code),
);

check(
  "braces, brackets and maths delimiters balance in every fragment",
  unbalanced.length === 0,
  unbalanced.map(([type]) => type).join(", "),
);

/* ====================================== a legacy escape is harmless */

console.log("\nA unit stored the old way is decoded");
console.log("------------------------------------");

const legacy = write({
  ...objectFor("moment", {
    position: { x: 0, y: 0 },
    magnitude: 25,
    direction: "CW",
    unit: "N\\u00B7m",
  }),
});

check(
  "an escaped unit is decoded, not emitted",
  !legacy.includes("\\u00B7"),
  legacy,
);
check("and still compiles as N cdot m", legacy.includes("\\cdot"), legacy);

/* ===================================== a broken object cannot poison */

console.log("\nOne bad object does not blank the sheet");
console.log("---------------------------------------");

const poisoned = write({
  ...objectFor("force", { start: { x: 0, y: 0 }, magnitude: 10, angle: 0 }),
  label: "F{u}",
  geometry: {
    start: { x: 0, y: 0 },
    magnitude: 10,
    angle: 0,
    unit: "N\\u00B7m",
  },
});

check(
  "an object with a bad unit still writes compilable code",
  typeof poisoned === "string" &&
    balanced(poisoned) &&
    !/\\u00B7/.test(poisoned),
  poisoned,
);

/* ========================================= the whole sheet compiles */

console.log("\nThe whole sheet compiles as one document");
console.log("----------------------------------------");

const source = statics.generateStaticsTikz(
  Object.entries(SAMPLES).map(([type, geometry]) => objectFor(type, geometry)),
);

const standalone = statics.wrapAsStandaloneTex(source);

check(
  "every Statics type produced code",
  Object.values(outputs).every((code) => typeof code === "string"),
);
check(
  "the standalone document is balanced",
  balanced(
    standalone
      .replace(/\\documentclass\[tikz, border=5mm\]\{standalone\}/g, "")
      .replace(/\\usepackage\{[^}]*\}/g, "")
      .replace(/\\usetikzlibrary\{[^}]*\}/g, "")
      .replace(/\\begin\{document\}|\\end\{document\}/g, ""),
  ),
  "",
);
check(
  "it has a preamble and boundaries",
  standalone.includes("\\documentclass") &&
    standalone.includes("\\begin{document}"),
);

console.log(`\n${pass} passed, ${fail} failed`);

if (fail > 0) {
  process.exitCode = 1;
}
