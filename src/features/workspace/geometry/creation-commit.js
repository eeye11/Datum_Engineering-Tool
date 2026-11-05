/*
 * Committing a newly created feature as one undoable action.
 *
 * A feature is drawn at the size the student drew it. (A creation popup used
 * to ask for its "real" length in a chosen unit and calibrate the sheet from
 * the first answer; that world-length system is retired, and nothing asks for a
 * size after drawing any more.)
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import { drawingState } from "../editor-state.js";

/*
 * The snapshot is taken BEFORE the object is added, so Undo removes the
 * feature in one step. A caller that had to change the drawing before the
 * object existed passes the snapshot it took first.
 *
 * THE OBJECT IS SELECTED BEFORE THE COMMIT, not after. The commit is the
 * moment the drawing source is told about the edit, and it identifies the
 * edited object through the shared selection - selecting afterwards left the
 * commit reading the PREVIOUS selection, and a freshly drawn feature never
 * reached the source at all. The selection is not part of a history snapshot,
 * so this changes nothing about what Undo restores.
 *
 * The Features tab follows the selection, so the new feature's properties are
 * on screen the moment it exists.
 */
export function commitCreatedFeature(
    object,
    previousObjects = null
) {
    const previous =
        previousObjects ||
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    enggDrawingState.addObject(
        drawingState,
        object
    );

    enggDrawingState.selectObject(
        drawingState,
        object.id
    );

    enggDrawingState.commitDrawingChange(
        drawingState,
        previous
    );

    /*
     * THE TOOL STAYS ARMED AFTER A FEATURE IS COMMITTED.
     *
     * It used to drop back to Select for a Statics child tool, so the second
     * Beam or the second Resultant needed the button pressed again. A tool ends
     * on a DELIBERATE act and only then: a click or tap on empty canvas, the
     * tool's own button, Escape, or another tool. The new feature is still
     * selected (above), so its properties are on screen while the tool waits for
     * the next one.
     */

    return object;
}
