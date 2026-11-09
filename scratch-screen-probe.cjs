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
  state.camera.zoom = 20 / ds.BASE_PIXELS_PER_UNIT;
  state.camera.panX = 0;
  state.camera.panY = 0;

  const show = (label, style, percent) => {
    const v = vessel.vesselFromDrag({ x: 0, y: 40 }, { x: 40, y: 0 });
    ds.addObject(state, v);
    const c = state.objects.find((o) => o.id === v.id);
    schema.writeField(c, "vesselStyle", style);
    if (percent !== undefined) {
      schema.writeField(c, "vesselFluidEnabled", true);
      schema.writeField(c, "vesselFluidPercent", percent);
    }

    const target = dom.drawingCanvas;
    target.innerHTML = "";
    renderer.renderDrawing(state, target);
    const svg = target.querySelector("svg") || target;
    const g = svg.querySelector(`[data-feature-id="${c.id}"]`) || svg;

    const lines = [...g.querySelectorAll("line")].map((n) => ({
      kind:
        Math.abs(+n.getAttribute("x1") - +n.getAttribute("x2")) < 0.01
          ? "HORIZONTAL"
          : "vertical",
      x1: +n.getAttribute("x1"),
      y1: +n.getAttribute("y1"),
      x2: +n.getAttribute("x2"),
      y2: +n.getAttribute("y2"),
    }));

    console.log(`\n===== ${label} (screen: small y = TOP) =====`);
    lines.forEach((l) =>
      console.log(
        `  ${l.kind.padEnd(10)} (${l.x1},${l.y1}) -> (${l.x2},${l.y2})`,
      ),
    );

    const poly = g.querySelector("polygon");
    if (poly) {
      const pts = poly.getAttribute("points").trim().split(/\s+/);
      console.log("  LIQUID polygon:", pts.join("  "));
    }

    state.objects = [];
  };

  show("RESERVOIR (open top)", "open");
  show("TANK (closed) + 50% liquid", "closed", 50);

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
