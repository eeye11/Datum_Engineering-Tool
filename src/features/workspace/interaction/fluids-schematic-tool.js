/*
 * ========================================================
 * THE FLUIDS SCHEMATIC TOOLS' SESSIONS
 * ========================================================
 *
 * One module for every Fluids tool added after the flow paths, because they all
 * share ONE lifecycle - arm with an instruction, preview while the gesture runs,
 * commit one object per gesture, stay armed - and differ only in what they
 * create:
 *
 *   reducer-expander        click a Pipe / Duct (interior or end) to insert
 *   pump / valve / flow-meter
 *                           click a Pipe / Duct to insert, or empty space to place
 *   reservoir-tank          drag out a box
 *   fluid-level             click inside a vessel, at the cursor's height
 *   flow-direction-diagram  click a Pipe / Duct to add a direction arrow
 *   pressure-profile        drag out a graph frame
 *   section-plane           drag out a trace
 *
 * ========================================================
 * NOTHING IS WRITTEN UNTIL THE GESTURE ENDS
 * ========================================================
 *
 * A press arms a session; the drag publishes a PREVIEW on the interaction (so
 * the shared preview renderer draws it, and the document is untouched); the
 * release commits ONE undoable change. Escape clears the session, and because
 * nothing was written there is nothing to undo - no ghost geometry, no orphaned
 * connection.
 *
 * ========================================================
 * THE TOOL SETTINGS ARE DEFAULTS, NOT EDITS
 * ========================================================
 *
 * A mode, a transition length, a symbol size, a valve depiction or a vessel
 * style chosen before placing applies to what the gesture CREATES. Once the
 * object exists, it is edited through its own Features tab - there is no second
 * set of controls that could disagree with it.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggPipeDuct from "../model/fluids/pipe-duct.js";
import enggReducer from "../model/fluids/reducer-expander.js";
import enggEquipment from "../model/fluids/inline-equipment.js";
import enggVessel from "../model/fluids/reservoir-tank.js";
import enggFluidLevel from "../model/fluids/fluid-level.js";
import enggFlowArrows from "../model/fluids/flow-arrows.js";
import enggPressureProfile from "../model/fluids/pressure-profile.js";
import enggSectionPlane from "../model/fluids/section-plane.js";
import {
	INLINE_PHASE,
	findInsertionTarget,
	insertInline,
	insertStandalone,
	planInsertion,
	symbolPreviewFor
} from "./inline-insertion.js";
import { drawingState } from "../editor-state.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { renderFeatures } from "../../../components/layout/panels/features-editor.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";
import {
	DEFAULT_ARROW_LENGTH,
	DEFAULT_SYMBOL_RADIUS,
	DEFAULT_TRANSITION_LENGTH,
	DEFAULT_VESSEL_HEIGHT,
	DEFAULT_VESSEL_WIDTH,
	finitePoint
} from "../model/fluids/fluids-shared.js";

/* The interaction phases these tools use. */
export const VESSEL_PHASE = "vessel-construct";
export const LEVEL_PHASE = "fluid-level-construct";
export const DIRECTION_PHASE = "flow-direction-construct";
export const PROFILE_PHASE = "pressure-profile-construct";
export const SECTION_PHASE = "section-plane-construct";

/* ============================================================
 * ARMING
 * ============================================================ */

function arm(toolId, interaction = {}) {
	enggDrawingState.setActiveTool(drawingState, toolId);

	enggDrawingState.setInteraction(drawingState, {
		fluidsTool: toolId,
		phase: "idle",
		preview: null,
		...interaction
	});
}

function refresh() {
	renderFeatures();
	renderProperties();
	renderCurrentDrawing();
}

/*
 * THE INLINE TOOLS - the reducer and the three pieces of equipment.
 *
 * Arming records the tool's own DEFAULTS on the interaction, so the next commit
 * reads them: the reducer's mode and length, or a symbol's size and (for a
 * valve) its depiction. Changing them later in the Features tab edits the
 * OBJECT, which is a different thing from the tool's default.
 */
export function beginInlineToolSession(toolId) {
	const defaults =
		toolId === "reducer-expander"
			? {
					inlineMode: enggReducer.REDUCER_MODES.reduce,
					inlineTransitionLength: DEFAULT_TRANSITION_LENGTH
				}
			: {
					inlineSymbolSize: DEFAULT_SYMBOL_RADIUS,
					inlineDepiction: toolId === "valve" ? "generic" : undefined
				};

	arm(toolId, { phase: INLINE_PHASE, ...defaults });

	setToolMessage(
		toolId === "reducer-expander"
			? "Click a Pipe / Duct to insert the Reducer / Expander"
			: `Click a Pipe / Duct to insert the ${enggEquipment.EQUIPMENT_TYPE_LABELS[toolId]}, or an empty space to place it`
	);

	refresh();
}

export function beginVesselToolSession() {
	arm("reservoir-tank", { phase: VESSEL_PHASE, vesselStyle: enggVessel.VESSEL_STYLES.open });

	setToolMessage("Drag to draw the Reservoir / Tank");

	refresh();
}

export function beginFluidLevelToolSession() {
	arm("fluid-level", { phase: LEVEL_PHASE });

	setToolMessage("Click inside a Reservoir / Tank to set the Fluid Level");

	refresh();
}

export function beginFlowDirectionToolSession() {
	arm("flow-direction-diagram", {
		phase: DIRECTION_PHASE,
		directionReversed: false,
		directionSpacing: "single"
	});

	setToolMessage("Click a Pipe / Duct to add a Flow Direction arrow");

	refresh();
}

export function beginPressureProfileToolSession() {
	arm("pressure-profile", { phase: PROFILE_PHASE });

	setToolMessage("Drag to draw the Pressure Profile graph frame");

	refresh();
}

export function beginSectionToolSession() {
	arm("section-plane", { phase: SECTION_PHASE, sectionDirection: "forward" });

	setToolMessage("Drag to draw the Section Plane trace");

	refresh();
}

/* ============================================================
 * THE INLINE TOOLS' GESTURE
 * ============================================================ */

/*
 * WHAT A CLICK ON THE SHEET MEANS TO AN INLINE TOOL.
 *
 * On a pipe: an insertion at that point - interior or end, decided by the
 * target. On empty space: a standalone symbol for the equipment; for the
 * reducer, nothing, because a reducer with no run to sit in is not a reducer -
 * the student is told so rather than given a stray shape.
 */
export function commitInlineAt(toolId, point) {
	if (!finitePoint(point)) {
		return null;
	}

	const target = findInsertionTarget(point);

	if (!target) {
		if (toolId === "reducer-expander") {
			setToolMessage("Click a Pipe / Duct to insert the Reducer / Expander");

			return null;
		}

		return insertStandalone(toolId, point, {
			symbolSize: Number(drawingState.interaction.inlineSymbolSize) || DEFAULT_SYMBOL_RADIUS,
			depiction: drawingState.interaction.inlineDepiction
		});
	}

	const extra =
		toolId === "reducer-expander"
			? {
					mode: drawingState.interaction.inlineMode,
					transitionLength:
						Number(drawingState.interaction.inlineTransitionLength) || DEFAULT_TRANSITION_LENGTH
				}
			: {
					symbolSize: Number(drawingState.interaction.inlineSymbolSize) || DEFAULT_SYMBOL_RADIUS,
					depiction: drawingState.interaction.inlineDepiction
				};

	const plan = planInsertion(toolId, target, extra);

	if (!plan) {
		return null;
	}

	const result = insertInline(toolId, plan, extra);

	if (result?.symbol) {
		enggDrawingState.selectObject(drawingState, result.symbol.id);

		refresh();
	}

	return result;
}

/* The live preview an inline tool shows while the pointer moves. */
export function inlinePreviewAt(toolId, point) {
	if (!finitePoint(point)) {
		return null;
	}

	const target = findInsertionTarget(point);

	if (!target) {
		return toolId === "reducer-expander"
			? null
			: symbolPreviewFor(toolId, { centre: point, rotation: 0, reach: DEFAULT_SYMBOL_RADIUS }, {
					symbolSize: Number(drawingState.interaction.inlineSymbolSize) || DEFAULT_SYMBOL_RADIUS,
					depiction: drawingState.interaction.inlineDepiction
				});
	}

	const extra =
		toolId === "reducer-expander"
			? {
					mode: drawingState.interaction.inlineMode,
					transitionLength:
						Number(drawingState.interaction.inlineTransitionLength) || DEFAULT_TRANSITION_LENGTH
				}
			: {
					symbolSize: Number(drawingState.interaction.inlineSymbolSize) || DEFAULT_SYMBOL_RADIUS,
					depiction: drawingState.interaction.inlineDepiction
				};

	const plan = planInsertion(toolId, target, extra);

	return plan ? symbolPreviewFor(toolId, plan, extra) : null;
}

/* ============================================================
 * THE VESSEL
 * ============================================================ */

export function vesselPreview(session, point) {
	if (!session?.start || !point) {
		return null;
	}

	const width = Math.abs(point.x - session.start.x);
	const height = Math.abs(point.y - session.start.y);

	const preview = enggVessel.createVessel({
		position: { x: Math.min(session.start.x, point.x), y: Math.min(session.start.y, point.y) },
		width: Math.max(width, enggVessel.MIN_VESSEL_SIDE),
		height: Math.max(height, enggVessel.MIN_VESSEL_SIDE),
		vesselStyle: session.style?.vesselStyle || enggVessel.VESSEL_STYLES.open,
		style: session.style?.lineStyle || {}
	});

	return preview
		? {
				id: "vessel-preview",
				type: enggVessel.RESERVOIR_TYPE,
				geometry: preview.geometry,
				engineering: preview.engineering,
				style: preview.style,
				preview: true
			}
		: null;
}

export function commitVesselDrag(start, end) {
	const vessel = enggVessel.vesselFromDrag(start, end, {
		vesselStyle: drawingState.interaction.vesselStyle,
		style: { ...(drawingState.styleDefaults || {}) }
	});

	if (!vessel) {
		setToolMessage("Drag a box to draw the Reservoir / Tank");

		return null;
	}

	const previous = enggDrawingState.snapshotDrawing(drawingState);

	enggDrawingState.addObject(drawingState, vessel);
	enggDrawingState.commitDrawingChange(drawingState, previous);

	const committed = drawingState.objects.find((object) => object.id === vessel.id) || vessel;

	enggDrawingState.selectObject(drawingState, committed.id);

	setToolMessage(`${committed.name} created`);

	refresh();

	return committed;
}

/* ============================================================
 * THE FLUID LEVEL
 * ============================================================ */

/* The vessel whose interior a point is in, nearest first - or null. */
export function vesselAtPoint(point) {
	if (!finitePoint(point)) {
		return null;
	}

	let best = null;

	(drawingState.objects || []).forEach((object) => {
		if (!enggVessel.isVesselType(object.type) || object.visible === false) {
			return;
		}

		if (!enggVessel.vesselContainsPoint(object, point, 2)) {
			return;
		}

		const rect = enggVessel.vesselRect(object);

		if (!rect) {
			return;
		}

		const distance = Math.hypot(point.x - rect.centre.x, point.y - rect.centre.y);

		if (!best || distance < best.distance) {
			best = { vessel: object, distance };
		}
	});

	return best ? best.vessel : null;
}

export function levelPreview(vessel, point) {
	if (!vessel || !point) {
		return null;
	}

	const height = enggVessel.heightAtPoint(vessel, point);

	if (height === null) {
		return null;
	}

	const span = enggVessel.interiorSpan(vessel, height, enggFluidLevel.LEVEL_INSET);

	return span
		? {
				id: "fluid-level-preview",
				type: enggFluidLevel.FLUID_LEVEL_TYPE,
				geometry: { start: span.start, end: span.end },
				style: { ...(drawingState.styleDefaults || {}) },
				preview: true
			}
		: null;
}

export function commitFluidLevelAt(point) {
	const vessel = vesselAtPoint(point);

	if (!vessel) {
		/*
		 * NO VESSEL, NO LEVEL. The tool's standard behaviour needs one, and
		 * silently drawing an unrelated free line would put something on the
		 * sheet the student did not ask for.
		 */
		setToolMessage("Fluid Level needs a Reservoir / Tank - click inside one");

		return null;
	}

	const height = enggVessel.heightAtPoint(vessel, point);

	if (height === null) {
		return null;
	}

	const previous = enggDrawingState.snapshotDrawing(drawingState);

	const level = enggFluidLevel.createFluidLevel(vessel, height, {
		style: { ...(drawingState.styleDefaults || {}) }
	});

	if (!level) {
		return null;
	}

	enggDrawingState.addObject(drawingState, level);
	enggDrawingState.commitDrawingChange(drawingState, previous);

	const committed = drawingState.objects.find((object) => object.id === level.id) || level;

	enggDrawingState.selectObject(drawingState, committed.id);

	setToolMessage(`${committed.name} placed in ${vessel.name}`);

	refresh();

	return committed;
}

/* ============================================================
 * THE FLOW DIRECTION DIAGRAM
 * ============================================================ */

export function directionPreview(pipe, point) {
	const start = pipe?.geometry?.start;
	const end = pipe?.geometry?.end;

	if (!finitePoint(start) || !finitePoint(end) || !finitePoint(point)) {
		return null;
	}

	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const lengthSquared = dx * dx + dy * dy;

	if (lengthSquared < 1e-12) {
		return null;
	}

	const fraction = enggFlowArrows.clampDirectionFraction(
		((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared
	);

	return {
		id: "flow-direction-preview",
		type: enggFlowArrows.FLOW_DIRECTION_TYPE,
		engineering: {
			pipeId: pipe.id,
			position: fraction,
			reversed: drawingState.interaction.directionReversed === true,
			spacing: drawingState.interaction.directionSpacing || "single",
			arrowSize: DEFAULT_ARROW_LENGTH / 2
		},
		style: { ...(drawingState.styleDefaults || {}) },
		preview: true
	};
}

export function commitFlowDirectionAt(point) {
	const target = findInsertionTarget(point);

	if (!target?.run || !enggPipeDuct.isPipeDuctType(target.run.type)) {
		setToolMessage("Click a Pipe / Duct to add a Flow Direction arrow");

		return null;
	}

	const start = target.run.geometry.start;
	const end = target.run.geometry.end;

	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const lengthSquared = dx * dx + dy * dy;

	const fraction = lengthSquared < 1e-12 ? 0.5 : ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;

	const previous = enggDrawingState.snapshotDrawing(drawingState);

	const annotation = enggFlowArrows.createFlowDirection(target.run, {
		position: fraction,
		reversed: drawingState.interaction.directionReversed === true,
		spacing: drawingState.interaction.directionSpacing || "single",
		style: { ...(drawingState.styleDefaults || {}) }
	});

	if (!annotation) {
		return null;
	}

	enggDrawingState.addObject(drawingState, annotation);
	enggDrawingState.commitDrawingChange(drawingState, previous);

	const committed = drawingState.objects.find((object) => object.id === annotation.id) || annotation;

	enggDrawingState.selectObject(drawingState, committed.id);

	setToolMessage(`${committed.name} added to ${target.run.name}`);

	refresh();

	return committed;
}

/* ============================================================
 * THE PRESSURE PROFILE
 * ============================================================ */

export function profilePreview(session, point) {
	if (!session?.start || !point) {
		return null;
	}

	const profile = enggPressureProfile.profileFromDrag(session.start, point, {
		style: session.style || {}
	});

	return profile
		? {
				id: "pressure-profile-preview",
				type: enggPressureProfile.PRESSURE_PROFILE_TYPE,
				geometry: profile.geometry,
				engineering: profile.engineering,
				style: profile.style,
				preview: true
			}
		: null;
}

export function commitProfileDrag(start, end) {
	const profile = enggPressureProfile.profileFromDrag(start, end, {
		style: { ...(drawingState.styleDefaults || {}) }
	});

	if (!profile) {
		setToolMessage("Drag a box to draw the Pressure Profile graph frame");

		return null;
	}

	const previous = enggDrawingState.snapshotDrawing(drawingState);

	enggDrawingState.addObject(drawingState, profile);
	enggDrawingState.commitDrawingChange(drawingState, previous);

	const committed = drawingState.objects.find((object) => object.id === profile.id) || profile;

	enggDrawingState.selectObject(drawingState, committed.id);

	setToolMessage(`${committed.name} created - add its data in the Features tab`);

	refresh();

	return committed;
}

/* ============================================================
 * THE SECTION PLANE
 * ============================================================ */

export function sectionPreview(session, point) {
	if (!session?.start || !point) {
		return null;
	}

	const section = enggSectionPlane.createSectionPlane(session.start, point, {
		direction: drawingState.interaction.sectionDirection,
		style: session.style || {}
	});

	return section
		? {
				id: "section-plane-preview",
				type: enggSectionPlane.SECTION_PLANE_TYPE,
				geometry: section.geometry,
				engineering: section.engineering,
				style: section.style,
				preview: true
			}
		: null;
}

export function commitSectionDrag(start, end) {
	const section = enggSectionPlane.createSectionPlane(start, end, {
		direction: drawingState.interaction.sectionDirection,
		style: { ...(drawingState.styleDefaults || {}) }
	});

	if (!section) {
		setToolMessage("Drag to draw the Section Plane trace");

		return null;
	}

	const previous = enggDrawingState.snapshotDrawing(drawingState);

	enggDrawingState.addObject(drawingState, section);
	enggDrawingState.commitDrawingChange(drawingState, previous);

	const committed = drawingState.objects.find((object) => object.id === section.id) || section;

	enggDrawingState.selectObject(drawingState, committed.id);

	setToolMessage(`${committed.name} created`);

	refresh();

	return committed;
}

/* ============================================================
 * THE PREVIEW DISPATCH
 * ============================================================
 *
 * `creation-drag.js` publishes ONE preview per frame, and this is the function
 * that decides what it is for whichever schematic tool is armed - so the drag
 * handler needs no table of its own and cannot disagree with the tools here.
 */
export function schematicPreviewAt(toolId, session, point) {
	if (!finitePoint(point)) {
		return null;
	}

	switch (toolId) {
		case "reducer-expander":
		case "pump":
		case "valve":
		case "flow-meter":
			return inlinePreviewAt(toolId, point);

		case "reservoir-tank":
			return vesselPreview(session, point);

		case "fluid-level":
			return levelPreview(vesselAtPoint(point), point);

		case "flow-direction-diagram": {
			const target = findInsertionTarget(point);

			return target?.run ? directionPreview(target.run, point) : null;
		}

		case "pressure-profile":
			return profilePreview(session, point);

		case "section-plane":
			return sectionPreview(session, point);

		default:
			return null;
	}
}

const enggFluidsSchematicTool = {
	VESSEL_PHASE,
	LEVEL_PHASE,
	DIRECTION_PHASE,
	PROFILE_PHASE,
	SECTION_PHASE,
	beginInlineToolSession,
	beginVesselToolSession,
	beginFluidLevelToolSession,
	beginFlowDirectionToolSession,
	beginPressureProfileToolSession,
	beginSectionToolSession,
	commitInlineAt,
	inlinePreviewAt,
	vesselPreview,
	commitVesselDrag,
	vesselAtPoint,
	levelPreview,
	commitFluidLevelAt,
	directionPreview,
	commitFlowDirectionAt,
	profilePreview,
	commitProfileDrag,
	sectionPreview,
	commitSectionDrag,
	schematicPreviewAt,
	defaultVesselSize: () => ({ width: DEFAULT_VESSEL_WIDTH, height: DEFAULT_VESSEL_HEIGHT })
};

export default enggFluidsSchematicTool;
