/*
 * ============================================================
 * THE DRAWN SHEET, AS LaTeX DRAWING COMMANDS
 * ============================================================
 *
 * The renderer draws every feature with nine SVG building blocks (line,
 * polyline, polygon, rect, circle, path, text, tspan, g), each feature in its
 * own <g data-feature-id>. This module turns that SVG into the standard
 * TikZ-style drawing commands a LaTeX picture is written in - so the picture
 * in the .tex is exactly the picture on the canvas, for every feature type,
 * without a second implementation of how anything looks.
 *
 * DAETUM's own engine: nothing here runs TeX. It only writes text.
 *
 * Coordinates are written in DRAWING UNITS (the numbers stored in the
 * document), with y pointing up, through `toWorld`, which inverts the camera
 * the export rendered with. Sizes the renderer gives in screen pixels - line
 * widths, dash patterns, font sizes - are written in points through
 * `ptPerPx`, so they keep their proportion to the drawing.
 */

/* ---------- numbers and colours ---------- */

/* A coordinate: two decimals, no trailing zeros, never "-0". */
export function num(value, digits = 2) {
    const rounded = Number(Number(value).toFixed(digits));
    return Object.is(rounded, -0) ? "0" : String(rounded);
}

const NAMED_COLOURS = { "000000": "black", ffffff: "white" };

/*
 * Colours seen in a picture, given short names so the code reads
 * `draw=c1` rather than repeating hex. Black and white keep their own names.
 */
export function createPalette() {
    const names = new Map();

    return {
        name(value) {
            const hex = normaliseHex(value);

            if (!hex) {
                return null;
            }

            if (NAMED_COLOURS[hex]) {
                return NAMED_COLOURS[hex];
            }

            if (!names.has(hex)) {
                names.set(hex, `daetum${names.size + 1}`);
            }

            return names.get(hex);
        },

        /* `\definecolor` lines for every colour named so far. */
        definitions() {
            return [...names].map(([hex, name]) => `\\definecolor{${name}}{HTML}{${hex.toUpperCase()}}`);
        }
    };
}

function normaliseHex(value) {
    if (!value || value === "none" || value === "transparent") {
        return null;
    }

    const text = String(value).trim().toLowerCase();
    const short = text.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);

    if (short) {
        return short.slice(1).map(c => c + c).join("");
    }

    const long = text.match(/^#([0-9a-f]{6})$/);

    if (long) {
        return long[1];
    }

    const rgb = text.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);

    if (rgb) {
        return rgb.slice(1, 4).map(n => Number(n).toString(16).padStart(2, "0")).join("");
    }

    return null;
}

/* ---------- text ---------- */

/*
 * Characters LaTeX treats as commands, and the symbols engineering labels use,
 * written so pdflatex compiles them without extra packages.
 */
const LATEX_SYMBOLS = {
    "\\": "\\textbackslash{}",
    "{": "\\{",
    "}": "\\}",
    "$": "\\$",
    "&": "\\&",
    "#": "\\#",
    "%": "\\%",
    "_": "\\_",
    "^": "\\^{}",
    "~": "\\~{}",
    "°": "$^{\\circ}$",
    "²": "$^{2}$",
    "³": "$^{3}$",
    "·": "$\\cdot$",
    "×": "$\\times$",
    "−": "$-$",
    "±": "$\\pm$",
    "≈": "$\\approx$",
    "≤": "$\\leq$",
    "≥": "$\\geq$",
    "→": "$\\rightarrow$",
    "←": "$\\leftarrow$",
    "∞": "$\\infty$",
    "√": "$\\surd$",
    "Δ": "$\\Delta$",
    "Σ": "$\\Sigma$",
    "Ω": "$\\Omega$",
    "Φ": "$\\Phi$",
    "α": "$\\alpha$",
    "β": "$\\beta$",
    "γ": "$\\gamma$",
    "δ": "$\\delta$",
    "ε": "$\\varepsilon$",
    "θ": "$\\theta$",
    "λ": "$\\lambda$",
    "μ": "$\\mu$",
    "ν": "$\\nu$",
    "π": "$\\pi$",
    "ρ": "$\\rho$",
    "σ": "$\\sigma$",
    "τ": "$\\tau$",
    "φ": "$\\phi$",
    "ω": "$\\omega$",
    "µ": "$\\mu$",
    "∫": "$\\int$",
    "–": "--",
    "—": "---",
    "Ø": "\\O{}",
    "ø": "\\o{}",
    /* The Annotate symbol library (GD&T, welds, centre marks): standard
       LaTeX and amssymb symbols, the closest match to each glyph. */
    "⌖": "$\\oplus$",
    "⏥": "$\\lozenge$",
    "∥": "$\\parallel$",
    "⊥": "$\\perp$",
    "◎": "$\\circledcirc$",
    "⏓": "$\\surd$",
    "▷": "$\\triangleright$",
    "⊻": "$\\veebar$",
    "℄": "\\textsf{CL}",
    "⊕": "$\\oplus$",
    "Ⓐ": "\\textcircled{A}",
    "▭": "$\\square$",
    "□": "$\\square$",
    "⌴": "$\\sqcup$",
    "⌵": "$\\vee$"
};

/*
 * Characters beyond Latin-1 that `latexText` has no mapping for. They are
 * kept in the text as written (so the file still says what it said), and the
 * document declares each one so pdflatex can typeset it.
 */
export function unmappedCharacters(text) {
    return [...new Set([...String(text)].filter(c => c.codePointAt(0) > 0xff && !LATEX_SYMBOLS[c]))];
}

export function latexText(text) {
    return [...String(text)].map(c => LATEX_SYMBOLS[c] ?? c).join("");
}

/* ---------- transforms ---------- */

/* A 2D affine matrix [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f. */
const IDENTITY = [1, 0, 0, 1, 0, 0];

function multiply(m, n) {
    return [
        m[0] * n[0] + m[2] * n[1],
        m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3],
        m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4],
        m[1] * n[4] + m[3] * n[5] + m[5]
    ];
}

/* The SVG transform list the renderer uses: translate, rotate (with or without a centre), scale, matrix. */
export function parseTransform(text) {
    let matrix = IDENTITY;

    for (const [, op, args] of String(text || "").matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
        const v = args.split(/[\s,]+/).filter(Boolean).map(Number);
        let step = IDENTITY;

        if (op === "translate") {
            step = [1, 0, 0, 1, v[0] || 0, v[1] || 0];
        } else if (op === "scale") {
            step = [v[0], 0, 0, v[1] ?? v[0], 0, 0];
        } else if (op === "rotate") {
            const r = (v[0] * Math.PI) / 180;
            const cos = Math.cos(r);
            const sin = Math.sin(r);
            step = [cos, sin, -sin, cos, 0, 0];

            if (v.length >= 3) {
                step = multiply(multiply([1, 0, 0, 1, v[1], v[2]], step), [1, 0, 0, 1, -v[1], -v[2]]);
            }
        } else if (op === "matrix" && v.length === 6) {
            step = v;
        }

        matrix = multiply(matrix, step);
    }

    return matrix;
}

function apply(m, x, y) {
    return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/* ---------- styles ---------- */

function attr(element, name, fallback = null) {
    const value = element.getAttribute(name);
    return value === null || value === "" ? fallback : value;
}

/*
 * The drawing options for one element, and whether it draws, fills, or both.
 * SVG defaults apply: fill is black unless stated, stroke is none.
 */
function styleOf(element, context, { closed }) {
    const opacity = Number(attr(element, "opacity", 1));
    const stroke = context.palette.name(attr(element, "stroke", "none"));
    const fill = closed ? context.palette.name(attr(element, "fill", "#000000")) : null;
    const options = [];

    if (stroke) {
        options.push(`draw=${stroke}`);
        const width = Number(attr(element, "stroke-width", 1));
        options.push(`line width=${num(width * context.ptPerPx, 3)}pt`);

        const dashes = attr(element, "stroke-dasharray");

        if (dashes && dashes !== "none") {
            const parts = dashes.split(/[\s,]+/).map(Number).filter(Number.isFinite);

            if (parts.length) {
                const pattern = (parts.length % 2 ? [...parts, ...parts] : parts)
                    .map((length, i) => `${i % 2 ? "off" : "on"} ${num(length * context.ptPerPx, 2)}pt`)
                    .join(" ");
                options.push(`dash pattern=${pattern}`);
            }
        }

        const cap = attr(element, "stroke-linecap");

        if (cap === "round" || cap === "rect") {
            options.push(`line cap=${cap}`);
        } else if (cap === "square") {
            options.push("line cap=rect");
        }

        const join = attr(element, "stroke-linejoin");

        if (join === "round" || join === "bevel") {
            options.push(`line join=${join}`);
        }

        const strokeOpacity = Number(attr(element, "stroke-opacity", 1)) * opacity;

        if (strokeOpacity < 1) {
            options.push(`draw opacity=${num(strokeOpacity, 3)}`);
        }
    }

    if (fill) {
        options.push(`fill=${fill}`);
        const fillOpacity = Number(attr(element, "fill-opacity", 1)) * opacity;

        if (fillOpacity < 1) {
            options.push(`fill opacity=${num(fillOpacity, 3)}`);
        }
    }

    return { stroke, fill, options, visible: (stroke || fill) && opacity > 0 };
}

function command(style) {
    if (style.stroke) {
        return `\\draw[${style.options.join(", ")}]`;
    }

    return `\\fill[${style.options.join(", ")}]`;
}

/* ---------- elements ---------- */

function point(context, matrix, x, y) {
    const screen = apply(matrix, Number(x) || 0, Number(y) || 0);
    const world = context.toWorld(screen.x, screen.y);
    return `(${num(world.x)},${num(world.y)})`;
}

function pointList(text) {
    const values = String(text || "").trim().split(/[\s,]+/).map(Number);
    const points = [];

    for (let i = 0; i + 1 < values.length; i += 2) {
        points.push([values[i], values[i + 1]]);
    }

    return points;
}

/*
 * SVG's elliptical arc (endpoint form) to its centre form, so it can be
 * written as an `arc` with start and end angles. Returns null for a
 * degenerate arc, which is then drawn as a straight segment.
 */
function arcCentre(x1, y1, rx, ry, phiDeg, largeArc, sweep, x2, y2) {
    if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) {
        return null;
    }

    const phi = (phiDeg * Math.PI) / 180;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    const dx = (x1 - x2) / 2;
    const dy = (y1 - y2) / 2;
    const x1p = cos * dx + sin * dy;
    const y1p = -sin * dx + cos * dy;
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);

    if (lambda > 1) {
        rx *= Math.sqrt(lambda);
        ry *= Math.sqrt(lambda);
    }

    const sign = largeArc === sweep ? -1 : 1;
    const numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    const factor = sign * Math.sqrt(Math.max(0, numerator / denominator));
    const cxp = (factor * rx * y1p) / ry;
    const cyp = (-factor * ry * x1p) / rx;
    const angle = (ux, uy, vx, vy) => {
        const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
        return a;
    };
    const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);

    if (!sweep && delta > 0) {
        delta -= 2 * Math.PI;
    } else if (sweep && delta < 0) {
        delta += 2 * Math.PI;
    }

    return {
        cx: cos * cxp - sin * cyp + (x1 + x2) / 2,
        cy: sin * cxp + cos * cyp + (y1 + y2) / 2,
        rx,
        ry,
        theta1,
        delta
    };
}

/*
 * A path's `d` as drawing segments. Absolute M, L, H, V, A, Z are what the
 * renderer writes; relative forms are accepted too. An arc becomes a TikZ
 * `arc`, measured in drawing space (y up), so its angles read naturally.
 */
function pathSegments(context, matrix, d) {
    const tokens = String(d || "").match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
    const parts = [];
    let i = 0;
    let command = null;
    let cx = 0;
    let cy = 0;
    let sx = 0;
    let sy = 0;
    const read = () => Number(tokens[i++]);
    const isNumber = () => i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i]);
    const unitsPerPx = context.unitsPerPx;
    const rotation = Math.atan2(matrix[1], matrix[0]);
    const scaleFactor = Math.hypot(matrix[0], matrix[1]);

    while (i < tokens.length) {
        if (/^[a-zA-Z]$/.test(tokens[i])) {
            command = tokens[i++];
        }

        const relative = command === command.toLowerCase();
        const upper = command.toUpperCase();

        if (upper === "Z") {
            parts.push("-- cycle");
            cx = sx;
            cy = sy;
            command = null;

            if (isNumber()) {
                command = "L";
            }

            continue;
        }

        if (!isNumber()) {
            i++;
            continue;
        }

        if (upper === "M" || upper === "L") {
            const x = read() + (relative ? cx : 0);
            const y = read() + (relative ? cy : 0);
            parts.push(`${upper === "M" ? "" : "-- "}${point(context, matrix, x, y)}`);
            cx = x;
            cy = y;

            if (upper === "M") {
                sx = x;
                sy = y;
                command = relative ? "l" : "L";
            }
        } else if (upper === "H") {
            cx = read() + (relative ? cx : 0);
            parts.push(`-- ${point(context, matrix, cx, cy)}`);
        } else if (upper === "V") {
            cy = read() + (relative ? cy : 0);
            parts.push(`-- ${point(context, matrix, cx, cy)}`);
        } else if (upper === "A") {
            const rx = read();
            const ry = read();
            const phi = read();
            const large = read();
            const sweep = read();
            const x = read() + (relative ? cx : 0);
            const y = read() + (relative ? cy : 0);
            const centre = arcCentre(cx, cy, rx, ry, phi, large, sweep, x, y);

            if (!centre || Math.abs(phi) > 1e-9) {
                parts.push(`-- ${point(context, matrix, x, y)}`);
            } else {
                /* Screen angles (y down) become drawing angles (y up) by negation. */
                const start = (-(centre.theta1 + rotation) * 180) / Math.PI;
                const end = start - (centre.delta * 180) / Math.PI;
                const xr = centre.rx * scaleFactor * unitsPerPx;
                const yr = centre.ry * scaleFactor * unitsPerPx;
                parts.push(
                    Math.abs(xr - yr) < 1e-6
                        ? `arc[start angle=${num(start)}, end angle=${num(end)}, radius=${num(xr)}]`
                        : `arc[start angle=${num(start)}, end angle=${num(end)}, x radius=${num(xr)}, y radius=${num(yr)}]`
                );
            }

            cx = x;
            cy = y;
        } else {
            /* A command the renderer does not use (curves): keep the end point. */
            const counts = { C: 6, S: 4, Q: 4, T: 2 };
            const n = counts[upper] || 2;
            const values = Array.from({ length: n }, read);
            const x = values[n - 2] + (relative ? cx : 0);
            const y = values[n - 1] + (relative ? cy : 0);
            parts.push(`-- ${point(context, matrix, x, y)}`);
            cx = x;
            cy = y;
        }
    }

    return parts;
}

/* The text of a <text>, one entry per <tspan> line (or the whole text). */
function textLines(element) {
    const spans = [...element.children].filter(c => c.tagName.toLowerCase() === "tspan");

    if (!spans.length) {
        return [element.textContent];
    }

    return spans.map(span => span.textContent);
}

const ANCHORS = {
    start: { "": "base west", middle: "west", central: "west", hanging: "north west" },
    middle: { "": "base", middle: "center", central: "center", hanging: "north" },
    end: { "": "base east", middle: "east", central: "east", hanging: "north east" }
};

function textCommand(element, context, matrix) {
    const lines = textLines(element).map(line => line.trim()).filter(Boolean);

    if (!lines.length) {
        return null;
    }

    const own = parseTransform(attr(element, "transform"));
    const m = multiply(matrix, own);
    const fill = context.palette.name(attr(element, "fill", "#000000"));

    if (!fill || Number(attr(element, "opacity", 1)) === 0) {
        return null;
    }

    const size = Number(attr(element, "font-size", 16)) * Math.hypot(m[0], m[1]) * context.ptPerPx;
    const weight = attr(element, "font-weight", "normal");
    const bold = weight === "bold" || Number(weight) >= 600;
    const anchorKey = attr(element, "text-anchor", "start");
    const baselineKey = attr(element, "dominant-baseline", "");
    const anchor = (ANCHORS[anchorKey] || ANCHORS.start)[baselineKey] || (ANCHORS[anchorKey] || ANCHORS.start)[""];
    const rotation = (-Math.atan2(m[1], m[0]) * 180) / Math.PI;
    const options = [
        `anchor=${anchor}`,
        `inner sep=0pt`,
        `text=${fill}`,
        `font=\\fontsize{${num(size, 1)}}{${num(size * 1.2, 1)}}\\selectfont${bold ? "\\bfseries" : ""}`
    ];

    if (Math.abs(rotation) > 0.01) {
        options.push(`rotate=${num(rotation)}`);
    }

    const fillOpacity = Number(attr(element, "fill-opacity", 1)) * Number(attr(element, "opacity", 1));

    if (fillOpacity < 1) {
        options.push(`text opacity=${num(fillOpacity, 3)}`);
    }

    if (lines.length > 1) {
        options.push("align=center");
    }

    const at = point(context, m, attr(element, "x", 0), attr(element, "y", 0));
    return `\\node[${options.join(", ")}] at ${at} {${lines.map(latexText).join(" \\\\ ")}};`;
}

function shapeCommand(element, context, matrix) {
    const tag = element.tagName.toLowerCase();

    if (tag === "line") {
        const style = styleOf(element, context, { closed: false });

        if (!style.stroke) {
            return null;
        }

        return `${command(style)} ${point(context, matrix, attr(element, "x1", 0), attr(element, "y1", 0))} -- ${point(context, matrix, attr(element, "x2", 0), attr(element, "y2", 0))};`;
    }

    if (tag === "polyline" || tag === "polygon") {
        const closed = tag === "polygon";
        const style = styleOf(element, context, { closed });
        const points = pointList(attr(element, "points"));

        if (!style.visible || points.length < 2) {
            return null;
        }

        return `${command(style)} ${points.map(([x, y]) => point(context, matrix, x, y)).join(" -- ")}${closed ? " -- cycle" : ""};`;
    }

    if (tag === "rect") {
        const style = styleOf(element, context, { closed: true });
        const x = Number(attr(element, "x", 0));
        const y = Number(attr(element, "y", 0));
        const w = Number(attr(element, "width", 0));
        const h = Number(attr(element, "height", 0));

        if (!style.visible || !(w > 0) || !(h > 0)) {
            return null;
        }

        return `${command(style)} ${[[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => point(context, matrix, px, py)).join(" -- ")} -- cycle;`;
    }

    if (tag === "circle") {
        const style = styleOf(element, context, { closed: true });
        const r = Number(attr(element, "r", 0)) * Math.hypot(matrix[0], matrix[1]) * context.unitsPerPx;

        if (!style.visible || !(r > 0)) {
            return null;
        }

        /*
         * THE RADIUS IS STATED IN MILLIMETRES.
         *
         * A bare number in this picture's coordinate space is multiplied by the
         * picture's `scale=` - so `circle[radius=40]` in a sheet printed at
         * `scale=0.354` is a circle of 14.2 drawing units, not 40. The radius is
         * a MEASUREMENT, already in drawing units (millimetres), so it is
         * written with its unit and cannot be scaled a second time.
         */
        return `${command(style)} ${point(context, matrix, attr(element, "cx", 0), attr(element, "cy", 0))} circle[radius=${num(r)}mm];`;
    }

    if (tag === "path") {
        const d = attr(element, "d", "");
        const closed = /z/i.test(d);
        const style = styleOf(element, context, { closed: closed || attr(element, "fill", "none") !== "none" });
        const parts = pathSegments(context, matrix, d);

        if (!style.visible || parts.length < 2) {
            return null;
        }

        return `${command(style)} ${parts.join(" ")};`;
    }

    if (tag === "text") {
        return textCommand(element, context, matrix);
    }

    return null;
}

/* Every drawing command under an element, in document (painting) order. */
function walk(element, context, matrix, out) {
    for (const child of element.children) {
        const tag = child.tagName.toLowerCase();

        if (tag === "g" || tag === "svg") {
            if (attr(child, "display") === "none" || attr(child, "visibility") === "hidden") {
                continue;
            }

            walk(child, context, multiply(matrix, parseTransform(attr(child, "transform"))), out);
            continue;
        }

        if (tag === "defs" || tag === "title" || tag === "desc" || tag === "style") {
            continue;
        }

        const line = shapeCommand(child, context, matrix);

        if (line) {
            out.push(line);
        }
    }

    return out;
}

/*
 * Convert one rendered sheet.
 *
 *   context = {
 *       toWorld(px, py) -> { x, y }   screen pixels to drawing units (y up)
 *       unitsPerPx                    drawing units per screen pixel
 *       ptPerPx                       printed points per screen pixel
 *       palette                       from createPalette()
 *   }
 *
 * Returns the commands grouped by feature, in painting order:
 *   [{ featureId, commands: [...] }, ...]   (featureId null for anything
 *   drawn outside a feature group)
 */
export function svgToTikz(svg, context) {
    const groups = [];

    for (const child of svg.children) {
        const featureId = child.getAttribute("data-feature-id") || null;
        const matrix = parseTransform(attr(child, "transform"));
        const commands = child.tagName.toLowerCase() === "g"
            ? walk(child, context, matrix, [])
            : [shapeCommand(child, context, IDENTITY)].filter(Boolean);

        if (!commands.length) {
            continue;
        }

        const last = groups[groups.length - 1];

        if (last && last.featureId === featureId) {
            last.commands.push(...commands);
        } else {
            groups.push({ featureId, commands });
        }
    }

    return groups;
}
