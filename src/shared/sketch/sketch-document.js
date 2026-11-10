/*
 * ============================================================
 * THE SHARED SKETCH DOCUMENT
 * ============================================================
 *
 * ONE geometry model. The canvas draws it, the inspector edits it, the
 * corrector rewrites parts of it, the placement translates it, and the source
 * generator serialises it. Nothing else holds a second copy of a coordinate.
 *
 * That is the requirement "the source must recreate what DAETUM actually draws,
 * and DAETUM must not display geometry its source cannot reproduce" - and the
 * only way to keep it true is to have exactly one place where geometry lives.
 *
 * WHAT A DOCUMENT HOLDS
 * ---------------------
 *
 *   geometry[]   the elements: kind, identity, points, appearance, transform
 *   points[]     the student's anchors and guides, in one list
 *   grid         the axes and grid settings (a VIEW setting, not geometry)
 *   bounds       the coordinate range (a VIEW setting, not geometry)
 *   appearance   the DEFAULT appearance new geometry gets
 *   transform    the placement transform
 *   revision     a counter that only moves when the MODEL changes
 *
 * WHY A REVISION COUNTER
 * ----------------------
 * Several views of the same sketch exist at once - the canvas, the properties
 * panel, the source box. They must all show the same state, and a stale view
 * must be able to tell whether it is stale. A NUMBER that increments on every
 * model change does that without any of them having to diff the geometry, and
 * it is what lets a source edit be reconciled instead of guessed at.
 *
 * The revision must NOT move on a zoom, a pan, a selection or a tab change:
 * those are not model changes, and treating them as such is how a viewport edit
 * ends up rewriting geometry.
 */

import {
  makePoint,
  resolvePoints,
  withCoordinateMode,
  withAbsolutePosition,
  nextPointName,
} from "./sketch-points.js";
import {
  DEFAULT_APPEARANCE,
  normaliseAppearance,
  withAppearance,
  resetAppearance,
} from "./sketch-appearance.js";
import { normaliseGrid, SKETCH_GRID_DEFAULTS } from "./sketch-grid.js";
import { adapterFor } from "./sketch-geometry-adapters.js";

const DEFAULT_BOUNDS = Object.freeze({ xMin: -5, xMax: 5, yMin: -5, yMax: 5 });

let nextGeometrySerial = 1;

export function nextGeometryId(prefix = "geo") {
  const id = `${prefix}-${nextGeometrySerial}`;

  nextGeometrySerial += 1;

  return id;
}

export function resetGeometryIds(start = 1) {
  nextGeometrySerial = start;
}

function finite(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
}

function copyPoint(point) {
  return { x: finite(point?.x), y: finite(point?.y) };
}

/*
 * ONE GEOMETRY ELEMENT.
 *
 * `kind` decides which adapter owns it and which mathematics fits it. The
 * points are stored in MODEL space; the appearance is stored beside them; the
 * transform is the PLACEMENT, kept separate from the points so moving a sketch
 * cannot change its shape.
 */
export function makeGeometry({
  id = null,
  kind = "curve",
  name = "",
  points = [],
  segments = [],
  centre = null,
  radius = null,
  radiusX = null,
  radiusY = null,
  rotation = 0,
  corner = null,
  width = null,
  height = null,
  closed = false,
  appearance = null,
  transform = null,
  visible = true,
  original = null,
  correction = null,
  anchors = [],
  guides = [],
} = {}) {
  return {
    id: id || nextGeometryId(kind),
    kind,
    name,
    points: (Array.isArray(points) ? points : []).map(copyPoint),
    segments: Array.isArray(segments) ? segments : [],
    centre: centre ? copyPoint(centre) : null,
    radius: radius === null ? null : finite(radius),
    radiusX: radiusX === null ? null : finite(radiusX),
    radiusY: radiusY === null ? null : finite(radiusY),
    rotation: finite(rotation),
    corner: corner ? copyPoint(corner) : null,
    width: width === null ? null : finite(width),
    height: height === null ? null : finite(height),
    closed: Boolean(closed),
    appearance: normaliseAppearance(appearance || DEFAULT_APPEARANCE),
    transform: transform ? { ...transform } : null,
    visible: visible !== false,
    /* The stroke as drawn, so restoring it is a property of the geometry. */
    original: Array.isArray(original) ? original.map(copyPoint) : null,
    correction: correction || null,
    /* Which student points belong to this element. */
    anchors: anchors.slice ? [...anchors] : [],
    guides: guides.slice ? [...guides] : [],
  };
}

/* ============================================================
 * THE DOCUMENT
 * ============================================================ */

export function createSketchDocument(options = {}) {
  const geometry = (
    Array.isArray(options.geometry) ? options.geometry : []
  ).map((entry) => makeGeometry(entry));

  /* Every point carried inside the geometry is also a document point. */
  const inline = geometry.flatMap((entry) => [
    ...entry.anchors,
    ...entry.guides,
  ]);

  return {
    geometry,
    points: (Array.isArray(options.points) ? options.points : inline).map(
      (point) => makePoint(point),
    ),
    grid: normaliseGrid({ ...SKETCH_GRID_DEFAULTS, ...(options.grid || {}) }),
    bounds: { ...DEFAULT_BOUNDS, ...(options.bounds || {}) },
    boundsMode: options.boundsMode === "manual" ? "manual" : "auto",
    appearance: normaliseAppearance(options.appearance || DEFAULT_APPEARANCE),
    transform: options.transform
      ? { ...options.transform }
      : { x: 0, y: 0, rotation: 0, scale: 1 },
    units: options.units || "mm",
    revision: 1,
  };
}

/* A copy with the revision incremented - the ONE way the model changes. */
export function withRevision(document) {
  return { ...document, revision: (Number(document?.revision) || 0) + 1 };
}

/* ============================================================
 * GEOMETRY OPERATIONS
 * ============================================================ */

export function addGeometry(document, geometry) {
  const element = makeGeometry(geometry);

  return withRevision({
    ...document,
    geometry: [...document.geometry, element],
  });
}

export function updateGeometry(document, id, change) {
  let found = false;

  const geometry = document.geometry.map((entry) => {
    if (entry.id !== id) {
      return entry;
    }

    found = true;

    return typeof change === "function"
      ? change(entry)
      : { ...entry, ...change };
  });

  if (!found) {
    return document;
  }

  return withRevision({ ...document, geometry });
}

export function removeGeometry(document, id) {
  const geometry = document.geometry.filter((entry) => entry.id !== id);

  if (geometry.length === document.geometry.length) {
    return document;
  }

  /*
   * THE POINTS THAT LIVED ON IT GO WITH IT. An anchor placed on a curve belongs
   * to that curve; leaving it behind would leave a constraint pointing at
   * nothing, and the next fit would try to honour a location the student can no
   * longer see.
   */
  const points = document.points.filter((point) => point.geometryId !== id);

  return withRevision({ ...document, geometry, points });
}

/* Set an element's appearance, or reset it to the document default. */
export function setGeometryAppearance(document, id, change) {
  return updateGeometry(document, id, (entry) => withAppearance(entry, change));
}

export function resetGeometryAppearance(document, id) {
  return updateGeometry(document, id, (entry) =>
    resetAppearance(entry, document.appearance),
  );
}

/*
 * APPLY ONE APPEARANCE TO MANY ELEMENTS.
 *
 * Selecting several and styling them together is one model change, not one per
 * element - which is what makes it a single undo step and a single revision.
 */
export function setAppearanceForMany(document, ids, change) {
  const wanted = new Set(ids || []);

  if (!wanted.size) {
    return document;
  }

  return withRevision({
    ...document,
    geometry: document.geometry.map((entry) =>
      wanted.has(entry.id) ? withAppearance(entry, change) : entry,
    ),
  });
}

/*
 * CHANGE THE DEFAULT.
 *
 * Only the default moves. Geometry that still LOOKS default follows it; geometry
 * a student styled by hand keeps what it was given - which is the only reading
 * of "do not overwrite individual customizations" that makes sense.
 */
export function setDefaultAppearance(document, change) {
  return withRevision({
    ...document,
    appearance: withAppearance({ appearance: document.appearance }, change)
      .appearance,
  });
}

/* Apply the document default to every element that has no custom choices. */
export function applyDefaultToUntouched(document) {
  return withRevision({
    ...document,
    geometry: document.geometry.map((entry) =>
      entry.appearance?.isDefaultColour &&
      entry.appearance?.lineStyle === "solid"
        ? { ...entry, appearance: normaliseAppearance(document.appearance) }
        : entry,
    ),
  });
}

/* Rename, hide or show an element. */
export function renameGeometry(document, id, name) {
  return updateGeometry(document, id, { name: String(name ?? "") });
}

export function setGeometryVisible(document, id, visible) {
  return updateGeometry(document, id, { visible: Boolean(visible) });
}

/* ============================================================
 * POINT OPERATIONS
 * ============================================================ */
export function addPoint(
  document,
  {
    type = "anchor",
    x = 0,
    y = 0,
    name = null,
    geometryId = null,
    parameter = null,
    coordinateMode = "absolute",
    referenceId = null,
    locked = false,
    influence = 1,
  } = {},
) {
  const point = makePoint({
    type,
    x,
    y,
    name: name || nextPointName(document.points, type === "guide" ? "G" : "P"),
    geometryId,
    parameter,
    coordinateMode,
    referenceId,
    locked,
    influence,
  });

  return {
    document: withRevision({
      ...document,
      points: [...document.points, point],
    }),
    point,
  };
}

export function updatePoint(document, id, change) {
  let found = false;

  const points = document.points.map((point) => {
    if (point.id !== id) {
      return point;
    }

    found = true;

    const next =
      typeof change === "function" ? change(point) : { ...point, ...change };

    return next;
  });

  if (!found) {
    return document;
  }

  return withRevision({
    ...document,
    points,
    geometry: refreshPointGeometry(document.geometry, points),
  });
}

/*
 * AN ELEMENT FOLLOWS ITS OWN POINTS.
 *
 * When an anchor that belongs to a curve moves, the curve moves with it - that is
 * what "connected" means, and it is what makes editing a point a geometry edit
 * rather than a decoration. Elements without points of their own are untouched.
 */
function refreshPointGeometry(geometry, points) {
  return geometry.map((entry) => {
    const owned = points.filter((point) => point.geometryId === entry.id);

    if (!owned.length) {
      return entry;
    }

    /*
     * A POINT PLACED ON THE ELEMENT'S PATH IS RE-PROJECTED, not pushed to where
     * the point was dragged: dragging an anchor that sits on a curve slides it
     * ALONG the curve, because that is where it belongs. The projection is the
     * same adapter call the insertion used, so a point can never drift off the
     * geometry it is attached to.
     */
    const moved = owned.map((point) => {
      const projected = projectOnto(entry, point);

      return projected || { x: point.x, y: point.y };
    });

    /* Endpoints and vertices ARE the path, so they move it. */
    const vertices = entry.points.length === owned.length;

    return vertices
      ? { ...entry, points: moved }
      : entry;
  });
}

/*
 * The nearest point on an element's own mathematics.
 *
 * This is a local, defensive wrapper around the adapter registry so the document
 * stays independent of which adapters exist: an unknown kind simply projects
 * nothing, and the point keeps its coordinates.
 */
function projectOnto(entry, point) {
  try {
    const adapter = adapterFor(entry);
    const projected = adapter.project(point);

    if (!projected || !Number.isFinite(projected.x)) {
      return null;
    }

    return { x: projected.x, y: projected.y };
  } catch (error) {
    void error;

    return null;
  }
}

export function removePoint(document, id) {
  const points = document.points.filter((point) => point.id !== id);

  if (points.length === document.points.length) {
    return document;
  }

  /*
   * A DEPENDENT POINT IS NOT ORPHANED SILENTLY. A relative point whose
   * reference is gone would otherwise keep reporting the absolute value it last
   * had, which reads as though it were still attached. It is restated as an
   * absolute point at the same place, so nothing moves and the relationship is
   * honestly gone.
   */
  const byId = new Map(document.points.map((point) => [point.id, point]));

  const repaired = points.map((point) => {
    if (point.referenceId !== id) {
      return point;
    }

    const resolved = byId.get(point.id);

    return {
      ...point,
      coordinateMode: "absolute",
      referenceId: null,
      delta: null,
      distance: null,
      angleDeg: null,
      x: resolved ? resolved.x : point.x,
      y: resolved ? resolved.y : point.y,
    };
  });

  return withRevision({ ...document, points: repaired });
}

export function setPointCoordinateMode(document, id, mode, referenceId) {
  const reference =
    document.points.find((point) => point.id === referenceId) || null;

  return updatePoint(document, id, (point) =>
    withCoordinateMode(point, mode, reference, document.points),
  );
}

export function movePoint(document, id, x, y) {
  return updatePoint(document, id, (point) =>
    point.locked ? point : withAbsolutePosition(point, x, y, document.points),
  );
}

export function setPointLocked(document, id, locked) {
  return updatePoint(document, id, { locked: Boolean(locked) });
}

/*
 * THERE IS ONLY ONE USER POINT TYPE, SO THERE IS NOTHING TO CONVERT TO.
 *
 * This used to switch an anchor into a shape guide. Guides are gone - the
 * stroke is the guide - so the function is kept as a no-op rather than deleted:
 * an older caller that still asks for a conversion gets the document back
 * unchanged instead of a crash, and the point keeps its exact position.
 */
export function convertPointType(document, id, type) {
  if (type !== "anchor") {
    return document;
  }

  return updatePoint(document, id, { type: "anchor" });
}

/* ============================================================
 * VIEW STATE (bounds, grid) - not geometry
 * ============================================================ */

export function setBounds(document, bounds, mode = "manual") {
  return withRevision({
    ...document,
    bounds: { ...document.bounds, ...bounds },
    boundsMode: mode,
  });
}

/*
 * Grid settings are VIEW settings, but they are part of the saved sketch - the
 * student's axes and grid choices travel with the drawing. They are still a
 * model change, because the source depends on them.
 */
export function setGrid(document, change) {
  return withRevision({
    ...document,
    grid: normaliseGrid({ ...document.grid, ...change }),
  });
}

export function setTransform(document, change) {
  return withRevision({
    ...document,
    transform: {
      x: Number(document.transform?.x) || 0,
      y: Number(document.transform?.y) || 0,
      rotation: Number(document.transform?.rotation) || 0,
      scale: Number(document.transform?.scale) || 1,
      ...change,
    },
  });
}

/* Every point, resolved to absolute model coordinates. */
export function resolvedPoints(document) {
  return resolvePoints(document.points || []);
}

export default {
  makeGeometry,
  createSketchDocument,
  withRevision,
  addGeometry,
  updateGeometry,
  removeGeometry,
  setGeometryAppearance,
  resetGeometryAppearance,
  setAppearanceForMany,
  setDefaultAppearance,
  applyDefaultToUntouched,
  renameGeometry,
  setGeometryVisible,
  addPoint,
  updatePoint,
  removePoint,
  setPointCoordinateMode,
  movePoint,
  setPointLocked,
  convertPointType,
  setBounds,
  setGrid,
  setTransform,
  resolvedPoints,
};
