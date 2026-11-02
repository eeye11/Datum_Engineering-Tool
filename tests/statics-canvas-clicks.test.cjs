/*
 * ========================================================
 * A STATICS TOOL'S CANVAS CLICK REACHES THE TOOL
 * ========================================================
 *
 * The shared click router selects an existing feature on a click and returns
 * an armed tool to Select on an empty click, for every category. A Statics tool
 * needs exactly those clicks: a support, load, force or moment is placed by
 * clicking the BODY, and a Particle by clicking EMPTY canvas. When the router
 * answered them first, every one of these tools silently created nothing - and
 * no test noticed, because nothing threw. These drive real canvas clicks.
 *
 * And Single / Multiple placement: Single (the default) returns to Select after
 * one feature, as every category does; Multiple keeps the tool armed.
 */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { bootApp, whenReady } = require("./helpers/boot-app.cjs");
const { locate } = require("./helpers/source-path.cjs");

const { window, document, error } = bootApp();

if (error) {
  throw error;
}

let state;
let model;
let statics;
let canvas;

before(async () => {
  await whenReady();

  state = require(locate("editor-state.js")).drawingState;
  model = require(locate("drawing-state.js")).default;
  statics = require(locate("statics-tools.js"));
  canvas = document.querySelector(".drawing-canvas");

  Object.defineProperties(canvas, {
    clientWidth: { value: 900, configurable: true },
    clientHeight: { value: 600, configurable: true },
  });

  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 900, height: 600, right: 900, bottom: 600 });

  state.camera = { zoom: 1, panX: 0, panY: 0 };
});

after(() => window.close());

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/* A click on the canvas at a drawing-space point, through the real listeners. */
function clickAt(point) {
  const screen = model.engineeringToScreen(point, { width: 900, height: 600 }, state);

  canvas.dispatchEvent(
    new window.MouseEvent("click", { clientX: screen.x, clientY: screen.y, button: 0, bubbles: true, cancelable: true }),
  );
}

function fresh() {
  state.objects = [];
  model.clearInteraction(state);
  model.setActiveTool(state, "select");
}

function addBeam() {
  const previous = model.snapshotDrawing(state);
  const beam = model.addObject(state, model.geometryFactories.beam({ x: -100, y: 0 }, { x: 100, y: 0 }));

  model.commitDrawingChange(state, previous);
  model.setActiveTool(state, "select");

  return beam;
}

test("every Statics tool claims its own canvas clicks", () => {
  ["particle", "rigid-body", "pin-support", "point-force", "distributed-load", "moment", "pin-connection", "resultant", "force-components"].forEach(
    (tool) => assert.ok(statics.staticsToolOwnsCanvasClicks(tool), tool),
  );

  assert.equal(statics.staticsToolOwnsCanvasClicks("line"), false, "a Geometry tool keeps the shared rule");
  assert.equal(statics.staticsToolOwnsCanvasClicks("note"), false, "an Annotate tool keeps the shared rule");
});

test("a Particle is placed by an empty-canvas click, then returns to Select", async () => {
  fresh();
  model.setActiveTool(state, "particle");

  clickAt({ x: 20, y: 30 });
  await settle();

  assert.equal(state.objects.filter((object) => object.type === "particle").length, 1, "the click placed a particle");
  assert.equal(state.activeTool, "select", "Single placement returns to Select");
});

test("in Multiple placement the Particle tool keeps placing", async () => {
  fresh();
  statics.setPlacementMode("particle", "multiple");
  model.setActiveTool(state, "particle");

  clickAt({ x: 20, y: 30 });
  await settle();
  clickAt({ x: 60, y: 30 });
  await settle();

  assert.equal(state.objects.filter((object) => object.type === "particle").length, 2);
  assert.equal(state.activeTool, "particle", "Multiple placement stays armed");

  statics.setPlacementMode("particle", "single");
});

test("a click on the beam starts a support, a force, a load and a moment - it does not just select the beam", async () => {
  for (const tool of ["pin-support", "point-force", "distributed-load", "moment"]) {
    fresh();
    addBeam();

    model.setActiveTool(state, tool);

    clickAt({ x: 10, y: 0 });
    await settle();

    assert.equal(state.activeTool, tool, `${tool}: the click went to the tool, not to Select`);
    assert.notEqual(state.interaction.phase, "idle", `${tool}: the tool started its placement`);
  }
});
