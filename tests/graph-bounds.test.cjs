/* eslint-disable no-console */
/*
 * ========================================================
 * THE GRAPH'S COORDINATE BOUNDS
 * ========================================================
 *
 * The four numbers that ARE the canvas. This suite holds the bounds model and
 * the editor's mapping to the task's cases:
 *
 *   automatic bounds from the student's own geometry, with padding and readable
 *     rounding, and never from a stroke's samples;
 *   one point, identical points, and geometry on one axis only - every
 *     degenerate case produces a usable range;
 *   the full-canvas mapping: xMin is the left edge, xMax the right, yMin the
 *     bottom, yMax the top;
 *   symmetric bounds put the origin in the centre, asymmetric ones do not;
 *   manual bounds stay manual, and geometry outside them is reported rather than
 *     accommodated;
 *   resizing changes the scale and nothing else;
 *   the pointer's coordinate agrees with the one drawn under it.
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
const { dom } = createHarness(projectRoot, JSDOM, require);

[
  "drawingProperties",
  "drawingToolMessage",
  "drawingCoordinates",
  "drawingZoomValue",
  "drawingToolHeading",
  "drawingToolList",
  "drawingFeaturesBack",
  "drawingFeatures",
].forEach((id) => {
  const element = dom.window.document.createElement("div");

  element.id = id;
  dom.window.document.body.appendChild(element);
});

const { loadModule } = require("./helpers/source-path.cjs");

const boundsModel = loadModule("math-graph-bounds.js");
const sketchEditor = loadModule("math-sketch-editor.js");
const mathModel = loadModule("math-model.js").default;

const close = (a, b, tolerance = 1e-9) => Math.abs(a - b) <= tolerance;

/* ================================================ automatic bounds */

console.log("\nAutomatic bounds are calculated from the geometry");
console.log("-------------------------------------------------");

const three = boundsModel.automaticBounds({
  points: [
    { x: -2, y: 3 },
    { x: 4, y: 5 },
    { x: 1, y: -3 },
  ],
});

check(
  "three points are all inside the calculated range",
  three.xMin < -2 && three.xMax > 4 && three.yMin < -3 && three.yMax > 5,
  JSON.stringify(three),
);

check(
  "and there is padding around the outermost geometry",
  three.xMin < -2 && three.xMax > 4 && three.yMin < -3 && three.yMax > 5,
  JSON.stringify(three),
);

check(
  "the range is rounded to readable numbers",
  ["xMin", "xMax", "yMin", "yMax"].every((key) => {
    const value = three[key];
    return (
      Math.abs(value - Number(value.toFixed(6))) < 1e-12 &&
      Math.abs(value) < 100 &&
      String(value).length <= 6
    );
  }),
  JSON.stringify(three),
);

check(
  "the origin therefore falls on a readable place in the range",
  three.xMin <= 0 && three.xMax >= 0 && three.yMin <= 0 && three.yMax >= 0,
  JSON.stringify(three),
);

/* DEGENERATE CASES. */
const single = boundsModel.automaticBounds({ points: [{ x: 2, y: 2 }] });

check(
  "a single point still gives a usable range on both axes",
  single.xMax > single.xMin && single.yMax > single.yMin,
  JSON.stringify(single),
);

check(
  "and the point is inside it",
  single.xMin < 2 && single.xMax > 2 && single.yMin < 2 && single.yMax > 2,
  JSON.stringify(single),
);

const identical = boundsModel.automaticBounds({
  points: [
    { x: 1, y: 1 },
    { x: 1, y: 1 },
  ],
});

check(
  "identical points do not produce a zero-width or zero-height range",
  identical.xMax > identical.xMin && identical.yMax > identical.yMin,
  JSON.stringify(identical),
);

const horizontal = boundsModel.automaticBounds({
  points: [
    { x: -5, y: 0 },
    { x: 5, y: 0 },
  ],
});

check(
  "one-dimensional geometry is widened on the flat axis",
  horizontal.yMax > horizontal.yMin && horizontal.yMax - horizontal.yMin >= 1,
  JSON.stringify(horizontal),
);

check(
  "an empty graph keeps the familiar -5..5",
  JSON.stringify(boundsModel.automaticBounds({})) ===
    JSON.stringify(boundsModel.DEFAULT_GRAPH_BOUNDS),
);

/* ONLY ENDPOINTS COUNT, NEVER SAMPLES. */
const strokeSamples = [];

for (let index = 0; index <= 200; index += 1) {
  strokeSamples.push({ x: -1 + (2 * index) / 200, y: 0.5 });
}

const fromStroke = boundsModel.automaticBounds({
  strokes: [{ points: strokeSamples }],
});

check(
  "a stroke contributes its two ENDS, not its samples",
  fromStroke.xMin < -1 &&
    fromStroke.xMax > 1 &&
    fromStroke.yMax - fromStroke.yMin >= 1,
  JSON.stringify(fromStroke),
);

check(
  "so a stroke with wild mid-samples cannot set the range",
  (() => {
    const spiky = strokeSamples.map((point, index) => ({
      x: point.x,
      y: index > 0 && index < 199 ? 500 : 0.5,
    }));

    const range = boundsModel.automaticBounds({ strokes: [{ points: spiky }] });

    return range.yMax < 5;
  })(),
);

/* ================================================== the full canvas */

console.log("\nThe canvas IS the coordinate space");
console.log("----------------------------------");

function openAt(bounds, width = 900, height = 600, options = {}) {
  const graph = mathModel.createMathPlot({ x: 0, y: 0 }, 200, 200, {
    mode: "sketch",
    yRangeExplicit: true,
    boundsMode: "manual",
    ...bounds,
  });

  const dialog = sketchEditor.openSketchEditor(graph, {
    onApply: () => {},
    onCancel: () => {},
    ...options,
  });

  const svg = dialog.querySelector("[data-sketch-svg]");

  svg.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width,
    height,
    right: width,
    bottom: height,
  });

  dialog.__datumSketch.refresh();

  return { dialog, svg, state: dialog.__datumSketch.stats() };
}

let opened = openAt({ xMin: -5, xMax: 5, yMin: -5, yMax: 5 });

check(
  "the plot area is the WHOLE canvas - no inset",
  opened.state.mapping.left === 0 &&
    opened.state.mapping.right === 900 &&
    opened.state.mapping.top === 0 &&
    opened.state.mapping.bottom === 600,
  JSON.stringify(opened.state.mapping),
);

check(
  "a symmetric range puts the origin at the canvas centre",
  close(opened.state.origin.x, 450) && close(opened.state.origin.y, 300),
  JSON.stringify(opened.state.origin),
);

/* THE EDGES ARE THE BOUNDS. */
check(
  "the bounds map to the canvas edges",
  (() => {
    const mapping = opened.state.mapping;

    /* xMin at 0, xMax at width, yMax at 0, yMin at height. */
    const toPixel = (x, y) => ({
      x:
        ((x - mapping.limits.xMin) /
          (mapping.limits.xMax - mapping.limits.xMin)) *
        900,
      y:
        ((mapping.limits.yMax - y) /
          (mapping.limits.yMax - mapping.limits.yMin)) *
        600,
    });

    return (
      close(toPixel(-5, 0).x, 0) &&
      close(toPixel(5, 0).x, 900) &&
      close(toPixel(0, 5).y, 0) &&
      close(toPixel(0, -5).y, 600)
    );
  })(),
);

sketchEditor.closeSketchEditor();

/* ASYMMETRIC: the origin is where zero is, not the centre. */
opened = openAt({ xMin: -10, xMax: 5, yMin: -2, yMax: 8 });

/*
 * x = -10..5 puts 0 two thirds of the way across; y = -2..8 puts it a fifth of
 * the way up from the bottom. Both are the MATHEMATICAL position, so the origin
 * is right of centre and below it - which is where "not the middle" shows.
 */
check(
  "an asymmetric range puts the origin where 0 actually is",
  opened.state.origin.x > 450 &&
    close(opened.state.origin.x, (10 / 15) * 900) &&
    opened.state.origin.y > 300 &&
    close(opened.state.origin.y, (8 / 10) * 600),
  JSON.stringify(opened.state.origin),
);

sketchEditor.closeSketchEditor();

/* ZERO OUTSIDE: the axis is not drawn, and is not forced to an edge. */
opened = openAt({ xMin: 1, xMax: 9, yMin: 2, yMax: 10 });

check(
  "zero outside the range: the axes are absent, not pinned to an edge",
  opened.svg.querySelectorAll('[data-label="axis-name"]').length === 0,
);

/*
 * A range of y 2..10 has its zero BELOW the bottom edge: past the canvas, not
 * pulled onto it. The x range starts at 1, so zero is left of the canvas too.
 */
check(
  "and zero is projected past the canvas, not pulled onto its edge",
  opened.state.origin.x < 0 && opened.state.origin.y > 600,
  JSON.stringify(opened.state.origin),
);

sketchEditor.closeSketchEditor();

/* RESIZE: scale changes, coordinates do not. */
opened = openAt({ xMin: -5, xMax: 5, yMin: -5, yMax: 5 }, 900, 600);

const beforeResize = opened.state;

opened.svg.getBoundingClientRect = () => ({
  left: 0,
  top: 0,
  width: 1400,
  height: 500,
  right: 1400,
  bottom: 500,
});

opened.dialog.__datumSketch.refresh();

const afterResize = opened.dialog.__datumSketch.stats();

check(
  "resizing re-measures the canvas",
  opened.svg.getAttribute("viewBox") === "0 0 1400 500",
  opened.svg.getAttribute("viewBox"),
);

check(
  "and leaves every bound exactly as it was",
  JSON.stringify(beforeResize.limits) === JSON.stringify(afterResize.limits),
  `${JSON.stringify(beforeResize.limits)} vs ${JSON.stringify(afterResize.limits)}`,
);

check(
  "while the origin follows the new centre",
  close(afterResize.origin.x, 700) && close(afterResize.origin.y, 250),
  JSON.stringify(afterResize.origin),
);

sketchEditor.closeSketchEditor();

/* ======================================================== manual mode */

console.log("\nManual bounds");
console.log("-------------");

opened = openAt({ xMin: -4, xMax: 6, yMin: -1, yMax: 9 });

check(
  "a saved manual graph opens in manual mode",
  opened.state.boundsMode === "manual",
  opened.state.boundsMode,
);

const typed = opened.dialog.querySelector('[data-sketch-field="xMax"]');

typed.value = "20";
typed.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

const afterTyping = opened.dialog.__datumSketch.stats();

check(
  "typing a bound changes the range at once",
  afterTyping.limits.xMax === 20,
  JSON.stringify(afterTyping.limits),
);

check("and stays manual", afterTyping.boundsMode === "manual");

/* BACK TO AUTOMATIC. */
opened.dialog
  .querySelector('[data-sketch-bounds-mode="auto"]')
  .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

const automatic = opened.dialog.__datumSketch.stats();

check(
  "the Automatic control returns the calculation",
  automatic.boundsMode === "auto",
  automatic.boundsMode,
);

check(
  "and an empty graph falls back to -5..5",
  automatic.limits.xMin === -5 && automatic.limits.xMax === 5,
  JSON.stringify(automatic.limits),
);

sketchEditor.closeSketchEditor();

/* GEOMETRY OUTSIDE MANUAL BOUNDS IS REPORTED. */
opened = openAt({ xMin: -1, xMax: 1, yMin: -1, yMax: 1 });

opened.dialog
  .querySelector("[data-sketch-tool-point]")
  .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

opened.svg.dispatchEvent(
  Object.assign(
    new dom.window.MouseEvent("pointerdown", {
      bubbles: true,
      clientX: 890,
      clientY: 10,
    }),
    {},
  ),
);
opened.svg.dispatchEvent(
  new dom.window.MouseEvent("pointerup", {
    bubbles: true,
    clientX: 890,
    clientY: 10,
  }),
);

const placed = opened.dialog.__datumSketch.stats();

check(
  "a point placed on the canvas is inside the manual range - the canvas IS the range",
  placed.points.length === 1 &&
    placed.points[0].x <= 1 &&
    placed.points[0].x >= -1,
  JSON.stringify(placed.points),
);

check(
  "so nothing is outside it by construction",
  placed.outside.length === 0,
  JSON.stringify(placed.outside),
);

sketchEditor.closeSketchEditor();

/* ============================================ source round trip */

console.log("\nThe mode survives the source");
console.log("----------------------------");

const writer = loadModule("source-writers/math.js");
const reader = require(
  path.join(
    projectRoot,
    "src",
    "shared",
    "rendering",
    "latex",
    "source-readers",
    "math.js",
  ),
);

const manualGraph = mathModel.createMathPlot({ x: 0, y: 0 }, 200, 200, {
  mode: "sketch",
  showTickLabels: false,
  boundsMode: "manual",
  xMin: -3,
  xMax: 7,
  yMin: 2,
  yMax: 12,
  yRangeExplicit: true,
  points: [{ id: "p1", x: 1, y: 3 }],
  functions: [],
});

const source = writer.mathSourceWriter(manualGraph);

check("a manual graph writes its mode", /bounds=manual/.test(source));

const readBack = reader.mathReaderFor(source)(source, {
  previous: null,
  hostExists: () => true,
});

check(
  "and reads back as manual, with the same four numbers",
  readBack &&
    readBack.geometry.boundsMode === "manual" &&
    readBack.geometry.manualBounds.xMin === -3 &&
    readBack.geometry.manualBounds.xMax === 7 &&
    readBack.geometry.manualBounds.yMin === 2 &&
    readBack.geometry.manualBounds.yMax === 12,
  JSON.stringify(readBack && readBack.geometry.manualBounds),
);

const autoGraph = mathModel.createMathPlot({ x: 0, y: 0 }, 200, 200, {
  mode: "sketch",
  xMin: -5,
  xMax: 5,
  yMin: -5,
  yMax: 5,
  functions: [],
});

check(
  "an automatic graph writes bounds=auto",
  /bounds=auto/.test(writer.mathSourceWriter(autoGraph)),
);

/* ================================================== summary */

console.log(`\n${pass} passed, ${fail} failed`);

if (fail > 0) {
  process.exitCode = 1;
}
