/*
 * ============================================================
 * APPLYING A PARSE TO THE DRAWING
 * ============================================================
 *
 * The bridge between "what the source says" and "what the student has on the
 * canvas". `source-object-sync.js` reads a draft and reports what changed; this
 * module performs those changes on the drawing model.
 *
 * THE FOUR RULES IT KEEPS.
 *
 *   1. AN INVALID STATEMENT NEVER REACHES THE MODEL. Its object keeps its last
 *      valid representation, and a statement with no previous object creates
 *      nothing. `readSourceIntoModel` has already decided that; this module only
 *      applies the answer.
 *
 *   2. AN UPDATE IS MERGED, NOT REPLACED. Geometry that the statement expresses
 *      is written into the object; every other field (name, label, parent,
 *      engineering role) survives. That is what keeps a beam a beam after a
 *      dimension of its span is retyped.
 *
 *   3. A DELETION REMOVES, AN EDIT DOES NOT. Removal happens only for an object
 *      whose block is really gone from the text - never for one whose block is
 *      momentarily incomplete.
 *
 *   4. THIS IS BACKGROUND WORK, SO IT RECORDS NO HISTORY. Typing in Source
 *      produces at most one undo entry - the edit itself, recorded by the tab -
 *      not one per re-parse. Canvas edits keep recording through the model's own
 *      commit path, as they always have.
 */

import { createSourceMap } from "./drawing-source.js";
import { readSourceIntoModel } from "./source-object-sync.js";
import { shapeFromStatement } from "./source-model.js";
import { reconcileFluidConnections } from "../../../features/workspace/interaction/pipe-duct-tool.js";

/* ============================================================
 * GEOMETRY AND STYLE FROM ONE SHAPE
 * ============================================================
 *
 * Only the fields the statement actually states are written. A shape with no
 * colour leaves the object's colour alone, which is what makes a source edit
 * that touches only coordinates a coordinate edit.
 */
function geometryOf(shape) {
  switch (shape.type) {
    case "line":
      return { start: { ...shape.from }, end: { ...shape.to } };
    case "pipe-duct":
      return { start: { ...shape.start }, end: { ...shape.end } };

    /*
     * AN ELBOW'S GEOMETRY IS ITS CORNER AND ITS TWO ENDS. Both walls of the block
     * become THIS one geometry - which is what keeps the two paths linked to one
     * object - and the connection record is left alone by this merge, so a source
     * edit cannot silently orphan a fitting from the pipes it joins.
     */
    case "elbow":
      return {
        position: { ...shape.position },
        ends: { a: { ...shape.ends.a }, b: { ...shape.ends.b } },
        previous: { ...shape.previous },
        next: { ...shape.next }
      };
    case "circle":
      return { center: { ...shape.centre }, radius: shape.radius };
    case "rectangle":
      return {
        position: {
          x: Math.min(shape.from.x, shape.to.x),
          y: Math.min(shape.from.y, shape.to.y)
        },
        width: Math.abs(shape.to.x - shape.from.x),
        height: Math.abs(shape.to.y - shape.from.y)
      };
    case "arc":
      return {
        center: { ...shape.centre },
        radius: shape.radius,
        startAngle: shape.startAngle,
        endAngle: shape.endAngle
      };
    case "point":
      return { position: { ...shape.position } };
    case "polyline":
      return { points: shape.points.map((point) => ({ ...point })) };
    default:
      return null;
  }
}

function styleOf(shape) {
  const style = {};

  if (shape.stroke) {
    style.stroke = shape.stroke;
  }

  /*
   * TikZ's `line width` is a print width in millimetres; the model stores a
   * multiplier of the standard 0.4pt line (0.56 is lineWidth 1). The same
   * constant in reverse, so a width written to source and read back is the width
   * it was.
   */
  if (Number.isFinite(shape.lineWidth) && shape.lineWidth > 0) {
    style.lineWidth = Number((shape.lineWidth / 0.56).toFixed(3));
  }

  return style;
}

/* Merge a shape into an existing object, in place. Returns whether it changed. */
function mergeShapeIntoObject(object, shape) {
  const geometry = geometryOf(shape);

  if (!geometry) {
    return false;
  }

  const before = signatureOf(object);

  const next = { ...object.geometry };

  Object.entries(geometry).forEach(([key, value]) => {
    next[key] = value;
  });

  object.geometry = next;

  const style = styleOf(shape);

  if (Object.keys(style).length) {
    object.style = { ...(object.style || {}), ...style };
  }

  /*
   * A PIPE'S WIDTH COMES FROM ITS TWO WALLS.
   *
   * The separation the source shows is read back into the run's Pipe Width
   * Change, so editing the gap between the walls in the Source tab widens the
   * pipe on the canvas. A block whose walls are exactly the default separation
   * stores no change at all, so the run keeps tracking the drawing default.
   */
  if (shape.type === "pipe-duct" && Number.isFinite(shape.separation)) {
    object.engineering = { ...(object.engineering || {}) };

    if (Math.abs(shape.separation) < 1e-9) {
      delete object.engineering.separation;
    } else {
      object.engineering.separation = Number(shape.separation.toFixed(6));
    }
  }

  /*
   * AN ELBOW'S BEND RADIUS AND ANGLE COME FROM ITS ARCS.
   *
   * A retyped radius changes the fitting's bend; a retyped sweep changes its
   * angle. A NEGATIVE `delta angle` states a bend in the other direction, so the
   * angle is taken as its magnitude - the bend a fitting has is positive on either
   * side, and the side itself lives in the geometry.
   */
  if (shape.type === "elbow") {
    const angle = Math.abs(Number(shape.angleDegrees));

    object.engineering = {
      ...(object.engineering || {}),
      bendRadius: shape.bendRadius,
      angleDegrees: Number.isFinite(angle) ? angle : object.engineering?.angleDegrees,
      angle: Number.isFinite(angle) ? angle : object.engineering?.angle
    };
  }

  /*
   * THE CHANGE IS THE WHOLE OBJECT'S, NOT JUST ITS GEOMETRY. A run whose walls
   * were moved only further apart or closer together has an unchanged
   * centreline but a changed width; an elbow whose arcs were retuned has an
   * unchanged corner but a changed radius. Both are real edits the caller must
   * hear about.
   */
  return signatureOf(object) !== before;
}

/* The properties one shape edit can change, as one comparable string. */
function signatureOf(object) {
  return JSON.stringify({
    geometry: object.geometry,
    style: object.style,
    separation: object.engineering?.separation,
    bendRadius: object.engineering?.bendRadius,
    angle: object.engineering?.angleDegrees
  });
}

/* ============================================================
 * APPLY
 * ============================================================
 *
 * `model` is the drawing-state module (its exported table), `state` is the live
 * drawing state. Returns a report of what happened, so a caller can update
 * selection, the status line or a test can assert the outcome.
 */
export function applyParsedSourceToDrawing({
  model,
  state,
  source,
  objects = null,
  editable = true,
  removeMissing = false
}) {
  const managerObjects = Array.isArray(objects) ? objects : state.objects || [];

  const parsed = readSourceIntoModel({
    source,
    map: createSourceMap(source),
    objects: managerObjects,
    /* Never treat a missing block as a deletion while the student is typing. */
    isEditing: () => true
  });

  const created = [];
  const updated = [];
  const removed = [];

  /* The objects that existed before the edit, for the elbow report below. */
  const before = new Set(state.objects.map((object) => object.id));

  parsed.updates.forEach((entry) => {
    if (mergeShapeIntoObject(entry.object, entry.shape)) {
      updated.push(entry.object.id);
    }
  });

  parsed.created.forEach((entry) => {
    /*
     * THE BLOCK'S ID IS THE OBJECT'S ID. Without that the block would stop
     * naming an object on the next parse, and the student would have an object
     * that the code no longer describes.
     */
    const object = model.geometryObjectFromSource(entry.object.type, entry.object.geometry, {
      id: entry.id,
      name: entry.object.name,
      style: entry.object.style
    });

    if (object) {
      state.objects = [...state.objects, object];
      created.push(object.id);
    }
  });

  if (parsed.removed.length && removeMissing) {
    parsed.removed.forEach((id) => {
      model.removeObject(state, id);
      removed.push(id);
    });
  }

  /*
   * A RETYPED PIPE JOINS ITS JOINTS THE SAME WAY A DRAGGED ONE DOES.
   *
   * Source editing is a supported way to move geometry, so a coordinate typed into
   * the Source tab must earn the fitting a drag would have earned - and a pipe
   * retyped away from its neighbour must lose the one it had. Only the pipes that
   * were created or changed are visited, so an unrelated connection is never
   * touched by an edit somewhere else.
   */
  [...new Set([...created, ...updated])]
    .map((id) => state.objects.find((object) => object.id === id))
    .filter((object) => object?.type === "pipe-duct")
    .forEach((run) => {
      reconcileFluidConnections(run, state.objects);
    });

  /*
   * AND THE SETTLEMENT ITSELF MAY HAVE ADDED OR REMOVED A FITTING, so the report
   * the caller acts on includes those objects too.
   */
  state.objects.forEach((object) => {
    if (object.type === "elbow" && !created.includes(object.id) && !updated.includes(object.id)) {
      if (!before.has(object.id)) {
        created.push(object.id);
      } else {
        updated.push(object.id);
      }
    }
  });

  return {
    created,
    updated,
    removed,
    invalid: parsed.invalid,
    unsupported: parsed.unsupported,
    changed: created.length > 0 || updated.length > 0 || removed.length > 0
  };
}

/* The shape a single statement describes, for a caller that has the text only. */
export { shapeFromStatement };

export default { applyParsedSourceToDrawing, shapeFromStatement };
