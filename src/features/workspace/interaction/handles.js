/*
 * Manipulation handles: which grips a feature has, and which one is under the pointer.
 */

import enggFeatureGeometry from "../../../shared/geometry/feature-geometry.js";
import { coordinateSystemArms, rigidBodyHandles, rotationHandleFor } from "../../../shared/geometry/feature-handles.js";
import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggPipeDuct from "../model/fluids/pipe-duct.js";
import enggAnnotate from "../model/annotations/annotate-model.js";
import enggJunction from "../model/fluids/junction.js";
import enggFlowArrow from "../model/fluids/flow-arrow.js";
import enggReducer from "../model/fluids/reducer-expander.js";
import enggEquipment from "../model/fluids/inline-equipment.js";
import enggVessel from "../model/fluids/reservoir-tank.js";
import enggFluidLevel from "../model/fluids/fluid-level.js";
import enggFlowArrows from "../model/fluids/flow-arrows.js";
import enggPressureProfile from "../model/fluids/pressure-profile.js";
import enggFlowProfile from "../model/fluids/flow-profile.js";
import enggSectionPlane from "../model/fluids/section-plane.js";
import enggLoadProfile from "../model/analysis/load-profile.js";
import { COORDINATE_SYSTEM_TYPE } from "../constants.js";
import { drawingCanvas } from "../dom.js";
import { drawingState, editorState } from "../editor-state.js";
import { processLabelPoint } from "../model/thermodynamics/process-labels.js";
import { processBendPoint } from "../model/thermodynamics/process-curves.js";
import { cylinderPoint, isPistonCylinder, pistonFraction, stopperFraction } from "../model/thermodynamics/piston-cylinder.js";
import { isRectangleLike, safeDimensionGraphics } from "./hit-testing.js";
import { translateObject } from "../geometry/transforms.js";
import { selectionBounds } from "../../../shared/selection/selection-transform.js";
import { STATICS_BODY_TYPES, isConnectionType, isSupportType } from "../../../shared/model/feature-types.js";
import { dynamicsTypeOf } from "../dynamics/dynamics-tools.js";
import { DYNAMICS_SIZES } from "../dynamics/dynamics-tools.js";

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
                    : drag.elbowRuns?.[object.id]
                    ? {
                        /* A pipe the drag re-cut is restored with the fitting. */
                        ...JSON.parse(JSON.stringify(drag.elbowRuns[object.id])),
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
/*
 * A LOAD'S HANDLES: its two ends, and the tip of each defining arrow.
 *
 * Every arrow tip is placed where the arrow is DRAWN - its base plus the
 * load's drawn height for that intensity (`loadArrowReach`) - so the handle
 * sits on the arrowhead the student sees, for a uniform and a varying load
 * alike. Dragging one changes the drawn height (see statics-attachment.js);
 * the intensities are the load's values and are edited in Features.
 */
function loadHandles(
    object
) {
    const g = object.geometry;

    const handles = [
        { kind: "start", point: g.start },
        { kind: "end", point: g.end }
    ];

    const direction =
        enggLoadProfile.unitVector(
            enggLoadProfile.loadDirection(g)
        );

    enggLoadProfile
        .profilePoints(g)
        .forEach((point, index) => {
            const along =
                enggLoadProfile.pointAlong(
                    g,
                    point.t
                );

            const reach =
                enggLoadProfile.loadArrowReach(
                    g,
                    point.magnitude
                );

            handles.push({
                kind: `load-point${index}`,
                point: {
                    x: along.x + direction.x * reach,
                    y: along.y + direction.y * reach
                }
            });
        });

    return handles;
}

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

/*
 * THE DYNAMICS SYMBOL'S OWN GRIPS.
 *
 * Where the grips are, in one table keyed by the stored geometry rather than
 * by a second type dispatch: every field named here is written by
 * `dynamics-handles.js` when the grip is dragged and read by the renderer and
 * the source writer, so a drag cannot leave a handle describing geometry the
 * picture does not show.
 */
function dynamicsHandles(
    object,
    g
) {
    const handles = [];

    /* The two terminals of a span symbol. */
    if (g.start) {
        handles.push({ kind: "start", point: g.start });
    }

    if (g.end) {
        handles.push({ kind: "end", point: g.end });
    }

    /* A body drawn from its corners, or from a centre outwards. */
    if (g.center) {
        handles.push({ kind: "center", point: g.center });
    }

    if (g.position) {
        handles.push({ kind: "position", point: g.position });
    }

    if (Number.isFinite(Number(g.radius)) && g.center) {
        handles.push({
            kind: "dynamics-radius",
            point: {
                x: g.center.x + Number(g.radius),
                y: g.center.y
            }
        });
    }

    if (object.type === "particle" && g.position) {
        /* The marker's own size grip, on the marker's rim. */
        handles.push({
            kind: "dynamics-radius",
            point: {
                x: g.position.x + Number(g.markerRadius || DYNAMICS_SIZES.particleRadius),
                y: g.position.y
            }
        });
    }

    if (Number.isFinite(Number(g.amplitude)) && g.start && g.end) {
        /*
         * The coil height: at the span's midpoint, pushed out along its
         * normal by the current amplitude.
         */
        const dx = g.end.x - g.start.x;
        const dy = g.end.y - g.start.y;
        const length = Math.hypot(dx, dy) || 1;
        const middle = {
            x: (g.start.x + g.end.x) / 2,
            y: (g.start.y + g.end.y) / 2
        };

        handles.push({
            kind: "dynamics-amplitude",
            point: {
                x: middle.x - (dy / length) * Number(g.amplitude),
                y: middle.y + (dx / length) * Number(g.amplitude)
            }
        });
    }

    if (Number.isFinite(Number(g.bodyWidth)) && g.start && g.end) {
        /*
         * The damper body's width, at the point where the body sits along
         * the span (`bodyFrom`), so the grip sits ON the rectangle it
         * resizes.
         */
        const from = Number(g.bodyFrom) || 0.42;
        const along = {
            x: g.start.x + (g.end.x - g.start.x) * from,
            y: g.start.y + (g.end.y - g.start.y) * from
        };
        const dx = g.end.x - g.start.x;
        const dy = g.end.y - g.start.y;
        const length = Math.hypot(dx, dy) || 1;

        handles.push({
            kind: "dynamics-body-width",
            point: {
                x: along.x - (dy / length) * (Number(g.bodyWidth) / 2),
                y: along.y + (dx / length) * (Number(g.bodyWidth) / 2)
            }
        });
    }

    if (Number.isFinite(Number(g.ropeAngle)) && g.center && Number(g.radius)) {
        /* The rope's swing, at the point where the rope leaves the rim. */
        const radians = ((Number(g.ropeAngle) - 90) * Math.PI) / 180;

        handles.push({
            kind: "dynamics-rope",
            point: {
                x: g.center.x + Number(g.radius) * Math.cos(radians),
                y: g.center.y + Number(g.radius) * Math.sin(radians)
            }
        });
    }

    /*
     * A REFERENCE ARC IS THE EDITOR'S OWN ARC: centre and two angle ends,
     * in RADIANS, exactly as the ordinary arc's grips are placed.
     */
    if (
        object.type === "arc" &&
        g.center &&
        Number.isFinite(Number(g.radius)) &&
        Number.isFinite(Number(g.startAngle))
    ) {
        const centre = g.center;
        const radius = Number(g.radius);

        handles.push(
            {
                kind: "startAngle",
                point: {
                    x: centre.x + radius * Math.cos(Number(g.startAngle)),
                    y: centre.y + radius * Math.sin(Number(g.startAngle))
                }
            },
            {
                kind: "endAngle",
                point: {
                    x: centre.x + radius * Math.cos(Number(g.endAngle)),
                    y: centre.y + radius * Math.sin(Number(g.endAngle))
                }
            }
        );
    }

    if (object.type === "rigid-body") {
        /* A Dynamics rigid body keeps the body's own corner grips. */
        handles.push(...rigidBodyHandles(object));
    }

    return handles;
}

/*
 * ========================================================
 * THE ELBOW'S OWN HANDLES
 * ========================================================
 *
 * The radius handle sits at the middle angle of the bend, out on the OUTER
 * wall, so it is visually on the curve's belly - the conventional grip for a
 * bend. The angle handle sits on the corner itself, offset along the bend's
 * bisector, and is offered only while a free end can still define the angle.
 */
function elbowRadiusHandlePoint(object) {
    const curves = enggPipeDuct.elbowCurvesFor(object);

    if (!curves) {
        return null;
    }

    /*
     * THE CENTRE OF CURVATURE ITSELF - not the middle of the arc, not the
     * midpoint between the tangent points, and not a point on the wall. It is
     * the centre of the circle the bend's arc is drawn on, so dragging it
     * along the bisector IS the radius, and the dot always shows where the
     * circle is centred after the change.
     */
    return { x: curves.centre.x, y: curves.centre.y };
}

function elbowAngleHandle(object) {
    if (elbowConnectionState(object) === "connected") {
        return [];
    }

    const corner = object?.geometry?.position;

    if (!corner) {
        return [];
    }

    const scale = enggDrawingState.BASE_PIXELS_PER_UNIT * (drawingState.camera?.zoom || 1);

    const reach = 10 / Math.max(scale, 1e-6);

    const bisector = elbowBisectorOf(object);

    const curves = enggPipeDuct.elbowCurvesFor(object);

    const centreDistance = curves
        ? Math.hypot(curves.centre.x - corner.x, curves.centre.y - corner.y)
        : Infinity;

    const offset = bisector ? Math.min(reach, centreDistance * 0.5) : 0;

    const point = {
        x: corner.x + (bisector ? bisector.x * offset : 0),
        y: corner.y + (bisector ? bisector.y * offset : 0)
    };

    return [{ kind: "elbow-angle", point }];
}

/* The inward bisector of an elbow's two arms, or null. */
function elbowBisectorOf(object) {
    const geometry = object?.geometry || {};

    if (typeof enggPipeDuct.elbowBisector === "function") {
        return enggPipeDuct.elbowBisector(object);
    }

    const inArm = enggPipeDuct.directionOf(geometry.position, geometry.previous);
    const outArm = enggPipeDuct.directionOf(geometry.position, geometry.next);

    if (!inArm || !outArm) {
        return null;
    }

    const sum = { x: inArm.x + outArm.x, y: inArm.y + outArm.y };
    const length = Math.hypot(sum.x, sum.y);

    return length < 1e-9 ? null : { x: sum.x / length, y: sum.y / length };
}

/* How an elbow's ends are attached, from the pair of ids it records. */
function elbowConnectionState(object) {
    const ids = object?.engineering?.connections;

    const attached = Array.isArray(ids) ? ids.filter(Boolean).length : 0;

    if (attached >= 2) {
        return "connected";
    }

    return attached === 1 ? "partial" : "standalone";
}

function manipulationHandles(
    object
) {
    const g =
        object.geometry || {};

    if (object.metadata?.thermodynamicsKind === "process-path") {
        const scale = enggDrawingState.BASE_PIXELS_PER_UNIT * drawingState.camera.zoom;
        return (g.points || []).flatMap((point, index) => [
            { kind: `process-label-${index}`, point: processLabelPoint(g, index, scale) },
            { kind: `vertex${index}`, point },
            ...(index < g.points.length - 1 ? [{ kind: `process-bend-${index}`, point: processBendPoint(g, index) }] : [])
        ]);
    }

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

            const balloon = object.annotateKind === "callout" ? enggAnnotate.calloutBox(object, drawingState) : null;
            return [
                { kind: "annotate-attachment", point: path[0] },

                ...bends.map((bend, index) => ({
                    kind: `annotate-bend${index}`,
                    point: bend
                })),

                { kind: "annotate-endpoint", point: balloon ? {x:balloon.maxX,y:balloon.maxY} : path[path.length - 1] }
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

    /*
     * A DYNAMICS SYMBOL IS GRIPPED BY WHAT DEFINES IT.
     *
     * Every Dynamics feature carries its `dynamicsType`, and the handles are
     * read from the geometry it stores - the two terminals of a span symbol,
     * the centre of a pulley or a vector, the marker radius of a particle -
     * plus the symbol's own parameters (coil height, body width, rope
     * angle). The WHAT-a-drag-changes half lives in
     * `dynamics/dynamics-handles.js`, which writes these same fields.
     */
    if (dynamicsTypeOf(object) && object.type !== COORDINATE_SYSTEM_TYPE) {
        return dynamicsHandles(object, g);
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
    /*
     * A DRAWN TRUSS IS EDITED JOINT BY JOINT. It stores its own members, so
     * every joint gets a handle and dragging one carries each member that
     * meets it (`moveTrussJoint`). This is checked before the member branch
     * below: listed there, a truss only ever showed the two end handles of a
     * template truss and its joints could not be reached.
     */
    if (
        object.type === "truss" &&
        Array.isArray(g.members) &&
        g.members.length
    ) {
        return trussJointHandles(g.members);
    }

    if (
        object.type === "beam" ||
        object.type === "truss" ||
        object.type === "cable" ||
        object.type === "shaft" ||
        object.type === "connection" ||

        /*
         * A PIPE / DUCT RUN IS A STRAIGHT SPAN TOO. Its two handles are the
         * ends of its CENTRELINE, which is the run's authoritative geometry -
         * the two walls are generated from it, so a drag on either end
         * recalculates both walls and the spacing is preserved by construction.
         */
        object.type === "pipe-duct"
    ) {
        return [
                { kind: "start", point: g.start },
                { kind: "end", point: g.end }
            ];
    }

    /*
     * ========================================================
     * THE SCHEMATIC FLUIDS TOOLS' HANDLES
     * ========================================================
     *
     * Each handle has ONE purpose, and it writes the same model its Features
     * row writes - so a drag and a typed value are the same edit.
     *
     * The inline objects are placed by their host, so they get a POSITION handle
     * that SLIDES ALONG the host (never a free X/Y), and their size handles are
     * the parameters that belong to them (a transition length, a symbol radius).
     * A fluid level has one vertical handle; a direction arrow slides along its
     * pipe; a profile has a handle per data point and eight frame handles.
     */
    if (enggReducer.isReducerType(object.type)) {
        const walls = enggReducer.wallsOf(object);

        return walls
            ? [
                  { kind: "reducer-slide", point: walls.axis.centre },
                  { kind: "reducer-length-start", point: walls.start.centre },
                  { kind: "reducer-length-end", point: walls.end.centre },
                  { kind: "width-start", point: walls.start.a },
                  { kind: "width-end", point: walls.end.a }
              ]
            : [];
    }

    if (enggEquipment.isEquipmentType(object.type)) {
        const frame = enggEquipment.frameOf(object);

        if (!frame) {
            return [];
        }

        const inline = enggEquipment.isInline(object);

        const handles = [{ kind: inline ? "equipment-slide" : "equipment-body", point: frame.center }];

        const sizeAt = enggEquipment.localToWorld(frame, { x: enggEquipment.symbolRadiusOf(object), y: 0 });

        handles.push({ kind: "equipment-size", point: sizeAt });

        /*
         * A STANDALONE SYMBOL TURNS; an inline one lies along its pipe, so it has
         * no rotation grip - turning it there would break the run it joins.
         */
        if (!inline) {
            const radius = enggEquipment.symbolRadiusOf(object);

            handles.push({
                kind: "equipment-rotate",
                point: enggEquipment.localToWorld(frame, { x: 0, y: radius * 1.5 })
            });
        }

        return handles;
    }

    if (enggVessel.isVesselType(object.type)) {
        const rect = enggVessel.vesselRect(object);

        if (!rect) {
            return [];
        }

        const [topLeft, topRight, bottomRight, bottomLeft] = rect.corners;

        return [
            { kind: "vessel-corner0", point: topLeft },
            { kind: "vessel-corner1", point: topRight },
            { kind: "vessel-corner2", point: bottomRight },
            { kind: "vessel-corner3", point: bottomLeft },
            { kind: "equipment-body", point: rect.centre }
        ];
    }

    if (enggFluidLevel.isFluidLevelType(object.type)) {
        const segment = enggFluidLevel.levelSegment(object);

        return segment
            ? [
                  {
                      kind: "level-height",
                      point: {
                          x: (segment.start.x + segment.end.x) / 2,
                          y: (segment.start.y + segment.end.y) / 2
                      }
                  }
              ]
            : [];
    }

    if (enggFlowArrows.isFlowDirectionType(object.type)) {
        const fraction = enggFlowArrows.directionFractionOf(object);
        const at = enggFlowArrows.directionPointAt(object, fraction);

        return at ? [{ kind: "direction-slide", point: at.point }] : [];
    }

    /*
     * A FLOW PROFILE GETS THE SAME GRIPS as a Pressure Profile - eight frame
     * handles and one per data point - because it is the same frame model and
     * the same data-to-drawing mapping. A point's handle writes the ROW its
     * index names, so the table and the plotted point are one fact.
     */
    if (enggFlowProfile.isFlowProfileType(object.type)) {
        const frame = enggFlowProfile.profileFrame(object);

        if (!frame) {
            return [];
        }

        const corners = [
            { x: frame.position.x, y: frame.position.y },
            { x: frame.position.x + frame.width, y: frame.position.y },
            { x: frame.position.x + frame.width, y: frame.position.y + frame.height },
            { x: frame.position.x, y: frame.position.y + frame.height }
        ];

        const centre = {
            x: frame.position.x + frame.width / 2,
            y: frame.position.y + frame.height / 2
        };

        const points = enggFlowProfile.plottedPoints(object).map((plot) => ({
            kind: `profile-point${plot.index}`,
            point: { x: plot.x, y: plot.y }
        }));

        return [
            ...corners.map((point, index) => ({ kind: `profile-corner${index}`, point })),
            { kind: "equipment-body", point: centre },
            ...points
        ];
    }

    if (enggPressureProfile.isPressureProfileType(object.type)) {
        const frame = enggPressureProfile.profileFrame(object);

        if (!frame) {
            return [];
        }

        const corners = [
            { x: frame.position.x, y: frame.position.y },
            { x: frame.position.x + frame.width, y: frame.position.y },
            { x: frame.position.x + frame.width, y: frame.position.y + frame.height },
            { x: frame.position.x, y: frame.position.y + frame.height }
        ];

        const centre = {
            x: frame.position.x + frame.width / 2,
            y: frame.position.y + frame.height / 2
        };

        /*
         * A HANDLE PER DATA POINT, named by the row index - so the drag writes
         * the SAME row the Features table shows, whatever the table's order.
         */
        const points = enggPressureProfile.plottedPoints(object).map((plot) => ({
            kind: `profile-point${plot.index}`,
            point: { x: plot.x, y: plot.y }
        }));

        return [
            ...corners.map((point, index) => ({ kind: `profile-corner${index}`, point })),
            { kind: "equipment-body", point: centre },
            ...points
        ];
    }

    if (enggSectionPlane.isSectionPlaneType(object.type)) {
        const span = enggSectionPlane.sectionSpan(object);

        if (!span) {
            return [];
        }

        const centre = { x: (span.start.x + span.end.x) / 2, y: (span.start.y + span.end.y) / 2 };

        /*
         * A SECTION MARK HAS FOUR GRIPS AND THEY DO FOUR DIFFERENT THINGS:
         *
         *   the two ends   set the trace's length AND its angle
         *   the body       moves the whole marker
         *   the rotation   turns it about its middle, without moving it
         *
         * The rotation grip stands off the middle along the trace's normal, so it
         * is never mistaken for an end or for the body. The viewing direction is
         * NOT a grip - it is the Object section's Reverse, and reversing arrows
         * must not move the trace, which a drag cannot promise.
         */
        const normal = { x: -span.direction.y, y: span.direction.x };
        const reach = Math.max(4, Math.min(span.length * 0.5, 12));

        return [
            { kind: "start", point: span.start },
            { kind: "end", point: span.end },
            { kind: "section-body", point: centre },
            {
                kind: "section-rotate",
                point: { x: centre.x + normal.x * reach, y: centre.y + normal.y * reach }
            }
        ];
    }

    /*
     * A FREE FLOW ARROW IS A SPAN: its tail and its tip. The attached one above
     * keeps the two handles it has always had.
     */
    if (enggFlowArrows.isFreeFlowArrowType(object.type) && !object.attachment && g.start && g.end) {
        return [
            { kind: "start", point: g.start },
            { kind: "end", point: g.end }
        ];
    }

    /*
     * A FLOW ARROW IS GRABBED BY ITS TIP AND BY ITS SIZE.
     *
     * The POSITION handle is the arrow's TIP: dragging it slides the whole arrow
     * along its host pipe's centreline, because the tip is constrained to the
     * run by the drag handler and the rest of the arrow follows the anchor. There
     * is deliberately no rotation handle and no free-body handle: the arrow's
     * orientation is its pipe's, and moving the pipe is the pipe's own edit.
     *
     * The SIZE handle sits at the tip too, offset ACROSS the run, so the two are
     * distinguishable on the canvas: the position handle is where the arrow
     * points, the size handle is beside it. Dragging the size handle changes
     * `attachment.size` and nothing else - the pipe is never touched.
     */
    if (object.type === "flow-arrow") {        const shape = enggFlowArrow.flowArrowShape(object);

        if (!shape) {
            return [];
        }

        /*
         * THE SIZE HANDLE SITS BEHIND THE TAIL, ON THE ARROW'S OWN AXIS.
         *
         * The arrow is a shaft with a small head, so the distance from the
         * anchor to the tail IS the size that will be committed - which makes
         * the handle honest: dragging it out lengthens the arrow, dragging it
         * in shortens it, and the head stays a quarter of whatever it becomes.
         *
         * It is offset slightly ACROSS the run as well, so it is distinguishable
         * from the stem it sits on.
         */
        const back = { x: -shape.axis.x, y: -shape.axis.y };

        return [
            { kind: "flow-arrow-position", point: shape.anchor },
            {
                kind: "flow-arrow-size",
                point: {
                    x: shape.shaft.start.x + back.x * 4 + shape.across.x * 4,
                    y: shape.shaft.start.y + back.y * 4 + shape.across.y * 4
                }
            }
        ];
    }

    /*
     * A JUNCTION IS GRABBED BY ITS HUB AND BY EACH BRANCH'S PORT.
     *
     * The hub moves the whole fitting. Each port is BOTH the point a pipe
     * connects to AND the point that sets that branch's angle: dragging it
     * around the hub turns the branch. There is deliberately no handle that
     * changes a branch's LENGTH - the arms are connection stubs.
     *
     * The main run's two ports turn the FITTING, because their direction IS
     * the reference every branch angle is measured from.
     */
    if (object.type === "junction" && g.position) {
        const handles = [{ kind: "position", point: g.position }];

        (g.branches || []).forEach((branch) => {
            const port = enggJunction.branchPort(object, branch);

            if (!port) {
                return;
            }

            handles.push({
                kind: branch.id === g.mainBranchId ? "junction-main" : "junction-branch-" + branch.id,
                point: port
            });
        });

        return handles;
    }

    /*
     * AN ELBOW IS GRABBED BY WHAT DEFINES ITS BEND.
     *
     * The corner moves the fitting; each end is a point the student can drag
     * (and reconnect); and the BEND RADIUS gets a handle of its own, placed
     * between the corner and the outer wall at the MIDDLE of the arc, so it is
     * grabbed where the curve is rather than on an axis that means nothing to a
     * bend. There is deliberately NO rotation handle: orientation is decided by
     * the pipes, and the specification calls for no Rotate control.
     *
     * A FITTING WITH NO ENDS - one written by an older file as three points - keeps
     * the corner handle it always had.
     */
    if (object.type === "elbow" && g.position) {
        const ends = g.ends?.a && g.ends?.b ? [g.ends.a, g.ends.b] : null;

        /*
         * THE RADIUS HANDLE BELONGS TO EVERY ELBOW, MANUAL OR GENERATED.
         *
         * Its position comes from the fitting's own arc, not from its ends, so a
         * generated elbow - whose arms are its pipes and which stores no `ends` -
         * gets one too. Without it a radius could only be changed by typing, and
         * the student would have no grip on the bend at all.
         */
        const radiusHandle = elbowRadiusHandlePoint(object);

        if (!ends) {
            return [
                { kind: "position", point: g.position },
                ...(radiusHandle ? [{ kind: "elbow-radius", point: radiusHandle }] : [])
            ];
        }

        return [
            { kind: "start", point: ends[0] },
            { kind: "end", point: ends[1] },
            { kind: "position", point: g.position },
            ...(radiusHandle ? [{ kind: "elbow-radius", point: radiusHandle }] : []),
            ...elbowAngleHandle(object)
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
 * ========================================================
 * EVERY EDITING HANDLE A SELECTED OBJECT HAS
 * ========================================================
 *
 * The shape-edit handles plus, when the object may be turned, the one
 * rotation handle. This is the ONE list the renderer draws and the ONE list
 * the hit test searches, so a handle can never be shown without being
 * grabbable, or grabbable without being shown.
 *
 * WHAT IS NOT OFFERED:
 *
 *   FIXED      a locked feature keeps its selection highlight but no
 *              handle at all - not even the rotation handle - so the lock
 *              is visibly absolute rather than only enforced on drag.
 *
 *   DERIVED    a Resultant or a Force Components pair is re-derived from
 *              its sources, so the rotation handle is not offered: turning
 *              it would be undone by the next refresh. (These types also
 *              carry their own engineering fields which a turn would have
 *              to keep consistent, and the presentation rotation they DO
 *              have is exposed through Transform.)
 *
 *   LABELS AND ANNOTATIONS have a placement rather than a shape, and a
 *              turn of a piece of text about its own centre is not a
 *              gesture the panel offers, so they are left with the handles
 *              they already have.
 *
 * Everything else that is selected and not locked gets the rotation handle.
 * A Particle, a Reference Point and a Coordinate System keep their anchor:
 * their rotation is about that anchor, which is what `rotationPivotFor`
 * returns.
 */
export function editableHandlesFor(
    object
) {
    if (!object || object.locked === true) {
        return [];
    }

    const shape =
        manipulationHandles(object);

    if (!supportsRotationHandle(object)) {
        return shape;
    }

    const box =
        selectionBounds(
            [object],
            [object.id],
            drawingState
        );

    const scale =
        enggDrawingState.BASE_PIXELS_PER_UNIT *
        (drawingState.camera?.zoom || 1);

    const rotation =
        rotationHandleFor(
            object,
            box,
            scale
        );

    return rotation
        ? [...shape, rotation]
        : shape;
}

/*
 * May this feature be turned by the rotation handle?
 *
 * A derived analysis child is excluded for the reason above; a dimension
 * and an annotation are excluded because their stored model is a placement
 * rather than a shape. Every other feature on the sheet turns.
 */
function supportsRotationHandle(
    object
) {
    if (!object || !object.geometry) {
        return false;
    }

    if (enggReducer.isReducerType(object.type)) return !enggReducer.connectedPipeIds(object).some(Boolean);

    return ![
        "dimension",
        "annotation",
        "annotate",
        "resultant",
        "force-components",

        /*
         * AN ELBOW HAS NO ROTATION HANDLE. Its orientation is decided by the
         * pipes it joins, and the specification gives it exactly four Transform
         * parameters - X Shift, Y Shift, Bend Radius and Bend Angle - none of
         * which is a rotation.
         */
        "elbow",

        /*
         * A JUNCTION HAS NO ROTATION HANDLE EITHER: its orientation is its
         * MAIN RUN, which the branches are measured from.
         */
        "junction",

        /*
         * A FLOW PROFILE IS A FLAT GRAPH - its frame is axis-aligned, and a turn
         * would rotate the tick text with it. It is listed with the objects that
         * do not turn, so a handler cannot appear for it.
         */
        "flow-profile",

        /*
         * A FLOW ARROW HAS NO ROTATION HANDLE. Its orientation IS its pipe's,
         * and turning it would describe a flow direction the run does not have.
         * The one way to change what it says is Reverse Direction, which is a
         * half turn with a meaning - and it is a plain boolean rather than an
         * angle, so it cannot leave the arrow at some angle off its run.
         */
        "flow-arrow",

        /*
         * AND THE SCHEMATIC TOOLS THAT TURN WITH THEIR HOST. A reducer's axis is
         * its pipe's, a fluid level is horizontal inside its vessel and a
         * direction arrow points along its run - so none of them offers a free
         * turn. A pressure profile, a section trace and a VESSEL do turn, which
         * is why they are not here.
         */
        "reducer-expander",
        "fluid-level",
        "flow-direction-diagram"
    ].includes(object.type);
}

/*
 * The pivot a single object turns about when the rotation handle is dragged.
 *
 * A Coordinate System turns about its ORIGIN, which is the thing it is
 * anchored at; a Particle and a Reference Point keep their anchor too, so a
 * turn moves only their attached graphics/labels. Everything else turns
 * about its own centre. This mirrors `pivotForObject` in the Transform
 * session, which is what keeps the handle and the Rotate field the same
 * operation.
 */
export function rotationPivotFor(
    object
) {
    const geometry =
        object?.geometry || {};

    if (
        object?.type === COORDINATE_SYSTEM_TYPE &&
        geometry.origin
    ) {
        return {
            x: geometry.origin.x,
            y: geometry.origin.y
        };
    }

    if (
        object?.type === "particle" ||
        object?.type === "point"
    ) {
        const anchor =
            geometry.position ||
            geometry.point;

        if (anchor) {
            return {
                x: anchor.x,
                y: anchor.y
            };
        }
    }

    return enggFeatureGeometry.centerOf(
        geometry,
        object?.type
    );
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
                object.type !== "dimension" && object.metadata?.thermodynamicsKind !== "process-path"
            ) {
                return;
            }

            /*
             * THE SAME LIST THE RENDERER DRAWS.
             *
             * Shape handles AND, for a selected transformable feature, the
             * rotation handle. Using one resolver for both is what keeps a
             * visible handle grabbable and a grabbable handle visible.
             */
            (selected
                ? editableHandlesFor(object)
                : manipulationHandles(object)
            ).forEach(
                handle => {
                    if (!selected && object.metadata?.thermodynamicsKind === "process-path" && !handle.kind.startsWith("process-label-")) return;
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

    /*
     * A PIPE / DUCT LEG BEING DRAGGED.
     *
     * Listed here because it IS a running construction: the press has set the
     * start, so the pointer belongs to the run rather than to a direct drag on
     * whatever happens to be under it - and Enter finishes the path while
     * Escape drops the leg, without either key being told about the run
     * separately, which is the whole reason this set exists. The string matches
     * `ROUTE_PHASE` in pipe-duct-tool.js.
     */
    "pipe-duct-construct",

    /*
     * AN ELBOW BEING DRAGGED. A running construction like the run's own: the
     * press has fixed the first end, so the pointer belongs to the fitting and
     * Escape drops it rather than deselecting something else.
     */
    "elbow-construct",

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
