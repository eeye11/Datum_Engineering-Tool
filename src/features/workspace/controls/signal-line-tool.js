import enggDrawingState from "../../../shared/model/drawing-state.js";
import { routeSignalLine, signalInputIsConnected, signalNodeAtPoint } from "../../../shared/model/signal-line.js";
import { commitCreatedFeature } from "../geometry/creation-commit.js";
import { drawingState } from "../editor-state.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";

export function handleSignalLineClick(point) {
    const pendingStart = drawingState.interaction.signalLineStart;
    const side = pendingStart ? "inputs" : "outputs";
    const tolerance = 6 / Math.max(drawingState.camera.zoom, 0.25);
    const node = signalNodeAtPoint(
        drawingState.objects,
        point,
        tolerance,
        side
    );

    if (!node) {
        setToolMessage(`Select an ${pendingStart ? "input" : "output"} node`);
        return false;
    }

    if (
        pendingStart &&
        signalInputIsConnected(drawingState.objects, node.object.id, node.index)
    ) {
        setToolMessage("That input node already has a signal line");
        return false;
    }

    if (!pendingStart) {
        drawingState.interaction.signalLineStart = {
            objectId: node.object.id,
            side: node.side,
            index: node.index,
            position: node.position
        };
        setToolMessage("Select an input node");
        renderCurrentDrawing();
        return true;
    }

    if (
        pendingStart.objectId === node.object.id &&
        pendingStart.side === node.side &&
        pendingStart.index === node.index
    ) {
        setToolMessage("Choose a different input node");
        return false;
    }

    const points = routeSignalLine(
        pendingStart.position,
        node.position,
        drawingState.objects
    );

    if (!points) {
        setToolMessage("No clear orthogonal route is available between those nodes");
        return false;
    }

    const previousObjects = enggDrawingState.snapshotDrawing(drawingState);

    const object = {
        type: "polyline",
        name: "Signal Line",
        geometry: {
            points,
            closed: false
        },
        style: {
            stroke: "#000000",
            lineWidth: "thin",
            lineType: "solid",
            opacity: 1
        },
        metadata: {
            controlsKind: "signal-line",
            from: {
                objectId: pendingStart.objectId,
                side: pendingStart.side,
                index: pendingStart.index
            },
            to: {
                objectId: node.object.id,
                side: node.side,
                index: node.index
            }
        }
    };

    drawingState.interaction.signalLineStart = null;
    commitCreatedFeature(object, previousObjects);
    setToolMessage("Select an output node");
    renderCurrentDrawing();
    return true;
}
