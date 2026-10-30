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
    elbow = generateElbowFor(previousRun, run, engineering);

    if (elbow) {
      enggDrawingState.addObject(drawingState, elbow);
      created.push(elbow);
    }
  }

  enggDrawingState.selectObject(drawingState, run.id);
  enggDrawingState.commitDrawingChange(drawingState, previousObjects);

  /*
   * THE PATH CONTINUES FROM THIS RUN's FAR END. Held on the interaction so the
   * next drag from that point joins on; a drag from anywhere else starts a new
   * path (see resolveRouteStart).
   */
  enggDrawingState.setInteraction(drawingState, {
    fluidsTool: "pipe-duct",
    phase: "idle",
    previousRun: run,
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
      ? `${run.name} and ${elbow.name} created - drag to continue, or Enter to finish`
      : `${run.name} created - drag to continue, or Enter to finish`
  );

  renderProperties();
  renderCurrentDrawing();

  return { run, elbow, created };
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
   * THE ELBOW CARRIES ITS OWN CROSS-SECTION. Initialised, when compatible,
   * from the adjoining run; a mismatch is left for the panel to report rather
   * than silently resolved into a reducer.
   */
  const compatible = enggPipeDuct.compatibilityIssue(previousRun, run) === null;

  const elbowEngineering = {
    angle,
    angleDegrees,
    bendRadius: enggPipeDuct.readDefaultBendRadius(),
    shape: engineering?.shape || enggPipeDuct.PIPE_SHAPES.circular,
    material: engineering?.material ?? "",
    roughness: engineering?.roughness
  };

  if (compatible) {
    enggPipeDuct.dimensionalKeysFor(engineering).forEach((key) => {
      const value = Number(engineering[key]);

      if (Number.isFinite(value)) {
        elbowEngineering[key] = value;
      }
    });
  }

  /*
   * THE CORNER IS STORED AS THREE POINTS, so the elbow's curved geometry is
   * derived from the ACTUAL runs it joins rather than from a stored angle that
   * could drift from them. `position` is the corner itself; `previous` and
   * `next` are the far ends of the two runs.
   */
  const elbow = enggDrawingState.createGeometryObject(
    "elbow",
    {
      position: { x: vertex.x, y: vertex.y },
      previous: { x: before.x, y: before.y },
      next: { x: after.x, y: after.y }
    },
    {
      style: { ...drawingState.styleDefaults },
      engineering: elbowEngineering
    }
  );

  return elbow;
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
  beginRouteConstruction,
  finishRouteConstruction,
  cancelRouteConstruction,
  isRouteConstructing,
  setRouteShape
};

export default enggPipeDuctTool;
