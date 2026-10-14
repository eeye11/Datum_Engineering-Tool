/*
 * ============================================================
 * THE WRITTEN SOLUTION TAB
 * ============================================================
 *
 * The workspace's installer. The tab itself is a section in the page; everything
 * inside it - the outline, the editor, the preview, the toolbar - is built and
 * wired by `solution-workspace.js`, and the TYPESETTING is the reference module's
 * (`written-references.js`), which is the one renderer that knows a
 * `\datumfigure{...}` is a live drawing.
 *
 * This file exists to be the ONE place the tab is switched on, and to hold the
 * toolbar actions that are about the DOCUMENT rather than about the text - undo,
 * redo, inserting a drawing, exporting - so the workspace module stays about
 * layout and rendering.
 */

import enggSolutionWorkspace from "./solution-workspace.js";
import { enggDrawingSheets } from "../editor/index.js";
import enggDrawingReference from "../references/drawing-reference.js";
import { attachSolutionSourceLoader } from "../api/datum-api.js";
import { attachSolutionLoader, markDocumentDirty } from "../editor/commands/document-commands.js";
import { emitDatumEvent } from "../api/events.js";

/* ---------------------------------------------------------- */
/* UNDO AND REDO, FOR THE TEXT                                 */
/* ---------------------------------------------------------- */

/*
 * THE EDITOR'S OWN HISTORY.
 *
 * A `<textarea>` has the browser's undo, but it cannot be DRIVEN from a button,
 * so the value is snapshotted when typing pauses and the two buttons restore a
 * snapshot. It is deliberately SEPARATE from the drawing's history: they are two
 * different documents' worth of change, and one shared stack would let an undo in
 * the text delete a force on the sheet.
 */
const undoStack = [];
const redoStack = [];
const HISTORY_LIMIT = 100;

let lastSnapshot = null;

function editor() {
    return document.getElementById("solutionEditor");
}

function snapshot() {
    const field = editor();

    if (!field) {
        return;
    }

    const value = field.value;

    if (value === lastSnapshot) {
        return;
    }

    if (lastSnapshot !== null) {
        undoStack.push(lastSnapshot);

        if (undoStack.length > HISTORY_LIMIT) {
            undoStack.shift();
        }

        redoStack.length = 0;
    }

    lastSnapshot = value;

    refreshUndoButtons();
}

function applySnapshot(value) {
    const field = editor();

    if (!field) {
        return;
    }

    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
}

function undoSolution() {
    if (!undoStack.length) {
        return;
    }

    redoStack.push(lastSnapshot);

    lastSnapshot = undoStack.pop();

    applySnapshot(lastSnapshot);
    refreshUndoButtons();
}

function redoSolution() {
    if (!redoStack.length) {
        return;
    }

    undoStack.push(lastSnapshot);

    lastSnapshot = redoStack.pop();

    applySnapshot(lastSnapshot);
    refreshUndoButtons();
}

function refreshUndoButtons() {
    const undo = document.getElementById("solutionUndo");
    const redo = document.getElementById("solutionRedo");

    if (undo) {
        undo.disabled = undoStack.length === 0;
    }

    if (redo) {
        redo.disabled = redoStack.length === 0;
    }
}

/* ---------------------------------------------------------- */
/* INSERT A DRAWING FIGURE                                     */
/* ---------------------------------------------------------- */

/*
 * PUTTING A DRAWING INTO THE WRITTEN SOLUTION.
 *
 * The solution does NOT embed the drawing editor - a drawing is made in the
 * Drawing workspace. What happens here is the LINK: the student picks a sheet and
 * a `\datumfigure{sheetId}` reference is inserted at the caret. The figure is
 * rendered from that sheet's CURRENT contents every time the solution renders, so
 * editing the drawing updates the figure with nothing to re-insert.
 *
 * The SHEET ID is what is stored, never the name: a sheet is the thing most
 * likely to be renamed or reordered next, and a reference that survived neither
 * would quietly stop meaning anything.
 */
function sheetChoices() {
    try {
        const sheets = enggDrawingSheets.all() || [];

        return sheets.map((sheet) => ({
            id: sheet.id,
            label: sheet.name || "Sheet"
        }));
    } catch (error) {
        return [];
    }
}

function insertDrawingFigure() {
    const field = editor();

    if (!field) {
        return;
    }

    const choices = sheetChoices();

    /*
     * A BUTTON THAT CANNOT WORK MUST SAY SO.
     *
     * With no drawings in the document there is nothing to insert, and the
     * honest answer is to say that and where to make one - not to open an empty
     * dialog or to do nothing at all. The event is still raised, so a host page
     * can react as well.
     */
    if (!choices.length) {
        emitDatumEvent("solution-insert-figure-empty");

        setSolutionStatus(
            "No drawings in this document yet - make one in the Engineering Drawing workspace, then insert it here."
        );

        return;
    }

    /*
     * A CHOICE DIALOG, because which drawing is the whole question - the same
     * reason the Greek insert opens a menu rather than inserting a guessed letter.
     */
    enggUiChoice(
        "Which drawing should be placed at the caret? The figure follows the sheet, so editing the drawing updates it here.",
        "Insert Drawing",
        choices
    ).then((sheetId) => {
        if (!sheetId) {
            return;
        }

        const sheet = (enggDrawingSheets.all() || []).find(
            (candidate) => candidate.id === sheetId
        );

        const reference = enggDrawingReference.createReference({
            sheetId,
            displayMode: "fit",
            caption: sheet?.name || null
        });

        const token = enggDrawingReference.serializeReference(reference);

        const start = field.selectionStart ?? field.value.length;
        const end = field.selectionEnd ?? start;

        field.value =
            field.value.slice(0, start) + token + field.value.slice(end);

        const caret = start + token.length;

        field.focus();
        field.setSelectionRange(caret, caret);

        field.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

/*
 * The shared dialog, reached through the UI module. Kept as a tiny wrapper so the
 * import is one place if the dialogue API ever moves.
 */
let enggUiChoice = async () => null;

function setSolutionStatus(text) {
    const status = document.getElementById("solutionSaveStatus");

    if (status) {
        status.textContent = text || "";
    }
}

/* ---------------------------------------------------------- */
/* EXPORT THE COMPILED SOLUTION AS PDF                         */
/* ---------------------------------------------------------- */

/*
 * A PDF OF THE DOCUMENT, NOT OF THE WORKSPACE.
 *
 * The preview's rendered content is copied into a print-only page and handed to
 * the browser's own PDF writer - the same route the drawing's Print and its PDF
 * download use. What prints is the TYPESET document (MathJax's own output and the
 * live figure SVGs), never a screenshot of the panels around it.
 */
function exportSolutionPdf() {
    const preview = document.getElementById("solutionPreview");

    if (!preview || !preview.childElementCount) {
        emitDatumEvent("solution-export-empty");

        return;
    }

    const nameInput = document.getElementById("solutionDocumentName");

    void ((nameInput?.value || "solution").trim() || "solution");

    const host = document.createElement("div");

    host.id = "solution-print-host";
    host.setAttribute("aria-hidden", "true");
    host.style.display = "none";

    const paper = document.createElement("article");

    paper.className = "solution-paper";

    /* COPIED, not moved, so the on-screen preview is left exactly as it was. */
    [...preview.childNodes].forEach((child) => {
        paper.appendChild(child.cloneNode(true));
    });

    host.appendChild(paper);
    document.body.appendChild(host);

    const style = document.createElement("style");

    style.id = "solution-print-style";
    style.textContent = `
        @media print {
            body > *:not(#solution-print-host) { display: none !important; }
            #solution-print-host { display: block !important; }
            #solution-print-host .solution-paper {
                border: 0;
                box-shadow: none;
                margin: 0;
                max-width: none;
                width: auto;
            }
            @page { margin: 14mm; }
        }
    `;

    document.head.appendChild(style);

    let cleaned = false;

    const cleanup = () => {
        if (cleaned) {
            return;
        }

        cleaned = true;

        host.remove();
        style.remove();

        window.removeEventListener("focus", cleanup);
    };

    window.addEventListener("afterprint", cleanup, { once: true });
    window.addEventListener("focus", cleanup, { once: true });
    setTimeout(cleanup, 5000);

    window.print();
}

/* ---------------------------------------------------------- */
/* INSTALL                                                     */
/* ---------------------------------------------------------- */

let installed = false;

/*
 * The UI module is imported lazily inside install, so this file has no import of
 * it at load time - which keeps the module graph acyclic for the tests that walk
 * it.
 */
async function loadChoice() {
    const ui = await import("../ui/ui.js");

    enggUiChoice = (message, title, choices) =>
        ui.default.choiceDialog(message, { title, buttons: choices });
}

export function installWritingTab() {
    if (installed) {
        return;
    }

    const root = document.getElementById("solutionWorkspace");

    if (!root) {
        return;
    }

    installed = true;

    /*
     * AN EDIT IN THE WRITE-UP IS AN UNSAVED CHANGE TO THE DOCUMENT.
     *
     * The source is saved INTO the `.enggdraw` file, so editing it makes the
     * document differ from that file exactly as moving a force does. Marking it
     * dirty is what puts the unsaved indicator on and what makes Open, New and
     * closing the window offer to save first - without it, a student could write
     * a whole solution and lose it to an Open that never asked.
     */
    enggSolutionWorkspace.setSolutionChangeHandler(() => {
        snapshot();

        markDocumentDirty();

        emitDatumEvent("solutionchange");
    });

    enggSolutionWorkspace.installSolutionWorkspace();

    /*
     * THE INTEGRATION API'S `setSolution` AND THIS WORKSPACE ARE CONNECTED.
     *
     * Loading a solution through `window.datum.setSolution` has to update the
     * outline, the line numbers and the draft exactly as typing does - so the
     * API is handed this module's loader rather than being left to write the
     * textarea on its own. It is a registration, not an import, which is what
     * keeps the API module free of the workspace and the two testable apart.
     */
    attachSolutionSourceLoader(enggSolutionWorkspace.loadSolutionSource);

    /*
     * AND THE DOCUMENT'S OWN LOADER IS CONNECTED TOO, so a `.enggdraw` file
     * that carries a written solution puts it back in the workspace when it is
     * opened - see `loadDrawing` in document-commands.
     */
    attachSolutionLoader(enggSolutionWorkspace.loadSolutionSource);

    document.getElementById("solutionUndo")?.addEventListener("click", undoSolution);

    document.getElementById("solutionRedo")?.addEventListener("click", redoSolution);

    document
        .getElementById("solutionInsertFigure")
        ?.addEventListener("click", insertDrawingFigure);

    document
        .getElementById("solutionExportPdf")
        ?.addEventListener("click", exportSolutionPdf);

    /*
     * THE DOCUMENT NAME.
     *
     * Typing in it renames the SOLUTION, which is stored in the document so it
     * travels with the file. Applied on `change` rather than on every keystroke,
     * so a half-typed name is never the name in the document.
     */
    document
        .getElementById("solutionDocumentName")
        ?.addEventListener("change", () => emitDatumEvent("solutionchange"));

    loadChoice().catch(() => {
        /* The dialog stays unavailable; inserting a figure simply does nothing. */
    });

    snapshot();
    refreshUndoButtons();

    /* A drawing change is a figure change, so the file list must hear about it. */
    enggDrawingSheets.setReferenceChangeHandler?.(() => {
        enggSolutionWorkspace.refreshSolutionFiles();
    });
}

/*
 * INSTALL AT START-UP, AND AGAIN WHEN THE TAB IS OPENED.
 *
 * The first attempt may run before the workspace's markup is in the document -
 * `main.js` imports this module early, and on a cold load the section may not
 * have been parsed yet. The installer returns WITHOUT marking itself installed
 * in that case, so a later call is a real retry rather than a no-op.
 *
 * The tab click is the second, guaranteed attempt: the student cannot open the
 * solution without the markup being there. It runs through the SAME installer, so
 * there is one wiring path rather than two that could drift apart.
 */
document.addEventListener("DOMContentLoaded", installWritingTab);

document.addEventListener("click", (event) => {
    if (event.target.closest?.('.tab[data-tab="writing"]')) {
        installWritingTab();
    }
});

if (document.readyState !== "loading") {
    installWritingTab();
}

export default installWritingTab;
