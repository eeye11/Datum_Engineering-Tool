/*
 * ============================================================
 * THE SKETCH HALF OF AN ANALYSIS DIAGRAM
 * ============================================================
 *
 * A Sketch is the student DRAWING the answer. It is not a dialog with its own
 * private canvas: the strokes are ordinary DAETUM features - a Line, a
 * Polyline, an Arc - created with the ordinary tools, on the sheet, against the
 * diagram's own axis.
 *
 * WHY THAT IS THE MODEL
 * ---------------------
 * The previous Sketch system was a modal editor with four tools of its own and
 * a private coordinate space. It stored its strokes in `geometry.sketchElements`
 * as graph-local points, which meant:
 *
 *   - the strokes were not features, so they could not be selected, moved,
 *     duplicated, undone or written to the source like anything else;
 *   - the editor had to re-implement drawing, snapping, selection and erasing;
 *   - a stroke could not be adjusted by its handles, because it had none;
 *   - the sheet and the source each had a second, parallel way of reading a
 *     diagram's ink.
 *
 * So the strokes are now real features, and the ONLY thing this module adds is
 * the RELATIONSHIP between a diagram and the strokes that belong to it. That
 * relationship is `parentId`, the field the Feature Tree already nests by, plus
 * the `analysisSketch` marker that says what the child is for.
 *
 * WHAT THE RELATIONSHIP BUYS
 * --------------------------
 *   - the strokes are drawn by the ordinary renderer, in the diagram's own
 *     colour, because they are ordinary features;
 *   - they are written to the source by the ordinary writer, for the same
 *     reason;
 *   - they are selected, moved, duplicated, undone and deleted by the shared
 *     systems, with no analysis-specific code;
 *   - deleting the diagram deletes them, because that is what a parent does;
 *   - moving the diagram carries them, because `selectionMembers` already
 *     follows `parentId`.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not create the strokes. The student does, with the Line, Polyline and
 * Arc tools, which is the whole point of Sketch being a drawing mode. This
 * module only answers "which strokes belong to this diagram" and "make this
 * stroke belong to it".
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import { drawingState } from "../editor-state.js";

/*
 * The marker a sketch stroke carries.
 *
 * A stroke is a Line, a Polyline or an Arc - it keeps its own type, because it
 * IS that geometry and must behave like it. This marker is what says it is also
 * part of a diagram's sketch, so a consumer can tell a stroke the student drew
 * as the answer from a line they drew for some other reason.
 */
export const ANALYSIS_SKETCH_MARKER = "analysis-sketch";

/*
 * The feature types a sketch stroke may be.
 *
 * Deliberately the drawing primitives that can express a diagram: a straight
 * run, a chain of runs, and a curve. A Rectangle or a Circle is not a diagram,
 * and offering them would let a student draw something the source cannot
 * describe as a graph.
 */
export const SKETCH_STROKE_TYPES = Object.freeze(["line", "polyline", "arc"]);

export function isSketchStrokeType(type) {
  return SKETCH_STROKE_TYPES.includes(type);
}

/*
 * Is this feature a stroke belonging to a diagram's sketch?
 *
 * Asked of the marker rather than of the parent, because a diagram may have
 * other children - a dimension on it, an annotation - and those are not
 * strokes.
 */
export function isSketchStroke(object) {
  return Boolean(
    object && object.engineering?.analysisSketch === ANALYSIS_SKETCH_MARKER,
  );
}

/*
 * The strokes belonging to one diagram, in the order they were drawn.
 *
 * Read from the document rather than from the diagram, so there is one answer
 * to "what is in this sketch" and it is the same answer the Feature Tree, the
 * renderer and the source all read.
 */
export function sketchStrokesOf(diagram, state = drawingState) {
  if (!diagram) {
    return [];
  }

  return (state.objects || []).filter(
    (object) => object.parentId === diagram.id && isSketchStroke(object),
  );
}

/*
 * Whether a diagram has any sketch ink.
 *
 * The renderer uses this to decide whether the plot area is earned, and the
 * Features panel to say whether the sketch is empty. Derived from the strokes
 * rather than stored as a flag, so it cannot disagree with what is on the
 * sheet.
 */
export function sketchHasContent(diagram, state = drawingState) {
  return sketchStrokesOf(diagram, state).length > 0;
}

/*
 * ========================================================
 * THE LEGACY SKETCH, READ FOR COMPATIBILITY
 * ========================================================
 *
 * A drawing saved before this change carries its strokes in
 * `geometry.sketchElements` - graph-local points that were never features.
 * Those strokes are still the student's work, so they are not thrown away:
 * they are converted into real features the first time the drawing is opened.
 *
 * The conversion is a MIGRATION, not a second live representation. Once it has
 * run, `sketchElements` is removed from the diagram, so there is exactly one
 * place a sketch lives and no code path can read the old one by accident.
 *
 * The projection is the same one the old renderer used: x is a station along
 * the body, mapped onto the diagram's axis; y is a value, mapped by the
 * diagram's own units-per-value. That is what makes a migrated stroke land
 * exactly where the student saw it.
 */
export function migrateLegacySketch(diagram, state = drawingState) {
  const geometry = diagram?.geometry;

  if (!geometry || !Array.isArray(geometry.sketchElements)) {
    return [];
  }

  const elements = geometry.sketchElements;

  /*
   * The old store is dropped whether or not anything converts, so a diagram
   * whose strokes cannot be projected does not keep offering them to a reader
   * that no longer exists.
   */
  delete geometry.sketchElements;
  delete geometry.sketchContent;

  if (!elements.length) {
    return [];
  }

  const created = [];

  elements.forEach((element) => {
    const stroke = legacyElementToFeature(element, diagram, geometry);

    if (!stroke) {
      return;
    }

    created.push(enggDrawingState.addObject(state, stroke));
  });

  return created;
}

/*
 * One legacy element, as a real feature.
 *
 * A legacy element is either a straight line (two points) or a curve through
 * its points. A two-point element becomes a Line; anything longer becomes a
 * Polyline, which is the feature that already means "a chain of runs through
 * these points" and needs no new type.
 */
function legacyElementToFeature(element, diagram, geometry) {
  const points = legacyPointsOf(element)
    .map((point) => projectLegacyPoint(point, geometry))
    .filter(Boolean);

  if (points.length < 2) {
    return null;
  }

  const style = {
    ...(diagram.style || {}),
  };

  /*
   * A NAME IS REQUIRED BY `addObject`, which numbers a feature by it. An
   * empty name is the "unnamed" case and is stored as given, so the stroke
   * is named for what it is rather than inheriting the diagram's name.
   */
  const base = {
    name: points.length === 2 ? "Line" : "Polyline",
    parentId: diagram.id,
    style,
    engineering: {
      plane: "XY",
      discipline: "statics",
      analysisSketch: ANALYSIS_SKETCH_MARKER,
      sketchOf: diagram.id,
    },
  };

  if (points.length === 2) {
    return {
      ...base,
      type: "line",
      geometry: {
        start: points[0],
        end: points[1],
      },
    };
  }

  return {
    ...base,
    type: "polyline",
    geometry: {
      points,
    },
  };
}

/* The points a legacy element was drawn through. */
function legacyPointsOf(element) {
  if (!element) {
    return [];
  }

  if (element.kind === "line") {
    return [element.start, element.end].filter(Boolean);
  }

  if (element.kind === "curve3") {
    return [element.start, element.bend, element.end].filter(
      (point) => point && Number.isFinite(point.x),
    );
  }

  return Array.isArray(element.points) ? element.points : [];
}

/*
 * A legacy graph-local point, in world space.
 *
 * The same mapping the old renderer used, restated here because the old
 * renderer no longer exists. `localRange` is the body's own 0-to-L, and
 * `unitHeight` is the units-per-value the sketch was drawn at - both stored on
 * the diagram, so a migrated stroke lands where it was drawn.
 */
function projectLegacyPoint(point, geometry) {
  const range = geometry.localRange;
  const start = geometry.start;
  const end = geometry.end;

  if (
    !range ||
    !start ||
    !end ||
    !Number.isFinite(point?.x) ||
    !Number.isFinite(point?.y)
  ) {
    return null;
  }

  const width = range.to - range.from;

  if (!(width > 0)) {
    return null;
  }

  const scale =
    Number(geometry.unitHeight) > 0 ? Number(geometry.unitHeight) : 0;

  return {
    x: start.x + (end.x - start.x) * ((point.x - range.from) / width),
    y: start.y + point.y * scale,
  };
}


export default {
  ANALYSIS_SKETCH_MARKER,
  SKETCH_STROKE_TYPES,
  isSketchStrokeType,
  isSketchStroke,
  sketchStrokesOf,
  sketchHasContent,
  migrateLegacySketch,
};
