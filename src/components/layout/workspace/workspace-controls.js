/*
 * The workspace buttons: back, grid, snap, display toggles, undo/redo, and the Modify/View tools.
 */

import { renderCurrentDrawing } from "./canvas-render.js";
import { drawingDisplayToggles, drawingGridToggle, drawingRedo, drawingSnapToggle, drawingUndo } from "../../../features/workspace/dom.js";
import { drawingState, editorState } from "../../../features/workspace/editor-state.js";
import { activateGlobalTool } from "../../../features/workspace/commands/modify-tools.js";
import { syncWorkspaceSettingToggles } from "./sheet-controller.js";
import { performRedo, performUndo } from "../toolbar/tool-activation.js";
import { toggleFitDrawing, toggleWorkspaceSetting } from "./viewport.js";

/*
 * Paint the active highlight across the global toolbar.
 * Exactly one button can be active at a time.
 */
function refreshGlobalToolHighlight() {
    const buttons =
        globalThis.document?.querySelectorAll("[data-global-tool]") ?? [];

    buttons.forEach(button => {
            const isActive =
                button.dataset.globalTool ===
                editorState.activeGlobalTool;

            button.classList.toggle(
                "active",
                isActive
            );

            button.setAttribute(
                "aria-pressed",
                isActive
                    ? "true"
                    : "false"
            );
        });
}

/*
 * Clear the highlight. Called whenever a tool is
 * cancelled, replaced, or completes.
 */
export function clearGlobalToolHighlight() {
    editorState.activeGlobalTool =
        null;

    refreshGlobalToolHighlight();
}

/*
 * Wire this part of the editor to the page. Called once, at start-up,
 * by editor/index.js.
 */
export function installWorkspaceControls() {
    const fitButton = globalThis.document?.getElementById("drawingFitView");
    fitButton?.addEventListener("click", toggleFitDrawing);

    if (
        drawingGridToggle
    ) {
        drawingGridToggle.addEventListener(
            "click",
            () =>
                toggleWorkspaceSetting(
                    drawingGridToggle,
                    "Grid"
                )
        );
    }

    if (
        drawingSnapToggle
    ) {
        drawingSnapToggle.addEventListener(
            "click",
            () =>
                toggleWorkspaceSetting(
                    drawingSnapToggle,
                    "Snap"
                )
        );
    }

    /*
     * THE THREE DISPLAY SETTINGS, WIRED.
     *
     * Each writes its own field on `state.display` and nothing else - the
     * three are independent, so one being turned off must not imply anything
     * about the others. That is the whole reason they are three controls and
     * not one "Display" switch: "magnitudes without units" is a real thing to
     * want, and a single switch cannot express it.
     *
     * No snapshot and no commit. A display setting is not a change to the
     * drawing - nothing is added, removed or moved, and the geometry is
     * identical either way - so putting it in the Undo stack would make Ctrl+Z
     * appear to do nothing on the first press and undo whatever the student did
     * before it on the second. Grid and Snap are treated the same way.
     *
     * The dimensions are hidden by SETTING them, not by removing them, so
     * turning the toggle back on restores every dimension exactly as it was -
     * including the ones the student had deliberately deleted, because those are
     * still absent from the document.
     */
    drawingDisplayToggles.forEach(({ button, key }) => {
        if (!button) {
            return;
        }

        button.addEventListener("click", () => {
            const display = {
                ...(drawingState.display || {})
            };

            const nextOn =
                button.getAttribute("aria-pressed") !==
                "true";

            display[key] = nextOn;

            drawingState.display = display;

            if (key === "showDimensions") {
                drawingState.dimensionsVisible =
                    nextOn;
            }

            syncWorkspaceSettingToggles();

            renderCurrentDrawing();
        });
    });

    if (
        drawingUndo
    ) {
        drawingUndo.addEventListener(
            "click",
            performUndo
        );
    }
    if (
        drawingRedo
    ) {
        drawingRedo.addEventListener(
            "click",
            performRedo
        );
    }

    (globalThis.document?.querySelectorAll("[data-global-tool]") ?? []).forEach(button => {
        button.addEventListener("click", () => {
            const toolId =
                button.dataset.globalTool;

            activateGlobalTool(
                toolId,
                button
            );

            /*
             * Pan and the Modify tools stay active until they
             * finish or are cancelled; Zoom and Fit act once
             * and release immediately.
             */
            editorState.activeGlobalTool =
                [
                    "pan",
                    "move",
                    "rotate",
                    "mirror",
                    "trim",
                    "extend"
                ].includes(
                    toolId
                )
                    ? toolId
                    : null;

            refreshGlobalToolHighlight();
        });
    });
}
