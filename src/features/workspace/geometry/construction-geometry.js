/*
 * Geometry used while constructing: rectangles, circumcircles, angles and arcs.
 */

import { normalizeAngle } from "../statics/truss-optimizer.js";

/*
 * THE POINT PRIMITIVES LIVE IN core/geometry/points.js.
 *
 * `distance` was defined here as well as in hit-testing, object-snap and the
 * sketch editor - four copies of one subtraction and a hypotenuse, each free
 * to drift from the others. It is re-exported from the shared module so every
 * existing importer of THIS file keeps working unchanged, while there is now
 * exactly one implementation.
 */
export { distance } from "../../../shared/geometry/points.js";
import { distance } from "../../../shared/geometry/points.js";

/*
 * ============================================================
 * A RECTANGLE FROM TWO OPPOSITE CORNERS, WITH AN OPTIONAL SQUARE
 * ============================================================
 *
 * `square` CONSTRAINS THE SECOND CORNER, it does not replace it. The corner the
 * student dragged to still decides WHICH WAY the square goes - the sign of each
 * offset is preserved - and only the shorter of the two extents is used for
 * both. Without that, a square dragged up-and-right would come out down-and-left
 * of the press, which is not the shape anybody drew.
 *
 * The right angles are preserved BY CONSTRUCTION rather than checked: the model
 * stores an axis-aligned position plus a width and a height, so a corner cannot
 * be moved without the other three following. That is why this function and not
 * the renderer is where the constraint lives.
 */
export function rectangleGeometry(
    first,
    second,
    { square = false } = {}
) {
    let opposite = {
        x: Number(second.x),
        y: Number(second.y)
    };

    if (square) {
        const deltaX = opposite.x - first.x;
        const deltaY = opposite.y - first.y;

        /*
         * THE SHORTER EXTENT IS USED FOR BOTH, measured as a magnitude and put
         * back on the side the drag chose. A zero-length drag therefore stays a
         * zero-length square rather than becoming a full-size one.
         */
        const extent = Math.min(Math.abs(deltaX), Math.abs(deltaY));

        opposite = {
            x: first.x + Math.sign(deltaX || 1) * extent,
            y: first.y + Math.sign(deltaY || 1) * extent
        };
    }

    const left =
        Math.min(
            first.x,
            opposite.x
        );

    const top =
        Math.max(
            first.y,
            opposite.y
        );

    return {
        position: {
            x: left,
            y: top
        },

        width:
            Math.abs(
                opposite.x -
                first.x
            ),

        height:
            Math.abs(
                opposite.y -
                first.y
            ),

        rotation: 0,

        /*
         * THE CORNER THE DRAG ENDED ON, AS THE STUDENT DREW IT. The model's
         * `position` is normalised to the top-left for rendering, so it cannot
         * say which corner was grabbed - and the square constraint and a future
         * corner handle both need to know.
         */
        opposite: {
            x: opposite.x,
            y: opposite.y
        }
    };
}

function circumcenter(
    first,
    second,
    third
) {
    const denominator =
        2 *
        (
            first.x *
                (
                    second.y -
                    third.y
                ) +

            second.x *
                (
                    third.y -
                    first.y
                ) +

            third.x *
                (
                    first.y -
                    second.y
                )
        );

    if (
        Math.abs(
            denominator
        ) < 1e-9
    ) {
        return null;
    }

    const firstSquare =
        first.x * first.x +
        first.y * first.y;

    const secondSquare =
        second.x * second.x +
        second.y * second.y;

    const thirdSquare =
        third.x * third.x +
        third.y * third.y;

    return {
        x:
            (
                firstSquare *
                    (
                        second.y -
                        third.y
                    ) +

                secondSquare *
                    (
                        third.y -
                        first.y
                    ) +

                thirdSquare *
                    (
                        first.y -
                        second.y
                    )
            ) /
            denominator,

        y:
            (
                firstSquare *
                    (
                        third.x -
                        second.x
                    ) +

                secondSquare *
                    (
                        first.x -
                        third.x
                    ) +

                thirdSquare *
                    (
                        second.x -
                        first.x
                    )
            ) /
            denominator
    };
}

/*
 * Signed sweep from one angle to another, taking
 * the short way round. The result is always in
 * (-PI, PI], so crossing the 0/360 boundary is a
 * small step instead of a full turn.
 */
function angleDifference(
    from,
    to
) {
    return normalizeAngle(
        to -
        from
    );
}

/*
 * Unwrap a cursor angle so it stays continuous as
 * the user moves around the centre.
 *
 * atan2 jumps from +PI to -PI when the cursor
 * crosses the 180 degree line. Comparing the new
 * sample with the previous one and adding the
 * smallest signed step keeps the running angle
 * increasing (or decreasing) smoothly:
 *
 *   179 -> 180 -> 181
 *
 * instead of folding 181 back to -179. The
 * returned angle is intentionally outside
 * (-PI, PI] once the user has travelled past a
 * half turn, which is exactly what preserves the
 * direction of travel.
 */
function unwrapAngle(
    angle,
    previousAngle
) {
    if (!Number.isFinite(previousAngle)) {
        return angle;
    }

    return (
        previousAngle +
        angleDifference(
            previousAngle,
            angle
        )
    );
}

/*
 * Build an arc from a centre, a radius start point
 * and an endpoint.
 *
 * The sweep is derived from the unwrapped cursor
 * angle, so it grows continuously through 180
 * degrees and never reverses. Small arcs stay
 * small, and large arcs are produced naturally
 * once the cursor has travelled more than half a
 * turn.
 */
function arcFromCentrePoints(
    center,
    start,
    end,
    cursorAngle
) {
    const radius =
        distance(
            center,
            start
        );

    if (
        radius <=
        1e-9
    ) {
        return null;
    }

    const startAngle =
        Math.atan2(
            start.y - center.y,
            start.x - center.x
        );

    /*
     * The caller supplies a continuous cursor angle.
     * When it is not available, fall back to the
     * endpoint so the arc is still well defined.
     */
    const continuousAngle =
        Number.isFinite(
            cursorAngle
        )
            ? cursorAngle
            : Math.atan2(
                end.y - center.y,
                end.x - center.x
            );

    /*
     * Sweep is the raw difference, so it is allowed
     * to exceed PI and keep its sign. That is what
     * makes the arc continue in one direction past
     * the half-way point instead of flipping.
     */
    const sweep =
        continuousAngle -
        startAngle;

    if (
        Math.abs(
            sweep
        ) <=
        1e-9
    ) {
        return null;
    }

    return {
        center: {
            ...center
        },

        radius,

        startAngle,

        endAngle:
            startAngle + sweep,

        sweep
    };
}

/*
 * Build the circumcircle arc through three points.
 * This is the geometry the 3-point arc mode uses,
 * so the arc passes through the clicked points
 * instead of creating unrelated geometry.
 */
export function arcThroughThreePoints(
    first,
    second,
    third
) {
    const center =
        circumcenter(
            first,
            second,
            third
        );

    if (!center) {
        return null;
    }

    const radius =
        distance(
            center,
            first
        );

    if (
        radius <=
        1e-9
    ) {
        return null;
    }

    const firstAngle =
        Math.atan2(
            first.y - center.y,
            first.x - center.x
        );

    const secondDelta =
        normalizeAngle(
            Math.atan2(
                second.y - center.y,
                second.x - center.x
            ) -
            firstAngle
        );

    const thirdDelta =
        normalizeAngle(
            Math.atan2(
                third.y - center.y,
                third.x - center.x
            ) -
            firstAngle
        );

    /*
     * The arc must pass through the middle point, so
     * the sweep runs in the direction that reaches it.
     */
    const clockwise =
        secondDelta <
        0;

    const endDelta =
        clockwise
            ? (
                thirdDelta >
                0
                    ? thirdDelta - 2 * Math.PI
                    : thirdDelta
            )
            : (
                thirdDelta <
                0
                    ? thirdDelta + 2 * Math.PI
                    : thirdDelta
            );

    if (
        Math.abs(
            endDelta
        ) <=
        1e-9
    ) {
        return null;
    }

    return {
        center: {
            ...center
        },

        radius,

        startAngle:
            firstAngle,

        endAngle:
            firstAngle +
            endDelta,

        sweep:
            endDelta
    };
}

/*
 * Single source of truth for the centrepoint arc.
 *
 * Both the live preview and the final creation call
 * this function with the same point, so the stored
 * geometry is always identical to what was on
 * screen at the moment of the click.
 *
 * The cursor angle is unwrapped against the last
 * sample so it keeps increasing past 180 degrees
 * instead of folding back and reversing the arc.
 * The unwrapped value is written back to the
 * interaction so the next sample continues from it.
 */
export function resolveCentrepointArc(
    interaction,
    point
) {
    if (
        !point ||
        interaction.points.length < 2
    ) {
        return null;
    }

    const center =
        interaction.points[0];

    const start =
        interaction.points[1];

    const cursorAngle =
        unwrapAngle(
            Math.atan2(
                point.y -
                    center.y,
                point.x -
                    center.x
            ),
            interaction.arcCursorAngle
        );

    interaction.arcCursorAngle =
        cursorAngle;

    return arcFromCentrePoints(
        center,
        start,
        point,
        cursorAngle
    );
}
