/* Probe: replicate the body-drag test exactly, via the real creation gesture. */
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

function pointer(type, point) {
  const e = new globalThis.window.MouseEvent(type, {
    clientX: CANVAS.left + CANVAS.width / 2 + point.x * PIXELS_PER_UNIT,
    clientY: CANVAS.top + CANVAS.height / 2 - point.y * PIXELS_PER_UNIT,
    bubbles: true,
    button: 0,
  });
  e.pointerId = 1;
  e.pointerType = "mouse";
  return e;
}

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
  const tool = require(locate("fluids-schematic-tool.js"));
  const creation = require(locate("creation-drag.js"));
  const settings = require(locate("tool-settings-store.js")).settingsFor(
    "reservoir-tank",
  );

  state.objects = [];
  state.selection.selectedObjectIds = [];
  state.camera.zoom = 1;
  state.camera.panX = 0;
  state.camera.panY = 0;
  state.grid = { ...(state.grid || {}), snapToGrid: false };

  /* drawVessel: arm, press, move, release. */
  tool.beginVesselToolSession();
  creation.beginCreationDrag(pointer("pointerdown", { x: 0, y: 0 }));
  creation.moveCreationDrag(pointer("pointermove", { x: 0, y: 0 }));
  creation.moveCreationDrag(pointer("pointermove", { x: 40, y: 30 }));
  creation.finishCreationDrag(pointer("pointerup", { x: 40, y: 30 }));

  const vessel = state.objects.find(
    (o) => o.id === state.selection.selectedObjectIds[0],
  );
  console.log("created:", JSON.stringify(vessel.geometry));
  console.log("grid:", JSON.stringify(state.grid));
  console.log(
    "fluidLevel:",
    vessel.metadata?.fluidLevelPercent,
    vessel.metadata?.fluidLevel,
  );

  state.activeTool = "select";
  state.selection.selectedObjectIds = [vessel.id];

  const centre = vesselModel.vesselRect(vessel).centre;
  console.log("centre:", JSON.stringify(centre));

  const allHandles = handles.editableHandlesFor(vessel);
  console.log(
    "handles:",
    allHandles.map((h) => `${h.kind}@(${h.point.x},${h.point.y})`).join("  "),
  );

  const hit = handles.handleAtPoint(centre);
  console.log("handleAtPoint(centre) ->", hit ? hit.handle.kind : "null");

  drag.beginManipulationDrag(pointer("pointerdown", centre));
  console.log("begin kind:", editorState.manipulationDrag?.kind);
  console.log(
    "drag.start:",
    JSON.stringify(editorState.manipulationDrag?.start),
  );

  drag.updateManipulationDrag(
    pointer("pointermove", { x: centre.x + 30, y: centre.y + 15 }),
  );
  console.log("after move:", JSON.stringify(vessel.geometry));

  drag.finishManipulationDrag(
    pointer("pointerup", { x: centre.x + 30, y: centre.y + 15 }),
  );
  const live = state.objects.find((o) => o.id === vessel.id);
  console.log("after finish:", JSON.stringify(live.geometry));
});
