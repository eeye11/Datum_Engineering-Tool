/*
 * Working out what a dimension click refers to, and which measurement it implies.
 */

import enggFeatureGeometry from "../../../shared/geometry/feature-geometry.js";
import enggMeasurement from "../../../shared/geometry/measurement-core.js";
import { objectWithId } from "./dimension-placement.js";
import { dimensionDescriptorsFor, findDimensionTarget } from "./dimension-tool.js";
import { distanceToSegment } from "../interaction/hit-testing.js";

/*
 * A click while the dimension tool is active.
 *
 * First click arms the measurement, second click places it. Both clicks
 * go through the pointer's resolved point, so the placement snaps to
 * the same targets as every other tool rather than to a private set.
 */
/*
 * A DIMENSION REFERENCE FROM A SNAP, OR NOTHING.
 *
 * The snap says which feature and what KIND of point; a dimension reference
 * needs which feature and which ANCHOR of it. This is the join, and it returns
 * null whenever it cannot be made honestly - a point that names no anchor is
 * not something a dimension can be built from, and inventing one would measure
 * the wrong thing silently.
 *
 * An intersection has no owning feature, so it is not a reference: there is
 * nothing to re-resolve it against when the geometry moves.
 */
function dimensionRefFromSnap(
    resolution,
    point
) {
    const candidate =
        resolution?.snapCandidate;

    if (!candidate?.objectId) {
        return null;
    }

    const object =
        objectWithId(candidate.objectId);

    if (!object || object.type === "dimension" || object.type === "annotation") {
        return null;
    }

    /*
     * A POINT ON A STRAIGHT ENTITY IS A GENUINE POINT REFERENCE.
     *
     * The snap publishes pointOnEntity at the cursor's own position
     * along the feature, and the nearest NAMED anchor is usually not
     * that position - so resolving it to one would silently move the
     * reference to an endpoint or midpoint the student did not click.
     * Instead the position is encoded as a fraction of the span, which
     * the measurement layer resolves from the feature's current ends.
     */
    if (
        candidate.type === "pointOnEntity" &&
        twoPointSpanOf(object)
    ) {
        const fraction = fractionAlongFeature(
            object,
            candidate.point || point
        );

        if (fraction !== null) {
            return {
                featureId: object.id,
                anchor:
                    "pointOnEntity@" +
                    fraction
            };
        }
    }

    const anchor =
        enggMeasurement.anchorNameAtPoint(
            object,
            candidate.point || point,
            candidate.type
        );

    if (!anchor) {
        return null;
    }

    return {
        featureId: object.id,
        anchor
    };
}

/*
 * How far along a straight feature a model point lies, as a fraction.
 *
 * Null when the feature has no span or the point is degenerate with
 * one of its ends, in which case a named endpoint anchor is the honest
 * reference and the caller falls back to it.
 */
function fractionAlongFeature(
    object,
    point
) {
    const span = twoPointSpanOf(object);

    if (!span) {
        return null;
    }

    const deltaX = span.end.x - span.start.x;
    const deltaY = span.end.y - span.start.y;

    const lengthSquared =
        deltaX * deltaX + deltaY * deltaY;

    if (lengthSquared < 1e-12) {
        return null;
    }

    const t =
        ((point.x - span.start.x) * deltaX +
            (point.y - span.start.y) * deltaY) /
        lengthSquared;

    /*
     * Clamped to the feature, because a point on an entity is ON it. A
     * fraction outside [0, 1] would resolve to a position past the end,
     * which is not a point on the entity at all.
     */
    return Math.min(1, Math.max(0, t));
}

/*
 * ========================================================
 * DIMENSION: WHAT THE STUDENT JUST CLICKED
 * ========================================================
 *
 * A dimension reference is not merely "a feature". The tool has to tell
 * apart four kinds of click, because each leads to a different
 * measurement:
 *
 *   a SNAP POINT      an endpoint, midpoint, centre, quadrant,
 *                     intersection or point-on-entity - one exact model
 *                     point, named by the snap system
 *   a LINE            a straight body or segment, dimensioned by its
 *                     full length, or measured against another line
 *                     for an angle
 *   a CIRCLE / ARC    dimensioned by its own diameter or radius
 *   a BODY            anything else that exposes measurements
 *
 * The reference returned here is deliberately PERSISTENT: it names the
 * feature and the sub-element (an anchor name, or the feature's own
 * span), never a frozen coordinate. That is what lets the dimension
 * follow the geometry when it moves.
 *
 * A snap resolved to a real anchor wins over the feature under the
 * cursor: `endpoint to midpoint` is a different dimension from
 * `endpoint to endpoint`, and only the snap knows which was hit.
 *
 * WHAT A POINT-ON-ENTITY SNAP MEANS DEPENDS ON THE STAGE
 * -----------------------------------------------------
 * pointOnEntity is the snap system's "anywhere along this feature"
 * target, so it is always available when the cursor is over a line.
 * If it were taken as a chosen reference on the FIRST click, a student
 * clicking a beam to dimension its span would instead get a point
 * reference to an arbitrary position on it - which is exactly the
 * behaviour §7 of the specification forbids.
 *
 * So on the FIRST click a pointOnEntity snap is ignored in favour of
 * the feature itself (a line dimensions its whole length, a circle its
 * diameter). On the SECOND click it IS a valid point reference,
 * because the student is deliberately choosing a position rather than
 * a whole body.
 */
export function dimensionReferenceAtClick(
    resolution,
    point,
    awaitingSecond
) {
    /*
     * A SNAP IS A POINT, BUT IT IS NOT ALWAYS WHAT WAS MEANT.
     *
     * Clicking the middle of a Beam should measure the BEAM. The snap
     * layer publishes a midpoint there, and taking it would silently
     * turn every click on a member into "half of it" - which is why
     * a feature that measures as a whole is preferred here and the
     * snap is only consulted when there is no such feature.
     *
     * What is under the cursor decides which that is. A LINE is
     * measured whole even when an endpoint or midpoint snapped to it;
     * a feature with no intrinsic measurement of its own - a Particle,
     * a Support, a Point Force - falls through to the snap, which is
     * exactly the reference the student aimed at.
     */
    const object = findDimensionTarget(point);

    if (object) {
        const whole =
            dimensionReferenceForFeature(object, point);

        if (whole && whole.kind !== "point") {
            return whole;
        }
    }

    const snappedRef =
        dimensionRefFromSnap(
            resolution,
            point
        );

    if (snappedRef) {
        return {
            kind: "point",
            ref: snappedRef,
            featureId: snappedRef.featureId,
            anchor: snappedRef.anchor
        };
    }

    /*
     * Nothing under the cursor that measures as a whole, and no snap
     * either - a click on empty space. The caller decides what to do
     * about it.
     */
    return null;
}

/*
 * The measurements a circle or an arc can state, from the measurement layer.
 *
 * Read from `dimensionCandidates`, which is the ONE place a feature's own
 * measurements are declared, then filtered to the circular ones. A circle and an
 * arc therefore offer exactly what the rest of the application believes they
 * can measure, and a future circular measurement is offered here without a
 * second list to keep in step.
 *
 * `coordinate` and `angular` are deliberately left OUT of the offers: a
 * coordinate is a position rather than a size, and an arc's included angle is
 * measured between its two radii as an angular dimension elsewhere - neither is
 * a radius/diameter/arc-length choice the cursor should cycle through here.
 */
const CIRCULAR_MEASUREMENTS = ["diameter", "radius", "arc-length"];

function circularMeasurementTypes(object) {
  const declared = enggMeasurement.dimensionCandidates(object) || [];

  const offered = CIRCULAR_MEASUREMENTS.filter((type) =>
    declared.includes(type)
  );

  /*
   * A circle is never offered an arc length: it has no sweep, and a full
   * circumference is a different claim that the requirement says must not be
   * dressed up as one. Belt-and-braces over the declaration, which is the point
   * of stating it.
   */
  const shapeFiltered =
    object.type === "circle"
      ? offered.filter((type) => type !== "arc-length")
      : offered;

  return shapeFiltered.length ? shapeFiltered : ["radius"];
}

/*
 * EVERY measurement a circle or an arc can state, as descriptors.
 *
 * The placement keeps a LIST of candidate dimensions so Tab can cycle them, and a
 * plain line contributes exactly one. A circle contributes several - diameter and
 * radius, an arc also arc length - and they are all the SAME reference measured
 * differently, which is why the leader (the default) is `first.dimensionType`
 * and the rest follow in the shape's own declared order.
 *
 * Nothing is invented here: every type comes from `circularMeasurementTypes`, the
 * filter over the measurement layer's own declaration. A shape that can only
 * state a radius yields a single candidate and Tab simply has nowhere to go,
 * which is the correct behaviour rather than cycling through impossible claims.
 */
export function circularCandidateDescriptors(reference) {
  const offered =
    Array.isArray(reference?.offered) && reference.offered.length
      ? reference.offered
      : [reference?.dimensionType];

  const ordered = [
    reference?.dimensionType,
    ...offered.filter((type) => type !== reference?.dimensionType)
  ].filter(Boolean);

  return ordered.map((dimensionType) => ({
    dimensionType,
    refs: [
      {
        kind: "between",
        featureId: reference.featureId,
        anchor: reference.anchor
      }
    ]
  }));
}

/*
 * Which circular measurement the cursor is asking for.
 *
 * TWO HONEST SIGNALS, and no guessing:
 *
 *   1. A cursor OUTSIDE the circle reads as a leader-style annotation, which is
 *      how a radius is conventionally placed - so a cursor beyond the boundary
 *      prefers RADIUS.
 *   2. A cursor near the centre, or on the circle a diameter runs through,
 *      prefers DIAMETER.
 *
 * An arc prefers RADIUS unless the cursor sits far out along the sweep, where an
 * arc-length annotation is the convention - so the same distance test decides it.
 * When the shape cannot state the preferred type at all, the first offered type
 * is used, so the answer is always one the shape genuinely supports.
 */
function preferredCircularType(object, point, offered) {
  const geometry = object.geometry || {};
  const centre = geometry.center;

  const pick = (preferred) =>
    offered.includes(preferred) ? preferred : offered[0];

  if (!centre || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return offered[0];
  }

  const radius = Number(geometry.radius) || 0;

  const distance = Math.hypot(point.x - centre.x, point.y - centre.y);

  /*
   * Inside the circle, or close to it: the cursor is on the body, which is where
   * a diameter is drawn ACROSS. Outside it: a leader, which is a radius.
   */
  if (distance > radius * 1.15) {
    /*
     * Far out along an arc's sweep is where an arc-length annotation is placed;
     * a full circle has no arc length to offer, so it falls to a radius.
     */
    if (object.type === "arc" && offered.includes("arc-length")) {
      return "arc-length";
    }

    return pick("radius");
  }

  return pick(object.type === "arc" ? "radius" : "diameter");
}

/*
 * The reference a whole feature offers, by its shape.
 *
 * A straight body is referenced as a LINE - so selecting it once
 * dimensions its full length, and selecting a second line measures the
 * angle between them. A circle is referenced as a CIRCLE, measured by
 * its diameter; an arc by its radius. Anything else falls back to its
 * own best measurement.
 *
 * A COMPOSITE FEATURE IS REFERENCED BY THE SEGMENT THAT WAS CLICKED.
 *
 * A polyline and a rectangle are chains of straight segments, and the only
 * honest linear reference for either is the segment the student aimed at. The
 * whole chain's first-to-last span is deliberately not offered: a click on one
 * segment of a polyline means that segment, and dimensioning the whole chain
 * would state a distance between two points the student never picked.
 *
 * `point` is the resolved model point of the click, used only to decide WHICH
 * segment - never as the measurement itself.
 */
function dimensionReferenceForFeature(
    object,
    point
) {
    if (!object) {
        return null;
    }

    const segment = compositeSegmentReference(
        object,
        point
    );

    if (segment) {
        return segment;
    }

    const span = twoPointSpanOf(object);

    if (span) {
        return {
            kind: "line",
            featureId: object.id,
            anchor: "start",
            endAnchor: "end",
            object
        };
    }

    const geometry = object.geometry || {};

    /*
     * ========================================================
     * A CIRCLE OR AN ARC OFFERS EVERY MEASUREMENT IT SUPPORTS
     * ========================================================
     *
     * THIS IS THE CIRCLE-DIMENSION DEFECT. The reference used to name ONE
     * measurement - a circle always "diameter", an arc always "radius" - so a
     * circle could never be measured by its RADIUS, an arc could never be
     * measured by its ARC LENGTH, and Tab had nothing to cycle because there was
     * only ever one candidate.
     *
     * The measurement layer ALREADY knows what each shape can state:
     *
     *     circle   diameter, radius, coordinate
     *     arc      radius, arc-length, diameter, angular
     *
     * so those are carried here as the `refs` of ONE reference of kind
     * `circular`, in the layer's own order, and `inferDimensionDescriptor`
     * expands them into the candidate list Tab cycles through. The FIRST is the
     * default; the cursor then biases the choice (see `preferredCircularType`).
     *
     * The reference stays PERSISTENT: it names the feature and an anchor, never a
     * frozen coordinate, so a circular dimension follows its circle or arc when
     * the geometry moves - exactly as every other reference does.
     */
    if (
      (object.type === "circle" || object.type === "arc") &&
      Number.isFinite(Number(geometry.radius))
    ) {
      const offered = circularMeasurementTypes(object);

      return {
        kind: "circular",
        featureId: object.id,
        dimensionType: preferredCircularType(object, point, offered),
        offered,
        anchor: object.type === "circle" ? "east" : "center",
        object
      };
    }

    /*
     * Anything else - a shaft with a stored diameter, a polygon, a
     * rectangle - is offered through the measurement layer, which is
     * the one place that knows what each feature can be measured as.
     */
    const descriptors =
        dimensionDescriptorsFor([object]);

    if (!descriptors.length) {
        return null;
    }

    const choice = descriptors[0];

    if (!choice?.refs?.length) {
        return null;
    }

    return {
        kind: "feature",
        featureId: object.id,
        dimensionType: choice.dimensionType,
        refs: choice.refs,
        object
    };
}

/*
 * A composite feature referenced by the SEGMENT nearest the click.
 *
 * Returns a LINE reference whose two anchors name the segment's own ends, so
 * selecting one segment of a polyline dimensions that segment and nothing
 * else. Null for anything that is not a composite chain of segments, and null
 * when no point was supplied - a caller that only has the feature cannot say
 * which segment was meant, and guessing the first would be worse than falling
 * back to the feature's own measurement.
 *
 * The segment's endpoints are found by NAME through the measurement layer
 * (`segment{i}Start` / `segment{i}End`), which is what keeps the reference
 * persistent: the anchors are re-resolved from the polyline's current points
 * every time, so the dimension follows the feature when it moves.
 */
function compositeSegmentReference(object, point) {
    if (!point || !Number.isFinite(point.x)) {
        return null;
    }

    if (
        object.type !== "polyline" &&
        object.type !== "rectangle" &&
        object.type !== "triangle"
    ) {
        return null;
    }

    const points = compositeSegmentPoints(object);

    if (points.length < 2) {
        return null;
    }

    let bestIndex = -1;
    let bestDistance = Infinity;

    for (let index = 0; index < points.length - 1; index += 1) {
        const distance = distanceToSegment(
            point,
            points[index],
            points[index + 1]
        );

        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = index;
        }
    }

    if (bestIndex < 0) {
        return null;
    }

    return {
        kind: "line",
        featureId: object.id,
        anchor: `segment${bestIndex}Start`,
        endAnchor: `segment${bestIndex}End`,
        object
    };
}

/*
 * The points a composite feature's segments run between.
 *
 * A polyline's points are its geometry; a rectangle's are its four corners,
 * taken through the same helper the measurement layer uses so the two cannot
 * disagree about where the body is.
 */
function compositeSegmentPoints(object) {
    if (object.type === "polyline") {
        return (object.geometry?.points || [])
            .filter(
                (entry) =>
                    entry &&
                    Number.isFinite(entry.x) &&
                    Number.isFinite(entry.y)
            );
    }

    /*
     * A TRIANGLE IS THREE SEGMENTS, NOT A RECTANGLE.
     *
     * It used to fall through to the rectangle branch below, so a triangle's
     * "corners" were asked of `rectangleCorners` - which does not describe a
     * triangle and returned nothing usable. The nearest-edge test then had no
     * edges to test, and every click on the shape resolved through the
     * feature's own `start`/`end` instead: the same two points whatever the
     * student clicked, which is why one side always won.
     *
     * The chain is CLOSED, so the third side exists. An open chain of three
     * points describes only two edges, and the side that was missing is
     * exactly the one a student would try to click.
     */
    if (object.type === "triangle") {
        const points = (object.geometry?.points || [])
            .filter(
                (entry) =>
                    entry &&
                    Number.isFinite(entry.x) &&
                    Number.isFinite(entry.y)
            );

        if (points.length < 3) {
            return [];
        }

        return [points[0], points[1], points[2], { ...points[0] }];
    }

    try {
        return (
            enggFeatureGeometry?.rectangleCorners?.(
                object.geometry || {}
            ) || []
        ).filter(
            (entry) =>
                entry &&
                Number.isFinite(entry.x) &&
                Number.isFinite(entry.y)
        );
    } catch (error) {
        return [];
    }
}

/*
 * The two-point span of a straight feature, or null.
 *
 * Read through the measurement layer rather than off `geometry`
 * directly, so every straight body - a line, a beam, a cable, a shaft,
 * a truss member - is recognised by the same test the measurement
 * itself uses.
 */
export function twoPointSpanOf(object) {
    try {
        return enggMeasurement.twoPointSpan(object);
    } catch (error) {
        return null;
    }
}

/*
 * ========================================================
 * DIMENSION: INFERRING THE MEASUREMENT
 * ========================================================
 *
 * From one or two references, decide what should be measured. This is
 * the heart of the Dimension tool and the reason the tool needs no mode
 * switch:
 *
 *   one line            its full length
 *   one circle          its diameter
 *   one arc             its radius
 *   two lines           the angle between them
 *   point + line        the perpendicular distance to the line
 *   two points          a distance, oriented by the model geometry
 *
 * The orientation of a two-point distance comes from MODEL geometry,
 * never from the screen: two points on the same straight body are
 * measured along that body's axis, however it is rotated on screen.
 */
export function inferDimensionDescriptor(
    first,
    second
) {
    if (!first) {
        return null;
    }

    /*
     * ONE REFERENCE.
     */
    if (!second) {
        if (first.kind === "point") {
            /*
             * A single point is not yet a dimension: the tool waits for
             * the second reference rather than measuring a point to
             * itself.
             */
            return null;
        }

        if (first.kind === "line") {
            return lineLengthDescriptor(first);
        }

        if (first.kind === "circle" || first.kind === "arc") {
            return {
                dimensionType: first.dimensionType,
                refs: [
                    {
                        kind: "between",
                        featureId: first.featureId,
                        anchor: first.anchor
                    }
                ]
            };
        }

        /*
         * ========================================================
         * A CIRCLE OR AN ARC RETURNS ITS PRIMARY MEASUREMENT
         * ========================================================
         *
         * ONE descriptor here, as for every other reference - the caller expects
         * a single choice. The FULL candidate list a circle or an arc offers is
         * built by `circularCandidateDescriptors` and passed to the placement as
         * `dimensionCandidates`, so Tab can cycle it.
         *
         * Returning an array here was the tempting mistake: every caller of this
         * function reads `descriptor.dimensionType` and `descriptor.refs`, so an
         * array would have been a descriptor-shaped hole in the interaction -
         * the preview, the commit and the panel would all have read undefined.
         */
        if (first.kind === "circular") {
            return {
                dimensionType: first.dimensionType,
                refs: [
                    {
                        kind: "between",
                        featureId: first.featureId,
                        anchor: first.anchor
                    }
                ]
            };
        }

        if (first.kind === "feature") {
            return {
                dimensionType: first.dimensionType,
                refs: first.refs
            };
        }

        return null;
    }

    /*
     * TWO REFERENCES.
     */
    if (first.kind === "line" && second.kind === "line") {
        /*
         * Two lines: the angle between them, unless they are the SAME
         * LINE - which has no angle to itself.
         *
         * SAME LINE means the same SUB-GEOMETRY, not merely the same
         * feature. Two edges of one rectangle, or two segments of one
         * polyline, are two different lines that genuinely have an
         * angle between them - and comparing only the feature id
         * refused both, because a rectangle is one feature however many
         * edges it has. The anchors name which edge or segment each
         * reference is, so they are what decides identity here.
         *
         * A reference with no anchor at all is the whole feature, and
         * two of those ARE the same line.
         */
        if (sameLineReference(first, second)) {
            return null;
        }

        /*
         * THE DIRECTION OF THE REFERENCED SUB-GEOMETRY, not of the
         * whole object.
         *
         * `directionOfFeature` reads a feature's overall start-to-end
         * span, and a rectangle or a polyline HAS no such span - one is
         * a closed chain and the other is a chain of segments - so the
         * two edges of a single part measured nothing at all. The
         * reference already knows WHICH edge was picked, so its own
         * two ends are the direction to use, whatever shape the
         * feature around them happens to have.
         */
        const spanA = referenceSpan(first);
        const spanB = referenceSpan(second);

        const unitA = spanUnitDirection(spanA);
        const unitB = spanUnitDirection(spanB);

        if (!unitA || !unitB) {
            return null;
        }

        /*
         * PARALLEL SIDES ARE A DISTANCE, NOT A ZERO ANGLE.
         *
         * Two parallel lines have no meaningful included angle - zero
         * is a claim that they are the same line - but they do have a
         * real separation, and that is the measurement a reader wants.
         * The cross product of two parallel directions is zero, which
         * is exactly the test, and it is scale-free because both
         * directions are unit vectors.
         */
        const parallel =
            Math.abs(
                unitA.x * unitB.y - unitA.y * unitB.x
            ) < 1e-6;

        if (parallel) {
            return perpendicularDistanceDescriptor(
                first,
                second
            );
        }

        return {
            dimensionType: "angular",
            refs: [
                {
                    kind: "between",
                    featureId: first.featureId,
                    anchor: first.anchor || "end"
                },
                {
                    kind: "between",
                    featureId: second.featureId,
                    anchor: second.anchor || "end"
                }
            ]
        };
    }

    if (first.kind === "point" && second.kind === "point") {
        return pointPairDescriptor(
            first.ref,
            second.ref
        );
    }

    /*
     * Point + line, in either order: the perpendicular distance from the
     * point to the line. Measured through the line's own ends so the
     * value comes from the model geometry.
     */
    const pointRef =
        first.kind === "point"
            ? first
            : second.kind === "point"
              ? second
              : null;

    const lineRef =
        first.kind === "line"
            ? first
            : second.kind === "line"
              ? second
              : null;

    if (pointRef && lineRef) {
        return pointToLineDescriptor(
            pointRef.ref,
            lineRef
        );
    }

    return null;
}

/*
 * A line reference's two ends, as model points.
 *
 * For a plain straight body this is the feature's own span. For a SEGMENT of a
 * composite feature - a polyline segment, a rectangle edge - the object has no
 * overall span, so the ends are resolved from the anchors the reference names.
 * That is what lets one segment of a polyline be dimensioned by its own length
 * rather than by the whole chain's first-to-last distance.
 *
 * Null when either end cannot be resolved, so a dimension over a segment that
 * no longer exists is refused rather than measured from a stray point.
 */
function referenceSpan(lineRef) {
    const direct = twoPointSpanOf(lineRef?.object);

    if (direct) {
        return direct;
    }

    if (!lineRef?.object || !lineRef.anchor || !lineRef.endAnchor) {
        return null;
    }

    const start = enggMeasurement.resolveAnchor(
        lineRef.object,
        lineRef.anchor
    );

    const end = enggMeasurement.resolveAnchor(
        lineRef.object,
        lineRef.endAnchor
    );

    if (!start || !end) {
        return null;
    }

    return { start, end };
}

/*
 * A span's direction as a unit vector, or null.
 *
 * The unit length is what makes a parallelism test scale-free: the cross
 * product of two unit directions is the sine of the angle between them,
 * so comparing it with a small tolerance asks "are these parallel"
 * independently of how long either line happens to be or which units it
 * is drawn in.
 *
 * Null for a degenerate span, because a line of no length has no
 * direction to be parallel to or to make an angle with.
 */
function spanUnitDirection(span) {
    if (!span?.start || !span?.end) {
        return null;
    }

    const deltaX = span.end.x - span.start.x;
    const deltaY = span.end.y - span.start.y;

    const length = Math.hypot(deltaX, deltaY);

    if (length < 1e-9) {
        return null;
    }

    return { x: deltaX / length, y: deltaY / length };
}

/*
 * A single line, dimensioned by its full length.
 *
 * The orientation follows the line: an exactly horizontal line is
 * dimensioned horizontally, an exactly vertical one vertically, and
 * anything else by its true aligned length. That is what makes a
 * rotated member read its own span rather than the horizontal distance
 * between its ends.
 */
function lineLengthDescriptor(lineRef) {
    const span = referenceSpan(lineRef);

    if (!span) {
        return null;
    }

    return {
        dimensionType: spanDimensionType(
            span.start,
            span.end
        ),
        refs: [
            {
                kind: "between",
                featureId: lineRef.featureId,
                anchor: lineRef.anchor || "start"
            },
            {
                kind: "between",
                featureId: lineRef.featureId,
                anchor: lineRef.endAnchor || "end"
            }
        ]
    };
}

/*
 * Two points, measured as a distance.
 *
 * The orientation is chosen from the MODEL points, and it is chosen in
 * this order:
 *
 *   1. both points on the same straight body -> along that body's axis
 *   2. strongly horizontally aligned         -> horizontal
 *   3. strongly vertically aligned           -> vertical
 *   4. otherwise                             -> the direct aligned distance
 *
 * The tolerance for "strongly aligned" is a slope, so it is independent
 * of zoom and of how long the span happens to be.
 */
function pointPairDescriptor(firstRef, secondRef) {
    const firstPoint = resolveRefPoint(firstRef);
    const secondPoint = resolveRefPoint(secondRef);

    if (!firstPoint || !secondPoint) {
        return null;
    }

    /*
     * The same reference twice has no distance to state. Refused rather
     * than measured as a zero dimension, which would be a malformed
     * feature on the sheet.
     */
    if (
        firstRef.featureId === secondRef.featureId &&
        firstRef.anchor === secondRef.anchor
    ) {
        return null;
    }

    const dimensionType = pairOrientation(
        firstRef,
        secondRef,
        firstPoint,
        secondPoint
    );

    return {
        dimensionType,
        refs: [
            {
                kind: "between",
                featureId: firstRef.featureId,
                anchor: firstRef.anchor
            },
            {
                kind: "between",
                featureId: secondRef.featureId,
                anchor: secondRef.anchor
            }
        ]
    };
}

/*
 * Which of horizontal / vertical / aligned a point pair should use.
 *
 * Two points on one straight body are measured ALONG it - a dimension
 * between two positions on a rotated beam must follow the beam, not
 * become horizontal because the screen says so.
 */
function pairOrientation(
    firstRef,
    secondRef,
    firstPoint,
    secondPoint
) {
    /*
     * Both references on the SAME straight feature: follow its axis. A
     * beam measured end-to-end along its own length is the measurement a
     * reader checks.
     */
    if (firstRef.featureId === secondRef.featureId) {
        const object = objectWithId(firstRef.featureId);

        if (object && twoPointSpanOf(object)) {
            return "aligned";
        }
    }

    const deltaX = Math.abs(secondPoint.x - firstPoint.x);
    const deltaY = Math.abs(secondPoint.y - firstPoint.y);

    const span = Math.hypot(deltaX, deltaY);

    if (span < 1e-9) {
        return "aligned";
    }

    /*
     * "Strongly aligned" means the off-axis component is a small
     * fraction of the span - a ratio, so zoom cannot change the answer.
     */
    if (deltaY / span < 0.05) {
        return "horizontal";
    }

    if (deltaX / span < 0.05) {
        return "vertical";
    }

    return "aligned";
}

/*
 * Whether two line references name the SAME piece of geometry.
 *
 * Not the same as "the same feature". A rectangle is one feature with
 * four edges; a polyline is one feature with a segment per pair of
 * points. Two of those edges are two different lines that genuinely
 * have an angle or a distance between them, so identity has to be
 * decided from what a reference POINTS AT, which is its anchor, rather
 * than from the feature id alone.
 *
 * Two whole-feature references - a Beam against a Beam, where neither
 * names a sub-element - are the same line when they name the same
 * feature, because there is only one line in it to mean.
 */
function sameLineReference(
    first,
    second
) {
    if (!first || !second) {
        return false;
    }

    if (first.featureId !== second.featureId) {
        return false;
    }

    /*
     * A WHOLE-FEATURE REFERENCE IS ITS OWN ANCHOR, so two of them
     * coincide. The `|| ""` makes an absent anchor and an empty one the
     * same thing, which they are.
     */
    return (
        String(first.anchor || "") ===
        String(second.anchor || "")
    );
}

/*
 * The distance between two PARALLEL lines.
 *
 * Parallel lines have no included angle - zero would be a claim that
 * they are the same line - but they do have a real separation, and that
 * is the measurement a reader wants between two parallel sides of a
 * part.
 *
 * Measured perpendicular from the second line to the first line's
 * INFINITE direction, which is what the distance between two parallel
 * lines means: it does not vary along their length, so it must not
 * depend on which ends happen to line up. The three references are the
 * same shape a point-to-line measurement uses - a point on each line
 * carried as the far end and the two ends of the line measured to - so
 * the existing renderer draws it as the perpendicular it is.
 *
 * Null when either span is degenerate, because a line of no length has
 * no direction to be parallel to.
 */
function perpendicularDistanceDescriptor(
    first,
    second
) {
    const spanA = referenceSpan(first);
    const spanB = referenceSpan(second);

    if (!spanA || !spanB) {
        return null;
    }

    /*
     * TWO PERSISTENT REFERENCES, each one end of a line - not a frozen
     * midpoint. The distance is recomputed from the live geometry every
     * time, so moving either line updates it.
     */
    return {
        dimensionType: "point-line",
        refs: [
            {
                kind: "between",
                featureId: second.featureId,
                anchor: second.anchor || "start"
            },
            {
                kind: "between",
                featureId: first.featureId,
                anchor: first.anchor || "start"
            },
            {
                kind: "between",
                featureId: first.featureId,
                anchor: first.endAnchor || "end"
            }
        ]
    };
}

/*
 * A point measured against a line: the perpendicular distance.
 *
 * The measurement is a POINT-LINE dimension, not an aligned one, because the
 * two state different numbers. An aligned dimension is the straight distance
 * between its two points; this is the perpendicular distance from the point to
 * the line's direction, which is shorter whenever the foot of the perpendicular
 * falls outside the drawn extent - and is the number a reader checking a
 * clearance expects.
 *
 * The references stay persistent and are THREE: the point, then the line's two
 * ends. Both ends are kept so the perpendicular is recomputed from the line's
 * current geometry, which is what makes the measurement follow the line when it
 * moves or rotates rather than freezing the distance at the moment of clicking.
 */
function pointToLineDescriptor(pointRef, lineRef) {
    const span = twoPointSpanOf(lineRef.object);

    if (!span) {
        return null;
    }

    return {
        dimensionType: "point-line",
        refs: [
            {
                kind: "between",
                featureId: pointRef.featureId,
                anchor: pointRef.anchor
            },
            {
                kind: "between",
                featureId: lineRef.featureId,
                anchor: lineRef.anchor || "start"
            },
            {
                kind: "between",
                featureId: lineRef.featureId,
                anchor: lineRef.endAnchor || "end"
            }
        ]
    };
}

/*
 * The dimension type a straight span should use.
 */
function spanDimensionType(start, end) {
    const deltaX = Math.abs(end.x - start.x);
    const deltaY = Math.abs(end.y - start.y);

    if (deltaY <= 1e-9) {
        return "horizontal";
    }

    if (deltaX <= 1e-9) {
        return "vertical";
    }

    return "aligned";
}

/*
 * A stored reference resolved to its current model point.
 */
function resolveRefPoint(reference) {
    if (!reference?.featureId) {
        return null;
    }

    const object = objectWithId(reference.featureId);

    if (!object) {
        return null;
    }

    return enggMeasurement.resolveAnchor(
        object,
        reference.anchor
    );
}
