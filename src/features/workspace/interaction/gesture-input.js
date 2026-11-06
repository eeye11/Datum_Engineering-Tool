/*
 * ============================================================
 * THE SHARED POINTER / GESTURE RECOGNISER
 * ============================================================
 *
 * ONE place that answers "what is the user doing with their device?" for the
 * drawing canvas, so a mouse, a finger and a stylus all feed the SAME
 * interaction contracts:
 *
 *     pointerdown  ->  record the pointer, classify it later
 *     pointermove  ->  tap / drag / long-press, or a navigation gesture
 *     pointerup    ->  finish, and tell the caller whether it was a tap
 *     pointercancel / lostpointercapture / blur
 *                  ->  cancel cleanly, never leave a session armed
 *
 * WHAT THIS MODULE IS NOT.
 *
 * It does not draw, select or move anything. It only recognises the gesture
 * and reports it; the canvas wiring (canvas-events.js) decides which part of
 * the application receives it, and every geometry rule stays where it already
 * lives. That is what keeps the input layer free of per-tool code: a new tool
 * needs nothing here at all.
 *
 * THE THREE GESTURES IT RECOGNISES ON ONE POINTER:
 *
 *   TAP          press and release without travelling past TAP_SLOP_PX. The
 *                browser's own click follows it, so a tap selects, places or
 *                acts exactly as a mouse click does - no separate touch code.
 *
 *   DRAG         the pointer travelled past TAP_SLOP_PX. Reported once, on the
 *                first movement past the threshold, so the active tool's own
 *                drag session can begin with the PRESS point (see
 *                creation-drag.js) and never with a point re-read later.
 *
 *   LONG PRESS   a stationary touch/pen held for LONG_PRESS_MS. Reported once,
 *                and cancelled the moment the pointer moves past its own
 *                (slightly larger) threshold - so a slow drag never opens a
 *                menu. It is an ADDITION to the visible controls, never the
 *                only way to reach an action.
 *
 * AND ON TWO OR MORE POINTERS:
 *
 *   PAN          both pointers travelling together move the viewport.
 *   PINCH        both pointers changing their distance zooms about their
 *                midpoint, so the region under the fingers stays put.
 *
 * A second pointer joining one that was already interacting is the transition
 * rule of section 4.6: the one-pointer operation is cancelled through the
 * caller's hook BEFORE navigation starts, so nothing is left half-drawn,
 * half-moved or half-committed.
 *
 * NO BROWSER-SPECIFIC HACKS. Everything here is Pointer Events, which the
 * browser delivers for a mouse, a touch and a pen alike. `touch-action` on the
 * canvas (a stylesheet concern, not this module's) is what stops the browser
 * from claiming the gesture for scrolling.
 */

/* How far a pointer may travel, in CSS pixels, and still be a TAP. */
export const TAP_SLOP_PX = 6;

/*
 * How far a pointer may travel before an armed LONG PRESS is abandoned.
 * Deliberately larger than the tap slop: a hand resting on a tablet shakes,
 * and a shake must not cancel the menu the student is holding for.
 */
export const LONG_PRESS_SLOP_PX = 10;

/* How long a stationary touch or pen must be held to count as a long press. */
export const LONG_PRESS_MS = 550;

/* The most pointers this recogniser tracks at once. */
const MAX_POINTERS = 4;

/* Which pointer types may long-press. A mouse has its right button instead. */
const LONG_PRESS_TYPES = new Set(["touch", "pen"]);

/* ============================================================
 * SMALL GEOMETRY HELPERS - pure, and exported so they can be tested
 * ============================================================ */

export function screenDistance(a, b) {
  if (!a || !b) {
    return Infinity;
  }

  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function midpointOf(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

/*
 * The zoom factor a two-pointer pinch asks for, from the distance the two
 * pointers have covered since the gesture began.
 *
 * A single guard stops the degenerate case: two fingers on the same spot have
 * no baseline distance, and dividing by it would send the zoom to infinity.
 */
export function pinchScale(initialDistance, currentDistance) {
  if (
    !Number.isFinite(initialDistance) ||
    !Number.isFinite(currentDistance) ||
    initialDistance < 1 ||
    currentDistance <= 0
  ) {
    return 1;
  }

  return currentDistance / initialDistance;
}

/* ============================================================
 * THE RECOGNISER
 * ============================================================
 *
 * `createGestureRecognizer(callbacks)` returns an object with:
 *
 *     press(event)          -> boolean, true when this pointer starts a gesture
 *     move(event)           -> void
 *     release(event)        -> void
 *     cancel(event)         -> void
 *     abandon()             -> void (drop everything, e.g. on blur/unmount)
 *     isTracking(pointerId) -> boolean
 *     activeCount()         -> number of tracked pointers
 *     reset()               -> void
 *
 * Callbacks (all optional, all called with plain facts, never with DOM reads):
 *
 *     onDragStart(event)              one pointer travelled past TAP_SLOP_PX
 *     onDragMove(event)               the same pointer kept moving
 *     onDragEnd(event)                the drag's pointer released
 *     onTap(event)                    released without travelling
 *     onLongPress(event, screen)      stationary hold completed
 *     onNavigationStart(a, b, event)  second pointer joined: cancel then navigate
 *     onNavigationMove(info, event)   pan/zoom frame
 *     onNavigationEnd()               navigation finished
 *     onInteractionCancelled(pointerIds)  the one-pointer gesture was rolled back
 */
export function createGestureRecognizer(callbacks = {}) {
  /*
   * The tracked pointers, by id: where each was pressed and where it is now.
   * A Map, so identity is the browser's pointer id and never an index that a
   * second finger could shift.
   */
  const pointers = new Map();

  /* The pointer currently owning a one-pointer interaction, or null. */
  let ownerId = null;

  /* "pressed" | "drag" - the state of the one-pointer interaction. */
  let phase = "idle";

  /* The long-press deadline for the current pointer. */
  let longPressTimer = null;

  /* The two-pointer navigation, while it is running. */
  let navigation = null;

  function clearLongPress() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function screenOf(event, fallback = null) {
    if (
      event &&
      Number.isFinite(event.clientX) &&
      Number.isFinite(event.clientY)
    ) {
      return { x: event.clientX, y: event.clientY };
    }

    return fallback;
  }

  function trackedCount() {
    return pointers.size;
  }

  /* The two pointers a navigation gesture is measured from. */
  function navigationPointers() {
    return [...pointers.values()].slice(0, 2);
  }

  function beginNavigation(event) {
    if (navigation) {
      return;
    }

    const pair = navigationPointers();

    if (pair.length < 2) {
      return;
    }

    const a = pair[0];
    const b = pair[1];

    navigation = {
      initialDistance: screenDistance(a.current, b.current),
      startMidpoint: midpointOf(a.current, b.current),
      lastMidpoint: midpointOf(a.current, b.current),
      /* The zoom the pinch began from, read once by the caller. */
      startZoom: null,
    };

    callbacks.onNavigationStart?.(a, b, event);
  }

  /*
   * One navigation frame: how far the midpoint travelled, and how far the two
   * pointers have spread. The caller applies it to the camera - this module
   * never touches the viewport itself, so a test can measure the numbers.
   */
  function moveNavigation(event) {
    const pair = navigationPointers();

    if (!navigation || pair.length < 2) {
      return;
    }

    const a = pair[0];
    const b = pair[1];

    const midpoint = midpointOf(a.current, b.current);

    const delta = {
      x: midpoint.x - navigation.lastMidpoint.x,
      y: midpoint.y - navigation.lastMidpoint.y,
    };

    const distance = screenDistance(a.current, b.current);

    navigation.lastMidpoint = midpoint;

    callbacks.onNavigationMove?.(
      {
        delta,
        midpoint,
        startMidpoint: navigation.startMidpoint,
        distance,
        initialDistance: navigation.initialDistance,
        scale: pinchScale(navigation.initialDistance, distance),
      },
      event,
    );
  }

  function endNavigation() {
    if (!navigation) {
      return;
    }

    navigation = null;

    callbacks.onNavigationEnd?.();
  }

  /*
   * Stop the one-pointer interaction WITHOUT committing it. The caller rolls
   * back whatever it had begun; this only forgets the gesture, so a release
   * that arrives later cannot resume it.
   */
  function cancelOwner() {
    clearLongPress();

    const id = ownerId;

    phase = "idle";
    ownerId = null;

    if (id !== null && id !== undefined) {
      callbacks.onInteractionCancelled?.([id]);
    }
  }

  return {
    press(event) {
      if (!event || !Number.isFinite(event.pointerId)) {
        return false;
      }

      /*
       * A POINTER THAT IS ALREADY TRACKED IS THE SAME GESTURE.
       *
       * Some browsers re-deliver a pointerdown for a pointer that is
       * already down (a synthetic re-send, a captured pointer's second
       * dispatch). Treating it as a new press would arm a second session
       * and could commit the object twice, so it is ignored outright.
       */
      if (pointers.has(event.pointerId)) {
        return false;
      }

      if (pointers.size >= MAX_POINTERS) {
        return false;
      }

      /*
       * A MOUSE IS NEVER PART OF A TWO-POINTER GESTURE.
       *
       * A digitising tablet reports the pen and the mouse position as
       * separate mouse pointers; counting them together would start a
       * pinch every time a stylus touched down beside a resting cursor.
       * Only touch and pen pointers are collected for navigation, and a
       * stray mouse press while touching simply does nothing else.
       */
      if (
        event.pointerType === "mouse" &&
        pointers.size > 0 &&
        [...pointers.values()].some((pointer) => pointer.type !== "mouse")
      ) {
        return false;
      }

      const point = screenOf(event);

      if (!point) {
        return false;
      }

      pointers.set(event.pointerId, {
        id: event.pointerId,
        type: event.pointerType || "mouse",
        start: point,
        current: point,
      });

      /*
       * THE SECOND POINTER TURNS A DRAWING GESTURE INTO NAVIGATION.
       *
       * The rule of section 4.6, and it is order matters here: the
       * one-pointer operation is cancelled FIRST, so the tool restores
       * its last committed state before the camera moves a pixel.
       */
      if (pointers.size >= 2) {
        if (ownerId !== null && ownerId !== undefined) {
          cancelOwner();
        }

        beginNavigation(event);

        return false;
      }

      ownerId = event.pointerId;
      phase = "pressed";

      /*
       * A LONG PRESS IS ONLY ARMED FOR A FINGER OR A PEN. A mouse has a
       * right button, and pressing one is not a request for a menu.
       */
      if (LONG_PRESS_TYPES.has(event.pointerType || "")) {
        clearLongPress();

        const pressed = { ...point };
        const pressedId = event.pointerId;

        longPressTimer = setTimeout(() => {
          longPressTimer = null;

          /*
           * A gesture that has already become a drag, or that has
           * been stopped, is not a long press any more.
           */
          if (ownerId !== pressedId || phase !== "pressed") {
            return;
          }

          phase = "hold";

          callbacks.onLongPress?.(event, pressed);
        }, LONG_PRESS_MS);
      }

      return true;
    },

    move(event) {
      if (!event || !Number.isFinite(event.pointerId)) {
        return;
      }

      const pointer = pointers.get(event.pointerId);

      if (!pointer) {
        return;
      }

      const point = screenOf(event, pointer.current);

      pointer.current = point;

      /* Two (or more) pointers: the movement belongs to navigation. */
      if (navigation) {
        moveNavigation(event);

        return;
      }

      if (event.pointerId !== ownerId) {
        return;
      }

      const travelled = screenDistance(pointer.start, point);

      if (phase === "pressed") {
        if (travelled < TAP_SLOP_PX) {
          return;
        }

        /*
         * A DRAG. The long press is abandoned: the student is drawing,
         * not asking for a menu.
         */
        clearLongPress();

        phase = "drag";

        callbacks.onDragStart?.(event);

        return;
      }

      if (phase === "hold" && travelled > LONG_PRESS_SLOP_PX) {
        /*
         * The finger was held and has now moved: the press it was
         * held for is not a long press any more, and the movement is
         * an ordinary drag from where it started.
         */
        phase = "drag";

        callbacks.onDragStart?.(event);

        return;
      }

      if (phase === "drag") {
        callbacks.onDragMove?.(event);
      }
    },

    release(event) {
      if (!event || !Number.isFinite(event.pointerId)) {
        return;
      }

      const pointer = pointers.get(event.pointerId);

      if (!pointer) {
        return;
      }

      if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
        pointer.current = { x: event.clientX, y: event.clientY };
      }

      pointers.delete(event.pointerId);

      /* A LIFTED NAVIGATION POINTER ENDS THE NAVIGATION, cleanly. */
      if (navigation) {
        endNavigation();

        return;
      }

      if (event.pointerId !== ownerId) {
        return;
      }

      const wasDrag = phase === "drag";
      const wasPressed = phase === "pressed";

      clearLongPress();

      phase = "idle";
      ownerId = null;

      if (wasDrag) {
        callbacks.onDragEnd?.(event);

        return;
      }

      if (wasPressed) {
        callbacks.onTap?.(event);
      }
    },

    cancel(event) {
      const id =
        event && Number.isFinite(event.pointerId) ? event.pointerId : null;

      if (id !== null) {
        pointers.delete(id);
      }

      if (navigation) {
        /*
         * A CANCELLED NAVIGATION DOES NOT RESUME THE DRAWING.
         *
         * The owner was already cancelled when the second pointer
         * arrived; this only ends the camera movement. The clean
         * `idle` state that follows is what stops the interrupted
         * operation from picking itself back up.
         */
        if (pointers.size < 2) {
          endNavigation();
        }

        return;
      }

      if (id !== null && id !== ownerId) {
        return;
      }

      cancelOwner();
    },

    /* Drop EVERYTHING - a window blur, an unmount, a lost capture. */
    abandon() {
      cancelOwner();
      endNavigation();
      pointers.clear();
    },

    isTracking(pointerId) {
      return pointers.has(pointerId);
    },

    activeCount() {
      return trackedCount();
    },

    /* What the one-pointer interaction is doing right now. */
    state() {
      if (navigation) {
        return "navigate";
      }

      return phase;
    },

    reset() {
      this.abandon();
    },
  };
}

export default createGestureRecognizer;
