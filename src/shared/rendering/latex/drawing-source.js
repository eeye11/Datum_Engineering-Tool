/*
 * ============================================================
 * THE DRAWING SOURCE
 * ============================================================
 *
 * The one representation of the LaTeX/TikZ source that generates a drawing.
 *
 * A drawing source is a `\begin{tikzpicture} ... \end{tikzpicture}` picture in
 * which DAETUM's own drawing objects appear as BLOCKS, each one headed by a
 * readable comment naming the object it belongs to:
 *
 *     \begin{tikzpicture}
 *     % DAETUM OBJECT: Line 1
 *     % DAETUM ID: line-001
 *     % DAETUM TYPE: line
 *     \draw[black] (0,0) -- (3,1);
 *     \end{tikzpicture}
 *
 * The header format is documented in object-comments.js; a legacy pair of
 * `% DAETUM_OBJECT_BEGIN id="..."` / `% DAETUM_OBJECT_END id="..."` lines is
 * still READ (a file saved by an older build must keep its objects) and is
 * rewritten in the readable form on the next write.
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
import { COMMENT_FIELDS, COMMENT_PREFIX, objectCommentHeader } from "./object-comments.js";

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

/* The legacy markers, still read so an older saved file keeps its objects. */
const OBJECT_BEGIN =
  /^[ \t]*%[ \t]*DAETUM_OBJECT_BEGIN[ \t]+id="([^"]+)"(?:[ \t]+type="([^"]*)")?[ \t]*$/;
const OBJECT_END = /^[ \t]*%[ \t]*DAETUM_OBJECT_END[ \t]+id="([^"]+)"[ \t]*$/;

/* The readable markers written by object-comments.js. */
const COMMENT_OBJECT = /^[ \t]*%[ \t]*DAETUM[ \t]+OBJECT[ \t]*:[ \t]*(.*?)[ \t]*$/;
const COMMENT_FIELD = new RegExp(`^[ \\t]*%[ \\t]*${COMMENT_PREFIX}[ \\t]+([A-Z]+)[ \\t]*:[ \\t]*(.*?)[ \\t]*$`);

/* The fields that START a block, in the order they are looked for. */
const HEADER_FIELDS = new Set([COMMENT_FIELDS.object, COMMENT_FIELDS.id, COMMENT_FIELDS.type, COMMENT_FIELDS.part, COMMENT_FIELDS.parent]);

/*
 * Whether ONE line is a marker comment. Exported so the Source tab can map an
 * editor offset in the visible text to the same place in the canonical text
 * without knowing how a marker is spelled.
 */
export function isObjectMarkerLine(line) {
  const text = String(line ?? "");

  if (OBJECT_BEGIN.test(text) || OBJECT_END.test(text)) {
    return true;
  }

  const field = COMMENT_FIELD.exec(text);

  return Boolean(field && HEADER_FIELDS.has(field[1]));
}

/* The closing marker's id, and whether it was spelled the legacy way. */
function endMarkerOf(line) {
  const legacy = OBJECT_END.exec(String(line ?? ""));

  if (legacy) {
    return { id: legacy[1], legacy: true };
  }

  const field = COMMENT_FIELD.exec(String(line ?? ""));

  return field && field[1] === COMMENT_FIELDS.end ? { id: field[2], legacy: false } : null;
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

  /*
   * ONE ENTRY PER OPEN BLOCK, with the header fields gathered until the block's
   * commands begin. The header is the run of metadata lines at the block's
   * start; anything else - a `\\draw`, a blank line, a student's comment -
   * closes the header, so a marker after it can only start a new block.
   */
  const open = [];

  const close = (entry, endLine, { unclosed = false } = {}) => {
    blocks.push({
      id: entry.id,
      type: entry.type,
      name: entry.name || "",
      part: entry.part || "",
      parent: entry.parent || "",
      legacy: entry.legacy,
      beginLine: entry.beginLine,
      headerEndLine: entry.headerEndLine,
      endLine,
      /*
       * THE BODY STARTS ON THE LINE AFTER THE HEADER'S LAST LINE. A readable
       * header always has at least the ID line, so this is at least one line
       * below the header - and a legacy block's BEGIN marker, whose `beginLine`
       * and `headerEndLine` are the same, starts its body one line below that.
       */
      bodyStartLine: entry.headerEndLine + 1,
      /*
       * THE LAST LINE OF THE COMMANDS. A readable header has no closing marker,
       * so the block ends at the line before whatever closed it; a legacy block
       * ended at its END marker, which is not part of its body.
       */
      bodyEndLine: entry.legacy ? Math.max(entry.headerEndLine, endLine - 1) : endLine,
      ...(unclosed ? { unclosed: true } : {}),
      lines: lines.slice(entry.beginLine, endLine + 1),
    });
  };

  /* Close the block on top of the stack. `endLine` is the last line it owns. */
  const closeTop = (endLine) => {
    if (!open.length) {
      return;
    }

    close(open.pop(), endLine);
  };

  /*
   * THE HEADER IS FINISHED BY THE FIRST NON-METADATA LINE, so the marker seen
   * after it belongs to the NEXT block or to nobody - never to this one.
   */
  const headerOpen = () => {
    const entry = open.length ? open[open.length - 1] : null;

    return Boolean(entry && !entry.legacy && !entry.headerClosed);
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    /*
     * THE PICTURE ENDS EVERY BLOCK. A block runs to the line before the
     * closing environment, so the environment is never part of an object's
     * body - and a header still open there is closed at the line above.
     */
    if (String(line).trim().startsWith(PICTURE_END)) {
      while (open.length) {
        close(open.pop(), index - 1);
      }

      continue;
    }

    /* ---------------- the legacy paired markers ---------------- */
    const begin = OBJECT_BEGIN.exec(line);

    if (begin) {
      open.push({
        id: begin[1],
        type: begin[2] || "",
        name: "",
        part: "",
        parent: "",
        beginLine: index,
        headerEndLine: index,
        headerClosed: true,
        legacy: true,
      });

      continue;
    }

    const end = endMarkerOf(line);

    if (end) {
      /*
       * Find the most recent BEGIN carrying this id. Matching by id rather
       * than by "the last BEGIN" keeps a stray end marker from stealing an
       * unrelated block, and a malformed duplicate resolves to the nearest
       * matching open, which is the least surprising choice.
       */
      let matchIndex = -1;

      for (let index2 = open.length - 1; index2 >= 0; index2 -= 1) {
        if (open[index2].id === end.id) {
          matchIndex = index2;
          break;
        }
      }

      if (matchIndex < 0) {
        continue;
      }

      const [entry] = open.splice(matchIndex, 1);

      close(entry, index);

      continue;
    }

    /* ---------------- the readable header ---------------- */
    const field = COMMENT_FIELD.exec(line);

    /*
     * A LINE THAT IS NOT A DAETUM MARKER ENDS AN OPEN HEADER. Everything after
     * it is the block's body, so a later marker can only start a new block.
     */
    if (!field) {
      if (headerOpen()) {
        open[open.length - 1].headerClosed = true;
      }

      continue;
    }

    const key = field[1];

    if (key === COMMENT_FIELDS.object) {
      /*
       * A HEADER OPENS HERE. The block's id may come on the next line, so the
       * entry is pushed before it is known - and an entry with no id at all is
       * dropped at close time. A block left open by a new header ends on the
       * line above it, which is the layout the writers produce.
       */
      closeTop(index - 1);

      open.push({
        id: null,
        type: "",
        name: String(field[2] || ""),
        part: "",
        parent: "",
        beginLine: index,
        headerEndLine: index,
        headerClosed: false,
        legacy: false,
      });

      continue;
    }

    if (!headerOpen()) {
      continue;
    }

    const current = open[open.length - 1];

    if (key === COMMENT_FIELDS.id) {
      /*
       * A SECOND ID IN THE SAME HEADER IS TWO OBJECTS WRITTEN WITH ONE HEADER.
       * The second one opens a block of its own rather than silently replacing
       * the first - a duplicate id is reported by the validator, never hidden.
       */
      if (current.id !== null) {
        closeTop(index - 1);

        open.push({
          ...current,
          id: null,
          name: "",
          type: "",
          part: "",
          parent: "",
          beginLine: index,
          headerEndLine: index,
        });
      }

      current.id = String(field[2] || "");
      current.headerEndLine = index;
      continue;
    }

    if (key === COMMENT_FIELDS.type) {
      current.type = String(field[2] || "");
      current.headerEndLine = index;
      continue;
    }

    if (key === COMMENT_FIELDS.part) {
      current.part = String(field[2] || "");
      current.headerEndLine = index;
      continue;
    }

    if (key === COMMENT_FIELDS.parent) {
      current.parent = String(field[2] || "");
      current.headerEndLine = index;
    }
  }

  /*
   * A HEADER LEFT OPEN AT THE END OF THE TEXT. It is reported as a block
   * running to the last line, so its object is still reachable from the source
   * map while the student finishes typing - which is exactly when a rebuild
   * would otherwise lose it. An entry with no id names no object and is
   * dropped: it is a header somebody is still writing.
   */
  open.forEach((entry) => {
    if (!entry.id) {
      return;
    }

    /*
     * THE BLOCK STOPS BEFORE A TRAILING CLOSING ENVIRONMENT AND ITS BLANK
     * LINES. Without a picture, the text's last line is the block's last
     * command; with one, the environment that closes it is not the block's.
     */
    let endLine = lines.length - 1;

    while (endLine > entry.headerEndLine && String(lines[endLine]).trim() === "") {
      endLine -= 1;
    }

    if (String(lines[endLine]).trim().startsWith(PICTURE_END)) {
      endLine -= 1;
    }

    while (endLine > entry.headerEndLine && String(lines[endLine]).trim() === "") {
      endLine -= 1;
    }

    close(entry, Math.max(entry.headerEndLine, endLine), { unclosed: true });
  });

  return blocks.filter((block) => Boolean(block.id));
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
 *
 * `renderObjectBlock` is exported for the targeted-update path in
 * source-mapping.js, which must write EXACTLY this form.
 *
 * A HEADER SITS DIRECTLY ON TOP OF ITS COMMANDS. There is no blank line between
 * them: the header is a LABEL for the block, and a blank line there would leave
 * a header that no longer says which commands it describes once a student
 * reorders the text. Blocks are separated by their headers, which is what makes
 * the block boundaries recoverable from the text alone.
 */
/*
 * ONE BLOCK OF SOURCE, READY TO WRITE.
 *
 * `source` may be BARE COMMANDS (a caller with a plain command list) or a
 * writer's output, which already begins with the object's header. A header is
 * never written twice: if the commands already name this object's id, they are
 * returned as they are. That is what keeps a writer that emits its own header
 * and a builder that adds one from producing two blocks for one object.
 */
export function renderObjectBlock({ id, type, name, part, parent, source }) {
  const body = String(source ?? "").replace(/\s+$/, "");

  if (id && body.split("\n").some((line) => isObjectMarkerLine(line))) {
    return body;
  }

  const header = objectCommentHeader({ id, type, name }, { type, part, parent });

  return [...header, body].join("\n");
}

/* Re-exported so a reader of the file sees the format's marker rules. */
export { COMMENT_OBJECT, COMMENT_FIELD };
export function buildDrawingSource(blocks) {
  const body = (blocks || [])
    .filter((block) => block && block.id)
    .map((block) => renderObjectBlock(block))
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
 * minus whole lines that only named an object. The blank line that separated a
 * header from its commands goes with it, so no gap is left where a header was.
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

    if (isObjectMarkerLine(line)) {
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

    if (isObjectMarkerLine(text)) {
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
      name: block.name,
      part: block.part,
      parent: block.parent,
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

  /*
   * A TEXT THAT ALREADY CARRIES HEADERS IS NOT "VISIBLE". Its blocks are its
   * own, and re-attaching ids over them would claim source the student owns.
   */
  if (lines.some((line) => isObjectMarkerLine(line))) {
    return text;
  }

  /* The header a block had, written again when its id is re-attached. */
  const headerFor = (block) =>
    objectCommentHeader(
      { id: block.id, type: block.type, name: block.name },
      { type: block.type, part: block.part, parent: block.parent }
    );

  const raw = lines.slice(0, closing);

  /*
   * THE PICTURE'S OPENING LINE. It is the first non-blank line and no object's
   * header may be written above it; `firstCommand` is the line below it.
   */
  const opening = raw.findIndex((line) => String(line).trim() !== "");
  const firstCommand = opening < 0 ? 0 : opening + 1;
  const leading = raw.slice(0, firstCommand).filter((line) => String(line).trim() !== "");

  /* Locate one block's body in the visible text, from `from` onward. */
  const findBlock = (block, from) => {
    const bodyLines = block.body.split("\n");

    for (let start = Math.max(0, from); start + bodyLines.length <= raw.length; start += 1) {
      if (raw.slice(start, start + bodyLines.length).join("\n").trim() === block.body) {
        return { start, end: start + bodyLines.length, exact: true };
      }
    }

    return null;
  };

  /*
   * FIRST, LOCATE EVERY BLOCK WHOSE BODY IS STILL INTACT - the only evidence
   * strong enough to claim a region without guessing.
   */
  let searchFrom = firstCommand;

  const located = previousBlocks.map((block) => {
    const found = findBlock(block, searchFrom);

    if (found) {
      searchFrom = found.end;
    }

    return found;
  });

  const countCommands = (list) =>
    list.filter((line) => {
      const trimmed = String(line).trim();

      return trimmed !== "" && !trimmed.startsWith("%");
    }).length;

  /*
   * A DOCUMENT IN WHICH NOTHING MATCHES IS FOREIGN SOURCE - with one exception:
   * an edit that keeps the picture's shape but rewrites every command (typing
   * over a small sheet), where the single block owns them.
   */
  if (!located.some(Boolean)) {
    const previousCommands = countCommands(
      linesOf(previous)
        .slice(0, Math.max(0, linesOf(previous).lastIndexOf(PICTURE_END)))
        .filter((line) => !isObjectMarkerLine(line))
    );

    if (previousBlocks.length !== 1 || countCommands(raw) !== previousCommands) {
      return text;
    }

    return [
      ...raw.slice(0, firstCommand),
      ...headerFor(previousBlocks[0]),
      ...raw.slice(firstCommand),
      ...lines.slice(closing),
    ].join("\n");
  }

  /*
   * THE REGIONS ARE PARTITIONED BETWEEN THE LOCATED BLOCKS, never shared: an
   * edited block owns the span between its neighbours.
   */
  const regions = [];
  let cursor = firstCommand;

  for (let index = 0; index < previousBlocks.length; index += 1) {
    const block = previousBlocks[index];
    const exact = located[index];

    if (exact) {
      if (exact.start > cursor) {
        const previousBlock = previousBlocks[index - 1];

        if (previousBlock && !located[index - 1] && !regions.some((r) => r.block === previousBlock)) {
          regions.push({ block: previousBlock, start: cursor, end: exact.start });
        }
      }

      regions.push({ block, start: exact.start, end: exact.end });
      cursor = Math.max(cursor, exact.end);
      continue;
    }

    const nextIndex = located.findIndex((entry, at) => at > index && entry);
    const end = nextIndex >= 0 ? located[nextIndex].start : raw.length;

    if (end > cursor) {
      regions.push({ block, start: cursor, end });
      cursor = end;
    }
  }

  /* They are written in document order, whatever order they were collected in. */
  regions.sort((left, right) => left.start - right.start);

  const result = [];
  let position = firstCommand;

  /*
   * NO REGION BEGINS ABOVE THE PICTURE, and no marker from the student's text
   * survives: a stale header left in a body would split the block it belongs to.
   */
  const emitRange = (from, to) => {
    result.push(
      ...raw.slice(Math.max(from, firstCommand), to).filter((line) => !isObjectMarkerLine(line))
    );
  };

  for (const region of regions) {
    const start = Math.max(region.start, firstCommand);

    emitRange(position, start);

    /*
     * AN EMPTY REGION IS A DELETED BLOCK. Its header is not written back: an
     * object the source no longer draws is worse than reporting it gone - and
     * the blank line that separated it from the text above goes with it, so no
     * gap is left where the object used to be.
     */
    if (region.end <= start) {
      while (result.length && String(result[result.length - 1]).trim() === "") {
        result.pop();
      }

      position = Math.max(region.end, firstCommand);
      continue;
    }

    result.push(...headerFor(region.block));
    result.push(...raw.slice(start, region.end).filter((line) => !isObjectMarkerLine(line)));

    position = region.end;
  }

  emitRange(position, raw.length);

  /* The picture's opening goes first, and only if the body did not carry it. */
  const alreadyOpen = result.length > 0 && String(result[0]).trim() === String(leading[0] ?? "").trim();

  if (!alreadyOpen) {
    result.unshift(...leading);
  }

  result.push(...lines.slice(closing));

  /*
   * NO GAP IS LEFT WHERE A HEADER WAS REMOVED, and no blank line directly after
   * the picture's opening. Both are the bookkeeping's footprint, not the
   * student's text.
   */
  const tidy = [];

  result.forEach((line) => {
    const blank = String(line).trim() === "";
    const previousBlank = tidy.length > 0 && String(tidy[tidy.length - 1]).trim() === "";
    const afterOpening = tidy.length === 1 && /^\s*\\begin\s*\{tikzpicture\}/.test(String(tidy[0]));

    if (blank && (previousBlank || afterOpening)) {
      return;
    }

    /*
     * A HEADER IS NEVER PRECEDED BY A BLANK LINE. It labels the command below
     * it, so the blank that separated an earlier object from it is the
     * bookkeeping's footprint - not the student's text, and not something to
     * keep once the earlier object is gone.
     */
    if (isObjectMarkerLine(line) && blank) {
      return;
    }

    if (isObjectMarkerLine(line) && tidy.length && String(tidy[tidy.length - 1]).trim() === "") {
      tidy.pop();
    }

    tidy.push(line);
  });

  return tidy.join("\n");
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
