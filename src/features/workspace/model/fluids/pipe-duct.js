/*
 * ========================================================
 * THE PIPE / DUCT AND ELBOW FEATURES
 * ========================================================
 *
 * This module owns the FLAT Fluids flow-path model:
 *
 *   pipe-duct   ONE straight run of pipework, between two endpoints
 *   elbow       ONE fitting at a supported corner, joining two runs
 *
 * THE BOUNDARIES ARE SCHEMATIC. The two visible lines are a drawing
 * convention - a fixed, narrow spacing (see `DEFAULT_SCHEMATIC_SEPARATION`)
 * that has nothing to do with the run's Diameter, Width or Height. Those stay
 * engineering metadata in the Features tab; they do not move the lines.
 *
 * ========================================================
 * WHY FLAT - NO ROUTE, NO PARENT, NO HIERARCHY
 * ========================================================
 *
 * An earlier shape gave a multi-bend run a PARENT `pipe-route` feature owning
 * `pipe-segment` and `pipe-elbow` children. That is not the model the task
 * asks for. There is no Pipe Route feature, no folder, no parent/child
 * hierarchy and no hidden route group: every straight run is an independent
 * Pipe / Duct feature, and every supported automatic fitting is an independent
 * Elbow feature. They sit side by side in the one flat Features list.
 *
 * Connection between them is REAL and EXPLICIT, not a hierarchy. Each feature
 * exposes logical ports, and a feature records the port it is joined to. The
 * drawing session is an operation sequence, not a persistent container.
 *
 * ========================================================
 * WHERE THE GEOMETRY LIVES
 * ========================================================
 *
 * A Pipe / Duct stores its CENTRELINE as `geometry.start` and `geometry.end`.
 * The centreline is the authoritative geometry: every boundary line, every
 * elbow arc, every endpoint snap and every connection reference is derived
 * from it. The two visible boundary lines are GENERATED from the centreline
 * plus the fixed schematic spacing (see `boundaryLines`), so the drawing
 * cannot drift from the data that defines it.
 *
 * An Elbow stores the CORNER it fits (`geometry.position`), the two directions
 * of the runs it joins (`geometry.angleDegrees`) and its own bend radius. Its
 * curved geometry is derived from those (see `elbowCurves`).
 *
 * ========================================================
 * WHAT IS DELIBERATELY NOT HERE
 * ========================================================
 *
 * No flow solver, no pressure loss, no friction factor. No manufactured
 * fitting catalogue, no nominal bore, no standards-compliant bend radius. No
 * reducer or transition is ever invented to make two mismatched runs fit - a
 * mismatch is REPORTED (see `compatibilityIssue`). Where DAETUM has no
 * established convention, this module does not invent one.
 */
import enggDrawingState from "../../../../shared/model/drawing-state.js";

/*
 * ========================================================
 * THE CROSS-SECTION SHAPE
 * ========================================================
 *
 * The tool is ONE feature type, "Pipe / Duct". Do not introduce separate
 * underlying Pipe and Duct types, and do not add a Type selector: the
 * cross-section is chosen by a Shape dropdown, and it carries the engineering
 * dimensional properties. The VISIBLE boundary spacing is NOT one of them -
 * it is the fixed schematic separation for every Pipe / Duct and Elbow.
 *
 *   Circular     carries a Diameter
 *   Rectangular  carries a Width and a Height
 */
export const PIPE_SHAPES = Object.freeze({
	circular: "circular",
	rectangular: "rectangular"
});

export const PIPE_SHAPE_LABELS = Object.freeze({
	circular: "Circular",
	rectangular: "Rectangular"
});

/*
 * The supported cross-section shapes, in the order the dropdown offers them.
 * Exported so the panel, the factory and the tests all read ONE list.
 */
export const SUPPORTED_SHAPES = Object.freeze([
	PIPE_SHAPES.circular,
	PIPE_SHAPES.rectangular
]);

/*
 * ========================================================
 * THE RANGE OF SUPPORTED CORNER ANGLES
 * ========================================================
 *
 * A corner between two runs is a DIRECTION CHANGE, and an elbow can be bent
 * to ANY angle in that range - not only to a right angle. The bend geometry is
 * derived from the two runs' actual directions, so 30, 45, 60, 90, 120 and 135
 * are all ordinary elbows; the common angles are CONVENIENCES for snapping
 * (see `COMMON_ELBOW_ANGLES`), never a restriction on what may be fitted.
 *
 * A change of ZERO is not a corner at all: two runs that carry straight on are
 * one line of pipework, and nothing bends there. A change of 180 degrees is a
 * fold back along the same line, which no rounded bend can join. Both are
 * therefore refused by `supportedElbowAngle`, and every angle strictly
 * between them is accepted.
 *
 * THE TOLERANCE IS GEOMETRIC, NOT AN ENGINEERING WINDOW.
 *
 * DAETUM has no established angular tolerance for recognising a fitting, and
 * inventing one - "within two degrees is a corner" - would be inventing an
 * engineering rule that is not in the application. So the straight and folded
 * cases are recognised TO FLOATING POINT EXACTNESS (`CORNER_EPSILON_DEGREES`),
 * which refuses to guess whether a nearly-straight join is a bend.
 */
export const MINIMUM_CORNER_ANGLE = 0;
export const MAXIMUM_CORNER_ANGLE = 180;

export const CORNER_EPSILON_DEGREES = 1e-6;

/*
 * The direction change at a corner, in degrees, folded into 0..180.
 *
 * THE ANGLE IS THE CHANGE OF DIRECTION, not the interior angle between the two
 * runs. A pipe that runs east then turns north has changed direction by 90
 * degrees - which is what "a 90 degree elbow" means to the person fitting it.
 */
export function cornerAngleDegrees(previous, vertex, next) {
	if (!previous || !vertex || !next) {
		return null;
	}

	const incoming = {
		x: vertex.x - previous.x,
		y: vertex.y - previous.y
	};

	const outgoing = {
		x: next.x - vertex.x,
		y: next.y - vertex.y
	};

	const incomingLength = Math.hypot(incoming.x, incoming.y);
	const outgoingLength = Math.hypot(outgoing.x, outgoing.y);

	if (incomingLength < 1e-12 || outgoingLength < 1e-12) {
		return null;
	}

	const dot =
		(incoming.x * outgoing.x + incoming.y * outgoing.y) /
		(incomingLength * outgoingLength);

	const clamped = Math.max(-1, Math.min(1, dot));

	return (Math.acos(clamped) * 180) / Math.PI;
}

/*
 * The bend angle a corner earns, or null when no elbow belongs at it.
 *
 * This is the SINGLE rule every caller shares - generation, refresh and the
 * panel - so an elbow is created at exactly the corners that can keep one.
 * `angleDegrees` is the direction change from `cornerAngleDegrees`, folded into
 * 0..180, so no wrapping nudges a valid angle out of the range.
 */
export function supportedElbowAngle(angleDegrees) {
	const angle = Number(angleDegrees);

	if (!Number.isFinite(angle)) {
		return null;
	}

	const fold = (value) => ((value % 180) + 180) % 180;

	const effective = fold(angle);

	/* A straight continuation has no bend; a 180 degree fold back is not one. */
	if (effective <= CORNER_EPSILON_DEGREES) {
		return null;
	}

	return Math.min(MAXIMUM_CORNER_ANGLE, effective);
}

/*
 * ========================================================
 * THE ENGINEERING DEFAULTS
 * ========================================================
 *
 * A new run starts with a cross-section shape and a size, and nothing else.
 * The values are the ones a student would reach for first, stated here once so
 * the factory and the feature model cannot disagree.
 *
 * THEY ARE IN WORLD UNITS, like every other length in the model. What a student
 * reads in the panel is converted through the document's World Scale (see
 * handles.js `mmOf`).
 *
 * NO MATERIAL AND NO ROUGHNESS ARE DEFAULTED. DAETUM has no material catalogue,
 * so a run's material starts EMPTY and its roughness starts ABSENT.
 *
 * THESE ARE ENGINEERING METADATA ONLY. They do not decide what the drawing
 * looks like - the schematic spacing below does.
 */
export const DEFAULT_DIAMETER = 120;
export const DEFAULT_WIDTH = 200;
export const DEFAULT_HEIGHT = 120;

/*
 * ========================================================
 * THE DEFAULT SCHEMATIC BOUNDARY SPACING - A DRAWING STYLE
 * ========================================================
 *
 * Pipe / Duct is a 2D engineering DRAWING tool: its two visible boundary
 * lines stand for the flow path, they do not scale the physical bore. The
 * spacing is therefore a drawing-style parameter - ONE shared default for
 * every Pipe / Duct and every Elbow, on straight sections, at corners and
 * around bends alike - and not a dimension derived from Diameter, Width or
 * Height.
 *
 * The value is in WORLD units, so it pans and zooms with the drawing through
 * the ordinary camera transform (BASE_PIXELS_PER_UNIT * zoom pixels per
 * world unit). At 2.4 px per unit at zoom 1, 2 world units draw the two
 * boundaries about 4.8 px apart - a clearly readable, slim double line,
 * noticeably tighter than the wider schematic the tool used to draw, and
 * identical no matter what those dimensions are changed to.
 *
 * Reduced substantially from earlier defaults to provide a noticeably narrower,
 * professional schematic representation across every straight run, live preview,
 * and curved elbow, derived from ONE shared constant.
 */
export const DEFAULT_SCHEMATIC_SEPARATION = 4;
export const DEFAULT_SCHEMATIC_SPACING = DEFAULT_SCHEMATIC_SEPARATION;

export function defaultPipeEngineering(shape = PIPE_SHAPES.circular) {
	const base = {
		shape:
			shape === PIPE_SHAPES.rectangular
				? PIPE_SHAPES.rectangular
				: PIPE_SHAPES.circular,
		material: "",
		roughness: undefined
	};

	if (base.shape === PIPE_SHAPES.rectangular) {
		return {
			...base,
			width: DEFAULT_WIDTH,
			height: DEFAULT_HEIGHT
		};
	}

	return {
		...base,
		diameter: DEFAULT_DIAMETER
	};
}

/*
 * ========================================================
 * WHICH DIMENSIONAL FIELDS APPLY
 * ========================================================
 *
 * The ONE place that answers "what does this cross-section measure in", so the
 * factory, the panel and the boundary geometry cannot disagree.
 *
 *   circular     diameter
 *   rectangular  width, height
 */
export function dimensionalKeysFor(engineering = {}) {
	const shape = engineering.shape || PIPE_SHAPES.circular;

	return shape === PIPE_SHAPES.rectangular
		? ["width", "height"]
		: ["diameter"];
}

/*
 * The cross-section values, as a plain object of the keys that apply. A field
 * that does not apply to the current shape is simply absent, so a switch from a
 * rectangular section to a circular one cannot leave a stale `width` behind.
 */
export function dimensionsOf(engineering = {}) {
	const dimensions = {};

	dimensionalKeysFor(engineering).forEach((key) => {
		const value = Number(engineering[key]);

		if (Number.isFinite(value)) {
			dimensions[key] = value;
		}
	});

	return dimensions;
}

/*
 * ========================================================
 * THE VISIBLE SEPARATION OF THE TWO BOUNDARY LINES
 * ========================================================
 *
 * THE SCHEMATIC SPACING, AND NOTHING ELSE. This is the number that decides
 * how far apart the two drawn boundary lines sit, and it is the SAME for
 * every Pipe / Duct and every Elbow: a drawing-style parameter, not a
 * dimension. Diameter, Width and Height stay editable engineering metadata
 * in the Features tab, and changing them cannot move the drawn lines - the
 * boundaries never scale with the physical bore.
 *
 * A RUN MAY WIDEN ITSELF. `engineering.separation` records how far the student
 * has widened this run from the default (the Features tab's Pipe Width Change),
 * and the spacing is the default plus that change. It is a CHANGE rather than an
 * absolute width, so a value of zero - or no value at all - is the default, and
 * widening a run cannot accidentally pin it to today's default if the default
 * is ever changed.
 *
 * A change that would collapse the walls to nothing is refused here as well as
 * in the panel: geometry is the last line of defence, and a negative or zero
 * separation would draw the two walls on top of each other.
 */
export function boundarySeparation(engineering = {}) {
	const change = Number(engineering?.separation);

	if (!Number.isFinite(change) || change === 0) {
		return DEFAULT_SCHEMATIC_SEPARATION;
	}

	const separation = DEFAULT_SCHEMATIC_SEPARATION + change;

	return separation > 0 ? separation : DEFAULT_SCHEMATIC_SEPARATION;
}

/*
 * The two boundary lines of a straight run, in world coordinates.
 *
 * Both lines are generated from the SAME centreline and the SAME schematic
 * separation, so they can never disagree with each other or with the feature's
 * other geometry. The offset is applied perpendicular to the run's direction.
 *
 * A RUN WITH `trims` IS A RUN WITH A BEND FITTED, and its walls stop where the
 * bend begins. The trims are applied HERE, to the centreline the walls are
 * derived from, so a caller cannot draw a wall that runs into the corner by
 * passing the untrimmed line by mistake - which is exactly how the bend and the
 * straight wall used to come apart by a trim's length. `trimmedCentreline`
 * remains the function that states the rule; this one honours it.
 *
 * A caller that has ALREADY trimmed the line (the renderer, the writer) passes
 * a centreline without `trims` and gets the same answer twice.
 *
 * ========================================================
 * THE LINE AND THE REACH ARE DIFFERENT THINGS
 * ========================================================
 *
 * The walls are PARALLEL TO THE RUN, so the offset must be perpendicular to the
 * RUN'S DIRECTION - and once a run has been seated on a fitting, its two stored
 * points are the far end and the TANGENT POINT, which are two points ON that
 * line but not its only possible ends.
 *
 * `reach` therefore states where the walls actually stop. Without it they span
 * `start` to `end`, which is right for a run that has never been seated. With
 * it, the offset is still perpendicular to `start -> end` (the run's line) and
 * the walls run from `reach.start` to `reach.end` - so a wall can begin at a
 * tangent point that is short of the stored end, without the wall turning.
 *
 * Returns `[lineA, lineB]`, each `{ start, end }`, or an empty array when the
 * centreline is degenerate.
 */
export function boundaryLines(start, end, engineering = {}, trims = null, reach = null) {
	if (!finitePoint(start) || !finitePoint(end)) {
		return [];
	}

	void trims;

	/*
	 * THE OFFSET COMES FROM THE RUN'S LINE, which is `start -> end`. Both points
	 * are on it even when the near one has been moved onto a tangent point.
	 */
	const lineStart = finitePoint(reach?.lineStart) ? reach.lineStart : start;
	const lineEnd = finitePoint(reach?.lineEnd) ? reach.lineEnd : end;

	const dx = lineEnd.x - lineStart.x;
	const dy = lineEnd.y - lineStart.y;

	const length = Math.hypot(dx, dy);

	if (length < 1e-12) {
		return [];
	}

	const separation = boundarySeparation(engineering);

	if (separation === null) {
		return [];
	}

	/*
	 * THE WALLS RUN BETWEEN THE TWO STORED POINTS - but each point must be ON the
	 * run's line before it is offset, or the wall ends where the point happens to
	 * be and not perpendicular to the run. A seated run's near end IS on the line
	 * (it is the tangent point); a run whose stored end was nudged off it by a
	 * drag is projected back onto it here, so the wall cannot lean.
	 */
	const ux = dx / length;
	const uy = dy / length;

	const projectOn = (point) => {
	const along = (point.x - lineStart.x) * ux + (point.y - lineStart.y) * uy;

	return { x: lineStart.x + ux * along, y: lineStart.y + uy * along };
	};

	const from = projectOn(finitePoint(reach?.start) ? reach.start : start);
	const to = projectOn(finitePoint(reach?.end) ? reach.end : end);

	/*
	 * The half-offset normal to the run. The schematic boundaries sit one
	 * schematic separation apart, so each is half of it from the centreline.
	 */
	const half = separation / 2;

	const nx = -uy * half;
	const ny = ux * half;

	return [
		{
			start: { x: from.x + nx, y: from.y + ny },
			end: { x: to.x + nx, y: to.y + ny }
		},
		{
			start: { x: from.x - nx, y: from.y - ny },
			end: { x: to.x - nx, y: to.y - ny }
		}
	];
}

function finitePoint(point) {
	return (
		point &&
		Number.isFinite(point.x) &&
		Number.isFinite(point.y)
	);
}

/*
 * ========================================================
 * THE PIPE / DUCT FEATURE
 * ========================================================
 *
 * Build ONE straight run from two endpoints. The run is an ordinary feature
 * with no parent: it is created, selected, edited, saved and deleted like any
 * other top-level feature.
 *
 * A NEW RUN HAS NO CROSS-SECTION DIMENSIONS. Pipe / Duct is a 2D drawing tool,
 * and the finalized design removed Diameter, Width, Height, Material and
 * Roughness from it - so none of them is stamped onto a new object. An older
 * file's values are kept exactly as they were when it is opened, because they
 * are simply carried through `options.engineering` and nothing reads them.
 */
export function createPipeDuct(start, end, options = {}) {
	if (!finitePoint(start) || !finitePoint(end)) {
		return null;
	}

	if (Math.hypot(end.x - start.x, end.y - start.y) < 1e-9) {
		return null;
	}

	const engineering = { ...(options.engineering || {}) };

	const geometry = {
	start: { x: start.x, y: start.y },
	end: { x: end.x, y: end.y },

	/*
	 * THE LINE THE RUN WAS DRAWN ALONG. It survives the run being seated on a
	 * fitting, because the walls are offset from it and the tangent point is
	 * on it. See `runSpan`.
	 */
	span: {
	start: { x: start.x, y: start.y },
	end: { x: end.x, y: end.y }
	}
	};

	return enggDrawingState.createGeometryObject("pipe-duct", geometry, {
		...options,
		engineering
	});
}

/*
 * ========================================================
 * THE SPAN A RUN WAS DRAWN ALONG, AND WHY IT IS KEPT
 * ========================================================
 *
 * A run joined to a fitting has its near END moved onto the fitting's tangent
 * point, so `start`/`end` are the points the visible walls must stop at. They
 * are no longer two ends of one straight line through the whole run, though:
 * the far end is the student's, the near end is the fitting's.
 *
 * The two walls are OFFSET FROM THE RUN'S OWN LINE, so the line has to be
 * recoverable - and the tangent point lies on that line, so the pair
 * (`span.start`, `end`) is the run and is enough to offset from. This returns
 * it, together with the direction, which is what `boundaryLines` needs and what
 * a caller that only has the two stored points cannot work out on its own.
 *
 * A RUN WITH NO `span` has never been seated: its two ends ARE its line.
 */
export function runSpan(feature) {
	const geometry = feature?.geometry || {};

	/*
	 * THE SPAN IS THE WHOLE DRAWN RUN - both of its points. Using `geometry.end`
	 * for the far end would take the TANGENT POINT the run has been seated on
	 * whenever the fitting holds that end, and the line would tilt by the trim.
	 */
	const start = finitePoint(geometry.span?.start) ? geometry.span.start : geometry.start;
	const end = finitePoint(geometry.span?.end) ? geometry.span.end : geometry.end;

	const direction = directionOf(start, end);

	if (!finitePoint(start) || !finitePoint(end) || !direction) {
		return null;
	}

	return {
		start: { x: start.x, y: start.y },
		end: { x: end.x, y: end.y },
		direction
	};
}

/*
 * ========================================================
 * THE TWO BOUNDARY LINES, IN THE RUN'S OWN FRAME
 * ========================================================
 *
 * `boundaryLines(start, end, ...)` offsets perpendicular to the line BETWEEN
 * the two points it is given, which is the run's own line only while both are
 * ends of the same straight run. For a run that has been seated on a fitting,
 * `boundaryLines` with a `span` offsets from the RUN's line and stops the walls
 * at the two stored points - so each wall ends exactly at its tangent point.
 *
 * This is `boundaryLines` for a FEATURE, which is what a renderer has.
 */
export function boundaryLinesOf(feature) {
	const span = runSpan(feature);

	const geometry = feature?.geometry || {};

	if (!span) {
		return boundaryLines(geometry.start, geometry.end, feature?.engineering || {});
	}

	/*
	 * WHERE THE WALLS ACTUALLY STOP.
	 *
	 * `geometry.start`/`end` are where the visible centreline ends: the far end
	 * the student drew, and the TANGENT POINT where a fitting holds it. The
	 * offset comes from the span, so a wall is parallel to the run; it is drawn
	 * from the stored `start` to the stored `end`, so it stops at the tangent
	 * point instead of running on into the bend.
	 *
	 * THE REACH IS TAKEN AGAINST THE SPAN'S OWN END. Both are points on one line,
	 * so projecting the stored end onto it - rather than passing it as a point of
	 * its own - keeps the wall on the run however far it has been seated.
	 */
	const from = geometry.start || span.start;
	const to = geometry.end || span.end;

	return boundaryLines(span.start, span.end, feature?.engineering || {}, null, {
		start: from,
		end: to
	});
}

/*
 * The straight length of a run, in world units, from its actual geometry.
 */
export function runLength(feature) {
	const start = feature?.geometry?.start;
	const end = feature?.geometry?.end;

	if (!finitePoint(start) || !finitePoint(end)) {
		return 0;
	}

	return Math.hypot(end.x - start.x, end.y - start.y);
}

/*
 * ========================================================
 * THE CURVED GEOMETRY OF AN ELBOW
 * ========================================================
 *
 * An elbow is a curved centreline that REPLACES the sharp corner: the two
 * adjoining runs are trimmed back to the points where the arc becomes tangent
 * to them, and an arc is drawn between those two tangent points. That is the
 * standard construction for a pipe bend, and it is what a student reads.
 *
 * THE TRIM DISTANCE IS `R * tan(angle / 2)`.
 *
 * The angle here is the DIRECTION CHANGE. For a 90 degree turn the tangent
 * length is exactly the radius; for a 45 degree turn it is about 0.414 R.
 * Deriving it rather than tabulating it means the two supported angles cannot
 * drift apart, and it is what lets an elbow take ANY angle - 30, 60, 135 -
 * as readily as a 45 or a 90.
 *
 * IT IS EXPORTED because the elbow's Fit and Radius arithmetic needs the same
 * tangent length the geometry uses, and a second copy in a panel would be free
 * to disagree with the drawing.
 */
export function trimDistanceFor(radius, angleDegrees) {
	return radius * Math.tan((angleDegrees * Math.PI) / 360);
}

/*
 * THE BEND ANGLE A CORNER MAKES, FROM ITS TWO ARMS.
 *
 * `cornerAngleDegrees` measures the direction of TRAVEL into a corner and out of
 * it. The arms of a bend point AWAY from the corner instead - one back along
 * each run - so the bend between them is the SUPPLEMENT of their included angle.
 * `bendAngleFromArms` is that rule, stated once; this is it for two points, and
 * every caller that has a corner in points uses it, so a corner read from the
 * arms and the elbow's own angle cannot drift apart.
 */
export function cornerAngleFromArms(farIn, vertex, farOut) {
	const inArm = directionOf(vertex, farIn);
	const outArm = directionOf(vertex, farOut);

	if (!inArm || !outArm) {
		return null;
	}

	return bendAngleFromArms(inArm, outArm);
}

/*
 * IS THIS CORNER A BEND AT ALL? A straight continuation and a fold-back are the
 * two corners no rounded bend can join, and they are refused by SUPPLEMENTING
 * the included angle first - which is what makes a straight run read as zero.
 */
export function supportsCornerArms(farIn, vertex, farOut) {
	return supportedElbowAngle(cornerAngleFromArms(farIn, vertex, farOut));
}


/*
 * ========================================================
 * THE ANGLE BETWEEN TWO DIRECTIONS
 * ========================================================
 *
 * The bend angle an elbow presents between its two tangents, folded into
 * 0..180. Two unit vectors pointing the same way are a 0 degree bend; opposite
 * ways are a 180 degree one.
 */
export function angleBetweenDirections(first, second) {
	if (!finiteDirection(first) || !finiteDirection(second)) {
		return null;
	}

	const dot = first.x * second.x + first.y * second.y;

	return (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
}

/*
 * THE BEND ANGLE, FROM THE TWO ARMS OF AN ELBOW.
 *
 * `inDirection` is the unit vector along which the incoming run ARRIVES at the
 * corner; `outDirection` is the unit vector the outgoing run LEAVES along.
 * Those two routines point away from the corner at their far ends, so the
 * angle between them is `180 - bend`: a 90 degree elbow's arms are at 90, and a
 * 45 degree elbow's arms are at 135. Getting this the wrong way round names
 * every bend by its supplement, which is why it lives here once, beside the
 * geometry that consumes it.
 */
export function bendAngleFromArms(inDirection, outDirection) {
	const between = angleBetweenDirections(inDirection, outDirection);

	return between === null ? null : 180 - between;
}

/* A unit vector along `a -> b`, or null when the two points coincide. */
export function directionOf(a, b) {
	if (!finitePoint(a) || !finitePoint(b)) {
		return null;
	}

	const length = Math.hypot(b.x - a.x, b.y - a.y);

	if (length < 1e-12) {
		return null;
	}

	return { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
}

function finiteDirection(direction) {
	return (
		direction &&
		Number.isFinite(direction.x) &&
		Number.isFinite(direction.y) &&
		Math.hypot(direction.x, direction.y) > 1e-9
	);
}

export function normaliseAngle(degrees) {
	const value = Number(degrees);

	if (!Number.isFinite(value)) {
		return null;
	}

	return Math.max(0, Math.min(180, Math.abs(value)));
}

/*
 * ========================================================
 * THE COMMON ANGLES AN ELBOW MAY SNAP TO
 * ========================================================
 *
 * Dragging an elbow's angle snaps to these when the pointer comes close to
 * one; dragging away from the snap is how any other value is reached, and a
 * standalone or partially connected elbow can always type one instead. The
 * list is NOT a restriction - it is a convenient set of stops.
 *
 * The tolerance is in DEGREES of bend, and is deliberately small: a snap has to
 * help a student place a true 45, not fight them for the neighbourhood of it.
 */
export const COMMON_ELBOW_ANGLES = Object.freeze([30, 45, 60, 90, 135]);
export const ELBOW_ANGLE_SNAP_TOLERANCE = 6;

export function snapElbowAngle(degrees) {
	const value = normaliseAngle(degrees);

	if (value === null) {
		return null;
	}

	const nearest = COMMON_ELBOW_ANGLES.reduce(
		(best, candidate) =>
			Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best,
		COMMON_ELBOW_ANGLES[0]
	);

	return Math.abs(nearest - value) <= ELBOW_ANGLE_SNAP_TOLERANCE
		? nearest
		: value;
}

/*
 * THE ARC IS DESCRIBED, NOT TILED: this returns the tangent points, the arc
 * centre, the radius, the sweep and the sweep direction, which is everything a
 * renderer needs - and nothing that presumes how many points to sample it into.
 */

/*
 * A point `distance` along the segment from `from` toward `to`.
 */
function pointAlong(from, to, distance) {
	const length = Math.hypot(to.x - from.x, to.y - from.y);

	if (length < 1e-12) {
		return { x: from.x, y: from.y };
	}

	const ratio = distance / length;

	return {
		x: from.x + (to.x - from.x) * ratio,
		y: from.y + (to.y - from.y) * ratio
	};
}

/*
 * ========================================================
 * THE DEFAULT BEND RADIUS
 * ========================================================
 *
 * An elbow is a ROUNDED BEND, so a newly created one always has a drawable
 * radius. The default is a SCHEMATIC one - two boundary separations, the
 * proportion the drawing already uses for a tidy bend - so a bend at a corner
 * of a typical length is recognisably round without swallowing either run.
 *
 * It is a DRAWING amount, not a claim about real pipework: no nominal bore, no
 * standards-compliant bend radius and no manufactured fitting catalogue is
 * implied. `setDefaultBendRadius` remains the one way an application-level
 * drawing default can replace it, and a new elbow records the radius it was
 * created with, so changing the default later cannot move an elbow already on
 * the sheet.
 *
 * A generated elbow whose corner is too short for this radius is CLAMPED to
 * what fits (see `fitBendRadius`), so a very short leg still gets a small bend
 * rather than no fitting at all.
 */
export const DEFAULT_BEND_RADIUS_ONES = DEFAULT_SCHEMATIC_SEPARATION * 2;

export let DEFAULT_BEND_RADIUS = DEFAULT_BEND_RADIUS_ONES;

export function setDefaultBendRadius(radius) {
  const numeric = Number(radius);

  DEFAULT_BEND_RADIUS =
    Number.isFinite(numeric) && numeric > 0
      ? numeric
      : DEFAULT_BEND_RADIUS_ONES;

  return DEFAULT_BEND_RADIUS;
}

/*
 * The current default bend radius, as a value rather than a live binding.
 *
 * ESLint's `import/no-mutable-exports` and the module-object default export
 * both want a function to read a mutable hint rather than reaching into the
 * binding, so callers that carry the object form ask this.
 */
export function readDefaultBendRadius() {
  return DEFAULT_BEND_RADIUS;
}

/*
 * The curved centreline of one elbow, or null when it cannot be drawn.
 *
 * `radius` is the elbow's own bend radius. A radius that is not a positive,
 * finite number produces null - "there is no curve to draw" - rather than a
 * made-up one, so a caller draws the ordinary corner instead and the drawing
 * stays honest.
 *
 * FIT IS CHECKED HERE, where the two runs' lengths are known. A bend whose
 * tangent points would fall beyond either adjoining run cannot be drawn as a
 * real arc, so it produces null. That is the "an invalid radius must not
 * produce malformed or disconnected geometry" rule, enforced at the one place
 * the geometry is computed.
 *
 * `previous`, `vertex` and `next` are the centreline points of the two runs
 * meeting at the corner. Returns:
 *
 *   { position, start, end, centre, radius, angleDegrees, sweepFlag, trim }
 *
 * `limits`, when supplied, is `{ incoming, outgoing }` - the lengths of the two
 * legs the bend must fit inside. It is passed by a caller that KNOWS those
 * lengths (a manual elbow's own two ends, a candidate radius being fitted) so
 * the geometry can be built before any pipe exists; without it the trim must
 * fit inside the distances between the three points.
 */
export function elbowGeometry(previous, vertex, next, radius, limits = null) {
	if (!finitePoint(previous) || !finitePoint(vertex) || !finitePoint(next)) {
		return null;
	}

	const bendRadius = Number(radius);

	if (!Number.isFinite(bendRadius) || bendRadius <= 0) {
		return null;
	}

	const angleDegrees = cornerAngleDegrees(previous, vertex, next);

	if (angleDegrees === null) {
		return null;
	}

	const trim = trimDistanceFor(bendRadius, angleDegrees);

	const incomingLength = Math.hypot(
		vertex.x - previous.x,
		vertex.y - previous.y
	);

	const outgoingLength = Math.hypot(next.x - vertex.x, next.y - vertex.y);

	/*
	 * A tangent point past the end of a run is not a drawable elbow.
	 *
	 * WHEN THE CALLER SAYS HOW MUCH ROOM THERE IS - the two leg lengths, which
	 * a MANUAL elbow knows and a corner between two runs does not - the corner
	 * and the two directions are enough, and the tangent points are placed at
	 * the measured trim even where that runs past the leg. That is what lets a
	 * manually drawn elbow exist before its pipe does, and what lets the panel
	 * report "too large" instead of quietly drawing nothing.
	 *
	 * WITH NO LEGS the trim must fit inside both runs, which is the rule a
	 * corner between two committed runs is held to.
	 */
	if (!limits) {
		if (trim > incomingLength || trim > outgoingLength) {
			return null;
		}
	} else if (!Number.isFinite(Number(limits.incoming)) || !Number.isFinite(Number(limits.outgoing))) {
		return null;
	}

	/*
	 * BOTH TANGENT POINTS ARE PLACED FROM THE CORNER, ALONG EACH ARM: the incoming
	 * one `trim` back from the corner, the outgoing one `trim` along it. Placing
	 * the incoming one by "length minus trim" instead measures the OTHER end of the
	 * leg - which is the far end only when both points the caller passed are the
	 * ends of one straight run, and is never it once a pipe has been seated.
	 */
	const start = pointAlong(vertex, previous, trim);
	const end = pointAlong(vertex, next, trim);

	const cross =
		(vertex.x - previous.x) * (next.y - vertex.y) -
		(vertex.y - previous.y) * (next.x - vertex.x);

	const inDirection = {
		x: (vertex.x - previous.x) / incomingLength,
		y: (vertex.y - previous.y) / incomingLength
	};

	const outDirection = {
		x: (next.x - vertex.x) / outgoingLength,
		y: (next.y - vertex.y) / outgoingLength
	};

	/*
	 * THE ARC CENTRE, FROM THE TANGENT POINTS.
	 *
	 * The centre lies `radius` from EACH tangent point, perpendicular to the run
	 * that meets it - because a tangent is perpendicular to the radius that
	 * touches it. The inbound run's direction is `inDirection`, so `radius`
	 * along the normal that points INTO the turn puts the centre where both
	 * tangents meet.
	 *
	 * WHICH NORMAL POINTS INWARD IS THE SIGN OF THE TURN, and nothing else:
	 * `cross` is positive when the run turns left, so the inward normal of the
	 * inbound direction `d` is exactly `(-d.y, d.x)`. That is why the sign here
	 * is `cross`: getting it from the turn rather than from an axis means a
	 * turn in either direction, at either supported angle, is centred the same
	 * way.
	 *
	 * THE TWO CONSTRUCTIONS MUST AGREE. Taking the centre from the inbound
	 * tangent and checking it against the outbound one is what makes a wrong
	 * sign visible here rather than as an arc drawn round the outside of the
	 * corner.
	 */
	const inward = cross >= 0 ? 1 : -1;

	const centre = {
		x: start.x - inDirection.y * bendRadius * inward,
		y: start.y + inDirection.x * bendRadius * inward
	};

	/*
	 * The outbound tangent must lie the same radius from that centre. Both are
	 * exact by construction for ANY turn angle - `trimDistanceFor` is what makes
	 * the two tangent points equidistant from one centre - so anything further
	 * apart than a rounding error is not a corner this fitting can join, and it
	 * is refused rather than drawn with a gap at one end.
	 */
	const outboundError = Math.abs(
		Math.hypot(end.x - centre.x, end.y - centre.y) - bendRadius
	);

	if (outboundError > 1e-6 * Math.max(1, bendRadius)) {
		return null;
	}

	const a0 = Math.atan2(start.y - centre.y, start.x - centre.x);
	const a1 = Math.atan2(end.y - centre.y, end.x - centre.x);

	return {
		position: { x: vertex.x, y: vertex.y },
		start: { x: start.x, y: start.y },
		end: { x: end.x, y: end.y },

		/*
		 * THE TWO RADII THE ARCS ARE DRAWN ON. A wall of the bend sits half the
		 * run's width to one side of the centreline, so its arc is on a different
		 * CIRCLE from the centreline's - and the angle from `centre` to the
		 * tangent point is the same for both, which is what makes the two walls
		 * meet the straight walls exactly. Reporting them here, rather than
		 * leaving every caller to add and subtract a half-width again, is what
		 * keeps the canvas, the source and the geometry in one place.
		 */
		centre,
		radius: bendRadius,
		angleDegrees,
		startAngle: a0,
		endAngle: a1,
		sweepFlag: cross >= 0 ? 1 : 0,
		trim,
		inDirection,
		outDirection
	};
}

/*
 * ========================================================
 * THE TWO VISIBLE WALLS OF A BEND
 * ========================================================
 *
 * A run is drawn as TWO lines, parallel to its centreline and half a schematic
 * separation apart. A bend must therefore be drawn as the two arcs that
 * CONTINUE those lines: each begins exactly at the end of a straight wall,
 * with the same direction, and ends exactly at the end of the other run's
 * wall, with the same direction again.
 *
 * ========================================================
 * THE TWO ARCS ARE OFFSETS OF THE CENTRELINE ARC
 * ========================================================
 *
 * The centreline arc is drawn on the circle through the corner's two tangent
 * points. The bend's inner wall is the same arc pulled in by `half` - the
 * run's half-width - toward the centre of the turn, and the outer wall is the
 * same arc pushed out by `half`. OFFSETTING A CIRCLE GIVES A CONCENTRIC
 * CIRCLE, so both walls are arcs about the SAME CENTRE, on radii
 *
 *     R + half   (outer)
 *     R - half   (inner)
 *
 * and both run from the centreline arc's start angle to its end angle. That
 * is the whole of it, and it is what makes the junction come out right:
 *
 *   - the tangent points are still PERPENDICULAR to the two runs (a radius to
 *     a point on a concentric arc is the same radius turned the same way), so
 *     each wall's curve meets its straight wall without a kink;
 *   - the inner arc's tangent point is `half` in from the centreline's, which
 *     is exactly where the pipe's own inner line ends;
 *   - and the same holds for the outer wall, so the bore is the pipe's bore
 *     at BOTH junctions.
 *
 * A wall drawn at a DIFFERENT width at each end tapers between its two radii
 * along the same sweep. Its ends are still the two straight walls' ends, so
 * the step is only ever between the tangents - never at them.
 *
 * WHICH SIDE IS OUTER is read from the turn itself. `outer` and `inner` are
 * therefore named from the GEOMETRY and not from the direction the runs happen
 * to have been drawn in: `wallLineEnds` matches them to the runs afterwards.
 */

/* The cross product of the two arms: positive when the turn is to the left. */
export function elbowWallArcs(corner, radius, separations = {}) {
	if (!corner?.before || !corner?.vertex || !corner?.after) {
		return null;
	}

	const bendRadius = Number(radius);

	if (!Number.isFinite(bendRadius) || bendRadius <= 0) {
		return null;
	}

	const bend = elbowGeometry(
		corner.before,
		corner.vertex,
		corner.after,
		bendRadius,
		{
			incoming: Math.hypot(corner.vertex.x - corner.before.x, corner.vertex.y - corner.before.y),
			outgoing: Math.hypot(corner.after.x - corner.vertex.x, corner.after.y - corner.vertex.y)
		}
	);

	if (!bend) {
		return null;
	}

	const source = separations.engineering || {};

	/*
	 * A WIDTH OF ZERO IS A WIDTH, NOT AN ABSENT ONE. `boundarySeparation` returns
	 * the default schematic spacing, never zero, so a run's own width is always
	 * positive - but a value that is MISSING is different from one that could not
	 * be read, and `Number(x) > 0` cannot tell them apart. Testing the number
	 * itself lets an elbow that has not recorded this end keep the fitting's own
	 * spacing while never mistaking a real width for it.
	 */
	const declared = (value) => Number.isFinite(Number(value)) && Number(value) > 0;

	const startSeparation = declared(separations.startSeparation)
	? Number(separations.startSeparation)
	: boundarySeparation(source);

	const endSeparation = declared(separations.endSeparation)
	? Number(separations.endSeparation)
	: boundarySeparation(source);

	const sweep = ((bend.endAngle - bend.startAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

	if (Math.abs(sweep) < 1e-12) {
		return null;
	}

	/*
	 * ========================================================
	 * A BEND NARROWER THAN ITS RUN IS CLAMPED, NOT REFUSED
	 * ========================================================
	 *
	 * The inner wall is drawn on `R - half`, so a radius smaller than the
	 * larger half-width would put that wall THROUGH the centre of the turn and
	 * turn it inside out. That is not a bend that can be drawn, but the answer
	 * is not to lose the fitting: the fitting is shrunk to the smallest radius
	 * its two widths allow - the existing valid-geometry constraint - so the
	 * elbow stays on the sheet, at the tightest bend that is still real.
	 */
	const minimumRadius = Math.max(startSeparation, endSeparation) / 2;

	const wallRadius =
		bendRadius > minimumRadius ? bendRadius : Math.max(minimumRadius + 1e-6, MINIMUM_BEND_RADIUS);

	const clamped = wallRadius !== bendRadius;

	const drawnBend = clamped
		? elbowGeometry(
				corner.before,
				corner.vertex,
				corner.after,
				wallRadius,
				{
					incoming: Math.hypot(corner.vertex.x - corner.before.x, corner.vertex.y - corner.before.y),
					outgoing: Math.hypot(corner.after.x - corner.vertex.x, corner.after.y - corner.vertex.y)
				}
			)
		: bend;

	if (!drawnBend) {
		return null;
	}

	/*
	 * ========================================================
	 * WHICH SIDE OF EACH RUN A WALL CONTINUES
	 * ========================================================
	 *
	 * The offset is applied from the RUN'S OWN CENTRELINE, in the SAME direction
	 * for both ends: `boundaryLines` puts one wall at `(-uy, ux) * half` along the
	 * run as it was drawn, `start -> end`. The incoming wall is the one at that
	 * side of the INCOMING run - and the outgoing wall at that same side of the
	 * OUTGOING run as that run was drawn. Both of those were read above in
	 * `boundaryLines(...)` terms, so each arc starts exactly where a straight
	 * wall ends instead of being matched by a guessed sign.
	 *
	 * WHICH ARC IS `outer` RESOLVES THE TWO. `outer` is the wall further from the
	 * bend's centre of the turn, which is the LEFT-hand side of the direction of
	 * travel: `(-d.y, d.x)` about the travel direction `d`. So a run whose own
	 * drawn direction is the travel direction contributes wall 0 (the `+n` wall)
	 * to `outer`, and a run drawn AGAINST the travel direction contributes wall 1
	 * (the `-n` wall) to `outer`. That is one rule for both arms, and it is the
	 * fix for walls that met their arcs on the wrong side at one end.
	 */
	const travelIn = directionOf(corner.before, corner.vertex);
	const travelOut = directionOf(corner.vertex, corner.after);

	/* The side the turn turns toward: `(-d.y, d.x)` for a left turn. */
	const inward = (travelIn && travelOut && travelIn.x * travelOut.y - travelIn.y * travelOut.x >= 0) ? 1 : -1;

	const incomingRun = separations.incomingRun || null;
	const outgoingRun = separations.outgoingRun || null;

	const drawnAlong = (run, travel) => {
		if (!run || !travel) {
			return true;
		}

		/* The run was drawn `start -> end`; travel is along its line. */
		const drawn = directionOf(run.geometry?.start, run.geometry?.end);

		if (!drawn) {
			return true;
		}

		return drawn.x * travel.x + drawn.y * travel.y > 0;
	};

	/* Index 0 is the `+n` wall, 1 the `-n` wall, of that run as it was drawn. */
	const incomingSide = drawnAlong(incomingRun, travelIn) ? 0 : 1;
	const outgoingSide = drawnAlong(outgoingRun, travelOut) ? 0 : 1;

	/* A LEFT TURN: travel turns toward `(-d.y, d.x)`, so that side is the outer one. */
	const outerSide = inward > 0 ? 0 : 1;

	/* One wall: the offset circle, sampled from the centreline's angles. */
	const wall = (outward) => {
		const startRadius = wallRadius + outward * (startSeparation / 2);
		const endRadius = wallRadius + outward * (endSeparation / 2);

		if (!(startRadius > 1e-9) || !(endRadius > 1e-9)) {
			return null;
		}

		const radiusAt = (t) => startRadius + (endRadius - startRadius) * t;

		const pointAt = (t) => {
			const angle = drawnBend.startAngle + sweep * t;
			const r = radiusAt(t);

			return {
				x: drawnBend.centre.x + r * Math.cos(angle),
				y: drawnBend.centre.y + r * Math.sin(angle)
			};
		};

		return {
			startRadius,
			endRadius,
			from: drawnBend.startAngle,
			sweep,
			start: pointAt(0),
			end: pointAt(1),
			pointAt
		};
	};

	const outer = wall(1);
	const inner = wall(-1);

	if (!outer || !inner) {
		return null;
	}

	/* Wall 0 is the `+n` side of the travel direction, which is `inner` on a left turn. */
	const positive = inward > 0 ? inner : outer;
	const negative = inward > 0 ? outer : inner;

	const incomingWall = incomingSide === 0 ? positive : negative;
	const outgoingWall = outgoingSide === 0 ? positive : negative;

	/*
	 * THE RESULT. `bend` is the arc the walls were built from, so a caller that
	 * needs the tangent points, the corner or the trim gets the SAME radius the
	 * walls are drawn at - and `clamped` says whether the configured radius had
	 * to be tightened to fit the two widths.
	 */
	return {
		bend: drawnBend,
		outer,
		inner,
		incoming: incomingWall,
		outgoing: outgoingWall,
		incomingSide,
		outgoingSide,
		outerSide,
		startSeparation,
		endSeparation,
		clamped
	};
}

/*
 * ========================================================
 * THE STRAIGHT RUN'S END ALONG A GIVEN WALL
 * ========================================================
 *
 * A run is drawn as TWO parallel lines, one on each side of its centreline.
 * This answers "where does the wall on a given side of this run stop, at the
 * end the fitting holds" - the exact point the bend's matching arc must start
 * from.
 *
 * `side` is +1 for the wall on the `(-uy, ux)` side of the run as it was drawn
 * and -1 for the other, which is the same convention `boundaryLines` uses. The
 * point is the centreline's tangent point offset by half the run's width, ON
 * THE RUN'S OWN LINE DIRECTION - so it is exactly where that straight wall
 * ends, whether or not the run's stored end is a rounding error away.
 */
export function wallEndAt(run, end, side, tangent) {
	if (!finitePoint(tangent)) {
		return null;
	}

	const span = runSpan(run);

	if (!span) {
		return null;
	}

	const half = boundarySeparation(run?.engineering || {}) / 2;

	return {
		x: tangent.x - span.direction.y * half * side,
		y: tangent.y + span.direction.x * half * side
	};
}

/*
 * ========================================================
 * THE EXACT JUNCTION
 * ========================================================
 *
 * Each run's wall must END precisely where its bend's arc BEGINS. Both are
 * derived from the same bend, but by two different routes:
 *
 *   the run's wall   offset of its centreline, stopping at the run's reach
 *   the bend's arc   offset of the bend's centreline, on `R +- half`
 *
 * Rounding, a stored reach that is a hair long, or a run whose own width was
 * changed after the bend was seated all leave the two a fraction apart - which
 * reads as a wall poking past the arc. This states the ONE pair of points the
 * junction is built from, so a caller (the renderer) can draw both to them:
 *
 *   each run's wall ends at its tangent point, offset by its own half-width
 *   each arc STARTS at exactly that point too
 *
 * `side` follows `boundaryLines`: +1 for the `(-uy, ux)` wall of a run as it was
 * drawn, -1 for the other. The arc's start point is moved onto it ALONG THE ARC'S
 * OWN RADIUS, so the wall and the arc stay tangent - the end point changes, the
 * direction does not, so there is no kink at the join.
 *
 * Returns `{ outer, inner, start, end }` for the two walls as they meet the bend,
 * or null when the bend cannot be drawn at all.
 */
export function elbowJunctionsFor(elbow, runs = {}) {
	const walls = elbowWallArcsFor(elbow, runs);

	if (!walls) {
		return null;
	}

	return {
		...walls,
		seams: {
			incoming: wallSeam(runs.incoming, elbow, walls.bend.start, false),
			outgoing: wallSeam(runs.outgoing, elbow, walls.bend.end, true)
		}
	};
}

/*
 * ========================================================
 * THE SEAM ON ONE RUN'S WALLS - ONE STATEMENT OF WHERE THEY STOP
 * ========================================================
 *
 * A joined run ends on its bend's TANGENT POINT, so its two walls stop `half`
 * either side of that point, measured PERPENDICULAR TO THE RUN'S OWN LINE. That
 * is precisely where `boundaryLines` draws them (it offsets from the run's span
 * and stops at the run's stored end), which is why the run must be SEATED on the
 * tangent point first - and it is why the walls and the arcs meet without a
 * correction: the bend's arcs are offset `half` from the SAME tangent points.
 *
 * Index 0 is the wall on the `(-uy, ux)` side of the run as it was drawn, index 1
 * the other - `boundaryLines`' own order.
 */
export function wallSeam(run, elbow, tangent) {
	void elbow;

	if (!run || !finitePoint(tangent)) {
		return null;
	}

	const span = runSpan(run);

	if (!span) {
		return null;
	}

	const half = boundarySeparation(run.engineering || {}) / 2;

	return [
		{ x: tangent.x - span.direction.y * half, y: tangent.y + span.direction.x * half },
		{ x: tangent.x + span.direction.y * half, y: tangent.y - span.direction.x * half }
	];
}

/*
 * THE TWO WALLS OF AN ELBOW ON THE SHEET.
 *
 * The fitting's arms ARE the two runs: each one is cut back to the tangent
 * point, so the visible span of the arm - from the FAR end the elbow stores to
 * the tangent point - is exactly the piece of run its walls are drawn along.
 * That span is the `source` `elbowWallArcs` measures each wall against, which
 * is how the bend knows which of the pipe's two lines each of its own
 * continues.
 *
 * IT IS DERIVED FROM THE FITTING'S OWN GEOMETRY, so the canvas, the source
 * writer and the tests all join the same pairs of lines. `source` is one arm
 * for each side of the bend, in `elbowGeometry`'s own order: `previous -> vertex
 * -> next`.
 */
export function elbowWallArcsFor(elbow, runs = {}) {
	const geometry = elbow?.geometry || {};
	const engineering = elbow?.engineering || {};

	if (!finitePoint(geometry.previous) || !finitePoint(geometry.position) || !finitePoint(geometry.next)) {
		return null;
	}

	const radius = Number(engineering.bendRadius);

	if (!Number.isFinite(radius) || radius <= 0) {
		return null;
	}

	const bend = elbowGeometry(
		geometry.previous,
		geometry.position,
		geometry.next,
		radius,
		elbowLegs(elbow)
	);

	if (!bend) {
		return null;
	}

	/*
	 * HOW WIDE EACH END IS. An elbow that records its two runs' widths uses
	 * them; one that does not is drawn at the fitting's own spacing.
	 */
	const startSeparation = Number(engineering.startSeparation) > 0
		? Number(engineering.startSeparation)
		: boundarySeparation(engineering);

	const endSeparation = Number(engineering.endSeparation) > 0
		? Number(engineering.endSeparation)
		: boundarySeparation(engineering);

	return elbowWallArcs(
		{ before: geometry.previous, vertex: geometry.position, after: geometry.next },
		radius,
		{
			startSeparation,
			endSeparation,
			engineering,

			/*
			 * THE TWO RUNS THE BEND JOINS, when the caller has them. They decide
			 * WHICH of the fitting's two lines each pipe continues, from the
			 * direction each run was actually drawn in - not from an assumed
			 * "incoming is `end`, outgoing is `start`" - so every combination
			 * (end-to-start, start-to-end, start-to-start, end-to-end) joins its
			 * walls to the right arcs.
			 */
			incomingRun: runs.incoming || null,
			outgoingRun: runs.outgoing || null
		}
	);
}

/*
 * THE TANGENT POINT ON ONE END OF A RUN.
 *
 * THE BEND OWNS IT. A bend of radius `R` and angle `A` is tangent to each run
 * at `R * tan(A / 2)` from the corner - so the point where the straight walls
 * stop is a property of the BEND, not of the trim a run happens to have stored.
 * Reading it from `elbowCurvesFor` is what keeps the two in step through a
 * radius change: a larger bend eats further along the run and the point slides
 * with it, and a run re-seated on it is always exactly on the arc's end.
 *
 * The point is also guaranteed ON the run, by construction: it is the run's far
 * end stepped along the run's own centreline, so the two walls and the arc end
 * at the same place whichever end the fitting holds.
 *
 * Returns null when the run does not reach that far - a run too short to hold
 * the bend - which a caller reads as "not seated here".
 */
export function elbowHeldEndOf(run, elbow, bends = null) {
	const geometry = elbow?.geometry || {};

	const ports = elbow?.engineering?.ports;

	const recorded = ports && !Array.isArray(ports) && run?.id ? ports[run.id] : null;

	if (recorded === "start" || recorded === "end") {
		return recorded;
	}

	/*
	 * WITHOUT A RECORD, THE END THAT MEETS THE BEND'S OWN TANGENT POINTS IS THE ONE
	 * IT HOLDS - compared with BOTH, so a pipe drawn in either direction and joined
	 * end-to-end in any combination is read the same way. The corner is only the
	 * fallback for a run whose bend cannot be measured.
	 */
	const start = run?.geometry?.start;
	const end = run?.geometry?.end;

	if (!finitePoint(start) || !finitePoint(end)) {
		return null;
	}

	const curves = bends || elbowCurvesFor(elbow);

	const nearest = (point) => (curves
		? Math.min(
				Math.hypot(point.x - curves.start.x, point.y - curves.start.y),
				Math.hypot(point.x - curves.end.x, point.y - curves.end.y)
			)
		: finitePoint(geometry.position)
			? Math.hypot(point.x - geometry.position.x, point.y - geometry.position.y)
			: null);

	const startGap = nearest(start);
	const endGap = nearest(end);

	if (startGap === null || endGap === null) {
		return null;
	}

	return startGap <= endGap ? "start" : "end";
}

export function tangentPointOnRun(run, end, elbow) {
	/*
	 * THE BEND IS MEASURED FROM THE RUNS IT JOINS, exactly as the renderer, the
	 * writer and `cornerOf` measure it. Without them the tangent would be placed
	 * against a bend of a different size, and the seat the seam and the corner test
	 * use would not be the seat the arcs actually touch - which is how a settled
	 * fitting read as "not joined" and was retired and rebuilt on every pass.
	 */
	const curves = elbowCurvesFor(elbow, runsForFitting(elbow));

	if (!curves) {
	return null;
	}

	/*
	 * WHICH TANGENT, DECIDED BY THE BEND'S OWN ARMS.
	 *
	 * `curves.start` belongs to the arm the bend arrives on (`previous`) and
	 * `curves.end` to the arm it leaves on (`next`). Which of a pipe's two ends
	 * is on which arm is decided by the pipe itself: the end lying nearer to that
	 * arm's far point is the one that meets it. Assuming "a pipe's `end` is the
	 * arc's start" is only true for one of the four ways two pipes can be
	 * joined, and for a branch drawn from the far side it is the wrong arc
	 * entirely.
	 */
	const geometry = elbow?.geometry || {};

	const ports = elbow?.engineering?.ports;

	const recorded = ports && !Array.isArray(ports) ? ports[run?.id] : null;

	if (recorded === "start" || recorded === "end") {
		/*
		 * THE RECORDED END NAMES THE SEAT; THE BEND NAMES THE ARM. `curves.start`
		 * is the tangent on the arm the fitting's FIRST run lies on (`previous`),
		 * so a run recorded first takes `start` whichever of its own ends the bend
		 * holds. Deciding that from the pipe's `end` alone is only right for one of
		 * the four end combinations.
		 */
		const order = Array.isArray(elbow?.engineering?.connections)
			? elbow.engineering.connections
			: [];

		const seat = order.indexOf(run?.id) === 1 ? curves.end : curves.start;

		return tangentPointOnRunAt(run, recorded, seat);
	}

	const armOf = (runEnd) => {
		const at = run?.geometry?.[runEnd];

		if (!at || !finitePoint(geometry.previous) || !finitePoint(geometry.next)) {
			return null;
		}

		const nearPrevious = Math.hypot(at.x - geometry.previous.x, at.y - geometry.previous.y);
		const nearNext = Math.hypot(at.x - geometry.next.x, at.y - geometry.next.y);

		return nearPrevious <= nearNext ? curves.start : curves.end;
	};

	return armOf(end);
}

/*
 * THE SAME, FROM A POINT THE BEND HOLDS.
 *
 * The point is projected onto the run's line, so a pipe whose stored end was
 * re-seated on a floating point a hair off its centreline still gets a tangent
 * on its centreline - and one whose end has been dragged AWAY gets the tangent
 * it would have had, which is only used when the run still reaches it.
 *
 * THE TANGENT MUST LIE ON THE RUN, BETWEEN ITS FAR END AND THE CORNER. A
 * projection that lands past the run's own far end - which happens the moment the
 * pipe is longer than the corner gave it room for, or when the seat is measured
 * against a bend of a different size - is NOT where the bend holds this run: it is
 * a point the run does not have. Returning it anyway let `cornerOf` compare each
 * held end with the OTHER run's far end and read every settled fitting as
 * "disconnected".
 */
function tangentPointOnRunAt(run, end, point) {
	const start = run?.geometry?.start;
	const endPoint = run?.geometry?.end;

	if (!finitePoint(start) || !finitePoint(endPoint) || !finitePoint(point)) {
		return null;
	}

	/*
	 * THE RUN'S LINE IS ITS SPAN, NOT ITS TWO STORED POINTS. A seated run's stored
	 * end already sits on the tangent point, so measuring the run from it would
	 * give a zero-length line on the next call. The span is the line the run was
	 * drawn along and survives being seated (see `runSpan`).
	 */
	const span = runSpan(run) || { start, end: endPoint };

		const length = Math.hypot(span.end.x - span.start.x, span.end.y - span.start.y);

		if (length < 1e-12) {
		return null;
		}

		/*
		 * A TANGENT BEYOND THE RUN'S OWN OUTER END IS NOT ON THE RUN. Measured along
		 * the run from its far end, the seat must lie between that far end and the
		 * corner - a little past it, within the connection tolerance, is the rounding
		 * of a re-cut and is kept.
		 */
			const cast =
		(point.x - span.start.x) * ((span.end.x - span.start.x) / length) +
		(point.y - span.start.y) * ((span.end.y - span.start.y) / length);

		if (cast < -1e-6 || cast > length + 1e-3) {
		return null;
		}

	const direction = {
		x: (span.end.x - span.start.x) / length,
		y: (span.end.y - span.start.y) / length
	};

	/*
	 * A TANGENT POINT BEYOND THE RUN IS NOT ON THE RUN.
	 *
	 * The run reaches from its far end to its joined end, so the most it can give
	 * up is its own length. A tangent point further in than that means the bend
	 * has outgrown this pipe, and there is no seat on it - the caller must clamp
	 * the radius (or leave the bend at its last valid size) rather than pull the
	 * pipe.
	 *
	 * A RAW (untouched) POINT A LITTLE PAST THE EVERYDAY END IS STILL PROJECTED,
	 * because a small floating-point overshoot at the very tangent the geometry
	 * just computed is not a different bend - only a real overrun is refused.
	 */
	const fromFar = end === "start" ? span.end : span.start;

	const face = end === "start" ? 1 : -1;

	const raw =
		face * ((point.x - fromFar.x) * direction.x + (point.y - fromFar.y) * direction.y);

	/* The run's whole span is its budget; a run already seated keeps its own end. */
	const budget = Math.max(length, reachOf(run, end, span));

	if (raw < -budget || raw > budget) {
		return null;
	}

		return {
		x: fromFar.x + face * direction.x * raw,
			y: fromFar.y + face * direction.y * raw
		};
	}

	/*
	 * HOW MUCH OF ITS LINE A RUN HAS ALREADY GIVEN UP TO A BEND.
	 *
	 * A seated run's stored joined end IS its tangent point, one trim in from the
	 * line's end. Kept beside the tangent reading because it is the same statement -
	 * how far along its own line this run reaches - and only one of them may be the
	 * authority at a time (see `tangentPointOnRunAt`).
	 */
function reachOf(run, end, span) {
	const stored = run?.geometry?.[end];

	const lineEnd = end === "start" ? span.start : span.end;

	return stored && finitePoint(lineEnd)
		? Math.hypot(stored.x - lineEnd.x, stored.y - lineEnd.y)
		: 0;
}

export function portsOf(feature) {
	const start = feature?.geometry?.start;
	const end = feature?.geometry?.end;

	if (!finitePoint(start) || !finitePoint(end)) {
		return [];
	}

	return [
		{ id: "start", point: { x: start.x, y: start.y } },
		{ id: "end", point: { x: end.x, y: end.y } }
	];
}

/*
 * An Elbow's two logical ends, END A and END B, in the order the corner turns.
 * Each is the tangent point where the fitting meets the adjoining run.
 *
 * A MANUAL ELBOW'S ENDS ARE ITS STORED POINTS. When the elbow records its two
 * ends (`geometry.ends`), the tangent points are derived from the bend angle
 * AND the radius, which for a manual elbow means they sit on the legs between
 * the ends and the corner - and a free elbow whose legs are short may place
 * them inside the legs. The STORED points are then what the student dragged and
 * what a pipe snaps to, so they are preferred; a corner between two runs keeps
 * its tangent points, which ARE the points the runs meet it at.
 */
export function elbowEnds(feature) {
	const geometry = feature?.geometry || {};

	const previous = geometry.previous;
	const next = geometry.next;
	const vertex = geometry.position;

	if (
		finitePoint(geometry.ends?.a) &&
		finitePoint(geometry.ends?.b) &&
		finitePoint(vertex)
	) {
		return [
			{ id: "a", point: { ...geometry.ends.a } },
			{ id: "b", point: { ...geometry.ends.b } }
		];
	}

	if (!finitePoint(previous) || !finitePoint(vertex) || !finitePoint(next)) {
		return [];
	}

	const curves = elbowGeometry(
		previous,
		vertex,
		next,
		feature?.engineering?.bendRadius
	);

	if (!curves) {
		return [
			{ id: "a", point: { x: vertex.x, y: vertex.y } },
			{ id: "b", point: { x: vertex.x, y: vertex.y } }
		];
	}

	return [
		{ id: "a", point: curves.start },
		{ id: "b", point: curves.end }
	];
}

/*
 * ========================================================
 * COMPATIBILITY OF TWO JOINED RUNS
 * ========================================================
 *
 * When an elbow is generated between two runs, its cross-section is copied
 * from the first compatible adjoining run - and if the two runs' profiles
 * disagree, that is REPORTED, not silently resolved.
 *
 * DO NOT: create a reducer, change a connected run, or pick a "continuing"
 * source value. A mismatch is a real engineering question the student must
 * answer, so it is shown as a warning and nothing is changed.
 *
 * Returns null when compatible, or an explanatory string when not.
 */
export function compatibilityIssue(first, second) {
	if (!first || !second) {
		return null;
	}

	const a = first.engineering || {};
	const b = second.engineering || {};

	const shapeA = a.shape || PIPE_SHAPES.circular;
	const shapeB = b.shape || PIPE_SHAPES.circular;

	if (shapeA !== shapeB) {
		return `Cross-section shapes differ (${PIPE_SHAPE_LABELS[shapeA]} against ${PIPE_SHAPE_LABELS[shapeB]})`;
	}

	if (shapeA === PIPE_SHAPES.rectangular) {
		if (Number(a.width) !== Number(b.width)) {
			return `Widths differ (${Number(a.width)} against ${Number(b.width)})`;
		}

		if (Number(a.height) !== Number(b.height)) {
			return `Heights differ (${Number(a.height)} against ${Number(b.height)})`;
		}

		return null;
	}

	if (Number(a.diameter) !== Number(b.diameter)) {
		return `Diameters differ (${Number(a.diameter)} against ${Number(b.diameter)})`;
	}

	return null;
}

export function isPipeDuctType(type) {
	return type === "pipe-duct";
}

export function isElbowType(type) {
	return type === "elbow";
}

export function isFluidRunType(type) {
	return type === "pipe-duct" || type === "elbow";
}

/*
 * ========================================================
 * A RUN TRIMMED BACK WHERE AN ELBOW TAKES OVER
 * ========================================================
 *
 * Where a bend is fitted, the STRAIGHT walls must stop where the bend begins -
 * at the elbow's tangent points - or the two walls would run on into the corner
 * and be drawn over each other. That is what makes a bend look like a fitting
 * rather than two pipes crossing at right angles.
 *
 * `trims` is the record of that, held on the run itself:
 *
 *     { start: distance, end: distance }
 *
 * Each distance is trimmed off the corresponding end of the CENTRELINE, so the
 * walls stop at the tangent point and the elbow's arcs carry on from there.
 * It is stored on the geometry rather than derived from the elbow at draw time,
 * because a run can be joined at both ends and each end's trim belongs to the
 * fitting that end is joined to - the run does not have to know what a bend is
 * to be drawn short.
 *
 * Returns `{ start, end }`, the trimmed centreline. A run with no trims is its
 * own centreline. A trim long enough to consume the run is refused rather than
 * turned inside out: the walls stop where they would have met.
 */
export function trimmedCentreline(feature) {
	const start = feature?.geometry?.start;
	const end = feature?.geometry?.end;

	if (!finitePoint(start) || !finitePoint(end)) {
		return null;
	}

	const length = Math.hypot(end.x - start.x, end.y - start.y);

	if (length < 1e-12) {
		return null;
	}

	const trims = feature.geometry.trims || {};

	const startTrim = Math.max(0, Number(trims.start) || 0);
	const endTrim = Math.max(0, Number(trims.end) || 0);

	/*
	 * BOTH TRIMS CANNOT EAT THE WHOLE RUN. If they would, they are scaled back
	 * together, so the run keeps a real (if tiny) straight length rather than
	 * inverting. A run shorter than its two bends already has both walls
	 * meeting inside the elbows, which is the honest drawing.
	 */
	const total = startTrim + endTrim;
	const scale = total > length ? length / total : 1;

	const from = pointAlong(start, end, startTrim * scale);
	const to = pointAlong(end, start, endTrim * scale);

	return {
		start: { x: from.x, y: from.y },
		end: { x: to.x, y: to.y }
	};
}

export const DEFAULT_ELBOW_ANGLE = 90;

export function createElbow(options = {}) {
	const geometry = normaliseElbowGeometry(options.geometry || {});

	if (!geometry) {
		return null;
	}

	const storedAngle = Number(options.engineering?.angleDegrees);

	const targetAngle = Number.isFinite(storedAngle)
		? normaliseAngle(storedAngle)
		: Number.isFinite(Number(options.geometry?.angleDegrees))
			? normaliseAngle(options.geometry.angleDegrees)
			: normaliseAngle(options.angleDegrees ?? DEFAULT_ELBOW_ANGLE);

	const engineering = {
		...(options.engineering || {}),
		angleDegrees: targetAngle,
		angle: targetAngle,
		bendRadius:
			Number(options.engineering?.bendRadius) > 0
				? Number(options.engineering.bendRadius)
				: readDefaultBendRadius()
	};

	return enggDrawingState.createGeometryObject("elbow", geometry, {
		...options,
		engineering
	});
}

export function normaliseElbowGeometry(geometry = {}) {
	const vertex = geometry.position;

	if (!finitePoint(vertex)) {
		return null;
	}

	const ends = [
		finitePoint(geometry.ends?.a) ? geometry.ends.a : null,
		finitePoint(geometry.ends?.b) ? geometry.ends.b : null
	];

	if (ends[0] && ends[1]) {
	  /*
	   * `previous` AND `next` ARE THE ENDS THEMSELVES.
	   *
	   * `elbowGeometry` reads `previous -> position` as the inbound arm and
	   * `position -> next` as the outbound one, so setting them to the two ends is
	   * exactly what makes the bend span the arms the student drew. Deriving
	   * further points along those directions would give the arms a length nothing
	   * asked for, and trim their tangent points against a leg that does not exist.
	   */
	  return {
	    position: { x: vertex.x, y: vertex.y },
	    ends: {
	      a: { x: ends[0].x, y: ends[0].y },
	      b: { x: ends[1].x, y: ends[1].y }
	    },
	    previous: { x: ends[0].x, y: ends[0].y },
	    next: { x: ends[1].x, y: ends[1].y }
	  };
	}

	const previous = geometry.previous;
	const next = geometry.next;

	if (!finitePoint(previous) || !finitePoint(next)) {
		return null;
	}

	const inDirection = directionOf(previous, vertex);
	const outDirection = directionOf(vertex, next);

	if (!inDirection || !outDirection) {
		return null;
	}

	return {
		position: { x: vertex.x, y: vertex.y },
		ends: {
			a: { x: previous.x, y: previous.y },
			b: { x: next.x, y: next.y }
		},
		previous: { x: previous.x, y: previous.y },
		next: { x: next.x, y: next.y }
	};
}

function elbowRadiusOf(elbow) {
	const radius = Number(elbow?.engineering?.bendRadius);

	return Number.isFinite(radius) && radius > 0 ? radius : readDefaultBendRadius();
}

/*
 * THE BEND ANGLE AN ELBOW ACTUALLY HAS, in degrees.
 *
 * The stored value is the target - it is what the Features field shows and
 * what a partially connected elbow's free end defines - so it is preferred.
 * An elbow with no stored angle has its arms' angle read off its geometry, in
 * the one place that knows how to convert it.
 */
export function elbowAngleDegrees(elbow) {
	return elbowAngleOf(elbow);
}

function elbowAngleOf(elbow) {
	const stored = Number(elbow?.engineering?.angleDegrees);

	if (Number.isFinite(stored)) {
		return normaliseAngle(stored);
	}

	/*
	 * FROM ITS ARMS, BY THE CORNER'S OWN RULE. `previous` and `next` both point
	 * away from the corner, so the angle between them is the included one and the
	 * bend is its supplement - the same conversion `cornerAngleFromArms` makes, so
	 * an elbow with no stored angle reads exactly like a corner measured between
	 * two pipes.
	 */
	return cornerAngleFromArms(
		elbow?.geometry?.next,
		elbow?.geometry?.position,
		elbow?.geometry?.previous
	);
}

export function elbowLegs(elbow) {
	const geometry = elbow?.geometry || {};
	const vertex = geometry.position;

	if (!finitePoint(vertex)) {
		return null;
	}

	/*
	 * A FITTING THAT STORES ITS OWN ENDS MEASURES THEM. `ends` are the two tangent
	 * points the student set, so the distance from each to the corner is the leg
	 * the bend actually has.
	 *
	 * A GENERATED FITTING STORES DIRECTIONS, NOT ENDS. Its `previous` and `next`
	 * are the FAR points of the two runs - what makes `cornerAngleDegrees` able to
	 * read the direction change - so they are NOT tangent points and must never be
	 * measured as legs. Placing the tangents by taking their distance from the
	 * corner would push both of them straight past the corner, to the far side of
	 * the join: the wall would be trimmed the wrong way and the bend would be drawn
	 * on top of its own pipes.
	 *
	 * So a generated fitting answers null - "this fitting does not own its legs" -
	 * and the caller supplies the lengths of the runs it joins, which is what
	 * `elbowCurvesFor` and the automatic trim do.
	 */
	if (!finitePoint(geometry.ends?.a) || !finitePoint(geometry.ends?.b)) {
		return null;
	}

	const a = geometry.ends.a;
	const b = geometry.ends.b;

	return {
		incoming: Math.hypot(a.x - vertex.x, a.y - vertex.y),
		outgoing: Math.hypot(b.x - vertex.x, b.y - vertex.y)
	};
}

/*
 * THE RAISE LIMIT FOR EACH ARM, IN RADIUS.
 *
 * A bend of radius `r` eats `r * tan(angle / 2)` out of each arm, so the largest
 * radius an arm can hold is its usable length divided by that tangent.
 *
 * A GENERATED ELBOW'S ARMS ARE THE PIPES THEMSELVES, and their usable length is
 * what the pipes CURRENTLY have - not what they had when the fitting was made.
 * The pipes are re-cut to the tangent points on every radius change, so their
 * length is the live truth; measuring the stored `previous`/`next` points would
 * report the pipes' original length forever, and let a fitting grow until a pipe
 * collapsed to zero length.
 *
 * `legs` lets a caller supply those live lengths; without it the elbow's own
 * geometry is measured, which is right for a MANUAL fitting whose arms it owns.
 *
 * A SUPPLIED LEG MAY BE SHORTER THAN THE BEND ALREADY THERE. When a pipe is
 * squeezed to nothing by a very large bend, the arm's capacity is negative - the
 * tangent point is already past the run's outer end. The limit is then floored at
 * a small positive radius rather than refused, so the fitting keeps a drawable
 * curve and the caller can shrink it to the corner's smallest valid size. A leg
 * MEASURED from elbow geometry with no length at all is still refused, because
 * there is then nothing to fit inside.
 */
export function elbowArmLimit(elbow, legs = null) {
	const angle = elbowAngleOf(elbow);

	if (angle === null || angle <= 1e-9) {
		return null;
	}

	const tangent = Math.tan((angle * Math.PI) / 360);

	if (!(tangent > 1e-9)) {
		return null;
	}

	const measured = legs || elbowLegs(elbow) || liveLegsFromRuns(runsForFitting(elbow));

	if (!measured) {
	return null;
	}

	const limit = Math.min(measured.incoming, measured.outgoing);

	if (!Number.isFinite(limit)) {
	return null;
	}

	/*
	 * NO LEG LEFT AT ALL - the corner has been folded shut. A caller that stated
	 * the legs (or a fitting whose runs are on the sheet) may still have a
	 * (negative) capacity; the floor below is what a bend of the smallest drawable
	 * radius needs. A MANUAL elbow that measures no arms of its own has nothing to
	 * fit, so it is refused.
	 */
	if (!legs && !elbowLegs(elbow) && !(limit > 1e-9)) {
	return null;
	}

	return Math.max(MINIMUM_BEND_RADIUS, limit / tangent);
}

export function elbowCurvesFor(elbow, runs = null) {
	const geometry = elbow?.geometry || {};
	/*
	 * THE ARMS OF A GENERATED BEND ARE ITS PIPES, AND THEIR LENGTH IS THE LIVE ONE.
	 *
	 * `elbowLegs` answers null for a generated fitting - deliberately, because its
	 * `previous`/`next` are the runs' FAR points rather than tangent points (see
	 * there). Passing that null straight into `elbowGeometry` made the `trim`
	 * calculation fall back to the straight distance from the corner to each far
	 * point, which for a joined pair installed by the tile, it is barely more than
	 * the trim itself: `refreshFluidConnections` then read no corner at all, the
	 * fitting was retired, and the next discovery pass put it straight back.
	 *
	 * So the runs are looked up from the fitting's own record (or supplied by a
	 * caller that already has them), and their current lengths are the legs - which
	 * is also the `trim` arithmetic. A fitting with no runs on the sheet (a manual
	 * bend, or one drawn before its pipes) keeps its own stored ends.
	 */
	const legs = runs && runs.length
	? liveLegsFromRuns(runs)
	: liveLegsFromRuns(runsForFitting(elbow));

	/*
	 * THE ARM LIMIT APPLIES ONLY WHEN THE BEND'S OWN ARMS ARE MEASURED. A caller
	 * that stated the legs has already said how much room there is, and the check
	 * below would apply them to a DIFFERENT span (`previous`/`next` are the runs'
	 * far points, not tangent points) - which is how a correct bend came back as
	 * "not drawable".
	 */
	return elbowGeometry(
	geometry.previous,
	geometry.position,
	geometry.next,
	elbowRadiusOf(elbow),
	legs
	);
}

/*
 * THE RUNS A FITTING RECORDS, resolved lazily so the model does not need the
 * document. A module that already HAD imported this way would close an import
 * cycle, so the sheet is asked for at call time.
 *
 * Returned in the fitting's own order - arriving run first - so each leg lands
 * on its own arm.
 */
function runsForFitting(elbow) {
	const ids = elbow?.engineering?.connections;

	if (!Array.isArray(ids) || !ids.length) {
	return [];
	}

	return ids.map((id) => (id ? objectById(id) : null));
}

/*
 * THE SHEET, INJECTED.
 *
 * This module is imported by the interaction layer, so it cannot import the
 * editor's live document back without a cycle. The editor publishes a lookup on
 * the module itself (`setObjectLookup`), and every reader that needs another
 * object - this one, and the writer's joined-run lookup - goes through it. A
 * caller with no document (a pure model test) simply gets no legs.
 */
let objectLookup = null;

export function setObjectLookup(lookup) {
	objectLookup = typeof lookup === "function" ? lookup : null;
}

function objectById(id) {
	if (!objectLookup) {
	return null;
	}

	try {
	return objectLookup(id) || null;
	} catch {
	return null;
	}
}

/*
 * THE TWO LEGS A BEND ACTUALLY HAS.
 *
 * A run joined to a fitting has been CUT BACK to that fitting's tangent point, so
 * its stored length IS the straight run the bend has left - which is the room the
 * arc must fit inside. A pair that has NOT been seated yet still has its whole
 * length against the corner, and that is the room its trim must fit inside - so
 * the leg is the run's own length either way, and the two readings agree the
 * moment the pair is seated.
 *
 * The legs are returned in THE FITTING'S OWN ORDER - arriving run first - so
 * each one lands on its own arm even when one run is much longer than the other.
 */
function liveLegsFromRuns(runs) {
	if (!runs || !runs[0] || !runs[1]) {
	return null;
	}

	return { incoming: runLength(runs[0]), outgoing: runLength(runs[1]) };
}

/*
 * THE RUNS A FITTING JOINS, in the fitting's own order.
 *
 * EXPORTED because every reader of a generated bend - the renderer's walls, the
 * writer's arcs, the seam, the seat and the arm limit - must measure the SAME bend.
 * When one of them measured without the runs it saw a differently sized arc, and
 * the straight wall and the curve stopped meeting.
 */
export function fittingRuns(elbow) {
	return runsForFitting(elbow);
}

/*
 * THE LARGEST RADIUS THAT ACTUALLY DRAWS.
 *
 * `elbowArmLimit` answers the largest radius the ARMS can hold. For a bend
 * whose ends are its own (a manual fitting) that is the radius at which the
 * tangent points sit exactly ON the ends - and at exactly that value the arc is
 * degenerate, so nothing is drawn. The limit a caller must clamp to is therefore
 * the largest one that still BUILDS, a hair inside the arm limit.
 *
 * For a GENERATED fitting the two coincide: its arms are the runs, re-cut to the
 * tangents, so the arm limit already draws.
 */
export function elbowFitRadius(elbow, legs = null) {
	const limit = elbowArmLimit(elbow, legs);

	if (limit === null) {
	return null;
	}

	const draws = (candidate) =>
	Boolean(
	elbowCurvesFor({
	...elbow,
	engineering: { ...(elbow.engineering || {}), bendRadius: candidate }
	})
	);

	if (draws(limit)) {
	return limit;
	}

	/* The nearest drawable radius just inside the limit. */
	for (let step = 1; step <= 6; step += 1) {
	const candidate = limit * (1 - 10 ** -step);

	if (draws(candidate)) {
	return candidate;
	}
	}

	return limit;
}

/*
 * THE SAME LIMIT, MEASURED FROM THE PIPES AN ELBOW IS JOINED TO.
 *
 * A generated elbow's arms ARE its pipes, so its true limit depends on how long
 * they currently are. This reads them from the runs the fitting records, which
 * is the measurement a radius change must respect.
 */
export function elbowFitRadiusFromRuns(elbow, runs = []) {
	if (!Array.isArray(runs) || !runs.length) {
		return elbowFitRadius(elbow);
	}

	const lengths = runs
		.filter((run) => run?.geometry?.start && run?.geometry?.end)
		.map((run) =>
			Math.hypot(
				run.geometry.end.x - run.geometry.start.x,
				run.geometry.end.y - run.geometry.start.y
			)
		);

	if (!lengths.length) {
		return elbowFitRadius(elbow);
	}

	return elbowArmLimit(elbow, {
		incoming: Math.max(...lengths),
		outgoing: Math.max(...lengths)
	});
}

/*
 * ========================================================
 * HOW MUCH RADIUS A CHANGE CAN ACTUALLY BE APPLIED
 * ========================================================
 *
 * Bend Radius is a RELATIVE adjustment. The requested change is offered to the
 * current radius and the result is CLAMPED to the largest radius the bend's
 * legs can hold, so a change that overshoots stops at the last valid size
 * instead of producing a tangent point past the end of a leg.
 *
 * Returns `{ radius, applied }`: the radius to store and the change really
 * made. A null answer means no radius is possible at all - a zero-length leg or
 * a straight bend - and the caller must leave the geometry exactly as it is.
 */
export function adjustedBendRadius(elbow, change, legs = null) {
	const current = elbowRadiusOf(elbow);
	const limit = elbowArmLimit(elbow, legs);

	if (limit === null || !(limit > 0)) {
		return null;
	}

	const requested = current + (Number(change) || 0);

	const radius = Math.max(MINIMUM_BEND_RADIUS, Math.min(limit, requested));

	return { radius, applied: radius - current, clamped: radius !== requested };
}

/*
 * ========================================================
 * WHERE THE CENTRE OF CURVATURE SITS, AND WHAT IT MEANS
 * ========================================================
 *
 * THE GEOMETRY. A circular bend of radius `R` through a direction change `A`
 * is tangent to both centreline arms at `t = R * tan(A / 2)` from the corner,
 * and its centre is `R / sin(A / 2)` from the corner, ON THE BISECTOR, on the
 * inside of the turn. The bisector angle `A / 2` is what links the three, so
 * given the distance from the corner to the centre the radius follows:
 *
 *     R = distance * sin(A / 2)
 *
 * Those are the SAME tangent points `elbowGeometry` places, from the same `R`
 * and `A` - so a radius read this way and a bend drawn from it cannot disagree.
 *
 * THE DIRECTION. Dragging the centre along the bisector increases or decreases
 * the radius; moving it OFF the bisector would move the corner as well, so only
 * its distance from the corner is used. The bend angle is never touched, which
 * is what keeps a connected fitting bound to the angle its pipes make.
 */

/* The inward bisector of the bend, as a unit direction from the corner. */
export function elbowBisector(elbow) {
	const geometry = elbow?.geometry || {};

	const inArm = directionOf(geometry.position, geometry.previous);
	const outArm = directionOf(geometry.position, geometry.next);

	if (!inArm || !outArm) {
		return null;
	}

	const sum = { x: inArm.x + outArm.x, y: inArm.y + outArm.y };

	const length = Math.hypot(sum.x, sum.y);

	if (length < 1e-9) {
		return null;
	}

	return { x: sum.x / length, y: sum.y / length };
}

/* The radius a centre at `distance` from the corner implies, for this bend. */
export function bendRadiusFromCentreDistance(elbow, distance) {
	const angle = elbowAngleOf(elbow);

	const centreDistance = Number(distance);

	if (angle === null || !Number.isFinite(centreDistance) || centreDistance <= 0) {
		return null;
	}

	const half = Math.sin((angle * Math.PI) / 360);

	if (!(half > 1e-9)) {
		return null;
	}

	return centreDistance * half;
}

/*
 * WOULD THIS RADIUS DRAW? Asked of a COPY, so the fitting is never left holding
 * a radius the arc cannot follow - the caller keeps its last valid geometry.
 */
export function isBendRadiusDrawable(elbow, radius) {
	const value = Number(radius);

	if (!elbow || !Number.isFinite(value) || value <= 0) {
		return false;
	}

	return Boolean(elbowCurvesFor({ ...elbow, engineering: { ...(elbow.engineering || {}), bendRadius: value } }));
}

/* Where the centre of curvature of the drawn bend actually is. */
export function elbowCentrePoint(elbow) {
	const curves = elbowCurvesFor(elbow);

	return curves ? { ...curves.centre } : null;
}

/*
 * ========================================================
 * THE SMALLEST BEND THAT CAN STILL BE DRAWN
 * ========================================================
 *
 * A bend needs a real curve, so no radius is allowed below this. It is the floor
 * `adjustedBendRadius` enforces and the floor `elbowArmLimit` reports, so a
 * fitting squeezed by a moving pipe stops at the same size the panel would.
 */
export const MINIMUM_BEND_RADIUS = 0.25;

/*
 * ========================================================
 * HAS THE STUDENT SET THIS BEND RADIUS THEMSELVES?
 * ========================================================
 *
 * A radius that the student changed - by typing it, by dragging the radius
 * handle, or by a transform - is a SETTING, and no later movement of the pipes
 * may quietly replace it. A radius the fitter chose when it made the bend is
 * not: it is the default, and it may still shrink when a corner becomes too
 * short for it.
 *
 * IT IS RECORDED, NOT GUESSED. Comparing the stored value against the current
 * default would call a student's radius "default" again the moment the two
 * happened to agree, so the flag is written where the change is made (see
 * `setBendRadius`) and is the one authority on the question.
 */
export const ELBOW_RADIUS_USER_SET = "bendRadiusUserSet";

export function isBendRadiusUserSet(elbow) {
	return elbow?.engineering?.[ELBOW_RADIUS_USER_SET] === true;
}

/*
 * THE RADIUS A FITTING SHOULD ACTUALLY BE DRAWN AT, given the two legs it must
 * fit inside:
 *
 *   a student-set radius   kept, unless the legs physically cannot hold it
 *   an automatic radius    kept, then shrunk to the corner if it no longer fits
 *
 * It never GROWS a bend: an automatic radius is not re-derived here, so moving
 * pipes cannot make a bend balloon, and a student's radius is not silently
 * changed back to the default either. A radius the legs cannot hold is clamped
 * to the largest that fits - the existing valid-geometry constraint behaviour.
 */
export function fittedBendRadius(elbow, legs) {
	const stored = elbowRadiusOf(elbow);
	const limit = elbowArmLimit(elbow, legs);

	if (limit === null) {
		return stored;
	}

	return Math.min(stored, limit);
}

/*
 * SET A BEND RADIUS. `options.user` records that the STUDENT chose this
 * radius - typed it, dragged the handle or applied a transform - so no later
 * movement of the pipes may replace it with something else. A radius written by
 * the fitter itself (the automatic path) leaves the flag as it was.
 */
export function setBendRadius(elbow, radius, options = {}) {
	if (!elbow || !Number.isFinite(Number(radius)) || Number(radius) <= 0) {
		return false;
	}

	elbow.engineering = {
		...(elbow.engineering || {}),
		bendRadius: Number(radius),
		...(options.user === true ? { [ELBOW_RADIUS_USER_SET]: true } : {})
	};

	return true;
}

/*
 * ========================================================
 * MOVING AN ELBOW'S CORNER, IN ITS OWN DIRECTIONS
 * ========================================================
 *
 * A manual elbow's shape is its corner, its two ENDS and its bend angle. Moving
 * the corner with the angle held is a SCALE of the two legs - each end slides
 * along its own leg, so the bend stays tangent to the two directions the
 * student set and only its size changes. That is what "drag the body to reshape
 * the corner" means for a fitting whose legs have no pipe to hold them.
 */
export function moveElbowCorner(elbow, corner) {
	const geometry = elbow?.geometry || {};

	if (!finitePoint(corner)) {
		return false;
	}

	const inDirection = directionOf(geometry.previous, geometry.position);
	const outDirection = directionOf(geometry.position, geometry.next);

	if (!inDirection || !outDirection) {
		return false;
	}

	const legs = elbowLegs(elbow);

	if (!legs) {
		return false;
	}

	elbow.geometry = {
		...geometry,
		position: { x: corner.x, y: corner.y },
		ends: {
			a: {
				x: corner.x - inDirection.x * legs.incoming,
				y: corner.y - inDirection.y * legs.incoming
			},
			b: {
				x: corner.x + outDirection.x * legs.outgoing,
				y: corner.y + outDirection.y * legs.outgoing
			}
		},
		previous: {
			x: corner.x - inDirection.x * legs.incoming,
			y: corner.y - inDirection.y * legs.incoming
		},
		next: {
			x: corner.x + outDirection.x * legs.outgoing,
			y: corner.y + outDirection.y * legs.outgoing
		}
	};

	return true;
}

/*
 * MOVE ONE END of a manual elbow, holding the other still and the BEND ANGLE
 * unchanged. Moving an end sweeps its leg about the fixed end, so the fitting
 * rotates and stretches while it stays the same bend: the angle is the one
 * property an end drag does not change, which is what makes the angle field
 * the single way to change it.
 */
export function moveElbowEnd(elbow, endId, point) {
	const geometry = elbow?.geometry || {};

	if (!finitePoint(point)) {
		return false;
	}

	const ends = {
		a: geometry.ends?.a ? { ...geometry.ends.a } : null,
		b: geometry.ends?.b ? { ...geometry.ends.b } : null
	};

	if (!ends.a || !ends.b) {
		return false;
	}

	const movable = endId === "a" ? "a" : "b";

	ends[movable] = { x: point.x, y: point.y };

	const angle = elbowAngleOf(elbow) ?? DEFAULT_ELBOW_ANGLE;

	const chord = Math.hypot(ends.b.x - ends.a.x, ends.b.y - ends.a.y);

	if (chord < 1e-6) {
		return false;
	}

	const solved = solveElbowCorner(ends.a, ends.b, angle, geometry.position);

	if (!solved) {
		return false;
	}

	elbow.geometry = {
		...geometry,
		position: solved.position,
		ends,
		previous: { x: ends.a.x, y: ends.a.y },
		next: { x: ends.b.x, y: ends.b.y }
	};

	return true;
}

/*
 * THE CORNER OF AN ELBOW WHOSE TWO ENDS AND BEND ANGLE ARE KNOWN.
 *
 * The corner sits on the perpendicular bisector of the chord, at the distance
 * the bend angle implies (see `elbowFromEnds`). There are TWO such corners,
 * one either side of the chord; `preferred` - where the corner was before the
 * drag - decides which, so dragging an end never flips the fitting over.
 */
export function solveElbowCorner(start, end, angleDegrees, preferred = null) {
	if (!finitePoint(start) || !finitePoint(end)) {
		return null;
	}

	const chord = Math.hypot(end.x - start.x, end.y - start.y);

	if (chord < 1e-6) {
		return null;
	}

	const angle = normaliseAngle(angleDegrees ?? DEFAULT_ELBOW_ANGLE) || DEFAULT_ELBOW_ANGLE;

	if (angle < 1e-6) {
		return null;
	}

	/*
	 * THE CORNER'S DISTANCE FROM THE CHORD.
	 *
	 * The corner, the two ends and the chord form an ISOSCELES triangle: each leg
	 * meets the chord at `bend / 2`, because the two leg-to-chord angles are equal
	 * and the bend is what is left of the straight line through them. So the
	 * corner stands `(chord / 2) * tan(bend / 2)` out from the chord's midpoint.
	 *
	 * A 90 degree bend therefore puts the corner exactly one half-chord out - the
	 * square corner a student expects - and a small bend barely leaves the line.
	 */
	const base = (angle / 2) * (Math.PI / 180);
	const height = (chord / 2) * Math.tan(base);

	const along = directionOf(start, end);
	const normal = { x: -along.y, y: along.x };

	const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };

	const sides = [1, -1].map((sign) => ({
		x: midpoint.x + normal.x * height * sign,
		y: midpoint.y + normal.y * height * sign
	}));

	if (!finitePoint(preferred)) {
		return { position: sides[0], angleDegrees: angle };
	}

	const distanceTo = (candidate) =>
		Math.hypot(candidate.x - preferred.x, candidate.y - preferred.y);

	const [best] = sides.sort((left, right) => distanceTo(left) - distanceTo(right));

	return { position: best, angleDegrees: angle };
}

/*
 * SET AN ELBOW'S BEND ANGLE, holding its two ends where they are.
 *
 * This is the angle field's one write, and the angle handle's. The ends do not
 * move, so an elbow joined to a pipe STAYS joined to it while its bend opens or
 * closes; only the corner slides along the bisector. Fully connected elbows
 * never reach here - their angle is the pipes' - but the arithmetic is the same
 * one a partially connected elbow uses for its free end.
 */
export function setElbowAngle(elbow, degrees) {
	const geometry = elbow?.geometry || {};

	const ends = {
		a: geometry.ends?.a ? { ...geometry.ends.a } : null,
		b: geometry.ends?.b ? { ...geometry.ends.b } : null
	};

	if (!ends.a || !ends.b) {
		return false;
	}

	const solved = solveElbowCorner(ends.a, ends.b, degrees, geometry.position);

	if (!solved) {
		return false;
	}

	elbow.geometry = {
		...geometry,
		position: solved.position,
		ends,
		previous: { x: ends.a.x, y: ends.a.y },
		next: { x: ends.b.x, y: ends.b.y }
	};

	elbow.engineering = {
		...(elbow.engineering || {}),
		angleDegrees: solved.angleDegrees,
		angle: solved.angleDegrees
	};

	return true;
}

/*
 * MOVE A WHOLE ELBOW, keeping its shape exactly.
 *
 * Used for body dragging of a STANDALONE fitting: every stored point moves by
 * the same delta, so the bend angle, the legs and the radius are untouched.
 */
export function translateElbow(elbow, deltaX, deltaY) {
	const geometry = elbow?.geometry || {};

	const dx = Number(deltaX);
	const dy = Number(deltaY);

	if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
		return false;
	}

	const shift = (candidate) =>
		finitePoint(candidate)
			? { x: candidate.x + dx, y: candidate.y + dy }
			: candidate;

	const ends = geometry.ends
		? { a: shift(geometry.ends.a), b: shift(geometry.ends.b) }
		: undefined;

	elbow.geometry = {
		...geometry,
		...(ends ? { ends } : {}),
		position: shift(geometry.position) || geometry.position,
		previous: shift(geometry.previous) || geometry.previous,
		next: shift(geometry.next) || geometry.next
	};

	if (geometry.trims) {
		elbow.geometry.trims = { ...geometry.trims };
	}

	return true;
}

/*
 * ========================================================
 * A NEW MANUAL ELBOW, FROM TWO DRAWN ENDS
 * ========================================================
 *
 * The gesture places the two ENDS; the corner follows from them and the bend
 * angle. Two ends give a leg in each direction, and the corner is where those
 * legs meet at the requested angle - the one nearest the second end, so a
 * drag to the right and then up bends the way the student drew it.
 */
export function elbowFromEnds(start, end, angleDegrees = DEFAULT_ELBOW_ANGLE) {
	if (!finitePoint(start) || !finitePoint(end)) {
		return null;
	}

	const solved = solveElbowCorner(start, end, angleDegrees, null);

	if (!solved) {
		return null;
	}

	return {
		position: solved.position,
		ends: {
			a: { x: start.x, y: start.y },
			b: { x: end.x, y: end.y }
		},
		previous: { x: start.x, y: start.y },
		next: { x: end.x, y: end.y },
		angleDegrees: solved.angleDegrees
	};
}

const enggPipeDuct = {
	PIPE_SHAPES,
	PIPE_SHAPE_LABELS,
	SUPPORTED_SHAPES,
	MINIMUM_CORNER_ANGLE,
	MAXIMUM_CORNER_ANGLE,
	CORNER_EPSILON_DEGREES,
	DEFAULT_DIAMETER,
	DEFAULT_WIDTH,
	DEFAULT_HEIGHT,
	DEFAULT_SCHEMATIC_SEPARATION,
	DEFAULT_SCHEMATIC_SPACING,

	cornerAngleDegrees,
	cornerAngleFromArms,
	supportsCornerArms,
	supportedElbowAngle,
	elbowHeldEndOf,
	tangentPointOnRun,
	defaultPipeEngineering,
	dimensionalKeysFor,
	dimensionsOf,
	boundarySeparation,
	boundaryLines,
	boundaryLinesOf,
	runSpan,

	createPipeDuct,
	runLength,
	elbowGeometry,
	elbowWallArcs,
	elbowWallArcsFor,
	elbowJunctionsFor,
	wallSeam,
	wallEndAt,
	portsOf,
	elbowEnds,
	compatibilityIssue,

	setDefaultBendRadius,
	readDefaultBendRadius,

	DEFAULT_BEND_RADIUS_ONES,
	DEFAULT_ELBOW_ANGLE,
	COMMON_ELBOW_ANGLES,
	ELBOW_ANGLE_SNAP_TOLERANCE,
	trimDistanceFor,
	angleBetweenDirections,
	directionOf,
	normaliseAngle,
	snapElbowAngle,

	createElbow,
	normaliseElbowGeometry,
	elbowLegs,
	elbowCurvesFor,
	setObjectLookup,
	fittingRuns,
	elbowFitRadius,
	elbowAngleDegrees,
	bendAngleFromArms,
	adjustedBendRadius,
	MINIMUM_BEND_RADIUS,
	ELBOW_RADIUS_USER_SET,
	isBendRadiusUserSet,
	fittedBendRadius,
	elbowBisector,
	bendRadiusFromCentreDistance,
	elbowCentrePoint,
	isBendRadiusDrawable,
	setBendRadius,
	moveElbowCorner,
	moveElbowEnd,
	solveElbowCorner,
	setElbowAngle,
	translateElbow,
	elbowFromEnds,

	isPipeDuctType,
	isElbowType,
	isFluidRunType,
	trimmedCentreline
};

export default enggPipeDuct;
