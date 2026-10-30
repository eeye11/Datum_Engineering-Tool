/*
 * ========================================================
 * WHAT IS DRAWN IS ALWAYS VISIBLE WHERE IT REALLY IS
 * ========================================================
 *
 * The Drawing Space shows the compiled source, and a compile takes a moment (or
 * never comes, with the render server not running). These check the overlay
 * draws every object the picture on screen does not show yet - just drawn, being
 * moved, or with no picture at all - and steps aside once the picture agrees.
 * And that the picture's print line widths are shown at a readable screen width.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { bootApp, whenReady } = require("./helpers/boot-app.cjs");
const { locate } = require("./helpers/source-path.cjs");

const { window, document, error } = bootApp();

if (error) {
  console.log(`the application did not boot: ${error.message}`);
  process.exit(1);
}

/* A render server stub whose answers are held until the test releases them. */
const pending = [];

window.fetch = globalThis.fetch = (url) => {
  if (!String(url).includes("/api/render-tikz")) {
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  }

  return new Promise((resolve) => {
    pending.push(() => resolve({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><path stroke="#193335" stroke-width=".28" d="M0 0h10"/></svg>'
      })
    }));
  });
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let model;
let drawingState;
let canvasRender;
let canvas;

before(async () => {
  await whenReady();

  model = require(locate("drawing-state.js")).default;
  ({ drawingState } = require(locate("editor-state.js")));
  canvasRender = require(locate("canvas-render.js"));
  canvas = document.querySelector(".drawing-canvas");

  await wait(300);
});

after(() => window.close());

function liveIds() {
  return [...canvas.querySelectorAll(":scope > svg.drawing-overlay [data-feature-id]")]
    .map((element) => element.getAttribute("data-feature-id"));
}

async function answerEveryCompile() {
  for (let i = 0; i < 40; i++) {
    while (pending.length) {
      pending.shift()();
    }

    await wait(50);

    if (!pending.length && canvas.querySelector(":scope > svg.drawing-source-layer path")) {
      return;
    }
  }
}

let line;

test("a just-drawn object is on screen before its compile arrives", () => {
  const snapshot = model.snapshotDrawing(drawingState);

  line = model.addObject(drawingState, model.geometryFactories.line({ x: -20, y: 0 }, { x: 20, y: 0 }, {}));
  model.commitDrawingChange(drawingState, snapshot);
  canvasRender.renderCurrentDrawing();

  assert.ok(liveIds().includes(line.id), `the overlay drew ${JSON.stringify(liveIds())}`);
});

test("once the picture shows it, the overlay steps aside", async () => {
  await answerEveryCompile();
  canvasRender.renderCurrentDrawing();

  assert.deepEqual(liveIds(), []);
});

test("an object being moved is drawn where it is, not where the picture last saw it", () => {
  line.geometry.start = { x: -20, y: 30 };
  line.geometry.end = { x: 20, y: 30 };
  canvasRender.renderCurrentDrawing();

  assert.deepEqual(liveIds(), [line.id]);
});

test("the picture's print line widths are shown at the model's screen width", () => {
  const stroke = canvas.querySelector(":scope > svg.drawing-source-layer [stroke-width]");

  assert.ok(stroke, "the compiled picture is on screen");
  /* 0.28pt is lineWidth 0.5, which the model always drew 1.2px wide. */
  assert.equal(Number(stroke.getAttribute("stroke-width")), 1.2);
  assert.equal(stroke.getAttribute("vector-effect"), "non-scaling-stroke");
});
