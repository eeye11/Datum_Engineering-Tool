/*
 * ========================================================
 * MOVING A SELECTION ONE STEP, IN A DIRECTION
 * ========================================================
 *
 * The arrow keys ask a feature to move a step up, down, left or right. What
 * that means depends on the FEATURE, not on the key:
 *
 *     a free feature        moves freely in the requested direction
 *     a child on a parent   moves only along that parent, staying attached
 *     a fixed / locked one  does not move
 *     a derived child       does not move directly - its parent does
 *
 * THE ONE RULE THAT MUST NEVER BREAK: moving an attached feature must never
 * detach it from its parent. A force on a beam must stay a force on THAT beam,
 * a support must stay pinned to its member, and pressing an arrow a hundred
 * times must not walk something off the geometry it belongs to.
 *
 * WHY THIS IS NOT A SWITCH ON FEATURE TYPE
 * ----------------------------------------
 * The temptation is `if (type === "force") ... if (type === "support") ...`, and
 * it is wrong for the same reason the drag code refuses it: the question is not
 * WHAT the feature is but WHERE it is attached, and what shape that parent has.
 * So this module asks, in order:
 *
 *   1. is it movable at all?   (capability: derived / locked / pinned)
 *   2. does it have a parent?  (relation: parentId -> a body with a frame)
 *   3. what does that parent allow?  (its centreline, or its own position)
 *
 * and then projects the requested step onto whatever that parent permits. A
 * curved or inclined parent therefore needs no special case here: the available
 * degrees of freedom come from the parent's own geometry, and the step is
 * projected onto them.
 *
 * IT REUSES THE DRAG'S OWN PATHS. A support is repositioned by the same
 * attachment-fraction rule, a force by the same station along its body, and a
 * free feature by the same `translateObject`. Arrow movement and mouse
 * movement are two ways to ask the same question, so they must not answer it
 * differently.
 */

import enggBodyFrames from "../../../shared/geometry/body-frames.js";
import enggFeatureGeometry from "../../../shared/geometry/feature-geometry.js";
import enggDrawingState from "../../../shared/model/drawing-state.js";
import { isDerivedFeature, isSupportType } from "../../../shared/model/feature-types.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { drawingState } from "../editor-state.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";

/*
 * HOW FAR ONE STEP MOVES A FEATURE, in MILLIMETRES.
 *
 * In millimetres and not in world units, because that is the unit the student
 * thinks in and the unit the scale converts: the step is the same physical
 * distance whatever the sheet is calibrated to, and the same at every zoom. A
 * world-unit step would move a feature twice as far on a 1:2 sheet as on a
 * 1:1 one for no reason the student could see.
 */
export const ARROW_STEP_MM = 5;

/*
 * The step, in WORLD units, for the current document.
 *
 * Derived from the shared scale on every press rather than stored, so an
 * uncalibrated sheet (one world unit = one millimetre) and a calibrated one
 * both move by the same real distance.
 */
/*
 * One arrow-key step, in drawing units. (It used to be converted through the
 * sheet's world scale; that system is retired, and a drawing unit is the
 * millimetre on the sheet.)
 */
function stepWorld() {
    return ARROW_STEP_MM;
}

/*
 * Whether a feature may be moved by the arrow keys at all.
 *
 * Three refusals, and each is a real engineering state rather than a
 * limitation:
 *
 *   DERIVED   a Resultant and a Force Components pair are computed from their
 *             source force. Moving one would either be wiped by the next
 *             refresh or survive as a lie; the control is the SOURCE force.
 *   LOCKED    the feature's own Lock, which exists precisely to stop it being
 *             moved while the student works around it.
 *   FIXED     a coordinate pinned by the Features panel's X/Y constraint, so
 *             the axis the student constrained is not the arrow's to move.
 */
export function isMovableByArrows(object) {
    if (!object) {
        return false;
    }

    if (isDerivedFeature(object)) {
        return false;
    }

    if (object.locked === true) {
        return false;
    }

    return true;
}

/*
 * The body a feature is attached to, or null.
 *
 * Read from `parentId` - the relationship the Feature Tree nests by - so this
 * is the same parent the panel names and the drag honours, never a guess from
 * proximity.
 */
function parentOf(object) {
    if (!object?.parentId) {
        return null;
    }

    return (
        drawingState.objects.find(
            (candidate) =>
                candidate.id === object.parentId
        ) || null
    );
}

/*
 * The features attached to a parent, by its id.
 *
 * The complement of `parentOf`: a body's own children. Read from the same
 * relationship, so a feature that names this parent is carried by it and
 * nothing else is.
 */
function childrenOf(parentId) {
    return drawingState.objects.filter(
        (candidate) =>
            candidate.parentId === parentId
    );
}

/*
 * ========================================================
 * MOVING A CHILD ALONG ITS PARENT
 * ========================================================
 *
 * A child of a body - a force, a load, a moment, a support - is positioned BY
 * that body: it has a place along the member, and the member's own direction
 * decides which way "along" even is. So an arrow step is PROJECTED onto the
 * member's axis:
 *
 *     the requested (dx, dy)
 *       -> how far that is ALONG the member
 *       -> the child moves that far along, and nowhere else
 *
 * A horizontal beam therefore accepts Left and Right and refuses Up and Down
 * (their projection along it is zero), a vertical beam accepts Up and Down, and
 * an inclined beam accepts a step that genuinely follows it. For a CURVED
 * parent the same projection is made against the tangent AT THE CHILD'S PLACE,
 * so the movement follows the curve locally rather than leaving it.
 *
 * Returns true when the child was moved.
 */
function moveAlongParent(object, parent, stepX, stepY) {
    const frame = enggBodyFrames.frameOf(parent);

    if (!frame || !(frame.length > 1e-9)) {
        /*
         * THE PARENT HAS NO SPAN - a particle, a point, a rigid body's centre.
         * The only relationship such a parent can state is "stay with me", so
         * the child moves with it in world space rather than along an axis.
         */
        enggFeatureGeometry.translateObject(object, stepX, stepY);

        return true;
    }

    /*
     * THE STEP ALONG THE MEMBER is the requested movement projected onto the
     * member's own axis. A step perpendicular to the member projects to zero,
     * which is exactly what "this direction is not available" means - so an Up
     * arrow on a horizontal beam does nothing, and cannot detach the child.
     */
    const along = stepX * frame.tangent.x + stepY * frame.tangent.y;

    if (Math.abs(along) < 1e-12) {
        return false;
    }

    const geometry = object.geometry || {};

    /*
     * A SUPPORT STORES A FRACTION of the member, which is the representation
     * that survives a resize; so its own path is used rather than the generic
     * one, and the support stays outside its member at the new place.
     */
    if (isSupportType(object.type)) {
        const current =
            enggBodyFrames.attachmentPoint(
                frame,
                geometry.attachment
            ) || geometry.position;

        if (!current) {
            return false;
        }

        const distance = Math.min(
            frame.length,
            Math.max(
                0,
                enggBodyFrames.positionOn(frame, {
                    x: current.x + frame.tangent.x * along,
                    y: current.y + frame.tangent.y * along
                })
            )
        );

        const moved =
            enggBodyFrames.pointAt(frame, distance);

        geometry.attachment =
            enggBodyFrames.attachmentFor(frame, moved);

        geometry.distanceAlongBody = distance;

        const placement =
            enggBodyFrames.supportPlacement(
                parent,
                moved,
                geometry.flipped === true
            );

        if (placement) {
            geometry.position = placement.render;
        }

        return true;
    }

    /*
     * EVERY OTHER CHILD - a force, a load, a moment - is moved by translating
     * its stored geometry along the member's direction. Its attachment fraction
     * is re-derived from its new place, so the relationship is written, not
     * merely implied.
     */
    enggFeatureGeometry.translateObject(
        object,
        frame.tangent.x * along,
        frame.tangent.y * along
    );

    const anchor =
        geometry.position ||
        geometry.start;

    if (anchor) {
        geometry.attachment =
            enggBodyFrames.attachmentFor(frame, anchor);
    }

    return true;
}

/*
 * ========================================================
 * THE MOVE ITSELF
 * ========================================================
 *
 * Apply one step to the whole selection.
 *
 * A PARENT AND ITS CHILD BOTH SELECTED MOVE ONCE. The child is a consequence of
 * the parent, so moving both would move the child twice - once with its parent
 * and once on its own - and its position along the parent would drift by a step
 * on every press. The child is therefore skipped whenever its parent is also in
 * the selection, and the parent's own move carries it, which is what keeps the
 * relationship exactly as it was.
 */
function applyStep(stepX, stepY) {
    const selected =
        drawingState.selection.selectedObjectIds || [];

    const selectedSet =
        new Set(selected);

    let moved = 0;

    selected
        .map(
            (id) =>
                drawingState.objects.find(
                    (object) => object.id === id
                ) || null
        )
        .forEach((object) => {
            if (!object || !isMovableByArrows(object)) {
                return;
            }

            const parent = parentOf(object);

            /*
             * THE CHILD IS CARRIED BY ITS PARENT when both are selected, so it
             * is not moved here - moving it as well would double its step.
             */
            if (parent && selectedSet.has(parent.id)) {
                return;
            }

            if (parent) {
                if (moveAlongParent(object, parent, stepX, stepY)) {
                    moved += 1;
                }

                return;
            }

            /*
             * A FREE FEATURE MOVES FREELY, through the same translation every
             * other move uses - AND IT CARRIES ITS OWN CHILDREN.
             *
             * A beam's loads, supports and forces belong to the beam: move the
             * member and they must move with it, or they are left at stale world
             * coordinates claiming to be attached to a member that has gone. This
             * is the same rule `moveObjectAndChildren` applies to a body drag, so
             * the arrow and the hand move a body identically.
             *
             * A CHILD THAT IS ALSO SELECTED IS NOT MOVED TWICE. It was skipped
             * above precisely so that its ONLY movement is the one it inherits
             * here - which is what keeps its station on the parent unchanged.
             */
            enggFeatureGeometry.translateObject(
                object,
                stepX,
                stepY
            );

            childrenOf(object.id).forEach((child) => {
                if (!isMovableByArrows(child)) {
                    return;
                }

                enggFeatureGeometry.translateObject(
                    child,
                    stepX,
                    stepY
                );
            });

            moved += 1;
        });

    return moved;
}

/*
 * ========================================================
 * THE PUBLIC ENTRY POINT
 * ========================================================
 *
 * One step in a direction, for the current selection. `direction` is one of
 * "up", "down", "left", "right".
 *
 * ONE UNDO ENTRY per press, so Ctrl+Z takes back the step the student just
 * made - not the whole run of them, and not nothing. The snapshot is taken
 * before anything moves and committed only when something actually did.
 */
export function nudgeSelection(direction) {
    if (!drawingState.selection.selectedObjectIds?.length) {
        return false;
    }

    const step = stepWorld();

    const vector = {
        up: { x: 0, y: step },
        down: { x: 0, y: -step },
        left: { x: -step, y: 0 },
        right: { x: step, y: 0 }
    }[direction];

    if (!vector) {
        return false;
    }

    const previous =
        enggDrawingState.snapshotDrawing(drawingState);

    const moved = applyStep(vector.x, vector.y);

    if (!moved) {
        /*
         * NOTHING COULD MOVE - every selected feature is locked, derived, or
         * constrained against that direction - so nothing is committed and the
         * student is told why rather than left wondering.
         */
        setToolMessage(
            "Nothing to move - the selection is fixed, derived, or constrained in that direction"
        );

        return false;
    }

    const dragged =
        JSON.parse(
            JSON.stringify(drawingState.objects)
        );

    enggDrawingState.commitDrawingChange(
        drawingState,
        previous
    );

    drawingState.objects = dragged;

    /*
     * THE PANEL FOLLOWS THE CANVAS. A moved child's Relative X and a moved
     * body's coordinates are recomputed from the model on the next render, so
     * the two cannot disagree about where the feature now is.
     */
    renderProperties();
    renderCurrentDrawing();

    setToolMessage(
        `Moved ${moved} feature${moved === 1 ? "" : "s"}`
    );

    return true;
}

const enggArrowMovement = {
    ARROW_STEP_MM,
    isMovableByArrows,
    nudgeSelection
};

export default enggArrowMovement;
