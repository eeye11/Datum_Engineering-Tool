/*
 * Geometric transforms: mirror, rotate, trim, extend, translate.
 */

import enggFeatureGeometry from "../../core/geometry/feature-geometry.js";
import enggDrawingState from "../../core/model/drawing-state.js";
import { renderCurrentDrawing } from "../workspace/canvas-render.js";
import { twoPointSpanOf } from "../annotate/dimension-inference.js";
import { drawingState } from "../editor-state.js";
import { renderProperties } from "../panels/feature-panel.js";
import { cancelModifySession } from "../commands/modify-tools.js";
import { setToolMessage } from "../toolbar/toolbar-render.js";
import { isConnectionType, isSupportType } from "../../core/model/feature-types.js";

/*
 * Reflect a point across the infinite line through two
 * points.
 */
function reflectPointAcrossLine(
    point,
    start,
    end
) {
    const dx =
        end.x - start.x;

    const dy =
        end.y - start.y;

    const lengthSquared =
        dx * dx + dy * dy;

    if (lengthSquared < 1e-18) {
        return { ...point };
    }

    const t =
        (
            (point.x - start.x) * dx +
            (point.y - start.y) * dy
        ) /
        lengthSquared;

    const foot = {
        x: start.x + t * dx,
        y: start.y + t * dy
    };

    return {
        x: 2 * foot.x - point.x,
        y: 2 * foot.y - point.y
    };
}

/*
 * World-space reflection of a whole feature, preserving
 * its coherent structure.
 */
export function mirrorObjectAcrossLine(
    object,
    start,
    end
) {
    const g =
        object.geometry;

    const reflect =
        point => {
            const r =
                reflectPointAcrossLine(
                    point,
                    start,
                    end
                );

            point.x = r.x;
            point.y = r.y;
        };

    if (object.type === "line") {
        reflect(g.start);
        reflect(g.end);
        return;
    }

    if (object.type === "circle") {
        reflect(g.center);
        return;
    }

    if (object.type === "arc") {
        /*
         * Reflect the centre, then reflect both angle
         * directions. The mirror reverses orientation,
         * so the start/end angles swap their reflected
         * values and the sweep changes sign.
         */
        reflect(g.center);

        const axisAngle =
            Math.atan2(
                end.y - start.y,
                end.x - start.x
            );

        const startAngle = g.startAngle;
        const endAngle = g.endAngle;

        g.startAngle =
            2 * axisAngle - endAngle;

        g.endAngle =
            2 * axisAngle - startAngle;

        if (g.sweep !== undefined) {
            g.sweep = -g.sweep;
        }

        return;
    }

    if (object.type === "polygon") {
        reflect(g.center);

        const axisAngle =
            Math.atan2(
                end.y - start.y,
                end.x - start.x
            );

        g.rotation =
            2 * axisAngle -
            (Number(g.rotation) || 0);

        return;
    }

    if (object.type === "point") {
        reflect(g.position || g.point || g);
        return;
    }

    if (object.type === "rectangle") {
        /*
         * A rectangle is axis-aligned, so reflect the two
         * opposite corners and rebuild it from the new
         * bounds.
         */
        const a = {
            x: g.position.x,
            y: g.position.y
        };

        const b = {
            x: g.position.x + g.width,
            y: g.position.y - g.height
        };

        reflect(a);
        reflect(b);

        g.position = {
            x: Math.min(a.x, b.x),
            y: Math.max(a.y, b.y)
        };

        g.width = Math.abs(b.x - a.x);
        g.height = Math.abs(b.y - a.y);
        return;
    }

    if (object.type === "rigid-body") {
        /*
         * A rigid body is a shape, so it is reflected through
         * its OUTLINE rather than through its stored anchor.
         * Reflecting only the anchor and the rotation would
         * leave the body in the wrong place, because the anchor
         * is one corner and the rotation is measured from it.
         *
         * The reflected outline is then rebuilt from its new
         * bounds, so the body keeps the same size and occupies
         * the position it was actually mirrored to.
         */
        const shape =
            enggFeatureGeometry.rigidBodyShape(
                g
            );

        const outline =
            enggFeatureGeometry
                .definingPoints(g, shape)
                .map(point => ({ ...point }));

        outline.forEach(reflect);

        const xs = outline.map(p => p.x);
        const ys = outline.map(p => p.y);

        const left = Math.min(...xs);
        const right = Math.max(...xs);
        const top = Math.max(...ys);
        const bottom = Math.min(...ys);

        if (
            shape === "circle" ||
            shape === "rectangle"
        ) {
            /*
             * These two are defined by a centre and a size, so
             * the mirrored bounds become a centre of the same
             * size. The centre is what the shape's own geometry
             * is read from, so writing it back is enough.
             */
            g.position = {
                x: left,
                y: top
            };

            g.width = right - left;
            g.height = top - bottom;

            g.center = {
                x: (left + right) / 2,
                y: (top + bottom) / 2
            };

            g.rotation = 0;

            return;
        }

        /*
         * A triangle or a polygon is defined by its own
         * vertices, so the reflected outline replaces them and
         * the anchor is re-derived from the reflected points
         * rather than carried over from the source.
         */
        g.points = outline;

        const centre =
            enggFeatureGeometry.rigidBodyCenter(
                { ...g, points: outline }
            ) || { x: 0, y: 0 };

        g.position = {
            x: centre.x,
            y: centre.y
        };

        g.rotation = 0;

        return;
    }

    if (
        object.type === "force"
    ) {
        /*
         * A Point Force is a vector, not a point. Reflecting
         * both of its ends turns the whole vector, so the
         * direction is reflected as well as the position, and
         * the magnitude is left to be re-derived rather than
         * carried over as a number that no longer describes it.
         */
        reflect(g.start);

        if (g.position) {
            reflect(g.position);
        }

        if (g.end) {
            reflect(g.end);
        }

        const start = g.start;
        const end = g.end || start;

        /*
         * Magnitude and angle are re-read from the reflected
         * ends, so the panel and the renderer agree with the
         * geometry instead of showing the source's values.
         */
        g.magnitude = Math.hypot(
            end.x - start.x,
            end.y - start.y
        );

        g.angle =
            Math.atan2(
                end.y - start.y,
                end.x - start.x
            ) * 180 / Math.PI;

        return;
    }

    if (
        object.type === "load" ||
        object.type === "varying-load"
    ) {
        /*
         * A load is a body plus a direction. Both have to be
         * reflected, and the distribution points have to be left
         * ALONE: they are positions ALONG the body, not points
         * in the plane, so reflecting them as if they were
         * coordinates is what would put NaN into the profile.
         *
         * The reflected body re-projects the profile onto
         * itself, so the shape of the load travels with the
         * body it is drawn on.
         */
        reflect(g.start);
        reflect(g.end);

        const axisAngle =
            Math.atan2(
                end.y - start.y,
                end.x - start.x
            );

        if (
            Number.isFinite(
                Number(g.direction)
            )
        ) {
            g.direction =
                2 * axisAngle -
                (Number(g.direction) || 0);
        }

        return;
    }

    if (
        object.type === "beam" ||
        object.type === "cable" ||
        object.type === "shaft"
    ) {
        reflect(g.start);
        reflect(g.end);
        return;
    }

    if (object.type === "truss") {
        /*
         * A truss is its own members, so every joint of every
         * member is reflected. Reflecting only the two stored
         * ends would leave the web members behind, which is the
         * thing that makes a truss a truss.
         */
        if (Array.isArray(g.members)) {
            g.members.forEach(member => {
                reflect(member.start);
                reflect(member.end);
            });
        }

        if (g.start) {
            reflect(g.start);
        }

        if (g.end) {
            reflect(g.end);
        }

        return;
    }

    if (
        object.type === "moment" ||
        isSupportType(object.type) ||
        isConnectionType(object.type) ||
        object.type === "support" ||
        object.type === "body" ||
        object.type === "particle"
    ) {
        /*
         * These act at a single location, so reflecting the
         * position is the whole of it. A connection is a span
         * rather than a point, so both of its ends move.
         */
        if (
            object.type ===
                "pin-connection" ||
            object.type ===
                "fixed-connection" ||
            object.type ===
                "slider-connection" ||
            object.type === "connection"
        ) {
            reflect(g.start);
            reflect(g.end);
            return;
        }

        if (g.position) {
            reflect(g.position);
        }

        if (g.start) {
            reflect(g.start);
        }

        if (g.end) {
            reflect(g.end);
        }

        return;
    }

    if (Array.isArray(g.points)) {
        /*
         * The remaining multi-point shapes are triangle,
         * polyline and polygon-with-centre. Their points are
         * real coordinates in the plane, so reflecting them is
         * what moves the shape.
         */
        g.points.forEach(reflect);

        return;
    }

    if (object.type === "analysis-diagram") {
        /*
         * ========================================================
         * AN ANALYSIS DIAGRAM IS A GRAPH, AND A GRAPH IS NOT A SHAPE
         * ========================================================
         *
         * The frame moves - both ends of it, so the whole axis is
         * reflected rather than slid.
         *
         * WHAT DOES NOT MOVE IS AS IMPORTANT AS WHAT DOES. The
         * diagram's local range is the LENGTH OF A MEMBER, measured along that
         * member, and it is unchanged by reflecting the diagram: the
         * student still means the same 0-to-500. And the plot
         * expressions stay exactly as they were typed - `10 - 5x` does
         * not become `10 - 5x` reflected, because it is not a set of
         * points but a rule, and reflecting a rule is not a thing that
         * can be done.
         *
         * WITHOUT THIS BRANCH IT SILENTLY DID NOTHING. Every other Statics
         * feature has a case here, so mirroring a beam worked and mirroring
         * an SFD produced a second copy in the identical place - which
         * looks exactly like the mirror failed, with no error to say so.
         *
         * The placement offset goes with it: it is where the student put
         * the graph relative to its member, and reflecting the graph
         * without reflecting that offset would put the copy back on top of
         * the original.
         */
        reflect(g.start);
        reflect(g.end);

        if (g.placementOffset) {
            reflect(g.placementOffset);
        }
    }
}

/*
 * Rotate a feature about a pivot in world space.
 *
 * The work is done by the shared feature-geometry registry
 * so that move, rotate and handle placement all agree on
 * which points a feature is made of.
 */
export function rotateObjectAbout(
    object,
    pivot,
    radians
) {
    enggFeatureGeometry.rotateObjectAbout(
        object,
        pivot,
        radians
    );
}

/*
 * Trim a line back to its nearest intersection with the
 * boundary.
 *
 * ANY STRAIGHT BODY is trimmed, which is every feature defined by two
 * ends: a Line, a Beam, a Cable, a Shaft, a Truss, a Reference Line and
 * a straight Polyline segment. A coherent CURVED feature is deliberately
 * not, because shortening an arc is a different operation with a
 * different answer - sliding an end around a circle rather than along a
 * straight line - and faking it by straightening the arc would replace
 * the geometry the student drew with something else.
 */
export function trimObjectToBoundary(
    target,
    boundary,
    clickPoint
) {
    /*
     * A STRAIGHT BODY IS TRIMMED LIKE A LINE.
     *
     * This used to accept `type === "line"` and nothing else, so a
     * Beam, a Cable, a Shaft, a Truss and a Reference Line were all
     * refused with "Only lines can be trimmed" - even though every one
     * of them IS a straight line, defined by the same two ends and cut
     * by the same intersection arithmetic. The restriction was about the
     * feature's NAME rather than its geometry, which is exactly the kind
     * of check that makes a tool look broken next to a sibling that
     * works.
     *
     * So the test is the geometry: anything with two ends can be
     * trimmed. That is the same `twoPointSpanOf` the measurement layer
     * uses, so what can be trimmed is precisely what can be measured and
     * dimensioned - one answer to "is this a line", asked in one place.
     */
    const span =
        twoPointSpanOf(target);

    if (!span) {
        setToolMessage(
            "Only straight geometry can be trimmed"
        );

        cancelModifySession();
        return;
    }

    const hit =
        nearestIntersectionOnLine(
            target,
            boundary
        );

    if (!hit) {
        setToolMessage(
            "No intersection with the boundary"
        );

        cancelModifySession();
        return;
    }

    const previous =
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    /*
     * The clicked end is the part removed.
     */
    const g =
        target.geometry;

    const distanceToStart =
        Math.hypot(
            clickPoint.x - g.start.x,
            clickPoint.y - g.start.y
        );

    const distanceToEnd =
        Math.hypot(
            clickPoint.x - g.end.x,
            clickPoint.y - g.end.y
        );

    if (distanceToStart <= distanceToEnd) {
        g.start = { ...hit };
    } else {
        g.end = { ...hit };
    }

    enggDrawingState.commitDrawingChange(
        drawingState,
        previous
    );

    cancelModifySession();

    setToolMessage(
        "Trimmed line"
    );

    renderProperties();
    renderCurrentDrawing();
}

/*
 * REMOVE THE SEGMENT UNDER THE CURSOR.
 *
 * This is the Trim the student actually asked for: identify the piece of line to
 * get rid of, and it goes - no second selection, no boundary to name, no
 * direction to choose.
 *
 * The geometry is MODIFIED, not hidden. What happens depends on which piece was
 * clicked, and each case is the honest consequence of removing that piece:
 *
 *   a MIDDLE piece      the line becomes TWO lines, one each side. The feature
 *                       cannot represent a gap, so it is split - the same
 *                       result the student would get by drawing the two
 *                       remaining pieces themselves.
 *
 *   the FIRST piece     the start moves to the crossing: the line is shorter.
 *
 *   the LAST piece      the end moves to the crossing.
 *
 * A middle piece is the case that made this worth building: with the old
 * nearest-crossing model it was impossible to remove, because the tool could
 * only ever shorten one end.
 */
export function trimSegmentAtCursor(target, clickPoint, objects) {
    const g = target?.geometry;

    if (!g?.start || !g?.end) {
        setToolMessage("Only straight geometry can be trimmed");

        return false;
    }

    const segment = trimSegmentAt(
        target,
        objects || drawingState.objects,
        clickPoint
    );

    if (!segment) {
        /*
         * NO VALID INTERSECTION MEANS NO TRIM. Nothing is removed, nothing is
         * approximated, and the line is left exactly as it was - which is the
         * only safe answer when the tool cannot tell what the student meant.
         */
        setToolMessage(
            "Nothing crosses this line here, so there is nothing to trim"
        );

        return false;
    }

    const previous = enggDrawingState.snapshotDrawing(drawingState);

    const removesBothEnds =
        segment.touchesStart && segment.touchesEnd;

    if (segment.touchesStart && !segment.touchesEnd) {
        /* The first piece: the line now begins at the crossing. */
        g.start = { ...segment.to };
    } else if (segment.touchesEnd && !segment.touchesStart) {
        /* The last piece: the line now ends at the crossing. */
        g.end = { ...segment.from };
    } else if (!removesBothEnds) {
        /*
         * A MIDDLE PIECE: split into the two remaining runs.
         *
         * The original keeps its id, its name and its place in the document -
         * so anything referring to it still refers to something - and the far
         * piece is added as a new feature beside it. Doing it the other way
         * round would silently break every reference to the trimmed line.
         */
        const originalEnd = { ...g.end };

        g.end = { ...segment.from };

        const tail =
            enggDrawingState.createGeometryObject(
                target.type,
                {
                    ...JSON.parse(JSON.stringify(g)),
                    start: { ...segment.to },
                    end: originalEnd
                },
                {
                    style: { ...target.style },
                    name: target.name
                }
            );

        enggDrawingState.addObject(drawingState, tail);
    }

    /*
     * A TRIM THAT CHANGED NOTHING IS NOT REPORTED AS A TRIM.
     *
     * Every branch above either moves an end or splits the line, so reaching
     * here means one of them did. The check is a guard against a future case
     * being added without a way to act on it: better to say nothing happened
     * than to say "Trimmed" over an unchanged drawing.
     */
    const startMoved =
        g.start.x !== segment.from.x || g.start.y !== segment.from.y;

    const endMoved =
        g.end.x !== segment.to.x || g.end.y !== segment.to.y;

    const changed = removesBothEnds
        ? startMoved || endMoved
        : true;

    if (!changed) {
        setToolMessage(
            "Nothing crosses this line here, so there is nothing to trim"
        );

        return false;
    }

    enggDrawingState.commitDrawingChange(drawingState, previous);

    cancelModifySession();

    setToolMessage("Trimmed");

    renderProperties();
    renderCurrentDrawing();

    return true;
}

/*
 * Extend a line to its nearest intersection with the
 * boundary along the line's own direction.
 */
export function extendObjectToBoundary(
    target,
    boundary,
    clickPoint
) {
    /*
     * The same geometry test the trim path makes, and for the same
     * reason: a Beam, Cable, Shaft, Truss or Reference Line is a line
     * between two ends, so extending it to a boundary is the identical
     * operation. Restricting this to `type === "line"` refused every
     * one of them with a message about lines while they plainly were
     * lines.
     */
    const span =
        twoPointSpanOf(target);

    if (!span) {
        setToolMessage(
            "Only straight geometry can be extended"
        );

        cancelModifySession();
        return;
    }

    const g =
        target.geometry;

    const hit =
        nearestIntersectionOnLine(
            target,
            boundary,
            true
        );

    if (!hit) {
        setToolMessage(
            "No boundary intersection found"
        );

        cancelModifySession();
        return;
    }

    const previous =
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    const distanceToStart =
        Math.hypot(
            clickPoint.x - g.start.x,
            clickPoint.y - g.start.y
        );

    const distanceToEnd =
        Math.hypot(
            clickPoint.x - g.end.x,
            clickPoint.y - g.end.y
        );

    if (distanceToStart <= distanceToEnd) {
        g.start = { ...hit };
    } else {
        g.end = { ...hit };
    }

    enggDrawingState.commitDrawingChange(
        drawingState,
        previous
    );

    cancelModifySession();

    setToolMessage(
        "Extended line"
    );

    renderProperties();
    renderCurrentDrawing();
}

/*
 * Intersection between a line and any other supported
 * boundary object, in world coordinates.
 */
/*
 * ========================================================
 * THE SEGMENTS A LINE IS DIVIDED INTO
 * ========================================================
 *
 * Every place another feature crosses this line divides it. Three crossings
 * give four segments; one gives two. That is the whole model behind Trim: the
 * user identifies the PIECE they want gone, and the piece is bounded by the
 * real intersections either side of where they clicked.
 *
 * THE BOUNDARIES ARE FOUND FROM THE GEOMETRY, NOT FROM A SECOND PICK.
 *
 * Trim used to require the cutting edge to be chosen as well as the line, which
 * is two selections for one decision - and the tool then cut back to the
 * NEAREST crossing of that one boundary, so a line crossed by several features
 * could not have a middle piece removed at all. Here every other feature is
 * tested, so the segments are the ones the drawing actually has.
 *
 * All of it is world-space arithmetic on the stored geometry: zoom, pan and
 * World Scale cannot change where an intersection is, so a trim lands exactly
 * on the crossing at any magnification.
 */
function intersectionsAlongLine(lineObject, objects) {
    const g = lineObject.geometry;

    const hits = [];

    (objects || []).forEach((other) => {
        /*
         * A feature cannot cross itself, and dimensions and annotations are not
         * geometry to cut against - they are statements ABOUT the geometry.
         */
        if (
            !other ||
            other.id === lineObject.id ||
            other.type === "dimension" ||
            other.type === "variable-dimension" ||
            other.type === "annotation"
        ) {
            return;
        }

        boundarySegments(other).forEach(([a, b]) => {
            if (!a || !b) {
                return;
            }

            const hit = segmentIntersectionPoint(g.start, g.end, a, b);

            if (!hit) {
                return;
            }

            const t = segmentParameter(g.start, g.end, hit);

            /*
             * ONLY A CROSSING IN THE INTERIOR DIVIDES THE LINE.
             *
             * A crossing exactly AT an end does not cut anything: the line has
             * no piece on one side of it to remove, because the line itself
             * stops there. Recording it as a stop made `stops` read
             * `[start, start, end]`, and the zero-length first piece was then
             * skipped - so the WHOLE LINE became the "last piece" and trimming
             * near it shortened the line to its own start. A click meant to trim
             * nothing changed the drawing.
             *
             * The tolerance is the same 1e-9 the segment maths uses elsewhere,
             * so "at the end" means the same thing everywhere.
             */
            if (t <= 1e-9 || t >= 1 - 1e-9) {
                return;
            }

            hits.push({ t, point: hit });
        });
    });

    /*
     * Ordered along the line, with crossings that coincide treated as one - two
     * features meeting the line at the same place divide it once, not twice.
     */
    hits.sort((first, second) => first.t - second.t);

    return hits.filter((hit, index) =>
        index === 0 || Math.abs(hit.t - hits[index - 1].t) > 1e-9
    );
}

/*
 * THE SEGMENT THE CURSOR IS OVER, as a pair of endpoints on the line.
 *
 * The segments are: start..first crossing, crossing..crossing, last
 * crossing..end. The click is placed on one of them by its parameter along the
 * line, and the segment it falls in is returned - which is exactly the piece
 * that will disappear, so a preview drawn from this cannot disagree with what
 * the commit does.
 *
 * With NO crossings there is no segment to remove: a line that nothing crosses
 * has only itself, and removing it would be Delete, not Trim.
 */
export function trimSegmentAt(lineObject, objects, clickPoint) {
    const g = lineObject?.geometry;

    if (!g?.start || !g?.end) {
        return null;
    }

    const hits = intersectionsAlongLine(lineObject, objects);

    if (!hits.length) {
        return null;
    }

    const clickT = segmentParameter(g.start, g.end, clickPoint);

    /*
     * The bounds in order, including the line's own ends - so the outer segments
     * are bounded by an end on one side and a crossing on the other.
     */
    const stops = [
        { t: 0, point: { ...g.start } },
        ...hits,
        { t: 1, point: { ...g.end } }
    ];

    for (let index = 1; index < stops.length; index += 1) {
        const from = stops[index - 1];
        const to = stops[index];

        if (clickT >= from.t - 1e-9 && clickT <= to.t + 1e-9) {
            /*
             * A zero-length piece is not a segment - it is a crossing sitting
             * on an end, and removing it would change nothing.
             */
            if (Math.abs(to.t - from.t) < 1e-9) {
                return null;
            }

            return {
                from: { ...from.point },
                to: { ...to.point },
                fromT: from.t,
                toT: to.t,
                /* True when the piece includes an end of the line. */
                touchesStart: index === 1,
                touchesEnd: index === stops.length - 1
            };
        }
    }

    return null;
}

function nearestIntersectionOnLine(
    lineObject,
    boundary,
    allowExtension = false
) {
    const segments =
        boundarySegments(
            boundary
        );

    const g =
        lineObject.geometry;

    let best = null;

    segments.forEach(
        ([a, b]) => {
            const hit =
                segmentIntersectionPoint(
                    g.start,
                    g.end,
                    a,
                    b
                );

            if (!hit) {
                return;
            }

            /*
             * When trimming, the hit has to lie on the
             * line already; when extending it may lie
             * beyond either end.
             */
            const t =
                segmentParameter(
                    g.start,
                    g.end,
                    hit
                );

            if (
                !allowExtension &&
                (t < -1e-9 || t > 1 + 1e-9)
            ) {
                return;
            }

            const distance =
                Math.hypot(
                    hit.x - g.start.x,
                    hit.y - g.start.y
                );

            if (
                !best ||
                distance < best.distance
            ) {
                best = {
                    point: hit,
                    distance
                };
            }
        }
    );

    return best ? best.point : null;
}

/*
 * Straight segments of any supported boundary object.
 */
function boundarySegments(
    object
) {
    const g =
        object.geometry || {};

    if (object.type === "line") {
        return [[g.start, g.end]];
    }

    if (object.type === "rectangle") {
        const a = { x: g.position.x, y: g.position.y };
        const b = { x: g.position.x + g.width, y: g.position.y };
        const c = { x: g.position.x + g.width, y: g.position.y - g.height };
        const d = { x: g.position.x, y: g.position.y - g.height };

        return [[a, b], [b, c], [c, d], [d, a]];
    }

    if (object.type === "triangle") {
        const points = (g.points || []).filter(Boolean);

        return points.map((p, i) => [p, points[(i + 1) % points.length]]);
    }

    if (object.type === "polygon") {
        const points = enggDrawingState.polygonVertices(g);

        return points.map((p, i) => [p, points[(i + 1) % points.length]]);
    }

    if (object.type === "polyline" && Array.isArray(g.points)) {
        const segments = [];

        for (let i = 1; i < g.points.length; i += 1) {
            segments.push([g.points[i - 1], g.points[i]]);
        }

        return segments;
    }

    /*
     * ANY OTHER STRAIGHT BODY CUTS LIKE A LINE.
     *
     * A Beam, Cable, Shaft, Truss or Reference Line is a line between
     * two ends, so it divides the plane exactly as a Line does. Asking
     * through `twoPointSpanOf` rather than listing the types means the
     * boundary side and the target side agree about what a line is -
     * and a feature added later is usable as a trim boundary the day it
     * exists rather than the day it is added to a list here.
     *
     * This runs LAST so it cannot shadow the composite shapes above, all
     * of which are handled by their own multi-segment reading.
     */
    const span =
        twoPointSpanOf(object);

    if (span) {
        return [[span.start, span.end]];
    }

    return [];
}

/*
 * Parameter of a point along a segment, where 0 is the
 * start and 1 is the end.
 */
function segmentParameter(
    start,
    end,
    point
) {
    const dx =
        end.x - start.x;

    const dy =
        end.y - start.y;

    const lengthSquared =
        dx * dx + dy * dy;

    if (lengthSquared < 1e-18) {
        return 0;
    }

    return (
        (
            (point.x - start.x) * dx +
            (point.y - start.y) * dy
        ) /
        lengthSquared
    );
}

/*
 * Intersection of two straight segments, or null when
 * they are parallel or do not cross.
 */
function segmentIntersectionPoint(
    firstStart,
    firstEnd,
    secondStart,
    secondEnd
) {
    const denominator =
        (firstStart.x - firstEnd.x) *
            (secondStart.y - secondEnd.y) -
        (firstStart.y - firstEnd.y) *
            (secondStart.x - secondEnd.x);

    if (Math.abs(denominator) < 1e-12) {
        return null;
    }

    const a = firstStart.x * firstEnd.y - firstStart.y * firstEnd.x;
    const b = secondStart.x * secondEnd.y - secondStart.y * secondEnd.x;

    const x =
        (
            a * (secondStart.x - secondEnd.x) -
            (firstStart.x - firstEnd.x) * b
        ) / denominator;

    const y =
        (
            a * (secondStart.y - secondEnd.y) -
            (firstStart.y - firstEnd.y) * b
        ) / denominator;

    return { x, y };
}

/*
 * Translate every selected object by a delta.
 */
export function moveSelectionBy(
    deltaX,
    deltaY
) {
    const selected =
        drawingState.objects.filter(
            object =>
                drawingState.selection
                    .selectedObjectIds
                    .includes(
                        object.id
                    )
        );

    if (!selected.length) {
        return;
    }

    const previous =
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    selected.forEach(
        object =>
            translateObject(
                object,
                deltaX,
                deltaY
            )
    );

    enggDrawingState.commitDrawingChange(
        drawingState,
        previous
    );

    renderProperties();
    renderCurrentDrawing();
}

/*
 * Move an object's defining geometry. Each feature
 * type stores its position differently, so this maps
 * the translation onto the stored parameters rather
 * than duplicating the geometry.
 */
/*
 * Move every defining point of a feature by a delta.
 *
 * Delegated to the shared feature-geometry registry so a
 * feature never moves by one rule and rotates by another.
 */
export function translateObject(
    object,
    deltaX,
    deltaY
) {
    enggFeatureGeometry.translateObject(
        object,
        deltaX,
        deltaY,

        /*
         * The LOOKUP the geometry module uses to find a feature's
         * parent, passed in rather than reached for.
         *
         * A support is moved along its parent body's centreline, so
         * the geometry needs the body to do it. This module is
         * deliberately free of any knowledge of the document - it
         * answers questions about shapes, not about what is on the
         * sheet - so the drawing, which does know, supplies the
         * lookup. That is the same arrangement used for the
         * dependency registry: the shared module is told about the
         * document rather than reaching into it.
         */
        id =>
            drawingState.objects.find(
                candidate =>
                    candidate.id === id
            ) || null
    );
}

/*
 * Rotate the selection about its own centre, so a
 * rotate never drifts the geometry away from where it
 * was.
 */
export function rotateSelectionBy(
    degrees
) {
    const selected =
        drawingState.objects.filter(
            object =>
                drawingState.selection
                    .selectedObjectIds
                    .includes(
                        object.id
                    )
        );

    if (!selected.length) {
        return;
    }

    const pivot =
        selectionCenter(
            selected
        );

    const radians =
        degrees *
        Math.PI /
        180;

    const cos =
        Math.cos(radians);

    const sin =
        Math.sin(radians);

    const previous =
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    const rotatePoint =
        point => {
            const dx =
                point.x - pivot.x;

            const dy =
                point.y - pivot.y;

            point.x =
                pivot.x +
                dx * cos -
                dy * sin;

            point.y =
                pivot.y +
                dx * sin +
                dy * cos;
        };

    selected.forEach(
        object => {
            const g =
                object.geometry;

            if (
                object.type === "line"
            ) {
                rotatePoint(g.start);
                rotatePoint(g.end);
                return;
            }

            if (
                object.type === "circle"
            ) {
                rotatePoint(g.center);
                return;
            }

            if (
                object.type === "arc"
            ) {
                rotatePoint(g.center);
                g.startAngle += radians;
                g.endAngle += radians;

                if (g.sweep !== undefined) {
                    /* sweep magnitude is unchanged */
                }

                return;
            }

            if (
                object.type === "polygon"
            ) {
                rotatePoint(g.center);
                g.rotation =
                    (Number(g.rotation) || 0) +
                    radians;
                return;
            }

            if (
                object.type === "point"
            ) {
                rotatePoint(
                    g.position || g.point || g
                );
                return;
            }

            if (
                object.type === "rectangle"
            ) {
                rotatePoint(g.position);
                g.rotation =
                    (Number(g.rotation) || 0) +
                    degrees;
                return;
            }

            if (
                Array.isArray(
                    g.points
                )
            ) {
                g.points.forEach(
                    rotatePoint
                );
            }
        }
    );

    enggDrawingState.commitDrawingChange(
        drawingState,
        previous
    );

    renderProperties();
    renderCurrentDrawing();
}

/*
 * Mirror the selection across the vertical line through
 * its own centre.
 */
export function mirrorSelectionVertically() {
    const selected =
        drawingState.objects.filter(
            object =>
                drawingState.selection
                    .selectedObjectIds
                    .includes(
                        object.id
                    )
        );

    if (!selected.length) {
        return;
    }

    const axis =
        selectionCenter(
            selected
        ).x;

    const previous =
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    const flip =
        point => {
            point.x =
                2 * axis -
                point.x;
        };

    selected.forEach(
        object => {
            const g =
                object.geometry;

            if (
                object.type === "line"
            ) {
                flip(g.start);
                flip(g.end);
                return;
            }

            if (
                object.type === "circle"
            ) {
                flip(g.center);
                return;
            }

            if (
                object.type === "arc"
            ) {
                flip(g.center);

                /*
                 * Mirroring reverses the arc direction.
                 */
                g.startAngle =
                    Math.PI -
                    g.startAngle;

                g.endAngle =
                    Math.PI -
                    g.endAngle;

                return;
            }

            if (
                object.type === "polygon"
            ) {
                flip(g.center);
                g.rotation =
                    Math.PI -
                    (Number(g.rotation) || 0);
                return;
            }

            if (
                object.type === "point"
            ) {
                flip(
                    g.position || g.point || g
                );
                return;
            }

            if (
                object.type === "rectangle"
            ) {
                flip(g.position);
                return;
            }

            if (
                Array.isArray(
                    g.points
                )
            ) {
                g.points.forEach(
                    flip
                );
            }
        }
    );

    enggDrawingState.commitDrawingChange(
        drawingState,
        previous
    );

    renderProperties();
    renderCurrentDrawing();
}

/*
 * Bounding centre of a set of objects, used as the
 * pivot for rotate and the axis for mirror.
 */
function selectionCenter(
    objects
) {
    const points = [];

    objects.forEach(
        object => {
            const g =
                object.geometry;

            if (!g) {
                return;
            }

            if (g.start) {
                points.push(g.start);
            }

            if (g.end) {
                points.push(g.end);
            }

            if (g.center) {
                points.push(g.center);
            }

            if (g.position) {
                points.push(g.position);
            }

            if (g.origin) {
                points.push(g.origin);
            }

            if (
                Array.isArray(
                    g.points
                )
            ) {
                g.points.forEach(
                    point =>
                        points.push(
                            point
                        )
                );
            }
        }
    );

    if (!points.length) {
        return {
            x: 0,
            y: 0
        };
    }

    const xs =
        points.map(
            point =>
                point.x
        );

    const ys =
        points.map(
            point =>
                point.y
        );

    return {
        x:
            (
                Math.min(...xs) +
                Math.max(...xs)
            ) / 2,

        y:
            (
                Math.min(...ys) +
                Math.max(...ys)
            ) / 2
    };
}
