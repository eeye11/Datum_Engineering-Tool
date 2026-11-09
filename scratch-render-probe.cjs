const { bootApp, whenReady } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

(async () => {
  const page = bootApp();
  if (page.error) throw page.error;
  await whenReady();

  const state = require(locate("editor-state.js")).drawingState;
  const ds = require(locate("drawing-state.js")).default;
  const vessel = require(locate("model/fluids/reservoir-tank.js")).default;
  const schema = require(locate("feature-schema.js"));
  const renderer = require(locate("renderer.js")).default;
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

  state.objects = [];
  state.selection.selectedObjectIds = [];
  state.camera.zoom = 20 / ds.BASE_PIXELS_PER_UNIT;
  state.camera.panX = 0;
  state.camera.panY = 0;

  const v = vessel.vesselFromDrag({ x: 0, y: 40 }, { x: 40, y: 0 });
  ds.addObject(state, v);
  const c = state.objects.find((o) => o.id === v.id);
  schema.writeField(c, "vesselStyle", "open");

  const target = dom.drawingCanvas;
  target.innerHTML = "";
  renderer.renderDrawing(state, target);
  const svg = target.querySelector("svg") || target;

  [...svg.querySelectorAll("line")].forEach((n) => {
    console.log(
      "line",
      ["x1", "y1", "x2", "y2", "stroke", "stroke-dasharray"]
        .map((a) => `${a}=${n.getAttribute(a)}`)
        .join(" "),
      "| parent",
      n.parentNode.tagName,
      n.parentNode.getAttribute("class"),
    );
  });

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
