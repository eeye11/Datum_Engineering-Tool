/*
 * ============================================================
 * DYNAMICS TOOL DEFINITIONS
 * ============================================================
 *
 * The Dynamics library is organised the way Statics is - a family opens a
 * submenu, a child item arms the tool that draws - so its declarations mirror
 * `statics-tools.js`:
 *
 *   DYNAMICS_TOOL_MENUS    the families, and the tools inside them
 *   DYNAMICS_CHILD_TOOLS   each tool's label, feature type and geometry
 *   DYNAMICS_PLACEMENT_TOOLS  tools finished by a single click
 *   DYNAMICS_SPAN_TOOLS    tools drawn from a first point to a second
 *   openDynamicsMenu()     the shared submenu, opened by a family button
 *
 * WHAT MAKES A DYNAMICS TOOL A DYNAMICS TOOL is `engineering.dynamicsType`.
 * That one field is what the renderer, the Features panel, the source writer
 * and the direct-manipulation handles ask, so a Spring is recognised as a
 * spring wherever it appears without any of them keeping a list of ids.
 *
 * A COMPOSITE SYMBOL IS STILL ONE OBJECT. A spring-damper pair, a pulley with
 * its rope and a coordinate system with its axes are each ONE feature with
 * one id; the parts are fields of its geometry, never separate objects. That
 * is what keeps the Objects panel to one row per tool and makes a move, an
 * undo or a delete act on the whole symbol at once.
 *
 * THESE ARE DRAWING TOOLS. Nothing here computes a velocity, a stiffness, a
 * damping coefficient or a tension. A label the student types is written as
 * given; nothing is derived from the geometry and printed as a result.
 */

import { drawingState } from "../editor-state.js";
import { openToolSubmenu } from "../../../components/layout/toolbar/tool-menus.js";

/* ============================================================
 * THE FAMILIES
 * ============================================================ */

export const DYNAMICS_TOOL_MENUS = {
    "dynamics-bodies": [
        { id: "dynamics-particle", label: "Particle" },
        { id: "dynamics-rigid-body", label: "Rigid Body" }
    ],

    "dynamics-kinematics": [
        { id: "dynamics-trajectory", label: "Trajectory" },
        { id: "dynamics-polar-vector", label: "Polar Vector" },
        { id: "dynamics-angular-vector", label: "Angular Vector" }
    ],

    "dynamics-mechanical": [
        { id: "dynamics-spring", label: "Spring" },
        { id: "dynamics-damper", label: "Viscous Damper" },
        { id: "dynamics-spring-damper", label: "Spring–Damper Element" },
        { id: "dynamics-pulley", label: "Pulley" }
    ]
};

/* ============================================================
 * THE TOOLS
 * ============================================================
 *
 * `type` is the stored feature type. Where a Dynamics tool draws exactly the
 * same kind of thing an existing tool does - a reference point is a point, a
 * reference line is a line, a reference arc is an arc, a coordinate system is
 * a coordinate system - it reuses that type and is distinguished by its
 * `dynamicsType` alone. That is the same decision the Statics Reference
 * tools make, and it is what gives them the Features panel, the handles and
 * the source they already have.
 *
 * `placement` says how the gesture works:
 *
 *   "point"  a click places it; a drag may size it (radius, marker size)
 *   "span"   a drag from the first terminal to the second
 *   "box"    a drag from one corner of the body to the opposite one
 *   "angle"  a drag from the centre outwards (a rotation symbol, a pulley)
 *
 * Every one of them is a press-drag-release, so they all take part in the
 * editor's existing creation-drag session.
 */
/*
 * ============================================================
 * THE SIDEBAR HIERARCHY
 * ============================================================
 *
 * Declared in `dynamics-hierarchy.js`, a leaf module that imports nothing -
 * the sidebar has to read it, and reading it from HERE closed a cycle through
 * the toolbar that stopped this module loading at all. Imported and
 * re-exported so there is still one declaration of the section.
 */
export { DYNAMICS_TOOL_GROUPS, DYNAMICS_COLLAPSIBLE_CATEGORIES, DYNAMICS_OWN_TYPES } from "./dynamics-hierarchy.js";
import { DYNAMICS_TOOL_GROUPS, DYNAMICS_COLLAPSIBLE_CATEGORIES, DYNAMICS_OWN_TYPES } from "./dynamics-hierarchy.js";


export const DYNAMICS_CHILD_TOOLS = {
    "dynamics-particle": {
        label: "Particle",
        type: "particle",
        placement: "point"
    },
    "dynamics-rigid-body": {
        label: "Rigid Body",
        type: "rigid-body",
        placement: "box"
    },

    "dynamics-trajectory": {
        label: "Trajectory",
        type: "dynamics-trajectory",
        placement: "span"
    },
    "dynamics-polar-vector": {
        label: "Polar Vector",
        type: "dynamics-polar-vector",
        placement: "span"
    },
    "dynamics-angular-vector": {
        label: "Angular Vector",
        type: "dynamics-angular-vector",
        placement: "angle"
    },

    "dynamics-spring": {
        label: "Spring",
        type: "dynamics-spring",
        placement: "span"
    },
    "dynamics-damper": {
        label: "Viscous Damper",
        type: "dynamics-damper",
        placement: "span"
    },
    "dynamics-spring-damper": {
        label: "Spring–Damper Element",
        type: "dynamics-spring-damper",
        placement: "span"
    },
    "dynamics-pulley": {
        label: "Pulley",
        type: "dynamics-pulley",
        placement: "angle"
    },

    "dynamics-coordinate-system": {
        label: "Coordinate System",
        type: "coordinate-system-2d",
        placement: "box"
    },
    "dynamics-reference-point": {
        label: "Reference Point",
        type: "point",
        placement: "point"
    },
    "dynamics-reference-line": {
        label: "Reference Line",
        type: "line",
        placement: "span"
    },
    "dynamics-reference-arc": {
        label: "Reference Arc",
        type: "arc",
        placement: "span"
    },

    /*
     * THE ARC MENU'S OTHER CONSTRUCTION METHODS.
     *
     * A Reference Arc draws the editor's own arc, so it offers the editor's own
     * arc METHODS - centre/sweep and three-point - as well as the one-gesture
     * chord. They are separate ids because they are separate entries in the arc
     * submenu, but they make the SAME Dynamics object (`dynamics-reference-arc`)
     * through the arc tool's own phase machine, so the committed feature is one
     * kind of thing however it was drawn.
     */
    "dynamics-reference-arc-centre": {
        label: "Reference Arc",
        type: "arc",
        placement: "span",
        aliasOf: "dynamics-reference-arc"
    },
    "dynamics-reference-arc-3point": {
        label: "Reference Arc",
        type: "arc",
        placement: "span",
        aliasOf: "dynamics-reference-arc"
    }
};

/*
 * WHICH TYPES ARE DYNAMICS' OWN is stated in `dynamics-hierarchy.js`, so the
 * geometry registry underneath the drawing model can read it without closing
 * a cycle through this module - see the note there. Everything here uses the
 * re-export above.
 */

/* Whether an object was made by a Dynamics tool. */
export function isDynamicsObject(object) {
    return Boolean(object && typeof object.engineering?.dynamicsType === "string");
}

/* The `dynamicsType` of an object, or null. */
export function dynamicsTypeOf(object) {
    const value = object?.engineering?.dynamicsType;

    return typeof value === "string" && value ? value : null;
}

/* Whether a tool id belongs to the Dynamics library. */
export function isDynamicsTool(toolId) {
    return Object.prototype.hasOwnProperty.call(
        DYNAMICS_CHILD_TOOLS,
        String(toolId ?? "")
    );
}

/* The definition of a Dynamics tool, or null. */
export function dynamicsToolDefinition(toolId) {
    return DYNAMICS_CHILD_TOOLS[toolId] || null;
}

/*
 * THE TOOL A MENU ENTRY REALLY ARMS.
 *
 * A Reference Arc's alternative construction methods are entries in the arc
 * submenu, but the OBJECT they make is the same one thing - so an id that
 * names a method resolves to the id that names the tool (`aliasOf`). Every
 * caller that needs "which Dynamics tool is this" asks here rather than
 * reading the table itself, and a method id can never be mistaken for a
 * separate feature type.
 */
export function resolveDynamicsToolId(toolId) {
    const definition = DYNAMICS_CHILD_TOOLS[toolId];

    return definition?.aliasOf || (definition ? toolId : null);
}

/* ============================================================
 * WHEN THE FEATURE IS FINISHED
 * ============================================================
 *
 * Tools finished by one click (a point or a particle). Everything else is a
 * drag, which is what the creation session already handles.
 */
export const DYNAMICS_PLACEMENT_TOOLS = Object.fromEntries(
    Object.entries(DYNAMICS_CHILD_TOOLS)
        .filter(([, definition]) => definition.placement === "point" && !definition.aliasOf)
        .map(([id, definition]) => [id, definition])
);

/* Tools drawn from a first point to a second, at any angle. */
export const DYNAMICS_SPAN_TOOLS = Object.fromEntries(
    Object.entries(DYNAMICS_CHILD_TOOLS)
        .filter(([, definition]) => definition.placement === "span")
        .map(([id, definition]) => [id, definition.label])
);

/* Tools drawn from a centre outwards. */
export const DYNAMICS_ANGLE_TOOLS = Object.fromEntries(
    Object.entries(DYNAMICS_CHILD_TOOLS)
        .filter(([, definition]) => definition.placement === "angle")
        .map(([id, definition]) => [id, definition.label])
);

/* Tools drawn from one corner of a box to the opposite one. */
export const DYNAMICS_BOX_TOOLS = Object.fromEntries(
    Object.entries(DYNAMICS_CHILD_TOOLS)
        .filter(([, definition]) => definition.placement === "box")
        .map(([id, definition]) => [id, definition.label])
);

/* ============================================================
 * INSTRUCTIONS
 * ============================================================ */

export function dynamicsInstruction(toolId) {
    const definition = DYNAMICS_CHILD_TOOLS[toolId];

    if (!definition) {
        return "Ready";
    }

    /*
     * THE WORDING BELONGS TO THE GESTURE, not to a list of tool names.
     *
     * `placement` is the statement of how the tool takes its points, so the
     * sentence is built from it and a tool added later is described correctly
     * the day it is declared. The older version interpolated the label into a
     * generic sentence - "Press and drag from the first end spring" - which
     * read as a mistake rather than as an instruction.
     */
    return {
        point: `Click to place the ${definition.label.toLowerCase()}`,
        span: `Press and drag to draw the ${definition.label.toLowerCase()}`,
        box: `Press and drag to size the ${definition.label.toLowerCase()}`,
        angle: `Press at the centre and drag outwards to draw the ${definition.label.toLowerCase()}`
    }[definition.placement] || `Select the ${definition.label}`;
}

/* ============================================================
 * THE SUBMENU
 * ============================================================
 *
 * The same shared submenu Statics uses - same element, same positioning,
 * same click-outside dismissal - so a Dynamics family opens exactly as a
 * Statics one does. Choosing an item arms the tool through the normal
 * activation path, so its instruction line, its render and its toolbar
 * highlight are the ones every other tool gets.
 *
 * `onActivate` IS INJECTED, NOT IMPORTED.
 *
 * `activateTool` lives in the toolbar, and the toolbar imports this module
 * for the families it lists. Importing it back would close a cycle round the
 * whole toolbar - tools.js -> this file -> tool-activation -> toolbar-render
 * -> tools.js - and the binding it needed would still be uninitialised when
 * the module body ran, which threw on load and took every Dynamics tool with
 * it. So the caller hands its own activation function in, which is also the
 * honest description: this module knows which tools exist, the toolbar knows
 * how to arm them.
 */
export function openDynamicsMenu(button, familyId, { onActivate, onMessage } = {}) {
    const items = DYNAMICS_TOOL_MENUS[familyId];

    if (!items) {
        return;
    }

    openToolSubmenu(button, items, childId => {
        if (typeof onActivate === "function") {
            onActivate(childId);
        }

        if (typeof onMessage === "function") {
            onMessage(childId);
        }
    });
}

/* ============================================================
 * CREATION HELPERS
 * ============================================================ */

/*
 * The style a new Dynamics object starts with. It is the sheet's own
 * defaults plus the two things that make these symbols readable at a normal
 * zoom: a line weight that reads as a drawn symbol, and no fill unless the
 * tool wants one. Nothing here is a per-tool implementation - a tool that
 * needs a different start edits the object after it is built.
 */
export function dynamicsCreationStyle() {
    return {
        ...drawingState.styleDefaults
    };
}

/*
 * The engineering metadata of a new Dynamics object. `dynamicsType` is the
 * tool id, so the object says which tool made it for as long as it lives -
 * through moves, edits, saves and reloads.
 */
export function dynamicsEngineering(toolId) {
    return {
        plane: "XY",
        discipline: "dynamics",
        dynamicsType: toolId
    };
}

/* The display name of a new object, so the inventory names it for what it is. */
export function dynamicsObjectName(toolId) {
    return DYNAMICS_CHILD_TOOLS[toolId]?.label || "Dynamics Object";
}

/*
 * A midpoint, for the symbols that are defined between two terminals but
 * draw something in the middle of them (a label's default place, a damper's
 * body).
 */
export function midpointBetween(start, end) {
    return {
        x: (Number(start?.x) + Number(end?.x)) / 2 || 0,
        y: (Number(start?.y) + Number(end?.y)) / 2 || 0
    };
}

/* The default display sizes, in drawing units (one unit is one paper mm). */
export const DYNAMICS_SIZES = Object.freeze({
    particleRadius: 1.6,
    bodyWidth: 24,
    bodyHeight: 14,
    trajectoryBow: 0.22,
    springCoils: 6,
    springAmplitude: 4,
    springLead: 0.18,
    damperBody: 0.42,
    damperBodyWidth: 6,
    damperRod: 1.2,
    branchSpacing: 7,
    pulleyRadius: 8,
    pulleyRopeGap: 7,
    pulleyRopeDrop: 18,
    referenceArcSweepDegrees: 90
});

export default {
    DYNAMICS_TOOL_GROUPS,
    DYNAMICS_COLLAPSIBLE_CATEGORIES,
    DYNAMICS_TOOL_MENUS,
    DYNAMICS_CHILD_TOOLS,
    DYNAMICS_PLACEMENT_TOOLS,
    DYNAMICS_SPAN_TOOLS,
    DYNAMICS_ANGLE_TOOLS,
    DYNAMICS_BOX_TOOLS,
    DYNAMICS_OWN_TYPES,
    DYNAMICS_SIZES,
    isDynamicsObject,
    isDynamicsTool,
    dynamicsTypeOf,
    dynamicsToolDefinition,
    resolveDynamicsToolId,
    dynamicsInstruction,
    dynamicsCreationStyle,
    dynamicsEngineering,
    dynamicsObjectName,
    midpointBetween,
    openDynamicsMenu
};
