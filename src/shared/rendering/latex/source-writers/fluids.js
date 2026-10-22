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

/* Degrees for a TikZ angle, rounded where the float noise shows and not before. */
function degrees(radians) {
  return number((Number(radians) * 180) / Math.PI);
}

function number(value) {
  const rounded = Number(Number(value).toFixed(4));

  return Number.isFinite(rounded) ? String(rounded) : "0";
}

function styleOf(object) {
  /*
   * THE RUN'S OWN STYLE, NOT A FORCED ONE.
   *
   * This used to pin `lineType: "solid"` and `fillMode: "none"`, which was
   * correct while the panel exposed neither - the run could only ever BE solid
   * and unfilled. The Features tab now offers both, so the writer must state
   * what the object actually has, or a dashed or filled pipe would compile as a
   * plain pair of lines and the source would disagree with the canvas.
   */
  const { definitions, options } = splitPrelude(styleOptions(object.style || {}));

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

  /*
   * A RUN WITH A BEND IS WRITTEN SHORT, from the SAME trimmed centreline the
   * canvas draws. Otherwise the source would run its walls into the corner and
   * the compiled picture would disagree with the sheet.
   */
  const centreline = enggPipeDuct.trimmedCentreline(object) || geometry;
  const walls = enggPipeDuct
    .boundaryLines(centreline.start, centreline.end, object.engineering || {})
    .filter((boundary) => finitePoint(boundary.start) && finitePoint(boundary.end));

  if (walls.length !== 2) {
    return null;
  }

  /*
   * A FILLED RUN IS ONE CLOSED PATH.
   *
   * Two walls and the two end caps enclose the bore, so a filled pipe compiles
   * as a single `-- cycle` path with a fill - the same shape the canvas draws,
   * and the only way TikZ will fill the region between the walls. An unfilled
   * run stays two open lines, which is the drawing convention it stands for.
   */
  if (object.style?.fillMode === "solid") {
    const [first, second] = walls;

    return withDefinitions(definitions, [
      `\\draw[${options.join(", ")}] ${point(first.start.x, first.start.y)} -- ${point(first.end.x, first.end.y)} -- ${point(second.end.x, second.end.y)} -- ${point(second.start.x, second.start.y)} -- cycle;`
    ]);
  }

  return withDefinitions(
    definitions,
    walls.map((boundary) => line(boundary.start, boundary.end, options))
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

  /*
   * THE BEND'S TWO ENDS MAY BE DRAWN AT DIFFERENT WIDTHS - an elbow is the
   * boundary at which two runs may differ. The wall radii interpolate between
   * the two separations, exactly as the canvas draws them, so each border stays
   * continuous with the straight wall it meets.
   */
  const startSeparation = Number(engineering.startSeparation) > 0
    ? Number(engineering.startSeparation)
    : separation;

  const endSeparation = Number(engineering.endSeparation) > 0
    ? Number(engineering.endSeparation)
    : separation;

  const sweep = ((curves.endAngle - curves.startAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  const commands = [];

  const from = degrees(curves.startAngle);
  const delta = degrees(sweep);

  [1, -1].forEach((side) => {
    const halfStart = startSeparation / 2;
    const halfEnd = endSeparation / 2;

    /*
     * EQUAL WIDTHS ARE ONE ARC. When both ends are drawn at the same spacing
     * - the ordinary case - the wall is a single circular arc and is written
     * as one, which is readable and survives an edit to its radius.
     *
     * UNEQUAL WIDTHS ARE A TAPER, and no single arc can describe that. It is
     * written as a short chain of points - the same interpolation the renderer
     * uses - so the compiled picture still meets both runs exactly.
     */
    if (Math.abs(startSeparation - endSeparation) < 1e-9) {
      const radius = curves.radius + side * halfStart;

      if (!Number.isFinite(radius) || radius <= 0) {
        return;
      }

      commands.push(
        `\\draw[${options.join(", ")}] ${point(curves.centre.x, curves.centre.y)} ++(${from}:${number(radius)}) arc[start angle=${from}, delta angle=${number(delta)}, radius=${number(radius)}];`
      );

      return;
    }

    const steps = 24;
    const path = Array.from({ length: steps + 1 }, (_, index) => {
      const t = index / steps;
      const angle = curves.startAngle + sweep * t;
      const radius = curves.radius + side * (halfStart + (halfEnd - halfStart) * t);

      return point(
        curves.centre.x + radius * Math.cos(angle),
        curves.centre.y + radius * Math.sin(angle)
      );
    });

    commands.push(`\\draw[${options.join(", ")}] ${path.join(" -- ")};`);
  });

  /*
   * NO END MARKS. The runs meet the arcs at their tangent points now, so a
   * cross-mark would draw across the bore rather than close a corner.
   */
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
