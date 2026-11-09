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

check(
  "but it does draw its frame",
  staticsSvg.querySelectorAll("rect").length > 0,
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

giveBox(graphSvg, 900, 520);

check("it opens with a drawing surface", Boolean(graphSvg));

check(
  "and the coordinate frame is drawn before anything is sketched",
  lines(graphSvg) > 20,
  String(lines(graphSvg)),
);

check("with no strokes yet", paths(graphSvg) === 0, String(paths(graphSvg)));

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

drawStroke(graphSvg, { x: 300, y: 400 }, { x: 600, y: 400 });

check(
  "a second stroke is added",
  paths(graphSvg) === 2,
  String(paths(graphSvg)),
);

click(graph.querySelector("[data-sketch-undo]"));

check(
  "Undo removes one stroke",
  paths(graphSvg) === 1,
  String(paths(graphSvg)),
);

click(graph.querySelector("[data-sketch-redo]"));

check("Redo puts it back", paths(graphSvg) === 2, String(paths(graphSvg)));

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

/*
 * THE FRAME PAINTER DRAWS THE GRAPH'S OWN FUNCTIONS TOO, so a reopened sketch
 * shows its curve twice over: once as the frame's function component and once
 * as the editor's own stroke. Both are the same geometry, and both are visible
 * - which is the point. What matters is that the canvas is not blank.
 */
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

graphEditor.closeSketchEditor();

/* ============================================================ summary */

console.log(`\n${pass} passed, ${fail} failed`);

if (fail > 0) {
  process.exitCode = 1;
}
