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
  dom.drawingCanvas.setPointerCapture = () => {};
  dom.drawingCanvas.releasePointerCapture = () => {};
  dom.drawingCanvas.hasPointerCapture = () => true;

  const state = require(locate("editor-state.js")).drawingState;
  const ds = require(locate("drawing-state.js")).default;
  const vessel = require(locate("model/fluids/reservoir-tank.js")).default;
  const renderer = require(locate("renderer.js")).default;
  require(locate("features-editor.js"));

  for (const style of ["open", "closed"]) {
    state.objects = [];
    state.selection.selectedObjectIds = [];
    state.camera.zoom = 20 / ds.BASE_PIXELS_PER_UNIT;
    state.camera.panX = 0;
    state.camera.panY = 0;

    const v = vessel.vesselFromDrag({ x: 0, y: 0 }, { x: 40, y: 40 });
    v.engineering = { ...v.engineering, vesselStyle: style };
    ds.addObject(state, v);
    const c = state.objects.find((o) => o.id === v.id);

    const target = dom.drawingCanvas;
    target.innerHTML = "";
    renderer.renderDrawing(state, target);
    const svg = target.querySelector("svg") || target;
    const g = svg.querySelector(`[data-feature-id="${c.id}"]`);

    const rows = [...g.querySelectorAll("line")].map((n) => {
      const y1 = +n.getAttribute("y1"),
        y2 = +n.getAttribute("y2"),
        x1 = +n.getAttribute("x1"),
        x2 = +n.getAttribute("x2");
      return `${Math.abs(y1 - y2) < 0.01 ? "H" : "V"} y=${y1}..${y2} x=${x1}..${x2}`;
    });

    console.log(
      `\n== ${style} ==  segments=${vessel.vesselSegments(c).length} pct=${vessel.fluidLevelPercentOf(c)}`,
    );
    rows.forEach((r) => console.log("  " + r));
    const poly = g.querySelector("polygon[fill-opacity]");
    console.log("  liquid:", poly ? poly.getAttribute("points") : "none");
  }

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
