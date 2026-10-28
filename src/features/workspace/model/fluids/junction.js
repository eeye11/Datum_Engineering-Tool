/*
 * ========================================================
 * THE JUNCTION FEATURE
 * ========================================================
 *
 * A Junction connects THREE OR MORE pipe branches through ONE logical drawing
 * object. It is the third of the Fluids flow-path fittings, beside the straight
 * Pipe / Duct run and the two-ended Elbow, and it follows the same rules they
 * do: one feature type, one stable id, one connection record, one source block.
 *
 * ========================================================
 * THE MODEL: A HUB AND ITS BRANCH ARMS
 * ========================================================
 *
 * A junction is stored as:
 *
 *     position        the hub - where the branches meet
 *     branches[]      one arm per branch, each with:
 *                       id         "a", "b", "c", ... (stable within the object)
 *                       direction  a UNIT VECTOR out from the hub
 *                       length     the STUB length (never a pipe run)
 *                       angle      the aimed angle, in degrees, from the main run
 *                       connected  the id of the pipe joined here, or null
 *                       width      the arm's boundary separation
 *     mainDirection   the unit vector the angles are measured against
 *     mainBranchId    which branch IS the main run (or null)
 *
 * ========================================================
 * WHY STUBS, AND WHY THEY ARE NOT PIPES
 * ========================================================
 *
 * A junction's arms exist to say WHERE a branch leaves the fitting and IN WHICH
 * DIRECTION, and to publish a connection endpoint a real pipe can be snapped to.
 * They are therefore as short as the geometry needs them to be - long enough to
 * clear the junction's own contour and to give the student a visible grip, and
 * no longer. A branch has NO length of its own as a property: the length is
 * derived (`stubLength`) from the branch widths and the longest neighbouring
 * run, and there is no field for it in the panel and no handle to drag it.
 *
 * The ACTUAL run of pipework on a branch belongs to its own Pipe / Duct object.
 * A student who wants a longer branch draws or extends a pipe from the stub end.
 *
 * ========================================================
 * THE CONTOUR: ONE CONTINUOUS OUTER BOUNDARY
 * ========================================================
 *
 * `junctionOutline` builds ONE closed path around the hub. Each branch
 * contributes a half-width mouth perpendicular to its direction, where the
 * connected pipe meets it at its OWN width; those mouths are joined by rounded
 * corners, so a three-way tee reads as a smooth fitting rather than three tubes
 * crossing.
 *
 * The mouths are joined in angular order and the corners between them are
 * sampled as arcs, so the path is continuous, non-self-intersecting, and cannot
 * be left with a gap or a step when the connected pipes differ in width. The
 * inner boundary is NOT drawn: a junction is an open fitting whose branches run
 * into one another, which is how a tee appears on an engineering drawing.
 *
 * ========================================================
 * WHAT IS DELIBERATELY NOT HERE
 * ========================================================
 *
 * No Pipe Assembly parent/child hierarchy - connections are recorded explicitly
 * (branch `connected` ids plus the pipes' own records) and grouping is left to
 * the later assembly work. No branch-length property. No rotation. No separate
 * reducer: a width mismatch is BLENDED by the contour, and the connected pipes
 * keep their own widths untouched.
 */
import enggDrawingState from "../../../../shared/model/drawing-state.js";
import enggPipeDuct from "./pipe-duct.js";

/* ============================================================
 * THE CONSTANTS
 * ============================================================ */

/*
 * The minimum number of branches a junction represents. Below this it is a
 * corner (two branches, the Elbow's job) or nothing at all.
 */
export const MINIMUM_BRANCHES = 3;

/* The default number of branches a manual junction is drawn with. */
export const DEFAULT_BRANCH_COUNT = 3;

/* The angle a free default branch leaves at, measured from the main run. */
export const DEFAULT_BRANCH_ANGLE = 90;

/*
 * THE STUB'S MINIMUM LENGTH, in world units.
 *
 * It is the distance from the hub to the connection endpoint a pipe snaps to.
 * It has to clear the junction's own contour - whose corner radius grows with the
 * branch widths - so the true length is `max(MIN, contourRadius)`; see
 * `stubLength`. The floor is what keeps the endpoint visible and grabbable at
 * every zoom.
 */
export const MINIMUM_STUB_LENGTH = 8;

/* The corner radius of the contour, as a multiple of the widest arm's half-width. */
export const CONTOUR_CORNER_FACTOR = 1.15;

/*
 * THE COMMON ANGLES a free branch snaps to while being dragged. It is a set of
 * STOPS, not a restriction: dragging away from one, or typing a number, reaches
 * any valid angle.
 */
export const COMMON_BRANCH_ANGLES = Object.freeze([30, 45, 60, 90, 135]);
export const BRANCH_ANGLE_SNAP_TOLERANCE = 6;

/* ============================================================
 * SMALL GEOMETRY HELPERS
 * ============================================================ */

function finitePoint(point) {
	return Boolean(point) && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function unit(vector) {
	if (!vector || !Number.isFinite(vector.x) || !Number.isFinite(vector.y)) {
		return null;
	}

	const length = Math.hypot(vector.x, vector.y);

	if (length < 1e-9) {
		return null;
	}

	return { x: vector.x / length, y: vector.y / length };
}

/* A unit vector along `a -> b`, or null when the two points coincide. */
export function directionOf(a, b) {
	if (!finitePoint(a) || !finitePoint(b)) {
		return null;
	}

	return unit({ x: b.x - a.x, y: b.y - a.y });
}

/* The signed angle from `from` to `to`, in degrees, folded into 0..360. */
export function signedAngleBetween(from, to) {
	const a = unit(from);
	const b = unit(to);

	if (!a || !b) {
		return null;
	}

	const cross = a.x * b.y - a.y * b.x;
	const dot = a.x * b.x + a.y * b.y;

	const degrees = (Math.atan2(cross, dot) * 180) / Math.PI;

	return (degrees + 360) % 360;
}

/*
 * THE ANGLE OF A BRANCH FROM THE MAIN RUN, in 0..180 degrees.
 *
 * This is an ABSOLUTE resulting angle, not a change: "Branch 3 Angle 90" means
 * the branch leaves at right angles to the main run. Which side it turns to is
 * carried by the direction vector itself, so a nominal tee reads 90 whichever
 * way the run happens to point - rather than 90 on one side and 270 on the other.
 *
 * A branch lying exactly along the main run reads 0 and one lying exactly opposed
 * reads 180; both are degenerate for a junction and are refused when editing.
 */
export function branchAngleFrom(main, direction) {
	const signed = signedAngleBetween(main, direction);

	if (signed === null) {
		return null;
	}

	return signed > 180 ? 360 - signed : signed;
}

/* A unit vector at `degrees` (counter-clockwise) from `main`. */
export function directionAtAngle(main, degrees) {
	const base = unit(main);

	if (!base || !Number.isFinite(Number(degrees))) {
		return null;
	}

	const radians = (Number(degrees) * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);

	return {
		x: base.x * cos - base.y * sin,
		y: base.x * sin + base.y * cos
	};
}

/* The shortest signed turn from one angle to another, in degrees. */
function deltaDegrees(from, to) {
	let value = Number(to) - Number(from);

	while (value > 180) value -= 360;
	while (value < -180) value += 360;

	return value;
}

/*
 * THE SNAP FOR A FREE BRANCH ANGLE.
 *
 * Returns the common angle when the pointer is close to one, and the true angle
 * otherwise - so a student can place a true 45 without being captured by it, and
 * can still reach 37 by dragging past the stop.
 */
export function snapBranchAngle(degrees) {
	const value = Number(degrees);

	if (!Number.isFinite(value)) {
		return null;
	}

	const normalised = ((value % 360) + 360) % 360;

	const nearest = COMMON_BRANCH_ANGLES.reduce(
		(best, candidate) =>
			Math.abs(deltaDegrees(normalised, candidate)) < Math.abs(deltaDegrees(normalised, best))
				? candidate
				: best,
		COMMON_BRANCH_ANGLES[0]
	);

	return Math.abs(deltaDegrees(normalised, nearest)) <= BRANCH_ANGLE_SNAP_TOLERANCE
		? nearest
		: normalised;
}

/* ============================================================
 * BRANCH IDS AND ORDER
 * ============================================================ */

/*
 * THE STABLE BRANCH LETTERS.
 *
 * A branch keeps its letter for the life of the junction, so a panel row that
 * says "Branch 3 Angle" keeps addressing the same arm however many times the
 * object is redrawn or re-parsed. New branches take the next unused letter.
 */
const BRANCH_LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");

export function nextBranchId(branches = []) {
	const used = new Set((branches || []).map((branch) => branch.id));

	const free = BRANCH_LETTERS.find((letter) => !used.has(letter));

	return free || `b${branches.length + 1}`;
}

/* The 1-based position a branch letter occupies, for its label ("Branch 3"). */
export function branchOrdinal(branchId) {
	const index = BRANCH_LETTERS.indexOf(String(branchId || "").toLowerCase());

	return index >= 0 ? index + 1 : null;
}

/* Branches in ANGULAR order around the hub, so the contour can be walked. */
	export function orderedBranches(junction) {
	const hub = junction?.geometry?.position;

	const branches = junction?.geometry?.branches || [];

	if (!finitePoint(hub) || branches.length < 2) {
	return [...branches];
	}

	/*
	 * THE WALK IS BY TRUE BEARING - `atan2(y, x)` - around the hub, rising.
	 *
	 * Sorting by the angle measured OFF THE MAIN RUN folds the two sides of
	 * the run together: a branch 45 degrees to one side and one 45 degrees to
	 * the other both read 45, and the two came out of the sort in an order
	 * that jumped across the fitting. The contour then zig-zagged through its
	 * own mouths instead of walking round them, which is what produced a
	 * self-intersecting boundary at a four-way cross.
	 */
	/*
	 * The bearing, bent away from the hub by a hair. Two arms exactly 90 or 180
	 * degrees apart give `atan2` ties whose sign depends on a signed zero (-0
	 * and 0 are DIFFERENT keys to a sort), so the order came out mirrored for
	 * two of the four arms. A point needs at most ~1e-9 of skew before the walk
	 * is unambiguous, which is far below anything a student can see, and it is
	 * applied UNIFORMLY - anti-clockwise - so it cannot reorder genuinely
	 * distinct arms.
	 */
	const bearing = (branch) => {
	const direction = unit(branch.direction);

	return direction ? Math.atan2(direction.y, direction.x) + 1e-9 : 0;
	};

	return [...branches].sort((left, right) => bearing(left) - bearing(right));
}

/* ============================================================
 * THE MAIN RUN
 * ============================================================ */

/*
 * THE DIRECTION THE BRANCH ANGLES ARE MEASURED FROM.
 *
 * It is stored, not inferred, so it does not drift when a branch grows longer or
 * a pipe is redrawn: the spec's "keep the reference stable during ordinary
 * edits" is this field and nothing else. The stored vector is normalised on read
 * so a saved document that carries an un-normalised one still measures correctly.
 */
export function mainDirectionOf(junction) {
	const stored = unit(junction?.geometry?.mainDirection);

	if (stored) {
		return stored;
	}

	/* A junction saved before the field existed falls back to its first branch. */
	const first = junction?.geometry?.branches?.[0];

	return first ? unit(first.direction) : { x: 1, y: 0 };
}

/* ============================================================
 * BRANCH WIDTHS
 * ============================================================ */

/*
 * THE BOUNDARY SEPARATION OF ONE BRANCH.
 *
 * Each branch takes the width of the run joined there, so the junction's mouth
 * matches the pipe it meets EXACTLY - which is what stops a step at the joint. A
 * free branch has no pipe to match and falls back to the junction's own default.
 */
export function branchSeparation(junction, branch) {
	if (Number(branch?.width) > 0) {
	return Number(branch.width);
	}

	const change = Number(junction?.engineering?.separation);

	if (Number.isFinite(change) && change !== 0) {
	const separation = enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION + change;

	if (separation > 0) {
	return separation;
	}
	}

	return enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION;
}

/* The default separation, for a junction with no connected pipe to take one from. */
export function defaultSeparation() {
	return enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION;
}

/* ============================================================
 * THE CONTOUR
 * ============================================================
 *
 * ONE closed path around the hub. The construction is:
 *
 *   1. each branch's mouth is a segment ACROSS its direction, half the branch's
 *      separation wide, centred where a pipe of that width would meet the hub;
 *   2. consecutive mouths, in angular order, are joined by a rounded corner
 *      whose radius grows with the wider of the two - so a wide branch flowing
 *      into a narrow one is a smooth taper rather than a step;
 *   3. the path closes back onto the first mouth.
 *
 * The result is a single polygon in world coordinates. The renderer, the source
 * writer and the selection box all read THIS one function, so the drawn contour,
 * the compiled contour and the highlighted extent cannot disagree.
 */
export function junctionOutline(junction, options = {}) {
	const branches = orderedBranches(junction);

	if (branches.length < 2) {
		return [];
	}

	const hub = junction?.geometry?.position;

	if (!finitePoint(hub)) {
		return [];
	}

	const cornerSteps = Number(options.cornerSteps) > 0 ? Number(options.cornerSteps) : 8;

	/*
	 * HOW FAR OUT EACH MOUTH IS PLACED ON THIS PASS.
	 *
	 * The normal case is that every mouth sits at its branch's PORT - the point
	 * a pipe snaps to - so the contour and the connected walls begin at exactly
	 * the same place. `options.ringScale` is the preview's chance to pull the
	 * whole contour in while the student is still dragging; it moves every arm
	 * TOGETHER, because a contour that reached one port and stopped short of
	 * another would not be one fitting.
	 */
	const ringScale = Number.isFinite(Number(options.ringScale))
	? Math.max(0.05, Math.min(1, Number(options.ringScale)))
	: 1;

	/* `branches` is already in the walk order: rising bearing round the hub. */
	const mouths = branches.map((branch) => {
	const direction = unit(branch.direction);

	if (!direction) {
	return null;
	}

	const half = branchSeparation(junction, branch) / 2;
	const centre = mouthCentre(junction, branch, ringScale);

	/*
	 * THE MOUTH'S TWO ENDS, IN THE WALK'S OWN DIRECTION.
	 *
	 * `left` is the end the walk REACHES as it goes anticlockwise, and `right`
	 * is the end it sets off from - the branch direction turned a quarter turn
	 * anticlockwise, and the same turned clockwise. A counter-clockwise walk of
	 * the hub then reads `right(0) -> left(0) -> shoulder -> right(1) -> ...`,
	 * which encloses the fitting. Choosing any of the four by how the arm
	 * happens to sit - whether it faces left or right of the hub - mirrored
	 * two of the arms and made the loop retrace itself.
	 */
	const leftward = { x: -direction.y, y: direction.x };

	return {
	branch,
		direction,
		half,
	centre,
	left: { x: centre.x + leftward.x * half, y: centre.y + leftward.y * half },
	right: { x: centre.x - leftward.x * half, y: centre.y - leftward.y * half }
	};
	});

	if (mouths.some((mouth) => !mouth)) {
		return [];
	}

	const outline = [];

	mouths.forEach((mouth, index) => {
		const next = mouths[(index + 1) % mouths.length];

				/*
			 * THE MOUTH, WALKED ACROSS THE ARM from `right` to `left`. It is where a
			 * connected pipe's walls meet the fitting, and it sits at the port the
			 * pipe snaps to, so there is neither a gap nor an overlap there.
			 */
			outline.push({ ...mouth.right }, { ...mouth.left });

				if (mouths.length === 2) {
			return;
			}

			/*
			 * THE FITTING'S SHOULDER, from this mouth's `left` round to the next
			 * mouth's `right` - the only stretch of the boundary that is not a mouth.
			 *
			 * A QUADRATIC BLEND whose control point is pushed OUT along the bisector
			 * of the two arms' directions.
			 *
			 * THE CONTROL OFFSET IS BOUNDED BY THE ROOM THE ARMS LEAVE. A corner that
			 * simply followed the wider arm's half-width bulged out into the space of
			 * the arms either side of it as soon as the widths differed - a wide
			 * branch beside a narrow one, or a wide one on each side of a four-way
			 * cross - and the two bulges crossed. The room between two consecutive
			 * mouths is the chord between them.
			 *
			 * MUTUALLY OPPOSED ARMS ARE JOINED BY A STRAIGHT EDGE. Two branches 180
			 * degrees apart are the two ends of ONE run running straight through the
			 * fitting - the main run of a tee, or either centreline of a cross - so
			 * their facing mouths are joined directly and nothing bulges between them.
			 */
			const from = mouth.left;
			const to = next.right;

			const opposed = Math.abs(mouth.direction.x * next.direction.x + mouth.direction.y * next.direction.y) > 1 - 1e-9;

			const chord = Math.hypot(to.x - from.x, to.y - from.y);

			const wanted = Math.max(mouth.half, next.half) * CONTOUR_CORNER_FACTOR;

			const radius = Math.min(wanted, chord * 0.5);

			if (opposed || !(radius > 1e-9) || !(chord > 1e-9)) {
			if (chord > 1e-9) {
			outline.push({ ...to });
			}

			return;
			}

				/* The mid-normal of the two arms, turned to face away from the hub. */
			const bisector = unit({
			x: mouth.direction.x + next.direction.x,
				y: mouth.direction.y + next.direction.y
			});

			const away = bisector
			? { x: -bisector.y, y: bisector.x }
			: { x: mouth.direction.x, y: mouth.direction.y };

			const towardsHub = { x: -mouth.centre.x, y: -mouth.centre.y };

			const outward = away.x * towardsHub.x + away.y * towardsHub.y > 0
			? { x: -away.x, y: -away.y }
			: away;

			const control = {
			x: (from.x + to.x) / 2 + outward.x * radius,
				y: (from.y + to.y) / 2 + outward.y * radius
			};

		for (let step = 1; step <= cornerSteps; step += 1) {
		const t = step / cornerSteps;

		outline.push({
		x: (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * control.x + t * t * to.x,
			y: (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * control.y + t * t * to.y
		});
		}
	});

	/*
	 * ONE WINDING, ALWAYS THE SAME WAY ROUND.
	 *
	 * A loop that ran the other way would still close, but a filled fitting
	 * would punch a hole in itself and a source path would be written with the
	 * opposite sense to the one the outline claims. The walk above is anti-
	 * clockwise by construction, so a negative signed area means a degenerate
	 * arm order rather than a second convention - and it is corrected HERE,
	 * once, so the canvas, the Ti*k*Z path and the bounds all describe the same
	 * loop.
	 */
	const area = outline.reduce((sum, point, index) => {
	const following = outline[(index + 1) % outline.length];

	return sum + (point.x * following.y - following.x * point.y);
	}, 0);

	return area >= 0 ? outline : outline.reverse();
}

/* ============================================================
 * THE STUB
 * ============================================================
 *
 * The distance from the hub to a branch's connection endpoint. It is DERIVED,
 * never stored as a length, so no edit can turn a junction into a pipe.
 */
export function stubLength(junction, branch) {
	const half = branchSeparation(junction, branch) / 2;

	return Math.max(MINIMUM_STUB_LENGTH, half * CONTOUR_CORNER_FACTOR);
}

/*
 * WHERE A BRANCH'S MOUTH SITS.
 *
 * It is the STUB END, not the hub: the port is where a pipe snaps to, and the
 * mouth of the contour is the same place - so a joined pipe meets the fitting at
 * the very point the snap indicator showed, and the drawn contour begins exactly
 * where the straight wall stops.
 */
function mouthCentre(junction, branch, ringScale = 1) {
	const port = branchPort(junction, branch);

	const hub = junction?.geometry?.position;

	if (!port || !finitePoint(hub)) {
	return hub;
	}

	if (!(ringScale < 1)) {
	return port;
	}

	return {
	x: hub.x + (port.x - hub.x) * ringScale,
		y: hub.y + (port.y - hub.y) * ringScale
	};
}

/*
 * WHERE A BRANCH'S MOUTH SITS ON THE CONTOUR.
 *
 * It is the STUB END, not the hub: the port is where a pipe snaps to, and the
 * mouth of the contour is the same place - so a joined pipe meets the fitting at
 * the very point the snap indicator showed, and the drawn contour begins exactly
 * where the straight wall stops.
 */
export function branchMouthCentre(junction, branch) {
	return mouthCentre(junction, branch);
}

/* The point a pipe snaps to, on one branch. */
export function branchPort(junction, branch) {
	const hub = junction?.geometry?.position;
	const direction = unit(branch?.direction);

	if (!finitePoint(hub) || !direction) {
		return null;
	}

	const length = stubLength(junction, branch);

	return {
		x: hub.x + direction.x * length,
		y: hub.y + direction.y * length
	};
}

/* Every branch's port, in stored order. */
export function branchPorts(junction) {
	return (junction?.geometry?.branches || []).map((branch) => ({
		id: branch.id,
		point: branchPort(junction, branch),
		direction: unit(branch.direction),
		connected: branch.connected || null
	}));
}

/* ============================================================
 * THE FACTORY
 * ============================================================ */

/*
 * BUILD A JUNCTION FROM A HUB AND A SET OF BRANCH DESCRIPTIONS.
 *
 * `branches` is `[{ direction, angle?, width?, connected? }]`. The MAIN branch is
 * the one flagged `main: true`, or the first; the rest take their angles from it.
 * Nothing here reads or creates pipes - the caller supplies the widths and the
 * connection ids, which is what keeps this a pure geometry factory.
 */
export function createJunction(options = {}) {
	const hub = options.position;

	if (!finitePoint(hub)) {
		return null;
	}

	const input = Array.isArray(options.branches) ? options.branches : [];

	if (input.length < MINIMUM_BRANCHES) {
		return null;
	}

	const directions = input.map((branch) => unit(branch.direction));

	if (directions.some((direction) => !direction)) {
		return null;
	}

	const mainIndex = Math.max(
		0,
		input.findIndex((branch) => branch.main === true)
	);

	const mainDirection = directions[mainIndex];

	/*
	 * THE ANGLE IS ALWAYS DERIVED FROM THE DIRECTIONS.
	 *
	 * The vector is the authority - it is what the contour, the ports and the
	 * canvas all use - so the displayed angle is computed from it rather than
	 * copied from the caller. A stored angle that disagreed with its vector would
	 * make the panel say one thing and the drawing show another.
	 */
	const branches = input.map((branch, index) => ({
		id: branch.id || BRANCH_LETTERS[index],
		direction: directions[index],
		angle: index === mainIndex ? 0 : branchAngleFrom(mainDirection, directions[index]),
		width: Number(branch.width) > 0 ? Number(branch.width) : undefined,
		connected: branch.connected || null,
		connectedPort: branch.connectedPort || null
	}));

	const geometry = {
		position: { x: hub.x, y: hub.y },
		mainDirection,
		mainBranchId: branches[mainIndex].id,
		branches
	};

	const engineering = {
		...(options.engineering || {}),
		generated: options.engineering?.generated === true,
		connections: branches.map((branch) => branch.connected || null)
	};

	return enggDrawingState.createGeometryObject("junction", geometry, {
		...options,
		engineering
	});
}

/* ============================================================
 * READING A JUNCTION
 * ============================================================ */

export function isJunctionType(type) {
	return type === "junction";
}

/* The connected pipe ids, in branch order, nulls removed. */
export function junctionConnections(junction) {
	return (junction?.geometry?.branches || [])
		.map((branch) => branch.connected)
		.filter(Boolean);
}

/* How many branches have a pipe joined to them. */
export function connectedBranchCount(junction) {
	return junctionConnections(junction).length;
}

/* The branch whose port a point is on, or null. */
export function branchAtPoint(junction, point, tolerance = 1e-6) {
	if (!finitePoint(point)) {
		return null;
	}

	let best = null;

	(junction?.geometry?.branches || []).forEach((branch) => {
		const port = branchPort(junction, branch);

		if (!port) {
			return;
		}

		const distance = Math.hypot(port.x - point.x, port.y - point.y);

		if (distance <= tolerance && (!best || distance < best.distance)) {
			best = { branch, distance };
		}
	});

	return best ? best.branch : null;
}

/* The branch with this id, or null. */
export function branchById(junction, branchId) {
	return (junction?.geometry?.branches || []).find((branch) => branch.id === branchId) || null;
}

/*
 * REMOVE A FREE BRANCH.
 *
 * A connected branch cannot be removed this way - a pipe is joined to it, and
 * taking the arm away would leave the pipe attached to nothing. Detaching the
 * pipe first is the student's connection decision (`disconnectBranch`), and only
 * then can the arm go.
 */
export function removeFreeBranch(junction, branchId) {
	const branch = branchById(junction, branchId);

	if (!branch || branch.connected) {
	return false;
	}

	const branches = (junction.geometry?.branches || []).filter((candidate) => candidate.id !== branchId);

	if (branches.length < 2) {
	return false;
	}

	junction.geometry = {
	...junction.geometry,
	branches,
	...(junction.geometry.mainBranchId === branchId && branches[0]
	? { mainBranchId: branches[0].id, mainDirection: branches[0].direction }
	: {})
	};

	return true;
}

/*
 * DROP A CONNECTION FROM ONE BRANCH, leaving the arm where it is.
 *
 * The branch stays a FREE stub at the direction the pipe left it at, which is
 * the honest drawing: the fitting still has an arm there, and the pipe no
 * longer joins it. The pipe itself is untouched.
 */
export function disconnectBranch(junction, branchId) {
	const branch = branchById(junction, branchId);

	if (!branch) {
	return false;
	}

	junction.geometry = {
	...junction.geometry,
	branches: junction.geometry.branches.map((candidate) =>
	candidate.id === branch.id
	? { ...candidate, connected: null, connectedPort: null }
	: candidate
	)
	};

	return true;
}

/* ============================================================
 * THE MAIN RUN, AND WHICH BRANCHES THE MAIN RUN OCCUPIES
 * ============================================================
 *
 * The main run is TWO OPPOSED BRANCHES - one out each way along the same line -
 * not one arm and not an arbitrary arm plus its neighbour. The main branch is the
 * one the main direction points along; its PARTNER is the branch most nearly
 * opposed to it, and together they are the run the branch angles are measured
 * from.
 *
 * Every other branch is a SECONDARY branch, and only a secondary branch has an
 * editable angle. Exposing a field for the partner would be a second control for
 * a direction the main run already fixes, which the specification forbids.
 */
export function mainBranchOf(junction) {
	const branches = junction?.geometry?.branches || [];

	const named = branchById(junction, junction?.geometry?.mainBranchId);

	if (named) {
	return named;
	}

	return branches[0] || null;
}

/* The branch most nearly OPPOSED to the main branch - the main run's other end. */
export function mainPartnerOf(junction) {
	const main = mainBranchOf(junction);

	if (!main) {
	return null;
	}

	const direction = unit(main.direction);

	if (!direction) {
	return null;
	}

	let best = null;

	(junction?.geometry?.branches || []).forEach((branch) => {
	if (branch.id === main.id) {
	return;
	}

	const other = unit(branch.direction);

	if (!other) {
	return;
	}

	/* The dot product with the REVERSED main direction: 1 is exactly opposed. */
	const opposed = -(direction.x * other.x + direction.y * other.y);

	if (!best || opposed > best.opposed) {
	best = { branch, opposed };
	}
	});

	return best ? best.branch : null;
}

/*
 * THE SECONDARY BRANCHES - every arm that is not part of the main run, in the
 * order they are stored so their panel rows never reshuffle.
 */
export function secondaryBranches(junction) {
	const main = mainBranchOf(junction);
	const partner = mainPartnerOf(junction);

	return (junction?.geometry?.branches || []).filter(
	(branch) => !main || (branch.id !== main.id && branch.id !== partner?.id)
	);
}

/* Whether a branch is part of the main run, and so has no editable angle. */
export function isMainRunBranch(junction, branchId) {
	const main = mainBranchOf(junction);
	const partner = mainPartnerOf(junction);

	return Boolean(main) && (branchId === main.id || branchId === partner?.id);
}

/*
 * THE ANGLE A SECONDARY BRANCH LEAVES AT, in 0..180 degrees from the main run.
 *
 * It is an ABSOLUTE resulting angle, not a change, and it is read from the
 * branch's own direction - so a typed value and a dragged arm describe the same
 * number, and there is only ever one place it lives.
 */
export function secondaryBranchAngle(junction, branchId) {
	const branch = branchById(junction, branchId);

	if (!branch || isMainRunBranch(junction, branchId)) {
	return null;
	}

	return branchAngleFrom(mainDirectionOf(junction), branch.direction);
}

/*
 * WHICH SIDE OF THE MAIN RUN A BRANCH IS ON, as a sign.
 *
 * `setBranchAngle` keeps a branch on the side it already occupies, so typing 90
 * on a branch that leaves to the left keeps it to the left. That side is the
 * sign of the signed (non-folded) angle from the main direction.
 */
export function branchSide(junction, branchId) {
	const branch = branchById(junction, branchId);

	if (!branch) {
	return 1;
	}

	const signed = signedAngleBetween(mainDirectionOf(junction), branch.direction);

	return signed !== null && signed > 180 ? -1 : 1;
}

/*
 * WHERE A SECONDARY BRANCH'S ANGLE GRIP SITS.
 *
 * The handle is placed ON THE ARM - part way out along the stub, at the same
 * angle the panel field shows - so dragging it turns that branch and nothing
 * else. It is a DIRECTION grip: the distance from the hub is fixed, which is what
 * keeps a junction's arms stubs rather than lengths.
 */
export function branchAngleHandlePoint(junction, branchId) {
	const branch = branchById(junction, branchId);

	if (!branch || isMainRunBranch(junction, branchId)) {
	return null;
	}

	return branchPort(junction, branch);
}

/* The angle a branch is at when the student drags it TO a point. */
export function angleFromPointer(junction, point, { snap = true } = {}) {
	const hub = junction?.geometry?.position;

	const direction = directionOf(hub, point);

	if (!direction) {
	return null;
	}

	const degrees = branchAngleFrom(mainDirectionOf(junction), direction);

	return snap ? snapBranchAngle(degrees) : degrees;
}

/* ============================================================
 * EDITING A BRANCH'S ANGLE
 * ============================================================ */

/*
 * POINT ONE BRANCH IN A NEW ABSOLUTE DIRECTION, relative to the main run.
 *
 * `degrees` is 0..180 measured OFF THE MAIN DIRECTION LINE, and the branch stays
 * on the SIDE it is already on - so typing "90" on a north branch keeps it north
 * and typing "90" on a south branch keeps it south. A branch that is still free to
 * move sideways because it has never been placed is treated as counter-clockwise
 * from the main direction, which is where the default third branch sits.
 *
 * The other branches do NOT move: a junction is a set of independent directions,
 * and turning one branch is not a rotation of the fitting. The contour is derived,
 * so it follows automatically.
 *
 * A direction that would land on top of another branch is REFUSED - two branches
 * in one direction is not a junction, it is one branch drawn twice, and the
 * contour would self-intersect. The caller keeps its last valid geometry.
 */
export function setBranchAngle(junction, branchId, degrees) {
	const branch = branchById(junction, branchId);

	if (!branch) {
		return false;
	}

	const value = Number(degrees);

	if (!Number.isFinite(value)) {
		return false;
	}

	const main = mainDirectionOf(junction);

	/* The side the branch is already on decides which way the angle turns. */
	const current = signedAngleBetween(main, branch.direction);

	const sign = current !== null && current > 180 ? -1 : 1;

	const direction = directionAtAngle(main, sign * Math.abs(value));

	if (!direction) {
		return false;
	}

	const collision = (junction.geometry?.branches || []).some((other) => {
		if (other.id === branch.id) {
			return false;
		}

		const otherDirection = unit(other.direction);

		if (!otherDirection) {
			return false;
		}

		return Math.abs(otherDirection.x * direction.x + otherDirection.y * direction.y) > 0.999;
	});

	if (collision) {
		return false;
	}

	junction.geometry = {
		...junction.geometry,
		branches: junction.geometry.branches.map((candidate) =>
			candidate.id === branch.id
				? {
						...candidate,
						direction,
						angle: branchAngleFrom(main, direction)
					}
				: candidate
		)
	};

	return true;
}

/*
 * ADD A BRANCH at an absolute angle from the main run.
 *
 * Used when a pipe is joined to a free stub AND when the student draws a further
 * branch: either way the junction gains one arm, and it stays ONE object.
 */
export function addBranch(junction, options = {}) {
	const main = mainDirectionOf(junction);

	const angle = Number.isFinite(Number(options.angle)) ? Number(options.angle) : DEFAULT_BRANCH_ANGLE;

	const direction = unit(options.direction) || directionAtAngle(main, angle);

	if (!direction) {
		return null;
	}

	const duplicate = (junction.geometry?.branches || []).some((branch) => {
		const existing = unit(branch.direction);

		return existing && existing.x * direction.x + existing.y * direction.y > 0.999;
	});

	if (duplicate) {
		return null;
	}

	const branch = {
		id: options.id || nextBranchId(junction.geometry.branches),
		direction,
		angle: branchAngleFrom(main, direction),
		width: Number(options.width) > 0 ? Number(options.width) : undefined,
		connected: options.connected || null,
		connectedPort: options.connectedPort || null
	};

	junction.geometry = {
		...junction.geometry,
		branches: [...(junction.geometry.branches || []), branch]
	};

	return branch;
}

/* Remove one branch. Refuses to take a junction below two arms. */
export function removeBranch(junction, branchId) {
	const branches = junction?.geometry?.branches || [];

	if (branches.length <= 2) {
		return false;
	}

	const next = branches.filter((branch) => branch.id !== branchId);

	if (next.length === branches.length) {
		return false;
	}

	junction.geometry = {
		...junction.geometry,
		branches: next,
		...(junction.geometry.mainBranchId === branchId && next[0]
			? {
					mainBranchId: next[0].id,
					mainDirection: next[0].direction
				}
			: {})
	};

	return true;
}

/*
 * JOIN A PIPE TO A BRANCH, or point an existing free branch at it.
 *
 * `branchId` names the arm; the pipe's outward direction becomes that arm's
 * direction when the arm is free, so a junction snapped onto a pipe END adopts
 * the pipe's own direction rather than keeping a stale one.
 */
export function connectBranch(junction, branchId, options = {}) {
	const branch = branchById(junction, branchId);

	if (!branch) {
		return false;
	}

	const direction = unit(options.direction);
	const width = Number(options.width) > 0 ? Number(options.width) : branch.width;

	junction.geometry = {
		...junction.geometry,
		branches: junction.geometry.branches.map((candidate) =>
			candidate.id === branch.id
				? {
						...candidate,
						direction: direction || candidate.direction,
						angle: direction
							? branchAngleFrom(mainDirectionOf(junction), direction)
							: candidate.angle,
						width: width > 0 ? width : undefined,
						connected: options.connected || null,
						connectedPort: options.connected ? options.connectedPort || null : null
					}
				: candidate
		)
	};

	return true;
}

/* ============================================================
 * THE CONTOUR'S EXTENT
 * ============================================================ */

/* Every point the junction's ink occupies, for a selection box or a fit. */
export function junctionExtent(junction) {
	const outline = junctionOutline(junction);
	const ports = branchPorts(junction).map((port) => port.point).filter(Boolean);

	return [...outline, ...ports];
}

/* Whether a point is on the junction - its contour or one of its stubs. */
export function junctionContainsPoint(junction, point, tolerance = 1e-6) {
	const hub = junction?.geometry?.position;

	if (!finitePoint(point) || !finitePoint(hub)) {
		return false;
	}

	return (junction.geometry?.branches || []).some((branch) => {
		const direction = unit(branch.direction);

		if (!direction) {
			return false;
		}

		const length = stubLength(junction, branch);

		/* Distance to the hub-to-port segment. */
		const toPoint = { x: point.x - hub.x, y: point.y - hub.y };
		const along = toPoint.x * direction.x + toPoint.y * direction.y;

		const clamped = Math.max(0, Math.min(length, along));

		const nearest = {
			x: hub.x + direction.x * clamped,
			y: hub.y + direction.y * clamped
		};

		return Math.hypot(point.x - nearest.x, point.y - nearest.y) <= tolerance;
	});
}

const enggJunction = {
	MINIMUM_BRANCHES,
	DEFAULT_BRANCH_COUNT,
	DEFAULT_BRANCH_ANGLE,
	MINIMUM_STUB_LENGTH,
	CONTOUR_CORNER_FACTOR,
	COMMON_BRANCH_ANGLES,
	BRANCH_ANGLE_SNAP_TOLERANCE,

	directionOf,
	signedAngleBetween,
	branchAngleFrom,
	directionAtAngle,
	snapBranchAngle,

	nextBranchId,
	branchOrdinal,
	orderedBranches,
	mainDirectionOf,
	branchSeparation,

	junctionOutline,
	stubLength,
	branchPort,
	branchPorts,
	branchMouthCentre,

	createJunction,
	isJunctionType,
	junctionConnections,
	connectedBranchCount,
	branchAtPoint,
	branchById,

	mainBranchOf,
	mainPartnerOf,
	secondaryBranches,
	isMainRunBranch,
	secondaryBranchAngle,
	branchSide,
	branchAngleHandlePoint,
	angleFromPointer,
	disconnectBranch,
	removeFreeBranch,

	setBranchAngle,
	addBranch,
	removeBranch,
	connectBranch,

	junctionExtent,
	junctionContainsPoint
};

export default enggJunction;
