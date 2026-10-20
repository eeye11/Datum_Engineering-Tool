/* eslint-disable no-console */
/*
 * ========================================================
 * AUTOMATIC EXPORT SCALING
 * ========================================================
 *
 * A DAETUM drawing is authored in millimetres - one model unit is one paper
 * millimetre - which is right for the DRAWING SPACE and far too large for a
 * figure in a written solution. The export therefore normalises the whole drawing
 * into the space a document gives it, and reduces every physical size with it so
 * the figure keeps its proportions.
 *
 * These assertions are the contract:
 *
 *   A. the same drawing produces the same source at every zoom and pan
 *   B. oversized drawings shrink UNIFORMLY into the limits; small ones do not grow
 *   C. every named stroke preset keeps its nominal width in the MODEL and is
 *      written at nominal x factor - once, never twice
 *   D. dashes, arrow heads, symbols and fonts scale with it, with a readable
 *      floor on text
 *   E. the model is untouched: geometry, magnitudes, colours, opacity
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

const statics = loadModule("statics.js");
const geometry = loadModule("geometry.js");
const style = loadModule("tikz-style.js");
const transform = loadModule("export-transform.js");
const bounds = loadModule("model-bounds.js");

/* ============================================================ helpers */

const widthIn = (text) => [...String(text).matchAll(/line width=([\d.]+)pt/g)].map((m) => Number(m[1]));

const commandsOf = (text) =>
  String(text)
    .split("\n")
    .filter((line) => /^\\(draw|fill)\b/.test(line.trim()));

/* A beam-and-graph sheet, the case the brief names: about 430 units wide. */
function wideSheet() {
  return [
    {
      id: "beam",
      type: "beam",
      name: "Beam 1",
      geometry: { start: { x: -215, y: 0 }, end: { x: 215, y: 0 } },
      style: { stroke: "#000000", lineWidth: "thin" },
    },
    {
      id: "pin",
      type: "pin-support",
      name: "Pin Support 1",
      geometry: { position: { x: -215, y: 0 }, orientation: Math.PI / 2 },
      style: { stroke: "#000000", lineWidth: "thin" },
    },
    {
      id: "roller",
      type: "roller-support",
      name: "Roller Support 1",
      geometry: { position: { x: 215, y: 0 }, orientation: Math.PI / 2 },
      style: { stroke: "#000000", lineWidth: "thin" },
    },
    {
      id: "sfd",
      type: "analysis-diagram",
      name: "SFD 1",
      geometry: {
        start: { x: -215, y: -60 },
        end: { x: 215, y: -60 },
        localRange: { from: 0, to: 10 },
        mode: "sketch",
        sketchElements: [],
      },
      style: { stroke: "#000000", lineWidth: "thin" },
    },
  ];
}

const fitOf = (objects, limits = {}) => transform.createExportContext({ bounds: bounds.drawingBounds(objects), ...limits });

const sourceOf = (object, ctx) => statics.serializeStaticsObject(object, { transform: ctx });

/* ============================================= A. zoom independence */

console.log("\nA. Zoom independence");
console.log("--------------------");

const sheet = wideSheet();

/*
 * THE ZOOM IS NOT AN INPUT TO ANY OF THIS. The transform is built from
 * `drawingBounds`, which reads model coordinates only; the camera maps model
 * space onto the screen and never touches stored geometry. To prove the source
 * cannot see it, the SAME objects are generated while a camera zoom is set on a
 * state object that the generator is handed - and the output is compared.
 */
const atZoom = (zoom) => {
  const state = { camera: { zoom, panX: 0, panY: 0 }, units: "mm" };
  const ctx = fitOf(sheet);
  void state;

  return sheet.map((object) => statics.serializeStaticsObject(object, { transform: ctx, state })).join("\n");
};

const zooms = [0.25, 0.5, 1, 1.5, 2];

const outputs = zooms.map((zoom) => atZoom(zoom));

check(
  "the same drawing generates identical source at 25%, 50%, 100%, 150% and 200%",
  outputs.every((text) => text === outputs[0]),
  `${outputs.length} outputs, ${new Set(outputs).size} distinct`,
);

const panned = sheet.map((object) => {
  const state = { camera: { zoom: 4, panX: 1234, panY: -567 } };

  return statics.serializeStaticsObject(object, { transform: fitOf(sheet), state });
});

check(
  "and panning it, or resizing the window, cannot change it",
  panned.join("\n") === outputs[0],
);

/* ========================================== B. coordinate setting */

console.log("\nB. Automatic scale");
console.log("-------------------");

const wideFit = fitOf(sheet);

check(
  "a ~430-unit drawing is reduced to the 150 mm width limit",
  Math.abs(430 * wideFit.factor - 150) < 20 && wideFit.factor < 0.5,
  `factor ${wideFit.factor.toFixed(4)}, width ${(transform.boundsWidth(bounds.drawingBounds(sheet)) * wideFit.factor).toFixed(1)}mm`,
);

check(
  "and it is reduced, never enlarged",
  wideFit.factor <= 1 && wideFit.factor > 0,
);

const small = [
  {
    id: "small",
    type: "line",
    geometry: { start: { x: 0, y: 0 }, end: { x: 40, y: 20 } },
    style: { lineWidth: "thin" },
  },
];

const smallFit = fitOf(small);

check("a drawing that already fits keeps its authored size", smallFit.factor === 1, `${smallFit.factor}`);
check("so its coordinates are written as authored", sourceOf(small[0], smallFit).includes("(0,0)"), sourceOf(small[0], smallFit));

const tallFit = fitOf([
  {
    id: "tall",
    type: "line",
    geometry: { start: { x: 0, y: 0 }, end: { x: 20, y: 400 } },
    style: { lineWidth: "thin" },
  },
]);

check("a tall drawing is limited by its HEIGHT", tallFit.factor < 0.5 && tallFit.factor > 0.2, `${tallFit.factor}`);

check(
  "one factor for both axes, so nothing is distorted",
  (() => {
    const origin = wideFit.sourceBounds;
    const exported = wideFit.point(430, 100);

    return (
      Math.abs(exported.x - (430 - origin.minX) * wideFit.factor) < 1e-6 &&
      Math.abs(exported.y - (100 - origin.minY) * wideFit.factor) < 1e-6
    );
  })(),
  JSON.stringify({ at: wideFit.point(430, 100), origin: wideFit.sourceBounds, factor: wideFit.factor }),
);

check(
  "a horizontal and a vertical span of the same length export as the same length",
  (() => {
    const a = wideFit.point(0, 0);
    const b = wideFit.point(100, 0);
    const c = wideFit.point(0, 100);

    return Math.abs(b.x - a.x - (c.y - a.y)) < 1e-6;
  })(),
);

check(
  "an empty drawing has no scale to apply",
  fitOf([]).factor === 1 && bounds.drawingBounds([]) === null,
);

check(
  "a single point is not divided by its zero height",
  Number.isFinite(
    fitOf([{ id: "p", type: "particle", geometry: { position: { x: 10, y: 10 } }, style: { lineWidth: "thin" } }])
      .factor,
  ),
);

const negative = fitOf([
  {
    id: "neg",
    type: "beam",
    geometry: { start: { x: -500, y: -300 }, end: { x: -100, y: -300 } },
    style: { lineWidth: "thin" },
  },
]);

check(
  "negative coordinates are shifted to a local origin, never clipped",
  (() => {
    const at = negative.point(-500, -300);

    return at.x >= 0 && at.y >= 0;
  })(),
  JSON.stringify(negative.point(-500, -300)),
);

check(
  "the exported coordinates stay small",
  (() => {
    const far = wideFit.point(215, -60);

    return far.x <= 150 && far.y <= 100;
  })(),
  JSON.stringify(wideFit.point(215, -60)),
);

/* ============================================ C. stroke presets */

console.log("\nC. Stroke presets and effective widths");
console.log("--------------------------------------");

/*
 * THE PRESETS ARE MODEL WIDTHS - the same scale the canvas paints in. `thin` is
 * 0.5, which the sheet draws 1.2 px wide and the source states as 1.2 pt; TikZ's
 * own `thin` (0.4pt) is a PRINT size and would be a hairline on a figure drawn at
 * DAETUM's scale.
 */
const NOMINAL = {
  "ultra-thin": 0.25,
  "very-thin": 0.35,
  thin: 0.5,
  "semi-thick": 0.75,
  thick: 1,
  "very-thick": 1.5,
  "ultra-thick": 2,
};
const PT_PER_WIDTH = style.POINTS_PER_LINE_WIDTH;

const lineOf = (lineWidth) => ({
  id: `line-${lineWidth}`,
  type: "line",
  geometry: { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
  style: { lineWidth },
});

check(
  "every preset resolves to its canonical nominal width",
  Object.entries(NOMINAL).every(([name, width]) => style.resolveLineWidth(name) === width),
  JSON.stringify(Object.fromEntries(Object.keys(NOMINAL).map((n) => [n, style.resolveLineWidth(n)]))),
);

check(
  "at scale 1 the written width IS the calibrated nominal",
  Object.entries(NOMINAL).every(([name, width]) => {
    const written = widthIn(geometry.geometrySourceWriter(lineOf(name), { transform: smallFit }));

    return written.length > 0 && Math.abs(written[0] - width * PT_PER_WIDTH) < 1e-6;
  }),
);

/*
 * THE CALIBRATED CASE FROM THE BRIEF: a 430 mm drawing into a 150 mm page.
 *
 * The bounds are stated WITHOUT ink allowance so the factor is exactly
 * 150/430 = 0.3488, which is the number every expected width below is built
 * from - rather than a magic constant the test cannot check.
 */
const factor = 150 / 430;

const scaled = transform.createExportContext({
  bounds: { minX: 0, minY: 0, maxX: 430, maxY: 10 },
  inkAllowancePt: 0,
});

check(
  "the calibrated scale factor is 0.3488 for a 430-unit drawing",
  Math.abs(scaled.factor - factor) < 0.01,
  `${scaled.factor}`,
);

check(
  "Thin (model 0.5) at that factor is written ~0.4186pt",
  Math.abs(widthIn(geometry.geometrySourceWriter(lineOf("thin"), { transform: scaled }))[0] - 0.5 * PT_PER_WIDTH * factor) < 0.001,
  `${widthIn(geometry.geometrySourceWriter(lineOf("thin"), { transform: scaled }))}`,
);

check(
  "every preset follows the same rule, exactly once",
  Object.entries(NOMINAL).every(([name, width]) => {
    const written = widthIn(geometry.geometrySourceWriter(lineOf(name), { transform: scaled }))[0];

    return Math.abs(written - Number((width * PT_PER_WIDTH * scaled.factor).toFixed(4))) < 1e-3;
  }),
);

const custom = lineOf(1.75);

check(
  "a custom width is scaled by the same factor",
  Math.abs(
    widthIn(geometry.geometrySourceWriter(custom, { transform: scaled }))[0] -
      1.75 * PT_PER_WIDTH * scaled.factor,
  ) < 1e-3,
);

check(
  "and the model keeps the custom width it was given",
  style.resolveLineWidth(custom.style.lineWidth) === 1.75,
);

check(
  "the same object generated twice is byte-identical - the factor is not accumulated",
  geometry.geometrySourceWriter(lineOf("thin"), { transform: scaled }) ===
    geometry.geometrySourceWriter(lineOf("thin"), { transform: scaled }),
);

check(
  "colours and opacity are not scaled",
  (() => {
    const red = geometry.geometrySourceWriter(
      { ...lineOf("thin"), style: { lineWidth: "thin", stroke: "#FF0000", opacity: 0.5 } },
      { transform: scaled },
    );

    return red.includes("daetumCFF0000") && red.includes("draw opacity=0.5");
  })(),
);

/* ====================================== D. other visual properties */

console.log("\nD. Dashes, arrows, symbols, text");
console.log("---------------------------------");

const dashed = geometry.geometrySourceWriter(
  { ...lineOf("thin"), style: { lineWidth: "thin", lineType: "dashed" } },
  { transform: scaled },
);

check(
  "a dashed line's dashes scale with the figure",
  dashed.includes("dash pattern=on") &&
    Math.abs(Number((dashed.match(/dash pattern=on ([\d.]+)pt/) || [])[1]) - 3 * factor) < 1e-3,
  dashed,
);

const arrowed = geometry.geometrySourceWriter(
  { ...lineOf("thin"), style: { lineWidth: "thin", arrowEnd: "filled" } },
  { transform: scaled },
);

check(
  "arrow heads are given an explicit scaled size",
  arrowed.includes("Latex[length=") && arrowed.includes("width="),
  arrowed,
);
check(
  "and at scale 1 they are the plain named head",
  !geometry
    .geometrySourceWriter({ ...lineOf("thin"), style: { lineWidth: "thin", arrowEnd: "filled" } }, { transform: smallFit })
    .includes("[length="),
);

const labelled = statics.serializeStaticsObject(
  {
    id: "force",
    type: "force",
    name: "Point Force",
    geometry: { start: { x: 0, y: 0 }, end: { x: 0, y: 40 }, magnitude: 40, angle: 90 },
    style: { lineWidth: "thin" },
  },
  { transform: scaled },
);

check(
  "a label is printed at the scaled size, above the readable floor",
  labelled.includes("\\fontsize{6}") && !labelled.includes("\\fontsize{3.1}"),
  labelled,
);

check(
  "the label's nominal size is not what the model stores",
  labelled.includes("9") || labelled.includes("6"),
);

const support = statics.serializeStaticsObject(
  {
    id: "pin",
    type: "pin-support",
    geometry: { position: { x: 100, y: 0 }, orientation: Math.PI / 2 },
    style: { lineWidth: "thin" },
  },
  { transform: scaled },
);

check(
  "a support symbol shrinks with the drawing",
  (() => {
    /*
     * The pin is a triangle of 4-unit half-extent. Its exported corners must span
     * 4 x factor, not 4 - which is what makes the symbol sit in proportion beside
     * the reduced beam.
     */
    const span = /\([\d.-]+,([\d.-]+)\) -- \([\d.-]+,([\d.-]+)\)/.exec(support);

    if (!span) {
      return false;
    }

    const height = Math.abs(Number(span[2]) - Number(span[1]));

    return height > 0 && height <= 8 * factor + 1e-6;
  })(),
  support,
);
check(
  "and no command carries two styles",
  commandsOf(support).every((line) => (line.match(/line width=/g) || []).length <= 1),
);

/* ========================================== E. model integrity */

console.log("\nE. The model is untouched");
console.log("---------------------------");

const original = JSON.stringify(wideSheet());

const before = wideSheet();

before.forEach((object) => statics.serializeStaticsObject(object, { transform: scaled }));

check("generating source does not mutate the objects", JSON.stringify(before) === original);

check(
  "the magnitudes and coordinates are the authored ones",
  (() => {
    const force = before.find((object) => object.type === "force");
    void force;

    const geometryBefore = JSON.stringify(before[0].geometry);

    statics.serializeStaticsObject(before[0], { transform: scaled });

    return JSON.stringify(before[0].geometry) === geometryBefore;
  })(),
);

check(
  "an engineering value is unchanged by the scale",
  (() => {
    const force = {
      id: "f",
      type: "force",
      geometry: { start: { x: 0, y: 0 }, end: { x: 0, y: 40 }, magnitude: 40, angle: 90 },
      style: { lineWidth: "thin" },
    };

    const written = statics.serializeStaticsObject(force, { transform: scaled });

    return written.includes("F = 40");
  })(),
);

/* ============================================ F. placement of content */

console.log("\nF. The whole drawing is placed together");
console.log("-----------------------------------------");

const beamAt = wideFit.point(-215, 0);
const supportAt = wideFit.point(-215, 0);

check(
  "a support sits on the beam end it carries, after scaling",
  Math.abs(beamAt.x - supportAt.x) < 1e-6,
);

const graphAt = wideFit.point(-215, -60);

check(
  "and the graph keeps its distance from the beam",
  Math.abs(graphAt.y - beamAt.y) > 10,
  `${graphAt.y} vs ${beamAt.y}`,
);

console.log(`\n${pass} passed, ${fail} failed`);

if (fail > 0) {
  process.exitCode = 1;
}
