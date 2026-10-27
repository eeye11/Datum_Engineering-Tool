/*
 * Creating a Statics feature from a completed placement.
 */

import enggBodyFrames from "../../../shared/geometry/body-frames.js";
import enggDrawingState from "../../../shared/model/drawing-state.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { RIGID_BODY_HEIGHT, RIGID_BODY_WIDTH, staticsForceLineWidth } from "../constants.js";
import { openMomentValuePrompt } from "../geometry/preview.js";
import { drawingState } from "../editor-state.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { STATICS_PLACEMENT_TOOLS } from "./statics-tools.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";
import { attachableStaticsType, isSupportType } from "../../../shared/model/feature-types.js";
import { activateTool } from "../../../components/layout/toolbar/tool-activation.js";

export function createStaticsFeature(
    toolId,
    point,
    parentId
) {
    const definition =
        STATICS_PLACEMENT_TOOLS[toolId];

    if (!definition) {
        return;
    }

    /*
     * Dispatch on the feature type the child tool creates,
     * not on the old parent ids, so every submenu item
     * builds the right shape with the right arguments.
     *
     * Declared HERE, before any branch below reads it. It used to be
     * declared further down, just above the factory dispatch, which
     * left the support branch above it referring to a binding that
     * did not exist yet. `const` has no hoisted value, so that
     * reference threw a ReferenceError on EVERY single-click
     * Statics creation, not only on the supports.
     *
     * The error was thrown from inside the placement branch of
     * handleCanvasClick, so nothing created the feature and nothing
     * reported a failure either: the tool armed correctly, the
     * status line showed its instruction, and the click silently
     * did nothing. Particle and Rigid Body were the visible
     * casualties because they are the two bodies a student places
     * first, and both go through this function.
     */
    const type =
        definition.type;

    const previous =
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    const style = {
        style: {
            ...drawingState.styleDefaults,

            /*
             * A Point Force is a symbol rather than an outline,
             * so it starts heavier than the general line weight.
             * The choice is made in staticsForceLineWidth so the
             * single-click and the attached creation paths cannot
             * disagree about it.
             */
            lineWidth:
                staticsForceLineWidth(toolId)
        },

        engineering: {
            plane: "XY",
            discipline: "statics",

            /*
             * Records which statics tool created this
             * feature, so the panel can name it correctly
             * even when it reuses ordinary point or line
             * geometry.
             */
            staticsType: toolId
        },

        /*
         * Reference features are named for their statics
         * role rather than their underlying geometry, so a
         * Reference Point reads as such in the tree.
         */
        name:
            toolId === "reference-point" ||
            toolId === "reference-line"
                ? definition.label
                : undefined,

        /*
         * A single-click support or moment snapped onto a
         * body becomes that body's child, exactly as a
         * snapped Point Force does.
         */
        parentId:
            attachableStaticsType(
                definition.type
            )
                ? parentId
                : undefined
    };

    const position = {
        x: point.x,
        y: point.y
    };

    let object;

    /*
     * THE SUPPORTS: ATTACHED TO THE CENTRELINE, DRAWN OUTSIDE.
     *
     * A support is one of the four features whose position is a
     * RELATIONSHIP rather than a coordinate. It is attached at a point
     * on its body's centreline - the point the student clicked, and the
     * point the snap indicator sat on - and it is DRAWN on the outside
     * of the body, offset clear of the member's face.
     *
     * Those are two different numbers and they are stored separately.
     * `attachment` is the semantic position, in the body's own frame,
     * and it is what makes the support follow the beam when the beam
     * moves. `position` is where the symbol is drawn, and it is
     * derived from the attachment every time the drawing is rendered.
     *
     * Storing only the drawn position is what made a support have to
     * be dropped on the bottom edge of a beam to come out underneath
     * it: with one number for both roles, the drawn position WAS the
     * attachment, so the only way to be outside the member was to be
     * outside it already.
     */
    if (isSupportType(type)) {
        const parent =
            drawingState.objects.find(
                candidate =>
                    candidate.id === parentId
            );

        const placement =
            parent
                ? enggBodyFrames.supportPlacement(
                    parent,
                    point,
                    false
                )
                : null;

        if (placement) {
            object =
                enggDrawingState.geometryFactories[type](
                    placement.render,
                    {
                        ...style,

                        parentId: parent.id,

                        engineering: {
                            ...style.engineering,

                            /*
                             * WHICH GEOMETRY IT IS ATTACHED TO.
                             *
                             * Recorded so a file says what the support
                             * is on the strength of - a centreline, not
                             * a face and not a screen position - and so
                             * a later change to how supports attach can
                             * tell an old attachment from a new one.
                             */
                            attachmentType: "centreline",

                            supportType: type
                        }
                    }
                );

            /*
             * The attachment, in the body's frame.
             *
             * A DISTANCE ALONG the member rather than a world point,
             * which is what makes the support stay where the student
             * put it when the beam is resized. A stored world x would
             * drift to a different place on a longer beam, and the
             * support would quietly stop being under the load it was
             * put under.
             */
            /*
             * A FRACTION ALONG the member rather than a world point or
             * an absolute distance.
             *
             * The fraction is what makes the support stay where the
             * student put it under every change to the member. A stored
             * world x drifts on a longer beam, and an absolute distance
             * pins a midpoint support a quarter of the way along a beam
             * that has since been stretched.
             *
             * `placement.distance` is still measured in millimetres,
             * because that is what the placement code works in, so it is
             * turned back into a point on the member and then stored as
             * the fraction that point represents.
             */
            const memberFrame =
                enggBodyFrames.frameOf(parent);

            object.geometry.attachment =
                enggBodyFrames.attachmentFor(
                    memberFrame,
                    memberFrame
                        ? enggBodyFrames.pointAt(
                              memberFrame,
                              placement.distance
                          )
                        : null
                );

            /*
             * Which side. TRUE is the opposite of the body's default
             * outside face, and it is the only thing Flip changes: not
             * the attachment, not the beam, not a distance from
             * anything.
             */
            object.geometry.flipped = false;
        }
    }

    /*
     * Dispatch on the feature type the child tool creates,
     * not on the old parent ids, so every submenu item
     * builds the right shape with the right arguments.
     */
    if (type === "force") {
        /*
         * The heavier default weight comes from
         * staticsAttachedStyle, which is the one place that
         * decides it, so the creation path does not have to
         * repeat the choice and the two cannot disagree.
         */
        object =
            enggDrawingState.geometryFactories.force(
                position,
                100,
                0,
                style
            );
    } else if (type === "rigid-body") {
        /*
         * A rigid body starts as a rectangle of a defined
         * default size, centred on the clicked point. The
         * student then resizes and rotates it from the
         * Features panel or by dragging its handles.
         */
        object =
            enggDrawingState.geometryFactories[
                "rigid-body"
            ](
                {
                    x:
                        position.x -
                        RIGID_BODY_WIDTH / 2,

                    y:
                        position.y +
                        RIGID_BODY_HEIGHT / 2
                },

                RIGID_BODY_WIDTH,

                RIGID_BODY_HEIGHT,

                style
            );
    } else if (type === "moment") {
        /*
         * A moment starts at 50 N-m, turning ANTICLOCKWISE.
         *
         * Anticlockwise is the default direction a moment is created
         * with, and it is written as the word rather than as a flag so
         * that the feature states its own sense instead of leaving a
         * reader to invert a boolean.
         */
        object =
            enggDrawingState.geometryFactories.moment(
                position,
                50,
                "CCW",
                style
            );
    } else if (type === "connection") {
        /*
         * A connection is drawn as a short link so it is
         * visible before its second end is chosen.
         */
        object =
            enggDrawingState.geometryFactories.connection(
                position,
                {
                    x: point.x + 20,
                    y: point.y
                },
                style
            );
    } else if (
        typeof enggDrawingState.geometryFactories[
            type
        ] === "function"
    ) {
        object =
            enggDrawingState.geometryFactories[
                type
            ](
                position,
                style
            );
    } else {
        return;
    }
    /*
     * Creation-time sizing prompts are disabled.
     *
     * Statics geometry is schematic (not to scale), so the drawn
     * shape is committed immediately with no follow-up length/size
     * entry and no drawing-scale calibration.
     */
    /*
     * THE OBJECT THE DOCUMENT ACTUALLY HOLDS.
     *
     * `addObject` may store a COPY of what it is given - it renames a feature
     * by spreading it - so the object passed in is not always the object on the
     * sheet. Anything that writes to the feature AFTER adding it must therefore
     * write to what was returned, or the write lands on a stray copy: the
     * moment's magnitude popup did exactly that, and its Unknown mark never
     * reached the panel.
     */
    const stored =
        enggDrawingState.addObject(
            drawingState,
            object
        );

    enggDrawingState.commitDrawingChange(
        drawingState,
        previous
    );

    enggDrawingState.clearInteraction(
        drawingState
    );

    enggDrawingState.selectObject(
        drawingState,
        stored.id
    );

    if (isSupportType(type)) {
        renderProperties();
        activateTool("select");
        return;
    }

    setToolMessage(
        `Specify ${definition.label.toLowerCase()} position`
    );

    renderProperties();
    renderCurrentDrawing();

    /*
     * ========================================================
     * A MOMENT PLACED IN FREE SPACE IS ASKED ABOUT TOO
     * ========================================================
     *
     * A moment has TWO creation paths, and both must end the same way:
     *
     *   on a body   two stages (point, then radius), committed by
     *               `commitMomentPlacement`
     *   in free space this one, a single click
     *
     * The two-stage path was made to ask; this one was not, so a moment placed
     * in empty space was still silently given a magnitude of 50 that the
     * student never chose. The question is opened from the SHARED function, so
     * `M`, `250` and an empty box mean the same thing whichever path placed it.
     */
    if (type === "moment") {
        openMomentValuePrompt(stored, previous);
    }
}
