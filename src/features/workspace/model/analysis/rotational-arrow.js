/* Engineering drawing rotational arrow geometry - the ONE curved arrow. */
/*
 * The ONE curved arrow: a centre, a radius, a direction of sweep, and
 * an arrowhead sitting on the curve.
 *
 * The geometry is derived once, here, and every rotational feature
 * reads it.
 * Nothing in this file draws: it answers questions about an arc, and
 * the renderer turns those answers into SVG. That split is what lets
 * the hit test in drawing.js measure the SAME curve the student can
 * see, instead of approximating it a second time and disagreeing.
 *
 * WHAT THIS IS NOT
 * ----------------
 * None of this is engineering arithmetic. The radius here is a
 * PRESENTATION property, in screen pixels, and it is deliberately
 * not the moment's magnitude: a 500 N-m moment and a 5 N-m moment
 * are drawn at the same size, because a drawing shows which way
 * something turns, not how hard. The magnitude lives on the
 * feature's own `magnitude` field and is never read here.
 */
/*
 * How much of the circle the arc sweeps.
 *
 * Nearly a full turn, with one opening left for the arrowhead to
 * occupy. The opening has to be wider than the head itself, or
 * the head overlaps the curve it terminates and the symbol reads
 * as a closed ring with a triangle stuck on it - the exact
 * failure this module exists to prevent.
 */
const SWEEP_RADIANS = (300 * Math.PI) / 180;

/*
 * The opening, as an angle either side of the sweep's end.
 *
 * Placed symmetrically so that reversing direction moves the gap
 * to the mirrored side of the circle. The centre, the radius and
 * the application point are untouched by that, which is what
 * makes Reverse a reversal rather than a move.
 */
const GAP_RADIANS = (30 * Math.PI) / 180;

/*
 * The visual radius of a moment, in screen pixels, before the
 * student changes it.
 *
 * Chosen to sit comfortably inside a member's own depth: big
 * enough that the curve and its head are unmistakably a
 * rotational symbol rather than a stray arc, small enough that
 * a moment on a short beam does not swallow the beam.
 *
 * IT WAS RAISED FROM 16 TO 20. A freshly placed moment read as a
 * little tight around its own centre point, and the centre dot
 * added below needs a little room inside the curve to read as the
 * application point rather than as a speck on the arc. The change
 * is deliberately modest - the symbol stays proportional to the
 * member it sits on - and it is a DEFAULT only: a moment that has
 * an `arcRadius` of its own keeps it exactly, so existing drawings
 * and user-set sizes are untouched.
 */
const DEFAULT_ARC_RADIUS_PX = 20;

/*
 * The bounds on a student-edited radius, in screen pixels.
 *
 * A floor exists because below a few pixels the head no longer
 * fits in the gap and the curve is indistinguishable from a
 * stray mark. A ceiling exists because past this the symbol
 * stops reading as belonging to the point at its centre.
 */
const MIN_ARC_RADIUS_PX = 8;
const MAX_ARC_RADIUS_PX = 80;

function clampArcRadius(value) {
    const radius = Number(value);

    if (!Number.isFinite(radius) || radius <= 0) {
        return DEFAULT_ARC_RADIUS_PX;
    }

    return Math.min(
        MAX_ARC_RADIUS_PX,
        Math.max(MIN_ARC_RADIUS_PX, radius)
    );
}

/*
 * The arc for a rotational feature, in SCREEN space.
 *
 * Angles are measured the SVG way - 0 to the right of the centre,
 * growing clockwise on screen because y grows downward - so the
 * caller passes a point already through its own toScreen mapping
 * and gets back a curve that matches what is drawn.
 *
 * Anticlockwise is the default because a new moment is
 * anticlockwise. For it the gap sits at the right of the circle
 * and the head travels upward, which is the shape a reader
 * already recognises as "this way round". Clockwise mirrors only
 * the sweep, never the centre.
 */
function arcFor(center, clockwise, radiusPx) {
    const radius = clampArcRadius(radiusPx);
    const half = GAP_RADIANS / 2;

    /*
     * THE END ANGLE, WHERE THE HEAD SITS.
     *
     * Angles here are SVG angles: 0 is to the right of the centre
     * and they grow as the point goes DOWN the screen, because y
     * grows downward. That is the opposite of the maths
     * convention, and the two are the reason this function needs
     * to be written down rather than worked out on the spot.
     *
     * Anticlockwise is the default because a new moment is
     * anticlockwise. Its opening sits just below the positive
     * x-axis, so the head leaves the gap travelling upward, which
     * is the shape a reader already recognises.
     */
    const endAngle = clockwise
        ? -Math.PI / 2 + half
        : Math.PI / 2 - half;

    /*
     * THE START, DERIVED FROM THE END ALONG THE DIRECTION OF
     * TRAVEL.
     *
     * On screen, anticlockwise means the SVG angle DECREASES and
     * clockwise means it INCREASES. So the start is the end moved
     * back along one of those, and which one is the whole
     * direction of the symbol.
     *
     * Deriving it this way rather than storing two independent
     * angles is what keeps the arc, the gap and the head agreeing:
     * the sweep is exactly the gap's complement by construction,
     * so the curve can never be drawn over the opening or fall
     * short of it.
     */
    const startAngle = clockwise
        ? endAngle - SWEEP_RADIANS
        : endAngle + SWEEP_RADIANS;

    return {
        center,
        radius,

        startAngle,
        endAngle,
        sweepFlag: clockwise ? 1 : 0,

        /*
         * The sweep is more than half a turn, so the arc command
         * MUST ask for the long one. SVG chooses between the two
         * arcs joining the same two points using the large-arc
         * flag, and with it unset it always takes the SHORT one -
         * which here is the 60 degree gap. The symbol then rendered
         * as a small stray arc with the head floating away from
         * it, the exact failure this geometry exists to prevent,
         * while the stored angles still described a 300 degree
         * sweep. Stating it here means no caller can get it wrong.
         */
        largeArcFlag: 1,

        /*
         * How far the ink was laid, kept alongside the angles so
         * the hit test never has to re-derive it and risk
         * measuring a different arc than the one drawn.
         */
        sweepExtent: SWEEP_RADIANS,

        /*
         * The unit TANGENT at the head end, in screen space.
         *
         * This is what makes the head part of the curve rather
         * than decoration near it: it is perpendicular to the
         * radius at that exact point, so the head lies along the
         * path instead of pointing at the centre, which would
         * read as a force and not a moment.
         */
        tangent: clockwise
            ? { x: -Math.sin(endAngle), y: Math.cos(endAngle) }
            : { x: Math.sin(endAngle), y: -Math.cos(endAngle) },

        /* Where the head's TIP touches the curve. */
        tip: {
            x: center.x + Math.cos(endAngle) * radius,
            y: center.y + Math.sin(endAngle) * radius
        },

        start: {
            x: center.x + Math.cos(startAngle) * radius,
            y: center.y + Math.sin(startAngle) * radius
        }
    };
}

/*
 * The SVG path for that arc, as an "M ... A ..." command.
 *
 * A single arc command rather than the two half-arcs this used
 * to be built from: two half arcs can only join with a visible
 * seam if they are exactly antipodal, and any gap angle that is
 * not a multiple of a half turn leaves the join showing. One
 * command through a sweep of 300 degrees is unambiguous and has
 * no seam anywhere on it.
 */
function arcPath(arc) {
    /*
     * SVG arc syntax is:
     *
     *     A rx ry x-axis-rotation large-arc-flag sweep-flag x y
     *
     * The ROTATION parameter is part of the command and is not
     * optional - it is the third number after the radius pair.
     *
     * It was omitted here, so the large-arc flag landed in the
     * rotation slot and the sweep flag landed in the large-arc slot.
     * The emitted command was therefore malformed, the browser
     * rejected the path, and an Applied Moment drew nothing at all:
     * the tool was armed and created its feature correctly, and it
     * was invisible.
     *
     * The curve is drawn in the canvas's own screen space with no
     * elliptical tilt, so the rotation is 0. Stating it explicitly
     * means the flags cannot be misread again.
     */
    return (
        `M ${arc.start.x} ${arc.start.y} ` +
        `A ${arc.radius} ${arc.radius} 0 ` +
        `${arc.largeArcFlag} ${arc.sweepFlag} ` +
        `${arc.tip.x} ${arc.tip.y}`
    );
}

/*
 * The arrowhead as three points, for an SVG polygon.
 *
 * Built from the tip and the TANGENT rather than from the centre,
 * so the head is tangent to the curve at the point it
 * terminates, and is scaled from the line thickness so a heavy
 * moment gets a heavy head. The head is filled with the stroke
 * colour: an outline head on a one-and-a-bit-pixel curve reads
 * as a smudge.
 */
function headPoints(arc, headSizePx) {
    const size = Math.max(
        4,
        Math.min(16, Number(headSizePx) || 7)
    );

    const angle = Math.atan2(arc.tangent.y, arc.tangent.x);
    const spread = 0.42;

    const back = size * 1.15;

    return [
        {
            x: arc.tip.x,
            y: arc.tip.y
        },
        {
            x:
                arc.tip.x -
                back * Math.cos(angle - spread),
            y:
                arc.tip.y -
                back * Math.sin(angle - spread)
        },
        {
            x:
                arc.tip.x -
                back * Math.cos(angle + spread),
            y:
                arc.tip.y -
                back * Math.sin(angle + spread)
        }
    ];
}

/*
 * Is a point close enough to this arc to count as a hit?
 *
 * The test is "near the curve OR near the head", because a
 * student aiming at the head is aiming at the feature, and
 * because the head is a filled triangle that is visually much
 * bigger than the arc is wide. A radius is measured perpendicular
 * to the curve rather than along the drawn line, so the answer
 * does not change as the student turns the symbol.
 *
 * `tolerancePx` is a pick radius in screen pixels, not a
 * distance in world units: it is a statement about how far the
 * pointer may be from what the student can SEE.
 */
function arcContainsPoint(arc, point, tolerancePx) {
    const tolerance = Math.max(
        1,
        Number(tolerancePx) || 0
    );

    const dx = point.x - arc.center.x;
    const dy = point.y - arc.center.y;

    const distanceFromCentre = Math.hypot(dx, dy);

    if (distanceFromCentre === 0) {
        return false;
    }

    /*
     * The opening must stay open. A click on the far side of the
     * circle, where no ink is, is not a click on the symbol - and
     * treating it as one would make a moment sitting on a beam
     * steal clicks aimed at the beam a radius away.
     */
    const angle = Math.atan2(dy, dx);

    if (!angleWithinSweep(arc, angle)) {
        /*
         * Outside the sweep the only ink left is the head, so
         * that is the only thing there to be hit. Testing the
         * CENTRE here instead would be wrong in a way the
         * student would feel: a moment drawn on a beam would
         * swallow every click on the beam within a few pixels of
         * its application point.
         */
        return Math.hypot(
            point.x - arc.tip.x,
            point.y - arc.tip.y
        ) <= tolerance;
    }

    return (
        Math.abs(distanceFromCentre - arc.radius) <=
        tolerance
    );
}

/*
 * Is this angle part of the drawn sweep?
 *
 * The sweep is measured anticlockwise-in-maths from the start
 * angle, which is the direction the ink was laid down. Wrapping
 * is handled by normalising both angles into a single turn, so
 * a gap that straddles the 0/2pi boundary does not leave a hole
 * in the hit area.
 */
function angleWithinSweep(arc, angle) {
    const turn = Math.PI * 2;

    /*
     * How far the angle sits from the START, measured in the
     * direction the ink was laid.
     *
     * `sweepFlag` is 1 for a clockwise sweep, which increases the
     * SVG angle, and 0 for anticlockwise, which decreases it, so
     * the subtraction is reversed for one of them. The reversal
     * has to be applied BEFORE normalising: normalising first
     * folds the value into a single turn, which discards the
     * sign, and the gap then measures as though it were the
     * sweep - which makes the empty side of the circle
     * clickable and lets a moment steal clicks aimed at the body
     * it is applied to.
     */
    const direction =
        arc.sweepFlag === 1 ? 1 : -1;

    const travelled =
        normalise(
            (angle - arc.startAngle) *
                direction,
            turn
        );

    return travelled <= arc.sweepExtent;
}

function normalise(value, turn) {
    return ((value % turn) + turn) % turn;
}

const enggDrawingRotationalArrow = {
    DEFAULT_ARC_RADIUS_PX,
    MIN_ARC_RADIUS_PX,
    MAX_ARC_RADIUS_PX,
    SWEEP_RADIANS,
    clampArcRadius,
    arcFor,
    arcPath,
    headPoints,
    arcContainsPoint
};

export default enggDrawingRotationalArrow;
