const { bootApp, whenReady } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

(async () => {
  const page = bootApp();
  if (page.error) throw page.error;
  await whenReady();

  const dom = require(locate("interaction/dom.js"));
  dom.drawingCanvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 800,
    height: 600,
    right: 800,
    bottom: 600,
    x: 0,
    y: 0,
  });
  Object.defineProperty(dom.drawingCanvas, "clientWidth", {
    value: 800,
    configurable: true,
  });
  Object.defineProperty(dom.drawingCanvas, "clientHeight", {
    value: 600,
    configurable: true,
  });

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

  const v = vessel.vesselFromDrag({ x: 0, y: 0 }, { x: 40, y: 30 });
  ds.addObject(state, v);
  const c = state.objects.find((o) => o.id === v.id);
  schema.writeField(c, "fillMode", "solid");
  schema.writeField(c, "fill", "#00ff00");

  const target = dom.drawingCanvas;
  target.innerHTML = "";
  renderer.renderDrawing(state, target);
  const svg = target.querySelector("svg") || target;
  const g = svg.querySelector(`[data-feature-id="${c.id}"]`);
  console.log("style", JSON.stringify(c.style));
  const poly = g.querySelector("polygon[fill-opacity]");
  console.log("polygon fill:", poly && poly.getAttribute("fill"));
  console.log(
    "all polygons:",
    [...g.querySelectorAll("polygon")].map(
      (p) => `${p.getAttribute("fill")} pts=${p.getAttribute("points")}`,
    ),
  );

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
