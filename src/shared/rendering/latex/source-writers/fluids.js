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
import { drawingState } from "../../../../features/workspace/editor-state.js";

function finitePoint(at) {
  return Boolean(at) && Number.isFinite(Number(at.x)) && Number.isFinite(Number(at.y));
}

function line(from, to, options) {
  return `\\draw[${options.join(", ")}] ${point(Number(from.x), Number(from.y))} -- ${point(Number(to.x), Number(to.y))};`;
}

/*
 * THE RUN'S WALLS, WITH THE END THAT MEETS A BEND CUT TO THE BEND'S SEAM.
 *
 * The seam is the point the bend's matching arc starts at, recorded on the run
 * when the fitting was settled - so the written wall and the written arc end on
 * one coordinate and the compiled picture has neither an overlap nor a gap at
 * the fitting. Nothing else about a wall changes: same line, same offset, same
 * direction.
 */
function seamWalls(walls, run) {
  const joints = run?.geometry?.bendJoints && typeof run.geometry.bendJoints === "object"
    ? run.geometry.bendJoints
    : null;

  if (!joints) {
    return walls;
  }

  return walls.map((boundary, index) => {
    const seams = ["start", "end"]
      .filter((end) => finitePoint(joints?.[end]?.[index]))
      .map((end) => ({ end, point: joints[end][index] }));

    return seams.length
      ? { ...boundary, ...Object.fromEntries(seams.map((seam) => [seam.end, seam.point])) }
      : boundary;
  });
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
   * A RUN'S ENDPOINTS ARE ALREADY THE WALLS' ENDS. A joined run has had its
   * `start`/`end` moved onto the elbow's tangent points, so the centreline as
   * stored IS the visible one - trimming it again by `geometry.trims` would
   * shorten it a second time and put the written walls a trim short of the
   * drawn bend.
   */
  /* THE END THAT MEETS A BEND IS WRITTEN TO THE BEND'S SEAM - see `seamWalls`. */
  const walls = seamWalls(enggPipeDuct.boundaryLinesOf(object), object)
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
  const { definitions, options } = styleOf(object);

  /*
   * THE TWO WALLS COME FROM THE MODEL, WHICH KNOWS WHICH IS WHICH.
   *
   * `elbowWallArcsFor` builds each wall on its own radius about the bend's
   * centre, so a bend whose two runs are drawn at different widths still meets
   * both of them exactly - and it is the SAME statement of the bend the canvas
   * draws, so the compiled picture and the sheet cannot disagree.
   */
  /*
   * THE PAIR THE BEND JOINS, in the fitting's own order - arriving run first.
   * The model reads each run's drawn direction from it to decide which of the
   * fitting's two lines that run's walls continue, so the written arcs join the
   * written walls on the same side the canvas joins them.
   */
  const ids = Array.isArray(object?.engineering?.connections) ? object.engineering.connections : [];
  const objects = drawingState.objects || [];
  const at = (id) => (id ? objects.find((candidate) => candidate.id === id) || null : null);

  const walls = enggPipeDuct.elbowJunctionsFor(object, {
    incoming: at(ids[0]),
    outgoing: at(ids[1])
  });

  if (!walls) {
    return null;
  }

  const commands = [];

  [walls.outer, walls.inner].forEach((wall) => {
    const from = degrees(wall.from);
    const delta = degrees(wall.sweep);
    /*
     * EQUAL WIDTHS ARE ONE ARC. When both ends are drawn at the same spacing
     * - the ordinary case - the wall is a single circular arc and is written
     * as one, which is readable and survives an edit to its radius.
     *
     * UNEQUAL WIDTHS ARE A TAPER, and no single arc can describe that. It is
     * written as a short chain of points - the same interpolation the renderer
     * uses - so the compiled picture still meets both runs exactly.
     */
    if (Math.abs(wall.startRadius - wall.endRadius) < 1e-9) {
      commands.push(
        `\\draw[${options.join(", ")}] ${point(walls.bend.centre.x, walls.bend.centre.y)} ++(${from}:${number(wall.startRadius)}) arc[start angle=${from}, delta angle=${number(delta)}, radius=${number(wall.startRadius)}];`
      );

      return;
    }

    commands.push(
      `\\draw[${options.join(", ")}] ${pathPointsOf(wall).join(" -- ")};`
    );
  });

  /*
   * A FILLED ELBOW IS ONE CLOSED PATH - the outer wall, the end edge, the inner
   * wall and the other end edge - drawn instead of, not on top of, the two open
   * walls. That is the same closure a filled run uses, and the only way TikZ
   * fills the region between two boundaries.
   */
  if (object.style?.fillMode === "solid") {
    const outer = pathPointsOf(walls.outer);
    const inner = pathPointsOf(walls.inner).reverse();

    return withDefinitions(definitions, [
      `\\draw[${options.join(", ")}] ${[...outer, ...inner].join(" -- ")} -- cycle;`
    ]);
  }

  /*
   * NO END MARKS. The runs meet the arcs at their tangent points, so a
   * cross-mark would draw across the bore rather than close a corner.
   */
  return withDefinitions(definitions, commands);
}

/* One wall of an elbow, sampled exactly as the canvas samples it. */
function pathPointsOf(wall) {
  const steps = 32;

  return Array.from({ length: steps + 1 }, (_, index) => {
    const at = wall.pointAt(index / steps);

    return point(at.x, at.y);
  });
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
