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
import { STATICS_CHILD_TOOLS, keepStaticsToolArmed } from "../statics/statics-tools.js";

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

    if (STATICS_CHILD_TOOLS[drawingState.activeTool]) {
        keepStaticsToolArmed();
    }

    return object;
}
