/*
 * ============================================================
 * DRAWING SOURCE / DOCUMENT MANAGER
 * ============================================================
 *
 * Owns the CURRENT DRAWING's editable source and provides the one interface the
 * rest of the application uses to read and change it.
 *
 * WHY IT IS A MODULE AND NOT A FIELD SOMEWHERE.
 *
 * The source is touched by the Source tab, by the object model when a property
 * changes, by the persistence layer when a drawing is saved or reopened, and by
 * the renderer when the canvas is redrawn. If each of them held its own copy,
 * "the drawing" would be whichever copy was read last. So there is one store,
 * with one set of operations, and everything else asks it.
 *
 * WHAT IT IS NOT.
 *
 *   - It does not render. It hands prepared text to rendering-adapter.js.
 *   - It does not know about the canvas or the panels beyond announcing a change.
 *   - It does not decide what a property change MEANS. That is
 *     source-synchronization.js's job, which calls the setter here.
 *
 * THE STATES, AND WHY EACH IS SEPARATE.
 *
 *   source          THE DRAFT - exactly what the student has, character for
 *                   character, including anything malformed. Never regenerated
 *                   behind their back and never "repaired" after the fact.
 *
 *   revision        a monotonic counter. Every change bumps it, so any piece of
 *                   asynchronous work can tell whether it still describes the
 *                   current draft. Out-of-order results compare against it.
 *
 *   analysis        the latest parse of the draft: validation, diagnostics,
 *                   statements and the object blocks. Derived, never edited.
 *
 *   renderInput     the text the RENDERER is given: the draft with unfinished
 *                   statements replaced by comments. Separate from `source`,
 *                   because the student's text must never be edited to make a
 *                   picture possible - and separate is what lets a scribbled
 *                   half-command not stop the rest of the sheet rendering.
 *
 *   render          what the renderer said about a revision: pending, up to date,
 *                   failed (with the reason), or stale. Keyed by revision, so a
 *                   late response for an old draft cannot overwrite a newer one.
 *
 *   lastError       the most recent RENDERER failure (not a validation problem).
 *                   Cleared by any successful render of a newer revision.
 *
 *   saveStatus      saved / pending / saving / error. Independent of whether the
 *                   draft renders: an invalid draft is still saved.
 *
 *   renderedSource  the last text that rendered successfully. Kept so a reader
 *                   can see what the current picture was made from.
 */

import {
    emptyDrawingSource,
    createSourceMap,
    isObjectMarkerLine,
    restoreObjectMarkersFrom,
    sourceHasDrawableContent,
    visibleDrawingSource
} from "./drawing-source.js";
import { prepareRenderInput } from "./source-statements.js";
import { blockContents } from "./source-model.js";
import { validateDrawingSource } from "./source-validation.js";

/* ============================================================
 * EVENTS
 * ============================================================
 *
 * A DOCUMENT EVENT THAT WORKS WHEREVER THE MANAGER RUNS.
 *
 * The application runs in a browser. A test harness may build its own window
 * whose `CustomEvent` is not on the Node global - so the constructor is taken
 * from the document's own view first, and from the global second, and an
 * environment with neither gets no event rather than a `TypeError` that would
 * surface as "the source could not be saved".
 */
function managerEvent(type, detail) {
    const view = globalThis.document?.defaultView || globalThis;
    const Custom = view.CustomEvent || globalThis.CustomEvent;

    if (typeof Custom === "function") {
        return new Custom(type, { detail });
    }

    return new (view.Event || globalThis.Event)(type);
}

function dispatch(type, detail) {
    const target = globalThis.document;

    if (!target || typeof target.dispatchEvent !== "function") {
        return;
    }

    try {
        target.dispatchEvent(managerEvent(type, detail));
    } catch {
        /* A notification failure is not a document failure. */
    }
}

/* ============================================================
 * THE MANAGER
 * ============================================================
 *
 * The manager is per-DRAWING, but the application edits one drawing at a time -
 * the active sheet - so there is one live instance. `createSourceManager` is
 * exported so a test or a future multi-sheet editor can make its own without
 * sharing module state.
 */
export function createSourceManager(initialSource) {
    let source = typeof initialSource === "string" ? initialSource : emptyDrawingSource();

    let renderedSource = source;
    let dirty = false;
    let revision = 0;

    /*
     * THE ANALYSIS IS DERIVED ONCE PER REVISION, NOT PER READER.
     *
     * The Source tab, the canvas, the object reader and the status line all want
     * the parse. Deriving it lazily and remembering it until the draft changes
     * means a keystroke parses the document once, however many readers ask.
     */
    let analysisRevision = null;
    let analysis = null;

    /* The render state of the CURRENT revision, plus the last failure. */
    let renderState = "idle";
    let renderRevision = null;
    let lastError = null;
    let lastErrorRevision = null;

    /* Saving is reported by the application, not performed here. */
    let saveStatus = "saved";
    let saveError = null;

    const listeners = new Set();

    function notify() {
        listeners.forEach((listener) => {
            try {
                listener(manager);
            } catch {
                /*
                 * A listener that throws must not break the update that was in
                 * flight. The source has already changed; the failure belongs
                 * to the listener, not to the document.
                 */
            }
        });
    }

    /* The parse of the current draft, computed at most once per revision. */
    function analyse() {
        if (analysisRevision === revision && analysis) {
            return analysis;
        }

        const validation = validateDrawingSource(source);

        /*
         * THE RENDERER IS GIVEN THE VISIBLE FORM, with its unfinished statements
         * commented out.
         *
         * The marker comments name DAETUM objects; they are not part of the
         * drawing and the Source tab never shows them (`visibleDrawingSource`). The
         * render input has the same rule: the compiler is sent the SOURCE THE
         * STUDENT SEES, with incomplete statements replaced by a comment that names
         * the skipped line - not the student's text. Feeding it the canonical form
         * put every object's markers into the compiled document, which compiles (a
         * comment is a comment) but is not the text the Source tab shows, and it
         * meant an object's id appeared in a picture that should carry none.
         */
        const prepared = prepareRenderInput(visibleDrawingSource(source));

        let map = null;

        try {
            map = createSourceMap(source);
        } catch {
            map = null;
        }

        analysis = {
            revision,
            source,
            visible: visibleDrawingSource(source),
            validation,
            diagnostics: validation.diagnostics,
            statements: validation.statements,
            /*
             * THE BLOCKS, WITH THEIR STATEMENTS.
             *
             * `map.blocks` is the marker list from `drawing-source.js` - ids and
             * line ranges. The object reader needs what is BETWEEN the markers
             * too, so the blocks are parsed once here and carried with the
             * analysis. A reader that wanted only ids can use `block.id`.
             */
            blocks: blockContents(source, map).blocks,
            map,
            renderInput: prepared.text,
            skipped: prepared.skipped,
            renderInputChanged: prepared.changed,
            hasDrawableContent: sourceHasDrawableContent(source)
        };

        analysisRevision = revision;

        return analysis;
    }

    /*
     * A CHANGE TO THE DRAFT, IN ONE PLACE.
     *
     * Everything that edits the source goes through here, so there is exactly
     * one place that bumps the revision, invalidates the analysis and announces
     * the change. `origin` says WHAT changed it - an edit, a canvas object, a
     * load, an undo - because a listener that only cares about one of those
     * (the object reader, say) should not have to guess.
     */
    function assign(text, { origin = "edit", fromLoad = false, silent = false } = {}) {
        source = String(text ?? "");
        revision += 1;

        analysisRevision = null;
        analysis = null;

        renderState = "idle";
        renderRevision = null;

        /*
         * A NEW DRAFT IS NOT A NEW RENDER FAILURE. The failure belonged to the
         * text that was sent; this is different text, and whether it fails is
         * the renderer's next answer. Keeping the old message here is exactly
         * how a Source tab comes to show an error it has already fixed.
         */
        lastError = null;
        lastErrorRevision = null;

        if (fromLoad) {
            /*
             * A reopened drawing has rendered its own source already - or is
             * about to - so the two versions agree until something is typed.
             * Marking it dirty here would show a fresh document as modified,
             * which is how "Save" comes to mean "Save As".
             */
            renderedSource = source;
            dirty = false;
            saveStatus = "saved";
        } else {
            dirty = true;
            saveStatus = "pending";
        }

        saveError = null;

        if (!silent) {
            notify();
            announceSourceChanged(origin);
        }

        return true;
    }

    /*
     * AND THE DRAWING SPACE IS TOLD, in a single event, with the revision and
     * the origin. The canvas keeps the last picture that compiled while this
     * draft is broken, and reports why - so a source the student broke is
     * explained at once, rather than after a recompile that was never going to
     * be sent.
     */
    function announceSourceChanged(origin) {
        dispatch("datum:source-changed", { revision, origin });
    }

    const manager = {
        /* ---------- reading: the draft ---------- */

        getSource() {
            return source;
        },

        /*
         * THE SOURCE AS THE STUDENT SEES IT.
         *
         * The canonical text carries object markers so a region can be found
         * after editing. Those markers are bookkeeping, not drawing code, so the
         * Source tab and Written Solution are given the text WITHOUT them. Both
         * views therefore show the same ordinary `tikzpicture` that would be
         * pasted into a document.
         */
        getVisibleSource() {
            return visibleDrawingSource(source);
        },

        hasDrawableContent() {
            return sourceHasDrawableContent(source);
        },

        revision() {
            return revision;
        },

        isDirty() {
            return dirty;
        },

        /* ---------- reading: the parse ---------- */

        /** The whole parse of the current draft. Derived; never mutated. */
        analysis() {
            return analyse();
        },

        validate() {
            return analyse().validation;
        },

        diagnostics() {
            return analyse().diagnostics;
        },

        /** `{ id, type, beginLine, endLine, ... }` per object block, in order. */
        blocks() {
            return analyse().blocks;
        },

        map() {
            return analyse().map || createSourceMap(source);
        },

        /**
         * The text the renderer should be given: unfinished statements replaced
         * by comments. Never the draft itself when the draft is broken.
         */
        renderInput() {
            return analyse().renderInput;
        },

        /** Which statements were left out of `renderInput`, by line. */
        skippedStatements() {
            return analyse().skipped;
        },

        /* ---------- reading: rendering ---------- */

        getRenderedSource() {
            return renderedSource;
        },

        /** "idle" | "pending" | "rendering" | "rendered" | "failed" */
        renderStatus() {
            if (renderState === "rendered" && renderRevision !== revision) {
                return "pending";
            }

            if (renderState === "failed" && renderRevision !== revision) {
                /* The failure was about older text; the new text is unrendered. */
                return "pending";
            }

            return renderState;
        },

        /** The revision the current render state describes, or null. */
        renderedRevision() {
            return renderRevision;
        },

        /** The last RENDERER failure - not a validation problem. */
        lastError() {
            return lastError;
        },

        lastErrorRevision() {
            return lastErrorRevision;
        },

        /* ---------- reading: saving ---------- */

        saveStatus() {
            return saveStatus;
        },

        saveError() {
            return saveError;
        },

        /* ---------- writing: the draft ---------- */

        /*
         * Replace the whole draft. Called by the Source tab as the student
         * types, by the object synchronization when a canvas object changes, and
         * by persistence when a drawing is reopened.
         */
        setSource(next, options = {}) {
            const text = String(next ?? "");

            if (text === source) {
                return false;
            }

            return assign(text, options);
        },

        /*
         * THE STUDENT EDITED THE VISIBLE TEXT.
         *
         * The editor shows the marker-free form, so what comes back has no
         * markers on it. Those markers are re-attached from the PREVIOUS
         * canonical source before the draft is stored, which is what keeps an
         * object's region findable while the student types - and what keeps
         * their edit, rather than a regenerated document, as the draft.
         *
         * If the restored text equals what is already stored, nothing changes
         * and `false` is returned, so a keystroke that altered only a marker
         * cannot look like a document edit.
         */
        setVisibleSource(text, options = {}) {
            const restored = restoreObjectMarkersFrom(String(text ?? ""), source);

            return manager.setSource(restored, options);
        },

        /*
         * Replace one object's region in place. This is the targeted update the
         * synchronization layer uses: everything the student typed elsewhere in
         * the text is preserved, byte for byte.
         */
        setRegion(next, options = { origin: "object" }) {
            return manager.setSource(next, options);
        },

        /*
         * Translate a character offset in the VISIBLE text to the same place in
         * the canonical text.
         *
         * The two differ only by whole marker lines, so the translation adds the
         * length of every marker line that sits above the offset. It is used for
         * one thing - resolving "which object does this selection fall inside?"
         * - and a caller that does not need it never touches it.
         */
        canonicalOffsetForVisibleOffset(offset) {
            const canonical = String(source ?? "");
            const target = Math.max(0, Number(offset) || 0);

            if (target === 0) {
                return 0;
            }

            let visibleOffset = 0;
            let lineStart = 0;

            while (lineStart <= canonical.length) {
                const newline = canonical.indexOf("\n", lineStart);
                const lineEnd = newline < 0 ? canonical.length : newline;
                const line = canonical.slice(lineStart, lineEnd);

                const glyphs = isObjectMarkerLine(line) ? 0 : line.length + (newline < 0 ? 0 : 1);

                if (glyphs > 0 && visibleOffset + glyphs >= target) {
                    return Math.min(lineStart + (target - visibleOffset), canonical.length);
                }

                visibleOffset += glyphs;

                if (newline < 0) {
                    break;
                }

                lineStart = newline + 1;
            }

            return canonical.length;
        },

        /* ---------- rendering outcome ---------- */

        /*
         * A RENDER STARTED for `revision`. Nothing is announced: this is a
         * background fact, and announcing it would make every reader redraw for
         * a state they were about to get anyway.
         */
        markRendering(revisionAtStart) {
            renderState = "rendering";
            renderRevision = revisionAtStart;

            dispatch("datum:source-render-status", {
                revision: revisionAtStart,
                status: "rendering"
            });
        },

        /*
         * RECORD THAT A VERSION OF THE SOURCE RENDERED SUCCESSFULLY.
         *
         * The comparison is by revision, not by text: two identical texts are
         * the same source, but a render that finished for an older revision must
         * not be mistaken for one that covers the current draft even when the
         * text happens to match.
         */
        markRendered(renderedText, revisionAtStart) {
            const current = revisionAtStart === revision;

            if (revisionAtStart !== null && revisionAtStart !== undefined) {
                if (renderRevision === null || revisionAtStart >= renderRevision) {
                    renderedSource = String(renderedText ?? renderedSource ?? "");
                    renderState = current ? "rendered" : "pending";
                    renderRevision = revisionAtStart;
                }
            }

            /*
             * A SUCCESSFUL RENDER CLEARS THE FAILURE IT REPLACED. Only a render
             * of a revision that is at least as new as the failure can, so a
             * late success cannot erase the diagnosis of a newer broken draft.
             */
            if (lastErrorRevision === null || revisionAtStart >= lastErrorRevision) {
                lastError = null;
                lastErrorRevision = null;
            }

            notify();
            dispatch("datum:source-rendered", { revision: revisionAtStart, current });
        },

        /*
         * Record a RENDERER failure - the engine refusing the source, or the
         * engine itself failing. The draft is untouched, and so is the last
         * picture; only the state changes. A validation problem is NOT recorded
         * here: it is part of the analysis, and deriving it twice would let the
         * two disagree.
         */
        markFailed(error, revisionAtStart, { transient = false } = {}) {
            const message = error instanceof Error ? error.message : String(error ?? "Rendering failed");

            /*
             * AN OLDER FAILURE NEVER REPLACES A NEWER STATE. A response for a
             * revision the student has already moved past is dropped, exactly
             * as an old success is.
             */
            if (
                revisionAtStart !== null &&
                revisionAtStart !== undefined &&
                renderRevision !== null &&
                revisionAtStart < renderRevision
            ) {
                return;
            }

            renderState = transient ? "pending" : "failed";
            renderRevision = revisionAtStart ?? null;

            if (!transient) {
                lastError = message;
                lastErrorRevision = revisionAtStart ?? null;
            }

            notify();
            dispatch("datum:source-render-error", {
                revision: revisionAtStart,
                message,
                transient
            });
        },

        /* The render state was reset - a new document, a sheet load. */
        resetRenderState() {
            renderState = "idle";
            renderRevision = null;
            lastError = null;
            lastErrorRevision = null;
        },

        /* ---------- saving ---------- */

        /*
         * The application's auto-save reports through here. Saving is
         * INDEPENDENT of rendering: a draft that cannot render is still saved,
         * because it is the student's work and is what they will reopen.
         */
        markSaving() {
            saveStatus = "saving";
            notify();
        },

        markSaved() {
            dirty = false;
            saveStatus = "saved";
            saveError = null;
            notify();
            dispatch("datum:source-save-status", { status: "saved" });
        },

        markSaveFailed(error) {
            saveStatus = "error";
            saveError = error instanceof Error ? error.message : String(error ?? "The draft could not be saved");
            notify();
            dispatch("datum:source-save-status", { status: "error", message: saveError });
        },

        /* ---------- persistence ---------- */

        /*
         * The state a saved document needs. The source travels as it is; the map,
         * the analysis and the render state do not, because they are derivable
         * and a stored copy would be a second thing to keep in step.
         */
        serialize() {
            return {
                source,
                renderedSource,
                dirty
            };
        },

        /*
         * A drawing saved before the source existed has none. It is created empty
         * rather than guessed at; the synchronization layer fills it from the
         * objects when the sheet is first shown.
         */
        restore(saved, { origin = "load" } = {}) {
            const next = saved && typeof saved.source === "string" ? saved.source : emptyDrawingSource();

            source = next;
            renderedSource =
                saved && typeof saved.renderedSource === "string" ? saved.renderedSource : next;
            dirty = Boolean(saved && saved.dirty);
            revision += 1;

            analysisRevision = null;
            analysis = null;

            renderState = "idle";
            renderRevision = null;
            lastError = null;
            lastErrorRevision = null;

            saveStatus = dirty ? "pending" : "saved";
            saveError = null;

            notify();
            announceSourceChanged(origin);
        },

        /* ---------- subscription ---------- */

        subscribe(listener) {
            listeners.add(listener);

            return () => listeners.delete(listener);
        },

        /*
         * Everything a status line or a test needs to describe the document,
         * read as one consistent snapshot of the current revision.
         */
        snapshot() {
            const parsed = analyse();

            return {
                revision,
                source,
                visibleSource: parsed.visible,
                dirty,
                saveStatus,
                saveError,
                renderStatus: manager.renderStatus(),
                renderedRevision: renderRevision,
                renderedSource,
                lastError,
                empty: parsed.validation.empty,
                ok: parsed.validation.ok,
                diagnostics: parsed.diagnostics,
                blockCount: parsed.blocks.length,
                skippedCount: parsed.skipped.length,
                hasDrawableContent: parsed.hasDrawableContent
            };
        }
    };

    return manager;
}

/*
 * The application's one live source manager. A module-level instance rather than
 * a singleton class, so tests can create their own and the application shares one
 * without a global.
 */
let activeManager = createSourceManager();

export function activeSourceManager() {
    return activeManager;
}

/*
 * Used by a test or a full document reset (File > New) to start from a clean
 * source without reloading the page.
 */
export function resetActiveSourceManager(source) {
    activeManager = createSourceManager(source);

    return activeManager;
}

export default {
    createSourceManager,
    activeSourceManager,
    resetActiveSourceManager
};
