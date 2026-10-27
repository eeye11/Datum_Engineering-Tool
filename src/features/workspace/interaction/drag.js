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
import { boundarySeparation } from "../model/fluids/pipe-duct.js";

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

    const resizingPipe = editorState.manipulationDrag.object?.type === "pipe-duct" &&
        /^corner[0-3]$/.test(editorState.manipulationDrag.kind);

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
        resizingPipe || editorState.manipulationDrag.group || editorState.manipulationDrag.kind === "body"
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
                    : object
        );

    enggDrawingState.commitDrawingChange(
        drawingState,
        originalObjects
    );

    drawingState.objects =
        dragged;

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

    if (object.type === "pipe-duct" && /^corner[0-3]$/.test(drag.kind)) {
        const original = drag.originals[object.id];
        const bounds = selectionBounds([original], [original.id]);
        if (!bounds) return;
        const corners = selectionCorners(bounds);
        const index = Number(drag.kind.slice(-1));
        const anchor = corners[(index + 2) % 4];
        const corner = corners[index];
        // Keep the initial grab offset: pressing near a dot must not make
        // the corner jump to the pointer on the first frame.
        const target = {
            x: corner.x + point.x - drag.start.x,
            y: corner.y + point.y - drag.start.y
        };
        const sx = Math.max(0.01, (target.x - anchor.x) / (corner.x - anchor.x));
        const sy = Math.max(0.01, (target.y - anchor.y) / (corner.y - anchor.y));
        const transform = value => ({ x: anchor.x + (value.x - anchor.x) * sx, y: anchor.y + (value.y - anchor.y) * sy });
        g.start = transform(original.geometry.start);
        g.end = transform(original.geometry.end);
        const dx = original.geometry.end.x - original.geometry.start.x;
        const dy = original.geometry.end.y - original.geometry.start.y;
        const lengthScale = Math.hypot(dx * sx, dy * sy) / Math.hypot(dx, dy);
        object.engineering = {
            ...original.engineering,
            schematicWidth: boundarySeparation(original.engineering) * sx * sy / lengthScale
        };
        return;
    }

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

        return;
    }

    if (drag.kind === "body" || drag.kind === "group-resize") {
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

    const original =
        drag.originals?.[object.id]?.geometry;

    if (object.type === "point") {
        const target =
            g.position || g.point || g;

        target.x = point.x;
        target.y = point.y;
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
            if (object.metadata?.thermodynamicsKind === "process-path" && object.metadata.closed && index === 0) {
                g.points[g.points.length - 1] = { x: point.x, y: point.y };
            }
        }
    }
}
