import symbolPicker from "./symbol-picker.js";

/*
 * THERE IS NO BUTTON BESIDE EACH TEXT FIELD.
 *
 * Special Symbols is a command in the menu bar's Tools menu, beside Show
 * Dimension. It inserts into whichever text field is being edited
 * (`special-symbols-insert.js`), so every field - a label prompt, a note, a
 * property row - has the same list available without each one growing its own
 * control underneath it.
 */
export function attachSymbolInsert(input) {
    if (!input) return;

    input.dataset.symbolInsert = "true";
}

export function attachTextSymbols(root) {
    if (!root) return;

    /* Nothing to attach: the menu owns the picker. */
    void root;
}

/* Whether a pressed element belongs to the open picker. */
export function symbolPickerContains(target) {
    return Boolean(target?.closest?.(".datum-symbol-picker"));
}
export function isSymbolPickerOpen() { return symbolPicker.isOpen(); }
