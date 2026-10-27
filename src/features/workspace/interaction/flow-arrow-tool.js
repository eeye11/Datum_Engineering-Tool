/*
 * ========================================================
 * THE FLOW ARROW TOOL
 * ========================================================
 *
 * A flow arrow is placed by the SAME hold-and-drag gesture every Fluids flow
 * tool uses: the press attaches to the pipe under the pointer, the drag slides
 * the arrow along that pipe's centreline, and the release commits it.
 *
 * The gesture is a SESSION, exactly as Pipe / Duct's is (see creation-drag.js):
 * the press arms and records the host; the drag publishes a live preview on the
 * interaction; the release commits one arrow and leaves the tool armed for the
 * next. Nothing is written to the document until the release.
 *
 * ========================================================
 * THE DRAG IS CONSTRAINED TO THE PIPE
 * ========================================================
 *
 * A pointer moves in two dimensions; a run is one. The raw cursor is projected
 * ONTO the run's centreline every frame, so the preview - and the committed
 * arrow - can never drift sideways off the pipe. Projecting rather than
 * accepting the raw point is what makes "parallel to the pipe edges" true: the
 * fraction along the run is the only degree of freedom the gesture has.
 *
 * A press that does not land on a Pipe / Duct falls through to the FREE ARROW
 * session (`beginFreeArrowSession`), which draws an independent arrow from the
 * press to the release. The pipe-attached case below is unchanged; the free case
 * is what makes the tool produce a real object on an empty sheet.
 *
 * ========================================================
 * THE ARROW DOES NOT LEAVE ITS HOST WHILE IT IS DRAGGED
 * ========================================================
 *
 * A placement is attached for its whole life, so the drag has a second rule
 * beyond the projection: a pointer that has been dragged WELL AWAY from the run
 * is not a placement on that run any more. Releasing there would otherwise put
 * an arrow under a press that was never on a pipe. The session keeps its LAST
 * position on the pipe instead, so a drag that overshoots still commits one
 * arrow ON the pipe - it never detaches, never drifts, and never invents one
 * somewhere the press did not name.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggPipeDuct from "../model/fluids/pipe-duct.js";
import enggFlowArrow from "../model/fluids/flow-arrow.js";
import enggFlowArrows from "../model/fluids/flow-arrows.js";
import { drawingState, editorState } from "../editor-state.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { renderFeatures } from "../../../components/layout/panels/features-editor.js";
import { objectAtPoint } from "./hit-testing.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";

/* The interaction phase a Flow Arrow under construction uses. */
export const FLOW_ARROW_PHASE = "flow-arrow-construct";

/* ============================================================
 * FINDING THE PIPE UNDER A POINT
 * ============================================================ */

/*
 * The Pipe / Duct whose run a point is on, nearest first.
 *
 * The test is the distance from the point to the run's CENTRELINE - not to its
 * two walls - because the arrow is placed on the centreline and the walls are
 * derived from it. The tolerance is a drawing distance, in world units: a press
 * within it of the centreline is a press on the pipe.
 *
 * Returns `{ run, distance, fraction }`, or null when no pipe is under the
 * point. `fraction` is the projection of the point onto the run, clamped to the
 * range an arrow may sit in - so a press near an end attaches just inside.
 */
/*
 * HOW FAR, IN PIXELS, A POINTER MAY BE FROM A RUN'S CENTRELINE AND STILL BE
 * PRESSING ON IT.
 *
 * A drawing distance in world units, so it is the same reach at any zoom. Six
 * pixels is a comfortable aim at a centreline that a two-wall run draws one
 * line width apart; it is deliberately not the pipe's wall spacing, because the
 * press is on the PIPE, and the pipe is as wide as the student drew it.
 */
export const PIPE_GRAB_PIXELS = 6;

/* The reach, in drawing units, at the current zoom. */
export function pipeGrabTolerance() {
	return PIPE_GRAB_PIXELS / (enggDrawingState.BASE_PIXELS_PER_UNIT * (drawingState.camera?.zoom || 1));
}

/*
 * WHERE A POINT IS ALONG A RUN: the raw fraction of its centreline, and the
 * distance from that centreline.
 *
 * The projection is used by the press, by the drag and by the live preview, so
 * all three agree about which part of the run a cursor names. There is one
 * implementation of it for that reason.
 */
export function projectOntoRun(run, point) {
	const start = run?.geometry?.start;
	const end = run?.geometry?.end;

	if (!start || !end || !point) {
		return null;
	}

	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const length = Math.hypot(dx, dy);

	if (!(length > 1e-9)) {
		return null;
	}

	const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / (length * length);

	const foot = { x: start.x + dx * t, y: start.y + dy * t };

	return {
		fraction: t,
		distance: Math.hypot(point.x - foot.x, point.y - foot.y),
		foot
	};
}

export function pipeAtPoint(point, objects = drawingState.objects) {
	if (!point) {
		return null;
	}

	let best = null;

	(objects || []).forEach((object) => {
		if (!enggPipeDuct.isPipeDuctType(object.type)) {
			return;
		}

		const projection = projectOntoRun(object, point);

		if (!projection) {
			return;
		}

		/* The raw projection, unclamped: a press beyond the run misses it. */
		if (projection.fraction < -0.02 || projection.fraction > 1.02) {
			return;
		}

		if (projection.distance > pipeGrabTolerance()) {
			return;
		}

		if (!best || projection.distance < best.distance) {
			best = {
				run: object,
				distance: projection.distance,
				fraction: enggFlowArrow.clampFraction(projection.fraction)
			};
		}
	});

	return best;
}

/* ============================================================
 * THE SESSION
 * ============================================================ */

/* Arm the tool. Like the other Fluids tools it begins nothing until a press. */
export function beginFlowArrowConstruction() {
	enggDrawingState.setActiveTool(drawingState, "flow-arrow");

	enggDrawingState.setInteraction(drawingState, {
		fluidsTool: "flow-arrow",
		phase: "idle"
	});

	setToolMessage("Press and hold on a Pipe / Duct, then drag to place the Flow Arrow");

	renderProperties();
	renderCurrentDrawing();
}

/*
 * RE-ARM THE TOOL, FROM THE TOOLBAR.
 *
 * The interaction layer returns to Select after an invalid press or a refused
 * duplicate - which is the required behaviour - but the student's NEXT press
 * should place another arrow rather than select. So the tool table marks this
 * tool "resumable": pressing its button again while Select is active re-arms
 * it, and pressing it while it is already armed leaves it armed. Nothing is
 * created and no message is printed either way.
 */
export function resumeFlowArrowConstruction() {
	if (drawingState.activeTool === "flow-arrow") {
		return true;
	}

	beginFlowArrowConstruction();

	return true;
}

/*
 * START A SESSION FROM A PRESS.
 *
 * Called by `creation-drag.js` when the active tool is Flow Arrow. Returns true
 * when the press was taken - which is when a valid Pipe / Duct is under the
 * pointer - and false when it was not, so the press falls through to the
 * ordinary selection path.
 *
 * THE HOST IS THE PRESS'S DECISION. A press on a pipe arms a session naming
 * that pipe; a press anywhere else arms nothing.
 */
export function beginFlowArrowSession(event, resolution) {
	if (event && event.button !== 0) {
		return false;
	}

	/*
	 * THE PIPES ARE HIT AT THEIR TRUE DRAWN POSITION. The snapped construction
	 * point is deliberately NOT used: a construction snap pulls a cursor towards
	 * an endpoint or a parallel line, so a press just away from a pipe could be
	 * moved ONTO it by snapping - and the arrow would appear on a run the student
	 * did not press. The raw cursor is the honest answer to "which pipe is
	 * under the pointer?".
	 */
	const point = resolution?.rawPointerPoint;

	const host = pipeAtPoint(point);

	if (!host) {
		return false;
	}

	/*
	 * EXACT DUPLICATES ARE REFUSED AT THE PRESS. An arrow already sitting where
	 * this one would go is the same indication, so the press starts nothing and
	 * the gesture falls through - the student sees the existing arrow selected
	 * rather than a second one appearing on top of it.
	 */
	const duplicate = (drawingState.objects || []).find(
		(object) =>
			enggFlowArrow.isFlowArrowType(object.type) &&
			enggFlowArrow.isDuplicatePlacement(object, host.run.id, host.fraction)
	);

	if (duplicate) {
		enggDrawingState.selectObject(drawingState, duplicate.id);

		setToolMessage("A Flow Arrow is already there");

		renderProperties();
		renderCurrentDrawing();

		return true;
	}

	const style = { ...(drawingState.styleDefaults || {}) };

	editorState.creationDrag = {
		pointerId: event?.pointerId,
		flowArrow: true,
		hostId: host.run.id,
		fraction: host.fraction,
		startScreen: {
			x: event?.clientX ?? 0,
			y: event?.clientY ?? 0
		},
		style,
		moved: false
	};

	return true;
}

/* ============================================================
 * THE LIVE PREVIEW
 * ============================================================ */

/*
 * WHAT THE DRAG WOULD PLACE, resolved against the pipe as it is now.
 *
 * The cursor is projected onto the host's centreline, so the preview is always
 * ON the pipe whatever the pointer does. Returns the shape the renderer draws:
 * the anchor, the direction and the size.
 */
export function flowArrowPreview(hostId, rawPoint, current = null) {
	const probe = current || { attachment: { hostId } };

	const span = enggFlowArrow.hostSpan(probe);

	if (!span) {
		return null;
	}

	/*
	 * THE CURSOR IS PROJECTED ONTO THE RUN, which is the whole of the
	 * constraint: the run is one-dimensional, so the projection is the only
	 * degree of freedom the pointer has. Nothing is stored sideways, so the
	 * preview cannot drift off the pipe however the drag is made.
	 *
	 * The projection is CLAMPED, which keeps the arrow strictly inside the
	 * run's ends, where the fittings are.
	 */
	const dx = span.end.x - span.start.x;
	const dy = span.end.y - span.start.y;

	const t = ((rawPoint.x - span.start.x) * dx + (rawPoint.y - span.start.y) * dy) / (span.length * span.length);

	const fraction = enggFlowArrow.clampFraction(t);

	const anchor = {
		x: span.start.x + dx * fraction,
		y: span.start.y + dy * fraction
	};

	const direction = enggFlowArrow.arrowDirection(
		current || { attachment: { hostId, fraction } }
	) || span.direction;

	return {
		hostId,
		fraction,
		anchor,
		direction,
		size: enggFlowArrow.arrowSize(current)
	};
}

/*
 * MOVE THE SESSION'S PREVIEW.
 *
 * Called on every pointermove while a session is live. The fraction follows the
 * cursor's projection onto the pipe, and the preview is published on the
 * interaction so the shared renderer draws it.
 *
 * A POINTER THAT HAS LEFT THE RUN DOES NOT TAKE THE ARROW WITH IT - see the
 * header. The session keeps its last fraction, so the arrow stays on the pipe
 * and the release commits it there.
 */
export function moveFlowArrowSession(session, rawPoint) {
	if (!session?.flowArrow || !rawPoint) {
		return;
	}

	const run = (drawingState.objects || []).find((object) => object.id === session.hostId);

	/*
	 * HAS THE POINTER LEFT THE RUN? Far enough away that it is no longer
	 * pointing at this pipe - the arrow keeps the position it last had, and the
	 * preview goes on being drawn there.
	 */
	const projection = run ? projectOntoRun(run, rawPoint) : null;

	const attached = projection ? projection.distance <= pipeGrabTolerance() : true;

	const preview = flowArrowPreview(session.hostId, rawPoint);

	if (!preview) {
		return;
	}

	if (attached) {
		session.fraction = preview.fraction;
	}

	const shown = attached
		? preview
		: flowArrowPreview(session.hostId, null, { attachment: { hostId: session.hostId, fraction: session.fraction } }) || preview;

	enggDrawingState.setInteraction(drawingState, {
		fluidsTool: "flow-arrow",
		phase: FLOW_ARROW_PHASE,
		flowArrowHost: session.hostId,
		flowArrowFraction: shown.fraction,
		flowArrowStyle: session.style,
		preview: {
			type: "flow-arrow",
			...shown
		},
		snapGeometry: []
	});
}

/*
 * COMMIT THE SESSION.
 *
 * The release creates one arrow at the fraction the drag settled on, as one
 * undoable change, and leaves the tool armed for the next. The preview is
 * cleared and the arrow is selected, exactly as every other Fluids commit does.
 */
export function commitFlowArrowSession(session) {
	if (!session?.flowArrow || !session.hostId) {
		return null;
	}

	/*
	 * A HOST THAT WENT AWAY DURING THE GESTURE COMMITS NOTHING.
	 *
	 * The arrow is defined by its pipe, so an arrow whose pipe was deleted
	 * mid-drag would be an attachment to nothing. The preview is cleared and the
	 * tool stays armed; no object is created.
	 */
	const host = (drawingState.objects || []).find((object) => object.id === session.hostId);

	if (!host || !enggPipeDuct.isPipeDuctType(host.type)) {
		enggDrawingState.setInteraction(drawingState, {
			fluidsTool: "flow-arrow",
			phase: "idle",
			preview: null,
			snapGeometry: []
		});

		renderCurrentDrawing();

		return null;
	}

	/*
	 * AN ARROW ALREADY THERE IS NOT PLACED A SECOND TIME. The press refuses an
	 * exact duplicate, but the release is the last word - a session that began
	 * at one fraction and ended on top of an existing arrow is the same
	 * indication twice.
	 */
	const duplicate = (drawingState.objects || []).find(
		(object) =>
			enggFlowArrow.isFlowArrowType(object.type) &&
			enggFlowArrow.isDuplicatePlacement(object, session.hostId, session.fraction)
	);

	if (duplicate) {
		enggDrawingState.setInteraction(drawingState, {
			fluidsTool: "flow-arrow",
			phase: "idle",
			preview: null,
			snapGeometry: []
		});

		enggDrawingState.selectObject(drawingState, duplicate.id);

		renderProperties();
		renderCurrentDrawing();

		return null;
	}

	const previousObjects = enggDrawingState.snapshotDrawing(drawingState);

	const arrow = enggFlowArrow.createFlowArrow(session.hostId, {
		fraction: session.fraction,
		style: session.style
	});

	if (!arrow) {
		return null;
	}

	/* The arrow hangs off its host, so deleting the host deletes the arrow. */
	arrow.parentId = session.hostId;

	enggDrawingState.addObject(drawingState, arrow);

	enggDrawingState.commitDrawingChange(drawingState, previousObjects);

	enggDrawingState.clearInteraction(drawingState);

	enggDrawingState.selectObject(drawingState, arrow.id);

	setToolMessage(`${arrow.name} placed`);

	renderProperties();
	renderCurrentDrawing();

	/* The tool stays armed: the next press places another arrow. */
	return arrow;
}

/* ============================================================
 * THE FREE FLOW ARROW
 * ============================================================
 *
 * The Flow Arrow tool places a FREE directional arrow - tail to tip - exactly
 * as the requirement describes it. It is its own object (`flow-arrow` with a
 * span and no attachment), so it is listed, selectable, editable, saveable and
 * undoable like every other feature.
 *
 * THE PRESS DECIDES WHAT THE GESTURE MEANS:
 *
 *   ON A FLOW ARROW ALREADY THERE   select it (so a second click edits, not adds)
 *   ON A PIPE                       the attached flow-direction indicator, as
 *                                   before - an arrow riding the run's centreline
 *   ANYWHERE ELSE                   a free arrow, drawn from the press
 *
 * That keeps the pipe-attached indicator working exactly as it did while making
 * the tool produce a real, editable arrow everywhere else - which is what
 * "no object outside a pipe" was missing.
 */
export function beginFreeArrowSession(event, resolution) {
	if (event && event.button !== 0) {
		return false;
	}

	const raw = resolution?.rawPointerPoint;

	if (!raw) {
		return false;
	}

	/*
	 * AN ARROW UNDER THE PRESS IS SELECTED, NOT DUPLICATED. A second arrow drawn
	 * on top of the first would be two arrows describing one flow direction.
	 */
	const existing = objectAtPoint(raw);

	if (existing && enggFlowArrows.isFreeFlowArrowType(existing.type) && existing.attachment == null) {
		enggDrawingState.selectObject(drawingState, existing.id);

		renderFeatures();
		renderProperties();
		renderCurrentDrawing();

		return true;
	}

	editorState.creationDrag = {
		pointerId: event?.pointerId,
		freeArrow: true,
		start: { x: raw.x, y: raw.y },
		startScreen: {
			x: event?.clientX ?? 0,
			y: event?.clientY ?? 0
		},
		style: { ...(drawingState.styleDefaults || {}) },
		moved: false
	};

	return true;
}

/*
 * THE FREE ARROW'S LIVE PREVIEW.
 *
 * The arrow is the real shape from the real model - `span` plus a drawn head -
 * so the preview cannot differ from the committed feature. A press with no
 * travel previews the default-length arrow, which is what a release there
 * commits.
 */
function freeArrowSpanFor(point, start) {
	const length = Math.hypot(point.x - start.x, point.y - start.y);

	if (length < 1e-6) {
		return enggFlowArrows.defaultFreeArrow(start);
	}

	return { start: { ...start }, end: { x: point.x, y: point.y } };
}

export function moveFreeArrowSession(session, point) {
	if (!session?.freeArrow || !point) {
		return;
	}

	const span = freeArrowSpanFor(point, session.start) || enggFlowArrows.defaultFreeArrow(session.start);

	session.previewEnd = span.end;

	enggDrawingState.setInteraction(drawingState, {
		fluidsTool: "flow-arrow",
		phase: FLOW_ARROW_PHASE,
		preview: {
			id: "flow-arrow-preview",
			type: enggFlowArrows.FREE_FLOW_ARROW_TYPE,
			geometry: { start: span.start, end: span.end },
			style: session.style
		},
		snapGeometry: []
	});
}

/*
 * COMMIT THE FREE ARROW.
 *
 * One undoable change, the new arrow selected, and the tool left armed so the
 * next press draws another - the same lifecycle every Fluids placement tool has.
 */
export function commitFreeArrowSession(session, point) {
	if (!session?.freeArrow || !session.start) {
		return null;
	}

	const end = point || session.previewEnd || null;

	const span = end ? freeArrowSpanFor(end, session.start) : enggFlowArrows.defaultFreeArrow(session.start);

	if (!span) {
		return null;
	}

	const previousObjects = enggDrawingState.snapshotDrawing(drawingState);

	const arrow = enggFlowArrows.createFreeFlowArrow(span.start, span.end, {
		style: { ...(session.style || {}) }
	});

	if (!arrow) {
		return null;
	}

	enggDrawingState.addObject(drawingState, arrow);

	enggDrawingState.commitDrawingChange(drawingState, previousObjects);

	const committed = drawingState.objects.find((object) => object.id === arrow.id) || arrow;

	enggDrawingState.setInteraction(drawingState, {
		fluidsTool: "flow-arrow",
		phase: "idle",
		preview: null,
		snapGeometry: []
	});

	enggDrawingState.selectObject(drawingState, committed.id);

	setToolMessage(`${committed.name} created - press and drag to draw another`);

	renderFeatures();
	renderProperties();
	renderCurrentDrawing();

	return committed;
}

/*
 * CANCEL THE SESSION AND THE TOOL.
 *
 * Escape during a drag abandons the preview and returns to Select, leaving
 * nothing behind - the same answer every Fluids tool gives.
 */
export function cancelFlowArrowConstruction() {
	enggDrawingState.clearInteraction(drawingState);

	enggDrawingState.setActiveTool(drawingState, "select");

	setToolMessage("Select geometry");

	renderProperties();
	renderCurrentDrawing();
}

/*
 * ESCAPE DURING A GESTURE.
 *
 * The drag is abandoned and the drawing goes back to Select, leaving nothing
 * behind - the answer every Fluids tool gives. It is separate from the cancel
 * above only in that it does not print the Select tool's own message over a
 * gesture that never committed anything worth announcing.
 */
export function abandonFlowArrowSession() {
	enggDrawingState.clearInteraction(drawingState);

	enggDrawingState.setActiveTool(drawingState, "select");

	renderProperties();
	renderCurrentDrawing();
}

const enggFlowArrowTool = {
	FLOW_ARROW_PHASE,
	PIPE_GRAB_PIXELS,

	pipeGrabTolerance,
	projectOntoRun,
	pipeAtPoint,
	beginFlowArrowConstruction,
	resumeFlowArrowConstruction,
	beginFlowArrowSession,
	beginFreeArrowSession,
	flowArrowPreview,
	moveFlowArrowSession,
	moveFreeArrowSession,
	commitFreeArrowSession,
	commitFlowArrowSession,
	cancelFlowArrowConstruction,
	abandonFlowArrowSession
};

export default enggFlowArrowTool;
