/*
 * ============================================================
 * SHARED STATICS SOURCE PRIMITIVES
 * ============================================================
 *
 * The vocabulary every Statics serializer writes in: numbers, coordinates,
 * colours and styles, text, the load profile, and the text nodes an object
 * owns. It sits BETWEEN the generic TikZ primitives (one path, one node) and
 * the per-type serializers, so a support, a load and a moment cannot end up
 * spelling the same stroke style three slightly different ways.
 *
 * PURE, ALWAYS. Every function here is a function of its arguments: no module
 * state, no canvas, no document. That is what lets the generator be tested
 * without a browser, and what makes "the same object produces the same code"
 * a property rather than a hope.
 *
 * THE CANVAS IS THE REFERENCE. Where a drawn size is needed - how long a load's
 * arrows are, where an arrowhead lands, which side of a body a load's lines
 * stand off - the rule is the one the canvas renderer uses, restated here in
 * drawing units. A second opinion about how long a statics arrow is would put
 * the code and the picture at different scales.
 */

import { resolveLineWidth } from "../../../../tool-library/shared/primitives/tikz-primitives.js";

/* ============================================================
 * NUMBERS AND COORDINATES
 * ============================================================ */

export function num(value, precision = 4) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return "0";
    }

    const rounded = Number(number.toFixed(precision));

    return String(Object.is(rounded, -0) ? 0 : rounded);
}

export function point(x, y) {
    return `(${num(x)},${num(y)})`;
}

/* ============================================================
 * COLOURS
 * ============================================================
 *
 * DAETUM styles carry either a named xcolor colour ("black") or a CSS hex
 * string ("#193335"). TikZ does not accept hex, so a hex is written as a
 * `\definecolor` with a name derived FROM THE HEX - which means two objects of
 * the same colour share one definition, and the same colour always gets the
 * same name wherever it appears.
 */
export const BLACK_HEX = "193335";
export function normaliseHex(value) {
    const text = String(value ?? "").trim();

    if (!text || /^none$/i.test(text) || /^transparent$/i.test(text)) {
        return null;
    }

    const short = text.match(/^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/);

    if (short) {
        return short
            .slice(1)
            .map((character) => character + character)
            .join("")
            .toUpperCase();
    }

    const long = text.match(/^#([0-9a-fA-F]{6})$/);

    return long ? long[1].toUpperCase() : null;
}

export function colourName(value) {
    const text = String(value ?? "").trim();

    if (!text || /^none$/i.test(text) || /^transparent$/i.test(text)) {
        return null;
    }

    const hex = normaliseHex(text);

    if (!hex) {
        return text;
    }

    if (hex === "000000") {
        return "black";
    }

    if (hex === "FFFFFF") {
        return "white";
    }

    return `daetumC${hex}`;
}

/*
 * A `\definecolor` line for one hex colour.
 *
 * THE RGB MODEL, NOT HTML. DAETUM's renderer (TikZJax) loads xcolor without
 * the `x11names`/`svgnames` families, and with a bare xcolor its HTML model is
 * not available - so `{HTML}` compiles in a full TeX Live installation and
 * fails in the renderer the Source tab actually uses. `{RGB}` is a CORE model
 * of xcolor, so one spelling works in both. The channels are the R, G and B
 * of the same hex value, so the colour is the one the canvas shows.
 */
export function colourDefinition(name, hex) {
    const digits = normaliseHex(`#${hex}`);

    if (!digits) {
        return null;
    }

    const channels = [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16));

    return `\\definecolor{${name}}{RGB}{${channels.join(",")}}`;
}

export function colourDefinitions(values) {
    const seen = new Map();

    (Array.isArray(values) ? values : []).forEach((value) => {
        const hex = normaliseHex(value);

        if (hex && hex !== "000000" && hex !== "FFFFFF") {
            seen.set(`daetumC${hex}`, hex);
        }
    });

    return [...seen].map(([name, hex]) => colourDefinition(name, hex)).filter(Boolean);
}

/*
 * The colour of a feature, in the order the canvas reads it: the explicit
 * stroke, then the theme's default line colour, then black. A fill that is
 * `none` never becomes a colour.
 */
export function colourOf(style, key = "stroke") {
    const value = style?.[key];

    if (key === "fill") {
        if (String(style?.fillMode ?? "").toLowerCase() !== "solid") {
            return null;
        }

        const fill = colourName(value && value !== "none" ? value : style?.stroke);

        return fill || "black";
    }

    return colourName(value) || colourName(globalThis.enggTheme?.defaultLineColour?.()) || "black";
}

/* ============================================================
 * STROKE STYLE
 * ============================================================
 *
 * The one place a `\draw` option list is assembled. A colour that is a hex is
 * `\definecolor`d inline in front of the command that uses it - valid TikZ,
 * self-contained in the picture, and harmless when the same definition also
 * appears in a document preamble.
 */
export function styleOptions(style = {}, fillMode = null) {
    const options = [];
    const prelude = [];

    const stroke = colourName(style?.stroke);

    if (String(style?.stroke ?? "").toLowerCase() === "none" || style?.draw === false) {
        options.push("draw=none");
    } else if (stroke) {
        const hex = normaliseHex(style.stroke);

        if (hex && hex !== "000000" && hex !== "FFFFFF") {
            prelude.push(colourDefinition(`daetumC${hex}`, hex));
        }

        options.push(`draw=${stroke}`);
    }

    const width = resolveLineWidth(style?.lineWidth);

    if (Number.isFinite(width) && width > 0) {
        options.push(`line width=${num(width * 0.56, 3)}pt`);
    }

    const lineType = String(style?.lineType ?? "").toLowerCase();

    if (lineType === "dashed") {
        options.push("dashed");
    } else if (lineType === "dotted") {
        options.push("dotted");
    } else if (lineType === "center") {
        options.push("dash pattern=on 4pt off 2pt on 1pt off 2pt");
    } else if (lineType === "construction") {
        options.push("dash pattern=on 1pt off 2pt", "gray");
    }

    if (fillMode === "fill" || String(style?.fillMode ?? "").toLowerCase() === "solid") {
        const fill = colourOf(style, "fill");

        if (fill) {
            const hex = normaliseHex(style?.fill && style.fill !== "none" ? style.fill : style?.stroke);

            if (hex && hex !== "000000" && hex !== "FFFFFF") {
                prelude.push(colourDefinition(`daetumC${hex}`, hex));
            }

            options.push(`fill=${fill}`);
        }
    }

      /*
       * THE DEFINITIONS TRAVEL IN FRONT OF THE OPTIONS, so a caller can put the
       * list straight behind `\draw[...]`. They are `\definecolor` lines, not
       * options, and `splitPrelude` takes them back out - a `\definecolor` inside
       * an option list would be invalid TikZ.
       */
      if (prelude.length) {
        options.unshift(...[...new Set(prelude)]);
      }

      return options;
    }

/*
 * Split an option list into its `\definecolor` prelude and its options, so a
 * command can be written as
 *
 *     \definecolor{daetumC193335}{RGB}{25,51,53}
 *     \draw[...] ...
 *
 * A `\definecolor` inside a `[...]` option list would be invalid, which is why
 * the split is explicit rather than assumed.
 */
export function splitPrelude(options) {
    const definitions = [];
    const kept = [];

    (Array.isArray(options) ? options : []).forEach((option) => {
        if (/^\\definecolor/.test(String(option))) {
            if (!definitions.includes(option)) {
                definitions.push(option);
            }

            return;
        }

        kept.push(option);
    });

    return { definitions, options: kept };
}

/*
 * ============================================================
 * TEXT
 * ============================================================
 *
 * A label is LaTeX, so the characters LaTeX treats as commands are escaped and
 * the symbols engineering labels use are written so a plain `standalone`
 * document compiles them. A label that is already LaTeX (the unit `N\cdot m`)
 * is not escaped - `isLatex` says which.
 */
const LATEX_SYMBOLS = {
    "\\": "\\textbackslash{}",
    "{": "\\{",
    "}": "\\}",
    $: "\\$",
    "&": "\\&",
    "#": "\\#",
    "%": "\\%",
    _: "\\_",
    "^": "\\^{}",
    "~": "\\~{}",
    "\u00b0": "$^{\\circ}$",
    "\u00b2": "$^{2}$",
    "\u00b3": "$^{3}$",
    "\u00b7": "$\\cdot$",
    "\u00d7": "$\\times$",
    "\u2212": "$-$",
    "\u00b1": "$\\pm$",
    "\u2248": "$\\approx$",
    "\u2264": "$\\leq$",
    "\u2265": "$\\geq$",
    "\u2192": "$\\rightarrow$",
    "\u2190": "$\\leftarrow$",
    "\u221e": "$\\infty$",
    "\u221a": "$\\surd$",
    "\u0394": "$\\Delta$",
    "\u03a3": "$\\Sigma$",
    "\u03a9": "$\\Omega$",
    "\u03a6": "$\\Phi$",
    "\u03b1": "$\\alpha$",
    "\u03b2": "$\\beta$",
    "\u03b3": "$\\gamma$",
    "\u03b4": "$\\delta$",
    "\u03b5": "$\\varepsilon$",
    "\u03b8": "$\\theta$",
    "\u03bb": "$\\lambda$",
    "\u03bc": "$\\mu$",
    "\u03bd": "$\\nu$",
    "\u03c0": "$\\pi$",
    "\u03c1": "$\\rho$",
    "\u03c3": "$\\sigma$",
    "\u03c4": "$\\tau$",
    "\u03c6": "$\\phi$",
    "\u03c9": "$\\omega$",
    "\u00b5": "$\\mu$",
    "\u222b": "$\\int$",
    "\u2013": "--",
    "\u2014": "---",
    "\u00d8": "\\O{}",
    "\u00f8": "\\o{}",
    "\u22a5": "$\\perp$",
    "\u2225": "$\\parallel$",
};

export function texText(text) {
    return [...String(text ?? "")]
        .map((character) => {
            const mapped = LATEX_SYMBOLS[character];

            if (mapped !== undefined) {
                return mapped;
            }

            /*
             * A CHARACTER TEX DOES NOT HAVE IS KNOWN HERE, not discovered by
             * a failed compile.
             *
             * A stored value can hold an escape that was never decoded (a
             * literal `\u00B7` instead of the character it names), or a
             * control character from a pasted string. Either one makes TeX
             * stop on the WHOLE document - and a compile is all-or-nothing, so
             * one bad label used to blank the entire sheet instead of drawing
             * the other objects and complaining about one.
             *
             * A control character, or a lone backslash inside a label, is
             * therefore written as a visible placeholder rather than passed
             * through. A backslash that starts a real command is left alone
             * by the callers that supply LaTeX deliberately - this function
             * is for PLAIN words, and `\\` is already in the table above.
             */
            const code = character.codePointAt(0);

            if (code < 0x20 && character !== "\n") {
                return " ";
            }

            return character;
        })
        .join("");
}

/*
 * A text node. `text` is written as given: a caller that has plain words
 * escapes them with `texText` first, and a caller that has mathematics passes
 * it already wrapped in `$...$`.
 */
export function textNode({ at, text, anchor = null, colour = null, font = null }) {
    const options = [];

    if (anchor) {
        options.push(`anchor=${anchor}`);
    }

    if (colour) {
        options.push(`text=${colour}`);
    }

    if (Number.isFinite(font)) {
        options.push(`font=\\fontsize{${num(font, 2)}}{${num(font * 1.2, 2)}}\\selectfont`);
    }

    return `\\node${options.length ? `[${options.join(", ")}]` : ""} at ${point(at.x, at.y)} {${text}};`;
}

/* ============================================================
 * ARROW HEADS
 * ============================================================ */
export function arrowHeadTip(kind) {
    const value = String(kind ?? "").toLowerCase();

    if (value === "none" || value === "") {
        return "";
    }

    if (value === "open" || value === "open-arrow" || value === "openarrow") {
        return ">";
    }

    if (value === "filled" || value === "filled-arrow" || value === "filledarrow" || value === "latex") {
        return "{Latex}";
    }

    if (value === "bar" || value === "tick") {
        return "|";
    }

    return "{Latex}";
}

/*
 * ============================================================
 * FORCES AND LOADS
 * ============================================================
 */

export function vector(degrees) {
    const radians = (Number(degrees) || 0) * Math.PI / 180;
    const x = Math.cos(radians);
    const y = Math.sin(radians);

    return {
        x: Math.abs(x) < 1e-3 ? 0 : x,
        y: Math.abs(y) < 1e-3 ? 0 : y,
        angle: Number(degrees) || 0,
    };
}

/*
 * A LOAD'S MAGNITUDE AT A STATION.
 *
 * The profile is piecewise linear between the points the student placed and
 * flat outside them - the rule the canvas samples with - so a triangular or
 * trapezoidal load is drawn at exactly the intensities it stores.
 */
export function loadPoints(geometry) {
    const shared = globalThis.enggLoadProfile;

    if (shared && typeof shared.profilePoints === "function") {
        return shared.profilePoints(geometry) || [];
    }

    const points = Array.isArray(geometry?.points) ? geometry.points : [];

    return points
        .map((entry) => ({ t: Number(entry.t) || 0, magnitude: Number(entry.magnitude) || 0 }))
        .sort((a, b) => a.t - b.t);
}

export function magnitudeAt(geometry, t) {
    const shared = globalThis.enggLoadProfile;

    if (shared && typeof shared.magnitudeAt === "function") {
        return shared.magnitudeAt(geometry, t);
    }

    const points = loadPoints(geometry);

    if (!points.length) {
        return 0;
    }

    if (points.length === 1) {
        return points[0].magnitude;
    }

    const ratio = Math.max(0, Math.min(1, t));

    if (ratio <= points[0].t) {
        return points[0].magnitude;
    }

    const last = points[points.length - 1];

    if (ratio >= last.t) {
        return last.magnitude;
    }

    for (let index = 1; index < points.length; index += 1) {
        if (ratio <= points[index].t) {
            const previous = points[index - 1];
            const next = points[index];
            const span = next.t - previous.t;

            if (Math.abs(span) < 1e-9) {
                return next.magnitude;
            }

            return previous.magnitude + (next.magnitude - previous.magnitude) * ((ratio - previous.t) / span);
        }
    }

    return last.magnitude;
}

function pointAlong(geometry, t) {
    const start = geometry?.start;
    const end = geometry?.end;

    if (!start || !end) {
        return null;
    }

    const ratio = Math.max(0, Math.min(1, t));

    return {
        x: Number(start.x) + (Number(end.x) - Number(start.x)) * ratio,
        y: Number(start.y) + (Number(end.y) - Number(start.y)) * ratio,
    };
}

/*
 * THE ARROWS A LOAD IS DRAWN WITH.
 *
 * The positions are the load's own interval (a display property), the
 * magnitudes its own profile (the physical intensity). A defined point always
 * gets its arrow; the interval only subdivides the gaps between defined
 * points - the rule the canvas uses, so a point placed at 37% has an arrow at
 * 37% rather than wherever a grid happened to fall.
 */
export function loadSamples(geometry) {
    const start = geometry?.start;
    const end = geometry?.end;

    if (!start || !end) {
        return [];
    }

    const span = Math.hypot(Number(end.x) - Number(start.x), Number(end.y) - Number(start.y));

    if (!(span > 1e-9)) {
        return [];
    }

    const defined = loadPoints(geometry);

    if (!defined.length) {
        return [];
    }

    const interval = Math.max(1, Number(geometry?.interval) || 20);
    const cap = 40;

    const samples = defined.map((entry) => ({
        t: entry.t,
        magnitude: entry.magnitude,
        base: pointAlong(geometry, entry.t),
        defined: true,
    }));

    const key = (t) => Math.round(t * 1e6) / 1e6;
    const occupied = new Set(defined.map((entry) => key(entry.t)));

    for (let index = 1; index < defined.length; index += 1) {
        const from = defined[index - 1].t;
        const to = defined[index].t;
        const gap = to - from;

        if (gap <= 1e-9) {
            continue;
        }

        const steps = Math.max(1, Math.min(cap, Math.round((gap * span) / interval)));

        for (let step = 1; step < steps; step += 1) {
            const t = from + (gap * step) / steps;

            if (occupied.has(key(t))) {
                continue;
            }

            occupied.add(key(t));

            samples.push({
                t,
                magnitude: magnitudeAt(geometry, t),
                base: pointAlong(geometry, t),
                defined: false,
            });
        }
    }

    return samples
        .filter((sample) => sample.base && Number.isFinite(sample.base.x) && Number.isFinite(sample.base.y))
        .sort((a, b) => a.t - b.t);
}

/* The direction a load's arrows point, in degrees. */
export function loadDirectionOf(geometry) {
    const shared = globalThis.enggLoadProfile;

    if (shared && typeof shared.loadDirection === "function") {
        return Number(shared.loadDirection(geometry));
    }

    return Number.isFinite(Number(geometry?.direction)) ? Number(geometry.direction) : -90;
}

export function loadReversed(geometry) {
    const shared = globalThis.enggLoadProfile;

    return shared && typeof shared.isLoadReversed === "function"
        ? Boolean(shared.isLoadReversed(geometry))
        : Boolean(geometry?.reversed);
}

/*
 * The body's OUTWARD normal - the side the force lines are drawn on. Read
 * from the span (and the recorded side), never from the force direction, so
 * reversing a load cannot move the lines to the other side of the member.
 */
export function bodyNormal(geometry) {
    const shared = globalThis.enggLoadProfile;

    if (shared && typeof shared.loadBodyNormal === "function") {
        const normal = shared.loadBodyNormal(geometry);

        if (normal) {
            return normal;
        }
    }

    const start = geometry?.start;
    const end = geometry?.end;

    if (!start || !end) {
        return { x: 0, y: 1 };
    }

    const dx = Number(end.x) - Number(start.x);
    const dy = Number(end.y) - Number(start.y);
    const length = Math.hypot(dx, dy) || 1;

    const normal = { x: -dy / length, y: dx / length };

    if (Number(geometry?.normalSide) === -1) {
        return { x: -normal.x, y: -normal.y };
    }

    if (Number(geometry?.normalSide) === 1) {
        return normal;
    }

    const direction = vector(loadDirectionOf(geometry));

    return normal.x * direction.x + normal.y * direction.y >= 0
        ? normal
        : { x: -normal.x, y: -normal.y };
}

/*
 * HOW LONG A LOAD'S ARROW IS DRAWN, in drawing units.
 *
 * The intensity times the sheet's Vector Scale - the same rule as the canvas,
 * scaled to drawing units rather than pixels. It is the physical magnitude
 * that decides it and the drawing scale that scales it; the arrow SPACING
 * never does.
 */
export function loadArrowLength(magnitude, vectorScale = 1) {
    const value = Math.abs(Number(magnitude) || 0);

    if (!(value > 0)) {
        return 0;
    }

    return value * Math.max(Number(vectorScale) || 0, 0.0001);
}

/* ============================================================
 * THE TEXT AN OBJECT OWNS
 * ============================================================
 *
 * Only where the object's intended drawing needs text, and only when the
 * display option that governs it is on:
 *
 *   force               its label, and "F = 20 N" when values are shown
 *   load                its label, and "w = 5 kN/m" when values are shown
 *   varying load        its label, and one intensity per end
 *   moment              its label, and "M = 10 N.m" when values are shown
 *   resultant           its label, and "R = 25 N" when values are shown
 *   force components    Fx / Fy, and their values
 *   diagrams            title, axis names and the calculated annotations
 *   coordinate system   x, y, O
 *
 * Everything else - particles, members, supports, connections, references -
 * gets NOTHING unless the student filled in the Features `Label` field.
 */
const LABEL_FONTS = { small: 8, medium: 10, large: 12 };

/* The moment's unit: `N\cdot m`, written once so the axis and the value agree. */
const DIAGRAM_MOMENT_UNIT = "N\\cdot m";

function fontFor(style) {
    return LABEL_FONTS[String(style?.fontSize ?? "").toLowerCase()] || 9;
}

/*
 * WHETHER THE OBJECT'S VALUE ANNOTATION IS SHOWN.
 *
 * The per-object switch is the object's own opinion; the sheet-wide Magnitudes
 * setting is a bulk switch that may only NARROW it. An absent opinion means
 * "show it", which is the behaviour every drawing has always had - so a file
 * saved before these switches existed opens exactly as it looked.
 */
function valuesShown(object) {
    const holder = object?.annotationDisplay || object?.display || null;

    if (holder && typeof holder.showMagnitude === "boolean" && holder.showMagnitude === false) {
        return false;
    }

    if (object?.showValue === false) {
        return false;
    }

    const sheet = object?.__generationOptions?.state;

    return sheet?.display?.showMagnitudes !== false;
}

function labelsShown(object) {
    return object?.showLabel !== false;
}

function formatNumber(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return "";
    }

    const magnitude = Math.abs(number);

    /*
     * TRAILING ZEROS ARE NOT PRINTED. "60" is a force of sixty newtons; "60.0"
     * on a drawing is a precision the student never claimed, and a value
     * written to a fixed number of places would change the digits of a label
     * every time the magnitude merely grew.
     */
    const places = magnitude === 0 ? 2 : magnitude < 1 ? 3 : magnitude < 10 ? 2 : 1;

    const text = (Math.round(number * 10 ** places * (1 + Number.EPSILON)) / 10 ** places).toFixed(places);

    return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") || "0" : text;
}

/*
 * A UNIT AS TEX SHOULD SEE IT.
 *
 * A unit is stored as the student reads it (`N·m`, `kN/m`), which is right for
 * the panel and the file. Four things have to be true before it can sit inside
 * a maths label:
 *
 *   - the middle dot becomes `\cdot`, because the character itself is not a
 *     maths symbol TeX knows in every engine;
 *   - a slash becomes `\/`-safe spacing rather than a division sign;
 *   - a literal `\u00B7` escape - stored by an older build - is decoded rather
 *     than emitted, because `\u00B7` is not a TeX command;
 *   - the result carries NO `$`, because the caller wraps the whole label in
 *     maths mode already. An embedded `$` closes that mode early and the label
 *     then fails to compile - which is how `$M = 50\ N$\cdot$m$` happened.
 */
function unitCommand(unit) {
    const text = String(unit ?? "").trim();

    if (!text) {
        return "";
    }

    const decoded = text
        .replace(/\\u00[bB]7/g, "·")
        .replace(/\\u00[dD]7/g, "×")
        .replace(/\$/g, "");

    /*
     * THE MATH-MODE SYMBOLS ARE WRITTEN DIRECTLY.
     *
     * `texText` turns `·` into `$\cdot$` so a PLAIN-TEXT label can show the
     * character. A unit, though, is always placed inside a maths label the
     * caller already wrapped in `$...$` - so that substitution produces
     * `$M = 10\ N$\cdot$m$`, a `$` in the middle of maths mode, which TeX
     * rejects. The unit therefore writes `\cdot` itself and never a `$`.
     */
    return decoded
        .replace(/\\/g, "\\textbackslash{} ")
        .replace(/[{}]/g, "")
        .replace(/·/g, "\\cdot ")
        .replace(/×/g, "\\times ")
        .replace(/\s+/g, "\\,")
        .replace(/\\,\./g, ".")
        .trim();
}

function unitOf(object) {
    const geometry = object?.geometry || {};

    if (typeof geometry.unit === "string" && geometry.unit) {
        return unitCommand(geometry.unit);
    }

    if (object?.type === "moment") {
        return "N\\cdot m";
    }

    if (object?.type === "load" || object?.type === "varying-load") {
        return unitCommand(geometry.loadUnit || "kN/m");
    }

    if (object?.type === "force" || object?.type === "resultant" || object?.type === "force-components") {
        return unitCommand(geometry.forceUnit || "N");
    }

    return "";
}

function labelTextOf(object, fallback) {
    const explicit = typeof object?.label === "string" ? object.label.trim() : "";

    if (explicit) {
        return texText(explicit);
    }

    if (!labelsShown(object)) {
        return "";
    }

    return texText(fallback);
}

function nodeColourOf(object) {
    return colourOf(object?.style, "stroke");
}

/*
 * THE OBJECT'S DEFAULT NAME, derived from the model's own naming scheme.
 *
 * `addObject` already numbers a new feature ("Point Force 1", "Beam 2"), and
 * that name is the one the Objects list shows - so it is the one the label
 * carries. A custom name typed in Features replaces it, and a physical value
 * changing never touches either.
 */
function defaultLabel(object) {
    const name = typeof object?.name === "string" ? object.name.trim() : "";

    return name || "";
}

/*
 * One label node beside an anchor, kept clear of the feature by `offset`.
 */
function labelNode({ at, text, colour, font, anchor }) {
    return `\\node[anchor=${anchor || "south"}, text=${colour}, font=\\fontsize{${num(font, 2)}}{${num(font * 1.2, 2)}}\\selectfont] at ${point(at.x, at.y)} {${text}};`;
}

/* A force's own label and its magnitude, kept apart. */
function forceNodes(object) {
    const geometry = object?.geometry || {};
    const style = object?.style || {};
    const colour = nodeColourOf(object);
    const font = fontFor(style);

    const start = geometry.start || geometry.position || { x: 0, y: 0 };
    const magnitude = Number(geometry.magnitude);
    const angle = Number(geometry.angle) || 0;
    const direction = vector(angle);
    const reach = Number.isFinite(magnitude) ? Math.abs(magnitude) : 0;

    const scale = Number(object?.__generationOptions?.vectorScale) || 1;

    /*
     * THE REAL VISUAL FORCE SCALE DECIDES WHERE THE LABEL SITS, because that
     * is where the arrowhead is drawn. The number inside it is still the
     * engineering magnitude: the scale is a drawing setting and never a value.
     */
    const end = Number.isFinite(angle)
        ? { x: Number(start.x) + direction.x * reach * scale, y: Number(start.y) + direction.y * reach * scale }
        : geometry.end || start;

    const at = { x: Number(end.x) + direction.x * 3, y: Number(end.y) + direction.y * 3 };

    const nodes = [];

    const label = labelTextOf(object, defaultLabel(object));

    if (label) {
        nodes.push(labelNode({ at, text: label, colour, font, anchor: direction.x >= 0 ? "west" : "east" }));
    }

    if (valuesShown(object) && Number.isFinite(magnitude)) {
        const unit = unitOf(object);
        const text = `$F = ${formatNumber(magnitude)}${unit ? `\\ ${unit}` : ""}$`;

        nodes.push(
            labelNode({
                at: { x: at.x, y: at.y - font * 0.45 },
                text,
                colour,
                font,
                anchor: direction.x >= 0 ? "west" : "east",
            }),
        );
    }

    return nodes;
}

function loadNodes(object) {
    const geometry = object?.geometry || {};
    const style = object?.style || {};
    const colour = nodeColourOf(object);
    const font = fontFor(style);

    const start = geometry.start || { x: 0, y: 0 };
    const end = geometry.end || start;

    const mid = { x: (Number(start.x) + Number(end.x)) / 2, y: (Number(start.y) + Number(end.y)) / 2 };

    const normal = bodyNormal(geometry);
    const nodes = [];

    const label = labelTextOf(object, defaultLabel(object));

    if (label) {
        nodes.push(
            labelNode({
                at: { x: mid.x + normal.x * 4, y: mid.y + normal.y * 4 },
                text: label,
                colour,
                font,
                anchor: normal.y >= 0 ? "south" : "north",
            }),
        );
    }

    if (!valuesShown(object)) {
        return nodes;
    }

    const unit = unitOf(object);

    if (object.type === "varying-load") {
        /* One intensity per end, from the stored values. */
        const ends = [
            { at: start, value: geometry.startIntensity },
            { at: end, value: geometry.endIntensity },
        ];

        ends.forEach((entry) => {
            const value = Number(entry.value);

            if (!Number.isFinite(value)) {
                return;
            }

            nodes.push(
                labelNode({
                    at: { x: Number(entry.at.x) + normal.x * 3, y: Number(entry.at.y) + normal.y * 3 },
                    text: `$${formatNumber(value)}${unit ? `\\ ${unit}` : ""}$`,
                    colour,
                    font,
                    anchor: normal.y >= 0 ? "south" : "north",
                }),
            );
        });

        return nodes;
    }

    const intensity = Number(geometry.intensity);

    if (Number.isFinite(intensity)) {
        nodes.push(
            labelNode({
                at: { x: mid.x + normal.x * (font * 0.9), y: mid.y + normal.y * (font * 0.9) },
                text: `$w = ${formatNumber(intensity)}${unit ? `\\ ${unit}` : ""}$`,
                colour,
                font,
                anchor: normal.y >= 0 ? "south" : "north",
            }),
        );
    }

    return nodes;
}

function momentNodes(object) {
    const geometry = object?.geometry || {};
    const style = object?.style || {};
    const colour = nodeColourOf(object);
    const font = fontFor(style);

    const position = geometry.position || { x: 0, y: 0 };
    const radius = Number(geometry.arcRadius) || 7;

    const at = { x: Number(position.x) + radius * 0.7, y: Number(position.y) + radius * 0.7 };

    const nodes = [];

    const label = labelTextOf(object, defaultLabel(object));

    if (label) {
        nodes.push(labelNode({ at, text: label, colour, font, anchor: "south west" }));
    }

    const magnitude = Number(geometry.magnitude);

    if (valuesShown(object) && Number.isFinite(magnitude)) {
        const unit = unitOf(object);

        nodes.push(
            labelNode({
                at: { x: at.x, y: at.y - font * 0.45 },
                text: `$M = ${formatNumber(magnitude)}${unit ? `\\ ${unit}` : ""}$`,
                colour,
                font,
                anchor: "south west",
            }),
        );
    }

    return nodes;
}

function resultantNodes(object) {
    const geometry = object?.geometry || {};
    const style = object?.style || {};
    const colour = nodeColourOf(object);
    const font = fontFor(style);

    const start = geometry.start || geometry.position || { x: 0, y: 0 };
    const end = geometry.end || start;

    const direction = vector(geometry.angle);
    const at = { x: Number(end.x) + direction.x * 3, y: Number(end.y) + direction.y * 3 };

    const nodes = [];

    const label = labelTextOf(object, "R");

    if (label) {
        nodes.push(labelNode({ at, text: label, colour, font, anchor: direction.x >= 0 ? "west" : "east" }));
    }

    const magnitude = Number(geometry.magnitude);

    if (valuesShown(object) && Number.isFinite(magnitude)) {
        nodes.push(
            labelNode({
                at: { x: at.x, y: at.y - font * 0.45 },
                text: `$R = ${formatNumber(magnitude)}\\ ${unitOf(object)}$`,
                colour,
                font,
                anchor: direction.x >= 0 ? "west" : "east",
            }),
        );
    }

    return nodes;
}

function componentNodes(object) {
    const geometry = object?.geometry || {};
    const style = object?.style || {};
    const colour = nodeColourOf(object);
    const font = fontFor(style);

    const nodes = [];
    const unit = unitOf(object);

    const place = (pair, fallbackText, anchor) => {
        if (!pair?.end) {
            return;
        }

        const end = pair.end;

        nodes.push(
            labelNode({
                at: { x: Number(end.x) + 2, y: Number(end.y) + 1 },
                text: fallbackText,
                colour,
                font,
                anchor,
            }),
        );
    };

    if (geometry.showX !== false) {
        const fx = Number(geometry.forceX);
        const text = valuesShown(object) && Number.isFinite(fx)
            ? `$F_x = ${formatNumber(fx)}\\ ${unit}$`
            : "$F_x$";

        place(geometry.horizontal, text, "south");
    }

    if (geometry.showY !== false) {
        const fy = Number(geometry.forceY);
        const text = valuesShown(object) && Number.isFinite(fy)
            ? `$F_y = ${formatNumber(fy)}\\ ${unit}$`
            : "$F_y$";

        place(geometry.vertical, text, "west");
    }

    return nodes;
}

/*
 * A DIAGRAM'S NUMERICAL ANNOTATIONS come only from REAL calculated results
 * stored on the diagram - `results: [{ x, value }]`, written by whatever
 * computed them. There is no sample curve and no demonstration value here: a
 * diagram with no results shows its title and axes and nothing else.
 */
function diagramValueAnnotations(geometry, unitHeight) {
    const results = Array.isArray(geometry?.results) ? geometry.results : [];
    const annotations = [];

    const localRange = geometry?.localRange;
    const start = geometry?.start;
    const end = geometry?.end;

    if (!localRange || !start || !end) {
        return annotations;
    }

    const width = Number(localRange.to) - Number(localRange.from);

    if (!(width > 0)) {
        return annotations;
    }

    results.forEach((result) => {
        const x = Number(result?.x);
        const value = Number(result?.value);

        if (!Number.isFinite(x) || !Number.isFinite(value)) {
            return;
        }

        const t = (x - Number(localRange.from)) / width;

        const at = {
            x: Number(start.x) + (Number(end.x) - Number(start.x)) * t,
            y: Number(start.y) + value * (Number(unitHeight) || 0),
        };

        annotations.push({ at, value, x });
    });

    return annotations;
}

/*
 * A DIAGRAM'S TEXT: its title, its axis names and - only when there are real
 * calculated results and their display is on - the values beside them.
 */
function diagramNodes(object, unitHeight = 0) {
    const geometry = object?.geometry || {};
    const style = object?.style || {};
    const colour = nodeColourOf(object);
    const font = fontFor(style);

    const start = geometry.start || { x: 0, y: 0 };
    const end = geometry.end || start;

    const kind = String(geometry.diagramType || "").toLowerCase();

    const titles = { sfd: "SFD", bmd: "BMD", afd: "AFD" };

    const axes = {
        sfd: { y: "V", unit: "N", x: "x", xUnit: "m" },
        bmd: { y: "M", unit: DIAGRAM_MOMENT_UNIT, x: "x", xUnit: "m" },
        afd: { y: "N", unit: "N", x: "x", xUnit: "m" },
    }[kind];

    const nodes = [];

    const showTitle = object?.showTitle !== false && geometry.showTitle !== false;

    if (showTitle && titles[kind]) {
        nodes.push(
            labelNode({
                at: { x: Number(start.x), y: Number(start.y) + 9 },
                text: titles[kind],
                colour,
                font,
                anchor: "south west",
            }),
        );
    }

    if (axes) {
        /* The axis names, in the place a reader looks for them. */
        nodes.push(
            labelNode({
                at: { x: Number(start.x) - 2, y: Number(start.y) + 13 },
                text: `$${axes.y}$ (${axes.unit})`,
                colour,
                font,
                anchor: "north east",
            }),
        );

        nodes.push(
            labelNode({
                at: { x: Number(end.x) + 2, y: Number(start.y) + 6 },
                text: `$${axes.x}$ (${axes.xUnit})`,
                colour,
                font,
                anchor: "south west",
            }),
        );
    }

    if (object?.showValues === true && valuesShown(object)) {
        diagramValueAnnotations(geometry, unitHeight).forEach((annotation) => {
            nodes.push(
                labelNode({
                    at: { x: annotation.at.x, y: annotation.at.y + 2 },
                    text: `$${formatNumber(annotation.value)}$`,
                    colour,
                    font,
                    anchor: "north",
                }),
            );
        });
    }

    return nodes;
}

/*
 * THE DISPATCH. A type with no entry here gets its label only if the student
 * actually typed one - never a generated name for a plain member or support.
 */
export function staticsTextNodes(object) {
    if (!object || typeof object !== "object") {
        return "";
    }

    /*
     * AN ORPHANED ANALYSIS OBJECT DRAWS NOTHING, so it labels nothing either:
     * a title over an empty space would claim a diagram that is not there.
     */
    if (object.engineering?.unresolved === true) {
        return "";
    }

    let nodes;

    switch (object.type) {
        case "force":
            nodes = forceNodes(object);
            break;

        case "load":
        case "varying-load":
            nodes = loadNodes(object);
            break;

        case "moment":
            nodes = momentNodes(object);
            break;

        case "resultant":
            nodes = resultantNodes(object);
            break;

        case "force-components":
            nodes = componentNodes(object);
            break;

        case "analysis-diagram":
        case "shear-force-diagram":
        case "bending-moment-diagram":
        case "axial-force-diagram":
            nodes = diagramNodes(object, object?.__generationOptions?.diagramUnitHeight || 0);
            break;

        case "coordinate-system-2d":
            /*
             * THE AXIS NAMES are emitted by the geometry serializer, because
             * they must turn with the arms. Nothing is duplicated here.
             */
            nodes = [];
            break;

        default:
            nodes = [];
    }

    /*
     * A LABEL THE STUDENT ASKED FOR, on a type that does not otherwise carry
     * text. It is placed at the object's own anchor, so it follows the feature
     * when the feature moves.
     */
    const explicit = typeof object.label === "string" ? object.label.trim() : "";

    if (explicit && !nodes.length) {
        const geometry = object.geometry || {};
        const colour = nodeColourOf(object);
        const font = fontFor(object.style);

        const at = geometry.position || geometry.center || geometry.origin || geometry.start;

        if (at && Number.isFinite(Number(at.x)) && Number.isFinite(Number(at.y))) {
            nodes.push(
                labelNode({
                    at: { x: Number(at.x) + 4, y: Number(at.y) + 4 },
                    text: texText(explicit),
                    colour,
                    font,
                    anchor: "south west",
                }),
            );
        }
    }

    return nodes.filter(Boolean).join("\n");
}

/* ============================================================
 * THE SOURCE MAP
 * ============================================================ */
export function sourceMapFor(lines, id) {
    const list = Array.isArray(lines) ? lines : [];

    const begin = list.findIndex((line) =>
        String(line).includes(`DAETUM_OBJECT_BEGIN id="${id}"`),
    );

    if (begin < 0) {
        return null;
    }

    const end = list.findIndex(
        (line, index) =>
            index > begin && String(line).includes(`DAETUM_OBJECT_END id="${id}"`),
    );

    return {
        beginLine: begin,
        endLine: end < 0 ? lines.length - 1 : end,
        bodyStartLine: begin + 1,
        bodyEndLine: end < 0 ? lines.length - 1 : end - 1,
    };
}

export default {
    num,
    point,
    normaliseHex,
    colourName,
    colourDefinition,
    colourDefinitions,
    colourOf,
    styleOptions,
    splitPrelude,
    texText,
    textNode,
    arrowHeadTip,
    vector,
    loadPoints,
    magnitudeAt,
    loadSamples,
    loadDirectionOf,
    loadReversed,
    bodyNormal,
    loadArrowLength,
    staticsTextNodes,
    sourceMapFor,
};
