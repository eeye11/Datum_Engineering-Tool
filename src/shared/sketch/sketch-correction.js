/*
 * ============================================================
 * GEOMETRIC RECONSTRUCTION
 * ============================================================
 *
 * One freehand stroke in, clean MATHEMATICAL geometry out. This is the shared
 * solver every sketch tool uses, and it is the heart of the editor.
 *
 * THE PRINCIPLE
 * -------------
 * The student's stroke is the fitting reference. It says where the shape goes,
 * in far more detail than any set of reference points could, so the solver
 * reads it and reconstructs what it was trying to be:
 *
 *     a shaky line        -> an exact line
 *     a rough circle      -> an exact circle
 *     a swept arc         -> an exact arc
 *     a wobbly curve      -> a Bezier chain (piecewise polynomial)
 *     a box drawn by hand -> four exact lines with real corners
 *
 * THE THREE OUTCOMES ARE GEOMETRIC, NOT COSMETIC.
 *
 *   line       a two-point segment on the least-squares direction of the ink;
 *   circle/arc a TRUE circle or arc - centre, radius and angles, fitted by
 *              Gauss-Newton on the ink, not sampled into a spline;
 *   curve      a chain of cubic Beziers, least-squares fitted to each span
 *              with the ends FIXED, so the curve passes through its own
 *              vertices and follows the stroke between them.
 *
 * The circle test is deliberately the STRICTEST primitive: a stroke is only a
 * circle when its radius error is small RELATIVE TO ITS RADIUS, so a curve that
 * merely happens to be round is not painted into a circle. A line is tested
 * before a curve, because a curve can approximate anything and would otherwise
 * always win.
 *
 * WHAT AN ANCHOR DOES, AND DOES NOT DO
 * ------------------------------------
 * An anchor is EXACT and the solver may not move it - but only for geometry it
 * is ASSOCIATED with. Association is explicit (see `anchorsForGeometry` in
 * `sketch-points.js`): a point placed on the element, listed by it, or chosen
 * as its centre. An unrelated point is not a constraint, is not an endpoint,
 * and is not a boundary: the stroke may be drawn before the first one, after
 * the last one, or nowhere near any of them.
 *
 * When an anchor makes a primitive impossible, the primitive is REJECTED and
 * the conflict reported - never resolved by moving the point, and never by
 * clipping the stroke to the span between anchors.
 *
 * HOW IT WORKS
 * ------------
 *
 *   1. SPLIT. The stroke is divided at its corners - the places where the
 *      direction changes sharply - and at the curvature breaks that separate a
 *      straight run from a curved one, because a single gesture is often
 *      several shapes. A rounded corner is not a corner, so the splitter looks
 *      at the turn over a window rather than between adjacent samples.
 *
 *   2. CLASSIFY EACH SEGMENT. Every piece is tested against the primitives it
 *      could be, and scored by how far it strays as a SHARE OF ITS OWN SIZE.
 *      A share is what makes the thresholds mean the same thing on a small
 *      sketch and a large one, at any zoom. THE ORDER IS DELIBERATE AND IS
 *      PART OF THE ANSWER:
 *
 *         circle   closed, and every point the same distance from one centre;
 *         ellipse  closed, and two axes that differ by more than a circle can
 *                  excuse;
 *         arc      open, a real net sweep of at least a quarter turn, and a
 *                  radius in reach of the run's own size;
 *         line     straight to within the hand's tremor, and not better
 *                  explained by a circle;
 *         curve    everything else, as a least-squares Bezier chain.
 *
 *      A circle is never assumed from roundness alone: the test is the radius
 *      error as a share of the RADIUS, which is the only scale on which
 *      circularity means anything.
 *
 *   3. FIT. The winning primitive is fitted by its own mathematics - total
 *      least squares for a line, Kasa plus Gauss-Newton for a circle, a conic
 *      for an ellipse, a least-squares cubic chain for a curve.
 *
 *   4. CONSTRAIN. Associated anchors are pinned into the result, in stroke
 *      order, and the shape between them is kept from the stroke.
 *
 *   5. JOIN. Segments share their endpoints exactly, so a reconstructed shape
 *      has no gaps and no doubled corners.
 *
 *   6. ANALYSE. A general curve is classified by the SIGN OF ITS DERIVATIVES -
 *      increasing/decreasing and concave up/down, with turning points and
 *      inflection points where they exist. Closed and vertical geometry is
 *      reported as not a function of x rather than being forced into a trend.
 *      The analysis lives in `sketch-curve-analysis.js`; this module only
 *      stores its answer on the result so the inspector and a saved sketch see
 *      the same classification.
 *
 * WHAT IS NOT DONE
 * ----------------
 * Nothing is "smoothed" in the cosmetic sense. A curve is smooth because it is
 * a Bezier chain through clean vertices, not because its line was blurred. The
 * original stroke is always kept, so restoring it is a property of the result.
 */

import {
  resolvePoints,
  anchorPoints,
  anchorsForGeometry,
  centrePointFor,
} from "./sketch-points.js";
import {
  fitCubicChain,
  analyseTrend,
  curveSamplePoints,
} from "./sketch-curve-analysis.js";

const EPSILON = 1e-9;

/* ============================================================
 * THRESHOLDS
 * ============================================================
 *
 * Every one is a SHARE of the stroke's own size, never a distance in drawing
 * units - which is what makes the same numbers work for a 2-unit sketch and a
 * 200-unit one, and at any zoom.
 */

/* A segment is straight when it strays less than this share of its length. */
const LINE_TOLERANCE = 0.022;

/*
 * THE CIRCLE TEST IS THE STRICTEST ONE.
 *
 * A circle is a very specific claim about a stroke - every point the same
 * distance from one centre - and a generous tolerance lets a rounded curve be
 * reported as a circle nobody drew. The tolerance is checked against the RADIUS
 * (an error of 4% of the radius, not of the stroke's bounding box), which is
 * the only scale on which circularity means anything.
 */
const CIRCLE_TOLERANCE = 0.04;

/* An open stroke is an arc when its radius error is under this share. */
const ARC_TOLERANCE = 0.035;

/*
 * A CLOSED STROKE MUST ACTUALLY CLOSE, AND MUST ACTUALLY ENCIRCLE SOMETHING.
 *
 * The closure is measured as the gap between the ends over the perimeter, and
 * the radius must be a sensible share of the stroke's own length - a tiny loop
 * at the end of a long stroke is not a circle drawn over the whole stroke.
 */
const MIN_CIRCLE_RADIUS_SHARE = 0.08;

/*
 * HOW CLOSE TO AN AXIS A LINE MUST BE BEFORE ITS DIRECTION IS SNAPPED TO IT.
 *
 * Two degrees. A hand-drawn level line is within that; a deliberate shallow
 * slope is not, and keeps its own direction.
 */
const LINE_AXIS_SNAP = (2 * Math.PI) / 180;

/*
 * HOW FAR BEYOND ITS OWN CHORD AN ARC'S RADIUS MAY REACH.
 *
 * A quarter turn is the shallowest sweep a student is likely to have MEANT as an
 * arc, and its radius is 1/sin(45°) = 1.41 chords. Two chords allows for a
 * hand that swept a little less than that and draws the line well below a hump's
 * fitted circle (which is 2.2 chords or more).
 */
const MAX_ARC_RADIUS_CHORDS = 2;

/* An ellipse is preferred over a circle when its axes differ by more than this. */
const ELLIPSE_AXIS_RATIO = 1.12;

/* A closed stroke closes when its ends are within this share of its perimeter. */
const CLOSURE_TOLERANCE = 0.12;

/*
 * A turn sharper than this (radians) is a corner.
 *
 * The threshold is generous because the WINDOW is what does the real work: a
 * hand-drawn circle turns steadily, and over a long window that steady turn is
 * a small angle. A drawn corner turns all at once and stays large however wide
 * the window is. Setting the angle too low made every tremor a corner and cut
 * a circle into seven pieces.
 */
const CORNER_ANGLE = 0.95;

/*
 * THE WINDOW, AS A SHARE OF THE STROKE'S LENGTH.
 *
 * A fixed number of SAMPLES is the wrong unit: a stroke sampled densely has
 * many samples per unit of length, so a four-sample window is a tiny piece of
 * the shape and the shape's own curvature registers as a corner. The window is
 * therefore a share of the stroke's LENGTH, converted to samples through the
 * stroke's own sampling density - so it covers the same piece of the drawing
 * however densely it was sampled.
 */
const CORNER_WINDOW_SHARE = 0.12;

/* The window never shrinks below this many samples, nor grows past that. */
const CORNER_WINDOW_MIN = 6;
const CORNER_WINDOW_MAX = 40;

/* A segment shorter than this share of the stroke is absorbed into its neighbour. */
const MIN_SEGMENT_SHARE = 0.06;

/*
 * WHERE CURVATURE BREAKS A STROKE INTO PIECES.
 *
 * A corner is a change of DIRECTION; a curvature break is a change of BENDING
 * with no change of direction - a straight run flowing into an arc, or an arc
 * into a flatter curve. Those are real changes of shape and must be segmented,
 * or a mixed stroke is fitted with one primitive that is wrong for both halves.
 *
 * The break is measured on the TURNING PER UNIT LENGTH over the same window a
 * corner uses, so it is scale-free.
 */
const CURVATURE_BREAK_RATIO = 2.6;

/* ============================================================
 * SMALL HELPERS
 * ============================================================ */

function finite(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
}

function distance(a, b) {
  return Math.hypot(finite(a?.x) - finite(b?.x), finite(a?.y) - finite(b?.y));
}

function copyPoint(point) {
  return { x: finite(point?.x), y: finite(point?.y) };
}

function polylineOf(stroke) {
  const raw = Array.isArray(stroke) ? stroke : stroke?.points;

  return (Array.isArray(raw) ? raw : []).filter(
    (point) =>
      point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)),
  );
}

function lengthOf(points) {
  return points.reduce(
    (sum, point, index) => (index ? sum + distance(points[index - 1], point) : 0),
    0,
  );
}

/* The stroke's own size: the larger of its extent and a share of its length. */
function sizeOf(points) {
  if (!points.length) {
    return EPSILON;
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);

  return Math.max(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
    lengthOf(points) / 4,
    EPSILON,
  );
}

/* ============================================================
 * PRIMITIVES
 * ============================================================ */

/*
 * TOTAL LEAST SQUARES LINE.
 *
 * Ordinary least squares minimises vertical error, which is useless for a
 * vertical line - exactly the case a sketch has plenty of. Total least squares
 * minimises the perpendicular distance, so it has no preferred axis.
 */
export function fitLine(points) {
  const list = points.length ? points : [{ x: 0, y: 0 }];

  const meanX = list.reduce((sum, point) => sum + point.x, 0) / list.length;
  const meanY = list.reduce((sum, point) => sum + point.y, 0) / list.length;

  let xx = 0;
  let xy = 0;
  let yy = 0;

  list.forEach((point) => {
    const dx = point.x - meanX;
    const dy = point.y - meanY;

    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  });

  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);

  const direction = { x: Math.cos(angle), y: Math.sin(angle) };

  const residuals = list.map((point) =>
    Math.abs((point.x - meanX) * direction.y - (point.y - meanY) * direction.x),
  );

  return {
    origin: { x: meanX, y: meanY },
    direction,
    angle,
    worst: Math.max(...residuals),
    average: residuals.reduce((sum, value) => sum + value, 0) / residuals.length,
  };
}

/* Where a point projects onto a line. */
function onLine(point, origin, direction) {
  const along =
    (point.x - origin.x) * direction.x + (point.y - origin.y) * direction.y;

  return {
    x: origin.x + direction.x * along,
    y: origin.y + direction.y * along,
  };
}

/*
 * A LEAST-SQUARES CIRCLE - Kasa's algebraic fit, refined by Gauss-Newton.
 *
 * The algebraic fit alone is biased toward small arcs; the refinement is what
 * keeps a nearly-full circle honest.
 */
export function fitCircle(points) {
  const list = points.filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  );

  if (list.length < 3) {
    return null;
  }

  const meanX = list.reduce((sum, point) => sum + point.x, 0) / list.length;
  const meanY = list.reduce((sum, point) => sum + point.y, 0) / list.length;

  let suu = 0;
  let svv = 0;
  let suv = 0;
  let suuu = 0;
  let svvv = 0;
  let suvv = 0;
  let svuu = 0;

  list.forEach((point) => {
    const u = point.x - meanX;
    const v = point.y - meanY;

    suu += u * u;
    svv += v * v;
    suv += u * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  });

  const det = suu * svv - suv * suv;

  if (Math.abs(det) < EPSILON) {
    return null;
  }

  const uc = (svv * (suuu + suvv) - suv * (svvv + svuu)) / (2 * det);
  const vc = (suu * (svvv + svuu) - suv * (suuu + suvv)) / (2 * det);

  let centre = { x: uc + meanX, y: vc + meanY };

  let radius =
    list.reduce((sum, point) => sum + distance(point, centre), 0) / list.length;

  /*
   * GAUSS-NEWTON, PROPERLY.
   *
   * The algebraic fit is biased on a short arc - a half circle comes back with
   * a radius a third too small - and a few ad-hoc nudges do not remove that
   * bias. This is the real iteration: the residual of each point is
   * (distance - radius), and the Jacobian is the unit vector from the centre
   * plus the radius term. Solving the 3x3 normal equations each step moves the
   * centre and radius together, which is what makes a half circle converge to
   * its true circle.
   */
  for (let step = 0; step < 12; step += 1) {
    let jtj = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];

    const jtr = [0, 0, 0];

    list.forEach((point) => {
      const dx = point.x - centre.x;
      const dy = point.y - centre.y;
      const r = Math.max(Math.hypot(dx, dy), EPSILON);

      const residual = r - radius;

      /* d(residual)/d(cx), d/d(cy), d/d(radius) */
      const row = [-dx / r, -dy / r, -1];

      for (let i = 0; i < 3; i += 1) {
        jtr[i] += row[i] * residual;

        for (let j = 0; j < 3; j += 1) {
          jtj[i][j] += row[i] * row[j];
        }
      }
    });

    const delta = solve3(jtj, jtr.map((value) => -value));

    if (!delta) {
      break;
    }

    centre = { x: centre.x + delta[0], y: centre.y + delta[1] };
    radius = Math.max(radius + delta[2], EPSILON);

    if (Math.abs(delta[0]) + Math.abs(delta[1]) + Math.abs(delta[2]) < 1e-10) {
      break;
    }
  }

  const residuals = list.map((point) => Math.abs(distance(point, centre) - radius));

  return {
    centre,
    radius,
    worst: Math.max(...residuals),
    average: residuals.reduce((sum, value) => sum + value, 0) / residuals.length,
  };
}

/*
 * AN AXIS-ALIGNED ELLIPSE, by least squares on the conic
 *     A x^2 + B y^2 + C x + D y = 1
 *
 * A rotated ellipse needs a full conic fit, which is unstable on a short arc
 * and produces a hyperbola as often as an ellipse. An axis-aligned fit is
 * stable, is what a hand-drawn ellipse almost always is, and is honest about
 * its own limit: a clearly rotated ellipse falls back to a curve rather than
 * being forced into a wrong conic.
 */
export function fitEllipse(points) {
  const list = points.filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  );

  if (list.length < 5) {
    return null;
  }

  /* Normal equations for the four unknowns. */
  const m = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];

  const v = [0, 0, 0, 0];

  list.forEach((point) => {
    const row = [point.x * point.x, point.y * point.y, point.x, point.y];

    for (let i = 0; i < 4; i += 1) {
      v[i] += row[i];

      for (let j = 0; j < 4; j += 1) {
        m[i][j] += row[i] * row[j];
      }
    }
  });

  const solved = solve4(m, v);

  if (!solved) {
    return null;
  }

  const [a, b, c, d] = solved;

  if (!(a > 0) || !(b > 0)) {
    return null;
  }

  const centre = { x: -c / (2 * a), y: -d / (2 * b) };

  const constant = 1 + (c * c) / (4 * a) + (d * d) / (4 * b);

  const radiusX = Math.sqrt(constant / a);
  const radiusY = Math.sqrt(constant / b);

  if (!Number.isFinite(radiusX) || !Number.isFinite(radiusY)) {
    return null;
  }

  const residuals = list.map((point) => {
    const u = (point.x - centre.x) / radiusX;
    const w = (point.y - centre.y) / radiusY;

    return Math.abs(Math.hypot(u, w) - 1) * Math.min(radiusX, radiusY);
  });

  return {
    centre,
    radiusX,
    radiusY,
    rotation: 0,
    worst: Math.max(...residuals),
    average: residuals.reduce((sum, value) => sum + value, 0) / residuals.length,
  };
}

/* Gaussian elimination for a 3x3 system, or null if it is singular. */
function solve3(matrix, vector) {
  const a = matrix.map((row, index) => [...row, vector[index]]);

  for (let column = 0; column < 3; column += 1) {
    let pivot = column;

    for (let row = column + 1; row < 3; row += 1) {
      if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) {
        pivot = row;
      }
    }

    if (Math.abs(a[pivot][column]) < 1e-12) {
      return null;
    }

    [a[column], a[pivot]] = [a[pivot], a[column]];

    for (let row = 0; row < 3; row += 1) {
      if (row === column) {
        continue;
      }

      const factor = a[row][column] / a[column][column];

      for (let k = column; k <= 3; k += 1) {
        a[row][k] -= factor * a[column][k];
      }
    }
  }

  return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
}

/* Gaussian elimination for a 4x4 system, or null if it is singular. */
function solve4(matrix, vector) {
  const a = matrix.map((row, index) => [...row, vector[index]]);

  for (let column = 0; column < 4; column += 1) {
    let pivot = column;

    for (let row = column + 1; row < 4; row += 1) {
      if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) {
        pivot = row;
      }
    }

    if (Math.abs(a[pivot][column]) < 1e-12) {
      return null;
    }

    [a[column], a[pivot]] = [a[pivot], a[column]];

    for (let row = 0; row < 4; row += 1) {
      if (row === column) {
        continue;
      }

      const factor = a[row][column] / a[column][column];

      for (let k = column; k <= 4; k += 1) {
        a[row][k] -= factor * a[column][k];
      }
    }
  }

  return [a[0][4] / a[0][0], a[1][4] / a[1][1], a[2][4] / a[2][2], a[3][4] / a[3][3]];
}

/* ============================================================
 * SEGMENTATION
 * ============================================================ */

/*
 * WHERE DOES THE STROKE TURN A CORNER?
 *
 * A corner is a real change of direction, not the tremor between two samples.
 * So the turn is measured over a WINDOW on each side: the direction of the
 * stroke a few samples before against a few samples after. A rounded corner
 * turns gradually and never exceeds the threshold; a drawn corner turns all at
 * once and does.
 *
 * The window is a share of the stroke's length, so a long stroke and a short
 * one are judged the same way.
 */
export function findCorners(points) {
  /*
   * THE WINDOW IN SAMPLES, FROM THE STROKE'S OWN DENSITY.
   *
   * `length / (samples - 1)` is the average distance between samples, so the
   * window covers a fixed SHARE OF THE DRAWING rather than a fixed number of
   * points - which is what makes a densely-sampled stroke and a sparse one
   * judged the same way.
   */
  const spacing = lengthOf(points) / Math.max(points.length - 1, 1);

  const window = Math.max(
    CORNER_WINDOW_MIN,
    Math.min(
      CORNER_WINDOW_MAX,
      Math.round((lengthOf(points) * CORNER_WINDOW_SHARE) / Math.max(spacing, EPSILON)),
    ),
  );

  if (points.length < window * 2 + 1) {
    return [];
  }

  const corners = [];

  /*
   * A CLOSED STROKE IS JUDGED AS A LOOP.
   *
   * On a closed stroke the samples either side of the seam are the SAME part of
   * the shape, so a window that runs off one end must wrap to the other. Read
   * without wrapping, the seam looks like a sharp turn - which is how a clean
   * ellipse acquired a corner at its starting point and was cut in two.
   */
  const closed = closureGap(points) <= CLOSURE_TOLERANCE;

  const at = (index) => {
    if (!closed) {
      return points[Math.max(0, Math.min(points.length - 1, index))];
    }

    const wrapped = ((index % points.length) + points.length) % points.length;

    return points[wrapped];
  };

  /*
   * A CORNER IS A SHARP TURN, NOT A STEADY ONE.
   *
   * The turn across the window is compared with the turn across a SHORT window
   * at the same place. A drawn corner turns almost all at once, so the two are
   * nearly equal. A smooth curve turns steadily, so the short window sees only
   * a fraction of the long one's turn - and that ratio is what separates the
   * two. Without it, the apex of a smooth arc registered as a corner and the
   * curve was cut in half at its own highest point.
   */
  const short = Math.max(2, Math.round(window / 4));

  const turnBetween = (from, to) => {
    const a = at(from);
    const b = at(to);

    return Math.atan2(b.y - a.y, b.x - a.x);
  };

  const angleGap = (a, b) => {
    let gap = Math.abs(a - b);

    if (gap > Math.PI) {
      gap = Math.PI * 2 - gap;
    }

    return gap;
  };

  for (let index = window; index < points.length - window; index += 1) {
    const turn = angleGap(turnBetween(index - window, index), turnBetween(index, index + window));

    const local = angleGap(
      turnBetween(index - short, index),
      turnBetween(index, index + short),
    );

    /*
     * `local / turn` is how concentrated the turn is. A corner is above 0.6; a
     * smooth curve's own turning is well below it.
     */
    const concentrated = turn > EPSILON ? local / turn : 0;

    if (turn >= CORNER_ANGLE && concentrated >= 0.6) {
      /* Keep the sharpest sample of a run of turns, not every one of them. */
      const last = corners[corners.length - 1];

      if (last && index - last.index <= window) {
        if (turn > last.turn) {
          corners[corners.length - 1] = { index, turn };
        }
      } else {
        corners.push({ index, turn });
      }
    }
  }

  return corners.map((corner) => corner.index);
}

/*
 * WHERE THE STROKE STOPS BEING ONE KIND OF SHAPE AND BECOMES ANOTHER.
 *
 * A corner is a change of DIRECTION; these are the places where the BENDING
 * changes while the direction does not - a straight run flowing into an arc,
 * or a gentle arc becoming a tighter one. Without them, a stroke of
 * "straight, then curved, then straight" is one piece, and no primitive can
 * describe it: the fitter either calls the whole thing a curve (and bends the
 * straight parts) or a line (and flattens the curve).
 *
 * The measure is the turning rate - total turn over distance - taken over the
 * same window a corner uses. A ratio of consecutive rates above the threshold
 * is a break, which is scale-free: a small sketch and a large one break in
 * the same places.
 */
export function findCurvatureBreaks(points, options = {}) {
  const list = Array.isArray(points) ? points : [];

  const spacing = lengthOf(list) / Math.max(list.length - 1, 1);

  const window = Math.max(
    CORNER_WINDOW_MIN,
    Math.min(
      CORNER_WINDOW_MAX,
      Math.round((lengthOf(list) * CORNER_WINDOW_SHARE) / Math.max(spacing, EPSILON)),
    ),
  );

  if (list.length < window * 2 + 1) {
    return [];
  }

  const ratio = Number(options.curvatureBreakRatio) || CURVATURE_BREAK_RATIO;

  const turnBetween = (from, to) => {
    const a = list[Math.max(0, Math.min(list.length - 1, from))];
    const b = list[Math.max(0, Math.min(list.length - 1, to))];

    return Math.atan2(b.y - a.y, b.x - a.x);
  };

  const angleGap = (a, b) => {
    let gap = Math.abs(a - b);

    if (gap > Math.PI) {
      gap = Math.PI * 2 - gap;
    }

    return gap;
  };

  const turns = list.map((_, index) => {
    const from = Math.max(0, index - window);
    const to = Math.min(list.length - 1, index + window);

    return angleGap(turnBetween(from, index), turnBetween(index, to));
  });

  /*
   * A BREAK IS SUSTAINED, NOT A SPIKE.
   *
   * The rates either side are medians of the window's own turning, so one
   * jittery sample cannot manufacture a break - which is what turned smooth
   * curves into hundreds of pieces in the previous splitter.
   */
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);

    return sorted[Math.floor(sorted.length / 2)] || 0;
  };

  const breaks = [];

  for (let index = window; index < list.length - window; index += 1) {
    const before = turns.slice(Math.max(0, index - window), index);
    const after = turns.slice(index + 1, Math.min(list.length, index + window + 1));

    const beforeRate = median(before);
    const afterRate = median(after);

    const low = Math.min(beforeRate, afterRate);
    const high = Math.max(beforeRate, afterRate);

    if (high <= EPSILON) {
      continue;
    }

    if (high / Math.max(low, EPSILON) < ratio) {
      continue;
    }

    /*
     * NOISE IS NOT A CHANGE OF SHAPE.
     *
     * The rate either side must be a real turn: a hand's tremor on a straight
     * run produces a large RATIO between two tiny rates, which is not a
     * curvature break at all. The floor is in radians per window, so it is the
     * same on a small sketch and a large one.
     */
    if (high < 0.08) {
      continue;
    }

    /*
     * AND THE TWO SIDES MUST REALLY DIFFER. A steady curve whose bending
     * drifts a little is one shape; a straight run meeting an arc is two. The
     * flat side must be near-flat AND the turning side must turn for real.
     */
    if (Math.min(beforeRate, afterRate) > 0.05) {
      continue;
    }

    const last = breaks[breaks.length - 1];

    if (last && index - last.index <= window) {
      if (high > last.high) {
        breaks[breaks.length - 1] = { index, high };
      }
    } else {
      breaks.push({ index, high });
    }
  }

  return breaks.map((entry) => entry.index);
}

/* The stroke cut at its corners and curvature breaks, each piece including both ends. */
export function splitAtCorners(points, options = {}) {
  const corners = [
    ...findCorners(points),
    ...(options.curvatureBreaks === false
      ? []
      : findCurvatureBreaks(points, options)),
  ]
    .filter((index, position, all) => all.indexOf(index) === position)
    .sort((a, b) => a - b);

  if (!corners.length) {
    return [points];
  }

  const cuts = [0, ...corners, points.length - 1];

  const segments = [];

  for (let index = 0; index < cuts.length - 1; index += 1) {
    const from = cuts[index];
    const to = cuts[index + 1];

    if (to - from >= 1) {
      segments.push(points.slice(from, to + 1));
    }
  }

  /*
   * A TINY SEGMENT IS NOT A SHAPE. A corner detected one sample from the end
   * would otherwise produce a two-point "segment" that is really part of its
   * neighbour, so short pieces are merged back in.
   */
  const total = lengthOf(points);
  const minimum = total * MIN_SEGMENT_SHARE;

  const merged = [];

  segments.forEach((segment) => {
    const last = merged[merged.length - 1];

    if (last && lengthOf(segment) < minimum) {
      merged[merged.length - 1] = [...last, ...segment.slice(1)];
      return;
    }

    merged.push(segment);
  });

  return merged.length ? merged : [points];
}

/* ============================================================
 * CLASSIFICATION
 * ============================================================ */

/* The smallest angle between two directions, in radians. */
function angleDifference(a, b) {
  let gap = Math.abs(a - b);

  while (gap > Math.PI) gap = Math.abs(gap - Math.PI * 2);

  return gap;
}

/* Whether a stroke closes on itself, as a share of its length. */
export function closureGap(points) {
  if (points.length < 3) {
    return Infinity;
  }

  const perimeter = lengthOf(points);

  if (perimeter < EPSILON) {
    return Infinity;
  }

  return distance(points[0], points[points.length - 1]) / perimeter;
}

/*
 * WHAT IS THIS SEGMENT?
 *
 * Each candidate is scored by its residual as a SHARE of the segment's size,
 * and the best one that clears its threshold wins. The order matters: a circle
 * is tested before a curve, because a curve can approximate anything and would
 * otherwise always win.
 */
export function classifySegment(points, options = {}) {
  const list = points.filter(Boolean);

  if (list.length < 2) {
    return { kind: "curve", points: list.map(copyPoint), confidence: 0 };
  }

  const span = Math.max(lengthOf(list), EPSILON);

  const closed = closureGap(list) <= (options.closureTolerance ?? CLOSURE_TOLERANCE);

  /* ---- circle / ellipse, for a closed segment ---- */
  if (closed && list.length >= 5) {
    /*
     * A CIRCLE MUST ENCIRCLE A MEANINGFUL PART OF THE STROKE.
     *
     * A tiny loop drawn at the end of a long stroke fits a circle perfectly and
     * is not what the student drew. The fitted radius is compared with the
     * stroke's own extent, so a loop that is a detail of a larger shape is left
     * as part of that shape rather than promoted to a circle.
     */
    const circle = fitCircle(list);

    if (circle) {
      const error = circle.worst / Math.max(circle.radius, EPSILON);

      const size = sizeOf(list);

      const surrounds = circle.radius >= size * MIN_CIRCLE_RADIUS_SHARE;

      if (error <= (options.circleTolerance ?? CIRCLE_TOLERANCE) && surrounds) {
        return {
          kind: "circle",
          centre: circle.centre,
          radius: circle.radius,
          confidence: 1 - error / CIRCLE_TOLERANCE,
          points: circleSample(circle),
          closed: true,
        };
      }
    }

    const ellipse = fitEllipse(list);

    if (ellipse) {
      const ratio =
        Math.max(ellipse.radiusX, ellipse.radiusY) /
        Math.max(Math.min(ellipse.radiusX, ellipse.radiusY), EPSILON);

      const error = ellipse.worst / Math.max(ellipse.radiusX, ellipse.radiusY, EPSILON);

      if (ratio >= ELLIPSE_AXIS_RATIO && error <= CIRCLE_TOLERANCE * 1.6) {
        return {
          kind: "ellipse",
          centre: ellipse.centre,
          radiusX: ellipse.radiusX,
          radiusY: ellipse.radiusY,
          rotation: ellipse.rotation,
          confidence: 1 - error / (CIRCLE_TOLERANCE * 1.6),
          points: ellipseSample(ellipse),
          closed: true,
        };
      }
    }
  }

  /* ---- arc, for an open segment ---- */
  if (!closed && list.length >= 5) {
    const circle = fitCircle(list);

    if (circle) {
      const error = circle.worst / Math.max(circle.radius, EPSILON);

      /*
       * AN ARC MUST ACTUALLY SWEEP. A short, nearly-straight piece of a huge
       * circle fits a circle perfectly and is not an arc - it is a line, and
       * the line test below is the honest answer for it.
       */
      const sweep = arcSweep(list, circle.centre);

      /*
       * AN ARC MUST SWEEP, AND SWEEP EVENLY.
       *
       * `sweep.sweep` is the total angle turned about the fitted centre. A
       * gentle S-curve also fits a circle reasonably well - its points are all
       * about the same distance from some centre - but it turns one way and
       * then the other, so its NET sweep is near zero while its total turning
       * is large. Requiring a real net sweep is what separates an arc from a
       * curve that merely happens to be round-ish. A quarter of a turn is the
       * least that is recognisably part of a circle: a shallower bend is the
       * general curve it looks like, not an arc nobody drew.
       */
      /*
       * AN ARC LOOKS LIKE A RING, NOT LIKE A BOW.
       *
       * The fitted radius and the chord between the arc's ends say which it is.
       * A handwritten arc has a radius comparable with its own chord (a
       * semicircle's radius is half of it, a quarter-arc's about seven tenths);
       * a hump fitted with a circle gets a radius well beyond its chord, because
       * its centre is far below the ink. `MAX_ARC_RADIUS_CHORDS` is the line
       * between the two, stated once at the top of this file.
       */
      const chord = distance(list[0], list[list.length - 1]);

      /*
       * A SALIENT ARC'S RADIUS IS NOT SHORTER THAN ITS OWN CHORD, AND A BOW'S
       * IS ALWAYS LONGER.
       *
       * The sagitta of a circular arc is r(1 - cos(sweep/2)). Once an arc
       * sweeps past a half turn, HALF ITS CHORD - the distance from the chord's
       * midpoint to the ink - is its radius again, so a hump that is slightly
       * more than a half circle is indistinguishable from a perfect one by this
       * test. Below a half turn the two are cleanly different: a bow's rise is
       * a small fraction of the radius it was fitted with, while a real arc's
       * rise is a large fraction of its own.
       */
      const halfChord = chord / 2;

      const sagitta = (() => {
        let worst = 0;

        list.forEach((point) => {
          const along =
            halfChord > EPSILON
              ? ((point.x - list[0].x) * (list[list.length - 1].x - list[0].x) +
                  (point.y - list[0].y) * (list[list.length - 1].y - list[0].y)) /
                (chord * chord)
              : 0;

          const foot = {
            x: list[0].x + along * (list[list.length - 1].x - list[0].x),
            y: list[0].y + along * (list[list.length - 1].y - list[0].y),
          };

          worst = Math.max(worst, Math.hypot(point.x - foot.x, point.y - foot.y));
        });

        return worst;
      })();

      const circular =
        sweep.sweep > Math.PI * 0.9
          ? circle.radius <= chord * MAX_ARC_RADIUS_CHORDS
          : sagitta >= circle.radius * 0.25;

      if (
        error <= (options.arcTolerance ?? ARC_TOLERANCE) &&
        sweep.sweep >= 0.45 &&
        circular
      ) {
        return {
          kind: "arc",
          centre: circle.centre,
          radius: circle.radius,
          startAngle: sweep.startAngle,
          endAngle: sweep.endAngle,
          clockwise: sweep.clockwise,
          confidence: 1 - error / ARC_TOLERANCE,
          points: list.map(copyPoint),
          closed: false,
        };
      }
    }
  }

  /* ---- line ---- */
  const line = fitLine(list);

  /*
   * A CIRCLE EXPLAINS A ROUND STROKE FAR BETTER THAN ITS CHORD DOES.
   *
   * Only if the winsorised discriminant cannot settle the question (a nearly
   * straight piece of a large circle) does the deviation rule decide.
   */
  const bestCircle = circleBeatsLine(list);

  /*
   * A LINE IS EXACT WHEN THE INK IS, and nearly so when the hand wobbled: the
   * average deviation is asked for as well as the worst, so one stray sample
   * does not turn a drawn line into a curve - but the worst bound is generous
   * enough that a shaky straight run is still recognised rather than fitted
   * with a spline that merely looks straight.
   */
  const lineTolerance = options.lineTolerance ?? LINE_TOLERANCE;

  const straight =
    bestCircle !== true &&
    line.worst / span <= Math.max(lineTolerance, 0.05) &&
    line.average / span <= Math.max(lineTolerance * 0.5, 0.025);

  if (straight) {
    const first = list[0];
    const last = list[list.length - 1];

    /*
     * A LINE IS EXACT: TWO POINTS WITH THE SAME X OR THE SAME Y WHEN THE INK
     * WAS (NEARLY) HORIZONTAL OR VERTICAL.
     *
     * The least-squares direction of a shaky horizontal stroke is a hair off
     * horizontal, and projecting both ends onto it leaves them at slightly
     * different heights - a line that looks level and is not. The direction is
     * therefore SNAPPED to the axis it is within a couple of degrees of, which
     * is the line the student meant.
     */
    let direction = line.direction;

    const snappedAngle = Math.round(line.angle / (Math.PI / 2)) * (Math.PI / 2);

    if (Math.abs(angleDifference(line.angle, snappedAngle)) < LINE_AXIS_SNAP) {
      direction = { x: Math.cos(snappedAngle), y: Math.sin(snappedAngle) };
    }

    return {
      kind: "line",
      points: [onLine(first, line.origin, direction), onLine(last, line.origin, direction)],
      confidence: 1 - line.worst / span,
      closed: false,
    };
  }

  /*
   * A NON-STRAIGHT RUN IS TESTED AGAINST THE LINE BY ITS OWN EVIDENCE.
   *
   * The circle test above is claimed only when the run is recognisably a piece
   * of a circle (see `circleBeatsLine`, and the arc branch). Every other bent
   * run is a GENERAL CURVE - a Bezier chain - even when some circle also fits
   * it within a generous radius tolerance. A gentle hump is not an arc, and
   * calling it one loses the thing the student drew.
   */

  /* ---- a general curve ---- */
  return curveClassification(list, { closed, options });
}

/*
 * WHETHER A CIRCLE FITS THE RUN FAR BETTER THAN A STRAIGHT LINE DOES.
 *
 * `null` means the comparison cannot settle it - the run is too short, or the
 * circle is so large that its arc is within a hair of its chord. The caller
 * then falls back to the deviation rule, which is what a line is.
 *
 * The comparison is on the WORST deviation as a share of the run's size, so a
 * ragged line and a ragged arc are judged on the same footing.
 */
function circleBeatsLine(list) {
  if (list.length < 5) {
    return null;
  }

  const circle = fitCircle(list);

  if (!circle || !(circle.radius > 0)) {
    return null;
  }

  const size = sizeOf(list);

  /* A chord of a huge circle is indistinguishable from a line. */
  if (circle.radius > size * 2.5) {
    return null;
  }

  const line = fitLine(list);

  const circleShare = circle.worst / Math.max(size, EPSILON);
  const lineShare = line.worst / Math.max(size, EPSILON);

  /* A tie goes to the line: the simpler primitive. */
  return circleShare < lineShare * 0.78;
}

/*
 * A GENERAL CURVE, WITH ITS OWN BEZIER CHAIN.
 *
 * The points kept as the chain's vertices are the ones that carry SHAPE: the
 * stroke's own ends, plus the RDP-simplified vertices, with the tolerance a
 * small share of the stroke's size. The chain is then LEAST-SQUARES fitted
 * span by span, so the curve passes exactly through every vertex and follows
 * the ink between them - which is what makes it a mathematical curve rather
 * than the sampled polyline drawn with a smoothing brush.
 *
 * Short and nearly-straight spans are collapsed into lines by the caller; a
 * curve is only claimed where the stroke is genuinely bent.
 */
function curveClassification(list, { closed = false, options = {} } = {}) {
  const size = sizeOf(list);

  const vertices = simplify(list, size * (Number(options.simplifyShare) || 0.02));

  const keys = vertices.length >= 2 ? vertices : [list[0], list[list.length - 1]];

  return {
    kind: "curve",
    points: keys.map(copyPoint),
    segments: fitCubicChain(list, keys),
    confidence: 0.5,
    closed,
  };
}

/* The angles an open stroke sweeps around a centre, and which way. */
function arcSweep(points, centre) {
  const angles = points.map((point) => Math.atan2(point.y - centre.y, point.x - centre.x));

  let total = 0;

  for (let index = 1; index < angles.length; index += 1) {
    let step = angles[index] - angles[index - 1];

    while (step > Math.PI) step -= Math.PI * 2;
    while (step < -Math.PI) step += Math.PI * 2;

    total += step;
  }

  return {
    startAngle: angles[0],
    endAngle: angles[angles.length - 1],
    clockwise: total < 0,
    sweep: Math.abs(total),
  };
}

function circleSample({ centre, radius }, count = 64) {
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;

    return {
      x: centre.x + radius * Math.cos(angle),
      y: centre.y + radius * Math.sin(angle),
    };
  });
}

function ellipseSample({ centre, radiusX, radiusY }, count = 64) {
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;

    return {
      x: centre.x + radiusX * Math.cos(angle),
      y: centre.y + radiusY * Math.sin(angle),
    };
  });
}

/* ============================================================
 * CURVE FITTING
 * ============================================================ */

/*
 * RAMER-DOUGLAS-PEPPER. The vertices kept are the ones that carry SHAPE.
 */
export function simplify(points, tolerance) {
  if (points.length < 3) {
    return points.map(copyPoint);
  }

  let far = 0;
  let index = 0;

  const first = points[0];
  const last = points[points.length - 1];

  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const span = Math.hypot(dx, dy);

  for (let cursor = 1; cursor < points.length - 1; cursor += 1) {
    const point = points[cursor];

    const away =
      span < EPSILON
        ? distance(point, first)
        : Math.abs(dy * (point.x - first.x) - dx * (point.y - first.y)) / span;

    if (away > far) {
      far = away;
      index = cursor;
    }
  }

  if (far <= tolerance) {
    return [copyPoint(first), copyPoint(last)];
  }

  const left = simplify(points.slice(0, index + 1), tolerance);
  const right = simplify(points.slice(index), tolerance);

  /*
   * A PINNED SEAM IS NEVER COLLAPSED AWAY.
   *
   * A repeated vertex is the seam where an anchor was spliced in. The split at
   * that vertex produces a final span of two identical points, and a plain
   * concatenation keeps both copies - which is exactly what is wanted.
   */
  return [...left.slice(0, -1), ...right];
}

/* A small moving average - the tremor goes, the shape stays. */
export function smooth(points, radius = 1) {
  if (points.length < 3 || radius < 1) {
    return points.map(copyPoint);
  }

  return points.map((_, index) => {
    let sumX = 0;
    let sumY = 0;
    let count = 0;

    for (let offset = -radius; offset <= radius; offset += 1) {
      const neighbour = points[index + offset];

      if (neighbour) {
        sumX += neighbour.x;
        sumY += neighbour.y;
        count += 1;
      }
    }

    return { x: sumX / count, y: sumY / count };
  });
}

/*
 * A CATMULL-ROM CHAIN AS CUBIC BEZIERS.
 *
 * The curve passes THROUGH every vertex, which is the property that makes it
 * usable for a constraint solver: a pinned anchor is a vertex, and a curve that
 * only approaches its vertices cannot be made to pass through one.
 */
export function beziersThrough(points, tension = 1) {
  const list = points.map(copyPoint);

  if (list.length < 2) {
    return [];
  }

  const segments = [];

  for (let index = 0; index < list.length - 1; index += 1) {
    const p0 = list[index - 1] || list[index];
    const p1 = list[index];
    const p2 = list[index + 1];
    const p3 = list[index + 2] || p2;

    segments.push({
      from: p1,
      control1: {
        x: p1.x + ((p2.x - p0.x) / 6) * tension,
        y: p1.y + ((p2.y - p0.y) / 6) * tension,
      },
      control2: {
        x: p2.x - ((p3.x - p1.x) / 6) * tension,
        y: p2.y - ((p3.y - p1.y) / 6) * tension,
      },
      to: p2,
    });
  }

  return segments;
}

/* ============================================================
 * ANCHORS
 * ============================================================ */

/*
 * WHAT SHAPE A STROKE IS, as a plain answer.
 *
 * `classifySegment` returns the whole reconstruction - the fitted primitive,
 * its parameters and its sampled points. A caller that only wants to know
 * "is this a circle?" should not have to read that, and a caller that asks for
 * a shape by a name that does not exist should get an answer rather than a
 * TypeError. This is that answer, and it is a VIEW of the same classifier, not
 * a second one.
 */
export function recogniseShape(points, options = {}) {
  const classified = classifySegment(points, options);

  /*
   * BOTH NAMES FOR THE SAME ANSWER. `kind` is what the classifier calls it and
   * `shape` is what a reader expects to ask for; returning one and not the
   * other is how a caller ends up comparing `undefined` to "line".
   */
  return {
    kind: classified.kind,
    shape: classified.kind,
    confidence: classified.confidence ?? 0,
    classified,
  };
}

/*
 * THE ANCHORS A STROKE MUST HONOUR.
 *
 * ONLY THE ASSOCIATED ONES. `options.points` is the sketch's whole point set,
 * and a sketch has more points than one stroke: a point placed on another
 * curve, or dropped in a corner for reference. Passing them all to the fit
 * made every stroke try to pass through every point - which is how a defined
 * point became a global constraint.
 *
 * The association is explicit and lives in the data model:
 *
 *   options.geometryId  the element being reconstructed (an edit or a reopen);
 *   options.anchors     the element's own anchor ids;
 *   options.association ids the caller is explicitly applying right now - the
 *                       points a drawing tool was told to pass through.
 *
 * `options.anchors` may also be a list of POINTS rather than ids, which is what
 * a test or a caller holding resolved points passes.
 */
export function anchorsFor(userPoints = [], options = {}) {
  if (Array.isArray(options.anchors) && options.anchors.length && options.anchors[0]?.absolute) {
    return resolvePoints(options.anchors.filter((point) => point?.type !== "centre"));
  }

  const points = resolvePoints(userPoints).filter(
    (point) => point.type === "anchor" && point.role !== "centre",
  );

  const hasAssociation =
    Array.isArray(options.anchors) ||
    Array.isArray(options.association) ||
    Boolean(options.geometryId);

  if (!hasAssociation) {
    /*
     * NO ASSOCIATION INFORMATION AT ALL.
     *
     * A caller that passes points and no association is saying "these points
     * belong to this stroke" - the direct API a test or another tool uses.
     * That is the one case where every anchor supplied is honoured, because
     * there is nothing else to go on and refusing them all would make the
     * simple call silently unconstrained.
     */
    return anchorPoints(userPoints).filter((point) => point.role !== "centre");
  }

  return anchorsForGeometry(points, {
    geometryId: options.geometryId || null,
    anchors: Array.isArray(options.anchors) ? options.anchors : [],
    association: Array.isArray(options.association) ? options.association : [],
  });
}

/*
 * THE CENTRE A STROKE WAS DRAWN AROUND, IF THE STUDENT CHOSE ONE.
 *
 * A centre is an anchor with `role: "centre"` - the same point type, a
 * different job. It constrains the CENTRE of a circle or arc and is never a
 * point on the circumference: treating it as one would force the curve through
 * the middle of the circle, which is the opposite of what the student asked
 * for.
 */
export function centreFor(userPoints = [], options = {}) {
  if (options.centre && Number.isFinite(Number(options.centre.x))) {
    return {
      x: Number(options.centre.x),
      y: Number(options.centre.y),
      id: options.centre.id || null,
    };
  }

  const chosen = centrePointFor(userPoints, { geometryId: options.geometryId || null });

  return chosen ? { x: chosen.absolute.x, y: chosen.absolute.y, id: chosen.id } : null;
}

/*
 * WHETHER A STROKE HAS SOFT GUIDES.
 *
 * Shape guides were removed from the model, so the answer is always "no" -
 * and it is answered rather than absent, because a caller that still asks
 * should get a truthful "no" instead of a crash, and the stroke is the guide.
 */
export function hasGuides() {
  return false;
}

function nearestIndex(points, target) {
  let best = { index: 0, distance: Infinity };

  points.forEach((point, index) => {
    const away = distance(point, target);

    if (away < best.distance) {
      best = { index, distance: away };
    }
  });

  return best.index;
}

/*
 * PIN THE ANCHORS INTO A PATH, IN ORDER ALONG IT.
 *
 * Anchors are ordered by where they fall along the stroke rather than by the
 * order the student created them, because a curve drawn right-to-left would
 * otherwise be fitted through its anchors backwards - a loop rather than a path.
 *
 * AN ANCHOR IS A POINT ON THE PATH, NOT AN END OF IT.
 *
 * This used to start the result at the first anchor and stop at the last, which
 * threw away everything the student drew before the first point and after the
 * last - so a stroke that ran past its anchors came back clipped to the span
 * between them. The anchors are now SPLICED INTO the stroke: the geometry
 * before the first, between each pair, and after the last is all kept, and the
 * anchor replaces the sample nearest it.
 *
 * An anchor that is nowhere near the stroke is not spliced in at all. It is a
 * constraint on SOME geometry, not on every stroke in the sketch, and forcing
 * it into a stroke it does not touch would drag that stroke across the canvas.
 */
/*
 * PUT EACH ANCHOR INTO THE STROKE, AT THE SAMPLE NEAREST IT.
 *
 * This is the form of splicing that does not depend on how simplification
 * later treats the stroke: the anchor becomes a sample, so it survives into
 * the vertices whatever tolerance the simplification uses.
 *
 * An anchor that is nowhere near the stroke is left out - it is a constraint on
 * SOME geometry, and forcing it into a stroke it does not touch would drag that
 * stroke across the canvas.
 */
/*
 * WHERE AN ANCHOR FALLS IN THE STROKE, by its nearest sample.
 *
 * This is the ordering key, and the ordering is the STROKE's: two anchors that
 * are nearest the same sample are ordered by their own x, so a curve drawn
 * right-to-left is still spliced in the order it was drawn. The along-path
 * parameter refines each anchor's own position for the splice, not the sort.
 */
function anchorOrder(entry) {
  return entry.index + entry.point.x * 1e-6;
}

function pinAnchorsIntoStroke(points, anchors) {
  const list = points.map(copyPoint);

  /*
   * EVERY ASSOCIATED ANCHOR IS HONOURED. `anchors` has already been filtered to
   * the ones this geometry is associated with (see `anchorsFor`), so a caller
   * that named a point meant it. This reach is a guard, not a filter.
   */
  const reach = Math.max(sizeOf(list) * 2, EPSILON);

  const entries = anchors.map((anchor) => {
    const index = nearestIndex(list, anchor.absolute);

    return {
      point: anchor.absolute,
      index,
      distance: distance(list[index], anchor.absolute),
    };
  });

  /*
   * AN ANCHOR'S PLACE ALONG THE STROKE IS DECIDED BY ITS PARAMETER, NOT BY THE
   * NEAREST SAMPLE.
   *
   * A stroke's sample INDEX is its position along the ink, and an anchor can be
   * near the same sample as another while lying at a quite different place along
   * the path - a tight bend brings two parts of the path close together. The
   * index is refined by asking where the anchors sit in the stroke's own
   * progression: the fraction of the whole path covered before the nearest
   * sample, plus how far the anchor is along the local step.
   */
  const along = (entry) => {
    const before = list[Math.max(0, entry.index - 1)];
    const here = list[entry.index];
    const after = list[Math.min(list.length - 1, entry.index + 1)];

    const step = { x: after.x - before.x, y: after.y - before.y };
    const lengthSq = step.x * step.x + step.y * step.y;

    const offset =
      lengthSq > EPSILON
        ? ((entry.point.x - here.x) * step.x + (entry.point.y - here.y) * step.y) / lengthSq
        : 0;

    /*
     * THE SAMPLE THE ANCHOR HAS REACHED is the one AFTER it when the stroke is
     * still travelling towards the anchor there (a positive offset), and the
     * one BEFORE it when the stroke has already passed (a negative offset). A
     * splice must land BETWEEN two samples, so that sample is dropped and the
     * anchor takes its place.
     */
    const reached = Math.round(entry.index + Math.max(-0.49, Math.min(0.49, offset)));

    return Math.max(0, Math.min(list.length, reached));
  };

  const relevant = entries
    .filter((entry) => entry.distance <= reach)
    .map((entry) => ({ ...entry, order: along(entry), original: anchorOrder(entry) }))
    .sort((a, b) => a.original - b.original);

  if (!relevant.length) {
    return list;
  }

  const result = [];

  let cursor = 0;

  relevant.forEach((entry, position) => {
    while (cursor < entry.index) {
      result.push(list[cursor]);
      cursor += 1;
    }

    /*
     * The anchor REPLACES the sample it is nearest, so the path passes through
     * the exact coordinate and the stroke either side keeps its shape.
     */
    result.push({ x: entry.point.x, y: entry.point.y });

    /*
     * AND THE SAMPLES THE ANCHOR HAS MOVED PAST GO WITH IT.
     *
     * An anchor that lies forward of its nearest sample (the stroke is still
     * travelling towards it at that sample) has already passed the sample
     * BEHIND its nearest one. Advancing only from the nearest sample would then
     * put that sample back into the path AFTER the anchor, and the curve would
     * double back on itself. The cursor advances from the sample the anchor has
     * actually reached.
     */
    /*
     * The cursor moves to the sample AFTER the one the anchor has reached. An
     * anchor slightly forward of its nearest sample has already passed that
     * sample, so that sample is dropped - putting it back would make the path
     * double back through the anchor. "Round" rather than "floor" keeps a
     * sample the anchor has not quite reached when it is closer to it than to
     * the one before.
     */
    cursor = Math.min(list.length, Math.max(cursor + 1, entry.order + 1));

    /*
     * AND THE ANCHOR IS CLOSED OFF ON BOTH SIDES.
     *
     * The anchor REPLACES the sample nearest it, which would leave the stroke
     * either side stepping straight in and out of the anchor from the samples
     * around it - two chords meeting at the point, and a visible kink. The
     * anchor is therefore duplicated once on each side: the path approaches the
     * point, arrives at it, leaves it, and continues with the stroke. Each
     * zero-length step is the seam where the constraint meets the ink, and the
     * curve between them is a point rather than a corner.
     */
    result.push({ x: entry.point.x, y: entry.point.y });

    void position;
  });

  /*
   * NOTHING IS LOST AT EITHER END. Everything before the first anchor and
   * everything after the last is part of the stroke the student drew, and it is
   * carried into the result - an anchor is a point ON the path, never a place
   * the path starts or stops.
   */

  while (cursor < list.length) {
    result.push(list[cursor]);
    cursor += 1;
  }

  return result;
}

function pinAnchors(points, anchors) {
  if (!anchors.length || !points.length) {
    return points.map(copyPoint);
  }

  /*
   * A PINNED ANCHOR HAS NO AUTOMATIC START OR END: anchors are spliced into the
   * path where they fall, and the stroke's own first and last samples stay the
   * path's first and last points. The geometry before the first anchor and
   * after the last is part of what the student drew and is kept.
   */

  /*
   * HOW CLOSE AN ANCHOR MUST BE TO BELONG TO THIS STROKE.
   *
   * A share of the stroke's own size, so the test means the same thing on a
   * small sketch and a large one. An anchor further away than this is a
   * constraint on a different piece of geometry.
   */
  /*
   * THE REACH IS GENEROUS, because the vertices being searched are the result
   * of a simplification pass: a curve can be reduced to a handful of points,
   * and the vertex nearest an anchor may then be a fraction of the curve away.
   * Half the shape's own size is still far short of "the other end of the
   * sketch", so a genuinely unrelated anchor is still excluded.
   */
  const reach = Math.max(sizeOf(points) * 0.6, EPSILON);

  const positions = anchors
    .map((anchor) => {
      const index = nearestIndex(points, anchor.absolute);

      return {
        anchor,
        index,
        distance: distance(points[index], anchor.absolute),
      };
    })
    .filter((entry) => entry.distance <= reach)
    .sort((a, b) => a.index - b.index || a.point.x - b.point.x);

  if (!positions.length) {
    return points.map(copyPoint);
  }

  const result = [];

  /* Everything before the first anchor is the student's, and is kept. */
  points
    .slice(0, positions[0].index)
    .forEach((point) => result.push(copyPoint(point)));

  positions.forEach((entry, position) => {
    result.push(copyPoint(entry.anchor.absolute));

    const next = positions[position + 1];

    /* The stroke between two anchors carries the student's intention there. */
    if (next) {
      points
        .slice(entry.index + 1, next.index)
        .forEach((point) => result.push(copyPoint(point)));
    }
  });

  /* And everything after the last anchor is kept too. */
  points
    .slice(positions[positions.length - 1].index + 1)
    .forEach((point) => result.push(copyPoint(point)));

  return result;
}

/* ============================================================
 * THE WHOLE CORRECTION OF ONE STROKE
 * ============================================================ */

/*
 * RECONSTRUCT ONE STROKE.
 *
 * Returns the geometry, the original stroke, what was recognised, and any
 * CONFLICT the anchors produced. A conflict is data, not an exception: the
 * interface shows it and the student decides.
 */
export function correctStroke(stroke, options = {}) {
  const points = polylineOf(stroke);

  if (points.length < 2) {
    return {
      points: points.map(copyPoint),
      segments: [],
      original: points.map(copyPoint),
      correction: { kind: "curve", confidence: 0 },
      conflict: null,
      parts: [],
    };
  }

  const anchors = anchorsFor(options.points || [], options);

  /*
   * A CHOSEN CENTRE CONSTRAINS THE FIT, AND IS NEVER PINNED ONTO THE PATH.
   *
   * A centre is the middle of a circle or an arc. Splicing it into the stroke
   * as a vertex - which is what an associated anchor normally becomes - would
   * drag the curve through the centre of the circle it is supposed to be
   * around, which is the opposite of the student's intent.
   */
  const centre = centreFor(options.points || [], options);

  /* The stroke as it was drawn: nothing here is allowed to rewrite it. */
  const steered = points;

  /*
   * CORRECTION OFF IS A TRUE PASSTHROUGH - except for the anchors, which are
   * not a correction but a constraint. Even with reconstruction off, a curve
   * the student said passes through a point passes through it.
   */
  if (options.correction === false) {
    const pinned = pinAnchors(steered, anchors);

    return {
      points: pinned,
      segments: beziersThrough(pinned),
      original: points.map(copyPoint),
      correction: { kind: "none", confidence: 1, disabled: true },
      conflict: null,
      parts: [],
    };
  }

  /*
   * A CLOSED STROKE IS TESTED AS ONE SHAPE FIRST.
   *
   * A circle or an ellipse is a single primitive whose own curvature looks like
   * a turn to any corner detector, so splitting first would cut it into pieces
   * that can never be recognised as the shape they are. The whole stroke is
   * therefore offered to the closed primitives before anything is split - and
   * only if it is not one of them is it treated as a composite.
   */
  const whole = classifySegment(steered, {
    ...options,
    /*
     * A STROKE THAT IS NOT CLOSED IS NOT A CIRCLE, however round it looks.
     * Forcing closure on an open stroke is how a swept arc was reported as a
     * full circle.
     */
    requireClosed: true,
  });

  const isWholePrimitive =
    whole.kind === "circle" || whole.kind === "ellipse";

  /*
   * ONE STROKE MAY BE SEVERAL SHAPES. It is split at its corners, and each
   * piece is reconstructed on its own - which is what stops a box drawn in one
   * gesture from becoming a single wobbly curve.
   */
  const curvatureBreaks = Boolean(options.preserveCorners);

  const pieces = isWholePrimitive
    ? [steered]
    : splitAtCorners(steered, { curvatureBreaks });

  const parts = pieces.map((piece) => classifySegment(piece, options));

  /*
   * A SINGLE PIECE IS THE WHOLE STROKE, so its primitive is the stroke's. With
   * several pieces the stroke is a COMPOSITE, and the result is the pieces
   * joined - each keeping its own mathematics.
   */
  const single = parts.length === 1 ? parts[0] : null;

  /*
   * A COMPOSITE OF STRAIGHT PIECES IS A POLYGON.
   *
   * A box drawn in one gesture is four lines, and four lines that meet end to
   * end and close are a polygon - which is a shape the student can select and
   * edit as one, not four unrelated strokes. The evidence is the pieces: all
   * straight, sharing their endpoints, and closing.
   */
  const polygon =
    parts.length >= 3 &&
    parts.every((part) => part.kind === "line") &&
    closureGap(points) <= CLOSURE_TOLERANCE;

  const conflict = single ? analyseConflict(single, anchors) : null;

  /*
   * A POLYGON IS ITS VERTICES, EXACTLY.
   *
   * Each piece's line is already exact, so the polygon is the corners those
   * lines meet at - shared, not doubled, and closed. That is the geometry the
   * student drew, with the tremor gone.
   */
  if (polygon) {
    const vertices = parts.map((part) => copyPoint(part.points[0]));

    return {
      points: vertices,
      segments: beziersThrough([...vertices, vertices[0]]),
      original: points.map(copyPoint),
      correction: {
        kind: "polygon",
        sides: vertices.length,
        confidence: 0.9,
        closed: true,
        parts: parts.map((part) => part.kind),
      },
      conflict,
      parts,
    };
  }

  /*
   * AN ANCHOR THAT A PRIMITIVE CANNOT HONOUR REJECTS THE PRIMITIVE.
   *
   * A circle that cannot pass through the anchors is not the student's shape;
   * the stroke is then reconstructed as a curve through those anchors, which
   * can always honour them. The conflict is still reported, so the student
   * knows why their circle became a curve.
   */
  const rejected = Boolean(conflict && conflict.severity === "error");

  if (single && !rejected && (single.kind === "circle" || single.kind === "ellipse")) {
    const placed = centre ? withCentre(single, centre, points) : single;

    const shapePoints = placed.points.map(copyPoint);

    return {
      points: shapePoints,
      segments: beziersThrough(shapePoints),
      original: points.map(copyPoint),
      correction: {
        kind: placed.kind,
        centre: placed.centre,
        radius: placed.radius ?? null,
        radiusX: placed.radiusX ?? null,
        radiusY: placed.radiusY ?? null,
        confidence: single.confidence,
        closed: true,
        /* The exact point the centre was taken from, when one was chosen. */
        centrePointId: centre?.id || null,
        /*
         * A ROUND STROKE IS NOT A FUNCTION OF X, so its trend is reported as
         * not applicable rather than forced into one monotonic label.
         */
        trend: {
          applicable: false,
          summary:
            "Closed curve - increasing and decreasing behaviour does not apply as a single function of x.",
        },
      },
      conflict,
      parts,
    };
  }

  if (single && !rejected && single.kind === "arc") {
    /* A chosen centre is the ARC'S centre, not a point on its circumference. */
    const arc = centre ? withCentre(single, centre, points) : single;

    const shapePoints = arcPoints(arc);

    /*
     * THE ARC RUNS BETWEEN ITS MATHEMATICAL ENDS, AND AN ANCHOR ON IT IS A
     * POINT ALONG THE ARC.
     *
     * An arc that already passes through its anchors keeps its exact circular
     * geometry, with the anchors spliced in as vertices the curve passes
     * through. An arc that CANNOT - the anchors are inside its tolerance but
     * the sampled points do not reach them - is rejected for a curve through
     * the anchors, because an anchor is exact and a circular shape is not worth
     * breaking that promise for.
     */
    const vertices = anchors.length ? pinAnchors(shapePoints, anchors) : shapePoints;

    const missed = anchors.length
      ? anchors.filter(
          (anchor) =>
            distance(closestOnArc(anchor.absolute, arc), anchor.absolute) >
            Math.max(arc.radius * 0.01, 1e-6),
        )
      : [];

    if (missed.length) {
      const fallback = curveThrough(points, anchors);

      return {
        ...fallback,
        correction: {
          ...fallback.correction,
          rejected: "arc",
          reason: "an anchor does not lie on the fitted arc",
        },
        conflict: {
          kind: "arc-anchors",
          severity: "warning",
          residual: distance(closestOnArc(missed[0].absolute, arc), missed[0].absolute),
          message:
            "The fitted arc cannot pass through the anchor, so the stroke is " +
            "kept as a curve through it.",
        },
        parts,
      };
    }

    return {
      points: vertices,
      segments: arcBeziers(arc, vertices),
      original: points.map(copyPoint),
      correction: {
        kind: "arc",
        centre: arc.centre,
        radius: arc.radius,
        startAngle: arc.startAngle,
        endAngle: arc.endAngle,
        clockwise: arc.clockwise,
        confidence: single.confidence,
        closed: false,
        centrePointId: centre?.id || null,
        trend: {
          applicable: false,
          summary:
            "Circular arc - its increasing and decreasing behaviour changes along the arc and is not a single function of x.",
        },
      },
      conflict,
      parts,
    };
  }

  if (single && !rejected && single.kind === "line") {
    /*
     * A LINE IS ITS TWO ENDS - AND AN ANCHOR ON IT IS A POINT ALONG IT.
     *
     * The ends used to be REPLACED by the first and last anchor, which moved
     * the line's own endpoints onto the anchors and lost whatever the student
     * drew beyond them. An anchor that lies on the line is now spliced in as a
     * vertex BETWEEN the ends, so the line still starts and stops where it was
     * drawn and still passes exactly through the anchor.
     */
    let ends = single.points.map(copyPoint);

    /*
     * AN ANCHOR THAT IS NOT QUITE ON THE LINE IS STILL THE STUDENT'S POINT.
     *
     * A line drawn by hand passes a little to one side of a point the student
     * placed; the point is exact and the ink is not. The line is therefore
     * RE-FITTED TO PASS THROUGH ITS ANCHORS, keeping the drawn direction: the
     * anchors they all project onto is the line that was meant, and it runs
     * through every one of them instead of near it.
     */
    if (anchors.length) {
      const along = (ends[1].x - ends[0].x) * (ends[1].x - ends[0].x) +
        (ends[1].y - ends[0].y) * (ends[1].y - ends[0].y);

      if (along > EPSILON) {
        let dx = ends[1].x - ends[0].x;
        let dy = ends[1].y - ends[0].y;

        const length = Math.hypot(dx, dy) || 1;

        dx /= length;
        dy /= length;

        let cx = anchors.reduce((sum, anchor) => sum + anchor.absolute.x, 0) / anchors.length;
        let cy = anchors.reduce((sum, anchor) => sum + anchor.absolute.y, 0) / anchors.length;

        /* Two passes of the orthogonal projection is plenty for a line. */
        for (let pass = 0; pass < 3; pass += 1) {
          const meanOffset =
            anchors.reduce(
              (sum, anchor) =>
                sum + (anchor.absolute.x - cx) * -dy + (anchor.absolute.y - cy) * dx,
              0,
            ) / anchors.length;

          cx += -dy * meanOffset;
          cy += dx * meanOffset;
        }

        const project = (point) => {
          const t = (point.x - cx) * dx + (point.y - cy) * dy;

          return { x: cx + dx * t, y: cy + dy * t };
        };

        ends = [project(ends[0]), project(ends[1])];
      }
    }

    const onLineAnchors = anchors
      .map((anchor) => ({
        point: anchor.absolute,
        along:
          (anchor.absolute.x - ends[0].x) * (ends[1].x - ends[0].x) +
          (anchor.absolute.y - ends[0].y) * (ends[1].y - ends[0].y),
      }))
      .filter((entry) => entry.along > 0)
      .sort((a, b) => a.along - b.along)
      .map((entry) => copyPoint(entry.point));

    const vertices = [ends[0], ...onLineAnchors, ends[1]];

    /*
     * A LINE HAS NO TURNING OR INFLECTION POINT, and its trend is the sign of
     * its slope - which is a real, meaningful classification for a straight
     * segment and is reported rather than left blank.
     */
    const rising = vertices[vertices.length - 1].y > vertices[0].y;

    const length = Math.hypot(
      vertices[vertices.length - 1].x - vertices[0].x,
      vertices[vertices.length - 1].y - vertices[0].y,
    );

    const vertical = Math.abs(vertices[vertices.length - 1].x - vertices[0].x) < EPSILON;

    return {
      points: vertices,
      segments: beziersThrough(vertices),
      original: points.map(copyPoint),
      correction: {
        kind: "line",
        confidence: single.confidence,
        closed: false,
        trend: {
          applicable: !vertical,
          summary: vertical
            ? "Vertical segment - not a function of x."
            : `Straight · ${rising ? "Increasing" : rising ? "" : "Decreasing"}.`,
          intervals: [],
          turnings: [],
          inflections: [],
          trend: vertical ? "none" : rising ? "increasing" : "decreasing",
          concavity: "flat",
          length,
        },
      },
      conflict,
      parts,
    };
  }

  /*
   * A COMPOSITE OF SEVERAL SHAPES.
   *
   * Each piece keeps its OWN mathematics: a straight piece contributes its two
   * exact endpoints, a curved piece contributes its clean vertices. The pieces
   * share their joining points, so the result is one continuous path with real
   * corners where the student drew them - not a single curve that smooths the
   * corners away.
   */
  if (parts.length > 1) {
    const joined = [];

    parts.forEach((part, index) => {
      /*
       * EACH PIECE KEEPS ITS OWN MATHEMATICS.
       *
       * A straight piece contributes its two exact ends; a curved piece
       * contributes its own least-squares chain through its own vertices. The
       * pieces share their joining point, so the result has a real corner where
       * the student drew one and a smooth joint where they did not.
       */
      const piece =
        part.kind === "line" ? part.points.map(copyPoint) : part.points.map(copyPoint);

      piece.forEach((point, position) => {
        if (index > 0 && position === 0) {
          return;
        }

        joined.push(point);
      });
    });

    /*
     * THE PIECES ARE JOINED, THEN THE ANCHORS ARE SPLICED IN - nothing may run
     * over an anchor afterwards.
     */
    const pinned = pinAnchors(joined, anchors);

    /*
     * A CHAIN THROUGH THE JOINED VERTICES, fitted to the stroke between them:
     * the piece boundaries are fixed points, and the curve between two of them
     * is the stroke's own shape rather than a straight chord.
     */
    const segments = cubicChainThrough(points, pinned);

    const analysis = analyseCurveTrend({ points: pinned, segments });

    return {
      points: pinned,
      segments,
      original: points.map(copyPoint),
      correction: {
        kind: "composite",
        confidence: 0.8,
        closed: closureGap(points) <= CLOSURE_TOLERANCE,
        composite: true,
        parts: parts.map((part) => part.kind),
        trend: analysis,
      },
      conflict,
      parts,
    };
  }

  /*
   * A GENERAL CURVE.
   *
   * A PIECEWISE POLYNOMIAL, NOT ONE GLOBAL POLYNOMIAL. The stroke is simplified
   * to the vertices that carry shape, the anchors are spliced in, and a cubic
   * chain is LEAST-SQUARES fitted to each span with its ends fixed. That is the
   * representation the brief asks for - and the only one that follows the ink
   * without oscillating between the samples.
   */
  const tolerance = Math.max(sizeOf(points) * 0.012, Number(options.simplifyTolerance) || 0);

  /*
   * SIMPLIFY THE STROKE, THEN SPLICE THE ANCHORS IN.
   *
   * Pinning FIRST and smoothing after would let the filter pull the anchors off
   * their coordinates - an average is not the point the student placed. Pinning
   * LAST means nothing runs over the anchors afterwards: they are the final
   * word on where the curve passes.
   *
   * AN ANCHOR THE SIMPLIFIED STROKE NEVER COMES NEAR IS STILL ANCHORED. The
   * stroke was simplified to the vertices that carry its shape, and an anchor
   * between two of them - the middle of a sweep, say - is not one of those
   * vertices. Splicing by nearest sample would miss it and the point would be
   * silently dropped. It is therefore SPLICED INTO THE STROKE FIRST, at the
   * place on the path closest to it, so the simplification keeps it and the
   * chain is fitted through it exactly.
   */
  const filtered = smooth(points, 2);

  const vertices = simplify(
    anchors.length ? pinAnchorsIntoStroke(filtered, anchors) : filtered,
    tolerance,
  );

  const pinned = pinAnchors(vertices, anchors);

  const segments = cubicChainThrough(points, pinned, single?.segments);

  const closed = closureGap(points) <= CLOSURE_TOLERANCE;

  const analysis = single ? analyseCurveTrend(single) : analyseCurveTrend({ points: pinned, segments });

  return {
    points: pinned,
    segments: segments.length ? segments : beziersThrough(pinned),
    original: points.map(copyPoint),
    correction: {
      kind: "curve",
      confidence: single?.confidence ?? 0.5,
      closed,
      parts: parts.map((part) => part.kind),
      /*
       * THE TREND, COMPUTED FROM THE FITTED CURVE'S OWN DERIVATIVES. Stored on
       * the correction so the inspector shows the same classification the
       * geometry mathematically has, and so a saved sketch keeps it.
       */
      trend: analysis,
    },
    conflict,
    parts,
  };
}

/*
 * A CUBIC CHAIN THROUGH THE RESULT'S OWN VERTICES.
 *
 * Each span is fitted to the stroke's samples between its two vertices by
 * ordinary least squares with the ends fixed, so the chain passes exactly
 * through every vertex (the ends, the corners, the pinned anchors) and follows
 * the ink between them. `fallback` is a chain computed earlier - from the
 * classifier - used when the stroke samples cannot be split sensibly.
 */
function cubicChainThrough(strokePoints, vertices, fallback = null) {
  const list = (Array.isArray(vertices) ? vertices : []).filter(Boolean);

  if (list.length < 2) {
    return [];
  }

  const chain = fitCubicChain(strokePoints, list);

  if (chain.length === list.length - 1) {
    return chain;
  }

  return Array.isArray(fallback) && fallback.length ? fallback : beziersThrough(list);
}

/* Points along a chain, for the trend analysis of a composite. */
function chainSamplePoints(points, segments) {
  if (segments?.length) {
    return curveSamplePoints({ segments });
  }

  return (points || []).map(copyPoint);
}

/*
 * THE TREND OF A RECONSTRUCTED CURVE.
 *
 * The classification is read from the FITTED CURVE, never from the rough
 * stroke: a hand's tremor changes the first difference sign every few samples
 * and would otherwise report an increasing/decreasing alternation that says
 * nothing about the shape. A short curve is reported as not applicable rather
 * than given a meaningless label.
 */
function analyseCurveTrend({ points, segments }) {
  const samples = chainSamplePoints(points, segments);

  if (samples.length < 3) {
    return {
      applicable: false,
      summary: "A straight segment has no turning or inflection points.",
      intervals: [],
      turnings: [],
      inflections: [],
      trend: "none",
      concavity: "none",
    };
  }

  const analysis = analyseTrend(samples);

  return {
    ...analysis,
    intervals: analysis.intervals || [],
  };
}

/*
 * A STROKE RE-FITT WITH A DIFFERENT CENTRE.
 *
 * A circle or an arc the student chose the centre of keeps that EXACT centre
 * and takes its radius from the ink. If the ink cannot be a circle about that
 * centre - the distance from the centre varies too much - the primitive is
 * refused and the conflict is reported, because silently moving the centre (or
 * silently keeping a centre the stroke does not support) would be a lie about
 * what was drawn.
 */
function withCentre(shape, centre, strokePoints) {
  const radii = (strokePoints || []).map((point) =>
    Math.hypot(point.x - centre.x, point.y - centre.y),
  );

  if (!radii.length) {
    return shape;
  }

  const radius = radii.reduce((sum, value) => sum + value, 0) / radii.length;

  const worst = Math.max(...radii.map((value) => Math.abs(value - radius)));

  const tolerance = Math.max(radius * 0.08, 1e-6);

  if (worst <= tolerance) {
    const fix = (point) => {
      const dx = point.x - centre.x;
      const dy = point.y - centre.y;
      const away = Math.hypot(dx, dy) || 1;

      return {
        x: centre.x + (dx / away) * radius,
        y: centre.y + (dy / away) * radius,
      };
    };

    if (shape.kind === "circle") {
      const points = circleSample({ centre, radius });

      return { ...shape, centre: { x: centre.x, y: centre.y }, radius, points };
    }

    if (shape.kind === "arc") {
      const sweep = arcSweep(strokePoints, centre);

      return {
        ...shape,
        centre: { x: centre.x, y: centre.y },
        radius,
        startAngle: sweep.startAngle,
        endAngle: sweep.endAngle,
        clockwise: sweep.clockwise,
        /*
         * THE ANGULAR EXTENT IS RE-READ FROM THE STROKE, not from the old fit:
         * the centre moved to the student's point, so the angles that describe
         * where the ink starts and stops about THAT centre are the true ones.
         */
        points: (strokePoints || []).map(fix),
      };
    }

    if (shape.kind === "ellipse") {
      /* A chosen centre for an ellipse keeps its axis ratio. */
      const ratio = (shape.radiusY || 1) / Math.max(shape.radiusX || 1, EPSILON);

      return {
        ...shape,
        centre: { x: centre.x, y: centre.y },
        radiusX: radius,
        radiusY: radius * ratio,
        points: ellipseSample({ centre, radiusX: radius, radiusY: radius * ratio }),
      };
    }
  }

  return shape;
}

/*
 * THE STROKE AS A CURVE THROUGH ITS ANCHORS.
 *
 * This is the fallback for a stroke whose primitive cannot honour an anchor: a
 * curve through the anchors can always do so, because the anchors are its
 * vertices. The stroke between them supplies the shape.
 */
function curveThrough(points, anchors) {
  const tolerance = Math.max(sizeOf(points) * 0.012, 0.001);

  const vertices = simplify(smooth(points, 2), tolerance);

  const pinned = pinAnchors(vertices, anchors);

  const segments = cubicChainThrough(points, pinned);

  return {
    points: pinned,
    segments: segments.length ? segments : beziersThrough(pinned),
    original: points.map(copyPoint),
    correction: { kind: "curve", confidence: 0.6, closed: false },
    conflict: null,
  };
}

/*
 * WHERE AN ANCHOR PROJECTS ONTO AN ARC.
 *
 * The nearest point on the CIRCLE, kept only when it falls inside the arc's own
 * sweep - an anchor beside the arc's end is not on the arc.
 */
function closestOnArc(point, arc) {
  const angle = Math.atan2(point.y - arc.centre.y, point.x - arc.centre.x);

  let from = arc.startAngle;
  let to = arc.endAngle;

  if (arc.clockwise) {
    while (to > from) to -= Math.PI * 2;
  } else {
    while (to < from) to += Math.PI * 2;
  }

  let offset = angle - from;

  if (arc.clockwise) {
    while (offset > 0) offset -= Math.PI * 2;
  } else {
    while (offset < 0) offset += Math.PI * 2;
  }

  const clamped = Math.max(0, Math.min(1, Math.abs(to - from) < EPSILON ? 0 : offset / (to - from)));
  const at = from + (to - from) * clamped;

  return {
    x: arc.centre.x + arc.radius * Math.cos(at),
    y: arc.centre.y + arc.radius * Math.sin(at),
  };
}

/*
 * THE BEZIER CHAIN OF A CIRCULAR ARC.
 *
 * The arc's own points are described to the renderer, the source and the trend
 * analysis through a chain of cubics that follows them. Its ends are the
 * student's arc's ends, and an anchor spliced into the chain is passed through -
 * so an arc pinned to a point is a true arc that goes through that point.
 */
function arcBeziers(arc, vertices) {
  const points =
    Array.isArray(vertices) && vertices.length >= 2
      ? vertices.map(copyPoint)
      : arcPoints(arc);

  return beziersThrough(points);
}

/* The points along an arc, for drawing and for the Bezier chain. */
function arcPoints(arc, count = 32) {
  let from = arc.startAngle;
  let to = arc.endAngle;

  if (arc.clockwise) {
    while (to > from) to -= Math.PI * 2;
  } else {
    while (to < from) to += Math.PI * 2;
  }

  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = from + ((to - from) * index) / count;

    return {
      x: arc.centre.x + arc.radius * Math.cos(angle),
      y: arc.centre.y + arc.radius * Math.sin(angle),
    };
  });
}

/* The residual a primitive was accepted with, in model units. */
function recognizedTolerance(recognised) {
  if (recognised.kind === "arc") {
    return recognised.radius * ARC_TOLERANCE;
  }

  if (recognised.kind === "circle") {
    return recognised.radius * CIRCLE_TOLERANCE;
  }

  return recognised.radius * CIRCLE_TOLERANCE;
}

/*
 * CAN THE ANCHORS ALL BE MET?
 *
 * The example the task names: three non-collinear points determine a unique
 * circle, a single point does not, and three points that are NOT concyclic
 * cannot all be on one circle at all. The third case is a genuine conflict, and
 * reporting it is the only honest answer - resolving it by moving a point would
 * break the promise that an anchor is exact.
 */
export function analyseConflict(recognised, anchors) {
  if (!recognised || !anchors.length) {
    return null;
  }

  if (recognised.kind === "circle" || recognised.kind === "arc") {
    const worst = anchors.reduce(
      (max, anchor) =>
        Math.max(
          max,
          Math.abs(distance(anchor.absolute, recognised.centre) - recognised.radius),
        ),
      0,
    );

    /*
     * THE TOLERANCE IS THE FIT'S OWN ERROR, NOT A FIXED NUMBER.
     *
     * A hand-drawn arc that the circle fit already scores at 4% is a circle the
     * student drew well - its anchors sit within that same 4% of the ideal
     * circumference. A 2% tolerance rejected them every time, which quietly
     * turned every anchored arc into a general curve. The allowance is therefore
     * the residual the recogniser accepted, with a floor so a perfect fit still
     * demands exactness.
     */
    const ownError = Math.max(
      Number(recognised.confidence) < 1
        ? (1 - Number(recognised.confidence)) * recognizedTolerance(recognised)
        : 0,
      recognised.radius * 0.02,
    );

    const tolerance = Math.max(ownError, 1e-6);

    if (worst > tolerance) {
      return {
        kind: "circle-anchors",
        severity: "error",
        residual: worst,
        message:
          `A circle cannot pass through all ${anchors.length} anchors: the worst is ` +
          `${worst.toFixed(3)} off. Three points define a circle only when they lie on one.`,
      };
    }
  }

  if (recognised.kind === "line" && anchors.length > 2) {
    const fitted = fitLine(anchors.map((anchor) => anchor.absolute));

    if (fitted.worst > 1e-3) {
      return {
        kind: "line-anchors",
        severity: "warning",
        residual: fitted.worst,
        message: `${anchors.length} anchors are not collinear; the line passes ${fitted.worst.toFixed(3)} from one of them.`,
      };
    }
  }

  return null;
}

/* ============================================================
 * THE WHOLE SKETCH
 * ============================================================ */

/* Every stroke, reconstructed against the same constraint set. */
export function correctSketch(strokes, options = {}) {
  const list = Array.isArray(strokes) ? strokes : [];

  return list.map((stroke) => {
    const corrected = correctStroke(stroke, options);

    return {
      id: stroke?.id || "",
      points: corrected.points,
      segments: corrected.segments,
      original: corrected.original,
      correction: corrected.correction,
      conflict: corrected.conflict,
    };
  });
}

/* A one-line summary for the status bar. */
export function correctionSummary(corrected) {
  const list = Array.isArray(corrected) ? corrected : [];

  const count = (kind) => list.filter((entry) => entry?.correction?.kind === kind).length;

  return {
    total: list.length,
    lines: count("line"),
    curves: count("curve"),
    circles: count("circle"),
    ellipses: count("ellipse"),
    arcs: count("arc"),
    conflicts: list.filter((entry) => entry?.conflict?.severity === "error").length,
  };
}

/* Restore a corrected stroke to exactly what was drawn. */
export function restoreOriginal(corrected) {
  const original = (corrected?.original || []).map(copyPoint);

  return {
    points: original,
    segments: beziersThrough(original),
    original,
    correction: { kind: "curve", confidence: 1, restored: true },
    restored: true,
  };
}

export default {
  fitLine,
  fitCircle,
  fitEllipse,
  simplify,
  smooth,
  beziersThrough,
  closureGap,
  findCorners,
  findCurvatureBreaks,
  splitAtCorners,
  classifySegment,
  anchorsFor,
  centreFor,
  correctStroke,
  correctSketch,
  analyseConflict,
  correctionSummary,
  restoreOriginal,
};
