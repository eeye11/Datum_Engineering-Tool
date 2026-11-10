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
 *     a wobbly curve      -> a smooth Bezier chain
 *     a box drawn by hand -> four exact lines with real corners
 *
 * An ANCHOR is the one thing that overrides the stroke: the geometry must pass
 * through it, and the solver may not move it because another shape would have
 * been easier to build. When an anchor makes a primitive impossible, the
 * primitive is REJECTED and the conflict reported - never resolved by moving
 * the point.
 *
 * HOW IT WORKS
 * ------------
 *
 *   1. SPLIT. The stroke is divided at its corners - the places where the
 *      direction changes sharply - because a single gesture is often several
 *      shapes. A rounded corner is not a corner, so the splitter looks at the
 *      turn over a window rather than between adjacent samples.
 *
 *   2. CLASSIFY EACH SEGMENT. Every piece is tested against the primitives it
 *      could be, and scored by how far it strays as a SHARE OF ITS OWN SIZE.
 *      A share is what makes the thresholds mean the same thing on a small
 *      sketch and a large one, at any zoom.
 *
 *   3. FIT. The winning primitive is fitted by its own mathematics - total
 *      least squares for a line, Kasa plus Gauss-Newton for a circle, a
 *      conic for an ellipse, a Catmull-Rom chain for a curve.
 *
 *   4. CONSTRAIN. Anchors are pinned into the result, in stroke order, and the
 *      shape between them is kept from the stroke.
 *
 *   5. JOIN. Segments share their endpoints exactly, so a reconstructed shape
 *      has no gaps and no doubled corners.
 *
 * WHAT IS NOT DONE
 * ----------------
 * Nothing is "smoothed" in the cosmetic sense. A curve is smooth because it is
 * a Bezier chain through clean vertices, not because its line was blurred. The
 * original stroke is always kept, so restoring it is a property of the result.
 */

import { resolvePoints, anchorPoints } from "./sketch-points.js";

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

/* A closed stroke is a circle when its radius error is under this share. */
const CIRCLE_TOLERANCE = 0.055;

/* An open stroke is an arc when its radius error is under this share. */
const ARC_TOLERANCE = 0.05;

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

/* The stroke cut at its corners, each piece including both ends. */
export function splitAtCorners(points) {
  const corners = findCorners(points);

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
    const circle = fitCircle(list);

    if (circle) {
      const error = circle.worst / Math.max(circle.radius, EPSILON);

      if (error <= (options.circleTolerance ?? CIRCLE_TOLERANCE)) {
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
       * curve that merely happens to be round-ish.
       */
      if (
        error <= (options.arcTolerance ?? ARC_TOLERANCE) &&
        sweep.sweep >= 0.9
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

  const straight =
    line.worst / span <= (options.lineTolerance ?? LINE_TOLERANCE) &&
    line.average / span <= LINE_TOLERANCE * 0.5;

  if (straight) {
    const first = list[0];
    const last = list[list.length - 1];

    return {
      kind: "line",
      points: [onLine(first, line.origin, line.direction), onLine(last, line.origin, line.direction)],
      confidence: 1 - line.worst / span,
      closed: false,
    };
  }

  /* ---- a general curve ---- */
  return {
    kind: "curve",
    points: list.map(copyPoint),
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

/* The anchors a stroke must honour, in stroke order. */
export function anchorsFor(userPoints = [], options = {}) {
  if (Array.isArray(options.anchors)) {
    return resolvePoints(options.anchors);
  }

  return anchorPoints(userPoints);
}

/*
 * THE GUIDES A STROKE IS STEERED BY.
 *
 * A guide is the SOFT half of the student's intent: the curve is pulled toward
 * it but does not pass through it. That is the whole difference from an
 * anchor, and it is why the two are gathered separately - an anchor is pinned
 * into the path, a guide only bends it.
 */
export function guidesFor(userPoints = [], options = {}) {
  if (Array.isArray(options.guides)) {
    return resolvePoints(options.guides);
  }

  return resolvePoints(userPoints).filter((point) => point.type === "guide");
}

/*
 * PULL A PATH TOWARD ITS GUIDES.
 *
 * Each guide attracts the nearest point of the path by a fraction of the
 * distance between them, so the curve leans toward the guide without reaching
 * it. The pull is applied to the SAMPLED PATH, before the curve is fitted, so
 * the fitted shape inherits the bend rather than being bent afterwards - which
 * would move the anchors it was pinned to.
 *
 * `strength` is deliberately less than one: a guide that pulled all the way
 * would be an anchor, and the student has a separate kind for that.
 */
function pullTowardGuides(points, guides, strength = 0.5) {
  if (!guides.length || points.length < 2) {
    return points.map(copyPoint);
  }

  const result = points.map(copyPoint);

  guides.forEach((guide) => {
    const target = guide.absolute;

    /* `nearestIndex` answers the index itself. */
    const nearest = nearestIndex(result, target);

    /*
     * THE PULL FADES WITH DISTANCE ALONG THE PATH, so a guide bends the curve
     * near itself and leaves the rest of the stroke alone. Without the falloff
     * a single guide would drag the whole path toward it.
     */
    const reach = Math.max(2, Math.round(result.length * 0.25));

    for (let offset = -reach; offset <= reach; offset += 1) {
      const index = nearest + offset;

      if (index < 0 || index >= result.length) {
        continue;
      }

      const falloff = 1 - Math.abs(offset) / (reach + 1);

      const weight = strength * falloff;

      result[index].x += (target.x - result[index].x) * weight;
      result[index].y += (target.y - result[index].y) * weight;
    }
  });

  return result;
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
function pinAnchors(points, anchors) {
  if (!anchors.length || !points.length) {
    return points.map(copyPoint);
  }

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
    .sort((a, b) => a.index - b.index);

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
   * THE GUIDES BEND THE PATH BEFORE ANYTHING IS FITTED TO IT.
   *
   * Applied here, ahead of the anchor pinning and the shape classification, so
   * every later step sees the steered path - and so a guide can never move an
   * anchor, because the anchors are pinned afterwards.
   */
  const guides = guidesFor(options.points || [], options);

  const steered = guides.length ? pullTowardGuides(points, guides) : points;

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
      correction: { kind: "curve", confidence: 1, disabled: true },
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
  const whole = classifySegment(steered, options);

  const isWholePrimitive =
    whole.kind === "circle" || whole.kind === "ellipse";

  /*
   * ONE STROKE MAY BE SEVERAL SHAPES. It is split at its corners, and each
   * piece is reconstructed on its own - which is what stops a box drawn in one
   * gesture from becoming a single wobbly curve.
   */
  const pieces = isWholePrimitive ? [steered] : splitAtCorners(steered);

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
    const shapePoints = single.points.map(copyPoint);

    return {
      points: shapePoints,
      segments: beziersThrough(shapePoints),
      original: points.map(copyPoint),
      correction: {
        kind: single.kind,
        centre: single.centre,
        radius: single.radius ?? null,
        radiusX: single.radiusX ?? null,
        radiusY: single.radiusY ?? null,
        confidence: single.confidence,
        closed: true,
      },
      conflict,
      parts,
    };
  }

  if (single && !rejected && single.kind === "arc") {
    const shapePoints = arcPoints(single);

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
            distance(closestOnArc(anchor.absolute, single), anchor.absolute) >
            Math.max(single.radius * 0.01, 1e-6),
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
          residual: distance(closestOnArc(missed[0].absolute, single), missed[0].absolute),
          message:
            "The fitted arc cannot pass through the anchor, so the stroke is " +
            "kept as a curve through it.",
        },
        parts,
      };
    }

    return {
      points: vertices,
      segments: beziersThrough(vertices),
      original: points.map(copyPoint),
      correction: {
        kind: "arc",
        centre: single.centre,
        radius: single.radius,
        startAngle: single.startAngle,
        endAngle: single.endAngle,
        clockwise: single.clockwise,
        confidence: single.confidence,
        closed: false,
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
    const ends = single.points.map(copyPoint);

    const onLineAnchors = anchors
      .map((anchor) => ({
        point: anchor.absolute,
        along: (anchor.absolute.x - ends[0].x) * (ends[1].x - ends[0].x) +
          (anchor.absolute.y - ends[0].y) * (ends[1].y - ends[0].y),
      }))
      .filter((entry) => entry.along > 0)
      .sort((a, b) => a.along - b.along)
      .map((entry) => copyPoint(entry.point));

    const vertices = [ends[0], ...onLineAnchors, ends[1]];

    return {
      points: vertices,
      segments: beziersThrough(vertices),
      original: points.map(copyPoint),
      correction: { kind: "line", confidence: single.confidence, closed: false },
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
      const piece =
        part.kind === "line"
          ? part.points.map(copyPoint)
          : simplify(
              smooth(part.points, 2),
              Math.max(sizeOf(part.points) * 0.012, Number(options.simplifyTolerance) || 0),
            );

      /* The first piece contributes its start; every piece its end. */
      piece.forEach((point, position) => {
        if (index > 0 && position === 0) {
          return;
        }

        joined.push(point);
      });
    });

    /*
   * THE PIECES ARE JOINED, THEN THE ANCHORS ARE SPLICED IN - for the same
   * reason as the single-curve case: nothing may run over an anchor afterwards.
   */
  const pinned = pinAnchors(joined, anchors);

    return {
      points: pinned,
      segments: beziersThrough(pinned),
      original: points.map(copyPoint),
      correction: {
        kind: "composite",
        confidence: 0.8,
        closed: closureGap(points) <= CLOSURE_TOLERANCE,
        composite: true,
        parts: parts.map((part) => part.kind),
      },
      conflict,
      parts,
    };
  }

  /*
   * A GENERAL CURVE.
   *
   * THE ANCHORS ARE PINNED INTO THE STROKE BEFORE ANYTHING IS SIMPLIFIED.
   *
   * Anchors used to be spliced into the SIMPLIFIED vertices, and by then the
   * smoothing and the RDP pass had moved the nearest vertex a long way from
   * where the student put the point - so the anchor was never found within
   * reach and was silently dropped. Splicing them into the raw stroke first, at
   * the sample they sit on, puts them in the path where they belong; the
   * simplification that follows is then free to keep them because a pinned
   * vertex is a corner and RDP always keeps corners.
   */
  const tolerance = Math.max(sizeOf(points) * 0.012, Number(options.simplifyTolerance) || 0);

  /*
   * SIMPLIFY THE STROKE, THEN SPLICE THE ANCHORS IN.
   *
   * The order matters both ways. Pinning FIRST and smoothing after let the
   * filter pull the anchors off their coordinates - a smoothed sample is an
   * average, and an average is not the point the student placed. Pinning LAST
   * means nothing runs over the anchors afterwards: they are the final word on
   * where the curve passes.
   */
  const vertices = simplify(smooth(points, 2), tolerance);

  const pinned = pinAnchors(vertices, anchors);

  const closed = closureGap(points) <= CLOSURE_TOLERANCE;

  return {
    points: pinned,
    segments: beziersThrough(pinned),
    original: points.map(copyPoint),
    correction: {
      kind: "curve",
      confidence: single?.confidence ?? 0.5,
      closed,
      parts: parts.map((part) => part.kind),
    },
    conflict,
    parts,
  };
}

/*
 * THE STROKE AS A SMOOTH CURVE THROUGH ITS ANCHORS.
 *
 * This is the fallback for a stroke whose primitive cannot honour an anchor: a
 * curve through the anchors can always do so, because the anchors are its
 * vertices. The stroke between them supplies the shape.
 */
function curveThrough(points, anchors) {
  const tolerance = Math.max(sizeOf(points) * 0.012, 0.001);

  const vertices = simplify(smooth(points, 2), tolerance);

  const pinned = pinAnchors(vertices, anchors);

  return {
    points: pinned,
    segments: beziersThrough(pinned),
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
  splitAtCorners,
  classifySegment,
  anchorsFor,
  correctStroke,
  correctSketch,
  analyseConflict,
  correctionSummary,
  restoreOriginal,
};
