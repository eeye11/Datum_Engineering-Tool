/*
 * ============================================================
 * THE SHARED AXES, TICKS, LABELS AND GRID PAINTER
 * ============================================================
 *
 * ONE painter for the coordinate system a student sees, used by the sketch
 * editor's canvas, the plot editor's preview and - through a coordinate
 * adapter - the placed graph on the main sheet. If those three could draw the
 * same grid differently, the preview would be a promise the sheet might not
 * keep, so they share this file instead of each carrying its own copy.
 *
 * WHAT IT DRAWS, AND WHAT IT WILL NOT
 * -----------------------------------
 * It draws the COORDINATE SYSTEM: minor grid, major grid, the two axes, the
 * origin mark, ticks and tick numbers. Nothing else. Curves, points and
 * editing aids belong to their own painters, and nothing here reaches into
 * them - which is what makes "the grid must not read heavier than the curves"
 * a property of the ordering rather than of a comment.
 *
 * EVERY LAYER IS INDEPENDENT. The order below is minor grid, major grid, axes,
 * origin, ticks, labels - and each is guarded by its own setting. There is no
 * "if the grid is off, skip the axes" anywhere: turning off any one of the ten
 * controls leaves the other nine exactly as they were.
 *
 * ZOOM INDEPENDENCE. Every stroke is `non-scaling-stroke`, and every font size
 * is a fixed document size. Nothing is multiplied by the viewport's scale, so
 * zooming changes how much of the grid is on screen and never how heavy it is.
 *
 * MODEL UNITS ONLY. Everything is computed from `viewport.scaleX/scaleY` and
 * the visible model rectangle. No function here reads a pixel size except
 * `tickLengthPx`, which is a HAND length for a tick mark, not a coordinate.
 */

import {
  formatTick,
  gridRenderable,
  gridValues,
  minorSpacing,
  normaliseGrid,
} from "./sketch-grid.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function createSvgElement(name, attributes = {}) {
  if (!globalThis.document) {
    return null;
  }

  const element = globalThis.document.createElementNS(SVG_NS, name);

  Object.entries(attributes).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      element.setAttribute(key, String(value));
    }
  });

  return element;
}

/*
 * DASH PATTERNS FOR A GRID STYLE.
 *
 * `null` means solid - the attribute is then omitted rather than set to
 * "none", which is not a valid `stroke-dasharray` value everywhere.
 */
function dashFor(style) {
  if (style === "dashed") {
    return "5 4";
  }

  if (style === "dotted") {
    return "1 3";
  }

  return null;
}

/*
 * The toScreen a caller must supply is a MODEL point -> PIXEL function. That is
 * the only thing this module needs from a viewport, which is what lets the
 * placed graph on the sheet pass its own adapter: it has a transform rather
 * than an editor viewport, and the painter does not care which it is.
 */
function defaultToScreen(viewport) {
  return (point) =>
    typeof viewport?.toScreen === "function"
      ? viewport.toScreen(point)
      : { x: point.x, y: point.y };
}

/* The visible model rectangle a painter draws against. */
function visibleOf(viewport) {
  return (
    viewport?.visible ||
    viewport?.bounds || {
      xMin: -5,
      xMax: 5,
      yMin: -5,
      yMax: 5,
    }
  );
}

/*
 * ============================================================
 * DRAW THE COORDINATE SYSTEM INTO `layer`
 * ============================================================
 *
 *   layer      an SVG element to append to
 *   grid       raw settings; normalised here, so a caller may pass a partial
 *   viewport   { visible, scaleX, scaleY, toScreen? }
 *   options    { className, include, skip }
 *
 * `include` restricts the drawing to a subset of layers - the placed-graph
 * path uses it, because a student who asked for the axes in the export usually
 * did not ask for the editor's working grid. `skip` is the inverse and exists
 * for symmetry so a caller can express either preference.
 *
 * Returns { drawn, suppressed } where `suppressed` names the layers that were
 * wanted but are not renderable at this scale - so a caller can say why a grid
 * is missing rather than leaving the student guessing.
 */
export function drawAxesAndGrid(
  layer,
  grid,
  viewport,
  { className = "sketch", include = null, skip = null, toScreen = null } = {},
) {
  if (!layer) {
    return { drawn: [], suppressed: [] };
  }

  const settings = normaliseGrid(grid);
  const visible = visibleOf(viewport);
  const renderable = gridRenderable(settings, viewport);

  const mapPoint = toScreen || defaultToScreen(viewport);

  const drawn = [];
  const suppressed = [];

  const wanted = (name) => {
    if (Array.isArray(include) && !include.includes(name)) {
      return false;
    }

    if (Array.isArray(skip) && skip.includes(name)) {
      return false;
    }

    return true;
  };

  const push = (element) => {
    if (element) {
      layer.appendChild(element);
    }
  };

  /* One line across the visible rectangle, in model coordinates. */
  const line = (from, to, kind, { dash = null, opacity = null } = {}) => {
    const a = mapPoint(from);
    const b = mapPoint(to);

    push(
      createSvgElement("line", {
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        class: `${className}-${kind}`,
        "stroke-dasharray": dash,
        "stroke-opacity": opacity === null ? null : opacity,
        "vector-effect": "non-scaling-stroke",
      }),
    );
  };

  const spacing = minorSpacing(settings);

  /* ---- minor grid ------------------------------------------------------ */
  if (settings.showMinorGrid && wanted("minorGrid")) {
    if (renderable.minor) {
      const dash = dashFor(settings.minorStyle);

      gridValues(visible.xMin, visible.xMax, spacing.x).forEach((value) => {
        line(
          { x: value, y: visible.yMin },
          { x: value, y: visible.yMax },
          "grid-minor",
          { dash, opacity: settings.minorOpacity },
        );
      });

      gridValues(visible.yMin, visible.yMax, spacing.y).forEach((value) => {
        line(
          { x: visible.xMin, y: value },
          { x: visible.xMax, y: value },
          "grid-minor",
          { dash, opacity: settings.minorOpacity },
        );
      });

      drawn.push("minorGrid");
    } else {
      suppressed.push("minorGrid");
    }
  }

  /* ---- major grid ------------------------------------------------------ */
  if (settings.showMajorGrid && wanted("majorGrid")) {
    if (renderable.major) {
      const dash = dashFor(settings.majorStyle);

      gridValues(visible.xMin, visible.xMax, settings.majorX).forEach(
        (value) => {
          line(
            { x: value, y: visible.yMin },
            { x: value, y: visible.yMax },
            "grid-major",
            { dash, opacity: settings.majorOpacity },
          );
        },
      );

      gridValues(visible.yMin, visible.yMax, settings.majorY).forEach(
        (value) => {
          line(
            { x: visible.xMin, y: value },
            { x: visible.xMax, y: value },
            "grid-major",
            { dash, opacity: settings.majorOpacity },
          );
        },
      );

      drawn.push("majorGrid");
    } else {
      suppressed.push("majorGrid");
    }
  }

  /*
   * THE AXES, THROUGH ZERO, AND ONLY WHEN ZERO IS IN VIEW.
   *
   * A graph of y = 2..8 has no y = 0 in it, so its x-axis is not inside the
   * plotting area and is not drawn - rather than being pushed onto an edge,
   * which would claim the value exists there.
   */
  const xAxisInView = visible.yMin <= 0 && visible.yMax >= 0;
  const yAxisInView = visible.xMin <= 0 && visible.xMax >= 0;

  if (settings.showXAxis && wanted("xAxis")) {
    if (xAxisInView) {
      line({ x: visible.xMin, y: 0 }, { x: visible.xMax, y: 0 }, "axis-x");

      drawn.push("xAxis");
    } else {
      suppressed.push("xAxis");
    }
  }

  if (settings.showYAxis && wanted("yAxis")) {
    if (yAxisInView) {
      line({ x: 0, y: visible.yMin }, { x: 0, y: visible.yMax }, "axis-y");

      drawn.push("yAxis");
    } else {
      suppressed.push("yAxis");
    }
  }

  /* ---- the origin mark ------------------------------------------------- */
  if (settings.showOrigin && wanted("origin") && xAxisInView && yAxisInView) {
    const at = mapPoint({ x: 0, y: 0 });

    const mark = createSvgElement("circle", {
      cx: at.x,
      cy: at.y,
      r: 2.5,
      class: `${className}-origin`,
      "vector-effect": "non-scaling-stroke",
    });

    if (mark) {
      mark.setAttribute("data-origin", "true");
    }

    push(mark);
    drawn.push("origin");
  }

  /* ---- tick marks ------------------------------------------------------ */
  if (settings.showTicks && wanted("ticks")) {
    const length = settings.tickLengthPx;
    const direction = settings.tickDirection;

    /*
     * A TICK IS A HAND LENGTH, so it is measured in PIXELS from the axis and
     * not in model units. `inside`, `outside` and `both` choose which side of
     * the axis it stands on; the mark always straddles the axis line itself.
     */
    const spanFor = (axis) => {
      if (direction === "inside") {
        return axis === "x" ? [0, length * 2] : [0, -length * 2];
      }

      if (direction === "both") {
        return [-length, length];
      }

      return [-length, length];
    };

    if (settings.showXAxis && xAxisInView) {
      const [low, high] = spanFor("x");

      gridValues(visible.xMin, visible.xMax, settings.majorX).forEach(
        (value) => {
          const at = mapPoint({ x: value, y: 0 });

          push(
            createSvgElement("line", {
              x1: at.x,
              y1: at.y + low,
              x2: at.x,
              y2: at.y + high,
              class: `${className}-tick`,
              "vector-effect": "non-scaling-stroke",
            }),
          );
        },
      );

      drawn.push("ticks");
    }

    if (settings.showYAxis && yAxisInView) {
      const [low, high] = spanFor("y");

      gridValues(visible.yMin, visible.yMax, settings.majorY).forEach(
        (value) => {
          const at = mapPoint({ x: 0, y: value });

          push(
            createSvgElement("line", {
              x1: at.x - high,
              y1: at.y,
              x2: at.x - low,
              y2: at.y,
              class: `${className}-tick`,
              "vector-effect": "non-scaling-stroke",
            }),
          );
        },
      );
    }
  }

  /* ---- numeric tick labels --------------------------------------------- */
  /*
   * INDEPENDENT OF THE MARKS. Numbers can be shown without ticks and ticks
   * without numbers; neither implies the other. Zero is skipped because the
   * origin is drawn as its own mark, and a "0" beside it is noise.
   */
  if (settings.showTickLabels && wanted("tickLabels")) {
    const label = (x, y, text, anchor) => {
      const element = createSvgElement("text", {
        x,
        y,
        class: `${className}-tick-label`,
        "text-anchor": anchor,
      });

      if (element) {
        element.textContent = text;
      }

      push(element);
    };

    if (xAxisInView) {
      gridValues(visible.xMin, visible.xMax, settings.majorX).forEach(
        (value) => {
          if (value === 0) {
            return;
          }

          const at = mapPoint({ x: value, y: 0 });

          label(at.x, at.y + 14, formatTick(value, settings), "middle");
        },
      );
    }

    if (yAxisInView) {
      gridValues(visible.yMin, visible.yMax, settings.majorY).forEach(
        (value) => {
          if (value === 0) {
            return;
          }

          const at = mapPoint({ x: 0, y: value });

          label(at.x - 8, at.y + 4, formatTick(value, settings), "end");
        },
      );
    }

    drawn.push("tickLabels");
  }

  /* ---- axis labels ------------------------------------------------------ */
  if (settings.showAxisLabels && wanted("axisLabels")) {
    if (xAxisInView) {
      const at = mapPoint({ x: visible.xMax, y: 0 });

      const element = createSvgElement("text", {
        x: at.x - 4,
        y: at.y - 6,
        class: `${className}-axis-label`,
        "text-anchor": "end",
      });

      if (element) {
        element.textContent = settings.xAxisLabel;
      }

      push(element);
    }

    if (yAxisInView) {
      const at = mapPoint({ x: 0, y: visible.yMax });

      const element = createSvgElement("text", {
        x: at.x + 8,
        y: at.y + 4,
        class: `${className}-axis-label`,
        "text-anchor": "start",
      });

      if (element) {
        element.textContent = settings.yAxisLabel;
      }

      push(element);
    }

    drawn.push("axisLabels");
  }

  return { drawn, suppressed };
}

/*
 * THE LAYERS A PLACED GRAPH PUTS IN ITS FINAL DRAWING.
 *
 * `includeInOutput` decides whether the coordinate system is geometry the
 * student wants on the sheet, and the individual preview toggles stay exactly
 * as they are - so hiding the grid to inspect a curve never removes it from
 * the export, and including the axes never forces the working grid in.
 */
export const OUTPUT_LAYERS = Object.freeze([
  "xAxis",
  "yAxis",
  "origin",
  "majorGrid",
  "minorGrid",
  "ticks",
  "tickLabels",
  "axisLabels",
]);

export default {
  OUTPUT_LAYERS,
  drawAxesAndGrid,
};
