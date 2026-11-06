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
  state.camera.zoom = 20 / ds.BASE_PIXELS_PER_UNIT;
  state.camera.panX = 0;
  state.camera.panY = 0;

  const draw = (label, style, pct) => {
    state.objects = [];
    const v = vessel.vesselFromDrag({ x: -10, y: 5 }, { x: 10, y: 25 });
    ds.addObject(state, v);
    state.activeTool = "select";
    const c = state.objects.find((o) => o.id === v.id);
    schema.writeField(c, "vesselStyle", style);
    schema.writeField(c, "vesselFluidPercent", pct);

    const target = dom.drawingCanvas;
    target.innerHTML = "";
    renderer.renderDrawing(state, target);
    const svg = target.querySelector("svg") || target;
    const g = svg.querySelector(`[data-feature-id="${c.id}"]`) || svg;

    console.log(
      `\n--- ${label} (special characters are only world->screen) ---`,
    );
    [...g.querySelectorAll("line")].forEach((n) => {
      const x1 = +n.getAttribute("x1"),
        y1 = +n.getAttribute("y1"),
        x2 = +n.getAttribute("x2"),
        y2 = +n.getAttribute("y2");
      console.log(
        `   (${x1.toFixed(0)},${y1.toFixed(0)}) -> (${x2.toFixed(0)},${y2.toFixed(0)})  ${Math.abs(y1 - y2) < 0.5 ? "HORIZONTAL" : "vertical"}`,
      );
    });
    const poly = g.querySelector("polygon");
    if (poly) console.log("   LIQUID:", poly.getAttribute("points"));
  };

  draw("RESERVOIR open top, 50%", "open", 50);
  draw("TANK closed, 50%", "closed", 50);
  draw("TANK closed, 100%", "closed", 100);
  draw("TANK closed, 0%", "closed", 0);

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
