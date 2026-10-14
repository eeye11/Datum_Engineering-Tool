/*
 * Numeric inputs and rigid-body shape edits.
 */

import enggFeatureGeometry from "../../core/geometry/feature-geometry.js";
import { triangleMeasurements } from "../geometry/triangle-panel.js";
import { pistonFraction, stopperFraction } from "../../features/thermodynamics/piston-cylinder.js";

/*
 * Wrap every numeric input in the panel with the
 * shared stepper.
 *
 * Doing this in one place means each Features panel
 * gets identical arrows pinned to the far right,
 * without every feature having to build its own
 * control.
 */
export function enhanceNumericInputs(
    root
) {
    root.querySelectorAll('input[type="number"]').forEach(input => {
        if (
            input.parentElement &&
            input.parentElement.classList.contains(
                "drawing-number-field"
            )
        ) {
            return;
        }

        const wrapper =
            document.createElement("div");

        wrapper.className =
            "drawing-number-field";

        input.parentNode.insertBefore(
            wrapper,
            input
        );

        wrapper.appendChild(
            input
        );

        const stepper =
            document.createElement("div");

        stepper.className =
            "drawing-number-stepper";

        stepper.innerHTML = `
            <button type="button" tabindex="-1"
                aria-label="Increase" data-step="1"></button>
            <button type="button" tabindex="-1"
                aria-label="Decrease" data-step="-1"></button>
        `;

        wrapper.appendChild(
            stepper
        );

        stepper.querySelectorAll("[data-step]").forEach(button => {
            button.addEventListener("click", () => {
                if (input.disabled) {
                    return;
                }

                /*
                 * The spinner moves in whole units of the
                 * property's own unit, so one press is
                 * always exactly +1 or -1. The input's own
                 * step attribute is deliberately not used
                 * here, because values like "any" and "5"
                 * would otherwise produce unpredictable
                 * jumps between unrelated magnitudes.
                 */
                const amount = 1;

                const current =
                    Number(input.value);

                const base =
                    Number.isFinite(current)
                        ? current
                        : 0;

                const next =
                    base +
                    amount *
                        Number(button.dataset.step);

                const min =
                    input.getAttribute("min");

                input.value =
                    min !== null &&
                    Number.isFinite(Number(min)) &&
                    next < Number(min)
                        ? String(Number(min))
                        : String(
                            Number(
                                next.toFixed(6)
                            )
                        );

                /*
                 * Dispatch only `change`. The numeric handler
                 * runs `apply()` on both `input` and
                 * `change`, so firing both would apply the
                 * step twice and the geometry would jump far
                 * more than one increment.
                 */
                input.dispatchEvent(
                    new Event(
                        "change",
                        {
                            bubbles: true
                        }
                    )
                );
            });
        });
    });
}

/*
 * The current measured value of a constrained property,
 * used to pin a Fix control to the value it locks in.
 */
export function currentPropertyValue(
    object,
    key
) {
    const g =
        object.geometry || {};

    if (key === "pistonHeight") {
        return g.height * pistonFraction(g);
    }
    if (key === "stopperHeight") return g.height * stopperFraction(g);

    const measurements =
        object.type === "triangle"
            ? triangleMeasurements(
                (g.points || []).filter(
                    Boolean
                )
            )
            : null;

    const sideMatch =
        /^side(\d)$/.exec(key);

    if (sideMatch && measurements) {
        return measurements.sides[
            Number(sideMatch[1]) - 1
        ];
    }

    const angleMatch =
        /^angle(\d)$/.exec(key);

    if (angleMatch && measurements) {
        return measurements.angles[
            Number(angleMatch[1]) - 1
        ];
    }

    if (key === "length") {
        return Math.hypot(
            g.end.x - g.start.x,
            g.end.y - g.start.y
        );
    }

    if (key === "angle") {
        return (
            Math.atan2(
                g.end.y - g.start.y,
                g.end.x - g.start.x
            ) *
            180 /
            Math.PI
        );
    }

    if (key === "radius") {
        return Number(g.radius);
    }

    /*
     * Coordinate keys resolve through the geometry path.
     */
    const parts =
        String(key).split(".");

    let cursor =
        g;

    for (const part of parts) {
        if (
            cursor ===
            null ||
            typeof cursor !== "object"
        ) {
            return NaN;
        }

        cursor = cursor[part];
    }

    return Number(cursor);
}

/*
 * Change the outline of a rigid body in place.
 *
 * The body keeps its identity, its name and its attachments:
 * only the geometry that describes its outline is rewritten, so
 * a body that changes from a rectangle to a circle is still the
 * same Rigid Body rather than a newly created feature.
 */
export function setRigidBodyShape(
    object,
    shape
) {
    if (
        !enggFeatureGeometry
            .RIGID_BODY_SHAPES
            .includes(shape)
    ) {
        return false;
    }

    const g = object.geometry;

    if (
        enggFeatureGeometry
            .rigidBodyShape(g) === shape
    ) {
        return false;
    }

    /*
     * The size the body already has is what the new shape is
     * built from, so changing the outline does not also resize
     * the body out from under the student.
     */
    const centre =
        enggFeatureGeometry.rigidBodyCenter(
            g
        ) || { x: 0, y: 0 };

    const width =
        Number(g.width) || 60;

    const height =
        Number(g.height) || 40;

    const rotation =
        Number(g.rotation) || 0;

    if (shape === "circle") {
        delete g.position;
        delete g.width;
        delete g.height;
        delete g.points;

        g.center = {
            x: centre.x,
            y: centre.y
        };
        g.radius =
            Math.max(width, height) / 2;
    } else if (shape === "triangle") {
        delete g.position;
        delete g.width;
        delete g.height;
        delete g.center;
        delete g.radius;

        g.points =
            enggFeatureGeometry
                .trianglePointsFor(
                    centre,
                    width,
                    height
                );
    } else if (shape === "polygon") {
        delete g.position;
        delete g.width;
        delete g.height;
        delete g.points;

        g.center = {
            x: centre.x,
            y: centre.y
        };
        g.sides = 5;
        g.radius = Math.max(width, height) / 2;
    } else {
        delete g.center;
        delete g.radius;
        delete g.points;
        delete g.sides;

        g.position = {
            x: centre.x - width / 2,
            y: centre.y + height / 2
        };
        g.width = width;
        g.height = height;
    }

    g.shape = shape;
    g.rotation = rotation;

    return true;
}

/*
 * Move a rigid body so its centre lands on a given axis value.
 *
 * The body is moved as one piece through the shared transform, so
 * a circle or a triangle translates the same way a rectangle does
 * and no part of it is left behind.
 */
export function moveRigidBodyTo(
    object,
    axis,
    value
) {
    const g = object.geometry;

    const current =
        enggFeatureGeometry.rigidBodyCenter(
            g
        );

    if (!current) {
        return;
    }

    enggFeatureGeometry.translateObject(
        object,
        axis === "x"
            ? value - current.x
            : 0,
        axis === "y"
            ? value - current.y
            : 0
    );
}

/*
 * Resize a rigid body along one axis.
 *
 * A rectangle and a polygon resize through their own defining
 * size. A circle has only one dimension, so changing its width
 * sets its radius, which is the closest honest equivalent.
 */
export function resizeRigidBody(
    object,
    axis,
    value
) {
    const g = object.geometry;

    const shape =
        enggFeatureGeometry.rigidBodyShape(g);

    if (shape === "circle") {
        setRigidBodyRadius(object, value / 2);
        return;
    }

    if (shape === "polygon") {
        setRigidBodyRadius(object, value / 2);
        return;
    }

    if (shape === "triangle") {
        /*
         * A triangle has no width or height of its own, so a
         * size change scales its vertices about the body's
         * centre. Scaling rather than translating keeps the
         * triangle centred where it was.
         */
        const centre =
            enggFeatureGeometry
                .rigidBodyCenter(g);

        const current = triangleExtent(g, centre, axis);

        if (!centre || !current) {
            return;
        }

        const factor = value / current;

        const component = axis === "width" ? "x" : "y";

        (g.points || [])
            .filter(Boolean)
            .forEach(point => {
                point[component] =
                    centre[component] +
                    (point[component] - centre[component]) *
                        factor;
            });

        return;
    }

    g[axis] = value;
}

/*
 * The current extent of a triangle along one axis.
 *
 * Measured across the three vertices rather than taken from any
 * stored value, because a triangle has no width or height field
 * to read it from.
 */
function triangleExtent(
    g,
    centre,
    axis
) {
    const points = (g.points || []).filter(Boolean);

    if (!points.length) {
        return 0;
    }

    const values = points.map(point => point[axis]);

    return Math.max(...values) - Math.min(...values);
}

/*
 * Set the size of a rigid body that is defined by a single radius.
 *
 * A circle and a polygon both measure from their centre outwards,
 * so one radius covers both.
 */
export function setRigidBodyRadius(
    object,
    radius
) {
    const g = object.geometry;

    g.radius = radius;
}
