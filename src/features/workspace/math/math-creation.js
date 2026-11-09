/*
 * ============================================================
 * CREATING AND CONSTRUCTING MATH OBJECTS
 * ============================================================
 *
 * The one place a Math object is built from a gesture. The click router and the
 * drag router both come here, so a Point placed by a click and a Vector drawn by
 * a drag are committed by the same code that selects them, records the undo
 * entry and writes the source.
 *
 * THE INTERACTION CONTRACT, STATED ONCE.
 *
 *   - a tool stays armed after a successful operation;
 *   - the new object becomes the selection, so its Features panel opens;
 *   - a click-to-create tool treats every valid click as a placement;
 *   - a drag tool stays armed after the drag;
 *   - a multi-step tool takes all its inputs before it can be cancelled;
 *   - Escape cancels an incomplete operation and returns to Select;
 *   - switching tools cancels an incomplete operation.
 *
 * The last three are the shared systems' - `cancelInteraction` and
 * `activateTool` - and nothing here re-implements them.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggMathModel from "./math-model.js";
import { drawingState, editorState } from "../editor-state.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";
import { MATH_TOOL_IDS, mathInstruction } from "./math-tools.js";
import enggGridPlacement from "../../../shared/placement/grid-placement.js";

import { openEquationEditor } from "./math-equation-editor.js";

/* ============================================================
 * COMMITTING
 * ============================================================ */

/*
 * ONE COMMIT PATH. The object is added, selected and committed as one undoable
 * change - and the tool is deliberately NOT disarmed, because a Math tool is a
 * drawing tool and the next object is drawn without pressing the button again.
 */
export function commitMathObject(object) {
  if (!object) {
    return null;
  }

  const previous = enggDrawingState.snapshotDrawing(drawingState);

  const stored = enggDrawingState.addObject(drawingState, object);

  enggDrawingState.selectObject(drawingState, stored.id);

  enggDrawingState.commitDrawingChange(drawingState, previous);

  enggDrawingState.setInteraction(drawingState, {
    phase: "idle",
    mathTool: drawingState.activeTool,
    mathMode: drawingState.interaction?.mathMode || null,
    mathStage: null,
    mathTargetId: null,
    mathContact: null,
    mathStart: null,
    mathEnd: null,
    mathPreview: null,
  });

  /*
   * THE TOOL STAYS ARMED, and the mode with it - so the next object is the same
   * kind as the one just placed. The interaction is reset to its first stage,
   * which is what stops a completed placement from being carried into the next
   * one.
   */

  setToolMessage(
    mathInstruction(
      drawingState.activeTool,
      drawingState.interaction?.mathMode,
    ),
  );

  renderProperties();
  renderCurrentDrawing();

  return stored;
}

/* The style a new Math object starts with: the sheet's own defaults. */
function mathStyle() {
  return { ...(drawingState.styleDefaults || {}) };
}

function mathOptions(extra = {}) {
  return {
    style: mathStyle(),
    engineering: { discipline: "math" },
    ...extra,
  };
}

/* ============================================================
 * POINT
 * ============================================================
 *
 * A persistent click-to-create tool. The click is the placement; the point is
 * created, selected, and the tool waits for the next one.
 *
 * A point placed ON a curve is associated with it: the curve's id and the
 * parameter along it are recorded, so the point follows the curve when the
 * curve changes. A point placed inside a graph records the graph, so its
 * coordinate projections have an axis to reach.
 */
export function placeMathPoint(point) {
  if (!enggMathModel.finitePoint(point)) {
    return null;
  }

  const hit = curveUnder(point);
  const plot = plotUnder(point);

  const object = enggMathModel.createMathPoint(point, {
    ...mathOptions(),
    parentCurveId: hit ? hit.plot.id : null,
    curveFunctionId: hit ? hit.functionId : null,
    curveParameter: hit ? curveParameterAt(hit.plot, point, hit.functionId) : null,
    parentGraphId: plot ? plot.id : null,
  });

  return commitMathObject(object);
}

/*
 * THE CURVE A POINT LANDED ON, AND WHICH FUNCTION OF ITS PLOT IT IS.
 *
 * A Plot owns several functions, so "the curve under the pointer" is two
 * facts: the plot, and the component inside it. Both are recorded, so a point
 * placed on the second curve of a plot follows THAT curve rather than the
 * plot's first one.
 */
function curveUnder(point) {
  const tolerance =
    8 /
    Math.max(
      1,
      enggDrawingState.BASE_PIXELS_PER_UNIT * (drawingState.camera?.zoom || 1),
    );

  let best = null;

  drawingState.objects.forEach((object) => {
    if (object.type !== enggMathModel.MATH_PLOT_TYPE) {
      return;
    }

    enggMathModel.plotFunctions(object).forEach((component) => {
      const nearest = enggMathModel.nearestPointOnCurve(
        object,
        point,
        component.id,
      );

      if (
        nearest &&
        nearest.distance <= tolerance &&
        (!best || nearest.distance < best.distance)
      ) {
        best = { plot: object, functionId: component.id, distance: nearest.distance };
      }
    });
  });

  return best;
}

/* The Plot whose box contains `point`, if any. */
function plotUnder(point) {
  return (
    [...drawingState.objects].reverse().find((object) => {
      if (object.type !== enggMathModel.MATH_PLOT_TYPE) {
        return false;
      }

      const frame = enggMathModel.graphFrame(object);

      return Boolean(
        frame &&
        point.x >= frame.position.x &&
        point.x <= frame.position.x + frame.width &&
        point.y >= frame.position.y &&
        point.y <= frame.position.y + frame.height,
      );
    }) || null
  );
}

/* Where along a curve a point sits, as a fraction of its drawn length. */
function curveParameterAt(plot, point, functionId = null) {
  const strokes = enggMathModel.curveStrokes(plot, functionId);

  if (!strokes.length) {
    return null;
  }

  const stroke = strokes[0];

  let travelled = 0;
  let total = 0;
  let best = { distance: Infinity, at: 0 };

  for (let index = 1; index < stroke.length; index += 1) {
    const a = stroke[index - 1];
    const b = stroke[index];
    const length = Math.hypot(b.x - a.x, b.y - a.y);

    total += length;

    const offset = Math.hypot(point.x - a.x, point.y - a.y);

    if (offset < best.distance) {
      best = { distance: offset, at: travelled };
    }

    travelled += length;
  }

  return total > 0 ? best.at / total : null;
}

/* ============================================================
 * VECTOR
 * ============================================================
 *
 * Press at the tail, drag to the head, release. A press that never travels is
 * not a vector: a zero-length arrow is not a vector, and creating one would be
 * a feature the student cannot see or use.
 */
export function createMathVectorFromDrag(start, end) {
  if (!enggMathModel.finitePoint(start) || !enggMathModel.finitePoint(end)) {
    return null;
  }

  const length = Math.hypot(end.x - start.x, end.y - start.y);

  if (length < 1e-6) {
    return null;
  }

  const plot = plotUnder(start);

  const object = enggMathModel.createMathVector(start, end, {
    ...mathOptions(),
    parentGraphId: plot ? plot.id : null,
  });

  return commitMathObject(object);
}

/* ============================================================
 * PLOT - PLOT MODE
 * ============================================================
 *
 * Drag out the plotting area. A click without a meaningful drag is not a plot:
 * a zero-size area has no axes to draw and no coordinates to give.
 *
 * The new Plot starts with ONE expression ready to type, because a plot with
 * no function in it is a frame rather than a graph - and the student's next
 * act is always to say what is drawn on it.
 */
export function createMathPlotFromDrag(from, to, options = {}) {
  if (!enggMathModel.finitePoint(from) || !enggMathModel.finitePoint(to)) {
    return null;
  }

  const position = {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
  };

  const width = Math.abs(to.x - from.x);
  const height = Math.abs(to.y - from.y);

  if (
    width < enggMathModel.MIN_GRAPH_SIDE ||
    height < enggMathModel.MIN_GRAPH_SIDE
  ) {
    return null;
  }

  const object = enggMathModel.createMathPlot(position, width, height, {
    ...mathOptions(),
    mode: "plot",
    functions: [
      enggMathModel.createPlotFunction({
        expression: String(options.expression ?? "x^2"),
      }),
    ],
  });

  return commitMathObject(object);
}

/*
 * ADD A FUNCTION TO AN EXISTING PLOT.
 *
 * A plot holds as many functions as the student wants, so adding one is an
 * edit to the plot rather than the creation of a new object. The domain
 * defaults to the plot's own X range, which is what "draw it across the graph"
 * means.
 */
export function addPlotFunction(plot, expression, options = {}) {
  if (!plot || plot.type !== enggMathModel.MATH_PLOT_TYPE) {
    return null;
  }

  if (!enggMathModel.curveExpressionValid(expression)) {
    setToolMessage(
      "That expression cannot be plotted - check it and try again",
    );

    return null;
  }

  const limits = enggMathModel.graphLimits(plot);

  const component = enggMathModel.createPlotFunction({
    expression,
    variable: options.variable || "x",
    domain: {
      min: Number.isFinite(Number(options.domain?.min))
        ? Number(options.domain.min)
        : limits.xMin,
      max: Number.isFinite(Number(options.domain?.max))
        ? Number(options.domain.max)
        : limits.xMax,
    },
  });

  const previous = enggDrawingState.snapshotDrawing(drawingState);

  plot.geometry = {
    ...plot.geometry,
    functions: [...enggMathModel.plotFunctions(plot), component],
  };

  enggDrawingState.commitDrawingChange(drawingState, previous);

  renderProperties();
  renderCurrentDrawing();

  return component;
}

/* Remove one function from a plot, by its component id. */
export function removePlotFunction(plot, functionId) {
  if (!plot || plot.type !== enggMathModel.MATH_PLOT_TYPE) {
    return false;
  }

  const remaining = enggMathModel
    .plotFunctions(plot)
    .filter((component) => component.id !== functionId);

  if (remaining.length === enggMathModel.plotFunctions(plot).length) {
    return false;
  }

  const previous = enggDrawingState.snapshotDrawing(drawingState);

  plot.geometry = { ...plot.geometry, functions: remaining };

  enggDrawingState.commitDrawingChange(drawingState, previous);

  renderProperties();
  renderCurrentDrawing();

  return true;
}

/* ============================================================
 * EQUATION
 * ============================================================
 *
 * The click places the anchor and opens the INLINE editor at that point. The
 * editor is anchored to the drawing space, not a popup - see
 * `math-equation-editor.js`.
 */
export function beginMathEquation(point) {
  if (!enggMathModel.finitePoint(point)) {
    return null;
  }

  return openEquationEditor(point, {
    onCommit: (content) => {
      const object = enggMathModel.createMathEquation(point, {
        ...mathOptions(),
        content,
      });

      return commitMathObject(object);
    },
  });
}

/* ============================================================
 * COMMITTING A GRAPH FROM AN EDITOR
 * ============================================================
 *
 * Both editors hand back a finished result and the graph they were editing -
 * null for a new one. These two functions are the ONE place a graph is written
 * to the document, so a new graph and an edited one take the same path: the
 * geometry is replaced, the object keeps its id, and the whole thing is one
 * undoable change.
 *
 * EDITING PRESERVES THE OBJECT. The id, the name, the style and every
 * relationship a Point, a Vector or a Tangent holds to it are untouched - only
 * the geometry the editor owns is replaced.
 */
export function commitGraphFromPlot(result, existing, placement = null) {
  if (!result?.geometry) {
    return null;
  }

  if (existing) {
    const previous = enggDrawingState.snapshotDrawing(drawingState);

    existing.geometry = { ...existing.geometry, ...result.geometry, mode: "plot" };

    enggDrawingState.commitDrawingChange(drawingState, previous);
    enggDrawingState.selectObject(drawingState, existing.id);

    renderProperties();
    renderCurrentDrawing();

    return existing;
  }

  const geometry = result.geometry;

  /*
   * THE PLACEMENT MOVES AND SCALES THE BOX, AND NOTHING ELSE. A Plot's curves
   * are sampled from its expressions through its own mapping, so moving the
   * box moves the curves with it - there is no second copy of the geometry to
   * keep in step.
   */
  const position = placement
    ? enggGridPlacement.applyPlacement(geometry.position, placement)
    : geometry.position;

  const scale = placement ? placement.scale : 1;

  const object = enggMathModel.createMathPlot(
    position,
    (Number(geometry.width) || 200) * scale,
    (Number(geometry.height) || 200) * scale,
    {
      ...mathOptions(),
      ...geometry,
      mode: "plot",
    },
  );

  return commitMathObject(object);
}

export function commitGraphFromSketch(result, existing, placement = null) {
  const strokes = Array.isArray(result?.strokes) ? result.strokes : [];

  if (!strokes.length) {
    return null;
  }

  /*
   * THE PLACEMENT IS APPLIED TO THE STROKES BEFORE THEY BECOME COMPONENTS, so
   * the committed graph is where the student put it - and the preview they
   * saw is the geometry they get.
   */
  const placed = placement
    ? strokes.map((stroke) => ({
        ...stroke,
        points: enggGridPlacement.applyPlacementToPoints(
          stroke.points,
          placement,
        ),
        original: enggGridPlacement.applyPlacementToPoints(
          stroke.original || stroke.points,
          placement,
        ),
      }))
    : strokes;

  const functions = placed.map((stroke) =>
    enggMathModel.createSketchFunction(stroke, {
      showOriginalTrace: stroke.showOriginalTrace === true,
    }),
  );

  if (existing) {
    const previous = enggDrawingState.snapshotDrawing(drawingState);

    existing.geometry = {
      ...existing.geometry,
      mode: "sketch",
      functions,
    };

    enggDrawingState.commitDrawingChange(drawingState, previous);
    enggDrawingState.selectObject(drawingState, existing.id);

    renderProperties();
    renderCurrentDrawing();

    return existing;
  }

  return commitSketchPlot(placed, { showOriginalTrace: true });
}

/* ============================================================
 * PLOT - SKETCH MODE
 * ============================================================
 *
 * The student draws the whole graph - axes, straight lines, curves - and the
 * strokes are reconstructed into ONE Plot. Each stroke becomes a function
 * component of that plot, so the curves are parts of the graph rather than
 * separate drawings that happen to sit on it.
 *
 * The plot's box is the bounding box of everything drawn, and its coordinate
 * limits default to the standard -5..5 until the student sets them in Plot
 * Settings. Nothing is invented: the geometry is where they drew it, and the
 * numbers are the ones the panel states.
 */
export function commitSketchPlot(strokes, options = {}) {
  const list = (Array.isArray(strokes) ? strokes : []).filter(
    (stroke) => stroke && Array.isArray(stroke.points) && stroke.points.length > 1,
  );

  if (!list.length) {
    return null;
  }

  const all = list.flatMap((stroke) => stroke.points);

  const minX = Math.min(...all.map((point) => point.x));
  const maxX = Math.max(...all.map((point) => point.x));
  const minY = Math.min(...all.map((point) => point.y));
  const maxY = Math.max(...all.map((point) => point.y));

  const width = Math.max(enggMathModel.MIN_GRAPH_SIDE, maxX - minX);
  const height = Math.max(enggMathModel.MIN_GRAPH_SIDE, maxY - minY);

  const object = enggMathModel.createMathPlot(
    { x: minX, y: minY },
    width,
    height,
    {
      ...mathOptions(),
      mode: "sketch",
      functions: list.map((stroke) =>
        enggMathModel.createSketchFunction(stroke, {
          showOriginalTrace: options.showOriginalTrace === true,
          smoothing: Number(options.smoothing) || 0,
        }),
      ),
    },
  );

  return commitMathObject(object);
}

/* ============================================================
 * TANGENT / NORMAL
 * ============================================================
 *
 * PLOT: the direction is the curve's local direction at the contact point, and
 * a normal is that direction turned a quarter turn. The construction is
 * constrained to its parent - moving the contact point re-derives it.
 *
 * SKETCH: the student draws the line's direction, and the reconstructed
 * direction is kept as the student's own. It is illustrative, and the object
 * says so by recording `mode: "sketch"`.
 */
export function createTangentAt(curve, contact, options = {}) {
  if (!curve || !enggMathModel.finitePoint(contact)) {
    return null;
  }

  const type = options.constructionType === "normal" ? "normal" : "tangent";
  const mode = options.mode === "plot" ? "plot" : "sketch";

  /*
   * THE DIRECTION COMES FROM THE CURVE THE CONTACT POINT IS ON. A plot may
   * hold several functions, so the component is named explicitly - otherwise
   * a tangent on the second curve would take its direction from the first.
   */
  const strokes = enggMathModel.curveStrokes(curve, options.functionId || null);

  const tangent = strokes.length
    ? enggMathModel.pathDirectionAt(strokes[0], contact)
    : null;

  const direction =
    options.direction || enggMathModel.constructionDirection(type, tangent);

  if (!direction) {
    setToolMessage(
      "The curve has no direction at that point - try another position",
    );

    return null;
  }

  const length =
    Number(options.length) || enggMathModel.DEFAULT_CONSTRUCTION_LENGTH;

  const ends = enggMathModel.constructionEnds(contact, direction, length);

  if (!ends) {
    return null;
  }

  const object = enggMathModel.createMathTangent(
    {
      contact,
      start: ends.start,
      end: ends.end,
      direction,
      length,
    },
    {
      ...mathOptions(),
      constructionType: type,
      mode,
      parentCurveId: curve.id,
      functionId: options.functionId || null,
    },
  );

  return commitMathObject(object);
}

/* ============================================================
 * SLOPE TRIANGLE
 * ============================================================
 *
 * PLOT: two positions along a straight parent. The triangle is the run, the
 * rise and the hypotenuse between them, and its right angle is at the corner
 * they meet.
 *
 * SKETCH: the student draws a triangle, and the reconstruction regularises the
 * corner nearest a right angle. It is illustrative, and it claims no link to a
 * line it was not given.
 */
export function createSlopeTriangle(start, end, options = {}) {
  const geometry = enggMathModel.slopeTriangleGeometry(start, end);

  if (!geometry) {
    return null;
  }

  if (geometry.vertical && options.mode === "plot") {
    setToolMessage(
      "A vertical line has no finite slope - choose two positions with a horizontal run",
    );

    return null;
  }

  const object = enggMathModel.createMathSlopeTriangle(geometry, {
    ...mathOptions(),
    mode: options.mode === "plot" ? "plot" : "sketch",
    parentLineId: options.parentLineId || null,
  });

  return commitMathObject(object);
}

/* ============================================================
 * THE STRAIGHT PARENTS A SLOPE TRIANGLE MAY USE
 * ============================================================
 *
 * A straight line, a Vector, a linear Function Curve, a Tangent and a Normal.
 * An arbitrary curved path is deliberately not supported: a slope along a curve
 * is a different construction, and pretending otherwise would draw a triangle
 * that claims a straight relationship the parent does not have.
 */
export function straightParentAt(point) {
  const tolerance =
    8 /
    Math.max(
      1,
      enggDrawingState.BASE_PIXELS_PER_UNIT * (drawingState.camera?.zoom || 1),
    );

  const candidates = [...drawingState.objects].reverse();

  for (const object of candidates) {
    if (object.visible === false) {
      continue;
    }

    if (
      object.type === "line" ||
      object.type === enggMathModel.MATH_VECTOR_TYPE ||
      object.type === enggMathModel.MATH_TANGENT_TYPE
    ) {
      const geometry = object.geometry || {};

      if (
        geometry.start &&
        geometry.end &&
        distanceToSegment(point, geometry.start, geometry.end) <= tolerance
      ) {
        return object;
      }

      continue;
    }

    if (
      object.type === enggMathModel.MATH_CURVE_TYPE &&
      object.geometry?.mode === "plot"
    ) {
      const strokes = enggMathModel.curveStrokes(object, drawingState.objects);

      if (strokes.length === 1 && isStraight(strokes[0], tolerance)) {
        const nearest = enggMathModel.nearestPointOnCurve(
          object,
          drawingState.objects,
          point,
        );

        if (nearest && nearest.distance <= tolerance) {
          return object;
        }
      }
    }
  }

  return null;
}

function isStraight(points, tolerance) {
  if (!Array.isArray(points) || points.length < 2) {
    return false;
  }

  const first = points[0];
  const last = points[points.length - 1];

  return points.every(
    (point) =>
      distanceToSegment(point, first, last) <= Math.max(tolerance, 1e-6),
  );
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared <= 1e-12) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
    ),
  );

  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

/* The point on a straight parent nearest `at`, clamped to its ends. */
export function pointOnStraightParent(parent, at) {
  const geometry = parent?.geometry || {};

  let start = geometry.start;
  let end = geometry.end;

  if (!start || !end) {
    return null;
  }

  if (parent.type === enggMathModel.MATH_CURVE_TYPE) {
    const strokes = enggMathModel.curveStrokes(parent, drawingState.objects);

    if (!strokes.length) {
      return null;
    }

    start = strokes[0][0];
    end = strokes[0][strokes[0].length - 1];
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared <= 1e-12) {
    return { x: start.x, y: start.y };
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((at.x - start.x) * dx + (at.y - start.y) * dy) / lengthSquared,
    ),
  );

  return { x: start.x + t * dx, y: start.y + t * dy };
}

/* ============================================================
 * THE CLICK ROUTER'S ENTRY POINT
 * ============================================================
 *
 * Called by `handleCanvasClick` for every Math tool. It decides what the click
 * means from the tool and the stage, and returns true when it consumed it.
 */
export function handleMathClick(resolution) {
  const toolId = drawingState.activeTool;
  const point =
    resolution?.effectiveConstructionPoint || resolution?.rawPointerPoint;

  if (!point) {
    return false;
  }

  const mode = drawingState.interaction?.mathMode || "sketch";

  switch (toolId) {
    case MATH_TOOL_IDS.point:
      placeMathPoint(point);
      return true;

    case MATH_TOOL_IDS.equation:
      beginMathEquation(point);
      return true;

    case MATH_TOOL_IDS.plot:
      return handlePlotClick(point, mode);

    case MATH_TOOL_IDS.tangent:
      return handleTangentClick(point);

    case MATH_TOOL_IDS.slopeTriangle:
      return handleSlopeTriangleClick(point);

    default:
      return false;
  }
}

/*
 * A CLICK WITH THE PLOT TOOL.
 *
 * In PLOT mode the plot is drawn by a drag, so a bare click is the student
 * finishing with the tool - the shared classifier handles that, and nothing is
 * consumed here.
 *
 * In SKETCH mode the student draws the graph, so a click is likewise not a
 * placement. Both modes therefore decline the click, which is what lets the
 * shared exit rules work.
 */
function handlePlotClick(point, mode) {
  void point;
  void mode;

  return false;
}

/*
 * TANGENT / NORMAL IS ONE CONSTRUCTION, NOT TWO MODES.
 *
 * The student clicks the curve, and the construction is derived from the
 * curve's own local direction at that point - a tangent along it, a normal
 * across it. There is no Sketch variant to choose between: the direction is
 * the parent's, which is what makes the object a tangent rather than a line
 * that happens to be near one.
 */
function handleTangentClick(point) {
  const curve = curveUnder(point);

  if (!curve) {
    setToolMessage("Click a Function Curve to place the construction on");

    return true;
  }

  createTangentAt(curve, point, {
    mode: "plot",
    constructionType: editorState.mathConstructionType || "tangent",
  });

  return true;
}

/*
 * SLOPE TRIANGLE IS ONE CONSTRUCTION TOO: a parent, then two positions along
 * it. Both clicks are required inputs, so neither is a cancellation.
 */
function handleSlopeTriangleClick(point) {
  const stage = drawingState.interaction?.mathStage;

  if (stage === "start") {
    const parent = enggMathModel.objectById(
      drawingState.objects,
      drawingState.interaction.mathTargetId,
    );

    if (!parent) {
      enggDrawingState.setInteraction(drawingState, {
        ...drawingState.interaction,
        phase: "idle",
        mathStage: null,
        mathTargetId: null,
        mathStart: null,
      });

      setToolMessage(mathInstruction(MATH_TOOL_IDS.slopeTriangle));

      return true;
    }

    const end = pointOnStraightParent(parent, point);

    if (!end) {
      return true;
    }

    createSlopeTriangle(drawingState.interaction.mathStart, end, {
      mode: "plot",
      parentLineId: parent.id,
    });

    return true;
  }

  const parent = straightParentAt(point);

  if (!parent) {
    setToolMessage(
      "Click a straight line, a Vector, a linear curve, a Tangent or a Normal",
    );

    return true;
  }

  const start = pointOnStraightParent(parent, point);

  if (!start) {
    return true;
  }

  enggDrawingState.setInteraction(drawingState, {
    ...drawingState.interaction,
    phase: "math-slope-start",
    mathStage: "start",
    mathTargetId: parent.id,
    mathStart: start,
  });

  setToolMessage("Click the second position along the line");

  renderCurrentDrawing();

  return true;
}

/* ============================================================
 * THE DRAG ROUTER'S ENTRY POINT
 * ============================================================
 *
 * Called by the creation-drag pipeline for a press with a Math tool armed. It
 * returns true when the press belongs to the tool.
 */
export function beginMathDrag(event, resolution) {
  const toolId = drawingState.activeTool;

  if (toolId !== MATH_TOOL_IDS.vector && toolId !== MATH_TOOL_IDS.graph) {
    return false;
  }

  const point =
    resolution?.effectiveConstructionPoint || resolution?.rawPointerPoint;

  if (!point) {
    return false;
  }

  editorState.mathDrag = {
    toolId,
    pointerId: event?.pointerId,
    start: { x: point.x, y: point.y },
    startScreen: { x: event?.clientX ?? 0, y: event?.clientY ?? 0 },
    moved: false,
  };

  return true;
}

export function moveMathDrag(event, resolution) {
  const session = editorState.mathDrag;

  if (!session) {
    return false;
  }

  if (!session.moved) {
    const travel = Math.hypot(
      (event?.clientX ?? 0) - session.startScreen.x,
      (event?.clientY ?? 0) - session.startScreen.y,
    );

    if (travel < 4) {
      return true;
    }

    session.moved = true;
  }

  const point =
    resolution?.effectiveConstructionPoint || resolution?.rawPointerPoint;

  if (!point) {
    return true;
  }

  enggDrawingState.setInteraction(drawingState, {
    ...drawingState.interaction,
    mathPreview: {
      toolId: session.toolId,
      start: session.start,
      end: { x: point.x, y: point.y },
    },
  });

  renderCurrentDrawing();

  return true;
}

export function finishMathDrag(resolution) {
  const session = editorState.mathDrag;

  if (!session) {
    return false;
  }

  editorState.mathDrag = null;

  const point =
    resolution?.effectiveConstructionPoint || resolution?.rawPointerPoint;

  enggDrawingState.setInteraction(drawingState, {
    ...drawingState.interaction,
    mathPreview: null,
  });

  if (!session.moved || !point) {
    renderCurrentDrawing();

    return true;
  }

  if (session.toolId === MATH_TOOL_IDS.vector) {
    createMathVectorFromDrag(session.start, point);
  } else if (session.toolId === MATH_TOOL_IDS.plot) {
    createMathPlotFromDrag(session.start, point);
  }

  return true;
}

export function cancelMathDrag() {
  if (!editorState.mathDrag) {
    return false;
  }

  editorState.mathDrag = null;

  enggDrawingState.setInteraction(drawingState, {
    ...drawingState.interaction,
    mathPreview: null,
  });

  return true;
}

/* ============================================================
 * THE SKETCH STROKE
 * ============================================================
 *
 * A stroke drawn with the Plot tool in Sketch mode is captured by the trace
 * session and handed here on release. The reconstruction is the shared one -
 * simplify, smooth, fit - so the geometry is cleaned the same way every other
 * traced drawing in the application is.
 *
 * THE STROKE IS ONE COMPONENT OF THE PLOT, not a curve of its own. The session
 * collects the strokes the student draws and commits them together as one
 * Plot, so the axes and the curves are parts of one object.
 */
export function reconstructMathStroke(rawPoints) {
  const scale =
    enggDrawingState.BASE_PIXELS_PER_UNIT *
    Math.max(Number(drawingState.camera?.zoom) || 1, 0.25);

  return enggMathModel.reconstructStroke(rawPoints, {
    tolerance: enggMathModel.STROKE_SIMPLIFY_PX / scale,
    smoothing: enggMathModel.STROKE_SMOOTH_PX / scale,
  });
}

const enggMathCreation = {
  commitMathObject,
  placeMathPoint,
  createMathVectorFromDrag,
  createMathPlotFromDrag,
  commitGraphFromPlot,
  commitGraphFromSketch,
  addPlotFunction,
  removePlotFunction,
  beginMathEquation,
  commitSketchPlot,
  createTangentAt,
  createSlopeTriangle,
  straightParentAt,
  pointOnStraightParent,
  handleMathClick,
  beginMathDrag,
  moveMathDrag,
  finishMathDrag,
  cancelMathDrag,
  reconstructMathStroke,
};

export default enggMathCreation;
