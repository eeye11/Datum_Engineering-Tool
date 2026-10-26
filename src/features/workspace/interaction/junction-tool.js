/*
 * ========================================================
 * THE JUNCTION TOOL: CREATION, SPLITTING AND LIFECYCLE
 * ========================================================
 *
 * This module owns everything a Junction does that is not pure geometry: where
 * one is created, which pipes join it, what happens to a host pipe that is
 * split, and what becomes of the fitting when its branches change.
 *
 * ========================================================
 * THE SAME GESTURE AS PIPE / DUCT AND ELBOW
 * ========================================================
 *
 * A junction is placed by press-drag-release. The gesture is the SAME session
 * shape the other two Fluids tools use (`creation-drag.js`), and it means what it
 * means for them: the press is the hub and the drag is the MAIN-RUN DIRECTION.
 *
 * THE DRAG DISTANCE IS NOT A LENGTH. It sets the main-run direction and nothing
 * else - there is no branch length, no pipe length, and no numeric side effect.
 * A junction's arms are STUBS (see `junction.js`): their length is derived from
 * the widths they carry, never dragged.
 *
 * ========================================================
 * CONNECTIONS ARE EXPLICIT, LIKE THE ELBOW'S
 * ========================================================
 *
 * Every branch records the pipe joined to it (`branch.connected`). The junction's
 * `engineering.connections` is that same list, so the removal-by-parent rule, the
 * Objects list and the future assembly work read ONE record rather than three.
 *
 * A junction with no branch connected is a valid STANDALONE fitting: its stubs
 * publish snap targets, and pipes drawn from them connect to it like any other.
 *
 * ========================================================
 * SPLITTING A HOST PIPE
 * ========================================================
 *
 * When a pipe's endpoint lands on the INTERIOR of another run, the host is split
 * at that point and the junction joins the two halves and the incoming branch.
 *
 * IDENTITY IS DECIDED BY GEOMETRY, NOT BY ARRAY ORDER. The half that contains the
 * host's ORIGINAL START endpoint keeps the host's id and name; the other half is a
 * new object with the next free Pipe / Duct name. Both take the host's appearance
 * and Pipe Width, so the drawing looks the same either side of the cut.
 *
 * THE SPLIT IS TRANSACTIONAL. The caller snapshots the drawing first; nothing here
 * can leave a half-split host behind, because the whole operation is committed as
 * one undoable change.
 */
import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggPipeDuct from "../model/fluids/pipe-duct.js";
import enggJunction from "../model/fluids/junction.js";
import { reconcilePipeAssemblies } from "../model/fluids/pipe-assembly.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { drawingState } from "../editor-state.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";

/*
 * THE ELBOW BUILDER, KEPT WHERE BOTH MODULES CAN SEE IT.
 *
 * `pipe-duct-tool.js` and this module import each other, so a plain module
 * binding is not reliable across every entry point: a registration can run
 * while this module is only half-evaluated. The slot lives on the GLOBAL
 * object, which exists before either module is evaluated.
 */
export function setJunctionElbowBuilder(builder) {
	if (typeof builder === "function") {
		globalThis.__datumJunctionElbowBuilder = builder;
	}
}

function builderOf() {
	const published = globalThis.__datumJunctionElbowBuilder;

	return typeof published === "function" ? published : null;
}

/* The interaction phase a junction under construction uses. */
export const JUNCTION_PHASE = "junction-construct";

/*
 * How close a press must be to a run's INTERIOR before it is read as a
 * connection to that run. This is a DRAWING tolerance in world units, tightened
 * by the camera when it is used from the pointer (see `runInteriorAt`).
 */
export const INTERIOR_CONNECTION_TOLERANCE = 2.5;

/* The tolerance for "this point is an endpoint", shared with the other fittings. */
export const ENDPOINT_TOLERANCE = 1e-6;

/* ============================================================
 * READING THE DRAWING
 * ============================================================ */

function pipesIn(objects = drawingState.objects) {
	return (objects || []).filter((object) => enggPipeDuct.isPipeDuctType(object.type));
}

function junctionsIn(objects = drawingState.objects) {
	return (objects || []).filter((object) => enggJunction.isJunctionType(object.type));
}

/*
 * THE PIPE ENDPOINT AT A POINT, if any.
 *
 * Endpoints are the ONLY high-priority connection targets a run publishes, so a
 * junction snapped onto one adopts that pipe's direction and width.
 */
export function pipeEndpointAt(point, objects = drawingState.objects) {
	if (!point) {
		return null;
	}

	let best = null;

	pipesIn(objects).forEach((run) => {
		enggPipeDuct.portsOf(run).forEach((port) => {
			const distance = Math.hypot(port.point.x - point.x, port.point.y - point.y);

			if (distance > ENDPOINT_TOLERANCE) {
				return;
			}

			if (!best || distance < best.distance) {
				best = { run, port: port.id, point: { ...port.point }, distance };
			}
		});
	});

	return best;
}

/*
 * THE RUN WHOSE INTERIOR A POINT IS ON, if any.
 *
 * This is what makes an endpoint-to-MIDDLE connection possible. The point must be
 * strictly BETWEEN the two ends - a point on an end is an endpoint connection,
 * handled above - and within `tolerance` of the centreline.
 *
 * A point that is on TWO runs at once (a crossing) is deliberately NOT resolved
 * here: the nearest is taken, and the caller decides. Automatic junctions are
 * never formed from two interiors meeting - see `createJunctionAtConnections`.
 */
export function runInteriorAt(
	point,
	objects = drawingState.objects,
	tolerance = INTERIOR_CONNECTION_TOLERANCE,
	options = {}
) {
	if (!point) {
	return null;
	}

	const excludeId = options.exclude || null;

	let best = null;

	pipesIn(objects).forEach((run) => {
	const start = run.geometry?.start;
	const end = run.geometry?.end;

	if (!start || !end) {
	return;
	}

		if (run.id === excludeId) {
	return;
	}

	/*
	 * A RUN THIS ONE IS ALREADY JOINED TO IS NOT A BRANCH. Its endpoint runs
	 * THROUGH that joint; meeting the neighbour's interior there is the joint
	 * itself, not a second connection, and splitting it would break the
	 * connection the fitting already records.
	 */
	if (excludeId && runsAreConnected(excludeId, run.id, objects)) {
	return;
	}

	const direction = enggJunction.directionOf(start, end);

		if (!direction) {
			return;
		}

		/*
		 * THE RUN'S CENTRELINE IS ITS SPAN LINE, NOT ITS TWO STORED POINTS.
		 *
		 * A run that sits on a fitting has been CUT BACK at that end - its stored
		 * point is the bend's tangent, a trim short of the corner - so the stored
		 * pair is a shorter line than the pipe the student drew. Projecting onto it
		 * puts the split a trim off, and the half the fitting holds would be
		 * shorter than the pipe it belongs to. `runSpan` is the line the run was
		 * drawn along and survives being seated (see `pipe-duct.js`), so the
		 * projection lands on the real centreline.
		 */
		const line = enggPipeDuct.runSpan(run) || { start, end };

		const dx = line.end.x - line.start.x;
		const dy = line.end.y - line.start.y;

		const lengthSquared = dx * dx + dy * dy;

		if (lengthSquared < 1e-12) {
			return;
		}

		const t = ((point.x - line.start.x) * dx + (point.y - line.start.y) * dy) / lengthSquared;

		/* Strictly interior: an end is an ENDPOINT connection, not a cut. */
		if (t <= 1e-6 || t >= 1 - 1e-6) {
			return;
		}

		const foot = { x: line.start.x + dx * t, y: line.start.y + dy * t };
		const distance = Math.hypot(point.x - foot.x, point.y - foot.y);

		if (distance > tolerance) {
			return;
		}

		if (!best || distance < best.distance) {
			best = {
				run,
				point: foot,
				distance,
				t,
				direction: enggJunction.directionOf(start, end)
			};
		}
	});

	return best;
}

/*
 * THE DIRECTION A RUN'S NAMED PORT POINTS, along the run.
 *
 * This matches Pipe / Duct's own `pipeOutwardDirection`, so an arm and an elbow
 * arm mean the same thing by "the pipe's direction". The JUNCTION's branch vector
 * points the other way - out from the hub toward the pipe - so callers negate it;
 * see `directionTowardPipe`.
 */
export function portDirection(run, port) {
	const start = run?.geometry?.start;
	const end = run?.geometry?.end;

	if (!start || !end) {
		return null;
	}

	return port === "end"
		? enggJunction.directionOf(start, end)
		: enggJunction.directionOf(end, start);
}

/*
 * THE BRANCH DIRECTION THAT RUNS OUT TO A PIPE JOINED AT ONE OF ITS ENDS.
 *
 * A branch vector points AWAY from the hub, toward the pipe. A pipe ending at
 * `end` extends back toward the hub, so the arm points along `-outward`. This is
 * the single conversion between the two conventions, stated once.
 */
export function directionTowardPipe(run, port) {
	const outward = portDirection(run, port);

	return outward ? { x: -outward.x, y: -outward.y } : null;
}

/* The separation a run draws its walls at. */
export function widthOf(run) {
	return enggPipeDuct.boundarySeparation(run?.engineering || {});
}

/* ============================================================
 * THE DEFAULT BRANCH SET
 * ============================================================ */

/*
 * A JUNCTION DRAWN IN EMPTY SPACE.
 *
 * The MAIN arm **is** the direction of the drag - so "drag east" gives a main run
 * east, and every angle in the panel is measured from exactly that arrow. The arm
 * facing back along the run is its opposed partner, so the fitting can be joined
 * on either side of the run without being rebuilt.
 *
 * The third branch leaves at 90 degrees, which is the specification's default for
 * a free third branch. `d` is its OPPOSED partner, present from creation so the
 * contour is a symmetric cross rather than an asymmetric tee that grows a fourth
 * arm later - and so a pipe drawn from `c`'s stub can join on either face.
 */
export function defaultBranchSet(mainDirection, branchAngle = enggJunction.DEFAULT_BRANCH_ANGLE) {
	const main = mainDirection || { x: 1, y: 0 };

	const branch = enggJunction.directionAtAngle(main, branchAngle);

	return [
		{ id: "a", direction: { x: main.x, y: main.y }, main: true, angle: 0 },
		{ id: "b", direction: { x: -main.x, y: -main.y }, angle: 180 },
		{ id: "c", direction: branch, angle: branchAngle },
		{ id: "d", direction: { x: -branch.x, y: -branch.y }, angle: branchAngle + 180 }
	];
}

/* ============================================================
 * MANUAL CREATION
 * ============================================================ */

/* Arm the tool. Like the other two Fluids tools it begins nothing until a press. */
export function beginJunctionConstruction() {
	enggDrawingState.setActiveTool(drawingState, "junction");

	enggDrawingState.setInteraction(drawingState, {
		fluidsTool: "junction",
		phase: "idle"
	});

	setToolMessage("Press and drag to place a Junction - the drag sets the main run");

	renderProperties();
	renderCurrentDrawing();
}

/* What the gesture would produce, for the live preview. */
export function junctionGesturePreview(interaction, cursorPoint) {
	const hub = interaction?.junctionStart;
	const main = interaction?.junctionMainDirection;

	if (!hub || !main || !cursorPoint) {
		return null;
	}

	const branches = defaultBranchSet(main);

	return {
		position: { x: hub.x, y: hub.y },
		mainDirection: main,
		branches: branches.map((branch) => ({
			...branch,
			width:
				enggJunction.branchSeparation(
					{ engineering: interaction.junctionEngineering || {} },
					branch
				) || undefined
		}))
	};
}

/*
 * COMMIT THE GESTURE.
 *
 * The hub is where the student pressed; the main run is the direction they
 * dragged. Any pipe ENDPOINT under the hub is joined to the main run's matching
 * arm, and any run INTERIOR under the hub is split - so placing a junction on a
 * pipe is the endpoint-to-middle flow, performed by the junction tool itself.
 *
 * Nothing about the DRAG DISTANCE is stored.
 */
export function commitJunctionGesture(hub, direction, interaction = {}) {
	if (!hub) {
		return null;
	}

	/*
	 * THE MAIN RUN IS THE DRAG'S DIRECTION, AND THE DRAG'S DISTANCE IS IGNORED.
	 * A zero-length drag is still a valid placement - a press with no travel means
	 * "main run to the right", the same default a fresh tool opens with - so the
	 * student is never left with a gesture that silently created nothing.
	 */
	const main = enggJunction.directionOf(hub, direction) || { x: 1, y: 0 };

	const previousObjects = enggDrawingState.snapshotDrawing(drawingState);

	const style = { ...(interaction.junctionStyle || drawingState.styleDefaults || {}) };

	const junction = enggJunction.createJunction({
		position: hub,
		branches: defaultBranchSet(main),
		style,
		engineering: {
			generated: false,
			...interaction.junctionEngineering
		}
	});

	if (!junction) {
		return null;
	}

	const attached = attachJunctionToDrawing(junction, { hub, main });

	/*
	 * NULL MEANS THE PLACEMENT WAS INVALID; 0 MEANS NOTHING WAS UNDER THE HUB.
	 * A standalone junction is a valid object - it is exactly what the student
	 * gets when they place one in empty space and draw pipes up to it later - so a
	 * zero is committed, not refused.
	 */
	if (attached === null) {
		return null;
	}

	enggDrawingState.addObject(drawingState, junction);

	applyJunctionConnections(junction, drawingState.objects);

	enggDrawingState.commitDrawingChange(drawingState, previousObjects);

	const committed = drawingState.objects.find((object) => object.id === junction.id) || junction;

	applyJunctionConnections(committed, drawingState.objects);

	setToolMessage(`${committed.name} created`);

	renderProperties();
	renderCurrentDrawing();

	return { junction: committed, attached };
}

/*
 * FIND WHAT THE HUB IS ON AND JOIN THE JUNCTION TO IT.
 *
 * Two cases, in priority order:
 *
 *   AN ENDPOINT under the hub   the pipe joins the main arm facing it, and its
 *                               own inward direction is the junction's main run
 *   AN INTERIOR under the hub   the host is SPLIT here and joins BOTH main arms
 *
 * Returns the number of pipes attached, or null when the junction could not be
 * placed validly (which the caller reports rather than committing).
 */
function attachJunctionToDrawing(junction, { hub, main }) {
	const endpoint = pipeEndpointAt(hub);

	if (endpoint) {
		enggJunction.connectBranch(junction, "b", {
			direction: directionTowardPipe(endpoint.run, endpoint.port) || main,
			width: widthOf(endpoint.run),
			connected: endpoint.run.id
		});

		/* The pipe's axis is the main run, so the angles are measured from it. */
		const axis = portDirection(endpoint.run, endpoint.port);

		if (axis) {
			junction.geometry = {
				...junction.geometry,
				mainDirection: axis,
				branches: junction.geometry.branches.map((branch) => {
					const direction =
						branch.id === "a"
							? { x: -axis.x, y: -axis.y }
							: branch.id === "b"
								? axis
								: branch.id === "c"
									? enggJunction.directionAtAngle(axis, enggJunction.DEFAULT_BRANCH_ANGLE)
									: enggJunction.directionAtAngle(axis, enggJunction.DEFAULT_BRANCH_ANGLE + 180);

					return { ...branch, direction, angle: enggJunction.branchAngleFrom(axis, direction) };
				})
			};
		}

		return 1;
	}

	const interior = runInteriorAt(hub);

	if (!interior) {
		return 0;
	}

	const split = splitHostPipeAt(interior, { hub });

	if (!split) {
		return null;
	}

	/*
	 * THE HOST'S AXIS IS THE MAIN RUN. Its two halves join the two main arms,
	 * each with its own outward direction, so the run reads as one straight line
	 * through the fitting.
	 */
	const axis = interior.direction;

	junction.geometry = {
		...junction.geometry,
		mainDirection: axis,
		branches: junction.geometry.branches.map((branch) => {
			const direction =
				branch.id === "a"
					? { x: -axis.x, y: -axis.y }
					: branch.id === "b"
						? axis
						: branch.id === "c"
							? enggJunction.directionAtAngle(axis, enggJunction.DEFAULT_BRANCH_ANGLE)
							: enggJunction.directionAtAngle(axis, enggJunction.DEFAULT_BRANCH_ANGLE + 180);

			return { ...branch, direction, angle: enggJunction.branchAngleFrom(axis, direction) };
		})
	};

	enggJunction.connectBranch(junction, "a", {
		direction: { x: -axis.x, y: -axis.y },
		width: widthOf(split.first),
		connected: split.first.id
	});

	enggJunction.connectBranch(junction, "b", {
		direction: axis,
		width: widthOf(split.second),
		connected: split.second.id
	});

	/*
	 * THE INCOMING SIDE KEEPS ITS WIDTH on the branch that faces it. The junction
	 * was drawn from the hub, so the branch the student was drawing comes in from
	 * whichever side their drag came from - and it is already `c`.
	 */
	return 2;
}

/* ============================================================
 * SPLITTING A HOST PIPE
 * ============================================================ */

/*
 * A NEW STABLE ID for a split half.
 *
 * The drawing state mints ids on `addObject`, but the second half must exist as
 * an object (with its own id) BEFORE the list is rewritten, so it is named here.
 * The shape of the id matches the model's own: `<type>-<uuid>`.
 */
function newObjectId(type) {
	const generated =
		globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
			? globalThis.crypto.randomUUID()
			: `${Date.now()}-${Math.random().toString(16).slice(2)}`;

	return `${type}-${generated}`;
}

/*
 * CUT ONE RUN AT A POINT IN ITS INTERIOR.
 *
 * THE HALF CONTAINING THE HOST'S ORIGINAL START KEEPS THE HOST'S IDENTITY. That is
 * decided from the host's START-TO-END geometry, so a redraw, a re-parse or a
 * different array order can never swap which half is "the original pipe".
 *
 * Both halves are independent Pipe / Duct objects afterwards: editable, movable,
 * deletable. They START as copies of the host's appearance and width, which is
 * what keeps the drawing identical either side of the cut, and nothing afterwards
 * keeps them in step.
 *
 * The host object is NOT mutated in place: it is removed and the two halves are
 * added, so the Objects list, the source and the undo entry all see one coherent
 * change. `enggDrawingState.commitDrawingChange` is the caller's.
 */
export function splitHostPipeAt(interior, options = {}) {
	const host = interior?.run;
	const cut = interior?.point;

	if (!host || !cut || !host.geometry?.start || !host.geometry?.end) {
		return null;
	}

	const start = host.geometry.start;
	const end = host.geometry.end;

	const startDistance = Math.hypot(cut.x - start.x, cut.y - start.y);
	const endDistance = Math.hypot(cut.x - end.x, cut.y - end.y);

	/* A cut at (or past) an end is not a split. */
	if (startDistance < 1e-6 || endDistance < 1e-6) {
		return null;
	}

	const style = { ...(host.style || {}) };
	const engineering = { ...(host.engineering || {}) };

	/*
	 * THE ORIGINAL keeps the host's identity because it is the half from the
	 * host's ORIGINAL START. The other is new, and takes the next free
	 * Pipe / Duct name - the drawing state's own numbering does that on add.
	 */
	const first = {
		...host,
		id: host.id,
		name: host.name,
		geometry: {
			...host.geometry,
			start: { x: start.x, y: start.y },
			end: { x: cut.x, y: cut.y }
		},
		style: { ...style },
		engineering: { ...engineering }
	};

	const second = {
		...host,
		id: newObjectId("pipe-duct"),
		name: "Pipe / Duct",
		geometry: {
			...host.geometry,
			start: { x: cut.x, y: cut.y },
			end: { x: end.x, y: end.y }
		},
		style: { ...style },
		engineering: { ...engineering }
	};

	/* A split half carries no fitting trim of its own; the junction owns the join. */
	delete first.geometry.trims;
	delete second.geometry.trims;

	first.geometry = { ...first.geometry };
	second.geometry = { ...second.geometry };

	void options;

	return { first, second, cut: { x: cut.x, y: cut.y }, hostId: host.id };
}

/*
 * REPLACE A HOST WITH ITS TWO HALVES, IN PLACE, preserving array order as far as
 * possible so the Objects list does not reshuffle.
 */
export function replaceHostWithHalves(host, split, objects = drawingState.objects) {
	const index = (objects || []).findIndex((object) => object.id === host.id);

	if (index < 0) {
		return false;
	}

	objects.splice(index, 1, split.first, split.second);

	return true;
}

/* ============================================================
 * APPLYING A JUNCTION'S CONNECTIONS
 * ============================================================ */

/*
 * PUSH THE JUNCTION'S OWN DECISIONS BACK ONTO ITS PIPES.
 *
 * Each joined pipe has its END SNAPPED ONTO THE BRANCH PORT, so the wall meets the
 * fitting exactly where the contour's mouth is. This is the junction's equivalent
 * of the elbow's `applyManualElbowConnections`, and it is idempotent, so it can be
 * run after every edit without accumulating anything.
 *
 * It NEVER changes a pipe's width or appearance. The branch takes the PIPE's
 * width, not the other way round - which is the rule that keeps a junction from
 * restyling or resizing the pipework it joins.
 */
export function applyJunctionConnections(junction, objects = drawingState.objects) {
	if (!junction || !enggJunction.isJunctionType(junction.type)) {
		return false;
	}

	(junction.geometry?.branches || []).forEach((branch) => {
		const run = branch.connected
			? (objects || []).find((object) => object.id === branch.connected)
			: null;

		if (!run || !enggPipeDuct.isPipeDuctType(run.type)) {
			if (branch.connected) {
				/* The run is gone: the branch is free again. */
				branch.connected = null;
			}

			return;
		}

				branch.width = widthOf(run);

			const port = enggJunction.branchPort(junction, branch);

			if (!port) {
			return;
			}

		/* The pipe's end that is nearest the port is the end held there. */
		const start = run.geometry?.start;
		const end = run.geometry?.end;

		if (!start || !end) {
			return;
		}

		/*
		 * THE PIPE END THAT ACTUALLY TOUCHED THE HOST IS THE ONE HELD THERE.
		 *
		 * It is chosen by the pipe's ORIGINAL endpoint on the host - recorded by the
		 * caller as `connectedPort` - and only falls back to "the nearer end" when
		 * the pipe was re-pointed by something else. Choosing by distance alone
		 * could pick the FAR end when both are within the stub length, which would
		 * flip a short branch pipe inside out.
		 */
		const connectedPort = branch.connectedPort || nearestEndOf(run, port);

		if (connectedPort === "end") {
			run.geometry = { ...run.geometry, end: { x: port.x, y: port.y } };
		} else if (connectedPort === "start") {
			run.geometry = { ...run.geometry, start: { x: port.x, y: port.y } };
		}
	});

	junction.engineering = {
		...(junction.engineering || {}),
		connections: (junction.geometry?.branches || [])
			.map((branch) => branch.connected || null)
			.filter((id, index, all) => id || all.indexOf(id) === index)
	};

	return true;
}

/* The port of `run` closest to a point. */
function nearestEndOf(run, point) {
	const start = run?.geometry?.start;
	const end = run?.geometry?.end;

	if (!start || !end || !point) {
		return null;
	}

	return Math.hypot(end.x - point.x, end.y - point.y) <= Math.hypot(start.x - point.x, start.y - point.y)
		? "end"
		: "start";
}

/* ============================================================
 * CONNECTING A PIPE TO A BRANCH
 * ============================================================ */

/*
 * TAKE A PIPE DRAWN FROM A STUB.
 *
 * Called when a Pipe / Duct run is committed. If one of its ends landed on a
 * junction stub, that branch takes the pipe; if nothing was free, a new branch is
 * added rather than creating a second, overlapping junction.
 *
 * Returns the junction that took it, or null.
 */
export function connectPipeToJunction(run, objects = drawingState.objects) {
	if (!run || !enggPipeDuct.isPipeDuctType(run.type)) {
		return null;
	}

	const ports = enggPipeDuct.portsOf(run);

	for (const junction of junctionsIn(objects)) {
		for (const port of ports) {
			const branch = enggJunction.branchAtPoint(junction, port.point, ENDPOINT_TOLERANCE);

			if (!branch) {
				continue;
			}

			if (branch.connected && branch.connected !== run.id) {
				continue;
			}

			enggJunction.connectBranch(junction, branch.id, {
				direction: directionTowardPipe(run, port.id) || branch.direction,
				width: widthOf(run),
				connected: run.id,
				connectedPort: port.id
			});

			return junction;
		}
	}

	return null;
}

/* ============================================================
 * AUTOMATIC CREATION
 * ============================================================
 *
 * A JUNCTION IS DECIDED BY THE CONNECTION TOPOLOGY, NEVER BY THE GESTURE.
 *
 * One function, `reconcileJunctionsFor`, looks at the sheet after any change - a
 * run drawn, a handle dragged, a pipe moved, a panel edit, a source edit - and
 * asks the one question the automatic fitting is allowed to ask: HOW MANY PIPE
 * BRANCHES MEET HERE, and how do they meet?
 *
 *   3+ pipe ENDS at one point          one Junction
 *   an END on another run's INTERIOR   split the host, one Junction
 *   two INTERIORS genuinely crossing   split BOTH pipes, one Junction
 *
 * and, just as importantly, it leaves everything else alone:
 *
 *   two ends meeting                   the Elbow's corner, or a continuation
 *   an interior already fitted         already connected - nothing new
 *   parallel or merely near runs       no connection at all
 *
 * A junction is FOUND by its hub and its participating runs before one is made,
 * so a drag that runs this on every frame cannot accumulate fittings - and the
 * preview never commits one at all: it only draws.
 *
 * ============================================================
 * A TRANSIENT OVERRUN IS NOT A BRANCH
 * ============================================================
 *
 * An elbow-connected route re-cuts its pipes on every frame, so during a drag
 * one of them can briefly be longer than its bend and cross a pipe it is
 * CONNECTED to. Read naively, that crossing looks like an endpoint landing on a
 * neighbour's interior - and a Junction appeared out of an ordinary change of
 * direction.
 *
 * The answer is the CONNECTION RECORD, not a global suppression. A run that is
 * already joined to another (by an Elbow, or as part of one Junction) runs
 * THROUGH that joint, and a joint is not a branch - so `runInteriorAt` skips
 * runs the querying run is already connected to. A genuine endpoint-to-segment
 * connection - a FREE end reaching a pipe it is not joined to - still earns its
 * Junction.
 */

/*
 * THE INTERIOR OF ANOTHER RUN THAT ONE OF THIS RUN'S ENDS SITS ON, if any.
 *
 * `runInteriorAt` answers "where is the nearest run's interior"; this adds what
 * an END-TO-MIDDLE connection needs: the host is a DIFFERENT run, the end is
 * genuinely on it rather than near it, and the host is not already split at that
 * point - in which case a junction already joins it there and there is nothing
 * left to do.
 */
export function interiorConnectionFor(run, objects = drawingState.objects) {
	if (!run || !enggPipeDuct.isPipeDuctType(run.type)) {
	return null;
	}

	const others = (objects || []).filter((object) => object.id !== run.id);

	/*
	 * A RUN THAT IS ALREADY FITTED IS NOT A NEW BRANCH.
	 *
	 * A joined run has been SEATED on its fitting: its stored end is the bend's
	 * tangent point, or the junction's port - and that point can lie over another
	 * run's centreline quite innocently (a host half whose port is near the pipe
	 * it was cut from, for instance). Asking again then reads the settling of an
	 * EXISTING connection as a brand-new endpoint-to-interior one, and splits the
	 * fitting's own pipe a second and third time.
	 *
	 * So an end already held by a fitting is not offered - the same rule
	 * `connectPipeEndpoints` applies to an end held by a bend. Only a genuine
	 * free end can make a new connection.
	 */
	for (const port of enggPipeDuct.portsOf(run)) {
	/* A point that is another run's END is an endpoint connection. */
	if (pipeEndpointAt(port.point, others)) {
	continue;
	}

		/*
	 * A SEATED END IS NOT A NEW BRANCH, BUT A FREE END STILL IS.
	 *
	 * An end a fitting holds sits on that fitting's mouth, which can lie over
	 * another run's centreline quite innocently - a host half whose port is near
	 * the pipe it was cut from, for instance. Reading that as a fresh
	 * endpoint-to-interior connection split the fitting's own pipe a second and
	 * third time.
	 *
	 * The test is therefore PER END, from the fitting's own record, and not
	 * `runIsFitted(run)`: a branch joined at one end still has its OTHER end free
	 * to make a second connection, and refusing the whole run made a genuine new
	 * branch impossible on any pipe that already had a fitting.
	 */
	if (endIsHeldByFitting(run, port.id, objects)) {
	continue;
	}

	const interior = runInteriorAt(port.point, others, INTERIOR_CONNECTION_TOLERANCE, {
		exclude: run.id
	});



	if (interior) {
	return { ...interior, incoming: run, incomingPort: port.id };
	}
	}

	return null;
}

/*
 * WHETHER A RUN IS ALREADY JOINED TO A JUNCTION.
 *
 * `engineering.connections` is the junction's branch record, and it is the one
 * statement of the connection - so a run named there has already had its
 * endpoint-to-interior relationship made, and has nothing left to earn.
 */
function endIsHeldByFitting(run, end, objects = drawingState.objects) {
	return (objects || []).some((object) => {
		if (enggPipeDuct.isElbowType(object.type)) {
			const ports = object.engineering?.ports;

			if (!ports || Array.isArray(ports)) {
				return false;
			}

			return ports[run.id] === end && (end === "start" || end === "end");
		}

		if (enggJunction.isJunctionType(object.type)) {
			return (object.geometry?.branches || []).some(
				(branch) => branch.connected === run.id && branch.connectedPort === end
			);
		}

		return false;
	});
}

/*
 * WHETHER TWO RUNS ARE ALREADY JOINED - by an Elbow, or as two branches of one
 * Junction. This is the CONNECTION record, not proximity: it says nothing about
 * where the pipes happen to be drawn.
 */
export function runsAreConnected(firstId, secondId, objects = drawingState.objects) {
	if (!firstId || !secondId || firstId === secondId) {
	return false;
	}

	const joinedByElbow = (objects || []).some(
	(object) =>
	enggPipeDuct.isElbowType(object.type) &&
	Array.isArray(object.engineering?.connections) &&
	object.engineering.connections.includes(firstId) &&
	object.engineering.connections.includes(secondId)
	);

	if (joinedByElbow) {
	return true;
	}

	return junctionsIn(objects).some((junction) => {
	const ids = junctionIds(junction);

	return ids.includes(firstId) && ids.includes(secondId);
	});
}

function junctionIds(junction) {
	const fromBranches = (junction.geometry?.branches || [])
	.map((branch) => branch.connected)
	.filter(Boolean);

	const fromRecord = (junction.engineering?.connections || []).filter(Boolean);

	return [...new Set([...fromBranches, ...fromRecord])];
}

/*
 * THE ENDPOINT-TO-MIDDLE CASE, ON ITS OWN.
 *
 * Called after a run is drawn, dragged or re-pointed. If one of its ends is on
 * another run's INTERIOR, that host is split and a junction is created joining
 * the two halves and the incoming run.
 *
 * Returns the junction, or null when there is no interior connection to make.
 */
export function createJunctionForInteriorConnection(run, objects = drawingState.objects) {
	if (!run || !enggPipeDuct.isPipeDuctType(run.type)) {
		return null;
	}

	const interior = interiorConnectionFor(run, objects);

	if (!interior) {
		return null;
	}

	if (junctionAlreadyAt(interior.run.id, interior.point, objects)) {
		return null;
	}

	return commitJunctionAtInterior(interior);
}

/*
 * THE ENDPOINT-TO-MIDDLE JUNCTION, COMMITTED.
 *
 * The host is split into two independent runs, both halves and the incoming run
 * are recorded as the junction's three branches, and every one of them ends on
 * its port. ONE undoable operation: the caller has already snapshotted.
 */
function commitJunctionAtInterior(interior, objects = drawingState.objects) {
	const previousObjects = enggDrawingState.snapshotDrawing(drawingState);

	const split = splitHostPipeAt(interior, { hub: interior.point });

	if (!split) {
		return null;
	}

	const axis = enggJunction.directionOf(split.first.geometry.start, split.first.geometry.end);

	if (!axis) {
		return null;
	}

	const incoming = interior.incoming;
	const towardPipe = interior.incomingPort
	? directionTowardPipe(incoming, interior.incomingPort)
	: null;

	const junction = enggJunction.createJunction({
	position: interior.point,
		branches: [
			{
				id: "a",
				direction: { x: -axis.x, y: -axis.y },
				main: true,
				width: widthOf(split.first),
				connected: split.first.id,
				connectedPort: "end"
			},
			{
				id: "b",
				direction: axis,
				width: widthOf(split.second),
				connected: split.second.id,
				connectedPort: "start"
			},
			{
				id: "c",
				direction: towardPipe || enggJunction.directionAtAngle(axis, enggJunction.DEFAULT_BRANCH_ANGLE),
				width: widthOf(incoming),
				connected: incoming.id,
				connectedPort: interior.incomingPort
			}
	],
	style: { ...(incoming.style || split.first.style || drawingState.styleDefaults || {}) },
	engineering: {
			generated: true,
			mainPipe: split.first.id,
			origin: "interior"
	}
	});

	if (!junction) {
		return null;
	}

	replaceHostWithHalves(interior.run, split, objects);

	enggDrawingState.addObject(drawingState, junction);

	applyJunctionConnections(junction, drawingState.objects);

	enggDrawingState.commitDrawingChange(drawingState, previousObjects);

	return drawingState.objects.find((object) => object.id === junction.id) || junction;
}

/*
 * THE INTERIOR-TO-INTERIOR CASE: two centre lines genuinely crossing.
 *
 *   1. find the intersection of the two centrelines, each strictly interior;
 *   2. split BOTH runs there - four independent segments;
 *   3. build ONE junction with four branches, one per segment;
 *   4. seat every segment on its port, so no wall runs on into the fitting.
 *
 * ONE TRANSACTION. Both splits are computed before either is written, so a
 * split that cannot be made leaves the sheet exactly as it was rather than
 * half-cut - the failure mode that would leave one pipe ended in mid-air.
 */
export function interiorIntersectionFor(first, second) {
	if (!enggPipeDuct.isPipeDuctType(first?.type) || !enggPipeDuct.isPipeDuctType(second?.type)) {
		return null;
	}

	if (first.id === second.id) {
		return null;
	}

	const a = first.geometry || {};
	const b = second.geometry || {};

	if (!a.start || !a.end || !b.start || !b.end) {
	return null;
	}

	/*
	 * TWO RUNS THAT ARE ALREADY JOINED ARE NOT A NEW CROSSING.
	 *
	 * A connected route re-cuts its pipes on every frame, so one of them can
	 * briefly be longer than its bend and appear to cross the pipe on the other
	 * side of it. That is the same joint seen through a transient overrun, not a
	 * branch - and splicing it would replace a valid Elbow connection with a
	 * Junction nobody asked for.
	 */
	if (runsAreConnected(first.id, second.id)) {
	return null;
	}

	const rx = a.end.x - a.start.x;
	const ry = a.end.y - a.start.y;
	const sx = b.end.x - b.start.x;
	const sy = b.end.y - b.start.y;

	const denominator = rx * sy - ry * sx;

	/* PARALLEL RUNS NEVER CONNECT, however close together they are drawn. */
	if (Math.abs(denominator) < 1e-9) {
		return null;
	}

	const qx = b.start.x - a.start.x;
	const qy = b.start.y - a.start.y;

	const t = (qx * sy - qy * sx) / denominator;
	const u = (qx * ry - qy * rx) / denominator;

	/* STRICTLY INTERIOR ON BOTH. An end is an endpoint case, handled elsewhere. */
	const margin = 1e-6;

	if (t <= margin || t >= 1 - margin || u <= margin || u >= 1 - margin) {
		return null;
	}

	return {
	first,
	second,
	point: { x: a.start.x + rx * t, y: a.start.y + ry * t },
	firstDirection: enggJunction.directionOf(a.start, a.end),
	secondDirection: enggJunction.directionOf(b.start, b.end)
	};
}

/*
 * BUILD THE FOUR-WAY JUNCTION A CROSSING EARNS.
 *
 * The MAIN RUN is the FIRST pipe - the one already on the sheet, chosen
 * deterministically by the caller's ordering rather than by array luck - and its
 * two halves occupy the main branch and its opposed partner. The second pipe's
 * halves are the two secondary branches, at whatever angle the pipes actually
 * cross at.
 *
 * Each half keeps its own pipe's appearance and width; the FITTING takes the
 * TRIGGER pipe's appearance, copied once and never read again.
 */
export function commitJunctionAtIntersection(crossing, objects = drawingState.objects) {
	const { first, second, point } = crossing || {};

	if (!first || !second || !point) {
		return null;
	}

	const firstStart = enggPipeDuct.portsOf(first).find((port) => port.id === "start")?.point;
	const secondStart = enggPipeDuct.portsOf(second).find((port) => port.id === "start")?.point;

	const firstSplit = splitHostPipeAt({ run: first, point }, { hub: point });
	const secondSplit = splitHostPipeAt({ run: second, point }, { hub: point });

	if (!firstSplit || !secondSplit) {
		return null;
	}

	const axis = enggJunction.directionOf(firstSplit.first.geometry.start, firstSplit.first.geometry.end);

	/* The second pipe's own direction, pointing AWAY from its original start. */
	const across = enggJunction.directionOf(secondSplit.first.geometry.start, secondSplit.first.geometry.end);

	if (!axis || !across) {
		return null;
	}

	/* BOTH PIPES' EXTERNAL ENDS ARE UNTOUCHED - only the cut end moves. */
	if (
	!samePoint(firstSplit.first.geometry.start, firstStart) ||
	!samePoint(secondSplit.first.geometry.start, secondStart)
	) {
		return null;
	}

	const previousObjects = enggDrawingState.snapshotDrawing(drawingState);

	const junction = enggJunction.createJunction({
	position: point,
		branches: [
			{
				id: "a",
				direction: { x: -axis.x, y: -axis.y },
				main: true,
				width: widthOf(firstSplit.first),
				connected: firstSplit.first.id,
				connectedPort: "end"
			},
			{
				id: "b",
				direction: axis,
				width: widthOf(firstSplit.second),
				connected: firstSplit.second.id,
				connectedPort: "start"
			},
			{
				id: "c",
				direction: { x: -across.x, y: -across.y },
				width: widthOf(secondSplit.first),
				connected: secondSplit.first.id,
				connectedPort: "end"
			},
			{
				id: "d",
				direction: across,
				width: widthOf(secondSplit.second),
				connected: secondSplit.second.id,
				connectedPort: "start"
			}
	],
	style: { ...(first.style || drawingState.styleDefaults || {}) },
	engineering: {
			generated: true,
			mainPipe: firstSplit.first.id,
			origin: "intersection",
			/* Which pipe each pair of segments came from, for safe merging later. */
			sourcePipes: {
				[firstSplit.first.id]: first.id,
				[firstSplit.second.id]: first.id,
				[secondSplit.first.id]: second.id,
				[secondSplit.second.id]: second.id
			}
	}
	});

	if (!junction) {
		return null;
	}

	replaceHostWithHalves(first, firstSplit, objects);
	replaceHostWithHalves(second, secondSplit, objects);

	enggDrawingState.addObject(drawingState, junction);

	applyJunctionConnections(junction, drawingState.objects);

	enggDrawingState.commitDrawingChange(drawingState, previousObjects);

	return drawingState.objects.find((object) => object.id === junction.id) || junction;
}

function samePoint(left, right, tolerance = 1e-6) {
	if (!left || !right) {
		return false;
	}

	return Math.hypot(left.x - right.x, left.y - right.y) <= tolerance;
}

/* Whether a junction already joins this run at (or beside) this point. */
export function junctionAlreadyAt(runId, point, objects = drawingState.objects) {
	return junctionsIn(objects).some((junction) => {
		const joins = enggJunction.junctionConnections(junction).includes(runId);

		if (!joins) {
			return false;
	}

		const hub = junction.geometry?.position;

		return hub && Math.hypot(hub.x - point.x, hub.y - point.y) <= Math.max(INTERIOR_CONNECTION_TOLERANCE, 1);
	});
}

/* Whether any junction's hub is at a point - used before a second one is made. */
export function junctionHubAt(point, objects = drawingState.objects) {
	if (!point) {
		return null;
	}

	return (
		junctionsIn(objects).find((junction) => {
			const hub = junction.geometry?.position;

			return hub && Math.hypot(hub.x - point.x, hub.y - point.y) <= Math.max(INTERIOR_CONNECTION_TOLERANCE, 1);
	}) || null
	);
}

/*
 * THE ENDPOINT-TO-ENDPOINT CASE: three or more ends in one place.
 *
 * Pipes drawn individually all finishing on one point make a junction. Two ends
 * alone do NOT: that is the Elbow's corner, or a straight continuation, and it is
 * left to those tools.
 *
 * Returns the junction created or updated, or null.
 */
export function createJunctionForEndpointCluster(point, objects = drawingState.objects) {
	if (!point) {
		return null;
	}

	const ends = [];

	pipesIn(objects).forEach((run) => {
	enggPipeDuct.portsOf(run).forEach((port) => {
			if (Math.hypot(port.point.x - point.x, port.point.y - point.y) <= Math.max(ENDPOINT_TOLERANCE, 0.5)) {
				ends.push({ run, port: port.id });
			}
	});
	});

	if (ends.length < enggJunction.MINIMUM_BRANCHES) {
		return null;
	}

	/* ONE JUNCTION PER CLUSTER, updated rather than duplicated. */
	const existing = junctionHubAt(point, objects);

	const branches = ends.map((end, index) => {
		const direction = directionTowardPipe(end.run, end.port);

		return {
			id: "abcdefgh"[index],
			direction: direction || { x: 0, y: 1 },
			width: widthOf(end.run),
			connected: end.run.id,
			connectedPort: end.port,
			main: index === 0
	};
	});

	if (existing) {
	/*
		 * THE STUDENT'S MAIN RUN IS KEPT. A junction that already exists has a
		 * main direction the angles are measured from; a later pipe joining it
		 * must not redefine that reference.
		 */
		branches.forEach((branch, index) => {
			const target = existing.geometry.branches[index];

			if (target) {
				enggJunction.connectBranch(existing, target.id, branch);
			} else {
				enggJunction.addBranch(existing, branch);
			}
	});

	applyJunctionConnections(existing, objects);

		return existing;
	}

	const previousObjects = enggDrawingState.snapshotDrawing(drawingState);

	const junction = enggJunction.createJunction({
	position: point,
		branches,
	style: { ...(ends[0].run.style || drawingState.styleDefaults || {}) },
	engineering: {
			generated: true,
			mainPipe: ends[0].run.id,
			origin: "endpoints"
	}
	});

	if (!junction) {
		return null;
	}

	enggDrawingState.addObject(drawingState, junction);

	applyJunctionConnections(junction, drawingState.objects);

	enggDrawingState.commitDrawingChange(drawingState, previousObjects);

	return drawingState.objects.find((object) => object.id === junction.id) || junction;
}

/*
 * ============================================================
 * THE ONE PLACE A JUNCTION IS CREATED OR UPDATED AUTOMATICALLY
 * ============================================================
 *
 * Called after every change to a run's geometry - drawn, dragged, moved, edited
 * in the panel, changed by source synchronization - and it looks at THE WHOLE
 * SHEET, because a crossing it has to notice may be between two pipes that were
 * both already there.
 *
 * The three cases are tried in the order that keeps the fitting SINGULAR:
 *
 *   1. an INTERIOR INTERSECTION - split both, one four-way junction
 *   2. an END ON AN INTERIOR     - split the host, one junction
 *   3. THREE OR MORE ENDS         - one junction over the whole cluster
 *
 * A connection that already has a junction is left alone; where a NEW branch
 * arrives at an existing junction (an endpoint, or a pipe drawn across one of
 * its pipes) that junction is UPDATED rather than joined by a second one.
 *
 * Returns the junctions created or updated, in the order they were settled.
 */
export function reconcileJunctionsFor(changed, objects = drawingState.objects, options = {}) {
	const result = [];

	const sheet = () => (Array.isArray(objects) ? objects : drawingState.objects);

		/*
	 * 1. A CROSSING IS NOT A CONNECTION.
	 *
	 * Two runs whose interiors happen to cross are two runs that happen to
	 * cross: nothing was joined, no endpoint moved, and the student drew no
	 * fitting. Creating a junction there would splice two unrelated runs
	 * wherever the picture happened to overlap them.
	 */

	for (const run of pipesIn(sheet())) {
		const interior = interiorConnectionFor(run, sheet());

		if (!interior || junctionHubAt(interior.point, sheet())) {
			continue;
	}

		const junction = commitJunctionAtInterior(interior, sheet());

		if (junction) {
			result.push(junction);
	}
	}

	/*
	 * 3. THREE OR MORE ENDS AT ONE POINT. Every point at which a run ends is a
	 * candidate cluster, and only the ones with three or more ends become a
	 * junction - an ordinary two-end corner stays the Elbow's.
	 */
	const candidates = new Map();

	pipesIn(sheet()).forEach((run) => {
	enggPipeDuct.portsOf(run).forEach((port) => {
			const key = `${Math.round(port.point.x * 1e6)}:${Math.round(port.point.y * 1e6)}`;

			if (!candidates.has(key)) {
				candidates.set(key, { point: port.point, count: 0 });
			}

			candidates.get(key).count += 1;
	});
	});

	candidates.forEach((candidate) => {
		if (candidate.count < enggJunction.MINIMUM_BRANCHES) {
			return;
	}

		const junction = createJunctionForEndpointCluster(candidate.point, sheet());

		if (junction) {
			result.push(junction);
	}
	});

	/*
	 * AND THE ASSEMBLY GROUPING, FROM THE TOPOLOGY JUST SETTLED.
	 *
	 * An assembly is a view of which objects are joined; it holds no connection of
	 * its own. Regrouping HERE - at the end of the one reconcile, once every split,
	 * fitting and removal has happened - is what keeps the Objects tree in step with
	 * the pipework without a second update path of its own.
	 */
	if (options.reconcileAssemblies !== false) {
		reconcilePipeAssemblies(sheet());
	}

	return result;
}

/* ============================================================
 * LIFECYCLE
 * ============================================================ */

/*
 * WHETHER A JUNCTION IS STILL NEEDED.
 *
 * A junction is the fitting for THREE OR MORE branches. Below that the remaining
 * connection is a corner (two branches) or a continuation, and it belongs to the
 * Elbow or to the pipe itself - except for a MANUAL junction, which the student
 * placed deliberately and which is never removed behind their back.
 */
export function junctionIsNeeded(junction) {
	if (!enggJunction.isJunctionType(junction?.type)) {
		return false;
	}

	if (junction.engineering?.generated !== true) {
		return (junction.geometry?.branches || []).length >= 2;
	}

	return enggJunction.connectedBranchCount(junction) >= enggJunction.MINIMUM_BRANCHES;
}

/*
 * REBUILD A JUNCTION AFTER ITS PIPES MOVED OR WERE DELETED.
 *
 * This is the junction's equivalent of `refreshFluidConnections`: it re-seats the
 * joined pipes on their ports and reports a junction that has outlived its
 * purpose, WITHOUT deleting it - the caller owns that decision, because removing a
 * fitting and converting the remainder to an Elbow is a whole-drawing operation.
 */
export function refreshJunction(junction, objects = drawingState.objects) {
	if (!junction || !enggJunction.isJunctionType(junction.type)) {
		return { updated: false, obsolete: false };
	}

	applyJunctionConnections(junction, objects);

	return {
		updated: true,
		obsolete: !junctionIsNeeded(junction),
		retained: enggJunction.connectedBranchCount(junction)
	};
}

/* Every junction that joins this run. */
export function junctionsForRun(runId, objects = drawingState.objects) {
	return junctionsIn(objects).filter((junction) =>
		enggJunction.junctionConnections(junction).includes(runId)
	);
}

/* ============================================================
 * THE LIFECYCLE: WHEN A JUNCTION STOPS BEING ONE
 * ============================================================
 *
 * An AUTOMATIC junction exists because three or more branches met. When that
 * stops being true the fitting is obsolete, and what is left is either a
 * CONTINUATION (two collinear runs, which should be one pipe) or a CORNER
 * (two angled runs, where an Elbow belongs).
 *
 * A MANUAL junction is the student own object. Losing a branch leaves it
 * standing with fewer arms, and nothing here removes it.
 */
function runsAreCollinear(first, second) {
	const a = first?.geometry;
	const b = second?.geometry;

	if (!a?.start || !a?.end || !b?.start || !b?.end) {
		return false;
	}

	const directionA = enggPipeDuct.directionOf(a.start, a.end);
	const directionB = enggPipeDuct.directionOf(b.start, b.end);

	if (!directionA || !directionB) {
		return false;
	}

	/* Parallel, in either sense: the runs are one line through the fitting. */
	return Math.abs(directionA.x * directionB.y - directionA.y * directionB.x) < 1e-6;
}

/*
 * WHETHER TWO RUNS CAN BE MERGED WITHOUT LOSING ANYTHING.
 *
 * Geometry alone is not enough: each half may have been restyled or re-sized
 * since the split, and merging them would silently keep one of the two. A
 * merge is offered only when the pair AGREES about everything the student
 * could have changed - appearance and width.
 */
function runsCanMerge(first, second) {
	if (!runsAreCollinear(first, second)) {
		return false;
	}

	const signature = (run) => JSON.stringify({
		style: run?.style || {},
		engineering: run?.engineering || {},
		visible: run?.visible !== false,
		fixed: run?.fixed === true,
		locked: run?.locked === true
	});

	return signature(first) === signature(second);
}

/*
 * THE MERGED RUN: the pair as ONE line, keeping the first run identity.
 *
 * Each half was cut back to its PORT when the junction was made, and the SPAN
 * is the line it was drawn along - both ends of it. The merged pipe is those
 * two spans end to end, so the result runs from one OUTER end to the other.
 */
function mergedRun(first, second) {
	const spanOf = (run) =>
		run?.geometry?.span?.start && run?.geometry?.span?.end
		? run.geometry.span
		: { start: run.geometry.start, end: run.geometry.end };

	const a = spanOf(first);
	const b = spanOf(second);

	const distance = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

	const pairs = [
		{ first: a.start, second: b.end, gap: distance(a.end, b.start) },
		{ first: a.start, second: b.start, gap: distance(a.end, b.end) },
		{ first: a.end, second: b.end, gap: distance(a.start, b.start) },
		{ first: a.end, second: b.start, gap: distance(a.start, b.end) }
	];

	const best = pairs.reduce((winner, candidate) =>
		candidate.gap < winner.gap ? candidate : winner
	);

	return {
		...first,
		geometry: {
		...first.geometry,
		start: { x: best.first.x, y: best.first.y },
		end: { x: best.second.x, y: best.second.y },
		span: {
		start: { x: best.first.x, y: best.first.y },
		end: { x: best.second.x, y: best.second.y }
		},
		trims: undefined,
		bendJoints: undefined
		}
	};
}

/* The corner two seated runs share: where their drawn lines meet. */
function sharedCornerOf(pair) {
	const lineOf = (run) => {
		const span = run?.geometry?.span;
		const from = span?.start || run?.geometry?.start;
		const to = span?.end || run?.geometry?.end;
		const direction = from && to ? enggPipeDuct.directionOf(from, to) : null;

		return direction ? { from, direction } : null;
	};

	const a = lineOf(pair[0]);
	const b = lineOf(pair[1]);

	if (!a || !b) {
		return null;
	}

	const denominator = a.direction.x * b.direction.y - a.direction.y * b.direction.x;

	if (Math.abs(denominator) < 1e-9) {
		return null;
	}

	const t =
		((b.from.x - a.from.x) * b.direction.y - (b.from.y - a.from.y) * b.direction.x) /
		denominator;

	return { x: a.from.x + a.direction.x * t, y: a.from.y + a.direction.y * t };
}

/* The end of a run FURTHEST from the shared corner. */
function outerEndOf(run, corner) {
	const span = run?.geometry?.span;

	const from = span?.start || run?.geometry?.start;
	const to = span?.end || run?.geometry?.end;

	if (!from || !to || !corner) {
		return null;
	}

	const fromStart = Math.hypot(from.x - corner.x, from.y - corner.y);
	const fromEnd = Math.hypot(to.x - corner.x, to.y - corner.y);

	return fromStart >= fromEnd ? { ...from } : { ...to };
}

/*
 * NORMALISE WHAT IS LEFT WHEN A JUNCTION GOES.
 *
 * The junction is gone; the runs its branch records still name are considered,
 * and only when there are exactly two - a continuation or a corner is a
 * two-run question.
 *
 *   COLLINEAR AND ALIKE   merge into one run, keeping the first id and name
 *   ANGLED                build an Elbow at the corner they now make
 *   ANYTHING ELSE         left exactly as they are
 */
export function normaliseJunctionRemoval(junction, objects = drawingState.objects, options = {}) {
	const record = { merged: null, elbow: null, kept: null };

	if (!junction) {
		return record;
	}

	/*
	 * THE PIPES THE FITTING STILL HAS, not every id it ever recorded: a removed
	 * branch keeps its id in the record until a later settle prunes it.
	 */
	const joined = (junction.geometry?.branches || [])
		.filter((branch) => branch.connected)
		.map((branch) => (objects || []).find((object) => object.id === branch.connected))
		.filter((run) => Boolean(run?.id));

	const runs = joined.filter((run, index) => joined.findIndex((other) => other.id === run.id) === index);

	if (runs.length !== 2) {
		record.kept = runs;
		return record;
	}

	if (runsCanMerge(runs[0], runs[1])) {
		const merged = mergedRun(runs[0], runs[1]);
		const at = objects.findIndex((object) => object.id === runs[0].id);

		if (at < 0) {
			record.kept = runs;
		return record;
		}

		objects.splice(at, 1, merged);

		const other = objects.findIndex((object) => object.id === runs[1].id);

		if (other >= 0) {
		objects.splice(other, 1);
		}

		record.merged = merged;
		return record;
	}

	/*
	 * ANGLED PAIR EARNS AN ELBOW. The builder reads the runs FROM THE SHEET, so
	 * it is the SHEET that is unseated: each run is put back on the line it was
	 * drawn along, from its outer end to the shared corner, and put back again if
	 * no bend is returned.
	 */
	const corner = sharedCornerOf(runs);

	const saved = runs.map((run) => ({ id: run.id, geometry: JSON.parse(JSON.stringify(run.geometry || {})) }));

	const restore = () => {
		saved.forEach((entry) => {
		const run = (objects || []).find((object) => object.id === entry.id);

		if (run) {
			run.geometry = entry.geometry;
		}
		});
	};

	if (corner) {
		runs.forEach((run) => {
		const outer = outerEndOf(run, corner);

		if (outer) {
			run.geometry = { ...run.geometry, start: { ...outer }, end: { ...corner } };
		}
		});
	}

	const build = builderOf();
	const elbow = build && corner
		? build(runs[0], runs[1], enggPipeDuct.defaultPipeEngineering())
		: null;

	if (!elbow) {
		restore();
		record.kept = runs;
		return record;
	}

	if (!options.dryRun) {
		enggDrawingState.addObject(drawingState, elbow);
	}

	record.elbow = elbow;

	return record;
}

/* ============================================================
 * FINISHING AND CANCELLING THE TOOL
 * ============================================================ */

export function finishJunctionConstruction() {
	enggDrawingState.setInteraction(drawingState, {
		fluidsTool: "junction",
		phase: "idle",
		preview: null,
		junctionStart: null,
		junctionMainDirection: null
	});

	setToolMessage("Press and drag to place a Junction - the drag sets the main run");

	renderProperties();
	renderCurrentDrawing();
}

export function cancelJunctionConstruction() {
	enggDrawingState.clearInteraction(drawingState);

	enggDrawingState.setActiveTool(drawingState, "select");

	setToolMessage("Select geometry");

	renderProperties();
	renderCurrentDrawing();
}

const enggJunctionTool = {
	JUNCTION_PHASE,
	INTERIOR_CONNECTION_TOLERANCE,
	ENDPOINT_TOLERANCE,

	pipeEndpointAt,
	runInteriorAt,
	portDirection,
	widthOf,

	defaultBranchSet,

	beginJunctionConstruction,
	junctionGesturePreview,
	commitJunctionGesture,
	finishJunctionConstruction,
	cancelJunctionConstruction,

	splitHostPipeAt,
	replaceHostWithHalves,

	applyJunctionConnections,
	connectPipeToJunction,
	createJunctionForInteriorConnection,
	createJunctionForEndpointCluster,
	junctionAlreadyAt,

	junctionIsNeeded,
	refreshJunction,
	junctionsForRun
};

export default enggJunctionTool;
