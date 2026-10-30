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
import { enggDrawingSheets } from "../../features/workspace/index.js";
import { serializeDocumentBody } from "../../features/workspace/commands/document-commands.js";
import { writeLatexPictureParts } from "../file/latex/latex-document.js";
import { createPalette } from "../file/latex/svg-to-tikz.js";
import { serializeDrawingBlock, writeStandaloneLatex } from "./embedded-drawings.js";
import { sourceHasDrawableContent, visibleDrawingSource } from "../rendering/latex/drawing-source.js";

/* Short names for the two source helpers this module reads a sheet with. */
const drawableContent = sourceHasDrawableContent;
const visibleSource = visibleDrawingSource;
import { attachSolutionSourceLoader } from "../integration/datum-api.js";
import { attachSolutionLoader, attachSolutionDocumentWriter, markDocumentDirty } from "../../features/workspace/commands/document-commands.js";
import { emitDatumEvent } from "../integration/events.js";
import enggSolutionState from "./solution-state.js";

const document = globalThis.document;
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
 * The drawing is EMBEDDED, not referenced. The student picks a sheet and the
 * sheet's COMPLETE TikZ source - the plain `tikzpicture`, the same code the
 * Source view and the .tex export show - is written into the document at the
 * caret. No application markers, no metadata comments, no wrappers: the
 * document stays ordinary LaTeX. What was inserted is a copy, so editing the
 * drawing afterwards leaves the written solution as it was written; the
 * block's code is ordinary LaTeX text the student can read and edit like any
 * other part of the answer.
 *
 * AN EMPTY SHEET INSERTS NOTHING. A sheet with no drawable objects has no
 * code to insert - generating a placeholder would put geometry the student
 * never drew into an evidence document - so the dropdown marks empty
 * sheets, and picking one explains rather than inserts.
 */
let drawingPalette = null;

function isSheetEmpty(sheet) {
    /*
     * EMPTINESS IS ABOUT DRAWABLE CONTENT, NOT ABOUT THE PICTURE EXISTING.
     *
     * A sheet may carry objects that are all hidden, and it may carry a source
     * that has been initialised with an empty `tikzpicture` - neither draws
     * anything. So the object list decides first, and the sheet's canonical
     * source is asked as well when one is stored: a source with no command
     * lines is an empty drawing however it was saved.
     */
    const drawableObjects = (sheet?.objects || []).some(
        (object) => !object.hidden
    );

    if (drawableObjects) {
        return false;
    }

    const storedSource = sheet?.source?.source;

    if (typeof storedSource === "string" && sourceHasDrawableContent(storedSource)) {
        return false;
    }

    return true;
}

function sheetChoices() {
    try {
        const sheets = enggDrawingSheets.all() || [];

        return sheets.map((sheet) => {
            const empty = isSheetEmpty(sheet);
            const name = sheet.name || "Sheet";

            return {
                id: sheet.id,
                label: empty ? `${name} — Empty` : `${name} — Drawing available`,
                empty,
                sheet
            };
        });
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
     * Each choice names the sheet and whether it holds a drawing, so an empty
     * sheet is identified BEFORE it is picked.
     */
    enggUiChoice(
        "Which drawing should be placed at the caret? Its complete TikZ code is copied into the document.",
        "Insert Drawing",
        choices
    ).then((sheetId) => {
        if (!sheetId) {
            return;
        }

        const choice = choices.find((candidate) => candidate.id === sheetId);

        /*
         * AN EMPTY SHEET IS EXPLAINED, NOT INSERTED. The choice was named
         * as empty in the dropdown; picking it confirms the state rather
         * than generating a placeholder picture.
         */
        if (choice?.empty) {
            emitDatumEvent("solution-insert-figure-empty");

            setSolutionStatus(
                `"${choice.sheet?.name || "That sheet"}" is empty - it has no drawing to insert. Draw something on it in the Engineering Drawing workspace first.`
            );

            return;
        }

        /*
         * ONE PALETTE ACROSS THE DOCUMENT. Reusing it means the second
         * drawing's `daetum1` is the colour the first drawing's `daetum1`
         * already declares - no redefinition, no conflict - and the
         * preamble dedupes on export anyway.
         */
        if (!drawingPalette) {
            drawingPalette = createPalette();
        }

        /*
         * THE CANONICAL SOURCE WINS.
         *
         * The Source tab shows one editable, canonical `tikzpicture` for a
         * sheet, and that is what Written Solution must insert - otherwise the
         * code a student can read in Source and the code pasted into their
         * answer would be two different drawings, which is the exact split the
         * source architecture exists to prevent.
         *
         * The sheet's stored source is the canonical one: it is captured with
         * the sheet (see sheets.js) and carries the same text the Source tab
         * edits. Only when a sheet has no stored source at all - a drawing that
         * predates it - is the SVG-to-TikZ export used, which is the same code
         * the .tex download produces.
         *
         * Either way the visible form is inserted: `visibleDrawingSource`
         * strips the object markers, so the answer receives ordinary LaTeX with
         * nothing in it that says "DAETUM".
         */
        const choiceSheet = choice.sheet;
        const storedSource =
            typeof choiceSheet?.source?.source === "string"
                ? choiceSheet.source.source
                : null;

        let parts;

        if (storedSource && drawableContent(storedSource)) {
            parts = {
                preamble: [],
                picture: visibleSource(storedSource),
                empty: false
            };
        } else {
            try {
                parts = writeLatexPictureParts(
                    serializeDocumentBody(),
                    sheetId,
                    () => drawingPalette
                );
            } catch (error) {
                setSolutionStatus(
                    "This drawing could not be converted to TikZ code. " +
                        "Check that the sheet is still in the document."
                );

                return;
            }
        }

        if (!parts.picture) {
            setSolutionStatus(
                "That sheet has no drawable content, so there is no drawing code to insert."
            );

            return;
        }

        /*
         * THE COLOURS GO IN THE PREAMBLE, NOT THE BLOCK. The document
         * declares each colour once, above the content - `writeDocument`
         * below builds that preamble from the whole source - so the block
         * at the caret is only the drawing itself.
         */
        rememberColourDefinitions(parts.preamble);

        const block = serializeDrawingBlock(parts.picture);

        const start = field.selectionStart ?? field.value.length;
        const end = field.selectionEnd ?? start;

        field.value =
            field.value.slice(0, start) + block + field.value.slice(end);

        const caret = start + block.length;

        field.focus();
        field.setSelectionRange(caret, caret);

        field.dispatchEvent(new Event("input", { bubbles: true }));

        setSolutionStatus(
            `Drawing embedded as TikZ code (${parts.picture.split("\n").length} lines).`
        );
    });
}

/*
 * The colour definitions embedded drawings have contributed, kept as text and
 * written into the document preamble when it is produced. They travel in the
 * document, not in a registry that could go stale: rebuilding from the source
 * is always possible, because the pictures themselves still carry the same
 * definitions as comments of their own making.
 */
let embeddedColourDefinitions = [];

function rememberColourDefinitions(definitions) {
    embeddedColourDefinitions = [
        ...new Set([...embeddedColourDefinitions, ...definitions])
    ];
}

export function embeddedDrawingPreamble() {
    return embeddedColourDefinitions;
}

/*
 * The export path in document-commands calls the writer registered here: the
 * written solution as a complete, self-contained LaTeX document. Registered
 * at install rather than imported, because document-commands is imported
 * here and an import back would make the two modules a cycle.
 */
function writeDocument() {
    return writeStandaloneLatex(enggSolutionState.getSource(), {
        title: document.getElementById("solutionDocumentName")?.value || "Written Solution",
        extraPreamble: embeddedColourDefinitions
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

function attachDocumentWriterToCommands() {
    attachSolutionDocumentWriter(writeDocument);
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
