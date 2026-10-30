/*
 * ========================================================
 * GESTURE RECOGNITION: TAP, DRAG, PAN, PINCH
 * ========================================================
 *
 * The rules that decide what a press MEANS, driven directly - no page, no
 * drawing, no tool. Every case here is one that a user can hit with one hand:
 *
 *   - a finger that wobbles must still be a tap, not a drag;
 *   - two fingers moving together must be a pan, and never an edit;
 *   - a pinch must report the ratio AND the midpoint it turns about;
 *   - lifting one of two fingers must not turn the remaining one into an edit;
 *   - a cancel must be reported as a cancel, so the surface rolls back.
 */

const test = require("node:test");
const assert = require("node:assert");

const { createGestureTracker, pointerKind, setGestureClock, GESTURE_DEFAULTS } = require(
  "../src/features/workspace/interaction/pointer-gesture.js"
);

/* A pointer event, in the three fields this module reads. */
let nextId = 1;
const pointer = (type, x, y, id = nextId++) => ({
  pointerId: id,
  pointerType: type,
  clientX: x,
  clientY: y,
});

/* A controllable clock, so a long press is not a real half-second. */
let time = 0;
setGestureClock(() => time);

const fresh = () => {
  time = 0;

  return createGestureTracker();
};

test("the pointer type is named, and an unknown device is not guessed at", () => {
  assert.strictEqual(pointerKind({ pointerType: "touch" }), "touch");
  assert.strictEqual(pointerKind({ pointerType: "pen" }), "pen");
  assert.strictEqual(pointerKind({ pointerType: "mouse" }), "mouse");
  assert.strictEqual(pointerKind({ pointerType: "joystick" }), "unknown");
  assert.strictEqual(pointerKind({}), "unknown");
  assert.strictEqual(pointerKind(null), "unknown");
});

test("a press and release without travel is a tap", () => {
  const gesture = fresh();
  const down = pointer("touch", 100, 100);

  assert.strictEqual(gesture.press(down).kind, "press");

  gesture.move({ ...down, clientX: 102, clientY: 101 });

  const up = gesture.release(down);

  assert.strictEqual(up.kind, "tap", "a 2 px wobble is still a tap");
});

test("a finger may wobble within its allowance and still be a tap", () => {
  const gesture = fresh();
  const down = pointer("touch", 100, 100);

  gesture.press(down);

  /* Exactly the slop: still a press. */
  gesture.move({ ...down, clientX: 100 + GESTURE_DEFAULTS.dragSlopPx.touch, clientY: 100 });

  assert.strictEqual(gesture.release(down).kind, "tap");
});

test("travel beyond the allowance is a drag, and it starts once", () => {
  const gesture = fresh();
  const down = pointer("touch", 0, 0);

  gesture.press(down);
  assert.strictEqual(gesture.move({ ...down, clientX: 4, clientY: 0 }).kind, "move");

  const start = gesture.move({ ...down, clientX: 30, clientY: 0 });
  assert.strictEqual(start.kind, "drag-start", "the crossing movement starts the drag");

  const next = gesture.move({ ...down, clientX: 60, clientY: 0 });
  assert.strictEqual(next.kind, "drag");

  assert.strictEqual(gesture.release(down).kind, "drag-end");
});

test("a stylus needs less travel than a finger before it is a drag", () => {
  const slop = GESTURE_DEFAULTS.dragSlopPx;

  assert.ok(slop.pen < slop.touch, "a pen is steadier, so its tolerance is smaller");
  assert.ok(slop.mouse <= slop.touch, "a mouse is steadier still");

  const touch = fresh();
  const pen = fresh();

  const t = pointer("touch", 0, 0);
  const p = pointer("pen", 0, 0);

  touch.press(t);
  pen.press(p);

  /* 6 px: a pen has started dragging, a finger has not. */
  assert.strictEqual(pen.move({ ...p, clientX: 6, clientY: 0 }).kind, "drag-start");
  assert.strictEqual(touch.move({ ...t, clientX: 6, clientY: 0 }).kind, "move");
});

test("a second pointer turns the interaction into navigation, once", () => {
  const gesture = fresh();
  const first = pointer("touch", 100, 100);
  const second = pointer("touch", 200, 100);

  gesture.press(first);

  const began = gesture.press(second);

  assert.strictEqual(began.kind, "navigate-begin", "two fingers are never an edit");
  assert.strictEqual(gesture.navigating, true);

  /* A third pointer does not restart navigation. */
  assert.strictEqual(gesture.press(pointer("touch", 300, 100)).kind, "navigate-move");
});

test("two fingers moving together pan, and the geometry is not consulted", () => {
  const gesture = fresh();
  const a = pointer("touch", 100, 100);
  const b = pointer("touch", 200, 100);

  gesture.press(a);

  /*
   * THE BASELINE COMES BACK WITH THE BEGIN. A surface that ignores it measures
   * the next move against fingers that have already moved, so the first pan step
   * would report the whole distance the fingers had travelled since the press.
   */
  const began = gesture.press(b);

  assert.strictEqual(began.kind, "navigate-begin");
  assert.deepStrictEqual(began.pair, { distance: 100, midX: 150, midY: 100 });

  /*
   * A PAN IS BOTH FINGERS MOVING TOGETHER, and the browser reports them one at
   * a time - so a real pan arrives as two small moves. Each is reported with the
   * pan AND the momentary ratio, because between the two events the fingers
   * really are closer together; applying both, the two halves cancel out.
   */
  gesture.move({ ...a, clientX: 120, clientY: 110 });
  const moved = gesture.move({ ...b, clientX: 220, clientY: 110 });

  assert.strictEqual(moved.kind, "navigate");
  assert.strictEqual(Math.round(moved.panX), 10, "the MIDPOINT moved 10 px right");
  assert.strictEqual(Math.round(moved.panY), 5, "and 5 px down");

  /* Over the whole pan the fingers ended where they started: 100 px apart. */
  assert.strictEqual(
    Math.hypot(220 - 120, 110 - 110) / Math.hypot(200 - 100, 100 - 100),
    1,
    "no spread, so no net zoom",
  );
});

test("a pinch reports the ratio and the midpoint it turns about", () => {
  const gesture = fresh();
  const a = pointer("touch", 100, 100);
  const b = pointer("touch", 200, 100);

  gesture.press(a);
  gesture.press(b);

  /* Fingers spread: A goes from 100 to 50, so they are 150 px apart. */
  const moved = gesture.move({ ...a, clientX: 50, clientY: 100 });

  assert.strictEqual(moved.kind, "navigate");
  assert.strictEqual(moved.zoomRatio, 1.5, "100 px apart became 150");
  assert.strictEqual(Math.round(moved.midX), 125, "the midpoint is the focal point");
  assert.strictEqual(Math.round(moved.midY), 100);
});

test("lifting one of two fingers does not turn the remaining one into an edit", () => {
  const gesture = fresh();
  const a = pointer("touch", 100, 100);
  const b = pointer("touch", 200, 100);

  gesture.press(a);

  const began = gesture.press(b);

  assert.strictEqual(began.kind, "navigate-begin");
  assert.ok(began.pair, "the surface is given its baseline at once");

  const ended = gesture.release(b);

  assert.strictEqual(ended.kind, "navigate-end");
  assert.strictEqual(ended.stillDown, 1, "one finger is still on the glass");
  assert.strictEqual(gesture.down, 1, "and it is the only one still down");
  assert.strictEqual(gesture.navigating, true, "still navigating while a finger is down");
  assert.strictEqual(gesture.down, 1, "and it is still DOWN, though no longer the primary");

  /* The last finger moving is still navigation, not a drag. */
  assert.strictEqual(gesture.move({ ...a, clientX: 140, clientY: 100 }).kind, "navigate");

  assert.strictEqual(gesture.release(a).kind, "navigate-end");
  assert.strictEqual(gesture.navigating, false, "and it ends when the last finger lifts");
});

test("a cancelled press reports a cancel, not a tap", () => {
  const gesture = fresh();
  const down = pointer("pen", 10, 10);

  gesture.press(down);

  const cancelled = gesture.release(down, { cancelled: true });

  assert.strictEqual(cancelled.kind, "cancelled", "a platform cancel must roll back");
  assert.strictEqual(cancelled.dragged, false);
});

test("a cancelled drag is reported as a cancel, so nothing is committed", () => {
  const gesture = fresh();
  const down = pointer("touch", 0, 0);

  gesture.press(down);
  gesture.move({ ...down, clientX: 80, clientY: 0 });

  const cancelled = gesture.release(down, { cancelled: true });

  assert.strictEqual(cancelled.kind, "cancelled");
  assert.strictEqual(cancelled.dragged, true, "and the surface can tell to restore its preview");
});

test("a long press is due after the hold, and travel cancels it", () => {
  const gesture = fresh();
  const down = pointer("touch", 0, 0);

  gesture.press(down);

  assert.strictEqual(gesture.longPressDue(down), false, "not yet");

  time += GESTURE_DEFAULTS.longPressMs;
  assert.strictEqual(gesture.longPressDue(down), true, "held still for the hold");

  gesture.markLongPressed(down);
  assert.strictEqual(gesture.longPressDue(down), false, "it fires once");
});

test("a long press is cancelled when the finger has travelled", () => {
  const gesture = fresh();
  const down = pointer("touch", 0, 0);

  gesture.press(down);
  time += GESTURE_DEFAULTS.longPressMs;

  /* The finger slid a finger-width while being held. */
  gesture.move({ ...down, clientX: 30, clientY: 0 });

  assert.strictEqual(gesture.longPressDue(down), false, "a moving press is a drag, not a hold");
});

test("a long press never fires while navigating", () => {
  const gesture = fresh();
  const a = pointer("touch", 0, 0);
  const b = pointer("touch", 50, 0);

  gesture.press(a);
  gesture.press(b);
  time += GESTURE_DEFAULTS.longPressMs;

  assert.strictEqual(gesture.longPressDue(a), false);
});

test("a pointer that was never pressed is ignored", () => {
  const gesture = fresh();
  const stranger = pointer("mouse", 5, 5);

  assert.strictEqual(gesture.move(stranger).kind, "ignored");
  assert.strictEqual(gesture.release(stranger).kind, "ignored");
});

test("reset releases every live pointer and leaves a clean state", () => {
  const gesture = fresh();
  const a = pointer("touch", 0, 0);
  const b = pointer("touch", 10, 0);

  gesture.press(a);
  gesture.press(b);

  const reset = gesture.reset();

  assert.strictEqual(reset.pointers.length, 2, "both pointers are handed back");
  assert.strictEqual(reset.navigating, true);
  assert.strictEqual(gesture.navigating, false);
  assert.strictEqual(gesture.count, 0);
  assert.strictEqual(gesture.primary, null);

  /* And the next gesture starts as a press again. */
  assert.strictEqual(gesture.press(pointer("touch", 0, 0)).kind, "press");
});

test("pointer identity is kept, so a second finger lifting first is not confused", () => {
  const gesture = fresh();
  const first = pointer("touch", 0, 0);
  const second = pointer("touch", 100, 0);

  assert.strictEqual(gesture.press(first).kind, "press");
  assert.strictEqual(gesture.press(second).kind, "navigate-begin");

  /* The FIRST finger lifts first. */
  assert.strictEqual(gesture.release(first).kind, "navigate-end");
  assert.strictEqual(gesture.count, 1, "the second finger is still down");
});
