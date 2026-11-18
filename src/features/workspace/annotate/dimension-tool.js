/*
 * The Dimension tool: choosing and committing a measurement.
 */

import { openDimensionTextEditor } from "../../../shared/ui/editors/dimension-text-editor.js";

import enggMeasurement from "../../../shared/geometry/measurement-core.js";
import enggFluidsTools from "../model/fluids/fluids-tools.js";
import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggDimensionModel from "../model/dimensions/dimension-model.js";
import enggDimensionCandidates from "../model/dimensions/dimension-candidates.js";

import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { drawingState } from "../editor-state.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { distanceToSegment, objectAtPoint } from "../interaction/hit-testing.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";

/*
 * THE QUICK-ACCESS DEFAULT IS APPLIED TO A NEW DIMENSION HERE.
 *
 * `styleDefaults.fontSize` is what the control sets with nothing selected, so a
 * dimension made after the student chose 20 px is a 20 px dimension. A student
 * who never set a default keeps the model's own secondary-role size.
 */
function applyDefaultFontSize(state, object) {
    const wanted = Number(state?.styleDefaults?.fontSize);

    if (!Number.isFinite(wanted) || wanted <= 0) {
        return object;
    }

    object.style = {
        ...(object.style || {}),
        fontSize: Math.min(96, Math.max(8, wanted)),
    };

    /* The object's own statement of its size, kept equal to the style's. */
    if (Number(object.fontSize) > 0) {
        object.fontSize = object.style.fontSize;
    }

    return object;
}

/* Dimension uses reference picking, placement, and user-entered magnitude.
 * The legacy `dimension` id remains supported for existing callers. */
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
        ["dimension", "angle", "smart-dimension", "variable-dimension"].includes(toolId) ||
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
    placement,
    defaultLabel = ""
) {
    /*
     * THE DIMENSION IS PLACED FIRST, AND NAMED ON THE PAGE.
     *
     * A dimension is written INTO the drawing, and its label is in-page text on
     * that drawing - so creating one must not stop at a modal question. It is
     * committed with NO label, and the in-place text field then opens over the
     * dimension line, which is where the text will live.
     *
     * NO MEASUREMENT IS EVER SHOWN IN THE MEANTIME. The dimension draws its
     * witness lines, its dimension line and its arrowheads, and no text at all
     * until the student types one - so the number they see is always the number
     * they wrote, never a calculated distance they did not ask for.
     *
     * Escape on that field abandons only the edit; the dimension stays, with
     * its lines and no label.
     *
     * This is the same field the double-click gesture opens
     * (`openDimensionValuePrompt`), so a dimension is created and edited through
     * ONE editor rather than two interfaces for the same text.
     */
    const label = String(defaultLabel || "").trim();

    const object = commitDimensionNow({
        dimensionType,
        refs,
        placement,
        dimensionKind: label ? "variable" : "smart",
        content: label
    });

    if (object) {
        openDimensionValuePrompt(object);
    }

    return object;
}

/* Preserve references, undo history, and save data for authored dimensions. */
function commitDimensionNow({
    dimensionType,
    refs,
    placement,
    dimensionKind = "smart",
    content = ""
}) {
    const previousObjects =
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    const object = enggDrawingState.geometryFactories.dimension({
        dimensionType,
        ...(dimensionType === "angular" ? {name:"Angle"} : {}),
        refs,
        placement,
        dimensionKind,
        content
    });

    /*
     * A NEW DIMENSION TAKES THE QUICK-ACCESS DEFAULT, unless the student has
     * never set one - in which case the model's own secondary-role size (14 px)
     * stands, which is the right size for a number beside a line.
     */
    if (object) {
        applyDefaultFontSize(drawingState, object);
    }

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

    /*
     * THE STATUS LINE MAY NAME THE MEASUREMENT - the drawing may not.
     *
     * `describeMeasurement` is the calculated distance, offered as feedback in
     * the toolbar. It is deliberately NOT the dimension's label: the label is
     * the student's, and stays empty until they type one.
     */
    const measured =
        enggDimensionModel.describeMeasurement(
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
 * REOPEN THE DIMENSION'S TEXT, IN PLACE, WITHOUT REPLACING ITS REFERENCES.
 *
 * THE NUMBER IS EDITABLE WHERE IT IS DRAWN. The field opens over the glyphs on
 * the drawing (see dimension-text-editor.js), so changing what a dimension
 * says is a change to that text in that place - not a modal question, and not
 * a second object. The dimension keeps its id, its references and its
 * measurement; only the text it displays is rewritten.
 *
 * WHAT IS EDITED IS THE DIMENSION'S LABEL, and nothing else. The dimension
 * becomes a `variable` (driven) annotation stating what the student typed,
 * which is the same field the Features panel's Label Text row writes - so the
 * text, the panel and the source stay in step, all three reading one field.
 *
 * AN EMPTY LABEL IS ACCEPTED and leaves the dimension with its lines and no
 * text. Escape abandons the edit and leaves the dimension exactly as it was.
 */
export function openDimensionValuePrompt(object) {
    if (!object || object.type !== "dimension") return false;

    const current = () => drawingState.objects.find(candidate => candidate.id === object.id) || null;

    /*
     * A REFERENCE THAT NO LONGER RESOLVES IS NOT SILENTLY OVERWRITTEN. Its text
     * would be a claim about geometry that is not there, so the edit is refused
     * with the reason rather than accepted with the drawing left broken.
     */
    const anchor = current();

    if (!anchor) return false;

    const graphics = enggDimensionModel.graphicsFor(anchor, drawingState);

    if (!graphics) {
        setToolMessage("This dimension cannot be edited until the geometry it measures exists");
        return false;
    }

    openDimensionTextEditor({
        object: anchor,
        /*
         * THE FIELD OPENS ON THE LABEL, WHICH IS EMPTY UNTIL TYPED. It never
         * opens on a calculated distance: the measurement is not the label, and
         * pre-filling the field with it is how a student's "5" became
         * "118.71 mm".
         */
        value: anchor.dimensionKind === "variable"
            ? anchor.content
            : (typeof anchor.label === "string" ? anchor.label : ""),
        world: graphics.textFrame
            ? { x: graphics.textFrame.x, y: graphics.textFrame.y }
            : graphics.textAnchor || anchor.placement,
        state: drawingState,
        onApply: (value) => {
            const target = current();
            if (!target) return { ok: false, error: "This dimension was deleted." };

            /*
             * AN EMPTY LABEL IS A LEGAL ANSWER. The dimension keeps its lines
             * and shows no text - which is exactly what "no label" means. It
             * is not an error, and it does not fall back to the measurement.
             */
            const text = String(value ?? "").trim();
            const previous = enggDrawingState.snapshotDrawing(drawingState);

            /*
             * ONLY THE LABEL CHANGES. The references, the placement and the
             * measured geometry are untouched, so editing the text can never
             * move the dimension or change what it measures.
             */
            target.dimensionKind = text ? "variable" : "smart";
            target.content = text;
            target.mode = "driven";
            target.drivingValue = null;
            target.label = text || null;
            delete target.dimensionError;
            enggDrawingState.commitDrawingChange(drawingState, previous);
            renderProperties(); renderCurrentDrawing();
            setToolMessage(text ? "Dimension label updated" : "Dimension label cleared");
            return { ok: true };
        }
    });
    return true;
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
