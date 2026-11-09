const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {modulePath} = require("./helpers/source-path.cjs");
test("double-click opens the dimension's in-page text field, with no popup editor", () => {
    const events = fs.readFileSync(modulePath("canvas-events.js"), "utf8");
    const tool = fs.readFileSync(modulePath("dimension-tool.js"), "utf8");
    assert.match(events, /openDimensionValuePrompt\(pointed\)/);
    assert.match(tool, /openDimensionTextEditor\(/);

    /*
     * THE VALUE IS NO LONGER ASKED FOR IN A SEPARATE WINDOW. The dimension's
     * text is edited where it is drawn, so the tool must not reach for the
     * modal editor and the canvas must not open a dialog for it.
     */
    assert.doesNotMatch(tool, /openDimensionEditor\(/);
    assert.match(tool, /graphics\.textFrame/);
});
test("the in-page field is a canvas child, committed by Enter and abandoned by Escape", () => {
    const editor = fs.readFileSync(modulePath("dimension-text-editor.js"), "utf8");
    assert.match(editor, /enggInlineEntry\.canvasElement\(\)/);
    assert.match(editor, /host\.append\(input\)/);
    assert.match(editor, /event\.key === "Enter"/);
    assert.match(editor, /event\.key === "Escape"/);
    assert.doesNotMatch(editor, /aria-modal/);
});
