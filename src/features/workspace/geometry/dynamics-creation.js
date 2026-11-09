/*
 * Creating a Dynamics feature from a completed gesture.
 *
 * ONE ENTRY POINT for every Dynamics tool, the analogue of the Statics
 * `createStaticsFeature`: the tool id and the points the gesture produced go
 * in, one committed, selected, undoable feature comes out. Both the direct
 * call (the click-placed tools, and the tests that exercise the pipeline
 * headlessly) and the two-click span gesture in `geometry-creation.js` come
 * through here, so there is exactly one implementation of "place a spring".
 */

import { commitCreatedFeature } from "./creation-commit.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";
import {
    DYNAMICS_PLACEMENT_TOOLS,
    dynamicsObjectName,
    dynamicsInstruction,
    isDynamicsTool,
    resolveDynamicsToolId
} from "../dynamics/dynamics-tools.js";
import { createDynamicsObject } from "../dynamics/dynamics-model.js";
import { promptForDynamicsLabel, toolTakesLabel } from "../dynamics/dynamics-label.js";
import { isDynamicsVector, promptForVectorMagnitude } from "../dynamics/dynamics-vector-value.js";
import { drawingState as dynamicsDrawingState } from "../editor-state.js";
import { renderCurrentDrawing as redrawDynamicsSheet } from "../../../components/layout/workspace/canvas-render.js";
import enggDrawingStateModule from "../../../shared/model/drawing-state.js";

/*
 * Build the Dynamics object, add it as one undoable action, select it and
 * hand the panel and the sheet the news. `points` is whatever the gesture
 * produced - one point for a placement tool, two for a span, box or angle
 * tool; the model's builders take what they need and ignore the rest.
 *
 * Returns the stored object, or null when the tool is not a Dynamics tool or
 * its builder refused the points (a zero-length chord, say) - the caller
 * reports that rather than committing an empty object.
 */
export function createDynamicsFeature(
    toolId,
    first,
    second,
    style = {},
    metadata = null
) {
    const resolved = resolveDynamicsToolId(toolId);

    if (!resolved || !isDynamicsTool(resolved)) {
        return null;
    }

    const points = [first, second].filter(Boolean);

    const object = createDynamicsObject(
        resolved,
        points,
        style
    );

    if (!object) {
        setToolMessage("That tool could not be created");

        return null;
    }

    if (metadata?.attachedTo && object.geometry) {
        object.geometry.attachedTo = metadata.attachedTo;
    }

    /*
     * THE SNAPSHOT BEFORE THE OBJECT EXISTED. A vector's magnitude prompt commits
     * its answer as its own undo entry on top of this one, so the snapshot must
     * be taken before the add - the same shape the moment and point-force paths
     * use.
     */
    const previous = enggDrawingStateModule.snapshotDrawing(
      dynamicsDrawingState,
    );

    commitCreatedFeature(object);

    /*
     * THE TOOL STAYS ARMED, whatever kind of Dynamics feature was placed.
     *
     * A particle used to hand back to Select after one placement, so placing a
     * second one meant finding the button again. Every tool ends on a deliberate
     * act - empty canvas, Escape, its own button, another tool - and the next
     * point places the next one.
     */
    setToolMessage(
        DYNAMICS_PLACEMENT_TOOLS[resolved]
            ? `Click to place the next ${dynamicsObjectName(resolved).toLowerCase()}`
            : dynamicsInstruction(resolved)
    );

    renderProperties();

    /*
     * THE TWO VECTORS ASK FOR THEIR MAGNITUDE BEFORE THEIR NAME - exactly as a
     * Point Force and an Applied Moment ask for theirs.
     *
     * A Polar Vector or an Angular Vector is a stated quantity with a direction,
     * so placing one commits the symbol and then asks what it measures, in the
     * same on-drawing field the Statics tools use - at its arrowhead, never in a
     * popup. The name step comes after the magnitude has been committed.
     */
    if (
        isDynamicsVector(object) &&
        !toolTakesLabel(resolved)
    ) {
        promptForVectorMagnitude(object, {
            state: dynamicsDrawingState,
            previous,
            onDone: () => {
                renderProperties();
                redrawDynamicsSheet();
            }
        });
        return object;
    }

    /*
     * THE OPTIONAL LABEL IS PART OF CREATING THE SYMBOL.
     *
     * The object is already committed and selected, so the student can ignore
     * the box entirely (Enter, or a press elsewhere, keeps what is in it), and
     * Escape closes only the box - the symbol they drew stays exactly where it
     * is. Nothing is written unless they type, and what they type is the
     * feature's own `label`, the single field the canvas, the panel and the
     * source all read.
     */
    if (toolTakesLabel(resolved)) {
        promptForDynamicsLabel(object, {
            state: dynamicsDrawingState,
            onDone: () => {
                renderProperties();
                redrawDynamicsSheet();
            }
        });
    }

    return object;
}
