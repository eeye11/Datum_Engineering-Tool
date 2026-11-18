/*
 * ============================================================
 * CANVAS TYPOGRAPHY: ONE SYSTEM, ONE SCREEN SIZE, AT EVERY ZOOM
 * ============================================================
 *
 * The brief's central correction, held to the renderer itself:
 *
 *   POSITION IS DRAWING-SPACE. A label's anchor is its projected drawing point,
 *   so it moves with the object it belongs to, whatever the zoom or the pan.
 *
 *   SIZE IS SCREEN-SPACE. The glyphs measure the same pixels at 25%, 100% and
 *   400% - the camera is cancelled on the type alone, not on the drawing.
 *
 *   ONE HIERARCHY. Every tool states a ROLE, never a number, and a stored size
 *   that is missing or broken resolves to the same default for every tool.
 *
 *   GEOMETRY IS NOT TOUCHED. A size change rewrites `style` and nothing else.
 *
 * The assertions are on the rendered SVG and on the model, because "the text
 * looked better" is exactly the check that would pass while the zoom still
 * scaled the glyphs.
 */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { bootApp, whenReady } = require("./helpers/boot-app.cjs");
const { locate } = require("./helpers/source-path.cjs");

const { window, document, error } = bootApp();
if (error) throw error;

let typography;
let model;
let state;
let renderer;

before(async () => {
  await whenReady();

  typography = require(locate("canvas-typography.js"));
  model = require(locate("drawing-state.js")).default;
  state = require(locate("editor-state.js")).drawingState;
  renderer = require(locate("renderer.js")).default;
});

after(() => window.close());

/* ============================================================ the tokens */

test("the four roles are the brief's sizes, and 16 is the default", () => {
  assert.equal(typography.AUXILIARY_FONT_PX, 12);
  assert.equal(typography.SECONDARY_FONT_PX, 14);
  assert.equal(typography.PRIMARY_FONT_PX, 16);
  assert.equal(typography.TITLE_FONT_PX, 18);

  assert.equal(typography.DEFAULT_CANVAS_FONT_PX, 16);
  assert.equal(typography.TEXT_ROLES.primary.default, true);
});

test("the quick-access choices are the brief's list", () => {
  assert.deepEqual(
    [...typography.FONT_SIZE_CHOICES],
    [12, 14, 16, 18, 20, 24, 28, 32],
  );
});

test("a broken stored size resolves to the fallback, a real one is preserved", () => {
  /* Missing, zero, a negative and a string are all unusable. */
  assert.deepEqual(typography.normaliseFontSize(undefined, 16), {
    size: 16,
    status: "missing",
  });
  assert.deepEqual(typography.normaliseFontSize(0, 16), {
    size: 16,
    status: "invalid",
  });
  assert.deepEqual(typography.normaliseFontSize(-4, 16), {
    size: 16,
    status: "invalid",
  });
  assert.deepEqual(typography.normaliseFontSize("wide", 16), {
    size: 16,
    status: "invalid",
  });

  /* A REAL size - including one that is not a role - is the student's own. */
  assert.deepEqual(typography.normaliseFontSize(17, 16), {
    size: 17,
    status: "valid",
  });
  assert.deepEqual(typography.normaliseFontSize(10, 16), {
    size: 10,
    status: "valid",
  });

  /* And the range is enforced at the ends. */
  assert.equal(typography.fontSizeOf(500, 16), typography.FONT_PX_MAX);
  assert.equal(typography.fontSizeOf(0.5, 16), typography.FONT_PX_MIN);
});

test("a tool names a role, never a number", () => {
  assert.equal(typography.typographyFor("title").size, 18);
  assert.equal(typography.typographyFor("secondary").size, 14);
  assert.equal(typography.typographyFor("primary").size, 16);

  /* An unknown role falls back to the default rather than inventing a size. */
  assert.equal(typography.typographyFor("enormous").size, 16);

  /* An explicit size wins - the student's own choice. */
  assert.equal(typography.typographyFor("primary", { size: 22 }).size, 22);
});

/* ====================================================== the compensation */

test("at 1:1 a text node states its size and carries no transform", () => {
  const { attributes, transform } = typography.textFontAttributes(
    { size: 16 },
    1,
  );

  assert.equal(attributes["font-size"], 16);
  assert.equal(transform, null, "no inverse-zoom work is needed at 1:1");
});

test("at every other zoom the camera is multiplied in and divided out", () => {
  for (const zoom of [0.25, 0.5, 2, 4]) {
    const { attributes, transform } = typography.textFontAttributes(
      { size: 16 },
      zoom,
    );

    assert.equal(
      attributes["font-size"],
      16 * zoom,
      `the attribute carries the camera at zoom ${zoom}`,
    );

    assert.equal(
      transform,
      `scale(${Math.round((1 / zoom) * 1e6) / 1e6})`,
      `and the transform divides it back out at zoom ${zoom}`,
    );

    /* What reaches the screen is the screen size, exactly. */
    assert.ok(Math.abs(attributes["font-size"] * (1 / zoom) - 16) < 1e-6);
  }
});

test("the compensation is anchored on the text's own point", () => {
  const at = { x: 120, y: 340 };

  assert.equal(typography.textTransform(at, 1), null);
  assert.equal(
    typography.textTransform(at, 2),
    "translate(120 340) scale(0.5)",
    "the glyphs are scaled about the anchor, not about the SVG origin",
  );

  /* A rotation composes with the compensation, both about the anchor. */
  assert.equal(
    typography.textTransform(at, 2, "rotate(-90)"),
    "translate(120 340) rotate(-90) scale(0.5)",
  );
});

/* ================================================== the rendered canvas */

function drawAt(zoom) {
  state.camera = { zoom, panX: 0, panY: 0 };

  const host = document.createElement("div");
  document.body.append(host);
  Object.defineProperties(host, {
    clientWidth: { value: 900 },
    clientHeight: { value: 600 },
  });
  host.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 900,
    height: 600,
  });

  renderer.renderDrawing(state, host);

  return host;
}

function noteLabel(host) {
  return [...host.querySelectorAll("text")].find((node) =>
    node.textContent.includes("HELLO"),
  );
}

function scene() {
  state.objects.length = 0;
  state.selection.selectedObjectIds.length = 0;
  state.styleDefaults = { ...state.styleDefaults, fontSize: 16 };

  const previous = model.snapshotDrawing(state);

  const note = model.addObject(
    state,
    model.geometryFactories.annotate({
      kind: "note",
      text: "HELLO",
      position: { x: 0, y: 0 },
    }),
  );

  model.commitDrawingChange(state, previous);

  return note;
}

test("a note is created at the shared default", () => {
  const note = scene();

  assert.equal(note.style.fontSize, 16);
});

test("canvas text measures the same at 25%, 100%, 200% and 400%", () => {
  scene();

  const seen = [];

  for (const zoom of [0.25, 1, 2, 4]) {
    const host = drawAt(zoom);
    const label = noteLabel(host);

    assert.ok(label, `the note is drawn at zoom ${zoom}`);

    const attribute = Number(label.getAttribute("font-size"));
    const transform = label.getAttribute("transform") || "";

    const scale = /scale\(([\d.]+)\)/.exec(transform);
    const rendered = attribute * (scale ? Number(scale[1]) : 1);

    seen.push(rendered);
    host.remove();
  }

  seen.forEach((size) => {
    assert.ok(
      Math.abs(size - 16) < 1e-6,
      `the glyphs measure ${size} px on screen, not 16 (sizes seen: ${seen.join(", ")})`,
    );
  });
});

test("the label's anchor is still its projected drawing position", () => {
  scene();

  const at1 = drawAt(1);
  const label1 = noteLabel(at1);

  const expected = model.engineeringToScreen(
    state.objects[0].geometry.position,
    { width: 900, height: 600 },
    state,
  );

  assert.ok(Math.abs(Number(label1.getAttribute("x")) - expected.x) < 1e-6);
  assert.ok(Math.abs(Number(label1.getAttribute("y")) - expected.y) < 1e-6);

  at1.remove();

  /* Zooming moves the anchor with the drawing, and only with the drawing. */
  const at2 = drawAt(2);
  const label2 = noteLabel(at2);

  const expected2 = model.engineeringToScreen(
    state.objects[0].geometry.position,
    { width: 900, height: 600 },
    state,
  );

  assert.ok(Math.abs(Number(label2.getAttribute("x")) - expected2.x) < 1e-6);
  assert.ok(Math.abs(Number(label2.getAttribute("y")) - expected2.y) < 1e-6);

  at2.remove();
});

/* ================================================ the toolbar's semantics */

test("the quick-access control reads and writes one property", () => {
  const control = require(locate("font-size-control.js"));

  const note = scene();

  state.selection.selectedObjectIds = [note.id];

  /* B - a text-bearing object is updated without touching its geometry. */
  const geometryBefore = JSON.stringify(note.geometry);

  control.applyFontSize(24);

  const stored = state.objects.find((object) => object.id === note.id);

  assert.equal(stored.style.fontSize, 24);
  assert.equal(
    JSON.stringify(stored.geometry),
    geometryBefore,
    "no geometry changed",
  );

  /* A - the state the control displays follows the model. */
  const view = control.fontSizeState();

  assert.equal(view.scope, "selection");
  assert.equal(view.size, 24);
  assert.equal(view.mixed, false);
});

test("several disagreeing sizes are a mixed state, and one choice applies to all", () => {
  const control = require(locate("font-size-control.js"));

  state.objects.length = 0;
  state.selection.selectedObjectIds.length = 0;

  const previous = model.snapshotDrawing(state);

  const first = model.addObject(
    state,
    model.geometryFactories.annotate({
      kind: "note",
      text: "A",
      position: { x: 0, y: 0 },
    }),
  );
  const second = model.addObject(
    state,
    model.geometryFactories.annotate({
      kind: "note",
      text: "B",
      position: { x: 30, y: 0 },
    }),
  );

  first.style = { ...first.style, fontSize: 14 };
  second.style = { ...second.style, fontSize: 28 };

  model.commitDrawingChange(state, previous);

  state.selection.selectedObjectIds = [first.id, second.id];

  const mixed = control.fontSizeState();

  assert.equal(mixed.mixed, true, "C - the control reports a mixed state");
  assert.deepEqual(
    [...mixed.sizes].sort((a, b) => a - b),
    [14, 28],
  );

  control.applyFontSize(18);

  assert.equal(state.objects.find((o) => o.id === first.id).style.fontSize, 18);
  assert.equal(
    state.objects.find((o) => o.id === second.id).style.fontSize,
    18,
  );

  assert.equal(control.fontSizeState().mixed, false);
});

test("with nothing text-bearing selected the control sets the new-text default", () => {
  const control = require(locate("font-size-control.js"));

  const line = model.geometryFactories.line({ x: 0, y: 0 }, { x: 10, y: 0 });

  state.objects.length = 0;
  state.selection.selectedObjectIds = [];

  const previous = model.snapshotDrawing(state);

  const stored = model.addObject(state, line);

  model.commitDrawingChange(state, previous);

  state.selection.selectedObjectIds = [stored.id];

  assert.equal(control.isTextSizedObject(stored), false);

  const result = control.applyFontSize(20);

  assert.equal(result.scope, "default");
  assert.equal(state.styleDefaults.fontSize, 20);

  /* E - and the next note is created at it. */
  const note = model.addObject(
    state,
    model.geometryFactories.annotate({
      kind: "note",
      text: "NEW",
      position: { x: 0, y: 0 },
      document: state,
    }),
  );

  assert.equal(note.style.fontSize, 20);
});

/* ============================================== geometry is never touched */

test("a size change leaves a dimension's measurement and lines alone", () => {
  const dimensions = require(locate("dimension-model.js")).default;
  const control = require(locate("font-size-control.js"));

  state.objects.length = 0;
  state.selection.selectedObjectIds.length = 0;
  state.camera = { zoom: 1, panX: 0, panY: 0 };

  const previous = model.snapshotDrawing(state);

  const line = model.addObject(
    state,
    model.geometryFactories.line({ x: 0, y: 0 }, { x: 100, y: 0 }),
  );
  const dimension = model.addObject(
    state,
    model.geometryFactories.dimension({
      dimensionType: "horizontal",
      refs: [
        { featureId: line.id, anchor: "start" },
        { featureId: line.id, anchor: "end" },
      ],
      placement: { x: 50, y: 20 },
    }),
  );

  model.commitDrawingChange(state, previous);

  const before = dimensions.graphicsFor(dimension, state);

  state.selection.selectedObjectIds = [dimension.id];
  control.applyFontSize(28);

  const after = dimensions.graphicsFor(dimension, state);

  assert.equal(
    after.measurement.value,
    before.measurement.value,
    "the measurement",
  );
  assert.deepEqual(after.points, before.points, "the defining points");
  assert.deepEqual(after.line, before.line, "the dimension line");
  assert.deepEqual(after.extensions, before.extensions, "the witness lines");
  assert.equal(after.label.fontSize, 28, "but the type did change");
});

/* ============================================================== legacy */

test("a saved object with no size is normalised on load, a custom size is kept", () => {
  const restored = model.createDrawingState();

  restored.styleDefaults = { ...restored.styleDefaults, fontSize: 16 };

  model.restoreDocument(restored, {
    objects: [
      {
        id: "legacy-note",
        name: "Note 1",
        type: "annotate",
        annotateKind: "note",
        text: "Old",
        geometry: { position: { x: 0, y: 0 } },
        style: { stroke: "#000000" },
        metadata: {},
      },
      {
        id: "custom-note",
        name: "Note 2",
        type: "annotate",
        annotateKind: "note",
        text: "Mine",
        geometry: { position: { x: 5, y: 0 } },
        style: { stroke: "#000000", fontSize: 21 },
        metadata: {},
      },
      {
        id: "broken-note",
        name: "Note 3",
        type: "annotate",
        annotateKind: "note",
        text: "Broken",
        geometry: { position: { x: 9, y: 0 } },
        style: { stroke: "#000000", fontSize: "big" },
        metadata: {},
      },
    ],
  });

  const byId = (id) => restored.objects.find((object) => object.id === id);

  assert.equal(
    byId("legacy-note").style.fontSize,
    16,
    "a missing size takes the default",
  );
  assert.equal(
    byId("custom-note").style.fontSize,
    21,
    "a custom size is preserved",
  );
  assert.equal(
    byId("broken-note").style.fontSize,
    16,
    "a broken size is repaired",
  );
});

/* ========================================================= one renderer */

test("the renderer contains no literal font sizes", () => {
  const { rendererSource } = require("./helpers/source-path.cjs");
  const source = rendererSource();

  const literals = [...source.matchAll(/"font-size"\s*:\s*(\d+)/g)].map(
    (match) => match[1],
  );

  assert.deepEqual(
    literals,
    [],
    `every canvas font size comes from the shared tokens; found literals: ${literals.join(", ")}`,
  );
});
