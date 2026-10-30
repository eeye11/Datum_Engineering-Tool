/*
 * ============================================================
 * ONE GESTURE, FROM EVERY KIND OF POINTER
 * ============================================================
 *
 * WHAT THIS MODULE IS, AND IS NOT.
 *
 * It is the ONE place that decides whether a press has become a drag, whether a
 * second finger has turned an edit into navigation, and where a pinch's focal
 * point is. It is pure: it holds no canvas, no DOM and no drawing state, takes
 * pointer positions in, and reports decisions out. The canvas wires those
 * decisions to the tool pipeline it already has (creation-drag, drag, selection,
 * viewport), so no tool learns a second, touch-shaped version of itself.
 *
 * WHY IT IS SEPARATE FROM canvas-events.js.
 *
 * The canvas listener is one long collation of tool rules, and a gesture rule
 * buried in it could not be tested without a page, a drawing and a tool. The
 * rules below are the part that is genuinely device logic - thresholds,
 * lifetimes, multi-pointer arbitration - and they are the part whose bugs (a tap
 * read as a drag, a pinch that moves geometry) are the expensive ones. So they
 * live where a test can drive them directly.
 *
 * THE THREE CONCERNS THE BRIEF ASKS TO KEEP APART.
 *
 *   recognition   the screens below - tap or drag, one pointer or two
 *   dispatch      `begin` returns what the surface should DO, not how to do it
 *   the tool      canvas-events.js applies that to the active tool, unchanged
 *
 * UNITS. Every number here is in CSS PIXELS, because thresholds are a property
 * of the finger and the screen, not of the drawing - a 10 px tolerance is the
 * same hand movement at every zoom. Engineering-space precision is untouched:
 * these rules decide WHEN an interaction starts, never where a coordinate is.
 */

/* ------------------------------------------------ tolerances */

/*
 * THE THRESHOLDS, ALL IN ONE PLACE.
 *
 * `dragSlopPx` is the movement a press may make and still be a tap. It is chosen
 * to absorb the wobble of a finger pressed flat on glass - which is several
 * pixels even when the user means to hold still - without being so large that a
 * deliberate short drag is swallowed. A stylus is steadier and a mouse steadier
 * still, so each gets a smaller allowance: a pen user adjusting by 2 px means it.
 *
 * `longPressMs` is the hold that opens a context action. It is long enough that
 * a press-and-release never reaches it, and `longPressSlopPx` cancels it the
 * moment the finger starts to travel, so a slow drag never fires a menu halfway
 * through being a drag.
 */
export const GESTURE_DEFAULTS = Object.freeze({
    /** A press that travels further than this is a drag, not a tap. */
    dragSlopPx: { touch: 10, pen: 4, mouse: 3, unknown: 10 },

    /** How long a still press may be held before it counts as a long press. */
    longPressMs: 500,

    /** Movement that cancels a pending long press. */
    longPressSlopPx: { touch: 10, pen: 6, mouse: 5, unknown: 10 },

    /*
     * TWO POINTERS ARE NAVIGATION, NOT AN EDIT.
     *
     * A pinch or a pan is recognised as soon as the second pointer lands - there
     * is no threshold - because the alternative is editing geometry with two
     * fingers while the user meant to zoom, and that is never what they meant.
     */
    navigationOnSecondPointer: true
});

/* The pointer types the DOM reports, plus the fallback. */
export function pointerKind(event) {
    const type = event && event.pointerType;

    return type === "touch" || type === "pen" || type === "mouse" ? type : "unknown";
}

/* A table lookup that cannot be undefined, whatever the kind. */
function tolerance(table, kind) {
    return Number.isFinite(table[kind]) ? table[kind] : table.unknown;
}

/*
 * ============================================================
 * ONE POINTER'S LIFETIME
 * ============================================================
 *
 * Press, travel, release. Every pointer gets one of these, so a two-finger
 * gesture is two of them and nothing has to be reconstructed from raw events.
 */
export function createGestureTracker(options = {}) {
    const config = { ...GESTURE_DEFAULTS, ...options };

    /*
     * The live pointers, by `pointerId`. A Map rather than an array because a
     * pointer is identified by its id and release order is not press order - a
     * second finger lifted first must not confuse the first one's record.
     */
    const active = new Map();

    /* The pointer that owns the interaction: the tool acts on this one only. */
    let primaryId = null;

    /* Set once the interaction has become navigation; it never becomes an edit. */
    let navigating = false;

    /* The last two-pointer measure, for pan deltas and the pinch ratio. */
    let lastPair = null;

    /*
     * THE PAIR IS MADE OF POINTERS THAT ARE DOWN - not of pointers the TOOL is
     * still allowed to act on. Navigation deactivates the first pointer precisely
     * so the tool stops acting on it, and it is still one of the two fingers.
     */
    function pairOf() {
        /*
         * INCIDENTAL CONTACTS ARE NOT PART OF THE PAIR. A resting hand beside a
         * pen must not become half of a pinch - that is the failure the brief
         * calls out, where an incidental touch cancels an active pen stroke.
         */
        const pointers = [...active.values()].filter(
            (pointer) => !pointer.incidental
        );

        if (pointers.length < 2) {
            return null;
        }

        const [a, b] = pointers;

        return {
            distance: Math.hypot(b.x - a.x, b.y - a.y),
            midX: (a.x + b.x) / 2,
            midY: (a.y + b.y) / 2
        };
    }

    const tracker = {
        get config() {
            return config;
        },

        /** Every live pointer, for a surface that has to release them all. */
        pointers() {
            return [...active.values()];
        },

        /** The pointer whose drag the tool is acting on, or null. */
        get primary() {
            return primaryId === null ? null : active.get(primaryId) || null;
        },

        /** Whether the current interaction is pan/pinch rather than an edit. */
        get navigating() {
            return navigating;
        },

        get count() {
            return [...active.values()].filter(
                (pointer) => pointer.active && !pointer.incidental
            ).length;
        },

        /** The surface's own marker for a contact it declined to use. */
        get primaryId() {
            return primaryId;
        },

        /**
         * A live pointer, by id - or undefined.
         *
         * Used by the surface to decide whether a contact it ignored was ever
         * one of the interaction's pointers at all.
         */
        pointer(id) {
            return active.get(id);
        },

        /*
         * The pointers this module is still tracking at all.
         *
         * DIFFERENT FROM `count`, and the difference is the whole of the
         * "a second finger took over" rule: after a second pointer lands the
         * first is no longer ACTIVE (the tool must not act on it), but it is
         * still DOWN, and navigation lasts until nothing is down. Counting only
         * active pointers made a pan end the instant it began.
         */
        get down() {
            return active.size;
        },

        /**
         * A pointer has gone down.
         *
         * Returns what the surface should do:
         *
         *   { kind: "navigate-begin" }   the second pointer: start pan/pinch
         *   { kind: "press", pointer }   the first pointer: the tool may act
         *   { kind: "ignored" }          a pointer that is not the interaction's
         *                                (a palm, or a third finger)
         *
         * TWO OPTIONS CHANGE THAT, AND THEY ARE THE SURFACE'S TO OFFER.
         *
         *   { incidental: true }   this contact has already been classed as a
         *                          resting hand by the palm policy (palm.js).
         *                          It is RECORDED - so it can be released - but
         *                          it never becomes the primary pointer and
         *                          never turns an edit into navigation.
         *
         *   { keepPrimary: true }  a pen is already down, and a finger joining
         *                          must not STEAL the pen's interaction. The
         *                          finger is tracked, the pen stays primary and
         *                          the pen's edit is untouched - which is what
         *                          a second resting contact looks like on a
         *                          tablet that reports it after the nib.
         */
        press(event, { incidental = false, keepPrimary = false } = {}) {
            const kind = pointerKind(event);
            const pointer = {
                id: event.pointerId,
                kind,
                x: event.clientX,
                y: event.clientY,
                startX: event.clientX,
                startY: event.clientY,
                downAt: now(),
                active: true,
                dragged: false,
                longPressed: false,
                incidental: incidental === true
            };

            active.set(pointer.id, pointer);

            /*
             * AN INCIDENTAL CONTACT STOPS HERE. It is in the map so the release
             * can find and drop it, and so the pair measure never counts it -
             * see `pairOf` - but it decides nothing: no primary, no navigation,
             * no movement, no long press.
             */
            if (incidental) {
                return { kind: "ignored", pointer, incidental: true };
            }

            /*
             * A PALM IS A POINTER TOO, and the only honest thing this module can
             * say about one is that it arrived. Whether it is a palm is the
             * palm policy's decision (see `palm.js`): this tracker keeps the
             * contact so the surface knows not to start an edit with it, and the
             * policy decides which contact it is.
             */
            if (navigating) {
                lastPair = pairOf();

                return { kind: "navigate-move", pointer };
            }

            if (primaryId === null) {
                primaryId = pointer.id;

                return { kind: "press", pointer };
            }

            /*
             * A FINGER BESIDE A PEN IS A HAND, NOT A SECOND FINGER. The pen
             * keeps the gesture; the contact is marked non-primary so it cannot
             * pan, pinch, or cancel the stroke.
             */
            if (keepPrimary) {
                pointer.active = false;

                return { kind: "held", pointer, primaryId };
            }

            /*
             * A SECOND POINTER IS NAVIGATION. The surface cancels whatever the
             * first pointer had begun - the tracker does not, because only the
             * surface can roll back a tool's uncommitted work - and from here the
             * interaction never returns to editing.
             */
            if (config.navigationOnSecondPointer) {
                navigating = true;
                lastPair = pairOf();

                const first = active.get(primaryId);

                if (first) {
                    first.active = false;
                }

                return { kind: "navigate-begin", pointer, primaryId, pair: lastPair };
            }

            return { kind: "ignored", pointer };
        },

        /**
         * A pointer has moved.
         *
         * Returns one of:
         *
         *   { kind: "navigate", panX, panY, zoomRatio, midX, midY }
         *   { kind: "drag-start", pointer }    the press became a drag
         *   { kind: "drag", pointer }          a drag continuing
         *   { kind: "move", pointer }          still a press: hover feedback only
         *   { kind: "ignored" }                not the interaction's pointer
         */
        move(event) {
            const pointer = active.get(event.pointerId);

            if (!pointer) {
                return { kind: "ignored" };
            }

            pointer.x = event.clientX;
            pointer.y = event.clientY;

            if (pointer.incidental) {
                return { kind: "ignored", pointer, incidental: true };
            }

            if (navigating) {
                const pair = pairOf();
                const previous = lastPair;
                lastPair = pair;

                if (!pair || !previous) {
                    return { kind: "navigate", panX: 0, panY: 0, zoomRatio: 1, midX: pair?.midX ?? 0, midY: pair?.midY ?? 0 };
                }

                /*
                 * THE GESTURE MIDPOINT IS WHERE THE DRAWING STAYS PUT, which is
                 * why the pan is derived from it rather than from one finger: two
                 * fingers moving together move the midpoint, and a pinch moves the
                 * distance while the midpoint barely moves. One formula, both
                 * gestures, and neither can be mistaken for the other.
                 */
                return {
                    kind: "navigate",
                    panX: pair.midX - previous.midX,
                    panY: pair.midY - previous.midY,
                    zoomRatio: previous.distance > 0 ? pair.distance / previous.distance : 1,
                    midX: pair.midX,
                    midY: pair.midY
                };
            }

            if (event.pointerId !== primaryId) {
                return { kind: "ignored" };
            }

            const travelled = Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY);

            if (!pointer.dragged) {
                if (travelled <= tolerance(config.dragSlopPx, pointer.kind)) {
                    return { kind: "move", pointer, travelled };
                }

                pointer.dragged = true;

                return { kind: "drag-start", pointer, travelled };
            }

            return { kind: "drag", pointer, travelled };
        },

        /**
         * A pointer has been released.
         *
         * Returns:
         *
         *   { kind: "navigate-end", cancelled }  navigation finished
         *   { kind: "tap", pointer }             a press released without travelling
         *   { kind: "drag-end", pointer }        a drag released: commit
         *   { kind: "cancelled", pointer }       a drag released after a cancel
         *   { kind: "ignored" }
         *
         * `cancelled` is true when the pointer was cancelled by the platform or
         * taken away from the interaction (a second finger, a lost capture), and
         * it must roll back rather than commit. That distinction is the whole
         * point of returning it here instead of letting the surface guess.
         */
        release(event, { cancelled = false } = {}) {
            const pointer = active.get(event.pointerId);

            if (!pointer) {
                return { kind: "ignored" };
            }

            pointer.active = false;

            /*
             * AN INCIDENTAL CONTACT LEAVES WITHOUT A WORD. It never began
             * anything, so there is nothing to end - and, crucially, nothing to
             * report as a tap that would pair into a double tap or open a
             * menu.
             */
            if (pointer.incidental) {
                active.delete(event.pointerId);

                return { kind: "ignored", pointer, incidental: true };
            }

            /*
             * KEPT, NOT DELETED, UNTIL THE GESTURE IS OVER.
             *
             * A lifted finger is still half of a pinch while the other is down:
             * dropping it from the map made `pairOf()` see one finger, so the last
             * movement of a two-finger gesture reported a 1:1 ratio and no pan.
             * `count` (active pointers) is what says a gesture has ended; the map
             * is cleared with everything else in `reset`.
             */

            if (navigating) {
                /*
                 * THIS POINTER IS UP - taken out of the map only now, so the last
                 * movement it made was still measured against both fingers.
                 */
                active.delete(event.pointerId);

                /*
                 * NAVIGATION ENDS WHEN ITS POINTERS DO. The remaining finger must
                 * not become an edit mid-gesture - lifting one of two fingers is
                 * how a pinch ends - so the interaction stays navigation until
                 * every pointer is up.
                 */
                if (this.down === 0) {
                    navigating = false;
                    primaryId = null;
                    lastPair = null;

                    return { kind: "navigate-end", cancelled };
                }

                /*
                 * A NEW BASELINE FOR WHAT IS STILL DOWN. Lifting one of three
                 * fingers leaves two, which is a pair - and measured from the
                 * PREVIOUS pair it would read as a jump. The measure starts again
                 * from the fingers that are actually still on the glass.
                 */
                lastPair = pairOf();

                return { kind: "navigate-end", cancelled, stillDown: this.down };
            }

            active.delete(event.pointerId);

            if (event.pointerId !== primaryId) {
                return { kind: "ignored" };
            }

            primaryId = null;

            if (cancelled) {
                return { kind: "cancelled", pointer, dragged: pointer.dragged };
            }

            if (pointer.dragged) {
                return { kind: "drag-end", pointer };
            }

            return { kind: "tap", pointer };
        },

        /**
         * Has this pointer been held still long enough to be a long press?
         *
         * The caller decides WHEN to ask (a surface polls on a timer, or asks on
         * each move); this answers with the rule. Movement beyond the slop
         * cancels it, which is why it is checked here rather than by a timer the
         * surface starts and forgets.
         */
        longPressDue(event) {
            const pointer = active.get(event.pointerId);

            if (!pointer || pointer.incidental || navigating || pointer.dragged || pointer.longPressed) {
                return false;
            }

            const travelled = Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY);

            if (travelled > tolerance(config.longPressSlopPx, pointer.kind)) {
                return false;
            }

            return now() - pointer.downAt >= config.longPressMs;
        },

        /** The press is now a long press; it will not also become a tap. */
        markLongPressed(event) {
            const pointer = active.get(event.pointerId);

            if (pointer) {
                pointer.longPressed = true;
            }
        },

        /*
         * EVERYTHING UP, NOW.
         *
         * Called when the surface loses the gesture entirely - the canvas is
         * hidden, the pointer was captured elsewhere, the page is being torn
         * down. It returns the pointers that were still live so the surface can
         * release them, and it leaves the tracker in its idle state so the next
         * gesture starts clean rather than inheriting this one's flags.
         */
        reset() {
            const live = [...active.values()];
            const wasNavigating = navigating;

            active.clear();
            primaryId = null;
            navigating = false;
            lastPair = null;

            return { pointers: live, navigating: wasNavigating };
        }
    };

    return tracker;
}

/* A clock the tests can replace, so a long press is not a real half-second. */
let clock = () => Date.now();

export function setGestureClock(fn) {
    clock = typeof fn === "function" ? fn : () => Date.now();
}

function now() {
    return clock();
}

export default {
    GESTURE_DEFAULTS,
    createGestureTracker,
    pointerKind,
    setGestureClock
};
