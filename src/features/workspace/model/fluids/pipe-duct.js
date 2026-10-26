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
 * THE SUPPORTED CORNER ANGLES
 * ========================================================
 *
 * A corner between two runs is a DIRECTION CHANGE, and only a change of 45 or
 * 90 degrees is a supported elbow. Anything else stays an ordinary corner.
 *
 * THE TOLERANCE IS GEOMETRIC, NOT AN ENGINEERING WINDOW.
 *
 * DAETUM has no established angular tolerance for recognising a fitting, and
 * inventing one - "within two degrees is a 90" - would be inventing an
 * engineering rule that is not in the application. So a corner is recognised
 * when the two runs' directions differ by the supported angle TO FLOATING
 * POINT EXACTNESS (`CORNER_EPSILON_DEGREES`), which recognises only a true 45
 * or 90 and refuses to guess at anything near one. That is the honest reading
 * of "reuse the existing tolerance where available; otherwise report the
 * missing decision".
 *
 * The tolerance is named and exported so the decision is visible and can be
 * changed in one place when an engineering tolerance is agreed.
 */
export const SUPPORTED_CORNER_ANGLES = Object.freeze([45, 90]);

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
 * The supported elbow angle a corner is, or null when it is an ordinary corner.
 */
export function supportedElbowAngle(angleDegrees) {
	if (!Number.isFinite(angleDegrees)) {
		return null;
	}

	return (
		SUPPORTED_CORNER_ANGLES.find(
			(angle) => Math.abs(angleDegrees - angle) <= CORNER_EPSILON_DEGREES
		) ?? null
	);
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
 * world unit). At 2.4 px per unit at zoom 1, 20 world units draw the two
 * boundaries about 48 px apart, leaving room for the curved end breaks,
 * noticeably tighter than the wider schematic the tool used to draw, and
 * identical no matter what those dimensions are changed to.
 *
 * Shared by straight runs, their live preview and curved elbows so joined
 * walls use the same spacing throughout.
 */
export const DEFAULT_SCHEMATIC_SEPARATION = 20;
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
 * The `engineering` argument is accepted so every call site - renderer,
 * preview, hit-testing, elbow arcs - keeps one signature, and so a future
 * drawing-style setting can be threaded through the same door. Today it is
 * deliberately not read for the value itself.
 */
export function boundarySeparation(_engineering = {}) {
	return DEFAULT_SCHEMATIC_SEPARATION;
}

/*
 * The two boundary lines of a straight run, in world coordinates.
 *
 * Both lines are generated from the SAME centreline and the SAME schematic
 * separation, so they can never disagree with each other or with the feature's
 * other geometry. The offset is applied perpendicular to the run's direction.
 *
 * Returns `[lineA, lineB]`, each `{ start, end }`, or an empty array when the
 * centreline is degenerate.
 */
export function boundaryLines(start, end, engineering = {}) {
	if (!finitePoint(start) || !finitePoint(end)) {
		return [];
	}

	const dx = end.x - start.x;
	const dy = end.y - start.y;

	const length = Math.hypot(dx, dy);

	if (length < 1e-12) {
		return [];
	}

	const separation = boundarySeparation(engineering);

	if (separation === null) {
		return [];
	}

		/*
	 * The half-offset normal to the run. The schematic boundaries sit one
	 * schematic separation apart, so each is half of it from the centreline.
	 */
	const half = separation / 2;

	const nx = (-dy / length) * half;
	const ny = (dx / length) * half;

	return [
		{
			start: { x: start.x + nx, y: start.y + ny },
			end: { x: end.x + nx, y: end.y + ny }
		},
		{
			start: { x: start.x - nx, y: start.y - ny },
			end: { x: end.x - nx, y: end.y - ny }
		}
	];
}

// Parallel walls and an S-shaped break with a return lip at each end.
// Construct in the run's local frame so vertical and diagonal pipes match.
export function pipeDuctPaths(start, end, engineering = {}) {
	const walls = boundaryLines(start, end, engineering);
	if (!walls.length) return [];
	const length = Math.hypot(end.x - start.x, end.y - start.y);
	const ux = (end.x - start.x) / length;
	const uy = (end.y - start.y) / length;
	const half = boundarySeparation(engineering) / 2;
	const amplitude = Math.min(half, length * 0.2);
	const paths = walls.map(wall => [wall.start, wall.end]);
	const cubic = (a, b, c, d, t) => {
		const s = 1 - t;
		return a.map((value, index) => s ** 3 * value + 3 * s ** 2 * t * b[index] + 3 * s * t ** 2 * c[index] + t ** 3 * d[index]);
	};
	for (const [origin, sign] of [[start, 1], [end, -1]]) {
		const at = (across, along) => ({
			x: origin.x - uy * across + ux * along * sign,
			y: origin.y + ux * across + uy * along * sign
		});
		const left = sign === 1;
		const controls = left
			? [[1, 0], [0.8, -0.55], [-0.35, 0.75], [-1, 0]]
			: [[1, 0], [0.4, 0.75], [-0.4, -0.35], [-1, 0]];
		const sample = (values, steps = 48) => Array.from({ length: steps + 1 }, (_, index) => {
			const [across, along] = cubic(...values, index / steps);
			return at(across * half, along * amplitude);
		});
		paths.push(sample(controls));
		// The sketch has a lower return on the left and an upper return on
		// the right, rather than identical half-ellipses on both ends.
		const join = cubic(...controls, 0.45);
		paths.push(sample(left
			? [[-1, 0], [-0.5, -0.28], [-0.02, -0.12], join]
			: [[1, 0], [0.7, -0.28], [0.15, -0.2], [-0.2, 0.055]]));
	}
	return paths;
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
 * Build ONE straight run from two endpoints and a cross-section. The run is an
 * ordinary feature with no parent: it is created, selected, edited, saved and
 * deleted like any other top-level feature.
 */
export function createPipeDuct(start, end, options = {}) {
	if (!finitePoint(start) || !finitePoint(end)) {
		return null;
	}

	if (Math.hypot(end.x - start.x, end.y - start.y) < 1e-9) {
		return null;
	}

	const engineering = {
		...defaultPipeEngineering(options.shape),
		...(options.engineering || {})
	};

	const geometry = {
		start: { x: start.x, y: start.y },
		end: { x: end.x, y: end.y }
	};

	return enggDrawingState.createGeometryObject("pipe-duct", geometry, {
		...options,
		engineering
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
 * drift apart.
 *
 * THE ARC IS DESCRIBED, NOT TILED: this returns the tangent points, the arc
 * centre, the radius, the sweep and the sweep direction, which is everything a
 * renderer needs - and nothing that presumes how many points to sample it into.
 */
function trimDistanceFor(radius, angleDegrees) {
	return radius * Math.tan((angleDegrees * Math.PI) / 360);
}

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
 * THE DEFAULT BEND RADIUS - AN UNRESOLVED PRODUCT DECISION
 * ========================================================
 *
 * DAETUM has no established engineering default for a bend radius, and this
 * task forbids inventing one: an initial value would be a claim about real
 * pipework the application has no basis to make. So a newly generated elbow
 * starts with NO bend radius (`undefined`) and therefore no curved geometry
 * until the student supplies one.
 *
 * NOTHING HERE BLOCKS BASIC DRAWING. A run always draws its two boundary
 * lines; only the CURVED fitting is withheld until a radius exists, and the
 * corner is drawn as an ordinary corner in the meantime. That is the split the
 * task draws between "keep basic straight-segment drawing functional" and
 * "report blockers for unsupported curved geometry".
 *
 * The decision is named here so it is visible in one place and can be given a
 * value the day an engineering convention is agreed. `setDefaultBendRadius`
 * exists so an application-level drawing default can set it without this
 * module inventing an engineering number of its own.
 */
export let DEFAULT_BEND_RADIUS = undefined;

export function setDefaultBendRadius(radius) {
  const numeric = Number(radius);

  DEFAULT_BEND_RADIUS =
    Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;

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
 */
export function elbowGeometry(previous, vertex, next, radius) {
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
	 */
	if (trim > incomingLength || trim > outgoingLength) {
		return null;
	}

	const start = pointAlong(previous, vertex, incomingLength - trim);
	const end = pointAlong(vertex, next, trim);

	const cross =
		(vertex.x - previous.x) * (next.y - vertex.y) -
		(vertex.y - previous.y) * (next.x - vertex.x);

	/*
	 * THE ARC CENTRE. It lies `radius` from the vertex along the bisector of
	 * the two runs, on the inside of the turn. Found as the point `radius`
	 * perpendicular from each tangent point.
	 */
	const inDirection = {
		x: (vertex.x - previous.x) / incomingLength,
		y: (vertex.y - previous.y) / incomingLength
	};

	const outDirection = {
		x: (next.x - vertex.x) / outgoingLength,
		y: (next.y - vertex.y) / outgoingLength
	};

	const centre = {
		x: start.x + inDirection.y * (cross >= 0 ? bendRadius : -bendRadius),
		y: start.y - inDirection.x * (cross >= 0 ? bendRadius : -bendRadius)
	};

	const a0 = Math.atan2(start.y - centre.y, start.x - centre.x);
	const a1 = Math.atan2(end.y - centre.y, end.x - centre.x);

	return {
		position: { x: vertex.x, y: vertex.y },
		start: { x: start.x, y: start.y },
		end: { x: end.x, y: end.y },
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
 * THE PIPE / DUCT FEATURE FACTORY - ENDPOINT SNAP REFERENCE
 * ========================================================
 *
 * A run's two logical ports. These are the ONLY snap/connection targets a run
 * publishes: the two boundary lines are NOT independent flow paths and do NOT
 * publish endpoints of their own.
 */
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
 */
export function elbowEnds(feature) {
	const geometry = feature?.geometry || {};

	const previous = geometry.previous;
	const next = geometry.next;
	const vertex = geometry.position;

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

const enggPipeDuct = {
	PIPE_SHAPES,
	PIPE_SHAPE_LABELS,
	SUPPORTED_SHAPES,
	SUPPORTED_CORNER_ANGLES,
	CORNER_EPSILON_DEGREES,
	DEFAULT_DIAMETER,
	DEFAULT_WIDTH,
	DEFAULT_HEIGHT,
	DEFAULT_SCHEMATIC_SEPARATION,
	DEFAULT_SCHEMATIC_SPACING,

	cornerAngleDegrees,
	supportedElbowAngle,
	defaultPipeEngineering,
	dimensionalKeysFor,
	dimensionsOf,
	boundarySeparation,
	boundaryLines,
	pipeDuctPaths,

	createPipeDuct,
	runLength,
	elbowGeometry,
	portsOf,
	elbowEnds,
	compatibilityIssue,

	setDefaultBendRadius,
	readDefaultBendRadius,

	isPipeDuctType,
	isElbowType,
	isFluidRunType
};

export default enggPipeDuct;
