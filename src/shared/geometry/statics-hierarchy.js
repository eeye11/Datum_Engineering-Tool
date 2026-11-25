/*
 * ============================================================
 * WHO FOLLOWS WHOM
 * ============================================================
 *
 * The Statics object hierarchy, in one place.
 *
 * A BODY IS A PARENT. A load, a moment, a support or a connection endpoint that
 * was placed on a body records that body's id in `parentId`, and from then on
 * its position is a RELATIONSHIP rather than a pair of coordinates: moving the
 * body carries it, turning the body turns it, fixing the body fixes it.
 *
 * A CHILD'S OWN TRANSFORM DOES NOT MOVE ITS PARENT. Dragging a load along its
 * beam changes where on the beam the load acts; the beam does not move.
 *
 * A CONNECTION IS ONE OBJECT WITH TWO ENDPOINTS - two bodies, two attachments -
 * so it appears once in the Objects list and both ends follow their own bodies.
 *
 * AN ANALYSIS OBJECT (a diagram) keeps the id of the body it reads in
 * `engineering.parentBodyId`. It is not a structural child - deleting its beam
 * must not delete the student's drawn solution - but its FRAME follows that
 * beam, and when the beam is gone it is marked unresolved rather than left
 * asserting a value from a member that is no longer there.
 *
 * WHY THIS IS A MODULE. Every one of these rules used to live at a call site:
 * the drag in `handles.js`, the panel in `feature-schema.js`, the renderer in
 * `analysis-render.js`. Three copies of "what follows a beam" disagree as soon
 * as one of them is edited - which is how a support stays put while its beam
 * moves. One predicate, asked by all of them.
 *
 * IT DOES NOT MOVE ANYTHING ITSELF. Moving is `feature-geometry.translateObject`
 * and `rotateObjectAbout`, which every feature already obeys; this module says
 * WHICH objects a move applies to.
 */

import { isStaticsBodyType } from "../model/feature-types.js";

/* The bodies a Statics feature may be attached to. */
export function isBody(object) {
  return Boolean(object) && isStaticsBodyType(object.type);
}

/* A feature whose position is defined relative to a body. */
export function isAttachedChild(object) {
  return Boolean(object?.parentId) && !isBody(object);
}

/* The body a feature is attached to, or null. */
export function parentOf(object, objects = []) {
  if (!object?.parentId) {
    return null;
  }

  return objects.find((candidate) => candidate.id === object.parentId) || null;
}

/* Every feature attached to one body, in the order they were drawn. */
export function childrenOf(objects, parentId) {
  if (!parentId) {
    return [];
  }

  return objects.filter((object) => object.parentId === parentId);
}

/*
 * THE BODY AN ANALYSIS OBJECT READS.
 *
 * A diagram stores the body it was made from in `engineering.parentBodyId`
 * rather than in `parentId`, because it is a READING of the body and not part
 * of its structure: the tree must not offer to delete a student's solution when
 * they delete a beam, but the diagram must still know what it is about.
 */
export function analysedBodyOf(object, objects = []) {
  const id = object?.engineering?.parentBodyId;

  if (!id) {
    return null;
  }

  return objects.find((candidate) => candidate.id === id) || null;
}

/*
 * IS THE FEATURE HELD IN PLACE?
 *
 * A child is fixed when it is fixed itself OR when the body it belongs to is -
 * a lock on a beam is a lock on the beam as an assembly, which is what "Fix"
 * means to a student. Analysis diagrams are not held by their body: their frame
 * follows it, but the student may still reposition the drawing.
 */
export function isHeld(object, objects = []) {
  if (!object) {
    return false;
  }

  if (object.locked === true) {
    return true;
  }

  const parent = parentOf(object, objects);

  return Boolean(parent?.locked === true);
}

/*
 * EVERY OBJECT THAT MUST MOVE WITH THIS ONE.
 *
 * The object itself first, then its structural children, then any analysis
 * object whose frame is drawn from it. Callers translate or rotate each of
 * them by the SAME delta, which is what keeps an attachment at the same place
 * on its body - the alternative, re-deriving each child's position from the
 * parent afterwards, is a second implementation of the same arithmetic.
 */
export function transformGroupOf(object, objects = []) {
  if (!object) {
    return [];
  }

  const group = [object];

  if (!isBody(object)) {
    return group;
  }

  objects.forEach((candidate) => {
    if (candidate.id === object.id) {
      return;
    }

    if (candidate.parentId === object.id) {
      group.push(candidate);

      return;
    }

    /* A diagram's frame is drawn from its body, so it travels with it. */
    if (
      candidate.type === "analysis-diagram" &&
      candidate.engineering?.parentBodyId === object.id
    ) {
      group.push(candidate);
    }
  });

  return group;
}

/*
 * THE REFERENCE OBJECTS ARE NEVER STRUCTURAL PARENTS OR CHILDREN.
 *
 * A Coordinate System, a Reference Point, a Reference Line and a Reference Arc
 * are construction aids. They may be USED by another object (a Components
 * analysis reads a coordinate system), but that is a reference, not a
 * parent/child bond: moving a reference must not move the structure, and
 * deleting one must not take a body with it.
 */
export const REFERENCE_TYPES = Object.freeze([
  "coordinate-system-2d",
  "coordinate-system",
  "point",
  "line",
  "arc",
]);

export function isReferenceObject(object) {
  if (!object) {
    return false;
  }

  if (REFERENCE_TYPES.includes(object.type)) {
    /*
     * A POINT, A LINE OR AN ARC IS ONLY A REFERENCE WHEN IT SAYS SO.
     *
     * The same types are ordinary Geometry and plain Annotate content, and
     * a line a student drew is not a reference line. The statics role is
     * what marks it, and it is recorded at creation.
     */
    return (
      object.type === "coordinate-system-2d" ||
      object.type === "coordinate-system" ||
      String(object.engineering?.staticsType || "").startsWith("reference-")
    );
  }

  return false;
}

/*
 * Connection endpoints, as the two attachments one connection carries.
 *
 * A connection is ONE object. Historically an endpoint could be recorded either
 * on `engineering.attachments` (the current shape) or as the start/end point of
 * the span (the older one). Both are read here so an existing document keeps
 * working, but only one shape is ever WRITTEN - see `setConnectionEndpoints`.
 */
export function connectionEndpointsOf(object) {
  const stored = object?.engineering?.attachments;

  if (Array.isArray(stored) && stored.length >= 2) {
    return [
      { bodyId: stored[0]?.bodyId || null, point: stored[0]?.point || null },
      { bodyId: stored[1]?.bodyId || null, point: stored[1]?.point || null },
    ];
  }

  const geometry = object?.geometry || {};

  return [
    {
      bodyId: object?.engineering?.startBodyId || null,
      point: geometry.start || null,
    },
    {
      bodyId: object?.engineering?.endBodyId || null,
      point: geometry.end || null,
    },
  ];
}

export function isAnalysisDiagram(object) {
  return Boolean(object) && object.type === "analysis-diagram";
}

export default {
  isBody,
  isAttachedChild,
  parentOf,
  childrenOf,
  analysedBodyOf,
  isHeld,
  transformGroupOf,
  connectionEndpointsOf,
  isReferenceObject,
  REFERENCE_TYPES,
  isAnalysisDiagram,
};
