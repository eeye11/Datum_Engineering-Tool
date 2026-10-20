/* eslint-disable no-console */
/*
 * ========================================================
 * THE DRAWING SPACE KEEPS UP WITH THE SOURCE
 * ========================================================
 *
 * statics-live-pipeline proves the whole chain with the real TeX engine. This
 * suite pins down the SCHEDULING between Source and the canvas, which is where
 * the recurring "the code is in Source but the drawing never appears" defect
 * actually lived:
 *
 *   - every redraw restarted the compile debounce, so while the pointer moved
 *     over the canvas no compile was ever sent;
 *   - a second request for the same revision abandoned the compile already
 *     running;
 *   - a source TeX rejected was re-sent on every redraw;
 *   - the Source tab ran its own compile of a different text.
 *
 * The renderer here is a stub the test controls - each request is held until
 * the test answers it - so ordering can be forced instead of hoped for.
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

/* ------------------------------------------------------- the stub renderer */

/* Every request, in order: { tikz, answer(svgOrError) }. */
const requests = [];
let autoAnswer = true;

function svgFor(tag) {
  return `<svg xmlns="http://www.w3.org/2000/svg"><g data-picture="${tag}"><path d="M0 0L1 1"/></g></svg>`;
}

window.fetch = globalThis.fetch = (url, options = {}) => {
  if (!String(url).includes("/api/render-tikz")) {
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  }

  const tikz = JSON.parse(options.body || "{}").tikz;

  return new Promise((resolve) => {
    const answer = (result) => {
      if (result instanceof Error) {
        resolve({ ok: false, status: 422, json: async () => ({ success: false, error: result.message }) });
      } else {
        resolve({ ok: true, status: 200, json: async () => ({ success: true, svg: result }) });
      }
    };

    const entry = { tikz, answer, answered: false };

    entry.answer = (result) => {
      entry.answered = true;
      answer(result);
    };

    requests.push(entry);

    if (autoAnswer) {
      entry.answer(/\\BROKEN/.test(tikz) ? new Error("! Undefined control sequence \\BROKEN.") : svgFor(requests.length));
    }
  });
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------- the app */

let model;
let drawingState;
let manager;
let canvasRender;
let canvas;

before(async () => {
  await whenReady();

  model = require(locate("drawing-state.js")).default;
  ({ drawingState } = require(locate("editor-state.js")));
  manager = require(locate("drawing-source-manager.js")).activeSourceManager();
  canvasRender = require(locate("canvas-render.js"));
  canvas = document.querySelector(".drawing-canvas");

  await wait(600);
});

after(() => window.close());

function add(object) {
  const snapshot = model.snapshotDrawing(drawingState);
  const stored = model.addObject(drawingState, object);

  model.commitDrawingChange(drawingState, snapshot);

  return stored;
}

function pictureTag() {
  return canvas.querySelector(":scope > svg.drawing-source-layer [data-picture]")?.getAttribute("data-picture") || null;
}

/* Wait until `check` holds, or fail with `message` after `ms`. */
async function until(check, message, ms = 3000) {
  const deadline = Date.now() + ms;

  while (Date.now() < deadline) {
    if (check()) {
      return;
    }

    await wait(20);
  }

  assert.fail(message);
}

/* ============================================================== tests */

test("a canvas that is redrawn constantly still receives the compiled picture", async () => {
  const f = model.geometryFactories;

  add(f.beam({ x: -40, y: 0 }, { x: 40, y: 0 }, {}));
  add(f["pin-support"]({ x: -40, y: 0 }, {}));

  /*
   * The pointer moving over the canvas: a redraw every 30 ms, well inside the
   * compile debounce. Before the fix each one restarted the debounce and no
   * compile was ever sent for as long as the pointer moved.
   */
  const storm = setInterval(() => canvasRender.requestRender(), 30);

  try {
    await until(
      () => canvasRender.renderedSourceRevision() === manager.revision(),
      `the canvas never showed revision ${manager.revision()} while it was being redrawn ` +
        `(it shows ${canvasRender.renderedSourceRevision()})`,
    );
  } finally {
    clearInterval(storm);
  }

  assert.ok(pictureTag(), "no compiled picture is on the canvas");
});

test("one revision is compiled once, however many times a redraw asks", async () => {
  const before = requests.length;

  add(model.geometryFactories.particle({ x: 0, y: 40 }, {}));

  for (let index = 0; index < 50; index += 1) {
    canvasRender.requestRender();
    canvasRender.requestSourceRender();
  }

  await until(() => canvasRender.renderedSourceRevision() === manager.revision(), "the revision never rendered");
  await wait(400);

  assert.equal(requests.length - before, 1, "the same revision was sent to the renderer more than once");
  assert.equal(
    requests[requests.length - 1].tikz,
    manager.getVisibleSource(),
    "the renderer was not given the Source tab's text",
  );
});

test("an older compile finishing late never replaces a newer revision's picture", async () => {
  autoAnswer = false;

  try {
    const f = model.geometryFactories;

    add(f.cable({ x: -40, y: 60 }, { x: 40, y: 60 }, {}));
    const older = manager.revision();

    await until(() => requests.some((entry) => !entry.answered), "the first edit was never sent");
    const first = requests.find((entry) => !entry.answered);

    /* A newer edit arrives while the first compile is still running. */
    add(f.particle({ x: 20, y: 80 }, {}));
    const newer = manager.revision();

    assert.ok(newer > older);

    /* The first compile now finishes - late. */
    first.answer(svgFor("stale"));
    await wait(50);

    assert.notEqual(pictureTag(), "stale", "a compile of an older revision replaced the picture");
    assert.notEqual(canvasRender.renderedSourceRevision(), older, "the canvas adopted the older revision");

    /* ...and the current revision is compiled next, with its own text. */
    await until(
      () => requests.some((entry) => !entry.answered && entry !== first),
      "the newer revision was not compiled after the older one finished",
    );

    const second = requests.find((entry) => !entry.answered);

    assert.equal(second.tikz, manager.getVisibleSource(), "the follow-up compile was not of the current source");

    second.answer(svgFor("current"));

    await until(() => pictureTag() === "current", "the current revision's picture was not shown");
    assert.equal(canvasRender.renderedSourceRevision(), newer);
  } finally {
    autoAnswer = true;
  }
});

test("a source TeX rejects keeps the source, the objects and the last picture - and is not re-sent", async () => {
  await until(() => canvasRender.renderedSourceRevision() === manager.revision(), "the sheet never settled");

  const goodPicture = pictureTag();
  const objectCount = drawingState.objects.length;
  const visible = manager.getVisibleSource();

  /* The student types a command TeX does not know. */
  const broken = visible.replace("\\end{tikzpicture}", "\\BROKEN\n\\end{tikzpicture}");

  manager.setVisibleSource(broken);

  await until(() => canvasRender.lastCompiledError(), "the compile failure was not reported");

  assert.match(canvasRender.lastCompiledError(), /BROKEN/, "the report is not the compiler's own message");
  assert.equal(pictureTag(), goodPicture, "the last good picture was taken down");
  assert.equal(drawingState.objects.length, objectCount, "a failed compile changed the object model");
  assert.ok(manager.getVisibleSource().includes("\\BROKEN"), "the student's text was replaced");

  /* Redraws do not resend a source that is known to fail. */
  const sent = requests.length;

  for (let index = 0; index < 20; index += 1) {
    canvasRender.requestRender();
  }

  await wait(500);
  assert.equal(requests.length, sent, "the failing source was sent again on redraw");

  /* Correcting it renders the latest drawing. */
  manager.setVisibleSource(visible);

  await until(
    () => canvasRender.renderedSourceRevision() === manager.revision() && !canvasRender.lastCompiledError(),
    "the corrected source did not render",
  );
  assert.notEqual(pictureTag(), goodPicture, "the corrected source's picture was not shown");
});

test("the Source tab does not run a second compile of its own", async () => {
  const { onSourceTabOpened } = require(locate("source-tab.js"));
  const before = requests.length;

  add(model.geometryFactories.particle({ x: -20, y: -40 }, {}));

  onSourceTabOpened();

  await until(() => canvasRender.renderedSourceRevision() === manager.revision(), "the revision never rendered");
  await wait(600);

  const sent = requests.slice(before);

  assert.equal(sent.length, 1, `one edit produced ${sent.length} compiles`);
  assert.ok(!/DAETUM_OBJECT_BEGIN/.test(sent[0].tikz), "a compile was sent with the bookkeeping markers in it");
});

test("an object that cannot be written is named, and the rest of the sheet still draws", async () => {
  const { sourceGenerationProblems } = require(locate("source-diagnostics.js"));

  const broken = add(model.geometryFactories.force({ x: 0, y: 0 }, { x: 0, y: 30 }, {}));

  /* A force whose stored geometry no longer describes an arrow. */
  const snapshot = model.snapshotDrawing(drawingState);

  broken.geometry = { label: "F" };
  model.commitDrawingChange(drawingState, snapshot);

  const problems = sourceGenerationProblems();

  assert.ok(
    problems.some((problem) => problem.id === broken.id),
    "the object that was left out of the source is not reported",
  );
  assert.ok(
    drawingState.objects.some((object) => object.id === broken.id),
    "the object was dropped from the model",
  );

  /* No block - not even a lone label - claims to be the object. */
  assert.ok(
    !manager.getSource().includes(`DAETUM_OBJECT_BEGIN id="${broken.id}"`),
    "the object kept a source block that no longer describes it",
  );

  await until(() => canvasRender.renderedSourceRevision() === manager.revision(), "the rest of the sheet did not render");

  /* Deleting it clears the report. */
  model.selectObject(drawingState, broken.id);
  require(locate("delete-command.js")).deleteSelectedObjects();

  assert.ok(
    !sourceGenerationProblems().some((problem) => problem.id === broken.id),
    "a deleted object is still reported as missing from the source",
  );
});

test("a clockwise moment's head points clockwise, an anticlockwise one's anticlockwise", () => {
  const { serializeStaticsObject } = require(locate("statics.js"));
  const f = model.geometryFactories;

  const arcOf = (direction) => {
    const source = serializeStaticsObject(f.moment({ x: 0, y: 0 }, 10, direction, {}));
    const match = /\[([^\]]*)\][^\n]*arc\[start angle=(-?[\d.]+), end angle=(-?[\d.]+)/.exec(source);

    assert.ok(match, `no arc in the ${direction} moment:\n${source}`);

    return { options: match[1], start: Number(match[2]), end: Number(match[3]) };
  };

  const cw = arcOf("CW");
  const ccw = arcOf("CCW");

  /* The head is at the END of the sweep, and the sweep runs the right way. */
  assert.match(cw.options, /(^|, )-\{Latex\}/, "the CW head is not at the end of its sweep");
  assert.ok(cw.end < cw.start, "the CW arc does not sweep clockwise");

  assert.match(ccw.options, /(^|, )-\{Latex\}/, "the CCW head is not at the end of its sweep");
  assert.ok(ccw.end > ccw.start, "the CCW arc does not sweep anticlockwise");
});

test("a diagram's unit is never a maths command in text mode", () => {
  const { serializeStaticsObject } = require(locate("statics.js"));
  const f = model.geometryFactories;

  for (const factory of ["shear-force-diagram", "bending-moment-diagram", "axial-force-diagram"]) {
    const source = serializeStaticsObject(f[factory]({ x: 0, y: 0 }, { x: 100, y: 0 }));

    assert.ok(source, `${factory} wrote no source`);

    /* Outside $...$, \cdot is a TeX error that stops the whole sheet. */
    const text = source.replace(/\$[^$]*\$/g, "");

    assert.ok(!/\\cdot/.test(text), `${factory} writes \\cdot outside maths mode:\n${source}`);
  }
});
