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
import { STRESS_COLOURS } from "../../../shared/geometry/stress-element.js";
import { BOUNDARY_EDGES, boundaryEquation } from "../../../shared/geometry/boundary-stress.js";
import { isProcessDiagram } from "../../../features/workspace/model/thermodynamics/saturation-curve.js";
import enggPipeDuct from "../../../features/workspace/model/fluids/pipe-duct.js";
import enggFlowArrow from "../../../features/workspace/model/fluids/flow-arrow.js";
import { THICKNESS_PRESETS } from "../../../tool-library/shared/primitives/tikz-primitives.js";
import { toolIcons } from "../toolbar/tools.js";
import { isDynamicsObject, dynamicsTypeOf } from "../../../features/workspace/dynamics/dynamics-tools.js";
import { isBlock, isControlBlock, isPlant, plantNodeLabel, plantValue, setPlantNodeLabel, setPlantValue } from "../../../shared/model/plant.js";
import { isSignalLine } from "../../../shared/model/signal-line.js";
import { editorState } from "../../../features/workspace/editor-state.js";
import enggReducer from "../../../features/workspace/model/fluids/reducer-expander.js";
import enggEquipment from "../../../features/workspace/model/fluids/inline-equipment.js";
import enggVessel from "../../../features/workspace/model/fluids/reservoir-tank.js";
import enggFluidLevel from "../../../features/workspace/model/fluids/fluid-level.js";
import enggFlowArrows from "../../../features/workspace/model/fluids/flow-arrows.js";
import enggPressureProfile from "../../../features/workspace/model/fluids/pressure-profile.js";
import enggFlowProfile from "../../../features/workspace/model/fluids/flow-profile.js";
import enggSectionPlane from "../../../features/workspace/model/fluids/section-plane.js";
import enggQuantities from "../../../shared/units/quantities.js";

const COORDINATE_SYSTEM = "coordinate-system-2d";

/*
 * THE RUN LOOKUP A PANEL EDIT USES TO RE-ANCHOR AN ELBOW.
 *
 * INITIALISED LAZILY, FROM INSIDE THE ACCESSOR ITSELF, because this module takes
 * part in an import cycle: the editor pane (which wires the lookup) is loaded
 * WHILE this module is still evaluating, so ANY module-scope binding - a `let` or
 * a `const` object alike - is still in its temporal dead zone when the setter
 * runs. A FUNCTION DECLARATION is hoisted with its body, so the accessors are
 * callable immediately and the storage they share is created on first use.
 *
 * See `keepConnectedEndOnPipe` for why a field module takes a lookup rather than
 * importing the live document.
 */
function elbowLookupStore() {
    if (!elbowLookupStore.store) {
        elbowLookupStore.store = { run: null };
    }

    return elbowLookupStore.store;
}

function elbowLookupOf() {
    const run = elbowLookupStore().run;

    return typeof run === "function" ? run : null;
}

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
const FILLABLE = new Set([
    ...CLOSED_SHAPES,

    /*
     * A PIPE / DUCT IS A CLOSED REGION TOO. Its two walls enclose the bore, and
     * that area can be filled - the drawing convention for a solid or insulated
     * run. Fill is OFF by default (the fill mode starts at none), so a pipe is
     * drawn as two open lines unless the student asks for more.
     */
    "pipe-duct",
    "elbow",

    /*
     * THE SCHEMATIC SHAPES THAT ENCLOSE A REGION: a taper, a valve's body, a
     * vessel, an inline symbol's circle, the graph's frame. A fluid level, a
     * free arrow and a section trace are open marks, so they are not here.
     */
    "reducer-expander",
    "pump",
    "valve",
    "flow-meter",
    "reservoir-tank",
    "pressure-profile"
]);

/*
 * THE TYPES WHOSE FILL IS A REGION BETWEEN TWO BOUNDARIES.
 *
 * A run's fill closes its two walls and its two end edges; an elbow's closes its
 * two arcs and the two end edges. They are filled shapes in the same sense as a
 * closed polygon - one region, filled behind its own outline.
 */
const FLOW_PATH_FILLABLE = new Set(["pipe-duct", "elbow", "junction", "reducer-expander"]);

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
    	"dynamics-pulley",

    	/*
    	 * A PIPE / DUCT AND AN ELBOW ARE DRAWN WITH A PEN TOO, so they get the same
    	 * Appearance section as a Line: one colour and one thickness for BOTH
    	 * boundary walls. The two edges are generated from one style, so there is
    	 * deliberately no way to give them different colours.
    	 */
    	"pipe-duct",
    	"elbow",

    	/*
    	 * A FLOW ARROW IS DRAWN WITH A PEN TOO: one outline colour and one
    	 * thickness for the arrowhead. Its Line Style applies to the head's
    	 * outline; its Colour and Thickness are the same controls a run gets.
    	 */
    	"flow-arrow",

    	/*
    	 * THE SCHEMATIC FLUIDS TOOLS: every one of them is drawn with a pen, so
    	 * every one gets the SAME Line Style, Outline Colour and Thickness the rest
    	 * of the drawing uses - rather than a second appearance implementation.
    	 */
    	"reducer-expander",
    	"pump",
    	"valve",
    	"flow-meter",
    	"reservoir-tank",
    	"fluid-level",
    	"flow-direction-diagram",
    	"pressure-profile",
    	"section-plane"
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
    ...Object.fromEntries([["dimensionWidth", "Width / x extent"], ["dimensionHeight", "Height / y extent"]].map(([key, label]) => [`boundary.${key}`, {
        kind: "text", label,
        applies: object => object.metadata?.boundaryStress === true,
        read: object => object.geometry[key] ?? "",
        write: (object, value) => {
            const text = String(value).trim();
            if (text && !(Number.isFinite(Number(text)) && Number(text) > 0) && !/^[a-wzA-Z][a-zA-Z_]*$/.test(text)) return false;
            object.geometry[key] = text;
            return true;
        }
    }])),
    ...Object.fromEntries(BOUNDARY_EDGES.flatMap(edge => {
        const applies = object => object.metadata?.boundaryStress === true;
        const field = (key, definition) => [`boundary.${edge}_${key}`, {
            applies, read: object => object.geometry[`${edge}_${key}`] ?? (definition.kind === "number" ? 0 : definition.kind === "choice" ? "linear" : ""),
            write: (object, value) => {
                if (key.endsWith("Equation") && String(value).trim()) {
                    const equation = boundaryEquation(value, edge, object.geometry);
                    if (!equation || Array.from({ length: 43 }, (_, i) => equation(i / 42)).some(sample => typeof sample !== "number" || !Number.isFinite(sample))) return false;
                }
                if (definition.kind === "number" && (String(value).trim() === "" || !Number.isFinite(Number(value)))) return false;
                if (definition.kind === "choice" && !["linear", "quadratic"].includes(value)) return false;
                object.geometry[`${edge}_${key}`] = definition.kind === "number" ? Number(value) : String(value);
                return true;
            }, ...definition
        }];
        return [field("profile", { kind: "choice", label: "Variation", options: [{ value: "linear", label: "Linear / Uniform" }, { value: "quadratic", label: "Quadratic" }] }),
            ...["normal", "shear"].flatMap(kind => [
                field(`${kind}Equation`, { kind: "text", label: `${kind === "normal" ? "Normal" : "Shear"} f(x,y)` }),
                field(`${kind}Start`, { kind: "number", step: 0.1, label: `${kind === "normal" ? "Normal" : "Shear"} (${edge === "top" || edge === "bottom" ? "left" : "bottom"})` }),
                field(`${kind}End`, { kind: "number", step: 0.1, label: `${kind === "normal" ? "Normal" : "Shear"} (${edge === "top" || edge === "bottom" ? "right" : "top"})` }),
                field(`${kind}Label`, { kind: "text", label: `${kind === "normal" ? "Normal" : "Shear"} Label` })
            ])];
    })),
    ...Object.fromEntries(["normal", "shear"].map(kind => [`boundary.${kind}Colour`, {
        kind: "colour", label: `${kind === "normal" ? "Normal" : "Shear"} Colour`,
        applies: object => object.metadata?.boundaryStress === true,
        read: object => object.geometry[`${kind}Colour`] || (kind === "normal" ? "#db2777" : "#2563eb"),
        write: (object, value) => {
            if (!/^#[0-9a-f]{6}$/i.test(String(value))) return false;
            object.geometry[`${kind}Colour`] = value;
            return true;
        }
    }])),
    "stressElement.showAngle": {
        kind: "toggle", label: "Show Angle",
        applies: object => object.type === "rectangle" && object.metadata?.stressElement === true,
        read: object => object.geometry.showAngle !== false,
        write: (object, value) => { object.geometry.showAngle = Boolean(value); return true; }
    },
    ...Object.fromEntries(Object.entries(STRESS_COLOURS).map(([key, colour]) => [`stressElement.${key}Colour`, {
        kind: "colour",
        label: `${{ normalStressX: "Normal X", normalStressY: "Normal Y", shearStress: "Shear" }[key]} Colour`,
        applies: object => object.type === "rectangle" && object.metadata?.stressElement === true,
        read: object => object.geometry[`${key}Colour`] || colour,
        write: (object, value) => {
            if (!/^#[0-9a-f]{6}$/i.test(String(value))) return false;
            object.geometry[`${key}Colour`] = value;
            return true;
        }
    }])),
    ...Object.fromEntries([
        ["normalStressX", "Normal Stress X", false],
        ["normalStressY", "Normal Stress Y", false],
        ["shearStress", "Shear Stress", true]
    ].map(([key, label, shear]) => [`stressElement.${key}`, {
        kind: "segmented", label,
        applies: object => object.type === "rectangle" && object.metadata?.stressElement === true,
        read: object => String(Number(object.geometry[key]) || 0),
        write: (object, value) => {
            if (!["0", "1", "-1"].includes(String(value))) return false;
            object.geometry[key] = Number(value);
            return true;
        },
        options: [
            { value: "0", label: "None" },
            { value: "1", label: shear ? "Positive" : "Tension" },
            { value: "-1", label: shear ? "Negative" : "Compression" }
        ]
    }])),
    "stressElement.angle": {
        kind: "number",
        label: "Angle (degrees)",
        step: 1,
        applies: object => object.type === "rectangle" && object.metadata?.stressElement === true,
        read: object => Number(object.geometry.rotation) || 0,
        write: (object, value) => {
            if (String(value).trim() === "" || !Number.isFinite(Number(value))) return false;
            object.geometry.rotation = Number(value);
            return true;
        }
    },
    /* ---------------------------------------------------------- Geometry */

    plantInputs: {
        kind: "number",
        min: 0,
        step: 1,
        applies: isControlBlock,
        read: (object) => plantValue(object, "inputs"),
        write: (object, value) => {
            const count = Number(value);
            return setPlantValue(object, "inputs", count);
        },
        label: "Input nodes"
    },

    plantOutputs: {
        kind: "number",
        min: 0,
        step: 1,
        applies: isControlBlock,
        read: (object) => plantValue(object, "outputs"),
        write: (object, value) => {
            const count = Number(value);
            return setPlantValue(object, "outputs", count);
        },
        label: "Output nodes"
    },

    plantShowNodeLabels: {
        kind: "toggle",
        applies: isControlBlock,
        read: (object) => plantValue(object, "showNodeLabels"),
        write: (object, value) => setPlantValue(object, "showNodeLabels", value),
        label: "Label nodes"
    },

    plantLabel: {
        kind: "text",
        applies: isPlant,
        read: (object) => plantValue(object, "plantLabel"),
        write: (object, value) => setPlantValue(object, "plantLabel", value),
        label: "Plant label"
    },

    blockLabel: {
        kind: "text",
        applies: isBlock,
        read: (object) => plantValue(object, "blockLabel"),
        write: (object, value) => setPlantValue(object, "blockLabel", value),
        label: "Block label (/ for fraction, ^ for exponent)"
    },

    blockLowerLabel: {
        kind: "text",
        applies: isBlock,
        read: (object) => plantValue(object, "blockLowerLabel"),
        write: (object, value) => setPlantValue(object, "blockLowerLabel", value),
        label: "Lower label"
    },

    plantNodeLabel: {
        kind: "text",
        applies: (object) =>
            isControlBlock(object) &&
            editorState.selectedPlantNode?.objectId === object.id,
        read: (object) => {
            const node = editorState.selectedPlantNode;
            return plantNodeLabel(object, node?.side, node?.index);
        },
        write: (object, value) => {
            const node = editorState.selectedPlantNode;
            return setPlantNodeLabel(object, node?.side, node?.index, value);
        },
        label: "Node label"
    },

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
        applies: (object) => object.type === "annotate" && ANNOTATE_ARROWHEAD_KINDS.has(object.annotateKind),
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
        applies: (object) => FILLABLE.has(object.type) || FLOW_PATH_FILLABLE.has(object.type),
        read: fillModeOf,
        write: setFillMode,
        options: [
            { value: "none", label: "None" },
            { value: "solid", label: "Solid" }
        ]
    },

    fill: {
        kind: "colour",
        applies: (object) =>
            (FILLABLE.has(object.type) || FLOW_PATH_FILLABLE.has(object.type)) &&
            fillModeOf(object) === "solid",
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
        /*
         * A PIPE'S NAME IS NOT A DRAWING LABEL.
         *
         * The finalized design gives a run a Name in the Object section and
         * nothing else - there is no separate "show the name on the sheet"
         * property. Excluding the pipe here is what removes that control
         * without taking it from the features that legitimately have it.
         */
        applies: (object) =>
            typeof object?.type === "string" &&
            object.type !== "annotate" &&
            object.type !== "pipe-duct" &&
            object.type !== "elbow" &&
            object.type !== "junction" &&
            Boolean(object.name),
        read: (object) => object?.showName === true,
        write: (object, value) => {
            object.showName = Boolean(value);

            return true;
        },
        label: "Show Name"
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
	 * A PIPE / DUCT AND THE ELBOW FITTED TO IT ARE LOCKABLE.
	 *
	 * They are stroke geometry with a transform the lock can hold: a fixed run
	 * keeps its selection highlight but loses its handles, and its endpoints,
	 * its Transform arrows and its Pipe Width Change all refuse to move it. An
	 * elbow is a fitting rather than a run, not a dynamics symbol, so it is
	 * named here rather than inferred.
	 */
	if (object && (object.type === "pipe-duct" || object.type === "elbow" || object.type === "junction" || object.type === "flow-arrow")) {
		return true;
	}

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
    { id: "plant", heading: "Plant", fields: ["plantInputs", "plantOutputs", "plantShowNodeLabels", "plantLabel", "blockLabel", "blockLowerLabel", "plantNodeLabel"] },
    { id: "marker", heading: "Marker", fields: ["markerStyle", "markerSize"] },
    { id: "line", heading: "Line", fields: ["lineType", "arrowStart", "arrowEnd", "arrowhead"] },
    { id: "shape", heading: "Shape", fields: ["sides"] },
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

	{ id: "appearance", heading: "Appearance", fields: ["lineType", "stroke", "lineWidth", "customWidth", "fillMode", "fill"] },
	{ id: "object", heading: "Object", fields: ["fixed", "name"], reserveTransform: true },
	{ id: "transform", heading: "Transform", fields: ["bendRadius", "pipeWidth"], transform: true }
];

	/*
	 * ============================================================
	 * THE SCHEMATIC TOOLS' SECTIONS
	 * ============================================================
	 *
	 * Object, then Appearance, then Transform - the hierarchy every Fluids tool
	 * follows - with one tool-specific section where the tool genuinely needs one:
	 * a pressure profile's Data and Axes.
	 *
	 * EACH GROUP'S FIELDS ARE THE OBJECT's OWN FACTS, in reading order: what it is
	 * and what it is attached to, then the one or two parameters that decide its
	 * shape. A group with nothing applicable to the selection is dropped by
	 * `groupsFor`, so no empty heading is ever drawn.
	 */
	export const SCHEMATIC_GROUPS = Object.freeze({
            reducer: [
                { id: "object", heading: "Object", fields: ["name", "reducerMode", "fixed"] },
                { id: "appearance", heading: "Appearance", fields: ["lineType", "stroke", "lineWidth", "customWidth", "fillMode", "fill"] },
                { id: "transform", heading: "Transform", fields: [], transform: true }
            ],
    	    equipment: [
    	        { id: "object", heading: "Object", fields: ["fixed", "equipmentPlacement", "equipmentPipeA", "equipmentPipeB", "valveDepiction"] },
    	        { id: "appearance", heading: "Appearance", fields: ["lineType", "stroke", "lineWidth", "customWidth", "fillMode", "fill"] },
    	        /*
    	         * X, Y AND ROTATE, THEN THE SYMBOL'S OWN SIZE.
    	         *
    	         * A STANDALONE symbol moves and turns freely. An INLINE one is placed
    	         * by its host, so the same rows name its host's position and angle,
    	         * and "Position Along Pipe" is the one degree of freedom it has.
    	         * `equipmentPosition` applies to neither: it applies to inline ones
    	         * only, so a standalone pump never shows a control that cannot act.
    	         */
    	        { id: "transform", heading: "Transform", fields: ["equipmentX", "equipmentY", "equipmentRotation", "symbolSize", "equipmentPosition"] }
    	    ],
    	    vessel: [
    	        { id: "object", heading: "Object", fields: ["fixed", "vesselStyle"] },
    	        { id: "appearance", heading: "Appearance", fields: ["lineType", "stroke", "lineWidth", "customWidth", "fillMode", "fill"] },
    	        { id: "transform", heading: "Transform", fields: ["vesselX", "vesselY", "vesselRotation", "vesselWidth", "vesselHeight"] }
    	    ],
    	    fluidLevel: [
    	        /*
    	         * OBJECT: which vessel it marks. The level's position is NOT here -
    	         * it is the Transform's one degree of freedom, on the row below.
    	         */
    	        { id: "object", heading: "Object", fields: ["fixed", "levelVessel"] },
    	        /*
    	         * APPEARANCE: the SURFACE (line style, colour, thickness) and the
    	         * LIQUID (fill colour and opacity) - the same shared controls every
    	         * other drawn object uses, plus the two a filled region needs.
    	         */
    	        {
    	            id: "appearance",
    	            heading: "Appearance",
    	            fields: ["lineType", "stroke", "lineWidth", "customWidth", "levelFillColour", "levelFillOpacity"]
    	        },
    	        /*
    	         * TRANSFORM: THE LEVEL POSITION, as a percentage of the vessel's
    	         * usable interior - the one value that decides where the surface and
    	         * the fill are, and the one the canvas handle writes. X, Y and Rotate
    	         * are deliberately absent: the level's position is constrained by its
    	         * vessel, and a typed X or an angle would describe a surface the
    	         * vessel cannot hold.
    	         */
    	        { id: "transform", heading: "Transform", fields: ["levelPosition"] }
    	    ],
    	    flowDirection: [
    	        { id: "object", heading: "Object", fields: ["fixed", "directionPipe", "directionReversed"] },
    	        { id: "appearance", heading: "Appearance", fields: ["lineType", "stroke", "lineWidth", "customWidth", "arrowhead"] },
    	        /* Position and spacing, never an X/Y that would detach the arrows. */
    	        { id: "transform", heading: "Transform", fields: ["directionPosition", "directionSpacing", "directionSize"] }
    	    ],
    	    freeArrow: [
    	        { id: "object", heading: "Object", fields: ["fixed"] },
    	        { id: "appearance", heading: "Appearance", fields: ["lineType", "stroke", "lineWidth", "customWidth", "arrowhead"] },
    	        { id: "transform", heading: "Transform", fields: ["freeArrowLength"] }
    	    ],
    	    /*
    	     * A FLOW PROFILE FOLLOWS THE PRESSURE PROFILE'S HIERARCHY: Object, then
    	     * its data and its axes, then Appearance and Transform. The Data table is
    	     * a LIST and is rendered by the pane itself (see `features-editor.js`),
    	     * exactly as the pressure profile's is.
    	     */
    	    flowProfile: [
    	        { id: "object", heading: "Object", fields: ["fixed", "flowProfileName"] },
    	        {
    	            id: "profile-data",
    	            heading: "Data",
    	            fields: ["flowQuantity", "flowCustomLabel", "flowStationKind", "flowValueUnit", "flowStationUnit"]
    	        },
    	        {
    	            id: "profile-axes",
    	            heading: "Axes",
    	            fields: ["flowXTitle", "flowXMin", "flowXMax", "flowYTitle", "flowYMin", "flowYMax"]
    	        },
    	        {
    	            id: "appearance",
    	            heading: "Appearance",
    	            fields: ["lineType", "stroke", "lineWidth", "customWidth", "flowLineStyle", "flowShowPoints", "flowShowGrid"]
    	        },
    	        { id: "transform", heading: "Transform", fields: ["flowX", "flowY", "flowWidth", "flowHeight"] }
    	    ],
    	    profile: [
    	        { id: "object", heading: "Object", fields: ["fixed", "graphName"] },
    	        { id: "profile-axes", heading: "Axes", fields: ["profileXTitle", "profileXUnit", "profileXMin", "profileXMax", "profileYTitle", "profileYUnit", "profileYMin", "profileYMax"] },
    	        { id: "appearance", heading: "Appearance", fields: ["lineType", "stroke", "lineWidth", "customWidth", "profileShowPoints", "profileShowGrid"] },
    	        { id: "transform", heading: "Transform", fields: ["profileX", "profileY", "profileWidth", "profileHeight"] }
    	    ],
    	    section: [
    	        { id: "object", heading: "Object", fields: ["fixed", "sectionIdentifier", "sectionDirection"] },
    	        /* The viewing arrows are a Depiction fact, but stay beside the direction. */
    	        { id: "appearance", heading: "Appearance", fields: ["lineType", "stroke", "lineWidth", "customWidth", "arrowhead"] },
    	        { id: "transform", heading: "Transform", fields: ["sectionX", "sectionY", "sectionRotation", "sectionLength"] }
    	    ]
    	});

    	/* Which set of sections an object uses, from its own type. */
    	export function schematicGroupsFor(object) {
    	    if (!object) {
    	        return null;
    	    }

    	    if (enggReducer.isReducerType(object.type)) {
    	        return SCHEMATIC_GROUPS.reducer;
    	    }

    	    if (enggEquipment.isEquipmentType(object.type)) {
    	        return SCHEMATIC_GROUPS.equipment;
    	    }

    	    if (enggVessel.isVesselType(object.type)) {
    	        return SCHEMATIC_GROUPS.vessel;
    	    }

    	    if (enggFluidLevel.isFluidLevelType(object.type)) {
    	        return SCHEMATIC_GROUPS.fluidLevel;
    	    }

    	    if (enggFlowArrows.isFlowDirectionType(object.type)) {
    	        return SCHEMATIC_GROUPS.flowDirection;
    	    }

    	    if (enggFlowArrows.isFreeFlowArrowType(object.type) && !object.attachment) {
    	        return SCHEMATIC_GROUPS.freeArrow;
    	    }

    	    if (enggFlowProfile.isFlowProfileType(object.type)) {
    	        return SCHEMATIC_GROUPS.flowProfile;
    	    }

    	    if (enggPressureProfile.isPressureProfileType(object.type)) {
    	        return SCHEMATIC_GROUPS.profile;
    	    }

    	    if (enggSectionPlane.isSectionPlaneType(object.type)) {
    	        return SCHEMATIC_GROUPS.section;
    	    }

    	    	    return null;
    	    	}

    	        { id: "stress-element", heading: "Stress Element", fields: ["stressElement.angle", "stressElement.showAngle", "stressElement.normalStressX", "stressElement.normalStressXColour", "stressElement.normalStressY", "stressElement.normalStressYColour", "stressElement.shearStress", "stressElement.shearStressColour"] },
    	        { id: "boundary-dimensions", heading: "Element Dimensions", fields: ["boundary.dimensionWidth", "boundary.dimensionHeight"] },
    	        { id: "boundary-colours", heading: "Boundary Stress Colours", fields: ["boundary.normalColour", "boundary.shearColour"] },
    	        ...BOUNDARY_EDGES.map(edge => ({ id: `boundary-${edge}`, heading: `${edge[0].toUpperCase() + edge.slice(1)} Edge`, fields: ["normalEquation", "shearEquation", "profile", "normalStart", "normalEnd", "normalLabel", "shearStart", "shearEnd", "shearLabel"].map(key => `boundary.${edge}_${key}`) })),
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
 * THE PIPE / DUCT CONTROLS
 * ============================================================
 *
 * Pipe / Duct is a 2D DRAWING tool. It has no cross-section dimensions, no
 * material and no roughness, and its Features tab has exactly three sections:
 * Object, Appearance and Transform. Everything the run's drawing needs comes
 * from the four shared Appearance controls (Line Style, Outline Colour,
 * Thickness, Fill) and the four Transform rows (X Shift, Y Shift, Rotate and
 * Pipe Width).
 *
 * WHAT IS HERE, AND WHY IT IS ALL THAT IS.
 *
 *   name          the object's own name, editable in the Object section
 *   fixed         the shared Fix lock - already declared at the top of FIELDS
 *   appearance    the four STROKE_TYPES fields, which the pipe shares with a
 *                 Line so the two are styled with the same vocabulary
 *   pipeWidth     the relative spacing change, spoken by the Transform row
 *
 * SAVED OBJECTS STILL READ. An older file may carry `engineering.shape`,
 * `diameter`, `width`, `height`, `material` or `roughness`. Those values are
 * simply ignored now - they never decided the drawing, and the walls are still
 * derived from the centreline and the spacing - so an old pipe opens looking
 * exactly as it did, with no migration step and no data thrown away.
 */
function engineeringOf(object) {
    if (!object.engineering || typeof object.engineering !== "object") {
        object.engineering = {};
    }

    return object.engineering;
}

Object.assign(FIELDS, {
    /*
     * NAME.
     *
     * The label the Objects list and the source comment show. It is the
     * object's DISPLAY name, never its identity: `object.id` is untouched, so
     * renaming cannot break a selection, a source block or a connection.
     */
    name: {
        kind: "text",
        applies: (object) => Boolean(object),
        read: (object) => String(object.name ?? ""),
        write: (object, value) => {
            const name = String(value ?? "").trim();

            if (!name) {
                return false;
            }

            object.name = name;

            return true;
        }
    },

    /*
     * PIPE WIDTH.
     *
     * The separation between the two boundary walls, as a CHANGE from the
     * run's default spacing - which is why 0 means "unchanged". It is stored on
     * `engineering.separation` (the same field older files use, so the source
     * and saved-object formats are unchanged) and only when it is non-zero.
     *
     * It changes NOTHING ELSE. Both walls are derived from the stored
     * centreline plus this spacing, so a width change cannot move the
     * centreline, alter the run's length or turn it - those belong to the
     * endpoints and Rotate.
     */
    pipeWidth: {
        kind: "number",
        step: 1,
        applies: (object) => object?.type === "pipe-duct",
        read: (object) => Number(object.engineering?.separation) || 0,
        write: (object, value) => {
            const change = Number(value);

            return setPipeWidth(object, change);
        }
    },

    /*
     * ============================================================
     * THE ELBOW'S ONE TRANSFORM PARAMETER
     * ============================================================
     *
     * BEND RADIUS IS A RELATIVE ADJUSTMENT, like X Shift and Y Shift: a typed
     * value opens or closes the current radius by that much, clamped to what
     * the bend's arms can hold.
     *
     * THERE IS NO BEND ANGLE ROW. An elbow's angle is the direction change its
     * PIPES make - the fitting exists at a corner, so the corner decides it -
     * and a field that could set a different one would describe a bend the
     * pipework does not have. The angle is still DERIVED on every settle; it is
     * simply not a property the student edits.
     */
    bendRadius: {
        kind: "number",
        step: 1,
        applies: (object) => object?.type === "elbow",
        read: () => 0,
        write: (object, value) => {
            const change = Number(value);

            if (!Number.isFinite(change) || change === 0) {
                return false;
            }

            return adjustElbowRadius(object, change) !== false;
        }
    },

    /*
     * ============================================================
     * THE FLOW ARROW'S OWN CONTROLS
     * ============================================================
     *
     * A flow arrow is an INDICATOR: it has no position of its own, no size in
     * the drawing's units and no angle. It is a mark on a pipe - which pipe,
     * how far along it, which way, how big and how drawn. So its section holds
     * exactly those questions and nothing that could detach it:
     *
     *   attachedPipe   WHERE it lives     - read-only, the host's own name
     *   reverse        WHICH WAY         - flips the head, never the pipe
     *   fixed          WHETHER IT MOVES  - the shared Fix lock
     *   arrowSize      HOW BIG           - the head only, never the pipe
     *   arrowheadFill  WHETHER IT IS INKED
     *
     * There is deliberately NO X/Y position, NO rotation and NO "position
     * along the pipe" number. Those would be ways to detach the arrow from its
     * run, and each of them already has a canvas handle that is constrained by
     * the run - see `flow-arrow-position` and `flow-arrow-size` in handles.js.
     * Every control here writes the drawing through `setAttachment`, so the
     * geometry mirror and the attachment stay one statement.
     */
    /*
     * ATTACHED PIPE IS READ-ONLY, AND SO ARE THE CONNECTION REFERENCES OF THE
     * SCHEMATIC TOOLS - every one of them names an object another tool placed,
     * and a reference typed here would have to be resolved back to that object.
     * The value is stated, and it is the pipe's OWN name.
     */
    attachedPipe: {
        kind: "text",
        applies: (object) =>
            object?.type === "flow-arrow" &&
            Boolean(
                enggFlowArrow.attachmentOf(object).hostId ||
                    object?.engineering?.hostId ||
                    object?.parentId
            ),
        read: (object) => {
        		const attachment = enggFlowArrow.attachmentOf(object);
        		const stored = object?.engineering;

        		const hostId = attachment.hostId || stored?.hostId || null;

        		if (!hostId) {
        			return "";
        		}

        		return flowArrowHostName({ ...object, attachment: { ...attachment, hostId } });
        	},

        /*
         * READ-ONLY, AND THAT IS THE POINT. The host is chosen by pressing on a
         * pipe, not by typing an id; a name typed here would have to be resolved
         * back to some pipe, and the wrong guess would silently move the arrow to
         * another run. The write refuses, so the field is a statement of fact
         * rather than a control.
         */
        write: () => false,
        readOnly: true,
        label: "Attached Pipe / Duct"
    },

    reverseDirection: {
        kind: "toggle",
        applies: (object) => object?.type === "flow-arrow",
        read: (object) => enggFlowArrow.attachmentOf(object).reversed === true,
        write: (object, value) => {
            /*
             * THE HEAD TURNS, THE PIPE DOES NOT. Only `attachment.reversed` is
             * written; the host's geometry, its connections and its own
             * direction are untouched, so the physical pipework is exactly
             * what it was before the flip.
             */
            return enggFlowArrow.setAttachment(object, { reversed: Boolean(value) }) !== null;
        },
        label: "Reverse Direction"
    },

    arrowSize: {
        kind: "number",
        applies: (object) => object?.type === "flow-arrow",
        read: (object) => enggFlowArrow.arrowSize(object),
        write: (object, value) => {
            const size = Number(value);

            if (!Number.isFinite(size) || size < enggFlowArrow.MIN_ARROW_SIZE || size > enggFlowArrow.MAX_ARROW_SIZE) {
                return false;
            }

            /*
             * THE SIZE IS THE HEAD'S. The pipe's width, walls and length are
             * not read or written here, so a typed size cannot resize the run
             * the arrow is indicating.
             */
            return enggFlowArrow.setAttachment(object, { size }) !== null;
        },
        min: enggFlowArrow.MIN_ARROW_SIZE,
        max: enggFlowArrow.MAX_ARROW_SIZE,
        step: 1,
        label: "Arrow Size"
    },

    arrowheadFill: {
        kind: "toggle",
        applies: (object) => object?.type === "flow-arrow",
        read: (object) => object?.style?.headingFillMode === "solid",
        write: (object, value) => {
            const style = { ...(object.style || {}) };

            if (value) {
                /*
                 * A FILLED HEAD NEEDS A COLOUR. One the student has already
                 * chosen is kept; otherwise the head is inked in its own
                 * outline colour, which is the convention the rest of the
                 * drawing follows for "filled with the same pen".
                 */
                style.headingFillMode = "solid";
                style.headingFill = fillHexOf(style.headingFill) || fillHexOf(style.stroke) || undefined;
            } else {
                style.headingFillMode = "none";
            }

            object.style = style;

            return true;
        },
        label: "Arrowhead Fill"
    }
});

/* A stored colour, when it is one the drawing can paint - otherwise null. */
function fillHexOf(value) {
    return /^#[0-9a-fA-F]{6}$/.test(String(value || "")) ? String(value).toLowerCase() : null;
}

/*
 * THE NAME OF THE PIPE AN ARROW IS ATTACHED TO.
 *
 * Resolved from the live drawing, because a name is not an identity: the pipe
 * may have been renamed after the arrow was placed, and the panel must show
 * what the student now calls it. When the host is gone the arrow cannot be
 * drawn at all, and the field says so rather than showing a stale name.
 */
export function flowArrowHostName(object, lookup = null) {
    if (object?.type !== "flow-arrow") {
        return "";
    }

    const attachment = enggFlowArrow.attachmentOf(object);
    const hostId = attachment.hostId;

    if (!hostId) {
        return "";
    }

    const find = typeof lookup === "function" ? lookup : attachedPipeLookup();

    const host = find ? find(hostId) : null;

    if (!host) {
        return "";
    }

    return String(host.name || host.id || "");
}

/*
 * THE ARROW'S LINE STYLE, COLOUR AND THICKNESS ARE THE SHARED ONES.
 *
 * A flow arrow is in STROKE_TYPES, so the Appearance section already offers it
 * the same Line Style, Outline Colour and Thickness controls a Line or a Pipe
 * has. There is deliberately no second copy of them here: two controls for one
 * value is two ways to disagree about it.
 *
 * The HOST NAMES still need the document, and it arrives through a setter for
 * the reason stated at the top of this module - this file must not import the
 * live document.
 */
function attachedPipeLookup() {
    const find = elbowLookupStore().objects;

    return typeof find === "function" ? find : null;
}

/*
 * THE DOCUMENT, INJECTED. The panel hands in ONE reader that answers "the
 * object with this id" from the active drawing; the elbow's run lookup and this
 * arrow's host lookup are two questions about the same table, so they share the
 * store rather than opening a second one.
 */
export function setFeatureObjectLookup(lookup) {
    elbowLookupStore().objects = typeof lookup === "function" ? lookup : null;
}

/*
 * THE ARROW'S OWN FIELDS, IN THE ORDER THE PANEL READS THEM.
 *
 * Object first - what it is attached to, whether it is held - then the arrow's
 * controls. Appearance follows in the shared section, because Line Style,
 * Colour and Thickness are the same values the whole application uses.
 *
 * The group is listed BEFORE the shared sections and is filtered by `groupsFor`
 * to an arrow's own selection, so a pipe never sees a Flow Arrow's controls.
 */
export const FLOW_ARROW_GROUP = {
    id: "flow-arrow",
    heading: "Object",
    fields: ["attachedPipe", "fixed", "name", "reverseDirection", "arrowheadFill", "arrowSize"]};

/*
 * HOW AN ELBOW'S ENDS ARE ATTACHED: "connected", "partial" or "standalone".
 *
 * A GENERATED elbow is always fully connected - it exists because two runs meet
 * - and a MANUAL one is classified from the pair of ids it records. This is the
 * ONE place the three states are decided, so the panel, the handles and the
 * source all agree about which controls may act.
 */
export function elbowConnectionState(object) {
    if (object?.type !== "elbow") {
        return null;
    }

    const ids = object.engineering?.connections;

    const attached = Array.isArray(ids) ? ids.filter(Boolean).length : 0;

    if (attached >= 2) {
        return "connected";
    }

    return attached === 1 ? "partial" : "standalone";
}

/* Whether an elbow's BOTH ends are held by pipes - its angle is then read-only. */
export function isFullyConnectedElbow(object) {
    return elbowConnectionState(object) === "connected";
}

/*
 * WRITE AN ELBOW'S BEND ANGLE, at whichever end is free.
 *
 * The two ENDS stay where they are, so an attached end remains on its pipe.
 * A GENERATED fully connected elbow refuses: its angle is its pipes' angle, and
 * typing a different one would describe a bend the pipework does not have.
 */
export function writeElbowAngle(object, degrees) {
    if (object?.type !== "elbow" || isFullyConnectedElbow(object)) {
        return false;
    }

    const previous = object.geometry ? JSON.parse(JSON.stringify(object.geometry)) : null;
    const previousEngineering = { ...(object.engineering || {}) };

    if (!enggPipeDuct.setElbowAngle(object, degrees)) {
        return false;
    }

    if (!keepConnectedEndOnPipe(object)) {
        object.geometry = previous || object.geometry;
        object.engineering = previousEngineering;
        return false;
    }

    return true;
}

/*
 * APPLY A BEND RADIUS CHANGE, clamped to what the bend can hold.
 *
 * The current radius is moved by the change and the result is bounded by the
 * bend's arms, so an overshoot stops at the largest valid radius rather than
 * placing a tangent point past the end of a leg. When not even the smallest
 * bend fits, nothing is written and false is returned, so the caller leaves
 * the last valid geometry in place.
 */
export function adjustElbowRadius(object, change) {
    if (object?.type !== "elbow") {
        return false;
    }

    /*
     * ZERO IS NOT A RADIUS, IT IS NO CHANGE. Bend Radius is a RELATIVE value, so
     * a zero entry is the same as an empty box and writes nothing.
     */
    if (!Number.isFinite(Number(change)) || Number(change) === 0) {
        return false;
    }

    /*
     * THE CHANGE IS TURNED INTO AN ABSOLUTE RADIUS HERE AND NOWHERE ELSE, and
     * the absolute value is handed to the ONE operation that applies a radius.
     * That operation clamps it against the bend's live arms, regenerates the
     * fitting's tangents and every joined pipe's seat, trim and seam, and
     * restores everything if the result cannot be drawn - so a typed value and
     * a dragged handle cannot produce two different bends.
     */
    const apply = elbowRadiusApplyOf();

    if (!apply) {
        return false;
    }

    const current = Number(object.engineering?.bendRadius);

    if (!Number.isFinite(current)) {
        return false;
    }

    return apply(object, current + Number(change));
}

/*
 * RE-ANCHOR A CONNECTED ELBOW ON THE PIPES IT RECORDS.
 *
 * Only the ends that carry a connection move: a free end stays where the
 * student put it. Returns false only when the re-anchoring produced no usable
 * geometry, so a caller can restore the previous state.
 *
 * The run lookup is injected by the panel layer rather than imported here: this
 * module declares FIELDS and must not depend on the live document. Without an
 * injected lookup the ends are left alone, which is the honest answer for a
 * caller that has no drawing to consult.
 *
 * The binding itself is declared at the top of the module - see `connectedRunsLookup`.
 */
export function setElbowRunLookup(lookup) {
    elbowLookupStore().run = typeof lookup === "function" ? lookup : null;
}

/*
 * THE OPERATION THAT APPLIES AN ABSOLUTE BEND RADIUS, injected the same way.
 *
 * The Features tab must not have a radius calculation of its own: the canvas
 * handle and the panel have to write the SAME geometry for the same radius.
 * Seating the pipes on the new tangents is part of that one operation, which is
 * why there is no separate reseat hook beside it.
 */
export function setElbowRadiusApply(apply) {
    elbowLookupStore().applyRadius = typeof apply === "function" ? apply : null;
}

function elbowRadiusApplyOf() {
    const apply = elbowLookupStore().applyRadius;

    return typeof apply === "function" ? apply : null;
}

/* The run lookup currently injected, or null. */
export function elbowRunLookup() {
    return elbowLookupOf();
}

function keepConnectedEndOnPipe(object) {
    const ids = object?.engineering?.connections;

    const lookup = elbowLookupOf();

    if (!Array.isArray(ids) || !ids.some(Boolean) || typeof lookup !== "function") {
        return true;
    }

    const runs = ids.map((id) => (id ? lookup(id) : null));

    /* A run recorded as connected has gone: leave the geometry as it is. */
    if (ids.some((id, index) => Boolean(id) && !runs[index])) {
        return true;
    }

    return anchorElbowEnds(object, runs);
}

/*
 * PUT AN ELBOW'S CONNECTED ENDS BACK ON THEIR PIPES.
 *
 * Each attached end becomes the nearest endpoint of its run, and the bend is
 * re-solved from the two ends at the angle the fitting has. That is what keeps
 * a connected fitting attached through a radius change, an angle change or a
 * pipe move: the ends are the pipe's, so nothing can drift off it.
 */
export function anchorElbowEnds(object, runs = []) {
    const geometry = object?.geometry || {};

    const ends = {
        a: geometry.ends?.a ? { ...geometry.ends.a } : null,
        b: geometry.ends?.b ? { ...geometry.ends.b } : null
    };

    if (!ends.a || !ends.b) {
        return true;
    }

    const nearestPort = (run, reference) => {
        const ports = enggPipeDuct.portsOf(run);

        if (!ports.length) {
            return null;
        }

        return ports.reduce((best, port) => {
            const distance = Math.hypot(port.point.x - reference.x, port.point.y - reference.y);

            return !best || distance < best.distance ? { ...port.point, distance } : best;
        }, null);
    };

    if (runs[0]) {
        const at = nearestPort(runs[0], ends.a);

        if (at) {
            ends.a = { x: at.x, y: at.y };
        }
    }

    if (runs[1]) {
        const at = nearestPort(runs[1], ends.b);

        if (at) {
            ends.b = { x: at.x, y: at.y };
        }
    }

    const angle = enggPipeDuct.elbowAngleDegrees(object);

    if (angle === null) {
        return false;
    }

    const solved = enggPipeDuct.solveElbowCorner(ends.a, ends.b, angle, geometry.position);

    if (!solved) {
        return false;
    }

    object.geometry = {
        ...geometry,
        position: solved.position,
        ends,
        previous: { ...ends.a },
        next: { ...ends.b }
    };

    return true;
}

/*
 * Set a run's Pipe Width, refusing a change that would collapse the walls.
 * Exported because the Transform row and the connection rules must use the
 * SAME arithmetic - one to type it, the other to keep a connected run equal.
 */
export function setPipeWidth(object, change) {
    if (!object || object.type !== "pipe-duct") {
        return false;
    }

    const width = Number(change);
    const engineering = engineeringOf(object);

    if (!Number.isFinite(width) || enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION + width <= 0) {
        return false;
    }

    if (width === 0) {
        delete engineering.separation;

        return true;
    }

    engineering.separation = width;

    return true;
}

const PROCESS_BEND_PREFIX = "processBend:";

/* ============================================================
 * THE SCHEMATIC FLUIDS TOOLS' OWN FIELDS
 * ============================================================
 *
 * Each is declared once, applies only to its own type, and WRITES THE MODEL
 * THE RENDERER, THE HANDLES AND THE SOURCE WRITER READ - so a typed value and a
 * dragged handle are the same edit. There is no decorative field here: every one
 * moves something on the sheet.
 *
 * ATTACHED OBJECTS DO NOT OFFER FREE TRANSFORMS. A reducer, an inline symbol and
 * a fluid level are placed by their host, so their Object section states that
 * host read-only and their own rows are the parameters that make sense (the
 * transition length, the symbol size, the level height) - never an X/Y that
 * would detach them from the pipe or vessel they belong to.
 */

/* A read-only statement of fact - the field shows, it never writes. */
function readonlyField({ applies, read, label, unit = null }) {
    return {
        kind: "text",
        applies,
        read,
        write: () => false,
        readOnly: true,
        ...(unit ? { unit } : {}),
        label
    };
}

/* The name of the object an object records, for a read-only reference row. */
function objectNameOf(id) {
    const find = elbowLookupStore().objects;

    if (!id || typeof find !== "function") {
        return "";
    }

    const found = find(id);

    return found ? String(found.name || found.id || "") : "";
}

Object.assign(FIELDS, {
    /* ---------------------------------------------- Reducer / Expander */

    reducerMode: {
        kind: "segmented",
        applies: object => enggReducer.isReducerType(object?.type),
        read: object => enggReducer.modeOf(object),
        write: (object, value) => enggReducer.setMode(object, value),
        label: "Type",
        options: [
            { value: "reduce", label: "Reducer" },
            { value: "expand", label: "Expander" }
        ]
    },

    equipmentPlacement: {
        kind: "text",
        applies: (object) => enggEquipment.isEquipmentType(object?.type),
        read: (object) => (enggEquipment.isInline(object) ? "Inline" : "Standalone"),
        write: () => false,
        readOnly: true,
        label: "Placement"
    },

    equipmentPipeA: readonlyField({
        applies: (object) => enggEquipment.isEquipmentType(object?.type),
        read: (object) => objectNameOf(object.engineering?.pipeIds?.[0]),
        label: "Attached Pipe / Duct"
    }),

    equipmentPipeB: readonlyField({
        applies: (object) => enggEquipment.isEquipmentType(object?.type),
        read: (object) => objectNameOf(object.engineering?.pipeIds?.[1]),
        label: "Second Pipe / Duct"
    }),

    symbolSize: {
        kind: "number",
        applies: (object) => enggEquipment.isEquipmentType(object?.type),
        read: (object) => enggEquipment.symbolRadiusOf(object),
        write: (object, value) => enggEquipment.setSymbolSize(object, value),
        min: enggEquipment.MIN_SYMBOL_RADIUS,
        max: enggEquipment.MAX_SYMBOL_RADIUS,
        step: 0.5,
        unit: "mm",
        label: "Symbol Size"
    },

    /*
     * AN EQUIPMENT SYMBOL'S TRANSFORM.
     *
     * STANDALONE: X, Y and Rotate move and turn the symbol itself.
     * INLINE: the same rows state where the symbol sits and which way it lies,
     * because that is decided by its host pipe - and they are READ-ONLY there, so
     * the panel never offers an X/Y that would pull the symbol off its run. The
     * one inline control is Position Along Pipe below.
     */
    equipmentX: {
        kind: "number",
        applies: (object) => enggEquipment.isEquipmentType(object?.type) && !enggEquipment.isInline(object),
        read: (object) => Number(object?.geometry?.position?.x) || 0,
        write: (object, value) => {
            const x = Number(value);

            if (!Number.isFinite(x) || !object.geometry?.position) {
                return false;
            }

            object.geometry = { ...object.geometry, position: { ...object.geometry.position, x } };

            return true;
        },
        step: 1,
        unit: "mm",
        label: "X"
    },

    equipmentY: {
        kind: "number",
        applies: (object) => enggEquipment.isEquipmentType(object?.type) && !enggEquipment.isInline(object),
        read: (object) => Number(object?.geometry?.position?.y) || 0,
        write: (object, value) => {
            const y = Number(value);

            if (!Number.isFinite(y) || !object.geometry?.position) {
                return false;
            }

            object.geometry = { ...object.geometry, position: { ...object.geometry.position, y } };

            return true;
        },
        step: 1,
        unit: "mm",
        label: "Y"
    },

    equipmentRotation: {
        kind: "number",
        applies: (object) => enggEquipment.isEquipmentType(object?.type) && !enggEquipment.isInline(object),
        read: (object) => Number(object?.geometry?.rotation) || 0,
        write: (object, value) => {
            const rotation = Number(value);

            if (!Number.isFinite(rotation)) {
                return false;
            }

            object.geometry = { ...object.geometry, rotation };

            return true;
        },
        step: 1,
        unit: "°",
        label: "Rotate"
    },

    /*
     * POSITION ALONG PIPE - an INLINE symbol's one placement degree of freedom.
     *
     * The value is the fraction (0-1) of the host run's centreline the symbol's
     * centre sits at, and setting it moves the symbol AND re-seats both connected
     * segments on its connection points in one edit - so it can never leave a gap.
     */
    equipmentPosition: {
        kind: "number",
        applies: (object) => enggEquipment.isEquipmentType(object?.type) && enggEquipment.isInline(object),
        read: (object) => {
            const described = enggEquipment.describeEquipment(object);

            return described.positionAlongPipe === null || described.positionAlongPipe === undefined
                ? 0
                : Number(described.positionAlongPipe.toFixed(3));
        },
        write: (object, value) => {
            const fraction = Number(value);

            if (!Number.isFinite(fraction) || fraction <= 0 || fraction >= 1) {
                return false;
            }

            const host = enggEquipment.hostRunOf(object);
            const centre = host ? enggEquipment.centreAtFraction(host, fraction) : null;

            if (!centre) {
                return false;
            }

            return enggEquipment.slideAlongHost(object, centre);
        },
        min: 0.02,
        max: 0.98,
        step: 0.01,
        label: "Position Along Pipe"
    },

    valveDepiction: {
        kind: "segmented",
        applies: (object) => object?.type === enggEquipment.VALVE_TYPE,
        read: (object) => enggEquipment.valveDepictionOf(object),
        write: (object, value) => {
            if (!enggEquipment.VALVE_DEPICTIONS.includes(value)) {
                return false;
            }

            /*
             * THE DRAWING CHANGES, THE CONNECTION DOES NOT. A depiction is a
             * schematic state - a bar across the waist, or a stem and wheel - and
             * the two pipes stay exactly where they were.
             */
            object.engineering = { ...(object.engineering || {}), depiction: value };

            return true;
        },
        label: "Depiction",
        options: [
            { value: "generic", label: "Generic" },
            { value: "open", label: "Open" },
            { value: "closed", label: "Closed" }
        ]
    },

    /* ---------------------------------------------------------- Vessel */

    vesselStyle: {
        kind: "segmented",
        applies: (object) => enggVessel.isVesselType(object?.type),
        read: (object) => enggVessel.vesselStyleOf(object),
        write: (object, value) => {
            if (!Object.values(enggVessel.VESSEL_STYLES).includes(value)) {
                return false;
            }

            return enggVessel.setVesselStyle(object, value);
        },
        label: "Vessel Style",
        options: [
            { value: "open", label: "Open Reservoir" },
            { value: "closed", label: "Closed Tank" }
        ]
    },

    vesselX: {
        kind: "number",
        applies: (object) => enggVessel.isVesselType(object?.type),
        read: (object) => Number(object?.geometry?.position?.x) || 0,
        write: (object, value) => {
            const x = Number(value);

            if (!Number.isFinite(x) || !object.geometry?.position) {
                return false;
            }

            object.geometry = { ...object.geometry, position: { ...object.geometry.position, x } };

            return true;
        },
        step: 1,
        unit: "mm",
        label: "X"
    },

    vesselY: {
        kind: "number",
        applies: (object) => enggVessel.isVesselType(object?.type),
        read: (object) => Number(object?.geometry?.position?.y) || 0,
        write: (object, value) => {
            const y = Number(value);

            if (!Number.isFinite(y) || !object.geometry?.position) {
                return false;
            }

            object.geometry = { ...object.geometry, position: { ...object.geometry.position, y } };

            return true;
        },
        step: 1,
        unit: "mm",
        label: "Y"
    },

    vesselRotation: {
        kind: "number",
        applies: (object) => enggVessel.isVesselType(object?.type),
        read: (object) => Number((((Number(object?.geometry?.rotation) || 0) * 180) / Math.PI).toFixed(3)),
        write: (object, value) => {
            const degrees = Number(value);

            if (!Number.isFinite(degrees)) {
                return false;
            }

            object.geometry = { ...object.geometry, rotation: (degrees * Math.PI) / 180 };

            return true;
        },
        step: 1,
        unit: "°",
        label: "Rotate"
    },

    vesselWidth: {
        kind: "number",
        applies: (object) => enggVessel.isVesselType(object?.type),
        read: (object) => enggVessel.vesselRect(object)?.width || 0,
        write: (object, value) => {
            const rect = enggVessel.vesselRect(object);

            return rect ? enggVessel.resizeVessel(object, Number(value), rect.height) : false;
        },
        min: enggVessel.MIN_VESSEL_SIDE,
        max: 2000,
        step: 1,
        unit: "mm",
        label: "Width"
    },

    vesselHeight: {
        kind: "number",
        applies: (object) => enggVessel.isVesselType(object?.type),
        read: (object) => enggVessel.vesselRect(object)?.height || 0,
        write: (object, value) => {
            const rect = enggVessel.vesselRect(object);

            return rect ? enggVessel.resizeVessel(object, rect.width, Number(value)) : false;
        },
        min: enggVessel.MIN_VESSEL_SIDE,
        max: 2000,
        step: 1,
        unit: "mm",
        label: "Height"
    },

    /* ----------------------------------------------------- Fluid level */

    levelVessel: readonlyField({
        applies: (object) => enggFluidLevel.isFluidLevelType(object?.type),
        read: (object) => objectNameOf(object.engineering?.vesselId),
        label: "Attached Vessel"
    }),

    /*
     * LEVEL POSITION, AS A PERCENTAGE OF THE VESSEL'S USABLE INTERIOR.
     *
     * 0 is empty and 100 is full; the write goes to `engineering.levelPercent`
     * and re-derives the surface and the fill at once, which is the same write
     * the canvas handle makes. A percentage, not a height, because a height would
     * stop meaning the same thing the moment the tank was resized.
     */
    levelPosition: {
        kind: "number",
        applies: (object) => enggFluidLevel.isFluidLevelType(object?.type),
        read: (object) => enggFluidLevel.levelPercentOf(object),
        write: (object, value) => enggFluidLevel.setLevelPercent(object, Number(value)),
        min: 0,
        max: 100,
        step: 1,
        unit: "%",
        label: "Level Position"
    },

    /*
     * THE LIQUID'S OWN APPEARANCE - the fill BEHIND the surface line.
     *
     * It is stored on the feature's `engineering` (it is the liquid's colour, not
     * the drawing object's stroke), and both controls go through the level model,
     * so a typed value and a picker choice cannot disagree.
     */
    levelFillColour: {
        kind: "colour",
        applies: (object) => enggFluidLevel.isFluidLevelType(object?.type),
        read: (object) => enggFluidLevel.levelFillColourOf(object),
        write: (object, value) => enggFluidLevel.setLevelFillColour(object, value),
        label: "Liquid Fill Colour"
    },

    levelFillOpacity: {
        kind: "number",
        applies: (object) => enggFluidLevel.isFluidLevelType(object?.type),
        read: (object) => enggFluidLevel.levelFillOpacityOf(object),
        write: (object, value) => enggFluidLevel.setLevelFillOpacity(object, value),
        min: 0,
        max: 1,
        step: 0.05,
        label: "Fill Opacity"
    },

    /* ------------------------------------------- Flow direction diagram */

    directionPipe: readonlyField({
        applies: (object) => enggFlowArrows.isFlowDirectionType(object?.type),
        read: (object) => objectNameOf(object.engineering?.pipeId),
        label: "Attached Pipe / Duct"
    }),

    directionReversed: {
        kind: "toggle",
        applies: (object) => enggFlowArrows.isFlowDirectionType(object?.type),
        read: (object) => object.engineering?.reversed === true,
        write: (object, value) => enggFlowArrows.setDirectionReversed(object, value),
        label: "Reverse Direction"
    },

    /* WHERE THE ARROWS SIT ALONG THEIR HOST - a fraction of its centreline. */
    directionPosition: {
        kind: "number",
        applies: (object) => enggFlowArrows.isFlowDirectionType(object?.type),
        read: (object) => Number(enggFlowArrows.directionFractionOf(object).toFixed(3)),
        write: (object, value) => {
            const fraction = Number(value);

            if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
                return false;
            }

            object.engineering = {
                ...(object.engineering || {}),
                position: enggFlowArrows.clampDirectionFraction(fraction)
            };

            enggFlowArrows.refreshFlowDirection(object);

            return true;
        },
        min: 0,
        max: 1,
        step: 0.01,
        label: "Position Along Path"
    },

    directionSpacing: {
        kind: "segmented",
        applies: (object) => enggFlowArrows.isFlowDirectionType(object?.type),
        read: (object) => enggFlowArrows.directionSpacingOf(object),
        write: (object, value) => {
            if (!(value in enggFlowArrows.DIRECTION_SPACING_COUNTS)) {
                return false;
            }

            object.engineering = { ...(object.engineering || {}), spacing: value };
            enggFlowArrows.refreshFlowDirection(object);

            return true;
        },
        label: "Arrow Spacing",
        options: [...enggFlowArrows.DIRECTION_SPACING]
    },

    directionSize: {
        kind: "number",
        applies: (object) => enggFlowArrows.isFlowDirectionType(object?.type),
        read: (object) => enggFlowArrows.directionArrowSizeOf(object),
        write: (object, value) => {
            const size = Number(value);

            if (!Number.isFinite(size) || size <= 0) {
                return false;
            }

            object.engineering = { ...(object.engineering || {}), arrowSize: size };
            enggFlowArrows.refreshFlowDirection(object);

            return true;
        },
        min: 0.5,
        max: 60,
        step: 0.5,
        unit: "mm",
        label: "Arrow Size"
    },

    /* ------------------------------------------------ Pressure profile */

    graphName: {
        kind: "text",
        applies: (object) => enggPressureProfile.isPressureProfileType(object?.type),
        read: (object) => enggPressureProfile.graphNameOf(object),
        write: (object, value) => enggPressureProfile.setGraphName(object, value),
        label: "Graph Name"
    },

    profileXTitle: {
        kind: "text",
        applies: (object) => enggPressureProfile.isPressureProfileType(object?.type),
        read: (object) => enggPressureProfile.axesOf(object).xTitle,
        write: (object, value) => enggPressureProfile.setAxes(object, { xTitle: String(value ?? "") }),
        label: "X-axis Title"
    },

    profileXUnit: {
        kind: "text",
        applies: (object) => enggPressureProfile.isPressureProfileType(object?.type),
        read: (object) => enggPressureProfile.axesOf(object).xUnit,
        write: (object, value) => enggPressureProfile.setAxes(object, { xUnit: String(value ?? "") }),
        label: "X-axis Unit"
    },

    profileYTitle: {
        kind: "text",
        applies: (object) => enggPressureProfile.isPressureProfileType(object?.type),
        read: (object) => enggPressureProfile.axesOf(object).yTitle,
        write: (object, value) => enggPressureProfile.setAxes(object, { yTitle: String(value ?? "") }),
        label: "Y-axis Title"
    },

    profileYUnit: {
        kind: "text",
        applies: (object) => enggPressureProfile.isPressureProfileType(object?.type),
        read: (object) => enggPressureProfile.axesOf(object).yUnit,
        write: (object, value) => enggPressureProfile.setAxes(object, { yUnit: String(value ?? "") }),
        label: "Pressure Unit"
    },

    profileXMin: {
        kind: "number",
        applies: (object) => enggPressureProfile.isPressureProfileType(object?.type),
        read: (object) => enggPressureProfile.axesOf(object).xMin,
        write: (object, value) => enggPressureProfile.setAxes(object, { xMin: Number(value) }),
        step: 1,
        label: "X Minimum"
    },

    profileXMax: {
        kind: "number",
        applies: (object) => enggPressureProfile.isPressureProfileType(object?.type),
        read: (object) => enggPressureProfile.axesOf(object).xMax,
        write: (object, value) => enggPressureProfile.setAxes(object, { xMax: Number(value) }),
        step: 1,
        label: "X Maximum"
    },

    profileYMin: {
        kind: "number",
        applies: (object) => enggPressureProfile.isPressureProfileType(object?.type),
        read: (object) => enggPressureProfile.axesOf(object).yMin,
        write: (object, value) => enggPressureProfile.setAxes(object, { yMin: Number(value) }),
        step: 1,
        label: "Y Minimum"
    },

    profileYMax: {
        kind: "number",
        applies: (object) => enggPressureProfile.isPressureProfileType(object?.type),
        read: (object) => enggPressureProfile.axesOf(object).yMax,
        write: (object, value) => enggPressureProfile.setAxes(object, { yMax: Number(value) }),
        step: 1,
        label: "Y Maximum"
    },

    profileShowPoints: {
        kind: "toggle",
        applies: (object) => enggPressureProfile.isPressureProfileType(object?.type),
        read: (object) => enggPressureProfile.showPointsOf(object),
        write: (object, value) => {
            object.engineering = { ...(object.engineering || {}), pointsShown: Boolean(value) };

            return true;
        },
        label: "Show Points"
    },

    profileShowGrid: {
        kind: "toggle",
        applies: (object) => enggPressureProfile.isPressureProfileType(object?.type),
        read: (object) => enggPressureProfile.showGridOf(object),
        write: (object, value) => {
            object.engineering = { ...(object.engineering || {}), grid: Boolean(value) };

            return true;
        },
        label: "Show Grid"
    },

    profileWidth: {
        kind: "number",
        applies: (object) => enggPressureProfile.isPressureProfileType(object?.type),
        read: (object) => enggPressureProfile.profileFrame(object)?.width || 0,
        write: (object, value) => {
            const frame = enggPressureProfile.profileFrame(object);

            return frame ? enggPressureProfile.resizeProfile(object, Number(value), frame.height) : false;
        },
        min: enggPressureProfile.MIN_PROFILE_SIDE,
        max: 2000,
        step: 1,
        unit: "mm",
        label: "Width"
    },

    profileHeight: {
        kind: "number",
        applies: (object) => enggPressureProfile.isPressureProfileType(object?.type),
        read: (object) => enggPressureProfile.profileFrame(object)?.height || 0,
        write: (object, value) => {
            const frame = enggPressureProfile.profileFrame(object);

            return frame ? enggPressureProfile.resizeProfile(object, frame.width, Number(value)) : false;
        },
        min: enggPressureProfile.MIN_PROFILE_SIDE,
        max: 2000,
        step: 1,
        unit: "mm",
        label: "Height"
    },

    /*
     * THE GRAPH'S POSITION, AS ITS ANCHOR CORNER.
     *
     * X and Y state the frame's own bottom-left corner, and typing one moves the
     * whole frame - its axes, its grid, its ticks and its plotted points all move
     * with it, because every one of them is derived from this one corner.
     */
    profileX: {
        kind: "number",
        applies: (object) => enggPressureProfile.isPressureProfileType(object?.type),
        read: (object) => Number(object?.geometry?.position?.x) || 0,
        write: (object, value) => {
            const x = Number(value);

            if (!Number.isFinite(x) || !object.geometry?.position) {
                return false;
            }

            object.geometry = { ...object.geometry, position: { ...object.geometry.position, x } };

            return true;
        },
        step: 1,
        unit: "mm",
        label: "X"
    },

    profileY: {
        kind: "number",
        applies: (object) => enggPressureProfile.isPressureProfileType(object?.type),
        read: (object) => Number(object?.geometry?.position?.y) || 0,
        write: (object, value) => {
            const y = Number(value);

            if (!Number.isFinite(y) || !object.geometry?.position) {
                return false;
            }

            object.geometry = { ...object.geometry, position: { ...object.geometry.position, y } };

            return true;
        },
        step: 1,
        unit: "mm",
        label: "Y"
    },

    /* ------------------------------------------------ Flow profile */

    flowProfileName: {
        kind: "text",
        applies: (object) => enggFlowProfile.isFlowProfileType(object?.type),
        read: (object) => enggFlowProfile.graphNameOf(object),
        write: (object, value) => enggFlowProfile.setGraphName(object, value),
        label: "Profile Title"
    },

    /*
     * THE QUANTITY BEING PLOTTED.
     *
     * It decides the units the profile's values may be stated in - so changing
     * it also re-states the Y axis through `setQuantity`.
     */
    flowQuantity: {
        kind: "choice",
        applies: (object) => enggFlowProfile.isFlowProfileType(object?.type),
        read: (object) => enggFlowProfile.quantityIdOf(object),
        write: (object, value) => enggFlowProfile.setQuantity(object, String(value)),
        options: enggFlowProfile.FLOW_QUANTITIES.map((entry) => ({ value: entry.id, label: entry.label })),
        label: "Flow Quantity"
    },

    /* The student's own name for a CUSTOM quantity - shown only when it is one. */
    flowCustomLabel: {
        kind: "text",
        applies: (object) =>
            enggFlowProfile.isFlowProfileType(object?.type) && enggFlowProfile.quantityIdOf(object) === "custom",
        read: (object) => String(object.engineering?.customLabel ?? ""),
        write: (object, value) => enggFlowProfile.setCustomLabel(object, value),
        label: "Custom Quantity Label"
    },

    flowStationKind: {
        kind: "choice",
        applies: (object) => enggFlowProfile.isFlowProfileType(object?.type),
        read: (object) => enggFlowProfile.stationKindOf(object),
        write: (object, value) => {
            const id = String(value);

            if (!enggFlowProfile.STATION_KINDS.some((entry) => entry.id === id)) {
                return false;
            }

            object.engineering = { ...(object.engineering || {}), stationKind: id };

            return true;
        },
        options: enggFlowProfile.STATION_KINDS.map((entry) => ({ value: entry.id, label: entry.label })),
        label: "Station Axis"
    },

    /*
     * THE TWO UNIT SELECTORS. Each is a CHOICE list drawn from the SHARED unit
     * table for the profile's own quantity, and each CONVERTS the stored rows
     * when it changes - so a unit change preserves the physical value instead of
     * making the graph mean something else.
     */
    flowValueUnit: {
        kind: "choice",
        applies: (object) => enggFlowProfile.isFlowProfileType(object?.type),
        read: (object) => enggFlowProfile.axesOf(object).yUnit,
        write: (object, value) => enggFlowProfile.setValueUnit(object, String(value)),
        options: (object) =>
            enggFlowProfile.unitsOf(object || { engineering: {} }).map((unit) => ({ value: unit, label: unit || "(none)" })),
        label: "Value Unit"
    },

    flowStationUnit: {
        kind: "choice",
        applies: (object) => enggFlowProfile.isFlowProfileType(object?.type),
        read: (object) => enggFlowProfile.axesOf(object).xUnit,
        write: (object, value) => enggFlowProfile.setStationUnit(object, String(value)),
        options: () =>
            enggQuantities.unitsFor("length").map((unit) => ({ value: unit, label: unit })),
        label: "Station Unit"
    },

    flowXTitle: {
        kind: "text",
        applies: (object) => enggFlowProfile.isFlowProfileType(object?.type),
        read: (object) => enggFlowProfile.axesOf(object).xTitle,
        write: (object, value) => enggFlowProfile.setAxes(object, { xTitle: String(value ?? "") }),
        label: "Station Axis Title"
    },

    flowYTitle: {
        kind: "text",
        applies: (object) => enggFlowProfile.isFlowProfileType(object?.type),
        read: (object) => enggFlowProfile.axesOf(object).yTitle,
        write: (object, value) => enggFlowProfile.setAxes(object, { yTitle: String(value ?? "") }),
        label: "Value Axis Title"
    },

    flowXMin: {
        kind: "number",
        applies: (object) => enggFlowProfile.isFlowProfileType(object?.type),
        read: (object) => enggFlowProfile.axesOf(object).xMin,
        write: (object, value) => enggFlowProfile.setAxes(object, { xMin: Number(value) }),
        step: 1,
        label: "Station Minimum"
    },

    flowXMax: {
        kind: "number",
        applies: (object) => enggFlowProfile.isFlowProfileType(object?.type),
        read: (object) => enggFlowProfile.axesOf(object).xMax,
        write: (object, value) => enggFlowProfile.setAxes(object, { xMax: Number(value) }),
        step: 1,
        label: "Station Maximum"
    },

    flowYMin: {
        kind: "number",
        applies: (object) => enggFlowProfile.isFlowProfileType(object?.type),
        read: (object) => enggFlowProfile.axesOf(object).yMin,
        write: (object, value) => enggFlowProfile.setAxes(object, { yMin: Number(value) }),
        step: 1,
        label: "Value Minimum"
    },

    flowYMax: {
        kind: "number",
        applies: (object) => enggFlowProfile.isFlowProfileType(object?.type),
        read: (object) => enggFlowProfile.axesOf(object).yMax,
        write: (object, value) => enggFlowProfile.setAxes(object, { yMax: Number(value) }),
        step: 1,
        label: "Value Maximum"
    },

    flowLineStyle: {
        kind: "choice",
        applies: (object) => enggFlowProfile.isFlowProfileType(object?.type),
        read: (object) => enggFlowProfile.lineStyleOf(object),
        write: (object, value) => enggFlowProfile.setLineStyle(object, String(value)),
        options: enggFlowProfile.LINE_STYLES.map((entry) => ({ value: entry.id, label: entry.label })),
        label: "Profile Line"
    },

    flowShowPoints: {
        kind: "toggle",
        applies: (object) => enggFlowProfile.isFlowProfileType(object?.type),
        read: (object) => enggFlowProfile.showPointsOf(object),
        write: (object, value) => {
            object.engineering = { ...(object.engineering || {}), pointsShown: Boolean(value) };

            return true;
        },
        label: "Show Data Points"
    },

    flowShowGrid: {
        kind: "toggle",
        applies: (object) => enggFlowProfile.isFlowProfileType(object?.type),
        read: (object) => enggFlowProfile.showGridOf(object),
        write: (object, value) => {
            object.engineering = { ...(object.engineering || {}), grid: Boolean(value) };

            return true;
        },
        label: "Show Grid"
    },

    flowWidth: {
        kind: "number",
        applies: (object) => enggFlowProfile.isFlowProfileType(object?.type),
        read: (object) => enggFlowProfile.profileFrame(object)?.width || 0,
        write: (object, value) => {
            const frame = enggFlowProfile.profileFrame(object);

            return frame ? enggFlowProfile.resizeProfile(object, Number(value), frame.height) : false;
        },
        min: enggFlowProfile.MIN_PROFILE_SIDE,
        max: 2000,
        step: 1,
        unit: "mm",
        label: "Width"
    },

    flowHeight: {
        kind: "number",
        applies: (object) => enggFlowProfile.isFlowProfileType(object?.type),
        read: (object) => enggFlowProfile.profileFrame(object)?.height || 0,
        write: (object, value) => {
            const frame = enggFlowProfile.profileFrame(object);

            return frame ? enggFlowProfile.resizeProfile(object, frame.width, Number(value)) : false;
        },
        min: enggFlowProfile.MIN_PROFILE_SIDE,
        max: 2000,
        step: 1,
        unit: "mm",
        label: "Height"
    },

    flowX: {
        kind: "number",
        applies: (object) => enggFlowProfile.isFlowProfileType(object?.type),
        read: (object) => Number(object?.geometry?.position?.x) || 0,
        write: (object, value) => {
            const x = Number(value);

            if (!Number.isFinite(x) || !object.geometry?.position) {
                return false;
            }

            object.geometry = { ...object.geometry, position: { ...object.geometry.position, x } };

            return true;
        },
        step: 1,
        unit: "mm",
        label: "X"
    },

    flowY: {
        kind: "number",
        applies: (object) => enggFlowProfile.isFlowProfileType(object?.type),
        read: (object) => Number(object?.geometry?.position?.y) || 0,
        write: (object, value) => {
            const y = Number(value);

            if (!Number.isFinite(y) || !object.geometry?.position) {
                return false;
            }

            object.geometry = { ...object.geometry, position: { ...object.geometry.position, y } };

            return true;
        },
        step: 1,
        unit: "mm",
        label: "Y"
    },

    /* -------------------------------------------------- Section plane */

    sectionIdentifier: {
        kind: "text",
        applies: (object) => enggSectionPlane.isSectionPlaneType(object?.type),
        read: (object) => enggSectionPlane.sectionIdentifierOf(object),
        write: (object, value) => enggSectionPlane.setSectionIdentifier(object, value),
        label: "Section Identifier"
    },

    sectionDirection: {
        kind: "segmented",
        applies: (object) => enggSectionPlane.isSectionPlaneType(object?.type),
        read: (object) => enggSectionPlane.sectionDirectionOf(object),
        write: (object, value) => enggSectionPlane.setSectionDirection(object, value),
        label: "Viewing Direction",
        options: [
            { value: "forward", label: "Forward" },
            { value: "reverse", label: "Reverse" }
        ]
    },

    sectionShowArrows: {
        kind: "toggle",
        applies: (object) => enggSectionPlane.isSectionPlaneType(object?.type),
        read: (object) => enggSectionPlane.showSectionArrowsOf(object),
        write: (object, value) => {
            object.engineering = { ...(object.engineering || {}), showArrows: Boolean(value) };

            return true;
        },
        label: "Viewing Arrows"
    },

    /* THE MARKER'S MIDDLE - the centre of its trace. */
    sectionX: {
        kind: "number",
        applies: (object) => enggSectionPlane.isSectionPlaneType(object?.type),
        read: (object) => {
            const span = enggSectionPlane.sectionSpan(object);

            return span ? Number(((span.start.x + span.end.x) / 2).toFixed(2)) : 0;
        },
        write: (object, value) => {
            const span = enggSectionPlane.sectionSpan(object);
            const x = Number(value);

            if (!span || !Number.isFinite(x)) {
                return false;
            }

            const dx = x - (span.start.x + span.end.x) / 2;

            object.geometry = {
                start: { x: span.start.x + dx, y: span.start.y },
                end: { x: span.end.x + dx, y: span.end.y }
            };

            return true;
        },
        step: 1,
        unit: "mm",
        label: "X"
    },

    sectionY: {
        kind: "number",
        applies: (object) => enggSectionPlane.isSectionPlaneType(object?.type),
        read: (object) => {
            const span = enggSectionPlane.sectionSpan(object);

            return span ? Number(((span.start.y + span.end.y) / 2).toFixed(2)) : 0;
        },
        write: (object, value) => {
            const span = enggSectionPlane.sectionSpan(object);
            const y = Number(value);

            if (!span || !Number.isFinite(y)) {
                return false;
            }

            const dy = y - (span.start.y + span.end.y) / 2;

            object.geometry = {
                start: { x: span.start.x, y: span.start.y + dy },
                end: { x: span.end.x, y: span.end.y + dy }
            };

            return true;
        },
        step: 1,
        unit: "mm",
        label: "Y"
    },

    sectionRotation: {
        kind: "number",
        applies: (object) => enggSectionPlane.isSectionPlaneType(object?.type),
        read: (object) => Number(enggSectionPlane.sectionRotationOf(object).toFixed(3)),
        write: (object, value) => enggSectionPlane.setSectionRotation(object, value),
        step: 1,
        unit: "°",
        label: "Rotate"
    },

    sectionLength: {
        kind: "number",
        applies: (object) => enggSectionPlane.isSectionPlaneType(object?.type),
        read: (object) => enggSectionPlane.sectionLengthOf(object),
        write: (object, value) => enggSectionPlane.setSectionLength(object, value),
        min: enggSectionPlane.MIN_SECTION_LENGTH,
        max: 2000,
        step: 1,
        unit: "mm",
        label: "Section Length"
    },

    /* ----------------------------------------------- The free flow arrow */

    freeArrowLength: {
        kind: "number",
        applies: (object) => enggFlowArrows.isFreeFlowArrowType(object?.type) && !object?.attachment,
        read: (object) => enggFlowArrows.freeArrowLength(object),
        write: (object, value) => enggFlowArrows.setFreeArrowLength(object, value),
        min: enggFlowArrows.MIN_FREE_ARROW_LENGTH,
        max: enggFlowArrows.MAX_FREE_ARROW_LENGTH,
        step: 1,
        unit: "mm",
        label: "Length"
    }
});

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
    return FIELDS[key] || dynamicField(key) || processBendField(key);
}

export function fieldDefinition(key) {
    return definitionOf(key) || null;
}

export function fieldLabel(field, key) {
    return field.label || {
        markerStyle: "Style",
        markerSize: "Size",
        lineType: "Line Style",
        arrowStart: "Begin Arrow",
        arrowEnd: "End Arrow",
        arrowhead: "Arrowhead",
        sides: "Number of Sides",
        fillMode: "Fill",
        fill: "Fill Colour",
        stroke: "Outline Colour",
        lineWidth: "Thickness",
        customWidth: "Width",
        fixed: "Fix",
        name: "Name",
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

    if (isSignalLine(object)) {
        return [];
    }

    /*
     * THE SCHEMATIC FLUIDS TOOLS HAVE THEIR OWN SECTIONS.
     *
     * A reducer, a symbol, a vessel, a level, a direction arrow, a free arrow, a
     * profile or a section mark is not any of the shared shape kinds, so the
     * shared table would give it an Appearance row and nothing else. Its own
     * table says Object, Appearance, Transform - and, for a profile, Data and
     * Axes - in that order.
     */
    const schematic = schematicGroupsFor(object);

    if (schematic) {
        return schematic
            .map((group) => ({
                ...group,
                fields: group.fields
                    .map((key) => ({ key, definition: definitionOf(key) }))
                    .filter((entry) => entry.definition && entry.definition.applies(object))
            }))
            .filter((group) => group.fields.length || group.transform);
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
    const controlBlock = isControlBlock(object)
        ? [{
            ...GROUPS.find((group) => group.id === "plant"),
            heading: isBlock(object) ? "Block" : "Plant"
        }]
        : [];
    const dynamics = isDynamicsObject(object)
        ? DYNAMICS_GROUPS
        : [];

    /*
     * A PIPE / DUCT HAS EXACTLY THREE SECTIONS: Object, Appearance, Transform.
     *
     * The shared table is ordered for the drawing shapes - Line, Shape, Fill,
     * then the common sections - which would put a stray "Line" and "Fill"
     * heading above Appearance on a pipe. A pipe is a DRAWING STYLE, not a
     * shape: its line type, colour, thickness and fill all belong together
     * under Appearance, so the per-shape groups are dropped for it and the
     * three sections it does have are put in the order they are specified in.
     */
    const isPipe = object.type === "pipe-duct";

    /*
     * AN ELBOW HAS THE SAME THREE SECTIONS AS A RUN - Object, Appearance and
     * Transform - and nothing else. Its Line Style, Outline Colour, Thickness
     * and Fill belong together under Appearance, and its own Bend Radius and
     * Bend Angle are Transform rows. There is no Rotate row and no Visibility
     * control: a fitting is placed by its pipes, so neither is specified.
     */
    const isElbow = object.type === "elbow";

    /*
     * A JUNCTION HAS THE SAME THREE SECTIONS AGAIN - Object, Appearance and
     * Transform - with no branch angle rows and no branch length. An arm is a
     * connection stub, and the fitting is placed by its pipes.
     */
    const isJunction = object.type === "junction";

    const flowPath = isPipe || isElbow || isJunction;

    /*
     * A FLOW ARROW HAS TWO SECTIONS: Object and Appearance.
     *
     * Object holds what it is attached to, whether it is held, which way it
     * points and how big its head is. Appearance holds the shared Line Style,
     * Colour, Thickness and Arrowhead Fill. There is no Transform section,
     * because a transform is a way to move something and an arrow has no
     * position to transform - it is placed on a pipe, by pressing on the pipe.
     *
     * The shared table's per-shape groups (Line, Fill, Shape, Text) are dropped
     * for it the same way they are for a run: an arrow's label is not part of
     * the feature the student drew.
     */
    const isFlowArrow = object.type === "flow-arrow";

    const base = [...dynamics, ...GROUPS];

    const groups = (isFlowArrow ? [...base, FLOW_ARROW_GROUP] : base)
        .filter(
            (group) =>
                !flowPath ||
                ["object", "appearance", "transform"].includes(group.id)
        )
        .filter(
            (group) =>
                !isFlowArrow || group.id === "appearance" || group.id === FLOW_ARROW_GROUP.id
        )
        .map((group) => {
            const fields = group.fields
                .map((key) => ({ key, definition: definitionOf(key) }))
                .filter((entry) => entry.definition && entry.definition.applies(object));

            return { ...group, fields };
        })
        .filter((group) => group.transform || group.fields.length);

    if (flowPath) {
        const order = ["object", "appearance", "transform"];

        groups.sort(
            (left, right) =>
                order.indexOf(left.id) - order.indexOf(right.id)
        );
    }

    if (isFlowArrow) {
        const order = [FLOW_ARROW_GROUP.id, "appearance"];

        groups.sort((left, right) => order.indexOf(left.id) - order.indexOf(right.id));
    }

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

/*
 * ============================================================
 * THE JOINTS OF EVERY FLUID OBJECT THAT WAS JUST EDITED
 * ============================================================
 *
 * Injected, exactly like the elbow's run lookup: this module declares FIELDS and
 * must not depend on the live document or on the interaction layer. The panel
 * layer supplies the reconciler and calls this after an edit, so a typed value
 * and a dragged handle settle their connections through ONE implementation.
 */
export function setFluidReconciler(reconcile) {
    elbowLookupStore().reconcile = typeof reconcile === "function" ? reconcile : null;
}

export function reconcileFluidGeometry(objects) {
    const { reconcile, run } = elbowLookupStore();

    if (typeof reconcile !== "function" || !Array.isArray(objects)) {
        return;
    }

    objects.forEach((object) => {
        if (object?.type === "pipe-duct") {
            reconcile(object);
            return;
        }

        /*
         * AN ELBOW THAT IS JOINED AT BOTH ENDS IS PART OF THE PIPES' CORNER, so
         * the pipes around it are what has to settle - not the fitting on its
         * own.
         */
        if (object?.type !== "elbow" || typeof run !== "function") {
            return;
        }

        const pipes = (Array.isArray(object.engineering?.connections)
            ? object.engineering.connections
            : []
        )
            .filter(Boolean)
            .map(run)
            .filter(Boolean);

        if (pipes.length === 2) {
            reconcile(pipes[0], pipes[1]);
        }
    });
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
    if (!object || typeof object !== "object" || !object.geometry || isSignalLine(object)) {
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

    /*
     * A SCHEMATIC OBJECT HAS A TRANSFORM WHEN IT CAN MOVE AT ALL.
     *
     * A vessel, a graph frame, a section trace and a free arrow translate by
     * their stored geometry, so the probe below answers for them. THE HOSTED
     * ONES - a reducer, an inline symbol, a fluid level, a direction arrow - are
     * moved along what they belong to, and the probe rightly says a bare
     * translation changes nothing; but they DO have a transform (their position
     * along the host, their size), and the panel offers it rather than hiding
     * it. An object that is FIXED still gets the rows, so the student can see
     * why nothing moves.
     */
    if (
        enggReducer.isReducerType(object.type) ||
        enggEquipment.isEquipmentType(object.type) ||
        enggVessel.isVesselType(object.type) ||
        enggFluidLevel.isFluidLevelType(object.type) ||
        enggFlowArrows.isFlowDirectionType(object.type) ||
        enggPressureProfile.isPressureProfileType(object.type) ||
        enggSectionPlane.isSectionPlaneType(object.type)
    ) {
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
    junction: "Junction",
    "reducer-expander": "Reducer / Expander",
    "reservoir-tank": "Reservoir / Tank",
    pump: "Pump",
    valve: "Valve",
    "flow-meter": "Flow Meter",
    "flow-arrow": "Flow Arrow",
    "fluid-level": "Fluid Level",
    "pressure-tap": "Pressure Tap",
    "flow-direction-diagram": "Flow Direction Diagram",
    "pressure-profile": "Pressure Profile",
    "section-plane": "Section Plane",
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
    if (isSignalLine(object)) {
        return "Signal Line";
    }

    if (isPlant(object)) {
        return "Plant";
    }

    if (isBlock(object)) {
        return "Block";
    }

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
    annotate: "Annotation",

    /*
     * ========================================================
     * THE FLUIDS OBJECTS
     * ========================================================
     *
     * Every Fluids type maps to the icon of the TOOL that makes it, so a Pipe /
     * Duct in the Objects list wears the Pipe / Duct artwork, an Elbow the Elbow
     * artwork, and so on. Without these entries every Fluids object fell through
     * to the neutral "object" mark - which is why a pipe, a pump and a section
     * plane all looked alike in the list.
     *
     * A TYPE, NOT A TOOL. This table is keyed by the STORED type, so an Elbow the
     * student draws and an Elbow generated automatically at a corner are the same
     * row with the same icon - there is no separate "auto" identity to map.
     *
     * The shared reference types reuse the same artwork their Statics counterparts
     * do, because they are the same objects: a Reference Line in Fluids IS a
     * reference line, and the icon table already has one.
     */
    "pipe-duct": "Pipe / Duct",
    elbow: "Elbow",
    junction: "Junction",
    "reducer-expander": "Reducer / Expander",
    "reservoir-tank": "Reservoir / Tank",
    pump: "Pump",
    valve: "Valve",
    "flow-meter": "Flow Meter",
    "flow-arrow": "Flow Arrow",
    "fluid-level": "Fluid Level",
    "pressure-tap": "Pressure Tap",
    "flow-direction-diagram": "Flow Direction Diagram",
    "pressure-profile": "Pressure Profile",
    "section-plane": "Section Plane"
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
        isSignalLine(object)
            ? "Signal Line"
            : object.type === "annotate"
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
