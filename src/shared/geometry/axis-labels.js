/*
 * ========================================================
 * COORDINATE-SYSTEM AXIS LABELS
 * ========================================================
 *
 * Where a coordinate system's X and Y labels are DRAWN.
 *
 * This is a leaf module on purpose. The renderer draws the labels, the hit test
 * picks them, and the drag writes them; all three must agree about where a label
 * is. If any one of them computed the position itself they could disagree, and
 * the symptom would be a label that cannot be clicked where it is drawn - the
 * worst kind of defect, because it looks like the click was ignored.
 *
 * It imports NOTHING. Putting this in the hit-testing module instead pulled the
 * editor's import graph into the renderer and made a cycle that broke start-up,
 * which is exactly the kind of coupling a small shared leaf avoids.
 */

/*
 * The minimum half-length an axis is drawn at when no length is stored.
 *
 * It matches the renderer's own floor, so a coordinate system saved before the
 * axis was given an explicit length still has its labels in the right place.
 */
const MINIMUM_AXIS_LENGTH = 15;

function axisLength(geometry, key) {
  const stored = Number(geometry?.[key] ?? geometry?.axisLength);

  return Math.max(
    MINIMUM_AXIS_LENGTH,
    Number.isFinite(stored) && stored > 0 ? stored : 25,
  );
}

/*
 * Every visible label of one coordinate system, in document order.
 *
 * A label with a STORED position is drawn there - that position is the
 * student's, and it is what makes the label a movable annotation rather than
 * part of the axis. Without one it sits at its automatic place beside the axis
 * end, which is where it has always been drawn.
 *
 * AN EMPTY LABEL IS NOT RETURNED. Clearing the field is how a student says
 * "no label here", so there is nothing to draw, nothing to pick and nothing to
 * drag.
 */
function axisLabelPositions(object) {
  const geometry = object?.geometry;

  if (!geometry?.origin) {
    return [];
  }

  const labels = [];

  const x = String(geometry.xLabel ?? "X");
  const y = String(geometry.yLabel ?? "Y");

  if (x.trim()) {
    labels.push({
      id: `${object.id}:x-axis-label`,
      type: "axis-label",
      axis: "x",
      sourceFeatureId: object.id,
      text: x,
      position: geometry.xLabelPosition || {
        x: geometry.origin.x + axisLength(geometry, "xPositiveLength") + 5,
        y: geometry.origin.y - 6,
      },
    });
  }

  if (y.trim()) {
    labels.push({
      id: `${object.id}:y-axis-label`,
      type: "axis-label",
      axis: "y",
      sourceFeatureId: object.id,
      text: y,
      position: geometry.yLabelPosition || {
        x: geometry.origin.x + 6,
        y: geometry.origin.y - axisLength(geometry, "yPositiveLength") - 5,
      },
    });
  }

  return labels;
}

const enggAxisLabels = {
  MINIMUM_AXIS_LENGTH,
  axisLabelPositions,
};

export default enggAxisLabels;
export { axisLabelPositions };
