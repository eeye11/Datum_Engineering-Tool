/*
 * Solving a triangle from edited sides and angles.
 */

import { distance } from "./construction-geometry.js";
import { triangleMeasurements } from "./triangle-panel.js";

/*
 * Rebuild a triangle's points from sides and
 * angles.
 *
 * Sides are the primary constraint because a side
 * triple determines the triangle shape uniquely
 * (SSS). Angles only act as a fallback for the
 * cases sides cannot cover, and are never applied
 * all at once, because three angles that do not sum
 * to 180 degrees are contradictory and would
 * produce invalid geometry.
 */
export function applyTriangleSidesAndAngles(
    object,
    key,
    value
) {
    const g =
        object.geometry;

    const points =
        (g.points || []).filter(
            Boolean
        );

    if (points.length < 3) {
        return false;
    }

    const measurements =
        triangleMeasurements(points);

    if (!measurements) {
        return false;
    }

    const fixed = name =>
        Boolean(object.constraints?.[name]);

    const positive = value > 0;

    const sideIndex =
        /^side(\d)$/.exec(key);

    const angleIndex =
        /^angle(\d)$/.exec(key);

    if (sideIndex) {
        if (!positive || fixed(key)) {
            return false;
        }

        const index =
            Number(sideIndex[1]) - 1;

        /*
         * Other sides that the user has fixed must keep
         * their exact values, so they are restored from the
         * constraint rather than recomputed from geometry.
         */
        const sideKeys = [
            "side1",
            "side2",
            "side3"
        ];

        /*
         * A new side length must still close the
         * triangle: the two remaining sides have to
         * be able to span it.
         */
        const others =
            measurements.sides.filter(
                (_, position) =>
                    position !== index
            );

        if (
            value >=
                others[0] +
                others[1] - 1e-9 ||
            value <=
                Math.abs(
                    others[0] -
                    others[1]
                ) + 1e-9
        ) {
            return false;
        }

        /*
         * Rebuild from point 1 and point 2 using the
         * new side 1 length, then place point 3 from
         * the two fixed remaining sides.
         */
        const sides =
            measurements.sides.slice();

        sides[index] = value;

        /*
         * Re-assert every fixed side, so a change to one
         * side can never silently move a constrained one.
         */
        sideKeys.forEach(
            (
                sideKey,
                position
            ) => {
                if (
                    position !== index &&
                    fixed(sideKey)
                ) {
                    sides[position] =
                        Number(
                            object.constraints[
                                `${sideKey}Value`
                            ]
                        );

                    if (
                        !Number.isFinite(
                            sides[position]
                        ) ||
                        sides[position] <= 0
                    ) {
                        sides[position] =
                            measurements.sides[
                                position
                            ];
                    }
                }
            }
        );

        const [sideA, sideB, sideC] =
            sides;

        /*
         * The fixed sides must still be able to form a
         * triangle with the new value.
         */
        if (
            sideA + sideB <= sideC + 1e-9 ||
            sideA + sideC <= sideB + 1e-9 ||
            sideB + sideC <= sideA + 1e-9
        ) {
            return false;
        }

        /*
         * A fixed angle constrains the shape, so the side
         * lengths must still produce it. The angle opposite
         * a side follows from the cosine rule, so each fixed
         * angle is checked against the candidate sides and
         * the edit is refused if it would break one.
         */
        const angleFromSides = (
            opposite,
            first,
            second
        ) => {
            const cosine =
                (
                    first * first +
                    second * second -
                    opposite * opposite
                ) /
                (2 * first * second);

            return (
                Math.acos(
                    Math.max(
                        -1,
                        Math.min(1, cosine)
                    )
                ) *
                180 /
                Math.PI
            );
        };

        /*
         * Angle 1 is opposite side 2, angle 2 opposite side 3
         * and angle 3 opposite side 1, matching the labelling
         * used by triangleMeasurements.
         */
        const candidateAngles = [
            angleFromSides(sideB, sideC, sideA),
            angleFromSides(sideC, sideA, sideB),
            angleFromSides(sideA, sideB, sideC)
        ];

        const brokenAngle =
            [0, 1, 2].some(
                position => {
                    const angleKey =
                        `angle${position + 1}`;

                    if (!fixed(angleKey)) {
                        return false;
                    }

                    const pinned =
                        Number(
                            object.constraints[
                                `${angleKey}Value`
                            ]
                        );

                    if (!Number.isFinite(pinned)) {
                        return false;
                    }

                    return (
                        Math.abs(
                            candidateAngles[position] -
                            pinned
                        ) > 0.5
                    );
                }
            );

        if (brokenAngle) {
            return false;
        }

        /*
         * Keep side 1 between point 1 and point 2,
         * so a change there moves point 2 along the
         * existing direction and then re-solves
         * point 3.
         */
        const first = {
            ...points[0]
        };

        const direction =
            Math.atan2(
                points[1].y -
                    points[0].y,
                points[1].x -
                    points[0].x
            );

        const second = {
            x:
                first.x +
                sideA *
                    Math.cos(direction),

            y:
                first.y +
                sideA *
                    Math.sin(direction)
        };

        /*
         * THE TWO REMAINING SIDES ARE PASSED IN THE ORDER THE SOLVER READS
         * THEM, AND THEY WERE THE WRONG WAY ROUND.
         *
         * `triangleThirdPoint(first, second, firstSide, secondSide, current)`
         * places the third point by measuring `firstSide` FROM `first` and
         * `secondSide` FROM `second`.
         *
         * The three sides are, by the labelling `triangleMeasurements` uses:
         *
         *     sideA = first -> second
         *     sideB = second -> third      <- measured from `second`
         *     sideC = third -> first       <- measured from `first`
         *
         * So the side measured from `first` is `sideC` and the one from
         * `second` is `sideB`. Passing them as (sideB, sideC) therefore
         * built a triangle whose last two edges were SWAPPED: a side edited
         * to 200 mm came out on the next edge round, so dimensioning one side
         * appeared to resize a different one - which is the "it always picks
         * the wrong side" behaviour a student sees.
         *
         * The rebuilt triangle must reproduce the sides it was given, and
         * these tests assert exactly that: edge 1->2 is sideB and edge 2->0
         * is sideC.
         */
        const third =
            triangleThirdPoint(
                first,
                second,
                sideC,
                sideB,
                points[2]
            );

        if (!third) {
            return false;
        }

        g.points = [
            first,
            second,
            third
        ];

        return true;
    }

    if (angleIndex) {
        if (!positive || fixed(key)) {
            return false;
        }

        const index =
            Number(angleIndex[1]) - 1;

        const angles =
            measurements.angles.slice();

        /*
         * Do not apply a third angle when the other
         * two already fix the remaining angle, and
         * reject any set that cannot sum to 180
         * degrees.
         */
        const otherAngles =
            angles.filter(
                (_, position) =>
                    position !== index
            );

        if (
            value >= 180 ||
            value +
                otherAngles[0] +
                otherAngles[1] <=
                1e-9
        ) {
            return false;
        }

        angles[index] = value;

        /*
         * Changing one angle breaks the 180 degree rule on
         * its own, so the difference is absorbed by a
         * single other angle wherever that is possible.
         * Only when one angle cannot take the whole change
         * is the remainder shared with the third, so as few
         * values as possible are disturbed.
         */
        const remainder =
            180 - value;

        const otherTotal =
            otherAngles[0] +
            otherAngles[1];

        if (
            remainder <= 0 ||
            otherTotal <= 0
        ) {
            return false;
        }

        const otherIndices =
            [0, 1, 2].filter(
                position =>
                    position !== index
            );

        /*
         * A fixed angle must never be changed indirectly,
         * so the whole remainder has to be absorbed by the
         * angles that are still free.
         */
        const freeIndices =
            otherIndices.filter(
                position =>
                    !fixed(
                        `angle${position + 1}`
                    )
            );

        if (!freeIndices.length) {
            return false;
        }

        /*
         * Restore any fixed angles to the value they were
         * pinned to, then give the remainder to the free
         * angles.
         */
        otherIndices.forEach(
            position => {
                const angleKey =
                    `angle${position + 1}`;

                if (!fixed(angleKey)) {
                    return;
                }

                const pinned =
                    Number(
                        object.constraints[
                            `${angleKey}Value`
                        ]
                    );

                angles[position] =
                    Number.isFinite(pinned) &&
                    pinned > 0
                        ? pinned
                        : otherAngles[
                            otherIndices.indexOf(
                                position
                            )
                        ];
            }
        );

        const freeRemainder =
            remainder -
            otherIndices.reduce(
                (
                    total,
                    position
                ) =>
                    freeIndices.includes(
                        position
                    )
                        ? total
                        : total +
                            angles[position],
                0
            );

        if (freeRemainder <= 0) {
            return false;
        }

        const freeTotal =
            freeIndices.reduce(
                (
                    total,
                    position
                ) =>
                    total +
                    otherAngles[
                        otherIndices.indexOf(
                            position
                        )
                    ],
                0
            );

        if (freeIndices.length === 1) {
            angles[freeIndices[0]] =
                freeRemainder;
        } else if (freeTotal > 0) {
            /*
             * Spread across the free angles in proportion
             * to their current sizes, disturbing as little
             * as possible.
             */
            freeIndices.forEach(
                position => {
                    angles[position] =
                        otherAngles[
                            otherIndices.indexOf(
                                position
                            )
                        ] *
                        (freeRemainder / freeTotal);
                }
            );
        } else {
            return false;
        }

        const total =
            angles[0] +
            angles[1] +
            angles[2];

        /*
         * Guard against any non-finite value reaching the
         * geometry.
         */
        if (
            !Number.isFinite(total) ||
            angles.some(
                angle =>
                    !Number.isFinite(angle) ||
                    angle <= 0
            )
        ) {
            return false;
        }

        if (
            Math.abs(total - 180) > 1e-6
        ) {
            /*
             * The angles no longer form a triangle, so
             * keep the geometry unchanged rather than
             * writing an invalid shape.
             */
            return false;
        }

            /*
             * Choose the base side.
             *
             * When a side is fixed, that side becomes the base
             * and is rebuilt to its pinned length, so an angle
             * change can never disturb a constrained side.
             * Otherwise side 1 stays the base as before.
             */
            const fixedSideIndex =
                [0, 1, 2].find(
                    position => {
                        const pinned =
                            Number(
                                object.constraints[
                                    `side${position + 1}Value`
                                ]
                            );

                        return (
                            fixed(
                                `side${position + 1}`
                            ) &&
                            Number.isFinite(pinned) &&
                            pinned > 0
                        );
                    }
                );

            const baseIndex =
                fixedSideIndex === undefined
                    ? 0
                    : fixedSideIndex;

            const base =
                fixedSideIndex === undefined
                    ? measurements.sides[0]
                    : Number(
                        object.constraints[
                            `side${baseIndex + 1}Value`
                        ]
                    );

            if (
                !Number.isFinite(base) ||
                base <= 0
            ) {
                return false;
            }

            const radians =
                angles.map(
                    angle =>
                        angle *
                        Math.PI /
                        180
                );

            /*
             * Rebuild from side 1 as the base, matching how
             * triangleMeasurements labels the angles:
             *
             *   angle 1 at vertex 0, angle 2 at vertex 1,
             *   angle 3 at vertex 2, so angle 3 is opposite
             *   the base and side 1 = base.
             *
             * The sine rule then gives the other two sides,
             * and the vertices keep their existing order so
             * each angle stays attached to its own vertex.
             */
            const baseAngle =
                Math.sin(radians[2]);

            if (baseAngle <= 1e-9) {
                return false;
            }

            const first = {
                ...points[0]
            };

            const direction =
                Math.atan2(
                    points[1].y - points[0].y,
                    points[1].x - points[0].x
                );

            const second = {
                x:
                    first.x +
                    base *
                        Math.cos(direction),

                y:
                    first.y +
                    base *
                        Math.sin(direction)
            };

            const solved =
                triangleThirdPoint(
                    first,
                    second,
                    base *
                        Math.sin(radians[1]) /
                        baseAngle,
                    base *
                        Math.sin(radians[0]) /
                        baseAngle,
                    points[2]
                );

            if (!solved) {
                return false;
            }

            /*
             * Any other fixed side is honoured by scaling the
             * solved triangle about vertex 0 until that side
             * reaches its pinned length. Scaling keeps every
             * angle intact, so the fixed side and the edited
             * angle are both satisfied.
             */
            const candidate = [
                first,
                second,
                solved
            ];

            const otherFixed =
                [0, 1, 2].find(
                    position =>
                        position !== 0 &&
                        fixed(
                            `side${position + 1}`
                        ) &&
                        Number.isFinite(
                            Number(
                                object.constraints[
                                    `side${position + 1}Value`
                                ]
                            )
                        )
                );

            if (otherFixed !== undefined) {
                const pinned =
                    Number(
                        object.constraints[
                            `side${otherFixed + 1}Value`
                        ]
                    );

                const a =
                    candidate[
                        otherFixed
                    ];

                const b =
                    candidate[
                        (otherFixed + 1) % 3
                    ];

                const current =
                    Math.hypot(
                        b.x - a.x,
                        b.y - a.y
                    );

                if (current > 1e-9 && pinned > 0) {
                    const factor =
                        pinned / current;

                    for (
                        let i = 0;
                        i < candidate.length;
                        i += 1
                    ) {
                        candidate[i] = {
                            x:
                                first.x +
                                (candidate[i].x - first.x) *
                                    factor,

                            y:
                                first.y +
                                (candidate[i].y - first.y) *
                                    factor
                        };
                    }
                }
            }

            g.points = [
                candidate[0],
                candidate[1],
                candidate[2]
            ];

            return true;
        }

    return false;
}

/*
 * Place the third vertex from two known vertices
 * and the two side lengths that reach it, keeping
 * the same side of the base as the current point so
 * the triangle does not flip while being edited.
 */
function triangleThirdPoint(
    first,
    second,
    firstSide,
    secondSide,
    current
) {
    const base =
        distance(first, second);

    if (
        base <= 1e-9 ||
        firstSide <= 1e-9 ||
        secondSide <= 1e-9
    ) {
        return null;
    }

    if (
        firstSide + secondSide <=
            base + 1e-9 ||
        Math.abs(firstSide - secondSide) >=
            base - 1e-9
    ) {
        return null;
    }

    const along =
        (
            base * base +
            firstSide * firstSide -
            secondSide * secondSide
        ) /
        (2 * base);

    const height =
        Math.sqrt(
            Math.max(
                0,
                firstSide * firstSide -
                    along * along
            )
        );

    const direction = {
        x: (second.x - first.x) / base,
        y: (second.y - first.y) / base
    };

    const basePoint = {
        x: first.x + direction.x * along,
        y: first.y + direction.y * along
    };

    /*
     * Two solutions exist; keep the one on the same
     * side of the base as the current vertex.
     */
    const cross =
        direction.x *
            (current.y - first.y) -
        direction.y *
            (current.x - first.x);

    const sign =
        cross >= 0
            ? 1
            : -1;

    return {
        x:
            basePoint.x -
            direction.y *
                height *
                sign,

        y:
            basePoint.y +
            direction.x *
                height *
                sign
    };
}
