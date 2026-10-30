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

/*
 * THE HIDDEN-OBJECT MARK, in the gutter.
 *
 * The SAME picture the Objects list uses for its eye, so "hidden" cannot come to
 * look like one thing in the panel and another beside the code. It is an inline
 * SVG rather than a glyph, so the margin cannot fall back to a box on a machine
 * without the icon font.
 */
const HIDDEN_EYE_ICON =
    '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">' +
    '<path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>' +
    '<circle cx="10" cy="10" r="2.2" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
    '<path d="M4 4l12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
    '</svg>';

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
        if (/DAETUM_OBJECT_(BEGIN|END)/.test(line)) {
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

    /*
     * THE HIDDEN OBJECTS' BLOCKS, in the same visible line numbers.
     *
     * A hidden object is still IN the source while its row says hidden - or, on
     * the paths where its block has been removed, there is simply nothing to
     * mark. So this is a DISPLAY of the model's visibility, applied as a
     * decoration over whatever text the block happens to occupy, and it is
     * kept separate from `selectedRegions` on purpose: selecting a hidden object
     * must not remove its hidden-state marker, and marking it hidden must not
     * look like a selection.
     */
    let hiddenRegions = [];

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

        paintHiddenBlocks();
    }

    /*
     * THE HIDDEN BLOCK'S BAND, painted on BOTH text layers.
     *
     * It has to be on the DECOR layer for the background and the left-edge rule,
     * because that layer is what draws behind the glyphs. It has to be on the
     * TEXT layer as well, because the mute is a COLOUR ON THE GLYPHS - which is
     * a separate layer by design. Two marks, one state, and neither touches the
     * source text: this is a decoration over whatever characters the block
     * occupies, so the code stays editable and copy-pasteable exactly as it was.
     */
    function paintHiddenBlocks() {
        [decor, textLayer].forEach((layer) => {
            layer.querySelectorAll("." + CLASS.line).forEach((line) => line.classList.remove("is-hidden", "is-hidden-header"));
        });

        if (!hiddenRegions.length) {
            return;
        }

        hiddenRegions.forEach((region) => {
            [decor, textLayer].forEach((layer) => {
                for (let line = region.beginLine; line <= region.endLine; line += 1) {
                    const element = layer.querySelector(`[data-line="${line}"]`) || layer.children[line - 1];

                    if (!element) {
                        continue;
                    }

                    element.classList.add("is-hidden");

                    if (line === region.beginLine) {
                        element.classList.add("is-hidden-header");
                    }
                }
            });
        });
    }

    function renderGutter(text) {
        const count = lines(text).length;
        const selected = new Set();

        selectedRegions.forEach((region) => {
            for (let line = region.beginLine; line <= region.endLine; line += 1) {
                selected.add(line);
            }
        });

        /*
         * AND THE HIDDEN BLOCKS, so the margin can carry the eye-off mark.
         *
         * The mark goes on EVERY line of a hidden block, so it reads as the
         * block's own state rather than as a mark on one line - and a hidden
         * block that is also selected keeps both: the two are different facts.
         */
        const hidden = new Set();

        hiddenRegions.forEach((region) => {
            for (let line = region.beginLine; line <= region.endLine; line += 1) {
                hidden.add(line);
            }
        });

        const fragment = ownerDocument.createDocumentFragment();

        for (let line = 1; line <= count; line += 1) {
            const row = ownerDocument.createElement("div");

            row.className = CLASS.gutterRow;

            if (hidden.has(line)) {
                row.classList.add("is-hidden");
            }

            /*
             * THE EYE-OFF IS AN ICON, NOT A DIGIT, on the header line only -
             * the line a reader looks at to identify the block. The number
             * stays on every other line, so the margin is still a line count.
             */
            if (hidden.has(line) && !hidden.has(line - 1)) {
                const mark = ownerDocument.createElement("span");

                mark.className = "ds-hidden-gutter-mark";
                mark.setAttribute("aria-hidden", "true");
                mark.innerHTML = HIDDEN_EYE_ICON;

                row.append(mark);
            }

            row.append(ownerDocument.createTextNode(String(line)));

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

    /* The client rectangle of a text offset, measured in the text layer. */
    function offsetPoint(starts, offset) {
        const text = currentText;
        const line = lineIndexAt(starts, offset);
        const lineStart = starts[line];
        const column = offset - lineStart;

        /*
         * A PROBE AT THE OFFSET, MEASURED IN A HIDDEN COPY OF ITS OWN LINE.
         * Using the text layer's own spans keeps the measurement identical to
         * the rendering, whatever the syntax highlighting put there.
         */
        const probe = ownerDocument.createElement("span");

        probe.textContent = text.slice(lineStart, offset).replace(/\n$/, "") || "\u200b";

        /* The probe is appended to a zero-width line so its left edge is the line's. */
        probe.style.whiteSpace = "pre";
        probe.style.display = "inline";

        const lineElement = textLayer.children[line];

        if (!lineElement) {
            return null;
        }

        const anchor = ownerDocument.createElement("span");

        anchor.textContent = "\u200b";
        anchor.style.display = "inline";
        lineElement.append(probe, anchor);

        const lineBox = lineElement.getBoundingClientRect();
        const probeBox = probe.getBoundingClientRect();
        const anchorBox = anchor.getBoundingClientRect();

        lineElement.removeChild(probe);
        lineElement.removeChild(anchor);

        return {
            left: probeBox.right,
            right: anchorBox.left,
            top: lineBox.top,
            bottom: lineBox.bottom,
            line,
            column
        };
    }

    /*
     * Rectangles for one range, in scroll box coordinates.
     *
     * A range is drawn as a DOM Range and its `getClientRects`, which is exact
     * for wrapped lines, tabs and widened glyphs - and needs no line arithmetic
     * of its own. The box is taken from the text layer (the element the glyphs
     * are in), so the rectangle is where the characters are, not where a
     * surrogate count says they should be.
     */
    function rectsForRange(start, end) {
        const first = textLayer.children[lineIndexAt(lineStarts(currentText), start)];
        const last = textLayer.children[lineIndexAt(lineStarts(currentText), end)];

        if (!first) {
            return [];
        }

        const range = ownerDocument.createRange();

        /*
         * THE END OF A LINE IS ITS LAST TEXT NODE'S LENGTH - NOT ITS CHILD COUNT.
         *
         * A `Range` offset means DIFFERENT THINGS depending on what it is
         * counted in: on a TEXT node it is a character index, and on an ELEMENT
         * it is a CHILD index. This used `childNodes.length`, which is one past
         * the last child index of an element - so `setEnd` threw
         * "There is no child at offset 4", the catch below returned an empty
         * list, and NO selection block was ever painted. The selection was real,
         * the textarea knew its range, and nothing appeared: the whole of
         * "selecting has no highlight".
         *
         * Counting into the last text node is both correct for a text node and
         * the end of the line's characters, which is what the block should
         * cover. `lastChild || lastNode` keeps a line with no text at all - a
         * blank line - measurable rather than throwing.
         */
        const endNode = (last || first).lastChild || last || first;

        try {
            range.setStart(first.firstChild || first, 0);
            range.setEnd(
                endNode,
                endNode.nodeType === 3 /* TEXT_NODE */ ? endNode.data.length : endNode.childNodes.length - 0
            );
        } catch {
            return [];
        }

        /*
         * Narrow the range to the characters themselves. A DOM range over the
         * elements' contents is coarse; walking the text nodes to the exact
         * offsets is what makes a selection start at the right glyph.
         */
        const precise = preciseRangeFor(start, end);

        /*
         * A RANGE THAT CANNOT BE MEASURED GIVES NO BLOCKS, NOT AN EXCEPTION.
         *
         * `getClientRects` on a range whose endpoints have since moved can throw
         * as well as return nothing, and a throw here escaped `paintSelection`
         * and left the caret layer empty - the same invisible-selection symptom
         * from a second direction. A missing highlight is a cosmetic fault; an
         * exception on every selection change is not.
         */
        let rects;

        try {
            rects = precise ? [...precise.getClientRects()] : [...range.getClientRects()];
        } catch {
            rects = [];
        }

        const box = scroll.getBoundingClientRect();

        return rects
            .filter((rect) => rect.width > 0 || rect.height > 0)
            .map((rect) => ({
                left: rect.left - box.left,
                top: rect.top - box.top,
                width: rect.width,
                height: rect.height
            }));
    }

    /*
     * A Range over the exact character offsets, found by walking text nodes.
     *
     * THE LINE BREAKS COUNT, EVEN THOUGH NO NODE HOLDS THEM.
     *
     * The source's text is rendered one `<div>` per line, so the newline between
     * two lines is not IN any text node - it is the boundary BETWEEN them. A
     * walk that sums only text-node lengths therefore runs out of characters
     * before the end of the text: an offset at the end of a line, or anywhere on
     * a later line, lands past the last node it can reach, and `setEnd` clamps to
     * that node's length. The visible result is a highlight that stops partway
     * along a line - an object's band, or a selection, ending short of the text
     * it is supposed to cover.
     *
     * So a line boundary is counted as ONE character (the newline it stands for),
     * exactly as the textarea counts it. A range that ends on that boundary is
     * moved back to the END OF THE PREVIOUS LINE'S TEXT - the last real
     * character - because there is nothing after it on that line to highlight.
     */
    function preciseRangeFor(start, end) {
        const walker = ownerDocument.createTreeWalker(textLayer, 4 /* NodeFilter.SHOW_TEXT */);
        const range = ownerDocument.createRange();

        /* Every text node, with the offset its first character sits at. */
        const nodes = [];
        let node = walker.nextNode();

        while (node) {
            nodes.push(node);
            node = walker.nextNode();
        }

        if (!nodes.length) {
            return null;
        }

        /*
         * The offset of each node's first character is reconstructed from the
         * LINES, not from the node lengths: a line's text lives in the nodes
         * inside its `<div>`, and one newline sits between it and the next.
         */
        const starts = lineStarts(currentText);
        const positions = [];
        let running = 0;

        nodes.forEach((textNode) => {
            positions.push(running);
            running += textNode.data.length;
        });

        /*
         * A node lying on line L starts, in the FULL text, at L's start offset
         * plus its position within that line. The line index is found from the
         * node's line element, which is what carries the newline accounting.
         */
        const lineIndexOfNode = (textNode) => {
            let element = textNode.parentElement;

            while (element && element !== textLayer) {
                if (element.parentElement === textLayer) {
                    return [...textLayer.children].indexOf(element);
                }

                element = element.parentElement;
            }

            return -1;
        };

        const findPosition = (character, isEnd) => {
            for (let index = nodes.length - 1; index >= 0; index -= 1) {
                const textNode = nodes[index];
                const lineIndex = lineIndexOfNode(textNode);
                const lineStart = lineIndex >= 0 && starts[lineIndex] !== undefined ? starts[lineIndex] : 0;
                const nodeStart = lineStart + positions[index];
                const nodeEnd = nodeStart + textNode.data.length;

                if (character >= nodeStart && character <= nodeEnd) {
                    return { node: textNode, offset: Math.min(character - nodeStart, textNode.data.length) };
                }
            }

            /*
             * NOT INSIDE ANY NODE - the character is a line break, or past the
             * end. `isEnd` decides which way to fall back: an end takes the last
             * character it can reach, a start takes the first node's beginning.
             */
            if (isEnd) {
                const last = nodes[nodes.length - 1];

                return { node: last, offset: last.data.length };
            }

            return { node: nodes[0], offset: 0 };
        };

        const from = findPosition(start, false);
        const to = findPosition(Math.max(start, end), true);

        if (!from.node || !to.node) {
            return null;
        }

        try {
            range.setStart(from.node, Math.min(from.offset, from.node.data.length));
            range.setEnd(to.node, Math.min(to.offset, to.node.data.length));
        } catch {
            return null;
        }

        return range;
    }

    function paintSelection() {
        caretLayer.replaceChildren();

        /*
         * THE SELECTION IS MEASURED AGAINST THE TEXT ON SCREEN NOW.
         *
         * `currentText` is the text the layers were last RENDERED from, and the
         * two can differ for a moment - the browser updates `value` and the
         * selection together, on its own schedule, and `selectionchange` can
         * arrive before the input event that redraws. Measuring the selection
         * against the older string walked past the end of the text layer, threw
         * an IndexSizeError, and left the caret layer EMPTY: the selection was
         * real, the textarea knew it, and NOTHING was painted. That is the
         * "selecting has no highlight" failure, and it hit every selection the
         * code did not itself drive (a click, Shift+click, Ctrl+A, a
         * double-click) while a mouse DRAG - which repaints after the input
         * event - worked.
         *
         * So the measurement uses the live value, and the text layer is brought
         * up to date first if it has fallen behind. A selection can then never
         * be measured against text that is not there.
         */
        /*
         * THE RANGE IS READ BEFORE ANY REDRAW, AND RESTORED AFTER IT.
         *
         * `render()` rebuilds the text layer, and rebuilding the DOM under a
         * focused textarea can move its selection - so a range read AFTER the
         * redraw is not the range the student made. That is why a selection
         * painted only a caret: the two ends had collapsed to the same offset by
         * the time they were read, `start !== end` was false, and no block was
         * drawn. Reading first and asserting the range afterwards makes the
         * highlight independent of what the redraw did.
         */
        const selection = orderedSelection(textarea);

        if (currentText !== textarea.value) {
            render();

            try {
                textarea.setSelectionRange(
                    Math.min(selection.start, textarea.value.length),
                    Math.min(selection.end, textarea.value.length),
                    selection.forward ? "forward" : "backward"
                );
            } catch {
                /* A selection that cannot be restored is not worth throwing for. */
            }
        }

        const { start, end, forward } = selection;

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
            const point = offsetPoint(lineStarts(currentText), focus);

            if (point) {
                const box = scroll.getBoundingClientRect();
                const caret = ownerDocument.createElement("div");

                caret.className = "drawing-source-caret";
                caret.style.left = `${point.right - box.left}px`;
                caret.style.top = `${point.top - box.top}px`;
                caret.style.height = `${point.bottom - point.top}px`;
                caretLayer.append(caret);
            }
        }

        const brace = start === end ? matchedBracket(currentText, start) : null;

        if (brace !== null && ownerDocument.activeElement === textarea) {
            const box = scroll.getBoundingClientRect();

            [start, brace].forEach((offset) => {
                const mark = offsetPoint(lineStarts(currentText), offset + (offset === start ? 0 : 1));

                if (!mark) {
                    return;
                }

                const element = ownerDocument.createElement("div");

                element.className = "drawing-source-bracket";
                element.style.left = `${mark.right - box.left - 4}px`;
                element.style.top = `${mark.top - box.top}px`;
                element.style.height = `${mark.bottom - mark.top}px`;
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

        /*
         * AND AGAIN ON THE NEXT FRAME, WHICH IS WHEN THE RANGE IS FINAL.
         *
         * A click that selects - Shift+click, a double-click, `Ctrl+A` - fires
         * `select` and `mouseup` BEFORE the browser has committed the new
         * selection, so reading `selectionStart`/`selectionEnd` synchronously
         * gives the OLD, collapsed range: the paint then draws a caret and no
         * block, and the student sees nothing selected. The drag case escaped
         * this only because a drag delivers enough events that a later one lands
         * after the commit.
         *
         * One frame later the range is always settled, so the same paint runs
         * again from the committed value. `paintSelection` is idempotent - it
         * clears the layer and rebuilds it - so this cannot double up or
         * flicker.
         */
        const view = ownerDocument.defaultView;

        if (typeof view?.requestAnimationFrame === "function") {
            view.requestAnimationFrame(() => {
                if (ownerDocument.activeElement === textarea) {
                    paintSelection();
                }
            });
        }

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

    /*
     * THE END OF A DRAG IS A SELECTION CHANGE TOO.
     *
     * A textarea fires `select` when its selection changes, but NOT reliably
     * while the pointer is still down and dragging - so a drag-select could end
     * with a real selection in the textarea and NOTHING painted in the caret
     * layer: the highlight only appeared on the next click or keypress. The end
     * of the drag is the moment the selection is final, so it is listened for
     * explicitly.
     */
    textarea.addEventListener("mouseup", handleSelection);

    /*
     * AND `selectionchange`, FOR THE PATHS THAT GO THROUGH THE DOCUMENT.
     *
     * A double-click, a triple-click and `Ctrl+A` change the textarea's
     * selection through the document's own selection object, and some browsers
     * do not deliver `select` for those. The document event is the one signal
     * that covers every way the selection can change.
     */
    const handleDocumentSelectionChange = () => {
        if (ownerDocument.activeElement === textarea) {
            paintSelection();

            /*
             * The same one-frame deferral as `handleSelection`, for the paths
             * that reach the document's own selection object (`Ctrl+A`, a
             * triple-click) before the textarea's range is committed.
             */
            const view = ownerDocument.defaultView;

            if (typeof view?.requestAnimationFrame === "function") {
                view.requestAnimationFrame(() => {
                    if (ownerDocument.activeElement === textarea) {
                        paintSelection();
                    }
                });
            }
        }
    };

    ownerDocument.addEventListener("selectionchange", handleDocumentSelectionChange);

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
        /**
         * Mark the blocks of hidden objects. Same shape as the selection band.
         *
         * Separate from `setHighlightedRegions` because the two mean different
         * things and must be able to hold at once - a hidden object can also be
         * the selected one.
         */
        setHiddenRegions(regions) {
            hiddenRegions = (regions || []).filter(
                (region) => region && Number.isFinite(region.beginLine) && Number.isFinite(region.endLine)
            );

            paintHiddenBlocks();
            renderGutter(currentText);
        },

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
            textarea.removeEventListener("mouseup", handleSelection);
            textarea.removeEventListener("keydown", handleKeyDown);
            ownerDocument.removeEventListener("selectionchange", handleDocumentSelectionChange);

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
