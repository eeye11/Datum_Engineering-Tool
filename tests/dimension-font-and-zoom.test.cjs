/*
 * ============================================================
 * A DIMENSION'S SIZE IS A DOCUMENT PROPERTY
 * ============================================================
 *
 * Three claims the brief makes, held to the geometry and the source:
 *
 *   ZOOM IS A VIEWPORT. The drawing and its labels scale together on screen, and
 *   nothing a zoom does reaches a stored size, a reserved box or a TikZ value.
 *
 *   ONE SIZE, THREE VIEWS. The Features panel field, the quick-access control and
 *   the exported `\fontsize` state the same number, and changing it through any
 *   of them changes the same property.
 *
 *   NO HANDLE ON THE LABEL. The control a dimension offers is its placement, and
 *   it is clear of the number at every zoom - the text is not a handle.
 */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { bootApp, whenReady } = require("./helpers/boot-app.cjs");
const { locate } = require("./helpers/source-path.cjs");

const { window, error } = bootApp();
if (error) throw error;

let state;
let model;
let dimensions;
let layout;
let writer;

const near = (a, b, tolerance = 1e-9) => Math.abs(a - b) <= tolerance;

before(async () => {
  await whenReady();

  ({ drawingState: state } = require(locate("editor-state.js")));
  model = require(locate("drawing-state.js")).default;
  dimensions = require(locate("dimension-model.js")).default;
  layout = require(locate("dimension-layout.js"));
  writer = require(locate("annotations.js")).annotationSourceWriter;
});

after(() => window.close());

/* The brief's regression rectangle, with a width dimension labelled "y". */
function rectangleWithWidth(overrides = {}) {
  state.objects.length = 0;
  state.selection.selectedObjectIds.length = 0;
  state.camera = { zoom: 1, panX: 0, panY: 0 };

  const previous = model.snapshotDrawing(state);

  const rectangle = model.addObject(
    state,
    model.geometryFactories.rectangle({ x: 0, y: 95.5743 }, 132.7724, 45.6406),
  );

  const dimension = model.addObject(
    state,
    model.geometryFactories.dimension({
      dimensionType: "horizontal",
      refs: [
        { featureId: rectangle.id, anchor: "bottomLeft" },
        { featureId: rectangle.id, anchor: "bottomRight" },
      ],
      placement: { x: 66.3862, y: 40 },
      dimensionKind: "variable",
      content: "y",
      ...overrides,
    }),
  );

  model.commitDrawingChange(state, previous);

  return { rectangle, dimension };
}

/* ======================================================= document size */

test("a dimension's default label is 11 pt", () => {
  const { dimension } = rectangleWithWidth();

  const graphics = dimensions.graphicsFor(dimension, state);

  assert.equal(graphics.label.fontPt, 11, "11 pt, not 8.25 or 13");

  /* And the source states that same 11. */
  const source = writer(dimension, { state, allObjects: state.objects });

  assert.match(source, /\\fontsize\{11(\.0+)?\}\{/, source);
});

test("the label's size is a style property, not a screen measurement", () => {
  const { dimension } = rectangleWithWidth();

  /* Set the size on the style, as the panel and the quick control do. */
  dimension.style = { ...(dimension.style || {}), fontSize: 16 };

  const graphics = dimensions.graphicsFor(dimension, state);

  assert.equal(graphics.label.fontPt, 16);
  assert.ok(
    near(graphics.label.fontWorld, 16 / layout.POINTS_PER_MM, 1e-9),
    "16 pt is 16/2.835 mm of type in a drawing whose unit is 1 mm",
  );
});

/* ============================================================== zoom */

test("zooming changes no size, no box and no source", () => {
  const { dimension } = rectangleWithWidth();

  const at1 = dimensions.graphicsFor(dimension, state);
  const source1 = writer(dimension, { state, allObjects: state.objects });

  for (const zoom of [0.25, 0.5, 2, 4, 8]) {
    state.camera = { zoom, panX: 0, panY: 0 };

    const at = dimensions.graphicsFor(dimension, state);
    const source = writer(dimension, { state, allObjects: state.objects });

    assert.equal(
      at.label.fontPt,
      at1.label.fontPt,
      `the printed size at zoom ${zoom}`,
    );

    assert.ok(
      near(at.label.fontWorld, at1.label.fontWorld, 1e-12),
      `the reserved type height at zoom ${zoom}`,
    );

    assert.ok(
      near(at.label.halfWidth, at1.label.halfWidth, 1e-12),
      `the reserved type width at zoom ${zoom}`,
    );

    assert.ok(
      near(at.label.gap, at1.label.gap, 1e-12),
      `the label's clearance at zoom ${zoom}`,
    );

    assert.equal(source, source1, `the source at zoom ${zoom}`);
  }
});

test("zooming changes no measurement, line or witness line", () => {
  const { dimension } = rectangleWithWidth();

  const at1 = dimensions.graphicsFor(dimension, state);

  state.camera = { zoom: 5, panX: 0, panY: 0 };

  const at5 = dimensions.graphicsFor(dimension, state);

  assert.deepEqual(at5.points, at1.points, "the measured points");
  assert.deepEqual(at5.line, at1.line, "the dimension line");
  assert.deepEqual(at5.extensions, at1.extensions, "the witness lines");
  assert.equal(at5.measurement.value, at1.measurement.value, "the measurement");
});

/* ===================================================== one property */

test("the quick-access size writes the same property the panel reads", () => {
  const { dimension } = rectangleWithWidth();

  const textControl = require(locate("font-size-control.js"));

  assert.equal(textControl.DEFAULT_FONT_SIZE_PT, 11);

  /* Select the dimension, then set a size through the shared control. */
  state.selection.selectedObjectIds = [dimension.id];

  const result = textControl.applyFontSize(17);

  assert.equal(result.scope, "selection");

  const stored = state.objects.find((object) => object.id === dimension.id);

  assert.equal(stored.style.fontSize, 17, "the object carries the new size");

  /* The panel reads the SAME field, and the source prints the same number. */
  const graphics = dimensions.graphicsFor(stored, state);
  const source = writer(stored, { state, allObjects: state.objects });

  assert.equal(graphics.label.fontPt, 17);
  assert.match(source, /\\fontsize\{17(\.0+)?\}\{/);
});

test("changing the size leaves the measurement and the geometry alone", () => {
  const { dimension } = rectangleWithWidth();

  const before = dimensions.graphicsFor(dimension, state);

  const textControl = require(locate("font-size-control.js"));

  state.selection.selectedObjectIds = [dimension.id];
  textControl.applyFontSize(24);

  const after = dimensions.graphicsFor(dimension, state);

  assert.equal(after.measurement.value, before.measurement.value, "the number measured");
  assert.deepEqual(after.points, before.points, "the defining points");
  assert.deepEqual(after.line, before.line, "the dimension line");
  assert.deepEqual(after.extensions, before.extensions, "the witness lines");
});

test("a size change is one undoable step", () => {
  const { dimension } = rectangleWithWidth();

  const textControl = require(locate("font-size-control.js"));

  state.selection.selectedObjectIds = [dimension.id];

  textControl.applyFontSize(20);

  const stored = () =>
    state.objects.find((object) => object.id === dimension.id).style.fontSize;

  assert.equal(stored(), 20);

  model.undo(state);

  assert.notEqual(stored(), 20, "Undo restores the previous size");

  model.redo(state);

  assert.equal(stored(), 20, "Redo puts it back");
});

test("with nothing text-sized selected the size becomes the default", () => {
  const { rectangle } = rectangleWithWidth();

  const textControl = require(locate("font-size-control.js"));

  /* A rectangle is geometry, not type: selecting it does not show its size. */
  state.selection.selectedObjectIds = [rectangle.id];

  assert.equal(textControl.isTextSizedObject(rectangle), false);

  const result = textControl.applyFontSize(14);

  assert.equal(result.scope, "default");
  assert.equal(state.styleDefaults.fontSize, 14);
});

/* ======================================================= no text handle */

test("no dimension handle is drawn on its label", () => {
  const { dimension } = rectangleWithWidth();

  const handles = require(locate("handles.js"));

  state.selection.selectedObjectIds = [dimension.id];
  state.camera = { zoom: 1, panX: 0, panY: 0 };

  const points = handles.editableHandlesFor(dimension);
  const graphics = dimensions.graphicsFor(dimension, state);

  assert.ok(points.length <= 1, "at most the placement control");

  const label = graphics.textFrame;

  points.forEach((handle) => {
    const dx = handle.point.x - label.x;
    const dy = handle.point.y - label.y;

    /*
     * A HANDLE INSIDE THE GLYPHS IS THE DEFECT. The control must sit outside the
     * text's own measured box - so the words remain clickable and readable.
     */
    const outside =
      Math.abs(dx) > label.width / 2 + 1e-6 ||
      Math.abs(dy) > label.height / 2 + 1e-6;

    assert.ok(
      outside,
      `handle at (${handle.point.x}, ${handle.point.y}) is inside the label box`,
    );
  });
});

test("the placement control is kept, and it is not the text", () => {
  const { dimension } = rectangleWithWidth();

  const handles = require(locate("handles.js"));

  state.selection.selectedObjectIds = [dimension.id];

  const points = handles.editableHandlesFor(dimension);

  assert.equal(points.length, 1, "the dimension still offers its placement");
  assert.equal(points[0].kind, "annotation-offset");
});
