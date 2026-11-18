/*
 * ========================================================
 * THE HEAT TRANSFER TOOLS' SESSIONS
 * ========================================================
 *
 * One module for every Heat Transfer tool, because they all share ONE
 * lifecycle - arm with an instruction, preview while the gesture runs, commit
 * one object per gesture, stay armed - and differ only in what they create and
 * the gesture that creates it:
 *
 *   thermal-region          drag out a rectangle
 *   wall-slab               drag along the wall's length
 *   composite-wall          drag out a rectangle; widen it to add layers
 *   fin                     drag from the base out to the tip
 *   conduction-path         click points, Enter to finish
 *   convection-flow         click points, Enter to finish
 *   radiation-path          click points, Enter to finish
 *   heat-transfer-rate      drag from tail to tip
 *   heat-flux               drag from tail to tip
 *   *-boundary              drag along the boundary
 *   thermal-contact         drag along the interface
 *   heat-source / heat-sink click to place
 *   thermal-circuit-node    click to place
 *   thermal-resistance / thermal-capacitance   click to place
 *   temperature-marker      click to place
 *   isotherm                click points, Enter to finish
 *   control-volume-boundary drag out a rectangle
 *
 * ========================================================
 * NOTHING IS WRITTEN UNTIL THE GESTURE ENDS
 * ========================================================
 *
 * A press arms a session; the drag publishes a PREVIEW on the interaction (so
 * the shared preview renderer draws it, and the document is untouched); the
 * release commits ONE undoable change. Escape clears the session, and because
 * nothing was written there is nothing to undo - no ghost geometry, no
 * orphaned layer.
 *
 * ========================================================
 * THE COMPOSITE WALL'S DYNAMIC LAYERS
 * ========================================================
 *
 * The layer count is decided DURING the drag, from the rectangle's current
 * width: N = max(2, floor(W / p)). The preview shows the divisions appear and
 * redistribute as the drag crosses each threshold, and reducing the width
 * removes them again - all before the release commits the wall the student
 * actually drew.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggHeatModel from "../model/heat-transfer/heat-model.js";
import {
  COMPOSITE_LAYER_INCREMENT,
  DEFAULT_FIN_THICKNESS,
  DEFAULT_WALL_HEIGHT,
  DEFAULT_WALL_THICKNESS,
  distanceToSegment,
  finitePoint,
  midpoint,
} from "../model/heat-transfer/heat-shared.js";
import { drawingState, editorState } from "../editor-state.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { renderFeatures } from "../../../components/layout/panels/features-editor.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";
import { heatInstruction } from "../model/heat-transfer/heat-tools.js";
import enggHeatLabels from "../model/heat-transfer/heat-labels.js";
import { creationLabelPrompt } from "../../../shared/ui/editors/creation-label.js";

/* The interaction phases these tools use. */
export const HEAT_DRAG_PHASE = "heat-drag-construct";
export const HEAT_POLY_PHASE = "heat-poly-construct";



/* ============================================================
 * ARMING
 * ============================================================ */

function arm(toolId, interaction = {}) {
  enggDrawingState.setActiveTool(drawingState, toolId);

  enggDrawingState.setInteraction(drawingState, {
    heatTool: toolId,
    phase: "idle",
    preview: null,
    ...interaction,
  });
}

function refresh() {
  renderFeatures();
  renderProperties();
  renderCurrentDrawing();
}

/*
 * ARM A HEAT TRANSFER TOOL.
 *
 * Called by the activation layer for every `heat`-capability tool. The tool
 * id is the variant-carrying one (a dropdown child id such as
 * `conduction-path` or `heat-flux`), so the session knows which variant the
 * student picked without a second question.
 */
export function beginHeatToolSession(toolId) {
  const gesture = drawingState.interaction?.heatGesture || null;

  const phase = gesture === "poly" ? HEAT_POLY_PHASE : HEAT_DRAG_PHASE;

  arm(toolId, {
    phase,
    heatGesture: gesture,
    /* Arming a tool starts a NEW path; any remembered continuation is dropped. */
    heatPathId: null,
    heatStart: null,
    heatPoints: [],
  });

  setToolMessage(heatInstruction(toolId));

  refresh();
}

/* The instruction the bottom bar shows, for the activation layer. */
export function heatToolInstruction(toolId) {
  return heatInstruction(toolId);
}

/* ============================================================
 * THE GESTURE MAP
 * ============================================================
 *
 * Which tool creates which object, and which gesture it takes. The creation
 * drag layer asks these to route a press, a move and a release.
 */

/* The tools placed by ONE click. */
export const HEAT_CLICK_TOOLS = [
  "heat-source",
  "heat-sink",
  "thermal-circuit-node",
  "thermal-resistance",
  "thermal-capacitance",
  "temperature-marker",
];

/* The tools drawn by a press-drag-release. */
export const HEAT_DRAG_TOOLS = [
  "thermal-region",
  "wall-slab",
  "composite-wall",
  "fin",
  "heat-transfer-rate",
  "heat-flux",
  "fixed-temperature-boundary",
  "convection-boundary",
  "radiation-boundary",
  "adiabatic-boundary",
  "thermal-contact",
  "control-volume-boundary",
];

/* The tools drawn by clicking a chain of points and finishing. */
export const HEAT_POLY_TOOLS = [
  "conduction-path",
  "convection-flow",
  "radiation-path",
  "isotherm",
];

export function isHeatClickTool(toolId) {
  return HEAT_CLICK_TOOLS.includes(toolId);
}

export function isHeatDragTool(toolId) {
  return HEAT_DRAG_TOOLS.includes(toolId);
}

export function isHeatPolyTool(toolId) {
  return HEAT_POLY_TOOLS.includes(toolId);
}

/* ============================================================
 * BUILDING THE OBJECT
 * ============================================================
 *
 * The one place each tool's object is created, from the gesture's points.
 * Both the commit and the preview go through here, so what the student sees
 * while drawing is EXACTLY what the release commits.
 */
function buildHeatObject(toolId, { start, end, points } = {}) {
  switch (toolId) {
    case "thermal-region": {
      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);

      return enggHeatModel.createThermalRegion({
        position: { x, y },
        width: Math.abs(end.x - start.x) || DEFAULT_WALL_HEIGHT,
        height: Math.abs(end.y - start.y) || DEFAULT_WALL_HEIGHT,
        variant: "solid",
      });
    }

    case "wall-slab":
      return enggHeatModel.createWallSlab({
        start,
        end,
        thickness: DEFAULT_WALL_THICKNESS,
      });

    case "composite-wall": {
      const width = Math.abs(end.x - start.x) || COMPOSITE_LAYER_INCREMENT * 2;
      const height = Math.abs(end.y - start.y) || DEFAULT_WALL_HEIGHT;

      return enggHeatModel.createCompositeWall({
        center: midpoint(start, end),
        width,
        height,
        rotation: 0,
      });
    }

    case "fin":
      return enggHeatModel.createFin({
        base: start,
        end,
        thickness: DEFAULT_FIN_THICKNESS,
      });

    case "heat-transfer-rate":
      return enggHeatModel.createThermalArrow({
        start,
        end,
        variant: "heat-rate",
      });

    case "heat-flux": {
      /*
       * A HEAT FLUX DRAWN ON A BOUNDARY BECOMES NORMAL TO IT.
       *
       * This is the Prescribed Heat-Flux Boundary's whole job, done with the
       * arrow the student already has: draw the flux on a surface and it is
       * squared to that surface, pointing out of it. Anywhere else it is the
       * free arrow it has always been.
       */
      const surface = boundaryUnder(start);

      return enggHeatModel.createThermalArrow({
        start,
        end,
        variant: "heat-flux",
        surface,
        inward: drawingState.interaction?.heatFluxInward === true,
      });
    }

    case "fixed-temperature-boundary":
      return enggHeatModel.createThermalBoundary({
        start,
        end,
        variant: "fixed-temperature",
      });

    case "convection-boundary":
      return enggHeatModel.createThermalBoundary({
        start,
        end,
        variant: "convection",
      });

    case "radiation-boundary":
      return enggHeatModel.createThermalBoundary({
        start,
        end,
        variant: "radiation",
      });

    case "adiabatic-boundary":
      return enggHeatModel.createThermalBoundary({
        start,
        end,
        variant: "adiabatic",
      });



    case "thermal-contact":
      return enggHeatModel.createThermalContact({ start, end });

    case "control-volume-boundary": {
      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);

      return enggHeatModel.createControlVolume({
        position: { x, y },
        width: Math.abs(end.x - start.x) || DEFAULT_WALL_HEIGHT,
        height: Math.abs(end.y - start.y) || DEFAULT_WALL_HEIGHT,
      });
    }

    /* The poly tools. */
    case "conduction-path":
      return enggHeatModel.createHeatPath({ points, variant: "conduction" });

    case "convection-flow":
      return enggHeatModel.createHeatPath({ points, variant: "convection" });

    case "radiation-path":
      return enggHeatModel.createHeatPath({ points, variant: "radiation" });

    case "isotherm":
      return enggHeatModel.createIsotherm({ points });

    default:
      return null;
  }
}

/*
 * THE THERMAL BOUNDARY UNDER A POINT, if any.
 *
 * A Heat Flux arrow dropped on a surface takes that surface's normal. The search
 * uses the SHARED pick tolerance and only considers Thermal Boundaries, so the
 * arrow cannot be squared to an unrelated line that merely passes nearby.
 */
function boundaryUnder(point) {
  if (!finitePoint(point)) {
    return null;
  }

  const reach = 6;

  const candidates = (drawingState.objects || []).filter(
    (object) => object.type === enggHeatModel.HEAT_TYPES.thermalBoundary
  );

  let best = null;
  let bestDistance = Infinity;

  candidates.forEach((boundary) => {
    const g = boundary.geometry || {};

    if (!finitePoint(g.start) || !finitePoint(g.end)) {
      return;
    }

    const distance = distanceToSegment(point, g.start, g.end);

    if (distance <= reach && distance < bestDistance) {
      best = boundary;
      bestDistance = distance;
    }
  });

  return best;
}

/* The one-click tools' objects, from their single point. */
function buildHeatClickObject(toolId, point) {
  switch (toolId) {
    case "heat-source":
      return enggHeatModel.createSourceSink({
        center: point,
        variant: "source",
      });

    case "heat-sink":
      return enggHeatModel.createSourceSink({ center: point, variant: "sink" });

    case "thermal-circuit-node":
      return enggHeatModel.createCircuitNode({ center: point });

    case "thermal-resistance":
      return enggHeatModel.createCircuitElement({
        center: point,
        variant: "resistance",
      });

    case "thermal-capacitance":
      return enggHeatModel.createCircuitElement({
        center: point,
        variant: "capacitance",
      });

    case "temperature-marker":
      return enggHeatModel.createTemperatureMarker({
        center: point,
        text: "T",
      });

    default:
      return null;
  }
}

/* ============================================================
 * THE ATTACHED LABEL - CREATED AND EDITED ON THE DRAWING
 * ============================================================
 *
 * After an object is committed, its notation is created as a CHILD annotation
 * (see heat-labels.js) and the inline text field opens ON the label, with the
 * whole default selected - so the student can type to replace "T₁" or press
 * Enter to keep it.
 *
 * THE LABEL IS PART OF THE OBJECT, INCLUDING IN UNDO.
 *
 * It is ADDED to the sheet here but NOT committed here: the caller commits once,
 * after both, so one Undo takes the object and its notation away together. A
 * commit of its own would make the label a separate history entry, and the first
 * Undo would leave a readable object with no notation - and the second would
 * take the object after it.
 */
function attachHeatLabel(parent, { openEditor = true } = {}) {
  if (!parent) {
    return null;
  }

  const label = enggHeatLabels.createHeatLabel(parent, {
    objects: drawingState.objects,
  });

  if (!label) {
    /*
     * A TOOL WITH NO NOTATION (a Wall / Slab, a Path, a Region) creates no
     * label at all - the requirement's explicit list. Its geometry carries the
     * meaning, and the student may still add text with the Text tool.
     */
    return null;
  }

  enggDrawingState.addObject(drawingState, label);

  /*
   * THE PARENT IS SELECTED, NOT THE LABEL - the student is drawing the object,
   * and its geometry handles are what they need. The label field is what they
   * type into, and the label is selectable afterwards by clicking it.
   */
  enggDrawingState.selectObject(drawingState, parent.id);

  if (openEditor) {
    openHeatLabelEditor(label);
  }

  return label;
}

/*
 * COMMIT AN OBJECT TOGETHER WITH ITS NEW LABEL, AS ONE CHANGE.
 *
 * The snapshot is taken before anything is written, so the single history entry
 * holds the object, its notation and any decoration derived from them. Every
 * creation path goes through here rather than calling `addObject` itself.
 */
function commitHeatObject(toolId, object, { openEditor = true } = {}) {
  if (!object) {
    return null;
  }

  const previous = enggDrawingState.snapshotDrawing(drawingState);

  enggDrawingState.addObject(drawingState, object);

  const stored =
    drawingState.objects.find((candidate) => candidate.id === object.id) || object;

  /* The notation is added to the sheet, then the ONE change is committed. */
  attachHeatLabel(stored, { openEditor });

  enggDrawingState.commitDrawingChange(drawingState, previous);

  refresh();

  return stored;
}

/*
 * OPEN THE INLINE FIELD ON A HEAT LABEL.
 *
 * Through `creationLabelPrompt` - the application's ONE on-drawing label field
 * - so the keys, the commit, the cancel, and the undo entry are every other
 * label's. `selectAllOnOpen` is what makes the WHOLE generated notation
 * selected, so typing replaces it rather than appending.
 */
function openHeatLabelEditor(label) {
  if (!label) {
    return false;
  }

  return creationLabelPrompt(
    { ...label, name: label.text ?? label.name },
    {
      state: drawingState,
      selectAllOnOpen: true,
      onApply: (text) => {
        const live = drawingState.objects.find((o) => o.id === label.id);

        if (!live) {
          return;
        }

        const next = String(text ?? "").trim();

        if (!next || next === String(live.text ?? "")) {
          return;
        }

        const previous = enggDrawingState.snapshotDrawing(drawingState);

        /*
         * THE TEXT AND THE NAME MOVE TOGETHER. A label's `name` is what the
         * Features Name field and the source header read, and its `text` is what
         * is drawn - one answer, written in both places, so the panel and the
         * sheet never disagree about what the notation says.
         */
        live.text = next;
        live.name = next;
        live.metadata = { ...(live.metadata || {}), heatGenerated: false };

        enggDrawingState.commitDrawingChange(drawingState, previous);

        refresh();
      },
    }
  );
}

/* ============================================================
 * THE CLICK COMMIT
 * ============================================================
 *
 * A click tool's whole gesture is one press. The object is committed at the
 * press and there is no drag to finish. The pointer's RAW position is used:
 * a node, a source or a marker is placed where the student clicked, and a
 * construction snap must not move that decision onto something else.
 */
export function commitHeatClickAt(toolId, point) {
  if (!finitePoint(point)) {
    return null;
  }

  const object = buildHeatClickObject(toolId, point);

  if (!object) {
    return null;
  }

  /* Object, notation and one undo entry - see `commitHeatObject`. */
  commitHeatObject(toolId, object);

  /* The notation is created AND the field opens on it, with it selected. */
  return drawingState.objects.find((o) => o.id === object.id) || object;
}

/* ============================================================
 * THE DRAG PREVIEW AND COMMIT
 * ============================================================
 *
 * The live preview while a drag runs. The object is built by the SAME factory
 * the commit uses, from the SAME two points - so the student draws what they
 * get. For the Composite Wall, the layer count is regenerated from the
 * preview's width, so the divisions appear and redistribute live.
 */
export function heatDragPreview(toolId, start, end) {
  if (!finitePoint(start) || !finitePoint(end)) {
    return null;
  }

  const object = buildHeatObject(toolId, { start, end });

  if (!object) {
    return null;
  }

  /*
   * A PREVIEW IS NOT IN THE DOCUMENT. It is drawn from the interaction's
   * `preview` field by the shared preview renderer, so it carries the same
   * type and geometry the commit will - and a flag the renderer reads to draw
   * it as a preview rather than as a committed object.
   */
  object.preview = true;

  return object;
}

export function commitHeatDrag(toolId, start, end) {
  if (!finitePoint(start) || !finitePoint(end)) {
    return null;
  }

  /* A drag that never travelled is a click, not an object. */
  if (Math.hypot(end.x - start.x, end.y - start.y) < 1e-9) {
    return null;
  }

  const object = buildHeatObject(toolId, { start, end });

  if (!object) {
    return null;
  }

  /* Object, notation and one undo entry - see `commitHeatObject`. */
  commitHeatObject(toolId, object);

  return drawingState.objects.find((o) => o.id === object.id) || object;
}

/* ============================================================
 * THE HEAT TRANSFER PATH - SEGMENT BY DRAG, CONTINUOUSLY
 * ============================================================
 *
 * A Conduction Path, a Convection Flow and a Radiation Path are drawn with the
 * EXACT SAME GESTURE as DAETUM's Line tool and Pipe / Duct: press, drag,
 * release. Nothing here invents a click-to-add-points / double-click-to-finish
 * system - that was removed precisely because it was a second drawing system
 * beside the one the application already had.
 *
 * ONE SEGMENT PER DRAG
 * --------------------
 * Each press-drag-release commits ONE straight segment, exactly as a Pipe / Duct
 * run does. The first release ALSO commits the segment as a permanent Heat
 * Transfer Path object; each later drag that begins at that object's own far
 * endpoint APPENDS its segment to the SAME object, so the path grows into one
 * continuous, editable drawing object rather than a pile of separate lines.
 *
 * CONTINUITY IS DECIDED BY GEOMETRY, NOT BY A FLAG
 * ------------------------------------------------
 * A drag that presses on the last path's endpoint (within the continuation
 * tolerance) continues that path. A drag that presses anywhere else starts a
 * NEW path. This is `resolveRouteStart`'s rule for pipes, restated for paths -
 * so "continue a path" and "start a new one" are the same act, distinguished by
 * where the student pressed, exactly as they are for a run.
 *
 * THE LIFECYCLE, stated once:
 *
 *   IDLE       no drag running; the tool is armed. If a path was just
 *              committed, its far end is remembered as the continuation point.
 *   DRAWING    a segment is being dragged; the preview is the segment from the
 *              press to the cursor, drawn in the path's own line type.
 *   COMMITTING the release creates or extends the path, in ONE undoable change.
 *   IDLE AGAIN the preview and the drag's own points are cleared; the tool stays
 *              armed; the committed path's far end is the only thing remembered.
 *
 * THE PATH ITSELF IS NEVER REBUILT. A segment's far end is APPENDED to the
 * stored point list (`appendHeatPathSegment`), so earlier points are untouched
 * and the exact straight geometry the student dragged is preserved. Only the
 * APPEARANCE - straight, smooth or wavy - is generated at draw time.
 *
 * THE COMMITTED OBJECT AND THE PREVIEW ARE SEPARATE. The preview is a
 * `preview: true` object on the interaction; the committed path is in the
 * document. The commit runs BEFORE the preview is cleared, so the drawing never
 * has a frame with nothing visible.
 */

/* How near a press must be to the last path's far end to CONTINUE it, in
 * drawing units. The same order as a pipe's continuation tolerance: a press
 * that lands on the endpoint continues; one that lands anywhere else is new. */
export const HEAT_PATH_CONTINUATION_TOLERANCE = 6;

/* The path a drag would continue, from the last path's far end - or null. */
export function heatPathContinuationTarget(pressPoint, objects = drawingState.objects) {
  const remembered = drawingState.interaction?.heatPathId;

  if (!remembered || !finitePoint(pressPoint)) {
    return null;
  }

  const path = (objects || []).find(
    (object) =>
      object.id === remembered &&
      object.type === enggHeatModel.HEAT_TYPES.heatPath
  );

  const points = Array.isArray(path?.geometry?.points)
    ? path.geometry.points.filter(finitePoint)
    : [];

  if (!points.length) {
    return null;
  }

  const end = points[points.length - 1];

  if (
    Math.hypot(end.x - pressPoint.x, end.y - pressPoint.y) <=
    HEAT_PATH_CONTINUATION_TOLERANCE
  ) {
    return { path, end: { x: end.x, y: end.y } };
  }

  return null;
}

/*
 * THE LIVE PREVIEW OF ONE SEGMENT.
 *
 * The segment is drawn in the path's OWN line type through the SAME factory the
 * commit uses - so a wavy Radiation Path previews as a wave from the first
 * frame, and a smooth Convection Flow previews as a curve. It is a `preview:
 * true` object and is never added to the document.
 *
 * When the drag CONTINUES a path, the preview carries the path's existing
 * points followed by the segment's far end, so the whole path is previewed (and
 * stays visible) while the new segment is dragged, not just the new segment.
 */
export function heatPathSegmentPreview(toolId, start, cursor, continuation = null) {
  if (!finitePoint(start) || !finitePoint(cursor)) {
    return null;
  }

  /* A segment shorter than a pixel is not a segment yet. */
  if (Math.hypot(cursor.x - start.x, cursor.y - start.y) < 1e-9) {
    return null;
  }

  const variant =
    {
      "conduction-path": "conduction",
      "convection-flow": "convection",
      "radiation-path": "radiation",
    }[toolId] || "conduction";

  const prefix =
    continuation?.path &&
    Array.isArray(continuation.path.geometry?.points)
      ? continuation.path.geometry.points.filter(finitePoint).slice(0, -1)
      : [];

  const points = [
    ...prefix,
    { x: start.x, y: start.y },
    { x: cursor.x, y: cursor.y },
  ];

  const object = enggHeatModel.createHeatPath({
    points,
    variant,
    style:
      continuation?.path?.style || { ...(drawingState.styleDefaults || {}) },
  });

  if (object) {
    object.preview = true;
  }

  return object;
}

/*
 * COMMIT ONE SEGMENT.
 *
 * Called on the release. If the drag continued a path, the segment's far end is
 * APPENDED to that path - its earlier points and its identity are untouched. If
 * it did not, the segment is committed as a NEW path object with its own id.
 *
 * The commit is ONE undoable change either way. Afterwards the tool is IDLE
 * with the (possibly extended) path's far end remembered, so the next drag from
 * there continues it and a drag from anywhere else starts a new path.
 */
export function commitHeatPathSegment(toolId, start, end) {
  if (!finitePoint(start) || !finitePoint(end)) {
    return null;
  }

  if (Math.hypot(end.x - start.x, end.y - start.y) < 1e-9) {
    return null;
  }

  const continuation = heatPathContinuationTarget(start);

  const variant =
    {
      "conduction-path": "conduction",
      "convection-flow": "convection",
      "radiation-path": "radiation",
    }[toolId] || "conduction";

  const previousObjects = enggDrawingState.snapshotDrawing(drawingState);

  let path;

  if (continuation?.path) {
    /* CONTINUE: append to the SAME object, in the sheet's own copy. */
    path =
      drawingState.objects.find(
        (object) => object.id === continuation.path.id
      ) || continuation.path;

    if (!enggHeatModel.appendHeatPathSegment(path, end)) {
      return null;
    }
  } else {
    /* NEW PATH: one object, its own id, its own two points. */
    path = enggHeatModel.createHeatPath({
      points: [start, end],
      variant,
      style: { ...(drawingState.styleDefaults || {}) },
    });

    if (!path) {
      return null;
    }

    enggDrawingState.addObject(drawingState, path);
  }

  enggDrawingState.commitDrawingChange(drawingState, previousObjects);

  const committed =
    drawingState.objects.find((object) => object.id === path.id) || path;

  enggDrawingState.selectObject(drawingState, committed.id);

  /* IDLE AGAIN: clear the drag's own state, keep only the continuation. */
  enggDrawingState.setInteraction(drawingState, {
    heatTool: toolId,
    phase: HEAT_POLY_PHASE,
    heatPathId: committed.id,
    heatPoints: [],
    heatStart: null,
    preview: null,
    snapCandidate: null,
    inference: null,
    guideline: null,
    snapGeometry: [],
  });

  setToolMessage(heatInstruction(toolId));

  refresh();

  return committed;
}

/* Whether a path is being continued (its far end is remembered). */
export function heatPathIsOpen() {
  return Boolean(drawingState.interaction?.heatPathId);
}

/* The remembered continuation point, for a status line or a test. */
export function heatPathContinuationPoint() {
  const id = drawingState.interaction?.heatPathId;

  if (!id) {
    return null;
  }

  const path = (drawingState.objects || []).find((object) => object.id === id);

  const points = Array.isArray(path?.geometry?.points)
    ? path.geometry.points.filter(finitePoint)
    : [];

  return points.length ? points[points.length - 1] : null;
}

/*
 * FINISH THE PATH.
 *
 * The path was already committed and is already on the sheet, so finishing only
 * forgets the continuation - the next drag starts a wholly new path. This is the
 * same "double-click / Enter finishes the path" the Pipe / Duct tool uses.
 */
export function finishHeatPath(toolId) {
  const tool =
    toolId || drawingState.interaction?.heatTool || drawingState.activeTool;

  enggDrawingState.setInteraction(drawingState, {
    heatTool: tool,
    phase: HEAT_POLY_PHASE,
    heatPathId: null,
    heatPoints: [],
    heatStart: null,
    preview: null,
    snapGeometry: [],
  });

  setToolMessage(heatInstruction(tool));

  renderCurrentDrawing();

  return true;
}

/*
 * CANCEL - discard the segment being dragged and forget the continuation.
 *
 * Nothing half-drawn exists (a segment is only written on release), so this is
 * the whole rollback: no object, no preview, no continuation. Previously
 * committed paths are untouched.
 */
export function cancelHeatPoly(toolId) {
  const tool =
    toolId || drawingState.interaction?.heatTool || drawingState.activeTool;

  enggDrawingState.setInteraction(drawingState, {
    heatTool: tool,
    phase: HEAT_POLY_PHASE,
    heatPathId: null,
    heatPoints: [],
    heatStart: null,
    preview: null,
    snapCandidate: null,
    inference: null,
    guideline: null,
    snapGeometry: [],
  });

  setToolMessage(heatInstruction(tool));

  renderCurrentDrawing();
}

/* The open chain accessors are kept for the routers that ask; a segment-by-drag
 * path has no click chain, so there are never pending points. */
export function heatPolyPoints() {
  return [];
}

export function heatPolyIsDrawing() {
  return false;
}

const enggHeatTool = {
  HEAT_DRAG_PHASE,
  HEAT_POLY_PHASE,
  HEAT_CLICK_TOOLS,
  HEAT_DRAG_TOOLS,
  HEAT_POLY_TOOLS,
  isHeatClickTool,
  isHeatDragTool,
  isHeatPolyTool,
  beginHeatToolSession,
  heatToolInstruction,
  commitHeatClickAt,
  heatDragPreview,
  commitHeatDrag,
  heatPathSegmentPreview,
  commitHeatPathSegment,
  heatPathContinuationTarget,
  heatPathIsOpen,
  heatPathContinuationPoint,
  finishHeatPath,
  cancelHeatPoly,
  heatPolyPoints,
  heatPolyIsDrawing,
};

export default enggHeatTool;

/*
 * THE EDITOR-STATE HOOK.
 *
 * `editorState` is imported here so the creation-drag layer's session records
 * stay consistent with the rest of the editor; it is deliberately not read
 * back, so this module never forms a cycle with the document.
 */
void editorState;
