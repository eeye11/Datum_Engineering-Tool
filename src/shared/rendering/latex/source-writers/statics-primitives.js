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

import { createSourceMap } from "../drawing-source.js";
import {
  DEFAULT_STROKE,
  colourName as sharedColourName,
  colourDefinition as sharedColourDefinition,
  strokeOptions as sharedStrokeOptions,
  fillOptions as sharedFillOptions,
  unique as sharedUnique,
} from "../../../../tool-library/shared/primitives/tikz-style.js";

import { COMPONENT_COLOURS } from "../../component-colours.js";

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

/*
 * THE EXPORT TRANSFORM IN EFFECT FOR THE OBJECT BEING SERIALIZED.
 *
 * The serializers are written in terms of `point(x, y)` with MODEL coordinates,
 * because that is the geometry they read. The export reduces the whole drawing
 * and shifts it to a local origin, so the transform is threaded in here - one
 * place - rather than added to every coordinate expression in every serializer.
 *
 * It is set for the duration of ONE object's serialization and restored after,
 * so it can never leak between objects or into a second pass over the same
 * drawing. That is what makes repeated generation idempotent: each call starts
 * from the model's own coordinates and applies the factor once.
 *
 * With no transform (or the identity one) `point` writes the coordinates it was
 * given, unchanged.
 */
let exportTransformInEffect = null;

/* Run `fn` with one object's export transform in effect. */
export function withExportTransform(transform, fn) {
    const previous = exportTransformInEffect;

    exportTransformInEffect = transform && typeof transform.point === "function" ? transform : null;

    try {
        return fn();
    } finally {
        exportTransformInEffect = previous;
    }
}

/* The transform currently in effect, for a writer that needs its factor. */
export function currentExportTransform() {
    return exportTransformInEffect;
}

/*
 * A MODEL COORDINATE, WRITTEN IN EXPORT SPACE.
 *
 * The serializers compute everything in MODEL space - that is where the object's
 * own coordinates live - and hand the result here. This is the ONE place a model
 * coordinate becomes an exported one, so the transform is applied exactly once:
 * here, not also in `pointOf` and not again in a caller.
 *
 * LENGTHS are different: a radius, a symbol's offset or an arrow's reach has no
 * origin and is multiplied by the factor without being shifted. They go through
 * `symbolSize` / `currentExportTransform().length`, never through this.
 */
export function point(x, y) {
    const px = Number(x);
    const py = Number(y);

    const at = exportTransformInEffect
        ? exportTransformInEffect.point(Number.isFinite(px) ? px : 0, Number.isFinite(py) ? py : 0)
        : { x: Number.isFinite(px) ? px : 0, y: Number.isFinite(py) ? py : 0 };

    return `(${num(at.x)},${num(at.y)})`;
}

/* A model point, in export space - for a caller that needs the numbers. */
export function exportPoint(candidate) {
    const x = Number(candidate?.x) || 0;
    const y = Number(candidate?.y) || 0;

    return exportTransformInEffect ? exportTransformInEffect.point(x, y) : { x, y };
}

/*
 * ============================================================
 * SKETCH STROKES - ONE WRITER FOR EVERY TOOL THAT CARRIES THEM
 * ============================================================
 *
 * An SFD, BMD or AFD can hold hand-drawn strokes; a Resultant holds the same
 * kind of thing (its vector triangle, its closing line). All of them are
 * `{ kind, start, bend, end, points }` records in GRAPH-LOCAL or MODEL space,
 * and all of them must reach the source in the same way - otherwise one tool's
 * sketch is drawn on the sheet and missing from TeX, which is exactly the
 * failure this module exists to prevent.
 *
 * The caller supplies `toModel`, the projection from an element's own points to
 * MODEL space (the transform in effect converts model space to export space),
 * and the points an element is drawn through (`pointsOf`). The path is written
 * as a polyline through those points - the same shape the canvas draws - so a
 * `curve3` becomes the two-segment quadratic it is on screen and a legacy
 * many-point curve its chain of segments.
 *
 * Returns one command per element (or null for an element with no drawable
 * extent), and never invents a stroke: an empty list writes nothing.
 */
export function sketchStrokeCommands(elements, { pointsOf, toModel, options }) {
    const list = Array.isArray(elements) ? elements : [];
    const commands = [];

    list.forEach((element) => {
        const local = pointsOf(element);

        if (!Array.isArray(local) || local.length < 2) {
            return;
        }

        const placed = local.map((at) => toModel(at));

        const body = placed
            .map((at, index) => (index === 0 ? point(at.x, at.y) : `-- ${point(at.x, at.y)}`))
            .join(" ");

        commands.push(`\\draw[${options.join(", ")}] ${body};`);
    });

    return commands;
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

    return sharedColourName(text, { fallback: DEFAULT_STROKE });
}

/*
 * The definitions one list of hex values needs, as `\definecolor` lines. Used by
 * the export to lift the picture's colours into the preamble.
 */
/*
 * A `\definecolor` line for one hex colour.
 *
 * THE RGB MODEL, NOT HTML. DAETUM's renderer (TikZJax) loads xcolor without the
 * `x11names`/`svgnames` families, and with a bare xcolor its HTML model is not
 * available - so `{HTML}` compiles in a full TeX Live installation and fails in
 * the renderer the Source tab actually uses. `{RGB}` is a CORE model of xcolor,
 * so one spelling works in both.
 */
export function colourDefinition(name, hex) {
    return sharedColourDefinition(name, `#${String(hex ?? "").replace(/^#/, "")}`);
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
 * The colour of a feature: the student's own stroke, or BLACK.
 *
 * THEME INK IS NOT PART OF THE DRAWING. `theme.defaultLineColour()` is how a new
 * object STARTS, and writing it here made every un-chosen line a dark teal in
 * TeX while the sheet showed black - and made a saved file's colour depend on
 * the interface theme. Black is what the document is made of.
 */
export function colourOf(style, key = "stroke") {
    const value = style?.[key];

    if (key === "fill") {
        const fill = sharedFillOptions({
            fillMode: style?.fillMode,
            fill: value,
            stroke: style?.stroke,
        });

        return fill.option ? fill.option.replace(/^fill=/, "") : null;
    }

    return colourName(value) || "black";
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
    /*
     * THE PEN IS WRITTEN AT THE EXPORT SCALE, through the shared conversion.
     * `style` holds the NOMINAL width the student chose; the transform in effect
     * contributes the one factor it gets, and so does the dash pattern.
     */
    const { options, definitions } = sharedStrokeOptions(style || {}, {
        transform: exportTransformInEffect,
    });

    /*
     * THE FILL IS THIS MODULE'S OWN second argument, which some callers pass as
     * "fill" rather than setting the style's fill mode. It is folded into one
     * style before the shared conversion answers for it.
     */
    const wantsFill =
        String(fillMode ?? "").toLowerCase() === "fill" ||
        String(style?.fillMode ?? "").toLowerCase() === "solid";

    const fill = wantsFill
        ? sharedFillOptions({ ...style, fillMode: "solid" })
        : { option: null, definitions: [] };

    if (fill.option) {
        options.push(fill.option);
    }

    /*
     * THE DEFINITIONS TRAVEL IN FRONT OF THE OPTIONS, so a caller can put the
     * list straight behind `\draw[...]`. They are `\definecolor` lines, not
     * options, and `splitPrelude` takes them back out - a `\definecolor` inside
     * an option list would be invalid TikZ.
     *
     * A caller that REPLACES a colour (a filled marker writing `draw=none` and
     * its own `fill=`) merges the original DEFINITIONS with its replacement
     * options and de-duplicates the result, so one `\definecolor` per colour is
     * what reaches the command - never the same definition twice.
     */
    return uniqueList([...definitions, ...fill.definitions, ...options]);
}

/* Remove repeated options, keeping the first occurrence's position. */
function uniqueList(values) {
    return sharedUnique(values || []);
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

    let points = Array.isArray(geometry?.points) ? geometry.points : [];

    /* A varying load's two end intensities are its profile; see load-profile.js. */
    if (!points.length && (geometry?.startIntensity !== undefined || geometry?.endIntensity !== undefined)) {
        points = [
            { t: 0, magnitude: Math.abs(Number(geometry.startIntensity) || 0) },
            { t: 1, magnitude: Math.abs(Number(geometry.endIntensity) || 0) }
        ];
    }

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
 * The load's DRAWN height (`arrowLength`, set by its placement gesture),
 * scaled by this arrow's intensity over the peak - the same rule the canvas
 * uses (`loadArrowReach` in load-profile.js), so the two cannot disagree. The
 * intensity is the label's value and only shapes a varying load's taper; it
 * is never itself a length. A load with no stored height is drawn at its peak
 * intensity, which is how it looked before heights were stored.
 */
export function loadArrowLength(geometry, magnitude) {
    const shared = globalThis.enggLoadProfile;

    if (shared && typeof shared.loadArrowReach === "function") {
        return shared.loadArrowReach(geometry, magnitude);
    }

    const value = Math.abs(Number(magnitude) || 0);
    const peak = loadPoints(geometry).reduce((most, entry) => Math.max(most, Math.abs(entry.magnitude)), 0);

    if (!(value > 0) || !(peak > 0)) {
        return 0;
    }

    const stored = Number(geometry?.arrowLength);
    const height = Number.isFinite(stored) && stored > 0 ? stored : peak;

    return (height * value) / peak;
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

/*
 * THE TEXT A LABEL SHOWS.
 *
 * THREE THINGS ARE NOT THE SAME, and this is where they are kept apart:
 *
 *   the object's NAME     "Point Force 1" - the Objects list's label for a
 *                         feature. It is INTERNAL. It belongs in the source's
 *                         `% DAETUM OBJECT:` header and nowhere in the picture.
 *   the student's LABEL   (`object.label`) - text they typed in Features, which
 *                         IS the drawing's content and is shown.
 *   the VALUE             "F = 60 N" - controlled by the display settings.
 *
 * A default label is only written when the student explicitly asked for the
 * object's name (`showName`), or when the tool's documented drawing needs a
 * fixed default (a Resultant's "R"). A name is NEVER a default: that is what
 * made every Point Force print "Point Force" at its arrowhead.
 */
function labelTextOf(object, fallback = "") {
    const explicit = typeof object?.label === "string" ? object.label.trim() : "";

    if (explicit) {
        return texText(explicit);
    }

    if (!labelsShown(object)) {
        return "";
    }

    const name = typeof object?.name === "string" ? object.name.trim() : "";

    if (name && object?.showName === true) {
        return texText(name);
    }

    return fallback ? texText(fallback) : "";
}

function nodeColourOf(object) {
    return colourOf(object?.style, "stroke");
}


/*
 * One label node beside an anchor, kept clear of the feature by `offset`.
 */
function labelNode({ at, text, colour, font, anchor }) {
    /*
     * THE LABEL'S SIZE FOLLOWS THE EXPORT, WITH A READABLE FLOOR.
     *
     * `font` is the NOMINAL size the object's style chose. A figure reduced to
     * 35% would otherwise print a 9pt label at 3.1pt - present and unreadable -
     * so the export context applies its floor (6pt by default). The leading is
     * stated as a multiple of the size actually used, so the two always agree.
     * The object's own font setting is never changed.
     */
    const transform = exportTransformInEffect;
    const size = transform ? transform.font(font) : font;

    return `\\node[anchor=${anchor || "south"}, text=${colour}, font=\\fontsize{${num(size, 2)}}{${num(size * 1.2, 2)}}\\selectfont] at ${point(at.x, at.y)} {${text}};`;
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

    /*
     * THE LABEL SITS AT THE ARROWHEAD THE SOURCE DRAWS - the stored `end`, the
     * arrow the student drew. Placing it at `start + magnitude * direction`
     * floated it away from the head whenever the typed value differed from
     * the drawn length. A force with no stored end is drawn at its magnitude,
     * and so is labelled there.
     */
    const storedEnd =
        geometry.end && Number.isFinite(Number(geometry.end.x)) && Number.isFinite(Number(geometry.end.y))
            ? { x: Number(geometry.end.x), y: Number(geometry.end.y) }
            : null;

    const end = storedEnd || { x: Number(start.x) + direction.x * reach, y: Number(start.y) + direction.y * reach };

    const at = { x: Number(end.x) + direction.x * 3, y: Number(end.y) + direction.y * 3 };

    const nodes = [];

    const label = labelTextOf(object);

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

    const label = labelTextOf(object);

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

    const at = { x: Number(position.x) + radius * 0.35, y: Number(position.y) - radius - 1 };

    const nodes = [];

    const label = labelTextOf(object);

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
    const font = fontFor(style);

    const nodes = [];
    const unit = unitOf(object);

    const place = (pair, fallbackText) => {
        if (!pair?.end) {
            return;
        }

        const end = pair.end;
        const start = pair.start || end;
        const horizontal = Math.abs(end.y - start.y) < 1e-9;
        if (Math.hypot(end.x - start.x, end.y - start.y) < 1e-9) return;
        const at = horizontal
            ? { x: (start.x + end.x) / 2, y: start.y - 3 }
            : { x: start.x - 3, y: (start.y + end.y) / 2 };

        nodes.push(
            labelNode({
                at,
                text: fallbackText,
                colour: colourOf({ stroke: horizontal ? COMPONENT_COLOURS.x : COMPONENT_COLOURS.y }),
                font,
                anchor: horizontal ? "north" : "east",
            }),
        );
    };

    if (geometry.showX !== false) {
        const fx = Number(geometry.forceX);
        const text = valuesShown(object) && Number.isFinite(fx)
            ? `$F_x = ${formatNumber(fx)}\\ ${unit}$`
            : "$F_x$";

        place(geometry.horizontal, text);
    }

    if (geometry.showY !== false) {
        const fy = Number(geometry.forceY);
        const text = valuesShown(object) && Number.isFinite(fy)
            ? `$F_y = ${formatNumber(fy)}\\ ${unit}$`
            : "$F_y$";

        place(geometry.vertical, text);
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
        /*
         * The axis names, in the place a reader looks for them.
         *
         * THE UNIT IS SET IN MATHS MODE. The moment unit is `N\cdot m`, and
         * `\cdot` outside `$...$` is a TeX error - one that stopped the WHOLE
         * document, so a single Bending Moment Diagram blanked every object on
         * the sheet while all of their code sat correctly in Source.
         */
        nodes.push(
            labelNode({
                at: { x: Number(start.x) - 2, y: Number(start.y) + 13 },
                text: `$${axes.y}$ ($\\mathrm{${axes.unit}}$)`,
                colour,
                font,
                anchor: "north east",
            }),
        );

        nodes.push(
            labelNode({
                at: { x: Number(end.x) + 2, y: Number(start.y) + 6 },
                text: `$${axes.x}$ ($\\mathrm{${axes.xUnit}}$)`,
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
     *
     * THE NAME IS ONLY WRITTEN WHEN THE STUDENT ASKED FOR IT. `showName` is a
     * separate decision from "has a name" - every object has a name, because the
     * Objects list needs one - so coupling the two is what put "Point Force" on
     * every force. A student who ticks Show Name still gets it; everybody else
     * gets nothing.
     *
     * TYPES THAT WRITE THEIR OWN LABEL are skipped here: a force, a load, a
     * moment and a diagram already place `object.label` beside their value, with
     * the offset and anchor that suit their shape, and adding it a second time
     * from this anchor would print it twice.
     */
    const explicit = typeof object.label === "string" ? object.label.trim() : "";
    const shownName = object.showName === true && typeof object.name === "string" ? object.name.trim() : "";
    const ownLabel = explicit || shownName;

    const carriesOwnLabel = new Set([
        "force",
        "load",
        "varying-load",
        "moment",
        "resultant",
        "force-components",
        "analysis-diagram",
        "shear-force-diagram",
        "bending-moment-diagram",
        "axial-force-diagram",
    ]).has(object.type);

    if (ownLabel && !carriesOwnLabel && labelsShown(object)) {
        const geometry = object.geometry || {};
        const colour = nodeColourOf(object);
        const font = fontFor(object.style);

        const at = geometry.position || geometry.center || geometry.origin || geometry.start;

        if (at && Number.isFinite(Number(at.x)) && Number.isFinite(Number(at.y))) {
            nodes.push(
                labelNode({
                    at: { x: Number(at.x) + 4, y: Number(at.y) + 4 },
                    text: texText(ownLabel),
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

    /*
     * THE SAME PARSER THE SOURCE TAB USES, so a generator's line numbers and
     * the editor's regions can never disagree about where a block begins. The
     * parser understands the readable header as well as the legacy markers.
     */
    const block = createSourceMap(list.join("\n")).block(id);

    if (!block) {
        return null;
    }

    return {
        beginLine: block.beginLine,
        endLine: block.endLine,
        bodyStartLine: block.bodyStartLine,
        bodyEndLine: block.bodyEndLine,
    };
}

export default {
    num,
    point,
    exportPoint,
    sketchStrokeCommands,
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
