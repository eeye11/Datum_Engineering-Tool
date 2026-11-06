/* Probe: replicate single-object-drag's third test in its own setup. */
const { test, before, after } = require("node:test");
const { bootApp, whenReady } = require("./helpers/boot-app.cjs");
const { locate } = require("./helpers/source-path.cjs");

const { window, document, error } = bootApp();
if (error) throw error;

let state, model, drag, canvas, handles, editorState;

test(
  "probe",
  async () => {
    await whenReady();
    ({ drawingState: state } = require(locate("editor-state.js")));
    editorState = require(locate("editor-state.js")).editorState;
    model = require(locate("drawing-state.js")).default;
    drag = require(locate("drag.js"));
    handles = require(locate("handles.js"));
    canvas = document.querySelector(".drawing-canvas");
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
      const s = model.engineeringToScreen(
        p,
        { width: 900, height: 600 },
        state,
      );
      return {
        pointerId: 7,
        button: 0,
        clientX: s.x,
        clientY: s.y,
        shiftKey: false,
      };
    }

    const start = require(
      locate("feature-geometry.js"),
    ).default.rectangleCorners(object.geometry)[0];
    console.log("corner:", JSON.stringify(start));

    const hit = handles.handleAtPoint(start);
    console.log("hit:", hit ? hit.handle.kind : "null");

    const began = drag.beginManipulationDrag(event(start));
    console.log("begin:", began, "kind:", editorState.manipulationDrag?.kind);
    console.log(
      "anchor:",
      JSON.stringify(editorState.manipulationDrag?.anchor),
    );
    console.log(
      "originals:",
      Object.keys(editorState.manipulationDrag?.originals || {}),
    );

    const initial = JSON.stringify(object.geometry);
    state.objects = structuredClone(state.objects);
    console.log(
      "replaced:",
      state.objects.find((o) => o.id === object.id) !== object,
    );

    drag.updateManipulationDrag(event({ x: start.x - 20, y: start.y + 15 }));
    const live = state.objects.find((o) => o.id === object.id);
    console.log("live:", JSON.stringify(live.geometry));
    console.log("initial:", initial);
  },
  { timeout: 60000 },
);

after(() => setImmediate(() => process.exit(process.exitCode || 0)));
