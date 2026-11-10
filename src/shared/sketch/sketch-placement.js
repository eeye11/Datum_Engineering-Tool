/*
 * ============================================================
 * PLACING A SKETCH INTO THE DRAWING
 * ============================================================
 *
 * The step between the editor and the sheet, and the one place a sketch's
 * coordinates become drawing coordinates.
 *
 * WHAT PLACEMENT IS
 * -----------------
 * A TRANSFORM - translation, rotation, uniform scale - applied to geometry that
 * does not change shape. Moving a sketch translates it; it never resizes one
 * axis more than the other, so a circle placed on the sheet is still a circle.
 * That is why the transform is stored separately from the points: a placement
 * can be changed again later without the sketch being re-read from earlier.
 *
 * THE INSERTION ANCHOR
 * --------------------
 * The sketch point that lands on the click. By default it is the sketch origin
 * (0, 0), because that is the one location a sketch always has and a student
 * can reason about. They may choose any anchor instead, and the arithmetic is
 * the same either way: subtract the anchor, then add the placement.
 *
 * WHAT IS TRANSFERRED
 * -------------------
 * The geometry, its appearance, the point constraints that travel with it, and
 * the transform. NOT the editing aids: markers, handles, selection outlines and
 * the correction preview are things the editor draws. Axes and grid transfer
 * only when the student has asked for them, because a working grid is not
 * usually part of an engineering drawing.
 */

import { resolvePoints } from "./sketch-points.js";
import { normaliseGrid } from "./sketch-grid.js";

/* The transform a placement starts from: no offset, no rotation, unit scale. */
export const IDENTITY_TRANSFORM = Object.freeze({
  x: 0,
  y: 0,
  rotation: 0,
  scale: 1,
  lockAspect: true,
});

function finite(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
}

/* Apply a transform to one model point. */
export function transformPoint(point, transform = IDENTITY_TRANSFORM) {
  const scale = finite(transform.scale, 1);
  const rotation = finite(transform.rotation);

  const x = finite(point?.x);
  const y = finite(point?.y);

  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  return {
    x: x * scale * cos - y * scale * sin + finite(transform.x),
    y: x * scale * sin + y * scale * cos + finite(transform.y),
  };
}

/*
 * The transform that puts `anchor` exactly under `target`.
 *
 * A rotation is applied ABOUT THE ANCHOR, not about the sketch origin - a
 * student who rotates a sketch about a corner expects that corner to stay put.
 */
export function alignTransform(anchor, target, options = {}) {
  const from = anchor || { x: 0, y: 0 };
  const to = target || { x: 0, y: 0 };

  const rotation = finite(options.rotation);
  const scale = finite(options.scale, 1);

  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  /* Where the anchor would land with rotation and scale about the origin. */
  const moved = {
    x: from.x * scale * cos - from.y * scale * sin,
    y: from.x * scale * sin + from.y * scale * cos,
  };

  return {
    x: to.x - moved.x,
    y: to.y - moved.y,
    rotation,
    scale,
    lockAspect: options.lockAspect !== false,
  };
}

/* ============================================================
 * PREPARING THE GEOMETRY
 * ============================================================ */

/* One element, transformed. */
export function placeElement(element, transform) {
  return {
    ...element,
    points: (element.points || []).map((point) =>
      transformPoint(point, transform),
    ),
    segments: (element.segments || []).map((segment) => ({
      from: transformPoint(segment.from, transform),
      control1: transformPoint(segment.control1, transform),
      control2: transformPoint(segment.control2, transform),
      to: transformPoint(segment.to, transform),
    })),
    centre: element.centre ? transformPoint(element.centre, transform) : null,
    corner: element.corner ? transformPoint(element.corner, transform) : null,
    rotation: finite(element.rotation) + finite(transform.rotation),
    /*
     * A SHAPE'S OWN SIZES SCALE WITH IT, uniformly - the same number on both
     * axes, which is what keeps a circle from becoming an ellipse.
     */
    radius:
      element.radius === null
        ? null
        : element.radius * finite(transform.scale, 1),
    radiusX:
      element.radiusX === null
        ? null
        : element.radiusX * finite(transform.scale, 1),
    radiusY:
      element.radiusY === null
        ? null
        : element.radiusY * finite(transform.scale, 1),
    width:
      element.width === null
        ? null
        : element.width * finite(transform.scale, 1),
    height:
      element.height === null
        ? null
        : element.height * finite(transform.scale, 1),
    original: element.original
      ? element.original.map((point) => transformPoint(point, transform))
      : null,
  };
}

/*
 * THE WHOLE SKETCH, READY TO INSERT.
 *
 * The points travel too, because the constraints are part of what the student
 * made: without them the placed sketch would be a picture, and editing it later
 * would not know where its anchors were.
 */
export function placementPackage(document, transform, options = {}) {
  const include = options.include || {};

  const resolved = resolvePoints(document.points || []);

  return {
    geometry: (document.geometry || [])
      .filter((element) => element.visible !== false)
      .map((element) => placeElement(element, transform)),
    points: resolved.map((point) => {
      const placed = transformPoint(point.absolute || point, transform);

      return { ...point, x: placed.x, y: placed.y, absolute: placed };
    }),
    transform: { ...transform },
    /*
     * THE COORDINATE GEOMETRY, ONLY WHEN ASKED FOR. A grid the student used to
     * construct a curve is not usually part of the drawing.
     */
    coordinateGeometry:
      include.axes || include.grid || include.ticks
        ? buildCoordinateGeometry(document, transform, include)
        : [],
    appearance: document.appearance,
  };
}

/* ============================================================
 * AXES AND GRID AS REAL GEOMETRY
 * ============================================================ */

/*
 * WHEN THE COORDINATE SYSTEM IS INCLUDED, IT BECOMES GEOMETRY - not a render
 * option. That matters: geometry has an appearance, can be selected and edited,
 * and is serialised into the source like anything else. A grid that were only a
 * display setting could not be sent to the sheet or written into the TikZ.
 */
export function buildCoordinateGeometry(document, transform, include = {}) {
  const grid = normaliseGrid(document.grid);
  const bounds = document.bounds || { xMin: -5, xMax: 5, yMin: -5, yMax: 5 };

  const elements = [];

  if (include.axes) {
    if (grid.showXAxis && bounds.yMin <= 0 && bounds.yMax >= 0) {
      elements.push({
        kind: "line",
        name: "x axis",
        points: [
          { x: bounds.xMin, y: 0 },
          { x: bounds.xMax, y: 0 },
        ],
        appearance: {
          thickness: "thin",
          colour: "#333333",
          isDefaultColour: false,
        },
      });
    }

    if (grid.showYAxis && bounds.xMin <= 0 && bounds.xMax >= 0) {
      elements.push({
        kind: "line",
        name: "y axis",
        points: [
          { x: 0, y: bounds.yMin },
          { x: 0, y: bounds.yMax },
        ],
        appearance: {
          thickness: "thin",
          colour: "#333333",
          isDefaultColour: false,
        },
      });
    }
  }

  return elements.map((line) => placeElement(line, transform));
}

/*
 * WHERE A SKETCH WOULD LAND, for a preview attached to the pointer.
 *
 * Placement is not committed until the student clicks, so the preview runs
 * through this same function - which is why the preview cannot promise
 * something the insertion would not do.
 */
export function previewAt(document, insertionPoint, options = {}) {
  const anchorId = options.anchorId || null;

  const resolved = resolvePoints(document.points || []);

  const anchor = (anchorId &&
    resolved.find((point) => point.id === anchorId)?.absolute) || {
    x: 0,
    y: 0,
  };

  const transform = alignTransform(anchor, insertionPoint, {
    rotation: options.rotation,
    scale: options.scale,
  });

  return placementPackage(document, transform, options);
}

export default {
  IDENTITY_TRANSFORM,
  transformPoint,
  alignTransform,
  placeElement,
  placementPackage,
  buildCoordinateGeometry,
  previewAt,
};
