const { bootApp, whenReady } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

(async () => {
  const page = bootApp();
  if (page.error) throw page.error;
  await whenReady();

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
  const editorState = require(locate("editor-state.js")).editorState;
  const ds = require(locate("drawing-state.js")).default;
  const tool = require(locate("fluids-schematic-tool.js"));
  const creation = require(locate("creation-drag.js"));

  state.objects = [];
  state.selection.selectedObjectIds = [];
  state.camera.zoom = 20 / ds.BASE_PIXELS_PER_UNIT;
  state.camera.panX = 0;
  state.camera.panY = 0;
  state.grid = { ...state.grid, snapToGrid: false };

  const PX = 20;
  const pointer = (type, p) => {
    const e = new window.MouseEvent(type, {
      clientX: 400 + p.x * PX,
      clientY: 300 - p.y * PX,
      bubbles: true,
      button: 0,
    });
    e.pointerId = 1;
    e.pointerType = "mouse";
    return e;
  };

  tool.beginVesselToolSession();
  console.log("armed", state.activeTool, state.interaction.phase);
  console.log(
    "down ->",
    creation.beginCreationDrag(pointer("pointerdown", { x: 0, y: 0 })),
  );
  creation.moveCreationDrag(pointer("pointermove", { x: 0, y: 0 }));
  creation.moveCreationDrag(pointer("pointermove", { x: 40, y: 30 }));
  console.log(
    "moved?",
    editorState.creationDrag?.moved,
    "start",
    JSON.stringify(editorState.creationDrag?.start),
  );
  console.log(
    "up ->",
    creation.finishCreationDrag(pointer("pointerup", { x: 40, y: 30 })),
  );
  console.log(
    "objects",
    state.objects.map((o) => `${o.type}:${o.name}`).join(", "),
  );
  console.log("selected", state.selection.selectedObjectIds);

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
