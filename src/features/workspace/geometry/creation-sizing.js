/*
 * Creation-time sizing: the popup that asks for a new feature's length, radius or size.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggQuantities from "../../../shared/units/quantities.js";
import enggCreationDimension from "../model/dimensions/creation-dimension.js";
import enggCreationDimensioning from "../model/dimensions/creation-dimensioning.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { drawingState, editorState } from "../editor-state.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { updateFeatureProperty } from "../../../components/layout/panels/property-update.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";

/*
 * ========================================================
 * CREATION-TIME DIMENSIONING
 * ========================================================
 *
 * Every tool that makes something with a physical size ends the
 * same way: the geometry is built, its size is established, and
 * the feature is committed as ONE undoable action. This pair of
 * helpers is that ending, so a Beam and a Rectangle run the same
 * code and cannot drift into committing differently.
 *
 * `beginCreationDimensioning` asks the questions the feature's
 * shape needs, through the shared framework and the shared
 * popup, and calls back only with answers that were confirmed.
 * `commitCreatedFeature` is the commit itself - the snapshot,
 * the add, the history entry and the selection - which is what
 * the creation paths already did inline, now in one place.
 *
 * WHY THE FEATURE IS NOT ADDED FIRST
 * ----------------------------------
 * The document is untouched while the popup is open. If the
 * student cancels, there is nothing to remove and nothing to undo:
 * adding the feature first and removing it on cancel would make that
 * guarantee depend on the removal being perfect.
 */
/*
 * Draw the feature being sized, at the size currently typed.
 *
 * The object is NOT in the document yet - adding it would mean a
 * cancelled popup had committed something, so a cancelled popup has to
 * leave the sheet exactly as it found it. The preview is therefore
 * drawn from a COPY, through the very same setter the answer is
 * applied with, so the drawing the student is looking at is the
 * geometry that will be committed rather than an approximation of it.
 *
 * The copy is what makes it safe to resize repeatedly: every keystroke
 * writes a fresh copy from the geometry as it was drawn, so the
 * preview cannot drift away from the member the student actually drew
 * by accumulating its own edits.
 */
function showSizingPreview(
    object,
    field,
    value,
    unit
) {
    const preview =
        JSON.parse(JSON.stringify(object));

    /*
     * THE PREVIEW MUST BE WHAT THE COMMIT WILL PRODUCE, SO IT GOES
     * THROUGH THE SAME DOOR.
     *
     * `updateFeatureProperty` is the ONE property setter, and its contract
     * is MILLIMETRES: one drawing unit is one millimetre, so the number it is
     * given IS the geometry's size. The commit does exactly this - it
     * normalises the typed value to millimetres with the unit the student
     * chose, then hands it over - so the preview normalises it the same way,
     * and a value typed in metres previews at the same size it will commit at.
     *
     * One normalisation, in one place, is what keeps the preview and the
     * commit identical.
     */
    const millimetres =
        Number(value) *
        (enggQuantities?.LENGTH_UNITS?.[unit || "mm"]?.mm ?? 1);

    if (Number.isFinite(millimetres)) {
        updateFeatureProperty(
            preview,
            field.key,
            millimetres
        );
    } else if (Number.isFinite(Number(field.worldValue))) {
        updateFeatureProperty(
            preview,
            field.key,
            Number(field.worldValue)
        );
    }

    /*
     * KEYED AS `previewObjects`, which is the key the RENDERER already
     * reads for "not yet committed" geometry - so the member appears
     * through the existing preview path, with the existing dashed and
     * translucent preview styling. Introducing a second key would have
     * meant a second branch in the renderer, and a second chance for the
     * preview and the committed feature to look different.
     *
     * Cleared as soon as the popup closes, by either path: confirming
     * commits the real object, and cancelling leaves nothing behind.
     */
    enggDrawingState.setInteraction(
        drawingState,
        {
            previewObjects: [preview],
            sizingPreview: preview
        }
    );

    renderCurrentDrawing();
}

export function beginCreationDimensioning(
    object,
    previousObjects,
    onReady
) {
    const framework =
        enggCreationDimensioning;

    /*
     * THE SNAPSHOT ARRIVES FROM THE CALLER, TAKEN BEFORE THIS POINT.
     *
     * It is captured at the moment the span was completed - before
     * `applyValue` below can run - and passed in, rather than being
     * taken here. That placement is the whole point: the snapshot
     * describes the drawing before the new feature's size was applied.
     *
     * Passing it in keeps creation and its sizing ONE undoable action.
     */

    const plan =
        framework?.planFor(
            object,
            drawingState
        );

    /*
     * A feature with no meaningful creation size is committed
     * straight away, exactly as it was before this system
     * existed. A Support, a Point, a Particle and a Point Force
     * all arrive here and pass through untouched.
     */
    if (
        !plan ||
        !plan.fields.length
    ) {
        onReady();
        return;
    }

    setToolMessage(
        `${plan.title}: enter its size, then press Enter`
    );

    renderCurrentDrawing();

    enggCreationDimension.open({
        title: plan.title,

        /*
         * THE GEOMETRY STAYS ON SCREEN AND FOLLOWS THE NUMBER.
         *
         * The popup asks "how big is it?" about something the student
         * can see. Hiding the drawing while that question is open
         * answers it against nothing - they would be typing a length
         * with no way to check what the length looks like, and the
         * drawing is the only thing that can tell them whether the
         * number they are typing is the number they meant.
         *
         * So the pending object is kept as a preview and redrawn as
         * the value changes: 500 becomes 750 becomes 0.75 m, and the
         * drawing follows. The preview is drawn with the SAME setter
         * the answer is applied through, so what is shown is what will
         * be committed - a preview computed by different arithmetic
         * would be a second answer to the same question.
         */
        onPreview: (index, value, unit) => {
            showSizingPreview(
                object,
                plan.fields[index],
                value,
                unit
            );
        },

        /*
         * The unit each field OPENS on, not the only unit it may be
         * answered in. The popup offers every length unit the
         * document understands and reports whichever one the
         * student actually chose.
         */
        unit: enggCreationDimensioning.displayUnit(
            drawingState
        ),

        fields: plan.fields.map(field => ({
            label: field.label,
            unit: field.unit,
            value: field.value
        })),

        onConfirm: values => {
            /*
             * The values are applied in order. For a two-value
             * shape the first is the span and the second is read
             * against it, which is what makes the second field land
             * on the number the student typed.
             */
            plan.fields.forEach(
                (field, index) => {
                    const answer =
                        values[index];

                    if (!answer) {
                        return;
                    }

                    /*
                     * The answer carries the unit the STUDENT
                     * CHOSE, which is not necessarily the unit the
                     * field's suggestion was made in - they may
                     * have typed 0.5 where the suggestion said
                     * 500 mm. The answer's unit is therefore
                     * written onto the field before it is applied,
                     * so the conversion below reads the unit that
                     * was actually entered rather than the one the
                     * drawing happened to offer.
                     */
                    framework.applyValue(
                        object,
                        drawingState,
                        {
                            ...field,
                            unit: answer.unit
                        },
                        answer.value,

                        /*
                         * THE ONE PROPERTY SETTER, receiving
                         * MILLIMETRES.
                         *
                         * The Features panel writes through this
                         * same function and captions its length
                         * fields with a unit, so the setter's
                         * contract is millimetres. The framework
                         * has already normalised the typed value to
                         * millimetres - including a value the
                         * student typed in metres - so this is a
                         * straight pass-through.
                         *
                         * Exactly one conversion, in exactly one
                         * place, is what makes a size set here and
                         * a size typed in the panel identical.
                         */
                        (target, key, millimetres) =>
                            updateFeatureProperty(
                                target,
                                key,
                                millimetres
                            )
                    );
                }
            );

            /*
             * THE PREVIEW HAS DONE ITS JOB.
             *
             * The real object is committed below, so the dashed copy
             * that stood in for it while the value was typed must go -
             * otherwise the sheet carries two overlapping members, and
             * the second is one keystroke out of date the moment the
             * geometry settles.
             */
            enggDrawingState.setInteraction(
                drawingState,
                {
                    previewObjects: null,
                    sizingPreview: null
                }
            );

            onReady();
        },

        onCancel: () => {
            /*
             * The preview goes with it. A cancelled size must leave
             * the sheet looking exactly as it did before the student
             * started drawing - no orphaned dashed member hanging in
             * the space where they were about to place something, and
             * nothing committed for them to undo.
             */
            enggDrawingState.setInteraction(
                drawingState,
                {
                    previewObjects: null,
                    sizingPreview: null
                }
            );

            /*
             * Nothing was created, so nothing is committed. The
             * tool is left armed and the message says so, which
             * is the same outcome as pressing Escape during any
             * other construction step.
             */
            setToolMessage(
                `${plan.title} cancelled`
            );

            renderProperties();
            renderCurrentDrawing();
        }
    });
}

/*
 * Commit a finished feature as one undoable action.
 *
 * The snapshot is taken BEFORE the object is added, so Undo
 * removes the feature and the creation dimension with it - the
 * two are one action, not a geometry change followed by a size
 * change the student would have to undo twice.
 *
 * THE PANEL IS PUT INTO EDIT VIEW HERE, AND THAT IS THE EXCEPTION.
 * ------------------------------------------------------------
 * Everywhere else, selecting a feature does not open it: picking a
 * row is how you find out what is there, and editing is a separate
 * deliberate step, so the panel stays on the tree until the user
 * asks otherwise.
 *
 * A feature that has just been SIZED is the exception, because the
 * student has just typed a number for it and needs to see that the
 * number landed. The creation popup is the last thing that happened,
 * and the value it set is only really confirmed once it is visible
 * in the feature's own properties. Leaving the panel on the tree
 * would mean the size they just entered showed up nowhere, and the
 * feature looked as though it had ignored them.
 *
 * So a feature committed through the creation-dimension workflow
 * arrives here already sized, and the panel opens on it. This is
 * scoped to that path by the `sized` argument; a feature created
 * without a size - a Particle, a Support - keeps the tree, exactly
 * as before.
 */
export function commitCreatedFeature(
    object,
    sized = false,
    previousObjects = null
) {
    /*
     * The caller passes the snapshot taken BEFORE the creation
     * dimension was applied, because that is the only moment from
     * which "before" means what it says. A feature that was never
     * sized has nothing that can change the scale, so for it - and
     * only for it - the state can be captured here instead.
     */
    const previous =
        previousObjects ||
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    enggDrawingState.addObject(
        drawingState,
        object
    );

    /*
     * THE OBJECT IS SELECTED BEFORE THE COMMIT, not after.
     *
     * The commit is the moment the drawing source is told about the edit -
     * and it identifies the edited object through the shared selection, so
     * the selection must already name the new feature when the commit runs.
     * Selecting afterwards left the commit reading the PREVIOUS selection,
     * and a freshly drawn feature never reached the source at all.
     *
     * The selection is not part of a history snapshot, so moving it ahead of
     * the commit changes nothing about what Undo restores: the snapshot still
     * describes the objects as they were before the feature existed.
     */
    enggDrawingState.selectObject(
        drawingState,
        object.id
    );

    enggDrawingState.commitDrawingChange(
        drawingState,
        previous
    );

    /*
     * A SIZED FEATURE IS LEFT SELECTED, so its properties are on screen the
     * moment it exists - the Features tab follows the selection, so selecting it
     * IS opening it and there is no view to switch.
     */
    void sized;

    return object;
}
