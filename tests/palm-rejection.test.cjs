/*
 * ========================================================
 * A RESTING HAND IS NOT A DRAWING HAND
 * ========================================================
 *
 * The rule, and its limits, are pinned here so the behaviour cannot drift into
 * "ignore all touch" - the failure mode that would make the tablet unusable with
 * a finger.
 */

const test = require("node:test");
const assert = require("node:assert");

const {
  isIncidentalContact,
  isPenActive,
  isPenDown,
  notePenDown,
  notePenUp,
  resetPen,
} = require("../src/features/workspace/interaction/palm.js");

const TOUCH = { pointerType: "touch" };
const PEN = { pointerType: "pen" };
const MOUSE = { pointerType: "mouse" };

test("a touch with no pen anywhere is a real finger", () => {
  resetPen();

  assert.strictEqual(
    isIncidentalContact(TOUCH),
    false,
    "touch must work on a touch-only device",
  );
  assert.strictEqual(isIncidentalContact(MOUSE), false);
  assert.strictEqual(isIncidentalContact(PEN), false);
});

test("while a pen is down, a touch contact is incidental", () => {
  resetPen();
  notePenDown();

  assert.strictEqual(isPenDown(), true);
  assert.strictEqual(
    isIncidentalContact(TOUCH),
    true,
    "a resting hand must not draw",
  );
});

test("the pen itself is never incidental, whatever it is doing", () => {
  resetPen();
  notePenDown();

  assert.strictEqual(isIncidentalContact(PEN), false, "the pen is the tool");
  assert.strictEqual(
    isIncidentalContact(MOUSE),
    false,
    "a mouse is not a hand",
  );
});

test("a touch just after the pen lifts is still that pen's hand", () => {
  resetPen();
  notePenDown();
  notePenUp();

  /*
   * The hand does not lift the instant the nib does, so the contact that follows
   * a pen release still belongs to the pen session - for the grace period.
   */
  assert.strictEqual(isPenDown(), false, "the pen is up");
  assert.strictEqual(isPenActive(), true, "but its hand may still be resting");
  assert.strictEqual(isIncidentalContact(TOUCH), true);
});

test("the rule is scoped to the pen's presence, not to the device", () => {
  resetPen();

  /* Long after a pen session, touch is the user's intent again. */
  const realNow = Date.now;

  Date.now = () => realNow() + 10000;

  try {
    assert.strictEqual(isPenActive(), false);
    assert.strictEqual(
      isIncidentalContact(TOUCH),
      false,
      "touch must not stay disabled",
    );
  } finally {
    Date.now = realNow;
  }
});

test("an unknown device is given the benefit of the doubt", () => {
  resetPen();
  notePenDown();

  assert.strictEqual(isIncidentalContact({ pointerType: "joystick" }), false);
  assert.strictEqual(isIncidentalContact({}), false);
});

test("reset forgets the pen entirely", () => {
  resetPen();
  notePenDown();
  resetPen();

  assert.strictEqual(isPenDown(), false);
  assert.strictEqual(isPenActive(), false);
  assert.strictEqual(isIncidentalContact(TOUCH), false);
});
