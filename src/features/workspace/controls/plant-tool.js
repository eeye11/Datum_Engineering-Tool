import enggDrawingState from "../../../shared/model/drawing-state.js";
import { BLOCK_KIND, DEFAULT_PLANT_FILL, GAIN_KIND, PLANT_KIND, SUM_KIND } from "../../../shared/model/plant.js";
import { drawingState } from "../editor-state.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
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
    } else {
        object.metadata.blockLabel = "";
        object.metadata.blockLowerLabel = "";
    }

    object = enggDrawingState.addObject(drawingState, object);
    enggDrawingState.selectObject(drawingState, object.id);

    /*
     * THE NODE COUNTS ARE NUMBERS, SO THEY KEEP A NUMERIC INTERFACE - inside the
     * drawing, not over it. The block's own NAME is canvas text, so it is typed
     * onto the block with the shared inline editor (see `nameBlockOnCanvas`).
     */
    const dialog = document.createElement("dialog");
    dialog.className = "engg-dialog plant-options-dialog";
    dialog.setAttribute("aria-labelledby", "controlBlockOptionsTitle");
    dialog.innerHTML = `
        <form>
            <h2 class="engg-dialog-title" id="controlBlockOptionsTitle">${isPlant ? "Plant" : "Block"} nodes</h2>
            <p class="engg-dialog-description">Choose the number of inputs and outputs. Inputs appear on the left; outputs appear on the right. Type the block's name on the drawing when you place it.</p>
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

        /*
         * AND THEN ITS NAME, TYPED ON THE BLOCK ITSELF.
         *
         * The name a Plant or a Block shows is canvas text - `[transfer
         * function]` on a plant, a fraction inside a block - so it is entered
         * where it is drawn, through the application's one inline editor. No
         * dialog ever asks for it.
         */
        nameBlockOnCanvas(object, isPlant);

        /*
         * THE TOOL STAYS ARMED. A Plant or a Block is placed one at a time and a
         * diagram is made of several; returning to Select after each one made
         * the Controls placement tools one-shot. Escape, empty canvas or another
         * tool ends it.
         */
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

        const live = drawingState.objects.find((candidate) => candidate.id === object.id) || object;

        live.metadata = {
            ...live.metadata,
            inputs: inputCount,
            outputs: outputCount,
            showNodeLabels: showNodeLabels.checked
        };

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

/*
 * THE BLOCK'S NAME, TYPED WHERE IT IS DRAWN.
 *
 * The field opens on the block's own centre - the same point the name is
 * rendered at - and writes the metadata the painter reads (`plantLabel`, or
 * `blockLabel`/`blockLowerLabel`). It is the SAME inline editor a note uses, so
 * the keys, the commit, the undo entry and the caret are every other canvas
 * text's.
 */
function nameBlockOnCanvas(object, isPlant) {
    const live = drawingState.objects.find((candidate) => candidate.id === object.id);

    if (!live) {
        return;
    }

    const geometry = live.geometry || {};

    const centre = geometry.position
        ? {
            x: Number(geometry.position.x) + (Number(geometry.width) || 0) / 2,
            y: Number(geometry.position.y) - (Number(geometry.height) || 0) / 2,
        }
        : null;

    const openingValue = isPlant
        ? String(live.metadata?.plantLabel ?? "")
        : String(live.metadata?.blockLabel ?? "");

    void import("../../../shared/ui/editors/note-editor.js").then(({ default: editor }) => {
        editor.open({
            labelField: true,
            text: openingValue,
            title: isPlant ? "Plant name" : "Block name",
            placeholder: isPlant ? "transfer function" : "/ for fraction, ^ for exponent",
            object: live,
            point: centre,
            state: drawingState,

            onApply: (text) => {
                const target = drawingState.objects.find((candidate) => candidate.id === object.id);

                if (!target) {
                    return;
                }

                const next = String(text ?? "").trim();
                const key = isPlant ? "plantLabel" : "blockLabel";

                if (String(target.metadata?.[key] ?? "") === next) {
                    return;
                }

                const previous = enggDrawingState.snapshotDrawing(drawingState);

                target.metadata = { ...(target.metadata || {}), [key]: next };

                enggDrawingState.commitDrawingChange(drawingState, previous);

                renderProperties();
                renderCurrentDrawing();
            },
        });
    });
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
    /* The Gain tool stays armed; see the note in the Plant dialog's finish(). */
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
    /* The Sum tool stays armed; see the note in the Plant dialog's finish(). */
    return object;
}
