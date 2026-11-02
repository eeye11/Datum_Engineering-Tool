/*
 * ========================================================
 * FLOW ARROWS: FREE, AND ON A PATH
 * ========================================================
 *
 * Two annotations that look alike and are NOT the same thing:
 *
 *   flow-arrow              a FREE directional arrow, drawn tail to tip. It has
 *                           a position, a length and an angle of its own, and
 *                           it is not attached to anything.
 *
 *   flow-direction-diagram  a directional arrow ON a pipe. Its position is a
 *                           fraction along that pipe and its angle is the
 *                           pipe's, so it stays on the run when the run moves.
 *
 * ========================================================
 * NEITHER INFERS A DIRECTION
 * ========================================================
 *
 * Both store a `reversed` flag, which is the student's statement of which way
 * the fluid goes. Nothing looks at a pump's orientation, at the network topology
 * or at a pressure to decide it - so a drawing never contains a flow direction
 * nobody drew.
 */

import enggDrawingState from "../../../../shared/model/drawing-state.js";
import enggPipeDuct from "./pipe-duct.js";
import {
	DEFAULT_ARROW_LENGTH,
	finitePoint,
	unitVector
} from "./fluids-shared.js";

export const FREE_FLOW_ARROW_TYPE = "flow-arrow";
export const FLOW_DIRECTION_TYPE = "flow-direction-diagram";

export const MIN_FREE_ARROW_LENGTH = 2;
export const MAX_FREE_ARROW_LENGTH = 400;

/* Where a directional annotation may sit along its pipe. */
export const DIRECTION_EDGE_MARGIN = 0.06;
export const DIRECTION_DEFAULT_FRACTION = 0.5;

/* How many arrows a directional annotation may show along its segment. */
export const MIN_DIRECTION_ARROWS = 1;
export const MAX_DIRECTION_ARROWS = 6;

export const DIRECTION_SPACING = Object.freeze([
	{ id: "single", label: "Single" },
	{ id: "pair", label: "Pair" },
	{ id: "triple", label: "Triple" }
]);

export const DIRECTION_SPACING_COUNTS = Object.freeze({ single: 1, pair: 2, triple: 3 });

export function isFreeFlowArrowType(type) {
	return type === FREE_FLOW_ARROW_TYPE;
}

export function isFlowDirectionType(type) {
	return type === FLOW_DIRECTION_TYPE;
}

/* ============================================================
 * THE FREE ARROW
 * ============================================================
 *
 * `geometry.start` is the tail, `geometry.end` the tip. That is the whole model.
 * The arrowhead is drawn at `end`, and its size is the object's style
 * (`headSize`), so a free arrow is an ordinary span-shaped feature: two handles,
 * a body move, a rotation, a length.
 */
export function freeArrowSpan(arrow) {
	const start = arrow?.geometry?.start;
	const end = arrow?.geometry?.end;

	if (!finitePoint(start) || !finitePoint(end)) {
		return null;
	}

	const direction = unitVector(start, end);
	const length = Math.hypot(end.x - start.x, end.y - start.y);

	if (!direction || length < 1e-9) {
		return null;
	}

	return {
		start: { x: start.x, y: start.y },
		end: { x: end.x, y: end.y },
		direction,
		length
	};
}

export function createFreeFlowArrow(start, end, options = {}) {
	const span = freeArrowSpan({ geometry: { start, end } });

	if (!span) {
		return null;
	}

	return enggDrawingState.createGeometryObject(
		FREE_FLOW_ARROW_TYPE,
		{
			start: { x: start.x, y: start.y },
			end: { x: end.x, y: end.y }
		},
		{
			...options,
			engineering: { ...(options.engineering || {}) }
		}
	);
}

/* The free arrow's length, in drawing units. */
export function freeArrowLength(arrow) {
	const span = freeArrowSpan(arrow);

	return span ? span.length : 0;
}

/* Set the length along the arrow's own direction, from its tail. */
export function setFreeArrowLength(arrow, length) {
	const span = freeArrowSpan(arrow);
	const value = Number(length);

	if (!span || !Number.isFinite(value) || value < MIN_FREE_ARROW_LENGTH) {
		return false;
	}

	arrow.geometry = {
		...arrow.geometry,
		end: {
			x: span.start.x + span.direction.x * value,
			y: span.start.y + span.direction.y * value
		}
	};

	return true;
}

/* A default arrow for a press with no drag, so the tool always makes something. */
export function defaultFreeArrow(start) {
	if (!finitePoint(start)) {
		return null;
	}

	return { start: { x: start.x, y: start.y }, end: { x: start.x + DEFAULT_ARROW_LENGTH, y: start.y } };
}

/* ============================================================
 * THE DIRECTIONAL ANNOTATION ON A PIPE
 * ============================================================
 *
 *   engineering.pipeId     the segment it belongs to
 *   engineering.position   the fraction along that segment's centreline
 *   engineering.reversed   whether its arrows point against the segment
 *   engineering.spacing    "single" | "pair" | "triple"
 *   engineering.arrowSize  how big each arrow is
 */
export function directionPipeId(annotation) {
	return annotation?.engineering?.pipeId || null;
}

export function directionHost(annotation, objects = null) {
	const id = directionPipeId(annotation);

	if (!id) {
		return null;
	}

	const list = Array.isArray(objects) ? objects : null;

	const found = list
		? list.find((object) => object?.id === id && enggPipeDuct.isPipeDuctType(object.type))
		: null;

	return found || enggPipeDuct.connectedPipe(id);
}

export function clampDirectionFraction(fraction) {
	const value = Number(fraction);

	if (!Number.isFinite(value)) {
		return DIRECTION_DEFAULT_FRACTION;
	}

	return Math.min(1 - DIRECTION_EDGE_MARGIN, Math.max(DIRECTION_EDGE_MARGIN, value));
}

export function directionFractionOf(annotation) {
	return clampDirectionFraction(annotation?.engineering?.position);
}

export function directionSpacingOf(annotation) {
	const spacing = annotation?.engineering?.spacing;

	return spacing in DIRECTION_SPACING_COUNTS ? spacing : "single";
}

export function directionArrowSizeOf(annotation) {
	const size = Number(annotation?.engineering?.arrowSize);

	return Number.isFinite(size) && size > 0 ? size : DEFAULT_ARROW_LENGTH / 2;
}

/*
 * THE HOST'S CENTRELINE, as the route segment the arrows ride.
 *
 * A Pipe / Duct is straight today, and this reads its two stored ends - the
 * visible centreline - so a run seated on a fitting gives the arrows the reach
 * the student can actually see. A curved host would be answered with its sampled
 * points by the same accessor, which is why it is a list of spans rather than a
 * single pair.
 */
export function directionSpans(annotation, objects = null) {
	const host = directionHost(annotation, objects);

	if (!host) {
		return [];
	}

	const start = enggPipeDuct.drawnSpan(host)?.start || host.geometry?.start;
	const end = enggPipeDuct.drawnSpan(host)?.end || host.geometry?.end;

	const direction = unitVector(start, end);

	if (!direction) {
		return [];
	}

	return [
		{
			start: { x: start.x, y: start.y },
			end: { x: end.x, y: end.y },
			direction,
			length: Math.hypot(end.x - start.x, end.y - start.y)
		}
	];
}

/* The point a fraction names, along the host's route. */
export function directionPointAt(annotation, fraction, objects = null) {
	const spans = directionSpans(annotation, objects);

	if (!spans.length) {
		return null;
	}

	const total = spans.reduce((sum, span) => sum + span.length, 0);
	const wanted = clampDirectionFraction(fraction) * total;

	let remaining = wanted;

	for (const span of spans) {
		if (remaining <= span.length) {
			return {
				point: {
					x: span.start.x + span.direction.x * remaining,
					y: span.start.y + span.direction.y * remaining
				},
				direction: span.direction
			};
		}

		remaining -= span.length;
	}

	const last = spans[spans.length - 1];

	return { point: { ...last.end }, direction: last.direction };
}

/*
 * THE ARROWS THEMSELVES: alternates placed around the anchor fraction.
 *
 * Each is `{ start, end, direction }`, drawn along the host's local direction
 * (reversed when the student said so). The arrows are spread over the anchor so
 * a pair reads as "flow along here" rather than as one arrow with a shadow.
 */
export function directionArrowShapes(annotation, objects = null) {
	const anchor = directionFractionOf(annotation);
	const count = DIRECTION_SPACING_COUNTS[directionSpacingOf(annotation)] || 1;
	const size = directionArrowSizeOf(annotation);
	const reversed = annotation?.engineering?.reversed === true;

	const spans = directionSpans(annotation, objects);

	if (!spans.length) {
		return [];
	}

	const routeLength = spans.reduce((sum, span) => sum + span.length, 0);

	const shapes = [];

	for (let index = 0; index < count; index += 1) {
		const offset = count === 1 ? 0 : (index - (count - 1) / 2) * (size * 1.6);

		const fraction = clampDirectionFraction(anchor + offset / Math.max(routeLength, 1e-9));

		const at = directionPointAt(annotation, fraction, objects);

		if (!at) {
			continue;
		}

		const direction = reversed
			? { x: -at.direction.x, y: -at.direction.y }
			: { x: at.direction.x, y: at.direction.y };

		const centred = {
			x: at.point.x - direction.x * (size / 2),
			y: at.point.y - direction.y * (size / 2)
		};

		shapes.push({
			start: centred,
			end: { x: at.point.x + direction.x * (size / 2), y: at.point.y + direction.y * (size / 2) },
			direction,
			length: size
		});
	}

	return shapes;
}

export function createFlowDirection(pipe, options = {}) {
	if (!enggPipeDuct.isPipeDuctType(pipe?.type)) {
		return null;
	}

	const fraction = clampDirectionFraction(options.position);

	const engineering = {
		pipeId: pipe.id,
		position: fraction,
		reversed: options.reversed === true,
		spacing: options.spacing in DIRECTION_SPACING_COUNTS ? options.spacing : "single",
		arrowSize: Number(options.arrowSize) > 0 ? Number(options.arrowSize) : DEFAULT_ARROW_LENGTH / 2
	};

	const at = directionPointAt({ engineering }, fraction);

	/*
	 * THE ANNOTATION IS ON THE SHEET ONLY AFTER `addObject`. Its host is found
	 * through the document's published lookup (`pipe-duct.js`), so a caller that
	 * builds one BEFORE adding it - a test, the source reader - hands the host in
	 * with `options.host` and gets the same anchor arithmetic.
	 */
	const host = options.host && options.host.id === pipe.id ? options.host : null;

	const anchor = host
		? (() => {
				const start = host.geometry?.start;
				const end = host.geometry?.end;

				if (!start || !end) {
					return null;
				}

				return {
					point: {
						x: start.x + (end.x - start.x) * fraction,
						y: start.y + (end.y - start.y) * fraction
					},
					direction: unitVector(start, end)
				};
		  })()
		: at;

	return enggDrawingState.createGeometryObject(
		FLOW_DIRECTION_TYPE,

		/*
		 * THE GEOMETRY MIRROR. The attachment is the model, and the anchor is
		 * written beside it so a saved file has something to draw even before
		 * the host is looked up - exactly as the Flow Arrow does.
		 */
		{
			pipeId: pipe.id,
			fraction,
			reversed: engineering.reversed,
			anchor: anchor ? anchor.point : null,
			direction: anchor
				? engineering.reversed
					? { x: -anchor.direction.x, y: -anchor.direction.y }
					: anchor.direction
				: null
		},
		{
			...options,

					/*
					 * THE ANNOTATION'S MODEL, SPREAD ONTO THE FEATURE.
					 *
					 * `createGeometryObject` spreads `content` rather than nesting it (see its
					 * own note), so this becomes `annotation.engineering` - which is where every
					 * reader of the annotation looks. The PIPE is recorded too, because
					 * `addObject` keeps only the fixed fields plus `content`, `parentId` and
					 * `engineering`: anything a model needs to stay a whole object travels in
					 * one of those.
					 */
					content: engineering,
					parentId: pipe.id,
					engineering: { ...engineering, pipeId: pipe.id }
				}
				);
			}

/* Re-derive the mirror after the annotation or its host changed. */
export function refreshFlowDirection(annotation, objects = null) {
	if (!isFlowDirectionType(annotation?.type)) {
		return false;
	}

	const fraction = directionFractionOf(annotation);
	const at = directionPointAt(annotation, fraction, objects);

	if (!at) {
		return false;
	}

	const reversed = annotation.engineering?.reversed === true;

	annotation.geometry = {
		...(annotation.geometry || {}),
		pipeId: annotation.engineering?.pipeId || null,
		fraction,
		reversed,
		anchor: at.point,
		direction: reversed ? { x: -at.direction.x, y: -at.direction.y } : at.direction
	};

	return true;
}

/* Move the annotation to the fraction nearest a point on its host. */
export function setDirectionFromPoint(annotation, point, objects = null) {
	const host = directionHost(annotation, objects);
	const start = host?.geometry?.start;
	const end = host?.geometry?.end;

	if (!finitePoint(start) || !finitePoint(end) || !finitePoint(point)) {
		return false;
	}

	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const lengthSquared = dx * dx + dy * dy;

	if (lengthSquared < 1e-12) {
		return false;
	}

	const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;

	annotation.engineering = {
		...(annotation.engineering || {}),
		position: clampDirectionFraction(t)
	};

	return refreshFlowDirection(annotation, objects);
}

export function setDirectionReversed(annotation, reversed) {
	if (!isFlowDirectionType(annotation?.type)) {
		return false;
	}

	/* THE ANNOTATION TURNS, THE PIPE DOES NOT. */
	annotation.engineering = { ...(annotation.engineering || {}), reversed: Boolean(reversed) };

	return refreshFlowDirection(annotation);
}

/* Whether a point is on one of the annotation's arrows. */
export function directionContainsPoint(annotation, point, tolerance = 0, objects = null) {
	return directionArrowShapes(annotation, objects).some((shape) => {
		const dx = shape.end.x - shape.start.x;
		const dy = shape.end.y - shape.start.y;
		const lengthSquared = dx * dx + dy * dy;

		if (lengthSquared < 1e-12) {
			return false;
		}

		const t = ((point.x - shape.start.x) * dx + (point.y - shape.start.y) * dy) / lengthSquared;

		if (t < -0.1 || t > 1.1) {
			return false;
		}

		const foot = { x: shape.start.x + dx * t, y: shape.start.y + dy * t };

		return Math.hypot(point.x - foot.x, point.y - foot.y) <= tolerance;
	});
}

const enggFlowArrows = {
	FREE_FLOW_ARROW_TYPE,
	FLOW_DIRECTION_TYPE,
	MIN_FREE_ARROW_LENGTH,
	MAX_FREE_ARROW_LENGTH,
	DIRECTION_EDGE_MARGIN,
	DIRECTION_DEFAULT_FRACTION,
	MIN_DIRECTION_ARROWS,
	MAX_DIRECTION_ARROWS,
	DIRECTION_SPACING,
	isFreeFlowArrowType,
	isFlowDirectionType,
	freeArrowSpan,
	createFreeFlowArrow,
	freeArrowLength,
	setFreeArrowLength,
	defaultFreeArrow,
	directionPipeId,
	directionHost,
	clampDirectionFraction,
	directionFractionOf,
	directionSpacingOf,
	directionArrowSizeOf,
	directionSpans,
	directionPointAt,
	directionArrowShapes,
	createFlowDirection,
	refreshFlowDirection,
	setDirectionFromPoint,
	setDirectionReversed,
	directionContainsPoint
};

export default enggFlowArrows;
