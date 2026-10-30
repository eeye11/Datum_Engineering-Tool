/*
 * ========================================================
 * PRESSURE PROFILE
 * ========================================================
 *
 * A graph the student FILLS IN. It is a plotting frame plus a table of
 * position/pressure pairs, and it computes nothing:
 *
 *   engineering.points       [{ position, pressure }] - the student's OWN rows
 *   engineering.axes         titles, units and the four limits
 *   engineering.grid         whether the grid is drawn
 *   engineering.pointsShown  whether the data markers are drawn
 *   geometry.position        the frame's anchor (its bottom-left corner)
 *   geometry.width / height  the frame's size, in drawing units
 *
 * ========================================================
 * TWO COORDINATE SYSTEMS, ONE MAPPING
 * ========================================================
 *
 * A data row is in ENGINEERING units (a station in m, a pressure in kPa). The
 * frame is in DRAWING units. `dataToDrawing` is the one mapping between them,
 * and `drawingToData` its inverse - so dragging a plotted point writes the right
 * row, and typing a row moves the right point, without either of them doing the
 * arithmetic a second way.
 *
 * The mapping uses EXPLICIT axis limits, which the student can type. The
 * automatic limits only ever SET those values (see `autoLimits`), never bypass
 * them - so what is on the axes is what is in the fields.
 *
 * ========================================================
 * NOT A SOLVER
 * ========================================================
 *
 * DAETUM never interpolates, smooths or invents a point. The line is drawn
 * through the rows as they are, straight from one to the next, and an empty
 * table draws an empty graph.
 */

import enggDrawingState from "../../../../shared/model/drawing-state.js";
import {
  DEFAULT_PROFILE_HEIGHT,
  DEFAULT_PROFILE_WIDTH,
  finitePoint,
  finiteNumber
} from "./fluids-shared.js";

/* The shared clamp, used by the axis readers below. */
void finiteNumber;

export const PRESSURE_PROFILE_TYPE = "pressure-profile";

export const MIN_PROFILE_SIDE = 6;
export const MAX_PROFILE_POINTS = 200;

export const DEFAULT_AXES = Object.freeze({
	xTitle: "Position",
	xUnit: "m",
	yTitle: "Pressure",
	yUnit: "kPa",
	xMin: 0,
	xMax: 100,
	yMin: 0,
	yMax: 100
});

/* The share of the frame the axes' plot area occupies, leaving room for titles. */
export const PLOT_INSET = Object.freeze({ left: 0.14, right: 0.05, top: 0.08, bottom: 0.14 });

export function isPressureProfileType(type) {
	return type === PRESSURE_PROFILE_TYPE;
}

/* The four limits, normalised so min < max. */
export function axesOf(profile) {
	const axes = profile?.engineering?.axes || {};

	const min = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
	const span = (low, high, fallbackLow, fallbackHigh) =>
		high > low ? { low, high } : { low: fallbackLow, high: fallbackHigh };

	const x = span(min(axes.xMin, DEFAULT_AXES.xMin), min(axes.xMax, DEFAULT_AXES.xMax), 0, 100);
	const y = span(min(axes.yMin, DEFAULT_AXES.yMin), min(axes.yMax, DEFAULT_AXES.yMax), 0, 100);

	return {
		xTitle: String(axes.xTitle ?? DEFAULT_AXES.xTitle),
		xUnit: String(axes.xUnit ?? DEFAULT_AXES.xUnit),
		yTitle: String(axes.yTitle ?? DEFAULT_AXES.yTitle),
		yUnit: String(axes.yUnit ?? DEFAULT_AXES.yUnit),
		xMin: x.low,
		xMax: x.high,
		yMin: y.low,
		yMax: y.high
	};
}

/* The student's rows, as finite numbers only. */
export function dataPointsOf(profile) {
	const rows = Array.isArray(profile?.engineering?.points) ? profile.engineering.points : [];

	return rows
		.map((row) => ({
			position: Number(row?.position),
			pressure: Number(row?.pressure)
		}))
		.filter((row) => Number.isFinite(row.position) && Number.isFinite(row.pressure));
}

export function showGridOf(profile) {
	return profile?.engineering?.grid !== false;
}

export function showPointsOf(profile) {
	return profile?.engineering?.pointsShown !== false;
}

/* ============================================================
 * THE FRAME
 * ============================================================ */

export function profileFrame(profile) {
	const position = profile?.geometry?.position;

	if (!finitePoint(position)) {
		return null;
	}

	const width = Math.abs(Number(profile.geometry.width));
	const height = Math.abs(Number(profile.geometry.height));

	if (!(width > 0) || !(height > 0)) {
		return null;
	}

	return { position: { x: position.x, y: position.y }, width, height };
}

/* The plot area's four corners inside the frame. */
export function plotArea(profile) {
	const frame = profileFrame(profile);

	if (!frame) {
		return null;
	}

	const left = frame.position.x + frame.width * PLOT_INSET.left;
	const right = frame.position.x + frame.width * (1 - PLOT_INSET.right);
	const bottom = frame.position.y + frame.height * PLOT_INSET.bottom;
	const top = frame.position.y + frame.height * (1 - PLOT_INSET.top);

	return {
		left,
		right,
		bottom,
		top,
		width: right - left,
		height: top - bottom,
		origin: { x: left, y: bottom },
		xEnd: { x: right, y: bottom },
		yEnd: { x: left, y: top }
	};
}

/* ============================================================
 * DATA <-> DRAWING
 * ============================================================ */

export function dataToDrawing(profile, row) {
	const area = plotArea(profile);
	const axes = axesOf(profile);

	if (!area) {
		return null;
	}

	const fx = (Number(row.position) - axes.xMin) / (axes.xMax - axes.xMin);
	const fy = (Number(row.pressure) - axes.yMin) / (axes.yMax - axes.yMin);

	return {
		x: area.left + fx * area.width,
		y: area.bottom + fy * area.height
	};
}

export function drawingToData(profile, point) {
	const area = plotArea(profile);
	const axes = axesOf(profile);

	if (!area || !finitePoint(point)) {
		return null;
	}

	return {
		position: axes.xMin + ((point.x - area.left) / area.width) * (axes.xMax - axes.xMin),
		pressure: axes.yMin + ((point.y - area.bottom) / area.height) * (axes.yMax - axes.yMin)
	};
}

/* The plotted points, in drawing coordinates, from the rows. */
export function plottedPoints(profile) {
	return dataPointsOf(profile)
		.map((row, index) => {
			const at = dataToDrawing(profile, row);

			return at ? { ...at, index, row } : null;
		})
		.filter(Boolean);
}

/* The tick values of one axis: five even stops, including both limits. */
export function ticksFor(low, high, count = 4) {
	const span = high - low;

	return Array.from({ length: count + 1 }, (_, index) => low + (span * index) / count);
}

/* ============================================================
 * EDITING THE DATA
 * ============================================================ */

export function addPoint(profile, row = null) {
	const rows = Array.isArray(profile?.engineering?.points) ? profile.engineering.points : [];

	if (rows.length >= MAX_PROFILE_POINTS) {
		return false;
	}

	const axes = axesOf(profile);

	const next =
		row && Number.isFinite(Number(row.position)) && Number.isFinite(Number(row.pressure))
			? { position: Number(row.position), pressure: Number(row.pressure) }
			: {
					/* A NEW ROW IS A REAL ROW, not an invented data point: it is the
					 * next even station and the middle of the pressure range, and the
					 * student changes both. */
					position: rows.length
						? Math.min(axes.xMax, Number(rows[rows.length - 1].position) + (axes.xMax - axes.xMin) / 4)
						: axes.xMin,
					pressure: (axes.yMin + axes.yMax) / 2
				};

	profile.engineering = {
		...(profile.engineering || {}),
		points: [...rows.map((entry) => ({ position: Number(entry.position), pressure: Number(entry.pressure) })), next]
	};

	return true;
}

export function removePoint(profile, index) {
	const rows = Array.isArray(profile?.engineering?.points) ? profile.engineering.points : [];
	const at = Number(index);

	if (!Number.isInteger(at) || at < 0 || at >= rows.length) {
		return false;
	}

	profile.engineering = {
		...(profile.engineering || {}),
		points: rows.filter((_, position) => position !== at).map((entry) => ({ ...entry }))
	};

	return true;
}

export function setPoint(profile, index, patch = {}) {
	const rows = Array.isArray(profile?.engineering?.points) ? profile.engineering.points : [];
	const at = Number(index);

	if (!Number.isInteger(at) || at < 0 || at >= rows.length) {
		return false;
	}

	const next = [...rows];

	next[at] = {
		position: Number.isFinite(Number(patch.position)) ? Number(patch.position) : Number(rows[at].position),
		pressure: Number.isFinite(Number(patch.pressure)) ? Number(patch.pressure) : Number(rows[at].pressure)
	};

	profile.engineering = { ...(profile.engineering || {}), points: next };

	return true;
}

export function setAxes(profile, patch = {}) {
	const axes = axesOf(profile);

	const next = {
		...axes,
		...Object.fromEntries(
			Object.entries(patch).filter(([key]) => Object.hasOwn(axes, key))
		)
	};

	/* Text fields are text; the four limits are numbers and must stay a range. */
	["xTitle", "xUnit", "yTitle", "yUnit"].forEach((key) => {
		next[key] = String(next[key] ?? "");
	});

	["xMin", "xMax", "yMin", "yMax"].forEach((key) => {
		const value = Number(next[key]);

		next[key] = Number.isFinite(value) ? value : axes[key];
	});

	if (next.xMax <= next.xMin || next.yMax <= next.yMin) {
		return false;
	}

	profile.engineering = { ...(profile.engineering || {}), axes: next };

	return true;
}

/*
 * SET THE LIMITS TO FIT THE DATA - a convenience, never an automatic scale.
 *
 * It writes the four fields, so the student sees what it did and can edit it.
 * An empty table leaves the limits alone.
 */
export function autoLimits(profile) {
	const rows = dataPointsOf(profile);

	if (!rows.length) {
		return false;
	}

	const xs = rows.map((row) => row.position);
	const ys = rows.map((row) => row.pressure);

	const pad = (values) => {
		const low = Math.min(...values);
		const high = Math.max(...values);
		const span = high - low || Math.abs(high) || 1;

		return { low: low - span * 0.05, high: high + span * 0.05 };
	};

	const x = pad(xs);
  const y = pad(ys);

	return setAxes(profile, { xMin: x.low, xMax: x.high, yMin: y.low, yMax: y.high });
}

/* ============================================================
 * CREATION
 * ============================================================ */

export function createPressureProfile(options = {}) {
	const position = finitePoint(options.position) ? { ...options.position } : null;

	const width = Number(options.width) || DEFAULT_PROFILE_WIDTH;
	const height = Number(options.height) || DEFAULT_PROFILE_HEIGHT;

	if (!position) {
		return null;
	}

	return enggDrawingState.createGeometryObject(
		PRESSURE_PROFILE_TYPE,
		{
			position,
			width: Math.abs(width),
			height: Math.abs(height)
		},
		{
			...options,
			engineering: {
				points: Array.isArray(options.points)
					? options.points.map((row) => ({ position: Number(row.position), pressure: Number(row.pressure) }))
					: [],
				axes: { ...DEFAULT_AXES, ...(options.axes || {}) },
				grid: options.grid !== false,
				pointsShown: options.pointsShown !== false
			}
		}
	);
}

/* A profile from the two corners of a drag, in either direction. */
export function profileFromDrag(from, to, options = {}) {
	if (!finitePoint(from) || !finitePoint(to)) {
		return null;
	}

	const width = Math.abs(to.x - from.x);
	const height = Math.abs(to.y - from.y);

	if (width < MIN_PROFILE_SIDE || height < MIN_PROFILE_SIDE) {
		return null;
	}

	return createPressureProfile({
		...options,
		position: { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y) },
		width,
		height
	});
}

export function resizeProfile(profile, width, height) {
	const w = Number(width);
	const h = Number(height);

	if (!isPressureProfileType(profile?.type) || !(w >= MIN_PROFILE_SIDE) || !(h >= MIN_PROFILE_SIDE)) {
		return false;
	}

	profile.geometry = { ...profile.geometry, width: w, height: h };

	return true;
}

/* The graph's own name, shown on the frame when the student sets one. */
export function graphNameOf(profile) {
	return String(profile?.engineering?.graphName ?? "");
}

export function setGraphName(profile, name) {
	profile.engineering = { ...(profile.engineering || {}), graphName: String(name ?? "") };

	return true;
}

const enggPressureProfile = {
	PRESSURE_PROFILE_TYPE,
	MIN_PROFILE_SIDE,
	MAX_PROFILE_POINTS,
	DEFAULT_AXES,
	PLOT_INSET,
	isPressureProfileType,
	axesOf,
	dataPointsOf,
	showGridOf,
	showPointsOf,
	profileFrame,
	plotArea,
	dataToDrawing,
	drawingToData,
	plottedPoints,
	ticksFor,
	addPoint,
	removePoint,
	setPoint,
	setAxes,
	autoLimits,
	createPressureProfile,
	profileFromDrag,
	resizeProfile,
	graphNameOf,
	setGraphName
};

export default enggPressureProfile;
