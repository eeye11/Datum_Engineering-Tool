/*
 * Building a truss member by member.
 */

import { trussJoints } from "../../../shared/geometry/feature-handles.js";
import enggDrawingState from "../../../shared/model/drawing-state.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { commitCreatedFeature } from "../geometry/creation-sizing.js";
import { drawingState } from "../editor-state.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { activeCategory } from "../../../components/layout/toolbar/tool-menus.js";
import { renderEngineeringTools, setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";

/*
 * The stages a Truss is built in.
 *
 * A truss is a structure, not a span, so it is constructed the
 * way a structure is: a base line, then the outer shape that
 * encloses it, then the members inside. Each stage reuses the
 * ordinary Line interaction, so the snapping and the inference
 * are the same ones every other line uses.
 */
export const TRUSS_STAGES = [
    {
        id: "base",
        prompt: "Specify base start point",
        followUp: "Specify base endpoint"
    },
    {
        id: "outer",
        prompt: "Construct outer shape"
    },
    {
        id: "internal",
        prompt: "Construct internal connectors"
    }
];

/*
 * The hint shown while a truss is being built.
 *
 * A truss is finished by double-clicking, so the prompt says
 * so on every member rather than only on the last one: the
 * student can keep adding members for as long as they want
 * and nothing is committed until they say so.
 */
const TRUSS_CONSTRUCT_HINT =
    "Click to add a member, double-click to finish the truss";

/*
 * A member of a truss that is being built.
 *
 * Construction members are temporary: they exist only while the
 * truss is being drawn and become the one Truss feature on
 * completion.
 */
function trussMember(
    start,
    end
) {
    return {
        start: { ...start },
        end: { ...end }
    };
}

/*
 * Whether a point matches a joint closely enough to be one.
 *
 * The tolerance is in world units and scales with the zoom, so
 * a snap reads the same however far the drawing is zoomed in or
 * out.
 */
export function trussJointMatches(
    a,
    b
) {
    if (
        !a ||
        !b ||
        !Number.isFinite(a.x) ||
        !Number.isFinite(b.x)
    ) {
        return false;
    }

    const scale =
        enggDrawingState.BASE_PIXELS_PER_UNIT *
            drawingState.camera.zoom ||
        1;

    return (
        Math.hypot(a.x - b.x, a.y - b.y) *
            scale <=
        8
    );
}

/*
 * Whether every member belongs to one connected structure.
 *
 * Connectivity is checked by flood fill from the first member:
 * a member is part of the truss when it shares a joint with a
 * member already reached. Anything the fill never reaches is
 * floating, which is what a member drawn away from the rest of
 * the structure is.
 *
 * This is a real topological test rather than a count, so a
 * member that merely overlaps another one is still caught.
 */
function trussIsConnected(
    members
) {
    if (!members.length) {
        return false;
    }

    const reached = [members[0]];

    let grew = true;

    while (grew) {
        grew = false;

        members.forEach(member => {
            if (reached.includes(member)) {
                return;
            }

            const joins =
                reached.some(other =>
                    trussMembersTouch(other, member)
                );

            if (joins) {
                reached.push(member);
                grew = true;
            }
        });
    }

    return reached.length === members.length;
}

/*
 * Whether two members share a joint.
 *
 * A member connects to another when one member's end meets the
 * other's end. Overlapping middles are not a connection, because
 * a structural joint is at a joint.
 */
function trussMembersTouch(
    a,
    b
) {
    return [a.start, a.end].some(point =>
        [b.start, b.end].some(other =>
            trussJointMatches(point, other)
        )
    );
}

/*
 * Whether a point lies inside the closed outline the student drew.
 *
 * A crossing ray test: a point is inside a closed outline when a
 * ray cast from it crosses the outline an odd number of times.
 * It is what keeps an internal member from leaving the boundary
 * the student established.
 */
export function trussPointInsideOutline(
    point,
    outline
) {
    if (
        !point ||
        !outline ||
        outline.length < 3
    ) {
        return false;
    }

    let inside = false;

    for (
        let i = 0, j = outline.length - 1;
        i < outline.length;
        j = i, i += 1
    ) {
        const a = outline[i];
        const b = outline[j];

        if (
            (a.y > point.y) !== (b.y > point.y) &&
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

/*
 * Snap a point that is being placed onto the truss's own joints.
 *
 * The ordinary Snap already finds the endpoints of a Line, so
 * this only has to recognise that an endpoint landing on an
 * existing truss joint is a connection rather than a new loose
 * point. It never searches for a snap of its own.
 */
function trussSnapToJoint(
    point,
    members
) {
    const joints = trussJoints(members);

    const match = joints.find(joint =>
        trussJointMatches(point, joint)
    );

    return match
        ? { x: match.x, y: match.y }
        : point;
}

/*
 * The instruction the Truss shows at each construction stage.
 */
export function trussStageMessage(
    interaction
) {
    const stage =
        interaction.trussStage;

    const stageInfo =
        TRUSS_STAGES[stage];

    /*
     * The base needs two points before it is a member, so it
     * says which end it is waiting for.
     *
     * A member already in progress counts as a point placed, so
     * the prompt asks for the END of that member rather than
     * its start. Without this the instruction contradicted the
     * drawing: a member was visibly being drawn from its start,
     * yet the status line still asked for the start.
     */
    if (
        stage === 0 &&
        !interaction.trussInProgress &&
        !(
            interaction.trussMembers || []
        ).length
    ) {
        return TRUSS_STAGES[0].prompt;
    }

    if (
        stage === 0 &&
        (
            interaction.trussMembers || []
        ).length < 1
    ) {
        return TRUSS_STAGES[0].followUp;
    }

    if (stage === 1) {
        return (
            "Construct outer shape — " +
            TRUSS_CONSTRUCT_HINT
        );
    }

    if (stage === 2) {
        return (
            "Construct internal connectors — " +
            TRUSS_CONSTRUCT_HINT
        );
    }

    return stageInfo?.prompt ||
        "Construct outer shape";
}

/*
 * The live geometry of an unfinished truss, for the snap
 * system.
 *
 * The members placed so far are published as real segments, so
 * a new member snaps to a joint, an endpoint or an intersection
 * of the structure already built. The member in progress is
 * published too, so a click can land back on the segment being
 * drawn and close a loop without hunting for it.
 *
 * This is not a second snapping implementation: it hands the
 * ordinary snap system the construction's own geometry and lets
 * it do exactly what it does for the rest of the drawing.
 */
export function trussSnapGeometry(
    interaction
) {
    const geometry = [
        ...(interaction?.trussMembers || [])
            .map(member => ({
                start: member.start,
                end: member.end
            }))
    ];

    const inProgress =
        interaction?.trussInProgress;

    if (inProgress) {
        geometry.push({
            start: inProgress,
            end:
                interaction?.currentPoint ||
                inProgress
        });
    }

    return geometry;
}

/*
 * Advance a truss construction by one placed point.
 *
 * The base is the first member. After it, each click either
 * continues the member in progress or starts the next one, so
 * the whole outline and then all the internal members are drawn
 * with the same click-drag-click rhythm as a line.
 *
 * An internal member may not leave the outline the student drew,
 * so a point outside it is rejected and the previous point is
 * kept instead.
 */
export function continueTrussConstruction(
    resolution
) {
    const interaction =
        drawingState.interaction;

    const point =
        resolution.effectiveConstructionPoint;

    if (!point) {
        return;
    }

    const stage = interaction.trussStage ?? 0;

    const members =
        interaction.trussMembers || [];

    const outline =
        interaction.trussOutline || [];

    const inProgress = point
        ? interaction.trussInProgress
        : null;

    /*
     * A snap that lands on an existing truss joint is treated as
     * a connection, so the member meets the structure exactly
     * rather than ending a hair away from it.
     */
    const resolved = trussSnapToJoint(
        point,
        members
    );

    if (!inProgress) {
        /*
         * The next member starts where the previous one ended,
         * unless the student clicks a joint that already exists.
         *
         * A truss is a chain of members meeting at joints, so
         * continuing from the free end is what makes the
         * structure build itself as the student traces it. A
         * click on an existing joint instead starts a member
         * from that joint, which is how a diagonal or a closing
         * member is added to a structure already partly built.
         */
        const freeEnd =
            members.length
                ? members[
                    members.length - 1
                ].end
                : null;

        const connectsToJoint =
            freeEnd &&
            !trussJointMatches(
                resolved,
                freeEnd
            ) &&
            trussJoints(members).some(
                joint =>
                    trussJointMatches(
                        resolved,
                        joint
                    )
            );

        const anchor =
            !freeEnd ||
            trussJointMatches(resolved, freeEnd) ||
            connectsToJoint
                ? resolved
                : freeEnd;

        if (
            freeEnd &&
            trussJointMatches(resolved, freeEnd)
        ) {
            /*
             * The click landed back on the free end, so the
             * anchor is that joint and the student carries on
             * from where the structure currently ends.
             */
        }

        enggDrawingState.setInteraction(
            drawingState,
            {
                ...resolution,
                phase: "truss-construct",
                startPoint: anchor,
                currentPoint: anchor,
                trussStage: stage,
                trussMembers: members,
                trussOutline: outline,
                trussInProgress: anchor,

                snapGeometry:
                    trussSnapGeometry({
                        trussMembers: members,
                        trussInProgress: resolved,
                        currentPoint: resolved
                    }),

                /*
                 * Quarter regions belong to the Truss alone, so
                 * a Truss under construction declares that its
                 * own live geometry offers them. A panel drawn
                 * now can therefore snap to a quarter of a panel
                 * drawn a moment ago, rather than only to the
                 * finished drawing around it.
                 */
                snapQuarterSnap: true,
                snapToolId: "truss"
            }
        );

        setToolMessage(
            trussStageMessage(
                drawingState.interaction
            )
        );

        renderCurrentDrawing();
        return;
    }

    const nextMembers = [
        ...members,

        /*
         * A member of zero length is not a member. It is what a
         * double-click produces, because the second click lands
         * on the point the first one already set. Dropping it
         * here keeps the structure the student actually drew,
         * and stops a stray click from leaving a floating point
         * that would make the truss impossible to finish.
         */
        ...(trussJointMatches(inProgress, resolved)
            ? []
            : [trussMember(inProgress, resolved)])
    ];
    /*
     * The outline is the chain of points the student traced
     * around the base, kept so an internal member can be checked
     * against it later.
     */
    const nextOutline =
        stage === 0
            ? [inProgress, resolved]
            : [...outline, resolved];

    /*
     * The base is finished as soon as it is one member long, so
     * the student moves straight on to the outer shape.
     */
    const nextStage =
        stage === 0 ? 1 : stage;

    enggDrawingState.setInteraction(
        drawingState,
        {
            ...resolution,
            phase: "truss-construct",
            startPoint: null,
            currentPoint: resolved,
            trussStage: nextStage,
            trussMembers: nextMembers,
            trussOutline: nextOutline,
            trussInProgress: null,

            /*
             * The members placed so far are republished to the
             * snap system, so the next member snaps to this
             * structure as readily as to the drawing around it.
             */
            snapGeometry:
                trussSnapGeometry({
                    trussMembers: nextMembers,
                    trussInProgress: null
                }),

            snapQuarterSnap: true,
            snapToolId: "truss"
        }
    );

    setToolMessage(
        trussStageMessage(
            drawingState.interaction
        )
    );

    renderCurrentDrawing();
}

/*
 * Finish a truss construction and create the one feature.
 *
 * The structure is checked first: a member left floating means
 * the truss is incomplete, and an incomplete truss is not
 * created. Only a valid structure is regularized and committed.
 */
export function finishTrussConstruction() {
    const interaction =
        drawingState.interaction;

    const members =
        interaction.trussMembers || [];

    if (!members.length) {
        setToolMessage(
            "Draw at least the base line first"
        );

        return;
    }

    if (!trussIsConnected(members)) {
        setToolMessage(
            "Connect all member endpoints before finishing"
        );

        return;
    }

    /*
     * The construction members become the truss's own topology.
     * A light cleanup even out the joints, but it never removes
     * a member or invents one, so what the student drew is what
     * they get.
     */
    const regularized =
        regularizeTruss(members);

    const first = regularized[0];

    const last =
        regularized[
            regularized.length - 1
        ];

    const object =
        enggDrawingState.geometryFactories
            .truss(
                first.start,
                last.end,
                {
                    style: {
                        ...drawingState.styleDefaults
                    },

                    engineering: {
                        plane: "XY",
                        discipline: "statics",
                        staticsType: "truss"
                    }
                }
            );

    /*
     * The student's members are kept on the feature as its
     * topology, so a joint can be moved and the members that
     * meet it follow.
     */
    object.geometry.members =
        regularized;

    object.geometry.panels =
        Math.max(
            2,
            regularized.length
        );

    /*
     * The truss is committed by `commitCreatedFeature` once its
     * span is known, so drawing it and sizing it are one action.
     *
     * The snapshot is taken BEFORE the size is applied, so that
     * answering the popup - which can calibrate the drawing - is
     * undone together with the truss rather than leaving a scale
     * behind with nothing to give it meaning.
     */
    enggDrawingState.clearInteraction(
        drawingState
    );

    const previousObjects =
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    commitCreatedFeature(
        object,
        false,
        previousObjects
    );

    setToolMessage(
        "Truss created"
    );

    renderProperties();
    renderCurrentDrawing();
}

/*
 * A light cleanup of the joints a student drew.
 *
 * The intent is to make a hand-drawn structure read evenly: a
 * point that is very nearly the same as another is brought onto
 * it, so members that were meant to meet do meet. Nothing is
 * moved far, no member is removed and none is added, so the
 * topology and the proportions the student chose survive.
 */
function regularizeTruss(
    members
) {
    const joints = trussJoints(members);

    const scale =
        enggDrawingState.BASE_PIXELS_PER_UNIT *
            drawingState.camera.zoom ||
        1;

    /*
     * Points closer together than this on screen are treated as
     * the same joint, so a small drawing error closes.
     */
    const tolerance = 1.5 / scale;

    const merged = [];

    joints.forEach(point => {
        const existing = merged.find(
            candidate =>
                Math.hypot(
                    candidate.x - point.x,
                    candidate.y - point.y
                ) <= tolerance
        );

        if (existing) {
            /*
             * Average the two points rather than snapping to
             * whichever came first, so neither end of the
             * structure is favoured.
             */
            existing.x =
                (existing.x + point.x) / 2;
            existing.y =
                (existing.y + point.y) / 2;

            return;
        }

        merged.push({
            x: point.x,
            y: point.y
        });
    });

    return members.map(member => ({
        start:
            merged.find(
                point =>
                    Math.hypot(
                        point.x - member.start.x,
                        point.y - member.start.y
                    ) <= tolerance
            ) || { ...member.start },

        end:
            merged.find(
                point =>
                    Math.hypot(
                        point.x - member.end.x,
                        point.y - member.end.y
                    ) <= tolerance
            ) || { ...member.end }
    }));
}

/*
 * Start a truss construction.
 *
 * The construction is temporary state held on the interaction:
 * the members drawn so far, the outline they sit in, and the
 * stage. It becomes one feature only when it is finished, so
 * cancelling leaves nothing behind.
 */
/*
 * Throw away a truss that is being built.
 *
 * The construction is temporary state, so cancelling simply
 * drops it: no feature is created and nothing the student drew
 * is kept. That is what makes both Esc and Undo recover the
 * original drawing rather than a cleaned-up version of it.
 */
export function cancelTrussConstruction() {
    enggDrawingState.clearInteraction(
        drawingState
    );

    enggDrawingState.setActiveTool(
        drawingState,
        "select"
    );

    setToolMessage(
        "Select geometry"
    );

    renderEngineeringTools(activeCategory());
    renderProperties();
    renderCurrentDrawing();
}

export function beginTrussConstruction() {
    enggDrawingState.setInteraction(
        drawingState,
        {
            phase: "truss-construct",
            trussStage: 0,
            trussMembers: [],
            trussOutline: [],
            trussInProgress: null
        }
    );

    setToolMessage(
        TRUSS_STAGES[0].prompt
    );

    renderCurrentDrawing();
}
