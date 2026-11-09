/*
 * ============================================================
 * THE MATH / ANALYSIS OBJECT MODEL
 * ============================================================
 *
 * The seven Math objects - a Point, a Vector, a Function Curve, a Coordinate
 * Graph, an Equation, a Tangent / Normal and a Slope Triangle - are ordinary
 * DAETUM features. They are created through the same `createGeometryObject`
 * every other feature uses, so they are named, numbered, selected, moved,
 * duplicated, undone and written to the source by the shared systems.
 *
 * WHAT THIS MODULE OWNS, AND WHAT IT DOES NOT.
 *
 * It owns the MATHEMATICS of the objects: where a graph's axes are, what a
 * graph coordinate means in drawing units, how a function is sampled, how a
 * freehand stroke is reduced to a clean curve, and how a tangent, a normal and
 * a slope triangle are derived from their parents. It does NOT own rendering,
 * handles, the Features panel or the source - those read the functions here,
 * so the canvas, the panel and the TikZ cannot disagree about a number.
 *
 * COORDINATE GRAPH VERSUS COORDINATE SYSTEM.
 *
 * A Coordinate System (Statics) is a reusable spatial reference: an origin and
 * two arms. A Coordinate Graph is a VISIBLE PLOTTING ENVIRONMENT: a box with
 * axes, a grid, ticks, labels and a mapping between graph coordinates and
 * drawing units. They are different objects and neither is derived from the
 * other. `graphMapping` below is the one place that mapping is defined.
 *
 * NOTHING HERE IS A SOLVER. A function curve is sampled from the expression the
 * student typed; a tangent is the curve's local direction; a slope triangle's
 * rise and run are read off its own two points. No value is invented.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggDiagramEquations from "../model/analysis/diagram-equations.js";

/* ============================================================
 * THE TYPES
 * ============================================================ */

export const MATH_POINT_TYPE = "math-point";
export const MATH_VECTOR_TYPE = "math-vector";
export const MATH_EQUATION_TYPE = "math-equation";
export const MATH_TANGENT_TYPE = "math-tangent";
export const MATH_SLOPE_TRIANGLE_TYPE = "math-slope-triangle";

/*
 * ============================================================
 * THE PLOT: ONE OBJECT, NOT A GRAPH AND A CURVE
 * ============================================================
 *
 * A Plot is the COMPLETE mathematical graph: its box, its axes, its grid, its
 * ranges and labels, AND the function curves drawn inside it. The coordinate
 * environment and the curves are parts of one object, because that is what a
 * student means by "a plot" - they do not think of the axes and the curve as
 * two drawings that happen to overlap.
 *
 * The curves are COMPONENTS of the Plot, not separate features. Each has its
 * own stable id (`function-1`, `function-2` ...) so the Features panel, the
 * source and a tangent can all name one, but none of them is a top-level
 * object: selecting the plot selects the whole thing, moving it moves the
 * curves with it, and deleting it deletes them.
 *
 * THE OLD TYPES ARE STILL READ. A drawing saved before this change carries a
 * `math-graph` and one or more `math-curve` objects. They are MIGRATED into a
 * single Plot the first time the drawing is opened (see `migrateLegacyMath`),
 * so nothing the student drew is lost and there is exactly one live
 * representation afterwards.
 */
export const MATH_PLOT_TYPE = "math-plot";

/* The types a saved drawing may still carry, read for migration only. */
export const LEGACY_MATH_GRAPH_TYPE = "math-graph";
export const LEGACY_MATH_CURVE_TYPE = "math-curve";

export const MATH_TYPES = Object.freeze([
  MATH_POINT_TYPE,
  MATH_VECTOR_TYPE,
  MATH_PLOT_TYPE,
  MATH_EQUATION_TYPE,
  MATH_TANGENT_TYPE,
  MATH_SLOPE_TRIANGLE_TYPE,
]);

export function isMathType(type) {
  return MATH_TYPES.includes(type);
}

/* ============================================================
 * SMALL HELPERS
 * ============================================================ */

export function finitePoint(candidate) {
  return Boolean(
    candidate &&
    Number.isFinite(Number(candidate.x)) &&
    Number.isFinite(Number(candidate.y)),
  );
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
}

function copyPoint(candidate) {
  return finitePoint(candidate)
    ? { x: Number(candidate.x), y: Number(candidate.y) }
    : null;
}

/* ============================================================
 * THE COORDINATE GRAPH
 * ============================================================
 *
 * A graph is a BOX in drawing units plus four graph-coordinate limits. The
 * box is `position` (its bottom-left corner) and `width`/`height`; the limits
 * are `xMin`/`xMax`/`yMin`/`yMax`.
 *
 * `equalUnits` keeps one drawing unit the same length on both axes. It is
 * enforced by the MAPPING rather than by rewriting the box, so a graph whose
 * box is not square still draws a square grid - the plot area is the largest
 * square that fits, centred in the box.
 */

export const DEFAULT_GRAPH_LIMITS = Object.freeze({
  xMin: -5,
  xMax: 5,
  yMin: -5,
  yMax: 5,
});

export const MIN_GRAPH_SIDE = 8;

/* The share of the box the plot area occupies, leaving room for the labels. */
export const GRAPH_INSET = Object.freeze({
  left: 0.1,
  right: 0.06,
  top: 0.06,
  bottom: 0.1,
});

export function graphFrame(graph) {
  const position = graph?.geometry?.position;

  if (!finitePoint(position)) {
    return null;
  }

  const width = Math.abs(finiteNumber(graph.geometry.width));
  const height = Math.abs(finiteNumber(graph.geometry.height));

  if (!(width > 0) || !(height > 0)) {
    return null;
  }

  return {
    position: { x: Number(position.x), y: Number(position.y) },
    width,
    height,
  };
}

/*
 * THE LIMITS A GRAPH IS DRAWN AGAINST.
 *
 * THE Y RANGE FITS THE FUNCTIONS WHEN THE STUDENT HAS NOT SET ONE.
 *
 * A graph's default range is -5..5 on both axes, which is right for an empty
 * graph and wrong for almost every function: `x^2` over -5..5 reaches 25, so
 * with a fixed -5..5 Y range the whole curve is drawn ABOVE the plot area and
 * the student sees an empty grid. That is the "the graph renders nothing"
 * failure - the object was there, the curve was sampled, and every point of it
 * was outside the box.
 *
 * So the Y range is DERIVED from the functions when the student has not chosen
 * one. `yRangeExplicit` records that choice: once they type a Y minimum or
 * maximum in Graph Settings, the range is theirs and is never re-fitted. An
 * empty graph keeps the -5..5 default, so its axes and grid still draw.
 */
export function graphLimits(graph) {
  const geometry = graph?.geometry || {};

  /*
   * A SKETCH KEEPS THE RANGE THE STUDENT SET. Its vertical extent is part of
   * what they are drawing against, so an unset one stays at the default rather
   * than being fitted to whatever geometry happens to be on the canvas - a
   * fitted Y range would move the grid under a stroke while it is being drawn.
   */

  /*
   * A LIMIT IS READ ONLY WHEN IT IS ACTUALLY A NUMBER.
   *
   * `null`, `""` and `false` all coerce to finite numbers (`0`, `0`, `0`), so
   * reading them as limits turned an unset -10..5 into 0..5 and quietly moved
   * every coordinate. Anything that is not a number, or is a blank string, is
   * "unset" and takes the default.
   */
  const read = (key) => {
    const value = geometry[key];

    return typeof value === "number" && Number.isFinite(value)
      ? value
      : typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))
        ? Number(value)
        : DEFAULT_GRAPH_LIMITS[key];
  };

  const xMin = read("xMin");
  const xMax = read("xMax");

  const x = {
    xMin: xMax > xMin ? xMin : DEFAULT_GRAPH_LIMITS.xMin,
    xMax: xMax > xMin ? xMax : DEFAULT_GRAPH_LIMITS.xMax,
  };

  const explicitYRange = () => {
    const yMin = read("yMin");
    const yMax = read("yMax");

    return {
      ...x,
      yMin: yMax > yMin ? yMin : DEFAULT_GRAPH_LIMITS.yMin,
      yMax: yMax > yMin ? yMax : DEFAULT_GRAPH_LIMITS.yMax,
    };
  };

  /*
   * A SKETCH IS NEVER FITTED TO ITS OWN INK. Its vertical range is what the
   * student configured (or the default), so it is returned as it stands - a
   * fitted range would move the grid under a stroke while it is being drawn.
   */
  if (geometry.yRangeExplicit === true || geometry.mode === "sketch") {
    return explicitYRange();
  }

  const fitted = fittedYRange(graph, x);

  return { ...x, ...(fitted || {
    yMin: DEFAULT_GRAPH_LIMITS.yMin,
    yMax: DEFAULT_GRAPH_LIMITS.yMax,
  }) };
}

/*
 * THE Y RANGE THAT SHOWS A GRAPH'S FUNCTIONS, or null when there is nothing to
 * fit.
 *
 * The functions are sampled over the X range and their values collected; the
 * range is then padded a little so a curve does not sit on the frame. A
 * function that cannot be evaluated contributes nothing, so one bad expression
 * cannot stretch the range for the others.
 */
function fittedYRange(graph, x) {
  const functions = plotFunctions(graph).filter(
    (component) => component.mode === "plot" && component.visible !== false,
  );

  if (!functions.length) {
    return null;
  }

  let low = Infinity;
  let high = -Infinity;

  functions.forEach((component) => {
    sampleCurve(component.expression, {
      min: x.xMin,
      max: x.xMax,
    }).forEach((run) => {
      run.forEach((value) => {
        if (Number.isFinite(value.y)) {
          low = Math.min(low, value.y);
          high = Math.max(high, value.y);
        }
      });
    });
  });

  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    return null;
  }

  /*
   * A FLAT FUNCTION STILL NEEDS A RANGE. A constant has low === high, and a
   * zero-height range cannot be mapped - so it is given a band around its own
   * value rather than being refused.
   */
  if (high - low < 1e-9) {
    const pad = Math.max(1, Math.abs(high) * 0.5);

    return { yMin: low - pad, yMax: high + pad };
  }

  const pad = (high - low) * 0.08;

  return { yMin: low - pad, yMax: high + pad };
}

/*
 * THE PLOT AREA, AND THE MAPPING IT IMPLIES.
 *
 * `equalUnits` is honoured by shrinking the plot area to the aspect ratio the
 * limits ask for, centred in the available area. That is what makes a circle
 * of radius 1 look like a circle rather than an ellipse, and it is why the
 * mapping - not the box - is the authority on scale.
 *
 * A SQUARE GRAPH FILLS A WIDE BOX ONLY IF THE BOX IS SQUARE. The box is the
 * graph's own dimensions in drawing units, and a graph whose equal-unit plot is
 * square inside a 2:1 box has a lot of empty ink on either side of it. That is
 * correct for a placed object - the box is the student's - but it is wrong for
 * an EDITOR, which owns its frame. So an editor passes a box shaped like its
 * canvas, and the mapping does the rest. Nothing here guesses at screen size.
 */
/*
 * THE DISPLAY SWITCHES A GRAPH IS DRAWN BY, resolved once.
 *
 * SKETCH MODE IS AN UNNUMBERED GRID. A Sketch uses the grid as a drawing aid -
 * to align a stroke and to see where a point lands - not as a fully annotated
 * mathematical plot. So a sketch never prints tick numbers and never puts a
 * collection of markers at its intersections, while the NUMBERS themselves are
 * untouched: the mapping, the tick spacing, snapping and coordinate editing all
 * still use the real limits. A graph that was stored with `showTickLabels: true`
 * is still an unnumbered sketch, because the mode is the authority on this, not
 * a setting the student never asked for.
 *
 * A PLOT is unaffected: it keeps its labels unless the student turns them off.
 */
export function gridDisplay(graph) {
  const geometry = graph?.geometry || {};
  const sketch = geometry.mode === "sketch";

  return {
    sketch,
    showGrid: geometry.showGrid !== false,
    showTickLabels: sketch ? false : geometry.showTickLabels !== false,
    showPointMarkers: false,
  };
}

/* How far, as a share of the box, the ticks and labels extend past the plot area. */
export const GRAPH_TICK_INSET = 0.035;

/*
 * THE INSET A GRAPH IS MAPPED WITH.
 *
 * A PLACED graph leaves a margin inside its box for the tick numbers that sit
 * outside its plot area. The EDITOR has no outside - its box IS the canvas - so
 * it states a zero inset of its own (`geometry.graphInset`), and the mapping uses
 * it. That is the one place the two differ, and it is the graph's own property
 * rather than a rule about where the graph is being drawn.
 */
export function graphInsetOf(graph) {
  const inset = graph?.geometry?.graphInset;

  if (!inset || typeof inset !== "object") {
    return GRAPH_INSET;
  }

  const share = (value) =>
    Number.isFinite(Number(value)) ? Math.max(0, Math.min(0.45, Number(value))) : 0;

  return {
    left: share(inset.left),
    right: share(inset.right),
    top: share(inset.top),
    bottom: share(inset.bottom),
  };
}

export function graphMapping(graph) {
  const frame = graphFrame(graph);

  if (!frame) {
    return null;
  }

  const limits = graphLimits(graph);
  const inset = graphInsetOf(graph);

  const available = {
    left: frame.position.x + frame.width * inset.left,
    right: frame.position.x + frame.width * (1 - inset.right),
    bottom: frame.position.y + frame.height * inset.bottom,
    top: frame.position.y + frame.height * (1 - inset.top),
  };

  let width = available.right - available.left;
  let height = available.top - available.bottom;

  if (!(width > 0) || !(height > 0)) {
    return null;
  }

  const xSpan = limits.xMax - limits.xMin;
  const ySpan = limits.yMax - limits.yMin;

  if (!(xSpan > 0) || !(ySpan > 0)) {
    return null;
  }

  const equal = graph?.geometry?.equalUnits !== false;

  if (equal) {
    /*
     * ONE UNIT IS THE SAME LENGTH ON BOTH AXES.
     *
     * The plot AREA is the rectangle the limits map onto. With equal units its
     * aspect is the limits' own (xSpan : ySpan), and the scale is what fits
     * that rectangle inside the available box. The area is CARRIED BY THE
     * LIMITS, NOT CENTRED IN THE BOX: its left edge is the x = xMin end of the
     * available box and it grows from there, so `left` really is xMin and
     * `right` really is xMax. Centring a plot area that is narrower than the
     * box (and letting `left`/`right` name the centred rectangle's edges) is
     * what made the drawing disagree with the axes: a tick was drawn at the
     * centred rectangle's xMin while its label and the grid used the box's
     * corners.
     *
     * THE PLOT AREA IS CENTRED IN THE BOX, so a graph whose range is squarer
     * than its box keeps a symmetric margin rather than hugging one corner.
     * Because the edges are centred TOGETHER, `left` is still exactly xMin and
     * `bottom` exactly yMin - every grid line, tick and curve is placed from
     * the same rectangle.
     */
    const scale = Math.min(width / xSpan, height / ySpan);

    const plotWidth = scale * xSpan;
    const plotHeight = scale * ySpan;

    const centreX = (available.left + available.right) / 2;
    const centreY = (available.bottom + available.top) / 2;

    available.left = centreX - plotWidth / 2;
    available.right = centreX + plotWidth / 2;
    available.bottom = centreY - plotHeight / 2;
    available.top = centreY + plotHeight / 2;

    width = plotWidth;
    height = plotHeight;
  }

  return {
    frame,
    limits,
    equal,
    left: available.left,
    right: available.right,
    bottom: available.bottom,
    top: available.top,
    width,
    height,
    xSpan,
    ySpan,
    scaleX: width / xSpan,
    scaleY: height / ySpan,
    /*
     * THE MATHEMATICAL ORIGIN, in the same frame as the grid and the curves.
     * It is a POSITION, not a rule: when zero lies outside the limits this
     * lands outside the plot area (px < left or > right) and the caller draws
     * no axis there rather than forcing one to an edge.
     */
    origin: {
      x: available.left + ((0 - limits.xMin) / xSpan) * width,
      y: available.bottom + ((0 - limits.yMin) / ySpan) * height,
    },
  };
}

/* A graph coordinate, in drawing units. */
export function graphToDrawing(graph, value) {
  const mapping = graphMapping(graph);

  if (!mapping || !value) {
    return null;
  }

  const x = Number(value.x);
  const y = Number(value.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return {
    x:
      mapping.left +
      ((x - mapping.limits.xMin) / mapping.xSpan) * mapping.width,
    y:
      mapping.bottom +
      ((y - mapping.limits.yMin) / mapping.ySpan) * mapping.height,
  };
}

/* A drawing point, in graph coordinates. */
export function drawingToGraph(graph, point) {
  const mapping = graphMapping(graph);

  if (!mapping || !finitePoint(point)) {
    return null;
  }

  return {
    x:
      mapping.limits.xMin +
      ((Number(point.x) - mapping.left) / mapping.width) * mapping.xSpan,
    y:
      mapping.limits.yMin +
      ((Number(point.y) - mapping.bottom) / mapping.height) * mapping.ySpan,
  };
}

/*
 * THE CANONICAL FORM OF ONE PATH POINT.
 *
 * A plot stores its skeletal paths in GRAPH coordinates and draws them through
 * the mapping; the SOURCE writes drawing units, because that is what a TikZ
 * `\draw (x,y)` means. These two functions are that conversion, applied
 * wherever a path crosses between the two - so a saved curve is drawn at the
 * same place after a reload, and changing the box or the limits does not move
 * the stroke off the axis it was drawn against.
 */
export function drawingPointToGraph(graph, point) {
  return drawingToGraph(graph, point) || copyPoint(point);
}

/*
 * A SEGMENT, IN DRAWING UNITS.
 *
 * A sketched curve's Bezier chain is stored in graph coordinates; the source
 * states it in drawing units because that is what a `\draw` means. Every
 * control point is mapped by the same function, so the written spline is the
 * drawn one.
 */
export function drawingSegment(graph, segment) {
  const map = (at) => graphToDrawing(graph, at);

  const converted = {
    from: map(segment.from),
    control1: map(segment.control1),
    control2: map(segment.control2),
    to: map(segment.to),
  };

  return converted.from && converted.control1 && converted.control2 && converted.to
    ? converted
    : null;
}

/* A drawn segment, taken back into the graph coordinates the object stores. */
export function graphSegment(graph, segment) {
  const map = (at) => drawingToGraph(graph, at);

  const converted = {
    from: map(segment.from),
    control1: map(segment.control1),
    control2: map(segment.control2),
    to: map(segment.to),
  };

  return converted.from && converted.control1 && converted.control2 && converted.to
    ? converted
    : null;
}

export function graphStrokesToDrawing(graph, strokes) {
  return (Array.isArray(strokes) ? strokes : []).map((stroke) =>
    (Array.isArray(stroke) ? stroke : [])
      .map((point) => graphToDrawing(graph, point))
      .filter(Boolean),
  );
}

/*
 * THE TICK VALUES OF ONE AXIS.
 *
 * A spacing the student typed is used as given; otherwise a "nice" step is
 * chosen from the range, so a graph of -5..5 gets 1 and one of -100..100 gets
 * 20. The step is never zero, so a degenerate range cannot loop.
 */
export function niceStep(span, target = 10) {
  const raw = Math.abs(Number(span)) / Math.max(1, target);

  if (!(raw > 0)) {
    return 1;
  }

  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalised = raw / magnitude;

  const step =
    normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;

  return step * magnitude;
}

/*
 * THE VALUES THE GRID USES, which need not be the labelled ticks.
 *
 * A sketch's grid is unnumbered but still a real grid, and a grid of 1-unit
 * lines over -5..5 is thin on a large canvas. So a sketch draws a FINER grid
 * (the labelled spacing divided by a whole number, or a finer nice step when
 * there is no labelled spacing) while its ticks and snapping keep the
 * configured value. The two never disagree: the finer lines are multiples of
 * the same step, which is what makes snapping land on a visible line.
 */
export function gridValues(min, max, spacing = null, divisions = 1) {
  const step =
    Number.isFinite(Number(spacing)) && Number(spacing) > 0
      ? Number(spacing) / Math.max(1, Math.round(Number(divisions) || 1))
      : niceStep(Number(max) - Number(min), 20);

  return tickValues(min, max, step);
}

export function tickValues(min, max, spacing = null) {
  const low = Number(min);
  const high = Number(max);

  if (!Number.isFinite(low) || !Number.isFinite(high) || !(high > low)) {
    return [];
  }

  const step =
    Number.isFinite(Number(spacing)) && Number(spacing) > 0
      ? Number(spacing)
      : niceStep(high - low);

  const values = [];

  const first = Math.ceil(low / step) * step;

  for (
    let value = first, guard = 0;
    value <= high + step * 1e-6 && guard < 500;
    value += step, guard += 1
  ) {
    values.push(Number(value.toFixed(10)));
  }

  return values;
}

/* ============================================================
 * FUNCTION CURVES
 * ============================================================
 *
 * A curve is either PLOTTED from an expression or SKETCHED and reconstructed.
 * Both store their geometry in DRAWING units, so the renderer, the handles and
 * the source all read one representation.
 *
 * A plotted curve keeps its EXPRESSION, its VARIABLE and its DOMAIN, and its
 * points are a SAMPLE of that expression - never the data. Moving the graph
 * re-samples; it does not move the stored points.
 */

export const CURVE_MODES = Object.freeze(["sketch", "plot"]);

export const DEFAULT_DOMAIN = Object.freeze({ min: -5, max: 5 });

export const CURVE_SAMPLES = 160;

/* The expression evaluator, or null when the text is not one it can read. */
export function curveEquation(expression) {
  const text = String(expression ?? "").trim();

  if (!text) {
    return null;
  }

  return enggDiagramEquations.equationFor(text);
}

export function curveExpressionValid(expression) {
  return Boolean(curveEquation(expression));
}

/*
 * THE SAMPLES OF A PLOTTED CURVE, in graph coordinates.
 *
 * A sample the expression cannot evaluate is SKIPPED rather than drawn as
 * zero, and a run of samples is broken where the value jumps - so a curve with
 * a pole is two strokes, not one line through the pole.
 */
export function sampleCurve(expression, domain, samples = CURVE_SAMPLES) {
  const equation = curveEquation(expression);

  if (!equation) {
    return [];
  }

  const min = Number(domain?.min);
  const max = Number(domain?.max);

  if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) {
    return [];
  }

  const steps = Math.max(2, Math.round(Number(samples) || CURVE_SAMPLES));

  const runs = [];
  let current = [];

  for (let index = 0; index <= steps; index += 1) {
    const x = min + ((max - min) * index) / steps;
    const y = equation(x);

    if (y === null || !Number.isFinite(y)) {
      if (current.length > 1) {
        runs.push(current);
      }

      current = [];
      continue;
    }

    current.push({ x, y });
  }

  if (current.length > 1) {
    runs.push(current);
  }

  return runs;
}

/* The plotted curve's points, in drawing units, as separate strokes. */
export function plottedCurveRuns(curve, graph) {
  const runs = sampleCurve(
    curve?.geometry?.expression,
    curve?.geometry?.domain,
  );

  if (!graph) {
    return [];
  }

  return runs
    .map((run) =>
      run.map((value) => graphToDrawing(graph, value)).filter(Boolean),
    )
    .filter((run) => run.length > 1);
}

/* ============================================================
 * THE PLOT'S FUNCTION COMPONENTS
 * ============================================================
 *
 * A Plot owns a LIST of functions. Each is one curve drawn inside the plot's
 * coordinate system, and each carries its own defining data:
 *
 *   id          a stable id, so the panel, the source and a tangent can name it
 *   mode        "plot" (from an expression) or "sketch" (a traced path)
 *   expression  the function, for a plotted one
 *   variable    the variable it is written in
 *   domain      the interval it is drawn over
 *   visible     whether it is drawn
 *   style       its own appearance, where it differs from the plot's
 *   points      the reconstructed path, for a sketched one
 *   segments    the cubic Beziers through those points
 *   originalTrace  the student's own stroke, kept as a reference
 *
 * THE COMPONENTS ARE NOT FEATURES. They have no row in the Objects list, no
 * handles of their own and no independent selection: the Plot is the object.
 * Their ids exist so a consumer can say WHICH curve it means - a tangent's
 * parent, a source block's child - not so they can be edited as separate
 * drawings.
 */

let plotFunctionCounter = 0;

/* A fresh component id. A counter, so two functions never share one. */
export function nextPlotFunctionId() {
  plotFunctionCounter += 1;

  return `function-${plotFunctionCounter}`;
}

/* A plotted function component, from an expression. */
export function createPlotFunction(options = {}) {
  const domain = options.domain || {};

  return {
    id: options.id || nextPlotFunctionId(),
    mode: "plot",
    expression: String(options.expression ?? ""),
    variable: String(options.variable || "x"),
    domain: {
      min: Number.isFinite(Number(domain.min))
        ? Number(domain.min)
        : DEFAULT_DOMAIN.min,
      max: Number.isFinite(Number(domain.max))
        ? Number(domain.max)
        : DEFAULT_DOMAIN.max,
    },
    visible: options.visible !== false,
    style: options.style ? { ...options.style } : null,
    points: [],
    segments: [],
    originalTrace: [],
    showOriginalTrace: false,
    smoothing: 0,
    fitType: "none",
    fitExpression: "",
    showFitExpression: false,
  };
}

/* A sketched function component, from a reconstructed stroke. */
export function createSketchFunction(reconstruction, options = {}) {
  const points = Array.isArray(reconstruction?.points)
    ? reconstruction.points.map(copyPoint).filter(Boolean)
    : [];

  const segments = Array.isArray(reconstruction?.segments)
    ? reconstruction.segments
    : [];

  return {
    id: options.id || nextPlotFunctionId(),
    mode: "sketch",
    expression: "",
    variable: "x",
    domain: { ...DEFAULT_DOMAIN },
    visible: options.visible !== false,
    style: options.style ? { ...options.style } : null,
    points,
    segments,
    originalTrace: Array.isArray(reconstruction?.original)
      ? reconstruction.original.map(copyPoint).filter(Boolean)
      : [],
    showOriginalTrace: options.showOriginalTrace === true,
    smoothing: Number.isFinite(Number(options.smoothing))
      ? Number(options.smoothing)
      : 0,
    /*
     * WHAT THE CORRECTION DID TO THIS STROKE, in words a test and a panel can
     * read: `line`, `horizontal`, `vertical` or `curve`. It is recorded so the
     * student can see that a stroke WAS straightened and so a source block can
     * say which representation it holds - not so anything is re-derived from
     * it. The geometry itself is always `points`/`segments`.
     */
    correction: options.correction ? { ...options.correction } : null,
    fitType: "none",
    fitExpression: "",
    showFitExpression: false,
  };
}

/*
 * A STRAIGHT SKETCHED SEGMENT, from two points.
 *
 * A stroke the recogniser called straight is stored as exactly two points and
 * no Bezier chain - the same reconstruction a hand-drawn line is reduced to -
 * so the committed curve is a segment rather than hundreds of collinear ones.
 */
export function createSketchSegment(start, end, options = {}) {
  if (!finitePoint(start) || !finitePoint(end)) {
    return null;
  }

  return createSketchFunction(
    {
      points: [copyPoint(start), copyPoint(end)],
      segments: [],
      original: options.original || [],
    },
    options,
  );
}

/* The functions a Plot owns, in the order they were added. */
export function plotFunctions(plot) {
  return Array.isArray(plot?.geometry?.functions) ? plot.geometry.functions : [];
}

/* One function component, by its stable id. */
export function plotFunctionById(plot, id) {
  return plotFunctions(plot).find((entry) => entry.id === id) || null;
}

/*
 * THE DRAWN STROKES OF ONE FUNCTION COMPONENT, in drawing units.
 *
 * A plotted function is sampled from its expression through the plot's own
 * mapping; a sketched one is its stored spline. Both come back as a list of
 * strokes, so a curve with a break is two strokes and nothing has to
 * special-case it.
 */
export function plotFunctionStrokes(plot, component) {
  if (!plot || !component || component.visible === false) {
    return [];
  }

  if (component.mode === "plot") {
    return plottedCurveRuns(
      { geometry: { expression: component.expression, domain: component.domain } },
      plot,
    );
  }

  const segments = Array.isArray(component.segments) ? component.segments : [];

  if (segments.length) {
    /*
     * THE SPLINE THE STUDENT DREW IS IN THE PLOT'S FRAME, AND SO IS THE BOX.
     *
     * A sketched path is stored in the plot's own graph coordinates. When the
     * editor's frame and the placed box are not in the same proportions - a
     * wide canvas committing a square plot, or the student changing the limits
     * afterwards - the stored path has to be mapped through the graph mapping
     * like every other curve. Reading it as drawing units is what made a stroke
     * (and a point placed on it) drift off the axis it was drawn against.
     */
    return [splinePoints(segments).map((point) => graphPointToDrawing(plot, point))];
  }

  const points = Array.isArray(component.points)
    ? component.points.filter(finitePoint)
    : [];

  return points.length > 1
    ? [points.map((point) => graphPointToDrawing(plot, point))]
    : [];
}

/*
 * A point of a stored path, in drawing units.
 *
 * A READER OPENED WITH `plot` ITSELF (one whose stored paths are already in
 * drawing units) says so with `__drawingSpace`: its paths are returned as they
 * are. Every other reader - the document's own plot - maps them from its graph
 * coordinates.
 */
function graphPointToDrawing(plot, point) {
  if (plot?.geometry?.__drawingSpace === true) {
    return copyPoint(point);
  }

  const at = graphToDrawing(plot, point);

  return at || copyPoint(point);
}

/* Every stroke of every visible function in a Plot. */
export function plotStrokes(plot) {
  return plotFunctions(plot).flatMap((component) =>
    plotFunctionStrokes(plot, component),
  );
}

/* ============================================================
 * SKETCH RECONSTRUCTION
 * ============================================================
 *
 * A freehand stroke is a few hundred jittery points. It is reduced to a clean,
 * editable curve in three steps, and each one is a separate function so a test
 * can hold it to its own promise:
 *
 *   simplifyStroke   Ramer-Douglas-Peucker - drop the points that lie on a
 *                    straight run, keep the corners
 *   smoothStroke     a small moving average - remove the tremor, keep the shape
 *   fitCubicBeziers  a chain of cubic Beziers through the kept points
 *
 * THE RESULT IS A SPLINE, NOT A FUNCTION. A hand-drawn curve is not necessarily
 * y = f(x), and claiming an equation for one would be a lie. A mathematical
 * best fit is a SEPARATE, OPTIONAL operation (`fitPolynomial`).
 */

export const STROKE_SIMPLIFY_PX = 2.5;
export const STROKE_SMOOTH_PX = 1.2;

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function pointSegmentDistance(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared <= 1e-12) {
    return distance(point, a);
  }

  const t = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared),
  );

  return distance(point, { x: a.x + t * dx, y: a.y + t * dy });
}

export function simplifyStroke(points, tolerance) {
  const source = Array.isArray(points) ? points.filter(finitePoint) : [];

  if (source.length <= 2) {
    return source.map(copyPoint);
  }

  const limit = Math.max(Number(tolerance) || 0, 0);

  if (limit <= 0) {
    return source.map(copyPoint);
  }

  const keep = new Uint8Array(source.length);

  keep[0] = 1;
  keep[source.length - 1] = 1;

  const stack = [[0, source.length - 1]];

  while (stack.length) {
    const [first, last] = stack.pop();

    if (last <= first + 1) {
      continue;
    }

    let furthest = -1;
    let furthestDistance = 0;

    for (let index = first + 1; index < last; index += 1) {
      const offset = pointSegmentDistance(
        source[index],
        source[first],
        source[last],
      );

      if (offset > furthestDistance) {
        furthestDistance = offset;
        furthest = index;
      }
    }

    if (furthest > 0 && furthestDistance > limit) {
      keep[furthest] = 1;

      stack.push([first, furthest], [furthest, last]);
    }
  }

  const simplified = [];

  for (let index = 0; index < source.length; index += 1) {
    if (keep[index]) {
      simplified.push(copyPoint(source[index]));
    }
  }

  return simplified;
}

/*
 * A MOVING AVERAGE THAT KEEPS THE ENDS.
 *
 * The first and last points are the stroke's own ends and are never moved -
 * a curve that shrank away from where the student started would be a different
 * curve. Everything between is averaged over its neighbours, which removes the
 * tremor without flattening a genuine change of direction.
 */
export function smoothStroke(points, radius = 1) {
  const source = Array.isArray(points) ? points.filter(finitePoint) : [];

  if (source.length < 3) {
    return source.map(copyPoint);
  }

  const reach = Math.max(0, Math.round(Number(radius) || 0));

  if (!reach) {
    return source.map(copyPoint);
  }

  return source.map((point, index) => {
    if (index === 0 || index === source.length - 1) {
      return copyPoint(point);
    }

    const from = Math.max(0, index - reach);
    const to = Math.min(source.length - 1, index + reach);

    let sumX = 0;
    let sumY = 0;
    let count = 0;

    for (let at = from; at <= to; at += 1) {
      sumX += source[at].x;
      sumY += source[at].y;
      count += 1;
    }

    return { x: sumX / count, y: sumY / count };
  });
}

/*
 * A CHAIN OF CUBIC BEZIERS THROUGH THE KEPT POINTS.
 *
 * The control points are placed along the chord between neighbours, scaled by
 * a third of the distance - the standard Catmull-Rom-to-Bezier conversion. It
 * passes THROUGH every kept point, so the reconstructed curve follows the
 * student's own geometry rather than a fitted approximation of it.
 */
export function fitCubicBeziers(points) {
  const source = Array.isArray(points) ? points.filter(finitePoint) : [];

  if (source.length < 2) {
    return [];
  }

  const segments = [];

  for (let index = 0; index < source.length - 1; index += 1) {
    const p0 = source[index - 1] || source[index];
    const p1 = source[index];
    const p2 = source[index + 1];
    const p3 = source[index + 2] || p2;

    const c1 = {
      x: p1.x + (p2.x - p0.x) / 6,
      y: p1.y + (p2.y - p0.y) / 6,
    };

    const c2 = {
      x: p2.x - (p3.x - p1.x) / 6,
      y: p2.y - (p3.y - p1.y) / 6,
    };

    segments.push({
      from: copyPoint(p1),
      control1: c1,
      control2: c2,
      to: copyPoint(p2),
    });
  }

  return segments;
}

/* A cubic Bezier, sampled - the one place a segment becomes points. */
export function bezierPoint(segment, t) {
  const u = 1 - t;

  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;

  return {
    x:
      a * segment.from.x +
      b * segment.control1.x +
      c * segment.control2.x +
      d * segment.to.x,
    y:
      a * segment.from.y +
      b * segment.control1.y +
      c * segment.control2.y +
      d * segment.to.y,
  };
}

/* The whole spline, sampled - for hit testing, bounds and the source. */
export function splinePoints(segments, perSegment = 8) {
  const list = Array.isArray(segments) ? segments : [];

  if (!list.length) {
    return [];
  }

  const steps = Math.max(1, Math.round(Number(perSegment) || 8));
  const points = [copyPoint(list[0].from)];

  list.forEach((segment) => {
    for (let index = 1; index <= steps; index += 1) {
      points.push(bezierPoint(segment, index / steps));
    }
  });

  return points;
}

/*
 * THE WHOLE RECONSTRUCTION, from a raw stroke to editable geometry.
 *
 * `tolerance` and `smoothing` are in DRAWING UNITS, converted by the caller
 * from screen pixels through the zoom - so a stroke traced at 400% is not
 * simplified more coarsely than one traced at 100%.
 */
export function reconstructStroke(rawPoints, options = {}) {
  const tolerance = Number(options.tolerance) || 0;
  const smoothing = Number(options.smoothing) || 0;

  const simplified = simplifyStroke(rawPoints, tolerance);
  const smoothed = smoothStroke(simplified, smoothing > 0 ? 1 : 0);
  const segments = fitCubicBeziers(smoothed);

  return {
    points: smoothed,
    segments,
    original: Array.isArray(rawPoints) ? rawPoints.map(copyPoint) : [],
  };
}

/* ============================================================
 * MATHEMATICAL BEST FIT
 * ============================================================
 *
 * An OPTIONAL operation on a reconstructed curve. It fits a polynomial of the
 * student's chosen degree to the traced points, in GRAPH coordinates - which
 * is why it needs a Coordinate Graph: without one the traced positions have no
 * mathematical meaning and no fit is offered.
 *
 * The fit is least squares on the normal equations, solved by Gaussian
 * elimination. It is deliberately small: a general-purpose symbolic engine is
 * out of scope, and a degree above three is not offered.
 */

export const FIT_TYPES = Object.freeze([
  "none",
  "linear",
  "quadratic",
  "cubic",
]);



export const FIT_DEGREES = Object.freeze({
  linear: 1,
  quadratic: 2,
  cubic: 3,
});

function solveLinearSystem(matrix, vector) {
  const size = matrix.length;
  const a = matrix.map((row, index) => [...row, vector[index]]);

  for (let column = 0; column < size; column += 1) {
    let pivot = column;

    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) {
        pivot = row;
      }
    }

    if (Math.abs(a[pivot][column]) < 1e-12) {
      return null;
    }

    [a[column], a[pivot]] = [a[pivot], a[column]];

    for (let row = 0; row < size; row += 1) {
      if (row === column) {
        continue;
      }

      const factor = a[row][column] / a[column][column];

      for (let at = column; at <= size; at += 1) {
        a[row][at] -= factor * a[column][at];
      }
    }
  }

  return a.map((row, index) => row[size] / row[index]);
}

/*
 * THE COEFFICIENTS OF A LEAST-SQUARES POLYNOMIAL, lowest power first.
 *
 * Returns null when the points cannot determine the fit - fewer points than
 * coefficients, or a singular system (every x the same). A fit that cannot be
 * determined is refused rather than guessed at.
 */
export function fitPolynomial(points, degree) {
  const order = Math.round(Number(degree));

  if (!Number.isFinite(order) || order < 1 || order > 3) {
    return null;
  }

  const samples = (Array.isArray(points) ? points : []).filter(finitePoint);

  if (samples.length < order + 1) {
    return null;
  }

  const size = order + 1;

  const matrix = Array.from({ length: size }, () => new Array(size).fill(0));
  const vector = new Array(size).fill(0);

  samples.forEach((sample) => {
    const powers = Array.from(
      { length: size },
      (_, index) => sample.x ** index,
    );

    for (let row = 0; row < size; row += 1) {
      vector[row] += powers[row] * sample.y;

      for (let column = 0; column < size; column += 1) {
        matrix[row][column] += powers[row] * powers[column];
      }
    }
  });

  return solveLinearSystem(matrix, vector);
}

/* A polynomial's coefficients, as the text a student would type. */
export function polynomialExpression(coefficients) {
  if (!Array.isArray(coefficients) || !coefficients.length) {
    return "";
  }

  const terms = [];

  coefficients.forEach((coefficient, power) => {
    const value = Number(coefficient);

    if (!Number.isFinite(value) || Math.abs(value) < 1e-9) {
      return;
    }

    const magnitude = Number(Math.abs(value).toFixed(4));

    const body =
      power === 0
        ? String(magnitude)
        : power === 1
          ? `${magnitude === 1 ? "" : magnitude}x`
          : `${magnitude === 1 ? "" : magnitude}x^${power}`;

    terms.push({ sign: value < 0 ? "-" : "+", body });
  });

  if (!terms.length) {
    return "0";
  }

  return terms
    .map((term, index) =>
      index === 0
        ? `${term.sign === "-" ? "-" : ""}${term.body}`
        : ` ${term.sign} ${term.body}`,
    )
    .join("");
}

/* ============================================================
 * TANGENT / NORMAL
 * ============================================================
 *
 * A construction is a finite line centred on a contact point. Its DIRECTION is
 * either derived from the parent curve (Plot) or reconstructed from the
 * student's own stroke (Sketch).
 *
 * THE DERIVATIVE IS NUMERICAL, NOT SYMBOLIC. A general-purpose symbolic
 * differentiator is out of scope, and a central difference on the curve's own
 * local geometry is both honest and sufficient for a drawing.
 */

export const TANGENT_TYPES = Object.freeze(["tangent", "normal"]);

export const DEFAULT_CONSTRUCTION_LENGTH = 30;

/* The local direction of a sampled path at the point nearest `at`. */
export function pathDirectionAt(points, at) {
  const list = (Array.isArray(points) ? points : []).filter(finitePoint);

  if (list.length < 2 || !finitePoint(at)) {
    return null;
  }

  let nearest = 0;
  let best = Infinity;

  list.forEach((point, index) => {
    const offset = distance(point, at);

    if (offset < best) {
      best = offset;
      nearest = index;
    }
  });

  const before = list[Math.max(0, nearest - 1)];
  const after = list[Math.min(list.length - 1, nearest + 1)];

  const dx = after.x - before.x;
  const dy = after.y - before.y;
  const length = Math.hypot(dx, dy);

  if (!(length > 1e-9)) {
    return null;
  }

  return { x: dx / length, y: dy / length };
}

/* The direction of a construction, from its type and its parent's direction. */
export function constructionDirection(type, tangentDirection) {
  if (!tangentDirection) {
    return null;
  }

  if (type === "normal") {
    return { x: -tangentDirection.y, y: tangentDirection.x };
  }

  return { x: tangentDirection.x, y: tangentDirection.y };
}

/* The two ends of a construction line, centred on its contact point. */
export function constructionEnds(contact, direction, length) {
  if (!finitePoint(contact) || !direction) {
    return null;
  }

  const half = Math.max(0.5, Number(length) || DEFAULT_CONSTRUCTION_LENGTH) / 2;

  return {
    start: {
      x: contact.x - direction.x * half,
      y: contact.y - direction.y * half,
    },
    end: {
      x: contact.x + direction.x * half,
      y: contact.y + direction.y * half,
    },
  };
}

/* ============================================================
 * SLOPE TRIANGLE
 * ============================================================
 *
 * Given two positions along a straight parent, the triangle is the horizontal
 * run, the vertical rise and the hypotenuse between them. The right angle is
 * at the corner the run and the rise meet, which is `(x2, y1)`.
 */

export function slopeTriangleGeometry(start, end) {
  if (!finitePoint(start) || !finitePoint(end)) {
    return null;
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;

  const corner = { x: end.x, y: start.y };

  return {
    start: copyPoint(start),
    end: copyPoint(end),
    corner,
    run: dx,
    rise: dy,
    slope: Math.abs(dx) > 1e-9 ? dy / dx : null,
    vertical: Math.abs(dx) <= 1e-9,
  };
}

/* ============================================================
 * FACTORIES
 * ============================================================
 *
 * Every object is built through `createGeometryObject`, so it is named,
 * numbered and stored exactly like every other feature. The factories take the
 * same `options` bag the shared ones do, so a caller can pass a style, a name
 * and engineering metadata.
 */

function createMathObject(type, geometry, options = {}) {
  return enggDrawingState.createGeometryObject(type, geometry, options);
}

export function createMathPoint(position, options = {}) {
  if (!finitePoint(position)) {
    return null;
  }

  return createMathObject(
    MATH_POINT_TYPE,
    {
      position: copyPoint(position),
      labelOffset: options.labelOffset || null,
      parentGraphId: options.parentGraphId || null,
      parentCurveId: options.parentCurveId || null,
      curveFunctionId: options.curveFunctionId || null,
      curveParameter: Number.isFinite(Number(options.curveParameter))
        ? Number(options.curveParameter)
        : null,
    },
    {
      ...options,
      engineering: {
        discipline: "math",
        mathType: MATH_POINT_TYPE,
        labelMode: options.labelMode || "name",
        labelText: String(options.labelText ?? ""),
        showXProjection: options.showXProjection === true,
        showYProjection: options.showYProjection === true,
        showCoordinates: options.showCoordinates !== false,
        snapMode: options.snapMode || "auto",
        ...(options.engineering || {}),
      },
    },
  );
}

export function createMathVector(start, end, options = {}) {
  if (!finitePoint(start) || !finitePoint(end)) {
    return null;
  }

  if (distance(start, end) < 1e-6) {
    return null;
  }

  return createMathObject(
    MATH_VECTOR_TYPE,
    {
      start: copyPoint(start),
      end: copyPoint(end),
      labelOffset: options.labelOffset || null,
      parentGraphId: options.parentGraphId || null,
    },
    {
      ...options,
      engineering: {
        discipline: "math",
        mathType: MATH_VECTOR_TYPE,
        showComponents: options.showComponents === true,
        showProjectionGuides: options.showProjectionGuides === true,
        showComponentLabels: options.showComponentLabels === true,
        showMagnitude: options.showMagnitude === true,
        showDirection: options.showDirection === true,
        ...(options.engineering || {}),
      },
    },
  );
}

/*
 * A PLOT: THE BOX, THE COORDINATE SETTINGS AND THE FUNCTIONS INSIDE IT.
 *
 * `position`/`width`/`height` are the box in drawing units; the four limits
 * are the graph coordinates at its edges; `functions` is the list of curves
 * drawn inside it. Everything a plot IS lives on this one object, which is
 * what makes it selectable, movable, duplicable and deletable as a whole.
 */
/* A limit from an options object - a real number, or the default. */
function limitOption(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function createMathPlot(position, width, height, options = {}) {
  if (!finitePoint(position)) {
    return null;
  }

  const w = Math.abs(Number(width));
  const h = Math.abs(Number(height));

  if (!(w >= MIN_GRAPH_SIDE) || !(h >= MIN_GRAPH_SIDE)) {
    return null;
  }

  return createMathObject(
    MATH_PLOT_TYPE,
    {
      position: copyPoint(position),
      width: w,
      height: h,
      xMin: limitOption(options.xMin, DEFAULT_GRAPH_LIMITS.xMin),
      xMax: limitOption(options.xMax, DEFAULT_GRAPH_LIMITS.xMax),
      yMin: limitOption(options.yMin, DEFAULT_GRAPH_LIMITS.yMin),
      yMax: limitOption(options.yMax, DEFAULT_GRAPH_LIMITS.yMax),
      xTickSpacing: Number.isFinite(Number(options.xTickSpacing))
        ? Number(options.xTickSpacing)
        : null,
      yTickSpacing: Number.isFinite(Number(options.yTickSpacing))
        ? Number(options.yTickSpacing)
        : null,
      /*
       * WHERE THE RANGE CAME FROM. `auto` means the limits are calculated from
       * the geometry (and may be recalculated); `manual` means they are the
       * student's own numbers and nothing may overwrite them. A graph that says
       * nothing is automatic, which is the default a student would expect.
       */
      boundsMode: options.boundsMode === "manual" ? "manual" : "auto",
      manualBounds:
        options.boundsMode === "manual" &&
        ["xMin", "xMax", "yMin", "yMax"].every((key) =>
          Number.isFinite(Number(options[key])),
        )
          ? {
              xMin: Number(options.xMin),
              xMax: Number(options.xMax),
              yMin: Number(options.yMin),
              yMax: Number(options.yMax),
            }
          : null,
      showXAxis: options.showXAxis !== false,
      showYAxis: options.showYAxis !== false,
      showGrid: options.showGrid !== false,
      showMinorGrid: options.showMinorGrid === true,
      showTickLabels: options.showTickLabels !== false,
      /*
       * THE GRID'S RESOLUTION, in labelled intervals. A sketch draws a finer
       * grid than its labelled ticks (see `gridValues`); a plot draws its
       * grid at the labelled spacing unless the student asks for a subdivision.
       */
      gridDivisions: Number.isFinite(Number(options.gridDivisions))
        ? Math.max(1, Math.min(10, Math.round(Number(options.gridDivisions))))
        : 1,
      /*
       * THE STUDENT'S OWN POINTS. Numerical points placed in the sketch editor,
       * in GRAPH coordinates. They are geometry the student defined - not the
       * samples a stroke is drawn with and not the control points a fitted
       * curve uses - so they are stored here, on the graph, and nothing else is
       * ever written into this list.
       */
      points: Array.isArray(options.points)
        ? options.points
            .filter(finitePoint)
            .map((entry) => ({
              id: String(entry.id || ""),
              x: Number(entry.x),
              y: Number(entry.y),
            }))
        : [],
      xLabel: typeof options.xLabel === "string" ? options.xLabel : "x",
      yLabel: typeof options.yLabel === "string" ? options.yLabel : "y",
      equalUnits: options.equalUnits !== false,

      /*
       * THE FUNCTIONS ARE PART OF THE PLOT. A caller may seed them (a Plot
       * created in Plot mode starts with one expression ready to type), and a
       * sketched Plot starts with the curves the student drew.
       */
      functions: Array.isArray(options.functions)
        ? options.functions.map((entry) => ({ ...entry }))
        : [],

      /*
       * THE MODE THE PLOT WAS MADE IN. It is recorded so the Features panel
       * can show the settings that belong to it - a Sketch's original trace, a
       * Plot's expressions - and so a reopened drawing knows which it was.
       */
      mode: options.mode === "sketch" ? "sketch" : "plot",
    },
    {
      ...options,
      engineering: {
        discipline: "math",
        mathType: MATH_PLOT_TYPE,
        ...(options.engineering || {}),
      },
    },
  );
}

export function createMathEquation(position, options = {}) {
  if (!finitePoint(position)) {
    return null;
  }

  return createMathObject(
    MATH_EQUATION_TYPE,
    {
      position: copyPoint(position),
      rotation: Number.isFinite(Number(options.rotation))
        ? Number(options.rotation)
        : 0,
    },
    {
      ...options,
      engineering: {
        discipline: "math",
        mathType: MATH_EQUATION_TYPE,
        content: String(options.content ?? ""),
        fontSize: Number.isFinite(Number(options.fontSize))
          ? Number(options.fontSize)
          : 16,
        align: ["left", "center", "right"].includes(options.align)
          ? options.align
          : "center",
        verticalAlign: ["top", "middle", "bottom"].includes(
          options.verticalAlign,
        )
          ? options.verticalAlign
          : "middle",
        displayMode: options.displayMode === "inline" ? "inline" : "display",
        ...(options.engineering || {}),
      },
    },
  );
}

export function createMathTangent(geometry, options = {}) {
  if (!finitePoint(geometry?.contact)) {
    return null;
  }

  return createMathObject(
    MATH_TANGENT_TYPE,
    {
      contact: copyPoint(geometry.contact),
      start: copyPoint(geometry.start),
      end: copyPoint(geometry.end),
      direction: geometry.direction
        ? { x: Number(geometry.direction.x), y: Number(geometry.direction.y) }
        : null,
      length: Number.isFinite(Number(geometry.length))
        ? Number(geometry.length)
        : DEFAULT_CONSTRUCTION_LENGTH,
      parentCurveId: options.parentCurveId || null,
    },
    {
      ...options,
      engineering: {
        discipline: "math",
        mathType: MATH_TANGENT_TYPE,
        constructionType:
          options.constructionType === "normal" ? "normal" : "tangent",
        mode: options.mode === "plot" ? "plot" : "sketch",
        ...(options.engineering || {}),
      },
    },
  );
}

export function createMathSlopeTriangle(geometry, options = {}) {
  if (!finitePoint(geometry?.start) || !finitePoint(geometry?.end)) {
    return null;
  }

  return createMathObject(
    MATH_SLOPE_TRIANGLE_TYPE,
    {
      start: copyPoint(geometry.start),
      end: copyPoint(geometry.end),
      corner: copyPoint(geometry.corner) || {
        x: geometry.end.x,
        y: geometry.start.y,
      },
      parentLineId: options.parentLineId || null,
      labelOffset: options.labelOffset || null,
    },
    {
      ...options,
      engineering: {
        discipline: "math",
        mathType: MATH_SLOPE_TRIANGLE_TYPE,
        mode: options.mode === "plot" ? "plot" : "sketch",
        showRise: options.showRise !== false,
        showRun: options.showRun !== false,
        showSlope: options.showSlope === true,
        showRightAngle: options.showRightAngle !== false,
        ...(options.engineering || {}),
      },
    },
  );
}

/* ============================================================
 * READING A PARENT
 * ============================================================
 *
 * The relationships are by STABLE ID, and every reader answers null when the
 * parent is gone - so a dependent object draws nothing rather than drawing
 * something that refers to a feature nobody can see.
 */

export function objectById(objects, id) {
  if (!id) {
    return null;
  }

  return (
    (Array.isArray(objects) ? objects : []).find(
      (object) => object?.id === id,
    ) || null
  );
}

/* The Plot an id names, or null. */
export function plotOf(objects, id) {
  const object = objectById(objects, id);

  return object?.type === MATH_PLOT_TYPE ? object : null;
}

/* The old name, kept so a caller that asks for "the graph" still works. */
export function graphOf(objects, id) {
  return plotOf(objects, id);
}

/*
 * THE DRAWN PATH OF A PLOT'S CURVES, in drawing units.
 *
 * `functionId` names ONE component; without it every visible curve in the plot
 * is returned, which is what "a point on the plot" means. A plotted function
 * is sampled from its expression through the plot's own mapping; a sketched
 * one is its stored spline. Both come back as a list of strokes, so a curve
 * with a break is two strokes and nothing has to special-case it.
 */
export function curveStrokes(plot, functionId = null) {
  if (!plot || plot.type !== MATH_PLOT_TYPE) {
    return [];
  }

  if (functionId) {
    const component = plotFunctionById(plot, functionId);

    return component ? plotFunctionStrokes(plot, component) : [];
  }

  return plotStrokes(plot);
}

/* The nearest point on a plot's drawn path to `at`, or null. */
export function nearestPointOnCurve(plot, at, functionId = null) {
  const strokes = curveStrokes(plot, functionId);

  if (!finitePoint(at)) {
    return null;
  }

  let best = null;

  strokes.forEach((stroke) => {
    stroke.forEach((point) => {
      const offset = distance(point, at);

      if (!best || offset < best.distance) {
        best = { point: copyPoint(point), distance: offset };
      }
    });
  });

  return best;
}

/* ============================================================
 * MIGRATING A SAVED DRAWING
 * ============================================================
 *
 * A drawing saved before the Plot existed carries a `math-graph` and one or
 * more `math-curve` objects that reference it. Those are the student's work, so
 * they are not thrown away: each graph and the curves that belong to it are
 * folded into ONE Plot the first time the drawing is opened.
 *
 * THE CONVERSION IS A MIGRATION, NOT A SECOND LIVE REPRESENTATION. Once it has
 * run the old objects are gone from the document, so there is exactly one place
 * a plot lives and no code path can read the old shape by accident.
 *
 * WHAT IS PRESERVED:
 *
 *   the graph's box, limits, tick spacing, axis and grid switches, labels and
 *   equal-unit setting - all of them, unchanged;
 *   every curve's expression, variable, domain, appearance and reconstructed
 *   geometry, as a function component of the new Plot;
 *   the graph's own id, so a Point, a Vector or a Tangent that referenced it
 *   still finds it;
 *   each curve's id, as the component id, so a tangent that named a curve
 *   still names the same curve.
 *
 * A curve whose graph is missing is left alone rather than guessed at: it has
 * no coordinate system to be drawn in, and inventing one would put a curve on
 * a graph the student never drew.
 */
export function migrateLegacyMath(objects) {
  const list = Array.isArray(objects) ? objects : [];

  const graphs = list.filter((object) => object?.type === LEGACY_MATH_GRAPH_TYPE);

  if (!graphs.length) {
    return { objects: list, migrated: [] };
  }

  const curves = list.filter((object) => object?.type === LEGACY_MATH_CURVE_TYPE);

  const migrated = [];
  const consumed = new Set();

  const next = list.map((object) => {
    if (object?.type !== LEGACY_MATH_GRAPH_TYPE) {
      return object;
    }

    const own = curves.filter(
      (curve) => curve.geometry?.parentGraphId === object.id,
    );

    own.forEach((curve) => consumed.add(curve.id));

    const plot = {
      ...object,
      type: MATH_PLOT_TYPE,
      geometry: {
        ...(object.geometry || {}),
        mode: own.some((curve) => curve.geometry?.mode === "sketch")
          ? "sketch"
          : "plot",
        functions: own.map((curve) => legacyCurveToFunction(curve)),
      },
      engineering: {
        ...(object.engineering || {}),
        discipline: "math",
        mathType: MATH_PLOT_TYPE,
      },
    };

    migrated.push(plot.id);

    return plot;
  });

  return {
    objects: next.filter((object) => !consumed.has(object?.id)),
    migrated,
  };
}

/* One old `math-curve`, as a function component of a Plot. */
function legacyCurveToFunction(curve) {
  const geometry = curve.geometry || {};

  return {
    id: curve.id,
    mode: geometry.mode === "plot" ? "plot" : "sketch",
    expression: String(geometry.expression ?? ""),
    variable: String(geometry.variable || "x"),
    domain: {
      min: Number.isFinite(Number(geometry.domain?.min))
        ? Number(geometry.domain.min)
        : DEFAULT_DOMAIN.min,
      max: Number.isFinite(Number(geometry.domain?.max))
        ? Number(geometry.domain.max)
        : DEFAULT_DOMAIN.max,
    },
    visible: true,
    style: curve.style ? { ...curve.style } : null,
    points: Array.isArray(geometry.points) ? geometry.points.map(copyPoint) : [],
    segments: Array.isArray(geometry.segments) ? geometry.segments : [],
    originalTrace: Array.isArray(geometry.originalTrace)
      ? geometry.originalTrace.map(copyPoint)
      : [],
    showOriginalTrace: geometry.showOriginalTrace === true,
    smoothing: Number(geometry.smoothing) || 0,
    fitType: FIT_TYPES.includes(geometry.fitType) ? geometry.fitType : "none",
    fitExpression: String(geometry.fitExpression ?? ""),
    showFitExpression: geometry.showFitExpression === true,
  };
}

/* ============================================================
 * THE MODULE
 * ============================================================ */

const enggMathModel = {
  MATH_POINT_TYPE,
  MATH_VECTOR_TYPE,
  MATH_PLOT_TYPE,
  LEGACY_MATH_GRAPH_TYPE,
  LEGACY_MATH_CURVE_TYPE,
  MATH_EQUATION_TYPE,
  MATH_TANGENT_TYPE,
  MATH_SLOPE_TRIANGLE_TYPE,
  MATH_TYPES,
  isMathType,
  finitePoint,
  DEFAULT_GRAPH_LIMITS,
  MIN_GRAPH_SIDE,
  GRAPH_INSET,
  graphInsetOf,
  graphFrame,
  graphLimits,
  graphMapping,
  graphToDrawing,
  drawingToGraph,
  drawingPointToGraph,
  graphStrokesToDrawing,
  drawingSegment,
  graphSegment,
  niceStep,
  tickValues,
  gridValues,
  gridDisplay,
  CURVE_MODES,
  DEFAULT_DOMAIN,
  CURVE_SAMPLES,
  curveEquation,
  curveExpressionValid,
  sampleCurve,
  plottedCurveRuns,
  STROKE_SIMPLIFY_PX,
  STROKE_SMOOTH_PX,
  simplifyStroke,
  smoothStroke,
  fitCubicBeziers,
  bezierPoint,
  splinePoints,
  reconstructStroke,
  FIT_TYPES,
  FIT_DEGREES,
  fitPolynomial,
  polynomialExpression,
  TANGENT_TYPES,
  DEFAULT_CONSTRUCTION_LENGTH,
  pathDirectionAt,
  constructionDirection,
  constructionEnds,
  slopeTriangleGeometry,
  createMathPoint,
  createMathVector,
  createMathPlot,
  createMathEquation,
  createMathTangent,
  createMathSlopeTriangle,
  nextPlotFunctionId,
  createPlotFunction,
  createSketchFunction,
  plotFunctions,
  plotFunctionById,
  plotFunctionStrokes,
  plotStrokes,
  objectById,
  plotOf,
  graphOf,
  curveStrokes,
  nearestPointOnCurve,
  migrateLegacyMath,
};

export default enggMathModel;
