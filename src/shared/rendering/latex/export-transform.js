/*
 * ============================================================
 * EXPORT NORMALISATION - ONE TRANSFORM FOR EVERY DRAWING
 * ============================================================
 *
 * A DAETUM drawing is authored in millimetres: one model unit is one paper
 * millimetre, and the picture says so with `[x=1mm, y=1mm]`. That is the right
 * unit for a DRAWING SPACE - it is what makes snapping, hit testing and the
 * canvas overlay agree - but it is the wrong SIZE for a figure in a written
 * solution. A beam sketch spanning 430 units is a 430 mm figure, which is wider
 * than A4's text block by a factor of two and a half.
 *
 * The figure therefore has to be NORMALISED on the way out: the whole drawing is
 * uniformly reduced to fit the space available, and everything that has a
 * physical size - pen widths, dash lengths, arrow heads, markers, text - is
 * reduced by the SAME factor so the picture keeps its proportions.
 *
 * WHY NORMALISING THE VALUES, AND NOT `scale=` OR `\resizebox`.
 *
 * `scale=` shrinks the GEOMETRY and leaves the pen widths, heads and fonts at
 * their authored size, so a reduced figure comes out with strokes that are far
 * too heavy for it and arrow heads the size of a letter. `\resizebox` shrinks
 * the rendered result, which is right for an image and wrong for TikZ source: it
 * makes the code depend on a package, it cannot be edited by a reader, and it
 * still leaves the CROSS-REFERENCE problem of a fragment that only works inside
 * one wrapper.
 *
 * So the numbers themselves are rewritten, here, once:
 *
 *     exportX     = (x - bounds.minX) * factor
 *     exportY     = (y - bounds.minY) * factor
 *     exportWidth = nominalWidth * factor
 *     exportFont  = max(MIN_FONT_PT, nominalFont * factor)
 *
 * The ORIGINAL MODEL IS NEVER TOUCHED. This module returns a scaling CONTEXT
 * that the source writers read; they emit transformed coordinates and sizes, and
 * the object they were given is left exactly as it was. That is what makes the
 * transform safe to run on every render, on every save, and again after Undo:
 * it is a pure function of the model, so feeding it the same drawing twice
 * cannot accumulate a second reduction.
 *
 * WHY ZOOM CANNOT REACH IT. The bounds are read from MODEL-SPACE geometry only.
 * Camera zoom and pan map model space onto the SCREEN (`screenToEngineering`
 * divides by it), so no stored coordinate, no extent and no bounds calculation
 * here can see them. A drawing authored at 25% zoom and one authored at 200% -
 * the same drawing, since the student positions it in millimetres either way -
 * produce byte-identical output.
 *
 * WHAT IS *NOT* SCALED. Magnitudes, dimension values, analysis results, units,
 * colours, opacity, line caps and joins, and every semantic field of an object.
 * A force of 40 N is 40 N at any export size; only how big it is DRAWN changes.
 */

/*
 * ============================================================
 * THE NOMINAL STROKE PRESETS
 * ============================================================
 *
 * These are MODEL widths - the same scale as a numeric `lineWidth` - not print
 * points. One model width unit is `POINTS_PER_LINE_WIDTH` (2.4) points, which is
 * what makes the printed pen the same weight as the one the canvas paints; the
 * calibration lives in `tikz-style.js` with the rest of the style conversion and
 * is RE-EXPORTED here so the two tables cannot drift apart.
 *
 * THE NOMINAL TABLE NEVER CHANGES WITH THE EXPORT. The model keeps the preset
 * the student chose; the effective width is computed for the output only.
 */
export { THICKNESS_PRESETS as NOMINAL_STROKE_PRESETS, POINTS_PER_LINE_WIDTH } from "../../../tool-library/shared/primitives/tikz-style.js";

import { THICKNESS_PRESETS as NOMINAL_PRESET_TABLE } from "../../../tool-library/shared/primitives/tikz-style.js";

/*
 * The preset a stored width means.
 *
 * A style may hold the preset's NAME (`"thin"`) or a number that IS that
 * preset's nominal width (`0.4`). Both are recognised, because a saved document
 * and a tool default may carry either. Anything else is a CUSTOM width, written
 * with its own value - which is the honest answer, and the one that keeps a
 * custom width from being silently snapped to a preset.
 */
export function nominalWidthOf(value) {
  if (typeof value === "string") {
    const named = NOMINAL_PRESET_TABLE[value.toLowerCase()];

    if (named !== undefined) {
      return named;
    }

    const numeric = Number(value);

    return Number.isFinite(numeric) && numeric > 0 ? numeric : NOMINAL_PRESET_TABLE.thin;
  }

  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? number : NOMINAL_PRESET_TABLE.thin;
}

/* The preset name a nominal width is, or null when it is a custom width. */
export function presetNameOf(value) {
  const nominal = nominalWidthOf(value);

  const found = Object.entries(NOMINAL_PRESET_TABLE).find(
    ([, width]) => Math.abs(width - nominal) < 1e-9,
  );

  return found ? found[0] : null;
}

/* ============================================================
 * THE LIMITS
 * ============================================================
 *
 * The figure must fit the written document's text block. A4's default text
 * width is about 160 mm and its height is around 250 mm; these limits are
 * deliberately tighter, because a figure shares its page with prose and must not
 * dominate it. They are UPPER LIMITS: a drawing that is already smaller is left
 * exactly as authored.
 */
export const DEFAULT_MAX_WIDTH_MM = 150;
export const DEFAULT_MAX_HEIGHT_MM = 100;

/*
 * THE SMALLEST TEXT THE EXPORT WILL PRINT, in points.
 *
 * A 9pt label in a figure reduced to 35% would become 3.1pt - present in the
 * file, unreadable on the page. The floor keeps it legible, and the bounds are
 * RE-MEASURED with the floored size so a figure whose labels no longer fit is
 * reported rather than silently clipped.
 */
export const MIN_EXPORT_FONT_PT = 6;

/*
 * HOW MUCH ROOM A PEN NEEDS AROUND A FIGURE, in points, at the nominal size.
 *
 * A stroke is centred on its path, so an object's ink reaches half a pen width
 * beyond the coordinates that describe it. Arrow heads and markers reach
 * further. This is the allowance added to the geometric bounds before they are
 * fitted - and, being a length, it is NOT scaled by the export factor.
 */
export const NOMINAL_INK_ALLOWANCE_PT = 4;

/* ============================================================
 * BOUNDS
 * ============================================================
 *
 * A bounds rectangle is `{ minX, minY, maxX, maxY }` in MODEL units. Model y
 * runs UP, which is TikZ's direction too, so no axis flip is needed: the export
 * translation is `(x - minX, y - minY)` on both axes.
 */
export const EMPTY_BOUNDS = Object.freeze({ minX: 0, minY: 0, maxX: 0, maxY: 0 });

function finiteOrNull(value) {
  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

/* A rectangle around one point, or null when the point is not a point. */
export function boundsOfPoint(point) {
  const x = finiteOrNull(point?.x);
  const y = finiteOrNull(point?.y);

  return x === null || y === null ? null : { minX: x, minY: y, maxX: x, maxY: y };
}

/* The smallest rectangle containing all the given rectangles. */
export function unionBounds(rectangles) {
  let result = null;

  (Array.isArray(rectangles) ? rectangles : []).forEach((rectangle) => {
    if (!rectangle) {
      return;
    }

    const values = ["minX", "minY", "maxX", "maxY"].map((key) => finiteOrNull(rectangle[key]));

    if (values.some((value) => value === null)) {
      return;
    }

    const [minX, minY, maxX, maxY] = values;

    result = result
      ? {
          minX: Math.min(result.minX, minX),
          minY: Math.min(result.minY, minY),
          maxX: Math.max(result.maxX, maxX),
          maxY: Math.max(result.maxY, maxY),
        }
      : { minX, minY, maxX, maxY };
  });

  return result;
}

/* A rectangle grown by the same amount on every side - a pen's half width. */
export function inflateBounds(rectangle, amount) {
  if (!rectangle) {
    return null;
  }

  const grow = Math.abs(Number(amount) || 0);

  return {
    minX: rectangle.minX - grow,
    minY: rectangle.minY - grow,
    maxX: rectangle.maxX + grow,
    maxY: rectangle.maxY + grow,
  };
}

export function boundsWidth(rectangle) {
  return rectangle ? Math.max(0, rectangle.maxX - rectangle.minX) : 0;
}

export function boundsHeight(rectangle) {
  return rectangle ? Math.max(0, rectangle.maxY - rectangle.minY) : 0;
}

/* ============================================================
 * THE SCALE FACTOR
 * ============================================================
 *
 * ONE factor, from the larger of the two required reductions, so the figure is
 * never distorted: a drawing that is too wide AND too tall is reduced until
 * BOTH fit, and the axes keep their ratio.
 *
 * It is capped at 1. A drawing that already fits is drawn at the size it was
 * authored - enlarging it would claim a precision the author never gave and
 * would make one small sketch fill a page.
 */
export function exportScaleFactor(rectangle, { maxWidth = DEFAULT_MAX_WIDTH_MM, maxHeight = DEFAULT_MAX_HEIGHT_MM } = {}) {
  const width = boundsWidth(rectangle);
  const height = boundsHeight(rectangle);

  /*
   * A DEGENERATE EXTENT HAS NO SCALE OF ITS OWN.
   *
   * A single point, a horizontal line or an empty sheet has zero height (or
   * zero width). Dividing by it is an infinity, and taking it as the limiting
   * dimension would collapse the figure to nothing - so a degenerate axis is
   * simply not considered, and the other axis decides. A sheet with NO extent
   * at all is scale 1: there is nothing to fit.
   */
  const limits = [];

  if (width > 1e-9) {
    limits.push(maxWidth / width);
  }

  if (height > 1e-9) {
    limits.push(maxHeight / height);
  }

  if (!limits.length) {
    return 1;
  }

  return Math.min(1, ...limits);
}

/* ============================================================
 * THE CONTEXT THE WRITERS READ
 * ============================================================
 *
 * `transform` is a small, frozen object with the three answers a serializer
 * needs:
 *
 *     point(x, y)      the exported coordinate
 *     width(nominalPt) the exported pen width, in points
 *     font(nominalPt)  the exported text size, in points
 *
 * Everything else - dash patterns, arrow heads, marker sizes - is derived from
 * `factor` by the writer that owns it, through the helpers below, so no tool
 * invents its own conversion.
 */
export function createExportContext({
  bounds = EMPTY_BOUNDS,
  maxWidth = DEFAULT_MAX_WIDTH_MM,
  maxHeight = DEFAULT_MAX_HEIGHT_MM,
  minFontPt = MIN_EXPORT_FONT_PT,
  inkAllowancePt = NOMINAL_INK_ALLOWANCE_PT,
  unitsPerNumber = 1,
} = {}) {
  /*
   * THE BOUNDS ARE GROWN BY THE INK BEFORE THEY ARE FITTED.
   *
   * A pen is centred on its path, so the outermost stroke of a figure reaches
   * half a pen width beyond the coordinates that describe it - and a marker or
   * an arrow head reaches further still. Fitting the raw endpoints would let
   * that ink fall outside the limits. The allowance is a physical length
   * (points, at the nominal size), converted to model units and NOT scaled by
   * the factor, because it is the pen's real reach.
   */
  const allowanceModel = (Number(inkAllowancePt) || 0) * (Number(unitsPerNumber) || 1);
  const padded = bounds ? inflateBounds(bounds, allowanceModel) : EMPTY_BOUNDS;

  const factor = exportScaleFactor(padded, { maxWidth, maxHeight });

  /*
   * THE INK ALLOWANCE GROWS THE FITTING RECTANGLE, NOT THE DRAWING'S ORIGIN.
   *
   * A pen reaches half a width past its path, so the FIT must reserve that room.
   * The ORIGIN, though, is the drawing's own corner: shifting every coordinate
   * by the allowance would move a figure that is already the right size, which is
   * why at scale 1 the exported coordinates are exactly the authored ones.
   */
  const origin = {
    x: Number(bounds?.minX) || 0,
    y: Number(bounds?.minY) || 0,
  };

  const transform = {
    factor,
    bounds: { ...padded },
    sourceBounds: bounds ? { ...bounds } : { ...EMPTY_BOUNDS },
    maxWidth,
    maxHeight,
    minFontPt,

    /* Whether the export is at the drawing's authored size. */
    get identity() {
      return factor === 1;
    },

    /* One model-space point, to its exported coordinate. */
    point(x, y) {
      const px = Number(x);
      const py = Number(y);

      return {
        x: ((Number.isFinite(px) ? px : 0) - origin.x) * factor,
        y: ((Number.isFinite(py) ? py : 0) - origin.y) * factor,
      };
    },

    /* A length in model units, at the export scale. */
    length(value) {
      const number = Number(value);

      return Number.isFinite(number) ? number * factor : 0;
    },

    /*
     * A pen width, from its NOMINAL size in points.
     *
     * The argument is already in points: `tikz-style.js` converts the model's
     * `lineWidth` before asking the context for the reduction, so this is the
     * export factor only - one reduction, never two.
     */
    width(nominalPt) {
      const nominal = Number(nominalPt);

      return Number.isFinite(nominal) && nominal > 0 ? nominal * factor : 0;
    },

    /* A text size, from its NOMINAL size in points, with the readable floor. */
    font(nominalPt) {
      const nominal = Number(nominalPt);

      if (!Number.isFinite(nominal) || nominal <= 0) {
        return minFontPt;
      }

      return Math.max(minFontPt, nominal * factor);
    },

    /* Whether the readable floor is what a given text size will use. */
    fontIsFloored(nominalPt) {
      const nominal = Number(nominalPt);

      return Number.isFinite(nominal) && nominal > 0 && nominal * factor < minFontPt;
    },
  };

  return transform;
}

/* ============================================================
 * THE IDENTITY TRANSFORM
 * ============================================================
 *
 * A context that changes nothing, for a caller that has no bounds yet (a single
 * object preview, a test) and for the export of a drawing that already fits.
 * Its `factor` is 1, so `width(0.4) === 0.4` - the property every "scale 1 is
 * the nominal value" assertion rests on.
 */
export const IDENTITY_EXPORT = createExportContext();

/* ============================================================
 * SMALL HELPERS THE WRITERS SHARE
 * ============================================================ */

/* A dash pattern, from its NOMINAL lengths in points, at the export scale. */
export function scaleDashPattern(pattern, transform) {
  const lengths = Array.isArray(pattern) ? pattern : [];

  return lengths.map((length) => {
    const nominal = Number(length);

    return Number.isFinite(nominal) ? nominal * (transform?.factor ?? 1) : 0;
  });
}

/*
 * THE ARROW HEAD OPTION FOR A SCALED FIGURE.
 *
 * `->` and `-{Latex}` take the tip's DEFAULT size, which does not follow the
 * coordinates - so an arrow in a reduced figure keeps a full-size head on a
 * hairline shaft. `arrows.meta` is loaded by DAETUM's renderer, and its
 * `{Latex[length=.., width=..]}` form states the head's physical size.
 *
 * The nominal head is the TikZ default (about 2.55 mm long); scaling it by the
 * same factor keeps it in proportion to the shaft, and the `length`/`width` are
 * only written when the figure is actually reduced - at scale 1 the code is the
 * plain `->` a reader expects.
 */
export const NOMINAL_ARROW_HEAD_PT = 7.2;

export function scaledArrowTip(tip, transform) {
  const text = String(tip ?? "");

  if (!text || !transform || transform.factor >= 1) {
    return text;
  }

  const match = /^\{?([A-Za-z]+)\}?$/.exec(text);

  if (!match) {
    return text;
  }

  const length = roundNumber(NOMINAL_ARROW_HEAD_PT * transform.factor, 3);
  const width = roundNumber(length * 0.6, 3);

  return `{${match[1]}[length=${length}pt, width=${width}pt]}`;
}

/* A number with a fixed number of decimals and no trailing zeros. */
export function roundNumber(value, precision = 3) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  const rounded = Number(number.toFixed(precision));

  return Object.is(rounded, -0) ? 0 : rounded;
}

export default {
  NOMINAL_STROKE_PRESETS: NOMINAL_PRESET_TABLE,
  DEFAULT_MAX_WIDTH_MM,
  DEFAULT_MAX_HEIGHT_MM,
  MIN_EXPORT_FONT_PT,
  NOMINAL_INK_ALLOWANCE_PT,
  NOMINAL_ARROW_HEAD_PT,
  EMPTY_BOUNDS,
  nominalWidthOf,
  presetNameOf,
  boundsOfPoint,
  unionBounds,
  inflateBounds,
  boundsWidth,
  boundsHeight,
  exportScaleFactor,
  createExportContext,
  IDENTITY_EXPORT,
  scaleDashPattern,
  scaledArrowTip,
  roundNumber,
};
