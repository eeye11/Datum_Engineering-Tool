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

  const drags = [
    ["TL->BR", { x: 0, y: 40 }, { x: 40, y: 0 }],
    ["TR->BL", { x: 40, y: 40 }, { x: 0, y: 0 }],
    ["BL->TR", { x: 0, y: 0 }, { x: 40, y: 40 }],
    ["BR->TL", { x: 40, y: 0 }, { x: 0, y: 40 }],
  ];

  for (const style of ["open", "closed"]) {
    for (const [label, a, b] of drags) {
      state.objects = [];
      const v = vessel.vesselFromDrag(a, b);
      ds.addObject(state, v);
      const c = state.objects.find((o) => o.id === v.id);
      schema.writeField(c, "vesselStyle", style);
      if (style === "closed") {
        schema.writeField(c, "vesselFluidEnabled", true);
        schema.writeField(c, "vesselFluidPercent", 25);
      }

      const target = dom.drawingCanvas;
      target.innerHTML = "";
      renderer.renderDrawing(state, target);
      const svg = target.querySelector("svg") || target;

      // SCREEN coordinates: smaller y is HIGHER on screen.
      const lines = [...svg.querySelectorAll("line")].map((n) => ({
        y1: Number(n.getAttribute("y1")),
        y2: Number(n.getAttribute("y2")),
        x1: Number(n.getAttribute("x1")),
        x2: Number(n.getAttribute("x2")),
      }));

      const horizontal = lines.filter((l) => Math.abs(l.y1 - l.y2) < 0.01);
      const polys = [...svg.querySelectorAll("polygon")].map((n) =>
        n.getAttribute("points"),
      );

      const wallTop = Math.min(...horizontal.map((l) => l.y1));
      const wallBottom = Math.max(...horizontal.map((l) => l.y1));
      const hasTopWall = horizontal.some(
        (l) => Math.abs(l.y1 - wallTop) < 0.01,
      );
      const surface = horizontal.filter(
        (l) =>
          Math.abs(l.y1 - wallTop) > 0.01 && Math.abs(l.y1 - wallBottom) > 0.01,
      );

      const liquid = polys.map((p) =>
        p.split(" ").map((pair) => pair.split(",").map(Number)),
      );
      const liquidYs = liquid.flat().map((p) => p[1]);

      console.log(
        `${style.padEnd(6)} ${label.padEnd(7)}`,
        "| top wall drawn:",
        hasTopWall,
        "| screen top",
        wallTop,
        "bottom",
        wallBottom,
        "| surface at",
        surface.length ? surface[0].y1 : "-",
        "| liquid:",
        liquidYs.length
          ? `y ${Math.min(...liquidYs)}..${Math.max(...liquidYs)}`
          : "none",
      );
    }
  }

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
