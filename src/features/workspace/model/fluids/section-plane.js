/*
 * ========================================================
 * SECTION PLANE
 * ========================================================
 *
 * A 2D section-location annotation: the trace line, up to two viewing-direction
 * arrows and an optional identifier ("A"). It marks where a section is taken; it
 * does not cut anything.
 *
 *   geometry.start / geometry.end   the trace, in drawing coordinates
 *   engineering.direction           "forward" | "reverse" - which way the arrows look
 *   engineering.identifier          the student's own text; empty by default
 *   engineering.showArrows          whether the viewing arrows are drawn
 *
 * ========================================================
 * IT DOES NOTHING TO THE PIPEWORK
 * ========================================================
 *
 * A section line drawn across a run leaves that run exactly as it was: no split,
 * no connection, no clipping. It is a piece of annotation, and DAETUM draws it
 * and nothing else with it.
 *
 * The viewing arrows are drawn from the MIDDLE of the trace, perpendicular to
 * it, pointing to the side the student chose. Reversing them reverses the
 * arrows only - the trace does not move and its ends do not swap.
 */

import enggDrawingState from "../../../../shared/model/drawing-state.js";
import {
	DEFAULT_SECTION_LENGTH,
	finitePoint,
	normalOf,
	unitVector
} from "./fluids-shared.js";

export const SECTION_PLANE_TYPE = "section-plane";

export const SECTION_DIRECTIONS = Object.freeze(["forward", "reverse"]);

/* How far past each end of the trace the arrows stand, and how long they are. */
export const ARROW_OFFSET_SHARE = 0.35;
export const ARROW_LENGTH_SHARE = 0.6;
export const MIN_SECTION_LENGTH = 1;

export function isSectionPlaneType(type) {
	return type === SECTION_PLANE_TYPE;
}

export function sectionDirectionOf(section) {
	return section?.engineering?.direction === "reverse" ? "reverse" : "forward";
}

export function sectionIdentifierOf(section) {
	return String(section?.engineering?.identifier ?? "");
}

export function showSectionArrowsOf(section) {
	return section?.engineering?.showArrows !== false;
}

/* The trace, as two points and its direction. */
export function sectionSpan(section) {
	const start = section?.geometry?.start;
	const end = section?.geometry?.end;

	if (!finitePoint(start) || !finitePoint(end)) {
		return null;
	}

	const direction = unitVector(start, end);

	if (!direction) {
		return null;
	}

	return {
		start: { x: start.x, y: start.y },
		end: { x: end.x, y: end.y },
		direction,
		length: Math.hypot(end.x - start.x, end.y - start.y)
	};
}

/*
 * THE VIEWING ARROWS.
 *
 * Each is `{ start, end }`. They stand off the middle of the trace, to either
 * side of it along its normal, a little inside each end - the conventional
 * section mark - and point along the normal.
 */
export function sectionArrows(section) {
	const span = sectionSpan(section);

	if (!span) {
		return [];
	}

	const normal = normalOf(span.direction);

	const sign = sectionDirectionOf(section) === "reverse" ? -1 : 1;

	const look = { x: normal.x * sign, y: normal.y * sign };

	const length = Math.max(1, span.length * ARROW_OFFSET_SHARE);
	const reach = Math.max(2, span.length * ARROW_LENGTH_SHARE);

	return [1, -1].map((side) => {
		const base = {
			x: span.start.x + span.direction.x * (span.length / 2 + (length / 2) * side),
			y: span.start.y + span.direction.y * (span.length / 2 + (length / 2) * side)
		};

		return {
			start: base,
			end: { x: base.x + look.x * reach, y: base.y + look.y * reach },
			direction: look
		};
	});
}

/* The identifier's anchor: just past the far end of the trace. */
export function sectionLabelPoint(section) {
	const span = sectionSpan(section);

	if (!span) {
		return null;
	}

	const normal = normalOf(span.direction);
	const sign = sectionDirectionOf(section) === "reverse" ? -1 : 1;
	const offset = Math.max(2, span.length * 0.18);

	return {
		x: span.end.x - normal.x * sign * offset,
		y: span.end.y - normal.y * sign * offset
	};
}

export function createSectionPlane(start, end, options = {}) {
	const span = sectionSpan({ geometry: { start, end } });

	if (!span || span.length < MIN_SECTION_LENGTH) {
		return null;
	}

	return enggDrawingState.createGeometryObject(
		SECTION_PLANE_TYPE,
		{
			start: { x: span.start.x, y: span.start.y },
			end: { x: span.end.x, y: span.end.y }
		},
		{
			...options,
			engineering: {
				direction: SECTION_DIRECTIONS.includes(options.direction) ? options.direction : "forward",
				identifier: String(options.identifier ?? ""),
				showArrows: options.showArrows !== false
			}
		}
	);
}

/* A section mark at a click, drawn perpendicular to a pipe when one is under it. */
export function defaultSectionSpan(point, direction = { x: 0, y: 1 }) {
	if (!finitePoint(point)) {
		return null;
	}

	const unit = unitVector({ x: 0, y: 0 }, direction) || { x: 0, y: 1 };
	const half = DEFAULT_SECTION_LENGTH / 2;

	return {
		start: { x: point.x - unit.x * half, y: point.y - unit.y * half },
		end: { x: point.x + unit.x * half, y: point.y + unit.y * half }
	};
}

export function setSectionDirection(section, direction) {
	if (!isSectionPlaneType(section?.type) || !SECTION_DIRECTIONS.includes(direction)) {
		return false;
	}

	section.engineering = { ...(section.engineering || {}), direction };

	return true;
}

export function setSectionIdentifier(section, identifier) {
	if (!isSectionPlaneType(section?.type)) {
		return false;
	}

	section.engineering = { ...(section.engineering || {}), identifier: String(identifier ?? "") };

	return true;
}

/*
 * TURN THE TRACE ABOUT ITS MIDDLE.
 *
 * `engineering.rotation` is the angle the trace makes with +x, in DEGREES - the
 * same unit the Features tab's Rotate row and every other Transform speaks. The
 * two ends are re-derived from the middle, the length and the angle, so the
 * marker turns where it stands: the body handle and the Rotate field are the
 * same edit, and the viewing arrows turn with the trace.
 */
export function sectionRotationOf(section) {
  const span = sectionSpan(section);

  return span ? (Math.atan2(span.direction.y, span.direction.x) * 180) / Math.PI : 0;
}

export function setSectionRotation(section, degrees) {
  const span = sectionSpan(section);
  const value = Number(degrees);

  if (!span || !Number.isFinite(value)) {
    return false;
  }

  const centre = {
    x: (span.start.x + span.end.x) / 2,
    y: (span.start.y + span.end.y) / 2
  };

  const radians = (value * Math.PI) / 180;
  const direction = { x: Math.cos(radians), y: Math.sin(radians) };
  const half = span.length / 2;

  section.geometry = {
    start: { x: centre.x - direction.x * half, y: centre.y - direction.y * half },
    end: { x: centre.x + direction.x * half, y: centre.y + direction.y * half }
  };

  section.engineering = { ...(section.engineering || {}), rotation: value };

  return true;
}

/* Set the trace's length, keeping its middle where it is. */
export function setSectionLength(section, length) {
	const span = sectionSpan(section);
	const value = Number(length);

	if (!span || !Number.isFinite(value) || value < MIN_SECTION_LENGTH) {
		return false;
	}

	const centre = {
		x: (span.start.x + span.end.x) / 2,
		y: (span.start.y + span.end.y) / 2
	};

	section.geometry = {
		...section.geometry,
		start: { x: centre.x - span.direction.x * (value / 2), y: centre.y - span.direction.y * (value / 2) },
		end: { x: centre.x + span.direction.x * (value / 2), y: centre.y + span.direction.y * (value / 2) }
	};

	return true;
}

export function sectionLengthOf(section) {
	const span = sectionSpan(section);

	return span ? span.length : 0;
}

/* Whether a point is on the trace or on one of its arrows. */
export function sectionContainsPoint(section, point, tolerance = 0) {
	const span = sectionSpan(section);

	if (!span) {
		return false;
	}

	const near = (a, b) => {
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const lengthSquared = dx * dx + dy * dy;

		if (lengthSquared < 1e-12) {
			return Math.hypot(point.x - a.x, point.y - a.y) <= tolerance;
		}

		const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;

		if (t < -0.05 || t > 1.05) {
			return false;
		}

		const foot = { x: a.x + dx * t, y: a.y + dy * t };

		return Math.hypot(point.x - foot.x, point.y - foot.y) <= tolerance;
	};

	return near(span.start, span.end) || sectionArrows(section).some((arrow) => near(arrow.start, arrow.end));
}

const enggSectionPlane = {
	SECTION_PLANE_TYPE,
	SECTION_DIRECTIONS,
	ARROW_OFFSET_SHARE,
	ARROW_LENGTH_SHARE,
	MIN_SECTION_LENGTH,
	isSectionPlaneType,
	sectionDirectionOf,
	sectionIdentifierOf,
	showSectionArrowsOf,
	sectionSpan,
	sectionArrows,
	sectionLabelPoint,
	createSectionPlane,
	defaultSectionSpan,
	setSectionDirection,
	setSectionIdentifier,
	sectionRotationOf,
	setSectionRotation,
	setSectionLength,
	sectionLengthOf,
	sectionContainsPoint
};
export default enggSectionPlane;
