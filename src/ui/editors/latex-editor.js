/*
 * ============================================================
 * THE LaTeX CODE EDITOR
 * ============================================================
 *
 * A floating window: LaTeX drawing code on the left, DAETUM's own live
 * preview of it on the right, and below them every line the reader could not
 * use. "Insert into drawing" places what the code draws on the current sheet
 * as real, editable features.
 *
 * It is NOT modal - the drawing stays usable behind it - and it MINIMISES to
 * a small bar in the corner, keeping its code, so it can be put away while
 * drawing and brought back.
 *
 * This module is presentation and interaction only. What the code means and
 * what inserting does are passed in:
 *
 *   openLatexEditor({
 *       text,                       the code to start with
 *       read(text)                  -> { features, diagnostics, statements, understood }
 *       preview(features)           -> an element showing the drawing, or null
 *       insert(features)            -> a status message
 *       fromDrawing()               -> code for the current sheet
 *       notice                      an optional message shown above the code
 *   })
 *
 * One editor at a time: opening it again brings the existing one back.
 */

const PREVIEW_DELAY_MS = 250;

let current = null;

const EXAMPLE = String.raw`% Write LaTeX drawing commands; the preview updates as you type.
% Units: 1 = 1 cm (10 drawing units). Use (x,y), (angle:radius), ++(dx,dy).
\begin{tikzpicture}
  \coordinate (A) at (0,0);
  \coordinate (B) at (6,0);
  \draw[thick] (A) -- (B);                  % a line
  \draw (A) -- ++(0,-1) -- ++(1,0) -- cycle; % a triangle
  \draw (3,2) circle[radius=0.8];           % a circle
  \draw[->] (3,3.5) -- (3,1);               % an arrow
  \node at (3,4) {$F = 250$ N};             % text
\end{tikzpicture}
`;

function element(tag, className, attributes = {}) {
    const node = document.createElement(tag);

    if (className) {
        node.className = className;
    }

    for (const [key, value] of Object.entries(attributes)) {
        if (key === "text") {
            node.textContent = value;
        } else {
            node.setAttribute(key, value);
        }
    }

    return node;
}

/* Select a line of the code, so a diagnostic can be followed to its source. */
function selectLine(textarea, line) {
    const lines = textarea.value.split("\n");
    const start = lines.slice(0, line - 1).reduce((sum, l) => sum + l.length + 1, 0);
    const end = start + (lines[line - 1] || "").length;

    textarea.focus();
    textarea.setSelectionRange(start, end);

    /* Bring the line into view. */
    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 18;
    textarea.scrollTop = Math.max(0, (line - 3) * lineHeight);
}

export function isLatexEditorOpen() {
    return Boolean(current);
}

export function openLatexEditor(options = {}) {
    if (current) {
        current.restore();

        if (typeof options.text === "string") {
            current.setText(options.text, options.notice);
        }

        return current;
    }

    const root = element("section", "datum-latex-editor", {
        role: "dialog",
        "aria-label": "LaTeX code",
        "aria-modal": "false"
    });

    /* ---- header ---- */
    const header = element("header", "datum-latex-editor-header");
    const title = element("h2", "datum-latex-editor-title", { text: "LaTeX code" });
    const actions = element("div", "datum-latex-editor-header-actions");
    const fromDrawing = element("button", "engg-dialog-button", {
        type: "button",
        text: "From drawing",
        title: "Show the current sheet as LaTeX code"
    });
    const minimise = element("button", "datum-latex-editor-icon", {
        type: "button",
        "aria-label": "Minimise",
        title: "Minimise",
        text: "–"
    });
    const close = element("button", "datum-latex-editor-icon", {
        type: "button",
        "aria-label": "Close",
        title: "Close",
        text: "×"
    });
    actions.append(fromDrawing, minimise, close);
    header.append(title, actions);

    /* ---- body: code | preview ---- */
    const notice = element("p", "datum-latex-editor-notice");
    notice.hidden = true;

    const body = element("div", "datum-latex-editor-body");
    const code = element("textarea", "datum-latex-editor-code", {
        spellcheck: "false",
        autocapitalize: "off",
        autocomplete: "off",
        "aria-label": "LaTeX drawing code",
        wrap: "off"
    });
    code.value = typeof options.text === "string" ? options.text : EXAMPLE;

    const preview = element("div", "datum-latex-editor-preview", { "aria-label": "Preview" });
    body.append(code, preview);

    /* ---- footer: diagnostics, summary, actions ---- */
    const footer = element("footer", "datum-latex-editor-footer");
    const problems = element("ul", "datum-latex-editor-problems", { "aria-label": "Lines DAETUM could not draw" });
    const bar = element("div", "datum-latex-editor-bar");
    const summary = element("span", "datum-latex-editor-summary", { role: "status" });
    const copy = element("button", "engg-dialog-button", { type: "button", text: "Copy code" });
    const insert = element("button", "engg-dialog-button engg-dialog-button-primary", {
        type: "button",
        text: "Insert into drawing"
    });
    bar.append(summary, copy, insert);
    footer.append(problems, bar);

    /* ---- the minimised bar ---- */
    const dock = element("button", "datum-latex-editor-dock", {
        type: "button",
        title: "Show the LaTeX code editor",
        text: "LaTeX code"
    });
    dock.hidden = true;

    root.append(header, notice, body, footer);
    document.body.append(root, dock);

    /* ---- behaviour ---- */
    let result = { features: [], diagnostics: [] };
    let timer = null;

    function refresh() {
        timer = null;

        try {
            result = options.read ? options.read(code.value) : { features: [], diagnostics: [] };
        } catch (error) {
            result = { features: [], diagnostics: [{ line: 1, severity: "error", message: String(error?.message || error) }] };
        }

        preview.replaceChildren();
        const drawing = result.features.length && options.preview ? options.preview(result.features) : null;

        if (drawing) {
            preview.append(drawing);
        } else {
            preview.append(element("p", "datum-latex-editor-empty", {
                text: result.features.length ? "Nothing visible to preview." : "Nothing to draw yet."
            }));
        }

        problems.replaceChildren(
            ...result.diagnostics.map(problem => {
                const item = element("li", `datum-latex-editor-problem datum-latex-editor-problem-${problem.severity}`);
                const jump = element("button", "datum-latex-editor-line", {
                    type: "button",
                    title: "Show this line",
                    text: `Line ${problem.line}`
                });
                jump.addEventListener("click", () => selectLine(code, problem.line));
                item.append(jump, element("span", "", { text: problem.message }));
                return item;
            })
        );
        problems.hidden = !result.diagnostics.length;

        const n = result.features.length;
        const issues = result.diagnostics.filter(d => d.severity !== "info").length;
        summary.textContent =
            `${n} feature${n === 1 ? "" : "s"}` +
            (Number.isFinite(result.statements) ? ` from ${result.understood}/${result.statements} statements` : "") +
            (issues ? ` · ${issues} line${issues === 1 ? "" : "s"} not drawn` : "");
        insert.disabled = n === 0;
    }

    function schedule() {
        if (timer) {
            clearTimeout(timer);
        }

        timer = setTimeout(refresh, PREVIEW_DELAY_MS);
    }

    function setText(text, message) {
        code.value = text;
        notice.textContent = message || "";
        notice.hidden = !message;
        refresh();
    }

    function minimiseEditor() {
        root.hidden = true;
        dock.hidden = false;
    }

    function restore() {
        root.hidden = false;
        dock.hidden = true;
        code.focus();
    }

    function closeEditor() {
        if (timer) {
            clearTimeout(timer);
        }

        root.remove();
        dock.remove();
        current = null;
    }

    code.addEventListener("input", schedule);

    /* Tab indents rather than leaving the code. */
    code.addEventListener("keydown", event => {
        if (event.key === "Tab" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            const { selectionStart: s, selectionEnd: e } = code;
            code.setRangeText("  ", s, e, "end");
            schedule();
        }

        /* Keys typed here belong to the code, not to the drawing's shortcuts. */
        event.stopPropagation();
    });

    root.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            event.stopPropagation();
            minimiseEditor();
        }
    });

    insert.addEventListener("click", () => {
        refresh();

        if (result.features.length && options.insert) {
            summary.textContent = options.insert(result.features);
        }
    });

    copy.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(code.value);
            summary.textContent = "Code copied";
        } catch {
            code.select();
            summary.textContent = "Select the code and copy it with Ctrl+C";
        }
    });

    fromDrawing.addEventListener("click", () => {
        if (options.fromDrawing) {
            setText(options.fromDrawing(), "The current sheet as LaTeX. Editing this code does not change the sheet until you insert it.");
        }
    });

    minimise.addEventListener("click", minimiseEditor);
    dock.addEventListener("click", restore);
    close.addEventListener("click", closeEditor);

    current = { root, restore, minimise: minimiseEditor, close: closeEditor, setText, refresh, code };

    setText(code.value, options.notice);
    code.focus();

    return current;
}

export default { openLatexEditor, isLatexEditorOpen };
