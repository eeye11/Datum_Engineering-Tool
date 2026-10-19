/* Engineering drawing object snapping and geometric inference. */
import enggLoadProfile from "../../features/workspace/model/analysis/load-profile.js";
import enggBodyFrames from "../geometry/body-frames.js";
import enggFeatureGeometry from "../geometry/feature-geometry.js";
import enggDrawingState from "../model/drawing-state.js";

/*
 * ========================================================
 * HOW CLOSE THE CURSOR MUST BE TO SNAP TO A NAMED POINT
 * ========================================================
 *
 * Five pixels, and the argument for a small number is not that a
 * large one is wrong but that a large one is UNRECOVERABLE.
 *
 * A generous tolerance is usually defended as being kind to a
 * trackpad user who cannot land on a pixel. But the cost of being
 * generous is not paid by the person who wanted the wider band; it is
 * paid by the person lining a member up PAST a row of features, who
 * finds the next one along grabbing the cursor a dozen pixels clear of
 * it. There is no way to recover from that except to move further
 * away and try again, and the further away they go to escape it the
 * more likely they are to be caught by something else. A tolerance
 * that is too wide cannot be worked around; one that is too narrow
 * can, by zooming in.
 *
 * IT WAS FIFTEEN, AND THAT IS THE STICKINESS THAT WAS REPORTED.
 *
 * Fifteen pixels is about the width of a support symbol and wider
 * than the gap between two ordinary snap targets on a dense beam, so
 * the feature being passed was more likely to be caught than missed.
 * Fifteen is a number that feels reasonable in isolation and is
 * unusable in practice, which is why it survived being written down
 * as deliberate.
 *
 * Five is still forgiving - it is five screen pixels, at any zoom,
 * because the measurement is in screen space and the zoom is already
 * applied to the coordinates being compared - and it is narrow enough
 * that a cursor travelling along a member passes its targets instead
 * of being captured by them.
 *
 * THE TRUSS MULTIPLIER IS GONE WITH IT, and that is deliberate. It
 * widened the tolerance for truss work because truss joints sit close
 * together - which is an argument for aiming better, not for a
 * catch radius wide enough to make the wrong joint likely. A truss is
 * now snapped with the same 5 px as everything else, so a snap that
 * works on a beam works identically on a truss, and there is no
 * second tolerance in the system to remember which rule applied.
 */
const SNAP_TOLERANCE_PX = 5;

/*
 * How far off horizontal or vertical the cursor may be and
 * still be pulled into line.
 *
 * SEVEN DEGREES. It is the band a drafting package conventionally
 * uses, and it is tight for the same reason the snap tolerance is
 * tight: an inference that catches the cursor too early takes the
 * decision away from the user, who then has to move further out to
 * escape it - and the further out they go, the more likely they are
 * to be caught by something else instead.
 *
 * It was 12 degrees, which reads as a small difference and is not
 * one: at a 200 mm chord the 12-degree band is about 42 mm wide, so
 * a member intended 10 degrees off horizontal was silently snapped
 * flat. The indicator said "Horizontal" and the geometry was not
 * what the student drew.
 *
 * Wider than the 5 px point tolerance because alignment is a
 * DIRECTION rather than a place: the user is lining a member up with
 * a chord, and the chord is often long and thin, so aiming precisely
 * along it is harder than aiming at its end. That is an argument for
 * a few degrees more than the point tolerance, not for a band wide
 * enough to alter the drawing.
 */
const INFERENCE_TOLERANCE_DEGREES = 7;

/*
 * ========================================================
 * NO PER-TOOL WIDENING
 * ========================================================
 *
 * There used to be a table of per-tool tolerance multipliers, and one
 * tool in it.
 *
 * A per-tool tolerance is a way of saying "this tool needs to be
 * less accurate", and the consequence is that a snap behaves
 * differently depending on which tool is armed while doing the same
 * kind of aim. That is the definition of a rule a user has to learn
 * and cannot see: they aim at a joint on a truss, get caught, move
 * slightly, and get caught by a different one - with nothing on
 * screen to say the tolerance had changed underneath them.
 *
 * One tolerance for the whole sheet is the only version of this that
 * is predictable, and predictable is what snapping is for. A tool
 * that genuinely needs a wider catch is a tool whose TARGETS are too
 * close together, and the answer to that is better candidates or a
 * smaller drawing - not a different radius.
 */
const TOOL_SNAP_TOLERANCE_MULTIPLIER = {};

const DEFAULT_SNAP_TOLERANCE_MULTIPLIER = 1;

/*
 * The tolerance for the construction currently running.
 *
 * Read from the live interaction as well as the armed tool,
 * because a construction keeps its own tool identity after
 * the student has moved on: a truss whose panels are being
 * added is still a truss, and must still be forgiving,
 * even though the click that began it is over.
 *
 * With no per-tool multipliers left this returns 1 always. It is
 * KEPT rather than deleted because it is the single point through
 * which every tolerance passes - a future tool that does need a
 * different band changes this function and nothing else, rather than
 * every call site learning about it.
 */
function getToolToleranceMultiplier(
    state
) {
    const ids = [
        state?.interaction?.snapToolId,
        state?.activeTool
    ];

    for (const id of ids) {
        if (!id) {
            continue;
        }

        const multiplier =
            TOOL_SNAP_TOLERANCE_MULTIPLIER[id];

        if (Number.isFinite(multiplier)) {
            return multiplier;
        }
    }

    return DEFAULT_SNAP_TOLERANCE_MULTIPLIER;
}

const SNAP_PRIORITY = {
    endpoint: 1,
    intersection: 2,
    center: 3,
    midpoint: 4,

    /*
     * A quarter point is a derived position along a member,
     * so it is offered only after the real joints and the
     * midpoint. It must never outrank an endpoint: placing a
     * new joint on a quarter of an existing panel is useful,
     * but snapping to the panel's own end is more likely to
     * be what was meant.
     */
    quarter: 5,

    quadrant: 6,
    pointOnEntity: 7,

    /*
     * A MEMBER'S CENTRELINE.
     *
     * Ranked just above a point merely ON an object, and well below
     * the object's own endpoints and midpoint.
     *
     * The ranking is the honest description of what it is: a line
     * along a body rather than a marked point on it, and a support
     * wants the line. It is below endpoints because a student
     * aiming at the very end of a beam has usually aimed at the
     * end, and the centreline must not quietly move the
     * attachment to somewhere they did not mean.
     */
    centreline: 5,

    /*
     * A diagram's reference station.
     *
     * Ranked BELOW every real feature, and below pointOnEntity too.
     *
     * It is a convenience - it tells a student where a load sits
     * along a beam so their diagram lines up with it - and a
     * convenience must never win against something actually drawn.
     * A station that sat alongside endpoints would let a diagram
     * marker capture a click aimed at the axis next to it, and
     * the axis is the thing the student is more likely to mean.
     */
    "analysis-reference": 8
};

const CONSTRUCTION_TYPES = new Set([
    "point",
    "line",
    "polyline",
    "rectangle",
    "circle",
    "arc"
]);

function distance(first, second) {
    return Math.hypot(
        second.x - first.x,
        second.y - first.y
    );
}

function addCandidate(
    candidates,
    type,
    objectId,
    candidatePoint,
    label
) {
    if (
        !candidatePoint ||
        !Number.isFinite(candidatePoint.x) ||
        !Number.isFinite(candidatePoint.y)
    ) {
        return;
    }

    const candidate = {
        type,
        objectId,
        point: {
            x: candidatePoint.x,
            y: candidatePoint.y
        },
        priority:
            SNAP_PRIORITY[type]
    };

    /*
     * AN OPTIONAL NAME, shown in the bottom-of-screen message.
     *
     * A diagram's reference markers say what they are - the
     * station a load sits on, the one a support sits on - and a
     * student aiming at a marker needs to know they have snapped
     * to the right one. Without a label every snap reads
     * "Endpoint", which is true and useless.
     *
     * Left off everywhere else, so the existing messages are
     * unchanged.
     */
    if (label) {
        candidate.label = label;
    }

    candidates.push(candidate);
}

function getTolerancePx(state) {
    const configured =
        Number(
            state?.objectSnap?.tolerancePx
        );

    if (
        Number.isFinite(configured) &&
        configured > 0
    ) {
        return (
            configured *
            getToolToleranceMultiplier(
                state
            )
        );
    }

    return (
        SNAP_TOLERANCE_PX *
        getToolToleranceMultiplier(
            state
        )
    );
}

/*
 * ========================================================
 * THE CATCH BAND FOR ALIGNMENT
 * ========================================================
 *
 * Stated here, in its own right, and NOT derived from the point
 * tolerance.
 *
 * Alignment asks "is this line the direction I am drawing?", which is
 * judged against a whole member rather than against a dot, and the
 * cursor is commonly a good way off the axis while the student is
 * still lining the member up. Squeezing the point tolerance from 15
 * to 5 to fix the stickiness must not drag alignment in with it: that
 * would have made the band 7.5 px, too tight to feel like it works,
 * and the complaint would have moved rather than gone.
 *
 * So the two bands are stated separately and neither is derived from
 * the other. 5 px to hit a dot; 24 px to hold a direction.
 */
const ALIGNMENT_TOLERANCE_PX = 24;

function getInferenceTolerancePx(state) {
    const configured =
        Number(
            state?.objectSnap?.inferenceTolerancePx
        );

    if (
        Number.isFinite(configured) &&
        configured > 0
    ) {
        return configured;
    }

    return ALIGNMENT_TOLERANCE_PX;
}

function normalizeAngle(angle) {
    const twoPi =
        Math.PI * 2;

    return (
        (
            angle %
            twoPi
        ) +
        twoPi
    ) %
    twoPi;
}

function angleOnDirectedArc(
    angle,
    startAngle,
    endAngle,
    sweep
) {
    const twoPi =
        Math.PI * 2;

    const current =
        normalizeAngle(angle);

    const start =
        normalizeAngle(startAngle);

    const direction =
        sweep === -1
            ? -1
            : 1;

    let travelled;
    const rawTotal = direction > 0
        ? endAngle - startAngle
        : startAngle - endAngle;

    if (rawTotal >= twoPi - 1e-9) {
        return true;
    }

    let total;

    if (direction > 0) {
        travelled =
            normalizeAngle(
                current - start
            );

        total = normalizeAngle(rawTotal);
    } else {
        travelled =
            normalizeAngle(
                start - current
            );

        total = normalizeAngle(rawTotal);
    }

    if (
        total <
        1e-9
    ) {
        return true;
    }

    return (
        travelled <=
        total + 1e-9
    );
}

function getArcSweep(
    geometry
) {
    if (
        geometry.sweep === -1
    ) {
        return -1;
    }

    if (
        geometry.sweep === 1
    ) {
        return 1;
    }

    return geometry.endAngle >=
        geometry.startAngle
        ? 1
        : -1;
}

function rectangleCorners(
    geometry
) {
    const left =
        geometry.position.x;

    const right =
        geometry.position.x +
        geometry.width;

    const bottom =
        geometry.position.y;

    const top =
        bottom +
        geometry.height;

    const rotation =
        (
            Number(
                geometry.rotation
            ) || 0
        ) *
        Math.PI /
        180;

    const center = {
        x:
            (
                left +
                right
            ) / 2,

        y:
            (
                top +
                bottom
            ) / 2
    };

    const localCorners = [
        {
            x: left,
            y: top
        },
        {
            x: right,
            y: top
        },
        {
            x: right,
            y: bottom
        },
        {
            x: left,
            y: bottom
        }
    ];

    if (
        Math.abs(rotation) <
        1e-12
    ) {
        return localCorners;
    }

    const cosine =
        Math.cos(rotation);

    const sine =
        Math.sin(rotation);

    return localCorners.map(
        corner => {
            const dx =
                corner.x -
                center.x;

            const dy =
                corner.y -
                center.y;

            return {
                x:
                    center.x +
                    dx * cosine -
                    dy * sine,

                y:
                    center.y +
                    dx * sine +
                    dy * cosine
            };
        }
    );
}

function rectangleSegments(
    geometry
) {
    const corners =
        rectangleCorners(
            geometry
        );

    return [
        [
            corners[0],
            corners[1]
        ],
        [
            corners[1],
            corners[2]
        ],
        [
            corners[2],
            corners[3]
        ],
        [
            corners[3],
            corners[0]
        ]
    ];
}

/*
 * THE CANDIDATE TYPES A TOOL WILL ACCEPT.
 *
 * Snapping is not one thing, it is several: a support is attached
 * to a body's centreline, a dimension measures between real
 * features, a truss wants quarter points, and a student drawing a
 * free line wants whatever is actually under the pointer. A single
 * shared list of candidates for every tool is what produced the
 * fault this fixes - a support could be caught by the bottom edge
 * of a beam, or by a point somewhere inside it, and had to be
 * dropped on the exact surface to come out underneath.
 *
 * So a tool declares what it attaches to, and the candidates are
 * FILTERED rather than replaced. The face snapping a beam still
 * publishes is untouched for a force - a load applied to the top
 * face really is applied there - and simply is not offered to a
 * support. Nothing is removed from the shared system; the tools
 * disagree about which parts of it apply to them.
 *
 * `null` means "everything", which is the default and the right
 * answer for the overwhelming majority of tools.
 */
const TOOL_CANDIDATE_TYPES = {
    /*
     * THE SUPPORTS.
     *
     * A support is attached to the member's centreline and is
     * drawn outside it, so the centreline is the only thing it may
     * catch. Its own ends are allowed as well - a support at the
     * very end of a beam is a real thing, and refusing it would
     * mean the commonest case at all, a pin under each end, could
     * not be placed.
     *
     * Everything else a beam publishes - its two faces, its
     * midpoint, its quarters - is refused. The faces are the
     * reason this filter exists: they exist so a force can be
     * applied to a surface, and without the filter they were
     * catching supports too and putting them half inside the
     * member.
     */
    "pin-support": [
        "centreline",
        "endpoint",
        "intersection",
        "reference-point"
    ],
    "roller-support": [
        "centreline",
        "endpoint",
        "intersection",
        "reference-point"
    ],
    "fixed-support": [
        "centreline",
        "endpoint",
        "intersection",
        "reference-point"
    ],
    "smooth-support": [
        "centreline",
        "endpoint",
        "intersection",
        "reference-point"
    ]
};

/*
 * Is this candidate something the active tool will accept?
 *
 * Asked at the one point where the shortlist is built, so an
 * unacceptable candidate is never even measured - which matters
 * for more than tidiness: a face candidate the tool would never
 * take still costs a distance calculation on every pointer move,
 * and a filter applied after the search would be a filter applied
 * to the wrong candidate.
 */
function candidateIsValidForTool(
    candidate,
    toolId
) {
    const allowed =
        TOOL_CANDIDATE_TYPES[toolId];

    if (!allowed) {
        return true;
    }

    return allowed.includes(
        candidate.type
    );
}

/*
 * A WHOLE LINE AS A SNAP TARGET.
 *
 * Not a set of points on it. A centreline is something a support
 * is placed ALONG, and publishing only its ends and its middle
 * would mean the commonest thing anyone does with a support -
 * putting one at midspan - needed a lucky aim, and putting one a
 * third of the way along was impossible at all.
 *
 * The candidate is the line itself and the snap is measured
 * against it, so the pointer can be anywhere near the member and
 * the attachment is the point ON the member nearest the pointer.
 * That is the same tolerance and the same indicator every other
 * snap uses, because it goes through the same machinery.
 */
function addSegment(
    candidates,
    objectId,
    start,
    end,
    type = "centreline"
) {
    /*
     * The point check is INLINED rather than delegated.
     *
     * This file has no `isPoint` helper - it spells the test out
     * everywhere - and calling one that does not exist throws a
     * ReferenceError from inside candidate building. That throw
     * happens on EVERY snap, for EVERY tool, because building the
     * candidates is the first thing a snap does: so one missing
     * name took down all snapping in the application, and every
     * tool that depends on it, while every unit test of the model
     * still passed.
     *
     * Worth stating why that was invisible: nothing was wrong with
     * any feature, every factory worked, and the drawing rendered.
     * Only the interaction died.
     */
    if (
        !start || !end ||
        !Number.isFinite(start.x) ||
        !Number.isFinite(start.y) ||
        !Number.isFinite(end.x) ||
        !Number.isFinite(end.y)
    ) {
        return;
    }

    candidates.push({
        type,
        objectId,
        priority: SNAP_PRIORITY[type] ?? 3,

        /*
         * The line, not a point. The snap search measures the
         * pointer against it directly, so the candidate's `point`
         * is absent by design - there is no single point on a line
         * to name.
         */
        segment: {
            start: { x: start.x, y: start.y },
            end: { x: end.x, y: end.y }
        }
    });
}

function segmentCandidates(
    candidates,
    objectId,
    start,
    end,
    quarterSnap = false
) {
    addCandidate(
        candidates,
        "endpoint",
        objectId,
        start
    );

    addCandidate(
        candidates,
        "endpoint",
        objectId,
        end
    );

    addCandidate(
        candidates,
        "midpoint",
        objectId,
        segmentPointAt(
            start,
            end,
            0.5
        )
    );

    /*
     * The quarter points.
     *
     * A structural member is most usefully divided into
     * quarters, not just halves: a new panel is usually
     * wanted at a quarter of the span of the one beside it,
     * and offering only the midpoint forces the student to
     * place the joint by eye.
     *
     * They are published here, from the one function that
     * publishes a span's points, so every span of one feature
     * gets them at the same tolerance and the same priority
     * as its endpoints and midpoint. A quarter point is a
     * weaker target than an endpoint, so it sits below them
     * in the priority order and never steals a snap that
     * should have been a joint.
     *
     * TRUSS ONLY. `quarterSnap` is the feature's declared
     * capability, so a Beam, a Cable, a Shaft, a load, a
     * support, a connection, a dimension or an annotation
     * offers endpoints, a midpoint and a point-on-object and
     * never offers a quarter. Keeping the rule at the
     * publishing point rather than filtering afterwards
     * means the extra candidates are never even built.
     */
    if (!quarterSnap) {
        return;
    }

    [0.25, 0.75].forEach(ratio => {
        addCandidate(
            candidates,
            "quarter",
            objectId,
            segmentPointAt(
                start,
                end,
                ratio
            )
        );
    });
}

/*
 * A point a given fraction of the way along a segment.
 *
 * Every published point of a span is one of these, so the
 * endpoints, the midpoint and the quarter points are
 * computed in exactly one way and cannot disagree about
 * where they are.
 */
function segmentPointAt(
    start,
    end,
    ratio
) {
    return {
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio
    };
}

/*
 * The four arm end points of a coordinate system.
 *
 * Kept local to the snap module so snapping can use
 * the axis extents without reaching into the drawing
 * controller.
 */
function coordinateSystemArmEnds(
    geometry
) {
    const origin =
        geometry?.origin;

    if (!origin) {
        return [];
    }

    const fallback =
        Number.isFinite(Number(geometry.axisLength)) &&
        Number(geometry.axisLength) > 0
            ? Number(geometry.axisLength)
            : 25;

    const read = value =>
        Number.isFinite(Number(value)) && Number(value) > 0
            ? Number(value)
            : fallback;

    return [
        {
            x: origin.x + read(geometry.xPositiveLength),
            y: origin.y
        },
        {
            x: origin.x - read(geometry.xNegativeLength),
            y: origin.y
        },
        {
            x: origin.x,
            y: origin.y + read(geometry.yPositiveLength)
        },
        {
            x: origin.x,
            y: origin.y - read(geometry.yNegativeLength)
        }
    ];
}

/*
 * Statics bodies that span two points. A Beam, Truss,
 * Cable and Shaft all run from a start to an end, so
 * the snap system treats them as the spans they are.
 */
const SLENDER_STATICS_BODIES = [
    "beam",
    "truss",
    "cable",
    "shaft"
];

/*
 * Statics bodies defined by a single location rather
 * than a span.
 */
const LOCATED_STATICS_BODIES = [
    "particle",
    "rigid-body"
];

/*
 * The centre of a Rigid Body.
 *
 * Its geometry stores the top-left corner plus a size,
 * so the centre is derived rather than stored, keeping
 * one source of truth for the shape.
 */
function rigidBodyCentre(
    geometry
) {
    if (
        !geometry ||
        !Number.isFinite(geometry.position?.x) ||
        !Number.isFinite(geometry.width)
    ) {
        return null;
    }

    return {
        x:
            geometry.position.x +
            geometry.width / 2,

        y:
            geometry.position.y -
            geometry.height / 2
    };
}

/*
 * Quarter points are a TRUSS capability, not a general one.
 *
 * The reason is physical rather than aesthetic. A truss panel
 * is divided into quarters because a new panel is usually
 * wanted at a quarter of the span of the one beside it, and
 * because a truss member is a structural element whose span
 * gets divided deliberately. The same candidate on a Beam, a
 * Cable, a Shaft, a support or a dimension is noise: it
 * invents a position the feature never promised, competes
 * with the midpoint and the endpoints for the cursor's
 * attention, and makes the shared snap behave differently
 * from one feature to the next for no stated reason.
 *
 * So the capability is stated where the features are, and
 * read from there by the one function that publishes a
 * span's points. No tool opts in by accident: a feature is a
 * quarter-snap target because it declares that it is one.
 */
const QUARTER_SNAP_TYPES = new Set([
    "truss"
]);

function supportsQuarterSnap(
    object
) {
    if (!object) {
        return false;
    }

    if (
        object.snapCapabilities
            ?.quarter === false
    ) {
        return false;
    }

    if (object.type === "line" && (
        object.engineering
            ?.subtype === "truss" ||
        object.engineering
            ?.feature === "truss"
    )) {
        return true;
    }

    return QUARTER_SNAP_TYPES.has(
        object.type
    );
}

function addObjectCandidates(
    candidates,
    object
) {
    if (
        !object ||
        !object.geometry
    ) {
        return;
    }

    const geometry =
        object.geometry;

    /*
     * Whether this object's spans publish quarter points.
     *
     * Read once here and threaded down to the span publishers,
     * so every segment of one feature agrees about it: a
     * truss member offers its quarters and the same feature's
     * other geometry does not, and a Beam offers none
     * anywhere.
     */
    const quarterSnap =
        supportsQuarterSnap(object);

    /*
     * A DIAGRAM'S SOURCE REFERENCE POSITIONS ARE SNAP TARGETS.
     *
     * A student drawing an SFD needs their vertical drops to land
     * on the same stations as the loads on the beam above. Without
     * this they would be reading those positions off the beam by
     * eye and transferring them by hand, which is precisely the
     * work the diagram's reference markers were transferred to
     * save - and which is easy to get subtly wrong by a few
     * units, producing a diagram that looks right and is not.
     *
     * So each marker is published through the SAME candidate list
     * as every other snap, with the same tolerance, the same
     * priority and the same bottom-of-screen message. It is a
     * drafting aid and nothing more: it says where a station IS,
     * never what the diagram's value should be, and it cannot
     * produce a shear jump or a moment however hard a student
     * tries to make it.
     */
    if (
        object.type ===
            "analysis-diagram" &&
        Array.isArray(
            geometry.referencePositions
        ) &&
        geometry.showReferencePositions !==
            false
    ) {
        geometry.referencePositions.forEach(
            marker => {
                if (!marker.position) {
                    return;
                }

                /*
                 * A NAMED snap type, not a plain endpoint.
                 *
                 * The distinction is worth its own entry because
                 * a diagram marker is a different thing from the
                 * end of a line, and a student who has snapped to
                 * "the station a load sits on" needs to be told
                 * that rather than "Endpoint" - the word would be
                 * true and would tell them nothing about what
                 * they have caught.
                 */
                addCandidate(
                    candidates,
                    "analysis-reference",
                    object.id,
                    marker.position,
                    marker.label
                );
            }
        );

        /*
         * The two ends of the axis are published too, and then the
         * axis itself is left to the ordinary span handling below,
         * so a diagram snaps along its own zero axis like any other
         * line on the sheet.
         */
        const axis =
            geometry.zeroAxis ||
            (geometry.start && geometry.end
                ? {
                    from: geometry.start,
                    to: geometry.end
                }
                : null);

        if (axis) {
            addCandidate(
                candidates,
                "endpoint",
                object.id,
                axis.from
            );

            addCandidate(
                candidates,
                "endpoint",
                object.id,
                axis.to
            );
        }
    }

    if (object.type === "point") {
        addCandidate(
            candidates,
            "endpoint",
            object.id,
            geometry.position || geometry.point || geometry
        );
        return;
    }

    if (
        object.type ===
        "coordinate-system-2d"
    ) {
        /*
         * The origin plus each arm end are snap
         * references, so the axis lines and their
         * extents stay usable for inference and
         * origin snapping without extra hidden
         * geometry.
         */
        addCandidate(
            candidates,
            "endpoint",
            object.id,
            geometry.origin
        );

        coordinateSystemArmEnds(
            geometry
        ).forEach(
            end =>
                addCandidate(
                    candidates,
                    "endpoint",
                    object.id,
                    end
                )
        );

        return;
    }

    if (
        object.type ===
        "line"
    ) {
        segmentCandidates(
            candidates,
            object.id,
            geometry.start,
            geometry.end,
            quarterSnap
        );

        return;
    }

    /*
     * A slender Statics body is a real line to the snap
     * system: its endpoints and its midpoint are the
     * places a force or a support is usually attached.
     * Registering the same candidate kinds a Line
     * publishes is what lets a snapped Point Force
     * recognise the body it landed on, rather than
     * needing an attachment system of its own.
     */
    /*
     * A Truss the student built snaps on its own joints, so
     * a new feature can attach to a joint rather than to an
     * arbitrary point along a member. It uses the shared
     * candidate list, so it gets the same snapping and the
     * same priority as every other geometry.
     *
     * Each MEMBER is also published as a span, so its
     * midpoint and quarter points are recognised. That is
     * what lets a new panel be placed relative to the panel
     * beside it, rather than only at its ends: a truss is
     * built panel by panel, and the quarter of an existing
     * member is exactly where the next one is wanted.
     *
     * The joints are published first and as endpoints, so
     * they keep the stronger priority and a snap at a real
     * joint is never lost to a quarter of the member that
     * happens to pass nearby.
     */
    /*
     * A load is a span, so it publishes one exactly as a Line
     * does: its two ends, and the positions along it. The ends
     * are the places a second load, a support or a force is
     * attached, and the span is what makes the loaded region
     * itself a place that can be aligned with.
     *
     * Its DISTRIBUTION points are published as endpoints too.
     * They are real, visible places in the drawing - they are
     * drawn as force arrows - so a new feature can line up
     * with one exactly as it lines up with a truss joint. They
     * are published before the span's other positions so a
     * snap at a point the user defined outranks a snap at some
     * derived quarter of the same span.
     */
    if (
        object.type === "load" ||
        object.type === "varying-load"
    ) {
        if (!geometry.start || !geometry.end) {
            return;
        }

        const start = geometry.start;
        const end = geometry.end;

        enggLoadProfile
            .profilePoints(geometry)
            .forEach((point) => {
                const along =
                    enggLoadProfile.pointAlong(
                        geometry,
                        point.t
                    );

                if (along) {
                    addCandidate(
                        candidates,
                        "endpoint",
                        object.id,
                        along
                    );
                }
            });

        segmentCandidates(
            candidates,
            object.id,
            start,
            end,
            quarterSnap
        );

        return;
    }

    if (
        object.type === "truss" &&
        Array.isArray(geometry.members) &&
        geometry.members.length
    ) {
        const seen = [];

        geometry.members.forEach((member) => {
            [member.start, member.end].forEach((point) => {
                const known = seen.find(
                    (existing) =>
                        Math.hypot(
                            existing.x - point.x,
                            existing.y - point.y
                        ) < 1e-6
                );

                if (known) {
                    return;
                }

                seen.push({ x: point.x, y: point.y });

                addCandidate(
                    candidates,
                    "endpoint",
                    object.id,
                    point
                );
            });
        });

        /*
         * The interior positions of every member. Duplicates
         * across members are not removed: two members that
         * cross at their midpoints are genuinely two ways of
         * reaching the same point, and the candidate list
         * already handles a tie by priority.
         */
        geometry.members.forEach((member) => {
            segmentCandidates(
                candidates,
                object.id,
                member.start,
                member.end,
                quarterSnap
            );
        });

        return;
    }

    if (
        SLENDER_STATICS_BODIES.includes(
            object.type
        )
    ) {
        segmentCandidates(
            candidates,
            object.id,
            geometry.start,
            geometry.end,
            quarterSnap
        );
        /*
         * A BEAM is drawn as a deep member, not a line, so
         * its real edges sit half a depth either side of the
         * centreline the span above publishes.
         *
         * Without them, a force placed on the top face of a
         * beam cannot be snapped to that face: the only
         * snapping available is the centreline it was
         * constructed from, so the user has to aim at an
         * invisible line in the middle of the member rather
         * than at the thing they can actually see.
         *
         * The drawn geometry is what must snap. Each face
         * is therefore published as a span in its own right,
         * so its ends, its midpoint and its quarter points
         * are all reachable, and the body's centre is
         * published so a load can be placed on the member
         * itself.
         */
        if (object.type === "beam") {
            const half = Math.max(
                (Number(geometry.depth) || 0) / 2,
                0
            );

            if (half > 0) {
                const dx =
                    geometry.end.x -
                    geometry.start.x;

                const dy =
                    geometry.end.y -
                    geometry.start.y;

                const length = Math.hypot(dx, dy);

                if (length > 1e-9) {
                    /*
                     * A normal to the member, so the faces
                     * are offset across it rather than along
                     * it.
                     */
                    const nx =
                        (-dy / length) * half;

                    const ny =
                        (dx / length) * half;

                    [1, -1].forEach((side) => {
                        segmentCandidates(
                            candidates,
                            object.id,
                            {
                                x:
                                    geometry.start.x +
                                    nx * side,
                                y:
                                    geometry.start.y +
                                    ny * side
                            },
                            {
                                x:
                                    geometry.end.x +
                                    nx * side,
                                y:
                                    geometry.end.y +
                                    ny * side
                            },
                            quarterSnap
                        );
                    });
                }
            }

                addCandidate(
                    candidates,
                    "center",
                    object.id,
                    segmentPointAt(
                        geometry.start,
                        geometry.end,
                        0.5
                    )
                );
                }

                /*
                 * THE MEMBER'S CENTRELINE, AS A NAMED SNAP TARGET.
                 *
                 * Published as its own candidate type rather than as more
                 * endpoints and midpoints, because what it is FOR matters:
                 * this is the line a support is meant to be attached to,
                 * and it is the only part of a beam a support should be
                 * able to catch.
                 *
                 * The faces published above are still here, and are still
                 * correct for a force - a load applied to the top face of a
                 * beam really is applied there, and a student aiming at the
                 * surface they can see should catch it. What has changed is
                 * that they are no longer EQUALLY valid for everything: see
                 * `candidateIsValidForTool`, which is where a tool declares
                 * that it attaches to the centreline and not to a surface.
                 *
                 * So this is not a replacement for the face snapping, it
                 * is a distinction the tools can act on. Adding the
                 * centreline without that distinction would have made the
                 * snapping worse, not better: one more line to hit among
                 * the ones already there.
                 */
                const centreline =
                    enggBodyFrames?.centrelineOf(
                        object
                    );

                if (centreline) {
                    addSegment(
                        candidates,
                        object.id,
                        centreline.start,
                        centreline.end,
                        "centreline"
                    );
                }

                return;
            }

    /*
     * A Particle and a Rigid Body are located bodies rather
     * than spans, so they publish a centre.
     *
     * A Rigid Body also publishes its OUTLINE. Its centre
     * alone is not enough: the drawn shape is a rectangle, a
     * circle, a triangle or a polygon, and its corners and
     * edges are the places a force is actually put on. A
     * body that can only be snapped at its centre cannot be
     * attached to at a corner at all.
     */
    if (
        LOCATED_STATICS_BODIES.includes(
            object.type
        )
    ) {
        const centre =
            object.type === "particle"
                ? geometry.position ||
                    geometry.point ||
                    geometry
                : rigidBodyCentre(geometry);

        if (centre) {
            addCandidate(
                candidates,
                "center",
                object.id,
                centre
            );
        }

        if (object.type === "rigid-body") {
            const shape =
                enggFeatureGeometry
                    .rigidBodyShape(geometry);

            const outline =
                enggFeatureGeometry
                    .definingPoints(geometry, shape)
                    .filter(Boolean);

            /*
             * Each edge is published as a span, so its
             * corners, its midpoint and its quarter points
             * are all reachable along the face the user can
             * see.
             */
            if (outline.length >= 2) {
                outline.forEach((corner, index) => {
                    const next =
                        outline[
                            (index + 1) %
                                outline.length
                        ];

                    addCandidate(
                        candidates,
                        "endpoint",
                        object.id,
                        corner
                    );

                    segmentCandidates(
                        candidates,
                        object.id,
                        corner,
                        next,
                        quarterSnap
                    );
                });
            }
        }

        return;
    }

    /*
     * A Point Force is a vector, and BOTH of its ends are
     * real places in the drawing.
     *
     * The origin is where the force acts, so it is a natural
     * place to attach something else to a force. The far end
     * is the tip of the drawn arrow, and it is a real point in
     * the drawing too: a reaction applied at the end of a
     * force, or a dimension measured to it, is an ordinary
     * thing to want.
     *
     * Both are published as endpoints, so they snap with the
     * same strength as any other joint, and the shaft between
     * them is published as a span so the arrow can be picked
     * along its length as well as at its ends.
     */
    if (object.type === "force") {
        const origin =
            geometry.start ||
            geometry.position;

        if (!origin) {
            return;
        }

        addCandidate(
            candidates,
            "endpoint",
            object.id,
            origin
        );

        if (geometry.end) {
            addCandidate(
                candidates,
                "endpoint",
                object.id,
                geometry.end
            );

            segmentCandidates(
                candidates,
                object.id,
                origin,
                geometry.end,
                quarterSnap
            );
        }

        return;
    }

    if (
        object.type ===
        "polyline"
    ) {
        if (
            !Array.isArray(
                geometry.points
            )
        ) {
            return;
        }

        geometry.points.forEach(
            (
                current,
                index
            ) => {
                addCandidate(
                    candidates,
                    "endpoint",
                    object.id,
                    current
                );

                if (
                    index > 0
                ) {
                    const previous =
                        geometry.points[
                            index - 1
                        ];

                    addCandidate(
                        candidates,
                        "midpoint",
                        object.id,
                        {
                            x:
                                (
                                    previous.x +
                                    current.x
                                ) / 2,

                            y:
                                (
                                    previous.y +
                                    current.y
                                ) / 2
                        }
                    );
                }
            }
        );

        return;
    }

    if (
        object.type ===
        "polygon"
    ) {
        /*
         * Vertices come from the shared polygon
         * definition, so snapping always agrees with
         * what is rendered.
         */
        const vertices =
            enggDrawingState.polygonVertices(
                geometry
            );

        addCandidate(
            candidates,
            "center",
            object.id,
            geometry.center
        );

        vertices.forEach(
            vertex =>
                addCandidate(
                    candidates,
                    "endpoint",
                    object.id,
                    vertex
                )
        );

        vertices.forEach(
            (
                vertex,
                index
            ) => {
                const next =
                    vertices[
                        (
                            index + 1
                        ) %
                        vertices.length
                    ];

                if (!next) {
                    return;
                }

                addCandidate(
                    candidates,
                    "midpoint",
                    object.id,
                    {
                        x:
                            (
                                vertex.x +
                                next.x
                            ) / 2,

                        y:
                            (
                                vertex.y +
                                next.y
                            ) / 2
                    }
                );
            }
        );

        return;
    }

    if (
        object.type ===
        "triangle"
    ) {
        if (
            !Array.isArray(
                geometry.points
            )
        ) {
            return;
        }

        const corners =
            geometry.points.filter(
                Boolean
            );

        corners.forEach(
            corner =>
                addCandidate(
                    candidates,
                    "endpoint",
                    object.id,
                    corner
                )
        );

        /*
         * The triangle is closed, so the final
         * side runs from the last corner back to
         * the first.
         */
        corners.forEach(
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

                if (!next) {
                    return;
                }

                addCandidate(
                    candidates,
                    "midpoint",
                    object.id,
                    {
                        x:
                            (
                                corner.x +
                                next.x
                            ) / 2,

                        y:
                            (
                                corner.y +
                                next.y
                            ) / 2
                    }
                );
            }
        );

        return;
    }

    if (
        object.type ===
        "rectangle"
    ) {
        rectangleSegments(
            geometry
        ).forEach(
            segment =>
                segmentCandidates(
                    candidates,
                    object.id,
                    segment[0],
                    segment[1],
                    quarterSnap
                )
        );

        return;
    }

    if (
        object.type ===
        "circle"
    ) {
        addCandidate(
            candidates,
            "center",
            object.id,
            geometry.center
        );

        const quadrantAngles = [
            0,
            Math.PI / 2,
            Math.PI,
            Math.PI * 1.5
        ];

        quadrantAngles.forEach(
            angle => {
                addCandidate(
                    candidates,
                    "quadrant",
                    object.id,
                    {
                        x:
                            geometry.center.x +
                            Math.cos(angle) *
                                geometry.radius,

                        y:
                            geometry.center.y +
                            Math.sin(angle) *
                                geometry.radius
                    }
                );
            }
        );

        return;
    }

    if (
        object.type ===
        "arc"
    ) {
        const start = {
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
        };

        const end = {
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
        };

        addCandidate(
            candidates,
            "endpoint",
            object.id,
            start
        );

        addCandidate(
            candidates,
            "endpoint",
            object.id,
            end
        );

        addCandidate(
            candidates,
            "center",
            object.id,
            geometry.center
        );

        const quadrantAngles = [
            0,
            Math.PI / 2,
            Math.PI,
            Math.PI * 1.5
        ];

        const sweep =
            getArcSweep(
                geometry
            );

        quadrantAngles.forEach(
            angle => {
                if (
                    !angleOnDirectedArc(
                        angle,
                        geometry.startAngle,
                        geometry.endAngle,
                        sweep
                    )
                ) {
                    return;
                }

                addCandidate(
                    candidates,
                    "quadrant",
                    object.id,
                    {
                        x:
                            geometry.center.x +
                            Math.cos(angle) *
                                geometry.radius,

                        y:
                            geometry.center.y +
                            Math.sin(angle) *
                                geometry.radius
                    }
                );
            }
        );
    }
}

function objectSegments(
    object
) {
    if (
        !object ||
        !object.geometry
    ) {
        return [];
    }

    if (
        object.type ===
        "line"
    ) {
        return [
            [
                object.geometry.start,
                object.geometry.end
            ]
        ];
    }

    if (
        object.type ===
        "polyline"
    ) {
        const points =
            object.geometry.points;

        if (
            !Array.isArray(points) ||
            points.length < 2
        ) {
            return [];
        }

        const segments = [];

        for (
            let index = 1;
            index < points.length;
            index += 1
        ) {
            segments.push([
                points[index - 1],
                points[index]
            ]);
        }

        return segments;
    }

    if (
        object.type ===
        "rectangle"
    ) {
        return rectangleSegments(
            object.geometry
        );
    }

    if (
        object.type ===
        "triangle"
    ) {
        const points =
            (
                object.geometry.points ||
                []
            ).filter(
                Boolean
            );

        if (
            points.length < 3
        ) {
            return [];
        }

        const segments = [];

        points.forEach(
            (
                point,
                index
            ) => {
                segments.push([
                    point,
                    points[
                        (
                            index + 1
                        ) %
                        points.length
                    ]
                ]);
            }
        );

        return segments;
    }

    if (
        object.type ===
        "polygon"
    ) {
        const vertices =
            enggDrawingState.polygonVertices(
                object.geometry
            );

        if (
            vertices.length < 3
        ) {
            return [];
        }

        return vertices.map(
            (
                vertex,
                index
            ) => [
                vertex,
                vertices[
                    (
                        index + 1
                    ) %
                    vertices.length
                ]
            ]
        );
    }

    return [];
}

function lineIntersection(
    firstStart,
    firstEnd,
    secondStart,
    secondEnd
) {
    const denominator =
        (
            firstStart.x -
            firstEnd.x
        ) *
        (
            secondStart.y -
            secondEnd.y
        ) -
        (
            firstStart.y -
            firstEnd.y
        ) *
        (
            secondStart.x -
            secondEnd.x
        );

    if (
        Math.abs(
            denominator
        ) <
        1e-9
    ) {
        return null;
    }

    const firstCross =
        firstStart.x *
            firstEnd.y -
        firstStart.y *
            firstEnd.x;

    const secondCross =
        secondStart.x *
            secondEnd.y -
        secondStart.y *
            secondEnd.x;

    const x =
        (
            firstCross *
                (
                    secondStart.x -
                    secondEnd.x
                ) -

            (
                firstStart.x -
                firstEnd.x
            ) *
                secondCross
        ) /
        denominator;

    const y =
        (
            firstCross *
                (
                    secondStart.y -
                    secondEnd.y
                ) -

            (
                firstStart.y -
                firstEnd.y
            ) *
                secondCross
        ) /
        denominator;

    const within =
        (
            start,
            end,
            value
        ) =>
            value >=
                Math.min(
                    start,
                    end
                ) -
                1e-9 &&
            value <=
                Math.max(
                    start,
                    end
                ) +
                1e-9;

    if (
        !within(
            firstStart.x,
            firstEnd.x,
            x
        ) ||
        !within(
            firstStart.y,
            firstEnd.y,
            y
        ) ||
        !within(
            secondStart.x,
            secondEnd.x,
            x
        ) ||
        !within(
            secondStart.y,
            secondEnd.y,
            y
        )
    ) {
        return null;
    }

    return {
        x,
        y
    };
}

function curveGeometryForObject(object) {
    if (
        !object?.geometry
    ) {
        return null;
    }

    if (
        object.type === "circle" ||
        object.type === "arc"
    ) {
        const geometry =
            object.geometry;

        if (
            !geometry.center ||
            !Number.isFinite(geometry.radius) ||
            geometry.radius <= 0
        ) {
            return null;
        }

        return {
            type: object.type,
            center: geometry.center,
            radius: geometry.radius,
            startAngle: geometry.startAngle,
            endAngle: geometry.endAngle,
            sweep: geometry.sweep
        };
    }

    return null;
}

function pointOnCurve(point, curve) {
    if (curve.type === "circle") {
        return true;
    }

    const angle =
        Math.atan2(
            point.y - curve.center.y,
            point.x - curve.center.x
        );

    return angleOnDirectedArc(
        angle,
        curve.startAngle,
        curve.endAngle,
        getArcSweep(curve)
    );
}

function segmentCurveIntersections(
    start,
    end,
    curve
) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const fx = start.x - curve.center.x;
    const fy = start.y - curve.center.y;

    const a = dx * dx + dy * dy;

    if (a < 1e-12) {
        return [];
    }

    const b = 2 * (fx * dx + fy * dy);
    const c =
        fx * fx +
        fy * fy -
        curve.radius * curve.radius;

    const discriminant =
        b * b -
        4 * a * c;

    if (discriminant < -1e-9) {
        return [];
    }

    const root =
        Math.sqrt(
            Math.max(0, discriminant)
        );

    const ratios = [
        (-b - root) / (2 * a),
        (-b + root) / (2 * a)
    ];

    const intersections = [];

    ratios.forEach(ratio => {
        if (
            ratio < -1e-9 ||
            ratio > 1 + 1e-9
        ) {
            return;
        }

        const point = {
            x: start.x + ratio * dx,
            y: start.y + ratio * dy
        };

        if (pointOnCurve(point, curve)) {
            intersections.push(point);
        }
    });

    return intersections;
}

function curveCurveIntersections(
    first,
    second
) {
    const dx =
        second.center.x - first.center.x;

    const dy =
        second.center.y - first.center.y;

    const centerDistance =
        Math.hypot(dx, dy);

    if (
        centerDistance < 1e-12 ||
        centerDistance > first.radius + second.radius + 1e-9 ||
        centerDistance < Math.abs(first.radius - second.radius) - 1e-9
    ) {
        return [];
    }

    const along =
        (
            first.radius * first.radius -
            second.radius * second.radius +
            centerDistance * centerDistance
        ) / (2 * centerDistance);

    const heightSquared =
        first.radius * first.radius -
        along * along;

    if (heightSquared < -1e-9) {
        return [];
    }

    const height =
        Math.sqrt(
            Math.max(0, heightSquared)
        );

    const base = {
        x: first.center.x + along * dx / centerDistance,
        y: first.center.y + along * dy / centerDistance
    };

    const offsetX =
        -dy * height / centerDistance;

    const offsetY =
        dx * height / centerDistance;

    const intersections = [
        {
            x: base.x + offsetX,
            y: base.y + offsetY
        },
        {
            x: base.x - offsetX,
            y: base.y - offsetY
        }
    ];

    return intersections.filter(
        (point, index) =>
            pointOnCurve(point, first) &&
            pointOnCurve(point, second) &&
            (
                index === 0 ||
                distance(point, intersections[0]) > 1e-9
            )
    );
}

function objectIntersectionPoints(
    first,
    second
) {
    const firstSegments =
        objectSegments(first);

    const secondSegments =
        objectSegments(second);

    const firstCurve =
        curveGeometryForObject(first);

    const secondCurve =
        curveGeometryForObject(second);

    const intersections = [];

    firstSegments.forEach(firstSegment => {
        secondSegments.forEach(secondSegment => {
            const point =
                lineIntersection(
                    firstSegment[0],
                    firstSegment[1],
                    secondSegment[0],
                    secondSegment[1]
                );

            if (point) {
                intersections.push(point);
            }
        });

        if (secondCurve) {
            intersections.push(
                ...segmentCurveIntersections(
                    firstSegment[0],
                    firstSegment[1],
                    secondCurve
                )
            );
        }
    });

    secondSegments.forEach(secondSegment => {
        if (firstCurve) {
            intersections.push(
                ...segmentCurveIntersections(
                    secondSegment[0],
                    secondSegment[1],
                    firstCurve
                )
            );
        }
    });

    if (firstCurve && secondCurve) {
        intersections.push(
            ...curveCurveIntersections(
                firstCurve,
                secondCurve
            )
        );
    }

    return intersections.filter(
        (point, index) =>
            intersections.findIndex(
                other =>
                    distance(point, other) <= 1e-8
            ) === index
    );
}

function addIntersections(
    candidates,
    objects
) {
    for (
        let firstIndex = 0;
        firstIndex <
        objects.length;
        firstIndex += 1
    ) {
        const first =
            objects[firstIndex];

        const firstHasGeometry =
            objectSegments(first).length > 0 ||
            Boolean(curveGeometryForObject(first));

        if (
            !firstHasGeometry
        ) {
            continue;
        }

        for (
            let secondIndex =
                firstIndex + 1;
            secondIndex <
            objects.length;
            secondIndex += 1
        ) {
            const second =
                objects[
                    secondIndex
                ];

            const secondHasGeometry =
                objectSegments(second).length > 0 ||
                Boolean(curveGeometryForObject(second));

            if (
                !secondHasGeometry
            ) {
                continue;
            }

            objectIntersectionPoints(
                first,
                second
            ).forEach(
                intersection =>
                    addCandidate(
                        candidates,
                        "intersection",
                        `${first.id}:${second.id}`,
                        intersection
                    )
            );
        }
    }
}

function closestPointOnSegment(
    target,
    start,
    end
) {
    const dx =
        end.x -
        start.x;

    const dy =
        end.y -
        start.y;

    const lengthSquared =
        dx * dx +
        dy * dy;

    if (
        lengthSquared <
        1e-12
    ) {
        return {
            ...start
        };
    }

    const ratio =
        Math.max(
            0,
            Math.min(
                1,
                (
                    (
                        target.x -
                        start.x
                    ) *
                    dx +

                    (
                        target.y -
                        start.y
                    ) *
                    dy
                ) /
                lengthSquared
            )
        );

    return {
        x:
            start.x +
            ratio * dx,

        y:
            start.y +
            ratio * dy
    };
}

function closestPointOnArc(
    target,
    geometry
) {
    const dx =
        target.x -
        geometry.center.x;

    const dy =
        target.y -
        geometry.center.y;

    const angle =
        Math.atan2(
            dy,
            dx
        );

    const sweep =
        getArcSweep(
            geometry
        );

    if (
        !angleOnDirectedArc(
            angle,
            geometry.startAngle,
            geometry.endAngle,
            sweep
        )
    ) {
        const start = {
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
        };

        const end = {
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
        };

        const startDistance =
            distance(
                target,
                start
            );

        const endDistance =
            distance(
                target,
                end
            );

        return startDistance <=
            endDistance
            ? start
            : end;
    }

    return {
        x:
            geometry.center.x +
            Math.cos(angle) *
                geometry.radius,

        y:
            geometry.center.y +
            Math.sin(angle) *
                geometry.radius
    };
}

function closestPointOnObject(
    rawPoint,
    object
) {
    if (
        !object ||
        !object.geometry
    ) {
        return null;
    }

    if (
        object.type ===
        "coordinate-system-2d"
    ) {
        return {
            ...object.geometry.origin
        };
    }

    if (
        object.type ===
        "line"
    ) {
        return closestPointOnSegment(
            rawPoint,
            object.geometry.start,
            object.geometry.end
        );
    }

    if (
        object.type ===
        "polyline"
    ) {
        const segments =
            objectSegments(
                object
            );

        if (
            !segments.length
        ) {
            return null;
        }

        let closest = null;
        let closestDistance =
            Infinity;

        segments.forEach(
            segment => {
                const candidate =
                    closestPointOnSegment(
                        rawPoint,
                        segment[0],
                        segment[1]
                    );

                const candidateDistance =
                    distance(
                        rawPoint,
                        candidate
                    );

                if (
                    candidateDistance <
                    closestDistance
                ) {
                    closest =
                        candidate;

                    closestDistance =
                        candidateDistance;
                }
            }
        );

        return closest;
    }

    if (
        object.type ===
        "rectangle"
    ) {
        const segments =
            rectangleSegments(
                object.geometry
            );

        let closest = null;
        let closestDistance =
            Infinity;

        segments.forEach(
            segment => {
                const candidate =
                    closestPointOnSegment(
                        rawPoint,
                        segment[0],
                        segment[1]
                    );

                const candidateDistance =
                    distance(
                        rawPoint,
                        candidate
                    );

                if (
                    candidateDistance <
                    closestDistance
                ) {
                    closest =
                        candidate;

                    closestDistance =
                        candidateDistance;
                }
            }
        );

        return closest;
    }

    if (
        object.type ===
        "circle"
    ) {
        const dx =
            rawPoint.x -
            object.geometry.center.x;

        const dy =
            rawPoint.y -
            object.geometry.center.y;

        const length =
            Math.hypot(
                dx,
                dy
            );

        if (
            length <
            1e-12
        ) {
            return {
                x:
                    object.geometry.center.x +
                    object.geometry.radius,

                y:
                    object.geometry.center.y
            };
        }

        return {
            x:
                object.geometry.center.x +
                (
                    dx /
                    length
                ) *
                object.geometry.radius,

            y:
                object.geometry.center.y +
                (
                    dy /
                    length
                ) *
                object.geometry.radius
        };
    }

    if (
        object.type ===
        "arc"
    ) {
        return closestPointOnArc(
            rawPoint,
            object.geometry
        );
    }

    return null;
}

function screenPoint(
    engineeringPoint,
    bounds,
    state
) {
    return enggDrawingState.engineeringToScreen(
        engineeringPoint,
        {
            width:
                bounds.width,

            height:
                bounds.height
        },
        state
    );
}

/*
 * A screen point back in drawing units.
 *
 * The inverse of `screenPoint`, and needed because a line target
 * is resolved in SCREEN space - the pointer is projected onto the
 * drawn line - and the attachment has to come back out in WORLD
 * units, where the feature is stored and where the body it
 * attaches to is measured.
 *
 * This is the application's own inverse mapping rather than a
 * scale factor worked out here. That is not tidiness: screen y is
 * INVERTED relative to world y, and the origin is the middle of the
 * canvas rather than its corner, so a hand-rolled inverse would
 * come out reflected and offset - which looks almost right and
 * puts every support a visible distance from its beam.
 */
function engineeringFromScreen(
    screenPos,
    bounds,
    state
) {
    return enggDrawingState.screenToEngineering(
        screenPos,
        {
            width: bounds.width,
            height: bounds.height
        },
        state
    );
}

function screenDistance(
    first,
    second,
    bounds,
    state
) {
    const firstScreen =
        screenPoint(
            first,
            bounds,
            state
        );

    const secondScreen =
        screenPoint(
            second,
            bounds,
            state
        );

    return Math.hypot(
        secondScreen.x -
            firstScreen.x,

        secondScreen.y -
            firstScreen.y
    );
}

function buildSnapCandidates(
    state
) {
    const candidates = [];

    state.objects.forEach(
        object => {
            addObjectCandidates(
                candidates,
                object
            );
        }
    );

    addIntersections(
        candidates,
        state.objects
    );

    /*
     * Geometry that is being DRAWN rather than finished.
     *
     * A truss under construction is a set of real members that
     * exist only in the interaction, and a member being placed
     * is a real segment. Publishing them through the same
     * candidate list means a new member snaps to a joint or an
     * intersection of the members already placed, with exactly
     * the same tolerance, priority and indicator every other
     * snap uses. It is the existing snap system, simply
     * pointed at the live construction as well as the drawing.
     */
    const live =
        state?.interaction
            ?.snapGeometry ||
        [];

    if (live.length) {
        /*
         * The construction's own feature type, so the live
         * geometry is snapped to as the feature being built
         * rather than as a generic line.
         *
         * This matters for more than tidiness. A Truss
         * publishes quarter points and a Line does not, so
         * publishing an in-progress truss as a plain line
         * would silently remove the quarter regions the
         * student is trying to aim at, and only for the
         * panels being drawn rather than the ones already
         * committed. Declaring the capability keeps a
         * construction behaving like the feature it will
         * become.
         */
        const quarterSnap =
            state?.interaction
                ?.snapQuarterSnap === true;

        const published = live.map(
            (geometry, index) => ({
                id: `interaction-${index}`,
                type: "line",
                geometry,

                /*
                 * A Truss's members are published as
                 * generic spans, because a member IS a
                 * span. So the quarter capability is
                 * carried on the published object rather
                 * than inferred from a type, and only the
                 * Truss construction sets it.
                 */
                snapCapabilities: {
                    quarter: quarterSnap
                }
            })
        );

        published.forEach(
            object =>
                addObjectCandidates(
                    candidates,
                    object
                )
        );

        addIntersections(
            candidates,
            published.concat(
                state.objects
            )
        );
    }

    return candidates;
}

function findInferenceCandidate(
    rawPoint,
    state,
    bounds,
    options = {},
    availableReferences = null
) {
    if (
        !state?.objectSnap?.enabled ||
        !Array.isArray(state.objects)
    ) {
        return null;
    }

    const tolerancePx =
        getInferenceTolerancePx(
            state
        );

    const pointerScreen =
        screenPoint(
            rawPoint,
            bounds,
            state
        );

    const references =
        availableReferences ||
        buildSnapCandidates(
            state
        );

    /*
     * A CANDIDATE THAT IS A LINE IS NOT AN ALIGNMENT REFERENCE.
     *
     * Alignment works by comparing the pointer with a single point
     * on each candidate and then pulling the pointer onto its axis.
     * A candidate with no point - a centreline, published as a line
     * so a support can be placed anywhere along it - has no axis to
     * align to, so reading one throws.
     *
     * This is not a rare path: the references below are the same
     * candidate list the snap search uses, so every snap that got
     * far enough to look for inference met a centreline. The throw
     * happened inside the alignment code, a long way from the
     * candidate that caused it and giving no hint that the
     * centreline was involved.
     *
     * Alignment is a property of POINTS, so line candidates are
     * skipped here and nothing is lost: a centreline still snaps
     * as a snap, and what a student aligns to is a point they have
     * already placed rather than a member they are standing on.
     */

    /*
     * Selected geometry also acts as reference
     * geometry, so a point being placed can align
     * with the feature the user is working on.
     *
     * This reuses the same candidate builder, so
     * the reference points are the existing
     * construction points (endpoints, midpoints,
     * centres, quadrants) of the selection.
     */
    const selectedIds =
        state.selection
            ?.selectedObjectIds ||
        [];

    if (selectedIds.length) {
        state.objects.forEach(
            object => {
                if (
                    !selectedIds.includes(
                        object.id
                    )
                ) {
                    return;
                }

                addObjectCandidates(
                    references,
                    object
                );
            }
        );
    }

    if (
        options.lineStart &&
        Number.isFinite(options.lineStart.x) &&
        Number.isFinite(options.lineStart.y)
    ) {
        references.push({
            type: "endpoint",
            objectId: "construction-start",
            point: {
                ...options.lineStart
            },
            priority: SNAP_PRIORITY.endpoint
        });
    }

    /*
     * Tools that anchor on more than one earlier point
     * (the triangle's third corner aligns with both
     * previously placed corners) pass those points here.
     * Each becomes an H/V reference through the same
     * pipeline, so no tool needs its own inference.
     */
    (
        Array.isArray(options.inferenceReferences)
            ? options.inferenceReferences
            : []
    ).forEach(
        (
            reference,
            index
        ) => {
            if (
                !reference ||
                !Number.isFinite(reference.x) ||
                !Number.isFinite(reference.y)
            ) {
                return;
            }

            references.push({
                type: "endpoint",
                objectId:
                    `construction-reference-${index}`,
                point: {
                    ...reference
                },
                priority: SNAP_PRIORITY.endpoint
            });
        }
    );

    const candidates = {
        horizontal: [],
        vertical: []
    };

    references.forEach(
        reference => {
            /*
             * The same exclusion as above: a candidate with no
             * point cannot be converted to screen coordinates and
             * cannot be aligned to.
             */
            if (
                !reference ||
                !reference.point
            ) {
                return;
            }

            const referenceScreen =
                screenPoint(
                    reference.point,
                    bounds,
                    state
                );

            const horizontalDistancePx =
                Math.abs(
                    pointerScreen.y -
                    referenceScreen.y
                );

            if (
                horizontalDistancePx <=
                tolerancePx
            ) {
                candidates.horizontal.push({
                    type: "horizontal",
                    referencePoint: {
                        ...reference.point
                    },
                    point: {
                        x: rawPoint.x,
                        y: reference.point.y
                    },
                    distancePx:
                        horizontalDistancePx,
                    distanceToReferencePx:
                        Math.hypot(
                            pointerScreen.x -
                                referenceScreen.x,
                            horizontalDistancePx
                        ),
                    priority:
                        reference.priority ?? 99,
                    objectId:
                        reference.objectId ?? ""
                });
            }

            const verticalDistancePx =
                Math.abs(
                    pointerScreen.x -
                    referenceScreen.x
                );

            if (
                verticalDistancePx <=
                tolerancePx
            ) {
                candidates.vertical.push({
                    type: "vertical",
                    referencePoint: {
                        ...reference.point
                    },
                    point: {
                        x: reference.point.x,
                        y: rawPoint.y
                    },
                    distancePx:
                        verticalDistancePx,
                    distanceToReferencePx:
                        Math.hypot(
                            verticalDistancePx,
                            pointerScreen.y -
                                referenceScreen.y
                        ),
                    priority:
                        reference.priority ?? 99,
                    objectId:
                        reference.objectId ?? ""
                });
            }
        }
    );

    const compareCandidates =
        (first, second) => {
            if (
                Math.abs(
                    first.distancePx -
                    second.distancePx
                ) > 1e-6
            ) {
                return (
                    first.distancePx -
                    second.distancePx
                );
            }

            if (
                Math.abs(
                    first.distanceToReferencePx -
                    second.distanceToReferencePx
                ) > 1e-6
            ) {
                return (
                    first.distanceToReferencePx -
                    second.distanceToReferencePx
                );
            }

            if (
                first.priority !==
                second.priority
            ) {
                return (
                    first.priority -
                    second.priority
                );
            }

            const firstObjectId =
                String(first.objectId);

            const secondObjectId =
                String(second.objectId);

            if (
                firstObjectId !== secondObjectId
            ) {
                return firstObjectId < secondObjectId
                    ? -1
                    : 1;
            }

            return (
                first.referencePoint.x -
                    second.referencePoint.x ||
                first.referencePoint.y -
                    second.referencePoint.y
            );
        };

    candidates.horizontal.sort(
        compareCandidates
    );

    candidates.vertical.sort(
        compareCandidates
    );

    const horizontal =
        candidates.horizontal[0] ||
        null;

    const vertical =
        candidates.vertical[0] ||
        null;

    if (!horizontal) {
        return vertical;
    }

    if (!vertical) {
        return horizontal;
    }

    /*
     * Both constraints are valid, so they can be
     * applied together: X is taken from the
     * vertical reference and Y from the horizontal
     * one.
     *
     * The combined point must also be close to the
     * cursor, otherwise two unrelated references
     * (for example one object's top edge and a far
     * away object's left edge) would invent a
     * corner the user is nowhere near. When the
     * crossing is out of reach, the nearer
     * single-axis constraint is used instead.
     */
    const combinedPoint = {
        x: vertical.referencePoint.x,
        y: horizontal.referencePoint.y
    };

    const combinedDistancePx =
        Math.hypot(
            screenPoint(
                combinedPoint,
                bounds,
                state
            ).x -
                pointerScreen.x,
            screenPoint(
                combinedPoint,
                bounds,
                state
            ).y -
                pointerScreen.y
        );

    if (
        combinedDistancePx >
        tolerancePx
    ) {
        return horizontal.distancePx <=
            vertical.distancePx
            ? horizontal
            : vertical;
    }

    return {
        type: "horizontal-vertical",

        /*
         * Keep both reference points so the guide
         * lines and the status text can describe
         * each axis separately.
         */
        referencePoint: {
            x: vertical.referencePoint.x,
            y: horizontal.referencePoint.y
        },

        horizontalReferencePoint: {
            ...horizontal.referencePoint
        },

        verticalReferencePoint: {
            ...vertical.referencePoint
        },

        point: combinedPoint,

        distancePx:
            Math.hypot(
                horizontal.distancePx,
                vertical.distancePx
            ),

        horizontalDistancePx:
            horizontal.distancePx,

        verticalDistancePx:
            vertical.distancePx,

        priority:
            Math.min(
                horizontal.priority,
                vertical.priority
            ),

        objectId:
            horizontal.objectId ||
            vertical.objectId
    };
}

/*
 * THE POINT ON A SEGMENT NEAREST A GIVEN POINT.
 *
 * The projection of the point onto the segment, clamped to its
 * ends. Clamping is what makes a beam's centreline stop at the
 * beam: a pointer beyond the end of a member attaches at the end
 * of it, rather than snapping to a point on the line extended
 * into empty space where there is no member to attach to.
 *
 * Returned in the same space it was given in, so it can be used
 * for an indicator on screen and converted back for a world
 * position without the two drifting apart.
 */
function nearestPointOnSegment(
    point,
    start,
    end
) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared <= 1e-12) {
        return { x: start.x, y: start.y };
    }

    const t = Math.min(
        1,
        Math.max(
            0,
            ((point.x - start.x) * dx +
                (point.y - start.y) * dy) /
                lengthSquared
        )
    );

    return {
        x: start.x + dx * t,
        y: start.y + dy * t
    };
}

function findSnapCandidate(
    rawPoint,
    state,
    bounds,
    availableCandidates = null
) {
    if (
        !state ||
        !state.objectSnap ||
        !state.objectSnap.enabled ||
        !Array.isArray(
            state.objects
        ) ||
        !state.objects.length
    ) {
        return null;
    }

    const tolerancePx =
        getTolerancePx(
            state
        );

    const rawScreenPoint =
        screenPoint(
            rawPoint,
            bounds,
            state
        );

    const candidates =
        availableCandidates ||
        buildSnapCandidates(
            state
        );

    const nearby = [];

    /*
     * WHAT THE ACTIVE TOOL WILL ACCEPT.
     *
     * Read once, here, and applied to every candidate as it is
     * measured. The tool is `state.activeTool`, which is the same
     * value every other part of the interaction reads, so there is
     * one answer to "what is being built" and no chance of this
     * filter disagreeing with the tool that is actually armed.
     */
    const toolId = state.activeTool;

    candidates.forEach(
        candidate => {
            if (
                !candidateIsValidForTool(
                    candidate,
                    toolId
                )
            ) {
                return;
            }

            /*
             * A SEGMENT CANDIDATE IS A LINE, NOT A POINT.
             *
             * A centreline is something a feature is placed ALONG,
             * so the pointer is measured against the line and the
             * snap is the point on the line nearest the pointer.
             * Treating it as a single point would put the snap
             * indicator at one fixed spot on the member and make
             * every other position on it unattachable - which is
             * the opposite of what a centreline is for.
             *
             * The result is folded into the same `nearby` list with
             * the same `distance`, so the priority ordering, the
             * tolerance and the indicator below are all shared and
             * a line target is chosen on the same terms as a point.
             */
            if (candidate.segment) {
                const from = screenPoint(
                    candidate.segment.start,
                    bounds,
                    state
                );

                const to = screenPoint(
                    candidate.segment.end,
                    bounds,
                    state
                );

                const nearest = nearestPointOnSegment(
                    rawScreenPoint,
                    from,
                    to
                );

                const segmentDistance =
                    Math.hypot(
                        nearest.x - rawScreenPoint.x,
                        nearest.y - rawScreenPoint.y
                    );

                if (
                    segmentDistance <=
                    tolerancePx
                ) {
                    /*
                     * The candidate's world `point` is the
                     * PROJECTED point, not the segment's start.
                     *
                     * Everything downstream asks the candidate
                     * where the snap actually landed, in world
                     * units, and that is the point on the member
                     * the student was aiming at - not one end of
                     * it. The segment is kept for the indicator
                     * and for measuring, and the point is what the
                     * feature is attached at.
                     */
                    nearby.push({
                        ...candidate,
                        point: engineeringFromScreen(
                            nearest,
                            bounds,
                            state
                        ),
                        screenPoint: nearest,
                        distance: segmentDistance
                    });
                }

                return;
            }

            const candidateScreen =
                screenPoint(
                    candidate.point,
                    bounds,
                    state
                );

            const dx =
                candidateScreen.x -
                rawScreenPoint.x;

            const dy =
                candidateScreen.y -
                rawScreenPoint.y;

            const candidateDistance =
                Math.hypot(
                    dx,
                    dy
                );

            if (
                candidateDistance <=
                tolerancePx
            ) {
                nearby.push({
                    ...candidate,

                    screenPoint:
                        candidateScreen,

                    distance:
                        candidateDistance
                });
            }
        }
    );

    state.objects.forEach(
        object => {
            if (
                !CONSTRUCTION_TYPES.has(
                    object.type
                ) &&
                object.type !==
                    "coordinate-system-2d"
            ) {
                return;
            }

            const closest =
                closestPointOnObject(
                    rawPoint,
                    object
                );

            if (
                !closest
            ) {
                return;
            }

            const candidateScreen =
                screenPoint(
                    closest,
                    bounds,
                    state
                );

            const candidateDistance =
                Math.hypot(
                    candidateScreen.x -
                        rawScreenPoint.x,

                    candidateScreen.y -
                        rawScreenPoint.y
                );

            if (
                candidateDistance <=
                tolerancePx
            ) {
                nearby.push({
                    type:
                        "pointOnEntity",

                    objectId:
                        object.id,

                    point: {
                        ...closest
                    },

                    priority:
                        SNAP_PRIORITY.pointOnEntity,

                    screenPoint:
                        candidateScreen,

                    distance:
                        candidateDistance
                });
            }
        }
    );

    if (
        !nearby.length
    ) {
        return null;
    }

    /*
     * Ranking.
     *
     * Distance decides, with priority breaking ties. That is
     * right for most targets, where the nearest point is the
     * one meant. It is wrong for a position ON a member: a
     * point lying on the segment is always exactly at the
     * cursor, so it out-distances every named position and
     * would always win, and a quarter point, an endpoint or
     * a centre could never be chosen.
     *
     * So a named position is preferred over an unnamed one
     * whenever both are within tolerance. The user is given
     * a tolerance to aim at, and aiming AT a named position
     * is what the snap is for: landing on a member somewhere
     * unnamed should be the fallback, not the default.
     *
     * Priority still decides between two named positions, so
     * an endpoint keeps outranking a quarter of the same
     * member.
     */
    const NAMED_TYPES = new Set([
        "endpoint",
        "intersection",
        "center",
        "midpoint",
        "quarter",
        "quadrant"
    ]);

    nearby.sort((first, second) => {
        const firstNamed =
            NAMED_TYPES.has(first.type);

        const secondNamed =
            NAMED_TYPES.has(second.type);

        if (firstNamed !== secondNamed) {
            return firstNamed ? -1 : 1;
        }

        if (
            Math.abs(
                first.distance -
                    second.distance
            ) < 0.5
        ) {
            return (
                first.priority -
                second.priority
            );
        }

        return (
            first.distance -
            second.distance
            );
        }
    );

    return nearby[0];
}

function inferLinePoint(
    startPoint,
    targetPoint
) {
    if (
        !startPoint ||
        !targetPoint
    ) {
        return {
            point:
                targetPoint,
            type:
                null
        };
    }

    const dx =
        targetPoint.x -
        startPoint.x;

    const dy =
        targetPoint.y -
        startPoint.y;

    if (
        Math.hypot(
            dx,
            dy
        ) <
        1e-9
    ) {
        return {
            point:
                targetPoint,
            type:
                null
        };
    }

    const angle =
        Math.atan2(
            dy,
            dx
        ) *
        180 /
        Math.PI;

    const horizontal =
        Math.min(
            Math.abs(angle),
            Math.abs(
                Math.abs(angle) -
                180
            )
        ) <=
        INFERENCE_TOLERANCE_DEGREES;

    const vertical =
        Math.abs(
            Math.abs(angle) -
            90
        ) <=
        INFERENCE_TOLERANCE_DEGREES;

    if (
        horizontal
    ) {
        return {
            point: {
                x:
                    targetPoint.x,

                y:
                    startPoint.y
            },

            type:
                "Horizontal"
        };
    }

    if (
        vertical
    ) {
        return {
            point: {
                x:
                    startPoint.x,

                y:
                    targetPoint.y
            },

            type:
                "Vertical"
        };
    }

    return {
        point:
            targetPoint,

        type:
            null
    };
}

/*
 * ========================================================
 * HOW LONG A GUIDE OUTLASTS THE CURSOR
 * ========================================================
 *
 * A GENEROUS FIGURE WAS THE WRONG TRADE, and it is the reason snapping
 * was reported as sticky rather than merely too sensitive.
 *
 * The argument for a hold was that a drafting aid which vanishes the
 * instant it stops being exactly true is not a drafting aid. That is
 * true of a guide that DISAPPEARS, and it is not true of this one: the
 * snap has already been taken by the time the guide is drawn. The
 * guide is a picture of a decision, not the decision.
 *
 * So what a long hold actually did was show a student a "Horizontal"
 * or "Midpoint" label for a target their cursor had plainly left -
 * three hundred milliseconds of the tool claiming something untrue -
 * which reads as the snap being unreliable in exactly the way the
 * original complaint describes. The status bar made it worse, because
 * the label is text: text persists in the eye far longer than a line
 * does, so the reported symptom was a snap status stuck on screen
 * while the pointer was somewhere else entirely.
 *
 * A SHORT HOLD ONLY. Long enough that a single jittery frame does not
 * make the guide strobe, short enough that leaving the target clears
 * it before the eye can read the old one as current.
 */
const GUIDELINE_HOLD_MS = 60;

/*
 * ========================================================
 * HOW LONG A SNAP ITSELF OUTLASTS THE CURSOR
 * ========================================================
 *
 * NOT AT ALL, and that is the important half.
 *
 * The guide above is a picture; this is the value. When the cursor
 * leaves every target, the snap must become null in that same frame -
 * the point the student is about to place is the cursor, not wherever
 * they were a moment ago.
 *
 * There is no grace period on the snap, and no remembered candidate,
 * because a snap carried over from a previous frame is a point the
 * student never aimed at being used as though they had.
 */

/*
 * The clock the hold is measured against.
 *
 * Named once so a test can reason about the hold, and so
 * there is a single place to change if the guideline ever
 * needs to follow a frame counter rather than wall time.
 */
function nowMs() {
    return (
        typeof performance !==
            "undefined" &&
        performance.now
            ? performance.now()
            : Date.now()
    );
}

/*
 * ========================================================
 * WHICH GUIDE TO DRAW
 * ========================================================
 *
 * `previous` is whatever was drawn last time, with the time it was
 * drawn. A FRESH GUIDE ALWAYS WINS - without exception and without
 * consulting the previous one - because a guide that has just been
 * found is the true answer for this frame and any older guide is by
 * definition stale.
 *
 * The ONLY question is what to draw when nothing fresh was found: the
 * previous guide for the length of a very short hold, or nothing.
 *
 * IT IS NOT A MATTER OF WHAT THE PREVIOUS GUIDE WAS.
 *
 * This used to end with two branches that both returned `fresh` - one
 * of them behind a `sameInferenceTarget` test whose two exits were
 * identical. So the test decided nothing at all, and the code said so
 * without ever saying it: it read as though a settled guide were held
 * while the cursor ranged around its target, when in fact the hold
 * below was unconditional. A branch that cannot change the answer is
 * not a branch, and leaving it in place guarantees the next reader
 * believes in behaviour that does not exist.
 */
function holdGuideline(
    state,
    bounds,
    fresh,
    now
) {
    if (fresh) {
        return fresh;
    }

    const previous =
        state?.interaction
            ?.guideline;

    if (!previous?.inference) {
        return null;
    }

    /*
     * ONLY WHILE THE HOLD IS STILL RUNNING. Once it has expired the
     * guide is gone even if the cursor is only a pixel away, because
     * the alternative is a label that outlives the truth.
     */
    return (
        now - previous.at <
            GUIDELINE_HOLD_MS
    )
        ? previous.inference
        : null;
}

function resolveConstructionPoint(
    rawPoint,
    state,
    bounds,
    options = {}
) {
    const candidates =
        Array.isArray(state?.objects)
            ? buildSnapCandidates(state)
            : [];

    const snapCandidate =
        findSnapCandidate(
            rawPoint,
            state,
            bounds,
            candidates
        );

    let effectivePoint;

    let snappedPoint =
        null;

    let inferredPoint =
        null;

    /*
     * ========================================================
     * A LOAD CAN BE ALIGNED AND SNAPPED AT THE SAME TIME
     * ========================================================
     *
     * What a point of a load is placed RELATIVE TO is the loaded span and the
     * forces already on it: a point is put level with a span end, or level
     * with an earlier force so the two are the same magnitude. That is
     * inference - a horizontal or vertical guide.
     *
     * It used to be impossible while the cursor was over the body, because
     * the body's own geometry answers the snap search first: a midpoint or a
     * point on the member is found, and the alignment search was only run in
     * the branch where NO snap was found. So the moment the student moved
     * along the beam - which is exactly where a load's points go - the guide
     * could never appear.
     *
     * `preferInference` asks for the alignment guide to be considered even
     * when a snap is available, and it is what a load passes. The alignment
     * is then taken when it has one, and the snap is kept as the fallback,
     * so aligning to a span end or a force point works without losing the
     * snap onto the body.
     */
    const preferInference =
        options.preferInference ===
        true;

    let inference =
        preferInference
            ? findInferenceCandidate(
                  rawPoint,
                  state,
                  bounds,
                  options,
                  candidates
              )
            : null;

    if (
        snapCandidate &&
        !inference
    ) {
        snappedPoint = {
            ...snapCandidate.point
        };

        effectivePoint = {
            ...snapCandidate.point
        };
    } else {
        if (!inference) {
            inference =
                findInferenceCandidate(
                    rawPoint,
                    state,
                    bounds,
                    options,
                    candidates
                );
        }

        if (inference) {
            /*
             * ====================================================
             * AN ALIGNMENT CONSTRAINS ONE AXIS; THE OTHER IS STILL FREE
             * ====================================================
             *
             * A horizontal guide fixes y and leaves x as whatever the
             * pointer said; a vertical guide fixes x and leaves y. The
             * constrained axis is a DECISION - the point really is level
             * with its reference - so it is taken exactly as the alignment
             * gives it.
             *
             * The free axis was the raw pointer, and that is the gap this
             * closes. Snapping has to apply to every construction stage,
             * not only to the stage where nothing else was found, so the
             * free axis is offered to the grid exactly as it would have
             * been had no guide appeared. A corner being placed against a
             * horizontal guide lands on the guide AND on the nearest grid
             * column, which is what a student dragging on a ruled sheet
             * expects - and without it the point sat on the guide at some
             * arbitrary fraction of a grid interval.
             *
             * ONLY THE FREE AXIS IS TOUCHED. Re-snapping the constrained
             * one would move the point off the very reference it was
             * aligned to, which is how a snap appears to "slip".
             */
            /*
             * The types are the lowercase ones the candidate search builds:
             * `horizontal`, `vertical`, and `horizontal-vertical`. The last
             * one constrains BOTH axes against real reference points, so it
             * has no free axis and nothing here touches it - a corner aligned
             * to two references must land on their crossing exactly.
             */
            const constrained = inference.type;

            const freeAxis =
                constrained === "horizontal"
                    ? "x"
                    : constrained === "vertical"
                      ? "y"
                      : null;

            const alignedPoint = {
                ...inference.point
            };

            if (freeAxis) {
                alignedPoint[freeAxis] =
                    enggDrawingState.gridSnapValue(
                        alignedPoint[freeAxis],
                        state
                    );
            }

            inferredPoint = {
                ...alignedPoint
            };

            effectivePoint = {
                ...alignedPoint
            };
        } else {
            /*
             * ====================================================
             * THE SNAP ORDER: OBJECT FIRST, THEN GRID, THEN THE POINTER
             * ====================================================
             *
             * Reaching this branch means no object snap and no alignment
             * guide was found within its own tolerance, so the remaining
             * choice is the grid or the bare pointer.
             *
             * The grid is asked FIRST, and that order is the whole point:
             * object snapping has already had its turn above, so a grid
             * snap can never steal a candidate the student was aiming at.
             * A grid snap is the fallback for empty space - which is where
             * a construction point usually starts - and not a competitor.
             *
             * ====================================================
             * WITH GRID SNAP OFF THE POINTER IS FREE
             * ====================================================
             *
             * There used to be a second fallback here - `snapCoordinate`, the
             * older one-unit spacing - which meant "grid snap off" was not the
             * free positioning the requirement asks for: a point still jumped to
             * the nearest whole unit, invisibly, with nothing on screen to
             * explain it. An off-grid drawing could not be made at all.
             *
             * So the order is now exactly three steps and no fourth:
             *
             *   1. an eligible object snap, if one is in range;
             *   2. otherwise the nearest grid location, if grid snap is on;
             *   3. otherwise the raw pointer, untouched.
             *
             * `gridSnapPoint` returns its input unchanged when snapping is off,
             * so step 2 collapses into step 3 on its own - which is why there is
             * no second flag here to fall out of step with the first.
             */
            effectivePoint =
                enggDrawingState.gridSnapPoint(
                    rawPoint,
                    state
                );
        }
    }

    return {
        rawPointerPoint: {
            ...rawPoint
        },

        snappedPoint,

        inferredPoint,

        effectiveConstructionPoint:
            effectivePoint,

        snapCandidate,

        hoveredEntity:
            snapCandidate?.objectId ||
            null,

        inference,

        /*
         * The guide to draw this frame, which may be the
         * current inference or a recent one still inside
         * its hold period. The renderer reads this rather
         * than the raw inference, so the guide and the
         * geometry can never disagree about whether a snap
         * is active.
         */
        guideline: holdGuideline(
            state,
            bounds,
            inference,
            nowMs()
        )
    };
}

/*
 * ============================================================
 * SNAP A POINT THAT DID NOT COME FROM A CANVAS EVENT
 * ============================================================
 *
 * `resolveConstructionPoint` is the resolver for the pointer, and it needs the
 * canvas' pixel size to measure its tolerance in. A tool template - a Point's
 * default position, a Coordinate System's placeholder axes - is a point in the
 * DRAWING, not in the canvas, and it must still land on the same lattice and
 * the same object features as a point the student dragged. Without that, a
 * template's preview would show a point six units from a grid line while the
 * committed point, resolved at the release, was on it.
 *
 * So this is the same order, applied to a drawing point:
 *
 *   1. an object snap is NOT searched - there is no cursor to measure a
 *      tolerance against, and inventing one would snap to whatever happened to
 *      be nearest;
 *   2. otherwise the nearest grid location, when grid snap is on;
 *   3. otherwise the point itself.
 *
 * That is the same grid function every construction already falls through to
 * (`gridSnapValue`), which is why zoom and pan cannot move the lattice: the
 * spacing is in internal coordinates and the camera is never read.
 */
function snapPointToGrid(point, state) {
    const source = point || { x: 0, y: 0 };

    return {
        x: enggDrawingState.gridSnapValue(
            Number(source.x) || 0,
            state
        ),
        y: enggDrawingState.gridSnapValue(
            Number(source.y) || 0,
            state
        )
    };
}

const enggDrawingSnap = {
    SNAP_TOLERANCE_PX,
    INFERENCE_TOLERANCE_DEGREES,
    GUIDELINE_HOLD_MS,
    nowMs,
    buildSnapCandidates,
    findInferenceCandidate,
    findSnapCandidate,
    inferLinePoint,
    resolveConstructionPoint,
    snapPointToGrid,
    closestPointOnObject,
    screenDistance
};

export default enggDrawingSnap;
