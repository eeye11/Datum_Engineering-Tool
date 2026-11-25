/*
 * ============================================================
 * THE DRAWING'S MEASUREMENT SCALE
 * ============================================================
 *
 * ONE place that answers "what does a number on the sheet mean", so the ruler,
 * the coordinate read-out and the grid settings cannot tell a student three
 * different things about the same pixel.
 *
 * WHAT A DRAWING UNIT IS.
 *
 * DAETUM's coordinates are MILLIMETRES. That is not an inference: the saved
 * `.tex` states it in its own header - "drawing units, x to the right and y UP;
 * on paper one unit is 1 mm" - the picture declares `[x=1mm, y=1mm]`, lengths in
 * the source comments are drawing units, and the status bar has always printed
 * `mm` beside the pointer's coordinates. So:
 *
 *     1 drawing unit = 1 mm.
 *
 * This is a statement about the COORDINATE SYSTEM, not about a print scale.
 * The sheet is not fitted to a physical page by these numbers - a drawing of a
 * 200 mm beam stores `start.x = 0, end.x = 200` whatever paper it lands on -
 * which is why the rulers say "mm" and not "mm at 1:5".
 *
 * HOW SCREEN PIXELS RELATE TO THEM.
 *
 * The canvas shows a millimetre through the camera:
 *
 *     screen.x = width / 2 + (x - panX) * k
 *     k = BASE_PIXELS_PER_UNIT * zoom
 *
 * `BASE_PIXELS_PER_UNIT` is 3.6, so at 100% zoom one millimetre is 3.6 pixels.
 * That is the number that makes the old rulers unreadable: a 900px canvas is
 * 900 / 3.6 = 250 mm wide, and a raw coordinate read across it runs into the
 * hundreds - which is TRUE, but it is the sheet's extent, not a sensible
 * running count. The cure is not a different unit (squashing the numbers into
 * "cm" would print 25 and hide that the canvas really is 250 mm across); it
 * is a ruler whose INTERVALS adapt to the zoom so a student reads 5, 10, 20, 50
 * or 100 mm marks rather than a wall of four-figure ticks. `ruler-scale.js`
 * owns that choice.
 *
 * WHY `BASE_PIXELS_PER_UNIT` IS NOT CHANGED HERE.
 *
 * It is the ratio between millimetres and the drawing's own pixels, and every
 * stored coordinate, grid spacing and snapping tolerance is expressed through
 * it. It was raised once, from 2.4 to 3.6, so that a given physical distance
 * on screen now holds 100 drawing units where it used to hold 150 - a uniform
 * increase of the drawing scale, not a relabelling. Every saved coordinate is
 * untouched: only the ratio that maps units onto pixels changed.
 */

import enggDrawingState from "../model/drawing-state.js";

/* The unit the sheet's coordinates are measured in, and how it is written. */
export const DRAWING_UNIT = "mm";

export const DRAWING_UNIT_NAME = "millimetres";

/*
 * A note for a tooltip or a test, saying what the numbers are - not a claim
 * about print scale.
 */
export const DRAWING_UNIT_DESCRIPTION =
  "1 drawing unit = 1 mm (sheet coordinates)";

/* The camera's own pixels-per-millimetre ratio at 100% zoom. */
export function basePixelsPerUnit() {
  return enggDrawingState.BASE_PIXELS_PER_UNIT;
}

/*
 * Screen pixels for one millimetre at a given zoom.
 *
 * Zoom is a VIEW setting: it changes this number and nothing else. No stored
 * coordinate, dimension or tolerance is ever written through it.
 */
export function pixelsPerUnit(zoom = 1) {
  const factor = Number(zoom);

  return (
    enggDrawingState.BASE_PIXELS_PER_UNIT *
    (Number.isFinite(factor) && factor > 0 ? factor : 1)
  );
}

/*
 * The millimetre value of a screen distance, at a zoom.
 *
 * Used where something measures the screen and needs to speak in the sheet's
 * units - a ruler span, a label, an export.
 */
export function screenPixelsToMm(pixels, zoom = 1) {
  const scale = pixelsPerUnit(zoom);

  return Number(pixels) / scale;
}

export function mmToScreenPixels(mm, zoom = 1) {
  return Number(mm) * pixelsPerUnit(zoom);
}

/*
 * A length written for a student: a whole number of millimetres where the
 * number is whole, and at most one decimal otherwise - enough to read a
 * position, never a machine-precision pile of digits.
 */
export function formatMm(value) {
  /*
     * AN ABSENT VALUE IS NOT ZERO. `Number(null)` is 0, so a missing length
     * would print as a confident "0" - the same trap `quantities.js` calls out
     * for every other quantity. Nothing is written for nothing.
     */
  if (value === null || value === undefined) {
        return "";
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "";
  }

  if (Math.abs(number) < 5e-7) {
    return "0";
  }

  return String(Number(number.toFixed(1)));
}

/* The same, with the unit on the end. */
export function formatMmWithUnit(value) {
  const text = formatMm(value);

  return text ? `${text} ${DRAWING_UNIT}` : "";
}
