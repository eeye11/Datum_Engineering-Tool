/*
 * Wiring the file, style and zoom controls.
 */

import { applyStyleControls, setupColourControl } from "../panels/colour-picker.js";
import { FILE_ACTIONS, drawingFileNew, drawingFileOpen, drawingFileSave, newDrawing, openDrawing, saveDrawing } from "../../../features/workspace/commands/document-commands.js";
import { drawingColor, drawingLineType, drawingThickness, drawingZoomOut } from "../../../features/workspace/dom.js";
import { editorState } from "../../../features/workspace/editor-state.js";
import { updateDrawingZoom } from "../workspace/viewport.js";

/*
 * Wire this part of the editor to the page. Called once, at start-up,
 * by editor/index.js.
 */
export function installToolbarWiring() {
    const fileActionButtons =
      globalThis.document?.querySelectorAll("[data-file-action]") ?? [];

    fileActionButtons.forEach((button) => {
        button.addEventListener("click", () => {
          const action =
            FILE_ACTIONS[button.dataset.fileAction];

          if (action) {
            action();
          }
        });
      });

    if (drawingFileNew) {
        drawingFileNew.addEventListener(
            "click",
            newDrawing
        );
    }

    if (drawingFileSave) {
        drawingFileSave.addEventListener(
            "click",
            saveDrawing
        );
    }

    if (drawingFileOpen) {
        drawingFileOpen.addEventListener(
            "click",
            openDrawing
        );
    }

    if (
        drawingThickness
    ) {
        drawingThickness.addEventListener(
            "change",
            applyStyleControls
        );
    }

    if (
        drawingColor
    ) {
        drawingColor.addEventListener(
            "change",
            applyStyleControls
        );

        /*
         * Build the CAD colour control around the existing
         * native colour input.
         */
        setupColourControl();
    }

    if (
        drawingLineType
    ) {
        drawingLineType.addEventListener(
            "change",
            applyStyleControls
        );
    }

    if (
        drawingZoomOut
    ) {
        drawingZoomOut.addEventListener(
            "click",
            () =>
                updateDrawingZoom(
                    editorState.drawingZoom - 10
                )
        );
    }
}
