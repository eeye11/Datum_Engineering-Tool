/*
 * Pointer events on the canvas, and closing menus on outside clicks.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggAnnotate from "../model/annotations/annotate-model.js";
import { isIdleForEditing } from "../annotate/annotation-tool.js";
import { finishProcessPath, isProcessPlotTool } from "../thermodynamics/process-path.js";
import { installAxisLabelEditor } from "../thermodynamics/axis-label-editor.js";
import { beginCreationDrag, cancelCreationDrag, finishCreationDrag, moveCreationDrag } from "./creation-drag.js";
import { handleCanvasClick, openNoteEditorFor, openTableCellEditorFor, syncSelectionInteraction } from "./canvas-click.js";
import { isEditableAnnotate } from "../annotate/annotate-creation.js";
import { openDimensionValuePrompt } from "../annotate/dimension-tool.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { pickColourFromFeature } from "../../../components/layout/panels/colour-picker.js";
import { isConstructionTool } from "../../../components/layout/toolbar/construction-tools.js";
import { drawingCanvas, drawingCoordinates } from "../dom.js";
import { beginManipulationDrag, finishManipulationDrag, updateManipulationDrag } from "./drag.js";
import { drawingState, editorState } from "../editor-state.js";
import { objectAtPoint } from "./hit-testing.js";
import { updateDrawingCoordinates } from "./pointer.js";
import { beginAnnotationDrag, beginSelectionDrag, cancelInteraction, finishPolyline, finishSelectionDrag, updateSelectionDrag } from "./selection.js";
import { canvasPointFromEvent } from "../../../components/layout/toolbar/tool-activation.js";
import { closeCoordinateSystemMenu } from "../../../components/layout/toolbar/tool-menus.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";
import { finishTrussConstruction } from "../statics/truss-tool.js";
import { applyTwoFingerGesture, zoomAtCanvasPoint } from "../../../components/layout/workspace/viewport.js";
import { ROUTE_PHASE, ELBOW_PHASE, finishRouteConstruction, finishElbowConstruction } from "./pipe-duct-tool.js";
import { createGestureTracker, pointerKind } from "./pointer-gesture.js";
import { isIncidentalContact, isPenDown, notePenDown, notePenUp, resetPen } from "./palm.js";
import { openCanvasContextMenuAt } from "./context-menu.js";
import { cancelManipulationDrag, handleAtPoint } from "./handles.js";
import { allowsDirectManipulation } from "./direct-manipulation.js";

/*
 * THE CANVAS'S ONE GESTURE TRACKER.
 *
 * One per page, beside the canvas it belongs to, in the same way the pan session
 * and the drag records live on `editorState`. It holds no document state, so a
 * new document does not need a new tracker - only `reset()` when the surface
 * loses the pointer entirely.
 */
const canvasGesture = createGestureTracker();

/* Read through the module rather than cached, so the pen state is never stale. */
function isPenDownNow() {
    return isPenDown();
}

let longPressTimer = null;

/*
 * ========================================================
 * A DOUBLE TAP IS A DOUBLE CLICK
 * ========================================================
 *
 * A finger has no `dblclick`, and the application's "open this" gesture - edit a
 * dimension, open an annotation's text - must stay reachable on a tablet. Two
 * taps are therefore replayed as the SAME `dblclick` the mouse produces, so
 * there is one implementation of the behaviour.
 *
 * It deliberately does NOT zoom. Pinch already zooms, and giving a double tap a
 * second meaning would make object editing unreachable by finger.
 */
let lastTap = null;

const DOUBLE_TAP_MS = 400;
const DOUBLE_TAP_SLOP_PX = 24;

function noteTap(event) {
    if (pointerKind(event) === "mouse") {
        /* The browser's own `dblclick` already reports this one. */
        return;
    }

    const now = Date.now();
    const previous = lastTap;

    lastTap = { x: event.clientX, y: event.clientY, at: now, kind: pointerKind(event) };

    if (!previous || previous.kind !== pointerKind(event)) {
        return;
    }

    if (now - previous.at > DOUBLE_TAP_MS) {
        return;
    }

    if (Math.hypot(event.clientX - previous.x, event.clientY - previous.y) > DOUBLE_TAP_SLOP_PX) {
        return;
    }

    lastTap = null;

    replayDoubleClick(event);
}

/*
 * THE SAME HANDLER THE MOUSE REACHES. A synthetic event is dispatched rather
 * than a second copy of the rules, so "what a double-click does" cannot diverge
 * between a mouse and a finger.
 */
function replayDoubleClick(pointer) {
    const Mouse = globalThis.MouseEvent || globalThis.window?.MouseEvent;

    if (typeof Mouse !== "function") {
        return;
    }

    const event = new Mouse("dblclick", {
        bubbles: true,
        cancelable: true,
        clientX: pointer.clientX,
        clientY: pointer.clientY,
        detail: 2
    });

    drawingCanvas.dispatchEvent(event);
}

function cancelLongPress() {
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }
}

/*
 * A STILL FINGER OR PEN, HELD ON THE DRAWING, OPENS THE FEATURE MENU.
 *
 * The one duration and the one movement allowance are the tracker's, so a hold
 * cannot drift from the gesture rules; movement, a second finger, a release and
 * a cancellation all end it.
 */
function beginLongPress(event) {
    cancelLongPress();

    if (pointerKind(event) === "mouse" || canvasGesture.navigating) {
        return;
    }

    const pressed = {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        clientX: event.clientX,
        clientY: event.clientY
    };

    longPressTimer = setTimeout(() => {
        longPressTimer = null;

        if (!canvasGesture.longPressDue(pressed)) {
            return;
        }

        canvasGesture.markLongPressed(pressed);

        /* The menu owns the press; the click behind it would close it at once. */
        editorState.selectionClickSuppressed = true;
        editorState.creationDragConsumedClick = true;

        openCanvasContextMenuAt(pressed.clientX, pressed.clientY);
    }, canvasGesture.config.longPressMs);
}

/*
 * ABANDON WHATEVER THE GESTURE HAD BEGUN, KEEPING WHAT WAS COMMITTED.
 *
 * The same rollback Escape and each tool's own Cancel use, so a multi-step
 * construction keeps its committed stages and drops only the unfinished preview.
 */
function cancelInterruptedGesture() {
    try {
        cancelCreationDrag();
    } catch {}

    try {
        cancelManipulationDrag();
    } catch {}

    try {
        cancelInteraction();
    } catch {}

    editorState.panSession = null;
    editorState.selectionDrag = null;
    editorState.touchPress = null;

    renderCurrentDrawing();
}

/*
 * THE CANVAS'S ONE PRESS DISPATCH.
 *
 * The body the `pointerdown` listener has always run, named so a held touch
 * press can reach it too. Calling it is, for every purpose, the same as that
 * listener running - the mouse reaches it from the listener, a finger from
 * `dispatchHeldTouchPress` once its drag is recognised, and neither can run it
 * twice for one press.
 */
function runPointerPress(event) {
    /* An armed eyedropper pre-empts every other canvas interaction. */
    if (editorState.eyedropperActive) {
        event.preventDefault();
        event.stopPropagation();

        pickColourFromFeature(event);

        return;
    }

    /* A magnitude label is grabbed by its own text. */
    if (beginAnnotationDrag(event)) {
        return;
    }

    /*
     * A CREATION IS STARTED BY THE PRESS: for a two-point tool the press is its
     * first point, and the release completes it.
     */
    if (beginCreationDrag(event)) {
        captureForDragTools(event);

        return;
    }

    if (beginManipulationDrag(event)) {
        return;
    }

    beginSelectionDrag(event);
}

/*
 * PIPE / DUCT AND POLAR VECTOR CAPTURE THE POINTER FOR THEIR DRAGS.
 *
 * Their whole gesture is the drag, so capture belongs on the press - the release
 * must arrive even if the pointer leaves the canvas. The other geometry and
 * Statics tools defer their press, so capturing on theirs would redirect the
 * click that IS their first point.
 */
function captureForDragTools(event) {
    if (
        drawingState.activeTool === "pipe-duct" ||
        drawingState.activeTool === "dynamics-polar-vector"
    ) {
        try {
            drawingCanvas.setPointerCapture(event.pointerId);
        } catch {}
    }
}

/*
 * Would this press begin a SELECTION or a DRAG on an existing feature?
 *
 * Asked before the press is dispatched so that only a press which could pick
 * something is held for classification. A press on empty canvas, or with a
 * creation tool armed, is the tool's own input and reaches its handler at once.
 */
function pressStartsManipulation(event) {
    if (!allowsDirectManipulation() || editorState.eyedropperActive) {
        return false;
    }

    const inputKind = pointerKind(event);
    const point = canvasPointFromEvent(event, false);

    if (!point) {
        return false;
    }

    if (handleAtPoint(point, { inputKind })) {
        return true;
    }

    const object = objectAtPoint(point, { inputKind });

    return Boolean(object && !object.locked && object.visible !== false);
}

/* Only touch and pen are held; a mouse press must reach its handler at once. */
function shouldHoldTouchPress(event) {
    const kind = pointerKind(event);

    if (kind !== "touch" && kind !== "pen") {
        return false;
    }

    return pressStartsManipulation(event);
}

/*
 * KEEP THE PRESS, so it can be dispatched once the gesture is known.
 *
 * A snapshot rather than the event itself: a DOM event is only guaranteed
 * readable while it is being dispatched, and this is kept across frames.
 */
function holdTouchPress(event) {
    editorState.touchPress = {
        event: {
            pointerId: event.pointerId,
            pointerType: event.pointerType,
            clientX: event.clientX,
            clientY: event.clientY,
            button: event.button,
            buttons: event.buttons,
            shiftKey: event.shiftKey,
            altKey: event.altKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            target: event.target,
            preventDefault() {},
            stopPropagation() {}
        },
        dispatched: false
    };
}

/* Run the held press through the ordinary press path, from the PRESS's point. */
function dispatchHeldTouchPress() {
    const held = editorState.touchPress;

    if (!held || held.dispatched) {
        return false;
    }

    held.dispatched = true;

    runPointerPress(held.event);

    return true;
}

/*
 * What one frame of a touch or pen gesture means.
 *
 * The tracker already knows the input's slop, whether a second finger took over
 * and whether a long press is still possible; this does the one thing the frame
 * means.
 */
/*
 * THE ERASER HOLDS AN OBJECT, IT DOES NOT DELETE ONE.
 *
 * An eraser tip is a destructive input, and a browser cannot distinguish a
 * deliberate press from an accidental one. So the eraser SELECTS what it is on
 * and says so; deleting stays the established Delete key or menu command,
 * acting on a selection the student can see.
 */
function deleteWhatTheTipTouched(event) {
    const point = canvasPointFromEvent(event, false);
    const object = point ? objectAtPoint(point, { inputKind: "pen" }) : null;

    if (!object || object.locked) {
        setToolMessage("Eraser: nothing to remove here");

        return;
    }

    enggDrawingState.selectObject(drawingState, object.id);

    renderCurrentDrawing();

    setToolMessage("Eraser: selected - press Delete to remove");
}

function classifyTouchFrame(event) {
    if (canvasGesture.navigating) {
        return;
    }

    const decision = canvasGesture.move(event);

    if (decision.kind !== "drag-start") {
        return;
    }

    if (!editorState.touchPress) {
        return;
    }

    dispatchHeldTouchPress();

    /*
     * AND THE POINTER IS CAPTURED, so a finger that leaves the canvas mid-drag
     * still receives its own moves and its own release. The existing pointerup
     * and pointercancel handlers give it back.
     */
    captureForDragTools(event);

    try {
        drawingCanvas.setPointerCapture(event.pointerId);
    } catch {}
}

/*
 * Wire this part of the editor to the page. Called once, at start-up,
 * by editor/index.js.
 */
export function installCanvasEvents() {
    if (
        drawingCanvas
    ) {
        installAxisLabelEditor();
        /*
         * THE FRAME'S RESOLUTION RUNS ON `pointermove`, FOR EVERY INPUT.
         *
         * It used to be `mousemove`, which is exactly what a finger and a stylus
         * never fire - so on a tablet the preview, the snap indicator and the
         * status text were a frame stale, or never arrived. A pointer move is
         * delivered for all three kinds, and a mouse's `pointermove` and
         * `mousemove` describe the same frame - so the handler is MOVED, not
         * duplicated, and a mouse sees it exactly once.
         */
        drawingCanvas.addEventListener(
            "pointermove",
            updateDrawingCoordinates
        );

        drawingCanvas.addEventListener(
            "click",
            handleCanvasClick
        );

        drawingCanvas.addEventListener(
            "dblclick",
            event => {
                /*
                 * A DIMENSION OR ANNOTATION EDITS ITSELF.
                 *
                 * Checked FIRST, and ahead of every other double-click
                 * rule, for two reasons.
                 *
                 * It is the right behaviour: a double-click is the
                 * application's "open this" gesture, and a dimension's
                 * editor should be reachable by double-clicking the
                 * dimension itself rather than by hunting through the
                 * Features panel.
                 *
                 * And it is a guard. Double-clicks on the canvas were
                 * reaching tool-specific rules - finishing a polyline,
                 * finishing a truss - and a dimension under the cursor
                 * could draw one of those in instead of doing what was
                 * asked. Routing dimensions to their own handler, and
                 * stopping the event there, means no later rule can
                 * reinterpret a double-click that landed on one.
                 *
                 * Only while nothing is being constructed: a double-click
                 * during a live construction belongs to that construction.
                 */
                if (
                    event.detail > 1 &&
                    isIdleForEditing()
                ) {
                    const pointed =
                        objectAtPoint(
                            canvasPointFromEvent(
                                event,
                                false
                            )
                        );

                    /*
                     * A DIMENSION OPENS ON A DIRECT DOUBLE-CLICK.
                     *
                     * Double-clicking the number IS the request to change it,
                     * so a dimension needs no prior selection: the gesture is
                     * unambiguous, and requiring a selecting click first would
                     * put the value one step further away than it needs to be.
                     *
                     * THIS DOES NOT MOVE THE DIMENSION. Opening the editor only
                     * reports the value; only a press-and-drag changes where
                     * the number sits.
                     */
                    if (pointed?.type === "dimension") {
                        event.preventDefault();
                        event.stopPropagation();

                        /*
                         * THE STANDARD VALUE POPUP, NOT A DIMENSION EDITOR.
                         *
                         * A double-click on a dimension opens the SAME value
                         * box a Length, a Force and a moment magnitude use - the
                         * one the student already knows - and NEVER the World
                         * Scale question. A scale is a property of the SHEET,
                         * and it was being asked every time somebody wanted to
                         * change a number.
                         */
                        openDimensionValuePrompt(pointed);

                        return;
                    }

                    /*
                     * ANNOTATION STILL NEEDS ITS SELECTING CLICK FIRST.
                     *
                     * A note is placed and then written into, and almost
                     * every interaction with one is a click or a drag to move
                     * it - so an UNSELECTED one only selects on the first of
                     * the pair, and the second double-click opens the editor.
                     * That is the distinction which keeps a stray click from
                     * opening a dialog nobody asked for.
                     */
                    if (
                        (pointed?.type === "annotation" ||
                            isEditableAnnotate(pointed)) &&
                        !drawingState.selection
                            .selectedObjectIds.includes(
                                pointed.id
                            )
                    ) {
                        /*
                         * Deliberately NOT stopping the event. The click that
                         * selected the annotation has done its job, and letting
                         * the first click of the pair stand as an ordinary
                         * selection is what makes the second one meaningful.
                         */
                        return;
                    }

                    if (pointed?.type === "annotation") {
                        event.preventDefault();
                        event.stopPropagation();

                        /*
                         * The annotation's editor is the note editor.
                         * openNoteEditorFor refuses a GENERATED annotation,
                         * whose text is not writable, and returns false for one
                         * - the double-click is then swallowed rather than
                         * reinterpreted, which is the honest outcome for a
                         * thing that cannot be opened.
                         */
                        openNoteEditorFor(pointed);

                        return;
                    }

                    /*
                     * AN ANNOTATE FEATURE'S TEXT OPENS THE SAME WAY.
                     *
                     * A note, a label, a leader and a callout hold text the
                     * student wrote, so double-clicking one opens the write
                     * box - the same gesture and the same editor a legacy
                     * annotation uses. A symbol, a tolerance and a table
                     * render from fields of their own rather than from free
                     * text, so they are left to the panel and the double-click
                     * falls through rather than opening an editor for
                     * something that is not text.
                     */
                    /*
                     * A TABLE CELL EDITS IN PLACE, LIKE A WORD-PROCESSOR TABLE.
                     *
                     * Double-clicking a table opens the editor for the CELL
                     * under the cursor - not for the table as a whole - so the
                     * student types into the cell they pointed at without
                     * hunting through the panel. The cell is found from the
                     * table's own geometry (`tableCellAt`), so the editor and the
                     * drawn grid cannot disagree about which cell was hit.
                     *
                     * The write box is the SAME one a note uses, so a cell is
                     * edited the same way as every other piece of text in the
                     * application.
                     */
                    if (
                        pointed?.type === "annotate" &&
                        pointed.annotateKind === "table"
                    ) {
                        const cellPoint = canvasPointFromEvent(event, false);

                        const cellIndex = enggAnnotate?.tableCellAt?.(
                            pointed,
                            cellPoint
                        );

                        if (
                            Number.isInteger(cellIndex) &&
                            cellIndex >= 0
                        ) {
                            event.preventDefault();
                            event.stopPropagation();

                            openTableCellEditorFor(pointed, cellIndex);

                            return;
                        }
                    }

                    if (isEditableAnnotate(pointed)) {
                        event.preventDefault();
                        event.stopPropagation();

                        openNoteEditorFor(pointed);

                        return;
                    }
                }

                if (
                    ["polyline", "freeform-polygon"].includes(
                        drawingState.activeTool
                    )
                ) {
                    event.preventDefault();

                    finishPolyline();
                    return;
                }
                if (isProcessPlotTool(drawingState.activeTool)) {
                    event.preventDefault();
                    finishProcessPath();
                    return;
                }

                /*
                 * A truss is finished by double-clicking, which is
                 * the only explicit "I am done" a progressive
                 * construction needs. The click that precedes it has
                 * already placed the last member, so by the time the
                 * double-click arrives there is nothing left to
                 * discard.
                 */
                if (
                    drawingState.activeTool ===
                        "truss" &&
                    drawingState.interaction
                        .phase ===
                        "truss-construct"
                ) {
                    event.preventDefault();

                    finishTrussConstruction();
                    return;
                }

                /*
                 * A PIPE / DUCT PATH IS FINISHED THE SAME WAY, by a
                 * double-click - the one explicit "I am done" a progressive
                 * drawing needs. Each run is already committed, so nothing is
                 * left to discard: finishing only clears the continuation, and
                 * the tool stays armed for a fresh path.
                 *
                 * The test is the ARMED FLUIDS TOOL, not the phase, because a
                 * run is committed on release and the phase is therefore idle
                 * between legs - which is exactly when a student would
                 * double-click to say they are done.
                 */
                if (
                    drawingState.activeTool === "pipe-duct" ||
                    drawingState.interaction.fluidsTool ===
                        "pipe-duct" ||
                    drawingState.interaction.phase === ROUTE_PHASE
                ) {
                    event.preventDefault();

                    finishRouteConstruction();
                    return;
                }

                /*
                 * THE ELBOW TOOL IS FINISHED THE SAME WAY, and for the same
                 * reason: it commits on release, so a double-click between
                 * fittings is the student saying they are done.
                 */
                if (
                    drawingState.activeTool === "elbow" ||
                    drawingState.interaction.fluidsTool === "elbow" ||
                    drawingState.interaction.phase === ELBOW_PHASE
                ) {
                    event.preventDefault();

                    finishElbowConstruction();
                    return;
                }

                /*
                 * The Distributed Load is also finished explicitly,
                 * and with Enter rather than a double-click, because a
                 * double-click is two more points along the body. The
                 * guard is here as well so a stray double-click
                 * during construction never commits a half-drawn
                 * load.
                 */
                if (
                    drawingState.interaction
                        .phase ===
                        "distributed-load-build" &&
                    !drawingState.interaction
                        .distributedLoadHasProfile
                ) {
                    return;
                }
            }
        );

        /*
         * Direct manipulation takes priority over box
         * selection: a press on a handle or on the body of a
         * selected object starts a geometry drag, otherwise
         * the press falls through to box selection.
         */
        drawingCanvas.addEventListener(
            "pointerdown",
            event => {
                /*
                 * A TOUCH OR PEN PRESS ON AN EDITING TARGET IS HELD FIRST.
                 *
                 * A mouse cannot wobble while it is held still, so its press is
                 * the tool's press the moment it happens. A finger can - a few
                 * pixels of settled weight are normal - so a touch press on
                 * something that can be grabbed is recorded here and dispatched
                 * only once the shared gesture tracker says it travelled far
                 * enough to be a drag. A press that never travels leaves the
                 * browser's own click to run the ordinary selection, which is
                 * what a tap is.
                 *
                 * The handlers below are otherwise unchanged: the same
                 * `runPointerPress` runs for both, so a finger and a mouse reach
                 * one implementation of every tool.
                 */
                if (shouldHoldTouchPress(event)) {
                    holdTouchPress(event);

                    return;
                }

                runPointerPress(event);
            }
        );

        /*
         * ========================================================
         * ONE GESTURE TRACKER, WIRED TO THE EXISTING TOOL PIPELINE
         * ========================================================
         *
         * Every pointer move is classified by the shared tracker, which decides
         * what the gesture MEANS (tap, drag, pan, pinch) from the input's own
         * tolerances. What it decides is then dispatched to the handler that
         * already existed for that meaning, so a finger reaches the same code a
         * cursor does.
         */
        drawingCanvas.addEventListener(
            "pointermove",
            event => {
                classifyTouchFrame(event);
            }
        );

        drawingCanvas.addEventListener(
            "pointermove",
            event => {
                /*
                 * A DRAG-TO-CREATE KEEPS ITS PREVIEW LIVE.
                 *
                 * The ordinary `mousemove` listener already redraws the
                 * construction preview, but that is a MOUSE event - a pen or
                 * a touch pointer produces `pointermove` without it. Driving
                 * the same update from here means the preview follows every
                 * kind of pointer, and it is the same function the mouse
                 * path calls, so the two cannot describe different geometry.
                 */
                if (editorState.creationDrag) {
                    /*
                     * TOLD HOW FAR THE POINTER HAS TRAVELLED, so the gesture can
                     * be classified as a click or a drag on release. The preview
                     * itself is updated by the same call below, unchanged.
                     */
                    moveCreationDrag(event);

                    updateDrawingCoordinates(
                        event
                    );

                    return;
                }

                if (editorState.manipulationDrag) {
                    updateManipulationDrag(
                        event
                    );

                    return;
                }

                updateSelectionDrag(
                    event
                );
            }
        );

        drawingCanvas.addEventListener(
            "pointerup",
            event => {
                /*
                 * GIVE THE POINTER BACK FIRST, WHATEVER THE RELEASE DOES.
                 *
                 * A pipe-duct press captures the pointer so its drag survives
                 * leaving the canvas. The capture is released HERE, before the
                 * gesture is classified, so it is dropped whether the release
                 * commits a run or turns out to be an ordinary click - neither
                 * path may leave the canvas holding a capture the gesture has
                 * finished with.
                 */
                if (
                    drawingCanvas.hasPointerCapture(
                        event.pointerId
                    )
                ) {
                    try {
                        drawingCanvas.releasePointerCapture(
                            event.pointerId
                        );
                    } catch {}
                }

                /*
                 * A DRAG-TO-CREATE ENDS AT THE RELEASE.
                 *
                 * The final cursor position is the second point, so the
                 * feature is committed here rather than waiting for a
                 * second click. Tried first, because the gesture belongs
                 * to the creation and must not be reinterpreted as the
                 * end of a selection or manipulation drag.
                 */
                if (
                    finishCreationDrag(
                        event
                    )
                ) {
                    /*
                     * The browser will fire a `click` for this same
                     * release. It is a consequence of the gesture that has
                     * just committed a feature, not a new first point, so
                     * it is marked consumed and the click handler drops it
                     * instead of starting a second construction.
                     */
                    editorState.creationDragConsumedClick =
                        true;

                    return;
                }

                if (editorState.manipulationDrag) {
                    finishManipulationDrag(
                        event
                    );

                    return;
                }

                finishSelectionDrag(
                    event
                );
            }
        );

        /*
         * A CANCELLED POINTER GESTURE RELEASES THE CREATION PRESS.
         *
         * The browser cancels a pointer when the system takes it away - a
         * touch that becomes a scroll, a pen leaving range, a window losing
         * focus. Without this the session stayed armed, and the NEXT pointerup
         * anywhere would be read as the release of a gesture that had already
         * been abandoned: a stray click would complete a half-drawn feature.
         *
         * Nothing is committed. The construction itself is left as the press
         * left it, so the student can carry on with a second click or press
         * Escape to cancel - which is the same state a click leaves.
         */
        drawingCanvas.addEventListener(
            "pointercancel",
            event => {
                editorState.creationDrag = null;

                /*
                 * A CANCELLED DRAG MUST NOT KEEP THE CAPTURE.
                 *
                 * A pipe-duct press captures the pointer; if the gesture is
                 * cancelled before the release the capture has to be dropped
                 * here, or the canvas would keep swallowing that pointer's
                 * events and the next gesture would never begin.
                 */
                if (
                    event &&
                    drawingCanvas.hasPointerCapture(
                        event.pointerId
                    )
                ) {
                    try {
                        drawingCanvas.releasePointerCapture(
                            event.pointerId
                        );
                    } catch {}
                }
            }
        );

        /*
         * POINTER RELEASE OUTSIDE CANVAS.
         *
         * If pointer capture was interrupted or the release arrived on window,
         * finish the creation drag reliably so the gesture is never discarded.
         */
        window.addEventListener(
            "pointerup",
            event => {
                if (editorState.creationDrag && event.target !== drawingCanvas) {
                    if (
                        drawingCanvas.hasPointerCapture(
                            event.pointerId
                        )
                    ) {
                        try {
                            drawingCanvas.releasePointerCapture(
                                event.pointerId
                            );
                        } catch {}
                    }

                    if (
                        finishCreationDrag(
                            event
                        )
                    ) {
                        editorState.creationDragConsumedClick =
                            true;
                    }
                }
            }
        );

        /*
         * ========================================================
         * THE DRAWING SURFACE OWNS ITS TOUCH GESTURES
         * ========================================================
         *
         * `touch-action: none` is scoped to the CANVAS ELEMENT and nowhere else.
         * It tells the browser that this one surface is driven by the
         * application's own pointer handling rather than by its scroll/zoom
         * recogniser - without it a pinch on a tablet zooms the PAGE. Panels,
         * menus and the Source editor keep native scrolling, which is why this
         * is set here and not in a global stylesheet rule.
         */
        drawingCanvas.style.touchAction = "none";

        /*
         * EVERY PRESS, OF EVERY KIND, IS CLASSIFIED HERE, FIRST.
         *
         * Registered before the tool handlers so a second finger can take the
         * gesture over before any tool has been handed the movement. A mouse is
         * left exactly as it was: its press goes on to the handlers below,
         * untouched.
         */
        drawingCanvas.addEventListener(
            "pointerdown",
            event => {
                /*
                 * A CONTACT THE PALM RULE HAS DECLINED IS RECORDED, NOT USED.
                 * Marking it incidental keeps it out of the pair measure, so a
                 * resting hand beside a pen cannot become half of a pinch and
                 * cancel the stroke.
                 */
                const decision = canvasGesture.press(event, {
                    incidental: isIncidentalContact(event),
                    keepPrimary: pointerKind(event) === "touch" && isPenDownNow()
                });

                if (decision.kind === "navigate-begin") {
                    cancelLongPress();

                    /*
                     * TWO FINGERS: whatever the first finger had begun is
                     * abandoned, not committed - through the tool's own cancel,
                     * so a multi-step construction keeps its committed stages.
                     */
                    cancelInterruptedGesture();

                    try {
                        drawingCanvas.setPointerCapture(event.pointerId);
                    } catch {}

                    setToolMessage("Two fingers: move to pan, spread to zoom");

                    event.preventDefault();
                    event.stopPropagation();
                }
            },
            { capture: true }
        );

        /* A second finger is navigating; the tool must not see it. */
        drawingCanvas.addEventListener(
            "pointerdown",
            event => {
                if (canvasGesture.navigating) {
                    return;
                }

                /* An incidental palm contact while a pen is down is not a press. */
                if (isIncidentalContact(event)) {
                    event.preventDefault();
                    event.stopPropagation();

                    return;
                }

                beginLongPress(event);
            },
            { capture: true }
        );

        /*
         * ========================================================
         * MULTI-TOUCH NAVIGATION: PAN AND PINCH
         * ========================================================
         *
         * Two fingers never touch the document. A step of the gesture is a
         * midpoint and a spread, applied to the CAMERA - the same camera the
         * wheel, the Hand tool and a middle-button drag move - so a pinch cannot
         * create, select or move anything, because it never reaches the object
         * model.
         */
        drawingCanvas.addEventListener("pointermove", event => {
            /* A hold ends the moment the finger travels; the tracker decides how far. */
            cancelLongPress();

            if (!canvasGesture.navigating) {
                return;
            }

            const decision = canvasGesture.move(event);

            if (decision.kind !== "navigate") {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            applyTwoFingerGesture(decision);
        });

        drawingCanvas.addEventListener("pointerup", event => {
            cancelLongPress();

            if (!canvasGesture.navigating && !canvasGesture.primary) {
                return;
            }

            const decision = canvasGesture.release(event);

            if (decision.kind === "tap") {
                noteTap(event);

                return;
            }

            if (decision.kind !== "navigate-end") {
                return;
            }

            try {
                if (drawingCanvas.hasPointerCapture(event.pointerId)) {
                    drawingCanvas.releasePointerCapture(event.pointerId);
                }
            } catch {}

            /* When the last finger lifts, the next one is an edit again. */
            if (!canvasGesture.navigating) {
                const finished = canvasGesture.reset();

                if (finished.navigating) {
                    setToolMessage("Ready");
                }
            }
        });

        /*
         * THE PLATFORM TOOK THE POINTER AWAY. A cancelled gesture must be rolled
         * back, never committed: nothing was released on purpose.
         */
        drawingCanvas.addEventListener("pointercancel", event => {
            cancelLongPress();

            const decision = canvasGesture.release(event, { cancelled: true });

            if (decision.kind === "cancelled") {
                cancelInterruptedGesture();
            }

            if (decision.kind === "navigate-end") {
                canvasGesture.reset();
            }

            if (event.pointerType === "pen") {
                notePenUp();
            }
        });

        /* A lost capture is a cancel: the element no longer receives the moves. */
        drawingCanvas.addEventListener("lostpointercapture", event => {
            if (canvasGesture.primary && canvasGesture.primary.id === event.pointerId) {
                const decision = canvasGesture.release(event, { cancelled: true });

                if (decision.kind === "cancelled") {
                    cancelInterruptedGesture();
                }
            }
        });

        /*
         * THE PEN'S CONTACT LIFETIME, for the palm rule - the canvas is the only
         * place a resting hand can do damage.
         */
        drawingCanvas.addEventListener(
            "pointerdown",
            event => {
                if (pointerKind(event) === "pen") {
                    notePenDown();
                }
            },
            { capture: true }
        );

        drawingCanvas.addEventListener(
            "pointerup",
            event => {
                if (pointerKind(event) === "pen") {
                    notePenUp();
                }
            },
            { capture: true }
        );

        drawingCanvas.addEventListener(
            "pointerleave",
            event => {
                /* A pen that leaves the surface without a release has ended. */
                if (pointerKind(event) === "pen" && event.buttons === 0) {
                    notePenUp();
                }
            },
            { capture: true }
        );

        /*
         * ========================================================
         * A STYLUS'S EXTRA BUTTONS - ONLY WHEN THE DEVICE HAS THEM
         * ========================================================
         *
         * A pen reports its side buttons through `button` on the pointer event,
         * not through any capability query, so the rule is: IF a value arrives
         * that only a barrel button or the eraser can produce, act on it;
         * otherwise do nothing at all.
         *
         *   button 2 (barrel)   the SAME feature menu a right-click opens
         *   button 5 (eraser)   SELECTS what the tip is on - never a silent
         *                       delete, because a browser cannot tell a
         *                       deliberate press from an accidental one
         *   button 1 (middle)   the existing middle-button pan, unchanged
         */
        drawingCanvas.addEventListener(
            "pointerdown",
            event => {
                if (pointerKind(event) !== "pen") {
                    return;
                }

                if (event.button === 2) {
                    event.preventDefault();
                    event.stopPropagation();

                    editorState.selectionClickSuppressed = true;
                    editorState.creationDragConsumedClick = true;

                    openCanvasContextMenuAt(event.clientX, event.clientY);

                    return;
                }

                if (event.button === 5) {
                    event.preventDefault();
                    event.stopPropagation();

                    deleteWhatTheTipTouched(event);
                }
            },
            { capture: true }
        );

        /* A torn-down surface leaves no gesture, no pen and no capture behind. */
        globalThis.window?.addEventListener?.("pagehide", () => {
            canvasGesture.reset();
            resetPen();
        });

        drawingCanvas.addEventListener(
            "wheel",
            event => {
                event.preventDefault();

                zoomAtCanvasPoint(
                    drawingState.camera.zoom *
                        (
                            event.deltaY < 0
                                ? 1.1
                                : 0.9
                        ),
                    event
                );
            },
            {
                passive: false
            }
        );

        drawingCanvas.addEventListener(
            "pointerdown",
            event => {
                /*
                 * THE MIDDLE BUTTON PANS, WHATEVER TOOL IS ARMED.
                 *
                 * This is the navigation an engineering CAD user already has in
                 * their hands: press the wheel, move, release. It has to work
                 * WITHOUT selecting the Pan tool first, because the whole point
                 * of it is that looking around never interrupts what you are
                 * doing - and it must not steal the tool's own click, so the
                 * event is stopped only for the button that pans.
                 *
                 * The LEFT button keeps its meaning: it belongs to the armed
                 * tool, and to Pan only when Pan is the armed tool.
                 */
                const middle = event.button === 1;

                const panning =
                    middle ||
                    drawingState.activeTool === "pan";

                if (!panning) {
                    return;
                }

                /*
                 * The browser's own middle-click behaviours - autoscroll on
                 * Windows, paste on Linux - are suppressed, because the middle
                 * button is being used for something here.
                 */
                if (middle) {
                    event.preventDefault();
                }

                drawingCanvas.setPointerCapture(
                    event.pointerId
                );

                editorState.panSession = {
                    x: event.clientX,
                    y: event.clientY,

                    /*
                     * Remembered so the release can tell a middle-drag pan
                     * from a Pan-tool pan: a middle click must not leave the
                     * Pan tool armed afterwards.
                     */
                    middle
                };

                setToolMessage(
                    "Pan view"
                );
            }
        );

        drawingCanvas.addEventListener(
            "pointermove",
            event => {
                if (!editorState.panSession) {
                    return;
                }

                const deltaX =
                    event.clientX -
                    editorState.panSession.x;

                const deltaY =
                    event.clientY -
                    editorState.panSession.y;

                const scale =
                    enggDrawingState.BASE_PIXELS_PER_UNIT *
                    drawingState.camera.zoom;

                enggDrawingState.panCamera(
                    drawingState,

                    drawingState.camera.panX -
                        deltaX /
                        scale,

                    drawingState.camera.panY +
                        deltaY /
                        scale
                );

                editorState.panSession = {
                    x:
                        event.clientX,

                    y:
                        event.clientY
                };

                renderCurrentDrawing();
            }
        );

        drawingCanvas.addEventListener(
            "pointerup",
            event => {
                /*
                 * This handler only manages panning. It must
                 * not overwrite the status message when no pan
                 * was in progress, otherwise a completed drag
                 * or Modify step would be replaced by a stale
                 * instruction.
                 */
                if (!editorState.panSession) {
                    return;
                }

                if (
                    drawingCanvas.hasPointerCapture(
                        event.pointerId
                    )
                ) {
                    drawingCanvas.releasePointerCapture(
                        event.pointerId
                    );
                }

                editorState.panSession = null;

                setToolMessage(
                    drawingState.activeTool ===
                        "coordinate-system-2d"
                        ? "Specify origin"

                        : drawingState.activeTool ===
                            "line"
                            ? "Specify line start point"

                        : "Ready"
                );
            }
        );

        drawingCanvas.addEventListener(
            "mouseleave",
            () => {
                drawingCoordinates.textContent =
                    "X: 0.0 Y: 0.0 mm";

                enggDrawingState.setInteraction(
                    drawingState,
                    {
                        snapCandidate:
                            null,

                        inference:
                            null,

                        /*
                         * AND THE POINTER'S OWN POSITION, so the crosshair the
                         * overlay draws from it is not left behind at the edge
                         * the pointer went out through.
                         */
                        rawPointerPoint: null
                    }
                );

                syncSelectionInteraction();

                renderCurrentDrawing();
            }
        );
    }

    globalThis.document.addEventListener(
        "pointerdown",
        event => {
            if (
                !editorState.coordinateSystemMenu
            ) {
                return;
            }

            const clickedMenu =
                editorState.coordinateSystemMenu.contains(
                    event.target
                );

            const clickedAnchor =
                editorState.coordinateSystemMenuAnchor?.contains(
                    event.target
                );

            if (
                !clickedMenu &&
                !clickedAnchor
            ) {
                closeCoordinateSystemMenu();
            }
        }
    );

    window.addEventListener(
        "resize",
        closeCoordinateSystemMenu
    );

    /*
     * Clicking anywhere outside the drawing canvas cancels
     * the active tool.
     *
     * The click still reaches its own target, so the user
     * can click another toolbar button and have that tool
     * activate normally; this only guarantees the previous
     * tool does not stay running behind it.
     */
    globalThis.document.addEventListener(
        "pointerdown",
        event => {
            /*
             * Nothing to do when no tool is running.
             */
            if (
                !editorState.modifySession &&
                !editorState.activeGlobalTool &&
                !isConstructionTool(
                    drawingState.activeTool
                )
            ) {
                return;
            }

            const target =
                event.target;

            /*
             * Clicks on the canvas are the tool's own input,
             * so they are left alone.
             */
            if (
                drawingCanvas.contains(
                    target
                )
            ) {
                return;
            }

            /*
             * Clicks on a toolbar or panel button are handled
             * by that button, which activates its own tool and
             * cancels this one.
             */
            if (
                target.closest &&
                target.closest("button")
            ) {
                return;
            }

            /*
             * Clicks inside the Features panel or a popup are
             * part of the operation, not a cancellation.
             *
             * THE PANEL IS MATCHED BY ITS CONTAINER, not by the element the
             * old property page lived in: that element no longer exists, and
             * `drawingProperties.contains(target)` would have thrown on every
             * outside click. The inspector as a whole is the thing to test -
             * clicking Objects, Features or Source is never a reason to cancel
             * the tool the student is holding.
             */
            if (
                target.closest?.(
                    ".drawing-inspector, .drawing-polygon-prompt"
                )
            ) {
                return;
            }

            cancelInteraction();
        }
    );

    window.addEventListener(
        "scroll",
        closeCoordinateSystemMenu,
        true
    );
}
