/*
 * ============================================================
 * THE UNIFIED SKETCH WORKSPACE -> THE DOCUMENT
 * ============================================================
 *
 * The workspace speaks in ordinary sketch geometry: lines, circles, curves,
 * each with its own appearance and its own points in model space. A Graph on a
 * sheet is a PLOT with limits and stored strokes. This module is the only place
 * the two meet, so the conversion is stated once instead of being spread
 * through the editor and the commit.
 *
 * TWO THINGS IT KEEPS FAITHFUL
 * ----------------------------
 *
 * 1. THE APPEARANCE. A curve drawn dashed in the editor is committed dashed.
 *    The workspace's appearance is copied into the plot's style, not dropped.
 *
 * 2. THE GEOMETRY. Every curve travels as its own stroke with its own
 *    segments, so the committed object draws the same Beziers the preview did -
 *    there is no re-sampling on the way out.
 *
 * A CIRCLE BECOMES A CLOSED CURVE. A plot stores strokes, and a circle IS a
 * closed stroke through its sampled points; committing it as one keeps the
 * drawing and the editor agreeing instead of introducing a second shape type
 * the renderer would have to learn.
 */

import { normaliseAppearance, resolveColour } from "../../../shared/sketch/sketch-appearance.js";

/* The strokes a plot draws, from the workspace's geometry. */
export function strokesFromGeometry(geometry = []) {
  return (Array.isArray(geometry) ? geometry : [])
    .filter((element) => element && element.visible !== false)
    .map((element) => ({
      points: (element.points || []).map((point) => ({ x: point.x, y: point.y })),
      segments: Array.isArray(element.segments) ? element.segments : [],
      closed: Boolean(element.closed) || element.kind === "circle",
      correction: element.correction || null,
      appearance: normaliseAppearance(element.appearance),
      kind: element.kind,
      id: element.id,
      name: element.name,
    }))
    .filter((stroke) => stroke.points.length > 1);
}

/* The points the student defined, so the committed sketch keeps its constraints. */
export function pointsFromDocument(document) {
  return (document?.points || []).map((point) => ({
    id: point.id,
    name: point.name,
    type: point.type,
    x: point.x,
    y: point.y,
    coordinateMode: point.coordinateMode,
    referenceId: point.referenceId,
    delta: point.delta,
    distance: point.distance,
    angleDeg: point.angleDeg,
    locked: point.locked,
    influence: point.influence,
  }));
}

/*
 * THE PLOT'S STYLE, FROM THE FIRST ELEMENT'S APPEARANCE.
 *
 * A plot has ONE stroke colour and width, because it draws its runs as a whole.
 * The first element's appearance is therefore the plot's - which is honest
 * about the limit, and leaves the per-element appearances stored on the placed
 * geometry for an editor that can show them.
 */
export function styleFromGeometry(geometry = [], themeInk = "#000000") {
  const first = (Array.isArray(geometry) ? geometry : []).find(
    (element) => element && element.visible !== false,
  );

  const appearance = normaliseAppearance(first?.appearance);

  const thickness = {
    thin: 0.6,
    normal: 1.2,
    bold: 2,
    heavy: 3,
  }[appearance.thickness] || 1.2;

  return {
    stroke: resolveColour(appearance, themeInk),
    width: thickness,
    lineStyle: appearance.lineStyle,
    fill: appearance.fillEnabled ? appearance.fill : null,
    fillOpacity: appearance.fillOpacity,
    colourIsCustom: !appearance.isDefaultColour,
  };
}

/*
 * THE RESULT THE GRAPH COMMIT EXPECTS.
 *
 * `geometry` is the placed box in drawing units; the strokes are the model
 * geometry the workspace produced, already transformed by the placement.
 */
export function sketchResultFromWorkspace(placed, { title = "Sketch", themeInk = "#000000" } = {}) {
  const transform = placed?.transform || { x: 0, y: 0, rotation: 0, scale: 1 };

  const strokes = strokesFromGeometry(placed?.geometry || []);

  return {
    name: title,
    strokes,
    points: placed?.points || [],
    style: styleFromGeometry(placed?.geometry || [], themeInk),
    appearance: placed?.appearance || null,
    /*
     * THE BOX IS THE SKETCH'S OWN EXTENT, in drawing units. It is what the
     * commit gives the plot, and it is derived from the geometry rather than
     * assumed, so a small sketch is not committed inside a large empty box.
     */
    geometry: {
      mode: "sketch",
      position: { x: transform.x || 0, y: transform.y || 0 },
      width: boundsOf(strokes).width,
      height: boundsOf(strokes).height,
      showXAxis: false,
      showYAxis: false,
      showGrid: false,
      showTickLabels: false,
      boundsMode: "auto",
      points: [],
    },
  };
}

/* The extent of a set of strokes, in their own coordinates. */
export function boundsOf(strokes = []) {
  const points = (Array.isArray(strokes) ? strokes : []).flatMap(
    (stroke) => stroke.points || [],
  );

  if (!points.length) {
    return { x: 0, y: 0, width: 200, height: 200 };
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);

  const x = Math.min(...xs);
  const y = Math.min(...ys);

  return {
    x,
    y,
    width: Math.max(Math.max(...xs) - x, 1),
    height: Math.max(Math.max(...ys) - y, 1),
  };
}

export default {
  strokesFromGeometry,
  styleFromGeometry,
  sketchResultFromWorkspace,
  boundsOf,
  pointsFromDocument,
};
