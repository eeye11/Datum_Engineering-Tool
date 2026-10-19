/*
 * ============================================================
 * THE DRAWING SOURCE
 * ============================================================
 *
 * The one representation of the LaTeX/TikZ source that generates a drawing.
 *
 * A drawing source is a `\begin{tikzpicture} ... \end{tikzpicture}` picture in
 * which DAETUM's own drawing objects appear as BLOCKS, each one wrapped in a
 * pair of comment markers that name the object it belongs to:
 *
 *     \begin{tikzpicture}
 *     % DAETUM_OBJECT_BEGIN id="line-001" type="line"
 *     \draw[black] (0,0) -- (3,1);
 *     % DAETUM_OBJECT_END id="line-001"
 *     \end{tikzpicture}
 *
 * WHY THE MARKERS.
 *
 * The source has to be edited by hand and also updated by the structured model,
 * and those two things have to coexist. A block's position in the text changes
 * the moment anyone types above it, so a mapping keyed on line numbers would
 * silently point at the wrong object after a single edit. The markers travel
 * with the object instead: they name its STABLE ID, so the mapping survives
 * editing, reordering, saving and reopening. Line numbers are derived from the
 * markers each time they are needed, never stored as the identity.
 *
 * The markers are ordinary LaTeX comments, so they do not affect rendering and
 * a `.tex` carrying them still compiles unchanged in any LaTeX installation.
 *
 * WHAT A DRAWING SOURCE IS NOT.
 *
 *   - It is NOT the renderer wrapper. The `\usepackage`, the document
 *     environment and the colour preamble are infrastructure the server adds
 *     when it compiles; they are not part of the drawing and are never shown
 *     in the Source tab. See rendering-adapter.js.
 *   - It is NOT a tool template. A template is the construction used to CREATE
 *     a new object; a drawing source is what actually exists on the sheet.
 *
 * UNITS. The picture declares `[x=1mm, y=1mm]`, matching the rest of DAETUM:
 * one drawing unit is one millimetre on paper. That is a statement about the
 * picture, not a scale, so it belongs in the picture options.
 */

export const PICTURE_BEGIN = "\\begin{tikzpicture}";
export const PICTURE_END = "\\end{tikzpicture}";

import { PICTURE_OPTIONS as UNIT_PICTURE_OPTIONS } from "../../../tool-library/shared/primitives/tikz-primitives.js";

const OBJECT_BEGIN =
  /^[ \t]*%[ \t]*DAETUM_OBJECT_BEGIN[ \t]+id="([^"]+)"(?:[ \t]+type="([^"]*)")?[ \t]*$/;
const OBJECT_END = /^[ \t]*%[ \t]*DAETUM_OBJECT_END[ \t]+id="([^"]+)"[ \t]*$/;

/*
 * Whether ONE line is a marker comment. Exported so the Source tab can map an
 * editor offset in the visible text to the same place in the canonical text
 * without knowing how a marker is spelled.
 */
export function isObjectMarkerLine(line) {
  return OBJECT_BEGIN.test(String(line ?? "")) || OBJECT_END.test(String(line ?? ""));
}

/*
 * The picture options DAETUM writes. Kept in one place so read and write agree,
 * and derived from the primitives' unit so the generated code and the picture
 * cannot state different lengths for a drawing unit.
 */
export const PICTURE_OPTIONS = UNIT_PICTURE_OPTIONS;

const EMPTY_PICTURE = `${PICTURE_BEGIN}${PICTURE_OPTIONS}\n${PICTURE_END}`;

/*
 * A fresh, empty drawing source. This is what the Source tab shows for a sheet
 * with nothing on it, and what a new object is inserted into.
 */
export function emptyDrawingSource() {
  return EMPTY_PICTURE;
}

/*
 * Split a source into lines without losing the information needed to put it
 * back together. `\r\n` is normalised to `\n` so the mapping arithmetic is the
 * same on every platform, but nothing else is touched - whitespace and
 * indentation inside a block are the student's and are preserved verbatim.
 */
function linesOf(source) {
  return String(source ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n");
}

/*
 * ============================================================
 * PARSING THE SOURCE INTO BLOCKS
 * ============================================================
 *
 * The parser is deliberately tolerant. The source is hand-editable, so it may
 * contain anything at all: a duplicated marker, a BEGIN with no END, an END
 * whose BEGIN is gone, markers with no id. Every one of those has to produce a
 * defined result rather than an exception, because the Source tab renders the
 * student's draft even while it is wrong.
 *
 * Each returned block carries its line range in the CURRENT text. The range is
 * a read-time convenience; the block's identity is its `id`.
 */
export function parseDrawingSource(source) {
  const lines = linesOf(source);
  const blocks = [];
  const open = [];

  lines.forEach((line, index) => {
    const begin = OBJECT_BEGIN.exec(line);

    if (begin) {
      open.push({
        id: begin[1],
        type: begin[2] || "",
        beginLine: index,
        beginText: line,
      });

      return;
    }

    const end = OBJECT_END.exec(line);

    if (!end) {
      return;
    }

    /*
     * Find the most recent BEGIN carrying this id. Matching by id rather
     * than by "the last BEGIN" keeps a stray end marker from stealing an
     * unrelated block, and a malformed duplicate resolves to the nearest
     * matching open, which is the least surprising choice.
     */
    let matchIndex = -1;

    for (let index2 = open.length - 1; index2 >= 0; index2 -= 1) {
      if (open[index2].id === end[1]) {
        matchIndex = index2;
        break;
      }
    }

    if (matchIndex < 0) {
      return;
    }

    const [entry] = open.splice(matchIndex, 1);

    blocks.push({
      id: entry.id,
      type: entry.type,
      beginLine: entry.beginLine,
      endLine: index,
      bodyStartLine: entry.beginLine + 1,
      bodyEndLine: index - 1,
      lines: lines.slice(entry.beginLine, index + 1),
    });
  });

  /*
   * A BEGIN left open at the end of the text. It is reported as a block
   * running to the last line, so its object is still reachable from the
   * source map while the student finishes typing the closing marker - which
   * is exactly when a rebuild would otherwise lose it.
   */
  open.forEach((entry) => {
    const endLine = lines.length - 1;

    blocks.push({
      id: entry.id,
      type: entry.type,
      beginLine: entry.beginLine,
      endLine,
      bodyStartLine: entry.beginLine + 1,
      bodyEndLine: endLine,
      unclosed: true,
      lines: lines.slice(entry.beginLine),
    });
  });

  return blocks;
}

/*
 * The whole picture as ONE block list in document order. This is the order the
 * source map keeps, so "the object above" and "the object below" are stable
 * questions to ask.
 */
export function pictureBlockOrder(source) {
  return parseDrawingSource(source).sort(
    (left, right) => left.beginLine - right.beginLine,
  );
}

/*
 * ============================================================
 * BUILDING A SOURCE FROM STRUCTURED OBJECTS
 * ============================================================
 *
 * Given a list of `{ id, type, source }` entries - where `source` is the TikZ
 * commands for one object, without its markers - produce the drawing source.
 * This is the ONE place that knows how a block is written, so the BEGIN and
 * END spellings can never drift between the builder and the parser.
 */
export function buildDrawingSource(blocks) {
  const body = (blocks || [])
    .filter((block) => block && block.id)
    .map((block) => {
      const type = block.type ? ` type="${block.type}"` : "";
      const commands = String(block.source ?? "").replace(/\s+$/, "");

      return [
        `% DAETUM_OBJECT_BEGIN id="${block.id}"${type}`,
        commands,
        `% DAETUM_OBJECT_END id="${block.id}"`,
      ].join("\n");
    })
    .join("\n");

  return `${PICTURE_BEGIN}${PICTURE_OPTIONS}\n${body}${body ? "\n" : ""}${PICTURE_END}`;
}

/*
 * ============================================================
 * THE SOURCE MAP
 * ============================================================
 *
 * The relationship between an object's STABLE ID and the region of source that
 * currently represents it. It is derived from the source itself every time it
 * is needed - there is no separate stored copy to go stale, because a second
 * copy of the truth is exactly the thing that goes wrong when source is edited.
 */
export function createSourceMap(source) {
  const blocks = parseDrawingSource(source);
  const byId = new Map();
  const byLine = [];

  blocks.forEach((block) => {
    byId.set(block.id, block);
  });

  /*
   * A line-to-id index for "which object is this line in". A line inside a
   * block resolves to that block; a line between blocks resolves to nothing,
   * so clicking ordinary custom source does not select an object by accident.
   */
  blocks.forEach((block) => {
    for (
      let line = block.beginLine;
      line <= Math.min(block.endLine, Number.MAX_SAFE_INTEGER);
      line += 1
    ) {
      byLine[line] = block.id;
    }
  });

  return {
    blocks,
    ids: () => [...byId.keys()],
    block: (id) => byId.get(id) || null,
    has: (id) => byId.has(id),
    idAtLine: (line) => byLine[line] || null,
    blockAtLine: (line) => {
      const id = byLine[line];

      return id ? byId.get(id) : null;
    },
  };
}

/*
 * The body lines of one object's region - what a source-highlight or a targeted
 * update needs. Empty for an id the map does not hold, so a caller never has to
 * guard against a missing object before asking.
 */
export function objectRegion(source, id) {
  const map = createSourceMap(source);
  const block = map.block(id);

  if (!block) {
    return null;
  }

  return {
    id: block.id,
    type: block.type,
    beginLine: block.beginLine,
    endLine: block.endLine,
    body: linesOf(source)
      .slice(block.bodyStartLine, block.bodyEndLine + 1)
      .join("\n"),
  };
}

/*
 * ============================================================
 * THE SOURCE A STUDENT ACTUALLY SEES
 * ============================================================
 *
 * The stored document keeps its object markers, because they are what makes an
 * object's source region survive editing. They are NOT part of the drawing,
 * however, and two places must never show them:
 *
 *   - the Source tab, which is the drawing's own code, and
 *   - Written Solution, which receives a plain `tikzpicture`.
 *
 * So the visible form is the stored form with the marker comments removed.
 * The commands are untouched, character for character, and so is the student's
 * own formatting between them - a stripped source is literally the same text
 * minus whole lines that only named an id.
 *
 * WHEN THE VISIBLE FORM COMES BACK, its markers are re-attached by
 * `restoreObjectMarkersFrom`. The object ids can only be recovered from the
 * text by the ORDER the blocks were in and by what the object model still
 * holds, so the restore is given the previous canonical source: each block is
 * matched to the id that occupied that position before. That is exact for the
 * common case the editor produces (typing inside a block, adding a line between
 * two blocks) and honest about the rest: a block that cannot be matched keeps
 * no id and becomes custom source, which is preserved and rendered but is no
 * longer claimed as a structured object.
 *
 * WHY NOT PUT THE ID IN THE TIKZ ITSELF.
 *
 * Naming the object in the code (a `\coordinate` per shape, a node name) would
 * leave the student's source carrying identifiers they did not write and cannot
 * read, and would appear in Written Solution too. The marker scheme keeps the
 * identity in the document and out of the drawing.
 */
export function visibleDrawingSource(source) {
  const lines = linesOf(source);
  const kept = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (OBJECT_BEGIN.test(line) || OBJECT_END.test(line)) {
      continue;
    }

    kept.push(line);
  }

  /*
   * Collapse the blank line a removed END marker leaves behind at the very end
   * of the picture, without touching any other whitespace. A source with no
   * markers is returned byte for byte.
   */
  return kept
    .join("\n")
    .replace(/\n[ \t]*\n(\\end\{tikzpicture\})/, "\n$1");
}

/*
 * Whether a stored source has no drawable content - that is, no command lines
 * at all once markers, blank lines and the picture environment are removed.
 *
 * This is the emptiness test Written Solution uses to label a sheet "Empty"
 * and to refuse to insert a placeholder. It is deliberately about CONTENT and
 * not about the picture existing: an initialised, empty `tikzpicture` is not a
 * drawing.
 */
export function sourceHasDrawableContent(source) {
  return linesOf(source).some((line) => {
    const text = line.trim();

    if (!text) {
      return false;
    }

    if (OBJECT_BEGIN.test(text) || OBJECT_END.test(text)) {
      return false;
    }

    if (text === PICTURE_BEGIN || text === PICTURE_END) {
      return false;
    }

    /*
     * The picture's own option line, `[x=1mm, y=1mm]`, is part of the
     * environment rather than of the drawing. It is only skipped when it is
     * exactly the option line this module writes; an opening line carrying
     * options is still the environment, not content.
     */
    if (text === PICTURE_OPTIONS || /^\\begin\{tikzpicture\}\s*\[/.test(text)) {
      return false;
    }

    /* A LaTeX comment on its own line draws nothing. */
    if (text.startsWith("%")) {
      return false;
    }

    return true;
  });
}

/*
 * Re-attach the object markers to a visible source, using the previous
 * canonical source as the record of which object owned which block.
 *
 * The match is positional and conservative:
 *
 *   - the block bodies are compared with the previous blocks IN ORDER;
 *   - a previous block whose body still appears, whole and in order, keeps its
 *     id on the region that now holds it, even if lines were added around it;
 *   - anything else stays custom source.
 *
 * `previous` is optional. Without it (a document reopened from a visible-only
 * `.tex`, for instance) nothing is claimed and the whole picture is custom
 * source, which is the truthful answer: the object model is not in that file.
 */
export function restoreObjectMarkersFrom(visible, previous) {
  const text = String(visible ?? "");

  if (!previous || typeof previous !== "string") {
    return text;
  }

  const previousBlocks = parseDrawingSource(previous)
    .filter((block) => block.bodyStartLine <= block.bodyEndLine)
    .map((block) => ({
      id: block.id,
      type: block.type,
      body: linesOf(previous)
        .slice(block.bodyStartLine, block.bodyEndLine + 1)
        .join("\n")
        .trim(),
    }))
    .filter((block) => block.body);

  if (!previousBlocks.length) {
    return text;
  }

  const lines = linesOf(text);
  const closing = lines.lastIndexOf(PICTURE_END);

  if (closing < 0) {
    return text;
  }

  const body = lines.slice(0, closing);

  /*
   * SPLIT THE VISIBLE PICTURE INTO ITS BLOCKS AND ITS LOOSE LINES.
   *
   * A visible source has no markers, so its commands are one undivided run.
   * The previous canonical source says where the boundaries used to be, and
   * the boundaries are recovered by matching each previous block's body
   * against that run, in order.
   *
   * WHEN A BLOCK'S BODY NO LONGER MATCHES - the student edited inside it, which
   * is the ordinary case - the block still OWNS the region between its
   * neighbours. So each block's search begins where the previous one ended and
   * runs up to where the NEXT previous block is found. The region is whatever
   * survived in that span: edited commands, or a block deleted entirely.
   */
  const findBlock = (block, from) => {
    const bodyLines = block.body.split("\n");

    for (let start = from; start + bodyLines.length <= body.length; start += 1) {
      if (body.slice(start, start + bodyLines.length).join("\n").trim() === block.body) {
        return { start, end: start + bodyLines.length, exact: true };
      }
    }

    return null;
  };

  /*
   * FIRST, LOCATE EVERY BLOCK WHOSE BODY IS STILL INTACT. That is the only
   * evidence strong enough to claim a region without guessing, and it also
   * establishes the boundaries an edited block is measured between.
   *
   * EACH SEARCH STARTS WHERE THE PREVIOUS EXACT MATCH ENDED. The blocks are in
   * document order, so a body can only be found at or after its predecessor's
   * position. Searching each block from index 0 instead - which this used to
   * do - let a LATER block's search run back over an EARLIER block's region, so
   * one object's id could be attached to a region before another one, and the
   * two blocks' regions then overlapped.
   */
  let searchFrom = 0;

  const located = previousBlocks.map((block) => {
    const found = findBlock(block, searchFrom);

    if (found) {
      searchFrom = found.end;
    }

    return found;
  });

  /*
   * A DOCUMENT IN WHICH NOTHING MATCHES IS FOREIGN SOURCE.
   *
   * A `.tex` written by hand, or one exported without markers, has commands of
   * its own. Claiming any part of it as a DAETUM object would put an id on
   * code nobody drew with this tool - so when no block survives intact, the
   * text is returned untouched and stays custom source.
   *
   * THE ONE EXCEPTION is an edit that keeps the picture's shape but rewrites
   * every command - the student typing over a small sheet in Source. When the
   * visible commands still number exactly what the previous blocks did, each
   * block owns its own position, because there is nothing else they could be.
   * A document with a different number of commands is still foreign.
   */
  const countCommands = (lines) =>
    lines.filter((line) => {
      const trimmed = String(line).trim();

      return trimmed !== "" && !trimmed.startsWith("%");
    }).length;

  if (!located.some(Boolean)) {
    const previousCommands = countCommands(
      linesOf(previous)
        .slice(0, Math.max(0, linesOf(previous).lastIndexOf(PICTURE_END)))
        .filter((line) => !isObjectMarkerLine(line))
    );

    if (previousBlocks.length !== 1 || countCommands(body) !== previousCommands) {
      return text;
    }

    return [
      `% DAETUM_OBJECT_BEGIN id="${previousBlocks[0].id}"${previousBlocks[0].type ? ` type="${previousBlocks[0].type}"` : ""}`,
      ...body,
      `% DAETUM_OBJECT_END id="${previousBlocks[0].id}"`,
      ...lines.slice(closing),
    ].join("\n");
  }

  /*
   * THE REGIONS ARE PARTITIONED BETWEEN THE LOCATED BLOCKS, never shared.
   *
   * Between two intact blocks, an edited block owns the lines between them -
   * the span it has always occupied - and the intact block keeps exactly its
   * own body. Loose lines before the first intact block belong to the first
   * unmatched block before it, if there is one, and the rest stay custom
   * source.
   */
  const regions = [];
  let cursor = 0;

  for (let index = 0; index < previousBlocks.length; index += 1) {
    const block = previousBlocks[index];
    const exact = located[index];

    if (exact) {
      if (exact.start > cursor) {
        /*
         * Lines before this block that no earlier block claimed. They are
         * the previous block's edited body when that block was not found;
         * otherwise they are the student's own commands and stay custom.
         */
        const previousBlock = previousBlocks[index - 1];

        if (previousBlock && !located[index - 1] && !regions.some((r) => r.block === previousBlock)) {
          regions.push({ block: previousBlock, start: cursor, end: exact.start });
        }
      }

      regions.push({ block, start: exact.start, end: exact.end });
      cursor = Math.max(cursor, exact.end);
      continue;
    }

    /*
     * THIS BLOCK'S BODY WAS EDITED OR REMOVED. Its region runs from where the
     * previous block ended to where the NEXT intact block begins. An edited
     * body keeps its id there, which is what lets a property edit find the
     * object again after a hand edit. A span with no commands in it is a
     * deleted block and is not written back.
     */
    const nextIndex = located.findIndex((entry, at) => at > index && entry);
    const end = nextIndex >= 0 ? located[nextIndex].start : body.length;

    if (end > cursor) {
      regions.push({ block, start: cursor, end });
      cursor = end;
    }
  }

  const result = [];
  let position = 0;

  for (const region of regions) {
    result.push(...body.slice(position, region.start));

    /*
     * AN EMPTY REGION IS A DELETED BLOCK. Its markers are not written back:
     * re-attaching them to nothing would leave an object the source no longer
     * draws, which is worse than reporting the region gone.
     */
    if (region.end <= region.start) {
      position = region.end;
      continue;
    }

    result.push(`% DAETUM_OBJECT_BEGIN id="${region.block.id}"${region.block.type ? ` type="${region.block.type}"` : ""}`);
    result.push(...body.slice(region.start, region.end));
    result.push(`% DAETUM_OBJECT_END id="${region.block.id}"`);

    position = region.end;
  }

  result.push(...body.slice(position));
  result.push(...lines.slice(closing));

  return result.join("\n");
}

export default {
  PICTURE_BEGIN,
  PICTURE_END,
  PICTURE_OPTIONS,
  emptyDrawingSource,
  parseDrawingSource,
  pictureBlockOrder,
  buildDrawingSource,
  createSourceMap,
  objectRegion,
  isObjectMarkerLine,
  visibleDrawingSource,
  sourceHasDrawableContent,
  restoreObjectMarkersFrom,
};
