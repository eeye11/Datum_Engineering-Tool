/*
 * ============================================================
 * SOURCE SYNCHRONIZATION
 * ============================================================
 *
 * Coordinates the four things that can change a drawing:
 *
 *   - the structured object model  (a property edit, a new object, a delete)
 *   - the tool operations          (a construction that produced an object)
 *   - the Source editor            (the student typing)
 *   - the renderer                 (the canvas)
 *
 * It is the ONLY module that knows all four, and it exists so none of them has
 * to know the others. The panel asks it to refresh; the object model's changes
 * arrive here; the source manager is written through here; the adapter is
 * called from here. There is no second path.
 *
 * THE RULE THAT MATTERS MOST.
 *
 * A property edit updates ONE object's region. It does not regenerate the
 * document from the object model. Regenerating would be simpler to write and
 * would destroy two things every time it ran: the student's own formatting of
 * the source, and any custom TikZ the object model cannot represent. So the
 * targeted update in source-mapping.js is the normal path, and a full rebuild
 * happens only when the source genuinely does not represent the objects at all -
 * a drawing saved before the source existed, or a source the student emptied.
 */

import {
  objectIdAtLine,
  rebuildDrawingSourceFromObjects,
  regionForObject,
  setObjectRegion,
} from "./source-mapping.js";
import { validateDrawingSource } from "./source-validation.js";
import { clearSourceGenerationProblem, reportSourceGenerationProblem } from "./source-diagnostics.js";
import { drawingBounds } from "./model-bounds.js";
import { createExportContext, IDENTITY_EXPORT } from "./export-transform.js";

/*
 * ============================================================
 * TURNING AN OBJECT INTO ITS SOURCE
 * ============================================================
 *
 * A registered tool may supply its own writer; until it does, an object's
 * source is produced by the tool library's template for its type. The registry
 * hands the writer in, so this module does not import the whole library and the
 * library does not import this one.
 *
 * `resolveSourceWriter` is a seam rather than a table. When the Geometry tools
 * land, each will register a writer and this becomes a lookup that returns
 * something more specific than the default; nothing here changes.
 */
/*
 * THE WRITERS, in registration order.
 *
 * `setSourceWriter` replaces the WHOLE writer, which is what a test and a
 * single-category embed want. The application registers one writer PER
 * CATEGORY through `addSourceWriter`, and `sourceForObject` asks each in turn
 * until one accepts the object. A table of writers rather than one writer that
 * switches on type, so the Geometry and Statics serializers stay in their own
 * modules and neither has to know the other's types.
 */
const sourceWriters = [];

function registerWriter(writer) {
  const entry = typeof writer === "function" ? writer : null;

  if (!entry) {
    return null;
  }

  const existing = sourceWriters.indexOf(entry);

  if (existing >= 0) {
    sourceWriters.splice(existing, 1);
  }

  sourceWriters.push(entry);

  return entry;
}

export function setSourceWriter(writer) {
  sourceWriters.length = 0;

  registerWriter(writer);
}

/*
 * REGISTER A CATEGORY'S WRITER BESIDE THE OTHERS.
 *
 * The most recently registered writer is asked FIRST, so a category registered
 * later cannot be shadowed by the generic fallback. A writer that returns null
 * for an object simply declines it, and the next one is tried.
 */
export function addSourceWriter(writer) {
  return registerWriter(writer);
}

/* The writers currently installed, in the order they are asked. */
export function registeredSourceWriters() {
  return [...sourceWriters];
}

/*
 * The source commands for one object. A writer is asked first, so a tool that
 * knows how to draw its own object is always preferred; without one, the
 * object's own `source` field is used, and failing that its region is left
 * alone rather than being overwritten with a guess.
 */
export function sourceForObject(object, context = {}) {
  if (!object || !object.id) {
    return null;
  }

  for (let index = sourceWriters.length - 1; index >= 0; index -= 1) {
    let written;

    try {
      written = sourceWriters[index](object, context);
    } catch (error) {
      /*
       * A writer that throws declines the object and the next one is asked -
       * but the failure is RECORDED against the object, so an object that ends
       * up with no source is named rather than silently missing.
       */
      reportSourceGenerationProblem(object, `its source writer failed (${error && error.message})`);
      continue;
    }

    if (typeof written === "string" && written.trim() !== "") {
      clearSourceGenerationProblem(object.id);

      return written;
    }
  }

  if (typeof object.source === "string" && object.source.trim() !== "") {
    return object.source;
  }

  return null;
}

/*
 * ============================================================
 * AN OBJECT WAS CREATED OR CHANGED
 * ============================================================
 *
 * Write the object's region into the source, in place. The object's identity is
 * what selects the region, so an object that already has one is updated and an
 * object that does not is appended as a new block - neither can touch anything
 * else in the text.
 */
export function writeObjectIntoSource(manager, object, context = {}) {
  if (!manager || !object || !object.id) {
    return false;
  }

  /*
   * THE OBJECT IS WRITTEN AT THE DRAWING'S EXPORT SCALE, not on its own.
   *
   * `allObjects` is the drawing the object belongs to; without it the transform
   * would be fitted to this one object, and a beam alone on a sheet would be
   * drawn at a different scale from the same beam beside a graph. A caller that
   * supplies the sheet - the panel, a reconcile, an Undo - passes it in the
   * context; a caller that does not gets a single-object fit, which is the best
   * answer available and is still consistent for that object.
   */
  const objects = Array.isArray(context.allObjects) ? context.allObjects : [object];

  const commands = sourceForObject(object, writeContextFor(object, objects, context));

  if (commands === null) {
    /*
     * Nothing to write. The object exists in the model but has no source
     * yet, which is the normal state for a tool whose source is still being
     * implemented. The source is left exactly as it is rather than being
     * given a placeholder that would misrepresent the drawing.
     */
    return false;
  }

  const next = setObjectRegion(
    manager.getSource(),
    object.id,
    object.type,
    commands,
  );

  return manager.setSource(next, { origin: "object" });
}

/*
 * Remove an object's region. Called when an object is deleted, so the source
 * does not go on drawing something that is no longer in the document. Custom
 * source and every other object are untouched.
 */
export function removeObjectFromSource(manager, objectId) {
  if (!manager || !objectId) {
    return false;
  }

  const region = regionForObject(manager.getSource(), objectId);

  if (!region) {
    return false;
  }

  const lines = manager.getSource().replace(/\r\n/g, "\n").split("\n");
  const next = [
    ...lines.slice(0, region.beginLine),
    ...lines.slice(region.endLine + 1),
  ].join("\n");

  return manager.setSource(next, { origin: "object" });
}

/*
 * ============================================================
 * THE SOURCE WAS EDITED BY HAND
 * ============================================================
 *
 * The draft is already in the manager - the editor put it there as the student
 * typed. This module's part is to say what the new text MEANS:
 *
 *   - it validates the draft, so the Source tab has something to show;
 *   - it rebuilds the source map, so selection still resolves;
 *   - it reports which object ids the text now represents, so the object model
 *     and the source can be compared.
 *
 * It deliberately does NOT push the parsed source back into the object model.
 * Recognising arbitrary TikZ well enough to update structured geometry is a
 * larger piece of work than this refactor, and doing it badly would silently
 * rewrite the student's object. What is done here is honest: the source is the
 * source, the map is rebuilt, and the limitations are reported rather than
 * hidden. See the note on `applySourceToModel`.
 */
export function readSourceInto(manager) {
  if (!manager) {
    return null;
  }

  const source = manager.getSource();
  const validation = validateDrawingSource(source);
  const map = manager.map();

  return {
    source,
    validation,
    map,
    objectIds: map.ids(),
    regions: map.ids().map((id) => ({
      id,
      ...regionForObject(source, id),
    })),
  };
}

/*
 * The object id at a line of the CURRENT draft, or null. The Source tab uses
 * this to sync selection when the student clicks a block.
 */
export function objectIdAtSourceLine(manager, line) {
  if (!manager) {
    return null;
  }

  return objectIdAtLine(manager.getSource(), line);
}

/*
 * ============================================================
 * THE DRAWING'S ONE EXPORT TRANSFORM
 * ============================================================
 *
 * Every object of a drawing is written through the SAME transform, computed once
 * from the bounds of the WHOLE drawing. That is what keeps a beam and the graph
 * above it in the same figure, at the same scale and in their real positions -
 * rather than each object being fitted to its own little box.
 *
 * THE BOUNDS ARE THE APPLICATION'S FIT-ALL MEASUREMENT (`model-bounds.js`),
 * which measures MODEL coordinates at zoom 1. Canvas zoom and pan map model space
 * onto the screen and never reach stored geometry, so the transform is identical
 * at every zoom, in every window size and on every tab - which is the property
 * the exported source has to have.
 *
 * A caller that has already fitted the drawing passes its own `transform`
 * (the Written Solution does, when a document's width is known); otherwise it is
 * derived here, so a writer is never handed a drawing without one.
 */
export function exportTransformFor(objects, options = {}) {
  if (options.transform && typeof options.transform.point === "function") {
    return options.transform;
  }

  /*
   * THE MEASUREMENT IS THE APPLICATION'S FIT-ALL ONE.
   *
   * `model-bounds.js` asks the installed bounds provider first, which is the
   * same `renderedPointsForObjects` the Fit button, Print and the thumbnails
   * measure with - so an export is fitted to the COMPLETE drawing (sketch ink,
   * arrow heads, labels, analysis curves), not to a partial or axis-only extent.
   * The provider is asked at zoom 1, so the current camera cannot reach the
   * export scale.
   */
  const bounds = drawingBounds(objects);

  if (!bounds) {
    return IDENTITY_EXPORT;
  }

  return createExportContext({
    bounds,
    maxWidth: options.maxWidth,
    maxHeight: options.maxHeight,
    minFontPt: options.minFontPt,
  });
}

/*
 * The context one object is written in: the sheet's own settings, plus the one
 * export transform the whole drawing shares.
 */
function writeContextFor(object, objects, context = {}) {
  return {
    ...context,
    state: context?.state || null,
    allObjects: objects,
    transform: exportTransformFor(objects, context || {}),
  };
}

/*
 * ============================================================
 * MAKING THE SOURCE REPRESENT THE OBJECTS
 * ============================================================
 *
 * The one place a full rebuild is allowed. It is called when a sheet's objects
 * exist but its source does not describe them - a drawing reopened from a file
 * written before the source was stored, or a source the student has emptied.
 *
 * It only ADDS the objects the source is missing; it never removes custom source
 * and never rewrites a block that is already there. That is what makes it safe
 * to run when the two have drifted apart, rather than a destructive "regenerate
 * everything".
 */
export function reconcileSourceWithObjects(
  manager,
  objects,
  { state, transform, maxWidth, maxHeight } = {},
) {
  if (!manager) {
    return false;
  }

  /*
   * THE COORDINATE SYSTEM A WRITER READS IS `state`. The caller passes the live
   * drawing state; a writer that needs the sheet's scale or the other objects
   * would otherwise receive a context missing them and write an object that is
   * drawn at the wrong place.
   *
   * THE EXPORT TRANSFORM IS THE DRAWING'S, computed once from every object, so a
   * block that is rebuilt and one that is updated in place come out at the same
   * size.
   */
  const context = { state, allObjects: objects, transform, maxWidth, maxHeight };

  const next = rebuildDrawingSourceFromObjects(manager.getSource(), objects, {
    write: (object) => sourceForObject(object, writeContextFor(object, objects, context)),
  });

  if (next === manager.getSource()) {
    return false;
  }

  return manager.setSource(next, { origin: "object" });
}

/*
 * ============================================================
 * WHAT THE SOURCE EDIT MEANS FOR THE OBJECT MODEL
 * ============================================================
 *
 * A placeholder for the honest half of the contract. When the student edits a
 * generated block, the change should reach the structured object where the
 * syntax is recognised, and should be preserved as source-controlled content
 * where it is not.
 *
 * This refactor establishes the seam and states the limitation rather than
 * pretending to translate arbitrary TikZ. The comparison it performs is real
 * and useful: it reports exactly which ids the source still holds and which
 * object ids are no longer represented, so a caller can decide what to do about
 * a deleted block. It does not invent geometry from source it does not
 * understand.
 */
export function applySourceToModel(manager, objects) {
  const read = readSourceInto(manager);

  if (!read) {
    return { recognised: [], missing: [], custom: true };
  }

  const present = new Set(read.objectIds);
  const known = new Set(
    (objects || []).map((object) => object && object.id).filter(Boolean),
  );

  const recognised = read.objectIds.filter((id) => known.has(id));
  const missing = (objects || [])
    .map((object) => object && object.id)
    .filter((id) => id && !present.has(id));

  return {
    recognised,
    missing,
    custom: recognised.length !== present.size,
  };
}

export default {
  setSourceWriter,
  addSourceWriter,
  registeredSourceWriters,
  sourceForObject,
  writeObjectIntoSource,
  removeObjectFromSource,
  readSourceInto,
  objectIdAtSourceLine,
  reconcileSourceWithObjects,
  applySourceToModel,
};
