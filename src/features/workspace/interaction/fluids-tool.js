/*
 * ========================================================
 * THE FLUIDS TOOL LAYER
 * ========================================================
 *
 * The Fluids section's tools are not a second drawing system. Each one is
 * bound to an EXISTING DAETUM system through its entry in
 * `features/fluids/fluids-tools.js`, and this module is the ONE place that
 * turns that binding into an action. It answers three questions and does
 * nothing else:
 *
 *     activateFluidsTool(toolId)      start the tool the entry names
 *     fluidsInstruction(toolId)       what to tell the student to do next
 *     isFluidsTool(toolId)            is this one of ours (re-exported)
 *
 * WHY IT LIVES IN editor/ AND NOT IN features/
 * --------------------------------------------
 * `features/` is the engineering and holds no interaction; `editor/` is the
 * interaction layer. The REGISTRY (what the tools are) is engineering and
 * lives in `features/fluids/`; the ACTIVATION (what pressing one does) is
 * interaction and lives here. That is the same split Statics has between
 * `statics-tools.js` (the tables) and `statics-creation.js` (the behaviour).
 *
 * ========================================================
 * WHAT "REUSE" MEANS FOR EACH CAPABILITY
 * ========================================================
 *
 *   select     the ordinary Select tool - nothing to activate
 *   shape      the ORDINARY GEOMETRY TOOL the entry names (`line`,
 *              `rectangle`, `point`). Activating a Pipe / Duct therefore
 *              arms the shared Line tool, so the drawing, snapping, preview,
 *              commit, selection, movement, undo and save are all the Line's
 *              own - there is no second creation pipeline to keep in step.
 *   dimension  the shared Smart Dimension engine, so a Pressure Tap picks its
 *              references and places its measurement exactly as a Dimension
 *              does.
 *   annotate   the Annotate feature model, so a Flow Arrow IS the `arrow`
 *              kind and a Fluid Property Label IS the `note` kind.
 *   planned    nothing yet. The tool is registered and listed; activation
 *              says so plainly rather than arming a button that does nothing.
 *
 * THE SHAPE CASE IS THE ONE WORTH STATING OUT LOUD: a Fluids shape tool
 * activates its PRIMITIVE. The toolbar still shows the Fluids button as the
 * one that is active - `tool-menus.js → renderToolButton` asks this module -
 * so the student sees "Pipe / Duct" highlighted while the shared Line tool
 * does the drawing. When a Pipe earns its own feature type and its own
 * engineering behaviour, it stops naming a primitive and this branch stops
 * being reached for it; nothing else in the section moves.
 */
import enggFluidsTools from "../model/fluids/fluids-tools.js";

export const { FLUIDS_CAPABILITIES } = enggFluidsTools;

/*
 * Is this a Fluids tool?
 *
 * Re-exported rather than re-implemented, so a caller in the editor layer
 * does not have to reach into features/ for the question.
 */
export function isFluidsTool(toolId) {
	return enggFluidsTools.isFluidsTool(toolId);
}

/*
 * The tool that ACTUALLY runs when a Fluids entry is chosen.
 *
 * For a shape entry this is its primitive (`line`, `rectangle`, `point`); for
 * every other capability it is the entry's own id, because the entry IS the
 * tool the shared system already understands - a Fluids annotate tool is
 * routed to the Annotate handler by its own id, and a Fluids dimension tool to
 * the dimension handler. So this returns the id to ARM, and it is the ONE
 * place that decision is made.
 */
export function fluidsArmedTool(toolId) {
	return enggFluidsTools.fluidsGeometryTool(toolId) || toolId;
}

/*
 * The instruction a Fluids tool opens with.
 *
 * Written for the person using it, in the same voice as every other tool's
 * opening line. A shape entry borrows its primitive's wording - a Pipe / Duct
 * asks for a start point because that is what it needs - while an annotate or
 * dimension entry names what it is about to place, so the bottom bar says what
 * the student is doing rather than repeating a generic phrase.
 *
 * `planned` is the honest case: the tool is on the toolbar and is not built
 * yet, and it says exactly that.
 */
export function fluidsInstruction(toolId) {
	const tool = enggFluidsTools.FLUIDS_TOOLS[toolId];

	if (!tool) {
		return "Ready";
	}

	if (enggFluidsTools.isPlannedFluidsTool(toolId)) {
		return `${tool.label} is not available yet`;
	}

	/*
	 * A ROUTE TOOL ASKS FOR ITS FIRST POINT. The route's own tool module owns
	 * the wording from the second point onward (it counts the vertices), so
	 * this only names the opening step.
	 */
	if (tool.capability === FLUIDS_CAPABILITIES.ROUTE) {
		return toolId === "elbow"
			? "Press and drag to draw an Elbow between two ends"
			: "Specify route start point";
	}

	if (tool.capability === FLUIDS_CAPABILITIES.SHAPE) {
		return (
			{
				point: `Specify ${tool.label} location`,
				line: `Specify ${tool.label} start point`,
				rectangle: `Specify ${tool.label} first corner`,
				circle: `Specify ${tool.label} centre point`
			}[tool.geometryTool] || `Specify ${tool.label} location`
		);
	}

	if (tool.capability === FLUIDS_CAPABILITIES.DIMENSION) {
		/* The measurement engine's own opening line, so the two agree. */
		return "Specify dimension reference";
	}

	if (tool.capability === FLUIDS_CAPABILITIES.ANNOTATE) {
		return (
			{
				arrow: `Specify ${tool.label} start point`,
				label: `Click the feature to mark with ${tool.label}`,
				note: `Specify ${tool.label} location`,
				leader: `Specify the point ${tool.label} marks`
			}[tool.annotateKind] || `Specify ${tool.label} location`
		);
	}

	return "Ready";
}

/*
 * Whether the ACTIVE tool is the one a given Fluids button stands for.
 *
 * A Fluids shape button arms its PRIMITIVE (`line`, `rectangle`, `point`), and
 * SEVERAL Fluids tools may share one primitive - Pump, Valve and Flow Meter all
 * place a Point. So the primitive alone cannot say WHICH button was pressed:
 * comparing primitives would light up all three at once, and the student would
 * see a Junction highlighted after pressing a Pump.
 *
 * The pressed Fluids id is therefore recorded on the interaction when the tool
 * is armed, and the highlight is decided from THAT. The primitive still says
 * which shared tool is running; the recorded id says which Fluids button asked
 * for it.
 *
 * `fluidsTool` is read from the live drawing state by the caller, so this
 * module stays free of editor state.
 */
export function isFluidsToolActive(toolId, activeTool, fluidsTool) {
	if (fluidsTool) {
		return fluidsTool === toolId;
	}

	return toolId === activeTool;
}

const enggFluidsTool = {
	FLUIDS_CAPABILITIES,
	isFluidsTool,
	fluidsArmedTool,
	fluidsInstruction,
	isFluidsToolActive
};
export default enggFluidsTool;