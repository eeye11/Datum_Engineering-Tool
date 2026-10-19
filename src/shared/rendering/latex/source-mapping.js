/*
 * ============================================================
 * SOURCE MAPPING - OBJECT ID <-> SOURCE REGION
 * ============================================================
 *
 * The map between DAETUM's structured objects and the source regions that draw
 * them. It is built on the marker block list in drawing-source.js, so a region
 * is found by the object's STABLE ID and never by its line number.
 *
 * WHY IT IS DERIVED AND NOT STORED.
 *
 * A stored map - "line-001 lives on lines 3 to 5" - is wrong the moment anyone
 * types a line above it. The map is therefore recomputed from the source
 * whenever it is read, and its callers hold ids, not ranges. That is also why
 * the persisted document does not carry a map: the source does, in its markers,
 * and a second copy would only be a second thing to keep in step.
 *
 * WHAT IT IS FOR.
 *
 *   - Selecting an object on the canvas finds its source block, so the Source
 *     tab can highlight the right region.
 *   - Selecting a source block finds the object, so the canvas and Properties
 *     tab follow.
 *   - Updating one object rewrites ONLY its region, leaving custom source and
 *     every other object's source exactly as the student left them.
 */

import {
  buildDrawingSource,
  createSourceMap,
  parseDrawingSource,
} from "./drawing-source.js";

/*
 * Every object id the source currently represents, in document order.
 */
export function mappedObjectIds(source) {
  return createSourceMap(source).ids();
}

/*
 * The region of source belonging to one object. `null` when the source does not
 * contain that object - a genuine answer, not an error: a source-controlled
 * drawing may hold no structured objects at all.
 */
export function regionForObject(source, objectId) {
  const block = createSourceMap(source).block(objectId);

  if (!block) {
    return null;
  }

  return {
    id: block.id,
    type: block.type,
    beginLine: block.beginLine,
    endLine: block.endLine,
    bodyStartLine: block.bodyStartLine,
    bodyEndLine: block.bodyEndLine,
  };
}

/*
 * The object a line of source belongs to, or null when the line is custom
 * source between objects. The second is the important half: a click on ordinary
 * LaTeX must NOT be read as a selection of whichever object happens to be
 * nearby.
 */
export function objectIdAtLine(source, line) {
  return createSourceMap(source).idAtLine(line);
}

/*
 * ============================================================
 * REPLACING ONE OBJECT'S SOURCE REGION
 * ============================================================
 *
 * A targeted update: the object's commands are replaced in place and nothing
 * else in the text is touched. This is what makes "change a property" and "edit
 * the source by hand" able to coexist - the structured edit does not rewrite
 * the document, so a student's custom commands and their own formatting of the
 * other objects survive it.
 *
 * When the object is NOT yet in the source it is APPENDED as a new block, just
 * before the closing picture, rather than being spliced in at a guessed line.
 */
export function setObjectRegion(source, objectId, objectType, commands) {
  const text = String(source ?? "");
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const block = createSourceMap(text).block(objectId);

  const replacement = [
    `% DAETUM_OBJECT_BEGIN id="${objectId}"${
      objectType ? ` type="${objectType}"` : ""
    }`,
    String(commands ?? "").replace(/\s+$/, ""),
    `% DAETUM_OBJECT_END id="${objectId}"`,
  ];

  if (block) {
    const next = [
      ...lines.slice(0, block.beginLine),
      ...replacement,
      ...lines.slice(block.endLine + 1),
    ];

    return next.join("\n");
  }

  const closing = lines.lastIndexOf("\\end{tikzpicture}");

  if (closing < 0) {
    /* No picture at all: wrap the commands in a fresh one. */
    return buildDrawingSource([
      { id: objectId, type: objectType, source: commands },
    ]);
  }

  const next = [
    ...lines.slice(0, closing),
    ...replacement,
    ...lines.slice(closing),
  ];

  return next.join("\n");
}

/*
 * Remove one object's region from the source. Custom source and every other
 * object are left untouched. A source that does not hold the object is returned
 * unchanged rather than being rebuilt.
 */
export function removeObjectRegion(source, objectId) {
  const text = String(source ?? "");
  const block = createSourceMap(text).block(objectId);

  if (!block) {
    return text;
  }

  const lines = text.replace(/\r\n/g, "\n").split("\n");

  return [
    ...lines.slice(0, block.beginLine),
    ...lines.slice(block.endLine + 1),
  ].join("\n");
}

/*
 * ============================================================
 * SYNCING A WHOLE DRAWING MODEL INTO THE SOURCE
 * ============================================================
 *
 * Used when the source has to be rebuilt for a sheet whose objects the source
 * does not yet represent - opening a drawing that was saved before the source
 * existed, or a source that has been emptied. It writes every object as a
 * block, and leaves any custom source ALREADY in the picture in place beneath
 * them, so nothing the student wrote is discarded.
 *
 * It is deliberately NOT the normal update path. A property edit updates one
 * region; only a rebuild calls this. See the note in source-synchronization.js.
 */
/*
 * ============================================================
 * EVERY OBJECT THE SOURCE DOES NOT HOLD, WRITTEN FROM ITS DATA
 * ============================================================
 *
 * THE COMMANDS COME FROM THE WRITER, NOT FROM AN `object.source` FIELD.
 *
 * This function used to read `object.source` - a field no feature factory ever
 * sets. So on Undo, on Redo and on a sheet load, every object the source did
 * not already hold was appended as an EMPTY block: two markers with nothing
 * between them, an object that is in the model and draws nothing. The
 * per-object path in `drawing-panel.js` writes real code; this one, the path
 * those three operations take, did not.
 *
 * `write` is the object's source, already generated by whoever called us; a
 * caller that has none passes nothing and the object is skipped rather than
 * written as an empty region.
 */
export function rebuildDrawingSourceFromObjects(source, objects, { write = null } = {}) {
  const text = String(source ?? "");
  const known = new Set(mappedObjectIds(text));

  const additions = (objects || [])
    .filter((object) => object && object.id && !known.has(object.id))
    .map((object) => {
      const generated = typeof write === "function" ? write(object) : object.source;

      return typeof generated === "string" && generated.trim() !== ""
        ? { id: object.id, type: object.type, source: generated }
        : null;
    })
    .filter(Boolean);

  if (!additions.length) {
    return text;
  }

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const closing = lines.lastIndexOf("\\end{tikzpicture}");
  const blockText = additions
    .map(
      (block) =>
        `% DAETUM_OBJECT_BEGIN id="${block.id}"${
          block.type ? ` type="${block.type}"` : ""
        }\n${String(block.source ?? "").replace(/\s+$/, "")}\n% DAETUM_OBJECT_END id="${block.id}"`,
    )
    .join("\n");

  if (closing < 0) {
    return buildDrawingSource(additions);
  }

  return [...lines.slice(0, closing), blockText, ...lines.slice(closing)].join(
    "\n",
  );
}

/*
 * The blocks in document order, for the Source tab's outline and for "select
 * the object whose block starts on this line".
 */
export function sourceBlocks(source) {
  return parseDrawingSource(source).sort(
    (left, right) => left.beginLine - right.beginLine,
  );
}

export default {
  mappedObjectIds,
  regionForObject,
  objectIdAtLine,
  setObjectRegion,
  removeObjectRegion,
  rebuildDrawingSourceFromObjects,
  sourceBlocks,
};
