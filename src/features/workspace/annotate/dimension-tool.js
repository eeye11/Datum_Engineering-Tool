/*
 * The Dimension tool: choosing and committing a measurement.
 */

import enggMeasurement from "../../../shared/geometry/measurement-core.js";
import enggFluidsTools from "../model/fluids/fluids-tools.js";
import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggDimensionModel from "../model/dimensions/dimension-model.js";
import enggDimensionCandidates from "../model/dimensions/dimension-candidates.js";
import { openLoadValuePopup, readStaticsValue } from "../../../shared/ui/editors/load-value-popup.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { drawingState } from "../editor-state.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { distanceToSegment, objectAtPoint } from "../interaction/hit-testing.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";

/*
 * Is this the dimension tool?
 *
 * There is ONE dimension tool. It picks references and then a placement point,
 * and the measurement type - linear, aligned, angular, radius, diameter or arc
 * length - is read from what the student picked. The retired Smart Dimension
 * and Variable Dimension tools are not routed here any more.
 */
/*
 * THE FLUIDS MEASUREMENTS REUSE THE SAME ENGINE. A Pressure Tap, a Pipe
 * Diameter and a Section Plane are measurements of something already drawn,
 * which is what this tool does, so they are routed here rather than through a
 * second measuring system. The capability is read FROM the Fluids registry, so
 * the entry that says "this is a measurement" and this layer cannot disagree.
 */
export function isDimensionTool(
    toolId
) {
    return (
        toolId === "dimension" ||
        enggFluidsTools.fluidsCapability(toolId) ===
            enggFluidsTools.FLUIDS_CAPABILITIES.DIMENSION
    );
}

/*
 * The measurements available for a selection.
 *
 * Delegates to the measurement model rather than inspecting types, so
 * this holds for every feature that has registered what it can be
 * measured as - and quietly returns nothing for one that has not,
 * rather than guessing.
 *
 * One object gives its own candidates. Two give the RELATIONSHIP
 * between them, which is the whole difference between measuring a
 * single circle and measuring the gap between two circles.
 */
/*
 * The measurements a selection supports, as complete DESCRIPTORS.
 *
 * Returns objects that already carry their own references, rather than
 * bare measurement types, because a single feature and a pair of
 * features refer to their geometry in different ways and asking this
 * file to assemble both would mean re-implementing what the inference
 * model already knows.
 *
 * `describe` is used for one feature and `describePair` for two. That
 * split is the model's, not this file's: deciding what a pair MEANS -
 * that two non-parallel spans should give their included angle rather
 * than two separate lengths - belongs with the measurements, and is
 * kept there rather than re-derived here.
 *
 * A selection of more than two is reduced to its first two, because a
 * measurement is a relationship between two things; anything else has
 * no single meaning, and guessing one would put a number on the drawing
 * that answers a question nobody asked.
 */
export function dimensionDescriptorsFor(
    objects
) {
    const parts =
        (objects || []).filter(
            Boolean
        );

    try {
      return (
        enggDimensionCandidates.descriptorsFor(
          parts,
          drawingState
        ) || []
      );
    } catch (error) {
      return [];
    }
}

/*
 * A readable description of what is about to be measured.
 *
 * The status line has to say what the tool RECOGNISED, not merely
 * that it found something. For a single feature the measurement's own
 * name is enough, because there is only one thing it could refer to.
 *
 * For a pair it is not: "Angular" on its own leaves a student unable
 * to tell whether it means the angle between the two lines they picked
 * or something the tool worked out on its own, so the pair is named.
 */
export function dimensionChoiceMessage(
    descriptor,
    objects
) {
    const label = dimensionChoiceLabel(
        descriptor?.dimensionType
    );

    if (
        !Array.isArray(objects) ||
        objects.length < 2
    ) {
        return label;
    }

    return (
        `${label} between ${featureNameOf(
            objects[0]
        )} and ${featureNameOf(
            objects[1]
        )}`
    );
}

/*
 * A feature's own name, for messages that have to say which feature is
 * being measured.
 *
 * Falls back to its type so a feature with no name is still identified
 * - "Beam and Beam" is poor wording, but it is better than a message
 * that names nothing at all.
 */
export function featureNameOf(
    object
) {
    return (
        object?.name ||
        object?.type ||
        "feature"
    );
}

/*
 * A short name for a measurement, for the message that tells the
 * student what the tool has recognised.
 */
export function dimensionChoiceLabel(
    dimensionType
) {
    return (
        enggMeasurement.DIMENSION_TYPES?.[
            dimensionType
        ]?.label ||
        dimensionType
    );
}

/*
 * Turn the armed measurement into a real dimension feature.
 *
 * Goes through the feature factory rather than being built here, so a
 * dimension is named, numbered, selected, undone and saved by exactly
 * the same code as every other feature. It is a feature on a drawing,
 * not a decoration painted over one.
 */
export function commitDimension(
    dimensionType,
    refs,
    placement
) {
    /*
     * A DIMENSION IS AN ANNOTATION AND COMMITS IMMEDIATELY.
     *
     * DAETUM geometry is schematic: there is no world scale to establish and no
     * "actual length" prompt, so the placement click is the whole gesture.
     */
    return commitDimensionNow({
        dimensionType,
        refs,
        placement
    });
}

/*
 * Commit a dimension from the reference picking and placement already made.
 *
 * One implementation, so the placement path and any other caller create a
 * dimension in exactly the same way.
 *
 * ========================================================
 * NOTHING IS STORED AS DRIVING OR DRIVEN
 * ========================================================
 *
 * The retired Driving/Driven mode made a dimension either an annotation or a
 * constraint that resized the geometry it measured. A dimension is now an
 * annotation only: it reads the geometry when it is asked for its text and
 * never writes to it. There is therefore no mode to choose, no redundancy rule
 * that would switch one on, and no state on the feature that records it.
 */
function commitDimensionNow({
    dimensionType,
    refs,
    placement
}) {
    const previousObjects =
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    const object = enggDrawingState.geometryFactories.dimension({
        dimensionType,
        refs,
        placement
    });

    enggDrawingState.addObject(
        drawingState,
        object
    );

    enggDrawingState.commitDrawingChange(
        drawingState,
        previousObjects
    );

    enggDrawingState.clearInteraction(
        drawingState
    );

    /*
     * Selected after creation so the student can move or delete it
     * straight away - which is the commonest thing anyone wants to do
     * with a dimension they have just placed.
     */
    enggDrawingState.selectObject(
        drawingState,
        object.id
    );

    const measured =
        enggDimensionModel.formatMeasurement(
            object,
            drawingState
        );

    setToolMessage(
        measured
            ? `Dimension placed - ${measured}`
            : "Dimension placed"
    );

    renderProperties();
    renderCurrentDrawing();

    return object;
}

/*
 * ========================================================
 * DOUBLE-CLICKING A DIMENSION EDITS ITS VALUE
 * ========================================================
 *
 * The SAME popup every other value in the application is entered through - the
 * component a Length, a Force and a moment magnitude use.
 *
 * THE EDITED VALUE IS ANNOTATION TEXT. It is stored as the feature's `label`
 * and shows in place of the measured number; it does not move geometry and
 * there is no drawing scale to calibrate. The dimension keeps its REFERENCES
 * whatever is typed - the popup changes what the dimension SAYS, never what it
 * is attached to.
 */
export function openDimensionValuePrompt(object) {
    if (!object) {
        return false;
    }

    const current =
        typeof object.label === "string" ? object.label : "";

    openLoadValuePopup({
        title: "Dimension",
        label: "Value",
        value: current,

        /*
         * FREE TEXT. A dimension's text is annotation - 250 mm, 2.5 m, L, 2a -
         * so there is no unit list to choose from and nothing is converted:
         * what is typed is what the dimension says.
         */
        expression: true,

        onConfirm: (confirmed) => {
            const previous =
                enggDrawingState.snapshotDrawing(drawingState);

            const answer = readStaticsValue(
                confirmed.text ?? "",
                confirmed.unit
            );

            if (answer.kind === "unknown") {
                object.label = null;
            } else if (answer.kind === "number") {
                const numberText = formatDimensionLabelValue(answer.value);

                object.label = `${numberText}${answer.unit ? ` ${answer.unit}` : ""}`.trim();
            } else if (answer.kind === "symbol") {
                object.label = answer.text;
            }

            enggDrawingState.commitDrawingChange(
                drawingState,
                previous
            );

            setToolMessage(
                `Dimension updated - ${
                    enggDimensionModel.formatMeasurement(
                        object,
                        drawingState
                    ) || "Unknown"
                }`
            );

            renderProperties();
            renderCurrentDrawing();
        },

        onCancel: () => {
            setToolMessage("Dimension edit cancelled");

            renderCurrentDrawing();
        }
    });

    return true;
}

function formatDimensionLabelValue(value) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
        return "";
    }

    return String(Number(numeric.toFixed(6)));
}


/*
 * WHICH FEATURE IS BEING DIMENSIONED
 *
 * A click does not always land ON a feature. objectAtPoint finds the
 * nearest EDGE, which is right for selecting a line but wrong for a
 * body: clicking in the middle of a Beam, a Rectangle or a Truss finds
 * nothing, so those features could only ever be dimensioned by hitting
 * their outline. For a tool whose whole job is to measure a feature,
 * that is not good enough.
 *
 * So when the edge test misses, the click is resolved against each
 * feature's own ANCHORS - the points the measurement system already
 * says this feature can be measured from - and the nearest one within
 * a screen-sized radius wins.
 *
 * Reusing the anchors rather than inventing a second set of hit
 * shapes means the thing the student clicks near is the same thing the
 * dimension will be measured from, which is why a Beam is picked by
 * its ends and a Circle by its own extent rather than by a bounding
 * box that may be far larger than either.
 */
export function findDimensionTarget(
    point
) {
    const direct =
        objectAtPoint(point);

    if (direct) {
        return direct;
    }

    /*
     * A radius of about twelve screen pixels, expressed in world
     * units so it stays the same physical size on screen at any zoom.
     *
     * That radius is right for a feature that IS its anchors - a line,
     * a beam, a shaft - because clicking anywhere along one is within
     * reach of an end.
     */
    const radius =
        12 /
        Math.max(
            enggDrawingState
                .BASE_PIXELS_PER_UNIT *
                drawingState.camera.zoom,
            0.0001
        );

    let best = null;
    let bestDistance = radius;

    for (const object of drawingState.objects) {
        /*
         * A dimension is not something to dimension. Skipping it
         * keeps a dimension from being measured by another dimension,
         * which would be a dimension describing a number rather than
         * the drawing.
         */
        if (
            object.type === "dimension" ||
            object.type === "annotation"
        ) {
            continue;
        }

        let anchors;

        try {
            /*
             * anchorOptions returns the NAMES a feature can be
             * measured from, not their positions - asking it for
             * points found nothing, which is why a click in the
             * middle of a rectangle never resolved to the rectangle.
             * anchorNames plus resolveAnchor is the same information
             * with the coordinates attached, and resolveAnchor is what
             * the measurement itself uses, so this stays on exactly
             * the geometry the dimension will be taken from.
             */
            anchors =
                (enggMeasurement.anchorOptions(object) || [])
                    .map(
                        name => ({
                            name: String(name),
                            at: enggMeasurement.resolveAnchor(
                                object,
                                name
                            )
                        })
                    );
        } catch (error) {
            anchors = null;
        }

        /*
         * Each anchor is kept with the NAME it was resolved from, because the
         * name is what says whether it is a corner or a midpoint - the array
         * INDEX says nothing. A midpoint lies on the outline and must not be
         * treated as a corner in the interior test below.
         */
        const points = (anchors || [])
            .map((entry) => ({
                name: entry.name,
                ...(entry.at || {})
            }))
            .filter(
                anchor =>
                    Number.isFinite(anchor.x) &&
                    Number.isFinite(anchor.y)
            );

        if (points.length === 0) {
            continue;
        }

        /*
         * INSIDE THE FEATURE
         *
         * The radius alone is not enough for a body. A rectangle's
         * anchors are its four CORNERS, so the middle of a wide
         * rectangle can be a hundred pixels from every one of them -
         * which is exactly where a student aims when they want to
         * dimension it.
         *
         * THE OUTLINE IS THE FEATURE'S UNIQUE CORNERS, IN ORDER.
         *
         * A triangle publishes nine anchors - start, midpoint and end for each
         * of its three sides - and a side's end is the next side's start. Fed
         * to a crossing test as-is, that list walks each edge twice and counts
         * crossings wrongly, so clicking inside a triangle could resolve to
         * nothing. Taking the corners and dropping repeats leaves the perimeter
         * exactly once, in order, which is what the test needs.
         */
        const cornersForOutline =
            uniqueCornerOutline(points);

        if (
            cornersForOutline.length >= 3 &&
            pointInsideOutline(
                point,
                cornersForOutline
            )
        ) {
            return object;
        }

        /*
         * NEAR THE FEATURE'S SPAN, not merely its endpoints.
         *
         * Anchors are endpoints and centres. A feature that is long
         * between them - a force's arrow, a beam, a cable - has most of
         * its own length far from any of them, so measuring to the
         * anchors alone meant the middle of a 40 mm beam was unclickable
         * while its ends were fine. Clicking a feature means clicking
         * ON it, which is most of it, not the few points it is measured
         * from.
         *
         * So the click is measured against the nearest segment joining
         * the anchors as well. Anchors come from the measurement layer
         * and are the feature's own points, so this is the real shape
         * and not a bounding box that would claim far more than belongs
         * to it.
         */
        for (let i = 1; i < points.length; i += 1) {
            const distance =
                distanceToSegment(
                    point,
                    points[i - 1],
                    points[i]
                );

            if (distance < bestDistance) {
                bestDistance = distance;
                best = object;
            }
        }
    }

    return best;
}

/*
 * The feature's perimeter: its corner anchors, with repeats removed, in the
 * order they were published.
 *
 * A composite feature publishes an anchor per side - a start and an end - and a
 * side's end is the next side's start. Kept as published, the list visits every
 * corner twice and cannot be used as a polygon. Keeping the first occurrence of
 * each corner leaves the outline exactly once, in order.
 *
 * Midpoint anchors are dropped: they lie ON an edge, and a crossing test given
 * a point on its own boundary is a coin toss.
 */
function uniqueCornerOutline(points) {
    const corners = [];

    const seen = (point) =>
        corners.some(
            (kept) =>
                Math.abs(kept.x - point.x) < 1e-9 &&
                Math.abs(kept.y - point.y) < 1e-9
        );

    points.forEach((point) => {
        if (/mid$/i.test(String(point?.name || ""))) {
            return;
        }

        /*
         * A coordinate already on the outline is the SAME corner, however many
         * anchors name it. A triangle publishes its three vertices directly as
         * `a`, `b`, `c`, and again as each side's start and end - keeping every
         * occurrence would visit each corner three times and give the crossing
         * test a shape that is not the triangle.
         */
        if (!seen(point)) {
            corners.push(point);
        }
    });

    return corners;
}

/*
 * Is a point inside the outline its anchors describe?
 *
 * Used only to decide what the student clicked, never to measure
 * anything, so a plain crossing count is enough and an exact answer
 * is not required.
 */
function pointInsideOutline(
    point,
    outline
) {
    let inside = false;

    for (
        let i = 0,
            j = outline.length - 1;
        i < outline.length;
        j = i++
    ) {
        const a = outline[i];
        const b = outline[j];

        const straddles =
            a.y > point.y !== b.y > point.y;

        if (
            straddles &&
            point.x <
                ((b.x - a.x) *
                    (point.y - a.y)) /
                    (b.y - a.y) +
                    a.x
        ) {
            inside = !inside;
        }
    }

    return inside;
}
