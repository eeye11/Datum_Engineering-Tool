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
const cvs = globalThis.document.createElement("div");
cvs.className = "drawing-canvas";
globalThis.document.body.appendChild(cvs);
const { loadModule } = require("./helpers/source-path.cjs");
const ds = loadModule("drawing-state.js").default;
const es = loadModule("editor-state.js");
const ce = loadModule("canvas-events.js");
const state = es.drawingState;
const canvas = globalThis.document.querySelector(".drawing-canvas");
canvas.getBoundingClientRect = () => ({
  left: 0,
  top: 0,
  width: 800,
  height: 600,
  right: 800,
  bottom: 600,
  x: 0,
  y: 0,
});
Object.defineProperty(canvas, "clientWidth", {
  configurable: true,
  value: 800,
});
Object.defineProperty(canvas, "clientHeight", {
  configurable: true,
  value: 600,
});
ce.installCanvasEvents();
state.objects = [];
state.activeTool = "freeform-polygon";
state.camera.zoom = 1;
state.camera.panX = 0;
state.camera.panY = 0;
ds.clearSelection(state);
ds.clearInteraction(state);
const ME = globalThis.window.MouseEvent;
const fire = (t, p, d) =>
  canvas.dispatchEvent(
    new ME(t, {
      bubbles: true,
      cancelable: true,
      clientX: p.x,
      clientY: p.y,
      detail: d,
    }),
  );
[
  [200, 200],
  [400, 200],
  [400, 400],
].forEach(([x, y]) => fire("click", { x, y }, 1));
console.log(
  "n after 3:",
  state.interaction.points.length,
  JSON.stringify(state.interaction.points),
);
fire("click", { x: 200, y: 400 }, 1);
console.log(
  "n after click1 of pair:",
  state.interaction.points.length,
  JSON.stringify(state.interaction.points),
);
fire("click", { x: 200, y: 400 }, 2);
console.log("n after click2 of pair:", state.interaction.points.length);
fire("dblclick", { x: 200, y: 400 }, 2);
const poly = state.objects[0];
console.log("POLY n=", poly && poly.geometry.points.length);
console.log(JSON.stringify(poly && poly.geometry.points));
