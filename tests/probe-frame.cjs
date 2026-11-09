/* Probe: trace applyManipulation for a corner0 drag on a rectangle. */
const { test, after } = require("node:test");
const { bootApp, whenReady } = require("./helpers/boot-app.cjs");
const { locate } = require("./helpers/source-path.cjs");

const { window, document, error } = bootApp();
if (error) throw error;

test("probe", async () => {
  await whenReady();
  const { drawingState: state } = require(locate("editor-state.js"));
  const editorState = require(locate("editor-state.js")).editorState;
  const model = require(locate("drawing-state.js")).default;
  const drag = require(locate("drag.js"));
  const canvas = document.querySelector(".drawing-canvas");
  Object.defineProperties(canvas, {
    clientWidth: { value: 900, configurable: true },
    clientHeight: { value: 600, configurable: true },
  });
  canvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 900,
    height: 600,
  });
  canvas.setPointerCapture = () => {};
  canvas.hasPointerCapture = () => false;
  canvas.releasePointerCapture = () => {};
  model.setActiveTool(state, "select");
  state.camera = { zoom: 1, panX: 0, panY: 0 };

  const previous = model.snapshotDrawing(state);
  const object = model.addObject(
    state,
    model.geometryFactories.rectangle({ x: 0, y: 0 }, 80, 50),
  );
  model.commitDrawingChange(state, previous);
  model.selectObject(state, object.id);

  function event(p) {
    const s = model.engineeringToScreen(p, { width: 900, height: 600 }, state);
    return {
      pointerId: 7,
      button: 0,
      clientX: s.x,
      clientY: s.y,
      shiftKey: false,
    };
  }

  const start = require(locate("feature-geometry.js")).default.rectangleCorners(
    object.geometry,
  )[0];

  const began = drag.beginManipulationDrag(event(start));
  const dragRef = editorState.manipulationDrag;
  console.log("begin:", began, "kind:", dragRef && dragRef.kind);
  console.log(
    "originals:",
    JSON.stringify(Object.keys((dragRef && dragRef.originals) || {})),
  );
  console.log("object id:", object.id);
  console.log("object type:", object.type);
  console.log(
    "drag.object type:",
    dragRef && dragRef.object && dragRef.object.type,
  );
  console.log(
    "drag.object id:",
    dragRef && dragRef.object && dragRef.object.id,
  );

  const initial = JSON.stringify(object.geometry);
  state.objects = structuredClone(state.objects);

  const frame = drag.applyManipulationForTest(dragRef, {
    x: start.x - 20,
    y: start.y + 15,
  });
  console.log("frame returned:", JSON.stringify(frame && frame.geometry));

  const live = state.objects.find(function (o) {
    return o.id === object.id;
  });
  console.log("live:", JSON.stringify(live.geometry));
  console.log("initial:", initial);
  process.exit(0);
});

after(function () {
  setImmediate(function () {
    process.exit(process.exitCode || 0);
  });
});
