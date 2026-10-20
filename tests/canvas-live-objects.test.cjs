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

/*
 * A COMPILED STROKE IS SHOWN AT THE WIDTH IT STATES.
 *
 * `showStrokesAtScreenWidth` adopts the picture's own print width for the screen
 * (pinned against zoom), and the generator writes that width as
 * `nominalWidth x the drawing's export factor`. So the number on the sheet is the
 * number in the source - which is what makes the picture look the same here and
 * in any external renderer.
 *
 * The stub above states `stroke-width=".28"`, which is under the half-pixel
 * floor the canvas keeps so a hairline stays visible - so the sheet shows 0.5 px.
 * What matters is the INVARIANT: the shown width equals the stated width, never
 * the `x 4.3` inflation an older conversion applied to recover a "screen" width.
 */
test("the picture's print line widths are shown at the width they state", () => {
  const stroke = canvas.querySelector(":scope > svg.drawing-source-layer [stroke-width]");

  assert.ok(stroke, "the compiled picture is on screen");

  /* 0.28pt is below the readable floor, so it is shown there - not inflated. */
  assert.equal(Number(stroke.getAttribute("stroke-width")), 0.5);
  assert.equal(stroke.getAttribute("vector-effect"), "non-scaling-stroke");
});

test("and every declared width is a nominal preset at the drawing's one factor", () => {
  const { activeSourceManager } = require(locate("drawing-source-manager.js"));
  const { exportTransformFor } = require(locate("source-synchronization.js"));

  const source = activeSourceManager().getSource();
  const declared = [...source.matchAll(/line width=([\d.]+)pt/g)].map((match) => Number(match[1]));

  assert.ok(declared.length > 0, `the drawing has a stroke width: ${source}`);

  /*
   * ONE FACTOR, APPLIED ONCE. Dividing a declared width by the drawing's export
   * factor gives back the NOMINAL width the object's style holds. If the factor
   * were applied twice, or not at all, this quotient would not be one of the
   * presets - which is the whole contract in one assertion.
   */
  const factor = exportTransformFor(drawingState.objects).factor;
  const presets = [0.1, 0.2, 0.4, 0.6, 0.8, 1.2, 1.6];

  for (const width of declared) {
    const nominal = width / factor;

    assert.ok(
      presets.some((preset) => Math.abs(preset - nominal) < 0.02),
      `a declared width of ${width}pt is ${nominal.toFixed(3)}pt nominal at factor ${factor.toFixed(4)}`,
    );
  }
});
