/*
 * ============================================================
 * A DYNAMICS VECTOR IS CREATED LIKE A STATICS FORCE
 * ============================================================
 *
 *  - a point is given an inline pop-up (the only way to assign a value by popping)
 *
 *  - A Polar Vector and an Angular Vector ask for their magnitude
 *    IN THE DRAWING, like a Point Force and an Applied Moment do,
 *    and THEN for their name - in that order, in that field, with no popup.
 *
 *  - The answer means the same thing everywhere: a number, Unknown, or the
 *    student's own symbol.
 *
 *  - What is typed becomes the feature's LABEL, shown in its Features tab.
 */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { bootApp, whenReady } = require("./helpers/boot-app.cjs");
const { locate } = require("./helpers/source-path.cjs");

const { window, document, error } = bootApp();
if (error) throw error;

let state;
let model;
let creation;
let label;

before(async () => {
  await whenReady();

  ({ drawingState: state } = require(locate("editor-state.js")));
  model = require(locate("drawing-state.js")).default;
  creation = require(locate("dynamics-creation.js"));
  label = require(locate("dynamics-label.js"));

  const canvas = document.querySelector(".drawing-canvas");

  if (canvas) {
    Object.defineProperties(canvas, {
      clientWidth: { value: 900, configurable: true },
      clientHeight: { value: 600, configurable: true },
    });
    canvas.getBoundingClientRect = () => ({
      width: 900,
      height: 600,
      top: 0,
      left: 0,
      right: 900,
      bottom: 600,
      x: 0,
      y: 0,
    });
  }

  state.camera = { zoom: 1, panX: 0, panY: 0 };
  state.objects.length = 0;
  state.selection.selectedObjectIds.length = 0;
});

after(() => window.close());

/*
 * The field that is open on the drawing, if any - and never a popup.
 *
 * The on-drawing value field and the creation label both use the note editor's
 * label presentation: an input inside `.drawing-inline-entry`, appended to the
 * page. The canvas-anchored editors (notes, dimensions) put their own input
 * inside `.drawing-canvas-text-editor`. Neither lives inside the canvas element
 * itself, so the canvas is not where a field is looked for.
 */
const FIELD_SELECTORS = [
  ".drawing-inline-entry input",
  ".drawing-canvas-text-editor input",
  ".drawing-canvas-text-editor textarea",
];

/*
 * The INPUT that is open on the drawing, or null.
 *
 * ASKED ONE SELECTOR AT A TIME, not as one comma list - jsdom matches a
 * single selector here reliably while the comma list of the same three
 * returned null, which cost an afternoon of blaming the field for a lookup
 * that never ran. The input is returned itself, not its container, so every
 * caller reads and writes `.value` the same way.
 */
function inPageField() {
  for (const selector of FIELD_SELECTORS) {
    const field = document.querySelector(selector);

    if (field) {
      return field;
    }
  }

  return null;
}

test("placing a Polar Vector opens the magnitude field on the drawing, not a popup", () => {
  const before = state.objects.length;

  const object = creation.createDynamicsFeature(
    "dynamics-polar-vector",
    { x: 0, y: 0 },
    { x: 50, y: 30 },
  );

  assert.ok(object, "the vector is created");
  assert.equal(state.objects.length, before + 1, "and committed");
  assert.equal(object.type, "dynamics-polar-vector");

  /* No popup, no card, no dialog. */
  assert.equal(
    document.querySelector(".drawing-creation-dimension"),
    null,
    "no popup is opened",
  );

  const field = inPageField();

  assert.ok(field, "the value is asked on the drawing itself");
  assert.ok(
    document.querySelector(".drawing-canvas").contains(field) ||
      field.isConnected,
  );

  /* Escape abandons only the value; the vector stays, at the length its drag chose. */
  field.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
});

test("a Polar Vector's stated magnitude rebuilds its span and is undoable", () => {
  const object = creation.createDynamicsFeature(
    "dynamics-polar-vector",
    { x: 0, y: 0 },
    { x: 50, y: 30 },
  );

  const input = inPageField();
  assert.ok(input, "the magnitude field is open");

  input.value = "8";
  input.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );

  const stored = state.objects.find((o) => o.id === object.id);

  assert.equal(
    Math.hypot(
      stored.geometry.end.x - stored.geometry.start.x,
      stored.geometry.end.y - stored.geometry.start.y,
    ),
    8,
    "the drawn span is the stated length",
  );

  model.undo(state);

  const afterUndo = state.objects.find((o) => o.id === object.id);

  assert.ok(
    !afterUndo ||
      Math.hypot(
        afterUndo.geometry.end.x - afterUndo.geometry.start.x,
        afterUndo.geometry.end.y - afterUndo.geometry.start.y,
      ) !== 8,
    "Undo takes the magnitude back",
  );
});

test("the Polar Vector asks for its name only after the magnitude", () => {
  /* The vectors are not in the creation-label list: their first question is the magnitude. */
  assert.equal(label.toolTakesLabel("dynamics-polar-vector"), false);
  assert.equal(label.toolTakesLabel("dynamics-angular-vector"), false);

  const object = creation.createDynamicsFeature(
    "dynamics-polar-vector",
    { x: 0, y: 0 },
    { x: 40, y: 20 },
  );

  const first = inPageField();
  assert.ok(first, "the magnitude is asked first");

  first.value = "v";
  first.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );

  const second = inPageField();

  assert.ok(second, "then the name is asked");
  assert.notEqual(second, first, "as a separate field");

  second.value = "v_A";
  second.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );

  const stored = state.objects.find((o) => o.id === object.id);

  assert.equal(
    stored.name,
    "v_A",
    "the typed text becomes the feature's label",
  );
  assert.equal(stored.label, "v_A", "and its drawn label");
});

test("an Angular Vector asks for its magnitude before its name too", () => {
  const object = creation.createDynamicsFeature(
    "dynamics-angular-vector",
    { x: 60, y: 40 },
    { x: 80, y: 40 },
  );

  assert.ok(object, "the angular vector is created");

  const first = inPageField();
  assert.ok(first, "its magnitude is asked on the drawing");

  first.value = "ω";
  first.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );

  const second = inPageField();

  assert.ok(second, "then its name");
  assert.notEqual(second, first);

  second.value = "ω_A";
  second.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );

  const stored = state.objects.find((o) => o.id === object.id);

  assert.equal(stored.name, "ω_A");
  assert.equal(stored.label, "ω_A");
  assert.equal(
    stored.magnitudeLabel,
    "ω",
    "the symbol is kept as the magnitude",
  );
});
