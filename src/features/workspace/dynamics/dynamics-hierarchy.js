/*
 * ============================================================
 * THE DYNAMICS SIDEBAR HIERARCHY
 * ============================================================
 *
 * The arrangement the Dynamics section SHOWS, declared once:
 *
 *     Selection   Select
 *     Create      Bodies / Motion                             (collapsible)
 *     Analysis    Velocity Diagram, Acceleration Diagram
 *     Reference   Coordinate System, Reference Point, Line, Arc
 *
 * IT IS THE STATICS SHAPE, SECTION FOR SECTION.
 *
 * Dynamics is another engineering discipline in the same application, not a
 * second product, so it is organised exactly the way Statics is: four
 * headings, in the order Selection, Create, Analysis, Reference, with the
 * shared Select tool offered first and the shared Reference tools offered
 * last. The headings, the tool order, the icons and the styling all come from
 * the SHARED toolbar - the same `renderToolButton`, the same
 * `drawing-tool-group`, the same submenu - so there is no Dynamics-specific
 * toolbar to drift out of step.
 *
 * THE CREATE SECTION HAS TWO GROUPS, AND ONLY TWO.
 *
 *     Bodies   what is being studied
 *     Motion   how it is moving
 *
 * A body and a motion are different KINDS of thing, which is the same reason
 * Statics keeps Bodies and Supports apart rather than listing every tool flat.
 * The older Kinematics and Mechanical Elements headings are gone: Particle,
 * Rigid Body, Link / Rod and Pulley are bodies, and the six motion tools are
 * the quantities drawn on them.
 *
 * ============================================================
 * WHAT IS BUILT, AND WHAT IS ONLY PLACED
 * ============================================================
 *
 * This is the ORGANISATION task: the sections, the groups, the tool names,
 * the icons and the order are settled here, before the individual tools are
 * built one at a time.
 *
 * A tool with no drawing behaviour yet carries `planned: true`. It is a real
 * entry in its real group, it keeps its icon and its place, and pressing it
 * says plainly that it is not available yet - it never draws something it was
 * not built to draw, and it is never presented as finished. That is the
 * application's existing convention (see `phase-reset.js` and the Fluids
 * `planned` capability), reused rather than reinvented.
 *
 * Select and the four Reference tools are SHARED tools. They are not
 * re-implemented for Dynamics: Select activates the ordinary Select, and the
 * Reference entries activate the same point, line and arc machinery Statics
 * uses, distinguished only by the Dynamics mark they put on the feature.
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
 * The two Create entries carry `submenu: true`, which is the SAME flag a
 * Statics Bodies or Supports entry carries - so they open the shared submenu
 * through the shared click handler, and no Dynamics branch has to be written
 * into the toolbar. `collapsible: true` marks them as the categories that also
 * expand IN PLACE, exactly as Statics' Bodies, Loads and Supports do.
 *
 * There is no Joints and no Contact - the library is exactly what this list
 * says it is. There is exactly one Pulley, and it lives in Bodies because a
 * pulley is a body whose motion the drawing shows.
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
            /*
             * BODIES - the things a Dynamics figure is about.
             *
             * Bodies opens the shared submenu, exactly as Statics' Bodies
             * does: it is a family of genuinely different drawings, so
             * choosing between them is a real step. Link / Rod and the Pulley
             * are new entries here - Link / Rod has no behaviour yet, so it
             * is marked planned and activated honestly.
             */
            {
                id: "dynamics-bodies",
                label: "Bodies",
                submenu: true,
                collapsible: true,
                children: [
                    { id: "dynamics-particle", label: "Particle" },
                    { id: "dynamics-rigid-body", label: "Rigid Body" },
                    { id: "dynamics-link-rod", label: "Link / Rod", planned: true },
                    { id: "dynamics-pulley", label: "Pulley" }
                ]
            },

            /*
             * MOTION - the quantities drawn on those bodies.
             *
             * Six entries in the order the specification gives them. Each is
             * a DRAWING tool: it puts a labelled vector or displacement on the
             * sheet. None solves for a value, and none is built yet, so every
             * one is planned.
             */
            {
                id: "dynamics-motion",
                label: "Motion",
                submenu: true,
                collapsible: true,
                children: [
                    { id: "dynamics-position-vector", label: "Position Vector", planned: true },
                    { id: "dynamics-displacement", label: "Displacement", planned: true },
                    { id: "dynamics-velocity", label: "Velocity", planned: true },
                    { id: "dynamics-acceleration", label: "Acceleration", planned: true },
                    { id: "dynamics-angular-velocity", label: "Angular Velocity", planned: true },
                    { id: "dynamics-angular-acceleration", label: "Angular Acceleration", planned: true }
                ]
            }
        ]
    },
    {
        id: "dynamics-analysis",
        label: "Analysis",

        /*
         * ANALYSIS IS DIAGRAM DOCUMENTATION, NOT A SOLVER.
         *
         * A Velocity Diagram and an Acceleration Diagram are things the
         * student DRAWS, in the same sense as a Shear Force Diagram in
         * Statics: the toolbar offers a frame to draw the reasoning inside.
         * Nothing here computes a velocity, a magnitude or an angle, and
         * nothing reports a solution.
         *
         * Both are planned. Their inclusion says where they live; it does not
         * authorise solving, and it does not pretend they are finished.
         */
        tools: [
            { id: "dynamics-velocity-diagram", label: "Velocity Diagram", planned: true },
            { id: "dynamics-acceleration-diagram", label: "Acceleration Diagram", planned: true }
        ]
    },
    {
        id: "dynamics-reference",
        label: "Reference",

        /*
         * THE SHARED REFERENCE TOOLS, with the shared ids.
         *
         * These are the same four tools Statics offers, in the same four
         * places, activated through the same code paths - `coordinate-system`
         * opens the shared 2D/3D menu, and `reference-point`,
         * `reference-line` and `reference-arc` arm the shared point, line and
         * arc construction. There is no Dynamics copy of them to keep in step,
         * and none is created here.
         */
        tools: [
            { id: "coordinate-system", label: "Coordinate System" },
            { id: "reference-point", label: "Reference Point" },
            { id: "reference-line", label: "Reference Line" },
            { id: "reference-arc", label: "Reference Arc", submenu: true }
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
 * The planned entries, keyed by id, so activation can ask one question:
 * "does this tool have behaviour yet?"
 *
 * Derived from the groups rather than written out again, so an entry cannot
 * be listed without its state, and a tool that gains behaviour stops being
 * planned the moment its flag comes off.
 */
export const DYNAMICS_PLANNED_TOOLS = Object.freeze(
    Object.fromEntries(
        DYNAMICS_TOOL_GROUPS
            .flatMap((group) => group.tools)
            .flatMap((tool) => (tool.children ? tool.children : [tool]))
            .filter((tool) => tool.planned === true)
            .map((tool) => [tool.id, tool.label])
    )
);

/*
 * THE SYMBOLS THAT ARE DRAWN FROM THEIR OWN GEOMETRY.
 *
 * Every other Dynamics tool reuses an ordinary stored type - a Reference Line
 * is a `line`, a Reference Point is a `point` - and is drawn, moved, rotated
 * and written by the layer that already owns that type. These seven are their
 * own kind of object, so the shared geometry registry needs to know which
 * types it must read the anchor fields of. (The Kinematics, Viscous Damper
 * and Spring–Damper types stay listed because drawings made with them still
 * load, render and compile, even though the tools that made them are no
 * longer in the section.)
 *
 * DECLARED HERE, AND THAT IS DELIBERATE. The registry sits underneath
 * `drawing-state`, which sits underneath `editor-state`, which sits underneath
 * the Dynamics tool definitions - so importing the definitions from the
 * registry would close a cycle and throw on load. A leaf list of type names
 * depends on nothing, so the registry can read it safely; `dynamics-tools.js`
 * re-exports it, so there is still one statement of what these are.
 */
export const DYNAMICS_OWN_TYPES = new Set([
    "dynamics-trajectory",
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
    DYNAMICS_PLANNED_TOOLS,
    DYNAMICS_OWN_TYPES
};
