/*
 * ============================================================
 * A RESTING HAND IS NOT A DRAWING HAND
 * ============================================================
 *
 * A stylus user rests the side of their hand on the glass, and the browser
 * reports that contact as a `touch` pointer exactly like a deliberate finger.
 * Without a rule, every pen stroke would begin next to a phantom finger that
 * drew a line, selected an object, or - worse - landed as a SECOND pointer and
 * cancelled the stroke into a pinch.
 *
 * WHAT THIS MODULE CAN AND CANNOT KNOW.
 *
 * No web API identifies a palm. The browser gives a pointer type ("touch"),
 * a size (`width`/`height` when the device reports it), and a count. So this is
 * BEST-EFFORT, and it says so: while a pen is in contact, a touch is treated as
 * incidental and ignored for the canvas; when no pen is in contact, every touch
 * is a real finger and full touch interaction applies.
 *
 * WHY THAT RULE, RATHER THAN SIZE HEURISTICS.
 *
 * Size and pressure vary by device, driver and browser - a rule built on them
 * would silently stop working on the next tablet. "The pen is down, so the hand
 * is not the tool" is true on every device that has a pen, and it is the only
 * rule that can be stated honestly. The cost is that a second FINGER cannot pan
 * while a pen is in contact; the pen user lifts the pen to navigate, which is
 * what they would do anyway.
 *
 * SCOPE. This is used by the canvas only. It never suppresses keyboard input,
 * interface controls, native text editing or scrolling anywhere else, and it
 * does not disable touch globally - a device used with fingers alone behaves
 * exactly as a finger-typed device does.
 */

/* How long a pen's presence outlives its last contact, in milliseconds. */
const PEN_GRACE_MS = 700;

/* The live pen state, for the one canvas that owns it. */
let penContactUntil = 0;
let penDown = false;

function now() {
  return Date.now();
}

/**
 * A pen has gone down.
 *
 * Called by the canvas on a `pen` press, BEFORE any other press is classified,
 * so an incidental touch that arrives in the same instant sees a live pen.
 */
export function notePenDown() {
  penDown = true;
  penContactUntil = now() + PEN_GRACE_MS;
}

/**
 * A pen has been lifted (or cancelled, or left the surface).
 *
 * The grace period is not the pen "still being down": it is the moment between
 * the pen lifting and the hand settling, during which a contact still belongs to
 * that pen session. It exists because a resting hand does not lift the instant
 * the nib does.
 */
export function notePenUp() {
  penDown = false;
  penContactUntil = now() + PEN_GRACE_MS;
}

/* Forget the pen entirely - a finished gesture, or a torn-down surface. */
export function resetPen() {
  penDown = false;
  penContactUntil = 0;
}

/** Whether a pen is in contact right now. */
export function isPenDown() {
  return penDown;
}

/** Whether a pen was, or very recently was, in use. */
export function isPenActive() {
  return penDown || now() <= penContactUntil;
}

/**
 * Whether a pointer is an incidental contact that must not affect the drawing.
 *
 * A touch while a pen is active is incidental. A pen contact is the pen, and
 * a mouse is the mouse - neither is ever incidental, and an unknown device is
 * given the benefit of the doubt (it is treated as the user's intent).
 */
export function isIncidentalContact(event) {
  const type = event && event.pointerType;

  return type === "touch" && isPenActive();
}
