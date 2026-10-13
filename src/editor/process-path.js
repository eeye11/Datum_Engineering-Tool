import model from "../core/model/drawing-state.js";
import { selectionBounds } from "../core/selection/selection-transform.js";
import { isSaturationCurve } from "../features/thermodynamics/saturation-curve.js";
import { drawingState } from "./editor-state.js";
import { renderCurrentDrawing } from "./canvas-render.js";
import { commitCreatedFeature } from "./creation-sizing.js";
import { renderProperties } from "./feature-panel.js";
import { activateTool } from "./tool-activation.js";
import { setToolMessage } from "./toolbar-render.js";

export function isProcessPlotTool(tool) {
    return ["process-path", "constant-temp-pressure-lines"].includes(tool);
}

function plotName(tool) {
    return { "process-path": "Process Path", "constant-temp-pressure-lines": "Const Temp/Pressure Line" }[tool];
}

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
        style: { stroke: drawingState.activeTool === "process-path" ? "#dc2626" : "#808080", fill: "none", lineWidth: drawingState.styleDefaults.lineWidth, lineType: "dashed" },
        metadata: { thermodynamicsKind: drawingState.activeTool, stateCount: points.length }
    };
    setToolMessage("Click the next point; Enter or double-click finishes. Esc cancels");
    renderCurrentDrawing();
}

export function finishProcessPath() {
    const interaction = drawingState.interaction;
    if (!isProcessPlotTool(drawingState.activeTool) || interaction.points.length < 2) return false;
    const tool = drawingState.activeTool;
    const object = model.geometryFactories.polyline(interaction.points.map(point => ({ ...point })), {
        name: plotName(tool), style: { ...drawingState.styleDefaults, stroke: tool === "process-path" ? "#dc2626" : "#808080", fill: "none", lineType: tool === "process-path" ? "solid" : "dashed" },
        metadata: { thermodynamicsKind: tool === "process-path" ? "process-path" : tool }
    });
    object.parentId = interaction.sourceId;
    commitCreatedFeature(object);
    activateTool("select");
    setToolMessage(`${plotName(tool)} created - drag its dots to adjust`);
    renderProperties();
    renderCurrentDrawing();
    return true;
}
