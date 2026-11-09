/* Layout shared by placement, measurement, preview, and export. */
import { noteTextStyle, noteTextWidth } from "../typography/note-text-style.js";

/*
 * WHERE THE MODEL'S TEXT FRAME SITS.
 *
 * The model's frame carries `x` and `y`; the renderer reads `center`. One
 * helper, used by every consumer, so a dimension is never drawn at its
 * top-left corner because two files disagree about the field's name.
 */
export function frameCenter(frame) {
  if (!frame) return null;
  const x = Number(frame.x ?? frame.center?.x);
  const y = Number(frame.y ?? frame.center?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/*
 * ============================================================
 * DOCUMENT SPACE, NOT SCREEN SPACE
 * ============================================================
 *
 * A drawing unit IS a millimetre, and a unit is printed as one paper
 * millimetre (`[x=1mm, y=1mm]`). Every size an annotation carries - its type,
 * its pens, its stands-off - is therefore stated in MILLIMETRES of paper, and
 * the canvas paints those millimetres through the camera (2.4 px per unit at
 * 100%). Nothing below reads a zoom, a screen pixel or a device ratio: a zoom
 * is a viewport transform applied to the whole sheet, after every size has
 * been decided.
 *
 * POINTS ARE THE ANALYSIS UNIT FOR TYPE. A dimension's size is stored in
 * POINTS (`style.fontSize`, default 11), because that is the number a drafter
 * writes and the number the exported `\fontsize` states - one number, shown in
 * the Features panel, the quick-access control and the source. It becomes
 * millimetres through the single conversion below.
 */
export const MM_PER_INCH = 25.4;
export const POINTS_PER_MM = 72 / MM_PER_INCH;

/* A printed point size, in drawing units (mm). */
export function pointsToWorld(points) {
  const size = Number(points);

  return Number.isFinite(size) && size > 0 ? size / POINTS_PER_MM : 0;
}

/* A drawing-unit length, in printed points. */
export function worldToPoints(world) {
  const size = Number(world);

  return Number.isFinite(size) ? size * POINTS_PER_MM : 0;
}

/*
 * THE STORED SIZE IS IN POINTS, and a dimension's default is 11.
 *
 * A style that carries no size takes the 11 pt default, so a new dimension is
 * readable without the student having to enlarge it. The range is a printed
 * one: 4 pt is the smallest legible label, 200 pt is a title.
 */
export const DIMENSION_DEFAULT_FONT_PT = 11;

/* The stored size of a dimension label, in points. */
export function dimensionFontPt(style = {}) {
  const size = Number(style?.fontSize);

  return Number.isFinite(size) && size > 0
    ? Math.min(200, Math.max(4, size))
    : DIMENSION_DEFAULT_FONT_PT;
}

/*
 * A DIMENSION'S PENS, in millimetres of paper.
 *
 * THE HIERARCHY IS STATED ONCE, as multipliers of the object's own pen:
 *
 *     dimension line   1.0 x the object's pen, with a readable floor
 *     witness lines    0.8 x the dimension line
 *     arrowheads       2.2 x the dimension line (length)
 *
 * The canvas and the TikZ writer both read these, so the printed figure has
 * the same weight hierarchy as the sheet - a dimension line is never a
 * hairline beside a heavy outline, and the witness lines read as construction
 * ink rather than as part of the outline.
 */
export const DIMENSION_LINE_WEIGHT = 1;
export const DIMENSION_WITNESS_WEIGHT = 0.8;
export const DIMENSION_HEAD_WEIGHT = 2.2;

/* The lightest pen an annotation is ever drawn with, in mm of paper. */
export const DIMENSION_MIN_PEN_MM = 0.35;

/* A pen width in millimetres, from the object's stored `lineWidth`. */
export function dimensionPenMm(style = {}) {
  const width = Number(style?.lineWidth);
  const base = Number.isFinite(width) && width > 0 ? width : 0.4;

  return Math.max(DIMENSION_MIN_PEN_MM, base);
}

/*
 * A MAJOR STROKE FLOOR, in drawing units.
 *
 * A dimension on an object whose pen was set to the very thinnest preset
 * (0.25 mm) would otherwise print thinner than its own witness lines once the
 * witness weight is applied - a 0.2 mm dimension line is a hairline. The floor
 * keeps the dimension line legible while preserving the hierarchy on every
 * ordinary pen.
 */
export const DIMENSION_MIN_LINE_MM = 0.4;

/* The three pens a dimension draws with, in drawing units (mm). */
export function dimensionPens(style = {}) {
  const line = Math.max(
    DIMENSION_MIN_LINE_MM,
    dimensionPenMm(style) * DIMENSION_LINE_WEIGHT,
  );

  return {
    line,
    witness: line * DIMENSION_WITNESS_WEIGHT,
    head: line * DIMENSION_HEAD_WEIGHT,
  };
}

/*
 * A DIMENSION'S ARROWHEAD, in drawing units (mm).
 *
 * Sized from the dimension line's own pen - 2.2 pens long, 0.8 of that wide -
 * so an arrowhead is always visible on a readable line and never grows out of
 * proportion with it. This is the same number the exported `Latex` head is
 * asked for (`arrows.meta` sizes are stated in mm), so the canvas triangle and
 * the printed head are the same size.
 */
export function dimensionArrowMm(style = {}) {
  return dimensionPens(style).head;
}

/*
 * A DIMENSION'S LABEL, MEASURED IN DOCUMENT SPACE ONLY.
 *
 * A drawing unit IS a millimetre, and a point is 1/72 inch, so the label's
 * size is a pure function of the STORED style. Zoom is a viewport transform
 * applied to the whole drawing at render time; it never enters this
 * calculation - which is what keeps the reserved box, the gap it leaves in its
 * own dimension line and the printed `\fontsize` identical at every zoom.
 */
export function dimensionLabelSize(text, state = {}, style = {}) {
  void state;

  const typography = noteTextStyle(style);
  const fontSize = dimensionFontPt(style);

  /*
   * THE LABEL'S TYPE, IN DRAWING UNITS. The size is taken from
   * `dimensionFontPt`, NOT from `noteTextStyle` - that helper clamps to a
   * 12 px note minimum, which would turn a dimension's 11 pt default into 12.
   */
  const fontWorld = pointsToWorld(fontSize);

  const lines = String(text || "").split("\n");

  return {
    /* A one-em character bound also covers wide letters and math glyphs. */
    halfWidth: noteTextWidth(text, typography, fontWorld) / 2,
    halfHeight: (lines.length * fontWorld * typography.lineSpacing) / 2,
    gap: 6 / 2.4,
    fontWorld,
    lines: lines.length,
    fontPt: Number((fontWorld * POINTS_PER_MM).toFixed(3)),
    typography,
  };
}
