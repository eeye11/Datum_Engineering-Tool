/*
 * ============================================================
 * THE MATH / ANALYSIS READERS
 * ============================================================
 *
 * The reader half of the Math writer. A block written by `source-writers/math.js`
 * carries one `% DAETUM MATH: kind=... ...` line naming what it is and the facts
 * its geometry cannot state - a curve's expression, a graph's limits, a
 * construction's type and mode. This module reads that line back and rebuilds
 * the object's model.
 *
 * A BLOCK WHOSE METADATA IS MISSING OR UNREADABLE IS DECLINED (null), never
 * guessed at - the block then keeps its last valid form, exactly as any other
 * unsupported edit does. That is what stops a hand-edited coordinate from
 * silently turning a graph into a rectangle.
 *
 * THE GEOMETRY IS READ FROM THE METADATA, NOT FROM THE COMMANDS. A graph's box,
 * a vector's ends and a triangle's positions are all written as numbers on the
 * metadata line, so a retyped value is read exactly as typed - and the commands
 * below it are the picture, not a second source of truth.
 */

import enggMathModel from "../../../../features/workspace/math/math-model.js";

/* One metadata line, as `{ field, value }` - or null when it is not one. */
const METADATA = /^[ \t]*%[ \t]*DAETUM[ \t]+([A-Z]+)[ \t]*:[ \t]*(.*?)[ \t]*$/;

function metadataOf(source) {
  const fields = {};

  String(source ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .forEach((line) => {
      const match = METADATA.exec(line);

      if (match) {
        fields[String(match[1]).toUpperCase()] = match[2];
      }
    });

  return fields;
}

/* `a=1 b="two words"` -> `{ a: "1", b: "two words" }`. */
function settingsOf(value) {
  const settings = {};

  const pattern = /([A-Za-z][\w-]*)=(?:"([^"]*)"|(\S*))/g;

  let match = pattern.exec(String(value ?? ""));

  while (match) {
    settings[match[1]] = match[2] !== undefined ? match[2] : match[3];
    match = pattern.exec(String(value ?? ""));
  }

  return settings;
}

function numberOf(value, fallback = null) {
  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
}

function flagOf(value, fallback = false) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase();

  if (text === "on" || text === "true") {
    return true;
  }

  if (text === "off" || text === "false") {
    return false;
  }

  return fallback;
}

/* The style a block's options state, mapped back to the model's own words. */
function styleFromSource(source, previous = {}) {
  const style = { ...(previous || {}) };

  const definitions = new Map();

  String(source ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .forEach((line) => {
      const rgb =
        /^[ \t]*\\definecolor\{([^}]*)\}\{RGB\}\{(\d+),(\d+),(\d+)\}/.exec(
          line,
        );

      if (rgb) {
        const hex = [rgb[2], rgb[3], rgb[4]]
          .map((channel) =>
            Math.max(0, Math.min(255, Number(channel)))
              .toString(16)
              .padStart(2, "0"),
          )
          .join("");

        definitions.set(rgb[1].trim(), `#${hex}`.toLowerCase());
      }
    });

  const optionLists = [
    ...String(source ?? "").matchAll(
      /\\(?:draw|fill|filldraw)\s*\[([^\]]*)\]/g,
    ),
  ].map((match) => match[1]);

  optionLists.forEach((list) => {
    list.split(",").forEach((option) => {
      const [rawKey, rawValue] = option.split("=").map((part) => part.trim());
      const key = rawKey.replace(/\s+/g, " ").toLowerCase();

      if (key === "dashed") {
        style.lineType = "dashed";
      } else if (key === "dotted") {
        style.lineType = "dotted";
      } else if (key === "draw" || key === "color") {
        const value = String(rawValue || "").trim();
        const named = definitions.get(value);

        if (named) {
          style.stroke = named;
        } else if (/^black$/i.test(value)) {
          style.stroke = "#000000";
        }
      }
    });
  });

  return style;
}

/* ============================================================
 * THE READERS
 * ============================================================ */

function readPoint(source, { previous = null } = {}) {
  const settings = settingsOf(metadataOf(source).MATH);

  const x = numberOf(settings.x, null);
  const y = numberOf(settings.y, null);

  if (x === null || y === null) {
    return null;
  }

  return {
    type: enggMathModel.MATH_POINT_TYPE,
    geometry: {
      position: { x, y },
      labelOffset: previous?.geometry?.labelOffset || null,
      parentGraphId: settings.graph || null,
      parentCurveId: settings.curve || null,
      curveParameter: previous?.geometry?.curveParameter ?? null,
    },
    engineering: {
      discipline: "math",
      mathType: enggMathModel.MATH_POINT_TYPE,
      labelMode: ["name", "coordinates", "custom"].includes(settings.label)
        ? settings.label
        : "name",
      labelText: previous?.engineering?.labelText || "",
      showXProjection: flagOf(settings.xproj, false),
      showYProjection: flagOf(settings.yproj, false),
      showCoordinates: previous?.engineering?.showCoordinates !== false,
      snapMode: previous?.engineering?.snapMode || "auto",
    },
    style: styleFromSource(source, previous?.style),
    id: previous?.id || null,
  };
}

function readVector(source, { previous = null } = {}) {
  const settings = settingsOf(metadataOf(source).MATH);

  const x1 = numberOf(settings.x1, null);
  const y1 = numberOf(settings.y1, null);
  const x2 = numberOf(settings.x2, null);
  const y2 = numberOf(settings.y2, null);

  if ([x1, y1, x2, y2].some((value) => value === null)) {
    return null;
  }

  return {
    type: enggMathModel.MATH_VECTOR_TYPE,
    geometry: {
      start: { x: x1, y: y1 },
      end: { x: x2, y: y2 },
      labelOffset: previous?.geometry?.labelOffset || null,
      parentGraphId: settings.graph || null,
    },
    engineering: {
      discipline: "math",
      mathType: enggMathModel.MATH_VECTOR_TYPE,
      showComponents: flagOf(settings.components, false),
      showProjectionGuides: flagOf(settings.guides, false),
      showComponentLabels: previous?.engineering?.showComponentLabels === true,
      showMagnitude: previous?.engineering?.showMagnitude === true,
      showDirection: previous?.engineering?.showDirection === true,
    },
    style: styleFromSource(source, previous?.style),
    id: previous?.id || null,
  };
}

/*
 * A PLOT: ITS BOX, ITS COORDINATE SETTINGS, AND ITS FUNCTIONS.
 *
 * The box and the settings come from the `% DAETUM MATH:` line; the functions
 * come from the `% DAETUM FUNCTION:` lines that follow it, one per component.
 * A function whose expression the evaluator cannot read is DROPPED rather than
 * stored - it would draw nothing, and keeping it would leave the panel
 * claiming a curve the sheet does not show.
 */
function readPlot(source, { previous = null } = {}) {
  const settings = settingsOf(metadataOf(source).MATH);

  const x = numberOf(settings.x, null);
  const y = numberOf(settings.y, null);
  const w = numberOf(settings.w, null);
  const h = numberOf(settings.h, null);

  if ([x, y, w, h].some((value) => value === null) || !(w > 0) || !(h > 0)) {
    return null;
  }

  return {
    type: enggMathModel.MATH_PLOT_TYPE,
    geometry: {
      position: { x, y },
      width: w,
      height: h,
      xMin: numberOf(settings.xmin, enggMathModel.DEFAULT_GRAPH_LIMITS.xMin),
      xMax: numberOf(settings.xmax, enggMathModel.DEFAULT_GRAPH_LIMITS.xMax),
      yMin: numberOf(settings.ymin, enggMathModel.DEFAULT_GRAPH_LIMITS.yMin),
      yMax: numberOf(settings.ymax, enggMathModel.DEFAULT_GRAPH_LIMITS.yMax),
      xTickSpacing: numberOf(settings.xtick, null),
      yTickSpacing: numberOf(settings.ytick, null),
      showXAxis: previous?.geometry?.showXAxis !== false,
      showYAxis: previous?.geometry?.showYAxis !== false,
      showGrid: flagOf(settings.grid, true),
      showMinorGrid: previous?.geometry?.showMinorGrid === true,
      showTickLabels: previous?.geometry?.showTickLabels !== false,
      xLabel: previous?.geometry?.xLabel ?? "x",
      yLabel: previous?.geometry?.yLabel ?? "y",
      equalUnits: flagOf(settings.equal, true),
      mode: settings.mode === "sketch" ? "sketch" : "plot",
      functions: functionsOf(source, previous),
    },
    engineering: {
      discipline: "math",
      mathType: enggMathModel.MATH_PLOT_TYPE,
    },
    style: styleFromSource(source, previous?.style),
    id: previous?.id || null,
  };
}

/*
 * THE FUNCTIONS A PLOT BLOCK DECLARES.
 *
 * Each `% DAETUM FUNCTION:` line is one component. A line whose expression is
 * unreadable is skipped, and a component the previous object already had keeps
 * its reconstructed geometry - so a hand-edited expression does not throw away
 * the curve the student drew.
 */
function functionsOf(source, previous) {
  const lines = String(source ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => /^[ \t]*%[ \t]*DAETUM[ \t]+FUNCTION[ \t]*:/i.test(line));

  const before = enggMathModel.plotFunctions(previous);

  return lines
    .map((line) => {
      const settings = settingsOf(line.replace(/^[^:]*:/, ""));

      const id = String(settings.id || "").trim();

      if (!id) {
        return null;
      }

      const mode = settings.mode === "sketch" ? "sketch" : "plot";
      const expression = String(settings.expression ?? "").trim();

      if (mode === "plot" && (!expression || !enggMathModel.curveExpressionValid(expression))) {
        return null;
      }

      const [min, max] = String(settings.domain || "")
        .split(":")
        .map(Number);

      const existing = before.find((component) => component.id === id);

      return {
        id,
        mode,
        expression,
        variable: settings.variable || "x",
        domain: {
          min: Number.isFinite(min) ? min : enggMathModel.DEFAULT_DOMAIN.min,
          max: Number.isFinite(max) ? max : enggMathModel.DEFAULT_DOMAIN.max,
        },
        visible: settings.visible !== "off",
        style: existing?.style || null,
        points: existing?.points || [],
        segments: existing?.segments || [],
        originalTrace: existing?.originalTrace || [],
        showOriginalTrace: existing?.showOriginalTrace === true,
        smoothing: Number(existing?.smoothing) || 0,
        fitType: ["none", "linear", "quadratic", "cubic"].includes(settings.fit)
          ? settings.fit
          : "none",
        fitExpression: String(settings.fitExpression ?? ""),
        showFitExpression: existing?.showFitExpression === true,
      };
    })
    .filter(Boolean);
}

/* The coordinates of every `( x , y )` in the source, in drawing coordinates. */
function coordinatesOf(source) {
  return [
    ...String(source ?? "").matchAll(
      /\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g,
    ),
  ].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
}

function readEquation(source, { previous = null } = {}) {
  const settings = settingsOf(metadataOf(source).MATH);

  const x = numberOf(settings.x, null);
  const y = numberOf(settings.y, null);

  if (x === null || y === null) {
    return null;
  }

  /*
   * THE CONTENT IS THE NODE'S OWN TEXT, read from the `\node ... { ... }` the
   * writer emitted - so a retyped equation is the equation.
   */
  const content = nodeContentOf(source);

  if (!content) {
    return null;
  }

  return {
    type: enggMathModel.MATH_EQUATION_TYPE,
    geometry: {
      position: { x, y },
      rotation: Number(previous?.geometry?.rotation) || 0,
    },
    engineering: {
      discipline: "math",
      mathType: enggMathModel.MATH_EQUATION_TYPE,
      content,
      fontSize: numberOf(settings.size, 16),
      align: ["left", "center", "right"].includes(settings.align)
        ? settings.align
        : "center",
      verticalAlign: previous?.engineering?.verticalAlign || "middle",
      displayMode: settings.display === "inline" ? "inline" : "display",
    },
    style: styleFromSource(source, previous?.style),
    id: previous?.id || null,
  };
}

/* The text inside a node's braces, with the maths delimiters removed. */
function nodeContentOf(source) {
  const match =
    /\\node(?:\[[^\]]*\])?\s*at\s*\([^)]*\)\s*\{([\s\S]*)\}\s*;/.exec(
      String(source ?? ""),
    );

  if (!match) {
    return "";
  }

  return match[1]
    .replace(/\s*\\\\\s*/g, "\n")
    .replace(/\$/g, "")
    .trim();
}

function readTangent(
  source,
  { previous = null, hostExists = () => true } = {},
) {
  const settings = settingsOf(metadataOf(source).MATH);

  const cx = numberOf(settings.cx, null);
  const cy = numberOf(settings.cy, null);

  if (cx === null || cy === null) {
    return null;
  }

  const curveId = String(settings.curve || "").trim();

  if (curveId && !hostExists(curveId)) {
    return null;
  }

  const coordinates = coordinatesOf(source);

  if (coordinates.length < 2) {
    return null;
  }

  const [start, end] = coordinates;

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);

  return {
    type: enggMathModel.MATH_TANGENT_TYPE,
    geometry: {
      contact: { x: cx, y: cy },
      start,
      end,
      direction: length > 1e-9 ? { x: dx / length, y: dy / length } : null,
      length: numberOf(
        settings.length,
        length || enggMathModel.DEFAULT_CONSTRUCTION_LENGTH,
      ),
      parentCurveId: curveId || null,
    },
    engineering: {
      discipline: "math",
      mathType: enggMathModel.MATH_TANGENT_TYPE,
      constructionType: settings.type === "normal" ? "normal" : "tangent",
      mode: settings.mode === "plot" ? "plot" : "sketch",
    },
    style: styleFromSource(source, previous?.style),
    id: previous?.id || null,
  };
}

function readSlopeTriangle(
  source,
  { previous = null, hostExists = () => true } = {},
) {
  const settings = settingsOf(metadataOf(source).MATH);

  const x1 = numberOf(settings.x1, null);
  const y1 = numberOf(settings.y1, null);
  const x2 = numberOf(settings.x2, null);
  const y2 = numberOf(settings.y2, null);

  if ([x1, y1, x2, y2].some((value) => value === null)) {
    return null;
  }

  const lineId = String(settings.line || "").trim();

  if (lineId && !hostExists(lineId)) {
    return null;
  }

  return {
    type: enggMathModel.MATH_SLOPE_TRIANGLE_TYPE,
    geometry: {
      start: { x: x1, y: y1 },
      end: { x: x2, y: y2 },
      corner: { x: x2, y: y1 },
      parentLineId: lineId || null,
      labelOffset: previous?.geometry?.labelOffset || null,
    },
    engineering: {
      discipline: "math",
      mathType: enggMathModel.MATH_SLOPE_TRIANGLE_TYPE,
      mode: settings.mode === "plot" ? "plot" : "sketch",
      showRise: flagOf(settings.rise, true),
      showRun: flagOf(settings.run, true),
      showSlope: flagOf(settings.slope, false),
      showRightAngle: previous?.engineering?.showRightAngle !== false,
    },
    style: styleFromSource(source, previous?.style),
    id: previous?.id || null,
  };
}

/* ============================================================
 * WHICH READER ANSWERS A BLOCK
 * ============================================================
 *
 * Decided by the block's own `kind=` field, so a block edited into another kind
 * of Math object is read as that kind and the two cannot disagree about what
 * the code means.
 */
export function mathReaderFor(source) {
  const settings = settingsOf(metadataOf(source).MATH);

  switch (settings.kind) {
    case "point":
      return readPoint;
    case "vector":
      return readVector;
    case "plot":
      return readPlot;
    case "equation":
      return readEquation;
    case "tangent":
      return readTangent;
    case "slope-triangle":
      return readSlopeTriangle;
    default:
      return null;
  }
}

/* Whether a block is a Math block at all. */
export function isMathBlock(source) {
  return /^[ \t]*%[ \t]*DAETUM[ \t]+MATH[ \t]*:/m.test(String(source ?? ""));
}

export default {
  mathReaderFor,
  isMathBlock,
};
