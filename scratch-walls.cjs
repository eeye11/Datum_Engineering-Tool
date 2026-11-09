const { whenReady } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

(async () => {
  await whenReady();
  require(locate("features-editor.js"));

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
  const V = require(locate("model/fluids/reservoir-tank.js")).default;
  const renderer = require(locate("renderer.js")).default;

  state.objects = [];
  state.selection.selectedObjectIds = [];
  state.camera.zoom = 1;
  state.camera.panX = 0;
  state.camera.panY = 0;

  const v = V.vesselFromDrag({ x: 0, y: 0 }, { x: 40, y: 30 });
  v.engineering = { ...v.engineering, vesselStyle: "open" };
  ds.addObject(state, v);
  const c = state.objects.find((o) => o.id === v.id);

  console.log(
    "segments:",
    V.vesselSegments(c)
      .map((s) => s.name)
      .join(","),
  );

  const target = dom.drawingCanvas;
  target.innerHTML = "";
  renderer.renderDrawing(state, target);
  const svg = target.querySelector("svg") || target;
  const g = svg.querySelector(`[data-feature-id="${c.id}"]`);

  [...g.querySelectorAll("line")].forEach((n) => {
    const y1 = +n.getAttribute("y1"),
      y2 = +n.getAttribute("y2");
    console.log(
      "line",
      y1,
      "->",
      y2,
      "|",
      Math.abs(y1 - y2) < 0.01 ? "H" : "V",
    );
  });

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
