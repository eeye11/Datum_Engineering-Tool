/*
 * Selection, cancelling, and finishing a construction.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggAnnotationModel from "../model/annotations/annotation-model.js";
import enggPlotEditor from "../../../shared/ui/editors/plot-editor.js";
import { commitAnalysisAxis, commitAnalysisInput } from "../statics/analysis-tools.js";
import { finishProcessPath, isProcessPlotTool } from "../thermodynamics/process-path.js";
import { objectIntersectsSelection } from "./box-selection.js";
import { syncSelectionInteraction } from "./canvas-click.js";
import { renderCurrentDrawing, requestRender } from "../../../components/layout/workspace/canvas-render.js";
import { objectsByIds } from "../commands/clipboard-commands.js";
import { distance } from "../geometry/construction-geometry.js";
import { commitDimensionSelection } from "../annotate/dimension-placement.js";
import { allowsDirectManipulation } from "./direct-manipulation.js";
import { isDimensionTool } from "../annotate/dimension-tool.js";
import { drawingCanvas } from "../dom.js";
import { drawingState, editorState } from "../editor-state.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { currentEngineeringMetadata } from "../geometry/geometry-creation.js";
import { cancelManipulationDrag, isConstructionInProgress } from "./handles.js";
import { objectAtPoint, pickDerivedMagnitude } from "./hit-testing.js";
import { finishDistributedLoadConstruction, isLoadBuildPhase } from "../statics/load-tool.js";
import { cancelModifySession } from "../commands/modify-tools.js";
import { commitMomentPlacement } from "../geometry/preview.js";
import { canvasPointFromEvent } from "../../../components/layout/toolbar/tool-activation.js";
import { activeCategory, closeCoordinateSystemMenu, closePolygonSidesPrompt } from "../../../components/layout/toolbar/tool-menus.js";
import { renderEngineeringTools, setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";
import { finishTrussConstruction } from "../statics/truss-tool.js";
import { STATICS_CHILD_TOOLS } from "../statics/statics-tools.js";
import { clearGlobalToolHighlight } from "../../../components/layout/workspace/workspace-controls.js";
import { ROUTE_PHASE, finishRouteConstruction } from "./pipe-duct-tool.js";

/*
 * ========================================================
 * MOVING A MAGNITUDE LABEL BY ITS OWN TEXT
 * ========================================================
 *
 * A derived magnitude - "500 N" beside a force, "w1 = 5 kN/m" beside a
 * profile point - is drawn, not stored, so it is NOT in the selection and
 * the ordinary feature drag never sees it. It is picked by its own hit test
 * and moved by writing an offset onto the feature it belongs to.
 *
 * ONE GESTURE DOES BOTH: the press SELECTS the label and BEGINS its move,
 * so a student who wants the number somewhere else just grabs the number and
 * drags it. There is no separate "click to select, then drag" step.
 *
 * THE DRAG STARTS FROM WHERE THE TEXT CURRENTLY IS, with the click offset
 * preserved, so the label never jumps to its anchor or to the cursor before
 * following the pointer. See the note on `derived` below.
 */
function startDerivedAnnotationDrag(
    event,
    picked
) {
    const point =
        canvasPointFromEvent(
            event,
            false
        );

    if (!picked || !point) {
        return false;
    }

    /*
     * SELECT THE LABEL, so its tight editor box appears while it is dragged
     * and stays afterwards. The derived annotation's own id is what the
     * renderer and the hit test agree on, so selecting it here is the same
     * selection a click would make.
     */
    enggDrawingState.selectObject(
        drawingState,
        picked.annotation.id
    );

    editorState.selectionDrag = {
        pointerId: event.pointerId,
        start: point,
        current: point,
        moved: false,
        box: null,

        /*
         * The magnitude being moved, kept apart from `box` so the marquee
         * code does not try to draw one.
         *
         * WHICH MAGNITUDE is carried whole - the derived annotation itself,
         * which knows its own point. A varying load has one label per point,
         * so "the magnitude" is not enough to identify what is being
         * dragged: two of them answer to the same source feature, and only
         * the anchor tells them apart.
         *
         * THE DRAG BEGINS FROM WHERE THE LABEL CURRENTLY IS. A moved label
         * stores an offset from its automatic anchor, applied on top of the
         * anchor every frame; the label's ACTUAL CURRENT PLACEMENT is what
         * the drag adds the pointer's travel to, and the offset is re-derived
         * against the anchor, so the text starts exactly under the cursor and
         * never jumps back to the anchor first.
         */
        derived: {
            sourceFeatureId: picked.sourceFeatureId,
            annotation: picked.annotation,

            /*
             * The anchor the stored offset is measured from, taken fresh from
             * the model so the drag and the placement it writes agree about
             * where "naturally falls" is - a force whose scale changed while
             * the label sat away from it must not drag against the old anchor.
             */
            natural:
                enggAnnotationModel.annotationAnchor(
                    picked.annotation,
                    drawingState
                ) || picked.annotation.placement,

            /*
             * The label's ACTUAL CURRENT POSITION, which is where the drag
             * starts: clicking a moved label selects it exactly where it is.
             */
            placement: {
                ...picked.annotation.placement
            },

            offsetX: 0,
            offsetY: 0
        }
    };

    drawingCanvas.setPointerCapture(
        event.pointerId
    );

    /*
     * THE CLICK THAT FOLLOWS THE RELEASE BELONGS TO THIS GESTURE.
     *
     * A press-then-release on the canvas also fires a `click`, and with a
     * creation tool armed that click would be read as the tool's first point -
     * starting a new feature the moment the student finished moving a label.
     * The flag is honoured once by the click handler, so the gesture that moved
     * the number does not also create anything.
     */
    editorState.selectionClickSuppressed =
        true;

    renderProperties();
    renderCurrentDrawing();

    return true;
}

/*
 * Begin moving a magnitude label, if the press landed on one.
 *
 * Attempted BEFORE a creation tool's own press, because the text of a label
 * is a direct-manipulation target in its own right: grabbing "500 N" moves
 * the number, and must never start a new feature through it. A press that is
 * not on a label returns false, so creation, manipulation and selection all
 * carry on exactly as they did.
 */
/*
 * A STATICS TOOL BETWEEN FEATURES MAY GRAB A VALUE.
 *
 * Statics tools stay armed after placing, so "move the value I just made"
 * happens with the tool still active - and handing that press to the tool
 * started a NEW load under the number while the number stayed put. A press ON
 * a Statics value, while nothing is being constructed, moves the value;
 * anywhere else the armed tool still takes the press.
 */
function staticsToolBetweenFeatures() {
    return Boolean(
        STATICS_CHILD_TOOLS[drawingState.activeTool] &&
            drawingState.interaction.phase === "idle"
    );
}

export function beginAnnotationDrag(
    event
) {
    /*
     * ONLY SELECT MAY DRAG A MAGNITUDE LABEL.
     *
     * A label's text is a direct-manipulation target - grabbing "500 N" moves
     * the number - so while a creation tool is armed the press must belong to
     * that tool instead. Without this, starting a Line by pressing near a
     * force's magnitude moved the label rather than drawing, which is exactly
     * the accidental manipulation the active-tool rule exists to prevent.
     * (One exception: see `staticsToolBetweenFeatures`.)
     */
    if (!allowsDirectManipulation() && !staticsToolBetweenFeatures()) {
        return false;
    }

    if (
        event.button !== 0 ||
        event.shiftKey
    ) {
        return false;
    }

    const point =
        canvasPointFromEvent(
            event,
            false
        );

    if (!point) {
        return false;
    }

    /*
     * AN AXIS LABEL IS DRAGGED BY THE SAME INTERACTION AS ANY OTHER DRAWING
     * TEXT: press on the text and it follows the pointer. It is checked
     * alongside the magnitude labels, from the same hit test, so "click the
     * label to move it" is one rule rather than two.
     */
    const picked =
        pickDerivedMagnitude(
            point
        );

    if (!picked) {
        return false;
    }

    const selectedIds = drawingState.selection.selectedObjectIds;
    /*
     * A GROUP MOVES TOGETHER; ONE FEATURE'S NUMBER MOVES ALONE.
     *
     * With several features selected, a press on one of their labels moves
     * the whole group, label included. With only the label's own feature
     * selected, a press on the NUMBER means "move the number": handing it to
     * the feature drag instead carried a selected load off its beam whenever
     * a student tried to reposition its value.
     */
    if (selectedIds.length > 1 && selectedIds.includes(picked.sourceFeatureId)) {
        return false;
    }

    if (picked.type === "axis-label") {
        return startAxisLabelDrag(
            event,
            picked,
            point
        );
    }

    return startDerivedAnnotationDrag(
        event,
        picked
    );
}

/*
 * START DRAGGING AN AXIS LABEL.
 *
 * The label's position is ABSOLUTE - the coordinate system stores where its X
 * and Y labels were put, so the drag works the way every direct manipulation
 * works:
 *
 *     dragOffset = pointerAtPress - labelPositionAtPress
 *     newPosition = pointerNow - dragOffset
 *
 * The offset is what preserves the grab point: the label keeps the exact spot
 * under the cursor it was grabbed by, so it neither jumps to the pointer nor
 * flies away. The press position and the label's start position are both taken
 * ONCE, at the press, so nothing re-derives a position mid-drag and makes the
 * text stutter.
 */
function startAxisLabelDrag(event, picked, point) {
    const object = drawingState.objects.find(
        (candidate) => candidate.id === picked.sourceFeatureId
    );

    if (!object) {
        return false;
    }

    const start = {
        x: Number(picked.label.position?.x) || 0,
        y: Number(picked.label.position?.y) || 0
    };

    /*
     * SELECT THE LABEL, so its tight editor box appears while it is dragged and
     * stays afterwards - the same behaviour every other drawing-space text has.
     * The label's own pseudo-id is what the renderer and the hit test agree on.
     */
    enggDrawingState.selectObject(drawingState, picked.id);

    editorState.selectionDrag = {
        pointerId: event.pointerId,
        start: point,
        current: point,
        moved: false,
        box: null,

        axisLabel: {
            sourceFeatureId: picked.sourceFeatureId,
            axis: picked.axis,

            /*
             * `null` until the first move, so a press that never travels is a
             * click and writes nothing - which is what keeps the label at its
             * automatic place until the student actually moves it.
             */
            position: null,
            dragOffset: {
                x: point.x - start.x,
                y: point.y - start.y
            }
        }
    };

    drawingCanvas.setPointerCapture(event.pointerId);

    setToolMessage(
        picked.axis === "x" ? "Move X label" : "Move Y label"
    );

    return true;
}

export function beginSelectionDrag(
    event
) {
    /*
     * BOX SELECTION IS DIRECT MANIPULATION'S SIBLING, so it asks the same
     * question through the same function rather than stating the rule again.
     *
     * It used to compare the active tool to the string "select" inline, which
     * is the same answer today and a second place to change tomorrow - and the
     * test that pins "only Select interacts with what is drawn" reads the source
     * for ONE predicate, so a literal copy here is invisible to it.
     */
    if (
        !allowsDirectManipulation() ||
        event.button !== 0
    ) {
        return;
    }

    const point =
        canvasPointFromEvent(
            event
        );

    if (
        objectAtPoint(
            point
        )
    ) {
        /*
         * ========================================================
         * A DRAG THAT STARTS ON A MAGNITUDE BOX
         * ========================================================
         *
         * The box is not a feature, so it is not in `selectedObjectIds` and
         * moving the selection would move the FORCE instead - which is how a
         * student trying to shift a label ends up shifting a load.
         *
         * What is recorded is the SOURCE feature, where the box naturally
         * falls, and how far the pointer has travelled. Nothing is written
         * until the drag ends: the offset is applied to a copy on every
         * frame so the box follows the cursor live, and committed once on
         * release, which is what makes the whole drag one undo step rather
         * than one per frame.
         */
        const picked =
            pickDerivedMagnitude(
                point
            );

        if (picked) {
            startDerivedAnnotationDrag(
                event,
                picked
            );

            return;
        }

        return;
    }

    editorState.selectionClickSuppressed =
        false;

    editorState.selectionDrag = {
        pointerId:
            event.pointerId,

        start:
            point,

        current:
            point,

        moved:
            false,

        box: {
            start:
                point,

            end:
                point,

            minX:
                point.x,

            maxX:
                point.x,

            minY:
                point.y,

            maxY:
                point.y
        }
    };

    drawingCanvas.setPointerCapture(
        event.pointerId
    );

    syncSelectionInteraction();
}

export function updateSelectionDrag(
    event
) {
    if (
        !editorState.selectionDrag ||
        editorState.selectionDrag.pointerId !==
            event.pointerId
    ) {
        return;
    }

    const point =
        canvasPointFromEvent(
            event
        );

    const start =
        editorState.selectionDrag.start;

    const moved =
        distance(
            start,
            point
        ) > 1;

    editorState.selectionDrag.current =
        point;

    editorState.selectionDrag.moved =
        moved;

    /*
     * A MAGNITUDE DRAG: the label follows the pointer from where it already is.
     *
     * The value itself is still derived, so the box cannot be dragged into
     * disagreeing with the force it belongs to - moving it changes where the
     * number is, never what it says.
     *
     * THE TRAVEL IS A DELTA FROM THE PRESS, added to the label's position as
     * it was when the drag began - not the press position itself. So clicking
     * a little off-centre keeps that offset for the whole drag, and the label
     * is never snapped to the cursor.
     *
     * The offset that gets STORED is re-derived against the label's current
     * automatic anchor, because that is the frame the feature keeps it in.
     * Deriving it from the drag's own start instead discarded wherever the
     * student had already put the label, which is what made it jump back to
     * its anchor on the first frame.
     */
    /*
     * AN AXIS LABEL DRAG: the text follows the pointer, keeping the grab point.
     *
     * `position = pointerNow - dragOffset`, where the offset was measured once
     * at the press. That is what keeps the label under the exact spot on the
     * text the student grabbed, rather than snapping it to the cursor - and the
     * offset is applied to the position captured at the press, so a label that
     * had already been moved does not fly back to its automatic place first.
     *
     * Only the LABEL's position is written. The coordinate system's origin, its
     * axes and its scale are untouched, so moving a label never moves the
     * drawing it labels.
     */
    if (editorState.selectionDrag.axisLabel) {
        const drag = editorState.selectionDrag.axisLabel;

        const placed = {
            x: point.x - drag.dragOffset.x,
            y: point.y - drag.dragOffset.y
        };

        drag.position = placed;

        const source = drawingState.objects.find(
            (candidate) => candidate.id === drag.sourceFeatureId
        );

        if (source?.geometry) {
            if (drag.axis === "x") {
                source.geometry.xLabelPosition = { ...placed };
            } else {
                source.geometry.yLabelPosition = { ...placed };
            }
        }

        requestRender();

        return;
    }

    if (editorState.selectionDrag.derived) {
        const derivation =
            editorState.selectionDrag.derived;

        /*
         * WHERE THE LABEL IS NOW = where it was, plus how far the pointer has
         * travelled since the press.
         */
        const placed = {
            x:
                (derivation.placement?.x ?? start.x) +
                (point.x - start.x),
            y:
                (derivation.placement?.y ?? start.y) +
                (point.y - start.y)
        };

        /*
         * THE OFFSET IS RE-DERIVED AGAINST THE CURRENT ANCHOR, so the label
         * lands exactly on `placed` however the anchor has moved under it.
         */
        derivation.offsetX =
            placed.x - (derivation.natural?.x ?? placed.x);

        derivation.offsetY =
            placed.y - (derivation.natural?.y ?? placed.y);

        const source =
            objectsByIds([
                derivation.sourceFeatureId,
            ])[0];

        if (source) {
            source.geometry =
                source.geometry || {};

            /*
             * THE OFFSET IS STORED ON THE FEATURE, KEYED TO THIS LABEL.
             *
             * A varying load has one label per point, so the move is
             * written against the point this label belongs to - not as a
             * single offset for the whole load, which would drag every
             * label with the one the student grabbed.
             */
            /*
             * A LOAD PROFILE POINT'S LABEL IS STORED AS A PLACE, NOT AN OFFSET
             * (`profilePointPlacement`): its default follows the load's
             * direction, so the student's spot is kept absolutely. Writing the
             * offset from the anchor there made the label leap to that small
             * offset read as a position the moment the drag began, and only
             * then follow the cursor.
             */
            const absolute =
                Boolean(derivation.annotation?.anchorRef?.pointId);

            enggAnnotationModel.moveDerivedAnnotation(
                source,
                derivation.annotation,
                absolute
                    ? placed
                    : {
                          x: derivation.offsetX,
                          y: derivation.offsetY
                      }
            );

            requestRender();
        }

        return;
    }

    editorState.selectionDrag.box = {
        start,

        end:
            point,

        minX:
            Math.min(
                start.x,
                point.x
            ),

        maxX:
            Math.max(
                start.x,
                point.x
            ),

        minY:
            Math.min(
                start.y,
                point.y
            ),

        maxY:
            Math.max(
                start.y,
                point.y
            )
    };

    editorState.selectionClickSuppressed =
        editorState.selectionClickSuppressed ||
        moved;

    syncSelectionInteraction();

    if (moved) {
        setToolMessage(
            "Select components"
        );

        drawingState.selection
            .boxSelectionIds =
            drawingState.objects
                .filter(
                    object =>
                        objectIntersectsSelection(
                            object,
                            editorState.selectionDrag.box
                        )
                )
                .map(
                    object =>
                        object.id
                );

        renderProperties();
        requestRender();
    }
}

export function finishSelectionDrag(
    event
) {
    if (
        !editorState.selectionDrag ||
        editorState.selectionDrag.pointerId !==
            event.pointerId
    ) {
        return;
    }

    const currentSelection =
        editorState.selectionDrag;

    /*
     * ========================================================
     * A MOVED MAGNITUDE IS ONE UNDO STEP
     * ========================================================
     *
     * The offset was written to the feature on every frame of the drag, so
     * that the box follows the cursor. Undo is about ACTIONS, and "moved the
     * label" is one of them - recording a history entry per frame would fill
     * the Undo list with the intermediate positions of a single drag.
     *
     * So the state from BEFORE the drag is taken here, the drag is
     * committed against it, and the whole movement is one entry. A click
     * that did not move the box commits nothing at all.
     *
     * This is the same arrangement `commitMove` uses for the selection, and
     * deliberately so - a dragged label and a dragged beam are the same kind
     * of act to the student.
     */
    if (currentSelection.axisLabel) {
        /*
         * ONE UNDO STEP FOR THE WHOLE DRAG.
         *
         * The position was written on every frame so the text followed the
         * pointer; recording that per frame would fill Undo with the
         * intermediate positions of a single movement. So the state from BEFORE
         * the drag is snapshotted here and the drag committed against it, and a
         * press that never travelled commits nothing - the label simply keeps
         * the position it had.
         */
        if (currentSelection.moved && currentSelection.axisLabel.position) {
            const previous =
                enggDrawingState.snapshotDrawing(drawingState);

            enggDrawingState.commitDrawingChange(drawingState, previous);

            setToolMessage(
                currentSelection.axisLabel.axis === "x"
                    ? "Moved the X label"
                    : "Moved the Y label"
            );
        }

        editorState.selectionDrag = null;

        renderCurrentDrawing();

        return;
    }

    if (currentSelection.derived) {
        if (currentSelection.moved) {
            const previous =
                enggDrawingState
                    .snapshotDrawing(
                        drawingState
                    );

            /*
             * The offset is already on the feature from the move handler;
             * this records it as a change worth undoing.
             */
            enggDrawingState
                .commitDrawingChange(
                    drawingState,
                    previous
                );

            setToolMessage(
                "Moved the magnitude"
            );
        } else {
            /*
             * A click with no movement: the box goes back where it
             * naturally falls, so a nudge that was abandoned does not leave
             * the label a pixel out of place forever.
             */
            const source =
                objectsByIds([
                    currentSelection.derived
                        .sourceFeatureId,
                ])[0];

            if (source?.geometry) {
                /*
                 * Only THIS label's slot is cleared - one point of a
                 * varying load, or the whole feature for a single-magnitude
                 * one - so abandoning a nudge on one label cannot reset the
                 * positions of the others.
                 */
                enggAnnotationModel.resetDerivedAnnotation(
                    source,
                    currentSelection.derived.annotation
                );
            }

            setToolMessage(
                "Ready"
            );
        }

        editorState.selectionDrag =
            null;

        syncSelectionInteraction();

        renderProperties();
        renderCurrentDrawing();

        if (
            drawingCanvas.hasPointerCapture(
                event.pointerId
            )
        ) {
            drawingCanvas.releasePointerCapture(
                event.pointerId
            );
        }

        return;
    }

    if (
        currentSelection.moved
    ) {
        const ids =
            drawingState.objects
                .filter(
                    object =>
                        objectIntersectsSelection(
                            object,
                            currentSelection.box
                        )
                )
                .map(
                    object =>
                        object.id
                );

        enggDrawingState.selectObjects(
            drawingState,
            ids
        );
    }

    drawingState.selection
        .boxSelectionIds = [];

    if (
        drawingCanvas.hasPointerCapture(
            event.pointerId
        )
    ) {
        drawingCanvas.releasePointerCapture(
            event.pointerId
        );
    }

    editorState.selectionDrag =
        null;

    syncSelectionInteraction();

    setToolMessage(
        "Ready"
    );

    renderProperties();
    renderCurrentDrawing();
}

export function cancelInteraction() {
    /*
     * A DRAG-TO-CREATE GESTURE ENDS WITH THE OPERATION.
     *
     * The session exists so a release can commit the feature. Cancelling
     * removes the construction, so the session must go with it - otherwise
     * the next release anywhere on the canvas would try to complete a span
     * that no longer exists, and would swallow a click that belonged to
     * whatever the student started next.
     */
    editorState.creationDrag = null;

    editorState.creationDragConsumedClick = false;

    if (
        editorState.selectionDrag
    ) {
        if (
            drawingCanvas.hasPointerCapture(
                editorState.selectionDrag.pointerId
            )
        ) {
            drawingCanvas.releasePointerCapture(
                editorState.selectionDrag.pointerId
            );
        }

        editorState.selectionDrag =
            null;
    }

    /*
     * Any transient creation popup goes with the
     * cancelled operation.
     */
    closePolygonSidesPrompt();
    closeCoordinateSystemMenu();

    /*
     * So does a held guideline. It belongs to the construction
     * that raised it, and its timer must not outlive it - a
     * pending redraw would otherwise fire over whatever the
     * student has started next.
     */
    if (editorState.guidelineHoldTimer) {
        clearTimeout(editorState.guidelineHoldTimer);
        editorState.guidelineHoldTimer = null;
    }

    drawingState.interaction.guideline = null;

    /*
     * So does any modal an unfinished operation opened.
     */

    /*
     * So does the Plot Editor. It previews onto the sheet, so leaving it
     * open across a tool switch would leave half-typed equations drawn on
     * the drawing with nothing on screen to account for them.
     */
    enggPlotEditor?.close();

    /*
     * A running Modify session is part of the
     * unfinished operation, so it is abandoned too.
     */
    cancelModifySession();

    /*
     * An in-flight manipulation drag has already moved
     * real geometry, so it must be rolled back rather
     * than merely abandoned.
     */
    cancelManipulationDrag();

    /*
     * The active tool highlight always goes with the
     * cancelled operation.
     */
    clearGlobalToolHighlight();

    enggDrawingState.clearInteraction(
        drawingState
    );

    drawingState.selection
        .boxSelectionIds = [];

    drawingState.selection
        .hoveredObjectId = null;

    enggDrawingState.clearSelection(
        drawingState
    );

    /*
     * Cancelling always returns to Select, so the user
     * is never left inside a half-finished tool.
     */
    enggDrawingState.setActiveTool(
        drawingState,
        "select"
    );

    setToolMessage(
        "Select geometry"
    );

    renderEngineeringTools(
        activeCategory()
    );

    renderProperties();
    renderCurrentDrawing();
}

/*
 * ========================================================
 * SWITCHING TOP-LEVEL CATEGORY RESETS THE ACTIVE TOOL
 * ========================================================
 *
 * The active tool must always belong to the category the student is looking at.
 * Choosing Geometry while a Statics tool is running leaves two things true at
 * once - the canvas belongs to Geometry, the tool belongs to Statics - and the
 * next press would create a Statics feature with a Geometry tool highlighted, or
 * the reverse. So a category switch ABANDONS the previous tool and establishes
 * a clean interaction state:
 *
 *   - any unfinished construction is cancelled and its preview removed;
 *   - creation-specific mouse state is cleared;
 *   - temporary control handles go with it;
 *   - the previous tool stops responding to mouse events;
 *   - Select becomes active, and owns canvas interaction, in the new category.
 *
 * NOTHING ABOUT THE DRAWING CHANGES. This is why it is NOT `cancelInteraction`
 * verbatim: that also clears the SELECTION, which is an interaction state a
 * category switch has no reason to throw away - a student inspecting a beam
 * should still have it selected after glancing at the Statics tools and coming
 * back. So the selection, the hover and the document are all left exactly as
 * they were, and only the tool and any half-built operation are reset.
 *
 * The re-render reads the category from the DOM, so the caller must have set the
 * new category's button active BEFORE calling this - which is the order the
 * toolbar uses, and the order that makes the tool list and the reset agree about
 * which category Select now belongs to.
 */
export function resetActiveToolForCategory() {
    /*
     * A drag-to-create gesture ends with the operation, so the session goes
     * with it - otherwise the next release anywhere would try to complete a
     * span that no longer exists.
     */
    editorState.creationDrag = null;
    editorState.creationDragConsumedClick = false;

    if (editorState.selectionDrag) {
        if (
            drawingCanvas.hasPointerCapture(
                editorState.selectionDrag.pointerId
            )
        ) {
            drawingCanvas.releasePointerCapture(
                editorState.selectionDrag.pointerId
            );
        }

        editorState.selectionDrag = null;
    }

    /*
     * Transient creation popups belong to the abandoned tool, so they go too.
     */
    closePolygonSidesPrompt();
    closeCoordinateSystemMenu();

    if (editorState.guidelineHoldTimer) {
        clearTimeout(editorState.guidelineHoldTimer);
        editorState.guidelineHoldTimer = null;
    }

    drawingState.interaction.guideline = null;

    /*
     * A running Modify session is part of the unfinished operation.
     */
    cancelModifySession();

    /*
     * An in-flight manipulation drag has already moved real geometry, so it is
     * rolled back rather than abandoned.
     */
    cancelManipulationDrag();

    clearGlobalToolHighlight();

    /*
     * THE CONSTRUCTION IS CLEARED, NOT THE SELECTION.
     *
     * `clearInteraction` removes the half-built operation - its phase, its
     * preview, its points - while the selection is left alone, which is the
     * whole difference between a category switch and a cancel.
     */
    enggDrawingState.clearInteraction(drawingState);

    drawingState.selection.boxSelectionIds = [];

    /*
     * SELECT IS NOW THE ACTIVE TOOL. The previous tool can no longer respond
     * to a mouse event, because this is the field the pointer handlers read.
     */
    enggDrawingState.setActiveTool(drawingState, "select");

    setToolMessage("Select geometry");

    renderEngineeringTools(activeCategory());

    renderProperties();
    renderCurrentDrawing();
}

/*
 * Complete whatever construction is running, if it can be
 * completed.
 *
 * Returns true when something was actually finished, so the
 * caller knows whether Enter did anything.
 *
 * The question each construction has to answer is "is this
 * complete enough to commit?", not "do I exist?". A truss with
 * a single member is not a truss, a polyline with one point is
 * not a polyline, and a load with no distribution point on it
 * measures nothing. Committing any of those would put something
 * on the drawing that the student did not draw, so those are
 * left running and Enter is a no-op for them.
 */
export function finishActiveConstruction() {
    if (isProcessPlotTool(drawingState.activeTool)) return finishProcessPath();
    const interaction =
        drawingState.interaction;

    /*
     * DIMENSION REFERENCE SELECTION. Enter is the commit point:
     * it means "use what I picked" rather than "pick one more".
     *
     * It is checked BEFORE the phase test because the dimension tool
     * records its stage in `dimensionStage`, not in `phase` - so
     * `isConstructionInProgress` is false while references are being
     * collected, and a check that relied on it would never fire.
     *
     * ARMED counts too. A single measurable object previews its own
     * measurement at once, but Enter is still an honest way to say "place
     * this one now" - the deliberate workflow is kept, not removed.
     */
    if (
        isDimensionTool(drawingState.activeTool) &&
        (interaction?.dimensionStage === "selecting" ||
            interaction?.dimensionStage === "armed")
    ) {
        return commitDimensionSelection();
    }

    if (
        !interaction ||
        !isConstructionInProgress()
    ) {
        return false;
    }

    const phase = interaction.phase;

    /*
     * THE ANALYSIS INPUT-SELECTION STATE.
     *
     * Enter is the "use what I picked" point for a Resultant or a Force
     * Components pair: the student has clicked the force(s) they mean, and
     * Enter commits. It is checked here rather than through
     * `isConstructionInProgress` because that asks about a SHAPE being drawn,
     * and this is a selection being confirmed - the same distinction the
     * dimension reference selection makes.
     */
    if (phase === "analysis-input") {
        return commitAnalysisInput();
    }

    /*
     * THE ANALYSIS AXIS, PLACED.
     *
     * Enter means "done" for anything being built, and an axis waiting
     * to be placed is a thing being built. So it is finished here, by
     * the same rule that finishes a truss or a polyline, rather than
     * by a special case at the keyboard handler - which is what makes
     * Escape, the status line and the preview agree that the axis is
     * a live construction.
     *
     * It commits at the height the student chose, which is the same
     * position the preview was showing, because both are read from
     * `placementY`.
     */
    if (phase === "analysis-axis") {
        return commitAnalysisAxis();
    }

    /*
     * A MOMENT BEING SIZED: Enter commits it.
     *
     * The same rule as everything else being built - Enter means
     * "this is finished" - so a student who has the radius they want
     * does not have to find somewhere to click.
     */
    if (phase === "moment-radius") {
        return commitMomentPlacement();
    }

    if (phase === "truss-construct") {
        const members =
            interaction.trussMembers || [];

        /*
         * One member is a line, not a truss. Requiring two
         * matches what a click would do, so Enter and a
         * finishing click agree about when the structure is
         * real.
         */
        if (members.length < 2) {
            setToolMessage(
                "A truss needs at least two members"
            );

            return false;
        }

        finishTrussConstruction();
        return true;
    }

    /*
     * A PIPE / DUCT PATH IS FINISHED BY THE SAME RULE.
     *
     * Enter means "done" for anything being drawn, so an armed Pipe / Duct
     * tool is finished here rather than by a special case at the keyboard
     * handler. Each run was committed as it was released, so there is nothing
     * half-built to guard: finishing only clears the continuation and the tool
     * stays armed for a fresh path.
     */
    if (
        phase === ROUTE_PHASE ||
        interaction.fluidsTool === "pipe-duct"
    ) {
        finishRouteConstruction();
        return true;
    }

    if (isLoadBuildPhase(interaction)) {
        /*
         * Only the VARYING load can be finished with Enter.
         *
         * The constant load's steps are click-driven - start, end, direction
         * - and Enter has nothing to finish: magnitude is typed in the
         * panel and the direction is chosen on the canvas. Enter used to
         * commit a constant load straight from the build phase, which is
         * what created one with a defaulted direction the student never
         * chose.
         */
        const points =
            interaction
                .distributedLoadPoints ||
            [];

        if (!points.length) {
            return false;
        }

        finishDistributedLoadConstruction();

        return true;
    }

    /*
     * A polyline is identified by its TOOL rather than by a
     * phase of its own: it has no stage after the first point,
     * it simply accumulates points until the student says
     * they have had enough. finishPolyline makes that same
     * judgement, so this only decides whether to ask.
     */
    if (
        drawingState.activeTool ===
            "polyline"
    ) {
        const points =
            interaction.points || [];

        if (points.length < 2) {
            return false;
        }

        finishPolyline();
        return true;
    }

    return false;
}

/*
 * Clear the selection when something is selected and nothing
 * is being built.
 *
 * This is the second half of "Enter means done". A feature
 * stays selected after it is created, so the drawing very often
 * opens a moment with something highlighted that the student
 * has already finished with. Enter then says so.
 *
 * It deliberately does NOT check whether the feature was
 * "just" created. Anything selected counts, because the
 * gesture is the same either way and the outcome is the same:
 * the feature is left exactly as it is and the selection goes
 * away. Restricting it to a short window would make the key
 * work once and then do nothing, which reads as a broken
 * shortcut rather than a deliberate one.
 */
export function deselectIfJustCreated() {
    if (
        isConstructionInProgress()
    ) {
        return false;
    }

    /*
     * A dialog owns the keyboard while it is open. Enter
     * belongs to the dialog's own confirm and cancel.
     */
    if (
        enggPlotEditor?.isOpen?.()
    ) {
        return false;
    }

    if (
        !drawingState.selection
            .selectedObjectIds.length
    ) {
        return false;
    }

    enggDrawingState.clearSelection(
        drawingState
    );

    renderProperties();
    renderCurrentDrawing();

    return true;
}

export function finishPolyline() {
    const points =
        drawingState.interaction.points;

    if (
        drawingState.activeTool !==
            "polyline" ||
        points.length < 2
    ) {
        return;
    }

    const previousObjects =
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    enggDrawingState.addObject(
        drawingState,

        enggDrawingState.geometryFactories.polyline(
            [
                ...points
            ],

            {
                style: {
                    ...drawingState.styleDefaults
                },

                engineering:
                    currentEngineeringMetadata()
            }
        )
    );

    enggDrawingState.commitDrawingChange(
        drawingState,
        previousObjects
    );

    enggDrawingState.clearInteraction(
        drawingState
    );

    setToolMessage(
        "Ready"
    );

    renderProperties();
    renderCurrentDrawing();
}
