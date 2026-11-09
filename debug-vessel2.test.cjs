/* Temporary probe: does beginManipulationDrag find the vessel edge handle? */
const test = require("node:test");
const assert = require("node:assert/strict");
const { bootApp, whenReady } = require("./helpers/boot-app.cjs");
const { locate } = require("./helpers/source-path.cjs");

test.after(() => setImmediate(() => process.exit(process.exitCode || 0)));

const PIXELS_PER_UNIT = 2.4;
const CANVAS = {
  left: 0,
  top: 0,
  width: 800,
  height: 600,
  right: 800,
  bottom: 600,
  x: 0,
  y: 0,
};

test("probe", async () => {
  const page = bootApp();
  if (page.error) throw page.error;
  await whenReady();

  const dom = require(locate("interaction/dom.js"));
  dom.drawingCanvas.getBoundingClientRect = () => CANVAS;
  Object.defineProperty(dom.drawingCanvas, "clientWidth", {
    value: 800,
    configurable: true,
  });
  Object.defineProperty(dom.drawingCanvas, "clientHeight", {
    value: 600,
    configurable: true,
  });
  dom.drawingCanvas.setPointerCapture = () => {};
  dom.drawingCanvas.releasePointerCapture = () => {};
  dom.drawingCanvas.hasPointerCapture = () => true;

  require(locate("features-editor.js"));

  const state = require(locate("editor-state.js")).drawingState;
  const editorState = require(locate("editor-state.js")).editorState;
  const handles = require(locate("handles.js"));
  const drag = require(locate("drag.js"));
  const vesselModel = require(locate("model/fluids/reservoir-tank.js")).default;

  state.objects = [];
  state.selection.selectedObjectIds = [];
  state.camera.zoom = 1;
  state.camera.panX = 0;
  state.camera.panY = 0;
  state.activeTool = "select";

  const v = {
    id: "v1",
    type: "reservoir-tank",
    geometry: { position: { x: 0, y: 0 }, width: 40, height: 40, rotation: 0 },
    style: {},
    metadata: {},
  };
  state.objects.push(v);
  state.selection.selectedObjectIds = [v.id];

  const all = handles.editableHandlesFor(v);
  console.log("editable handle kinds:", all.map((h) => h.kind).join(", "));

  const left = all.find((h) => h.kind === "vessel-edge-left");
  console.log("left handle:", JSON.stringify(left));

  const pointer = (type, point) => {
    const e = new globalThis.window.MouseEvent(type, {
      clientX: CANVAS.left + CANVAS.width / 2 + point.x * PIXELS_PER_UNIT,
      clientY: CANVAS.top + CANVAS.height / 2 - point.y * PIXELS_PER_UNIT,
      bubbles: true,
      button: 0,
    });
    e.pointerId = 1;
    e.pointerType = "mouse";
    return e;
  };

  const hit = handles.handleAtPoint(left.point);
  console.log("handleAtPoint ->", hit ? hit.handle.kind : "null");

  const began = drag.beginManipulationDrag(pointer("pointerdown", left.point));
  console.log("beginManipulationDrag ->", began);
  console.log("drag kind:", editorState.manipulationDrag?.kind);

  drag.updateManipulationDrag(pointer("pointermove", { x: -10, y: 20 }));
  console.log("after move geometry:", JSON.stringify(v.geometry));

  drag.finishManipulationDrag(pointer("pointerup", { x: -10, y: 20 }));
  console.log("after finish geometry:", JSON.stringify(v.geometry));
  console.log("rect:", JSON.stringify(vesselModel.vesselRect(v)));
});
