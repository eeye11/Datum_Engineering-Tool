/*
 * Feature handle and joint geometry shared by the editor and the renderer.
 *
 * These answer "where are this feature's grips?" - a truss's joints, the
 * four arm ends of a coordinate system, a rigid body's resize handles. The
 * editor needs them to hit-test and drag; the renderer needs them to draw
 * the grips in the same places. They used to live in the drawing
 * controller and were reached from the renderer as leaked globals, which
 * made rendering depend on the editor. Here both depend on this instead.
 */

/*
 * Every point in a truss construction, in order.
 *
 * These are the joints. A member endpoint that lands on one of
 * them is connected, and a floating endpoint that lands on none
 * is what makes the structure invalid.
 */
import enggFeatureGeometry from "./feature-geometry.js";

export function trussJoints(
    members
) {
    return members.flatMap(member => [
        member.start,
        member.end
    ]);
}

/*
 * The four arms of the coordinate system as segments.
 *
 * Shared by hit-testing, handles and snapping so they
 * all agree on the same geometry, and so the four
 * extensions stay independent in one feature.
 */
export function coordinateSystemArms(
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
            kind: "xPositive",
            start: origin,
            end: {
                x: origin.x + read(geometry.xPositiveLength),
                y: origin.y
            }
        },
        {
            kind: "xNegative",
            start: origin,
            end: {
                x: origin.x - read(geometry.xNegativeLength),
                y: origin.y
            }
        },
        {
            kind: "yPositive",
            start: origin,
            end: {
                x: origin.x,
                y: origin.y + read(geometry.yPositiveLength)
            }
        },
        {
            kind: "yNegative",
            start: origin,
            end: {
                x: origin.x,
                y: origin.y - read(geometry.yNegativeLength)
            }
        }
    ];
}

/*
 * The manipulation handles for a rigid body, in its current shape.
 *
 * Each shape is dragged through the handle that means something
 * for it, and every case writes the same defining values the
 * Features panel writes, so the two can never disagree.
 */
export function rigidBodyHandles(
    object
) {
    const g = object.geometry;

    const shape =
        enggFeatureGeometry.rigidBodyShape(g);

    if (shape === "circle") {
        const center = g.center || { x: 0, y: 0 };

        return [
            { kind: "rigid-centre", point: center },
            {
                kind: "rigid-radius",
                point: {
                    x: center.x + (Number(g.radius) || 0),
                    y: center.y
                }
            }
        ];
    }

    if (
        shape === "triangle" ||
        shape === "polygon"
    ) {
        return enggFeatureGeometry
            .definingPoints(g, shape)
            .map((point, index) => ({
                kind: `rigid-vertex${index}`,
                point
            }));
    }

    return enggFeatureGeometry
        .rectangleCorners(g)
        .map((point, index) => ({
            kind: `rigid-corner${index}`,
            point
        }));
}
