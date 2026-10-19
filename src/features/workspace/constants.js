/*
 * Constants and defaults shared across the editor.
 */

import { drawingState } from "./editor-state.js";

export const COORDINATE_SYSTEM_TYPE = "coordinate-system-2d";

export const COORDINATE_SYSTEM_LENGTH = 25;

export const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/*
 * The default line weight for a Statics tool's features.
 *
 * A Point Force gets its own heavier weight; every other Statics
 * feature uses the drawing's general default. Naming the choice
 * here keeps the creation path from having to know which tools
 * are drawn heavier.
 */
export function staticsForceLineWidth(
        toolId
    ) {
        /*
         * A FORCE IS DRAWN AT THE SAME WEIGHT AS ANY OTHER FEATURE.
         *
         * This used to return a special weight for a Point Force,
         * chosen on the grounds that a force is a symbol and a symbol
         * needs more presence than an outline. It was a mistake twice
         * over.
         *
         * Once, because the number it returned was not the sheet's
         * default: a force drew at 0.5 while a Line drew at 1.2, so
         * the same configured thickness produced two different-looking
         * strokes and "the default thickness" meant different numbers
         * for different features. A student setting a line to 0.5 and
         * drawing a force next to a line would see them at visibly
         * different weights with identical settings.
         *
         * Twice, because the special weight was a floor as well as a
         * default: it was returned regardless of the width already
         * chosen, so a force drawn at the sheet's own 1.2 came out at
         * 0.5 - the opposite of the intention. A force looked
         * THINNER than ordinary geometry, which is the one thing this
         * was supposed to prevent.
         *
         * So a force is given no special treatment at all. It is drawn
         * at the sheet's current line weight, exactly as a Line is, and
         * a force that wants more presence gets a Features-panel line
         * width like every other feature.
         */
        return drawingState.styleDefaults?.lineWidth ?? 1.2;
    }

/*
 * Default size of a newly created rigid body, in mm. The
 * student resizes it afterwards from the Features panel
 * or by dragging its corner handles.
 */
/*
 * The starting size of a new Rigid Body.
 *
 * Deliberately small: a body is a starting outline to be sized
 * and shaped, so a large default would fill the canvas and need
 * shrinking before it could be used.
 */
export const RIGID_BODY_WIDTH = 50;

export const RIGID_BODY_HEIGHT = 30;
