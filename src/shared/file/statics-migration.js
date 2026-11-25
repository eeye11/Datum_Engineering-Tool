/*
 * ============================================================
 * BRING AN OLDER STATICS DOCUMENT UP TO THE CURRENT SHAPE
 * ============================================================
 *
 * A Statics object is one drawing object carrying three kinds of fact:
 *
 *   engineering   what the load IS - its magnitude, direction, unit, sources
 *   geometry      where it is DRAWN - endpoints, arc radius, attachment
 *   label         the words beside it
 *
 * Older documents kept parts of that differently, and a few of them carried
 * derived quantities that the CURRENT build recomputes. This module re-seats
 * those facts in the place the current code reads them from, using each
 * object's own stored geometry - never a scale factor, and never a conversion
 * of the student's drawing.
 *
 * WHAT IS DELIBERATELY NOT DONE.
 *
 *   No arrow is resized. An arrow's length is the one it was drawn at; the
 *   retired Vector Scale once derived length from magnitude, and applying any
 *   factor here would re-introduce exactly the coupling this architecture
 *   removes. If an old object has no drawn `end`, it is given one FROM ITS OWN
 *   MAGNITUDE AND ANGLE - which is what the old build drew - and no object that
 *   already has an end is touched.
 *
 *   No parent is invented. An object with a `parentId` keeps it; an object
 *   without one stays a top-level object, because guessing a parent from
 *   proximity would silently change what the drawing claims.
 *
 * IT IS IDEMPOTENT. Running it twice leaves a document unchanged, so it is safe
 * to call on every open, whatever the file's age.
 */

import {
  isStaticsBodyType,
  isSupportType,
  isConnectionType,
  attachableStaticsType,
} from "../model/feature-types.js";

/* The engineering properties that belong on an object rather than in geometry. */
const ENGINEERING_KEYS = Object.freeze([
  "magnitude",
  "angle",
  "direction",
  "unit",
  "forceUnit",
  "loadUnit",
  "intensity",
  "startIntensity",
  "endIntensity",
]);

function isPoint(value) {
  return Boolean(
    value &&
    Number.isFinite(Number(value.x)) &&
    Number.isFinite(Number(value.y)),
  );
}

/*
 * AN ARROW THAT WAS SAVED WITHOUT ITS DRAWN END.
 *
 * A force saved before arrows kept their drawn length states only a magnitude
 * and an angle. The old build drew it as `magnitude x VectorScale`; without a
 * scale, the honest reconstruction is the arrow the student would have seen at
 * the smallest scale the build ever used, which is the drawn length itself. The
 * value is kept as a direction and a length, and the magnitude is NOT changed.
 */
function seedDrawnEnd(object) {
  const g = object.geometry;

  if (!g || (object.type !== "force" && object.type !== "resultant")) {
    return;
  }

  if (isPoint(g.end)) {
    return;
  }

  const start = isPoint(g.start)
    ? g.start
    : isPoint(g.position)
      ? g.position
      : null;

  const magnitude = Number(g.magnitude);
  const angle = Number(g.angle);

  if (!start || !Number.isFinite(magnitude) || !Number.isFinite(angle)) {
    return;
  }

  const radians = (angle * Math.PI) / 180;
  const length = Math.abs(magnitude);

  g.start = { x: start.x, y: start.y };
  g.end = {
    x: start.x + Math.cos(radians) * length,
    y: start.y + Math.sin(radians) * length,
  };
  g.position = g.position || { x: start.x, y: start.y };
}

/*
 * A RESULTANT OR COMPONENTS PAIR THAT PREDATES THE SOURCES LIST.
 *
 * An analysis object is a READING of its sources. A file saved before the list
 * existed has no way to say what it read, so it is marked unresolved instead of
 * being left looking live: a resultant that cannot name its forces must not
 * claim to be their sum.
 */
function markUnsourcedAnalysis(object) {
  if (object.type !== "resultant" && object.type !== "force-components") {
    return;
  }

  const ids = object.engineering?.sourceFeatureIds;

  if (!Array.isArray(ids) || !ids.length) {
    object.engineering = {
      ...(object.engineering || {}),
      unresolved: true,
    };
  }
}

/*
 * A SUPPORT SAVED BEFORE ATTACHMENTS WERE FRACTIONS.
 *
 * `attachment` is a fraction along the parent, which is what survives the body
 * being moved or resized. A file that stored a bare world point as its
 * attachment is given the point's own form back so the rest of the code can
 * read one shape - the FRACTION is recomputed by the body-frame code the next
 * time the support is placed, and until then the stored point is used as is.
 */
function normaliseSupportAttachment(object) {
  const g = object.geometry;

  if (!g || !isSupportType(object.type) || !g.attachment) {
    return;
  }

  if (Number.isFinite(Number(g.attachment.fraction))) {
    return;
  }

  if (isPoint(g.attachment)) {
    g.attachment = { point: { x: g.attachment.x, y: g.attachment.y } };
  }
}

/*
 * A CONNECTION'S TWO ENDPOINTS, IN THE ONE SHAPE THE CURRENT CODE READS.
 *
 * A connection is ONE object joining TWO bodies. The current shape is
 * `engineering.attachments`, a list of two `{ bodyId, point }` entries; an older
 * one kept the ids as separate fields. They are folded into the list here so
 * every reader has one form - and the object stays one object.
 */
function normaliseConnection(object) {
  if (!isConnectionType(object.type)) {
    return;
  }

  const engineering = object.engineering || {};
  const geometry = object.geometry || {};

  const stored = Array.isArray(engineering.attachments)
    ? engineering.attachments
    : null;

  const first = stored?.[0] || {
    bodyId: engineering.startBodyId || object.parentId || null,
    point: geometry.start || null,
  };

  const second = stored?.[1] || {
    bodyId: engineering.endBodyId || engineering.endParentId || null,
    point: geometry.end || null,
  };

  object.engineering = {
    ...engineering,
    attachments: [
      {
        bodyId: first.bodyId || null,
        point: isPoint(first.point)
          ? { x: first.point.x, y: first.point.y }
          : null,
      },
      {
        bodyId: second.bodyId || null,
        point: isPoint(second.point)
          ? { x: second.point.x, y: second.point.y }
          : null,
      },
    ],
  };
}

/*
 * A CHILD WHOSE PARENT IS NOT A BODY.
 *
 * `parentId` says where an object BELONGS in the drawing. A file that recorded
 * a non-body there - a reference, or an analysis diagram - is telling the tree
 * to nest a support under something that cannot hold it. The stale link is
 * cleared rather than left to nest a structural object under a construction
 * aid.
 */
function clearNonBodyParent(object, byId) {
  if (!object.parentId) {
    return;
  }

  const parent = byId.get(object.parentId);

  if (!parent) {
    /* The parent is gone: the object is still a real object, on its own. */
    delete object.parentId;

    return;
  }

  if (!isStaticsBodyType(parent.type) && !isConnectionType(object.type)) {
    if (attachableStaticsType(object.type)) {
      delete object.parentId;
    }
  }
}

/* One sheet's objects. */
function migrateObjects(objects) {
  if (!Array.isArray(objects)) {
    return 0;
  }

  const byId = new Map(objects.map((object) => [object.id, object]));

  let changed = 0;

  objects.forEach((object) => {
    if (!object || typeof object !== "object") {
      return;
    }

    const before = JSON.stringify(object);

    /*
     * THE ENGINEERING PROPERTIES STAY ON THE GEOMETRY THEY WERE SAVED
     * WITH. They are read from there by every current reader, so this is
     * a statement of where they belong rather than a move: an object that
     * already has them in the right place is left untouched.
     */
    if (object.geometry) {
      ENGINEERING_KEYS.forEach((key) => {
        if (object.geometry[key] === undefined && object[key] !== undefined) {
          object.geometry[key] = object[key];
          delete object[key];
        }
      });
    }

    /* A label is always a string, so an absent one reads as "no text". */
    if (object.label !== undefined && typeof object.label !== "string") {
      object.label = String(object.label ?? "");
    }

    seedDrawnEnd(object);
    markUnsourcedAnalysis(object);
    normaliseSupportAttachment(object);
    normaliseConnection(object);
    clearNonBodyParent(object, byId);

    if (JSON.stringify(object) !== before) {
      changed += 1;
    }
  });

  return changed;
}

/*
 * THE DOCUMENT ENTRY POINT. Hands back the number of objects it adjusted, so a
 * caller can report a migration honestly rather than guessing.
 */
export function migrateStaticsDocument(document) {
  if (!document || typeof document !== "object") {
    return 0;
  }

  let changed = 0;

  /*
   * A DOCUMENT IS A LIST OF SHEETS. A version-1 file is one drawing, which the
   * document-file migration has already wrapped into a sheet by the time this
   * runs - so both shapes reach the same loop.
   */
  const sheets = Array.isArray(document.sheets) ? document.sheets : [];

  sheets.forEach((sheet) => {
    changed += migrateObjects(sheet?.objects);
  });

  changed += migrateObjects(document.objects);

  return changed;
}

export default {
  migrateStaticsDocument,
};
