/*
 * Wiring the file, style and zoom controls.
 */

import { applyStyleControls, setupColourControl } from "./colour-picker.js";
import { FILE_ACTIONS, drawingFileNew, drawingFileOpen, drawingFileSave, newDrawing, openDrawing, saveDrawing } from "./document-commands.js";
import { drawingColor, drawingLineType, drawingThickness, drawingZoomOut } from "./dom.js";
import { editorState } from "./editor-state.js";
import { updateDrawingZoom } from "./viewport.js";

function setupStyleMenu(select, label, preview, customAction) {
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "drawing-line-type-trigger";
    trigger.setAttribute("aria-label", label);
    trigger.title = label;
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    select.hidden = true;
    select.after(trigger);

    let menu = null;
    const close = () => {
        menu?.remove();
        menu = null;
        trigger.setAttribute("aria-expanded", "false");
    };
    trigger.addEventListener("click", () => {
        if (menu) { close(); return; }
        menu = document.createElement("div");
        menu.className = "drawing-line-type-menu";
        menu.setAttribute("role", "menu");
        menu.setAttribute("aria-label", label);
        for (const option of select.options) {
            const item = document.createElement("button");
            item.type = "button";
            item.setAttribute("role", "menuitemradio");
            item.setAttribute("aria-checked", String(option.selected));
            item.innerHTML = preview(option.value);
            const text = document.createElement("span");
            text.textContent = option.textContent;
            item.append(text);
            item.addEventListener("click", () => {
                select.value = option.value;
                select.dispatchEvent(new Event("change", { bubbles: true }));
                close();
                trigger.focus();
            });
            menu.append(item);
        }
        if (customAction) {
            const custom = document.createElement("button");
            custom.type = "button";
            custom.textContent = "Custom…";
            custom.setAttribute("role", "menuitem");
            custom.addEventListener("click", () => {
                close();
                customAction(trigger);
            });
            menu.append(custom);
        }
        document.body.append(menu);
        const bounds = trigger.getBoundingClientRect();
        menu.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - menu.offsetWidth - 8))}px`;
        menu.style.top = `${bounds.bottom + 4}px`;
        trigger.setAttribute("aria-expanded", "true");
        menu.querySelector('[aria-checked="true"]')?.focus();
        menu.addEventListener("keydown", event => {
            if (event.key === "Escape") { event.preventDefault(); close(); trigger.focus(); }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const items = [...menu.children];
                const next = items.indexOf(document.activeElement) + (event.key === "ArrowDown" ? 1 : -1);
                items[(next + items.length) % items.length].focus();
            }
        });
    });
    document.addEventListener("pointerdown", event => {
        if (menu && !menu.contains(event.target) && !trigger.contains(event.target)) close();
    });
    window.addEventListener("resize", close);
}

function openThicknessDialog(trigger) {
    const dialog = document.createElement("dialog");
    dialog.className = "drawing-thickness-dialog";
    dialog.setAttribute("aria-label", "Custom line thickness");
    dialog.innerHTML = `
        <form>
            <h2>Custom line thickness</h2>
            <div class="drawing-thickness-fields">
                <label>Thickness (mm)
                    <input name="thickness" type="number" step="any" required autofocus>
                </label>
                <div class="drawing-thickness-preview">
                    <span>Preview</span>
                    <svg viewBox="0 0 120 60" width="120" height="60" aria-hidden="true">
                        <path d="M10 30h100" fill="none" stroke="currentColor" />
                    </svg>
                </div>
            </div>
            <div class="drawing-thickness-actions">
                <button type="button" data-cancel>Cancel</button>
                <button type="submit">Apply</button>
            </div>
        </form>`;
    const input = dialog.querySelector("input");
    const stroke = dialog.querySelector("path");
    const apply = dialog.querySelector('[type="submit"]');
    input.value = drawingThickness.value;
    const update = () => {
        const width = input.valueAsNumber;
        const valid = Number.isFinite(width) && width > 0;
        input.setCustomValidity(valid ? "" : "Enter a thickness greater than zero.");
        apply.disabled = !valid;
        // Use the same millimetre-to-pixel ratio for every preview value.
        stroke.setAttribute("stroke-width", valid ? String(width * 96 / 25.4) : "0");
    };
    input.addEventListener("input", update);
    dialog.querySelector("[data-cancel]").addEventListener("click", () => dialog.close());
    dialog.querySelector("form").addEventListener("submit", event => {
        event.preventDefault();
        update();
        if (!input.reportValidity()) return;
        const width = input.valueAsNumber;
        let option = [...drawingThickness.options].find(item => Number(item.value) === width);
        if (!option) {
            option = document.createElement("option");
            option.value = String(width);
            option.textContent = `${width} mm`;
            drawingThickness.append(option);
        }
        drawingThickness.value = option.value;
        drawingThickness.dispatchEvent(new Event("change", { bubbles: true }));
        dialog.close();
    });
    dialog.addEventListener("close", () => {
        dialog.remove();
        trigger.focus();
    });
    document.body.append(dialog);
    update();
    dialog.showModal();
    input.select();
}

/*
 * Wire this part of the editor to the page. Called once, at start-up,
 * by editor/index.js.
 */
export function installToolbarWiring() {
    document
      .querySelectorAll("[data-file-action]")
      .forEach((button) => {
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
        setupStyleMenu(drawingThickness, "Line thickness", value => {
            const width = Math.max(0.5, Math.min(6, Number(value) * 3));
            return `<svg viewBox="0 0 30 12" aria-hidden="true"><path d="M2 6h26" fill="none" stroke="currentColor" stroke-width="${width}"/></svg>`;
        }, openThicknessDialog);
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
        const patterns = { solid: "", dashed: "5 3", center: "9 3 1 3", construction: "2 3" };
        setupStyleMenu(drawingLineType, "Line type", value =>
            `<svg viewBox="0 0 30 12" aria-hidden="true"><path d="M2 6h26" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="${patterns[value] || ""}"/></svg>`
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
