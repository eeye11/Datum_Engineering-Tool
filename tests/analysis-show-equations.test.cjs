
const { JSDOM } = require("jsdom");

const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * ========================================================
 * SHOW EQUATIONS
 * ========================================================
 *
 * Optional labels beside each plotted region. Three things about them are
 * worth protecting, and all three were decisions rather than defaults.
 *
 * OFF BY DEFAULT. A diagram with its equations written on it reads as a
 * finished answer. A working sheet is a student thinking, not a result.
 *
 * A VERTICAL RELATION IS NOT GIVEN A FUNCTION. `x = 4` says `x = 4`. Writing
 * `V(x) = ...` beside it would assert that a vertical jump is a function of
 * x, which is the specific lie this relation type exists to avoid.
 *
 * EACH LABEL SITS BESIDE ITS OWN MARK. Three regions of one SFD all need a
 * label; stacking them in one corner would put two on top of each other and
 * leave a third describing nothing.
 */


const projectRoot = path.join(__dirname, "..");
const dir = sourceDir();

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

const dom = new JSDOM(
  '<!doctype html><html><body><div id="canvas"></div></body></html>',
  { pretendToBeVisual: true },
);

global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.window.requestAnimationFrame = global.requestAnimationFrame;
global.window.cancelAnimationFrame = (id) => clearTimeout(id);

for (const name of [
  "measurement-core.js",
  "quantities.js",
  "dimension-model.js",
  "annotation-model.js",
  "diagram-equations.js",
  "load-profile.js",
  "body-frames.js",
  "feature-geometry.js",
  "drawing-state.js",
  "analysis-dependencies.js",
  "renderer.js",
]) {
  loadModule(name);
}

/*
 * The modules attach to `window`; the renderer reads some of them as bare
 * globals. Bridging every one that was attached is deliberate rather than
 * listing them: adding a module later should not mean this test starts
 * throwing on a name nobody remembered to add here.
 */
for (const name of Object.keys(global.window)) {
  if (/^engg[A-Z]/.test(name) && global[name] === undefined) {
    global[name] = global.window[name];
  }
}

const renderer = global.window.enggDrawingRenderer;
const canvas = global.document.getElementById("canvas");

const scene = (objects, display = {}) => ({
  objects,
  display: { showMagnitudes: true, showUnits: true, ...display },
  scale: { mmPerUnit: 1, unit: "mm" },
  selection: {
    selectedObjectIds: [],
    boxSelectionIds: [],
    hoveredObjectId: null,
  },
  interaction: { phase: "idle", preview: null, previewObjects: [] },
  camera: { zoom: 1, panX: 0, panY: 0 },
  styleDefaults: { stroke: "#000000", lineWidth: 0.5 },
  grid: { visible: false, spacing: 10 },
  snap: { enabled: false },
});

const diagram = (geometry) => ({
  id: "sfd-1",
  type: "analysis-diagram",
  name: "SFD 1",
  geometry: {
    diagramType: "sfd",
    mode: "plot",
    start: { x: 0, y: 0 },
    end: { x: 300, y: 0 },
    localRange: { from: 0, to: 300 },
    showZeroAxis: true,
    ...geometry,
  },
  style: { stroke: "#000000", lineWidth: 0.5 },
});

const equationTexts = (object) => {
  renderer.renderDrawing(scene([object]), canvas);

  return [...canvas.querySelectorAll(".drawing-analysis-equation")].map(
    (t) => t.textContent,
  );
};

console.log("\n  off by default\n");

const piecewise = diagram({
  expressions: [
    {
      id: "e1",
      relationType: "functionX",
      expression: "10",
      xRange: { start: 0, end: 100 },
    },
    {
      id: "e2",
      relationType: "functionX",
      expression: "10 - 5*x",
      xRange: { start: 100, end: 300 },
    },
  ],
});

check(
  "nothing is labelled until it is asked for",
  equationTexts(piecewise).length === 0,
  `drew ${JSON.stringify(equationTexts(piecewise))}`,
);

console.log("\n  and then each region gets its own\n");

const shown = equationTexts(
  diagram({
    ...piecewise.geometry,
    showEquations: true,
  }),
);

check(
  "one label per region",
  shown.length === 2,
  `drew ${JSON.stringify(shown)}`,
);

check(
  "the first says what the student typed",
  shown.includes("V(x) = 10"),
  `got ${JSON.stringify(shown)}`,
);

check(
  "and so does the second",
  shown.includes("V(x) = 10 - 5*x"),
  `got ${JSON.stringify(shown)}`,
);

console.log("\n  a vertical relation is not called a function\n");

const withJump = equationTexts(
  diagram({
    showEquations: true,
    expressions: [
      {
        id: "e1",
        relationType: "functionX",
        expression: "10",
        xRange: { start: 0, end: 100 },
      },
      {
        id: "v1",
        relationType: "verticalLine",
        x: 100,
        yRange: { start: -10, end: 10 },
      },
    ],
  }),
);

check(
  "it says x = ... instead",
  withJump.some((t) => /^x = /.test(t)),
  `got ${JSON.stringify(withJump)}`,
);

check(
  "and it says x = the station it stands at",
  withJump.includes("x = 100"),
  `got ${JSON.stringify(withJump)}`,
);

/*
 * NOT "no label starts with V(x)" - the CURVE beside the jump legitimately
 * does, and asserting that would be asserting that the function label is
 * broken. The jump's own label is checked above; this checks there are
 * exactly the two expected labels and no third.
 */
check(
  "and there is no third label claiming to be the jump",
  withJump.length === 2,
  `got ${JSON.stringify(withJump)} - a vertical jump labelled as a function would add one`,
);

console.log("\n  the symbol comes from the diagram\n");

const bmd = equationTexts({
  ...diagram({
    showEquations: true,
    expressions: [
      {
        id: "e1",
        relationType: "functionX",
        expression: "4*x - x^2",
        xRange: { start: 0, end: 300 },
      },
    ],
  }),
  geometry: {
    ...diagram({
      showEquations: true,
      expressions: [],
    }).geometry,
    diagramType: "bmd",
    showEquations: true,
    expressions: [
      {
        id: "e1",
        relationType: "functionX",
        expression: "4*x - x^2",
        xRange: { start: 0, end: 300 },
      },
    ],
  },
});

check(
  "a moment diagram writes M(x)",
  bmd.some((t) => t.startsWith("M(x)")),
  `got ${JSON.stringify(bmd)}`,
);

console.log("\n  each label sits beside its own mark\n");

const labels = renderer.equationLabels({
  ...piecewise.geometry,
  showEquations: true,
});

check(
  "one label per expression",
  labels.length === 2,
  `got ${labels.length}`,
);

const firstX = labels[0].at.x;
const secondX = labels[1].at.x;

check(
  "and the two are in different places",
  firstX !== secondX,
  `both labels landed at x=${firstX}`,
);

console.log("\n  and they are not pickable\n");

renderer.renderDrawing(
  scene([diagram({ ...piecewise.geometry, showEquations: true })]),
  canvas,
);

const label = canvas.querySelector(".drawing-analysis-equation");

check(
  "a label ignores the pointer",
  label.getAttribute("pointer-events") === "none",
  `got ${label.getAttribute("pointer-events")}`,
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
