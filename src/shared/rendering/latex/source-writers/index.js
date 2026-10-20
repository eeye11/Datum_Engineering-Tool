/*
 * ============================================================
 * THE CATEGORY WRITERS
 * ============================================================
 *
 * The ONE place the source pipeline learns which writers exist. The panel used
 * to install the Geometry and Statics writers itself, by naming both modules;
 * that worked while there were two and quietly stopped being true as more
 * categories landed - a category whose writer nobody registered had objects
 * that never reached Source, with nothing anywhere saying so.
 *
 * So the registry is a LIST here, and `installSourceWriters` walks it. A new
 * category adds itself to the list and is wired; there is no second place to
 * remember and no category that can be "implemented" without being installed.
 *
 * A writer returns the object's commands, or `null` when it does not know the
 * object. Writers are asked in registration order and a `null` declines, so
 * they cannot fight over a type - and none of them has to know the others'
 * types.
 *
 * THE ORDER IS THE SAME AS BEFORE THIS LIST EXISTED: Statics, then Geometry.
 * The synchronization layer asks the most recently registered writer FIRST, so
 * installing in the order below gives Geometry the last word - which is what
 * it needs for a Point, a Line and an Arc, whose conventions are the
 * Geometry tools' when no Statics tool created them.
 */

import { geometrySourceWriter } from "./geometry.js";
import { staticsSourceWriter } from "./statics.js";
import { annotationSourceWriter } from "./annotations.js";
import { thermodynamicsSourceWriter } from "./thermodynamics.js";
import { fluidsSourceWriter } from "./fluids.js";

/*
 * The writers, in installation order. The synchronization layer asks the most
 * recently installed FIRST, so the last entry is consulted before the others.
 *
 * Geometry is installed last because a Point, a Line and an Arc are a Geometry
 * tool's by default; the Statics writer declines those unless the object says a
 * Statics Reference tool created it, so the two cannot disagree.
 */
export const SOURCE_WRITERS = Object.freeze([
  { id: "statics", writer: staticsSourceWriter },
  { id: "geometry", writer: geometrySourceWriter },
  { id: "annotations", writer: annotationSourceWriter },
  { id: "thermodynamics", writer: thermodynamicsSourceWriter },
  { id: "fluids", writer: fluidsSourceWriter }
]);

/*
 * Install every writer with the synchronization layer.
 *
 * `addSourceWriter` is used rather than `setSourceWriter` so a test or an
 * embed that installed its own writer first is not silently replaced.
 */
export function installSourceWriters({ addSourceWriter, setSourceWriter }) {
  const install =
    typeof addSourceWriter === "function"
      ? addSourceWriter
      : typeof setSourceWriter === "function"
        ? setSourceWriter
        : null;

  if (!install) {
    return false;
  }

  SOURCE_WRITERS.forEach(({ writer }) => install(writer));

  return true;
}

/* The type names a category writes, for the registry consistency check. */
export function registeredWriterIds() {
  return SOURCE_WRITERS.map(({ id }) => id);
}

export default {
  SOURCE_WRITERS,
  installSourceWriters,
  registeredWriterIds
};
