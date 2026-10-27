/*
 * ========================================================
 * PIPE ASSEMBLY: A CONNECTED PIPE SYSTEM, GROUPED
 * ========================================================
 *
 * An ASSEMBLY is the organisational parent of one connected pipe system: a set
 * of Pipe / Duct, Elbow and Junction objects that are joined to each other. It
 * gives the Objects tab a hierarchy and lets a student move or turn a whole
 * system at once.
 *
 * ========================================================
 * MEMBERSHIP IS NOT CONNECTION
 * ========================================================
 *
 * The two ideas are kept rigorously apart, because they answer different
 * questions and must never become each other's proof:
 *
 *   CONNECTION   the physical topology - which pipe ends a fitting joins. It is
 *                owned by the Elbow and Junction records
 *                (`engineering.connections`, `branch.connected`), and it is what
 *                snapping, automatic fittings, width transitions and geometry
 *                constraints read. NOTHING HERE CHANGES IT.
 *
 *   MEMBERSHIP   which objects appear under one assembly parent. It is owned by
 *                this module and stored as `parentId` on each member, which is
 *                the application's existing hierarchy field.
 *
 * So an assembly is DERIVED from the connection graph and never invents a
 * connection: two objects sharing a parent were already joined, and deleting a
 * parent or regrouping members leaves every physical connection exactly as it
 * was. Equally, changing a connection updates the membership - but only by
 * regrouping, never by re-pointing a pipe.
 *
 * ========================================================
 * WHY `parentId` AND NOT A NEW FIELD
 * ========================================================
 *
 * `parentId` is already the document's hierarchy: removal cascades down it, the
 * selection walks it, and the Objects tab has one place to read it. A second
 * membership field would be a competing statement of the same fact. The
 * assembly's own membership list (`engineering.members`) is a convenience for
 * reporting and for the source, and it is always rewritten from `parentId` -
 * `parentId` is the authority.
 *
 * AN ASSEMBLY DRAWS NOTHING. It has no geometry of its own and no renderer: it is
 * a container whose ink is its children's. That is why it is skipped by hit
 * testing, the source writer and the renderer.
 */

import enggDrawingState from "../../../../shared/model/drawing-state.js";
import enggPipeDuct from "./pipe-duct.js";

/* The component types a Pipe Assembly may contain, for this stage. */
export const ASSEMBLY_MEMBER_TYPES = Object.freeze(["pipe-duct", "elbow", "junction"]);

export const PIPE_ASSEMBLY_TYPE = "pipe-assembly";

export function isPipeAssemblyType(type) {
	return type === PIPE_ASSEMBLY_TYPE;
}

export function isAssemblyMemberType(type) {
	return ASSEMBLY_MEMBER_TYPES.includes(type);
}

/* ============================================================
 * READING THE CONNECTION GRAPH
 * ============================================================ */

/*
 * THE RUNS AND FITTINGS, AND THE EDGES BETWEEN THEM.
 *
 * One edge per physical connection, taken from the records that own it:
 *
 *   an ELBOW's `connections` pair        joins its two runs
 *   a JUNCTION's branch list             joins everything on the fitting
 *
 * A FITTING IS A NODE TOO. An elbow joins two runs, but it is also PART of the
 * system it joins - the assembly holds the bend, not only the pipes either side
 * of it. So every run a fitting names is linked to that fitting, and to the
 * other runs it names: the fitting is what makes them one system.
 *
 * An edge is created only where the record actually names both ends, so a
 * half-recorded fitting contributes nothing rather than a guess.
 */
function connectionEdges(objects) {
	const edges = new Map();

	const link = (a, b) => {
		if (!a || !b || a === b) {
			return;
		}

		if (!edges.has(a)) {
			edges.set(a, new Set());
		}

		edges.get(a).add(b);

		if (!edges.has(b)) {
			edges.set(b, new Set());
		}

		edges.get(b).add(a);
	};

	(objects || []).forEach((object) => {
		const ids = enggPipeDuct.isElbowType(object.type)
			? (object.engineering?.connections || []).filter(Boolean)
			: object.type === "junction"
				? connectedBranchIds(object)
				: null;

		if (ids === null) {
			return;
		}

		const present = ids.filter((id) => (objects || []).some((member) => member.id === id));

		/*
		 * A FITTING JOINS NOTHING WITHOUT AT LEAST ONE RUN, and a manual elbow with
		 * one end free still belongs to the system its other end joins.
		 */
		if (!present.length) {
			return;
		}

		present.forEach((id) => {
			link(object.id, id);
			present.forEach((other) => link(id, other));
		});
	});

	return edges;
}

/* The runs a junction records as joined, from whichever record has them. */
export function connectedBranchIds(junction) {
	const fromBranches = (junction?.geometry?.branches || [])
		.map((branch) => branch?.connected)
		.filter(Boolean);

	const fromRecord = (junction?.engineering?.connections || []).filter(Boolean);

	return [...new Set([...fromBranches, ...fromRecord])];
}

/*
 * ============================================================
 * THE CONNECTED COMPONENTS
 * ============================================================
 *
 * Every object that takes part in the pipework, grouped by what it is joined
 * to. This is the ONE place connected components are calculated - the grouping
 * below, the diameter and the membership repair all read it.
 *
 * Objects that take part in NOTHING are deliberately absent: a lone pipe is not
 * a system, and it must never be grouped just for being near another one.
 */
export function pipeSystems(objects = drawingStateObjects()) {
	const members = (objects || []).filter((object) => isAssemblyMemberType(object.type));

	const edges = connectionEdges(members);

	const byId = new Map(members.map((object) => [object.id, object]));

	const systems = [];
	const seen = new Set();

	members.forEach((member) => {
		if (seen.has(member.id) || !edges.has(member.id)) {
			return;
		}

		const component = [];
		const queue = [member.id];

		seen.add(member.id);

		while (queue.length) {
			const id = queue.pop();

			const object = byId.get(id);

			if (object) {
				component.push(object);
			}

			(edges.get(id) ? [...edges.get(id)] : []).forEach((next) => {
				if (!seen.has(next)) {
					seen.add(next);
					queue.push(next);
				}
			});
		}

		systems.push(component);
	});

	return systems;
}

/*
 * THE SHEET, INJECTED.
 *
 * This module is imported by the interaction layer, so it cannot import the
 * editor's live document back without a cycle. The editor publishes a lookup and
 * this module asks it - the same arrangement `pipe-duct.js` uses for its runs
 * (`setObjectLookup`). A caller with no document (a pure model test) passes its
 * own object list to every function that needs one.
 */
let objectListLookup = null;

export function setObjectListLookup(lookup) {
	objectListLookup = typeof lookup === "function" ? lookup : null;
}

function drawingStateObjects() {
	if (!objectListLookup) {
		return [];
	}

	try {
		return objectListLookup() || [];
	} catch {
		return [];
	}
}

/* ============================================================
 * THE ASSEMBLY PARENT
 * ============================================================ */

/*
 * A NEW ASSEMBLY.
 *
 * It is an ORDINARY FEATURE of its own type - so it is listed, selectable,
 * saved and loaded by machinery that already exists - but it carries no
 * geometry and is drawn by nothing. `generated` marks it as the automatic
 * grouping this stage provides, which is what lets the reconciler own its
 * lifetime.
 */
/*
 * THE NEXT FREE NAME AMONG ASSEMBLIES.
 *
 * Numbered over the assemblies that exist, so a system added to a sheet with
 * fittings of other kinds is still "Pipe Assembly 1".
 */
function nextAssemblyName(objects) {
	const taken = new Set(
		(objects || [])
			.filter((object) => isPipeAssemblyType(object.type))
			.map((object) => object.name)
	);

	for (let index = 1; ; index += 1) {
		const candidate = `Pipe Assembly ${index}`;

		if (!taken.has(candidate)) {
			return candidate;
		}
	}
}

export function createPipeAssembly(options = {}) {
	return enggDrawingState.createGeometryObject(
		PIPE_ASSEMBLY_TYPE,
		{},
		{
			/*
			 * NAMED EXPLICITLY, so the document's own numbering by TYPE does not
			 * decide what it is called. An assembly's name is the name of a piece of
			 * pipework, not an index into every fitting on the sheet.
			 */
			name: options.name || nextAssemblyName(options.objects || []),
			engineering: {
				generated: true,
				members: [...(options.members || [])],
				...(options.engineering || {})
			}
		}
	);
}

/* ============================================================
 * RECONCILING MEMBERSHIP
 * ============================================================ */

/*
 * ============================================================
 * BRING THE ASSEMBLIES IN LINE WITH THE CONNECTION GRAPH
 * ============================================================
 *
 * Called after any change that can alter the topology - a pipe drawn, a fitting
 * created or retired, a host split, a member deleted. It:
 *
 *   1. recalculates the connected components from the records;
 *   2. reuses an existing assembly for a component that already has one, so an
 *      ordinary edit never renames a system or mints a second parent;
 *   3. makes a parent for a component that has none;
 *   4. rewrites every member's `parentId`, clearing it from anything that is no
 *      longer part of a system;
 *   5. removes a parent left with fewer than two members - a lone pipe is not an
 *      assembly;
 *   6. prunes the members list of each surviving parent.
 *
 * IT NEVER TOUCHES A CONNECTION. Every record it reads is only read; the only
 * writes are `parentId` on a component and the parent's own `members` list.
 *
 * Returns `{ assemblies, created, removed, regrouped }`.
 */
export function reconcilePipeAssemblies(objects = drawingStateObjects()) {
	const list = objects || [];

	const result = { assemblies: [], created: [], removed: [], regrouped: 0 };

	const systems = pipeSystems(list);

	const assemblies = list.filter((object) => isPipeAssemblyType(object.type));

	/* Whether a member is in any component at all, for the clearing pass below. */
	const inSystem = new Set(systems.flat().map((member) => member.id));

	/* An assembly is reused by the members it already holds. */
	const claimed = new Set();

	const assemblyFor = (component) => {
		const ids = new Set(component.map((member) => member.id));

		const existing = assemblies.find(
			(assembly) =>
				!claimed.has(assembly.id) &&
				(assembly.parentId === null || assembly.parentId === undefined) &&
				(assembly.engineering?.members || []).some((id) => ids.has(id))
		);

		if (existing) {
			claimed.add(existing.id);
			return existing;
		}

		/* A parent whose children already point at it also claims the component. */
		const byParent = assemblies.find(
			(assembly) =>
				!claimed.has(assembly.id) &&
				(assembly.parentId === null || assembly.parentId === undefined) &&
				component.some((member) => member.parentId === assembly.id)
		);

		if (byParent) {
			claimed.add(byParent.id);
			return byParent;
		}

		return null;
	};

	systems.forEach((component) => {
		/* One pipe joined to one fitting is a system; one pipe alone is not. */
		if (component.length < 2) {
			return;
		}

		let assembly = assemblyFor(component);

		if (!assembly) {
			assembly = createPipeAssembly({
				objects: list,
				members: component.map((member) => member.id)
			});

			enggDrawingState.addObject({ objects: list }, assembly);

			/* `addObject` may store a named copy; take the one that landed. */
			assembly = list.find((object) => object.id === assembly.id) || assembly;

			result.created.push(assembly);
		}

		component.forEach((member) => {
			if (member.parentId !== assembly.id) {
				member.parentId = assembly.id;
				result.regrouped += 1;
			}
		});

		const ids = component.map((member) => member.id);

		assembly.engineering = {
			...(assembly.engineering || {}),
			members: ids
		};

		if (!result.assemblies.some((kept) => kept.id === assembly.id)) {
			result.assemblies.push(assembly);
		}
	});

	/*
	 * ========================================================
	 * AND THE MEMBERSHIP THAT NO LONGER EXISTS
	 * ========================================================
	 *
	 * A parent is kept only while two of its members are still in one component.
	 * Everything else is stale: an assembly whose system was broken up, or one
	 * left holding a single pipe after the rest was deleted.
	 */
	assemblies.forEach((assembly) => {
		const stillMembers = (assembly.engineering?.members || []).filter(
			(id) => inSystem.has(id) && list.find((object) => object.id === id)?.parentId === assembly.id
		);

		if (stillMembers.length >= 2) {
			return;
		}

		/* Release the children first, so no member is left naming a gone parent. */
		list.forEach((object) => {
			if (object.parentId === assembly.id) {
				delete object.parentId;
			}
		});

		const at = list.findIndex((object) => object.id === assembly.id);

		if (at >= 0) {
			list.splice(at, 1);
			result.removed.push(assembly);
		}
	});

	return result;
}

/* ============================================================
 * COORDINATED TRANSFORMS
 * ============================================================ */

/*
 * ============================================================
 * MOVING A WHOLE ASSEMBLY
 * ============================================================
 *
 * Every member moves by the SAME delta, and the fittings are recomputed from the
 * geometry that results - not from where they used to be.
 *
 * THIS IS A RIGID TRANSLATION. Each member's points shift; nothing is re-cut,
 * re-seated or re-derived on the way. That matters: if each pipe were translated
 * and then separately re-seated, the second one would be measured against a bend
 * already moved by the first, and the system would drift apart by one trim per
 * member. The fittings are settled ONCE, at the end, by the caller's own
 * reconciliation.
 *
 * Returns the members that moved.
 */
export function translateAssemblyMembers(members, deltaX, deltaY) {
	const dx = Number(deltaX);
	const dy = Number(deltaY);

	if (!Number.isFinite(dx) || !Number.isFinite(dy) || (!dx && !dy)) {
		return [];
	}

	const moved = [];

	(members || []).forEach((member) => {
		if (member.type === "pipe-duct") {
			member.geometry = translatedRunGeometry(member.geometry, dx, dy);
			moved.push(member);
			return;
		}

		if (member.type === "elbow") {
			enggPipeDuct.translateElbow(member, dx, dy);
			moved.push(member);
			return;
		}

		if (member.type === "junction") {
			member.geometry = translatedJunctionGeometry(member.geometry, dx, dy);
			moved.push(member);
		}
	});

	return moved;
}

/* A pipe's stored points, its span line and its wall seams all move together. */
function translatedRunGeometry(geometry = {}, dx, dy) {
	const shift = (point) =>
		point && Number.isFinite(point.x) && Number.isFinite(point.y)
			? { x: point.x + dx, y: point.y + dy }
			: point;

	const shiftList = (points) => (Array.isArray(points) ? points.map(shift) : points);

	return {
		...geometry,
		start: shift(geometry.start),
		end: shift(geometry.end),
		...(geometry.span ? { span: { start: shift(geometry.span.start), end: shift(geometry.span.end) } } : {}),

		/* The trims are DISTANCES along the run and do not change when it moves. */
		...(geometry.trims ? { trims: { ...geometry.trims } } : {}),

		...(geometry.bendJoints
			? {
					bendJoints: Object.fromEntries(
						Object.entries(geometry.bendJoints).map(([end, seams]) => [end, shiftList(seams)])
					)
				}
			: {})
	};
}

/* A junction's hub moves; its branch vectors are DIRECTIONS and do not. */
function translatedJunctionGeometry(geometry = {}, dx, dy) {
	const hub = geometry.position;

	if (!hub || !Number.isFinite(hub.x) || !Number.isFinite(hub.y)) {
		return geometry;
	}

	return {
		...geometry,
		position: { x: hub.x + dx, y: hub.y + dy },
		mainDirection: geometry.mainDirection,
		branches: (geometry.branches || []).map((branch) => ({ ...branch, direction: branch.direction }))
	};
}

/* The assembly's own members, resolved on the sheet. */
export function assemblyMembers(assembly, objects = drawingStateObjects()) {
	if (!assembly) {
		return [];
	}

	const ids = assembly.engineering?.members || [];

	return ids
		.map((id) => (objects || []).find((object) => object.id === id))
		.filter(Boolean)
		.filter((object) => object.parentId === assembly.id);
}

const enggPipeAssembly = {
	PIPE_ASSEMBLY_TYPE,
	ASSEMBLY_MEMBER_TYPES,
	isPipeAssemblyType,
	isAssemblyMemberType,
	pipeSystems,
	connectedBranchIds,
	createPipeAssembly,
	reconcilePipeAssemblies,
	assemblyMembers,
	translateAssemblyMembers,
	setObjectListLookup
};

export default enggPipeAssembly;
