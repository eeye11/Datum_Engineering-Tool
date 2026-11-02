/*
 * Deleting the selection, with its dependants.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { drawingState } from "../editor-state.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";
import { normaliseJunctionRemoval } from "../interaction/junction-tool.js";

export function deleteSelectedObjects() {
    const selectedIds = [
        ...drawingState.selection
            .selectedObjectIds
    ];

    if (
        !selectedIds.length ||
        drawingState.interaction.phase !==
            "idle"
    ) {
        return;
    }

    const previousObjects =
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    const selectedSet =
        new Set(
            selectedIds
        );

    /*
     * THE JUNCTIONS ABOUT TO GO, captured BEFORE the removal: a junction is
     * dropped with the first of its pipes, so by the time its id comes back
     * the object is gone.
     */
    const removedJunctions = new Map(
        (drawingState.objects || [])
            .filter((object) => object.type === "junction")
            .map((object) => [object.id, JSON.parse(JSON.stringify(object))])
    );

    /*
     * ========================================================
     * A DELETION TAKES ITS DEPENDENTS WITH IT
     * ========================================================
     *
     * Deleting a Beam used to leave its Support, its Load, its Moment and
     * its SFD standing, each still naming a member that was no longer
     * there. A support rendered an X - the "missing source" marker - but a
     * diagram had no such marker and simply went on drawing its axes, its
     * x (m) label and its frame. That is where the orphaned-axis report
     * came from: not a renderer leaking nodes, but a FEATURE that had lost
     * its parent and went on being drawn.
     *
     * THE CHILDREN GO, AND THE REASON IS NOT SYMMETRY.
     *
     * None of these features has a meaning without the body: a support has
     * no member to push against, a load no region to act on, a diagram no
     * span to be read against. The student's own work - the expressions in
     * a Plot, the lines in a Sketch - is not discarded as data; it goes
     * because the thing it describes is gone, and Undo brings the whole
     * arrangement back because this is one committed change.
     *
     * ONE PASS, NOT A LOOP.
     *
     * A support may itself have children - its attachment marker - so the
     * descendants are collected first and then removed together. Walking
     * the tree in one pass cannot loop even on a malformed file, and a
     * cycle would not hang the delete.
     *
     * `resolveAnalysisAfterDeletion` below still runs, and still decides
     * what a surviving analysis object means, because a RESULTANT or a
     * COMPONENTS pair is a reading of its sources rather than a child of
     * one: it goes with them only once nothing is left to read.
     */
    const removedIds =
        enggDrawingState.removeObjectsAndDescendants(
            drawingState,
            selectedSet
        );

    /*
     * A DELETED JUNCTION LEAVES ITS PIPES BEHIND AND SETTLED: merged when they
     * are one line, an Elbow when they make a corner. Before the commit, so
     * Undo restores the whole operation.
     */
    removedIds
        .map((id) => removedJunctions.get(id))
        .filter(Boolean)
        .forEach((junction) => {
            normaliseJunctionRemoval(junction, drawingState.objects, { dryRun: false });
        });

    /*
     * Settle the analysis objects that were reading what has just gone.
     *
     * It runs BEFORE the commit, so the snapshot taken for Undo already
     * reflects the resolution and Undo restores the whole coherent state
     * rather than resurrecting a dangling reference.
     */
    enggDrawingState.resolveAnalysisAfterDeletion(
        drawingState,
        removedIds
    );

    drawingState.selection
        .selectedObjectIds = [];

    drawingState.selection
        .boxSelectionIds = [];

    drawingState.selection
        .hoveredObjectId = null;

    drawingState.interaction
        .hoveredEntity = null;

    drawingState.interaction
        .snapCandidate = null;

    enggDrawingState.commitDrawingChange(
        drawingState,
        previousObjects
    );

    renderProperties();
    renderCurrentDrawing();

    setToolMessage(
        `Deleted ${selectedIds.length} component${
            selectedIds.length === 1
                ? ""
                : "s"
        }`
    );
}
