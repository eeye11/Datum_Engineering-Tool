/*
 * The workspace buttons: back, grid, snap, display toggles, undo/redo, and the Modify/View tools.
 */

import { renderCurrentDrawing } from "./canvas-render.js";
import { drawingComponentsBack, drawingDisplayToggles, drawingGridToggle, drawingRedo, drawingSnapToggle, drawingUndo, drawingVectorScale, drawingVectorScaleCustom, drawingVectorScaleValue } from "./dom.js";
import { drawingState, editorState } from "./editor-state.js";
import { renderComponentTree } from "./feature-tree.js";
import enggLoadProfile from "../features/analysis/load-profile.js";
import { activateGlobalTool } from "./modify-tools.js";
import { syncWorkspaceSettingToggles } from "./sheet-controller.js";
import { performRedo, performUndo } from "./tool-activation.js";
import { toggleFitDrawing, toggleWorkspaceSetting } from "./viewport.js";

/*
 * Paint the active highlight across the global toolbar.
 * Exactly one button can be active at a time.
 */
function refreshGlobalToolHighlight() {
    document
        .querySelectorAll("[data-global-tool]")
        .forEach(button => {
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
    const fitButton = document.getElementById("drawingFitView");
    fitButton?.addEventListener("click", toggleFitDrawing);
    if (
        drawingComponentsBack
    ) {
        drawingComponentsBack.addEventListener(
            "click",
            () => {
                /*
                 * Features always returns to the component list,
                 * even when a feature is still selected.
                 *
                 * It is an explicit instruction to go back, so it
                 * must not be overridden by the fact that something
                 * happens to be selected: the selection stays, and
                 * the list still shows it as selected. Clicking that
                 * feature again is what reopens the editing page.
                 */
                editorState.featurePanelView = "tree";
                editorState.featureTreePickedId = null;

                drawingComponentsBack.style.display =
                    "none";

                renderComponentTree();
            }
        );
    }

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

    /*
     * ========================================================
     * THE VECTOR SCALE, AS A GLOBAL DISPLAY SETTING
     * ========================================================
     *
     * It writes `state.statics.vectorScale` - the ONE place every arrow reads its
     * drawn size from - and redraws. Nothing else changes: no force's magnitude,
     * no direction, no attachment, no derived value. The arrows are simply drawn
     * larger or smaller, which is the whole of what this control does.
     *
     * THE OPTIONS COME FROM THE SHARED TABLE, not from a list written here. The
     * decades and the practical multipliers are `VECTOR_SCALE_OPTIONS`, and they
     * are rendered from it so the toolbar and the model cannot disagree about
     * what scales exist. CUSTOM is appended after them, exactly as the panel's
     * dropdown always had it.
     *
     * NO SNAPSHOT AND NO COMMIT, for the same reason Grid, Snap and the display
     * toggles take none: it changes how the drawing LOOKS, not what is drawn, so
     * putting it in the Undo stack would make Ctrl+Z appear to do nothing on the
     * first press. It is stored on the document's `statics` settings, so it
     * saves and reopens with the sheet exactly as those do.
     */
    if (drawingVectorScale) {
        const options = enggLoadProfile.VECTOR_SCALE_OPTIONS
            .map(
                option =>
                    `<option value="${option.value}">${option.label}</option>`
            )
            .join("");

        drawingVectorScale.innerHTML =
            options +
            `<option value="${enggLoadProfile.CUSTOM_VECTOR_SCALE}">Custom…</option>`;

        /*
         * SHOW THE CONTROL IN FORCE. The dropdown reflects the stored scale
         * when it is one of the listed values, and falls to CUSTOM - revealing
         * the field - when it is not, so the control never claims a scale the
         * sheet is not using.
         */
        const syncVectorScaleControl = () => {
            const current = enggLoadProfile.vectorScaleFor(drawingState);

            const isListed = enggLoadProfile.VECTOR_SCALE_OPTIONS.some(
                option => option.value === current
            );

            drawingVectorScale.value = isListed
                ? String(current)
                : enggLoadProfile.CUSTOM_VECTOR_SCALE;

            /*
             * THE VISIBLE VALUE.
             *
             * The select is overlaid and transparent, so this readout is what
             * the student actually sees. It shows the REAL scale - the same
             * number every arrow is drawn from - with the shared table's own
             * `×` suffix, so a custom 3 reads "3×" because 3 IS the scale.
             */
            if (drawingVectorScaleValue) {
                drawingVectorScaleValue.textContent = `${current}\u00d7`;
            }

            if (drawingVectorScale) {
                const label = `Vector Scale: ${current}\u00d7`;

                drawingVectorScale.setAttribute("title", label);
                drawingVectorScale.setAttribute("aria-label", label);
            }

            if (drawingVectorScaleCustom) {
                const showCustom = !isListed;

                drawingVectorScaleCustom.hidden = !showCustom;

                if (showCustom) {
                    drawingVectorScaleCustom.value = String(current);
                }
            }
        };

        /*
         * One place that commits a scale, so the dropdown and the custom field
         * cannot disagree about what a change does. A non-positive or
         * unparsable value is refused and the control is put back in step with
         * the model, rather than storing a scale that would draw nothing.
         */
        const applyVectorScale = value => {
            const numeric = Number(value);

            if (
                !Number.isFinite(numeric) ||
                numeric < enggLoadProfile.MIN_VECTOR_SCALE ||
                numeric > enggLoadProfile.MAX_VECTOR_SCALE
            ) {
                syncVectorScaleControl();

                return;
            }

            drawingState.statics = {
                ...(drawingState.statics || {}),
                vectorScale: numeric
            };

            syncVectorScaleControl();
            renderCurrentDrawing();
        };

        drawingVectorScale.addEventListener("change", () => {
            /*
             * CUSTOM is not a scale - it is the request to type one, exactly as
             * it was in the panel. Choosing it reveals the field and changes
             * nothing else, so picking it by mistake leaves the sheet as it was
             * rather than snapping every arrow back to true length.
             */
            if (
                drawingVectorScale.value ===
                enggLoadProfile.CUSTOM_VECTOR_SCALE
            ) {
                if (drawingVectorScaleCustom) {
                    drawingVectorScaleCustom.hidden = false;
                    drawingVectorScaleCustom.focus();
                    drawingVectorScaleCustom.select?.();
                }

                return;
            }

            applyVectorScale(drawingVectorScale.value);
        });

        if (drawingVectorScaleCustom) {
            /*
             * `input` while typing so the arrows follow the number live, and
             * `change` on commit - the same pair the Features panel's numeric
             * fields use.
             */
            drawingVectorScaleCustom.addEventListener("input", () => {
                applyVectorScale(drawingVectorScaleCustom.value);
            });

            drawingVectorScaleCustom.addEventListener("keydown", event => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    applyVectorScale(drawingVectorScaleCustom.value);
                }
            });
        }

        syncVectorScaleControl();
    }

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

    document.querySelectorAll("[data-global-tool]").forEach(button => {
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
