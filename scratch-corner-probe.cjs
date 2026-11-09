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
  dom.drawingCanvas.setPointerCapture = () => {};
  dom.drawingCanvas.releasePointerCapture = () => {};
  dom.drawingCanvas.hasPointerCapture = () => true;

  const state = require(locate("editor-state.js")).drawingState;
  const ds = require(locate("drawing-state.js")).default;
  const vessel = require(locate("model/fluids/reservoir-tank.js")).default;
  const handles = require(locate("handles.js"));
  const drag = require(locate("drag.js"));
  require(locate("features-editor.js"));

  const PX = 20;
  const pointer = (type, p) => {
    const e = new window.MouseEvent(type, {
      clientX: 400 + p.x * PX,
      clientY: 300 - p.y * PX,
      bubbles: true,
      button: 0,
    });
    e.pointerId = 1;
    e.pointerType = "mouse";
    return e;
  };

  state.objects = [];
  state.selection.selectedObjectIds = [];
  state.activeTool = "select";
  state.camera.zoom = PX / ds.BASE_PIXELS_PER_UNIT;
  state.camera.panX = 0;
  state.camera.panY = 0;

  const v = vessel.vesselFromDrag({ x: 0, y: 0 }, { x: 40, y: 30 });
  ds.addObject(state, v);
  const c = state.objects.find((o) => o.id === v.id);
  state.selection.selectedObjectIds = [c.id];

  const hs = handles.editableHandlesFor(c);
  console.log(
    "handles",
    hs.map((h) => `${h.kind}@${h.point.x},${h.point.y}`).join(" "),
  );

  for (const idx of [0, 1, 2, 3]) {
    const h = hs.find((x) => x.kind === `vessel-corner${idx}`);
    const hit = handles.handleAtPoint({ x: h.point.x - 1, y: h.point.y + 1 });
    console.log(
      `corner${idx} @ ${h.point.x},${h.point.y} -> hit`,
      hit ? `${hit.handle.kind}` : "none",
    );
  }

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
