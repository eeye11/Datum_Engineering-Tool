/*
 * ============================================================
 * THE DYNAMICS FEATURE FACTORY
 * ============================================================
 *
 * Builds one stored feature per Dynamics tool, from the data the creation
 * gesture produced. This is the analogue of a Statics geometry factory: the
 * shape is decided HERE, once, and everything downstream - the renderer, the
 * handles, the Features panel and the source writer - reads the object that
 * came out of it.
 *
 * ONE OBJECT, MANY PARTS. A spring-damper pair is not two objects attached to
 * each other; it is one feature whose geometry holds the shared terminals and
 * the parts of both branches. The same is true of a pulley (wheel, axle and
 * rope), a coordinate system (origin, both axes) and an angular vector (arc
 * and arrowhead). Keeping the parts as fields of one geometry is what makes
 * the composite behave as a single object everywhere: one rows in Objects,
 * one selection, one undo entry, one source region, one delete.
 *
 * ALL ANGLES ARE DEGREES unless a field name says otherwise, and all
 * distances are drawing units (paper millimetres), which is the unit the
 * renderer, the snapping and the source all share.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import {
    DYNAMICS_SIZES,
    DYNAMICS_CHILD_TOOLS,
    dynamicsEngineering
} from "./dynamics-tools.js";

function finite(value, fallback = 0) {
    const number = Number(value);

    return Number.isFinite(number) ? number : fallback;
}

function at(candidate, fallback = { x: 0, y: 0 }) {
    return {
        x: finite(candidate?.x, fallback.x),
        y: finite(candidate?.y, fallback.y)
    };
}

function lengthOf(start, end) {
    return Math.hypot(end.x - start.x, end.y - start.y);
}

/* The direction of a span, in degrees, measured anticlockwise from +x. */
export function spanAngle(start, end) {
    return (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
}

export function unitVector(degrees) {
    const radians = (finite(degrees) * Math.PI) / 180;

    return {
        x: Math.cos(radians),
        y: Math.sin(radians)
    };
}

/*
 * The feature's own metadata. `dynamicsType` is what tells every other part
 * of the application which Dynamics tool made this object, and it survives
 * edits, moves and saves because it lives on the object.
 */
function optionsFor(toolId, extra = {}) {
    return {
        ...extra,
        engineering: {
            ...dynamicsEngineering(toolId),
            ...(extra.engineering || {})
        }
    };
}

/*
 * The options a FACTORY TAKES, with the feature fields removed.
 *
 * The geometry factories put everything they are given onto the geometry,
 * so `engineering` would end up inside `object.geometry` while every other
 * part of the application reads `object.engineering`. The factory is given
 * only what belongs to it - style, name, metadata - and the copied layers
 * are written onto the FEATURE afterwards by `markDynamics`.
 */
function factoryOptions(toolId, extra = {}) {
    const { engineering, ...rest } = optionsFor(toolId, extra);

    void engineering;

    return rest;
}

/*
 * Put the Dynamics identity on the feature itself, where the renderer, the
 * Features panel and the writer look for it. Done once per object, after
 * the factory has returned it.
 */
function markDynamics(object, toolId, metadata = null) {
    if (!object) {
        return object;
    }

    object.engineering = {
        ...(object.engineering || {}),
        ...dynamicsEngineering(toolId)
    };

    object.metadata = {
        ...(object.metadata || {}),
        ...(metadata || {})
    };

    return object;
}

/* ============================================================
 * BODIES
 * ============================================================ */

/*
 * A particle reuses the ordinary particle geometry. The marker radius is
 * recorded in its geometry where the renderer and the writer both find it -
 * the factory takes a position, and a radius is a property of the Dynamics
 * marker, so it is written after the object is built rather than passed to
 * the factory.
 */
function particle(position, style) {
    const object = enggDrawingState.geometryFactories.particle(
        at(position),
        factoryOptions("dynamics-particle", {
            style: style,
            name: "Particle",
            metadata: { markerRadius: DYNAMICS_SIZES.particleRadius }
        })
    );

    object.geometry = {
        ...(object.geometry || {}),
        markerRadius: DYNAMICS_SIZES.particleRadius,
        markerStyle: "filled"
    };

    return markDynamics(object, "dynamics-particle", {
        markerRadius: DYNAMICS_SIZES.particleRadius
    });
}

function rigidBody(start, end, style) {
    const first = at(start);
    const second = at(end);

    const width = Math.max(4, Math.abs(second.x - first.x));
    const height = Math.max(3, Math.abs(second.y - first.y));

    return markDynamics(
        enggDrawingState.geometryFactories["rigid-body"](
            {
                x: Math.min(first.x, second.x),
                y: Math.max(first.y, second.y)
            },
            width,
            height,
            factoryOptions("dynamics-rigid-body", {
                style: style,
                name: "Rigid Body",
                metadata: { showCenterOfMass: true }
            })
        ),
        "dynamics-rigid-body"
    );
}

/* ============================================================
 * KINEMATICS
 * ============================================================ */

function trajectory(start, end, style) {
    const from = at(start);
    const to = at(end);

    return {
        type: "dynamics-trajectory",
        geometry: {
            start: from,
            end: to,

            /*
             * The bow is the height of the curve at its midpoint, as a
             * fraction of the span. Zero is a straight path; the default
             * gives a path that reads as a trajectory rather than as a
             * vector, and the curve handle adjusts it.
             */
            bow: DYNAMICS_SIZES.trajectoryBow,
            arrowEnd: false
        },
        style: style,
        label: ""
    };
}

function polarVector(tail, tip, style) {
    const from = at(tail);
    const to = at(tip);

    return {
        type: "dynamics-polar-vector",
        geometry: {
            start: from,
            end: to,
            showAngle: false
        },
        style: style,
        label: ""
    };
}

function angularVector(centre, radiusPoint, style) {
    const origin = at(centre);
    const radius = Math.max(1, lengthOf(origin, at(radiusPoint)));
    const radiusAngle = spanAngle(origin, at(radiusPoint));

    return {
        type: "dynamics-angular-vector",
        geometry: {
            center: origin,
            radius,
            /*
             * ANGLES ARE DEGREES - the unit the Features panel, the handles
             * and the source writer all read - so a stored 270 is a
             * three-quarter turn, not 270 radians.
             */
            startAngle: finite(radiusAngle, 0),
            sweep: 270,
            direction: "ccw",
            arrowHead: "filled"
        },
        style: style,
        label: ""
    };
}

/* ============================================================
 * MECHANICAL ELEMENTS
 * ============================================================ */

function spring(start, end, style) {
    return {
        type: "dynamics-spring",
        geometry: {
            start: at(start),
            end: at(end),
            coils: DYNAMICS_SIZES.springCoils,
            amplitude: DYNAMICS_SIZES.springAmplitude,
            lead: DYNAMICS_SIZES.springLead
        },
        style: style,
        label: ""
    };
}

function damper(start, end, style) {
    return {
        type: "dynamics-damper",
        geometry: {
            start: at(start),
            end: at(end),

            /*
             * WHERE THE BODY SITS along the span, as a fraction of it, and
             * how wide it is in drawing units. The rod fills the rest, so
             * the two parts always meet and the symbol cannot come apart.
             */
            bodyFrom: DYNAMICS_SIZES.damperBody,
            bodyTo: 0.82,
            bodyWidth: DYNAMICS_SIZES.damperBodyWidth,
            rodWidth: DYNAMICS_SIZES.damperRod
        },
        style: style,
        label: ""
    };
}

function springDamper(start, end, style) {
    return {
        type: "dynamics-spring-damper",
        geometry: {
            /* The two shared terminals. Both branches hang between them. */
            start: at(start),
            end: at(end),
            branchSpacing: DYNAMICS_SIZES.branchSpacing,

            coils: DYNAMICS_SIZES.springCoils,
            amplitude: DYNAMICS_SIZES.springAmplitude,
            lead: DYNAMICS_SIZES.springLead,

            bodyFrom: DYNAMICS_SIZES.damperBody,
            bodyTo: 0.82,
            bodyWidth: DYNAMICS_SIZES.damperBodyWidth / 1.6,
            rodWidth: DYNAMICS_SIZES.damperRod
        },
        style: style,
        label: "",
        labels: { spring: "", damper: "" }
    };
}

function pulley(centre, radiusPoint, style) {
    const origin = at(centre);
    const radius = Math.max(2, lengthOf(origin, at(radiusPoint)));

    return {
        type: "dynamics-pulley",
        geometry: {
            center: origin,
            radius,

            /*
             * The rope leaves the wheel symmetrically on both sides and
             * hangs straight down. `ropeGap` is the horizontal distance
             * between the two hanging ends; the measurement is what keeps
             * the rope tangent to the wheel whatever its size.
             */
            ropeGap: Math.max(radius * 2, DYNAMICS_SIZES.pulleyRopeGap),
            /*
             * THE HANG IS MEASURED FROM THE HUB, AND MUST CLEAR THE RIM.
             *
             * `ropeDrop` is a distance from the centre, but the cord leaves
             * the wheel at its rim - so `radius * 2.4` left only 1.4 radii of
             * rope below the wheel, and a rope that stops almost at the rim
             * reads as a wheel with two short stubs rather than as a pulley.
             * Three radii puts two full radii of cord below it, which is what
             * makes the symbol read as a rope over a wheel.
             */
            ropeDrop: Math.max(radius * 3, DYNAMICS_SIZES.pulleyRopeDrop),

            /*
             * Which way the rope hangs, in degrees, zero being straight
             * down. Rotating the pulley advances it, so the cord swings
             * with the wheel rather than being pinned to the sheet.
             */
            ropeAngle: 0,
            showAxle: true
        },
        style: style,
        label: ""
    };
}

/* ============================================================
 * REFERENCE
 * ============================================================ */

/*
 * The coordinate system is the editor's own 2D coordinate system, so it gets
 * its existing geometry, handles, Features and source. `dynamicsType` is what
 * makes it a Dynamics reference and what the writer keys on for its name.
 */
function coordinateSystem(origin, extentPoint, style) {
    const start = at(origin);
    const extent = Math.max(5, lengthOf(start, at(extentPoint)));

    const object = enggDrawingState.geometryFactories.coordinateSystem2D(
        start,
        {
            ...factoryOptions("dynamics-coordinate-system"),
            style: style,
            name: "Coordinate System",

            /*
             * The arms follow the drag, and Y is derived from X by the
             * factory so the two stay square whatever angle the release
             * landed at.
             */
            rotation: (spanAngle(start, at(extentPoint)) * Math.PI) / 180,
            xAxisLength: extent,
            yAxisLength: extent,
            xPositiveLength: extent,
            xNegativeLength: extent,
            yPositiveLength: extent,
            yNegativeLength: extent
        }
    );

    return markDynamics(object, "dynamics-coordinate-system", {
        reference: true,
        coordinateSystem: "2d"
    });
}

function referencePoint(position, style) {
    const object = enggDrawingState.geometryFactories.point(
        at(position),
        factoryOptions("dynamics-reference-point", {
            style: style,
            name: "Reference Point"
        })
    );

    return markDynamics(object, "dynamics-reference-point", {
        markerStyle: "cross"
    });
}

/*
 * A Reference Line is an ordinary line: the same geometry, the same
 * Features, the same source writer. What makes it a REFERENCE line is the
 * `dynamicsType` and a construction line type, both of which the student can
 * change afterwards like any other style.
 */
function referenceLine(start, end, style) {
    return markDynamics(
        enggDrawingState.geometryFactories.line(
            at(start),
            at(end),
            factoryOptions("dynamics-reference-line", {
                style: {
                    ...style,
                    lineType:
                        style?.lineType === "solid" || style?.lineType === undefined
                            ? "construction"
                            : style.lineType
                },
                name: "Reference Line"
            })
        ),
        "dynamics-reference-line"
    );
}

/*
 * A Reference Arc is an ordinary arc - no arrowhead, an open sweep - drawn
 * by the arc renderer and written by the arc writer.
 */
function referenceArc(start, end, style) {
    /*
     * THE ARC STARTS WHERE THE DRAG STARTED, at the point it has reached.
     *
     * An arc's geometry is a CENTRE, a RADIUS and two angles - there is no
     * stored start point - so the two gesture points decide which arc it is:
     * the drag began on the arc and sweeps towards the point under the
     * cursor, and its centre is solved from those two ends and the default
     * sweep. That is the arc the student traced, and it keeps the editor's
     * own arc geometry, handles and source writer.
     */
    const from = at(start);
    const to = at(end);
    const sweep =
        (DYNAMICS_SIZES.referenceArcSweepDegrees * Math.PI) / 180;

    const chord = lengthOf(from, to);

    if (chord < 1e-6) {
        return null;
    }

    const radius = chord / (2 * Math.sin(sweep / 2));

    /*
     * The centre sits on the perpendicular bisector of the chord, on the
     * side that makes the arc bow the way it was drawn.
     */
    const midpoint = {
        x: (from.x + to.x) / 2,
        y: (from.y + to.y) / 2
    };

    const normal = {
        x: -(to.y - from.y) / chord,
        y: (to.x - from.x) / chord
    };

    const offset = Math.sqrt(
        Math.max(0, radius * radius - (chord / 2) * (chord / 2))
    );

    /* The centre is on the far side of the chord from the arc's bow. */
    const centre = {
        x: midpoint.x + normal.x * offset,
        y: midpoint.y + normal.y * offset
    };

    const startAngle = Math.atan2(from.y - centre.y, from.x - centre.x);
    const endAngle = Math.atan2(to.y - centre.y, to.x - centre.x);

    return markDynamics(
        enggDrawingState.geometryFactories.arc(
            centre,
            radius,
            startAngle,
            startAngle + (endAngle >= startAngle ? (endAngle - startAngle) : sweep),
            factoryOptions("dynamics-reference-arc", {
                style: {
                    ...style,
                    lineType:
                        style?.lineType === "solid" || style?.lineType === undefined
                            ? "construction"
                            : style.lineType
                },
                name: "Reference Arc"
            })
        ),
        "dynamics-reference-arc"
    );
}

/* ============================================================
 * THE TABLE
 * ============================================================ */

/*
 * A SYMBOL BUILT FROM ITS OWN GEOMETRY STILL CARRIES ITS IDENTITY.
 *
 * The spring, the damper, the vectors, the trajectory and the pulley are
 * plain objects rather than factory output, so the `engineering` block the
 * builders do not write is put on here - once, in the same place for all of
 * them - instead of each builder remembering. A symbol without it would be
 * drawn as nothing, written as nothing and never recognised as Dynamics.
 */
const OWN_GEOMETRY_TOOLS = new Set([
    "dynamics-trajectory",
    "dynamics-polar-vector",
    "dynamics-angular-vector",
    "dynamics-spring",
    "dynamics-damper",
    "dynamics-spring-damper",
    "dynamics-pulley"
]);

const BUILDERS = {
    "dynamics-particle": (points, style) => particle(points[0], style),
    "dynamics-rigid-body": (points, style) => rigidBody(points[0], points[1], style),
    "dynamics-trajectory": (points, style) => trajectory(points[0], points[1], style),
    "dynamics-polar-vector": (points, style) => polarVector(points[0], points[1], style),
    "dynamics-angular-vector": (points, style) => angularVector(points[0], points[1], style),
    "dynamics-spring": (points, style) => spring(points[0], points[1], style),
    "dynamics-damper": (points, style) => damper(points[0], points[1], style),
    "dynamics-spring-damper": (points, style) => springDamper(points[0], points[1], style),
    "dynamics-pulley": (points, style) => pulley(points[0], points[1], style),
    "dynamics-coordinate-system": (points, style) => coordinateSystem(points[0], points[1], style),
    "dynamics-reference-point": (points, style) => referencePoint(points[0], style),
    "dynamics-reference-line": (points, style) => referenceLine(points[0], points[1], style),
    "dynamics-reference-arc": (points, style) => referenceArc(points[0], points[1], style)
};

/*
 * The display name a new Dynamics object carries, so the Objects inventory
 * names it for what it IS rather than for the primitive it happens to store.
 */
function nameFor(toolId) {
    return DYNAMICS_CHILD_TOOLS[toolId]?.label || "Dynamics Object";
}

/*
 * Build one Dynamics feature from the tool id and the points the gesture
 * produced. A tool with no builder returns null, which the creation layer
 * reports rather than committing an empty object.
 */
export function createDynamicsObject(toolId, points, style = {}) {
    const builder = BUILDERS[toolId];

    if (!builder) {
        return null;
    }

    const list = Array.isArray(points) ? points.filter(Boolean) : [];

    if (!list.length) {
        return null;
    }

    const object = builder(list, style);

    if (!object) {
        return null;
    }

    if (OWN_GEOMETRY_TOOLS.has(toolId)) {
        markDynamics(object, toolId);
    }

    /*
     * A NAME, ALWAYS. The factories that build a whole feature name it
     * themselves; the ones that build a symbol from its own geometry do not,
     * and the document requires a name to number it.
     */
    if (typeof object.name !== "string" || object.name.trim() === "") {
        object.name = nameFor(toolId);
    }

    return object;
}

/*
 * The points an object is DEFINED by, in the order the creation gesture
 * supplied them: the first anchor, then the second. This is what a preview
 * is rebuilt from on every pointer move, so a preview and the committed
 * object are always built by the same builder.
 */
export function createDynamicsPreview(toolId, points, style = {}) {
    const object = createDynamicsObject(toolId, points, style);

    if (!object) {
        return null;
    }

    return {
        ...object,
        id: "dynamics-preview",
        isPreview: true
    };
}

export default {
    createDynamicsObject,
    createDynamicsPreview,
    spanAngle,
    unitVector
};
