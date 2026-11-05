const { bootApp, whenReady } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

(async () => {
  await whenReady();
  require(locate("features-editor.js"));

  const dom = require(locate("interaction/dom.js"));
  const CANVAS = { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 };
  dom.drawingCanvas.getBoundingClientRect = () => CANVAS;
  Object.defineProperty(dom.drawingCanvas, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(dom.drawingCanvas, "clientHeight", { value: 600, configurable: true });
  dom.drawingCanvas.setPointerCapture = () => {};
  dom.drawingCanvas.releasePointerCapture = () => {};
  dom.drawingCanvas.hasPointerCapture = () => true;

  const state = require(locate("editor-state.js")).drawingState;
  const ds = require(locate("drawing-state.js")).default;
  const V = require(locate("model/fluids/reservoir-tank.js")).default;
  const handles = require(locate("handles.js"));
  const drag = require(locate("drag.js"));
  const schema = require(locate("feature-schema.js"));
  const precision = require(locate("pointer-precision.js"));

  const PX = 20;
  const pointer = (type, p) => {
    const e = new window.MouseEvent(type, { clientX: 400 + p.x * PX, clientY: 300 - p.y * PX, bubbles: true, button: 0 });
    e.pointerId = 1;
    e.pointerType = "mouse";
    return e;
  };

  const cases = [
    ["vessel-edge-left", { x: -10, y: 20 }],
    ["vessel-edge-right", { x: 50, y: 20 }],
    ["vessel-edge-top", { x: 20, y: 28 }],
    ["vessel-edge-bottom", { x: 20, y: 12 }]
  ];

  for (const [kind, target] of cases) {
    state.objects = [];
    state.selection.selectedObjectIds = [];
    state.activeTool = "select";
    state.camera.zoom = 1;
    state.camera.panX = 0;
    state.camera.panY = 0;
    precision.setPointerKind("mouse");

    const v = V.vesselFromDrag({ x: 0, y: 0 }, { x: 40, y: 40 });
    ds.addObject(state, v);
    const c = state.objects.find((o) => o.id === v.id);
    state.selection.selectedObjectIds = [c.id];

    const h = handles.editableHandlesFor(c).find((x) => x.kind === kind);
    drag.beginManipulationDrag(pointer("pointerdown", h.point));
    drag.updateManipulationDrag(pointer("pointermove", target));
    drag.finishManipulationDrag(pointer("pointerup", target));

    const r = V.vesselRect(c);
    console.log(kind.padEnd(20), "pos", JSON.stringify(r.position), "size", r.width + "x" + r.height);
  }

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
