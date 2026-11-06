/*
 * ============================================================
 * THE FREEFORM POLYGON'S TWO WAYS OF BEING DRAWN
 * ============================================================
 *
 * The polygon has always been built one CLICK per vertex. That is still exactly
 * how it works, and this module does not change it:
 *
 *     click            place a vertex
 *     click again      the next vertex
 *     double-click     place ONE last vertex and close
 *     click near 1st   close
 *     Enter            close
 *     Backspace        take back the last vertex
 *     Escape           abandon
 *
 * WHAT IS NEW is a second way to make the SAME object: PRESS, TRACE, RELEASE.
 *
 *     pointerdown      the first vertex, at the press
 *     drag             the outline is traced and sampled along the pointer path
 *     pointerup        the final vertex is joined back to the first
 *
 * Both ways end in `commitFreeformPolygon`, which is the one function that
 * builds the feature, writes the source and records the undo entry - so the two
 * produce the identical object TYPE and the identical SOURCE representation.
 * There is no second polygon model.
 *
 * ============================================================
 * WHY THE TWO CAN CO-EXIST WITHOUT FIGHTING
 * ============================================================
 *
 * A press that never travels is a CLICK, and a click must place a vertex - not
 * start and immediately finish a traced shape. So the session is armed on the
 * press and only RECORDS POINTS once the pointer has travelled past the shared
 * drag threshold. A press released without travel records nothing at all and the
 * browser's own click places the vertex through the existing workflow. That is
 * the same deferral the Line tool uses (see creation-drag.js), and it is what
 * makes "click, click, click" and "press, trace, release" the same button.
 *
 * THE VERTEX PLACED BY THE PRESS IS THE FIRST VERTEX OF THE TRACE. When the
 * drag really begins, that point becomes points[0], so a traced shape starts
 * exactly where the student pressed rather than a few pixels later.
 *
 * ============================================================
 * SIMPLIFICATION
 * ============================================================
 *
 * A pointer emits a move for every frame, often several hundred for one stroke.
 * Committing every one would give a polygon hundreds of vertices - unreadable in
 * the Objects panel, enormous in the source, and impossible to edit. So a point
 * is recorded only when it is far enough from the last recorded vertex, and the
 * finished shape is simplified with Ramer-Douglas-Peucker, which removes the
 * points that lie on a straight run and keeps the corners.
 *
 * Neither step changes the SHAPE in any visually meaningful way: RDP's tolerance
 * is a distance in drawing units, given in SCREEN pixels at drawing time and
 * converted through the zoom, so a trace simplified at 400% is not coarser than
 * one simplified at 100%.
 */

import { drawingState, editorState } from "../editor-state.js";
import enggDrawingState from "../../../shared/model/drawing-state.js";
import { resolvePointerEvent } from "./pointer.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";
import { commitFreeformPolygon } from "../geometry/geometry-creation.js";

/* How far, in screen pixels, the pointer must travel before this is a DRAG. */
export const TRACE_START_PX = 4;

/* The closest two recorded vertices may be, in screen pixels. */
export const TRACE_SAMPLE_PX = 3;

/* The simplification tolerance, in screen pixels. */
export const TRACE_SIMPLIFY_PX = 2.5;

/* A polygon wider than this is capped: a trace is an outline, not a scan. */
export const TRACE_MAX_POINTS = 400;

/* The drag threshold shared with the rest of the drawing pipeline. */
const TOOL = "freeform-polygon";

/* ============================================================
 * PURE GEOMETRY - exported so the shape rules can be tested directly
 * ============================================================ */

function distance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
}

/*
 * The perpendicular distance from a point to the segment `a`-`b`. Used by both
 * the sampling step (is this point far enough from the last one?) and RDP.
 */
export function pointSegmentDistance(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;

    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared <= 1e-12) {
        return distance(point, a);
    }

    const t = Math.max(
        0,
        Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)
    );

    return distance(point, {
        x: a.x + t * dx,
        y: a.y + t * dy
    });
}

/*
 * RAMER-DOUGLAS-PEPPER, iterative rather than recursive so a very long trace
 * cannot overflow the stack.
 *
 * The first and last points are always kept: they are the shape's start and the
 * point it closes from.
 */
export function simplifyPolyline(points, tolerance) {
    const source = Array.isArray(points) ? points : [];

    if (source.length <= 2) {
        return source.map((point) => ({ x: point.x, y: point.y }));
    }

    const limit = Math.max(Number(tolerance) || 0, 0);

    if (limit <= 0) {
        return source.map((point) => ({ x: point.x, y: point.y }));
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
            const offset = pointSegmentDistance(source[index], source[first], source[last]);

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
            simplified.push({ x: source[index].x, y: source[index].y });
        }
    }

    return simplified;
}

/*
 * Drop a recorded point that sits on top of its predecessor. A pointer that
 * jitters in place must not produce a chain of zero-length edges.
 */
export function appendTracePoint(points, point, minimum) {
    const last = points[points.length - 1];

    if (last && distance(last, point) < minimum) {
        return false;
    }

    points.push({ x: point.x, y: point.y });

    return true;
}

/* ============================================================
 * THE SESSION
 * ============================================================ */

function screenPixelsToUnits(pixels) {
    const scale =
        enggDrawingState.BASE_PIXELS_PER_UNIT *
        Math.max(Number(drawingState.camera?.zoom) || 1, 0.25);

    return pixels / Math.max(scale, 1e-9);
}

/*
 * BEGIN A TRACE ON THE PRESS.
 *
 * Returns true when this press belongs to the polygon, so the caller leaves the
 * press alone and lets the release decide what it was. Nothing is written to the
 * interaction yet: a press that does not travel must leave the click workflow
 * completely untouched.
 */
export function beginFreeformTrace(event) {
    if (
        drawingState.activeTool !== TOOL ||
        !event ||
        event.button !== 0 ||
        editorState.freeformTrace
    ) {
        return false;
    }

    const resolution = resolvePointerEvent(event);

    const start =
        resolution.effectiveConstructionPoint ||
        resolution.rawPointerPoint;

    if (!start) {
        return false;
    }

    /*
     * A TRACE CONTINUES A POLYGON THAT IS ALREADY BEING CLICKED? No - the two
     * workflows are alternatives. If vertices have already been placed by
     * clicking, this press is the next CLICK vertex and belongs to the click
     * workflow, so the trace does not start.
     */
    const placed = drawingState.interaction?.points;

    editorState.freeformTrace = {
        pointerId: event.pointerId,
        startScreen: { x: event.clientX, y: event.clientY },
        start: { x: start.x, y: start.y },
        points: [],
        moving: false,
        preceding: Array.isArray(placed) && placed.length ? placed.map((point) => ({ ...point })) : [],
        committed: false
    };

    return true;
}

/*
 * RECORD THE TRACE WHILE THE POINTER MOVES.
 *
 * The session only becomes a TRACE once the pointer has travelled far enough -
 * before that it is just a press, and the release will be a click.
 */
export function moveFreeformTrace(event, point) {
    const session = editorState.freeformTrace;

    if (!session || !point) {
        return false;
    }

    if (!session.moving) {
        const travel = Math.hypot(
            event.clientX - session.startScreen.x,
            event.clientY - session.startScreen.y
        );

        if (travel < TRACE_START_PX) {
            return false;
        }

        session.moving = true;

        /*
         * THE PRESS IS THE FIRST VERTEX. Recorded now, from where the student
         * pressed, so the traced outline begins at the button-down point.
         */
        session.points = [{ ...session.start }];

        setToolMessage("Trace the polygon - release to close it");
    }

    const minimum = screenPixelsToUnits(TRACE_SAMPLE_PX);

    if (session.points.length >= TRACE_MAX_POINTS) {
        return true;
    }

    appendTracePoint(session.points, point, minimum);

    /*
     * THE PREVIEW IS THE ORDINARY POLYGON PREVIEW.
     *
     * The points go into the interaction, so the canvas draws them through the
     * same preview every clicked polygon uses - one preview implementation, not
     * a second one for tracing.
     */
    publishTrace(session, point);

    return true;
}

function publishTrace(session, currentPoint) {
    const points = session.points;

    enggDrawingState.setInteraction(drawingState, {
        points: points.map((point) => ({ ...point })),
        currentPoint: currentPoint ? { ...currentPoint } : null,
        startPoint: points[0] || null,
        snapGeometry: points.slice(1).map((end, index) => ({
            start: points[index],
            end
        }))
    });
}

/*
 * FINISH THE TRACE ON RELEASE.
 *
 * A press that never travelled is NOT a trace: the session is dropped and false
 * is returned, so the browser's click places the vertex through the click
 * workflow exactly as before. A real trace is simplified, committed through
 * `commitFreeformPolygon`, and the session cleared - once, and only once.
 */
export function finishFreeformTrace(event, point) {
    const session = editorState.freeformTrace;

    if (!session) {
        return false;
    }

    if (event && itemTravelsAgentless(event, session)) {
        /* A release far from the press is a drag even if no move arrived. */
        moveFreeformTrace(event, point);
    }

    if (!session.moving) {
        editorState.freeformTrace = null;

        return false;
    }

    editorState.freeformTrace = null;

    if (session.committed) {
        return true;
    }

    session.committed = true;

    /*
     * THE RELEASE POINT IS PART OF THE SHAPE, unless it is the first vertex by
     * accident - the shape closes back to the first vertex anyway.
     */

    const last = session.points[session.points.length - 1];

    if (point && last && distance(last, point) > screenPixelsToUnits(TRACE_SAMPLE_PX)) {
        session.points.push({ x: point.x, y: point.y });
    }

    const simplified = simplifyPolyline(
        session.points,
        screenPixelsToUnits(TRACE_SIMPLIFY_PX)
    );

    /*
     * THE TRACED SHAPE IS A POLYGON LIKE ANY OTHER. It goes through the one
     * commit function, so the type, the style, the source block and the undo
     * entry are identical to a clicked polygon's.
     */
    const interaction = {
        points: simplified,
        currentPoint: simplified[simplified.length - 1] || null,
        startPoint: simplified[0] || null
    };

    /*
     * A HALF-FINISHED CLICK POLYGON IS PUT BACK, NOT MERGED. The trace was an
     * alternative to clicking, so the vertices that were already placed are
     * restored to the interaction when the trace cannot be committed.
     */
    const object = commitFreeformPolygon(interaction);

    if (!object && session.preceding.length) {
        enggDrawingState.setInteraction(drawingState, {
            points: session.preceding,
            currentPoint: session.preceding[session.preceding.length - 1],
            startPoint: session.preceding[0]
        });

        renderCurrentDrawing();
    }

    return true;
}

/* Whether a release is far enough from the press to be a drag. */
function itemTravelsAgentless(event, session) {
    if (!event || !Number.isFinite(event.clientX)) {
        return false;
    }

    return (
        Math.hypot(
            event.clientX - session.startScreen.x,
            event.clientY - session.startScreen.y
        ) >= TRACE_START_PX
    );
}

/* Abandon a trace without committing anything. */
export function cancelFreeformTrace() {
    if (!editorState.freeformTrace) {
        return false;
    }

    editorState.freeformTrace = null;

    return true;
}

export default {
    TRACE_START_PX,
    TRACE_SAMPLE_PX,
    TRACE_SIMPLIFY_PX,
    TRACE_MAX_POINTS,
    pointSegmentDistance,
    simplifyPolyline,
    appendTracePoint,
    beginFreeformTrace,
    moveFreeformTrace,
    finishFreeformTrace,
    cancelFreeformTrace
};
