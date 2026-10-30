const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { bootApp, whenReady } = require("./helpers/boot-app.cjs");
const { window, error } = bootApp();
assert.ifError(error);
after(() => window.close());

test("construction tolerates a completion that creates no object", async () => {
    await whenReady();
    const { drawingState } = await import("../src/features/workspace/editor-state.js");
    const { beginOrCompleteGeometry } = await import("../src/features/workspace/geometry/geometry-creation.js");
    drawingState.activeTool = "select";
    const count = drawingState.objects.length;
    assert.doesNotThrow(() => beginOrCompleteGeometry({ effectiveConstructionPoint: { x: 20, y: 30 } }));
    assert.equal(drawingState.objects.length, count);
    assert.equal(drawingState.activeTool, "select");
});
