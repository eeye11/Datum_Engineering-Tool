const path = require("path");
const { JSDOM } = require("jsdom");
const projectRoot = path.join(__dirname, "..");
const { createHarness } = require("./harness-renderer.cjs");
createHarness(projectRoot, JSDOM, require);
[
  "drawingToolMessage",
  "drawingToolHeading",
  "drawingToolList",
  "drawingCoordinates",
  "drawingZoomValue",
].forEach((id) => {
  const e = globalThis.document.createElement("div");
  e.id = id;
  globalThis.document.body.appendChild(e);
});
const cv = globalThis.document.createElement("div");
cv.className = "drawing-canvas";
globalThis.document.body.appendChild(cv);
const { loadModule } = require("./helpers/source-path.cjs");

const dsMod = loadModule("drawing-state.js");
const ds = dsMod.default || dsMod;
const creation = loadModule("geometry-creation.js");
const selection = loadModule("selection.js");
const es = loadModule("editor-state.js");
const writerMod = loadModule("source-writers/geometry.js");
const writer = writerMod.default || writerMod;
const state = es.drawingState;

state.objects = [];
state.activeTool = "freeform-polygon";
state.camera.zoom = 1;
ds.clearSelection(state);
ds.clearInteraction(state);

[
  [0, 50],
  [40, 0],
  [80, 50],
  [40, 90],
].forEach(([x, y]) =>
  creation.beginOrCompleteGeometry({
    effectiveConstructionPoint: { x, y },
    rawPointerPoint: { x, y },
    modifiers: { shift: false, alt: false, ctrl: false },
  }),
);
selection.finishActiveConstruction();

const poly = state.objects[0];
console.log(
  "keys",
  Object.keys(writer).slice(0, 8),
  "...",
  Object.keys(writer).filter((k) => k.includes("freeform")),
);
const fn = writer["freeform-polygon"] || writer.default?.["freeform-polygon"];
console.log("fn?", typeof fn);
console.log(JSON.stringify(poly.geometry));
console.log("writer output:", JSON.stringify(fn && fn(poly, {})));
