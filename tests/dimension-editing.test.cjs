const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {modulePath} = require("./helpers/source-path.cjs");
test("double-click opens the dimension editor with mode and reference controls", () => {
    const events = fs.readFileSync(modulePath("canvas-events.js"), "utf8");
    const tool = fs.readFileSync(modulePath("dimension-tool.js"), "utf8");
    assert.match(events, /openDimensionValuePrompt\(pointed\)/);
    assert.match(tool, /openDimensionEditor\(/);
    assert.match(tool, /referenceSummary\(object, drawingState\)/);
});
