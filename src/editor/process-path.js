import model from "../core/model/drawing-state.js";
import { selectionBounds } from "../core/selection/selection-transform.js";
import { isSaturationCurve } from "../features/thermodynamics/saturation-curve.js";
import { drawingState } from "./editor-state.js";
import { renderCurrentDrawing } from "./canvas-render.js";
import { commitCreatedFeature } from "./creation-sizing.js";
import { renderProperties } from "./feature-panel.js";
import { activateTool } from "./tool-activation.js";
import { setToolMessage } from "./toolbar-render.js";

export function addProcessPoint(point) {
    const interaction = drawingState.interaction;
    if (interaction.phase === "idle") {
        const diagram = [...drawingState.objects].reverse().find(object => {
            if (!isSaturationCurve(object)) return false;
            const box = selectionBounds([object], [object.id]);
            return box && point.x >= box.minX && point.x <= box.maxX && point.y >= box.minY && point.y <= box.maxY;
        });
        if (!diagram) {
            setToolMessage("Click inside a saturation diagram to place the first process state");
            return;
        }
        model.setInteraction(drawingState, {
            phase: "first-point", sourceId: diagram.id,
            startPoint: { ...point }, currentPoint: { ...point }, points: [{ ...point }]
        });
    } else {
        const last = interaction.points.at(-1);
        if (Math.hypot(point.x - last.x, point.y - last.y) > 1e-8) {
            interaction.points.push({ ...point });
            interaction.startPoint = { ...point };
            interaction.currentPoint = { ...point };
        }
    }
    const points = drawingState.interaction.points;
    drawingState.interaction.preview = {
        id: "process-path-preview", type: "polyline",
        geometry: { points: points.map(point => ({ ...point })) },
        style: { stroke: "#dc2626", fill: "none", lineWidth: drawingState.styleDefaults.lineWidth, lineType: "dashed" },
        metadata: { thermodynamicsKind: "process-path", stateCount: points.length }
    };
    setToolMessage("Click the next process state; Enter or double-click finishes. Esc cancels");
    renderCurrentDrawing();
}

export function finishProcessPath() {
    const interaction = drawingState.interaction;
    if (drawingState.activeTool !== "process-path" || interaction.points.length < 2) return false;
    const object = model.geometryFactories.polyline(interaction.points.map(point => ({ ...point })), {
        name: "Process Path", style: { ...drawingState.styleDefaults, stroke: "#dc2626", fill: "none", lineType: "solid" },
        metadata: { thermodynamicsKind: "process-path" }
    });
    object.parentId = interaction.sourceId;
    commitCreatedFeature(object);
    activateTool("select");
    setToolMessage("Process path created - drag its state dots to adjust the process");
    renderProperties();
    renderCurrentDrawing();
    return true;
}
