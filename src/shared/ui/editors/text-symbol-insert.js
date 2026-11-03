import symbolPicker from "./symbol-picker.js";

/* Preserve the caret while browsing; dispatch normal edits for live preview/undo. */
export function attachSymbolInsert(input) {
    if (!input || input.readOnly || input.dataset.symbolInsert) return;
    input.dataset.symbolInsert = "true";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Ω Insert symbol";
    button.className = "drawing-insert-symbol";
    button.setAttribute("aria-label", "Insert symbol into text");
    button.addEventListener("pointerdown", event => { event.preventDefault(); event.stopPropagation(); });
    button.addEventListener("click", event => {
        event.preventDefault(); event.stopPropagation();
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? start;
        symbolPicker.open({
            onPick:id=>{
                const symbol = symbolPicker.allSymbols().find(item=>item.id === id);
                if (!symbol || !input.isConnected) return;
                input.setRangeText(symbol.text,start,end,"end");
                input.focus();
                input.dispatchEvent(new Event("input",{bubbles:true}));
                input.dispatchEvent(new Event("change",{bubbles:true}));
            },
            onCancel:()=>input.isConnected && input.focus()
        });
    });
    input.insertAdjacentElement("afterend",button);
}

export function attachTextSymbols(root) {
    root.querySelectorAll('textarea, input[type="text"]').forEach(attachSymbolInsert);
}
export function symbolPickerContains(target) {
    return Boolean(target?.closest?.(".datum-symbol-picker, .drawing-insert-symbol"));
}
export function isSymbolPickerOpen() { return symbolPicker.isOpen(); }
