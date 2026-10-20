/*
 * ============================================================
 * HOW WIDE A STROKE IS SHOWN, AND HOW WIDE IT IS WRITTEN
 * ============================================================
 *
 * The Drawing Space paints the COMPILED picture, and the compiled picture's
 * stroke widths are print widths in points. To make a drawn line readable on a
 * screen it rescales every stroke to the width the model renderer always used:
 *
 *     screen pixels = lineWidth x SCREEN_PIXELS_PER_LINE_WIDTH
 *                   = lineWidth x 2.4
 *
 * and keeps it that size at any zoom (`vector-effect: non-scaling-stroke`).
 *
 * THESE NUMBERS ARE THE CONTRACT BETWEEN THE CANVAS AND THE GENERATOR.
 *
 * The canvas already inverts them to recover the model's `lineWidth` from a
 * compiled picture. The generator has to produce a width that inverts to the
 * SAME `lineWidth`, or the sheet is drawn at one weight in DAETUM and another in
 * every external renderer. It used to use 0.56 points per line width, so the
 * compiled stroke inverted to 0.23 of the configured width - 4.3 times thinner
 * than the canvas drew it, which is why every generated diagram arrived with
 * hairlines.
 *
 * So the constants live in this leaf module, which both sides import:
 *
 *     screen-side   `canvas-render.js`   - print points -> screen pixels
 *     source-side   `tikz-style.js`      - lineWidth   -> print points
 *
 * A leaf with no imports on purpose: the source writers are loaded outside a
 * browser by the tests, and reaching into the canvas renderer for a constant
 * would drag the whole renderer - and its DOM - with them.
 */

/* The model's screen scale: one unit of `lineWidth` is 2.4 screen pixels. */
export const SCREEN_PIXELS_PER_LINE_WIDTH = 2.4;

/* The smallest stroke the sheet paints, so a hairline is still visible. */
export const MIN_SCREEN_STROKE_PX = 0.5;

/*
 * The print width, in points, that the canvas shows at the given screen width.
 *
 * Used by the canvas when it adopts a compiled picture: the picture states its
 * strokes in points, the sheet needs them in screen pixels, and this is the ONE
 * conversion between the two. The generator writes `screenWidthOfPrintPoints`'s
 * inverse, so a stroke round-trips unchanged.
 */
export function screenWidthOfPrintPoints(printPoints) {
  const width = Number(printPoints);

  if (!Number.isFinite(width) || width <= 0) {
    return MIN_SCREEN_STROKE_PX;
  }

  /*
   * The inverse of `printPointsOfLineWidth` (tikz-style.js):
   *
   *     print width = lineWidth x SCREEN_PIXELS_PER_LINE_WIDTH  (pt)
   *     screen px   = print width                               (px)
   *
   * The two are the same number, which is the point: a stroke is one width,
   * stated in the unit appropriate to where it is shown.
   */
  return Math.max(MIN_SCREEN_STROKE_PX, width);
}

export default {
  SCREEN_PIXELS_PER_LINE_WIDTH,
  MIN_SCREEN_STROKE_PX,
  screenWidthOfPrintPoints,
};
