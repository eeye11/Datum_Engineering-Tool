/*
 * ============================================================
 * THE CANVAS TYPOGRAPHY SYSTEM
 * ============================================================
 *
 * ONE answer to "how big is this text, and what does it look like", for every
 * piece of text DAETUM draws on the drawing canvas: notes, labels, dimension
 * numbers, point coordinates, graph axes and tick values, equations, vector and
 * load magnitudes, sketch names, fluid and thermal annotations, and the
 * automatically generated label a feature carries.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Before it, the renderer contained THIRTY-SIX literal `font-size` attributes -
 * 9, 10, 11, 12, 13, 14 - each chosen at its call site, and each object that
 * carried a size carried it in a different field and a different unit. A note
 * stored PIXELS, a dimension stored POINTS ON PAPER, a Heat label stored
 * `labelSize`, and an object's own label fell back to a hard-coded 11. That is
 * why the same drawing showed six different type sizes, and why the one
 * font-size control could not honestly describe what it was changing.
 *
 * NOW THERE IS ONE UNIT AND ONE HIERARCHY.
 *
 * SCREEN SPACE, NOT DRAWING SPACE
 * -------------------------------
 * A size here is a SCREEN pixel size. It is what the glyph measures on the
 * user's monitor at 100% zoom, and it does not change when the drawing is
 * zoomed - which is the property the brief asks for: a 16 px label is 16 px at
 * 25%, 100% and 400%.
 *
 * The canvas renders through the camera (`engineeringToScreen`), so a `<text>`
 * with `font-size="16"` inside the overlay would be 16 DRAWING units and would
 * grow with the zoom. `textFontAttributes` cancels the camera for the glyphs
 * alone, so the text is painted at its screen size while its POSITION is still
 * the projected drawing position:
 *
 *     x = projected.x,  font-size = size * zoom,  transform = scale(1 / zoom)
 *
 * The transform is anchored at the text's own position, so the glyphs shrink
 * about the point they are anchored on and never drift away from it. Alignment
 * (`text-anchor`) is applied OUTSIDE that transform, so centring, start and end
 * alignment are unaffected by the compensation.
 *
 * THE SIZE HIERARCHY
 * ------------------
 * Four roles, one default. They are a hierarchy, not a menu of arbitrary
 * numbers: something is 12 px because it is COMPACT AUXILIARY INFORMATION, not
 * because 12 happened to fit at the time.
 *
 *     18  title       a heading or a prominent value
 *     16  primary     the general default for canvas text
 *     14  secondary   a supporting value that sits beside a primary one
 *     12  auxiliary   compact information: tick numbers, indices, sign marks
 *
 * Smaller than 12 is never the answer to "it does not fit" - that is solved by
 * moving the text, never by shrinking it below the established minimum.
 */

/*
 * ============================================================
 * THE TOKENS
 * ============================================================
 *
 * Every size in the application resolves through this table. A tool names a
 * ROLE; it does not name a number. `TITLE_FONT_PX` and its siblings are what a
 * call site uses when it does need the number itself (a width estimate, an
 * editor box), and `TEXT_ROLES` is what the validator and the selector use.
 */
export const TITLE_FONT_PX = 18;
export const PRIMARY_FONT_PX = 16;
export const SECONDARY_FONT_PX = 14;
export const AUXILIARY_FONT_PX = 12;

/*
 * THE ROLE TABLE.
 *
 * `default: true` marks the role a NEW piece of canvas text starts at, and the
 * one the toolbar control edits when nothing is selected. Exactly one role may
 * be the default - `DEFAULT_CANVAS_FONT_PX` is derived from it below.
 */
export const TEXT_ROLES = Object.freeze({
  title: Object.freeze({ label: "Title", size: TITLE_FONT_PX }),
  primary: Object.freeze({
    label: "Primary",
    size: PRIMARY_FONT_PX,
    default: true,
  }),
  secondary: Object.freeze({ label: "Secondary", size: SECONDARY_FONT_PX }),
  auxiliary: Object.freeze({ label: "Auxiliary", size: AUXILIARY_FONT_PX }),
});

/* The four sizes, smallest first - the order the validator reports in. */
export const CANVAS_FONT_SIZES = Object.freeze([
  AUXILIARY_FONT_PX,
  SECONDARY_FONT_PX,
  PRIMARY_FONT_PX,
  TITLE_FONT_PX,
]);

/* The general default, for new canvas text and for an absent stored size. */
export const DEFAULT_CANVAS_FONT_PX = PRIMARY_FONT_PX;

/*
 * The sizes the quick-access dropdown offers. The four standard roles, plus the
 * steps above and beside them that a title or a large annotation legitimately
 * needs. 16 is present because it is the default.
 */
export const FONT_SIZE_CHOICES = Object.freeze([
  12, 14, 16, 18, 20, 24, 28, 32,
]);

/*
 * THE USABLE RANGE, in screen pixels.
 *
 * 8 px is the smallest a glyph can be and still be read; below that a label is
 * not "compact", it is decoration. 96 px is larger than any title a technical
 * figure carries. The range is stated once so the toolbar, the Features panel,
 * a saved file and an import all clamp identically.
 */
export const FONT_PX_MIN = 8;
export const FONT_PX_MAX = 96;

/* How much of a size a subscript or superscript keeps. */
export const SCRIPT_SCALE = 0.7;

/*
 * ============================================================
 * THE FAMILY AND WEIGHT SYSTEM
 * ============================================================
 *
 * One family for canvas text, and one weight per role. The weights are a small
 * closed set - regular, medium, bold - rather than a number a tool may pick,
 * because a drawing's hierarchy should come from SIZE and WEIGHT together and
 * not from six arbitrary values.
 */
export const CANVAS_FONT_STACK =
  'Arial, "Helvetica Neue", Helvetica, sans-serif';
export const MATH_FONT_STACK = '"Times New Roman", Georgia, serif';

export const FONT_WEIGHTS = Object.freeze({
  regular: "400",
  medium: "500",
  bold: "700",
});

/*
 * The weight each role is drawn at when nothing overrides it. Only a title and
 * a primary annotation are medium; a tick number is regular so it recedes.
 */
export const ROLE_WEIGHTS = Object.freeze({
  title: FONT_WEIGHTS.bold,
  primary: FONT_WEIGHTS.regular,
  secondary: FONT_WEIGHTS.regular,
  auxiliary: FONT_WEIGHTS.regular,
});

/*
 * THE BASELINE AND LINE HEIGHT, stated once.
 *
 * `dominant-baseline: middle` is what makes a label centred on its anchor in
 * every browser rather than on a font-dependent baseline - SVG's `middle`
 * baseline is the middle of the em box. The canvas used to mix it with manual
 * `fontSize * 0.35` nudges, which is why a two-line label and a one-line label
 * did not agree about their centre.
 */
export const CANVAS_BASELINE = "middle";
export const LINE_SPACING = 1.2;

/* Pi, as the drawing's coordinate system already uses. */
export const BASE_PIXELS_PER_UNIT = 2.4;

/* ============================================================
 * VALIDATION
 * ============================================================ */

/*
 * A STORED SIZE, AS THE SYSTEM WILL HONOUR IT.
 *
 * Three things are resolved here, and they are deliberately separate:
 *
 *   missing   no size at all - the legacy object written before there was a
 *             system. It takes `fallback`, which is the caller's ROLE default
 *             (16 for a note, 12 for a tick number), NOT a guess about what the
 *             old tool happened to draw.
 *
 *   invalid   a size that is not a positive finite number - a string, null, a
 *             negative. It is normalised to the fallback and reported as
 *             `invalid`, so a migration can tell "never set" from "broken".
 *
 *   valid     a real number. It is clamped into the usable range and KEPT -
 *             including a size that is not one of the four roles, because that
 *             is the student's own choice and the brief says to preserve it.
 *
 * The range floor is `FONT_PX_MIN`, not the 12 px auxiliary size: a student may
 * legitimately have customised a label to 10 px, and silently promoting it to
 * 12 would be overwriting a valid custom typography, which the brief forbids.
 */
export function normaliseFontSize(value, fallback = DEFAULT_CANVAS_FONT_PX) {
  const base =
    Number.isFinite(Number(fallback)) && Number(fallback) > 0
      ? Number(fallback)
      : DEFAULT_CANVAS_FONT_PX;

  if (value === undefined || value === null || value === "") {
    return { size: clampSize(base), status: "missing" };
  }

  const size = Number(value);

  if (!Number.isFinite(size) || size <= 0) {
    return { size: clampSize(base), status: "invalid" };
  }

  return { size: clampSize(size), status: "valid" };
}

/* The size alone, clamped, with the system default for anything unusable. */
export function fontSizeOf(value, fallback = DEFAULT_CANVAS_FONT_PX) {
  return normaliseFontSize(value, fallback).size;
}

function clampSize(value) {
  return Math.min(
    FONT_PX_MAX,
    Math.max(FONT_PX_MIN, Math.round(value * 100) / 100),
  );
}

/*
 * THE ROLE A SIZE BELONGS TO, or null for a custom size.
 *
 * Used by the panel and the toolbar to NAME what is shown ("Primary") without
 * pretending a 17 px label is a standard size.
 */
export function roleForSize(size) {
  const value = Number(size);

  const entry = Object.entries(TEXT_ROLES).find(
    ([, role]) => role.size === value,
  );

  return entry ? entry[0] : null;
}

/*
 * THE STYLE A TOOL ASKS FOR.
 *
 * A tool states a role, never a number: `typographyFor("secondary")`. A caller
 * with a real number - a student's stored size - passes `size`, and it is
 * validated exactly as a stored size is. An unknown role falls back to the
 * default, which is what keeps a typo in a tool from producing a size nobody
 * can explain.
 */
export function typographyFor(role = "primary", overrides = {}) {
  const entry = TEXT_ROLES[role] || TEXT_ROLES.primary;
  const key = TEXT_ROLES[role] ? role : "primary";

  const size = fontSizeOf(overrides.size, entry.size);

  return {
    role: key,
    size,
    fontFamily: overrides.fontFamily || CANVAS_FONT_STACK,
    fontWeight: overrides.fontWeight || ROLE_WEIGHTS[key],
    fontStyle: overrides.fontStyle || "normal",
    lineSpacing:
      Number(overrides.lineSpacing) > 0
        ? Number(overrides.lineSpacing)
        : LINE_SPACING,
    baseline: overrides.baseline || CANVAS_BASELINE,
  };
}

/* ============================================================
 * THE RENDERER'S TWO FUNCTIONS
 * ============================================================ */

/*
 * THE ATTRIBUTES A `<text>` IS BUILT WITH.
 *
 * `x` and `y` are SCREEN coordinates - the value `engineeringToScreen` returned -
 * so the text is anchored where the drawing puts it. `font-size` is the screen
 * size MULTIPLIED BY THE ZOOM and `transform` divides it straight back out, so
 * what reaches the screen is exactly the screen size at every zoom.
 *
 * THE TRANSFORM IS ANCHORED ON THE TEXT'S OWN POINT. `translate(x y) scale(k)`
 * scales about the origin, so a point already offset from the SVG's origin
 * would be dragged towards it by `k`; translating to the anchor first and then
 * scaling about it keeps the glyphs on the anchor and divides their size by the
 * same factor. That is the difference between text that stays put and text that
 * slides across the sheet as the student zooms.
 *
 * A ZOOM OF 1 EMITS NO TRANSFORM AT ALL, so the common case is the plain
 * `<text x y font-size>` it always was, and a test that reads those attributes
 * sees the same numbers.
 */
export function textFontAttributes(typography, zoom = 1) {
  const view = Number(zoom) > 0 ? Number(zoom) : 1;
  const size = fontSizeOf(
    typography?.size ?? typography,
    DEFAULT_CANVAS_FONT_PX,
  );

  const attributes = {
    "font-size": round(size * view),
    "font-family": typography?.fontFamily || CANVAS_FONT_STACK,
    "font-weight": typography?.fontWeight || FONT_WEIGHTS.regular,
    "font-style": typography?.fontStyle || "normal",
    "dominant-baseline": typography?.baseline || CANVAS_BASELINE,
  };

  return { attributes, transform: compensationFor(view) };
}

/*
 * THE INVERSE-ZOOM COMPENSATION, or null at 1:1.
 *
 * Exported separately because a caller that rotates text (a dimension label on
 * an angled dimension, a rotated note) must COMPOSE this with its own transform
 * rather than replace it: rotation is about the same anchor point, so
 * `rotate(a) scale(1/zoom)` about the anchor keeps both properties at once.
 */
export function compensationFor(zoom = 1) {
  const view = Number(zoom) > 0 ? Number(zoom) : 1;

  return view === 1 ? null : `scale(${round(1 / view, 6)})`;
}

/*
 * THE SIZE A NODE'S ATTRIBUTE STATES, so that the camera scaling and the
 * inverse transform cancel on screen.
 *
 * The glyph is drawn inside an SVG the camera already scales by `zoom`, so its
 * `font-size` must carry that scale for `scale(1 / zoom)` to divide it back
 * out. At 1:1 this is the size itself - the attribute a test, a screenshot and
 * the source all expect.
 */
export function fontScaleForZoom(size, zoom = 1) {
  const view = Number(zoom) > 0 ? Number(zoom) : 1;
  const value = fontSizeOf(size, DEFAULT_CANVAS_FONT_PX);

  return view === 1 ? value : round(value * view, 3);
}

/*
 * THE TRANSFORM A TEXT NODE IS GIVEN: invariant to the camera.
 *
 * `at` is the projected (screen) anchor; `transform` is whatever rotation or
 * mirror the caller wants - it is applied INSIDE the translation, so it turns
 * about the anchor. The compensation is appended last, so it scales the rotated
 * glyphs without touching where they sit.
 */
export function textTransform(at, zoom = 1, transform = "") {
  const compensation = compensationFor(zoom);
  const extra = transform ? String(transform).trim() : "";

  const parts = [extra, compensation].filter(Boolean);

  /*
   * NOTHING TO COMPENSATE, BUT SOMETHING TO DO.
   *
   * A caller that asks for a ROTATED label at 100% zoom gets no compensation -
   * there is no camera scale to divide out - but it still asked for the turn,
   * and the turn has to happen about the label's own point. Returning `null`
   * there (or a bare "rotate(...)", which turns about the SVG's origin and
   * walks the text across the sheet) dropped the rotation entirely.
   */
  if (!parts.length && !extra) {
    return null;
  }

  return `translate(${round(at?.x ?? 0)} ${round(at?.y ?? 0)}) ${parts.join(" ")}`;
}

/*
 * SET A NODE'S TRANSFORM, OR CLEAR IT.
 *
 * `textTransform` returns null at 1:1 because a node that needs no transform
 * should not carry one - a test, a screenshot and the Source all expect the
 * plain `<text x y>` there. Assigning that null through `setAttribute` stores
 * the STRING "null", which is not a transform: the browser rejects it, logs
 * `Expected transform function`, and the node keeps whatever it had. The
 * attribute is removed instead, which is what "no transform" means.
 */
export function setTextTransform(node, at, zoom = 1, transform = "") {
  const value = textTransform(at, zoom, transform);

  if (!value) {
    /*
     * A NODE WITHOUT `removeAttribute` IS A STUB, NOT A BROKEN TEXT FIELD. The
     * canvas painters are exercised with plain objects in a few tests; asking
     * one for an attribute it does not implement would turn "no transform" into
     * a thrown render.
     */
    if (typeof node?.removeAttribute === "function") {
      node.removeAttribute("transform");
    }

    return null;
  }

  node.setAttribute("transform", value);

  return value;
}

/*
 * ============================================================
 * MEASUREMENT
 * ============================================================
 *
 * Every box in the application - a selection frame, a hit target, an editor
 * field, the reserved gap a dimension leaves in its own line - is estimated
 * from these two functions, so what is measured is what is drawn.
 *
 * THE ESTIMATE IS A CHARACTER-WIDTH FACTOR, not real font metrics, because the
 * same answer is needed with no DOM at all (the hit test, a headless test, the
 * source writer). It errs generous: a target slightly easier to hit than it
 * looks is a convenience, one slightly harder is a defect.
 */
export function textWidthEstimate(text, size, options = {}) {
  const lines = String(text ?? "").split("\n");

  const longest = lines.reduce(
    (max, line) => Math.max(max, String(line).length),
    0,
  );

  const factor =
    Number(options.characterWidth) > 0 ? Number(options.characterWidth) : 0.62;
  const weight = options.bold === true ? 1.06 : 1;

  return (
    Math.max(1, longest) *
    fontSizeOf(size, DEFAULT_CANVAS_FONT_PX) *
    factor *
    weight
  );
}

export function textHeightEstimate(text, size, options = {}) {
  const lines = Math.max(1, String(text ?? "").split("\n").length);
  const spacing =
    Number(options.lineSpacing) > 0
      ? Number(options.lineSpacing)
      : LINE_SPACING;

  return lines * fontSizeOf(size, DEFAULT_CANVAS_FONT_PX) * spacing;
}

/* ============================================================
 * SCREEN <-> DRAWING
 * ============================================================
 *
 * Text POSITION lives in the drawing's coordinate system and moves with it.
 * Text SIZE lives in screen pixels. These two convert a screen measurement into
 * drawing units, which is what a model needs when it has to answer "how much
 * room does this label take on the sheet at the current zoom".
 */
/* ============================================================
 * POINTS OF PAPER
 * ============================================================
 *
 * A TikZ document deals in points - 72.27 to the inch - and so does a drawing's
 * SOURCE: `\fontsize{14pt}`, `inner sep=8pt`, a node's `minimum width`. The
 * canvas deals in drawing units, one of which is one millimetre of paper.
 *
 * THIS IS THE ONE CONVERSION BETWEEN THEM. Everything that states a size in
 * points - the text field's box as much as the source that mirrors it - asks
 * here, so the picture on the sheet, the code in the Source tab and the field
 * the student types into are all quoting the SAME measurement.
 */
export const POINTS_PER_MM = 72.27 / 25.4;

/*
 * ONE DRAWING UNIT IS ONE MILLIMETRE OF PAPER, WHICH IS `POINTS_PER_MM` POINTS.
 *
 * So a length stated in points is `pt / 72.27 * 25.4` drawing units, and the
 * overlay paints a drawing unit at `BASE_PIXELS_PER_UNIT` screen pixels. The
 * two together are `pointsToPixels`, which is the only conversion a defined
 * size needs on its way to the sheet.
 */
export function pointsToDrawing(pt) {
  const value = Number(pt);

  return Number.isFinite(value) ? value / POINTS_PER_MM : 0;
}

export function drawingToPoints(units) {
  const value = Number(units);

  return Number.isFinite(value) ? value * POINTS_PER_MM : 0;
}

/* Points of paper -> the pixels the overlay paints them at, at this zoom. */
export function pointsToPixels(pt, zoom = 1) {
  const view = Number(zoom) > 0 ? Number(zoom) : 1;

  return pointsToDrawing(pt) * BASE_PIXELS_PER_UNIT * view;
}

/*
 * ============================================================
 * THE DRAWING SPACE'S TEXT FIELD
 * ============================================================
 *
 * THE BOX THE STUDENT TYPES INTO IS SIZED BY THE DRAWING, NOT BY THE SCREEN.
 *
 * It used to be sized by whatever CSS and the browser happened to produce -
 * `260px` wide, a `12px` font, `3px 5px` of padding - so it was the one piece of
 * paper in the application that did not answer to the drawing's own units: it
 * did not match the note it was writing, it was a different size from the same
 * note typed through another tool, and nothing about it could be quoted in the
 * source.
 *
 * The dimension below is a TYPED FIGURE. The TikZ source states the identical
 * box (`node text box` in `latex/source-writers/annotations.js`), so the field
 * and the compiled picture beside it agree by construction, and the student's
 * text does not jump from one size to another when it is committed.
 *
 *   width      200 pt   the starting box, widening as the student types
 *   min width  120 pt   the narrowest it becomes when it is cleared
 *   height      36 pt   ONE line; more lines make it taller, never wider
 *   font        14 pt   the Secondary canvas role, as the type itself
 *   padding  8 / 4 pt   horizontal / vertical
 *
 * WIDTH GROWS ABOUT THE INSERTION POINT. See `textEntryMetricsAt` - the box is
 * anchored on the text's own point, so it opens outwards in both directions
 * rather than dragging the words along with its left edge.
 */
export const TEXT_ENTRY_BOX_PT = Object.freeze({
  width: 200,
  height: 36,
  minWidth: 120,
  fontSize: 14,
  paddingX: 8,
  paddingY: 4,
});

/* The box in DRAWING UNITS - the unit the source states it in. */
export const TEXT_ENTRY_BOX = Object.freeze({
  width: pointsToDrawing(TEXT_ENTRY_BOX_PT.width),
  height: pointsToDrawing(TEXT_ENTRY_BOX_PT.height),
  minWidth: pointsToDrawing(TEXT_ENTRY_BOX_PT.minWidth),
  fontSize: pointsToDrawing(TEXT_ENTRY_BOX_PT.fontSize),
  paddingX: pointsToDrawing(TEXT_ENTRY_BOX_PT.paddingX),
  paddingY: pointsToDrawing(TEXT_ENTRY_BOX_PT.paddingY),
});

/*
 * THE BOX, AS THE SCREEN NEEDS IT.
 *
 * `scale` is the pixels one drawing unit is drawn at - the same
 * `BASE_PIXELS_PER_UNIT x zoom` the camera uses for geometry. The word sizes
 * are SCREEN sizes: the field's type is drawn at a canvas size (see
 * `textNode`), so its ems are pixels already and are never multiplied again.
 * The BOX, though, is a rectangle of the drawing and does scale - which is what
 * keeps it the size of the note it is writing at every magnification.
 *
 * A new box opens at its full 200 pt. A box that already holds a line of text
 * opens exactly as wide as that line, so the number beside a dimension does not
 * arrive inside a panel twelve times its own width - and never narrower than
 * the 120 pt floor.
 */
export function textEntryMetricsAt(scale, text = "") {
  const k = Number(scale) > 0 ? Number(scale) : BASE_PIXELS_PER_UNIT;

  /*
   * ONE DRAWING UNIT, IN POINTS. `k` is pixels per drawing unit, and a drawing
   * unit is a millimetre, so `POINTS_PER_MM / k` turns a stated number of
   * PIXELS back into the points the definition is stated in. The box is then
   * quoted in the drawing's own unit and painted at `k` pixels each.
   */
  const pointsPerPixel = POINTS_PER_MM / k;
  const firstLine = String(text ?? "").split("\n")[0];

  /*
   * THE TYPE, IN SCREEN PIXELS.
   *
   * 14 pt of the drawing, and that is what is drawn on screen - the field's type
   * is a canvas text size, so it is never multiplied by the camera. It is NOT
   * put through `fontSizeOf`, which CLAMPS into the role range (8-96): that is
   * for a size a student stores, and applying it to a size stated in the
   * drawing's own units inflated a 14 pt label to 96 px.
   */
  const fontSizePx = TEXT_ENTRY_BOX_PT.fontSize;

  /* One character's width, generously, as the shortest a caret needs. */
  const caret = fontSizePx * 0.62;

  const content =
    firstLine.length > 0
      ? textWidthEstimate(firstLine, fontSizePx) + caret
      : 0;

  /*
   * THE BOX AS STATED, IN POINTS OF PAPER. Empty or not, the definition is the
   * same three numbers - it is what the SOURCE states, and the field is the
   * same box the picture draws.
   */
  const widthPt = content > 0
    ? Math.max(TEXT_ENTRY_BOX_PT.minWidth, Math.min(TEXT_ENTRY_BOX_PT.width, content))
    : TEXT_ENTRY_BOX_PT.width;

  return {
    /* The definition, in points of paper - what the source states. */
    widthPt,
    heightPt: TEXT_ENTRY_BOX_PT.height,
    minWidthPt: TEXT_ENTRY_BOX_PT.minWidth,
    fontSizePt: fontSizePx,
    paddingXPt: TEXT_ENTRY_BOX_PT.paddingX,
    paddingYPt: TEXT_ENTRY_BOX_PT.paddingY,

    /* The same box in drawing units. */
    width: pointsToDrawing(widthPt),
    height: TEXT_ENTRY_BOX.height,
    minWidth: TEXT_ENTRY_BOX.minWidth,
    paddingX: TEXT_ENTRY_BOX.paddingX,
    paddingY: TEXT_ENTRY_BOX.paddingY,

    /* Screen pixels: the box scaled by the camera, the type as it is drawn. */
    widthPx: pointsToPixels(widthPt, k / BASE_PIXELS_PER_UNIT),
    heightPx: pointsToPixels(TEXT_ENTRY_BOX_PT.height, k / BASE_PIXELS_PER_UNIT),
    minWidthPx: pointsToPixels(TEXT_ENTRY_BOX_PT.minWidth, k / BASE_PIXELS_PER_UNIT),
    fontSizePx,
    paddingXPx: pointsToPixels(TEXT_ENTRY_BOX_PT.paddingX, k / BASE_PIXELS_PER_UNIT),
    paddingYPx: pointsToPixels(TEXT_ENTRY_BOX_PT.paddingY, k / BASE_PIXELS_PER_UNIT),
    lineHeightPx: fontSizePx * LINE_SPACING,

    /* What one drawn pixel is worth in points, for a caller fitting text. */
    pointsPerPixel,
  };
}

export function screenPixelsToDrawing(pixels, zoom = 1) {
  const view = Number(zoom) > 0 ? Number(zoom) : 1;

  return Number(pixels) / (BASE_PIXELS_PER_UNIT * view);
}

export function drawingToScreenPixels(units, zoom = 1) {
  const view = Number(zoom) > 0 ? Number(zoom) : 1;

  return Number(units) * BASE_PIXELS_PER_UNIT * view;
}

function round(value, places = 3) {
  const factor = 10 ** places;

  return Math.round(Number(value) * factor) / factor;
}

const enggCanvasTypography = {
  TITLE_FONT_PX,
  PRIMARY_FONT_PX,
  SECONDARY_FONT_PX,
  AUXILIARY_FONT_PX,
  TEXT_ROLES,
  CANVAS_FONT_SIZES,
  DEFAULT_CANVAS_FONT_PX,
  FONT_SIZE_CHOICES,
  FONT_PX_MIN,
  FONT_PX_MAX,
  SCRIPT_SCALE,
  CANVAS_FONT_STACK,
  MATH_FONT_STACK,
  FONT_WEIGHTS,
  ROLE_WEIGHTS,
  CANVAS_BASELINE,
  LINE_SPACING,
  normaliseFontSize,
  fontSizeOf,
  roleForSize,
  typographyFor,
  textFontAttributes,
  compensationFor,
  fontScaleForZoom,
  textTransform,
  setTextTransform,
  textWidthEstimate,
  textHeightEstimate,
  screenPixelsToDrawing,
  drawingToScreenPixels,
  POINTS_PER_MM,
  pointsToDrawing,
  drawingToPoints,
  pointsToPixels,
  TEXT_ENTRY_BOX_PT,
  TEXT_ENTRY_BOX,
  textEntryMetricsAt,
};

export default enggCanvasTypography;
