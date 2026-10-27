/*
 * ============================================================
 * THE FEATURE SCHEMA - WHAT CAN BE EDITED ON A SELECTION
 * ============================================================
 *
 * The Features tab is a UNIVERSAL editor: it describes whatever is selected,
 * whichever tool category made it. That description is data, not markup:
 *
 *   groupsFor(object)        the sections and fields one object offers
 *   readField(object, key)   the object's CURRENT value for a field
 *   writeField(object, key)  apply a new value to that field
 *   supportsTransform(obj)   whether Transform applies at all
 *
 * Adding a category is adding an entry to `GROUPS`; the pane that renders it
 * does not learn about Geometry, and Geometry does not leak into an
 * annotation, a force or a beam.
 *
 * A FIELD IS DECLARED ONCE, AND APPLIES WHERE IT IS DECLARED. Every field has
 * an `applies` predicate, so a selection of a Line and a Circle exposes the
 * shared Appearance and Transform, a mixed selection still exposes a Polygon's
 * Number of Sides for the polygons in it, and nothing invents a property for
 * an object that does not have one.
 *
 * MIXED VALUES ARE READ FROM THE SELECTION, NOT GUESSED HERE. `readField`
 * answers for ONE object; the pane compares those answers across compatible
 * objects and shows a mixed state when they disagree. That keeps "what is the
 * value" and "do they all agree" separate responsibilities.
 */

import enggFeatureGeometry from "../../../shared/geometry/feature-geometry.js";
import { isProcessDiagram } from "../../../features/workspace/model/thermodynamics/saturation-curve.js";
import enggPipeDuct from "../../../features/workspace/model/fluids/pipe-duct.js";
import { THICKNESS_PRESETS } from "../../../tool-library/shared/primitives/tikz-primitives.js";
import { toolIcons } from "../toolbar/tools.js";
import { isDynamicsObject, dynamicsTypeOf } from "../../../features/workspace/dynamics/dynamics-tools.js";

const COORDINATE_SYSTEM = "coordinate-system-2d";

/*
 * The nine Geometry types the Features tab specifies in detail. They are the
 * `appearance`, `object` and `transform` core of a Geometry selection; every
 * other type keeps its own values and gains the same core only where its
 * underlying object genuinely has those properties.
 */
export const GEOMETRY_TYPES = new Set([
    "point",
    "line",
    "triangle",
    "rectangle",
    "circle",
    "arc",
    "polygon",
    "freeform-polygon",
    COORDINATE_SYSTEM
]);

const CLOSED_SHAPES = new Set(["triangle", "rectangle", "circle", "polygon", "freeform-polygon"]);

/* The types a fill (and therefore a fill colour) means anything for. */
const FILLABLE = CLOSED_SHAPES;

/*
 * The types whose stroke can be dashed, dotted or otherwise styled.
 *
 * THE DYNAMICS SYMBOLS ARE HERE because every one of them is drawn with a pen:
 * a spring's zigzag, a damper's outline, a vector's shaft, a trajectory's path.
 * Without them the Appearance section would be missing from exactly the tools
 * that need a colour and a weight most.
 */
const STROKE_TYPES = new Set([
    "line",
    "triangle",
    "rectangle",
    "circle",
    "arc",
    "polygon",
    "freeform-polygon",
    "polyline",
    COORDINATE_SYSTEM,
    "dynamics-trajectory",
    "dynamics-polar-vector",
    "dynamics-angular-vector",
    "dynamics-spring",
    "dynamics-damper",
    "dynamics-spring-damper",
    "dynamics-pulley"
]);

/*
 * ============================================================
 * THICKNESS: THE NAMED PRESETS AND THEIR WIDTHS
 * ============================================================
 *
 * Six presets, no Hairline. The numbers come from the primitives' own table so
 * a named width chosen here and one read back from a saved file resolve to the
 * same stroke - there is one conversion, and it already exists.
 *
 * A stored width that is not a preset is "Custom", with its own numeric field.
 */
/*
 * ============================================================
 * THICKNESS: THE NAMED PRESETS AND THEIR WIDTHS
 * ============================================================
 *
 * Seven presets, from Ultra Thin to Ultra Thick. The numbers come from the
 * primitives' own table (`tikz-style.js`) so a named width chosen here and one
 * read back from a saved file resolve to the same stroke - there is one
 * conversion, and it already exists.
 *
 * THE VALUES ARE POINTS, and they are TikZ's own: `thin` is 0.4pt because that
 * is what `thin` means to TikZ. A nominal width is a PHYSICAL size, which is what
 * lets the export reduce it with the drawing and produce a stroke that reads
 * correctly at the figure's real size. The model keeps whichever preset the
 * student chose and is never rewritten by an export.
 *
 * A stored width that is not a preset is "Custom", with its own numeric field.
 */
export const THICKNESS_OPTIONS = [
    { value: "ultra-thin", label: "Ultra Thin", width: THICKNESS_PRESETS["ultra-thin"] },
    { value: "very-thin", label: "Very Thin", width: THICKNESS_PRESETS["very-thin"] },
    { value: "thin", label: "Thin", width: THICKNESS_PRESETS.thin },
    { value: "semi-thick", label: "Semi-Thick", width: THICKNESS_PRESETS["semi-thick"] },
    { value: "thick", label: "Thick", width: THICKNESS_PRESETS.thick },
    { value: "very-thick", label: "Very Thick", width: THICKNESS_PRESETS["very-thick"] },
    { value: "ultra-thick", label: "Ultra Thick", width: THICKNESS_PRESETS["ultra-thick"] }
];

export const CUSTOM_THICKNESS_MIN = 0.05;
export const CUSTOM_THICKNESS_MAX = 20;
export const CUSTOM_THICKNESS_STEP = 0.05;

/*
 * WHICH PRESET A STORED WIDTH IS.
 *
 * The model accepts BOTH forms - a number (0.4) and a preset's own name ("thin") -
 * because a saved document and a tool default may carry either, and the
 * primitives' resolver reads both. So both are recognised here: a numeric width
 * matches the preset with that width, and a named one IS that preset. Anything
 * else is Custom, which is the honest answer for a width the presets cannot
 * describe.
 */
/*
 * WHICH PRESET A STORED WIDTH IS.
 *
 * The model accepts BOTH forms - a number (0.4) and a preset's own name ("thin") -
 * because a saved document and a tool default may carry either, and the
 * primitives' resolver reads both. So both are recognised here: a numeric width
 * matches the preset with that width, and a named one IS that preset.
 *
 * THE OLD PRESET NAMES ARE STILL UNDERSTOOD. A drawing saved before the presets
 * became TikZ's physical points carries "normal" or "medium", and a sheet that
 * opens with its Thickness control blank would look as though the width had been
 * lost. They map to the nearest current preset - the width the student was used
 * to seeing - rather than to Custom, which would suggest a value they never
 * typed.
 */
const LEGACY_PRESETS = {
    normal: "thin",
    medium: "semi-thick",
    hairline: "ultra-thin"
};

/*
 * THE OLD NUMERIC PRESETS, for a file saved before the switch.
 *
 * The widths the panel used to store were model units on a different scale; a
 * drawing that carries one is given the CURRENT preset that was drawn closest to
 * it, so the control opens showing a width rather than Custom.
 */
const LEGACY_WIDTHS = [
    { width: 0.25, preset: "very-thin" },
    { width: 0.5, preset: "thin" },
    { width: 0.75, preset: "semi-thick" },
    { width: 1.25, preset: "thick" },
    { width: 2, preset: "very-thick" },
    { width: 3, preset: "ultra-thick" }
];

function presetOfWidth(width) {
    if (typeof width === "string") {
        const named = width.toLowerCase();

        if (THICKNESS_OPTIONS.some((option) => option.value === named)) {
            return named;
        }

        return LEGACY_PRESETS[named] || "custom";
    }

    const match = THICKNESS_OPTIONS.find((option) => Math.abs(option.width - width) < 1e-9);

    if (match) {
        return match.value;
    }

    const legacy = LEGACY_WIDTHS.find((entry) => Math.abs(entry.width - width) < 1e-9);

    return legacy ? legacy.preset : "custom";
}

/*
 * The Thickness control's value. An absent width is Normal, which is what the
 * rest of the application already treats it as; a width that is not one of the
 * presets is Custom.
 */
export function thicknessOf(object) {
    const stored = object?.style?.lineWidth;

    if (stored === undefined || stored === null || stored === "") {
        return "thin";
    }

    /*
     * THE CUSTOM MARKER WINS OVER THE NUMBER.
     *
     * A width of exactly 2 is also the "thick" preset, so a number alone cannot
     * say whether the student CHOSE thick or typed 2. `style.lineWidthCustom`
     * records that second case - it is the only way Custom survives a save, and
     * without it the control would silently switch the student back to a preset
     * after any edit. Choosing a preset clears it.
     */
    if (object?.style?.lineWidthCustom === true) {
        return "custom";
    }

    const width = typeof stored === "string" ? stored.trim().toLowerCase() : Number(stored);

    if (typeof width === "string" && (!/^[-\d.]+$/.test(width) || width === "")) {
        /* A NAME, not a number: it either is a preset or it is not one we know. */
        return presetOfWidth(width);
    }

    return Number.isFinite(Number(width)) && Number(width) > 0 ? presetOfWidth(Number(width)) : "normal";
}

/*
 * The numeric width the Custom box shows. A stored NAME is resolved through the
 * one preset table, so a "thin" line opens its Custom box at 0.4 rather than at
 * NaN.
 */
export function customThicknessOf(object) {
    const stored = object?.style?.lineWidth;

    if (typeof stored === "string") {
        const preset = THICKNESS_OPTIONS.find((option) => option.value === stored.toLowerCase());

        return preset ? preset.width : THICKNESS_PRESETS.thin;
    }

    return Number.isFinite(stored) && stored > 0 ? stored : THICKNESS_PRESETS.thin;
}

/* ============================================================
 * COLOUR
 * ============================================================ */

/*
 * The stroke a feature is actually painted with. An absent stroke follows the
 * application's default line colour, and the panel shows that same value - so
 * "no colour chosen" is displayed as the ink the student can see rather than as
 * an empty swatch that would imply "no line".
 */
const LIGHT_DEFAULT_STROKE = "#193335";

function defaultStroke() {
    /*
     * The canvas reads its own default from the theme, which is set on the root
     * element after a theme change. Asking the document keeps one answer: the
     * swatch shows the colour the line is really drawn in, in either theme.
     */
    const dom = globalThis.document;
    const resolved = dom?.documentElement
        ? dom.defaultView?.getComputedStyle?.(dom.documentElement)
              ?.getPropertyValue?.("--datum-canvas-ink")
              ?.trim()
        : "";

    return /^#[0-9a-fA-F]{6}$/.test(resolved || "") ? resolved : LIGHT_DEFAULT_STROKE;
}

export function strokeOf(object) {
    const stroke = String(object?.style?.stroke || "");

    return /^#[0-9a-fA-F]{6}$/.test(stroke) ? stroke : defaultStroke();
}

export function fillModeOf(object) {
    return String(object?.style?.fillMode || "none").toLowerCase() === "solid" ? "solid" : "none";
}

export function fillColourOf(object) {
    const fill = String(object?.style?.fill || "");

    if (/^#[0-9a-fA-F]{6}$/.test(fill) && fill.toLowerCase() !== "none") {
        return fill;
    }

    return strokeOf(object);
}

function setStroke(object, value) {
    if (!/^#[0-9a-fA-F]{6}$/.test(String(value || ""))) {
        return false;
    }

    object.style = { ...(object.style || {}), stroke: value };

    return true;
}

function setFillMode(object, value) {
    if (value !== "none" && value !== "solid") {
        return false;
    }

    const style = { ...(object.style || {}), fillMode: value };

    if (value === "solid" && !fillColourOf(object)) {
        style.fill = strokeOf(object);
    }

    if (value === "none") {
        style.fill = "none";
    }

    object.style = style;

    return true;
}

function setFillColour(object, value) {
    if (!/^#[0-9a-fA-F]{6}$/.test(String(value || ""))) {
        return false;
    }

    object.style = { ...(object.style || {}), fill: value, fillMode: "solid" };

    return true;
}

/* ============================================================
 * LABELS
 * ============================================================ */

/*
 * THE FEATURE'S `name` IS NOT ITS LABEL. `name` is what the object is called in
 * the inventory ("Line 3"); `label` is what is written beside it on the sheet.
 * The Label field writes the latter, so renaming an object and annotating it
 * stay two different things.
 *
 * A Line, a Point and an Annotation all have one, so it is declared once for
 * every object rather than per type.
 */
export function labelOf(object) {
    return typeof object?.label === "string" ? object.label : "";
}

export function textOfAnnotation(object) {
    if (!object || object.type !== "annotate") {
        return "";
    }

    return typeof object.text === "string" ? object.text : "";
}

/* ============================================================
 * THE COORDINATE SYSTEM'S OWN TOGGLES AND TEXT
 * ============================================================ */

function showXAxisOf(object) {
    return object?.geometry?.showXAxis !== false;
}

function showYAxisOf(object) {
    return object?.geometry?.showYAxis !== false;
}

function showLabelsOf(object) {
    return object?.geometry?.showLabels !== false;
}

function axisLabelOf(object, key, fallback) {
    const stored = object?.geometry?.[key];

    return typeof stored === "string" ? stored : fallback;
}

/* ============================================================
 * THE FIELD TABLE
 * ============================================================
 *
 * Each field is:
 *
 *   key        the property name, also the `data-feature-field` hook
 *   label      the visible row label
 *   kind       "choice" | "segmented" | "colour" | "toggle" | "number" | "text"
 *   applies    whether this field belongs to this object at all
 *   read       the object's current value
 *   write      apply a value; return false when it was refused
 *   options    the choices for a choice/segmented field
 *   min/step/integer   the bounds of a numeric field
 *   visible    a follow-on rule - a field with no `visible` is always shown
 */
const ANNOTATE_ARROWHEAD_KINDS = new Set(["arrow", "leader", "callout"]);
const ANNOTATE_ARROWHEAD_VALUES = new Set(["closed", "open", "none"]);
const ARROW_VALUES = new Set(["none", "open", "filled", "bar"]);

const ARROW_OPTIONS = [
    { value: "none", label: "None" },
    { value: "open", label: "Open Arrow" },
    { value: "filled", label: "Filled Arrow" },
    { value: "bar", label: "Bar" }
];

const FIELDS = {
    /* ---------------------------------------------------------- Geometry */

    markerStyle: {
        kind: "segmented",
        applies: (object) => object.type === "point",
        read: (object) => (object.style?.markerStyle === "cross" ? "cross" : "dot"),
        write: (object, value) => {
            if (value !== "dot" && value !== "cross") {
                return false;
            }

            object.style = { ...(object.style || {}), markerStyle: value };

            return true;
        },
        options: [
            { value: "dot", label: "Dot" },
            { value: "cross", label: "Cross" }
        ]
    },

    markerSize: {
        kind: "segmented",
        applies: (object) => object.type === "point",
        read: (object) => {
            const size = object.style?.markerSize;

            return ["small", "medium", "large"].includes(size) ? size : "medium";
        },
        write: (object, value) => {
            if (!["small", "medium", "large"].includes(value)) {
                return false;
            }

            object.style = { ...(object.style || {}), markerSize: value };

            return true;
        },
        options: [
            { value: "small", label: "S" },
            { value: "medium", label: "M" },
            { value: "large", label: "L" }
        ]
    },

    lineType: {
        kind: "choice",
        applies: (object) => STROKE_TYPES.has(object.type),
        read: (object) => {
            const type = object.style?.lineType;

            return ["solid", "dashed", "dotted"].includes(type) ? type : "solid";
        },
        write: (object, value) => {
            if (!["solid", "dashed", "dotted"].includes(value)) {
                return false;
            }

            object.style = { ...(object.style || {}), lineType: value };

            return true;
        },
        options: [
            { value: "solid", label: "Solid" },
            { value: "dashed", label: "Dashed" },
            { value: "dotted", label: "Dotted" }
        ]
    },

    arrowStart: {
        kind: "choice",
        applies: (object) => object.type === "line",
        read: (object) => normaliseArrow(object.style?.arrowStart),
        write: (object, value) => {
            if (!ARROW_VALUES.has(value)) {
                return false;
            }

            object.style = { ...(object.style || {}), arrowStart: value };

            return true;
        },
        options: ARROW_OPTIONS
    },

    arrowEnd: {
        kind: "choice",
        applies: (object) => object.type === "line",
        read: (object) => normaliseArrow(object.style?.arrowEnd),
        write: (object, value) => {
            if (!ARROW_VALUES.has(value)) {
                return false;
            }

            object.style = { ...(object.style || {}), arrowEnd: value };

            return true;
        },
        options: ARROW_OPTIONS
    },

    /*
     * An Arrow, Leader or Callout's head. The renderer and the source writer
     * both read `style.arrowhead`: "closed" (filled), "open" or "none".
     */
    arrowhead: {
        kind: "choice",
        applies: (object) =>
            object.type === "annotate" &&
            ANNOTATE_ARROWHEAD_KINDS.has(object.annotateKind),
        read: (object) => {
            const value = String(object.style?.arrowhead ?? "closed");

            return ANNOTATE_ARROWHEAD_VALUES.has(value) ? value : "closed";
        },
        write: (object, value) => {
            if (!ANNOTATE_ARROWHEAD_VALUES.has(value)) {
                return false;
            }

            object.style = { ...(object.style || {}), arrowhead: value };

            return true;
        },
        options: [
            { value: "closed", label: "Filled Arrow" },
            { value: "open", label: "Open Arrow" },
            { value: "none", label: "None" }
        ]
    },

    sides: {
        kind: "number",
        applies: (object) => object.type === "polygon",
        read: (object) => {
            const sides = Math.round(Number(object.geometry?.sides));

            return Number.isFinite(sides) && sides >= 3 ? sides : 6;
        },
        write: (object, value) => {
            const sides = Math.round(Number(value));

            if (!Number.isFinite(sides) || sides < 3) {
                return false;
            }

            object.geometry = { ...(object.geometry || {}), sides };

            return true;
        },
        min: 3,
        step: 1,
        integer: true
    },

    fillMode: {
        kind: "segmented",
        applies: (object) => FILLABLE.has(object.type),
        read: fillModeOf,
        write: setFillMode,
        options: [
            { value: "none", label: "None" },
            { value: "solid", label: "Solid" }
        ]
    },

    fill: {
        kind: "colour",
        applies: (object) => FILLABLE.has(object.type) && fillModeOf(object) === "solid",
        read: fillColourOf,
        write: setFillColour
    },

    stroke: {
        kind: "colour",
        applies: (object) => STROKE_TYPES.has(object.type),
        read: strokeOf,
        write: setStroke
    },

    lineWidth: {
        kind: "choice",
        applies: (object) => STROKE_TYPES.has(object.type),
        read: thicknessOf,
        write: (object, value) => {
            /*
             * THE NUMBER IS THE MODEL'S OWN FORM.
             *
             * A numeric width is what the object stores and what the renderer
             * and the source both read, so it is accepted directly - that is
             * what the Custom width box writes. The NAMED presets are the
             * interface's vocabulary, and each resolves through the one table
             * that also reads them back, so the two halves cannot disagree.
             */
            if (typeof value === "number") {
                if (
                    !Number.isFinite(value) ||
                    value < CUSTOM_THICKNESS_MIN ||
                    value > CUSTOM_THICKNESS_MAX
                ) {
                    return false;
                }

                /*
                 * A TYPED NUMBER IS A CUSTOM WIDTH, WHETHER OR NOT IT HAPPENS TO
                 * EQUAL A PRESET: 2 is a width the student entered, not a request
                 * for "thick". The marker carries that distinction into the
                 * document.
                 */
                object.style = { ...(object.style || {}), lineWidth: value, lineWidthCustom: true };

                return true;
            }

            const preset = THICKNESS_OPTIONS.find((option) => option.value === value);

            if (!preset) {
                /*
                 * "custom" IS A MODE, NOT A WIDTH. Choosing it stores no new
                 * width - the object keeps the one it has - it only records that
                 * the width is the student's own rather than a preset. That is a
                 * real, persistable property (`lineWidthCustom`), which is why it
                 * is written here rather than left for the pane to fake.
                 */
                if (value === "custom") {
                    object.style = { ...(object.style || {}), lineWidth: customThicknessOf(object), lineWidthCustom: true };

                    return true;
                }

                return false;
            }

            const { lineWidthCustom: discarded, ...style } = object.style || {};

            void discarded;

            object.style = { ...style, lineWidth: preset.width };

            return true;
        },
        options: [...THICKNESS_OPTIONS.map(({ value, label }) => ({ value, label })), { value: "custom", label: "Custom" }]
    },

    customWidth: {
        kind: "number",
        applies: (object) => STROKE_TYPES.has(object.type) && thicknessOf(object) === "custom",
        read: customThicknessOf,
        write: (object, value) => {
            const width = Number(value);

            if (
                !Number.isFinite(width) ||
                width < CUSTOM_THICKNESS_MIN ||
                width > CUSTOM_THICKNESS_MAX
            ) {
                return false;
            }

            object.style = { ...(object.style || {}), lineWidth: width };

            return true;
        },
        min: CUSTOM_THICKNESS_MIN,
        max: CUSTOM_THICKNESS_MAX,
        step: CUSTOM_THICKNESS_STEP,
        unit: "px"
    },

    fixed: {
        kind: "toggle",
        applies: isLockable,
        read: (object) => object.locked === true,
        write: (object, value) => {
            const locked = Boolean(value);

            if (locked) {
                object.locked = true;
            } else {
                delete object.locked;
            }

            return true;
        },
        label: "Fix"
    },

    /* ------------------------------------------- Coordinate System */

    showXAxis: {
        kind: "toggle",
        applies: (object) => object.type === COORDINATE_SYSTEM,
        read: showXAxisOf,
        write: (object, value) => setGeometryFlag(object, "showXAxis", value)
    },

    showYAxis: {
        kind: "toggle",
        applies: (object) => object.type === COORDINATE_SYSTEM,
        read: showYAxisOf,
        write: (object, value) => setGeometryFlag(object, "showYAxis", value)
    },

    showLabels: {
        kind: "toggle",
        applies: (object) => object.type === COORDINATE_SYSTEM,
        read: showLabelsOf,
        write: (object, value) => setGeometryFlag(object, "showLabels", value)
    },

    xLabel: {
        kind: "text",
        applies: (object) => (object.type === COORDINATE_SYSTEM && showLabelsOf(object)) || isProcessDiagram(object),
        read: (object) => axisLabelOf(object, "xLabel", isProcessDiagram(object) ? "" : "x"),
        write: (object, value) => setGeometryText(object, "xLabel", value)
    },

    yLabel: {
        kind: "text",
        applies: (object) => (object.type === COORDINATE_SYSTEM && showLabelsOf(object)) || isProcessDiagram(object),
        read: (object) => axisLabelOf(object, "yLabel", isProcessDiagram(object) ? "" : "y"),
        write: (object, value) => setGeometryText(object, "yLabel", value)
    },

    originLabel: {
        kind: "text",
        applies: (object) => object.type === COORDINATE_SYSTEM && showLabelsOf(object),
        read: (object) => axisLabelOf(object, "originLabel", "O"),
        write: (object, value) => setGeometryText(object, "originLabel", value)
    },

    /* ------------------------------------------------- Universal */

    label: {
        kind: "text",
        applies: (object) => typeof object?.type === "string" && object.type !== "annotate",
        read: labelOf,
        write: (object, value) => {
            object.label = String(value ?? "");

            return true;
        }
    },

    /*
     * SHOW THE OBJECT'S NAME.
     *
     * The feature's name ("Point Force 1") identifies the object in the Objects
     * list and in the source's comment header. Printing it in the picture is a
     * SEPARATE, explicit choice - which is why this is a switch of its own
     * rather than something inferred from the name being present. Off is the
     * default, so a drawing never gains a label nobody asked for.
     */
    showName: {
        kind: "toggle",
        applies: (object) =>
            typeof object?.type === "string" && object.type !== "annotate" && Boolean(object.name),
        read: (object) => object?.showName === true,
        write: (object, value) => {
            object.showName = Boolean(value);

            return true;
        },
        label: "Show Name"
    },

    workDirection: {
        kind: "choice", label: "Direction",
        applies: object => object.metadata?.thermodynamicsKind === "work-arrow",
        read: object => object.metadata.workDirection || "in",
        options: [{ value: "in", label: "Work In" }, { value: "out", label: "Work Out" }],
        write: (object, value) => {
            if (!["in", "out"].includes(value)) return false;
            if ((object.metadata.workDirection || "in") !== value) {
                [object.geometry.start, object.geometry.end] = [object.geometry.end, object.geometry.start];
                if (["W in", "W out"].includes(object.text)) object.text = `W ${value}`;
            }
            object.metadata = { ...object.metadata, workDirection: value, mathSubscript: value };
            return true;
        }
    },
    text: {
        kind: "text",
        applies: (object) => object.type === "annotate",
        read: textOfAnnotation,
        write: (object, value) => {
            object.text = String(value ?? "");

            return true;
        },
        label: "Text"
    }
};

function setGeometryFlag(object, key, value) {
    object.geometry = { ...(object.geometry || {}), [key]: Boolean(value) };

    return true;
}

function setGeometryText(object, key, value) {
    object.geometry = { ...(object.geometry || {}), [key]: String(value ?? "") };

    return true;
}

/*
 * WHO CAN BE LOCKED.
 *
 * Fixed is a Geometry editing lock, and the Geometry types are exactly the ones
 * which have an appearance of their own and a transform the lock can hold. An
 * annotation, a force or an analysis diagram moves by its own rules - an
 * annotation by its placement, an analysis diagram by an offset from its
 * sources - so imposing a lock on it would fight the model that already owns its
 * position. Those categories keep whatever locking they already have.
 */
const LOCKABLE_TYPES = new Set([
    ...STROKE_TYPES,
    "point",

    /*
     * A PARTICLE IS A MARKER RATHER THAN A LINE, but it is still a Dynamics
     * symbol with an outline, a colour and a size - so Fix applies to it exactly
     * as it does to a spring.
     */
    "particle",
    "rigid-body"
]);

function isLockable(object) {
    /*
     * EVERY DYNAMICS TOOL CAN BE FIXED.
     *
     * Fix is the editor's existing editing lock: a fixed object can still be
     * selected and inspected, but its handles are withdrawn and its geometry
     * cannot be dragged. The specification requires it on every Dynamics tool,
     * including the ones whose stored type (a spring's, a pulley's) is not in
     * the list below, so the Dynamics mark is enough on its own.
     */
    return Boolean(
        object &&
            (LOCKABLE_TYPES.has(object.type) || object.engineering?.dynamicsType)
    );
}

function normaliseArrow(value) {
    const text = String(value ?? "none").toLowerCase();

    return ARROW_VALUES.has(text) ? text : "none";
}

/* ============================================================
 * THE GROUPS
 * ============================================================
 *
 * Order matters: it is the order a student reads the panel in - what the thing
 * IS, then how it looks, then whether it is held, then how it can be moved.
 * A group with no applicable field for the current selection is not rendered,
 * so no empty heading ever appears.
 */
export const GROUPS = [
    { id: "work-arrow", heading: "Work Arrow", fields: ["workDirection"] },
    { id: "marker", heading: "Marker", fields: ["markerStyle", "markerSize"] },
    { id: "line", heading: "Line", fields: ["lineType", "arrowStart", "arrowEnd", "arrowhead"] },
    { id: "shape", heading: "Shape", fields: ["sides"] },
    {
        id: "cross-section",
        heading: "Cross Section",
        fields: ["pipeShape", "pipeDiameter", "pipeWidth", "pipeHeight", "pipeBendRadius", "pipeMaterial", "pipeRoughness"]
    },
    { id: "fill", heading: "Fill", fields: ["fillMode", "fill"] },
    { id: "axes", heading: "Axes", fields: ["showXAxis", "showYAxis"] },
    { id: "labels", heading: "Labels", fields: ["showLabels", "xLabel", "yLabel", "originLabel"] },
    { id: "text", heading: "Text", plainHeading: true, fields: ["label", "showName", "text"] },

    /*
     * ========================================================
     * THE DYNAMICS GROUPS
     * ========================================================
     *
     * One group per symbol, holding only that symbol's own controls. A group
     * whose fields do not apply to the selection is dropped by `groupsFor`
     * below, so a spring never shows a pulley's rope settings and the panel
     * never carries a heading with nothing under it.
     *
     * THE SHARED GROUPS STILL APPLY. Appearance, Fix and Transform are
     * declared once above and are offered to these objects exactly as they are
     * to a line or a circle - the same controls, the same behaviour - so a
     * Dynamics symbol is edited with the vocabulary the student already knows.
     */
    {
        id: "dynamics-particle",
        heading: "Particle",
        fields: ["dynamics.markerStyle", "dynamics.markerRadius"]
    },
    {
        id: "dynamics-rigid-body",
        heading: "Body",
        fields: ["dynamics.showCenterOfMass"]
    },
    {
        id: "dynamics-trajectory",
        heading: "Path",
        fields: ["dynamics.bow", "dynamics.trajectoryArrow"]
    },
    {
        id: "dynamics-polar-vector",
        heading: "Vector",
        fields: ["dynamics.polarArrow", "dynamics.showAngle", "dynamics.angleValue"]
    },
    {
        id: "dynamics-angular-vector",
        heading: "Rotation",
        fields: ["dynamics.direction", "dynamics.angularSweep", "dynamics.angularRadius", "dynamics.angularArrow"]
    },
    {
        id: "dynamics-spring",
        heading: "Spring",
        fields: ["dynamics.coils", "dynamics.springAmplitude", "dynamics.springLead"]
    },
    {
        id: "dynamics-damper",
        heading: "Damper",
        fields: ["dynamics.damperWidth", "dynamics.damperBodyFrom", "dynamics.damperBodyTo"]
    },
    {
        id: "dynamics-spring-damper",
        heading: "Spring–Damper",
        fields: [
            "dynamics.branchSpacing",
            "dynamics.pairCoils",
            "dynamics.pairAmplitude",
            "dynamics.pairDamperWidth",
            "dynamics.springLabel",
            "dynamics.damperLabel"
        ]
    },
    {
        id: "dynamics-pulley",
        heading: "Pulley",
        fields: ["dynamics.wheelRadius", "dynamics.ropeAngle", "dynamics.ropeDrop", "dynamics.ropeGap", "dynamics.showAxle"]
    },
    {
        id: "dynamics-coordinate-system",
        heading: "Origin",
        fields: ["dynamics.showOriginMarker"]
    },
    {
        id: "dynamics-reference-point",
        heading: "Reference Point",
        fields: ["dynamics.referenceMarker"]
    },

    { id: "appearance", heading: "Appearance", fields: ["stroke", "lineWidth", "customWidth"] },
    { id: "object", heading: "Object", fields: ["fixed"], reserveTransform: true },
    { id: "transform", heading: "Transform", fields: [], transform: true }
];

/*
 * ============================================================
 * A PROCESS PATH'S BENDS: ONE FIELD PER SEGMENT
 * ============================================================
 *
 * A process path has as many segments as it has states, so its bend fields
 * cannot be listed in the static table. Each is generated from its key -
 * `processBend:<segment>` - and reads and writes `geometry.segmentBends`, the
 * value the canvas's middle-dot drag sets. -1..1, and 0 is straight.
 */
/*
 * ============================================================
 * A PIPE / DUCT RUN AND AN ELBOW: THE CROSS SECTION
 * ============================================================
 *
 * Ported from the fluids toolset's panel. Everything is on `object.engineering`:
 * the Shape decides which sizes exist (circular: Diameter; rectangular: Width
 * and Height, through the model's `dimensionalKeysFor`), so only those are
 * shown. Sizes and an elbow's Bend Radius must be positive - each decides
 * geometry that cannot exist at zero - while Surface Roughness may be zero (a
 * smooth bore). Lengths are drawing units, which are millimetres on the sheet.
 */
function isFluidRun(object) {
    return object?.type === "pipe-duct" || object?.type === "elbow";
}

function engineeringOf(object) {
    if (!object.engineering || typeof object.engineering !== "object") {
        object.engineering = {};
    }

    return object.engineering;
}

const PIPE_DEFAULT_SIZES = {
    diameter: () => enggPipeDuct.DEFAULT_DIAMETER,
    width: () => enggPipeDuct.DEFAULT_WIDTH,
    height: () => enggPipeDuct.DEFAULT_HEIGHT
};

function pipeSizeField(key) {
    return {
        kind: "number",
        min: 0,
        step: 1,
        applies: (object) => isFluidRun(object) && enggPipeDuct.dimensionalKeysFor(object.engineering || {}).includes(key),
        read: (object) => Number(object.engineering?.[key]) || PIPE_DEFAULT_SIZES[key](),
        write: (object, value) => {
            const size = Number(value);

            if (!Number.isFinite(size) || size <= 0) {
                return false;
            }

            engineeringOf(object)[key] = size;

            return true;
        }
    };
}

Object.assign(FIELDS, {
    pipeShape: {
        kind: "choice",
        applies: isFluidRun,
        read: (object) => object.engineering?.shape === enggPipeDuct.PIPE_SHAPES.rectangular
            ? enggPipeDuct.PIPE_SHAPES.rectangular
            : enggPipeDuct.PIPE_SHAPES.circular,
        write: (object, value) => {
            const engineering = engineeringOf(object);

            engineering.shape = value === enggPipeDuct.PIPE_SHAPES.rectangular
                ? enggPipeDuct.PIPE_SHAPES.rectangular
                : enggPipeDuct.PIPE_SHAPES.circular;

            enggPipeDuct.dimensionalKeysFor(engineering).forEach((size) => {
                if (!Number.isFinite(Number(engineering[size]))) {
                    engineering[size] = PIPE_DEFAULT_SIZES[size]();
                }
            });

            return true;
        },
        options: [
            { value: enggPipeDuct.PIPE_SHAPES.circular, label: "Circular" },
            { value: enggPipeDuct.PIPE_SHAPES.rectangular, label: "Rectangular" }
        ]
    },
    pipeDiameter: pipeSizeField("diameter"),
    pipeWidth: pipeSizeField("width"),
    pipeHeight: pipeSizeField("height"),
    pipeBendRadius: {
        kind: "number",
        min: 0,
        step: 1,
        applies: (object) => object?.type === "elbow",
        read: (object) => Number(object.engineering?.bendRadius) || 0,
        write: (object, value) => {
            const radius = Number(value);
            const geometry = object.geometry || {};

            /* A radius the corner cannot hold has no drawable bend, so it is refused. */
            if (
                !Number.isFinite(radius) ||
                radius <= 0 ||
                !enggPipeDuct.elbowGeometry(geometry.previous, geometry.position, geometry.next, radius)
            ) {
                return false;
            }

            engineeringOf(object).bendRadius = radius;

            return true;
        }
    },
    pipeMaterial: {
        kind: "text",
        applies: isFluidRun,
        read: (object) => String(object.engineering?.material ?? ""),
        write: (object, value) => {
            engineeringOf(object).material = String(value ?? "");

            return true;
        }
    },
    pipeRoughness: {
        kind: "number",
        min: 0,
        step: 0.001,
        applies: isFluidRun,
        read: (object) => Number(object.engineering?.roughness) || 0,
        write: (object, value) => {
            const roughness = Number(value);

            if (!Number.isFinite(roughness) || roughness < 0) {
                return false;
            }

            engineeringOf(object).roughness = roughness;

            return true;
        }
    }
});

const PROCESS_BEND_PREFIX = "processBend:";

/* ============================================================
 * THE DYNAMICS TOOLS' OWN CONTROLS
 * ============================================================
 *
 * Every Dynamics tool gets the SAME shared controls - Fix, Transform,
 * Appearance and a Label - because those already apply to any object with a
 * style and a geometry. What is added here is what is specific to the symbol
 * itself, and each field is declared once and gated by the `dynamicsType` the
 * object carries.
 *
 * ALL OF THESE ARE DRAWING PARAMETERS. A coil count decides how many zigzags
 * are drawn, a body width decides how wide the cylinder is, a sweep decides
 * how far the arc turns. None of them computes a stiffness, a damping
 * coefficient, a tension, a velocity or an acceleration - these are engineering
 * DRAWING tools, and nothing here derives a value from the geometry.
 *
 * EACH FIELD WRITES THE SAME GEOMETRY THE RENDERER, THE HANDLES AND THE SOURCE
 * WRITER READ, so typing a coil count and dragging the amplitude grip are the
 * same kind of edit, and the picture and the code always agree.
 */

function isDynamicsKind(object, kind) {
    return object?.engineering?.dynamicsType === kind;
}

function dynamicsGeometryOf(object, key, fallback) {
    const value = Number(object?.geometry?.[key]);

    return Number.isFinite(value) ? value : fallback;
}

function writeDynamicsGeometry(object, key, value) {
    object.geometry = { ...(object.geometry || {}), [key]: value };

    return true;
}

/* A numeric drawing parameter of one Dynamics symbol. */
function dynamicsNumberField(kind, key, { min, max, step = 1, integer = false, label }) {
    return {
        kind: "number",
        label,
        min,
        max,
        step,
        integer,
        applies: (object) => isDynamicsKind(object, kind),
        read: (object) => dynamicsGeometryOf(object, key, min ?? 0),
        write: (object, value) => {
            const number = Number(value);

            if (!Number.isFinite(number)) {
                return false;
            }

            if (Number.isFinite(min) && number < min) {
                return false;
            }

            if (Number.isFinite(max) && number > max) {
                return false;
            }

            return writeDynamicsGeometry(object, key, integer ? Math.round(number) : number);
        }
    };
}

/* A yes/no drawing toggle on one Dynamics symbol. */
function dynamicsToggleField(kind, key, label, fallback = true) {
    return {
        kind: "toggle",
        label,
        applies: (object) => isDynamicsKind(object, kind),
        read: (object) => object?.geometry?.[key] !== false && (object?.geometry?.[key] ?? fallback) !== false,
        write: (object, value) => writeDynamicsGeometry(object, key, Boolean(value))
    };
}

/*
 * THE SPRING-DAMPER'S TWO LABELS.
 *
 * One composite carries two annotations, one on each branch, because that is
 * what the symbol IS - a spring and a damper in parallel, each with its own
 * name. They live on `object.labels`, beside the composite's own `label`,
 * and the writer places each on its own branch from the same branch spacing
 * the renderer draws with.
 */
function branchLabelField(key) {
    return {
        kind: "text",
        applies: (object) => isDynamicsKind(object, "dynamics-spring-damper"),
        read: (object) => String(object?.labels?.[key] ?? ""),
        write: (object, value) => {
            object.labels = { ...(object.labels || {}), [key]: String(value ?? "") };

            return true;
        }
    };
}

Object.assign(FIELDS, {
    /* ----------------------------------------------------------- Bodies */

    "dynamics.markerStyle": {
        kind: "segmented",
        label: "Marker",
        applies: (object) => isDynamicsKind(object, "dynamics-particle"),
        read: (object) => (["open", "cross"].includes(object?.geometry?.markerStyle) ? object.geometry.markerStyle : "filled"),
        write: (object, value) => {
            if (!["filled", "open", "cross"].includes(value)) {
                return false;
            }

            return writeDynamicsGeometry(object, "markerStyle", value);
        },
        options: [
            { value: "filled", label: "Filled" },
            { value: "open", label: "Open" },
            { value: "cross", label: "Cross" }
        ]
    },

    "dynamics.markerRadius": dynamicsNumberField("dynamics-particle", "markerRadius", {
        min: 0.6,
        max: 20,
        step: 0.2,
        label: "Display Size"
    }),

    "dynamics.showCenterOfMass": dynamicsToggleField("dynamics-rigid-body", "showCenterOfMass", "Centre of Mass"),

    /* ------------------------------------------------------ Kinematics */

    "dynamics.bow": dynamicsNumberField("dynamics-trajectory", "bow", {
        min: -0.5,
        max: 0.5,
        step: 0.02,
        label: "Curvature"
    }),

    "dynamics.trajectoryArrow": {
        kind: "toggle",
        label: "Direction Arrow",
        applies: (object) => isDynamicsKind(object, "dynamics-trajectory"),
        read: (object) => object?.geometry?.arrowEnd === true,
        write: (object, value) => writeDynamicsGeometry(object, "arrowEnd", Boolean(value))
    },

    "dynamics.polarArrow": {
        kind: "segmented",
        label: "Arrowhead",
        applies: (object) => isDynamicsKind(object, "dynamics-polar-vector"),
        read: (object) => (object?.style?.arrowEnd === "open" ? "open" : "filled"),
        write: (object, value) => {
            if (!["filled", "open"].includes(value)) {
                return false;
            }

            object.style = { ...(object.style || {}), arrowEnd: value };

            return true;
        },
        options: [
            { value: "filled", label: "Filled" },
            { value: "open", label: "Open" }
        ]
    },

    "dynamics.showAngle": dynamicsToggleField("dynamics-polar-vector", "showAngle", "Angle Note", false),

    "dynamics.angleValue": {
        kind: "number",
        label: "Angle Note (°)",
        min: -360,
        max: 360,
        step: 1,
        applies: (object) => isDynamicsKind(object, "dynamics-polar-vector") && object?.geometry?.showAngle === true,
        read: (object) => {
            const stored = Number(object?.geometry?.angleValue);

            if (Number.isFinite(stored)) {
                return stored;
            }

            const g = object.geometry || {};

            return g.start && g.end
                ? Math.round((Math.atan2(g.end.y - g.start.y, g.end.x - g.start.x) * 180) / Math.PI)
                : 0;
        },
        write: (object, value) => {
            const number = Number(value);

            if (!Number.isFinite(number)) {
                return false;
            }

            return writeDynamicsGeometry(object, "angleValue", number);
        }
    },

    "dynamics.direction": {
        kind: "segmented",
        label: "Direction",
        applies: (object) => isDynamicsKind(object, "dynamics-angular-vector"),
        read: (object) => (String(object?.geometry?.direction || "ccw").toLowerCase() === "cw" ? "cw" : "ccw"),
        write: (object, value) => {
            if (!["ccw", "cw"].includes(value)) {
                return false;
            }

            return writeDynamicsGeometry(object, "direction", value);
        },
        options: [
            { value: "ccw", label: "Anti-clockwise" },
            { value: "cw", label: "Clockwise" }
        ]
    },

    "dynamics.angularSweep": dynamicsNumberField("dynamics-angular-vector", "sweep", {
        min: 5,
        max: 360,
        step: 5,
        label: "Sweep (°)"
    }),

    "dynamics.angularRadius": dynamicsNumberField("dynamics-angular-vector", "radius", {
        min: 1,
        max: 400,
        step: 1,
        label: "Radius"
    }),

    "dynamics.angularArrow": {
        kind: "segmented",
        label: "Arrowhead",
        applies: (object) => isDynamicsKind(object, "dynamics-angular-vector"),
        read: (object) => (String(object?.geometry?.arrowHead || "filled") === "open" ? "open" : "filled"),
        write: (object, value) => {
            if (!["filled", "open"].includes(value)) {
                return false;
            }

            return writeDynamicsGeometry(object, "arrowHead", value);
        },
        options: [
            { value: "filled", label: "Filled" },
            { value: "open", label: "Open" }
        ]
    },

    /* ------------------------------------------------ Mechanical elements */

    "dynamics.coils": dynamicsNumberField("dynamics-spring", "coils", {
        min: 1,
        max: 20,
        step: 1,
        integer: true,
        label: "Coils"
    }),

    "dynamics.springAmplitude": dynamicsNumberField("dynamics-spring", "amplitude", {
        min: 0.5,
        max: 30,
        step: 0.5,
        label: "Coil Height"
    }),

    "dynamics.springLead": dynamicsNumberField("dynamics-spring", "lead", {
        min: 0,
        max: 0.4,
        step: 0.02,
        label: "End Lead"
    }),

    "dynamics.damperWidth": dynamicsNumberField("dynamics-damper", "bodyWidth", {
        min: 1,
        max: 40,
        step: 0.5,
        label: "Body Width"
    }),

    "dynamics.damperBodyFrom": dynamicsNumberField("dynamics-damper", "bodyFrom", {
        min: 0.05,
        max: 0.9,
        step: 0.02,
        label: "Body Start"
    }),

    "dynamics.damperBodyTo": dynamicsNumberField("dynamics-damper", "bodyTo", {
        min: 0.1,
        max: 0.95,
        step: 0.02,
        label: "Body End"
    }),

    "dynamics.branchSpacing": dynamicsNumberField("dynamics-spring-damper", "branchSpacing", {
        min: 1,
        max: 40,
        step: 1,
        label: "Branch Separation"
    }),

    "dynamics.pairCoils": dynamicsNumberField("dynamics-spring-damper", "coils", {
        min: 1,
        max: 20,
        step: 1,
        integer: true,
        label: "Spring Coils"
    }),

    "dynamics.pairAmplitude": dynamicsNumberField("dynamics-spring-damper", "amplitude", {
        min: 0.5,
        max: 30,
        step: 0.5,
        label: "Spring Coil Height"
    }),

    "dynamics.pairDamperWidth": dynamicsNumberField("dynamics-spring-damper", "bodyWidth", {
        min: 1,
        max: 40,
        step: 0.5,
        label: "Damper Body Width"
    }),

    "dynamics.springLabel": Object.assign(branchLabelField("spring"), { label: "Spring Label" }),
    "dynamics.damperLabel": Object.assign(branchLabelField("damper"), { label: "Damper Label" }),

    "dynamics.wheelRadius": dynamicsNumberField("dynamics-pulley", "radius", {
        min: 2,
        max: 200,
        step: 1,
        label: "Wheel Size"
    }),

    "dynamics.ropeAngle": dynamicsNumberField("dynamics-pulley", "ropeAngle", {
        min: -180,
        max: 180,
        step: 5,
        label: "Rope Direction (°)"
    }),

    "dynamics.ropeDrop": dynamicsNumberField("dynamics-pulley", "ropeDrop", {
        min: 2,
        max: 400,
        step: 1,
        label: "Rope Length"
    }),

    "dynamics.ropeGap": dynamicsNumberField("dynamics-pulley", "ropeGap", {
        min: 2,
        max: 200,
        step: 1,
        label: "Rope Spacing"
    }),

    "dynamics.showAxle": dynamicsToggleField("dynamics-pulley", "showAxle", "Axle Marker"),

    /* -------------------------------------------------------- Reference */

    "dynamics.showOriginMarker": dynamicsToggleField("dynamics-coordinate-system", "showOriginMarker", "Origin Marker"),

    "dynamics.referenceMarker": {
        kind: "segmented",
        label: "Marker",
        applies: (object) => isDynamicsKind(object, "dynamics-reference-point"),
        read: (object) => (object?.style?.markerStyle === "dot" ? "dot" : "cross"),
        write: (object, value) => {
            if (!["dot", "cross"].includes(value)) {
                return false;
            }

            object.style = { ...(object.style || {}), markerStyle: value };

            return true;
        },
        options: [
            { value: "dot", label: "Dot" },
            { value: "cross", label: "Cross" }
        ]
    }
});

/*
 * THE FIELD THAT IS GENERATED FROM A KEY, rather than listed above.
 *
 * Every Dynamics field shares one namespace prefix, so a key that starts with
 * it resolves to the field table without a second lookup list - and a key that
 * does not is handed on to the process-path bends exactly as before.
 */
function dynamicField(key) {
    return typeof key === "string" && FIELDS[key] ? FIELDS[key] : null;
}

/* ============================================================
 * DYNAMICS: THE TOOL-SPECIFIC CONTROLS
 * ============================================================
 *
 * ONE SECTION PER TOOL, and only the controls that tool actually has. They are
 * grouped in `DYNAMICS_GROUPS` below and named by the object's own
 * `engineering.dynamicsType`, so a Spring's panel offers coils and coil height
 * and a Pulley's offers a wheel size and an axle - never a shared form with
 * fields that mean nothing to the symbol in front of the student.
 *
 * EVERY ONE OF THESE IS A VISUAL PARAMETER. A coil count is how the zigzag is
 * drawn; an amplitude is how tall it is; a sweep is how far an arc goes. None
 * of them is a stiffness, a damping coefficient, a tension, a velocity or any
 * other physical quantity - this library draws symbols and does not solve.
 *
 * The shared controls around them come from the existing groups: Fix is the
 * object lock, Transform is the editor's own shift/rotate, and Appearance is
 * the same colour/weight/style the rest of the application uses.
 */

function dynamicsKindOf(object) {
    return object?.engineering?.dynamicsType || null;
}

function geometryNumberOf(object, key, fallback) {
    const value = Number(object?.geometry?.[key]);

    return Number.isFinite(value) ? value : fallback;
}

/* A numeric field on the geometry, bounded, with the panel's own steppers. */
function dynamicsNumber(key, bounds, extra = {}) {
    const { fallback, label, appliesTo, after } = extra;

    return {
        kind: "number",
        label,
        min: bounds.min,
        max: bounds.max,
        step: bounds.step ?? 1,
        integer: bounds.integer === true,
        applies: (object) => Boolean(appliesTo.includes(dynamicsKindOf(object))),
        read: (object) => geometryNumberOf(object, key, fallback),
        write: (object, value) => {
            const number = Number(value);

            if (!Number.isFinite(number)) {
                return false;
            }

            const bounded = Math.max(bounds.min, Math.min(bounds.max, number));

            object.geometry = {
                ...(object.geometry || {}),
                [key]: bounds.integer ? Math.round(bounded) : bounded
            };

            if (typeof after === "function") {
                after(object);
            }

            return true;
        }
    };
}

/* A named on/off flag on the geometry, read the way the renderer defaults it. */
function dynamicsFlag(key, label, kinds, defaultValue = true) {
    return {
        kind: "toggle",
        label,
        applies: (object) => kinds.includes(dynamicsKindOf(object)),
        read: (object) => object?.geometry?.[key] !== false ? object?.geometry?.[key] ?? defaultValue : false,
        write: (object, value) => {
            object.geometry = { ...(object.geometry || {}), [key]: Boolean(value) };

            return true;
        }
    };
}

/* A named option on the geometry. */
function dynamicsChoice(key, label, kinds, options, fallback) {
    return {
        kind: "choice",
        label,
        applies: (object) => kinds.includes(dynamicsKindOf(object)),
        read: (object) => {
            const stored = String(object?.geometry?.[key] ?? fallback).toLowerCase();

            return options.some((option) => option.value === stored) ? stored : fallback;
        },
        write: (object, value) => {
            if (!options.some((option) => option.value === value)) {
                return false;
            }

            object.geometry = { ...(object.geometry || {}), [key]: value };

            return true;
        },
        options
    };
}

Object.assign(FIELDS, {
    /* ---- Bodies ------------------------------------------------ */

    particleStyle: dynamicsChoice(
        "markerStyle",
        "Marker",
        ["dynamics-particle"],
        [
            { value: "filled", label: "Filled" },
            { value: "open", label: "Open" },
            { value: "cross", label: "Cross" }
        ],
        "filled"
    ),

    markerRadius: dynamicsNumber("markerRadius", { min: 0.4, max: 30, step: 0.2 }, {
        appliesTo: ["dynamics-particle"],
        fallback: 1.6,
        label: "Display Size"
    }),

    showCenterOfMass: dynamicsFlag("showCenterOfMass", "Centre of Mass", ["dynamics-rigid-body"]),

    /* ---- Kinematics -------------------------------------------- */

    trajectoryPath: dynamicsChoice(
        "pathStyle",
        "Path",
        ["dynamics-trajectory"],
        [
            { value: "curved", label: "Curved" },
            { value: "straight", label: "Straight" }
        ],
        "curved"
    ),

    bow: dynamicsNumber("bow", { min: -0.5, max: 0.5, step: 0.02 }, {
        appliesTo: ["dynamics-trajectory"],
        fallback: 0.22,
        label: "Curvature"
    }),

    trajectoryArrow: {
        kind: "toggle",
        label: "Direction Arrow",
        applies: (object) => dynamicsKindOf(object) === "dynamics-trajectory",
        read: (object) => object?.geometry?.arrowEnd === true,
        write: (object, value) => {
            object.geometry = { ...(object.geometry || {}), arrowEnd: Boolean(value) };

            return true;
        }
    },

    vectorArrowHead: dynamicsChoice(
        "arrowHead",
        "Arrowhead",
        ["dynamics-polar-vector", "dynamics-angular-vector"],
        [
            { value: "filled", label: "Filled" },
            { value: "open", label: "Open" }
        ],
        "filled"
    ),

    /*
     * AN ANGLE ANNOTATION IS TEXT THE STUDENT ASKED FOR.
     *
     * It is their own note about the drawing, never a value the tool derived
     * from the geometry and printed as an answer - which is why it is switched
     * on and typed rather than computed.
     */
    showAngle: {
        kind: "toggle",
        label: "Angle Note",
        applies: (object) => dynamicsKindOf(object) === "dynamics-polar-vector",
        read: (object) => object?.geometry?.showAngle === true,
        write: (object, value) => {
            object.geometry = { ...(object.geometry || {}), showAngle: Boolean(value) };

            return true;
        }
    },

    sweep: dynamicsNumber("sweep", { min: 5, max: 360, step: 5 }, {
        appliesTo: ["dynamics-angular-vector"],
        fallback: 270,
        label: "Sweep (°)"
    }),

    angularDirection: dynamicsChoice(
        "direction",
        "Direction",
        ["dynamics-angular-vector"],
        [
            { value: "ccw", label: "Anti-clockwise" },
            { value: "cw", label: "Clockwise" }
        ],
        "ccw"
    ),

    /* ---- Mechanical elements ----------------------------------- */

    coils: dynamicsNumber("coils", { min: 1, max: 24, step: 1, integer: true }, {
        appliesTo: ["dynamics-spring", "dynamics-spring-damper"],
        fallback: 6,
        label: "Coils"
    }),

    amplitude: dynamicsNumber("amplitude", { min: 0.5, max: 20, step: 0.5 }, {
        appliesTo: ["dynamics-spring", "dynamics-spring-damper"],
        fallback: 4,
        label: "Coil Height"
    }),

    lead: dynamicsNumber("lead", { min: 0, max: 0.4, step: 0.02 }, {
        appliesTo: ["dynamics-spring", "dynamics-spring-damper"],
        fallback: 0.18,
        label: "End Lead"
    }),

    bodyWidth: dynamicsNumber("bodyWidth", { min: 1, max: 40, step: 0.5 }, {
        appliesTo: ["dynamics-damper", "dynamics-spring-damper"],
        fallback: 6,
        label: "Body Width"
    }),

    bodyTo: dynamicsNumber("bodyTo", { min: 0.3, max: 0.98, step: 0.02 }, {
        appliesTo: ["dynamics-damper", "dynamics-spring-damper"],
        fallback: 0.82,
        label: "Body Length"
    }),

    branchSpacing: dynamicsNumber("branchSpacing", { min: 0, max: 40, step: 1 }, {
        appliesTo: ["dynamics-spring-damper"],
        fallback: 7,
        label: "Branch Separation"
    }),

    pulleyRadius: dynamicsNumber("radius", { min: 1, max: 80, step: 1 }, {
        appliesTo: ["dynamics-pulley"],
        fallback: 8,
        label: "Wheel Size"
    }),

    ropeDrop: dynamicsNumber("ropeDrop", { min: 1, max: 200, step: 1 }, {
        appliesTo: ["dynamics-pulley"],
        fallback: 24,
        label: "Rope Length"
    }),

    showAxle: dynamicsFlag("showAxle", "Axle Marker", ["dynamics-pulley"]),

    /*
     * THE TWO LABELS A SPRING-DAMPER CARRIES, one per branch.
     *
     * They live in `object.labels` rather than in `object.label` because there
     * are two of them and each names a different branch - so a student can
     * write `k` on the spring and `c` on the damper, which is the whole reason
     * the combined element exists.
     */
    springLabel: {
        kind: "text",
        label: "Spring Label",
        applies: (object) => dynamicsKindOf(object) === "dynamics-spring-damper",
        read: (object) => String(object?.labels?.spring ?? ""),
        write: (object, value) => {
            object.labels = { ...(object.labels || {}), spring: String(value ?? "") };

            return true;
        }
    },

    damperLabel: {
        kind: "text",
        label: "Damper Label",
        applies: (object) => dynamicsKindOf(object) === "dynamics-spring-damper",
        read: (object) => String(object?.labels?.damper ?? ""),
        write: (object, value) => {
            object.labels = { ...(object.labels || {}), damper: String(value ?? "") };

            return true;
        }
    },

    /* ---- Reference --------------------------------------------- */

    showOriginMarker: dynamicsFlag("showOriginMarker", "Origin Marker", ["dynamics-coordinate-system"])
});

/*
 * THE DYNAMICS SECTIONS, in reading order: what the symbol is, how it is
 * drawn, then where its labels go. A section with no applicable field for the
 * selection is not rendered, so a Spring never shows a Pulley's wheel size.
 */
export const DYNAMICS_GROUPS = [
    {
        id: "dynamics-bodies",
        heading: "Body",
        dynamics: true,
        fields: ["particleStyle", "markerRadius", "showCenterOfMass"]
    },
    {
        id: "dynamics-trajectory",
        heading: "Path",
        dynamics: true,
        fields: ["trajectoryPath", "bow", "trajectoryArrow"]
    },
    {
        id: "dynamics-vector",
        heading: "Vector",
        dynamics: true,
        fields: ["vectorArrowHead", "showAngle", "sweep", "angularDirection"]
    },
    {
        id: "dynamics-spring",
        heading: "Spring",
        dynamics: true,
        fields: ["coils", "amplitude", "lead"]
    },
    {
        id: "dynamics-damper",
        heading: "Damper",
        dynamics: true,
        fields: ["bodyWidth", "bodyTo"]
    },
    {
        id: "dynamics-branches",
        heading: "Branches",
        dynamics: true,
        fields: ["branchSpacing"]
    },
    {
        id: "dynamics-pulley",
        heading: "Pulley",
        dynamics: true,
        fields: ["pulleyRadius", "ropeDrop", "showAxle"]
    },
    {
        id: "dynamics-labels",
        heading: "Branch Labels",
        dynamics: true,
        fields: ["springLabel", "damperLabel"]
    },
    {
        id: "dynamics-reference",
        heading: "Reference",
        dynamics: true,
        fields: ["showOriginMarker"]
    }
];

const PROCESS_BEND_PREFIX_UNUSED = PROCESS_BEND_PREFIX;
void PROCESS_BEND_PREFIX_UNUSED;

function isProcessPath(object) {
    return object?.metadata?.thermodynamicsKind === "process-path" && Array.isArray(object.geometry?.points);
}

function processBendField(key) {
    if (typeof key !== "string" || !key.startsWith(PROCESS_BEND_PREFIX)) {
        return null;
    }

    const index = Number(key.slice(PROCESS_BEND_PREFIX.length));

    if (!Number.isInteger(index) || index < 0) {
        return null;
    }

    return {
        kind: "number",
        label: `State ${index + 1} \u2192 ${index + 2}`,
        min: -1,
        max: 1,
        step: 0.05,
        applies: (object) => isProcessPath(object) && index < object.geometry.points.length - 1,
        read: (object) => Number(object.geometry.segmentBends?.[index]) || 0,
        write: (object, value) => {
            const bend = Number(value);

            if (!Number.isFinite(bend)) {
                return false;
            }

            object.geometry.segmentBends = Array.isArray(object.geometry.segmentBends)
                ? [...object.geometry.segmentBends]
                : [];
            object.geometry.segmentBends[index] = Math.max(-1, Math.min(1, bend));

            return true;
        }
    };
}

function definitionOf(key) {
    return FIELDS[key] || rankineDataField(key) || dynamicField(key) || processBendField(key);
}

const RANKINE_DATA_LABELS = {
    state1: "State 1", state2: "State 2", state3: "State 3", state4: "State 4",
    state5: "State 5", state6: "State 6", reheater: "Reheater", highTurbine: "HP Turbine", lowTurbine: "LP Turbine",
    compressor: "Compressor", expansionValve: "Expansion Valve", evaporator: "Evaporator",
    heatAddition: "Heat Addition", heatRejection: "Heat Rejection",
    massFlow: "Mass Flow Rate", boiler: "Boiler", turbine: "Turbine", condenser: "Condenser", pump: "Pump"
};

function rankineDataField(key) {
    if (typeof key !== "string" || !key.startsWith("rankineData.")) return null;
    const name = key.slice("rankineData.".length);
    if (!RANKINE_DATA_LABELS[name]) return null;
    return {
        kind: "text", label: RANKINE_DATA_LABELS[name],
        placeholder: name.startsWith("state") ? "P = 100 kPa; T = 20 C" : "Value and units",
        applies: object => object.metadata?.thermodynamicsKind === "rankine-cycle" &&
            (!["state5", "state6", "reheater", "highTurbine", "lowTurbine"].includes(name) || object.geometry?.reheat === true) &&
            (name !== "compressor" || object.geometry?.refrigeration === true || object.geometry?.brayton === true) &&
            (!["expansionValve", "evaporator"].includes(name) || object.geometry?.refrigeration === true) &&
            (!["heatAddition", "heatRejection"].includes(name) || object.geometry?.brayton === true) &&
            (!["boiler", "pump"].includes(name) || (!object.geometry?.refrigeration && !object.geometry?.brayton)) &&
            (name !== "condenser" || !object.geometry?.brayton) &&
            (name !== "turbine" || !object.geometry?.refrigeration),
        read: object => object.metadata?.problemData?.[name] || "",
        write: (object, value) => {
            object.metadata = { ...object.metadata, problemData: { ...object.metadata?.problemData, [name]: String(value ?? "").trim() } };
            return true;
        }
    };
}

export function fieldDefinition(key) {
    return definitionOf(key) || null;
}

export function fieldLabel(field, key) {
    return field.label || {
        markerStyle: "Style",
        markerSize: "Size",
        lineType: "Style",
        arrowStart: "Begin Arrow",
        arrowEnd: "End Arrow",
        arrowhead: "Arrowhead",
        pipeShape: "Shape",
        pipeDiameter: "Diameter (mm)",
        pipeWidth: "Width (mm)",
        pipeHeight: "Height (mm)",
        pipeBendRadius: "Bend Radius (mm)",
        pipeMaterial: "Material",
        pipeRoughness: "Surface Roughness (mm)",
        sides: "Number of Sides",
        fillMode: "Mode",
        fill: "Fill Colour",
        stroke: "Outline Colour",
        lineWidth: "Thickness",
        customWidth: "Width",
        fixed: "Fix",
        showXAxis: "Show X-axis",
        showYAxis: "Show Y-axis",
        showLabels: "Show Labels",
        xLabel: "X-axis Label",
        yLabel: "Y-axis Label",
        originLabel: "Origin Label",
        label: "Label",
        text: "Text",

        /* The Dynamics fields carry their own labels; these are the fallbacks. */
        "dynamics.coils": "Coils",
        "dynamics.amplitude": "Coil Height",
        "dynamics.bodyWidth": "Body Width",
        "dynamics.branchSpacing": "Branch Separation",
        "dynamics.springLabel": "Spring Label",
        "dynamics.damperLabel": "Damper Label"
    }[key] || key;
}

/*
 * THE LABEL GROUP'S HEADING IS THE FEATURE'S, NOT A PROPERTY'S. A Coordinate
 * System's axis text belongs together under "Labels". A Line's own label and an
 * Annotation's own text belong at the top of the panel, under the feature's
 * title - so their group is marked `plainHeading` and the pane renders it
 * without a heading at all, rather than repeating the title.
 */
export function groupsFor(object) {
    if (!object) {
        return [];
    }

    /*
     * A DYNAMICS SYMBOL'S OWN CONTROLS GO FIRST - straight after the heading,
     * and ahead of Appearance, Object and Transform.
     *
     * The order is the order a student reads the panel in: what the symbol is,
     * then what it looks like, then whether it is held, then how it moves. A
     * group with nothing applicable to THIS object is dropped below, so the
     * panel shows one symbol's real controls rather than a list of sections
     * that might apply to something else.
     */
    const dynamics = isDynamicsObject(object)
        ? DYNAMICS_GROUPS
        : [];

    const groups = [
        { id: "rankine-problem-data", heading: "Problem Data", fields: Object.keys(RANKINE_DATA_LABELS).map(key => `rankineData.${key}`) },
        ...dynamics,
        ...GROUPS
    ]
        .map((group) => {
            const fields = group.fields
                .map((key) => ({ key, definition: definitionOf(key) }))
                .filter((entry) => entry.definition && entry.definition.applies(object));

            return { ...group, fields };
        })
        .filter((group) => group.transform || group.fields.length);

    /* A process path's bends, one per segment, ahead of its appearance. */
    if (isProcessPath(object) && object.geometry.points.length > 1) {
        const fields = object.geometry.points.slice(1).map((_, index) => {
            const key = `${PROCESS_BEND_PREFIX}${index}`;

            return { key, definition: definitionOf(key) };
        });
        const at = groups.findIndex((group) => group.id === "appearance");

        groups.splice(at < 0 ? groups.length : at, 0, { id: "process-bends", heading: "Process Curves", fields });
    }

    return groups;
}

/* ============================================================
 * READING AND WRITING ONE OBJECT
 * ============================================================ */

export function readField(object, key) {
    const definition = definitionOf(key);

    if (!definition || !object || !definition.applies(object)) {
        return undefined;
    }

    return definition.read(object);
}

/*
 * Apply a value to one object. Returns false when the field does not apply or
 * the value was refused, so the caller can count how many objects were really
 * changed rather than assuming the click did something.
 *
 * IT TOUCHES ONE KEY. Writing a colour must not reset a fill mode, and writing
 * a label must not touch the style - each branch above builds the style it
 * changes from the object's own, once.
 */
export function writeField(object, key, value) {
    const definition = definitionOf(key);

    if (!definition || !object || !definition.applies(object)) {
        return false;
    }

    return definition.write(object, value) !== false;
}

/* ============================================================
 * TRANSFORM
 * ============================================================
 */

/*
 * A type's movement is decided where the type is defined. The shared
 * feature-geometry registry is the ONE place that knows how a beam, a symbol, a
 * polygon or a diagram is moved, so the Features tab asks it rather than keeping
 * a second list of "movable types" free to disagree with the first.
 *
 * WHAT IS ASKED IS WHETHER THE MOVE WOULD DO ANYTHING, not whether a type is in a
 * list: a probe copy is translated by a small delta and compared with the
 * original. An object the registry cannot move answers "nothing changed", and
 * Transform is simply not offered for it - rather than offered and inert.
 *
 * The probe is thrown away. Nothing here touches the object the student can see;
 * the real move goes through `transform-session.js`.
 */
export function supportsTransform(object) {
    if (!object || typeof object !== "object" || !object.geometry) {
        return false;
    }

    /*
     * A DYNAMICS SYMBOL MOVES, SO IT HAS A TRANSFORM.
     *
     * The probe below asks the geometry registry whether a small move changes
     * anything, which is the honest test for every stored type. The Dynamics
     * symbols that are drawn from their own geometry answer a slightly
     * different question - their anchors are `start`/`end`/`center`, which the
     * registry now reads for them - but a single-point symbol (a particle, a
     * turn of a wheel about its own hub) would still probe as "nothing
     * changed" for a rotation. Transform is a SHARED control the specification
     * requires on every one of these tools, so it is offered for them directly
     * rather than inferred from a probe that cannot see a rotation.
     */
    if (object.engineering?.dynamicsType) {
        return true;
    }

    const probe = {
        ...object,
        geometry: JSON.parse(JSON.stringify(object.geometry)),
        style: { ...(object.style || {}) }
    };

    try {
        enggFeatureGeometry.translateObject(probe, 0.5, 0.5, () => null);
    } catch {
        return false;
    }

    return JSON.stringify(probe.geometry) !== JSON.stringify(object.geometry);
}

/* ============================================================
 * NAME AND TYPE, FOR THE PANEL HEADER AND THE INVENTORY
 * ============================================================ */

const TYPE_LABELS = {
    "pipe-duct": "Pipe / Duct",
    elbow: "Elbow",
    point: "Point",
    line: "Line",
    polyline: "Polyline",
    triangle: "Triangle",
    rectangle: "Rectangle",
    circle: "Circle",
    arc: "Arc",
    polygon: "Regular Polygon",
    "freeform-polygon": "Freeform Polygon",
    [COORDINATE_SYSTEM]: "Coordinate System",
    particle: "Particle",
    "rigid-body": "Rigid Body",
    beam: "Beam",
    truss: "Truss",
    cable: "Cable",
    shaft: "Shaft",
    force: "Point Force",
    resultant: "Resultant",
    "force-components": "Force Components",
    "shear-force-diagram": "SFD",
    "bending-moment-diagram": "BMD",
    "axial-force-diagram": "AFD",
    moment: "Applied Moment",
    load: "Distributed Load",
    "varying-load": "Varying Distributed Load",
    "pin-support": "Pin Support",
    "roller-support": "Roller Support",
    "fixed-support": "Fixed Support",
    "smooth-support": "Smooth Support",
    "pin-connection": "Pin Connection",
    "fixed-connection": "Fixed Connection",
    "slider-connection": "Slider Connection",
    dimension: "Dimension",
    annotation: "Annotation",
    annotate: "Annotation"
};

export function typeLabelOf(object) {
    if (object?.type === "annotate") {
        return ANNOTATE_TYPE_LABELS[object.annotateKind] || TYPE_LABELS.annotate;
    }

    /*
     * A DYNAMICS SYMBOL IS NAMED FOR ITS TOOL, not for the primitive it stores.
     * A Reference Line is a line underneath and a Spring is its own type - but
     * in the panel both should say what the student drew, so the tool's own
     * label wins over the storage type.
     */
    const dynamicsLabel = dynamicsTypeLabel(object);

    if (dynamicsLabel) {
        return dynamicsLabel;
    }

    if (isProcessDiagram(object)) {
        return object.metadata.thermodynamicsKind === "process-plot" ? "Process Plot" : "Saturation Curve";
    }

    if (isProcessPath(object)) {
        return "Process Path";
    }

    return TYPE_LABELS[object?.type] || "Object";
}

/*
 * THE READABLE NAME OF A DYNAMICS SYMBOL, from the tool that made it.
 *
 * `dynamicsTypeOf` is null for everything that is not a Dynamics object, so
 * this is safe to ask of any object, and a Dynamics object gets its tool's
 * name rather than the generic one its storage type would have given it.
 */
function dynamicsTypeLabel(object) {
    const kind = dynamicsTypeOf(object);

    return kind ? DYNAMICS_TYPE_LABELS[kind] || "Dynamics Object" : null;
}

/* The name each Dynamics tool's object carries in the Objects panel. */
const DYNAMICS_TYPE_LABELS = {
    "dynamics-particle": "Particle",
    "dynamics-rigid-body": "Rigid Body",
    "dynamics-trajectory": "Trajectory",
    "dynamics-polar-vector": "Polar Vector",
    "dynamics-angular-vector": "Angular Vector",
    "dynamics-spring": "Spring",
    "dynamics-damper": "Viscous Damper",
    "dynamics-spring-damper": "Spring–Damper Element",
    "dynamics-pulley": "Pulley",
    "dynamics-coordinate-system": "Coordinate System",
    "dynamics-reference-point": "Reference Point",
    "dynamics-reference-line": "Reference Line",
    "dynamics-reference-arc": "Reference Arc"
};

const ANNOTATE_TYPE_LABELS = {
    note: "Note",
    label: "Label",
    leader: "Leader",
    callout: "Callout",
    arrow: "Arrow",
    symbol: "Symbol",
    tolerance: "Tolerance",
    table: "Table"
};

/*
 * THE INVENTORY'S ICON FOR ONE OBJECT TYPE.
 *
 * The artwork is the toolbar's own - the icon of the tool that makes the thing -
 * so an Arc in the Objects list looks like the Arc tool, and a Beam looks like
 * the Beam tool. Types the toolbar does not name directly are mapped onto the
 * nearest drawing that says what they are, so no row falls back to a generic
 * shape: a Point Force is an arrow, a Resultant is a pair of summed arrows, a
 * Dimension is a dimension line, an SFD is a plotted curve.
 *
 * An unrecognised type gets the neutral "object" mark rather than a wrong one.
 */
const TYPE_ICON_KEYS = {
    point: "Point",
    line: "Line",
    polyline: "Polyline",
    triangle: "Triangle",
    rectangle: "Rectangle",
    circle: "Circle",
    arc: "Arc",
    polygon: "Polygon",
    "freeform-polygon": "Freeform Polygon",
    [COORDINATE_SYSTEM]: "Coordinate System",
    particle: "Particle",
    "rigid-body": "Rigid Body",
    beam: "Beam",
    truss: "Truss",
    cable: "Cable",
    shaft: "Shaft",
    force: "Point Force",
    resultant: "Resultant",
    "force-components": "Force Components",
    moment: "Moment",
    load: "Distributed Load",
    "varying-load": "Varying Distributed Load",
    "pin-support": "Pin Support",
    "roller-support": "Roller Support",
    "fixed-support": "Fixed Support",
    "smooth-support": "Smooth Support",
    "pin-connection": "Pin Connection",
    "fixed-connection": "Fixed Connection",
    "slider-connection": "Slider Connection",
    dimension: "Dimension",
    "shear-force-diagram": "Process Diagrams",
    "bending-moment-diagram": "Process Diagrams",
    "axial-force-diagram": "Process Diagrams",
    annotation: "Annotation",
    annotate: "Annotation"
};

const ANNOTATE_ICON_KEYS = {
    note: "Note / Text",
    label: "Label",
    leader: "Leader",
    callout: "Callout",
    arrow: "Arrow",
    symbol: "Symbol",
    tolerance: "Tolerance",
    table: "Table"
};

const OBJECT_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M10 3l7 4v6l-7 4-7-4V7z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';

export function iconForObject(object) {
    if (!object) {
        return OBJECT_ICON;
    }

    /*
     * A DYNAMICS SYMBOL WEARS THE ICON OF THE TOOL THAT DREW IT, so a Spring in
     * the Objects list looks like the Spring button and a Pulley like the Pulley
     * button - the same artwork, read from the same table the sidebar uses.
     */
    const dynamicsType = dynamicsTypeOf(object);

    if (dynamicsType) {
        const toolIcon = toolIcons[DYNAMICS_TYPE_LABELS[dynamicsType]];

        return toolIcon || OBJECT_ICON;
    }

    const key =
        object.type === "annotate"
            ? ANNOTATE_ICON_KEYS[object.annotateKind]
            : TYPE_ICON_KEYS[object.type];

    return (key && toolIcons[key]) || OBJECT_ICON;
}

/*
 * The name a student reads. An explicit name is used as it is - the document
 * already numbers and names its objects - and only an object with neither a
 * name nor a label falls back to its type.
 */
export function displayNameOf(object) {
    const name = typeof object?.name === "string" ? object.name.trim() : "";
    const label = typeof object?.label === "string" ? object.label.trim() : "";

    return name || label || typeLabelOf(object);
}

export default {
    GEOMETRY_TYPES,
    THICKNESS_OPTIONS,
    CUSTOM_THICKNESS_MIN,
    CUSTOM_THICKNESS_MAX,
    CUSTOM_THICKNESS_STEP,
    GROUPS,
    groupsFor,
    fieldDefinition,
    fieldLabel,
    readField,
    writeField,
    supportsTransform,
    typeLabelOf,
    displayNameOf,
    iconForObject,
    thicknessOf,
    customThicknessOf
};
