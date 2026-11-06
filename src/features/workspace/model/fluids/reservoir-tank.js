/*
 * ========================================================
 * RESERVOIR / TANK
 * ========================================================
 *
 * One editable schematic vessel: an open-topped reservoir or a closed tank.
 *
 *   geometry.position   the ANCHOR corner (its own top-left, before rotation)
 *   geometry.width      the vessel's width, always positive
 *   geometry.height     the vessel's height, always positive
 *   geometry.rotation   the angle it is drawn at, in RADIANS, like every other
 *                       rectangle-shaped feature in DAETUM
 *   engineering.vesselStyle   "open" | "closed"
 *   engineering.fluidLevel    the Tank's optional liquid (see below)
 *
 * ========================================================
 * A RESERVOIR OR A TANK, NOT TWO OBJECTS
 * ========================================================
 *
 * `vesselStyle` is the ONLY difference between the two schematics: a reservoir
 * has no top line, a tank has one. Switching between them edits that one value
 * on the same object, so the id, the name, the style and everything attached to
 * the vessel survive the switch.
 *
 * THE GEOMETRY IS ALWAYS NORMALISED. `position` is the vessel's top-left corner
 * and `width`/`height` are positive whatever the student typed or dragged - a
 * box dragged up and to the left lands in exactly the same place as one dragged
 * down and to the right.
 *
 * ========================================================
 * THE FLUID LEVEL IS THE TANK'S OWN PROPERTY
 * ========================================================
 *
 * A closed tank may show a liquid: a horizontal surface across its interior at
 * a percentage of the internal height, with the fill below it. It is NOT a
 * second drawing object - it is a property of the vessel, so there is nothing to
 * keep in step and nothing that can be left behind when the tank is resized,
 * deleted or undone.
 *
 * ========================================================
 * ONE OBJECT, FIVE LINES AT MOST
 * ========================================================
 *
 * The vessel is drawn from its outline: two sides, the bottom, and the top when
 * it is a closed tank. Those are NOT four or five independently selectable wall
 * features - there is one object, one selection, one shape block in the source.
 *
 * ========================================================
 * WHAT CAN ATTACH
 * ========================================================
 *
 * A pipe endpoint that is deliberately placed ON the outline is a SUPPORTED
 * ATTACHMENT, recorded on the pipe (`engineering.vesselId` and its port). It is
 * not a marker and it is not drawn: the pipe simply ends on the vessel, exactly
 * as it was drawn. A pipe that merely CROSSES the vessel is not attached, and
 * DAETUM never attaches one just because the two geometries intersect.
 *
 * A Fluid Level attached to the vessel is recorded on the level, and follows it.
 * So does an attached pipe's held end.
 */

import enggDrawingState from "../../../../shared/model/drawing-state.js";
import {
  DEFAULT_VESSEL_HEIGHT,
	DEFAULT_VESSEL_WIDTH,
	distanceToSegment,
	finitePoint,
	projectOntoLine,
	segmentIntersection
} from "./fluids-shared.js";

export const RESERVOIR_TYPE = "reservoir-tank";

export const VESSEL_STYLES = Object.freeze({
	open: "open",
	closed: "closed"
});

export const VESSEL_STYLE_LABELS = Object.freeze({
	open: "Open Reservoir",
	closed: "Closed Tank"
});

/* The shortest side a vessel may have, so it can never collapse to a line. */
export const MIN_VESSEL_SIDE = 1;

/*
 * HOW A VESSEL RE-SEATS ITS LEVELS.
 *
 * The vessel and the level model import each other only in one direction in
 * fact but not in the module graph: a level is defined in terms of a vessel, so
 * `fluid-level.js` imports THIS file. Rather than close that into a cycle, the
 * one operation the vessel needs from the level model is injected by that model
 * when it loads - the same seam `feature-schema.js` uses for its run lookup.
 *
 * Until it is injected (a module loaded on its own, a partial import) `followVessel`
 * still updates the level's stored vessel height but leaves its line alone, and
 * the next `refreshFluidLevel` puts it right.
 */
let levelRefresher = null;

/*
 * THE SHEET THE VESSEL "LIVES ON", for callers that have only the object.
 *
 * A Features row writes ONE field on ONE object and has no document to hand
 * in, but the wall a pipe is held on, and a level's line, are facts about the
 * whole sheet - so the live list is injected here at load, exactly as the
 * level refresher is above. Until it is injected the writers still work: they
 * just cannot re-seat anything that hangs off the vessel.
 */
let objectProvider = null;

export function setVesselObjectProvider(provider) {
	objectProvider = typeof provider === "function" ? provider : null;
}

/* The sheet's objects: the list given, else the injected sheet, else none. */
export function vesselObjectList(objects = null) {
	if (Array.isArray(objects)) {
		return objects;
	}

	if (typeof objectProvider === "function") {
		const list = objectProvider();

		if (Array.isArray(list)) {
			return list;
		}
	}

	return Array.isArray(enggDrawingState.objects) ? enggDrawingState.objects : null;
}

export function setVesselLevelRefresher(refresh) {
  levelRefresher = typeof refresh === "function" ? refresh : null;
}

export function isVesselType(type) {
  return type === RESERVOIR_TYPE;
}

/* The two configurations the Features tab offers. */
export const VESSEL_CONFIGURATION_LABELS = Object.freeze({
	open: "Reservoir",
	closed: "Tank"
});

/* The storage configuration a vessel carries: open-topped or closed. */
export function vesselStyleOf(vessel) {
	return vessel?.engineering?.vesselStyle === VESSEL_STYLES.closed ? VESSEL_STYLES.closed : VESSEL_STYLES.open;
}

/* What the fluid level defaults to the first time it is switched on. */
export const DEFAULT_FLUID_LEVEL_PERCENT = 50;

/* How far inside each wall the liquid surface stops, in drawing units. */
export const FLUID_LEVEL_INSET = 1.5;

/* The liquid's default colour and opacity - a pale blue behind the surface. */
export const FLUID_LEVEL_DEFAULT_FILL = "#7FB3D5";
export const FLUID_LEVEL_DEFAULT_OPACITY = 0.35;

/*
 * ============================================================
 * THE VESSEL'S OWN FRAME
 * ============================================================
 *
 * DAETUM's world Y axis grows UPWARD (the renderer flips it into screen Y), and
 * the canvas reports a point above another as a LARGER world y.
 *
 * A vessel stores an ANCHOR and two positive sides. This module treats the
 * anchor as the vessel's BOTTOM-LEFT corner: its height extends UPWARD from there,
 * which is the direction the canvas itself grows. That is the same convention the
 * generic Rectangle uses (`feature-geometry.js` centres its box half a height
 * above `position`), so a vessel and a rectangle drawn over the same two points
 * occupy the same space.
 *
 * IN THIS FRAME local (0, 0) IS THE BOTTOM-LEFT CORNER:
 *
 *   local (0, 0)          bottom-left
 *   local (width, 0)      bottom-right
 *   local (width, height) TOP-RIGHT
 *   local (0, height)     TOP-LEFT
 *
 * and a RISE from the floor is simply a local y, so the fluid level is one plain
 * multiplication. Nothing here ever measures a distance down from the top, which
 * is what used to draw the surface and the liquid mirrored about the tank.
 *
 * `localOf` and `worldOf` are the only two functions that know this; everything
 * else asks them.
 */

/*
 * THE RECTANGLE A VESSEL STORES.
 *
 * `position` is the bottom-left corner. `corners` is reported in a stable order
 * for the callers that need to name a side:
 *
 *   [0] bottom-left, [1] bottom-right, [2] top-right, [3] top-left
 */
export function vesselRect(vessel) {
	const position = vessel?.geometry?.position;

	if (!finitePoint(position)) {
		return null;
	}

	const width = Math.abs(Number(vessel.geometry.width));
	const height = Math.abs(Number(vessel.geometry.height));

	if (!(width > 0) || !(height > 0)) {
		return null;
	}

	const rotation = Number(vessel.geometry.rotation) || 0;

	const cos = Math.cos(rotation);
	const sin = Math.sin(rotation);

	/* A local point back in the drawing: the anchor, plus the local offset. */
	const place = (x, y) => ({
		x: position.x + x * cos - y * sin,
		y: position.y + x * sin + y * cos
	});

	return {
		position: { x: position.x, y: position.y },
		width,
		height,
		rotation,
		place,
		corners: [place(0, 0), place(width, 0), place(width, height), place(0, height)],
		centre: place(width / 2, height / 2)
	};
}

/* ============================================================
 * THE VESSEL'S OUTLINE
 * ============================================================ */

/*
 * The visible lines of the vessel, as world segments.
 *
 * Order: left side, bottom, right side, then the top for a closed tank. An open
 * reservoir has NO top line - that is the entire visual difference, and it is
 * the setting, not a second object.
 *
 * The sides are named from `vesselRect`'s corner order, which is fixed:
 * [0] bottom-left, [1] bottom-right, [2] top-right, [3] top-left. In a world
 * whose Y grows upward, the TOP is therefore always corner 3 and the BOTTOM is
 * always corner 0 - never whichever coordinate happens to be smaller.
 */
export function vesselSegments(vessel) {
	const rect = vesselRect(vessel);

	if (!rect) {
		return [];
	}

	const [bottomLeft, bottomRight, topRight, topLeft] = rect.corners;

	const sides = [
		/* The left wall rises from the floor to the mouth, or to the lid. */
		{ start: bottomLeft, end: topLeft, name: "left" },
		{ start: bottomLeft, end: bottomRight, name: "bottom" },
		/* The right wall rises the same way. */
		{ start: bottomRight, end: topRight, name: "right" }
	];

	if (vesselStyleOf(vessel) === VESSEL_STYLES.closed) {
		sides.push({ start: topRight, end: topLeft, name: "top" });
	}

	return sides;
}

/* The outline as one polyline, in drawing order. */
export function vesselOutline(vessel) {
	const rect = vesselRect(vessel);

	if (!rect) {
		return [];
	}

	const [bottomLeft, bottomRight, topRight, topLeft] = rect.corners;

	/* Up the left wall, across the mouth or the lid, then down the right wall. */
	void topRight;
	void vesselStyleOf(vessel);

	return [bottomLeft, topLeft, topRight, bottomRight];
}

/*
 * WHERE A VESSEL'S FOUR BOUNDARIES ARE, for the edge handles.
 *
 * Each edge is named for the side it moves and placed at the MIDDLE of that
 * side, OUTSIDE the vessel by a small gap. The four corners stay free for the
 * ordinary corner resize: an edge handle that sat on the wall would compete
 * with the corner handle wherever the box is narrow, and a press would resize
 * the wrong one of them.
 */
export function vesselEdgeHandles(vessel) {
	const rect = vesselRect(vessel);

	if (!rect) {
		return [];
	}

	/* How far outside the wall an edge handle sits, in drawing units. */
	const gap = Math.min(3, Math.max(1, rect.width / 8, rect.height / 8));

	/*
	 * In this frame the FLOOR is local y = 0 and the LID is local y = height, so
	 * the top handle sits ABOVE the vessel (a positive local y) and the bottom
	 * handle below it (a negative one).
	 */
	return [
		{ kind: "vessel-edge-left", point: worldOf(rect, { x: -gap, y: rect.height / 2 }) },
		{ kind: "vessel-edge-right", point: worldOf(rect, { x: rect.width + gap, y: rect.height / 2 }) },
		{ kind: "vessel-edge-top", point: worldOf(rect, { x: rect.width / 2, y: rect.height + gap }) },
		{ kind: "vessel-edge-bottom", point: worldOf(rect, { x: rect.width / 2, y: -gap }) }
	];
}

/*
 * MOVE ONE BOUNDARY, KEEPING THE OTHER THREE WHERE THEY ARE.
 *
 * `edge` is one of left / right / top / bottom, and `at` is the world point the
 * boundary should now pass through. The moving boundary is measured in the
 * vessel's own frame (so a rotated vessel resizes along its own axes) and the
 * result is normalised: a boundary dragged PAST its opposite collapses the
 * vessel to `MIN_VESSEL_SIDE` rather than turning it inside out, and the
 * rectangle is always stored as a bottom-left anchor with two positive sides.
 *
 * Returns false when the edge is unknown or the vessel cannot be resized.
 */
export function dragVesselEdge(vessel, edge, at) {
	const rect = vesselRect(vessel);

	if (!rect || !finitePoint(at)) {
		return false;
	}

	const local = localOf(rect, at);

	/* The floor is local y = 0; the lid is local y = height. */
	let left = 0;
	let bottom = 0;
	let right = rect.width;
	let top = rect.height;

	switch (edge) {
		case "left":
			left = Math.min(local.x, right - MIN_VESSEL_SIDE);
			break;

		case "right":
			right = Math.max(local.x, left + MIN_VESSEL_SIDE);
			break;

		/* Dragging the lid UP grows the vessel; the floor stays where it is. */
		case "top":
			top = Math.max(local.y, bottom + MIN_VESSEL_SIDE);
			break;

		case "bottom":
			bottom = Math.min(local.y, top - MIN_VESSEL_SIDE);
			break;

		default:
			return false;
	}

	vessel.geometry = {
		...(vessel.geometry || {}),
		/* The anchor is the BOTTOM-LEFT corner. */
		position: worldOf(rect, { x: left, y: bottom }),
		width: right - left,
		height: top - bottom
	};

	followVessel(vessel);

	return true;
}

/* ============================================================
 * THE FLUID LEVEL
 * ============================================================
 *
 * The liquid is part of the VESSEL, so everything it is drawn from is derived
 * here from the tank's own rectangle and one percentage. There is no stored
 * line and no stored region to fall out of step with the tank.
 */

/* The percentage as a number in 0..100 - the one clamp every path uses. */
export function clampFluidPercent(value) {
	const number = Number(value);

	if (!Number.isFinite(number)) {
		return DEFAULT_FLUID_LEVEL_PERCENT;
	}

	return Math.min(100, Math.max(0, number));
}

/* The stored percentage, clamped into 0..100. A missing value is the default. */
export function fluidLevelPercentOf(vessel) {
	const stored = vessel?.engineering?.fluidLevel?.percent;

	if (stored === undefined || stored === null) {
		return DEFAULT_FLUID_LEVEL_PERCENT;
	}

	return clampFluidPercent(stored);
}

/*
 * WHETHER THE LIQUID IS SHOWN.
 *
 * BOTH configurations carry a level - a Reservoir and a Tank alike - and both
 * show it by default. The only thing that hides it is an object that records the
 * level as switched off. The percentage itself is untouched either way, so
 * turning the liquid back on restores the level the student chose.
 */
export function fluidLevelEnabledOf(vessel) {
	const stored = vessel?.engineering?.fluidLevel?.enabled;

	return isVesselType(vessel?.type) && stored !== false;
}

/*
 * THE LIQUID SURFACE, as a segment across the interior.
 *
 * `percent` is the fraction of the INTERNAL height, so the surface follows a
 * resize proportionally, and the segment is built in the vessel's own frame -
 * a rotated tank holds a level across its own width.
 */
export function fluidLevelSegment(vessel) {
	if (!fluidLevelEnabledOf(vessel)) {
		return null;
	}

	const rect = vesselRect(vessel);

	if (!rect) {
		return null;
	}

	const percent = fluidLevelPercentOf(vessel);

	/*
	 * THE RISE IS THE PERCENTAGE OF THE INTERNAL HEIGHT, exactly - 50% is the
	 * true midpoint of any vessel, open or closed.
	 *
	 * AN OPEN RESERVOIR'S 100% IS HELD A HAIR UNDER THE MOUTH. Its mouth is not
	 * a wall, so a surface drawn exactly across it would read as a lid the
	 * reservoir does not have - the open top must survive a full tank. A closed
	 * tank may reach its lid, which is already drawn there.
	 */
	const full = (percent / 100) * rect.height;

	const rise =
		percent >= 100 && vesselStyleOf(vessel) !== VESSEL_STYLES.closed
			? rect.height - fluidLevelHeadroom(vessel)
			: full;

	return interiorSpan(vessel, rise, FLUID_LEVEL_INSET);
}

/*
 * THE LIQUID, as a closed region INSIDE the walls.
 *
 * The surface, down each wall to the floor and back along it - the same two
 * ends the surface line is drawn between, so the fill can never paint through a
 * wall or below the floor. At 0% the region is empty.
 *
 * IN THIS FRAME THE FLOOR IS LOCAL y = 0. A rise climbs UP from there, so the
 * liquid is the band between the floor and the surface - the region BELOW the
 * surface, which is what a fluid level means. The floor is read from the
 * rectangle's own bottom corner rather than recomputed, so the two cannot
 * disagree.
 */
export function fluidLevelRegion(vessel) {
	const segment = fluidLevelSegment(vessel);
	const rect = vesselRect(vessel);

	if (!segment || !rect) {
		return null;
	}

	const percent = fluidLevelPercentOf(vessel);

	if (percent <= 0) {
		return { points: [], empty: true, percent: 0, segment };
	}

	const startLocal = localOf(rect, segment.start);
	const endLocal = localOf(rect, segment.end);

	/* The floor row of the vessel's own frame. */
	const floorStart = worldOf(rect, { x: startLocal.x, y: 0 });
	const floorEnd = worldOf(rect, { x: endLocal.x, y: 0 });

	return {
		points: [segment.start, segment.end, floorEnd, floorStart],
		empty: false,
		percent,
		segment
	};
}

/* Switch the liquid on or off. Returns false for anything but a vessel. */
export function setFluidLevelEnabled(vessel, enabled) {
	if (!isVesselType(vessel?.type)) {
		return false;
	}

	const current = vessel.engineering?.fluidLevel || {};

	vessel.engineering = {
		...(vessel.engineering || {}),
		fluidLevel: {
			...current,
			enabled: Boolean(enabled),
			percent: Number.isFinite(Number(current.percent)) ? clampFluidPercent(current.percent) : DEFAULT_FLUID_LEVEL_PERCENT
		}
	};

	return true;
}

/* Set the surface position. A non-finite value is refused, not rounded. */
export function setFluidLevelPercent(vessel, percent) {
	if (!isVesselType(vessel?.type)) {
		return false;
	}

	const value = Number(percent);

	if (!Number.isFinite(value)) {
		return false;
	}

	vessel.engineering = {
		...(vessel.engineering || {}),
		fluidLevel: {
			...(vessel.engineering?.fluidLevel || {}),
			enabled: vessel.engineering?.fluidLevel?.enabled !== false,
			percent: Math.min(100, Math.max(0, value))
		}
	};

	return true;
}

/*
 * THE LIQUID'S HEADROOM.
 *
 * A surface cannot sit ON a wall: at 0% it rests on the floor (and nothing is
 * filled) and at 100% it sits just under the lid, so a full tank still reads as
 * full rather than as a lid drawn twice. The margin is a distance from the LID,
 * not a shortening of the liquid's rise, so it never distorts a percentage -
 * it only stops the surface from landing on the outline it already has.
 */
export function fluidLevelHeadroom(vessel) {
	const height = vesselRect(vessel)?.height || 0;

	return Math.max(0, Math.min(FLUID_LEVEL_INSET, height / 2 - 0.5));
}

/* ============================================================
 * THE INTERIOR
 * ============================================================
 *
 * A point inside the vessel, or on its mouth (an open reservoir has no top
 * wall, so its interior reaches the top edge).
 */
export function vesselContainsPoint(vessel, point, tolerance = 0) {
	const rect = vesselRect(vessel);

	if (!rect || !finitePoint(point)) {
		return false;
	}

	const local = localOf(rect, point);

	const inside =
		local.x >= -tolerance &&
		local.x <= rect.width + tolerance &&
		local.y >= -tolerance &&
		local.y <= rect.height + tolerance;

	return inside;
}

/* A world point in the vessel's own unrotated frame: (0,0) at its anchor. */
export function localOf(rect, point) {
	const cos = Math.cos(-rect.rotation);
	const sin = Math.sin(-rect.rotation);

	const dx = point.x - rect.position.x;
	const dy = point.y - rect.position.y;

	return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}

/* The local point back in the drawing. */
export function worldOf(rect, local) {
	const cos = Math.cos(rect.rotation);
	const sin = Math.sin(rect.rotation);

	return {
		x: rect.position.x + local.x * cos - local.y * sin,
		y: rect.position.y + local.x * sin + local.y * cos
	};
}

/*
 * THE FLUID LEVEL'S OWN LINE INSIDE THE VESSEL.
 *
 * Given a height above the vessel's FLOOR (in drawing units) and a horizontal
 * inset, this is the segment a level marker spans: from just inside one wall to
 * just inside the other, never through the walls.
 *
 * A RISE IS A LOCAL Y. The vessel's frame has its origin at the BOTTOM-LEFT
 * corner and grows upward, like the canvas itself, so a height above the floor
 * needs no conversion at all: it IS the local y. (Measuring it the other way -
 * from the lid, as an earlier version did - is what drew the surface and the
 * liquid mirrored about the tank.)
 */
export function interiorSpan(vessel, heightAboveBottom, inset = 0) {
	const rect = vesselRect(vessel);

	if (!rect) {
		return null;
	}

	/*
	 * A RISE IS NEVER CLAMPED AWAY FROM ITS PERCENTAGE. The only bound is the
	 * vessel itself (0..height): a 50% surface is the true midpoint of ANY size,
	 * not half a unit short of it. 0% rests exactly on the floor.
	 */
	const rise = Number(heightAboveBottom) || 0;

	const height = Math.min(rect.height, Math.max(0, rise));

	const pad = Math.min(inset, rect.width / 2 - 0.5);

	return {
		start: worldOf(rect, { x: pad, y: height }),
		end: worldOf(rect, { x: rect.width - pad, y: height }),
		height
	};
}

/* The height above the FLOOR nearest a world point, clamped to the vessel. */
export function heightAtPoint(vessel, point) {
	const rect = vesselRect(vessel);

	if (!rect || !finitePoint(point)) {
		return null;
	}

	const local = localOf(rect, point);

	return Math.min(rect.height - 0.5, Math.max(0.5, local.y));
}

/* ============================================================
 * ATTACHMENT
 * ============================================================ */

/*
 * WHERE A POINT MEETS THE VESSEL'S OUTLINE, if it does.
 *
 * Returns `{ point, edge, t }` where `edge` names the side ("left", "bottom",
 * "right", "top") and `t` is the fraction along it. This is what makes a pipe
 * endpoint dropped on the wall a DELIBERATE attachment: the caller has placed
 * the end there on purpose, and the vessel is asked whether that point is on it.
 */
export function outlineAttachment(vessel, point, tolerance = 0) {
	const rect = vesselRect(vessel);

	if (!rect || !finitePoint(point)) {
		return null;
	}

	const sides = [
		{ name: "left", start: rect.corners[0], end: rect.corners[3] },
		{ name: "bottom", start: rect.corners[3], end: rect.corners[2] },
		{ name: "right", start: rect.corners[2], end: rect.corners[1] }
	];

	if (vesselStyleOf(vessel) === VESSEL_STYLES.closed) {
		sides.push({ name: "top", start: rect.corners[1], end: rect.corners[0] });
	}

	let best = null;

	sides.forEach((side) => {
		const distance = distanceToSegment(point, side.start, side.end);

		if (distance > tolerance) {
			return;
		}

		const projection = projectOntoLine(point, side.start, side.end);

		if (!best || distance < best.distance) {
			best = {
				edge: side.name,
				t: projection ? Math.min(1, Math.max(0, projection.t)) : 0,
				point: projection ? projection.foot : { x: point.x, y: point.y },
				distance
			};
		}
	});

	return best;
}

/* Whether a pipe's centreline merely CROSSES the vessel (never an attachment). */
export function crossesVessel(vessel, run) {
	const start = run?.geometry?.start;
	const end = run?.geometry?.end;

	if (!finitePoint(start) || !finitePoint(end)) {
		return false;
	}

	return vesselSegments(vessel).some((side) => Boolean(segmentIntersection(start, end, side.start, side.end)));
}

/*
 * FOLLOW THE VESSEL.
 *
 * Called after the vessel moves, turns or is resized. Everything attached to it
 * is put back where it belongs: a pipe's held end is re-seated on the wall it
 * was attached to, and a Fluid Level is re-seated at the same PERCENTAGE of the
 * usable interior, so a half-full tank stays half full when it grows.
 *
 * The level is re-seated through its own `refreshFluidLevel`, which owns the
 * one derivation from (vessel, percentage) to a line and a fill region. This
 * function therefore carries the level; it does not compute it a second way.
 */
export function followVessel(vessel, objects = null) {
	const rect = vesselRect(vessel);

	if (!rect) {
		return false;
	}

	const list = vesselObjectList(objects);

	if (!Array.isArray(list)) {
		return false;
	}

	const id = vessel.id;

	/*
	 * AN OBJECT WITH NO ID IS NOT "THE VESSEL". `undefined === undefined` is
	 * true, so comparing the ids directly skipped every un-identified object on
	 * the sheet - including the pipe being re-seated - and a resize silently
	 * left it behind. The vessel is skipped by IDENTITY, and by id only when
	 * there is one.
	 */
	list.forEach((object) => {
		if (!object || object === vessel || (id !== undefined && object.id === id)) {
			return;
		}

		/* A pipe attached at one end follows the wall it was attached to. */
		if (object.type === "pipe-duct" && object.engineering?.vesselId === id) {
			const port = object.engineering?.vesselPort;

			if (port !== "start" && port !== "end") {
				return;
			}

			const stored = object.engineering?.vesselLocal;

			const local =
				stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)
					? stored
					: null;

			/*
			 * THE WALL THE PIPE WAS HELD ON MAY BE GONE. An open reservoir has no top
			 * line, so a pipe attached to the lid of a tank that has just been
			 * switched to a reservoir has nothing left to hold it: it lets go and
			 * stays exactly where it was drawn.
			 *
			 * `vesselLocal` is in the vessel's own frame, whose origin is the
			 * BOTTOM-LEFT corner and whose y grows UPWARD - so the lid is the row at
			 * y = height, and the floor is y = 0.
			 */
			if (vesselStyleOf(vessel) !== VESSEL_STYLES.closed && local && local.y >= rect.height - 1e-6) {
				releaseAttachment(object);

				return;
			}

			if (local) {
				/*
				 * A PIPE HELD ON A WALL FOLLOWS THAT WALL. The side walls are the
				 * vessel's full width, so their ends move to the new width; the
				 * floor and lid keep their own row. A pipe attached anywhere else on
				 * an edge (an older file, with no recorded wall) is clamped inside
				 * the new box.
				 */
				const edge = object.engineering?.vesselEdge;

				const x =
					edge === "left"
						? 0
						: edge === "right"
							? rect.width
							: Math.min(rect.width, Math.max(0, local.x));

				const y =
					edge === "bottom"
						? 0
						: edge === "top"
							? rect.height
							: Math.min(rect.height, Math.max(0, local.y));

				object.geometry = {
					...object.geometry,
					[port]: worldOf(rect, { x, y })
				};
			}
		}

		/*
		 * A level follows the vessel it belongs to, AT THE SAME PERCENTAGE.
		 *
		 * The re-seat goes through the level model's own `refreshFluidLevel`, so
		 * the line and the fill region are derived in the one place that knows
		 * how - a resize carries the level proportionally without a second copy
		 * of the arithmetic here.
		 */
		if (object.type === "fluid-level" && object.engineering?.vesselId === id) {
			object.engineering = {
				...(object.engineering || {}),
				vesselHeight: rect.height
			};

			if (typeof levelRefresher === "function") {
				levelRefresher(object, list);
			}
		}
	});

	return true;
}

/* Forget a pipe's attachment to a vessel, leaving the pipe where it was drawn. */
function releaseAttachment(run) {
	if (!run?.engineering?.vesselId) {
		return;
	}

	const { vesselId, vesselPort, vesselLocal, ...rest } = run.engineering;

	void vesselId;
	void vesselPort;
	void vesselLocal;

	run.engineering = rest;

	if (run.parentId) {
		delete run.parentId;
	}
}

/*
 * Remember where on the wall a pipe was attached, so it can follow.
 *
 * The stored point is in the vessel's own frame, and it records WHICH WALL the
 * end landed on (`vesselEdge`). A pipe on the RIGHT wall sits at the vessel's
 * full width, so widening the vessel must carry its end to the new wall - a bare
 * local x would stay where it was and leave the pipe ending in mid-air, short
 * of the wall it was attached to.
 */
export function recordPipeAttachment(vessel, run, port, at) {
	const rect = vesselRect(vessel);

	if (!rect || !run || !finitePoint(at) || (port !== "start" && port !== "end")) {
		return false;
	}

	const attachment = outlineAttachment(vessel, at, 1e-6);

	run.engineering = {
		...(run.engineering || {}),
		vesselId: vessel.id,
		vesselPort: port,
		vesselLocal: localOf(rect, at),
		...(attachment ? { vesselEdge: attachment.edge } : {})
	};

	/* The pipe hangs off the vessel for deletion purposes, like an arrow does. */
	run.parentId = vessel.id;

	return true;
}

/* ============================================================
 * CREATION AND EDIT
 * ============================================================ */

export function createVessel(options = {}) {
	const position = finitePoint(options.position) ? { ...options.position } : null;

	const width = Math.abs(Number(options.width));
	const height = Math.abs(Number(options.height));

	if (!position || !(width > 0) || !(height > 0)) {
		return null;
	}

	const style = options.vesselStyle === VESSEL_STYLES.closed ? VESSEL_STYLES.closed : VESSEL_STYLES.open;

	return enggDrawingState.createGeometryObject(
		RESERVOIR_TYPE,
		{
			/* The anchor is the BOTTOM-LEFT corner; the height rises from it. */
			position,
			width,
			height,
			rotation: Number(options.rotation) || 0
		},
		{
			...options,
			engineering: {
				/*
				 * EVERY VESSEL CARRIES A LIQUID, from the moment it exists - a
				 * Reservoir and a Tank alike. It starts at the default percentage
				 * (50%), so the level line is there immediately and the student only
				 * has to move it.
				 */
				...(options.engineering || {}),
				vesselStyle: style,
				fluidLevel: {
					enabled: options.engineering?.fluidLevel?.enabled !== false,
					percent: Number.isFinite(Number(options.engineering?.fluidLevel?.percent))
						? Math.min(100, Math.max(0, Number(options.engineering.fluidLevel.percent)))
						: DEFAULT_FLUID_LEVEL_PERCENT
				}
			}
		}
	);
}

/*
 * Build a vessel from the two corners of a drag, IN ANY DIRECTION.
 *
 * THE BOX IS NORMALISED, THEN NAMED IN WORLD TERMS. The smaller x is the left
 * wall and the larger the right; the smaller y is the FLOOR and the larger the
 * LID, because world y grows upward (the renderer flips it into screen y).
 *
 * The stored anchor is the BOTTOM-LEFT corner - the left wall and the floor - so
 * every drag direction yields the same upright vessel. A drag from top-right to
 * bottom-left and a drag from bottom-left to top-right over the same two points
 * therefore produce byte-identical geometry.
 */
export function vesselFromDrag(from, to, options = {}) {
	if (!finitePoint(from) || !finitePoint(to)) {
		return null;
	}

	const fromX = Number(from.x);
	const fromY = Number(from.y);
	const toX = Number(to.x);
	const toY = Number(to.y);

	const left = Math.min(fromX, toX);
	const right = Math.max(fromX, toX);

	/* World y grows UP, so the smaller y is the floor and the larger is the lid. */
	const floor = Math.min(fromY, toY);
	const lid = Math.max(fromY, toY);

	const width = right - left;
	const height = lid - floor;

	if (width < MIN_VESSEL_SIDE || height < MIN_VESSEL_SIDE) {
		return null;
	}

	return createVessel({
		...options,
		position: { x: left, y: floor },
		width,
		height
	});
}

/*
 * Resize by a size, refusing one that would collapse a side.
 *
 * A NEGATIVE size is a vessel that grew the other way: it is normalised here -
 * the side's magnitude and the anchor moved to the far side - so the stored
 * rectangle is always a BOTTOM-LEFT anchor with two positive sides, whatever a
 * handle drag, a Features field or a source edit produced.
 */
export function resizeVessel(vessel, width, height, objects = null) {
	if (!isVesselType(vessel?.type)) {
		return false;
	}

	const w = Number(width);
	const h = Number(height);

	if (!Number.isFinite(w) || !Number.isFinite(h) || !(Math.abs(w) >= MIN_VESSEL_SIDE) || !(Math.abs(h) >= MIN_VESSEL_SIDE)) {
		return false;
	}

	const rect = vesselRect(vessel);

	const position = rect ? { ...rect.position } : { ...vessel.geometry.position };

	if (rect) {
		/* A negative width grows to the LEFT, so the anchor moves left. */
		if (w < 0) {
			const shifted = worldOf(rect, { x: -Math.abs(w), y: 0 });

			position.x = shifted.x;
			position.y = shifted.y;
		}

		/* A negative height grows DOWNWARD, so the anchor moves down. */
		if (h < 0) {
			const shifted = worldOf(rect, { x: 0, y: -Math.abs(h) });

			position.x = shifted.x;
			position.y = shifted.y;
		}
	}

	vessel.geometry = { ...vessel.geometry, position, width: Math.abs(w), height: Math.abs(h) };

	/*
	 * EVERYTHING ATTACHED FOLLOWS. A typed width or height is the same edit as a
	 * dragged handle, so the pipe ends and the levels are re-seated the same way -
	 * in one operation, wherever the resize came from.
	 */
	followVessel(vessel, vesselObjectList(objects));

	return true;
}

/*
 * SWITCH BETWEEN A RESERVOIR AND A TANK.
 *
 * The same object: only the outline changes (a tank has a top, a reservoir does
 * not), so the id, the name, the style, the position and everything attached
 * survive. A pipe held on the top wall of a tank is released when the top opens
 * into a reservoir's mouth, because there is no longer a wall there to hold it.
 */
export function setVesselStyle(vessel, style, objects = null) {
	if (!isVesselType(vessel?.type) || !Object.values(VESSEL_STYLES).includes(style)) {
		return false;
	}

	vessel.engineering = { ...(vessel.engineering || {}), vesselStyle: style };

	followVessel(vessel, vesselObjectList(objects));

	return true;
}

export function defaultVesselSize() {
	return { width: DEFAULT_VESSEL_WIDTH, height: DEFAULT_VESSEL_HEIGHT };
}

/*
 * WHERE THE FLUID-LEVEL HANDLE IS.
 *
 * It sits on the SURFACE LINE, just inside its RIGHT end - the conventional
 * place for a level mark, and clear of the middle of the vessel where a body
 * drag begins. Its position is derived from the level, so a resize, a percentage
 * edit and a handle drag all agree without a stored copy.
 */
/*
 * WHERE THE FLUID-LEVEL HANDLE IS.
 *
 * It sits on the SURFACE LINE, just inside its RIGHT end - the conventional
 * place for a level mark, and clear of the middle of the vessel where a body
 * drag begins. Its position is derived from the level, so a resize, a percentage
 * edit and a handle drag all agree without a stored copy.
 */
export function vesselLevelHandle(vessel) {
	const segment = fluidLevelSegment(vessel);

	if (!segment) {
		return null;
	}

	return { kind: "vessel-level", point: { x: segment.end.x, y: segment.end.y } };
}

/*
 * MOVE THE SURFACE TO A WORLD ROW, keeping the vessel where it is.
 *
 * This is the ONE operation the level handle performs: the pointer's height
 * above the FLOOR becomes the percentage, so dragging up fills the tank and
 * dragging down empties it, and the vessel itself is never touched. A resize can
 * therefore never be triggered by a level drag, and the field in the Features
 * tab writes the same number.
 */
export function dragVesselLevel(vessel, at) {
	const rect = vesselRect(vessel);

	if (!rect || !finitePoint(at) || !(rect.height > 0)) {
		return false;
	}

	const height = heightAtPoint(vessel, at);

	if (height === null) {
		return false;
	}

	return setFluidLevelPercent(vessel, (height / rect.height) * 100);
}

/* The description the Features panel and the writer read. */
export function describeVessel(vessel) {
	const rect = vesselRect(vessel);

	return {
		style: vesselStyleOf(vessel),
		width: rect ? rect.width : 0,
		height: rect ? rect.height : 0,
		rotation: rect ? (rect.rotation * 180) / Math.PI : 0,
		corners: rect ? rect.corners : [],
		centre: rect ? rect.centre : null
	};
}

const enggVessel = {
	RESERVOIR_TYPE,
	VESSEL_STYLES,
	VESSEL_STYLE_LABELS,
	MIN_VESSEL_SIDE,
	setVesselLevelRefresher,
	setVesselObjectProvider,
	vesselObjectList,
	isVesselType,
	vesselStyleOf,
	vesselRect,
	vesselSegments,
	vesselOutline,
	vesselEdgeHandles,
	dragVesselEdge,
	vesselContainsPoint,
	localOf,
	worldOf,
	interiorSpan,
	heightAtPoint,
	outlineAttachment,
	crossesVessel,
	followVessel,
	recordPipeAttachment,
	createVessel,
	vesselFromDrag,
	resizeVessel,
	setVesselStyle,
	defaultVesselSize,
	vesselLevelHandle,
	dragVesselLevel,
	VESSEL_CONFIGURATION_LABELS,
	DEFAULT_FLUID_LEVEL_PERCENT,
	FLUID_LEVEL_INSET,
	FLUID_LEVEL_DEFAULT_FILL,
	FLUID_LEVEL_DEFAULT_OPACITY,
	fluidLevelPercentOf,
	fluidLevelEnabledOf,
	fluidLevelSegment,
	fluidLevelRegion,
	fluidLevelHeadroom,
	clampFluidPercent,
	setFluidLevelEnabled,
	setFluidLevelPercent
};

export default enggVessel;
