/*
 * Hit-testing: which feature is under the pointer.
 */

import enggFeatureGeometry from "../core/geometry/feature-geometry.js";
import { cylinderPoint, isPistonCylinder, pistonFraction } from "../features/thermodynamics/piston-cylinder.js";
import { coordinateSystemArms } from "../core/geometry/feature-handles.js";
import enggDrawingState from "../core/model/drawing-state.js";
import enggAnalysisDependencies from "../features/analysis/analysis-dependencies.js";
import enggLoadProfile from "../features/analysis/load-profile.js";
import enggDrawingRotationalArrow from "../features/analysis/rotational-arrow.js";
import enggAnnotationModel from "../features/annotations/annotation-model.js";
import enggAnnotate from "../features/annotations/annotate-model.js";
import enggDimensionModel from "../features/dimensions/dimension-model.js";
import { distance, distanceToSegment } from "../core/geometry/points.js";

/*
 * THE POINT PRIMITIVES ARE RE-EXPORTED, NOT RE-DEFINED.
 *
 * `distanceToSegment` and `distance` live in core/geometry/points.js. Both
 * used to be written out here AND in dimension-inference AND in the sketch
 * editor, which is three copies of one clamp - and three chances for a hit
 * test and a snap to disagree about whether a click landed on a line.
 *
 * They are re-exported so the modules that already import them from THIS file
 * keep working; the import above is what makes them usable inside it as well,
 * since a re-export does not bring a name into scope.
 */
export { distance, distanceToSegment };
import { drawingCanvas } from "./dom.js";
import { COORDINATE_SYSTEM_TYPE } from "./constants.js";
import { axisLabelPositions } from "../core/geometry/axis-labels.js";
import { drawingState } from "./editor-state.js";
import { isLoadGeometry } from "./relative-coordinates.js";
import { momentDirectionOf } from "./statics-panel.js";
import { isConnectionType, isSupportType } from "../core/model/feature-types.js";

/*
 * The distance from a point to a closed outline.
 *
 * A body made of corners is picked as one shape, so the
 * test is against its whole outline rather than against a
 * single stored anchor point.
 */
function distanceToPolygon(
    point,
    corners
) {
    if (
        !Array.isArray(corners) ||
        corners.length < 2
    ) {
        return Infinity;
    }

    return corners.reduce(
        (nearest, corner, index) => {
            const next =
                corners[
                    (index + 1) %
                        corners.length
                ];

            return Math.min(
                nearest,
                distanceToSegment(
                    point,
                    corner,
                    next
                )
            );
        },
        Infinity
    );
}

/*
 * A rigid body stores the same shape as a rectangle, so
 * every shared rectangle path can treat the two alike.
 * This keeps one geometry implementation rather than a
 * parallel set of rigid-body branches.
 */
export function isRectangleLike(
    object
) {
    return Boolean(
        object &&
        (object.type === "rectangle" ||
            object.type === "rigid-body")
    );
}

/*
 * Is a point on an annotation's words?
 *
 * An annotation has no geometry, so it cannot be picked by proximity to
 * a shape. It is picked the way a reader picks text: by whether the
 * pointer is on the words themselves.
 *
 * The box is worked out from the text the annotation actually shows -
 * asked of the annotation model, so it matches what is drawn, and works
 * before the first render as well as after - and from the font size and
 * line height the renderer uses. A generous margin is added because
 * text is hard to hit with a pointer and a label that cannot be grabbed
 * is a label that cannot be moved, which is the one thing the student
 * most needs to do with it.
 */
function annotationContainsPoint(
    object,
    point
) {
    const placement =
        object.placement;

    if (
        !placement ||
        !Number.isFinite(placement.x) ||
        !Number.isFinite(placement.y)
    ) {
        return false;
    }

    if (object.visible === false) {
        return false;
    }

    const text =
        annotationTextOf(object) || "";

    const fontSize =
        Number(object.style?.fontSize) || 12;

    const lines = String(text)
        .split("\n")
        .filter((line) => line.length > 0);

    if (lines.length === 0) {
        return false;
    }

    const lineHeight = fontSize * 1.2;

    const widest = Math.max(
        ...lines.map((line) => line.length)
    );

    const halfWidth =
        (widest * fontSize * 0.58) / 2 +
        fontSize * 0.5;

    const halfHeight =
        (lines.length * lineHeight) / 2 +
        fontSize * 0.35;

    return (
        Math.abs(point.x - placement.x) <= halfWidth &&
        Math.abs(point.y - placement.y) <= halfHeight
    );
}

/*
 * The text an annotation currently shows.
 *
 * Delegated to the annotation model, which resolves a generated label
 * from its feature and returns a note's own wording. Read here rather
 * than from `object.text`, because for a generated label that field is
 * deliberately empty - the text is derived, and using the stored field
 * would hit-test against nothing at all.
 */
function annotationTextOf(
    object
) {
    try {
        return (
            enggAnnotationModel.textFor(
                object,
                drawingState
            ) || object.text || ""
        );
    } catch (error) {
        return object.text || "";
    }
}

/*
 * ========================================================
 * AN ANNOTATE FEATURE, BY ITS DRAWN FORM
 * ========================================================
 *
 * A note is picked on its words, like a legacy annotation. A LEADER, an
 * ARROW and a TABLE are picked on their LINES as well, because a mark that
 * is mostly a line must be grabbable anywhere along it - a student aiming
 * at a leader's stem means the leader, not the paragraph at its end.
 *
 * The tolerance is a few screen pixels converted to drawing units, so the
 * pick target is the same physical size at any zoom, and it is SMALL: a
 * tight box around what is drawn, never a huge region that a tiny mark
 * would claim (spec 62).
 */
function annotateContainsPoint(object, point) {
    if (object.visible === false) {
        return false;
    }

    const geometry = object.geometry || {};

    const tolerance =
        ANNOTATE_PICK_TOLERANCE_PIXELS /
        Math.max(drawingState.camera.zoom, 0.25);

    /*
     * THE WORDS. Every kind has a text box at a placement - the note's
     * prose, a label's tag, a symbol's glyph, a tolerance's value, a
     * callout's box. A kind with no text (an arrow, a bare table) simply
     * matches nothing here and falls through to its geometry.
     */
    const text = annotateTextOf(object);

    const anchor =
        geometry.position ||
        geometry.end ||
        geometry.start;

    if (text && anchor) {
        const fontSize =
            Number(object.style?.fontSize) || 12;

        const lines = String(text)
            .split("\n")
            .filter((line) => line.length > 0);

        if (lines.length) {
            const lineHeight = fontSize * 1.2;

            const widest = Math.max(
                ...lines.map((line) => line.length)
            );

            const halfWidth =
                (widest * fontSize * 0.58) / 2 +
                fontSize * 0.5;

            const halfHeight =
                (lines.length * lineHeight) / 2 +
                fontSize * 0.35;

            if (
                Math.abs(point.x - anchor.x) <= halfWidth &&
                Math.abs(point.y - anchor.y) <= halfHeight
            ) {
                return true;
            }
        }
    }

    /*
     * THE LINE. A leader, a callout's stem and an arrow are grabbed along
     * their length, within the pick tolerance.
     */
    if (geometry.start && geometry.end) {
        if (
            distanceToSegment(
                point,
                geometry.start,
                geometry.end
            ) <= tolerance
        ) {
            return true;
        }
    }

    /*
     * A TABLE'S GRID. Its box is rows x columns cells, so the pick is the
     * whole rectangle the drawn table occupies.
     */
    if (object.annotateKind === "table" && geometry.position) {
        const width = enggAnnotate.tableWidthOf(object);
        const height = enggAnnotate.tableHeightOf(object);

        const withinX =
            point.x >= geometry.position.x - tolerance &&
            point.x <= geometry.position.x + width + tolerance;

        const withinY =
            point.y >= geometry.position.y - tolerance &&
            point.y <= geometry.position.y + height + tolerance;

        if (withinX && withinY) {
            return true;
        }
    }

    /*
     * A POINT-PLACED MARK WITH NO TEXT - a bare dot or crosshair. Picked
     * within the same small tolerance of its anchor.
     */
    if (anchor && !text) {
        return distance(point, anchor) <= tolerance;
    }

    return false;
}

/*
 * The text an annotate feature shows, from the model so a symbol's glyph or
 * a tolerance's value is what is measured rather than a stored field.
 */
function annotateTextOf(object) {
    try {
        return enggAnnotate.textOf(object) || object.text || "";
    } catch (error) {
        return object.text || "";
    }
}

/*
 * A tight pick tolerance in SCREEN pixels, converted to drawing units at
 * the call site so it does not vary with zoom.
 */
const ANNOTATE_PICK_TOLERANCE_PIXELS = 6;

/*
 * The feature a targeted annotate tool would attach to, under the pointer.
 *
 * A thin wrapper over the shared hit test, kept here so the creation layer
 * does not reach into the model directly and so "what can a label name"
 * has one answer: whatever the ordinary pick finds, minus the annotations
 * themselves (an annotation is not a feature to hang another off).
 */
export function hitTestAnnotateTarget(point) {
    const object = objectAtPoint(point);

    if (!object) {
        return null;
    }

    if (
        object.type === "annotate" ||
        object.type === "annotation" ||
        object.type === "dimension"
    ) {
        return null;
    }

    return object;
}

/*
 * Is a point on a dimension's drawn graphics?
 *
 * The same reasoning as an annotation, for the same reason: a dimension
 * is a measurement plus a presentation, and the presentation - its
 * dimension line, its text, its witness lines - is what the student
 * aims at when they want to move it.
 *
 * The extent is taken from the dimension's own graphics, so the hit area
 * is exactly the marks on the drawing rather than a box guessed at here.
 */
function dimensionContainsPoint(
    object,
    point,
    tolerancePixels = DIMENSION_PICK_TOLERANCE_PIXELS
) {
    const graphics =
        safeDimensionGraphics(object);

    if (!graphics) {
        return false;
    }

    /*
     * A GENEROUS, INVISIBLE TARGET.
     *
     * Every mark a dimension draws is reachable: the dimension line,
     * the arrowheads at its ends, the witness lines running back to the
     * geometry, the arc of an angular dimension, and the text itself.
     * A student aims at whichever of those they can see, so whichever
     * they aim at has to be pickable.
     *
     * The tolerance is in SCREEN pixels divided by zoom, so it stays
     * the same physical size on the glass at any magnification - and
     * it affects only this test. Nothing is drawn any thicker.
     */
    const tolerance =
        tolerancePixels /
        Math.max(
            drawingState.camera.zoom,
            0.25
        );

    /*
     * The dimension LINE: the main thing a student aims at, and the
     * one that reads as "the dimension" rather than as its number.
     */
    if (
        graphics.line &&
        distanceToSegment(
            point,
            graphics.line[0],
            graphics.line[1]
        ) <= tolerance
    ) {
        return true;
    }

    /*
     * The TEXT, so the number can be grabbed as well as the line.
     */
    if (
        graphics.textFrame &&
        distanceToSegment(
            point,
            graphics.textFrame,
            graphics.textFrame
        ) <= tolerance
    ) {
        return true;
    }

    /*
     * The ARC, for an angular dimension, which has no straight line.
     */
    if (
        Array.isArray(graphics.arc) &&
        graphics.arc.length > 1
    ) {
        for (
            let i = 1;
            i < graphics.arc.length;
            i += 1
        ) {
            if (
                distanceToSegment(
                    point,
                    graphics.arc[i - 1],
                    graphics.arc[i]
                ) <= tolerance
            ) {
                return true;
            }
        }
    }

    /*
     * WITNESS LINES last: they are thin and dashed, so claiming them
     * before the line and the text would make the label's edges steal
     * clicks meant for the feature it describes.
     */
    return (graphics.extensions || []).some(
        ([from, to]) =>
            from &&
            to &&
            distanceToSegment(point, from, to) <= tolerance
    );
}

/*
 * A dimension's graphics, or null if it cannot be drawn.
 *
 * A dimension whose source has been deleted, or whose measurement
 * cannot be resolved, has no graphics. It must be unpickable rather
 * than throwing during a hit test.
 */
export function safeDimensionGraphics(
    object
) {
    try {
        return (
            enggDimensionModel.graphicsFor(
                object,
                drawingState
            ) || null
        );
    } catch (error) {
        return null;
    }
}

export function objectAtPoint(
    point
) {
    const tolerance =
        4 /
        Math.max(
            drawingState.camera.zoom,
            0.25
        );

    /*
     * DIMENSIONS AND ANNOTATIONS ARE PICKED FIRST.
     *
     * A dimension and an annotation are drawn ON TOP of the geometry
     * they describe - a dimension line runs above a beam, its witness
     * lines touch it, its text sits across the middle of it. Deciding
     * the pick by draw order alone means clicking "125 mm" can select
     * the beam underneath, which is never what the student meant: they
     * aimed at the number.
     *
     * So they are tested first, as a class. If one is under the
     * pointer it wins outright, and only if none is does the ordinary
     * geometry scan run.
     *
     * A deliberate departure from z-order, and confined to this pair of
     * types: among dimensions and annotations themselves normal draw
     * order still decides, so overlapping labels behave as they look.
     */
    const overlay =
        pickDerivedMagnitude(point) ||
        pickDimensionOrAnnotation(point);

    if (overlay) {
        return overlay;
    }

    return [
        ...drawingState.objects
    ]
        .reverse()
        .find(
            object => {
                const geometry =
                    object.geometry;

                /*
                 * AN ANNOTATION IS HIT BY ITS TEXT, not by geometry.
                 *
                 * Every other feature is found by how close the pointer
                 * is to its shape, which is right for a shape and wrong
                 * for a piece of writing: an annotation has no geometry
                 * at all, so the proximity tests below never match it
                 * and a label the student has just placed cannot be
                 * clicked to select, dragged, or edited.
                 *
                 * So the test is the question a reader asks - is the
                 * pointer on the words? - measured against the box the
                 * annotation's own text occupies, at the position it
                 * actually sits.
                 *
                 * Measured from the annotation model rather than from
                 * the DOM so the hit area cannot drift from what is
                 * drawn, and so it works the same before and after the
                 * first render.
                 */
                if (
                    object.type === "annotation"
                ) {
                    return (
                        annotationContainsPoint(
                            object,
                            point
                        )
                    );
                }

                /*
                 * AN ANNOTATE FEATURE IS HIT BY ITS OWN DRAWN FORM - a
                 * text box, a leader line, an arrow, a symbol, a table's
                 * grid - so the test is the one the renderer uses, read
                 * from the model. A leader is caught by the pen, not only
                 * by the words at the end of it, because grabbing a leader
                 * anywhere along it is what a CAD user expects.
                 */
                if (
                    object.type === "annotate"
                ) {
                    return annotateContainsPoint(
                        object,
                        point
                    );
                }

                if (
                    object.type === "dimension"
                ) {
                    return (
                        dimensionContainsPoint(
                            object,
                            point
                        )
                    );
                }

                if (
                    object.type ===
                    "coordinate-system-2d"
                ) {
                    /*
                     * The coordinate system is one feature, so
                     * clicking any of its four arms or its
                     * origin selects that single feature.
                     */
                    if (!geometry.origin) {
                        return false;
                    }

                    return (
                        distance(
                            point,
                            geometry.origin
                        ) <=
                            tolerance * 2 ||
                        coordinateSystemArms(
                            geometry
                        ).some(
                            arm =>
                                distanceToSegment(
                                    point,
                                    arm.start,
                                    arm.end
                                ) <= tolerance
                        )
                    );
                }

                /*
                 * A Point Force is a vector, so it is picked
                 * along the arrow rather than only at its
                 * application point. Clicking anywhere on
                 * the arrow selects the one force, never a
                 * piece of it.
                 */
                if (object.type === "force") {
                    return (
                        (geometry.start &&
                            geometry.end &&
                            distanceToSegment(
                                point,
                                geometry.start,
                                geometry.end
                            ) <= tolerance) ||
                        (geometry.start &&
                            distance(
                                point,
                                geometry.start
                            ) <=
                                tolerance * 2)
                    );
                }

                /*
                 * A rigid body is a shape, so it is picked
                 * anywhere inside or on its outline rather
                 * than only at its position anchor. The test
                 * follows whichever shape the body currently
                 * has, so a circular or triangular body is as
                 * easy to click as a rectangular one.
                 */
                if (isRectangleLike(object)) {
                    return (
                        distanceToPolygon(
                            point,
                            enggFeatureGeometry.definingPoints(
                                geometry,
                                object.type ===
                                    "rigid-body"
                                    ? enggFeatureGeometry
                                          .rigidBodyShape(geometry)
                                    : "rectangle"
                            )
                        ) <= tolerance
                    );
                }

                /*
                 * A Moment is a curved arrow, so it is picked along its
                 * curve.
                 */
                if (object.type === "moment") {
                    return rotationalArrowHit(
                        object,
                        point,
                        tolerance
                    );
                }

                if (
                    object.type ===
                        "support" ||
                    object.type ===
                        "body" ||
                    object.type ===
                        "particle" ||
                    isSupportType(object.type)
                ) {
                    /*
                     * These act at a point, so they are
                     * picked at their position with the same
                     * generous radius as a point.
                     */
                    return (
                        geometry.position &&
                        distance(
                            point,
                            geometry.position
                        ) <=
                            tolerance * 2
                    );
                }

                /*
                 * A DISTRIBUTED LOAD IS A FIELD, AND THE FIELD IS WHAT
                 * YOU AIM AT.
                 *
                 * Neither load is picked at its two stored points, because
                 * almost none of a load's ink is near them: the arrows
                 * stand off the body along its normal and the envelope
                 * closes over the top of them. A load drawn as a row of
                 * arrows is a large, obvious target, and a student clicking
                 * the middle of it - which is where the envelope is - got
                 * the beam behind instead.
                 *
                 * Both branches read the SAME test out of the load module
                 * that the renderer draws from, so what is clickable is
                 * exactly what is visible at the current zoom and Vector
                 * Scale. Testing the arrows here without the envelope would
                 * fix half of it and leave the more obvious half broken.
                 *
                 * The varying load is included because it is the same
                 * picture: a row of arrows and an envelope, drawn from the
                 * same profile, and it was falling through to a test for
                 * `start` and `end` that it does not have.
                 */
                if (isLoadGeometry(object)) {
                    return (
                        enggLoadProfile.loadContainsPoint(
                            geometry,
                            point,
                            tolerance,
                            enggDrawingState
                                .BASE_PIXELS_PER_UNIT *
                                drawingState.camera.zoom,
                            enggLoadProfile
                                .vectorScaleFor(
                                    drawingState
                                )
                        )
                    );
                }

                if (isConnectionType(object.type)) {
                    return (
                        geometry.start &&
                        geometry.end &&
                        distanceToSegment(
                            point,
                            geometry.start,
                            geometry.end
                        ) <= tolerance
                    );
                }

                if (
                    object.type === "load" ||
                    object.type === "varying-load" ||
                    object.type === "beam" ||
                    object.type === "cable" ||
                    object.type === "shaft"
                ) {
                    /*
                     * Spans are picked along their length,
                     * like a line. For a load this means any
                     * of its rendered arrows selects the one
                     * distributed load.
                     */
                    return (
                        geometry.start &&
                        geometry.end &&
                        distanceToSegment(
                            point,
                            geometry.start,
                            geometry.end
                        ) <= tolerance
                    );
                }

                /*
                 * A truss the student built is picked on any of
                 * its own members, so clicking a joint or a web
                 * member selects the one Truss. Its members are
                 * rendering of that feature and are never
                 * selectable on their own.
                 */
                if (
                    object.type === "truss" &&
                    Array.isArray(geometry.members) &&
                    geometry.members.length
                ) {
                    return geometry.members.some(
                        member =>
                            distanceToSegment(
                                point,
                                member.start,
                                member.end
                            ) <= tolerance
                    );
                }

                if (object.type === "truss") {
                    return (
                        geometry.start &&
                        geometry.end &&
                        distanceToSegment(
                            point,
                            geometry.start,
                            geometry.end
                        ) <= tolerance
                    );
                }

                if (
                    object.type ===
                    "point"
                ) {
                    /*
                     * A point has no extent, so allow a
                     * slightly wider pick radius than a
                     * line so it stays easy to click.
                     */
                    return (
                        distance(
                            point,
                            geometry.position ||
                                geometry.point ||
                                geometry
                        ) <=
                        tolerance * 2
                    );
                }

                if (
                    object.type ===
                    "line"
                ) {
                    return (
                        distanceToSegment(
                            point,
                            geometry.start,
                            geometry.end
                        ) <=
                        tolerance
                    );
                }

                if (
                    object.type ===
                    "circle"
                ) {
                    return (
                        Math.abs(
                            distance(
                                point,
                                geometry.center
                            ) -
                            geometry.radius
                        ) <=
                        tolerance
                    );
                }

                if (isPistonCylinder(object)) {
                    const level = pistonFraction(geometry);
                    const local = (x, y) => cylinderPoint(geometry, x, y);
                    const segments = [
                        [local(0, 1), local(0, 0)],
                        [local(0, 0), local(1, 0)],
                        [local(1, 0), local(1, 1)],
                        [local(0, level), local(1, level)],
                        [local(0, level - 0.04), local(1, level - 0.04)],
                        [local(0.5, level), local(0.5, 1)]
                    ];
                    return segments.some(([start, end]) => distanceToSegment(point, start, end) <= tolerance);
                }

                if (
                    isRectangleLike(
                        object
                    )
                ) {
                    const left =
                        geometry.position.x;

                    const right =
                        left +
                        geometry.width;

                    const top =
                        geometry.position.y;

                    const bottom =
                        geometry.position.y -
                        geometry.height;

                    const nearHorizontal =
                        point.x >=
                            left -
                            tolerance &&

                        point.x <=
                            right +
                            tolerance &&

                        (
                            Math.abs(
                                point.y -
                                top
                            ) <=
                            tolerance ||

                            Math.abs(
                                point.y -
                                bottom
                            ) <=
                            tolerance
                        );

                    const nearVertical =
                        point.y >=
                            bottom -
                            tolerance &&

                        point.y <=
                            top +
                            tolerance &&

                        (
                            Math.abs(
                                point.x -
                                left
                            ) <=
                            tolerance ||

                            Math.abs(
                                point.x -
                                right
                            ) <=
                            tolerance
                        );

                    /*
                     * SELECTED BY ITS EDGES, NOT BY ITS INTERIOR.
                     *
                     * The four sides were already tested above; the extra
                     * point-in-polygon clause made the whole rectangle a
                     * clickable SURFACE, so a line drawn inside it could never
                     * be reached - the rectangle swallowed every click within
                     * its perimeter.
                     *
                     * DAETUM has no Fill tool, so a rectangle is a collection of
                     * edges rather than a filled region, and selection must
                     * follow what is actually drawn. Removing the clause is
                     * what lets inner geometry be selected through the shape.
                     */
                    return (
                        nearHorizontal ||
                        nearVertical
                    );
                }

                if (
                    object.type ===
                        "reference-axis-x-positive" ||
                    object.type ===
                        "reference-axis-x-negative" ||
                    object.type ===
                        "reference-axis-y-positive" ||
                    object.type ===
                        "reference-axis-y-negative"
                ) {
                    /*
                     * Each axis is hit-tested on its own line
                     * segment, so clicking one axis selects
                     * only that axis.
                     */
                    const origin =
                        geometry.origin;

                    if (!origin) {
                        return false;
                    }

                    const length =
                        Number(geometry.axisLength) || 25;

                    const direction =
                        geometry.direction || {
                            x: 1,
                            y: 0
                        };

                    return (
                        distanceToSegment(
                            point,
                            origin,
                            {
                                x:
                                    origin.x +
                                    direction.x * length,

                                y:
                                    origin.y +
                                    direction.y * length
                            }
                        ) <= tolerance
                    );
                }

                if (
                    object.type ===
                    "polygon"
                ) {
                    /*
                     * Hit-test the real edges derived from
                     * the polygon definition, so clicking
                     * any side selects the whole feature.
                     */
                    const vertices =
                        enggDrawingState.polygonVertices(
                            geometry
                        );

                    if (vertices.length < 3) {
                        return false;
                    }

                    return vertices.some(
                        (
                            vertex,
                            index
                        ) =>
                            distanceToSegment(
                                point,
                                vertex,
                                vertices[
                                    (
                                        index + 1
                                    ) %
                                    vertices.length
                                ]
                            ) <=
                            tolerance
                    );
                }

                if (
                    object.type ===
                    "triangle"
                ) {
                    /*
                     * Hit-test the three real sides, so
                     * clicking any visible edge selects
                     * the whole triangle as one feature.
                     *
                     * THE INTERIOR IS NOT A HIT TARGET.
                     *
                     * A triangle is its three edges, not a filled region -
                     * DAETUM has no Fill tool - so treating the inside as part
                     * of the feature made the triangle block every click
                     * within its perimeter and hid anything drawn inside it.
                     * Selecting an edge still selects the triangle as one
                     * feature; what the triangle no longer does is swallow the
                     * geometry drawn through it.
                     */
                    const corners =
                        (geometry.points || []).filter(
                            Boolean
                        );

                    if (corners.length < 3) {
                        return false;
                    }

                    return corners.some(
                        (
                            corner,
                            index
                        ) => {
                            const next =
                                corners[
                                    (
                                        index + 1
                                    ) %
                                    corners.length
                                ];

                            return (
                                distanceToSegment(
                                    point,
                                    corner,
                                    next
                                ) <=
                                tolerance
                            );
                        }
                    );
                }

                if (
                    object.type ===
                    "polyline"
                ) {
                    return geometry.points.some(
                        (
                            current,
                            index
                        ) =>
                            index > 0 &&
                            distanceToSegment(
                                point,
                                geometry.points[
                                    index - 1
                                ],
                                current
                            ) <=
                            tolerance
                    );
                }

                if (
                    object.type ===
                    "arc"
                ) {
                    const angle =
                        Math.atan2(
                            point.y -
                                geometry.center.y,
                            point.x -
                                geometry.center.x
                        );

                    const radiusDistance =
                        Math.abs(
                            distance(
                                point,
                                geometry.center
                            ) -
                            geometry.radius
                        );

                    if (
                        radiusDistance >
                        tolerance
                    ) {
                        return false;
                    }

                    return angleOnArc(
                        angle,
                        geometry.startAngle,
                        geometry.endAngle,
                        geometry.sweep
                    );
                }

                /*
                 * AN ANALYSIS OBJECT IS ONE THING, PICKED AS ONE
                 * THING.
                 *
                 * A Force Components draws a force, two components and
                 * often labels; a diagram draws an axis, a background
                 * and a row of source markers. Every one of those is
                 * output of a single feature and none of them is a
                 * separate document object, so a click on any of them
                 * must select the WHOLE analysis object. Exposing the
                 * internals would put a dozen unclickable-looking
                 * fragments in the Features list and let a student
                 * drag a reference marker out of its own diagram.
                 *
                 * The pick is generous - a diagram's axis is a hair
                 * line, and its markers are dots - so the test is on
                 * the axis, the markers, the background region and the
                 * vectors together, and the whole thing is one hit.
                 */
                if (
                    enggAnalysisDependencies
                        .isAnalysisObject(object)
                ) {
                    return analysisObjectHit(
                        object,
                        point,
                        tolerance
                    );
                }

                return false;
            }
        );
}

/*
 * Is a point on an Analysis object?
 *
 * A DIAGRAM is picked on its own axis, on any of its source markers,
 * or anywhere inside the region it reserves for the solution. The
 * region is the point of it being forgiving: a student's SFD is
 * mostly whitespace, and a diagram that could only be picked on a
 * one-pixel line would be unusable.
 *
 * A FORCE COMPONENTS or a RESULTANT is picked along any of the
 * vectors it draws, because the vectors are all the student can
 * actually see and aim at.
 *
 * The vectors are given a WIDER pick radius than ordinary geometry.
 * They are thin lines and small arrowheads, and a result the student
 * has to hit to the pixel is a result they cannot select. Only the
 * PICK is widened - nothing is drawn any thicker for it.
 */
/*
 * HOW FAR PAST THE BODY A DIAGRAM'S PICKABLE REGION REACHES.
 *
 * Must cover the axis margin the renderer draws beyond the member, plus
 * the arrowhead and the axis label that sit past that. If it is smaller
 * than what is drawn, the part of the frame outside it cannot be clicked
 * - which is how an axis label ends up being something you can read but
 * not select.
 *
 * Kept as one number, and named, rather than folded into the expression,
 * so that a change to the drawn margin has an obvious counterpart here.
 */
const ANALYSIS_FRAME_PICK_MARGIN = 60;

function analysisObjectHit(
    object,
    point,
    tolerance
) {
    const geometry = object.geometry || {};

    if (object.type === "analysis-diagram") {
        const axis =
            geometry.zeroAxis ||
            (geometry.start && geometry.end
                ? { from: geometry.start, to: geometry.end }
                : null);

        if (axis) {
            if (
                distanceToSegment(
                    point,
                    axis.from,
                    axis.to
                ) <= tolerance
            ) {
                return true;
            }
        }

        if (
            Array.isArray(geometry.referencePositions) &&
            geometry.referencePositions.some(
                marker =>
                    marker.position &&
                    distance(
                        point,
                        marker.position
                    ) <= tolerance * 2
            )
        ) {
            return true;
        }

        /*
         * The reserved region. Checked as a box rather than as a
         * drawn rectangle because nothing is drawn there - it is
         * space the student is meant to draw in, and an invisible
         * target is the only way it can be both empty and clickable.
         *
         * IT HAS TO COVER WHAT IS DRAWN, OR THE FRAME BECOMES
         * UNSELECTABLE.
         *
         * The right edge used to be the body's own far end, which was
         * right while the axis stopped there. The axis now runs on past
         * the body to leave room for its arrowhead and the "x (m)"
         * label, and both of those sit OUTSIDE the old box - so clicking
         * the label selected nothing at all, which is a feature that
         * cannot be selected by clicking the one thing added to say what
         * it is.
         *
         * So the region is built from the same numbers the frame is drawn
         * from, and extends right to cover the axis margin. If those two
         * ever disagree again the failure is the same one, which is why
         * the values are named here rather than being a bare 90.
         */
        if (axis) {
            const height =
                Number(geometry.drawingHeight) || 90;

            /*
             * The vertical extents are symmetric here, as they were: the
             * drawn frame is not, but the pick region is deliberately
             * generous rather than exact, because a pick target smaller
             * than what the student can see is the failure worth avoiding.
             */
            const left =
                Math.min(axis.from.x, axis.to.x);

            /*
             * RIGHT, TO THE END OF THE AXIS AND ITS LABEL.
             */
            const right =
                Math.max(axis.from.x, axis.to.x) +
                ANALYSIS_FRAME_PICK_MARGIN;

            const top =
                Math.max(
                    axis.from.y,
                    axis.to.y
                ) + height;
            const bottom =
                Math.min(
                    axis.from.y,
                    axis.to.y
                ) - height;

            if (
                point.x >= left - tolerance &&
                point.x <= right + tolerance &&
                point.y >= bottom - tolerance &&
                point.y <= top + tolerance
            ) {
                return true;
            }
        }

        return false;
    }

    const pick = tolerance * 2;

    /*
     * A DECOMPOSITION IS PICKED ON ITS COMPONENTS, NEVER ON THE FORCE IT
     * DECOMPOSES.
     *
     * A Force Components draws the source force's arrow as its `original`,
     * and carries that same arrow in its own `start`/`end` - they are the
     * same segment the source force draws. So a decomposition laid over its
     * force put identical ink on the sheet twice, and a student clicking
     * the force's arrow got whichever of the two the pick happened to reach
     * first.
     *
     * The segments that identify a decomposition are its horizontal and
     * vertical components - the thing the tool was asked to produce. Those
     * are what is tested, and the shared arrow is deliberately left out:
     * clicking the force's own arrow belongs to the force.
     */
    if (object.type === "force-components") {
        const components = [
            geometry.horizontal
                ? [geometry.horizontal.start, geometry.horizontal.end]
                : null,
            geometry.vertical
                ? [geometry.vertical.start, geometry.vertical.end]
                : null
        ].filter(Boolean);

        if (
            components.some(
                ([from, to]) =>
                    distanceToSegment(
                        point,
                        from,
                        to
                    ) <= pick
            )
        ) {
            return true;
        }

        /*
         * The shared origin, which is also where the source force acts -
         * so a student clicking the point itself is choosing the force, and
         * this stays out of it too.
         */
        return false;
    }

    const segments = [
        geometry.start && geometry.end
            ? [geometry.start, geometry.end]
            : null,

        geometry.horizontal
            ? [geometry.horizontal.start, geometry.horizontal.end]
            : null,

        geometry.vertical
            ? [geometry.vertical.start, geometry.vertical.end]
            : null,

        geometry.original
            ? [geometry.original.start, geometry.original.end]
            : null
    ].filter(Boolean);

    if (
        segments.some(
            ([from, to]) =>
                distanceToSegment(
                    point,
                    from,
                    to
                ) <= pick
        )
    ) {
        return true;
    }

    /*
     * The shared origin. Every vector of a decomposition starts there,
     * so it is the one part a student is certain to aim at - and it is
     * also where the source force's own application point is, so
     * clicking the two in turn is a natural way to work.
     */
    return Boolean(
        geometry.position &&
        distance(
            point,
            geometry.position
        ) <= pick
    );
}

/*
 * Is a point on a Moment's curved arrow?
 *
 * THE SAME ARC THAT IS DRAWN.
 *
 * The test asks enggDrawingRotationalArrow for the arc and then asks
 * that arc whether the point is on it, rather than re-deriving a
 * circle here. That is the whole point of keeping the geometry in one
 * place: a hit test that measured a slightly different arc from the
 * one on screen would make the symbol selectable in places it is not
 * drawn and unselectable where it is, and the gap between those two
 * is exactly the kind of fault a student reports as "it only
 * sometimes works".
 *
 * The pick radius is wider than the drawn line for the same reason a
 * dimension's is: the curve is a thin path and demanding a pixel of
 * accuracy on it is a test of the pointer's steadiness. Only the PICK
 * is widened - the symbol is still drawn as thin as its line weight
 * says, because making it thicker to make it clickable would be
 * changing the drawing to suit the mouse.
 *
 * The position is used for the centre, so a moment moves and its hit
 * area moves with it, and a moment on a beam is picked at the beam,
 * not at the origin of the sheet.
 */
function rotationalArrowHit(
    object,
    point,
    tolerance
) {
    const rotational =
        enggDrawingRotationalArrow;

    if (!rotational) {
        return false;
    }

    const geometry = object.geometry;

    if (
        !geometry.position ||
        !Number.isFinite(geometry.position.x) ||
        !Number.isFinite(geometry.position.y)
    ) {
        return false;
    }

    /*
     * The stored radius is in screen pixels, because that is the
     * space the arc is drawn in. The pointer is still in world units,
     * so the comparison is done in screen space too - converting the
     * point through the same mapping the renderer used - and the
     * tolerance is a screen radius for the same reason.
     */
    const arc =
        rotational.arcFor(
            enggDrawingState.engineeringToScreen(
                geometry.position,
                drawingCanvas.getBoundingClientRect(),
                drawingState
            ),
            momentDirectionOf(geometry) === "CW",
            geometry.arcRadius
        );

    return rotational.arcContainsPoint(
        arc,
        enggDrawingState.engineeringToScreen(
            point,
            drawingCanvas.getBoundingClientRect(),
            drawingState
        ),
        Math.max(
            4,
            tolerance *
                drawingState.camera.zoom
        )
    );
}

/*
 * The dimension or annotation under a point, if any.
 *
 * Tested before ordinary geometry so that clicking what a student can
 * SEE - a number, a dimension line, a label - selects that thing
 * rather than the beam lying underneath it.
 *
 * Reverse order among the two, matching how the rest of the drawing is
 * picked: where two labels overlap, the one drawn last is on top and
 * is what was aimed at.
 */
function pickDimensionOrAnnotation(
    point
) {
    return (
        [
            ...drawingState.objects
        ]
            .reverse()
            .find(
                (object) =>
                    (object.type ===
                        "dimension" ||
                        object.type ===
                            "annotation" ||
                        object.type ===
                            "annotate") &&
                    objectAtPointContains(
                        object,
                        point
                    )
            ) || null
    );
}

/*
 * ========================================================
 * A MAGNITUDE BOX, WHICH IS NOT IN THE DOCUMENT
 * ========================================================
 *
 * A value beside a force is DERIVED from that force, so there is no feature
 * to select - the box is drawn, not stored. But the student can move it,
 * because `F = 100 N` printed across an arrowhead is unreadable and only they
 * know where on a busy sheet there is room for it.
 *
 * So it is picked HERE, from the same derivation the renderer draws from,
 * rather than from a list of its own that could fall out of step with what is
 * on the sheet.
 *
 * A HIT ON THE BOX IS NOT A HIT ON THE FORCE. Clicking the arrow still
 * selects the force - the arrow IS the force - but clicking the number the
 * student deliberately moved out of the way means the number. Resolving both
 * to the feature would make the moved box impossible to move again: every
 * drag would grab the arrow underneath instead.
 *
 * IT REPORTS A PSEUDO-OBJECT, not a document id, because the caller needs to
 * tell "what was clicked" apart from "what may be dragged", and a derived
 * value has neither a features-panel entry nor an undo step of its own.
 */
/*
 * The axis label under the cursor, if any.
 *
 * Newest feature first and, within a feature, the later label first - so where
 * two labels overlap the one drawn on top is the one picked.
 */
function pickAxisLabel(point, padding) {
    const model = enggAnnotationModel;

    if (!model?.drawnTextBounds || !model?.textBoundsContainPoint) {
        return null;
    }

    for (let i = drawingState.objects.length - 1; i >= 0; i -= 1) {
        const object = drawingState.objects[i];

        if (object.type !== COORDINATE_SYSTEM_TYPE) {
            continue;
        }

        const labels = axisLabelPositions(object);

        for (let j = labels.length - 1; j >= 0; j -= 1) {
            const label = labels[j];

            const bounds = model.drawnTextBounds(
                label.text,
                label.position,
                13
            );

            if (
                bounds &&
                model.textBoundsContainPoint(bounds, point, padding)
            ) {
                return {
                    area: bounds.width * bounds.height,
                    id: label.id,
                    type: "axis-label",
                    axis: label.axis,
                    sourceFeatureId: object.id,
                    label
                };
            }
        }
    }

    return null;
}

/*
 * ========================================================
 * A MAGNITUDE LABEL IS PICKED BY ITS TEXT
 * ========================================================
 */
/*
 * The magnitude label under the cursor, if any.
 *
 * A label is DRAWN somewhere the student chose, and that is what they aim at -
 * not the feature it describes. Measuring the text's own box, rather than the
 * annotation's anchor point or the source load's extent, is what makes a moved
 * label reachable: otherwise a box dragged clear of its arrow can never be
 * grabbed again, because every click resolves to the arrow underneath.
 *
 * The box JOINs the feature's extent for the purposes of Fit and export, but
 * for picking it is the box alone that counts.
 *
 * A HIT ON THE BOX IS NOT A HIT ON THE FORCE. Clicking the arrow still
 * selects the force - the arrow IS the force - but clicking the number the
 * student deliberately moved out of the way means the number. Resolving both
 * to the feature would make the moved box impossible to move again: every
 * drag would grab the arrow underneath instead.
 *
 * IT REPORTS A PSEUDO-OBJECT, not a document id, because the caller needs to
 * tell "what was clicked" apart from "what may be dragged", and a derived
 * value has neither a features-panel entry nor an undo step of its own.
 */
export function pickDerivedMagnitude(
    point
) {
    const model =
        enggAnnotationModel;

    if (!model) {
        return null;
    }

    /*
     * THE MARGIN, IN WORLD UNITS.
     *
     * A box of text is not a comfortable thing to hit with a pointer, and
     * a label that cannot be clicked cannot be moved. So the hit box is
     * the rendered text PLUS a few pixels of slack - converted to world
     * units at the current zoom, so the forgiveness is the same to aim at
     * however far the sheet is zoomed while the label keeps its drawing
     * size.
     */
    const padding =
        ANNOTATION_PICK_PADDING_PIXELS /
        Math.max(
            drawingState.camera.zoom,
            0.25
        );

    let best = null;

    /*
     * AXIS LABELS ARE PICKED BY THE SAME RULE, AND FIRST.
     *
     * A coordinate system's X and Y labels are drawing text like any other, so
     * they are picked by measuring the text's own box - the same estimate the
     * renderer lays them out with - rather than by the axis line they sit near.
     * They are considered before annotations because a label the student moved
     * onto a magnitude label should still be grabbable, and the one drawn last
     * is the one on top.
     */
    const axisLabel = pickAxisLabel(point, padding);

    if (axisLabel) {
        best = axisLabel;
    }

    /*
     * Newest feature first, so where two labels overlap the one drawn on
     * top is the one picked - what a click on the topmost thing should
     * do. A plain magnitude box and a profile point's box are handled
     * identically here; only the number of boxes differs.
     */
    for (
        let i =
            drawingState.objects.length -
                1;
        i >= 0;
        i--
    ) {
        const object =
            drawingState.objects[i];

        const annotations =
            model.derivedAnnotations(
                object,
                drawingState
            );

        for (const derived of annotations || []) {
            if (!derived || !derived.placement) {
                continue;
            }

            /*
             * THE TEXT'S OWN BOX, from the shared measurement the
             * renderer lays the label out with - never the source load's
             * bounds and never a bare anchor point. Aiming at the letters
             * has to be what selects the letters.
             */
            const bounds =
                model.annotationTextBounds(
                    derived,
                    drawingState
                );

            if (
                !model.textBoundsContainPoint(
                    bounds,
                    point,
                    padding
                )
            ) {
                continue;
            }

            /*
             * The smallest box wins, so a short label lying inside the
             * slack of a long one is still reachable.
             */
            const area = bounds
                ? bounds.width * bounds.height
                : 0;

            if (!best || area < best.area) {
                best = {
                    area,
                    id: derived.id,
                    type: "derived-magnitude",
                    sourceFeatureId: object.id,
                    annotationKind:
                        derived.annotationKind,
                    annotation: derived
                };
            }
        }
    }

    return best;
}

/*
 * The slack around a magnitude label's text that still counts as a hit.
 *
 * A few pixels, and deliberately not more: a label should be easy to
 * grab, but a hit box so large that it steals clicks from the geometry
 * beside it would make the drawing harder to work on, not easier.
 */
const ANNOTATION_PICK_PADDING_PIXELS = 5;

/*
 * The wider, invisible target a dimension and an annotation are picked
 * by.
 *
 * A dimension is drawn as a thin line a fraction of a pixel wide with
 * small arrowheads. Demanding a pixel-accurate hit on that is a test of
 * the pointer's steadiness, not of the student's aim, and a dimension
 * that cannot be clicked reliably cannot be moved, edited or deleted.
 *
 * So they are picked within about nine screen pixels of their own
 * geometry, which is the size of a comfortable click target.
 *
 * ONLY the pick is widened. Nothing is drawn any thicker: the rendered
 * dimension is exactly as it was, and the tolerance exists purely so
 * that what is visible is also what is reachable.
 */
const DIMENSION_PICK_TOLERANCE_PIXELS = 9;

/*
 * Is a dimension or annotation within reach of this point?
 */
function objectAtPointContains(
    object,
    point
) {
    if (object.type === "annotation") {
        return annotationContainsPoint(
            object,
            point
        );
    }

    if (object.type === "annotate") {
        return annotateContainsPoint(
            object,
            point
        );
    }

    return dimensionContainsPoint(
        object,
        point,
        DIMENSION_PICK_TOLERANCE_PIXELS
    );
}

function angleOnArc(
    angle,
    startAngle,
    endAngle,
    sweepDirection = null
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
        normalize(
            startAngle
        );

    const end =
        normalize(
            endAngle
        );

    const current =
        normalize(
            angle
        );

    const direction =
        sweepDirection === -1
            ? -1
            : sweepDirection === 1
                ? 1
                : (
                    endAngle >=
                        startAngle
                        ? 1
                        : -1
                );

    const travelled =
        direction > 0
            ? normalize(
                current -
                start
            )
            : normalize(
                start -
                current
            );

    const arcLength =
        direction > 0
            ? normalize(
                end -
                start
            )
            : normalize(
                start -
                end
            );

    if (
        arcLength <
        1e-9
    ) {
        return true;
    }

    return (
        travelled <=
        arcLength +
        1e-9
    );
}

export function objectPoints(
    object
) {
    const geometry =
        object.geometry;

    if (
        object.type ===
        "coordinate-system-2d"
    ) {
        return [
            geometry.origin
        ];
    }

    if (
        object.type ===
        "line"
    ) {
        return [
            geometry.start,
            geometry.end
        ];
    }

    if (
        object.type ===
        "polyline"
    ) {
        return geometry.points;
    }

    if (
        object.type ===
        "circle"
    ) {
        return [
            geometry.center
        ];
    }

    if (
        object.type ===
        "rectangle"
    ) {
        return [
            geometry.position,

            {
                x:
                    geometry.position.x +
                    geometry.width,

                y:
                    geometry.position.y
            },

            {
                x:
                    geometry.position.x +
                    geometry.width,

                y:
                    geometry.position.y -
                    geometry.height
            },

            {
                x:
                    geometry.position.x,

                y:
                    geometry.position.y -
                    geometry.height
            }
        ];
    }

    if (
        object.type ===
        "arc"
    ) {
        return [
            {
                x:
                    geometry.center.x +
                    Math.cos(
                        geometry.startAngle
                    ) *
                    geometry.radius,

                y:
                    geometry.center.y +
                    Math.sin(
                        geometry.startAngle
                    ) *
                    geometry.radius
            },

            {
                x:
                    geometry.center.x +
                    Math.cos(
                        geometry.endAngle
                    ) *
                    geometry.radius,

                                y:
                                    geometry.center.y +
                                    Math.sin(
                                        geometry.endAngle
                                    ) *
                                    geometry.radius
                            }
                        ];
                    }

                    /*
                     * DIMENSIONS AND ANNOTATIONS.
                     *
                     * These have no geometry of their own in the way a shape
                     * does, so they used to fall through to the empty list and
                     * contribute NOTHING to the drawing's extent. That made Fit
                     * quietly wrong: a dimension is placed deliberately OUTSIDE
                     * the geometry it measures, and an annotation is placed
                     * wherever the student put it, so both are often the
                     * outermost things on the sheet.
                     *
                     * The result was a Fit that framed the geometry and left the
                     * dimension hanging off the edge of the canvas - clipped,
                     * and invisible, which is the one thing a Fit must never do
                     * to content that is really there.
                     *
                     * So both are placed. A dimension contributes its own
                     * presentation position - the offset it was dragged to, NOT
                     * the geometry it measures, because dragging a dimension
                     * must not move the source feature and the extent must
                     * follow the presentation, not the measurement. An
                     * annotation contributes its placement point, together with
                     * the height of its text, because text sits ABOVE the point
                     * it is anchored to and a tall label would otherwise be
                     * half off the top of a fitted view.
                     *
                     * This is the same shared extent function the Fit and the
                     * Drawing References use, so the two cannot disagree about
                     * how big the drawing is.
                     */
                    if (
                        object.type ===
                            "dimension"
                    ) {
                        const offset =
                            geometry.offset ||
                            geometry.placement ||
                            {};

                        return [{
                            x: Number.isFinite(offset.x)
                                ? offset.x
                                : 0,
                            y: Number.isFinite(offset.y)
                                ? offset.y
                                : 0
                        }];
                    }

                    if (
                        object.type ===
                            "annotation"
                    ) {
                        const placement =
                            geometry.placement ||
                            geometry.position ||
                            {};

                        /*
                         * The text's own height, so a tall label is counted
                         * from its anchor rather than hanging out of frame.
                         */
                        const textHeight =
                            Number(
                                geometry.fontSize
                            ) || 12;

                        return [{
                            x: Number.isFinite(placement.x)
                                ? placement.x
                                : 0,
                            y:
                                (Number.isFinite(
                                    placement.y
                                )
                                    ? placement.y
                                    : 0) - textHeight
                        }];
                    }

                    return [];
                }
