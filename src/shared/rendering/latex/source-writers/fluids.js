/*
 * ============================================================
 * THE FLUIDS FLOW PATHS AS TIKZ
 * ============================================================
 *
 * A Pipe / Duct run is written as its two boundary walls and an Elbow as the
 * two walls bent round its corner plus the short mark at each end - from the
 * model's own `boundaryLines` and `elbowGeometry`, so the compiled picture is
 * the shape the canvas draws (entities/draw-fluids.js).
 *
 * Coordinates are drawing units, y up, like every other writer.
 */

import { point, splitPrelude, styleOptions } from "./statics-primitives.js";
import { applyObjectComments, ensureObjectId } from "../object-comments.js";
import enggPipeDuct from "../../../../features/workspace/model/fluids/pipe-duct.js";

function finitePoint(at) {
  return Boolean(at) && Number.isFinite(Number(at.x)) && Number.isFinite(Number(at.y));
}

function line(from, to, options) {
  return `\\draw[${options.join(", ")}] ${point(Number(from.x), Number(from.y))} -- ${point(Number(to.x), Number(to.y))};`;
}

function styleOf(object) {
  const { definitions, options } = splitPrelude(styleOptions({ ...(object.style || {}), lineType: "solid", fillMode: "none" }));

  return { definitions, options: options.length ? options : ["draw=black"] };
}

function withDefinitions(definitions, commands) {
  const body = commands.filter(Boolean);

  if (!body.length) {
    return null;
  }

  return [...definitions, ...body].join("\n");
}

function serializeRun(object) {
  const geometry = object.geometry || {};

  if (!finitePoint(geometry.start) || !finitePoint(geometry.end)) {
    return null;
  }

  const { definitions, options } = styleOf(object);

  return withDefinitions(
    definitions,
    enggPipeDuct
      .pipeDuctPaths(geometry.start, geometry.end, object.engineering || {})
      .map(path => `\\draw[${options.join(", ")}] ${path.map(at => point(at.x, at.y)).join(" -- ")};`)
  );
}

function serializeElbow(object) {
  const geometry = object.geometry || {};
  const engineering = object.engineering || {};
  const curves = enggPipeDuct.elbowGeometry(geometry.previous, geometry.position, geometry.next, engineering.bendRadius);

  if (!curves) {
    return null;
  }

  const { definitions, options } = styleOf(object);
  const separation = enggPipeDuct.boundarySeparation(engineering);
  const radii = separation === null
    ? [curves.radius]
    : [curves.radius - separation / 2, curves.radius + separation / 2];
  const sweep = ((curves.endAngle - curves.startAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  const commands = [];

  radii.forEach((radius) => {
    if (!Number.isFinite(radius) || radius <= 0) {
      return;
    }

    const steps = 24;
    const path = Array.from({ length: steps + 1 }, (_, index) => {
      const angle = curves.startAngle + (sweep * index) / steps;

      return point(curves.centre.x + radius * Math.cos(angle), curves.centre.y + radius * Math.sin(angle));
    });

    commands.push(`\\draw[${options.join(", ")}] ${path.join(" -- ")};`);
  });

  const markLength = separation === null ? 0 : separation / 2;

  [[curves.inDirection, curves.start], [curves.outDirection, curves.end]].forEach(([direction, at]) => {
    if (!direction || !finitePoint(at) || markLength <= 0) {
      return;
    }

    const normal = { x: -direction.y, y: direction.x };

    commands.push(line(
      { x: at.x - normal.x * markLength, y: at.y - normal.y * markLength },
      { x: at.x + normal.x * markLength, y: at.y + normal.y * markLength },
      options
    ));
  });

  return withDefinitions(definitions, commands);
}

export function fluidsSourceWriter(object) {
  if (!object || typeof object !== "object") {
    return null;
  }

  /*
   * A RUN IS TWO WALLS AND AN ELBOW IS FOUR PRIMITIVES. Each is ONE object, and
   * the header above its commands says so - so the whole run or fitting is one
   * region of source with one identity.
   */
  const written =
    object.type === "pipe-duct"
      ? serializeRun(object)
      : object.type === "elbow"
        ? serializeElbow(object)
        : null;

  if (typeof written !== "string" || !written.trim()) {
    return null;
  }

  const id = ensureObjectId(object, object.type);

  return applyObjectComments({ ...object, id }, written, { type: object.type });
}

export const FLUIDS_SOURCE_TYPES = Object.freeze(["pipe-duct", "elbow"]);

export default {
  FLUIDS_SOURCE_TYPES,
  fluidsSourceWriter
};
