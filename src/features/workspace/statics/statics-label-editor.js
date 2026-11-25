/*
 * ============================================================
 * WRITING A STATICS OBJECT'S LABEL
 * ============================================================
 *
 * One way in, for every Statics tool that carries text: the Features Label
 * field, the inline double-click, and the moment a label is created. All three
 * call `openStaticsLabelEditor`, so they cannot disagree about WHERE the field
 * opens, WHAT it writes or WHEN the edit becomes undoable.
 *
 * THE FIELD OPENS ON THE WORDS. `note-editor.js` resolves its anchor from the
 * object through `inline-text-entry.js`, which asks `statics-label.js` where the
 * label is drawn - the same answer the canvas draws from. So the caret sits on
 * the glyphs being edited, and the committed text does not jump.
 *
 * THE LABEL IS THE OBJECT'S OWN PROPERTY. There is no text feature to create:
 * what is typed is written to `object.label`, which the Objects panel, the
 * canvas and the Source all read. Deleting the object therefore deletes its
 * label, and duplicating it copies the label, with no extra bookkeeping.
 *
 * ONE EDIT, ONE UNDO ENTRY. Keystrokes update the live object so the words
 * appear as they are typed; the history is written once, on commit, against the
 * snapshot taken when the field opened.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggNoteEditor from "../../../shared/ui/editors/note-editor.js";
import { drawingState } from "../editor-state.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
/*
 * WHETHER THE FIELD HANGS BESIDE THE OBJECT OR SITS ON ITS LABEL.
 *
 * A label is written where it is drawn, so its field sits ON it. A value - a
 * force's magnitude at its arrowhead - has no drawn text of its own to sit on,
 * so its field is hung just off the arrow instead of over it. A Statics label
 * is always the first case: it has a place, and the place is the answer.
 */
function staticsLabelFieldOpensBeside() {
    return false;
}

/* The live object, by id - a render may have replaced the instance we held. */
function liveObject(id) {
  return (
    (drawingState.objects || []).find((object) => object.id === id) || null
  );
}

/*
 * WRITE THE LABEL, as one committed edit.
 *
 * An EMPTY answer clears the label rather than leaving the previous words in
 * place: the student emptying the field is asking for no label, and a label
 * that cannot be removed is worse than one that can.
 */
export function setStaticsLabel(object, text, previous) {
  const live = liveObject(object?.id) || object;

  if (!live) {
    return false;
  }

  const next = String(text ?? "");

  if ((typeof live.label === "string" ? live.label : "") === next) {
    return false;
  }

  const before = previous || enggDrawingState.snapshotDrawing(drawingState);

  live.label = next;

  enggDrawingState.commitDrawingChange(drawingState, before);

  return true;
}

/*
 * OPEN THE LABEL FIELD ON AN OBJECT.
 *
 * The field is opened for the object itself, not for a label object - there is
 * no label object - so the same call serves the Features row, the canvas and a
 * freshly placed feature.
 */
export function openStaticsLabelEditor(object) {
  if (!object || object.locked) {
    return false;
  }

  const before = enggDrawingState.snapshotDrawing(drawingState);

  return enggNoteEditor.open({
    multiline: true,

    /*
     * THE ON-DRAWING PRESENTATION: the words, on the sheet, at the label's
     * own place - not a card beside it.
     */
    labelField: true,
    text: typeof object.label === "string" ? object.label : "",
    title: "Label",
    placeholder: "",
    object,
    state: drawingState,

    placeBeside: staticsLabelFieldOpensBeside(),

    onInput: (text) => {
      /*
       * WHAT IS TYPED SHOWS WHILE IT IS TYPED - on the object itself, so
       * the drawing of the object IS the preview. Nothing is committed
       * here; the field is the only thing being edited.
       */
      const live = liveObject(object.id);

      if (live) {
        live.label = String(text ?? "");
      }

      renderCurrentDrawing();
    },

    onApply: (text) => {
      setStaticsLabel(object, text, before);

      renderProperties();
      renderCurrentDrawing();
    },

    onCancel: () => {
      /*
       * ESCAPE LEAVES THE LABEL AS IT WAS. The field was opened on an
       * existing label, so cancelling must not silently delete what was
       * already there - the snapshot restores exactly the words it had.
       */
      const live = liveObject(object.id);
      const original = before?.objects?.find(
        (candidate) => candidate.id === object.id,
      );

      if (live && original) {
        live.label = original.label;
      }

      renderCurrentDrawing();
    },
  });
}

export default {
  openStaticsLabelEditor,
  setStaticsLabel,
};
