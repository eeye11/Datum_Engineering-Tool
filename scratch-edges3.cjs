const { whenReady } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

(async () => {
  await whenReady();
  require(locate("features-editor.js"));

  const dom = require(locate("interaction/dom.js"));
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

  const state = require(locate("editor-state.js")).drawingState;
  const ds = require(locate("drawing-state.js")).default;
  const V = require(locate("model/fluids/reservoir-tank.js")).default;
  const handles = require(locate("handles.js"));
  const drag = require(locate("drag.js"));
  const dm = require(locate("direct-manipulation.js"));
  const precision = require(locate("pointer-precision.js"));

  state.objects = [];
  state.selection.selectedObjectIds = [];
  state.activeTool = "select";
  state.camera.zoom = 1;
  state.camera.panX = 0;
  state.camera.panY = 0;
  state.interaction = { phase: "idle", preview: null };
  precision.setPointerKind("mouse");

  const v = V.vesselFromDrag({ x: 0, y: 0 }, { x: 40, y: 40 });
  ds.addObject(state, v);
  const c = state.objects.find((o) => o.id === v.id);
  state.selection.selectedObjectIds = [c.id];

  console.log("allows:", dm.allowsDirectManipulation());
  console.log("construction:", handles.isConstructionInProgress());
  console.log(
    "modifySession:",
    Boolean(require(locate("editor-state.js")).editorState.modifySession),
  );

  const h = handles
    .editableHandlesFor(c)
    .find((x) => x.kind === "vessel-edge-left");
  const e = new window.MouseEvent("pointerdown", {
    clientX: 400 - 3 * 20,
    clientY: 300 - 20 * 20,
    bubbles: true,
    button: 0,
  });
  e.pointerId = 1;
  e.pointerType = "mouse";

  console.log("hit:", handles.handleAtPoint(h.point)?.handle?.kind);
  console.log(
    "begin:",
    drag.beginManipulationDrag(e),
    "->",
    state.manipulationDrag?.kind,
  );

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
