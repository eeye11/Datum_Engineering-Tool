/*
 * ============================================================
 * THE SOURCE TAB
 * ============================================================
 *
 * The Source pane: the current drawing's LaTeX/TikZ, editable, with a live
 * preview, diagnostics and a status line.
 *
 * WHAT IT SHOWS.
 *
 * The DRAWING SOURCE - the `\begin{tikzpicture}` that generates this sheet and
 * nothing else. Not the renderer's wrapper (the document class and packages are
 * the server's and are not the drawing), and not a tool's template. It is the
 * same source the object model writes into and the same source that is saved
 * with the document.
 *
 * THE COMPLETE DOCUMENT, ALWAYS.
 *
 * The editor is never handed a selection's code, a fragment or a generated
 * preview. Selecting an object on the canvas SCROLLS this editor to its block and
 * bands it; every other line stays on screen and editable. That is the whole
 * reason the pane can be trusted as "the drawing".
 *
 * HOW AN EDIT REACHES THE CANVAS.
 *
 *   typed  ->  source manager's draft      (60 ms coalesced)
 *          ->  parse: validation, ranges   (cheap; one pass per revision)
 *          ->  objects updated / created   (supported statements only)
 *          ->  render request              (the canvas owns the compile)
 *          ->  success: adopt the render
 *              failure: keep the draft, keep the last drawing, say why
 *
 * THE DRAFT IS NEVER DISCARDED ON A FAILURE, and it is never "repaired". A
 * student who breaks a brace and fixes it has lost nothing, and a student who
 * leaves a half-typed command keeps it exactly as typed - the object it belonged
 * to keeps its last valid shape until the command is whole again.
 *
 * SYNCHRONIZATION WITH THE SELECTION.
 *
 *   - When the drawing's selection changes, this pane bands the selected
 *     object's region and scrolls to it - without stealing focus, so a student
 *     typing in Source is not interrupted by a selection made on the canvas.
 *   - When the student selects text in the editor that sits inside one object's
 *     block, the drawing's selection follows. A selection that crosses blocks,
 *     or that is only a caret, selects nothing.
 *
 * Both directions record the fact that they are propagating a selection, so the
 * announce -> sync -> announce loop cannot run.
 */

import { activeSourceManager } from "../../../shared/rendering/latex/drawing-source-manager.js";
import { sourceGenerationProblems } from "../../../shared/rendering/latex/source-diagnostics.js";
import { parseDrawingSource, isObjectMarkerLine, isObjectNameComment } from "../../../shared/rendering/latex/drawing-source.js";
import {
    adoptUnclaimedStatements,
    adoptFollowedStatements,
    removeObjectBlock,
    sourceForObjectRegion
} from "../../../shared/rendering/latex/source-object-sync.js";
import { applyParsedSourceToDrawing } from "../../../shared/rendering/latex/source-model-apply.js";
import { sourceForObject, writeObjectIntoSource } from "../../../shared/rendering/latex/source-synchronization.js";
import { activePanelTab, setActivePanelTab } from "./panel-tabs.js";
import { createSourceEditor } from "./source-editor.js";
import { drawingState } from "../../../features/workspace/editor-state.js";
import enggDrawingState from "../../../shared/model/drawing-state.js";
import { FILE_ACTIONS } from "../../../features/workspace/commands/document-commands.js";
import { setSourceEditorProvider, setSourceRefreshHandler, setSourceRenderRequest } from "../../../features/workspace/commands/source-commands.js";
import { performRedo, performUndo } from "../toolbar/tool-activation.js";
import { currentCompiledPicture, requestSourceRender } from "../workspace/canvas-render.js";

let editor = null;
let host = null;
let statusEl = null;
let diagnosticsEl = null;
let findBar = null;
let unsubscribe = null;

function element(id) {
    return globalThis.document.getElementById(id);
}

/* ============================================================
 * THE STATUS BAR
 * ============================================================
 *
 * ONE LINE, and it is TWO FACTS, never confused with one another:
 *
 *     the DRAFT      Saved | Saving | Unsaved | Save failed
 *     the DRAWING    Up to date | Updating | N errors | N warnings | Render failed
 *
 * Joined as "Saved \u00B7 Up to date". They are separate because they are separate
 * truths: a draft can be SAVED and contain two errors, and saying "saved, but
 * broken" as one phrase would suggest the save failed too. Saving and rendering
 * never block each other, and this line is the only place that reports either.
 *
 * NOTHING HERE IS AN ERROR UNLESS ONE EXISTS:
 *
 *   - an empty drawing is "Saved \u00B7 Up to date", not a problem;
 *   - an old render failure is not shown - the manager keys failures by revision,
 *     so a failure only survives while the revision it was about is current;
 *   - "Up to date" is only said once the CURRENT revision has been rendered, and
 *     "Updating" while it has not, so a successful render of older text can never
 *     be reported as if it were the latest.
 *
 * The message is short by design. The individual problems are in the diagnostic
 * list below it, where each row can be clicked.
 */
function setStatus(kind, text, detail = "") {
    if (!statusEl) {
        return;
    }

    statusEl.className = `drawing-source-status ${kind ? `is-${kind}` : ""}`.trim();
    statusEl.textContent = text;
    statusEl.setAttribute("data-status", kind || "");
    statusEl.title = detail || text;
}

/* The draft half of the status line. */
function savePart(snapshot) {
    switch (snapshot.saveStatus) {
        case "saving":
            return { text: "Saving", kind: "saving" };
        case "error":
            return { text: "Save failed", kind: "save-error" };
        case "pending":
            return { text: "Unsaved", kind: "pending" };
        default:
            return { text: "Saved", kind: "ok" };
    }
}

/*
 * The drawing half.
 *
 * THE ORDER IS THE ORDER OF AUTHORITY: an unsatisfied CURRENT revision is
 * "Updating" whatever else is true, because the picture on screen is not this
 * text yet. Only once the current revision has been dealt with does the count of
 * problems - or the failure - describe it.
 */
function renderPart(snapshot, analysis) {
    const errors = analysis.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
    const warnings = analysis.diagnostics.filter(
        (diagnostic) => diagnostic.severity === "warning" && diagnostic.kind === "unsupported"
    ).length;

    if (snapshot.renderStatus === "rendering" || snapshot.renderStatus === "pending") {
        return { text: errors ? `Updating \u00B7 ${errors} error${errors === 1 ? "" : "s"}` : "Updating", kind: "rendering" };
    }

    if (snapshot.lastError) {
        return { text: "Render failed", kind: "failed" };
    }

    if (errors) {
        return { text: `${errors} error${errors === 1 ? "" : "s"}`, kind: "error" };
    }

    if (warnings) {
        return { text: "Unsupported features", kind: "ok" };
    }

    return { text: "Up to date", kind: "ok" };
}

function renderStatus(analysis) {
    const manager = activeSourceManager();
    const snapshot = manager.snapshot();

    const save = savePart(snapshot);
    const render = renderPart(snapshot, analysis);

    const kind = save.kind === "save-error" || render.kind === "error" ? "error" : render.kind;

    const detail = [
        snapshot.lastError ? `Renderer: ${snapshot.lastError}` : "",
        snapshot.saveError ? `Save: ${snapshot.saveError}` : "",
        analysis.diagnostics.length ? `${analysis.diagnostics.length} diagnostic(s)` : ""
    ]
        .filter(Boolean)
        .join("\n");

    setStatus(kind, `${save.text} \u00B7 ${render.text}`, detail);
}

/* ============================================================
 * DIAGNOSTICS
 * ============================================================
 *
 * Only what is real. An empty document shows none: the tab opens on instructions,
 * not on a complaint.
 *
 * Each row carries the line and, when the parser knows it, the column - and a
 * click moves the editor there and selects the code. Warnings are visually
 * distinct from errors, and a renderer failure from both.
 */
function escapeHtml(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function columnOf(row) {
    if (!globalThis.document) {
        return null;
    }

    const text = activeSourceManager().getSource();
    const lineStart = row.start === null || row.start === undefined ? null : text.lastIndexOf("\n", row.start - 1) + 1;

    return lineStart === null ? null : (row.start - lineStart) + 1;
}

function renderDiagnostics(analysis) {
    if (!diagnosticsEl) {
        return;
    }

    /*
     * THE EDITOR'S RED DECORATIONS COME FROM THE SAME DIAGNOSTICS as this list.
     *
     * The ranges are CANONICAL offsets (the text with its object markers), and
     * the editor works in the VISIBLE text, so each end is translated here -
     * the two differ only by whole marker lines, and the manager owns that
     * translation. Doing it in one place is what keeps the soft-red band on the
     * statement that caused it, and off every line around it.
     */
    if (editor) {
        const manager = activeSourceManager();
        const toVisible = (offset) => manager.canonicalOffsetForVisibleOffset(offset);

        editor.setErrorRanges(
            analysis.diagnostics
                .filter(
                    (row) =>
                        row.severity === "error" &&
                        row.start !== null &&
                        row.start !== undefined &&
                        row.end !== null &&
                        row.end !== undefined
                )
                .map((row) => ({ start: toVisible(row.start), end: toVisible(row.end) }))
        );
    }

    const snapshot = activeSourceManager().snapshot();
    const rows = [...analysis.diagnostics];

    /*
     * AN OBJECT THAT HAS NO SOURCE IS NAMED HERE. It is in the drawing's model
     * but its writer had to leave it out, so neither this editor nor the canvas
     * shows it - and without this line nothing would say why.
     */
    sourceGenerationProblems().forEach((problem) => {
        rows.push({
            severity: "warning",
            kind: "generation",
            message: `"${problem.name || problem.type || problem.id}" could not be written into the source: ${problem.message}`,
            line: null
        });
    });

    /*
     * A RENDERER FAILURE IS ITS OWN KIND. It is not a syntax error - the parser
     * found nothing wrong - and marking it as one would put red lines on every
     * statement the engine happened to be reading when it stopped.
     */
    if (snapshot.lastError) {
        rows.push({
            severity: "renderer",
            kind: "renderer",
            message: `The renderer reported: ${snapshot.lastError}. Your source and the last drawing that worked are kept.`,
            line: null
        });
    }

    if (!rows.length) {
        diagnosticsEl.hidden = true;
        diagnosticsEl.replaceChildren();

        return;
    }

    diagnosticsEl.hidden = false;
    diagnosticsEl.innerHTML = rows
        .map((row, index) => {
            const line = row.line === null || row.line === undefined ? "" : String(row.line);
            const column = row.line === null || row.line === undefined ? null : columnOf(row);
            const location = column ? `L${line}:${column}` : line ? `L${line}` : "";

            return (
                `<button type="button" class="drawing-source-diagnostic is-${escapeHtml(row.severity)}" ` +
                `data-diagnostic-index="${index}" data-line="${escapeHtml(line)}" ` +
                `title="${escapeHtml(row.message)}">` +
                `<span class="drawing-source-diagnostic-line">${escapeHtml(location || "\u2014")}</span>` +
                `<span class="drawing-source-diagnostic-text">${escapeHtml(row.message)}</span>` +
                `</button>`
            );
        })
        .join("");

    /* The rows are kept for the click handler, which needs the ranges. */
    diagnosticsEl.__rows = rows;
}

/* ============================================================
 * THE EMPTY STATE
 * ============================================================
 *
 * A fresh sheet has nothing to draw, and that is not a problem - it is the
 * beginning. So the pane says how to start rather than reporting an error.
 */
function renderEmptyState(analysis) {
    if (!host) {
        return;
    }

    const isEmpty = analysis.validation.empty || !/\\[A-Za-z]/.test(analysis.source);

    host.dataset.empty = isEmpty ? "true" : "false";
}

/* ============================================================
 * SEARCH
 * ============================================================
 *
 * The editor has no find bar in the markup and the application has no document
 * search, so this is the one it needs: a small field at the foot of the pane,
 * opened with Ctrl+F, that highlights a match and moves the caret to it.
 */
function ensureFindBar() {
    if (findBar || !host) {
        return findBar;
    }

    const bar = globalThis.document.createElement("div");

    bar.className = "drawing-source-find";
    bar.hidden = true;
    bar.innerHTML =
        `<input type="search" class="drawing-source-find-input" aria-label="Find in source" placeholder="Find" />` +
        `<span class="drawing-source-find-count"></span>` +
        `<button type="button" class="drawing-source-find-next" title="Next match (Enter)">Next</button>`;

    host.append(bar);

    const input = bar.querySelector("input");

    input?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            findNext(event.shiftKey ? -1 : 1);
        }

        if (event.key === "Escape") {
            event.preventDefault();
            closeFind();
        }
    });

    input?.addEventListener("input", () => findNext(0));

    bar.querySelector("button")?.addEventListener("click", () => findNext(1));

    findBar = bar;

    return findBar;
}

let findIndex = -1;

function findNext(direction) {
    if (!editor) {
        return;
    }

    const query = findBar?.querySelector("input")?.value || "";

    const matches = [];

    if (query) {
        const text = editor.getValue();
        const needle = query.toLowerCase();
        const haystack = text.toLowerCase();

        let at = haystack.indexOf(needle);

        while (at >= 0 && matches.length < 500) {
            matches.push({ start: at, end: at + query.length });
            at = haystack.indexOf(needle, at + Math.max(1, query.length));
        }
    }

    const count = findBar?.querySelector(".drawing-source-find-count");

    if (!matches.length) {
        findIndex = -1;
        editor.setSearchRange(null);

        if (count) {
            count.textContent = query ? "no matches" : "";
        }

        return;
    }

    if (direction === 0) {
        /* Keep the current match if it is still a match. */
        findIndex = Math.max(0, matches.findIndex((match) => match.start >= editor.caretOffset()));

        if (findIndex < 0) {
            findIndex = 0;
        }
    } else {
        findIndex = (findIndex + (direction > 0 ? 1 : -1) + matches.length) % matches.length;
    }

    const match = matches[findIndex];

    editor.setSearchRange(match);
    editor.selectRange(match.start, match.end);

    if (count) {
        count.textContent = `${findIndex + 1} of ${matches.length}`;
    }
}

function openFind() {
    const bar = ensureFindBar();

    if (!bar) {
        return;
    }

    bar.hidden = false;
    bar.querySelector("input")?.focus();
    bar.querySelector("input")?.select();
}

function closeFind() {
    if (!findBar) {
        return;
    }

    findBar.hidden = true;
    editor?.setSearchRange(null);
    editor?.focus();
}

/* ============================================================
 * SELECTION SYNC
 * ============================================================
 *
 * Both directions announce a selection, so both must be able to tell "this came
 * from me" - otherwise canvas -> source -> canvas would repeat forever. A short
 * lock is used rather than comparing ids, because the ids legitimately end up
 * equal on both sides and a comparison cannot tell a loop from a coincidence.
 */
let selectionSource = null;
let selectionBounceTimer = null;

function withSelectionOrigin(origin, action) {
    selectionSource = origin;

    if (selectionBounceTimer) {
        clearTimeout(selectionBounceTimer);
    }

    selectionBounceTimer = setTimeout(() => {
        selectionSource = null;
        selectionBounceTimer = null;
    }, 120);

    try {
        action();
    } finally {
        /* The flag is cleared by the timer, not here: the event is synchronous
         * but a listener may queue follow-up work in the same turn. */
    }
}

/* The ids of every selected object, in document order. */
function selectedObjectIds() {
    const ids = drawingState.selection?.selectedObjectIds;

    if (!ids) {
        return [];
    }

    return [...ids];
}

/*
 * THE VISIBLE LINE RANGE OF AN OBJECT'S BLOCK.
 *
 * Regions are found by the object's MARKER in the canonical text, then
 * translated to the visible lines the editor draws (the markers themselves are
 * not shown). This is what makes the band land on the code and only on the code.
 */
export function visibleRegionForObject(objectId) {
    const manager = activeSourceManager();
    const canonical = manager.getSource();
    const visible = manager.getVisibleSource();

    const block = parseDrawingSource(canonical).find((entry) => entry.id === objectId);

    if (!block) {
        return null;
    }

    /*
     * THE BLOCK'S READABLE HEADER, `% DAETUM OBJECT: Pipe 1`.
     *
     * A block's header is the run of comment lines above its first command, and
     * the OBJECT line inside it is the ONE line of the header the editor SHOWS -
     * so it is the line the hidden object's eye belongs beside. Only Lines that
     * exist in the canonical text and are comment lines are considered, so a
     * legacy BEGIN marker (which has no readable name) falls back to the first
     * command line rather than to a header the editor never draws.
     */
    const canonicalLines = canonical.replace(/\r\n/g, "\n").split("\n");

    const nameAt = block.lines.findIndex((line) => isObjectNameComment(line));
    const headerCanonical = nameAt < 0 ? -1 : block.beginLine + nameAt;

    /*
     * EVERY HEADER LINE IS INVISIBLE IN THE EDITOR - not just the legacy pair.
     *
     * A block's header is a run of `% DAETUM OBJECT/ID/TYPE` comments (the
     * READABLE form every writer emits now) and may also be a legacy
     * BEGIN/END pair. Counting only the legacy markers left the highlight band
     * shifted down by the header's height, so selecting an object lit the wrong
     * commands - and with a three-line header it landed on the NEXT object.
     *
     * `isObjectMarkerLine` is the parser's own answer to "is this a header?", so
     * the band and the block boundaries cannot disagree.
     */
    const markerLines = (from, to) => canonicalLines.slice(from, to).filter(isObjectMarkerLine).length;

    /* One-based visible line numbers. */
    const beginLine = block.beginLine + 1 - markerLines(0, block.beginLine);
    const endLine = Math.max(
        beginLine,
        block.endLine + 1 - markerLines(0, block.endLine) - (block.unclosed ? 0 : 1)
    );

    const visibleLines = visible.split("\n").length;

    return {
        beginLine: Math.max(1, Math.min(beginLine, visibleLines)),
        endLine: Math.max(1, Math.min(endLine, visibleLines)),
        /*
         * The header's own visible line, for the hidden state's gutter mark. A
         * block with no readable header keeps the eye on its first line, so the
         * mark never disappears - the block is recognised by the model, not by
         * the wording of a comment.
         */
        headerLine:
            headerCanonical < 0
                ? Math.max(1, Math.min(beginLine, visibleLines))
                : Math.max(1, Math.min(headerCanonical + 1 - markerLines(0, headerCanonical), visibleLines))
    };
}

/*
 * THE BLOCKS OF THE OBJECTS THAT ARE HIDDEN.
 *
 * `visible: false` is the model's one convention for a hidden object, and the
 * canvas already draws nothing for it. This is the Source tab's half of the same
 * fact: the block is still in the text - the text is what is saved - so it is
 * marked as hidden rather than removed, and marked DECORATIVELY, so its comment
 * colour, its code and its copy behaviour are exactly as they are.
 *
 * A block whose region cannot be found is simply not decorated.
 */
function hiddenObjectRegions() {
    return (drawingState.objects || [])
        .filter((object) => object && object.visible === false)
        .map((object) => visibleRegionForObject(object.id))
        .filter(Boolean);
}

/*
 * Canvas -> source. Called when the drawing's selection changes elsewhere - the
 * canvas, the Objects list, a keyboard shortcut.
 *
 * THE HIGHLIGHT IS ALWAYS SET; only the SCROLL is deferred to a visible tab, so
 * a student typing in Source is not interrupted by a selection made on the
 * canvas elsewhere.
 */
function syncHighlightFromSelection({ reveal = null } = {}) {
    if (!editor) {
        return;
    }

    const regions = selectedObjectIds()
        .map((id) => visibleRegionForObject(id))
        .filter(Boolean);

    editor.setHighlightedRegions(regions);
    editor.setHiddenRegions(hiddenObjectRegions());

    const shouldReveal =
        reveal === null
            ? Boolean(regions.length) &&
              activePanelTab() === "source" &&
              globalThis.document.activeElement !== editor.textarea
            : reveal;

    if (shouldReveal && regions.length) {
        editor.revealLine(regions[0].beginLine);
    }
}

/*
 * Source -> canvas. Called when the student selects text in the editor.
 *
 * A selection that sits wholly inside ONE object's block selects that object. A
 * selection that crosses a boundary is the student gathering code to copy, not
 * choosing an object, and guessing at it would fight them; a bare caret selects
 * nothing, so clicking a line does not change the drawing's selection.
 */
function syncSelectionFromSource(info) {
    if (!editor || selectionSource === "canvas" || !info) {
        return;
    }

    if (info.start === info.end) {
        return;
    }

    const manager = activeSourceManager();
    const source = manager.getSource();

    /* The editor's offsets are visible-text offsets; the markers are canonical. */
    const start = manager.canonicalOffsetForVisibleOffset(info.start);
    const end = manager.canonicalOffsetForVisibleOffset(info.end);

    const lineOf = (character) => source.slice(0, character).split("\n").length - 1;
    const blockAt = (line) =>
        parseDrawingSource(source).find((block) => line >= block.beginLine && line <= block.endLine) || null;

    const first = blockAt(lineOf(start));
    const last = blockAt(lineOf(Math.max(start, end - 1)));

    if (!first || !last || first.id !== last.id) {
        return;
    }

    const existing = selectedObjectIds();

    if (existing.length === 1 && existing[0] === first.id) {
        return;
    }

    /* The object must still exist; a block may outlive its object. */
    if (!(drawingState.objects || []).some((object) => object.id === first.id)) {
        return;
    }

    withSelectionOrigin("source", () => {
        enggDrawingState.selectObject(drawingState, first.id);
    });
}

/* ============================================================
 * SOURCE -> OBJECTS
 * ============================================================
 *
 * The parse has already run (the manager caches it per revision). This applies
 * its result to the drawing:
 *
 *   - a supported statement updates or creates its object
 *   - an unsupported one leaves the object's last valid form in place
 *   - an unfinished one does the same, and creates nothing new
 *   - a block that is really gone removes its object
 *
 * NOTHING HERE RECORDS HISTORY. Typing in Source is one action; the undo entry
 * is the edit, recorded by the tab's own history entry, not one per object.
 */
/*
 * THE TEXT ADOPTION READS.
 *
 * Adoption sees WHAT THE STUDENT TYPED, not what the manager stored. The stored
 * text is already the result of an earlier restore, so reading it back would
 * re-wrap DAETUM's own previous output - which is how a picture acquired a
 * blank line on every keystroke. A caller with no recorded edit (a reopened
 * document) falls back to the stored source, which is then the student's text.
 */
function adoptionBasis(manager) {
    return manager.getTypedSource() || manager.getSource();
}

/*
 * THE CARET'S LINE, IN THE TEXT ADOPTION READS.
 *
 * The editor shows the text with the machinery headers stripped, so the caret's
 * line in what the student sees is NOT the same line in the canonical text. This
 * maps it through the manager's own visible<->stored correspondence - the same
 * one the editor uses to place the caret after an adoption - so a command is
 * claimed only when the student is actually in it.
 */
function caretLineIn(manager) {
    const editor = document.querySelector("#drawingSourceEditor textarea");

    if (!editor || typeof editor.selectionStart !== "number") {
        return null;
    }

    /**
     * THE CARET SITS WHERE THE STUDENT LEFT IT.
     *
     * The Source editor keeps the caret while the pane is showing it, and the
     * pane's own refresh does not move it - so the caret is the student's
     * position even when the document's focus has gone to a button in the same
     * pane. A caret at the very end is where typing goes next: that is where the
     * next command will be, so the LAST command is the one being written.
     */
    const visibleLine = editor.value.slice(0, editor.selectionStart).split("\n").length - 1;

    /**
     * THE LINE THE STUDENT'S CARET IS ON, IN THE SOURCE.
     *
     * The editor's text has the headers stripped, so its line numbering and the
     * source's differ. The manager owns that correspondence; when it does not
     * expose it, the line is used as it stands - which is right for the very
     * first command, the one a student types.
     */
    if (typeof manager.visibleLineToSourceLine === "function") {
        const mapped = manager.visibleLineToSourceLine(visibleLine);

        if (Number.isFinite(mapped)) {
            return mapped;
        }

        return null;
    }

    return visibleLine;
}

/*
 * A WHOLE PICTURE ARRIVING AT ONCE.
 *
 * When the student PASTES or OPENS a picture - no caret in the editor, or a
 * change far larger than a keystroke - every unclaimed command in it is adopted,
 * so the whole picture becomes editable. That is the case adoption exists for.
 */
function adoptWholePicture(manager, candidates) {
    const basis = adoptionBasis(manager);

    const adopted = adoptUnclaimedStatements(basis, { candidates });

    if (adopted === manager.getSource() || parseDrawingSource(adopted).length === 0) {
        return null;
    }

    return adopted;
}

/*
 * WHICH ADOPTION THIS DRAFT EARNS, AND THE TEXT IT WROTE.
 *
 * Returns the source to store, or null when none of it could be adopted - so the
 * caller writes a block only when adoption really changed something.
 *
 * THE CARET DECIDES HOW MUCH IS THE STUDENT'S NEW CODE:
 *
 *   caret inside a command   THAT COMMAND is adopted; the rest of the picture is
 *                            left exactly as written, so typing grows the model
 *                            one editable feature at a time.
 *
 *   no caret in the editor   the student threw a picture at the drawing - pasted
 *                            it, or opened a file - and every unclaimed command
 *                            in it is adopted, so the whole picture is editable.
 *
 * Adoption itself refuses an empty picture, one that will not compile, and one
 * that already carries DAETUM's own blocks (see `adoptUnclaimedStatements`).
 */
export function newVoiceAdopt(manager, candidates) {
    const basis = adoptionBasis(manager);
    const caret = caretLineIn(manager);

    /**
     * A PICTURE WITH NO BLOCKS IS ADOPTED WHOLE - that is the case this exists
     * for: nothing in it could be clicked on the canvas.
     */
    const whole = adoptWholePicture(manager, candidates);

    if (whole !== null) {
        return whole;
    }

    /**
     * AND A LINE TYPED INTO AN EXISTING DRAWING IS ADOPTED AT THE CARET, so what
     * the student writes becomes a feature they can click, drag and delete.
     */
    if (!Number.isFinite(caret)) {
        return null;
    }

    return adoptFollowedStatements(basis, { caretLine: caret, candidates });
}

/**
 * ADOPTION IS FOR A PICTURE THAT HAS NO BLOCKS AT ALL.
 *
 * A source that already carries DAETUM object blocks is the document's own:
 * its commands belong to the objects those blocks name, so anything outside them
 * is preserved VERBATIM. And a picture still being typed is left alone: one that
 * will not compile cannot be adopted without rewriting text the model only half
 * understands, and the student's latest text is never rewritten.
 */

function applySourceToObjects() {
    const manager = activeSourceManager();

    /*
     * HAND-TYPED TIKZ BECOMES EDITABLE - ONCE PER DRAFT.
     *
     * A picture with no object blocks at all - typed, pasted, or a `.tex`
     * opened from elsewhere - has no ids, so nothing in it could be clicked on
     * the canvas. Its unclaimed commands are adopted into blocks HERE, before
     * the parse, so the objects below are created by the ordinary path. The
     * markers are bookkeeping: the editor never shows them, and the student's
     * commands are left character for character.
     *
     * `adoptedRevision` is what stops it running twice on one draft. The first
     * pass writes blocks around the commands; a second pass would find the same
     * commands now inside blocks and do nothing - but a pass after the student
     * edits would wrap their edit a second time if the guard were absent.
     */
    if (adoptedRevision !== manager.revision()) {
        adoptedRevision = manager.revision();
        /*
         * THE OBJECTS THAT HAVE NO BLOCK IN THE TEXT are the ones an unclaimed
         * command may claim, by saying exactly what that object's code says. A
         * command that matches none of them is a genuinely new shape.
         */
        const mapped = new Set(parseDrawingSource(manager.getSource()).map((block) => block.id));

        const candidates = (drawingState.objects || [])
            .filter((object) => !mapped.has(object.id))
            .map((object) => ({
                id: object.id,
                type: object.type,
                object,
                source: sourceForObject(object, { state: drawingState, allObjects: drawingState.objects }),
                taken: false
            }))
            .filter((candidate) => typeof candidate.source === "string" && candidate.source.trim());

        /**
         * WHICH ADOPTION THIS DRAFT EARNS, AND THE TEXT IT WROTE.
         *
         *   A PICTURE WITH NO BLOCKS   every unclaimed command is the student's
         *                              new code, and each becomes its own object -
         *                              so a picture typed or pasted whole is
         *                              editable on the canvas.
         *
         *   A LINE TYPED INTO A
         *   DRAWING THAT HAS BLOCKS    the command under the caret is adopted, so
         *                              what the student is writing becomes a
         *                              feature they can click, drag and delete.
         *
         * Adoption itself refuses a picture that will not compile (see
         * `adoptUnclaimedStatements`), so a draft DAETUM cannot improve on is
         * returned unchanged and its text stays exactly as typed.
         */
        const basis = adoptionBasis(manager);

        const caret = caretLineIn(manager);

        /*
         * A PICTURE WITH NO BLOCKS IS ADOPTED WHOLE, and that is the case this
         * exists for: nothing in it could be clicked on the canvas, so its
         * commands are wrapped and become objects. The caret only decides which
         * command is the student's NEW one once there are blocks to distinguish
         * it from.
         */
        const hasBlocks = parseDrawingSource(manager.getSource()).length > 0;

        const followed =
            hasBlocks && Number.isFinite(caret)
                ? adoptFollowedStatements(basis, { caretLine: caret, candidates })
                : adoptUnclaimedStatements(basis, { candidates });

        if (followed !== basis && parseDrawingSource(followed).length > 0) {
            manager.setSource(followed, { origin: "adopt" });
        }
    }

    const analysis = manager.analysis();

    if (analysis.validation.empty) {
        return null;
    }

    const result = applyParsedSourceToDrawing({
        model: enggDrawingState,
        state: drawingState,
        source: analysis.source,
        /*
         * AN EDIT NEVER REMOVES AN OBJECT.
         *
         * Typing is not a deletion. A block that is momentarily absent from the
         * text while the source is half-written must NOT take its object with
         * it - and a picture being retyped from scratch is not a request to
         * delete everything the canvas holds. The objects a draft can change are
         * therefore created and updated here, and removal belongs to the one
         * path that knows a removal was meant: deleting the object on the canvas,
         * which writes the source through `syncSourceWithDrawing`.
         */
        editable: true,
        removeMissing: false
    });

    if (result.changed && !result.invalid.length && result.reducerSyncIds?.length) {
        const ids = new Set([...result.reducerSyncIds, ...result.updated]);
        drawingState.objects.filter(object => ids.has(object.id)).forEach(object => {
            writeObjectIntoSource(manager, object, { state: drawingState, allObjects: drawingState.objects });
        });
    }

    if (result.changed) {
        /*
         * THE DRAWING CHANGED, SO EVERYTHING THAT FOLLOWS IT UPDATES: the
         * Objects list, the Features panel, the canvas overlay. This is the same
         * announcement a canvas edit makes.
         */
        globalThis.document.dispatchEvent(
            new (globalThis.document.defaultView?.CustomEvent || Event)("datum:drawing-changed")
        );
    }

    /*
     * ANY OBJECT THE NEW CODE DOES NOT NAME IS SIMPLY LEFT ALONE. It stays on
     * the canvas - the overlay draws every object the picture does not show - and
     * nothing is appended to the text the student is typing.
     */

    return result;
}

/* ============================================================
 * HISTORY
 * ============================================================
 *
 * THE EDITOR'S OWN UNDO IS THE TEXTAREA'S, and the canvas's history is the
 * model's. A source edit must NOT create a canvas history entry per keystroke -
 * but an undo after a source edit must put the text back.
 *
 * The rule: an undo or redo from the menu, the toolbar or a shortcut is asked of
 * the ROUTE THAT LAST CHANGED SOMETHING. The text is restored by the manager
 * (which is the document), and the objects are then brought into step with the
 * restored text by the ordinary parse - not by replaying a model snapshot.
 */
let lastOrigin = "load";

/*
 * The draft on which unclaimed hand-typed commands were last adopted into
 * blocks, by revision - so adoption runs once per edit, not once per reader.
 */
let adoptedRevision = null;

export function performSourceUndo() {
    if (!editor) {
        return false;
    }

    if (lastOrigin === "source") {
        editor.undoText();
        return true;
    }

    performUndo();
    return true;
}

export function performSourceRedo() {
    if (!editor) {
        return false;
    }

    if (lastOrigin === "source") {
        editor.redoText();
        return true;
    }

    performRedo();
    return true;
}

/* ============================================================
 * BUILD AND WIRE
 * ============================================================ */

export function renderSourceTab() {
    host = host || element("drawingSourceEditor");
    statusEl = statusEl || element("drawingSourceStatus");
    diagnosticsEl = diagnosticsEl || element("drawingSourceDiagnostics");

    if (!host) {
        return;
    }

    if (!editor) {
        editor = createSourceEditor(host, {
            /*
             * THE TEXT THE STUDENT SEES GOES INTO THE MANAGER THROUGH
             * `setVisibleSource`, which re-attaches the object markers from the
             * previous canonical source - so an ordinary edit keeps each
             * object's region findable, and their own code is what is stored.
             */
            onChange(text) {
                const manager = activeSourceManager();

                if (!manager.setVisibleSource(text, { origin: "source" })) {
                    return;
                }

                lastOrigin = "source";

                /*
                 * PARSE FIRST, THEN APPLY. The manager's analysis is the one
                 * parse of this revision; the objects, the diagnostics and the
                 * status all read it rather than parsing again.
                 */
                /*
                 * APPLY FIRST - it may adopt hand-typed statements into blocks,
                 * which changes the source - THEN READ THE ANALYSIS of whatever
                 * the source now is.
                 */
                applySourceToObjects();

                /*
                 * THE EDITOR SHOWS A NEW STORED FORM ONLY WHEN ADOPTION MADE ONE.
                 *
                 * Adoption turns hand-typed commands into blocks, so the stored
                 * text is the student's code with its headers and the editor must
                 * take that back. An ORDINARY KEYSTROKE changes nothing but the
                 * draft, and re-assigning the stored form there reset the caret
                 * and the browser's undo stack under the student - so the refresh
                 * is limited to the case that needs it: the draft had no blocks
                 * at all and adoption has just created them.
                 */
                const stored = manager.getVisibleSource();

                if (
                    editor &&
                    stored !== editor.getValue() &&
                    parseDrawingSource(editor.getValue()).length === 0
                ) {
                    editor.setValue(stored, { preserveCaret: true });
                }

                const analysis = manager.analysis();

                renderDiagnostics(analysis);
                renderStatus(analysis);
                renderEmptyState(analysis);

                /* The canvas owns the compile; this only asks it to be prompt. */
                requestSourceRender({ immediately: true });

                /* And the draft is saved, whether or not it renders. */
                FILE_ACTIONS.autosaveDraft?.();
            },
            onSelectionChange(info) {
                syncSelectionFromSource(info);
            },
            onFindRequest() {
                openFind();
            },
            onSaveRequest() {
                FILE_ACTIONS.save();
            },
            onUndoRequest() {
                editor?.undoText();
            },
            onRedoRequest() {
                editor?.redoText();
            },
            onEscape() {
                if (findBar && !findBar.hidden) {
                    closeFind();
                }
            }
        });

        editor.setValue(activeSourceManager().getVisibleSource(), { preserveCaret: false });
        ensureFindBar();
    }

    /*
     * THE STATUS AND THE DIAGNOSTICS ARE THEIR OWN SCROLL AREA. A sticky line at
     * the top of the pane and a bounded list at its foot must not scroll away
     * with the code, so the pane's flex column is told which parts take the
     * editor's overflow rather than sharing it.
     */
    host.parentElement?.classList.add("is-source-pane");

    if (statusEl) {
        statusEl.classList.add("is-pinned");

        if (!statusEl.title) {
            statusEl.title = "Editable TikZ source for the current sheet. Changes render as you type.";
        }
    }

    if (diagnosticsEl) {
        diagnosticsEl.classList.add("is-pinned");
    }

    const analysis = activeSourceManager().analysis();

    renderStatus(analysis);
    renderDiagnostics(analysis);
    renderEmptyState(analysis);
}

/*
 * Called by the panel's tab controller when this tab opens. The editor is filled
 * from the document's source so what is shown is the current drawing, and the
 * selection's code is scrolled to - the complete document is still there.
 */
export function onSourceTabOpened() {
    if (!editor) {
        renderSourceTab();
    }

    if (!editor) {
        return;
    }

    const manager = activeSourceManager();
    const visible = manager.getVisibleSource();

    if (visible !== editor.getValue()) {
        editor.setValue(visible);
    }


    syncHighlightFromSelection({ reveal: selectedObjectIds().length > 0 });

    const analysis = manager.analysis();

    renderStatus(analysis);
    renderDiagnostics(analysis);
    renderEmptyState(analysis);
}

/* ============================================================
 * INSTALL
 * ============================================================ */

export function installSourceTab() {
    const manager = activeSourceManager();

    if (unsubscribe) {
        unsubscribe();
    }

    unsubscribe = manager.subscribe(() => {
        if (!editor) {
            return;
        }

        const visible = manager.getVisibleSource();

        /*
         * ONLY RE-FILL WHEN SOMETHING ELSE CHANGED THE TEXT.
         *
         * This used to assign the value on EVERY manager notification - which
         * included the student's own typing - and each assignment reset the
         * caret and the browser's undo stack under them. A draft that already
         * equals what is shown is not touched.
         */
        if (visible !== editor.getValue()) {
            editor.setValue(visible, { preserveCaret: true });
            lastOrigin = "object";
        }

        const analysis = manager.analysis();

        renderStatus(analysis);
        renderDiagnostics(analysis);
        renderEmptyState(analysis);

        if (activePanelTab() === "source") {
            syncHighlightFromSelection();
        }
    });

    globalThis.document.addEventListener("datum:panel-tab-changed", (event) => {
        if (event.detail && event.detail.tab === "source") {
            onSourceTabOpened();
        }
    });

    /*
     * A SELECTION MADE ANYWHERE ARRIVES AS A DOCUMENT EVENT, so the pane does not
     * have to be wired into the canvas module directly and create a cycle.
     */
    globalThis.document.addEventListener("datum:selection-changed", (event) => {
        if (selectionSource === "source") {
            /* This selection came from here; do not bounce it back. */
            return;
        }

        const origin = event?.detail?.origin;

        if (origin === "source") {
            return;
        }

        syncHighlightFromSelection();
    });

    /*
     * THE CANVAS'S COMPILE OUTCOME. The tab reports it; it never hides the text.
     */
    globalThis.document.addEventListener("datum:source-rendered", () => {
        const analysis = manager.analysis();

        renderStatus(analysis);
        renderDiagnostics(analysis);
    });

    globalThis.document.addEventListener("datum:source-render-error", () => {
        const analysis = manager.analysis();

        renderStatus(analysis);
        renderDiagnostics(analysis);
    });

    globalThis.document.addEventListener("datum:source-generation-changed", () => {
        renderDiagnostics(manager.analysis());
    });

    globalThis.document.addEventListener("datum:source-save-status", () => {
        renderStatus(manager.analysis());
    });

    /*
     * A DRAWING CHANGED WHILE SOURCE IS OPEN. The regions may have moved - a new
     * object was appended, a deleted one's block is gone - so the band is
     * resolved again against the new text.
     */
    globalThis.document.addEventListener("datum:drawing-changed", () => {
        if (editor && activePanelTab() === "source") {
            syncHighlightFromSelection();
        }
    });

    /* Clicking a diagnostic moves the editor to it. */
    globalThis.document.addEventListener("click", (event) => {
        const row = event.target?.closest?.("[data-diagnostic-index]");

        if (!row || !diagnosticsEl || !diagnosticsEl.contains(row)) {
            return;
        }

        const diagnostic = (diagnosticsEl.__rows || [])[Number(row.dataset.diagnosticIndex)];

        if (!diagnostic) {
            return;
        }

        if (
            diagnostic.start !== null &&
            diagnostic.start !== undefined &&
            diagnostic.end !== null &&
            diagnostic.end !== undefined
        ) {
            /*
             * THE RANGES ARE IN CANONICAL OFFSETS. The editor works in visible
             * ones, so each end is translated - the difference is only whole
             * marker lines, and the translation is the one the manager already
             * owns.
             */
            const offset = (canonical) => {
                const visible = manager.getVisibleSource();
                const canonicalText = manager.getSource();

                let visibleOffset = 0;
                let lineStart = 0;

                while (lineStart <= canonicalText.length) {
                    const newline = canonicalText.indexOf("\n", lineStart);
                    const lineEnd = newline < 0 ? canonicalText.length : newline;
                    const line = canonicalText.slice(lineStart, lineEnd);
                    const isMarker = isObjectMarkerLine(line);

                    if (!isMarker) {
                        if (canonical >= lineStart && canonical <= lineStart + line.length) {
                            return visibleOffset + (canonical - lineStart);
                        }

                        visibleOffset += line.length + (newline < 0 ? 0 : 1);
                    }

                    if (newline < 0) {
                        break;
                    }

                    lineStart = newline + 1;
                }

                return Math.min(canonical, visible.length);
            };

            editor.selectRange(offset(diagnostic.start), offset(diagnostic.end));
            return;
        }

        if (diagnostic.line) {
            editor.revealLine(diagnostic.line);
            editor.focus();
        }
    });

    renderSourceTab();

    /*
     * THE FORMAT COMMAND NEEDS THE EDITOR, NOT THE OTHER WAY ROUND. The command
     * lives with the other application commands (and is reached from Tools), so
     * it asks for the editor through this registration rather than importing the
     * panel and closing a cycle.
     */
    setSourceEditorProvider(() => editor);
    setSourceRefreshHandler(() => refreshSourceSelection());
    setSourceRenderRequest((options) => requestSourceRender(options));
}

/*
 * The last SVG the source rendered, for a caller that needs to embed the current
 * drawing without rendering it again.
 */
export function lastRenderedSourceSvg() {
    return currentCompiledPicture();
}

/* Re-read the source into the editor - used after Undo/Redo. */
export function refreshSourceSelection() {
    if (!editor) {
        return;
    }

    const visible = activeSourceManager().getVisibleSource();

    if (visible !== editor.getValue()) {
        editor.setValue(visible);
    }

    syncHighlightFromSelection();
}

/* The object whose block a visible offset falls inside, for a caller. */
export function objectAtVisibleOffset(offset) {
    const manager = activeSourceManager();
    const canonical = manager.canonicalOffsetForVisibleOffset(offset);
    const source = manager.getSource();
    const line = source.slice(0, canonical).split("\n").length - 1;

    return (
        parseDrawingSource(source).find((block) => line >= block.beginLine && line <= block.endLine)?.id || null
    );
}

/* Export the pieces the Format command and the panel need. */
export { removeObjectBlock, sourceForObjectRegion };

export default {
    renderSourceTab,
    onSourceTabOpened,
    installSourceTab,
    refreshSourceSelection,
    lastRenderedSourceSvg,
    visibleRegionForObject,
    performSourceUndo,
    performSourceRedo,
    setActivePanelTab
};
