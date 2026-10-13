/*
 * Manipulation handles: which grips a feature has, and which one is under the pointer.
 */

import enggFeatureGeometry from "../core/geometry/feature-geometry.js";
import { cylinderPoint, isPistonCylinder, pistonFraction, stopperFraction } from "../features/thermodynamics/piston-cylinder.js";
import { coordinateSystemArms, rigidBodyHandles } from "../core/geometry/feature-handles.js";
import enggDrawingState from "../core/model/drawing-state.js";
import enggDimensions from "../core/scale/dimensions.js";
import enggAnnotate from "../features/annotations/annotate-model.js";
import enggLoadProfile from "../features/analysis/load-profile.js";
import { COORDINATE_SYSTEM_TYPE } from "./constants.js";
import { drawingCanvas } from "./dom.js";
import { drawingState, editorState } from "./editor-state.js";
import { isRectangleLike, safeDimensionGraphics } from "./hit-testing.js";
import { translateObject } from "./transforms.js";
import { STATICS_BODY_TYPES, isConnectionType, isSupportType } from "../core/model/feature-types.js";

/*
 * Which view the Features panel is showing.
 *
 * "tree" is the list of components, and is where the panel
 * normally lives. "edit" is the editing page of the single
 * selected feature.
 *
 * This is explicit state rather than something derived from the
 * selection, because selecting a feature and choosing to edit it
 * are separate decisions. Deriving the view from the selection
 * is what made the panel jump to the editing page every time a
 * feature was picked, and what made pressing Features fail to
 * return to the list: with a feature still selected, the list
 * looked the same as a request to edit it.
 */
/*
 * A LENGTH THE STUDENT TYPED, IN MILLIMETRES, AS WORLD UNITS.
 *
 * This is the INPUT direction of the one conversion: the panel shows and
 * accepts physical millimetres, the geometry stores world units, and the
 * document's World Scale relates them. `updateFeatureProperty` is the single
 * caller that writes it into geometry, so a coordinate and a Length cannot
 * end up converted differently.
 */
export function worldLengthOf(typed, unit = "mm") {
    return enggDimensions?.fromEngineering
        ? enggDimensions.fromEngineering(drawingState, typed, unit)
        : typed;
}

/*
 * A stored length, in MILLIMETRES, for a panel field captioned with
 * a unit.
 *
 * The geometry holds world units, which have no physical size of
 * their own - they only mean something through the document scale.
 * A panel field captioned "mm" therefore has to be given
 * millimetres, or it will print the raw world number under a unit
 * that says otherwise. That is how a beam sized at 500 mm came to
 * read "100.42 mm" in its own properties.
 *
 * There is ONE conversion for the whole panel so that a beam, a
 * circle, a rectangle and a rigid body cannot disagree about what a
 * millimetre is, and so that the number the student reads is the
 * same number the creation popup asked for.
 *
 * It is deliberately at module scope: the length rows live in more
 * than one panel builder, and a second copy of this conversion is
 * exactly the duplicate-scale-system problem.
 */
export function mmOf(worldLength) {
    const value = Number(worldLength);

    return enggDimensions?.toEngineering
        ? enggDimensions.toEngineering(drawingState, value)
        : { value, unit: "mm" };
}

/*
 * Abandon an in-flight direct-manipulation drag.
 *
 * The geometry mutates live while dragging, so
 * cancelling has to put the captured originals back,
 * otherwise Esc would leave the shape half-rotated.
 */
export function cancelManipulationDrag() {
    if (!editorState.manipulationDrag) {
        return;
    }

    const drag =
        editorState.manipulationDrag;

    editorState.manipulationDrag =
        null;

    /*
     * A CANCELLED DRAG LEAVES NO SNAP STATE BEHIND.
     *
     * The guide and the snap marker belong to the drag that is being thrown
     * away, so they go with it - exactly as they do on a committed release.
     * A cancelled gesture must not leave a horizontal or vertical guide
     * pointing at a relationship that no longer exists.
     */
    enggDrawingState.setInteraction(
        drawingState,
        {
            snapCandidate: null,
            inference: null,
            guideline: null
        }
    );

    if (
        drawingCanvas.hasPointerCapture(
            drag.pointerId
        )
    ) {
        drawingCanvas.releasePointerCapture(
            drag.pointerId
        );
    }

    if (!drag.moved) {
        return;
    }

    /*
     * Restore every object the drag touched from the
     * snapshot taken when the drag began.
     */
    drawingState.objects =
        drawingState.objects.map(
            object =>
                drag.originals[object.id]
                    ? {
                        ...JSON.parse(
                            JSON.stringify(
                                drag.originals[
                                    object.id
                                ]
                            )
                        ),

                        /*
                         * Identity and style are the LIVE ones, not the
                         * snapshot's.
                         *
                         * A drag does not re-style or re-identify a
                         * feature, but the snapshot is taken before any
                         * other edit could have happened, and restoring
                         * a stale id would detach the object from
                         * everything that points at it.
                         */
                        id: object.id,
                        style: object.style
                    }
                    : object
        );
}

const MANIPULATION_PICK_PX = 9;

/*
 * The features attached to a given body.
 *
 * Attachment is recorded as an authoritative parent id, so
 * the relationship is read from the feature collection and
 * never inferred from where a feature happens to sit.
 */
function attachedChildren(
    parentId
) {
    if (!parentId) {
        return [];
    }

    return drawingState.objects.filter(
        object =>
            object.parentId ===
                parentId
    );
}

/*
 * Move a body and everything attached to it by the same
 * delta.
 *
 * The children are restored to their pre-drag geometry first
 * so the drag applies exactly one translation rather than
 * accumulating, exactly as the rotation path does.
 */
export function moveObjectAndChildren(
    object,
    deltaX,
    deltaY,
    originals
) {
    /*
     * THE DRAGGED FEATURE IS RESTORED TOO, NOT ONLY ITS CHILDREN.
     *
     * The delta here is measured from where the PRESS happened, so it is the
     * whole distance travelled so far - not the distance since the last
     * pointermove. That makes this function a SET rather than a nudge: it
     * puts the feature at "wherever it was when the drag began, plus the
     * total distance travelled". For that to hold, the feature has to be
     * back at its starting position first.
     *
     * The children were already restored for exactly this reason and the
     * feature itself was not, so on every pointermove the children snapped
     * back to where the drag began and were moved the full distance again,
     * while the feature being dragged accumulated a full delta on top of
     * the previous one. Two or three moves in and it had left the cursor by
     * a multiple of the distance dragged - which is what "it flies off"
     * looked like, and it got worse the longer the drag went on.
     *
     * Restoring the feature from the same snapshot the children are restored
     * from makes the drag idempotent: the same pointer position always
     * produces the same result, and the feature stays under the cursor.
     */
    if (originals && Object.prototype.hasOwnProperty.call(originals, object.id)) {
        object.geometry =
            JSON.parse(
                JSON.stringify(
                    originals[object.id]
                )
            );
    }

    translateObject(
        object,
        deltaX,
        deltaY
    );

    attachedChildren(
        object.id
    ).forEach(child => {
        const original =
            originals?.[child.id];

        if (original) {
            child.geometry =
                JSON.parse(
                    JSON.stringify(
                        original
                    )
                );
        }

        translateObject(
            child,
            deltaX,
            deltaY
        );
    });
}

/*
 * The bodies a Statics feature may attach to.
 *
 * Only real bodies are eligible, so a force snapped onto a
 * Beam becomes part of that Beam, while one snapped onto a
 * stray Line stays unattached rather than adopting geometry
 * that has no engineering meaning.
 */
export function isStaticsBody(
    object
) {
    return Boolean(
        object &&
            STATICS_BODY_TYPES.includes(
                object.type
            )
    );
}

/*
 * Handles for a distributed or varying distributed load.
 *
 * The two ends move the loaded region and the magnitude
 * handle changes the load itself. The arrows are drawn from
 * these values, so dragging a handle is the same action as
 * typing a new intensity in the panel.
 */
function loadHandles(
    object
) {
    const g = object.geometry;

    const handles = [
        { kind: "start", point: g.start },
        { kind: "end", point: g.end }
    ];

    if (object.type === "load") {
        /*
         * A distributed load's magnitude points are dragged the
         * same way they are typed: each handle writes one point's
         * magnitude, and the profile between them follows. The
         * two ends of the body move the loaded region itself.
         */
        enggLoadProfile
            .profilePoints(g)
            .forEach((point, index) => {
                const along =
                    enggLoadProfile.pointAlong(
                        g,
                        point.t
                    );

                const direction =
                    enggLoadProfile.unitVector(
                        enggLoadProfile.loadDirection(
                            g
                        )
                    );

                handles.push({
                    kind: `load-point${index}`,
                    point: {
                        x:
                            along.x +
                            direction.x *
                                point.magnitude,
                        y:
                            along.y +
                            direction.y *
                                point.magnitude
                    }
                });
            });

        return handles;
    }

    handles.push(
        loadMagnitudeHandle(
            object,
            g.start,
            g.end,
            "startIntensity"
        ),

        loadMagnitudeHandle(
            object,
            g.end,
            g.start,
            "startIntensity"
        )
    );

    return handles;
}

/*
 * A point off the loaded region whose distance from one end
 * is proportional to that end's intensity.
 *
 * Placing it this way means the handle is always somewhere
 * useful to grab, and it is derived from the real geometry
 * rather than from a fixed offset.
 */
function loadMagnitudeHandle(
    object,
    from,
    to,
    key
) {
    const g = object.geometry;

    const dx = to.x - from.x;
    const dy = to.y - from.y;

    const length =
        Math.hypot(dx, dy) || 1;

    /*
     * The world length of one unit of intensity, so the
     * handle follows the zoom the way every other handle
     * does.
     */
    const scale =
        enggDrawingState.BASE_PIXELS_PER_UNIT *
        drawingState.camera.zoom;

    const pixels =
        Math.abs(
            Number(g[key]) || 0
        ) * 6;

    const world =
        pixels / Math.max(scale, 1e-6);

    return {
        kind: `load-${key}`,
        point: {
            x: from.x - (dx / length) * world,
            y: from.y - (dy / length) * world
        }
    };
}

/*
 * Handles for a support: the point where it attaches to its
 * body, and a point one step away that sets which way it
 * faces.
 */
function supportHandles(
    object
) {
    const g = object.geometry;

    const position = g.position;

    if (!position) {
        return [];
    }

    const scale =
        enggDrawingState.BASE_PIXELS_PER_UNIT *
        drawingState.camera.zoom;

    const reach =
        14 / Math.max(scale, 1e-6);

    const angle =
        (Number(g.orientation) || 0) *
        Math.PI /
        180;

    return [
        {
            kind: "position",
            point: position
        },
        {
            kind: "orientation",
            point: {
                x: position.x - Math.sin(angle) * reach,
                y: position.y + Math.cos(angle) * reach
            }
        }
    ];
}

/*
 * One handle per truss joint.
 *
 * A joint is the distinct set of points the members share, so
 * moving a handle moves a single joint and the members meeting
 * it, rather than one arbitrary end of one member.
 */
export function trussJointHandles(
    members
) {
    const joints = [];

    members.forEach(member => {
        [member.start, member.end].forEach(point => {
            const known = joints.find(
                existing =>
                    Math.hypot(
                        existing.x - point.x,
                        existing.y - point.y
                    ) < 1e-6
            );

            if (!known) {
                joints.push({
                    x: point.x,
                    y: point.y
                });
            }
        });
    });

    return joints.map((point, index) => ({
        kind: `truss-joint${index}`,
        point
    }));
}

function manipulationHandles(
    object
) {
    const g =
        object.geometry || {};

    /*
     * AN ANNOTATION IS MOVED FROM ITS OWN POSITION.
     *
     * It has no geometry - its whole state is a placement - so the
     * shape handles below never produce anything for it and the one
     * thing a student most needs to do with a label, put it somewhere
     * legible, would be impossible.
     *
     * A single handle at the text is what the existing drag machinery
     * already knows how to carry, so this needs no new drag behaviour:
     * only the handle and a branch in applyManipulation.
     */
    if (
        object.type === "annotation" &&
        object.placement
    ) {
        return [
            {
                kind: "position",
                point: object.placement
            }
        ];
    }

    /*
     * A LABEL HAS TWO HANDLES: ITS TEXT AND ITS ANCHOR.
     *
     * The text handle moves the words; the anchor handle deliberately moves the
     * POINT THE LABEL MARKS, which is the one act that is allowed to change what
     * a label is about. They are separate because they mean different things -
     * moving the text is legibility, moving the anchor is a decision about the
     * drawing.
     *
     * Both are plain points on the stored geometry (`position` and `start`), so
     * the drag applies them through the same branch every other annotate handle
     * uses.
     */
    if (
        object.type === "annotate" &&
        object.annotateKind === "label" &&
        g.position &&
        g.start
    ) {
        return [
            { kind: "position", point: g.position },
            { kind: "annotate-anchor", point: g.start }
        ];
    }

    /*
     * A LEADER OR A CALLOUT IS EDITED ALONG ITS PEN.
     *
     * The path is one ordered list - attachment, bends, endpoint - and each of
     * those points is a handle, so the student can bend the leader around the
     * drawing by dragging rather than by typing coordinates. The kinds WITHOUT
     * a path (a note, a label, a symbol, a tolerance, a table, a bare arrow)
     * get nothing here and keep their existing whole-feature move.
     *
     * `bend{i}` names a bend by its index in the STORED list, which is the
     * same index `removeLeaderBend` takes and the same order the path is
     * drawn in - so a handle and the bend it moves cannot drift apart.
     */
    if (
        object.type === "annotate" &&
        enggAnnotate.hasLeaderPath(
            object.annotateKind
        )
    ) {
        const path =
            enggAnnotate.leaderPathPoints(object);

        if (path.length >= 2) {
            const bends =
                Array.isArray(g.bends)
                    ? g.bends
                    : [];

            return [
                { kind: "annotate-attachment", point: path[0] },

                ...bends.map((bend, index) => ({
                    kind: `annotate-bend${index}`,
                    point: bend
                })),

                { kind: "annotate-endpoint", point: path[path.length - 1] }
            ];
        }
    }

    /*
     * An analysis object IS dragged, and the two halves of it stay in step.
     *
     * A Force Components and a Resultant are re-derived from their sources
     * on every refresh, so their geometry cannot simply be translated - the
     * next refresh would put them back where the source says they belong
     * and the drag would appear to do nothing. They carry a
     * `placementOffset` for that reason, and the refresh applies it to
     * whatever it derives, so the student's placement survives while the
     * numbers stay true.
     *
     * An earlier version of this file REFUSED to move them instead, on the
     * reasoning that a reading has no place of its own. That was the wrong
     * conclusion from a real observation: what it actually caught was a
     * double-translation that made them fly past the cursor, which is a bug
     * in the move and not a reason to take the feature away. Both faults
     * were in `translateObject` - the offset composed instead of being set,
     * and the geometry was translated on top of the caller's own
     * translation - and both are fixed there. The feature is draggable, and
     * it lands under the cursor.
     */

    /*
     * A Dimension likewise, but it moves by the offset the student
     * dragged, not by jumping to the pointer - the offset between the
     * measured geometry and the dimension line is what they chose, and
     * losing it would put the dimension back on top of the thing it
     * measures.
     */
    if (
        object.type === "dimension"
    ) {
        const graphics =
            safeDimensionGraphics(object);

        /*
         * THE HANDLE SITS ON THE DIMENSION'S TEXT.
         *
         * A dimension is moved to make its number legible, and the number is
         * the thing the student aims at - so the grab target IS the text.
         *
         * It used to be the dimension LINE's first point, which is at one end
         * of the line rather than under the number: pressing the text missed
         * the handle entirely, so a dimension could only be moved by first
         * selecting it and then pressing somewhere else. Using the text
         * anchor makes "press the number and drag it" work directly, and it
         * is the same point the renderer places the text at.
         */
        const anchor =
            graphics?.textAnchor ||
            graphics?.line?.[0] ||
            graphics?.arc?.[0];

        if (!anchor) {
            return [];
        }

        return [
            {
                kind: "annotation-offset",
                point: anchor
            }
        ];
    }

    if (object.type === "point") {
        return [
                {
                    kind: "position",
                    point: g.position || g.point || g
                }
            ];
    }

    if (object.type === "line") {
        return [
                { kind: "start", point: g.start },
                { kind: "end", point: g.end }
            ];
    }

    /*
     * Slender members and spans share the same two-end
     * handle layout as a line, so they reuse the start and
     * end drag kinds rather than a parallel set.
     *
     * A Truss is one feature with two real joints, so the
     * handles move those joints; the members its renderer
     * draws follow from them and the topology is preserved.
     */
    if (
        object.type === "beam" ||
        object.type === "truss" ||
        object.type === "cable" ||
        object.type === "shaft" ||
        object.type === "connection"
    ) {
        return [
                { kind: "start", point: g.start },
                { kind: "end", point: g.end }
            ];
    }

    /*
     * A Point Force is a vector, so its two handles are the
     * application point and the end of the arrow. Dragging
     * the start moves where the force acts; dragging the end
     * changes its direction and magnitude. The feature stays
     * one coherent force either way.
     */
    if (object.type === "force") {
        /*
         * The arrowhead handle sits WHERE THE ARROW IS DRAWN, not at the
         * stored end.
         *
         * The stored end is the engineering vector - exactly `magnitude`
         * from the application point - while the arrow is drawn at the
         * shared display scale. At 4x the two are four times apart, so a
         * handle at the stored end would float inside its own arrow, and
         * grabbing that dot would cut the force down to a quarter of what
         * is on screen.
         *
         * Asking the model where the arrow ends keeps the handle and the
         * arrow in the same place at every scale, without either of them
         * having to know how the other is drawn.
         */
        return [
            {
                kind: "start",
                point: g.start || g.position
            },
            {
                kind: "end",
                point: enggLoadProfile.drawnForceEnd(
                    drawingState,
                    g
                )
            }
        ];
    }

    /*
     * A Truss the student built is dragged by its joints.
     *
     * The members are rebuilt from the joint list when a joint
     * moves, so every member that met it follows and the
     * topology survives. A truss that has no stored joints
     * falls back to the two ends of its span.
     */
    if (
        object.type === "truss" &&
        Array.isArray(g.members) &&
        g.members.length
    ) {
        return trussJointHandles(g.members);
    }

    /*
     * A rigid body is one body whose outline can be any of the
     * supported shapes, so its handles follow whichever shape it
     * currently has: corners for a rectangle, a centre and a
     * radius for a circle, and vertices for a triangle or a
     * polygon. The points come from the shared geometry module,
     * which is the same source the renderer and the transforms
     * use, so a handle can never be left on the old shape.
     */
    if (object.type === "rigid-body") {
        return rigidBodyHandles(object);
    }

    if (object.type === "particle") {
        return [
            {
                kind: "position",
                point: g.position
            }
        ];
    }

    /*
     * A distributed load is defined by the span it acts on
     * and the intensity of that load, so it is manipulated
     * through its two ends plus a magnitude handle. The
     * rendered arrows are derived from these and are never
     * edited directly.
     */
    if (
        object.type === "load" ||
        object.type === "varying-load"
    ) {
        return loadHandles(object);
    }

    /*
     * A support acts at one point on a body and faces a
     * direction, so it has an attachment handle and an
     * orientation handle. Dragging the attachment moves the
     * support along its body while it stays attached.
     */
    if (isSupportType(object.type)) {
        return supportHandles(object);
    }

    /*
     * A connection is a joint between two bodies, so it is
     * manipulated through its two actual attachment points.
     */
    if (isConnectionType(object.type)) {
        return [
                { kind: "start", point: g.start },
                { kind: "end", point: g.end }
            ];
    }

    /*
     * An applied moment turns about its application point, so
     * that point is its handle.
     *
     * It is dragged by click-and-drag or by its position handle, which moves the
     * moment and changes nothing else about it.
     */
    if (
        object.type === "moment"
    ) {
        return [
                {
                    kind: "position",
                    point: g.position
                }
            ];
    }

    if (object.type === "circle") {
        return [
                { kind: "center", point: g.center },
                {
                    kind: "radius",
                    point: {
                        x: g.center.x + g.radius,
                        y: g.center.y
                    }
                }
            ];
    }

    if (object.type === "arc") {
        return [
                { kind: "center", point: g.center },
                {
                    kind: "startAngle",
                    point: {
                        x: g.center.x + g.radius * Math.cos(g.startAngle),
                        y: g.center.y + g.radius * Math.sin(g.startAngle)
                    }
                },
                {
                    kind: "endAngle",
                    point: {
                        x: g.center.x + g.radius * Math.cos(g.endAngle),
                        y: g.center.y + g.radius * Math.sin(g.endAngle)
                    }
                }
            ];
    }

    if (isRectangleLike(object)) {
        const corners = rectangleCorners(g).map(
            (point, index) => ({
                kind: `corner${index}`,
                point
            })
        );
        if (isPistonCylinder(object)) {
            const handles = [{ kind: "piston-height", point: cylinderPoint(g, 0.5, pistonFraction(g)) }, ...corners];
            if (g.hasStoppers) {
                handles.unshift(...[0.09, 0.91].map(x => ({
                    kind: "stopper-height", point: cylinderPoint(g, x, stopperFraction(g))
                })));
            }
            return handles;
        }
        return corners;
    }

    if (object.type === "triangle") {
        return (g.points || []).filter(Boolean).map(
            (point, index) => ({
                kind: `vertex${index}`,
                point
            })
        );
    }

    if (object.type === "polygon") {
        return enggDrawingState.polygonVertices(g).map(
            (point, index) => ({
                kind: `vertex${index}`,
                point
            })
        );
    }

    if (object.type === COORDINATE_SYSTEM_TYPE) {
        /*
         * One handle per axis end plus the origin, so each
         * of the four extensions can be dragged on its own
         * while the feature stays a single object.
         */
        const arms =
            coordinateSystemArms(g).map(
                arm => ({
                    kind: arm.kind,
                    point: arm.end
                })
            );

        arms.push({
            kind: "origin",
            point: g.origin
        });

        return arms;
    }

    if (Array.isArray(g.points)) {
        return g.points.map(
            (point, index) => ({
                kind: `vertex${index}`,
                point
            })
        );
    }

    return [];
}

/*
 * The panel's Feature Type for a feature that reuses another
 * feature's geometry for a different engineering role.
 *
 * A Reference Line IS a line, so it gets the Line's fields and
 * the Line's endpoint behaviour. Only the NAME it reports is
 * different, so that a reference line is not mistaken for a
 * drawn one in the panel. The geometry is still a line and
 * nothing about the editing model changes.
 */
export function staticsRoleLabel(
    object
) {
    const role =
        object?.engineering
            ?.staticsType;

    if (
        role === "reference-line" &&
        object.type === "line"
    ) {
        return "Reference Line";
    }

    return null;
}

/*
 * The four corners of a rectangle, honouring rotation.
 * position is the top-left corner and height extends
 * downward in world space.
 *
 * Shared with the feature-geometry registry so the handles,
 * the hit test and the transform all see the same corners.
 */
export function rectangleCorners(
    g
) {
    return enggFeatureGeometry.rectangleCorners(
        g
    );
}

/*
 * Find a handle of a selected object near the cursor.
 * Handles take priority over object bodies.
 */
export function handleAtPoint(
    point
) {
    const scale =
        enggDrawingState.BASE_PIXELS_PER_UNIT *
        drawingState.camera.zoom;

    const tolerance =
        MANIPULATION_PICK_PX /
        Math.max(scale, 1e-6);

    let best = null;

    drawingState.objects.forEach(
        object => {
            /*
             * A DIMENSION'S TEXT HANDLE IS ALWAYS LIVE.
             *
             * Every other handle belongs to a selected feature: you select a
             * beam, then drag its endpoint. A dimension's handle IS its text,
             * and the text is the thing the student sees and aims at - so
             * requiring a select first would mean "click the number, then
             * click it again to drag it", which is the second positioning
             * step the direct drag exists to remove. A press that does not
             * move still selects, so the two gestures stay distinct.
             */
            const selected =
                drawingState.selection.selectedObjectIds.includes(
                    object.id
                );

            if (
                !selected &&
                object.type !== "dimension"
            ) {
                return;
            }

            manipulationHandles(
                object
            ).forEach(
                handle => {
                    const distance =
                        Math.hypot(
                            handle.point.x - point.x,
                            handle.point.y - point.y
                        );

                    if (
                        distance <=
                        tolerance &&
                        (!best ||
                            distance <
                                best.distance)
                    ) {
                        best = {
                            object,
                            handle,
                            distance
                        };
                    }
                }
            );
        }
    );

    return best;
}

/*
 * Begin dragging a handle or an object body. Runs before
 * box-selection so a drag on a handle or a selected
 * object moves geometry instead of starting a box.
 *
 * Handles are draggable whenever they are visible, not
 * only while Select is active, so a shape can be nudged
 * straight after it is created.
 */
/*
 * Whether a construction is genuinely under way, as opposed to
 * a tool merely being armed and waiting for its first click.
 *
 * The phases that wait for MORE input are constructions in
 * progress: they already hold a point, a span or a partial
 * result, and the next click completes them. The phases that
 * wait for a FIRST click are not, because until that click
 * arrives nothing has been created and there is nothing for the
 * click to continue.
 *
 * A Modify session and an armed statics attachment both already
 * capture the pointer, and are checked before this, so they are
 * left out of the list deliberately.
 */
const CONSTRUCTION_ACTIVE_PHASES = [
    "first-point",
    "statics-span",
    "statics-attach",
    /* The Resultant / Force Components input-selection state. */
    "analysis-input",

    /*
     * The three steps of a distributed load. Each is listed because each
     * already holds something the student chose - the body, the start, the
     * region - so a click continues the construction rather than beginning
     * a new one. The vector step is the drag that fixes magnitude AND
     * direction together; the old magnitude and direction steps are gone.
     */
    "distributed-load-start",
    "distributed-load-end",
    "distributed-load-vector",

    "distributed-load-build",
    "distributed-load-span",
    "truss-construct",
    "polygon-centre",
    "polygon-first",
    "polygon-sides",
    "arc-centre",
    "arc-sweep",
    "arc-first",
    "arc-second",

    /*
     * The analysis axis placement.
     *
     * Listed here because it IS a running construction, and every
     * behaviour that keys off this set is then correct for it without
     * being told about it separately: the pointer belongs to the
     * placement rather than to a direct drag, Enter commits it, Escape
     * cancels it, and a click on an existing feature commits rather
     * than selects.
     */
    "analysis-axis",

    /*
     * A Moment being sized.
     *
     * A running construction like any other: the first click has
     * fixed the application point and the cursor is choosing how large
     * the arrow is drawn, so the pointer belongs to the placement and
     * not to a direct drag on whatever happens to be under it.
     */
    "moment-radius"
];

export function isConstructionInProgress() {
    const phase =
        drawingState.interaction?.phase;

    if (
        !phase ||
        phase === "idle"
    ) {
        return false;
    }

    if (phase === "coordinate-system-2d") {
        return false;
    }

    return CONSTRUCTION_ACTIVE_PHASES.includes(
        phase
    );
}
