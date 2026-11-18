/*
 * ============================================================
 * THE HEAT TRANSFER OBJECTS AS TIKZ
 * ============================================================
 *
 * The source writer for the Heat Transfer workspace. Every Heat Transfer
 * object is written in DAETUM's existing LaTeX/TikZ-like source architecture -
 * the same primitives the Statics and Fluids writers use - so the compiled
 * picture is the shape the canvas draws, and the Source tab, the saved file
 * and the sheet cannot disagree.
 *
 * Coordinates are drawing units, y up, like every other writer.
 *
 * ============================================================
 * THE GEOMETRY IS READ FROM THE MODEL, NEVER RESPECIFIED
 * ============================================================
 *
 * A Wall / Slab's two parallel lines, a Composite Wall's dividers, a
 * boundary's generated decorations and a radiation path's wave all come from
 * the model's own resolvers - the SAME ones the canvas renderer reads - so
 * the source is a statement of the drawn object, not a second description of
 * it. Editing the object edits both.
 *
 * A Heat Transfer object keeps its identity: the writer returns the object's
 * commands under its own type, with its variant recorded in a comment, so the
 * source stays readable and a round trip through the editor preserves it.
 */

import { point, splitPrelude, styleOptions } from "./statics-primitives.js";
import { applyObjectComments, ensureObjectId } from "../object-comments.js";
import enggHeatModel from "../../../../features/workspace/model/heat-transfer/heat-model.js";
import {
  radiationWaveSamples,
  streamlineSegments,
} from "../../entities/draw-heat-transfer.js";
import {
  DEFAULT_MARKER_RADIUS,
  DEFAULT_NODE_RADIUS,
  DEFAULT_SYMBOL_HALF,
  arrowHead,
  finiteNumber,
  finitePoint,
  normalOf,
  unitVector,
} from "../../../../features/workspace/model/heat-transfer/heat-shared.js";

function number(value) {
  const rounded = Number(Number(value).toFixed(4));

  return Number.isFinite(rounded) ? String(rounded) : "0";
}

function line(from, to, options) {
  return `\\draw[${options.join(", ")}] ${point(Number(from.x), Number(from.y))} -- ${point(Number(to.x), Number(to.y))};`;
}

function styleOf(object) {
  /*
   * THE OBJECT'S OWN STYLE, NOT A FORCED ONE.
   *
   * The Features tab offers line type, colour, thickness and fill, so the
   * writer states what the object actually has - a dashed control volume or a
   * filled region compiles as itself, not as a default.
   */
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

/* A closed polygon through world points. */
function closedPath(points, options) {
  const path = points
    .filter(finitePoint)
    .map((p) => point(p.x, p.y))
    .join(" -- ");

  /*
   * A CLOSED PATH IS `-- cycle`. Whether it is filled is decided by the
   * style's own fill options (`fill=<colour>`), so the path statement itself
   * does not repeat that choice.
   */
  return `\\draw[${options.join(", ")}] ${path} -- cycle;`;
}

/* An open polyline through world points. */
function openPath(points, options) {
  const path = points
    .filter(finitePoint)
    .map((p) => point(p.x, p.y))
    .join(" -- ");

  return `\\draw[${options.join(", ")}] ${path};`;
}

/*
 * THE STROKE WEIGHT OF AN OBJECT'S STYLE, in the drawing units the head is
 * sized from. Mirrors the canvas renderer's resolver so the written head and
 * the drawn head are the same size.
 */
function drawingStrokeWeight(object) {
  const stored = object?.style?.lineWidth;

  if (typeof stored === "number" && Number.isFinite(stored) && stored > 0) {
    return stored;
  }

  const presets = {
    "ultra-thin": 0.2,
    "very-thin": 0.3,
    thin: 0.4,
    "semi-thick": 0.6,
    thick: 1,
    "very-thick": 1.5,
    "ultra-thick": 2.5,
  };

  const named = typeof stored === "string" ? presets[stored.trim().toLowerCase()] : null;

  return Number.isFinite(named) ? named : 0.4;
}

/*
 * An arrowhead, written as a small FILLED triangle at the tip.
 *
 * Sized from the line weight (`strokeWidth`), NOT the path's length, bounded by
 * the path so a short one cannot be overrun - the same rule the canvas painter
 * follows, so the compiled picture and the sheet agree about the head.
 */
function arrowHeadCommand(tip, direction, strokeWidth, boundLength, options) {
  const head = arrowHead(tip, direction, strokeWidth, boundLength);

  if (!head) {
    return null;
  }

  return `\\draw[${options.join(", ")}, fill] ${point(head.barbFirst.x, head.barbFirst.y)} -- ${point(head.tip.x, head.tip.y)} -- ${point(head.barbSecond.x, head.barbSecond.y)} -- cycle;`;
}

/*
 * A CONVECTION FLOW, as one TikZ path of cubic Beziers.
 *
 * It is generated by the SAME `streamlineSegments` the canvas painter uses, so
 * the compiled picture and the sheet are the same centripetal Catmull-Rom
 * streamline - they cannot drift apart into two spline implementations.
 */
function convectionPathCommand(points, options) {
  const segments = streamlineSegments(points);

  if (!segments.length) {
    return null;
  }

  const at = (p) => point(p.x, p.y);

  const parts = [`${at(segments[0].start)}`];

  segments.forEach((segment) => {
    parts.push(
      `.. controls ${at(segment.control1)} and ${at(segment.control2)} .. ${at(segment.end)}`,
    );
  });

  return `\\draw[${options.join(", ")}] ${parts.join(" ")};`;
}


/* ============================================================
 * THE SERIALIZERS
 * ============================================================ */

function serializeRegion(object) {
  const corners = enggHeatModel.regionCorners(object);

  if (!corners || corners.length < 4) {
    return null;
  }

  const { definitions, options } = styleOf(object);

  return withDefinitions(definitions, [
    closedPath(corners, options, object.style?.fillMode === "solid"),
  ]);
}

function serializeWallSlab(object) {
  const lines = enggHeatModel.wallSlabLines(object);

  if (!lines) {
    return null;
  }

  const { definitions, options } = styleOf(object);

  /*
   * TWO PARALLEL LINES, AND NOTHING ELSE - the Wall / Slab is the opposing
   * surfaces of a simplified wall, and the source says exactly that.
   */
  return withDefinitions(
    definitions,
    lines.map((boundary) => line(boundary.start, boundary.end, options)),
  );
}

function serializeCompositeWall(object) {
  const geometry = enggHeatModel.compositeWallGeometry(object);

  if (!geometry) {
    return null;
  }

  const { definitions, options } = styleOf(object);

  const commands = [
    closedPath(geometry.corners, options, object.style?.fillMode === "solid"),
  ];

  geometry.dividers.forEach((divider) => {
    commands.push(line(divider.start, divider.end, options));
  });

  return withDefinitions(definitions, commands);
}

function serializeFin(object) {
  const geometry = enggHeatModel.finGeometry(object);

  if (!geometry) {
    return null;
  }

  const { definitions, options } = styleOf(object);

  return withDefinitions(definitions, [
    closedPath(geometry.corners, options, object.style?.fillMode === "solid"),
  ]);
}

function serializeHeatPath(object) {
  const points = (object.geometry?.points || []).filter(finitePoint);

  if (points.length < 2) {
    return null;
  }

  const { definitions, options } = styleOf(object);
  const variant = enggHeatModel.variantOf(object);
  const ordered = object.geometry?.reversed ? [...points].reverse() : points;

  const commands = [];

  /*
   * THE WAVE'S OWN END, so the head is placed ON the wave.
   *
   * From the SAME `radiationWaveSamples` the canvas painter uses, so the
   * written head and the drawn head sit on the same point of the same wave -
   * not on the route's endpoint, which the wave has left by its amplitude.
   */
  let radiationEnd = null;

  if (variant === "radiation") {
    /* The generated wave, from the ONE shared generator. */
    const samples = radiationWaveSamples(ordered);

    commands.push(openPath(samples, options));

    if (samples.length >= 2) {
      const tip = samples[samples.length - 1];
      const waveDirection = unitVector(samples[samples.length - 2], tip);

      if (waveDirection) {
        radiationEnd = { tip: { x: tip.x, y: tip.y }, direction: waveDirection };
      }
    }
  } else if (variant === "convection") {
    /*
     * THE CONVECTION FLOW: the student's exact route with ROUNDED CORNERS, the
     * same rounded-corner streamline the canvas draws (`streamlineSegments`).
     * It is NOT a spline through the points: straight runs stay straight and the
     * only curvature is a small bound at each corner.
     */
    commands.push(convectionPathCommand(ordered, options));
  } else {
    /* CONDUCTION: the straight connected segments, exactly as drawn. */
    commands.push(openPath(ordered, options));
  }

  const last = ordered[ordered.length - 1];
  const previous = ordered[ordered.length - 2];

  /*
   * THE HEAD'S ANCHOR AND DIRECTION, BY VARIANT - exactly as on canvas:
   *
   *   RADIATION   on the WAVE's own last sample, along the wave's final travel.
   *   CONVECTION  on the route's end, along the curve's end tangent.
   *   CONDUCTION  on the route's end, along the final chord.
   */
  const headAnchor = radiationEnd ? radiationEnd.tip : last;

  const direction = radiationEnd
    ? radiationEnd.direction
    : variant === "convection"
      ? (() => {
          const segments = streamlineSegments(ordered);
          const lastCurve = segments[segments.length - 1];

          return lastCurve ? unitVector(lastCurve.control2, lastCurve.end) : null;
        })()
      : unitVector(previous, last);

  if (direction) {
    /* Bounded by the FINAL SEGMENT, sized by the line weight - as on canvas. */
    const finalSegment = Math.hypot(last.x - previous.x, last.y - previous.y);

    commands.push(
      arrowHeadCommand(
        headAnchor,
        direction,
        drawingStrokeWeight(object),
        finalSegment,
        options,
      ),
    );
  }

  return withDefinitions(definitions, commands);
}

function serializeThermalArrow(object) {
  const start = object.geometry?.start;
  const end = object.geometry?.end;

  if (!finitePoint(start) || !finitePoint(end)) {
    return null;
  }

  const { definitions, options } = styleOf(object);
  const ordered = object.geometry?.reversed
    ? { from: end, to: start }
    : { from: start, to: end };
  const direction = unitVector(ordered.from, ordered.to);

  if (!direction) {
    return null;
  }

  const length = Math.hypot(
    ordered.to.x - ordered.from.x,
    ordered.to.y - ordered.from.y,
  );

  const commands = [
    line(ordered.from, ordered.to, options),
    arrowHeadCommand(
      ordered.to,
      direction,
      drawingStrokeWeight(object),
      length,
      options,
    ),
  ];

  return withDefinitions(definitions, commands);
}

function serializeThermalBoundary(object) {
  const start = object.geometry?.start;
  const end = object.geometry?.end;

  if (!finitePoint(start) || !finitePoint(end)) {
    return null;
  }

  const { definitions, options } = styleOf(object);

  const commands = [line(start, end, options)];

  /* The generated decorations, from the same resolver the canvas reads. */
  enggHeatModel.boundaryDecorations(object).forEach((mark) => {
    if (mark.kind === "arrow") {
      commands.push(line(mark.points[0], mark.points[1], options));
      commands.push(
        arrowHeadCommand(
          mark.tip,
          mark.direction,
          drawingStrokeWeight(object),
          DEFAULT_SYMBOL_HALF,
          options,
        ),
      );
    } else {
      commands.push(openPath(mark.points, options));
    }
  });

  return withDefinitions(definitions, commands);
}

function serializeThermalContact(object) {
  const start = object.geometry?.start;
  const end = object.geometry?.end;

  if (!finitePoint(start) || !finitePoint(end)) {
    return null;
  }

  const { definitions, options } = styleOf(object);

  return withDefinitions(definitions, [line(start, end, options)]);
}

function serializeSourceSink(object) {
  const center = object.geometry?.center;

  if (!finitePoint(center)) {
    return null;
  }

  const { definitions, options } = styleOf(object);
  const size = Math.max(
    1,
    finiteNumber(object.geometry?.size, DEFAULT_SYMBOL_HALF),
  );
  const rotation = (finiteNumber(object.geometry?.rotation, 0) * Math.PI) / 180;
  const axis = { x: Math.cos(rotation), y: Math.sin(rotation) };
  const variant = enggHeatModel.variantOf(object);

  const commands = [
    `\\draw[${options.join(", ")}] ${point(center.x, center.y)} circle[radius=${number(size)}];`,
  ];

  const reach = size * 2;

  if (variant === "sink") {
    const to = { x: center.x + axis.x * reach, y: center.y + axis.y * reach };

    commands.push(line(center, to, options));
    commands.push(
      arrowHeadCommand(to, axis, drawingStrokeWeight(object), reach, options),
    );
  } else {
    const from = { x: center.x - axis.x * reach, y: center.y - axis.y * reach };

    commands.push(line(from, center, options));
    commands.push(
      arrowHeadCommand(center, axis, drawingStrokeWeight(object), reach, options),
    );
  }

  return withDefinitions(definitions, commands);
}

function serializeCircuitNode(object) {
  const center = object.geometry?.center;

  if (!finitePoint(center)) {
    return null;
  }

  const { definitions, options } = styleOf(object);
  const radius = Math.max(
    0.5,
    finiteNumber(object.geometry?.radius, DEFAULT_NODE_RADIUS),
  );

  const commands = [
    `\\draw[${options.join(", ")}, fill] ${point(center.x, center.y)} circle[radius=${number(radius)}];`,
  ];

  return withDefinitions(definitions, commands);
}

function serializeCircuitElement(object) {
  const center = object.geometry?.center;

  if (!finitePoint(center)) {
    return null;
  }

  const { definitions, options } = styleOf(object);
  const size = Math.max(
    1,
    finiteNumber(object.geometry?.size, DEFAULT_SYMBOL_HALF),
  );
  const rotation = (finiteNumber(object.geometry?.rotation, 0) * Math.PI) / 180;
  const axis = { x: Math.cos(rotation), y: Math.sin(rotation) };
  const normal = normalOf(axis);
  const variant = enggHeatModel.variantOf(object);
  const ports = enggHeatModel.circuitElementPorts(object);

  if (!ports) {
    return null;
  }

  const at = (along, sideways) => ({
    x: center.x + axis.x * along + normal.x * sideways,
    y: center.y + axis.y * along + normal.y * sideways,
  });

  const commands = [
    line(ports.a, at(-size, 0), options),
    line(at(size, 0), ports.b, options),
  ];

  if (variant === "capacitance") {
    const gap = size * 0.3;
    const plate = size * 0.9;

    commands.push(line(at(-gap, -plate), at(-gap, plate), options));
    commands.push(line(at(gap, -plate), at(gap, plate), options));
  } else {
    const peaks = 6;
    const amplitude = size * 0.55;
    const points = [];

    for (let index = 0; index <= peaks; index += 1) {
      const along = -size + (2 * size * index) / peaks;
      const sideways =
        index === 0 || index === peaks
          ? 0
          : index % 2 === 0
            ? -amplitude
            : amplitude;

      points.push(at(along, sideways));
    }

    commands.push(openPath(points, options));
  }

  return withDefinitions(definitions, commands);
}

function serializeTemperatureMarker(object) {
  const center = object.geometry?.center;

  if (!finitePoint(center)) {
    return null;
  }

  const { definitions, options } = styleOf(object);
  const radius = Math.max(
    0.5,
    finiteNumber(object.geometry?.radius, DEFAULT_MARKER_RADIUS),
  );

  const commands = [
    `\\draw[${options.join(", ")}] ${point(center.x, center.y)} circle[radius=${number(radius)}];`,
    line(
      { x: center.x - radius, y: center.y },
      { x: center.x + radius, y: center.y },
      options,
    ),
    line(
      { x: center.x, y: center.y - radius },
      { x: center.x, y: center.y + radius },
      options,
    ),
  ];

  return withDefinitions(definitions, commands);
}

function serializeIsotherm(object) {
  const points = (object.geometry?.points || []).filter(finitePoint);

  if (points.length < 2) {
    return null;
  }

  const { definitions, options } = styleOf(object);

  const commands = [
    object.geometry?.closed
      ? closedPath(points, options, false)
      : openPath(points, options),
  ];

  return withDefinitions(definitions, commands);
}

function serializeControlVolume(object) {
  const corners = enggHeatModel.controlVolumeCorners(object);

  if (!corners || corners.length < 4) {
    return null;
  }

  const { definitions, options } = styleOf(object);

  /* The boundary is dashed by convention, so the source says so. */
  const dashed = options.includes("dashed") ? options : [...options, "dashed"];

  const commands = [closedPath(corners, dashed, false)];

  return withDefinitions(definitions, commands);
}

/* ============================================================
 * THE WRITER
 * ============================================================
 *
 * Returns the object's commands, or null when the object is not a Heat
 * Transfer one - so the synchronization layer can ask every writer in turn
 * and a `null` declines without a fight.
 */
export function heatTransferSourceWriter(object) {
  if (!object || !enggHeatModel.isHeatType(object.type)) {
    return null;
  }

  ensureObjectId(object, object.type);

  let body;

  switch (object.type) {
    case enggHeatModel.HEAT_TYPES.region:
      body = serializeRegion(object);
      break;
    case enggHeatModel.HEAT_TYPES.wallSlab:
      body = serializeWallSlab(object);
      break;
    case enggHeatModel.HEAT_TYPES.compositeWall:
      body = serializeCompositeWall(object);
      break;
    case enggHeatModel.HEAT_TYPES.fin:
      body = serializeFin(object);
      break;
    case enggHeatModel.HEAT_TYPES.heatPath:
      body = serializeHeatPath(object);
      break;
    case enggHeatModel.HEAT_TYPES.thermalArrow:
      body = serializeThermalArrow(object);
      break;
    case enggHeatModel.HEAT_TYPES.thermalBoundary:
      body = serializeThermalBoundary(object);
      break;
    case enggHeatModel.HEAT_TYPES.thermalContact:
      body = serializeThermalContact(object);
      break;
    case enggHeatModel.HEAT_TYPES.sourceSink:
      body = serializeSourceSink(object);
      break;
    case enggHeatModel.HEAT_TYPES.circuitNode:
      body = serializeCircuitNode(object);
      break;
    case enggHeatModel.HEAT_TYPES.circuitElement:
      body = serializeCircuitElement(object);
      break;
    case enggHeatModel.HEAT_TYPES.temperatureMarker:
      body = serializeTemperatureMarker(object);
      break;
    case enggHeatModel.HEAT_TYPES.isotherm:
      body = serializeIsotherm(object);
      break;
    case enggHeatModel.HEAT_TYPES.controlVolume:
      body = serializeControlVolume(object);
      break;
    default:
      body = null;
  }

  if (!body) {
    return null;
  }

  /*
   * THE OBJECT'S IDENTITY IS PRESERVED IN THE SOURCE.
   *
   * The variant is recorded in a comment ahead of the body, so a Wall / Slab
   * and a Composite Wall read as themselves, and the object's existing id,
   * its comments and its hidden flag are all carried through the round trip
   * by `applyObjectComments`.
   */
  const variant = enggHeatModel.variantOf(object);
  const header = variant ? `% ${object.type}:${variant}` : `% ${object.type}`;

  return applyObjectComments(object, `${header}\n${body}`, { type: object.type });
}

/*
 * The feature types this writer answers for. Listed as a constant so the
 * source pipeline's registry consistency check and the coverage tests can ask
 * "what does the Heat Transfer writer write?" without reading the switch.
 */
export const HEAT_SOURCE_TYPES = Object.freeze([
  "thermal-region",
  "wall-slab",
  "composite-wall",
  "fin",
  "heat-path",
  "thermal-arrow",
  "thermal-boundary",
  "thermal-contact",
  "heat-source-sink",
  "thermal-circuit-node",
  "thermal-circuit-element",
  "temperature-marker",
  "isotherm",
  "control-volume"
]);

export default heatTransferSourceWriter;
