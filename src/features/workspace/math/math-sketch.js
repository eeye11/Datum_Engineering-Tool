/*
 * ============================================================
 * THE MATH SKETCH WORKSPACE
 * ============================================================
 *
 * A student draws naturally with a mouse, a finger or a stylus, and DAETUM
 * captures the continuous stroke, recognises the intended geometry, reconstructs
 * it with its own geometry representation and cleans up the irregularities.
 *
 * THIS IS THE SAME FRAMEWORK THE FREEFORM POLYGON USES. A stroke is captured by
 * a press-move-release session, sampled at a screen-pixel interval so the sample
 * density does not depend on the zoom, and handed to the shared reconstruction
 * (`math-model.js`: simplify, smooth, fit). There is no second Sketch
 * implementation for Math, and no predefined Straight Line / Curved Line
 * options - the student simply draws.
 *
 * ============================================================
 * A SKETCH IS A WHOLE PLOT, NOT ONE CURVE
 * ============================================================
 *
 * The Plot tool's Sketch mode lets the student draw the COMPLETE graph: the
 * axes, straight lines, and curves. So the session collects STROKES rather than
 * committing each one as it is released:
 *
 *     draw a stroke   ->  it is reconstructed and added to the sketch
 *     draw another    ->  it is added beside the first
 *     Apply           ->  the whole sketch becomes ONE Plot
 *     Cancel          ->  nothing is committed
 *
 * Each stroke becomes a function component of the resulting Plot, so the curves
 * are parts of the graph rather than separate drawings that happen to sit on
 * it. The student can erase a stroke and draw again before applying.
 *
 * THE ORIGINAL STROKE IS KEPT. It is stored on the component as
 * `originalTrace`, so the student can see what they drew behind the
 * reconstructed curve - and it is a dependent visual, never a second selectable
 * object.
 */

import { drawingState, editorState } from "../editor-state.js";
import enggDrawingState from "../../../shared/model/drawing-state.js";
import { resolvePointerEvent } from "../interaction/pointer.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";
import { commitSketchPlot, reconstructMathStroke } from "./math-creation.js";
import { MATH_TOOL_IDS, mathToolHasModes } from "./math-tools.js";

/* How far, in screen pixels, the pointer must travel before this is a DRAG. */
export const MATH_TRACE_START_PX = 4;

/* The closest two recorded points may be, in screen pixels. */
export const MATH_TRACE_SAMPLE_PX = 2;

/* A stroke wider than this is capped: a trace is a drawing, not a scan. */
export const MATH_TRACE_MAX_POINTS = 1200;

/* The Math tools whose Sketch mode is a freehand stroke. */
export const MATH_SKETCH_TOOLS = Object.freeze([MATH_TOOL_IDS.plot]);

export function isMathSketchTool(toolId) {
  return MATH_SKETCH_TOOLS.includes(toolId);
}

/* Whether the armed Math tool is in Sketch mode and takes a stroke. */
export function mathSketchArmed() {
  const toolId = drawingState.activeTool;

  if (!isMathSketchTool(toolId) || !mathToolHasModes(toolId)) {
    return false;
  }

  return (drawingState.interaction?.mathMode || "sketch") === "sketch";
}

function screenPixelsToUnits(pixels) {
  const scale =
    enggDrawingState.BASE_PIXELS_PER_UNIT *
    Math.max(Number(drawingState.camera?.zoom) || 1, 0.25);

  return pixels / Math.max(scale, 1e-9);
}

/* ============================================================
 * THE SKETCH, AS A LIST OF RECONSTRUCTED STROKES
 * ============================================================
 *
 * Held on `editorState` rather than on the document, because it is not a
 * feature until the student applies it. Escape and Cancel drop it, which is the
 * rollback - nothing was ever written.
 */
export function mathSketchStrokes() {
  return Array.isArray(editorState.mathSketch?.strokes)
    ? editorState.mathSketch.strokes
    : [];
}

function ensureSketch() {
  if (!editorState.mathSketch) {
    editorState.mathSketch = { strokes: [] };
  }

  return editorState.mathSketch;
}

/* Add a reconstructed stroke to the sketch. */
export function addSketchStroke(reconstruction) {
  if (!reconstruction || !Array.isArray(reconstruction.points) || reconstruction.points.length < 2) {
    return false;
  }

  ensureSketch().strokes.push(reconstruction);

  setToolMessage(
    `Sketch: ${mathSketchStrokes().length} stroke${mathSketchStrokes().length === 1 ? "" : "s"} - draw more, or Apply`,
  );

  renderCurrentDrawing();

  return true;
}

/* Remove the most recent stroke - the sketch's own Undo. */
export function undoSketchStroke() {
  const sketch = editorState.mathSketch;

  if (!sketch || !sketch.strokes.length) {
    return false;
  }

  sketch.strokes.pop();

  setToolMessage(
    sketch.strokes.length
      ? `Sketch: ${sketch.strokes.length} stroke${sketch.strokes.length === 1 ? "" : "s"} - draw more, or Apply`
      : "Draw the graph - axes, lines and curves",
  );

  renderCurrentDrawing();

  return true;
}

/* Erase the stroke nearest a point - the sketch's own Erase. */
export function eraseSketchStrokeAt(point) {
  const sketch = editorState.mathSketch;

  if (!sketch || !sketch.strokes.length || !point) {
    return false;
  }

  const tolerance = screenPixelsToUnits(10);

  let best = -1;
  let bestDistance = Infinity;

  sketch.strokes.forEach((stroke, index) => {
    stroke.points.forEach((candidate) => {
      const offset = Math.hypot(candidate.x - point.x, candidate.y - point.y);

      if (offset < bestDistance) {
        bestDistance = offset;
        best = index;
      }
    });
  });

  if (best < 0 || bestDistance > tolerance) {
    return false;
  }

  sketch.strokes.splice(best, 1);

  renderCurrentDrawing();

  return true;
}

/* Discard the whole sketch. */
export function cancelMathSketch() {
  if (!editorState.mathSketch) {
    return false;
  }

  editorState.mathSketch = null;

  renderCurrentDrawing();

  return true;
}

/*
 * APPLY THE SKETCH AS ONE PLOT.
 *
 * The strokes become the function components of a single Plot, whose box is the
 * bounding box of everything drawn. The sketch is cleared afterwards, so the
 * student starts a fresh one if they draw again.
 */
export function applyMathSketch() {
  const strokes = mathSketchStrokes();

  if (!strokes.length) {
    setToolMessage("Draw the graph first, then Apply");

    return null;
  }

  const plot = commitSketchPlot(strokes, { showOriginalTrace: true });

  editorState.mathSketch = null;

  renderCurrentDrawing();

  return plot;
}

/* ============================================================
 * THE STROKE SESSION
 * ============================================================
 *
 * One press-move-release, captured and reconstructed. The result is ADDED to
 * the sketch rather than committed, so the student can draw the axes and then
 * the curves before applying the whole thing.
 */

/*
 * BEGIN A STROKE ON THE PRESS.
 *
 * Returns true when this press belongs to the Math tool, so the caller leaves
 * the press alone and lets the release decide what it was. Nothing is written
 * to the document: a press that does not travel is still an ordinary click.
 */
export function beginMathStroke(event) {
  if (!mathSketchArmed() || !event || event.button !== 0 || editorState.mathStroke) {
    return false;
  }

  const resolution = resolvePointerEvent(event);

  const start = resolution.effectiveConstructionPoint || resolution.rawPointerPoint;

  if (!start) {
    return false;
  }

  editorState.mathStroke = {
    pointerId: event.pointerId,
    toolId: drawingState.activeTool,
    startScreen: { x: event.clientX, y: event.clientY },
    start: { x: start.x, y: start.y },
    points: [],
    moving: false,
    committed: false,
  };

  return true;
}

/* Record the stroke while the pointer moves. */
export function moveMathStroke(event, point) {
  const session = editorState.mathStroke;

  if (!session || !point) {
    return false;
  }

  if (!session.moving) {
    const travel = Math.hypot(
      event.clientX - session.startScreen.x,
      event.clientY - session.startScreen.y,
    );

    if (travel < MATH_TRACE_START_PX) {
      return false;
    }

    session.moving = true;
    session.points = [{ ...session.start }];

    setToolMessage("Draw the graph - release to finish this stroke");
  }

  const minimum = screenPixelsToUnits(MATH_TRACE_SAMPLE_PX);
  const last = session.points[session.points.length - 1];

  if (session.points.length >= MATH_TRACE_MAX_POINTS) {
    return true;
  }

  if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= minimum) {
    session.points.push({ x: point.x, y: point.y });
  }

  /*
   * THE LIVE STROKE IS PUBLISHED ON THE INTERACTION, so the canvas draws it
   * through the ordinary preview pass - one preview implementation, not a
   * second one for Math.
   */
  enggDrawingState.setInteraction(drawingState, {
    ...drawingState.interaction,
    mathPreview: {
      toolId: session.toolId,
      stroke: session.points.map((entry) => ({ ...entry })),
    },
  });

  renderCurrentDrawing();

  return true;
}

/*
 * FINISH THE STROKE ON RELEASE.
 *
 * A press that never travelled is NOT a stroke: the session is dropped and
 * false is returned, so the browser's click reaches the click router exactly as
 * before. A real stroke is reconstructed and added to the sketch.
 */
export function finishMathStroke(event, point) {
  const session = editorState.mathStroke;

  if (!session) {
    return false;
  }

  if (event && !session.moving) {
    const travel = Math.hypot(
      event.clientX - session.startScreen.x,
      event.clientY - session.startScreen.y,
    );

    if (travel >= MATH_TRACE_START_PX) {
      moveMathStroke(event, point);
    }
  }

  if (!session.moving) {
    editorState.mathStroke = null;

    return false;
  }

  editorState.mathStroke = null;

  if (session.committed) {
    return true;
  }

  session.committed = true;

  const last = session.points[session.points.length - 1];

  if (
    point &&
    last &&
    Math.hypot(point.x - last.x, point.y - last.y) > screenPixelsToUnits(MATH_TRACE_SAMPLE_PX)
  ) {
    session.points.push({ x: point.x, y: point.y });
  }

  enggDrawingState.setInteraction(drawingState, {
    ...drawingState.interaction,
    mathPreview: null,
  });

  addSketchStroke(reconstructMathStroke(session.points));

  renderCurrentDrawing();

  return true;
}

/* Abandon a stroke without adding it. */
export function cancelMathStroke() {
  if (!editorState.mathStroke) {
    return false;
  }

  editorState.mathStroke = null;

  enggDrawingState.setInteraction(drawingState, {
    ...drawingState.interaction,
    mathPreview: null,
  });

  return true;
}

const enggMathSketch = {
  MATH_TRACE_START_PX,
  MATH_TRACE_SAMPLE_PX,
  MATH_TRACE_MAX_POINTS,
  MATH_SKETCH_TOOLS,
  isMathSketchTool,
  mathSketchArmed,
  mathSketchStrokes,
  addSketchStroke,
  undoSketchStroke,
  eraseSketchStrokeAt,
  cancelMathSketch,
  applyMathSketch,
  beginMathStroke,
  moveMathStroke,
  finishMathStroke,
  cancelMathStroke,
};

export default enggMathSketch;
