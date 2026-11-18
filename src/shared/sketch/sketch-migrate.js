 /*
 * ============================================================
 * MIGRATING A SAVED SKETCH
 * ============================================================
 *
 * A sketch outlives the version of DAETUM that made it. When a model changes,
 * a document written by an older build must still OPEN - and it must open
 * looking the same, or the student's drawing has been silently altered by an
 * upgrade.
 *
 * WHAT CHANGED, AND WHAT HAPPENS TO IT
 * ------------------------------------
 *
 * SHAPE GUIDES ARE GONE. A saved sketch may still contain points of type
 * `guide`, and their constraint was soft: they pulled a curve toward themselves
 * without requiring it. The stroke was always the real guide, so the honest
 * migration is to DROP the soft points and keep every hard one - an anchor is
 * a promise, a guide was a hint, and a hint that no longer exists cannot break
 * a drawing. An element that listed a guide loses the reference; its geometry
 * is untouched.
 *
 * Dropping a point must never leave another point dangling: a point defined
 * RELATIVE to a guide is restated as absolute at the position it had, so it
 * does not move and does not reference something that is no longer there.
 *
 * `influence` WAS A GUIDE'S STRENGTH and is dropped with it - there is no soft
 * constraint left for it to shape. A POINT'S ROLE ("path" or "centre") is
 * added by default, because a saved point that predates the role is a point on
 * a path.
 *
 * BOUNDS MODES. A document with no `boundsMode` is automatic - that was the
 * default before the field existed.
 *
 * THE RULE: a migrated document is never MUTATED IN PLACE and never silently
 * loses geometry. `migrateSketch` returns the document plus a list of what it
 * changed, so a test - or the interface - can say what happened.
 */

import { resolvePoints } from "./sketch-points.js";
import { normaliseAppearance } from "./sketch-appearance.js";
import { normaliseGrid } from "./sketch-grid.js";

/* The current schema version. */
export const SKETCH_SCHEMA_VERSION = 2;

/* The point kinds this version understands. */
const CURRENT_POINT_TYPES = ["anchor", "control", "inferred"];

/* The geometry kinds this version understands. */
const CURRENT_GEOMETRY_KINDS = [
  "line",
  "polyline",
  "polygon",
  "circle",
  "ellipse",
  "arc",
  "rectangle",
  "curve",
  "composite",
];

function finite(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
}

/*
 * MIGRATE A SAVED DOCUMENT TO THE CURRENT MODEL.
 *
 * Returns `{ document, changes, migrated }`. `changes` is a list of short
 * descriptions - "dropped 2 shape guides" - so the caller can report them
 * rather than applying a silent rewrite.
 */
export function migrateSketch(input = {}) {
  const source = input && typeof input === "object" ? input : {};

  const changes = [];

  const version = Number(source.schemaVersion) || 1;

  if (version > SKETCH_SCHEMA_VERSION) {
    /*
     * A NEWER DOCUMENT IS NOT DOWNGRADED. Guessing at fields this build does
     * not know is how a future feature's data gets destroyed by an older
     * build; the document is opened as it is and the mismatch is reported.
     */
    return {
      document: source,
      changes: [
        `saved by a newer version (schema ${version}); opened unchanged`,
      ],
      migrated: false,
      tooNew: true,
    };
  }

  /* ---- 1. drop the soft points, keeping every hard one ---- */
  const points = Array.isArray(source.points) ? source.points : [];

  const removedGuides = points.filter((point) => point?.type === "guide");

  const keptPoints = points.filter((point) => CURRENT_POINT_TYPES.includes(point?.type));

  if (removedGuides.length) {
    changes.push(
      `dropped ${removedGuides.length} shape guide${removedGuides.length === 1 ? "" : "s"}`,
    );
  }

  const removedIds = new Set(removedGuides.map((point) => point.id));

  /*
   * A POINT THAT DEPENDED ON A GUIDE IS RESTATED, NOT DROPPED.
   *
   * The relative point has an absolute position already - it is resolved
   * against the points it references - so it becomes absolute at exactly that
   * place. Nothing moves, and nothing references a point that is gone.
   */
  const resolved = resolvePoints(points);

  const repaired = keptPoints.map((point) => {
    /*
     * EVERY POINT THIS BUILD OPENS CARRIES THE CURRENT FIELDS: a role (a saved
     * point was a point on a path) and no guide influence, which no longer
     * exists. Nothing else about the point changes.
     */
    const base = {
      ...point,
      role: point.role === "centre" ? "centre" : "path",
    };

    delete base.influence;

    if (!point.referenceId || !removedIds.has(point.referenceId)) {
      return base;
    }

    const at = resolved.find((entry) => entry.id === point.id)?.absolute;

    changes.push(`restated ${point.name || point.id} as absolute`);

    return {
      ...base,
      coordinateMode: "absolute",
      referenceId: null,
      delta: null,
      distance: null,
      angleDeg: null,
      x: at ? at.x : finite(point.x),
      y: at ? at.y : finite(point.y),
    };
  });

  /* ---- 2. the geometry ---- */
  const geometry = (Array.isArray(source.geometry) ? source.geometry : [])
    .filter((element) => element && typeof element === "object")
    .map((element) => {
      const kind = CURRENT_GEOMETRY_KINDS.includes(element.kind)
        ? element.kind
        : "curve";

      if (kind !== element.kind) {
        changes.push(`${element.name || element.id}: ${element.kind} -> curve`);
      }

      const migrated = {
        ...element,
        kind,
        points: (element.points || []).map((point) => ({
          x: finite(point?.x),
          y: finite(point?.y),
        })),
        segments: Array.isArray(element.segments) ? element.segments : [],
        appearance: normaliseAppearance(element.appearance),
        /*
         * A GUIDE A GEOMETRY LISTED IS A REFERENCE TO A POINT THAT IS GONE, so
         * the field is not carried forward at all. The element's own anchors are
         * kept, minus any that were guides.
         */
        anchors: (element.anchors || []).filter(
          (id) => !removedIds.has(id) && typeof id === "string",
        ),
        /* A circle or arc centred on a point keeps that point's id, if it lives. */
        centrePointId:
          element.centrePointId && !removedIds.has(element.centrePointId)
            ? element.centrePointId
            : null,
        visible: element.visible !== false,
      };

      /* A guide's soft pull has no meaning any more, so the field is gone. */
      delete migrated.guides;

      return migrated;
    });

  /* ---- 3. the view settings ---- */
  const grid = normaliseGrid(source.grid || {});

  const boundsMode = source.boundsMode === "manual" ? "manual" : "auto";

  const document = {
    ...source,
    schemaVersion: SKETCH_SCHEMA_VERSION,
    points: repaired,
    geometry,
    grid,
    boundsMode,
    appearance: normaliseAppearance(source.appearance),
    transform: source.transform || { x: 0, y: 0, rotation: 0, scale: 1 },
    revision: (Number(source.revision) || 0) + 1,
  };

  return {
    document,
    changes,
    migrated: changes.length > 0 || version < SKETCH_SCHEMA_VERSION,
    tooNew: false,
  };
}

/* Whether a document needs migrating at all. */
export function needsMigration(input) {
  if (!input || typeof input !== "object") {
    return false;
  }

  if (Number(input.schemaVersion) < SKETCH_SCHEMA_VERSION) {
    return true;
  }

  return (input.points || []).some((point) => !CURRENT_POINT_TYPES.includes(point?.type));
}

export default {
  SKETCH_SCHEMA_VERSION,
  migrateSketch,
  needsMigration,
};
