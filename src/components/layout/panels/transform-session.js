/*
 * ============================================================
 * THE FEATURES PANEL'S TRANSFORM
 * ============================================================
 *
 * X Shift, Y Shift and Rotate are RELATIVE adjustments: a click on an arrow is
 * "move this 0.1 to the right", and a number typed into the field is "move it
 * that far", never "put it at this coordinate". So the fields are not readings
 * of the object - they are a small, disposable offset box that is applied and
 * then cleared.
 *
 * WHAT A TRANSFORM DOES.
 *
 * It moves the objects that moved before this panel existed, through the same
 * machinery every other move uses: the shared feature-geometry registry for
 * translation, and a group rotation about the selection's own centre. If a
 * drag can move it, Transform can; if a drag cannot, Transform is not offered.
 * That one rule keeps the canvas, the source and this panel from disagreeing
 * about what a rotation is.
 *
 * WHAT IT DOES NOT DO.
 *
 * A FIXED object is held, and holds are absolute: transforming the other
 * selected objects must not drag a fixed one along with them. So fixed objects
 * are skipped, individually, rather than the whole operation being refused.
 * The pane still shows the controls - so the student can see what is selected -
 * and the arrows report that nothing moved.
 *
 * ONE CLICK, ONE HISTORY ENTRY. Each increment is snapshotted, applied and
 * committed, so Undo steps back one nudge at a time; a typed value commits once,
 * at the value the student entered.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggFeatureGeometry from "../../../shared/geometry/feature-geometry.js";
import { drawingState } from "../../../features/workspace/editor-state.js";
import { activeSourceManager } from "../../../shared/rendering/latex/drawing-source-manager.js";
import { renderCurrentDrawing } from "../workspace/canvas-render.js";

/* The increment every arrow applies, and the precision the fields are read at. */
export const TRANSFORM_STEP = 0.1;

/* Floating-point noise is a display problem, not a geometry problem. */
export function tidy(value) {
    return Math.round(Number(value) * 1e9) / 1e9;
}

/*
 * TELL THE SOURCE THAT SEVERAL OBJECTS MOVED AT ONCE.
 *
 * Committing an edit hands the source layer the SELECTED object to rewrite, and
 * the panel-side sink answers with the first selected id. That is right for one
 * object, but a GROUP transform moves several - and during one, a fixed selected
 * object did not move at all. Rewriting either one region would leave the others
 * stale.
 *
 * So each transform marks the source as a whole-document change once, before the
 * geometry moves. The rewrite is synchronous, so the mark is drained by the
 * commit that follows - the source is regenerated from the model that has just
 * changed, and there is no second copy of "which objects moved" for the two
 * layers to disagree about.
 */
function detachSourceSync() {
    const manager = activeSourceManager();

    if (manager && typeof manager.markDirty === "function") {
        manager.markDirty();
    }
}

/*
 * The objects a transform applies to: the selected ones that the registry can
 * actually move, minus the fixed ones. Returned in document order so a group
 * rotation is computed from a stable list.
 */
export function transformableObjects() {
    const ids = new Set(drawingState.selection.selectedObjectIds);

    return drawingState
        .objects.filter((object) => ids.has(object.id))
        .filter((object) => object.locked !== true)
        .filter((object) => {
            if (!object.geometry) {
                return false;
            }

            /*
             * Ask the registry, on a copy, whether it would move anything. This
             * is the same probe the Features schema uses to decide whether to
             * offer Transform, so the control and the action cannot disagree.
             */
            const probe = {
                ...object,
                geometry: JSON.parse(JSON.stringify(object.geometry)),
                style: { ...(object.style || {}) }
            };

            try {
                enggFeatureGeometry.translateObject(probe, 0.5, 0.5, () => null);
            } catch {
                return false;
            }

            return JSON.stringify(probe.geometry) !== JSON.stringify(object.geometry);
        });
}

/* ============================================================
 * APPLYING A TRANSFORM
 * ============================================================ */

/*
 * Translate every transformable selected object by a delta. Answers the number
 * of objects that actually moved.
 */
export function shiftSelection(deltaX, deltaY) {
    const state = drawingState;
    const targets = transformableObjects();

    if (!state || !targets.length) {
        return 0;
    }

    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
        return 0;
    }

    const previous = enggDrawingState.snapshotDrawing(state);

    detachSourceSync();

    targets.forEach((object) => {
        enggFeatureGeometry.translateObject(object, deltaX, deltaY, (id) =>
            state.objects.find((candidate) => candidate.id === id) || null
        );
    });

    enggDrawingState.commitDrawingChange(state, previous);

    renderCurrentDrawing();

    return targets.length;
}

/* ============================================================
 * ROTATION
 * ============================================================ */

/*
 * The point a single object turns about. A Coordinate System has a defined
 * origin and that is its pivot; everything else turns about its own centre.
 */
function pivotForObject(object) {
    const geometry = object.geometry || {};

    if (object.type === "coordinate-system-2d" && geometry.origin) {
        return { x: geometry.origin.x, y: geometry.origin.y };
    }

    return enggFeatureGeometry.centerOf(geometry, object.type);
}

/*
 * Where the geometry of one object is, as a flat list of its defining points.
 * The rotation below turns exactly these, so it does not need a branch per
 * feature type and cannot leave a corner behind.
 */
function rotationEditsFor(object, pivot, radians) {
    /*
     * ONE ROTATION FOR THE WHOLE APPLICATION.
     *
     * This used to walk the defining points itself, which meant the Transform
     * field turned a force's points but left its stored `angle` behind, and a
     * support's position but not its `orientation`. The canvas rotation handle
     * goes through the geometry registry's `rotateObjectAbout`, which turns the
     * points AND advances the stored directions - so the two routes now share
     * that one function and cannot disagree about what a rotation is.
     */
    enggFeatureGeometry.rotateObjectAbout(object, pivot, radians);
}

/*
 * Rotate the selection. ONE object turns about its own pivot; SEVERAL turn as a
 * group about the centre of everything that will move, so their relative layout
 * is preserved.
 */
export function rotateSelection(degrees) {
    const state = drawingState;
    const targets = transformableObjects();

    if (!state || !targets.length || !Number.isFinite(degrees)) {
        return 0;
    }

    const radians = (degrees * Math.PI) / 180;

    let pivot;

    if (targets.length === 1) {
        pivot = pivotForObject(targets[0]);
    } else {
        /*
         * The group's centre is the mean of its pivots - not of its bounding box
         * - so one long member does not pull the turn towards its far end.
         */
        const pivots = targets.map(pivotForObject).filter(Boolean);

        if (!pivots.length) {
            return 0;
        }

        pivot = {
            x: pivots.reduce((total, point) => total + point.x, 0) / pivots.length,
            y: pivots.reduce((total, point) => total + point.y, 0) / pivots.length
        };
    }

    if (!pivot) {
        return 0;
    }

    const previous = enggDrawingState.snapshotDrawing(state);

    detachSourceSync();

    targets.forEach((object) => rotationEditsFor(object, pivot, radians));

    enggDrawingState.commitDrawingChange(state, previous);

    renderCurrentDrawing();

    return targets.length;
}

/* ============================================================
 * THE THREE ADJUSTMENTS, BY NAME
 * ============================================================
 *
 * The pane speaks in field keys; this table is the one place that translates
 * "x" into a horizontal move. An unknown key does nothing, so a control with a
 * stale key cannot fall through into some other transform.
 */
export function applyTransform(axis, amount) {
    const value = Number(amount);

    if (!Number.isFinite(value) || value === 0) {
        return 0;
    }

    if (axis === "x") {
        return shiftSelection(value, 0);
    }

    if (axis === "y") {
        /*
         * DRAWING SPACE IS CARTESIAN AND SCREEN SPACE IS NOT.
         *
         * The geometry stores y upwards, the pointer reports y downwards, and
         * the canvas flips between them when it draws. "Move up" therefore means
         * positive y in the document, which is what the object model and the
         * source both use - so this needs no sign of its own, and the arrow
         * labelled up really moves the feature up.
         */
        return shiftSelection(0, value);
    }

    if (axis === "rotate") {
        return rotateSelection(value);
    }

    return 0;
}

export default {
    TRANSFORM_STEP,
    tidy,
    transformableObjects,
    shiftSelection,
    rotateSelection,
    applyTransform
};
