/*
 * ============================================================
 * THERMODYNAMICS SOURCE WRITER
 * ============================================================
 *
 * The thermodynamics features are drawn on the canvas by four small renderers
 * (entities/draw-thermodynamics.js). Each is a picture composed from the
 * object's own stored geometry, and each is written here from the SAME model
 * functions the canvas calls - so the compiled picture and the canvas cannot
 * show different domes, different piston heights or different state numbers.
 *
 *   control-volume     a rectangle, plus the process overlay when it carries one
 *   saturation-curve   the dome: its axis, its tips and its two branches
 *   process-path       the stored polyline, its numbered states and its arrows
 *   piston-cylinder    the walls, the piston, the rod and the stoppers
 *
 * The kinds are read from `object.metadata.thermodynamicsKind`, which is what
 * the model and the canvas both use to recognise them; the storage type of the
 * first two is `rectangle`, so the writer is installed for that type as well -
 * and it declines an ordinary rectangle, which the Geometry writer owns.
 */

import { num, point, texText } from "./statics-primitives.js";
import { applyObjectComments, ensureObjectId } from "../object-comments.js";
import * as pistonCylinder from "../../../../features/workspace/model/thermodynamics/piston-cylinder.js";
import { tankPaths } from "../../../../features/workspace/model/thermodynamics/tank.js";
import { turbineCompressorPoints } from "../../../../features/workspace/model/thermodynamics/turbine-compressor.js";
import { nozzleDiffuserPaths } from "../../../../features/workspace/model/thermodynamics/nozzle-diffuser.js";
import { rankineCycleDiagram } from "../../../../features/workspace/model/thermodynamics/rankine-cycle.js";
import * as saturationCurve from "../../../../features/workspace/model/thermodynamics/saturation-curve.js";
import * as processLabels from "../../../../features/workspace/model/thermodynamics/process-labels.js";
import * as processCurves from "../../../../features/workspace/model/thermodynamics/process-curves.js";
import enggTheme from "../../../../components/layout/workspace/theme.js";

function finite(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
}

function normaliseHex(value) {
  const match = String(value ?? "").trim().match(/^#([0-9a-fA-F]{6})$/);

  return match ? match[1].toUpperCase() : null;
}

function colourNameOf(value) {
  const text = String(value ?? "").trim();

  if (!text || /^none$/i.test(text)) {
    return null;
  }

  const hex = normaliseHex(text);

  if (!hex) {
    return text;
  }

  return hex === "000000" ? "black" : hex === "FFFFFF" ? "white" : `daetumC${hex}`;
}

function colourOf(object) {
  const theme = enggTheme;

  return (
    colourNameOf(object?.style?.stroke) ||
    colourNameOf(theme && typeof theme.defaultLineColour === "function" ? theme.defaultLineColour() : null) ||
    "black"
  );
}

function preludeOf(object) {
  const hex = normaliseHex(object?.style?.stroke);

  return hex && hex !== "000000" && hex !== "FFFFFF" ? [`\\definecolor{daetumC${hex}}{HTML}{${hex}}`] : [];
}

function withPrelude(object, body) {
  if (!body) {
    return null;
  }

  const definitions = preludeOf(object);

  return definitions.length ? `${definitions.join("\n")}\n${body}` : body;
}

/* A polyline through world points. */
function polyline(points, colour, options = []) {
  const usable = (points || []).filter(
    (at) => at && Number.isFinite(Number(at.x)) && Number.isFinite(Number(at.y))
  );

  if (usable.length < 2) {
    return null;
  }

  const body = usable
    .map((at, index) => `${index === 0 ? "" : "-- "}${point(finite(at.x), finite(at.y))}`)
    .join(" ");

  return `\\draw[${[colour, ...options].join(", ")}] ${body};`;
}

function closedPath(points, colour, options = []) {
  const usable = (points || []).filter(
    (at) => at && Number.isFinite(Number(at.x)) && Number.isFinite(Number(at.y))
  );

  if (usable.length < 2) {
    return null;
  }

  const body = usable
    .map((at, index) => `${index === 0 ? "" : "-- "}${point(finite(at.x), finite(at.y))}`)
    .join(" ");

  return `\\draw[${[colour, ...options].join(", ")}] ${body}${usable.length > 2 ? " -- cycle" : ""};`;
}

/* The object's line type as TikZ dash options, as the canvas draws it. */
function dashOptionsOf(object) {
  const type = String(object?.style?.lineType || "solid").toLowerCase();

  if (type === "dashed" || type === "construction") {
    return ["dashed"];
  }

  if (type === "dotted") {
    return ["dotted"];
  }

  if (type === "center" || type === "centre") {
    return ["dash dot"];
  }

  return [];
}

/* ------------------------------------------------------------------ kinds */

/*
 * THE CYLINDER MODULE, REACHED BY NAME.
 *
 * These three modules are loaded by the application itself, and importing them
 * here would create a second instance of each: the model would build a dome with
 * one and this writer would draw it with another, and the two would silently be
 * allowed to drift. The published objects are the loaded ones.
 */
/*
 * THE MODEL'S OWN GEOMETRY, IMPORTED. These were read from `globalThis.engg...`
 * handles that nothing ever published, so every piston-cylinder, saturation
 * curve and process label wrote no source at all and never reached the picture.
 */
function cylinderModule() {
  return pistonCylinder;
}

function saturationModule() {
  return saturationCurve;
}

function processLabelsModule() {
  return processLabels;
}

/* The geometry module's own corner transform, through the published object. */
function cylinderPointOf(geometry, x, y) {
  const module = cylinderModule();

  return module && typeof module.cylinderPoint === "function"
    ? module.cylinderPoint(geometry, x, y)
    : null;
}

function serializeCylinder(object) {
  const module = cylinderModule();

  if (!module || typeof module.pistonFraction !== "function") {
    return null;
  }

  const geometry = object.geometry || {};
  const colour = colourOf(object);
  const level = module.pistonFraction(geometry);
  const thickness = Math.min(0.04, level / 2);

  const paths = [
    [[0, 1], [0, 0], [1, 0], [1, 1]],
    [[0, level], [1, level], [1, level - thickness], [0, level - thickness], [0, level]],
    [[0.5, level], [0.5, 1]],
    ...(typeof module.stopperPaths === "function" ? module.stopperPaths(geometry) : [])
  ];

  const commands = paths
    .map((path) =>
      polyline(
        path.map(([x, y]) => cylinderPointOf(geometry, x, y)),
        colour
      )
    )
    .filter(Boolean);

  return withPrelude(object, commands.join("\n"));
}

function serializeSaturation(object) {
  const dome = saturationModule();

  if (!dome || typeof dome.processDiagramPaths !== "function") {
    return null;
  }

  const geometry = object.geometry || {};
  const colour = colourOf(object);

  const commands = [];

  /* A saturation curve is the axes and the dome; a process plot is the axes alone. */
  dome.processDiagramPaths(geometry, object).forEach((path, index) => {
    /*
     * THE AXIS AND THE DOME, and the two arrow tips on the axes. The paths are
     * the model's own - the same cubic the canvas draws - so the compiled dome
     * is the shape on the sheet.
     */
    const body = polyline(path, colour, index === 1 || index === 2 ? ["fill=" + colour, "line width=0.3pt"] : []);

    if (body) {
      commands.push(body);
    }
  });

  const labels = [
    ["yLabel", 0.04, 0.94, "east"],
    ["xLabel", 0.98, 0.02, "west"]
  ];

  labels.forEach(([key, x, y, anchor]) => {
    const text = String(geometry[key] || "");

    if (!text.trim()) {
      return;
    }

    const at = cylinderPointOf(geometry, x, y);

    if (!at) {
      return;
    }

    commands.push(`\\node[anchor=${anchor}, text=${colour}] at ${point(finite(at.x), finite(at.y))} {${texText(text)}};`);
  });

  return withPrelude(object, commands.filter(Boolean).join("\n"));
}

function serializeProcessPath(object, options) {
  const geometry = object.geometry || {};
  const colour = colourOf(object);

  const points = (Array.isArray(geometry.points) ? geometry.points : []).filter(
    (at) => at && Number.isFinite(Number(at.x)) && Number.isFinite(Number(at.y))
  );

  if (points.length < 2) {
    return null;
  }

  const commands = [];

  /*
   * A BENT SEGMENT IS DRAWN CURVED, through the same points the canvas draws -
   * `processPathPoints` follows each segment's own bend.
   */
  const drawn = processCurves.processPathPoints({ ...geometry, points });
  const path = polyline(drawn.length >= 2 ? drawn : points, colour, ["line width=1.1pt"]);

  if (path) {
    commands.push(path);
  }

  /*
   * THE DIRECTION AND THE STATE NUMBERS come from the stored path and the
   * student's own label offsets, through the model's `processLabelPoint`. A
   * state the student placed is numbered where they placed it.
   */
  /*
   * `processLabelPoint` takes a pixels-per-unit to turn its default 13 px
   * offset into drawing units. The source is written in drawing units, so it
   * is 1 - the value the retired Vector Scale used to pass here by default.
   */
  const scale = 1;

  points.forEach((at, index) => {
    if (index >= finite(object.metadata?.stateCount, points.length)) {
      return;
    }

    commands.push(`\\fill[${colour}] ${point(finite(at.x), finite(at.y))} circle[radius=0.5];`);

    let labelAt;

    try {
      const labels = processLabelsModule();

      labelAt = labels && typeof labels.processLabelPoint === "function"
        ? labels.processLabelPoint(geometry, index, scale)
        : null;
    } catch {
      labelAt = null;
    }

    const placed = labelAt || { x: finite(at.x) + 3, y: finite(at.y) + 3 };

    commands.push(
      `\\node[anchor=center, text=${colour}] at ${point(finite(placed.x), finite(placed.y))} {${num(index + 1, 0)}};`
    );

    if (index > 0) {
      /*
       * THE ARROW SITS ON THE SEGMENT'S MIDDLE and points along it there - on a
       * bent segment that is the curve's middle, as the canvas draws it.
       */
      const segment = processCurves.processSegmentPoints({ ...geometry, points }, index - 1);
      const middle = Math.floor(segment.length / 2);
      const previous = segment.length > 2 ? segment[middle - 1] : points[index - 1];
      const next = segment.length > 2 ? segment[middle + 1] : at;
      const mid = segment.length > 2
        ? segment[middle]
        : { x: (finite(at.x) + finite(previous.x)) / 2, y: (finite(at.y) + finite(previous.y)) / 2 };
      const dx = finite(next.x) - finite(previous.x);
      const dy = finite(next.y) - finite(previous.y);
      const length = Math.hypot(dx, dy);

      if (length > 1e-9) {
        commands.push(
          `\\draw[${colour}, fill=${colour}] (${num(finite(mid.x) + (dx / length))},${num(
            finite(mid.y) + (dy / length)
          )}) -- ++(${num((-dx / length) * 2)},${num((-dy / length) * 2)}) -- ++(${num(
            (-dy / length) * 1.2
          )},${num((dx / length) * 1.2)}) -- cycle;`
        );
      }
    }
  });

  return withPrelude(object, commands.filter(Boolean).join("\n"));
}

function serializeControlVolume(object) {
  const geometry = object.geometry || {};
  const colour = colourOf(object);

  /*
   * The frame is the model's own corners - `position` is the top-left and the
   * box runs down from it - so a rotated control volume is drawn rotated.
   */
  const frame = [[0, 1], [1, 1], [1, 0], [0, 0]]
    .map(([x, y]) => cylinderPointOf(geometry, x, y))
    .filter(Boolean);

  if (frame.length !== 4) {
    return null;
  }

  return withPrelude(object, closedPath(frame, colour, dashOptionsOf(object)));
}

/* ------------------------------------------------------------------ routes */

export function thermodynamicsKindOf(object) {
  const declared = object?.metadata?.thermodynamicsKind;

  if (typeof declared === "string" && declared) {
    return declared;
  }

  if (object?.type === "piston-cylinder") {
    return "piston-cylinder";
  }

  if (object?.type === "saturation-curve") {
    return "saturation-curve";
  }

  if (object?.type === "control-volume") {
    return "control-volume";
  }

  if (object?.type === "process-path") {
    return "process-path";
  }

  return null;
}

/*
 * THE THERMODYNAMICS FEATURES STORED AS RECTANGLES. Each is a rectangle with a
 * `thermodynamicsKind`, so this writer must claim it before the geometry writer
 * draws it as a bare box.
 */
const RECTANGLE_KINDS = new Set(["rankine-cycle", "nozzle-diffuser", "turbine-compressor", "tank", "control-volume", "saturation-curve", "process-plot", "piston-cylinder"]);

export function thermodynamicsSourceWriter(object, options = {}) {
  if (!object || typeof object !== "object") {
    return null;
  }

  const kind = thermodynamicsKindOf(object);

  if (!kind) {
    return null;
  }

  /*
   * A RECTANGLE IS THE GEOMETRY WRITER'S unless it says it is a thermodynamics
   * feature. Recognition is the metadata, exactly as the canvas's renderer
   * table does it.
   */
  if ((object.type === "rectangle" || object.type === "control-volume") && !RECTANGLE_KINDS.has(kind)) {
    return null;
  }

  const written =
    kind === "rankine-cycle" ? (() => {
      const diagram = rankineCycleDiagram(object.geometry, object.metadata?.problemData);
      return [
        ...diagram.paths.map(path => polyline(path.points, path.colour, [
          ...(path.fill ? [`fill=${path.fill}`] : []),
          ...(path.bold ? ["line width=1.4pt", "line cap=round", "line join=round"] : [])
        ])),
        ...diagram.labels.map(label => `\\node[anchor=center, text=black, inner sep=0pt] at ${point(label.point.x, label.point.y)} {${!label.plainText && label.latex.startsWith("$") ? label.latex : texText(label.text)}};`)
      ].join("\n");
    })()
    : kind === "turbine-compressor" ? withPrelude(object, polyline(turbineCompressorPoints(object.geometry), colourOf(object)))
    : kind === "nozzle-diffuser" ? withPrelude(object, nozzleDiffuserPaths(object.geometry).map(path => polyline(path, colourOf(object))).join("\n"))
    : kind === "tank" ? withPrelude(object, tankPaths(object.geometry).map(path => polyline(path, colourOf(object))).join("\n"))
    : kind === "saturation-curve" || kind === "process-plot"
      ? serializeSaturation(object)
      : kind === "piston-cylinder"
        ? serializeCylinder(object)
        : kind === "process-path"
          ? serializeProcessPath(object, options)
          : kind === "control-volume"
            ? serializeControlVolume(object)
            : null;

  if (typeof written !== "string" || !written.trim()) {
    return null;
  }

  /*
   * ONE HEADER PER FEATURE, above the several primitives a cylinder or a
   * saturation curve is made of - so the whole symbol is one object's source.
   */
  const id = ensureObjectId(object, object.type);

  return applyObjectComments({ ...object, id }, written, { type: object.type });
}

export const THERMODYNAMICS_SOURCE_TYPES = Object.freeze([
  "control-volume",
  "saturation-curve",
  "piston-cylinder",
  "process-path",
  "rectangle"
]);

export default {
  THERMODYNAMICS_SOURCE_TYPES,
  thermodynamicsKindOf,
  thermodynamicsSourceWriter
};
