/*
 * ============================================================
 * CHOOSING A THEME, AND THE DEFAULT DRAWING LINE COLOUR
 * ============================================================
 *
 * A theme preference is ONE decision, but it has TWO effects that must not be
 * allowed to drift:
 *
 *   1. the INTERFACE - applying the preference writes `data-theme` on `<html>`,
 *      which re-points the CSS tokens the whole application is styled through
 *      (`theme.js`);
 *   2. the DEFAULT DRAWING LINE COLOUR - the colour a NEWLY drawn feature is
 *      born with follows the theme too, because a near-black default would be
 *      invisible on the dark sheet and an ice-white one invisible on the light
 *      sheet (`drawing-state.js -> setThemeLineColour`).
 *
 * Only the first is the theme module's business. The theme module is deliberately
 * unable to reach the drawing - see the header of `theme.js`, and the test that
 * pins it - so the pairing lives here, in the editor layer, where both are
 * already in scope.
 *
 * IT CHANGES NO EXISTING FEATURE. `setThemeLineColour` moves only the value a
 * FUTURE feature starts with, and the active sheet's own copy is re-pointed only
 * when the student has not chosen a colour of their own (`strokeExplicit`). No
 * object's stroke is ever rewritten, so geometry, engineering values and the
 * undo history are untouched by a theme change.
 */

import enggDrawingState from "../../core/model/drawing-state.js";
import {
    defaultLineColour,
    readThemePreference,
    setThemePreference
} from "./theme.js";
import { drawingComponentsBack } from "../dom.js";
import { drawingState } from "../editor-state.js";
import { renderProperties } from "../panels/feature-panel.js";

/*
 * Apply a theme preference and bring the model's default line colour with it.
 *
 * It is safe to call before the editor has any real state: the model-level
 * default is always set, and the sheet's own copy is only touched when it is
 * present and the student has not chosen a colour of their own.
 */
export function applyThemePreference(preference) {
    const chosen = setThemePreference(preference);

    enggDrawingState.setThemeLineColour(defaultLineColour());

    if (drawingState?.styleDefaults?.strokeExplicit !== true) {
        drawingState.styleDefaults = {
            ...drawingState.styleDefaults,
            stroke: defaultLineColour(),
            strokeExplicit: false
        };

        /*
         * The toolbar's colour swatch reads the default, so it has to be told the
         * value moved - otherwise it would keep showing the previous theme's
         * colour.
         *
         * ONLY WHEN THE PANEL EXISTS. `installThemePreference` runs at start-up,
         * before the workspace is drawn, and the panel render is not safe with no
         * DOM - but there is also nothing to update yet, and the first sheet load
         * re-reads the default anyway.
         */
        if (drawingComponentsBack) {
            renderProperties();
        }
    }

    return chosen;
}

/*
 * Adopt the SAVED preference at start-up, seeding the model's default line
 * colour as it does - so the first feature drawn is the right colour without
 * waiting for a theme change.
 */
export function installThemePreference() {
    return applyThemePreference(readThemePreference());
}

const enggThemePreference = {
    applyThemePreference,
    installThemePreference
};

export default enggThemePreference;
