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
 * The commit writes the object's NAME and its drawn LABEL together - one
 * property with two readings - so the fields in Features, the picture and the
 * source cannot disagree about what the object is called.
 */

import enggNoteEditor from "./note-editor.js";
import enggDrawingState from "../../model/drawing-state.js";

export { LABEL_CAPABLE_TOOLS, toolTakesLabel as toolTakesCreationLabel } from "../../../features/workspace/dynamics/dynamics-label.js";

/* Where a symbol's label is drawn: its own anchor, in drawing units. */
function anchorOf(object) {
    const geometry = object?.geometry || {};

    if (
        Number.isFinite(Number(geometry.start?.x)) &&
        Number.isFinite(Number(geometry.end?.x))
    ) {
        return {
            x: (Number(geometry.start.x) + Number(geometry.end.x)) / 2,
            y: (Number(geometry.start.y) + Number(geometry.end.y)) / 2
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
export function creationLabelPrompt(object, { state = null, cameraSignal = null, onDone = null } = {}) {
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

        text: typeof object.name === "string" ? object.name : "",
        title: "Name",
        placeholder: "",
        object,
        point: anchor,
        state,
        cameraSignal,
        zoom: Number(state?.camera?.zoom) || 1,

        onApply: (text) => {
            const next = String(text ?? "").trim();
            const live =
                (state?.objects || []).find((candidate) => candidate?.id === object.id) || object;
            const before = typeof live.name === "string" ? live.name : "";

            /*
             * ONE UNDOABLE EDIT, and only when the text really changed. The
             * label is written with the name so the sheet and the panel agree.
             */
            if (before !== next) {
                const previous = state ? enggDrawingState.snapshotDrawing(state) : null;

                live.name = next;
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
        }
    });

    return true;
}

export default {
    creationLabelPrompt
};
