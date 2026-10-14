/*
 * The annotation and note tools.
 */

import enggDrawingState from "../../core/model/drawing-state.js";
import enggAnnotationModel from "../../features/annotations/annotation-model.js";
import { renderCurrentDrawing } from "../workspace/canvas-render.js";
import { featureNameOf, findDimensionTarget } from "./dimension-tool.js";
import { drawingState } from "../editor-state.js";
import { renderProperties } from "../panels/feature-panel.js";
import { isLoadBuildPhase, isLoadSpanPhase } from "../statics/load-tool.js";
import { canvasPointFromEvent } from "../toolbar/tool-activation.js";
import { setToolMessage } from "../toolbar/toolbar-render.js";

/*
 * THE DIMENSION TOOLS
 *
 * Dimension and Smart Dimension are ONE tool with two different
 * answers to a single question: what is being measured?
 *
 * Smart Dimension reads the selection and decides - a circle becomes a
 * diameter because that is what a circle's size is normally quoted as.
 * Dimension asks instead, cycling through the measurements the selected
 * geometry actually supports, so a student who wants a beam quoted
 * vertically rather than horizontally gets that without the program
 * having to guess what they meant.
 *
 * Neither tool decides the MEASUREMENT TYPE in a way that bypasses the
 * feature's own registration. Both ask measurement-core what the
 * selection can be measured as, which is why a Beam offers a span and
 * a Circle offers a diameter, and why adding a new feature type later
 * needs no change here at all.
 *
 * The lifecycle is deliberately short, and every part of it is
 * temporary:
 *
 *   1. click a feature     -> armed, with the measurements it supports
 *   2. press D / Tab       -> move to the next measurement
 *   3. move the cursor     -> live preview at the cursor
 *   4. click               -> the dimension is committed
 *   Escape                 -> all of it discarded, nothing saved
 *
 * Nothing is written to the drawing until step 4, which is what makes
 * Escape safe: there is no partial dimension to clean up.
 */

/*
 * THE ANNOTATION TOOL
 *
 * Creates the annotation the student actually wants, which depends on
 * what they click:
 *
 *   - a FEATURE gives an ASSOCIATIVE label that reads its own values and
 *     goes on reading them, so a force labelled once keeps up with the
 *     force however it is later edited (spec 32);
 *   - EMPTY SPACE gives a FREE-TEXT note, which belongs to nothing and
 *     is the student's own writing (spec 34).
 *
 * The kinds offered for a feature are asked of the annotation model,
 * which answers by what that feature can actually be labelled as -
 * never from a list written here - so a new feature type is labelled
 * correctly without this file knowing it exists.
 *
 * The lifecycle matches the Dimension tool's exactly: click to arm, move
 * to position with a live preview, click to commit, Escape to abandon.
 * Nothing is written to the drawing until that last click, which is what
 * makes Escape safe - there is no partial annotation to clean up.
 */

/*
 * Is this the annotation tool?
 */
export function isAnnotationTool(
    toolId
) {
    return toolId === "annotation";
}

/*
 * A short description of what the tool has recognised, for the message
 * that tells the student before they commit.
 */
function annotationKindLabel(
    kind
) {
    return (
        enggAnnotationModel.KINDS?.[
            kind
        ]?.label ||
        kind
    );
}

/*
 * Arm a note: the student's own text, belonging to nothing.
 *
 * Armed rather than committed because the text is not written yet - it
 * is asked for once the note is placed, and Escape before that leaves no
 * note at all.
 */
function armFreeTextAnnotation(
    point
) {
    enggDrawingState.setInteraction(
        drawingState,
        {
            annotationKind: "free-text",
            annotationKinds: ["free-text"],
            annotationTarget: null,
            annotationPlacement: {
                x: point.x,
                y: point.y
            }
        }
    );

    setToolMessage(
        "Note - move to place, click to confirm, Esc to cancel"
    );

    renderCurrentDrawing();
}

/*
 * Commit the armed annotation as a real feature.
 *
 * Goes through the feature factory like every other creation, so the
 * note or label is named, numbered, selected, undone and saved by the
 * same code as everything else. It is a feature on the drawing, not
 * text painted over one.
 *
 * A generated label is placed WITHOUT a leader and left selected, so
 * the student can drag it somewhere useful straight away. The leader is
 * not imposed: a label beside its feature needs none, and one that
 * reaches across the drawing would be the tool's opinion rather than
 * theirs. It can be turned on afterwards.
 */
function commitAnnotation(
    point
) {
    const interaction =
        drawingState.interaction;

    const kind = interaction.annotationKind;

    const sourceFeatureId =
        interaction.annotationTarget || null;

    const previousObjects =
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    const object =
        enggDrawingState.geometryFactories
            .annotation({
                kind,
                sourceFeatureId,
                position: {
                    x: point.x,
                    y: point.y
                },
                leader: {
                    enabled: false
                }
            });

    /*
     * A note is written by the student, so it starts empty and waits
     * for them. A generated label already knows its text and is never
     * asked for one - editing a derived value would let the drawing
     * claim something its feature does not say.
     */
    if (kind === "free-text") {
        object.text = "";
    }

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

    enggDrawingState.selectObject(
        drawingState,
        object.id
    );

    setToolMessage(
        sourceFeatureId
            ? "Label placed - it will follow its feature"
            : "Note placed - double-click to write it"
    );

    renderProperties();
    renderCurrentDrawing();

    return object;
}

/*
 * A click while the annotation tool is active.
 *
 * Two clicks, exactly like the Dimension tool: the first chooses WHAT is
 * being labelled, the second says WHERE the label goes.
 */
export function handleAnnotationClick(
    resolution,
    event
) {
    const point =
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
     * ARMED: this click says where the label goes.
     */
    if (interaction.annotationKind) {
        commitAnnotation(point);

        return;
    }

    /*
     * NOT ARMED: what is being labelled?
     *
     * A feature under the cursor becomes an associative label. Clicking
     * empty space becomes a note, which is the common case for prose and
     * so must not be hidden behind a requirement to select something
     * first.
     */
    const feature =
        findDimensionTarget(point);

    if (!feature) {
        armFreeTextAnnotation(point);

        return;
    }

    const kinds =
        enggAnnotationModel.kindsFor(
            feature,
            drawingState
        ) || [];

    if (kinds.length === 0) {
        setToolMessage(
            "Nothing about that feature can be labelled - click empty space for a note"
        );

        renderCurrentDrawing();

        return;
    }

    enggDrawingState.setInteraction(
        drawingState,
        {
            annotationKind: kinds[0],
            annotationKinds: kinds,
            annotationTarget: feature.id,
            annotationTargetName:
                featureNameOf(feature),
            annotationPlacement: {
                x: point.x,
                y: point.y
            }
        }
    );

    setToolMessage(
        `${annotationKindLabel(kinds[0])} for ${featureNameOf(feature)} - move to place, click to confirm, D to change, Esc to cancel`
    );

    renderCurrentDrawing();
}

/*
 * Move to the next label the feature can carry.
 *
 * The same key as the Dimension tool's, for the same reason: one key
 * learned once, and the cycle in the same place.
 */
export function cycleAnnotationKind() {
    const interaction =
        drawingState.interaction;

    const kinds =
        interaction.annotationKinds;

    if (
        !Array.isArray(kinds) ||
        kinds.length === 0
    ) {
        return false;
    }

    const current = kinds.indexOf(
        interaction.annotationKind
    );

    const next =
        kinds[(current + 1) % kinds.length];

    enggDrawingState.setInteraction(
        drawingState,
        {
            annotationKind: next
        }
    );

    setToolMessage(
        `${annotationKindLabel(next)} for ${interaction.annotationTargetName} - move to place, click to confirm, D to change, Esc to cancel`
    );

    renderCurrentDrawing();

    return true;
}

/*
 * Is nothing in mid-construction?
 *
 * A double-click means "open this" only when there is no construction
 * to finish. While a line, a truss or a load is being built, the
 * double-click belongs to that construction and must not be stolen by
 * an editing gesture.
 *
 * Named for what it is FOR - deciding whether an edit gesture is
 * allowed - rather than as a general "is busy" test, because the
 * conditions that matter here are specifically the ones that make a
 * double-click ambiguous.
 */
export function isIdleForEditing() {
    /*
     * A phase other than idle means something is being constructed.
     * The one exception is a phase that is set but has no work in it -
     * the distributed-load and statics-span phases are only entered
     * once a first point exists, so their emptiness is itself the
     * signal that nothing is pending.
     *
     * A DIMENSION'S OWN STAGES ARE NOT IDLE EITHER. The dimension tool
     * records its progress in `dimensionStage`, not in `phase`, so while a
     * measurement is armed or being placed `phase` is still "idle". Left
     * out of this test, a double-click during dimension placement would be
     * read as "open the dimension under the cursor" and would steal the
     * gesture from the tool the student is actually running.
     */
    if (drawingState.interaction.dimensionStage) {
        return false;
    }

    return (
        drawingState.interaction
                .phase === "idle" ||
        isLoadBuildPhase(drawingState.interaction) ||
        isLoadSpanPhase(drawingState.interaction)
    );
}
