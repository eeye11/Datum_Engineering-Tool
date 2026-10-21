/*
 * ============================================================
 * DRAWING BLOCKS IN THE WRITTEN SOLUTION
 * ============================================================
 *
 * An inline drawing is an EDITABLE DOCUMENT ELEMENT, not a pasted picture.
 * The written solution holds one compact LaTeX inclusion for each drawing:
 *
 *     \datumdrawing{sheet_4f1c2a9b}
 *
 * and the drawing itself - its objects, its features, its LaTeX source - lives
 * in exactly one place: the drawing sheet that id names. The written solution
 * references the sheet; it never keeps a second copy of the geometry. So:
 *
 *   editing the drawing            updates the same sheet
 *   moving the inclusion           does not change the drawing
 *   editing the drawing            does not move the inclusion
 *
 * WHY A COMMAND AND NOT `\input{...}`. DAETUM exports ONE .tex for the whole
 * submission (the sheets and the write-up together - see `latex-document.js`),
 * so a separate per-drawing file would have to exist for an `\input` to resolve,
 * and a file that is not part of the export is a link that breaks the moment the
 * project is moved. A command DAETUM compiles and exports itself keeps the
 * document self-contained, and the whole project still opens in Overleaf as one
 * file.
 *
 * THE COMMAND IS THE RECORD. Everything this module needs - the drawing id - is
 * written in it, so a document is self-describing: open the .tex on another
 * machine, in another browser, with no saved metadata, and the inclusion still
 * names its drawing. That is what makes the relationship survive save, restore
 * and export rather than depending on a side table.
 *
 * This module is pure text: no DOM, no drawing state. The editor, the preview
 * and the export all read blocks through it, so they cannot disagree about
 * where a drawing sits.
 */

/* The command DAETUM writes, and the only thing it accepts. */
export const DRAWING_COMMAND = "\\datumdrawing";

/*
 * One inclusion: `\datumdrawing{sheet_4f1c2a9b}`.
 *
 * The drawing id is restricted to the characters a sheet id is made of, so a
 * malformed command (a stray brace, a path, a second argument someone typed)
 * is NOT a drawing block - it is ordinary text, and the student can fix it.
 * Being strict here is what makes the reference safe to treat as atomic: what
 * the editor protects is exactly what the renderer understands.
 */
const BLOCK_PATTERN = /\\datumdrawing\s*\{([A-Za-z0-9_-]+)\}/g;

/* A drawing id is the sheet id the drawing workspace uses. */
export function isDrawingId(value) {
    return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

/*
 * A block id, derived from the drawing id.
 *
 * The block and the drawing are one-to-one (one inclusion per drawing), so a
 * derived id is stable across saves and cannot drift from the drawing it names.
 * It is used as the selection key in the source panel and the preview.
 */
export function blockIdFor(drawingId) {
    return isDrawingId(drawingId) ? `dwg_${drawingId}` : "";
}

/* The text of one inclusion. */
export function serializeDrawingBlock(drawingId) {
    return isDrawingId(drawingId) ? `${DRAWING_COMMAND}{${drawingId}}` : "";
}

/* The zero-based line a character offset falls on. */
export function lineAt(text, index) {
    return String(text ?? "").slice(0, Math.max(0, index)).split(/\r?\n/).length - 1;
}

/*
 * Every inclusion in a source, in document order.
 *
 * Positions are CHARACTER offsets, because the editor splits the text around
 * blocks and maps a block to its lines - and both need the same coordinates.
 */
export function parseDrawingBlocks(source) {
    const text = String(source ?? "");
    const found = [];

    for (const match of text.matchAll(BLOCK_PATTERN)) {
        const drawingId = match[1];
        const raw = match[0];
        const begin = match.index ?? 0;

        found.push({
            index: begin,
            length: raw.length,
            raw,
            drawingId,
            blockId: blockIdFor(drawingId),
            line: lineAt(text, begin),
            lines: raw.split(/\r?\n/).length
        });
    }

    return found;
}

/* The block a document position falls in, or null. */
export function blockAtPosition(source, position) {
    const at = Number(position);

    if (!Number.isFinite(at)) {
        return null;
    }

    return (
        parseDrawingBlocks(source).find(
            (block) => at >= block.index && at <= block.index + block.length
        ) || null
    );
}

/*
 * The block a drawing id already has in the document, or null.
 *
 * Two inclusions of one drawing are two displays of one picture, which the
 * relationship does not support cleanly - so callers ask here rather than
 * appending a second block that would look like a second drawing.
 */
export function blockForDrawing(source, drawingId) {
    return (
        parseDrawingBlocks(source).find((block) => block.drawingId === drawingId) || null
    );
}

/*
 * Insert one inclusion at a position, as its own paragraph.
 *
 * The blank lines around the command are what keep it from running into the
 * sentence either side of it - the inclusion is a paragraph-level element, and
 * the source should read like one. `caret` is where the student's insertion
 * point ends up after the insertion (just after the block), so typing carries on
 * below the drawing rather than inside the command.
 */
export function insertDrawingBlock(source, drawingId, start, end = start) {
    const text = String(source ?? "");
    const command = serializeDrawingBlock(drawingId);

    if (!command) {
        return { value: text, index: -1, caret: start };
    }

    const from = clamp(start, 0, text.length);
    const to = clamp(end, from, text.length);

    const before = text.slice(0, from).replace(/\s+$/, "");
    const after = text.slice(to).replace(/^\s+/, "");

    const lead = before ? "\n\n" : "";
    const tail = after ? "\n\n" : "\n";

    const insert = `${lead}${command}${tail}`;
    const value = `${before}${insert}${after}`;

    const index = before.length + lead.length;

    return { value, index, caret: index + command.length };
}

/*
 * Remove one inclusion, and only that one.
 *
 * The paragraph break the insertion added goes with it - but a blank line the
 * student wrote between their own paragraphs does not. Surrounding text, other
 * drawings and equations are left character for character.
 */
export function removeDrawingBlock(source, drawingId) {
    const text = String(source ?? "");
    const block = blockForDrawing(text, drawingId);

    if (!block) {
        return { value: text, removed: false };
    }

    const before = text.slice(0, block.index);
    const after = text.slice(block.index + block.length);

    /* The insertion's own trailing break, and nothing more. */
    const trimmedAfter = after.replace(/^[ \t]*\r?\n(?:[ \t]*\r?\n)?/, "");

    const needsSpace = /\S$/.test(before) && /^\S/.test(trimmedAfter);

    return {
        value: `${before.replace(/\s+$/, "")}${needsSpace ? "\n\n" : ""}${trimmedAfter}`,
        removed: true
    };
}

/* Every distinct drawing id the document includes, in document order. */
export function referencedDrawingIds(source) {
    return [...new Set(parseDrawingBlocks(source).map((block) => block.drawingId))];
}

/* Whether a source includes a given drawing. */
export function sourceReferencesDrawing(source, drawingId) {
    return parseDrawingBlocks(source).some((block) => block.drawingId === drawingId);
}

/*
 * The inclusion's number in the document ("Drawing 2"). It is a display label,
 * not an identity - the identity is the drawing id, which is why moving a block
 * can renumber a label without changing anything that points at it.
 */
export function drawingNumber(source, drawingId) {
    const index = parseDrawingBlocks(source).findIndex(
        (block) => block.drawingId === drawingId
    );

    return index < 0 ? 0 : index + 1;
}

/* The TikZ label the export gives a drawing's picture. */
export function latexLabelFor(drawingId) {
    return `fig:datum-${String(drawingId).replace(/[^A-Za-z0-9_-]/g, "")}`;
}

function clamp(value, min, max) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return min;
    }

    return Math.min(max, Math.max(min, Math.round(number)));
}

const enggDrawingBlocks = {
    DRAWING_COMMAND,
    blockAtPosition,
    blockForDrawing,
    blockIdFor,
    drawingNumber,
    insertDrawingBlock,
    isDrawingId,
    latexLabelFor,
    lineAt,
    parseDrawingBlocks,
    referencedDrawingIds,
    removeDrawingBlock,
    serializeDrawingBlock,
    sourceReferencesDrawing
};

export default enggDrawingBlocks;
