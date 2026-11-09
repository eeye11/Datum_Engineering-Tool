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
  const vessel = require(locate("model/fluids/reservoir-tank.js")).default;
  const schema = require(locate("feature-schema.js"));
  const renderer = require(locate("renderer.js")).default;
  require(locate("features-editor.js"));

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
      schema.writeField(c, "vesselFluidPercent", 25);

      const target = dom.drawingCanvas;
      target.innerHTML = "";
      renderer.renderDrawing(state, target);
      const svg = target.querySelector("svg") || target;
      const g = svg.querySelector(`[data-feature-id="${c.id}"]`) || svg;

      const lines = [...g.querySelectorAll("line")].map((n) => {
        const x1 = +n.getAttribute("x1"),
          y1 = +n.getAttribute("y1"),
          x2 = +n.getAttribute("x2"),
          y2 = +n.getAttribute("y2");
        return { x1, y1, x2, y2, h: Math.abs(y1 - y2) < 0.01 };
      });
      const horiz = lines
        .filter((l) => l.h)
        .map((l) => l.y1)
        .sort((p, q) => p - q);
      const vert = lines.filter((l) => !l.h);
      const poly = g.querySelector("polygon");
      const ys = poly
        ? poly
            .getAttribute("points")
            .trim()
            .split(/\s+/)
            .map((p) => +p.split(",")[1])
        : [];

      // screen: small y = TOP, large y = BOTTOM
      const top = Math.min(...lines.map((l) => Math.min(l.y1, l.y2)));
      const bottom = Math.max(...lines.map((l) => Math.max(l.y1, l.y2)));

      console.log(
        `${style.padEnd(6)} ${label.padEnd(7)}`,
        `walls=${lines.length}`,
        `horiz=${horiz.length}`,
        `vert=${vert.length}`,
        `top=${top}`,
        `bottom=${bottom}`,
        `surface=${horiz.filter((y) => y > top && y < bottom).join("/") || "-"}`,
        `liquidY=${ys.length ? `${Math.min(...ys)}..${Math.max(...ys)}` : "none"}`,
      );
    }
  }

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
