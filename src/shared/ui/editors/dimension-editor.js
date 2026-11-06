import { attachSymbolInsert } from "./text-symbol-insert.js";
let currentClose = null;

export function openDimensionEditor({ value, references, onApply, title: editorTitle = "Dimension" }) {
    currentClose?.();
    const panel = document.createElement("form");
    panel.className = "drawing-creation-dimension dimension-value-editor";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", editorTitle);
    const title = document.createElement("strong");
    title.textContent = editorTitle;
    panel.append(title);
    const label = document.createElement("label");
    label.textContent = "Magnitude (include units if needed)";
    const input = document.createElement("input");
    input.type = "text"; input.value = String(value ?? "");
    input.setAttribute("aria-label", "Dimension magnitude");
    input.className = "drawing-property-input";
    label.append(input); panel.append(label);
    attachSymbolInsert(input);
    const refs = document.createElement("p"); refs.textContent = `References: ${references || "Unresolved"}`; panel.append(refs);
    const error = document.createElement("p"); error.setAttribute("role", "alert"); panel.append(error);
    const actions = document.createElement("div"); actions.className = "drawing-scale-dialog-actions";
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel";
    const apply = document.createElement("button"); apply.type = "submit"; apply.textContent = "Apply";
    actions.append(cancel, apply); panel.append(actions);
    const close = () => { panel.remove(); currentClose = null; };
    currentClose = close; cancel.addEventListener("click", close);
    panel.addEventListener("submit", event => {
        event.preventDefault();
        if (!input.value.trim()) { error.textContent = "Enter a dimension magnitude."; input.focus(); return; }
        const result = onApply({ value: input.value.trim() });
        if (result?.ok === false) { error.textContent = result.error; return; }
        close();
    });
    panel.addEventListener("keydown", event => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); close(); }
    });
    document.body.append(panel); input.focus(); input.select();
}
