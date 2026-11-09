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
  state.interaction.phase = "idle";
  state.interaction.preview = null;
  state.manipulationDrag = null;
  editorState.creationDrag = null;
  state.history = { past: [], future: [] };
  state.grid = { ...state.grid, snapToGrid: false };
  state.camera.zoom = PX / ds.BASE_PIXELS_PER_UNIT;
  state.camera.panX = 0;
  state.camera.panY = 0;

  tool.beginVesselToolSession();
  creation.beginCreationDrag(pointer("pointerdown", { x: 0, y: 0 }));
  creation.moveCreationDrag(pointer("pointermove", { x: 0, y: 0 }));
  creation.moveCreationDrag(pointer("pointermove", { x: 40, y: 30 }));
  creation.finishCreationDrag(pointer("pointerup", { x: 40, y: 30 }));

  const v = state.objects[0];
  console.log("name", v.name, "geom", JSON.stringify(v.geometry));
  state.activeTool = "select";
  state.selection.selectedObjectIds = [v.id];

  for (const idx of [0, 1, 2, 3]) {
    const h = handles
      .editableHandlesFor(v)
      .find((x) => x.kind === `vessel-corner${idx}`);
    const hit = handles.handleAtPoint(h.point);
    console.log(
      `corner${idx} @${h.point.x},${h.point.y} hit=${hit ? hit.handle.kind : "NONE"} tol=${handles.handleTolerance?.()}`,
    );
  }

  console.log(
    "all handles:",
    handles
      .editableHandlesFor(v)
      .map((h) => `${h.kind}@${h.point.x},${h.point.y}`)
      .join(" "),
  );

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
