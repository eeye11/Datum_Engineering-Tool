/*
 * ============================================================
 * GRID-ALIGNED PLACEMENT
 * ============================================================
 *
 * After a sketch is finished, the student clicks where it belongs on the
 * drawing page. This module answers the one question that click asks: WHERE
 * does the geometry go, and at what scale?
 *
 * TWO GRIDS, MAPPED EXPLICITLY
 * ----------------------------
 *
 * A graph has its own coordinate grid - its axes, its origin, its tick marks.
 * The drawing page has a different one - a lattice of `grid.spacing` drawing
 * units. They are separate systems and this module is the only place they are
 * related. Nothing here assumes they are the same, and nothing here rewrites
 * one to look like the other.
 *
 * WHAT IS ALIGNED, AND WHAT IS NOT
 * --------------------------------
 *
 * A GRAPH-LIKE sketch - one with recognisable axes and ticks - is aligned by
 * its ORIGIN and its TICK SPACING:
 *
 *   the origin lands on a page-grid intersection;
 *   one graph tick becomes a whole number of page-grid cells;
 *   the scale is UNIFORM, so the graph's shape and its equal-unit
 *     relationship survive.
 *
 * A sketch WITHOUT axes is not forced into a coordinate system. It is placed
 * by its bounding-box anchor, with ordinary grid snapping on the position. No
 * origin is invented, because a line drawing has no origin to invent.
 *
 * NOTHING IS DISTORTED. The transform is a translation and, at most, a single
 * uniform scale. A graph whose tick spacing cannot be matched to the page grid
 * is placed at its own scale rather than stretched to fit.
 */

/* The smallest scale change worth applying, so a near-match is left alone. */
export const PLACEMENT_SCALE_EPSILON = 1e-3;

/* A tick ratio further than this from a whole number is not a match. */
export const PLACEMENT_TICK_TOLERANCE = 0.08;

/* ============================================================
 * THE PAGE GRID
 * ============================================================
 *
 * Read from the document's own grid settings, so placement obeys the same
 * switch the rest of the application does: a hidden grid does not snap.
 */
export function pageGridOf(state) {
  const grid = state?.grid || {};

  const spacing = Number(grid.spacing);

  const enabled =
    grid.visible !== false &&
    grid.snapToGrid !== false &&
    Number.isFinite(spacing) &&
    spacing > 0;

  return {
    enabled,
    spacing: enabled ? spacing : 0,
  };
}

/* A value, moved to the nearest page-grid line. */
export function snapToPageGrid(value, grid) {
  if (!grid?.enabled || !(grid.spacing > 0)) {
    return value;
  }

  return Math.round(value / grid.spacing) * grid.spacing;
}

/* ============================================================
 * THE SKETCH'S OWN ANCHOR
 * ============================================================
 *
 * Every sketch has a point that should land where the student clicks. For a
 * graph it is the origin; for anything else it is the bounding box's
 * bottom-left corner, which is the point a student would naturally aim with.
 */
export function boundingBoxOf(points) {
  const list = (Array.isArray(points) ? points : []).filter(
    (point) => point && Number.isFinite(point.x) && Number.isFinite(point.y),
  );

  if (!list.length) {
    return null;
  }

  const xs = list.map((point) => point.x);
  const ys = list.map((point) => point.y);

  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

/* ============================================================
 * THE GRAPH'S CALIBRATION
 * ============================================================
 *
 * What a graph-like sketch tells us about its own coordinate system: where its
 * origin is, and how far apart its ticks are. Both are read from the graph's
 * own settings, which is where the student's axes actually live - nothing is
 * inferred from the ink.
 *
 * Returns null when the graph does not carry enough information to calibrate
 * against, which is the honest answer for a sketch with no axes.
 */
export function graphCalibration(graph) {
  const geometry = graph?.geometry || {};

  if (!geometry.showXAxis && !geometry.showYAxis) {
    return null;
  }

  const xMin = Number(geometry.xMin);
  const xMax = Number(geometry.xMax);
  const yMin = Number(geometry.yMin);
  const yMax = Number(geometry.yMax);

  if (
    !Number.isFinite(xMin) ||
    !Number.isFinite(xMax) ||
    !Number.isFinite(yMin) ||
    !Number.isFinite(yMax) ||
    !(xMax > xMin) ||
    !(yMax > yMin)
  ) {
    return null;
  }

  /*
   * THE ORIGIN MUST BE IN RANGE. A graph whose axes do not cross inside its own
   * box has no visible origin to align to, and pretending it does would place
   * the graph by a point the student cannot see.
   */
  if (xMin > 0 || xMax < 0 || yMin > 0 || yMax < 0) {
    return null;
  }

  return {
    xMin,
    xMax,
    yMin,
    yMax,
    xTick:
      Number(geometry.xTickSpacing) > 0 ? Number(geometry.xTickSpacing) : null,
    yTick:
      Number(geometry.yTickSpacing) > 0 ? Number(geometry.yTickSpacing) : null,
    equalUnits: geometry.equalUnits !== false,
  };
}

/* ============================================================
 * THE PLACEMENT
 * ============================================================
 *
 * `placeSketch` is the whole contract: given a sketch, the point the student
 * clicked, and the page grid, it returns the transform to apply and a short
 * note about what was and was not aligned.
 *
 * The transform is `{ scale, dx, dy }`, applied as:
 *
 *     placed = { x: point.x * scale + dx, y: point.y * scale + dy }
 *
 * A translation and one uniform scale - never a non-uniform stretch, so the
 * sketch's shape is preserved by construction.
 */
export function placeSketch(sketch, cursor, grid) {
  const points = collectPoints(sketch);
  const box = boundingBoxOf(points);

  if (!box || !cursor) {
    return null;
  }

  const calibration = sketch?.calibration || null;

  /*
   * THE ANCHOR IS THE ORIGIN WHEN THERE IS ONE, and the bounding box's corner
   * otherwise. This is the point that lands under the cursor.
   */
  const anchor = calibration ? { x: 0, y: 0 } : { x: box.minX, y: box.minY };

  const target = grid?.enabled
    ? { x: snapToPageGrid(cursor.x, grid), y: snapToPageGrid(cursor.y, grid) }
    : { x: cursor.x, y: cursor.y };

  let scale = 1;
  let note = null;

  /*
   * TICK ALIGNMENT, ONLY WHEN THE GRAPH CAN SUPPORT IT.
   *
   * One graph tick should become a whole number of page-grid cells. The ratio
   * is rounded to the nearest whole number; if it is not close to one, the
   * graph is left at its own scale rather than stretched to fit - a graph
   * whose ticks are 3.7 cells apart is not a graph whose ticks are 4 cells
   * apart, and pretending otherwise would move every curve.
   */
  if (calibration && grid?.enabled) {
    const tick = calibration.xTick || calibration.yTick;

    if (tick > 0) {
      /*
       * THE RATIO IS TAKEN IN WHICHEVER DIRECTION GIVES A WHOLE NUMBER.
       *
       * A tick of 2 on a 10-unit grid is FIVE ticks to a cell, not a fifth of
       * a cell - so the graph is scaled UP until one cell holds five ticks.
       * A tick of 25 on the same grid is two and a half cells, which is not a
       * whole number either way, and is left alone.
       */
      const cells = tick / grid.spacing;

      if (cells >= 1) {
        /*
         * A TICK SPANS SEVERAL CELLS. One tick becomes the nearest whole
         * number of cells, so a tick of 25 on a 10-unit grid becomes 2 cells
         * (scale 0.8) and a tick of 30 becomes 3 (scale 1).
         */
        const whole = Math.round(cells);

        if (whole >= 1 && Math.abs(cells - whole) <= PLACEMENT_TICK_TOLERANCE) {
          scale = (whole * grid.spacing) / tick;
        } else {
          note =
            "Tick spacing does not match the page grid - placed at its own scale";
        }
      } else {
        /*
         * A CELL SPANS SEVERAL TICKS. One cell becomes the nearest whole
         * number of ticks, so a tick of 2 on a 10-unit grid becomes 5 ticks to
         * a cell - which means the graph is scaled UP by 2.5, so five ticks of
         * 2 span the 10 units of one cell. A tick of 4 would need 2.5 ticks to
         * a cell, which is not whole, and is left alone.
         */
        const perCell = grid.spacing / tick;
        const whole = Math.round(perCell);

        if (whole >= 1 && Math.abs(perCell - whole) <= PLACEMENT_TICK_TOLERANCE) {
          scale = (whole * tick) / grid.spacing;
        } else {
          note =
            "Tick spacing does not match the page grid - placed at its own scale";
        }
      }
    } else {
      note = "No tick spacing set - placed by its origin";
    }
  }

  /*
   * THE ANCHOR LANDS ON THE TARGET. The scale is applied about the anchor, so
   * the origin stays exactly where the student clicked and everything else
   * moves relative to it.
   */
  const dx = target.x - anchor.x * scale;
  const dy = target.y - anchor.y * scale;

  return {
    scale,
    dx,
    dy,
    anchor,
    target,
    calibration,
    snapped: Boolean(grid?.enabled),
    note,
  };
}

/* Apply a placement transform to one point. */
export function applyPlacement(point, placement) {
  if (!point || !placement) {
    return point;
  }

  return {
    x: point.x * placement.scale + placement.dx,
    y: point.y * placement.scale + placement.dy,
  };
}

/* Apply a placement transform to a list of points. */
export function applyPlacementToPoints(points, placement) {
  return (Array.isArray(points) ? points : []).map((point) =>
    applyPlacement(point, placement),
  );
}

/* Every point a sketch is made of, so its bounding box can be found. */
function collectPoints(sketch) {
  if (!sketch) {
    return [];
  }

  if (Array.isArray(sketch.points)) {
    return sketch.points;
  }

  if (Array.isArray(sketch.strokes)) {
    return sketch.strokes.flatMap((stroke) =>
      Array.isArray(stroke?.points) ? stroke.points : [],
    );
  }

  return [];
}

const enggGridPlacement = {
  PLACEMENT_SCALE_EPSILON,
  PLACEMENT_TICK_TOLERANCE,
  pageGridOf,
  snapToPageGrid,
  boundingBoxOf,
  graphCalibration,
  placeSketch,
  applyPlacement,
  applyPlacementToPoints,
};

export default enggGridPlacement;
