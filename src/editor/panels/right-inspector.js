import enggDrawingState from "../../core/model/drawing-state.js";
import { readLatexDrawing } from "../../file/latex/latex-reader.js";
import { writeCanonicalTikzPicture } from "../../file/latex/latex-document.js";
import { drawingState, editorState } from "../editor-state.js";
import {
    drawingObjectsList,
    drawingSourceApply,
    drawingSourceDiagnostics,
    drawingSourceEditor
} from "../dom.js";

const tabs = [
    {
        id: "objects",
        button: document.getElementById("drawingObjectsTabButton"),
        panel: document.getElementById("drawingObjectsTab")
    },
    {
        id: "features",
        button: document.getElementById("drawingFeaturesTabButton"),
        panel: document.getElementById("drawingFeaturesTab")
    },
    {
        id: "source",
        button: document.getElementById("drawingSourceTabButton"),
        panel: document.getElementById("drawingSourceTab")
    }
];

const sourcesBySheet = new Map();
let renderProperties = () => {};
let renderCurrentDrawing = () => {};
let serializeDocumentBody = () => ({});
let activeSheet = () => null;

function setActiveTab(id) {
    tabs.forEach(({ id: tabId, button, panel }) => {
        const selected = tabId === id;
        button?.setAttribute("aria-selected", String(selected));
        button?.classList.toggle("active", selected);
        if (panel) {
            panel.hidden = !selected;
        }
    });
    if (
        id === "features" &&
        drawingState.selection?.selectedObjectIds?.length === 1
    ) {
        editorState.featurePanelView = "edit";
        renderProperties();
    }
}

function objectLabel(object, index) {
    return object.name || `${String(object.type || "Object").replaceAll("-", " ")} ${index + 1}`;
}

function renderObjectList() {
    if (!drawingObjectsList) {
        return;
    }

    const selectedIds = drawingState.selection?.selectedObjectIds || [];

    drawingObjectsList.replaceChildren(
        ...drawingState.objects.map((object, index) => {
            const row = document.createElement("button");
            row.type = "button";
            row.className = "drawing-object-row";
            row.classList.toggle("selected", selectedIds.includes(object.id));
            row.dataset.objectId = object.id;
            row.textContent = objectLabel(object, index);
            row.setAttribute("aria-pressed", String(selectedIds.includes(object.id)));
            row.addEventListener("click", () => {
                editorState.featurePanelView = "edit";
                enggDrawingState.selectObject(drawingState, object.id);
                renderProperties();
                renderCurrentDrawing();
            });
            return row;
        })
    );

    if (!drawingState.objects.length) {
        const empty = document.createElement("p");
        empty.className = "drawing-inspector-message";
        empty.textContent = "No objects on this sheet.";
        drawingObjectsList.append(empty);
    }
}

function diagnosticsFor(source) {
    try {
        return readLatexDrawing(source);
    } catch (error) {
        return {
            features: [],
            diagnostics: [{
                line: 1,
                severity: "error",
                message: String(error?.message || error)
            }]
        };
    }
}

function updateSourceDiagnostics(source) {
    const result = diagnosticsFor(source);
    const diagnostics = result.diagnostics || [];

    drawingSourceDiagnostics?.replaceChildren(
        ...diagnostics.map(problem => {
            const item = document.createElement("p");
            item.textContent = `Line ${problem.line}: ${problem.message}`;
            return item;
        })
    );

    const canApply =
        result.features?.length > 0 &&
        diagnostics.length === 0;
    if (drawingSourceApply) {
        drawingSourceApply.disabled = !canApply;
    }
    return { result, canApply };
}

function renderSourceEditor() {
    const sheet = activeSheet();
    if (!sheet || !drawingSourceEditor) {
        return;
    }

    const signature = JSON.stringify(drawingState.objects);
    let sourceState = sourcesBySheet.get(sheet.id);

    if (!sourceState) {
        sourceState = { source: "", signature: null, dirty: false };
        sourcesBySheet.set(sheet.id, sourceState);
    }

    if (!sourceState.dirty && sourceState.signature !== signature) {
        sourceState.source = writeCanonicalTikzPicture(
            serializeDocumentBody(),
            sheet.id
        );
        sourceState.signature = signature;
    }

    if (drawingSourceEditor.value !== sourceState.source) {
        drawingSourceEditor.value = sourceState.source;
    }

    updateSourceDiagnostics(sourceState.source);
    if (!drawingState.objects.length && !sourceState.dirty) {
        if (drawingSourceDiagnostics) {
            drawingSourceDiagnostics.textContent = "Empty sheet — no drawing source to apply.";
        }
    }
}

function applySource() {
    const sheet = activeSheet();
    const sourceState = sheet && sourcesBySheet.get(sheet.id);
    if (!sourceState) {
        return;
    }

    const { result, canApply } = updateSourceDiagnostics(sourceState.source);
    if (!canApply) {
        return;
    }

    const previous = enggDrawingState.snapshotDrawing(drawingState);
    const oldObjects = drawingState.objects;
    const features = result.features.map((feature, index) => {
        const existing = oldObjects[index];
        if (existing?.type === feature.type) {
            feature.id = existing.id;
            feature.name = existing.name || feature.name;
        }
        return feature;
    });

    drawingState.objects = features;
    const remainingSelection = (drawingState.selection?.selectedObjectIds || [])
        .filter(id => features.some(feature => feature.id === id));
    enggDrawingState.selectObjects(drawingState, remainingSelection);
    enggDrawingState.commitDrawingChange(drawingState, previous);

    sourceState.dirty = false;
    sourceState.signature = null;
    renderProperties();
    renderCurrentDrawing();
}

export function installRightInspector(options) {
    renderProperties = options.renderProperties;
    renderCurrentDrawing = options.renderCurrentDrawing;
    serializeDocumentBody = options.serializeDocumentBody;
    activeSheet = options.activeSheet;

    tabs.forEach(({ id, button }) => {
        button?.addEventListener("click", () => setActiveTab(id));
    });

    drawingSourceEditor?.addEventListener("input", () => {
        const sheet = activeSheet();
        if (!sheet) {
            return;
        }
        const sourceState = sourcesBySheet.get(sheet.id) || {
            source: "",
            signature: null,
            dirty: false
        };
        sourceState.source = drawingSourceEditor.value;
        sourceState.dirty = true;
        sourcesBySheet.set(sheet.id, sourceState);
        updateSourceDiagnostics(sourceState.source);
    });

    drawingSourceApply?.addEventListener("click", applySource);
    setActiveTab("objects");
}

export function refreshRightInspector() {
    renderObjectList();
    renderSourceEditor();
}
