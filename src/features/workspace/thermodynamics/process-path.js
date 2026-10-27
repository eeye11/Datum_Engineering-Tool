import model from "../../../shared/model/drawing-state.js";
import { selectionBounds } from "../../../shared/selection/selection-transform.js";
import { isProcessDiagram } from "../model/thermodynamics/saturation-curve.js";
import { drawingState } from "../editor-state.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { commitCreatedFeature } from "../geometry/creation-commit.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { activateTool } from "../../../components/layout/toolbar/tool-activation.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";
import { isLegacyResetTool } from "../../../components/layout/toolbar/phase-reset.js";

export function isProcessPlotTool(tool) {
    return ["process-path", "constant-temp-pressure-lines"].includes(tool);
}

function plotName(tool) {
    return { "process-path": "Process Path", "constant-temp-pressure-lines": "Const Temp/Pressure Line" }[tool];
}

export function processPathInstruction() {
    const count = drawingState.interaction.points?.length || 0;
    if (count < 2) return "Place the next state. Esc cancels";
    return drawingState.activeTool === "process-path" && count >= 3
        ? "Click the last state to finish, or the first state to close the cycle. Enter also finishes"
        : "Click the last state again to finish. Enter also finishes";
}

export function addProcessPoint(point) {
    /*
     * PHASE 1 RESET: the thermodynamics plot tools are placeholders.
     */
    if (isLegacyResetTool(drawingState.activeTool)) {
        setToolMessage(
            "Tool placeholder - drawing implementation removed for the LaTeX tool library migration"
        );
        return;
    }

    const interaction = drawingState.interaction;
    if (interaction.phase === "idle") {
        const diagram = [...drawingState.objects].reverse().find(object => {
            if (!isProcessDiagram(object)) return false;
            const box = selectionBounds([object], [object.id]);
            return box && point.x >= box.minX && point.x <= box.maxX && point.y >= box.minY && point.y <= box.maxY;
        });
        if (!diagram) {
            setToolMessage("Click inside a process diagram to place the first process state");
            return;
        }
        model.setInteraction(drawingState, {
            phase: "first-point", sourceId: diagram.id,
            startPoint: { ...point }, currentPoint: { ...point }, points: [{ ...point }]
        });
    } else {
        const first = interaction.points[0];
        const tolerance = 8 / (model.BASE_PIXELS_PER_UNIT * drawingState.camera.zoom);
        if (drawingState.activeTool === "process-path" && interaction.points.length >= 3 &&
            Math.hypot(point.x - first.x, point.y - first.y) <= tolerance) {
            interaction.points.push({ ...first });
            finishProcessPath();
            return;
        }
        const last = interaction.points.at(-1);
        if (interaction.points.length >= 2 && Math.hypot(point.x - last.x, point.y - last.y) <= tolerance) {
            finishProcessPath();
            return;
        }
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
    setToolMessage(processPathInstruction());
    renderCurrentDrawing();
}

export function finishProcessPath() {
    const interaction = drawingState.interaction;
    if (!isProcessPlotTool(drawingState.activeTool) || interaction.points.length < 2) return false;
    const tool = drawingState.activeTool;
    const points = interaction.points;
    const closed = tool === "process-path" && points.length >= 4 &&
        Math.hypot(points[0].x - points.at(-1).x, points[0].y - points.at(-1).y) < 1e-8;
    const object = model.geometryFactories.polyline(interaction.points.map(point => ({ ...point })), {
        name: plotName(tool), style: { ...drawingState.styleDefaults, stroke: tool === "process-path" ? "#dc2626" : "#808080", fill: "none", lineType: tool === "process-path" ? "solid" : "dashed" },
        metadata: { thermodynamicsKind: tool === "process-path" ? "process-path" : tool,
            ...(closed ? { closed: true, stateCount: points.length - 1 } : {}) }
    });
    object.parentId = interaction.sourceId;
    commitCreatedFeature(object);
    activateTool("select");
    setToolMessage(tool === "process-path"
        ? "Process path created - drag a middle dot to curve a segment, or a state dot to move a state"
        : `${plotName(tool)} created - drag its dots to adjust`);
    renderProperties();
    renderCurrentDrawing();
    return true;
}
