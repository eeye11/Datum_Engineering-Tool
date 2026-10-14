/*
 * Copy, cut, paste and duplicate.
 */

import enggDrawingState from "../../core/model/drawing-state.js";
import enggDrawingClipboard from "../../core/selection/clipboard.js";
import { renderCurrentDrawing } from "../workspace/canvas-render.js";
import { deleteSelectedObjects } from "./delete-command.js";
import { drawingState, editorState } from "../editor-state.js";
import { renderProperties } from "../panels/feature-panel.js";
import { setToolMessage } from "../toolbar/toolbar-render.js";

export function objectsByIds(
    ids
) {
    return drawingState.objects.filter(
        object =>
            ids.includes(
                object.id
            )
    );
}

/*
 * The features the clipboard currently holds, or null when it is
 * empty. Read by the context menu to decide whether Paste is
 * available at all, because offering an action that does
 * nothing is worse than not offering it.
 */
export function clipboardHasContent() {
    return Boolean(
        editorState.drawingClipboard &&
            editorState.drawingClipboard.features.length
    );
}

export function copySelectionToClipboard() {
    const selectedIds = [
        ...drawingState.selection
            .selectedObjectIds
    ];

    if (!selectedIds.length) {
        return false;
    }

    editorState.drawingClipboard =
        enggDrawingClipboard.capture(
            objectsByIds(selectedIds)
        );

    return clipboardHasContent();
}

export function pasteFromClipboard() {
    if (!clipboardHasContent()) {
        return;
    }

    const previous =
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    /*
     * Copies are offset so they are visibly copies. A paste that
     * landed exactly on its original would be impossible to tell
     * apart from it, let alone pick.
     */
    const offset =
        enggDrawingClipboard.PASTE_OFFSET;

    const created = [];

    enggDrawingClipboard
        .prepare(editorState.drawingClipboard)
        .forEach(feature => {
            enggDrawingClipboard.offsetFeature(
                feature,
                offset.x,
                offset.y
            );

            /*
             * addObject assigns the identity and the name, so
             * the copy becomes its own feature in the tree rather
             * than a second row carrying the original's name. It
             * returns the STORED object, not an id.
             */
            const { id } =
                enggDrawingState.addObject(
                    drawingState,
                    feature
                );

            feature.id = id;
            created.push(id);
        });

    if (!created.length) {
        return;
    }

    enggDrawingState.commitDrawingChange(
        drawingState,
        previous
    );

    /*
     * The copies become the selection, so what was just pasted
     * is selected and can be pasted again or edited straight
     * away, and the panel describes the new features.
     */
    enggDrawingState.selectObjects(
        drawingState,
        created
    );

    editorState.featurePanelView = "tree";
    editorState.featureTreePickedId = null;

    setToolMessage(
        created.length === 1
            ? "Pasted 1 feature"
            : `Pasted ${created.length} features`
    );

    renderProperties();
    renderCurrentDrawing();
}

export function cutSelectionToClipboard() {
    if (!copySelectionToClipboard()) {
        return;
    }

    deleteSelectedObjects();
}

/*
 * Duplicate the selection in place.
 *
 * This is a copy followed by a paste, so a duplicate is exactly
 * a pasted copy: the same fresh identity, the same offset, the
 * same parent re-pointing. There is deliberately no second
 * implementation of it, because a Duplicate that behaved
 * slightly differently from Copy then Paste is exactly the kind
 * of drift that makes an editing tool feel unpredictable.
 */
export function duplicateSelection() {
    if (!copySelectionToClipboard()) {
        return;
    }

    pasteFromClipboard();
}
