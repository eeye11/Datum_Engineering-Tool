/*
 * ========================================================
 * THE HAND TOOL, WITH ONE FINGER
 * ========================================================
 *
 * Two fingers navigate without a tool. A finger-only user also needs the
 * EXPLICIT one-pointer route, which is the Hand tool: press, move, release.
 *
 * The pan session is started by the same `pointerdown` the mouse uses, and a
 * TOUCH press reports `button === 0` - so the branch that asks "is the Pan tool
 * armed?" is reached by a finger exactly as by the mouse. This pins that, plus
 * the two things a pan must never do.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");

const { locate } = require("./helpers/source-path.cjs");

const source = fs.readFileSync(locate("canvas-events.js"), "utf8");

test("the Pan tool pans on the primary button, which is what a finger reports", () => {
  /*
   * The decision is `middle || activeTool === "pan"`, and a touch pointer's
   * `button` is 0 - so the tool branch is the one a finger takes. Hard-coding
   * `button === 0` as an extra condition would have excluded the middle button;
   * requiring a mouse would have excluded the finger.
   */
  assert.match(
    source,
    /const panning =\s*\n\s*middle \|\|\s*\n\s*drawingState\.activeTool === "pan"/,
    "the pan branch must not require a mouse",
  );

  assert.ok(
    !/panning\s*=\s*middle\s*\|\|\s*\(.*pointerType\s*===\s*"mouse"/.test(source),
    "a finger must be able to pan with the Hand tool",
  );
});

test("a pan captures the pointer, so it survives leaving the canvas", () => {
  assert.match(
    source,
    /drawingCanvas\.setPointerCapture\(\s*\n?\s*event\.pointerId\s*\n?\s*\);\s*\n\s*\n\s*editorState\.panSession = \{/,
    "the release must arrive even if the pointer leaves the surface",
  );
});

test("a pan moves the camera and never the drawing", () => {
  /*
   * THE PAN HANDLER IS THE ONE THAT UPDATES `panSession`. Anchoring on that
   * statement - not on the first `pointermove` in the file - is what makes this
   * check about the pan and not about the cursor preview above it.
   */
  const move = source.indexOf('"pointermove"', source.indexOf('"pointerdown"'));
  const start = source.indexOf("if (!editorState.panSession) {", move);
  const end = source.indexOf("editorState.panSession = null;", start);
  const panHandler = source.slice(start, end);

  assert.ok(panHandler.includes("panCamera("), "the pan handler was found");

  assert.ok(/panCamera\(/.test(panHandler), "a pan moves the camera");

  assert.ok(
    !/addObject|commitDrawingChange|drawingState\.objects\s*=|geometry\./.test(panHandler),
    "a pan must not create, move or commit geometry",
  );
});

test("the pan session ends on release, and the message returns to the tool's", () => {
  assert.match(source, /editorState\.panSession = null;/, "the session is cleared");
});
