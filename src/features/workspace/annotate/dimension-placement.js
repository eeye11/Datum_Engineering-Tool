/*
 * Placing a dimension: reference selection and the placement click.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { circularCandidateDescriptors, dimensionReferenceAtClick, inferDimensionDescriptor } from "./dimension-inference.js";
import { commitDimension, dimensionChoiceLabel, dimensionChoiceMessage } from "./dimension-tool.js";
import { drawingState } from "../editor-state.js";
import { canvasPointFromEvent } from "../../../components/layout/toolbar/tool-activation.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";

/*
 * A click while the dimension tool is active.
 *
 * THE STATE MACHINE
 * -----------------
 * The tool moves through four stages, and a click means a different
 * thing in each:
 *
 *   idle / first   choose a reference. NEVER creates a dimension, even
 *                  when the reference is a whole line - a line is a
 *                  complete reference and moves straight to placement,
 *                  but a single POINT only waits for its partner.
 *   second         the second reference has arrived; infer the type and
 *                  enter placement.
 *   placement      the click places the annotation. It is not another
 *                  reference.
 *
 * The first click is never both a reference and a placement command,
 * which is the whole point of the separation.
 */
export function handleDimensionClick(
    resolution,
    event
) {
    /*
     * THE RESOLVED REFERENCE, NOT THE POINTER.
     *
     * A dimension's references are exact points on the model - an endpoint, a
     * midpoint, a centre - and the only thing that can name one is the shared
     * snap resolver. Reading the raw pointer instead measured whatever happened
     * to be under the cursor to within a pixel, which is why the tool could not
     * tell `endpoint to midpoint` from `endpoint to endpoint`: it never knew
     * which of the two the student had actually hit.
     *
     * Snapped first, then the construction point, then the bare pointer. The
     * last is only reached for a click on genuinely empty space, which has no
     * reference and is refused by the caller rather than measured from a stray
     * coordinate.
     */
    const point =
        resolution.snappedPoint ||
        resolution.effectiveConstructionPoint ||
        canvasPointFromEvent(
            event,
            false
        );

    if (!point) {
        return;
    }

    const interaction =
        drawingState.interaction;

    /*
     * PLACEMENT. The references are settled and this click says where the
     * annotation stands. The measurement is re-read at commit time from
     * the live geometry, so the value stored is always the value NOW.
     */
    if (
        interaction.dimensionStage === "placement" &&
        interaction.dimensionRefs?.length
    ) {
        commitDimension(
            interaction.dimensionChoice,
            interaction.dimensionRefs,
            {
                x: point.x,
                y: point.y
            }
        );

        return;
    }

    const reference = dimensionReferenceAtClick(
        resolution,
        point,
        Boolean(interaction.dimensionFirstRef)
    );

    /*
     * ========================================================
     * AN ARMED SINGLE MEASUREMENT CAN STILL TAKE A PARTNER
     * ========================================================
     *
     * A student who has clicked ONE line has a complete measurement -
     * that line's length - and it previews at once (see
     * `armSingleMeasurement`). But two lines ALSO have a measurement
     * between them: the angle. If clicking the first line threw the tool
     * straight into placement, the second line could never be picked -
     * the next click would only choose where to stand the length
     * dimension, and controlling an angle would be impossible.
     *
     * So while a single measurement is ARMED, a click that lands on
     * another measurable reference ADDS it, and the pair's own
     * measurement (an angle between two lines, a distance between two
     * points) is inferred and previewed in its place. A click on empty
     * space is not a reference: it commits the armed single measurement
     * where it stands, which is the placement gesture.
     */
    if (
        interaction.dimensionStage === "armed" &&
        interaction.dimensionFirstRef
    ) {
        if (!reference) {
            /*
             * A CLICK ON NOTHING PLACES THE MEASUREMENT THE STUDENT
             * ALREADY HAS.
             *
             * The armed length is previewed and following the cursor, so
             * clicking away from every reference is exactly "put it
             * here". The armed descriptor and its refs were captured when
             * the first reference was taken, so committing them here does
             * not depend on this click resolving to anything.
             */
            commitArmedMeasurement(point);

            return;
        }

        acceptSecondDimensionReference(
            interaction.dimensionFirstRef,
            reference,
            point
        );

        return;
    }

    /*
     * Nothing under the cursor, and no reference already chosen: the
     * click has no meaning. Refused rather than measuring from a stray
     * coordinate.
     */
    if (!reference) {
        if (!interaction.dimensionFirstRef) {
            setToolMessage(
                "Specify dimension reference"
            );

            renderCurrentDrawing();
        }

        return;
    }

    /*
     * EVERY CLICK ADDS A REFERENCE. There is no "first" or "second"
     * click any more - the set grows until the student presses Enter,
     * and the measurement is inferred from the whole set then.
     */
    if (!interaction.dimensionFirstRef) {
        acceptFirstDimensionReference(
            reference,
            point
        );

        return;
    }

    acceptSecondDimensionReference(
        interaction.dimensionFirstRef,
        reference,
        point
    );
}

/*
 * The first reference has been chosen.
 *
 * A reference that MEASURES ON ITS OWN - a Line, Beam, Truss, Cable, Shaft,
 * Reference Line, Circle or Arc - is ARMED: its length, diameter or radius is
 * previewed at once and follows the cursor. A single POINT is genuinely
 * incomplete and simply waits for its partner.
 *
 * ARMED IS NOT PLACED. The measurement is previewed but the tool is still
 * selecting, so a second reference can be added on the next click - which is
 * what makes an angle between two lines reachable at all. The placement click
 * is the click that lands on no reference (or Enter).
 */
function acceptFirstDimensionReference(
    reference,
    point
) {
    beginDimensionReferenceSelection(
        reference,
        point
    );
}

/*
 * Hold a complete single-object measurement, previewing it while still
 * accepting a second reference.
 *
 * This is the step that makes BOTH workflows possible at once. The first
 * click on a line shows its length immediately - no waiting on Enter, no
 * empty screen - but the tool does not commit, so a second click on another
 * line can still turn the pair into an angle. `dimensionStage` is "armed"
 * (not "placement") to mark that distinction: the preview follows the
 * cursor, but the next click is not automatically a placement.
 */
/*
 * The candidate measurements to offer for an armed reference.
 *
 * A circle or an arc offers SEVERAL - the same reference measured as diameter,
 * radius or arc length - so Tab can cycle them; every other shape contributes its
 * single inferred descriptor. Kept as one short call at each site so the armed
 * interaction object stays compact and the two stages cannot drift apart.
 */
function candidatesForReference(reference, descriptor) {
    return reference?.kind === "circular"
        ? circularCandidateDescriptors(reference)
        : [descriptor];
}

function armSingleMeasurement(
    reference,
    descriptor,
    point
) {
    /*
     * A CIRCLE OR AN ARC ARMS SEVERAL CANDIDATES, not just the one the cursor
     * preferred: the same reference measured as diameter, radius or arc length.
     * Every other shape contributes one, and `circularCandidateDescriptors`
     * returns exactly that single candidate for them - so Tab has somewhere to go
     * only where the geometry genuinely offers alternatives.
     */
    enggDrawingState.setInteraction(
        drawingState,
        {
            dimensionStage: "armed",
            dimensionPickedRefs: [reference],
            dimensionFirstRef: reference,
            dimensionFirstPoint: {
                x: point.x,
                y: point.y
            },
            dimensionSecondRef: null,
            dimensionChoice: descriptor.dimensionType,
            dimensionTarget:
                reference?.featureId || null,
            dimensionTargets: [reference.featureId].filter(Boolean),
            dimensionCandidates: candidatesForReference(reference, descriptor),
            dimensionRefs: descriptor.refs,
            dimensionPlacement: {
                x: point.x,
                y: point.y
            }
        }
    );

    setToolMessage(
        dimensionChoiceLabel(
            descriptor.dimensionType
        ) +
            " - click another reference for an angle, or click empty space to place, Esc to cancel"
    );

    renderCurrentDrawing();
}

/*
 * Place the measurement that is currently armed.
 *
 * Called by the click that resolved to no reference - the student clicked
 * away from every feature, which is the placement gesture - and by the Enter
 * key. The armed choice and refs are committed at the clicked point, through
 * the same `commitDimension` every other path uses, so the value, the
 * calibration question and the single undo entry are identical.
 */
function commitArmedMeasurement(
    point
) {
    const interaction =
        drawingState.interaction;

    if (
        interaction.dimensionStage !== "armed" ||
        !interaction.dimensionRefs?.length
    ) {
        return false;
    }

    commitDimension(
        interaction.dimensionChoice,
        interaction.dimensionRefs,
        {
            x: point.x,
            y: point.y
        }
    );

    return true;
}

/*
 * Add a reference to the current selection and keep selecting.
 *
 * The reference is stored whole - its feature, its anchor, its kind -
 * rather than as a resolved coordinate, so the measurement can be
 * taken from LIVE geometry at the moment the student presses Enter,
 * and so the resulting dimension keeps referring to the geometry it
 * was measured from.
 */
export function beginDimensionReferenceSelection(
    reference,
    point
) {
    const interaction = drawingState.interaction;

    const refs = [
        ...(interaction.dimensionPickedRefs || []),
        reference
    ];

    /*
     * ========================================================
     * ONE MEASURABLE WHOLE IS A DIMENSION ALREADY
     * ========================================================
     *
     * A Line, Beam, Truss, Cable, Shaft, Reference Line, Circle or Arc clicked
     * ON ITS OWN is a finished reference: it has a length, a diameter or a
     * radius, and nothing else is needed to state it. So the tool moves into
     * placement on that FIRST click and the preview appears at once, following
     * the cursor until the student clicks to place it.
     *
     * This is what makes the interaction continuous. It used to record the
     * click and wait for Enter, so a student who had just clicked a line saw
     * nothing at all - no number, no preview, no sign the tool had understood -
     * and had to be told that a keystroke was needed before anything would
     * happen.
     *
     * A SINGLE POINT still waits, because it is the one reference that is
     * genuinely incomplete: a point has no length, and a distance needs a
     * partner. Waiting there is honest rather than pedantic.
     */
    if (refs.length === 1 && reference?.kind !== "point") {
        const descriptor = inferDimensionDescriptor(reference, null);

        if (descriptor?.refs?.length) {
            armSingleMeasurement(reference, descriptor, point);

            return;
        }
    }

    /*
     * TWO REFERENCES THAT ALREADY MEASURE GO STRAIGHT TO PLACEMENT.
     *
     * Two lines state an angle, and two points state a distance - in both cases
     * the measurement is COMPLETE on the click that finished it, so there is
     * nothing left to pick and the tool moves to placement at once. The preview
     * appears immediately and follows the cursor until the student clicks to
     * place it.
     *
     * WITHOUT THIS THE SECOND CLICK ONLY RECORDED the reference and the tool
     * kept selecting, so a student who had clicked two lines saw no angle, no
     * preview and no sign the tool had understood - the measurement appeared
     * only if they happened to press Enter. That is the step being removed.
     */
    if (refs.length === 2) {
        const descriptor = inferDimensionDescriptor(refs[0], refs[1]);

        if (descriptor?.refs?.length && descriptorIsComplete(descriptor, refs)) {
            beginDimensionPlacement(refs[1], descriptor, point, refs
                .map((r) => r.featureId)
                .filter(Boolean));

            return;
        }
    }

    enggDrawingState.setInteraction(
        drawingState,
        {
            dimensionStage: "selecting",
            dimensionPickedRefs: refs,
            dimensionFirstRef: refs[0] ?? null,
            dimensionFirstPoint: {
                x: point.x,
                y: point.y
            },
            dimensionSecondRef: refs[1] ?? null,
            dimensionRefs: null,
            dimensionChoice: null,
            dimensionPlacement: null,
            dimensionTargets: refs
                .map(r => r.featureId)
                .filter(Boolean)
        }
    );

    setToolMessage(
        dimensionSelectionInstruction(refs)
    );

    renderCurrentDrawing();
}

/*
 * What the tool says while references are being chosen.
 *
 * THE WORDING MUST MATCH WHAT ENTER WILL ACTUALLY DO, which is the
 * whole reason it is worth being careful with.
 *
 * A complete, measurable object - a Line, Beam, Truss, Cable, Shaft,
 * Reference Line, Circle or Arc - IS a finished dimension reference the
 * moment it is clicked. Telling a student who has just clicked a Beam
 * to "keep picking" was a lie about a complete selection, and the old
 * pair-only inference then made it true by refusing the measurement.
 * So a single measurable object says its measurement is available and
 * names it, because the name is what tells the student which number
 * they are about to get.
 *
 * A single POINT is the one reference that is genuinely incomplete: it
 * has no length, an angle needs two directions, and a distance needs a
 * partner. It is worded as what it is - a point waiting for another
 * reference - rather than as a feature that failed.
 *
 * Two or more references describe the SET. Two lines name the angle
 * outright, because that is the one outcome that is not obvious from
 * the pair and is the one most often expected.
 */
export function dimensionSelectionInstruction(refs) {
    const count = refs.length;

    if (count < 1) {
        return "Specify dimension reference";
    }

    if (count === 1) {
        const only = refs[0];

        /*
         * A point is not a measurement yet. Everything else that can be
         * clicked and measured IS one, and its kind names the number:
         * a line and its length-forms give Length, a circle Diameter,
         * an arc Radius.
         */
        if (only?.kind === "point") {
            return "1 point selected - pick another reference, or press Enter";
        }

        const available =
            only?.kind === "circle"
                ? "Diameter"
                : only?.kind === "arc"
                  ? "Radius"
                  : "Length";

        return `1 selected - ${available} available - press Enter to dimension`;
    }

    const lines = refs.filter(r => r.kind === "line");

    if (lines.length === count) {
        return `${count} lines selected - press Enter to create angle`;
    }

    return `${count} references selected - press Enter to dimension`;
}

/*
 * The second reference has been chosen.
 */
function acceptSecondDimensionReference(
    first,
    second,
    point
) {
    /*
     * A click that resolved to no reference - empty canvas - is not a
     * failed pair, it is a click that chose nothing. The references
     * already picked are kept and the tool goes on asking, without
     * accusing the student of picking two things that do not measure.
     */
    if (!second) {
        setToolMessage(
            dimensionSelectionInstruction(
                drawingState.interaction.dimensionPickedRefs || []
            )
        );

        renderCurrentDrawing();

        return;
    }

    const descriptor = inferDimensionDescriptor(
        first,
        second
    );

    /*
     * THE STUDENT HASN'T SAID "NOW" YET.
     *
     * The second reference is RECORDED, exactly like the first, and
     * the tool keeps selecting. A dimension is inferred from the
     * references at the moment Enter is pressed, not on the click
     * that happened to complete the pair - so a student who has just
     * clicked two lines can still click a third, or change their
     * mind, without the tool having already measured something they
     * did not ask for.
     */
    if (!descriptor?.refs?.length) {
        /*
         * Nothing measurable between these two. The second is dropped
         * and the first kept, so the student is not left with a dead
         * selection and can simply click something else.
         */
        setToolMessage(
            "Those references have nothing to measure between them - specify another"
        );

        renderCurrentDrawing();

        return;
    }

    /*
     * ========================================================
     * A COMPLETE MEASUREMENT GOES STRAIGHT TO PLACEMENT
     * ========================================================
     *
     * Two references that MEASURE something - a line and a line giving an
     * angle, two points giving a distance - are the whole answer, so the tool
     * moves into placement on the click that completed them. The preview appears
     * immediately and follows the cursor, and the next click places it.
     *
     * ENTER IS NOT REQUIRED, and that is the point. It used to be: the second
     * click only RECORDED the reference and the tool kept selecting, so the
     * student saw nothing until they pressed Enter. Nothing on screen told them
     * the tool had understood, and a workflow that waits for a keystroke before
     * showing anything is one the student has to be taught.
     *
     * A selection that is NOT yet complete still waits, because there is nothing
     * to preview: one point needs a partner, and a lone line is a length the
     * student may or may not want. Enter still exists for those cases, so the
     * deliberate workflow is preserved rather than replaced.
     */
    if (descriptorIsComplete(descriptor, [first, second])) {
        beginDimensionPlacement(
            second,
            descriptor,
            drawingState.interaction.dimensionFirstPoint,
            [first, second].map((r) => r.featureId).filter(Boolean)
        );

        return;
    }

    enggDrawingState.setInteraction(
        drawingState,
        {
            dimensionPickedRefs: [
                ...(drawingState.interaction.dimensionPickedRefs || []),
                second
            ]
        }
    );

    setToolMessage(
        dimensionSelectionInstruction(
            drawingState.interaction.dimensionPickedRefs
        )
    );

    renderCurrentDrawing();
}

/*
 * Whether two references already MEASURE something, so the tool can move
 * straight to placement rather than waiting for Enter.
 *
 * The test is what the descriptor can actually state:
 *
 *   two LINES      an angle - both directions are known, so the measurement is
 *                  complete and there is nothing else to pick
 *   two POINTS     a distance - the span between them is the whole answer
 *
 * A POINT AND A LINE, or a single reference, can still go further - a point may
 * want a second point, a line may be measured alone - so those keep the
 * deliberate Enter workflow rather than committing on a click the student may
 * not have meant as final.
 */
function descriptorIsComplete(descriptor, refs) {
    if (!descriptor?.refs?.length) {
        return false;
    }

    if (refs.length !== 2) {
        return false;
    }

    const kinds = refs.map((reference) => reference?.kind);

    /* An angle: two lines, both directions known. */
    if (descriptor.dimensionType === "angular") {
        return true;
    }

    /*
     * A distance between two points: the span is the measurement, and the only
     * thing left for the student to decide is where it is drawn - which is the
     * placement stage.
     */
    if (kinds.every((kind) => kind === "point")) {
        return true;
    }

    return false;
}

/*
 * ENTER: use the references chosen and decide the measurement now.
 *
 * This is the commit point for reference selection. The references are
 * handed to the inference, which derives the dimension type from what
 * was actually selected - a single line measures its length, two lines
 * measure the angle between them, a circle its diameter - and the
 * tool then moves into the placement stage, where the annotation is
 * positioned by a further click.
 */
export function commitDimensionSelection() {
    const picked =
        drawingState.interaction.dimensionPickedRefs || [];

    if (!picked.length) {
        setToolMessage(
            "Select a reference first"
        );

        return false;
    }

    /*
     * THE MEASUREMENT IS INFERRED FROM THE WHOLE SELECTION.
     *
     * A SINGLE REFERENCE IS COMPLETE on its own whenever it is a
     * measurably-whole feature: a Line, Beam, Truss, Cable, Shaft or
     * Reference Line measures its own length, a Circle its diameter, an
     * Arc its radius. The selection prompt has always said so - "press
     * Enter to dimension" after one click - so Enter on one reference
     * must produce that measurement rather than refuse it.
     *
     * It used to be routed through `inferDimensionSelection`, which
     * required exactly two references and therefore returned null for a
     * lone line. The result was the worst kind of failure: the tool
     * accepted the click, told the student to press Enter, and then did
     * nothing at all - no measurement, no preview, no message that made
     * sense of it. A single point is the one reference that is genuinely
     * incomplete, and it says so by inferring nothing.
     *
     * Two references take the direct pairwise path, which is the
     * overwhelmingly common case. More than two are folded, and a set
     * that does not reduce to one measurement is refused with a message
     * rather than collapsed into a number nobody asked for.
     */
    const descriptor =
        picked.length === 1
            ? inferDimensionDescriptor(picked[0], null)
            : picked.length === 2
              ? inferDimensionDescriptor(picked[0], picked[1])
              : inferDimensionSelection(picked);

    if (!descriptor?.refs?.length) {
        /*
         * A set that measures nothing is refused outright rather than
         * turned into a malformed dimension. The selection is kept so
         * the student can adjust it - most often by picking a partner
         * for a lone point, or dropping a reference from an
         * over-long set - instead of losing everything they picked.
         *
         * The wording names what is missing, because "nothing to
         * measure" is false for a single point: there IS a measurement,
         * it just needs a second reference.
         */
        setToolMessage(
            picked.length === 1
                ? "A point needs a second reference - pick one, or press Esc"
                : picked.length > 2
                  ? "Those references do not make one measurement - pick fewer"
                  : "Those references have nothing to measure between them"
        );

        renderCurrentDrawing();

        return false;
    }

    beginDimensionPlacement(
        picked[picked.length - 1],
        descriptor,
        drawingState.interaction.dimensionFirstPoint,
        picked.map(r => r.featureId).filter(Boolean)
    );

    return true;
}

/*
 * Infer a measurement from more than two references.
 *
 * Folding is only defined where it means something: a set reduces to
 * whatever the LAST reference measures against the first. Three or
 * more points have no single meaningful measurement, and three lines
 * have no single meaningful angle, so those are refused rather than
 * quietly collapsed into one of them.
 */
function inferDimensionSelection(picked) {
    if (picked.length !== 2) {
        return null;
    }

    return inferDimensionDescriptor(picked[0], picked[1]);
}

/*
 * Move into the placement stage with a settled descriptor.
 */
function beginDimensionPlacement(
    reference,
    descriptor,
    point,
    targets
) {
    enggDrawingState.setInteraction(
        drawingState,
        {
            dimensionStage: "placement",
            dimensionFirstRef: null,
            dimensionFirstPoint: null,
            dimensionSecondRef: null,

            /*
             * The selection has been SPENT. Leaving the accumulated
             * references here would mean the placement stage still held
             * them, and Escape - which clears the stage - would be the
             * only thing that stopped the next Enter from measuring the
             * same pair again.
             */
            dimensionPickedRefs: null,
            dimensionChoice: descriptor.dimensionType,
            dimensionTarget:
                reference?.featureId || null,
            dimensionTargets: targets,
            dimensionCandidates: candidatesForReference(reference, descriptor),
            dimensionRefs: descriptor.refs,
            dimensionPlacement: {
                x: point.x,
                y: point.y
            }
        }
    );

    setToolMessage(
        dimensionChoiceLabel(
            descriptor.dimensionType
        ) +
            " - move to place, click to confirm, D to change, Esc to cancel"
    );

    renderCurrentDrawing();
}

/*
 * A feature by its id.
 *
 * Read straight off the drawing rather than through a state helper:
 * the model object IS the feature, and reaching for an accessor that
 * does not exist silently aborts whatever used it - which is how a
 * selection-based measurement quietly stopped working.
 */
export function objectWithId(
    id
) {
    if (!id) {
        return null;
    }

    return (
        drawingState.objects.find(
            (object) => object.id === id
        ) || null
    );
}

/*
 * Move to the next measurement the selection supports.
 *
 * Shared by both tools, so the student learns one key rather than two
 * and the cycle is always in the same order.
 *
 * The candidates are DESCRIPTORS - each already carrying its own
 * references - so cycling takes the next one whole. That matters for
 * a pair of features, where the references name BOTH features:
 * rebuilding them from a measurement type alone is not possible, and
 * attempting it would break every measurement taken between two
 * things.
 */
export function cycleDimensionChoice() {
    const interaction =
        drawingState.interaction;

    const candidates =
        interaction.dimensionCandidates;

    if (
        !Array.isArray(candidates) ||
        candidates.length === 0
    ) {
        return false;
    }

    const current =
        candidates.findIndex(
            (candidate) =>
                candidate.dimensionType ===
                interaction.dimensionChoice
        );

    const next =
        candidates[
            (current + 1) % candidates.length
        ];

    if (!next?.refs?.length) {
        return false;
    }

    enggDrawingState.setInteraction(
        drawingState,
        {
            dimensionChoice:
                next.dimensionType,
            dimensionRefs: next.refs
        }
    );

    setToolMessage(
        dimensionChoiceMessage(
            next,
            interaction.dimensionTargets
        ) +
            " - move to place, click to confirm, D to change, Esc to cancel"
    );

    renderCurrentDrawing();

    return true;
}
