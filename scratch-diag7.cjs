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

  const render = (selected) => {
    state.objects = [];
    state.camera.zoom = 1;
    state.camera.panX = 0;
    state.camera.panY = 0;
    const v = vessel.vesselFromDrag(
      { x: 0, y: 0 },
      { x: 40, y: 40 },
      { vesselStyle: "open" },
    );
    ds.addObject(state, v);
    const c = state.objects.find((o) => o.id === v.id);
    state.selection.selectedObjectIds = selected ? [c.id] : [];

    const target = dom.drawingCanvas;
    target.innerHTML = "";
    renderer.renderDrawing(state, target);
    const svg = target.querySelector("svg") || target;
    const g = svg.querySelector(`[data-feature-id="${c.id}"]`);
    console.log(
      `\nselected=${selected}: model segs=${vessel.vesselSegments(c).length}, painted lines=${g.querySelectorAll("line").length}`,
    );
    [...g.querySelectorAll("line")].forEach((n) => {
      console.log(
        "   ",
        ["x1", "y1", "x2", "y2", "class"]
          .map((a) => `${a}=${n.getAttribute(a)}`)
          .join(" "),
      );
    });
    console.log(
      "   group children:",
      [...g.children].map((e) => e.tagName).join(","),
    );
  };

  render(false);
  render(true);

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
