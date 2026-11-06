/*
 * ============================================================
 * INPUT-AWARE PRECISION
 * ============================================================
 *
 * Touch, stylus and mouse do not aim equally well, so the canvas's hit
 * tolerances cannot be one number.
 *
 *     FINGER     the least precise. A fingertip covers roughly a 40-48 CSS
 *                pixel disc, and the student cannot see the contact point, so
 *                small engineering marks need a forgiving invisible target.
 *     STYLUS     considerably more precise than a finger, but not a mouse: a
 *                pen tip covers a few pixels and often rests at an angle.
 *     MOUSE      the established precision. A one-pixel line is still picked
 *                exactly as it always was.
 *
 * THE TOLERANCE IS A HIT AREA, NOT THE GEOMETRY. Nothing here reaches the
 * document: no line becomes thicker, no pipe wider, no coordinate moves. The
 * numbers are consulted by the pick tests only, which is what lets a thin line
 * stay a thin line and still be grabbable with a finger.
 *
 * THE UNIT IS SCREEN PIXELS, because "can I hit it" is a question about the
 * screen. A world-space tolerance would change with zoom - a hit target that
 * grows as you zoom in is the opposite of what a student needs. The canvas zoom
 * is folded in at the door, so an object drawn at 400% is not four times easier
 * to hit than the same object at 100%.
 *
 * WHAT THIS MODULE CANNOT KNOW. A browser reports the pointer TYPE but not how
 * big a given finger is, and a palm contact arrives as an ordinary touch. So
 * these are defaults, centrally adjustable, and the only promise is that touch
 * is more forgiving than mouse and stylus sits between them.
 */

/* The pointer type the last canvas gesture used, for tolerance decisions. */
export const POINTER_KINDS = Object.freeze({
    MOUSE: "mouse",
    TOUCH: "touch",
    PEN: "pen"
});

/*
 * The pick tolerance for each input kind, in CSS pixels, at 100% canvas zoom.
 *
 * Read as "how far from the ink may the pointer be and still mean the ink?".
 */
export const HIT_PIXELS = Object.freeze({
    mouse: 4,
    pen: 6,
    touch: 14
});

/*
 * The tolerance for a small, deliberately-targeted control - a handle, an
 * endpoint, a connection location. Bigger than the body tolerance for every
 * kind, because these are things the student aims AT rather than through.
 */
export const HANDLE_PIXELS = Object.freeze({
    mouse: 9,
    pen: 11,
    touch: 20
});

/*
 * The minimum physical size, in CSS pixels, that a touch target should offer.
 * Used when a caller wants to widen a tiny mark (a point, a flow arrow's head,
 * an annotation's leader) to a size a fingertip can find.
 */
export const TOUCH_TARGET_PX = 40;

/* The kind of input currently driving the canvas. */
let currentKind = POINTER_KINDS.MOUSE;

/* Whether a pen is in contact (or hovering), for palm rejection. */
let penActive = false;

/*
 * A PLATFORM THAT ONLY HAS A FINGER GETS THE FINGER'S PRECISION.
 *
 * A tablet with no trackpad reports no fine pointer capability, and its taps
 * arrive as `touch`. The kind is still decided per GESTURE below; this is only
 * the starting point for a canvas that has not been touched yet.
 */
export function preferredPointerKind() {
    try {
        if (globalThis.matchMedia?.("(pointer: coarse)")?.matches) {
            return POINTER_KINDS.TOUCH;
        }
    } catch {
        /* A test environment has no matchMedia; the default stands. */
    }

    return POINTER_KINDS.MOUSE;
}

/* The kind a pointer event reports, normalised to the three we know. */
export function pointerKindOf(event) {
    const reported = event && typeof event.pointerType === "string" ? event.pointerType : "";

    if (reported === POINTER_KINDS.TOUCH || reported === POINTER_KINDS.PEN) {
        return reported;
    }

    return POINTER_KINDS.MOUSE;
}

/*
 * RECORD WHAT IS DRIVING THE CANVAS.
 *
 * A pen suppresses a touch arriving while it is in range (see the palm policy
 * in gesture-input.js), so the KIND reported here is what the tolerances are
 * read from. A mouse moving while a pen rests on the screen does not take over:
 * the pen is the finer instrument, and a palm beside it is not a mouse either.
 */
export function setPointerKind(kind) {
    if (kind === POINTER_KINDS.TOUCH || kind === POINTER_KINDS.PEN || kind === POINTER_KINDS.MOUSE) {
        currentKind = kind;
    }

    return currentKind;
}

export function getPointerKind() {
    return currentKind;
}

export function setPenActive(active) {
    penActive = Boolean(active);

    return penActive;
}

export function isPenActive() {
    return penActive;
}

/*
 * THE BODY TOLERANCE, in DRAWING UNITS, for the current camera.
 *
 * Every caller of `objectAtPoint` used to compute `4 / zoom` itself. They now
 * ask here, so one number governs what "near enough to click" means and a
 * finger, a stylus and a mouse differ in exactly one place.
 */
export function bodyTolerance(view, zoom = 1) {
    const pixels = HIT_PIXELS[view || currentKind] ?? HIT_PIXELS.mouse;

    return pixels / Math.max(Number(zoom) || 1, 0.25);
}

/* The handle tolerance, in drawing units, for the current camera. */
export function handleTolerance(view, zoom = 1) {
    const pixels = HANDLE_PIXELS[view || currentKind] ?? HANDLE_PIXELS.mouse;

    return pixels / Math.max(Number(zoom) || 1, 0.25);
}

/*
 * THE SMALLEST HIT TARGET TEXT/POINT MARKS MAY OFFER, in drawing units.
 *
 * A point is drawn four pixels across. A mouse picks it as it is drawn; a
 * finger needs a target it can cover, so the pick radius becomes at least half
 * a touch target at finger scale.
 */
export function minimumTargetRadius(view, zoom = 1) {
    const pixels =
        (view || currentKind) === POINTER_KINDS.MOUSE
            ? 0
            : TOUCH_TARGET_PX / 2;

    return pixels / Math.max(Number(zoom) || 1, 0.25);
}

export default {
    POINTER_KINDS,
    HIT_PIXELS,
    HANDLE_PIXELS,
    TOUCH_TARGET_PX,
    preferredPointerKind,
    pointerKindOf,
    setPointerKind,
    getPointerKind,
    setPenActive,
    isPenActive,
    bodyTolerance,
    handleTolerance,
    minimumTargetRadius
};
