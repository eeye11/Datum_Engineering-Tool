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
import { THICKNESS_PRESETS } from "../../../tool-library/shared/primitives/tikz-primitives.js";
import { toolIcons } from "../toolbar/tools.js";

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

/* The types whose stroke can be dashed, dotted or otherwise styled. */
const STROKE_TYPES = new Set([
    "line",
    "triangle",
    "rectangle",
    "circle",
    "arc",
    "polygon",
    "freeform-polygon",
    "polyline",
    COORDINATE_SYSTEM
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
export const THICKNESS_OPTIONS = [
    { value: "very-thin", label: "Very Thin", width: THICKNESS_PRESETS["very-thin"] },
    { value: "thin", label: "Thin", width: THICKNESS_PRESETS.thin },
    { value: "normal", label: "Normal", width: THICKNESS_PRESETS.normal },
    { value: "medium", label: "Medium", width: THICKNESS_PRESETS.medium },
    { value: "thick", label: "Thick", width: THICKNESS_PRESETS.thick },
    { value: "very-thick", label: "Very Thick", width: THICKNESS_PRESETS["very-thick"] }
];

export const CUSTOM_THICKNESS_MIN = 0.25;
export const CUSTOM_THICKNESS_MAX = 20;
export const CUSTOM_THICKNESS_STEP = 0.25;

/*
 * WHICH PRESET A STORED WIDTH IS.
 *
 * The model accepts BOTH forms - a number (0.5) and a preset's own name ("thin") -
 * because a saved document and a tool default may carry either, and the
 * primitives' resolver reads both. So both are recognised here: a numeric width
 * matches the preset with that width, and a named one IS that preset. Anything
 * else is Custom, which is the honest answer for a width the six presets cannot
 * describe.
 */
function presetOfWidth(width) {
    if (typeof width === "string") {
        const named = width.toLowerCase();

        return THICKNESS_OPTIONS.some((option) => option.value === named) ? named : "custom";
    }

    const match = THICKNESS_OPTIONS.find((option) => Math.abs(option.width - width) < 1e-9);

    return match ? match.value : "custom";
}

/*
 * The Thickness control's value. An absent width is Normal, which is what the
 * rest of the application already treats it as; a width that is not one of the
 * presets is Custom.
 */
export function thicknessOf(object) {
    const stored = object?.style?.lineWidth;

    if (stored === undefined || stored === null || stored === "") {
        return "normal";
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
 * one preset table, so a "thin" line opens its Custom box at 0.5 rather than at
 * NaN.
 */
export function customThicknessOf(object) {
    const stored = object?.style?.lineWidth;

    if (typeof stored === "string") {
        const preset = THICKNESS_OPTIONS.find((option) => option.value === stored.toLowerCase());

        return preset ? preset.width : THICKNESS_PRESETS.normal;
    }

    return Number.isFinite(stored) && stored > 0
        ? stored
        : THICKNESS_PRESETS.normal;
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
        label: "Fixed"
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
        applies: (object) => object.type === COORDINATE_SYSTEM && showLabelsOf(object),
        read: (object) => axisLabelOf(object, "xLabel", "x"),
        write: (object, value) => setGeometryText(object, "xLabel", value)
    },

    yLabel: {
        kind: "text",
        applies: (object) => object.type === COORDINATE_SYSTEM && showLabelsOf(object),
        read: (object) => axisLabelOf(object, "yLabel", "y"),
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
    "point"
]);

function isLockable(object) {
    return Boolean(object && LOCKABLE_TYPES.has(object.type));
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
    { id: "marker", heading: "Marker", fields: ["markerStyle", "markerSize"] },
    { id: "line", heading: "Line", fields: ["lineType", "arrowStart", "arrowEnd"] },
    { id: "shape", heading: "Shape", fields: ["sides"] },
    { id: "fill", heading: "Fill", fields: ["fillMode", "fill"] },
    { id: "axes", heading: "Axes", fields: ["showXAxis", "showYAxis"] },
    { id: "labels", heading: "Labels", fields: ["showLabels", "xLabel", "yLabel", "originLabel"] },
    { id: "text", heading: "Text", plainHeading: true, fields: ["label", "text"] },
    { id: "appearance", heading: "Appearance", fields: ["stroke", "lineWidth", "customWidth"] },
    { id: "object", heading: "Object", fields: ["fixed"], reserveTransform: true },
    { id: "transform", heading: "Transform", fields: [], transform: true }
];

export function fieldDefinition(key) {
    return FIELDS[key] || null;
}

export function fieldLabel(field, key) {
    return field.label || {
        markerStyle: "Style",
        markerSize: "Size",
        lineType: "Style",
        arrowStart: "Begin Arrow",
        arrowEnd: "End Arrow",
        sides: "Number of Sides",
        fillMode: "Mode",
        fill: "Fill Colour",
        stroke: "Outline Colour",
        lineWidth: "Thickness",
        customWidth: "Width",
        fixed: "Fixed",
        showXAxis: "Show X-axis",
        showYAxis: "Show Y-axis",
        showLabels: "Show Labels",
        xLabel: "X-axis Label",
        yLabel: "Y-axis Label",
        originLabel: "Origin Label",
        label: "Label",
        text: "Text"
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

    return GROUPS
        .map((group) => {
            const fields = group.fields
                .map((key) => ({ key, definition: FIELDS[key] }))
                .filter((entry) => entry.definition && entry.definition.applies(object));

            return { ...group, fields };
        })
        .filter((group) => group.transform || group.fields.length);
}

/* ============================================================
 * READING AND WRITING ONE OBJECT
 * ============================================================ */

export function readField(object, key) {
    const definition = FIELDS[key];

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
    const definition = FIELDS[key];

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

    return TYPE_LABELS[object?.type] || "Object";
}

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
