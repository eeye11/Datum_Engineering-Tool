/* eslint-disable no-console */
const { bootApp, whenReady } = require("./helpers/boot-app.cjs");
const { locate } = require("./helpers/source-path.cjs");

const { window, document, error } = bootApp();

if (error) throw error;

(async () => {
  await whenReady();

  const state = require(locate("editor-state.js")).drawingState;
  const model = require(locate("drawing-state.js")).default;

  state.objects = [];
  state.camera = { zoom: 1, panX: 0, panY: 0 };

  const c = document.querySelector(".drawing-canvas");

  Object.defineProperties(c, {
    clientWidth: { value: 900, configurable: true },
    clientHeight: { value: 600, configurable: true },
  });

  c.getBoundingClientRect = () => ({ left: 0, top: 0, width: 900, height: 600 });
  c.setPointerCapture = () => {};
  c.hasPointerCapture = () => false;
  c.releasePointerCapture = () => {};

  const before = model.snapshotDrawing(state);

  model.addObject(state, model.geometryFactories.rectangle({ x: 0, y: 40 }, 100, 40));
  model.commitDrawingChange(state, before);

  const gestures = require(locate("creation-drag.js"));
  const clicks = require(locate("canvas-click.js"));
  const annotateCreation = require(locate("annotate-creation.js"));

  console.log("isGeometricAnnotateTool(callout):", annotateCreation.isGeometricAnnotateTool("callout"));

  model.setActiveTool(state, "callout");

  const event = (point) => {
    const p = model.engineeringToScreen(point, { width: 900, height: 600 }, state);

    return { pointerId: 19, button: 0, clientX: p.x, clientY: p.y, shiftKey: false };
  };

  const first = event({ x: 0, y: 20 });

  console.log("begin1:", gestures.beginCreationDrag(first));
  console.log("finish1:", gestures.finishCreationDrag(first));
  console.log("tool after finish1:", state.activeTool);

  clicks.handleCanvasClick(first);

  console.log("stage after click1:", state.interaction.annotateStage);
  console.log("annotateStart:", JSON.stringify(state.interaction.annotateStart));

  const second = event({ x: -30, y: 60 });

  console.log("begin2:", gestures.beginCreationDrag(second));
  console.log("drag session:", JSON.stringify(Object.keys(require(locate("editor-state.js")).editorState.creationDrag || {})));
  console.log("finish2:", gestures.finishCreationDrag(second));
  console.log("stage after finish2:", state.interaction.annotateStage);

  clicks.handleCanvasClick(second);

  await new Promise((r) => setTimeout(r, 30));

  console.log("objects:", state.objects.map((o) => `${o.type}/${o.annotateKind}`).join(", "));

  window.close();
})();
