/*
 * ============================================================
 * DRAWING THE MATH / ANALYSIS OBJECTS
 * ============================================================
 *
 * One painter per Math type, each reading the SAME model functions the Features
 * panel, the handles and the source writer read - so the picture, the panel and
 * the TikZ cannot disagree about a number.
 *
 * EVERY COLOUR GOES THROUGH `paintColour`, so a Math object follows the theme
 * exactly as every other feature does: black ink on a light sheet, ice on a
 * dark one, and a student's own colour preserved across a theme change.
 *
 * PROJECTION LINES, COMPONENT ARROWS AND THE ORIGINAL TRACE ARE DEPENDENT
 * VISUALS. They belong to the object that owns them, they are drawn from its
 * own stored settings, and they are never separate features - so they cannot be
 * selected, moved or deleted on their own.
 */

import enggDrawingState from "../../model/drawing-state.js";
import enggMathModel from "../../../features/workspace/math/math-model.js";
import enggTheme from "../../../components/layout/workspace/theme.js";
import {
  createSvgElement,
  paintColour,
  scaledStrokeWidth,
  zoomedFontHere,
} from "../svg-primitives.js";

/* ============================================================
 * SHARED HELPERS
 * ============================================================ */

function strokeOf(style) {
  return paintColour(style?.stroke || enggTheme.defaultLineColour());
}

/*
 * THE DISPLAY SWITCHES A GRAPH IS DRAWN BY.
 *
 * The dispatcher is imported directly rather than reached through the global:
 * the page's script tags publish the model globally, but under `require` there
 * is no shared scope, and a painter that cannot answer this would silently draw
 * a sketch's numbers - the one thing the sketch must not do.
 */
function gridDisplayOf(entity) {
  if (typeof enggMathModel.gridDisplay === "function") {
    return enggMathModel.gridDisplay(entity);
  }

  const geometry = entity?.geometry || {};

  return {
    sketch: geometry.mode === "sketch",
    showGrid: geometry.showGrid !== false,
    showTickLabels: geometry.mode !== "sketch" && geometry.showTickLabels !== false,
  };
}

/* The values a graph's grid is drawn at, whichever build of the model is loaded. */
function gridValuesOf(min, max, spacing, divisions) {
  if (typeof enggMathModel.gridValues === "function") {
    return enggMathModel.gridValues(min, max, spacing, divisions);
  }

  return enggMathModel.tickValues(min, max, spacing);
}

function widthOf(style) {
  return scaledStrokeWidth(Number(style?.lineWidth) || 0.5);
}

function dashFor(style) {
  if (style?.lineType === "dashed") {
    return "6 4";
  }

  if (style?.lineType === "dotted") {
    return "1 4";
  }

  return null;
}

function line(
  svg,
  from,
  to,
  { stroke, width, dash = null, opacity = null, extra = {} },
) {
  const element = createSvgElement("line", {
    x1: from.x,
    y1: from.y,
    x2: to.x,
    y2: to.y,
    stroke,
    "stroke-width": width,
    "stroke-linecap": "round",
    ...(dash ? { "stroke-dasharray": dash } : {}),
    ...(opacity !== null ? { opacity } : {}),
    ...extra,
  });

  svg.appendChild(element);

  return element;
}

function path(
  svg,
  points,
  { stroke, width, dash = null, fill = "none", opacity = null },
) {
  if (!Array.isArray(points) || points.length < 2) {
    return null;
  }

  const d = points
    .map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`)
    .join(" ");

  const element = createSvgElement("path", {
    d,
    fill,
    stroke,
    "stroke-width": width,
    "stroke-linejoin": "round",
    "stroke-linecap": "round",
    ...(dash ? { "stroke-dasharray": dash } : {}),
    ...(opacity !== null ? { opacity } : {}),
  });

  svg.appendChild(element);

  return element;
}

function text(
  svg,
  at,
  content,
  {
    fill,
    size = 12,
    anchor = "middle",
    baseline = "middle",
    extra = {},
    /*
     * WHAT KIND OF LABEL THIS IS, stated in the markup.
     *
     * It matters because a SKETCH prints no numbers: a grid tick's number is
     * suppressed there while the axis NAMES are kept, and a reader (or a test)
     * can tell the two apart by this attribute rather than by guessing from the
     * text.
     */
    role = null,
  } = {},
) {
  if (!String(content ?? "").trim()) {
    return null;
  }

  const node = createSvgElement("text", {
    x: at.x,
    y: at.y,
    fill,
    "font-size": zoomedFontHere(size),
    "font-family": "Arial, sans-serif",
    "text-anchor": anchor,
    "dominant-baseline": baseline,
    "pointer-events": "none",
    ...(role ? { "data-label": role } : {}),
    ...extra,
  });

  node.textContent = String(content);

  svg.appendChild(node);

  return node;
}

/* A filled arrowhead, built from the two projected ends. */
function arrowHead(svg, tip, tail, stroke, size = 9) {
  const dx = tip.x - tail.x;
  const dy = tip.y - tail.y;
  const length = Math.hypot(dx, dy);

  if (length < 1e-6) {
    return;
  }

  const ux = dx / length;
  const uy = dy / length;

  const base = { x: tip.x - ux * size, y: tip.y - uy * size };
  const spread = size * 0.45;

  svg.appendChild(
    createSvgElement("polygon", {
      points: [
        `${tip.x},${tip.y}`,
        `${base.x - uy * spread},${base.y + ux * spread}`,
        `${base.x + uy * spread},${base.y - ux * spread}`,
      ].join(" "),
      fill: stroke,
      stroke: "none",
    }),
  );
}

/* A number, as a student reads it: no trailing zeros, no exponent. */
function numberText(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "";
  }

  return String(Number(number.toFixed(3)));
}

/* ============================================================
 * POINT
 * ============================================================ */

export function drawMathPoint({
  svg,
  parentSvg,
  entity,
  state,
  style,
  toScreen,
}) {
  const geometry = entity.geometry || {};
  const position = geometry.position;

  if (!enggMathModel.finitePoint(position)) {
    return true;
  }

  const stroke = strokeOf(style);
  const at = toScreen(position);

  const graph = enggMathModel.graphOf(state.objects, geometry.parentGraphId);
  const engineering = entity.engineering || {};

  /*
   * THE PROJECTIONS COME FIRST, so the marker sits on top of them. They are
   * construction lines from the point to the graph's axes, and they are drawn
   * only when the student asked for them AND there is a graph to reach.
   */
  if (graph) {
    const mapping = enggMathModel.graphMapping(graph);

    if (mapping) {
      const projectionStroke = paintColour(enggTheme.defaultLineColour());
      const projectionWidth = Math.max(0.6, widthOf(style) * 0.6);

      if (engineering.showXProjection === true) {
        const foot = toScreen({ x: position.x, y: mapping.origin.y });

        line(svg, at, foot, {
          stroke: projectionStroke,
          width: projectionWidth,
          dash: "4 3",
          opacity: 0.6,
        });
      }

      if (engineering.showYProjection === true) {
        const foot = toScreen({ x: mapping.origin.x, y: position.y });

        line(svg, at, foot, {
          stroke: projectionStroke,
          width: projectionWidth,
          dash: "4 3",
          opacity: 0.6,
        });
      }
    }
  }

  const radius =
    Number.isFinite(Number(style?.pointSize)) && Number(style.pointSize) > 0
      ? Number(style.pointSize)
      : 4;

  svg.appendChild(
    createSvgElement("circle", {
      cx: at.x,
      cy: at.y,
      r: radius,
      fill: paintColour(
        style?.fill && style.fill !== "none" ? style.fill : stroke,
      ),
      stroke,
      "stroke-width": 1,
    }),
  );

  /*
   * THE DISPLAY LABEL IS THE OBJECT'S OWN, and it is independent of the
   * object's NAME: a point called "Point 3" in the Objects list can be drawn as
   * "A", as its coordinates, or as a sentence the student typed.
   */
  const label = pointLabel(entity, graph);

  if (label) {
    const offset = geometry.labelOffset || { x: 8, y: -8 };

    text(
      svg,
      { x: at.x + Number(offset.x || 0), y: at.y + Number(offset.y || 0) },
      label,
      {
        fill: stroke,
        size: 12,
        anchor: "start",
        baseline: "middle",
      },
    );
  }

  parentSvg.appendChild(svg);

  return true;
}

/* What a point draws beside itself, from its own label mode. */
export function pointLabel(entity, graph) {
  const engineering = entity?.engineering || {};
  const mode = engineering.labelMode || "name";

  if (mode === "custom") {
    return String(engineering.labelText ?? "").trim();
  }

  if (mode === "coordinates") {
    if (!graph) {
      return "";
    }

    const value = enggMathModel.drawingToGraph(
      graph,
      entity.geometry?.position,
    );

    return value ? `(${numberText(value.x)}, ${numberText(value.y)})` : "";
  }

  return String(entity?.label ?? entity?.name ?? "").trim();
}

/* ============================================================
 * VECTOR
 * ============================================================ */

export function drawMathVector({
  svg,
  parentSvg,
  entity,
  state,
  style,
  toScreen,
}) {
  const geometry = entity.geometry || {};

  if (
    !enggMathModel.finitePoint(geometry.start) ||
    !enggMathModel.finitePoint(geometry.end)
  ) {
    return true;
  }

  const stroke = strokeOf(style);
  const width = widthOf(style);
  const dash = dashFor(style);

  const tail = toScreen(geometry.start);
  const head = toScreen(geometry.end);

  const engineering = entity.engineering || {};
  const graph = enggMathModel.graphOf(state.objects, geometry.parentGraphId);

  /*
   * THE COMPONENTS AND THE GUIDES ARE DRAWN FIRST, behind the arrow, so the
   * arrow reads as the vector and the components as its construction.
   */
  if (engineering.showProjectionGuides === true) {
    const guideStroke = paintColour(enggTheme.defaultLineColour());

    line(
      svg,
      head,
      { x: head.x, y: tail.y },
      {
        stroke: guideStroke,
        width: Math.max(0.6, width * 0.6),
        dash: "4 3",
        opacity: 0.6,
      },
    );

    line(
      svg,
      head,
      { x: tail.x, y: head.y },
      {
        stroke: guideStroke,
        width: Math.max(0.6, width * 0.6),
        dash: "4 3",
        opacity: 0.6,
      },
    );
  }

  if (engineering.showComponents === true) {
    const componentStroke = paintColour(enggTheme.defaultLineColour());

    line(
      svg,
      tail,
      { x: head.x, y: tail.y },
      {
        stroke: componentStroke,
        width,
        dash: "5 3",
      },
    );

    line(svg, { x: head.x, y: tail.y }, head, {
      stroke: componentStroke,
      width,
      dash: "5 3",
    });

    if (engineering.showComponentLabels === true) {
      const dx = geometry.end.x - geometry.start.x;
      const dy = geometry.end.y - geometry.start.y;

      text(
        svg,
        { x: (tail.x + head.x) / 2, y: tail.y + 14 },
        `Δx = ${numberText(dx)}`,
        {
          fill: componentStroke,
          size: 11,
        },
      );

      text(
        svg,
        { x: head.x + 8, y: (tail.y + head.y) / 2 },
        `Δy = ${numberText(dy)}`,
        {
          fill: componentStroke,
          size: 11,
          anchor: "start",
        },
      );
    }
  }

  line(svg, tail, head, { stroke, width, dash });

  arrowHead(svg, head, tail, stroke, Math.max(8, width * 6));

  /*
   * THE VECTOR'S OWN LABEL, and its derived magnitude and direction. They are
   * read from the endpoints, so they cannot disagree with the arrow.
   */
  const offset = geometry.labelOffset || { x: 10, y: -10 };

  const label = String(entity.label ?? "").trim();

  if (label) {
    text(
      svg,
      { x: head.x + Number(offset.x || 0), y: head.y + Number(offset.y || 0) },
      label,
      {
        fill: stroke,
        size: 12,
        anchor: "start",
      },
    );
  }

  const dx = geometry.end.x - geometry.start.x;
  const dy = geometry.end.y - geometry.start.y;

  const magnitude = Math.hypot(dx, dy);
  const direction = (Math.atan2(dy, dx) * 180) / Math.PI;

  const details = [];

  if (engineering.showMagnitude === true) {
    details.push(`|v| = ${numberText(magnitude)}`);
  }

  if (engineering.showDirection === true) {
    details.push(`θ = ${numberText(direction)}°`);
  }

  if (details.length) {
    text(
      svg,
      { x: (tail.x + head.x) / 2, y: (tail.y + head.y) / 2 - 12 },
      details.join("   "),
      {
        fill: stroke,
        size: 11,
      },
    );
  }

  void graph;

  parentSvg.appendChild(svg);

  return true;
}

/* ============================================================
 * COORDINATE GRAPH
 * ============================================================ */

export function drawMathGraph({ svg, parentSvg, entity, style, toScreen }) {
  const mapping = enggMathModel.graphMapping(entity);

  if (!mapping) {
    return true;
  }

  const stroke = strokeOf(style);
  const width = widthOf(style);
  const muted = paintColour(enggTheme.defaultLineColour());
  const geometry = entity.geometry || {};

  /*
   * WHETHER THIS IS A NUMBERED PLOT OR AN UNNUMBERED SKETCH.
   *
   * A Sketch's grid is a drawing aid: its lines are drawn, its ticks are marks
   * on the axes, and NO NUMBER is printed beside them. The numeric system is
   * still there - the mapping, the spacing and the student's own points all use
   * it - it is simply not annotated, because a sketch is not a calculated plot.
   * A Plot keeps its labels.
   */
  const display = gridDisplayOf(entity);

  const frame = mapping.frame;

  /*
   * The box, so the graph is visibly a placed object. It is TAGGED as the
   * frame: the box and the axes are both solid lines, and a reader - a test, or
   * a future feature that wants to know where the plot area ends - must be able
   * to tell one from the other.
   */
  const corners = [
    { x: frame.position.x, y: frame.position.y },
    { x: frame.position.x + frame.width, y: frame.position.y },
    { x: frame.position.x + frame.width, y: frame.position.y + frame.height },
    { x: frame.position.x, y: frame.position.y + frame.height },
  ].map(toScreen);

  for (let index = 0; index < 4; index += 1) {
    line(svg, corners[index], corners[(index + 1) % 4], {
      stroke,
      width: Math.max(0.5, width * 0.6),
      extra: { "data-graph-part": "frame" },
    });
  }

  const xTicks = enggMathModel.tickValues(
    mapping.limits.xMin,
    mapping.limits.xMax,
    geometry.xTickSpacing,
  );
  const yTicks = enggMathModel.tickValues(
    mapping.limits.yMin,
    mapping.limits.yMax,
    geometry.yTickSpacing,
  );

  /*
   * THE GRID, BEHIND THE AXES, at its own resolution.
   *
   * A sketch draws a finer grid than its labelled ticks - a 1-unit grid over
   * -5..5 is thin on a large canvas - while those ticks, and snapping, keep the
   * configured value. The finer lines are multiples of the same step, so a point
   * snapped to the grid always lands on a visible line.
   */
  const xGrid = display.showGrid
    ? gridValuesOf(
        mapping.limits.xMin,
        mapping.limits.xMax,
        geometry.xTickSpacing,
        geometry.gridDivisions,
      )
    : [];

  const yGrid = display.showGrid
    ? gridValuesOf(
        mapping.limits.yMin,
        mapping.limits.yMax,
        geometry.yTickSpacing,
        geometry.gridDivisions,
      )
    : [];

  if (display.showGrid) {
    const gridWidth = Math.max(0.4, width * 0.5);

    xGrid.forEach((value) => {
      const at = enggMathModel.graphToDrawing(entity, {
        x: value,
        y: mapping.limits.yMin,
      });

      if (at) {
        line(svg, toScreen(at), toScreen({ x: at.x, y: mapping.top }), {
          stroke: muted,
          width: gridWidth,
          dash: "3 4",
          opacity: 0.45,
        });
      }
    });

    yGrid.forEach((value) => {
      const at = enggMathModel.graphToDrawing(entity, {
        x: mapping.limits.xMin,
        y: value,
      });

      if (at) {
        line(svg, toScreen(at), toScreen({ x: mapping.right, y: at.y }), {
          stroke: muted,
          width: gridWidth,
          dash: "3 4",
          opacity: 0.45,
        });
      }
    });
  }

  /*
   * THE AXES: WHERE ZERO ACTUALLY IS, OR NOWHERE.
   *
   * `origin` is the position of (0, 0) in the SAME frame the grid and the
   * curves are drawn in, so it is NOT forced to the middle of the box and NOT
   * forced to an edge. If zero is outside the configured limits - a graph of
   * 2..8 has no y = 0 in it - the corresponding axis is not inside the plotting
   * area and is therefore not drawn, rather than being pushed onto an edge and
   * pretending the value exists there.
   */
  const origin = mapping.origin;

  const xAxisVisible =
    geometry.showXAxis !== false &&
    origin.y >= mapping.bottom - 1e-9 &&
    origin.y <= mapping.top + 1e-9;

  const yAxisVisible =
    geometry.showYAxis !== false &&
    origin.x >= mapping.left - 1e-9 &&
    origin.x <= mapping.right + 1e-9;

  if (xAxisVisible) {
    line(
      svg,
      toScreen({ x: mapping.left, y: origin.y }),
      toScreen({ x: mapping.right, y: origin.y }),
      {
        stroke,
        width,
        extra: { "data-graph-part": "axis" },
      },
    );
  }

  if (yAxisVisible) {
    line(
      svg,
      toScreen({ x: origin.x, y: mapping.bottom }),
      toScreen({ x: origin.x, y: mapping.top }),
      {
        stroke,
        width,
        extra: { "data-graph-part": "axis" },
      },
    );
  }

  /*
   * THE TICKS ARE MARKS ON THE AXES, so a tick is drawn only where its axis
   * exists. A hidden X axis (because y = 0 is out of range) does not leave a
   * row of floating marks at the bottom of the plot area.
   */
  const tickLength = 4;

  xTicks.forEach((value) => {
    const at = xAxisVisible
      ? enggMathModel.graphToDrawing(entity, { x: value, y: 0 })
      : null;

    if (!at) {
      return;
    }

    const screen = toScreen(at);

    line(
      svg,
      { x: screen.x, y: screen.y - tickLength },
      { x: screen.x, y: screen.y + tickLength },
      {
        stroke,
        width: Math.max(0.5, width * 0.7),
      },
    );

    if (display.showTickLabels && Math.abs(value) > 1e-9) {
      text(svg, { x: screen.x, y: screen.y + 14 }, numberText(value), {
        fill: stroke,
        size: 10,
        role: "tick",
      });
    }
  });

  yTicks.forEach((value) => {
    const at = yAxisVisible
      ? enggMathModel.graphToDrawing(entity, { x: 0, y: value })
      : null;

    if (!at) {
      return;
    }

    const screen = toScreen(at);

    line(
      svg,
      { x: screen.x - tickLength, y: screen.y },
      { x: screen.x + tickLength, y: screen.y },
      {
        stroke,
        width: Math.max(0.5, width * 0.7),
      },
    );

    if (display.showTickLabels && Math.abs(value) > 1e-9) {
      text(svg, { x: screen.x - 8, y: screen.y }, numberText(value), {
        fill: stroke,
        size: 10,
        anchor: "end",
        role: "tick",
      });
    }
  });

  /* The axis names, at the ends of the axes that are actually drawn. */
  if (xAxisVisible && String(geometry.xLabel ?? "").trim()) {
    text(svg, { x: mapping.right + 10, y: origin.y }, geometry.xLabel, {
      fill: stroke,
      size: 12,
      anchor: "start",
      role: "axis-name",
    });
  }

  if (yAxisVisible && String(geometry.yLabel ?? "").trim()) {
    text(svg, { x: origin.x, y: mapping.top - 10 }, geometry.yLabel, {
      fill: stroke,
      size: 12,
      role: "axis-name",
    });
  }

  /*
   * THE FUNCTIONS ARE DRAWN LAST, on top of the grid and the axes - which is
   * the order a reader expects: the paper, then the graph, then the curve.
   */
  drawPlotFunctions({ svg, entity, style, toScreen });

  parentSvg.appendChild(svg);

  return true;
}

/* ============================================================
 * THE PLOT'S FUNCTIONS
 * ============================================================
 *
 * Every function component of a Plot, drawn inside its coordinate system. A
 * plotted function is sampled from its expression; a sketched one is its own
 * reconstructed spline. Both are drawn in the plot's own pen unless the
 * component carries a style of its own.
 *
 * THE ORIGINAL TRACE AND THE FITTED EXPRESSION ARE DEPENDENT VISUALS. They
 * belong to the component that owns them, they are drawn from its own stored
 * settings, and they are never separate features.
 */
export function drawPlotFunctions({ svg, entity, style, toScreen }) {
  const stroke = strokeOf(style);
  const width = widthOf(style);
  const dash = dashFor(style);

  enggMathModel.plotFunctions(entity).forEach((component) => {
    if (component.visible === false) {
      return;
    }

    const componentStroke = component.style?.stroke
      ? paintColour(component.style.stroke)
      : stroke;

    const componentWidth = Number.isFinite(Number(component.style?.lineWidth))
      ? scaledStrokeWidth(Number(component.style.lineWidth))
      : width;

    const componentDash = component.style?.lineType
      ? dashFor(component.style)
      : dash;

    /* The student's own stroke, behind the reconstructed curve and faint. */
    if (
      component.showOriginalTrace === true &&
      Array.isArray(component.originalTrace) &&
      component.originalTrace.length > 1
    ) {
      path(svg, component.originalTrace.map(toScreen), {
        stroke: paintColour(enggTheme.defaultLineColour()),
        width: Math.max(0.6, componentWidth * 0.6),
        dash: "3 3",
        opacity: 0.4,
      });
    }

    /*
     * A COMPONENT WHOSE GEOMETRY CANNOT BE READ IS SKIPPED, NOT FATAL.
     *
     * `plotFunctionStrokes` reads `segments` and `points`, and a component
     * written by another code path - a preview, a restored source block - may
     * carry neither. One bad component must not take the whole graph's
     * drawing (or its SOURCE, which is written from this painter's data) down
     * with it.
     */
    let strokes;

    try {
      strokes = enggMathModel.plotFunctionStrokes(entity, component);
    } catch (error) {
      console.error("A graph function could not be drawn", error);

      return;
    }

    if (!Array.isArray(strokes)) {
      return;
    }

    strokes.forEach((points) => {
      if (!Array.isArray(points)) {
        return;
      }

      path(svg, points.map(toScreen), {
        stroke: componentStroke,
        width: componentWidth,
        dash: componentDash,
      });
    });

    /*
     * THE FITTED EXPRESSION, when the student asked for one. It is a READING
     * of the curve, not the curve - so it is drawn as a label beside it, never
     * as a second line that would claim to be the geometry.
     */
    if (
      component.showFitExpression === true &&
      String(component.fitExpression ?? "").trim()
    ) {
      const first = strokes[0];

      if (first && first.length) {
        const at = toScreen(first[Math.floor(first.length / 2)]);

        text(svg, { x: at.x, y: at.y - 14 }, `y = ${component.fitExpression}`, {
          fill: componentStroke,
          size: 11,
        });
      }
    }
  });
}

/* ============================================================
 * EQUATION
 * ============================================================ */

export function drawMathEquation({ svg, parentSvg, entity, style, toScreen }) {
  const geometry = entity.geometry || {};
  const engineering = entity.engineering || {};

  if (!enggMathModel.finitePoint(geometry.position)) {
    return true;
  }

  const content = String(engineering.content ?? "").trim();

  if (!content) {
    return true;
  }

  const at = toScreen(geometry.position);
  const stroke = strokeOf(style);
  const size = Number(engineering.fontSize) || 16;

  const anchor =
    engineering.align === "left"
      ? "start"
      : engineering.align === "right"
        ? "end"
        : "middle";

  const baseline =
    engineering.verticalAlign === "top"
      ? "hanging"
      : engineering.verticalAlign === "bottom"
        ? "text-after-edge"
        : "middle";

  const lines = content.split("\n");

  const node = createSvgElement("text", {
    x: at.x,
    y: at.y,
    fill: stroke,
    "font-size": zoomedFontHere(size),
    "font-family": "Cambria Math, Times New Roman, serif",
    "font-style": "italic",
    "text-anchor": anchor,
    "dominant-baseline": baseline,
    "pointer-events": "none",
    ...(Number(geometry.rotation)
      ? { transform: `rotate(${-Number(geometry.rotation)} ${at.x} ${at.y})` }
      : {}),
  });

  lines.forEach((lineText, index) => {
    if (index === 0) {
      node.textContent = lineText;
      return;
    }

    const tspan = createSvgElement("tspan", {
      x: at.x,
      dy: size * 1.25,
    });

    tspan.textContent = lineText;
    node.appendChild(tspan);
  });

  svg.appendChild(node);

  parentSvg.appendChild(svg);

  return true;
}

/* ============================================================
 * TANGENT / NORMAL
 * ============================================================ */

export function drawMathTangent({ svg, parentSvg, entity, style, toScreen }) {
  const geometry = entity.geometry || {};

  if (
    !enggMathModel.finitePoint(geometry.start) ||
    !enggMathModel.finitePoint(geometry.end)
  ) {
    return true;
  }

  const stroke = strokeOf(style);
  const width = widthOf(style);

  const start = toScreen(geometry.start);
  const end = toScreen(geometry.end);

  line(svg, start, end, { stroke, width, dash: dashFor(style) });

  /* The contact point, so the construction visibly belongs to the curve. */
  if (enggMathModel.finitePoint(geometry.contact)) {
    const contact = toScreen(geometry.contact);

    svg.appendChild(
      createSvgElement("circle", {
        cx: contact.x,
        cy: contact.y,
        r: 3,
        fill: stroke,
        stroke: "none",
      }),
    );
  }

  const label = String(entity.label ?? "").trim();

  if (label) {
    text(svg, { x: end.x + 8, y: end.y - 8 }, label, {
      fill: stroke,
      size: 11,
      anchor: "start",
    });
  }

  parentSvg.appendChild(svg);

  return true;
}

/* ============================================================
 * SLOPE TRIANGLE
 * ============================================================ */

export function drawMathSlopeTriangle({
  svg,
  parentSvg,
  entity,
  style,
  toScreen,
}) {
  const geometry = entity.geometry || {};
  const engineering = entity.engineering || {};

  const triangle = enggMathModel.slopeTriangleGeometry(
    geometry.start,
    geometry.end,
  );

  if (!triangle) {
    return true;
  }

  const stroke = strokeOf(style);
  const width = widthOf(style);

  const start = toScreen(triangle.start);
  const end = toScreen(triangle.end);
  const corner = toScreen(triangle.corner);

  const filled =
    style?.fillMode === "solid" && style?.fill && style.fill !== "none";

  if (filled) {
    svg.appendChild(
      createSvgElement("polygon", {
        points: [start, corner, end]
          .map((point) => `${point.x},${point.y}`)
          .join(" "),
        fill: paintColour(style.fill),
        stroke: "none",
        "fill-opacity": 0.25,
      }),
    );
  }

  /* The run, the rise and the hypotenuse. */
  line(svg, start, corner, { stroke, width });
  line(svg, corner, end, { stroke, width });
  line(svg, start, end, { stroke, width, dash: dashFor(style) });

  /* The right-angle marker, at the corner. */
  if (engineering.showRightAngle !== false) {
    const size = 8;

    const alongRun = {
      x: corner.x + (start.x > corner.x ? size : -size),
      y: corner.y,
    };
    const alongRise = {
      x: corner.x,
      y: corner.y + (end.y > corner.y ? size : -size),
    };

    path(svg, [alongRun, { x: alongRun.x, y: alongRise.y }, alongRise], {
      stroke,
      width: Math.max(0.6, width * 0.7),
    });
  }

  /*
   * THE VALUES ARE DERIVED FROM THE GEOMETRY, and only shown when the student
   * asked for them. They are in DRAWING units unless the triangle belongs to a
   * graph, which is the honest reading of a drawing that has no calibration.
   */
  const labels = [];

  if (engineering.showRun !== false) {
    labels.push(`run = ${numberText(triangle.run)}`);
  }

  if (engineering.showRise !== false) {
    labels.push(`rise = ${numberText(triangle.rise)}`);
  }

  if (engineering.showSlope === true && triangle.slope !== null) {
    labels.push(`m = ${numberText(triangle.slope)}`);
  }

  if (labels.length) {
    const offset = geometry.labelOffset || { x: 0, y: 0 };

    text(
      svg,
      {
        x: (start.x + end.x) / 2 + Number(offset.x || 0),
        y: (start.y + end.y) / 2 + Number(offset.y || 0) - 10,
      },
      labels.join("   "),
      { fill: stroke, size: 11 },
    );
  }

  parentSvg.appendChild(svg);

  return true;
}

/* ============================================================
 * THE DISPATCH
 * ============================================================ */

export const MATH_RENDERERS = Object.freeze([
  {
    matches: (entity) => entity?.type === enggMathModel.MATH_POINT_TYPE,
    draw: drawMathPoint,
  },
  {
    matches: (entity) => entity?.type === enggMathModel.MATH_VECTOR_TYPE,
    draw: drawMathVector,
  },
  {
    matches: (entity) => entity?.type === enggMathModel.MATH_PLOT_TYPE,
    draw: drawMathGraph,
  },
  {
    matches: (entity) => entity?.type === enggMathModel.MATH_EQUATION_TYPE,
    draw: drawMathEquation,
  },
  {
    matches: (entity) => entity?.type === enggMathModel.MATH_TANGENT_TYPE,
    draw: drawMathTangent,
  },
  {
    matches: (entity) =>
      entity?.type === enggMathModel.MATH_SLOPE_TRIANGLE_TYPE,
    draw: drawMathSlopeTriangle,
  },
]);

export default {
  MATH_RENDERERS,
  drawMathPoint,
  drawMathVector,
  drawMathGraph,
  drawPlotFunctions,
  drawMathEquation,
  drawMathTangent,
  drawMathSlopeTriangle,
  pointLabel,
};

void enggDrawingState;
