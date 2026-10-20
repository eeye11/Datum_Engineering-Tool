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
  const theme = globalThis.enggTheme;

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

/* ------------------------------------------------------------------ kinds */

/*
 * THE CYLINDER MODULE, REACHED BY NAME.
 *
 * These three modules are loaded by the application itself, and importing them
 * here would create a second instance of each: the model would build a dome with
 * one and this writer would draw it with another, and the two would silently be
 * allowed to drift. The published objects are the loaded ones.
 */
function cylinderModule() {
  return globalThis.enggPistonCylinder || null;
}

function saturationModule() {
  return globalThis.enggSaturationCurve || null;
}

function processLabelsModule() {
  return globalThis.enggProcessLabels || null;
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

  if (!dome || typeof dome.saturationPaths !== "function") {
    return null;
  }

  const geometry = object.geometry || {};
  const colour = colourOf(object);

  const commands = [];

  dome.saturationPaths(geometry).forEach((path, index) => {
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

  const path = polyline(points, colour, ["line width=1.1pt"]);

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

    let labelAt = null;

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
      const previous = points[index - 1];
      const dx = finite(at.x) - finite(previous.x);
      const dy = finite(at.y) - finite(previous.y);
      const length = Math.hypot(dx, dy);

      if (length > 1e-9) {
        commands.push(
          `\\draw[${colour}, fill=${colour}] (${num((finite(at.x) + finite(previous.x)) / 2)},${num(
            (finite(at.y) + finite(previous.y)) / 2
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

  const frame = [
    { x: finite(geometry.position?.x), y: finite(geometry.position?.y) },
    { x: finite(geometry.position?.x) + finite(geometry.width), y: finite(geometry.position?.y) },
    {
      x: finite(geometry.position?.x) + finite(geometry.width),
      y: finite(geometry.position?.y) + finite(geometry.height)
    },
    { x: finite(geometry.position?.x), y: finite(geometry.position?.y) + finite(geometry.height) }
  ];

  return withPrelude(object, closedPath(frame, colour));
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
  if ((object.type === "rectangle" || object.type === "control-volume") && kind !== "control-volume") {
    return null;
  }

  if (kind === "saturation-curve") {
    return serializeSaturation(object);
  }

  if (kind === "piston-cylinder") {
    return serializeCylinder(object);
  }

  if (kind === "process-path") {
    return serializeProcessPath(object, options);
  }

  if (kind === "control-volume") {
    return serializeControlVolume(object);
  }

  return null;
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
