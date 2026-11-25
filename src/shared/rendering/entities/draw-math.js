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

/*
 * THE SHARED COORDINATE SYSTEM.
 *
 * A placed graph draws its axes, ticks and grid with the SAME painter the
 * editors use, from the SAME converted settings - so a graph on the sheet and
 * the same graph in the Plot Editor cannot show different grid paper.
 */
import { drawAxesAndGrid } from "../../sketch/sketch-axes.js";
import {
  graphViewport,
  outputLayersFor,
} from "../../sketch/sketch-axes-adapter.js";
import { gridFromGeometry } from "../../sketch/sketch-grid-legacy.js";
import enggTheme from "../../../components/layout/workspace/theme.js";
import {
  activeZoom,
  createSvgElement,
  dashArrayFor,
  paintColour,
  scaledStrokeWidth,
  worldLength,
} from "../svg-primitives.js";
import {
  AUXILIARY_FONT_PX,
  CANVAS_FONT_STACK,
  MATH_FONT_STACK,
  SECONDARY_FONT_PX,
  PRIMARY_FONT_PX,
  fontScaleForZoom,
  fontSizeOf,
  textTransform,
} from "../../typography/canvas-typography.js";

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

function widthOf(style) {
  return scaledStrokeWidth(Number(style?.lineWidth) || 0.5);
}

function dashFor(style) {
  const pattern =
    style?.lineType === "dashed"
      ? "6 4"
      : style?.lineType === "dotted"
        ? "1 4"
        : null;

  /*
   * A DASH IS A LENGTH OF THE DRAWING, so it goes through the one conversion
   * every other world length uses. Written raw it was six overlay pixels - the
   * same six at 25% and at 400%, where the geometry around it had quartered or
   * quadrupled.
   */
  return pattern ? dashArrayFor(pattern) : null;
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

/*
 * A LABEL OF A MATH OBJECT, drawn at a canvas font size.
 *
 * The camera is cancelled on the glyphs (see `textTransform`) while `at` - the
 * projected drawing position - is what anchors them, so a graph's tick number, an
 * axis title, a point's coordinates and a vector's magnitude keep their size on
 * screen at every zoom and their place on the sheet at every pan.
 */
function text(
  svg,
  at,
  content,
  {
    fill,
    size = AUXILIARY_FONT_PX,
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

  const zoom = Math.max(Number(activeZoom) || 1, 0.0001);

  const node = createSvgElement("text", {
    x: at.x,
    y: at.y,
    fill,
    "font-size": Math.round(fontSizeOf(size, AUXILIARY_FONT_PX) * zoom * 1000) / 1000,
    "font-family": CANVAS_FONT_STACK,
    "text-anchor": anchor,
    "dominant-baseline": baseline,
    "pointer-events": "none",
    transform: textTransform(at, zoom),
    ...(role ? { "data-label": role } : {}),
    ...extra,
  });

  node.textContent = String(content);

  svg.appendChild(node);

  return node;
}

/* A filled arrowhead, built from the two projected ends. */
function arrowHead(svg, tip, tail, stroke, worldSize = 9) {
  /* The head is a size of the drawing, stated in world units by its caller. */
  const size = worldLength(worldSize);

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
          size: AUXILIARY_FONT_PX,
        },
      );

      text(
        svg,
        { x: head.x + 8, y: (tail.y + head.y) / 2 },
        `Δy = ${numberText(dy)}`,
        {
          fill: componentStroke,
          size: AUXILIARY_FONT_PX,
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
        size: AUXILIARY_FONT_PX,
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

  /*
   * NO BOX AROUND THE GRAPH.
   *
   * A graph used to be enclosed in a rectangle traced corner to corner, which
   * read as the coordinate system itself - as though the student were working
   * inside a boxed plot area. It is not: the graph's extent is a mapping, and
   * what is drawn on the sheet is the grid and the two axes. The box is gone
   * here, so it is gone from every graph and every sketch that shares this
   * painter.
   */

  /*
   * ========================================================
   * THE COORDINATE SYSTEM, FROM THE ONE SHARED PAINTER
   * ========================================================
   *
   * The grid, the axes, the ticks and the numbers are drawn by
   * `drawAxesAndGrid` - the same painter the Sketch Editor and the Plot Editor
   * use. That is what makes a placed graph and its preview agree: there is one
   * implementation of "what a major grid is", not three that drifted.
   *
   * THE GRAPH IS PRESENTED AS A VIEWPORT. `graphViewport` adapts its frame and
   * limits to the shape the painter asks for; the mapping itself is still
   * `graphMapping`'s, and every point still goes through `graphToDrawing`. So
   * the curve, the grid and the axes land through the same transform they
   * always did.
   *
   * THE LAYERS COME FROM THE GRAPH'S OWN SETTINGS, converted once by
   * `gridFromGeometry`. A sketch saved with no grid still draws no grid; a plot
   * saved with numbers still prints them. Nothing here re-derives a default.
   */
  const graphGrid = gridFromGeometry(geometry);

  const axesViewport = graphViewport(entity, enggMathModel);

  if (axesViewport) {
    /*
     * THE PAINTER'S MODEL -> PIXEL IS THE COMPLETE CHAIN: a graph coordinate
     * through `graphToDrawing`, then through the sheet's own `toScreen`.
     *
     * The adapter's viewport `toScreen` does only the FIRST half, because it
     * has no access to the camera. Supplying the second half here is what puts
     * the grid on the sheet: without it the painter was handed drawing
     * coordinates by its viewport and then drew them unchanged into a canvas
     * measured in screen pixels, so every line landed near the origin.
     */
    drawAxesAndGrid(svg, graphGrid, axesViewport, {
      className: "graph",
      include: outputLayersFor(graphGrid),
      toScreen: (point) => toScreen(axesViewport.toScreen(point)),

      /*
       * THE PAINTER DRAWS CANVAS TEXT, so it is told the camera: every tick
       * number and axis name it emits is placed at the projected point and its
       * glyphs are divided back out of the zoom. Without this the numbers grew
       * and shrank with the sheet.
       */
      zoom: activeZoom,
      fontFamily: CANVAS_FONT_STACK,
    });
  }

  /* The axis names, at the ends of the axes that are actually drawn. */
  if (display.showAxisNames !== false) {
    const origin = mapping.origin;

    const xAxisVisible =
      graphGrid.showXAxis &&
      origin.y >= mapping.bottom - 1e-9 &&
      origin.y <= mapping.top + 1e-9;

    const yAxisVisible =
      graphGrid.showYAxis &&
      origin.x >= mapping.left - 1e-9 &&
      origin.x <= mapping.right + 1e-9;

    if (xAxisVisible && String(graphGrid.xAxisLabel ?? "").trim()) {
      text(svg, { x: mapping.right + 10, y: origin.y }, graphGrid.xAxisLabel, {
        fill: stroke,
        size: SECONDARY_FONT_PX,
        anchor: "start",
        role: "axis-name",
      });
    }

    if (yAxisVisible && String(graphGrid.yAxisLabel ?? "").trim()) {
      text(svg, { x: origin.x, y: mapping.top - 10 }, graphGrid.yAxisLabel, {
        fill: stroke,
        size: SECONDARY_FONT_PX,
        role: "axis-name",
      });
    }
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
          size: AUXILIARY_FONT_PX,
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

  /*
   * AN EQUATION'S SIZE IS A CHOICE, STORED AS A CANVAS FONT SIZE - so it reads
   * at the same size on screen at every zoom.
   */
  const size = fontSizeOf(Number(engineering.fontSize), PRIMARY_FONT_PX);

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

  const zoom = Math.max(Number(activeZoom) || 1, 0.0001);

  /*
   * AN EQUATION ROTATES AND KEEPS ITS SCREEN SIZE AT ONCE.
   *
   * `textTransform` composes the two about the equation's own point: the
   * rotation turns it, the compensation divides the camera back out of the
   * glyphs. Writing a bare `rotate(... about at)` here instead would leave the
   * type scaled by the zoom.
   */
  const node = createSvgElement("text", {
    x: at.x,
    y: at.y,
    fill: stroke,
    "font-size": fontScaleForZoom(size, zoom),
    "font-family": MATH_FONT_STACK,
    "font-style": "italic",
    "text-anchor": anchor,
    "dominant-baseline": baseline,
    "pointer-events": "none",
    transform: textTransform(
      at,
      zoom,
      Number(geometry.rotation) ? `rotate(${-Number(geometry.rotation)})` : "",
    ),
  });

  lines.forEach((lineText, index) => {
    if (index === 0) {
      node.textContent = lineText;
      return;
    }

    const tspan = createSvgElement("tspan", {
      x: at.x,
      /* The line advance in the node's own camera-scaled units. */
      dy: Math.round(size * zoom * 1.25 * 1000) / 1000,
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
      size: AUXILIARY_FONT_PX,
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
      { fill: stroke, size: AUXILIARY_FONT_PX },
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
