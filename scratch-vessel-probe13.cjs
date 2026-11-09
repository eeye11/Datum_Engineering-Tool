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

  tool.beginVesselToolSession();
  console.log(
    "activeTool",
    state.activeTool,
    "phase",
    state.interaction.phase,
    "creationDrag",
    editorState.creationDrag,
  );

  const ev = new window.MouseEvent("pointerdown", {
    clientX: 400,
    clientY: 300,
    bubbles: true,
    button: 0,
  });
  ev.pointerId = 1;
  ev.pointerType = "mouse";

  console.log("beginCreationDrag ->", creation.beginCreationDrag(ev));
  console.log(
    "creationDrag now",
    Object.keys(editorState.creationDrag || {}),
    editorState.creationDrag?.schematicTool,
  );

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
