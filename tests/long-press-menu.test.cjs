/*
 * ========================================================
 * THE FEATURE MENU, FROM A HOLD
 * ========================================================
 *
 * A finger has no right button, so the right-click menu is reached by holding
 * still on the drawing. What is pinned here:
 *
 *   - it is the SAME menu, through the same function - a long press cannot grow
 *     its own set of actions that later disagree with the mouse's;
 *   - a hold is cancelled by movement, release, a second finger or a cancel;
 *   - a mouse never long-presses (it has a right button);
 *   - the release that follows the hold is not also read as a click.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");

const { locate } = require("./helpers/source-path.cjs");
const {
  createGestureTracker,
  setGestureClock,
} = require("../src/features/workspace/interaction/pointer-gesture.js");

const canvasEvents = fs.readFileSync(locate("canvas-events.js"), "utf8");
const contextMenu = fs.readFileSync(locate("context-menu.js"), "utf8");

test("the long press opens the EXISTING feature menu", () => {
  assert.match(
    contextMenu,
    /export function openCanvasContextMenuAt\(clientX, clientY\)/,
    "the menu is reachable by name from the canvas",
  );

  assert.match(
    canvasEvents,
    /import \{ openCanvasContextMenuAt \} from "\.\/context-menu\.js"/,
    "the canvas uses the one menu module",
  );

  /* And the function itself calls the menu the right-click builds. */
  const fn = contextMenu.slice(
    contextMenu.indexOf("export function openCanvasContextMenuAt"),
  );

  assert.ok(
    fn.includes("openFeatureContextMenu("),
    "a long press must build the same menu, not a second one",
  );
});

test("the long press selects what the finger is on, like a right-click", () => {
  const fn = contextMenu.slice(
    contextMenu.indexOf("export function openCanvasContextMenuAt"),
    contextMenu.indexOf("export function openCanvasContextMenuAt") + 900,
  );

  assert.ok(
    /selectObject\(/.test(fn),
    "the pressed feature becomes the selection",
  );
  assert.ok(/objectAtPoint\(/.test(fn), "by hit-testing the pressed point");
});

test("long press is a TOUCH and PEN gesture, never a mouse one", () => {
  assert.match(
    canvasEvents,
    /if \(pointerKind\(event\) === "mouse" \|\| canvasGesture\.navigating\) \{\s*\n\s*return;/,
    "a mouse has a right button; holding its left button is a drag",
  );
});

test("the hold uses the tracker's rule, not a tool's own timer value", () => {
  assert.match(
    canvasEvents,
    /canvasGesture\.config\.longPressMs/,
    "one duration, from the shared configuration",
  );
  assert.match(canvasEvents, /canvasGesture\.longPressDue\(pressed\)/);
  assert.match(canvasEvents, /canvasGesture\.markLongPressed\(pressed\)/);
});

test("movement, release, a second finger and a cancel all end the hold", () => {
  const cancels = (canvasEvents.match(/cancelLongPress\(\);/g) || []).length;

  assert.ok(
    cancels >= 4,
    `the hold is cancelled from every end (found ${cancels})`,
  );
  assert.match(canvasEvents, /longPressTimer = setTimeout\(/);
});

test("the release after a hold is not read as a click", () => {
  assert.match(
    canvasEvents,
    /markLongPressed\(pressed\)[\s\S]{0,400}creationDragConsumedClick = true/,
    "the menu owns the press; the click behind it would close it",
  );
});

test("the hold is cancelled by travel, in the tracker", () => {
  let time = 0;
  setGestureClock(() => time);

  const gesture = createGestureTracker();
  const down = {
    pointerId: 1,
    pointerType: "touch",
    clientX: 100,
    clientY: 100,
  };

  gesture.press(down);
  time += gesture.config.longPressMs;

  assert.strictEqual(gesture.longPressDue(down), true);

  /* The finger slides while held. */
  gesture.move({
    ...down,
    clientX: 100 + gesture.config.longPressSlopPx.touch + 5,
    clientY: 100,
  });

  assert.strictEqual(gesture.longPressDue(down), false);
});
