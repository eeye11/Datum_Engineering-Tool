/*
 * Placing distributed loads: choosing the body, the span, the magnitude and the direction.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggLoadProfile from "../model/analysis/load-profile.js";
import { openLoadValuePopup } from "../../../shared/ui/editors/load-value-popup.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { drawingState } from "../editor-state.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { distanceToSegment, isRectangleLike, objectPoints } from "../interaction/hit-testing.js";
import { cancelInteraction } from "../interaction/selection.js";
import { staticsAttachedStyle, staticsBodyAtPoint } from "./statics-attachment.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";
import { activateTool } from "../../../components/layout/toolbar/tool-activation.js";

/*
 * THE DISTRIBUTED LOAD, AS ONE CONTINUOUS FEATURE
 *
 * A distributed load is not a row of Point Forces. It is one
 * object with a body, a single direction for the whole of it,
 * and a handful of magnitude-defining points. Everything the
 * student does during construction feeds those three things,
 * and the row of arrows is the renderer sampling the result.
 *
 * The workflow is therefore:
 *
 *   1. Click a body. If the click lands on nothing, the tool
 *      falls back to the Line-style two-click span, so a load
 *      can be drawn across empty space exactly as a line can.
 *   2. Move to set the first force: its position along the body
 *      comes from where the cursor is over the body, and its
 *      magnitude and direction come from the offset of the
 *      cursor from that position. This is the ordinary Point
 *      Force interaction, so there is no dialog to open.
 *   3. Click to commit that first force. From here on the
 *      direction is fixed: moving the cursor only changes the
 *      magnitude, and the cursor's position along the body says
 *      where that magnitude applies.
 *   4. Click to add further defining points, then press Enter.
 *
 * Every one of those steps is graphical, in the same rhythm as
 * drawing a polyline.
 */

/*
 * How far a click must be from a body to count as "not on the
 * body" and so begin a span selection instead.
 */
const DISTRIBUTED_LOAD_BODY_PICK_TOLERANCE_PX = 8;

/*
 * The ends of a body, in the order a load runs along them.
 *
 * Anything the drawing supports as a body is accepted: a Line, a
 * Truss member set, a Beam, a Cable, a Shaft, a rigid body, or
 * any other geometry with a span. Nothing here restricts the
 * load to lines, because a load acts on whatever is loaded.
 */
function distributedLoadBodySpan(
    body
) {
    if (!body) {
        return null;
    }

    const geometry = body.geometry;

    if (!geometry) {
        return null;
    }

    /*
     * A Truss the student built is a set of members. Loading a
     * truss means loading one of its members, so the member the
     * cursor is on is the body.
     */
    if (
        Array.isArray(geometry.members) &&
        geometry.members.length
    ) {
        return {
            start: geometry.members[0].start,
            end: geometry.members[0].end,
            body: null
        };
    }

    if (
        geometry.start &&
        geometry.end &&
        Number.isFinite(geometry.start.x) &&
        Number.isFinite(geometry.end.x)
    ) {
        return {
            start: geometry.start,
            end: geometry.end,
            body: null
        };
    }

    /*
     * A rigid body has no span, so the chord across it is used:
     * a load laid across the diagonal of a body is the one
     * region a point on the body always identifies.
     */
    if (isRectangleLike(body)) {
        const corners =
            objectPoints(body);

        if (corners.length >= 2) {
            return {
                start: corners[0],
                end: corners[corners.length - 1],
                body: null
            };
        }
    }

    if (geometry.position) {
        return {
            start: geometry.position,
            end: geometry.position,
            body: null
        };
    }

    return null;
}

/*
 * The member of a Truss that a point lies on, so a load placed
 * on a truss follows the member it was drawn on rather than an
 * arbitrary one.
 */
function distributedLoadTrussMemberAt(
    point
) {
    const tolerance =
        DISTRIBUTED_LOAD_BODY_PICK_TOLERANCE_PX /
        Math.max(
            enggDrawingState
                .BASE_PIXELS_PER_UNIT *
                (drawingState.camera.zoom || 1),
            1e-6
        );

    for (const object of drawingState.objects) {
        if (
            object.type !== "truss" ||
            !Array.isArray(object.geometry?.members)
        ) {
            continue;
        }

        const member =
            object.geometry.members.find(
                candidate =>
                    distanceToSegment(
                        point,
                        candidate.start,
                        candidate.end
                    ) <= tolerance
            );

        if (member) {
            return { object, member };
        }
    }

    return null;
}

/*
 * The geometry a distributed load can be applied to.
 *
 * A load acts on whatever is loaded, so the eligible bodies are
 * not only the dedicated Statics ones. Anything the drawing
 * supports as a body is accepted: a Line, a Truss member, a
 * Beam, a Cable, a Shaft, a rigid body, or any other geometry
 * with a span. Restricting a load to lines would rule out most
 * of the structures a load is actually drawn on.
 */
function distributedLoadSpanBodyAt(
    point
) {
    const tolerance =
        DISTRIBUTED_LOAD_BODY_PICK_TOLERANCE_PX /
        Math.max(
            enggDrawingState
                .BASE_PIXELS_PER_UNIT *
                (drawingState.camera.zoom || 1),
            1e-6
        );

    /*
     * The bodies are searched newest first, so a load attaches to
     * the most recently drawn one when two overlap, which is what
     * a click on the topmost feature would do.
     */
    for (
        let index = drawingState.objects.length - 1;
        index >= 0;
        index -= 1
    ) {
        const object =
            drawingState.objects[index];

        const span =
            distributedLoadBodySpan(object);

        if (!span) {
            continue;
        }

        if (
            distanceToSegment(
                point,
                span.start,
                span.end
            ) <= tolerance
        ) {
            return object;
        }
    }

    return null;
}

/*
 * Whether the active tool is the VARYING distributed load, which
 * is the one built from a profile of magnitude points. The plain
 * Distributed Load is the constant one.
 *
 * The two are told apart by the active tool rather than by two
 * separate copies of the construction, so the body selection,
 * the span fallback and the snapping they share stay genuinely
 * shared.
 *
 * A tool id may be passed to ask about that tool specifically.
 * The click router needs to recognise the varying load by id,
 * because a tool that is not a construction tool must still be
 * admitted through this one check; leaving it to read the active
 * tool there would make the answer depend on what happened to be
 * selected rather than on the tool being tested.
 */
export function isVaryingLoadTool(toolId) {
    const id =
        toolId === undefined
            ? drawingState.activeTool
            : toolId;

    return id === "varying-distributed-load";
}

/*
 * The interaction phases in which a load is being defined, split
 * into the two stages the tools share.
 *
 * Both stages need to know what "square" means for the tool, so
 * the recognition is named once here rather than spelled out at
 * each call site: the span stage traces the loaded region, and
 * the build stage draws the forces that act on it.
 */
export function isLoadSpanPhase(interaction) {
    return (
        interaction?.phase ===
            "distributed-load-span"
    );
}

export function isLoadBuildPhase(interaction) {
    /*
     * The varying load's own phase, in which each click adds a
     * magnitude-defining point and Enter finishes. It is not one of the
     * uniform load's steps (LOAD_BUILD_PHASES), but it is a load being
     * built: pointer snapping, the preview and Enter-to-finish all apply.
     */
    if (interaction?.phase === "distributed-load-build") {
        return true;
    }

    return (
        LOAD_BUILD_PHASES.has(
            interaction?.phase
        )
    );
}

/*
 * Begin a distributed load.
 *
 * Both load tools start the same way, because both load a BODY
 * first:
 *
 *   - a click on an existing body loads that body;
 *   - a click in empty space has no body to act on, so the tool
 *     falls back to the Line-style two-click span, using exactly
 *     the snapping and inference a Line uses.
 *
 * They diverge from there. A Varying Distributed Load is built up
 * from a sequence of magnitude points; a Distributed Load is a
 * single magnitude across the whole span, so it finishes as soon
 * as that magnitude is given.
 */
export function beginDistributedLoadConstruction(
    resolution
) {
    const point =
        resolution.effectiveConstructionPoint;

    if (!point) {
        return;
    }

    const trussHit =
        distributedLoadTrussMemberAt(
            point
        );

    if (trussHit) {
        startDistributedLoadBuild({
            start: trussHit.member.start,
            end: trussHit.member.end,
            parentId: trussHit.object.id
        });

        return;
    }

    const body =
        staticsBodyAtPoint(point) ||
        distributedLoadSpanBodyAt(point);

    const span =
        distributedLoadBodySpan(body);

    if (span) {
        /*
         * ========================================================
         * SELECTING A BODY IS ONE DECISION, NOT FOUR
         * ========================================================
         *
         * This handed the body's own endpoints to the constant load as its
         * START and END, so the moment a member was clicked it acquired a
         * load across its entire length - before the student had been asked
         * where the load acts, how strong it is, or which way it pushes.
         *
         * The body is all this click decides. The constant load takes only
         * the body's id and asks for the region next.
         *
         * The VARYING load keeps its old behaviour here, because building a
         * profile genuinely does start from the span the student traced -
         * that is what tracing it means.
         */
        if (isVaryingLoadTool()) {
            startDistributedLoadBuild(
                span,
                body?.id
            );
        } else {
            startConstantLoadBuild(
                body?.id
            );
        }

        return;
    }

    /*
     * Nothing under the cursor, so there is no body to load. The
     * two-click span takes over, anchored here, and the load's
     * body is the region the student traces.
     */
    enggDrawingState.setInteraction(
        drawingState,
        {
            ...resolution,

            phase:
                "distributed-load-span",

            startPoint: point,

            currentPoint: point,

            points: [point],

            parentId: undefined
        }
    );

    setToolMessage(
        "Click the end of the loaded span, or drag to it and release"
    );

    renderCurrentDrawing();
}

/*
 * Move from choosing the body into drawing the load on it.
 */
/*
 * ========================================================
 * THE PHASES OF A DISTRIBUTED LOAD
 * ========================================================
 *
 * One set, used by the click handler and by the status line, so the step the
 * tool THINKS it is on and the step it is DISPLAYED as cannot come apart.
 *
 * THREE STEPS, NOT FOUR.
 *
 * Selecting the body, then the two ends of the loaded region, then ONE drag
 * that fixes the magnitude AND the direction together. There is no separate
 * magnitude step and no direction step, because the two are one decision: the
 * same cursor vector is both how hard the load pushes and which way it
 * pushes, so splitting them into two states is what made the direction come
 * out as a default rather than as the vector the student drew.
 */
export const LOAD_BUILD_PHASES = new Set([
    "distributed-load-start",
    "distributed-load-end",
    "distributed-load-vector",
]);

/*
 * WHAT EACH STEP SAYS IT IS WAITING FOR.
 *
 * One line per phase, in one place, so the instruction cannot describe a
 * different step from the one the tool is actually in - which is how a tool
 * ends up asking for a direction while it is waiting for a point.
 */
const LOAD_BUILD_INSTRUCTIONS = {
    "distributed-load-start":
        "Specify start point",
    "distributed-load-end":
        "Click the end of the loaded span, or drag along the body and release",
    "distributed-load-vector":
        "Click to place the load",
};

export function loadBuildInstruction(
    phase
) {
    return (
        LOAD_BUILD_INSTRUCTIONS[phase] ||
        "Specify start point"
    );
}

/*
 * ========================================================
 * THE FIXED REFERENCE POINT FOR THE DIRECTION
 * ========================================================
 *
 * The origin the direction vector is measured from, in world space. It is
 * the midpoint of the loaded region, captured ONCE when the region is
 * finished and stored on the interaction.
 *
 * IT IS STORED, NOT RECOMPUTED. Once the magnitude/direction stage begins,
 * the reference point must not move while the cursor does. Computing it
 * fresh from `loadStart`/`loadEnd` on every pointer move happens to give the
 * same answer today, but it makes the origin a function of the span state -
 * so anything that touched the span during the vector stage would silently
 * slide the origin and rotate the load. Storing it once removes that whole
 * class of bug: there is one value, established when the span was frozen,
 * and nothing in this stage can change it.
 *
 * The midpoint is still the fallback for a state that has a span but no
 * captured reference - a load half-built by an older flow - so nothing that
 * reached this stage without one is left without an origin.
 */
export function distributedLoadRegionMidpoint() {
    const stored =
        drawingState.interaction
            .loadReferencePoint;

    if (
        stored &&
        Number.isFinite(stored.x) &&
        Number.isFinite(stored.y)
    ) {
        return {
            x: stored.x,
            y: stored.y
        };
    }

    const start =
        drawingState.interaction
            .loadStart;

    const end =
        drawingState.interaction
            .loadEnd;

    if (!start || !end) {
        return null;
    }

    return {
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2,
    };
}

/*
 * IS THIS POINT ON THE BODY THE LOAD IS ALREADY ATTACHED TO?
 *
 * The second click has to be on the same member as the first. A click on a
 * different one is a different load, and switching silently would leave a
 * load on the body the student thought they had abandoned.
 */
export function distributedLoadPointOnBody(
    point
) {
    const sourceId =
        drawingState.interaction
            .loadSourceId;

    if (!sourceId) {
        /*
         * With no body - the load was drawn in empty space rather than
         * attached - anywhere on the sheet is acceptable, because there is
         * no second member to land on.
         */
        return true;
    }

    const body =
        drawingState.objects.find(
            candidate =>
                candidate.id === sourceId
        );

    if (!body) {
        return true;
    }

    const start =
        body.geometry?.start;
    const end =
        body.geometry?.end;

    if (
        !start ||
        !end
    ) {
        return false;
    }

    return (
        enggLoadProfile.fractionAlong(
            { start, end },
            point
        ) >= -0.001 &&
        enggLoadProfile.fractionAlong(
            { start, end },
            point
        ) <= 1.001
    );
}

/*
 * ========================================================
 * THE DIRECTION, FROM ONE FIXED ORIGIN TO THE ACTUAL CURSOR
 * ========================================================
 *
 * World-space, from the pointer's direction about the midpoint of the
 * selected region - the same origin the commit uses, so what is previewed
 * and what is stored are the same reading of the same pointer. A click on
 * the origin aims nowhere and reports nothing rather than a zero vector.
 *
 * THE ORIGIN IS THE FIXED MIDPOINT AND NEVER MOVES while the cursor does.
 * That is what makes the direction the student's own choice: moving along
 * the span cannot slide the origin, so it cannot rotate the load except by
 * moving the cursor relative to that one fixed point.
 *
 * THE CURSOR IS PASSED IN, and it must be the ACTUAL pointer - the raw or
 * inference-constrained one - never the snapped construction point. This
 * used to read `interaction.effectiveConstructionPoint`, which is snapped:
 * near a span end it becomes that end exactly, so the vector jumped to the
 * midpoint-to-endpoint diagonal and the load rotated as the cursor crossed
 * the span. The cursor must never become the origin of its own direction
 * calculation, and the origin must never move along the span.
 */
export function loadDirectionUnderPointer(
    cursor
) {
    if (
        drawingState.interaction.phase !==
            "distributed-load-vector"
    ) {
        return null;
    }

    const origin =
        distributedLoadRegionMidpoint();

    if (!origin || !cursor) {
        return null;
    }

    const dx = cursor.x - origin.x;
    const dy = cursor.y - origin.y;

    const length = Math.hypot(dx, dy);

    if (length < 1e-6) {
        return null;
    }

    /*
     * DEGREES, the one representation the load model stores and the renderer
     * reads. `unitVector` cleans the axis components for the drawing, but the
     * ANGLE is what the feature keeps, so the preview and the committed load
     * are the same reading of the same pointer - which is what makes the
     * preview honest.
     */
    return {
        dx: dx / length,
        dy: dy / length,
        degrees:
            Math.atan2(dy, dx) * 180 / Math.PI,
    };
}

/*
 * ========================================================
 * THE ONE CURSOR VECTOR: MAGNITUDE AND DIRECTION TOGETHER
 * ========================================================
 *
 * A Distributed Load has ONE uniform magnitude across its loaded span, and
 * one direction shared by every arrow. Both are decided by a single drag, and
 * this is the reading of that drag.
 *
 * The vector runs from the MIDPOINT of the loaded region to the cursor - the
 * reference point the specification names. Its length is the magnitude and
 * its angle is the direction, so pulling further away makes the load heavier
 * and pointing the other way turns every arrow.
 *
 * WORLD SPACE, NOT SCREEN SPACE. The cursor arrives already converted through
 * the drawing's own world-to-screen transform, so the reading survives zoom,
 * pan and resize. The magnitude is an engineering value in the flow beyond
 * the scale, and never a pixel distance.
 *
 * THE ORIGIN IS FIXED AND THE CURSOR IS PASSED IN. Both are the same reading
 * the preview and the commit use, so the two cannot disagree. The caller
 * supplies the RAW (or inference-constrained) pointer, never the snapped
 * construction point: a snapped endpoint would make the vector swing to a
 * fixed diagonal as the cursor neared an end of the span, which is the
 * direction rotating under the student for no reason they asked for.
 */
function loadVectorUnderPointer(
    cursor
) {
    const origin =
        distributedLoadRegionMidpoint();

    if (!origin || !cursor) {
        return null;
    }

    const dx = cursor.x - origin.x;
    const dy = cursor.y - origin.y;

    const length = Math.hypot(dx, dy);

    if (length < 1e-9) {
        return null;
    }

    return {
        magnitude: length,
        degrees:
            Math.atan2(dy, dx) * 180 / Math.PI,
    };
}

export function startDistributedLoadBuild(
    span,
    parentId
) {
    enggDrawingState.clearInteraction(
        drawingState
    );

    enggDrawingState.setInteraction(
        drawingState,
        {
            phase:
                "distributed-load-build",

            distributedLoadStart: {
                ...span.start
            },

            distributedLoadEnd: {
                ...span.end
            },

            distributedLoadDirection: null,

            distributedLoadPoints: [],

            distributedLoadHasProfile: false,

            parentId
        }
    );

    setToolMessage(
        "Click to place the first load point"
    );

    renderProperties();
    renderCurrentDrawing();
}

/*
 * ========================================================
 * THE SPAN'S OWN AXIS AND ITS PERPENDICULAR
 * ========================================================
 *
 * The varying load's DEFAULT direction is square-on to the loaded span,
 * and both the axis and its perpendicular are derived HERE, ONCE, from the
 * span itself.
 *
 * THE AXIS IS THE SPAN'S ESTABLISHED DIRECTION - from its start to its end,
 * the same fact the member is drawn with. The perpendicular is taken from
 * that axis, so a load on an angled member is square to THAT member rather
 * than to the world axes: the span says which way the member runs, and the
 * square-on direction follows from it.
 *
 * WHICH SIDE THE PERPENDICULAR POINTS. There are two normals to a line, and
 * the load has to pick one. It picks the side the CURSOR is on, so the
 * magnitude - which is the cursor's offset measured ALONG the direction -
 * comes out positive and the arrows grow as the student pulls away. The
 * sense is a consequence of where the pointer is, not a rule of its own, and
 * once the direction is COMMITTED it is frozen for the whole load.
 */
function spanAxis(
    interaction
) {
    const start =
        interaction?.distributedLoadStart;

    const end =
        interaction?.distributedLoadEnd;

    if (!start || !end) {
        return null;
    }

    const dx = end.x - start.x;
    const dy = end.y - start.y;

    const length = Math.hypot(dx, dy);

    if (length < 1e-9) {
        return null;
    }

    return {
        x: dx / length,
        y: dy / length
    };
}

/*
 * The span's perpendicular direction, as a unit vector and in degrees.
 *
 * The sense is chosen from the cursor's side of the span axis, so the
 * returned direction is the one the cursor is on. A cursor sitting exactly
 * on the axis leaves the choice open, and the first normal is used - which
 * is the drawing's own convention and is then frozen once committed.
 */
function spanPerpendicularDirection(
    interaction,
    cursor
) {
    const axis =
        spanAxis(interaction);

    if (!axis) {
        return null;
    }

    const start =
        interaction.distributedLoadStart;

    /*
     * A normal to the axis. The two candidates are +/- this vector.
     */
    let nx = -axis.y;
    let ny = axis.x;

    if (cursor) {
        const side =
            (cursor.x - start.x) * nx +
            (cursor.y - start.y) * ny;

        if (side < 0) {
            nx = -nx;
            ny = -ny;
        }
    }

    return {
        x: nx,
        y: ny,
        degrees:
            Math.atan2(ny, nx) *
            180 /
            Math.PI
    };
}

/*
 * How far along the span a point lies, UNCLAMPED.
 *
 * `fractionAlong` clamps its answer to the span, which is right for placing
 * a point ON a member - the point is always on the member. This question is
 * different: it asks whether the cursor is WITHIN the span or OUTSIDE it,
 * and clamping would erase exactly the distinction being asked about. A
 * value below 0 is beyond the span's start, above 1 is beyond its end, and
 * in between is on the span.
 */
function fractionAlongUnclamped(
    interaction,
    point
) {
    const start =
        interaction?.distributedLoadStart;

    const end =
        interaction?.distributedLoadEnd;

    if (!start || !end || !point) {
        return 0;
    }

    const dx = end.x - start.x;
    const dy = end.y - start.y;

    const lengthSquared =
        dx * dx + dy * dy;

    if (lengthSquared < 1e-12) {
        return 0;
    }

    return (
        ((point.x - start.x) * dx +
            (point.y - start.y) * dy) /
        lengthSquared
    );
}

/*
 * ========================================================
 * THE DIRECTION, FROM THE CURSOR AND THE SPAN'S BOUNDS
 * ========================================================
 *
 * The different direction can only be introduced DELIBERATELY, by taking
 * the cursor past one of the span's own ends. A cursor anywhere WITHIN the
 * span - however far off the member it is dragged - gives the perpendicular
 * direction and nothing else, so the magnitude can be chosen by pulling
 * away without the load spinning under the student as they do it.
 *
 *   WITHIN THE SPAN (0 <= t <= 1)  ->  perpendicular to the span axis
 *   BEYOND THE START (t < 0)       ->  the direction from the start to the
 *                                      cursor, which is the LEFT side
 *   BEYOND THE END (t > 1)         ->  the direction from the end to the
 *                                      cursor, which is the RIGHT side
 *
 * THE BOUNDS ARE THE SPAN'S OWN ENDS. There is no second, invented distance
 * threshold: the loaded region is the span, its ends are where it stops, and
 * a cursor past one of them has left the region and is asking for something
 * the perpendicular cannot express.
 *
 * The vector is measured FROM THE NEAREST END, not from the midpoint. The
 * end is the pivot the cursor has just gone past, and the direction it
 * describes is what the student is pointing at from that pivot.
 */
function distributedLoadDirectionUnderPointer(
    interaction,
    cursor
) {
    const perpendicular =
        spanPerpendicularDirection(
            interaction,
            cursor
        );

    if (!interaction || !cursor) {
        return null;
    }

    const t =
        fractionAlongUnclamped(
            interaction,
            cursor
        );

    /*
     * WITHIN THE SPAN: the default, and it does not rotate.
     */
    if (t >= 0 && t <= 1) {
        return perpendicular
            ? perpendicular.degrees
            : null;
    }

    /*
     * BEYOND AN END: the direction the cursor describes about that end.
     */
    const pivot =
        t < 0
            ? interaction.distributedLoadStart
            : interaction.distributedLoadEnd;

    const dx = cursor.x - pivot.x;
    const dy = cursor.y - pivot.y;

    if (Math.hypot(dx, dy) < 1e-6) {
        return perpendicular
            ? perpendicular.degrees
            : null;
    }

    return (
        Math.atan2(dy, dx) *
        180 /
        Math.PI
    );
}

/*
 * ========================================================
 * THE DIRECTION IS THE FIRST POINT'S, AND IT IS SQUARE-ON BY DEFAULT
 * ========================================================
 *
 * A Varying Distributed Load has ONE direction, shared by every arrow it
 * draws. That direction is established when the FIRST profile point is
 * placed, and from then on every later point contributes a MAGNITUDE only.
 *
 * The default is PERPENDICULAR TO THE LOADED SPAN, and the cursor stays on
 * that default for its whole journey along the span. A different direction
 * is a DELIBERATE act: the cursor must be taken past one of the span's own
 * ends, and only then does it describe a direction of its own - the left
 * side from the start, the right side from the end. See
 * `distributedLoadDirectionUnderPointer` for the whole rule.
 *
 * IT IS NEVER RE-DERIVED PER POINT. Every arrow of the load reads the one
 * stored direction; none of them is turned by where its own cursor happened
 * to be, so the arrows stay parallel however the profile varies.
 */

/*
 * The distributed load the interaction currently describes.
 *
 * `cursor` is the resolved construction point (possibly snapped), used for
 * the load's STATIONS along the span. `directionCursor` is the point the
 * DIRECTION is read from, which is the raw or inference-constrained cursor
 * and never a snapped endpoint - see the note above. When it is omitted the
 * two are the same point, which keeps every existing caller working.
 *
 * It is built fresh from the interaction on every preview and
 * every commit, so the construction state and the stored
 * feature can never describe different loads.
 */
export function distributedLoadDraft(
    interaction,
    cursor,
    directionCursor = cursor
) {
    const start =
        interaction?.distributedLoadStart;

    const end =
        interaction?.distributedLoadEnd;

    if (!start || !end) {
        return null;
    }

    const points = [
        ...(interaction
            .distributedLoadPoints ||
            [])
    ];

    let direction =
        interaction
            .distributedLoadDirection;

    /*
     * ONCE CHOSEN, THE DIRECTION IS THE SAME FOR EVERY POINT. The first
     * magnitude selection fixes it; every later point only says how big it
     * is. So a stored direction is used as-is and never re-read from the
     * cursor.
     */
    const hasStoredDirection =
        direction !== null &&
        direction !== undefined;

    /*
     * FIRST MAGNITUDE SELECTION: THE CURSOR VECTOR SETS THE DIRECTION.
     *
     * It is read from `directionCursor`, which the caller supplies as the
     * raw or inference-constrained cursor - NOT the snapped construction
     * point. Any angle at all is legal, so the load is never forced square
     * to the span, along it, or into the direction of an endpoint the
     * cursor happened to be near.
     */
    if (
        !hasStoredDirection &&
        directionCursor
    ) {
        direction =
            distributedLoadDirectionUnderPointer(
                interaction,
                directionCursor
            );
    }

    /*
     * Whether a usable direction exists. A cursor sitting on the reference
     * point aims nowhere, so it reports no direction rather than inventing
     * one - and the build refuses to commit the first point until the
     * student drags away from the reference.
     */
    const directionChosen =
        direction !== null &&
        direction !== undefined;

    const resolved =
        direction === null ||
        direction === undefined
            ? enggLoadProfile
                  .DEFAULT_LOAD_DIRECTION
            : direction;

    const vector =
        enggLoadProfile.unitVector(
            resolved
        );

    /*
     * Once the direction is established, the magnitude at a
     * point is the cursor's offset MEASURED ALONG that
     * direction. Measuring along the force rather than radially
     * is what makes the arrows grow as the cursor is pulled
     * further out along the load, and it keeps the student
     * working in the one direction they chose at the start.
     */
    const magnitudeAt = point => {
        if (!cursor) {
            return 0;
        }

        const base =
            enggLoadProfile.pointAlong(
                { start, end },
                point
            );

        const dx = cursor.x - base.x;
        const dy = cursor.y - base.y;

        return Math.max(
            0,
            dx * vector.x + dy * vector.y
        );
    };

    /*
     * The live point follows the cursor along the body, so the
     * student sees the shape of the load growing as they move
     * before committing to it.
     */
    if (cursor) {
        const t =
            enggLoadProfile.fractionAlong(
                { start, end },
                cursor
            );

        const magnitude =
            magnitudeAt(t);

        const existing =
            points.findIndex(
                point =>
                    Math.abs(point.t - t) < 1e-6
            );

        if (existing >= 0) {
            points[existing] = {
                t,
                magnitude
            };
        } else {
            points.push({
                t,
                magnitude
            });
        }
    }

    const draft = {
        start,
        end,
        direction: resolved,

        /*
         * Whether a direction was CHOSEN - by aiming at an end of the
         * span, or because one was already chosen and stored. A
         * perpendicular set away from the ends is a real direction the
         * load is built with, but it is not an AIMED choice, and this
         * distinguishes the two so the build can say which it has.
         */
        directionChosen,

        points
    };

    return draft;
}

/*
 * The world positions of a load's distribution points, for the
 * shared snap system.
 *
 * A VARYING DISTRIBUTED LOAD is defined by placing forces one at
 * a time, and each one is a real, visible arrow at a real place
 * on the body. So the point the student has already placed is
 * something they will naturally want to line the NEXT one up
 * against - two forces at the same height read as "the same
 * magnitude", and getting there by eye is what the cursor is for.
 *
 * The profile stores each point as a FRACTION along the body
 * plus a magnitude, because that is what makes the profile
 * independent of the body's own geometry. Turning those back
 * into world positions is what the snap system needs, and doing
 * it here rather than storing world coordinates keeps the two
 * from ever disagreeing: a body that moved carries its profile
 * with it, and the published points move with it.
 *
 * Each is published as a zero-length segment, so the existing
 * system treats them as the points they are - endpoints to snap
 * to, and alignment references - with no new snap type and no
 * special case for loads.
 *
 * EACH FORCE PUBLISHES ITS TAIL AND ITS TIP. The tail lets the next point
 * sit at the same STATION along the span; the tip lets it sit at the same
 * HEIGHT, so a repeat of a magnitude is a snap rather than an estimate.
 */
function distributedLoadSnapGeometry(
    interaction
) {
    const start =
        interaction
            ?.distributedLoadStart;
    const end =
        interaction
            ?.distributedLoadEnd;

    if (!start || !end) {
        return [];
    }

    const direction =
        enggLoadProfile.unitVector(
            interaction
                ?.distributedLoadDirection ??
                null
        );

    const hasDirection =
        interaction
            ?.distributedLoadDirection !==
            null &&
        interaction
            ?.distributedLoadDirection !==
            undefined;

    /*
     * The direction the arrows of this load are drawn in. A point exists
     * only after the first magnitude selection, and that selection is what
     * establishes the direction, so there is always one to read here. The
     * default is kept only so a half-built state cannot throw.
     */
    const shown =
        enggLoadProfile.unitVector(
            hasDirection
                ? direction.angle
                : enggLoadProfile
                      .DEFAULT_LOAD_DIRECTION
        );

    return (
        interaction
            .distributedLoadPoints ||
        []
    ).flatMap(point => {
        const along =
            enggLoadProfile.pointAlong(
                { start, end },
                point.t
            );

        if (!along) {
            return [];
        }

        /*
         * THE FORCE'S TAIL, AND ITS TIP.
         *
         * The tail is the point on the body where the load acts, and it
         * is what a later point aligns with to sit at the same STATION
         * along the span.
         *
         * The tip is the head of the arrow - the tail moved out along
         * the load's direction by the point's magnitude. Publishing it is
         * what lets the next point be placed at the SAME HEIGHT as an
         * earlier force: the student drags until the cursor snaps to the
         * tip and the two arrows are the same length. Without it the only
         * way to repeat a magnitude is by eye, and a force placed a pixel
         * short reads as a different value.
         *
         * Both are published as zero-length segments, so the existing
         * snap system treats them as the points they are - endpoints to
         * snap to and alignment references - with no new snap type.
         */
        const tip =
            point.magnitude > 0
                ? {
                      x:
                          along.x +
                          shown.x *
                              point.magnitude,
                      y:
                          along.y +
                          shown.y *
                              point.magnitude
                  }
                : null;

        return [
            { start: along, end: along },
            ...(tip
                ? [{ start: tip, end: tip }]
                : [])
        ];
    });
}

/*
 * ========================================================
 * THE POINT THE DIRECTION IS READ FROM
 * ========================================================
 *
 * This is the cursor for the direction vector, and it is deliberately NOT
 * the resolved construction point.
 *
 * The construction point is SNAPPED: near a member it becomes a point on
 * the member, and near a span end it becomes that end exactly. Reading the
 * direction from it therefore turned a cursor aimed towards an end of the
 * span into "the span endpoint", and the vector from the midpoint to the
 * endpoint is a fixed diagonal - which is the strange angle the student saw
 * no matter how they moved the pointer.
 *
 * So the raw cursor is used instead: whatever the pointer is actually over,
 * before any body, endpoint or grid snap moves it.
 *
 * THE ONE EXCEPTION IS THE HORIZONTAL / VERTICAL INFERENCE. That is not a
 * snap - it is the student saying "make this level" or "make this plumb" by
 * bringing the cursor close to level or plumb, and the guide they can see
 * is the constraint they mean. So when the shared resolver reports an
 * inference, ITS point is used, and the direction squares to that axis.
 *
 * WHERE THERE IS NO RAW POINT the resolved point is the best available
 * answer, so a caller that has only one point still works.
 */
export function distributedLoadDirectionCursor(
    resolution
) {
    if (!resolution) {
        return null;
    }

    if (resolution.inference?.point) {
        return {
            ...resolution.inference.point
        };
    }

    return (
        resolution.rawPointerPoint ||
        resolution.effectiveConstructionPoint ||
        null
    );
}

/*
 * Commit one point of the load's magnitude profile.
 */
export function continueDistributedLoadBuild(
    resolution
) {
    const point =
        resolution.effectiveConstructionPoint;

    if (!point) {
        return;
    }

    const interaction =
        drawingState.interaction;

    /*
     * The STATION comes from the resolved point; the DIRECTION comes from
     * the raw cursor. See `distributedLoadDirectionCursor` for why the two
     * are deliberately different.
     */
    const draft =
        distributedLoadDraft(
            interaction,
            point,
            distributedLoadDirectionCursor(
                resolution
            )
        );

    if (!draft) {
        return;
    }

    /*
     * THE FIRST POINT NEEDS A DIRECTION; WITHOUT ONE THERE IS NO LOAD.
     *
     * A load with no usable direction would have to invent one, and an
     * invented direction is stored as though the student had chosen it.
     * The only way to have none now is a degenerate span - a zero-length
     * loaded region - because within the span the perpendicular direction
     * is always available and past an end the cursor's own vector is.
     *
     * So this refuses only what genuinely cannot be read, and it stops
     * firing entirely once a direction is stored: every later point is
     * magnitude only.
     */
    if (
        !draft.directionChosen &&
        !interaction.distributedLoadDirection
    ) {
        setToolMessage(
            "Move away from the load to set its magnitude, then click"
        );

        return;
    }

    /*
     * ========================================================
     * THE POINT'S MAGNITUDE IS ASKED FOR, PER POINT
     * ========================================================
     *
     * Placing a profile point fixes WHERE it acts; its magnitude is a
     * physical value, so it is asked for rather than guessed from a cursor
     * distance. The cursor's offset along the load's direction is offered as
     * the SUGGESTION, so a student who is happy with the size they dragged
     * presses Enter, and one who wants a round number types it.
     *
     * The point is NOT committed until the popup is confirmed. Cancelling
     * removes it, so a profile never gains a point whose value nobody gave -
     * which is the state the old flow could reach by clicking quickly.
     */
    const station =
        draft.points.length
            ? draft.points[draft.points.length - 1]
            : null;

    const suggested =
        station && Number.isFinite(station.magnitude)
            ? station.magnitude
            : 0;

    openLoadValuePopup({
        title: "Varying Load Point",
        label: `Point ${draft.points.length} Magnitude`,
        value: Number(suggested).toFixed(2),
        unit: loadUnitOfInteraction(interaction),

        /*
         * THE BOTTOM BAR SAYS WHAT THE OPEN POPUP IS ASKING FOR. The current
         * step belongs in one place, and while the value is being entered that
         * step is the entry itself.
         */
        onOpen: () => {
            setToolMessage(
                "Enter the magnitude for this load point"
            );
        },

        onConfirm: confirmed => {
            commitDistributedLoadPoint({
                resolution,
                point,
                draft,
                interaction,
                magnitude: confirmed.value,
                unit: confirmed.unit
            });
        },

        onCancel: () => {
            setToolMessage(
                "Point cancelled - click to add another point, Enter to finish"
            );

            renderCurrentDrawing();
        }
    });
}

/*
 * The unit a varying load's points are stated in.
 *
 * ONE UNIT FOR THE WHOLE PROFILE: it is read from the interaction when a
 * direction or a unit was already chosen, and defaults to the drawing's own
 * unit until the first point is confirmed - at which point it is written
 * onto the interaction so every later point offers the same one.
 */
function loadUnitOfInteraction(interaction) {
    const chosen =
        interaction?.loadUnit ??
        interaction?.distributedLoadUnit;

    return enggLoadProfile.loadUnit({
        loadUnit: chosen
    });
}

/*
 * Commit one point of the load's magnitude profile, with the value the
 * student entered.
 *
 * The STATION comes from the resolved point - where the click landed - and
 * the MAGNITUDE is the number from the popup rather than the cursor's
 * offset, so the two are separate decisions that cannot overwrite each
 * other. The point's direction is never stored: the load has ONE direction,
 * established by its first point, and every later point inherits it.
 */
function commitDistributedLoadPoint({
    resolution,
    point,
    draft,
    interaction,
    magnitude,
    unit
}) {
    const t =
        enggLoadProfile.fractionAlong(
            {
                start: draft.start,
                end: draft.end
            },
            point
        );

    const points = [
        ...(interaction.distributedLoadPoints || [])
    ];

    const existing =
        points.findIndex(
            existingPoint =>
                Math.abs(existingPoint.t - t) < 1e-6
        );

    const entry = {
        t,
        magnitude: Math.max(0, Number(magnitude) || 0)
    };

    if (existing >= 0) {
        points[existing] = entry;
    } else {
        points.push(entry);
    }

    const hasProfile = points.length > 0;

    enggDrawingState.setInteraction(
        drawingState,
        {
            ...resolution,

            phase: "distributed-load-build",

            distributedLoadStart: {
                ...draft.start
            },

            distributedLoadEnd: {
                ...draft.end
            },

            /*
             * THE DIRECTION THE FIRST POINT ESTABLISHED, kept once and never
             * re-read - every later point is magnitude only.
             */
            distributedLoadDirection:
                interaction.distributedLoadDirection ??
                (draft.directionChosen
                    ? draft.direction
                    : null),

            /*
             * THE ONE UNIT FOR THE WHOLE PROFILE, SET BY THE FIRST POINT.
             *
             * The first confirmed point establishes the feature's unit from
             * what the student typed. Every later point then KEEPS that unit:
             * a profile is one quantity measured along one axis, so its points
             * cannot be stated in different units - "1 kN/m, 3 N/mm, 6 kN/m"
             * describes nothing. So once a unit is recorded it is read back
             * unchanged, and a later point only supplies a magnitude.
             */
            distributedLoadUnit:
                interaction.distributedLoadUnit ??
                unit,

            distributedLoadPoints: points,

            distributedLoadHasProfile: hasProfile,

            snapGeometry: distributedLoadSnapGeometry({
                distributedLoadStart: draft.start,
                distributedLoadEnd: draft.end,
                distributedLoadPoints: points
            }),

            parentId: interaction.parentId
        }
    );

    setToolMessage(
        "Click to place the next load point, Enter to finish"
    );

    renderProperties();
    renderCurrentDrawing();
}

/*
 * A DISTRIBUTED LOAD WITH A CONSTANT MAGNITUDE
 *
 * A Distributed Load is the simple one: one body, one
 * magnitude, one direction, spread evenly across the whole
 * selected span. There is no profile to trace and no sequence of
 * points to place. It is defined by a single force drawn off the
 * body, and everything else follows from that.
 *
 * The magnitude and the direction both come from where the
 * cursor is. The point on the body under the cursor is where the
 * magnitude is read from, and the offset from that point to the
 * cursor is the force vector itself, so it is exactly the
 * click-move-click construction a Point Force already uses and
 * there is no dialog anywhere in it.
 *
 * The offset is measured along the load's own direction and is
 * never clamped, so pulling the cursor further out genuinely
 * makes the load heavier and the drawn arrows longer.
 */
function startConstantLoadBuild(
    parentId
) {
    /*
     * ========================================================
     * STEP 1 OF 5: THE BODY, AND NOTHING ELSE
     * ========================================================
     *
     * This used to be handed the body's own start and end and store them as
     * the load's, which is why selecting a beam immediately produced a load
     * across its entire length: the span had been decided before the student
     * had been asked anything.
     *
     * Selecting a body is ONE decision - "this load acts on that member" -
     * and it establishes one thing. The region comes next, from two more
     * clicks, because where a load acts and how much of the member it acts
     * on are different questions and a student will rarely want the answer
     * to the second to be the whole member.
     */
    enggDrawingState.setInteraction(
        drawingState,
        {
            phase:
                "distributed-load-start",

            loadSourceId:
                parentId,

            /*
             * Null, not the body's endpoints. The loaded region does not
             * exist until the student puts it on the sheet.
             */
            loadStart: null,
            loadEnd: null,
            loadDirection: null,
            loadMagnitude: 0
        }
    );

    setToolMessage(
        "Click the start of the loaded span, or drag along the body and release"
    );

    renderProperties();
    renderCurrentDrawing();
}

/*
 * ========================================================
 * THE REST OF THE CONSTRUCTION
 * ========================================================
 *
 * One function per step, so each is a single thing and the phase change
 * carries the student forward rather than leaving them guessing.
 */

/* STEP 2: the start of the loaded region, snapped to the body. */
export function takeDistributedLoadStart(
    point
) {
    enggDrawingState.setInteraction(
        drawingState,
        {
            ...drawingState.interaction,
            phase: "distributed-load-end",
            loadStart: { ...point },
        }
    );

    setToolMessage(
        "Click the end of the loaded span, or drag along the body and release"
    );

    renderProperties();
    renderCurrentDrawing();
}

/* STEP 3: the end of the region. Never another body. */
export function takeDistributedLoadEnd(
    point
) {
    /*
     * THE REGION IS NOW FROZEN, AND SO IS THE DIRECTION'S ORIGIN.
     *
     * Both endpoints are known here and neither may move again during this
     * construction, so this is the one moment the reference point can be
     * established honestly. It is captured once and read back unchanged, so
     * the vector that sets the direction always runs from the same point
     * however the cursor moves afterwards.
     */
    const start =
        drawingState.interaction
            .loadStart;

    const reference =
        start && point
            ? {
                  x:
                      (start.x + point.x) /
                      2,
                  y:
                      (start.y + point.y) /
                      2
              }
            : null;

    enggDrawingState.setInteraction(
        drawingState,
        {
            ...drawingState.interaction,
            phase: "distributed-load-vector",
            loadEnd: { ...point },

            /*
             * The fixed origin for the magnitude/direction vector. Null
             * only for a degenerate region, which the commit refuses.
             */
            loadReferencePoint: reference
        }
    );

    setToolMessage(
        "Click to place the load"
    );

    renderProperties();
    renderCurrentDrawing();
}

/*
 * ========================================================
 * STEP 4: ONE CURSOR VECTOR DEFINES MAGNITUDE AND DIRECTION
 * ========================================================
 *
 * The span is fixed, and the student drags once. The vector from the
 * MIDPOINT of the loaded region to the cursor IS the load:
 *
 *     vector length    -> magnitude (N/m)
 *     vector direction -> the direction every arrow points
 *
 * The two are one decision, so they are one state and one click. There is
 * no typed magnitude and no angle field anywhere in this, and the direction
 * is never taken from the body - a load on a horizontal member can point
 * diagonally, and a load on an angled member can point vertically.
 *
 * WHAT IS STORED is the ANGLE in degrees, taken straight from the drag and
 * passed unchanged to the commit. The old code stored a `{dx, dy}` object
 * here, which `enggLoadProfile.loadDirection` cannot read as a number, so the
 * model fell back to its `-90` default - which is exactly why every load
 * came out pointing straight down no matter where the student aimed.
 */
export function takeDistributedLoadVector(
    origin,
    point,
    directionPoint = point
) {
    /*
     * THE DIRECTION COMES FROM THE ACTUAL CURSOR, not the snapped one.
     *
     * `point` is the resolved construction point, so it is snapped - and
     * near an end of the span it IS that end. Reading the vector from it
     * turned every cursor position near an endpoint into the same fixed
     * midpoint-to-endpoint diagonal, which is the direction rotating under
     * the student. `directionPoint` is the raw (or H/V-constrained) pointer,
     * so the direction is the one they actually drew.
     */
    const dx = directionPoint.x - origin.x;
    const dy = directionPoint.y - origin.y;

    const length = Math.hypot(dx, dy);

    /*
     * A CLICK ON THE ORIGIN IS NOT A LOAD. There is no magnitude and no
     * direction, so committing would produce a load that says nothing - and
     * one that looks committed, which is worse than asking again.
     */
    if (length < 1e-6) {
        setToolMessage(
            "Specify load magnitude and direction - drag away from the load first"
        );

        return false;
    }

    const degrees =
        Math.atan2(dy, dx) * 180 / Math.PI;

    /*
     * ========================================================
     * THE MAGNITUDE IS ASKED FOR IN A POPUP
     * ========================================================
     *
     * The cursor sets the DIRECTION, and its distance is offered as the
     * SUGGESTED magnitude - so a student who is happy with the size they
     * dragged simply presses Enter, and one who wants a round number types
     * it. Either way the value is a real physical load the student stated,
     * not a screen distance silently reinterpreted.
     *
     * The load is not created until the popup is confirmed, so a cancelled
     * popup leaves nothing behind - the same guarantee the creation-size
     * popup gives for a Beam.
     */
    openLoadMagnitudePopup({
        direction: degrees,
        suggestedMagnitude: length
    });

    return true;
}

/*
 * Ask for a constant load's magnitude, then build it.
 *
 * Kept separate from the gesture that chose the direction so the two
 * questions do not share a code path: the direction comes from the pointer
 * and is settled here, the magnitude comes from the student's own entry and
 * is settled in the popup's callback.
 */
function openLoadMagnitudePopup({
    direction,
    suggestedMagnitude
}) {
    const interaction =
        drawingState.interaction;

    const unit =
        interaction.loadUnit ??
        enggLoadProfile.DEFAULT_LOAD_UNIT;

    openLoadValuePopup({
        title: "Distributed Load",
        label: "Magnitude",
        value: Number(suggestedMagnitude).toFixed(2),
        unit,

        /*
         * THE BOTTOM BAR REPORTS THE OPEN POPUP'S QUESTION. The current step
         * is said in one place, and while the value is being entered that step
         * is the entry itself.
         */
        onOpen: () => {
            setToolMessage(
                "Enter the load magnitude"
            );
        },

        onConfirm: confirmed => {
            commitConstantLoadFromPopup({
                direction,
                magnitude: confirmed.value,
                unit: confirmed.unit,

                /*
                 * THE DRAWN HEIGHT IS THE CLICK'S, NOT THE TYPED VALUE. The
                 * distance the student pulled out from the span is how far the
                 * arrows reach; the number confirmed here is the label.
                 */
                drawnHeight: suggestedMagnitude
            });
        },

        onCancel: () => {
            setToolMessage(
                "Distributed load cancelled"
            );

            renderCurrentDrawing();
        }
    });
}

/*
 * Commit the constant load the popup confirmed.
 *
 * The same commit the direct path used, with two differences: the
 * magnitude is the number the student typed rather than the cursor
 * distance, and the UNIT they chose is recorded on the load so the drawing
 * and the Features panel state it the same way.
 */
function commitConstantLoadFromPopup({
    direction,
    magnitude,
    unit,
    drawnHeight
}) {
    const previous =
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    const created =
        commitConstantLoad(
            direction,
            magnitude,
            unit,
            drawnHeight
        );

    if (!created) {
        setToolMessage(
            "Specify load magnitude - the loaded region is not usable"
        );

        renderCurrentDrawing();

        return;
    }

    enggDrawingState.commitDrawingChange(
        drawingState,
        previous
    );

    cancelInteraction();
    activateTool("select");

    setToolMessage(
        "Distributed load created"
    );

    /*
     * THE LOAD IS LEFT SELECTED, so the magnitude just typed is visible in
     * its own panel, exactly as a sized Beam is. The Features tab follows the
     * selection, so selecting it IS opening its properties - there is no
     * separate "view" to set.
     */
    renderProperties();
    renderCurrentDrawing();
}

/*
 * The constant load the interaction currently describes.
 */
/*
 * ========================================================
 * THE LOAD THE INTERACTION CURRENTLY DESCRIBES
 * ========================================================
 *
 * Built fresh from the interaction on every preview and every commit, so
 * what is drawn while the student works and what is stored when they finish
 * cannot describe different loads - they come from the same numbers.
 *
 * It returns null until there is enough to draw. That is the whole point of
 * the sequence: with a body but no region there is nothing yet, and drawing
 * a full-body load here is what the workflow existed to prevent.
 *
 * `cursor` is the resolved construction point and decides whether the vector
 * exists at all. `directionCursor` is the point the DIRECTION is actually
 * measured to - the raw or inference-constrained pointer, never the snapped
 * endpoint - so the direction cannot swing to a default as the cursor nears
 * the span. It falls back to `cursor` so a caller with one point still works.
 */
export function constantLoadDraft(
    interaction,
    cursor,
    directionCursor = cursor
) {
    const start = interaction?.loadStart;
    const end = interaction?.loadEnd;

    if (!start || !end) {
        return null;
    }

    /*
     * BEFORE THE DRAG there is a region but no load yet, so the draft shows
     * the region alone - no direction, no magnitude. That is deliberate: the
     * student is shown the span they have chosen and nothing more, so the
     * arrows appear when the vector is given rather than being guessed.
     *
     * DURING THE DRAG the vector is read from the pointer about the region's
     * midpoint, and its length AND its angle become the magnitude and the
     * direction. The two are read here together because they come from one
     * gesture, and because the preview must be built from the same reading
     * the commit uses - a preview assembled differently from the result is
     * how a load ends up somewhere else once the click lands.
     */
    const vector = cursor
        ? loadVectorUnderPointer(
              directionCursor || cursor
          )
        : null;

    return {
        start,
        end,
        direction:
            vector?.degrees ?? null,
        magnitude:
            vector?.magnitude ?? 0
    };
}

/*
 * ========================================================
 * COMMIT, ONCE ALL FIVE THINGS ARE KNOWN
 * ========================================================
 *
 * Refuses anything incomplete, rather than filling in a default - because a
 * load created with a guessed direction or a guessed region is a load the
 * student did not ask for and has to go and find again.
 *
 * THE DIRECTION IS A UNIT VECTOR, stored on the feature as one. The
 * renderer, Switch Direction and the analysis all read this single field,
 * so they cannot disagree about which way the load points - which is how
 * "the arrows point down but the panel says up" happens.
 */
function commitConstantLoad(
    direction,
    magnitude,
    unit,
    drawnHeight
) {
    const interaction =
        drawingState.interaction;

    const draft =
        constantLoadDraft(
            interaction,
            null
        );

    if (!draft) {
        return null;
    }

    /*
     * THE MAGNITUDE IS THE ONE THE DRAG CHOSE, not the draft's - the draft is
     * built without a cursor here, so it can only be the region. Passing the
     * drag's own length in keeps the committed intensity identical to the one
     * the student was shown.
     */
    const loadMagnitude =
        Math.max(
            0,
            Number(
                magnitude ?? draft.magnitude
            ) || 0
        );

    if (loadMagnitude <= 0) {
        return null;
    }

    if (!Number.isFinite(direction)) {
        return null;
    }

    draft.magnitude = loadMagnitude;

    /*
     * A LOAD WITH NO LENGTH IS NOT A LOAD. Zero-length regions arise from a
     * double click at one point, and committing one would put a feature on
     * the sheet that draws nothing and cannot be seen to delete.
     */
    if (
        Math.hypot(
            draft.end.x - draft.start.x,
            draft.end.y - draft.start.y
        ) < 1e-9
    ) {
        return null;
    }

    const object =
        enggDrawingState.geometryFactories.load(
            draft.start,
            draft.end,
            draft.magnitude,
            {
                ...staticsAttachedStyle(
                    drawingState.activeTool,
                    interaction.staticsTarget
                ),

                /*
                 * THE UNIT THE STUDENT ENTERED THE MAGNITUDE IN. It is
                 * recorded on the load so the drawing annotation and the
                 * Features panel both state the value the same way - one
                 * unit, one source.
                 */
                loadUnit:
                    enggLoadProfile.loadUnit({
                        loadUnit: unit
                    }),

                /* How far the arrows reach - the placement click's distance. */
                arrowLength: drawnHeight
            }
        );

    object.geometry.direction =
        direction;

    if (interaction.loadSourceId) {
        object.parentId =
            interaction.loadSourceId;
    }

    enggDrawingState.addObject(
        drawingState,
        object
    );

    enggDrawingState.selectObject(
        drawingState,
        object.id
    );

    return object;
}

/*
 * Commit the constant load and create the feature.
 *
 * The result is one Distributed Load: a body, a single
 * magnitude and a single direction shared by every arrow drawn
 * across it. The even field of arrows is what the renderer
 * samples from those three values.
 */
/*
 * Create the one Varying Distributed Load feature.
 *
 * The whole construction becomes a single object: the body it
 * acts on, the direction every one of its arrows shares, and the
 * defining points of its profile. The arrows are derived from
 * those, so the load can be edited afterwards as one thing
 * rather than as a crowd of separate forces.
 */
export function finishDistributedLoadConstruction() {
    const interaction =
        drawingState.interaction;

    const draft =
        distributedLoadDraft(
            interaction,
            null
        );

    if (!draft) {
        return;
    }

    if (
        !draft.points.length
    ) {
        setToolMessage(
            "Set at least one magnitude point before finishing"
        );

        return;
    }

    /*
     * A FINISHED LOAD MUST HAVE A DIRECTION THE STUDENT CHOSE.
     *
     * The draft always carries a drawable angle so the preview has something
     * valid to show, but when nothing has been chosen that angle is the
     * model's placeholder default - it is NOT the student's direction. Storing
     * it would silently commit a load pointing a way nobody asked for, which
     * is precisely the "new load defaults to the body normal" behaviour this
     * has to remove.
     *
     * So `directionChosen` is required as well as a finite angle: the
     * placeholder may be drawn, never committed.
     */
    if (
        !draft.directionChosen ||
        !Number.isFinite(
            Number(draft.direction)
        )
    ) {
        setToolMessage(
            "Set the load's magnitude and direction before finishing"
        );

        return;
    }

    const previous =
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    const toolId =
        drawingState.activeTool;

    const peak =
        draft.points.reduce(
            (max, point) =>
                Math.max(
                    max,
                    point.magnitude
                ),
            0
        );

    /*
     * THE DRAWN HEIGHT IS THE TALLEST POINT AS PLACED. Each profile point was
     * clicked at its own distance from the span, so the peak of those
     * distances is how far the longest arrow reaches; later edits to the
     * points' values reshape the taper and leave this height alone.
     */
    const object =
        enggDrawingState.geometryFactories.load(
            draft.start,
            draft.end,
            peak,
            {
                ...staticsAttachedStyle(
                    toolId,
                    drawingState.interaction
                        .staticsTarget
                ),

                arrowLength: peak
            }
        );

    object.geometry.direction =
        draft.direction;

    object.geometry.points =
        draft.points;

    /*
     * THE ONE UNIT FOR THE WHOLE PROFILE.
     *
     * Every point was entered in the unit the interaction recorded, so the
     * finished load is stated in that same unit on the drawing and in the
     * panel. It is written here rather than on each point because a profile
     * has ONE unit - the points differ in magnitude, never in what the
     * magnitude is measured in.
     */
    object.geometry.loadUnit =
        loadUnitOfInteraction(interaction);

    object.geometry.intensity =
        draft.points.reduce(
            (sum, point) =>
                sum + point.magnitude,
            0
        ) / draft.points.length;

    if (
        interaction.parentId
    ) {
        object.parentId =
            interaction.parentId;
    }

    enggDrawingState.addObject(
        drawingState,
        object
    );

    enggDrawingState.commitDrawingChange(
        drawingState,
        previous
    );

    enggDrawingState.clearInteraction(
        drawingState
    );

    enggDrawingState.selectObject(
        drawingState,
        object.id
    );

    activateTool("select");

    setToolMessage(
        "Distributed load created"
    );

    renderProperties();
    renderCurrentDrawing();
}
