/*
 * MIRROR AND PASTE GIVE THE NEW FEATURE AN ID, NOT ITSELF.
 *
 * `addObject` returns the STORED OBJECT. Mirror and Paste still treated the
 * return value as an id string and wrote it to `feature.id`, so the new
 * feature's id was an object that contained itself. Nothing looked wrong on
 * the canvas, but the sheet could no longer be serialised: saving, switching
 * sheets and the crash-recovery copy all threw "Converting circular structure
 * to JSON".
 *
 * Both commands are run through the booted editor, then the sheet is
 * serialised - which is exactly what failed.
 */
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { bootApp } = require("./helpers/boot-app.cjs");

const { error: bootError } = bootApp();
/* By file name, so a module can move between folders without breaking this. */
const { locate } = require("./helpers/source-path.cjs");
const src = (file) => require(locate(path.basename(file)));

const model = src("core/model/drawing-state.js").default;
const { drawingState } = src("editor/editor-state.js");
const { copySelectionToClipboard, pasteFromClipboard } = src("editor/clipboard-commands.js");
const { activateGlobalTool, handleModifyClick } = src("editor/modify-tools.js");

function freshBeam() {
  drawingState.objects.length = 0;
  const beam = model.geometryFactories.beam({ x: 0, y: 0 }, { x: 100, y: 0 }, {});
  const stored = model.addObject(drawingState, beam);
  model.selectObjects(drawingState, [stored.id]);
  return stored;
}

function assertIdsAreStringsAndSerialisable() {
  for (const object of drawingState.objects) {
    assert.strictEqual(typeof object.id, "string", `${object.type} has a non-string id`);
  }
  assert.doesNotThrow(() => JSON.stringify(drawingState.objects));
}

test("the application boots", () => {
  assert.strictEqual(bootError, null, bootError && bootError.message);
});

test("Paste creates a feature with a string id", () => {
  freshBeam();
  copySelectionToClipboard();
  pasteFromClipboard();
  assert.strictEqual(drawingState.objects.length, 2);
  assertIdsAreStringsAndSerialisable();
  for (const id of drawingState.selection.selectedObjectIds) {
    assert.strictEqual(typeof id, "string");
  }
});

test("Mirror creates a feature with a string id", () => {
  freshBeam();
  activateGlobalTool("mirror");
  handleModifyClick({}, { x: -50, y: 40 });
  handleModifyClick({}, { x: 150, y: 40 });
  assert.strictEqual(drawingState.objects.length, 2, "the mirror was not created");
  assertIdsAreStringsAndSerialisable();
  for (const id of drawingState.selection.selectedObjectIds) {
    assert.strictEqual(typeof id, "string");
  }
});

/* The booted editor keeps timers alive; leave once the tests have reported. */
test.after(() => {
  setTimeout(() => process.exit(process.exitCode || 0), 100);
});
