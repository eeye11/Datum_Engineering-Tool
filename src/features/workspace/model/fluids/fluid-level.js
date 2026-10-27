/*
 * ========================================================
 * FLUID LEVEL
 * ========================================================
 *
 * A horizontal line across the interior of a Reservoir / Tank, marking where
 * the fluid surface is. It is an ordinary selectable object, attached to the
 * vessel it belongs to:
 *
 *   engineering.vesselId       the vessel it marks (an object id, never an index)
 *   engineering.levelPercent   the surface's position, 0..100, of the vessel's
 *                              USABLE INTERIOR height
 *   engineering.levelPosition  the same position in drawing units, written on
 *                              every settle. It is a MIRROR of the percentage -
 *                              never a second source of truth - so a saved file
 *                              has a number to read before its vessel is found.
 *   engineering.fillColour     the liquid's colour
 *   engineering.fillOpacity    how solid that colour is painted
 *
 * ========================================================
 * A PERCENTAGE, NOT TWO ENDPOINTS
 * ========================================================
 *
 * The surface line, the drag handle and the FILLED REGION are all derived from
 * the vessel's current geometry and that one percentage:
 *
 *   levelSegment(level)   the surface line, wall to wall
 *   fillRegion(level)     the liquid, as a closed polygon inside the walls
 *
 * Moving, turning or resizing the vessel therefore carries the level with it at
 * the SAME relative level - a half-full tank stays half full when it grows -
 * and there is no update step that could be forgotten.
 *
 * A ZERO-PERCENT LEVEL IS AN EMPTY TANK: its surface sits on the floor and its
 * fill region is empty, so nothing is drawn below the vessel. A HUNDRED-PERCENT
 * LEVEL is full to the underside of the mouth (or to the lid of a closed tank),
 * and still inside the walls.
 *
 * ========================================================
 * NOT A SOLVER
 * ========================================================
 *
 * DAETUM does not compute a volume, a mass, a pressure or a flow from any of
 * this. The percentage is where the student put the surface, and nothing more.
 */

import enggDrawingState from "../../../../shared/model/drawing-state.js";
import enggPipeDuct from "./pipe-duct.js";
import enggVessel from "./reservoir-tank.js";
import { finitePoint, unitVector } from "./fluids-shared.js";

export const FLUID_LEVEL_TYPE = "fluid-level";

/* How far inside each wall the level line stops, in drawing units. */
export const LEVEL_INSET = 1.5;

/* The closest the surface may sit to the floor or the mouth, in world units. */
export const LEVEL_EDGE_MARGIN = 0.5;

/* The default level a press-time placement lands at, when no height is given. */
export const DEFAULT_LEVEL_PERCENT = 50;

/* The surface line's own default dash: a fluid surface is drawn broken. */
export const LEVEL_DEFAULT_LINE_TYPE = "dashed";

/* The default liquid fill. A pale blue, at a low opacity, behind the line. */
export const LEVEL_DEFAULT_FILL = "#7FB3D5";
export const LEVEL_DEFAULT_FILL_OPACITY = 0.35;

export function isFluidLevelType(type) {
	return type === FLUID_LEVEL_TYPE;
}

/*
 * THE VESSEL RE-SEATS ITS LEVELS THROUGH THIS MODULE.
 *
 * `reservoir-tank.js` cannot import the level model - a level is defined in
 * terms of a vessel, so the dependency runs the other way - so the one operation
 * a vessel needs is handed over here, at load. Told once, at the one end of the
 * graph the import already flows.
 */
if (typeof enggVessel.setVesselLevelRefresher === "function") {
	enggVessel.setVesselLevelRefresher((level, objects) => refreshFluidLevel(level, objects));
}

/* The vessel a level belongs to, looked up the same way an arrow looks up its pipe. */
export function vesselOf(level) {
	const id = level?.engineering?.vesselId;

	/* The one sheet lookup the fluids model already publishes (see pipe-duct.js). */
	return id ? enggPipeDuct.connectedPipe(id) : null;
}

/*
 * THE VESSEL A LEVEL IS DRAWN FROM.
 *
 * A caller that has the object list (the renderer, the source writer, a test)
 * hands it in, so the lookup is a plain find. A caller that has only the object
 * asks the document's published lookup. Neither falls back to "the nearest
 * vessel": an orphaned level draws NOTHING rather than attaching itself to
 * whatever happened to be nearby.
 */
export function vesselFor(level, objects = null) {
	const id = level?.engineering?.vesselId;

	if (!id) {
		return null;
	}

	const list = Array.isArray(objects) ? objects : null;

	if (list) {
		const found = list.find((object) => object?.id === id);

		if (found) {
			return enggVessel.isVesselType(found.type) ? found : null;
		}
	}

	const fallback = enggPipeDuct.connectedPipe(id);

	return enggVessel.isVesselType(fallback?.type) ? fallback : null;
}

/* ============================================================
 * THE LEVEL PERCENTAGE
 * ============================================================ */

export function clampLevelPercent(value) {
	const number = Number(value);

	if (!Number.isFinite(number)) {
		return DEFAULT_LEVEL_PERCENT;
	}

	return Math.min(100, Math.max(0, number));
}

/* The stored percentage, clamped to the vessel's own range. */
export function levelPercentOf(level) {
	const stored = level?.engineering?.levelPercent;

	if (stored !== undefined && stored !== null && Number.isFinite(Number(stored))) {
		return clampLevelPercent(stored);
	}

	/*
	 * A FILE WRITTEN BEFORE PERCENTAGES. It carries the surface's height above
	 * the floor, so the percentage is read back from it against the vessel -
	 * no migration step, and the level opens where it was.
	 */
	const legacy = Number(level?.engineering?.levelPosition);
	const rect = enggVessel.vesselRect(vesselFor(level));

	if (Number.isFinite(legacy) && rect && rect.height > 0) {
		return clampLevelPercent((legacy / rect.height) * 100);
	}

	return DEFAULT_LEVEL_PERCENT;
}

/*
 * SET THE LEVEL, as a percentage of the vessel's usable interior.
 *
 * Returns false when the level has no usable vessel, so a cell or a drag that
 * could not land anywhere is reported rather than silently accepted.
 */
export function setLevelPercent(level, percent, objects = null) {
	const vessel = vesselFor(level, objects);

	if (!vessel) {
		return false;
	}

	const value = Number(percent);

	if (!Number.isFinite(value)) {
		return false;
	}

	level.engineering = {
		...(level.engineering || {}),
		levelPercent: clampLevelPercent(value)
	};

	return refreshFluidLevel(level, objects);
}

/* The surface's height above the vessel's floor, in drawing units. */
export function levelHeightOf(level, rect = null, objects = null) {
	const hostRect = rect || enggVessel.vesselRect(vesselFor(level, objects));

	if (!hostRect) {
		return 0;
	}

	return (levelPercentOf(level) / 100) * hostRect.height;
}

/*
 * The level's line, from the vessel's ACTUAL interior.
 *
 * Returns `{ start, end, height, percent }`, or null when the vessel has gone or
 * is degenerate - in which case the level draws nothing rather than inventing a
 * line somewhere.
 */
export function levelSegment(level, objects = null) {
	const vessel = vesselFor(level, objects);

	if (!vessel) {
		return null;
	}

	const rect = enggVessel.vesselRect(vessel);

	if (!rect) {
		return null;
	}

	const percent = levelPercentOf(level);
	const span = enggVessel.interiorSpan(vessel, (percent / 100) * rect.height, LEVEL_INSET);

	if (!span) {
		return null;
	}

	return { start: span.start, end: span.end, height: span.height, percent };
}

/*
 * THE LIQUID, AS A CLOSED REGION INSIDE THE WALLS.
 *
 * The polygon is the wall-to-wall surface at the top and the vessel's interior
 * floor at the bottom - the SAME span the level line ends on, so the fill never
 * paints over a wall and never spills below the floor. At 0% it is empty, and a
 * renderer draws nothing.
 *
 * The floor's two corners are taken in the VESSEL's own frame and put back, so
 * a rotated tank is filled along its own bottom rather than along the page's.
 */
export function fillRegion(level, objects = null) {
	const vessel = vesselFor(level, objects);
	const segment = levelSegment(level, objects);

	if (!vessel || !segment) {
		return null;
	}

	const rect = enggVessel.vesselRect(vessel);

	if (!rect) {
		return null;
	}

	if (segment.percent <= 0) {
		return { points: [], empty: true, percent: 0 };
	}

	const startLocal = enggVessel.localOf(rect, segment.start);
	const endLocal = enggVessel.localOf(rect, segment.end);

	/*
	 * The floor is the vessel's own bottom edge (local y = 0), expressed in the
	 * vessel's frame - so a rotated tank is filled along its own bottom rather
	 * than along the page's, and the fill never reaches past the floor.
	 */
	const floorY = 0;

	const floorStart = enggVessel.worldOf(rect, { x: startLocal.x, y: floorY });
	const floorEnd = enggVessel.worldOf(rect, { x: endLocal.x, y: floorY });

	return {
		points: [segment.start, segment.end, floorEnd, floorStart],
		empty: false,
		percent: segment.percent
	};
}

/* ============================================================
 * APPEARANCE: THE LIQUID'S OWN COLOUR AND OPACITY
 * ============================================================ */

export function levelFillColourOf(level) {
	const colour = String(level?.engineering?.fillColour ?? "").trim();

	return /^#[0-9a-fA-F]{6}$/.test(colour) ? colour : LEVEL_DEFAULT_FILL;
}

export function levelFillOpacityOf(level) {
	const stored = Number(level?.engineering?.fillOpacity);

	return Number.isFinite(stored) ? Math.min(1, Math.max(0, stored)) : LEVEL_DEFAULT_FILL_OPACITY;
}

export function setLevelFillColour(level, colour) {
	const value = String(colour ?? "").trim();

	if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
		return false;
	}

	level.engineering = { ...(level.engineering || {}), fillColour: value.toLowerCase() };

	return true;
}

export function setLevelFillOpacity(level, opacity) {
	const value = Number(opacity);

	if (!Number.isFinite(value)) {
		return false;
	}

	level.engineering = { ...(level.engineering || {}), fillOpacity: Math.min(1, Math.max(0, value)) };

	return true;
}

/* The level line's direction, for the hit test and the bounds. */
export function levelDirection(level, objects = null) {
	const segment = levelSegment(level, objects);

	return segment ? unitVector(segment.start, segment.end) : null;
}

/*
 * CREATE ONE ON A VESSEL AT A PERCENTAGE.
 *
 * Returns null when there is no usable vessel - the tool refuses a placement
 * with no vessel rather than making an unrelated free line.
 */
export function createFluidLevel(vessel, percent, options = {}) {
	if (!enggVessel.isVesselType(vessel?.type)) {
		return null;
	}

	const rect = enggVessel.vesselRect(vessel);

	if (!rect) {
		return null;
	}

	const value = clampLevelPercent(percent);
	const span = enggVessel.interiorSpan(vessel, (value / 100) * rect.height, LEVEL_INSET);

	if (!span) {
		return null;
	}

	return enggDrawingState.createGeometryObject(
		FLUID_LEVEL_TYPE,
		{
			start: span.start,
			end: span.end
		},
		{
			...options,
			style: {
				lineType: LEVEL_DEFAULT_LINE_TYPE,
				...(options.style || {})
			},
			engineering: {
				vesselId: vessel.id,
				levelPercent: value,
				levelPosition: span.height,
				fillColour: options.fillColour || LEVEL_DEFAULT_FILL,
				fillOpacity: Number.isFinite(Number(options.fillOpacity))
					? Number(options.fillOpacity)
					: LEVEL_DEFAULT_FILL_OPACITY
			},

			/* The level hangs off its vessel for deletion, like an arrow off its pipe. */
			parentId: vessel.id
		}
	);
}

/* Set the level to the height nearest a world point on its vessel. */
export function setLevelFromPoint(level, point, objects = null) {
	const vessel = vesselFor(level, objects);

	if (!vessel || !finitePoint(point)) {
		return false;
	}

	const height = enggVessel.heightAtPoint(vessel, point);
	const rect = enggVessel.vesselRect(vessel);

	if (height === null || !rect || !(rect.height > 0)) {
		return false;
	}

	return setLevelPercent(level, (height / rect.height) * 100, objects);
}

/* Set the level from a height in drawing units - an older file, and a test. */
export function setLevelHeight(level, height, vessel = null, objects = null) {
	const host = vessel || vesselFor(level, objects);
	const rect = enggVessel.vesselRect(host);

	if (!rect || !(rect.height > 0)) {
		return false;
	}

	const value = Number(height);

	if (!Number.isFinite(value)) {
		return false;
	}

	level.engineering = {
		...(level.engineering || {}),
		levelPercent: clampLevelPercent((value / rect.height) * 100)
	};

	return refreshFluidLevel(level, objects || (vessel ? [host] : null));
}

/*
 * REFRESH A LEVEL FROM ITS VESSEL.
 *
 * Called after the vessel moved, turned or was resized, and after a reopen, so
 * the stored `geometry` mirror and the stored height always describe the line
 * the canvas draws. THE PERCENTAGE IS NOT TOUCHED - that is the whole point of
 * storing it, and it is what keeps a resized tank's level proportional.
 */
export function refreshFluidLevel(level, objects = null) {
	const segment = levelSegment(level, objects);

	if (!segment) {
		return false;
	}

	level.geometry = { start: segment.start, end: segment.end };
	level.engineering = {
		...(level.engineering || {}),
		levelPercent: segment.percent,
		levelPosition: segment.height
	};

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
	DEFAULT_LEVEL_PERCENT,
	LEVEL_DEFAULT_LINE_TYPE,
	LEVEL_DEFAULT_FILL,
	LEVEL_DEFAULT_FILL_OPACITY,
	isFluidLevelType,
	vesselOf,
	vesselFor,
	clampLevelPercent,
	levelPercentOf,
	setLevelPercent,
	levelSegment,
	levelHeightOf,
	fillRegion,
	levelDirection,
	levelFillColourOf,
	levelFillOpacityOf,
	setLevelFillColour,
	setLevelFillOpacity,
	createFluidLevel,
	setLevelFromPoint,
	setLevelHeight,
	refreshFluidLevel,
	levelContainsPoint
};

export default enggFluidLevel;
