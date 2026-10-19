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
 *   - It does not render. It hands source to rendering-adapter.js.
 *   - It does not know about the canvas or the panels.
 *   - It does not decide what a property change MEANS. That is
 *     source-synchronization.js's job, which calls the setter here.
 *
 * STATE IT TRACKS, AND WHY EACH IS SEPARATE.
 *
 *   source         the draft - exactly what the student has, character for
 *                  character. Never regenerated behind their back.
 *   renderedSource the version that last rendered successfully. Kept so the
 *                  canvas can go on showing it while the draft is broken.
 *   dirty          whether the draft differs from what was last saved.
 *   revision       a monotonic counter, so an in-flight render can tell whether
 *                  the draft it started from is still the current one.
 */

import {
    emptyDrawingSource,
    createSourceMap,
    isObjectMarkerLine,
    restoreObjectMarkersFrom,
    sourceHasDrawableContent,
    visibleDrawingSource
} from "./drawing-source.js";
import { validateDrawingSource } from "./source-validation.js";

/*
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

/*
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
    let lastError = null;

    const listeners = new Set();

    /*
     * `datum:source-changed` - one announcement, from the one place the source
     * can change. A listener that throws must not break the edit, exactly as
     * for `notify` above.
     */
    function announceSourceChanged() {
        const target = globalThis.document;

        if (!target || typeof target.dispatchEvent !== "function") {
            return;
        }

        try {
            target.dispatchEvent(managerEvent("datum:source-changed", { revision }));
        } catch {
            /* A notification failure is not a document failure. */
        }
    }

    function notify() {
        listeners.forEach(listener => {
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

    const manager = {
        /* ---------- reading ---------- */

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

        /*
         * Whether the drawing has any drawable content - not merely an
         * initialised picture. Used to label a sheet "Empty" and to refuse to
         * insert one as a figure.
         */
        hasDrawableContent() {
            return sourceHasDrawableContent(source);
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
         * Translate a character offset in the VISIBLE text to the same place
         * in the canonical text.
         *
         * The two differ only by whole marker lines, so the translation adds
         * the length of every marker line that sits above the offset. It is
         * used for one thing - resolving "which object does this selection
         * fall inside?" - and a caller that does not need it never touches it.
         */
        canonicalOffsetForVisibleOffset(offset) {
            /*
             * Walk the canonical text one character at a time, tracking the
             * offset in the VISIBLE text that corresponds to each canonical
             * position. Marker lines map to no visible character at all, so
             * they are skipped; every other character advances both counts by
             * one.
             */
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

        getRenderedSource() {
            return renderedSource;
        },

        isDirty() {
            return dirty;
        },

        revision() {
            return revision;
        },

        lastError() {
            return lastError;
        },

        /*
         * The source map for the CURRENT draft. Derived on demand, so it can
         * never describe a version of the text that no longer exists.
         */
        map() {
            return createSourceMap(source);
        },

        /* ---------- writing ---------- */

        /*
         * Replace the whole draft. Called by the Source tab as the student
         * types, and by persistence when a drawing is reopened.
         */
        setSource(next, { fromLoad = false } = {}) {
            const text = String(next ?? "");

            if (text === source) {
                return false;
            }

            source = text;
            revision += 1;
            dirty = !fromLoad;

            lastError = null;

            if (fromLoad) {
                /*
                 * A reopened drawing has rendered its own source already - or
                 * is about to - so the two versions agree until something is
                 * typed. Marking it dirty here would show a fresh document as
                 * modified, which is how "Save" comes to mean "Save As".
                 */
                renderedSource = text;
                lastError = null;
            }

            notify();

            /*
             * AND THE DRAWING SPACE IS TOLD, in a single event. The canvas keeps
             * the last picture that compiled while this draft is broken, and
             * reports why - so a source the student broke is explained at once,
             * rather than after a recompile that was never going to be sent.
             */
            announceSourceChanged();

            return true;
        },

        /*
         * Replace one object's region in place. This is the targeted update the
         * synchronization layer uses: everything the student typed elsewhere in
         * the text is preserved, byte for byte.
         */
        setRegion(next) {
            return manager.setSource(next);
        },

        /* ---------- rendering outcome ---------- */

        /*
         * Record that a version of the source rendered successfully. If it is
         * still the current draft, the draft is no longer "unrendered"; if the
         * student has typed since, only `renderedSource` moves, and the canvas
         * keeps showing the last thing that worked.
         */
        markRendered(renderedText, revisionAtStart) {
            renderedSource = String(renderedText ?? "");
            lastError = null;

            /*
             * The comparison is by revision, not by text: two identical texts
             * are the same source, but a render that finished for an older
             * revision must not be mistaken for one that covers the current
             * draft even when the text happens to match.
             */
            if (revisionAtStart === revision) {
                dirty = dirty && false;
            }

            notify();
        },

        /*
         * Record a render failure. The draft is untouched - that is the whole
         * point of keeping the two versions apart - so a student can correct a
         * typo and try again without having lost anything.
         */
        markFailed(error) {
            lastError = error instanceof Error ? error.message : String(error ?? "Rendering failed");
            notify();
        },

        /* ---------- validation ---------- */

        validate() {
            return validateDrawingSource(source);
        },

        /* ---------- persistence ---------- */

        /*
         * The state a saved document needs. The source travels as it is; the
         * map does not, because it is derivable from the markers and a stored
         * copy would be a second thing to keep in step.
         */
        serialize() {
            return {
                source,
                renderedSource,
                dirty
            };
        },

        /*
         * A drawing saved before the source existed has none. It is created
         * empty rather than guessed at; the synchronization layer fills it from
         * the objects when the sheet is first shown.
         */
        restore(saved) {
            const next = saved && typeof saved.source === "string" ? saved.source : emptyDrawingSource();

            source = next;
            renderedSource =
                saved && typeof saved.renderedSource === "string" ? saved.renderedSource : next;
            dirty = Boolean(saved && saved.dirty);
            revision += 1;
            lastError = null;
            notify();
        },

        markSaved() {
            dirty = false;
            notify();
        },

        /* ---------- subscription ---------- */

        subscribe(listener) {
            listeners.add(listener);

            return () => listeners.delete(listener);
        }
    };

    return manager;
}

/*
 * The application's one live source manager. A module-level instance rather
 * than a singleton class, so tests can create their own and the application
 * shares one without a global.
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
