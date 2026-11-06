/*
 * ============================================================
 * THE DYNAMICS SIDEBAR HIERARCHY
 * ============================================================
 *
 * The arrangement the Dynamics section SHOWS, declared once:
 *
 *     Selection   Select
 *     Create      Bodies / Kinematics / Mechanical Elements  (collapsible)
 *     Reference   Coordinate System, Reference Point, Line, Arc
 *
 * THIS MODULE IMPORTS NOTHING, AND THAT IS THE POINT.
 *
 * It used to live beside the tool definitions in `dynamics-tools.js`, and the
 * sidebar has to read it: `tools.js` imports the section's groups so the
 * discipline map knows what Dynamics contains. But `dynamics-tools.js` also
 * reaches the drawing model through the toolbar, and the drawing model reaches
 * the toolbar back - so the group list was asked for before it had been
 * initialised and the whole module failed to load with "Cannot access
 * 'DYNAMICS_TOOL_GROUPS' before initialization". Every Dynamics tool went with
 * it.
 *
 * Split into a leaf module, the sidebar's copy of the hierarchy depends on
 * nothing, so it cannot be part of a cycle. The tool definitions import it
 * from here rather than declaring a second copy, so the section the student
 * sees and the tools that exist still come from one list.
 *
 * The three Create entries carry `submenu: true` to indicate that they have
 * child tools, and `collapsible: true` so the toolbar renders those children
 * IN PLACE as an indented tree rather than as a floating menu.
 *
 * There is no Analysis section, no Joints and no Contact - the library is
 * exactly what this list says it is. There is exactly one Pulley.
 */

export const DYNAMICS_TOOL_GROUPS = [
    {
        id: "dynamics-selection",
        label: "Selection",
        tools: [{ id: "select", label: "Select", shortcut: "Esc" }]
    },
    {
        id: "dynamics-create",
        label: "Create",
        tools: [
            {
                id: "dynamics-bodies",
                label: "Bodies",
                submenu: true,
                collapsible: true
            },
            {
                id: "dynamics-kinematics",
                label: "Kinematics",
                submenu: true,
                collapsible: true
            },
            {
                id: "dynamics-mechanical",
                label: "Mechanical Elements",
                submenu: true,
                collapsible: true
            }
        ]
    },
    {
        id: "dynamics-reference",
        label: "Reference",
        tools: [
            { id: "dynamics-coordinate-system", label: "Coordinate System" },
            { id: "dynamics-reference-point", label: "Reference Point" },
            { id: "dynamics-reference-line", label: "Reference Line" },
            { id: "dynamics-reference-arc", label: "Reference Arc" }
        ]
    }
];

/* The Create categories that expand in place, by id. */
export const DYNAMICS_COLLAPSIBLE_CATEGORIES = Object.fromEntries(
    DYNAMICS_TOOL_GROUPS.flatMap((group) => group.tools)
        .filter((tool) => tool.collapsible === true)
        .map((tool) => [tool.id, tool.label])
);

/*
 * THE SYMBOLS THAT ARE DRAWN FROM THEIR OWN GEOMETRY.
 *
 * Every other Dynamics tool reuses an ordinary stored type - a Reference Line
 * is a `line`, a Reference Point is a `point` - and is drawn, moved, rotated
 * and written by the layer that already owns that type. These six are their
 * own kind of object, so the shared geometry registry needs to know which
 * types it must read the anchor fields of.
 *
 * DECLARED HERE, AND THAT IS DELIBERATE. The registry sits underneath
 * `drawing-state`, which sits underneath `editor-state`, which sits underneath
 * the Dynamics tool definitions - so importing the definitions from the
 * registry would close a cycle and throw on load. A leaf list of type names
 * depends on nothing, so the registry can read it safely; `dynamics-tools.js`
 * re-exports it, so there is still one statement of what these are.
 */
export const DYNAMICS_OWN_TYPES = new Set([
    "dynamics-polar-vector",
    "dynamics-angular-vector",
    "dynamics-spring",
    "dynamics-damper",
    "dynamics-spring-damper",
    "dynamics-pulley"
]);

export default {
    DYNAMICS_TOOL_GROUPS,
    DYNAMICS_COLLAPSIBLE_CATEGORIES,
    DYNAMICS_OWN_TYPES
};
