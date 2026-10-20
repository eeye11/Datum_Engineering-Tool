/*
 * ============================================================
 * THE DRAWN SIZE OF A SYMBOL, IN ONE PLACE
 * ============================================================
 *
 * Several objects are larger than their own coordinates: a beam is a bar of some
 * depth, a support is a triangle with a ground line, a truss has a chord depth, a
 * label reaches past the point it is anchored to.
 *
 * Those sizes are needed TWICE - once by the source writer, to draw the symbol,
 * and once by the bounds calculation, to know how much room the drawing needs.
 * Stated twice they drift, and the drift is visible as a figure whose own label
 * is clipped by its frame.
 *
 * So this leaf module owns the numbers and both read them from here. They are
 * MODEL UNITS - how big the mark is drawn relative to the sheet - and the export
 * scales them with everything else.
 *
 * NO IMPORTS, deliberately: the writers are loaded outside a browser by the
 * tests and the bounds module must not drag them in.
 */

/* A beam is a slim bar this many units either side of its centreline. */
export const BEAM_HALF_DEPTH = 6;

/*
 * A truss chord's depth, either side of its span.
 *
 * THE CANVAS'S OWN VALUE (`draw-members.js`), which the source writer also uses.
 * It was 25 here while both of those drew 12, so Fit-All reserved a band more
 * than twice as tall as the truss actually occupies and the export scale was
 * computed from that inflated rectangle.
 */
export const TRUSS_DEPTH = 12;

/* A particle's marker radius. */
export const PARTICLES_RADIUS = 1;

/*
 * A moment's arc, when the object stores no radius of its own.
 *
 * The canvas's rotational-arrow default (`enggDrawingRotationalArrow`), which the
 * Statics writer draws with; the bounds must not use a different arc.
 */
export const MOMENT_DEFAULT_RADIUS = 7;

/*
 * A support's triangle half-extent, and the ground line it stands on.
 *
 * READ FROM THE WRITER (`supportFrame` in `statics.js`), which is the one place
 * a support's symbol is stated: the triangle's base is 4 either side of its
 * anchor and the hatching runs 4.5 further out, so the symbol reaches about
 * 8.5 in its `out` direction and 4 across.
 *
 * The bounds module measures that SHAPE (outward from the anchor) rather than a
 * circle around it; these numbers exist so the two cannot drift.
 */
export const SUPPORT_SIZE = 4;
export const SUPPORT_GROUND = 9;

/*
 * HOW FAR A LABEL REACHES FROM THE POINT IT IS ANCHORED TO, in model units.
 *
 * A text node is anchored at a coordinate and grows AWAY from it - up, right,
 * or both, depending on the anchor - so its ink is not at the coordinate. A
 * label is about one line high; this is a little more, to allow for a wide or a
 * two-line one, and it is a bound rather than a measurement: too small clips,
 * too large wastes a little room.
 */
export const LABEL_REACH = 6;

/*
 * A SHAFT'S RADIUS when the object states no diameter.
 *
 * It is drawn size, so it scales with the export; the CANVAS's own default is
 * the same figure, which is what keeps the sheet and the export the same shape.
 */
export const SHAFT_DEFAULT_RADIUS = 4;

export default {
  BEAM_HALF_DEPTH,
  TRUSS_DEPTH,
  PARTICLES_RADIUS,
  MOMENT_DEFAULT_RADIUS,
  SUPPORT_SIZE,
  SUPPORT_GROUND,
  LABEL_REACH,
  SHAFT_DEFAULT_RADIUS,
};
