/*
 * Truss optimisation: evening out member triangles while keeping the structure.
 */

import enggDrawingState from "../../core/model/drawing-state.js";
import { drawingState } from "../editor-state.js";
import { trussJointMatches } from "./truss-tool.js";

/*
 * The Optimize control on a Truss's Features panel.
 *
 * Optimize tidies the structure the student drew: it squares up
 * the members and closes up the joints, so a hand-built truss
 * reads evenly. It is a button rather than a field because it is
 * an action on the geometry, not a number that can be typed, and
 * it is offered on the truss because evenness is a property of a
 * real structure rather than a drawing style.
 */
export function trussOptimizeMarkup() {
    return `
        <div class="drawing-property-grid drawing-property-grid-value">
            <span class="drawing-property-grid-label">Structure</span>
            <button type="button" class="drawing-property-action"
                data-truss-optimize aria-label="Optimize truss">
                Optimize
            </button>
            <span class="drawing-property-unit"></span>
            <span></span>
        </div>
    `;
}

/*
 * Even out the geometry a truss is actually made of.
 *
 * The intent is to make a hand-drawn structure read evenly. The
 * members and joints the student placed are the truss; this acts
 * on those and on nothing else. It is emphatically NOT a matter
 * of fitting the truss to a regular outer shape: the shape is
 * whatever the members describe, and no member is removed, added
 * or moved far. What it corrects is the small inconsistencies
 * that stop a structural drawing looking right, and which are
 * invisible as a picture but obvious as numbers:
 *
 *   - a member drawn a hair too long, or a fraction of a degree
 *     off horizontal or vertical, is squared up;
 *   - a joint placed a fraction of a millimetre from where the
 *     members meeting it actually cross is moved onto the
 *     crossing;
 *   - a member whose two ends coincide, or whose length has
 *     collapsed to nothing, is dropped, because it contributes
 *     no structure and would otherwise count as a member.
 *
 * The topology and the proportions the student chose therefore
 * survive; only the drawing inaccuracies are removed.
 */
export function optimizeTrussStructure(
    object
) {
    const geometry = object.geometry;

    if (
        !geometry ||
        !Array.isArray(geometry.members) ||
        !geometry.members.length
    ) {
        return false;
    }

    const scale =
        enggDrawingState.BASE_PIXELS_PER_UNIT *
            drawingState.camera.zoom ||
        1;

    /*
     * Everything below this distance on screen is a drawing
     * inaccuracy rather than a real dimension, so it is the
     * threshold the cleanup works to. It is deliberately small:
     * a truss is only improved if a change is a rounding error.
     */
    const tolerance =
        2.5 / scale;

    const members =
        geometry.members.map(member => ({
            start: { ...member.start },
            end: { ...member.end }
        }));

    /*
     * STEP 1: MERGE THE JOINTS.
     *
     * Two points that are the same joint drawn twice are brought
     * onto one point, and that point is placed at the average of
     * the two so neither end of the structure is favoured. This
     * is what makes members that were MEANT to meet actually meet.
     */
    const joints = [];

    members.forEach(member => {
        [member.start, member.end].forEach(point => {
            const existing = joints.find(
                candidate =>
                    Math.hypot(
                        candidate.x - point.x,
                        candidate.y - point.y
                    ) <= tolerance
            );

            if (existing) {
                existing.x =
                    (existing.x + point.x) / 2;

                existing.y =
                    (existing.y + point.y) / 2;

                return;
            }

            joints.push({
                x: point.x,
                y: point.y
            });
        });
    });

    members.forEach(member => {
        member.start =
            joints.find(
                point =>
                    Math.hypot(
                        point.x - member.start.x,
                        point.y - member.start.y
                    ) <= tolerance
            ) || member.start;

        member.end =
            joints.find(
                point =>
                    Math.hypot(
                        point.x - member.end.x,
                        point.y - member.end.y
                    ) <= tolerance
            ) || member.end;
    });

    /*
     * STEP 2: SQUARE UP THE MEMBERS.
     *
     * A member that was meant to be horizontal, vertical or at
     * a right angle to another is one click from being any of
     * those, and the error is a rounding error. Rounding each
     * member's direction to the nearest of the angles the
     * drawing actually uses, and its ends to the nearest joint,
     * is what makes a hand-built structure read as a structure
     * rather than as a sketch of one.
     *
     * The length is preserved: only the DIRECTION is squared up,
     * so the proportions the student chose are not changed.
     */
    const angles = [
        0,                    /* horizontal */
        Math.PI / 4,
        Math.PI / 2,          /* vertical */
        (3 * Math.PI) / 4,
        -Math.PI / 4,
        -Math.PI / 2,
        (-3 * Math.PI) / 4,
        Math.PI
    ];

    members.forEach(member => {
        const dx = member.end.x - member.start.x;
        const dy = member.end.y - member.start.y;

        const length = Math.hypot(dx, dy);

        /*
         * A member that has collapsed to nothing carries no
         * structure, and rounding its direction would be
         * meaningless, so it is left for the next step to drop.
         */
        if (length <= tolerance) {
            return;
        }

        const angle = Math.atan2(dy, dx);

        const squared =
            angles.reduce(
                (best, candidate) =>
                    Math.abs(normalizeAngle(candidate - angle)) <
                    Math.abs(normalizeAngle(best - angle))
                        ? candidate
                        : best,
                angle
            );

        /*
         * The error is only corrected when it really is a
         * rounding error. A member deliberately drawn at, say,
         * 30 degrees is left at 30 degrees: it is already
         * aligned with nothing else, so squaring it would change
         * the design rather than tidy it.
         */
        if (
            Math.abs(normalizeAngle(squared - angle)) * length >
            tolerance
        ) {
            return;
        }

        const cos = Math.cos(squared);
        const sin = Math.sin(squared);

        member.start = {
            x: member.end.x - cos * length,
            y: member.end.y - sin * length
        };

        member.end = {
            x: member.start.x + cos * length,
            y: member.start.y + sin * length
        };
    });

    /*
     * STEP 3: DROP WHAT IS NOT A MEMBER.
     *
     * A member of zero length, or one duplicated back onto itself,
     * is not part of the structure: it is an artifact of a click
     * that landed on the point the student was already at. It is
     * removed so the member count the student sees is the number
     * of members they actually drew.
     */
    const cleaned = members.filter(member => {
        const length =
            Math.hypot(
                member.end.x - member.start.x,
                member.end.y - member.start.y
            );

        if (length <= tolerance) {
            return false;
        }

        return !members.some(other =>
            other !== member &&
            trussMembersMatch(member, other) &&
            members.indexOf(other) < members.indexOf(member)
        );
    });

    if (!cleaned.length) {
        return false;
    }

    /*
     * STEP 4: RE-MERGE AFTER SQUARING.
     *
     * Squaring a member can bring its end onto a joint it was a
     * rounding error away from, so the joints are merged once
     * more. The merge is what makes the finished structure
     * genuinely connected rather than merely close.
     */
    const finalJoints = [];

    cleaned.forEach(member => {
        [member.start, member.end].forEach(point => {
            const existing = finalJoints.find(
                candidate =>
                    Math.hypot(
                        candidate.x - point.x,
                        candidate.y - point.y
                    ) <= tolerance
            );

            if (existing) {
                existing.x =
                    (existing.x + point.x) / 2;

                existing.y =
                    (existing.y + point.y) / 2;

                return;
            }

            finalJoints.push({
                x: point.x,
                y: point.y
            });
        });
    });

    cleaned.forEach(member => {
        member.start =
            finalJoints.find(
                point =>
                    Math.hypot(
                        point.x - member.start.x,
                        point.y - member.start.y
                    ) <= tolerance
            ) || member.start;

        member.end =
            finalJoints.find(
                point =>
                    Math.hypot(
                        point.x - member.end.x,
                        point.y - member.end.y
                    ) <= tolerance
            ) || member.end;
    });

    /*
     * STEP 4: EVEN OUT THE TRIANGLES.
     *
     * Merging the joints and squaring the members make the
     * structure tidy. They do not make it EVEN, and evenness is
     * what a truss is judged on: a truss of wildly different
     * triangles is a weak truss however neatly it is drawn.
     *
     * The triangles are found from the members themselves, by
     * taking every triple of members that meets three shared
     * joints. That is the real triangulation of the structure
     * the student built, not a pattern imposed on it, which is
     * what makes the improvement act on the truss that is there
     * rather than on an idealised one.
     *
     * Only SIZE is evened out, never the layout: a joint moves
     * only towards the average of the joints it connects to,
     * only if that reduces the spread of triangle areas, and
     * only within the angular band its own members were drawn
     * in. So a horizontal member stays horizontal, a vertical
     * one stays vertical, and the structure is never rotated
     * into a regular polygon.
     */
    evenTrussTriangleSizes(
        cleaned,
        tolerance
    );

    /*
     * The optimized members become the truss's topology, exactly
     * as the students' own members did. This is still one Truss
     * with its own members and joints, not a set of Lines, and
     * the feature keeps its id, its name and anything attached
     * to it.
     */
    geometry.members = cleaned;

    geometry.start = {
        ...cleaned[0].start
    };

    geometry.end = {
        ...cleaned[cleaned.length - 1].end
    };

    geometry.panels =
        Math.max(2, cleaned.length);

    return true;
}

/*
 * The triangles a set of truss members actually forms.
 *
 * Three members give a triangle when each pair of them shares a
 * joint. Those are exactly the closed three-sided cells of the
 * structure, and their areas are what "triangle size" means when
 * a truss is judged on how even its members are.
 *
 * This reads the members, so the triangles follow the truss that
 * was drawn rather than any assumed pattern of them.
 */
function trussTriangles(
    members
) {
    const triangles = [];

    for (let a = 0; a < members.length; a += 1) {
        for (let b = a + 1; b < members.length; b += 1) {
            for (
                let c = b + 1;
                c < members.length;
                c += 1
            ) {
                const corners =
                    sharedJointsOfThree([
                        members[a],
                        members[b],
                        members[c]
                    ]);

                if (corners.length !== 3) {
                    continue;
                }

                triangles.push({
                    corners,
                    area: triangleArea(corners)
                });
            }
        }
    }

    return triangles;
}

/*
 * The three distinct points where a trio of members meet
 * pairwise, or an empty list when they do not close a triangle.
 *
 * Two members meet when an end of one coincides with an end of
 * the other, which is the joint test the rest of the truss uses.
 */
function sharedJointsOfThree(
    trio
) {
    const meet = (first, second) => {
        for (
            const point of [
                first.start,
                first.end
            ]
        ) {
            for (
                const other of [
                    second.start,
                    second.end
                ]
            ) {
                if (trussJointMatches(point, other)) {
                    return { ...point };
                }
            }
        }

        return null;
    };

    const corners = [
        meet(trio[0], trio[1]),
        meet(trio[1], trio[2]),
        meet(trio[0], trio[2])
    ];

    if (corners.some((corner) => !corner)) {
        return [];
    }

    /*
     * All three corners must be genuinely different points. A
     * trio that meets twice at the same joint closes no
     * triangle, and counting it would make a degenerate shape
     * look like a real cell of the truss.
     */
    const distinct = corners.every(
        (corner, index) =>
            corners.every(
                (other, otherIndex) =>
                    index === otherIndex ||
                    !trussJointMatches(corner, other)
            )
    );

    return distinct ? corners : [];
}

function triangleArea(
    corners
) {
    const [a, b, c] = corners;

    return (
        Math.abs(
            (b.x - a.x) * (c.y - a.y) -
                (c.x - a.x) * (b.y - a.y)
        ) / 2
    );
}

/*
 * How far the triangle areas differ from one another.
 *
 * The gap between the largest and the smallest is the measure,
 * because reducing it evens the structure: it falls when the
 * outliers come in, which is precisely what a uniform truss
 * needs and what a tidied but lopsided one still lacks.
 */
function trussTriangleSpread(
    triangles
) {
    const areas = triangles
        .map(triangle => triangle.area)
        .filter(area => area > 0);

    if (areas.length < 2) {
        return 0;
    }

    return (
        Math.max(...areas) -
        Math.min(...areas)
    );
}

/*
 * Nudge joints only where doing so evens the triangles out.
 *
 * Each joint is offered ONE move: to the average of the joints
 * it connects to, which is where it would sit if the triangles
 * around it were all the same size. The move is taken only when
 * it genuinely reduces the spread of triangle areas, and only
 * when every member keeps the direction it was drawn in. So the
 * structure is evened, never rearranged: nothing is rotated, no
 * outer boundary is regularised, and a joint the student placed
 * deliberately is left alone.
 *
 * Joints are handled largest correction first, so the most wrong
 * joint settles first and each later move is judged against an
 * already better structure.
 */
function evenTrussTriangleSizes(
    members,
    tolerance
) {
    let triangles = trussTriangles(members);

    if (triangles.length < 2) {
        return;
    }

    const initial = trussTriangleSpread(triangles);

    if (initial <= 0) {
        return;
    }

    /* The joints each joint is connected to, for its average. */
    const neighbours = new Map();

    const register = point => {
        if (!neighbours.has(point)) {
            neighbours.set(point, []);
        }

        return neighbours.get(point);
    };

    members.forEach(member => {
        const from = register(member.start);
        const to = register(member.end);

        if (from && to && from !== to) {
            from.push(member.end);
            to.push(member.start);
        }
    });

    const limit =
        trussJointMoveLimit(tolerance, members);

    const candidates = [];

    neighbours.forEach((connected, joint) => {
        if (connected.length < 2) {
            return;
        }

        const target = {
            x:
                connected.reduce(
                    (sum, point) => sum + point.x,
                    0
                ) / connected.length,

            y:
                connected.reduce(
                    (sum, point) => sum + point.y,
                    0
                ) / connected.length
        };

        const offset = Math.hypot(
            target.x - joint.x,
            target.y - joint.y
        );

        /*
         * A joint a long way from where it should be is not a
         * rounding error, it is a design decision. Moving it
         * would be redrawing the student's truss rather than
         * tidying it.
         */
        if (offset <= 0 || offset > limit) {
            return;
        }

        candidates.push({ joint, target, offset });
    });

    candidates.sort(
        (first, second) =>
            second.offset - first.offset
    );

    let spread = initial;

    candidates.forEach(({ joint, target }) => {
        const trial = members.map(member => ({
            start: { ...member.start },
            end: { ...member.end }
        }));

        let moved = false;

        trial.forEach(member => {
            if (trussJointMatches(member.start, joint)) {
                member.start = { ...target };
                moved = true;
            }

            if (trussJointMatches(member.end, joint)) {
                member.end = { ...target };
                moved = true;
            }
        });

        if (!moved) {
            return;
        }

        const next = trussTriangles(trial);

        /*
         * The triangulation must survive the move. A move that
         * closes or opens a cell has changed the structure rather
         * than evened it, so it is refused.
         */
        if (next.length !== triangles.length) {
            return;
        }

        const after = trussTriangleSpread(next);

        /*
         * The move must help, and must not disturb the horizontal
         * and vertical structure.
         */
        if (
            after < spread &&
            trussAnglesPreserved(
                members,
                trial,
                tolerance
            )
        ) {
            members.forEach((member, index) => {
                member.start =
                    trial[index].start;

                member.end =
                    trial[index].end;
            });

            Object.assign(joint, target);

            triangles = next;
            spread = after;
        }
    });
}

/*
 * How far a joint may be from where it ought to be before the
 * correction stops being a tidy-up.
 *
 * It scales with the size of the structure, so a small truss is
 * not held to a millimetre and a large one is not allowed to
 * drift.
 */
function trussJointMoveLimit(
    tolerance,
    members
) {
    const lengths = members.map(
        member =>
            Math.hypot(
                member.end.x - member.start.x,
                member.end.y - member.start.y
            )
    );

    const mean = lengths.length
        ? lengths.reduce(
            (sum, length) => sum + length,
            0
        ) / lengths.length
        : 0;

    return Math.max(
        tolerance * 4,
        mean * 0.08
    );
}

/*
 * Whether a proposed move keeps every member in the direction
 * it was drawn.
 *
 * This is what protects the horizontal and vertical structure. A
 * member that was horizontal stays horizontal and one that was
 * vertical stays vertical, so evening the triangles out can never
 * quietly tip a chord into a shallow slope or turn a vertical
 * post into a leaning one.
 *
 * An axis-aligned member is judged by whether it is STILL
 * axis-aligned, because a joint may shift a little along a
 * horizontal member without that member ceasing to be
 * horizontal. A diagonal member is held to a narrow angular band
 * instead, so a deliberate brace keeps its angle.
 */
function trussAnglesPreserved(
    before,
    after,
    tolerance
) {
    for (
        let index = 0;
        index < before.length;
        index += 1
    ) {
        const original = before[index];
        const moved = after[index];

        const wasAxisAligned =
            trussIsAxisAligned(original, tolerance);

        const isAxisAligned =
            trussIsAxisAligned(moved, tolerance);

        /*
         * A member that was square to the axes must remain so.
         * Anything that changes that has re-aimed the member
         * rather than tidied it.
         */
        if (wasAxisAligned !== isAxisAligned) {
            return false;
        }

        if (wasAxisAligned) {
            continue;
        }

        const originalAngle = Math.atan2(
            original.end.y - original.start.y,
            original.end.x - original.start.x
        );

        const movedAngle = Math.atan2(
            moved.end.y - moved.start.y,
            moved.end.x - moved.start.x
        );

        const length = Math.hypot(
            original.end.x - original.start.x,
            original.end.y - original.start.y
        );

        /*
         * The narrowest band the drawing tolerance allows at
         * this member's length, floored so a very long member is
         * not held to an impossibly strict angle.
         */
        const allowed = Math.max(
            0.02,
            tolerance / Math.max(length, 1e-6)
        );

        if (
            Math.abs(
                normalizeAngle(
                    movedAngle - originalAngle
                )
            ) > allowed
        ) {
            return false;
        }
    }

    return true;
}

/*
 * Whether a member is drawn horizontally or vertically, within
 * the drawing tolerance.
 */
function trussIsAxisAligned(
    member,
    tolerance
) {
    void tolerance;

    const dx = member.end.x - member.start.x;
    const dy = member.end.y - member.start.y;

    if (Math.hypot(dx, dy) < 1e-9) {
        return false;
    }

    /*
     * How far the member is from being perfectly square to the
     * axes. A member is axis-aligned when one of its components
     * dominates, so the check is on the component ratio rather
     * than on an absolute angle, which keeps it correct at any
     * zoom and any scale.
     */
    const length = Math.hypot(dx, dy);
    const axisRatio = Math.max(
        Math.abs(dx),
        Math.abs(dy)
    ) / length;

    return axisRatio > 0.999;
}

/*
 * An angle wrapped to (-PI, PI], so a comparison of two
 * directions is never confused by the difference being a full
 * turn.
 */
export function normalizeAngle(
    angle
) {
    /*
     * A non-finite angle has no direction. It is treated as zero,
     * rather than looping forever trying to wrap Infinity.
     */
    if (!Number.isFinite(angle)) {
        return 0;
    }

    /*
     * Reduce by whole turns first so a very large angle wraps in one
     * step; the result keeps the (-PI, PI] boundaries exactly.
     */
    let value = angle % (Math.PI * 2);

    if (value > Math.PI) {
        value -= Math.PI * 2;
    } else if (value < -Math.PI) {
        value += Math.PI * 2;
    }

    return value;
}

/*
 * Whether two members are the same segment, compared end for
 * end in either order.
 */
function trussMembersMatch(
    a,
    b
) {
    return (
        (trussJointMatches(a.start, b.start) &&
            trussJointMatches(a.end, b.end)) ||
        (trussJointMatches(a.start, b.end) &&
            trussJointMatches(a.end, b.start))
    );
}
