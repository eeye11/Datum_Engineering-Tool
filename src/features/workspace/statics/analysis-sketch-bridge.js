/*
 * ============================================================
 * THE UNIFIED SKETCH WORKSPACE FOR A STATICS DIAGRAM
 * ============================================================
 *
 * A Statics analysis diagram is drawn in the SAME editor as a Math sketch. That
 * is the whole point of the shared infrastructure: an anchor means one thing in
 * DAETUM, and a student who learned how to place one on a graph already knows
 * how to place one on a load diagram.
 *
 * WHAT THIS MODULE IS FOR
 * -----------------------
 * The workspace speaks in sketch geometry - elements with points, appearance and
 * a correction. A Statics diagram stores STROKES on its own object. This is the
 * one place the two meet, so the translation is stated once instead of being
 * spread through the editor and the commit.
 *
 * WHAT IT CARRIES
 * ---------------
 *   - the geometry, as strokes with their own Bezier segments, so the diagram
 *     draws what the editor previewed
 *   - the appearance, so a dashed load line stays dashed
 *   - the correction, so a recognised line is committed as a line rather than
 *     as a polyline that happens to be straight
 */

import { openSketchWorkspace } from "../../../shared/ui/sketch/sketch-workspace.js";
import { createSketchDocument } from "../../../shared/sketch/sketch-document.js";
import { makePoint } from "../../../shared/sketch/sketch-points.js";
import { normaliseAppearance, resolveColour } from "../../../shared/sketch/sketch-appearance.js";

/*
 * THE DOCUMENT AN EXISTING DIAGRAM OPENS IN.
 *
 * Its strokes become elements, so reopening an old diagram shows the same
 * drawing - and editing it in the new editor does not silently redraw it in a
 * different style. Each stroke keeps its own points; the correction is set to
 * "curve" with the stroke's own segments, because that is what it is.
 */
export function documentFromStrokes(strokes = []) {
  const geometry = (Array.isArray(strokes) ? strokes : [])
    .filter((stroke) => Array.isArray(stroke?.points) && stroke.points.length > 1)
    .map((stroke, index) => ({
      kind: stroke.type === "line" ? "line" : "curve",
      name: stroke.name || `Stroke ${index + 1}`,
      points: stroke.points.map((point) => ({ x: Number(point.x) || 0, y: Number(point.y) || 0 })),
      segments: Array.isArray(stroke.segments) ? stroke.segments : [],
      closed: false,
      original: stroke.points.map((point) => ({ x: Number(point.x) || 0, y: Number(point.y) || 0 })),
      correction: { kind: stroke.type === "line" ? "line" : "curve", confidence: 1 },
      appearance: normaliseAppearance(stroke.appearance),
    }));

  return createSketchDocument({ geometry });
}

/*
 * THE ELEMENTS A DIAGRAM'S COMMIT EXPECTS.
 *
 * `kind` is the diagram's own word - "straight" or "curved" - because that is
 * what `applySketchStrokes` reads to decide whether a stroke becomes a Line or
 * a Polyline. A recognised line is a straight stroke; everything else is a
 * polyline through its corrected points.
 */
export function elementsFromPlaced(placed) {
  return (placed?.geometry || [])
    .filter((element) => element.visible !== false && (element.points || []).length > 1)
    .map((element) => ({
      kind: element.kind === "line" ? "straight" : "curved",
      points: element.points.map((point) => ({ x: point.x, y: point.y })),
      segments: element.segments || [],
      appearance: element.appearance,
      name: element.name,
      correction: element.correction,
    }));
}

/*
 * THE STYLE A COMMITTED STROKE TAKES.
 *
 * The diagram object has its own style, and the sketch's appearance is layered
 * on top: a student who set a dashed red line in the editor gets a dashed red
 * line on the diagram. The colour is resolved against the object's ink when the
 * student never picked one, so a default-coloured stroke follows the theme.
 */
export function styleFromPlaced(placed, baseStyle = {}, themeInk = "#000000") {
  const first = (placed?.geometry || []).find((element) => element.visible !== false);

  const appearance = normaliseAppearance(first?.appearance);

  return {
    ...baseStyle,
    stroke: resolveColour(appearance, baseStyle.stroke || themeInk),
    width: { thin: 0.6, normal: 1.2, bold: 2, heavy: 3 }[appearance.thickness] || 1.2,
    lineStyle: appearance.lineStyle,
  };
}

/* The student points that belong to the placed sketch, carried for editing. */
export function pointsFromPlaced(placed) {
  return (placed?.points || []).map((point) => ({
    id: point.id,
    name: point.name,
    type: point.type,
    x: point.x,
    y: point.y,
    coordinateMode: point.coordinateMode,
    referenceId: point.referenceId,
    locked: point.locked,
  }));
}

/*
 * OPEN THE WORKSPACE FOR A DIAGRAM.
 *
 * `options` carries what the diagram needs: its title, its existing strokes, and
 * the two callbacks the placement workflow uses. The workspace itself knows
 * nothing about Statics, which is what lets the same editor serve a graph."
 */
export function openDiagramSketch({ title, strokes = [], onPlace, onCancel } = {}) {
  return openSketchWorkspace({
    title: title || "Sketch",
    document: documentFromStrokes(strokes),
    onPlace: (placed) => {
      onPlace?.({
        elements: elementsFromPlaced(placed),
        style: styleFromPlaced(placed),
        points: pointsFromPlaced(placed),
        transform: placed.transform,
        document: placed.document,
      });
    },
    onCancel,
  });
}

export { makePoint };

export default {
  documentFromStrokes,
  elementsFromPlaced,
  styleFromPlaced,
  pointsFromPlaced,
  openDiagramSketch,
};
