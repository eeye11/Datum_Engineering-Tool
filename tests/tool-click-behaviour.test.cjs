/*
 * ========================================================
 * WHICH TOOLS A CLICK SHOULD AND SHOULDN'T EXIT
 * ========================================================
 *
 * A click on the canvas means different things to different tools, and getting
 * the classification wrong is how a student ends up either trapped in a tool or
 * with a tool yanked out from under a half-finished input.
 *
 *   POINT tools            place their feature on the click; keep the tool
 *   REQUIRED-INPUT tools   are waiting for something specific; keep the click
 *   ONE-GESTURE path tools made by press-drag-release; a bare click means "done"
 *                          and returns to Select
 *   MULTI-CLICK tools      build from a sequence of clicks; keep the click
 *
 * This pins that classification and the router's use of it.
 */

const fs = require("fs");

const { locate, modulePath } = require("./helpers/source-path.cjs");

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

/*
 * The classifier is loaded through Node's ESM require, like the other source
 * modules. It imports the creation layer, which imports a chain of editor
 * modules - so a DOM stub is needed, exactly as for the other editor tests.
 */
const { JSDOM } = require("jsdom");

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "https://datum.test/",
});

global.window = dom.window;
global.document = dom.window.document;
global.Element = dom.window.Element;

dom.window.document.body.innerHTML = `
  <div class="drawing-canvas"></div>
  <div id="drawingProperties"></div>
  <div id="drawingToolMessage"></div>
  <div id="drawingCoordinates"></div>
  <div id="drawingZoomValue"></div>
  <button id="drawingUndo"></button>
  <button id="drawingRedo"></button>
  <div id="drawingToolHeading"></div>
  <div id="drawingToolList"></div>
  <div id="drawingFeaturesBack"></div>
`;

const classification = require(modulePath("tool-classification.js"));

const { isPointTool, hasRequiredInput, shouldExitToSelectOnClick } =
  classification;

const canvasClick = fs.readFileSync(locate("canvas-click.js"), "utf8");

console.log("\n  point tools keep working on a click\n");

for (const tool of ["point", "particle", "reference-point", "pin-support", "moment"]) {
  check(`${tool} is a point tool`, isPointTool(tool));
  check(
    "  and a click does NOT exit it",
    shouldExitToSelectOnClick(tool) === false,
  );
}

console.log("\n  required-input tools keep the click\n");

for (const tool of [
  "dimension",
  "resultant",
  "force-components",
  "label",
  "leader",
  "callout",
]) {
  check(`${tool} has a required input`, hasRequiredInput(tool));
  check(
    `  so a click does not exit it`,
    shouldExitToSelectOnClick(tool) === false,
  );
}

console.log("\n  a one-gesture path tool exits on a bare click\n");

for (const tool of ["arrow"]) {
  check(
    `${tool} exits to Select on a click`,
    shouldExitToSelectOnClick(tool) === true,
    "the tool must not trap the student",
  );
}

console.log("\n  the Statics two-point tools take click-move-click\n");

for (const tool of ["beam", "point-force", "pin-connection", "reference-line"]) {
  check(
    `${tool} keeps a bare click as its first point`,
    shouldExitToSelectOnClick(tool) === false,
    "a click is the start of the feature, as with a Line",
  );
}

console.log("\n  Geometry's Line, Rectangle and Circle take click-move-click too\n");

for (const tool of ["line", "rectangle", "circle"]) {
  check(
    `${tool}: a bare click is the first point, not an exit`,
    shouldExitToSelectOnClick(tool) === false,
    "click-move-click must draw the shape",
  );
}

console.log("\n  a POINT-PLACED annotate kind does NOT exit (its click creates it)\n");

for (const tool of ["note", "label", "symbol", "tolerance", "table"]) {
  check(
    `${tool} keeps the click - it places on it`,
    shouldExitToSelectOnClick(tool) === false,
    "a note is made BY that click, not ended by it",
  );
}

console.log("\n  multi-click tools do NOT exit on a click\n");

for (const tool of ["polyline", "truss", "triangle", "polygon", "arc", "distributed-load"]) {
  check(
    `${tool} keeps its click workflow`,
    shouldExitToSelectOnClick(tool) === false,
    "these build from a SEQUENCE of clicks",
  );
}

console.log("\n  Select is left alone\n");

check(
  "Select never 'exits'",
  shouldExitToSelectOnClick("select") === false,
);

console.log("\n  the click router uses the classification\n");

check(
  "a bare click on a one-gesture tool returns to Select",
  /shouldExitToSelectOnClick\([\s\S]{0,80}?exitToolToSelect/.test(canvasClick) ||
    /finishCreationClick\(\s*session\s*\)/.test(
      fs.readFileSync(locate("creation-drag.js"), "utf8"),
    ) ||
    /activateTool\("select"\)[\s\S]{0,400}?selectObject/.test(
      fs.readFileSync(locate("creation-drag.js"), "utf8"),
    ),
  "the tool must hand the canvas back to Select",
);

check(
  "and it is checked BEFORE the construction pipeline consumes the click",
  canvasClick.indexOf("shouldExitToSelectOnClick") <
    canvasClick.indexOf("isConstructionTool(\n            drawingState.activeTool\n        )\n    ) {\n        beginOrCompleteGeometry"),
  "otherwise the click becomes a phantom first point",
);

check(
  "while the dimension and annotate handlers still run first",
  canvasClick.indexOf("handleDimensionClick") <
    canvasClick.indexOf("shouldExitToSelectOnClick") &&
    canvasClick.indexOf("handleAnnotateClick") <
      canvasClick.indexOf("shouldExitToSelectOnClick"),
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
