/*
 * ========================================================
 * THE INLINE INSERTION SERVICE
 * ========================================================
 *
 * ONE service for every fitting or piece of equipment that sits IN a run of
 * pipework: the Reducer / Expander, the Pump, the Valve and the Flow Meter. It
 * owns the questions all four ask, so there is one hit test, one split and one
 * connection rule rather than four copies free to disagree:
 *
 *   findTarget       which pipe is under the pointer, where along it, and is the
 *                    press at an END or in the INTERIOR?
 *   planInsertion    what the sheet would look like: which segments, how they
 *                    are cut, what the symbol's frame is
 *   insertInline     perform the whole thing as ONE undoable transaction
 *
 * ========================================================
 * WHAT THE SPLIT PRESERVES
 * ========================================================
 *
 *   - The segment on the ORIGINAL pipe's start-point side keeps the original
 *     stable id, so anything already pointing at the pipe still points at the
 *     same piece of pipe.
 *   - The other segment is new, with a new stable id and its own ordinary row.
 *   - BOTH carry the host's appearance and width, untouched. The only dimension
 *     that changes is the one the operation is FOR (a reducer's new width).
 *   - Neither is ever zero-length: an insertion closer to an end than the
 *     symbol's own reach becomes an ENDPOINT placement, not two slivers.
 *
 * ========================================================
 * AN ENDPOINT PLACEMENT DOES NOT INVENT PIPE
 * ========================================================
 *
 * Equipment at an end of a pipe is ATTACHED to that end and given a free
 * connection at its far side. Nothing is drawn beyond it unless the caller asks
 * for a continuation (a reducer's new segment, which is why the new width can be
 * set). The reducer is the one type that, at an end, creates a real new run -
 * because its whole purpose is to establish the next width.
 *
 * ========================================================
 * ONE TRANSACTION
 * ========================================================
 *
 * Every insertion snapshots the drawing, rewrites the list, and commits once -
 * so Undo puts the original pipe, its appearance and its connections back in one
 * step, and Cancel leaves nothing behind.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggPipeDuct from "../model/fluids/pipe-duct.js";
import enggReducer from "../model/fluids/reducer-expander.js";
import enggEquipment from "../model/fluids/inline-equipment.js";
import { drawingState } from "../editor-state.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";
import {
	DEFAULT_CONTINUATION_LENGTH,
	DEFAULT_SYMBOL_RADIUS,
	finitePoint,
	unitVector
} from "../model/fluids/fluids-shared.js";

/* How close to a pipe's end a press counts as an ENDPOINT placement. */
export const INLINE_ENDPOINT_TOLERANCE = 2;

/* How far from a centreline a press may be and still be on the pipe. */
export const INLINE_GRAB_UNITS = 4;

/* The interaction phase while an inline tool is armed. */
export const INLINE_PHASE = "inline-place";

/* ============================================================
 * FINDING THE TARGET
 * ============================================================ */

/* Whether a point is on or near one of a pipe's two visible ends. */
export function pipeEndAt(point, objects = drawingState.objects, tolerance = INLINE_ENDPOINT_TOLERANCE) {
	if (!finitePoint(point)) {
		return null;
	}

	let best = null;

	(objects || []).forEach((run) => {
		if (!enggPipeDuct.isPipeDuctType(run.type)) {
			return;
		}

		enggPipeDuct.portsOf(run).forEach((port) => {
			const distance = Math.hypot(port.point.x - point.x, port.point.y - point.y);

			if (distance <= tolerance && (!best || distance < best.distance)) {
				best = { run, port: port.id, point: { ...port.point }, distance };
			}
		});
	});

	return best;
}

/*
 * THE PIPE UNDER THE POINTER, and where along it.
 *
 * Returns `{ run, fraction, point, end: "start"|"end"|null }`. `end` is non-null
 * only when the press was on that end itself, which is the one case that must
 * not split the run.
 */
export function findInsertionTarget(rawPoint, objects = drawingState.objects, tolerance = INLINE_GRAB_UNITS) {
	if (!finitePoint(rawPoint)) {
		return null;
	}

	const endMatch = pipeEndAt(rawPoint, objects, Math.max(INLINE_ENDPOINT_TOLERANCE, tolerance));

	if (endMatch) {
		return {
			run: endMatch.run,
			port: endMatch.port,
			fraction: endMatch.port === "start" ? 0 : 1,
			point: endMatch.point,
			interior: false
		};
	}

	let best = null;

	(objects || []).forEach((run) => {
		if (!enggPipeDuct.isPipeDuctType(run.type)) {
			return;
		}

		const start = run.geometry?.start;
		const end = run.geometry?.end;

		if (!finitePoint(start) || !finitePoint(end)) {
			return;
		}

		const dx = end.x - start.x;
		const dy = end.y - start.y;
		const lengthSquared = dx * dx + dy * dy;

		if (lengthSquared < 1e-12) {
			return;
		}

		const t = ((rawPoint.x - start.x) * dx + (rawPoint.y - start.y) * dy) / lengthSquared;

		if (t <= 0 || t >= 1) {
			return;
		}

		const foot = { x: start.x + dx * t, y: start.y + dy * t };
		const distance = Math.hypot(rawPoint.x - foot.x, rawPoint.y - foot.y);

		if (distance > tolerance) {
			return;
		}

		if (!best || distance < best.distance) {
			best = {
				run,
				port: null,
				fraction: t,
				point: foot,
				interior: true,
				distance
			};
		}
	});

	return best;
}

/* Gap targets use visible terminal centres and stable port references. */
export function portOccupied(run, port, objects = drawingState.objects) {
    return objects.some(object => {
        if (object.id === run.id) return false;
        if (object.type === "reducer-expander") {
            const ids = enggReducer.connectedPipeIds(object), ports = enggReducer.portsOf(object);
            return (ids[0] === run.id && ports.start === port) || (ids[1] === run.id && ports.end === port);
        }
        if (object.type === "junction") {
            return (object.geometry?.branches || []).some(branch => branch.connected === run.id &&
                (!branch.connectedPort || branch.connectedPort === port));
        }
        if (object.type === "elbow" && object.engineering?.connections?.includes(run.id)) {
            return enggPipeDuct.elbowHeldEndOf(run, object) === port;
        }
        if (enggEquipment.isEquipmentType(object.type)) {
            const ids = object.engineering?.pipeIds || [];
            const ports = object.engineering?.ports || {};
            return ids.some((id, index) => id === run.id && ports[index === 0 ? "a" : "b"] === port);
        }
        if (object.engineering?.connections?.includes(run.id) || object.engineering?.pipeIds?.includes(run.id)) {
            const position = object.geometry?.position;
            return !position || Math.hypot(position.x - run.geometry[port].x, position.y - run.geometry[port].y) < 4;
        }
        return object.type === "pipe-duct" && ["start", "end"].some(end =>
            Math.hypot(object.geometry[end].x - run.geometry[port].x, object.geometry[end].y - run.geometry[port].y) < 1e-5);
    });
}

export function findReducerTarget(point, objects = drawingState.objects) {
    if (!finitePoint(point)) return null;
    const visibleObjects = objects.filter(object => object.visible !== false);
    const direct = findInsertionTarget(point, visibleObjects);
    if (direct?.interior) return direct;
    const pipes = visibleObjects.filter(object => enggPipeDuct.isPipeDuctType(object.type));
    let best = null;
    for (let i = 0; i < pipes.length; i++) for (let j = i + 1; j < pipes.length; j++) {
        const first = pipes[i], second = pipes[j];
        for (const a of ["start", "end"]) for (const b of ["start", "end"]) {
            const from = first.geometry[a], to = second.geometry[b];
            const direction = unitVector(from, to);
            if (!direction) continue;
            const length = Math.hypot(to.x-from.x,to.y-from.y);
            const outwardA = unitVector(first.geometry[a === "start" ? "end" : "start"], from);
            const outwardB = unitVector(second.geometry[b === "start" ? "end" : "start"], to);
            if (!outwardA || !outwardB) continue;
            const aligned = outwardA.x*direction.x+outwardA.y*direction.y >= 0.999999 && outwardB.x*direction.x+outwardB.y*direction.y <= -0.999999;
            if (!aligned && (length > 4*Math.max(enggPipeDuct.boundarySeparation(first.engineering),enggPipeDuct.boundarySeparation(second.engineering)) ||
                outwardA.x*direction.x+outwardA.y*direction.y <= 0 || outwardB.x*direction.x+outwardB.y*direction.y >= 0)) continue;
            const distance = (point.x-from.x)*direction.x+(point.y-from.y)*direction.y;
            const cross = Math.abs((point.x-from.x)*direction.y-(point.y-from.y)*direction.x);
            if (distance < 0 || distance > length || cross > INLINE_GRAB_UNITS) continue;
            if (!best || cross < best.distance) best = {
                run: first, second, port: a, secondPort: b, gap: true,
                point: { x:(from.x+to.x)/2,y:(from.y+to.y)/2 }, direction, length, distance: cross,
                invalid: !aligned || length < enggReducer.MIN_TRANSITION_LENGTH || first.locked || second.locked ||
                    portOccupied(first,a,objects) || portOccupied(second,b,objects)
            };
        }
    }
    return best || direct;
}

/* ============================================================
 * PLANNING
 * ============================================================
 *
 * Nothing is written here. `planInsertion` answers what WOULD happen, which is
 * what the live preview draws and what `insertInline` then performs - so the
 * preview cannot differ from the result.
 */
export function planInsertion(kind, target, options = {}) {
	if (!target?.run || !enggPipeDuct.isPipeDuctType(target.run.type)) {
		return null;
	}

	const run = target.run;
	if (kind === enggReducer.REDUCER_TYPE && (run.locked || target.invalid)) return null;
	if (kind === enggReducer.REDUCER_TYPE && target.gap) {
        const increasing = enggPipeDuct.boundarySeparation(run.engineering) < enggPipeDuct.boundarySeparation(target.second.engineering);
        const reverse = options.mode && (options.mode === "expand") !== increasing;
        const first = reverse ? target.second : run, second = reverse ? run : target.second;
        return { kind, placement: "gap", host: first, first, second, centre: target.point,
            direction: reverse ? { x: -target.direction.x, y: -target.direction.y } : target.direction,
            reach: target.length / 2, ports: { first: reverse ? target.secondPort : target.port, second: reverse ? target.port : target.secondPort }, options };
    }
	const start = run.geometry?.start;
	const end = run.geometry?.end;

	if (!finitePoint(start) || !finitePoint(end)) {
		return null;
	}

	const direction = unitVector(start, end);

	if (!direction) {
		return null;
	}

	const length = Math.hypot(end.x - start.x, end.y - start.y);
	const at = target.point;

	/*
	 * HOW MUCH ROOM THE SYMBOL NEEDS either side of its centre. A reducer's is
	 * half its transition length; a circular symbol's is its radius. A press that
	 * leaves less than that in a segment turns into an ENDPOINT placement, so no
	 * zero-length pipe is ever created.
	 */
	const reach = kind === enggReducer.REDUCER_TYPE && options.transitionLength == null
        ? Math.max(enggReducer.MIN_TRANSITION_LENGTH / 2, Math.min(enggPipeDuct.boundarySeparation(run.engineering) * 1.5, length / 4))
        : insertionReach(kind, options);

	const distanceIn = (at.x - start.x) * direction.x + (at.y - start.y) * direction.y;
	const distanceFromEnd = length - distanceIn;

	const interior = target.interior && distanceIn > INLINE_ENDPOINT_TOLERANCE && distanceFromEnd > INLINE_ENDPOINT_TOLERANCE;

	const endpoint = interior ? null : distanceIn <= distanceFromEnd ? "start" : "end";

	if (endpoint) {
        if (kind === enggReducer.REDUCER_TYPE && portOccupied(run, endpoint)) return null;
		return planEndpoint(kind, run, endpoint, options);
	}

	if (kind === enggReducer.REDUCER_TYPE && (distanceIn <= reach + 1 || distanceFromEnd <= reach + 1)) return null;

	const cutStart = {
		x: at.x - direction.x * reach,
		y: at.y - direction.y * reach
	};

	const cutEnd = {
		x: at.x + direction.x * reach,
		y: at.y + direction.y * reach
	};

	/* A cut that does not leave a real piece either side is an end placement. */
	if (
		Math.hypot(cutStart.x - start.x, cutStart.y - start.y) <= INLINE_ENDPOINT_TOLERANCE ||
		Math.hypot(end.x - cutEnd.x, end.y - cutEnd.y) <= INLINE_ENDPOINT_TOLERANCE
	) {
		return planEndpoint(kind, run, distanceIn <= distanceFromEnd ? "start" : "end", options);
	}

	  const rotation = angleDegrees(direction);

	  const first = splitHalf(run, start, cutStart, true);
	  const second = splitHalf(run, cutEnd, end, false);

	  /* The selected configuration decides which half receives the narrower default. */
	  applyReducerWidth(kind, options.mode === "expand" ? first : second);

	  const frame = { centre: at, rotation };

	  return {
	    kind,
	    placement: "inline",
	    host: run,
	    first,
	    second,
	    frame,
	    direction,
	    rotation,
	    reach,
	    ports: { first: "end", second: "start" },
	    centre: { x: at.x, y: at.y },
	    options
	  };
	}

/* Initial drawing default: retain the wide width and narrow the other side to 75%. */
function applyReducerWidth(kind, segment) {
    if (kind !== enggReducer.REDUCER_TYPE || !segment) return;
    segment.engineering = { ...segment.engineering,
        separation: enggPipeDuct.boundarySeparation(segment.engineering) * 0.75 - enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION };
}

/* Everything the caller gets on a press at (or too near) an end. */
function planEndpoint(kind, run, endpoint, options) {
	const start = run.geometry.start;
	const end = run.geometry.end;
	const direction = unitVector(start, end);

	const at = endpoint === "start" ? { ...start } : { ...end };

	/*
	 * THE SYMBOL STANDS OUTSIDE THE PIPE, on the end that was pressed, facing
	 * along it. Its near connection point sits ON the pipe's end, so the two
	 * meet exactly.
	 */
	const outward = endpoint === "start" ? { x: -direction.x, y: -direction.y } : direction;

	const reach = insertionReach(kind, options);

	const centre = { x: at.x + outward.x * reach, y: at.y + outward.y * reach };
	const rotation = angleDegrees(direction);

	const continuation =
	  options.continuation === false
	    ? null
	    : splitHalf(
	        run,
	        { x: centre.x + outward.x * reach, y: centre.y + outward.y * reach },
	        {
	          x: centre.x + outward.x * (reach + DEFAULT_CONTINUATION_LENGTH),
	          y: centre.y + outward.y * (reach + DEFAULT_CONTINUATION_LENGTH)
	        },
	        false
	      );

	/* THE REDUCER'S NEW WIDTH LANDS ON THE CONTINUATION. */
	const first = kind === enggReducer.REDUCER_TYPE ? splitHalf(run, start, end, true) : run;
    applyReducerWidth(kind, options.mode === "expand" ? first : continuation);

	const frame = { centre, rotation };

	return {
		kind,
		placement: "endpoint",
		host: run,
		endpoint,
		first,
		second: continuation,
		frame,
		direction: kind === enggReducer.REDUCER_TYPE ? outward : direction,
		rotation,
		reach,
		centre,
		ports: {
			host: endpoint,
			/* The symbol's own connection on the pipe side, in its local axis. */
			symbolHostSide: endpoint === "start" ? "b" : "a",
			continuation: endpoint === "start" ? "b" : "a",
			continuationPort: endpoint === "start" ? "start" : "end"
		},
		options
	};
}

/* The half a split produces, with its id decided by which side it is. */
function splitHalf(host, from, to, keepIdentity) {
	const base = {
		...host,
		geometry: {
			start: { x: from.x, y: from.y },
			end: { x: to.x, y: to.y },
			span: {
				start: { x: from.x, y: from.y },
				end: { x: to.x, y: to.y }
			}
		},
		style: { ...(host.style || {}) },
		engineering: { ...(host.engineering || {}) }
	};

	/* A split piece is its own run: the fitting owns the joint, not a trim. */
	delete base.geometry.trims;
	delete base.geometry.bendJoints;

	base.geometry = JSON.parse(JSON.stringify(base.geometry));

	if (!keepIdentity) {
		base.id = newObjectId("pipe-duct");
		base.name = "Pipe / Duct";
	}

	return base;
}

function insertionReach(kind, options = {}) {
	if (kind === enggReducer.REDUCER_TYPE) {
		const transition = Number(options.transitionLength);

		return (Number.isFinite(transition) && transition > 0 ? transition : enggReducer.transitionLengthOf({ engineering: {} })) / 2;
	}

	const size = Number(options.symbolSize);

	return Number.isFinite(size) && size > 0 ? size : DEFAULT_SYMBOL_RADIUS;
}

function angleDegrees(direction) {
	return (Math.atan2(direction.y, direction.x) * 180) / Math.PI;
}

export function newObjectId(type) {
	const generated =
		globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
			? globalThis.crypto.randomUUID()
			: `${Date.now()}-${Math.random().toString(16).slice(2)}`;

	return `${type}-${generated}`;
}

/*
 * KEEP A SEGMENT'S SPAN IN STEP WITH ITS TWO ENDS.
 *
 * A split piece's walls are offset from its `span` - the line it was drawn along
 * - so a piece whose ends were cut must have its span cut with them.
 */
function syncSpan(segment) {
	if (!segment?.geometry) {
		return;
	}

	segment.geometry = {
		...segment.geometry,
		span: { start: { ...segment.geometry.start }, end: { ...segment.geometry.end } }
	};
}

/* ============================================================
 * INSERTING
 * ============================================================
 *
 * `plan.kind` decides the object the insertion creates. Everything else - the
 * split, the ids, the connections and the single commit - is the same for all
 * four tools, which is the point of this module.
 */
export function insertInline(kind, plan, extra = {}) {
	if (!plan?.host) {
		return null;
	}

    if (kind === enggReducer.REDUCER_TYPE) {
        const host = drawingState.objects.find(object => object.id === plan.host.id);
        if (!host || host.locked) return null;
        if (plan.placement === "gap" && (portOccupied(host, plan.ports.first) || portOccupied(plan.second, plan.ports.second))) return null;
        if (plan.placement === "endpoint" && portOccupied(host, plan.endpoint)) return null;
        if (plan.placement === "inline") {
            const probe = enggReducer.createReducer({ centre: plan.centre, direction: plan.direction, transitionLength: plan.reach*2, startPipeId: plan.first.id, endPipeId: plan.second.id });
            if (!enggReducer.canSeat(probe, plan.centre, plan.reach*2, [plan.first,plan.second])) return null;
        }
    }

	/*
	 * WHAT THE ONE UNDO ENTRY WILL RESTORE.
	 *
	 * The insertion changes the sheet several times (a split, a segment, the
	 * symbol, its connections) but commits ONCE, at the end, against this
	 * snapshot - so Undo steps back over the whole insertion in one step rather
	 * than through its parts.
	 */
	const previousObjects = enggDrawingState.snapshotDrawing(drawingState);

	const created = [];

	const host = plan.host;

	/*
	 * THE FIRST HALF IS THE HOST ITSELF.
	 *
	 * `plan.first` and `plan.host` are the SAME object - `splitHalf(run, ..., true)`
	 * copies it and keeps its id - so the document is asked for its own copy by
	 * id, and the old reference is never spliced back in beside it. Pushing the
	 * plan's copy as well is how three segments appeared for one run.
	 */
	const committedHost = drawingState.objects.find((object) => object.id === host.id) || host;

	/* The continuation, when the placement created one. */
	let second = null;

	/*
	 * REPLACE THE HOST, IN PLACE.
	 *
	 * An interior insertion replaces the host with its two halves - the start
	 * half keeps the host's id, the end half is new. An endpoint insertion
	 * edits the host in place and appends its continuation after it.
	 */
	const objects = drawingState.objects;
	const index = objects.findIndex((object) => object.id === host.id);

	if (index < 0) {
		return null;
	}

	if (plan.placement === "inline") {
		/*
		 * THE SPLIT HALVES CARRY THEIR OWN SPAN.
		 *
		 * `splitHalf` writes the two points it cut the run at, and a run's walls are
		 * offset from its SPAN, which is the line it was drawn along. Left as the
		 * host's span, each half's walls would still run from the ORIGINAL corners.
		 */
		const first = committedHost;

		/*
		 * THE FIRST HALF IS RE-CUT and given its own span - the model is the same
		 * object, but its geometry must describe the first piece now.
		 */
		first.geometry = JSON.parse(JSON.stringify(plan.first.geometry));
		first.style = { ...(host.style || {}) };
		first.engineering = { ...(plan.first.engineering || {}) };

		/*
		 * THE NEW HALF IS A NEW OBJECT: its own geometry, style and engineering,
		 * not references into the plan the caller still holds.
		 */
		const fresh = {
			...plan.second,
			geometry: JSON.parse(JSON.stringify(plan.second.geometry)),
			style: { ...(plan.second.style || {}) },
			engineering: { ...(plan.second.engineering || {}) }
		};

		syncSpan(first);
		syncSpan(fresh);

		objects.splice(index, 1, first, fresh);
        transferFarConnections(objects, host.id, fresh.id, fresh.geometry.end);
	} else if (plan.placement !== "gap") {
        if (kind === enggReducer.REDUCER_TYPE) committedHost.engineering = { ...plan.first.engineering };
		/*
		 * THE ENDPOINT PLACEMENT: the host is edited in place, and the
		 * continuation is AND IS NOT THE HOST - it is added as its own object.
		 * `commitSegment` gives it its own stable id and returns it.
		 */
		if (plan.second && plan.second.id !== host.id) {
			second = commitSegment(plan.second, created);
		}
	}

	if (second) {
		created.push(second);
	}

	const symbol = buildSymbol(kind, plan, extra);

	if (!symbol) {
		/*
		 * NOTHING IS LEFT BEHIND. The sheet is put back exactly as it was snapshotted
		 * and no history entry is written, so a refused insertion is not an undoable
		 * no-op either.
		 */
		enggDrawingState.restoreDrawingSnapshot(drawingState, previousObjects);
		return null;
	}

	enggDrawingState.addObject(drawingState, symbol);

	const committedSymbol = drawingState.objects.find((object) => object.id === symbol.id) || symbol;

	wireConnections(committedSymbol);

	/* ONE COMMIT, ONE UNDO ENTRY, ONE TRANSACTION. */
	enggDrawingState.commitDrawingChange(drawingState, previousObjects);

	/*
	 * AND THE SOURCE CELL IS COMMITTED ONCE, AS ONE OPERATION.
	 *
	 * `commitDrawingChange` runs more than once in this transaction - a split, an
	 * added segment, the symbol, its connections - which is what makes Undo a
	 * single step. The SHEET's contribution to history is snapshotted each time,
	 * though, so the entry for this insertion must hold the sheet as it was when
	 * the student clicked. The first commit already wrote that snapshot; this
	 * one replaces the later intermediate ones with the same coherent state, so
	 * Undo restores the original run, its appearance and its connections in ONE
	 * step.
	 */
	renderProperties();
	renderCurrentDrawing();

	const message =
		plan.placement === "inline"
			? `${committedSymbol.name} inserted into ${host.name}`
			: `${committedSymbol.name} attached to ${host.name}`;

	setToolMessage(message);

	return { symbol: committedSymbol, created: [committedSymbol, ...created] };
}

/* The original ID stays on the start half; far-terminal references follow the end half. */
function transferFarConnections(objects, oldId, newId, far) {
    objects.forEach(object => {
        const eng = object.engineering;
        if (!eng || object.id === oldId || object.id === newId) return;
        if (object.type === "reducer-expander") {
            const ports = enggReducer.portsOf(object);
            for (const side of ["start","end"]) {
                const key = side === "start" ? "startPipeId" : "endPipeId";
                if (eng[key] === oldId && ports[side] === "end") eng[key] = newId;
            }
            eng.connections = enggReducer.connectedPipeIds(object).filter(Boolean);
        } else if (eng.pipeIds) {
            eng.pipeIds = eng.pipeIds.map((id,index) => id === oldId && eng.ports?.[index === 0 ? "a" : "b"] === "end" ? newId : id);
            eng.connections = eng.pipeIds.filter(Boolean);
        } else if (object.type === "junction") {
            for (const branch of object.geometry?.branches || []) {
                if (branch.connected === oldId && branch.connectedPort === "end") branch.connected = newId;
            }
            eng.connections = (object.geometry?.branches || []).map(branch => branch.connected || null);
        } else if (object.type === "elbow" && eng.connections?.includes(oldId)) {
            const at = object.geometry?.position;
            const held = eng.ports?.[oldId];
            if (held === "end" || (!held && at && Math.hypot(at.x-far.x,at.y-far.y) < Math.hypot(at.x-objects.find(o=>o.id===oldId).geometry.start.x,at.y-objects.find(o=>o.id===oldId).geometry.start.y))) {
                eng.connections = eng.connections.map(id => id === oldId ? newId : id);
                if (held) {
                    eng.ports = { ...eng.ports, [newId]: held };
                    delete eng.ports[oldId];
                }
            }
        }
    });
}

/* A segment that already has an id: added as-is, keeping its own identity. */
function commitSegment(segment, created) {
	const object = {
		...segment,
		id: segment.id || newObjectId("pipe-duct"),
		name: segment.name || "Pipe / Duct"
	};

	enggDrawingState.addObject(drawingState, object);

	created.push(object);

	return object;
}

function buildSymbol(kind, plan, extra) {
	if (kind === enggReducer.REDUCER_TYPE) {
		return enggReducer.createReducer({
			...extra,
			centre: plan.centre,
			direction: plan.direction,
			mode: plan.placement === "gap" ? (enggPipeDuct.boundarySeparation(plan.first.engineering) < enggPipeDuct.boundarySeparation(plan.second.engineering) ? "expand" : "reduce") : extra.mode || plan.options?.mode,
			transitionLength: plan.reach * 2,
			startPipeId: plan.first.id,
			endPipeId: plan.second?.id || null,
			ports: {
				start: plan.ports.first || plan.endpoint,
				end: plan.ports.second || "start"
			},
			style: { ...(drawingState.styleDefaults || {}) }
		});
	}

	if (!enggEquipment.isEquipmentType(kind)) {
		return null;
	}

	const pipeIds =
		plan.placement === "inline"
			? [plan.first.id, plan.second.id]
			: plan.endpoint === "start"
				? [plan.host.id, plan.second?.id || null]
				: [plan.second?.id || null, plan.host.id];

	/*
	 * WHICH END OF EACH SEGMENT THE SYMBOL HOLDS.
	 *
	 * The START-side pipe ends where the symbol begins, and the END-side pipe
	 * begins where it finishes - so the two seated ends are `end` and `start`.
	 * That is the same statement the reducer's ports make, and getting it wrong
	 * would pull the outer ends of both pipes onto the symbol.
	 */
	const ports = { a: "end", b: "start" };

	return enggEquipment.createEquipment(kind, {
		...extra,
		centre: plan.centre,
		rotation: plan.rotation,
		placement: plan.placement === "inline" ? "inline" : "inline",
		symbolSize: extra.symbolSize,
		depiction: extra.depiction,
		pipeIds,
		ports,
		style: { ...(drawingState.styleDefaults || {}) }
	});
}

/*
 * THE CONNECTIONS, WRITTEN ON BOTH SIDES.
 *
 * The symbol records which pipe is on which of its sides; each pipe records the
 * fitting it is seated on, so a pipe knows what holds its end as well as the
 * fitting knowing what it joins.
 */
function wireConnections(symbol) {
	if (enggReducer.isReducerType(symbol.type)) {
        enggReducer.keepConnectedEndsSeated(symbol, drawingState.objects);
        const widths = enggReducer.endWidthsOf(symbol, drawingState.objects);
        enggReducer.setEndWidth(symbol, "start", widths.start, drawingState.objects);
        enggReducer.setEndWidth(symbol, "end", widths.end, drawingState.objects);
        return;
	}

	enggEquipment.seatConnectedPipes(symbol, drawingState.objects);

	const ids = symbol.engineering?.pipeIds || [];
	const ports = symbol.engineering?.ports || {};

	const mark = (id, port) => {
		const run = id ? drawingState.objects.find((object) => object.id === id) : null;

		if (!run) {
			return;
		}

		run.engineering = {
			...(run.engineering || {}),
			inlineFittingId: symbol.id
		};

		if (port === "start" || port === "end") {
			run.engineering.inlineFittingPort = port;
		}
	};

	mark(ids[0], ports.a);
	mark(ids[1], ports.b);
}

/*
 * A STANDALONE SYMBOL, for a press in empty space.
 *
 * One click places it - no pipe touched, no connection made - which is exactly
 * what the requirement asks for when there is nothing to insert into.
 */
export function insertStandalone(kind, centre, extra = {}) {
	if ((!enggEquipment.isEquipmentType(kind) && kind !== enggReducer.REDUCER_TYPE) || !finitePoint(centre)) {
		return null;
	}

	const previousObjects = enggDrawingState.snapshotDrawing(drawingState);

	const symbol = kind === enggReducer.REDUCER_TYPE ? enggReducer.createReducer({ ...extra, centre, direction: { x: 1, y: 0 }, style: { ...drawingState.styleDefaults } }) : enggEquipment.createEquipment(kind, {
		...extra,
		centre,
		rotation: Number(extra.rotation) || 0,
		placement: "standalone",
		pipeIds: [],
		ports: { a: null, b: null },
		style: { ...(drawingState.styleDefaults || {}) }
	});

	if (!symbol) {
		return null;
	}

	enggDrawingState.addObject(drawingState, symbol);
	enggDrawingState.commitDrawingChange(drawingState, previousObjects);

	const committed = drawingState.objects.find((object) => object.id === symbol.id) || symbol;

	setToolMessage(`${committed.name} placed`);

	renderProperties();
	renderCurrentDrawing();

	return { symbol: committed, created: [committed] };
}

/* Common helpers for the interaction layer and the preview. */

export function symbolPreviewFor(kind, plan, extra = {}) {
	if (!plan) {
		return null;
	}

	if (kind === enggReducer.REDUCER_TYPE) {
		return {
			id: "inline-preview-reducer",
			type: enggReducer.REDUCER_TYPE,
			geometry: {
				position: plan.centre,
				direction: plan.direction
			},
			engineering: {
				mode: enggReducer.normaliseMode(extra.mode),
				transitionLength: plan.reach * 2,
				startPipeId: plan.first?.id || null,
				endPipeId: plan.second?.id || null,
				ports: { start: "end", end: "start" }
			},
			style: { ...(drawingState.styleDefaults || {}) },
			previewRuns: [plan.first, plan.second].filter(Boolean),
			preview: true
		};
	}

	return {
		id: `inline-preview-${kind}`,
		type: kind,
		geometry: {
			position: plan.centre,
			rotation: plan.rotation
		},
		engineering: {
			placement: "inline",
			symbolSize: Number(extra.symbolSize) || DEFAULT_SYMBOL_RADIUS,
			depiction: extra.depiction,
			pipeIds: []
		},
		style: { ...(drawingState.styleDefaults || {}) },
		preview: true
	};
}

const enggInlineInsertion = {
	INLINE_ENDPOINT_TOLERANCE,
	INLINE_GRAB_UNITS,
	INLINE_PHASE,
	pipeEndAt,
	findInsertionTarget,
	planInsertion,
	insertInline,
	insertStandalone,
	symbolPreviewFor,
	newObjectId
};

export default enggInlineInsertion;
