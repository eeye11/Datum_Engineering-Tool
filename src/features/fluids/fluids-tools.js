/*
 * ========================================================
 * FLUIDS: THE TOOLSET
 * ========================================================
 *
 * The Fluids section is organised EXACTLY the way Statics and Annotate are: a
 * short list of CATEGORY headings, each with its commands listed DIRECTLY
 * underneath. The three are deliberately the same shape, because a student who
 * has learned where a Statics tool lives should not have to learn a second
 * arrangement for a Fluids one.
 *
 *     SELECTION            the shared selection system, offered first
 *     FLOW PATHS           the pipework and the vessels it runs between
 *     EQUIPMENT            the machines on the line
 *     FLOW REPRESENTATION  how the flow is shown
 *     MEASUREMENTS         the quantities taken off the drawing
 *     FLUID ANNOTATIONS    the written labels a fluids drawing carries
 *
 * THERE IS NO SUB-CATEGORY LEVEL, AND THAT IS THE WHOLE POINT.
 *
 * A tool is a COMMAND. A command behind another command is a command the
 * student has to go looking for, so every entry below is visible and clickable
 * the moment Fluids is selected: no caret, no flyout, no hover menu. The
 * `submenu` flag is therefore absent from every entry - it is the flag
 * Geometry and Statics use for the tools that DO open a menu (Arc, Bodies,
 * Loads), and leaving it off is what makes each of these activate immediately.
 *
 * ========================================================
 * WHAT THIS RELEASE ESTABLISHES, AND WHAT IT DELIBERATELY DOES NOT
 * ========================================================
 *
 * This is the STRUCTURE release. It establishes the six subcategories, the
 * seventeen entries, the icons and the place each tool takes in the toolbar -
 * and it binds every entry to an EXISTING DAETUM system through the
 * `capability` field below. It does NOT implement per-tool engineering
 * behaviour: a Pipe is not yet a flow-analysis object, a Pump is not yet a
 * head-flow curve.
 *
 * THE `capability` FIELD IS THE MODULARITY.
 *
 * Each entry names the shared system it travels. Adding a real Fluid feature
 * later means giving its entry a capability of its own and implementing that
 * capability - NOT restructuring this section, and not editing the toolbar,
 * the icons or the categories. That is what "modular" means here: the section
 * is a registry of entries, and the behaviour behind an entry is one field.
 *
 *     capability     the shared system it uses                status
 *     ───────────    ──────────────────────────────────────   ─────────────────
 *     select         the ordinary selection system            working
 *     shape          the geometry creation pipeline           working
 *     dimension      the Smart Dimension engine               working
 *     annotate       the Annotate feature model               working
 *     planned        registered, behaviour not built yet      the honest fallback
 *
 * EVERY ENTRY IN THIS RELEASE TRAVELS A WORKING SYSTEM, so none of them is
 * `planned` today. The capability is kept because it is the state a NEW entry
 * starts in: a fluid-mechanics tool whose behaviour is not built is listed in
 * its subcategory, keeps its icon and its place, and says on activation that
 * it is not available yet - exactly as the 3D Coordinate System does on a 2D
 * canvas. It is never a button that silently does nothing, and it never
 * creates a feature it cannot describe.
 *
 * A `shape` ENTRY ALSO NAMES THE PRIMITIVE IT IS DRAWN WITH. A run of pipe
 * is drawn along a span and a tank is drawn as an area, so the entry carries a
 * `geometryTool` naming the ordinary geometry tool it reuses - `line`,
 * `rectangle`, `circle` or `point`. That is the reuse the requirement asks
 * for: a Fluids shape tool snaps, previews, commits, selects, moves, saves and
 * undoes through the SAME pipeline as a Line, because it IS drawn with the
 * Line's own tool. What makes it a Pipe rather than a Line - its own feature
 * type, its own panel, its own rendering - is the engineering behaviour this
 * release deliberately does not build, and it lands on this entry as one more
 * field when it does.
 *
 * BRANCHING.md's rule - "do not commit placeholder panels that imply unsupported
 * features work" - is kept: nothing below fabricates a feature type.
 */

/*
 * The capability ids, named once so the strings are not spelled out at each
 * entry. A capability is the INTERFACE between this registry and the shared
 * system behind it.
 */
export const FLUIDS_CAPABILITIES = Object.freeze({
	SELECT: "select",
	SHAPE: "shape",
	ROUTE: "route",
	DIMENSION: "dimension",
	ANNOTATE: "annotate",
	PLANNED: "planned"
});

/*
 * ========================================================
 * THE SIX SUBCATEGORIES AND THEIR SEVENTEEN ENTRIES
 * ========================================================
 *
 * The order of the categories is the order the requirement gives them, and the
 * order of the entries within each is the order the requirement lists them -
 * so the toolbar reads the way the specification does.
 *
 * EVERY ENTRY CARRIES FOUR THINGS AND NOTHING ELSE:
 *
 *     id            the tool id, used by the toolbar, activation and routing
 *     label         the student-facing name; the ICON is looked up by this
 *     capability    which shared system the tool travels (see above)
 *     geometryTool  only on a `shape` entry: the ordinary geometry tool it
 *                   draws with, so it travels the shared creation pipeline
 *     annotateKind  only on an `annotate` entry: which Annotate kind it makes
 *
 * A `planned` entry carries no extra field: there is nothing to configure
 * until its behaviour exists, and inventing one now would be a guess stored in
 * the wrong place.
 */
export const fluidsToolGroups = [
	{
		id: "fluids-selection",
		label: "Selection",
		tools: [
			{
				id: "select",
				label: "Select",
				shortcut: "Esc",
				capability: FLUIDS_CAPABILITIES.SELECT
			}
		]
	},

	/*
	 * ========================================================
	 * FLOW PATHS
	 * ========================================================
	 *
	 * The pipework itself and the vessels it runs between. A run of pipe, the
	 * bend that turns it, the point where two runs meet, the change of bore,
	 * and the tank it all ends in.
	 *
	 * These are SHAPE tools: they are drawn through the ordinary geometry
	 * creation pipeline, so they snap, preview, commit, select, move, save and
	 * undo exactly as a Line or a Rectangle does. Giving them real fluid
	 * behaviour later means implementing that capability against this entry,
	 * not re-drawing them.
	 */
	{
		id: "fluids-flow-paths",
		label: "Flow Paths",
		tools: [
			{ id: "pipe-duct", label: "Pipe / Duct", capability: FLUIDS_CAPABILITIES.ROUTE },
			{ id: "elbow", label: "Elbow", capability: FLUIDS_CAPABILITIES.SHAPE, geometryTool: "line" },
			{ id: "junction", label: "Junction", capability: FLUIDS_CAPABILITIES.SHAPE, geometryTool: "point" },
			{ id: "reducer-expander", label: "Reducer / Expander", capability: FLUIDS_CAPABILITIES.SHAPE, geometryTool: "line" },
			{ id: "reservoir-tank", label: "Reservoir / Tank", capability: FLUIDS_CAPABILITIES.SHAPE, geometryTool: "rectangle" }
		]
	},

	/*
	 * ========================================================
	 * EQUIPMENT
	 * ========================================================
	 *
	 * The machines on the line: the pump that drives it, the valve that
	 * controls it, the meter that reads it. Each is placed as a symbol on the
	 * drawing.
	 *
	 * A valve and a flow meter are genuinely a single point on a line, and a
	 * pump is a symbol too - so they are SHAPE tools placed through the shared
	 * pipeline, not a new placement system.
	 */
	{
		id: "fluids-equipment",
		label: "Equipment",
		tools: [
			{ id: "pump", label: "Pump", capability: FLUIDS_CAPABILITIES.SHAPE, geometryTool: "point" },
			{ id: "valve", label: "Valve", capability: FLUIDS_CAPABILITIES.SHAPE, geometryTool: "point" },
			{ id: "flow-meter", label: "Flow Meter", capability: FLUIDS_CAPABILITIES.SHAPE, geometryTool: "point" }
		]
	},

	/*
	 * ========================================================
	 * FLOW REPRESENTATION
	 * ========================================================
	 *
	 * HOW THE FLOW IS SHOWN rather than what it runs through.
	 *
	 * Both entries are Annotate features, not new types:
	 *     Flow Arrow   the existing `arrow` kind - a start and an end
	 *     Fluid Level  the existing `label` kind - a marker that attaches
	 *
	 * They are listed under Fluids because that is where a student looks for
	 * them, and they create the same features the Annotate section does, so
	 * selection, moving, the panel, undo and saving are already handled.
	 */
	{
		id: "fluids-flow-representation",
		label: "Flow Representation",
		tools: [
			{
				id: "flow-arrow",
				label: "Flow Arrow",
				capability: FLUIDS_CAPABILITIES.ANNOTATE,
				annotateKind: "arrow"
			},
			{
				id: "fluid-level",
				label: "Fluid Level",
				capability: FLUIDS_CAPABILITIES.ANNOTATE,
				annotateKind: "label"
			}
		]
	},

	/*
	 * ========================================================
	 * MEASUREMENTS
	 * ========================================================
	 *
	 * The quantities taken off a fluids drawing. Each is a measurement of
	 * something already drawn, which is exactly what the Smart Dimension
	 * engine does - it reads the geometry it is pointed at rather than storing
	 * a number that can go stale.
	 *
	 * They are DIMENSION tools, so they reuse the shared reference selection,
	 * inference, placement, panel and value editor. A Pressure Tap and a Pipe
	 * Diameter differ in WHAT they will read when their own behaviour is
	 * built; the machinery that reads a measurement is already here.
	 */
	{
		id: "fluids-measurements",
		label: "Measurements",
		tools: [
			{ id: "pressure-tap", label: "Pressure Tap", capability: FLUIDS_CAPABILITIES.DIMENSION },
			{ id: "pipe-diameter", label: "Pipe Diameter", capability: FLUIDS_CAPABILITIES.DIMENSION },
			{ id: "section-plane", label: "Section Plane", capability: FLUIDS_CAPABILITIES.DIMENSION }
		]
	},

	/*
	 * ========================================================
	 * FLUID ANNOTATIONS
	 * ========================================================
	 *
	 * The written labels a fluids drawing carries - a fluid's properties, the
	 * flow rate through a run, and the elevation of a point.
	 *
	 * All three are Annotate features:
	 *
	 *     Fluid Property Label   the `note` kind - free text about a fluid
	 *     Flow Rate Label        the `label` kind - a short identifier
	 *     Elevation Marker       the `leader` kind - a mark pointing at a level
	 *
	 * Reusing the Annotate kinds is the point: a Note, a Label and a Leader
	 * already select, move, edit, undo and save, so a Fluids label is the same
	 * thing with a different name on the toolbar. There is no second
	 * annotation system to keep in step.
	 */
	{
		id: "fluids-annotations",
		label: "Fluid Annotations",
		tools: [
			{
				id: "fluid-property-label",
				label: "Fluid Property Label",
				capability: FLUIDS_CAPABILITIES.ANNOTATE,
				annotateKind: "note"
			},
			{
				id: "flow-rate-label",
				label: "Flow Rate Label",
				capability: FLUIDS_CAPABILITIES.ANNOTATE,
				annotateKind: "label"
			},
			{
				id: "elevation-marker",
				label: "Elevation Marker",
				capability: FLUIDS_CAPABILITIES.ANNOTATE,
				annotateKind: "leader"
			}
		]
	}
];

/*
 * ========================================================
 * THE FLAT REGISTRY, DERIVED FROM THE GROUPS ABOVE
 * ========================================================
 *
 * One entry per tool, keyed by id, built FROM the groups rather than written
 * out a second time. Everything that needs to ask "what is this Fluids tool?"
 * asks here, so the toolbar, the activation layer and any future behaviour
 * module read the SAME table - a tool cannot be added to the toolbar and
 * forgotten by the layer that has to handle it.
 */
export const FLUIDS_TOOLS = Object.freeze(
	Object.fromEntries(
		fluidsToolGroups.flatMap(group =>
			group.tools.map(tool => [tool.id, { ...tool, group: group.label }])
		)
	)
);

/*
 * The tool ids in the order they are offered, for a caller that wants the
 * section as a list rather than as groups.
 */
export const FLUIDS_TOOL_IDS = Object.freeze(
	Object.keys(FLUIDS_TOOLS)
);

/*
 * ========================================================
 * WHAT A FLUIDS TOOL USES
 * ========================================================
 *
 * Three small readers, so a caller asks a QUESTION rather than testing the
 * registry's shape itself. Each is a one-line lookup today and a place to
 * grow a capability tomorrow.
 */
export function isFluidsTool(toolId) {
	return Boolean(FLUIDS_TOOLS[toolId]);
}

export function fluidsCapability(toolId) {
	return FLUIDS_TOOLS[toolId]?.capability || null;
}

/*
 * The Annotate kind a Fluids entry makes, or null when it makes none. The
 * Annotate layer asks this to find the kind behind a Fluids tool id, so the
 * Fluids toolset and the Annotate model cannot drift apart.
 */
export function fluidsAnnotateKind(toolId) {
	const tool = FLUIDS_TOOLS[toolId];

	return tool?.capability === FLUIDS_CAPABILITIES.ANNOTATE
		? tool.annotateKind || null
		: null;
}

/*
 * The ordinary geometry tool a Fluids shape entry draws with.
 *
 * Returns the tool id the shared creation pipeline already knows - `line`,
 * `rectangle`, `circle` or `point` - so a Fluids shape tool is drawn, snapped,
 * previewed, committed, selected, moved, saved and undone by the SAME code as
 * that geometry tool. A tool that is not a shape entry has no primitive and
 * answers null.
 */
export function fluidsGeometryTool(toolId) {
	const tool = FLUIDS_TOOLS[toolId];

	return tool?.capability === FLUIDS_CAPABILITIES.SHAPE
		? tool.geometryTool || null
		: null;
}

/*
 * Whether a Fluids tool is registered but its behaviour is not built yet.
 *
 * The activation layer asks this to decide between starting the tool and
 * saying plainly that it is not available, rather than leaving a button that
 * appears to do nothing.
 */
export function isPlannedFluidsTool(toolId) {
	return fluidsCapability(toolId) === FLUIDS_CAPABILITIES.PLANNED;
}

const enggFluidsTools = {
	FLUIDS_CAPABILITIES,
	fluidsToolGroups,
	FLUIDS_TOOLS,
	FLUIDS_TOOL_IDS,
	isFluidsTool,
	fluidsCapability,
	fluidsAnnotateKind,
	fluidsGeometryTool,
	isPlannedFluidsTool
};

export default enggFluidsTools;