/*
 * ============================================================
 * GESTURE WIRING FOR THE DRAWING SURFACE
 * ============================================================
 *
 * The one place a pointer becomes a DAETUM interaction. Every kind of input -
 * mouse, finger, stylus - arrives here through Pointer Events, is recognised by
 * the shared recogniser (`gesture-input.js`), and is handed to the pipeline
 * that ALREADY does that job:
 *
 *     tap           ->  not intercepted at all; the browser's own click reaches
 *                       `handleCanvasClick`, exactly as a mouse click does
 *     drag          ->  the press/drag sessions the creation, manipulation and
 *                       selection layers already own
 *     two pointers  ->  the camera: pan and pinch, through viewport.js
 *     long press    ->  the existing feature context menu, on touch and pen only
 *
 * WHAT IS DELIBERATELY NOT HERE.
 *
 * No geometry, no object model, no per-tool code. This module does not decide
 * what a Line or a Pipe does - it only decides WHICH existing handler receives
 * the gesture, and makes sure a gesture is never delivered twice and never left
 * half-finished.
 *
 * POINTER CAPTURE.
 *
 * Once a pointer is committed to something (a drawing drag, a handle drag, a
 * marquee), the surface captures it, so movement and the release keep arriving
 * even when the pointer travels off the canvas - which is exactly what a finger
 * sliding past the edge of a tablet's drawing area does. Capture is released on
 * completion, cancellation and a lost capture, so nothing is left holding it.
 *
 * THE ORDER OF THE HANDLERS IS THE GESTURE PRIORITY (section 4):
 *
 *     0. explicit navigation   the Pan tool, or the middle mouse button
 *     1. geometry handle drag  (manipulationDrag, begun by the press)
 *     2. selected-object move  (manipulationDrag, body)
 *     3. selection             (click / marquee)
 *     4. selection marquee     (empty canvas, Select tool)
 *     5. drawing creation      (the active tool's own press session)
 *
 * The press handlers in canvas-events.js already enforce this order for one
 * pointer; this layer adds the multi-pointer, long-press and pen rules around
 * them without reordering anything.
 */

import { drawingCanvasArea, drawingCanvas } from "../dom.js";
import { drawingState, editorState } from "../editor-state.js";
import enggDrawingState from "../../../shared/model/drawing-state.js";
import {
  createGestureRecognizer,
  LONG_PRESS_MS,
  TAP_SLOP_PX,
} from "./gesture-input.js";
import {
  getPointerKind,
  pointerKindOf,
  setPenActive,
  setPointerKind,
} from "./pointer-precision.js";
import {
  panByScreenDelta,
  zoomAtScreenPoint,
} from "../../../components/layout/workspace/viewport.js";
import { cancelManipulationDrag } from "./handles.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { canvasPointFromEvent } from "../../../components/layout/toolbar/tool-activation.js";
import { objectAtPoint } from "./hit-testing.js";
import { openFeatureContextMenu } from "./context-menu.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";

/*
 * HOW FAR A FINGER MAY TRAVEL AND STILL BE A TAP, re-exported so the tests and
 * any future tool read the same number as the recogniser.
 */
export { LONG_PRESS_MS, TAP_SLOP_PX };

/* Whether a two-pointer gesture is currently moving the camera. */
export function isNavigating() {
  return Boolean(enggGesture?.state?.() === "navigate");
}

/*
 * The recogniser's live instance, so a keyboard handler or a test can ask what
 * the pointer is doing without re-deriving it.
 */
let enggGesture = null;

/*
 * ROLL BACK WHATEVER THE ONE-POINTER GESTURE HAD STARTED.
 *
 * Called when a second touch arrives (section 4.6) and when the gesture is
 * cancelled. Every branch restores the LAST COMMITTED state:
 *
 *   a manipulation drag  -> the geometry from before the drag, through the
 *                           existing cancel path (so the undo stack is not
 *                           touched by an uncommitted edit)
 *   a creation drag      -> the session is dropped; nothing was written yet,
 *                           so dropping it is the rollback
 *   a marquee            -> its box is cleared and the selection is left as it
 *                           was when the drag began
 *
 * A MULTI-STEP CONSTRUCTION THAT WAS ALREADY COMMITTED is NOT undone: its
 * earlier stages are real objects, and only the unfinished stage disappears.
 */
export function cancelActivePointerOperation() {
  let cancelled = false;

  if (editorState.manipulationDrag) {
    cancelManipulationDrag();
    renderCurrentDrawing();
    cancelled = true;
  }

  if (editorState.creationDrag) {
    editorState.creationDrag = null;
    editorState.creationDragConsumedClick = false;

    /*
     * A PREVIEW THE INTERRUPTED DRAG POSTED IS REMOVED, so no half-drawn
     * fitting is left on the sheet while the camera moves.
     */
    const interaction = drawingState.interaction;

    if (
      interaction &&
      ["idle"].includes(String(interaction.phase || "idle")) === false &&
      interaction.preview
    ) {
      enggDrawingState.setInteraction(drawingState, {
        preview: null,
        phase: "idle",
      });
    }

    renderCurrentDrawing();
    cancelled = true;
  }

  if (editorState.selectionDrag) {
    const drag = editorState.selectionDrag;

    if (
      drag.pointerId !== undefined &&
      drawingCanvas?.hasPointerCapture?.(drag.pointerId)
    ) {
      try {
        drawingCanvas.releasePointerCapture(drag.pointerId);
      } catch {}
    }

    /*
     * A DERIVED OR AXIS LABEL DRAG WROTE ONTO ITS SOURCE ON EVERY FRAME, so
     * it is rolled back to the geometry it started from rather than merely
     * abandoned.
     */
    if (drag.derived && drag.originalGeometry) {
      const source = drawingState.objects.find(
        (object) => object.id === drag.derived.sourceFeatureId,
      );

      if (source) {
        source.geometry = structuredClone(drag.originalGeometry);
      }
    }

    editorState.selectionDrag = null;
    drawingState.selection.boxSelectionIds = [];

    renderCurrentDrawing();
    cancelled = true;
  }

  return cancelled;
}

/* Whether a gesture that must not be interrupted by navigation is running. */
function hasActiveGesture() {
  return Boolean(
    editorState.creationDrag ||
    editorState.manipulationDrag ||
    editorState.selectionDrag ||
    editorState.panSession,
  );
}

/*
 * PAN AND PINCH.
 *
 * The camera is moved through viewport.js's own primitives, so the same clamp,
 * the same sheet-viewport write-back and the same redraw are used as every
 * other navigation. Nothing in the document is read or written.
 */
function applyNavigation(info) {
  if (!info) {
    return;
  }

  if (info.delta && (info.delta.x !== 0 || info.delta.y !== 0)) {
    panByScreenDelta(info.delta.x, info.delta.y);
  }

  if (Number.isFinite(info.scale) && Math.abs(info.scale - 1) > 0.001) {
    const nextZoom = drawingState.camera.zoom * info.scale;

    zoomAtScreenPoint(nextZoom, info.midpoint);
  }
}

/*
 * Open the feature context menu at a canvas point, by the same rules a right
 * click uses - including selecting the feature first when it is not selected.
 */
function openCanvasMenu(screenPoint) {
  if (!drawingCanvas || !screenPoint) {
    return false;
  }

  const object = objectAtPoint(
    canvasPointFromEvent(
      { clientX: screenPoint.x, clientY: screenPoint.y },
      false,
    ),
  );

  if (object && !drawingState.selection.selectedObjectIds.includes(object.id)) {
    enggDrawingState.selectObject(drawingState, object.id);
  }

  openFeatureContextMenu(
    screenPoint.x,
    screenPoint.y,
    drawingState.selection.selectedObjectIds.length > 0,
  );

  return true;
}

/*
 * ============================================================
 * PALM REJECTION
 * ============================================================
 *
 * While a pen is in contact (or reported hovering), a TOUCH that arrives during
 * it is treated as the palm and ignored - it starts no object, no selection and
 * no movement, and it cannot interrupt the pen's own gesture.
 *
 * The policy is deliberately narrow, because a browser cannot truly identify a
 * palm:
 *
 *   - it applies ONLY to touch pointers, never to the pen or the mouse;
 *   - it applies ONLY while a pen is genuinely active, not merely "a pen exists";
 *   - it is scoped to the canvas, so the panels, the menus and the Source
 *     editor keep their ordinary touch behaviour;
 *   - it ENDS with the pen, so a touch on the canvas works again immediately
 *     afterwards.
 *
 * When the pen lifts, a touch that is still down is not resurrected: the
 * recogniser was never given it, so it cannot finish anything.
 */
let palmTouchIds = new Set();

function penIsActive() {
  return Boolean(editorState.penInRange);
}

function ignorePalmTouch(event) {
  if (!event || event.pointerType !== "touch" || !penIsActive()) {
    return false;
  }

  palmTouchIds.add(event.pointerId);

  return true;
}

/* ============================================================
 * INSTALLATION
 * ============================================================ */

export function installGestureInput() {
  const surface = drawingCanvasArea || drawingCanvas;

  if (!surface || enggGesture) {
    return enggGesture;
  }

  enggGesture = createGestureRecognizer({
    /*
     * A DRAG HAS BEGUN. The one-pointer press sessions - created by the
     * existing pointerdown handlers in canvas-events.js - are what actually
     * draw or move; this only guarantees the pointer is captured so the
     * gesture survives leaving the canvas.
     */
    onDragStart(event) {
      if (!drawingCanvas) {
        return;
      }

      try {
        drawingCanvas.setPointerCapture?.(event.pointerId);

        editorState.capturedPointerId = event.pointerId;
      } catch {}
    },

    onDragMove() {
      /*
       * The per-frame work belongs to the sessions (moveCreationDrag,
       * updateManipulationDrag, updateSelectionDrag) - they are already
       * wired to pointermove in canvas-events.js, and calling them again
       * here would apply one frame's movement twice.
       */
    },

    onDragEnd() {
      releaseCapture();
    },

    /*
     * A TAP NEEDS NO CODE. The browser delivers the click after the
     * pointerup, and the click router is the same for every input kind - so
     * a tap selects, places or acts exactly as a click does. Swallowing or
     * re-dispatching it here would create the duplicate behaviour the task
     * warns about.
     */
    onTap(event) {
      releaseCapture(event?.pointerId);
    },

    /*
     * A LONG PRESS OPENS THE CONTEXT MENU - but only when nothing is being
     * drawn or dragged, so a slow drawing gesture never turns into a menu,
     * and only on a canvas that is not in the middle of a construction.
     */
    onLongPress(screen) {
      if (
        hasActiveGesture() ||
        drawingState.interaction?.phase !== "idle" ||
        !drawingCanvas
      ) {
        return;
      }

      if (!openCanvasMenu(screen)) {
        return;
      }

      setToolMessage("Choose an action");
    },

    /*
     * THE SECOND POINTER: cancel, then navigate. The rollback runs FIRST so
     * the sheet is back to its last committed state before the camera moves.
     */
    onNavigationStart() {
      cancelActivePointerOperation();

      drawingCanvas?.classList.add("drawing-navigating");
    },

    onNavigationMove(info) {
      applyNavigation(info);
    },

    onNavigationEnd() {
      drawingCanvas?.classList.remove("drawing-navigating");

      setToolMessage("Ready");
    },

    onInteractionCancelled() {
      /*
       * A cancelled pointer puts the unfinished operation back - the
       * clean state the task asks for after an interrupted gesture.
       */
      cancelActivePointerOperation();
    },
  });

  /*
   * THE RECOGNISER IS FED ONLY POINTERS THAT REACH THE DRAWING SURFACE, and
   * only when the surface is not the middle of an interface control.
   */
  surface.addEventListener(
    "pointerdown",
    (event) => {
      if (ignorePalmTouch(event)) {
        event.preventDefault?.();
        return;
      }

      if (event.pointerType === "pen") {
        setPenActive(true);
        editorState.penInRange = true;
      }

      /*
       * THE PAN TOOL AND THE MIDDLE BUTTON ARE NAVIGATION BY DEFINITION.
       *
       * The one-pointer recogniser would also work here, but the Pan tool's
       * press is already handled by the existing pan session; letting the
       * recogniser own it too would produce two pans from one drag. The
       * recogniser is told nothing, and the existing handler draws the pan.
       */
      if (event.button === 1 || drawingState.activeTool === "pan") {
        return;
      }

      setPointerKind(pointerKindOf(event));

      enggGesture.press(event);
    },
    { passive: false },
  );

  surface.addEventListener(
    "pointermove",
    (event) => {
      if (palmTouchIds.has(event.pointerId)) {
        return;
      }

      if (event.pointerType === "pen") {
        editorState.penInRange = true;
        setPenActive(true);
      }

      /*
       * A HOVERING PEN IS NOT A MOVE, but it IS a preview: hover brings the
       * pick tolerance down to the pen's own precision before contact.
       */
      if (
        event.pointerType === "pen" &&
        !enggGesture.isTracking(event.pointerId)
      ) {
        setPointerKind("pen");
      }

      enggGesture.move(event);
    },
    { passive: false },
  );

  surface.addEventListener("pointerup", (event) => {
    if (palmTouchIds.has(event.pointerId)) {
      palmTouchIds.delete(event.pointerId);
      return;
    }

    if (event.pointerType === "pen") {
      setPenActive(false);
      editorState.penInRange = false;
    }

    enggGesture.release(event);
    releaseCapture(event.pointerId);
  });

  surface.addEventListener("pointercancel", (event) => {
    palmTouchIds.delete(event.pointerId);

    if (event.pointerType === "pen") {
      setPenActive(false);
      editorState.penInRange = false;
    }

    enggGesture.cancel(event);
    releaseCapture(event.pointerId);
  });

  surface.addEventListener("pointerleave", (event) => {
    if (event.pointerType !== "pen") {
      return;
    }

    /*
     * A PEN OUT OF RANGE IS NO LONGER A PALM-OCCLUDING PRESENCE. The touch
     * canvas becomes fully usable again the moment the stylus leaves.
     */
    if (!enggGesture.isTracking(event.pointerId)) {
      setPenActive(false);
      editorState.penInRange = false;
    }
  });

  /*
   * A LOST CAPTURE IS NOT A COMMIT. The gesture cannot continue, so the
   * unfinished operation is rolled back rather than left holding a pointer it
   * will never hear from again.
   */
  surface.addEventListener("lostpointercapture", (event) => {
    if (!enggGesture.isTracking(event.pointerId)) {
      return;
    }

    enggGesture.cancel(event);
  });

  /*
   * A WINDOW THAT LOSES FOCUS CANCELS EVERYTHING, so a stylus lifted outside
   * the browser or an app switched away from mid-gesture never leaves the tool
   * permanently armed.
   */
  globalThis.addEventListener?.("blur", () => {
    enggGesture?.abandon();
    palmTouchIds = new Set();
    setPenActive(false);
    editorState.penInRange = false;
    cancelActivePointerOperation();
  });

  /*
   * A TAB THAT IS NO LONGER VISIBLE HAS NO GESTURE IN FLIGHT. A tablet that
   * switches applications mid-stroke must not come back with a half-drawn
   * feature armed and waiting for a release that will never arrive.
   */
  const document = surface.ownerDocument || globalThis.document;

  document?.addEventListener?.("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
      enggGesture?.abandon();
      setPenActive(false);
      editorState.penInRange = false;
      cancelActivePointerOperation();
    }
  });

  return enggGesture;
}

function releaseCapture(pointerId) {
  if (!drawingCanvas) {
    return;
  }

  const id = Number.isFinite(pointerId)
    ? pointerId
    : editorState.capturedPointerId;

  if (!Number.isFinite(id)) {
    return;
  }

  try {
    if (drawingCanvas.hasPointerCapture?.(id)) {
      drawingCanvas.releasePointerCapture(id);
    }
  } catch {}

  if (editorState.capturedPointerId === id) {
    editorState.capturedPointerId = null;
  }
}

/* The recogniser itself, for tests and for keyboard handlers that ask. */
export function gestureRecognizer() {
  return enggGesture;
}

/* The kind of input currently driving the canvas, re-exported for callers. */
export { getPointerKind };
