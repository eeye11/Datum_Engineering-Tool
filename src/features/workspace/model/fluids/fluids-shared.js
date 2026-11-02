/*
 * ========================================================
 * FLUIDS: GEOMETRY HELPERS EVERY NEW SCHEMATIC TOOL SHARES
 * ========================================================
 *
 * The Fluids tools added after Pipe / Duct, Elbow and Junction - the Reducer /
 * Expander, the Reservoir / Tank, the inline equipment (Pump, Valve, Flow Meter),
 * the free Flow Arrow, the Fluid Level, the Flow Direction Diagram, the Pressure
 * Profile and the Section Plane - all need the same small set of geometrical
 * questions answered:
 *
 *   - where two lines cross, and how far along each the crossing is;
 *   - which way a direction points, and how a rotated symbol maps its own local
 *     coordinates into the drawing;
 *   - how far a point is from a line or a segment;
 *   - what the "small default" of this application is, so a new symbol is drawn
 *     at a size that matches the pipes it sits beside.
 *
 * None of it is engineering. It is arithmetic on drawing coordinates, stated
 * once so nine tools cannot each get "which side of the pipe is the wider wall"
 * slightly differently.
 */

/* ============================================================
 * THE DRAWING'S OWN SMALL DIMENSIONS
 * ============================================================
 *
 * A schematic symbol has to be readable beside a run of pipe, and the run's two
 * walls are `DEFAULT_SCHEMATIC_SEPARATION` apart (4 world units). Everything
 * below is expressed in multiples of that, so a change to the drawing's
 * convention moves the symbols with it instead of leaving a pump the size of a
 * water tower.
 *
 * THESE ARE DRAWING AMOUNTS, NOT ENGINEERING DIMENSIONS. No bore, no nominal
 * size, no standards figure is implied by any of them.
 */
export const SCHEMATIC_UNIT = 4;

/* The radius a circular symbol (a pump, a meter) is drawn at. */
export const DEFAULT_SYMBOL_RADIUS = SCHEMATIC_UNIT * 2.5;

/* How long a reducer's taper is drawn by default. */
export const DEFAULT_TRANSITION_LENGTH = SCHEMATIC_UNIT * 5;

/* The continuation run an endpoint insertion draws, so the piece is visible. */
export const DEFAULT_CONTINUATION_LENGTH = SCHEMATIC_UNIT * 10;

/* The default size of a vessel dragged out in one gesture. */
export const DEFAULT_VESSEL_WIDTH = SCHEMATIC_UNIT * 10;
export const DEFAULT_VESSEL_HEIGHT = SCHEMATIC_UNIT * 7;

/* The default graph frame of a pressure profile. */
export const DEFAULT_PROFILE_WIDTH = SCHEMATIC_UNIT * 18;
export const DEFAULT_PROFILE_HEIGHT = SCHEMATIC_UNIT * 12;

/* The default length of a section trace. */
export const DEFAULT_SECTION_LENGTH = SCHEMATIC_UNIT * 8;

/* The default length of a free flow arrow. */
export const DEFAULT_ARROW_LENGTH = SCHEMATIC_UNIT * 6;

/* ============================================================
 * NUMBERS AND POINTS
 * ============================================================ */

export function finitePoint(point) {
  return (
    Boolean(point) &&
    Number.isFinite(Number(point.x)) &&
    Number.isFinite(Number(point.y))
  );
}

export function finiteNumber(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
}

export function copyPoint(point) {
  return finitePoint(point) ? { x: Number(point.x), y: Number(point.y) } : null;
}

export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(vector, factor) {
  return { x: vector.x * factor, y: vector.y * factor };
}

export function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function lengthOf(vector) {
  return Math.hypot(Number(vector?.x) || 0, Number(vector?.y) || 0);
}

export function distanceBetween(a, b) {
  return Math.hypot(
    Number(a?.x || 0) - Number(b?.x || 0),
    Number(a?.y || 0) - Number(b?.y || 0),
  );
}

/* A unit vector along `a -> b`, or null when the two points coincide. */
export function unitVector(a, b) {
  if (!finitePoint(a) || !finitePoint(b)) {
    return null;
  }

  const dx = Number(b.x) - Number(a.x);
  const dy = Number(b.y) - Number(a.y);
  const length = Math.hypot(dx, dy);

  if (length < 1e-12) {
    return null;
  }

  return { x: dx / length, y: dy / length };
}

/* The normal to a unit vector, turned a quarter turn anticlockwise. */
export function normalOf(direction) {
  return { x: -direction.y, y: direction.x };
}

export function pointAlong(from, direction, distance) {
  return {
    x: from.x + direction.x * distance,
    y: from.y + direction.y * distance,
  };
}

/* The angle a direction makes with +x, in degrees - the Rotate value. */
export function angleOfDirection(direction) {
  if (!direction) {
    return 0;
  }

  return (Math.atan2(direction.y, direction.x) * 180) / Math.PI;
}

export function directionAtAngle(degrees) {
  const radians = (Number(degrees) * Math.PI) / 180;

  return { x: Math.cos(radians), y: Math.sin(radians) };
}

/* Round to a stable number of places, so float noise never reaches the source. */
export function tidy(value, places = 6) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Number(number.toFixed(places));
}

/* ============================================================
 * A SYMBOL'S OWN FRAME
 * ============================================================
 *
 * Every inline symbol is drawn as a shape in ITS OWN coordinates (a circle about
 * the origin, a bow-tie between -h and +h) and placed by a centre and a rotation.
 * This is the one transform between the two, so the canvas, the TikZ writer, the
 * hit test and the handles all place the symbol the same way.
 */
export function localToWorld(frame, local) {
  const angle = ((Number(frame?.rotation) || 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const x = Number(local?.x) || 0;
  const y = Number(local?.y) || 0;

  return {
    x: (frame?.center?.x || 0) + x * cos - y * sin,
    y: (frame?.center?.y || 0) + x * sin + y * cos,
  };
}

export function worldToLocal(frame, world) {
  const angle = ((Number(frame?.rotation) || 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const dx = (Number(world?.x) || 0) - (frame?.center?.x || 0);
  const dy = (Number(world?.y) || 0) - (frame?.center?.y || 0);

  return {
    x: dx * cos + dy * sin,
    y: -dx * sin + dy * cos,
  };
}

/* A symbol's local points, placed in the drawing. */
export function placedPoints(frame, localPoints = []) {
  return localPoints.map((local) => localToWorld(frame, local));
}

/* ============================================================
 * DISTANCE
 * ============================================================ */

/* The foot of the perpendicular from `point` onto the line through a and b. */
export function projectOntoLine(point, a, b) {
  if (!finitePoint(point) || !finitePoint(a) || !finitePoint(b)) {
    return null;
  }

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared < 1e-12) {
    return {
      foot: { x: a.x, y: a.y },
      t: 0,
      distance: distanceBetween(point, a),
    };
  }

  const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;

  const foot = { x: a.x + dx * t, y: a.y + dy * t };

  return { foot, t, distance: Math.hypot(point.x - foot.x, point.y - foot.y) };
}

/* The distance from a point to a SEGMENT (not its infinite line). */
export function distanceToSegment(point, a, b) {
  const projection = projectOntoLine(point, a, b);

  if (!projection) {
    return Infinity;
  }

  if (projection.t >= 0 && projection.t <= 1) {
    return projection.distance;
  }

  return Math.min(distanceBetween(point, a), distanceBetween(point, b));
}

/* Whether a point is inside a closed polygon (even-odd rule). */
export function pointInPolygon(point, polygon = []) {
  if (!finitePoint(point) || polygon.length < 3) {
    return false;
  }

  let inside = false;

  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const a = polygon[index];
    const b = polygon[previous];

    if (!finitePoint(a) || !finitePoint(b)) {
      continue;
    }

    const crosses = a.y > point.y !== b.y > point.y;

    if (
      crosses &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || 1e-12) + a.x
    ) {
      inside = !inside;
    }
  }

  return inside;
}

/* The distance from a point to a closed polygon's outline. */
export function distanceToPolygonOutline(point, polygon = []) {
  let best = Infinity;

  polygon.forEach((corner, index) => {
    const next = polygon[(index + 1) % polygon.length];

    if (!finitePoint(next)) {
      return;
    }

    best = Math.min(best, distanceToSegment(point, corner, next));
  });

  return best;
}

/* Whether a point is on a closed polygon, inside it or within `tolerance`. */
export function polygonContainsPoint(point, polygon = [], tolerance = 0) {
  return (
    pointInPolygon(point, polygon) ||
    distanceToPolygonOutline(point, polygon) <= tolerance
  );
}

/* ============================================================
 * CROSSING
 * ============================================================ */

/*
 * WHERE TWO SEGMENTS CROSS, as the fraction along each - or null.
 *
 * `t` is the fraction along a->b and `u` the fraction along c->d, so a caller
 * can both test "does this run cross that vessel wall" and place a marker at the
 * crossing. Parallel segments never cross, and a collinear overlap is reported
 * as no crossing, because "the two lie on one line" is a different fact from
 * "they meet at a point".
 */
export function segmentIntersection(a, b, c, d) {
  if (
    !finitePoint(a) ||
    !finitePoint(b) ||
    !finitePoint(c) ||
    !finitePoint(d)
  ) {
    return null;
  }

  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;

  const denominator = rx * sy - ry * sx;

  if (Math.abs(denominator) < 1e-12) {
    return null;
  }

  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denominator;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denominator;

  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) {
    return null;
  }

  return {
    t: Math.min(1, Math.max(0, t)),
    u: Math.min(1, Math.max(0, u)),
    point: { x: a.x + rx * t, y: a.y + ry * t },
  };
}

/* ============================================================
 * A RECTANGLE, AS THE FOUR CORNERS IT IS DRAWN FROM
 * ============================================================ */

/*
 * The four corners of a stored rectangle, in order, for a rectangle that stores
 * a corner `position`, a `width`, a `height` and a `rotation` (radians).
 *
 * The optional `sign` lets a vessel grow in the other direction while it is being
 * dragged out - a drag up and to the left stores a negative extent elsewhere in
 * the application, and this is the one place it is normalised.
 */
export function rectangleCorners(position, width, height, rotation = 0) {
  const x = Number(position?.x) || 0;
  const y = Number(position?.y) || 0;
  const w = Number(width) || 0;
  const h = Number(height) || 0;

  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  const place = (dx, dy) => ({
    x: x + dx * cos - dy * sin,
    y: y + dx * sin + dy * cos,
  });

  return [place(0, 0), place(w, 0), place(w, h), place(0, h)];
}

/* A rectangle's centre. */
export function rectangleCentre(position, width, height, rotation = 0) {
  const corners = rectangleCorners(position, width, height, rotation);

  return {
    x: (corners[0].x + corners[2].x) / 2,
    y: (corners[0].y + corners[2].y) / 2,
  };
}

/* ============================================================
 * SCHEMATIC LINE STYLES, IN TIKZ
 * ============================================================
 *
 * The dash patterns the fluides writers use for the two conventions that are
 * drawn dashed on an engineering sheet: a fluid level and a section trace. They
 * are stated here so the canvas and the source cannot pick different ones.
 */
export const DASH_PATTERN_LEVEL = "on 3pt off 2pt";
export const DASH_PATTERN_SECTION = "on 3pt off 2pt";

const enggFluidsShared = {
  SCHEMATIC_UNIT,
  DEFAULT_SYMBOL_RADIUS,
  DEFAULT_TRANSITION_LENGTH,
  DEFAULT_CONTINUATION_LENGTH,
  DEFAULT_VESSEL_WIDTH,
  DEFAULT_VESSEL_HEIGHT,
  DEFAULT_PROFILE_WIDTH,
  DEFAULT_PROFILE_HEIGHT,
  DEFAULT_SECTION_LENGTH,
  DEFAULT_ARROW_LENGTH,
  DASH_PATTERN_LEVEL,
  DASH_PATTERN_SECTION,
  finitePoint,
  finiteNumber,
  copyPoint,
  add,
  subtract,
  scale,
  midpoint,
  lengthOf,
  distanceBetween,
  unitVector,
  normalOf,
  pointAlong,
  angleOfDirection,
  directionAtAngle,
  tidy,
  localToWorld,
  worldToLocal,
  placedPoints,
  projectOntoLine,
  distanceToSegment,
  pointInPolygon,
  distanceToPolygonOutline,
  polygonContainsPoint,
  segmentIntersection,
  rectangleCorners,
  rectangleCentre,
};

export default enggFluidsShared;
