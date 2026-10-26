/*
 * ============================================================
 * THE BOUNDS OF A COMPLETE DRAWING
 * ============================================================
 *
 * The export has to fit the WHOLE drawing, not its biggest shape. A statics
 * sheet is a beam, two supports, a load, a sketch and a graph stacked above it -
 * measure only the beam and the graph is cut off; measure only the graph and the
 * supports hang outside the figure.
 *
 * So bounds are the union of every object's own extent, and an object's extent
 * is its INK, not its endpoints: a circle reaches a radius past its centre, a
 * beam's outline reaches half a depth past its centreline, a support's triangle
 * reaches past its anchor, a label reaches past its anchor point in every
 * direction. Anything that left out would be clipped by the figure it is in.
 *
 * WHAT IS DELIBERATELY NOT INCLUDED.
 *
 *   - Selection outlines, handles, the grid and the cursor: they are the
 *     EDITOR, not the drawing, and they are never exported.
 *   - An object the canvas does not draw (a hidden sheet, an orphaned diagram):
 *     including it would reserve blank space for something that is not there.
 *
 * THE NUMBERS ARE MODEL UNITS. One model unit is one authored millimetre; this
 * module never converts, and never scales. The export transform does that, from
 * exactly this rectangle.
 *
 * WHY THE SIZES HERE MATCH THE WRITERS.
 *
 * Every constant below (a beam's half depth, a support's size, a label's reach)
 * is the one the corresponding source writer uses. They are stated once, in
 * `symbol-sizes.js`, so a bound and the code it bounds cannot disagree - which
 * would show as a figure whose own label is clipped by its edge.
 */

import {
  BEAM_HALF_DEPTH,
  MOMENT_DEFAULT_RADIUS,
  PARTICLES_RADIUS,
  SUPPORT_GROUND,
  SUPPORT_SIZE,
  TRUSS_DEPTH,
  LABEL_REACH,
} from "./symbol-sizes.js";
import { boundsOfPoint, unionBounds } from "./export-transform.js";
import { pipeDuctPaths } from "../../../features/workspace/model/fluids/pipe-duct.js";

function finite(value) {
  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function pointOf(candidate) {
  const x = finite(candidate?.x);
  const y = finite(candidate?.y);

  return x === null || y === null ? null : { x, y };
}

/* A rectangle around a segment, grown by `halfDepth` on every side. */
function segmentBounds(start, end, halfDepth = 0) {
  if (!start || !end) {
    return null;
  }

  const grow = Math.abs(Number(halfDepth) || 0);

  return {
    minX: Math.min(start.x, end.x) - grow,
    minY: Math.min(start.y, end.y) - grow,
    maxX: Math.max(start.x, end.x) + grow,
    maxY: Math.max(start.y, end.y) + grow,
  };
}

/* A rectangle around a circle. */
function circleBounds(centre, radius) {
  if (!centre) {
    return null;
  }

  const r = Math.abs(Number(radius) || 0);

  return {
    minX: centre.x - r,
    minY: centre.y - r,
    maxX: centre.x + r,
    maxY: centre.y + r,
  };
}

/* A rectangle around a list of points. */
function pointsBounds(points) {
  return unionBounds((Array.isArray(points) ? points : []).map(boundsOfPoint));
}

/* Every point a geometry mentions, for a shape whose kind we cannot know. */
function everyPointIn(value) {
  const found = [];

  const walk = (node, depth) => {
    if (!node || depth > 4) {
      return;
    }

    if (Array.isArray(node)) {
      node.forEach((entry) => walk(entry, depth + 1));
      return;
    }

    if (typeof node !== "object") {
      return;
    }

    if (finite(node.x) !== null && finite(node.y) !== null) {
      found.push({ x: Number(node.x), y: Number(node.y) });
      return;
    }

    Object.values(node).forEach((entry) => walk(entry, depth + 1));
  };

  walk(value, 0);

  return found;
}

/*
 * THE EXTENT OF ONE OBJECT'S INK.
 *
 * Each branch is the writer's own idea of how big the object is DRAWN, restated
 * as a rectangle. An object this module does not recognise falls back to the
 * points it stores - which is the honest answer: it covers what the object
 * mentions, and an unrecognised type contributes no invented extent.
 */
export function objectBounds(object) {
  if (!object || typeof object !== "object") {
    return null;
  }

  const geometry = object.geometry || {};
  const type = String(object.type || "");

  /* A diagram whose parent has gone draws nothing, so it occupies no space. */
  if (object.engineering?.unresolved === true) {
    return null;
  }

  switch (type) {
    case "pipe-duct": {
      return unionBounds(pipeDuctPaths(geometry.start, geometry.end, object.engineering || {}).flat().map(boundsOfPoint));
    }
    case "beam": {
      const start = pointOf(geometry.start);
      const end = pointOf(geometry.end);

      /* The beam's own depth when it has one - the same rule the writer uses. */
      const stored = finite(geometry.depth);
      const halfDepth = stored !== null && stored > 0 ? stored / 2 : BEAM_HALF_DEPTH;

      return segmentBounds(start, end, halfDepth);
    }

    case "shaft": {
      const start = pointOf(geometry.start);
      const end = pointOf(geometry.end);
      const radius = Math.abs(finite(geometry.diameter) ?? 0) / 2 || 4;

      return segmentBounds(start, end, radius);
    }

    case "cable":
    case "line": {
      const start = pointOf(geometry.start);
      const end = pointOf(geometry.end);

      return segmentBounds(start || pointOf(geometry.position), end);
    }

    case "truss": {
      const start = pointOf(geometry.start);
      const end = pointOf(geometry.end);

      if (Array.isArray(geometry.members) && geometry.members.length) {
        return unionBounds(
          geometry.members.map((member) =>
            segmentBounds(pointOf(member?.start), pointOf(member?.end), 1),
          ),
        );
      }

      return segmentBounds(start, end, TRUSS_DEPTH);
    }

    case "rigid-body": {
      const centre = pointOf(geometry.center || geometry.position);

      if (String(geometry.shape || "").toLowerCase() === "circle") {
        return circleBounds(centre, Math.abs(finite(geometry.radius) ?? 0));
      }

      if (Array.isArray(geometry.points) && geometry.points.length) {
        return pointsBounds(geometry.points.map(pointOf));
      }

      const position = pointOf(geometry.position);
      const width = Math.abs(finite(geometry.width) ?? 0);
      const height = Math.abs(finite(geometry.height) ?? 0);

      return position
        ? { minX: position.x, minY: position.y, maxX: position.x + width, maxY: position.y + height }
        : null;
    }

    case "particle":
      return circleBounds(pointOf(geometry.position), PARTICLES_RADIUS);

    case "force":
    case "resultant":
    case "force-components": {
      const spans = [geometry.horizontal, geometry.vertical, geometry.original].filter(Boolean);

      if (spans.length) {
        return unionBounds(spans.map((span) => segmentBounds(pointOf(span.start), pointOf(span.end))));
      }

      const start = pointOf(geometry.start || geometry.position);
      const end = pointOf(geometry.end);

      if (start && end) {
        return segmentBounds(start, end);
      }

      return start ? boundsOfPoint(start) : null;
    }

    case "load":
    case "varying-load": {
      const start = pointOf(geometry.start);
      const end = pointOf(geometry.end);

      /*
       * A LOAD REACHES BEYOND ITS SPAN by the drawn height of its arrows, which
       * is the load's own `arrowLength` (or, when it has none, its peak
       * intensity - the rules the canvas and the writer both use).
       */
      const height = Math.abs(finite(geometry.arrowLength) ?? 0) || Math.abs(finite(geometry.intensity) ?? 0);

      return segmentBounds(start, end, Math.max(height, 1));
    }

    case "moment": {
      const centre = pointOf(geometry.position || geometry.start);
      const radius = Math.abs(finite(geometry.arcRadius) ?? 0) || MOMENT_DEFAULT_RADIUS;

      return circleBounds(centre, radius);
    }

    case "pin-support":
    case "roller-support":
    case "fixed-support":
    case "smooth-support": {

        /*
         * A SUPPORT IS DRAWN OUTWARD FROM ITS ANCHOR, NOT AROUND IT.
         *
         * Its symbol hangs BELOW the member it carries: the triangle's base is
         * at the anchor's `out` side and the hatching lies further along it, while
         * along the member it only spreads `SUPPORT_SIZE` either way. A circle of
         * `SUPPORT_SIZE + SUPPORT_GROUND` about the anchor therefore reserved a
         * large square of empty space ABOVE the beam - where nothing is drawn -
         * and the export was fitted to that emptiness rather than to the drawing.
         *
         * The reach is measured along the support's own frame instead.
         */
        const anchor = pointOf(geometry.position);

        if (!anchor) {
          return null;
        }

        const angle = finite(geometry.orientation) ?? 0;
        const out = { x: Math.cos(angle), y: Math.sin(angle) };
        const across = { x: -out.y, y: out.x };

        const along = SUPPORT_SIZE;
        const outward = SUPPORT_SIZE + SUPPORT_GROUND / 2 + (type === "roller-support" ? 3.5 : 0);

        const offset = (u, v) => ({
          x: anchor.x + out.x * u + across.x * v,
          y: anchor.y + out.y * u + across.y * v,
        });

        return unionBounds([
          boundsOfPoint(offset(-along, -along)),
          boundsOfPoint(offset(-along, along)),
          boundsOfPoint(offset(outward, -along)),
          boundsOfPoint(offset(outward, along)),
        ]);
      }

    case "pin-connection":
    case "fixed-connection":
    case "slider-connection":
    case "connection": {
      const start = pointOf(geometry.start || geometry.position);
      const end = pointOf(geometry.end || geometry.start || geometry.position);

      return segmentBounds(start, end, 8);
    }

    case "coordinate-system":
    case "coordinate-system-2d": {
      const origin = pointOf(geometry.origin);

      if (!origin) {
        return null;
      }

      const fallback = Math.abs(finite(geometry.axisLength) ?? 0) || 25;

      const arms = [
        finite(geometry.xPositiveLength),
        finite(geometry.xNegativeLength),
        finite(geometry.yPositiveLength),
        finite(geometry.yNegativeLength),
      ].map((value) => (value !== null && value > 0 ? value : fallback));

      const reach = Math.max(...arms, fallback);

      return circleBounds(origin, reach);
    }

    case "analysis-diagram":
    case "shear-force-diagram":
    case "bending-moment-diagram":
    case "axial-force-diagram": {
      const start = pointOf(geometry.start);
      const end = pointOf(geometry.end);

      if (!start || !end) {
        return null;
      }

      /*
       * A DIAGRAM'S EXTENT IS ITS FRAME, NOT ITS AXIS.
       *
       * The axis is the body's span; the graph reaches an ordinate height above
       * and below it, plus the axis extension and its labels to the right. The
       * values are the canvas's own frame (`ANALYSIS_FRAME`), restated here
       * because a bounds module must stay free of the renderer.
       */
      const ordinate = LABEL_REACH * 4;
      const right = LABEL_REACH * 2;

      const sketches = Array.isArray(geometry.sketchElements)
        ? geometry.sketchElements.flatMap((element) => everyPointIn(element))
        : [];

      return unionBounds([
        {
          minX: Math.min(start.x, end.x),
          minY: Math.min(start.y, end.y) - ordinate,
          maxX: Math.max(start.x, end.x) + right,
          maxY: Math.max(start.y, end.y) + ordinate,
        },
        pointsBounds(sketches),
      ]);
    }

    default:
      break;
  }

  /* Everything else: the points its geometry mentions, plus a label's reach. */
  const points = everyPointIn(geometry);

  if (!points.length) {
    return null;
  }

  const shape = pointsBounds(points);

  return shape
    ? {
        minX: shape.minX - LABEL_REACH,
        minY: shape.minY - LABEL_REACH,
        maxX: shape.maxX + LABEL_REACH,
        maxY: shape.maxY + LABEL_REACH,
      }
    : null;
}

/*
 * THE BOUNDS OF A WHOLE DRAWING.
 *
 * THE MEASUREMENT IS THE APPLICATION'S OWN FIT-ALL ONE.
 *
 * `drawingBounds` asks the SAME extent function the Fit All button, the
 * print
export and the thumbnails use (`renderedPointsForObjects`, installed as the
 * export module's bounds provider at start-up). Re-implementing the measurement
 * here would give the export a second opinion about how big the drawing is, and
 * the two would eventually disagree - a figure that fits in one place and runs
 * off the page in another.
 *
 * It is asked at NO PARTICULAR ZOOM, which is the whole point: the measurement is
 * a property of the DRAWING, not of the view. `renderedBounds` takes the scale as
 * a parameter and the provider is called with 1, so a sheet the student happens
 * to be looking at at 400% measures exactly as it does at 25%.
 *
 * `objects` is everything the sheet holds. Hidden objects are excluded, because
 * the canvas does not draw them and a figure must not reserve space for them.
 *
 * An EMPTY drawing answers `null`, which the export reads as "there is nothing to
 * fit" - a different answer from "the drawing is a single point at 0,0".
 */
export function drawingBounds(objects) {
  const drawn = (Array.isArray(objects) ? objects : []).filter(
    (object) => object && object.visible !== false && object.hidden !== true,
  );

  const measured = measuredDrawingBounds(drawn);

  if (measured) {
    return measured;
  }

  /*
   * NO INSTALLED PROVIDER - a unit test, or a module loaded outside the editor.
   * The per-object extents below are then the answer: they cover what each type
   * draws, which is a real measurement rather than a guess, and they agree with
   * the writers because both read `symbol-sizes.js`.
   */
  return unionBounds(drawn.map(objectBounds));
}

/*
 * THE INSTALLED FIT-ALL MEASUREMENT, if the application has one.
 *
 * Reached through the export module by name rather than imported: this file is
 * loaded by the source writers, which run outside a browser in the tests, and
 * pulling the whole export module in would drag the DOM with it.
 */
function measuredDrawingBounds(objects) {
  const provider = globalThis.enggDrawnBoundsProvider;

  if (typeof provider !== "function" || !objects.length) {
    return null;
  }

  try {
    const points = provider(objects, 1) || [];

    const rectangle = unionBounds(points.map(boundsOfPoint));

    return rectangle;
  } catch {
    /* A provider that throws is not a measurement; fall back to the objects. */
    return null;
  }
}

export default {
  objectBounds,
  drawingBounds,
};
