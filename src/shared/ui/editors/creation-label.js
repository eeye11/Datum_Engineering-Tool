/*
 * ============================================================
 * A LABEL, TYPED ONTO THE DRAWING AS THE OBJECT IS CREATED
 * ============================================================
 *
 * A label is an ANNOTATION, and annotating is part of drawing - so the field
 * that asks for one is part of the drawing too. It is a line of text at the
 * object's own label place, in that object's colour, with the caret as the only
 * sign that it is editable. No dialog, no popup, no card, no title, no hint.
 *
 * ONE IMPLEMENTATION, EVERY TOOL.
 *
 *   creationLabelPrompt(object, options)   ask for the label
 *   toolTakesCreationLabel(toolId)         whether a tool asks at all
 *
 * Both go through the application's ONE text editor (`note-editor.js`, the
 * `labelField` presentation), so the keys, the caret, the commit, the cancel,
 * the undo entry and the source round-trip are the same as every other piece of
 * text in DAETUM. Nothing here is a second text-entry path.
 *
 * The commit writes the object's DRAWN LABEL - the property the canvas paints
 * and the Features Label row reads. The object's NAME is its identity in the
 * Objects list and the source header, and is deliberately NOT rewritten here:
 * a student who labels a load "w = 5 kN/m" has not renamed the load, and an
 * automatic "Load 3" must not be erased by labelling it.
 *
 * (For an object whose name IS its drawn text - a Heat notation - the caller
 * passes its own `onApply` and writes both; see `openHeatLabelEditor`.)
 */

import enggNoteEditor from "./note-editor.js";
import enggDrawingState from "../../model/drawing-state.js";

export {
  LABEL_CAPABLE_TOOLS,
  toolTakesLabel as toolTakesCreationLabel,
} from "../../../features/workspace/dynamics/dynamics-label.js";

/* Where a symbol's label is drawn: its own anchor, in drawing units. */
function anchorOf(object) {
  const geometry = object?.geometry || {};

  /*
   * A LABEL IS FIELDED WHERE IT IS DRAWN.
   *
   * A Heat Transfer notation is its own text object at its own position, so the
   * field opens ON the words rather than on the symbol they annotate - which is
   * the whole point of editing the notation in place.
   */
  if (
    Number.isFinite(Number(geometry.position?.x)) &&
    Number.isFinite(Number(geometry.position?.y)) &&
    (object?.annotateKind === "label" || object?.kind === "label")
  ) {
    return { x: Number(geometry.position.x), y: Number(geometry.position.y) };
  }

  if (
    Number.isFinite(Number(geometry.start?.x)) &&
    Number.isFinite(Number(geometry.end?.x))
  ) {
    return {
      x: (Number(geometry.start.x) + Number(geometry.end.x)) / 2,
      y: (Number(geometry.start.y) + Number(geometry.end.y)) / 2,
    };
  }

  return geometry.position || geometry.center || geometry.origin || null;
}

/*
 * ASK FOR THE LABEL.
 *
 *   object        the committed feature (written straight onto it)
 *   state         the drawing state, so the field follows the camera
 *   cameraSignal  the subscription the editor uses to stay anchored
 *   onDone        called once, after the field closes for any reason
 *
 * The whole interaction is one line of text on the sheet. Escape leaves the
 * object exactly as it is - a cancelled label never deletes what was drawn.
 */
export function creationLabelPrompt(
  object,
  { state = null, cameraSignal = null, onDone = null, selectAllOnOpen = false, onApply = null } = {},
) {
  if (!object) {
    return false;
  }

  const anchor = anchorOf(object);

  if (!anchor) {
    return false;
  }

  enggNoteEditor.open({
    multiline: false,

    /* THE ON-DRAWING PRESENTATION - see note-editor.js. */
    labelField: true,

    /* The drawn label is what a label field edits - never the object's name. */
    text: typeof object.label === "string" ? object.label : "",
    title: "Name",
    placeholder: "",
    object,
    point: anchor,
    state,
    cameraSignal,
    zoom: Number(state?.camera?.zoom) || 1,

    /*
     * A GENERATED DEFAULT OPENS SELECTED, so typing replaces it. This is what
     * makes a Heat Transfer notation editable the moment it appears without a
     * second step - Enter keeps "T₁", any keystroke replaces it.
     */
    selectAllOnOpen,

    /*
     * A CALLER THAT OWNS THE COMMIT. A Heat Transfer label is its own child
     * annotation with its own text field, so its answer is written by the tool
     * layer rather than onto `object.name`. Without one, the label is written
     * onto the object's name and label, as every other tool's is.
     */
    /*
     * THE TEXT BECOMES THE LABEL - the ONE property the canvas draws.
     *
     * A tool that asks for text during creation is asking for the words that
     * appear beside the object. That is the LABEL, and it is the only thing
     * written here. It used to be written onto `name` as well, which gave one
     * piece of displayed text two independent readings: renaming the object
     * later changed the drawing, and editing the drawing changed the name.
     */
    onApply: typeof onApply === "function" ? onApply : (text) => {
      const next = String(text ?? "").trim();
      const live =
        (state?.objects || []).find(
          (candidate) => candidate?.id === object.id,
        ) || object;
      const before = typeof live.label === "string" ? live.label : "";

      /* ONE UNDOABLE EDIT, and only when the text really changed. */
      if (before !== next) {
        const previous = state ? enggDrawingState.snapshotDrawing(state) : null;

        live.label = next;

        if (previous) {
          enggDrawingState.commitDrawingChange(state, previous);
        }
      }

      if (typeof onDone === "function") {
        onDone();
      }
    },

    onCancel: () => {
      if (typeof onDone === "function") {
        onDone();
      }
    },
  });

  return true;
}

export default {
  creationLabelPrompt,
};
