const path = require("path");
const { JSDOM } = require("jsdom");
const projectRoot = path.join(__dirname, "..");
const { createHarness } = require("./harness-renderer.cjs");
createHarness(projectRoot, JSDOM, require);
const { loadModule } = require("./helpers/source-path.cjs");

const dsMod = loadModule("drawing-state.js");
const ds = dsMod.default || dsMod;
const creation = loadModule("geometry-creation.js");
const selection = loadModule("selection.js");
const es = loadModule("editor-state.js");
const state = es.drawingState;

state.objects = [];
state.activeTool = "freeform-polygon";
state.camera.zoom = 1;
ds.clearSelection(state);
ds.clearInteraction(state);

function click(p) {
  creation.beginOrCompleteGeometry({
    effectiveConstructionPoint: { x: p.x, y: p.y },
    rawPointerPoint: { x: p.x, y: p.y },
    modifiers: { shift: false, alt: false, ctrl: false },
  });
  console.log(
    "after click",
    JSON.stringify(p),
    "points=",
    JSON.stringify(state.interaction.points.map((v) => [v.x, v.y])),
    "objects=",
    state.objects.length,
  );
}

[
  [0, 0],
  [60, 0],
  [60, 60],
  [0, 60],
].forEach(([x, y]) => click({ x, y }));
click({ x: 3, y: 3 });
console.log(
  "polygons:",
  state.objects.filter((o) => o.type === "freeform-polygon").length,
);
console.log("phase:", state.interaction.phase, "tool:", state.activeTool);
