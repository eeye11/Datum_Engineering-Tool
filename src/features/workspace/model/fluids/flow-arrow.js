/*
 * ========================================================
 * THE FLOW ARROW
 * ========================================================
 *
 * A flow arrow is an annotation that LIVES ON A PIPE: a single arrowhead drawn
 * on the run's centreline, indicating the direction the fluid flows. It is a
 * member of the flat Fluids model, alongside the Pipe / Duct and the Elbow, and
 * it is described entirely by the pipe it is attached to plus three properties
 * of its own:
 *
 *   attachment   which pipe, and how far along it (0..1 of the centreline)
 *   direction    whether the arrow points with the run (start → end) or against
 *                it
 *   size         how large the arrowhead is drawn
 *
 * ========================================================
 * THE ATTACHMENT IS THE MODEL, NOT A POINT
 * ========================================================
 *
 * A flow arrow never stores a position. Storing one would let the arrow drift
 * off the pipe when the pipe moves, and it would let the arrow exist when its
 * pipe does not. Instead it stores the pipe's ID and a fraction along that
 * pipe's centreline, and its position is DERIVED from the pipe's current
 * geometry on every read. The arrow therefore stays centred and aligned with
 * its host automatically: move the pipe and the arrow moves with it, with no
 * update step that could be forgotten.
 *
 * The fraction is clamped to [0.05, 0.95] when read, so an arrow always sits
 * strictly inside its run — never on an endpoint where a fitting could also
 * be.
 *
 * ========================================================
 * DELETION IS INHERITED, NOT IMPLEMENTED
 * ========================================================
 *
 * An arrow is stored with `parentId` set to its host pipe's ID. The document
 * already deletes children with their parent (see
 * `removeObjectsAndDescendants`), so deleting a pipe deletes its arrows without
 * any code here.
 *
 * A JUNCTION SPLIT REATTACHES THE ARROW. When a pipe is split into two halves,
 * the split code replaces one pipe with two; each half keeps the original pipe's
 * ID or gets a new one, and the arrow's host reference is updated to the half
 * that contains the arrow's anchor fraction. See `reattachAfterSplit`.
 */

import enggDrawingState from "../../../../shared/model/drawing-state.js";

export const FLOW_ARROW_TYPE = "flow-arrow";

export function isFlowArrowType(type) {
	return type === FLOW_ARROW_TYPE;
}

/*
 * IS THIS OBJECT A PIPE-ATTACHED FLOW INDICATOR?
 *
 * `flow-arrow` is ONE stored type used by TWO tools: the attached indicator on a
 * pipe (which stores an `attachment`) and the free directional arrow (which
 * stores a span, and no attachment). Anything that asks "is this an arrow on a
 * pipe?" must ask THIS, not the type alone - otherwise a free arrow would be
 * treated as an attachment with no host and quietly ignored.
 */
export function isAttachedFlowArrow(objectOrType) {
	if (typeof objectOrType === "string") {
		return objectOrType === FLOW_ARROW_TYPE;
	}

	return (
		objectOrType?.type === FLOW_ARROW_TYPE &&
		Boolean(objectOrType?.attachment || objectOrType?.content?.attachment)
	);
}

/*
 * ========================================================
 * THE DEFAULTS
 * ========================================================
 *
 * SIZE is measured in drawing units — the same units the pipe's centreline is
 * measured in — so an arrow looks the same size relative to its run wherever it
 * is drawn. 12 units is roughly a fifth of the shortest sensible run, large
 * enough to read and small enough not to dominate the drawing.
 *
 * The arrow sits ON the centreline, so it is always centred; there is no offset
 * to store and no way for it to drift sideways.
 */
export const DEFAULT_ARROW_SIZE = 24;

/*
 * The limits of the size control. The lower bound keeps a shaft and a head
 * distinguishable; the upper bound stops an arrow from being larger than a
 * typical run.
 */
export const MIN_ARROW_SIZE = 8;
export const MAX_ARROW_SIZE = 80;

/*
 * THE HEAD'S SHARE OF THE ARROW.
 *
 * The head is one quarter of the arrow's length. A conventional engineering
 * flow arrow is drawn with a head a fifth to a third of the arrow, and a quarter
 * sits in that range: unmistakably an arrowhead, never a triangle that has
 * swallowed the shaft.
 */
export const HEAD_SHARE = 0.25;

/*
 * HOW WIDE THE HEAD IS, RELATIVE TO ITS OWN LENGTH.
 *
 * The head is a little wider than it is long at the barbs - the classic
 * engineering arrow - rather than an equilateral wedge.
 */
export const HEAD_WIDTH = 0.7;

/*
 * THE SHAFT'S THICKNESS AS A SHARE OF THE ARROW'S LENGTH.
 *
 * The shaft is drawn at its own proportion of the size rather than at the line
 * weight, so the arrow reads as ONE symbol: a thin stem and a wider head. The
 * line weight still decides how heavy that stem is drawn on the sheet.
 */
export const SHAFT_SHARE = 0.05;

export const MIN_SHAFT_WIDTH = 0.4;
export const MAX_SHAFT_WIDTH = 2.2;

/*
 * How far along the run an arrow may sit. The run's endpoints belong to
 * fittings and connections, so an arrow is kept off them.
 */
export const EDGE_MARGIN = 0.05;

/*
 * How close two arrows on the same run must be before the second is treated as
 * a duplicate of the first. A fraction of the run's length: it scales with the
 * run, so a short run and a long run are equally protected.
 */
export const DUPLICATE_FRACTION = 0.02;

/*
 * WHERE AN ARROW'S ATTACHMENT IS READ FROM, AND WHY IT IS ONE PLACE.
 *
 * `createGeometryObject` SPREADS its `content` option onto the feature rather
 * than nesting it, so an arrow carries `attachment` as a FIELD of its own -
 * `arrow.attachment` - and has no `content` object. Reading either form here, in
 * one accessor, is what keeps a document written in either shape readable; and
 * because every read below goes through this function, there is no second
 * opinion about where the attachment lives.
 */
export function attachmentOf(arrow) {
	return arrow?.attachment || arrow?.content?.attachment || {};
}
/* Write an attachment back in the SAME place `attachmentOf` reads it. */
function writeAttachment(arrow, attachment) {
	arrow.attachment = { ...attachment };

	/*
	 * A `content` copy, when the arrow already carries one, is kept in step - so
	 * an object that arrived with both forms cannot end up with two different
	 * attachments, one of which some other reader might prefer.
	 */
	if (arrow.content && typeof arrow.content === "object") {
		arrow.content = { ...arrow.content, attachment: { ...attachment } };
	}
}

/* ============================================================
 * READING THE HOST PIPE
 * ============================================================ */

/*
 * The pipe an arrow is attached to, from the drawing's own list.
 *
 * The lookup is injected rather than imported: this model is read by the
 * renderer, the source writer and the interaction layer, none of which may
 * import the editor's live document without a cycle (see `pipe-duct.js`'s
 * `setObjectLookup`, the same arrangement).
 */
let hostLookup = null;

export function setHostLookup(lookup) {
	hostLookup = typeof lookup === "function" ? lookup : null;
}

/* Expose the lookup, so a sibling model resolves a host the same way. */
export function hostById(id) {
	return findHost(id);
}

function findHost(hostId) {
	if (!hostLookup || !hostId) {
		return null;
	}

	try {
		return hostLookup(hostId) || null;
	} catch {
		return null;
	}
}

/*
 * The centreline of the arrow's host, as a start point and a unit direction.
 *
 * A pipe joined to a fitting has had its near end cut back to the fitting's
 * tangent point, so its stored `start`/`end` are the visible ends of the run —
 * which is exactly the span the arrow should sit on. `runSpan` is not used: it
 * would give the ORIGINAL drawn line, which runs on under a fitting where the
 * arrow has no business sitting.
 *
 * Returns null when the host is gone or degenerate, which a caller reads as
 * "there is nothing to draw here".
 */
export function hostSpan(arrow) {
	const attachment = attachmentOf(arrow);

	const host = findHost(attachment.hostId);

	const start = host?.geometry?.start;
	const end = host?.geometry?.end;

	if (!start || !end) {
		return null;
	}

	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const length = Math.hypot(dx, dy);

	if (!(length > 1e-9)) {
		return null;
	}

	return {
		start: { x: start.x, y: start.y },
		end: { x: end.x, y: end.y },
		length,
		direction: { x: dx / length, y: dy / length }
	};
}

/*
 * The arrow's anchor point ON its host's centreline, derived from the fraction.
 *
 * THE FRACTION IS CLAMPED every time it is read, so an arrow created by a drag
 * that landed slightly outside the run is pulled inside rather than being stored
 * out of range. The host's current geometry is used, so the anchor follows the
 * pipe.
 */
export function anchorPoint(arrow) {
	const span = hostSpan(arrow);

	if (!span) {
		return null;
	}

	const attachment = attachmentOf(arrow);

	const fraction = clampFraction(attachment.fraction);

	return {
		x: span.start.x + span.direction.x * span.length * fraction,
		y: span.start.y + span.direction.y * span.length * fraction
	};
}

export function clampFraction(fraction) {
	const value = Number(fraction);

	if (!Number.isFinite(value)) {
		return 0.5;
	}

	return Math.min(1 - EDGE_MARGIN, Math.max(EDGE_MARGIN, value));
}

/*
 * The direction the arrow points, as a unit vector.
 *
 * WITH the run by default: the arrow points from the run's start toward its
 * end. Reversed, it points the other way. The host's CURRENT direction is used,
 * so flipping the pipe in the editor flips the arrow with it — the arrow
 * indicates flow along the pipe, and the pipe's geometry is the pipe's geometry.
 */
export function arrowDirection(arrow) {
	const span = hostSpan(arrow);

	if (!span) {
		return null;
	}

	const attachment = attachmentOf(arrow);

	const reversed = attachment.reversed === true;

	return reversed
		? { x: -span.direction.x, y: -span.direction.y }
		: { x: span.direction.x, y: span.direction.y };
}

/* The arrow's drawn size, clamped to the drawable range. */
export function arrowSize(arrow) {
	const attachment = attachmentOf(arrow);

	const value = Number(attachment.size);

	if (!Number.isFinite(value)) {
		return DEFAULT_ARROW_SIZE;
	}

	return Math.min(MAX_ARROW_SIZE, Math.max(MIN_ARROW_SIZE, value));
}

/*
 * ============================================================
 * THE ARROW, AS GEOMETRY: A SHAFT WITH A HEAD AT ONE END
 * ============================================================
 *
 * A flow arrow is a LINE along the run with a SMALL ARROWHEAD at its tip - the
 * conventional flow-direction arrow of an engineering drawing. It is NOT a
 * triangle: an arrowhead alone carries no length, so it cannot say where along
 * the run the flow is indicated, and at drawing scale a triangle the width of
 * the pipe reads as a fitting rather than as an indicator.
 *
 * The shape is built here and NOWHERE ELSE. The canvas, the drag preview, the
 * TikZ writer and the hit test all read THIS object, so they cannot draw four
 * different arrows.
 *
 *   length     the arrow's whole length, tip to tail - `arrowSize`
 *   headLength length * HEAD_SHARE (a quarter)
 *   headWidth  headLength * HEAD_WIDTH at the barbs
 *   shaftWidth length * SHAFT_SHARE (a thin stem)
 *
 * EVERY dimension is a FRACTION OF THE LENGTH. That is what makes the size
 * control behave: doubling the size doubles the shaft AND the head, so the
 * arrow stays a line with a head at every size and can never become a solid
 * triangle. The head can never be longer than the arrow, because its share is
 * a quarter.
 *
 * The arrow is CENTRED ON ITS ANCHOR: the tip stands half a length forward and
 * the tail half a length back, so the anchor stays on the pipe's centreline
 * whether the arrow is drawn forwards or reversed.
 */
export function arrowShape(anchor, direction, size = DEFAULT_ARROW_SIZE) {
	if (!anchor || !direction) {
		return null;
	}

	const axisLength = Math.hypot(Number(direction.x), Number(direction.y));

	if (!(axisLength > 1e-9)) {
		return null;
	}

	const axis = { x: direction.x / axisLength, y: direction.y / axisLength };
	const across = { x: -axis.y, y: axis.x };

	const length = Math.min(MAX_ARROW_SIZE, Math.max(MIN_ARROW_SIZE, Number(size) || DEFAULT_ARROW_SIZE));
	const half = length / 2;

	const headLength = length * HEAD_SHARE;
	const headHalfWidth = (headLength * HEAD_WIDTH) / 2;

	const shaftWidth = Math.min(
		MAX_SHAFT_WIDTH,
		Math.max(MIN_SHAFT_WIDTH, length * SHAFT_SHARE)
	);

	const at = (along, sideways) => ({
		x: anchor.x + axis.x * along + across.x * sideways,
		y: anchor.y + axis.y * along + across.y * sideways
	});

	/* The tip, the two barbs, and the opening where the head meets the shaft. */
	const tip = at(half, 0);
	const barbFirst = at(half - headLength, headHalfWidth);
	const barbSecond = at(half - headLength, -headHalfWidth);

	return {
		tip,
		barbFirst,
		barbSecond,

		/* Where the barbs meet the shaft - the head's base, not a corner of it. */
		headBase: at(half - headLength, 0),

		/* The shaft runs from the tail to the head's base. */
		shaft: { start: at(-half, 0), end: at(half - headLength, 0) },

		anchor: { x: anchor.x, y: anchor.y },
		axis,
		across,

		size: length,
		headLength,
		headWidth: headHalfWidth * 2,
		shaftWidth
	};
}

/* The shape of an arrow, resolved from its host and size. */
export function flowArrowShape(arrow) {
	const anchor = anchorPoint(arrow);
	const direction = arrowDirection(arrow);

	return anchor && direction ? arrowShape(anchor, direction, arrowSize(arrow)) : null;
}

/*
 * THE HEAD ALONE, as its three corners - kept for the callers that only need
 * the pickable area or the bounding box. It is a VIEW of `arrowShape`, not a
 * second shape: the corners are the same ones.
 */
export function arrowHeadPoints(anchor, direction, size = DEFAULT_ARROW_SIZE) {
	const shape = arrowShape(anchor, direction, size);

	return shape
		? {
				tip: shape.tip,
				barbFirst: shape.barbFirst,
				barbSecond: shape.barbSecond,
				anchor: shape.anchor,
				axis: shape.axis,
				across: shape.across,
				size: shape.size
		  }
		: null;
}

/* The three corners of an arrow's head, resolved from its host and size. */
export function flowArrowHead(arrow) {
	const anchor = anchorPoint(arrow);
	const direction = arrowDirection(arrow);

	return anchor && direction ? arrowHeadPoints(anchor, direction, arrowSize(arrow)) : null;
}

/*
 * THE GEOMETRY MIRROR, for the document's file format.
 *
 * The saved file keeps a feature's `geometry`; the arrow's real position is the
 * attachment. This is the one translation between them, and it is used when the
 * arrow is created and whenever the attachment moves - a drag, a Features edit,
 * a reattachment - so a saved arrow opens exactly where it was on the sheet.
 */
export function geometryFor(attachment, host = null) {
  const probe = { attachment: { ...(attachment || {}) } };

  return geometryForSpan(attachment, hostSpan(probe) || spanOfHost(host));
}

/* The span of a host handed in - used before the document holds it. */
function spanOfHost(host) {
  const start = host?.geometry?.start;
  const end = host?.geometry?.end;

  if (!start || !end) {
    return null;
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);

  return length > 1e-9
    ? { start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y }, length, direction: { x: dx / length, y: dy / length } }
    : null;
}

/*
 * THE SAME MIRROR, FROM A HOST HANDED IN RATHER THAN LOOKED UP.
 *
 * A caller that is building a drawing in one pass - the source reader - has the
 * pipe at hand but has not put it in the document yet, so the published lookup
 * cannot see it. The arithmetic is identical; only where the centreline comes
 * from differs.
 */
export function geometryFromHost(attachment, host) {
	const start = host?.geometry?.start;
	const end = host?.geometry?.end;

	if (!start || !end) {
		return geometryForSpan(attachment, null);
	}

	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const length = Math.hypot(dx, dy);

	return geometryForSpan(
		attachment,
		length > 1e-9
			? {
					start: { x: start.x, y: start.y },
					end: { x: end.x, y: end.y },
					length,
					direction: { x: dx / length, y: dy / length }
			  }
			: null
	);
}

function geometryForSpan(attachment, span) {
	const hostId = attachment?.hostId || null;
	const fraction = clampFraction(attachment?.fraction);
	const reversed = attachment?.reversed === true;

	const anchor = span
		? {
				x: span.start.x + span.direction.x * span.length * fraction,
				y: span.start.y + span.direction.y * span.length * fraction
		  }
		: null;

	const direction = span
		? reversed
			? { x: -span.direction.x, y: -span.direction.y }
			: { x: span.direction.x, y: span.direction.y }
		: null;

	return {
		hostId,
		fraction,
		reversed,
		size: arrowSize({ attachment }),
		anchor,
		direction
	};
}

/*
 * WRITE AN ATTACHMENT CHANGE ONTO THE ARROW, IN BOTH PLACES.
 *
 * Returns the arrow, or null when the change could not be made. The geometry
 * mirror is refreshed from the attachment, never the other way round - so the
 * attachment stays the one authority even when the host has just moved.
 */
export function setAttachment(arrow, patch = {}) {
	if (!arrow) {
		return null;
	}

	const current = { ...(arrow.engineering || {}), ...attachmentOf(arrow) };

	/* The host the arrow will be attached to, used when resolving the mirror. */
	const nextHostId = Object.prototype.hasOwnProperty.call(patch, "hostId") ? patch.hostId : current.hostId;

	if (!nextHostId || (!findHost(nextHostId) && !(patch.host && patch.host.id === nextHostId))) {
		return null;
	}

	const attachment = {
		hostId: nextHostId,
		fraction: clampFraction(Object.prototype.hasOwnProperty.call(patch, "fraction") ? patch.fraction : current.fraction),
		reversed: Object.prototype.hasOwnProperty.call(patch, "reversed") ? patch.reversed === true : current.reversed === true,
		size: arrowSize({
			attachment: {
				size: Object.prototype.hasOwnProperty.call(patch, "size") ? patch.size : current.size
			}
		})
	};

	writeAttachment(arrow, attachment);

	/*
	 * THE DRAWN OBJECT'S OWN COPY OF THE SAME RECORD.
	 *
	 * `addObject` keeps only the fixed fields, `content`, `parentId` and
	 * `engineering` - so the record the student edits lives in BOTH places, and
	 * every writer of one keeps the other in step here, in the one function a
	 * change goes through.
	 */
	arrow.engineering = { ...(arrow.engineering || {}), ...attachment };

	arrow.geometry = geometryFor(attachment, patch.host || null);

	/* The arrow hangs off its host, so deleting the host deletes the arrow. */
	arrow.parentId = attachment.hostId;

	return arrow;
}

/* ============================================================
 * CREATING AN ARROW
 * ============================================================ */

/*
 * A new flow arrow on a pipe, at a fraction along its centreline.
 *
 * `options` may carry `fraction`, `reversed` and `size`; anything else is taken
 * from the defaults above. The arrow is created through the document's own
 * factory so it gets the standard ID, name, style and metadata treatment of
 * every other feature.
 *
 * The HOST ID is the caller's responsibility to get right — a creation gesture
 * knows which pipe it pressed on. Nothing here guesses.
 */
export function createFlowArrow(hostId, options = {}) {
	if (!hostId) {
		return null;
	}

	const attachment = {
		hostId,
		fraction: clampFraction(options.fraction),
		reversed: options.reversed === true,
		size: arrowSize({ attachment: { size: options.size } })
	};

	/*
	 * THE HOST MUST BE ONE THIS DRAWING CAN SEE, or the arrow would be attached
	 * to a pipe that does not exist. It is normally found through the published
	 * lookup; a caller that is building a drawing BEFORE the host is in it - the
	 * source reader, which parses a whole sheet in one pass - may hand the host in
	 * directly with `options.host`, and that is accepted as the same answer.
	 */
	const host = options.host && options.host.id === hostId ? options.host : findHost(hostId);

	if (!host) {
		return null;
	}

	return enggDrawingState.createGeometryObject(
		FLOW_ARROW_TYPE,

		/*
		 * THE ANCHOR AND THE DIRECTION, IN THE DOCUMENT'S OWN GEOMETRY.
		 *
		 * The attachment is the model - it is what survives an edit, a save and
		 * a re-parse, and it is what everything above this module reads. But the
		 * document is written to a FILE by a serialiser that keeps `geometry`,
		 * `style`, `type`, `name`, `id` and `parentId`, and it knows nothing
		 * about a feature's private fields. An arrow whose only position lived
		 * inside its attachment therefore came back from a saved file with no
		 * anchor to draw.
		 *
		 * So the resolved anchor and direction are mirrored into `geometry` as
		 * well - derived from the host's CURRENT centreline, and re-derived by
		 * every reader, so the two can never disagree about where the arrow is.
		 * `geometry` is a cache for the file format; the attachment stays the
		 * authority.
		 */
		geometryFromHost(attachment, host),
		{
			style: { ...(options.style || {}) },

			/*
			 * THE ARROW'S DATA, SPREAD ONTO THE FEATURE. `createGeometryObject`
			 * spreads `content` rather than nesting it (see its own note), so the
			 * attachment is the feature's `attachment` field - which is where
			 * `attachmentOf` reads it.
			 */
			content: { attachment },

			/*
			 * AND IN `engineering`, WHICH IS THE FORM `addObject` KEEPS.
			 *
			 * `createGeometryObject` spreads `content` onto the feature - so the
			 * attachment arrives here as `arrow.attachment` - but `addObject` keeps
			 * only the fixed fields plus `content`, `parentId` and `engineering`.
			 * Carrying the same record in `engineering` means the DRAWN arrow the
			 * document stores still knows its host, which is what the Features tab,
			 * the source writer and the click all read.
			 */
			engineering: { ...attachment },

			/* The arrow hangs off its host, so deleting the host deletes the arrow. */
			parentId: hostId
		}
	);
}

/* ============================================================
 * THE LIFECYCLE
 * ============================================================ */

/*
 * Whether an arrow and a candidate placement are the same arrow.
 *
 * Two arrows on the same pipe within DUPLICATE_FRACTION of each other are the
 * same placement — the run is only so long, and two arrowheads sitting on top
 * of each other describe one flow direction, not two. The comparison is between
 * fractions, not points, so it survives the pipe moving.
 */
export function isDuplicatePlacement(existing, hostId, fraction) {
	if (!existing || attachmentOf(existing).hostId !== hostId) {
		return false;
	}

	const a = clampFraction(attachmentOf(existing).fraction);
	const b = clampFraction(fraction);

	return Math.abs(a - b) <= DUPLICATE_FRACTION;
}

/*
 * Reattach an arrow after its host has been split in two.
 *
 * A junction splits its host pipe into two halves that share the split point.
 * The original pipe's ID stays with one half and the other half gets a new ID,
 * so an arrow whose host has gone must be pointed at whichever half still
 * contains its anchor.
 *
 * `halves` is the pair of pipe objects the split produced, in either order.
 * Returns the arrow's new host ID, or null when neither half can hold the
 * arrow — which the caller reads as "the arrow has no home on this split" and
 * drops.
 */
export function reattachAfterSplit(arrow, halves) {
	if (!arrow || !Array.isArray(halves)) {
		return null;
	}

	/*
	 * Each half is a sub-range of the ORIGINAL run. To find which half contains
	 * the arrow, each half's own span is projected onto the arrow's stored
	 * fraction by measuring where the arrow's anchor would sit within the half.
	 *
	 * A half's span runs from its own start to its own end; the arrow sits at
	 * `fraction` of the ORIGINAL line, so it is inside the half whose line
	 * contains the point the arrow was anchored to. Comparing that point against
	 * each half's start and end is exact for a straight run — which a split
	 * always produces, since both halves are sub-ranges of one straight line.
	 */
	const arrowAnchor = anchorPoint(arrow);

	if (!arrowAnchor) {
		return null;
	}

	/*
	 * Both halves lie on the same line (the original run's), so the one whose
	 * endpoints bracket the anchor is the host. Ties go to the first, which is
	 * the half that kept the original ID.
	 */
	for (const half of halves) {
		const start = half?.geometry?.start;
		const end = half?.geometry?.end;

		if (!start || !end) {
			continue;
		}

		const dx = end.x - start.x;
		const dy = end.y - start.y;
		const length = Math.hypot(dx, dy);

		if (!(length > 1e-9)) {
			continue;
		}

		/* Where along the half the anchor sits, as a fraction of the half. */
		const t = ((arrowAnchor.x - start.x) * dx + (arrowAnchor.y - start.y) * dy) / (length * length);

		/*
		 * A small tolerance: the split point itself is shared by both halves, so
		 * an arrow anchored exactly there belongs to whichever half is checked
		 * first — the original.
		 */
		if (t >= -1e-9 && t <= 1 + 1e-9) {
			const current = attachmentOf(arrow);

			const newFraction = Math.min(1 - EDGE_MARGIN, Math.max(EDGE_MARGIN, t));

			/*
			 * THE SPLIT HAPPENS WHILE THE HALVES ARE STILL OUTSIDE THE DOCUMENT,
			 * so the host lookup cannot see them yet and `setAttachment` (which
			 * refuses a host it cannot find) would decline. The fields are written
			 * directly here instead, and the geometry mirror is built from the half
			 * the arrow was pointed at - the same arithmetic, from the same host
			 * geometry, without needing the document to hold the half first.
			 */
			const attachment = {
				...current,
				hostId: half.id,
				fraction: newFraction
			};

			writeAttachment(arrow, attachment);

			const axis = { x: dx / length, y: dy / length };
			const anchor = {
				x: start.x + axis.x * length * newFraction,
				y: start.y + axis.y * length * newFraction
			};

			arrow.geometry = {
				...(arrow.geometry || {}),
				hostId: half.id,
				fraction: newFraction,
				reversed: attachment.reversed === true,
				size: arrowSize(arrow),
				anchor,
				direction:
					attachment.reversed === true
						? { x: -axis.x, y: -axis.y }
						: { x: axis.x, y: axis.y }
			};

			arrow.parentId = half.id;

			return half.id;
		}
	}

	return null;
}

/*
 * EVERY ARROW THAT NAMES `hostId`, in the order they appear on the sheet.
 */
	export function arrowsAttachedTo(objects, hostId) {
	if (!Array.isArray(objects) || !hostId) {
		return [];
	}

	return objects.filter(
		(object) =>
			isAttachedFlowArrow(object) &&
			(attachmentOf(object).hostId === hostId || object.parentId === hostId)
	);
}

/*
 * REATTACH ONE ARROW AT A KNOWN WORLD POINT.
 *
 * The caller has already resolved where the arrow WAS, before its host was
 * replaced - which is the honest answer, because the host's geometry may be
 * half-written by the time a split reaches here. The half whose own span
 * contains that point is the arrow's new home, and the fraction is measured
 * fresh against that half so the arrow stays where it was on the sheet.
 *
 * Ties go to the first half, which is the half that kept the original id.
 * Returns the new host id, or null when neither half contains the point.
 */
export function reattachAtPoint(arrow, point, halves) {
	if (!arrow || !point || !Array.isArray(halves)) {
		return null;
	}

	for (const half of halves) {
		const start = half?.geometry?.start;
		const end = half?.geometry?.end;

		if (!start || !end) {
			continue;
		}

		const dx = end.x - start.x;
		const dy = end.y - start.y;
		const length = Math.hypot(dx, dy);

		if (!(length > 1e-9)) {
			continue;
		}

		const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / (length * length);

		if (t >= -1e-9 && t <= 1 + 1e-9) {
			const current = attachmentOf(arrow);
			const fraction = clampFraction(t);

			const attachment = { ...current, hostId: half.id, fraction };

			writeAttachment(arrow, attachment);

			/*
			 * THE MIRROR IS WRITTEN FROM THE POINT THE ARROW ACTUALLY STOOD AT, not
			 * re-derived from the fraction. Deriving it again would round through
			 * the new half's own interpolation, and an arrow near either end would
			 * creep by that rounding on every split.
			 */
			arrow.geometry = {
				...(arrow.geometry || {}),
				hostId: half.id,
				fraction,
				reversed: attachment.reversed === true,
				size: arrowSize(arrow),
				anchor: { x: point.x, y: point.y },
				direction:
					attachment.reversed === true
						? { x: -dx / length, y: -dy / length }
						: { x: dx / length, y: dy / length }
			};

			arrow.parentId = half.id;

			return half.id;
		}
	}

	return null;
}

/*
 * REATTACH EVERY ARROW A SPLIT ORPHANED.
 *
 * Called by the junction's split with the host it replaced and the pair that
 * replaced it. An arrow is considered orphaned when its host is the pipe that
 * went away - the one arrow in the document whose anchor may now be on either
 * side of the cut - and it is moved to the half that contains its anchor.
 *
 * Returns the arrows it reattached, so a caller can count them and a test can
 * see that the arrow followed its anchor rather than staying put.
 */
export function reattachArrowsAfterSplit(objects, hostId, halves) {
	if (!Array.isArray(objects) || !hostId || !Array.isArray(halves) || halves.length !== 2) {
		return [];
	}

	return objects
		.filter(
			(object) =>
				isFlowArrowType(object?.type) &&
				(attachmentOf(object).hostId === hostId || object.parentId === hostId)
		)
		.map((arrow) => (reattachAfterSplit(arrow, halves) ? arrow : null))
		.filter(Boolean);
}

/*
 * THE DUPLICATES AMONG A SET OF ARROWS, so a caller can drop the extra ones.
 *
 * Only arrows on the SAME host can be duplicates, and only when their anchors
 * coincide - the same test a new placement is refused by. The first of each
 * group is kept, so an arrow that already existed is never the one removed.
 */
export function duplicateArrows(arrows) {
	if (!Array.isArray(arrows)) {
		return [];
	}

	const kept = [];
	const duplicates = [];

	arrows.forEach((arrow) => {
		const attachment = attachmentOf(arrow);

		const clash = kept.find((existing) =>
			isDuplicatePlacement(existing, attachment.hostId, attachment.fraction)
		);

		if (clash) {
			duplicates.push(arrow);
			return;
		}

		kept.push(arrow);
	});

	return duplicates;
}

/*
 * Everything the Features panel needs about an arrow, resolved.
 *
 * Gathered in one place so the panel, the renderer and the source writer all
 * ask the same questions the same way — and so a change to the attachment
 * model is a change here, not a hunt through three files.
 */
export function describeFlowArrow(arrow) {
	const span = hostSpan(arrow);

	const attachment = attachmentOf(arrow);

	const host = findHost(attachment.hostId);

	return {
		hostId: attachment.hostId || null,
		hostName: host?.name || null,
		hostType: host?.type || null,
		fraction: span ? clampFraction(attachment.fraction) : null,
		reversed: attachment.reversed === true,
		size: arrowSize(arrow),
		anchor: span ? anchorPoint(arrow) : null,
		direction: span ? arrowDirection(arrow) : null,
		hasHost: Boolean(span)
	};
}

const enggFlowArrow = {
	FLOW_ARROW_TYPE,
	isFlowArrowType,
	isAttachedFlowArrow,
	DEFAULT_ARROW_SIZE,
	MIN_ARROW_SIZE,
	MAX_ARROW_SIZE,
	EDGE_MARGIN,
	DUPLICATE_FRACTION,
	setHostLookup,
	hostById,
	attachmentOf,
	hostSpan,
	anchorPoint,
	clampFraction,
	arrowDirection,
	arrowSize,
	HEAD_SHARE,
	HEAD_WIDTH,
	SHAFT_SHARE,
	arrowShape,
	flowArrowShape,
	arrowHeadPoints,
	flowArrowHead,
	geometryFor,
	geometryFromHost,
	setAttachment,
	createFlowArrow,
	isDuplicatePlacement,
	reattachAfterSplit,
	reattachArrowsAfterSplit,
	reattachAtPoint,
	arrowsAttachedTo,
	duplicateArrows,
	describeFlowArrow
};

export default enggFlowArrow;
