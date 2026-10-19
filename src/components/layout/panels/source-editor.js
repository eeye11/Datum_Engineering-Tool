/*
 * ============================================================
 * THE DRAWING SOURCE EDITOR
 * ============================================================
 *
 * The Source tab's editor: the drawing's LaTeX/TikZ, editable in place.
 *
 * WHY A TEXTAREA AND A MIRROR, AND NOT A THIRD-PARTY EDITOR.
 *
 * The application already edits code this way - the solution editor and the
 * floating LaTeX window are both a `<textarea>` with a positioned mirror layer
 * over it. That is not an accident to be improved upon here: a `<textarea>`
 * gives the browser's own caret, selection, IME and accessibility behaviour for
 * free, and a mirror gives line numbers and highlighting without reimplementing
 * a text engine. Adding a different editor for this one tab would mean two
 * editors in one application, with two undo stacks and two sets of key
 * bindings - the exact duplication this refactor exists to remove.
 *
 * So: one `<textarea>`, one mirror behind it for line numbers and highlighted
 * text, and the two scroll together. The textarea's text is the single source of
 * truth; the mirror is a rendering of it and is never read back.
 *
 * WHAT IT ADDS OVER THE EXISTING EDITOR.
 *
 *   - Line numbers, kept in step with the mirror.
 *   - A highlighted layer, so LaTeX commands and DAETUM's object markers are
 *     distinguishable from the commands around them.
 *   - Object-region highlighting: when the selection changes, the block
 *     belonging to the selected object is marked in the mirror, so "which part
 *     of this source is the thing I have selected" is answerable by looking.
 *   - A status line - rendered, dirty, or the renderer's error - and a
 *     diagnostics list from source-validation.js.
 *
 * UNDO/REDO. The textarea's own undo stack is used - `globalThis.document.execCommand` is
 * deliberately NOT. The native stack is the one the student's Ctrl+Z already
 * talks to, and replacing it would mean intercepting every keystroke and keeping
 * a parallel history that disagrees with the browser's.
 */

import { createSourceMap } from "../../../shared/rendering/latex/drawing-source.js";

const HIGHLIGHT_CLASS = "drawing-source-highlight";

/* ============================================================
 * ESCAPING AND HIGHLIGHTING
 * ============================================================ */

function escapeHtml(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/*
 * Highlight one line. Comments are coloured first and take precedence - a `%`
 * runs to the end of the line, so nothing inside a comment is a command. Then
 * DAETUM's markers, then commands, then braces and coordinates.
 *
 * The order matters and is why this is a single pass over the line's parts
 * rather than a sequence of replacements over the whole line: replacing
 * commands first would put `<span>` inside the comment text and the comment
 * colour would then be applied to a tag.
 */
function highlightLine(line) {
    const escaped = escapeHtml(line);

    /* A whole-line comment, including DAETUM's own markers. */
    const commentAt = commentStart(line);

    if (commentAt === 0) {
        if (/DAETUM_OBJECT_BEGIN|DAETUM_OBJECT_END/.test(line)) {
            return `<span class="ds-marker">${escaped}</span>`;
        }

        return `<span class="ds-comment">${escaped}</span>`;
    }

    const head = commentAt > 0 ? line.slice(0, commentAt) : line;
    const tail = commentAt > 0 ? line.slice(commentAt) : "";

    let marked = escapeHtml(head)
        /*
         * Commands first, so their braces are not taken as grouping braces.
         * A backslash followed by letters, or by one of the common punctuation
         * commands.
         */
        .replace(
            /\\([A-Za-z@]+\*?|[{}[\],;:&%$#_^~])/g,
            '<span class="ds-command">\\$1</span>'
        )
        /* A coordinate or an option key, after the command has been wrapped. */
        .replace(/(\[[^\]\n]*\])/g, '<span class="ds-option">$1</span>')
        .replace(/(\([^)\n]*\))/g, '<span class="ds-coord">$1</span>')
        .replace(/([{}])/g, '<span class="ds-brace">$1</span>');

    if (tail) {
        marked += `<span class="ds-comment">${escapeHtml(tail)}</span>`;
    }

    return marked;
}

/* The index of an unescaped `%` on the line, or -1. */
function commentStart(line) {
    for (let index = 0; index < line.length; index += 1) {
        if (line[index] !== "%") {
            continue;
        }

        let backslashes = 0;

        for (let back = index - 1; back >= 0 && line[back] === "\\"; back -= 1) {
            backslashes += 1;
        }

        if (backslashes % 2 === 0) {
            return index;
        }
    }

    return -1;
}

/* ============================================================
 * THE EDITOR
 * ============================================================
 *
 * `createSourceEditor(host, { onChange, onSelectionChange })` returns an object
 * with `getValue`, `setValue`, `setHighlightedObject`, `setStatus`,
 * `setDiagnostics` and `destroy`.
 *
 * `onChange(text)` fires on every edit, with the textarea's current value.
 * `onSelectionChange({ startLine, endLine, text })` fires when the caret or the
 * selection moves, so the tab can sync the drawing's selection to the source.
 *
 * `getMapSource()` RETURNS THE TEXT AN OBJECT'S REGION IS FOUND IN.
 *
 * The editor shows the VISIBLE source - no DAETUM object markers - but a region
 * is identified by the markers. Resolving an object's region against the
 * visible text therefore found nothing at all, so selecting an object marked no
 * code. The tab supplies the canonical text, and only the line NUMBERS from it
 * are used; the lines painted are still the visible editor's own. Without the
 * callback the visible text is used, which is the right answer for a source
 * that carries no markers because it holds no structured objects.
 */
export function createSourceEditor(host, { onChange, onSelectionChange, getMapSource } = {}) {
    if (!host) {
        return null;
    }

    host.innerHTML = "";

    const root = globalThis.document.createElement("div");
    root.className = "drawing-source-editor-root";

    const gutter = globalThis.document.createElement("div");
    gutter.className = "drawing-source-gutter";
    gutter.setAttribute("aria-hidden", "true");

    const scroll = globalThis.document.createElement("div");
    scroll.className = "drawing-source-scroll";

    /*
     * The mirror is the highlighted layer. It sits UNDER the textarea, matching
     * its font, padding and line height exactly, and the textarea is transparent
     * on top of it. This is how highlighting and caret behaviour coexist without
     * a custom text engine.
     */
    const mirror = globalThis.document.createElement("pre");
    mirror.className = `drawing-source-mirror ${HIGHLIGHT_CLASS}`;
    mirror.setAttribute("aria-hidden", "true");

    const textarea = globalThis.document.createElement("textarea");
    textarea.className = "drawing-source-input";
    textarea.spellcheck = false;
    textarea.setAttribute("aria-label", "Drawing TikZ source");
    textarea.setAttribute("autocomplete", "off");
    textarea.setAttribute("autocapitalize", "off");
    textarea.setAttribute("wrap", "soft");

    scroll.append(mirror, textarea);
    root.append(gutter, scroll);
    host.append(root);

    /* ---- the object blocks currently highlighted ---- */
    /*
     * A LIST, BECAUSE A SELECTION CAN HOLD SEVERAL OBJECTS.
     *
     * It was a single block, so selecting three features highlighted one of them
     * and silently ignored the other two - which reads as "the other two have no
     * source", not as "this pane only shows the first". Each entry is the region
     * of one selected object, and the union of them is what is painted.
     */
    let highlighted = [];

    /*
     * THE TEXT THE REGIONS ARE RESOLVED IN, for this render. While the editor's
     * text is exactly what the tab should be mapped, the canonical text is used;
     * when the callback supplies nothing, the editor's own value is.
     */
    function mapSource() {
        const canonical = typeof getMapSource === "function" ? getMapSource() : null;

        return typeof canonical === "string" ? canonical : textarea.value;
    }

    /*
     * WHICH ROWS CARRY A SELECTED OBJECT.
     *
     * A region is found in the CANONICAL text, where its row numbers include the
     * two marker comments the visible editor does not show. So each region's
     * rows are translated to visible rows by counting the marker lines above
     * them - the same rule the tab uses for the reverse translation. Computed on
     * demand rather than stored, so an edit that adds a line cannot leave a
     * highlight pointing at the wrong row.
     */
    function highlightedVisibleRows() {
        const canonical = mapSource();

        if (!highlighted.length) {
            return [];
        }

        const canonicalLines = canonical.replace(/\r\n/g, "\n").split("\n");
        const rows = [];

        highlighted.forEach((block) => {
            /* How many marker lines sit above this canonical row. */
            const above = canonicalLines
                .slice(0, block.beginLine)
                .filter(isMarker).length;

            const first = block.beginLine - above + 1;
            const last = block.endLine - above + 1;

            for (let row = first; row <= last; row += 1) {
                rows.push(row);
            }
        });

        return rows;
    }

    function isMarker(line) {
        return /^\s*%\s*DAETUM_OBJECT_(BEGIN|END)\b/.test(String(line || ""));
    }

    let gutterHeightFrame = null;
    let resizeObserver = null;

    function lineCount(text) {
        return text.split("\n").length;
    }

    function renderGutter(text) {
        const count = lineCount(text);
        const fragment = globalThis.document.createDocumentFragment();
        const selectedRows = new Set(highlightedVisibleRows());

        for (let line = 1; line <= count; line += 1) {
            const row = globalThis.document.createElement("div");

            row.className = "drawing-source-gutter-row";
            row.textContent = String(line);

            if (selectedRows.has(line)) {
                row.classList.add("selected");
            }

            fragment.append(row);
        }

        gutter.replaceChildren(fragment);
    }

    function renderMirror(text) {
        const lines = text.split("\n");
        const selectedRows = new Set(highlightedVisibleRows());

        mirror.innerHTML = lines
            .map((line, index) => {
                const number = index + 1;
                const isSelected = selectedRows.has(number);

                const content = highlightLine(line);

                /*
                 * An empty line needs a character or the mirror row collapses
                 * and the textarea's text drifts out of step with it.
                 */
                return `<div class="drawing-source-line${
                    isSelected ? " selected" : ""
                }">${content || " "}</div>`;
            })
            .join("");
    }

    function scheduleGutterHeightSync() {
        if (gutterHeightFrame) {
            globalThis.cancelAnimationFrame(gutterHeightFrame);
        }

        gutterHeightFrame = globalThis.requestAnimationFrame(() => {
            gutterHeightFrame = null;
            syncGutterHeights();
        });
    }

    function syncGutterHeights() {
        const lineEls = mirror.querySelectorAll(".drawing-source-line");
        const rows = gutter.querySelectorAll(".drawing-source-gutter-row");
        const count = Math.min(lineEls.length, rows.length);

        for (let index = 0; index < count; index += 1) {
            rows[index].style.height = `${lineEls[index].offsetHeight}px`;
        }
    }
    function syncScroll() {
        mirror.scrollTop = textarea.scrollTop;
        mirror.scrollLeft = textarea.scrollLeft;
        gutter.scrollTop = textarea.scrollTop;
    }

    function render() {
        const text = textarea.value;

        renderGutter(text);
        renderMirror(text);
        syncScroll();
        scheduleGutterHeightSync();
    }

    /* ---- events ---- */

    const handleInput = () => {
        render();

        if (typeof onChange === "function") {
            onChange(textarea.value);
        }
    };

    /*
     * The caret's line and the selection's line range. Used to sync the drawing
     * selection when the student clicks a block in the source, and to keep the
     * status line's "Ln N" honest.
     */
    function selectionInfo() {
        const value = textarea.value;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;

        const before = value.slice(0, start);
        const startLine = before.split("\n").length - 1;
        const endLine = value.slice(0, end).split("\n").length - 1;

        return {
            start,
            end,
            startLine,
            endLine,
            text: value.slice(start, end)
        };
    }

    const handleSelection = () => {
        if (typeof onSelectionChange === "function") {
            onSelectionChange(selectionInfo());
        }
    };

    textarea.addEventListener("input", handleInput);
    textarea.addEventListener("scroll", syncScroll);
    textarea.addEventListener("click", handleSelection);
    textarea.addEventListener("keyup", handleSelection);
    textarea.addEventListener("select", handleSelection);
    if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => {
            scheduleGutterHeightSync();
        });

        resizeObserver.observe(scroll);
    }

    globalThis.window?.addEventListener("resize", scheduleGutterHeightSync);

    /* ============================================================
     * PUBLIC INTERFACE
     * ============================================================ */

    const editor = {
        getValue() {
            return textarea.value;
        },

        /*
         * Set the text without firing `onChange`. Used when the editor is being
         * brought into step with the document - on tab open, or when the source
         * was changed by a property edit elsewhere - rather than when the
         * student is typing. The caret is preserved across a change where it
         * can be, so typing above a generated block does not jump the cursor.
         */
        setValue(text, { preserveCaret = true } = {}) {
            const value = String(text ?? "");

            if (value === textarea.value) {
                return;
            }

            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const scrollTop = textarea.scrollTop;

            textarea.value = value;

            if (preserveCaret) {
                const length = value.length;

                textarea.setSelectionRange(Math.min(start, length), Math.min(end, length));
                textarea.scrollTop = scrollTop;
            }

            render();
        },

        /*
         * Highlight one object's region. Pass an object id; pass null to clear.
         * The region is resolved through the source map, so it follows the
         * markers rather than a remembered line number.
         */
        /*
         * Highlight the regions of one or more objects. Pass an id, an array of
         * ids, or nothing to clear.
         *
         * The regions are resolved through the source map, so they follow the
         * object markers rather than remembered line numbers - which is what keeps
         * a highlight correct after the source has been edited or regenerated.
         */
        setHighlightedObject(objectIds) {
            const ids = Array.isArray(objectIds)
                ? objectIds
                : objectIds
                    ? [objectIds]
                    : [];

            if (!ids.length) {
                highlighted = [];
                render();

                return;
            }

            /*
             * RESOLVED IN THE CANONICAL TEXT. A region is identified by the
             * object's marker, and the visible editor carries none - so the map
             * is built from the text the tab says the regions live in.
             */
            const map = createSourceMap(mapSource());

            highlighted = ids
                .map((id) => map.block(id))
                .filter(Boolean);

            render();
        },

        /*
         * Scroll the highlighted region into view and place the caret at its
         * first line. Used when the selection came from the canvas, so the
         * source scrolls to the object the student just clicked.
         */
        revealHighlighted() {
            if (!highlighted.length) {
                return;
            }

            /*
             * THE FIRST REGION IS THE ONE SCROLLED TO. With several selected, one
             * of them has to be the anchor, and the first in document order is the
             * one the student is most likely to have chosen deliberately - the rest
             * are highlighted in place around it.
             */
            const anchor = highlighted[0];
            const anchorRow = highlightedVisibleRows()[0];

            const line = mirror.querySelectorAll(".drawing-source-line")[Math.max(0, (anchorRow || 1) - 1)];

            if (line) {
                textarea.scrollTop = Math.max(0, line.offsetTop);
            } else {
                const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 18;
                textarea.scrollTop = Math.max(0, anchor.beginLine * lineHeight);
            }

            syncScroll();
        },

        /* The line number of the caret, one-based, for the status line. */
        caretLine() {
            return selectionInfo().startLine + 1;
        },

        focus() {
            textarea.focus();
        },

        textarea,

        destroy() {
            textarea.removeEventListener("input", handleInput);
            textarea.removeEventListener("scroll", syncScroll);
            textarea.removeEventListener("click", handleSelection);
            textarea.removeEventListener("keyup", handleSelection);
            if (resizeObserver) {
                resizeObserver.disconnect();
                resizeObserver = null;
            }

            globalThis.window?.removeEventListener("resize", scheduleGutterHeightSync);

            if (gutterHeightFrame) {
                globalThis.cancelAnimationFrame(gutterHeightFrame);
                gutterHeightFrame = null;
            }
            textarea.removeEventListener("select", handleSelection);
            host.innerHTML = "";
        }
    };

    return editor;
}

export default { createSourceEditor };
