/*
 * Dragging a feature or one of its handles.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import { isDerivedFeature } from "../../../shared/model/feature-types.js";
import enggAnnotate from "../model/annotations/annotate-model.js";
import { renderCurrentDrawing, requestRender } from "../../../components/layout/workspace/canvas-render.js";
import { COORDINATE_SYSTEM_TYPE } from "../constants.js";
import { allowsDirectManipulation } from "./direct-manipulation.js";
import { drawingCanvas } from "../dom.js";
import { drawingState, editorState } from "../editor-state.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { handleAtPoint, isConstructionInProgress, rectangleCorners } from "./handles.js";
import { processLabelPoint } from "../model/thermodynamics/process-labels.js";
import { processBendPoint, setProcessBendFromPoint } from "../model/thermodynamics/process-curves.js";
import { selectionBounds, selectionCorners, selectionMembers, transformSelectionObject } from "../../../shared/selection/selection-transform.js";
import { isPistonCylinder, setPistonFromPoint, setStoppersFromPoint } from "../model/thermodynamics/piston-cylinder.js";
import { isRectangleLike, objectAtPoint } from "./hit-testing.js";
import { resolveManipulationPoint, resolvePointerEvent, scheduleGuidelineExpiry, updateInteractionFeedback } from "./pointer.js";
import { applyRigidBodyHandle, applyStaticsManipulation, isStaticsFeature, moveTrussJoint } from "../statics/statics-attachment.js";
import { rotationPivotFor } from "./handles.js";
import { rotateObjectAbout } from "../geometry/transforms.js";
import { canvasPointFromEvent } from "../../../components/layout/toolbar/tool-activation.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";
import { CONTINUATION_TOLERANCE, pipeEndAt, applyManualElbowConnections, applyElbowRadius, elbowMaxBendRadius, refreshManualElbow, reconcileFluidConnections, updateElbowForPair, joiningCornerOf, reseatElbowPipes } from "./pipe-duct-tool.js";
import enggPipeDuct from "../model/fluids/pipe-duct.js";
import enggFlowArrow from "../model/fluids/flow-arrow.js";
import enggReducer from "../model/fluids/reducer-expander.js";
import enggEquipment from "../model/fluids/inline-equipment.js";
import enggVessel from "../model/fluids/reservoir-tank.js";
import enggFluidLevel from "../model/fluids/fluid-level.js";
import enggFlowArrows from "../model/fluids/flow-arrows.js";
import enggPressureProfile from "../model/fluids/pressure-profile.js";
import enggSectionPlane from "../model/fluids/section-plane.js";
import { createJunctionForInteriorConnection } from "./junction-tool.js";

export function beginManipulationDrag(
    event
) {
    /*
     * ONLY SELECT MAY DRAG WHAT IS ALREADY DRAWN.
     *
     * While a creation tool is armed, a press belongs to that tool - so this
     * whole direct-manipulation path is closed to everything but Select. See
     * `direct-manipulation.js` for the rule and why it is asked in one place.
     *
     * It is checked FIRST, ahead of the Modify-session and in-progress
     * guards below, so that no branch of this
     * function can be reached by a press that the active tool should have
     * received. A press that lands here with a creation tool armed must not
     * move a handle, a body, a magnitude label or a dimension - the tool gets
     * the interaction instead.
     */
    if (!allowsDirectManipulation()) {
        return false;
    }

    if (
        event.button !== 0 ||
        event.shiftKey
    ) {
        return false;
    }

    /*
     * A running Modify session owns the pointer, so
     * direct manipulation stays out of its way.
     */
    if (editorState.modifySession) {
        return false;
    }

    /*
     * A construction already UNDER WAY owns the pointer: its first point is
     * down and its second is expected, so the click belongs to it.
     *
     * This is now a second, narrower guard rather than the whole rule. The rule
     * is that only Select may directly manipulate an existing feature at all
     * (see the `allowsDirectManipulation` check above); this remains because a
     * Modify session or an in-progress construction is the one state in which
     * even a Select press must not begin a manipulation drag.
     */
    if (isConstructionInProgress()) {
        return false;
    }

    const point =
        canvasPointFromEvent(
            event,
            false
        );

    const selectedIds = drawingState.selection.selectedObjectIds;
    const box = selectionBounds(drawingState.objects, selectedIds);
    const hit = handleAtPoint(point);
    const pistonHandle = hit && isPistonCylinder(hit.object) &&
        ["piston-height", "stopper-height"].includes(hit.handle.kind);
    const processLabelHandle = hit?.handle.kind.startsWith("process-label-") || hit?.handle.kind.startsWith("process-bend-");
    if (selectedIds.length > 1 && box && !pistonHandle && !processLabelHandle) {
        const tolerance = 9 / (enggDrawingState.BASE_PIXELS_PER_UNIT * drawingState.camera.zoom);
        const corners = selectionCorners(box);
        const corner = corners.findIndex(value => Math.hypot(value.x - point.x, value.y - point.y) <= tolerance);
        const inside = point.x >= box.minX && point.x <= box.maxX && point.y >= box.minY && point.y <= box.maxY;
        if (corner >= 0 || inside) {
            const members = selectionMembers(drawingState.objects, selectedIds);
            if (members.some(item => item.locked || isDerivedFeature(item))) {
                setToolMessage("Unlock the selection and remove derived features before moving or resizing it");
                return true;
            }
            editorState.manipulationDrag = {
                pointerId: event.pointerId, object: members[0],
                kind: corner >= 0 ? "group-resize" : "body", group: true,
                corner, bounds: box, start: { ...point }, anchor: { ...point }, moved: false,
                originals: Object.fromEntries(members.map(item => [item.id, structuredClone(item)]))
            };
            drawingCanvas.setPointerCapture(event.pointerId);
            return true;
        }
    }

    /*
     * A DERIVED CHILD IS NEVER DRAGGED.
     *
     * A Resultant and a Force Components pair are static children of the
     * force(s) they read: position, direction and magnitude are all re-derived
     * from those parents on every refresh. A drag would either be wiped by the
     * next refresh or survive as a lie about where the reading belongs.
     *
     * Refused ahead of BOTH drag shapes - a handle and the body - so the child
     * stays put; it is still selectable, inspectable and deletable.
     */
    const underPointer =
        objectAtPoint(
            point
        );

    if (isDerivedFeature(underPointer)) {
        setToolMessage(
            `${underPointer.name || "This feature"} is derived from its source force - change the force instead`
        );

        return false;
    }

    /*
     * A LOCKED FEATURE DOES NOT MOVE.
     *
     * Locking is about SPATIAL manipulation and nothing else: a locked feature
     * is still selectable, still inspectable, still listed in the tree, and its
     * properties are still editable through the panel - the lock stops it being
     * dragged, which is what makes it a way to protect a finished part of a
     * drawing while working around it.
     *
     * The check is made here, at the ONE place every manipulation drag begins,
     * rather than in each handle's own branch. A handle added next month is
     * therefore covered without anyone remembering to check.
     */
    const locked =
        (hit && hit.object && hit.object.locked) ||
        (() => {
            const under = objectAtPoint(point);

            return under && under.locked ? under : null;
        })();

    if (locked) {
        setToolMessage(
            `${locked.name || "This feature"} is locked. Unlock it to move it.`
        );

        return false;
    }

    if (hit) {
        /*
         * originals is keyed by object id so the commit
         * path can restore any drag shape uniformly.
         */
        editorState.manipulationDrag = {
            pointerId: event.pointerId,
            object: hit.object,
            kind: hit.handle.kind,

            moved: false,
            start: { ...point },

            /*
             * THE DRAG'S STABLE INFERENCE REFERENCE.
             *
             * A handle drags ONE POINT of the feature, so the point being
             * manipulated is its own alignment reference: the movement is
             * squared to the row or column the handle STARTED on, which is
             * how a student drags an endpoint exactly level with where it
             * was. It is captured here, once, and never re-read - a reference
             * that followed the cursor could only ever measure the cursor
             * against itself.
             */
            anchor: hit.handle.point
                ? { x: hit.handle.point.x, y: hit.handle.point.y }
                : { ...point },

            /*
             * A ROTATION DRAG MEASURES FROM THE ANGLE OF THE GRAB.
             *
             * The pivot is the object's own (see `rotationPivotFor`), and the
             * starting angle is the direction from that pivot to where the
             * handle was pressed. Captured once here, so the first move turns
             * the object by the angle the student has actually swept rather
             * than snapping it under their hand.
             */
            rotationStartAngle:
                hit.handle.kind === "rotate"
                    ? (() => {
                          const pivot = rotationPivotFor(hit.object);

                          return pivot
                              ? Math.atan2(
                                    hit.handle.point.y - pivot.y,
                                    hit.handle.point.x - pivot.x
                                )
                              : null;
                      })()
                    : undefined,

            /*
             * The WHOLE object is snapshotted, not just its geometry.
             *
             * A drag can move more than a shape: an annotation moves by
             * its placement, a dimension by its offset, and neither of
             * those lives in `geometry`. Snapshotting geometry alone
             * left those changes outside the undo entry, so moving an
             * annotation could not be undone - the one action the
             * student performs most on a label, and the one the
             * specification singles out.
             *
             * Cloning the whole object is the same cost as cloning its
             * geometry and is correct for every feature type, present
             * and future, whatever part of them the drag happens to
             * touch.
             */
            originals: {
                [hit.object.id]:
                    JSON.parse(
                        JSON.stringify(
                            hit.object
                        )
                    )
            }
        };

        drawingCanvas.setPointerCapture(
            event.pointerId
        );

        return true;
    }

    /*
     * ========================================================
     * A DIMENSION IS MOVED BY PRESSING ITS NUMBER
     * ========================================================
     *
     * A coordinate dimension is a thin line with a number on it, and the
     * number is what the student aims at. Pressing it and dragging moves the
     * dimension, with no selecting click first - the press both selects and
     * begins the move.
     *
     * This is claimed for a DIMENSION ONLY, and only when the press is on the
     * dimension itself. Every other feature keeps the rule below, where a
     * press on a selected feature is armed as a possible body drag: claiming
     * that unconditionally is what once stopped a Statics tool receiving its
     * own click.
     *
     * It is armed, not performed: the drag becomes a move only when the
     * pointer actually travels, so a press that stays put is still a click -
     * which selects the dimension, exactly as a click on it always did.
     */
    const overlay =
        objectAtPoint(
            point
        );

    if (
        overlay?.type === "dimension" ||
        overlay?.type === "annotate"
    ) {
        /*
         * ARMED, NOT CLAIMED.
         *
         * The pointer is NOT captured here, and the dimension is not yet
         * moved. A press that stays put must remain an ordinary click - and,
         * when it is the first of a pair, must leave the browser free to fire
         * the `dblclick` that opens the value editor. Capturing the pointer on
         * the press is what stopped that: the capture redirected the second
         * click, so the editor could never be opened by double-clicking the
         * number.
         *
         * The move begins on the first `pointermove` that actually travels,
         * in `updateManipulationDrag`, which is where the drag is promoted.
         *
         * AN ANNOTATE FEATURE IS ARMED THE SAME WAY. A note, a leader or a
         * table is dragged to reposition it, which is an offset move like a
         * dimension's - the press arms it and the first real movement starts
         * it, so a press that stays put is still a click that selects.
         */
        editorState.manipulationDrag = {
            pointerId: event.pointerId,
            object: overlay,
            kind: "annotation-offset",
            moved: false,
            pending: true,
            start: { ...point },

            /*
             * A dimension and an annotate feature follow the cursor exactly
             * and do not snap (see `updateManipulationDrag`), so they keep a
             * reference only for symmetry - it is never consulted.
             */
            anchor: { ...point },
            originals: {
                [overlay.id]:
                    JSON.parse(
                        JSON.stringify(
                            overlay
                        )
                    )
            }
        };

        return true;
    }

    /*
     * Dragging the body of a selected object translates the
     * whole selection.
     *
     * This only claims the press when the object is ALREADY
     * selected. A press on a selected feature is ambiguous: it
     * is equally a click that a drawing tool may want, since the
     * feature the user has just drawn stays selected and its
     * next click is very often at or near it.
     *
     * Claiming it unconditionally meant that choosing a tool
     * and clicking to use it did nothing whenever the thing
     * under the cursor happened to be selected, and a Statics
     * tool asking for a body could never receive its own click.
     *
     * A drag is distinguished from a click by MOVEMENT, and
     * movement is judged once the pointer has actually travelled
     * in updateManipulationDrag. So the drag is armed here, and
     * only becomes a manipulation if the pointer moves; a press
     * that stays put is left for the tool.
     */
    const object = overlay;

    if (
        object &&
        drawingState.selection
            .selectedObjectIds
            .includes(
                object.id
            )
    ) {
        editorState.manipulationDrag = {
            pointerId: event.pointerId,
            object,
            kind: "body",
            moved: false,
            start: { ...point },

            /*
             * WHOLE-FEATURE MOVE: the inference reference is where the student
             * GRABBED the feature.
             *
             * A body drag translates everything by the pointer's delta from
             * the press, so aligning the cursor to the grab point's row or
             * column moves the feature exactly horizontally or vertically
             * from where it was picked up - which is the gesture the task
             * describes as "drag it approximately horizontally".
             */
            anchor: { ...point },
            originals: Object.fromEntries(
                selectionMembers(drawingState.objects,
                    drawingState.selection
                        .selectedObjectIds
                ).map(
                    item => [
                        item.id,
                        JSON.parse(
                            JSON.stringify(
                                item
                            )
                        )
                    ]
                )
            )
        };

        drawingCanvas.setPointerCapture(
            event.pointerId
        );

        return true;
    }

    return false;
}

/*
 * Live-update geometry while a manipulation drag is in
 * progress, resolving the cursor through the existing
 * snap/inference pipeline.
 */
export function updateManipulationDrag(
    event
) {
    if (
        !editorState.manipulationDrag ||
        editorState.manipulationDrag.pointerId !==
            event.pointerId
    ) {
        return;
    }

    /*
     * A DIMENSION FOLLOWS THE CURSOR EXACTLY.
     *
     * Every other manipulation writes a VALUE that snapping may legitimately
     * constrain - an endpoint lands on a joint, a body sits on a grid line.
     * A dimension's drag writes a DRAWING position: it says where the number
     * is printed, not what the number measures. Snapping it would pull the
     * text onto whatever geometry happened to be near, so a small drag could
     * jump the label somewhere the student never pointed - and the further
     * they dragged, the more the label would wander from the cursor.
     *
     * So a dimension is moved from the RAW pointer, and the drag offset keeps
     * the text exactly where it was grabbed.
     */
    const draggingDimension =
        editorState.manipulationDrag.object
            ?.type === "dimension";

    /*
     * AN ANNOTATE FEATURE ALSO FOLLOWS THE CURSOR EXACTLY.
     *
     * Its placement is where the mark is printed, not a measurement, so
     * snapping it would pull the words onto whatever geometry happened to
     * be near. Moved from the raw pointer, with the grab offset preserved,
     * so the mark never jumps under the cursor.
     */
    const draggingAnnotate =
        editorState.manipulationDrag.object
            ?.type === "annotate";

    /*
     * GEOMETRY IS RESOLVED THROUGH THE SHARED SNAP PIPELINE.
     *
     * A feature, an endpoint and a body all write REAL geometry, so snapping
     * may legitimately constrain them - the same way it constrains a feature
     * being drawn. The drag's captured reference is fed in as the anchor, so
     * horizontal and vertical inference runs relative to where the drag began
     * AND the ordinary snap candidates are still available.
     *
     * The dimension and the annotate case keep the raw pointer, because what
     * they write is a DRAWING position rather than a measurement - see the
     * two comments above.
     */
    const resolution =
        editorState.manipulationDrag.group || editorState.manipulationDrag.kind === "body"
            ? { rawPointerPoint: canvasPointFromEvent(event, false), effectiveConstructionPoint: canvasPointFromEvent(event, false), snapCandidate: null, inference: null, guideline: null }
            : draggingDimension || draggingAnnotate
            ? resolvePointerEvent(event)
            : resolveManipulationPoint(
                  event,
                  editorState.manipulationDrag
              );

    const point =
        draggingDimension || draggingAnnotate
            ? resolution.rawPointerPoint ||
              resolution.effectiveConstructionPoint
            : resolution.effectiveConstructionPoint;

    if (!point) {
        return;
    }

    /*
     * THE GUIDE IS DRAWN FROM THE DRAG, TOO.
     *
     * A horizontal or vertical inference is a line on the screen as well as a
     * constraint, and the renderer reads it from the interaction. Setting it
     * here is what puts the alignment guide and the snap marker up while the
     * feature is dragged; clearing it when there is no inference is what takes
     * them down again, so the guide can never outlive the snap it describes.
     *
     * `setInteraction` is the same path a construction uses, so the guideline
     * hold and its expiry timer behave identically for a drag.
     */
    if (!draggingDimension && !draggingAnnotate) {
        enggDrawingState.setInteraction(
            drawingState,
            {
                snapCandidate: resolution.snapCandidate,
                inference: resolution.inference,
                guideline: resolution.guideline
            }
        );

        scheduleGuidelineExpiry(
            resolution.guideline
        );
    }

    /*
     * THE DRAG BEGINS ON THE FIRST REAL MOVEMENT.
     *
     * A dimension press arrives here as a PENDING drag - armed on the press
     * but not yet a move, so that a press which stays put can still be a click
     * or the first half of a double-click. The first move that actually
     * travels promotes it: the pointer is captured, the dimension is selected,
     * and from here on it is a live drag.
     */
    if (editorState.manipulationDrag.pending) {
        editorState.manipulationDrag.pending =
            false;

        enggDrawingState.selectObject(
            drawingState,
            editorState.manipulationDrag.object.id
        );

        try {
            drawingCanvas.setPointerCapture(
                event.pointerId
            );
        } catch (error) {
            /*
             * A pointer already released cannot be captured, which is
             * harmless: the drag simply does not continue.
             */
        }
    }

    editorState.manipulationDrag.moved =
        true;

    applyManipulation(
        editorState.manipulationDrag,
        point
    );

    updateInteractionFeedback(
        resolution
    );

    requestRender();
}

/*
 * ================================================================
 * THE RELEASE ENDS THE DRAG, AND COMMITS IT
 * ================================================================
 *
 * A body drag used to stay live after release - the selection followed the
 * pointer until a second "placing" click. Nothing was recorded until that
 * click, so Ctrl+Z in between undid the step BEFORE the move (usually the
 * shape's creation) and the shape vanished. The release is now the commit:
 * one gesture, one undo entry. Click-move-click moving is the Move tool's job.
 */
export function finishManipulationDrag(
    event
) {
    if (
        !editorState.manipulationDrag ||
        editorState.manipulationDrag.pointerId !==
            event.pointerId
    ) {
        return;
    }

    const drag =
        editorState.manipulationDrag;

    editorState.manipulationDrag =
        null;

    /*
     * THE DRAG'S TRANSIENT SNAP STATE IS CLEARED WITH IT.
     *
     * A guide, a snap marker and an inference label are all pictures of the
     * drag that has just ended. Left behind they would sit on the drawing
     * describing a relationship nothing is holding any more - which is the
     * "snap status stuck on screen" report in its drag form. So the moment the
     * drag is over, the transient state goes with it and one redraw puts the
     * drawing back to plain.
     */
    enggDrawingState.setInteraction(
        drawingState,
        {
            snapCandidate: null,
            inference: null,
            guideline: null
        }
    );

    if (
        drawingCanvas.hasPointerCapture(
            event.pointerId
        )
    ) {
        drawingCanvas.releasePointerCapture(
            event.pointerId
        );
    }

    if (!drag.moved) {
        /*
         * The pointer never travelled, so this was a CLICK on a
         * feature rather than a drag of it.
         *
         * The press was armed as a possible drag, but a drag is
         * defined by movement and there was none. The click is
         * therefore handed back to the tool that was waiting for
         * it, which is what lets a Statics tool ask for the body
         * it loads and receive a click on the very feature the
         * student has just drawn.
         *
         * The suppression flag is what stops a real drag from
         * also placing a point, so it is cleared for a press that
         * turned out not to be a drag.
         */
        editorState.selectionClickSuppressed =
            false;

        /*
         * A PRESS ON A DIMENSION THAT DID NOT MOVE IS A CLICK, so it selects
         * the dimension. The double-click path then opens the value editor
         * with the dimension already selected, and a single click leaves it
         * selected with its handles shown - which is what a click on a
         * dimension has always meant.
         */
        if (drag.object?.type === "dimension") {
            enggDrawingState.selectObject(
                drawingState,
                drag.object.id
            );

            renderProperties();
            renderCurrentDrawing();
        }

        return;
    }

    /*
     * The geometry changed live during the drag, so the
     * history entry has to record the geometry as it was
     * BEFORE the drag. drag.originals holds exactly that,
     * so the current objects are restored to their
     * originals, that pre-drag state is pushed onto the
     * undo stack, and the dragged result is then put back.
     */
    const dragged =
        JSON.parse(
            JSON.stringify(
                drawingState.objects
            )
        );

    const originalObjects =
        drawingState.objects.map(
            object =>
                drag.originals[object.id]
                    ? {
                        /*
                         * The pre-drag OBJECT, not just its geometry -
                         * an annotation's move lives in its placement,
                         * and an undo entry holding only geometry would
                         * leave the moved label where it was.
                         *
                         * id and style stay live, as when cancelling.
                         */
                        ...JSON.parse(
                            JSON.stringify(
                                drag.originals[
                                    object.id
                                ]
                            )
                        ),
                        id: object.id,
                        style: object.style
                    }
                    : drag.elbowRuns?.[object.id]
                    ? {
                        /*
                         * A PIPE THE DRAG RE-CUT IS RESTORED WITH THE FITTING.
                         *
                         * A radius drag moves each joined pipe's tangent end,
                         * its trim, its seam and its span. An undo entry holding
                         * only the fitting would put the old arc back over pipes
                         * still cut for the new one - the "partial geometry" an
                         * undone edit must never leave.
                         */
                        ...JSON.parse(
                            JSON.stringify(
                                drag.elbowRuns[
                                    object.id
                                ]
                            )
                        ),
                        id: object.id,
                        style: object.style
                    }
                    : object
        );

    enggDrawingState.commitDrawingChange(
        drawingState,
        originalObjects
    );

    drawingState.objects =
        dragged;

    /*
     * A RELEASED ELBOW END RE-ESTABLISHES ITS CONNECTIONS.
     *
     * An end let go ON a pipe's endpoint is joined to that pipe - including a
     * pipe it was not joined to before - and one let go in open space is
     * detached. The check runs against the point the pointer was released at,
     * BEFORE the snap re-anchored anything, so the student's own decision is
     * what is read rather than the held-on geometry.
     */
    if (drag.object?.type === "elbow" && drag.moved) {
        settleElbowConnections(drag, event);
    }

    /*
     * The browser's trailing `click` belongs to this gesture. Left alone it
     * re-selects whatever is under the release point - empty space after a
     * handle drag - and the feature just edited loses its selection.
     */
    editorState.selectionClickSuppressed =
        true;

    /* The drag's inference wording ("Vertical") describes nothing any more. */
    if (drawingState.activeTool === "select") {
        setToolMessage("Select geometry");
    }

    renderProperties();
    renderCurrentDrawing();
}

/*
 * APPLY ONE DRAG FRAME TO THE MODEL, WITHOUT A POINTER.
 *
 * The canvas path resolves a screen point through snapping and then calls
 * `applyManipulation`. That is the only part a test cannot easily drive - the
 * resolver needs a camera, a canvas rect and a real pointer event - and it is not
 * the part any feature's semantics live in. So the frame below is the one
 * `updateManipulationDrag` makes, applied straight to the model, which lets a
 * test assert on what a drag WRITES rather than on what a pointer happened to
 * resolve to.
 *
 * It is a seam, not a second implementation: `applyManipulation` is the same
 * function the canvas calls.
 */
export function applyManipulationFrame(drag, point) {
    if (!drag?.object || !point) {
        return false;
    }

    /* The same bookkeeping `updateManipulationDrag` does for a live frame. */
    if (!drag.originals) {
        drag.originals = {
            [drag.object.id]: JSON.parse(JSON.stringify(drag.object))
        };
    }

    drag.moved = true;

    applyManipulation(drag, point);

    return drag.object;
}

/* The name the endpoint tests drive; the same frame, stated once. */
export const applyManipulationForTest = applyManipulationFrame;

/*
 * Apply the drag to the real feature data.
 */
function applyManipulation(
    drag,
    point
) {
    const object =
        drag.object;

    const g =
        object.geometry;

    if (drag.kind.startsWith("process-bend-")) {
        const index = Number(drag.kind.slice("process-bend-".length));
        const initial = processBendPoint(drag.originals[object.id].geometry, index);
        setProcessBendFromPoint(g, index, {
            x: initial.x + point.x - drag.start.x,
            y: initial.y + point.y - drag.start.y
        }, 6 / (enggDrawingState.BASE_PIXELS_PER_UNIT * drawingState.camera.zoom));
        return;
    }

    if (drag.kind.startsWith("process-label-")) {
        const index = Number(drag.kind.slice("process-label-".length));
        const original = drag.originals[object.id].geometry;
        const scale = enggDrawingState.BASE_PIXELS_PER_UNIT * drawingState.camera.zoom;
        const initial = processLabelPoint(original, index, scale);
        g.stateLabelOffsets ??= {};
        g.stateLabelOffsets[index] = {
            dx: initial.x + point.x - drag.start.x - g.points[index].x,
            dy: initial.y + point.y - drag.start.y - g.points[index].y
        };
        return;
    }

    if (drag.kind === "rotate") {
        /*
         * A FLOW ARROW DOES NOT TURN. Its orientation is its pipe's; the handle
         * is not offered for it (see `supportsRotationHandle`), and this refuses
         * a rotate frame that reached it anyway - so there is no path, however
         * the drag was started, on which an arrow's angle or its pipe's geometry
         * can be written by a rotation.
         */
        if (object.type === "flow-arrow") {
            return;
        }

        /*
         * ========================================================
         * THE ROTATION HANDLE
         * ========================================================
         *
         * The angle is read from the cursor about the object's pivot, and
         * applied from the ORIGINAL geometry every frame - so the same
         * pointer position always produces the same rotation, and the drag
         * cannot accumulate rounding.
         *
         * The pivot comes from `rotationPivotFor`, which is the same pivot
         * the Transform field uses: a Coordinate System turns about its
         * origin, a Particle and a Reference Point keep their anchor, and
         * everything else turns about its own centre.
         */
        const original =
            drag.originals?.[object.id];

        const pivot =
            rotationPivotFor(object);

        if (
            !original ||
            !pivot ||
            !point ||
            !Number.isFinite(point.x) ||
            !Number.isFinite(point.y)
        ) {
            return;
        }

        const angle =
            Math.atan2(
                point.y - pivot.y,
                point.x - pivot.x
            );

        const startAngle =
            drag.rotationStartAngle ??
            Math.atan2(
                drag.start.y - pivot.y,
                drag.start.x - pivot.x
            );

        const radians =
            angle - startAngle;

        /* Rebuild from the snapshot so the newest angle is applied once. */
        object.geometry = JSON.parse(
            JSON.stringify(original.geometry)
        );

        rotateObjectAbout(
            object,
            pivot,
            radians
        );

        /* A turned run's joints follow it, exactly as a dragged end's do. */
        if (object.type === "pipe-duct") {
            reconcileFluidConnections(object);
        }

        return;
    }

    /*
     * ========================================================
     * AN ARROW'S BODY IS A POSITION DRAG, BEFORE THE BODY MACHINERY
     * ========================================================
     *
     * The generic body move translates a feature's points by the pointer's
     * delta. That is exactly wrong for a flow arrow, whose position is a
     * FRACTION of its pipe: a translation would carry the anchor to the same
     * place in space, off the centreline and eventually off the pipe.
     *
     * So an arrow's body drag is routed to its own branch - the position
     * handle's - which projects the pointer onto the host. It is the SAME code, not
     * a second implementation, and it is reached before the translate path so
     * the arrow can never be moved as if it were a free shape.
     */
    if (object.type === "flow-arrow" && (drag.kind === "body" || drag.kind === "group-resize")) {
        const span = enggFlowArrow.hostSpan(object);

        if (!span) {
            return true;
        }

        const dx = span.end.x - span.start.x;
        const dy = span.end.y - span.start.y;

        const t =
            ((point.x - span.start.x) * dx + (point.y - span.start.y) * dy) /
            (span.length * span.length);

        enggFlowArrow.setAttachment(object, { fraction: enggFlowArrow.clampFraction(t) });

        return true;
    }

    if (drag.kind === "body" || drag.kind === "group-resize") {
        /*
         * A SCHEMATIC OBJECT'S BODY IS ITS OWN TO MOVE. Its branch above has
         * already run (this point was reached only if it did not), so the
         * generic translation below is reserved for the shapes that really do
         * translate freely.
         */
        if (schematicBodyDrag(object) && drag.kind === "body") {
            return;
        }

        let scale = 1;
        let anchor = drag.start;
        let dx = point.x - drag.start.x;
        let dy = point.y - drag.start.y;
        if (drag.kind === "group-resize") {
            const corners = selectionCorners(drag.bounds);
            anchor = corners[(drag.corner + 2) % 4];
            const initial = corners[drag.corner];
            const vx = initial.x - anchor.x;
            const vy = initial.y - anchor.y;
            scale = Math.max(0.01, ((point.x - anchor.x) * vx + (point.y - anchor.y) * vy) / Math.max(1e-18, vx * vx + vy * vy));
            dx = 0;
            dy = 0;
        }
        for (const [id, original] of Object.entries(drag.originals)) {
            const live = drawingState.objects.find(item => item.id === id);
            if (!live) continue;
            const changed = transformSelectionObject(original, anchor, scale, dx, dy);
            live.geometry = changed.geometry;
            if (changed.placement) live.placement = changed.placement;
        }

        /*
         * A MOVED RUN'S SPAN MOVES WITH IT.
         *
         * The span is a second description of the same two ends (see the pipe
         * branch below), so a translation that carried `start`/`end` and left the
         * span behind would make the run's own line disagree with the run - and
         * the next fit, wall offset or far-end reading would use the old line.
         * The same delta, applied to both, keeps them one description.
         */
        Object.keys(drag.originals).forEach((id) => {
            const live = drawingState.objects.find(item => item.id === id);

            if (live?.type === "pipe-duct" && live.geometry?.span) {
                const moved = transformSelectionObject(
                    drag.originals[id],
                    anchor,
                    scale,
                    dx,
                    dy
                );

                live.geometry = { ...live.geometry, span: moved.geometry?.span };
            }
        });

        /*
         * A BODY MOVE THAT CARRIES A PIPE CARRIES ITS JOINTS TOO. Whether the
         * group move brings two ends together or pulls them apart, the fitting
         * between them follows on this frame.
         */
        Object.keys(drag.originals).forEach((id) => {
            const live = drawingState.objects.find(item => item.id === id);

            if (live?.type === "pipe-duct") {
                reconcileFluidConnections(live);
            }
        });

        return;
    }

    if (isPistonCylinder(object) && drag.kind === "piston-height") {
        setPistonFromPoint(g, point);
        return;
    }
    if (isPistonCylinder(object) && drag.kind === "stopper-height" && g.hasStoppers) {
        setStoppersFromPoint(g, point);
        return;
    }

    /*
     * AN ANNOTATION MOVES BY ITS PLACEMENT, and nothing else.
     *
     * The whole point of an annotation is that it can be put anywhere
     * while staying attached to its feature: moving it changes where the
     * words sit and must not touch the feature, the link, or the text.
     * So only `placement` is written.
     *
     * `placementMode` becomes "manual" because the student has now
     * chosen this position themselves, and from here on it is theirs to
     * keep - the annotation will not snap back when the feature is
     * edited later, which is what stops a moved label being dragged
     * somewhere useless every time a value changes.
     *
     * The leader is not touched. It belongs to the annotation and
     * redraws itself from the new position, so moving the box moves the
     * leader with it rather than leaving it pointing at nothing.
     */
    /*
     * ========================================================
     * DRAGGING ONE POINT OF A LEADER'S PEN
     * ========================================================
     *
     * A leader or a callout is a path - attachment, bends, endpoint - and each
     * point can be dragged on its own. Dragging a BEND moves that bend and so
     * reshapes the two segments that meet it, exactly as the requirement asks;
     * dragging the ATTACHMENT or the ENDPOINT moves just that end. The whole
     * path stays ONE feature throughout: only a stored point changes, and the
     * renderer redraws the polyline through the new list.
     *
     * The point is written from the RAW cursor, like every other annotation
     * placement - a bend is where the student puts it and snapping it would pull
     * the corner somewhere they did not point at.
     */
    if (
        typeof drag.kind === "string" &&
        drag.kind.startsWith("annotate-")
    ) {
        if (
            !point ||
            !Number.isFinite(point.x) ||
            !Number.isFinite(point.y)
        ) {
            return false;
        }

        const geometry = object.geometry || {};

        if (drag.kind === "annotate-attachment") {
            geometry.start = { x: point.x, y: point.y };
            return true;
        }

        /*
         * A LABEL'S ANCHOR, moved deliberately.
         *
         * This is the DEDICATED handle for changing what a label is about, and
         * it writes the anchor point (`geometry.start`) and nothing else - the
         * text stays where it was, so the student can see the leader stretch as
         * they move the anchor to a new place on the body.
         */
        if (drag.kind === "annotate-anchor") {
            geometry.start = { x: point.x, y: point.y };
            return true;
        }

        /*
         * A LABEL'S TEXT, moved on its own.
         *
         * The same handle kind a point-placed mark uses, but for a label the
         * position IS the text - so this moves the words while the anchor set
         * above stays put. This is the handle a student grabs to make a label
         * legible without changing what it marks.
         */
        if (drag.kind === "position" && object.annotateKind === "label") {
            geometry.position = { x: point.x, y: point.y };
            return true;
        }

        if (drag.kind === "annotate-endpoint") {
            geometry.end = { x: point.x, y: point.y };
            return true;
        }

        const index =
            Number(drag.kind.replace("annotate-bend", ""));

        if (
            Number.isInteger(index) &&
            Array.isArray(geometry.bends) &&
            geometry.bends[index]
        ) {
            geometry.bends[index] = {
                x: point.x,
                y: point.y
            };

            return true;
        }

        return false;
    }

    if (object.type === "annotation") {
        if (
            !point ||
            !Number.isFinite(point.x) ||
            !Number.isFinite(point.y)
        ) {
            return false;
        }

        object.placement = {
            x: point.x,
            y: point.y
        };

        object.placementMode = "manual";

        return true;
    }

    /*
     * AN ANNOTATE FEATURE MOVES BY A WORLD-SPACE DELTA.
     *
     * The delta is taken from the ORIGINAL geometry, not applied
     * cumulatively to the live one, so the mark cannot drift by accumulating
     * rounding, and the grab offset is preserved exactly: the point under the
     * cursor when the drag began stays under the cursor all the way - the
     * mark never jumps first (spec 61).
     *
     * A point-placed mark moves its position; a leader, a callout or an arrow
     * moves BOTH ends by the same delta, so it keeps its shape and length and
     * simply relocates. That is one function in the model, so the two cannot
     * disagree about what "move" means.
     */
    if (object.type === "annotate") {
        if (
            !point ||
            !Number.isFinite(point.x) ||
            !Number.isFinite(point.y)
        ) {
            return false;
        }

        const original =
            drag.originals?.[object.id];

        const start = drag.start;

        if (!original || !start) {
            return false;
        }

        const deltaX = point.x - start.x;
        const deltaY = point.y - start.y;

        /*
         * Rebuild from the ORIGINAL every frame, so the newest delta is
         * applied to the shape as it was, and the annotation lands exactly
         * delta away from where it started.
         */
        object.geometry = JSON.parse(
            JSON.stringify(original.geometry)
        );

        /*
         * A LABEL'S TEXT MOVES AND ITS ANCHOR STAYS.
         *
         * A label marks a point on a body; dragging the label moves the TEXT
         * so it can be made legible, and the anchor must not travel with it -
         * otherwise the label would stop marking the thing it names. Only the
         * text position is moved, and the renderer draws the leader that
         * bridges the gap when it grows (see `labelLeaderGap`).
         *
         * Every other annotate kind relocates whole, which is what dragging a
         * note, a leader or an arrow means.
         */
        if (object.annotateKind === "label" && object.geometry?.position) {
            object.geometry.position = {
                x:
                    (original.geometry?.position?.x ?? 0) + deltaX,
                y:
                    (original.geometry?.position?.y ?? 0) + deltaY
            };

            return true;
        }

        enggAnnotate.translateAnnotation(
            object,
            deltaX,
            deltaY
        );

        return true;
    }

    /*
     * A DIMENSION MOVES BY ITS OFFSET.
     *
     * A dimension states a measurement of something else, and its
     * placement is the offset between the two. Dragging moves that
     * offset; it does not re-measure, and it does not take the offset
     * from the pointer, because the distance between the geometry and
     * the dimension line is the whole of what the student chose when
     * they placed it.
     */
    if (object.type === "dimension") {
        const start =
            drag.start;

        const placement =
            object.placement;

        if (
            !start ||
            !placement ||
            !Number.isFinite(placement.x) ||
            !Number.isFinite(placement.y)
        ) {
            return false;
        }

        object.placement = {
            x: placement.x + (point.x - start.x),
            y: placement.y + (point.y - start.y)
        };

        return true;
    }

    /* ============================================================
 * HELPERS FOR THE SCHEMATIC DRAGS
 * ============================================================ */

/*
 * RE-SEAT EVERY LEVEL ON A VESSEL after it moved or resized.
 *
 * A level's line comes from its VESSEL, so a tank that grew or turned takes its
 * levels with it - at the same height above the bottom - without the level
 * storing a second copy of where it is.
 */
function refreshLevelsOf(vessel, objects = []) {
    (objects || []).forEach((object) => {
        if (enggFluidLevel.isFluidLevelType(object?.type) && object.engineering?.vesselId === vessel.id) {
            enggFluidLevel.refreshFluidLevel(object, objects);
        }
    });
}

/*
 * WHETHER A BODY DRAG IS THE GENERIC TRANSLATE OR A TOOL'S OWN MOVE.
 *
 * The schematic objects are translated by their own branches above, because
 * each is constrained by something: a reducer by its pipe, a level by its
 * vessel, a direction arrow by its run. Letting the generic translate reach
 * them would move geometry the model derives, so they are answered here first.
 */
function schematicBodyDrag(object) {
    return (
        enggReducer.isReducerType(object?.type) ||
        enggEquipment.isEquipmentType(object?.type) ||
        enggFluidLevel.isFluidLevelType(object?.type) ||
        enggFlowArrows.isFlowDirectionType(object?.type)
    );
}

const bodyDragRouted = schematicBodyDrag;

void bodyDragRouted;

    const original =
        drag.originals?.[object.id]?.geometry;

    if (object.type === "point") {
        const target =
            g.position || g.point || g;

        target.x = point.x;
        target.y = point.y;
        return;
    }

    /*
     * ========================================================
     * THE SCHEMATIC TOOLS' DRAGS
     * ========================================================
     *
     * Every branch writes the SAME model its Features row writes, and every one
     * of them is CONSTRAINED by what the object belongs to:
     *
     *   a reducer slides along its pipe, and its length/width handles are the
     *   two parameters that describe the taper;
     *
     *   an inline symbol slides along its pipe; a standalone one moves freely;
     *
     *   a vessel resizes from a corner and moves by its body, taking attached
     *   pipes and levels with it;
     *
     *   a level moves vertically only, because it is horizontal inside its
     *   vessel by definition;
     *
     *   a direction arrow slides along its pipe, and never leaves it;
     *
     *   a profile's point handle writes the DATA ROW it stands for, and its
     *   frame handles resize the frame.
     */
    if (enggReducer.isReducerType(object.type)) {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
            return;
        }

        if (drag.kind === "reducer-slide") {
            enggReducer.slideReducerTo(object, point, drawingState.objects);
            return;
        }

        if (drag.kind === "reducer-length-start" || drag.kind === "reducer-length-end") {
            const walls = enggReducer.wallsOf(object);
            const other = drag.kind === "reducer-length-start" ? walls?.end.centre : walls?.start.centre;

            if (!walls || !other) {
                return;
            }

            const length = Math.hypot(point.x - other.x, point.y - other.y);

            if (enggReducer.setTransitionLength(object, length)) {
                /* The dragged end is the one that MOVED; the other stays put. */
                const offset = drag.kind === "reducer-length-start" ? -1 : 1;

                object.geometry = {
                    ...object.geometry,
                    position: {
                        x: other.x + walls.axis.direction.x * offset * (length / 2),
                        y: other.y + walls.axis.direction.y * offset * (length / 2)
                    }
                };
            }

            return;
        }

        if (drag.kind === "width-start" || drag.kind === "width-end") {
            /*
             * THE WIDTH HANDLE CHANGES THE SEGMENT'S OWN PIPE WIDTH, which is
             * the only width a reducer has - the fitting follows on the next
             * read, because its taper is derived from its two pipes.
             */
            const runs = enggReducer.connectedRunsOf(object);
            const run = drag.kind === "width-start" ? runs.start : runs.end;

            if (!run) {
                return;
            }

            const walls = enggReducer.wallsOf(object);
            const centre = drag.kind === "width-start" ? walls.start.centre : walls.end.centre;

            const distance = Math.hypot(point.x - centre.x, point.y - centre.y) * 2;
            const change = distance - enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION;

            if (enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION + change > 0) {
                run.engineering = { ...(run.engineering || {}) };

                if (change === 0) {
                    delete run.engineering.separation;
                } else {
                    run.engineering.separation = change;
                }
            }

            return;
        }

        return;
    }

    if (enggEquipment.isEquipmentType(object.type)) {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
            return;
        }

        if (drag.kind === "equipment-size") {
            const frame = enggEquipment.frameOf(object);
            const size = frame ? Math.hypot(point.x - frame.center.x, point.y - frame.center.y) : null;

            if (size !== null) {
                enggEquipment.setSymbolSize(object, size);
            }

            return;
        }

        if (drag.kind === "equipment-slide" || (drag.kind === "body" && enggEquipment.isInline(object))) {
            /*
             * INLINE: the symbol stays on its pipe's line.
             *
             * `slideAlongHost` is the ONE operation for this - it projects the
             * pointer onto the host's centreline, turns the symbol along it and
             * re-seats both held pipe ends - so the canvas handle and the
             * "Position Along Pipe" field write the same geometry, and the sheet
             * can never show a gap the field would close.
             */
            enggEquipment.slideAlongHost(object, point, drawingState.objects);

            return;
        }

        if (drag.kind === "equipment-rotate") {
            /* STANDALONE: the symbol turns to face the pointer, about its own centre. */
            const frame = enggEquipment.frameOf(object);

            if (!frame) {
                return;
            }

            object.geometry = {
                ...object.geometry,
                rotation: (Math.atan2(point.y - frame.center.y, point.x - frame.center.x) * 180) / Math.PI
            };

            return;
        }

        if (drag.kind === "equipment-body" || drag.kind === "body") {
            /* STANDALONE: a free move, from the drag's own delta. */
            object.geometry = {
                ...object.geometry,
                position: {
                    x: (drag.originals?.[object.id]?.geometry?.position?.x ?? object.geometry.position.x) + (point.x - drag.start.x),
                    y: (drag.originals?.[object.id]?.geometry?.position?.y ?? object.geometry.position.y) + (point.y - drag.start.y)
                }
            };

            return;
        }

        return;
    }

    if (enggVessel.isVesselType(object.type)) {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
            return;
        }

        const original = drag.originals?.[object.id]?.geometry || object.geometry;

        if (drag.kind === "equipment-body" || drag.kind === "body") {
            object.geometry = {
                ...original,
                position: {
                    x: original.position.x + (point.x - drag.start.x),
                    y: original.position.y + (point.y - drag.start.y)
                }
            };

            enggVessel.followVessel(object, drawingState.objects);
            refreshLevelsOf(object, drawingState.objects);

            return;
        }

        const match = /^vessel-corner(\d)$/.exec(drag.kind);

        if (match) {
            /*
             * RESIZE FROM THE CORNER OPPOSITE THE ONE GRABBED. The opposite
             * corner stays exactly where it is, and the box is re-derived from
             * the two - which is what makes an edge drag feel like the edge.
             */
            const opposite = (Number(match[1]) + 2) % 4;

            const rect = enggVessel.vesselRect({ geometry: original });

            if (!rect) {
                return;
            }

            const anchor = rect.corners[opposite];

            /* The drag's point, in the vessel's own (unrotated) frame. */
            const local = enggVessel.localOf(rect, point);
            const anchorLocal = enggVessel.localOf(rect, anchor);

            const left = Math.min(local.x, anchorLocal.x);
            const top = Math.min(local.y, anchorLocal.y);

            const width = Math.max(enggVessel.MIN_VESSEL_SIDE, Math.abs(local.x - anchorLocal.x));
            const height = Math.max(enggVessel.MIN_VESSEL_SIDE, Math.abs(local.y - anchorLocal.y));

            object.geometry = {
                ...original,
                position: enggVessel.worldOf(rect, { x: left, y: top }),
                width,
                height
            };

            enggVessel.followVessel(object, drawingState.objects);
            refreshLevelsOf(object, drawingState.objects);

            return;
        }

        return;
    }

    if (enggFluidLevel.isFluidLevelType(object.type)) {
        if (drag.kind === "level-height" || drag.kind === "body") {
            const vessel = (drawingState.objects || []).find(
                (item) => item.id === object.engineering?.vesselId
            );

            if (vessel && point) {
                enggFluidLevel.setLevelFromPoint(object, point, drawingState.objects);
            }

            return;
        }

        return;
    }

    if (enggFlowArrows.isFlowDirectionType(object.type)) {
        if (drag.kind === "direction-slide" || drag.kind === "body") {
            if (point) {
                enggFlowArrows.setDirectionFromPoint(object, point, drawingState.objects);
            }

            return;
        }

        return;
    }

    if (enggPressureProfile.isPressureProfileType(object.type)) {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
            return;
        }

        const original = drag.originals?.[object.id]?.geometry || object.geometry;

        /*
         * A DATA POINT. The drag position is mapped back through the axes, and
         * the ROW is written - so the table and the plotted point are one fact,
         * not two that could drift apart.
         */
        if (drag.kind.startsWith("profile-point")) {
            const index = Number(drag.kind.slice("profile-point".length));
            const data = enggPressureProfile.drawingToData(object, point);

            if (data && Number.isInteger(index)) {
                enggPressureProfile.setPoint(object, index, data);
            }

            return;
        }

        if (drag.kind === "equipment-body" || drag.kind === "body") {
            object.geometry = {
                ...original,
                position: {
                    x: original.position.x + (point.x - drag.start.x),
                    y: original.position.y + (point.y - drag.start.y)
                }
            };

            return;
        }

        const match = /^profile-corner(\d)$/.exec(drag.kind);

        if (match) {
            const opposite = (Number(match[1]) + 2) % 4;

            const right = original.position.x + original.width;
            const top = original.position.y + original.height;

            const corners = [
                { x: original.position.x, y: original.position.y },
                { x: right, y: original.position.y },
                { x: right, y: top },
                { x: original.position.x, y: top }
            ];

            const anchor = corners[opposite];

            const width = Math.max(enggPressureProfile.MIN_PROFILE_SIDE, Math.abs(point.x - anchor.x));
            const height = Math.max(enggPressureProfile.MIN_PROFILE_SIDE, Math.abs(point.y - anchor.y));

            object.geometry = {
                ...original,
                position: {
                    x: Math.min(point.x, anchor.x),
                    y: Math.min(point.y, anchor.y)
                },
                width,
                height
            };

            return;
        }

        return;
    }

    if (enggSectionPlane.isSectionPlaneType(object.type)) {
        if (!point) {
            return;
        }

        const original = drag.originals?.[object.id]?.geometry || object.geometry;

        if (drag.kind === "section-rotate") {
            /* TURN ABOUT THE TRACE'S MIDDLE - the mark stays where it is. */
            const span = enggSectionPlane.sectionSpan(object);

            if (!span) {
                return;
            }

            const centre = { x: (span.start.x + span.end.x) / 2, y: (span.start.y + span.end.y) / 2 };

            enggSectionPlane.setSectionRotation(
                object,
                (Math.atan2(point.y - centre.y, point.x - centre.x) * 180) / Math.PI
            );

            return;
        }

        if (drag.kind === "section-body" || drag.kind === "body") {
            const dx = point.x - drag.start.x;
            const dy = point.y - drag.start.y;

            object.geometry = {
                start: { x: original.start.x + dx, y: original.start.y + dy },
                end: { x: original.end.x + dx, y: original.end.y + dy }
            };

            return;
        }

        if (drag.kind === "start" || drag.kind === "end") {
            object.geometry = { ...object.geometry, [drag.kind]: { x: point.x, y: point.y } };

            return;
        }

        return;
    }

    /*
     * A FREE FLOW ARROW IS AN ORDINARY SPAN: start and end are its geometry.
     */
    if (enggFlowArrows.isFreeFlowArrowType(object.type) && !object.attachment && (drag.kind === "start" || drag.kind === "end")) {
        object.geometry = { ...object.geometry, [drag.kind]: { x: point.x, y: point.y } };

        return;
    }

    if (object.type === "line") {
        if (drag.kind === "start") {
            g.start = { x: point.x, y: point.y };
        } else {
            g.end = { x: point.x, y: point.y };
        }

        return;
    }

    /*
     * ========================================================
     * A PIPE / DUCT RUN IS DRAGGED BY ITS CENTRELINE ENDS
     * ========================================================
     *
     * The run stores ONE centreline. Both walls are derived from it plus the
     * run's own spacing, so writing the dragged end is the whole edit: the
     * length and orientation change, the two walls are recalculated, and the
     * spacing is untouched - which is what "preserve the intended width during
     * endpoint movement" comes down to.
     *
     * The run's joints are settled afterwards by `reconcileFluidConnections`, so a
     * join made by the drag earns its fitting in the same frame, a join broken by
     * it loses its fitting, and one that merely changed angle has its fitting
     * re-shaped around the new arms.
     *
     * THE STUDENT'S ENDPOINT IS READ FROM WHERE THE DRAG STARTED, not from the
     * live geometry. An end already held by a fitting sits on that fitting's
     * tangent point - cut back from the pipe's outer end - so adopting the live
     * point would let every frame shorten the pipe again, and the run would
     * shrink away under the pointer. The pre-drag endpoint is the outer length the
     * student actually has.
     */
    if (object.type === "pipe-duct") {
        if (drag.kind === "start" || drag.kind === "end") {
            /*
             * THE PIPES THIS ENDPOINT EDIT WILL RE-CUT ARE SNAPSHOTTED FIRST -
             * before the dragged end is written.
             *
             * Settling the run's bends moves the OTHER pipe's tangent end, its
             * trim, its wall seam and its span - writes to objects the drag is
             * not holding. Without this record the undo entry put only the
             * dragged pipe back, so undoing an endpoint edit left the pipe on the
             * far side of the elbow permanently re-cut. Taking the snapshot after
             * the write would capture an already-changed pipe, so it is taken
             * here, on the way in.
             */
            captureElbowPipes(drag, drawingState.objects);

            g[drag.kind] = { x: point.x, y: point.y };

            /*
             * THE RUN'S SPAN FOLLOWS THE END THE STUDENT DREW TO.
             *
             * A run has TWO descriptions of itself: its stored ends, which are
             * what the handles sit on and what hit testing reads, and its `span`,
             * which is the LINE the walls are offset from and survives being
             * seated on a fitting. A drag used to write only the stored end, so
             * the span went on describing the pipe as it was drawn - and every
             * reader that trusts the span (the wall offset, `runSpan`, the far
             * end of a connected run) then saw a pipe in a place the student had
             * already moved away from. An endpoint could be dragged and the
             * double line stay where it was.
             *
             * ONLY THE OUTWARD END IS WRITTEN HERE. The end a fitting holds is
             * not the student's to move: `applyTrimTo` / `reseatRunOnElbow` put
             * it on the tangent point, and writing it here would drag the joint
             * out from under the bend. `runSpan` therefore still describes the
             * line, because the held end and this end are two points ON it.
             */
            if (!heldByBendForDrag(object, drag.kind)) {
                g.span = {
                    ...(g.span || {}),
                    [drag.kind]: { x: point.x, y: point.y }
                };
            }

            /*
             * A PIPE'S OWN ENDPOINT IS A SOCKET. When the run is joined to
             * another at this end, the two meet exactly - and the pointer, even
             * snapped, can land a rounding error away, which would leave the run
             * a hair short of the joint it still records. The endpoint is
             * therefore placed ON the joint's point, so a pipe pulled along its
             * own axis cannot creep away from the pipe it is attached to.
             */
            const socket = socketAt(object, drag.kind);

            if (socket) {
                g[drag.kind] = { x: socket.point.x, y: socket.point.y };
            }

            /*
             * A MANUALLY DRAWN ELBOW IS NOT A CORNER BETWEEN TWO RUNS - it is its
             * own fitting - so it is not the reconciler's to rebuild. It is
             * refreshed here instead, which moves an attached end onto the run's
             * new endpoint and re-solves the bend from its own angle.
             */
            (drawingState.objects || []).forEach((candidate) => {
                if (
                    enggPipeDuct.isElbowType(candidate.type) &&
                    candidate.engineering?.generated === false &&
                    Array.isArray(candidate.engineering?.connections) &&
                    candidate.engineering.connections.includes(object.id)
                ) {
                    refreshManualElbow(candidate, drawingState.objects);
                }
            });

            /*
             * THE WHOLE RUN'S JOINTS, NOT JUST THE DRAGGED FRAME. A frame of a
             * drag is an ordinary edit as far as the model is concerned, so the
             * same reconciliation runs that runs when the drag is released.
             */
            reconcileFluidConnections(object);

            /*
             * AND THE JUNCTION THIS END EARNS BY LANDING ON A PIPE'S INTERIOR.
             *
             * A branch dragged to the middle of another run is the same
             * endpoint-to-segment connection as one drawn there, and the drawing
             * tool asks the question on commit - so the drag must ask it too, or
             * the two ways of making the same connection behave differently.
             * `createJunctionForInteriorConnection` leaves an existing junction
             * alone, so running it on every frame cannot accumulate fittings.
             */
            createJunctionForInteriorConnection(
                (drawingState.objects || []).find((candidate) => candidate.id === object.id) || object
            );
        }

        return;
    }

    /*
     * ========================================================
     * A FLOW ARROW IS DRAGGED ALONG ITS HOST PIPE
     * ========================================================
     *
     * The arrow's anchor is a FRACTION along the run, so moving it is one
     * number - and the pointer is projected onto the run's centreline to get
     * that number. The projection is what keeps the arrow ON the pipe: a cursor
     * dragged sideways changes nothing, because the sideways component is simply
     * discarded, and the arrow stays centred and parallel to the pipe's edges
     * however the drag is made.
     *
     * THE PIPE IS NEVER TOUCHED. Only `attachment.fraction` (or `size`) is
     * written, so a drag cannot stretch, bend or move the run it sits on.
     *
     * A pipe whose geometry changed under a body move is read through
     * `hostSpan` here, so the fraction is measured against the run AS IT IS NOW.
     */
    if (object.type === "flow-arrow") {
        /*
         * THE BODY IS A POSITION DRAG.
         *
         * Grabbing the arrow anywhere on its head is how a student expects to
         * slide it along the pipe, so the ordinary body drag is treated as the
         * position handle. There is deliberately NO translate-the-arrow-anywhere
         * path below this branch: an arrow has no free position, so a drag that
         * is not one of the two handles does nothing at all.
         */
        const kind = drag.kind === "body" ? "flow-arrow-position" : drag.kind;

        const span = enggFlowArrow.hostSpan(object);

        if (!span) {
            return;
        }

        if (kind === "flow-arrow-position") {
            /*
             * THE POINTER'S PROJECTION ONTO THE RUN. `t` is the raw fraction
             * along the centreline; clamping it into the drawable range keeps
             * the arrow strictly inside the run's ends, where fittings are.
             *
             * ONLY THE FRACTION IS WRITTEN. The pipe's geometry is not read
             * into the arrow and the arrow's position is not written into the
             * pipe, so a drag along the pipe can never move, stretch or turn the
             * pipe it belongs to.
             */
            const dx = span.end.x - span.start.x;
            const dy = span.end.y - span.start.y;

            const t =
                ((point.x - span.start.x) * dx + (point.y - span.start.y) * dy) /
                (span.length * span.length);

            enggFlowArrow.setAttachment(object, { fraction: enggFlowArrow.clampFraction(t) });

            return;
        }

        if (kind === "flow-arrow-size") {
            /*
             * THE SIZE IS THE POINTER'S DISTANCE FROM THE ANCHOR, not a delta
             * from where the drag began - so the same pointer position always
             * means the same size, and a drag cannot accumulate rounding.
             * Clamped to the drawable range, and never below the minimum that
             * keeps the head drawable.
             *
             * Resizing the HEAD changes `attachment.size` and nothing else: the
             * pipe's walls, width and length are untouched, and there is no
             * diagonal scale handle that could ever reach them.
             */
            const anchor = enggFlowArrow.anchorPoint(object);

            if (!anchor) {
                return;
            }

            const wanted = Math.hypot(point.x - anchor.x, point.y - anchor.y) * 2;

            enggFlowArrow.setAttachment(object, { size: wanted });

            return;
        }

        return;
    }

    /*
     * ========================================================
     * AN ELBOW IS DRAGGED THROUGH ITS OWN GEOMETRY
     * ========================================================
     *
     * The corner, each end, the angle and the radius each write the model the
     * Features panel writes - so a drag and a typed value are the same edit and
     * cannot disagree.
     *
     * AN END ON A PIPE STAYS ON IT unless the student lets go well away, which
     * is the deliberate disconnection the specification asks for; released
     * within the snapping tolerance of another pipe's end it reconnects THERE
     * instead. A connected elbow whose corner is dragged follows the attached
     * ends rather than leaving them behind.
     */
    if (object.type === "elbow") {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
            return;
        }

        if (drag.kind === "elbow-angle") {
            applyElbowAngleDrag(object, drag, point);
            return;
        }

        if (drag.kind === "elbow-radius") {
            applyElbowRadiusDrag(object, drag, point);
            return;
        }

        if (drag.kind === "start" || drag.kind === "end") {
            const endId = drag.kind === "start" ? "a" : "b";

            /*
             * A CONNECTED END IS HELD BY ITS PIPE while the pointer is inside
             * the snap tolerance, so an ordinary reshape cannot silently break
             * a connection. Further out, the student is deliberately pulling it
             * off, and the end follows.
             */
            const attachedTo = object.engineering?.connections?.[endId === "a" ? 0 : 1];

            if (attachedTo) {
                const run = (drawingState.objects || []).find((candidate) => candidate.id === attachedTo);
                const port = run && enggPipeDuct.portsOf(run).find((entry) =>
                    Math.hypot(entry.point.x - point.x, entry.point.y - point.y) <= CONTINUATION_TOLERANCE
                );

                if (port) {
                    object.geometry.ends[endId] = { ...port.point };

                    /*
                     * AND THE BEND RE-SOLVES AROUND IT. The end that is held
                     * stays on its pipe while the rest of the fitting follows,
                     * rather than the corner being left where the old end was.
                     */
                    refreshManualElbow(object, drawingState.objects);

                    return;
                }
            }

            const moved = enggPipeDuct.moveElbowEnd(object, endId, point);

            /*
             * A GENERATED FITTING THAT IS BEING PULLED OFF ATTEMPTS TO RECONNECT
             * AS IT GOES. Its OS own ends are the runs it joins, so the bend is
             * re-fitted to whatever its moving end now touches - which is what
             * makes dragging one handle onto another pipe connect them, without
             * the student drawing anything.
             */
            if (moved && object.engineering?.generated !== false) {
                retargetGeneratedElbow(object, endId === "a" ? 0 : 1);
            }

            return;
        }

        if (drag.kind === "position" || drag.kind === "body") {
            /*
             * A STANDALONE ELBOW MOVES WHOLE: its corner and both ends shift by
             * the same delta, so the angle and the radius are untouched.
             *
             * A CONNECTED ONE IS A JOINT IN A ROUTE. Moving it moves the JOINT -
             * see `moveConnectedElbow`, which moves the two connected pipe ends
             * with it and leaves their outer ends where the student put them.
             */
            const hasConnection = Array.isArray(object.engineering?.connections)
                && object.engineering.connections.some(Boolean);

            if (hasConnection) {
                captureElbowPipes(drag, drawingState.objects);

                moveConnectedElbow(drag, object, point);

                return;
            }

            enggPipeDuct.moveElbowCorner(object, point);

            return;
        }

        return;
    }

    if (object.type === "circle") {
        if (drag.kind === "center") {
            g.center = { x: point.x, y: point.y };
        } else {
            g.radius = Math.max(
                Math.hypot(
                    point.x - g.center.x,
                    point.y - g.center.y
                ),
                1e-6
            );
        }

        return;
    }

    if (object.type === "arc") {
        if (drag.kind === "center") {
            g.center = { x: point.x, y: point.y };
            return;
        }

        /*
         * Dragging an endpoint keeps the centre and the
         * other endpoint, and re-derives radius and the
         * swept angle so the arc stays coherent.
         */
        const fixedAngle =
            drag.kind === "startAngle"
                ? g.endAngle
                : g.startAngle;

        const angle =
            Math.atan2(
                point.y - g.center.y,
                point.x - g.center.x
            );

        g.radius = Math.max(
            Math.hypot(
                point.x - g.center.x,
                point.y - g.center.y
            ),
            1e-6
        );

        if (drag.kind === "startAngle") {
            g.startAngle = angle;
        } else {
            g.endAngle = angle;
        }

        const sweep =
            g.endAngle -
            g.startAngle;

        if (g.sweep !== undefined) {
            g.sweep =
                sweep === 0
                    ? g.sweep
                    : Math.sign(sweep) *
                        Math.abs(g.sweep);
        }

        void fixedAngle;
        return;
    }

    /*
     * A truss joint.
     *
     * Moving a joint moves every member that meets it, so the
     * structure stays connected instead of one member pulling
     * away from the rest.
     */
    const jointMatch =
        /^truss-joint(\d)$/.exec(drag.kind);

    if (jointMatch) {
        moveTrussJoint(
            object,
            Number(jointMatch[1]),
            point
        );

        return;
    }

    /*
     * RIGID BODY HANDLES
     *
     * Each handle writes the same defining value the Features
     * panel writes for the body's current shape, so dragging
     * and typing are the same action and cannot disagree.
     */
    if (drag.kind.startsWith("rigid-")) {
        applyRigidBodyHandle(
            object,
            drag,
            point
        );

        return;
    }

    if (isRectangleLike(object)) {
        /*
         * Resize by moving one corner while the opposite
         * corner stays put. A fixed width or height is
         * respected by keeping that dimension unchanged.
         */
        const index =
            Number(
                drag.kind.replace("corner", "")
            );

        const corners =
            rectangleCorners(
                original
            );

        const opposite =
            corners[(index + 2) % 4];

        const minX =
            Math.min(opposite.x, point.x);

        const maxX =
            Math.max(opposite.x, point.x);

        const minY =
            Math.min(opposite.y, point.y);

        const maxY =
            Math.max(opposite.y, point.y);

        g.width = maxX - minX;
        g.height = maxY - minY;
        g.position = {
            x: minX,
            y: maxY
        };
        g.rotation = 0;
        return;
    }

    /*
     * Statics features are edited through their own
     * engineering data, so a handle moves the quantity the
     * handle stands for rather than a generic vertex. Each
     * case writes to the authoritative field, which is the
     * same value the Features panel edits, so the two can
     * never disagree.
     */
    if (isStaticsFeature(object)) {
        applyStaticsManipulation(
            object,
            drag,
            point
        );

        return;
    }

    if (object.type === COORDINATE_SYSTEM_TYPE) {
        /*
         * Dragging an arm end changes only that side's
         * length. The origin and the other three arms are
         * left exactly as they were.
         */
        if (drag.kind === "origin") {
            g.origin = { x: point.x, y: point.y };
            return;
        }

        const lengths = {
            xPositive: "xPositiveLength",
            xNegative: "xNegativeLength",
            yPositive: "yPositiveLength",
            yNegative: "yNegativeLength"
        };

        const key =
            lengths[drag.kind];

        if (!key) {
            return;
        }

        const measured =
            drag.kind.startsWith("x")
                ? Math.abs(point.x - g.origin.x)
                : Math.abs(point.y - g.origin.y);

        g[key] = Math.max(measured, 1e-6);

        return;
    }

    if (
        object.type === "triangle" ||
        object.type === "polygon" ||
        Array.isArray(g.points)
    ) {
        const index =
            Number(
                drag.kind.replace("vertex", "")
            );

        if (object.type === "polygon") {
            /*
             * A polygon is defined by centre, radius and
             * rotation, so dragging a vertex re-derives
             * those rather than storing loose points.
             */
            g.radius = Math.max(
                Math.hypot(
                    point.x - g.center.x,
                    point.y - g.center.y
                ),
                1e-6
            );

            const sides =
                Math.max(
                    3,
                    Math.round(
                        Number(g.sides) || 3
                    )
                );

            g.rotation =
                Math.atan2(
                    point.y - g.center.y,
                    point.x - g.center.x
                ) -
                (index * 2 * Math.PI) / sides;

            return;
        }

        if (Array.isArray(g.points) && g.points[index]) {
            g.points[index].x = point.x;
            g.points[index].y = point.y;
        }
    }
}

/* ============================================================
 * THE ELBOW'S OWN DRAGS
 * ============================================================
 *
 * Three small helpers, each writing the same model the Features panel writes,
 * so a drag and a typed value cannot disagree:
 *
 *   applyElbowAngleDrag    the ANGLE handle, snapped to the common angles
    *   applyElbowRadiusDrag   the RADIUS handle, read absolutely
 *
 * The angle is measured from the pointer about the FIXED end opposite the
 * handle, turned back into a leg direction, and assembled from the two ends
 * with `solveElbowCorner` - the same construction a typed angle uses.
 */


/*
 * WHETHER A FITTING HOLDS THIS RUN AT THIS END.
 *
 * The same test `socketAt` makes, asked as a question rather than looking for a
 * partner: a GENERATED fitting (one with no `ends` of its own) that records this
 * run and says which of its ends it holds. A manual elbow's ends are the student's
 * own, so it holds neither.
 *
 * An end a fitting holds is the fitting's to place - on its tangent point - and a
 * drag must not write it, or the joint would be pulled out from under the bend.
 */
function heldByBendForDrag(run, endId) {
    return (drawingState.objects || []).some((candidate) => {
        if (
            !enggPipeDuct.isElbowType(candidate.type) ||
            Array.isArray(candidate.geometry?.ends) ||
            !Array.isArray(candidate.engineering?.connections) ||
            !candidate.engineering.connections.includes(run.id)
        ) {
            return false;
        }

        const ports = candidate.engineering?.ports;

        return ports && typeof ports === "object" && !Array.isArray(ports)
            ? ports[run.id] === endId
            : false;
    });
}

/*
 * THE OTHER PIPE A RUN'S END MEETS, if any - the state a fitted joint is in.
 *
 * A fitting that holds this run records the PAIR, so the other run and the point
 * they met at are read from that record. Only another pipe's endpoint counts: a
 * manual elbow's end is not a socket, because a manual fitting's ends are the
 * student's own and are placed by dragging them.
 */
function socketAt(run, endId) {
    const fittings = (drawingState.objects || []).filter(
        (candidate) =>
            enggPipeDuct.isElbowType(candidate.type) &&
            !Array.isArray(candidate.geometry?.ends) &&
            Array.isArray(candidate.engineering?.connections) &&
            candidate.engineering.connections.includes(run.id)
    );

    for (const fitting of fittings) {
        const ports = fitting.engineering?.ports;
        const held = ports && typeof ports === "object" && !Array.isArray(ports) ? ports[run.id] : null;

        if (held !== endId) {
            continue;
        }

        const otherId = fitting.engineering.connections.find((id) => id && id !== run.id);
        const other = otherId
            ? (drawingState.objects || []).find((candidate) => candidate.id === otherId)
            : null;

        const otherPort = other ? ports?.[otherId] : null;
        const point = other && otherPort ? other.geometry?.[otherPort] : null;

        if (point) {
            return { run: other, point: { x: point.x, y: point.y } };
        }
    }

    return null;
}

/*
 * TRY TO RE-CONNECT ONE END OF A GENERATED FITTING TO A PIPE IT NOW MEETS.
 *
 * `index` is 0 for end A and 1 for end B - the same pair the connection record
 * keeps. The OTHER end keeps its pipe, so a fitting pulled from one run onto
 * another connects the two it now spans rather than losing its first joint.
 *
 * Only a genuine corner earns the connection: a pipe whose end merely lies near
 * the fitting, or one that would make the turn straight, is refused and the end
 * is left free.
 */
function retargetGeneratedElbow(elbow, index) {
    const ids = Array.isArray(elbow.engineering?.connections)
        ? [...elbow.engineering.connections]
        : [null, null];

    const otherId = ids[index === 0 ? 1 : 0];

    if (!otherId) {
        return;
    }

    const other = (drawingState.objects || []).find((object) => object.id === otherId);

    /*
     * THE DRAGGED TANGENT POINT, read from the fitting's own bend. A GENERATED
     * elbow stores no `ends` - its two tangent points come from its corner, angle
     * and radius - so the point being dragged is the one the bend puts at that arm.
     */
    const end = tangentPointOf(elbow, index);

    if (!other || !end) {
        return;
    }

    const match = pipeEndAt(end, drawingState.objects);

    if (!match || match.run.id === otherId) {
        return;
    }

    /* One fitting per pair: an elbow cannot be bent back onto a run it already joins. */
    const duplicate = (drawingState.objects || []).some(
        (candidate) =>
            candidate.id !== elbow.id &&
            enggPipeDuct.isElbowType(candidate.type) &&
            Array.isArray(candidate.engineering?.connections) &&
            candidate.engineering.connections.includes(otherId) &&
            candidate.engineering.connections.includes(match.run.id)
    );

    if (duplicate) {
        return;
    }

    const joined = arriveAtCorner(other, match.run);

    if (!joined) {
        return;
    }

    elbow.engineering = {
        ...(elbow.engineering || {}),
        connections: index === 0 ? [otherId, match.run.id] : [match.run.id, otherId]
    };

    updateElbowForPair(elbow, other, match.run, joined);
}

/* The tangent point a generated fitting puts at end A (0) or end B (1). */
function tangentPointOf(elbow, index) {
    const geometry = elbow.geometry || {};

    if (geometry.ends?.a && geometry.ends?.b) {
        return geometry.ends[index === 0 ? "a" : "b"];
    }

    const curves = enggPipeDuct.elbowCurvesFor(elbow);

    if (!curves) {
        return null;
    }

    /*
     * WHICH ARC END IS END A is decided by the arm the connection's first run
     * occupies: whichever tangent is further along that run's direction.
     */
    const firstId = elbow.engineering?.connections?.[0];
    const first = (drawingState.objects || []).find((object) => object.id === firstId);

    const direction = first ? enggPipeDuct.directionOf(first.geometry?.start, first.geometry?.end) : null;

    if (!direction) {
        return index === 0 ? curves.start : curves.end;
    }

    const projection = (point) =>
        (point.x - curves.position.x) * direction.x + (point.y - curves.position.y) * direction.y;

    const startIsFirst = Math.abs(projection(curves.start)) >= Math.abs(projection(curves.end));

    if (index === 0) {
        return startIsFirst ? curves.start : curves.end;
    }

    return startIsFirst ? curves.end : curves.start;
}

/* The corner a pair of runs makes, in the form the fitting arithmetic expects. */
function arriveAtCorner(first, second) {
    const joint = joiningCornerOf(first, second);

    if (!joint) {
        return null;
    }

    const angleDegrees = enggPipeDuct.cornerAngleDegrees(joint.before, joint.vertex, joint.after);
    const angle = enggPipeDuct.supportedElbowAngle(angleDegrees);

    return angle === null ? null : { ...joint, angle, angleDegrees };
}

function applyElbowAngleDrag(object, drag, point) {    const geometry = object.geometry || {};
    const ends = geometry.ends;

    if (!ends?.a || !ends?.b) {
        return;
    }

    /*
     * THE ANGLE IS MEASURED FROM THE POINTER ABOUT THE CORNER, then turned into
     * the bend it implies: the pointer's direction from the corner and the
     * FIXED shoulder's direction make the arms' included angle, whose
     * supplement is the bend.
     */
    const arm = enggPipeDuct.directionOf(geometry.position, point);

    if (!arm) {
        return;
    }

    const shoulder = enggPipeDuct.directionOf(geometry.position, ends.b);

    if (!shoulder) {
        return;
    }

    const arms = enggPipeDuct.angleBetweenDirections(arm, shoulder);

    if (arms === null) {
        return;
    }

    const snapped = enggPipeDuct.snapElbowAngle(180 - arms);

    if (snapped === null) {
        return;
    }

    enggPipeDuct.setElbowAngle(object, snapped);
}

function applyElbowRadiusDrag(object, drag, point) {
    /*
     * THE RADIUS HANDLE, READ ABSOLUTELY.
     *
     * The point is already in DRAWING coordinates - the shared resolver applies
     * the camera's pan and scale - and the distance from the corner along the
     * bisector IS the radius, not a delta from where the drag began. It is
     * handed to the SAME operation the Features tab calls, so the two cannot
     * disagree.
     */
    const corner = object?.geometry?.position;

    if (!corner) {
        return;
    }

    /* The drag's backup of the pipes, taken once, for the undo entry. */
    if (drag) {
        drag.object = drag.object || object;
        captureElbowPipes(drag, drawingState.objects);
    }

    const distance = Math.hypot(point.x - corner.x, point.y - corner.y);

    const wanted = enggPipeDuct.bendRadiusFromCentreDistance(object, distance);

    if (!Number.isFinite(wanted)) {
        return;
    }

    /* Bounded first, so the handle stops at the largest valid radius. */
    const limit = elbowMaxBendRadius(object);

    const target =
        limit === null
            ? wanted
            : Math.max(enggPipeDuct.MINIMUM_BEND_RADIUS, Math.min(limit, wanted));

    applyElbowRadius(object, target, { objects: drawingState.objects });
}

/*
 * SNAPSHOT THE PIPES AN ELBOW OPERATION IS ABOUT TO RE-CUT.
 *
 * A drag's `originals` holds the feature being dragged, and for an elbow that is
 * not enough: re-seating a bend moves each joined pipe's tangent end, its trim,
 * its wall seam and its span - writes to OTHER objects. The undo entry and
 * Escape both restore from this record, so an elbow edit can never be undone
 * into a half-updated sheet.
 */
function captureElbowPipes(drag, objects) {
    if (!drag || drag.elbowRuns || !Array.isArray(objects)) {
        return;
    }

    /*
     * AN ELBOW DRAG RE-CUTS THE PIPES IT JOINS; AN ENDPOINT DRAG RE-CUTS THEM
     * TOO, AND ALSO THE PIPES ON THE FAR SIDE of any bend the edit reaches.
     *
     * Settling a run's joints re-seats BOTH pipes of every fitting that run
     * belongs to, and those re-seats move tangent ends, trims, seams and spans.
     * A chain therefore changes three or four objects for a drag that names one,
     * so the set is every pipe joined to any fitting that touches the dragged
     * object - not only the fittings recorded on the object itself.
     */
    const dragged = drag.object;

    const touched = new Set(
        Array.isArray(dragged?.engineering?.connections)
            ? dragged.engineering.connections.filter(Boolean)
            : []
    );

    if (dragged?.id) {
        touched.add(dragged.id);
    }

    /*
     * AND THE ELBOWS THEMSELVES. Settling re-reads each affected fitting's
     * corner, angle, radius, trims, ports and seams - so the fitting is written
     * as well as the pipes. An undo that restored only the pipes left the bend
     * sitting at the angle and place the edit gave it, over pipes put back where
     * they were.
     */
    objects.forEach((candidate) => {
        if (!enggPipeDuct.isElbowType(candidate.type)) {
            return;
        }

        const joined = Array.isArray(candidate.engineering?.connections)
            ? candidate.engineering.connections.filter(Boolean)
            : [];

        if (joined.includes(dragged?.id) || joined.some((id) => touched.has(id))) {
            joined.forEach((id) => touched.add(id));
            touched.add(candidate.id);
        }
    });

    /* The dragged object is restored from `originals`; it is not duplicated here. */
    touched.delete(dragged?.id);

    drag.elbowRuns = Object.fromEntries(
        [...touched]
            .map((id) => objects.find((entry) => entry.id === id))
            .filter(Boolean)
            .map((run) => [run.id, JSON.parse(JSON.stringify(run))])
    );
}

/*
 * MOVING A CONNECTED ELBOW IS MOVING A JOINT.
 *
 * An elbow between two pipes is not a shape sitting on top of them: it IS their
 * corner. So a body drag moves the JOINT - the point the two runs meet at - and
 * everything else follows, exactly as when a student drags either pipe's
 * connected endpoint.
 *
 * IN THREE STEPS:
 *
 *   1. THE JOINT MOVES. The drag delta is applied to the corner as it was when
 *      the drag began, so every frame states a position instead of accumulating
 *      one.
 *   2. EACH PIPE CONNECTED END FOLLOWS. Both runs are re-aimed at the new joint,
 *      keeping their OUTER ends exactly where they are - so the pipes are
 *      lengthened, shortened or swung about those fixed ends, and never travel
 *      as rigid objects.
 *   3. THE BEND IS RE-DERIVED FROM THE RESULT. Its angle is what the two new
 *      directions make; its radius is re-fitted to the room they leave.
 */
function moveConnectedElbow(drag, object, point) {
    const original = drag.originals?.[object.id]?.geometry || null;
    const start = drag.start || null;

    if (!original || !start || !original.position) {
        return;
    }

    /* The joint, from the press - never from the live corner. */
    const joint = {
        x: original.position.x + (point.x - start.x),
        y: original.position.y + (point.y - start.y)
    };

    const connections = Array.isArray(object.engineering?.connections)
        ? object.engineering.connections
        : [];

    /* Each run re-aimed at the joint, its outer end untouched. */
    connections.forEach((runId, index) => {
        if (!runId) {
            return;
        }

        const run = (drawingState.objects || []).find((candidate) => candidate.id === runId);

        if (!run?.geometry) {
            return;
        }

        const held = object.engineering?.ports?.[runId] || (index === 0 ? "end" : "start");
        const free = held === "end" ? "start" : "end";
        const fixed = run.geometry[free];

        if (!fixed) {
            return;
        }

        run.geometry = {
            ...run.geometry,
            [held]: { x: joint.x, y: joint.y },
            span: {
                start: held === "start" ? { x: joint.x, y: joint.y } : { x: fixed.x, y: fixed.y },
                end: held === "end" ? { x: joint.x, y: joint.y } : { x: fixed.x, y: fixed.y }
            }
        };
    });

    const previousRadius = Number(object.engineering?.bendRadius);
    const userSet = enggPipeDuct.isBendRadiusUserSet(object);

    /*
     * THE BEND FROM THE NEW GEOMETRY. `updateElbowForPair` would re-solve the
     * corner from the fitting's own records - which still describe the joint
     * where it was - and pull it back, so the fitting is built here from the two
     * pipes as they now run: its arms are each pipe's FIXED far end.
     */
    const runs = [0, 1].map((index) => {
        const id = connections[index];

        return id ? (drawingState.objects || []).find((candidate) => candidate.id === id) || null : null;
    });

    const farOf = (run, index) => {
        if (!run?.geometry) {
            return null;
        }

        const held = object.engineering?.ports?.[run.id] || (index === 0 ? "end" : "start");

        return held === "end" ? run.geometry.start : run.geometry.end;
    };

    const farA = farOf(runs[0], 0);
    const farB = farOf(runs[1], 1);

    object.geometry = {
        ...(object.geometry || {}),
        position: { x: joint.x, y: joint.y }
    };

    if (farA && farB) {
        /*
         * THE ANGLE IS WHATEVER THE TWO NEW LINES MAKE. No stored value is
         * consulted, so a move that swings either pipe changes the bend.
         */
        const angleDegrees = enggPipeDuct.cornerAngleDegrees(farA, joint, farB);

        object.geometry = {
            ...object.geometry,
            previous: { x: farA.x, y: farA.y },
            next: { x: farB.x, y: farB.y }
        };

        if (Number.isFinite(angleDegrees)) {
            object.engineering = {
                ...(object.engineering || {}),
                angleDegrees,
                angle: angleDegrees
            };
        }
    }

    if (Number.isFinite(previousRadius) && previousRadius > 0) {
        enggPipeDuct.setBendRadius(object, previousRadius, { user: userSet });
    }

    /* And the pipes are seated on what the bend became. */
    reseatElbowPipes(object, drawingState.objects);
}

/* ============================================================
 * DETACHING AND RECONNECTING AN ELBOW END
 * ============================================================
 *
 * When an elbow's END handle is released, the connection record is brought up
 * to date with where the student actually let go:
 *
 *     released ON a pipe endpoint      that end is joined to it
 *     released anywhere else           that end is free
 *
 * Released near the SAME pipe it already joined, the connection is simply kept;
 * released near a DIFFERENT one, it is moved - which is the deliberate
 * reconnection the specification asks for. Nothing is ever duplicated: the record
 * is a two-slot pair, so each end has exactly one connection or none.
 *
 * A connection record is kept in step with the pipes as well: the joined run is
 * trimmed back to the bend, and the elbow's ends are re-anchored on the runs it
 * names. A released end that attached nowhere leaves no stale record behind.
 */
function settleElbowConnections(drag, event) {
    const object = (drawingState.objects || []).find((candidate) => candidate.id === drag.object?.id);

    if (!object) {
        return;
    }

    const raw = event ? resolvePointerEvent(event).rawPointerPoint : null;

    if (!raw) {
        return;
    }

    const endId = drag.kind === "start" ? 0 : drag.kind === "end" ? 1 : null;

    if (endId === null) {
        return;
    }

    const connections = Array.isArray(object.engineering?.connections)
        ? [...object.engineering.connections]
        : [null, null];

    const match = pipeEndAt(raw, drawingState.objects);

    /*
     * AN AUTOMATIC FITTING IS DECIDED BY GEOMETRY, NOT BY ITS RECORD.
     *
     * Its two ends ARE the runs it joins, so a release is followed by the same
     * reconciliation every other movement of a pipe goes through: an end that
     * now meets a pipe's end is joined to it (and the bend re-solved around the
     * new corner), an end released in open space is left with nothing to join,
     * and the pipes are re-seated onto the tangent points that result.
     */
    if (object.engineering?.generated !== false) {
        retargetGeneratedElbow(object, endId);

        reconcileFluidConnections(object, drawingState.objects);

        renderCurrentDrawing();
        renderProperties();

        return;
    }

    /* The same pipe's same end: nothing to change. */
    if (!match) {
        connections[endId] = null;
    } else {
        const other = connections[endId === 0 ? 1 : 0];

        if (other === match.run.id) {
            /* An elbow cannot join one run at both ends. */
            connections[endId] = null;
        } else {
            connections[endId] = match.run.id;

            enggPipeDuct.moveElbowEnd(object, endId === 0 ? "a" : "b", match.point);
        }
    }

    object.engineering = {
        ...(object.engineering || {}),
        connections
    };

    applyManualElbowConnections(object, drawingState.objects);

    renderCurrentDrawing();
    renderProperties();
}
