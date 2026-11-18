/*
 * ========================================================
 * HEAT TRANSFER: GEOMETRY HELPERS EVERY TOOL SHARES
 * ========================================================
 *
 * The Heat Transfer tools - Thermal Region, Wall / Slab, Composite Wall, Fin,
 * the Heat Transfer Paths, the Thermal Transfer Arrows, the Thermal Boundaries,
 * the Thermal Contact, the Source / Sink symbols, the Circuit nodes and
 * elements, and the three Analysis objects - all need the same small set of
 * geometrical questions answered:
 *
 *   - which way a wall or a fin points, and how a rotated symbol maps its own
 *     local coordinates into the drawing;
 *   - how a boundary's repeated decoration is spread along the segment it is
 *     drawn on;
 *   - what the "small default" of this application is, so a symbol is drawn at
 *     a size that matches the walls and regions it sits beside;
 *   - where a handle sits for a drag, and what a drag of it means.
 *
 * None of it is engineering. It is arithmetic on drawing coordinates, stated
 * once so fifteen tools cannot each get "which way is normal to this wall"
 * slightly differently.
 */

/* ============================================================
 * THE DRAWING'S OWN SMALL DIMENSIONS
 * ============================================================
 *
 * A Heat Transfer symbol has to be readable beside a wall or a region, and the
 * wall's two faces are `HEAT_UNIT * 2.5` apart by default. Everything below is
 * expressed in multiples of that unit, so a change to the drawing's convention
 * moves the symbols with it instead of leaving a resistor the size of a boiler.
 *
 * THESE ARE DRAWING AMOUNTS, NOT ENGINEERING DIMENSIONS. No conductance, no
 * film coefficient, no standards figure is implied by any of them.
 */
export const HEAT_UNIT = 4;

/* The default separation of a Wall / Slab's two faces. */
export const DEFAULT_WALL_THICKNESS = HEAT_UNIT * 2.5;

/* The minimum separation a Wall / Slab can be dragged to. */
export const MIN_WALL_THICKNESS = HEAT_UNIT * 0.5;

/* The default height of a Composite Wall, and of a Fin's base thickness. */
export const DEFAULT_WALL_HEIGHT = HEAT_UNIT * 9;

/*
 * THE COMPOSITE WALL'S LAYER INCREMENT.
 *
 * `p` in the layer-count rule N = max(2, floor(W / p)). It is a SOURCE-DEFINED
 * drawing-coordinate amount - not a screen pixel - so the number of layers a
 * drag generates is independent of the zoom the sheet happens to be shown at.
 * The two-layer minimum and this increment together mean a wall starts with two
 * equal layers the moment it is a valid rectangle at all.
 */
export const COMPOSITE_LAYER_INCREMENT = HEAT_UNIT * 9;

/* The smallest width a Composite Wall layer may be dragged to. */
export const MIN_LAYER_WIDTH = HEAT_UNIT * 0.75;

/* The default length and thickness of a Fin. */
export const DEFAULT_FIN_LENGTH = HEAT_UNIT * 8;
export const DEFAULT_FIN_THICKNESS = HEAT_UNIT * 1.5;
export const MIN_FIN_THICKNESS = HEAT_UNIT * 0.4;

/* The radius of a Thermal Circuit Node's dot. */
export const DEFAULT_NODE_RADIUS = HEAT_UNIT * 0.6;

/* The half-size of a Heat Source / Sink symbol, and of a Circuit element. */
export const DEFAULT_SYMBOL_HALF = HEAT_UNIT * 2.5;

/* The default length of a Thermal Transfer Arrow. */
export const DEFAULT_ARROW_LENGTH = HEAT_UNIT * 6;

/*
 * THE ARROWHEAD'S PROPORTIONS - THE ESTABLISHED DAETUM ONES.
 *
 * A Heat Transfer arrowhead is NOT sized from the path's length. Sizing it from
 * the length is what produced the oversized triangle: a 200-unit path got a
 * 50-unit head, which dominated the drawing.
 *
 * It is sized from the LINE WEIGHT - the number the student actually sets with
 * Thickness - exactly as a distributed load's arrow is (see
 * `distributedLoadHeadSize` in shared/rendering/vector-render.js). The path's
 * length is only a BOUND, so a very short path cannot end in a head longer than
 * itself. The spread of the barbs is DAETUM's own `0.4` radians, from the same
 * arrowhead builder every force on the sheet uses, so a Heat Transfer head and
 * a Statics head are the same shape at different scales.
 *
 * EVERY ONE is a DRAWING amount: the stroke width is a drawing weight and the
 * path length is drawing units, so the head keeps its proportion at every
 * zoom.
 */
export const ARROW_HEAD_SPREAD = 0.4;

/* The smallest a head may be drawn, in drawing units, so it always reads. */
export const ARROW_HEAD_MIN = 3;

/*
 * How many line-widths long a head is. A little more than the 5 a load's arrow
 * uses, because a heat path's default weight is thinner than a force line and
 * the head still has to be legible on it.
 */
export const ARROW_HEAD_WIDTH_FACTOR = 7;

/*
 * THE RADIATION PATH'S WAVE.
 *
 * A Radiation Path is a straight route with a sine wave drawn along it. The
 * wave's amplitude and pitch are drawing amounts, so the symbol reads as a
 * radiation mark at every zoom and never becomes screen-pixel noise.
 */
export const RADIATION_WAVE_AMPLITUDE = HEAT_UNIT * 0.8;
export const RADIATION_WAVE_PITCH = HEAT_UNIT * 2.2;

/*
 * THE CONVECTION FLOW'S BOW.
 *
 * A Convection Flow is a SMOOTH CURVE, not a rounded polyline. For a single
 * dragged segment - where there is no corner to smooth - the curve is given a
 * shallow, bounded bow so it still reads as a streamline rather than as a
 * straight rule. The bow is a FRACTION OF THE SEGMENT'S OWN LENGTH, capped at
 * `CONVECTION_MAX_BOW` drawing units, so a long run bows proportionally and a
 * short one cannot become a loop.
 *
 * Both are drawing amounts, so the curve's shape scales with the sheet.
 */
export const CONVECTION_BOW_FRACTION = 0.06;
export const CONVECTION_MAX_BOW = HEAT_UNIT * 1.6;

/*
 * A BOUNDARY DECORATION'S DEFAULT SPACING.
 *
 * The repeated convection arrows, radiation marks, insulation hatches and
 * heat-flux arrows of a Thermal Boundary are generated from the boundary's own
 * length. This is the drawing-coordinate distance between two marks when the
 * student has not asked for another spacing - so a resized boundary keeps its
 * symbols evenly spread rather than piling them at one end.
 */
export const DEFAULT_SYMBOL_SPACING = HEAT_UNIT * 3;
export const MIN_SYMBOL_SPACING = HEAT_UNIT * 1;

/* The length of one boundary decoration - a convection or flux arrow's shaft. */
export const DEFAULT_DECORATION_LENGTH = HEAT_UNIT * 2;

/* The size of a Temperature Marker's point. */
export const DEFAULT_MARKER_RADIUS = HEAT_UNIT * 0.55;

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
 * Every Heat Transfer symbol is drawn as a shape in ITS OWN coordinates (a
 * resistor about the origin, a source between -h and +h) and placed by a centre
 * and a rotation. This is the one transform between the two, so the canvas, the
 * TikZ writer, the hit test and the handles all place the symbol the same way.
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
 * AN ARROWHEAD - THE ESTABLISHED DAETUM ONE
 * ============================================================
 *
 * The one arrowhead every Heat Transfer arrow and path uses. It is the SAME
 * SHAPE the force arrows on the sheet use (see `arrowHeadCorners` in
 * shared/rendering/vector-render.js): a tip, and two barbs `head` back along
 * the axis and `head * sin(0.4)` either side of it.
 *
 * ITS SIZE COMES FROM THE LINE WEIGHT, NOT THE PATH LENGTH. `strokeWidth` is
 * the styled weight in drawing units; the head is a small multiple of it, and
 * the path's length (`boundLength`) is only a cap so the head can never be
 * longer than a very short path. This is what stops a long path ending in a
 * head the size of a building - the fault this replaces sized the head as a
 * fraction of the whole path.
 *
 * All the arithmetic is in DRAWING units: no pixel, no zoom, no canvas size,
 * so the head is the same fraction of the line at every magnification.
 *
 * `tip`         the point the arrow points AT
 * `direction`   the unit vector it points ALONG
 * `strokeWidth` the line weight, in drawing units
 * `boundLength` the path's length, as an upper bound (optional)
 *
 * Returns { tip, barbFirst, barbSecond, headBase, headLength } or null.
 *
 * `scale` converts the WORLD sizes above into the pixels the caller draws in.
 * The canvas projects geometry through the camera, so a head computed in world
 * units and plotted at those numbers shrinks with the zoom instead of with the
 * drawing; passing the camera's scale - and 1 where the caller already draws in
 * world pixels - keeps one head shape correct for both.
 */
export function arrowHead(tip, direction, strokeWidth, boundLength = Infinity, scale = 1) {
  if (!finitePoint(tip) || !direction) {
    return null;
  }

  const axisLength = Math.hypot(Number(direction.x), Number(direction.y));

  if (!(axisLength > 1e-9)) {
    return null;
  }

  const axis = { x: direction.x / axisLength, y: direction.y / axisLength };
  const across = normalOf(axis);

  const width = Math.max(0, Number(strokeWidth) || 0);

  const view = Number(scale) > 0 && Number.isFinite(Number(scale)) ? Number(scale) : 1;

  /*
   * The head, as a multiple of the line weight, bounded by its own path.
   * `ARROW_HEAD_MIN` keeps a very thin line's head visible; the bound keeps a
   * very short path's head from overrunning it. `head` is the length back from
   * the tip; the barbs sit `head * sin(0.4)` either side - DAETUM's spread.
   */
  const bounded = Math.min(
    Math.max(ARROW_HEAD_MIN, width * ARROW_HEAD_WIDTH_FACTOR),
    Math.max(ARROW_HEAD_MIN, Number(boundLength) || Infinity)
  );

  const head = bounded * view;
  const back = head * Math.cos(ARROW_HEAD_SPREAD);
  const halfWidth = head * Math.sin(ARROW_HEAD_SPREAD);

  const at = (along, sideways) => ({
    x: tip.x - axis.x * along + across.x * sideways,
    y: tip.y - axis.y * along + across.y * sideways,
  });

  return {
    tip: { x: tip.x, y: tip.y },
    barbFirst: at(back, halfWidth),
    barbSecond: at(back, -halfWidth),
    headBase: at(back, 0),
    headLength: head,
  };
}

/* ============================================================
 * A RECTANGLE, AS THE FOUR CORNERS IT IS DRAWN FROM
 * ============================================================
 *
 * The four corners of a stored rectangle, in order, for a rectangle that stores
 * a corner `position`, a `width`, a `height` and a `rotation` (radians). Used
 * by the Thermal Region, the Composite Wall and the Control Volume Boundary.
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

/*
 * A CENTRED rectangle's corners, from a centre point, a width, a height and a
 * rotation in DEGREES. Used by the Composite Wall, which is described by its
 * centre so that a divider drag leaves the whole wall where it was.
 */
export function centredRectangleCorners(
  center,
  width,
  height,
  rotationDegrees = 0,
) {
  const cx = Number(center?.x) || 0;
  const cy = Number(center?.y) || 0;
  const w = Number(width) || 0;
  const h = Number(height) || 0;

  const frame = { center: { x: cx, y: cy }, rotation: rotationDegrees };

  return [
    localToWorld(frame, { x: -w / 2, y: -h / 2 }),
    localToWorld(frame, { x: w / 2, y: -h / 2 }),
    localToWorld(frame, { x: w / 2, y: h / 2 }),
    localToWorld(frame, { x: -w / 2, y: h / 2 }),
  ];
}

const enggHeatShared = {
  HEAT_UNIT,
  DEFAULT_WALL_THICKNESS,
  MIN_WALL_THICKNESS,
  DEFAULT_WALL_HEIGHT,
  COMPOSITE_LAYER_INCREMENT,
  MIN_LAYER_WIDTH,
  DEFAULT_FIN_LENGTH,
  DEFAULT_FIN_THICKNESS,
  MIN_FIN_THICKNESS,
  DEFAULT_NODE_RADIUS,
  DEFAULT_SYMBOL_HALF,
  DEFAULT_ARROW_LENGTH,
  ARROW_HEAD_SPREAD,
  ARROW_HEAD_MIN,
  ARROW_HEAD_WIDTH_FACTOR,
  RADIATION_WAVE_AMPLITUDE,
  RADIATION_WAVE_PITCH,
  CONVECTION_BOW_FRACTION,
  CONVECTION_MAX_BOW,
  DEFAULT_SYMBOL_SPACING,
  MIN_SYMBOL_SPACING,
  DEFAULT_DECORATION_LENGTH,
  DEFAULT_MARKER_RADIUS,
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
  arrowHead,
  rectangleCorners,
  rectangleCentre,
  centredRectangleCorners,
};

export default enggHeatShared;
