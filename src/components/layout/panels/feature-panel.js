/*
 * ============================================================
 * THE FEATURES PANEL'S RENDER ENTRY POINT
 * ============================================================
 *
 * This module used to render a Features panel of its own: a component tree, a
 * per-feature property page, and a load-build form. All of that has been
 * replaced by the inspector's Features tab, which edits the SELECTION through
 * `features-editor.js`.
 *
 * WHAT IS LEFT IS THE THING THE REST OF THE APPLICATION ACTUALLY NEEDS. Many
 * modules call `renderProperties()` after a command - a delete, a paste, a trim,
 * a created feature - and what they mean is "the drawing changed, so anything
 * describing it must be rebuilt". That is still true and still useful; it just
 * has one target now instead of two.
 *
 * WHY IT IS NOT DELETED OUTRIGHT. Removing the export would mean editing fifty
 * call sites to say the same thing, and the ones that forgot would silently stop
 * refreshing the panel. Keeping the name and pointing it at the current editor
 * is the smaller, safer change - and it is the reason there is no second
 * Features interface left to render alongside the first.
 *
 * WHAT WAS REMOVED, so it cannot come back by accident:
 *
 *   - `resolveLegacyFeatureTargets`, which CREATED `#drawingProperties` and
 *     `#drawingFeaturesBack` and appended them INTO the Features pane. Those
 *     two elements were what occupied the top of the panel and pushed the object
 *     list down.
 *   - the component tree and its load-build panel as Features content.
 *   - `editorState.featurePanelView` / `featureTreePickedId`, the "tree, then a
 *     deliberate second click to edit" state that the selection-driven editor
 *     replaces.
 */

import { renderFeatures } from "./features-editor.js";
import { syncStyleControls } from "./style-controls.js";

export function renderProperties() {
    /*
     * The toolbar's own style controls still follow the selection - a selected
     * feature's thickness, colour and line type are shown on the strip - so this
     * runs first, exactly as it did before the panel was replaced.
     */
    syncStyleControls();

    /*
     * AND THE FEATURES TAB FOLLOWS THE SELECTION. Called unconditionally: it is
     * the one place that knows how to draw the selection, and an empty selection
     * is a legitimate thing for it to draw (an empty panel).
     */
    renderFeatures();
}
