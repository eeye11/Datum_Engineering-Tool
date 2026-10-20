/*
 * ============================================================
 * DRAGGING A DYNAMICS SYMBOL'S HANDLES
 * ============================================================
 *
 * The other half of `dynamicsHandles` in `interaction/handles.js`: that one
 * says WHERE a symbol's grips are, this one says WHAT a grip changes.
 *
 * ONE MODEL, ONE SET OF FIELDS. A grip writes into the same geometry the
 * renderer and the source writer read, so the picture and the code both
 * follow a drag immediately - and there is no second copy of the geometry to
 * fall out of step.
 *
 * A COMPOSITE STAYS WHOLE. A shared terminal moves BOTH branches of a
 * spring-damper; resizing a pulley keeps its rope tangent to the wheel it
 * hangs over; changing a spring's coil height does not detach its ends.
 *
 * The function returns true when it handled the drag, and false when it did
 * not - which the drag layer takes as "this handle is not mine".
 */

function finite(value, fallback = 0) {
    const number = Number(value);

    return Number.isFinite(number) ? number : fallback;
}

function valid(point) {
    return Boolean(
        point &&
            Number.isFinite(Number(point.x)) &&
            Number.isFinite(Number(point.y))
    );
}

function distance(a, b) {
    return Math.hypot(
        finite(b?.x) - finite(a?.x),
        finite(b?.y) - finite(a?.y)
    );
}

function angleBetween(centre, point) {
    return (
        (Math.atan2(
            finite(point?.y) - finite(centre?.y),
            finite(point?.x) - finite(centre?.x)
        ) *
            180) /
        Math.PI
    );
}

/* The normal of a span, which is the direction a coil height is measured in. */
function normalOf(start, end) {
    const dx = finite(end?.x) - finite(start?.x);
    const dy = finite(end?.y) - finite(start?.y);
    const length = Math.hypot(dx, dy) || 1;

    return { x: -dy / length, y: dx / length };
}

/* The signing of an angular sweep, in degrees, keeping its direction. */
function sweepFrom(start, angle) {
    let delta = angle - finite(start);

    while (delta <= -180) delta += 360;
    while (delta > 180) delta -= 360;

    return delta;
}

export function applyDynamicsHandle(object, drag, point, geometry) {
    if (!object || !drag || !valid(point) || !geometry) {
        return false;
    }

    const kind = String(drag.kind || "");

    /* ---- the shared anchors ---------------------------------- */

    if (kind === "start" || kind === "end") {
        if (!valid(geometry.start) || !valid(geometry.end)) {
            return false;
        }

        geometry[kind] = { x: point.x, y: point.y };

        return true;
    }

    if (kind === "center") {
        if (!valid(geometry.center)) {
            return false;
        }

        geometry.center = { x: point.x, y: point.y };

        return true;
    }

    /* ---- the symbol's own parameters -------------------------- */

    if (kind === "dynamics-radius") {
        if (valid(geometry.center)) {
            geometry.radius = Math.max(
                1,
                distance(geometry.center, point)
            );

            return true;
        }

        if (valid(geometry.position)) {
            /*
             * A particle has no `radius` field: its marker size is what the
             * radius grip changes, and the renderer and the writer both read
             * that one value.
             */
            geometry.markerRadius = Math.max(
                0.6,
                distance(geometry.position, point) * 2
            );

            return true;
        }

        return false;
    }

    if (kind === "dynamics-amplitude") {
        if (!valid(geometry.start) || !valid(geometry.end)) {
            return false;
        }

        const middle = {
            x: (geometry.start.x + geometry.end.x) / 2,
            y: (geometry.start.y + geometry.end.y) / 2
        };

        const normal = normalOf(geometry.start, geometry.end);
        const offset =
            (finite(point.x) - middle.x) * normal.x +
            (finite(point.y) - middle.y) * normal.y;

        geometry.amplitude = Math.max(0.5, Math.abs(offset));

        return true;
    }

    if (kind === "dynamics-curve") {
        /*
         * THE CURVE GRIP SETS HOW DEEP THE PATH BOWS, as a fraction of its own
         * length. A fraction rather than a distance is what keeps the path the
         * same shape at every size: stretch the span and the bow stretches
         * with it, exactly as the renderer's own control point does.
         */
        if (!valid(geometry.start) || !valid(geometry.end)) {
            return false;
        }

        const span = distance(geometry.start, geometry.end) || 1;

        const middle = {
            x: (geometry.start.x + geometry.end.x) / 2,
            y: (geometry.start.y + geometry.end.y) / 2
        };

        const normal = normalOf(geometry.start, geometry.end);

        const offset =
            (finite(point.x) - middle.x) * normal.x +
            (finite(point.y) - middle.y) * normal.y;

        /* The same clamp the panel offers, so dragging and typing agree. */
        geometry.bow = Math.max(-0.5, Math.min(0.5, offset / span));

        return true;
    }

    if (kind === "dynamics-body-width") {
        if (!valid(geometry.start) || !valid(geometry.end)) {
            return false;
        }

        const middle = {
            x: (geometry.start.x + geometry.end.x) / 2,
            y: (geometry.start.y + geometry.end.y) / 2
        };

        const normal = normalOf(geometry.start, geometry.end);
        const offset = Math.abs(
            (finite(point.x) - middle.x) * normal.x +
                (finite(point.y) - middle.y) * normal.y
        );

        geometry.bodyWidth = Math.max(1, offset * 2);

        return true;
    }

    if (kind === "dynamics-rope") {
        if (!valid(geometry.center)) {
            return false;
        }

        /*
         * The rope grip swings the hanging cord. The angle is measured from
         * straight down, which is the zero the renderer and the writer share.
         */
        const degrees = angleBetween(geometry.center, point);

        geometry.ropeAngle = degrees + 90;

        return true;
    }

    if (kind === "dynamics-start-angle") {
        if (!valid(geometry.center)) {
            return false;
        }

        /*
         * THE START-ANGLE GRIP MOVES WHERE THE ARC BEGINS and leaves how far
         * it sweeps exactly as it was - the sweep has its own grip. Changing
         * two things from one drag would make the symbol unpredictable.
         */
        geometry.startAngle = angleBetween(geometry.center, point);

        return true;
    }

    if (kind === "dynamics-end-angle") {
        if (!valid(geometry.center)) {
            return false;
        }

        /*
         * The END-ANGLE grip sets the SWEEP: the angle between the start and
         * the cursor, in the arc's own direction, clamped to a visible arc.
         */
        const angle = angleBetween(geometry.center, point);
        const delta = Math.abs(sweepFrom(finite(geometry.startAngle), angle));

        geometry.sweep = Math.max(5, Math.min(360, delta));

        return true;
    }

    if (kind === "dynamics-rope-wrap") {
        if (!valid(geometry.center)) {
            return false;
        }

        geometry.ropeGap = Math.max(
            Number(geometry.radius) * 2,
            distance(geometry.center, point) * 2
        );

        return true;
    }

    return false;
}

export default applyDynamicsHandle;
