/*
 * ============================================================
 * THE OPTIONAL LABEL, ASKED FOR WHILE THE SYMBOL IS BEING MADE
 * ============================================================
 *
 * Eight Dynamics tools take a user-defined label:
 *
 *     Particle, Rigid Body, Polar Vector, Angular Vector,
 *     Spring, Viscous Damper, Spring–Damper Element, Pulley
 *
 * The label is OPTIONAL, and every rule below exists to keep it so:
 *
 *   - the field is shown after the object is placed, as part of its creation;
 *   - finishing the box (Enter, or a click elsewhere) keeps whatever was typed;
 *   - an EMPTY box stores an empty string - no "Particle 1", no "Spring 1", no
 *     substitute of the object's id or its tool name;
 *   - Escape leaves the object exactly as it is and closes only the box, so a
 *     cancelled label never deletes a symbol the student has already drawn;
 *   - the text is stored as the feature's `label`, which is the field the
 *     canvas label pass, the source writer and the Features panel all read -
 *     so the box, the panel and the picture cannot disagree.
 *
 * It is NOT a second editor. `note-editor.js` already knows how to draw a
 * small anchored field over the canvas, commits on Enter or on a press
 * elsewhere, cancels on Escape, and puts its typed words back into the drawing
 * as a live preview. This module only says WHAT is being edited and what
 * happens to the answer.
 */

import { creationLabelPrompt as creationLabel } from "../../../shared/ui/editors/creation-label.js";

/*
 * WHICH TOOLS ASK FOR A LABEL AS THEY ARE CREATED.
 *
 * A label is an ANNOTATION - a name given to something the student will refer to
 * again. It is useful on the directed and analytical objects (a velocity v, a
 * moment M) and it is noise on the shapes that are drawn for their own sake: a
 * particle, a body, a spring or a reference line needs no name to be
 * understood, and interrupting every placement to ask for one slows the drawing
 * down for nothing.
 *
 * A POINT LOAD IS NOT IN THE LIST. A force already asks for its magnitude as it
 * is created, in the same on-drawing field - so asking a second question
 * immediately afterwards opened a SECOND field right beside the first, with no
 * change of subject between them. The force's name is still typed in Features
 * whenever the student wants one.
 *
 * So this is a PER-TOOL LIST, not a universal prompt. A tool absent from it is
 * created immediately, and its Name can still be typed in Features afterwards.
 *
 * The Statics analytical tools - a couple moment, a distributed load - are in
 * the list too; they are the same kind of object and use the same inline field
 * (`openCreationLabelField`).
 *
 * THE TWO DYNAMICS VECTORS ARE NOT IN THE LIST, and that is deliberate. A Polar
 * Vector and an Angular Vector ask for their MAGNITUDE first, in the same
 * on-drawing field a Point Force and a Moment use - so asking for a name
 * immediately afterwards opened a SECOND field right beside the first, with no
 * change of subject between them. Their name step comes AFTER the magnitude
 * (`dynamics-vector-value.js`), which is what the moment path does too.
 */
export const LABEL_CAPABLE_TOOLS = Object.freeze([
  "moment",
  "distributed-load",
  "varying-distributed-load",
]);

const LABEL_CAPABLE = new Set(LABEL_CAPABLE_TOOLS);

/* Whether a tool's creation asks for a label. */
export function toolTakesLabel(toolId) {
  return LABEL_CAPABLE.has(String(toolId ?? ""));
}

/*
 * ASK FOR THE LABEL.
 *
 * A thin alias of the ONE creation-label helper (`creation-label.js`), so every
 * tool - a vector, a force, a moment - opens the same on-drawing field with the
 * same keys, the same commit and the same undo entry.
 */
export function promptForDynamicsLabel(
  object,
  { state = null, cameraSignal = null, onDone = null } = {},
) {
  return creationLabel(object, { state, cameraSignal, onDone });
}

export default {
  LABEL_CAPABLE_TOOLS,
  toolTakesLabel,
  promptForDynamicsLabel,
};
