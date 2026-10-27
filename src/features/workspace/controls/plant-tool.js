import enggDrawingState from "../../../shared/model/drawing-state.js";
import { BLOCK_KIND, DEFAULT_PLANT_FILL, GAIN_KIND, PLANT_KIND, SUM_KIND } from "../../../shared/model/plant.js";
import { drawingState } from "../editor-state.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { activateTool } from "../../../components/layout/toolbar/tool-activation.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";

const CONTROL_DIMENSIONS = {
    plant: { width: 60, height: 30 },
    block: { width: 15, height: 30 },
    gain: { width: 36, height: 30 }
};

function placeControlBlock(point, kind) {
    const dimensions = CONTROL_DIMENSIONS[kind];
    const isPlant = kind === "plant";
    const previousObjects = enggDrawingState.snapshotDrawing(drawingState);
    let object = {
        type: "rectangle",
        name: isPlant ? "Plant" : "Block",
        geometry: {
            position: {
                x: point.x - dimensions.width / 2,
                y: point.y + dimensions.height / 2
            },
            width: dimensions.width,
            height: dimensions.height,
            rotation: 0
        },
        style: {
            ...drawingState.styleDefaults,
            fill: DEFAULT_PLANT_FILL,
            fillMode: "solid"
        },
        metadata: {
            controlsKind: isPlant ? PLANT_KIND : BLOCK_KIND,
            inputs: 1,
            outputs: 1,
            showNodeLabels: true
        }
    };
    if (isPlant) {
        object.metadata.plantLabel = "";
    }

    object = enggDrawingState.addObject(drawingState, object);
    enggDrawingState.selectObject(drawingState, object.id);

    const dialog = document.createElement("dialog");
    dialog.className = "engg-dialog plant-options-dialog";
    dialog.setAttribute("aria-labelledby", "controlBlockOptionsTitle");
    dialog.innerHTML = `
        <form>
            <h2 class="engg-dialog-title" id="controlBlockOptionsTitle">${isPlant ? "Plant" : "Block"} nodes</h2>
            <p class="engg-dialog-description">Choose the number of inputs and outputs. Inputs appear on the left; outputs appear on the right.</p>
            ${isPlant ? `<label class="engg-dialog-field">
                <span class="engg-dialog-field-label">Plant label</span>
                <input class="engg-dialog-input" name="plantLabel" type="text" autocomplete="off">
            </label>` : `
            <label class="engg-dialog-field">
                <span class="engg-dialog-field-label">Block label (/ for fraction, ^ for exponent)</span>
                <input class="engg-dialog-input" name="blockLabel" type="text" autocomplete="off">
            </label>
            <label class="engg-dialog-field">
                <span class="engg-dialog-field-label">Lower label</span>
                <input class="engg-dialog-input" name="blockLowerLabel" type="text" autocomplete="off">
            </label>`}
            <label class="engg-dialog-field">
                <span class="engg-dialog-field-label">Input nodes</span>
                <input class="engg-dialog-input" name="inputs" type="number" min="0" step="1" value="1" required>
            </label>
            <label class="engg-dialog-field">
                <span class="engg-dialog-field-label">Output nodes</span>
                <input class="engg-dialog-input" name="outputs" type="number" min="0" step="1" value="1" required>
            </label>
            <label class="engg-dialog-field plant-options-label">
                <input name="showNodeLabels" type="checkbox" checked>
                <span class="engg-dialog-field-label">Label nodes</span>
            </label>
            <div class="engg-dialog-actions">
                <button class="engg-dialog-button" type="button" data-cancel>Cancel</button>
                <button class="engg-dialog-button engg-dialog-button-primary" type="submit">Apply</button>
            </div>
        </form>`;

    const form = dialog.querySelector("form");
    const inputs = form.elements.namedItem("inputs");
    const outputs = form.elements.namedItem("outputs");
    const showNodeLabels = form.elements.namedItem("showNodeLabels");
    const plantLabel = isPlant ? form.elements.namedItem("plantLabel") : null;
    const blockLabel = isPlant ? null : form.elements.namedItem("blockLabel");
    const blockLowerLabel = isPlant ? null : form.elements.namedItem("blockLowerLabel");
    let committed = false;

    const finish = () => {
        if (committed) {
            return;
        }

        committed = true;
        enggDrawingState.commitDrawingChange(drawingState, previousObjects);
        dialog.remove();
        renderProperties();
        renderCurrentDrawing();
        activateTool("select");
    };

    form.addEventListener("submit", (event) => {
        event.preventDefault();

        const inputCount = inputs.valueAsNumber;
        const outputCount = outputs.valueAsNumber;
        const valid =
            Number.isSafeInteger(inputCount) &&
            inputCount >= 0 &&
            Number.isSafeInteger(outputCount) &&
            outputCount >= 0;

        inputs.setCustomValidity(
            Number.isSafeInteger(inputCount) && inputCount >= 0
                ? ""
                : "Enter a whole number of zero or more."
        );
        outputs.setCustomValidity(
            Number.isSafeInteger(outputCount) && outputCount >= 0
                ? ""
                : "Enter a whole number of zero or more."
        );

        if (!valid || !form.reportValidity()) {
            return;
        }

        object.metadata = {
            ...object.metadata,
            inputs: inputCount,
            outputs: outputCount,
            showNodeLabels: showNodeLabels.checked
        };
        if (plantLabel) {
            object.metadata.plantLabel = plantLabel.value;
        }
        if (blockLabel && blockLowerLabel) {
            object.metadata.blockLabel = blockLabel.value;
            object.metadata.blockLowerLabel = blockLowerLabel.value;
        }
        dialog.close();
    });

    dialog.querySelector("[data-cancel]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", finish, { once: true });

    document.body.append(dialog);
    renderProperties();
    renderCurrentDrawing();
    dialog.showModal();
    inputs.focus();
    setToolMessage(`Configure the ${isPlant ? "plant" : "block"}'s input and output nodes`);

    return object;
}

export function placePlant(point) {
    return placeControlBlock(point, "plant");
}

export function placeBlock(point) {
    return placeControlBlock(point, "block");
}

export function placeGain(point) {
    const dimensions = CONTROL_DIMENSIONS.gain;
    const previousObjects = enggDrawingState.snapshotDrawing(drawingState);
    const object = enggDrawingState.addObject(drawingState, {
        type: "rectangle",
        name: "Gain",
        geometry: {
            position: {
                x: point.x - dimensions.width / 2,
                y: point.y + dimensions.height / 2
            },
            width: dimensions.width,
            height: dimensions.height,
            rotation: 0
        },
        style: {
            ...drawingState.styleDefaults,
            fill: DEFAULT_PLANT_FILL,
            fillMode: "solid"
        },
        metadata: {
            controlsKind: GAIN_KIND,
            gainValue: "1"
        }
    });

    enggDrawingState.selectObject(drawingState, object.id);
    enggDrawingState.commitDrawingChange(drawingState, previousObjects);
    renderProperties();
    renderCurrentDrawing();
    activateTool("select");
    return object;
}

export function placeSum(point) {
    const previousObjects = enggDrawingState.snapshotDrawing(drawingState);
    const object = enggDrawingState.addObject(drawingState, {
        type: "circle",
        name: "Sum",
        geometry: {
            center: { x: point.x, y: point.y },
            radius: 18
        },
        style: {
            ...drawingState.styleDefaults,
            fill: DEFAULT_PLANT_FILL,
            fillMode: "solid"
        },
        metadata: {
            controlsKind: SUM_KIND,
            inputs: 2,
            outputs: 1,
            inputSigns: ["+", "+"]
        }
    });

    enggDrawingState.selectObject(drawingState, object.id);
    enggDrawingState.commitDrawingChange(drawingState, previousObjects);
    renderProperties();
    renderCurrentDrawing();
    activateTool("select");
    return object;
}
