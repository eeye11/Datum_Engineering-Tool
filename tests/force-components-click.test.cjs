const test = require("node:test");
const assert = require("node:assert/strict");
const { bootApp, whenReady } = require("./helpers/boot-app.cjs");

test("clicking a point load creates its component arrows and returns to Select", async () => {
    const app = bootApp();
    assert.equal(app.error, null);
    await whenReady();
    const { drawingState } = await import("../src/features/workspace/editor-state.js");
    const { default: model } = await import("../src/shared/model/drawing-state.js");
    const { beginAnalysisInput, handleAnalysisInputClick } = await import("../src/features/workspace/statics/analysis-tools.js");
    const force = model.geometryFactories.force({ x: 0, y: 0 }, { x: 30, y: 40 });
    drawingState.objects = [force];
    beginAnalysisInput("force-components");
    handleAnalysisInputClick({ rawPointerPoint: { x: 0, y: 0 } }, {});
    const components = drawingState.objects.find(object => object.type === "force-components");
    assert.ok(components, "the click creates the components without Enter");
    assert.equal(components.parentId, force.id);
    assert.equal(components.geometry.horizontal.start.y, components.geometry.horizontal.end.y);
    assert.equal(components.geometry.vertical.start.x, components.geometry.vertical.end.x);
    assert.notEqual(components.geometry.horizontal.start.x, components.geometry.horizontal.end.x);
    assert.notEqual(components.geometry.vertical.start.y, components.geometry.vertical.end.y);
    assert.deepEqual(drawingState.selection.selectedObjectIds, [components.id]);
    assert.equal(drawingState.activeTool, "select");
    app.dom.window.close();
});
