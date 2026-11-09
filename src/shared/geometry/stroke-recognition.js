/*
 * ============================================================
 * STROKE RECOGNITION
 * ============================================================
 *
 * A freehand stroke is a few hundred jittery points. This module turns one into
 * clean, editable geometry, and decides WHICH geometry it is:
 *
 *   simplifyStroke      Ramer-Douglas-Peucker - drop the points that lie on a
 *                       straight run, keep the corners
 *   smoothStroke        a small moving average - remove the tremor, keep the shape
 *   fitCubicBeziers     a chain of cubic Beziers through the kept points
 *   classifyStroke      straight or curved, from the stroke's own geometry
 *   recogniseStroke     the whole thing: raw points in, clean geometry out
 *
 * WHY IT LIVES HERE RATHER THAN IN A SECTION
 * ------------------------------------------
 * The Math section already had these primitives, and the Statics Sketch Editor
 * needs the same ones. Copying them would be a second recogniser free to
 * disagree with the first - the same stroke would be straightened by one and
 * curved by the other. So the primitives are here, in shared geometry, and both
 * sections read them.
 *
 * WHAT IS NOT HERE. There is no polynomial best fit, no coordinate graph and no
 * Function Curve behaviour. Those are Math's own operations on a reconstructed
 * curve, and they stay in Math. This module only answers "what shape is this
 * stroke, and what is its clean geometry".
 *
 * THE RESULT IS A SPLINE, NOT A FUNCTION. A hand-drawn curve is not necessarily
 * y = f(x), and claiming an equation for one would be a lie.
 */

/* How far, in drawing units, a point may sit off a run and still be dropped. */
export const STROKE_SIMPLIFY_UNITS = 2.5;

/* The moving-average radius, in points, used to remove tremor. */
export const STROKE_SMOOTH_RADIUS = 1;

/*
 * ========================================================
 * STRAIGHT OR CURVED
 * ========================================================
 *
 * THE MEASURE IS "HOW FAR DOES THE STROKE BOW AWAY FROM ITS OWN CHORD?".
 *
 * A straight line drawn by hand wobbles, but it wobbles AROUND the chord: the
 * points sit on both sides of it, and the largest offset is small compared with
 * the stroke's length. A curve bows to ONE side, and the offset grows with the
 * curvature.
 *
 * So the test is the largest perpendicular offset from the chord, as a fraction
 * of the chord's length. A hand-drawn straight line of any length stays well
 * under a few percent; a genuine arc is far above it. The threshold is a
 * fraction rather than a distance, which is what makes it independent of how
 * long the stroke is and of the zoom it was drawn at.
 *
 * A SECOND TEST CATCHES THE S-SHAPE. A stroke that leaves the chord, comes back
 * and leaves it the other way has a small maximum offset but is plainly not
 * straight. So the SIGNED offsets are checked too: if the stroke crosses its
 * chord more than once with a meaningful excursion on each side, it is curved.
 */
export const STRAIGHT_TOLERANCE_RATIO = 0.035;

/* The smallest excursion, as a fraction of the chord, that counts as a bow. */
export const STRAIGHT_MIN_EXCURSION_RATIO = 0.012;

/* A stroke shorter than this, in drawing units, is not classified at all. */
export const STROKE_MIN_LENGTH = 1e-6;

function distance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
}

function copyPoint(point) {
    return { x: point.x, y: point.y };
}

function finitePoint(point) {
    return Boolean(
        point &&
            Number.isFinite(point.x) &&
            Number.isFinite(point.y)
    );
}

function pointSegmentDistance(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared <= 1e-12) {
        return distance(point, a);
    }

    const t = Math.max(
        0,
        Math.min(
            1,
            ((point.x - a.x) * dx + (point.y - a.y) * dy) /
                lengthSquared
        )
    );

    return distance(point, {
        x: a.x + t * dx,
        y: a.y + t * dy
    });
}

/*
 * The signed perpendicular offset of a point from the chord a->b.
 *
 * Positive on one side, negative on the other, so the caller can tell a bow
 * from a wobble. Zero-length chords have no side, and answer 0.
 */
function signedChordOffset(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);

    if (length <= 1e-12) {
        return 0;
    }

    return ((point.x - a.x) * dy - (point.y - a.y) * dx) / length;
}

/* ============================================================
 * SIMPLIFY
 * ============================================================ */

export function simplifyStroke(points, tolerance) {
    const source = Array.isArray(points)
        ? points.filter(finitePoint)
        : [];

    if (source.length <= 2) {
        return source.map(copyPoint);
    }

    const limit = Math.max(Number(tolerance) || 0, 0);

    if (limit <= 0) {
        return source.map(copyPoint);
    }

    const keep = new Uint8Array(source.length);

    keep[0] = 1;
    keep[source.length - 1] = 1;

    const stack = [[0, source.length - 1]];

    while (stack.length) {
        const [first, last] = stack.pop();

        if (last <= first + 1) {
            continue;
        }

        let furthest = -1;
        let furthestDistance = 0;

        for (let index = first + 1; index < last; index += 1) {
            const offset = pointSegmentDistance(
                source[index],
                source[first],
                source[last]
            );

            if (offset > furthestDistance) {
                furthestDistance = offset;
                furthest = index;
            }
        }

        if (furthest > 0 && furthestDistance > limit) {
            keep[furthest] = 1;

            stack.push([first, furthest], [furthest, last]);
        }
    }

    const simplified = [];

    for (let index = 0; index < source.length; index += 1) {
        if (keep[index]) {
            simplified.push(copyPoint(source[index]));
        }
    }

    return simplified;
}

/* ============================================================
 * SMOOTH
 * ============================================================
 *
 * A moving average that KEEPS THE ENDS. The first and last points are the
 * stroke's own ends and are never moved - a curve that shrank away from where
 * the student started would be a different curve.
 */
export function smoothStroke(points, radius = STROKE_SMOOTH_RADIUS) {
    const source = Array.isArray(points)
        ? points.filter(finitePoint)
        : [];

    if (source.length < 3) {
        return source.map(copyPoint);
    }

    const reach = Math.max(0, Math.round(Number(radius) || 0));

    if (!reach) {
        return source.map(copyPoint);
    }

    return source.map((point, index) => {
        if (index === 0 || index === source.length - 1) {
            return copyPoint(point);
        }

        const from = Math.max(0, index - reach);
        const to = Math.min(source.length - 1, index + reach);

        let sumX = 0;
        let sumY = 0;
        let count = 0;

        for (let at = from; at <= to; at += 1) {
            sumX += source[at].x;
            sumY += source[at].y;
            count += 1;
        }

        return { x: sumX / count, y: sumY / count };
    });
}

/* ============================================================
 * FIT
 * ============================================================
 *
 * A chain of cubic Beziers through the kept points. The control points are
 * placed along the chord between neighbours, scaled by a third of the distance
 * - the standard Catmull-Rom-to-Bezier conversion. It passes THROUGH every kept
 * point, so the reconstructed curve follows the student's own geometry rather
 * than a fitted approximation of it.
 */
export function fitCubicBeziers(points) {
    const source = Array.isArray(points)
        ? points.filter(finitePoint)
        : [];

    if (source.length < 2) {
        return [];
    }

    const segments = [];

    for (let index = 0; index < source.length - 1; index += 1) {
        const p0 = source[index - 1] || source[index];
        const p1 = source[index];
        const p2 = source[index + 1];
        const p3 = source[index + 2] || p2;

        const c1 = {
            x: p1.x + (p2.x - p0.x) / 6,
            y: p1.y + (p2.y - p0.y) / 6
        };

        const c2 = {
            x: p2.x - (p3.x - p1.x) / 6,
            y: p2.y - (p3.y - p1.y) / 6
        };

        segments.push({
            from: copyPoint(p1),
            control1: c1,
            control2: c2,
            to: copyPoint(p2)
        });
    }

    return segments;
}

/* A cubic Bezier, sampled - the one place a segment becomes points. */
export function bezierPoint(segment, t) {
    const u = 1 - t;

    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;

    return {
        x:
            a * segment.from.x +
            b * segment.control1.x +
            c * segment.control2.x +
            d * segment.to.x,
        y:
            a * segment.from.y +
            b * segment.control1.y +
            c * segment.control2.y +
            d * segment.to.y
    };
}

/* The whole spline, sampled - for hit testing, bounds and the source. */
export function splinePoints(segments, perSegment = 8) {
    const list = Array.isArray(segments) ? segments : [];

    if (!list.length) {
        return [];
    }

    const steps = Math.max(1, Math.round(Number(perSegment) || 8));
    const points = [copyPoint(list[0].from)];

    list.forEach(segment => {
        for (let index = 1; index <= steps; index += 1) {
            points.push(bezierPoint(segment, index / steps));
        }
    });

    return points;
}

/* ============================================================
 * CLASSIFY
 * ============================================================
 *
 * Straight or curved, from the stroke's own geometry. Returns the decision and
 * the numbers it was made from, so a test can hold the rule to its promise and
 * a caller can explain the choice.
 */
export function classifyStroke(points) {
    const source = Array.isArray(points)
        ? points.filter(finitePoint)
        : [];

    if (source.length < 2) {
        return {
            kind: "straight",
            ratio: 0,
            excursion: 0,
            crossings: 0,
            length: 0
        };
    }

    const first = source[0];
    const last = source[source.length - 1];
    const length = distance(first, last);

    /*
     * A stroke that ends where it began has no chord to measure against. It is
     * a loop, which is a curve - and a degenerate one is not worth drawing.
     */
    if (length <= STROKE_MIN_LENGTH) {
        return {
            kind: "curved",
            ratio: 1,
            excursion: 1,
            crossings: 0,
            length
        };
    }

    let maxOffset = 0;
    let maxSigned = 0;
    let crossings = 0;
    let previousSign = 0;

    source.forEach(point => {
        const offset = signedChordOffset(point, first, last);

        maxOffset = Math.max(maxOffset, Math.abs(offset));

        if (Math.abs(offset) > maxSigned) {
            maxSigned = Math.abs(offset);
        }

        const sign = Math.sign(offset);

        if (sign !== 0 && previousSign !== 0 && sign !== previousSign) {
            crossings += 1;
        }

        if (sign !== 0) {
            previousSign = sign;
        }
    });

    const ratio = maxOffset / length;

    /*
     * A BOW IS ONE-SIDED. The stroke leaves the chord on one side and stays
     * there. A wobble crosses back and forth, and its crossings are what the
     * second test looks at.
     */
    const bowed = ratio > STRAIGHT_TOLERANCE_RATIO;

    /*
     * AN S-SHAPE IS NOT STRAIGHT EITHER. It crosses its chord, and each side of
     * the crossing is a real excursion rather than tremor.
     */
    const sShaped =
        crossings >= 2 && ratio > STRAIGHT_MIN_EXCURSION_RATIO;

    return {
        kind: bowed || sShaped ? "curved" : "straight",
        ratio,
        excursion: maxSigned / length,
        crossings,
        length
    };
}

/* ============================================================
 * RECOGNISE
 * ============================================================
 *
 * The whole reconstruction, from a raw stroke to clean geometry.
 *
 * `tolerance` and `smoothing` are in DRAWING UNITS, converted by the caller
 * from screen pixels through the zoom - so a stroke traced at 400% is not
 * simplified more coarsely than one traced at 100%.
 *
 * A STRAIGHT STROKE BECOMES TWO POINTS. That is the whole point of the
 * classification: a hand-drawn line must not be committed as a polyline of
 * hundreds of slightly different points. Its ends are the stroke's own ends,
 * which is what preserves the intended start and finish.
 */
export function recogniseStroke(rawPoints, options = {}) {
    const tolerance = Number(options.tolerance) || 0;
    const smoothing =
        options.smoothing === undefined
            ? STROKE_SMOOTH_RADIUS
            : Number(options.smoothing) || 0;

    const source = Array.isArray(rawPoints)
        ? rawPoints.filter(finitePoint)
        : [];

    const original = source.map(copyPoint);

    if (source.length < 2) {
        return {
            kind: "straight",
            points: original,
            segments: [],
            original,
            classification: classifyStroke(source)
        };
    }

    const simplified = simplifyStroke(source, tolerance);
    const smoothed = smoothStroke(simplified, smoothing);

    /*
     * THE CLASSIFICATION IS MADE ON THE SMOOTHED STROKE, not the raw one. The
     * raw stroke's tremor is exactly what the test is meant to ignore, and
     * classifying before smoothing would call a shaky straight line curved.
     */
    const classification = classifyStroke(smoothed);

    if (classification.kind === "straight") {
        return {
            kind: "straight",
            points: [copyPoint(smoothed[0]), copyPoint(smoothed[smoothed.length - 1])],
            segments: [],
            original,
            classification
        };
    }

    return {
        kind: "curved",
        points: smoothed,
        segments: fitCubicBeziers(smoothed),
        original,
        classification
    };
}

/* ============================================================
 * SPLIT
 * ============================================================
 *
 * A stroke with a piece erased out of its middle is TWO strokes, not one
 * broken one. This is what the Erase tool uses: it removes the points under
 * the eraser and returns the runs that remain, each of which is then recognised
 * on its own.
 *
 * A run shorter than `minLength` is dropped rather than committed as a
 * degenerate feature - an eraser that leaves a two-pixel stub behind has left
 * broken geometry, which is the thing the brief forbids.
 */
export function splitStrokeAtGaps(points, minLength = 0) {
    const source = Array.isArray(points)
        ? points.filter(finitePoint)
        : [];

    const runs = [];
    let current = [];

    source.forEach(point => {
        if (point.erased) {
            if (current.length) {
                runs.push(current);
            }

            current = [];

            return;
        }

        current.push(copyPoint(point));
    });

    if (current.length) {
        runs.push(current);
    }

    return runs.filter(run => {
        if (run.length < 2) {
            return false;
        }

        if (!(minLength > 0)) {
            return true;
        }

        let length = 0;

        for (let index = 1; index < run.length; index += 1) {
            length += distance(run[index - 1], run[index]);
        }

        return length >= minLength;
    });
}

/* The total length of a polyline, in drawing units. */
export function strokeLength(points) {
    const source = Array.isArray(points)
        ? points.filter(finitePoint)
        : [];

    let length = 0;

    for (let index = 1; index < source.length; index += 1) {
        length += distance(source[index - 1], source[index]);
    }

    return length;
}

const enggStrokeRecognition = {
    STROKE_SIMPLIFY_UNITS,
    STROKE_SMOOTH_RADIUS,
    STRAIGHT_TOLERANCE_RATIO,
    STRAIGHT_MIN_EXCURSION_RATIO,
    STROKE_MIN_LENGTH,
    simplifyStroke,
    smoothStroke,
    fitCubicBeziers,
    bezierPoint,
    splinePoints,
    classifyStroke,
    recogniseStroke,
    splitStrokeAtGaps,
    strokeLength
};

export default enggStrokeRecognition;
