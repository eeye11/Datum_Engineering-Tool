/*
 * ============================================================
 * INLINE DRAWINGS: ENTERING, AND REOPENING, A DRAWING
 * ============================================================
 *
 * This is the bridge between the written solution and the Engineering Drawing
 * workspace - the one place that knows how the two halves of DAETUM take turns.
 *
 *   Enter Drawing    write a drawing block at the caret, create the drawing it
 *                    names, open that drawing in the Drawing workspace
 *
 *   Edit Drawing     open the drawing an existing block names, in the same
 *                    workspace, with the block it came from remembered
 *
 * The written solution hands this module two callbacks and nothing else: how to
 * read its source and how to write it. Everything about the drawing itself is the
 * drawing workspace's own model - a sheet, created through the same controller
 * the sheet tabs use, so a drawing begun here is an ordinary drawing in every way
 * (it is listed, renamed, saved, exported and opened like any other).
 *
 * WHY THE BLOCK IS WRITTEN BEFORE THE DRAWING EXISTS. The block is the record of
 * the relationship (see `drawing-blocks.js`), and the relationship only holds if
 * the block that names the drawing is already in the document. If the sheet
 * cannot be created, the block just written is taken out again - a reference to
 * a drawing that does not exist is exactly the broken state this order makes
 * impossible to leave behind.
 */
import enggDrawingBlocks from "./drawing-blocks.js";
import { enggDrawingSheets } from "../../features/workspace/index.js";
import { markDocumentDirty } from "../../features/workspace/commands/document-commands.js";
import { setToolMessage } from "../../components/layout/toolbar/toolbar-render.js";
import { emitDatumEvent } from "../integration/events.js";
import enggErrorLog from "../../app/error-log.js";

const document = globalThis.document;

/*
 * WHAT THE STUDENT WAS DOING WHEN THEY LEFT.
 *
 * Returned to when the drawing workspace is left again: the same written
 * solution, the same block selected, the same caret. Kept here rather than in a
 * panel because it belongs to the journey between the two workspaces, not to
 * either one of them.
 */
let pendingReturn = null;

/* The solution's own editing surface, registered when it installs. */
let host = null;

export function attachInlineDrawings(next) {
    host = next && typeof next === "object" ? next : null;
}

/* The solution source, through whichever door the workspace gave us. */
function readSource() {
    if (host && typeof host.getSource === "function") {
        return String(host.getSource() ?? "");
    }

    return String(document.getElementById("solutionEditor")?.value ?? "");
}

function writeSource(value, { caret = null, selectedBlockId = null } = {}) {
    if (host && typeof host.replaceSource === "function") {
        host.replaceSource(value, { caret, selectedBlockId });
        return;
    }

    const editor = document.getElementById("solutionEditor");

    if (!editor) {
        return;
    }

    const changed = editor.value !== value;

    editor.value = value;

    if (caret !== null && caret !== undefined) {
        editor.focus();
        editor.setSelectionRange(caret, caret);
    }

    if (changed) {
        editor.dispatchEvent(new Event("input", { bubbles: true }));
    }
}

/* The drawing workspace's tab, revealed through the existing tab switch. */
function openDrawingWorkspace() {
    const tab = document.querySelector('.tab[data-tab="drawing"]');

    if (!tab) {
        return false;
    }

    tab.click();

    return true;
}

function sheetById(sheetId) {
    try {
        return enggDrawingSheets.sheetById(sheetId);
    } catch (error) {
        return null;
    }
}

/* The next unused default name, so a new drawing never shadows an old one. */
function nextDrawingName() {
    const sheets = enggDrawingSheets.all() || [];
    const used = new Set(sheets.map((sheet) => sheet.name));
    let index = sheets.length + 1;

    while (used.has(`Drawing ${index}`)) {
        index += 1;
    }

    return `Drawing ${index}`;
}

function newDrawingId() {
    const prefix = enggDrawingSheets.sheetIdPrefix || "sheet_";
    const random =
        globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
            ? globalThis.crypto.randomUUID().replace(/-/g, "")
            : Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);

    return `${prefix}${String(random).slice(0, 8)}`;
}

/*
 * Open a drawing sheet in the Engineering Drawing workspace.
 *
 * The sheet is made active FIRST, then the workspace is revealed - which is the
 * order the tab switch expects: by the time the canvas becomes visible it is
 * already sized against the right drawing, so it paints rather than waiting for
 * a resize.
 */
export function openDrawingInWorkspace(sheetId) {
    const sheet = sheetById(sheetId);

    if (!sheet) {
        return { ok: false, reason: "missing-drawing", sheetId };
    }

    const activated = enggDrawingSheets.activateSheet(sheetId);

    if (activated === false) {
        return { ok: false, reason: "activate-failed", sheetId };
    }

    openDrawingWorkspace();

    return { ok: true, sheetId };
}

/*
 * ENTER DRAWING, from a caret in the written solution.
 *
 * Each step either completes or undoes itself:
 *
 *   1. the caret is captured            (before anything changes)
 *   2. a block is written at the caret  (reusing one for a drawing already there)
 *   3. the drawing is created           (its id is what the block names)
 *   4. the workspace opens on it        (and returns to the same block)
 *
 * An existing block at the caret is not duplicated: the caret inside a drawing
 * reference means the student asked to draw at that reference, which is the same
 * request as Edit Drawing for it.
 */
export function enterDrawing({ at = null, select = null } = {}) {
    const source = readSource();

    const position =
        at === null || at === undefined
            ? Number(document.getElementById("solutionEditor")?.selectionStart) || source.length
            : Number(at);

    const existing = select
        ? enggDrawingBlocks.blockForDrawing(source, select)
        : enggDrawingBlocks.blockAtPosition(source, position);

    if (existing) {
        return editDrawing(existing.drawingId, { blockId: existing.blockId });
    }

    /*
     * THE DRAWING ID IS MINTED HERE, BY THE SHEET'S OWN PREFIX.
     *
     * The block has to name the drawing before the drawing exists, so the id is
     * made first and handed to the sheet - which keeps the id exactly as it is
     * (`createSheet` honours a supplied id unless something already uses it),
     * so nothing has to be rewritten afterwards. A drawing that came back with a
     * different id is a block pointing at nothing, which is why it is checked.
     */
    const drawingId = newDrawingId();

    const inserted = enggDrawingBlocks.insertDrawingBlock(source, drawingId, position);

    writeSource(inserted.value, { caret: inserted.caret });

    let sheet;

    try {
        sheet = enggDrawingSheets.createSheet({
            id: drawingId,
            name: nextDrawingName()
        });
    } catch (error) {
        enggErrorLog.reportError("create inline drawing", error, { drawingId });
    }

    if (!sheet || sheet.id !== drawingId) {
        rollback(source, inserted, drawingId);

        return {
            ok: false,
            reason: "create-failed",
            message:
                "The drawing could not be created, so it was not added to your solution. Your written solution is unchanged."
        };
    }

    markDocumentDirty();
    emitDatumEvent("solutionchange");

    pendingReturn = {
        blockId: enggDrawingBlocks.blockIdFor(drawingId),
        drawingId,
        caret: inserted.caret,
        scrollTop: Number(document.getElementById("solutionEditor")?.scrollTop) || 0
    };

    const opened = openDrawingInWorkspace(sheet.id);

    if (!opened.ok) {
        rollback(source, inserted, drawingId);

        return {
            ok: false,
            reason: opened.reason,
            message:
                "The drawing was created but the Engineering Drawing workspace could not be opened. Nothing was added to your solution."
        };
    }

    setToolMessage(sheet.name || "Drawing");

    return {
        ok: true,
        created: true,
        drawingId,
        blockId: enggDrawingBlocks.blockIdFor(drawingId)
    };
}

/*
 * Put the source back exactly as it was, and take the new drawing back out.
 *
 * The drawing is removed only when it was created by this very call - a failure
 * while opening an EXISTING drawing must never delete it.
 */
function rollback(previousSource, inserted, drawingId) {
    writeSource(previousSource, { caret: inserted.index });

    try {
        enggDrawingSheets.deleteSheet(drawingId);
    } catch (error) {
        /* The sheet stays in the list; the document no longer refers to it. */
    }

    pendingReturn = null;
}

/*
 * EDIT DRAWING: open the exact drawing a block names.
 *
 * The id is resolved from the BLOCK, never from "the drawing that was open
 * last" - a student with four diagrams must get the one they clicked.
 */
export function editDrawing(drawingId, { blockId = null } = {}) {
    const block = enggDrawingBlocks.blockForDrawing(readSource(), drawingId);
    const sheet = sheetById(drawingId);

    if (!sheet) {
        return {
            ok: false,
            reason: "missing-drawing",
            message:
                "That drawing is no longer in this document. Remove the reference, or start a new drawing in its place."
        };
    }

    pendingReturn = {
        blockId: blockId || enggDrawingBlocks.blockIdFor(drawingId),
        drawingId,
        caret: block ? block.index + block.length : null,
        scrollTop: Number(document.getElementById("solutionEditor")?.scrollTop) || 0
    };

    const opened = openDrawingInWorkspace(drawingId);

    if (!opened.ok) {
        pendingReturn = null;

        return {
            ok: false,
            reason: opened.reason,
            message: "That drawing could not be opened in the Engineering Drawing workspace."
        };
    }

    setToolMessage(sheet.name || "Drawing");

    return { ok: true, created: false, drawingId };
}

/*
 * BACK TO THE SOLUTION, where the student left it.
 *
 * The editor's scroll is written again after the tab is revealed: the editor has
 * no scrollable height while hidden, so the value can only take effect once the
 * section has a box.
 */
export function returnToSolutionWorkspace() {
    document.querySelector('.tab[data-tab="writing"]')?.click();

    const editor = document.getElementById("solutionEditor");
    const target = pendingReturn;

    if (editor && target) {
        if (typeof target.caret === "number" && target.caret >= 0) {
            editor.focus();
            editor.setSelectionRange(target.caret, target.caret);
        }

        const top = target.scrollTop || 0;

        editor.scrollTop = top;

        queueMicrotask(() => {
            if (editor.isConnected) {
                editor.scrollTop = top;
            }
        });
    }

    /*
     * THE DRAWING THAT WAS BEING EDITED COMES BACK SELECTED, so the student lands
     * on the reference they left from - and the workspace re-renders the preview,
     * because the drawing may have changed while it was open.
     */
    if (host && typeof host.refresh === "function") {
        host.refresh({ selectedBlockId: target?.blockId || null });
    }

    pendingReturn = null;

    return target?.blockId || null;
}

/* Whether a return journey is in progress (for the toolbar's Back control). */
export function hasPendingReturn() {
    return Boolean(pendingReturn);
}

const enggInlineDrawings = {
    attachInlineDrawings,
    editDrawing,
    enterDrawing,
    hasPendingReturn,
    openDrawingInWorkspace,
    returnToSolutionWorkspace
};

export default enggInlineDrawings;
