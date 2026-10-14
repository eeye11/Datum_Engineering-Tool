/*
 * Wiring a feature panel's controls to the feature.
 */

import enggBodyFrames from "../core/geometry/body-frames.js";
import enggDrawingState from "../core/model/drawing-state.js";
import enggDocumentUnits from "../core/units/document-units.js";
import enggQuantities from "../core/units/quantities.js";
import enggLoadProfile from "../features/analysis/load-profile.js";
import enggDrawingRotationalArrow from "../features/analysis/rotational-arrow.js";
import enggAnnotate from "../features/annotations/annotate-model.js";
import { renderCurrentDrawing } from "./canvas-render.js";
import { drawingProperties } from "./dom.js";
import { drawingState } from "./editor-state.js";
import { forcePanelModes, trianglePanelModes } from "./feature-panel-markup.js";
import { renderProperties } from "./feature-panel.js";
import { openAnalysisEditorFor } from "./feature-tree.js";
import { currentPropertyValue, setRigidBodyShape } from "./property-inputs.js";
import { updateFeatureProperty } from "./property-update.js";

const { readQuantity } = enggQuantities;
import { setToolMessage } from "./toolbar-render.js";
import { optimizeTrussStructure } from "./truss-optimizer.js";

/*
 * WHICH QUANTITY A FIELD IS, AND WHICH UNIT IT IS SHOWING
 * ============================================================
 *
 * A property field is bound by its `data-property` name, and the name is what
 * says which quantity the number is. Almost every editable field on a feature
 * panel is a LENGTH - a coordinate, a radius, a side, a spacing - so that is
 * the default; the angle fields are the ones that are not, and the statics
 * magnitudes are the rest.
 *
 * `readQuantity` needs this so it can refuse "5 mm" in a field that is really
 * an angle, and so it can tell "5 kN" from a malformed "5 furlong".
 */
const ANGLE_PROPERTIES = new Set([
    'angle',
    'angle1',
    'angle2',
    'angle3',
    'startAngle',
    'endAngle',
    'sweep',
    'rotation',
    'inclination',
]);

/*
 * THE STATICS MAGNITUDES, each with the quantity it is and the geometry
 * key that names the unit it is currently stated in.
 *
 * A force, a moment and a distributed load are different DIMENSIONS, so the
 * unit the field's selector shows - and the unit a bare number is read in -
 * has to be resolved per quantity. The geometry key is read live so a unit
 * typed beside the number (which the setter has just recorded) is the unit
 * the next read uses.
 */
const STATIC_QUANTITIES = [
    { properties: new Set(['magnitude', 'forceX', 'forceY']), geometryType: 'force', unitKey: 'unit' },
    { properties: new Set(['torque']), geometryType: 'moment', unitKey: 'momentUnit' },
    { properties: new Set(['startIntensity', 'endIntensity']), geometryType: 'distributedLoad', unitKey: 'loadUnit' },
];

function staticQuantityFor(property) {
    return STATIC_QUANTITIES.find(quantity =>
        quantity.properties.has(property)
    ) || null;
}

function quantityTypeFor(property, object) {
    if (!property) {
        return 'length';
    }

    if (ANGLE_PROPERTIES.has(property)) {
        return 'angle';
    }

    const statics = staticQuantityFor(property);

    if (statics) {
        /*
         * A MOMENT'S `magnitude` IS A MOMENT, A FORCE'S IS A FORCE. The
         * feature type decides which family the key belongs to, because
         * `magnitude` is a word several features use and the quantity is
         * not in the key alone.
         */
        if (property === 'magnitude') {
            if (object?.type === 'moment') {
                return 'moment';
            }

            if (object?.type === 'load' || object?.type === 'varying-load') {
                return 'distributedLoad';
            }

            return 'force';
        }

        return statics.geometryType;
    }

    return 'length';
}

/*
 * THE UNIT THE FIELD IS CURRENTLY DISPLAYING.
 *
 * A unit selector sits beside the number, so the field's unit is what the
 * FEATURE stores - the same source the setter reads. Asking the object rather
 * than the DOM means the parser and the setter cannot be looking at two
 * different dropdowns.
 *
 * Length resolves through `lengthUnit`; angle is stored in degrees; the
 * statics magnitudes resolve through their own unit keys on the geometry.
 */
function currentUnitFor(property, object) {
    const quantityType = quantityTypeFor(property, object);

    if (quantityType === 'length') {
        /*
         * THE DRAWING'S UNIT, read through the one accessor the panel and the
         * setter both use. The feature is no longer consulted: a per-feature
         * unit was a second source of truth for one document setting, and the
         * two could disagree.
         */
        return enggDocumentUnits.documentLengthUnit(drawingState);
    }

    if (quantityType === 'angle') {
        return enggQuantities.defaultUnitFor('angle');
    }

    /*
     * A STATICS MAGNITUDE'S UNIT lives on the geometry beside the value it
     * denominates. A unit the quantity does not have falls back to the
     * quantity's base unit, which is what the setter stores by default.
     */
    const statics = staticQuantityFor(property);

    if (statics && object?.geometry) {
        const stored = object.geometry[statics.unitKey];

        if (enggQuantities.isUnitFor(quantityType, stored)) {
            return stored;
        }
    }

    return enggQuantities.defaultUnitFor(quantityType);
}

/*
 * MOVE THE FIELD'S UNIT SELECTOR TO MATCH A UNIT TYPED BESIDE THE NUMBER.
 *
 * Writing the same unit property the selector writes means the change is one
 * ordinary undoable edit, and it is the ONE place the unit lives - so the
 * dropdown cannot be left saying metres while the number is millimetres.
 *
 * Length writes `lengthUnit` on the feature; the statics magnitudes write
 * their own unit key on the geometry, through the same setter the panel's
 * unit dropdown uses.
 */
function setUnitFor(property, object, unit) {
    const quantityType = quantityTypeFor(property, object);

    if (!unit || !enggQuantities.isUnitFor(quantityType, unit)) {
        return;
    }

    if (currentUnitFor(property, object) === unit) {
        return;
    }

    if (quantityType === 'length') {
        updateFeatureProperty(object, 'lengthUnit', unit);

        return;
    }

    /*
     * A STATICS UNIT IS RECORDED, NOT CONVERTED. The stored number is in the
     * unit the feature states, so recording the newly named unit beside the
     * value that is about to be written with it keeps the two naming the
     * same quantity - the same rule the load popup applies.
     */
    const statics = staticQuantityFor(property);

    if (statics && object?.geometry) {
        object.geometry[statics.unitKey] = unit;
    }
}

export function bindFeaturePropertyControls(object) {
    /*
     * THE DIMENSION'S "Edit Value" BUTTON.
     *
     * The panel's own route into the shared value popup, alongside the
     * double-click on the canvas. It is offered only for a Driving dimension
     * (the row is not rendered for a Driven one), because a Driven dimension
     * reports rather than controls.
     *
     * `openDimensionValuePrompt` is imported lazily to keep this module free of
     * a cycle: dimension-tool.js pulls in the panel, so importing it eagerly
     * here would close the loop at load time.
     */
    drawingProperties
        .querySelectorAll('[data-dimension-edit-value]')
        .forEach(button => {
            button.addEventListener('click', async () => {
                const { openDimensionValuePrompt } = await import(
                    './dimension-tool.js'
                );

                openDimensionValuePrompt(object);
            });
        });

    drawingProperties.querySelectorAll('[data-triangle-mode]').forEach(input => {
        input.addEventListener('click', () => {
            trianglePanelModes.set(
                object.id,
                input.dataset.triangleMode
            );

            renderProperties();
        });
    });

    /*
     * The Point Force's two views are two readings of the same
     * vector, so switching between them only changes which
     * fields are shown. The force itself is untouched, which is
     * why no snapshot is taken here.
     */
    drawingProperties.querySelectorAll('[data-force-mode]').forEach(input => {
        input.addEventListener('click', () => {
            forcePanelModes.set(
                object.id,
                input.dataset.forceMode
            );

            renderProperties();
        });
    });

    /*
     * Feature Name writes to the object itself, so the
     * Feature Tree, the selection and this panel all
     * show the same name.
     */

    /*
     * Reverse Direction turns a load's force vectors around.
     *
     * It is an undoable change like any other edit, so it takes
     * a snapshot first: one press is one step back, which is
     * what makes a reversal safe to try and see.
     *
     * The reversal itself is the model's, and touches the
     * DIRECTION alone. The span, the start point, the profile and
     * every position stay exactly where they were, so the load is
     * not moved, rebuilt or replaced - only its arrows are drawn
     * pointing the other way. Repainting both the canvas and the
     * panel is what makes the displayed direction the current
     * one, whether the load is selected, deselected or reopened.
     */
    /*
     * Reverse Direction turns a Point Force's vector around.
     *
     * The load control above this one is the pattern: snapshot first, so
     * one press is one step back and a reversal is safe to try and see.
     *
     * The reversal itself belongs to the model, and touches the
     * DIRECTION alone. The application point, the magnitude, the unit,
     * the feature's identity and its parent body all stay exactly where
     * they were - a force turned around is the same force acting at the
     * same place - so the arrow is redrawn pointing the other way and
     * nothing is moved, rebuilt or replaced.
     */
    drawingProperties.querySelectorAll('[data-force-reverse-direction]').forEach(button => {
        button.addEventListener('click', () => {
            const previous =
                enggDrawingState.snapshotDrawing(
                    drawingState
                );

            enggLoadProfile.reverseForceDirection(
                object.geometry
            );

            enggDrawingState.commitDrawingChange(
                drawingState,
                previous
            );

            setToolMessage(
                "Force direction reversed"
            );

            renderProperties();
            renderCurrentDrawing();
        });
    });

    drawingProperties.querySelectorAll('[data-load-reverse-direction]').forEach(button => {
        button.addEventListener('click', () => {
            const previous =
                enggDrawingState.snapshotDrawing(
                    drawingState
                );

            enggLoadProfile.reverseLoadDirection(
                object.geometry
            );

            enggDrawingState.commitDrawingChange(
                drawingState,
                previous
            );

            setToolMessage(
                "Load direction reversed"
            );

            renderProperties();
            renderCurrentDrawing();
        });
    });

    drawingProperties.querySelectorAll('[data-truss-optimize]').forEach(button => {
        button.addEventListener('click', () => {
            const previous =
                enggDrawingState.snapshotDrawing(
                    drawingState
                );

            if (!optimizeTrussStructure(object)) {
                setToolMessage(
                    "This truss has no members to optimize"
                );

                return;
            }

            enggDrawingState.commitDrawingChange(
                drawingState,
                previous
            );

            setToolMessage(
                "Truss structure optimized"
            );

            renderProperties();
            renderCurrentDrawing();
        });
    });

    /*
     * =========================================================
     * THE FEATURE'S LABEL
     * =========================================================
     *
     * The text drawn BESIDE a feature on the sheet - "AB", "x", "C" - which is a
     * different thing from its NAME (what it is called in a schedule). This field
     * had NO HANDLER AT ALL: the input was rendered in the panel and nothing ever
     * read it, for Line or for Point, so typing in it did nothing. That is the
     * whole of the reported fault, and this is the whole of the fix.
     *
     * IT IS A TEXT FIELD, so it follows the SAME shape as the feature name below:
     * commit on `change` (blur or Enter), snapshot first so one edit is one step
     * back, then repaint the canvas and the panel. Committing on `change` rather
     * than on every keystroke is deliberate - a label is a word, not a number,
     * and re-rendering the drawing per letter would be both noisy and slow.
     *
     * AN EMPTY VALUE IS A REAL EDIT. Clearing the field REMOVES the label and
     * keeps the feature - which is why this does not return early on a blank the
     * way the name field does (a feature must keep a name; it need not keep a
     * label).
     */
    drawingProperties.querySelectorAll('[data-object-label]').forEach(input => {
        input.addEventListener('change', () => {
            const previous =
                enggDrawingState.snapshotDrawing(
                    drawingState
                );

            const changed = updateFeatureProperty(
                object,
                'label',
                input.value
            );

            if (!changed) {
                renderProperties();
                return;
            }

            enggDrawingState.commitDrawingChange(
                drawingState,
                previous
            );

            renderCurrentDrawing();
            renderProperties();
        });
    });

    drawingProperties.querySelectorAll('[data-feature-name]').forEach(input => {
        input.addEventListener('change', () => {
            const name =
                input.value.trim();

            if (!name) {
                renderProperties();
                return;
            }

            const previous =
                enggDrawingState.snapshotDrawing(
                    drawingState
                );

            object.name =
                name;

            enggDrawingState.commitDrawingChange(
                drawingState,
                previous
            );

            renderCurrentDrawing();
            renderProperties();
        });
    });

    /*
     * Appearance controls write straight to the
     * object's style and repaint immediately.
     */
    drawingProperties.querySelectorAll('[data-style]').forEach(input => {
        input.addEventListener('change', () => {
            const key =
                input.dataset.style;

            const previous =
                enggDrawingState.snapshotDrawing(
                    drawingState
                );

            if (key === 'lineWidth') {
                const width =
                    Number(input.value);

                if (
                    !Number.isFinite(width) ||
                    width <= 0
                ) {
                    renderProperties();
                    return;
                }

                object.style.lineWidth =
                    width;
            } else if (key === 'pointSize') {
                const size =
                    Number(input.value);

                if (
                    !Number.isFinite(size) ||
                    size <= 0
                ) {
                    renderProperties();
                    return;
                }

                object.style.pointSize =
                    size;
            } else if (key === 'arrowhead' || key === 'leaderStyle') {
                /*
                 * A LEADER'S OR CALLOUT'S OWN STYLE FIELDS.
                 *
                 * THE SELECT'S OWN KEY IS WHAT IS WRITTEN, not a fixed
                 * `lineType`. The default branch below used to assign
                 * `object.style.lineType = input.value` for EVERY other
                 * control - so choosing an Arrowhead (or a Leader line style)
                 * wrote the word "dot" into the feature's LINE TYPE and left
                 * the arrowhead exactly as it was. The dropdown then snapped
                 * back on the next repaint, silently, which is why an endpoint
                 * symbol could not be changed at all.
                 */
                object.style[key] = input.value;
            } else {
                object.style.lineType =
                    input.value;
            }

            enggDrawingState.commitDrawingChange(
                drawingState,
                previous
            );

            renderCurrentDrawing();
            renderProperties();
        });
    });

    /*
     * A SUPPORT'S POSITION ALONG ITS BODY.
     *
     * The number is a DISTANCE along the body, not a coordinate, and
     * both the attachment and the drawn position are written from it -
     * the attachment first, and then the render position derived from
     * it - so the two can never disagree. Writing only the drawn
     * position is what allowed a support dragged along a beam to drift
     * off its centreline and end up stuck to a face.
     */
    drawingProperties
        .querySelectorAll('[data-support-distance]')
        .forEach(input => {
            input.addEventListener('change', () => {
                const parent = object.parentId
                    ? drawingState.objects.find(
                        candidate =>
                            candidate.id === object.parentId
                    )
                    : null;

                const frame =
                    parent
                        ? enggBodyFrames.frameOf(parent)
                        : null;

                const distance =
                    Number(input.value);

                if (
                    !frame ||
                    !Number.isFinite(distance)
                ) {
                    renderProperties();
                    return;
                }

                const previous =
                    enggDrawingState.snapshotDrawing(
                        drawingState
                    );

                /*
                 * Typed as a distance along the body, STORED as the
                 * fraction that distance represents.
                 *
                 * The panel speaks the DRAWING'S active length unit, and
                 * `pointAt` projects in WORLD units, so the typed distance is
                 * converted through the document scale IN THAT UNIT first -
                 * the same conversion every other length write runs. The unit
                 * is read from the document, so this row cannot be read in a
                 * different unit from the fields around it. The model stores
                 * the fraction because that is what survives the body being
                 * resized.
                 */
                const documentUnit =
                    enggDocumentUnits.documentLengthUnit(drawingState);

                const worldDistance =
                    enggQuantities.isUnitFor('length', documentUnit)
                        ? enggQuantities.convertValue(
                            distance,
                            'length',
                            documentUnit,
                            'mm'
                        )
                        : distance;

                /*
                 * THE TYPED DISTANCE IS CLAMPED IN WORLD UNITS, since the
                 * frame it is measured along is a world length.
                 */
                const point =
                    enggBodyFrames.pointAt(
                        frame,
                        Math.min(
                            frame.length,
                            Math.max(0, worldDistance)
                        )
                    );

                const placement =
                    enggBodyFrames.supportPlacement(
                        parent,
                        point,
                        object.geometry.flipped === true
                    );

                object.geometry.attachment =
                    enggBodyFrames.attachmentFor(
                        frame,
                        point
                    );

                if (placement) {
                    object.geometry.position =
                        placement.render;
                }

                enggDrawingState.commitDrawingChange(
                    drawingState,
                    previous
                );

                renderProperties();
                renderCurrentDrawing();
            });
        });

    /*
     * FLIP: WHICH SIDE OF THE BODY THE SYMBOL IS DRAWN ON.
     *
     * The one thing it changes. Not the attachment, not the distance
     * along the body, and not the body itself - so flipping a support
     * moves the symbol from one side of its beam to the other and
     * leaves it under exactly the same load, which is the whole point
     * of a support that is on the far side of a member.
     */
    drawingProperties
        .querySelectorAll('[data-support-flip]')
        .forEach(input => {
            input.addEventListener('change', () => {
                const parent = object.parentId
                    ? drawingState.objects.find(
                        candidate =>
                            candidate.id === object.parentId
                    )
                    : null;

                const frame =
                    parent
                        ? enggBodyFrames.frameOf(parent)
                        : null;

                const previous =
                    enggDrawingState.snapshotDrawing(
                        drawingState
                    );

                object.geometry.flipped =
                    input.checked;

                /*
                 * The drawn position is updated as well, so anything
                 * that reads the stored point - the hit test, the
                 * move handles - agrees with what is on screen. The
                 * renderer would recompute it anyway; writing it here
                 * means the feature is never momentarily described by
                 * two different positions.
                 */
                if (frame) {
                    const placement =
                        enggBodyFrames.supportPlacement(
                            parent,
                            enggBodyFrames.pointAt(
                                frame,
                                Number(
                                    object.geometry
                                        .attachment
                                        ?.distance
                                ) || 0
                            ),
                            object.geometry.flipped
                        );

                    if (placement) {
                        object.geometry.position =
                            placement.render;
                    }
                }

                enggDrawingState.commitDrawingChange(
                    drawingState,
                    previous
                );

                renderProperties();
                renderCurrentDrawing();
            });
        });

    /*
     * The Analysis display switches.
     *
     * These change what is DRAWN, never what is derived, so they are
     * written straight onto the geometry and never touch a source. A
     * checkbox that quietly re-derived the values would be a control
     * that could change engineering data, which is not what a
     * "Show X Component" switch is for.
     */
    drawingProperties
        .querySelectorAll('[data-analysis-toggle]')
        .forEach(input => {
            input.addEventListener('change', () => {
                const previous =
                    enggDrawingState.snapshotDrawing(
                        drawingState
                    );

                object.geometry[
                    input.dataset.analysisToggle
                ] = input.checked;

                enggDrawingState.commitDrawingChange(
                    drawingState,
                    previous
                );

                renderCurrentDrawing();
                renderProperties();
            });
        });

    /*
         * ========================================================
         * OPENING THE PLOT EDITOR
         * ========================================================
         *
         * The panel does not edit expressions; it says there are some and this
         * is where they are edited. Apply commits the previewed state, which
         * is what the student has already seen drawn on the sheet while they
         * worked - so there is no separate "Plot" step and nothing to forget.
         *
         * THE PREVIEW IS NOT AN UNDO STEP. Editing inside the dialog changes
         * what the sheet shows but writes nothing to the document, so opening
         * the editor and cancelling is not something to undo. One snapshot
         * is taken when Apply is pressed, and that is the single step that
         * takes the whole edit.
         *
         * ONE IMPLEMENTATION, TWO ENTRY POINTS. `openAnalysisEditorFor` is the
         * whole of it; the panel button below calls it, and so does the
         * placement commit. When both had their own copy, the automatic open
         * drifted from the manual one - different titles, different ranges,
         * one of them clearing the legacy field and the other not - so the
         * editor the student gets on placement was not the editor they get
         * when they reopen the feature.
         */
        drawingProperties
            .querySelector('[data-plot-editor-open]')
            ?.addEventListener('click', () => {
                openAnalysisEditorFor(object);
            });

        /*
     * The arc radius of a Moment.
     *
     * A PRESENTATION control, written as its own field on the geometry rather
     * than as a style, so it can never be confused with the magnitude: resizing
     * the curve touches this one number and nothing else.
     */
    /*
     * ADDING AND REMOVING A BEND ON A LEADER OR CALLOUT.
     *
     * These are edits to the annotation's PATH - one ordered list of
     * attachment, bends, endpoint - and each is ONE committed change, so undo
     * takes back the whole edit rather than half of it. The model does the
     * splicing (`addLeaderBend` / `removeLeaderBend`) so the path stays
     * continuous: a new bend lands at the midpoint of the segment it splits, so
     * the drawn line does not jump, and removing one reconnects its neighbours.
     */
    drawingProperties
        .querySelectorAll('[data-annotate-add-bend]')
        .forEach(button => {
            button.addEventListener('click', () => {
                if (!enggAnnotate?.addLeaderBend) {
                    return;
                }

                const previous =
                    enggDrawingState.snapshotDrawing(drawingState);

                /*
                 * THE FIRST SEGMENT IS SPLIT BY DEFAULT, so a line with no
                 * bends gains one in the middle of its span and the student
                 * then drags it. Once bends exist the LAST segment is the one
                 * the student is extending, which is where a pen is carried next.
                 */
                const bends = Array.isArray(object.geometry?.bends)
                    ? object.geometry.bends.length
                    : 0;

                /*
                 * THE ELBOW LIMIT IS ENFORCED HERE TOO, not only by the
                 * button's disabled state - so the action cannot exceed it by
                 * any route. A leader takes one elbow in V1.
                 */
                const maxBends =
                    enggAnnotate.maxBendsFor?.(object.annotateKind) ?? 1;

                if (bends >= maxBends) {
                    setToolMessage(
                        object.annotateKind === "leader"
                            ? "A leader takes one elbow - move it instead"
                            : "Bend limit reached"
                    );

                    return;
                }

                enggAnnotate.addLeaderBend(object, bends);

                enggDrawingState.commitDrawingChange(drawingState, previous);

                setToolMessage("Bend added - drag it to route the leader");

                renderProperties();
                renderCurrentDrawing();
            });
        });

    drawingProperties
        .querySelectorAll('[data-annotate-remove-bend]')
        .forEach(button => {
            button.addEventListener('click', () => {
                if (!enggAnnotate?.removeLeaderBend) {
                    return;
                }

                const bends = Array.isArray(object.geometry?.bends)
                    ? object.geometry.bends
                    : [];

                if (!bends.length) {
                    return;
                }

                const previous =
                    enggDrawingState.snapshotDrawing(drawingState);

                /*
                 * THE LAST BEND GOES. It is the one the student added most
                 * recently, so removing is the inverse of adding and a student
                 * who over-bent simply presses it the same number of times.
                 */
                enggAnnotate.removeLeaderBend(object, bends.length - 1);

                enggDrawingState.commitDrawingChange(drawingState, previous);

                setToolMessage("Bend removed");

                renderProperties();
                renderCurrentDrawing();
            });
        });

    /*
     * The arc radius of a Moment: a presentation control written as its own
     * field on the geometry, touching nothing but how large the curve is drawn.
     */
    drawingProperties.querySelectorAll('[data-arc-radius]').forEach(input => {
        input.addEventListener('change', () => {
            const rotational =
                enggDrawingRotationalArrow;

            const previous =
                enggDrawingState.snapshotDrawing(
                    drawingState
                );

            object.geometry.arcRadius =
                rotational
                    ? rotational.clampArcRadius(
                        input.value
                    )
                    : Number(input.value);

            enggDrawingState.commitDrawingChange(
                drawingState,
                previous
            );

            setToolMessage(
                "Arc radius changed - magnitude, direction and position are unchanged"
            );

            renderCurrentDrawing();
            renderProperties();
        });
    });

    /*
     * Select-based statics properties, such as a moment's
     * direction.
     *
     * EVERY SELECT GOES THROUGH THE ONE SETTER.
     *
     * This handler used to write `object.geometry[key] = select.value ===
     * "true"` for every select whose data-property was not `direction` - which
     * is right for a boolean select and WRONG for every other one. A unit select
     * carries a STRING ("kN", "kN\u00b7m", "kN/m"), so choosing kN wrote
     * `geometry.forceUnit = false` and the unit never changed at all: the
     * dropdown snapped back on the next repaint, silently, with no error
     * anywhere. It is exactly the defect that made a Moment's unit control look
     * decorative.
     *
     * `updateFeatureProperty` is the ONE place a panel field is written to the
     * model, and it already knows how each unit is stored - through
     * `setForceUnit`, `setMomentUnit`, `setLoadUnit`, or the dimension's own
     * `displayUnit`. Routing every select through it means a unit cannot be
     * written as a boolean, a new unit-bearing feature gets the same treatment
     * for free, and the read-only value beside the unit reconciles through the
     * same path the input fields use. The one field that is genuinely a boolean
     * on the geometry - `direction` - is still handled here, because it is a
     * WORD and not a boolean at all (see below).
     */
    drawingProperties.querySelectorAll('select[data-property]').forEach(select => {
        select.addEventListener('change', () => {
            const previous =
                enggDrawingState.snapshotDrawing(
                    drawingState
                );

            const key = select.dataset.property;

            /*
             * A DIRECTION IS A WORD, not a flag.
             *
             * Every other select's value is a string the setter understands,
             * but a direction is stored as "CCW" or "CW" so the feature states
             * its own sense rather than leaving a reader to invert a boolean.
             */
            if (key === 'direction') {
                object.geometry[key] =
                    select.value === 'CW' ? 'CW' : 'CCW';
            } else {
                /*
                 * THE SETTER OWNS THE WRITE. A select's value is handed over as
                 * the string it is, so a unit is stored as the unit.
                 */
                updateFeatureProperty(
                    object,
                    key,
                    select.value
                );
            }

            enggDrawingState.commitDrawingChange(
                drawingState,
                previous
            );

            renderCurrentDrawing();
            renderProperties();
        });
    });

    /*
     * Unknown toggles for statics values. Stored on the
     * feature alongside its other state, so it persists
     * through selection, undo/redo and save/load.
     *
     * Marking a quantity Unknown retires the number it had:
     * there is no longer an authoritative value, so the
     * field is cleared and the old one is not kept as a
     * hidden fallback. Only this one quantity is affected,
     * so the rest of the feature stays fully editable.
     *
     * AND THE NUMBER ITSELF IS DELETED, not merely hidden. The panel
     * refusing to draw it is one thing; the magnitude still sitting on
     * the geometry is another, and it is the dangerous one - the
     * renderer, the annotation model and anything reading the feature
     * would keep finding a real 100 N behind a box that says the value
     * is unknown. So the geometry field is cleared as well. Turning the
     * mark off then reveals an empty field, which is exactly what the
     * student asked for: the value has to be entered again.
     */
    drawingProperties.querySelectorAll('[data-known]').forEach(button => {
        button.addEventListener('click', () => {
            const previous =
                enggDrawingState.snapshotDrawing(
                    drawingState
                );

            object.unknownValues ||= {};

            const key =
                button.dataset.known;

            const wasKnown =
                object.unknownValues[key] !== true;

            if (wasKnown) {
                object.unknownValues[key] = true;

                /*
                 * The value is gone. An empty field is the honest
                 * state, and it stops anything downstream reading a
                 * number the student has just declared unknown.
                 */
                if (
                    object.geometry &&
                    key in object.geometry
                ) {
                    delete object.geometry[key];
                }

                /*
                 * A LOAD'S MAGNITUDE IS ITS INTENSITY, so the flag is
                 * stored under the panel's key but the number it retires
                 * lives under the model's. Clearing the intensity is what
                 * makes the magnitude field blank rather than showing a
                 * stale value behind an Unknown mark.
                 */
                if (
                    object.type === "load" &&
                    key === "magnitude" &&
                    object.geometry
                ) {
                    delete object.geometry.intensity;
                    delete object.geometry.points;
                }

                /*
                 * A LOAD'S DIRECTION, MARKED UNKNOWN, IS NOT THE DEFAULT.
                 *
                 * Deleting `geometry.direction` alone would leave the
                 * renderer falling back to its straight-down default, so a
                 * load whose direction the student had just declared unknown
                 * still drew arrows pointing down. The unknown state is
                 * recorded explicitly on the geometry as well, which is what
                 * `loadDirection` reads to report that there is no
                 * authoritative direction - so nothing draws one.
                 */
                if (
                    (object.type === "load" ||
                        object.type === "varying-load") &&
                    key === "direction" &&
                    object.geometry
                ) {
                    object.geometry.directionUnknown = true;
                }
            } else {
                delete object.unknownValues[key];

                if (
                    object.geometry &&
                    key === "direction"
                ) {
                    delete object.geometry.directionUnknown;
                }
            }

            enggDrawingState.commitDrawingChange(
                drawingState,
                previous
            );

            renderProperties();
            renderCurrentDrawing();
        });
    });

    /*
     * THE LABEL A MAGNITUDE IS WRITTEN UNDER.
     *
     * Typed onto the feature as `magnitudeLabel`, which is the single
     * field the annotation model reads - so the letter on the sheet is
     * the letter the student typed, and there is no second copy for it
     * to disagree with.
     *
     * AN EMPTY STRING IS KEPT. "Write the number with no symbol in front
     * of it" is a real choice, and storing null instead would let the
     * conventional letter come back - which is not what the student
     * asked for.
     *
     * IT IS A TEXT FIELD, NOT A QUANTITY, so it does not go through
     * `updateFeatureProperty`: that path parses a number and rejects a
     * blank, and this field is defined by accepting both words and the
     * empty string.
     *
     * THE SHEET FOLLOWS THE TYPING; THE HISTORY FOLLOWS THE EDIT. The
     * canvas is redrawn on every keystroke so the student sees the label
     * change as they write it, but one committed action is recorded per
     * completed edit - on change, when the field is left - rather than one
     * per character, which would bury every other action in the undo
     * stack behind the letters of a single word.
     */
    drawingProperties.querySelectorAll('[data-magnitude-label]').forEach(input => {
        let historyBefore = null;

        input.addEventListener('input', () => {
            if (!historyBefore) {
                historyBefore =
                    enggDrawingState.snapshotDrawing(
                        drawingState
                    );
            }

            object.magnitudeLabel = input.value;

            renderCurrentDrawing();
        });

        input.addEventListener('change', () => {
            object.magnitudeLabel = input.value;

            if (historyBefore) {
                enggDrawingState.commitDrawingChange(
                    drawingState,
                    historyBefore
                );
            }

            historyBefore = null;

            renderCurrentDrawing();
        });
    });

    /*
     * A rigid body's Shape control rewrites the same body rather
     * than replacing it, so the feature keeps its identity and
     * everything attached to it.
     */
    drawingProperties.querySelectorAll('[data-rigid-shape]').forEach(select => {
        select.addEventListener('change', () => {
            const previous = enggDrawingState.snapshotDrawing(drawingState);

            if (!setRigidBodyShape(object, select.value)) {
                return;
            }

            enggDrawingState.commitDrawingChange(
                drawingState,
                previous
            );

            renderProperties();
            renderCurrentDrawing();
        });
    });

    drawingProperties.querySelectorAll('[data-fix]').forEach(input => {
        input.addEventListener('change', () => {
            const previous = enggDrawingState.snapshotDrawing(drawingState);

            object.constraints ||= {};

            const key =
                input.dataset.fix;

            object.constraints[key] =
                input.checked;

            /*
             * A fixed property records the value it is
             * pinned to, so later edits can restore it
             * exactly instead of recomputing it from
             * geometry that may have moved.
             */
            if (input.checked) {
                const measured =
                    currentPropertyValue(
                        object,
                        key
                    );

                if (Number.isFinite(measured)) {
                    object.constraints[
                        `${key}Value`
                    ] = measured;
                }
            } else {
                delete object.constraints[
                    `${key}Value`
                ];
            }

            enggDrawingState.commitDrawingChange(drawingState, previous);
            renderProperties();
            renderCurrentDrawing();
        });
    });

    /*
     * THE FEATURE LOCK.
     *
     * A one-line document change: the flag is set or cleared, committed, and the
     * panel re-rendered. It is deliberately NOT special-cased anywhere else -
     * the drag entry point is the single place that reads it, so a locked
     * feature behaves exactly like any other until someone tries to move it.
     */
    drawingProperties.querySelectorAll('[data-feature-lock]').forEach(input => {
        input.addEventListener('change', () => {
            const previous = enggDrawingState.snapshotDrawing(drawingState);

            object.locked = input.checked;

            enggDrawingState.commitDrawingChange(drawingState, previous);
            renderProperties();
            renderCurrentDrawing();
        });
    });

    /*
     * WHETHER THIS FEATURE'S MAGNITUDE BOX IS SHOWN
     * ========================================================
     *
     * One history entry per switch, and one logical change: the checkbox is
     * the whole action, not a drag across it.
     *
     * The preference is written onto the FEATURE rather than recomputed from
     * the sheet-wide switch. That is what lets a student who has turned off
     * the seventeen boxes that do not matter keep those choices when they
     * reach for the Magnitudes switch on the toolbar - see the note in
     * `magnitudeShownFor`, which reads this same field.
     *
     * It is stored as a real boolean, not as the checkbox's string value, so
     * that reading it back cannot turn the string "false" into a truthy
     * preference and leave the box permanently on.
     */
    drawingProperties
        .querySelectorAll(
            '[data-feature-show-magnitude]'
        )
        .forEach(input => {
            input.addEventListener(
                'change',
                () => {
                    const previous =
                        enggDrawingState
                            .snapshotDrawing(drawingState);

                    object.annotationDisplay = {
                        ...(object.annotationDisplay || {}),
                        showMagnitude: input.checked === true,
                    };

                    enggDrawingState
                        .commitDrawingChange(
                            drawingState,
                            previous
                        );

                    /*
                     * The panel is NOT re-rendered here.
                     *
                     * Re-rendering would rebuild the very control being
                     * used, and the checkbox would lose the pointer's
                     * focus mid-click - which on some platforms swallows the
                     * click entirely and makes the switch feel stuck. The
                     * sheet is redrawn, because that is what actually has to
                     * change; the checkbox already shows the state the
                     * student just chose.
                     */
                    renderCurrentDrawing();
                }
            );
        });

    /*
     * THE PER-FEATURE UNIT SWITCH IS GONE, ALONG WITH ITS HANDLER.
     *
     * The switch is removed from the annotation section, and this
     * listener goes with it. Leaving the handler behind would mean a
     * dead listener on a selector that now matches nothing - code
     * that reads as though units can still be turned off, for an
     * option that no longer exists.
     *
     * Units are still printed. They are part of the quantity, not a
     * display preference: "100" and "100 N" are not the same
     * statement, and the annotation model formats the unit into every
     * magnitude whether or not anything asked it to.
     */

    /*
     * ========================================================
     * A ROUTE CHILD'S INHERIT / OVERRIDE CONTROL
     * ========================================================
     *
     * The Pipe / Duct panel's inheritance toggle is ONE control with two
     * jobs: while a child inherits a property it activates an override, and
     * while it overrides one it resets the property back to the route's
     * value. Both are ordinary property writes - they go through the same
     * setter the value fields use - so the change is one undoable edit and
     * the panel repaints from the model.
     *
     * `data-route-reset` says which of the two the current state means, so
     * the button's appearance and its action cannot disagree.
     */
    drawingProperties
        .querySelectorAll('[data-route-override]')
        .forEach(button => {
            button.addEventListener('click', () => {
                const property = button.dataset.routeOverride;

                if (!property) {
                    return;
                }

                const previous =
                    enggDrawingState.snapshotDrawing(drawingState);

                const reset = button.dataset.routeReset === '1';

                const changed = updateFeatureProperty(
                    object,
                    reset ? 'routeReset' : 'routeOverride',
                    property
                );

                if (!changed) {
                    renderProperties();
                    return;
                }

                enggDrawingState.commitDrawingChange(
                    drawingState,
                    previous
                );

                setToolMessage(
                    reset
                        ? `Inherited from the route`
                        : `Overridden for this component`
                );

                renderProperties();
                renderCurrentDrawing();
            });
        });

    drawingProperties.querySelectorAll('[data-property]').forEach(input => {
        /*
         * Numeric fields update on both `input` (which
         * fires for typing and for the spinner arrows)
         * and `change` (which fires on blur/commit), so
         * either method moves the real geometry.
         */
        /*
         * The pre-edit snapshot is taken when the field is
         * first focused, before any mutation happens. The
         * `input` event fires while typing, so snapshotting
         * inside `apply()` would record the already-changed
         * geometry and make Undo a no-op.
         */
        let previous = null;

        /*
         * The value most recently written by this field, so the
         * pair of events a single edit produces can be recognised
         * as one edit.
         *
         * A field fires `input` while the value is being typed and
         * `change` when it is committed, so one edit arrives as
         * two calls. Applying both is harmless for a field that
         * writes a fixed slot, but the load's point rows are
         * rendered from a list sorted along the body: applying the
         * first call re-sorts it, and applying the second would
         * then land on whatever point moved into that row, quietly
         * overwriting it. Skipping the repeat is what makes a row
         * keep meaning the point the user is looking at.
         */
        let applied = null;

        const capture = () => {
            if (!previous) {
                previous =
                    enggDrawingState.snapshotDrawing(
                        drawingState
                    );
            }
        };

        const apply = () => {
            const raw =
                input.value.trim();

            /*
             * ====================================================
             * THE TYPED TEXT IS READ, NOT JUST CONVERTED TO A NUMBER
             * ====================================================
             *
             * `Number("5 mm")` is NaN, so the old field discarded a student's
             * correct, unambiguous entry and snapped the box back - the entry
             * looked like it had been ignored. A field labelled in metres that
             * received "5 mm" had no way to tell the two apart at all.
             *
             * `readQuantity` answers both questions at once: what the number
             * is, and which unit the student named for it. A bare "5" is read
             * in the unit the field is already showing, so the label keeps its
             * promise; a suffixed "5 mm" is read in millimetres whatever the
             * dropdown says.
             *
             * It returns null for a malformed or empty entry, and that is
             * handled by the branch below rather than by defaulting to zero.
             */
            const quantity = readQuantity(
                raw,
                quantityTypeFor(input.dataset.property, object),
                currentUnitFor(input.dataset.property, object)
            );

            if (!quantity) {
                /*
                 * A REFUSED ENTRY IS NOT A ZERO.
                 *
                 * The geometry is left exactly as it was, and the `change`
                 * handler restores the box from the model, so the field snaps
                 * back to the last valid committed value. Coercing to zero
                 * here would collapse the feature to nothing - the more
                 * destructive of the two outcomes, and the one that looks like
                 * a successful edit.
                 */
                return false;
            }

            /*
             * AN EXPLICIT UNIT BECOMES THE FIELD'S UNIT.
             *
             * If the student typed "5 mm" while the selector read metres, the
             * selector is moved to millimetres so the label and the number
             * cannot be left disagreeing. A bare number leaves the selector
             * alone, because the student said nothing about the unit and the
             * dropdown is already stating it.
             */
            if (quantity.explicit) {
                setUnitFor(
                    input.dataset.property,
                    object,
                    quantity.unit
                );
            }

            const value = quantity.value;

            if (applied === raw) {
                return true;
            }

            applied = raw;

            /*
             * THE SETTER PERFORMS THE CONVERSION, SO NOTHING IS DONE HERE.
             *
             * A physical coordinate is shown in the unit the field states and
             * stored in world units, and `updateFeatureProperty` is the one
             * place that converts - for the panel's coordinate fields and
             * for the lengths it owns (see SETTER_OWNED_LENGTHS). Converting
             * again on the way in would be a different length, so the typed
             * number is handed over exactly as it was entered, together with
             * the unit it was entered in.
             */
            return updateFeatureProperty(
                object,
                input.dataset.property,
                value,
                quantity.unit
            );
        };

        input.addEventListener('focus', () => {
            capture();

            /*
             * A field that is focused for a fresh edit starts from
             * whatever the model now holds, not from the previous
             * value of the same field.
             */
            applied = null;
        });

        input.addEventListener('pointerdown', capture);

        input.addEventListener('keydown', capture);

        input.addEventListener('input', () => {
            capture();

            /*
             * The edit is applied here but committed on blur, so the arrow
             * and the feature's dependants refresh as the student types
             * rather than when they click away. That comes from the refresh
             * inside `renderCurrentDrawing`, not from a call here - a
             * property field is only one of the paths that can move a force,
             * and this was the path that happened to be remembered.
             */
            if (apply()) {
                renderCurrentDrawing();
            }
        });

        input.addEventListener('change', () => {
            apply();

            if (previous) {
                enggDrawingState.commitDrawingChange(
                    drawingState,
                    previous
                );
            }

            previous = null;

            renderProperties();
            renderCurrentDrawing();
        });
    });
}
