/*
 * ========================================================
 * A DOUBLE TAP IS A DOUBLE CLICK - AND NOTHING ELSE
 * ========================================================
 *
 * A finger has no `dblclick`. The application's "open this" gesture - edit a
 * dimension, open a feature's controls - must remain reachable on a tablet, so
 * two taps become the SAME dispatch a mouse double-click makes.
 *
 * AND IT MUST NOT BECOME A ZOOM. Pinch already zooms, and taking double-tap for
 * it would make object editing unreachable by finger.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");

const { locate } = require("./helpers/source-path.cjs");

const source = fs.readFileSync(locate("canvas-events.js"), "utf8");

test("two taps replay the canvas's own dblclick", () => {
  assert.match(source, /function noteTap\(/, "taps are recognised");
  assert.match(
    source,
    /dispatchEvent\(event\)/,
    "and the double-click is replayed on the canvas",
  );
  assert.match(
    source,
    /new Mouse\("dblclick"/,
    "as the event the existing handlers listen for",
  );
  assert.match(source, /detail: 2/, "with the detail a double-click carries");
});

test("a mouse is left to the browser's own dblclick", () => {
  assert.match(
    source,
    /if \(pointerKind\(event\) === "mouse"\) \{\s*\n\s*\/\* The browser's own `dblclick` already reports this one\. \*\/\s*\n\s*return;/,
    "replaying a second dblclick for a mouse would dispatch it twice",
  );
});

test("the double tap does NOT zoom", () => {
  const tapSection = source.slice(
    source.indexOf("function noteTap("),
    source.indexOf("function replayDoubleClick("),
  );

  assert.ok(
    !/zoom|pinch|applyTwoFingerGesture/i.test(tapSection),
    "pinch is the zoom gesture; double tap must keep its editing meaning",
  );
});

test("the tap window and slack are one configuration, not a literal in a handler", () => {
  assert.match(source, /const DOUBLE_TAP_MS = \d+;/);
  assert.match(source, /const DOUBLE_TAP_SLOP_PX = \d+;/);
  assert.match(source, /now - previous\.at > DOUBLE_TAP_MS/);
  assert.match(
    source,
    /Math\.hypot\(event\.clientX - previous\.x, event\.clientY - previous\.y\) > DOUBLE_TAP_SLOP_PX/,
  );
});

test("taps of a DIFFERENT device do not pair up", () => {
  assert.match(
    source,
    /if \(!previous \|\| previous\.kind !== pointerKind\(event\)\) \{/,
    "a pen tap and a finger tap are not one double tap",
  );
});

test("the recogniser tolerates a page without MouseEvent", () => {
  assert.match(
    source,
    /if \(typeof Mouse !== "function"\) \{/,
    "a test page without MouseEvent must not throw",
  );
});
