const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { bootApp, whenReady } = require("./helpers/boot-app.cjs");
const { locate } = require("./helpers/source-path.cjs");
const { window, document, error } = bootApp();
if (error) throw error;
let state, model, tool, refs, canvas;
before(async () => {
  await whenReady();
  ({ drawingState: state } = require(locate("editor-state.js")));
  model = require(locate("drawing-state.js")).default;
  tool = require(locate("dimension-tool.js"));
  // The in-page field is positioned against the canvas, so it needs a real box.
  canvas = document.querySelector(".drawing-canvas");
  Object.defineProperties(canvas, {
    clientWidth: { value: 900, configurable: true },
    clientHeight: { value: 600, configurable: true },
  });
  canvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 900,
    bottom: 600,
    width: 900,
    height: 600,
  });
  const previous = model.snapshotDrawing(state);
  const line = model.addObject(
    state,
    model.geometryFactories.line({ x: 0, y: 0 }, { x: 100, y: 0 }),
  );
  model.commitDrawingChange(state, previous);
  refs = [
    { featureId: line.id, anchor: "start" },
    { featureId: line.id, anchor: "end" },
  ];
});
after(() => window.close());

function press(field, key) {
  field.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    }),
  );
}
function inPageField() {
  return document.querySelector(".drawing-dimension-text-editor");
}
/*
 * CREATION IS ON THE PAGE, NOT IN A POPUP.
 *
 * Placing a dimension commits it at once and opens the IN-PAGE text field over
 * the number - the same field a double-click opens. There is no modal question
 * on the way, and nothing is created only if the student answers it. These
 * tests used to drive the removed popup; they now hold the in-page workflow.
 */
test("placing a dimension creates it and opens its in-page text field", () => {
  model.setActiveTool(state, "dimension");
  const before = state.objects.length;
  tool.commitDimension("linear", refs, { x: 40, y: 20 });

  assert.equal(state.objects.length, before + 1, "the dimension is placed at once");
  assert.equal(
    document.querySelector(".drawing-creation-dimension"),
    null,
    "no popup is opened",
  );

  const field = inPageField();
  assert.ok(field, "the label is edited on the page");
  assert.equal(canvas.contains(field), true, "the field is part of the canvas");

  press(field.querySelector("input"), "Escape");

  assert.equal(field.isConnected, false, "escaping the edit closes it");
  assert.equal(
    state.objects.length,
    before + 1,
    "escaping the label does not delete the placed dimension",
  );
});
test("the label typed on the page becomes the dimension's content and reopens in place", () => {
  model.setActiveTool(state, "dimension");
  tool.commitDimension("linear", refs, { x: 40, y: 20 });

  const variable = state.objects.filter((o) => o.type === "dimension").at(-1);
  assert.ok(variable);

  const creation = inPageField();
  assert.ok(creation, "creation opens the in-page field");
  const entry = creation.querySelector("input");
  entry.value = "L/2";
  press(entry, "Enter");

  assert.equal(variable.content, "L/2");
  assert.equal(variable.dimensionKind, "variable", "typed text makes it an authored label");

  tool.openDimensionValuePrompt(variable);

  /*
   * THE NUMBER IS EDITED ON THE SHEET, NOT IN A DIALOG. The field is inside the
   * canvas, over the glyphs, and no popup, modal or floating form exists.
   */
  const field = inPageField();
  assert.ok(field, "the dimension text opens in place");
  assert.equal(field.querySelector("input").value, "L/2");
  assert.equal(canvas.contains(field), true, "the field is part of the page");
  assert.equal(
    document.querySelector(".dimension-value-editor"),
    null,
    "no popup editor is opened",
  );

  const editor = field.querySelector("input");
  editor.value = "";
  press(editor, "Enter");
  assert.ok(field.isConnected, "a blank label keeps the field open");
  assert.equal(variable.content, "L/2");

  editor.value = "θ + b";
  press(editor, "Enter");
  assert.equal(field.isConnected, false, "committing closes the field");
  const current = state.objects.find((o) => o.id === variable.id);
  assert.equal(current.content, "θ + b");
  assert.equal(
    current.type,
    "dimension",
    "the dimension keeps its identity and type",
  );
});
test("unified Dimension edits magnitude without resizing geometry or exposing modes", () => {
  model.setActiveTool(state, "dimension");
  const before = structuredClone(
    state.objects.find((o) => o.id === refs[0].featureId).geometry,
  );
  tool.commitDimension("linear", refs, { x: 30, y: 20 });
  const entry = inPageField().querySelector("input");
  entry.value = "65 mm";
  press(entry, "Enter");
  const dimension = state.objects.filter((o) => o.type === "dimension").at(-1);
  assert.equal(dimension.content, "65 mm");

  tool.openDimensionValuePrompt(dimension);
  const field = inPageField();
  assert.equal(
    field.querySelector("select"),
    null,
    "no mode switch is offered",
  );
  const input = field.querySelector("input");
  assert.equal(input.readOnly, false);
  input.value = "80 mm";
  press(input, "Enter");
  const current = state.objects.find((o) => o.id === dimension.id);
  assert.equal(current.content, "80 mm");
  assert.deepEqual(
    state.objects.find((o) => o.id === refs[0].featureId).geometry,
    before,
  );
  assert.deepEqual(current.sourceRefs, dimension.sourceRefs);
});
test("Escape abandons an in-page edit and leaves the dimension as it was", () => {
  model.setActiveTool(state, "dimension");
  tool.commitDimension("linear", refs, { x: 35, y: 15 });
  const dimension = state.objects.filter((o) => o.type === "dimension").at(-1);
  dimension.dimensionKind = "variable";
  dimension.content = "L";

  tool.openDimensionValuePrompt(dimension);
  const field = inPageField();
  const input = field.querySelector("input");
  input.value = "changed";
  press(input, "Escape");

  assert.equal(field.isConnected, false);
  assert.equal(state.objects.find((o) => o.id === dimension.id).content, "L");
});
