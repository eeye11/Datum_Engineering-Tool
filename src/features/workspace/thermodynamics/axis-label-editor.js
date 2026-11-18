/*
 * ============================================================
 * A SATURATION DIAGRAM'S AXIS NAMES, EDITED ON THE DRAWING
 * ============================================================
 *
 * The X and Y axis names of a saturation curve are CANVAS TEXT: they are part of
 * the figure, drawn where the axis ends. Editing them is therefore typed where
 * they are drawn - not into a box floated over the window.
 *
 * WHAT THIS REPLACES. This used to create its own `<input>` at a fixed position,
 * with its own hard-coded border colour, its own keys and its own commit - a
 * SECOND text editor beside the application's real one. Two editors meant two
 * keyboards (Enter, Escape, a press elsewhere all behaved differently), two
 * looks, and a box that stayed where it was when the canvas was zoomed.
 *
 * Now the click is only a hit test: it finds WHICH label was pressed and opens
 * the shared inline editor - `noteEditor`'s label field - at the label's own
 * projected anchor. The keys, the caret, the commit, the undo entry and the
 * appearance are every other canvas label's.
 */
import enggDrawingState from "../../../shared/model/drawing-state.js";
import { drawingState } from "../editor-state.js";
import { drawingCanvas } from "../dom.js";
import enggNoteEditor from "../../../shared/ui/editors/note-editor.js";
import enggInlineEntry from "../../../shared/ui/editors/inline-text-entry.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";

/*
 * THE CAMERA SIGNAL, ASKED FOR RATHER THAN IMPORTED.
 *
 * `canvas-render.js` already reaches the editor, so a static import back from
 * here would close the loop at load time. This module is installed by the same
 * controller that owns the canvas, so the subscription is taken from a setter -
 * and a caller that never provides one gets a field placed once, which is the
 * behaviour every non-canvas caller needs anyway.
 */
let followCamera = null;

export function setAxisLabelCameraSignal(signal) {
    followCamera = typeof signal === "function" ? signal : null;
}

/* The axis name a label node stands for, or null when the node is not one. */
function axisKeyOf(node) {
  const key = node?.dataset?.saturationAxis;

  return key === "xLabel" || key === "yLabel" ? key : null;
}

export function installAxisLabelEditor() {
  drawingCanvas.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0 || drawingState.interaction.phase !== "idle") {
        return;
      }

      const labels = [
        ...drawingCanvas.querySelectorAll("[data-saturation-axis]"),
      ].reverse();

      const hit = labels.find((node) => {
        const box = node.getBoundingClientRect();

        return (
          event.clientX >= box.left - 5 &&
          event.clientX <= box.right + 5 &&
          event.clientY >= box.top - 5 &&
          event.clientY <= box.bottom + 5
        );
      });

      if (!hit) {
        return;
      }

      const key = axisKeyOf(hit);
      const object = drawingState.objects.find(
        (item) => item.id === hit.dataset.axisFeatureId,
      );

      if (!key || !object) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      const geometry = object.geometry || {};
      const anchor = {
        x: Number(geometry.origin?.x) || 0,
        y: Number(geometry.origin?.y) || 0,
      };

      /*
       * THE FIELD SITS ON THE LABEL, following the camera: `point` is the
       * drawing position the words are drawn at, so the box opens over them
       * and travels with the sheet if the student zooms or pans while typing.
       */
      /*
       * THE LABEL'S OWN POSITION IN DRAWING UNITS.
       *
       * A label node's box is in screen pixels, and the editor works in
       * drawing units - so the anchor is projected back through the canvas
       * rather than read off the DOM. A label the student has moved is
       * therefore still edited where it is drawn.
       */
      const box = enggInlineEntry.canvasBounds(drawingCanvas);

      const projected =
        box && typeof hit.getBoundingClientRect === "function"
              ? enggInlineEntry
                  .createProjection(drawingState.camera, box)
                  .toWorld({
                      x: hit.getBoundingClientRect().left - box.rect.left,
                      y: hit.getBoundingClientRect().top - box.rect.top,
                  })
              : null;

      enggNoteEditor.open({
        labelField: true,
        text: String(geometry[key] ?? ""),
        title: key === "xLabel" ? "Horizontal axis" : "Vertical axis",
        placeholder: "insert axis label",
        object,
        point: projected || anchor,
        state: drawingState,
        cameraSignal: followCamera,

        onApply: (text) => {
          const live = drawingState.objects.find(
            (candidate) => candidate.id === object.id,
          );

          if (!live) {
            return;
          }

          const next = String(text ?? "").trim();

          if (next === String(live.geometry?.[key] ?? "")) {
            return;
          }

          const previous = enggDrawingState.snapshotDrawing(drawingState);

          live.geometry = { ...(live.geometry || {}), [key]: next };

          enggDrawingState.commitDrawingChange(drawingState, previous);

          renderProperties();
        },
      });
    },
    true,
  );
}
