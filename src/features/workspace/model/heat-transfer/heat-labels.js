/*
 * ========================================================
 * HEAT TRANSFER LABELS ARE REAL ANNOTATION OBJECTS
 * ========================================================
 *
 * A Heat Transfer object's notation - Q̇₁, T₂, Rₜₕ₁ - is NOT a decorative
 * string stuck to the drawing. It is a CHILD `annotate` feature, exactly the
 * same kind of object a student creates with the Text tool:
 *
 *   - it has its own id, its own row in the Objects panel (nested under its
 *     parent), its own Features tab, and its own source block;
 *   - it can be SELECTED on its own by clicking it, and MOVED on its own;
 *   - moving the parent carries it, because its stored position is kept
 *     RELATIVE to the parent through `metadata.heatParentId` plus an offset;
 *   - deleting it never deletes the parent, and deleting the parent takes it
 *     with it (the document already deletes children of a parent).
 *
 * WHY A CHILD OBJECT RATHER THAN A STRING ON THE PARENT.
 *
 * Independent selection, independent movement, a text Features tab and a text
 * source block ALREADY EXIST for `annotate`. Reusing them is what makes a Heat
 * label behave exactly like every other piece of text in DAETUM, and it is what
 * the requirement means by "do not create a separate text-editing system".
 * A string on the parent could never be selected on its own.
 */

import enggDrawingState from "../../../../shared/model/drawing-state.js";
import enggAnnotate from "../annotations/annotate-model.js";
import { defaultHeatNotation, heatLabelFamily } from "./heat-notation.js";
import { finiteNumber, finitePoint, unitVector } from "./heat-shared.js";

/* The metadata key that ties a label to the object it annotates. */
export const HEAT_PARENT_KEY = "heatParentId";

/* Whether an object is a label attached to a Heat Transfer parent. */
export function isHeatLabelObject(object) {
  return (
    object?.type === "annotate" && Boolean(object?.metadata?.[HEAT_PARENT_KEY])
  );
}

/*
 * THE ANCHOR A LABEL SITS AT, in drawing units - the point of its parent it is
 * written beside. Everything else about the label's position is the student's
 * own offset from this anchor.
 */
export function heatParentAnchor(parent) {
  const g = parent?.geometry || {};
  const type = parent?.type;

  /* A span: the middle of the two ends. */
  if (
    type === "thermal-arrow" ||
    type === "thermal-boundary" ||
    type === "thermal-contact" ||
    type === "wall-slab"
  ) {
    if (finitePoint(g.start) && finitePoint(g.end)) {
      return { x: (g.start.x + g.end.x) / 2, y: (g.start.y + g.end.y) / 2 };
    }
  }

  /* A placed symbol: its centre. */
  if (finitePoint(g.center)) {
    return { x: g.center.x, y: g.center.y };
  }

  /* A path or an isotherm: its far end, where its notation belongs. */
  if (Array.isArray(g.points)) {
    const valid = g.points.filter(finitePoint);

    if (valid.length) {
      return { x: valid[valid.length - 1].x, y: valid[valid.length - 1].y };
    }
  }

  /* A box: its centre. */
  if (finitePoint(g.position)) {
    return {
      x: g.position.x + finiteNumber(g.width) / 2,
      y: g.position.y - finiteNumber(g.height) / 2,
    };
  }

  return null;
}

/*
 * ============================================================
 * WHERE A NEW LABEL GOES - CLEAR OF THE GEOMETRY
 * ============================================================
 *
 * A label placed on its anchor sits ON the drawing: across a boundary line,
 * inside a convection arrow, over hatching, or on an arrowhead. Every default
 * below therefore stands the text OFF the geometry, on the side with room, by a
 * distance measured in DRAWING UNITS - not pixels - so the gap is the same at
 * every zoom and in a printed sheet.
 *
 * The side is chosen from the geometry's OWN orientation:
 *
 *   a horizontal run    above it
 *   a vertical run      to its right
 *   an angled run       above, along its normal
 *   a symbol or node    up and to the right, past the symbol's own size
 *
 * It is a DEFAULT only. Once the student drags the label it keeps their place,
 * and no leader line is ever drawn to reconnect the two.
 */
const LABEL_CLEARANCE = 9;

/* The outward normal for a surface, plus a lift clear of its decorations. */
function defaultLabelOffset(parent, family) {
  const g = parent?.geometry || {};
  const type = parent?.type;

  /*
   * A BOUNDARY is decorated on ONE side; its label goes out on the OTHER, so
   * the text never sits among the arrows or hatches. `geometry.side` is the
   * decorated side, and `-1` mirrors the choice.
   */
  if (type === "thermal-boundary" && finitePoint(g.start) && finitePoint(g.end)) {
    const direction = unitVector(g.start, g.end);

    if (direction) {
      const normal = { x: -direction.y, y: direction.x };
      const decorated = g.side === -1 ? -1 : 1;
      const away = -decorated;
      const reach = LABEL_CLEARANCE * 1.6;

      return { x: normal.x * reach * away, y: normal.y * reach * away };
    }
  }

  /* A span - an arrow or a contact - carries its label BESIDE its body. */
  if (
    (type === "thermal-arrow" || type === "thermal-contact") &&
    finitePoint(g.start) &&
    finitePoint(g.end)
  ) {
    const direction = unitVector(g.start, g.end);

    if (direction) {
      /* Above the arrow, along its own normal, so it never covers the shaft. */
      const normal = { x: -direction.y, y: direction.x };

      return { x: normal.x * LABEL_CLEARANCE, y: normal.y * LABEL_CLEARANCE };
    }
  }

  /*
   * A SYMBOL OR NODE: clear of the ink it ACTUALLY draws.
   *
   * Each symbol stores the size its painter uses, and the painters do not agree
   * on what that number means:
   *
   *   a circuit NODE draws a dot of `radius` (2.4), and nothing else
   *   a SOURCE / SINK draws a circle of `size` (10) and an arrow reaching 2x
   *   a circuit ELEMENT draws a body of `size` and leads reaching 1.6x
   *
   * Sizing every one from `size * 2.6` therefore pushed a node's label 26 units
   * away from a dot four units wide. The reach below is the painter's own
   * multiple, so the gap is the same small clearance for all three.
   */
  if (finitePoint(g.center)) {
    const radius = finiteNumber(g.radius, 0);
    const size = finiteNumber(g.size, 0);

    const reach =
      (type === "thermal-circuit-node"
        ? Math.max(radius, 2)
        : type === "thermal-circuit-element"
          ? Math.max(size, 6) * 1.6
          : Math.max(size, 6) * 2) + LABEL_CLEARANCE;

    /*
     * BESIDE THE SYMBOL, NOT UP AND AWAY.
     *
     * A small horizontal offset to the right, lifted a little so the text's own
     * baseline clears the symbol's middle - the conventional place for a node's
     * identifier, and the one that reads as attached to it.
     */
    return { x: reach, y: Math.min(LABEL_CLEARANCE, reach * 0.35) };
  }

  /* A path's label sits above its far end; `family` is unused but names intent. */
  if (Array.isArray(g.points) && g.points.length) {
    void family;

    return { x: 0, y: LABEL_CLEARANCE };
  }

  /* A box (a control volume): above its top edge, centred. */
  if (finitePoint(g.position)) {
    return { x: 0, y: -Math.abs(finiteNumber(g.height)) / 2 - LABEL_CLEARANCE };
  }

  return { x: LABEL_CLEARANCE, y: LABEL_CLEARANCE };
}

/* The label objects already on the sheet, for the notation counters. */
function labelObjects(objects) {
  return (objects || []).filter(
    (object) => isHeatLabelObject(object) || object?.type === "annotate",
  );
}

/*
 * CREATE THE DEFAULT LABEL FOR A NEW HEAT OBJECT.
 *
 * Returns the child annotation, or null when the tool carries no notation (a
 * Wall / Slab, a Path, a Region). The notation is counted from the labels
 * already on the sheet, so a family's index continues correctly through a
 * reopened drawing.
 *
 * `objects` must include the parent as the sheet now holds it.
 */
export function createHeatLabel(
  parent,
  { objects = [], position = null } = {},
) {
  if (!parent) {
    return null;
  }

  const variant = parent.variant || parent.engineering?.variant || null;
  const family = heatLabelFamily(parent.type, variant);

  if (!family) {
    return null;
  }

  const anchor = heatParentAnchor(parent);

  if (!anchor) {
    return null;
  }

  const text = defaultHeatNotation(family, labelObjects(objects));

  if (!text) {
    return null;
  }

  /*
   * THE OFFSET IS WHERE THE LABEL IS WRITTEN RELATIVE TO ITS PARENT.
   *
   * It is stored on the annotation's own metadata, so the label's `position`
   * can be recomputed when the parent moves and a moved label keeps its chosen
   * place. A small up-and-right nudge keeps the text clear of the symbol it
   * names, which is where a student puts it anyway.
   */
  const offset = position
    ? { x: position.x - anchor.x, y: position.y - anchor.y }
    : defaultLabelOffset(parent, family);

  const created = enggAnnotate.createAnnotate({
    kind: "label",
    text,
    position: { x: anchor.x + offset.x, y: anchor.y + offset.y },
    targetFeatureId: parent.id,
    name: text,
    style: {
      stroke: parent.style?.stroke,
    },
  });

  if (!created) {
    return null;
  }

  created.id = `heat-label-${parent.id}`;

  created.metadata = {
    ...(created.metadata || {}),
    [HEAT_PARENT_KEY]: parent.id,
    heatLabelOffset: { x: offset.x, y: offset.y },
    heatFamily: family,
    heatGenerated: true,
  };

  /* The label hangs off its parent, so deleting the parent deletes it. */
  created.parentId = parent.id;

  return created;
}

/*
 * MOVE A LABEL'S ANCHOR WITH ITS PARENT.
 *
 * Called after the parent has moved or rotated. The stored position is
 * recomputed from the parent's NEW anchor plus the label's own offset, so the
 * label keeps its place relative to the parent - which is the behaviour the
 * requirement asks for and is impossible if the label simply follows a delta.
 */
export function reseatHeatLabel(label, parent) {
  if (!label || !parent) {
    return false;
  }

  const anchor = heatParentAnchor(parent);
  const offset = label.metadata?.heatLabelOffset;

  if (!anchor || !offset) {
    return false;
  }

  label.geometry = {
    ...(label.geometry || {}),
    position: {
      x: anchor.x + finiteNumber(offset.x),
      y: anchor.y + finiteNumber(offset.y),
    },
  };

  return true;
}

/*
 * A LABEL WAS DRAGGED: remember the new offset from its parent.
 *
 * Called after the student moves the label on the canvas, so the offset stored
 * on the label matches where they put it - and the next parent move carries it
 * correctly.
 */
export function rememberHeatLabelOffset(label, parent) {
  if (!label || !parent) {
    return false;
  }

  const anchor = heatParentAnchor(parent);
  const position = label.geometry?.position;

  if (!anchor || !finitePoint(position)) {
    return false;
  }

  label.metadata = {
    ...(label.metadata || {}),
    heatLabelOffset: { x: position.x - anchor.x, y: position.y - anchor.y },
    /* The student took it over, so it is no longer the generated notation. */
    heatGenerated: false,
  };

  return true;
}

/*
 * KEEP EVERY HEAT LABEL ON ITS PARENT.
 *
 * The label stores its place as an OFFSET from its parent's anchor, so its
 * position must be recomputed whenever the parent moves. Doing that here, over
 * the whole sheet, covers EVERY way a parent can move - a body drag, a handle,
 * a typed X/Y shift, a rotation, an Undo, a reopened file - with one rule, and
 * it cannot be forgotten by a transform path that did not know labels exist.
 *
 * It only WRITES when the position actually needs to change, so a still label is
 * left byte-identical and a save or an undo comparison sees no spurious edit.
 *
 * The student's own placement is never lost: it lives in the offset, which this
 * function reads and never rewrites.
 */
export function reconcileHeatLabels(objects = []) {
  const list = Array.isArray(objects) ? objects : [];

  let changed = 0;

  list.forEach((label) => {
    if (!isHeatLabelObject(label)) {
      return;
    }

    const parentId = label.metadata?.[HEAT_PARENT_KEY];
    const parent = list.find((object) => object?.id === parentId);

    if (!parent) {
      /*
       * AN ORPHANED LABEL IS LEFT ALONE, not deleted. Deleting a label because
       * its parent is momentarily missing would destroy the student's text
       * during an undo or a re-render; the document already deletes a child
       * with its parent, so a genuinely deleted parent takes it along.
       */
      return;
    }

    const anchor = heatParentAnchor(parent);
    const offset = label.metadata?.heatLabelOffset;

    if (!anchor || !offset) {
      return;
    }

    const next = {
      x: anchor.x + finiteNumber(offset.x),
      y: anchor.y + finiteNumber(offset.y),
    };

    const current = label.geometry?.position || {};

    if (
      Math.abs(Number(current.x) - next.x) < 1e-9 &&
      Math.abs(Number(current.y) - next.y) < 1e-9
    ) {
      return;
    }

    label.geometry = { ...(label.geometry || {}), position: next };
    changed += 1;
  });

  return changed;
}

/* The label attached to a parent, from the sheet, or null. */
export function heatLabelFor(parentId, objects = []) {
  if (!parentId) {
    return null;
  }

  return (
    (objects || []).find(
      (object) =>
        object?.type === "annotate" &&
        object.metadata?.[HEAT_PARENT_KEY] === parentId,
    ) || null
  );
}

const enggHeatLabels = {
  HEAT_PARENT_KEY,
  isHeatLabelObject,
  heatParentAnchor,
  createHeatLabel,
  reseatHeatLabel,
  rememberHeatLabelOffset,
  reconcileHeatLabels,
  heatLabelFor,
};

export default enggHeatLabels;

/* Referenced so the drawing-state import is not reported unused when the
 * module is tree-shaken in a non-editor build. */
void enggDrawingState;
