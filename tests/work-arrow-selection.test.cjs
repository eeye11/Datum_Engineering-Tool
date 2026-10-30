const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

test("work arrow outline encloses its label and follows translation", async () => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    global.document = dom.window.document;
    try {
        const { renderSelectionOutline, renderSelectionHandles } = await import("../src/shared/rendering/overlay-render.js");
        const { default: drawing } = await import("../src/shared/model/drawing-state.js");
        const { default: annotate } = await import("../src/features/workspace/model/annotations/annotate-model.js");
        const object = {
            id: "work", type: "annotate", annotateKind: "arrow", text: "W in",
            metadata: { thermodynamicsKind: "work-arrow", mathSymbol: "W", mathSubscript: "in" },
            style: { fontSize: 12, align: "center" },
            geometry: { start: { x: 0, y: 0 }, end: { x: 20, y: 0 }, position: { x: 10, y: 4 } }
        };
        const state = drawing.createDrawingState();
        state.objects = [object];
        state.selection.selectedObjectIds = [object.id];
        const bounds = { width: 800, height: 600 };
        const outline = () => {
            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            renderSelectionOutline(svg, state, bounds);
            renderSelectionHandles(svg, state, bounds);
            assert.equal(svg.querySelectorAll('rect[stroke-dasharray]').length, 1);
            const rect = svg.querySelector("rect");
            assert.ok(rect);
            return Object.fromEntries(["x", "y", "width", "height"].map(key => [key, Number(rect.getAttribute(key))]));
        };
        const before = outline();
        const label = drawing.engineeringToScreen(object.geometry.position, bounds, state);
        assert.ok(before.y < label.y - 6);
        assert.ok(before.y + before.height > label.y + 8);
        const originBefore = drawing.engineeringToScreen(object.geometry.start, bounds, state);
        annotate.translateAnnotation(object, 7, -3);
        const after = outline();
        const originAfter = drawing.engineeringToScreen(object.geometry.start, bounds, state);
        assert.ok(Math.abs(after.x - before.x - (originAfter.x - originBefore.x)) < 1e-8);
        assert.ok(Math.abs(after.y - before.y - (originAfter.y - originBefore.y)) < 1e-8);
        assert.ok(Math.abs(after.width - before.width) < 1e-8);
        assert.ok(Math.abs(after.height - before.height) < 1e-8);
    } finally {
        dom.window.close();
    }
});
