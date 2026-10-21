/*
 * ============================================================
 * THE DRAWING SOURCE EDITOR
 * ============================================================
 *
 * The Source tab's editor: the drawing's LaTeX/TikZ, editable in place.
 *
 * WHY A TEXTAREA ON A DECORATION LAYER, AND NOT A THIRD-PARTY EDITOR.
 *
 * The application already edits code this way - the solution editor and the
 * floating LaTeX window are both a `<textarea>` with a positioned layer of code
 * styling behind it. A `<textarea>` gives the browser's own caret, selection,
 * IME, accessibility and undo behaviour for free; the layer gives syntax
 * colours, line numbers and decorations without reimplementing a text engine.
 * Adding a different editor for this one tab would mean two editors in one
 * application, with two undo stacks and two sets of key bindings.
 *
 * THE LAYERING BUG THIS FILE FIXES.
 *
 * The editor used to draw the object highlight in a `<pre>` UNDERNEATH a
 * textarea whose text was TRANSPARENT, and then paint the textarea's native
 * selection in the same translucent green. `::selection` is drawn by the browser
 * ON TOP of whatever is there, and the text behind it was invisible by design,
 * so selecting the object's code washed the glyphs out - the highlight appeared
 * to cover the text. Nothing in the decoration layer could fix that, because the
 * layer was below the thing hiding it.
 *
 * So the text is no longer transparent, and the selection is no longer the
 * textarea's. The order, bottom to top, is now:
 *
 *     1. the decoration layer   syntax colours, the object band, the soft-red
 *                               error marks - all BACKGROUNDS, all behind
 *     2. the text layer         the same text, in the same font and position,
 *                               with the syntax glyph colours and no background
 *     3. the caret layer        the native selection (made transparent) and a
 *                               custom caret block drawn from the real offsets
 *
 * A selection is therefore painted UNDER the glyphs, the way every editor does
 * it, and the object band and the error mark can coexist because they are all
 * backgrounds in one layer rather than alternatives.
 *
 * WHAT IS KEPT IN STEP, AND HOW.
 *
 * The textarea is the editable element and the single source of truth for the
 * caret and selection. It is also transparent-on-transparent; the three layers
 * are positioned exactly over it. The text layer carries a full copy of the
 * text, the decoration layer carries one copy per line with the same line
 * boxes, and the caret layer's selection boxes are computed from
 * `selectionStart`/`selectionEnd` through the same `<span>` grid the text layer
 * uses - so a wrapped line, a tab and an emoji all measure the same in all four.
 */

import { isObjectMarkerLine } from "../../../shared/rendering/latex/drawing-source.js";

const CLASS = {
    root: "drawing-source-editor-root",
    gutter: "drawing-source-gutter",
    gutterRow: "drawing-source-gutter-row",
    scroll: "drawing-source-scroll",
    decor: "drawing-source-decor",
    text: "drawing-source-text",
    caret: "drawing-source-caret-layer",
    input: "drawing-source-input",
    line: "drawing-source-line"
};

/* ============================================================
 * ESCAPING AND SYNTAX
 * ============================================================ */

function escapeHtml(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
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

/*
 * ONE LINE, AS THE TEXT LAYER SEES IT.
 *
 * The order matters and is why this is a single pass over the line's parts
 * rather than a sequence of replacements over the whole line: replacing commands
 * first would put `<span>` inside the comment text and the comment colour would
 * then be applied to a tag.
 */
function highlightLine(line) {
    const escaped = escapeHtml(line);
    const commentAt = commentStart(line);

    if (commentAt === 0) {
        /*
         * A MARKER GETS ITS OWN, MUTED CLASS. The test is the source module's,
         * so a readable `% DAETUM OBJECT:` header is highlighted like the legacy
         * markers rather than as ordinary prose - and a student's own comment
         * that merely mentions DAETUM is not.
         */
        if (isObjectMarkerLine(line)) {
            return `<span class="ds-marker">${escaped}</span>`;
        }

        return `<span class="ds-comment">${escaped}</span>`;
    }

    const head = commentAt > 0 ? line.slice(0, commentAt) : line;
    const tail = commentAt > 0 ? line.slice(commentAt) : "";

    let marked = escapeHtml(head)
        .replace(/\\([A-Za-z@]+\*?|[{}[\],;:&%$#_^~])/g, '<span class="ds-command">\\$1</span>')
        .replace(/(\[[^\]\n]*\])/g, '<span class="ds-option">$1</span>')
        .replace(/(\([^)\n]*\))/g, '<span class="ds-coord">$1</span>')
        .replace(/([{}])/g, '<span class="ds-brace">$1</span>');

    if (tail) {
        marked += `<span class="ds-comment">${escapeHtml(tail)}</span>`;
    }

    return marked;
}

/* ============================================================
 * INDENTATION AND MATCHING
 * ============================================================ */

const INDENT = "  ";

function leadingWhitespace(text) {
    return /^[ \t]*/.exec(text)[0];
}

function indentWidth(text) {
    return leadingWhitespace(text).replace(/\t/g, INDENT).length;
}

/*
 * THE BRACKET PAIRS IN A DOCUMENT, as offset -> offset.
 *
 * A stack walk that ignores comments and escaped characters, so `\%` and a
 * `%`-comment cannot make a brace look matched. It is rebuilt per revision
 * rather than maintained per keystroke: a document of a few hundred lines is
 * cheaper to rescan than a stale table is to debug.
 */
function bracketPairs(text) {
    const pairs = new Map();
    const stack = [];

    const matching = { "}": "{", ")": "(", "]": "[" };

    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];

        if (character === "%") {
            let backslashes = 0;

            for (let back = index - 1; back >= 0 && text[back] === "\\"; back -= 1) {
                backslashes += 1;
            }

            if (backslashes % 2 === 0) {
                const newline = text.indexOf("\n", index);

                if (newline < 0) {
                    break;
                }

                index = newline;
                continue;
            }

            /* An escaped `%` is a literal. */
        }

        if (character === "\\") {
            index += 1;
            continue;
        }

        if (character === "{" || character === "(" || character === "[") {
            stack.push(index);
            continue;
        }

        if (matching[character]) {
            const open = matching[character];
            const top = stack[stack.length - 1];

            if (top !== undefined && text[top] === open) {
                stack.pop();
                pairs.set(top, index);
                pairs.set(index, top);
            }
        }
    }

    return pairs;
}

/*
 * THE BRACE BESIDE THE CARET.
 *
 * `bracketPairs(text)` gives every pair in the document; this resolves the ONE
 * the caret is next to, which is what the highlight needs. A caret sits either
 * BEFORE a bracket (`\left of it`) or AFTER one; both are tried, so clicking on
 * either side of a brace shows its partner.
 */
function matchedBracket(text, caret) {
    const pairs = bracketPairs(text);

    return pairs.get(caret) ?? pairs.get(caret - 1) ?? null;
}

/* The offset a position is in, given the selection direction. */
function orderedSelection(textarea) {
    const start = Math.min(textarea.selectionStart, textarea.selectionEnd);
    const end = Math.max(textarea.selectionStart, textarea.selectionEnd);

    return { start, end, forward: textarea.selectionDirection !== "backward" };
}

/* Whole lines covering a range, as [start, end) character offsets. */
export function lineRangeForSelection(text, start, end) {
    const lineStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;

    let lineEnd = text.indexOf("\n", end);

    if (lineEnd < 0) {
        lineEnd = text.length;
    }

    return { start: lineStart, end: lineEnd };
}

/* ============================================================
 * THE EDITOR
 * ============================================================
 *
 * `createSourceEditor(host, { onChange, onSelectionChange, onFindRequest, ... })`.
 */
export function createSourceEditor(host, options = {}) {
    if (!host) {
        return null;
    }

    host.innerHTML = "";

    const ownerDocument = host.ownerDocument || globalThis.document;
    const { onChange, onSelectionChange } = options;

    /* ---------- the layers ---------- */

    const root = ownerDocument.createElement("div");
    root.className = CLASS.root;

    const gutter = ownerDocument.createElement("div");
    gutter.className = CLASS.gutter;
    gutter.setAttribute("aria-hidden", "true");

    const scroll = ownerDocument.createElement("div");
    scroll.className = CLASS.scroll;

    const decor = ownerDocument.createElement("div");
    decor.className = `${CLASS.decor} drawing-source-mirror`;
    decor.setAttribute("aria-hidden", "true");

    const textLayer = ownerDocument.createElement("div");
    textLayer.className = `${CLASS.text} drawing-source-mirror`;
    textLayer.setAttribute("aria-hidden", "true");

    const caretLayer = ownerDocument.createElement("div");
    caretLayer.className = CLASS.caret;
    caretLayer.setAttribute("aria-hidden", "true");

    const textarea = ownerDocument.createElement("textarea");
    textarea.className = CLASS.input;
    textarea.spellcheck = false;
    textarea.setAttribute("aria-label", "Drawing TikZ source");
    textarea.setAttribute("autocomplete", "off");
    textarea.setAttribute("autocapitalize", "off");
    textarea.setAttribute("wrap", "soft");

    scroll.append(decor, textLayer, caretLayer, textarea);
    root.append(gutter, scroll);
    host.append(root);

    /* ---------- what is decorated ---------- */

    /*
     * THE OBJECT REGIONS, IN VISIBLE LINE NUMBERS.
     *
     * { beginLine, endLine } one-based. Resolved by the tab from the source map
     * so the editor never has to know about markers.
     */
    let selectedRegions = [];

    /* Error ranges in VISIBLE character offsets: [{ start, end }]. */
    let errorRanges = [];

    /* A search match to paint, in visible character offsets. */
    let searchRange = null;

    let bracketFrame = null;
    let currentText = "";

    /* ---------- rendering ---------- */

    function lines(text) {
        return text.replace(/\r\n/g, "\n").split("\n");
    }

    /*
     * THE DECORATION LAYER: one block per line, whose background carries the
     * object band and the error mark. The text is the same as the text layer's,
     * but made INVISIBLE rather than omitted - the glyphs are still needed to
     * measure each line box exactly, so a wrapped line is as tall here as it is
     * there.
     */
    function renderDecor(text) {
        const split = lines(text);
        const regions = new Set();

        selectedRegions.forEach((region) => {
            for (let line = region.beginLine; line <= region.endLine; line += 1) {
                regions.add(line);
            }
        });

        decor.innerHTML = split
            .map((line, index) => {
                const number = index + 1;
                const classes = [CLASS.line];

                if (regions.has(number)) {
                    classes.push("selected");
                }

                return `<div class="${classes.join(" ")}" data-line="${number}">${
                    line ? escapeHtml(line) : " "
                }</div>`;
            })
            .join("");

        paintErrorRanges();
    }

    /*
     * THE ERROR MARKS, AS CHARACTER RANGES RATHER THAN LINES.
     *
     * The whole line is wrapped in an overlay span that fills it, and the
     * error's own characters get a deeper mark on top. Both are the band's
     * BACKGROUND, so the glyphs drawn by the text layer stay on top and the
     * code remains readable - which is the point of a soft-red mark.
     */
    function paintErrorRanges() {
        decor.querySelectorAll(".ds-error-line, .ds-error-range, .ds-search-range").forEach((element) => {
            element.classList.remove("ds-error-line", "ds-error-range", "ds-search-range");
        });

        if (!errorRanges.length && !searchRange) {
            return;
        }

        const starts = lineStarts(currentText);

        const applyRange = (range, classes) => {
            if (!range || range.end <= range.start) {
                return;
            }

            const firstLine = lineIndexAt(starts, range.start);
            const lastLine = lineIndexAt(starts, Math.max(range.start, range.end - 1));

            for (let line = firstLine; line <= lastLine && line < starts.length; line += 1) {
                const element = decor.querySelector(`[data-line="${line + 1}"]`);

                if (element) {
                    classes.forEach((name) => element.classList.add(name));
                }
            }
        };

        errorRanges.forEach((range) => applyRange(range, ["ds-error-line"]));
        applyRange(searchRange, ["ds-search-range"]);
    }

    function renderText(text) {
        textLayer.innerHTML = lines(text)
            .map((line) => `<div class="${CLASS.line}">${line ? highlightLine(line) : " "}</div>`)
            .join("");
    }

    function renderGutter(text) {
        const count = lines(text).length;
        const selected = new Set();

        selectedRegions.forEach((region) => {
            for (let line = region.beginLine; line <= region.endLine; line += 1) {
                selected.add(line);
            }
        });

        const fragment = ownerDocument.createDocumentFragment();

        for (let line = 1; line <= count; line += 1) {
            const row = ownerDocument.createElement("div");

            row.className = CLASS.gutterRow;
            row.textContent = String(line);

            if (selected.has(line)) {
                row.classList.add("selected");
            }

            fragment.append(row);
        }

        gutter.replaceChildren(fragment);

        /* Keep the caret's line legible in the margin. */
        const caretLine = currentText.slice(0, textarea.selectionStart).split("\n").length;

        gutter.querySelector(`.drawing-source-gutter-row:nth-child(${caretLine})`)?.classList.add("active");
    }

    /* ---------- selection painting (UNDER the glyphs) ---------- */

    function lineStarts(text) {
        const starts = [0];

        for (let index = 0; index < text.length; index += 1) {
            if (text[index] === "\n") {
                starts.push(index + 1);
            }
        }

        return starts;
    }

    /*
     * The index of the line a character offset falls on, by binary search.
     * `starts` is the list of offsets at which each line begins.
     */
    function lineIndexAt(starts, offset) {
        let low = 0;
        let high = starts.length - 1;

        while (low < high) {
            const middle = (low + high + 1) >> 1;

            if (starts[middle] <= offset) {
                low = middle;
            } else {
                high = middle - 1;
            }
        }

        return low;
    }

    /*
     * ============================================================
     * MEASURING A CHARACTER OFFSET, IN THE TEXT LAYER
     * ============================================================
     *
     * The text layer is one block per LINE, and each block contains the line's
     * syntax spans. A character offset therefore has to be resolved in two
     * steps: which line it is on, and where in that line.
     *
     * THE OLD MEASUREMENT WALKED TEXT NODES ACROSS THE WHOLE LAYER and ignored
     * the line breaks between them, so every offset after the first newline
     * pointed into the wrong line - a drag-selection painted nothing, or a band
     * somewhere else. This walks within ONE line block, where an offset is a
     * character count and nothing else, and it measures the box that block
     * occupies.
     */
    function offsetInLine(lineIndex, column) {
        const lineElement = textLayer.children[lineIndex];

        if (!lineElement) {
            return null;
        }

        const box = scroll.getBoundingClientRect();

        /* A position inside the line's own text, at `column` characters. */
        const positionAt = (wanted) => {
            const walker = ownerDocument.createTreeWalker(lineElement, 4 /* NodeFilter.SHOW_TEXT */);

            let seen = 0;
            let node = walker.nextNode();

            while (node) {
                const length = node.data.length;

                if (wanted <= seen + length) {
                    return { node, offset: wanted - seen };
                }

                seen += length;
                node = walker.nextNode();
            }

            /* Past its end: the end of its last text node, or the block itself. */
            let last = null;
            const inner = ownerDocument.createTreeWalker(lineElement, 4);

            let cursor = inner.nextNode();

            while (cursor) {
                last = cursor;
                cursor = inner.nextNode();
            }

            return last ? { node: last, offset: last.data.length } : { node: lineElement, offset: 0 };
        };

        const range = ownerDocument.createRange();
        const from = positionAt(column);
        const to = positionAt(column + 1);

        try {
            range.setStart(from.node, Math.min(from.offset, from.node.data?.length ?? 0));
            range.setEnd(to.node, Math.min(to.offset, to.node.data?.length ?? 0));
        } catch {
            return null;
        }

        const rects = [...range.getClientRects()];

        if (!rects.length) {
            return null;
        }

        const first = rects[0];
        const last = rects[rects.length - 1];

        return {
            /* The caret's own edge: the start of the character at `column`. */
            caretLeft: first.left - box.left,
            /* The character's box, which is what a selection block covers. */
            left: first.left - box.left,
            width: Math.max(1, last.right - first.left),
            top: first.top - box.top,
            height: first.height
        };
    }

    /* The line and column a character offset falls on. */
    function positionOf(offset) {
        const starts = lineStarts(currentText);
        const line = lineIndexAt(starts, offset);

        return { line, column: Math.max(0, offset - starts[line]) };
    }

    /*
     * RECTANGLES FOR ONE RANGE, ONE PER LINE IT SPANS.
     *
     * Each rectangle is measured within its line block, so a multi-line
     * selection is a stack of exact bands - never one rectangle covering lines
     * the selection does not include.
     */
    function rectsForRange(start, end) {
        if (end <= start) {
            return [];
        }

        const from = positionOf(start);
        const to = positionOf(Math.max(start, end - 1));
        const rects = [];

        for (let line = from.line; line <= to.line; line += 1) {
            const lineElement = textLayer.children[line];

            if (!lineElement) {
                continue;
            }

            const lineText = (currentText.split("\n")[line] || "");
            const firstColumn = line === from.line ? from.column : 0;
            const lastColumn = line === to.line ? Math.max(firstColumn, to.column) : lineText.length;

            const first = offsetInLine(line, firstColumn);
            const last = offsetInLine(line, Math.max(firstColumn, lastColumn));

            if (!first || !last) {
                continue;
            }

            rects.push({
                left: first.left,
                top: first.top,
                width: Math.max(
                    last.left + Math.max(1, last.width) - first.left,
                    first.width
                ),
                height: first.height
            });
        }

        return rects;
    }

    /* The measurement of a caret position, for the caret and the bracket marks. */
    function extentOf(offset) {
        const { line, column } = positionOf(offset);

        return offsetInLine(line, column);
    }

    function paintSelection() {
        caretLayer.replaceChildren();

        const { start, end, forward } = orderedSelection(textarea);

        if (start !== end) {
            rectsForRange(start, end).forEach((rect) => {
                const block = ownerDocument.createElement("div");

                block.className = "drawing-source-selection";
                block.style.left = `${rect.left}px`;
                block.style.top = `${rect.top}px`;
                block.style.width = `${rect.width}px`;
                block.style.height = `${rect.height}px`;
                caretLayer.append(block);
            });
        }

        /*
         * THE CARET, DRAWN AT ITS REAL OFFSET. Focused editors get it from the
         * textarea itself (`caret-color`), but a textarea whose text is hidden
         * has no visible caret in every browser - so one is painted here from the
         * same measurement, with the keyboard's own blinking left to CSS.
         */
        if (ownerDocument.activeElement === textarea) {
            const focus = forward ? end : start;
            const point = extentOf(focus);

            if (point) {
                const caret = ownerDocument.createElement("div");

                caret.className = "drawing-source-caret";
                caret.style.left = `${point.caretLeft}px`;
                caret.style.top = `${point.top}px`;
                caret.style.height = `${point.height}px`;
                caretLayer.append(caret);
            }
        }

        const brace = start === end ? matchedBracket(currentText, start) : null;

        if (brace !== null && ownerDocument.activeElement === textarea) {
            [start, brace].forEach((offset) => {
                const mark = extentOf(offset);

                if (!mark) {
                    return;
                }

                const element = ownerDocument.createElement("div");

                element.className = "drawing-source-bracket";
                element.style.left = `${mark.caretLeft - 2}px`;
                element.style.top = `${mark.top}px`;
                element.style.height = `${mark.height}px`;
                caretLayer.append(element);
            });
        }
    }

    function syncScroll() {
        decor.scrollTop = textarea.scrollTop;
        decor.scrollLeft = textarea.scrollLeft;
        textLayer.scrollTop = textarea.scrollTop;
        textLayer.scrollLeft = textarea.scrollLeft;
        gutter.scrollTop = textarea.scrollTop;
        caretLayer.scrollTop = 0;
        paintSelection();
    }

    function render() {
        currentText = textarea.value;

        renderGutter(currentText);
        renderDecor(currentText);
        renderText(currentText);
        syncScroll();
    }

    /* ============================================================
     * EDITING COMMANDS THE TEXTAREA DOES NOT HAVE
     * ============================================================ */

    /*
     * A native-editing operation, applied to the textarea through a synthesized
     * input so the browser's OWN undo stack records it. `document.execCommand`
     * is used where it exists for exactly that reason: an edit made by assigning
     * `.value` is invisible to Ctrl+Z, and a source tab whose typing cannot be
     * undone is not an editor.
     */
    function insertText(text) {
        if (typeof ownerDocument.execCommand === "function") {
            try {
                if (ownerDocument.execCommand("insertText", false, text)) {
                    return;
                }
            } catch {
                /* Fall through to the manual path. */
            }
        }

        const { start, end } = orderedSelection(textarea);

        textarea.setRangeText(text, start, end, "end");
        fireInput();
    }

    /* Replace a range of text, with undo, and select `selectStart..selectEnd`. */
    function replaceRange(start, end, text, selectStart = null, selectEnd = null) {
        textarea.setSelectionRange(start, end);

        if (typeof ownerDocument.execCommand === "function") {
            try {
                if (ownerDocument.execCommand("insertText", false, text)) {
                    if (selectStart !== null) {
                        textarea.setSelectionRange(selectStart, selectEnd ?? selectStart);
                    }

                    return;
                }
            } catch {
                /* Fall through. */
            }
        }

        textarea.setRangeText(text, start, end, "end");
        fireInput();

        if (selectStart !== null) {
            textarea.setSelectionRange(selectStart, selectEnd ?? selectStart);
        }
    }

    function fireInput() {
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }

    /* Indent or outdent every line a selection touches. */
    function indentSelection(direction) {
        const text = textarea.value;
        const { start, end } = orderedSelection(textarea);
        const range = lineRangeForSelection(text, start, end);

        const before = text.slice(range.start, range.end);
        const after = before
            .split("\n")
            .map((line) => {
                if (direction > 0) {
                    return line.trim() === "" ? line : INDENT + line;
                }

                if (line.startsWith("\t")) {
                    return line.slice(1);
                }

                return line.replace(/^ {1,2}/, "");
            })
            .join("\n");

        if (before === after) {
            return;
        }

        /*
         * THE SELECTION IS KEPT ON THE SAME TEXT. It grows (or shrinks) by what
         * the indent added at the start of the block, and by one step for every
         * line the block contains after the first.
         */
        const deltaFirst = indentWidth(after.split("\n")[0]) - indentWidth(before.split("\n")[0]);
        const deltaEach = direction > 0 ? INDENT.length : -INDENT.length;
        const extraLines = before.split("\n").length - 1;

        const nextStart = Math.max(range.start, start + deltaFirst);
        const nextEnd = Math.max(nextStart, end + deltaFirst + extraLines * deltaEach);

        replaceRange(range.start, range.end, after, nextStart, nextEnd);
    }

    /* Insert a new line with the previous line's indentation. */
    function insertNewline() {
        const text = textarea.value;
        const start = textarea.selectionStart;
        const lineStart = text.lastIndexOf("\n", start - 1) + 1;
        const before = text.slice(lineStart, start);
        const indent = leadingWhitespace(before);

        /*
         * ONE STEP DEEPER after a brace that opens a group, so a picture or a
         * scope indents itself as it is typed - and one step shallower when the
         * caret is between a matching pair.
         */
        const opens = /\{[ \t]*$/.test(before);
        const between = /[{([]\s*[})\]]\s*$/.test(
            text.slice(Math.max(0, start - 1), Math.min(text.length, start + 1))
        );

        if (between) {
            insertText(`\n${indent}${INDENT}\n${indent}`);

            /* Put the caret on the middle, empty line. */
            const middle = textarea.selectionStart - indent.length - 1;
            textarea.setSelectionRange(middle, middle);

            return;
        }

        insertText(`\n${indent}${opens ? INDENT : ""}`);
    }

    /*
     * Backspace at the start of a line removes one INDENT STEP, not one space -
     * the same behaviour every code editor has, so a two-space indent takes one
     * key rather than two.
     */
    function backspaceIndent() {
        const text = textarea.value;
        const start = textarea.selectionStart;
        const lineStart = text.lastIndexOf("\n", start - 1) + 1;
        const before = text.slice(lineStart, start);

        if (!before || /[^ \t]/.test(before)) {
            return false;
        }

        const remove = before.endsWith(INDENT) ? INDENT.length : 1;

        replaceRange(start - remove, start, "");

        return true;
    }

    /* Tab: indent the selection, or insert one indent step at the caret. */
    function handleTab(event) {
        event.preventDefault();

        const { start, end } = orderedSelection(textarea);

        if (start !== end || event.shiftKey) {
            indentSelection(event.shiftKey ? -1 : 1);
            return;
        }

        insertText(INDENT);
    }

    /* Enter: an auto-indented newline; in a selection, a plain one. */
    function handleEnter(event) {
        if (event.metaKey || event.ctrlKey || event.altKey) {
            return;
        }

        event.preventDefault();

        /*
         * THE FIND FIELD AND A LIST OF DIAGNOSTICS USE ENTER THEMSELVES. This
         * handler is on the textarea only, so nothing else is affected.
         */
        if (event.shiftKey) {
            insertText("\n");
            return;
        }

        insertNewline();
    }

    /* ============================================================
     * EVENTS
     * ============================================================ */

    const handleInput = () => {
        render();

        if (typeof onChange === "function") {
            onChange(textarea.value);
        }
    };

    function selectionInfo() {
        const value = textarea.value;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;

        return {
            start,
            end,
            startLine: value.slice(0, start).split("\n").length - 1,
            endLine: value.slice(0, end).split("\n").length - 1,
            text: value.slice(start, end)
        };
    }

    const handleSelection = () => {
        paintSelection();

        const caretLine = currentText.slice(0, textarea.selectionStart).split("\n").length;

        gutter.querySelectorAll(".drawing-source-gutter-row.active").forEach((row) => {
            row.classList.remove("active");
        });
        gutter.querySelector(`.drawing-source-gutter-row:nth-child(${caretLine})`)?.classList.add("active");

        if (typeof onSelectionChange === "function") {
            onSelectionChange(selectionInfo());
        }
    };

    const handleKeyDown = (event) => {
        /*
         * THE EDITOR OWNS ITS KEYS.
         *
         * The canvas's shortcuts are refused while a text field has focus
         * (`keyboard-shortcuts.js` tests the active element), and this stops the
         * event from reaching anything else at all - so deleting a line here can
         * never delete the selected object, and "L" can never arm the Line tool.
         * The application's own menu shortcuts that must still work (undo, save,
         * find) are handled below, here, on purpose.
         */
        const meta = event.ctrlKey || event.metaKey;
        const key = event.key;

        if (meta && !event.altKey) {
            if (key.toLowerCase() === "s") {
                event.preventDefault();
                options.onSaveRequest?.();
                return;
            }

            if (key.toLowerCase() === "f") {
                event.preventDefault();
                options.onFindRequest?.();
                return;
            }

            if (key.toLowerCase() === "g") {
                event.preventDefault();
                options.onGoToLineRequest?.();
                return;
            }

            if (key.toLowerCase() === "z" && !event.shiftKey) {
                event.preventDefault();
                options.onUndoRequest?.();
                return;
            }

            if ((key.toLowerCase() === "z" && event.shiftKey) || key.toLowerCase() === "y") {
                event.preventDefault();
                options.onRedoRequest?.();
                return;
            }

            /*
             * EVERYTHING ELSE with Ctrl is the browser's: copy, cut, paste,
             * select-all. They must reach the textarea untouched.
             */
        }

        if (event.defaultPrevented) {
            return;
        }

        if (key === "Tab") {
            handleTab(event);
            return;
        }

        if (key === "Enter") {
            handleEnter(event);
            return;
        }

        if (key === "Backspace") {
            const { start, end } = orderedSelection(textarea);

            if (start === end && backspaceIndent()) {
                event.preventDefault();
            }

            return;
        }

        /*
         * BRACKET MATCHING ON TYPING. A closing bracket keyed immediately before one
         * that is already there would produce `}}`. Moving the caret past the
         * existing one is what every code editor does, and it is only done when that
         * bracket sits at the caret and nothing is selected - so a deliberate second
         * closing bracket is still typable.
         */
        if (key === "}" || key === ")" || key === "]") {
            const caret = textarea.selectionStart;

            if (caret === textarea.selectionEnd && textarea.value[caret] === key) {
                event.preventDefault();

                textarea.setSelectionRange(caret + 1, caret + 1);
                paintSelection();
                return;
            }
        }

        if (key === "Escape") {
            event.preventDefault();
            options.onEscape?.();
        }
    };

    textarea.addEventListener("input", handleInput);
    textarea.addEventListener("scroll", syncScroll);
    textarea.addEventListener("click", handleSelection);
    textarea.addEventListener("keyup", handleSelection);
    textarea.addEventListener("select", handleSelection);
    textarea.addEventListener("keydown", handleKeyDown);

    /* -------- accumulate typing so the caller sees whole words, quickly -------- */

    /*
     * A SHORT COALESCE WINDOW, NOT A RENDER DELAY.
     *
     * The manager and the canvas are updated on every edit that matters, but a
     * burst of keystrokes is one parse rather than five: `onChange` is called
     * after the last keystroke of a 60 ms window, or immediately when the edit
     * is not typing (a paste, a delete, an undo). The FIRST call is never
     * delayed by more than the window, which is what keeps the drawing from
     * feeling lagged.
     */
    const TYPING_COALESCE_MS = 60;
    let typingTimer = null;
    let pendingValue = null;

    function flushTyping() {
        if (typingTimer) {
            clearTimeout(typingTimer);
            typingTimer = null;
        }

        if (pendingValue !== null) {
            const value = pendingValue;

            pendingValue = null;
            onChange?.(value);
        }
    }

    /*
     * THE COALESCE WINDOW IS FOR TYPING, NOT FOR A HARNESS.
     *
     * A `<textarea>`'s `input` events that arrive in the same task are keystrokes
     * of one word; waiting 60 ms turns them into one parse instead of five. A
     * synthetic event - `textarea.value = ...; dispatchEvent(new Event("input"))`,
     * which is how a test, an automation hook or an embed changes the editor -
     * has no next keystroke coming, so it is applied AT ONCE. Detecting that is
     * done through `isTrusted`: a real keystroke is trusted, a script's event is
     * not. The result is that the document is never a frame behind a script.
     */
    const handleCoalescedInput = (event) => {
        pendingValue = textarea.value;

        if (event && event.isTrusted === false) {
            flushTyping();
            return;
        }

        if (typingTimer) {
            clearTimeout(typingTimer);
            typingTimer = null;
        }

        typingTimer = setTimeout(() => {
            typingTimer = null;
            flushTyping();
        }, TYPING_COALESCE_MS);
    };

    textarea.addEventListener("input", handleCoalescedInput);

    /* Paste, cut and drop are not typing: they are shown at once. */
    textarea.addEventListener("paste", () => globalThis.setTimeout(flushTyping, 0));
    textarea.addEventListener("cut", () => globalThis.setTimeout(flushTyping, 0));
    textarea.addEventListener("drop", () => globalThis.setTimeout(flushTyping, 0));

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
         * changed elsewhere - rather than when the student is typing. The caret
         * is preserved across a change where it can be, so typing above a
         * generated block does not jump the cursor.
         */
        setValue(text, { preserveCaret = true } = {}) {
            const value = String(text ?? "");

            if (value === textarea.value) {
                return false;
            }

            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const scrollTop = textarea.scrollTop;

            /* A background update must not be lost inside the typing window. */
            pendingValue = null;

            if (typingTimer) {
                clearTimeout(typingTimer);
                typingTimer = null;
            }

            textarea.value = value;

            if (preserveCaret) {
                textarea.setSelectionRange(Math.min(start, value.length), Math.min(end, value.length));
                textarea.scrollTop = scrollTop;
            }

            render();

            return true;
        },

        /*
         * The object regions to band, one-based VISIBLE line numbers.
         * `[{ beginLine, endLine }]`; an empty list clears the band.
         */
        setHighlightedRegions(regions) {
            selectedRegions = (regions || []).filter(
                (region) => region && Number.isFinite(region.beginLine) && Number.isFinite(region.endLine)
            );

            renderDecor(currentText);
            renderGutter(currentText);
        },

        /* Compatibility with the old single-object API. */
        setHighlightedObject(ids) {
            void ids;
        },

        /* The error ranges to mark, in visible character offsets. */
        setErrorRanges(ranges) {
            errorRanges = (ranges || []).filter(
                (range) => range && Number.isFinite(range.start) && Number.isFinite(range.end)
            );

            paintErrorRanges();
        },

        /* A search result to mark, or null. */
        setSearchRange(range) {
            searchRange = range || null;
            paintErrorRanges();
        },

        /*
         * Scroll the given visible line into view, near the top of the pane, and
         * place the caret there without selecting anything. Used when the
         * selection came from the canvas: the student sees the code the object
         * came from, and their draft is untouched.
         */
        revealLine(lineNumber, { select = false } = {}) {
            const target = Math.max(1, Number(lineNumber) || 1);
            const lines = currentText.split("\n");
            const index = Math.min(target - 1, lines.length - 1);
            const lineTop = lines.slice(0, index).join("\n").length + (index > 0 ? 1 : 0);
            const lineEnd = lineTop + (lines[index] || "").length;

            if (select) {
                textarea.setSelectionRange(lineTop, lineEnd);
            } else {
                textarea.setSelectionRange(lineTop, lineTop);
            }

            /*
             * THE SCROLL IS COMPUTED FROM THE LINE'S MEASURED POSITION, not from
             * a line-height guess: a wrapped line is taller than one row, and the
             * estimate would land the student a few lines off.
             */
            const element = textLayer.children[index];
            const rowHeight = element ? element.getBoundingClientRect().height : 18;

            textarea.scrollTop = Math.max(0, (index * rowHeight) - rowHeight);

            syncScroll();
            paintSelection();
        },

        /* Move the caret to a character range and make it visible. */
        selectRange(start, end = start) {
            const length = textarea.value.length;
            const from = Math.max(0, Math.min(start, length));
            const to = Math.max(from, Math.min(end, length));

            textarea.setSelectionRange(from, to);

            const before = textarea.value.slice(0, from).split("\n").length;
            const rowHeight = 18;

            textarea.scrollTop = Math.max(0, (before - 4) * rowHeight);

            syncScroll();
            paintSelection();
            textarea.focus();
        },

        /* The line number of the caret, one-based. */
        caretLine() {
            return currentText.slice(0, textarea.selectionStart).split("\n").length;
        },

        /* The caret's current character offset. */
        caretOffset() {
            return textarea.selectionStart;
        },

        /* The character offsets a visible line covers. */
        lineOffsets(lineNumber) {
            const text = textarea.value;
            const starts = lineStarts(text);
            const index = Math.max(0, Math.min((Number(lineNumber) || 1) - 1, starts.length - 1));
            const start = starts[index];
            const next = index + 1 < starts.length ? starts[index + 1] - 1 : text.length;

            return { start, end: next };
        },

        /*
         * TEXT UNDO/REDO, THROUGH THE BROWSER'S OWN STACK.
         *
         * `execCommand("undo")` is what Ctrl+Z in a textarea already runs, and
         * it is the only way to reach that stack from code. Where it is absent
         * (a harness, a browser that has removed it), the command is a no-op
         * rather than a second history that would disagree with the native one.
         */
        undoText() {
            flushTyping();
            textarea.focus();

            try {
                ownerDocument.execCommand?.("undo");
            } catch {
                return false;
            }

            return true;
        },

        redoText() {
            flushTyping();
            textarea.focus();

            try {
                ownerDocument.execCommand?.("redo");
            } catch {
                return false;
            }

            return true;
        },

        focus() {
            textarea.focus();
        },

        /* Apply an edit from a command (Format Source), through the undo stack. */
        applyEdit(nextText, { selectionStart = null, selectionEnd = null } = {}) {
            if (typeof nextText !== "string" || nextText === textarea.value) {
                return false;
            }

            textarea.focus();
            textarea.setSelectionRange(0, textarea.value.length);

            if (selectionStart === null) {
                replaceRange(0, textarea.value.length, nextText);
            } else {
                replaceRange(0, textarea.value.length, nextText, selectionStart, selectionEnd ?? selectionStart);
            }

            flushTyping();

            return true;
        },

        hasFocus() {
            return ownerDocument.activeElement === textarea;
        },

        textarea,

        destroy() {
            textarea.removeEventListener("input", handleInput);
            textarea.removeEventListener("input", handleCoalescedInput);
            textarea.removeEventListener("scroll", syncScroll);
            textarea.removeEventListener("click", handleSelection);
            textarea.removeEventListener("keyup", handleSelection);
            textarea.removeEventListener("select", handleSelection);
            textarea.removeEventListener("keydown", handleKeyDown);

            if (typingTimer) {
                clearTimeout(typingTimer);
                typingTimer = null;
            }

            if (bracketFrame) {
                globalThis.cancelAnimationFrame(bracketFrame);
                bracketFrame = null;
            }

            host.innerHTML = "";
        }
    };

    return editor;
}

export { INDENT };

export default { createSourceEditor };
