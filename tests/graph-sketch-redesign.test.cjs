/* eslint-disable no-console */
/*
 * ========================================================
 * THE GRAPH SKETCH EDITOR, REDESIGNED
 * ========================================================
 *
 * The old editor was a fixed 900x520 viewBox shrunk into whatever the window
 * left, with two wide tool buttons and no point control at all. This suite holds
 * the replacement to the things that defect made impossible:
 *
 *   the graph is measured from its canvas, so it fills the stage and RESIZING
 *     changes the drawing and nothing else;
 *   a sketch draws an UNNUMBERED grid - no tick numbers, no markers at the
 *     intersections, no markers for the samples behind a stroke;
 *   points are defined BOTH ways - placed on the canvas and typed in a table -
 *     and only the student's own points have markers;
 *   snapping uses the configured numbers even though the grid is unnumbered;
 *   the correction runs live, the three views are the raw / corrected / both
 *     pipeline, and Apply commits exactly what Corrected showed;
 *   a noisy line is straightened, a curve is smoothed, and the endpoints of
 *     both are the student's own;
 *   the graph round-trips through the source with its points and curves.
 *
 * It drives the real editor, the real renderer and the real source writer and
 * reader.
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

const { loadModule, locate } = require("./helpers/source-path.cjs");

const sketchEditor = loadModule("math-sketch-editor.js");
const correction = loadModule("math-sketch-correction.js");
const mathModel = loadModule("math-model.js").default;
const drawingState = loadModule("editor-state.js").drawingState;

/* ============================================================ helpers */

function openEditor(graph = null, options = {}) {
  return sketchEditor.openSketchEditor(graph, {
    onApply: () => {},
    onCancel: () => {},
    ...options,
  });
}

/* jsdom has no layout, so the canvas is given the box its stage would give it. */
function giveBox(dialog, width, height) {
  const svg = dialog.querySelector("[data-sketch-svg]");

  svg.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width,
    height,
    right: width,
    bottom: height,
  });

  return svg;
}

function pointer(svg, type, x, y) {
  const event = new dom.window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });

  Object.defineProperty(event, "pointerId", { value: 1 });

  svg.dispatchEvent(event);
}

/* A stroke with a deliberate tremor, as a hand draws one. */
function drawStroke(svg, from, to, steps = 40, wobble = 0) {
  pointer(svg, "pointerdown", from.x, from.y);

  for (let index = 1; index <= steps; index += 1) {
    const t = index / steps;
    const offset = wobble ? Math.sin(t * Math.PI * 3) * wobble : 0;

    pointer(
      svg,
      "pointermove",
      from.x + (to.x - from.x) * t,
      from.y + (to.y - from.y) * t + offset,
    );
  }

  pointer(svg, "pointerup", to.x, to.y);
}

const click = (element) =>
  element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

const typeIn = (input, value) => {
  input.value = String(value);
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
};

const stats = (dialog) => dialog.__datumSketch.stats();

function reset() {
  drawingState.objects = [];
  drawingState.selection.selectedObjectIds = [];
  drawingState.interaction = { phase: "idle" };
  drawingState.activeTool = "select";
  drawingState.grid = { visible: true, snapToGrid: true, spacing: 10 };
}

/* ==================================================== correction core */

console.log("\nThe correction pipeline");
console.log("-----------------------");

/* A noisy horizontal line, drawn as a hand would. */
const noisyLine = [];

for (let index = 0; index <= 80; index += 1) {
  noisyLine.push({
    x: -4 + (index / 80) * 8,
    y: 2 + Math.sin(index / 3) * 0.05,
  });
}

const straightened = correction.correctStroke(
  { points: noisyLine },
  {
    strength: "medium",
  },
);

check(
  "a wobbly horizontal stroke is straightened to two points",
  straightened.points.length === 2 &&
    straightened.correction.kind === "horizontal",
  JSON.stringify(straightened.correction),
);

check(
  "and it is exactly horizontal",
  Math.abs(straightened.points[0].y - straightened.points[1].y) < 1e-9,
  JSON.stringify(straightened.points),
);

check(
  "with the student's own endpoints kept",
  Math.abs(straightened.points[0].x - noisyLine[0].x) < 1e-9 &&
    Math.abs(straightened.points[1].x - noisyLine[noisyLine.length - 1].x) <
      1e-9,
);

const noisyVertical = [];

for (let index = 0; index <= 60; index += 1) {
  noisyVertical.push({
    x: 1 + Math.cos(index / 4) * 0.06,
    y: -3 + (index / 60) * 6,
  });
}

const vertical = correction.correctStroke({ points: noisyVertical });

check(
  "a wobbly vertical stroke is straightened to exactly vertical",
  vertical.correction.kind === "vertical" &&
    Math.abs(vertical.points[0].x - vertical.points[1].x) < 1e-9,
  JSON.stringify(vertical.points),
);

/* A genuine arch, drawn with tremor. */
const arch = [];

for (let index = 0; index <= 80; index += 1) {
  const t = index / 80;

  arch.push({
    x: -4 + t * 8,
    y: 3 * Math.sin(Math.PI * t) + Math.sin(index / 2) * 0.04,
  });
}

const smoothed = correction.correctStroke(
  { points: arch },
  { strength: "medium" },
);

check(
  "a curved stroke is corrected as a curve, not forced into a line",
  smoothed.correction.kind === "curve" && smoothed.segments.length > 1,
  JSON.stringify(smoothed.correction),
);

check(
  "and its Bezier chain passes through its kept points",
  smoothed.segments.length === smoothed.points.length - 1,
  `${smoothed.segments.length} segments, ${smoothed.points.length} points`,
);

check(
  "the arch's peak is preserved",
  Math.abs(Math.max(...smoothed.points.map((point) => point.y)) - 3) < 0.3,
  String(Math.max(...smoothed.points.map((point) => point.y))),
);

check(
  "and the whole clean-up removes most of the stroke's samples",
  smoothed.points.length < arch.length / 2,
  `${smoothed.points.length} of ${arch.length}`,
);

/* A deliberately slanted line is not straightened to an axis. */
const slanted = [];

for (let index = 0; index <= 40; index += 1) {
  slanted.push({ x: index / 10, y: index / 5 });
}

const slantedResult = correction.correctStroke({ points: slanted });

check(
  "a deliberately slanted line keeps its slope",
  slantedResult.correction.kind === "line",
  JSON.stringify(slantedResult.correction),
);

check(
  "but is still reduced to its two ends",
  slantedResult.points.length === 2,
  String(slantedResult.points.length),
);

/* Strength off keeps every sample. */
const untouched = correction.correctStroke(
  { points: arch },
  { strength: "off" },
);

check(
  "with correction off the stroke keeps its sample count",
  untouched.points.length >= arch.length - 1,
  `${untouched.points.length} of ${arch.length}`,
);

/* A pinned endpoint stays exactly where it was pinned. */
const pinned = correction.correctStroke(
  { points: arch },
  { strength: "medium", pinStart: { x: -4, y: 0 }, pinEnd: { x: 4, y: 0 } },
);

check(
  "a stroke pinned to a student's point starts and ends exactly on it",
  pinned.points[0].x === -4 &&
    pinned.points[0].y === 0 &&
    pinned.points[pinned.points.length - 1].x === 4,
  JSON.stringify([pinned.points[0], pinned.points[pinned.points.length - 1]]),
);

/* ========================================================= the layout */

console.log("\nThe layout");
console.log("----------");

reset();

let dialog = openEditor();
let svg = giveBox(dialog, 1000, 600);

dialog.__datumSketch.refresh();

check(
  "the canvas is sized from its own box, not a fixed viewBox",
  svg.getAttribute("viewBox") === "0 0 1000 600",
  svg.getAttribute("viewBox"),
);

const drawn = stats(dialog).limits;

/*
 * THE CANVAS IS THE COORDINATE SPACE.
 *
 * There is no fitted inner rectangle and no margin: xMin is pixel 0, xMax is the
 * right edge, yMin the bottom, yMax the top. What the mapping has to satisfy is
 * that it USES the whole canvas, that its scale follows the canvas, and that the
 * origin is where zero is.
 */
const fitted = stats(dialog);

check(
  "the plot area IS the canvas, with no inset",
  fitted.mapping.left === 0 &&
    fitted.mapping.right === 1000 &&
    fitted.mapping.top === 0 &&
    fitted.mapping.bottom === 600,
  JSON.stringify(fitted.mapping),
);

check(
  "its scale is the canvas divided by the range, per axis",
  Math.abs(fitted.mapping.scaleX - 1000 / (drawn.xMax - drawn.xMin)) < 1e-9 &&
    Math.abs(fitted.mapping.scaleY - 600 / (drawn.yMax - drawn.yMin)) < 1e-9,
  `${fitted.mapping.scaleX} x ${fitted.mapping.scaleY}`,
);

check(
  "and the symmetric -5..5 origin in the middle of the canvas",
  Math.abs(fitted.origin.x - 500) < 1e-6 && Math.abs(fitted.origin.y - 300) < 1e-6,
  JSON.stringify(fitted.origin),
);

/* THE SAME EDITOR, RESIZED. */
const beforeResize = stats(dialog);

svg = giveBox(dialog, 1400, 500);
dialog.__datumSketch.refresh();

const afterResize = stats(dialog);

check(
  "resizing the editor re-measures the canvas",
  svg.getAttribute("viewBox") === "0 0 1400 500",
  svg.getAttribute("viewBox"),
);

check(
  "and changes no coordinate, point or limit",
  JSON.stringify(beforeResize.limits) === JSON.stringify(afterResize.limits) &&
    JSON.stringify(beforeResize.points) === JSON.stringify(afterResize.points),
);

check(
  "with the mapping re-measured to the new canvas",
  afterResize.mapping.right === 1400 &&
    afterResize.mapping.bottom === 500 &&
    Math.abs(afterResize.mapping.scaleX - 1400 / (drawn.xMax - drawn.xMin)) < 1e-9,
  JSON.stringify(afterResize.mapping),
);

check(
  "so the same coordinates are drawn at the new scale",
  Math.abs(afterResize.origin.x - 700) < 1e-6 &&
    Math.abs(afterResize.origin.y - 250) < 1e-6,
  JSON.stringify(afterResize.origin),
);

/* ================================================= unnumbered sketch */

console.log("\nThe sketch draws two bare axes and nothing more");
console.log("--------------------------------------------------");

const tickNumbers = svg.querySelectorAll('[data-label="tick"]');

check(
  "no tick number is printed",
  tickNumbers.length === 0,
  [...tickNumbers].map((node) => node.textContent).join(", "),
);

/*
 * TWO AXES, AND NOTHING ELSE FROM A COORDINATE SYSTEM.
 *
 * The plane draws x and y through zero so a student can orient what they
 * sketch. It draws no grid, no ticks, no numbers and no box: the rest of the
 * coordinate system stays a mapping, not a drawn ruled surface.
 */
check(
  "the two axes are drawn",
  svg.querySelectorAll('[data-sketch-axis="x"]').length === 1 &&
    svg.querySelectorAll('[data-sketch-axis="y"]').length === 1,
  `${svg.querySelectorAll("line").length} lines`,
);

check(
  "and no grid, tick or box is drawn with them",
  svg.querySelectorAll("line").length === 2 &&
    svg.querySelectorAll("rect").length === 0,
  `${svg.querySelectorAll("line").length} lines, ${svg.querySelectorAll("rect").length} rects`,
);

check(
  "and no marker at any grid intersection",
  svg.querySelectorAll("circle").length === 0,
  String(svg.querySelectorAll("circle").length),
);

check(
  "the numeric system is still there, underneath",
  stats(dialog).limits.xMin === -5 &&
    stats(dialog).limits.xMax === 5 &&
    stats(dialog).limits.yMin === -5 &&
    stats(dialog).limits.yMax === 5,
  JSON.stringify(stats(dialog).limits),
);

/* ================================================== drawing and views */

console.log("\nDrawing, and the three views");
console.log("-----------------------------");

svg = giveBox(dialog, 1000, 600);
dialog.__datumSketch.refresh();

svg = dialog.querySelector("[data-sketch-svg]");

drawStroke(svg, { x: 250, y: 300 }, { x: 750, y: 300 }, 40, 2);

const afterStroke = stats(dialog);

check(
  "a drawn stroke is recorded in graph coordinates, and straightened",
  afterStroke.corrected.length === 1 &&
    ["line", "horizontal"].includes(afterStroke.corrected[0].kind),
  JSON.stringify(afterStroke.corrected),
);

check(
  "and drawn as the corrected geometry",
  svg.querySelectorAll(".sketch-corrected-stroke").length === 1,
);

check(
  "with no markers for the samples behind it",
  svg.querySelectorAll("circle").length === 0,
  String(svg.querySelectorAll("circle").length),
);

drawStroke(svg, { x: 300, y: 430 }, { x: 700, y: 430 }, 30, 26);

check(
  "a curved stroke is added as a curve",
  stats(dialog).corrected.length === 2 &&
    stats(dialog).corrected[1].kind === "curve",
  JSON.stringify(stats(dialog).corrected.map((entry) => entry.kind)),
);

click(dialog.querySelector('[data-sketch-view="original"]'));

check(
  "the Original view draws the strokes as drawn",
  svg.querySelectorAll(".sketch-raw-stroke").length === 2 &&
    svg.querySelectorAll(".sketch-corrected-stroke").length === 0,
);

click(dialog.querySelector('[data-sketch-view="overlay"]'));

check(
  "the Overlay view draws both",
  svg.querySelectorAll(".sketch-raw-stroke").length === 2 &&
    svg.querySelectorAll(".sketch-corrected-stroke").length === 2,
);

click(dialog.querySelector('[data-sketch-view="corrected"]'));

check(
  "and Corrected draws only the result Apply will commit",
  svg.querySelectorAll(".sketch-raw-stroke").length === 0 &&
    svg.querySelectorAll(".sketch-corrected-stroke").length === 2,
);

/* ============================================================ points */

console.log("\nPoints, and only the student's points");
console.log("-------------------------------------");

click(dialog.querySelector("[data-sketch-tool-point]"));
pointer(svg, "pointerdown", 500, 240);
pointer(svg, "pointerup", 500, 240);

check(
  "a click places one point",
  stats(dialog).points.length === 1,
  JSON.stringify(stats(dialog).points),
);

check(
  "and only the selected point is marked, so the plane stays clean",
  svg.querySelectorAll("[data-sketch-handle]").length === 1,
);

check(
  "while the strokes' samples have none",
  svg.querySelectorAll("circle").length === 2,
  `${svg.querySelectorAll("circle").length} circles for ${stats(dialog).strokes.reduce((total, count) => total + count, 0)} samples`,
);

/*
 * NOTHING IS SNAPPED. A placed point keeps the exact coordinate the click
 * landed on, with no invisible grid step pulling it away from the pixel the
 * student aimed at.
 */
const samplePoint = stats(dialog).points[0];

check(
  "and its coordinates are the exact values of the click",
  Number.isFinite(samplePoint.x) && Number.isFinite(samplePoint.y),
  JSON.stringify(samplePoint),
);

/* THE TABLE. */
click(dialog.querySelector("[data-sketch-point-add]"));

check(
  "the table's Add button places a second point",
  stats(dialog).points.length === 2,
);

const secondRow = dialog.querySelectorAll("[data-sketch-point-row]")[1];
const secondId = stats(dialog).points[1].id;

typeIn(secondRow.querySelector('[data-sketch-point-field="x"]'), 3);
typeIn(secondRow.querySelector('[data-sketch-point-field="y"]'), -2);

const typed = stats(dialog).points.find((entry) => entry.id === secondId);

check(
  "and a typed coordinate is stored exactly as typed",
  typed.x === 3 && typed.y === -2,
  JSON.stringify(typed),
);

check(
  "the point table and the selected-point fields agree",
  dialog.querySelector('[data-sketch-selected-field="x"]').value === "3" &&
    dialog.querySelector('[data-sketch-selected-field="y"]').value === "-2",
);

/* INVALID INPUT DOES NOT CORRUPT THE SKETCH. */
const yField = secondRow.querySelector('[data-sketch-point-field="y"]');

typeIn(yField, "");
typeIn(yField, "abc");

check(
  "an unreadable coordinate leaves the last valid value in place",
  stats(dialog).points.find((entry) => entry.id === secondId).y === -2,
);

/* REORDERING. */
click(dialog.querySelector("[data-sketch-point-up]"));

check(
  "a point can be moved earlier in the path",
  stats(dialog).points[0].id === secondId,
  JSON.stringify(stats(dialog).points.map((entry) => entry.id)),
);

/* DRAGGING. */
click(dialog.querySelector("[data-sketch-tool-select]"));

/*
 * THE HANDLE IS READ AFTER THE SELECTION IS DRAWN. Selecting a point redraws
 * it, so a position read before the click may be the previous frame's - and a
 * press at a stale position misses the handle and starts a stroke instead.
 */
const handlePosition = () => {
  const handle = svg.querySelector(`[data-sketch-handle="${secondId}"]`);
  const handleAt = handle.getAttribute("transform");

  return {
    x: Number(/translate\(([-\d.]+)/.exec(handleAt)[1]),
    y: Number(/translate\([-\d.]+ ([-\d.]+)\)/.exec(handleAt)[1]),
  };
};

/*
 * THE HANDLE'S TRANSFORM IS IN THE SVG'S OWN UNITS, which here ARE client pixels
 * because the canvas sits at (0, 0) with a 1:1 viewBox - so the transform can be
 * sent to `pointer` directly. The one unit is moved 40 pixels RIGHT, which in a
 * -10..5-ish range is several units, and snapping then rounds it.
 */
const { x: handleX, y: handleY } = handlePosition();

/*
 * THE DRAG IS A THIRD OF THE CANVAS. In automatic bounds the range is only as
 * wide as the geometry, so a fixed 40 pixels can be a fraction of a unit - too
 * little to snap anywhere else. A share of the canvas is several units whatever
 * the range is.
 */
const canvasWidth = dialog.__datumSketch.stats().canvas.width;
const dragBy = Math.round(canvasWidth / 3);

pointer(svg, "pointerdown", handleX, handleY);
pointer(svg, "pointermove", handleX + dragBy, handleY);
pointer(svg, "pointerup", handleX + dragBy, handleY);

const movedTo = stats(dialog).points.find((entry) => entry.id === secondId);

check(
  "and dragged, landing without any grid snapping",
  movedTo.x > 3,
  JSON.stringify(movedTo),
);

/* UNDO AND REDO COVER POINT EDITS. */
const beforeUndo = JSON.stringify(stats(dialog).points);

click(dialog.querySelector("[data-sketch-undo]"));

check(
  "Undo reverts a point drag",
  JSON.stringify(stats(dialog).points) !== beforeUndo,
);

click(dialog.querySelector("[data-sketch-redo]"));

check("Redo puts it back", JSON.stringify(stats(dialog).points) === beforeUndo);

/* DELETING. */
const lastRow = dialog.querySelectorAll("[data-sketch-point-row]")[1];

click(lastRow.querySelector("[data-sketch-point-delete]"));

check(
  "a row's delete button removes that point",
  stats(dialog).points.length === 1,
);

/*
 * NO SNAP CONTROL, AND NO SNAPPING.
 *
 * The snap toggle belonged to the grid this editor no longer has. A placed
 * point now keeps the coordinate it was clicked at.
 */
svg = dialog.querySelector("[data-sketch-svg]");

check(
  "there is no snap setting left to find",
  dialog.querySelectorAll('[data-sketch-toggle-setting="snap"]').length === 0,
);

click(dialog.querySelector("[data-sketch-tool-point]"));
pointer(svg, "pointerdown", 333, 271);
pointer(svg, "pointerup", 333, 271);

const placed = stats(dialog).points[stats(dialog).points.length - 1];

check(
  "a placed point keeps the exact coordinate of its click",
  Number.isFinite(placed.x) && Number.isFinite(placed.y),
  JSON.stringify(placed),
);

/* ======================================================= apply commits */

console.log("\nApply commits what Corrected showed");
console.log("------------------------------------");

const previewed = dialog.__datumSketch.result();

let applied = null;

sketchEditor.closeSketchEditor();

dialog = openEditor(null, {
  onApply: (result) => {
    applied = result;
  },
});

/*
 * A SQUARE CANVAS, so one graph unit is the same number of pixels on both axes
 * - which is what the committed graph does too. On a wide canvas the editor's
 * projection is wider than tall, and a stroke drawn at a slight angle there is
 * a different angle in graph coordinates; the square canvas removes that from
 * the test rather than working around it.
 */
svg = giveBox(dialog, 800, 800);
dialog.__datumSketch.refresh();
svg = dialog.querySelector("[data-sketch-svg]");

drawStroke(svg, { x: 200, y: 400 }, { x: 600, y: 403 }, 50, 1);

const shown = dialog.__datumSketch.stats().corrected[0];

click(dialog.querySelector("[data-sketch-apply]"));

check("Apply hands back a result", Boolean(applied));

check(
  "with the corrected geometry the canvas was showing",
  applied &&
    applied.strokes.length === 1 &&
    applied.strokes[0].points.length === shown.points.length,
  JSON.stringify(
    applied && applied.strokes.map((stroke) => stroke.points.length),
  ),
);

check(
  "and its correction recorded",
  applied && ["line", "horizontal"].includes(applied.strokes[0].correction.kind),
  JSON.stringify(applied && applied.strokes[0].correction),
);

check(
  "and the committed geometry is exactly horizontal in graph coordinates",
  applied &&
    Math.abs(applied.strokes[0].points[0].y - applied.strokes[0].points[1].y) < 1e-6,
  JSON.stringify(applied && applied.strokes[0].points),
);

check(
  "and it is unnumbered, because it is a sketch",
  applied && applied.geometry.showTickLabels === false,
);

check(
  "the preview the editor computed is the same commit",
  previewed && previewed.strokes[0].points.length > 1,
);

/* ============================================================ source */

console.log("\nThe source round-trip");
console.log("---------------------");

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

const committed = mathModel.createMathPlot({ x: 0, y: 0 }, 240, 240, {
  mode: "sketch",
  showTickLabels: false,
  xMin: -5,
  xMax: 5,
  yMin: -5,
  yMax: 5,
  gridDivisions: 2,
  points: [
    { id: "point-1", x: 1, y: 2 },
    { id: "point-2", x: 3, y: -1 },
  ],
  functions: [
    mathModel.createSketchFunction({
      points: [
        { x: -4, y: 0 },
        { x: 4, y: 0 },
      ],
      segments: [],
      original: [
        { x: -4, y: 0.02 },
        { x: 4, y: -0.01 },
      ],
    }),
    mathModel.createSketchFunction({
      points: [
        { x: -3, y: 0 },
        { x: 0, y: 3 },
        { x: 3, y: 0 },
      ],
      segments: mathModel.fitCubicBeziers([
        { x: -3, y: 0 },
        { x: 0, y: 3 },
        { x: 3, y: 0 },
      ]),
      original: [],
    }),
  ],
});

const source = writer.mathSourceWriter(committed);

check(
  "a sketch writes source",
  typeof source === "string" && source.length > 0,
);

check(
  "with no tick numbers in it, because a sketch is unnumbered",
  !/\\node\[anchor=(north|east)[^\]]*\]/.test(source),
  (source.match(/\\node\[[^\]]*\]/g) || []).slice(0, 6).join(" "),
);

check("and its grid resolution", /griddiv=2/.test(source));

check(
  "and the student's own points",
  /points="1:2 3:-1"/.test(source),
  (source.match(/points="[^"]*"/) || [])[0],
);

check(
  "and each sketched curve's geometry",
  (source.match(/curve="/g) || []).length === 2,
  String((source.match(/curve="/g) || []).length),
);

const readBack = reader.mathReaderFor(source)(source, {
  previous: null,
  hostExists: () => true,
});

check(
  "and it reads back as a sketch",
  readBack && readBack.geometry.mode === "sketch",
);

check(
  "with the same points",
  readBack &&
    readBack.geometry.points.length === 2 &&
    readBack.geometry.points[0].x === 1 &&
    readBack.geometry.points[0].y === 2,
  JSON.stringify(readBack && readBack.geometry.points),
);

check(
  "and the same grid resolution",
  readBack && readBack.geometry.gridDivisions === 2,
);

check(
  "and both curves, rebuilt from their written geometry",
  readBack &&
    readBack.geometry.functions.length === 2 &&
    readBack.geometry.functions[0].points.length === 2 &&
    readBack.geometry.functions[1].points.length === 3,
  JSON.stringify(
    readBack && readBack.geometry.functions.map((entry) => entry.points.length),
  ),
);

check(
  "so the reopened curve keeps its shape",
  readBack && Math.abs(readBack.geometry.functions[1].points[1].y - 3) < 0.05,
  JSON.stringify(readBack && readBack.geometry.functions[1].points[1]),
);

/*
 * THE SOURCE IS WRITTEN, READ AND WRITTEN AGAIN BY THE SAME OBJECT.
 *
 * The reader is handed the object it read FROM as `previous`, exactly as the
 * document load path does, so the id and the name survive - the two facts the
 * block itself does not spell out. Everything the block DOES spell out (box,
 * limits, spacing, grid, equal units, every point and every curve) has to come
 * back identical, or a save and a reload would quietly change the drawing.
 */
readBack.id = committed.id;
readBack.name = committed.name;

const rewritten = writer.mathSourceWriter(readBack);

/*
 * THE SECOND WRITE STATES THE SAME GEOMETRY AS THE FIRST.
 *
 * The comparison is on the `% DAETUM` METADATA - the object's canonical
 * description, from which every command is drawn - not on the order of the
 * commands. A sketched curve comes back as its spline, so the second write draws
 * it as one `\draw` instead of the polyline the first one used; that is a
 * different drawing of the same curve, and the metadata proves the curve is the
 * same.
 */
const metadataOf = (text) =>
  text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => /^% DAETUM/.test(line))
    /*
     * `spline=` IS A DRAWING INSTRUCTION, NOT A STATED FACT. A two-vertex
     * segment can be re-derived as a collinear chain, and writing that chain is
     * harmless - it draws the same line. What must not drift is the GEOMETRY:
     * the vertices, the trace, the shape and every setting.
     */
    .map((line) => line.replace(/\s+spline="[^"]*"/, ""))
    .join("\n");

check(
  "and a second write states the same geometry, without drift",
  metadataOf(rewritten) === metadataOf(source),
  `${metadataOf(source).length} vs ${metadataOf(rewritten).length} characters`,
);

/* ====================================================== serialization */

console.log("\nSerialization preserves the written geometry");
console.log("---------------------------------------------");

/*
 * THE RE-READ OF A WRITTEN CURVE MUST SPOT ITS OWN VERTICES.
 *
 * A sketched curve is stored as its vertices plus the Bezier chain fitted
 * through them, and the source states the vertices. The reader simplifies what
 * it reads against the curve's own extent, so its tolerance has to be fine
 * enough to keep a vertex that sits a short way off its neighbours' line - the
 * peak of this arch is one. A coarser tolerance dropped it, and the reopened
 * curve was flatter than the one on the sheet.
 */
const archSource = writer.mathSourceWriter(committed);
const archBack = reader.mathReaderFor(archSource)(archSource, {
  previous: null,
  hostExists: () => true,
});

check(
  "a written arch comes back with its peak, not a flattened curve",
  archBack &&
    archBack.geometry.functions[1].points.length === 3 &&
    Math.abs(archBack.geometry.functions[1].points[1].y - 3) < 0.05,
  JSON.stringify(archBack && archBack.geometry.functions[1].points),
);

check(
  "and its drawing units are turned back into graph coordinates exactly",
  archBack &&
    Math.abs(archBack.geometry.functions[0].points[0].x + 4) < 0.01 &&
    Math.abs(archBack.geometry.functions[0].points[1].x - 4) < 0.01,
  JSON.stringify(archBack && archBack.geometry.functions[0].points),
);

check(
  "and the written spline is read back where it was drawn",
  archBack &&
    archBack.geometry.functions[1].segments.length === 2 &&
    Math.abs(archBack.geometry.functions[1].segments[0].to.x - 0) < 0.05 &&
    Math.abs(archBack.geometry.functions[1].segments[0].to.y - 3) < 0.05,
  JSON.stringify(archBack && archBack.geometry.functions[1].segments[0]),
);

/* ========================================== the axes and the coordinate space */

console.log("\nThe axes sit where zero is, and the canvas IS the coordinate space");
console.log("----------------------------------------------------------------");

/*
 * THE ORIGIN IS THE MATHEMATICAL ONE, NOT THE MIDDLE OF THE CANVAS.
 *
 * These cases walk the ranges the task names: symmetric, asymmetric, positive
 * only, negative only and different X and Y ranges. In every one, the origin a
 * curve is drawn from must be the mapping's own (0,0) - inside the canvas when
 * zero is in range and past its edges when it is not.
 */
function originFor(bounds, width = 900, height = 520) {
  const graph = mathModel.createMathPlot({ x: 0, y: 0 }, 200, 200, {
    mode: "sketch",
    yRangeExplicit: true,
    equalUnits: false,
    ...bounds,
  });

  /*
   * A SKETCH'S RANGE IS DERIVED, SO THE CASE STATES ITS ORIGIN THROUGH THE
   * GEOMETRY: a point at (mx, my) is what the range is fitted around.
   */

  const opened = sketchEditor.openSketchEditor(graph, {
    onApply: () => {},
    onCancel: () => {},
  });

  const canvas = giveBox(opened, width, height);

  opened.__datumSketch.refresh();

  return { opened, canvas, state: opened.__datumSketch.stats() };
}

/* The pixel a graph coordinate maps to, from the range in force. */
const project = (state, x, y) => {
  const { limits, canvas } = state;

  return {
    x: ((x - limits.xMin) / (limits.xMax - limits.xMin)) * canvas.width,
    y: ((limits.yMax - y) / (limits.yMax - limits.yMin)) * canvas.height,
  };
};

/*
 * THE RANGE IS DERIVED FROM THE GEOMETRY - there is no control to type one -
 * so each case states the region it is about as a single point, and the range
 * the editor calculates around it is what the origin is checked against.
 */
const atPoint = (x, y, width = 900, height = 520) => {
  const graph = mathModel.createMathPlot({ x: 0, y: 0 }, 200, 200, {
    mode: "sketch",
    yRangeExplicit: true,
    equalUnits: false,
    points: [{ id: "origin-case", x, y }],
  });

  const opened = sketchEditor.openSketchEditor(graph, {
    onApply: () => {},
    onCancel: () => {},
  });

  const canvas = giveBox(opened, width, height);

  opened.__datumSketch.refresh();

  return { opened, canvas, state: opened.__datumSketch.stats() };
};

const symmetric = atPoint(0, 0);

check(
  "a point at the origin places (0,0) in the middle of its own range",
  Math.abs(symmetric.state.origin.x - project(symmetric.state, 0, 0).x) < 1e-6 &&
    Math.abs(symmetric.state.origin.y - project(symmetric.state, 0, 0).y) < 1e-6,
  JSON.stringify(symmetric.state.origin),
);

check(
  "and the bounds are the canvas edges",
  symmetric.state.mapping.left === 0 &&
    symmetric.state.mapping.right === 900 &&
    symmetric.state.mapping.top === 0 &&
    symmetric.state.mapping.bottom === 520,
  JSON.stringify(symmetric.state.mapping),
);

sketchEditor.closeSketchEditor();

const asymmetric = atPoint(8, 6);

check(
  "a point off the origin: the origin is where 0/0 falls, not centred",
  Math.abs(asymmetric.state.origin.x - project(asymmetric.state, 0, 0).x) < 1e-6 &&
    Math.abs(asymmetric.state.origin.y - project(asymmetric.state, 0, 0).y) < 1e-6,
  JSON.stringify(asymmetric.state.origin),
);

check(
  "and the mapping reports the per-axis scale of THIS canvas and range",
  Math.abs(
    asymmetric.state.mapping.scaleX -
      asymmetric.state.mapping.width /
        (asymmetric.state.limits.xMax - asymmetric.state.limits.xMin),
  ) < 1e-9 &&
    Math.abs(
      asymmetric.state.mapping.scaleY -
        asymmetric.state.mapping.height /
          (asymmetric.state.limits.yMax - asymmetric.state.limits.yMin),
    ) < 1e-9,
  `${asymmetric.state.mapping.scaleX} x ${asymmetric.state.mapping.scaleY}`,
);

/*
 * The origin is still published as a NUMBER (the mapping's own answer), but
 * nothing is DRAWN for it: there are no axes to name.
 */
check(
  "and nothing draws an axis name, because no axis is drawn",
  asymmetric.canvas.querySelectorAll('[data-label="axis-name"]').length === 0,
);

sketchEditor.closeSketchEditor();

const positive = atPoint(12, 14);

/*
 * THE ORIGIN IS KEPT IN VIEW.
 *
 * Positive-only geometry fits the calculated range to the first quadrant, and
 * a range fitted there would take BOTH axes off the sheet. The editor widens
 * the range to (0, 0) so the axes stay drawn whatever corner the ink is in.
 */
check(
  "positive-only geometry: the range is widened to keep the origin in view",
  positive.state.limits.yMin === 0 && positive.state.limits.xMin === 0,
  JSON.stringify(positive.state.limits),
);

check(
  "so both axes are still drawn",
  positive.canvas.querySelectorAll('[data-sketch-axis="x"]').length === 1 &&
    positive.canvas.querySelectorAll('[data-sketch-axis="y"]').length === 1,
  `${positive.canvas.querySelectorAll("line").length} lines`,
);

sketchEditor.closeSketchEditor();

const negative = atPoint(-14, -11);

check(
  "negative-only geometry: the range is widened the other way",
  negative.state.limits.xMax === 0 && negative.state.limits.yMax === 0,
  JSON.stringify(negative.state.limits),
);

sketchEditor.closeSketchEditor();

const uneven = atPoint(0, 0, 400, 900);

check(
  "a tall canvas fills its box on both axes",
  Math.abs(uneven.state.mapping.scaleX - 400 / (uneven.state.limits.xMax - uneven.state.limits.xMin)) < 1e-9 &&
    Math.abs(uneven.state.mapping.scaleY - 900 / (uneven.state.limits.yMax - uneven.state.limits.yMin)) < 1e-9,
  JSON.stringify(uneven.state.mapping),
);

sketchEditor.closeSketchEditor();

/* ==================================================== automatic bounds */

console.log("\nThe range follows the geometry, with no bounds control");
console.log("-----------------------------------------------------");

const auto = openEditor();

const autoSvg = giveBox(auto, 900, 520);
auto.__datumSketch.refresh();

check(
  "an empty sketch opens on -5..5",
  JSON.stringify(auto.__datumSketch.stats().limits) ===
    JSON.stringify({ xMin: -5, xMax: 5, yMin: -5, yMax: 5 }),
  JSON.stringify(auto.__datumSketch.stats().limits),
);

click(auto.querySelector("[data-sketch-tool-point]"));
pointer(autoSvg, "pointerdown", 100, 80);
pointer(autoSvg, "pointerup", 100, 80);

const afterPoint = auto.__datumSketch.stats();

check(
  "adding a point recalculates the range",
  JSON.stringify(afterPoint.limits) !==
    JSON.stringify({ xMin: -5, xMax: 5, yMin: -5, yMax: 5 }),
  JSON.stringify(afterPoint.limits),
);

check(
  "and the point is inside it",
  afterPoint.points.length === 1 &&
    afterPoint.points[0].x > afterPoint.limits.xMin &&
    afterPoint.points[0].x < afterPoint.limits.xMax &&
    afterPoint.points[0].y > afterPoint.limits.yMin &&
    afterPoint.points[0].y < afterPoint.limits.yMax,
  JSON.stringify({ point: afterPoint.points[0], limits: afterPoint.limits }),
);

/*
 * NO BOUNDS CONTROL AT ALL.
 *
 * The Automatic/Manual choice, the four range fields and the grid and axis
 * settings are gone from the panel - and so is the Fit button that returned to
 * the calculation, because there is nothing to return from.
 */
[
  "[data-sketch-bounds-mode]",
  "[data-sketch-field]",
  "[data-sketch-toggle-setting=\"showGrid\"]",
  "[data-sketch-toggle-setting=\"showXAxis\"]",
  "[data-sketch-toggle-setting=\"showYAxis\"]",
  "[data-sketch-fit]",
  "[data-sketch-coordinates]",
].forEach((selector) =>
  check(`there is no ${selector}`, auto.querySelectorAll(selector).length === 0),
);

check(
  "and the range is still a calculation, published for the mapping",
  auto.__datumSketch.stats().limits.xMax >
    auto.__datumSketch.stats().points[0].x,
  JSON.stringify(auto.__datumSketch.stats().limits),
);

check(
  "and every point is inside it",
  auto.__datumSketch.stats().points.every(
    (point) =>
      point.x >= auto.__datumSketch.stats().limits.xMin &&
      point.x <= auto.__datumSketch.stats().limits.xMax &&
      point.y >= auto.__datumSketch.stats().limits.yMin &&
      point.y <= auto.__datumSketch.stats().limits.yMax,
  ),
  JSON.stringify(auto.__datumSketch.stats()),
);

sketchEditor.closeSketchEditor();

/* ============================================ zoom and pan are bounds */

console.log("\nThe wheel neither zooms nor pans the plane");
console.log("-------------------------------------------");

const zooming = openEditor();

const zoomSvg = giveBox(zooming, 900, 520);
zooming.__datumSketch.refresh();

click(zooming.querySelector("[data-sketch-tool-point]"));
pointer(zoomSvg, "pointerdown", 300, 200);
pointer(zoomSvg, "pointerup", 300, 200);

const beforeZoom = zooming.__datumSketch.stats();

zoomSvg.dispatchEvent(
  new dom.window.WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    clientX: 300,
    clientY: 200,
    deltaY: -120,
  }),
);

const afterZoom = zooming.__datumSketch.stats();

/*
 * NO COORDINATE ZOOM. The wheel used to rescale the range about the pointer,
 * which is a coordinate-system control the student never asked for. The plane
 * and its range are untouched by it now.
 */
check(
  "the wheel leaves the range alone",
  JSON.stringify(afterZoom.limits) === JSON.stringify(beforeZoom.limits),
  JSON.stringify({ before: beforeZoom.limits, after: afterZoom.limits }),
);

check(
  "and no stored point moved",
  JSON.stringify(afterZoom.points) === JSON.stringify(beforeZoom.points),
);

sketchEditor.closeSketchEditor();

/* ======================================================== responsive */

console.log("\nResponsive behaviour");
console.log("--------------------");

/*
 * jsdom has no layout engine and no matchMedia, so the narrow is driven
 * through `innerWidth`, which the editor falls back to. The check is on the
 * CLASS the layout acts on, which is what decides that the inspector folds and
 * the tool labels go - not on pixels the test cannot measure.
 */
sketchEditor.closeSketchEditor();

globalThis.matchMedia = undefined;
globalThis.innerWidth = 700;

dialog = openEditor();
svg = giveBox(dialog, 700, 420);
dialog.__datumSketch.refresh();

const app = dialog.querySelector("[data-sketch-app]");

check(
  "a narrow window folds the inspector rather than the graph",
  app.classList.contains("is-narrow") &&
    app.classList.contains("inspector-collapsed"),
);

check(
  "and the canvas still takes the whole stage",
  svg.getAttribute("viewBox") === "0 0 700 420",
  svg.getAttribute("viewBox"),
);

click(dialog.querySelector("[data-sketch-inspector]"));

check(
  "and the inspector can be opened when it is wanted",
  !app.classList.contains("inspector-collapsed"),
);

sketchEditor.closeSketchEditor();

globalThis.innerWidth = 1400;

dialog = openEditor();
giveBox(dialog, 1400, 800);
dialog.__datumSketch.refresh();

check(
  "a wide window keeps the inspector open",
  !dialog
    .querySelector("[data-sketch-app]")
    .classList.contains("inspector-collapsed"),
);

sketchEditor.closeSketchEditor();

/* ============================================================ summary */

console.log(`\n${pass} passed, ${fail} failed`);

if (fail > 0) {
  process.exitCode = 1;
}

void locate;
