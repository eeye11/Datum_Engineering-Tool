/*
 * ============================================================
 * WHAT A FEATURE IS, IN WORDS
 * ============================================================
 *
 * The drawing commands in a .tex say what a picture LOOKS like. This module
 * says what each part of it IS - "Pin support on Beam 1, at x = 0 mm" - so a
 * reader without DAETUM (a person, or an AI model the file is given to) knows
 * the engineering meaning, not just the lines.
 *
 * Positions are written in the same drawing coordinates as the commands, so a
 * description can be matched to its code. Lengths are written in drawing units
 * (millimetres on the sheet); loads and moments in the unit stored with them.
 *
 * A type this module does not know is still described - by its name, its type
 * and its stored parameters - so a feature added later is never left out.
 */
import { ANNOTATE_KINDS } from "../../../features/workspace/model/annotations/annotate-model.js";
import { isPistonCylinder } from "../../../features/workspace/model/thermodynamics/piston-cylinder.js";
import { isSaturationCurve } from "../../../features/workspace/model/thermodynamics/saturation-curve.js";

const TYPE_LABELS = {
    point: "Point",
    line: "Line",
    polyline: "Polyline",
    triangle: "Triangle",
    rectangle: "Rectangle",
    polygon: "Regular polygon",
    circle: "Circle",
    arc: "Arc",
    particle: "Particle",
    "rigid-body": "Rigid body",
    beam: "Beam",
    truss: "Truss",
    cable: "Cable",
    shaft: "Shaft",
    force: "Point force",
    resultant: "Resultant force",
    "force-components": "Force components",
    load: "Uniformly distributed load",
    "varying-load": "Linearly varying distributed load",
    moment: "Applied moment",
    "pin-support": "Pin support",
    "roller-support": "Roller support",
    "fixed-support": "Fixed support",
    "smooth-support": "Smooth support",
    "pin-connection": "Pin connection",
    "fixed-connection": "Fixed connection",
    "slider-connection": "Slider connection",
    connection: "Connection",
    dimension: "Dimension",
    annotation: "Value label",
    annotate: "Annotation",
    "coordinate-system-2d": "2D coordinate system",
    construction: "Construction geometry"
};

const DIAGRAM_LABELS = {
    sfd: "Shear force diagram (SFD)",
    bmd: "Bending moment diagram (BMD)",
    afd: "Axial force diagram (AFD)"
};

const THERMODYNAMICS_LABELS = {
    "control-volume": "Control volume",
    "piston-cylinder": "Piston-cylinder",
    "saturation-curve": "Saturation curve (T-v / P-v dome)",
    "process-path": "Thermodynamic process path",
    "constant-temp-pressure-lines": "Constant temperature/pressure line"
};

/* Geometry fields that are lengths, stated in drawing units (mm on the sheet). */
const LENGTH_FIELDS = ["length", "width", "height", "radius", "depth", "diameter", "drawingHeight"];

/* Other stored parameters worth stating, with their own unit field if any. */
const VALUE_FIELDS = [
    ["magnitude", ["unit", "momentUnit", "forceUnit"]],
    ["intensity", ["loadUnit", "unit"]],
    ["startIntensity", ["loadUnit", "unit"]],
    ["endIntensity", ["loadUnit", "unit"]],
    ["angle", null, "°"],
    ["direction", null],
    ["tension", null],
    ["torque", null],
    ["sides", null],
    ["panels", null]
];

/* A number for people: up to 3 decimals, no trailing zeros. */
function figure(value) {
    return String(Number(Number(value).toFixed(3)));
}

function coordinate(point) {
    return `(${figure(point.x)}, ${figure(point.y)})`;
}

/*
 * A length as drawn, in drawing units. (A sheet's World Scale used to convert
 * this to a "real" length; that system is retired, and the drawing states what
 * it draws.)
 */
export function drawnLength(units) {
    return `${figure(units)} drawing units`;
}

export function typeLabel(object) {
    const kind = object?.metadata?.thermodynamicsKind;

    if (kind && THERMODYNAMICS_LABELS[kind]) {
        return THERMODYNAMICS_LABELS[kind];
    }

    if (object?.type === "analysis-diagram") {
        return DIAGRAM_LABELS[object.geometry?.diagramType] || "Analysis diagram";
    }

    /* An Annotate feature says which kind it is: Note, Arrow, Leader, Table… */
    if (object?.type === "annotate" && ANNOTATE_KINDS[object.annotateKind]) {
        return ANNOTATE_KINDS[object.annotateKind].label;
    }

    return TYPE_LABELS[object?.type] || String(object?.type || "feature")
        .replace(/-/g, " ")
        .replace(/^./, c => c.toUpperCase());
}

function isPoint(value) {
    return value && Number.isFinite(value.x) && Number.isFinite(value.y);
}

/*
 * One sentence for one feature.
 *
 *   objects  every feature on the sheet (to name a parent)
 *   labels   the text the feature shows on the drawing (magnitudes, names)
 */
export function describeFeature(object, { objects = [], labels = [] } = {}) {
    const g = object.geometry || {};
    const parts = [];
    const label = typeLabel(object);
    const name = object.name && object.name.toLowerCase() !== label.toLowerCase() ? ` "${object.name}"` : "";

    parts.push(`${label}${name}`);

    const parent = object.parentId && objects.find(candidate => candidate.id === object.parentId);

    if (parent) {
        parts.push(`on ${typeLabel(parent)}${parent.name ? ` "${parent.name}"` : ""}`);
    }

    /* Where it is. */
    if (isPoint(g.start) && isPoint(g.end)) {
        const length = Math.hypot(g.end.x - g.start.x, g.end.y - g.start.y);
        parts.push(`from ${coordinate(g.start)} to ${coordinate(g.end)}, length ${drawnLength(length)}`);
    } else if (Array.isArray(g.points) && g.points.every(isPoint) && g.points.length) {
        parts.push(`through ${g.points.map(coordinate).join(", ")}`);
    } else if (isPoint(g.center)) {
        parts.push(`centred at ${coordinate(g.center)}`);
    } else if (isPoint(g.position)) {
        parts.push(`at ${coordinate(g.position)}`);
    } else if (isPoint(g.origin)) {
        parts.push(`origin at ${coordinate(g.origin)}`);
    }

    if (Number.isFinite(Number(g.distanceAlongBody)) && parent) {
        parts.push(`${drawnLength(Number(g.distanceAlongBody))} from its start`);
    }

    /* Sizes. */
    for (const field of LENGTH_FIELDS) {
        if (Number.isFinite(Number(g[field])) && g[field] !== null && g[field] !== "") {
            parts.push(`${field.replace(/([A-Z])/g, " $1").toLowerCase()} ${drawnLength(Number(g[field]))}`);
        }
    }

    if (object.type === "arc" && Number.isFinite(g.sweep)) {
        parts.push(`sweep ${figure((g.sweep * 180) / Math.PI)}°`);
    }

    /* Values. */
    for (const [field, unitFields, suffix] of VALUE_FIELDS) {
        const value = g[field];

        if (value === undefined || value === null || value === "" || typeof value === "object") {
            continue;
        }

        const unit = unitFields?.map(key => g[key]).find(u => typeof u === "string" && u) || "";
        const shown = Number.isFinite(Number(value)) ? figure(value) : String(value);
        parts.push(`${field.replace(/([A-Z])/g, " $1").toLowerCase()} ${shown}${suffix || (unit ? ` ${unit}` : "")}`);
    }

    if (isPistonCylinder(object) && g.hasStoppers) {
        parts.push("with stoppers");
    }

    if (isSaturationCurve(object)) {
        if (g.xLabel) parts.push(`x axis "${g.xLabel}"`);
        if (g.yLabel) parts.push(`y axis "${g.yLabel}"`);
    }

    const text = [object.text, ...labels]
        .map(value => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean);
    const unique = [...new Set(text)];

    if (unique.length) {
        parts.push(`labelled ${unique.map(t => `"${t}"`).join(", ")}`);
    }

    if (object.locked) {
        parts.push("locked");
    }

    return parts.join(", ") + ".";
}

