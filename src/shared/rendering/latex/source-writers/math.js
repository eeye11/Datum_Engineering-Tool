/*
 * ============================================================
 * THE MATH / ANALYSIS SOURCE WRITER
 * ============================================================
 *
 * Turns a Math object into the TikZ that draws it, from the object's own model -
 * the same functions the canvas and the Features panel read, so the compiled
 * picture and the sheet cannot disagree.
 *
 * ONE BLOCK PER OBJECT. A Point's marker and its label, a Graph's box, axes,
 * grid, ticks and labels, a Curve's path and its fitted expression - each is ONE
 * object and ONE region of source, keyed by the object's stable id. A targeted
 * edit rewrites exactly that region and nothing else.
 *
 * THE METADATA LINE CARRIES WHAT THE GEOMETRY CANNOT SAY. A curve's expression,
 * a graph's limits, a construction's type and mode, a triangle's parent - none
 * of them is a coordinate, so each is written as a `% DAETUM FIELD: value` line
 * the reader can find again. That is the same machinery the Fluids schematics
 * use, and it is what makes a reopened drawing come back as the object it was.
 *
 * NOTHING IS INVENTED. A curve with no expression writes nothing; a graph with
 * no box writes nothing; a construction whose parent is gone writes nothing.
 * The object keeps its last valid form and the failure is reported, rather than
 * a lookalike being drawn.
 */

import {
  point,
  num,
  styleOptions,
  splitPrelude,
  texText,
} from "./statics-primitives.js";
import { applyObjectComments, ensureObjectId } from "../object-comments.js";
import { reportSourceGenerationProblem } from "../source-diagnostics.js";
import enggMathModel from "../../../../features/workspace/math/math-model.js";
import { drawingState } from "../../../../features/workspace/editor-state.js";

/* ============================================================
 * HELPERS
 * ============================================================ */

function finite(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
}

function validPoint(candidate) {
  return Boolean(
    candidate &&
    Number.isFinite(Number(candidate.x)) &&
    Number.isFinite(Number(candidate.y)),
  );
}

function styleOf(object) {
  const { definitions, options } = splitPrelude(
    styleOptions(object.style || {}),
  );

  return { definitions, options: options.length ? options : ["draw=black"] };
}

function withDefinitions(definitions, commands) {
  const body = commands.filter(Boolean);

  if (!body.length) {
    return null;
  }

  return [...definitions, ...body].join("\n");
}

function line(from, to, options) {
  return `\\draw[${options.join(", ")}] ${point(from.x, from.y)} -- ${point(to.x, to.y)};`;
}

function pathThrough(points, options, { closed = false } = {}) {
  if (!Array.isArray(points) || points.length < 2) {
    return null;
  }

  const body = points
    .map((at, index) =>
      index === 0 ? point(at.x, at.y) : `-- ${point(at.x, at.y)}`,
    )
    .join(" ");

  return `\\draw[${options.join(", ")}] ${body}${closed ? " -- cycle" : ""};`;
}

function node(
  at,
  text,
  { anchor = "center", colour = "black", size = 9 } = {},
) {
  return `\\node[anchor=${anchor}, text=${colour}, font=\\fontsize{${num(size, 2)}}{${num(size * 1.2, 2)}}\\selectfont] at ${point(at.x, at.y)} {${text}};`;
}

function meta(field, value) {
  return `% DAETUM ${field}: ${String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim()}`;
}

function settingsLine(pairs) {
  return pairs
    .map(
      ([key, value]) =>
        `${key}=${String(value ?? "")
          .replace(/[\r\n]+/g, " ")
          .trim()}`,
    )
    .join(" ");
}

/* ============================================================
 * POINT
 * ============================================================ */

function serializePoint(object) {
  const geometry = object.geometry || {};

  if (!validPoint(geometry.position)) {
    return null;
  }

  const { definitions, options } = styleOf(object);
  const at = geometry.position;

  const radius = Math.max(0.6, finite(object.style?.pointSize, 4) * 0.25);

  const commands = [
    `\\fill[${options.filter((option) => !option.startsWith("draw=")).join(", ") || "draw=black"}] ${point(at.x, at.y)} circle[radius=${num(radius, 3)}];`,
  ];

  const label = pointLabelText(object);

  if (label) {
    const offset = geometry.labelOffset || { x: 8, y: -8 };

    commands.push(
      node(
        {
          x: at.x + finite(offset.x, 8) * 0.4,
          y: at.y + finite(offset.y, -8) * 0.4,
        },
        texText(label),
        {
          anchor: "west",
          colour:
            options
              .find((option) => option.startsWith("draw="))
              ?.replace("draw=", "") || "black",
        },
      ),
    );
  }

  const engineering = object.engineering || {};

  return withDefinitions(definitions, [
    meta(
      "MATH",
      settingsLine([
        ["kind", "point"],
        ["label", engineering.labelMode || "name"],
        ["x", num(at.x)],
        ["y", num(at.y)],
        ["graph", geometry.parentGraphId || ""],
        ["curve", geometry.parentCurveId || ""],
        ["xproj", engineering.showXProjection === true ? "on" : "off"],
        ["yproj", engineering.showYProjection === true ? "on" : "off"],
      ]),
    ),
    ...commands,
  ]);
}

/* The text a point draws, from its own label mode. */
function pointLabelText(object) {
  const engineering = object.engineering || {};
  const mode = engineering.labelMode || "name";

  if (mode === "custom") {
    return String(engineering.labelText ?? "").trim();
  }

  if (mode === "coordinates") {
    const graph = drawingState.objects.find(
      (candidate) => candidate.id === object.geometry?.parentGraphId,
    );

    if (!graph) {
      return "";
    }

    const value = enggMathModel.drawingToGraph(
      graph,
      object.geometry?.position,
    );

    return value ? `(${num(value.x)}, ${num(value.y)})` : "";
  }

  return String(object.label ?? object.name ?? "").trim();
}

/* ============================================================
 * VECTOR
 * ============================================================ */

function serializeVector(object) {
  const geometry = object.geometry || {};

  if (!validPoint(geometry.start) || !validPoint(geometry.end)) {
    return null;
  }

  const { definitions, options } = styleOf(object);
  const engineering = object.engineering || {};

  const commands = [
    `\\draw[${[...options, "-{Latex}"].join(", ")}] ${point(geometry.start.x, geometry.start.y)} -- ${point(geometry.end.x, geometry.end.y)};`,
  ];

  if (engineering.showComponents === true) {
    const guide = [...options, "dashed"];

    commands.push(
      line(geometry.start, { x: geometry.end.x, y: geometry.start.y }, guide),
      line({ x: geometry.end.x, y: geometry.start.y }, geometry.end, guide),
    );
  }

  const label = String(object.label ?? "").trim();

  if (label) {
    const offset = geometry.labelOffset || { x: 10, y: -10 };

    commands.push(
      node(
        {
          x: geometry.end.x + finite(offset.x, 10) * 0.4,
          y: geometry.end.y + finite(offset.y, -10) * 0.4,
        },
        texText(label),
        { anchor: "west" },
      ),
    );
  }

  return withDefinitions(definitions, [
    meta(
      "MATH",
      settingsLine([
        ["kind", "vector"],
        ["x1", num(geometry.start.x)],
        ["y1", num(geometry.start.y)],
        ["x2", num(geometry.end.x)],
        ["y2", num(geometry.end.y)],
        ["graph", geometry.parentGraphId || ""],
        ["components", engineering.showComponents === true ? "on" : "off"],
        ["guides", engineering.showProjectionGuides === true ? "on" : "off"],
      ]),
    ),
    ...commands,
  ]);
}

/* ============================================================
 * THE PLOT
 * ============================================================
 *
 * ONE block: the box, the grid, the axes, the ticks, the labels - and then
 * every function drawn inside it. The functions are written as their own
 * `% DAETUM FUNCTION:` lines followed by their paths, so a reader can find one
 * by its component id and a student can see which curve is which.
 *
 * THE METADATA CARRIES WHAT THE GEOMETRY CANNOT SAY: the four limits, the tick
 * spacing, the axis and grid switches, the labels, the equal-unit setting, and
 * for each function its expression, variable, domain and visibility. That is
 * the same machinery the Fluids schematics use, and it is what makes a
 * reopened drawing come back as the plot it was.
 */

function serializePlot(object) {
  const mapping = enggMathModel.graphMapping(object);

  if (!mapping) {
    return null;
  }

  const { definitions, options } = styleOf(object);
  const geometry = object.geometry || {};
  const frame = mapping.frame;

  const commands = [];

  /* The box. */
  commands.push(
    `\\draw[${options.join(", ")}] ${point(frame.position.x, frame.position.y)} rectangle ${point(
      frame.position.x + frame.width,
      frame.position.y + frame.height,
    )};`,
  );

  const gridOptions = [...options, "dashed", "line width=0.2pt"];

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

  if (geometry.showGrid !== false) {
    xTicks.forEach((value) => {
      const at = enggMathModel.graphToDrawing(object, {
        x: value,
        y: mapping.limits.yMin,
      });

      if (at) {
        commands.push(line(at, { x: at.x, y: mapping.top }, gridOptions));
      }
    });

    yTicks.forEach((value) => {
      const at = enggMathModel.graphToDrawing(object, {
        x: mapping.limits.xMin,
        y: value,
      });

      if (at) {
        commands.push(line(at, { x: mapping.right, y: at.y }, gridOptions));
      }
    });
  }

  if (geometry.showXAxis !== false) {
    commands.push(
      line(
        { x: mapping.left, y: mapping.origin.y },
        { x: mapping.right, y: mapping.origin.y },
        options,
      ),
    );
  }

  if (geometry.showYAxis !== false) {
    commands.push(
      line(
        { x: mapping.origin.x, y: mapping.bottom },
        { x: mapping.origin.x, y: mapping.top },
        options,
      ),
    );
  }

  if (geometry.showTickLabels !== false) {
    xTicks.forEach((value) => {
      const at = enggMathModel.graphToDrawing(object, { x: value, y: 0 });

      if (at && Math.abs(value) > 1e-9) {
        commands.push(
          node({ x: at.x, y: at.y - 1.5 }, num(value), {
            anchor: "north",
            size: 7,
          }),
        );
      }
    });

    yTicks.forEach((value) => {
      const at = enggMathModel.graphToDrawing(object, { x: 0, y: value });

      if (at && Math.abs(value) > 1e-9) {
        commands.push(
          node({ x: at.x - 1.5, y: at.y }, num(value), {
            anchor: "east",
            size: 7,
          }),
        );
      }
    });
  }

  if (String(geometry.xLabel ?? "").trim()) {
    commands.push(
      node(
        { x: mapping.right + 2, y: mapping.origin.y },
        texText(geometry.xLabel),
        { anchor: "west", size: 9 },
      ),
    );
  }

  if (String(geometry.yLabel ?? "").trim()) {
    commands.push(
      node(
        { x: mapping.origin.x, y: mapping.top + 2 },
        texText(geometry.yLabel),
        { anchor: "south", size: 9 },
      ),
    );
  }

  /*
   * THE FUNCTIONS, EACH AS ITS OWN METADATA LINE AND ITS OWN PATHS.
   *
   * A function's line names its component id, so a tangent that references
   * `function-2` still finds it after a reload - and its expression, variable,
   * domain and visibility, which the geometry cannot state.
   */
  enggMathModel.plotFunctions(object).forEach((component) => {
    const componentOptions = component.style?.stroke
      ? styleOf({ style: component.style }).options
      : options;

    if (
      component.showOriginalTrace === true &&
      Array.isArray(component.originalTrace) &&
      component.originalTrace.length > 1
    ) {
      commands.push(
        pathThrough(component.originalTrace, [
          ...componentOptions,
          "dashed",
          "line width=0.2pt",
        ]),
      );
    }

    enggMathModel.plotFunctionStrokes(object, component).forEach((stroke) => {
      const drawn = pathThrough(stroke, componentOptions);

      if (drawn) {
        commands.push(drawn);
      }
    });

    commands.push(
      meta(
        "FUNCTION",
        settingsLine([
          ["id", component.id],
          ["mode", component.mode === "plot" ? "plot" : "sketch"],
          ["expression", `"${String(component.expression ?? "")}"`],
          ["variable", component.variable || "x"],
          ["domain", `${num(component.domain?.min)}:${num(component.domain?.max)}`],
          ["visible", component.visible === false ? "off" : "on"],
          ["fit", component.fitType || "none"],
          ["fitExpression", `"${String(component.fitExpression ?? "")}"`],
        ]),
      ),
    );
  });

  return withDefinitions(definitions, [
    meta(
      "MATH",
      settingsLine([
        ["kind", "plot"],
        ["mode", geometry.mode === "sketch" ? "sketch" : "plot"],
        ["x", num(frame.position.x)],
        ["y", num(frame.position.y)],
        ["w", num(frame.width)],
        ["h", num(frame.height)],
        ["xmin", num(mapping.limits.xMin)],
        ["xmax", num(mapping.limits.xMax)],
        ["ymin", num(mapping.limits.yMin)],
        ["ymax", num(mapping.limits.yMax)],
        ["xtick", geometry.xTickSpacing ?? ""],
        ["ytick", geometry.yTickSpacing ?? ""],
        ["grid", geometry.showGrid !== false ? "on" : "off"],
        ["equal", geometry.equalUnits !== false ? "on" : "off"],
      ]),
    ),
    ...commands,
  ]);
}

/* ============================================================
 * EQUATION
 * ============================================================ */

function serializeEquation(object) {
  const geometry = object.geometry || {};
  const engineering = object.engineering || {};

  if (!validPoint(geometry.position)) {
    return null;
  }

  const content = String(engineering.content ?? "").trim();

  if (!content) {
    return null;
  }

  const { definitions, options } = styleOf(object);

  const colour =
    options
      .find((option) => option.startsWith("draw="))
      ?.replace("draw=", "") || "black";

  const anchor =
    engineering.align === "left"
      ? "west"
      : engineering.align === "right"
        ? "east"
        : "center";

  const size = finite(engineering.fontSize, 16) * 0.5;

  const lines = content.split("\n");

  const body =
    lines.length > 1
      ? lines.map((lineText) => `$${lineText}$`).join(" \\\\ ")
      : `$${content}$`;

  const command = `\\node[anchor=${anchor}, text=${colour}, align=${engineering.align || "center"}, font=\\fontsize{${num(size, 2)}}{${num(size * 1.25, 2)}}\\selectfont] at ${point(
    geometry.position.x,
    geometry.position.y,
  )} {${body}};`;

  return withDefinitions(definitions, [
    meta(
      "MATH",
      settingsLine([
        ["kind", "equation"],
        ["x", num(geometry.position.x)],
        ["y", num(geometry.position.y)],
        ["size", num(engineering.fontSize, 16)],
        ["align", engineering.align || "center"],
        ["display", engineering.displayMode || "display"],
      ]),
    ),
    command,
  ]);
}

/* ============================================================
 * TANGENT / NORMAL
 * ============================================================ */

function serializeTangent(object) {
  const geometry = object.geometry || {};

  if (!validPoint(geometry.start) || !validPoint(geometry.end)) {
    return null;
  }

  const { definitions, options } = styleOf(object);
  const engineering = object.engineering || {};

  const commands = [line(geometry.start, geometry.end, options)];

  if (validPoint(geometry.contact)) {
    commands.push(
      `\\fill[${options.find((option) => option.startsWith("draw="))?.replace("draw=", "") || "black"}] ${point(
        geometry.contact.x,
        geometry.contact.y,
      )} circle[radius=0.6];`,
    );
  }

  return withDefinitions(definitions, [
    meta(
      "MATH",
      settingsLine([
        ["kind", "tangent"],
        ["type", engineering.constructionType || "tangent"],
        ["mode", engineering.mode || "sketch"],
        ["curve", geometry.parentCurveId || ""],
        ["cx", num(geometry.contact?.x)],
        ["cy", num(geometry.contact?.y)],
        ["length", num(geometry.length)],
      ]),
    ),
    ...commands,
  ]);
}

/* ============================================================
 * SLOPE TRIANGLE
 * ============================================================ */

function serializeSlopeTriangle(object) {
  const geometry = object.geometry || {};
  const triangle = enggMathModel.slopeTriangleGeometry(
    geometry.start,
    geometry.end,
  );

  if (!triangle) {
    return null;
  }

  const { definitions, options } = styleOf(object);
  const engineering = object.engineering || {};

  const commands = [
    pathThrough([triangle.start, triangle.corner, triangle.end], options, {
      closed: true,
    }),
  ];

  if (engineering.showRightAngle !== false) {
    const size = 1.5;

    const alongRun = {
      x:
        triangle.corner.x +
        (triangle.start.x > triangle.corner.x ? size : -size),
      y: triangle.corner.y,
    };
    const alongRise = {
      x: triangle.corner.x,
      y:
        triangle.corner.y + (triangle.end.y > triangle.corner.y ? size : -size),
    };

    commands.push(
      pathThrough(
        [alongRun, { x: alongRun.x, y: alongRise.y }, alongRise],
        options,
      ),
    );
  }

  const labels = [];

  if (engineering.showRun !== false) {
    labels.push(`run = ${num(triangle.run)}`);
  }

  if (engineering.showRise !== false) {
    labels.push(`rise = ${num(triangle.rise)}`);
  }

  if (engineering.showSlope === true && triangle.slope !== null) {
    labels.push(`m = ${num(triangle.slope)}`);
  }

  if (labels.length) {
    commands.push(
      node(
        {
          x: (triangle.start.x + triangle.end.x) / 2,
          y: (triangle.start.y + triangle.end.y) / 2 + 2,
        },
        texText(labels.join("   ")),
        { anchor: "south", size: 8 },
      ),
    );
  }

  return withDefinitions(definitions, [
    meta(
      "MATH",
      settingsLine([
        ["kind", "slope-triangle"],
        ["mode", engineering.mode || "sketch"],
        ["line", geometry.parentLineId || ""],
        ["x1", num(triangle.start.x)],
        ["y1", num(triangle.start.y)],
        ["x2", num(triangle.end.x)],
        ["y2", num(triangle.end.y)],
        ["rise", engineering.showRise !== false ? "on" : "off"],
        ["run", engineering.showRun !== false ? "on" : "off"],
        ["slope", engineering.showSlope === true ? "on" : "off"],
      ]),
    ),
    ...commands,
  ]);
}

/* ============================================================
 * THE WRITER
 * ============================================================ */

const SERIALIZERS = {
  "math-point": serializePoint,
  "math-vector": serializeVector,
  "math-plot": serializePlot,
  "math-equation": serializeEquation,
  "math-tangent": serializeTangent,
  "math-slope-triangle": serializeSlopeTriangle,
};

export const MATH_SOURCE_TYPES = Object.freeze(Object.keys(SERIALIZERS));

export function isMathSourceType(type) {
  return Object.prototype.hasOwnProperty.call(SERIALIZERS, type);
}

export function mathSourceWriter(object) {
  if (!object || typeof object !== "object") {
    return null;
  }

  const serializer = SERIALIZERS[object.type];

  if (typeof serializer !== "function") {
    return null;
  }

  let written;

  try {
    written = serializer(object);
  } catch (error) {
    reportSourceGenerationProblem(
      object,
      `its ${object.type} drawing failed (${error && error.message})`,
    );

    return null;
  }

  if (typeof written !== "string" || !written.trim()) {
    return null;
  }

  const id = ensureObjectId(object, object.type);

  return applyObjectComments({ ...object, id }, written, { type: object.type });
}

export default {
  MATH_SOURCE_TYPES,
  isMathSourceType,
  mathSourceWriter,
};
