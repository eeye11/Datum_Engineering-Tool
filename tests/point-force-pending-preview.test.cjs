const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

test("a point force remains visible while its magnitude is pending", async () => {
    const dom = new JSDOM("<!doctype html><body></body>");
    global.window = dom.window;
    global.document = dom.window.document;
    const { default: model } = await import("../src/shared/model/drawing-state.js");
    const { renderPreview } = await import("../src/shared/rendering/preview-render.js");
    const state = model.createDrawingState();
    const force = model.geometryFactories.force(
        { x: 0, y: 0 }, { x: 50, y: 30 }
    );
    state.interaction.phase = "point-force-value";
    state.interaction.preview = force;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const bounds = { width: 800, height: 600 };

    renderPreview(svg, state, bounds);
    assert.ok(svg.querySelector("line, path, polygon"), "the pending arrow is rendered");
    assert.equal(state.objects.length, 0, "pending placement is not committed");
    const picture = svg.innerHTML;
    svg.replaceChildren();
    renderPreview(svg, state, bounds);
    assert.equal(svg.innerHTML, picture, "rerendering preserves the placed arrow");

    model.clearInteraction(state);
    svg.replaceChildren();
    renderPreview(svg, state, bounds);
    assert.equal(svg.childElementCount, 0, "cancelling removes the pending arrow");
    dom.window.close();
});
