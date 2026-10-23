/*
 * ========================================================
 * FLUIDS: THE TOOLSET
 * ========================================================
 *
 * The Fluids section is organised EXACTLY the way Statics is: the same FOUR
 * category headings, each with its commands listed DIRECTLY underneath.
 *
 *     SELECTION            the shared selection system, offered first
 *     CREATE               the flow paths, the fittings and the equipment
 *     ANALYSIS             the two diagrams the student draws
 *     REFERENCE            the shared reference geometry
 *
 * THE FOUR SECTIONS ARE INDEPENDENT, AND STAY THAT WAY.
 *
 * Analysis and Reference are SECTIONS OF THEIR OWN at the top level - they are
 * not headings buried inside Create. A student who has learned where a Statics
 * tool lives should find the Fluids map already familiar.
 *
 * CREATE HAS TWO DROPDOWNS, AND NOTHING ELSE HIDDEN.
 *
 * Flow Paths and Flow Indicators open the SAME shared submenu a Statics
 * Bodies / Loads / Supports entry opens (`submenu: true`), so the caret, the
 * popup, the positioning, the click-outside dismissal and the keyboard
 * handling are the shared ones and not a second implementation. Everything
 * else under Create - Reducer / Expander, Reservoir / Tank, Pump, Valve and
 * Flow Meter - is an INDIVIDUAL TOOL listed directly under the heading. There
 * is no Equipment dropdown and no Fluid Annotations group: a tool behind a
 * menu has to be gone looking for, and one that stands on its own does not.
 *
 * ========================================================
 * WHAT THIS RELEASE ESTABLISHES, AND WHAT IT DELIBERATELY DOES NOT
 * ========================================================
 *
 * This is the STRUCTURE release. It establishes the four sections, the
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
 *     â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€    â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
 * THE FOUR SECTIONS AND THEIR ENTRIES
 * ========================================================
 *
 * Fluids is laid out the way Statics is: the SAME FOUR SECTIONS, in the SAME
 * ORDER - Selection, Create, Analysis, Reference. A student who has learned
 * where a Statics tool lives already knows where to look here, and the two
 * sections sit side by side in the toolset bar, so a different arrangement
 * would be a second map of the same building.
 *
 * CREATE IS A MIX OF GROUPS AND DIRECT TOOLS, exactly as the Statics Create
 * section is. A group entry carries `submenu: true` - the same flag a Statics
 * Bodies or Loads entry carries - and expands IN PLACE underneath its own
 * button, inside the sidebar, through the toolbar's existing inline-section
 * mechanism. It opens no popup. Every entry without the flag arms immediately.
 * The CONTENTS of a group live in `FLUIDS_TOOL_MENUS` below, one list per
 * parent, so the button and the tools it reveals cannot disagree.
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
	/*
	 * SELECTION IS THE SHARED SELECT.
	 *
	 * `select` is the universal DAETUM tool - the same id Statics, Dynamics and
	 * Annotate arm - so this section is a second DOOR to it, not a second copy.
	 * It is listed here so the section reads like every other discipline's.
	 */
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
	 * CREATE: TWO EXPANDABLE GROUPS AND FIVE INDIVIDUAL TOOLS.
	 *
	 * Flow Paths is the pipework itself and Flow Indicators is how the flow is
	 * SHOWN; both expand inline, and both come FIRST - the two groups head the
	 * section, then the individual equipment tools. Reducer / Expander,
	 * Reservoir / Tank, Pump, Valve and Flow Meter sit directly under Create as
	 * tools of their own.
	 */
	{
		id: "fluids-create",
		label: "Create",
		tools: [
			/*
			 * FLOW PATHS: an expandable group, because its three entries are the
			 * parts of one run - the straight length, the turn and the tee.
			 * `submenu: true` is the flag Statics' Bodies and Loads carry, so it
			 * expands in place through the shared inline mechanism and needs no
			 * Fluids-specific branch of its own.
			 */
			{ id: "fluids-flow-paths", label: "Flow Paths", submenu: true },

			/*
			 * FLOW INDICATORS: the second group, immediately after the first. How
			 * the flow is SHOWN belongs with the run it is shown on, not at the
			 * end of a list of equipment.
			 */
			{ id: "fluids-flow-indicators", label: "Flow Indicators", submenu: true },

			/*
			 * THE INDIVIDUAL TOOLS OF CREATE. Each stands directly under the
			 * heading and arms on the press - there is no Equipment dropdown
			 * between the student and a Pump.
			 */
			{ id: "reducer-expander", label: "Reducer / Expander", capability: FLUIDS_CAPABILITIES.PLANNED },
			{ id: "reservoir-tank", label: "Reservoir / Tank", capability: FLUIDS_CAPABILITIES.PLANNED },
			{ id: "pump", label: "Pump", capability: FLUIDS_CAPABILITIES.PLANNED },
			{ id: "valve", label: "Valve", capability: FLUIDS_CAPABILITIES.PLANNED },
			{ id: "flow-meter", label: "Flow Meter", capability: FLUIDS_CAPABILITIES.PLANNED }
		]
	},

	/*
	 * ANALYSIS: TWO DIAGRAMS, AND NOT A SOLVER.
	 *
	 * Both are DRAWING tools: the student places a diagram and draws it
	 * themselves, exactly as they place a Shear Force Diagram in Statics. Neither
	 * reads the drawing and reports a result, and neither will: a flow direction
	 * diagram and a pressure profile are the student's own reasoning, drawn.
	 */
	{
		id: "fluids-analysis",
		label: "Analysis",
		tools: [
			{ id: "flow-direction-diagram", label: "Flow Direction Diagram", capability: FLUIDS_CAPABILITIES.PLANNED },
			{ id: "pressure-profile", label: "Pressure Profile", capability: FLUIDS_CAPABILITIES.PLANNED }
		]
	},

	/*
	 * REFERENCE: THE SHARED REFERENCE TOOLS, PLUS ONE FLUIDS-SPECIFIC ONE.
	 *
	 * Coordinate System, Reference Point and Reference Line are the SAME ids
	 * Statics lists, so they arm the same tools - reference geometry is
	 * reference geometry, whichever discipline asked for it. They therefore keep
	 * their normal `shape` entries: marking a working tool `planned` would make
	 * its button say "not available yet" about a tool that is.
	 *
	 * Section Plane is the one Fluids needs that the shared set does not have:
	 * a cutting plane drawn through a run, which is how a section is marked. It
	 * is planned, because its construction is not built yet.
	 */
	{
		id: "fluids-reference",
		label: "Reference",
		tools: [
			{ id: "coordinate-system", label: "Coordinate System", capability: FLUIDS_CAPABILITIES.SHAPE, geometryTool: "point" },
			{ id: "reference-point", label: "Reference Point", capability: FLUIDS_CAPABILITIES.SHAPE, geometryTool: "point" },
			{ id: "reference-line", label: "Reference Line", capability: FLUIDS_CAPABILITIES.SHAPE, geometryTool: "line" },
			{ id: "section-plane", label: "Section Plane", capability: FLUIDS_CAPABILITIES.PLANNED }
		]
	}
];

/*
 * ========================================================
 * THE GROUP CONTENTS
 * ========================================================
 *
 * One list per `submenu: true` entry above, keyed by that entry's id. This is
 * the SAME shape as `STATICS_TOOL_MENUS`, so the toolbar renders it with the
 * SAME inline subsection - the tools open underneath the heading, in the
 * sidebar - and a tool arms through the normal activation path.
 *
 * THE PARENT IS NOT A TOOL. Pressing Flow Paths or Flow Indicators expands or
 * collapses the group and creates nothing; the child is what arms. The
 * children are declared HERE, once, and the flat registry below is built from
 * this table - so the tools the sidebar shows and the registry the activation
 * layer reads are the same statement of fact.
 *
 * The contents are exactly the requirement's:
 *
 *     Flow Paths       Pipe / Duct, Elbow, Junction
 *     Flow Indicators  Flow Arrow, Fluid Level, Pressure Tap
 *
 * Pipe Diameter is deliberately absent: it is a measurement, not one of the
 * three indicators the requirement names.
 */
export const FLUIDS_TOOL_MENUS = {
	"fluids-flow-paths": [
		/*
		 * PIPE / DUCT IS IMPLEMENTED. It travels the FLUIDS `route` capability:
		 * `activateTool` arms the route session in `pipe-duct-tool.js`, which owns
		 * the press-drag-release gesture, the run feature, the elbow generated at a
		 * supported corner and the TikZ each of them writes. It is deliberately
		 * NOT `planned` - that state refuses activation before arming, which is
		 * exactly the "not available yet" the tool used to report.
		 */
		{ id: "pipe-duct", label: "Pipe / Duct", capability: FLUIDS_CAPABILITIES.ROUTE },
		/*
		 * ELBOW IS IMPLEMENTED TOO. It travels the same `route` capability as
		 * Pipe / Duct, because it is drawn with the same press-drag-release
		 * gesture and commits its own one-object fitting (see
		 * `pipe-duct-tool.js` -> `commitElbowGesture`). The two share the
		 * connection record, so an elbow drawn by hand and one generated at a
		 * corner are the same feature type with the same lifecycle.
		 */
		{ id: "elbow", label: "Elbow", capability: FLUIDS_CAPABILITIES.ROUTE },
		{ id: "junction", label: "Junction", capability: FLUIDS_CAPABILITIES.PLANNED }
	],

	"fluids-flow-indicators": [
		{ id: "flow-arrow", label: "Flow Arrow", capability: FLUIDS_CAPABILITIES.PLANNED },
		{ id: "fluid-level", label: "Fluid Level", capability: FLUIDS_CAPABILITIES.PLANNED },
		{ id: "pressure-tap", label: "Pressure Tap", capability: FLUIDS_CAPABILITIES.PLANNED }
	]
};

/*
 * ========================================================
 * THE FLAT REGISTRY, DERIVED FROM THE GROUPS ABOVE
 * ========================================================
 *
 * One entry per tool, keyed by id, built FROM the groups and the menus rather
 * than written out a second time. Everything that needs to ask "what is this
 * Fluids tool?" asks here, so the toolbar, the activation layer and any future
 * behaviour module read the SAME table - a tool cannot be added to a dropdown
 * and forgotten by the layer that has to handle it.
 *
 * A submenu parent is NOT a tool and has no entry: a student clicking an Elbow
 * needs it in this table, and a student clicking Flow Paths is opening a menu.
 * Each tool records WHERE the student found it as its `group` - the dropdown's
 * label for a menu child, the section's label otherwise - so the status line
 * and the Features panel can name the place they looked.
 */
const toolsOfGroup = group =>
	(group.tools || []).flatMap(tool => {
		const children = tool.submenu ? FLUIDS_TOOL_MENUS[tool.id] : null;

		return children
			? children.map(child => [child.id, { ...child, group: tool.label }])
			: [[tool.id, { ...tool, group: group.label }]];
	});

export const FLUIDS_TOOLS = Object.freeze(
	Object.fromEntries(
		fluidsToolGroups.flatMap(toolsOfGroup)
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
	FLUIDS_TOOL_MENUS,
	FLUIDS_TOOLS,
	FLUIDS_TOOL_IDS,
	isFluidsTool,
	fluidsCapability,
	fluidsAnnotateKind,
	fluidsGeometryTool,
	isPlannedFluidsTool
};

export default enggFluidsTools;
