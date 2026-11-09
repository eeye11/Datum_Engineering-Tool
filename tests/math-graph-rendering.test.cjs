/* eslint-disable no-console */
/*
 * ========================================================
 * THE GRAPH ACTUALLY RENDERS
 * ========================================================
 *
 * A Graph that exists in the model but draws nothing is not a Graph. This suite
 * asserts on the SVG the renderer produces - the lines, paths and text nodes -
 * rather than on the object being present, because "the object was created" is
 * exactly the check that let an invisible graph through.
 *
 * It covers the failure that was actually found: a curve sampled from `x^2`
 * over -5..5 reaches 25, and with a fixed -5..5 Y range every point of it was
 * drawn ABOVE the plot area. The object was there, the samples were there, and
 * the student saw an empty grid.
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

const { drawingState } = loadModule("editor-state.js");
const mathModel = loadModule("math-model.js").default;
const mathCreation = loadModule("math-creation.js").default;
const entityRender = loadModule("entity-render.js");
const featureGeometry = loadModule("feature-geometry.js").default;

const bounds = {
  width: 900,
  height: 600,
  left: 0,
  top: 0,
  right: 900,
  bottom: 600,
};

/* Draw one object through the real entity renderer and hand back its SVG. */
function render(object) {
  const svg = dom.window.document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );

  entityRender.appendEntity(svg, object, drawingState, bounds);

  return svg;
}

const count = (svg, tag) => svg.querySelectorAll(tag).length;

function reset() {
  drawingState.objects = [];
  drawingState.selection.selectedObjectIds = [];
  drawingState.interaction = { phase: "idle" };
  drawingState.activeTool = "select";
}

/* ====================================================== the frame */

console.log("\nAn empty graph still draws its frame");
console.log("------------------------------------");

reset();

const empty = mathCreation.createMathPlotFromDrag(
  { x: 0, y: 0 },
  { x: 200, y: 200 },
);
const emptySvg = render(empty);

check(
  "an empty graph draws lines",
  count(emptySvg, "line") > 0,
  String(count(emptySvg, "line")),
);

check(
  "and tick labels",
  count(emptySvg, "text") > 0,
  String(count(emptySvg, "text")),
);

check(
  "and its axis names",
  [...emptySvg.querySelectorAll("text")].some(
    (node) => node.textContent === "x",
  ) &&
    [...emptySvg.querySelectorAll("text")].some(
      (node) => node.textContent === "y",
    ),
);

/* ====================================================== one curve */

console.log("\nOne expression draws one curve");
console.log("-------------------------------");

reset();

const one = mathCreation.createMathPlotFromDrag(
  { x: 0, y: 0 },
  { x: 200, y: 200 },
);
const oneSvg = render(one);

check(
  "a new graph starts with one function",
  mathModel.plotFunctions(one).length === 1,
);

check(
  "and its curve is drawn",
  count(oneSvg, "path") > 0,
  String(count(oneSvg, "path")),
);

/*
 * THE CURVE IS INSIDE THE PLOT AREA. This is the assertion the old
 * implementation failed: the path existed, and every point of it was above the
 * box.
 */
const mapping = mathModel.graphMapping(one);
const curve = mathModel.curveStrokes(one)[0];

check(
  "and every point of it is inside the plot area",
  curve.every(
    (point) =>
      point.x >= mapping.left - 1 &&
      point.x <= mapping.right + 1 &&
      point.y >= mapping.bottom - 1 &&
      point.y <= mapping.top + 1,
  ),
  `x ${Math.min(...curve.map((p) => p.x)).toFixed(1)}..${Math.max(...curve.map((p) => p.x)).toFixed(1)}, ` +
    `y ${Math.min(...curve.map((p) => p.y)).toFixed(1)}..${Math.max(...curve.map((p) => p.y)).toFixed(1)} ` +
    `against ${mapping.left.toFixed(1)}..${mapping.right.toFixed(1)} / ${mapping.bottom.toFixed(1)}..${mapping.top.toFixed(1)}`,
);

check(
  "the Y range is fitted to the function, not left at -5..5",
  mathModel.graphLimits(one).yMax > 5,
  JSON.stringify(mathModel.graphLimits(one)),
);

/* ====================================================== many curves */

console.log("\nSeveral expressions draw several curves");
console.log("---------------------------------------");

reset();

const many = mathCreation.createMathPlotFromDrag(
  { x: 0, y: 0 },
  { x: 200, y: 200 },
);

mathCreation.addPlotFunction(many, "2x + 1");

const manySvg = render(many);

check(
  "the graph holds two functions",
  mathModel.plotFunctions(many).length === 2,
);

check(
  "and both are drawn",
  mathModel.curveStrokes(many).length === 2,
  String(mathModel.curveStrokes(many).length),
);

check(
  "and the SVG has a path for each",
  count(manySvg, "path") >= 2,
  String(count(manySvg, "path")),
);

check(
  "adding a function does not create a second graph",
  drawingState.objects.filter((object) => object.type === "math-plot")
    .length === 1,
);

/* ====================================================== bad input */

console.log("\nA bad expression does not break the graph");
console.log("-----------------------------------------");

reset();

const mixed = mathCreation.createMathPlotFromDrag(
  { x: 0, y: 0 },
  { x: 200, y: 200 },
);

/*
 * ONE VALID FUNCTION AND ONE THE EVALUATOR CANNOT READ, pushed in as a saved
 * file might carry it. The graph must keep drawing the valid one.
 */
mixed.geometry.functions = [
  mathModel.createPlotFunction({ expression: "2x" }),
  { ...mathModel.createPlotFunction({ expression: "x^2" }), expression: "sin(x)" },
];

const mixedSvg = render(mixed);

check("the frame still draws", count(mixedSvg, "line") > 0);

check("and the valid curve still draws", count(mixedSvg, "path") > 0);

check(
  "and the invalid one contributes nothing",
  mathModel.curveStrokes(mixed).length === 1,
  `${mathModel.curveStrokes(mixed).length} strokes for ${mathModel.plotFunctions(mixed).length} functions`,
);

/* ====================================================== mapping */

console.log("\nThe coordinate mapping");
console.log("----------------------");

reset();

const mapped = mathCreation.createMathPlotFromDrag(
  { x: 0, y: 0 },
  { x: 200, y: 200 },
);
const map = mathModel.graphMapping(mapped);

check(
  "the origin sits at graph (0, 0)",
  Math.abs(mathModel.drawingToGraph(mapped, map.origin).x) < 1e-9 &&
    Math.abs(mathModel.drawingToGraph(mapped, map.origin).y) < 1e-9,
);

check(
  "equal unit scaling keeps one unit the same length on both axes",
  Math.abs(map.scaleX - map.scaleY) < 1e-9,
  `${map.scaleX} vs ${map.scaleY}`,
);

const beforeRange = mathModel.curveStrokes(mapped)[0][0];

mapped.geometry.xMin = -10;
mapped.geometry.xMax = 10;

const afterRange = mathModel.curveStrokes(mapped)[0][0];

check(
  "changing the X range re-samples the curve",
  Math.abs(beforeRange.x - afterRange.x) > 1e-6,
);

const beforeMove = mathModel.curveStrokes(mapped)[0][0];

featureGeometry.translateObject(mapped, 50, 50, () => null);

const afterMove = mathModel.curveStrokes(mapped)[0][0];

check(
  "moving the graph carries its curves",
  Math.abs(afterMove.x - beforeMove.x - 50) < 1e-6 &&
    Math.abs(afterMove.y - beforeMove.y - 50) < 1e-6,
);

/* ====================================================== sketch */

console.log("\nA sketched graph draws");
console.log("----------------------");

reset();

const sketched = mathCreation.commitSketchPlot(
  [
    {
      points: [
        { x: 0, y: 0 },
        { x: 50, y: 25 },
        { x: 100, y: 0 },
      ],
      segments: [],
      original: [],
    },
  ],
  { showOriginalTrace: true },
);

const sketchSvg = render(sketched);

check("a sketch becomes one graph", sketched.type === "math-plot");

check(
  "and its stroke is a component of it",
  mathModel.plotFunctions(sketched).length === 1,
);

check(
  "and it draws",
  count(sketchSvg, "path") > 0,
  String(count(sketchSvg, "path")),
);

check("and the frame draws with it", count(sketchSvg, "line") > 0);

/* ====================================================== persistence */

console.log("\nSaving and reopening");
console.log("--------------------");

reset();

const saved = mathCreation.createMathPlotFromDrag(
  { x: 0, y: 0 },
  { x: 200, y: 200 },
);

mathCreation.addPlotFunction(saved, "2x + 1");

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

const source = writer.mathSourceWriter(saved);
const reopened = reader.mathReaderFor(source)(source, {
  previous: null,
  hostExists: () => true,
});

check("a graph writes source", typeof source === "string" && source.length > 0);

check("and reads back as a graph", reopened && reopened.type === "math-plot");

check(
  "with both of its functions",
  reopened && reopened.geometry.functions.length === 2,
  JSON.stringify(
    reopened && reopened.geometry.functions.map((f) => f.expression),
  ),
);

check(
  "and its coordinate settings",
  reopened &&
    reopened.geometry.xMin === saved.geometry.xMin &&
    reopened.geometry.xMax === saved.geometry.xMax,
);

const reopenedSvg = render({ ...reopened, id: "reopened" });

check(
  "and the reopened graph draws",
  count(reopenedSvg, "path") >= 2,
  String(count(reopenedSvg, "path")),
);

/* ====================================================== summary */

console.log(`\n${pass} passed, ${fail} failed`);

if (fail > 0) {
  process.exitCode = 1;
}
