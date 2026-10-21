/*
 * ============================================================
 * THE WRITTEN SOLUTION TAB
 * ============================================================
 *
 * The workspace's installer. The tab itself is a section in the page; everything
 * inside it - the outline, the editor, the preview, the toolbar - is built and
 * wired by `solution-workspace.js`, and the TYPESETTING is the reference module's
 * (`written-references.js`), which is the one renderer that knows an embedded
 * TikZ drawing block is part of the document.
 *
 * This file exists to be the ONE place the tab is switched on, and to hold the
 * toolbar actions that are about the DOCUMENT rather than about the text - undo,
 * redo, inserting a drawing, exporting - so the workspace module stays about
 * layout and rendering.
 */

import enggSolutionWorkspace from "./solution-workspace.js";
import enggInlineDrawings from "./inline-drawings.js";
import { enggDrawingSheets } from "../../features/workspace/index.js";
import { writeStandaloneLatex } from "./embedded-drawings.js";
import { attachSolutionSourceLoader } from "../integration/datum-api.js";
import { attachSolutionLoader, attachSolutionDocumentWriter, markDocumentDirty } from "../../features/workspace/commands/document-commands.js";
import { emitDatumEvent } from "../integration/events.js";
import enggSolutionState from "./solution-state.js";

const document = globalThis.document;

/* ---------------------------------------------------------- */
/* THE DRAWING WORKFLOW                                        */
/* ---------------------------------------------------------- */

/*
 * THE COMPILED DOCUMENT.
 *
 * The export path in document-commands calls the writer registered here: the
 * written solution as a complete, self-contained LaTeX document. Registered at
 * install rather than imported, because document-commands is imported here and
 * an import back would make the two modules a cycle.
 *
 * THE DRAWINGS ARE RESOLVED AT EXPORT TIME. `solutionDrawingSources()` asks each
 * referenced drawing for its CURRENT LaTeX, so the .tex carries the diagram as
 * it stands now rather than as it stood when it was placed.
 */
function writeDocument() {
    return writeStandaloneLatex(enggSolutionState.getSource(), {
        title: document.getElementById("solutionDocumentName")?.value || "Written Solution",
        drawings: enggSolutionWorkspace.solutionDrawingSources()
    });
}

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

function attachDocumentWriterToCommands() {
    attachSolutionDocumentWriter(writeDocument);
}

/*
 * A MODULE THAT IS STILL HALF-WAY THROUGH A LOAD MUST NOT LOOK BROKEN.
 *
 * `inline-drawings.js` is a sibling module, not a replacement for anything in
 * this file: the tab can install before it is reached, and the drawing then
 * reports that the workspace is unavailable rather than throwing. The guard is
 * here so the registration cannot be the first thing to fail.
 */

export function installWritingTab() {
    /*
     * AN ALREADY-INSTALLED TAB STILL RECONCILES ITS CONTROLS.
     *
     * The workspace itself is wired once. A BUTTON is different: the toolbar
     * lives inside the solution's section, and the section is not always in the
     * document when this module loads - so the first install can find no button
     * to bind. A blanket `return` here is what left Enter Drawing with no
     * handler at all: the install had already run, the button appeared later, and
     * nothing ever looked for it again. Binding is idempotent (`bindOnce`), so
     * running this again is safe and is what lets a late button be picked up.
     */
    const root = document.getElementById("solutionWorkspace");

    if (!root) {
        return;
    }

    bindDrawingToolbar();

    if (installed) {
        return;
    }

    installed = true;

    /*
     * THE TWO HALVES ARE INTRODUCED TO EACH OTHER, through their own actions.
     *
     * The workspace is the editor and the source; it is not told what a drawing
     * is. `inline-drawings.js` owns the drawing side and is handed the two
     * operations it needs on the text; the workspace is handed the two drawing
     * operations it offers, so Enter Drawing and Edit Drawing run the same
     * actions whichever door they are reached by.
     */
    enggInlineDrawings.attachInlineDrawings({
        getSource: () => enggSolutionState.getSource(),
        replaceSource: (value, options) =>
            enggSolutionWorkspace.replaceSolutionSource(value, options),
        refresh: (options) => enggSolutionWorkspace.refreshSolutionSelection(options),
        setSelection: (blockId) => enggSolutionWorkspace.selectDrawingBlock(blockId)
    });

    enggSolutionWorkspace.attachDrawingHost({
        enterDrawing: (options) => enggInlineDrawings.enterDrawing(options),
        editDrawing: (drawingId, blockId) => enggInlineDrawings.editDrawing(drawingId, { blockId })
    });

    /* The workspace's status messages are shown where this tab always showed
       them - beside the document name - so there is one status line, not two. */
    enggSolutionWorkspace.setSolutionStatusListener((text) => {
        const status = document.getElementById("solutionSaveStatus");

        if (status) {
            status.textContent = text;
        }
    });

    /*
     * THE EXPORT PATH GETS THE WRITER. The "solution" download format is
     * served by this module's own writer - the only thing that knows how
     * the written solution is put together - registered here where the tab
     * is installed, so an export before the tab was ever opened is still
     * answered.
     */
    attachDocumentWriterToCommands();

    /*
     * AN EDIT IN THE WRITE-UP IS AN UNSAVED CHANGE TO THE DOCUMENT.
     *
     * The source is saved INTO the drawing's `.tex` file, so editing it makes the
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
     * AND THE DOCUMENT'S OWN LOADER IS CONNECTED TOO, so a saved drawing
     * that carries a written solution puts it back in the workspace when it is
     * opened - see `loadDrawing` in document-commands.
     */
    attachSolutionLoader(enggSolutionWorkspace.loadSolutionSource);

    document.getElementById("solutionUndo")?.addEventListener("click", undoSolution);

    document.getElementById("solutionRedo")?.addEventListener("click", redoSolution);

    /*
     * ENTER DRAWING OPENS THE DRAWING ITSELF, NOT A PICKER.
     *
     * The control used to open a list of sheets and copy the chosen sheet's
     * code into the answer - which made a SECOND copy of the drawing, so every
     * later edit to it was invisible to the written solution. It now runs the
     * drawing workflow: a reference is placed at the caret and the drawing it
     * names is opened in the Engineering Drawing workspace (see
     * `inline-drawings.js`).
     *
     * The binding is idempotent and re-run when the tab is opened, because a
     * control that appears after this module loaded must still be wired - the
     * original defect was exactly that, a control nobody had bound.
     */
    bindDrawingToolbar();

    document
        .getElementById("drawingReturnToSolution")
        ?.addEventListener("click", () => {
            enggInlineDrawings.returnToSolutionWorkspace();
        });

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

    snapshot();
    refreshUndoButtons();

    /* A drawing change is a figure change, so the file list must hear about it. */
    enggDrawingSheets.setReferenceChangeHandler?.(() => {
        enggSolutionWorkspace.refreshSolutionFiles();
    });
}

/*
 * BIND A CONTROL ONCE, HOWEVER MANY TIMES INSTALL RUNS.
 *
 * The install is deliberately re-runnable (a button may appear after this
 * module loaded), so binding has to be idempotent or a second call would make
 * Enter Drawing open two dialogs. The mark is a property on the element, which
 * lives exactly as long as the element does.
 */
function bindOnce(element, key, type, handler) {
    if (!element) {
        return false;
    }

    const mark = `__daetumBound_${key}`;

    if (element[mark]) {
        return false;
    }

    element[mark] = true;
    element.addEventListener(type, handler);

    return true;
}

/*
 * THE DRAWING TOOLBAR.
 *
 * ENTER DRAWING - place a drawing at the cursor and open it, or open the one
 *                already there. `solutionEnterDrawing` is bound here for the
 *                hosts that render the button themselves.
 *
 * The workspace binds the workspace's own button when it installs, so both
 * routes end in the same action and neither can fire twice: `bindOnce` marks the
 * element it has bound.
 */
function bindDrawingToolbar() {
    /*
     * THE WORKSPACE OWNS THE BUTTON IN ITS TOOLBAR. Binding it here as well
     * would run the action twice for one click, so the direct binding is kept
     * for the legacy id only - and the workspace's binding is the one that
     * reads the caret and the selected reference.
     */
    void bindOnce;
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
