const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { bootApp, whenReady } = require("./helpers/boot-app.cjs");
const app = bootApp();
let state, editor, canvas, model, drag;

before(async () => {
    assert.ifError(app.error);
    await whenReady();
    ({ drawingState: state, editorState: editor } = await import("../src/features/workspace/editor-state.js"));
    ({ drawingCanvas: canvas } = await import("../src/features/workspace/dom.js"));
    ({ default: model } = await import("../src/shared/model/drawing-state.js"));
    drag = await import("../src/features/workspace/interaction/drag.js");
    Object.defineProperty(canvas, "clientWidth", { configurable: true, value: 800 });
    Object.defineProperty(canvas, "clientHeight", { configurable: true, value: 600 });
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
    canvas.setPointerCapture = () => {};
    canvas.releasePointerCapture = () => {};
    canvas.hasPointerCapture = () => false;
});
after(() => app.window.close());

function setup(rotation = 0, selected = false) {
    const object = { id: "axes-drag", type: "coordinate-system-2d", style: {},
        geometry: { origin: { x: 0, y: 0 }, xPositiveLength: 100, yPositiveLength: 60, rotation } };
    state.objects = [object];
    model.clearInteraction(state);
    model.setActiveTool(state, "select");
    model.clearSelection(state);
    if (selected) model.selectObject(state, object.id);
    editor.manipulationDrag = null;
    editor.modifySession = null;
    return object;
}

function eventAt(x, y) {
    const point = model.engineeringToScreen({ x, y }, { width: 800, height: 600 }, state);
    return { clientX: point.x, clientY: point.y, button: 0, pointerId: 1, shiftKey: false };
}

test("an unselected coordinate system moves on the first drag and shows the move cursor", () => {
    const object = setup();
    assert.equal(drag.beginManipulationDrag(eventAt(50, 0)), true);
    drag.updateManipulationDrag(eventAt(80, 20));
    assert.ok(Math.hypot(object.geometry.origin.x - 30, object.geometry.origin.y - 20) < 1e-8);
    assert.ok(state.selection.selectedObjectIds.includes(object.id));
    assert.ok(canvas.classList.contains("drawing-object-moving"));
    drag.finishManipulationDrag(eventAt(80, 20));
    assert.equal(editor.manipulationDrag, null);
    assert.equal(canvas.classList.contains("drawing-object-moving"), false);
});

test("a rotated coordinate system resizes along its own axis", () => {
    const object = setup(Math.PI / 2, true);
    assert.equal(drag.beginManipulationDrag(eventAt(0, 100)), true);
    assert.equal(editor.manipulationDrag.kind, "xPositive");
    drag.updateManipulationDrag(eventAt(0, 140));
    assert.ok(Math.abs(object.geometry.xPositiveLength - 140) < 1e-8);
    assert.equal(object.geometry.yPositiveLength, 60);
    assert.deepEqual(object.geometry.origin, { x: 0, y: 0 });
    drag.finishManipulationDrag(eventAt(0, 140));
});
