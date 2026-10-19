/*
 * ========================================================
 * POINT AND SEGMENT PRIMITIVES
 * ========================================================
 *
 * The smallest geometry in the application: how far apart two points are, how
 * far a point is from a segment, and the handful of related answers. They are
 * here, in one module, because they were previously written out again
 * wherever they were needed:
 *
 *     distance            hit-testing, construction-geometry, object-snap,
 *                         the sketch editor
 *     distanceToSegment   hit-testing, dimension-inference, the sketch editor
 *     normalise           dimension-model, and a dozen ad-hoc `/ length`
 *                         divisions elsewhere
 *
 * THAT IS NOT MERELY REPETITION. Three copies of `distanceToSegment` are three
 * chances for them to disagree about a degenerate segment, a clamped
 * projection, or the difference between `<=` and `<` at a boundary - and the
 * one that disagrees is the one used by whichever surface the student happens
 * to be on. A hit test that says a click missed and a snap that says it hit
 * are the same question asked twice, and they must give the same answer.
 *
 * So the arithmetic lives here, in `core/`, with no UI and no DOM - the layer
 * everything else is allowed to depend on. Modules that used to define their
 * own now import these, and the behaviour is identical because the
 * implementations were identical.
 *
 * EVERY FUNCTION IS PURE. Nothing here reads or writes the document, the
 * camera or the DOM, so it can be used from the model, the renderer, a test,
 * or a sandbox without any setup.
 */

/*
 * A POINT, COERCED.
 *
 * Several call sites pass a value that may be null, undefined or a partially
 * built object, and each used to test that separately. One predicate here
 * means "is this a point I can do arithmetic on" has a single answer.
 */
export function isPoint(value) {
  return Boolean(value && Number.isFinite(value.x) && Number.isFinite(value.y));
}

/* The distance between two points. Infinity when either is not a point. */
export function distance(first, second) {
  if (!isPoint(first) || !isPoint(second)) {
    return Infinity;
  }

  return Math.hypot(second.x - first.x, second.y - first.y);
}

/*
 * The distance between two points, as a plain number, with no validity
 * checking - for the hot paths where both points are already known good.
 *
 * Separate from `distance` rather than folded into it so the checked version
 * stays the default: a caller that has validated its points can say so, and a
 * caller that has not gets the safe answer.
 */
export function distanceFast(first, second) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

/*
 * The distance from a point to a SEGMENT - not to its infinite line.
 *
 * The projection is clamped to [0, 1], so a point past either end is measured
 * to that END and not to the line's extension. That is what a hit test wants:
 * clicking beyond a drawn line should not count as hitting it.
 *
 * A degenerate segment - both ends the same point - is measured to that point,
 * which is the only sensible answer and is why the `lengthSquared === 0` case
 * is handled explicitly rather than left to divide by zero.
 */
export function distanceToSegment(point, start, end) {
  if (!isPoint(point) || !isPoint(start) || !isPoint(end)) {
    return Infinity;
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;

  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return distanceFast(point, start);
  }

  const ratio = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
    ),
  );

  return Math.hypot(
    point.x - (start.x + ratio * dx),
    point.y - (start.y + ratio * dy),
  );
}

/*
 * A vector, made one unit long.
 *
 * THE ZERO VECTOR IS THE INTERESTING CASE, and it is the reason this is shared
 * rather than re-derived. A direction cannot be computed from a point to
 * itself, and the three answers a caller might want - null, a fallback axis,
 * or the zero vector - are not interchangeable. So this returns NULL, which
 * forces the caller to decide, rather than quietly substituting a direction
 * the student never pointed at.
 *
 * `fallbackAxis` used to be built into one caller's copy, which meant a
 * zero-length leg silently became due east and an angle was measured against
 * a direction that did not exist. A caller that genuinely wants a default can
 * ask for one explicitly - see `unitVectorOr`.
 */
export function unitVector(vector) {
  if (!isPoint(vector)) {
    return null;
  }

  const length = Math.hypot(vector.x, vector.y);

  if (length < 1e-12) {
    return null;
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
  };
}

/* `unitVector`, with an explicit fallback for the zero case. */
export function unitVectorOr(vector, fallback = { x: 1, y: 0 }) {
  return unitVector(vector) || { ...fallback };
}

/*
 * The direction of a segment, as a unit vector, or null when it has none.
 *
 * A segment of no length has no direction, so a raw `end - start` cannot be
 * normalised into one - this returns null rather than a substitute.
 */
export function segmentDirection(start, end) {
  if (!isPoint(start) || !isPoint(end)) {
    return null;
  }

  return unitVector({
    x: end.x - start.x,
    y: end.y - start.y,
  });
}

/*
 * A point a fraction of the way from `start` to `end`.
 *
 * Interpolation, used by the grid, the snap candidates and the profile
 * sampling - all of which used to write the same two lines out.
 */
export function lerpPoint(start, end, t) {
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  };
}

/* The midpoint of a segment. */
export function midpoint(start, end) {
  return lerpPoint(start, end, 0.5);
}

/*
 * The point on a segment nearest another point.
 *
 * The projection of `distanceToSegment`, exposed on its own for the callers
 * that need WHERE rather than HOW FAR - snapping to a point on an entity, and
 * the nearest-point search in the sketch editor.
 */
export function closestPointOnSegment(point, start, end) {
  if (!isPoint(point) || !isPoint(start) || !isPoint(end)) {
    return null;
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;

  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return { x: start.x, y: start.y };
  }

  const ratio = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
    ),
  );

  return {
    x: start.x + ratio * dx,
    y: start.y + ratio * dy,
  };
}

/*
 * The area of the triangle the three points make, signed.
 *
 * Positive when they turn one way, negative the other, zero when collinear -
 * which is how "is this point on that line" is asked without a tolerance on
 * the angle.
 */
export function crossProduct(origin, first, second) {
  return (
    (first.x - origin.x) * (second.y - origin.y) -
    (first.y - origin.y) * (second.x - origin.x)
  );
}

const enggPoints = {
  isPoint,
  distance,
  distanceFast,
  distanceToSegment,
  unitVector,
  unitVectorOr,
  segmentDirection,
  lerpPoint,
  midpoint,
  closestPointOnSegment,
  crossProduct,
};

export default enggPoints;
