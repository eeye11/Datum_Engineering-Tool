/*
 * ========================================================
 * THE SHARED SKETCH SESSION
 * ========================================================
 *
 * The drawing behaviour every Sketch Editor shares: pointer capture, sampling,
 * live recognition, continuous erasing, and undo/redo on LOGICAL actions.
 *
 * WHY IT IS SHARED
 * ----------------
 * The Statics Sketch Editor and the Graph Sketch Editor are different tools -
 * one draws a diagram against a body's axis, the other draws a whole coordinate
 * graph - but the thing the student does with the pointer is identical. Two
 * copies of that behaviour is two chances for one of them to lose a stroke, to
 * undo the wrong thing, or to erase a whole curve when the student meant to rub
 * out a piece of it. So the behaviour lives here once, and each editor supplies
 * only what is genuinely its own:
 *
 *   toSketch(event)   a pointer position, in the editor's own coordinates
 *   toScreen(point)   an editor point, in the editor's own screen coordinates
 *   tolerance         how far, in editor units, a point may sit off a run
 *   onChange()        "the drawing changed - redraw"
 *
 * ONE STATE, NOT TWO
 * ------------------
 * The session owns the strokes. There is no separate "preview" copy that can
 * drift from the committed one: the in-progress stroke is the only thing held
 * apart, and it is dropped the moment the pointer is released. What the editor
 * draws is what the session holds, which is what Apply commits.
 *
 * UNDO IS PER ACTION
 * ------------------
 * A completed stroke is one entry. A continuous erase gesture is one entry -
 * not one per pointer move, which would make Undo a hundred presses long and
 * useless. The history is a list of snapshots, so an erase that split a stroke
 * in two is undone as one step.
 */

import {
  recogniseStroke,
  splitStrokeAtGaps,
  STROKE_SIMPLIFY_UNITS,
} from "../../geometry/stroke-recognition.js";

/* How far, in screen pixels, the pointer must travel before a stroke begins. */
export const SKETCH_START_PX = 3;

/* The closest two recorded points may be, in screen pixels. */
export const SKETCH_SAMPLE_PX = 2;

/* A stroke wider than this is capped: a sketch is a drawing, not a scan. */
export const SKETCH_MAX_POINTS = 2000;

/* The eraser's radius, in screen pixels. */
export const SKETCH_ERASER_PX = 10;

/* A run shorter than this, in screen pixels, is dropped rather than committed. */
export const SKETCH_MIN_RUN_PX = 6;

/* The two tools. Nothing else is offered. */
export const SKETCH_TOOLS = Object.freeze(["draw", "erase"]);

let strokeCounter = 0;

function nextStrokeId() {
  strokeCounter += 1;

  return `stroke-${Date.now()}-${strokeCounter}`;
}

function copyPoint(point) {
  return { x: Number(point.x), y: Number(point.y) };
}

function copyStroke(entry) {
  return {
    id: entry.id,
    kind: entry.kind,
    points: (entry.points || []).map(copyPoint),
    original: (entry.original || []).map(copyPoint),
  };
}

/*
 * Re-recognise one stroke from its raw points.
 *
 * Called when a stroke is finished and again after an erase, because erasing
 * part of a stroke can change what the remainder IS - a curve with its bow
 * erased is a straight line, and leaving it classified as a curve would commit
 * a shape the student no longer has.
 */
export function recogniseStrokePoints(points, tolerance) {
  const result = recogniseStroke(points, {
    tolerance,
    smoothing: 1,
  });

  return {
    kind: result.kind,
    points: result.points,
    original: result.original,
  };
}

/*
 * A stroke the editor already holds, as the session's own shape.
 *
 * An editor that reopens an existing sketch hands its strokes in here, so a
 * reopened sketch is edited rather than replaced - and so the session has one
 * representation of a stroke, not one per caller.
 */
export function normaliseStroke(element) {
  const points = Array.isArray(element?.points) ? element.points : [];
  const original = Array.isArray(element?.original) ? element.original : points;

  return {
    id: element?.id || nextStrokeId(),
    kind: element?.kind === "straight" ? "straight" : "curved",
    points: points.map(copyPoint),
    original: original.map(copyPoint),
  };
}

/* ============================================================
 * THE SESSION
 * ============================================================ */

export function createSketchSession(options = {}) {
  const toSketch = options.toSketch;
  const toScreen = options.toScreen;
  const onChange = options.onChange || (() => {});

  /* The tolerance, in editor units, for the current frame. */
  const toleranceOf = () =>
    typeof options.tolerance === "function"
      ? Number(options.tolerance()) || 0
      : STROKE_SIMPLIFY_UNITS;

  /* The eraser's radius, in editor units. */
  const eraserRadius = () =>
    typeof options.eraserRadius === "function"
      ? Number(options.eraserRadius()) || 0
      : SKETCH_ERASER_PX;

  const minRun = () =>
    typeof options.minRun === "function"
      ? Number(options.minRun()) || 0
      : SKETCH_MIN_RUN_PX;

  let strokes = (Array.isArray(options.strokes) ? options.strokes : []).map(
    normaliseStroke,
  );

  const history = { past: [], future: [] };

  let tool = "draw";
  let stroke = null;
  let erasing = null;

  /* ---------------------------------------------------------- history */

  function snapshot() {
    return strokes.map(copyStroke);
  }

  function record(before) {
    history.past.push(before);
    history.future.length = 0;
  }

  function restore(list) {
    strokes = list.map(copyStroke);
  }

  function undo() {
    if (!history.past.length) {
      return false;
    }

    history.future.push(snapshot());
    restore(history.past.pop());

    onChange();

    return true;
  }

  function redo() {
    if (!history.future.length) {
      return false;
    }

    history.past.push(snapshot());
    restore(history.future.pop());

    onChange();

    return true;
  }

  /* ------------------------------------------------------------ draw */

  function beginStroke(event) {
    const at = toSketch(event);

    if (!at) {
      return false;
    }

    stroke = {
      pointerId: event.pointerId,
      points: [at],
      lastScreen: at.screen || { x: event.clientX, y: event.clientY },
      startScreen: { x: event.clientX, y: event.clientY },
      moving: false,
    };

    return true;
  }

  function extendStroke(event) {
    if (!stroke) {
      return false;
    }

    const at = toSketch(event);

    if (!at) {
      return false;
    }

    const screen = at.screen || { x: event.clientX, y: event.clientY };

    if (!stroke.moving) {
      const travel = Math.hypot(
        screen.x - stroke.startScreen.x,
        screen.y - stroke.startScreen.y,
      );

      if (travel < SKETCH_START_PX) {
        return false;
      }

      stroke.moving = true;
    }

    const travelled = Math.hypot(
      screen.x - stroke.lastScreen.x,
      screen.y - stroke.lastScreen.y,
    );

    if (travelled < SKETCH_SAMPLE_PX) {
      return false;
    }

    stroke.points.push(at);
    stroke.lastScreen = screen;

    if (stroke.points.length > SKETCH_MAX_POINTS) {
      stroke.points.length = SKETCH_MAX_POINTS;
    }

    onChange();

    return true;
  }

  function endStroke() {
    if (!stroke) {
      return false;
    }

    const points = stroke.points;
    const moving = stroke.moving;

    stroke = null;

    /*
     * A TAP IS NOT A STROKE. A press that never travelled is a click, and
     * committing a zero-length line for it would leave a feature the student
     * cannot see or select.
     */
    if (!moving || points.length < 2) {
      onChange();

      return false;
    }

    const recognised = recogniseStrokePoints(points, toleranceOf());

    if (recognised.points.length < 2) {
      onChange();

      return false;
    }

    const before = snapshot();

    strokes.push({
      id: nextStrokeId(),
      kind: recognised.kind,
      points: recognised.points,
      original: recognised.original,
    });

    record(before);
    onChange();

    return true;
  }

  /* ----------------------------------------------------------- erase */

  /*
   * THE ERASER REMOVES THE POINTS UNDER IT and re-recognises what is left. A
   * stroke with a piece taken out of its middle becomes TWO strokes, each
   * recognised on its own - which is what stops a half-erased curve being
   * committed as one broken path.
   *
   * It erases from the RAW stroke, not the recognised one: the recognised
   * geometry is the clean answer, the raw points are where the student actually
   * drew, and erasing from the clean answer would leave the parts it smoothed
   * away.
   */
  function eraseAt(point) {
    const radius = eraserRadius();
    const tolerance = toleranceOf();
    const minimum = minRun();

    const kept = [];

    strokes.forEach((entry) => {
      const marked = entry.original.map((raw) => ({
        ...raw,
        erased: Math.hypot(raw.x - point.x, raw.y - point.y) <= radius,
      }));

      const runs = splitStrokeAtGaps(marked, minimum);

      runs.forEach((run, index) => {
        const recognised = recogniseStrokePoints(run, tolerance);

        if (recognised.points.length < 2) {
          return;
        }

        kept.push({
          id: `${entry.id}-${index}`,
          kind: recognised.kind,
          points: recognised.points,
          original: recognised.original,
        });
      });
    });

    strokes = kept;
  }

  function beginErase(event) {
    const at = toSketch(event);

    if (!at) {
      return false;
    }

    erasing = {
      pointerId: event.pointerId,
      point: at,
      before: snapshot(),
    };

    eraseAt(at);
    onChange();

    return true;
  }

  function extendErase(event) {
    if (!erasing) {
      return false;
    }

    const at = toSketch(event);

    if (!at) {
      return false;
    }

    erasing.point = at;
    eraseAt(at);
    onChange();

    return true;
  }

  function endErase() {
    if (!erasing) {
      return false;
    }

    const before = erasing.before;

    erasing = null;

    /*
     * ONE ENTRY PER GESTURE. A drag across the canvas is one erase, not one per
     * pointer move - which is what keeps Undo meaningful.
     */
    record(before);
    onChange();

    return true;
  }

  /* ---------------------------------------------------------- pointer */

  function pointerDown(event) {
    if (event.button !== undefined && event.button !== 0) {
      return false;
    }

    if (tool === "erase") {
      return beginErase(event);
    }

    return beginStroke(event);
  }

  function pointerMove(event) {
    if (tool === "erase") {
      return extendErase(event);
    }

    return extendStroke(event);
  }

  function pointerUp() {
    if (tool === "erase") {
      return endErase();
    }

    return endStroke();
  }

  function pointerCancel() {
    if (erasing) {
      return endErase();
    }

    if (stroke) {
      stroke = null;
      onChange();

      return true;
    }

    return false;
  }

  /* ------------------------------------------------------------ tools */

  function setTool(next) {
    if (!SKETCH_TOOLS.includes(next)) {
      return false;
    }

    /*
     * SWITCHING TOOL DOES NOT DISCARD ANYTHING. A stroke in progress is
     * finished first, so the student never loses work by reaching for the
     * eraser.
     */
    if (stroke) {
      endStroke();
    }

    if (erasing) {
      endErase();
    }

    tool = next;
    onChange();

    return true;
  }

  /* ------------------------------------------------------------ state */

  function getStrokes() {
    return strokes;
  }

  function setStrokes(list) {
    strokes = (Array.isArray(list) ? list : []).map(normaliseStroke);
    history.past.length = 0;
    history.future.length = 0;
    onChange();
  }

  function getTool() {
    return tool;
  }

  function activeStroke() {
    return stroke && stroke.moving ? stroke.points : null;
  }

  function eraserPoint() {
    return erasing ? erasing.point : null;
  }

  function canUndo() {
    return history.past.length > 0;
  }

  function canRedo() {
    return history.future.length > 0;
  }

  function isBusy() {
    return Boolean(stroke || erasing);
  }

  function abandon() {
    if (stroke) {
      stroke = null;
      onChange();

      return true;
    }

    if (erasing) {
      erasing = null;
      onChange();

      return true;
    }

    return false;
  }

  /* The strokes, as the plain data an editor hands to its commit. */
  function exportStrokes() {
    return strokes.map(copyStroke);
  }

  return {
    pointerDown,
    pointerMove,
    pointerUp,
    pointerCancel,
    setTool,
    getTool,
    getStrokes,
    setStrokes,
    exportStrokes,
    activeStroke,
    eraserPoint,
    undo,
    redo,
    canUndo,
    canRedo,
    isBusy,
    abandon,
    toScreen,
  };
}

export default {
  SKETCH_TOOLS,
  SKETCH_START_PX,
  SKETCH_SAMPLE_PX,
  SKETCH_MAX_POINTS,
  SKETCH_ERASER_PX,
  SKETCH_MIN_RUN_PX,
  recogniseStrokePoints,
  normaliseStroke,
  createSketchSession,
};
