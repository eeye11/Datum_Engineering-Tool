/*
 * ========================================================
 * INLINE EQUIPMENT: PUMP / VALVE / FLOW METER
 * ========================================================
 *
 * One model for the three symbols that sit IN a run of pipework, because they
 * are one kind of thing:
 *
 *   pump         a circle with a directional triangle inside it
 *   valve        two opposing wedges forming a bow-tie
 *   flow-meter   a circular gauge with a pointer
 *
 * Each is an ordinary, independently selectable object with its own style,
 * size, position and rotation. What makes it INLINE is only that its two
 * connection points are the ends of two pipe segments - the relationship is
 * recorded, not implied:
 *
 *   engineering.placement    "inline" | "standalone"
 *   engineering.pipeIds      the segments it joins, in its own axis order
 *   engineering.ports        which end of each segment it holds
 *   engineering.connections  the ids, flattened, for the same readers the
 *                            elbow's connection record serves
 *
 * ========================================================
 * THE SYMBOL OWNS A GAP, NOT THE PIPE
 * ========================================================
 *
 * An inline symbol occupies a stretch of the run: the two segments stop at its
 * connection points and nothing is drawn across it. The model therefore exposes
 * the two connection points (`connectionPoints`), and the pipeline that inserts
 * it trims the host to them. The symbol itself never removes or edits pipe
 * geometry - that is the insertion service's single transaction.
 *
 * ========================================================
 * A SCHEMATIC SYMBOL, NOT A SIMULATION
 * ========================================================
 *
 * No head, no curve, no flow rate and no reading is computed anywhere here. The
 * only thing these symbols know is how to draw themselves.
 */

import enggDrawingState from "../../../../shared/model/drawing-state.js";
import enggPipeDuct from "./pipe-duct.js";
import {
	DEFAULT_SYMBOL_RADIUS,
	finitePoint,
	unitVector
} from "./fluids-shared.js";

export const PUMP_TYPE = "pump";
export const VALVE_TYPE = "valve";
export const FLOW_METER_TYPE = "flow-meter";

/* The three types this model owns, in the sidebar's order. */
export const INLINE_EQUIPMENT_TYPES = Object.freeze([PUMP_TYPE, VALVE_TYPE, FLOW_METER_TYPE]);

export const EQUIPMENT_TYPE_LABELS = Object.freeze({
	[PUMP_TYPE]: "Pump",
	[VALVE_TYPE]: "Valve",
	[FLOW_METER_TYPE]: "Flow Meter"
});

/* A valve's schematic state: a purely visual depiction. */
export const VALVE_DEPICTIONS = Object.freeze(["generic", "open", "closed"]);

export const MIN_SYMBOL_RADIUS = 2;
export const MAX_SYMBOL_RADIUS = 40;

/* The proportions of each symbol, as fractions of its radius. */
export const VALVE_HALF_LENGTH_SHARE = 1.3;
export const PUMP_TRIANGLE_SHARE = 0.75;

export function isEquipmentType(type) {
	return INLINE_EQUIPMENT_TYPES.includes(type);
}

export function equipmentStringKey(type) {
	return (
		{
			[PUMP_TYPE]: "pump",
			[VALVE_TYPE]: "valve",
			[FLOW_METER_TYPE]: "flowMeter"
		}[type] || "equipment"
	);
}

/* ============================================================
 * THE SYMBOL'S OWN FRAME
 * ============================================================ */

export function symbolRadiusOf(object) {
	const value = Number(object?.engineering?.symbolSize);

	if (!Number.isFinite(value)) {
		return DEFAULT_SYMBOL_RADIUS;
	}

	return Math.min(MAX_SYMBOL_RADIUS, Math.max(MIN_SYMBOL_RADIUS, value));
}

export function placementOf(object) {
	return object?.engineering?.placement === "inline" ? "inline" : "standalone";
}

export function isInline(object) {
	return placementOf(object) === "inline" && Array.isArray(object?.engineering?.connections)
		? object.engineering.connections.some(Boolean)
		: false;
}

export function valveDepictionOf(object) {
	const depiction = object?.engineering?.depiction;

	return VALVE_DEPICTIONS.includes(depiction) ? depiction : "generic";
}

/* The symbol's centre and its rotation, in degrees. */
export function frameOf(object) {
	const geometry = object?.geometry || {};

	const centre = finitePoint(geometry.position) ? { x: geometry.position.x, y: geometry.position.y } : null;

	if (!centre) {
		return null;
	}

	const rotation = Number(geometry.rotation);

	return { center: centre, rotation: Number.isFinite(rotation) ? rotation : 0 };
}

/* ============================================================
 * THE CONNECTION POINTS
 * ============================================================
 *
 * The two points on the symbol's axis where pipework meets it. A circular symbol
 * (pump, meter) connects at its radius; a bow-tie valve at its half length.
 */
export function connectionOffset(object) {
	const radius = symbolRadiusOf(object);

	return isValveLike(object) ? radius * VALVE_HALF_LENGTH_SHARE : radius;
}

function isValveLike(object) {
	return object?.type === VALVE_TYPE;
}

export function connectionPoints(object) {
	const frame = frameOf(object);

	if (!frame) {
		return null;
	}

	const offset = connectionOffset(object);

	return {
		a: localToWorld(frame, { x: -offset, y: 0 }),
		b: localToWorld(frame, { x: offset, y: 0 }),
		axis: unitVector({ x: 0, y: 0 }, {
			x: Math.cos((frame.rotation * Math.PI) / 180),
			y: Math.sin((frame.rotation * Math.PI) / 180)
		})
	};
}

/*
 * THE SYMBOL'S OWN FRAME, AS ONE TRANSFORM.
 *
 * The symbol is drawn in its own coordinates (a circle about the origin, a
 * bow-tie between -h and +h) and placed by a centre and a rotation. This is the
 * only transform between the two, so the canvas, the hit test, the bounds and
 * the source writer all place a symbol the same way.
 */
export function localToWorld(frame, local) {
	const angle = ((Number(frame?.rotation) || 0) * Math.PI) / 180;
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);

	const x = Number(local?.x) || 0;
	const y = Number(local?.y) || 0;

	return {
		x: (frame?.center?.x || 0) + x * cos - y * sin,
		y: (frame?.center?.y || 0) + x * sin + y * cos
	};
}

/* ============================================================
 * THE GEOMETRY OF EACH SYMBOL, IN ITS OWN FRAME
 * ============================================================
 *
 * All three return `{ strokes, fills }` in LOCAL coordinates, so the canvas, the
 * TikZ writer, the hit test and the bounds all draw exactly one shape. The
 * caller places them with `localToWorld`.
 */
export function symbolGeometry(object) {
	const radius = symbolRadiusOf(object);

	switch (object?.type) {
		case PUMP_TYPE:
			return pumpGeometry(radius);
		case VALVE_TYPE:
			return valveGeometry(radius, valveDepictionOf(object));
		case FLOW_METER_TYPE:
			return meterGeometry(radius);
		default:
			return { strokes: [], fills: [] };
	}
}

function pumpGeometry(radius) {
	/*
	 * CIRCLE + DIRECTIONAL TRIANGLE. The triangle points along +x, which is the
	 * fitting's own axis, so an inline pump turns with the pipe.
	 */
	const triangle = [
		{ x: -radius * 0.45, y: -radius * PUMP_TRIANGLE_SHARE * 0.5 },
		{ x: radius * 0.58, y: 0 },
		{ x: -radius * 0.45, y: radius * PUMP_TRIANGLE_SHARE * 0.5 }
	];

	return {
		strokes: [{ kind: "circle", centre: { x: 0, y: 0 }, radius }],
		fills: [{ kind: "polygon", points: triangle, fillsWith: "stroke" }]
	};
}

function valveGeometry(radius, depiction) {
	const half = radius * VALVE_HALF_LENGTH_SHARE;
	const height = radius;

	/*
	 * TWO OPPOSING WEDGES meeting at the origin - the bow-tie. The depiction is
	 * purely visual: `closed` adds a bar across the waist, which is how a closed
	 * valve is drawn, and the connection points are unchanged either way.
	 */
	const strokes = [
		{
			kind: "polygon",
			points: [
				{ x: -half, y: -height / 2 },
				{ x: 0, y: 0 },
				{ x: -half, y: height / 2 }
			]
		},
		{
			kind: "polygon",
			points: [
				{ x: half, y: -height / 2 },
				{ x: 0, y: 0 },
				{ x: half, y: height / 2 }
			]
		}
	];

	if (depiction === "closed") {
		strokes.push({
			kind: "line",
			start: { x: 0, y: -height / 2 },
			end: { x: 0, y: height / 2 }
		});
	}

	if (depiction === "open") {
		/* A handled valve: the stem and its hand wheel, above the waist. */
		strokes.push({ kind: "line", start: { x: 0, y: 0 }, end: { x: 0, y: height * 0.95 } });
		strokes.push({ kind: "line", start: { x: -radius * 0.3, y: height * 0.95 }, end: { x: radius * 0.3, y: height * 0.95 } });
	}

	return { strokes, fills: [] };
}

function meterGeometry(radius) {
	/*
	 * CIRCLE + POINTER. The pointer is drawn a little off the axis so the symbol
	 * is unmistakably a GAUGE and never reads as a pump's triangle.
	 */
	return {
		strokes: [
			{ kind: "circle", centre: { x: 0, y: 0 }, radius },
			{
				kind: "line",
				start: { x: -radius * 0.45, y: -radius * 0.45 },
				end: { x: radius * 0.45, y: radius * 0.45 }
			}
		],
		fills: [{ kind: "dot", centre: { x: 0, y: 0 }, radius: Math.max(0.5, radius * 0.12) }]
	};
}

/* ============================================================
 * HIT TESTING AND BOUNDS
 * ============================================================ */

/* Whether a point is on or inside the symbol. */
export function equipmentContainsPoint(object, point, tolerance = 0) {
	const frame = frameOf(object);

	if (!frame || !finitePoint(point)) {
		return false;
	}

	const radius = symbolRadiusOf(object);

	/* The valve is a long thin symbol; its box is the grab area. */
	const reach = isValveLike(object) ? radius * VALVE_HALF_LENGTH_SHARE : radius;

	const dx = point.x - frame.center.x;
	const dy = point.y - frame.center.y;

	const distance = Math.hypot(dx, dy);

	return distance <= Math.hypot(reach, radius * 0.5) + tolerance;
}

/* The symbol's bounding box, for the selection outline. */
export function equipmentBounds(object) {
	const frame = frameOf(object);

	if (!frame) {
		return null;
	}

	const radius = symbolRadiusOf(object);
	const reach = isValveLike(object) ? radius * VALVE_HALF_LENGTH_SHARE : radius;
	const halfHeight = isValveLike(object) ? radius * 0.5 : radius;

	const corners = [
		{ x: -reach, y: -halfHeight },
		{ x: reach, y: -halfHeight },
		{ x: reach, y: halfHeight },
		{ x: -reach, y: halfHeight }
	].map((local) => localToWorld(frame, local));

	return {
		minX: Math.min(...corners.map((corner) => corner.x)),
		maxX: Math.max(...corners.map((corner) => corner.x)),
		minY: Math.min(...corners.map((corner) => corner.y)),
		maxY: Math.max(...corners.map((corner) => corner.y))
	};
}

/* ============================================================
 * CREATION
 * ============================================================ */

export function createEquipment(type, options = {}) {
	if (!isEquipmentType(type)) {
		return null;
	}

	const centre = finitePoint(options.centre) ? { ...options.centre } : { x: 0, y: 0 };

	const rotation = Number.isFinite(Number(options.rotation)) ? Number(options.rotation) : 0;

	const size = Number(options.symbolSize);

	const engineering = {
		placement: options.placement === "inline" ? "inline" : "standalone",
		symbolSize: Number.isFinite(size) ? Math.min(MAX_SYMBOL_RADIUS, Math.max(MIN_SYMBOL_RADIUS, size)) : DEFAULT_SYMBOL_RADIUS,
		pipeIds: Array.isArray(options.pipeIds) ? options.pipeIds.filter(Boolean) : [],
		ports:
			options.ports && typeof options.ports === "object"
				? { a: options.ports.a || null, b: options.ports.b || null }
				: { a: null, b: null },
		connections: Array.isArray(options.pipeIds) ? options.pipeIds.filter(Boolean) : [],
		...(type === VALVE_TYPE ? { depiction: VALVE_DEPICTIONS.includes(options.depiction) ? options.depiction : "generic" } : {})
	};

	return enggDrawingState.createGeometryObject(
		type,
		{
			position: { x: centre.x, y: centre.y },
			rotation
		},
		{
			...options,
			engineering
		}
	);
}

/* Set the symbol's size, keeping its connection points seated. */
export function setSymbolSize(object, size) {
	const value = Number(size);

	if (!isEquipmentType(object?.type) || !Number.isFinite(value)) {
		return false;
	}

	object.engineering = {
		...(object.engineering || {}),
		symbolSize: Math.min(MAX_SYMBOL_RADIUS, Math.max(MIN_SYMBOL_RADIUS, value))
	};

	seatConnectedPipes(object);
	return true;
}

/*
 * KEEP AN INLINE SYMBOL'S TWO PIPES AT ITS CONNECTION POINTS.
 *
 * Called after a move, a rotation, a resize or a depiction change. Only the
 * recorded port on each segment is written, so an inline symbol can never pull a
 * pipe's free end with it.
 *
 * WHEN THE CALLER PASSES THE SHEET, THE SYMBOL IS FOUND IN IT. A caller that has
 * just added the symbol holds the pre-`addObject` copy, and the sheet now has a
 * NAMED copy of it - a different object. Seating the copy would move nothing,
 * so the sheet's own object is seated whenever it can be found.
 */
export function seatConnectedPipes(object, objects = null) {
  const sheetObject =
    Array.isArray(objects) && object?.id
      ? objects.find((candidate) => candidate?.id === object.id) || null
      : null;

  const target = sheetObject || object;

  if (!isInline(target)) {
    return false;
  }

  const points = connectionPoints(target);
  const ids = target.engineering.pipeIds || [];
  const ports = target.engineering.ports || {};

  if (!points) {
    return false;
  }

  const findRun = (id) => {
    if (!id) {
      return null;
    }

    if (Array.isArray(objects)) {
      return objects.find((candidate) => candidate?.id === id) || null;
    }

    return enggPipeDuct.connectedPipe(id);
  };

  const seat = (id, port, at) => {
    const run = findRun(id);

    if (!run?.geometry || (port !== "start" && port !== "end") || !finitePoint(at)) {
      return;
    }

    /*
     * THE SEGMENT'S SPAN FOLLOWS ITS NEW END, or its walls would drift: a run's
     * walls are offset from its SPAN, the line it was drawn along, so a piece
     * whose held end moved must have its span moved with it.
     */
    run.geometry = {
      ...run.geometry,
      [port]: { x: at.x, y: at.y },
      span: {
        start: {
          ...(port === "start" ? at : run.geometry.start)
        },
        end: {
          ...(port === "end" ? at : run.geometry.end)
        }
      }
    };
  };

  seat(ids[0], ports.a, points.a);
  seat(ids[1], ports.b, points.b);

  return true;
}

/* ============================================================
 * POSITION ALONG THE HOST
 * ============================================================
 *
 * An inline symbol has ONE placement degree of freedom: how far along its host
 * run it sits. The host is the run whose held end is a symbol connection point
 * and whose FREE end is the one the student owns; sliding the symbol re-seats
 * the held ends and moves the symbol's own centre so the gap stays exactly the
 * symbol's reach.
 *
 * The stored value is the fraction of the HOST CENTRELINE the symbol's centre
 * projects to, so a typed value, a dragged body handle and the source metadata
 * all speak the same number.
 */
export function hostRunOf(object, objects = null) {
  const ids = Array.isArray(object?.engineering?.pipeIds) ? object.engineering.pipeIds : [];

  const list = Array.isArray(objects) ? objects : null;

  const find = (id) =>
    id ? (list ? list.find((candidate) => candidate?.id === id) || null : enggPipeDuct.connectedPipe(id)) : null;

  // Measure across the two free ends. Measuring only the first split segment
  // makes the position fraction change every time the symbol is moved.
  const first = find(ids[0]);
  const second = find(ids[1]);
  const ports = object?.engineering?.ports || {};
  const farEnd = (run, port) =>
    port === "start" ? run?.geometry?.end : port === "end" ? run?.geometry?.start : null;
  const start = farEnd(first, ports.a);
  const end = farEnd(second, ports.b);

  if (finitePoint(start) && finitePoint(end)) {
    return { ...first, geometry: { start: { ...start }, end: { ...end } } };
  }

  for (const id of ids) {
    const run = find(id);

    if (run?.geometry?.start && run?.geometry?.end) {
      return run;
    }
  }

  return null;
}

/* The fraction of the host's centreline nearest a world point, clamped inside it. */
export function fractionAlongRun(run, point) {
  const start = run?.geometry?.start;
  const end = run?.geometry?.end;

  if (!start || !end || !finitePoint(point)) {
    return null;
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared < 1e-12) {
    return null;
  }

  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;

  return Math.min(0.98, Math.max(0.02, t));
}

/* Where the symbol's centre would sit at a fraction along the host. */
export function centreAtFraction(run, fraction) {
  const start = run?.geometry?.start;
  const end = run?.geometry?.end;

  if (!start || !end) {
    return null;
  }

  const t = Math.min(0.98, Math.max(0.02, Number(fraction)));

  return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
}

/*
 * SLIDE AN INLINE SYMBOL ALONG ITS HOST.
 *
 * The centre is moved onto the run's centreline at the fraction nearest the
 * pointer, the symbol is turned to lie along the run, and both held pipe ends
 * are re-seated on its connection points - one coherent edit, never a gap.
 */
export function slideAlongHost(object, point, objects = null) {
  if (!isEquipmentType(object?.type) || !isInline(object)) {
    return false;
  }

  const host = hostRunOf(object, objects);

  if (!host) {
    return false;
  }

  const fraction = fractionAlongRun(host, point);

  if (fraction === null) {
    return false;
  }

  const centre = centreAtFraction(host, fraction);

  const start = host.geometry.start;
  const end = host.geometry.end;

  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const clearance = connectionOffset(object) + 1;

  if (fraction * length < clearance || (1 - fraction) * length < clearance) {
    return false;
  }

  object.geometry = {
    ...object.geometry,
    position: centre,
    rotation: (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI
  };

  seatConnectedPipes(object, objects);

  return true;
}

/* A description for the Features panel, the writer and the tests. */
export function describeEquipment(object, objects = null) {
	const points = connectionPoints(object);
	const frame = frameOf(object);
	const host = isInline(object) ? hostRunOf(object, objects) : null;

	const along = host && frame ? fractionAlongRun(host, frame.center) : null;

	const ids = Array.isArray(object?.engineering?.pipeIds) ? object.engineering.pipeIds : [];

	const lookUp = (id) => (id ? enggPipeDuct.connectedPipe(id) : null);

	return {
		type: object?.type || null,
		label: EQUIPMENT_TYPE_LABELS[object?.type] || "Equipment",
		placement: placementOf(object),
		inline: isInline(object),
		radius: symbolRadiusOf(object),
		centre: frame ? frame.center : null,
		rotation: frame ? frame.rotation : 0,
		pipeIds: ids,
		    pipeNames: ids.map((id) => lookUp(id)?.name || null),
		    depiction: object?.type === VALVE_TYPE ? valveDepictionOf(object) : null,
		    positionAlongPipe: along,
		    hostPipeId: host?.id || null,
		    hostPipeName: host?.name || null,
		    points
		  };
		}

const enggInlineEquipment = {
	PUMP_TYPE,
	VALVE_TYPE,
	FLOW_METER_TYPE,
	INLINE_EQUIPMENT_TYPES,
	EQUIPMENT_TYPE_LABELS,
	VALVE_DEPICTIONS,
	MIN_SYMBOL_RADIUS,
	MAX_SYMBOL_RADIUS,
	VALVE_HALF_LENGTH_SHARE,
	isEquipmentType,
	equipmentStringKey,
	symbolRadiusOf,
	placementOf,
	isInline,
	valveDepictionOf,
	frameOf,
	connectionOffset,
	connectionPoints,
	localToWorld,
	symbolGeometry,
	equipmentContainsPoint,
	equipmentBounds,
	  createEquipment,
	  setSymbolSize,
	  seatConnectedPipes,
	  hostRunOf,
	  fractionAlongRun,
	  centreAtFraction,
	  slideAlongHost,
	  describeEquipment
	};

export default enggInlineEquipment;
