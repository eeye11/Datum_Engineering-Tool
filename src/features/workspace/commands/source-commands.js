/*
 * ============================================================
 * SOURCE COMMANDS - THE ONE COMMAND THE SOURCE TAB HAS
 * ============================================================
 *
 * FORMAT SOURCE. Nothing else: no Apply, no Render, no Regenerate. Rendering is
 * automatic and the drawing is the source, so the only operation that needs a
 * command is the one that changes the text's layout without changing what it
 * means.
 *
 * IT IS UNDOABLE THROUGH THE APPLICATION'S OWN HISTORY, and it records ONE
 * entry for the whole format - not one per line, and not a canvas history entry
 * at all. The source's own undo stack is the textarea's (a native edit, through
 * `insertText`, is what Ctrl+Z in the editor already undoes); a canvas Undo
 * after a format is not expected to reverse the whitespace, and making it do so
 * would mean a drawing snapshot per keystroke.
 *
 * IT FORMATS A REGION WHEN THERE IS ONE. A selection of whole lines is
 * formatted on its own, so a student working at the bottom of a long file does
 * not get the whole document re-indented under the caret. Everything else - a
 * caret, no selection, or a selection spanning a statement's middle - formats
 * the whole document.
 */

import { activeSourceManager } from "../../../shared/rendering/latex/drawing-source-manager.js";
import { formattableRange, formatSource, isFormatted } from "../../../shared/rendering/latex/source-format.js";
/*
 * THE PANEL'S REFRESH AND THE RENDER REQUEST, REGISTERED RATHER THAN IMPORTED.
 *
 * The Source tab imports this module for its Format command, so importing the
 * tab back - or the canvas, which reaches the tab's panel installer - would close
 * a module cycle, and a cycle here is not theoretical: one module reads the
 * other's instance before it exists. Each is supplied when it installs, and
 * called only if it is there.
 */
let refreshPanel = () => {};
let renderNow = null;

export function setSourceRefreshHandler(handler) {
    refreshPanel = typeof handler === "function" ? handler : () => {};
}

export function setSourceRenderRequest(request) {
    renderNow = typeof request === "function" ? request : null;
}

/* The editor, when one is installed; supplied by the Source tab. */
let editorFor = () => null;

export function setSourceEditorProvider(provider) {
    editorFor = typeof provider === "function" ? provider : () => null;
}

/*
 * Format the whole document, or the selected whole lines.
 *
 * Returns whether the text changed, so a caller (and a test) can tell a real
 * format from a no-op. A no-op records nothing.
 */
export function formatDrawingSource() {
    const manager = activeSourceManager();
    const editor = editorFor();

    if (!manager) {
        return false;
    }

    const visible = manager.getVisibleSource();
    const textarea = editor?.textarea || null;

    let next = formatSource(visible);
    let selectionStart = null;
    let selectionEnd = null;

    if (textarea && textarea.selectionStart !== textarea.selectionEnd) {
        const { start, end } = formattableRange(visible, textarea.selectionStart, textarea.selectionEnd);

        if (end > start) {
            const before = visible.slice(start, end);
            const after = formatSource(before);

            if (after !== before) {
                next = visible.slice(0, start) + after + visible.slice(end);

                /* The selection follows the text it selected. */
                selectionStart = start;
                selectionEnd = start + after.length;
            }
        }
    } else if (isFormatted(visible)) {
        return false;
    }

    if (next === visible) {
        return false;
    }

    /*
     * THROUGH THE EDITOR, WHEN ONE IS OPEN, so the change is a native edit that
     * the browser's own undo can reverse and the caret stays where it was. The
     * manager is then told, exactly as it is for typing - one path for "the text
     * changed".
     */
    if (editor && editor.applyEdit) {
        editor.applyEdit(next, { selectionStart, selectionEnd });
    }

    manager.setVisibleSource(next, { origin: "format" });

    refreshPanel();
    renderNow?.({ immediately: true });

    return true;
}

export default {
    formatDrawingSource,
    setSourceEditorProvider,
    setSourceRefreshHandler,
    setSourceRenderRequest
};
