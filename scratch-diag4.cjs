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
  dom.drawingCanvas.releasePointerCapture = () => {};
  dom.drawingCanvas.hasPointerCapture = () => true;

  const state = require(locate("editor-state.js")).drawingState;
  const ds = require(locate("drawing-state.js")).default;
  const vessel = require(locate("model/fluids/reservoir-tank.js")).default;
  const schema = require(locate("feature-schema.js"));
  const renderer = require(locate("renderer.js")).default;
  require(locate("features-editor.js"));

  state.objects = [];
  state.selection.selectedObjectIds = [];
  state.camera.zoom = 1;
  state.camera.panX = 0;
  state.camera.panY = 0;

  for (const style of ["open", "closed"]) {
    state.objects = [];
    const v = vessel.vesselFromDrag(
      { x: 0, y: 0 },
      { x: 40, y: 40 },
      { vesselStyle: style },
    );
    ds.addObject(state, v);
    const c = state.objects.find((o) => o.id === v.id);

    const target = dom.drawingCanvas;
    target.innerHTML = "";
    renderer.renderDrawing(state, target);
    const svg = target.querySelector("svg") || target;
    const g = svg.querySelector(`[data-feature-id="${c.id}"]`);
    const lines = [...g.querySelectorAll("line")].map((n) => ({
      y1: +n.getAttribute("y1"),
      y2: +n.getAttribute("y2"),
      x1: +n.getAttribute("x1"),
      x2: +n.getAttribute("x2"),
    }));
    console.log(
      `\n${style}: style=${vessel.vesselStyleOf(c)} pct=${vessel.fluidLevelPercentOf(c)} enabled=${vessel.fluidLevelEnabledOf(c)}`,
    );
    lines.forEach((l) =>
      console.log(
        `  (${l.x1},${l.y1}) -> (${l.x2},${l.y2}) ${Math.abs(l.y1 - l.y2) < 0.01 ? "H" : "V"}`,
      ),
    );
    const seg = vessel.fluidLevelSegment(c);
    console.log("  model surface y:", seg && seg.start.y);
  }

  // fill colour
  state.objects = [];
  const v2 = vessel.vesselFromDrag({ x: 0, y: 0 }, { x: 40, y: 30 });
  ds.addObject(state, v2);
  const c2 = state.objects.find((o) => o.id === v2.id);
  console.log(
    "\nwrite fillMode",
    schema.writeField(c2, "fillMode", "solid"),
    "fill",
    schema.writeField(c2, "fill", "#00ff00"),
  );
  console.log("style now", JSON.stringify(c2.style));

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
