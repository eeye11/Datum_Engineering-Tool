/* Inline taper widths derive from the connected Pipe / Duct objects. */

import enggDrawingState from "../../../../shared/model/drawing-state.js";
import enggPipeDuct from "./pipe-duct.js";
import { propagatePipeWidth } from "./pipe-width.js";
import { drawingState } from "../../editor-state.js";
import {
	DEFAULT_TRANSITION_LENGTH,
	finitePoint,
	normalOf,
	pointAlong,
	unitVector
} from "./fluids-shared.js";

export const REDUCER_TYPE = "reducer-expander";

export const REDUCER_MODES = Object.freeze({
	reduce: "reduce",
	expand: "expand"
});

export const REDUCER_MODE_LABELS = Object.freeze({
	reduce: "Reducer",
	expand: "Expander"
});

/* The shortest taper that is still a taper rather than a step. */
export const MIN_TRANSITION_LENGTH = 1;

export function isReducerType(type) {
	return type === REDUCER_TYPE;
}

export function normaliseMode(mode) {
	return mode === REDUCER_MODES.expand ? REDUCER_MODES.expand : REDUCER_MODES.reduce;
}

export function transitionLengthOf(reducer) {
	const value = Number(reducer?.engineering?.transitionLength);

	return Number.isFinite(value) && value >= MIN_TRANSITION_LENGTH ? value : DEFAULT_TRANSITION_LENGTH;
}

/* The two pipe ids the fitting joins, in axis order: [startSide, endSide]. */
export function connectedPipeIds(reducer) {
	const engineering = reducer?.engineering || {};

	return [engineering.startPipeId || null, engineering.endPipeId || null];
}

/* Which end of each connected segment the fitting holds: { start, end }. */
export function portsOf(reducer) {
	const ports = reducer?.engineering?.ports;

	return {
		start: ports?.start === "start" || ports?.start === "end" ? ports.start : "end",
		end: ports?.end === "start" || ports?.end === "end" ? ports.end : "start"
	};
}

/*
 * The fitting's own axis: its centre and the unit direction its taper runs
 * along, from the START-side connection to the END-side one.
 *
 * A fitting that has been moved or flipped keeps its stored direction; one that
 * has none is derived from its two connections, so a fitting typed into the
 * source still draws.
 */
export function axisOf(reducer, objects = null) {
	const geometry = reducer?.geometry || {};

	const centre = finitePoint(geometry.position) ? { ...geometry.position } : null;

	if (!centre) {
		return null;
	}

	let direction = finitePoint(geometry.direction) ? unitVector({ x: 0, y: 0 }, geometry.direction) : null;

	if (!direction) {
		const runs = connectedRunsOf(reducer, objects);

		if (runs.start && runs.end) {
			direction = unitVector(runs.start.geometry?.end || runs.start.geometry?.start, runs.end.geometry?.start || runs.end.geometry?.end);
		}
	}

	if (!direction) {
		return null;
	}

	return { centre, direction };
}

/* The two connected segments, looked up by id (or from the sheet). */
export function connectedRunsOf(reducer, objects = null) {
	const [startId, endId] = connectedPipeIds(reducer);

	const list = Array.isArray(objects) ? objects : null;

	const find = (id) => {
		if (!id) {
			return null;
		}

		if (list) {
			return list.find((object) => object?.id === id && enggPipeDuct.isPipeDuctType(object.type)) || null;
		}

		return enggPipeDuct.connectedPipe(id);
	};
	return { start: find(startId), end: find(endId) };
}

/*
 * The two end widths: the drawing separation each connected segment is drawn
 * with, or the fitting's own default when a side is free.
 *
 * A free side is not an error - a reducer placed at the end of a run has one
 * fresh continuation - and it is drawn at the OTHER side's width until the
 * student changes the new segment, so the fitting never shows a width that
 * belongs to no pipe.
 */
export function endWidthsOf(reducer, objects = null) {
	if (reducer?.previewRuns) objects = reducer.previewRuns;
	const runs = connectedRunsOf(reducer, objects);

	const widthOf = (run) =>
		run ? enggPipeDuct.boundarySeparation(run.engineering || {}) : null;

	const start = widthOf(runs.start);
	const end = widthOf(runs.end);

	const fallback = enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION;

	return {
		start: Number.isFinite(start) ? start : reducer?.engineering?.freeWidths?.start || (normaliseMode(reducer?.engineering?.mode) === "expand" ? fallback * 0.75 : fallback),
		end: Number.isFinite(end) ? end : reducer?.engineering?.freeWidths?.end || (normaliseMode(reducer?.engineering?.mode) === "expand" ? fallback : fallback * 0.75),
		runs
	};
}

/*
 * THE TWO WALLS OF THE TAPER, in world coordinates.
 *
 * Each wall runs from the fitting's start-side width to its end-side width,
 * offset perpendicular to the axis. The result is exactly the pair of lines the
 * source example draws - `(-L/2, +ws/2) -- (L/2, +we/2)` and its mirror - but
 * computed from the REAL widths of the two adjoining segments, so the taper meets
 * each pipe's walls without a step or a gap.
 */
export function wallsOf(reducer, objects = null) {
	const axis = axisOf(reducer, objects);

	if (!axis) {
		return null;
	}

	const length = transitionLengthOf(reducer);
	const normal = normalOf(axis.direction);

	const startCentre = pointAlong(axis.centre, axis.direction, -length / 2);
	const endCentre = pointAlong(axis.centre, axis.direction, length / 2);

	const widths = endWidthsOf(reducer, objects);

	const offset = (centre, half) => [
		{ x: centre.x + normal.x * half, y: centre.y + normal.y * half },
		{ x: centre.x - normal.x * half, y: centre.y - normal.y * half }
	];

	const [startA, startB] = offset(startCentre, widths.start / 2);
	const [endA, endB] = offset(endCentre, widths.end / 2);

	return {
		axis,
		length,
		widths,
		start: { a: startA, b: startB, centre: startCentre },
		end: { a: endA, b: endB, centre: endCentre },
		walls: [
			{ start: startA, end: endA },
			{ start: startB, end: endB }
		]
	};
}

/* The four corners of the taper, for the bounding box and a filled taper. */
export function outlineOf(reducer, objects = null) {
	const walls = wallsOf(reducer, objects);

	if (!walls) {
		return [];
	}

	return [
		walls.start.a,
		walls.end.a,
		walls.end.b,
		walls.start.b
	];
}

/**
 * KEEP A SEGMENT'S SPAN IN STEP WITH ITS TWO ENDS.
 *
 * A split piece is written from its cut points, and its walls are offset from
 * its SPAN - the line it was drawn along. Writing `start` and `end` alone left the
 * span describing the ORIGINAL pipe, so a half's walls were still drawn from the
 * old corners. This is the one place a piece's span is made equal to its ends.
 */
function syncSpan(segment) {
	if (!segment?.geometry) {
		return;
	}

	segment.geometry = {
		...segment.geometry,
		span: {
			start: { ...segment.geometry.start },
			end: { ...segment.geometry.end }
		}
	};
}

/*
 * Export the span helper, so a caller that seats a segment by hand - the drag
 * layer, a test - keeps its walls on its ends the same way.
 */

/*
 * CREATE ONE.
 *
 * `options.centre` is the fitting's centre, `options.direction` the host's
 * direction. The connections are named by the caller, because only the caller
 * knows which segments it has just made.
 */
export function createReducer(options = {}) {
	const centre = finitePoint(options.centre) ? { ...options.centre } : null;
	const direction = finitePoint(options.direction)
		? unitVector({ x: 0, y: 0 }, options.direction)
		: null;

	if (!centre || !direction) {
		return null;
	}

	const transition = Number(options.transitionLength);

	const engineering = {
		mode: normaliseMode(options.mode),
		transitionLength:
			Number.isFinite(transition) && transition >= MIN_TRANSITION_LENGTH
				? transition
				: DEFAULT_TRANSITION_LENGTH,
		startPipeId: options.startPipeId || null,
		endPipeId: options.endPipeId || null,
		ports: {
			start: options.ports?.start === "start" ? "start" : "end",
			end: options.ports?.end === "end" ? "end" : "start"
		},
		connections: [options.startPipeId || null, options.endPipeId || null].filter(Boolean)
	};

	return enggDrawingState.createGeometryObject(
		REDUCER_TYPE,
		{
			position: { x: centre.x, y: centre.y },
			direction: { x: direction.x, y: direction.y }
		},
		{
			...options,
			engineering
		}
	);
}

/* Connected terminal widths live only on their pipes. */
export function setEndWidth(reducer, side, width, objects = drawingState.objects) {
    if (reducer?.locked || !["start", "end"].includes(side) || !Number.isFinite(width) || width <= 0) return false;
    const run = connectedRunsOf(reducer, objects)[side];
    if (run?.locked) return false;
    if (run) {
        run.engineering = { ...run.engineering, separation: width - enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION };
        propagatePipeWidth(run, objects);
        if (reducer.engineering.freeWidths) delete reducer.engineering.freeWidths[side];
    } else {
        reducer.engineering.freeWidths = { ...reducer.engineering.freeWidths, [side]: width };
    }
    return true;
}

export function modeOf(reducer, objects = null) {
    const widths = endWidthsOf(reducer, objects);
    return Math.abs(widths.start-widths.end) < 1e-6 ? normaliseMode(reducer?.engineering?.mode) : widths.start > widths.end ? "reduce" : "expand";
}

export function setMode(reducer, mode, objects = drawingState.objects) {
    if (!isReducerType(reducer?.type) || reducer.locked || !Object.values(REDUCER_MODES).includes(mode)) return false;
    if (modeOf(reducer, objects) === mode) { reducer.engineering.mode = mode; return true; }
    const widths = endWidthsOf(reducer, objects);
    if (widths.runs.start?.locked || widths.runs.end?.locked) return false;
    setEndWidth(reducer, "start", widths.end, objects);
    setEndWidth(reducer, "end", widths.start, objects);
    reducer.engineering.mode = mode;
    return true;
}

export function flipReducer(reducer, objects = drawingState.objects) {
    return setMode(reducer, modeOf(reducer, objects) === "reduce" ? "expand" : "reduce", objects);
}

/* A terminal cannot leave its straight route or pass the adjoining pipe's far end. */
export function canSeat(reducer, centre, length, objects = drawingState.objects) {
    const axis = axisOf(reducer, objects);
    if (!axis || !finitePoint(centre) || !Number.isFinite(length) || length < MIN_TRANSITION_LENGTH) return false;
    const runs = connectedRunsOf(reducer, objects);
    const ports = portsOf(reducer);
    return ["start", "end"].every(side => {
        const run = runs[side];
        if (!run) return true;
        const sign = side === "start" ? -1 : 1;
        const terminal = pointAlong(centre, axis.direction, sign * length / 2);
        const old = run.geometry?.[ports[side]];
        const far = run.geometry?.[ports[side] === "start" ? "end" : "start"];
        if (!far || !old) return false;
        if (run.locked && Math.hypot(terminal.x - old.x, terminal.y - old.y) > 1e-6) return false;
        const dx = far.x - terminal.x, dy = far.y - terminal.y;
        return sign * (dx * axis.direction.x + dy * axis.direction.y) >= 1 &&
            Math.abs(dx * axis.direction.y - dy * axis.direction.x) < 0.01;
    });
}

export function slideReducerTo(reducer, point, objects = drawingState.objects) {
    if (!isReducerType(reducer?.type) || reducer.locked || !finitePoint(point)) return false;
    const axis = axisOf(reducer, objects);
    if (!axis) return false;
    const runs = connectedRunsOf(reducer, objects);
    let centre = { ...point };
    if (runs.start || runs.end) {
        const distance = (point.x - axis.centre.x) * axis.direction.x + (point.y - axis.centre.y) * axis.direction.y;
        centre = pointAlong(axis.centre, axis.direction, distance);
    }
    if (!canSeat(reducer, centre, transitionLengthOf(reducer), objects)) return false;
    reducer.geometry.position = centre;
    keepConnectedEndsSeated(reducer, objects);
    return true;
}

export function resizeEndTo(reducer, side, point, objects = drawingState.objects) {
    if (reducer?.locked || !finitePoint(point)) return false;
    const walls = wallsOf(reducer, objects);
    if (!walls) return false;
    const other = side === "start" ? walls.end.centre : walls.start.centre;
    const sign = side === "start" ? -1 : 1;
    const length = sign * ((point.x - other.x) * walls.axis.direction.x + (point.y - other.y) * walls.axis.direction.y);
    const centre = pointAlong(other, walls.axis.direction, sign * length / 2);
    if (!canSeat(reducer, centre, length, objects)) return false;
    reducer.geometry.position = centre;
    reducer.engineering.transitionLength = length;
    keepConnectedEndsSeated(reducer, objects);
    return true;
}

/*
 * KEEP THE FITTING ON ITS PIPES.
 *
 * A connected segment's near end is placed at the fitting's own end point - the
 * centre of the taper's end cross-section - so the walls meet without a gap
 * however the fitting was moved, resized or flipped. Only the end recorded in
 * `ports` is written; the segment's outer end is the student's.
 */
export function keepConnectedEndsSeated(reducer, objects = null) {
	const walls = wallsOf(reducer, objects);

	if (!walls) {
		return false;
	}

	const runs = connectedRunsOf(reducer, objects);
	const ports = portsOf(reducer);

	const seat = (run, port, at) => {
		if (!run || !finitePoint(at) || !run.geometry) {
			return;
		}

		run.geometry = {
			...run.geometry,
			[port]: { x: at.x, y: at.y }
		};
	};

	seat(runs.start, ports.start, walls.start.centre);
	seat(runs.end, ports.end, walls.end.centre);

	/* A SEATED SEGMENT'S SPAN FOLLOWS ITS NEW END, or its walls would drift. */
	syncSpan(runs.start);
	syncSpan(runs.end);

	return true;
}

export function setTransitionLength(reducer, length, objects = drawingState.objects) {
    const value = Number(length);
    if (reducer?.locked || !canSeat(reducer, reducer.geometry?.position, value, objects)) return false;
    reducer.engineering.transitionLength = value;
    keepConnectedEndsSeated(reducer, objects);
    return true;
}

/* The fitting's one editable state, as the panel, the writer and tests read it. */
export function describeReducer(reducer, objects = null) {
	const walls = wallsOf(reducer, objects);
	const runs = connectedRunsOf(reducer, objects);

	return {
		mode: normaliseMode(reducer?.engineering?.mode),
		transitionLength: transitionLengthOf(reducer),
		startPipeId: reducer?.engineering?.startPipeId || null,
		endPipeId: reducer?.engineering?.endPipeId || null,
		startPipeName: runs.start?.name || null,
		endPipeName: runs.end?.name || null,
		widths: walls ? walls.widths : null,
		centre: walls ? walls.axis.centre : null,
		direction: walls ? walls.axis.direction : null,
		rotation: walls ? (Math.atan2(walls.axis.direction.y, walls.axis.direction.x) * 180) / Math.PI : 0
	};
}

/* Called by the shared pipe reconciler after an endpoint or source edit. */
export function reconcilePipe(run, objects = drawingState.objects) {
    for (const fitting of objects.filter(object => isReducerType(object.type))) {
        let walls = wallsOf(fitting, objects);
        if (!walls) continue;
        const ports = portsOf(fitting);
        for (const side of ["start", "end"]) {
            const key = side === "start" ? "startPipeId" : "endPipeId";
            if (!fitting.engineering[key]) {
                const port = ["start", "end"].find(end => Math.hypot(run.geometry[end].x-walls[side].centre.x, run.geometry[end].y-walls[side].centre.y) < 1e-6);
                if (port && !connectedPipeIds(fitting).includes(run.id)) {
                    const candidate = { ...fitting, engineering: { ...fitting.engineering, [key]: run.id, ports: { ...ports, [side]: port } } };
                    if (canSeat(candidate, walls.axis.centre, walls.length, objects)) {
                        fitting.engineering = candidate.engineering;
                        fitting.engineering.connections = connectedPipeIds(fitting).filter(Boolean);
                        if (fitting.engineering.freeWidths) delete fitting.engineering.freeWidths[side];
                        ports[side] = port;
                        keepConnectedEndsSeated(fitting, objects);
                    }
                }
            }
            if (fitting.engineering[key] !== run.id) continue;
            const port = ports[side], point = run.geometry[port];
            const farPort = port === "start" ? "end" : "start";
            const far = run.geometry[farPort], sign = side === "start" ? -1 : 1;
            const along = (far.x-walls[side].centre.x)*walls.axis.direction.x + (far.y-walls[side].centre.y)*walls.axis.direction.y;
            run.geometry[farPort] = pointAlong(walls[side].centre, walls.axis.direction, sign*Math.max(1,sign*along));
            syncSpan(run);
            if (Math.hypot(point.x-walls[side].centre.x,point.y-walls[side].centre.y) > 1e-6) {
                resizeEndTo(fitting, side, point, objects);
                keepConnectedEndsSeated(fitting, objects);
                walls = wallsOf(fitting, objects);
            }
        }
    }
}

const enggReducer = {
	REDUCER_TYPE,
	REDUCER_MODES,
	REDUCER_MODE_LABELS,
	MIN_TRANSITION_LENGTH,
	isReducerType,
	normaliseMode,
	transitionLengthOf,
	connectedPipeIds,
	portsOf,
	axisOf,
	connectedRunsOf,
	endWidthsOf,
	wallsOf,
	outlineOf,
	createReducer,
	flipReducer,
    setMode,
    modeOf,
    setEndWidth,
    resizeEndTo,
    canSeat,
    reconcilePipe,
	slideReducerTo,
	keepConnectedEndsSeated,
	setTransitionLength,
	syncSpan,
	describeReducer
};

export default enggReducer;
