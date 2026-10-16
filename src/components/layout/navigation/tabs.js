/*
 * The page's top-level tabs: Written Solution and Engineering Drawing.
 *
 * Each tab button names the section it shows with data-tab="<section id>".
 */

export function showTab(tabName, button) {
    document.querySelectorAll(".review-content").forEach(section => {
        section.classList.remove("active");
    });

    document.querySelectorAll(".tab").forEach(tab => {
        tab.classList.remove("active");
    });

    document.getElementById(tabName).classList.add("active");
    button.classList.add("active");

    /*
     * ========================================================
     * A TAB THAT BECOMES VISIBLE HAS ITS SIZE FOR THE FIRST TIME
     * ========================================================
     *
     * The drawing canvas is measured from its own element on every render
     * - `clientWidth`, `clientHeight`, a bounding rectangle - because the
     * renderer has to know how much drawing area there is before it can
     * project anything into it.
     *
     * A CSS `display: none` section has NO box: its width and height are
     * both zero. So a render performed while the drawing tab is hidden
     * lays the sheet out into a 0 x 0 viewport, and the result is a canvas
     * that stays blank until something else happens to redraw it - which
     * is exactly the "the drawing only appears after a resize" defect.
     *
     * Bringing the section on screen is precisely the moment its real size
     * first exists, so this is where the redraw belongs. It is a real
     * redraw of a now-measurable viewport, not a delay standing in for
     * one: no timer is involved, and the size is read after the class
     * change above has made the section visible.
     *
     * The camera is left exactly as it was. A redraw is not a re-fit, so
     * the student's zoom and pan survive switching tabs - only the number
     * of pixels the same view is drawn into changes.
     */
    if (tabName === "drawing") {
        /*
         * Imported HERE rather than at the top of the file, and that is
         * deliberate. This module is the first thing the entry point loads,
         * and the drawing editor is a large part of the application that
         * wires itself to the page as it is evaluated. A top-level import
         * would make the editor load before the rest of the entry point's
         * own imports, reversing the start-up order the application was
         * built and tested with. A dynamic import inside the one function
         * that needs it leaves the load order exactly as it was.
         */
        import("../workspace/canvas-render.js").then(
            ({ renderCurrentDrawing }) => {
                renderCurrentDrawing();
            }
        );
    }
}

document.querySelectorAll(".tab[data-tab]").forEach(button => {
    button.addEventListener("click", () => showTab(button.dataset.tab, button));
});
