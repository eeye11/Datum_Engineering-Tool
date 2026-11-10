/* eslint-disable no-console */
/*
 * ========================================================
 * THE SKETCH EDITORS ACTUALLY DRAW
 * ========================================================
 *
 * A Sketch Editor that opens onto a blank canvas while valid stroke data
 * exists is the defect this suite exists to catch. It asserts on the SVG the
 * editor produces - the paths and lines - rather than on the editor's model,
 * because "the model has strokes" is exactly the check that let an invisible
 * sketch through.
 *
 * It covers both editors, because they share one shell and one session:
 *
 *   the Statics Sketch Editor   a diagram drawn against a body's axis
 *   the Graph Sketch Editor     a whole coordinate graph
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

const canvas = dom.window.document.createElement("div");

canvas.className = "drawing-canvas";
dom.window.document.body.appendChild(canvas);

const { loadModule } = require("./helpers/source-path.cjs");

const staticsEditor = loadModule("sketch-editor.js").default;
const graphEditor = loadModule("math-sketch-editor.js");
const mathModel = loadModule("math-model.js").default;

/* ============================================================ helpers */

/* jsdom has no layout, so the SVG is given a box the mapping can use. */
function giveBox(svg, width, height) {
  svg.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width,
    height,
    right: width,
    bottom: height,
  });
}

function pointer(svg, type, x, y) {
  const event = new dom.window.MouseEvent(type, {
    bubbles: true,
    clientX: x,
    clientY: y,
    button: 0,
  });

  Object.defineProperty(event, "pointerId", { value: 1 });

  svg.dispatchEvent(event);
}

function drawStroke(svg, from, to, steps = 30) {
  pointer(svg, "pointerdown", from.x, from.y);

  for (let index = 1; index <= steps; index += 1) {
    const t = index / steps;

    pointer(
      svg,
      "pointermove",
      from.x + (to.x - from.x) * t,
      from.y + (to.y - from.y) * t,
    );
  }

  pointer(svg, "pointerup", to.x, to.y);
}

const click = (element) =>
  element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

const paths = (svg) => svg.querySelectorAll("path").length;
const lines = (svg) => svg.querySelectorAll("line").length;

/* ==================================================== statics editor */

console.log("\nThe Statics Sketch Editor draws");
console.log("--------------------------------");

const statics = staticsEditor.open({
  title: "SFD - Sketch",
  range: { from: 0, to: 10 },
  yRange: 20,
  elements: [],
  onApply: () => {},
  onCancel: () => {},
});

const staticsSvg = statics.querySelector("[data-sketch-svg]");

giveBox(staticsSvg, 900, 420);

check("it opens with a drawing surface", Boolean(staticsSvg));

check(
  "and an empty canvas has no strokes",
  paths(staticsSvg) === 0,
  String(paths(staticsSvg)),
);

/*
 * The frame is the ZERO LINE, not a box.
 *
 * The editor used to outline the plotting area with a rectangle, which read as
 * the coordinate system itself. The frame is a mapping, and the only line in it
 * the student reads a value against is zero - so there is a line and no box.
 */
check(
  "but it does draw its frame",
  staticsSvg.querySelectorAll(".sketch-editor-frame line").length > 0,
);

check(
  "and no box is drawn around it",
  staticsSvg.querySelectorAll(".sketch-editor-frame rect").length === 0,
  String(staticsSvg.querySelectorAll(".sketch-editor-frame rect").length),
);

/* A stroke appears WHILE it is being drawn. */
pointer(staticsSvg, "pointerdown", 200, 200);

for (let x = 210; x <= 400; x += 10) {
  pointer(staticsSvg, "pointermove", x, 200);
}

check(
  "a stroke is visible while it is being drawn",
  paths(staticsSvg) > 0,
  String(paths(staticsSvg)),
);

pointer(staticsSvg, "pointerup", 400, 200);

check(
  "and it stays visible after the pointer is released",
  paths(staticsSvg) > 0,
  String(paths(staticsSvg)),
);

/* A second stroke. */
drawStroke(staticsSvg, { x: 200, y: 300 }, { x: 400, y: 300 });

check(
  "a second stroke is added beside the first",
  paths(staticsSvg) === 2,
  String(paths(staticsSvg)),
);

/* Undo and redo are per action. */
click(statics.querySelector("[data-sketch-undo]"));

check(
  "Undo removes one stroke",
  paths(staticsSvg) === 1,
  String(paths(staticsSvg)),
);

click(statics.querySelector("[data-sketch-redo]"));

check("Redo puts it back", paths(staticsSvg) === 2, String(paths(staticsSvg)));

/* Erase is continuous and re-recognises. */
click(statics.querySelector('[data-sketch-tool="erase"]'));

pointer(staticsSvg, "pointerdown", 300, 200);
pointer(staticsSvg, "pointermove", 310, 200);
pointer(staticsSvg, "pointerup", 310, 200);

check(
  "erasing the middle of a stroke splits it in two",
  paths(staticsSvg) === 3,
  String(paths(staticsSvg)),
);

click(statics.querySelector("[data-sketch-undo]"));

check(
  "and one Undo restores the whole erase",
  paths(staticsSvg) === 2,
  String(paths(staticsSvg)),
);

/* An existing sketch loads visibly. */
staticsEditor.close();

const reopenedStatics = staticsEditor.open({
  title: "SFD - Sketch",
  range: { from: 0, to: 10 },
  yRange: 20,
  elements: [
    {
      id: "stroke-1",
      kind: "straight",
      points: [
        { x: 1, y: 2 },
        { x: 8, y: 6 },
      ],
      original: [
        { x: 1, y: 2 },
        { x: 8, y: 6 },
      ],
    },
  ],
  onApply: () => {},
  onCancel: () => {},
});

const reopenedStaticsSvg = reopenedStatics.querySelector("[data-sketch-svg]");

check(
  "an existing sketch loads visibly",
  paths(reopenedStaticsSvg) === 1,
  String(paths(reopenedStaticsSvg)),
);

staticsEditor.close();

/* ====================================================== graph editor */

console.log("\nThe Graph Sketch Editor draws");
console.log("------------------------------");

const graph = graphEditor.openSketchEditor(null, {
  onApply: () => {},
  onCancel: () => {},
});

const graphSvg = graph.querySelector("[data-sketch-svg]");

/* The canvas is measured, so the test gives it the box a stage would. */
giveBox(graphSvg, 900, 520);

graph.__datumSketch.refresh();

check("it opens with a drawing surface", Boolean(graphSvg));

check(
  "and the coordinate frame is drawn before anything is sketched",
  lines(graphSvg) > 20,
  String(lines(graphSvg)),
);

check("with no strokes yet", paths(graphSvg) === 0, String(paths(graphSvg)));

/*
 * THE UNNUMBERED GRID.
 *
 * A sketch's grid is a drawing aid, so its lines and ticks are drawn and NO
 * number is printed anywhere on the canvas. The numeric system is untouched -
 * the mapping, the spacing and snapping all still use it - which is what the
 * coordinate and snap tests prove.
 */
check(
  "a sketch prints no numbers on its grid or axes",
  graphSvg.querySelectorAll('[data-label="tick"]').length === 0,
  [...graphSvg.querySelectorAll("text")].map((node) => node.textContent).join(", "),
);

check(
  "while keeping the axis names, which are not numbers",
  [...graphSvg.querySelectorAll('[data-label="axis-name"]')].map((node) => node.textContent).join("") ===
    "xy",
  [...graphSvg.querySelectorAll("text")].map((node) => node.textContent).join(", "),
);

check(
  "and no markers at grid intersections",
  graphSvg.querySelectorAll("circle").length === 0,
  String(graphSvg.querySelectorAll("circle").length),
);

pointer(graphSvg, "pointerdown", 300, 300);

for (let x = 310; x <= 600; x += 10) {
  pointer(graphSvg, "pointermove", x, 300);
}

check(
  "a stroke is visible while it is being drawn",
  paths(graphSvg) > 0,
  String(paths(graphSvg)),
);

pointer(graphSvg, "pointerup", 600, 300);

/*
 * THE DEFECT THIS SUITE EXISTS FOR. The old editor drew the frame and the
 * in-progress stroke and nothing else, so the canvas went blank the moment the
 * pointer was released.
 */
check(
  "and the reconstructed stroke stays visible after release",
  paths(graphSvg) > 0,
  String(paths(graphSvg)),
);

check(
  "drawn as the correction, because Corrected is the default view",
  graphSvg.querySelectorAll(".sketch-corrected-stroke").length === 1,
  String(graphSvg.querySelectorAll(".sketch-corrected-stroke").length),
);

drawStroke(graphSvg, { x: 300, y: 400 }, { x: 600, y: 400 });

check(
  "a second stroke is added",
  graphSvg.querySelectorAll(".sketch-corrected-stroke").length === 2,
  String(graphSvg.querySelectorAll(".sketch-corrected-stroke").length),
);

click(graph.querySelector("[data-sketch-undo]"));

check(
  "Undo removes one stroke",
  graphSvg.querySelectorAll(".sketch-corrected-stroke").length === 1,
  String(graphSvg.querySelectorAll(".sketch-corrected-stroke").length),
);

click(graph.querySelector("[data-sketch-redo]"));

check(
  "Redo puts it back",
  graphSvg.querySelectorAll(".sketch-corrected-stroke").length === 2,
  String(graphSvg.querySelectorAll(".sketch-corrected-stroke").length),
);

/* THE THREE VIEWS. */
click(graph.querySelector('[data-sketch-view="original"]'));

check(
  "the Original view draws the strokes as they were drawn",
  graphSvg.querySelectorAll(".sketch-raw-stroke").length === 2 &&
    graphSvg.querySelectorAll(".sketch-corrected-stroke").length === 0,
);

click(graph.querySelector('[data-sketch-view="overlay"]'));

check(
  "the Overlay view draws both",
  graphSvg.querySelectorAll(".sketch-raw-stroke").length === 2 &&
    graphSvg.querySelectorAll(".sketch-corrected-stroke").length === 2,
);

click(graph.querySelector('[data-sketch-view="corrected"]'));

check(
  "and Corrected draws only the correction",
  graphSvg.querySelectorAll(".sketch-raw-stroke").length === 0 &&
    graphSvg.querySelectorAll(".sketch-corrected-stroke").length === 2,
);

/* POINTS: ONLY THE STUDENT'S OWN. */
click(graph.querySelector("[data-sketch-tool-point]"));
pointer(graphSvg, "pointerdown", 450, 260);
pointer(graphSvg, "pointerup", 450, 260);

const withPoint = graph.__datumSketch.stats();

check(
  "a click with the Point tool places exactly one point",
  withPoint.points.length === 1,
  JSON.stringify(withPoint.points),
);

check(
  "and it is drawn as a marker",
  graphSvg.querySelectorAll("[data-sketch-handle]").length === 1,
  String(graphSvg.querySelectorAll("[data-sketch-handle]").length),
);

check(
  "with no marker for the hundreds of stroke samples",
  graphSvg.querySelectorAll("circle").length === 2,
  `${graphSvg.querySelectorAll("circle").length} circles for ${withPoint.strokes.reduce((total, n) => total + n, 0)} samples`,
);

/* An existing graph loads visibly. */
graphEditor.closeSketchEditor();

const existing = mathModel.createMathPlot({ x: 0, y: 0 }, 200, 200, {
  mode: "sketch",
  functions: [
    mathModel.createSketchFunction({
      points: [
        { x: -2, y: 0 },
        { x: 0, y: 3 },
        { x: 2, y: 0 },
      ],
      segments: [],
      original: [],
    }),
  ],
});

const reopenedGraph = graphEditor.openSketchEditor(existing, {
  onApply: () => {},
  onCancel: () => {},
});

const reopenedGraphSvg = reopenedGraph.querySelector("[data-sketch-svg]");

giveBox(reopenedGraphSvg, 900, 520);
reopenedGraph.__datumSketch.refresh();

check(
  "an existing graph loads its strokes visibly",
  paths(reopenedGraphSvg) >= 1,
  String(paths(reopenedGraphSvg)),
);

check(
  "and its frame with them",
  lines(reopenedGraphSvg) > 20,
  String(lines(reopenedGraphSvg)),
);

check(
  "and it is still unnumbered",
  reopenedGraphSvg.querySelectorAll('[data-label="tick"]').length === 0,
);

graphEditor.closeSketchEditor();

/* ============================================================ summary */

console.log(`\n${pass} passed, ${fail} failed`);

if (fail > 0) {
  process.exitCode = 1;
}
