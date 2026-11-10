/*
 * ============================================================
 * THE SHARED AXES, GRID AND SNAPPING MODEL
 * ============================================================
 *
 * Everything about the coordinate system a student SEES and is held to, in one
 * place so every sketch tool shows the same axes and snaps by the same rules.
 *
 * WHAT IS KEPT SEPARATE, AND WHY
 * ------------------------------
 * The task is explicit that these must not be conflated, and the reason is that
 * each combination is a real thing a student means:
 *
 *     axes            the lines through zero
 *     tick marks      the little marks along them
 *     tick labels     the numbers beside the marks
 *     major grid      the lines at the major interval
 *     minor grid      the subdivisions between them
 *     snapping        what a click is pulled onto
 *
 * So "show the grid, hide the numbers" is one set of settings and not a
 * contradiction, and "snap to the grid while the grid is hidden" is another -
 * a student working on a plain sheet may still want a click to land on a round
 * number.
 *
 * EVERYTHING HERE IS IN MODEL UNITS. Grid spacing, tick intervals and snap
 * tolerance are all stated as coordinate distances, never as pixels, so zooming
 * changes how dense they LOOK and never what they mean.
 */

const DEFAULT_GRID = Object.freeze({
  showXAxis: true,
  showYAxis: true,
  showOrigin: true,

  /*
   * THE AXES ARE LABELLED BY DEFAULT.
   *
   * An axis without a label is a line; an axis with one says what it measures.
   * The arrow already shows the direction, and the letter names the quantity -
   * together they are what makes the plane readable at a glance.
   */
  showAxisLabels: true,

  /*
   * THE AXIS LABELS ARE THEIR OWN TEXT, not a fixed "x" and "y". A student
   * plotting a displacement graph writes "t" along the horizontal axis, and
   * the setting has to be able to say so rather than only whether to show a
   * hard-coded pair.
   */
  xAxisLabel: "x",
  yAxisLabel: "y",

  showTicks: true,
  tickDirection: "outside",
  tickLengthPx: 5,

  /*
   * TICK MARKS AND TICK NUMBERS ARE INDEPENDENT.
   *
   * `showTicks` draws the little marks; `showTickLabels` draws the numbers.
   * Turning the numbers off leaves the marks standing, which is the reading
   * the brief requires and the one a drafting sheet usually wants.
   */
  showMinorTicks: false,
  showTickLabels: false,
  labelPrecision: 1,
  labelFormat: "plain",

  /*
   * THE MAJOR INTERVALS, ONE PER AXIS, WITH AN OPTIONAL LINK.
   *
   * `linkXYIntervals` makes the two axes share one interval - the common case
   * for a graph on equal scales, where X and Y ticks a different distance
   * apart looks wrong. It is a CONVENIENCE, not a constraint: when it is off
   * the two intervals are independent, which is what a stretched function
   * plot needs.
   */
  majorX: 1,
  majorY: 1,
  linkXYIntervals: false,
  minorDivisions: 5,

  /*
   * THE GRID, EACH LAYER ON ITS OWN SWITCH.
   *
   * Major and minor are separate so "a faint graph paper, no subdivisions"
   * and "subdivisions only" are both sayable. `majorOpacity`/`minorOpacity`
   * exist because a grid must never read heavier than the curves drawn on it -
   * the weight is a separate decision from the style.
   */
  showMajorGrid: true,
  showMinorGrid: false,

  majorStyle: "solid",
  minorStyle: "dotted",
  majorOpacity: 1,
  minorOpacity: 1,

  snapToGrid: true,
  snapToGridMidpoints: true,
  snapToMajor: true,
  snapToMinor: false,
  snapToPoints: true,
  snapToGeometry: true,
  /*
   * THE SNAP REACH, IN PIXELS.
   *
   * Large enough that a click anywhere in the middle of a cell reaches either
   * the corner or the midpoint - which is what makes snapping feel like it is
   * helping rather than being a lottery. With midpoints on, the furthest a
   * pointer can be from SOME candidate is a quarter of a cell, so the reach
   * only has to cover that.
   */
  snapTolerancePx: 22,

  /*
   * WHETHER THE AXES, TICKS AND GRID BELONG IN THE FINAL DRAWING.
   *
   * Default FALSE: the coordinate system is how a plot is CONSTRUCTED and
   * inspected, and a student who places a graph on the sheet usually wants the
   * curve, not the graph paper. Inclusion is an explicit choice, and it is
   * deliberately independent of the preview's own visibility settings - hiding
   * the grid to see the curve must not silently drop it from the export.
   */
  includeInOutput: false,
});

/* The full setting set, with anything missing filled from the defaults. */
export function normaliseGrid(settings = {}) {
  const source = settings || {};

  const number = (value, fallback, minimum = 0) => {
    const parsed = Number(value);

    return Number.isFinite(parsed) && parsed > minimum ? parsed : fallback;
  };

  /*
   * AN OPACITY IS 0..1, AND AN ABSENT ONE IS FULL. Zero is a legitimate
   * opacity - a grid the student wants drawn but invisible - so the test is
   * whether a value was supplied, not whether it is truthy.
   */
  const clamp01 = (value, fallback) => {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback;
  };

  return {
    ...DEFAULT_GRID,
    ...source,
    tickDirection: ["inside", "outside", "both"].includes(source.tickDirection)
      ? source.tickDirection
      : DEFAULT_GRID.tickDirection,
    labelFormat: ["plain", "decimal", "scientific"].includes(source.labelFormat)
      ? source.labelFormat
      : DEFAULT_GRID.labelFormat,
    majorStyle: ["solid", "dashed", "dotted"].includes(source.majorStyle)
      ? source.majorStyle
      : DEFAULT_GRID.majorStyle,
    minorStyle: ["solid", "dashed", "dotted"].includes(source.minorStyle)
      ? source.minorStyle
      : DEFAULT_GRID.minorStyle,
    majorX: number(source.majorX, DEFAULT_GRID.majorX),

    /*
     * A LINKED PAIR TAKES ONE VALUE FOR BOTH.
     *
     * When `linkXYIntervals` is on, the X interval is the authority and Y
     * follows it. Copying X onto Y HERE - in the normaliser, rather than at
     * every reader - is what makes a linked grid actually square: a consumer
     * that reads `majorY` gets the linked value without having to know the
     * link exists. The stored `majorY` is left as it was, so turning the link
     * off restores the interval the student had chosen for Y.
     */
    majorY: source.linkXYIntervals === true
      ? number(source.majorX, DEFAULT_GRID.majorX)
      : number(source.majorY, DEFAULT_GRID.majorY),

    xAxisLabel: String(source.xAxisLabel ?? DEFAULT_GRID.xAxisLabel),
    yAxisLabel: String(source.yAxisLabel ?? DEFAULT_GRID.yAxisLabel),

    majorOpacity: clamp01(source.majorOpacity, DEFAULT_GRID.majorOpacity),
    minorOpacity: clamp01(source.minorOpacity, DEFAULT_GRID.minorOpacity),

    minorDivisions: Math.max(
      1,
      Math.min(
        50,
        Math.round(number(source.minorDivisions, DEFAULT_GRID.minorDivisions)),
      ),
    ),
    labelPrecision: Math.max(
      0,
      Math.min(
        8,
        Math.round(
          Number(source.labelPrecision ?? DEFAULT_GRID.labelPrecision),
        ),
      ),
    ),
    tickLengthPx: number(source.tickLengthPx, DEFAULT_GRID.tickLengthPx),
    snapTolerancePx: number(
      source.snapTolerancePx,
      DEFAULT_GRID.snapTolerancePx,
    ),
  };
}

/*
 * A "NICE" STEP - 1, 2, 5 or 10 times a power of ten.
 *
 * The step a grid DESERVES for a given span: one that divides it into a
 * readable number of cells and is a round number a student would choose.
 */
export function niceStep(span, target = 10) {
  if (!(span > 0) || !Number.isFinite(span)) {
    return 1;
  }

  const raw = span / Math.max(target, 1);
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  const scaled = raw / power;

  const factor = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;

  return factor * power;
}

/*
 * THE GRID INTERVAL FOR A RANGE.
 *
 * The stored interval is used when the student has set one; otherwise - or when
 * the stored one is absurd for the range - a nice step is derived from the
 * span. Without this, a sketch whose units are tiny against a 1-unit grid can
 * have only one grid line in the whole view, and there is nothing near enough
 * to snap to at any tolerance.
 */
export function gridIntervalFor(grid, bounds) {
  const settings = normaliseGrid(grid);

  const spanX = Math.abs(Number(bounds?.xMax) - Number(bounds?.xMin)) || 10;
  const spanY = Math.abs(Number(bounds?.yMax) - Number(bounds?.yMin)) || 10;

  const niceX = niceStep(spanX, 10);
  const niceY = niceStep(spanY, 10);

  /*
   * A STORED INTERVAL IS HONOURED UNLESS IT IS UNUSABLE. "Usable" means the
   * view holds between four and sixty cells - fewer than four and there is
   * almost nothing to snap to, more than sixty and the lines are a wash.
   */
  const usable = (stored, span) => {
    const cells = span / stored;

    return stored > 0 && cells >= 4 && cells <= 60;
  };

  return {
    x: usable(settings.majorX, spanX) ? settings.majorX : niceX,
    y: usable(settings.majorY, spanY) ? settings.majorY : niceY,
  };
}

/* The minor interval on each axis. */
export function minorSpacing(grid) {
  const settings = normaliseGrid(grid);

  return {
    x: settings.majorX / settings.minorDivisions,
    y: settings.majorY / settings.minorDivisions,
  };
}

/*
 * THE MODEL VALUES OF THE GRID LINES IN A RANGE.
 *
 * `step` is in model units, so the result is too. The list is capped: a range
 * that would need thousands of lines is a grid nobody can use, and drawing it
 * costs more than it is worth. The cap makes the grid DROP OUT at extreme zoom
 * rather than freeze the editor.
 */
export function gridValues(min, max, step, limit = 400) {
  if (
    !(step > 0) ||
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    !(max > min)
  ) {
    return [];
  }

  const count = (max - min) / step;

  if (count > limit) {
    return [];
  }

  const first = Math.ceil(min / step) * step;
  const values = [];

  for (let value = first; value <= max + step * 1e-6; value += step) {
    /*
     * ROUNDING AWAY FLOATING-POINT DRIFT. 0.1 * 3 is 0.30000000000000004, and a
     * grid line drawn at that is indistinguishable from one at 0.3 - but a
     * label reading "0.30000000000000004" is not.
     */
    const cleaned = Number(value.toFixed(10));

    values.push(Object.is(cleaned, -0) ? 0 : cleaned);

    if (values.length > limit) {
      break;
    }
  }

  return values;
}

/* A number formatted for a tick label, in the requested style. */
export function formatTick(value, grid) {
  const settings = normaliseGrid(grid);

  if (settings.labelFormat === "scientific" && Math.abs(value) >= 1e4) {
    return value.toExponential(settings.labelPrecision);
  }

  const rounded = Number(value.toFixed(settings.labelPrecision));

  if (settings.labelFormat === "decimal") {
    return rounded.toFixed(settings.labelPrecision);
  }

  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/*
 * THE SNAP.
 *
 * Snapping is described independently of what is drawn, because the two are
 * independent: a student may hide the grid and still expect a click to land on
 * a round number. Candidates are gathered in model units and the nearest one
 * within the tolerance wins; the tolerance is in PIXELS so it means the same
 * thing to the hand at any zoom, and it is converted here.
 *
 * Order matters: an explicit point or a piece of geometry beats a grid line,
 * because that is what the student placed on purpose.
 */
export function snapPoint(
  model,
  {
    grid = {},
    points = [],
    viewport = null,
    pointTolerance = 10,
    geometryHit = null,
  } = {},
) {
  const settings = normaliseGrid(grid);

  const toleranceModel =
    viewport && viewport.scale > 0
      ? settings.snapTolerancePx / viewport.scale
      : settings.snapTolerancePx;

  const candidates = [];

  if (settings.snapToPoints) {
    const pixelTolerance = pointTolerance;

    (Array.isArray(points) ? points : []).forEach((point) => {
      const at = point.absolute || point;

      const away = Math.hypot(at.x - model.x, at.y - model.y);

      const limit =
        viewport && viewport.scale > 0
          ? pixelTolerance / viewport.scale
          : pixelTolerance;

      if (away <= limit) {
        candidates.push({
          kind: point.type === "guide" ? "guide" : "anchor",
          x: at.x,
          y: at.y,
          away,
        });
      }
    });
  }

  if (settings.snapToGeometry && geometryHit) {
    candidates.push({
      kind: "geometry",
      x: geometryHit.x,
      y: geometryHit.y,
      away: Math.hypot(geometryHit.x - model.x, geometryHit.y - model.y),
    });
  }

  /*
   * THE INTERVAL IS THE ONE THE VIEW ACTUALLY SHOWS.
   *
   * A stored 1-unit grid over a range of 0.6 units has one line in the whole
   * view, and an 8-pixel tolerance then reaches almost nothing - so a click
   * that looked like it was near a grid line snapped to nothing at all. The
   * interval is therefore adapted to the visible range, which keeps a candidate
   * within reach at any zoom.
   */
  const interval = gridIntervalFor(
    settings,
    viewport?.visible || viewport?.bounds || null,
  );

  const minor = {
    x: interval.x / settings.minorDivisions,
    y: interval.y / settings.minorDivisions,
  };

  const snappedX = settings.snapToMinor
    ? minor.x
    : settings.snapToMajor
      ? interval.x
      : null;

  const snappedY = settings.snapToMinor
    ? minor.y
    : settings.snapToMajor
      ? interval.y
      : null;

  /*
   * MIDPOINTS REQUIRE THE GRID, BUT NOT THE OTHER WAY ROUND.
   *
   * A midpoint is half an interval of the grid, so it cannot exist without the
   * grid - turning the grid off turns midpoints off with it. A student may, of
   * course, want intersections without midpoints, which is the other toggle.
   */
  const gridOn = settings.snapToGrid;

  if (gridOn && (snappedX || snappedY)) {
    const gx = snappedX ? Math.round(model.x / snappedX) * snappedX : model.x;
    const gy = snappedY ? Math.round(model.y / snappedY) * snappedY : model.y;

    const away = Math.hypot(gx - model.x, gy - model.y);

    if (away <= toleranceModel) {
      candidates.push({ kind: "grid", x: gx, y: gy, away });
    }
  }

  /*
   * GRID MIDPOINTS - THE HALF-INTERVAL POSITIONS.
   *
   * A student placing a point often wants the middle of a cell, or the middle
   * of an edge, rather than a corner: the centre of a square, the midpoint of a
   * side. Those are the positions halfway between adjacent grid lines, and they
   * are computed from the MATHEMATICAL interval - never from pixels - so they
   * stay exact at any zoom.
   *
   * All three kinds are offered: the horizontal midpoint (x half, y on a line),
   * the vertical midpoint (x on a line, y half), and the cell centre (both
   * half). The nearest wins, and a tie goes to the intersection above, because
   * a corner is the more definite place to have meant.
   */
  if (gridOn && settings.snapToGridMidpoints && (snappedX || snappedY)) {
    const halfX = snappedX ? snappedX / 2 : null;
    const halfY = snappedY ? snappedY / 2 : null;

    const midpoints = [];

    if (halfX && halfY) {
      /* The cell centre: both coordinates halfway between lines. */
      midpoints.push({
        x: Math.round((model.x - halfX) / snappedX) * snappedX + halfX,
        y: Math.round((model.y - halfY) / snappedY) * snappedY + halfY,
      });
    }

    if (halfX) {
      /* The horizontal midpoint: x halfway, y on a line. */
      midpoints.push({
        x: Math.round((model.x - halfX) / snappedX) * snappedX + halfX,
        y: Math.round(model.y / snappedY) * snappedY,
      });
    }

    if (halfY) {
      /* The vertical midpoint: x on a line, y halfway. */
      midpoints.push({
        x: Math.round(model.x / snappedX) * snappedX,
        y: Math.round((model.y - halfY) / snappedY) * snappedY + halfY,
      });
    }

    midpoints.forEach((candidate) => {
      const away = Math.hypot(candidate.x - model.x, candidate.y - model.y);

      if (away <= toleranceModel) {
        candidates.push({ kind: "midpoint", x: candidate.x, y: candidate.y, away });
      }
    });
  }

  if (!candidates.length) {
    return { x: model.x, y: model.y, snapped: false, kind: null };
  }

  /*
   * THE RANKING, WHEN TWO CANDIDATES ARE EQUALLY CLOSE.
   *
   * A point the student placed beats a piece of geometry, which beats a grid
   * intersection, which beats a midpoint. The order is by how definite the
   * place is: an anchor is a decision, a corner is a corner, and a midpoint is
   * the least specific of the three. Distance decides first; the rank only
   * breaks a tie.
   */
  const rank = (kind) =>
    ({ anchor: 0, geometry: 1, grid: 2, midpoint: 3 })[kind] ?? 4;

  candidates.sort((a, b) => {
    const gap = a.away - b.away;

    /* A tie is a tenth of a pixel - below that, the rank decides. */
    if (Math.abs(gap) > 1e-6) {
      return gap;
    }

    return rank(a.kind) - rank(b.kind);
  });

  const best = candidates[0];

  return { x: best.x, y: best.y, snapped: true, kind: best.kind };
}

/*
 * WHETHER THE GRID SHOULD BE DRAWN AT THE CURRENT ZOOM.
 *
 * A one-unit grid at a thousand pixels per unit is a solid wash of lines, and a
 * grid whose lines are two pixels apart tells a student nothing. So the grid is
 * shown only while its lines are far enough apart to be read - which is a
 * RENDERING decision and is reported as such, never stored in the settings.
 */
export function gridRenderable(grid, viewport, { minimumSpacingPx = 6 } = {}) {
  const settings = normaliseGrid(grid);

  if (!viewport) {
    return { major: false, minor: false };
  }

  const minor = minorSpacing(settings);

  const majorPx = Math.min(
    settings.majorX * viewport.scaleX,
    settings.majorY * viewport.scaleY,
  );

  const minorPx = Math.min(
    minor.x * viewport.scaleX,
    minor.y * viewport.scaleY,
  );

  return {
    major: majorPx >= minimumSpacingPx,
    minor: minorPx >= minimumSpacingPx,
  };
}

export const SKETCH_GRID_DEFAULTS = DEFAULT_GRID;

export default {
  SKETCH_GRID_DEFAULTS,
  normaliseGrid,
  minorSpacing,
  gridValues,
  formatTick,
  snapPoint,
  gridRenderable,
};
