/* Probe: does resizing the vessel move the attached pipe? */
const test = require("node:test");
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
  const ds = require(locate("drawing-state.js")).default;
  const vesselModel = require(locate("model/fluids/reservoir-tank.js")).default;
  const pipeModel = require(locate("model/fluids/pipe-duct.js")).default;
  const pipeTool = require(locate("pipe-duct-tool.js"));
  const schema = require(locate("feature-schema.js"));

  state.objects = [];
  state.selection.selectedObjectIds = [];

  const vessel = vesselModel.createVessel({
    position: { x: 0, y: 0 },
    width: 40,
    height: 30,
  });
  ds.addObject(state, vessel);

  const run = pipeModel.createPipeDuct({ x: 80, y: 15 }, { x: 40, y: 15 });
  ds.addObject(state, run);
  pipeTool.reconcileFluidConnections(run, state.objects);

  console.log("attachment:", JSON.stringify(run.engineering));

  const ok = schema.writeField(vessel, "vesselWidth", 70);
  console.log("writeField ->", ok);
  const live = state.objects.find((o) => o.type === "reservoir-tank");
  console.log("vessel width:", live.geometry.width);
  console.log(
    "run end after:",
    JSON.stringify(
      state.objects.find((o) => o.type === "pipe-duct").geometry.end,
    ),
  );
});
