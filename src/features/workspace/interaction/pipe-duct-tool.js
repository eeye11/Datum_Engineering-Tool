/*
 * ========================================================
 * DRAWING PIPE / DUCT BY CLICK, HOLD, DRAG AND RELEASE
 * ========================================================
 *
 * This is the interaction layer for the Fluids flow paths. It owns ONE
 * gesture and the two features that gesture can produce:
 *
 *   pipe-duct   a straight run, from the press to the release
 *   elbow       a fitting generated automatically at a supported corner
 *
 * ========================================================
 * WHY CLICK-HOLD-DRAG, AND WHY IT REUSES THE SHARED MACHINERY
 * ========================================================
 *
 * The requirement is explicit: a straight run must be drawn by pressing,
 * holding and dragging - NOT by an unrelated start-click and end-click. That
 * is already a FIRST-CLASS gesture in DAETUM: `creation-drag.js` gives every
 * applicable creation tool the press-hold-release lifetime, routing it through
 * the same `beginOrCompleteGeometry` entry point a click uses, so snapping,
 * inference, the live preview and the single undo entry all come for free.
 *
 * So this module does NOT reimplement any of that. It supplies the two things
 * the shared pipeline cannot know:
 *
 *   1. WHAT the run being dragged looks like - its two boundary lines, at the
 *      fixed narrow schematic spacing (see `routeSegmentPreview`). The
 *      preview is the feature's OWN geometry, not an approximation of it, so
 *      the drawing cannot jump on release.
 *
 *   2. WHAT to do when a run is committed - create it as a Pipe / Duct, and
 *      evaluate the corner it makes with the run before it, generating an
 *      Elbow feature when the corner is a supported 45 or 90 (see
 *      `commitRouteSegment`).
 *
 * ========================================================
 * THE CONTINUOUS PATH IS AN OPERATION SEQUENCE, NOT A CONTAINER
 * ========================================================
 *
 * After a run is committed the tool stays armed and keeps the run's FAR
 * endpoint as the next run's start, so a student who keeps dragging from that
 * point draws a continuous path. Each leg is a SEPARATE top-level feature and
 * each supported corner a separate Elbow feature - exactly the flat list the
 * requirement asks for. Nothing is grouped, parented or folded; the
 * continuation is remembered on the interaction and dies with it.
 *
 * THE CONTINUATION ONLY FOLLOWS A REAL SNAP. A student who drags the next leg
 * from a point that is NOT the previous run's endpoint starts a NEW path,
 * because the two are not connected - see `resolveRouteStart`. Connectivity is
 * never inferred from two runs merely being near each other.
 *
 * ========================================================
 * FINISHING AND CANCELLING
 * ========================================================
 *
 * The tool follows DAETUM's established multi-point conventions: a double-click
 * (or Enter) finishes the path - committing the run under the pointer - and
 * Escape abandons the active preview, leaving previously committed runs
 * untouched. Because every run is committed the moment the button is released,
 * there is never a half-built path to clean up: cancelling only drops the
 * preview of the leg being dragged.
 */
import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggPipeDuct from "../model/fluids/pipe-duct.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { drawingState } from "../editor-state.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { activeCategory } from "../../../components/layout/toolbar/tool-menus.js";
import { renderEngineeringTools, setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";

/*
 * The interaction phase a Pipe / Duct run under construction uses.
 *
 * Named once, so the drag lifetime, the preview, the pointer resolver and the
 * keyboard all ask the same string. It is set while the student is HOLDING the
 * button and dragging a leg, and cleared the moment that leg is released.
 */
export const ROUTE_PHASE = "pipe-duct-construct";

/*
 * How close the press must be, in WORLD units, to a committed run's endpoint
 * before this leg CONTINUES that run rather than starting a new one.
 *
 * This is deliberately the same order as the shared endpoint snap tolerance:
 * a student who pressed exactly on the endpoint - which the snap indicator
 * showed them - continues the path, and a student who pressed in open space
 * begins a new one. It is not an engineering tolerance; it is the answer to
 * "did the student mean to carry on from where they left off".
 *
 * The press point arrives SNAPPED, so a press that an endpoint snap pulled
 * onto a port has already been moved exactly onto it; this constant only
 * covers a resolver that returned the raw point because nothing was within
 * the snap tolerance at all.
 */
export const CONTINUATION_TOLERANCE = 1e-6;

/*
 * ========================================================
 * BEGIN
 * ========================================================
 *
 * Arming the tool does NOT begin a construction. Unlike the Truss and the
 * Polyline - which wait for a first click - a Pipe / Duct run is defined by a
 * PRESS, so the tool arms itself idle and lets `creation-drag.js` start the
 * gesture when the button actually goes down.
 *
 * The interaction is cleared rather than set to the route phase, because a
 * route phase with no press behind it would make the pointer resolver and the
 * click router believe a construction was running when it was not.
 */
export function beginRouteConstruction() {
  /*
   * THE RUN TOOL IS THE ACTIVE TOOL, so the sidebar button that started it is
   * the one that lights. Without this the message said "Press and drag…" while
   * no button was marked, and Escape had no active tool to return from.
   */
  enggDrawingState.setActiveTool(drawingState, "pipe-duct");

  enggDrawingState.setInteraction(drawingState, {
    fluidsTool: "pipe-duct"
  });

  setToolMessage("Press and drag to draw a Pipe / Duct");

  renderCurrentDrawing();
}

/*
 * ========================================================
 * RESOLVE THE START OF A LEG
 * ========================================================
 *
 * Where does this leg begin? Two answers, and the difference is connectivity.
 *
 *   CONTINUING  the press landed on the previous leg's own far endpoint, so
 *               this leg is a genuine continuation of the path. It begins
 *               exactly there and will be joined to the previous leg.
 *
 *   NEW PATH    the press landed anywhere else. This leg begins where the
 *               student pressed and is NOT connected to anything.
 *
 * It returns `{ start, previous }`, where `previous` is the committed run this
 * leg continues - or null when it is a fresh start. The press point is used
 * AS RESOLVED (already snapped), so a run that the snap pulled onto a port
 * starts on that port and connects without a gap.
 */
export function resolveRouteStart(pressPoint, objects = drawingState.objects) {
  if (!pressPoint) {
    return { start: null, previous: null };
  }

  /*
   * THE MOST RECENT FLUID RUN IS THE CANDIDATE. A continuous path is being
   * drawn now, so the thing a student means to carry on from is the run they
   * just placed - not an older one they happened to leave an endpoint near.
   */
  const runs = (objects || []).filter((object) =>
    enggPipeDuct.isPipeDuctType(object.type)
  );

  const previous = runs.length ? runs[runs.length - 1] : null;

  if (previous) {
    const end = previous.geometry?.end;

    if (
      end &&
      Math.hypot(end.x - pressPoint.x, end.y - pressPoint.y) <=
        CONTINUATION_TOLERANCE
    ) {
      return { start: { x: end.x, y: end.y }, previous };
    }
  }

  return { start: { x: pressPoint.x, y: pressPoint.y }, previous: null };
}

/*
 * ========================================================
 * THE LIVE PREVIEW OF THE LEG BEING DRAGGED
 * ========================================================
 *
 * This is the geometry the preview draws, and it is the SAME geometry the
 * committed feature will have - so the two boundary lines do not move when the
 * button is released.
 *
 * It returns a `pipe-duct`-shaped geometry: the resolved centreline plus the
 * cross-section the feature is being drawn with, from which the renderer
 * derives both boundary lines (see `renderer.js`). `start` and `end` are the
 * two ends; `engineering` carries the shape and size that decide their
 * separation.
 */
export function routeSegmentPreview(interaction, cursorPoint) {
  const start =
    interaction?.routeSegmentStart ||
    interaction?.startPoint ||
    interaction?.routeResolvedStart ||
    null;

  if (!start || !cursorPoint) {
    return null;
  }

  /*
   * A leg shorter than a pixel is not a run yet, so nothing is previewed -
   * which is what keeps a stray press from flashing a zero-length feature.
   */
  if (Math.hypot(cursorPoint.x - start.x, cursorPoint.y - start.y) < 1e-6) {
    return null;
  }

  return {
    start: { x: start.x, y: start.y },
    end: { x: cursorPoint.x, y: cursorPoint.y },
    engineering:
      interaction.routeEngineering ||
      enggPipeDuct.defaultPipeEngineering()
  };
}

/*
 * ========================================================
 * THE MESSAGE WHILE A LEG IS BEING DRAWN
 * ========================================================
 *
 * It names the current step, and - on every leg after the first - tells the
 * student how to finish, because a path may have as many bends as they want.
 * The wording is written for the person using it, in the same voice as every
 * other tool's instruction.
 */
export function routeInstruction(interaction) {
  const committed = Number(interaction?.routeCommittedCount) || 0;

  if (committed > 0) {
    return (
      "Drag to add the next Pipe / Duct run, or double-click / Enter to finish"
    );
  }

  return "Press and drag to draw a Pipe / Duct";
}

/*
 * ========================================================
 * THE SNAP GEOMETRY A LEG PUBLISHES
 * ========================================================
 *
 * Handed to the shared snap resolver, so the moving end of a leg snaps to the
 * start of the leg, to a run already placed, or to a corner - using exactly
 * the candidates, tolerance and indicators every other construction publishes.
 *
 * It publishes the leg's CENTRELINE as a single span. It does NOT publish the
 * two boundary lines: they are derived from the centreline, so publishing them
 * would offer three places to aim at for one logical endpoint, which is the
 * "snap on the two boundary lines must not create conflicting feature
 * endpoints" rule.
 */
export function routeSnapGeometry(interaction, cursorPoint) {
  const preview = routeSegmentPreview(interaction, cursorPoint);

  return preview
    ? [{ start: preview.start, end: preview.end }]
    : [];
}

/*
 * ========================================================
 * COMMIT ONE LEG
 * ========================================================
 *
 * Called when the student releases the button on a leg. It:
 *
 *   1. creates the run as its own Pipe / Duct feature;
 *   2. if this leg CONTINUES the previous run, evaluates the corner they make
 *      and, for a supported 45 or 90, creates an Elbow feature between them;
 *   3. records the run's far endpoint as the next leg's start, so another drag
 *      from there carries the path on;
 *   4. commits the whole thing as ONE undoable operation.
 *
 * Returns a summary, or null when nothing could be created (a zero-length
 * leg, which is not a run).
 */
export function commitRouteSegment(start, end, interaction = {}) {
  if (!start || !end) {
    return null;
  }

  if (Math.hypot(end.x - start.x, end.y - start.y) < 1e-9) {
    return null;
  }

  const previousRun = interaction.previousRun || null;

  const engineering =
    interaction.routeEngineering || enggPipeDuct.defaultPipeEngineering();

  /*
   * THE SNAPSHOT IS TAKEN BEFORE ANYTHING EXISTS, so undoing this release
   * removes the run AND any elbow generated with it in one step - the coherent
   * operation the requirement asks for.
   */
  const previousObjects = enggDrawingState.snapshotDrawing(drawingState);

  const run = enggPipeDuct.createPipeDuct(start, end, {
    style: { ...drawingState.styleDefaults },
    engineering
  });

  if (!run) {
    return null;
  }

  enggDrawingState.addObject(drawingState, run);

  const created = [run];

  /*
   * ========================================================
   * THE CORNER, AND THE ELBOW IT MAY EARN
   * ========================================================
   *
   * A corner exists only where this leg CONTINUES the previous run: two runs
   * that merely touch, or cross, are not a path. When they are joined, the
   * direction change is measured from the three centreline points and, if it
   * is a supported 45 or 90, an Elbow is generated between them.
   */
  let elbow = null;

  if (previousRun) {
    /*
     * DIRECTLY JOINED RUNS ARE ONE WIDTH, whether the join is straight or
     * angled. This runs BEFORE the elbow is decided, so the two runs already
     * agree by the time a fitting reads their widths.
     */
    adoptPipeWidth(previousRun, run);

    elbow = generateElbowFor(previousRun, run, engineering);

    if (elbow) {
      enggDrawingState.addObject(drawingState, elbow);
      created.push(elbow);
    }
  }

  enggDrawingState.commitDrawingChange(drawingState, previousObjects);

  /*
   * THE DOCUMENT OWNS THE OBJECTS FROM HERE.
   *
   * Committing a change replaces the objects with the drawn copies - the ones
   * Undo and the source are keyed on - so the trim must be applied to THOSE, and
   * the caller is handed the run as the document now holds it. Using the
   * pre-commit instance afterwards would edit an object the sheet no longer has.
   */
  if (elbow) {
    applyTrimTo(elbow, drawingState.objects);
  }

  const committedRun = drawingState.objects.find((object) => object.id === run.id) || run;

  const committedElbow = elbow
    ? drawingState.objects.find((object) => object.id === elbow.id) || elbow
    : null;

  /*
   * THE PATH CONTINUES FROM THIS RUN's FAR END. Held on the interaction so the
   * next drag from that point joins on; a drag from anywhere else starts a new
   * path (see resolveRouteStart).
   */
  enggDrawingState.setInteraction(drawingState, {
    fluidsTool: "pipe-duct",
    phase: "idle",
    previousRun: committedRun,
    routeEngineering: engineering,
    routeCommittedCount:
      (Number(interaction.routeCommittedCount) || 0) + 1,
    preview: null,
    startPoint: null,
    routeSegmentStart: null,
    snapGeometry: []
  });

  setToolMessage(
    elbow
      ? `${committedRun.name} and ${committedElbow.name} created - drag to continue, or Enter to finish`
      : `${committedRun.name} created - drag to continue, or Enter to finish`
  );

  renderProperties();
  renderCurrentDrawing();

  return { run: committedRun, elbow: committedElbow, created };
}

/*
 * ========================================================
 * GENERATE THE ELBOW AT A SUPPORTED CORNER
 * ========================================================
 *
 * Two committed runs meeting end-to-end make a corner. This measures the
 * direction change and, when it is a supported 45 or 90, builds a separate
 * Elbow feature between them.
 *
 * ========================================================
 * NOT TWO RUNS, ONE ELBOW EACH
 * ========================================================

 *
 * An elbow is generated ONCE, when the second of the two runs is committed.
 * It is never regenerated by re-running this for the same pair, so repeated
 * editing cannot create duplicate or orphaned elbows. If a corner that once
 * had an elbow later becomes an unsupported angle, the elbow is removed by
 * `removeElbowsAt` - the single place a fitting is taken away.
 *
 * ========================================================
 * THE ELBOW'S PROPERTIES COME FROM THE RUNS, ONCE
 * ========================================================
 *
 * Its cross-section is COPIED from the first compatible adjoining run and
 * stored on the elbow; the bend radius starts unset, because DAETUM has no
 * established default (see pipe-duct.js). Nothing here maintains a live
 * inheritance link - the values are the elbow's own from the moment it is
 * made, which is exactly what the flat feature model requires.
 */
export function generateElbowFor(previousRun, run, engineering) {
  if (!previousRun || !run) {
    return null;
  }

  /*
   * ONE ELBOW PER PAIR OF RUNS. If these two are already joined - the student
   * snapped the same pipes together twice - the fitting is refreshed by
   * `refreshFluidConnections` rather than a second one being added on top of
   * the first.
   */
  const existing = (drawingState.objects || []).find(
    (object) =>
      enggPipeDuct.isElbowType(object.type) &&
      Array.isArray(object.engineering?.connections) &&
      previousRun.id &&
      run.id &&
      object.engineering.connections.includes(previousRun.id) &&
      object.engineering.connections.includes(run.id)
  );

  if (existing) {
    refreshFluidConnections(run, drawingState.objects);

    return null;
  }

  const before = previousRun.geometry?.start;
  const vertex = previousRun.geometry?.end;
  const after = run.geometry?.end;

  if (!before || !vertex || !after) {
    return null;
  }

  /*
   * The two runs must actually meet at the corner. Without this a pair of runs
   * that merely ended near each other would be read as a corner, which is the
   * "connectivity is not coincidence" rule applied to fitting generation.
   */
  const joinGap = Math.hypot(
    vertex.x - run.geometry.start.x,
    vertex.y - run.geometry.start.y
  );

  if (joinGap > CONTINUATION_TOLERANCE) {
    return null;
  }

  const angleDegrees = enggPipeDuct.cornerAngleDegrees(before, vertex, after);

  const angle = enggPipeDuct.supportedElbowAngle(angleDegrees);

  if (angle === null) {
    return null;
  }

  /*
   * THE FITTING RECORDS THE TWO RUNS IT JOINS, by ID. That is the connection:
   * the elbow's geometry is derived from those runs' ACTUAL endpoints, so when
   * either is moved or deleted the fitting is rebuilt or removed from the
   * relationship rather than guessed at from proximity.
   */
  const elbowEngineering = {
    angle,
    angleDegrees,
    bendRadius: fittingRadiusFor(previousRun, run),
    connections: [previousRun.id, run.id],

    /*
     * HOW FAR THE BEND EATS INTO EACH RUN. The tangent distance, so the runs
     * can be shortened by exactly the length the arcs take over.
     */
    bendTrim: fittingTrimFor(
      previousRun,
      run,
      fittingRadiusFor(previousRun, run)
    )
  };

  /*
   * ========================================================
   * THE FITTING INHERITS ITS APPEARANCE - ONCE
   * ========================================================
   *
   * A bend generated at a corner is part of the same line of pipework, so it
   * STARTS with the appearance of the run it was joined to: the same line
   * style, outline colour, thickness and fill. The values are COPIED here, at
   * the moment of creation, and are the elbow's own from then on - nothing
   * reads the runs again, so a later edit to either side cannot silently
   * overwrite an appearance the student has changed on the fitting, and vice
   * versa.
   *
   * The FIRST run is the source when the two disagree. It is the run already on
   * the sheet - the one the new leg was drawn from - so the fitting looks like
   * the pipework it continues rather than like the segment just added.
   */
  const inheritedStyle = { ...(previousRun.style || drawingState.styleDefaults) };

  const elbow = enggDrawingState.createGeometryObject(
    "elbow",
    {
      position: { x: vertex.x, y: vertex.y },
      previous: { x: before.x, y: before.y },
      next: { x: after.x, y: after.y }
    },
    {
      style: inheritedStyle,
      engineering: elbowEngineering
    }
  );

  if (elbow) {
    /*
     * THE RUNS STOP WHERE THE BEND BEGINS. Applied the moment the fitting exists,
     * so the straight walls and the arcs meet at the tangent points rather than
     * running over the corner.
     */
    applyTrimTo(elbow, [...(drawingState.objects || []), elbow]);
  }

  return elbow;
}

/*
 * ========================================================
 * PIPE WIDTH ACROSS A DIRECT CONNECTION
 * ========================================================
 *
 * Pipes joined end-to-end are ONE run of pipework, so they share one width:
 * the second adopts the first's, and the separation between its walls changes
 * while its centreline does not. An elbow (or a junction) is the boundary at
 * which two runs may legitimately differ, so this is never applied ACROSS a
 * fitting - only between the two runs that meet at a direct join.
 */
export function adoptPipeWidth(source, target) {
  if (!source || !target) {
    return false;
  }

  const width = Number(source.engineering?.separation) || 0;
  const current = Number(target.engineering?.separation) || 0;

  if (width === current) {
    return false;
  }

  target.engineering = { ...(target.engineering || {}) };

  if (width === 0) {
    delete target.engineering.separation;
  } else {
    target.engineering.separation = width;
  }

  return true;
}

/*
 * ========================================================
 * THE RADIUS A GENERATED FITTING STARTS WITH
 * ========================================================
 *
 * A bend radius is a distance along the two runs, and an elbow whose tangent
 * points would fall past either run's far end cannot be drawn at all - the
 * shared `elbowGeometry` refuses it. So the default is CLAMPED to what the
 * corner can hold: a proportion of the shorter adjoining run.
 *
 * A scale-relative default (twice the schematic separation) is tried first;
 * when the runs are shorter than that, the bend shrinks to fit. A very short
 * leg therefore gets a small bend instead of no fitting, which is the honest
 * drawing: something bends at that corner, and the panel can change it.
 */
export const FITTING_RADIUS_RUN_FRACTION = 0.25;

function fittingTrimFor(previousRun, run, radius) {
  const start = previousRun?.geometry?.start;
  const vertex = previousRun?.geometry?.end;
  const end = run?.geometry?.end;

  if (!start || !vertex || !end || !Number.isFinite(radius)) {
    return 0;
  }

  const angle = enggPipeDuct.cornerAngleDegrees(start, vertex, end);

  return angle === null ? 0 : radius * Math.tan((angle * Math.PI) / 360);
}

function fittingRadiusFor(previousRun, run) {
  const start = previousRun?.geometry?.start;
  const vertex = previousRun?.geometry?.end;
  const end = run?.geometry?.end;

  if (!start || !vertex || !end) {
    return enggPipeDuct.readDefaultBendRadius();
  }

  const shorter = Math.min(
    Math.hypot(vertex.x - start.x, vertex.y - start.y),
    Math.hypot(end.x - vertex.x, end.y - vertex.y)
  );

  const preferred =
    enggPipeDuct.readDefaultBendRadius() ??
    enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION * 2;

  /*
   * The catch: `elbowGeometry` trims `radius * tan(angle / 2)` from each run,
   * which for a 45 degree turn is about 0.414 of the radius. Scaling by the
   * shorter run keeps the tangent points well inside both.
   */
  const limited = Math.max(shorter * FITTING_RADIUS_RUN_FRACTION, 1e-6);

  return Math.min(preferred, limited);
}

/*
 * ========================================================
 * KEEPING THE FITTINGS IN STEP WITH THE RUNS
 * ========================================================
 *
 * An elbow is generated once, when the second run of a corner is committed.
 * After that it is its own feature - but it must never be left behind when the
 * geometry it joins changes underneath it. Three edits can break a fitting:
 *
 *   AN ENDPOINT MOVES   the corner angle changes (a 90 becomes a 45, or an
 *                       arbitrary angle), or the runs no longer meet.
 *   A RUN MOVES         its body drag keeps its shape, so the corner simply
 *                       follows; the elbow's stored points must follow too.
 *   A RUN IS DELETED     the fitting has nothing left to join.
 *
 * `refreshFluidConnections` answers all three the same way: it rebuilds the
 * elbow from the CURRENT geometry of the two runs it joins, and removes it when
 * the corner is no longer a real, supported one. Rebuilding rather than
 * patching means there is one statement of the connection - the two runs -
 * and no second copy of it on the fitting to drift.
 *
 * IT NEVER DUPLICATES. An existing elbow is found by the pair of runs it
 * records, not by its position, so snapping the same two pipes together again
 * refreshes the one elbow that is there instead of adding another.
 */

/* The run an elbow joins at one of its ends, from the elbow's own record. */
export function connectedRunsOf(elbow, objects = drawingState.objects) {
  const ids = elbow?.engineering?.connections;

  if (!Array.isArray(ids) || ids.length !== 2) {
    return [];
  }

  return ids.map((id) => (objects || []).find((object) => object.id === id) || null);
}

/* The corner an elbow fits, or null when the runs no longer make one. */
export function cornerOf(elbow, objects = drawingState.objects) {
  const [first, second] = connectedRunsOf(elbow, objects);

  if (!first || !second) {
    return null;
  }

  const before = first.geometry?.start;
  const vertex = first.geometry?.end;
  const after = second.geometry?.end;

  if (!before || !vertex || !after) {
    return null;
  }

  /*
   * THE RUNS MUST STILL MEET. An endpoint dragged away from the joint leaves two
   * runs that only happen to be near each other, and two runs that do not meet
   * are not a corner however close their angles are.
   */
  const gap = Math.hypot(vertex.x - second.geometry.start.x, vertex.y - second.geometry.start.y);

  if (gap > CONTINUATION_TOLERANCE) {
    return null;
  }

  const angleDegrees = enggPipeDuct.cornerAngleDegrees(before, vertex, after);
  const angle = enggPipeDuct.supportedElbowAngle(angleDegrees);

  return angle === null ? null : { before, vertex, after, angle, angleDegrees };
}

/*
 * ========================================================
 * ONE WIDTH ALONG A DIRECTLY CONNECTED RUN
 * ========================================================
 *
 * A student widens a pipe and expects the pipe to get wider - not one segment
 * of it. So a width change spreads along everything DIRECTLY joined to it:
 *
 *     A ---- B           A and B are one run: they share a width.
 *     A --(elbow)-- B    the elbow is the boundary: A and B may differ.
 *
 * THE WALK STOPS AT AN ELBOW. That is the whole rule, and it is enforced by
 * following only ENDS THAT MEET ANOTHER END with no fitting between them. An
 * elbow is not followed through, so the runs on its far side keep whatever
 * width they had - which is what lets a fitting divide two widths.
 *
 * It never changes appearance and never moves a centreline: only
 * `engineering.separation` is written, so the walls open around the same line.
 */
export function propagatePipeWidth(run, objects = drawingState.objects) {
  if (!run?.id || !Array.isArray(objects)) {
    return [];
  }

  const runs = objects.filter((object) => enggPipeDuct.isPipeDuctType(object.type));
  const elbows = objects.filter(
    (object) => enggPipeDuct.isElbowType(object.type) && Array.isArray(object.engineering?.connections)
  );

  /* An end that carries a fitting stops the walk there. */
  const joinedAt = (candidate, end) =>
    elbows.some((elbow) => {
      const ids = elbow.engineering.connections;

      if (!ids.includes(run.id) || !ids.includes(candidate.id)) {
        return false;
      }

      const shared = elbow.geometry?.position;
      const point = candidate.geometry?.[end];

      return (
        shared &&
        point &&
        Math.hypot(shared.x - point.x, shared.y - point.y) <= CONTINUATION_TOLERANCE
      );
    });

  const visited = new Set([run.id]);
  const queue = [run];
  const width = Number(run.engineering?.separation) || 0;

  while (queue.length) {
    const current = queue.pop();

    ["start", "end"].forEach((end) => {
      if (joinedAt(current, end)) {
        return;
      }

      const point = current.geometry?.[end];

      if (!point) {
        return;
      }

      runs.forEach((candidate) => {
        if (visited.has(candidate.id)) {
          return;
        }

        const other = ["start", "end"].find(
          (candidateEnd) =>
            candidate.geometry?.[candidateEnd] &&
            Math.hypot(
              candidate.geometry[candidateEnd].x - point.x,
              candidate.geometry[candidateEnd].y - point.y
            ) <= CONTINUATION_TOLERANCE
        );

        if (!other) {
          return;
        }

        visited.add(candidate.id);
        queue.push(candidate);

        if ((Number(candidate.engineering?.separation) || 0) !== width) {
          candidate.engineering = { ...(candidate.engineering || {}) };

          if (width === 0) {
            delete candidate.engineering.separation;
          } else {
            candidate.engineering.separation = width;
          }
        }
      });
    });
  }

  return [...visited].filter((id) => id !== run.id);
}

/*
 * Rebuild every elbow that joins this run, and drop the ones whose corner no
 * longer exists.
 *
 * Answers the fittings that were updated and the ones that were removed, so a
 * caller can report what happened rather than guessing.
 */
export function refreshFluidConnections(run, objects = drawingState.objects) {
  if (!run?.id || !Array.isArray(objects)) {
    return { updated: [], removed: [] };
  }

  const elbows = objects.filter(
    (object) =>
      enggPipeDuct.isElbowType(object.type) &&
      Array.isArray(object.engineering?.connections) &&
      object.engineering.connections.includes(run.id)
  );

  const updated = [];
  const removed = [];

  elbows.forEach((elbow) => {
    const corner = cornerOf(elbow, objects);

    if (!corner) {
      /*
       * THE BEND IS GOING, SO ITS TRIMS GO WITH IT - before the elbow is
       * removed, while the runs it names can still be found.
       */
      clearTrimFrom(elbow, objects);

      if (removeObjectIfPresent(elbow)) {
        removed.push(elbow.id);
      }

      return;
    }

    elbow.geometry = {
      ...(elbow.geometry || {}),
      position: { x: corner.vertex.x, y: corner.vertex.y },
      previous: { x: corner.before.x, y: corner.before.y },
      next: { x: corner.after.x, y: corner.after.y }
    };

    elbow.engineering = {
      ...(elbow.engineering || {}),
      angle: corner.angle,
      angleDegrees: corner.angleDegrees
    };

    applyTrimTo(elbow, objects);

    updated.push(elbow.id);
  });

  return { updated, removed };
}

/*
 * ========================================================
 * WITHDRAWING A FITTING GIVES THE RUNS THEIR STRAIGHT LENGTH BACK
 * ========================================================
 *
 * A run stores how far each end is trimmed back for the bend that end carries.
 * When the bend is removed - the corner stopped being supported, the runs came
 * apart, the pipe was deleted - the trim must go with it, or the run would be
 * left ending short in mid-air for a fitting that is no longer there.
 */
function clearTrimFrom(elbow, objects = drawingState.objects) {
  connectedRunsOf(elbow, objects).forEach((run) => {
    if (run?.geometry?.trims) {
      delete run.geometry.trims;
    }
  });
}

/*
 * ========================================================
 * TRIMMING THE RUNS BACK TO THE BEND
 * ========================================================
 *
 * The elbow's `trim` is how far its tangent point sits from the corner along
 * each run. Each run is shortened by exactly that at the end the elbow joins,
 * so the straight walls stop where the arcs begin.
 *
 * WHICH END OF WHICH RUN. The elbow joins the FIRST run at that run's `end`
 * (the corner is its far end) and the SECOND run at that run's `start` (it was
 * drawn out of the corner). That is the direction the path was drawn, and it is
 * recorded here rather than guessed from which end is nearer the corner - a run
 * may pass through the corner's neighbourhood and still be joined at one
 * specific end.
 */
function applyTrimTo(elbow, objects = drawingState.objects) {
  const [first, second] = connectedRunsOf(elbow, objects);
  const trim = Number(elbow?.engineering?.bendTrim);

  if (!first || !second) {
    return;
  }

  /*
   * THE BEND IS DRAWN AT THE WIDTH OF THE RUN AT EACH OF ITS ENDS.
   *
   * An elbow may join two runs of different widths - that is the only place
   * they may differ - so the fitting's two ends take their spacing from the
   * runs they meet. The renderer interpolates between them around the arc, so
   * each border stays continuous with the straight wall it joins instead of
   * stepping at the tangent point.
   */
  elbow.engineering = {
    ...(elbow.engineering || {}),
    startSeparation: enggPipeDuct.boundarySeparation(first.engineering || {}),
    endSeparation: enggPipeDuct.boundarySeparation(second.engineering || {})
  };

  if (!Number.isFinite(trim) || trim <= 0) {
    return;
  }

  first.geometry = {
    ...(first.geometry || {}),
    trims: { ...(first.geometry?.trims || {}), end: trim }
  };

  second.geometry = {
    ...(second.geometry || {}),
    trims: { ...(second.geometry?.trims || {}), start: trim }
  };
}

function removeObjectIfPresent(object) {
  const objects = drawingState.objects || [];
  const index = objects.findIndex((candidate) => candidate.id === object.id);

  if (index < 0) {
    return false;
  }

  /*
   * REMOVED THROUGH THE DOCUMENT'S OWN PATH, so undo, the source and the
   * Features list all see one coherent deletion - not a splice on a copy.
   */
  enggDrawingState.removeObject(drawingState, object.id);

  return true;
}

/*
 * ========================================================
 * FINISH THE PATH
 * ========================================================
 *
 * A double-click or Enter finishes the path. Nothing is half-built - each run
 * was committed on its own release - so finishing only clears the continuation
 * and reports what was drawn. The tool stays armed so the student can begin a
 * fresh path immediately.
 */
export function finishRouteConstruction() {
  const committed = Number(drawingState.interaction.routeCommittedCount) || 0;

  enggDrawingState.setInteraction(drawingState, {
    fluidsTool: "pipe-duct"
  });

  setToolMessage(
    committed
      ? `Path finished - ${committed} Pipe / Duct run${
          committed === 1 ? "" : "s"
        } drawn`
      : "Press and drag to draw a Pipe / Duct"
  );

  renderProperties();
  renderCurrentDrawing();

  return committed;
}

/*
 * ========================================================
 * CANCEL
 * ========================================================
 *
 * Escape abandons the leg being dragged. Because no leg exists as a feature
 * until its release, there is nothing to undo and nothing left behind: no
 * ghost geometry, no orphaned elbow, no half-built path. Previously committed
 * runs remain exactly as they were.
 */
export function cancelRouteConstruction() {
  enggDrawingState.clearInteraction(drawingState);

  enggDrawingState.setActiveTool(drawingState, "select");

  setToolMessage("Select geometry");

  renderEngineeringTools(activeCategory());
  renderProperties();
  renderCurrentDrawing();
}

/*
 * Whether a leg is currently being dragged.
 */
export function isRouteConstructing() {
  return drawingState.interaction?.phase === ROUTE_PHASE;
}

/*
 * ========================================================
 * THE DRAWING DEFAULT FOR A NEW RUN's CROSS-SECTION
 * ========================================================
 *
 * The shape a new run is drawn with. It is held on the interaction so a
 * student can set it before drawing, and it defaults to Circular - the shape a
 * bare "Pipe / Duct" implies, and the one with the simplest size description.
 * It is a DRAWING default, not an engineering standard: the student sets the
 * real value, and the panel edits it per feature.
 */
export function setRouteShape(shape) {
  const resolved =
    shape === enggPipeDuct.PIPE_SHAPES.rectangular
      ? enggPipeDuct.PIPE_SHAPES.rectangular
      : enggPipeDuct.PIPE_SHAPES.circular;

  const engineering = enggPipeDuct.defaultPipeEngineering(resolved);

  enggDrawingState.setInteraction(drawingState, {
    routeEngineering: engineering
  });

  return engineering;
}

const enggPipeDuctTool = {
  ROUTE_PHASE,
  CONTINUATION_TOLERANCE,
  routeInstruction,
  resolveRouteStart,
  routeSegmentPreview,
  routeSnapGeometry,
  commitRouteSegment,
  generateElbowFor,
  cornerOf,
  connectedRunsOf,
  refreshFluidConnections,
  adoptPipeWidth,
  propagatePipeWidth,
  beginRouteConstruction,
  finishRouteConstruction,
  cancelRouteConstruction,
  isRouteConstructing,
  setRouteShape
};

export default enggPipeDuctTool;
