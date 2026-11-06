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
  const ds = require(locate("drawing-state.js")).default;
  const renderer = require(locate("renderer.js")).default;

  state.objects = [];
  state.selection.selectedObjectIds = [];
  state.camera.zoom = 20 / ds.BASE_PIXELS_PER_UNIT;
  state.camera.panX = 0;
  state.camera.panY = 0;

  // A plain rectangle: position (0,0), 40 x 20.
  const rect = ds.createGeometryObject("rectangle", {
    position: { x: 0, y: 0 },
    width: 40,
    height: 20,
  });
  ds.addObject(state, rect);
  const c = state.objects.find((o) => o.id === rect.id);

  const target = dom.drawingCanvas;
  target.innerHTML = "";
  renderer.renderDrawing(state, target);
  const svg = target.querySelector("svg") || target;
  const g = svg.querySelector(`[data-feature-id="${c.id}"]`) || svg;

  console.log("MODEL position", JSON.stringify(c.geometry));
  const all = [...g.querySelectorAll("path, polyline, line, polygon, rect")];
  all.forEach((n) => {
    const tag = n.tagName;
    const attrs = [
      "d",
      "points",
      "x1",
      "y1",
      "x2",
      "y2",
      "x",
      "y",
      "width",
      "height",
    ]
      .map((a) => `${a}=${n.getAttribute(a)}`)
      .join(" ");
    console.log(" ", tag, attrs);
  });

  console.log(
    "\nworld->screen check: world y=0 maps to",
    300 - 0 * 20,
    "; world y=20 maps to",
    300 - 20 * 20,
  );

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
