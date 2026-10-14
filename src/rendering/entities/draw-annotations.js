/*
 * Drawing one feature: Dimensions, variable dimensions, Annotate features and annotations.
 *
 * Each function draws one kind of feature into its group, from the context
 * appendEntity (entity-render.js) builds. It returns true when the feature
 * is finished, so no later renderer in the table runs for it.
 */
import { appendAnnotateEntity, appendAnnotationEntity } from "../annotation-render.js";
import { appendDimensionEntity, appendVariableDimensionEntity } from "../dimension-render.js";
import enggAnnotationModel from "../../features/annotations/annotation-model.js";


        /*
         * DIMENSIONS AND ANNOTATIONS
         *
         * Both are real document objects, so they are drawn here in
         * the same pass as every other feature rather than being
         * overlaid afterwards. Their graphics are asked of the models,
         * which means the drawing shows the DIMENSION as a dimension
         * line with witness lines and arrowheads, and not as a number
         * floating over the geometry.
         *
         * The models also own the measurement, so a dimension drawn
         * here re-reads its source geometry every time it is drawn.
         * That is what keeps a dimension honest after the geometry
         * moves, without this file knowing anything about beams.
         */
        /*
         * SHOW DIMENSIONS.
         *
         * Hides the dimensions the STUDENT PLACED, by not drawing them.
         * It does not create them: a dimension nobody asked for is not a
         * dimension the drawing has, and generating one per line would be
         * the tool doing the exercise. An absent setting reads as on, so a
         * saved sheet drawn before the toggle existed opens unchanged.
         *
         * HIDDEN BY NOT DRAWING rather than by deleting, so turning the
         * toggle back restores every dimension exactly as it was - including
         * its measured value, which is recomputed from the geometry rather
         * than frozen, so nothing can come back stale.
         */
    export function drawDimension({ svg, parentSvg, entity, state, style, toScreen }) {
            if (
                state.display?.showDimensions === false
            ) {
                return true;
            }

            appendDimensionEntity(svg, entity, state, toScreen, style);
            parentSvg.appendChild(svg);
            return true;
        }


        /*
         * A VARIABLE DIMENSION.
         *
         * Drawn with the SAME machinery a dimension is: the same witness
         * lines, the same arrowheads, the same text frame and the same font -
         * so `x` sits on the drawing exactly where a measured length would, and
         * the two read as members of one family.
         *
         * What differs is only the TEXT: a variable states its SYMBOL, and no
         * measurement is taken. An empty symbol draws NOTHING - the student has
         * named it but not written it, and inventing `0` or `?` would turn
         * their deliberate unknown into a failure.
         *
         * It follows the same SHOW DIMENSIONS toggle, because a variable is a
         * dimension in everything but its value - a student hiding their
         * dimensions does not want the symbolic ones left floating.
         */
    export function drawVariableDimension({ svg, parentSvg, entity, state, style, toScreen }) {
            if (state.display?.showDimensions === false) {
                return true;
            }

            appendVariableDimensionEntity(svg, entity, state, toScreen, style);
            parentSvg.appendChild(svg);
            return true;
        }


        /*
         * AN ANNOTATE FEATURE.
         *
         * A note, a label, a leader, a callout, an arrow, a symbol, a
         * tolerance or a table. All eight are drawn by ONE function, because
         * they are one type; what differs is the kind, which decides the
         * shape drawn around the same text-and-placement core. A note is
         * text; a leader adds a pen; an arrow is a pen with a head; a table
         * is a grid. Keeping them in one function is what stops two of them
         * drifting apart in the way they respond to style or placement.
         */
    export function drawAnnotate({ svg, parentSvg, entity, state, style, toScreen }) {
            appendAnnotateEntity(svg, entity, state, toScreen, style);
            parentSvg.appendChild(svg);
            return true;
        }


        /*
         * SHOW MAGNITUDES.
         *
         * A generated value that is switched off is not drawn at all -
         * not drawn with its text emptied. An annotation with no text would
         * still contribute its leader line, so the drawing would keep a
         * line running to a blank spot where the value used to be, which
         * reads as something missing rather than something switched off.
         *
         * A note the student WROTE is unaffected: `isVisible` says so, and
         * says so in the annotation model rather than here, so the rule is
         * one answer rather than two places that have to agree about which
         * annotations are the student's own.
         *
         * THE MODEL IS LOOKED UP RATHER THAN ASSUMED. It is absent in some
         * loads of this file - the module-load check runs without it - so a
         * missing model has to mean "draw everything", which is what an
         * older behaviour did. Throwing here would take the whole drawing
         * down over a preference.
         */
    export function drawAnnotation({ svg, parentSvg, entity, state, style, toScreen }) {
            const annotations =
                enggAnnotationModel;

            if (
                annotations &&
                !annotations.isVisible(
                    entity,
                    state
                )
            ) {
                return true;
            }

            appendAnnotationEntity(svg, entity, state, toScreen, style);
            parentSvg.appendChild(svg);
            return true;
        }
