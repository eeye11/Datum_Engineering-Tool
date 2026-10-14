import stateModel from "../../core/model/drawing-state.js";
import { drawingState, editorState } from "../editor-state.js";
import { drawingCanvas } from "../dom.js";
import { renderCurrentDrawing } from "../workspace/canvas-render.js";
import { renderProperties } from "../panels/feature-panel.js";

let activeInput = null;

export function installAxisLabelEditor() {
    drawingCanvas.addEventListener("pointerdown", event => {
        if (event.button !== 0 || drawingState.interaction.phase !== "idle" || editorState.manipulationDrag) return;
        const labels = [...drawingCanvas.querySelectorAll("[data-saturation-axis]")].reverse();
        const label = labels.find(node => {
            const box = node.getBoundingClientRect();
            return event.clientX >= box.left - 5 && event.clientX <= box.right + 5 &&
                event.clientY >= box.top - 5 && event.clientY <= box.bottom + 5;
        });
        if (!label) return;
        const object = drawingState.objects.find(item => item.id === label.dataset.axisFeatureId);
        if (!object) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        editorState.creationDragConsumedClick = true;
        activeInput?.blur();
        const key = label.dataset.saturationAxis;
        const box = label.getBoundingClientRect();
        const input = document.createElement("input");
        input.type = "text";
        input.value = object.geometry[key] || "";
        input.placeholder = "insert axis label";
        input.setAttribute("aria-label", key === "xLabel" ? "Horizontal axis label" : "Vertical axis label");
        Object.assign(input.style, {
            position: "fixed", left: `${Math.max(4, Math.min(box.left, window.innerWidth - 184))}px`,
            top: `${Math.max(4, box.top - 4)}px`, width: "180px", zIndex: "10000",
            padding: "4px 6px", font: "14px sans-serif", border: "1px solid #3b82f6",
            borderRadius: "4px", background: "white", color: "black"
        });
        let finished = false;
        const finish = apply => {
            if (finished) return;
            finished = true;
            if (apply && input.value.trim() !== (object.geometry[key] || "")) {
                const previous = stateModel.snapshotDrawing(drawingState);
                object.geometry[key] = input.value.trim();
                stateModel.commitDrawingChange(drawingState, previous);
            }
            input.remove();
            activeInput = null;
            renderProperties();
            renderCurrentDrawing();
        };
        input.addEventListener("keydown", event => {
            event.stopPropagation();
            if (event.key === "Enter" || event.key === "Escape") {
                event.preventDefault();
                finish(event.key === "Enter");
            }
        });
        input.addEventListener("blur", () => finish(true));
        document.body.appendChild(input);
        activeInput = input;
        input.focus();
        input.select();
    }, true);
}
