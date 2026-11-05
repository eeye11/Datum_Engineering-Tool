const { whenReady } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

(async () => {
  await whenReady();
  require(locate("features-editor.js"));

  const dom = require(locate("interaction/dom.js"));
  dom.drawingCanvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 });
  Object.defineProperty(dom.drawingCanvas, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(dom.drawingCanvas, "clientHeight", { value: 600, configurable: true });

  const state = require(locate("editor-state.js")).drawingState;
  const ds = require(locate("drawing-state.js")).default;
  const V = require(locate("model/fluids/reservoir-tank.js")).default;
  const renderer = require(locate("renderer.js")).default;

  for (const style of ["open", "closed"]) {
    state.objects = [];
    state.selection.selectedObjectIds = [];
    state.camera.zoom = 1;
    state.camera.panX = 0;
    state.camera.panY = 0;

    const v = V.vesselFromDrag({ x: 0, y: 0 }, { x: 40, y: 30 });
    v.engineering = { ...v.engineering, vesselStyle: style };
    ds.addObject(state, v);
    const c = state.objects.find((o) => o.id === v.id);

    const target = dom.drawingCanvas;
    target.innerHTML = "";
    renderer.renderDrawing(state, target);
    const svg = target.querySelector("svg") || target;
    const g = svg.querySelector(`[data-feature-id="${c.id}"]`);

    const lines = [...g.querySelectorAll("line")].map((n) => {
      const y1 = +n.getAttribute("y1"), y2 = +n.getAttribute("y2"), x1 = +n.getAttribute("x1"), x2 = +n.getAttribute("x2");
      return `${Math.abs(y1 - y2) < 0.01 ? "H" : "V"} (${x1},${y1})->(${x2},${y2})`;
    });

    console.log(`== ${style} == segments ${V.vesselSegments(c).length}, lines ${lines.length}`);
    lines.forEach((l) => console.log("   " + l));
  }

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
