require("./helpers/boot-app.cjs").bootApp();
const { locate } = require("./helpers/source-path.cjs");

const model = require(locate("drawing-state.js")).default;
const drag = require(locate("drag.js"));
const es = require(locate("editor-state.js"));
const state = es.drawingState;
const editorState = es.editorState;

const canvas = require(locate("interaction/dom.js")).drawingCanvas;
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

const event = (p) => {
  const s = model.engineeringToScreen(p, { width: 900, height: 600 }, state);
  return {
    pointerId: 7,
    button: 0,
    clientX: s.x,
    clientY: s.y,
    shiftKey: false,
  };
};

const handles = require(locate("handles.js"));
const corners = require(locate("feature-geometry.js")).default.rectangleCorners(
  object.geometry,
);
console.log("corners:", JSON.stringify(corners));
console.log(
  "editable handles:",
  handles
    .editableHandlesFor(object)
    .map((h) => `${h.kind}@${Math.round(h.point.x)},${Math.round(h.point.y)}`)
    .join(" | "),
);

const hit = handles.handleAtPoint(corners[0]);
console.log(
  "handleAtPoint(corner0):",
  hit ? `${hit.handle.kind} d=${hit.distance.toFixed(3)}` : "null",
);

const began = drag.beginManipulationDrag(event(corners[0]));
console.log("beginManipulationDrag:", began);
console.log("drag kind:", editorState.manipulationDrag?.kind);
