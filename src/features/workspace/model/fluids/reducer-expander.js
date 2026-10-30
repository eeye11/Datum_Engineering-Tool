/*
 * ========================================================
 * THE REDUCER / EXPANDER
 * ========================================================
 *
 * A reducer is an INLINE FITTING: it sits in a run of pipework and tapers the
 * two visible walls from one segment's width to the next segment's. It is not a
 * tapered shape the student drags out in empty space - it exists BETWEEN two
 * pipes, and its geometry is derived from theirs.
 *
 *   geometry.position     the fitting's centre, ON its host's centreline
 *   geometry.direction    the unit vector along the run, start -> end
 *   engineering.mode      "reduce" or "expand" - which way the width changes
 *   engineering.transitionLength   how long the taper is, along the run
 *   engineering.startPipeId / endPipeId
 *                         the two segments it joins, in the order the fitting's
 *                         own axis runs
 *   engineering.ports     which end of each segment the fitting holds
 *
 * ========================================================
 * THE WIDTHS ARE READ, NEVER STORED
 * ========================================================
 *
 * The two widths at the fitting's ends ARE the two connected segments' widths -
 * `boundarySeparation` of each. Nothing here keeps its own copy: a fitting with
 * a stored width would be free to disagree with the pipe it is bolted to, which
 * is exactly the failure a reducer exists to avoid. Change a segment's Pipe
 * Width and the taper follows on the next read.
 *
 * ========================================================
 * MODE, AND WHY IT IS ONLY A LOGICAL STATEMENT
 * ========================================================
 *
 * Reduce means "the run gets narrower along the fitting's axis", Expand means
 * "it gets wider". WHICH SEGMENT is narrow is decided by the two pipes' actual
 * widths, so the four combinations of mode and which side the student drew are
 * all drawable - a reducer on a run drawn right-to-left is still a reducer.
 *
 * `orientation` flips the fitting's axis relative to the host segment, so the
 * student can put the narrow end on either side before or after committing.
 * Flipping is a statement about the DRAWING, not about the fluid: DAETUM never
 * infers flow direction.
 */

import enggDrawingState from "../../../../shared/model/drawing-state.js";
import enggPipeDuct from "./pipe-duct.js";
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
	reduce: "Reduce",
	expand: "Expand"
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
	const runs = connectedRunsOf(reducer, objects);

	const widthOf = (run) =>
		run ? enggPipeDuct.boundarySeparation(run.engineering || {}) : null;

	const start = widthOf(runs.start);
	const end = widthOf(runs.end);

	const fallback = enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION;

	return {
		start: Number.isFinite(start) ? start : Number.isFinite(end) ? end : fallback,
		end: Number.isFinite(end) ? end : Number.isFinite(start) ? start : fallback,
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

/* Flip the taper end-for-end, without moving anything on the sheet. */
export function flipReducer(reducer) {
	if (!isReducerType(reducer?.type)) {
		return false;
	}

	const engineering = reducer.engineering || {};

	reducer.engineering = {
		...engineering,
		mode: normaliseMode(engineering.mode) === REDUCER_MODES.reduce ? REDUCER_MODES.expand : REDUCER_MODES.reduce,
		startPipeId: engineering.endPipeId || null,
		endPipeId: engineering.startPipeId || null,
		ports: {
			start: portsOf(reducer).end,
			end: portsOf(reducer).start
		}
	};

	reducer.engineering.connections = [reducer.engineering.startPipeId, reducer.engineering.endPipeId].filter(Boolean);
	const direction = reducer.geometry?.direction;

	if (finitePoint(direction)) {
		reducer.geometry = {
			...reducer.geometry,
			direction: { x: -direction.x, y: -direction.y }
		};
	}

	keepConnectedEndsSeated(reducer);
	return true;
}

/*
 * MOVING THE FITTING ALONG ITS RUN.
 *
 * The centre is projected onto the host's line and clamped so the fitting stays
 * inside it, which is the same rule the Flow Arrow follows: a drag along the run
 * is the only degree of freedom, and it can never leave the pipe.
 */
export function slideReducerTo(reducer, point, objects = null) {
	if (!isReducerType(reducer?.type) || !finitePoint(point)) {
		return false;
	}

	const runs = connectedRunsOf(reducer, objects);
	const host = runs.start || runs.end;

	if (!host?.geometry?.start || !host?.geometry?.end) {
		return false;
	}

	const a = host.geometry.start;
	const b = host.geometry.end;

	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const lengthSquared = dx * dx + dy * dy;

	if (lengthSquared < 1e-12) {
		return false;
	}

	const t = Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));

	reducer.geometry = {
		...reducer.geometry,
		position: { x: a.x + dx * t, y: a.y + dy * t }
	};

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

/* ============================================================
 * THE TARGET SEGMENT AND ITS PIPE WIDTH
 * ============================================================
 *
 * Reduce means the run gets NARROWER along the taper; Expand means it gets
 * WIDER. Which of the two connected segments is the one that CHANGES is decided
 * by that statement and the two pipes' actual widths - never by the flow, and
 * never by a stored copy.
 *
 *   Reduce  the END-side segment is the narrower one
 *   Expand  the END-side segment is the wider one
 *
 * Flipping swaps which side is the end side, so the same two pipes are seen the
 * other way round and the taper runs the other way on the sheet.
 */
export function targetSideOf(reducer) {
  /* The field edits the END-side segment in both modes; the MODE says whether
   * that side is the narrow one (Reduce) or the wide one (Expand). */
  return normaliseMode(reducer?.engineering?.mode) === REDUCER_MODES.expand ? "end" : "end";
}

/* The connected segment the Pipe Width field edits - the END-side one. */
export function targetRunOf(reducer, objects = null) {
  const runs = connectedRunsOf(reducer, objects);

  return runs.end || runs.start || null;
}

/* The target segment's Pipe Width, exactly as the Pipe / Duct model stores it. */
export function targetWidthOf(reducer, objects = null) {
  const run = targetRunOf(reducer, objects);

  return run ? Number(run.engineering?.separation) || 0 : 0;
}

/*
 * SET THE TARGET SEGMENT'S PIPE WIDTH.
 *
 * The width lives on the SEGMENT, never on the fitting: a reducer with a stored
 * width of its own would be free to disagree with the pipe it is bolted to. The
 * fitting's taper follows on the next read, which is why nothing is copied here.
 */
export function setTargetWidth(reducer, pipeWidth, objects = null) {
  const run = targetRunOf(reducer, objects);

  if (!run) {
    return false;
  }

  const value = Number(pipeWidth);

  if (!Number.isFinite(value) || enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION + value <= 0) {
    return false;
  }

  const engineering = { ...(run.engineering || {}) };

  if (value === 0) {
    delete engineering.separation;
  } else {
    engineering.separation = value;
  }

  run.engineering = engineering;

  keepConnectedEndsSeated(reducer, objects);

  return true;
}

/* Set the taper's length, clamped so it can never collapse to nothing. */
export function setTransitionLength(reducer, length) {
	const value = Number(length);

	if (!isReducerType(reducer?.type) || !Number.isFinite(value) || value < MIN_TRANSITION_LENGTH) {
		return false;
	}

	reducer.engineering = {
		...(reducer.engineering || {}),
		transitionLength: value
	};

	keepConnectedEndsSeated(reducer);
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
	slideReducerTo,
	keepConnectedEndsSeated,
	targetSideOf,
	targetRunOf,
	targetWidthOf,
	setTargetWidth,
	setTransitionLength,
	syncSpan,
	describeReducer
};

export default enggReducer;
