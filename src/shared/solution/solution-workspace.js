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
import { render } from "./written-references.js";
import { renderDrawingBlocks } from "./drawing-blocks-editor.js";

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

async function compileNow() {
    if (compiling) {
        return;
    }

    compiling = true;

    setCompileState("working", "Compiling…");

    try {
        /*
         * The renderer is the application's own: it splits the source at every
         * drawing reference, typesets the prose with MathJax and drops the live
         * sheet figures in place. Nothing about that is reimplemented here.
         */
        await render();

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
    }
}

function scheduleCompile() {
    if (compileTimer) {
        clearTimeout(compileTimer);
    }

    setCompileState("stale", "Preview out of date");

    compileTimer = setTimeout(() => {
        compileTimer = null;
        compileNow();
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
    const changed = enggSolutionState.setSource(nodes.editor.value);

    renderGutter();

    /*
     * THE COLLAPSE LAYER FOLLOWS THE TEXT. A keystroke can add, remove or
     * move a drawing block, so the chips are redrawn with the gutter - both
     * are derived views of the same value, and one path keeps them from
     * disagreeing.
     */
    renderDrawingBlocks(nodes.editor);

    if (changed) {
        renderOutline();
        scheduleCompile();
    }

    emitSolutionChange();
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

    nodes.editor.addEventListener("input", handleInput);
    nodes.editor.addEventListener("scroll", () => {
        syncGutterScroll();

        /* The chips are positioned against the text, so they scroll with it. */
        renderDrawingBlocks(nodes.editor);
    });

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

    enggSolutionState.setSource(nodes.editor.value);

    renderGutter();
    renderOutline();
    renderFiles();
    renderDrawingBlocks(nodes.editor);
    scheduleCompile();
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
    goToLine,
    installSolutionWorkspace,
    loadSolutionSource,
    refreshSolutionFiles,
    setLayoutMode,
    setSolutionChangeHandler,
    showSaveStatus
};

export default enggSolutionWorkspace;
