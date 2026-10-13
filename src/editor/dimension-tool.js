/*
 * The Dimension and Smart Dimension tools: choosing and committing a measurement.
 */

import enggMeasurement from "../core/geometry/measurement-core.js";
import enggDrawingState from "../core/model/drawing-state.js";
import enggDimensions from "../core/scale/dimensions.js";
import enggQuantities from "../core/units/quantities.js";
import enggDimensionEdit from "../features/dimensions/dimension-edit.js";
import enggScaleCalibration from "../core/scale/scale-calibration.js";
import enggDimensionModel from "../features/dimensions/dimension-model.js";
import enggSmartDimension from "../features/dimensions/smart-dimension.js";
import { openLoadValuePopup, readStaticsValue } from "../ui/editors/load-value-popup.js";
import { renderCurrentDrawing } from "./canvas-render.js";
import { drawingState } from "./editor-state.js";
import { renderProperties } from "./feature-panel.js";
import { distanceToSegment, objectAtPoint } from "./hit-testing.js";
import { setToolMessage } from "./toolbar-render.js";

/*
 * Is this one of the dimension tools?
 *
 * THREE tools, one placement interaction: Dimension, Smart Dimension and
 * Variable Dimension all pick references and then a placement point. They differ
 * in what they CREATE - a chosen measurement, an inferred one, or a symbol - and
 * in nothing else, which is why they are routed together and the difference is
 * decided at the moment the feature is built.
 */
export function isDimensionTool(
    toolId
) {
    return (
        toolId === "dimension" ||
        toolId === "smart-dimension" ||
        toolId === "variable-dimension"
    );
}

/*
 * The measurements available for a selection.
 *
 * Delegates to the measurement model rather than inspecting types, so
 * this holds for every feature that has registered what it can be
 * measured as - and quietly returns nothing for one that has not,
 * rather than guessing.
 *
 * One object gives its own candidates. Two give the RELATIONSHIP
 * between them, which is the whole difference between measuring a
 * single circle and measuring the gap between two circles.
 */
/*
 * The measurements a selection supports, as complete DESCRIPTORS.
 *
 * Returns objects that already carry their own references, rather than
 * bare measurement types, because a single feature and a pair of
 * features refer to their geometry in different ways and asking this
 * file to assemble both would mean re-implementing what the Smart
 * Dimension tool already knows.
 *
 * `describe` is used for one feature and `describePair` for two. That
 * split is the model's, not this file's: deciding what a pair MEANS -
 * that two non-parallel spans should give their included angle rather
 * than two separate lengths - belongs with the measurements, and is
 * kept there rather than re-derived here.
 *
 * A selection of more than two is reduced to its first two, because a
 * measurement is a relationship between two things; anything else has
 * no single meaning, and guessing one would put a number on the drawing
 * that answers a question nobody asked.
 */
export function dimensionDescriptorsFor(
    objects
) {
    const parts =
        (objects || []).filter(
            Boolean
        );

    try {
      if (parts.length === 1) {
        return (
          enggSmartDimension.propose(
            [parts[0]],
            drawingState
          ) || []
        );
      }

      if (parts.length === 2) {
        return (
          enggSmartDimension.describePair(
            parts[0],
            parts[1],
            drawingState
          ) || []
        );
      }

      return [];
    } catch (error) {
      return [];
    }
}

/*
 * A readable description of what is about to be measured.
 *
 * The status line has to say what the tool RECOGNISED, not merely
 * that it found something. For a single feature the measurement's own
 * name is enough, because there is only one thing it could refer to.
 *
 * For a pair it is not: "Angular" on its own leaves a student unable
 * to tell whether it means the angle between the two lines they picked
 * or something the tool worked out on its own, so the pair is named.
 */
export function dimensionChoiceMessage(
    descriptor,
    objects
) {
    const label = dimensionChoiceLabel(
        descriptor?.dimensionType
    );

    if (
        !Array.isArray(objects) ||
        objects.length < 2
    ) {
        return label;
    }

    return (
        `${label} between ${featureNameOf(
            objects[0]
        )} and ${featureNameOf(
            objects[1]
        )}`
    );
}

/*
 * A feature's own name, for messages that have to say which feature is
 * being measured.
 *
 * Falls back to its type so a feature with no name is still identified
 * - "Beam and Beam" is poor wording, but it is better than a message
 * that names nothing at all.
 */
export function featureNameOf(
    object
) {
    return (
        object?.name ||
        object?.type ||
        "feature"
    );
}

/*
 * A short name for a measurement, for the message that tells the
 * student what the tool has recognised.
 */
export function dimensionChoiceLabel(
    dimensionType
) {
    return (
        enggMeasurement.DIMENSION_TYPES?.[
            dimensionType
        ]?.label ||
        dimensionType
    );
}

/*
 * Turn the armed measurement into a real dimension feature.
 *
 * Goes through the feature factory rather than being built here, so a
 * dimension is named, numbered, selected, undone and saved by exactly
 * the same code as every other feature. It is a feature on a drawing,
 * not a decoration painted over one.
 */
export function commitDimension(
    dimensionType,
    refs,
    placement
) {
    /*
     * ========================================================
     * A VARIABLE DIMENSION ASKS FOR ITS VALUE, NOT FOR THE SCALE
     * ========================================================
     *
     * THIS TEST COMES FIRST, AHEAD OF THE CALIBRATION GATE, and that ordering
     * is the fix. A variable states the STUDENT'S quantity - a symbol, a
     * number, an expression - and measures NOTHING: it has no number to print
     * and therefore no scale to establish. So the calibration question is not
     * merely unnecessary for it, it is wrong: it would ask the student to
     * declare how long a line is in the same breath as telling the tool that
     * the line's length is an unknown.
     *
     * Left behind the gate, a Variable Dimension became the tool that SETS the
     * drawing's scale, which is the opposite of what it is for - and on an
     * uncalibrated sheet nothing happened at all, because the calibration
     * dialog took the placement click.
     */
    if (
        drawingState.activeTool ===
        "variable-dimension"
    ) {
        openVariablePrompt({
            previousObjects: null,
            refs,
            placement
        });

        return null;
    }

    /*
     * THE FIRST DIMENSION ESTABLISHES THE SCALE.
     *
     * A drawing's coordinates are numbers until somebody says how big
     * one of them is, and a dimension has no honest number to print
     * until then. So rather than adding the dimension with a "~" in
     * front of its value and hoping the student notices, the first
     * dimension asks what the geometry they have just measured really
     * is.
     *
     * Nothing is created until that is answered. Cancelling leaves the
     * drawing exactly as it was - no dimension, no scale, no trace -
     * which is the whole reason the question is asked before the commit
     * rather than after it.
     *
     * It applies to Smart Dimension exactly as it does to Dimension:
     * the tool chooses the MEASUREMENT, not whether the drawing has a
     * scale, so both arrive here and both are gated identically.
     */
    if (
        !enggDimensions.isCalibrated(
            drawingState
        )
    ) {
        const measuredUnits =
            dimensionMeasurementInDrawingUnits(
                dimensionType,
                refs
            );

        const pending = {
            dimensionType,
            refs,
            placement
        };

        /*
         * The interaction is released BEFORE the dialog opens, so the
         * armed measurement does not sit behind a modal looking live.
         * It is restored on confirm, which is why the pending work is
         * captured here rather than read back out of the interaction.
         */
        enggDrawingState.clearInteraction(
            drawingState
        );

        enggScaleCalibration.open({
            measuredUnits,

            /*
             * A suggested starting value: the drawing length as if it
             * were millimetres. It saves typing, and it is a
             * suggestion only - confirming it unchanged simply
             * establishes a 1:1 scale, which is a real answer.
             */
            realValue:
                Number(measuredUnits?.toFixed?.(2) ?? measuredUnits),

            unit:
                enggDimensions.readScale(
                    drawingState
                )?.unit || "mm",

            onConfirm: (
                realValue,
                unit
            ) => {
                /*
                 * Recorded through the normal change path, so the
                 * calibration is undoable and survives save and load
                 * exactly as any other document change does.
                 */
                enggDrawingState.commitDrawingChange(
                    drawingState,
                    enggDrawingState.snapshotDrawing(
                        drawingState
                    )
                );

                enggDimensions.calibrate(
                    drawingState,
                    measuredUnits,
                    realValue,
                    unit
                );

                renderProperties();
                renderCurrentDrawing();

                /*
                 * The same commit as an ordinary one, now with a
                 * scale to state the measurement in. Every dimension
                 * on the sheet updates from here, because they all read
                 * the one document scale.
                 */
                commitDimensionNow(
                    pending
                );
            },

            onCancel: () => {
                setToolMessage(
                    "Dimension cancelled - the drawing scale was not set"
                );

                renderCurrentDrawing();
            }
        });

        renderCurrentDrawing();

        return null;
    }

    return commitDimensionNow({
        dimensionType,
        refs,
        placement
    });
}

/*
 * The measured length in DRAWING UNITS, for the calibration question.
 *
 * Deliberately the raw drawing measurement, not a formatted one: the
 * dialog states the drawing length and asks for the real length, and a
 * number dressed up in a unit the document does not yet have would make
 * that comparison meaningless.
 */
function dimensionMeasurementInDrawingUnits(
    dimensionType,
    refs
) {
    /*
     * A probe dimension, used only to measure. It is never added to the
     * drawing, so nothing is created and nothing is selected.
     */
    const probe =
        enggDrawingState.geometryFactories
            .dimension({
                dimensionType,
                refs,
                placement: { x: 0, y: 0 }
            });

    const measurement =
        enggDimensionModel.measurementFor(
            probe,
            drawingState
        );

    return measurement?.value;
}

/*
 * Commit a dimension whose scale question is already settled.
 *
 * Split out from the gate above so the actual creation has exactly one
 * implementation: the calibrated path and the just-calibrated path run
 * identical code, rather than one calling the other and leaving it
 * unclear which is the real one.
 */
/*
 * Whether the drawing already states this measurement.
 *
 * A thin local wrapper over the dimension model's own redundancy check, asked
 * with the same `{ dimensionType, refs }` shape a proposal uses - so the check
 * that suppresses a redundant dimension during inference and the check that
 * decides a new dimension defaults to Driven are the SAME rule, read the same
 * way.
 */
function isAlreadyStated({ dimensionType, refs }) {
    try {
        return enggDimensionModel.alreadyStated(
            { dimensionType, refs },
            drawingState
        );
    } catch (error) {
        return false;
    }
}

function commitDimensionNow({
    dimensionType,
    refs,
    placement
}) {
    const previousObjects =
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    /*
     * WHICH KIND OF FEATURE THE STUDENT IS PLACING.
     *
     * The two tools share this whole path - the reference picking, the
     * placement click, the commit, the selection - and differ only in what is
     * created at the end. That is deliberate: a Variable Dimension is placed
     * exactly like a dimension, because attaching it to the geometry is what
     * makes it a statement ABOUT the drawing rather than a note beside it.
     *
     * A variable is created with the DEFAULT SYMBOL and no measurement. It never
     * touches the calibration question either, because there is no measured
     * length to convert - an unknown has no units until the student gives it
     * one.
     */
    /*
     * ========================================================
     * A DIMENSION IS COMMITTED HERE; A VARIABLE NEVER REACHES IT
     * ========================================================
     *
     * A Variable Dimension was answered for at the top of this function - it
     * asked the student for its value before anything was created - so by the
     * time the code arrives here the tool is Smart Dimension or Dimension and
     * the feature is a measured dimension.
     */
    const object = enggDrawingState.geometryFactories.dimension({
        dimensionType,
        refs,
        placement,

        /*
         * ====================================================
         * A NEW DIMENSION DEFAULTS TO DRIVING - UNLESS IT IS REDUNDANT
         * ====================================================
         *
         * The requirement is that a new dimension Driving by default whenever
         * the geometry can reliably support it, and Driven when it would make
         * the drawing redundant or otherwise unable to solve - WITH AN
         * EXPLANATION.
         *
         * The one redundancy this build can detect without a constraint solver
         * is "this same measurement is already stated on the sheet": the
         * `alreadyStated` check the inference already uses. A second dimension
         * of the same measurement of the same geometry is exactly the
         * over-dimensioning a checker marks down, so it is created as DRIVEN -
         * it still reports the value, in the Driven colour, and the student is
         * told why.
         *
         * Everything else is Driving, which is what an ordinary dimension on
         * geometry that can support it should be.
         */
        driven: isAlreadyStated({ dimensionType, refs })
    });

    enggDrawingState.addObject(
        drawingState,
        object
    );

    enggDrawingState.commitDrawingChange(
        drawingState,
        previousObjects
    );

    enggDrawingState.clearInteraction(
        drawingState
    );

    /*
     * Selected after creation so the student can move or delete it
     * straight away - which is the commonest thing anyone wants to do
     * with a dimension they have just placed.
     */
    enggDrawingState.selectObject(
        drawingState,
        object.id
    );

    const measured =
        enggDimensionModel.formatMeasurement(
            object,
            drawingState
        );

    setToolMessage(
        object.driven
            ? `Dimension placed as Driven - ${measured} - this measurement is already stated`
            : measured
              ? `Dimension placed - ${measured}`
              : "Dimension placed"
    );

    renderProperties();
    renderCurrentDrawing();

    return object;
}

/*
 * ========================================================
 * ASK FOR A VARIABLE DIMENSION'S VALUE, THEN CREATE IT
 * ========================================================
 *
 * THE SAME POPUP every other value in the application is entered through -
 * `openLoadValuePopup`, the component a Length and a Force use. It is not a
 * second dialog: it is the existing one, opened with `expression: true`, which
 * is the ONE difference a Variable Dimension needs.
 *
 * WHY THAT MATTERS BEYOND TIDINESS. A student learns one value box: one place
 * it appears, one set of keys, one way to confirm and cancel. A bespoke
 * variable dialog would be a second thing to learn for the same act, and the
 * first variable a student ever makes is exactly when they have the least
 * patience for that.
 *
 * The prompt comes AFTER the geometry is chosen and the dimension placed, so
 * the answer is given with the thing being named already on screen.
 */
function openVariablePrompt({ previousObjects, refs, placement }) {
    /*
     * THE TITLE NAMES WHAT IS BEING NAMED, from the dimension type the
     * SELECTION inferred - the same inference Smart Dimension uses. So a pair
     * of non-parallel lines asks for an angle, and a single line asks for a
     * length, without the student having told the tool which it was.
     */
    const dimensionType = drawingState.interaction.dimensionChoice;

    openLoadValuePopup({
        title: "Variable Dimension",
        label: variablePromptLabel(dimensionType),
        value: "",

        /*
         * EXPRESSION MODE. A symbol or an expression is accepted and handed
         * back verbatim; a plain number is accepted too. The unit control is
         * absent, because an unknown quantity has no unit until the student
         * gives it one.
         */
        expression: true,

        /*
         * CONTENT IS MANDATORY ON CREATION.
         *
         * A blank Variable Dimension must never be committed, so an empty box
         * is refused and the editor stays open for correction. This is the one
         * place the requirement differs from every other value prompt.
         */
        requireContent: true,

        onConfirm: ({ text }) => {
            /*
             * ====================================================
             * CONTENT IS REQUIRED - A BLANK VARIABLE IS NEVER CREATED
             * ====================================================
             *
             * The popup refuses an empty field before reaching here, and this
             * guards the same rule a second time so no future caller can create
             * a blank Variable Dimension by another route. An empty answer
             * abandons the creation WITHOUT creating a feature, without an undo
             * entry and without a placeholder - the interaction is released so
             * the tool is ready for the next attempt.
             */
            const answered = String(text ?? "").trim();

            if (!answered) {
                enggDrawingState.clearInteraction(drawingState);

                setToolMessage(
                    "Variable Dimension needs a value, expression or text - nothing was created"
                );

                renderCurrentDrawing();

                return;
            }

            const previous =
                previousObjects ||
                enggDrawingState.snapshotDrawing(drawingState);

            /*
             * THE CONTENT, KEPT VERBATIM.
             *
             * A number, a unit-aware value, an expression, a variable or
             * custom text - whatever the student wrote is stored as the symbol
             * and shows on the sheet. There is deliberately NO "measured
             * value" case: the geometry the student selected decided the
             * dimension TYPE, and it never becomes the value. A 100-long line
             * named `L` states `L`, not `100 mm`.
             */
            const object =
                enggDrawingState.geometryFactories["variable-dimension"]({
                    refs,
                    placement,
                    symbol: answered,
                    unknown: false
                });

            /*
             * THE DIMENSION TYPE THE SELECTION IMPLIED IS KEPT ON THE FEATURE,
             * so a variable can be drawn the same way a dimension is - an
             * angular variable gets an arc, a linear one gets a dimension line -
             * and `variable-dimension` remains a sibling of `dimension` rather
             * than a second, differently-shaped thing.
             */
            object.dimensionType = dimensionType || null;

            enggDrawingState.addObject(drawingState, object);

            enggDrawingState.commitDrawingChange(
                drawingState,
                previous
            );

            enggDrawingState.clearInteraction(drawingState);

            enggDrawingState.selectObject(drawingState, object.id);

            setToolMessage(`Variable placed - ${object.symbol}`);

            renderProperties();
            renderCurrentDrawing();
        },

        onCancel: () => {
            /*
             * NOTHING WAS CREATED, so nothing is undone. The interaction is
             * released so the tool is ready for the next attempt rather than
             * sitting behind a half-placed dimension.
             */
            enggDrawingState.clearInteraction(drawingState);

            setToolMessage("Variable Dimension cancelled");

            renderCurrentDrawing();
        }
    });
}

/*
 * What the prompt calls the value it wants.
 *
 * Named after the QUANTITY the student just selected, so the question reads as
 * a question about their drawing: "Angle" is a different answer from "Length".
 */
function variablePromptLabel(dimensionType) {
    return (
        {
            angular: "Angle",
            "point-line": "Distance",
            horizontal: "Length",
            vertical: "Length",
            aligned: "Length",
            linear: "Length",
            diameter: "Diameter",
            radius: "Radius"
        }[dimensionType] || "Value"
    );
}

/*
 * ========================================================
 * DOUBLE-CLICKING A DIMENSION EDITS ITS VALUE
 * ========================================================
 *
 * The SAME popup every other value in the application is entered through - the
 * component a Length, a Force and a moment magnitude use. A dimension used to
 * open its own editor, whose first question was the sheet's World Scale; that
 * is a question about the DRAWING, not about the dimension, and it arrived
 * every time a student simply wanted to change a number.
 *
 * WHAT THE TWO KINDS EXPECT IS THE ONLY DIFFERENCE:
 *
 *   Smart Dimension    a measured value, shown so it can be corrected
 *   Variable Dimension the student's own symbol or expression, shown so it can
 *                      be edited
 *
 * Both keep their REFERENCES whatever is typed - the popup changes what the
 * dimension SAYS, never what it is attached to.
 */
export function openDimensionValuePrompt(object) {
    if (!object) {
        return false;
    }

    const variable =
        object.type === "variable-dimension";

    /*
     * A VARIABLE DIMENSION'S CURRENT TEXT IS ITS SYMBOL, read from the FEATURE
     * - which is where the model stores it and where the panel reads it. An
     * empty symbol opens as an empty field, which is a real state: named but
     * not yet written.
     *
     * A SMART DIMENSION'S IS ITS MEASUREMENT, read live so the field shows the
     * number the dimension is currently stating.
     */
    const current = variable
        ? object.symbol ?? ""
        : enggDimensionModel.formatMeasurement(
              object,
              drawingState
          ) || "";

    openLoadValuePopup({
        title: variable ? "Variable Dimension" : "Dimension",
        label: variable
            ? variablePromptLabel(object.dimensionType)
            : "Value",

        /*
         * A LENGTH UNIT IS A SELECTABLE UNIT, so the non-expression path is
         * used for a measured dimension - it offers the sheet's own length
         * units and reads a typed unit out of the field. A variable has no
         * unit until the student gives it one, so it takes the expression
         * path, where the unit control is absent and the text is the value.
         */
        value: current,
        expression: variable,
        units: variable ? undefined : MEASURED_UNITS,

        /*
         * ====================================================
         * THE PREVIEW WHILE THE STUDENT IS STILL TYPING
         * ====================================================
         *
         * The popup reported nothing as the value changed, so a size was chosen
         * blind: the drawing only moved once the edit was confirmed. This draws
         * the PROPOSED result as it is typed, and takes it back if the edit is
         * abandoned - which is the whole difference between a preview and an
         * edit.
         *
         * IT IS SAVED AND RESTORED, NOT COMMITTED.
         *
         * The snapshot below is the state BEFORE the first preview, and it is what
         * `onCancel` and the close path restore from. Nothing goes through
         * `commitDrawingChange` while previewing, so the HISTORY never sees a
         * preview: an abandoned edit leaves no undo step behind, and a confirmed
         * one is a single step from the geometry as it was.
         *
         * A VARIABLE IS NOT PREVIEWED THIS WAY. It carries the student's own
         * symbol rather than a measurement, and nothing about the drawing follows
         * from it - so there is nothing to draw, and no geometry is touched.
         */
        onPreview: (draft) => {
            if (variable) {
                return;
            }

            if (!previewSnapshot) {
                previewSnapshot = enggDrawingState.snapshotDrawing(drawingState);
            }

            previewGeometryValue(object, drawingState, draft);

            renderCurrentDrawing();
        },

        onConfirm: (confirmed) => {
            /*
             * A CONFIRMED EDIT IS NOT A PREVIEW ANY MORE.
             *
             * The snapshot taken for the preview is DISCARDED (not restored), so
             * nothing later can roll back an edit the student confirmed - and the
             * undo step is taken from the geometry as it was BEFORE the preview
             * began, which is what makes one edit one step back even though the
             * preview moved the drawing many times.
             */
            const previous =
                previewSnapshot ||
                enggDrawingState.snapshotDrawing(drawingState);

            previewSnapshot = null;

            if (variable) {
                /*
                 * THE STUDENT'S OWN VALUE, KEPT VERBATIM.
                 *
                 * An empty field means UNKNOWN - the student was asked and
                 * said "not known" - which is stored as that statement rather
                 * than as an empty symbol, so the sheet and the panel can tell
                 * it apart from a variable nobody has written yet.
                 *
                 * Nothing is measured and nothing is substituted: this
                 * dimension states what the student wrote.
                 */
                const answered = String(confirmed.text ?? "").trim();

                object.symbol = answered;
                object.unknown = !answered;
            } else {
                /*
                 * ====================================================
                 * A MEASURED DIMENSION IS DRIVEN, NOT OVERWRITTEN
                 * ====================================================
                 *
                 * THE NUMBER IS APPLIED TO THE GEOMETRY, and the dimension
                 * then MEASURES it as it always has. Nothing numeric is stored
                 * on the dimension itself - see the head of dimension-model.js
                 * - so a dimension can never become a frozen label, and the
                 * Features panel and the sheet cannot disagree: both read the
                 * same measurement on every frame.
                 *
                 * THIS IS WHY `applyStaticsValue` IS NOT USED HERE. That writes
                 * a magnitude ONTO the feature, which would be a second copy of
                 * a number the geometry already owns - free to go stale the
                 * moment anything moved, and exactly the "static value after the
                 * first definition" the requirement forbids.
                 */
                const answer = readStaticsValue(
                    confirmed.text ?? "",
                    confirmed.unit
                );

                if (answer.kind === "number") {
                    /*
                     * THE TYPED UNIT IS A LENGTH UNIT. The measured-units
                     * list includes N and kN so the same popup can serve a
                     * force-labelled readout, but a number typed WITH such a
                     * suffix into a length dimension is a category error the
                     * student would not see - it would drive the geometry to
                     * a length of "1 newton". The value is converted through
                     * the length table only when the suffix names a length
                     * unit; anything else is refused, and the last valid
                     * measurement stands.
                     */
                    if (
                        answer.unit &&
                        !enggQuantities?.isUnitFor?.("length", answer.unit)
                    ) {
                        setToolMessage(
                            `A dimension measures a length - "${answer.unit}" is not a length unit`
                        );

                        previewSnapshot = null;

                        return;
                    }

                    const millimetres =
                        answer.value *
                        (enggQuantities?.LENGTH_UNITS?.[
                            answer.unit
                        ]?.mm ?? 1);

                    /*
                     * ================================================
                     * EDITING A DRIVEN DIMENSION PROMOTES IT TO DRIVING
                     * ================================================
                     *
                     * A Driven dimension cannot move geometry - that is what
                     * Driven means. Typing a value into one is the student's
                     * request to make it CONTROL the geometry, so the promotion
                     * is attempted and only STANDS IF THE GEOMETRY CAN ACTUALLY
                     * BE MOVED to satisfy the value.
                     *
                     * The order matters: the edit is applied while the
                     * dimension is temporarily Driving, and if it is refused
                     * - the measurement is one no typed value can move, such
                     * as an angle between two features - the dimension is put
                     * back to Driven and the geometry is left exactly as it
                     * was. Nothing is half-changed and the state is not
                     * silently relaxed.
                     */
                    const wasDriven = object.driven === true;

                    if (wasDriven) {
                        object.driven = false;
                    }

                    const applied = enggDimensionEdit.applyDimensionValue(
                        object,
                        drawingState,
                        millimetres
                    );

                    if (wasDriven && !applied?.ok) {
                        object.driven = true;

                        setToolMessage(
                            "This dimension cannot drive the geometry - it stays Driven"
                        );
                    }
                } else if (answer.kind === "symbol") {
                    /*
                     * A SYMBOL ON A DIMENSION IS ITS LABEL, which the panel
                     * already shows; the measurement is left driving beside it.
                     */
                    object.magnitudeLabel = answer.text;
                }
            }

            /*
             * THE REFERENCES ARE UNTOUCHED. `sourceRefs` is not written here
             * at all, so the dimension is still measuring the same geometry - a
             * value edit changes what it SAYS, never what it is attached to.
             */
            enggDrawingState.commitDrawingChange(
                drawingState,
                previous
            );

            setToolMessage(
                variable
                    ? `Variable Dimension updated - ${object.symbol || "empty"}`
                    : `Dimension updated - ${
                          enggDimensionModel.formatMeasurement(
                              object,
                              drawingState
                          ) || "Unknown"
                      }`
            );

            renderProperties();
            renderCurrentDrawing();
        },

        onCancel: () => {
            /*
             * AN ABANDONED EDIT PUTS THE DRAWING BACK.
             *
             * The preview moved real geometry, so cancelling has to restore the
             * snapshot taken before the first keystroke - otherwise Escape would
             * leave the geometry at whatever the last preview drew, which is an
             * edit the student did not make and never confirmed.
             */
            restorePreview();

            setToolMessage("Dimension edit cancelled");

            renderCurrentDrawing();
        }
    });

    return true;
}

/*
 * ========================================================
 * THE PREVIEW, AND HOW IT IS UNDONE
 * ========================================================
 *
 * A preview writes the PROPOSED value through the very same path a committed
 * edit uses (`applyDimensionValue`), so what is drawn while typing is exactly
 * what will be drawn on confirmation - not an approximation that could differ.
 *
 * The state before the first preview is kept in `previewSnapshot`, and it is the
 * ONE thing `restorePreview` needs: putting the geometry back is the drawing
 * system's own restore, so this module does not have to know which fields the
 * preview touched.
 */
let previewSnapshot = null;

function previewGeometryValue(object, state, draft) {
    if (!draft) {
        return;
    }

    /*
     * THE POPUP REPORTS A READ VALUE, not a raw string.
     *
     * `readLoadValue` has already turned the field into `{ value, unit }` - or
     * into a symbol, which carries no number - and a preview is only meaningful
     * for the numeric case. A symbol edits the dimension's TEXT, which the
     * renderer reads on the next frame anyway, so there is nothing to move.
     *
     * A HALF-TYPED VALUE IS NOT A VALUE. An empty or non-finite field leaves the
     * preview exactly as it was rather than collapsing the geometry to zero - the
     * same rule the numeric setters follow.
     */
    /*
     * THE POPUP REPORTS A READ VALUE, NOT A RAW STRING.
     *
     * `readLoadValue` has already turned the field into `{ value, unit }` - or
     * into a SYMBOL, which carries no number - and a preview is only meaningful
     * for the numeric case. In expression mode it reports `{ text }` instead, and
     * that is read the same way `onConfirm` reads it, so a preview and a commit
     * cannot interpret the same keystrokes differently.
     *
     * A HALF-TYPED VALUE IS NOT A VALUE. An empty or non-finite field leaves the
     * preview exactly as it was rather than collapsing the geometry to zero - the
     * same rule the numeric setters follow.
     */
    /*
     * TWO SHAPES, BOTH FROM THE SAME POPUP: `{ text }` in expression mode, and
     * `readLoadValue`'s `{ value, unit }` otherwise. A SYMBOL reports a `text`
     * that does not read as a number, and is correctly ignored here - it changes
     * what the dimension SAYS, not where the geometry is.
     */
    const numeric =
        typeof draft.value === "number"
            ? draft.value
            : readStaticsValue(draft.text ?? "", draft.unit).value;

    const unit = draft.unit;

    if (!Number.isFinite(numeric)) {
        return;
    }

    const millimetres =
        numeric *
        (enggQuantities?.LENGTH_UNITS?.[unit]?.mm ?? 1);

    if (!Number.isFinite(millimetres)) {
        return;
    }

    enggDimensionEdit.applyDimensionValue(object, state, millimetres);
}

/*
 * Take the preview back off the drawing. Safe to call when there was none.
 */
function restorePreview() {
    if (!previewSnapshot) {
        return false;
    }

    const snapshot = previewSnapshot;

    previewSnapshot = null;

    /*
     * A SNAPSHOT IS A DOCUMENT, NOT A BARE LIST.
     *
     * `snapshotDrawing` returns `{ objects, sheets? }`, and `restoreObjects`
     * wants the OBJECTS inside it - which is exactly how Undo calls it
     * (`entry.objects || entry`). Passing the wrapper was a real fault: it left
     * `state.objects` as an object rather than an array, so the very next lookup
     * threw. The fallback keeps a bare list working, so the two shapes are both
     * accepted rather than the caller having to know which it holds.
     */
    enggDrawingState.restoreObjects(drawingState, snapshot.objects || snapshot);

    return true;
}

/*
 * The units a measured dimension may be stated in, offered by the popup.
 */
/*
 * THE UNITS A MEASURED DIMENSION CAN BE READ IN.
 *
 * The length units are the quantity's own, from the shared table - the
 * literal list this replaced was a second copy that would drift from it.
 * N and kN are appended so the same popup can serve a readout that is a
 * force, but a number typed WITH a force suffix into a length dimension is
 * refused on confirm (see the onConfirm path), never silently converted.
 */
const MEASURED_UNITS = [
    ...(
        enggQuantities?.unitsFor?.("length") || ["mm", "cm", "m", "in", "ft"]
    ),
    "N",
    "kN",
];

/*
 * WHICH FEATURE IS BEING DIMENSIONED
 *
 * A click does not always land ON a feature. objectAtPoint finds the
 * nearest EDGE, which is right for selecting a line but wrong for a
 * body: clicking in the middle of a Beam, a Rectangle or a Truss finds
 * nothing, so those features could only ever be dimensioned by hitting
 * their outline. For a tool whose whole job is to measure a feature,
 * that is not good enough.
 *
 * So when the edge test misses, the click is resolved against each
 * feature's own ANCHORS - the points the measurement system already
 * says this feature can be measured from - and the nearest one within
 * a screen-sized radius wins.
 *
 * Reusing the anchors rather than inventing a second set of hit
 * shapes means the thing the student clicks near is the same thing the
 * dimension will be measured from, which is why a Beam is picked by
 * its ends and a Circle by its own extent rather than by a bounding
 * box that may be far larger than either.
 */
export function findDimensionTarget(
    point
) {
    const direct =
        objectAtPoint(point);

    if (direct) {
        return direct;
    }

    /*
     * A radius of about twelve screen pixels, expressed in world
     * units so it stays the same physical size on screen at any zoom.
     *
     * That radius is right for a feature that IS its anchors - a line,
     * a beam, a shaft - because clicking anywhere along one is within
     * reach of an end.
     */
    const radius =
        12 /
        Math.max(
            enggDrawingState
                .BASE_PIXELS_PER_UNIT *
                drawingState.camera.zoom,
            0.0001
        );

    let best = null;
    let bestDistance = radius;

    for (const object of drawingState.objects) {
        /*
         * A dimension is not something to dimension. Skipping it
         * keeps a dimension from being measured by another dimension,
         * which would be a dimension describing a number rather than
         * the drawing.
         */
        if (
            object.type === "dimension" ||
            object.type === "annotation"
        ) {
            continue;
        }

        let anchors;

        try {
            /*
             * anchorOptions returns the NAMES a feature can be
             * measured from, not their positions - asking it for
             * points found nothing, which is why a click in the
             * middle of a rectangle never resolved to the rectangle.
             * anchorNames plus resolveAnchor is the same information
             * with the coordinates attached, and resolveAnchor is what
             * the measurement itself uses, so this stays on exactly
             * the geometry the dimension will be taken from.
             */
            anchors =
                (enggMeasurement.anchorOptions(object) || [])
                    .map(
                        name => ({
                            name: String(name),
                            at: enggMeasurement.resolveAnchor(
                                object,
                                name
                            )
                        })
                    );
        } catch (error) {
            anchors = null;
        }

        /*
         * Each anchor is kept with the NAME it was resolved from, because the
         * name is what says whether it is a corner or a midpoint - the array
         * INDEX says nothing. A midpoint lies on the outline and must not be
         * treated as a corner in the interior test below.
         */
        const points = (anchors || [])
            .map((entry) => ({
                name: entry.name,
                ...(entry.at || {})
            }))
            .filter(
                anchor =>
                    Number.isFinite(anchor.x) &&
                    Number.isFinite(anchor.y)
            );

        if (points.length === 0) {
            continue;
        }

        /*
         * INSIDE THE FEATURE
         *
         * The radius alone is not enough for a body. A rectangle's
         * anchors are its four CORNERS, so the middle of a wide
         * rectangle can be a hundred pixels from every one of them -
         * which is exactly where a student aims when they want to
         * dimension it.
         *
         * THE OUTLINE IS THE FEATURE'S UNIQUE CORNERS, IN ORDER.
         *
         * A triangle publishes nine anchors - start, midpoint and end for each
         * of its three sides - and a side's end is the next side's start. Fed
         * to a crossing test as-is, that list walks each edge twice and counts
         * crossings wrongly, so clicking inside a triangle could resolve to
         * nothing. Taking the corners and dropping repeats leaves the perimeter
         * exactly once, in order, which is what the test needs.
         */
        const cornersForOutline =
            uniqueCornerOutline(points);

        if (
            cornersForOutline.length >= 3 &&
            pointInsideOutline(
                point,
                cornersForOutline
            )
        ) {
            return object;
        }

        /*
         * NEAR THE FEATURE'S SPAN, not merely its endpoints.
         *
         * Anchors are endpoints and centres. A feature that is long
         * between them - a force's arrow, a beam, a cable - has most of
         * its own length far from any of them, so measuring to the
         * anchors alone meant the middle of a 40 mm beam was unclickable
         * while its ends were fine. Clicking a feature means clicking
         * ON it, which is most of it, not the few points it is measured
         * from.
         *
         * So the click is measured against the nearest segment joining
         * the anchors as well. Anchors come from the measurement layer
         * and are the feature's own points, so this is the real shape
         * and not a bounding box that would claim far more than belongs
         * to it.
         */
        for (let i = 1; i < points.length; i += 1) {
            const distance =
                distanceToSegment(
                    point,
                    points[i - 1],
                    points[i]
                );

            if (distance < bestDistance) {
                bestDistance = distance;
                best = object;
            }
        }
    }

    return best;
}

/*
 * The feature's perimeter: its corner anchors, with repeats removed, in the
 * order they were published.
 *
 * A composite feature publishes an anchor per side - a start and an end - and a
 * side's end is the next side's start. Kept as published, the list visits every
 * corner twice and cannot be used as a polygon. Keeping the first occurrence of
 * each corner leaves the outline exactly once, in order.
 *
 * Midpoint anchors are dropped: they lie ON an edge, and a crossing test given
 * a point on its own boundary is a coin toss.
 */
function uniqueCornerOutline(points) {
    const corners = [];

    const seen = (point) =>
        corners.some(
            (kept) =>
                Math.abs(kept.x - point.x) < 1e-9 &&
                Math.abs(kept.y - point.y) < 1e-9
        );

    points.forEach((point) => {
        if (/mid$/i.test(String(point?.name || ""))) {
            return;
        }

        /*
         * A coordinate already on the outline is the SAME corner, however many
         * anchors name it. A triangle publishes its three vertices directly as
         * `a`, `b`, `c`, and again as each side's start and end - keeping every
         * occurrence would visit each corner three times and give the crossing
         * test a shape that is not the triangle.
         */
        if (!seen(point)) {
            corners.push(point);
        }
    });

    return corners;
}

/*
 * Is a point inside the outline its anchors describe?
 *
 * Used only to decide what the student clicked, never to measure
 * anything, so a plain crossing count is enough and an exact answer
 * is not required.
 */
function pointInsideOutline(
    point,
    outline
) {
    let inside = false;

    for (
        let i = 0,
            j = outline.length - 1;
        i < outline.length;
        j = i++
    ) {
        const a = outline[i];
        const b = outline[j];

        const straddles =
            a.y > point.y !== b.y > point.y;

        if (
            straddles &&
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
