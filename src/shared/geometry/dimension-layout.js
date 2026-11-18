/* Layout shared by placement, measurement, preview, and export. */
import { noteTextStyle, noteTextWidth } from "../typography/note-text-style.js";
import {
  DEFAULT_CANVAS_FONT_PX,
  SECONDARY_FONT_PX,
  fontSizeOf,
  screenPixelsToDrawing,
} from "../typography/canvas-typography.js";

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

/*
 * THE LIGHTEST PEN AN ANNOTATION IS EVER DRAWN WITH, in mm of paper.
 *
 * Stated BEFORE the function that reads it. These are function declarations and
 * hoist either way, but a `const` read from a function body is only safe while
 * that body runs after the module has evaluated - and a top-level call in a
 * field initialiser would see the temporal dead zone.
 */
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
/*
 * ============================================================
 * THE LABEL'S BOX, IN DRAWING UNITS
 * ============================================================
 *
 * The SIZE of a dimension's number is a canvas font size - screen pixels, from
 * the shared typography system - so the room it takes on the sheet is that
 * screen box divided by the camera. `zoom` therefore appears exactly once, in
 * `screenPixelsToDrawing`, and it is a VIEWPORT conversion, not a change to any
 * stored size: the number measures the same on screen at 25% and at 400%, and
 * the box reserved for it around the dimension is the box that number occupies.
 *
 * WHAT IT REPLACES. The size used to be a POINT size converted to millimetres
 * and then scaled by the camera with the drawing, so the number grew as the
 * student zoomed in and shrank as they zoomed out - the behaviour the brief
 * calls out as wrong.
 */
export function dimensionLabelSize(text, state = {}, style = {}) {
  const zoom = Math.max(Number(state?.camera?.zoom) || 1, 0.25);

  const typography = noteTextStyle(style);

  /*
   * THE SIZE THE CANVAS PAINTS, and the PRINTED size beside it.
   *
   * `style.fontSize` is the one student-facing property. For a dimension it is
   * stated in the same unit as its printed figure - the number beside the arrow
   * and the `\fontsize` in the source say the same thing, which is what makes
   * "change the label to 20 and the export prints 20" true. The canvas then
   * paints that number as SCREEN pixels: 14 reads as 14 px at every zoom.
   *
   * A style with no size at all is a document written before this rule, and it
   * takes the established default in both readings (11 pt / 14 px on screen).
   */
  const stored = Number(style?.fontSize);
  const fontSize = fontSizeOf(
    stored,
    stored === DIMENSION_DEFAULT_FONT_PT ? SECONDARY_FONT_PX : DEFAULT_CANVAS_FONT_PX,
  );

  /*
   * THE PRINTED SIZE, for the source and the panel.
   *
   * A dimension is a PRINTED annotation first, so its figure starts at the
   * drafting default of 11 pt. A size the student has chosen of their own is
   * what the figure states, so the exported drawing carries the type they picked
   * rather than a default they never saw. The canvas paints whatever the style
   * says, at that many screen pixels - see `fontSize` above.
   */
  const fontPt = stored > 0 && stored !== SECONDARY_FONT_PX
    ? stored
    : DIMENSION_DEFAULT_FONT_PT;

  const lines = String(text || "").split("\n");

  /* The box the number occupies ON SCREEN, at the size the canvas paints it. */
  const screenWidth = noteTextWidth(text, typography, fontSize);
  const screenHeight = lines.length * fontSize * typography.lineSpacing;

  /*
   * AND THE SAME BOX IN DRAWING UNITS - the ROOM IT RESERVES ON THE SHEET.
   *
   * This is a PRINTED FIGURE, sized from the label's point size through the
   * same one conversion the printed head and the printed pen use (`fontWorld`
   * below). It is deliberately NOT the screen box divided by the camera: this
   * extent joins the dimension's own construction - how far the number stands
   * off its line, how much room a deliberate reposition may use - and a
   * construction that changed with the viewport would mean the dimension's
   * geometry moved when the student zoomed. A paper dimension reserves paper for
   * its number, and the canvas paints that same number at its screen size.
   */
  /*
   * THE CONSTRUCTION'S OWN TYPE HEIGHT - the printed figure in drawing units,
   * independent of the viewport, because the dimension line's stand-off is part
   * of the drawing, not of the screen.
   */
  const fontWorld = pointsToWorld(fontPt);

  const width = noteTextWidth(text, typography, fontWorld);
  const height = lines.length * fontWorld * typography.lineSpacing;

  return {
    halfWidth: width / 2,
    halfHeight: height / 2,

    /* The screen box too, for a caller that draws in screen space. */
    screenWidth,
    screenHeight,

    /*
     * THE CLEARANCE THE NUMBER LEAVES AROUND ITSELF - stated in DRAWING
     * units and deliberately independent of both the type size and the zoom.
     *
     * It is not a paint measurement: the label's frame feeds the dimension's
     * own CONSTRUCTION (how far the number stands off its line, and how much
     * room a deliberate reposition may use), and a frame that moved with the
     * viewport would make the drawing's construction change when the student
     * zoomed. So a zoom never reaches it, and neither does a font-size change -
     * the dimension line does not walk away from the geometry it measures
     * because its number got bigger.
     */
    gap: 6 / 2.4,

    /** The type height in drawing units, so a caller can offset by one line. */
    fontWorld: pointsToWorld(fontPt),
    /** The screen size the canvas paints. */
    fontSize,
    lines: lines.length,
    /** The PRINT size, for the source and the panel. */
    fontPt: Number(fontPt.toFixed(3)),
    typography,
    zoom,
  };
}

/*
 * THE SAME NUMBER IN DRAWING UNITS, for `placeIt` and the source writer.
 *
 * Kept as a named export because several callers state a type height in drawing
 * units; it is now derived from the screen size rather than from the point size,
 * so the screen, the reserved box and the printed figure agree.
 */
export function dimensionLabelFontWorld(style = {}, zoom = 1) {
  const stored = Number(style?.fontSize);
  const size = fontSizeOf(
    stored,
    stored === DIMENSION_DEFAULT_FONT_PT ? SECONDARY_FONT_PX : DEFAULT_CANVAS_FONT_PX,
  );

  return screenPixelsToDrawing(size, zoom);
}


