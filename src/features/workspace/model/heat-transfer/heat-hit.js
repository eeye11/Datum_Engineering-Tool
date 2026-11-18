/*
 * ========================================================
 * HEAT TRANSFER: WHICH OBJECT IS UNDER THE POINTER
 * ========================================================
 *
 * The hit test for the Heat Transfer workspace, asked of ONE object by the
 * shared `objectAtPoint` scan. Each object is picked by its OWN drawn form,
 * read from the model - so what a student can click is exactly what is
 * painted, and a symbol is never picked by a box bigger than its ink.
 *
 *   - a Wall / Slab is picked on either of its two parallel lines;
 *   - a Composite Wall and a Thermal Region are picked inside their outline;
 *   - a Fin is picked inside its rectangle;
 *   - a path and an isotherm are picked along their control polyline;
 *   - an arrow, a boundary and a contact are picked along their span, with
 *     the boundary's decorations counting as part of the boundary;
 *   - a source, a node, an element and a marker are picked on their symbol;
 *   - a Control Volume is picked on its dashed outline.
 *
 * Returns null when the object is not a Heat Transfer one, so the caller
 * falls through to the shared shapes. Every test is in drawing coordinates,
 * against the model's own resolver, so a click lands on the same ink at every
 * zoom.
 */

import enggHeatModel from "./heat-model.js";
import {
  DEFAULT_SYMBOL_HALF,
  distanceToSegment,
  finiteNumber,
  finitePoint,
  pointInPolygon,
} from "./heat-shared.js";

/* The one entry point the shared scan asks. */
export function heatContainsPoint(object, point, tolerance) {
  if (
    !object ||
    !enggHeatModel.isHeatType(object.type) ||
    !finitePoint(point)
  ) {
    return null;
  }

  const band = Math.max(0.5, finiteNumber(tolerance, 1));
  const g = object.geometry || {};

  switch (object.type) {
    case enggHeatModel.HEAT_TYPES.region:
    case enggHeatModel.HEAT_TYPES.controlVolume: {
      const corners =
        object.type === enggHeatModel.HEAT_TYPES.region
          ? enggHeatModel.regionCorners(object)
          : enggHeatModel.controlVolumeCorners(object);

      return regionContainsPoint(corners, point, band);
    }

    case enggHeatModel.HEAT_TYPES.compositeWall: {
      const geometry = enggHeatModel.compositeWallGeometry(object);

      if (!geometry) {
        return false;
      }

      /* Inside the wall, or on the outer rectangle or any divider. */
      if (pointInPolygon(point, geometry.corners)) {
        return true;
      }

      if (outlineContainsPoint(geometry.corners, point, band)) {
        return true;
      }

      return geometry.dividers.some(
        (divider) =>
          distanceToSegment(point, divider.start, divider.end) <= band,
      );
    }

    case enggHeatModel.HEAT_TYPES.fin: {
      const geometry = enggHeatModel.finGeometry(object);

      if (!geometry) {
        return false;
      }

      return (
        pointInPolygon(point, geometry.corners) ||
        outlineContainsPoint(geometry.corners, point, band)
      );
    }

    case enggHeatModel.HEAT_TYPES.wallSlab: {
      const lines = enggHeatModel.wallSlabLines(object);

      if (!lines) {
        return false;
      }

      /* Either parallel line, or the space between them near the middle. */
      return lines.some(
        (boundary) =>
          distanceToSegment(point, boundary.start, boundary.end) <= band,
      );
    }

    case enggHeatModel.HEAT_TYPES.heatPath:
    case enggHeatModel.HEAT_TYPES.isotherm: {
      const points = (g.points || []).filter(finitePoint);

      if (points.length < 2) {
        return false;
      }

      for (let index = 1; index < points.length; index += 1) {
        if (
          distanceToSegment(point, points[index - 1], points[index]) <= band
        ) {
          return true;
        }
      }

      if (g.closed) {
        return (
          distanceToSegment(point, points[points.length - 1], points[0]) <= band
        );
      }

      return false;
    }

    case enggHeatModel.HEAT_TYPES.thermalArrow:
    case enggHeatModel.HEAT_TYPES.thermalContact: {
      if (!finitePoint(g.start) || !finitePoint(g.end)) {
        return false;
      }

      return distanceToSegment(point, g.start, g.end) <= band;
    }

    case enggHeatModel.HEAT_TYPES.thermalBoundary: {
      if (!finitePoint(g.start) || !finitePoint(g.end)) {
        return false;
      }

      if (distanceToSegment(point, g.start, g.end) <= band) {
        return true;
      }

      /* The decorations count as part of the boundary, so a click on a
       * convection arrow or a hatch selects the boundary it belongs to. */
      return enggHeatModel.boundaryDecorations(object).some((mark) =>
        mark.points.some((corner, index) => {
          const next = mark.points[index + 1];

          return next ? distanceToSegment(point, corner, next) <= band : false;
        }),
      );
    }

    case enggHeatModel.HEAT_TYPES.sourceSink:
    case enggHeatModel.HEAT_TYPES.circuitNode:
    case enggHeatModel.HEAT_TYPES.circuitElement:
    case enggHeatModel.HEAT_TYPES.temperatureMarker: {
      if (!finitePoint(g.center)) {
        return false;
      }

      const size = Math.max(
        finiteNumber(g.radius, 0),
        finiteNumber(g.size, DEFAULT_SYMBOL_HALF),
        DEFAULT_SYMBOL_HALF,
      );

      return (
        Math.hypot(point.x - g.center.x, point.y - g.center.y) <=
        size * 2 + band
      );
    }

    default:
      return null;
  }
}

/* Inside a closed outline, or within the band of it. */
function regionContainsPoint(corners, point, band) {
  if (!Array.isArray(corners) || corners.length < 3) {
    return false;
  }

  return (
    pointInPolygon(point, corners) || outlineContainsPoint(corners, point, band)
  );
}

/* Within the band of a closed outline's edges. */
function outlineContainsPoint(corners, point, band) {
  if (!Array.isArray(corners) || corners.length < 2) {
    return false;
  }

  return corners.some((corner, index) => {
    const next = corners[(index + 1) % corners.length];

    return finitePoint(next) && distanceToSegment(point, corner, next) <= band;
  });
}

/*
 * THE POINTS A HEAT TRANSFER OBJECT CONTRIBUTES TO A FIT OR A BOX SELECT.
 *
 * Asked of ONE object by the shared fit and box-selection scans, so a Fit
 * frames the whole wall - both faces, every divider, the full wave - rather
 * than clipping it to a centreline. Returns null for a non-Heat-Transfer
 * object.
 */
export function heatObjectPoints(object) {
  if (!object || !enggHeatModel.isHeatType(object.type)) {
    return null;
  }

  const g = object.geometry || {};

  switch (object.type) {
    case enggHeatModel.HEAT_TYPES.region:
      return enggHeatModel.regionCorners(object) || [];

    case enggHeatModel.HEAT_TYPES.controlVolume:
      return enggHeatModel.controlVolumeCorners(object) || [];

    case enggHeatModel.HEAT_TYPES.compositeWall:
      return enggHeatModel.compositeWallGeometry(object)?.corners || [];

    case enggHeatModel.HEAT_TYPES.fin:
      return enggHeatModel.finGeometry(object)?.corners || [];

    case enggHeatModel.HEAT_TYPES.wallSlab: {
      const lines = enggHeatModel.wallSlabLines(object);

      return lines
        ? [lines[0].start, lines[0].end, lines[1].start, lines[1].end]
        : [];
    }

    case enggHeatModel.HEAT_TYPES.heatPath:
    case enggHeatModel.HEAT_TYPES.isotherm:
      return (g.points || []).filter(finitePoint);

    case enggHeatModel.HEAT_TYPES.thermalArrow:
    case enggHeatModel.HEAT_TYPES.thermalBoundary:
    case enggHeatModel.HEAT_TYPES.thermalContact:
      return [g.start, g.end].filter(finitePoint);

    case enggHeatModel.HEAT_TYPES.sourceSink:
    case enggHeatModel.HEAT_TYPES.circuitNode:
    case enggHeatModel.HEAT_TYPES.circuitElement:
    case enggHeatModel.HEAT_TYPES.temperatureMarker: {
      if (!finitePoint(g.center)) {
        return [];
      }

      const size = Math.max(
        finiteNumber(g.radius, 0),
        finiteNumber(g.size, DEFAULT_SYMBOL_HALF),
      );

      return [
        { x: g.center.x - size, y: g.center.y - size },
        { x: g.center.x + size, y: g.center.y + size },
      ];
    }

    default:
      return null;
  }
}

const enggHeatHit = {
  heatContainsPoint,
  heatObjectPoints,
};

export default enggHeatHit;
