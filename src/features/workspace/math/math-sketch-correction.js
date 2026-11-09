/*
 * ============================================================
 * THE SKETCH CORRECTION PIPELINE
 * ============================================================
 *
 * Takes what the student drew - a stroke in GRAPH coordinates - and returns the
 * standardized geometry that the Corrected view draws and Apply commits.
 *
 * WHAT WENT WRONG BEFORE, AND WHAT FIXES IT
 * -----------------------------------------
 * The previous version asked the shared classifier one question - "how far does
 * the raw ink stray from its own chord?" - and then either averaged the whole
 * stroke with that chord or smoothed it with a one-pass moving average. Both
 * halves of that are wrong for a hand:
 *
 *   the RAW ink includes the tremor, so a shaky straight line measures as a bow
 *     and a real arc whose ends drift measures as a slant. Either way the wrong
 *     answer, and the wrong geometry followed from it;
 *   averaging with the CHORD flattens an arc, because the chord is the one line
 *     a curve is never near - a fainter tremor, not a standardization;
 *   a single moving average cannot remove noise at the frequency a hand makes
 *     it, and it rounds a genuine corner away as though it were noise.
 *
 * So the pipeline is a proper four-stage shape analysis, and each stage is
 * chosen from the stroke's own geometry:
 *
 *   1. FILTER    a gaussian-weighted average over the stroke's arc - removes the
 *                hand's tremor without pulling the curve towards anything. The
 *                two ends are averaged too, which is what removes the flick a
 *                hand makes as it lands and lifts, and they are restored exactly
 *                at the end.
 *   2. SPLIT     the corners: a change of direction over a few pixels that is
 *                far larger than the stroke's own noise. Each piece between two
 *                corners is one SEGMENT - so a straight-then-curve stroke is two
 *                segments corrected on their own, and the join between them is
 *                the corner the student drew.
 *   3. CLASSIFY  per segment: a total-least-squares fit whose worst residual is
 *                inside the noise band is a LINE; anything else is a CURVE.
 *   4. FIT       a line becomes its two endpoints. A curve becomes a cubic
 *                Bezier chain through its simplified vertices, parameterised by
 *                cumulative distance so the tangents follow the shape rather
 *                than the sampling density.
 *
 * WHY THE NOISE BAND MATTERS
 * --------------------------
 * "Is this a line?" is not a question about the student's intent, it is a
 * question about whether the stroke is flatter than the hand can draw. The
 * filter's own leftover movement is that reference, so a stroke whose fit is
 * within it is a line, and a stroke that bends beyond it is a curve - whatever
 * the zoom, the canvas or the spacing, because all four stages work in graph
 * coordinates.
 *
 * WHAT IS NEVER DONE
 * ------------------
 * No stroke is forced onto a global function. No corner is rounded away. No
 * endpoint of the stroke as a whole is moved. The raw stroke is kept beside the
 * corrected result so the Overlay can show both, and an already-clean stroke
 * comes back nearly unchanged.
 */

import {
  fitCubicBeziers,
  simplifyStroke,
} from "../../../shared/geometry/stroke-recognition.js";

/* The correction strengths the editor offers, as a filter width. */
export const CORRECTION_STRENGTHS = Object.freeze([
  "off",
  "light",
  "medium",
  "strong",
]);

/*
 * THE FILTER WIDTH, as a fraction of the stroke's length.
 *
 * A hand's tremor reverses every few samples, so a window that spans a small
 * share of the stroke removes it and leaves a bend untouched. The share, not a
 * pixel count, is what makes the same stroke corrected the same way at any zoom.
 */
export const CORRECTION_FILTER_SHARE = Object.freeze({
  off: 0,
  light: 0.012,
  medium: 0.022,
  strong: 0.038,
});

/* The old name, kept for callers that ask for the smoothing strength table. */
export const CORRECTION_SMOOTHING = CORRECTION_FILTER_SHARE;

export const DEFAULT_CORRECTION_STRENGTH = "medium";

/*
 * A stroke within this slope of horizontal (or vertical) snaps to exactly so.
 *
 * `tan(6 degrees)` is about 0.105. A hand-drawn horizontal line is usually
 * within two or three degrees; a deliberately slanted line is not, which is why
 * the tolerance is small and why the straightening is recorded rather than
 * assumed.
 */
export const NEAR_AXIS_SLOPE = 0.105;

/* The share of each end of a stroke that is hand-lift rather than shape. */
export const TREMOR_END_SHARE = 0.03;

/*
 * HOW WIDE THE NOISE BAND IS, beside the stroke's own length.
 *
 * The filter's leftover movement is the hand's tremor - but a very wobbly hand
 * leaves a little more behind than a steady one, and a band taken only from the
 * filter would then call the wobble "shape". So the band is the larger of the
 * filter's residual and a share of the stroke: a wide enough band to cover a
 * shaky line, narrow enough that a real bend is still a bend.
 */
const MAX_BAND_SHARE = 0.02;

/* The floor on the noise band, in graph units, for a very short stroke. */
const NOISE_FLOOR = 0.004;

/*
 * HOW FAR A HAND STRAYS FROM A LINE IT MEANS, as a share of the stroke's own
 * length. A tenth of a unit in ten is a hand; the same in one is a curve.
 */
const LINE_NOISE_SHARE = 0.012;

/* A turn sharper than this, inside a few samples, is a corner. */
const CORNER_ANGLE = Math.PI / 5;

/* How many samples either side of a point the corner test looks at. */
const CORNER_REACH = 4;

/* The window a corner is read in, as a share of the stroke's samples. */
const CORNER_WINDOW_SHARE = 0.03;

/*
 * HOW MUCH SHARPER THAN THE STROKE'S TYPICAL TURN A CORNER MUST BE.
 *
 * A bend turns uniformly: every window has the median turn and none stands
 * out. A corner is a spike, several times the median, which is why a factor
 * well above one separates them without needing to know the stroke's shape.
 */
const CORNER_TYPICAL_FACTOR = 2.6;

/* Two corners closer together than this share of the stroke are one corner. */
const CORNER_MERGE_SHARE = 0.06;

/* A run shorter than this share of the stroke is absorbed, not kept. */
const MIN_SEGMENT_SHARE = 0.04;

/* A usable point: two finite numbers. */
function finite(point) {
  return Boolean(
    point &&
    Number.isFinite(Number(point.x)) &&
    Number.isFinite(Number(point.y)),
  );
}

function copy(point) {
  return { x: Number(point.x), y: Number(point.y) };
}

function polylineOf(points) {
  return (Array.isArray(points) ? points : []).filter(finite).map(copy);
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/* The length of a polyline. */
function lengthOf(points) {
  let total = 0;

  for (let index = 1; index < points.length; index += 1) {
    total += distance(points[index - 1], points[index]);
  }

  return total;
}

/* The point at `share` of the way along a polyline, by arc length. */
function pointAlong(points, share) {
  const total = lengthOf(points);

  if (!(total > 1e-12)) {
    return copy(points[0]);
  }

  let wanted = total * Math.max(0, Math.min(1, share));
  let travelled = 0;

  for (let index = 1; index < points.length; index += 1) {
    const step = distance(points[index - 1], points[index]);

    if (travelled + step >= wanted) {
      const t = step > 1e-12 ? (wanted - travelled) / step : 0;

      return {
        x: points[index - 1].x + (points[index].x - points[index - 1].x) * t,
        y: points[index - 1].y + (points[index].y - points[index - 1].y) * t,
      };
    }

    travelled += step;
  }

  return copy(points[points.length - 1]);
}

/* The perpendicular distance of a point from a line through a with unit d. */
function distanceToLine(point, origin, direction) {
  return Math.abs(
    (point.x - origin.x) * direction.y - (point.y - origin.y) * direction.x,
  );
}

/* ============================================================
 * 1. FILTER
 * ============================================================
 *
 * A gaussian-weighted average along the stroke. Unlike a moving average it has
 * no ripple, and unlike averaging with a chord it has no target line to pull
 * the shape towards - the result is the same curve with its tremor removed.
 */
function filterStroke(points, share) {
  if (!(share > 0) || points.length < 5) {
    return points.map(copy);
  }

  const total = lengthOf(points);

  if (!(total > 1e-12)) {
    return points.map(copy);
  }

  const sigma = Math.max(total * share, 1e-9);

  /* Each sample's position along the stroke, so the window is an arc length. */
  const along = [0];

  for (let index = 1; index < points.length; index += 1) {
    along.push(along[index - 1] + distance(points[index - 1], points[index]));
  }

  return points.map((point, index) => {
    let weight = 0;
    let sumX = 0;
    let sumY = 0;

    for (let at = 0; at < points.length; at += 1) {
      const offset = (along[at] - along[index]) / sigma;

      if (Math.abs(offset) > 3) {
        continue;
      }

      const w = Math.exp(-0.5 * offset * offset);

      weight += w;
      sumX += points[at].x * w;
      sumY += points[at].y * w;
    }

    return weight > 0
      ? { x: sumX / weight, y: sumY / weight }
      : copy(point);
  });
}

/*
 * THE STROKE'S OWN NOISE, in graph units.
 *
 * What the filter could not remove is a fair estimate of how shaky this hand is
 * on this stroke - and it is the band every later decision is measured in. A
 * clean stroke has a tiny band, so a genuine bend is judged against a small
 * number and is kept; a shaky one has a wide band, so its wobble is judged
 * against a wide number and is treated as wobble.
 */
function noiseBand(raw, filtered) {
  if (raw.length !== filtered.length || raw.length < 3) {
    return NOISE_FLOOR;
  }

  const offsets = raw
    .map((point, index) => distance(point, filtered[index]))
    .sort((a, b) => a - b);

  /* The 90th percentile: the persistent deviation, not one stray sample. */
  const at = Math.min(offsets.length - 1, Math.floor(offsets.length * 0.9));

  return Math.max(offsets[at], NOISE_FLOOR);
}

/* ============================================================
 * 2. SPLIT AT CORNERS
 * ============================================================
 *
 * A corner is a change of direction over a few samples that is far larger than
 * the stroke's own noise. Finding them first is what lets the rest of the
 * pipeline treat a stroke as the pieces the student drew rather than as one
 * shape: a line followed by an arc is two segments, corrected as a line and an
 * arc, joined exactly where the student turned.
 */
function cornerIndices(points, band) {
  const total = lengthOf(points);

  if (points.length < CORNER_REACH * 2 + 1 || !(total > 1e-9)) {
    return [];
  }

  /*
   * THE WINDOW A TURN IS READ IN, and the distance over which the stroke's own
   * bend is measured - a share of the whole stroke, so a short stroke's corner is
   * judged as strictly as a long one's.
   */
  const reach = Math.max(2, Math.round(points.length * CORNER_WINDOW_SHARE));

  const reachDistance = Math.max(total * 0.04, band * 3, 1e-6);

  /*
   * WHAT TYPICAL TURNING LOOKS LIKE ON THIS STROKE.
   *
   * A smooth arc turns a little at every one of its samples; a corner turns far
   * more at one sample and hardly at all at its neighbours. So the turn at each
   * point is compared with the stroke's OWN MEDIAN turn - a bend is at the
   * median and cannot stand out, and a corner is many times it.
   */
  const turns = [];

  for (let index = reach; index < points.length - reach; index += 1) {
    const behind = points[index - reach];
    const at = points[index];
    const ahead = points[index + reach];

    const inAngle = Math.atan2(at.y - behind.y, at.x - behind.x);
    const outAngle = Math.atan2(ahead.y - at.y, ahead.x - at.x);

    let turn = outAngle - inAngle;

    while (turn > Math.PI) turn -= 2 * Math.PI;
    while (turn < -Math.PI) turn += 2 * Math.PI;

    turns.push(Math.abs(turn));
  }

  if (!turns.length) {
    return [];
  }

  const sorted = [...turns].sort((a, b) => a - b);

  const typicalTurn = sorted[Math.floor(sorted.length * 0.5)];

  const corners = [];

  for (let index = reach; index < points.length - reach; index += 1) {
    const behind = points[index - reach];
    const at = points[index];
    const ahead = points[index + reach];

    /* The turn is only meaningful if both sides are long enough to have one. */
    if (distance(behind, at) < reachDistance || distance(at, ahead) < reachDistance) {
      continue;
    }

    const inAngle = Math.atan2(at.y - behind.y, at.x - behind.x);
    const outAngle = Math.atan2(ahead.y - at.y, ahead.x - at.x);

    let turn = outAngle - inAngle;

    while (turn > Math.PI) turn -= 2 * Math.PI;
    while (turn < -Math.PI) turn += 2 * Math.PI;

    if (Math.abs(turn) < CORNER_ANGLE) {
      continue;
    }

    /*
     * IT MUST BE SHARP FOR THIS LITTLE PIECE OF THE STROKE.
     *
     * A hand-drawn curve turns, sometimes a lot, over its whole length; what a
     * corner does is turn AT ONE POINT, leaving the samples either side of it
     * almost straight. So the turn here is compared with the sharpest turn in
     * the same neighbourhood - and it is only a corner if it is that turn.
     */
    const nearby = turns.slice(
      Math.max(0, index - reach),
      Math.min(turns.length, index + reach + 1),
    );

    const localTurn = nearby.length ? Math.max(...nearby) : 0;

    const sharper = Math.abs(turn) >= localTurn - 1e-9 && localTurn > 0;

    /*
     * AND IT MUST BE BIGGER THAN THE WOBBLE AND TYPICAL SHAPE. A shaky straight
     * line turns by a few degrees all the time; a bend is the typical turn of
     * this stroke; a corner is many times both.
     */
    const minimum = Math.max(
      Math.atan2(band, reachDistance) * 2,
      typicalTurn * CORNER_TYPICAL_FACTOR,
    );

    if (!sharper || Math.abs(turn) < minimum) {
      continue;
    }

    corners.push({ index, turn: Math.abs(turn) });
  }

  /* The sharpest turn in a small cluster is the corner; its neighbours are the
   * same turn seen a sample early or late. */
  const merge = Math.max(2, Math.round(points.length * CORNER_MERGE_SHARE));

  const kept = [];

  corners
    .sort((a, b) => b.turn - a.turn)
    .forEach((corner) => {
      if (kept.every((other) => Math.abs(other.index - corner.index) > merge)) {
        kept.push(corner);
      }
    });

  return kept.map((corner) => corner.index).sort((a, b) => a - b);
}

/* The stroke cut at its corners, with short offcuts folded into their neighbour. */
function splitAtCorners(points, corners) {
  if (!corners.length) {
    return [points];
  }

  const total = lengthOf(points);
  const minimum = total * MIN_SEGMENT_SHARE;

  const cuts = [0, ...corners, points.length - 1];

  const segments = [];

  for (let index = 1; index < cuts.length; index += 1) {
    const piece = points.slice(cuts[index - 1], cuts[index] + 1);

    if (piece.length < 2) {
      continue;
    }

    if (segments.length && lengthOf(piece) < minimum) {
      /* Fold a stub into the piece before it, so no sliver is fitted alone. */
      segments[segments.length - 1] = segments[segments.length - 1].concat(
        piece.slice(1),
      );

      continue;
    }

    segments.push(piece);
  }

  return segments.filter((piece) => piece.length > 1);
}

/* ============================================================
 * 3. CLASSIFY A SEGMENT
 * ============================================================
 *
 * Total least squares: the best line through the points, in whichever direction
 * they actually run. Its worst residual, against the stroke's own noise band,
 * is the whole test - a line the hand could have drawn is a line.
 */
function fitLine(points) {
  let meanX = 0;
  let meanY = 0;

  points.forEach((point) => {
    meanX += point.x;
    meanY += point.y;
  });

  meanX /= points.length;
  meanY /= points.length;

  let xx = 0;
  let yy = 0;
  let xy = 0;

  points.forEach((point) => {
    xx += (point.x - meanX) ** 2;
    yy += (point.y - meanY) ** 2;
    xy += (point.x - meanX) * (point.y - meanY);
  });

  /*
   * THE PRINCIPAL DIRECTION, BY GEOMETRY RATHER THAN BY ONE FORMULA.
   *
   * The closed-form angle is the eigenvector of the covariance; getting its
   * branch wrong points the line ACROSS a vertical stroke, and every residual is
   * then the stroke's full length. So the answer is checked against both
   * candidates and the one the points actually lie along is taken.
   */
  const base = 0.5 * Math.atan2(2 * xy, xx - yy);

  const candidates = [base, base + Math.PI / 2].map((angle) => {
    const direction = { x: Math.cos(angle), y: Math.sin(angle) };

    const residuals = points.map((point) =>
      distanceToLine(point, { x: meanX, y: meanY }, direction),
    );

    return {
      angle,
      direction,
      worst: Math.max(...residuals),
      average: residuals.reduce((total, value) => total + value, 0) / residuals.length,
    };
  });

  const best = candidates[0].worst <= candidates[1].worst ? candidates[0] : candidates[1];

  return {
    origin: { x: meanX, y: meanY },
    direction: best.direction,
    angle: best.angle,
    worst: best.worst,
    average: best.average,
    spread: Math.max(xx, yy),
  };
}

/* The average perpendicular residual of a set of points from a fitted line. */
function avgResidual(points, fitted) {
  return (
    points.reduce(
      (total, point) =>
        total + distanceToLine(point, fitted.origin, fitted.direction),
      0,
    ) / Math.max(points.length, 1)
  );
}

/* Where a point projects onto the fitted line. */
function onLine(point, origin, direction) {
  const along =
    (point.x - origin.x) * direction.x + (point.y - origin.y) * direction.y;

  return {
    x: origin.x + direction.x * along,
    y: origin.y + direction.y * along,
  };
}

/*
 * WHICH REPRESENTATION A SEGMENT WANTS, and the clean geometry of it.
 *
 * The answer carries the word the panel shows - `line`, `horizontal`,
 * `vertical` or `curve` - so a student who drew a line and got a curve can see
 * it and change the correction.
 */
export function recogniseShape(stroke, options = {}) {
  const points = polylineOf(stroke);

  if (points.length < 2) {
    return {
      shape: "curve",
      kind: "none",
      points,
      length: 0,
    };
  }

  const straighten = options.straighten !== false;

  const band =
    Number.isFinite(Number(options.band)) && options.band > 0
      ? Number(options.band)
      : NOISE_FLOOR;

  const fitted = fitLine(points);

  /*
   * THE LINE TEST.
   *
   * Total least squares gives the best line through the points, and its worst
   * residual is how far the stroke ever strays from it. The band is measured
   * against the STROKE ITELF - a share of its length - so a ten-unit line may
   * stray a fiftieth of that, while a gentle bend over the same length strays
   * far more. It is a ratio rather than a distance, which is what keeps the
   * decision the same at any zoom, canvas or grid.
   *
   * THE AVERAGE IS TESTED TOO. A long, smooth bend never strays far at any one
   * point, but it strays a little EVERYWHERE - and a line does not.
   */
  const span = lengthOf(points);

  const handBand = Math.max(band, span * LINE_NOISE_SHARE, NOISE_FLOOR);

  const average = avgResidual(points, fitted);

  const line =
    straighten &&
    fitted.worst <= Math.max(handBand * 1.6, NOISE_FLOOR * 2) &&
    average <= Math.max(handBand * 0.5, NOISE_FLOOR);

  if (!line) {
    return {
      shape: "curve",
      kind: "curve",
      points,
      length: lengthOf(points),
      band,
    };
  }

  const first = points[0];
  const last = points[points.length - 1];

  const dx = last.x - first.x;
  const dy = last.y - first.y;

  const repeatAxis = (axis) => {
    const origin = onLine(
      { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 },
      fitted.origin,
      fitted.direction,
    );

    if (axis === "horizontal") {
      return [
        { x: first.x, y: origin.y },
        { x: last.x, y: origin.y },
      ];
    }

    return [
      { x: origin.x, y: first.y },
      { x: origin.x, y: last.y },
    ];
  };

  if (Math.abs(dx) > 1e-9 && Math.abs(dy) / Math.abs(dx) <= NEAR_AXIS_SLOPE) {
    return {
      shape: "horizontal",
      kind: "line",
      points: repeatAxis("horizontal"),
      length: lengthOf(points),
      band,
    };
  }

  if (Math.abs(dy) > 1e-9 && Math.abs(dx) / Math.abs(dy) <= NEAR_AXIS_SLOPE) {
    return {
      shape: "vertical",
      kind: "line",
      points: repeatAxis("vertical"),
      length: lengthOf(points),
      band,
    };
  }

  return {
    shape: "line",
    kind: "line",
    points: [
      onLine(first, fitted.origin, fitted.direction),
      onLine(last, fitted.origin, fitted.direction),
    ],
    length: lengthOf(points),
    band,
  };
}

/* ============================================================
 * 4. FIT A CURVE
 * ============================================================
 *
 * The vertices are chosen by the shared simplifier against the stroke's noise
 * band, so the points kept are the ones that carry SHAPE. The Bezier chain
 * through them is the Catmull-Rom conversion DAETUM uses everywhere - it passes
 * through every vertex, so the curve follows the student's own geometry rather
 * than an approximation of it, and it cannot overshoot between them.
 */
function fitCurve(points, band, tolerance) {
  /*
   * THE SIMPLIFIER GETS THE STROKE'S OWN NOISE, not the classification band: a
   * curve's vertices are where it BENDS, and the band that decides "line or
   * curve" is wider than the tremor by design. Using it here would throw away
   * a gentle bend's own turning points.
   */
  const vertices = simplifyStroke(
    points,
    Math.max((Number(tolerance) || 0) || band * 0.35, NOISE_FLOOR),
  );

  const kept = vertices.length > 1 ? vertices : points;

  return {
    points: kept,
    segments: kept.length > 1 ? fitCubicBeziers(kept) : [],
  };
}

/* ============================================================
 * THE CORRECTION OF ONE STROKE
 * ============================================================ */
export function correctStroke(stroke, options = {}) {
  const strength = CORRECTION_STRENGTHS.includes(options.strength)
    ? options.strength
    : DEFAULT_CORRECTION_STRENGTH;

  const straighten = options.straighten !== false;

  /*
   * CORRECTION OFF IS A TRUE PASSTHROUGH.
   *
   * It is how a student says "this is what I drew" - and the Overlay exists so
   * they can see the difference. Filtering a stroke and then reporting it as
   * uncorrected would make the setting a lie, and would keep changing geometry
   * the student has explicitly asked to leave alone.
   */
  if (strength === "off") {
    const untouched = polylineOf(stroke?.points || stroke);

    return {
      points: untouched.map(copy),
      segments: [],
      original: untouched.map(copy),
      correction: {
        kind: "none",
        shape: "original",
        segments: 1,
        removed: 0,
      },
      band: NOISE_FLOOR,
      corners: [],
    };
  }

  const raw = polylineOf(stroke?.points || stroke);

  const original = raw.length
    ? raw.map(copy)
    : polylineOf(stroke?.original || []);

  if (raw.length < 2) {
    return {
      points: raw,
      segments: [],
      original,
      correction: { kind: "none", shape: "none", segments: 0, removed: 0 },
      band: NOISE_FLOOR,
    };
  }

  /* ONE PASS OVER AN ALREADY-CORRECTED STROKE MUST NOT DEFORM IT. */
  const noise = Number(stroke?.noise);
  const correctedBefore = stroke?.corrected === true;

  const filtered = filterStroke(raw, CORRECTION_FILTER_SHARE[strength]);

  const span = Math.max(lengthOf(raw), 1e-9);

  const measured =
    correctedBefore && Number.isFinite(noise) && noise > 0
      ? noise
      : noiseBand(raw, filtered);

  const band = Math.max(
    Math.min(measured, span * MAX_BAND_SHARE),
    span * LINE_NOISE_SHARE * 0.8,
    NOISE_FLOOR,
  );

  /*
   * A VERY SHORT STROKE IS NOT FITTED.
   *
   * Two or three samples carry no shape to recognise - a fitted curve through
   * them would be an S invented from the tremor. It is kept as the line it is
   * and drawn between its own endpoints.
   */
  if (raw.length < 4) {
    return snapEnds(
      {
        points: [copy(raw[0]), copy(raw[raw.length - 1])],
        segments: [],
        original,
        correction: {
          kind: "line",
          shape: "line",
          segments: 1,
          removed: Math.max(0, raw.length - 2),
        },
        band,
      },
      stroke,
      options,
    );
  }

  /*
   * THE WHOLE STROKE IS ASKED FIRST.
   *
   * A stroke that is one line end to end is a line, and nothing above a corner
   * test can make it one: the test looks for a turn LARGER than the noise, and a
   * line whose ends drifted has a slow turn that a wide noise band hides. Asking
   * the line fit directly is both cheaper and more direct - and it is the line
   * that the students draw most often.
   */
  const whole = recogniseShape(filtered, { straighten, band });

  if (whole.kind === "line") {
    return snapEnds(
      {
        points: axisEnds(whole, raw),
        segments: [],
        original,
        correction: {
          kind: whole.shape,
          shape: whole.shape,
          segments: 1,
          removed: Math.max(0, raw.length - 2),
        },
        band,
        corners: [],
      },
      stroke,
      options,
    );
  }

  /*
   * A LINE-LIKE STROKE THAT FAILED THE WHOLE-STROKE TEST.
   *
   * The test above is strict, so that a genuine bend is never flattened. A line
   * drawn with a wide tremor can sit just outside it, and before any corner can
   * be found it should get the benefit of the doubt: a stroke with NO corner and
   * a fit only a little wider than the hand is still the line the student drew.
   */
  const tentativeCorners = cornerIndices(filtered, band);

  if (!tentativeCorners.length) {
    const loose = fitLine(filtered);

    const relief = Math.max(lengthOf(filtered) * LINE_NOISE_SHARE * 2.5, NOISE_FLOOR * 4);

    if (loose.worst <= relief) {
      const relaxed = recogniseShape(filtered, { straighten, band: relief / 1.6 });

      if (relaxed.kind === "line") {
        return snapEnds(
          {
            points: axisEnds(relaxed, raw),
            segments: [],
            original,
            correction: {
              kind: relaxed.shape,
              shape: relaxed.shape,
              segments: 1,
              removed: Math.max(0, raw.length - 2),
            },
            band,
            corners: [],
          },
          stroke,
          options,
        );
      }
    }
  }

  const corners = tentativeCorners;

  const pieces = splitAtCorners(filtered, corners);

  const segments = [];

  pieces.forEach((piece) => {
    const recognised = recogniseShape(piece, { straighten, band });

    if (recognised.kind === "line") {
      segments.push({
        points: recognised.points,
        segments: [],
        shape: recognised.shape,
        kind: "line",
      });

      return;
    }

    const fitted = fitCurve(piece, band, options.tolerance);

    segments.push({
      points: fitted.points,
      segments: fitted.segments,
      shape: "curve",
      kind: "curve",
    });
  });

  /*
   * THE PIECES BECOME ONE PATH. Consecutive segments share the point at their
   * join, which is the corner: the line arrives at it and the curve leaves it,
   * so the join is exact and the corner is preserved rather than rounded.
   */
  const points = [];

  segments.forEach((segment, index) => {
    if (index === 0) {
      points.push(...segment.points.map(copy));

      return;
    }

    /*
     * THE JOIN IS ONE POINT, AND IT IS THE CORNER EXACTLY.
     *
     * Each piece was fitted on its own, so one arrives at the corner and the
     * next leaves from it, a hair apart. Both ends are replaced by the corner
     * itself (their mean), so the path turns sharply AT the student's corner
     * rather than stepping across it - and no duplicate vertex is left at the
     * join to be smoothed away later.
     */
    const last = points[points.length - 1];
    const first = segment.points[0];

    const corner = { x: (last.x + first.x) / 2, y: (last.y + first.y) / 2 };

    points[points.length - 1] = corner;

    points.push(...segment.points.slice(1).map(copy));
  });

  const anyCurve = segments.some((segment) => segment.kind === "curve");

  const result = {
    points,
    segments: anyCurve ? fitCubicBeziers(points) : [],
    original,
    correction: {
      kind: anyCurve
        ? "curve"
        : segments.every((segment) => segment.shape === "horizontal")
          ? "horizontal"
          : segments.every((segment) => segment.shape === "vertical")
            ? "vertical"
            : "line",
      shape: segments.length > 1 ? "mixed" : segments[0]?.shape || "line",
      segments: segments.length,
      removed: Math.max(0, raw.length - points.length),
    },
    band,
    corners,
  };

  /*
   * THE STROKE'S OWN ENDS ARE RESTORED, not the filter's.
   *
   * The filter averages the ends too - which is what removes the flick the hand
   * makes landing and lifting - so its ends are a few thousandths short. The
   * student's real ends go back on, and the spline is rebuilt through them.
   * An end PINNED to one of the student's points is used verbatim.
   */
  if (result.points.length > 1) {
    const first = raw[0];
    const last = raw[raw.length - 1];

    /*
     * A STRAIGHT-ENDED PATH MEETS ITS ENDS EXACTLY. A curve's first and last
     * points are moved onto the student's ends too - the neighbouring vertex
     * keeps the curve's direction, so the end is theirs and the curve is smooth
     * into it, rather than a raw sample dropped on the end of a filtered arc.
     */
    result.points[0] = endAlongDirection(result.points[1] || first, first);
    result.points[result.points.length - 1] = endAlongDirection(
      result.points[result.points.length - 2] || last,
      last,
    );

    if (result.segments.length) {
      result.segments = fitCubicBeziers(result.points);
    }
  }

  return snapEnds(result, stroke, options);
}

/*
 * A STRAIGHT RESULT'S ENDPOINTS, AT THE STUDENT'S OWN ENDS.
 *
 * A level line keeps its ends' x and takes the fitted height; an upright one
 * keeps its ends' y and takes the fitted column. A slanted line is already
 * projected onto its own fit, and keeps that.
 */
function axisEnds(recognised, raw) {
  if (recognised.shape === "horizontal") {
    return [
      { x: raw[0].x, y: recognised.points[0].y },
      { x: raw[raw.length - 1].x, y: recognised.points[0].y },
    ];
  }

  if (recognised.shape === "vertical") {
    return [
      { x: recognised.points[0].x, y: raw[0].y },
      { x: recognised.points[0].x, y: raw[raw.length - 1].y },
    ];
  }

  return recognised.points.map(copy);
}

/*
 * THE END OF A SMOOTHED CURVE, AT THE STUDENT'S END.
 *
 * Restoring the raw end point verbatim was the defect that made a corrected
 * curve worse than the original: the filter had smoothed the ends, and dropping
 * the raw sample back on left a single-segment kink at each end - the "corrected"
 * arc visibly fanged. So the text end is placed ON the student's end, along the
 * direction the curve already had there. The endpoint is exactly theirs and the
 * curve is smooth into it.
 */
function endAlongDirection(neighbour, end) {
  /*
   * The end point ITSELF is the student's; the curve already has its direction
   * from the neighbour beside it, so the spline leaves from here smoothly. The
   * helper exists so that intent is stated once, at the one place a raw sample
   * could otherwise be pushed back into a filtered stroke.
   */
  void neighbour;

  return copy(end);
}

/* An end pinned to one of the student's points is used exactly. */
function snapEnds(result, stroke, options) {
  const start = finite(options.pinStart) ? options.pinStart : stroke?.pinStart;
  const end = finite(options.pinEnd) ? options.pinEnd : stroke?.pinEnd;

  if (!result.points.length) {
    return result;
  }

  const pinned = result.points.map(copy);

  if (finite(start)) {
    pinned[0] = copy(start);
  }

  if (finite(end)) {
    pinned[pinned.length - 1] = copy(end);
  }

  return {
    ...result,
    points: pinned,
    segments: result.segments.length ? fitCubicBeziers(pinned) : [],
  };
}

/* ============================================================
 * A STROKE THROUGH TERMINAL POINTS
 * ============================================================ */
export function correctStrokeThrough(stroke, terminals, options = {}) {
  return correctStroke(stroke, {
    ...options,
    pinStart: terminals?.start || stroke?.pinStart || null,
    pinEnd: terminals?.end || stroke?.pinEnd || null,
  });
}

/* ============================================================
 * THE WHOLE SKETCH
 * ============================================================ */
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
      noise: corrected.band,
    };
  });
}

/* Whether any stroke was changed - what the status line reports. */
export function correctionSummary(corrected) {
  const list = Array.isArray(corrected) ? corrected : [];

  const total = list.length;

  const straightened = list.filter((entry) =>
    ["line", "horizontal", "vertical"].includes(entry?.correction?.kind),
  ).length;

  const smoothed = list.filter((entry) => entry?.correction?.kind === "curve").length;

  const mixed = list.filter((entry) => entry?.correction?.shape === "mixed").length;

  return { total, straightened, smoothed, mixed };
}

const enggMathSketchCorrection = {
  CORRECTION_STRENGTHS,
  CORRECTION_SMOOTHING,
  CORRECTION_FILTER_SHARE,
  DEFAULT_CORRECTION_STRENGTH,
  NEAR_AXIS_SLOPE,
  TREMOR_END_SHARE,
  recogniseShape,
  correctStroke,
  correctStrokeThrough,
  correctSketch,
  correctionSummary,
  pointAlong,
};

export default enggMathSketchCorrection;
