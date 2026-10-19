const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("paste creates serializable identities and selects movable copies on repeated paste", async () => {
    const { default: stateModel } = await import("../src/shared/model/drawing-state.js");
    const { default: clipboardModel } = await import("../src/shared/selection/clipboard.js");
    const drawingState = stateModel.createDrawingState();
    const parent = stateModel.addObject(drawingState,
        stateModel.geometryFactories.rectangle({ x: 0, y: 100 }, 80, 100));
    const child = stateModel.geometryFactories.rectangle({ x: 10, y: 80 }, 60, 50);
    child.parentId = parent.id;
    stateModel.addObject(drawingState, child);
    stateModel.selectObjects(drawingState, [parent.id, child.id]);
    const editorState = { manipulationDrag: { awaitingPlacement: true } };
    let cancellations = 0;
    const sandbox = {
        enggDrawingState: stateModel, enggDrawingClipboard: clipboardModel,
        drawingState, editorState,
        renderCurrentDrawing() {}, renderProperties() {}, setToolMessage() {},
        cancelInteraction() { editorState.manipulationDrag = null; cancellations++; },
        deleteSelectedObjects() {}
    };
    const source = fs.readFileSync(require("./helpers/source-path.cjs").modulePath("clipboard-commands.js"), "utf8")
        .replace(/^import .*;\r?$/gm, "").replace(/export function /g, "function ");
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    sandbox.copySelectionToClipboard();
    sandbox.pasteFromClipboard();
    sandbox.pasteFromClipboard();
    assert.equal(cancellations, 2);
    assert.equal(editorState.manipulationDrag, null);
    assert.equal(drawingState.objects.length, 6);
    assert.equal(new Set(drawingState.objects.map(object => object.id)).size, 6);
    assert.ok(drawingState.objects.every(object => typeof object.id === "string"));
    assert.doesNotThrow(() => JSON.stringify(drawingState.objects));
    const [pastedParent, pastedChild] = drawingState.objects.slice(-2);
    assert.equal(pastedChild.parentId, pastedParent.id);
    assert.deepEqual([...drawingState.selection.selectedObjectIds], [pastedParent.id, pastedChild.id]);
    assert.ok(stateModel.undo(drawingState));
    assert.equal(drawingState.objects.length, 4);
});

test("pasting into a document with an available name still gets a fresh ID", async () => {
    const { default: stateModel } = await import("../src/shared/model/drawing-state.js");
    const state = stateModel.createDrawingState();
    const feature = stateModel.geometryFactories.rectangle({ x: 0, y: 0 }, 10, 10);
    delete feature.id;
    const stored = stateModel.addObject(state, feature);
    assert.equal(typeof stored.id, "string");
    assert.equal(state.objects[0].id, stored.id);
});
