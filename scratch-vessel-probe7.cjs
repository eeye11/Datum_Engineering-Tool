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

  state.objects = [];
  state.selection.selectedObjectIds = [];
  state.camera.zoom = 1;
  state.camera.panX = 0;
  state.camera.panY = 0;

  const v = vessel.vesselFromDrag({ x: 0, y: 0 }, { x: 40, y: 30 });
  ds.addObject(state, v);
  const c = state.objects.find((o) => o.id === v.id);

  const show = (label) => {
    const target =
      dom.drawingCanvas.namespaceURI === "http://www.w3.org/2000/svg"
        ? dom.drawingCanvas
        : dom.drawingCanvas;
    target.innerHTML = "";
    renderer.renderDrawing(state, target);
    const svg = target.querySelector("svg") || target;
    const lines = [...svg.querySelectorAll("line, polygon, path")]
      .map(
        (n) =>
          n.tagName +
          " " +
          [...n.attributes]
            .filter((a) =>
              [
                "x1",
                "y1",
                "x2",
                "y2",
                "points",
                "fill",
                "fill-opacity",
                "clip-path",
                "stroke",
              ].includes(a.name),
            )
            .map((a) => `${a.name}=${a.value}`)
            .join(" "),
      )
      .filter((s) => !s.includes("overlay"));
    console.log(`--- ${label} (${lines.length}) ---`);
    lines.forEach((l) => console.log("  " + l.slice(0, 170)));
  };

  show("reservoir");
  schema.writeField(c, "vesselStyle", "closed");
  show("tank");
  schema.writeField(c, "vesselFluidEnabled", true);
  show("tank 50%");
  schema.writeField(c, "vesselFluidPercent", 100);
  show("tank 100%");
  schema.writeField(c, "vesselFluidPercent", 0);
  show("tank 0%");

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
