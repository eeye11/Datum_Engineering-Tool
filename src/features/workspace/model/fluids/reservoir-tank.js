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
	rectangleCentre,
	rectangleCorners,
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

export function setVesselLevelRefresher(refresh) {
  levelRefresher = typeof refresh === "function" ? refresh : null;
}

export function isVesselType(type) {
  return type === RESERVOIR_TYPE;
}

export function vesselStyleOf(vessel) {
	return vessel?.engineering?.vesselStyle === VESSEL_STYLES.closed ? VESSEL_STYLES.closed : VESSEL_STYLES.open;
}

/* The rectangle a vessel stores, normalised so its sides are positive. */
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

	return {
		position: { x: position.x, y: position.y },
		width,
		height,
		rotation,
		corners: rectangleCorners(position, width, height, rotation),
		centre: rectangleCentre(position, width, height, rotation)
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
 */
export function vesselSegments(vessel) {
	const rect = vesselRect(vessel);

	if (!rect) {
		return [];
	}

	const [topLeft, topRight, bottomRight, bottomLeft] = rect.corners;

	const sides = [
		{ start: topLeft, end: bottomLeft },
		{ start: bottomLeft, end: bottomRight },
		{ start: bottomRight, end: topRight }
	];

	if (vesselStyleOf(vessel) === VESSEL_STYLES.closed) {
		sides.push({ start: topRight, end: topLeft });
	}

	return sides;
}

/* The outline as one polyline, in drawing order. */
export function vesselOutline(vessel) {
	const rect = vesselRect(vessel);

	if (!rect) {
		return [];
	}

	const closed = vesselStyleOf(vessel) === VESSEL_STYLES.closed;

	return closed ? rect.corners : [rect.corners[0], rect.corners[3], rect.corners[2], rect.corners[1]];
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
 * Given a height above the vessel's bottom (in world units) and a horizontal
 * inset, this is the segment a level marker spans: from just inside one wall to
 * just inside the other, never through the walls.
 */
export function interiorSpan(vessel, heightAboveBottom, inset = 0) {
	const rect = vesselRect(vessel);

	if (!rect) {
		return null;
	}

	const height = Math.min(rect.height - 0.5, Math.max(0.5, Number(heightAboveBottom) || 0));

	const pad = Math.min(inset, rect.width / 2 - 0.5);

	const y = rect.height - height;

	return {
		start: worldOf(rect, { x: pad, y }),
		end: worldOf(rect, { x: rect.width - pad, y }),
		height
	};
}

/* The height above the bottom nearest a world point, clamped to the vessel. */
export function heightAtPoint(vessel, point) {
	const rect = vesselRect(vessel);

	if (!rect || !finitePoint(point)) {
		return null;
	}

	const local = localOf(rect, point);

	return Math.min(rect.height - 0.5, Math.max(0.5, rect.height - local.y));
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

	const list = Array.isArray(objects) ? objects : null;

	if (!list) {
		return false;
	}

	const id = vessel.id;

	list.forEach((object) => {
		if (!object || object.id === id) {
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

			if (local) {
				object.geometry = {
					...object.geometry,
					[port]: worldOf(rect, {
						x: Math.min(rect.width, Math.max(0, local.x)),
						y: Math.min(rect.height, Math.max(0, local.y))
					})
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

/* Remember where on the wall a pipe was attached, so it can follow. */
export function recordPipeAttachment(vessel, run, port, at) {
	const rect = vesselRect(vessel);

	if (!rect || !run || !finitePoint(at) || (port !== "start" && port !== "end")) {
		return false;
	}

	run.engineering = {
		...(run.engineering || {}),
		vesselId: vessel.id,
		vesselPort: port,
		vesselLocal: localOf(rect, at)
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

	return enggDrawingState.createGeometryObject(
		RESERVOIR_TYPE,
		{
			position,
			width,
			height,
			rotation: Number(options.rotation) || 0
		},
		{
			...options,
			engineering: {
				vesselStyle: options.vesselStyle === VESSEL_STYLES.closed ? VESSEL_STYLES.closed : VESSEL_STYLES.open
			}
		}
	);
}

/* Build a vessel from the two corners of a drag, in either direction. */
export function vesselFromDrag(from, to, options = {}) {
	if (!finitePoint(from) || !finitePoint(to)) {
		return null;
	}

	const width = Math.abs(to.x - from.x);
	const height = Math.abs(to.y - from.y);

	if (width < MIN_VESSEL_SIDE || height < MIN_VESSEL_SIDE) {
		return null;
	}

	return createVessel({
		...options,
		position: { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y) },
		width,
		height
	});
}

/* Resize by a size, refusing one that would collapse a side. */
export function resizeVessel(vessel, width, height) {
	const w = Number(width);
	const h = Number(height);

	if (!isVesselType(vessel?.type) || !(w >= MIN_VESSEL_SIDE) || !(h >= MIN_VESSEL_SIDE)) {
		return false;
	}

	vessel.geometry = { ...vessel.geometry, width: w, height: h };

	return true;
}

export function setVesselStyle(vessel, style) {
	if (!isVesselType(vessel?.type) || !Object.values(VESSEL_STYLES).includes(style)) {
		return false;
	}

	vessel.engineering = { ...(vessel.engineering || {}), vesselStyle: style };

	return true;
}

export function defaultVesselSize() {
	return { width: DEFAULT_VESSEL_WIDTH, height: DEFAULT_VESSEL_HEIGHT };
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
	isVesselType,
	vesselStyleOf,
	vesselRect,
	vesselSegments,
	vesselOutline,
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
	describeVessel
};

export default enggVessel;
