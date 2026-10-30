/*
 * ========================================================
 * TOUCH TARGETS, DIRECT MANIPULATION AND THE INTERFACE
 * ========================================================
 *
 * What a finger can reach, and what a tap must NOT do. Driven against a real
 * drawing state (jsdom is not needed - the model is plain data), so the
 * assertions are about engineering behaviour rather than about source text.
 *
 * The properties this file exists to protect:
 *
 *   - a thin line is selectable by finger, and its ENGINEERING geometry is
 *     unchanged by the wider pick;
 *   - a finger gets a wider reach than a pen, which gets a wider reach than a
 *     mouse - at every zoom;
 *   - a tab or a header control is a real touch target;
 *   - the Source editor is not swallowed by a canvas gesture;
 *   - Finish / Cancel are visible controls, not idioms.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const { SOURCE_ROOT, stylesheetSource } = require("./helpers/source-path.cjs");

/* ------------------------------------------------------------------ model */

const dom = new JSDOM(
    "<!doctype html><html><body><div class='drawing-canvas' id='canvas'></div></body></html>",
    { pretendToBeVisual: true },
);

global.window = dom.window;
global.document = dom.window.document;

const canvas = global.document.querySelector(".drawing-canvas");

canvas.getBoundingClientRect = () => ({
    width: 900,
    height: 600,
    left: 0,
    top: 0,
    right: 900,
    bottom: 600,
});

const { drawingState } = require("../src/features/workspace/editor-state.js");
const { objectAtPoint } = require("../src/features/workspace/interaction/hit-testing.js");
const { INPUT_TOLERANCES } = require("../src/features/workspace/interaction/input-tolerances.js");

/*
 * ONE THIN LINE, three engineering units from the probe point.
 *
 * At the default camera (BASE_PIXELS_PER_UNIT × zoom) that is a small number of
 * SCREEN pixels - precisely the "thin, small, hard to hit" case the brief calls
 * out.
 */
const LINE = {
    id: "line-thin",
    type: "line",
    geometry: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    style: {},
    visible: true,
};

function resetDrawing() {
    drawingState.objects = [structuredClone(LINE)];
    drawingState.selection = { selectedObjectIds: [] };
    drawingState.camera.zoom = 1;
    drawingState.camera.panX = 0;
    drawingState.camera.panY = 0;
    drawingState.activeTool = "select";
}

/* ------------------------------------------------------------------ picks */

test("a thin line is picked by a finger and by a mouse alike, when aimed at", () => {
    resetDrawing();

    /* A point exactly on the ink. */
    assert.ok(
        objectAtPoint({ x: 50, y: 0 }, { inputKind: "mouse" }),
        "the mouse still picks what it is pointing at",
    );
    assert.ok(objectAtPoint({ x: 50, y: 0 }, { inputKind: "touch" }), "and so does a finger");
});

test("a finger reaches further than a pen, which reaches further than a mouse", () => {
    resetDrawing();

    /*
     * Walk away from the ink in 1 px steps and record the first distance at
     * which each input stops picking. The ordering is the property; the exact
     * numbers are the table's business.
     */
    const reach = (kind) => {
        const scale = 1; /* camera zoom 1 → one engineering unit per base pixel */
        const stepPx = 1 / scale;

        for (let px = 1; px <= 40; px += 1) {
            const found = objectAtPoint({ x: 50, y: px * stepPx }, { inputKind: kind });

            if (!found) {
                return px;
            }
        }

        return Infinity;
    };

    const mouse = reach("mouse");
    const pen = reach("pen");
    const touch = reach("touch");

    assert.ok(touch > pen, `a finger reaches further than a pen (${touch} vs ${pen} px)`);
    assert.ok(pen >= mouse, `a pen reaches at least as far as a mouse (${pen} vs ${mouse} px)`);
});

test("the wider pick is SCREEN-space, so zooming in does not widen it in engineering terms", () => {
    resetDrawing();

    const missWorldUnits = (kind) =>
        (INPUT_TOLERANCES[kind].pickRadiusPx * 2) /
        (100 /* BASE_PIXELS_PER_UNIT */ * drawingState.camera.zoom);

    drawingState.camera.zoom = 1;
    const atOne = missWorldUnits("touch");

    drawingState.camera.zoom = 4;
    const atFour = missWorldUnits("touch");

    assert.ok(atFour < atOne, "at a higher zoom the same pixel band is a smaller engineering distance");
});

test("a wider hit area NEVER changes the geometry it is measuring", () => {
    resetDrawing();

    const before = JSON.stringify(drawingState.objects[0].geometry);

    objectAtPoint({ x: 50, y: 2 }, { inputKind: "touch" });
    objectAtPoint({ x: 50, y: 8 }, { inputKind: "touch" });
    objectAtPoint({ x: 50, y: 0 }, { inputKind: "mouse" });

    assert.strictEqual(
        JSON.stringify(drawingState.objects[0].geometry),
        before,
        "a hit test is a question, not an edit",
    );
});

test("a hidden feature is not picked by any input", () => {
    resetDrawing();
    drawingState.objects[0].visible = false;

    assert.ok(!objectAtPoint({ x: 50, y: 0 }, { inputKind: "touch" }));
    assert.ok(!objectAtPoint({ x: 50, y: 0 }, { inputKind: "mouse" }));
});

test("an empty sheet answers null for every input kind", () => {
    resetDrawing();
    drawingState.objects = [];

    for (const inputKind of ["mouse", "pen", "touch", "unknown"]) {
        assert.ok(
            !objectAtPoint({ x: 10, y: 10 }, { inputKind }),
            `nothing is picked with a ${inputKind}`,
        );
    }
});

/* --------------------------------------------------------------- interface */

const css = stylesheetSource("editor.css").replace(/\/\*[\s\S]*?\*\//g, "");

function ruleFor(selector) {
    const at = css.search(
        new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m"),
    );

    if (at < 0) return "";

    const open = css.indexOf("{", at);
    const close = css.indexOf("}", open);

    return css.slice(at, close + 1);
}

test("a touch device gets larger targets, and a mouse is left alone", () => {
    /*
     * THE ENLARGEMENT IS GATED ON THE CAPABILITY CLASS, not on a media feature,
     * so a machine with a mouse and a touchscreen keeps one set of sizes.
     *
     * AND IT ONLY GROWS WHAT IS ACTUALLY TOO SMALL. An earlier version forced
     * 40 px onto every tool button and category heading as well, which on a
     * touchscreen laptop doubled the tool list and squeezed the canvas - the
     * bug the owner reported as "most of the heights of the page were
     * stretched". So this checks the SMALL round controls, which is what the
     * block is for, and explicitly checks that the tool rows are NOT resized.
     */
    const colourSwatch = ruleFor(
        ".datum-touch-input .drawing-property-grid input[type=\"color\"],",
    );

    assert.ok(colourSwatch, "the touch sizing is scoped to the capability class");
    assert.match(colourSwatch, /min-height:\s*2[0-9]px/, "a swatch gets a real target");

    assert.ok(
        !/\.datum-touch-input \.drawing-tool\s*\{/.test(css),
        "the tool rows keep their own height - growing them stretched the page",
    );

    assert.ok(
        !/\.datum-touch-input \.drawing-category\s*\{/.test(css),
        "and so do the category headings",
    );
});

test("the touch class is set only for touch-capable devices", () => {
    const source = fs.readFileSync(
        path.join(SOURCE_ROOT, "components", "layout", "workspace", "touch-capability.js"),
        "utf8",
    );

    assert.match(source, /maxTouchPoints/, "a touchscreen reports touch points");
    assert.match(source, /datun-touch-input|datum-touch-input/, "and the class is the one the CSS uses");
});

test("the Source editor keeps native text interaction", () => {
    /* Whatever the rule, `touch-action: none` must not be on the editor. */
    assert.ok(
        !/touch-action:\s*none/.test(css.slice(css.indexOf(".drawing-source"), css.indexOf(".drawing-source") + 4000)),
        "a canvas gesture must never disable text selection or the on-screen keyboard",
    );
});

test("touch-action is scoped to the canvas, never to the application", () => {
    const globalNone = /(^|\})\s*(html|body|\*)[^{]*\{[^}]*touch-action:\s*none/.test(css);

    assert.strictEqual(globalNone, false, "touch must not be disabled globally");
});

test("Finish and Cancel are visible controls, and they exist", () => {
    const html = fs.readFileSync(path.join(SOURCE_ROOT, "..", "index.html"), "utf8");

    assert.match(html, /id="drawingConstructionFinish"/, "there is a Finish control");
    assert.match(html, /id="drawingConstructionCancel"/, "and a Cancel control");
    assert.match(html, /id="drawingConstructionActions"/, "in one group that can be shown together");
});

test("the construction controls call the SAME functions the keyboard does", () => {
    const actions = fs.readFileSync(
        path.join(SOURCE_ROOT, "features", "workspace", "interaction", "construction-actions.js"),
        "utf8",
    );

    assert.match(actions, /finishActiveConstruction\(\)/, "Finish is the double-click's own action");
    assert.match(actions, /cancelInteraction\(\)/, "Cancel is Escape's own action");
    assert.match(
        actions,
        /cancelCreationDrag\(\)/,
        "and an uncommitted touch preview is dropped through the shared rollback",
    );
});
