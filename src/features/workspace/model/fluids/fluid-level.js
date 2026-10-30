/*
 * ========================================================
 * FLUID LEVEL
 * ========================================================
 *
 * A horizontal line across the interior of a Reservoir / Tank, marking where
 * the fluid surface is. It is an ordinary selectable object, attached to the
 * vessel it belongs to:
 *
 *   engineering.vesselId        the vessel it marks
 *   engineering.levelPosition   the HEIGHT above the vessel's bottom
 *
 * ========================================================
 * THE POSITION IS A HEIGHT, NOT TWO ENDPOINTS
 * ========================================================
 *
 * The line's two endpoints are DERIVED from the vessel's current geometry and
 * that height: it always spans just inside the walls, and it can never run on
 * through them. Moving the vessel, turning it or making it wider moves and
 * stretches the level with it, with no update step to forget.
 *
 * DAETUM does not compute a fill percentage, a volume or a pressure from it.
 * The height is where the student drew the surface, and nothing more.
 */

import enggDrawingState from "../../../../shared/model/drawing-state.js";
import enggPipeDuct from "./pipe-duct.js";
import enggVessel from "./reservoir-tank.js";
import { finitePoint, unitVector } from "./fluids-shared.js";

export const FLUID_LEVEL_TYPE = "fluid-level";

/* How far inside each wall the level line stops, in drawing units. */
export const LEVEL_INSET = 1.5;

/* The closest the level may sit to the bottom or the mouth. */
export const LEVEL_EDGE_MARGIN = 0.5;

export function isFluidLevelType(type) {
	return type === FLUID_LEVEL_TYPE;
}

/* The vessel a level belongs to, looked up the same way an arrow looks up its pipe. */
export function vesselOf(level) {
	const id = level?.engineering?.vesselId;

	/* The one sheet lookup the fluids model already publishes (see pipe-duct.js). */
	return id ? enggPipeDuct.connectedPipe(id) : null;
}

/*
 * The level's line, from the vessel's ACTUAL interior.
 *
 * Returns `{ start, end }`, or null when the vessel has gone or is degenerate -
 * in which case the level draws nothing rather than inventing a line somewhere.
 */
export function levelSegment(level, objects = null) {
	const vessel = (objects && Array.isArray(objects) ? objects : null)?.find(
		(object) => object?.id === level?.engineering?.vesselId
	) || vesselOf(level);

	if (!enggVessel.isVesselType(vessel?.type)) {
		return null;
	}

	const rect = enggVessel.vesselRect(vessel);

	if (!rect) {
		return null;
	}

	const height = levelHeightOf(level, rect);

	return enggVessel.interiorSpan(vessel, height, LEVEL_INSET);
}

/* The stored height, clamped to the vessel's own interior. */
export function levelHeightOf(level, rect = null) {
	const stored = Number(level?.engineering?.levelPosition);

	if (!rect) {
		return Number.isFinite(stored) ? stored : 0;
	}

	const value = Number.isFinite(stored) ? stored : rect.height / 2;

	return Math.min(rect.height - LEVEL_EDGE_MARGIN, Math.max(LEVEL_EDGE_MARGIN, value));
}

/* The level line's direction, for the hit test and the bounds. */
export function levelDirection(level, objects = null) {
	const segment = levelSegment(level, objects);

	return segment ? unitVector(segment.start, segment.end) : null;
}

/*
 * CREATE ONE ON A VESSEL AT A HEIGHT.
 *
 * Returns null when there is no usable vessel - the tool refuses a placement
 * with no vessel rather than making an unrelated free line.
 */
export function createFluidLevel(vessel, height, options = {}) {
	if (!enggVessel.isVesselType(vessel?.type)) {
		return null;
	}

	const rect = enggVessel.vesselRect(vessel);

	if (!rect) {
		return null;
	}

	const clamped = Math.min(rect.height - LEVEL_EDGE_MARGIN, Math.max(LEVEL_EDGE_MARGIN, Number(height) || rect.height / 2));

	const span = enggVessel.interiorSpan(vessel, clamped, LEVEL_INSET);

	return enggDrawingState.createGeometryObject(
		FLUID_LEVEL_TYPE,
		{
			start: span.start,
			end: span.end
		},
		{
			...options,
			engineering: {
				vesselId: vessel.id,
				levelPosition: clamped
			},

			/* The level hangs off its vessel for deletion, like an arrow off its pipe. */
			parentId: vessel.id
		}
	);
}

/* Move the level to a world point's height on its vessel. */
export function setLevelFromPoint(level, point, objects = null) {
	const vessel = (objects && Array.isArray(objects) ? objects : null)?.find(
		(object) => object?.id === level?.engineering?.vesselId
	) || vesselOf(level);

	if (!enggVessel.isVesselType(vessel?.type) || !finitePoint(point)) {
		return false;
	}

	const height = enggVessel.heightAtPoint(vessel, point);

	if (height === null) {
		return false;
	}

	return setLevelHeight(level, height, vessel);
}

export function setLevelHeight(level, height, vessel = null) {
	const host = vessel || vesselOf(level);
	const rect = enggVessel.vesselRect(host);

	if (!rect) {
		return false;
	}

	const clamped = Math.min(rect.height - LEVEL_EDGE_MARGIN, Math.max(LEVEL_EDGE_MARGIN, Number(height)));

	if (!Number.isFinite(clamped)) {
		return false;
	}

	const span = enggVessel.interiorSpan(host, clamped, LEVEL_INSET);

	level.engineering = { ...(level.engineering || {}), levelPosition: clamped };
	level.geometry = { start: span.start, end: span.end };

	return true;
}

/*
 * REFRESH A LEVEL FROM ITS VESSEL.
 *
 * Called after the vessel moved or was resized, and after a reopen, so the
 * stored `geometry` mirror always describes the line the canvas draws.
 */
export function refreshFluidLevel(level, objects = null) {
	const segment = levelSegment(level, objects);

	if (!segment) {
		return false;
	}

	level.geometry = { start: segment.start, end: segment.end };

	return true;
}

/* Whether a point is on the level line. */
export function levelContainsPoint(level, point, tolerance = 0, objects = null) {
	const segment = levelSegment(level, objects);

	if (!segment) {
		return false;
	}

	const dx = segment.end.x - segment.start.x;
	const dy = segment.end.y - segment.start.y;
	const lengthSquared = dx * dx + dy * dy;

	if (lengthSquared < 1e-12) {
		return false;
	}

	const t = ((point.x - segment.start.x) * dx + (point.y - segment.start.y) * dy) / lengthSquared;

	if (t < -0.05 || t > 1.05) {
		return false;
	}

	const foot = { x: segment.start.x + dx * t, y: segment.start.y + dy * t };

	return Math.hypot(point.x - foot.x, point.y - foot.y) <= tolerance;
}

const enggFluidLevel = {
	FLUID_LEVEL_TYPE,
	LEVEL_INSET,
	LEVEL_EDGE_MARGIN,
	isFluidLevelType,
	vesselOf,
	levelSegment,
	levelHeightOf,
	levelDirection,
	createFluidLevel,
	setLevelFromPoint,
	setLevelHeight,
	refreshFluidLevel,
	levelContainsPoint
};

export default enggFluidLevel;
