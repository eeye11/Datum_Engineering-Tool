/*
 * ============================================================
 * THE WRITTEN SOLUTION WORKSPACE
 * ============================================================
 *
 * Three views of ONE document, side by side:
 *
 *   LEFT     the solution's structure, parsed from the source
 *   CENTRE   the source itself, with line numbers
 *   RIGHT    the typeset document
 *
 * Everything here is WIRING. The source lives in `solution-state`, the typeset
 * output is produced by `written-references` (which owns the drawing figures and
 * MathJax), and the save path is the application's own. This module connects
 * them and owns the layout - it does not keep a second copy of any of them.
 *
 * THE THREE VIEWS CANNOT DISAGREE, because there is one source: the outline is
 * parsed from it, the preview is typeset from it, and the editor IS it. Editing
 * the text updates the outline and marks the preview stale; nothing else has to
 * be told.
 */

import enggSolutionState from "./solution-state.js";
import { render, setDrawingSelectionHandler } from "./written-references.js";
import {
    blockAtCaret,
    guardEdit,
    renderDrawingBlocks,
    selectedDrawingBlock,
    setSelectedDrawingBlock
} from "./drawing-blocks-editor.js";
import { drawingNumber, insertDrawingBlock, parseDrawingBlocks, removeDrawingBlock } from "./drawing-blocks.js";
import enggUi from "../ui/ui.js";
import { readSheetLatex } from "../file/latex/latex-document.js";

/*
 * THE SHEET FACADE, from the editor barrel - NOT the sheets model.
 *
 * `all()` and `renderReference` are the CONTROLLER's: it is the thing that knows
 * which collection is open. The model module is the flat data and has no `all()`
 * at all, so importing it here silently produced an empty Files list rather than
 * an error - which is why this import is worth a note.
 */
import { enggDrawingSheets } from "../../features/workspace/index.js";

const document = globalThis.document;

/* ---------------------------------------------------------- */
/* ELEMENTS                                                    */
/* ---------------------------------------------------------- */

const el = (id) => document.getElementById(id);

const nodes = {
    root: el("solutionWorkspace"),
    // Toolbar
    docName: el("solutionDocumentName"),
    saveStatus: el("solutionSaveStatus"),
    undo: el("solutionUndo"),
    redo: el("solutionRedo"),
    compile: el("solutionCompile"),
    enterDrawing: el("solutionEnterDrawing"),
    editDrawing: el("solutionEditDrawing"),
    modes: el("solutionLayoutModes"),
    zoomOut: el("solutionZoomOut"),
    zoomIn: el("solutionZoomIn"),
    zoomValue: el("solutionZoomValue"),
    exportPdf: el("solutionExportPdf"),
    // Panels
    navPanel: el("solutionNavPanel"),
    navBody: el("solutionNavBody"),
    navToggle: el("solutionNavToggle"),
    structureTree: el("solutionStructureTree"),
    filesTree: el("solutionFilesTree"),
    // Editor
    editor: el("solutionEditor"),
    editorGutter: el("solutionEditorGutter"),
    editorTools: el("solutionInsertTools"),
    // Preview
    preview: el("solutionPreview"),
    previewStage: el("solutionPreviewStage"),
    previewScroll: el("solutionPreviewScroll"),
    previewState: el("solutionPreviewState"),
    // Resizers
    splitterNav: el("solutionSplitterNav"),
    splitterPreview: el("solutionSplitterPreview")
};

/* ---------------------------------------------------------- */
/* EDITOR: LINE NUMBERS                                        */
/* ---------------------------------------------------------- */

/*
 * THE GUTTER IS DRAWN FROM THE TEXT, not from a per-row DOM.
 *
 * The editor is a `<textarea>` - which is what keeps selection, undo, paste and
 * the browser's own keyboard handling working exactly as they should - and a
 * textarea cannot carry a line-number column of its own. So the numbers are a
 * separate element beside it, regenerated whenever the line count changes, and
 * the two scroll together.
 */
function renderGutter() {
    if (!nodes.editorGutter || !nodes.editor) {
        return;
    }

    const lines = nodes.editor.value.split("\n").length;

    const current = nodes.editorGutter.childElementCount;

    if (current === lines) {
        return;
    }

    const fragment = document.createDocumentFragment();

    for (let line = 1; line <= lines; line += 1) {
        const row = document.createElement("span");

        row.className = "solution-gutter-line";
        row.textContent = String(line);

        fragment.appendChild(row);
    }

    nodes.editorGutter.textContent = "";
    nodes.editorGutter.appendChild(fragment);

    syncGutterScroll();
}

/*
 * THE NUMBERS FOLLOW THE TEXT. One `scrollTop` write per scroll event, which is
 * the whole cost of the gutter - far cheaper than a scroll-synced overlay.
 */
function syncGutterScroll() {
    if (!nodes.editorGutter || !nodes.editor) {
        return;
    }

    nodes.editorGutter.scrollTop = nodes.editor.scrollTop;
}

/* ---------------------------------------------------------- */
/* OUTLINE                                                     */
/* ---------------------------------------------------------- */

/*
 * The structure tree, rebuilt from the source.
 *
 * Selecting a row moves the caret to that heading's line, so the outline is a
 * table of contents that goes somewhere. The INDENT comes from the heading's
 * level, which is what makes the hierarchy readable rather than a flat list.
 */
function renderOutline() {
    if (!nodes.structureTree) {
        return;
    }

    const source = enggSolutionState.getSource();

    const headings = enggSolutionState.parseStructure(source);
    const figures = enggSolutionState.parseFigures(source);
    const equations = enggSolutionState.parseEquations(source);

    nodes.structureTree.textContent = "";

    const addRow = (label, meta, line, kind) => {
        const row = document.createElement("button");

        row.type = "button";
        row.className = `solution-tree-row solution-tree-${kind}`;
        row.dataset.line = String(line);

        const number = document.createElement("span");

        number.className = "solution-tree-number";
        number.textContent = meta || "";

        const text = document.createElement("span");

        text.className = "solution-tree-label";
        text.textContent = label;

        row.appendChild(number);
        row.appendChild(text);

        row.addEventListener("click", () => goToLine(line));

        return row;
    };

    if (!headings.length && !figures.length && !equations.length) {
        const empty = document.createElement("p");

        empty.className = "solution-tree-empty";
        empty.textContent =
            "No headings yet. Add \\section{...} or \\begin{problem} to build the outline.";

        nodes.structureTree.appendChild(empty);

        return;
    }

    headings.forEach((heading) => {
        const row = addRow(heading.title, heading.number, heading.line, "heading");

        row.style.paddingLeft = `${8 + heading.level * 12}px`;
        row.title = `${heading.label} — line ${heading.line + 1}`;

        nodes.structureTree.appendChild(row);
    });

    if (figures.length) {
        const group = document.createElement("div");

        group.className = "solution-tree-group";
        group.textContent = `Figures (${figures.length})`;

        nodes.structureTree.appendChild(group);

        figures.forEach((figure) => {
            const row = addRow(figure.label, "", figure.line, "figure");

            row.style.paddingLeft = "20px";
            row.title = `${figure.kind === "drawing" ? "Drawing" : "Float"} — line ${
                figure.line + 1
            }`;

            nodes.structureTree.appendChild(row);
        });
    }

    if (equations.length) {
        const group = document.createElement("div");

        group.className = "solution-tree-group";
        group.textContent = `Equations (${equations.length})`;

        nodes.structureTree.appendChild(group);

        equations.forEach((equation) => {
            const row = addRow(equation.label, "", equation.line, "equation");

            row.style.paddingLeft = "20px";

            nodes.structureTree.appendChild(row);
        });
    }
}

/*
 * Put the caret on a line and make sure it is visible.
 *
 * The scroll arithmetic is done in LINE HEIGHTS rather than by measuring text,
 * because the editor's font is monospaced and its line-height is known - so the
 * target offset is exact without a layout measurement per line.
 */
export function goToLine(line) {
    if (!nodes.editor) {
        return;
    }

    const lines = nodes.editor.value.split("\n");
    const target = Math.max(0, Math.min(line, lines.length - 1));

    let index = 0;

    for (let i = 0; i < target; i += 1) {
        index += lines[i].length + 1;
    }

    nodes.editor.focus();
    nodes.editor.setSelectionRange(index, index + (lines[target]?.length || 0));

    const lineHeight = parseFloat(getComputedStyle(nodes.editor).lineHeight) || 20;

    nodes.editor.scrollTop = Math.max(0, target * lineHeight - nodes.editor.clientHeight / 2);

    syncGutterScroll();
}

/* ---------------------------------------------------------- */
/* THE FILES VIEW                                              */
/* ---------------------------------------------------------- */

/*
 * The sheets in the document, as a separate list from the outline.
 *
 * FILE MANAGEMENT IS NOT DOCUMENT STRUCTURE. A drawing sheet is a FILE the
 * student works on; a section is a HEADING in the text. Combining the two into
 * one tree - the obvious shortcut - produces a list where "Beam" could mean
 * either, which is exactly the confusion this keeps apart.
 *
 * Each row opens its sheet in the Drawing workspace, which is where a drawing is
 * edited; the written solution does not embed the drawing editor.
 */
function renderFiles() {
    if (!nodes.filesTree) {
        return;
    }

    nodes.filesTree.textContent = "";

    /*
     * THE SHEET LIST CAN FAIL - a collection that is not the open one, a document
     * mid-load - and a file list is not worth taking the workspace down for. The
     * failure is answered as the empty list it effectively is.
     */
    let sheets;

    try {
        sheets = enggDrawingSheets.all() || [];
    } catch (error) {
        sheets = [];
    }

    if (!sheets.length) {
        const empty = document.createElement("p");

        empty.className = "solution-tree-empty";
        empty.textContent = "No drawing sheets yet.";

        nodes.filesTree.appendChild(empty);

        return;
    }

    sheets.forEach((sheet) => {
        const row = document.createElement("button");

        row.type = "button";
        row.className = "solution-tree-row solution-tree-file";

        const name = document.createElement("span");

        name.className = "solution-tree-label";
        name.textContent = sheet.name || "Sheet";

        row.appendChild(name);

        row.title = "Open this sheet in the Drawing workspace";

        row.addEventListener("click", () => {
            /*
             * OPEN THE DRAWING HALF, on this sheet. The workspace tabs are the
             * application's own switch, and clicking one is the same act the
             * student would perform - no second way of changing workspace is
             * introduced here.
             */
            const drawingTab = document.querySelector('.tab[data-tab="drawing"]');

            drawingTab?.click();

            if (typeof enggDrawingSheets.setActive === "function" && sheet.id) {
                try {
                    enggDrawingSheets.setActive(sheet.id);
                } catch (error) {
                    /* The sheet list may be on a collection that is not open. */
                }
            }
        });

        nodes.filesTree.appendChild(row);
    });
}

/* ---------------------------------------------------------- */
/* THE PREVIEW                                                 */
/* ---------------------------------------------------------- */

let compileTimer = null;
let compiling = false;
/* A compile asked for while one was running, run as soon as it finishes. */
let compileAgain = false;

/*
 * THE PREVIEW IS DEBOUNCED, and the delay is the point.
 *
 * Typesetting on every keystroke would run MathJax on a growing document many
 * times a second, which is both slow and visibly janky. Waiting for a pause in
 * typing means one typeset per pause, which is what "live preview" has to mean
 * to be usable. The COMPILE button renders at once for anyone who wants it now.
 */
const COMPILE_DELAY = 600;

function setCompileState(state, message) {
    if (!nodes.previewState) {
        return;
    }

    nodes.previewState.dataset.state = state;
    nodes.previewState.textContent = message || "";

    nodes.previewState.hidden = state === "idle" && !message;
}

async function compileNow({ keepScroll = false } = {}) {
    if (compiling) {
        /*
         * A COMPILE THAT IS RUNNING IS NOT A COMPILE THAT DOES NOT HAPPEN.
         *
         * Dropping the request would leave the preview showing a document from
         * before the last edit - the stale preview this workflow must never
         * show. The request is remembered and run when the current one ends.
         */
        compileAgain = true;

        return;
    }

    compiling = true;

    setCompileState("working", "Compiling…");

    const anchor = keepScroll ? capturePreviewAnchor() : null;

    try {
        /*
         * The renderer is the application's own: it splits the source at every
         * drawing reference, typesets the prose with MathJax and drops the live
         * sheet figures in place. Nothing about that is reimplemented here.
         */
        await render();

        if (anchor) {
            restorePreviewAnchor(anchor);
        }

        setCompileState("idle", "");
    } catch (error) {
        /*
         * A FAILED COMPILE IS REPORTED, NOT SWALLOWED. The requirement is that a
         * broken document never shows a blank preview pretending to have
         * compiled, so the state line says what happened and where to look.
         */
        setCompileState("error", "This solution could not be compiled. Check the last equation or command you edited.");
    } finally {
        compiling = false;

        if (compileAgain) {
            compileAgain = false;

            compileNow({ keepScroll });
        }
    }
}

/*
 * A RE-RENDER MUST NOT MOVE THE PAGE.
 *
 * Replacing the preview's contents resets its scroll position, so re-rendering
 * after a drawing edit - or after anything else that does not change the text -
 * would throw the student back to the top. The offset is kept, and so is the
 * distance from the viewport's top to the selected drawing, so the page settles
 * where it was rather than where the browser puts an empty scroller.
 */
function capturePreviewAnchor() {
    const scroller = nodes.previewScroll;

    if (!scroller) {
        return null;
    }

    const selected = nodes.preview?.querySelector(".linked-drawing-figure.is-selected");

    return {
        scrollTop: scroller.scrollTop,
        selectedOffset: selected
            ? selected.getBoundingClientRect().top - scroller.getBoundingClientRect().top
            : null
    };
}

function restorePreviewAnchor(anchor) {
    const scroller = nodes.previewScroll;

    if (!scroller || !anchor) {
        return;
    }

    const selected = nodes.preview?.querySelector(".linked-drawing-figure.is-selected");

    if (anchor.selectedOffset === null || !selected) {
        scroller.scrollTop = anchor.scrollTop;

        return;
    }

    const offset = selected.getBoundingClientRect().top - scroller.getBoundingClientRect().top;

    scroller.scrollTop += offset - anchor.selectedOffset;
}

function scheduleCompile({ keepScroll = false } = {}) {
    if (compileTimer) {
        clearTimeout(compileTimer);
    }

    setCompileState("stale", "Preview out of date");

    compileTimer = setTimeout(() => {
        compileTimer = null;
        compileNow({ keepScroll });
    }, COMPILE_DELAY);
}

/* ---------------------------------------------------------- */
/* ZOOM                                                        */
/* ---------------------------------------------------------- */

const ZOOM_STEPS = [0.6, 0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];

let zoomIndex = 3;

function applyZoom() {
    const scale = ZOOM_STEPS[zoomIndex];

    if (nodes.previewStage) {
        nodes.previewStage.style.transform = `scale(${scale})`;
    }

    if (nodes.zoomValue) {
        nodes.zoomValue.textContent = `${Math.round(scale * 100)}%`;
    }
}

function stepZoom(direction) {
    const next = zoomIndex + direction;

    if (next < 0 || next >= ZOOM_STEPS.length) {
        return;
    }

    zoomIndex = next;

    applyZoom();
}

/* ---------------------------------------------------------- */
/* LAYOUT MODES AND RESIZING                                   */
/* ---------------------------------------------------------- */

/*
 * THREE VIEWING MODES, one setting.
 *
 *   split     outline + editor + preview (the working layout)
 *   write     the editor takes everything but the outline
 *   read      the preview takes everything, for reading the finished answer
 *
 * THE MODE IS A CLASS ON THE ROOT, so the layout is decided entirely in CSS and
 * switching cannot leave a panel half-arranged. Nothing about the document, the
 * caret or an unsaved change is touched by a mode change - the DOM is the same,
 * only its width allocation moves.
 */
export function setLayoutMode(mode) {
    if (!nodes.root) {
        return;
    }

    const wanted = ["split", "write", "read"].includes(mode) ? mode : "split";

    nodes.root.dataset.layout = wanted;

    nodes.modes?.querySelectorAll("[data-layout-mode]").forEach((button) => {
        const active = button.dataset.layoutMode === wanted;

        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
    });
}

/*
 * DRAG A DIVIDER TO REALLOCATE SPACE.
 *
 * The width is written as a CSS custom property on the root, so the grid's
 * template reads it and nothing else has to know the value. It is clamped to a
 * sensible range rather than to zero, because a panel dragged to nothing is a
 * panel the student then has to find again.
 */
function wireSplitter(splitter, variable, { min, max, invert }) {
    if (!splitter || !nodes.root) {
        return;
    }

    const onMove = (event) => {
        const rect = nodes.root.getBoundingClientRect();

        if (!rect.width) {
            return;
        }

        const pointer = event.clientX - rect.left;

        const fraction = invert
            ? (rect.width - pointer) / rect.width
            : pointer / rect.width;

        const clamped = Math.max(min, Math.min(max, fraction));

        nodes.root.style.setProperty(variable, `${(clamped * 100).toFixed(2)}%`);
    };

    const stop = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", stop);

        splitter.classList.remove("dragging");
        document.body.classList.remove("solution-resizing");
    };

    splitter.addEventListener("pointerdown", (event) => {
        event.preventDefault();

        splitter.classList.add("dragging");
        document.body.classList.add("solution-resizing");

        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", stop);
    });

    /* Arrow keys, so the divider is usable without a pointer. */
    splitter.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
            return;
        }

        event.preventDefault();

        const current = parseFloat(
            nodes.root.style.getPropertyValue(variable)
        ) || (invert ? 0.42 : 0.2);

        const delta = event.key === "ArrowRight" ? 0.03 : -0.03;

        const next = Math.max(min, Math.min(max, current + delta));

        nodes.root.style.setProperty(variable, `${(next * 100).toFixed(2)}%`);
    });
}

/* ---------------------------------------------------------- */
/* INSERT TOOLS                                                */
/* ---------------------------------------------------------- */

/*
 * THE SNIPPETS THE STUDENT SHOULD NOT HAVE TO REMEMBER.
 *
 * Each is a real LaTeX construct the renderer already handles - maths, a
 * numbered equation, a fraction, a Greek letter, a matrix, a piecewise case, a
 * table, a section, a list. Inserting one is ordinary text insertion at the
 * caret, which is what keeps the editor and the document in step: a snippet is
 * never a special object, just text the student can then edit.
 *
 * `cursor` is where the caret is left after insertion, expressed as a marker in
 * `text`, so the student lands INSIDE the braces they are about to fill rather
 * than after the whole snippet.
 */
const SNIPPETS = {
    "insert-inline-math": { text: "$${caret}$$", label: "Inline maths" },
    "insert-display-math": { text: "\\[\n  ${caret}\n\\]", label: "Display maths" },
    "insert-equation": {
        text: "\\begin{equation}\n  ${caret}\n\\end{equation}",
        label: "Numbered equation"
    },
    "insert-fraction": { text: "\\frac{${caret}}{}", label: "Fraction" },
    "insert-subscript": { text: "_{${caret}}", label: "Subscript" },
    "insert-superscript": { text: "^{${caret}}", label: "Superscript" },
    "insert-greek": { text: "${caret}", label: "Greek letter" },
    "insert-vector": { text: "\\vec{${caret}}", label: "Vector" },
    "insert-matrix": {
        text: "\\begin{bmatrix}\n  ${caret} &  \\\\\n   & \n\\end{bmatrix}",
        label: "Matrix"
    },
    "insert-cases": {
        text: "\\begin{cases}\n  ${caret} & x > 0 \\\\\n   & x \\leq 0\n\\end{cases}",
        label: "Piecewise"
    },
    "insert-section": { text: "\\section{${caret}}", label: "Section" },
    "insert-subsection": { text: "\\subsection{${caret}}", label: "Subsection" },
    "insert-problem": {
        text: "\\begin{problem}\n${caret}\n\\end{problem}",
        label: "Problem"
    },
    "insert-list": {
        text: "\\begin{itemize}\n  \\item ${caret}\n\\end{itemize}",
        label: "List"
    },
    "insert-table": {
        text:
            "\\begin{tabular}{${caret}cc}\n  A & B \\\\\n  C & D \\\\\n\\end{tabular}",
        label: "Table"
    },
    "insert-bold": { text: "\\textbf{${caret}}", label: "Bold" },
    "insert-italic": { text: "\\textit{${caret}}", label: "Italic" }
};

/*
 * A GREEK LETTER IS A MENU, NOT A SNIPPET, because which letter is the whole
 * question. It is the one insert that needs a second choice, so it gets a menu
 * rather than fifteen buttons.
 */
const GREEK = ["alpha", "beta", "gamma", "delta", "theta", "lambda", "mu", "pi", "sigma", "omega", "Sigma", "Delta", "Omega"];

function insertAtCaret(text, caretOffset) {
    if (!nodes.editor) {
        return;
    }

    const start = nodes.editor.selectionStart ?? nodes.editor.value.length;
    const end = nodes.editor.selectionEnd ?? start;

    nodes.editor.value =
        nodes.editor.value.slice(0, start) + text + nodes.editor.value.slice(end);

    const caret = start + (caretOffset ?? text.length);

    nodes.editor.focus();
    nodes.editor.setSelectionRange(caret, caret);

    handleInput();
}

function insertSnippet(key) {
    const snippet = SNIPPETS[key];

    if (!snippet) {
        return;
    }

    const marker = snippet.text.indexOf("${caret}");

    const text = snippet.text.replace("${caret}", "");

    insertAtCaret(text, marker >= 0 ? marker : text.length);
}

function insertGreek(letter) {
    insertAtCaret(`\\${letter}`);
}

/*
 * THE ONE PLACE A CHANGE IS NOTICED.
 *
 * Editing, inserting a snippet and a toolbar action all funnel through here, so
 * the outline, the gutter, the draft and the compile schedule are updated in
 * exactly one place - which is what stops one of them being forgotten on one
 * path and not another.
 */
export function handleInput() {
    /*
     * A DRAWING REFERENCE IS NOT TYPED INTO, AND NOT TYPED OVER.
     *
     * This is the ONE path an edit to the source passes through (typing,
     * deleting, pasting, dragging, a snippet, a toolbar insert), so it is where
     * the protected commands are checked. An edit that would reach inside a
     * `\datumdrawing{...}` is refused and the editor is put back exactly as it
     * was; the reference is selected instead, so the student sees what they
     * touched and can use Edit Drawing or delete it deliberately.
     */
    const guard = guardEdit(lastSource, nodes.editor.value, parseDrawingBlocks);

    if (!guard.ok) {
        nodes.editor.value = lastSource;

        setSolutionStatus(
            "A drawing reference is protected. Select it in the source to edit or remove the drawing."
        );

        if (guard.block) {
            selectDrawingBlock(guard.block.blockId, { scroll: false });
        }

        return;
    }

    const changed = enggSolutionState.setSource(nodes.editor.value);

    lastSource = nodes.editor.value;

    renderGutter();

    /*
     * THE REFERENCE LAYER FOLLOWS THE TEXT. A keystroke can add, remove or move
     * a drawing block, so the chips are redrawn with the gutter - both are
     * derived views of the same value, and one path keeps them from disagreeing.
     * A block that is no longer in the text is no longer selected.
     */
    syncDrawingSelection();

    renderDrawingBlocks(nodes.editor, blockLayerOptions());

    if (changed) {
        renderOutline();

        /* A settled edit compiles, and the page stays where the student left it. */
        scheduleCompile({ keepScroll: true });
    }

    emitSolutionChange();
}

/* ---------------------------------------------------------- */
/* DRAWINGS IN THE SOURCE                                      */
/* ---------------------------------------------------------- */

/*
 * THE SOURCE AS IT WAS BEFORE THE CURRENT EDIT.
 *
 * The edit guard compares the editor's new value with this one, so it is the
 * document as the workspace last accepted it - not whatever the textarea held a
 * moment ago. Undo and Redo restore text through the same path, so they are
 * checked the same way: no history entry can cut a command either.
 */
let lastSource = "";

function blockLayerOptions() {
    return {
        parse: parseDrawingBlocks,
        onSelect: (block) => selectDrawingBlock(block.blockId, { reveal: true }),
        onEdit: (block) => requestEditDrawing(block.drawingId, block.blockId),
        onRemove: (block) => removeDrawingSelection(block.drawingId)
    };
}

/* The drawing workflow's actions, registered by the writing tab. */
let drawingHost = null;

function host() {
    return drawingHost && typeof drawingHost === "object" ? drawingHost : null;
}

export function attachDrawingHost(next) {
    drawingHost = next || null;
}

function requestEditDrawing(drawingId, blockId) {
    const target = host();

    if (!target || typeof target.editDrawing !== "function") {
        return;
    }

    target.editDrawing(drawingId, blockId);
}

/*
 * SELECT A DRAWING REFERENCE.
 *
 * Selecting is a UI act only: it sets the selected block id, redraws the
 * reference's own state, highlights the drawing in the preview and reveals it
 * there - and it does not write the source, re-insert the block, regenerate
 * anything or trigger a compile.
 */
export function selectDrawingBlock(blockId, { reveal = false, scroll = true } = {}) {
    setSelectedDrawingBlock(blockId);

    renderDrawingBlocks(nodes.editor, blockLayerOptions());

    decoratePreview(blockId);

    updateDrawingActions();

    /* Moving the SOURCE to the reference, when asked to. */
    if (reveal && blockId) {
        const block = parseDrawingBlocks(lastSource).find(
            (candidate) => candidate.blockId === blockId
        );

        if (block) {
            nodes.editor.focus();
            nodes.editor.setSelectionRange(block.index, block.index + block.length);
            scrollEditorToBlock(block);
        }
    }

    if (scroll) {
        revealSelectedDrawingInPreview();
    }
}

/*
 * THE PREVIEW'S HIGHLIGHT, applied WITHOUT re-rendering.
 *
 * Selecting must not compile the document again - the page is already right,
 * only the decoration changed - so the existing figures are told which one is
 * selected rather than being rebuilt.
 */
function decoratePreview(blockId) {
    nodes.preview?.querySelectorAll(".linked-drawing-figure").forEach((figure) => {
        const selected = Boolean(blockId) && figure.dataset.blockId === blockId;

        figure.classList.toggle("is-selected", selected);

        if (selected) {
            figure.setAttribute("aria-current", "true");
        } else {
            figure.removeAttribute("aria-current");
        }
    });
}

/* Selecting ordinary text clears a drawing selection - it is no longer chosen. */
function clearDrawingSelectionIfTextSelected() {
    const selected = selectedDrawingBlock();

    if (!selected) {
        return;
    }

    const start = nodes.editor.selectionStart;
    const end = nodes.editor.selectionEnd;

    if (start === end) {
        return;
    }

    const block = parseDrawingBlocks(lastSource).find(
        (candidate) => candidate.blockId === selected
    );

    const touchesBlock =
        block && start >= block.index && end <= block.index + block.length;

    if (!touchesBlock) {
        selectDrawingBlock(null, { scroll: false });
    }
}

/* A selection cannot outlive the block it names. */
function syncDrawingSelection() {
    const selected = selectedDrawingBlock();

    if (!selected) {
        return;
    }

    if (!parseDrawingBlocks(lastSource).some((block) => block.blockId === selected)) {
        setSelectedDrawingBlock(null);
        decoratePreview(null);
        updateDrawingActions();
    }
}

function scrollEditorToBlock(block) {
    const lineHeight = parseFloat(getComputedStyle(nodes.editor).lineHeight) || 20;

    nodes.editor.scrollTop = Math.max(0, block.line * lineHeight - nodes.editor.clientHeight / 2);

    syncGutterScroll();
}

/*
 * SCROLL THE PREVIEW ONLY WHEN NECESSARY.
 *
 * A drawing already in view is highlighted where it is - jumping the page for a
 * figure the student can see is exactly the unhelpful movement this avoids. A
 * drawing outside the scroller is brought into view, and only then.
 */
export function revealSelectedDrawingInPreview() {
    const figure = nodes.preview?.querySelector(".linked-drawing-figure.is-selected");
    const scroller = nodes.previewScroll;

    if (!figure || !scroller) {
        return;
    }

    const view = scroller.getBoundingClientRect();
    const rect = figure.getBoundingClientRect();

    const margin = 12;

    if (rect.top >= view.top + margin && rect.bottom <= view.bottom - margin) {
        return;
    }

    const top = Math.max(
        0,
        figure.offsetTop - scroller.clientHeight / 2 + figure.offsetHeight / 2
    );

    /*
     * SMOOTH WHEN THE ENGINE CAN, ALWAYS WHEN IT CANNOT. An engine without
     * `scrollTo` (or without its options) still scrolls, by the plainest route
     * there is.
     */
    if (typeof scroller.scrollTo === "function") {
        try {
            scroller.scrollTo({ top, behavior: "smooth" });

            return;
        } catch (error) {
            /* Fall through to the plain assignment. */
        }
    }

    scroller.scrollTop = top;
}

/*
 * A CLICK ON A DRAWING IN THE PREVIEW SELECTS ITS REFERENCE.
 *
 * The relationship runs both ways: the source reference selected the drawing,
 * and the drawing selects the reference - the block is picked out in the source
 * and moved into view, without the preview moving under the pointer.
 */
function selectDrawingFromPreview(block) {
    selectDrawingBlock(block.blockId, { reveal: true, scroll: false });
}

/*
 * REMOVE A DRAWING DELIBERATELY.
 *
 * The block goes, its reference goes with it, and the surrounding text stays
 * character for character. The DRAWING itself is not deleted here: the written
 * solution owns the include, not the sheet, and a sheet may still be wanted in
 * the drawing workspace. Deleting the drawing is the drawing workspace's own
 * command, against its own list.
 */
export function removeDrawingSelection(drawingId) {
    const result = removeDrawingBlock(lastSource, drawingId);

    if (!result.removed) {
        return;
    }

    /* The block the removal took out cannot stay selected. */
    setSelectedDrawingBlock(null);

    writeSourceValue(result.value);

    setSolutionStatus("The drawing reference was removed from the written solution.");

    emitSolutionChange();
}

/* One write path, so the guard, the layer and the compile all see the change. */
function writeSourceValue(value, { caret = null } = {}) {
    nodes.editor.value = value;

    if (caret !== null && caret !== undefined) {
        nodes.editor.focus();
        nodes.editor.setSelectionRange(caret, caret);
    }

    handleInput();
}

/*
 * THE DRAWING ACTIONS IN THE TOOLBAR.
 *
 * `Enter Drawing` always means "the drawing at the caret": inside a reference
 * that is the referenced drawing, elsewhere it is a new one. `Edit Drawing`
 * appears only once a reference is selected - the compact contextual action,
 * beside the reference and in the toolbar.
 */
function updateDrawingActions() {
    const selected = selectedDrawingBlock();

    const block = selected
        ? parseDrawingBlocks(lastSource).find((candidate) => candidate.blockId === selected)
        : null;

    if (nodes.editDrawing) {
        nodes.editDrawing.hidden = !block;
        nodes.editDrawing.disabled = !block;
    }

    if (nodes.enterDrawing) {
        nodes.enterDrawing.textContent = block
            ? `Edit Drawing ${drawingNumber(lastSource, block.drawingId)}`
            : "Enter Drawing";

        nodes.enterDrawing.title = block
            ? "Open the selected drawing in the Engineering Drawing workspace"
            : "Draw a new diagram and place it at the cursor";
    }
}

function enterDrawingAtCaret() {
    const target = host();

    /*
     * A DRAWING REFERENCE IS OFFERED, NOT ASSUMED.
     *
     * Enter Drawing used to jump straight into the Engineering Drawing
     * workspace: one click created a sheet, wrote a reference and left the
     * written solution behind, with nothing on screen saying what had happened
     * or how to get back. The student pressed a drawing button and was
     * somewhere else.
     *
     * So the button now asks what they meant - draw a new figure, or drop in a
     * drawing that already exists - and only then leaves this page. Each answer
     * writes the protected reference into the line at the caret, which is what
     * makes "the reference appears in the line like one of the texts" true:
     * the source line IS the reference, and the chip over it is only its display.
     */
    if (!target || typeof target.enterDrawing !== "function") {
        setSolutionStatus("The drawing workspace is not available on this page.");

        return;
    }

    const existing = existingDrawings();

    if (!existing.length) {
        enterDrawingNow();

        return;
    }

    enggUi.openDialog({
        title: "Insert a drawing",
        description: "The drawing is placed at the cursor as a reference, like a word in the text.",
        buttons: [
            { id: "new", label: "Draw a new figure", primary: true },
            { id: "existing", label: "Insert an existing drawing" },
            { id: "cancel", label: "Cancel" }
        ],
        onChoose: (choice) => {
            if (choice === "new") {
                enterDrawingNow();
            }

            if (choice === "existing") {
                chooseExistingDrawing();
            }
        }
    });
}

/* The drawings on this document that can be referred to. */
function existingDrawings() {
    try {
        return (enggDrawingSheets.all() || []).filter((sheet) => sheet && sheet.id);
    } catch (error) {
        return [];
    }
}

/*
 * A LIST OF THE DRAWINGS ALREADY ON THE DOCUMENT.
 *
 * Choosing one writes a reference to THAT drawing - the same block Enter
 * Drawing writes for a new one - so the solution holds one reference and the
 * drawing itself stays in one place. It never copies the drawing's code into
 * the answer.
 */
function chooseExistingDrawing() {
    const drawings = existingDrawings();

    enggUi.openDialog({
        title: "Insert a drawing",
        description: "Choose a drawing to place at the cursor.",
        buttons: [
            ...drawings.map((sheet, index) => ({
                id: sheet.id,
                label: sheet.name || `Drawing ${index + 1}`,
                primary: false
            })),
            { id: "cancel", label: "Cancel" }
        ],
        onChoose: (choice) => {
            if (choice === "cancel") {
                return;
            }

            insertExistingDrawing(choice);
        }
    });
}

function insertExistingDrawing(drawingId) {
    const editor = nodes.editor;

    /*
     * THE TEXT THE STUDENT IS LOOKING AT, not the last state sync's copy.
     *
     * `lastSource` is only written when the editor's input is handled, so a
     * write made in the same tick as the previous one (two picks in a row) was
     * measured against a stale buffer - and the reference landed at the end of
     * the OLD text instead of at the caret. The textarea is the thing the
     * student is editing, so it is the thing to read.
     */
    const source = editor ? editor.value : lastSource;
    const position = editor?.selectionStart ?? source.length;

    const existing = parseDrawingBlocks(source).find(
        (block) => block.drawingId === drawingId
    );

    if (existing) {
        setSolutionStatus("That drawing is already in the solution.");

        selectDrawingBlock(existing.blockId);

        return;
    }

    const inserted = insertDrawingBlock(source, drawingId, position);

    /* The one write path, so the guard, the chip layer and the compile all see it. */
    writeSourceValue(inserted.value, { caret: inserted.caret });

    setSolutionStatus("Drawing inserted at the cursor.");
}

function enterDrawingNow() {
    const target = host();

    if (!target || typeof target.enterDrawing !== "function") {
        setSolutionStatus("The drawing workspace is not available on this page.");

        return;
    }

    const selected = selectedDrawingBlock();

    const position = nodes.editor?.selectionStart ?? lastSource.length;

    const atBlock = blockAtCaret(lastSource, position, parseDrawingBlocks);

    const selectedBlock = selected
        ? parseDrawingBlocks(lastSource).find((block) => block.blockId === selected)
        : null;

    const result = target.enterDrawing({
        at: position,
        select: selectedBlock?.drawingId || atBlock?.drawingId || null
    });

    if (result && result.ok === false) {
        setSolutionStatus(result.message || "The drawing could not be opened.");
    }

    if (result && result.ok) {
        setSolutionStatus(
            result.created
                ? "Drawing created and placed at the cursor."
                : "Opened the selected drawing."
        );
    }
}

/* ---------------------------------------------------------- */
/* SAVE STATUS                                                 */
/* ---------------------------------------------------------- */

let changeHandler = null;

function emitSolutionChange() {
    if (typeof changeHandler === "function") {
        changeHandler();
    }
}

export function setSolutionChangeHandler(handler) {
    changeHandler = handler;
}

/*
 * THE STATUS LINE, in the toolbar beside the document name.
 *
 * Used for answers that have nowhere else to go: a drawing could not be opened,
 * a reference was removed, a protected command refused an edit. It is the same
 * element the save state uses, because it is the same question - "what just
 * happened to this document?".
 */
function setSolutionStatus(text) {
    if (nodes.saveStatus) {
        nodes.saveStatus.textContent = text || "";
    }

    if (typeof statusListener === "function") {
        statusListener(text || "");
    }
}

let statusListener = null;

/* The host's own status surface (the writing tab's), when it has one. */
export function setSolutionStatusListener(handler) {
    statusListener = typeof handler === "function" ? handler : null;
}

/* Shown by the host, which owns the save state, not by the workspace. */
export function showSaveStatus(text) {
    if (nodes.saveStatus) {
        nodes.saveStatus.textContent = text || "";
    }
}

/* ---------------------------------------------------------- */
/* THE GREEK MENU                                              */
/* ---------------------------------------------------------- */

function openGreekMenu(anchor) {
    const menu = document.createElement("div");

    menu.className = "solution-greek-menu";
    menu.setAttribute("role", "menu");

    GREEK.forEach((letter) => {
        const item = document.createElement("button");

        item.type = "button";
        item.className = "solution-greek-item";
        item.setAttribute("role", "menuitem");
        item.textContent = `\\${letter}`;

        item.addEventListener("click", () => {
            insertGreek(letter);
            menu.remove();
        });

        menu.appendChild(item);
    });

    document.body.appendChild(menu);

    const rect = anchor.getBoundingClientRect();

    menu.style.left = `${Math.round(rect.left)}px`;
    menu.style.top = `${Math.round(rect.bottom + 4)}px`;

    const close = (event) => {
        if (!menu.contains(event.target)) {
            menu.remove();
            document.removeEventListener("pointerdown", close, true);
        }
    };

    setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
}

/* ---------------------------------------------------------- */
/* WIRING                                                      */
/* ---------------------------------------------------------- */

let wired = false;

export function installSolutionWorkspace() {
    if (wired || !nodes.editor) {
        return;
    }

    wired = true;

    /* The source the editor starts with: the document's, or the last draft. */
    nodes.editor.value = enggSolutionState.initialSource(nodes.editor.value);

    enggSolutionState.setSource(nodes.editor.value);

    renderGutter();
    renderOutline();
    renderFiles();
    renderDrawingBlocks(nodes.editor);

    lastSource = nodes.editor.value;

    nodes.editor.addEventListener("input", handleInput);
    nodes.editor.addEventListener("scroll", () => {
        syncGutterScroll();

        /* The references are positioned against the text, so they scroll with it. */
        renderDrawingBlocks(nodes.editor, blockLayerOptions());
    });

    /* Ordinary text selection clears a drawing selection, as it should. */
    nodes.editor.addEventListener("select", clearDrawingSelectionIfTextSelected);

    nodes.editor.addEventListener("keyup", () => {
        clearDrawingSelectionIfTextSelected();

        /* A caret moved INTO a reference selects it. */
        const start = nodes.editor.selectionStart;

        const block = blockAtCaret(lastSource, start, parseDrawingBlocks);

        if (block && start === nodes.editor.selectionEnd) {
            selectDrawingBlock(block.blockId);
        } else if (!block) {
            updateDrawingActions();
        }
    });

    nodes.editor.addEventListener("mousedown", () => {
        /* A click in the text is a click in the text - not on the reference. */
        if (selectedDrawingBlock()) {
            selectDrawingBlock(null, { scroll: false });
        }
    });

    /*
     * BACKSPACE AND DELETE AT A REFERENCE ROUTE THROUGH THE BLOCK, NOT THROUGH
     * THE COMMAND'S CHARACTERS.
     *
     * A caret next to a reference can be placed there by the keyboard, and in a
     * textarea Backspace would then eat one character of the command. The
     * deletion is answered as the whole block, by the block's own removal - the
     * same action the reference chip offers.
     */
    nodes.editor.addEventListener("keydown", (event) => {
        if (event.key !== "Backspace" && event.key !== "Delete") {
            return;
        }

        const start = nodes.editor.selectionStart;
        const end = nodes.editor.selectionEnd;

        const blocks = parseDrawingBlocks(lastSource);

        const block =
            (start !== end &&
                blocks.find(
                    (candidate) =>
                        start === candidate.index &&
                        end === candidate.index + candidate.length
                )) ||
            (start === end &&
                blocks.find((candidate) => {
                    const blockEnd = candidate.index + candidate.length;

                    return event.key === "Backspace"
                        ? start === blockEnd
                        : start === candidate.index;
                }));

        if (!block) {
            return;
        }

        event.preventDefault();

        removeDrawingSelection(block.drawingId);
    });

    nodes.editDrawing?.addEventListener("click", () => {
        const selected = selectedDrawingBlock();

        const block = parseDrawingBlocks(lastSource).find(
            (candidate) => candidate.blockId === selected
        );

        if (block) {
            requestEditDrawing(block.drawingId, block.blockId);
        }
    });

    nodes.enterDrawing?.addEventListener("click", enterDrawingAtCaret);

    /*
     * TAB INSERTS A TAB, IT DOES NOT LEAVE THE FIELD.
     *
     * In a code editor Tab is indentation. Leaving it to the browser would move
     * the focus into the toolbar mid-sentence, which for a writing surface is
     * simply wrong - so it is intercepted here, and Escape is the documented way
     * out for anyone navigating by keyboard.
     */
    nodes.editor.addEventListener("keydown", (event) => {
        if (event.key === "Tab") {
            event.preventDefault();

            insertAtCaret("  ");
        }

        if (event.key === "Escape") {
            nodes.editor.blur();
        }
    });

    /* Insert tools. */
    nodes.editorTools?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-insert]");

        if (!button) {
            return;
        }

        const key = button.dataset.insert;

        if (key === "insert-greek") {
            openGreekMenu(button);

            return;
        }

        insertSnippet(key);
    });

    /* Layout modes. */
    nodes.modes?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-layout-mode]");

        if (button) {
            setLayoutMode(button.dataset.layoutMode);
        }
    });

    nodes.navToggle?.addEventListener("click", () => {
        const collapsed = nodes.root.classList.toggle("solution-nav-collapsed");

        nodes.navToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    });

    nodes.splitterNav?.addEventListener("dblclick", () => {
        nodes.root.style.setProperty("--solution-nav-width", "20%");
    });

    wireSplitters();
    wireZoom();
    wireCompile();

    setDrawingSelectionHandler(selectDrawingFromPreview);

    updateDrawingActions();

    applyZoom();
    setLayoutMode("split");

    /* The first render, so the preview is not empty on arrival. */
    scheduleCompile();
}

function wireSplitters() {
    wireSplitter(nodes.splitterNav, "--solution-nav-width", {
        min: 0.12,
        max: 0.34,
        invert: false
    });

    /* The preview divider is measured from the RIGHT, so it is inverted. */
    wireSplitter(nodes.splitterPreview, "--solution-preview-width", {
        min: 0.25,
        max: 0.6,
        invert: true
    });
}

function wireZoom() {
    nodes.zoomOut?.addEventListener("click", () => stepZoom(-1));
    nodes.zoomIn?.addEventListener("click", () => stepZoom(1));
}

function wireCompile() {
    nodes.compile?.addEventListener("click", () => {
        if (compileTimer) {
            clearTimeout(compileTimer);
            compileTimer = null;
        }

        compileNow();
    });
}

/* Called by the host when the solution's source should be replaced - an Open, or
   a document restore. */
export function loadSolutionSource(source) {
    if (!nodes.editor) {
        return;
    }

    nodes.editor.value = String(source ?? "");

    lastSource = nodes.editor.value;

    enggSolutionState.setSource(nodes.editor.value);

    setSelectedDrawingBlock(null);

    renderGutter();
    renderOutline();
    renderFiles();
    renderDrawingBlocks(nodes.editor, blockLayerOptions());
    updateDrawingActions();
    scheduleCompile();
}

/*
 * THE SOURCE, REPLACED FROM OUTSIDE (the drawing workflow).
 *
 * Same path as typing: the guard is not the point here - the caller is DAETUM
 * itself, inserting a command it generated - but the outline, the gutter, the
 * reference layer, the compile and the unsaved-change notification all have to
 * happen, and they happen in `handleInput`.
 */
export function replaceSolutionSource(value, { caret = null, selectedBlockId = null } = {}) {
    if (!nodes.editor) {
        return;
    }

    nodes.editor.value = String(value ?? "");

    if (caret !== null && caret !== undefined) {
        nodes.editor.focus();
        nodes.editor.setSelectionRange(caret, caret);
    }

    handleInput();

    if (selectedBlockId !== null && selectedBlockId !== undefined) {
        selectDrawingBlock(selectedBlockId);
    }
}

/* Re-read the selected drawing after a return from the drawing workspace. */
export function refreshSolutionSelection({ selectedBlockId: blockId } = {}) {
    if (blockId !== undefined) {
        setSelectedDrawingBlock(blockId);
    }

    renderDrawingBlocks(nodes.editor, blockLayerOptions());

    syncDrawingSelection();

    decoratePreview(selectedDrawingBlock());

    updateDrawingActions();

    /*
     * THE DRAWING MAY HAVE CHANGED WHILE IT WAS OPEN.
     *
     * Returning is the moment the student expects the figure to show what they
     * drew, so the preview is re-rendered now - keeping the page where it was,
     * and keeping the selected drawing highlighted in it.
     */
    if (compileTimer) {
        clearTimeout(compileTimer);
        compileTimer = null;
    }

    compileNow({ keepScroll: true });
}

/*
 * THE DOCUMENT'S DRAWINGS, FOR THE COMPILED .tex.
 *
 * Each block is resolved to the sheet it names: its number in the document, its
 * name, and its current LaTeX. This is the ONE place the export learns what a
 * `\datumdrawing{...}` command contains, so what is exported is the drawing as
 * it stands at the moment of export - never a copy taken when it was placed.
 */
export function solutionDrawingSources() {
    const drawings = {};

    let blocks;

    try {
        blocks = parseDrawingBlocks(enggSolutionState.getSource());
    } catch (error) {
        blocks = [];
    }

    blocks.forEach((block, index) => {
        if (drawings[block.drawingId]) {
            return;
        }

        let sheet;

        try {
            sheet = enggDrawingSheets.sheetById(block.drawingId);
        } catch (error) {
            sheet = null;
        }

        if (!sheet) {
            return;
        }

        let latex;

        try {
            latex = readSheetLatex(sheet);
        } catch (error) {
            latex = "";
        }

        drawings[block.drawingId] = {
            number: index + 1,
            name: sheet.name || "",
            latex
        };
    });

    return drawings;
}

export function refreshSolutionFiles() {
    renderFiles();
}

export function solutionZoomIn() {
    stepZoom(1);
}

export function solutionZoomOut() {
    stepZoom(-1);
}

const enggSolutionWorkspace = {
    attachDrawingHost,
    goToLine,
    installSolutionWorkspace,
    loadSolutionSource,
    refreshSolutionFiles,
    refreshSolutionSelection,
    removeDrawingSelection,
    replaceSolutionSource,
    revealSelectedDrawingInPreview,
    selectDrawingBlock,
    setLayoutMode,
    setSolutionChangeHandler,
    setSolutionStatusListener,
    showSaveStatus,
    solutionDrawingSources
};

export default enggSolutionWorkspace;
