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
      x1: +n.getAttribute("x1"),
      y1: +n.getAttribute("y1"),
      x2: +n.getAttribute("x2"),
      y2: +n.getAttribute("y2"),
    }));
    console.log(`\n${style} (${mtypeof(c)}) -- lines ${lines.length}`);
    lines.forEach((l) =>
      console.log(
        `   (${l.x1.toFixed(1)},${l.y1.toFixed(1)}) -> (${l.x2.toFixed(1)},${l.y2.toFixed(1)})`,
      ),
    );
    console.log(
      "   pct",
      vessel.fluidLevelPercentOf(c),
      "seg y",
      vessel.fluidLevelSegment(c)?.start.y,
    );
  }

  function mtypeof() {
    return "";
  }

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
