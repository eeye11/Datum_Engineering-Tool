/*
 * ============================================================
 * ONE WORKSPACE
 * ============================================================
 *
 * DAETUM has one working surface - Engineering Drawing - so there is nothing to
 * switch TO. This module used to run the Written Solution / Engineering Drawing
 * tabs; what remains of it is the part that was genuinely about the DRAWING:
 *
 *   - the drawing section is the active one, always;
 *   - and the canvas is told to redraw once, on the first frame, because a
 *     canvas that has just been made visible has its real size for the first
 *     time then (a hidden section measures 0 x 0).
 *
 * That second point is the reason this file still exists rather than being
 * deleted outright: it is not tab logic, it is the "the drawing only appears
 * after a resize" fix, and it still has to happen once.
 */

/* Make the drawing section the active one and draw into it. */
function showDrawingWorkspace() {
    const document = globalThis.document;

    if (!document) {
        return;
    }

    document.querySelectorAll(".review-content").forEach((section) => {
        section.classList.toggle("active", section.id === "drawing");
    });

    /*
     * THE CANVAS IS MEASURED FROM ITS OWN ELEMENT, so it needs its real size
     * before anything is projected into it. Imported HERE rather than at the top
     * of the file to keep the entry point's load order unchanged - the editor
     * wires itself to the page as it is evaluated, and a top-level import would
     * pull it forward.
     */
    import("../workspace/canvas-render.js").then(({ renderCurrentDrawing }) => {
        renderCurrentDrawing();
    });
}

showDrawingWorkspace();

/* Exported for a test or an embed that needs the same, idempotent, call. */
export { showDrawingWorkspace };
