/*
 * ============================================================
 * HOW BIG IS A FINGER, A PEN, AND A MOUSE — IN ONE PLACE
 * ============================================================
 *
 * Every number in the application that says "is the pointer close enough?" is
 * a SCREEN-SPACE number: how near the pointer has to be to a line before the
 * line counts as picked, how far it may travel before a press becomes a drag,
 * how many pixels of slack a snap has. Those answers are the same at every
 * zoom, because they are a property of the DEVICE and the GLASS, not of the
 * drawing.
 *
 * They are NOT the same for every device. A mouse lands within a pixel and
 * has a visible cursor pointing at the exact spot; a stylus is nearly as
 * precise and lands on the tip; a finger is several millimetres across and has
 * nothing on screen to say where it is aiming. A pick radius that is right for
 * a mouse makes a thin line impossible to tap; one that is right for a finger
 * makes a mouse feel sticky and imprecise.
 *
 * So this module is the ONE statement of that table. The gesture tracker
 * already keeps its own drag/long-press table (pointer-gesture.js) and the
 * snap engine keeps its own default (object-snap.js) - both are the existing
 * owners of those numbers. What this module adds is the PICK radii, shared by
 * hit-testing, handles and the hover/pen preview so a target that is shown is
 * a target that can be grabbed, with the same reach, by every caller.
 *
 * WHAT IT MUST NOT DO.
 *
 * It must never change geometry. A wider hit area is an INVISIBLE region
 * around the ink; the line is still the same millimetres wide, the pipe is
 * still the same bore, the coordinates are untouched. Nothing here is ever
 * written to an object.
 *
 * WHY IT IS CONFIGURABLE.
 *
 * Devices differ, and a tablet with a coarse digitiser reports a finger a
 * little differently from a phone. The table below is the starting point the
 * brief asks for (about 40-48 CSS px for a control target); a caller may pass
 * its own table, and the tests do, so the rules above are pinned without
 * depending on whatever the defaults happen to be.
 */

/*
 * THE INPUT KINDS.
 *
 * These are the same three strings the DOM's `pointerType` reports, plus the
 * fallback for anything that does not say (jsdom, a synthetic event, a device
 * the browser has not classified). Mouse keeps the application's established
 * precision, so "unknown" follows touch - a device that does not identify
 * itself is assumed to be the forgiving kind rather than the strict one, since
 * the consequence of being too strict is an unusable canvas and the
 * consequence of being too forgiving is a near miss.
 */
export const INPUT_KINDS = Object.freeze(["mouse", "pen", "touch", "unknown"]);

/* One device's numbers, in CSS pixels. */
const TOUCH = Object.freeze({
  /** How near the pointer must be to an object's ink to pick it. */
  pickRadiusPx: 20,

  /** How near an endpoint / vertex / connection point must be. They matter most. */
  pointPickRadiusPx: 24,

  /** How near a manipulation handle must be, for a SELECTED object. */
  handlePickRadiusPx: 24,

  /** Snap engine catch band. */
  snapTolerancePx: 14,

  /** Horizontal/vertical alignment band. */
  inferenceTolerancePx: 30,
});

const PEN = Object.freeze({
  pickRadiusPx: 8,
  pointPickRadiusPx: 12,
  handlePickRadiusPx: 12,
  snapTolerancePx: 8,
  inferenceTolerancePx: 24,
});

/*
 * MOUSE IS THE ESTABLISHED BEHAVIOUR, to the pixel.
 *
 * These are exactly the numbers the hit tests already used before this module
 * existed: 4 px for an object's ink (hit-testing.js), 9 px for a handle
 * (handles.js), and the snap engine's own 5 px / 24 px defaults. Keeping them
 * identical here is the promise that a mouse user cannot tell this change
 * happened.
 */
const MOUSE = Object.freeze({
  pickRadiusPx: 4,
  pointPickRadiusPx: 9,
  handlePickRadiusPx: 9,
  snapTolerancePx: 5,
  inferenceTolerancePx: 24,
});

export const INPUT_TOLERANCES = Object.freeze({
  mouse: MOUSE,
  pen: PEN,
  touch: TOUCH,

  /* An unidentified device gets the forgiving set, but not the widest of all. */
  unknown: TOUCH,
});

/**
 * The DOM's `pointerType`, normalised to one of `INPUT_KINDS`.
 *
 * Accepts a pointer event, an event-like object, or the type string itself, so
 * every caller can ask the same function without re-implementing the check.
 */
export function inputKindOf(source) {
  const type =
    typeof source === "string" ? source : source && source.pointerType;

  return type === "mouse" || type === "pen" || type === "touch"
    ? type
    : "unknown";
}

/**
 * The tolerance table for one input kind.
 *
 * `options` may carry a replacement table (`tolerances`) for a test or a future
 * preference; a partial table is merged over the default so a caller can change
 * one number without restating the rest.
 */
export function tolerancesFor(source, options = {}) {
  const kind = inputKindOf(source);
  const override = options.tolerances || null;
  const base = INPUT_TOLERANCES[kind] || INPUT_TOLERANCES.unknown;

  if (!override) {
    return { ...base, kind };
  }

  const specific = override[kind] || {};

  return { ...base, ...override.default, ...specific, kind };
}

/**
 * A screen-pixel radius, in ENGINEERING units, at the current camera.
 *
 * THE ONE CONVERSION every hit test needs, so the "same physical size at any
 * zoom" rule is written once. `scale` is engineering-units-to-pixels (the
 * drawing state's base pixels per unit times the zoom); a degenerate scale is
 * floored rather than allowed to produce an infinite radius.
 */
export function worldRadius(pixels, scale) {
  const usable = Number.isFinite(scale) && scale > 0 ? scale : 1e-6;

  return Math.max(0, Number(pixels) || 0) / usable;
}

export default {
  INPUT_KINDS,
  INPUT_TOLERANCES,
  inputKindOf,
  tolerancesFor,
  worldRadius,
};
