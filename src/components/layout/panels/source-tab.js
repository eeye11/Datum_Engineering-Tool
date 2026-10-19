/*
 * ============================================================
 * THE SOURCE TAB
 * ============================================================
 *
 * The Source pane: the current drawing's LaTeX/TikZ, editable, with a live
 * render and a status line.
 *
 * WHAT IT SHOWS.
 *
 * The DRAWING SOURCE - the `\begin{tikzpicture}` that generates this sheet and
 * nothing else. Not the renderer's wrapper (the document class and packages are
 * the server's and are not the drawing), and not a tool's template. It is the
 * same source the object model writes into and the same source that is saved
 * with the document, so what is on screen is what will be compiled and what will
 * be reopened.
 *
 * HOW AN EDIT REACHES THE CANVAS.
 *
 *   typed  ->  source manager's draft  ->  validate (cheap, on every change)
 *                                      ->  render (debounced)
 *                                      ->  success: adopt the render
 *                                          failure: keep the draft, keep the
 *                                                   last successful drawing
 *
 * The draft is NEVER discarded on a failure. A student who breaks a brace and
 * fixes it has lost nothing, because the text they typed was never replaced by
 * the model - it IS the document's source. This is the whole reason the source
 * is the document's own text and not a rendering of the model.
 *
 * SYNCHRONIZATION WITH SELECTION.
 *
 *   - When the drawing's selection changes, this pane highlights the selected
 *     object's region in the editor - without stealing focus, so a student
 *     typing in Source is not interrupted by a selection made on the canvas.
 *   - When the student selects text in the editor that falls inside one object's
 *     block, this pane tells the shared selection, so the canvas and the
 *     Properties tab follow.
 *
 * The tab's focus and its draft are preserved across tab switches: switching to
 * Properties does not clear the editor, because the editor's text lives in the
 * source manager and the editor is re-filled from it when the tab reopens.
 */

import { activeSourceManager } from "../../../shared/rendering/latex/drawing-source-manager.js";
import { objectIdAtLine } from "../../../shared/rendering/latex/source-mapping.js";
import { renderDrawingSource } from "../../../shared/rendering/latex/rendering-adapter.js";
import { validateDrawingSource, validationSummary } from "../../../shared/rendering/latex/source-validation.js";
import { drawingState } from "../../../features/workspace/editor-state.js";
import enggDrawingState from "../../../shared/model/drawing-state.js";
import { createSourceEditor } from "./source-editor.js";
import { activePanelTab } from "./panel-tabs.js";
import { setActivePanelTab } from "./panel-tabs.js";
import { refreshCanvasFromSource } from "./source-canvas-bridge.js";

/*
 * Rendering a drawing is expensive - the server runs TeX - so a keystroke does
 * not trigger a render. The pause is short enough that the preview feels live
 * and long enough that typing a word causes one render rather than five.
 */
const RENDER_DELAY_MS = 450;

let editor = null;
let host = null;
let statusEl = null;
let diagnosticsEl = null;
let renderTimer = null;
let renderToken = 0;
let lastRendered = null;
let unsubscribe = null;

function element(id) {
    return globalThis.document.getElementById(id);
}

/*
 * ============================================================
 * STATUS LINE
 * ============================================================
 */
function setStatus(kind, text) {
    if (!statusEl) {
        return;
    }

    statusEl.className = `drawing-source-status ${kind ? `is-${kind}` : ""}`.trim();
    statusEl.textContent = text;
    statusEl.setAttribute("data-status", kind || "");
}

function renderStatusFromManager(validation) {
    const manager = activeSourceManager();
    const result = validation || manager.validate();
    const summary = validationSummary(result);

    if (result && !result.ok) {
        setStatus("error", `TikZ source \u00B7 ${summary || "Invalid source"}`);

        return;
    }

    if (manager.lastError()) {
        setStatus("error", "TikZ source \u00B7 Render failed");

        return;
    }

    if (manager.isDirty()) {
        setStatus("dirty", "TikZ source \u00B7 Modified (not rendered)");

        return;
    }

    if (summary) {
        setStatus("ok", `TikZ source \u00B7 Rendered (${summary})`);

        return;
    }

    setStatus("ok", "TikZ source \u00B7 Rendered");
}

/*
 * ============================================================
 * DIAGNOSTICS
 * ============================================================
 */
function renderDiagnostics(validation) {
    if (!diagnosticsEl) {
        return;
    }

    const manager = activeSourceManager();
    const result = validation || manager.validate();

    const items = result ? [...(result.diagnostics || [])] : [];

    if (manager.lastError() && result && result.ok) {
        items.unshift({
            severity: "error",
            line: "\u2014",
            message: manager.lastError()
        });
    }

    if (!items.length) {
        diagnosticsEl.hidden = true;
        diagnosticsEl.innerHTML = "";

        return;
    }

    diagnosticsEl.hidden = false;
    diagnosticsEl.innerHTML = items
        .map((diagnostic) => {
            const line = diagnostic.line == null ? "" : String(diagnostic.line);

            return (
                `<div class="drawing-source-diagnostic is-${diagnostic.severity}">` +
                `<span class="drawing-source-diagnostic-line">${escapeHtml(line)}</span>` +
                `<span class="drawing-source-diagnostic-text">${escapeHtml(diagnostic.message)}</span>` +
                `</div>`
            );
        })
        .join("");
}

function escapeHtml(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/*
 * ============================================================
 * RENDERING
 * ============================================================
 *
 * The draft is rendered; on success the canvas adopts the result and the
 * manager records the version that worked. On failure the error is shown and
 * NOTHING ELSE changes - the canvas keeps its last successful drawing and the
 * editor keeps the text the student typed.
 */
async function renderCurrentDraft() {
    const manager = activeSourceManager();
    const draft = manager.getSource();
    const revision = manager.revision();

    const validation = validateDrawingSource(draft);

    renderDiagnostics(validation);

    if (!validation.ok) {
        /*
         * A draft that cannot compile is not sent. The renderer would return the
         * same answer more slowly, and the diagnostics already say why. The last
         * successful drawing stays on the canvas.
         */
        manager.markFailed(validation.diagnostics.find(d => d.severity === "error")?.message || "Invalid source");
        renderStatusFromManager(validation);

        return;
    }

    const token = (renderToken += 1);

    setStatus("rendering", "TikZ source \u00B7 Rendering\u2026");

    try {
        const svg = await renderDrawingSource(draft);

        /*
         * A newer render started while this one was in flight. Its result is
         * stale and adopting it would draw the older draft over the newer one.
         */
        if (token !== renderToken) {
            return;
        }

        lastRendered = svg;

        manager.markRendered(draft, revision);

        /*
         * Hand the drawing to the canvas through the one bridge that knows how
         * the canvas is drawn. See source-canvas-bridge.js for why that is a
         * separate module rather than an import from here.
         */
        refreshCanvasFromSource(svg, { source: draft });

        renderDiagnostics(manager.validate());
        renderStatusFromManager();
    } catch (error) {
        if (token !== renderToken) {
            return;
        }

        manager.markFailed(error);
        renderDiagnostics(manager.validate());
        renderStatusFromManager();
    }
}

function scheduleRender() {
    if (renderTimer) {
        clearTimeout(renderTimer);
    }

    renderTimer = setTimeout(() => {
        renderTimer = null;
        renderCurrentDraft();
    }, RENDER_DELAY_MS);
}

/*
 * ============================================================
 * SELECTION SYNC
 * ============================================================
 */

/*
 * The ids of every selected object, in document order.
 *
 * THE PANE READS THE DRAWING'S SELECTION DIRECTLY rather than keeping its own, so
 * the two cannot disagree - and it takes ALL of them, because a multi-selection
 * has a source region per object. It used to take the first, which highlighted
 * one region and silently ignored the rest.
 */
function selectedObjectIds() {
    const ids = drawingState.selection?.selectedObjectIds;

    if (!ids) {
        return [];
    }

    return Array.isArray(ids) ? [...ids] : [...ids];
}

/*
 * Called when the drawing's selection changes elsewhere - the canvas, the
 * Objects list, a keyboard shortcut.
 *
 * THE HIGHLIGHT IS ALWAYS SET; ONLY THE SCROLL IS DEFERRED. Marking the regions
 * costs nothing and means the Source tab is already showing the right thing when
 * it is opened, rather than needing a second event to catch up. Scrolling is
 * held back until the tab is actually visible and the editor does not have
 * focus, so a student typing in Source is never interrupted.
 */
function syncHighlightFromSelection() {
    if (!editor) {
        return;
    }

    const ids = selectedObjectIds();

    editor.setHighlightedObject(ids);

    if (ids.length && activePanelTab() === "source" && globalThis.document.activeElement !== editor.textarea) {
        editor.revealHighlighted();
    }
}

/*
 * The drawing was replaced wholesale - Undo, Redo, a sheet load - so the text in
 * the editor is no longer the text the highlight was resolved against. Called
 * by the panel after such a replacement so the highlight follows the restored
 * drawing instead of pointing into regions that have been rewritten.
 */
export function refreshSourceSelection() {
    if (!editor) {
        return;
    }

    editor.setValue(activeSourceManager().getVisibleSource());
    syncHighlightFromSelection();
}

/*
 * Called when the student selects text in the editor. If the selection falls
 * inside one object's block, the drawing's selection is set to that object, so
 * the canvas and Properties follow. A selection that spans custom source or
 * several blocks resolves to nothing and leaves the selection alone.
 */
function syncSelectionFromSource() {
    if (!editor) {
        return;
    }

    const info = editor.textarea;

    if (!info) {
        return;
    }

    /*
     * The SELECTION is resolved against the CANONICAL source, because the
     * markers that name an object live there. The editor's offsets are into
     * the visible text, so they are translated by counting how many marker
     * lines sit above the selection - each one is a whole line, so a
     * character offset moves by that many characters plus their newlines.
     */
    const manager = activeSourceManager();
    const source = manager.getSource();
    const start = manager.canonicalOffsetForVisibleOffset(info.selectionStart);
    const end = manager.canonicalOffsetForVisibleOffset(info.selectionEnd);

    if (start === end) {
        return;
    }

    const lineAt = character => source.slice(0, character).split("\n").length - 1;
    const startLine = lineAt(start);
    const endLine = lineAt(end);

    const startId = objectIdAtLine(source, startLine);
    const endId = objectIdAtLine(source, endLine);

    /*
     * Only a selection that sits WHOLLY inside one object selects that object.
     * A selection that crosses a boundary is the student gathering code to copy,
     * not choosing an object, and guessing at it would fight them.
     */
    if (startId && startId === endId) {
        enggDrawingState.selectObject(drawingState, startId);
    }
}

/*
 * ============================================================
 * BUILD AND WIRE
 * ============================================================
 */
export function renderSourceTab() {
    host = host || element("drawingSourceEditor");
    statusEl = statusEl || element("drawingSourceStatus");
    diagnosticsEl = diagnosticsEl || element("drawingSourceDiagnostics");

    if (!host) {
        return;
    }

    if (!editor) {
        editor = createSourceEditor(host, {
            onChange(text) {
                const manager = activeSourceManager();

                /*
                 * The student's typing is the VISIBLE text, which has no
                 * object markers. It goes into the shared draft through
                 * setVisibleSource, which re-attaches the markers from the
                 * previous canonical source - so an ordinary edit keeps each
                 * object's region findable, and their own code is what is
                 * stored.
                 *
                 * The object model is NOT rebuilt from it - see the note in
                 * source-synchronization.js - so a manual edit is preserved as
                 * source-controlled content and the next property edit updates
                 * only its own object's region.
                 */
                manager.setVisibleSource(text);

                /*
                 * THE TEXT THE STUDENT SEES IS WHAT IS CHECKED. Validation
                 * runs against the canonical text - markers and all - but the
                 * markers are whole comment lines, so the two disagree only in
                 * how they are counted; checking the stored text keeps the
                 * diagnostics' line numbers in step with the editor.
                 */
                const validation = validateDrawingSource(manager.getSource());

                renderDiagnostics(validation);
                renderStatusFromManager(validation);

                scheduleRender();
            },
            onSelectionChange() {
                syncSelectionFromSource();
            },

            /*
             * THE MARKERS LIVE IN THE STORED SOURCE, NOT IN THE EDITOR. The
             * editor shows the student's marker-free code; a region is found by
             * the object's marker. So the map is built from the canonical text,
             * and the editor only uses its line numbers to paint its own rows.
             */
            getMapSource() {
                return activeSourceManager().getSource();
            }
        });

        /*
         * Bring the editor into step with the document's source. The manager is
         * the single owner of the draft, so the editor never holds a copy that
         * could differ from it.
         */
        editor.setValue(activeSourceManager().getVisibleSource(), { preserveCaret: false });
    }

    syncHighlightFromSelection();

    /*
     * THE STATUS AND THE DIAGNOSTICS ARE THEIR OWN SCROLL AREA. A sticky line at
     * the top of the pane and a bounded list at its foot must not scroll away
     * with the code, so the pane's flex column is told which parts take the
     * editor's overflow rather than sharing it.
     */
    host.parentElement?.classList.add("is-source-pane");

    if (statusEl) {
        statusEl.classList.add("is-pinned");
    }

    if (diagnosticsEl) {
        diagnosticsEl.classList.add("is-pinned");
    }

    const initialValidation = activeSourceManager().validate();

    if (statusEl && !statusEl.title) {
        statusEl.title = "Editable TikZ source for the current sheet. Edits re-render after a short pause; errors appear below.";
    }

    renderStatusFromManager(initialValidation);
    renderDiagnostics(initialValidation);
}

/*
 * Called by the panel's tab controller when this tab opens. The editor is filled
 * from the document's source so what is shown is the current drawing, and the
 * render is brought up to date if a draft was left unrendered while the tab was
 * closed.
 */
export function onSourceTabOpened() {
    if (!editor) {
        renderSourceTab();
    }

    if (!editor) {
        return;
    }

    const manager = activeSourceManager();

    /*
     * Re-read the source, because a property edit or a source-sync while this
     * tab was closed may have changed it. The caret is preserved when it can be.
     *
     * The VISIBLE form is loaded, so the student's editor never shows the
     * object markers that make a region findable - those are bookkeeping, not
     * drawing code, and they are re-attached when the text is saved back.
     */
    editor.setValue(manager.getVisibleSource());

    syncHighlightFromSelection();

    /*
     * OPENING SOURCE SHOWS THE SELECTION'S CODE. A tab that opened at the top
     * of a long document while three objects were selected elsewhere would make
     * the student hunt for the region the Objects list and the canvas already
     * named, so the first selected region is scrolled to on open. The editor is
     * not focused, so nothing is typed over and the selection is untouched.
     */
    if (selectedObjectIds().length) {
        editor.revealHighlighted();
    }

    const validation = manager.validate();

    renderStatusFromManager(validation);
    renderDiagnostics(validation);

    /*
     * A draft that was typed and never rendered - the student switched away
     * before the debounce fired - is rendered now, so returning to the tab shows
     * the drawing as the source describes it.
     */
    if (manager.isDirty() && !manager.lastError()) {
        renderCurrentDraft();
    }
}

/*
 * Subscribe the pane to the shared source manager so an edit made elsewhere -
 * a property change, a deleted object - refreshes the editor when this tab is
 * open. Called once at start-up.
 */
export function installSourceTab() {
    const manager = activeSourceManager();

    if (unsubscribe) {
        unsubscribe();
    }

    unsubscribe = manager.subscribe(() => {
        if (!editor) {
            return;
        }

        /*
         * Only refresh the visible editor while the tab is open. A background
         * refresh would move the caret in an editor the student is not looking
         * at, and it would be re-filled when the tab opens anyway.
         */
        if (activePanelTab() !== "source") {
            return;
        }

        editor.setValue(manager.getVisibleSource());
        syncHighlightFromSelection();

        /*
         * A DRAWING-SPACE EDIT ARRIVED WHILE SOURCE WAS OPEN. The edited
         * region is scrolled to so the change the student just made on the
         * sheet is the one they see in the code - unless they are typing in the
         * editor, where stealing the scroll would move the text under the caret.
         */
        if (selectedObjectIds().length && globalThis.document.activeElement !== editor.textarea) {
            editor.revealHighlighted();
        }

        const validation = manager.validate();

        renderStatusFromManager(validation);
        renderDiagnostics(validation);
    });

    globalThis.document.addEventListener("datum:panel-tab-changed", (event) => {
        if (event.detail && event.detail.tab === "source") {
            onSourceTabOpened();
        }
    });

    /*
     * A SELECTION MADE ANYWHERE ARRIVES AS A DOCUMENT EVENT, so the pane does not
     * have to be wired into the canvas module directly and create a cycle. The
     * event is the seam.
     *
     * THE HIGHLIGHT IS MARKED EVEN WHILE SOURCE IS CLOSED. Marking it costs one
     * map lookup and means the tab is already showing the right region the
     * moment it is opened - rather than relying on a second event to catch up.
     * Only the SCROLL is deferred to the open tab, and `syncHighlightFromSelection`
     * makes that distinction itself.
     */
    globalThis.document.addEventListener("datum:selection-changed", () => {
        syncHighlightFromSelection();
    });

    /*
     * THE CANVAS COMPILES THE SOURCE TOO. When its compile fails - a command
     * TikZ rejects that validation could not see - the reason is reported here,
     * beside the code that caused it, rather than only in the console.
     */
    globalThis.document.addEventListener("datum:source-render-error", (event) => {
        const message = event?.detail?.message || "The source could not be rendered";

        setStatus("error", `TikZ source \u00B7 ${message}`);

        if (diagnosticsEl) {
            diagnosticsEl.hidden = false;
            diagnosticsEl.innerHTML =
                `<div class="drawing-source-diagnostic is-error">` +
                `<span class="drawing-source-diagnostic-line">\u2014</span>` +
                `<span class="drawing-source-diagnostic-text">${escapeHtml(message)}</span>` +
                `</div>`;
        }
    });

    /*
     * A DRAWING CHANGED WHILE SOURCE IS OPEN. The regions have moved - a new
     * object was appended, a deleted one's block is gone - so the highlight is
     * resolved again against the new text. The text itself is already being kept
     * in step by the source manager's own subscription above.
     */
    globalThis.document.addEventListener("datum:drawing-changed", () => {
        if (editor && activePanelTab() === "source") {
            syncHighlightFromSelection();
        }
    });

    renderSourceTab();
}

/*
 * The last SVG the source rendered, for a caller that needs to embed the current
 * drawing without rendering it again.
 */
export function lastRenderedSourceSvg() {
    return lastRendered;
}

export default {
    renderSourceTab,
    onSourceTabOpened,
    installSourceTab,
    refreshSourceSelection,
    lastRenderedSourceSvg,
    setActivePanelTab
};
