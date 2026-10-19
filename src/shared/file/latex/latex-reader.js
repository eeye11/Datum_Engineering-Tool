/*
 * ============================================================
 * READING LaTeX DRAWING CODE INTO FEATURES
 * ============================================================
 *
 * DAETUM's own reader for the drawing language a LaTeX picture is written
 * in (the TikZ syntax). It turns the commands it understands into real,
 * editable DAETUM features - lines, polylines, triangles, rectangles,
 * circles, arcs, arrows, points and text notes - and reports every
 * statement or option it cannot use, with its line number. Nothing is
 * silently dropped, and nothing here runs TeX.
 *
 * UNITS. A coordinate without a unit is measured in the picture's x and y
 * units (1 cm by default, as in LaTeX); one with a unit (2cm, 5mm, 10pt) is
 * absolute. Lengths become drawing units at 1 mm each - the convention the
 * LaTeX writer uses, so a picture DAETUM wrote reads back at its own
 * coordinates. A picture's own `scale` changes only its printed size, so it
 * is not applied; a `scope`'s scale, shift and rotation are.
 *
 * WHAT IT DOES NOT DO. LaTeX is a programming language: loops (\foreach),
 * macros (\def, \newcommand), coordinate calculations ($...$), plots and
 * library shapes are reported as unsupported rather than guessed at.
 */
import enggDrawingState from "../../model/drawing-state.js";
import enggAnnotate from "../../../features/workspace/model/annotations/annotate-model.js";

/* ---------- units ---------- */

const MM_PER = { mm: 1, cm: 10, pt: 25.4 / 72.27, bp: 25.4 / 72, in: 25.4, pc: 25.4 / 6, em: 3.5, ex: 1.5, sp: 25.4 / (72.27 * 65536) };

/* A length like "2cm", "0.5 pt" or "3" (in `unitless` mm). Returns mm, or null. */
function lengthMm(text, unitless = null) {
    const match = String(text).trim().match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*([a-z]{2})?$/i);

    if (!match) {
        return null;
    }

    const value = Number(match[1]);

    if (!match[2]) {
        return unitless === null ? null : value * unitless;
    }

    const per = MM_PER[match[2].toLowerCase()];
    return per === undefined ? null : value * per;
}

/* Line widths, in points, for TikZ's named widths. */
const NAMED_WIDTHS_PT = {
    "ultra thin": 0.1,
    "very thin": 0.2,
    thin: 0.4,
    semithick: 0.6,
    thick: 0.8,
    "very thick": 1.2,
    "ultra thick": 1.6
};

/*
 * A printed line width back to DAETUM's lineWidth. The writer prints a
 * lineWidth w as w * 2.4 px at 0.17 mm per px; this is its inverse, so a width
 * DAETUM wrote reads back as the width it had.
 */
const PT_PER_LINE_WIDTH = 2.4 * (170 / 1000) * (72.27 / 25.4);

/* ---------- colours ---------- */

const NAMED_COLOURS = {
    black: "#000000",
    white: "#ffffff",
    red: "#ff0000",
    green: "#00ff00",
    blue: "#0000ff",
    cyan: "#00ffff",
    magenta: "#ff00ff",
    yellow: "#ffff00",
    gray: "#808080",
    grey: "#808080",
    darkgray: "#404040",
    lightgray: "#bfbfbf",
    brown: "#bf8040",
    lime: "#bfff00",
    olive: "#808000",
    orange: "#ff8000",
    pink: "#ffbfbf",
    purple: "#bf0040",
    teal: "#008080",
    violet: "#800080"
};

function hex(r, g, b) {
    return "#" + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
}

function rgbOf(hexColour) {
    const h = hexColour.replace("#", "");
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}

/* "red", "red!50", "red!30!blue", "myColour" -> "#rrggbb", or null. */
function resolveColour(text, defined) {
    const parts = String(text).trim().split("!").map(p => p.trim());
    const base = name => defined.get(name) || NAMED_COLOURS[name.toLowerCase()] || null;
    let colour = base(parts[0]);

    if (!colour) {
        return null;
    }

    for (let i = 1; i < parts.length; i += 2) {
        const percent = Number(parts[i]);
        const other = parts[i + 1] ? base(parts[i + 1]) : "#ffffff";

        if (!Number.isFinite(percent) || !other) {
            return colour;
        }

        const a = rgbOf(colour);
        const b = rgbOf(other);
        const t = percent / 100;
        colour = hex(a[0] * t + b[0] * (1 - t), a[1] * t + b[1] * (1 - t), a[2] * t + b[2] * (1 - t));
    }

    return colour;
}

/* \definecolor{name}{HTML|rgb|RGB|gray}{...} anywhere in the text. */
function definedColours(text) {
    const defined = new Map();

    for (const [, name, model, value] of text.matchAll(/\\definecolor\s*\{([^}]+)\}\s*\{([^}]+)\}\s*\{([^}]+)\}/g)) {
        const v = value.split(",").map(s => Number(s.trim()));
        let colour = null;

        if (model === "HTML" && /^[0-9a-f]{6}$/i.test(value.trim())) {
            colour = `#${value.trim().toLowerCase()}`;
        } else if (model === "rgb" && v.length === 3) {
            colour = hex(v[0] * 255, v[1] * 255, v[2] * 255);
        } else if (model === "RGB" && v.length === 3) {
            colour = hex(v[0], v[1], v[2]);
        } else if (model === "gray" && v.length === 1) {
            colour = hex(v[0] * 255, v[0] * 255, v[0] * 255);
        }

        if (colour) {
            defined.set(name.trim(), colour);
        }
    }

    return defined;
}

/* ---------- text ---------- */

const FROM_LATEX = {
    "\\theta": "θ", "\\alpha": "α", "\\beta": "β", "\\gamma": "γ", "\\delta": "δ", "\\varepsilon": "ε",
    "\\epsilon": "ε", "\\lambda": "λ", "\\mu": "μ", "\\nu": "ν", "\\pi": "π", "\\rho": "ρ", "\\sigma": "σ",
    "\\tau": "τ", "\\phi": "φ", "\\omega": "ω", "\\Delta": "Δ", "\\Sigma": "Σ", "\\Omega": "Ω", "\\Phi": "Φ",
    "\\cdot": "·", "\\times": "×", "\\pm": "±", "\\approx": "≈", "\\leq": "≤", "\\le": "≤", "\\geq": "≥",
    "\\ge": "≥", "\\rightarrow": "→", "\\to": "→", "\\leftarrow": "←", "\\infty": "∞", "\\surd": "√",
    "\\int": "∫", "\\perp": "⊥", "\\parallel": "∥", "\\oplus": "⊕", "\\circ": "°", "\\degree": "°",
    "\\textdegree": "°", "\\square": "□", "\\textbackslash": "\\"
};

/* LaTeX text (as a node holds it) to the plain text a DAETUM note shows. */
export function plainText(latex) {
    let text = String(latex);

    /*
     * Escaped characters (\$, \%, \{ ...) are set aside first, so stripping
     * the math $ and the grouping braces below cannot remove the student's own.
     */
    const kept = [];
    text = text.replace(/\\([%$&#_{}])/g, (m, c) => {
        kept.push(c);
        return `${kept.length - 1}`;
    });

    text = text.replace(/\\\\(\[[^\]]*\])?/g, "\n");
    text = text.replace(/\^\{?\\circ\}?/g, "°").replace(/\^\{?2\}?/g, "²").replace(/\^\{?3\}?/g, "³");
    text = text.replace(/\\[a-zA-Z]+/g, m => FROM_LATEX[m] ?? m);
    text = text.replace(/\\(?:textbf|textit|emph|text|mathrm|mathbf|textsf|texttt|mbox)\s*/g, "");
    text = text.replace(/\\(?:bfseries|itshape|sffamily|ttfamily|rmfamily|small|footnotesize|scriptsize|tiny|large|Large|LARGE|huge|Huge|normalsize|selectfont)\b\s*/g, "");
    text = text.replace(/\\fontsize\s*\{[^}]*\}\s*\{[^}]*\}/g, "");
    text = text.replace(/\\~\{\}/g, "").replace(/\\\^\{\}/g, "^");
    text = text.replace(/\\[a-zA-Z]+/g, "");
    text = text.replace(/[{}$]/g, "").replace(/--/g, "–").replace(/~/g, " ").replace(//g, "~");
    text = text.replace(/(\d+)/g, (m, n) => kept[Number(n)]);

    return text.split("\n").map(line => line.replace(/\s+/g, " ").trim()).join("\n").trim();
}

/* ---------- scanning ---------- */

/* Comments blanked out (kept as spaces, so positions and lines stay true). */
function stripComments(text) {
    return text.replace(/(^|[^\\])%[^\n]*/g, (m, before) => before + " ".repeat(m.length - before.length));
}

function lineAt(text, index) {
    let line = 1;

    for (let i = 0; i < index && i < text.length; i++) {
        if (text[i] === "\n") {
            line++;
        }
    }

    return line;
}

/* The index just past the group that opens at `start` ((, [ or {), or -1. */
function closeOf(text, start) {
    const open = text[start];
    const close = { "(": ")", "[": "]", "{": "}" }[open];
    let depth = 0;

    for (let i = start; i < text.length; i++) {
        const c = text[i];

        if (c === "\\") {
            i++;
            continue;
        }

        if (c === open) {
            depth++;
        } else if (c === close) {
            depth--;

            if (depth === 0) {
                return i + 1;
            }
        }
    }

    return -1;
}

/* Split on a separator at bracket depth 0. */
function splitTop(text, separator = ",") {
    const parts = [];
    let depth = 0;
    let current = "";

    for (let i = 0; i < text.length; i++) {
        const c = text[i];

        if (c === "\\") {
            current += c + (text[i + 1] || "");
            i++;
            continue;
        }

        if ("([{".includes(c)) {
            depth++;
        } else if (")]}".includes(c)) {
            depth--;
        }

        if (c === separator && depth === 0) {
            parts.push(current);
            current = "";
        } else {
            current += c;
        }
    }

    parts.push(current);
    return parts.map(p => p.trim()).filter(Boolean);
}

/* "[a=b, c]" content -> [{ key, value }] */
function parseOptions(text) {
    return splitTop(text).map(part => {
        const at = part.indexOf("=");

        if (at < 0) {
            return { key: part.trim(), value: null };
        }

        return { key: part.slice(0, at).trim(), value: part.slice(at + 1).trim().replace(/^\{([\s\S]*)\}$/, "$1") };
    });
}

/* ---------- transforms ---------- */

const IDENTITY = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function compose(m, n) {
    return {
        a: m.a * n.a + m.c * n.b,
        b: m.b * n.a + m.d * n.b,
        c: m.a * n.c + m.c * n.d,
        d: m.b * n.c + m.d * n.d,
        e: m.a * n.e + m.c * n.f + m.e,
        f: m.b * n.e + m.d * n.f + m.f
    };
}

function applyTo(m, p) {
    return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

/* ---------- the reader ---------- */

/*
 * An arrow specification: "->", "<-", "<->", "-Stealth", "-{Latex[length=2mm]}",
 * "|->". Returns where its heads are, or null for anything else.
 */
function arrowHeads(key) {
    const k = String(key).trim();

    if (/\s|=/.test(k.replace(/\{[^}]*\}|\[[^\]]*\]/g, "")) || !k.includes("-")) {
        return null;
    }

    const at = k.indexOf("-");
    const before = k.slice(0, at).replace(/\|/g, "");
    const after = k.slice(at).replace(/^-+/, "").replace(/\|/g, "");
    const tip = s => s.length > 0;

    if (!/[<>]|stealth|latex|triangle|to\b|bar|circle|kite|square/i.test(k) && !(tip(before) || tip(after))) {
        return null;
    }

    return { start: tip(before), end: tip(after) };
}

/* Options that change nothing DAETUM stores, accepted without a warning. */
const COSMETIC = new Set([
    "line cap", "line join", "rounded corners", "sharp corners", "inner sep", "outer sep", "minimum size",
    "minimum width", "minimum height", "font", "align", "text width", ">", "every node/.style", "baseline",
    "transform shape", "draw opacity", "fill opacity", "text opacity", "opacity", "anchor", "above", "below",
    "left", "right", "above left", "above right", "below left", "below right", "pos", "midway", "near start",
    "near end", "at start", "at end", "sloped", "auto", "swap", "very near start", "very near end", "border",
    "x", "y", "scale", "xscale", "yscale", "shift", "xshift", "yshift", "rotate", "text", "color", "draw",
    "fill", "line width", "dashed", "dotted", "densely dashed", "loosely dashed", "densely dotted",
    "loosely dotted", "dash dot", "dash pattern", "solid", "radius", "x radius", "y radius", "start angle",
    "end angle", "delta angle", "step", "help lines", "label", "pin", "name", "nodes", "every path/.style"
]);

export function readLatexDrawing(source) {
    const raw = String(source || "");
    const text = stripComments(raw);
    const defined = definedColours(text);
    const diagnostics = [];
    const features = [];
    const report = (index, severity, message) => {
        diagnostics.push({ line: lineAt(text, index), severity, message });
    };
    const factories = enggDrawingState.geometryFactories;
    let statements = 0;
    let understood = 0;
    let statementIndex = 0;

    /* The pictures; without any, the whole text is read as one picture body. */
    const pictures = [];
    const pictureRe = /\\begin\s*\{tikzpicture\}/g;
    let match;

    while ((match = pictureRe.exec(text))) {
        let bodyStart = match.index + match[0].length;
        let options = "";
        const afterBegin = text.slice(bodyStart).match(/^\s*/)[0].length;

        if (text[bodyStart + afterBegin] === "[") {
            const end = closeOf(text, bodyStart + afterBegin);
            options = text.slice(bodyStart + afterBegin + 1, end - 1);
            bodyStart = end;
        }

        const close = text.indexOf("\\end{tikzpicture}", bodyStart);
        pictures.push({ start: bodyStart, end: close < 0 ? text.length : close, options });

        if (close < 0) {
            report(match.index, "error", "\\begin{tikzpicture} is never closed with \\end{tikzpicture}; reading to the end.");
        }
    }

    if (!pictures.length) {
        if (/\\(draw|fill|filldraw|path|node|coordinate)\b/.test(text)) {
            pictures.push({ start: 0, end: text.length, options: "" });
        } else {
            report(0, "error", "No drawing commands found. Write \\draw, \\fill, \\node or \\coordinate commands, optionally inside \\begin{tikzpicture} ... \\end{tikzpicture}.");
        }
    }

    for (const picture of pictures) {
        readPicture(picture);
    }

    return {
        features,
        diagnostics: diagnostics.sort((a, b) => a.line - b.line),
        pictures: pictures.length,
        statements,
        understood
    };

    /* ---------------------------------------------------------- */

    function readPicture(picture) {
        /* Unit vectors in mm. The picture's own `scale` is its print size only. */
        const frame = {
            ux: 10,
            uy: 10,
            matrix: IDENTITY,
            style: {}
        };
        applyFrameOptions(frame, parseOptions(picture.options), picture.start, true);

        const stack = [frame];
        const names = new Map();
        let i = picture.start;

        while (i < picture.end) {
            const ws = text.slice(i).match(/^\s+/);

            if (ws) {
                i += ws[0].length;
                continue;
            }

            if (text.startsWith("\\begin{scope}", i)) {
                let at = i + "\\begin{scope}".length;
                const pad = text.slice(at).match(/^\s*/)[0].length;
                const scope = { ...stack[stack.length - 1] };

                if (text[at + pad] === "[") {
                    const end = closeOf(text, at + pad);
                    applyFrameOptions(scope, parseOptions(text.slice(at + pad + 1, end - 1)), i, false);
                    at = end;
                }

                stack.push(scope);
                i = at;
                continue;
            }

            if (text.startsWith("\\end{scope}", i)) {
                if (stack.length > 1) {
                    stack.pop();
                }

                i += "\\end{scope}".length;
                continue;
            }

            /*
             * Commands made only of brace groups (\definecolor{a}{b}{c},
             * \usetikzlibrary{...}, \tikzset{...}) have no `;` - they end after
             * their last group, or they would swallow the statement after them.
             */
            const braced = text.slice(i).match(/^\\(definecolor|usetikzlibrary|tikzset|colorlet|pgfsetlayers|pgfdeclarelayer)\b\s*/);

            if (braced) {
                let at = i + braced[0].length;

                while (text[at] === "{" || text[at] === "[") {
                    at = closeOf(text, at);
                    at += text.slice(at).match(/^\s*/)[0].length;
                }

                if (text[at] === ";") {
                    at++;
                }

                if (braced[1] !== "definecolor") {
                    report(i, "info", `\\${braced[1]} has no effect in DAETUM and was skipped.`);
                }

                i = at;
                continue;
            }

            /* One statement, up to its `;` at depth 0. */
            const end = statementEnd(i, picture.end);
            const statement = text.slice(i, end);
            statements++;

            try {
                if (readStatement(statement.replace(/;\s*$/, ""), i, stack[stack.length - 1], names)) {
                    understood++;
                }
            } catch (error) {
                report(i, "error", `Could not read this statement: ${error.message}`);
            }

            i = end;
        }
    }

    function statementEnd(from, limit) {
        let depth = 0;

        for (let i = from; i < limit; i++) {
            const c = text[i];

            if (c === "\\") {
                i++;
                continue;
            }

            if ("([{".includes(c)) {
                depth++;
            } else if (")]}".includes(c)) {
                depth = Math.max(0, depth - 1);
            } else if (c === ";" && depth === 0) {
                return i + 1;
            }
        }

        return limit;
    }

    function applyFrameOptions(frame, options, index, isPicture) {
        for (const { key, value } of options) {
            if (key === "x" && value) {
                const mm = lengthMm(value, 10);
                if (mm !== null) frame.ux = mm;
            } else if (key === "y" && value) {
                const mm = lengthMm(value, 10);
                if (mm !== null) frame.uy = mm;
            } else if (key === "scale" && value && !isPicture) {
                const s = Number(value);
                if (Number.isFinite(s)) frame.matrix = compose(frame.matrix, { a: s, b: 0, c: 0, d: s, e: 0, f: 0 });
            } else if ((key === "xscale" || key === "yscale") && value && !isPicture) {
                const s = Number(value);
                if (Number.isFinite(s)) frame.matrix = compose(frame.matrix, key === "xscale" ? { ...IDENTITY, a: s } : { ...IDENTITY, d: s });
            } else if (key === "shift" && value) {
                const p = coordinateValue(value.replace(/^\{|\}$/g, "").trim().replace(/^\(([\s\S]*)\)$/, "$1"), { ...frame, matrix: IDENTITY }, null, new Map(), index);
                if (p) frame.matrix = compose(frame.matrix, { ...IDENTITY, e: p.x, f: p.y });
            } else if ((key === "xshift" || key === "yshift") && value) {
                const mm = lengthMm(value, frame[key === "xshift" ? "ux" : "uy"]);
                if (mm !== null) frame.matrix = compose(frame.matrix, key === "xshift" ? { ...IDENTITY, e: mm } : { ...IDENTITY, f: mm });
            } else if (key === "rotate" && value) {
                const r = (Number(value) * Math.PI) / 180;
                if (Number.isFinite(r)) frame.matrix = compose(frame.matrix, { a: Math.cos(r), b: Math.sin(r), c: -Math.sin(r), d: Math.cos(r), e: 0, f: 0 });
            } else if (key === "scale" && isPicture) {
                /* print size only */
            } else {
                Object.assign(frame.style, styleFrom([{ key, value }], index, true));
            }
        }
    }

    /* Style options -> { stroke, fill, lineWidth, lineType, arrows }. */
    function styleFrom(options, index, quiet = false) {
        const style = {};

        for (const { key, value } of options) {
            const k = key.trim();

            if (value === null && arrowHeads(k)) {
                style.arrows = arrowHeads(k);
            } else if ((k === "draw" || k === "color") && value) {
                const c = resolveColour(value, defined);
                if (c) style.stroke = c; else if (!quiet) report(index, "warning", `Unknown colour "${value}"; the default is used.`);
            } else if (k === "fill" && value) {
                const c = resolveColour(value, defined);
                if (c) style.fill = c; else if (!quiet) report(index, "warning", `Unknown fill colour "${value}"; the shape is left unfilled.`);
            } else if (k === "text" && value) {
                const c = resolveColour(value, defined);
                if (c) style.text = c;
            } else if (k === "line width" && value) {
                const mm = lengthMm(value, null);
                if (mm !== null) style.lineWidth = (mm * (72.27 / 25.4)) / PT_PER_LINE_WIDTH;
            } else if (NAMED_WIDTHS_PT[k] !== undefined && value === null) {
                style.lineWidth = NAMED_WIDTHS_PT[k] / PT_PER_LINE_WIDTH;
            } else if (["dashed", "densely dashed", "loosely dashed"].includes(k)) {
                style.lineType = "dashed";
            } else if (["dotted", "densely dotted", "loosely dotted"].includes(k)) {
                style.lineType = "dotted";
            } else if (k === "dash dot" || k === "dash dot dot") {
                style.lineType = "center";
            } else if (k === "dash pattern") {
                style.lineType = "dashed";
            } else if (k === "solid") {
                style.lineType = "solid";
            } else if (value === null && (NAMED_COLOURS[k.toLowerCase()] || defined.has(k) || /^[a-zA-Z]+![\d.]+/.test(k))) {
                const c = resolveColour(k, defined);
                if (c) style.stroke = c;
            } else if (k === "draw" && value === null) {
                style.drawn = true;
            } else if (!COSMETIC.has(k) && !quiet) {
                report(index, "info", `Option "${value === null ? k : `${k}=${value}`}" is not used by DAETUM and was ignored.`);
            }
        }

        return style;
    }

    /* ---------- coordinates ---------- */

    function coordinateValue(inner, frame, current, names, index) {
        const body = inner.trim();

        if (/^\$/.test(body)) {
            throw new Error("coordinate calculations ($...$) are not supported");
        }

        /* polar: angle:radius */
        const polar = body.match(/^([-+]?[\d.]+)\s*:\s*(.+)$/);

        if (polar) {
            const angle = (Number(polar[1]) * Math.PI) / 180;
            const r = lengthMm(polar[2], frame.ux);

            if (r === null) {
                throw new Error(`cannot read the radius "${polar[2]}"`);
            }

            return applyTo(frame.matrix, { x: r * Math.cos(angle), y: r * Math.sin(angle) });
        }

        const parts = splitTop(body);

        if (parts.length === 2) {
            const x = lengthMm(parts[0], frame.ux);
            const y = lengthMm(parts[1], frame.uy);

            if (x === null || y === null) {
                throw new Error(`cannot read the coordinate (${body})`);
            }

            return applyTo(frame.matrix, { x, y });
        }

        /* a named coordinate or node, optionally with an anchor */
        const [name, anchor] = body.split(".");

        if (names.has(name.trim())) {
            if (anchor && !["center", "base"].includes(anchor.trim())) {
                report(index, "info", `Anchor ".${anchor}" of (${name}) is read as its centre.`);
            }

            return { ...names.get(name.trim()) };
        }

        throw new Error(`no coordinate named (${body}) has been defined`);
    }

    /* ---------- statements ---------- */

    function readStatement(statement, index, frame, names) {
        statementIndex = index;
        const head = statement.match(/^\\([a-zA-Z@]+)\s*/);

        if (!head) {
            report(index, "warning", `"${statement.slice(0, 40).trim()}" is not a drawing command and was skipped.`);
            return false;
        }

        const command = head[1];
        let rest = statement.slice(head[0].length);

        if (["definecolor", "usetikzlibrary", "tikzset", "colorlet", "pgfsetlayers", "pgfdeclarelayer"].includes(command)) {
            if (command !== "definecolor") {
                report(index, "info", `\\${command} has no effect in DAETUM and was skipped.`);
            }

            return command === "definecolor";
        }

        if (command === "coordinate") {
            const m = rest.match(/^(?:\[[^\]]*\]\s*)?\(([^)]+)\)\s*at\s*\((.+)\)\s*$/s);

            if (!m) {
                report(index, "error", "\\coordinate needs a name and a position: \\coordinate (A) at (1,2);");
                return false;
            }

            names.set(m[1].trim(), coordinateValue(m[2], frame, null, names, index));
            return true;
        }

        if (command === "node") {
            return readNode(rest, index, frame, names, null);
        }

        if (["draw", "fill", "filldraw", "path"].includes(command)) {
            return readPath(command, rest, index, frame, names);
        }

        const hint = {
            foreach: "loops are not supported; write each command out",
            pic: "pics (library shapes) are not supported",
            def: "macros are not supported",
            newcommand: "macros are not supported",
            shade: "shading is not supported",
            shadedraw: "shading is not supported",
            clip: "clipping is not supported",
            tikz: "use \\draw/\\node inside a tikzpicture instead",
            begin: "only tikzpicture and scope environments are read"
        }[command];

        report(index, "warning", `\\${command} was skipped${hint ? `: ${hint}` : "."}`);
        return false;
    }

    /* \node[opts] (name) at (x,y) {text}  - or inline on a path, at `here`. */
    function readNode(rest, index, frame, names, here) {
        let options = [];
        let name = null;
        let position = here;
        let body = rest.trim();

        for (let guard = 0; guard < 8 && body; guard++) {
            if (body[0] === "[") {
                const end = closeOf(body, 0);
                options = options.concat(parseOptions(body.slice(1, end - 1)));
                body = body.slice(end).trim();
            } else if (body[0] === "(") {
                const end = closeOf(body, 0);
                name = body.slice(1, end - 1).trim();
                body = body.slice(end).trim();
            } else if (/^at\s*\(/.test(body)) {
                const open = body.indexOf("(");
                const end = closeOf(body, open);
                position = coordinateValue(body.slice(open + 1, end - 1), frame, here, names, index);
                body = body.slice(end).trim();
            } else {
                break;
            }
        }

        if (body[0] !== "{") {
            report(index, "error", "A node needs its text in braces: \\node at (1,2) {text};");
            return false;
        }

        const label = plainText(body.slice(1, closeOf(body, 0) - 1));
        position = position || applyTo(frame.matrix, { x: 0, y: 0 });

        if (name) {
            names.set(name, { ...position });
        }

        const shaped = options.some(o => ["circle", "rectangle", "draw", "ellipse", "shape"].includes(o.key));

        if (shaped) {
            report(index, "info", "The node's shape outline is not drawn; its text is placed as a note.");
        }

        styleFrom(options.filter(o => !["circle", "rectangle", "ellipse", "shape"].includes(o.key)), index);

        if (!label) {
            return Boolean(name);
        }

        features.push(enggAnnotate.createAnnotate({ kind: "note", position, text: label }));
        return true;
    }

    function readPath(command, rest, index, frame, names) {
        let body = rest.trim();
        let options = [];

        while (body[0] === "[") {
            const end = closeOf(body, 0);
            options = options.concat(parseOptions(body.slice(1, end - 1)));
            body = body.slice(end).trim();
        }

        const style = { ...frame.style, ...styleFrom(options, index) };
        const drawn = command !== "path" || style.drawn || style.stroke || style.fill;
        const filled = command === "fill" || command === "filldraw" || Boolean(style.fill && style.fill !== "none");
        const stroked = command !== "fill";

        /* The DAETUM style of everything this path produces. */
        const featureStyle = {};

        if (style.stroke) featureStyle.stroke = style.stroke;
        if (Number.isFinite(style.lineWidth)) featureStyle.lineWidth = Number(style.lineWidth.toFixed(3));
        if (style.lineType) featureStyle.lineType = style.lineType;
        if (filled) featureStyle.fill = style.fill || style.stroke || "#000000";
        if (!stroked && command === "fill") featureStyle.stroke = featureStyle.fill;

        const made = [];
        let chain = [];
        let closed = false;
        let current = null;
        let connector = null;

        const finishChain = () => {
            if (chain.length >= 2) {
                made.push(chainFeature(chain, closed, style, featureStyle));
            } else if (chain.length === 1 && drawn && command !== "path" && !made.length && !connector) {
                /* a lone coordinate draws nothing */
            }

            chain = [];
            closed = false;
        };

        let i = 0;

        while (i < body.length) {
            const ws = body.slice(i).match(/^\s+/);

            if (ws) {
                i += ws[0].length;
                continue;
            }

            const at = body.slice(i);

            /* coordinates, absolute or relative */
            const relative = at.match(/^(\+\+?)\s*\(/);

            if (at[0] === "(" || relative) {
                const open = i + (relative ? relative[0].length - 1 : 0);
                const end = closeOf(body, open);
                let point = coordinateValue(body.slice(open + 1, end - 1), frame, current, names, index);

                if (relative) {
                    const origin = applyTo(frame.matrix, { x: 0, y: 0 });
                    point = { x: (current?.x || 0) + point.x - origin.x, y: (current?.y || 0) + point.y - origin.y };
                }

                if (connector === "rectangle" && current) {
                    finishChain();
                    made.push(rectangleFeature(current, point, featureStyle));
                } else if (connector === "-|" && current) {
                    chain.push({ x: point.x, y: current.y }, point);
                } else if (connector === "|-" && current) {
                    chain.push({ x: current.x, y: point.y }, point);
                } else if (connector) {
                    if (!chain.length && current) chain.push(current);
                    chain.push(point);
                } else {
                    finishChain();
                    chain = [point];
                }

                if (relative?.[1] !== "+") {
                    current = point;
                }

                connector = null;
                i = end;
                continue;
            }

            const word = at.match(/^(--|-\||\|-|\.\.|to\b|rectangle\b|circle\b|ellipse\b|arc\b|cycle\b|node\b|coordinate\b|grid\b|controls\b|and\b|plot\b|parabola\b|sin\b|cos\b)/);

            if (!word) {
                report(index, "warning", `"${at.slice(0, 24).trim()}" in this path was not understood; the rest of the path was skipped.`);
                break;
            }

            const op = word[1];
            i += op.length;
            let afterOp = body.slice(i).match(/^\s*/)[0].length;

            if (op === "--" || op === "to") {
                connector = "--";

                if (op === "to" && body[i + afterOp] === "[") {
                    i = closeOf(body, i + afterOp);
                }
            } else if (op === "-|" || op === "|-") {
                connector = op;
            } else if (op === "rectangle") {
                connector = "rectangle";
            } else if (op === "cycle") {
                if (chain.length >= 3) {
                    closed = true;
                    finishChain();
                } else if (chain.length === 2) {
                    finishChain();
                }

                current = chain[0] || current;
                connector = null;
            } else if (op === "circle" || op === "ellipse") {
                let rx = null;
                let ry = null;
                const next = body[i + afterOp];

                if (next === "[") {
                    const end = closeOf(body, i + afterOp);
                    const o = Object.fromEntries(parseOptions(body.slice(i + afterOp + 1, end - 1)).map(p => [p.key, p.value]));
                    rx = lengthMm(o.radius ?? o["x radius"] ?? "", frame.ux);
                    ry = lengthMm(o.radius ?? o["y radius"] ?? "", frame.uy);
                    i = end;
                } else if (next === "(") {
                    const end = closeOf(body, i + afterOp);
                    const inner = body.slice(i + afterOp + 1, end - 1);
                    const [a, b] = inner.split(/\s+and\s+/);
                    rx = lengthMm(a, frame.ux);
                    ry = lengthMm(b ?? a, frame.uy);
                    i = end;
                }

                if (!current || rx === null || ry === null) {
                    report(index, "error", `A ${op} needs a centre and a radius: (0,0) circle[radius=1].`);
                    break;
                }

                finishChain();
                const scaleX = Math.hypot(frame.matrix.a, frame.matrix.b);
                const scaleY = Math.hypot(frame.matrix.c, frame.matrix.d);

                if (Math.abs(rx * scaleX - ry * scaleY) < 1e-9) {
                    made.push(factories.circle({ ...current }, rx * scaleX, { style: { ...featureStyle } }));
                } else {
                    report(index, "info", "DAETUM has no ellipse; it is drawn as a closed polyline.");
                    const points = Array.from({ length: 48 }, (_, k) => {
                        const t = (k / 48) * 2 * Math.PI;
                        return { x: current.x + rx * scaleX * Math.cos(t), y: current.y + ry * scaleY * Math.sin(t) };
                    });
                    made.push(chainFeature(points, true, {}, featureStyle));
                }

                connector = null;
            } else if (op === "arc") {
                let a = null;
                let b = null;
                let r = null;
                const next = body[i + afterOp];

                if (next === "[") {
                    const end = closeOf(body, i + afterOp);
                    const o = Object.fromEntries(parseOptions(body.slice(i + afterOp + 1, end - 1)).map(p => [p.key, p.value]));
                    a = Number(o["start angle"]);
                    b = o["end angle"] !== undefined ? Number(o["end angle"]) : a + Number(o["delta angle"]);
                    r = lengthMm(o.radius ?? o["x radius"] ?? "", frame.ux);
                    i = end;
                } else if (next === "(") {
                    const end = closeOf(body, i + afterOp);
                    const [s, e, rad] = body.slice(i + afterOp + 1, end - 1).split(":");
                    a = Number(s);
                    b = Number(e);
                    r = lengthMm(rad ?? "", frame.ux);
                    i = end;
                }

                if (!current || !Number.isFinite(a) || !Number.isFinite(b) || r === null) {
                    report(index, "error", "An arc needs a start point, angles and a radius: (1,0) arc[start angle=0, end angle=90, radius=1].");
                    break;
                }

                finishChain();
                const rotation = Math.atan2(frame.matrix.b, frame.matrix.a);
                const scaled = r * Math.hypot(frame.matrix.a, frame.matrix.b);
                const start = (a * Math.PI) / 180 + rotation;
                const end = (b * Math.PI) / 180 + rotation;
                const centre = { x: current.x - scaled * Math.cos(start), y: current.y - scaled * Math.sin(start) };
                made.push(factories.arc(centre, scaled, start, end, { style: { ...featureStyle } }));
                current = { x: centre.x + scaled * Math.cos(end), y: centre.y + scaled * Math.sin(end) };
                chain = [current];
                connector = null;
            } else if (op === "node") {
                let end = i;
                let depth = 0;

                /* the node's own options, name, `at`, and its {text} */
                for (; end < body.length; end++) {
                    const c = body[end];
                    if ("([".includes(c)) depth++;
                    else if (")]".includes(c)) depth--;
                    else if (c === "{" && depth === 0) {
                        end = closeOf(body, end);
                        break;
                    }
                }

                readNode(body.slice(i, end), index, frame, names, current);
                i = end;
            } else if (op === "coordinate") {
                const m = body.slice(i).match(/^\s*(?:\[[^\]]*\]\s*)?\(([^)]+)\)/);

                if (m && current) {
                    names.set(m[1].trim(), { ...current });
                    i += m[0].length;
                }
            } else if (op === "..") {
                /* a curve: ..controls (a) and (b).. (c) - drawn straight to (c) */
                const close = body.indexOf("..", i);

                if (close < 0) {
                    report(index, "error", "An unfinished curve (..controls ..).");
                    break;
                }

                report(index, "info", "Curves (..controls..) are drawn as straight segments.");
                i = close + 2;
                connector = "--";
            } else {
                report(index, "warning", `"${op}" paths are not supported; the rest of this path was skipped.`);
                break;
            }
        }

        finishChain();

        if (!drawn) {
            return made.length === 0;
        }

        features.push(...made);
        return made.length > 0 || body.includes("node");
    }

    /* A connected run of points -> the DAETUM feature that best says what it is. */
    function chainFeature(points, closed, style, featureStyle) {
        const options = { style: { ...featureStyle } };
        const clean = points.filter((p, k) => k === 0 || Math.hypot(p.x - points[k - 1].x, p.y - points[k - 1].y) > 1e-9);

        if (closed) {
            const ring = clean.length > 3 && Math.hypot(clean[0].x - clean.at(-1).x, clean[0].y - clean.at(-1).y) < 1e-9
                ? clean.slice(0, -1)
                : clean;

            if (ring.length === 3) {
                return factories.triangle(ring.map(p => ({ ...p })), options);
            }

            if (ring.length === 4 && isAxisRectangle(ring)) {
                const xs = ring.map(p => p.x);
                const ys = ring.map(p => p.y);
                return rectangleFeature({ x: Math.min(...xs), y: Math.min(...ys) }, { x: Math.max(...xs), y: Math.max(...ys) }, featureStyle);
            }

            return factories.polyline([...ring, ring[0]].map(p => ({ ...p })), options);
        }

        if (clean.length === 2) {
            const heads = style.arrows;

            if (heads && (heads.start || heads.end)) {
                /* An arrow's head is at its `end`. */
                const [from, to] = heads.end ? clean : [clean[1], clean[0]];

                if (heads.start && heads.end) {
                    report(statementIndex, "info", "A double-headed arrow is drawn with one head.");
                }

                const arrow = enggAnnotate.createAnnotate({ kind: "arrow", start: { ...from }, end: { ...to } });
                arrow.style = { ...(arrow.style || {}), ...featureStyle };
                return arrow;
            }

            return factories.line({ ...clean[0] }, { ...clean[1] }, options);
        }

        return factories.polyline(clean.map(p => ({ ...p })), options);
    }

    function isAxisRectangle(ring) {
        for (let k = 0; k < 4; k++) {
            const p = ring[k];
            const q = ring[(k + 1) % 4];

            if (Math.abs(p.x - q.x) > 1e-9 && Math.abs(p.y - q.y) > 1e-9) {
                return false;
            }
        }

        return true;
    }

    function rectangleFeature(a, b, featureStyle) {
        const minX = Math.min(a.x, b.x);
        const maxY = Math.max(a.y, b.y);
        return factories.rectangle({ x: minX, y: maxY }, Math.abs(b.x - a.x), Math.abs(b.y - a.y), 0, { style: { ...featureStyle } });
    }
}

export default { readLatexDrawing, plainText };
