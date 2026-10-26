/*
 * ========================================================
 * DRAWING PIPE / DUCT BY CLICK, HOLD, DRAG AND RELEASE
 * ========================================================
 *
 * This is the interaction layer for the Fluids flow paths. It owns ONE
 * gesture and the two features that gesture can produce:
 *
 *   pipe-duct   a straight run, from the press to the release
 *   elbow       a fitting generated automatically at any corner that turns
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
 *      Elbow feature when the corner turns at ANY angle (see
 *      `commitRouteSegment` and `supportedElbowAngle`).
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
import {
  applyElbowRadius,
  elbowLiveLegs,
  elbowMaxBendRadius,
  setElbowRadiusCollaborators
} from "./elbow-radius.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { drawingState } from "../editor-state.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { activeCategory } from "../../../components/layout/toolbar/tool-menus.js";
import { renderEngineeringTools, setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";
import {
  createJunctionForInteriorConnection,
  setJunctionElbowBuilder
} from "./junction-tool.js";
import { reconcilePipeAssemblies } from "../model/fluids/pipe-assembly.js";

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
 * HOW FAR A JOINED RUN'S LINE MAY MISS ITS BEND'S CORNER, in world units.
 *
 * A joined pipe is re-cut onto its bend's tangent points on every settle, so its
 * held end is exact to within rounding rather than bit-exact - and a bend whose
 * two ends carry different widths places its two tangent points a fraction of a
 * unit either side of the corner. This is the tolerance for "the run's line still
 * passes through the corner'', stated in DRAWING units because it bounds that
 * re-seating error; it has nothing to do with a student's intention, which is
 * what `CONTINUATION_TOLERANCE` answers.
 */
export const JOINED_LINE_OFFSET_TOLERANCE = 0.05;

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
 *      and, for any genuine turn, creates an Elbow feature between them;
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

  /*
   * THE RUN THE PATH CONTINUES FROM, AS THE SHEET HOLDS IT NOW.
   *
   * `interaction.previousRun` is captured when the previous leg is committed, so
   * an edit made to that run afterwards - recolouring it, changing its width - is
   * not in it. The fitting is created from this run, so taking the STALE copy
   * gives the bend the run's appearance from before the edit. The sheet's own
   * instance is the single truth; the captured one is only a fallback for a run
   * that has since been deleted.
   */
  const previousRun = interaction.previousRun
    ? (drawingState.objects || []).find((object) => object.id === interaction.previousRun.id) ||
      interaction.previousRun
    : null;

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
   * THE JOINTS THIS LEG MAKES - EVERY KIND
   * ========================================================
   *
   * The leg may meet the run it CONTINUES (the drawing session's own
   * `previousRun`), and it may equally land on a pipe that was drawn earlier, or
   * on one created after the session began. Both are JOINS, and a join is the
   * only thing that earns a fitting - so the leg goes through exactly the same
   * reconciliation a dragged pipe does. The session's continuation is therefore
   * an optimisation, not the rule: what decides is the geometry.
   *
   * TWO KINDS OF JOIN EXIST, AND BOTH ARE ASKED HERE:
   *
   *   END TO END       a corner, which earns an Elbow
   *   END TO INTERIOR  a branch, which SPLITS THE HOST and earns a Junction
   *
   * Only the first used to be tested, so a branch drawn to the middle of a host
   * produced two overlapping runs with no junction and no split - the second
   * reported failure.
   *
   * THE JUNCTION PASS RUNS FIRST. Making one re-cuts the runs' ends and replaces
   * the host with two halves, so a bend fitted before it would be fitted to runs
   * that no longer exist in that shape.
   *
   * THE SAME WIDTH IS ADOPTED FIRST, so two runs joined end-to-end already agree
   * by the time a fitting reads their widths.
   */
  if (previousRun) {
    adoptPipeWidth(previousRun, run);
  }

  /*
   * THE DOCUMENT'S OWN COPY OF THIS RUN. `addObject` may store a named copy, so
   * the local `run` is not necessarily the instance on the sheet - and the
   * interior scan must exclude the run by ID, not by identity, or it finds the
   * run's own centreline under its own endpoint.
   */
  const sheetRun = (drawingState.objects || []).find((object) => object.id === run.id) || run;

  const interiorJunction = createJunctionForInteriorConnection(sheetRun, drawingState.objects);

  if (interiorJunction) {
    created.push(interiorJunction);
  }

  /*
   * AND THE SAME QUESTION FROM THE OTHER SIDE - a leg drawn so that its START
   * lands in a host's middle is the same connection as one whose END does.
   */
  (drawingState.objects || [])
    .filter((object) => object.type === "pipe-duct" && object.id !== run.id)
    .forEach((other) => {
      const extra = createJunctionForInteriorConnection(other, drawingState.objects);

      if (extra && !created.some((made) => made.id === extra.id)) {
        created.push(extra);
      }
    });

  const joined = [];

  connectPipeEndpoints(run, drawingState.objects);

  (drawingState.objects || []).forEach((object) => {
    if (
      enggPipeDuct.isElbowType(object.type) &&
      Array.isArray(object.engineering?.connections) &&
      object.engineering.connections.includes(run.id)
    ) {
      joined.push(object);
    }
  });

  joined.forEach((fitting) => {
    if (!created.includes(fitting)) {
      created.push(fitting);
    }
  });

  /* The fitting this leg earned, for the status line only. */
  const elbow = joined[0] || null;

  /*
   * AND THE ASSEMBLY GROUPING, NOW THAT THE LEG'S JOINTS ARE SETTLED.
   *
   * A leg that joined a system makes it a bigger system, and one drawn on its own
   * makes no system at all - either way the Objects tree must say so. This runs
   * BEFORE the commit so the parent and the children are saved, undone and
   * written as one change, exactly as the runs and fittings are.
   */
  reconcilePipeAssemblies(drawingState.objects);

  enggDrawingState.commitDrawingChange(drawingState, previousObjects);

  /*
   * THE DOCUMENT OWNS THE OBJECTS FROM HERE.
   *
   * Committing a change replaces the objects with the drawn copies - the ones
   * Undo and the source are keyed on - so the fitting is shaped against THOSE,
   * and the caller is handed the run as the document now holds it. Using the
   * pre-commit instance afterwards would edit an object the sheet no longer has.
   */
  joined.forEach((fitting) => {
    const committedElbow = drawingState.objects.find((object) => object.id === fitting.id);

    if (committedElbow) {
      updateElbowForPair(committedElbow, null, null, null, drawingState.objects);
    }
  });

  const committedRun = drawingState.objects.find((object) => object.id === run.id) || run;

  const committedElbow = elbow
    ? drawingState.objects.find((object) => object.id === elbow.id) || elbow
    : null;

  const junction = drawingState.objects.find(
    (object) =>
      object.type === "junction" &&
      (object.engineering?.connections || []).includes(run.id)
  );

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
    junction
      ? `${committedRun.name} and ${junction.name} created - drag to continue, or Enter to finish`
      : elbow
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
 * direction change and, when it is a genuine turn at any angle, builds a
 * separate Elbow feature between them, bent to exactly the angle it found.
 *
 * ========================================================
 * NOT TWO RUNS, ONE ELBOW EACH
 * ========================================================

 *
 * An elbow is generated ONCE, when the second of the two runs is committed.
 * It is never regenerated by re-running this for the same pair, so repeated
 * editing cannot create duplicate or orphaned elbows. If the pair is later
 * joined on a DIFFERENT side - the second run redrawn the other way round -
 * the recorded connection is re-ordered rather than a second fitting added. If
 * a corner that once had an elbow later stops being a corner (straightened,
 * disjoined, or folded back on itself), the elbow is removed by
 * `refreshFluidConnections` - the single place a fitting is taken away.
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
export function generateElbowFor(previousRun, run, engineering, knownElbow = null) {
  if (!previousRun || !run) {
    return null;
  }

  /*
   * THE NEW FITTING IS MEASURED AGAINST THE PIPES AS THEY ARE ON THE SHEET.
   *
   * `connectPipeEndpoints` walks `drawingState.objects`, but a caller may hand it
   * the objects it holds - a leg that has just been drawn, a pipe a source edit
   * produced - and those can be different INSTANCES from the sheet's. Every write
   * the fitting makes has to land on the object the document keeps, or the trim,
   * the seat and the seam are written to a copy that is thrown away.
   */
  const onSheet = (candidate) =>
    (drawingState.objects || []).find((object) => object.id === candidate?.id) || candidate;

  previousRun = onSheet(previousRun);
  run = onSheet(run);

  /*
   * ONE ELBOW PER PAIR OF RUNS. If these two are already joined - the student
   * snapped the same pipes together twice, or a join was discovered by moving a
   * run rather than by drawing it - the fitting is UPDATED in place by
   * `updateElbowForPair` rather than a second one being added on top of the
   * first. That is also the path a moved pipe takes: the fitting follows the
   * two runs' current geometry, keeping its own radius.
   */
  const existing =
    knownElbow ||
    (drawingState.objects || []).find(
      (object) =>
        enggPipeDuct.isElbowType(object.type) &&
        Array.isArray(object.engineering?.connections) &&
        previousRun.id &&
        run.id &&
        object.engineering.connections.includes(previousRun.id) &&
        object.engineering.connections.includes(run.id)
    );

  if (existing) {
    /*
     * THE SAME PAIR JOINED ANOTHER WAY means the corner has moved, and with it
     * which end of each run it eats. `updateElbowForPair` re-reads the join from
     * the two runs' current geometry - and from the fitting's own rails when the
     * pipes have been cut back to their tangent points - so the one fitting and
     * the runs' trims follow it instead of a second fitting appearing.
     */
    updateElbowForPair(existing, previousRun, run, joiningCornerOf(previousRun, run), drawingState.objects);

    return null;
  }

  const joint = joiningCornerOf(previousRun, run);

  /*
   * THE CORNER, AND WHICH WAY ROUND THE PAIR JOINS IT.
   *
   * A corner exists only where the two runs MEET end-to-end. Each run may meet
   * the corner at either of its own ends, so the orientation is read from the
   * geometry rather than assumed: the fitting always needs the far point of
   * the first run and the far point of the second, and which of their two ends
   * that is depends on how the pair is joined.
   */

  if (!joint) {
    return null;
  }
  /*
   * THE DIRECTION CHANGE AT THE CORNER, FROM THE RUNS' ACTUAL DIRECTIONS.
   *
   * This is the same measurement `cornerOf` makes for an elbow already on the
   * sheet, so generating one and refreshing it can never disagree about what
   * the bend angle is - and because the angle is measured rather than matched
   * against a list, a 30, a 60 or a 120 earns the same fitting a 90 does.
   */
  const angleDegrees = enggPipeDuct.cornerAngleDegrees(
    joint.before,
    joint.vertex,
    joint.after
  );

  const angle = enggPipeDuct.supportedElbowAngle(angleDegrees);

  /* A straight continuation is not a corner: nothing bends there. */
  if (angle === null) {
    return null;
  }

  const radius = fittingRadiusFor(joint, angle);

  /*
   * THE FITTING RECORDS THE TWO RUNS IT JOINS, by ID.
   *
   * The pair is the connection; which of each run's OWN ends meets the corner
   * is re-read from their geometry on every refresh (`joiningCornerOf`), so a
   * pair joined the other way round still finds its one corner.
   *
   * `bendTrim` is computed from THE SAME angle and radius the bend is drawn
   * with, rather than measured off the new run's own direction: `elbowGeometry`
   * places both tangent points from this one trim, so the arcs meet both runs
   * exactly, at any angle.
   */
  const elbowEngineering = {
    angle,
    angleDegrees,
    bendRadius: radius,
    connections: [previousRun.id, run.id],
    connected: true,

    /*
     * WHICH END OF EACH RUN THE FITTING HOLDS - recorded BY RUN ID.
     *
     * The two runs are passed in whatever order the CALLER happens to have
     * them (a drawing session has the previous run first; endpoint discovery
     * sorts by id). Storing the ports positionally against `connections` would
     * then bind run B's end to run A, and the fitting would be rebuilt against
     * the wrong two arms - a bug that hides completely at 45 and 90 degrees,
     * where the arms happen to be symmetric.
     *
     * Keying by id makes the record independent of the order the pair is read
     * in, so `cornerOf` can always find each run's own held end.
     */
    ports: { [previousRun.id]: joint.firstEnd, [run.id]: joint.secondEnd },

    /*
     * HOW FAR THE BEND EATS INTO EACH RUN. The tangent distance, so the runs
     * can be shortened by exactly the length the arcs take over.
     */
    bendTrim: enggPipeDuct.elbowGeometry(
      joint.before,
      joint.vertex,
      joint.after,
      radius
    )?.trim ?? 0
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
      position: { x: joint.vertex.x, y: joint.vertex.y },
      previous: { x: joint.before.x, y: joint.before.y },
      next: { x: joint.after.x, y: joint.after.y }
    },
    {
      style: inheritedStyle,
      engineering: elbowEngineering
    }
  );

  /*
   * THE ARRIVING ARM IS THE ONE WHOSE JOINED END IS ITS `start`.
   *
   * `elbowGeometry` reads `previous -> vertex` as the incoming arm and
   * `vertex -> next` as the outgoing one. Which of the two runs ARRIVES at the
   * corner is not "the first argument": endpoint discovery passes the run being
   * edited first, so the pair can arrive in either orientation, and two pipes
   * drawn independently can meet `end`-to-`start`, `end`-to-`end` or
   * `start`-to-`start`.
   *
   * A run whose JOINED end is its `start` was drawn TOWARD the corner, so it is
   * the arriving one and its far (`end`) point is `previous`. The other run's far
   * point is `next`. Reading that from the join's own port ids makes the stored
   * geometry independent of how the pair was passed in - and getting it wrong is
   * invisible at 45 and 90 degrees, where the arms are symmetric, yet skews the
   * arc at 30 or 120.
   */
  if (elbow) {
    /*
     * THE FITTING IS SETTLED BY THE SAME ROUTINE AS EVERY LATER MOVE.
     *
     * `updateElbowForPair` re-reads the corner, keeps the radius, records the
     * pair's ports and rails, re-computes the bend's `bendTrim` and re-seats both
     * pipes onto its tangent points. Running it HERE, on creation, is what makes a
     * fitting drawn now and one refreshed after a drag the same shape in the same
     * state - walls and arcs meeting, with no gap and no overlap.
     */
    updateElbowForPair(elbow, previousRun, run, joint, [...(drawingState.objects || []), elbow]);

    /*
     * ...AND THE SETTLED RECORD IS THE ONE THAT IS RETURNED.
     *
     * `updateElbowForPair` decides the fitting's OWN order from the pair's
     * geometry, so `connections`, `ports` and the arms all describe the same two
     * runs. Handing the caller the fitting built a moment earlier would give it
     * the pair in the ARGUMENT order - and the discovery pass that follows would
     * read the two opposite ways in one settle.
     */
    return (drawingState.objects || []).find((object) => object.id === elbow.id) || elbow;
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

function fittingRadiusFor(joint, angle) {
  if (!joint) {
    return enggPipeDuct.readDefaultBendRadius();
  }

  const shorter = Math.min(
    Math.hypot(joint.vertex.x - joint.before.x, joint.vertex.y - joint.before.y),
    Math.hypot(joint.after.x - joint.vertex.x, joint.after.y - joint.vertex.y)
  );

  const preferred =
    enggPipeDuct.readDefaultBendRadius() ??
    enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION * 2;

  /*
   * THE TRIM IS `radius * tan(angle / 2)`, so a WIDE bend eats far more of a
   * run than a right angle does - a 135 degree bend takes nearly 2.4 times its
   * radius off each side. Scaling the radius by the shorter run alone is
   * therefore only right for a 90, and for an obtuse corner would put a tangent
   * point past the end of the run and leave the bend undrawable.
   *
   * So the limit is solved FROM the trim instead: the shorter run's fraction,
   * divided by the tangent factor at THIS angle, is the largest radius whose
   * tangent points stay inside both runs. A short leg therefore gets a small
   * bend instead of no fitting, at every supported angle.
   */
  const tangent = Math.tan((Number(angle) * Math.PI) / 360);

  if (!(tangent > 1e-9)) {
    return Math.min(preferred, Math.max(shorter * FITTING_RADIUS_RUN_FRACTION, 1e-6));
  }

  const limited = Math.max(
    (shorter * FITTING_RADIUS_RUN_FRACTION) / Math.max(tangent, 1),
    1e-6
  );

  return Math.min(preferred, limited);
}

/*
 * ========================================================
 * WHICH WAY ROUND TWO JOINED RUNS MEET
 * ========================================================
 *
 * A corner is two runs sharing an endpoint, with a far point at each end of the
 * pair. Which of a run's OWN two ends is the shared one is read from the
 * geometry, not assumed from the order they were drawn or from which end is
 * `end`.
 *
 * Returns `{ before, vertex, after, firstEnd, secondEnd }`, where the two end
 * ids name the ends the corner eats, or null when the runs do not meet.
 */
/*
 * THE END OF A RUN THAT A FITTING DOES NOT HOLD - the end the student drew to.
 *
 * It is the run's OTHER STORED END, never its span. `start` and `end` are the
 * pipe as the student currently has it: a drag writes the dragged end directly,
 * and a seat writes the held end onto the tangent point. The span is the run's
 * ORIGINAL line, kept so the walls can be offset from it, and a swung pipe's span
 * still names where it used to be - so reading the far end from it made a pipe
 * that had just been moved swing its bend back to the old angle.
 */
export function farEndOfRun(run, held) {
  if (!run?.geometry || (held !== "start" && held !== "end")) {
    return null;
  }

  const far = run.geometry[held === "end" ? "start" : "end"];

  return far ? { x: far.x, y: far.y } : null;
}
export function joiningCornerOf(first, second) {
  const a = first?.geometry;
  const b = second?.geometry;

  if (!a?.start || !a?.end || !b?.start || !b?.end) {
    return null;
  }

  const pairs = [
    { firstEnd: "end", secondEnd: "start", vertex: a.end },
    { firstEnd: "end", secondEnd: "end", vertex: a.end },
    { firstEnd: "start", secondEnd: "start", vertex: a.start },
    { firstEnd: "start", secondEnd: "end", vertex: a.start }
  ];

  /*
   * A JOIN IS TWO ENDS AT ONE POINT - AND THE FITTING'S OWN SEAT IS THE EXTRA CASE.
   *
   * A run's stored end is the point the student put down or last dragged, and a
   * drag writes it directly (`drag.js`), so a join made by MOVING a pipe's end
   * onto another pipe's end is measured against what is stored. The span is the
   * run's original line, kept for wall offsets, and it deliberately does not
   * follow a drag; using it here compared against where a pipe once was and
   * missed every join made by moving one.
   *
   * A SEATED PAIR'S ENDS DO NOT MEET. Each has been cut back to its own tangent
   * point, so the two are a trim apart - and an elbow re-settled after its pipes
   * were swung would otherwise be retired and re-discovered on every pass. The
   * fitting's recorded corner is therefore accepted as a join in its own right,
   * provided both runs still reach it (see `lineCorner`).
   */
  const joined = pairs.find((pair) => {
    const firstAt = a[pair.firstEnd];
    const secondAt = b[pair.secondEnd];

    return (
      firstAt &&
      secondAt &&
      Math.hypot(firstAt.x - secondAt.x, firstAt.y - secondAt.y) <= CONTINUATION_TOLERANCE
    );
  });

  if (!joined) {
    return null;
  }

  const firstAt = a[joined.firstEnd];
  const secondAt = b[joined.secondEnd];

  const before = a[joined.firstEnd === "end" ? "start" : "end"];
  const after = b[joined.secondEnd === "end" ? "start" : "end"];

  if (!before || !after || !firstAt || !secondAt) {
    return null;
  }

  /*
   * A SHARED ENDPOINT IS THE JOIN, AT THIS LEVEL.
   *
   * The stricter question - "are these still the SAME two ends the fitting was
   * made at?" - belongs to the caller, which has the fitting's own record to
   * check against (`cornerOf` does exactly that through `engineering.ports`).
   * Answering it here would also refuse a legitimate first join, because a pair
   * that has never been fitted records no ports yet.
   */
  return {
    before: { x: before.x, y: before.y },
    vertex: { x: (firstAt.x + secondAt.x) / 2, y: (firstAt.y + secondAt.y) / 2 },
    after: { x: after.x, y: after.y },
    firstEnd: joined.firstEnd,
    secondEnd: joined.secondEnd
  };
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

/*
 * The corner an elbow fits, or null when the runs no longer make one.
 *
 * THE ORIENTATION IS RE-READ, NOT TRUSTED.
 *
 * The recorded pair says WHICH two runs are joined; `joiningCornerOf` says how
 * they currently join, which is what the geometry needs. Assuming "first run's
 * end, second run's start" is only right for the way the pair happened to be
 * drawn, and the moment an end is dragged onto the other side of the join - or
 * a run is redrawn or reversed - the elbow would be rebuilt inside-out around a
 * corner that is not there. The runs must still MEET: an endpoint dragged away
 * leaves two runs that only happen to be near each other.
 */
export function cornerOf(elbow, objects = drawingState.objects) {
  const [first, second] = connectedRunsOf(elbow, objects);

  /*
   * A JOINED RUN ENDS ON THE FITTING'S TANGENT POINT.
   *
   * The fitting's `bendTrim` is where the bend begins along each run, so the
   * point the run is held at is exactly that far in from its far end. A run
   * whose stored joined end is NOT there has been moved off the joint and the
   * corner is gone; one whose stored end IS there is still joined, however far
   * its far end has been swung. Reading `` are these endpoints still the same
   * point?'' instead would call a pipe that had been re-seated by a radius edit
   * - or seated a floating point off - separated from its own fitting.
   *
   * This is a measurement, not a correction: nothing is written here, so the
   * disconnection test and the geometry test share one statement of "is this
   * end still on the bend?".
   */
  const portsRecord = elbow?.engineering?.ports;

  /*
   * WHERE A RUN IS HELD: on the bend's OWN tangent point for that end.
   *
   * THE TANGENT BELONGS TO AN ARM, AND THE ARM BELONGS TO A RUN. `curves.start`
   * is the tangent on the FITTING'S FIRST arm and `curves.end` on its second, so
   * a run's seat is decided by ITS OWN place in `connections` - not by which of
   * the two runs the caller happened to pass first. Pairing them positionally
   * gave a settled fitting the other run's far end as its seat, and every
   * refresh then read it as "not joined" and retired it.
   */
  const seatedEnd = (run, end) => {
  if (run && (end === "start" || end === "end")) {
  const tangent = enggPipeDuct.tangentPointOnRun(run, end, elbow);

  if (tangent) {
  return tangent;
  }
  }

  return run?.geometry?.[end] || null;
  };

  const heldEndOf = (run) => {
    if (!portsRecord || Array.isArray(portsRecord)) {
      return null;
    }

    const recorded = portsRecord[run?.id];

    return recorded === "start" || recorded === "end" ? recorded : null;
  };

  if (!first || !second) {
    return null;
  }

  /*
   * THE RECORDED PORTS MUST STILL BE AT THE CORNER.
   *
   * When the fitting recorded which endpoint of each run it holds, that is the
   * authority: the two recorded ends must coincide. If they do not, a pipe has
   * been moved or dragged off the join and the fitting no longer has a corner -
   * even if some OTHER end of the same pipe happens to lie nearby, which is the
   * coincidence a geometry-only reading cannot tell apart from a real join.
   *
   * THE RECORD IS KEYED BY RUN ID, so it does not matter which of the pair is
   * "first": each run's own held end is looked up under its own id.
   */
  const ports = elbow?.engineering?.ports;

  /*
   * `firstEnd`/`secondEnd` ALWAYS NAME THE END OF THE FIRST AND SECOND RUN `cornerOf`
   * READ, which here is the position in `connections`. `updateElbowForPair` stores
   * that same pair, so its record and this reading can never disagree about which
   * run an end belongs to.
   */
  if (ports && !Array.isArray(ports) && typeof ports === "object") {
    const firstPort = ports[first.id] || heldEndOf(first);
    const secondPort = ports[second.id] || heldEndOf(second);

    /*
     * WHERE EACH RUN ACTUALLY ENDS. A run is CUT BACK to the bend, so its stored
     * joined end is the tangent point - and while the fitting is in place the two
     * stored ends coincide at the corner. A run dragged off the join takes its
     * end with it, so the pair no longer meets.
     *
     * A GAP IS MEASURED AGAINST THE SEAT, NOT AGAINST THE OLD POINT. A pipe that
     * has been re-seated by a radius change or an angle change sits on the bend's
     * current tangent point, which is not where its end used to be - and that is
     * still the same join. So the end is compared with the SEAT it should occupy
     * (`seatedEnd`), and only a run that has left BOTH is disjoined.
     */
    const heldFirst = firstPort ? first.geometry?.[firstPort] : null;
    const heldSecond = secondPort ? second.geometry?.[secondPort] : null;

    if (!heldFirst || !heldSecond) {
      return null;
    }

    const seatFirst = seatedEnd(first, firstPort);
    const seatSecond = seatedEnd(second, secondPort);

    if (!seatFirst || !seatSecond) {
      return null;
    }

    /*
     * THE TWO RUNS MUST BOTH STILL REACH THE SAME CORNER.
     *
     * THE ONE TEST, THEN: the two runs must still make a corner - their lines
     * meet, each still reaches it, and each run's HELD end is where it meets that
     * corner. That is the same question for a fresh pair, a settled one, one
     * re-cut to a new radius and one whose far ends were swung, because a seated
     * end sits exactly where its own line meets the corner. A pipe dragged off the
     * join fails it; a pipe whose FREE end moved passes it, which is what keeps a
     * bend attached while the rest of its pipe is reshaped.
     */
    const corner = lineCorner(first, firstPort, second, secondPort, elbow, elbow?.geometry?.position);

    if (!corner) {
      return cornerFromRails(elbow, [first, second]);
    }

    const vertex = corner.vertex;

    /*
     * THE ARMS MUST STILL MAKE A CORNER. The angle is measured from each run's
     * OUTWARD END - the pipe the student currently has - not from the fitting's
     * rounded record of where the corner was. A pipe swung about the joint keeps
     * its outward end and changes the line it meets the corner along, so the
     * recorded arms would name the angle the pipes had when they were first
     * joined while the drawing showed another one.
     */
    const armOfRun = (run, port) => farEndOfRun(run, port) || corner.vertex;

    const angleDegrees = enggPipeDuct.cornerAngleFromArms(
      armOfRun(first, firstPort),
      vertex,
      armOfRun(second, secondPort)
    );

    const supported = enggPipeDuct.supportedElbowAngle(angleDegrees);

    /*
     * A DEGENERATE CORNER KEEPS THE FITTING'S LAST VALID ANGLE.
     *
     * `supportedElbowAngle` refuses a straight continuation and a fold-back - the
     * two corners no rounded bend can join. A pipe swung to one of them is still
     * JOINED, though: both seats hold and both lines still pass through the same
     * corner. Answering null there retired a perfectly good fitting and re-cut
     * both pipes square at the corner, which is how the pipe on the far side of
     * an elbow came to run straight into (and past) its own bend. The existing
     * "an invalid update preserves the last valid geometry" rule applies
     * instead: the bend stays at the angle it had until the pipes bend again.
     */
    const angle = supported === null ? enggPipeDuct.elbowAngleDegrees(elbow) : supported;

    const effectiveDegrees = supported === null ? angle : angleDegrees;

    return angle === null
      ? null
      : {
          before: { ...armOfRun(first, firstPort) },
          vertex,
          after: { ...armOfRun(second, secondPort) },
          firstEnd: firstPort,
          secondEnd: secondPort,
          angle,
          angleDegrees: effectiveDegrees
        };
  }

 if (Array.isArray(ports) && ports.length === 2) {
    const heldFirst = first.geometry?.[ports[0]];
    const heldSecond = second.geometry?.[ports[1]];

    if (!heldFirst || !heldSecond) {
      return null;
    }

    const gap = Math.hypot(heldFirst.x - heldSecond.x, heldFirst.y - heldSecond.y);

    if (gap > CONTINUATION_TOLERANCE) {
      return cornerFromRails(elbow, [first, second]);
    }
    const before = first.geometry[ports[0] === "end" ? "start" : "end"];
    const after = second.geometry[ports[1] === "end" ? "start" : "end"];

    if (!before || !after) {
      return null;
    }

    const vertex = { x: (heldFirst.x + heldSecond.x) / 2, y: (heldFirst.y + heldSecond.y) / 2 };

    const angleDegrees = enggPipeDuct.cornerAngleDegrees(before, vertex, after);
    const angle = enggPipeDuct.supportedElbowAngle(angleDegrees);

    return angle === null
      ? null
      : {
          before: { x: before.x, y: before.y },
          vertex,
          after: { x: after.x, y: after.y },
          firstEnd: ports[0],
          secondEnd: ports[1],
          angle,
          angleDegrees
        };
  }

  const joint = joiningCornerOf(first, second);

  if (!joint) {
    return null;
  }

  const angleDegrees = enggPipeDuct.cornerAngleDegrees(
    joint.before,
    joint.vertex,
    joint.after
  );

  const angle = enggPipeDuct.supportedElbowAngle(angleDegrees);

  return angle === null ? null : { ...joint, angle, angleDegrees };
}

/*
 * ========================================================
 * THE CORNER TWO SEATED RUNS STILL MAKE
 * ========================================================
 *
 * Each joined run keeps its LINE while its near END is cut back to the bend's
 * tangent point, and the fitting records the corner it was built around - the
 * point both arcs share. That record is what makes this readable at all: two
 * pipes whose ends have been cut back no longer share a point, so "where do these
 * two meet" has no answer from the stored ends alone.
 *
 * So the corner comes FROM THE FITTING when it has one, and the two run lines
 * are used only to re-derive it when it does not. Either way, the corner must
 * still lie on BOTH lines (within the connection tolerance) or the pipes have
 * been turned away from the join, and each run must still reach it.
 *
 * Returns the corner (`before`/`after` being each run's far end) and the two
 * lines, or null.
 */
export function lineCorner(first, firstEnd, second, secondEnd, elbow, known = null) {
  const lineThrough = (run, end) => {
    const geometry = run?.geometry || {};

    const joined = geometry[end];

    /*
     * THE RUN'S OUTWARD END IS THE ONE THE BEND DOES NOT HOLD - the end the
     * student drew to. Read from the span, which keeps it even after the near end
     * was cut back to a tangent point (see `farEndOfRun`).
     */
    const far = farEndOfRun(run, end);

    if (!joined || !far) {
      return null;
    }

    /*
     * THE RUN'S LINE NAME FROM ITS HELD END OUT TO WHERE THE PIPE REALLY ENDS.
     *
     * `joined` is the end the bend holds. The other STORED end is the end the
     * student has - a drag writes it, and nothing else moves it once the pipe is
     * seated. The SPAN is only consulted to tell which way is outward when the
     * pipe has never been dragged: it is the line the pipe was drawn along, and a
     * swing leaves it behind.
     */
    const storedFar = run?.geometry?.[end === "end" ? "start" : "end"];

    if (!storedFar || !Number.isFinite(storedFar.x) || !Number.isFinite(storedFar.y)) {
      return null;
    }

    const outward = enggPipeDuct.directionOf(joined, storedFar);

    if (!outward) {
      return null;
    }

    return { point: { x: storedFar.x, y: storedFar.y }, joined, direction: outward };
  };

  const a = lineThrough(first, firstEnd);
  const b = lineThrough(second, secondEnd);

  if (!a || !b) {
    return null;
  }

  const offsetOf = (line, point) => {
    const ox = point.x - line.point.x;
    const oy = point.y - line.point.y;

    return {
      across: Math.abs(ox * line.direction.y - oy * line.direction.x),
      along: ox * line.direction.x + oy * line.direction.y
    };
  };

  let vertex = known;

  if (!vertex) {
    const cross = a.direction.x * b.direction.y - a.direction.y * b.direction.x;

    if (Math.abs(cross) < 1e-9) {
      return null;
    }

    const qx = b.point.x - a.point.x;
    const qy = b.point.y - a.point.y;

    const t = (qx * b.direction.y - qy * b.direction.x) / cross;

    vertex = { x: a.point.x + a.direction.x * t, y: a.point.y + a.direction.y * t };
  }

  const onA = offsetOf(a, vertex);
  const onB = offsetOf(b, vertex);

  /*
   * HOW FAR EACH RUN REACHES, measured ALONG ITS OWN LINE from the corner.
   *
   * The line points OUTWARD from the join, so the corner lies behind its far
   * point and the reach is `-along`. Measuring the chord between the join and the
   * far point instead gave 92 for a line 100 long, because a swung pipe's far end
   * is off the line the corner is on - so a run that genuinely reaches the corner
   * read as not reaching it.
   */
  const reachFirst = -onA.along;
  const reachSecond = -onB.along;

  /*
   * A SETTLED PAIR IS MEASURED AGAINST ITS OWN SEATS.
   *
   * Each run was cut back to a tangent point when it was seated, and that seat is
   * exactly one trim in from the corner along its own line - so the held end IS
   * the seat, and it stays there however the other end of the pipe is swung. The
   * recorded corner therefore only has to be ONE TRIM OUT along each run from its
   * held end, which is a test that a turn cannot disturb.
   *
   * This is checked FIRST when the fitting recorded its trim. The line
   * intersection below is the fallback for a pair that has never been seated: it
   * is the weaker test for a settled one, because the intersection of two
   * nearly-parallel lines moves a long way for a small turn.
   */
  const trim = Number(elbow?.engineering?.bendTrim) || 0;

  /*
   * A SEATED RUN IS ONE THE BEND STILL HOLDS: ITS HELD END IS AT ITS SEAT.
   *
   * The seat is the point one trim out from the corner, so a run that has been
   * SWUNG about its joint still passes (the seat is a property of its own line),
   * while a run dragged off the join fails - its held end is now somewhere else
   * entirely. The line tests below then decide whether the pair still makes a
   * corner, which is a separate question.
   */
  const seatsHold = (line) => {
    const held = line.joined;

    if (!held || !Number.isFinite(held.x) || !Number.isFinite(held.y)) {
      return false;
    }

    return Math.hypot(held.x - vertex.x, held.y - vertex.y) <= trim + CONTINUATION_TOLERANCE * 4;
  };

  const settled = trim > 0 && seatsHold(a) && seatsHold(b);

  /*
   * A JOINED RUN IS HELD AT ITS SEAT, ONE TRIM OUT FROM THE CORNER - NOT AT THE
   * CORNER ITSELF.
   *
   * `along` is measured from the run's far point toward the join, so for a seated
   * run it is `-trim` rather than `0`. Requiring it to be non-negative demanded
   * that the run reach the corner, which no seated run does: it stops a trim
   * short by construction. A pipe is therefore joined when the corner lies
   * SOMEWHERE ALONG its line - behind its far end by no more than its own reach,
   * and no further in than its seat.
   */
  /*
   * A SEATED RUN NEED NOT PASS THROUGH THE OLD CORNER AT ALL.
   *
   * Its held end is the tangent point of the bend that WAS THERE, and the corner
   * the pair makes now is where its own line meets the other run's. So for a
   * seated pair the across-offsets are a rounding allowance only; an UNSEATED
   * pair - one whose corner really has to be intersected from its two ends - is
   * the case the offset test exists for.
   */
  const acrossTolerance = settled
    ? Math.max(JOINED_LINE_OFFSET_TOLERANCE, trim * 2)
    : JOINED_LINE_OFFSET_TOLERANCE;

  /*
   * THE CORNER MUST LIE ON BOTH LINES, BETWEEN EACH RUN'S FAR END AND ITS SEAT.
   *
   * In `along` (measured from the far point, outward-positive) that is:
   *
   *     -reach  <=  along  <=  0        or a trim further in for a seated run
   *
   * A corner BEYOND the far end means the pipe has been pulled back along its
   * own line; one further in than the run reaches means it no longer arrives at
   * the join. Both are genuine disconnections. A pipe merely SWUNG about its seat
   * keeps the corner exactly on its line, at `along = 0`, and passes.
   */
  const linesAgree =
    onA.across <= acrossTolerance &&
    onB.across <= acrossTolerance &&
    onA.along <= CONTINUATION_TOLERANCE &&
    onB.along <= CONTINUATION_TOLERANCE &&
    -onA.along <= reachFirst + trim + CONTINUATION_TOLERANCE &&
    -onB.along <= reachSecond + trim + CONTINUATION_TOLERANCE;

  if (!settled && !linesAgree) {
    return null;
  }

  return {
    vertex: { x: vertex.x, y: vertex.y },
    before: { x: a.point.x, y: a.point.y },
    after: { x: b.point.x, y: b.point.y },
    seatFirst: { x: vertex.x, y: vertex.y },
    seatSecond: { x: vertex.x, y: vertex.y },
    lineFirst: { direction: a.direction },
    lineSecond: { direction: b.direction }
  };
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

  /*
   * THE WIDTH IS READ WHEN THE RUN IS REACHED, not from the run the walk began
   * at. The walk may start from either side of a join, and the side the student
   * widened is the one whose value must spread.
   */
  const widthOf = (candidate) => Number(candidate.engineering?.separation) || 0;

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

        const source = widthOf(current);

        if ((Number(candidate.engineering?.separation) || 0) !== source) {
          candidate.engineering = { ...(candidate.engineering || {}) };

          if (source === 0) {
            delete candidate.engineering.separation;
          } else {
            candidate.engineering.separation = source;
          }
        }
      });
    });
  }

  return [...visited].filter((id) => id !== run.id);
}

/*
 * IS THIS END OF THE RUN ALREADY HELD BY A BEND?
 *
 * `geometry.trims` records, per run end, how far a fitting has cut it back. A
 * trimmed end has been SEATED - it sits on a tangent point, not at the corner -
 * so it must not be offered as a fresh join: its stored point is a trim away
 * from where the corner really is, and comparing it with another run's end
 * would invent a join (or a bend) that is not there.
 *
 * The untrimmed ends are the ones still free to join, whichever end of the run
 * they happen to be - `start` or `end` - and whichever order the runs were
 * drawn in.
 */
function heldByBend(end, run) {
  const trim = Number(run?.geometry?.trims?.[end]);

  return trim > 0;
}

/*
 * ========================================================
 * DISCOVER THE FITTINGS A RUN'S ENDPOINTS EARNED
 * ========================================================
 *
 * `refreshFluidConnections` answers "what happened to the fittings already
 * attached to this run". It cannot answer "has this run just come to MEET
 * another run" - the pair is not recorded anywhere yet, so there is nothing for
 * it to find.
 *
 * THAT SECOND QUESTION IS THE WHOLE OF THE REPORTED BUG: two pipes drawn at
 * different times, or brought together by dragging a handle, met at a genuine
 * corner and no elbow appeared - because the only thing that ever created one
 * was the drawing session's own `previousRun` continuation.
 *
 * So the JOIN IS THE TRIGGER, not the session. This walks the run's two ends,
 * finds any OTHER run whose end coincides with one, and generates the fitting for
 * that pair. It is deliberately identical for every way a join can come about -
 * drawing, dragging, moving, source synchronization - so there is one rule and no
 * second implementation for "pipes that already existed".
 *
 * IT NEVER DUPLICATES: `generateElbowFor` finds the existing fitting for the pair
 * and refreshes it instead of adding a second.
 *
 * Returns the fittings created or refreshed.
 */
export function connectPipeEndpoints(run, objects = drawingState.objects) {
  if (!run?.id || !Array.isArray(objects)) {
    return [];
  }

  const engineering = enggPipeDuct.defaultPipeEngineering();
  const created = [];

  enggPipeDuct.portsOf(run).forEach((port) => {
    objects.forEach((other) => {
      if (
        !enggPipeDuct.isPipeDuctType(other.type) ||
        other.id === run.id
      ) {
        return;
      }

      /*
       * THE OTHER RUN MUST MEET THIS END - at either of its own ends, because a
       * join reads the same whichever way round the two runs were drawn.
       *
       * AN END ALREADY HELD BY A FITTING IS NOT OFFERED, because a joined pipe
       * has been CUT BACK to its bend's tangent point and no longer coincides
       * with the other run's end. An end that already carries a fitting's trim
       * is therefore skipped, so the trim cannot be read as a fresh join.
       *
       * The trim is cleared again whenever the fitting goes (`clearTrimFrom`),
       * so an end the student has pulled away by a TRIM'S LENGTH is free to join
       * the run under it. Every seam ON the bend is decided here, not by the
       * order the runs were drawn in.
       */
      const meets = enggPipeDuct.portsOf(other).some(
        (candidate) =>
          !heldByBend(candidate.id, other) &&
          Math.hypot(
            candidate.point.x - port.point.x,
            candidate.point.y - port.point.y
          ) <= CONTINUATION_TOLERANCE
      );

      /*
       * OR THE PAIR IS ALREADY JOINED, AND HAS BEEN CUT BACK TO ITS FITTING.
       *
       * A joined pipe no longer ends at the corner - its joint is the fitting's
       * tangent point - so "do these two endpoints coincide?" is FALSE for every
       * pair that already has a bend. Asking only that question would stop an
       * ordinary angle change from being noticed, and would let a fitting be
       * removed the moment its pipes were re-seated. The recorded pair is
       * therefore ALSO a join - and whether it is STILL a join is re-read from the
       * rails (`cornerOf`), never assumed from the record alone.
       *
       * ONLY A GENERATED FITTING IS RE-DISCOVERED THIS WAY. A MANUAL elbow is
       * the student's own object: it is kept in step by `refreshManualElbow`,
       * and a discovery pass must not rebuild its ends and angle from the
       * corner the way an automatic fitting's are rebuilt.
       */
      const fitted = (objects || []).find(
        (object) =>
          enggPipeDuct.isElbowType(object.type) &&
          object.engineering?.generated !== false &&
          Array.isArray(object.engineering?.connections) &&
          object.engineering.connections.includes(run.id) &&
          object.engineering.connections.includes(other.id)
      );

      if (!meets && !fitted) {
        return;
      }

      /*
       * THE PAIR IS ALWAYS PASSED AS (THE ESTABLISHED RUN, THE NEW ONE).
       *
       * `generateElbowFor` gives the fitting the appearance of its FIRST run -
       * the pipework the bend continues. That is the run ALREADY on the sheet,
       * not the leg just drawn, so the pair is ordered by AGE: the sheet's own
       * list puts the older feature first, and `objects.indexOf` reads that
       * directly. Without it the bend is coloured from the brand-new run, which
       * carries the drawing default - the reported "the bend ignores the pipe's
       * colour" case.
       */
      const established = (objects || []).indexOf(other) < (objects || []).indexOf(run) ? other : run;
      const newcomer = established === other ? run : other;

      const elbow = fitted || meets
        ? generateElbowFor(established, newcomer, engineering, fitted)
        : null;

      /*
       * THE FITTING IS ADDED TO THE DOCUMENT HERE.
       *
       * `generateElbowFor` builds and returns one; committing it to the sheet is
       * the caller's job, exactly as the drawing session does it. Leaving it out
       * was what made a join between two already-existing pipes draw nothing -
       * the elbow was constructed, then thrown away.
       *
       * The fitting has ALREADY been trimmed and its pipes re-seated onto its
       * tangent points by `adoptElbowShape`, so nothing is applied to it again
       * here - a second application would re-trim against tangent points that
       * had moved, and leave a gap in the drawn walls.
       */
      if (elbow && !(objects || []).some((object) => object.id === elbow.id)) {
        enggDrawingState.addObject(drawingState, elbow);

        created.push(elbow);
      }
    });
  });

  return created;
}

/*
 * ========================================================
 * THE ONE PLACE A PIPE'S JOINTS ARE SETTLED
 * ========================================================
 *
 * EVERY way a run's endpoints can move - a drawing session committing a leg, a
 * handle drag, a body move, a rotation, a Features edit, a source edit - calls
 * this, and nothing else creates, updates or removes a GENERATED fitting. That is
 * what makes the behaviour the same whichever tool is armed, whichever order the
 * pipes were drawn in, and however much time passed between them.
 *
 * It does the three things a movement can require, in the only order that keeps
 * the geometry honest:
 *
 *   1. CLOSE the joins a run now makes - `connectPipeEndpoints`, which builds
 *      a fitting for any pair that meets at a genuine change of direction and
 *      UPDATES the one already there rather than adding another.
 *   2. OPEN the ones it has left - any generated fitting whose recorded pair no
 *      longer meets, or no longer turns, is retired.
 *   3. RE-SEAT the pipes onto the tangent points of the fittings still attached
 *      to them, so the straight walls and the arcs meet at every frame.
 *
 * MANUAL fittings are deliberately untouched. They are their own objects with
 * their own ends and angle; the automatic rule is about corners BETWEEN runs.
 *
 * Returns `{ created, removed, updated }` so a caller can report what happened.
 */
export function reconcileFluidConnections(run, objects = drawingState.objects) {
  /*
   * A PAIR MAY BE NAMED DIRECTLY - `reconcileFluidConnections(a, b)` - which is
   * how an edit made ON an elbow asks for the two pipes around it to settle.
   */
  const paired = objects && !Array.isArray(objects) && objects.id && objects.id !== run?.id;

  const list = Array.isArray(objects) ? objects : drawingState.objects;

  if (!run?.id || !Array.isArray(list)) {
    return { created: [], removed: [], updated: [] };
  }

  const result = reconcileRun(run, list);

  if (paired) {
    const other = reconcileRun(objects, list);

    result.created.push(...other.created);
    result.removed.push(...other.removed);
    result.updated.push(...other.updated);
  }

  return result;
}

function reconcileRun(run, objects) {
  if (!run?.id || !Array.isArray(objects)) {
    return { created: [], removed: [], updated: [] };
  }

  const created = [];
  const removed = [];
  const updated = [];

  /*
   * ========================================================
   * THE FITTINGS ALREADY ON THIS RUN GO FIRST
   * ========================================================
   *
   * A joined pipe is CUT BACK to its fitting's tangent point, so its stored
   * end is not at the joint. When the student drags that pipe's FAR end, the
   * two stored ends no longer coincide - and endpoint discovery, which looks
   * for two ends that meet, would find nothing and leave the bend behind at
   * its old angle.
   *
   * So every fitting attached to this run is re-fitted from the runs' CURRENT
   * geometry FIRST. That re-reads the corner from the rails, follows the new
   * angle and re-seats both pipes on the new tangent points. Only then does
   * discovery run, and it sees the pair it was already given rather than two
   * ends that have moved apart.
   */
  (objects || [])
    .filter(
      (object) =>
        enggPipeDuct.isElbowType(object.type) &&
        Array.isArray(object.engineering?.connections) &&
        object.engineering.connections.includes(run.id)
    )
    .forEach((elbow) => {
      if (removeDuplicatesOf(elbow, objects)) {
        return;
      }

      if (updateElbowForPair(elbow, null, null, null, objects)) {
        updated.push(elbow.id);
      }
    });

  /* CLOSE ANY JOINT THIS RUN NOW MAKES that had no fitting yet. */
  created.push(...connectPipeEndpoints(run, objects));

  /* OPEN the ones whose corner is gone. */
  removed.push(...refreshFluidConnections(run, objects));

  return { created, removed, updated };
}

/*
 * ONE FITTING PER PAIR - ENFORCED, NOT ASSUMED.
 *
 * Two generated elbows between the same two runs can only ever come from a
 * history in which the pair was joined by two different routes (a file written
 * before this rule, or a source edit that rebuilt one). Whichever is found second
 * is removed, so the sheet never carries a fitting on top of its own twin.
 *
 * A MANUAL fitting is never a "duplicate": it is the student's own object.
 */
function removeDuplicatesOf(elbow, objects) {
  if (elbow.engineering?.generated === false) {
    return false;
  }

  const ids = elbow.engineering?.connections;

  const twin = (objects || []).find(
    (candidate) =>
      candidate.id !== elbow.id &&
      enggPipeDuct.isElbowType(candidate.type) &&
      candidate.engineering?.generated !== false &&
      Array.isArray(candidate.engineering?.connections) &&
      Array.isArray(ids) &&
      ids.length === 2 &&
      ids.every((id) => candidate.engineering.connections.includes(id))
  );

  if (!twin) {
    return false;
  }

  /* The one that came first stays; the later one gives its trims back and goes. */
  if ((objects || []).indexOf(twin) < (objects || []).indexOf(elbow)) {
    clearTrimFrom(elbow, objects);

    return removeObjectIfPresent(elbow);
  }

  return false;
}

/*
 * Rebuild every elbow that joins this run, and drop the ones whose corner no
 * longer exists.
 *
 * Answers the fittings that were removed, so a caller can report what happened
 * rather than guessing. Updating the fittings that SURVIVE is `updateElbowForPair`'s
 * job - see `reconcileFluidConnections`, which does both in one pass.
 */
export function refreshFluidConnections(run, objects = drawingState.objects) {
  if (!run?.id || !Array.isArray(objects)) {
    return [];
  }

  const elbows = objects.filter(
    (object) =>
      enggPipeDuct.isElbowType(object.type) &&
      object.engineering?.generated !== false &&
      Array.isArray(object.engineering?.connections) &&
      object.engineering.connections.includes(run.id)
  );

  const removed = [];

  /*
   * OVER A SNAPSHOT, NOT THE LIVE LIST. `removeObjectIfPresent` splices the
   * document, so walking `objects` itself would skip the fitting after each one
   * removed - and a pair of broken fittings would leave one of them behind.
   */
  [...objects].forEach((candidate) => {
    if (!elbows.includes(candidate)) {
      return;
    }

    const elbow = candidate;

    /*
     * THE FITTING IS SETTLED BEFORE IT IS JUDGED.
     *
     * A pipe whose FREE end was moved has changed the line its bend must be
     * tangent to, while the bend still records the arms it was last built from.
     * Reading `cornerOf` first therefore compared the old arc against the new
     * pipe and reported a corner that was not the one the current geometry makes -
     * which is how a 90 degree bend sat at 45 after its pipe was swung.
     *
     * `updateElbowForPair` re-reads the corner from the runs' CURRENT geometry and
     * keeps the radius, so running it here is what makes the fitting follow. It
     * does nothing for a manual fitting, or for one whose pair has gone.
     */
    updateElbowForPair(elbow, null, null, null, objects);

    const corner = cornerOf(elbow, objects);

    if (corner) {
      return;
    }

    /*
     * THE BEND IS GOING, SO ITS TRIMS GO WITH IT - before the elbow is
     * removed, while the runs it names can still be found.
     */
    clearTrimFrom(elbow, objects);

    if (removeObjectIfPresent(elbow)) {
      removed.push(elbow.id);
    }
  });

  return removed;
}

/*
 * ========================================================
 * THE ARMS A JOINED PAIR OFFERS
 * ========================================================
 *
 * The two centreline vectors a pair of runs presents at their shared corner.
 * They both point AWAY from the corner, along each run's own centreline, so the
 * angle between them is `180 - bend` (see `bendAngleFromArms`).
 *
 * This is the measurement `cornerOf` makes, reused rather than repeated: a
 * fitting that is created and one that is refreshed can therefore never disagree
 * about which way round the corner turns, at any angle.
 */


/*
 * WHERE TWO SEATED RUNS' LINES NOW MEET.
 *
 * `cornerOf` states a joined pair as two SEATS and the DIRECTION each run takes
 * away from the corner. Swinging one pipe's free end turns its direction about its
 * seat - so the corner the pair makes now is where those two lines cross, which is
 * exactly what this intersects.
 *
 * It returns the corner moved onto that intersection, or null when the lines are
 * parallel (a straight-through state, where no single corner can be named and the
 * fitting's last valid geometry stands).
 */
function intersectSeatedCorner(corner) {
  const seatA = corner?.seatFirst;
  const seatB = corner?.seatSecond;
  const directionA = corner?.lineFirst?.direction;
  const directionB = corner?.lineSecond?.direction;

  if (!seatA || !seatB || !directionA || !directionB) {
    return null;
  }

  const cross = directionA.x * directionB.y - directionA.y * directionB.x;

  if (Math.abs(cross) < 1e-9) {
    return null;
  }

  const qx = seatB.x - seatA.x;
  const qy = seatB.y - seatA.y;

  const offset = (qx * directionB.y - qy * directionB.x) / cross;

  const vertex = {
    x: seatA.x + directionA.x * offset,
    y: seatA.y + directionA.y * offset
  };

  /*
   * THE CORNER MUST BE ON THE STUDENT'S SIDE OF BOTH SEATS. The directions point
   * OUTWARD from the join, so a corner behind either seat means that run was
   * pulled away along its own line rather than turned - and the fitting's own
   * record is the safer answer.
   */
  const ahead = (seat, direction) =>
    (vertex.x - seat.x) * direction.x + (vertex.y - seat.y) * direction.y > 1e-6;

  if (ahead(seatA, directionA) || ahead(seatB, directionB)) {
    return null;
  }

  return { ...corner, vertex };
}

/*
 * THE TWO RUNS IN THE FITTING'S ORDER: the one the bend ARRIVES from, then the one
 * it LEAVES along.
 *
 * The corner states two arms - `before`, the far point of the arriving run, and
 * `after`, the far point of the outgoing one. Each run's own far point is measured
 * against them, and the pair follows whichever arm its far point lies on. A pair
 * that does not match either arm is not the corner those runs make, and answers
 * null rather than a made-up order.
 */
function orderByArms(corner, runs) {
  const vertex = corner?.vertex;

  if (!vertex || !runs[0] || !runs[1]) {
    return null;
  }

  /* The endpoint of `run` that is NOT at the corner is the one it contributes. */
  const farPointOf = (run) => {
    const far = enggPipeDuct
      .portsOf(run)
      .filter(
        (port) => Math.hypot(port.point.x - vertex.x, port.point.y - vertex.y) > CONTINUATION_TOLERANCE
      )
      .sort((left, right) => {
        const near = (candidate) =>
          Math.min(
            Math.hypot(candidate.point.x - corner.before.x, candidate.point.y - corner.before.y),
            Math.hypot(candidate.point.x - corner.after.x, candidate.point.y - corner.after.y)
          );

        return near(left) - near(right);
      });

    return far.length ? far[0].point : null;
  };

  const landsOn = (point, target) =>
    Math.hypot(point.x - target.x, point.y - target.y) <= CONTINUATION_TOLERANCE;

  /*
   * THE JOIN'S OWN POINTS FIRST. They are what `generateElbowFor` measured, so a
   * fresh fit follows the exact same pair that `cornerOf` reads back - one seam
   * whichever way the join was made.
   */
  const joins = (index) => {
    const run = runs[index];
    const end = index === 0 ? corner.firstEnd : corner.secondEnd;

    return run && (end === "start" || end === "end")
      ? run.geometry?.[end === "end" ? "start" : "end"] || null
      : null;
  };

  const joinedA = joins(0);
  const joinedB = joins(1);

  if (joinedA && joinedB) {
    if (landsOn(joinedA, corner.before) && landsOn(joinedB, corner.after)) {
      return [runs[0], runs[1]];
    }

    if (landsOn(joinedB, corner.before) && landsOn(joinedA, corner.after)) {
      return [runs[1], runs[0]];
    }

    /*
     * A START-TO-START OR END-TO-END PAIR: neither far end is nearer the arm it
     * belongs to, so each is matched to the arm it lies ON or, failing that, to
     * the nearer arm. A pair that matches nothing is not this corner.
     */
    const landsOnArm = (point, arm) =>
      landsOn(point, arm) || Math.hypot(point.x - arm.x, point.y - arm.y) <
        Math.hypot(point.x - (arm === corner.before ? corner.after : corner.before).x,
          point.y - (arm === corner.before ? corner.after : corner.before).y);

    if (landsOnArm(joinedA, corner.before) && landsOnArm(joinedB, corner.after)) {
      return [runs[0], runs[1]];
    }

    if (landsOnArm(joinedB, corner.before) && landsOnArm(joinedA, corner.after)) {
      return [runs[1], runs[0]];
    }
  }

  const farA = farPointOf(runs[0]);
  const farB = farPointOf(runs[1]);

  if (farA && farB) {
    if (landsOn(farA, corner.before) && landsOn(farB, corner.after)) {
      return [runs[0], runs[1]];
    }

    if (landsOn(farB, corner.before) && landsOn(farA, corner.after)) {
      return [runs[1], runs[0]];
    }

    /*
     * BOTH FAR ENDS ON ONE ARM'S SIDE - a start-to-start join. The run whose
     * MIRROR is nearer the `after` arm is the arriving one, because its far end
     * then lies further along the `before` arm. Reading it any other way would
     * mirror the bend of a start-to-start join at every angle.
     */
    const towardsBefore = (point) => Math.hypot(point.x - corner.before.x, point.y - corner.before.y);
    const towardsAfter = (point) => Math.hypot(point.x - corner.after.x, point.y - corner.after.y);

    if (towardsBefore(farA) + towardsAfter(farB) <= towardsBefore(farB) + towardsAfter(farA)) {
      return [runs[0], runs[1]];
    }

    return [runs[1], runs[0]];
  }

  return null;
}

/*
 * ========================================================
 * ========================================================
 *
 * THE SINGLE WRITE every movement of a connected pipe goes through. It rebuilds
 * a GENERATED fitting from its two runs' CURRENT geometry:
 *
 *   position, previous, next   from the corner the runs now make
 *   angle                      from the direction change they now make
 *   radius                     KEPT, or shrunk only when the corner cannot
 *                              hold it (see `enggPipeDuct.fittedBendRadius`)
 *   tangent points / trims     from the new angle and radius
 *   pipe widths                each wall continues into the run it meets
 *
 * IT IS CONTINUOUS. Called on every frame of a drag, the same code that runs on
 * release runs while the pipe moves, so the bend follows the pointer instead of
 * jumping when the drag ends.
 *
 * IT NEVER TOUCHES A MANUAL FITTING. `engineering.generated === false` is a
 * student's own elbow: its ends and angle are theirs, and a pipe movement must
 * not rewrite them.
 *
 * Returns whether the fitting changed.
 */
export function updateElbowForPair(elbow, first = null, second = null, joint = null, objects = drawingState.objects) {
  if (!elbow || !enggPipeDuct.isElbowType(elbow.type) || elbow.engineering?.generated === false) {
    return false;
  }

  const runs = first && second ? [first, second] : connectedRunsOf(elbow, objects);

  if (!runs[0] || !runs[1]) {
    return false;
  }

  /*
   * A JOINED PAIR IS READ FROM ITS LINES BEFORE ITS FITTING'S RECORD.
   *
   * `joiningCornerOf` asks whether two ends COINCIDE, and a SEATED run's ends do
   * not: each has been cut back to its own tangent point, a trim apart from the
   * corner. It also reads the pair's stored geometry, which for an unseated run
   * is still where the pipes were originally drawn - so a swung pipe was rebuilt
   * around the corner it used to make.
   *
   * `cornerOf` reads each run's CURRENT line, refuses a pipe that has left the
   * join, and states both seats and the corner they now make together. That is
   * what lets an elbow FOLLOW a pipe the student has turned. The rail record and
   * the raw join remain the fallbacks for a pair `cornerOf` cannot read.
   */
  let corner = joint || cornerOf(elbow, objects) || joiningCornerOf(runs[0], runs[1]);

  if (!corner) {
    return false;
  }

  /*
   * THE CORNER MOVES WITH THE PIPES, NOT WITH THE OLD RECORD.
   *
   * A seated run's seat is its stored held end and its line is the direction from
   * that seat out toward its own free end. Swinging the free end turns the pipe
   * about its seat, so the corner the pair makes NOW is where the two lines
   * cross - which `cornerOf` states as two seats and two directions.
   */
  corner = intersectSeatedCorner(corner) || corner;

  const angleDegrees = enggPipeDuct.cornerAngleDegrees(
    corner.before,
    corner.vertex,
    corner.after
  );

  const supported = enggPipeDuct.supportedElbowAngle(angleDegrees);

  if (supported === null) {
    /*
     * A DEGENERATE CORNER IS NOT A LOST CONNECTION. A swing that passes through
     * the other pipe's direction makes the corner momentarily straight or folded;
     * the fitting keeps the last valid angle it had (the existing "invalid update
     * preserves the last valid geometry" rule), so the settle can still re-seat
     * both pipes and the join survives until the pipes bend again.
     */
    if (!corner.seatFirst) {
      return false;
    }
  }

  /*
   * THE PAIR IS RECORDED IN THE FITTING'S OWN ORDER - the run whose FAR point the
   * bend arrives from first, the run it leaves along second.
   *
   * That is not the order the two runs were passed in, and it is not simply
   * "runs[0] first" either: a pair can meet `end`-to-`start`, `end`-to-`end` or
   * `start`-to-`start`, and which far point a run contributes depends on which of
   * its own ends is at the corner. So the role is read from GEOMETRY - each run's
   * far point is compared with the corner's two arms - which is the one statement
   * of the join both a fresh and a refreshed fitting can share.
   *
   * `cornerFromRails` has already decided it and says so; a raw join is ordered
   * here. Recording the pair in the argument order instead is what lets a
   * `start`-to-`start` join be stored backwards, naming an obtuse bend by its
   * supplement and putting `bendTrim` on the wrong arm.
   */
  const pair = corner.arriving && corner.leaving
    ? [corner.arriving, corner.leaving]
    : orderByArms(corner, runs);

  if (!pair) {
    return false;
  }

  /*
   * WHICH OF EACH RUN'S OWN ENDS THE FITTING HOLDS.
   *
   * `corner.firstEnd`/`secondEnd` name the ends of `corner`'s runs - which are the
   * runs as they were PASSED in, not the fitting's order. The pair may have been
   * turned round by `orderByArms`, so the ends follow the pair rather than the
   * argument positions. Without this a start-to-start join would put every trim,
   * seat and seam on the wrong end of one of the two pipes.
   */
  const endOf = (run) => {
    if (run === corner.arriving) {
      return corner.firstEnd;
    }

    if (run === corner.leaving) {
      return corner.secondEnd;
    }

    return run === runs[0] ? corner.firstEnd : corner.secondEnd;
  };

  /*
   * THE ARMS ARE THE RUNS' ACTUAL LINES, NOT THE POINTS THEY JOINED AT.
   *
   * The corner's `before`/`after` are the runs' far ends as they were measured -
   * correct for the FIRST fit, but a run that has since been SEATED on a tangent
   * point keeps its line while `spanFarPointOf` still reports the point it was
   * drawn from. Deriving each arm FROM THE PIPE ITSELF gives the elbow exactly
   * the line its bend must be tangent to, at every settle - which is what keeps
   * each tangent point ON its pipe instead of a hair off it.
   */
  /*
   * EACH ARM IS THE RUN'S FAR END - the end the bend does NOT hold.
   *
   * `spanFarPointOf` cannot answer this: once a run is seated, BOTH of its
   * stored ends lie on its span, and the helper then reports the span's start,
   * which for a pipe drawn TOWARD the corner is the joined end. The far end is
   * simply the stored end opposite the one the fitting holds - read from the
   * fitting's own `ports`, so it is right for every end combination.
   */
  /*
   * THE RUNS' OWN FAR ENDS, in the pair's order.
   *
   * `corner.before`/`corner.after` are the points the JOIN was read at, which for
   * a rail-read corner are the fitting's own rounded record - a millimetre or so
   * from the pipe the student actually swung. The runs' own far ends are exact,
   * and they are the line the bend must be tangent to, so the arc follows the pipe
   * the moment it moves rather than when the next settle re-reads it.
   */
  const trueArms = { previous: farEndOfRun(pair[0], endOf(pair[0])), next: farEndOfRun(pair[1], endOf(pair[1])) };

  if (!trueArms.previous || !trueArms.next) {
    trueArms.previous = trueArms.previous || corner.before;
    trueArms.next = trueArms.next || corner.after;
  }

  /*
   * THE ANGLE IS RE-MEASURED FROM THE RUNS' CURRENT LINES.
   *
   * A pipe swung to a new angle keeps its far end but changes the line it meets
   * the corner along, so the bend must open or close to follow it. The corner's
   * stored angle is the POST-FIT answer and is only used when the two arms still
   * agree with it - otherwise the bend would stay at the angle the pipes had
   * when they were first joined.
   */
  const trueAngleDegrees = enggPipeDuct.cornerAngleDegrees(
    trueArms.previous,
    corner.vertex,
    trueArms.next
  );

  const trueAngle = enggPipeDuct.supportedElbowAngle(trueAngleDegrees);

  /* The room each arm has, measured to the runs' own far ends. */
  const legs = {
    incoming: Math.hypot(
      corner.vertex.x - trueArms.previous.x,
      corner.vertex.y - trueArms.previous.y
    ),
    outgoing: Math.hypot(
      trueArms.next.x - corner.vertex.x,
      trueArms.next.y - corner.vertex.y
    )
  };

  const radius = enggPipeDuct.fittedBendRadius(elbow, legs);

  /*
   * THE BEND FOLLOWS THE PIPES' CURRENT ANGLE.
   *
   * `trueAngle` is the direction change the two runs' LINES now make. It is the
   * authority whenever both arms are real pipe lines, because a pipe swung about
   * its joint has changed the angle without changing the join. A degenerate
   * reading keeps the corner's own angle rather than inventing a bend.
   */
  const bendAngle = trueAngle ?? supported ?? enggPipeDuct.elbowAngleDegrees(elbow);

  const bendAngleDegrees = trueAngle !== null
    ? trueAngleDegrees
    : supported !== null
      ? angleDegrees
      : enggPipeDuct.elbowAngleDegrees(elbow);

  elbow.geometry = {
    ...(elbow.geometry || {}),
    position: { x: corner.vertex.x, y: corner.vertex.y },
    previous: { x: trueArms.previous.x, y: trueArms.previous.y },
    next: { x: trueArms.next.x, y: trueArms.next.y }
  };

  /* An elbow's own ends belong to its manual side; a generated one has none. */
  if (elbow.geometry.ends) {
    delete elbow.geometry.ends;
  }

  /*
   * `endOf` ABOVE NAMES EACH RUN'S HELD END for the record below - one statement
   * of it, taken once the pair is known.
   */

  elbow.engineering = {
    ...(elbow.engineering || {}),
    angle: bendAngle,
    angleDegrees: bendAngleDegrees,
    bendRadius: radius,
    connections: [pair[0].id, pair[1].id],
    connected: true,
    ports: { [pair[0].id]: endOf(pair[0]), [pair[1].id]: endOf(pair[1]) },

    /*
     * THE ARMS THE PAIR OCCUPIES, recorded against each RUN so a later refresh
     * needs no ordering of its own. `cornerFromRails` reads them straight back.
     */
    rails: {
      ...(elbow.engineering?.rails || {}),
      [pair[0].id]: { before: trueArms.previous, after: trueArms.next, joint: corner.vertex },
      [pair[1].id]: { before: trueArms.previous, after: trueArms.next, joint: corner.vertex }
    }
  };

  adoptElbowShape(elbow, objects, corner);

  return true;
}

/*
 * ========================================================
 * THE RAILS A JOINED PAIR RUNS ALONG
 * ========================================================
 *
 * A joined pipe is CUT BACK to its fitting's tangent point, so once the fitting
 * exists the pipe's own endpoint is no longer at the joint. The direction it runs
 * in, however, is unchanged - the tangent point lies ON its centreline - so each
 * run's FAR endpoint together with the joint records exactly where that run goes.
 *
 * Those two rays are the rails. They are stored on the fitting, and they are what
 * lets a pipe that is cut back to its tangent points, re-cut to a radius, or
 * rotated be recognised as STILL JOINED rather than mistaken for one that has
 * moved away: the two far ends and the shared point still describe the same
 * corner, however far back the near ends were seated.
 */

/*
 * THE CORNER TWO RUNS STILL MAKE, READ FROM THEIR FITTER'S RAILS.
 *
 * Each run's far endpoint must still lie ALONG its recorded rail: the rail is the
 * centreline from the joint to that far end, so a far end that has moved off it
 * means the run has been turned away from the join. Both far ends must also still
 * reach the same corner, and the pair must still turn there.
 *
 * Returns the joint in the form `updateElbowForPair` expects, or null.
 */
function cornerFromRails(elbow, runs) {
  const rails = elbow?.engineering?.rails;

  if (!rails || !runs[0] || !runs[1]) {
    return null;
  }

  const legs = runs.map((run) => rails[run.id] || null);

  if (!legs[0] || !legs[1]) {
    return null;
  }

  /*
   * EACH RUN'S FAR END - the pipe end the bend does NOT hold, read from the
   * fitting's own record of which end it holds. A run is CUT BACK to its tangent
   * point, so deciding "far" by distance from the old joint would take the
   * tangent for the far end on a pipe that has been swung.
   */
  const farPointOf = (run) => {
    const held = enggPipeDuct.elbowHeldEndOf(run, elbow);

    return held ? run.geometry?.[held === "end" ? "start" : "end"] || null : null;
  };

  const farA = farPointOf(runs[0]);
  const farB = farPointOf(runs[1]);

  if (!farA || !farB) {
    return null;
  }

  const vertex = legs[0].joint;

  const toBefore = enggPipeDuct.directionOf(vertex, legs[0].before);
  const toAfter = enggPipeDuct.directionOf(vertex, legs[0].after);

  if (!toBefore || !toAfter) {
    return null;
  }

  /*
   * A RUN THAT IS STILL ON ITS RAIL IS STILL JOINED. The rail is a DIRECTION from
   * the corner, so a run turned away from the join falls off it - while a run that
   * has been lengthened, shortened, re-cut to a new radius or swung about the joint
   * stays on it, because all of those keep the same line.
   */
  const onRail = (far, direction) => {
    const along = enggPipeDuct.directionOf(vertex, far);

    return Boolean(along) && Math.abs(direction.x * along.y - direction.y * along.x) < 1e-3;
  };

  /*
   * A SWUNG PIPE IS STILL JOINED.
   *
   * This used to require both far ends to still lie on their recorded rails,
   * which REFUSED every pipe turned to a new angle - the very edit a bend must
   * follow. A rail is the line a run was joined along; swinging the run changes
   * that line, not the join.
   *
   * What is checked instead is that each run still ENDS where the fitting holds
   * it: its stored joined end must sit on the bend's tangent point for that run
   * (`seatedEnd`). A pipe dragged off the corner fails that; a pipe swung about
   * the joint passes, because its joined end never moved.
   */
  const portsHere = elbow?.engineering?.ports || {};

  /*
   * THE TWO RUNS ARE JOINED IF THEY STILL REACH THE SAME CORNER.
   *
   * A seated pair does NOT have coincident joined ends: each run stops on its
   * OWN tangent point, which is a trim apart from the corner and therefore a
   * trim apart from the other run's end. So "do the ends meet" is false even
   * for a perfect join - the two tangent points are compared with the FITTING's
   * corner instead, and each run's line must still pass through it.
   */
  const corner = elbow?.geometry?.position;

  if (!corner || !Number.isFinite(corner.x) || !Number.isFinite(corner.y)) {
    return null;
  }

  const reachesCorner = (run) => {
    const held = portsHere[run.id];

    if (held !== "start" && held !== "end") {
      return false;
    }

    const far = farEndOfRun(run, held);
    const near = run.geometry?.[held];

    if (!far || !near) {
      return false;
    }

    const direction = enggPipeDuct.directionOf(far, near);

    if (!direction) {
      return false;
    }

    /* Distance from the corner to this run's line. */
    const off = Math.abs(
      (corner.x - far.x) * direction.y - (corner.y - far.y) * direction.x
    );

    if (off > CONTINUATION_TOLERANCE) {
      return false;
    }

    /*
     * AND THE RUN MUST STILL REACH IT. A pipe dragged away along its own line is
     * still ON that line, so the distance above is zero and only the REACH tells
     * it apart from a join. A swung pipe keeps its far end, so its reach grows
     * to the new corner instead of falling short.
     */
    const toCorner =
      (corner.x - far.x) * direction.x + (corner.y - far.y) * direction.y;

    const runLength = Math.hypot(near.x - far.x, near.y - far.y);

    return toCorner > 0 && runLength + CONTINUATION_TOLERANCE >= toCorner;
  };

  if (!reachesCorner(runs[0]) || !reachesCorner(runs[1])) {
    return null;
  }

  /*
   * WHICH ARM EACH RUN OCCUPIES, read from the RUN'S OWN SEAT.
   *
   * Each run is held by the fitting at one of its ends, and that end sits on
   * the fitting's tangent point - which moves with the bend. So the question
   * "which arm does this run occupy?" is answered by the run's own recorded
   * port, not by a direction test: `previous` is the arm the bend arrives on,
   * and the run held at that arm is the arriving one.
   *
   * THE OLD TEST COMPARED EACH FAR END WITH THE RIGID OLD RAIL, which refused
   * every pipe that had been swung to a new angle - the very edit a bend must
   * follow. The rail is still the fallback when no port is recorded (a fitting
   * written before ports existed), and it keeps its original meaning there.
   */
  const ports = elbow?.engineering?.ports || {};

  const order = Array.isArray(elbow?.engineering?.connections)
    ? elbow.engineering.connections
    : [];

  /*
   * `previous` IS THE ARM THE FITTING'S FIRST RUN LIES ON. `connections` is
   * stored in the fitting's own order, so the arm is each run's POSITION, not
   * its argument order. Without a record, the rail names the arm.
   */
  const armOf = (run, far, index) => {
    const recorded = ports[run.id];

    if (recorded === "start" || recorded === "end") {
      void index;

      return order.indexOf(run.id) === 1 ? "next" : "previous";
    }

    if (onRail(far, toBefore)) {
      return "previous";
    }

    return onRail(far, toAfter) ? "next" : null;
  };

  const armA = armOf(runs[0], farA, 0);
  const armB = armOf(runs[1], farB, 1);

  if (!armA || !armB || armA === armB) {
    return null;
  }

  const aIsPrevious = armA === "previous";

  const arriving = aIsPrevious ? runs[0] : runs[1];
  const leaving = aIsPrevious ? runs[1] : runs[0];

  const before = aIsPrevious ? farA : farB;
  const after = aIsPrevious ? farB : farA;

  const angleDegrees = enggPipeDuct.cornerAngleDegrees(before, vertex, after);
  const angle = enggPipeDuct.supportedElbowAngle(angleDegrees);

  if (angle === null) {
    return null;
  }

  return {
    before: { x: before.x, y: before.y },
    vertex: { x: vertex.x, y: vertex.y },
    after: { x: after.x, y: after.y },

    /*
     * THE PAIR IS REPORTED IN THE FITTING'S OWN ORDER - arriving run first - so
     * `connections`, `ports` and the geometry it is rebuilt into all describe the
     * same two arms they did before.
     */
    arriving,
    leaving,

    /*
     * THE JOIN `updateElbowForPair` WAS WRITTEN FOR. `orderByArms` reads these
     * two to decide which run occupies which arm, so a rail-read corner - whose
     * runs are in the fitting's own order already - is not re-ordered by accident.
     */
    arrivingFirstEnd: ports[arriving.id] || "end",
    leavingSecondEnd: ports[leaving.id] || "start",

    firstEnd: ports[arriving.id] || "end",
    secondEnd: ports[leaving.id] || "start",
    angle,
    angleDegrees
  };
}

/*
 * ========================================================
 * THE FITTING AND ITS PIPES, SHAPED TO EACH OTHER
 * ========================================================
 *
 * Applying an elbow's trim does THREE things, which must always happen
 * together or the drawing shows a gap:
 *
 *   1. the two runs record how far their joined ends are cut back;
 *   2. each run's own endpoint MOVES onto the tangent point;
 *   3. the fitting takes the width of the run at each end.
 *
 * Doing (1) without (2) - which is what a trimmed centreline alone leaves -
 * draws the walls short of the arc while the run's data still ends at the corner,
 * so the straight section and the bend are separated by the trim distance. Doing
 * (2) without (1) draws the walls over the bend.
 *
 * THE CORNER IS THE ONE THE FITTING WAS BUILT FROM, and it is taken BEFORE the
 * runs are re-seated: once a run's endpoint has moved onto the tangent point, the
 * join's old corner cannot be measured from the runs any more.
 */
function adoptElbowShape(elbow, objects = drawingState.objects, joint = null) {
  const [first, second] = connectedRunsOf(elbow, objects);

  const arms = joint || (first && second ? joiningCornerOf(first, second) : null);

  const curves = elbowing(elbow, arms);

  if (!curves) {
    return false;
  }

  elbow.engineering = {
    ...(elbow.engineering || {}),
    bendTrim: curves.trim
  };

  applyTrimTo(elbow, objects, arms);

  /*
   * THE PIPES ARE SEATED BEFORE THE SEAMS ARE MEASURED.
   *
   * A run's walls are drawn from its SPAN up to its stored end, so until the
   * run's stored end IS the tangent point, its walls stop somewhere else. Only
   * once it has been seated does `writeSeams` record the point the walls and the
   * arcs share - and that is the order the two calls are made in.
   */
  reseatElbowPipes(elbow, objects, curves);

  writeSeams(elbow, objects, curves);

  /*
   * THE SAME SHORTEST LEG GOVERNS THE NEXT MOVE, so it is recorded here rather
   * than measured later from pipes whose near ends have now moved.
   *
   * IT IS WRITTEN AS A FRESH RECORD, like the rest of the fitting's state: the
   * document commits a DRAWN COPY of every object, so a write through a stale
   * reference would be lost - and an edit made here and one made on the sheet
   * would then disagree about the bend's size.
   */
  elbow.engineering = {
    ...elbow.engineering,
    ...(joint?.angle !== undefined
      ? { angle: joint.angle, angleDegrees: joint.angleDegrees }
      : {}),
    armLimits: {
      incoming: Math.hypot(
        curves.position.x - curves.start.x,
        curves.position.y - curves.start.y
      ),
      outgoing: Math.hypot(
        curves.position.x - curves.end.x,
        curves.position.y - curves.end.y
      )
    }
  };

  return true;
}

/*
 * ========================================================
 * THE SEAM ON EACH JOINED RUN - WRITTEN FROM THE BEND ITSELF
 * ========================================================
 *
 * The straight walls stop where the arcs begin. Both are offsets of the SAME
 * tangent points, so there is nothing to correct: once the run has been seated
 * on its tangent, `boundaryLinesOf` already ends its walls there, and the bend's
 * arcs start there. `bendJoints` records that shared pair of points on the run
 * so the renderer and the source writer draw the junction to one coordinate, and
 * it is rewritten from the bend on every settle - so a radius change moves it
 * with the arcs rather than leaving the walls behind.
 */
function writeSeams(elbow, objects = drawingState.objects, curves = null) {
  const bend = curves || enggPipeDuct.elbowCurvesFor(elbow);

  if (!bend) {
    return;
  }

  connectedRunsOf(elbow, objects).forEach((run, index) => {
    if (!run?.geometry) {
      return;
    }

    /*
     * THE END IS THE ONE THE FITTING RECORDS, exactly as the trim and the seat
     * use - so the seam lands on the walls the bend actually meets instead of on
     * whichever end the pipe happens to have been drawn toward.
     */
    const recorded = elbow?.engineering?.ports?.[run.id];

    const end = recorded === "start" || recorded === "end"
      ? recorded
      : index === 0 ? "end" : "start";

    /* Only an end the bend holds has a seam. */
    if (!(Number(run.geometry?.trims?.[end]) > 0)) {
      const joints = { ...(run.geometry.bendJoints || {}) };

      delete joints[end];

      run.geometry = {
        ...run.geometry,
        ...(Object.keys(joints).length ? { bendJoints: joints } : { bendJoints: undefined })
      };

      return;
    }

    const seam = enggPipeDuct.wallSeam(run, elbow, index === 0 ? bend.start : bend.end);

    if (!seam) {
      return;
    }

    run.geometry = {
      ...run.geometry,
      bendJoints: { ...(run.geometry.bendJoints || {}), [end]: seam }
    };
  });
}

/*
 * An elbow's bend geometry at its own radius, measured against the arms it is
 * being fitted to. `arms` gives the two legs their real length, which is what
 * lets the tangent points sit exactly on them at any angle.
 */
function elbowing(elbow, arms) {
  const position = elbow?.geometry?.position;
  const radius = Number(elbow?.engineering?.bendRadius);

  if (!arms || !position || !Number.isFinite(radius) || radius <= 0) {
    return null;
  }

  return enggPipeDuct.elbowGeometry(
    arms.before,
    position,
    arms.after,
    radius,
    {
      incoming: Math.hypot(position.x - arms.before.x, position.y - arms.before.y),
      outgoing: Math.hypot(arms.after.x - position.x, arms.after.y - position.y)
    }
  );
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

    /* The seams belong to the bend that just went. */
    if (run?.geometry?.bendJoints) {
      delete run.geometry.bendJoints;
    }

    /*
     * AND THE RUN IS WHOLE AGAIN.
     *
     * Seating a run MOVES its joined end onto the bend's tangent point. With the
     * bend gone that end is a stub of pipe no longer accounted for by anything:
     * the run is left short of the point the student drew it to, and - because a
     * disconnected run carries no seat - left there forever, so the pipe could
     * never be re-joined at the end it visibly still has. The span remembers both
     * ends as they were drawn (see `runSpan`), so the run is restored from it.
     * This is the elbow's counterpart of giving a split pipe its length back.
     */
    restoreRunSpan(run);
  });
}

/* Put a run's stored ends back on the span it was drawn along. */
export function restoreRunSpan(run) {
  const span = run?.geometry?.span;

  if (!span?.start || !span?.end || !run?.geometry) {
    return false;
  }

  run.geometry = {
    ...run.geometry,
    start: { x: span.start.x, y: span.start.y },
    end: { x: span.end.x, y: span.end.y }
  };

  return true;
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
 * WHICH END OF WHICH RUN is read from the runs' own geometry, never assumed.
 * The elbow joins the first run at the end it SHARES WITH the second - which is
 * its `end` on the path the student drew, but may be its `start` after the pair
 * is re-joined the other way round. Trimming the wrong end would leave the run
 * running straight into the bend at its far side and ending short at its near
 * one, so the join is re-read here from the same corner the fitting was built
 * from.
 *
 * `joint` lets the caller pass the join as it was BEFORE the runs were re-seated
 * - the only reading that is still exact once a run's endpoint has moved onto
 * its tangent point.
 */
function applyTrimTo(elbow, objects = drawingState.objects, joint = null) {
  const [first, second] = connectedRunsOf(elbow, objects);
  const trim = Number(elbow?.engineering?.bendTrim);

  const joined = joint || (first && second ? joiningCornerOf(first, second) : null);

  /*
   * A FITTING MAY BE JOINED AT ONE END. A manually drawn elbow can be attached
   * to one pipe and left free at the other, which is a valid state rather than
   * an error. The end that IS joined still takes its width from that run, so
   * the wall it meets stays continuous; the free end keeps whatever width it
   * already had.
   */
  if (!first && !second) {
    return;
  }

  elbow.engineering = {
    ...(elbow.engineering || {}),
    ...(first
      ? { startSeparation: enggPipeDuct.boundarySeparation(first.engineering || {}) }
      : {}),
    ...(second
      ? { endSeparation: enggPipeDuct.boundarySeparation(second.engineering || {}) }
      : {})
  };

  if (!Number.isFinite(trim) || trim <= 0) {
    return;
  }

  /*
   * WHICH END OF EACH RUN IS TRIMMED IS READ FROM THE JOIN, not assumed from the
   * order the pair is stored in. The corner names the end of the FIRST and of
   * the SECOND run it eats - and for a corner carrying no such record the end
   * nearer the joint is the one, which is right in every end combination.
   */
  const endOfRun = (run) => {
    /*
     * THE FITTING'S OWN RECORD IS THE AUTHORITY. `updateElbowForPair` has just
     * written `ports` from the corner, keyed by run id, so it says which end of
     * THIS run the bend holds whichever way round the pair was passed - and it
     * is the same record `reseatElbowPipes` and the seam writer read.
     */
    const recorded = elbow?.engineering?.ports?.[run?.id];

    if (recorded === "start" || recorded === "end") {
      return recorded;
    }

    /* A fitting with no record yet: the end nearer the corner is the one. */
    const joint = joined?.vertex;

    if (!joint || !run?.geometry) {
      return "end";
    }

    const gap = (end) => Math.hypot(run.geometry[end].x - joint.x, run.geometry[end].y - joint.y);

    return gap("start") <= gap("end") ? "start" : "end";
  };

  if (first) {
    first.geometry = {
      ...(first.geometry || {}),
      trims: { ...(first.geometry?.trims || {}), [endOfRun(first)]: trim }
    };
  }

  if (second) {
    second.geometry = {
      ...(second.geometry || {}),
      trims: { ...(second.geometry?.trims || {}), [endOfRun(second)]: trim }
    };
  }
}

/*
 * ========================================================
 * RE-SEATING A RUN ON ITS FITTING
 * ========================================================
 *
 * A RUN JOINED TO A FITTING ENDS AT THAT FITTING'S TANGENT POINT, and nowhere
 * else. `trims` only shortens the DRAWN walls, so the run's own endpoint has to
 * move with them or the straight section stops short of the arc and leaves a
 * visible gap.
 *
 * THAT GAP IS WHAT A RADIUS CHANGE USED TO CREATE. The tangent points slide
 * along each pipe's centreline as the radius grows, but the pipes stayed where
 * they were - so the fitting detached by exactly the change in tangent length.
 *
 * This is the missing half: each joined pipe follows its tangent point, keeping
 * its OUTER endpoint exactly where the student left it and changing only its own
 * inner end. Nothing here reads or writes a pipe's width, appearance or id.
 *
 * `endId` is the run's own end - "start" or "end" - which the caller reads from
 * the elbow's recorded ports. Only that end moves.
 *
 * `curves` lets a caller supply the bend geometry it has ALREADY measured - which
 * it must do when re-seating both pipes of one bend, because the first pipe to
 * move changes the distances the second one's tangent points would be measured
 * against.
 */
export function reseatRunOnElbow(run, elbow, endId = null, curves = null) {
  if (!run || !enggPipeDuct.isPipeDuctType(run.type)) {
    return false;
  }

  /*
   * A RUN IS SEATED BY ITS OWN END. `ports` says which of the run's ends the
   * fitting holds; without it the tangent point itself says so, because it lies
   * nearest the end that meets the bend. Neither a pipe drawn backwards nor a
   * start-to-start join is then seated at its far end.
   */
  const recorded = elbow?.engineering?.ports?.[run.id];

  const heldByRun = recorded === "start" || recorded === "end"
    ? recorded
    : enggPipeDuct.elbowHeldEndOf(run, elbow);

  const bend = curves || enggPipeDuct.elbowCurvesFor(elbow);

  const start = run.geometry?.start;
  const end = run.geometry?.end;

  if (!bend || !start || !end) {
    return false;
  }

  const held = endId === "start" || endId === "end" ? endId : heldByRun;

  if (!held) {
    return false;
  }

  /*
   * WHICH ARC END BELONGS TO THIS PIPE IS DECIDED BY THE ARM IT ARRIVES ON.
   *
   * The elbow is built from `previous -> vertex -> next`, so `curves.start` is
   * the tangent on the PREVIOUS arm and `curves.end` the one on the NEXT - and
   * `connections` IS stored in that same order (`updateElbowForPair`), so a run's
   * POSITION in the pair names its arc. Endpoint discovery may pass the pair in
   * either order, which is why the position - not the argument - is read.
   *
   * So the arm is read from the GEOMETRY: the pipe whose centreline runs along
   * the `previous` arm takes `curves.start`, and the one along `next` takes
   * `curves.end`. The test is which of the elbow's two arms the pipe's far end
   * lies nearest, measured as a direction from the corner - exact, and
   * independent of the order the pair is stored in.
   */
  const corner = elbow.geometry?.position;

  const previous = elbow.geometry?.previous;
  const next = elbow.geometry?.next;

  if (!corner || !previous || !next) {
    return false;
  }

  const far = held === "start" ? end : start;

  const alongPrevious = {
    x: previous.x - corner.x,
    y: previous.y - corner.y
  };

  const alongNext = { x: next.x - corner.x, y: next.y - corner.y };

  /*
   * WHICH ARM THIS RUN LIES ALONG.
   *
   * Measured as the ANGLE between the run's own direction and each arm, not as
   * a projection: both arms point out from the corner, but an obtuse bend's
   * arms stand on opposite sides of it, so their lengths and relative signs
   * are irrelevant and only their DIRECTION names the arm. A 150 degree bend is
   * exactly the case where a projection test picks the wrong one and seats
   * both pipes on the same tangent.
   */
  const along = enggPipeDuct.directionOf(far, corner) || { x: 0, y: 0 };

  const angleTo = (arm) => {
    const scale = Math.hypot(arm.x, arm.y) * Math.hypot(along.x, along.y);

    if (!(scale > 1e-12)) {
      return Math.PI;
    }

    const cosine = Math.max(-1, Math.min(1, (arm.x * along.x + arm.y * along.y) / scale));

    return Math.acos(cosine);
  };

  const order = Array.isArray(elbow?.engineering?.connections)
    ? elbow.engineering.connections
    : [];

  const seat = order.indexOf(run.id) === 1 ? bend.end : bend.start;

  const tangent = angleTo(alongPrevious) <= angleTo(alongNext) ? bend.start : bend.end;

  /* The stored pair is the authority; the arm reading only covers an older file. */
  const chosen = (order.includes(run.id) ? seat : tangent);

  if (!tangent) {
    return false;
  }

  /*
   * A RUN IS TRIMMED, NOT STRETCHED. `run.geometry.span` is the line the run was
   * drawn along, so the run's own ends run from that line's far end to the
   * tangent point. A run that would have to reach FURTHER than it was drawn to
   * touch the tangent point is not the run that meets this bend, so nothing is
   * moved rather than inventing length the student never drew.
   */
  const span = run.geometry?.span &&
    enggPipeDuct.directionOf(run.geometry.span.start, run.geometry.span.end)
      ? run.geometry.span
      : null;

  if (span) {
    const spanLength = Math.hypot(span.end.x - span.start.x, span.end.y - span.start.y);

    const farPoint = held === "start" ? span.end : span.start;

    if (Math.hypot(chosen.x - farPoint.x, chosen.y - farPoint.y) > spanLength + 1e-6) {
      return false;
    }
  }

  run.geometry = {
    ...run.geometry,
    [held]: { x: chosen.x, y: chosen.y },

    /*
     * THE LINE THE RUN WAS DRAWN ALONG IS KEPT. The near end has just moved onto
     * the tangent point, so the two stored points are no longer the run's full
     * straight extent - but the walls are OFFSET FROM THAT LINE, so it has to
     * survive being seated. See `runSpan` in the model.
     */
    ...(run.geometry?.span
      ? {}
      : {
          span: {
            start: { x: run.geometry.start.x, y: run.geometry.start.y },
            end: { x: run.geometry.end.x, y: run.geometry.end.y }
          }
        })
  };

  return true;
}

/*
 * RE-SEAT EVERY RUN JOINED TO AN ELBOW.
 *
 * The ends are read from the elbow's own `ports` record, which is keyed by run id,
 * so each pipe is moved at the end it is actually held by - and a pipe joined at
 * one end keeps its other end where it is.
 */
export function reseatElbowPipes(elbow, objects = drawingState.objects, curves = null) {
  if (!elbow || !enggPipeDuct.isElbowType(elbow.type)) {
    return false;
  }

  const ids = elbow.engineering?.connections;

  if (!Array.isArray(ids) || !ids.some(Boolean)) {
    return false;
  }

  const ports = elbow.engineering?.ports;

  const bend = curves || enggPipeDuct.elbowCurvesFor(elbow);

  if (!bend) {
    return false;
  }

  let moved = false;

  /*
   * EACH RUN IS SEATED ON ITS OWN ARM. `connections` is stored in the fitting's
   * order - arriving run first - so the run at index 0 meets `bend.start` and
   * the one at index 1 meets `bend.end`, WHATEVER END OF THE PIPE EACH IS. The
   * end is the one `cornerOf` recorded in `ports`; only a record written before
   * ports existed falls back to the bend's own tangent points.
   */
  ids.forEach((id, index) => {
    const run = id ? (objects || []).find((object) => object.id === id) : null;

    if (!run) {
      return;
    }

    const recorded = ports && typeof ports === "object" && !Array.isArray(ports) ? ports[id] : null;

    const held = recorded === "start" || recorded === "end"
      ? recorded
      : enggPipeDuct.elbowHeldEndOf(run, elbow, bend);

    if (!held) {
      return;
    }

    const bendEnd = index === 0 ? bend.start : bend.end;

    run.geometry = {
      ...run.geometry,
      [held]: { x: bendEnd.x, y: bendEnd.y },
      ...(run.geometry?.span
        ? {}
        : {
            span: {
              start: { x: run.geometry.start.x, y: run.geometry.start.y },
              end: { x: run.geometry.end.x, y: run.geometry.end.y }
            }
          })
    };

    moved = true;
  });

  return moved;
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

/*
 * ========================================================
 * THE ELBOW TOOL: MANUAL CREATION
 * ========================================================
 *
 * The Elbow tool is the SAME click-hold-drag gesture Pipe / Duct uses: press at
 * the first end, drag, release at the second. What it creates is ONE Elbow
 * feature - never two lines - and, where the two ends land on valid pipe
 * endpoints, it records the connections and adopts the pipes' geometry.
 *
 * THE THREE STATES, and they are all the same object type:
 *
 *   connected   both ends on pipe endpoints: the bend follows the pipes
 *   partial     one end on a pipe endpoint: that end follows, the other is free
 *   standalone  neither end attached: a 90 degree bend the student arranges
 *
 * THE CONNECTION RECORD is the SAME one the automatic fitting uses - a pair of
 * run ids on `engineering.connections`, positionally A then B - so the
 * connection model, the removal-by-parent rule and the future assembly work
 * all read one thing. A free end is simply a null slot in that pair, so the
 * record says which end is attached rather than needing a second field.
 *
 * THE ANGLE. A connected corner takes the pipes' own direction change. A
 * standalone elbow is a 90 degree bend. A partially connected one takes the
 * angle between its attached pipe's direction and the direction the student
 * dragged the free end along, snapped to the common angles - which is what lets
 * the free end define the bend while the attached end follows its pipe.
 */

export const ELBOW_PHASE = "elbow-construct";

/*
 * The angle a manual elbow is given when neither end is constrained. It is the
 * right angle every bend is drawn at first, and the student changes it from the
 * Features tab or by dragging the angle handle.
 */
export const DEFAULT_ELBOW_TOOL_ANGLE = 90;

/*
 * ========================================================
 * WHICH PIPE END, IF ANY, A POINT IS ON
 * ========================================================
 *
 * A run publishes exactly two connection targets - the ends of its centreline.
 * The two boundary walls are NOT targets, which is the "snap on the two
 * boundary lines must not create conflicting feature endpoints" rule; a wall is
 * derived from the centreline and has no separate identity.
 *
 * The tolerance is the shared connection tolerance (`CONTINUATION_TOLERANCE`),
 * and the point has already been through the snap resolver, so a point that is
 * within it is a point the student's snap indicator showed them.
 */
export function pipeEndAt(point, objects = drawingState.objects) {
  if (!point) {
    return null;
  }

  let best = null;

  (objects || []).forEach((object) => {
    if (!enggPipeDuct.isPipeDuctType(object.type)) {
      return;
    }

    enggPipeDuct.portsOf(object).forEach((port) => {
      const distance = Math.hypot(port.point.x - point.x, port.point.y - point.y);

      if (distance > CONTINUATION_TOLERANCE) {
        return;
      }

      if (!best || distance < best.distance) {
        best = { run: object, port: port.id, point: { x: port.point.x, y: port.point.y }, distance };
      }
    });
  });

  return best;
}

/*
 * THE DIRECTION A PIPE END POINTS OUT OF ITS RUN.
 *
 * A run's `end` faces away from its interior, and its `start` faces away in the
 * opposite direction. An elbow joined there runs ON from the pipe, so its arm
 * at that end continues outwards - which is the direction the bend is built
 * from.
 */
export function pipeOutwardDirection(match) {
  if (!match?.run) {
    return null;
  }

  const start = match.run.geometry?.start;
  const end = match.run.geometry?.end;

  if (!start || !end) {
    return null;
  }

  const away = enggPipeDuct.directionOf(
    match.port === "end" ? start : end,
    match.port === "end" ? end : start
  );

  return away;
}

/*
 * ========================================================
 * THE ELBOW A GESTURE WOULD CREATE
 * ========================================================
 *
 * Pure geometry: given the two drawn ends and the pipes they landed on, work
 * out the corner, the angle, the two arms and the radius. Nothing is written.
 * The PREVIEW and the COMMIT both call this, so what the student sees while
 * dragging is exactly what is created.
 *
 * `preview` is used by the source's own `elbowFromEnds` when neither end is
 * attached, and adapted here when one or both are:
 *
 *   CONNECTED     each attached end's ARM follows its pipe's outward
 *                 direction, so the bend is oriented by the pipes it joins.
 *   PARTIAL       the attached arm follows its pipe; the free arm is the one
 *                 the student dragged, and the angle is the angle between
 *                 them.
 *   STANDALONE    both arms come from the chord, at the tool's default angle.
 */
export function elbowGeometryFromGesture(start, end, startMatch, endMatch, options = {}) {
  if (!start || !end) {
    return null;
  }

  const base = enggPipeDuct.elbowFromEnds(
    start,
    end,
    options.angleDegrees ?? DEFAULT_ELBOW_TOOL_ANGLE
  );

  if (!base) {
    return null;
  }

  /* Nothing attached: the chord-derived corner is the whole answer. */
  if (!startMatch && !endMatch) {
    return {
      geometry: base,
      angleDegrees: base.angleDegrees
    };
  }

  /*
   * EACH ATTACHED END BRINGS ITS ARM. An attached end is re-aimed along its
   * pipe's outward direction, and the corner is where the two arms meet. When
   * BOTH ends are attached the pipes decide the corner entirely - they already
   * meet there - so the drawn ends are replaced by the pipes' own ends.
   */
  const attached = {
    a: startMatch ? { ...startMatch.point, direction: pipeOutwardDirection(startMatch) } : null,
    b: endMatch ? { ...endMatch.point, direction: pipeOutwardDirection(endMatch) } : null
  };

  if (attached.a && attached.b) {
    /*
     * TWO PIPES DECIDE THE WHOLE BEND.
     *
     * Their ends ARE the corner between them - they already meet there - so the
     * fitting's corner is the point where the two arms meet, which for two ends
     * that coincide is that point itself. The bend angle is the turn between the
     * two runs' directions.
     */
    const pointA = { x: attached.a.x, y: attached.a.y };
    const pointB = { x: attached.b.x, y: attached.b.y };

    const arms = enggPipeDuct.angleBetweenDirections(attached.a.direction, attached.b.direction);

    const angle = arms === null ? DEFAULT_ELBOW_TOOL_ANGLE : 180 - arms;

    return {
      geometry: {
        position: {
          x: (pointA.x + pointB.x) / 2,
          y: (pointA.y + pointB.y) / 2
        },
        ends: { a: pointA, b: pointB },
        previous: pointA,
        next: pointB,
        angleDegrees: angle
      },
      angleDegrees: angle
    };
  }

  /* One end attached: the free end keeps the student's drawn position. */
  const anchored = attached.a || attached.b;
  const free = attached.a ? { x: end.x, y: end.y } : { x: start.x, y: start.y };

  const arm = enggPipeDuct.directionOf({ x: anchored.x, y: anchored.y }, free);

  /*
   * THE BEND IS THE ANGLE BETWEEN THE TWO ARMS.
   *
   * The attached arm is its pipe's outward direction; the free arm is the one
   * the student dragged. Their included angle is snapped to the common stops, so
   * a partial elbow opens at 30, 45, 60, 90 or 135 whenever the drag is near one.
   */
  const angle =
    arm && anchored.direction
      ? snapAngle(180 - (enggPipeDuct.angleBetweenDirections(anchored.direction, arm) ?? 90))
      : DEFAULT_ELBOW_TOOL_ANGLE;

  /*
   * THE FREE ARM IS THE STUDENT'S, THE ATTACHED ARM IS ITS PIPE'S.
   *
   * `solveElbowCorner` places the corner from the two ENDS and the angle; the
   * only thing passed here is WHICH SIDE of the chord it goes on. The free end
   * is on the side the corner must be near (the leg runs from the corner to it),
   * so the fallback point is offset from the chord's midpoint toward the free
   * end - which on the tiny-bend side is decisive, and on a right angle harmless.
   */
  const chordMidpoint = midpointOf(
    attached.a ? attached.a : free,
    attached.b ? attached.b : free
  );

  const prefer = arm
    ? {
        x: chordMidpoint.x + arm.x * Math.abs(
          (free.x - (attached.a || attached.b).x) * arm.x +
          (free.y - (attached.a || attached.b).y) * arm.y
        ) / 2,
        y: chordMidpoint.y + arm.y * Math.abs(
          (free.x - (attached.a || attached.b).x) * arm.x +
          (free.y - (attached.a || attached.b).y) * arm.y
        ) / 2
      }
    : chordMidpoint;

  const solved = enggPipeDuct.solveElbowCorner(
    attached.a ? attached.a : free,
    attached.b ? attached.b : free,
    angle,
    prefer
  );

  if (!solved) {
    return null;
  }

  const legA = attached.a || free;
  const legB = attached.b || free;

  return {
    geometry: {
      position: solved.position,
      ends: { a: { x: legA.x, y: legA.y }, b: { x: legB.x, y: legB.y } },
      previous: { x: legA.x, y: legA.y },
      next: { x: legB.x, y: legB.y },
      angleDegrees: solved.angleDegrees
    },
    angleDegrees: solved.angleDegrees
  };
}

function midpointOf(left, right) {
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

function snapAngle(degrees) {
  return enggPipeDuct.snapElbowAngle(degrees) ?? DEFAULT_ELBOW_TOOL_ANGLE;
}

/*
 * ========================================================
 * THE LIVE PREVIEW
 * ========================================================
 *
 * The preview is the FEATURE's own geometry - the same corner, arms and radius
 * the commit stores - so the two curved boundaries cannot jump on release.
 * While the cursor is still near the press there is nothing to draw.
 */
export function elbowGesturePreview(interaction, cursorPoint) {
  const start = interaction?.elbowStart || interaction?.routeResolvedStart || null;

  if (!start || !cursorPoint) {
    return null;
  }

  if (Math.hypot(cursorPoint.x - start.x, cursorPoint.y - start.y) < 1e-6) {
    return null;
  }

  const startMatch = interaction.elbowStartMatch || null;

  const endMatch = pipeEndAt(cursorPoint);

  const built = elbowGeometryFromGesture(start, cursorPoint, startMatch, endMatch, {
    angleDegrees: interaction.elbowAngle ?? DEFAULT_ELBOW_TOOL_ANGLE
  });

  if (!built) {
    return null;
  }

  return {
    ...built.geometry,
    engineering: {
      bendRadius:
        Number(interaction.elbowBendRadius) > 0
          ? Number(interaction.elbowBendRadius)
          : enggPipeDuct.readDefaultBendRadius(),
      angleDegrees: built.angleDegrees
    }
  };
}

/* The message shown while the elbow is being dragged. */
export function elbowInstruction() {
  return "Press and drag to draw an Elbow between two ends";
}

/*
 * ========================================================
 * COMMIT A MANUAL ELBOW
 * ========================================================
 *
 * Creates ONE elbow, records whichever connections the two ends landed on,
 * adopts the first connected pipe's appearance, and - for a connected end -
 * lets the pipe's geometry orient the bend. In one undoable operation.
 */
export function commitElbowGesture(start, end, interaction = {}) {
  if (!start || !end) {
    return null;
  }

  if (Math.hypot(end.x - start.x, end.y - start.y) < 1e-6) {
    return null;
  }

  const startMatch = interaction.elbowStartMatch || pipeEndAt(start);
  const endMatch = pipeEndAt(end);

  /*
   * THE SAME PIPE AT BOTH ENDS is not a connection - an elbow joins two ends,
   * and a run cannot be bent round onto itself by one fitting.
   */
  if (startMatch && endMatch && startMatch.run.id === endMatch.run.id) {
    return null;
  }

  const built = elbowGeometryFromGesture(start, end, startMatch, endMatch, {
    angleDegrees: interaction.elbowAngle ?? DEFAULT_ELBOW_TOOL_ANGLE
  });

  if (!built) {
    return null;
  }

  const previousObjects = enggDrawingState.snapshotDrawing(drawingState);

  const connections = [
    startMatch ? startMatch.run.id : null,
    endMatch ? endMatch.run.id : null
  ];

  const style = inheritedElbowStyle(startMatch, endMatch, interaction);

  const engineering = {
    ...(interaction.elbowEngineering || {}),
    angleDegrees: built.angleDegrees,
    angle: built.angleDegrees,
    bendRadius:
      Number(interaction.elbowBendRadius) > 0
        ? Number(interaction.elbowBendRadius)
        : enggPipeDuct.readDefaultBendRadius(),
    connections,
    connected: connections.some(Boolean),
    generated: false
  };

  const elbow = enggPipeDuct.createElbow({
    geometry: built.geometry,
    engineering,
    style
  });

  if (!elbow) {
    return null;
  }

  /*
   * A CONNECTED MANUAL ELBOW TAKES ITS ARM FROM THE PIPE'S CENTRELINE, so the
   * bend starts where the pipe actually ends and the visible straight run stops
   * at the bend's tangent point.
   */
  if (startMatch) {
    armFromPipe(elbow, "a", startMatch);
  }

  if (endMatch) {
    armFromPipe(elbow, "b", endMatch);
  }

  enggDrawingState.addObject(drawingState, elbow);

  applyManualElbowConnections(elbow, drawingState.objects);

  enggDrawingState.commitDrawingChange(drawingState, previousObjects);

  const committed = drawingState.objects.find((object) => object.id === elbow.id) || elbow;

  applyManualElbowConnections(committed, drawingState.objects);

  setToolMessage(
    describeElbowCreation(committed, startMatch, endMatch)
  );

  renderProperties();
  renderCurrentDrawing();

  return { elbow: committed };
}

function describeElbowCreation(elbow, startMatch, endMatch) {
  const attached = [startMatch, endMatch].filter(Boolean).length;

  if (attached === 2) {
    return `${elbow.name} created between ${startMatch.run.name} and ${endMatch.run.name}`;
  }

  if (attached === 1) {
    return `${elbow.name} created, attached to ${(startMatch || endMatch).run.name}`;
  }

  return `${elbow.name} created`;
}

/*
 * ========================================================
 * APPEARANCE FOR A MANUAL ELBOW
 * ========================================================
 *
 * It inherits from the FIRST pipe it connects to, and the values are COPIED at
 * that moment. Nothing here writes to the pipe, so a fitting can never restyle
 * the pipework it joins; and nothing reads the pipe again afterwards, so the
 * fitting's own later edits survive.
 */
function inheritedElbowStyle(startMatch, endMatch, interaction = {}) {
  const source = startMatch?.run || endMatch?.run;

  if (source?.style) {
    return { ...source.style };
  }

  return { ...(interaction.elbowStyle || drawingState.styleDefaults || {}) };
}

/*
 * Point one end of a manual elbow at the pipe it is joined to.
 *
 * The end BECOMES the pipe's own endpoint - that is the connection - and the
 * bend is re-solved from the two ends at the angle the fitting already has.
 * The corner therefore sits on the pipe's end, provided the angle the gesture
 * produced agrees with the two arms; a change of pipe simply re-places it.
 */
function armFromPipe(elbow, endId, match) {
  const geometry = elbow.geometry || {};

  if (!match?.run?.geometry) {
    return;
  }

  const otherEnd = endId === "a" ? geometry.ends?.b : geometry.ends?.a;

  if (!otherEnd) {
    return;
  }

  elbow.geometry = {
    ...geometry,
    ends: { ...geometry.ends, [endId]: { ...match.point } },
    previous: endId === "a" ? { ...match.point } : geometry.previous,
    next: endId === "b" ? { ...match.point } : geometry.next
  };

  const angle = enggPipeDuct.elbowAngleDegrees(elbow);

  if (angle === null) {
    return;
  }

  const ends = elbow.geometry.ends;

  const solved = enggPipeDuct.solveElbowCorner(
    ends.a,
    ends.b,
    angle,
    geometry.position
  );

  if (!solved) {
    return;
  }

  elbow.geometry = {
    ...elbow.geometry,
    position: solved.position,
    previous: { ...ends.a },
    next: { ...ends.b }
  };
}

/*
 * ========================================================
 * APPLY AN ELBOW'S CONNECTIONS TO THE PIPES
 * ========================================================
 *
 * The mirror of `applyTrimTo` for a manually drawn fitting: each joined pipe is
 * trimmed back to the tangent point where the bend begins, and the fitting's
 * two ends take the pipe widths they meet. A free end contributes nothing.
 *
 * It is idempotent, so it can be called again after every edit without
 * accumulating trims or connection records.
 */
export function applyManualElbowConnections(elbow, objects = drawingState.objects) {
  if (!elbow || !enggPipeDuct.isElbowType(elbow.type)) {
    return false;
  }

  const ids = elbow.engineering?.connections;

  const runs = Array.isArray(ids)
    ? ids.map((id) => (id ? (objects || []).find((object) => object.id === id) || null : null))
    : [null, null];

  const curves = enggPipeDuct.elbowCurvesFor(elbow);

  /*
   * THE BEND'S TRIM REACHES FROM THE TANGENT POINT TO ITS PIPE'S END. It is the
   * distance the elbow eats into that run, which is what the run is drawn short
   * by - the same quantity the automatic fitting's `bendTrim` states.
   */
  const trimFor = (endId) => {
    if (!curves) {
      return 0;
    }

    const tangent = endId === "a" ? curves.start : curves.end;
    const end = elbow.geometry?.ends?.[endId];

    return end ? Math.hypot(tangent.x - end.x, tangent.y - end.y) : 0;
  };

  elbow.engineering = {
    ...(elbow.engineering || {}),
    ...(runs[0]
      ? {
          startSeparation: enggPipeDuct.boundarySeparation(runs[0].engineering || {}),
          bendTrimA: trimFor("a")
        }
      : {}),
    ...(runs[1]
      ? {
          endSeparation: enggPipeDuct.boundarySeparation(runs[1].engineering || {}),
          bendTrimB: trimFor("b")
        }
      : {}),
    connected: Boolean(runs[0] || runs[1])
  };

  /*
   * AN END THAT IS NO LONGER JOINED CLAIMS NO WIDTH FROM A PIPE.
   *
   * The two endpoint widths are what keeps each wall continuous with the run it
   * meets. Once that run is gone the value would describe a join that no longer
   * exists, so it is REMOVED rather than left behind - a stale width is exactly
   * the "residual geometry" the connection rules forbid.
   */
  if (!runs[0]) {
    delete elbow.engineering.startSeparation;
    delete elbow.engineering.bendTrimA;
  }

  if (!runs[1]) {
    delete elbow.engineering.endSeparation;
    delete elbow.engineering.bendTrimB;
  }

  runs.forEach((run, index) => {
    if (!run) {
      return;
    }

    const end = index === 0 ? "end" : "start";
    const trim = index === 0 ? elbow.engineering.bendTrimA : elbow.engineering.bendTrimB;

    run.geometry = {
      ...(run.geometry || {}),
      trims: { ...(run.geometry?.trims || {}), [end]: trim }
    };
  });

  /*
   * THE PIPE ENDS STAY ON THE TANGENT POINTS.
   *
   * A BEND RADIUS CHANGE SLIDES EACH TANGENT POINT ALONG ITS PIPE, so a pipe
   * left where it was would be separated from the fitting by exactly the change
   * in trim - the visible gap a radius edit used to open. The pipe follows the
   * tangent point at the end the bend holds, keeping its OUTER end exactly where
   * the student left it; only its joined end moves.
   */
  if (curves) {
    runs.forEach((run, index) => {
      if (!run) {
        return;
      }

      holdRunOnTangent(run, index === 0 ? "end" : "start", index === 0 ? curves.start : curves.end);
    });
  }

  /*
   * THE SEAM EACH JOINED WALL ENDS ON, recorded on the RUN.
   *
   * The renderer draws a run's walls from the run alone, so the one end that
   * meets the bend has to know where that bend's arcs begin. `bendJoints[end]`
   * is those points, in `boundaryLines`' own order, and it is rewritten whenever
   * the bend changes - a radius change, a new angle - so the wall and the arc
   * are always cut to the same coordinate and can neither overlap nor gap.
   */
  runs.forEach((run, index) => {
    if (!run?.geometry) {
      return;
    }

    const end = index === 0 ? "end" : "start";

    const tangent = index === 0 ? curves.start : curves.end;

    const seam = enggPipeDuct.wallSeam(run, elbow, tangent, index === 1);

    const joints = { ...(run.geometry.bendJoints || {}) };

    if (seam && Number(run.geometry?.trims?.[end]) > 0) {
      joints[end] = seam;
    } else {
      delete joints[end];
    }

    run.geometry = {
      ...run.geometry,
      ...(Object.keys(joints).length ? { bendJoints: joints } : { bendJoints: undefined })
    };
  });

  return true;
}

/*
 * MOVE ONE END OF A RUN ONTO THE BEND'S TANGENT POINT.
 *
 * THE OTHER END DOES NOT MOVE. That is what preserves the student's pipework:
 * a larger bend eats further along the straight run, and the run simply gets
 * shorter - it never slides, and it never lets go.
 *
 * WHICH END OF THE RUN CARRIES THE SEAM is decided by the run's own line, not
 * by the side of the fitting: the end nearest the tangent point is the one the
 * run meets the bend at. That holds for a pipe drawn in either direction, for
 * every end-to-end combination, and for a pipe whose far end happens to lie
 * nearer the bend than the joint does.
 *
 * A RUN THAT HAS BEEN LENGTHENED over the tangent point is not shortened: the
 * tangent lies on the run either way, and taking length off a pipe the student
 * just drew would fight their edit. The bend simply continues along it.
 */
function holdRunOnTangent(run, end, tangent) {
  if (!run?.geometry || !tangent) {
    return false;
  }

  const direction = enggPipeDuct.directionOf(run.geometry.start, run.geometry.end);

  if (!direction) {
    return false;
  }

  /* The fraction of the run the tangent sits at, from `start`. */
  const length = Math.hypot(
    run.geometry.end.x - run.geometry.start.x,
    run.geometry.end.y - run.geometry.start.y
  );

  const along =
    (tangent.x - run.geometry.start.x) * direction.x +
    (tangent.y - run.geometry.start.y) * direction.y;

  if (along < 0 || along > length) {
    return false;
  }

  const at = end === "start" ? along <= 1e-6 : along >= length - 1e-6;

  if (!at) {
    return false;
  }

  const current = run.geometry[end];

  if (current && Math.hypot(current.x - tangent.x, current.y - tangent.y) < 1e-9) {
    return false;
  }

  run.geometry = {
    ...run.geometry,
    [end]: { x: tangent.x, y: tangent.y }
  };

  return true;
}

/*
 * ========================================================
 * KEEPING A MANUAL ELBOW STRAIGHT AFTER PIPE EDITS
 * ========================================================
 *
 * Called after a pipe or an elbow has changed. A MANUAL elbow stays attached as
 * its pipes move: the attached ends follow their pipe ends, and the bend is
 * re-solved from the ends and its angle. A GENERATED elbow is already handled by
 * `refreshFluidConnections` - it exists because two runs meet, and it goes when
 * they no longer do - so it is skipped here.
 */
export function refreshManualElbow(elbow, objects = drawingState.objects) {
  if (!elbow || !enggPipeDuct.isElbowType(elbow.type)) {
    return false;
  }

  if (elbow.engineering?.generated === true) {
    return false;
  }

  const ids = elbow.engineering?.connections;

  if (!Array.isArray(ids)) {
    return false;
  }

  const runs = ids.map((id) =>
    id ? (objects || []).find((object) => object.id === id) || null : null
  );

  /* A run recorded as connected is gone: that end is free now. */
  const dropped = ids.some((id, index) => Boolean(id) && !runs[index]);

  if (dropped) {
    elbow.engineering = {
      ...(elbow.engineering || {}),
      connections: runs.map((run, index) => (run ? ids[index] : null))
    };
  }

  const ends = {
    a: elbow.geometry?.ends?.a ? { ...elbow.geometry.ends.a } : null,
    b: elbow.geometry?.ends?.b ? { ...elbow.geometry.ends.b } : null
  };

  if (!ends.a || !ends.b) {
    return false;
  }

  /*
   * EACH JOINED END GOES BACK ONTO THE END OF ITS PIPE THAT THE BEND HOLDS.
   *
   * A connected elbow records the run and the pipe end in `ports`, and the pipe
   * has been cut back to the bend's tangent point - so the nearest end is the
   * tangent point, and the other end stays where it was. A pipe that has been
   * REVERSED would move the bend to its far end if the end were guessed, so the
   * recorded port is used whenever there is one.
   */
  const portsBefore = elbow.engineering?.ports && !Array.isArray(elbow.engineering.ports)
    ? { ...elbow.engineering.ports }
    : {};

  /*
   * A CONNECTED END IS RECORDED THE FIRST TIME IT SITS ON ITS PIPE, and kept
   * from then on. A manual elbow joins its pipe at the pipe's own endpoint, and
   * which endpoint that is - `start` or `end` - does not change when the bend is
   * re-solved. A pipe drawn in either direction, after all four combinations of
   * joins, is then followed at the end the bend is actually seated on.
   */
  runs.forEach((run, index) => {
    if (!run || !ids[index]) {
      return;
    }

    if (portsBefore[run.id] !== "start" && portsBefore[run.id] !== "end") {
      const end = elbow.geometry?.ends?.[index === 0 ? "a" : "b"];

      if (!end || !run.geometry?.start || !run.geometry?.end) {
        return;
      }

      portsBefore[run.id] =
        Math.hypot(end.x - run.geometry.start.x, end.y - run.geometry.start.y) <=
        Math.hypot(end.x - run.geometry.end.x, end.y - run.geometry.end.y)
          ? "start"
          : "end";
    }
  });

  elbow.engineering = { ...(elbow.engineering || {}), ports: portsBefore };

  const portOf = (index) => {
    const recorded = ids[index] ? portsBefore[ids[index]] : null;

    return recorded === "start" || recorded === "end" ? recorded : null;
  };

  if (runs[0]) {
    ends.a = seatedPointOnBench(runs[0], portOf(0), ends.a, elbow);
  }

  if (runs[1]) {
    ends.b = seatedPointOnBench(runs[1], portOf(1), ends.b, elbow);
  }


  const angle = enggPipeDuct.elbowAngleDegrees(elbow);

  if (angle === null) {
    return false;
  }

  const solved = enggPipeDuct.solveElbowCorner(ends.a, ends.b, angle, elbow.geometry.position);

  if (!solved) {
    return false;
  }

  elbow.geometry = {
    ...elbow.geometry,
    position: solved.position,
    ends,
    previous: { x: ends.a.x, y: ends.a.y },
    next: { x: ends.b.x, y: ends.b.y }
  };

  applyManualElbowConnections(elbow, objects);

  return true;
}

/*
 * WHERE A MANUAL ELBOW'S END SITS AFTER ITS PIPE HAS BEEN RESHAPED.
 *
 * A CONNECTED END FOLLOWS THE TANGENT POINT ON ITS PIPE, not the pipe's stored
 * end. The tangent is where the bend is - it slides along the pipe when the
 * radius changes - so reading it from the BEND and projecting it onto the pipe
 * keeps the joint exactly on the pipe's centreline, whichever end of the pipe or
 * the fitting it is.
 *
 * A FREE END KEEPS WHAT WAS LAST SOLVED FOR IT, and a pipe that does not reach
 * the tangent point leaves the end where it was rather than inventing a seat.
 */
function seatedPointOnBench(run, endId, current, elbow) {
  if (!endId) {
    return current;
  }

  /*
   * THE PIPE'S OWN JOINED END IS THE SEAT ONCE IT HAS MOVED.
   *
   * A bend re-seats its pipe onto the tangent point, so the pipe's joined end IS
   * where it meets the bend - and a student dragging that end has moved the
   * join, not just the pipe. When that end no longer sits on the bend's previous
   * tangent, it is the CURRENT seat, and the bend follows it.
   */
  const at = run?.geometry?.[endId];

  const previousTangent = enggPipeDuct.elbowCurvesFor(elbow);

  const expected = previousTangent
    ? (endId === "end" ? previousTangent.start : previousTangent.end)
    : null;

  if (at && (!expected || Math.hypot(at.x - expected.x, at.y - expected.y) > CONTINUATION_TOLERANCE)) {
    return { x: at.x, y: at.y };
  }

  const direction = enggPipeDuct.directionOf(run?.geometry?.start, run?.geometry?.end);

  if (!direction) {
    return current;
  }

  /*
   * ONLY THE END OF THE RUN THAT FACES THE BEND CAN BE ITS SEAM. The other end
   * is the far end the student drew, and it stays where it is - moving it onto
   * the bend would shorten the pipe from the wrong side.
   */
  const outward = enggPipeDuct.directionOf(run.geometry, elbow.geometry?.position);

  if (!outward) {
    return current;
  }

  const facesTheBend =
    (endId === "start" ? -1 : 1) * (direction.x * outward.x + direction.y * outward.y) > 0;

  if (!facesTheBend) {
    return current;
  }

  const tangent = enggPipeDuct.tangentPointOnRun(run, endId, elbow);

  return tangent || elbowEndPointOn(run, endId, current);
}

/*
 * The pipe end an elbow's A or B joins.
 *
 * The RECORDED end (`ports`) wins when there is one. Without a record the
 * NEAREST end of the run is taken, which is the tangent point a bend has seated
 * the pipe on - and is right for the end the bend actually holds.
 */
function elbowEndPointOn(run, endId, current) {
  const ports = enggPipeDuct.portsOf(run);

  if (!ports.length) {
    return current;
  }

  const recorded = endId === "start" || endId === "end"
    ? ports.find((port) => port.id === endId)
    : null;

  const reference = current || run.geometry?.end;

  const nearest = ports.reduce((best, port) => {
    const distance = Math.hypot(port.point.x - reference.x, port.point.y - reference.y);

    return !best || distance < best.distance ? { ...port.point, distance } : best;
  }, null);

  return recorded && nearest
    ? { ...recorded.point, distance: nearest.distance }
    : nearest;
}

/*
 * ========================================================
 * ELBOW TOOL ARRIVAL
 * ========================================================
 *
 * Arming the tool does not begin a construction: the gesture begins on the
 * press, exactly as Pipe / Duct does. The tool is armed and idle.
 */
export function beginElbowConstruction() {
  enggDrawingState.setActiveTool(drawingState, "elbow");

  enggDrawingState.setInteraction(drawingState, {
    fluidsTool: "elbow",
    phase: "idle"
  });

  setToolMessage(elbowInstruction());

  renderProperties();
  renderCurrentDrawing();
}

/* The tool stays armed after a commit; Escape leaves it. */
export function finishElbowConstruction() {
  enggDrawingState.setInteraction(drawingState, {
    fluidsTool: "elbow",
    phase: "idle",
    preview: null,
    elbowStart: null,
    elbowStartMatch: null,
    snapGeometry: []
  });

  setToolMessage(elbowInstruction());

  renderProperties();
  renderCurrentDrawing();
}

export function cancelElbowConstruction() {
  enggDrawingState.clearInteraction(drawingState);

  enggDrawingState.setActiveTool(drawingState, "select");

  renderProperties();
  renderCurrentDrawing();
}

/*
 * ========================================================
 * RE-SOLVING A CONNECTED FITTING AGAINST ITS PIPES
 * ========================================================
 *
 * Used by direct manipulation of a partially or fully connected elbow: the ends
 * that are attached are pushed back onto their pipes, and the bend re-solved
 * from the same ends and angle. Returns whether anything moved.
 */
export function resolveConnectedElbow(elbow, objects = drawingState.objects) {
  return refreshManualElbow(elbow, objects);
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
  joiningCornerOf,
  cornerOf,
  connectedRunsOf,
  refreshFluidConnections,
  connectPipeEndpoints,
  reconcileFluidConnections,
  updateElbowForPair,
  adoptPipeWidth,
  propagatePipeWidth,
  beginRouteConstruction,
  finishRouteConstruction,
  cancelRouteConstruction,
  isRouteConstructing,
  setRouteShape,

  ELBOW_PHASE,
  DEFAULT_ELBOW_TOOL_ANGLE,
  pipeEndAt,
  pipeOutwardDirection,
  elbowGeometryFromGesture,
  elbowGesturePreview,
  elbowInstruction,
  commitElbowGesture,
  applyManualElbowConnections,
  refreshManualElbow,
  resolveConnectedElbow,
  beginElbowConstruction,
  finishElbowConstruction,
  cancelElbowConstruction
};

/*
 * THE ELBOW BUILDER, for a junction reduced to a corner.
 *
 * `generateElbowFor` is the one function that fits a bend at a corner, so a
 * junction whose branches drop to two becomes an ordinary Elbow in every
 * respect. `junction-tool.js` and this module import each other, so the builder
 * is published through the slot that module reads at call time.
 */
setJunctionElbowBuilder(generateElbowFor);

/*
 * THE RADIUS OPERATION'S REGENERATION ROUTINES, handed in once.
 *
 * `elbow-radius.js` owns the ORDER of a radius change - clamp, write, re-seat,
 * re-seam, settle, prove - but the routines that regenerate a joint live here,
 * because this is the module that owns the runs. Handing them in keeps ONE
 * implementation of each, so a typed radius and a dragged one cannot regenerate
 * differently.
 */
setElbowRadiusCollaborators({
  applyManualElbowConnections,
  reseatElbowPipes,
  updateElbowForPair
});

/*
 * AND THE RADIUS OPERATION ITSELF, RE-EXPORTED RATHER THAN REDEFINED. The one
 * implementation lives in `elbow-radius.js`, where the panel, the handle and the
 * transform all reach it; callers that already hold this module keep working.
 */
export { applyElbowRadius, elbowLiveLegs, elbowMaxBendRadius };

export default enggPipeDuctTool;
