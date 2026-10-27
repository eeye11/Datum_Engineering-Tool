/*
 * Attaching Statics features to bodies, and keeping them attached as bodies move.
 */

import enggBodyFrames from "../../../shared/geometry/body-frames.js";
import enggFeatureGeometry from "../../../shared/geometry/feature-geometry.js";
import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggLoadProfile from "../model/analysis/load-profile.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { staticsForceLineWidth } from "../constants.js";
import { drawingState } from "../editor-state.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { isStaticsBody, trussJointHandles } from "../interaction/handles.js";
import { objectAtPoint } from "../interaction/hit-testing.js";
import { beginMomentPlacement } from "../geometry/preview.js";
import { STATICS_CHILD_TOOLS, STATICS_FEATURE_LABELS, staticsAttachmentId, staticsBodyMessage, staticsToolPointCount } from "./statics-tools.js";
import { activateTool } from "../../../components/layout/toolbar/tool-activation.js";
import { activeCategory } from "../../../components/layout/toolbar/tool-menus.js";
import { renderEngineeringTools, setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";
import { isConnectionType, isSupportType } from "../../../shared/model/feature-types.js";

/*
 * Whether a feature is one of the Statics engineering
 * features, as opposed to shared or construction geometry.
 *
 * The Statics features are edited through their own
 * engineering data, so this one predicate routes all of them
 * through the same handling instead of each one growing a
 * special case.
 */
export function isStaticsFeature(
    object
) {
    return Boolean(
        object &&
            object.engineering
                ?.discipline ===
                "statics" &&
                STATICS_FEATURE_LABELS[
                    object.type
                ]
    );
}

/*
 * Apply one direct-manipulation step to a Statics feature.
 *
 * Each branch writes the real engineering field: a force's
 * application point, a load's intensity, a support's facing
 * direction. The rendered arrows and symbols are derived
 * from these, so dragging a handle updates the drawing
 * exactly as typing in the panel would.
 */
/*
 * A RIGID BODY'S TWO HANDLE EDITS. Its centre handle moves the whole body to
 * the point (a translation, so every point keeps its place relative to the
 * centre), and its radius handle sets the radius of a round body.
 */
function moveRigidBodyTo(object, axis, value) {
    const current = enggFeatureGeometry.rigidBodyCenter(object.geometry);

    if (!current) {
        return;
    }

    enggFeatureGeometry.translateObject(
        object,
        axis === "x" ? value - current.x : 0,
        axis === "y" ? value - current.y : 0
    );
}

function setRigidBodyRadius(object, radius) {
    object.geometry.radius = radius;
}

export function applyStaticsManipulation(
    object,
    drag,
    point
) {
    const g = object.geometry;

    const kind = drag.kind;

    /*
     * The two ends of a span-shaped feature: a member, a
     * load's loaded region, a connection, or a force's
     * application point and vector end.
     */
    if (
        kind === "start" ||
        kind === "end"
    ) {
        /*
         * A FORCE'S ARROWHEAD IS DRAGGED: THE ARROW IS REDRAWN TO IT.
         *
         * The head goes where it is released, so the arrow's direction and
         * its drawn length both follow the drag. The magnitude - the label's
         * value - is unchanged: a drag is drawing, not a statement about how
         * large the force is.
         */
        if (
            object.type === "force" &&
            kind === "end"
        ) {
            const drawn =
                enggLoadProfile.forceVectorFromDrawnPoint(
                    drawingState,
                    g,
                    point
                );

            enggLoadProfile.setForceVector(
                g,
                drawn.magnitude,
                drawn.angle,
                { length: drawn.length }
            );

            return;
        }

        g[kind] = {
            x: point.x,
            y: point.y
        };

        /*
         * Moving an attachment is how a feature is aimed at
         * a different body. The existing snap already knows
         * what is under the cursor, so the parent is
         * re-read and the feature is reparented rather than
         * duplicated.
         */
        if (kind === "start") {
            updateAttachment(
                object,
                point
            );
        }

        return;
    }

    /*
     * A load's arrow-tip handle. Dragging it changes how far the
     * load's arrows are DRAWN; the intensities are its values and
     * are edited in Features.
     */
    if (kind.startsWith("load-")) {
        const key =
            kind.replace("load-", "");

        if (!g.start || !g.end) {
            return;
        }

        /*
         * One defining arrow's tip, for a uniform or a varying load.
         * Its distance from the body is measured ALONG the load's own
         * direction, exactly as it is during construction.
         */
        if (key.startsWith("point")) {
            const index =
                Number(
                    key.replace("point", "")
                );

            const points =
                enggLoadProfile.profilePoints(g);

            if (!points[index]) {
                return;
            }

            const along =
                enggLoadProfile.pointAlong(
                    g,
                    points[index].t
                );

            const direction =
                enggLoadProfile.unitVector(
                    enggLoadProfile.loadDirection(g)
                );

            /*
             * THE DRAG SETS THE DRAWN HEIGHT, NOT THE VALUE.
             *
             * The arrow tip is pulled to `point`: its reach along the load's
             * direction becomes this arrow's drawn length, and the height is
             * the one that gives it that length for its intensity (the arrow
             * is `height x intensity / peak`). Every arrow follows in
             * proportion; no intensity - no label - changes.
             */
            const reach =
                (point.x - along.x) * direction.x +
                (point.y - along.y) * direction.y;

            const peak = enggLoadProfile.peakMagnitude(g);
            const own = Math.abs(Number(points[index].magnitude) || 0);

            if (reach > 1e-6 && own > 0 && peak > 0) {
                enggLoadProfile.setLoadArrowHeight(
                    g,
                    (reach * peak) / own
                );
            }

            return;
        }

        return;
    }

    /*
     * A support's orientation handle. The support turns to
     * face the direction the handle is dragged in while its
     * attachment point stays put.
     */
    if (kind === "orientation") {
        if (!g.position) {
            return;
        }

        g.orientation =
            (Math.atan2(
                point.x - g.position.x,
                point.y - g.position.y
            ) * 180) /
            Math.PI;

        return;
    }

    if (kind === "position" && g.position) {
        /*
         * A SUPPORT IS PINNED TO ITS MEMBER, NOT TO A PLACE.
         *
         * This handle used to write the raw cursor point straight into
         * `position` and then re-read the parent from wherever the pointer
         * happened to be. Because the symbol is drawn clear of the beam, the
         * pointer is almost never over it - so the parent came back null, the
         * support was orphaned, and the next frame had no body to slide along
         * and no attachment to hold it. It became a free-floating mark the
         * student could drag anywhere, which is what "it unpins the moment I
         * touch it" describes.
         *
         * So the drag is resolved the way the placement was: projected onto
         * the member's centreline and stored as its FRACTION along it. The
         * support keeps its body, keeps its place on that body, and survives
         * the body being resized or moved afterwards - which is the whole
         * point of storing a fraction rather than a world coordinate.
         *
         * A support with no body is the one case where a free position is
         * right: there is no member to be pinned to, so the pointer is the
         * only answer available.
         */
        if (isSupportType(object.type)) {
            const parent = object.parentId
                ? drawingState.objects.find(
                      candidate => candidate.id === object.parentId,
                  )
                : null;

            const frame = parent
                ? enggBodyFrames.frameOf(parent)
                : null;

            if (!frame) {
                g.position = {
                    x: point.x,
                    y: point.y
                };

                return;
            }

            const clamped = Math.min(
                frame.length,
                Math.max(0, enggBodyFrames.positionOn(frame, point)),
            );

            const moved = enggBodyFrames.pointAt(frame, clamped);

            g.attachment = enggBodyFrames.attachmentFor(frame, moved);

            const placement = enggBodyFrames.supportPlacement(
                parent,
                moved,
                g.flipped === true,
            );

            if (placement) {
                g.position = placement.render;
            }

            return;
        }

        /*
         * A CONSTRAINED COORDINATE DOES NOT MOVE.
         *
         * The X and Y checkboxes in the Features panel lock one coordinate
         * each, so a drag must respect them per axis rather than being blocked
         * or ignored as a whole. Dragging a point with X constrained and Y free
         * slides it vertically; with both constrained it does not move at all;
         * with neither it moves normally. The constraint is read from the
         * feature's own model, which is the same state the panel shows.
         */
        const pinnedX =
            object.constraints?.["position.x"] === true;

        const pinnedY =
            object.constraints?.["position.y"] === true;

        g.position = {
            x: pinnedX ? g.position.x : point.x,
            y: pinnedY ? g.position.y : point.y
        };

        updateAttachment(
            object,
            pinnedX || pinnedY
                ? { x: g.position.x, y: g.position.y }
                : point
        );
    }
}

/*
 * Re-read the parent of an attached feature from a point.
 *
 * The relationship is stored as the actual feature id of the
 * body the point resolved onto, so dropping a force onto a
 * different Beam moves that one feature under the new parent.
 * It is never re-created, and it is never inferred later from
 * proximity.
 */
function updateAttachment(
    object,
    point
) {
    const target =
        staticsBodyAtPoint(point);

    const parentId =
        target ? target.id : null;

    if (object.parentId === parentId) {
        return;
    }

    object.parentId =
        parentId ??
        undefined;
}

/*
 * The body under a point, or null.
 *
 * Used when dragging an attachment so the feature follows the
 * body the cursor is actually over.
 */
export function staticsBodyAtPoint(
    point
) {
    const hit = objectAtPoint(point);

    return isStaticsBody(hit) ? hit : null;
}

/*
 * Take the body a Statics feature will act on.
 *
 * A feature like a load or a support only means something
 * relative to a body, so the first click names that body and
 * nothing is created yet. The valid placement locations then
 * appear along it, and the feature is built on a later click.
 */
export function beginStaticsAttachment(
    resolution
) {
    const point =
        resolution.effectiveConstructionPoint;

    /*
     * A MOMENT IS NOT ATTACHED TO A BODY FIRST.
     *
     * A support must be propped under something, so it needs a body
     * before it can go anywhere. A moment does not: an applied moment
     * is a moment at a point, and is perfectly meaningful on a blank
     * sheet. Requiring a body would mean a student could not put a
     * moment anywhere until they had drawn something to put it on,
     * which is the opposite of how moments are used.
     *
     * So the click goes straight to the application point, and a body
     * is picked up as the parent if there happens to be one under it -
     * which gives the association for free without making it a
     * precondition.
     */
    if (
        drawingState.activeTool ===
            "moment"
    ) {
        beginMomentPlacement(
            point,
            staticsBodyAtPoint(point)?.id
        );

        return;
    }

    const body =
        staticsAttachmentId(
            resolution.snapCandidate
        )
            ? drawingState.objects.find(
                  object =>
                      object.id ===
                      staticsAttachmentId(
                          resolution.snapCandidate
                      )
              )
            : staticsBodyAtPoint(point);

    if (!body) {
        setToolMessage(
            "Select a body to attach to"
        );

        return;
    }

    enggDrawingState.setInteraction(
        drawingState,
        {
            ...resolution,

            phase:
                "statics-attach",

            staticsTarget: body,

            attachmentPoints: [],

            points: []
        }
    );

    setToolMessage(
        staticsBodyMessage(
            drawingState.activeTool,
            1
        )
    );

    renderCurrentDrawing();
}

/*
 * Advance a body-attached feature by one placed point.
 *
 * The points are collected rather than committed, so the
 * whole feature is created once its data is complete. The
 * body is resolved from the snap, so the relationship is
 * stored as the body's actual feature id.
 */
export function continueStaticsAttachment(
    resolution
) {
    const interaction =
        drawingState.interaction;

    const point =
        resolution.effectiveConstructionPoint;

    if (!point) {
        return;
    }

    const placed = [
        ...(interaction.attachmentPoints ||
            []),
        { ...point }
    ];

    const required =
        staticsToolPointCount(
            drawingState.activeTool
        );

    if (placed.length < required) {
        /*
         * The first end is in. The preview now shows the
         * whole region being loaded, so the second end can
         * be judged against it.
         */
        enggDrawingState.setInteraction(
            drawingState,
            {
                ...resolution,

                phase:
                    "statics-attach",

                staticsTarget:
                    interaction.staticsTarget,

                attachmentPoints:
                    placed,

                points: placed
            }
        );

        setToolMessage(
            staticsBodyMessage(
                drawingState.activeTool,
                2
            )
        );

        renderCurrentDrawing();
        return;
    }

    commitStaticsAttachment(
        placed,
        resolution
    );
}

/*
 * Create the feature once every required point is placed.
 *
 * One feature is created, holding the loaded region, its
 * intensities and the body's id. The repeated arrows are
 * drawn from that data by the renderer and are never separate
 * features.
 */
function commitStaticsAttachment(
    points,
    resolution
) {
    const previous =
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    const toolId =
        drawingState.activeTool;

    const type =
        STATICS_CHILD_TOOLS[toolId]?.type;

    const interaction =
        drawingState.interaction;

    const body =
        interaction.staticsTarget;

    const start = points[0];
    const end =
        points[1] ?? points[0];

    let object = null;

    if (type === "load") {
        /*
         * A uniform load carries one intensity across the whole
         * region it acts on.
         */
        object =
            enggDrawingState.geometryFactories.load(
                start,
                end,
                10,
                staticsAttachedStyle(
                    toolId,
                    body
                )
            );
    } else if (type === "varying-load") {
        /*
         * A varying load carries an intensity at each end, so
         * it is built through its own factory rather than by
         * reusing the uniform one.
         */
        object =
            enggDrawingState.geometryFactories[
                "varying-load"
            ](
                start,
                end,
                0,
                10,
                staticsAttachedStyle(
                    toolId,
                    body
                )
            );
    } else if (type === "moment") {
        object =
            enggDrawingState.geometryFactories.moment(
                start,
                50,
                false,
                staticsAttachedStyle(
                    toolId,
                    body
                )
            );
    } else if (
        isSupportType(type)
    ) {
        /*
         * ========================================================
         * A FIXED SUPPORT IS BUILT INTO AN END, AND ONLY AN END
         * ========================================================
         *
         * A pin, a roller and a smooth support can sit anywhere along a
         * member, because each restrains one DOF wherever it is built
         * in. A fixed support is different in kind: it restrains EVERY
         * DOF at the point it is built into, so one built into the
         * middle of a member restrains that member at three places and
         * makes it indeterminate in a way the student never drew. The
         * member on the sheet is then not the member being modelled.
         *
         * So the point is SNAPPED to whichever end is nearer, and the
         * support is placed there. Snapping rather than refusing: a
         * student clicking near an end means that end, and "no" would be
         * a worse answer than the nearest thing they wanted.
         *
         * ONLY the fixed support is treated this way. Making every
         * support endpoint-only would break the commonest case in
         * statics - a roller under the middle of a simply supported
         * beam - so the shared placement must keep behaving exactly as
         * it did.
         *
         * The point is snapped HERE rather than inside the factory
         * because the factory is shared by all four supports and has no
         * business knowing which of them has a placement rule. Snapping
         * the point going in keeps the rule with the rule and leaves the
         * factory a pure function of its arguments.
         */
        const supportPoint =
            type === "fixed-support" && body
                ? nearestBodyEnd(body, start)
                : start;

        const snappedToEnd =
            supportPoint !== start;

        object =
            enggDrawingState.geometryFactories[type](
                supportPoint,
                staticsAttachedStyle(
                    toolId,
                    body
                )
            );

        /*
         * THE ATTACHMENT IS TAKEN FROM THE BODY FRAME, ON THE WAY IN.
         *
         * The factory can only seed an attachment from the raw point it was
         * given, and it guesses a DISTANCE ALONG the member from the point's
         * X coordinate. That guess is only right when the body starts at the
         * origin and runs along +X - which is why a support on any other
         * member appeared somewhere other than where it was clicked, and
         * usually at an end: a body from x=100 to x=400 with a support
         * clicked at x=250 was filed 250 units along a member whose origin is
         * at 100, so it resolved to x=350 and then clamped toward the far
         * end. A member running diagonally was wrong in the other way, the
         * length being measured along X on a member that leaves X behind.
         *
         * So the distance is measured ON THE MEMBER - the projection the body
         * frame exists to provide - and stored as the FRACTION of its
         * length, which is the form that also survives the member being
         * resized later. The guess is left in place for a support with no
         * body, where there is no frame to measure against and nothing to be
         * wrong about either.
         */
        if (body) {
            const frame =
                enggBodyFrames.frameOf(body);

            if (frame) {
                const distance =
                    enggBodyFrames.positionOn(
                        frame,
                        supportPoint
                    );

                object.geometry.attachment =
                    enggBodyFrames.attachmentFor(
                        frame,
                        supportPoint
                    );

                const placement =
                    enggBodyFrames.supportPlacement(
                        body,
                        supportPoint,
                        object.geometry.flipped === true,
                        { fixed: type === "fixed-support" }
                    );

                if (placement) {
                    object.geometry.position =
                        placement.render;
                    if (type === "fixed-support") {
                        object.geometry.orientation = placement.orientation;
                    }
                }

                /*
                 * Recorded because a support placed away from an end is the
                 * ordinary case - a roller under the middle of a simply
                 * supported beam - and a distance that says so is worth
                 * having on the object itself.
                 */
                object.geometry.distanceAlongBody =
                    distance;
            }
        }

        if (snappedToEnd) {
            /*
             * THE STUDENT IS TOLD, because the click and the result
             * disagree. Silence would leave a support somewhere they did
             * not put it, and the only clue would be an analysis that
             * does not match their own drawing.
             */
            setToolMessage(
                "A fixed support must be built into an end of the " +
                    "body, so it was placed at the nearest end"
            );
        }
    } else if (isConnectionType(type)) {
        object =
            enggDrawingState.geometryFactories[type](
                start,
                end,
                staticsAttachedStyle(
                    toolId,
                    body
                )
            );
    }

    if (!object) {
        setToolMessage(
            "That tool could not be created"
        );

        return;
    }

    /*
     * The relationship is the body's real feature id, so the
     * Feature Tree nests the result under the body it acts on
     * and a later move of that body carries it along.
     */
    object.parentId =
        body?.id ??
        undefined;

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

    if (isSupportType(type)) {
        renderProperties();
        activateTool("select");
        return;
    }

    activateTool("select");

    renderProperties();
    renderCurrentDrawing();
}

/*
 * The style and engineering record for an attached feature.
 *
 * It is the same record every other Statics feature gets, so
 * an attached feature is identified exactly like a free one.
 */
/*
 * ========================================================
 * NEAREST BODY END
 * ========================================================
 *
 * Which end of a body is nearer a point, as a point ON that body.
 *
 * Used only for the Fixed Support, which may be built into an end and not
 * a midpoint. The comparison is made along the body's own centreline
 * rather than in screen space, so a member drawn at an angle is handled
 * correctly and the result does not change with the zoom.
 *
 * The body is read through the shared frame helper, so a body with any
 * stored members - a truss, a cable - is measured the same way a plain
 * beam is, instead of this needing to know what a beam looks like.
 *
 * The ORIGINAL point is returned when it already sits at an end, and when
 * the body cannot be measured at all, because snapping a support to a
 * guessed end is worse than leaving the student's own point alone.
 */
function nearestBodyEnd(
    body,
    point
) {
    const frame = enggBodyFrames.frameOf(body);

    if (!frame || !(frame.length > 0)) {
        return point;
    }

    const placement =
        enggBodyFrames.supportPlacement(
            body,
            point,
            false
        );

    if (!placement) {
        return point;
    }

    const distance = placement.distance ?? 0;

    const length = frame.length;

    /*
     * Already at an end, or so close that moving it would be a
     * rounding artefact rather than a correction. Left exactly as the
     * student placed it, so a support deliberately drawn on a corner
     * does not get nudged off it.
     */
    if (
        distance <= 1e-6 ||
        distance >= length - 1e-6
    ) {
        return point;
    }

    const nearerEndDistance =
        length - distance < distance ? length : 0;

    return (
        enggBodyFrames.pointAt(
            frame,
            nearerEndDistance
        ) || point
    );
}

export function staticsAttachedStyle(
    toolId,
    body
) {
        /*
         * A Point Force starts heavier than the general line weight.
         * The choice is made in one place so the creation path, the
         * factory default and every later read of the style all
         * agree, and so the value can be changed in one place.
         */
        const lineWidth =
            staticsForceLineWidth(toolId);

        return {
            style: {
                ...drawingState.styleDefaults,
                lineWidth
            },

            engineering: {
                plane: "XY",
                discipline: "statics",
                staticsType: toolId
            },

            parentId: body?.id ?? undefined
        };
    }

/*
 * Abandon an unfinished Statics operation.
 *
 * The preview and the temporary target are dropped and no
 * feature is created, so a cancelled load or support leaves the
 * body exactly as it was. This is what Esc and choosing
 * another tool both go through.
 */
function cancelStaticsInteraction() {
    const interaction =
        drawingState.interaction;

    const wasAttaching =
        interaction.phase ===
            "statics-attach" ||
        Boolean(interaction.staticsTarget);

    enggDrawingState.clearInteraction(
        drawingState
    );

    if (wasAttaching) {
        enggDrawingState.setActiveTool(
            drawingState,
            "select"
        );

        setToolMessage(
            "Select geometry"
        );

        renderEngineeringTools(
            activeCategory()
        );
    }

    return wasAttaching;
}

export { cancelStaticsInteraction };

/*
 * Move one truss joint and every member that meets it.
 *
 * The members are stored as endpoints, so a joint is found by
 * the coordinates that members share. Every occurrence moves
 * together, which is what keeps the structure connected.
 */
export function moveTrussJoint(
    object,
    index,
    point
) {
    const g = object.geometry;

    if (!Array.isArray(g.members)) {
        return;
    }

    const joints = trussJointHandles(
        g.members
    );

    const joint = joints[index];

    if (!joint) {
        return;
    }

    const dx = point.x - joint.point.x;
    const dy = point.y - joint.point.y;

    g.members.forEach(member => {
        [
            member.start,
            member.end
        ].forEach(endpoint => {
            if (
                Math.hypot(
                    endpoint.x - joint.point.x,
                    endpoint.y - joint.point.y
                ) < 1e-6
            ) {
                endpoint.x += dx;
                endpoint.y += dy;
            }
        });
    });

    /*
     * The span end points track the outer joints, so a
     * selection box still covers the whole structure.
     */
    const first = g.members[0]?.start;
    const last =
        g.members[g.members.length - 1]
            ?.end;

    if (first && last) {
        g.start = { ...first };
        g.end = { ...last };
    }
}

/*
 * Apply one drag to a rigid body handle.
 *
 * The handle stands for a value in the body's current shape,
 * so it writes that value directly. A corner resizes against
 * the opposite corner, a vertex moves that vertex, and a radius
 * handle measures from the centre, which is how each of those
 * shapes is actually defined.
 */
export function applyRigidBodyHandle(
    object,
    drag,
    point
) {
    const g = object.geometry;

    const kind = drag.kind;

    if (kind === "rigid-centre") {
        moveRigidBodyTo(object, "x", point.x);
        moveRigidBodyTo(object, "y", point.y);
        return;
    }

    if (kind === "rigid-radius") {
        const center =
            g.center || { x: 0, y: 0 };

        setRigidBodyRadius(
            object,
            Math.hypot(
                point.x - center.x,
                point.y - center.y
            )
        );

        return;
    }

    const vertexMatch =
        /^rigid-vertex(\d)$/.exec(kind);

    if (vertexMatch) {
        const index = Number(vertexMatch[1]);

        if (!g.points?.[index]) {
            return;
        }

        g.points[index].x = point.x;
        g.points[index].y = point.y;
        return;
    }

    const cornerMatch =
        /^rigid-corner(\d)$/.exec(kind);

    if (cornerMatch) {
        const index = Number(cornerMatch[1]);

        const corners = enggFeatureGeometry
            .rectangleCorners(g);

        const opposite =
            corners[(index + 2) % 4];

        if (!opposite) {
            return;
        }

        /*
         * The corner follows the cursor while the opposite
         * corner stays put, so a rectangle is resized rather
         * than moved.
         */
        const minX = Math.min(opposite.x, point.x);
        const maxX = Math.max(opposite.x, point.x);
        const minY = Math.min(opposite.y, point.y);
        const maxY = Math.max(opposite.y, point.y);

        g.width = Math.max(maxX - minX, 1e-6);
        g.height = Math.max(maxY - minY, 1e-6);
        g.position = { x: minX, y: maxY };
    }
}
