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
  const editorState = require(locate("editor-state.js")).editorState;
  const ds = require(locate("drawing-state.js")).default;
  const vessel = require(locate("model/fluids/reservoir-tank.js")).default;
  const handles = require(locate("handles.js"));
  const drag = require(locate("drag.js"));
  const creation = require(locate("creation-drag.js"));
  const tool = require(locate("fluids-schematic-tool.js"));
  const precision = require(locate("pointer-precision.js"));
  const renderer = require(locate("renderer.js")).default;
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
  state.camera.zoom = PX / ds.BASE_PIXELS_PER_UNIT;
  state.camera.panX = 0;
  state.camera.panY = 0;
  state.grid = { ...state.grid, snapToGrid: false };
  precision.setPointerKind("mouse");

  tool.beginVesselToolSession();
  creation.beginCreationDrag(pointer("pointerdown", { x: 0, y: 0 }));
  creation.moveCreationDrag(pointer("pointermove", { x: 0, y: 0 }));
  creation.moveCreationDrag(pointer("pointermove", { x: 40, y: 40 }));
  creation.finishCreationDrag(pointer("pointerup", { x: 40, y: 40 }));

  const v = state.objects[0];
  console.log(
    "vessel:",
    v.name,
    JSON.stringify(v.geometry),
    "level",
    JSON.stringify(v.engineering.fluidLevel),
  );

  const target = dom.drawingCanvas;
  target.innerHTML = "";
  renderer.renderDrawing(state, target);
  const svg = target.querySelector("svg") || target;
  const g = svg.querySelector(`[data-feature-id="${v.id}"]`);
  console.log("group found:", Boolean(g));
  [...(g || svg).querySelectorAll("line")].forEach((n) => {
    console.log(
      "  line",
      ["x1", "y1", "x2", "y2"]
        .map((a) => `${a}=${n.getAttribute(a)}`)
        .join(" "),
    );
  });

  // Now corner 1
  state.activeTool = "select";
  state.selection.selectedObjectIds = [v.id];
  const hs = handles.editableHandlesFor(v);
  console.log(
    "handles:",
    hs.map((h) => `${h.kind}@${h.point.x},${h.point.y}`).join(" "),
  );

  const h1 = hs.find((h) => h.kind === "vessel-corner1");
  const hit = handles.handleAtPoint(h1.point);
  console.log(
    "hit at corner1:",
    hit ? `${hit.handle.kind} d=${hit.distance.toFixed(3)}` : "NONE",
  );
  const ok = drag.beginManipulationDrag(pointer("pointerdown", h1.point));
  console.log("drag started:", ok, "kind:", editorState.manipulationDrag?.kind);

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
