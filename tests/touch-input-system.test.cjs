/*
 * ========================================================
 * ONE INPUT SYSTEM: FINGER, STYLUS AND MOUSE
 * ========================================================
 *
 * The shared rules behind touch and stylus support, driven directly - no page,
 * no device. What is pinned here:
 *
 *   - the tolerance table: a finger is forgiving, a pen precise, a mouse
 *     exactly what it always was;
 *   - a palm contact never becomes the primary pointer, a paired finger, a
 *     long press, or a tap;
 *   - a finger beside a pen never steals the pen's interaction;
 *   - every widened area is SCREEN-SPACE (the same at every zoom) and never
 *     touches the model.
 *
 * The gesture tracker's own arithmetic is covered by pointer-gesture.test.cjs;
 * this file covers the input-kind layer added on top of it.
 */

const test = require("node:test");
const assert = require("node:assert");

const {
  INPUT_TOLERANCES,
  inputKindOf,
  tolerancesFor,
  worldRadius,
} = require("../src/features/workspace/interaction/input-tolerances.js");

const {
  createGestureTracker,
  setGestureClock,
  GESTURE_DEFAULTS,
} = require("../src/features/workspace/interaction/pointer-gesture.js");

/* ------------------------------------------------------------------ kinds */

test("a pointer kind is normalised, and anything unknown is not guessed at", () => {
  assert.strictEqual(inputKindOf("touch"), "touch");
  assert.strictEqual(inputKindOf("pen"), "pen");
  assert.strictEqual(inputKindOf("mouse"), "mouse");
  assert.strictEqual(inputKindOf({ pointerType: "pen" }), "pen");
  assert.strictEqual(inputKindOf({ pointerType: "joystick" }), "unknown");
  assert.strictEqual(inputKindOf({}), "unknown");
  assert.strictEqual(inputKindOf(null), "unknown");
  assert.strictEqual(inputKindOf(undefined), "unknown");
});

/* ------------------------------------------------------------- tolerances */

test("a finger is the most forgiving, a pen the most precise of the touch kinds", () => {
  const { touch, pen, mouse } = INPUT_TOLERANCES;

  assert.ok(
    touch.pickRadiusPx > pen.pickRadiusPx,
    "a finger needs the widest band",
  );
  assert.ok(touch.handlePickRadiusPx > pen.handlePickRadiusPx);
  assert.ok(touch.snapTolerancePx > pen.snapTolerancePx);
  assert.ok(touch.inferenceTolerancePx >= pen.inferenceTolerancePx);
});

test("the mouse keeps exactly the numbers the application was built with", () => {
  const { mouse } = INPUT_TOLERANCES;

  /*
   * 4 px for an object's ink, 9 px for a handle, 5 px for a snap and 24 px
   * for alignment - the values hit-testing.js, handles.js and object-snap.js
   * used before this layer existed. A change here is a regression in mouse
   * behaviour, which the brief forbids.
   */
  assert.strictEqual(mouse.pickRadiusPx, 4);
  assert.strictEqual(mouse.handlePickRadiusPx, 9);
  assert.strictEqual(mouse.snapTolerancePx, 5);
  assert.strictEqual(mouse.inferenceTolerancePx, 24);
});

test("an unidentified device is treated as forgiving, never as a mouse", () => {
  const unknown = tolerancesFor("unknown");

  assert.strictEqual(unknown.pickRadiusPx, INPUT_TOLERANCES.touch.pickRadiusPx);
});

test("a caller may replace one number without restating the table", () => {
  const custom = tolerancesFor("touch", {
    tolerances: { touch: { pickRadiusPx: 99 } },
  });

  assert.strictEqual(custom.pickRadiusPx, 99);
  assert.strictEqual(custom.kind, "touch");

  /* The rest of the touch row is still the shipped default. */
  assert.strictEqual(
    custom.handlePickRadiusPx,
    INPUT_TOLERANCES.touch.handlePickRadiusPx,
  );
});

test("a screen-pixel radius becomes a SMALLER world radius as the view zooms in", () => {
  /* At 1 unit = 2 px, a 20 px band is 10 units. */
  assert.strictEqual(worldRadius(20, 2), 10);

  /* Zoomed in four times there are 8 px per unit, so the SAME band is 2.5. */
  assert.strictEqual(worldRadius(20, 8), 2.5);
});

test("a degenerate scale cannot produce an infinite pick radius", () => {
  const radius = worldRadius(20, 0);

  assert.ok(Number.isFinite(radius), "a zero scale must not divide by zero");
  assert.ok(radius > 0);
});

test("a negative or missing radius is floored at zero rather than reversed", () => {
  assert.strictEqual(worldRadius(-5, 2), 0);
  assert.strictEqual(worldRadius(undefined, 2), 0);
});

/* --------------------------------------------------- incidental contacts */

let nextId = 1;
const pointer = (type, x, y, id = nextId++) => ({
  pointerId: id,
  pointerType: type,
  clientX: x,
  clientY: y,
});

let time = 0;
setGestureClock(() => time);

const fresh = () => {
  time = 0;

  return createGestureTracker();
};

test("an incidental contact is recorded but never becomes the primary pointer", () => {
  const gesture = fresh();
  const palm = pointer("touch", 40, 40);

  const decision = gesture.press(palm, { incidental: true });

  assert.strictEqual(decision.kind, "ignored");
  assert.strictEqual(decision.incidental, true);
  assert.strictEqual(
    gesture.primary,
    null,
    "a palm must not own the interaction",
  );
  assert.strictEqual(gesture.count, 0, "and is not an active pointer");
});

test("a palm does not turn a pen stroke into a pinch", () => {
  const gesture = fresh();
  const pen = pointer("pen", 100, 100);

  assert.strictEqual(gesture.press(pen).kind, "press");

  /* The hand settles while the nib is still down. */
  const palm = gesture.press(pointer("touch", 140, 100), { incidental: true });

  assert.strictEqual(palm.kind, "ignored");
  assert.notStrictEqual(
    palm.kind,
    "navigate-begin",
    "a resting hand is not a second finger",
  );
  assert.strictEqual(gesture.navigating, false);
  assert.strictEqual(
    gesture.primary.id,
    pen.pointerId,
    "the pen keeps the stroke",
  );
});

test("a palm never moves, drags or long-presses", () => {
  const gesture = fresh();
  const palm = pointer("touch", 10, 10);

  gesture.press(palm, { incidental: true });

  assert.strictEqual(
    gesture.move({ ...palm, clientX: 300, clientY: 300 }).kind,
    "ignored",
  );

  time += GESTURE_DEFAULTS.longPressMs;

  assert.strictEqual(
    gesture.longPressDue(palm),
    false,
    "a resting hand opens no menu",
  );
});

test("lifting an incidental contact reports nothing - it never became a tap", () => {
  const gesture = fresh();
  const palm = pointer("touch", 10, 10);

  gesture.press(palm, { incidental: true });

  const released = gesture.release(palm);

  assert.strictEqual(released.kind, "ignored");
  assert.notStrictEqual(
    released.kind,
    "tap",
    "a palm release must not pair into a double tap",
  );
  assert.strictEqual(gesture.down, 0, "and it is forgotten cleanly");
});

test("a finger joining a live pen is held, not made navigation", () => {
  const gesture = fresh();
  const pen = pointer("pen", 100, 100);
  const finger = pointer("touch", 180, 100);

  gesture.press(pen);

  const joined = gesture.press(finger, { keepPrimary: true });

  assert.strictEqual(joined.kind, "held");
  assert.strictEqual(
    gesture.navigating,
    false,
    "the pen's edit is not cancelled",
  );
  assert.strictEqual(
    gesture.primary.id,
    pen.pointerId,
    "the pen stays the primary pointer",
  );
});

test("a normal second finger still becomes navigation", () => {
  const gesture = fresh();

  gesture.press(pointer("touch", 100, 100));

  assert.strictEqual(
    gesture.press(pointer("touch", 200, 100)).kind,
    "navigate-begin",
  );
  assert.strictEqual(gesture.navigating, true);
});

test("incidental contacts are released with the rest, so nothing is left behind", () => {
  const gesture = fresh();

  gesture.press(pointer("pen", 0, 0));
  gesture.press(pointer("touch", 10, 0), { incidental: true });

  const reset = gesture.reset();

  assert.strictEqual(
    reset.pointers.length,
    2,
    "both contacts are handed back for release",
  );
  assert.strictEqual(gesture.down, 0);
  assert.strictEqual(gesture.primary, null);
});

/* ------------------------------------------------ the surface's own rules */

const fs = require("node:fs");
const { locate } = require("./helpers/source-path.cjs");

const canvasEvents = fs.readFileSync(locate("canvas-events.js"), "utf8");
const hitTesting = fs.readFileSync(locate("hit-testing.js"), "utf8");
const handles = fs.readFileSync(locate("handles.js"), "utf8");
const pointerSource = fs.readFileSync(locate("pointer.js"), "utf8");

test("the canvas asks the palm rule BEFORE it classifies a press", () => {
  assert.match(
    canvasEvents,
    /incidental:\s*isIncidentalContact\(event\)/,
    "an incidental contact is marked on the tracker, not drawn with",
  );
  assert.match(
    canvasEvents,
    /keepPrimary:[\s\S]{0,80}isPenDownNow\(\)/,
    "a finger beside a live pen must not steal the pen's interaction",
  );
});

test("touch and pen go through the shared gesture tracker, not a second path", () => {
  assert.match(
    canvasEvents,
    /canvasGesture\.press\(event, \{/,
    "one tracker decides a press",
  );
  assert.match(
    canvasEvents,
    /classifyTouchFrame\(event\)/,
    "and one classifier decides a frame",
  );
});

test("a mouse press is never held for classification", () => {
  /* The hold is for touch and pen only, and the guard says so. */
  assert.match(
    canvasEvents,
    /function shouldHoldTouchPress\(event\)[\s\S]{0,300}kind !== "touch" && kind !== "pen"/,
    "a mouse press must reach its handler immediately, as it always did",
  );
});

test("the pen's extra buttons are opt-in by the value that arrives", () => {
  assert.match(
    canvasEvents,
    /event\.button === 2/,
    "a barrel button opens the existing menu",
  );
  assert.match(canvasEvents, /event\.button === 5/, "an eraser tip is handled");
  assert.match(
    canvasEvents,
    /function deleteWhatTheTipTouched[\s\S]{0,900}selectObject\(drawingState, object\.id\)/,
    "an eraser SELECTS rather than silently deleting",
  );
});

test("hit tests take the input kind and default to the mouse", () => {
  assert.match(
    hitTesting,
    /export function objectAtPoint\(\s*point,\s*options = \{\}/,
  );
  assert.match(
    hitTesting,
    /options\.inputKind \|\| options\.pointerType \|\| "mouse"/,
  );
  assert.match(
    handles,
    /export function handleAtPoint\(\s*point,\s*options = \{\}/,
  );
});

test("the live pointer's kind is stamped once, on the frame's resolution", () => {
  assert.match(
    pointerSource,
    /resolution\.pointerKind = pointerKindOf\(event\)/,
  );
});

test("a target preview is derived, never selected", () => {
  const preview = pointerSource.slice(
    pointerSource.indexOf("function updateTargetPreview"),
    pointerSource.indexOf("export function updateDrawingCoordinates"),
  );

  assert.ok(preview.length > 0, "the preview function exists");
  assert.ok(
    !/selectObject\(|addObject|commitDrawingChange/.test(preview),
    "a preview must not change the selection or the document",
  );
  assert.match(
    preview,
    /targetPreviewId/,
    "it is published for the overlay to draw",
  );
});
