import enggReducer from "../../../features/workspace/model/fluids/reducer-expander.js";
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
import { adjustElbowRadius, setPipeWidth, wouldMove } from "./feature-schema.js";
import { propagatePipeWidth, reconcileFluidConnections } from "../../../features/workspace/interaction/pipe-duct-tool.js";

/*
 * A TRANSFORM THAT CARRIES PIPEWORK CARRIES ITS JOINTS TOO.
 *
 * A shift, a turn or a resize moves the runs' ends like any drag does, so each
 * moved run is put through the ONE reconciler afterwards: a join the move made
 * earns its fitting, a join it broke loses it, and a corner it only flattened stays
 * attached.
 */
function reconcileMovedFluids(targets) {
    (targets || []).forEach((object) => {
        if (object?.type === "pipe-duct") {
            reconcileFluidConnections(object, drawingState.objects);
        }
    });
}

/*
 * THE FITTING'S CONNECTED ENDS FIND THEIR PIPES THROUGH HERE.
 *
 * `feature-schema.js` declares fields and must not depend on the live document,
 * so a run lookup is injected: a connected elbow re-anchored by a panel edit
 * then lands on exactly the runs its connection record names.
 *
 * IT IS WIRED IN `features-editor.js`, not here. `feature-schema.js` takes part
 * in an import cycle with this module, and calling its setter at MODULE SCOPE
 * reached the setter before its own binding had initialised - a temporal dead
 * zone throw at load. The editor pane is the module that actually edits fields,
 * so it is where the lookup belongs.
 */

/* Any object on the sheet, by id - the body a support slides along. */
export function lookupObject(id) {
    return drawingState.objects.find((candidate) => candidate.id === id) || null;
}

/* The increment every arrow applies, and the precision the fields are read at. */
export const TRANSFORM_STEP = 0.1;

/*
 * THE PIPE WIDTH INCREMENT.
 *
 * One click of Pipe Width opens or closes the two walls by the default
 * separation - one whole pipe width - because a tenth of that would be an
 * invisible nudge on a line a few units apart. Typed values are applied as
 * given, so a student who wants a precise width still has it.
 */
export const PIPE_WIDTH_STEP = 4;

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
             *
             * WITH THE REAL LOOKUP: a support slides along its body, and
             * without the body the probe saw no move and dropped it.
             */
            return wouldMove(object, lookupObject);
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
        if (enggReducer.isReducerType(object.type)) {
            const centre = object.geometry.position;
            enggReducer.slideReducerTo(object, { x: centre.x + deltaX, y: centre.y + deltaY }, state.objects);
            return;
        }
        enggFeatureGeometry.translateObject(object, deltaX, deltaY, (id) =>
            state.objects.find((candidate) => candidate.id === id) || null
        );
    });

    reconcileMovedFluids(targets);

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
    const targets = transformableObjects().filter(object => object.type !== "reducer-expander" || !enggReducer.connectedPipeIds(object).some(Boolean));

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

    reconcileMovedFluids(targets);

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

    /*
     * PIPE WIDTH IS A TRANSFORM, NOT A MEASUREMENT.
     *
     * Like the three above it is a CHANGE applied to the selection, and it is
     * the same operation the Features field performs - one arithmetic, in
     * `setPipeWidth`. Non-pipe objects answer zero, so a mixed selection moves
     * its pipes and leaves everything else alone.
     */
    if (axis === "width") {
        return adjustPipeWidth(value);
    }

    /*
     * BEND RADIUS IS THE SAME KIND OF CONTROL, FOR A FITTING.
     *
     * The amount is a CHANGE to each selected elbow's current radius, clamped to
     * the bend's arms, and each connected end is re-anchored on its pipe - so a
     * typed value or an arrow click moves the tangent points along the pipes
     * rather than detaching the fitting. Nothing else is touched: an elbow has
     * no stroke width to change here, and Pipe Width is a run's own property.
     */
    if (axis === "bendRadius") {
        return adjustElbowRadiusSelection(value);
    }

    /*
     * BEND ANGLE IS AN ABSOLUTE VALUE, so "apply a transform of +5" is not a
     * thing it has. Its row writes it directly; the axis answers 0 here rather
     * than inventing an interpretation.
     */
    if (axis === "bendAngle") {
        return 0;
    }

    return 0;
}

/* ============================================================
 * PIPE WIDTH
 * ============================================================ */

/*
 * Open or close every selected run by `change`, as ONE undoable operation.
 *
 * The centreline is never touched: the run keeps its two endpoints, so its
 * length and orientation are exactly what they were and only the distance
 * between the walls moves. Fixed runs are refused with the rest of the
 * transformable set - Fix is absolute, so it holds the width too.
 */
export function adjustPipeWidth(change) {
    const state = drawingState;
    const amount = Number(change);

    if (!state || !Number.isFinite(amount) || amount === 0) {
        return 0;
    }

    const targets = transformableObjects().filter((object) => object.type === "pipe-duct");

    if (!targets.length) {
        return 0;
    }

    const previous = enggDrawingState.snapshotDrawing(state);

    detachSourceSync();

    let changed = 0;

    targets.forEach((object) => {
        const current = Number(object.engineering?.separation) || 0;

        if (setPipeWidth(object, current + amount)) {
            changed += 1;

            /*
             * THE CHANGE SPREADS ALONG THE DIRECTLY CONNECTED RUN, because a
             * pipe is one piece of pipework however many segments it was drawn
             * with. The walk stops at an elbow, so the run on the far side of a
             * fitting keeps its own width - see `propagatePipeWidth`.
             */
            propagatePipeWidth(object, state.objects);
        }
    });

    if (!changed) {
        return 0;
    }

    enggDrawingState.commitDrawingChange(state, previous);

    renderCurrentDrawing();

    return changed;
}

/* ============================================================
 * BEND RADIUS
 * ============================================================
 *
 * One relative change, applied to every selected elbow that is not Fixed, as
 * ONE undoable operation. Fixed fittings are refused with the rest of the
 * transformable set - Fix is absolute, so it holds the bend too.
 */
export function adjustElbowRadiusSelection(change) {
    const state = drawingState;
    const amount = Number(change);

    if (!state || !Number.isFinite(amount) || amount === 0) {
        return 0;
    }

    const targets = transformableObjects().filter((object) => object.type === "elbow");

    if (!targets.length) {
        return 0;
    }

    const previous = enggDrawingState.snapshotDrawing(state);

    detachSourceSync();

    let changed = 0;

    targets.forEach((object) => {
        if (adjustElbowRadius(object, amount)) {
            changed += 1;
        }
    });

    if (!changed) {
        return 0;
    }

    enggDrawingState.commitDrawingChange(state, previous);

    renderCurrentDrawing();

    return changed;
}

export default {
    TRANSFORM_STEP,
    tidy,
    transformableObjects,
    shiftSelection,
    	rotateSelection,
    	 	applyTransform,
    	 	adjustPipeWidth,
    	 	adjustElbowRadiusSelection
    	};
