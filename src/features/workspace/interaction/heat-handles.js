/*
 * ========================================================
 * THE HEAT TRANSFER OBJECTS' HANDLES
 * ========================================================
 *
 * Which grips a Heat Transfer feature has, where they sit, and what a drag of
 * each one writes. One module for the whole workspace, so the canvas, the hit
 * test and the drag application cannot disagree about where a handle is or
 * what it does.
 *
 * ========================================================
 * THE HANDLES ARE THE MODEL'S OWN POINTS
 * ========================================================
 *
 * A handle is never a decorative grip: it sits on a point the feature's
 * geometry actually stores, and dragging it writes THAT point (or, for the
 * Wall / Slab's thickness and the Composite Wall's dividers, the one number
 * the whole shape is derived from). Because the shape is derived from the
 * model, a handle drag redraws the whole object - the two faces of a wall, the
 * dividers of a composite wall, the wave of a radiation path - and nothing is
 * left behind.
 *
 * THE HANDLE KINDS:
 *
 *   heat-start / heat-end        the two ends of a span (wall, arrow,
 *                                boundary, contact, path endpoints)
 *   heat-thickness               the Wall / Slab's thickness grip
 *   heat-divider-N               the Composite Wall's Nth internal divider
 *   heat-corner-N                the four corners of a region, composite wall
 *                                or control volume
 *   heat-edge-N                  the four edge midpoints of a composite wall
 *   heat-vertex-N                the Nth control point of a path or isotherm
 *   heat-center                  a placed symbol's centre
 *   heat-base / heat-tip         the Fin's attachment and its far end
 *
 * EVERY LENGTH IS A DRAWING AMOUNT. A handle's position is derived from the
 * stored geometry, never from the zoom, so a grip sits on the same point of
 * the object however far the sheet is zoomed.
 */

import enggHeatModel from "../model/heat-transfer/heat-model.js";
import {
  DEFAULT_SYMBOL_HALF,
  MIN_WALL_THICKNESS,
  centredRectangleCorners,
  finiteNumber,
  finitePoint,
  midpoint,
  projectOntoLine,
} from "../model/heat-transfer/heat-shared.js";

/* ============================================================
 * WHICH HANDLES A FEATURE HAS
 * ============================================================
 *
 * Asked of ONE object, in the same shape `manipulationHandles` answers for
 * every other feature: a list of { kind, point }. Returns null when the object
 * is not a Heat Transfer one, so the caller falls through to the shared
 * shapes.
 */
export function heatHandlesFor(object) {
  if (!object || !enggHeatModel.isHeatType(object.type)) {
    return null;
  }

  const g = object.geometry || {};

  switch (object.type) {
    case enggHeatModel.HEAT_TYPES.region:
      return regionHandles(object, g);

    case enggHeatModel.HEAT_TYPES.wallSlab:
      return wallSlabHandles(object, g);

    case enggHeatModel.HEAT_TYPES.compositeWall:
      return compositeWallHandles(object, g);

    case enggHeatModel.HEAT_TYPES.fin:
      return finHandles(object, g);

    case enggHeatModel.HEAT_TYPES.heatPath:
    case enggHeatModel.HEAT_TYPES.isotherm:
      return pathHandles(object, g);

    case enggHeatModel.HEAT_TYPES.thermalArrow:
    case enggHeatModel.HEAT_TYPES.thermalBoundary:
    case enggHeatModel.HEAT_TYPES.thermalContact:
      return spanHandles(object, g);

    case enggHeatModel.HEAT_TYPES.sourceSink:
    case enggHeatModel.HEAT_TYPES.circuitNode:
    case enggHeatModel.HEAT_TYPES.circuitElement:
    case enggHeatModel.HEAT_TYPES.temperatureMarker:
      return centreHandles(object, g);

    case enggHeatModel.HEAT_TYPES.controlVolume:
      return controlVolumeHandles(object, g);

    default:
      return null;
  }
}

/* The four corners of a Thermal Region. */
function regionHandles(object) {
  const corners = enggHeatModel.regionCorners(object);

  if (!corners || corners.length < 4) {
    return [];
  }

  return corners.map((point, index) => ({
    kind: `heat-corner-${index}`,
    point,
  }));
}

/*
 * THE WALL / SLAB'S THREE HANDLES.
 *
 *   heat-start      the midpoint of the starting end
 *   heat-end        the midpoint of the ending end
 *   heat-thickness  around the middle, on the first line
 *
 * The start and end are the centreline's two ends - the two line ends move
 * TOGETHER because the lines are derived from them. The thickness grip sits on
 * the first face, so dragging it perpendicular to the wall is the natural
 * gesture for pulling the two faces apart.
 */
function wallSlabHandles(object, g) {
  const handles = [];

  if (finitePoint(g.start)) {
    handles.push({ kind: "heat-start", point: { x: g.start.x, y: g.start.y } });
  }

  if (finitePoint(g.end)) {
    handles.push({ kind: "heat-end", point: { x: g.end.x, y: g.end.y } });
  }

  const thicknessAnchor = enggHeatModel.wallSlabThicknessAnchor(object);

  if (thicknessAnchor) {
    handles.push({ kind: "heat-thickness", point: thicknessAnchor });
  }

  return handles;
}

/*
 * THE COMPOSITE WALL'S TWO KINDS OF HANDLE.
 *
 * The OUTER handles - four corners and four edge midpoints - resize the whole
 * wall while preserving its layer count. The DIVIDER handles, one at each
 * internal divider's midpoint, adjust two adjacent layer thicknesses without
 * moving the others.
 */
function compositeWallHandles(object) {
  const geometry = enggHeatModel.compositeWallGeometry(object);

  if (!geometry) {
    return [];
  }

  const handles = [];

  /* The four outer corners. */
  geometry.corners.forEach((point, index) => {
    handles.push({ kind: `heat-corner-${index}`, point });
  });

  /* The four edge midpoints: left, bottom, right, top. */
  const [a, b, c, d] = geometry.corners;

  handles.push(
    { kind: "heat-edge-left", point: midpoint(a, d) },
    { kind: "heat-edge-bottom", point: midpoint(a, b) },
    { kind: "heat-edge-right", point: midpoint(b, c) },
    { kind: "heat-edge-top", point: midpoint(d, c) },
  );

  /* One divider handle per internal divider, at its midpoint. */
  geometry.dividers.forEach((divider, index) => {
    handles.push({
      kind: `heat-divider-${index}`,
      point: midpoint(divider.start, divider.end),
    });
  });

  return handles.filter((handle) => finitePoint(handle.point));
}

/* The Fin's attachment, its far end, and its thickness grip. */
function finHandles(object) {
  const geometry = enggHeatModel.finGeometry(object);

  if (!geometry) {
    return [];
  }

  const handles = [
    { kind: "heat-base", point: geometry.base },
    { kind: "heat-tip", point: geometry.end },
  ];

  if (geometry.thicknessAnchor) {
    handles.push({ kind: "heat-thickness", point: geometry.thicknessAnchor });
  }

  return handles;
}

/* The control points of a path or an isotherm. */
function pathHandles(object, g) {
  const points = (g.points || []).filter(finitePoint);

  return points.map((point, index) => ({
    kind: `heat-vertex-${index}`,
    point: { x: point.x, y: point.y },
  }));
}

/* The two ends of a span object - an arrow, a boundary or a contact. */
function spanHandles(object, g) {
  const handles = [];

  if (finitePoint(g.start)) {
    handles.push({ kind: "heat-start", point: { x: g.start.x, y: g.start.y } });
  }

  if (finitePoint(g.end)) {
    handles.push({ kind: "heat-end", point: { x: g.end.x, y: g.end.y } });
  }

  return handles;
}

/* A placed symbol's centre - the one grip that moves the whole thing. */
function centreHandles(object, g) {
  return finitePoint(g.center)
    ? [{ kind: "heat-center", point: { x: g.center.x, y: g.center.y } }]
    : [];
}

/* The four corners of a Control Volume Boundary. */
function controlVolumeHandles(object) {
  const corners = enggHeatModel.controlVolumeCorners(object);

  if (!corners || corners.length < 4) {
    return [];
  }

  return corners.map((point, index) => ({
    kind: `heat-corner-${index}`,
    point,
  }));
}

/* ============================================================
 * APPLYING A DRAG
 * ============================================================
 *
 * The one place a Heat Transfer handle drag is written onto the feature. The
 * caller hands the LIVE object, the handle's kind, the cursor's current world
 * point and the drag's start point (so a corner resize keeps the grab offset).
 *
 * Returns true when the object changed. Every write goes through the model, so
 * the canvas, the source and a saved file all see the same new geometry.
 */
export function applyHeatHandle(object, kind, point, drag) {
  if (
    !object ||
    !finitePoint(point) ||
    !enggHeatModel.isHeatType(object.type)
  ) {
    return false;
  }

  const g = object.geometry || {};

  /* A placed symbol's centre moves the whole object to the cursor. */
  if (kind === "heat-center") {
    if (!finitePoint(g.center)) {
      return false;
    }

    g.center = { x: point.x, y: point.y };
    object.geometry = g;

    return true;
  }

  /* The two ends of a span object. */
  if (kind === "heat-start" || kind === "heat-end") {
    const key = kind === "heat-start" ? "start" : "end";

    if (!finitePoint(g[key])) {
      return false;
    }

    g[key] = { x: point.x, y: point.y };
    object.geometry = g;

    return true;
  }

  /* The Fin's attachment and its far end. */
  if (kind === "heat-base" || kind === "heat-tip") {
    const key = kind === "heat-base" ? "base" : "end";

    if (!finitePoint(g[key])) {
      return false;
    }

    g[key] = { x: point.x, y: point.y };
    object.geometry = g;

    return true;
  }

  /*
   * THE WALL / SLAB'S THICKNESS.
   *
   * The drag is projected onto the wall's normal, so only the perpendicular
   * component counts: the two faces move apart symmetrically about a FIXED
   * centreline, the length is unchanged and the lines stay parallel. For a
   * horizontal wall the cursor's vertical component is what matters; for a
   * vertical one the horizontal; for an angled wall the perpendicular.
   */
  if (kind === "heat-thickness") {
    if (object.type === enggHeatModel.HEAT_TYPES.wallSlab) {
      return applyWallSlabThickness(object, point);
    }

    if (object.type === enggHeatModel.HEAT_TYPES.fin) {
      return applyFinThickness(object, point);
    }

    return false;
  }

  /* A control point of a path or an isotherm. */
  if (kind.startsWith("heat-vertex-")) {
    const index = Number(kind.slice("heat-vertex-".length));
    const points = (g.points || []).filter(finitePoint);

    if (!Number.isInteger(index) || index < 0 || index >= points.length) {
      return false;
    }

    points[index] = { x: point.x, y: point.y };
    g.points = points;
    object.geometry = g;

    return true;
  }

  /* A Composite Wall divider: the drag's component ALONG the wall's x axis. */
  if (kind.startsWith("heat-divider-")) {
    const index = Number(kind.slice("heat-divider-".length));

    return applyCompositeDivider(object, index, point, drag);
  }

  /* A corner or an edge of a region, composite wall or control volume. */
  if (kind.startsWith("heat-corner-") || kind.startsWith("heat-edge-")) {
    return applyBoxHandle(object, kind, point, drag);
  }

  return false;
}

/*
 * THE WALL / SLAB'S THICKNESS, FROM A DRAG.
 *
 * The new thickness is twice the perpendicular distance from the centreline to
 * the cursor - so the two faces stay symmetric about the centreline, and the
 * centreline and length are untouched by construction.
 */
function applyWallSlabThickness(object, point) {
  const g = object.geometry || {};
  const start = g.start;
  const end = g.end;

  if (!finitePoint(start) || !finitePoint(end)) {
    return false;
  }

  const projection = projectOntoLine(point, start, end);

  if (!projection) {
    return false;
  }

  const thickness = Math.max(MIN_WALL_THICKNESS, projection.distance * 2);

  return enggHeatModel.setWallSlabThickness(object, thickness);
}

/*
 * THE FIN'S THICKNESS, FROM A DRAG.
 *
 * The new thickness is twice the perpendicular distance from the fin's
 * centreline to the cursor, so the rectangle stays symmetric about its own
 * axis.
 */
function applyFinThickness(object, point) {
  const g = object.geometry || {};
  const base = g.base;
  const end = g.end;

  if (!finitePoint(base) || !finitePoint(end)) {
    return false;
  }

  const projection = projectOntoLine(point, base, end);

  if (!projection) {
    return false;
  }

  const thickness = Math.max(0.5, projection.distance * 2);

  g.thickness = thickness;
  object.geometry = g;

  return true;
}

/*
 * A COMPOSITE WALL DIVIDER, FROM A DRAG.
 *
 * The cursor is projected onto the wall's local x axis, and the change from
 * the divider's original position is the drag amount handed to the model -
 * which clamps it so the divider cannot cross its neighbours and no layer goes
 * below its minimum width. The drag is measured from the ORIGINAL geometry, so
 * it cannot accumulate rounding.
 */
function applyCompositeDivider(object, index, point, drag) {
  const original = drag?.originals?.[object.id]?.geometry;

  if (!original) {
    return false;
  }

  const geometry = enggHeatModel.compositeWallGeometry({
    geometry: original,
    type: object.type,
  });

  if (!geometry || index < 0 || index >= geometry.dividers.length) {
    return false;
  }

  /*
   * The wall's local x axis, in world coordinates, from the original frame.
   * The drag's component along it is what moves the divider.
   */
  const rotation = (finiteNumber(original.rotation, 0) * Math.PI) / 180;
  const axis = { x: Math.cos(rotation), y: Math.sin(rotation) };

  const dividerMid = midpoint(
    geometry.dividers[index].start,
    geometry.dividers[index].end,
  );

  const delta =
    (point.x - dividerMid.x) * axis.x + (point.y - dividerMid.y) * axis.y;

  return enggHeatModel.moveCompositeDivider(object, index, delta);
}

/*
 * A BOX HANDLE - A CORNER OR AN EDGE OF A RECTANGULAR OBJECT.
 *
 * The new width and height are read from the cursor against the OPPOSITE
 * corner or edge (the anchor), so the wall or region grows from the side the
 * student is not holding. A Composite Wall is resized through the model, which
 * preserves the layer count and scales the layers proportionally; a region and
 * a control volume write their width and height directly.
 *
 * The anchor comes from the ORIGINAL geometry, so the resize cannot drift.
 */
function applyBoxHandle(object, kind, point, drag) {
  const original = drag?.originals?.[object.id]?.geometry;

  if (!original) {
    return false;
  }

  if (object.type === enggHeatModel.HEAT_TYPES.compositeWall) {
    return resizeCompositeFromHandle(object, kind, point, original);
  }

  if (object.type === enggHeatModel.HEAT_TYPES.region) {
    return resizeRectangleFromHandle(object, kind, point, original, false);
  }

  if (object.type === enggHeatModel.HEAT_TYPES.controlVolume) {
    return resizeRectangleFromHandle(object, kind, point, original, true);
  }

  return false;
}

/*
 * RESIZE A COMPOSITE WALL FROM A HANDLE.
 *
 * The wall is axis-aligned at placement (rotation 0); a rotated wall's corners
 * still resize, measured against the wall's local axes so the drag reads
 * naturally. The model's `resizeCompositeWall` preserves the layer count and
 * scales the layers proportionally.
 */
function resizeCompositeFromHandle(object, kind, point, original) {
  const center = original.center;

  if (!finitePoint(center)) {
    return false;
  }

  const rotation = finiteNumber(original.rotation, 0);
  const radians = (rotation * Math.PI) / 180;
  const axis = { x: Math.cos(radians), y: Math.sin(radians) };
  const normal = { x: -axis.y, y: axis.x };

  /* The cursor, in the wall's local frame, relative to its centre. */
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const local = {
    x: dx * axis.x + dy * axis.y,
    y: dx * normal.x + dy * normal.y,
  };

  const oldWidth = Math.abs(finiteNumber(original.width, 1));
  const oldHeight = Math.abs(finiteNumber(original.height, 1));

  let newWidth = oldWidth;
  let newHeight = oldHeight;

  if (kind.startsWith("heat-corner-")) {
    /* A corner drags both dimensions: the extent is twice the local distance. */
    newWidth = Math.max(DEFAULT_SYMBOL_HALF, Math.abs(local.x) * 2);
    newHeight = Math.max(DEFAULT_SYMBOL_HALF, Math.abs(local.y) * 2);
  } else if (kind === "heat-edge-left" || kind === "heat-edge-right") {
    newWidth = Math.max(DEFAULT_SYMBOL_HALF, Math.abs(local.x) * 2);
  } else if (kind === "heat-edge-top" || kind === "heat-edge-bottom") {
    newHeight = Math.max(DEFAULT_SYMBOL_HALF, Math.abs(local.y) * 2);
  } else {
    return false;
  }

  return enggHeatModel.resizeCompositeWall(object, newWidth, newHeight);
}

/*
 * RESIZE A REGION OR A CONTROL VOLUME FROM A CORNER.
 *
 * These store a corner position and a width/height, so a corner drag rewrites
 * the position and both extents against the opposite corner. The rotation is
 * preserved; the rectangle is rebuilt from the stored position.
 */
function resizeRectangleFromHandle(
  object,
  kind,
  point,
  original,
  isControlVolume,
) {
  if (!kind.startsWith("heat-corner-")) {
    return false;
  }

  const index = Number(kind.slice("heat-corner-".length));

  if (!Number.isInteger(index) || index < 0 || index > 3) {
    return false;
  }

  const g = object.geometry || {};
  const rotation = finiteNumber(original.rotation, 0);
  const corners = centredRectangleCorners(
    {
      x: finiteNumber(original.position?.x) + finiteNumber(original.width) / 2,
      y: finiteNumber(original.position?.y) + finiteNumber(original.height) / 2,
    },
    finiteNumber(original.width),
    finiteNumber(original.height),
    (rotation * 180) / Math.PI,
  );

  if (corners.length < 4) {
    return false;
  }

  /* The anchor is the corner diagonally opposite the one being dragged. */
  const anchor = corners[(index + 2) % 4];

  const width = Math.abs(point.x - anchor.x);
  const height = Math.abs(point.y - anchor.y);

  const position = {
    x: Math.min(point.x, anchor.x),
    y: Math.min(point.y, anchor.y),
  };

  g.position = position;
  g.width = Math.max(DEFAULT_SYMBOL_HALF, width);
  g.height = Math.max(DEFAULT_SYMBOL_HALF, height);

  object.geometry = g;

  void isControlVolume;

  return true;
}

const enggHeatHandles = {
  heatHandlesFor,
  applyHeatHandle,
};

export default enggHeatHandles;
