/*
 * ============================================================
 * A PLACED FEATURE'S VALUE, TYPED ON THE DRAWING
 * ============================================================
 *
 * The Statics tools that ask for a value after placement - a Point Load, an
 * Applied Moment, a Distributed Load, a Varying Load's points - used to open a
 * floating POPUP over the canvas: a small card with a heading, a label, a field
 * and a unit control. That card was chrome standing between the student and the
 * thing it was asking about, and it covered the drawing it belonged to.
 *
 * This asks the same question as ONE LINE OF TEXT ON THE DRAWING, at the
 * feature's own anchor, in the feature's own colour, with the caret as the only
 * sign that it is editable - the same presentation a creation label uses:
 *
 *   - no card, no heading, no label, no hint;
 *   - the drawing stays fully visible while the value is typed;
 *   - it sits JUST OFF the point the value belongs to - beside an arrowhead,
 *     at a load's midpoint - never on top of the drawing it names;
 *   - it follows the drawing when the student zooms or pans behind it.
 *
 * IT STARTS EMPTY, AND STAYS EMPTY UNTIL SOMETHING IS TYPED.
 *
 * The cursor's distance is deliberately NOT offered as a suggested number. A
 * suggestion is a value the student never entered, and pressing Enter to accept
 * it would answer the question for them. An empty field means UNKNOWN - "I have
 * not worked this out yet" - which is a real statement on a student's sheet;
 * type a number and it is that number; type `F` and it is their symbol.
 *
 * IT IS NOT A SECOND TEXT EDITOR. The field is the note editor's on-drawing
 * `labelField` presentation, so the keys, the caret, the commit on Enter or a
 * press elsewhere, the cancel on Escape and the escape of every key back to the
 * canvas are the same code as every other piece of in-page text in DAETUM.
 */

import enggNoteEditor from "./note-editor.js";
import enggInlineEntry from "./inline-text-entry.js";

/* How to take down the field currently on the drawing, if any. */
let closeCurrent = null;

/* Close whichever field is open, abandoning what was typed. */
export function closePlacementValueField() {
  const closing = closeCurrent;

  closeCurrent = null;

  closing?.();
}

/* Whether a placement value field is open. */
export function isPlacementValueFieldOpen() {
  return typeof closeCurrent === "function";
}

/*
 * OPEN THE FIELD ON THE DRAWING.
 *
 *   object    the feature whose value is being entered - it supplies the
 *             colour it is typed in
 *   point     the drawing point the value belongs to (a force's arrowhead)
 *   value     what the field opens with; "" for a feature just placed
 *   state     the live drawing state, so the field follows the camera
 *   onApply   receives the typed text; return { ok: false, error } to keep the
 *             field open with that reason
 *   onCancel  called when the student abandons the value
 */
export function openPlacementValueField({
  object = null,
  point = null,
  value = "",
  state = null,
  cameraSignal = null,
  onApply = null,
  onCancel = null,
} = {}) {
  closePlacementValueField();

  if (!object && !point) {
    return false;
  }

  /*
   * THE POINT ON THE DRAWING THE VALUE BELONGS TO.
   *
   * A force's magnitude belongs AT ITS ARROWHEAD - that is the point the
   * student just aimed at, and the point the finished number is written
   * beside. The object's own anchor is the fallback, so a caller with only a
   * feature still gets a field in the right place.
   */
  const world = point || enggInlineEntry.modelPointForTextEntry(object);

  const anchor = world
    ? enggInlineEntry.worldToClient(world, { state })
    : null;

  enggNoteEditor.open({
    multiline: false,

    /* THE ON-DRAWING PRESENTATION - see note-editor.js. */
    labelField: true,

    /*
     * BESIDE THE POINT, NOT ON IT. The field names a value that has no drawn
     * text of its own, so sitting on the anchor would cover the arrow it is
     * asking about. It hangs just off the point instead.
     */
    placeBeside: true,

    anchor: anchor
      ? {
          left: anchor.x,
          right: anchor.x,
          top: anchor.y,
          bottom: anchor.y,
          x: anchor.x,
          y: anchor.y,
          width: 0,
          height: 0,
        }
      : undefined,

    text: value === null || value === undefined ? "" : String(value),
    title: "Value",
    placeholder: "",
    object,
    state,
    cameraSignal,
    zoom: Number(state?.camera?.zoom) || 1,

    onApply: (text) => {
      if (typeof onApply === "function") {
        const result = onApply({ text: String(text ?? "") });

        /*
         * A REFUSED ANSWER KEEPS THE FIELD OPEN - the note editor does that
         * itself, so the return value is passed straight through.
         */
        if (result && result.ok === false) {
          return result;
        }
      }

      closeCurrent = null;
    },

    onCancel: () => {
      closeCurrent = null;

      if (typeof onCancel === "function") {
        onCancel();
      }
    },
  });

  /*
   * The editor closes its own field on Escape and on a press elsewhere; this
   * only remembers that the field is up, so abandoning it does not leave the
   * module believing a closed field is still on the drawing.
   */
  closeCurrent = () => {
    closeCurrent = null;

    enggNoteEditor.close?.();
  };

  return true;
}

export default {
  openPlacementValueField,
  closePlacementValueField,
  isPlacementValueFieldOpen,
};
