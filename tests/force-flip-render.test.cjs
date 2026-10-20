
const { JSDOM } = require("jsdom");

const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * ========================================================
 * DOES A REVERSED FORCE ACTUALLY DRAW POINTING BACKWARDS?
 * ========================================================
 *
 * A force is drawn from its APPLICATION POINT along its stored direction,
 * at the shared Visual Force Scale. Reversing the force turns the direction
 * through a half turn, so the drawn line leaves the same application point in
 * the opposite direction and the arrowhead arrives on the other side of it.
 * This file RENDERS and asks where the ink went, which is the only question a
 * student is actually asking.
 */


const projectRoot = path.join(__dirname, "..");

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
global.window.crypto = { randomUUID: () => "render-uuid" };

for (const name of [
  "measurement-core.js",
  "quantities.js",
  "dimension-model.js",
  "annotation-model.js",
  "load-profile.js",
  "body-frames.js",
  "feature-geometry.js",
  "drawing-state.js",
  "renderer.js",
]) {
  loadModule(name);
}

/*
 * THE RENDERER REACHES FOR ITS MODULES BY BARE NAME.
 *
 * In a browser every script's top-level `const` is not a global, but these
 * modules explicitly publish onto `window` and the renderer refers to the
 * bare identifiers - which only resolve because the modules are concatenated
 * into one scope. Under `require` they do not, so the published names are
 * mirrored onto the global object, exactly as the display-rendering harness
 * does. Without this the renderer throws on the first feature rather than
 * drawing it, which would be a failure of the harness rather than of the
 * thing under test.
 */
for (const name of [
  "enggDrawingState",
  "enggDrawingRenderer",
  "enggLoadProfile",
  "enggFeatureGeometry",
  "enggBodyFrames",
  "enggDimensionModel",
  "enggQuantities",
  "enggMeasurement",
  "enggAnnotationModel",
]) {
  if (global.window[name]) {
    global[name] = global.window[name];
  }
}

const renderer = global.window.enggDrawingRenderer;
const profile = global.window.enggLoadProfile;

let pass = 0;
let fail = 0;

const check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(
      `  FAIL ${name}${detail ? `\n       ${detail}` : ""}`,
    );
  }
};

/* ---------------------------------------------------------
 * Drawing, through a real canvas in a real document.
 * ------------------------------------------------------- */

function drawOnce(objects) {
  const host = global.document.createElement("div");

  global.document.body.appendChild(host);

  renderer.renderDrawing(baseState(objects), host);

  return host;
}

function baseState(objects) {
  return {
    objects,
    camera: { zoom: 1, panX: 0, panY: 0 },
    grid: { visible: false, spacing: 5 },
    snap: { enabled: false },
    display: { showMagnitudes: false, showUnits: true },
    styleDefaults: { stroke: "#000000", lineWidth: 0.5, lineType: "solid" },
    selection: {
      selectedObjectIds: [],
      boxSelectionIds: [],
      hoveredObjectId: null,
    },
    interaction: { phase: "idle", preview: null, previewObjects: [] },
  };
}

/*
 * WHERE THE INK IS, on screen. Read off the DOM rather than from the model,
 * because the whole of this file's claim is that the model was right and the
 * drawing was not.
 */
const lineEndpoints = (host) =>
  [...host.querySelectorAll("line")].map((line) => ({
    x1: Number(line.getAttribute("x1")),
    y1: Number(line.getAttribute("y1")),
    x2: Number(line.getAttribute("x2")),
    y2: Number(line.getAttribute("y2")),
  }));

function renderForce(geometry) {
  const force = {
    id: "force-1",
    type: "force",
    geometry,
    style: { stroke: "#000000", lineWidth: 1 },
    engineering: { discipline: "statics" },
  };

  const host = drawOnce([force]);

  const found = [...host.querySelectorAll("line")].map((line) => ({
    x1: Number(line.getAttribute("x1")),
    y1: Number(line.getAttribute("y1")),
    x2: Number(line.getAttribute("x2")),
    y2: Number(line.getAttribute("y2")),
  }));

  host.remove();

  return found;
}

console.log("\n  the drawn arrow, before and after a reversal\n");

const geometry = {
  start: { x: -100, y: 0 },
  position: { x: -100, y: 0 },
  end: { x: 100, y: 0 },
  magnitude: 200,
  angle: 0,
  forceX: 200,
  forceY: 0,
};

const before = renderForce(geometry);

check(
  "a force pointing +x draws a horizontal arrow",
  before.some(
    line =>
      Math.abs(line.y1 - line.y2) < 1e-6 && line.x2 > line.x1,
  ),
  `lines: ${JSON.stringify(before)}`,
);

const tipBefore = before.find(line => Math.abs(line.y1 - line.y2) < 1e-6);

/*
 * THE APPLICATION POINT, which a reversal does not move. The force is drawn
 * FROM it, so after a reversal the ink runs the other way from the same point.
 */
const applicationX = tipBefore
    ? Math.min(tipBefore.x1, tipBefore.x2)
    : null;

/*
 * THE REVERSAL. Everything below asks whether the INK moved, because that is
 * what the previous round of fixes checked and what they got wrong.
 */
profile.reverseForceDirection(geometry);

const after = renderForce(geometry);

const horizontal = after.filter(
  line => Math.abs(line.y1 - line.y2) < 1e-6,
);

check(
  "it is still drawn after a reversal",
  horizontal.length > 0,
  `lines: ${JSON.stringify(after)}`,
);

check(
  "the line still starts at the application point",
  horizontal.length > 0 &&
    applicationX !== null &&
    horizontal.some(
      line =>
        Math.max(line.x1, line.x2) === applicationX,
    ),
  `before ${JSON.stringify(tipBefore)}, after ${JSON.stringify(horizontal)}`,
);

check(
  "but the ARROWHEAD is now on the other end - it points the other way",
  horizontal.some(line => line.x2 < line.x1),
  `expected a leftward arrow, drew ${JSON.stringify(horizontal)}`,
);

console.log(
  `\n  ${pass} passed, ${fail} failed\n`,
);

if (fail) {
  process.exitCode = 1;
}
