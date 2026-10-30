/*
 * Box selection: which features a selection rectangle touches.
 */

import enggFeatureGeometry from "../../../shared/geometry/feature-geometry.js";
import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggLoadProfile from "../model/analysis/load-profile.js";
import enggAnnotationModel from "../model/annotations/annotation-model.js";
import enggDimensionModel from "../model/dimensions/dimension-model.js";
import enggDrawingRenderer from "../../../shared/rendering/renderer.js";
import { distance } from "../geometry/construction-geometry.js";
import { drawingState } from "../editor-state.js";
import { isRectangleLike, objectPoints } from "./hit-testing.js";
import { isPointLikeType, isSpanShapedType } from "../../../shared/model/feature-types.js";

/*
 * Whether a selection rectangle touches a RING (a circle's outline).
 *
 * A Dynamics pulley and a rotation symbol are drawn as a ring, so the test
 * is the ring's ink: a corner of the box inside the band between the inner
 * and outer radius, or any box EDGE crossing the circle. A box drawn inside
 * the ring's hole touches no ink and correctly selects nothing.
 */
function ringIntersectsSelection(
    centre,
    radius,
    selectionBox
) {
    if (!centre || !(radius > 0)) {
        return false;
    }

    const corners = [
        { x: selectionBox.minX, y: selectionBox.minY },
        { x: selectionBox.maxX, y: selectionBox.minY },
        { x: selectionBox.maxX, y: selectionBox.maxY },
        { x: selectionBox.minX, y: selectionBox.maxY }
    ];

    const band = Math.max(2, radius * 0.15);

    if (
        corners.some(
            corner =>
                Math.abs(distance(corner, centre) - radius) <= band
        )
    ) {
        return true;
    }

    /* A box wholly inside the hole touches nothing. */
    const farthest = Math.max(
        ...corners.map(corner => distance(corner, centre))
    );

    if (farthest < radius - band) {
        return false;
    }

    /* An axis-aligned box around the centre with a radius smaller than
       half a side still reaches the ring - checked by the four crossings. */
    return (
        selectionBox.minX <= centre.x + radius &&
        selectionBox.maxX >= centre.x - radius &&
        selectionBox.minY <= centre.y + radius &&
        selectionBox.maxY >= centre.y - radius
    );
}

function pointInsideSelection(
    point,
    selectionBox
) {
    return (
        point.x >=
            selectionBox.minX &&

        point.x <=
            selectionBox.maxX &&

        point.y >=
            selectionBox.minY &&

        point.y <=
            selectionBox.maxY
    );
}

function segmentsIntersect(
    firstStart,
    firstEnd,
    secondStart,
    secondEnd
) {
    const cross = (
        a,
        b,
        c
    ) =>
        (
            b.x -
            a.x
        ) *
        (
            c.y -
            a.y
        ) -
        (
            b.y -
            a.y
        ) *
        (
            c.x -
            a.x
        );

    const onSegment = (
        a,
        point,
        b
    ) =>
        point.x >=
            Math.min(
                a.x,
                b.x
            ) -
            1e-9 &&

        point.x <=
            Math.max(
                a.x,
                b.x
            ) +
            1e-9 &&

        point.y >=
            Math.min(
                a.y,
                b.y
            ) -
            1e-9 &&

        point.y <=
            Math.max(
                a.y,
                b.y
            ) +
            1e-9;

    const c1 =
        cross(
            firstStart,
            firstEnd,
            secondStart
        );

    const c2 =
        cross(
            firstStart,
            firstEnd,
            secondEnd
        );

    const c3 =
        cross(
            secondStart,
            secondEnd,
            firstStart
        );

    const c4 =
        cross(
            secondStart,
            secondEnd,
            firstEnd
        );

    const s1 =
        Math.abs(c1) < 1e-9
            ? 0
            : c1 > 0
                ? 1
                : -1;

    const s2 =
        Math.abs(c2) < 1e-9
            ? 0
            : c2 > 0
                ? 1
                : -1;

    const s3 =
        Math.abs(c3) < 1e-9
            ? 0
            : c3 > 0
                ? 1
                : -1;

    const s4 =
        Math.abs(c4) < 1e-9
            ? 0
            : c4 > 0
                ? 1
                : -1;

    if (
        s1 !== 0 &&
        s2 !== 0 &&
        s1 !== s2 &&
        s3 !== 0 &&
        s4 !== 0 &&
        s3 !== s4
    ) {
        return true;
    }

    if (
        s1 === 0 &&
        onSegment(
            firstStart,
            secondStart,
            firstEnd
        )
    ) {
        return true;
    }

    if (
        s2 === 0 &&
        onSegment(
            firstStart,
            secondEnd,
            firstEnd
        )
    ) {
        return true;
    }

    if (
        s3 === 0 &&
        onSegment(
            secondStart,
            firstStart,
            secondEnd
        )
    ) {
        return true;
    }

    if (
        s4 === 0 &&
        onSegment(
            secondStart,
            firstEnd,
            secondEnd
        )
    ) {
        return true;
    }

    return false;
}

function selectionRectangleEdges(
    selectionBox
) {
    const topLeft = {
        x:
            selectionBox.minX,

        y:
            selectionBox.maxY
    };

    const topRight = {
        x:
            selectionBox.maxX,

        y:
            selectionBox.maxY
    };

    const bottomRight = {
        x:
            selectionBox.maxX,

        y:
            selectionBox.minY
    };

    const bottomLeft = {
        x:
            selectionBox.minX,

        y:
            selectionBox.minY
    };

    return [
        [
            topLeft,
            topRight
        ],

        [
            topRight,
            bottomRight
        ],

        [
            bottomRight,
            bottomLeft
        ],

        [
            bottomLeft,
            topLeft
        ]
    ];
}

function segmentIntersectsSelection(
    start,
    end,
    selectionBox
) {
    if (
        pointInsideSelection(
            start,
            selectionBox
        ) ||
        pointInsideSelection(
            end,
            selectionBox
        )
    ) {
        return true;
    }

    return selectionRectangleEdges(
        selectionBox
    ).some(
        ([edgeStart, edgeEnd]) =>
            segmentsIntersect(
                start,
                end,
                edgeStart,
                edgeEnd
            )
    );
}

function polylineIntersectsSelection(
    points,
    selectionBox
) {
    if (
        !Array.isArray(points) ||
        points.length === 0
    ) {
        return false;
    }

    if (
        points.some(
            point =>
                pointInsideSelection(
                    point,
                    selectionBox
                )
        )
    ) {
        return true;
    }

    for (
        let index = 1;
        index < points.length;
        index += 1
    ) {
        if (
            segmentIntersectsSelection(
                points[index - 1],
                points[index],
                selectionBox
            )
        ) {
            return true;
        }
    }

    return false;
}

function distanceToSelectionRectangle(
    point,
    selectionBox
) {
    const dx =
        Math.max(
            selectionBox.minX -
                point.x,

            0,

            point.x -
                selectionBox.maxX
        );

    const dy =
        Math.max(
            selectionBox.minY -
                point.y,

            0,

            point.y -
                selectionBox.maxY
        );

    return Math.hypot(
        dx,
        dy
    );
}

function circleIntersectsSelection(
    circle,
    selectionBox
) {
    const center =
        circle.center;

    const radius =
        Math.abs(
            circle.radius
        );

    if (
        pointInsideSelection(
            center,
            selectionBox
        )
    ) {
        return true;
    }

    return (
        distanceToSelectionRectangle(
            center,
            selectionBox
        ) <=
        radius
    );
}

/*
 * Whether a closed outline crosses the rectangle.
 *
 * The same test as for an open polyline, with the first point
 * repeated at the end so the closing side is included.
 */
function polygonIntersectsSelection(
    points,
    selectionBox
) {
    if (
        !points ||
        points.length < 3
    ) {
        return false;
    }

    return polylineIntersectsSelection(
        [
            ...points,
            points[0]
        ],
        selectionBox
    );
}

/*
 * Whether the whole selection rectangle lies inside a circle.
 *
 * This is the other direction of a circle intersection, and it
 * matters because a circle that swallows the rectangle has no
 * part of its own outline inside it. Without it, a circle
 * bigger than the whole drawing area could never be selected.
 */
function rectangleInsideCircle(
    circle,
    selectionBox
) {
    const corners = [
        {
            x: selectionBox.minX,
            y: selectionBox.minY
        },
        {
            x: selectionBox.maxX,
            y: selectionBox.minY
        },
        {
            x: selectionBox.maxX,
            y: selectionBox.maxY
        },
        {
            x: selectionBox.minX,
            y: selectionBox.maxY
        }
    ];

    return corners.every(
        corner =>
            distance(
                corner,
                circle.center
            ) <=
            Math.abs(circle.radius)
    );
}

export function arcSelectionPoints(
    geometry
) {
    const twoPi =
        Math.PI * 2;

    const normalize =
        value =>
            (
                (
                    value %
                    twoPi
                ) +
                twoPi
            ) %
            twoPi;

    const start =
        geometry.startAngle;

    const end =
        geometry.endAngle;

    const direction =
        geometry.sweep === -1
            ? -1
            : geometry.sweep === 1
                ? 1
                : (
                    end >= start
                        ? 1
                        : -1
                );

    let sweep =
        direction > 0
            ? normalize(
                end -
                start
            )
            : -normalize(
                end -
                start
            );

    if (
        Math.abs(sweep) <
        1e-9
    ) {
        sweep =
            twoPi;
    }

    const segmentCount =
        Math.max(
            32,
            Math.ceil(
                Math.abs(sweep) /
                (
                    Math.PI /
                    72
                )
            )
        );

    const points = [];

    for (
        let index = 0;
        index <=
            segmentCount;
        index += 1
    ) {
        const angle =
            start +
            sweep *
                (
                    index /
                    segmentCount
                );

        points.push({
            x:
                geometry.center.x +
                Math.cos(angle) *
                    geometry.radius,

            y:
                geometry.center.y +
                Math.sin(angle) *
                    geometry.radius
        });
    }

    return points;
}

function arcIntersectsSelection(
    geometry,
    selectionBox
) {
    return polylineIntersectsSelection(
        arcSelectionPoints(
            geometry
        ),
        selectionBox
    );
}

/*
 * ========================================================
 * DOES THIS FEATURE FALL INSIDE THE SELECTION RECTANGLE?
 * ========================================================
 *
 * The dispatcher every box selection goes through: one feature, one rectangle,
 * true if the feature's DRAWN GEOMETRY meets it. Each feature type is tested the
 * way that type is actually drawn - a span by its segment, a rectangle-like
 * shape by its corners and edges, a load by the body it acts on, a graph feature
 * by its projected ink - and everything else falls back to its defining points.
 *
 * IT WAS CALLED `coordinateSystemIntersectsSelection`, AND THE NAME WAS WRONG.
 * The function has been the general dispatcher for every type since the cases
 * for rectangles, forces, loads and trusses were added to it; the name survived
 * from when a coordinate system was the only caller. Worse, it made the ONE
 * import that matters fail: `selection.js` imports `objectIntersectsSelection`,
 * so the module graph threw a missing-export SyntaxError, `main.js` stopped
 * where it imported `selection.js`, and everything after it - the menu bar, the
 * command search, the drawing editor's own wiring - never ran. The visible
 * symptom was the Engineering Drawing tab doing nothing when clicked, because
 * the section switched but the editor it needs had not finished loading.
 *
 * So the name now states what the function does. The old name is still exported,
 * because it is a public symbol other modules may hold and nothing is gained by
 * breaking them.
 */
export function objectIntersectsSelection(
    object,
    selectionBox
) {
    if (
        !object ||
        !object.geometry ||
        !selectionBox
    ) {
        return false;
    }

    const geometry = object.geometry;

    /*
     * A rigid body, and a rectangle, are areas rather than
     * outlines: a rectangle drawn wholly inside a large rigid
     * body is a meaningful selection, so the closed outline is
     * tested as an area first and its edges are the fallback.
     */
    if (isRectangleLike(object)) {
        const corners =
            objectPoints(object);

        if (
            corners.some(
                corner =>
                    pointInsideSelection(
                        corner,
                        selectionBox
                    )
            )
        ) {
            return true;
        }
    }

    /*
     * A Point Force is a vector, so it is intersected along its
     * whole drawn length. The arrow head sits inside the span
     * of that vector, so the shaft is enough to catch a click
     * anywhere on the arrow.
     */
    if (object.type === "force") {
        return (
            (geometry.start &&
                geometry.end &&
                segmentIntersectsSelection(
                    geometry.start,
                    geometry.end,
                    selectionBox
                )) ||

            (geometry.start &&
                pointInsideSelection(
                    geometry.start,
                    selectionBox
                ))
        );
    }

    /*
     * A distributed load is one feature whatever the number of
     * arrows it draws, so the body it loads is what is tested:
     * selecting part of a load's field selects the whole load.
     */
    if (
        object.type === "load" ||
        object.type === "varying-load"
    ) {
        return (
            (geometry.start &&
                geometry.end &&
                segmentIntersectsSelection(
                    geometry.start,
                    geometry.end,
                    selectionBox
                )) ||
            distributedLoadArrowsIntersect(
                geometry,
                selectionBox
            )
        );
    }

    /*
     * A Truss the student built is drawn as its own members, so
     * any member meeting the rectangle selects the one Truss.
     * That is the point of keeping it as one object rather than
     * as a set of lines.
     */
    if (
        object.type === "truss" &&
        Array.isArray(geometry.members) &&
        geometry.members.length
    ) {
        return geometry.members.some(
            member =>
                segmentIntersectsSelection(
                    member.start,
                    member.end,
                    selectionBox
                )
        );
    }

    /*
     * A DYNAMICS SYMBOL IS SWEPT UP AS THE SPAN OR RING IT IS DRAWN AS.
     *
     * A spring, a damper and a branch pair run between their two terminals;
     * a rotation symbol and a pulley are a ring about their centre. The
     * tests follow that ink, so a selection rectangle that crosses a drawn
     * symbol selects it - and it selects the ONE symbol, never a part of
     * it.
     */
    const dynamicsKind = object.engineering?.dynamicsType;

    if (
        dynamicsKind === "dynamics-pulley" ||
        dynamicsKind === "dynamics-angular-vector"
    ) {
        return (
            geometry.center &&
            ringIntersectsSelection(
                geometry.center,
                Math.abs(Number(geometry.radius) || 0),
                selectionBox
            )
        );
    }

    if (typeof dynamicsKind === "string" && geometry.start && geometry.end) {
        return segmentIntersectsSelection(
            geometry.start,
            geometry.end,
            selectionBox
        );
    }

    /*
     * A CHAIN OF SPANS, by trait rather than by name.
     *
     * A polyline and a legacy construction chain are both a sequence of
     * straight segments, and the test is the same for every one of them. The
     * trait is asked rather than listing the types here, because a list is a
     * thing to forget - and forgetting it is what left a polyline box-selectable
     * only by catching one of its own vertices.
     */
    if (
        Array.isArray(geometry.points) &&
        geometry.points.length >= 2
    ) {
        return polylineIntersectsSelection(
            geometry.points,
            selectionBox
        );
    }

    /*
     * A SPAN-SHAPED STATICS BODY: a Beam, Cable or Shaft, a
     * Connection, and a Varying Distributed Load. Each is a real
     * line to the selection test.
     */
    if (
        geometry.start &&
        geometry.end &&
        isSpanShapedType(object.type)
    ) {
        return segmentIntersectsSelection(
            geometry.start,
            geometry.end,
            selectionBox
        );
    }

    /*
     * A POINT HAS NO EXTENT, so it is selected when it is in
     * the rectangle.
     */
    if (object.type === "point") {
        return pointInsideSelection(
            geometry.position ||
                geometry.point ||
                geometry,
            selectionBox
        );
    }

    /*
     * ========================================================
     * A FEATURE PLACED AT A POINT
     * ========================================================
     *
     * A support, a moment, a particle, a reference point, a connection: each is
     * drawn AT a location rather than along a span, and the location is its
     * `position`.
     *
     * THEY REACHED THE FALLBACK AND WERE MISSED. `objectPoints` answers with
     * the points a feature is DEFINED BY, and for several Statics types that is
     * not `geometry.position` - so a rectangle dragged over a support found
     * nothing, and the support could be clicked but not swept up. Testing the
     * placement directly is what makes one rectangle select a beam AND the
     * support sitting on it.
     *
     * Checked BEFORE the fallback so the answer does not depend on what
     * `objectPoints` happens to return for a given type.
     */
    /*
     * A FEATURE PLACED AT A POINT, BY TRAIT.
     *
     * `pointLike` is asked of the REGISTRY rather than inferred from "it has a
     * position". That distinction is the whole of this fix: an annotate
     * feature's geometry carries a `position` defaulting to (0, 0) whether or
     * not it is drawn there, so "has a position" was true of a LEADER - and
     * this branch then tested the leader at the origin and returned, before the
     * branch below could test its actual pen. A leader could be clicked but not
     * swept up, and the same was true of an arrow and a callout.
     *
     * A support, a moment, a particle and a reference point really ARE points on
     * the sheet, so they say so in the table and are tested at their placement.
     */
    if (
        isPointLikeType(object.type) &&
        geometry.position &&
        Number.isFinite(geometry.position.x) &&
        Number.isFinite(geometry.position.y)
    ) {
        return pointInsideSelection(geometry.position, selectionBox);
    }

    /*
     * The shapes whose drawn outline is what is tested. The
     * closed loops are built with the first point repeated so
     * the closing side is included, exactly as they are drawn.
     */
    if (object.type === "rectangle") {
        const corners =
            objectPoints(object);

        if (
            polygonIntersectsSelection(
                corners,
                selectionBox
            )
        ) {
            return true;
        }

        return corners.some(
            corner =>
                pointInsideSelection(
                    corner,
                    selectionBox
                )
        );
    }

    if (object.type === "polygon") {
        const points =
            enggDrawingState.polygonVertices(
                geometry
            );

        if (points.length < 3) {
            return false;
        }

        if (
            polygonIntersectsSelection(
                points,
                selectionBox
            )
        ) {
            return true;
        }

        return points.some(
            point =>
                pointInsideSelection(
                    point,
                    selectionBox
                )
        );
    }

    if (object.type === "triangle") {
        const points =
            (geometry.points || []).filter(
                Boolean
            );

        if (points.length < 3) {
            return false;
        }

        if (
            polygonIntersectsSelection(
                points,
                selectionBox
            )
        ) {
            return true;
        }

        return points.some(
            point =>
                pointInsideSelection(
                    point,
                    selectionBox
                )
        );
    }

    if (object.type === "circle") {
        if (
            circleIntersectsSelection(
                geometry,
                selectionBox
            )
        ) {
            return true;
        }

        /*
         * A circle that swallows the whole rectangle counts
         * too: the rectangle is inside the circle, which is a
         * real intersection even though no part of the circle
         * itself is inside it.
         */
        return (
            pointInsideSelection(
                geometry.center,
                selectionBox
            ) ||
            rectangleInsideCircle(
                geometry,
                selectionBox
            )
        );
    }

    if (object.type === "arc") {
        return arcIntersectsSelection(
            geometry,
            selectionBox
        );
    }

    /*
     * A rigid body of any other shape: a circle or a polygon.
     * The outline is tested, and so is containment the other
     * way round, so a small selection inside a big body
     * still finds it.
     */
    if (object.type === "rigid-body") {
        const shape =
            enggFeatureGeometry.rigidBodyShape(
                geometry
            );

        const outline =
            enggFeatureGeometry.definingPoints(
                geometry,
                shape
            );

        if (
            polylineIntersectsSelection(
                [
                    ...outline,
                    outline[0]
                ],
                selectionBox
            )
        ) {
            return true;
        }

        return outline.some(
            point =>
                pointInsideSelection(
                    point,
                    selectionBox
                )
        );
    }

    /*
     * AN ANALYSIS OBJECT IS ONE THING, BOX-SELECTED AS ONE THING.
     *
     * A Force Components and a Resultant were reaching the fallback below,
     * which asks whether any point they are drawn through lies inside the
     * rectangle. A vector drawn horizontally passes through two points and
     * a great many positions between them, so a box drawn around a
     * resultant's middle - which is where a student naturally drags from -
     * found nothing at all, and the feature could be clicked but not swept
     * up.
     *
     * They are tested on their VECTORS, the same way a Point Force is
     * tested on its arrow, and deliberately not on the source force's
     * shared arrow for the reason given in `analysisObjectHit`: that ink
     * belongs to the force, and a box drawn over it should take the force.
     */
    if (
        object.type === "force-components" ||
        object.type === "resultant"
    ) {
        const vectors =
            object.type === "force-components"
                ? [
                      geometry.horizontal,
                      geometry.vertical
                  ]
                : [
                      geometry.start && geometry.end
                          ? {
                                start: geometry.start,
                                end: geometry.end
                            }
                          : null
                  ];

        return vectors
            .filter(Boolean)
            .some(
                vector =>
                    segmentIntersectsSelection(
                        vector.start,
                        vector.end,
                        selectionBox
                    )
            );
    }

    /*
     * ========================================================
     * AN ANALYSIS DIAGRAM: TEST ITS INK, IN WORLD COORDINATES
     * ========================================================
     *
     * The three diagrams - SFD, BMD and AFD - are ONE type,
     * `analysis-diagram`, told apart by `geometry.diagramType`. So they are
     * covered by one case, and they behave identically: that is the requirement
     * that the three must not be three implementations.
     *
     * WHAT IS TESTED IS WHAT IS DRAWN. A sketched diagram is projected by
     * `analysisSketchMarks`, and a plotted one by `analysisPlotMarks` - the
     * SAME functions the renderer draws from - so a rectangle drawn over the
     * ink covers the ink.
     *
     * TESTING THE RAW STORED POINTS IS THE DEFECT THIS FIXES. A sketch element
     * holds GRAPH-LOCAL numbers (a station and a value), not points on the
     * sheet, so a box over a curve compared with numbers that are not where the
     * curve is found nothing at all - which is why a student could click a
     * diagram but never sweep one up.
     */
    if (object.type === "analysis-diagram") {
        return diagramMarks(geometry).some(mark =>
            polylineIntersectsSelection(mark.points, selectionBox)
        );
    }

    /*
     * AN ANNOTATE FEATURE: ITS OWN DRAWN FORM.
     *
     * A leader, a callout and an arrow are LINES with text at one end, so a box
     * that crosses the pen must take the feature even when the words are
     * outside it - which is what a student drawing a rectangle around a leader
     * means. A note, a symbol, a tolerance and a table are drawn at a point, so
     * their own extent is the test.
     *
     * The annotation model owns where each kind is drawn, so this asks it
     * rather than re-deriving the shapes here.
     */
    if (object.type === "annotate") {
        const line =
            geometry.start && geometry.end
                ? segmentIntersectsSelection(
                      geometry.start,
                      geometry.end,
                      selectionBox
                  )
                : false;

        if (line) {
            return true;
        }

        return annotateExtent(object).some(point =>
            pointInsideSelection(point, selectionBox)
        );
    }

    /*
     * A LEGACY ANNOTATION (a derived magnitude label): selected where its box
     * touches the rectangle, measured from the placement its own model gives.
     */
    if (object.type === "annotation") {
        return annotationBoxIntersectsSelection(object, selectionBox);
    }

    /*
     * A DIMENSION: the lines it is drawn with, plus its own text.
     *
     * `graphicsFor` is the one place that says where a dimension draws - the
     * renderer and the drag both read it - so a rectangle tested against it
     * covers what the student sees, for a linear dimension, an angle and a
     * radius alike, without a case for each.
     */
    if (object.type === "dimension") {
        return dimensionIntersectsSelection(object, selectionBox);
    }

    /*
     * Anything else: it is selected if any of the points the
     * object is drawn through is in the rectangle. That is the
     * same generous test the Feature Tree relies on, and it is
     * what keeps a feature with no special case from becoming
     * unselectable.
     */
        return objectPoints(
            object
        ).some(
            point =>
                pointInsideSelection(
                    point,
                    selectionBox
                )
        );
    }

    /*
     * THE PREVIOUS NAME, KEPT AS AN ALIAS.
     *
     * Any module or saved script that reached for the dispatcher under the old name
     * keeps working. It is a thin forwarder rather than a second copy, so the two
     * names can never drift into two behaviours.
     */
    export const coordinateSystemIntersectsSelection =
        objectIntersectsSelection;

/*
 * Whether any part of a distributed load's arrow field meets
 * the rectangle.
 *
 * The arrows stand off the body in the load's own direction, so
 * a rectangle can catch an arrow while missing the body line
 * entirely. The arrows are rendering, not features, so what is
 * tested here is the same field the renderer draws.
 */
function distributedLoadArrowsIntersect(
    geometry,
    selectionBox
) {
    if (
        !geometry ||
        typeof enggLoadProfile ===
            "undefined"
    ) {
        return false;
    }

    const samples =
        enggLoadProfile.arrowSamples(
            geometry
        );

    if (!samples.length) {
        return false;
    }

    const peak =
        enggLoadProfile.peakMagnitude(
            geometry
        );

    if (peak <= 0) {
        return false;
    }

    const direction =
        enggLoadProfile.unitVector(
            enggLoadProfile.loadDirection(
                geometry
            )
        );

    /*
     * The same screen length a drawn arrow reaches, so the
     * test region matches the ink on the canvas at any zoom.
     */
    const reach =
        distributedLoadArrowScreenLength(
            peak,
            enggDrawingState
                .BASE_PIXELS_PER_UNIT *
                (drawingState?.camera?.zoom || 1)
        );

    return samples.some(sample => {
        const tip = {
            x:
                sample.base.x +
                direction.x * reach,
            y:
                sample.base.y +
                direction.y * reach
        };

        return segmentIntersectsSelection(
            sample.base,
            tip,
            selectionBox
        );
    });
}

/*
 * The screen length a distributed load's longest arrow is
 * drawn at.
 *
 * The renderer and the selection test both read it, which is
 * what keeps "what you can select" and "what you can see" the
 * same set of pixels.
 *
 * It follows the arrow's own rule: the magnitude in world units
 * converted at the current zoom. It used to be a fixed ceiling,
 * which meant that once a load was large enough to hit that
 * ceiling the selection test and the fit bounds both stopped
 * growing with the drawing, and a heavier load became impossible
 * to select in the part of its field that had grown past it.
 */
export function distributedLoadArrowScreenLength(
    magnitude,
    scale
) {
    const world = Math.max(
        Math.abs(Number(magnitude) || 0),
        0
    );

    if (world <= 0) {
        return 0;
    }

    return world * Math.max(scale, 1e-6);
}

/*
 * ========================================================
 * THE STROKES A DIAGRAM DRAWS, IN WORLD COORDINATES
 * ========================================================
 *
 * A sketched diagram's strokes come from the renderer's `analysisSketchMarks`
 * and a plotted one's from `analysisPlotMarks` - the very functions the sheet
 * draws with - so selection and rendering are one geometry, not two.
 *
 * Every mark is normalised to `{ points: [...] }` here, because a plot mark may
 * be a curve (many points) or a vertical line (two), and the intersection test
 * only cares about the polyline either way.
 */
function diagramMarks(geometry) {
    const renderer = enggDrawingRenderer;

    if (!renderer) {
        return [];
    }

    const marks =
        geometry?.mode === "plot"
            ? renderer.analysisPlotMarks?.(geometry) || []
            : renderer.analysisSketchMarks?.(geometry) || [];

    const normalised = marks
        .map((mark) => ({
            points: mark.points
                ? mark.points
                : [mark.from, mark.to],
        }))
        .filter(
            (mark) =>
                Array.isArray(mark.points) &&
                mark.points.length >= 2
        );

    /*
     * A DIAGRAM WITH NOTHING DRAWN IS STILL A FRAME.
     *
     * An empty SFD draws its axis and its frame - the box the student is about
     * to sketch in - so a rectangle over that box has clearly touched the
     * feature. Returning nothing for it meant an empty diagram was the one thing
     * on the sheet that no selection rectangle could reach, which reads as the
     * tool being broken rather than as there being nothing selected.
     *
     * The frame is asked of the SAME function the renderer lays it out with, so
     * the region tested is the region drawn.
     */
    if (!normalised.length) {
        const frame = diagnosticFrame(geometry, renderer);

        return frame ? [{ points: frame }] : [];
    }

    return normalised;
}

/*
 * The four corners of a diagram's frame, or null when it has none.
 *
 * `analysisFrameExtents()` is the renderer's own statement of the frame's
 * shape - read with NO arguments, because it describes the frame rather than a
 * particular diagram. Its numbers are SCREEN PIXELS either side of the axis,
 * so they are divided by the world-to-screen scale here to become drawing units
 * - which is what keeps the tested region the same physical box at any zoom.
 */
function diagnosticFrame(geometry, renderer) {
    if (
        typeof renderer.analysisFrameExtents !== "function" ||
        !geometry?.start ||
        !geometry?.end
    ) {
        return null;
    }

    let extents;

    try {
        extents = renderer.analysisFrameExtents();
    } catch (error) {
        return null;
    }

    if (!extents) {
        return null;
    }

    /*
     * The frame's half-height, in world units. `bottom` is the positive one -
     * see the note on the function itself - and falls back to `top` so a shape
     * that reports only one of them still contributes.
     */
    const halfPx = Math.abs(
        Number(extents.bottom ?? extents.top),
    );

    const scale =
        enggDrawingState.BASE_PIXELS_PER_UNIT *
        (drawingState?.camera?.zoom || 1);

    const half = halfPx / Math.max(scale, 1e-6);

    if (!Number.isFinite(half) || half <= 0) {
        return null;
    }

    return [
        { x: geometry.start.x, y: geometry.start.y + half },
        { x: geometry.end.x, y: geometry.end.y + half },
        { x: geometry.end.x, y: geometry.end.y - half },
        { x: geometry.start.x, y: geometry.start.y - half },
        { x: geometry.start.x, y: geometry.start.y + half },
    ];
}

/*
 * THE POINTS THAT BOUND AN ANNOTATE FEATURE.
 *
 * A point-placed kind has one (its placement); a geometric kind has its two
 * ends. The text box is deliberately NOT measured here - the anchor is what a
 * student aims a rectangle at, and measuring a text box would make a small mark
 * claim a screen-sized region.
 */
function annotateExtent(object) {
    const geometry = object?.geometry || {};

    return [geometry.position, geometry.start, geometry.end].filter(
        (point) =>
            point &&
            Number.isFinite(point.x) &&
            Number.isFinite(point.y)
    );
}

/*
 * WHETHER A LEGACY ANNOTATION'S BOX MEETS THE RECTANGLE.
 *
 * The annotation model says where the text sits and how big it is, so its own
 * `annotationTextBounds` is used rather than a second estimate - the same
 * bounds the hit test uses, which is what keeps a click and a rectangle
 * agreeing about how much room a label takes.
 */
function annotationBoxIntersectsSelection(object, selectionBox) {
    const model = enggAnnotationModel;

    if (!model?.annotationTextBounds) {
        return false;
    }

    let bounds;

    try {
        bounds = model.annotationTextBounds(object, drawingState);
    } catch (error) {
        bounds = null;
    }

    if (!bounds) {
        return Boolean(
            object.placement &&
                pointInsideSelection(object.placement, selectionBox)
        );
    }

    /* Two axis-aligned boxes overlap unless one is wholly to a side. */
    return !(
        bounds.maxX < selectionBox.minX ||
        bounds.minX > selectionBox.maxX ||
        bounds.maxY < selectionBox.minY ||
        bounds.minY > selectionBox.maxY
    );
}

/*
 * WHETHER A DIMENSION MEETS THE RECTANGLE.
 *
 * A dimension is drawn as extension lines, an arc or a line, and a text frame -
 * and `graphicsFor` is the one place that says where each of those goes. So the
 * graphics are read and each drawn LINE is tested, plus the text frame.
 */
function dimensionIntersectsSelection(object, selectionBox) {
    const model = enggDimensionModel;

    if (!model?.graphicsFor) {
        return Boolean(
            object.placement &&
                pointInsideSelection(object.placement, selectionBox)
        );
    }

    let graphics;

    try {
        graphics = model.graphicsFor(object, drawingState);
    } catch (error) {
        graphics = null;
    }

    if (!graphics) {
        return Boolean(
            object.placement &&
                pointInsideSelection(object.placement, selectionBox)
        );
    }

    const segments = dimensionSegments(graphics);

    if (
        segments.some(([start, end]) =>
            segmentIntersectsSelection(start, end, selectionBox)
        )
    ) {
        return true;
    }

    /*
     * THE TEXT ITSELF, so a rectangle drawn over "125 mm" takes the dimension
     * even when it misses the extension lines - which is the commonest way a
     * student selects a dimension they can only partly see.
     */
    const frame = graphics.textFrame;

    if (frame) {
        const corners = [
            { x: frame.minX, y: frame.minY },
            { x: frame.maxX, y: frame.minY },
            { x: frame.maxX, y: frame.maxY },
            { x: frame.minX, y: frame.maxY },
        ].filter(
            (corner) =>
                Number.isFinite(corner.x) &&
                Number.isFinite(corner.y)
        );

        if (corners.length === 4) {
            if (corners.some((c) => pointInsideSelection(c, selectionBox))) {
                return true;
            }

            /* Or the whole frame swallows the rectangle. */
            if (
                frame.minX <= selectionBox.minX &&
                frame.maxX >= selectionBox.maxX &&
                frame.minY <= selectionBox.minY &&
                frame.maxY >= selectionBox.maxY
            ) {
                return true;
            }
        }
    }

    return false;
}

/*
 * The line segments a dimension's graphics describe.
 *
 * `graphicsFor` returns different shapes for different dimension types - an
 * angular dimension has an `arc` and `extensions`, a radial one has a `line`,
 * a linear one has `line` and `extensionLines`. Rather than a branch per type,
 * every array of point pairs is collected, which covers each of them and any
 * type added later.
 */
function dimensionSegments(graphics) {
    const segments = [];

    const addPath = (path) => {
        if (!Array.isArray(path) || path.length < 2) {
            return;
        }

        for (let index = 1; index < path.length; index += 1) {
            const start = path[index - 1];
            const end = path[index];

            if (
                start &&
                end &&
                Number.isFinite(start.x) &&
                Number.isFinite(end.x)
            ) {
                segments.push([start, end]);
            }
        }
    };

    addPath(graphics.line);
    addPath(graphics.arc);

    [graphics.extensions, graphics.extensionLines, graphics.witnessLines]
        .filter(Array.isArray)
        .forEach((group) =>
            group.forEach((entry) => {
                if (Array.isArray(entry)) {
                    addPath(entry);
                }
            })
        );

    return segments;
}
