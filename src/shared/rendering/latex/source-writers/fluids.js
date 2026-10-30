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
import enggJunction from "../../../../features/workspace/model/fluids/junction.js";
import enggFlowArrow from "../../../../features/workspace/model/fluids/flow-arrow.js";
import enggReducer from "../../../../features/workspace/model/fluids/reducer-expander.js";
import enggEquipment from "../../../../features/workspace/model/fluids/inline-equipment.js";
import enggVessel from "../../../../features/workspace/model/fluids/reservoir-tank.js";
import enggFluidLevel from "../../../../features/workspace/model/fluids/fluid-level.js";
import enggFlowArrows from "../../../../features/workspace/model/fluids/flow-arrows.js";
import enggPressureProfile from "../../../../features/workspace/model/fluids/pressure-profile.js";
import enggSectionPlane from "../../../../features/workspace/model/fluids/section-plane.js";
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

/*
 * A JUNCTION IS ONE CLOSED PATH.
 *
 * The contour comes from `junctionOutline` - the very loop the canvas draws -
 * so the compiled picture and the sheet describe the same fitting, and every
 * branch mouth is at the port its pipe meets, at that pipe's own width. The
 * source needs no fitting macro of its own: one native TikZ path, in the
 * junction's own appearance, IS the whole junction.
 */
function serializeJunction(object) {
  const { definitions, options } = styleOf(object);

  const outline = enggJunction.junctionOutline(object);

  if (outline.length < 3) {
    return null;
  }

  const path = outline.map((corner) => point(corner.x, corner.y)).join(" -- ");

  return withDefinitions(definitions, [
    `\\draw[${options.join(", ")}] ${path} -- cycle;`
  ]);
}

/*
 * A FLOW ARROW IS ONE CLOSED ARROWHEAD ON ITS HOST'S CENTRELINE, PLUS THE
 * THREE FACTS THAT MAKE IT AN ARROW.
 *
 * The compiled picture is the shape the canvas draws (entities/draw-fluids.js)
 * because both derive from the attachment in one place - the model's own
 * `flowArrowHead`. The anchor coordinate is computed AT REGENERATION from the
 * host pipe's current geometry, so the source stays in step with the sheet
 * instead of freezing where the arrow was when it was written.
 *
 * THE HEAD ALONE IS NOT THE OBJECT. Three corners say where an arrowhead is;
 * they do not say which pipe owns it, how far along that pipe it sits, or
 * whether it points with the run. Those are the arrow's MODEL, and they are
 * written as one compact MACHINERY comment directly above the commands - the
 * same `DAETUM <FIELD>: value` form every other metadata line uses, so the
 * reader gets it back exactly, and stripped from the source the student reads:
 *
 *     % DAETUM ATTACH: <pipe id>@0.42:reverse
 *     \draw[...] (x,y) -- (x,y);
 *     \draw[...] (x,y) -- (x,y) -- (x,y) -- cycle;
 *
 * The readable `% DAETUM OBJECT: Flow Arrow 1` written by `applyObjectComments`
 * sits above that and IS shown, so the comment a student reads is immediately
 * above the object's code.
 *
 * `ALONG` is the fraction of the run's own centreline, so the written number
 * survives the pipe being moved or resized - the same guarantee the model
 * gives the canvas. The colour and the dash pattern are already in the `\draw`
 * options, so they need no metadata of their own.
 */
function serializeFlowArrow(object) {
  const resolved = enggFlowArrow.describeFlowArrow(object);
  const shape = enggFlowArrow.flowArrowShape(object);

  if (!resolved.anchor || !resolved.direction || !shape) {
    return null;
  }

  const { definitions, options } = styleOf(object);

  /*
   * A RAW HEX COLOUR IS DEFINED IN THE SAME BLOCK. `daetumCC193335` is a name
   * the writer invents, so the `\definecolor` beside the commands is what makes
   * them compile on their own - the same rule every other writer follows.
   */
  const hexOf = (value) => {
    const match = String(value || "").match(/^#([0-9a-fA-F]{6})$/);

    return match ? `#${match[1]}` : null;
  };

  const inkSources = [object.style?.headingFill, object.style?.stroke].map(hexOf).filter(Boolean);

  const inkDefinitions = [...new Set(inkSources)]
    .map((hex) => colourOfHex(hex))
    .filter((name) => name && !["black", "white"].includes(name))
    .map((name) => `\\definecolor{${name}}{HTML}{${name.replace(/^daetumC/, "")}}`);

  /*
   * THE ARROW IS TWO PRIMITIVES, AS IT IS ON THE CANVAS AND AS IT IS DRAWN BY
   * HAND ON AN ENGINEERING SHEET:
   *
   *   1. the SHAFT - a line from the tail to the head's base, in the arrow's own
   *      line style, so `dashed` and `dotted` show on the stem where there is
   *      room to see a pattern;
   *   2. the HEAD - a small closed path, a quarter of the arrow's length, drawn
   *      as an outline and filled ONLY when Arrowhead Fill asks for it.
   *
   * The head is never the whole arrow: its size is a fraction of the length, so
   * no size setting can turn this into the solid triangle it must not be. The
   * two commands share one object block, so they are one arrow to DAETUM.
   */
  const shaft = `\\draw[${options.join(", ")}] ${point(shape.shaft.start.x, shape.shaft.start.y)} -- ${point(
    shape.shaft.end.x,
    shape.shaft.end.y
  )};`;

  const headPath = [shape.tip, shape.barbFirst, shape.barbSecond]
    .map((corner) => point(corner.x, corner.y))
    .join(" -- ");

  const headOptions = [...options.filter((option) => !/^(dashed|dotted|dash pattern|dash dot)/.test(option))];

  const filled = object.style?.headingFillMode === "solid";

  const ink = colourOfHex(hexOf(object.style?.headingFill) || hexOf(object.style?.stroke));

  const fill = filled && ink ? [`\\fill[${ink}] ${headPath} -- cycle;`] : [];

  /*
   * THE ATTACHMENT, AS METADATA, directly above the commands it describes.
   *
   * ONE LINE, NOT THREE. The attachment is machinery - it tells DAETUM which
   * pipe the arrow belongs to and how far along it - so it is written in the
   * compact `ID: HOST@ALONG:DIRECTION` form and STRIPPED from the source the
   * student reads, exactly as the `ID` and `TYPE` lines are. Three separate
   * lines would have put two lines of pipe identity between the arrow's readable
   * comment and the code it describes, which is the opposite of a comment.
   *
   * The readable `% DAETUM OBJECT: Flow Arrow 1` above it is what the student
   * sees, and it stays directly above the drawing commands.
   */
  const attachment = [
    `% DAETUM ATTACH: ${resolved.hostId || ""}@${number(resolved.fraction ?? 0.5)}:${
      resolved.reversed ? "reverse" : "along"
    }`
  ];

  return withDefinitions([...definitions, ...inkDefinitions], [
    ...attachment,
    shaft,
    ...fill,
    `\\draw[${headOptions.join(", ")}] ${headPath} -- cycle;`
  ]);
}

/* A hex colour as a TikZ colour NAME, or null when there is no usable one. */
function colourOfHex(value) {
  const match = String(value || "").trim().match(/^#([0-9a-fA-F]{6})$/);

  if (!match) {
    return null;
  }

  const hex = match[1].toUpperCase();

  return hex === "000000" ? "black" : hex === "FFFFFF" ? "white" : `daetumC${hex}`;
}

export function fluidsSourceWriter(object) {
  if (!object || typeof object !== "object") {
    return null;
  }

  /*
   * A RUN IS TWO WALLS, AN ELBOW IS FOUR PRIMITIVES, A JUNCTION ONE CLOSED PATH
   * AND A FLOW ARROW ONE CLOSED ARROWHEAD. Each is ONE object, and the header
   * above its commands says so - so the whole feature is one region of source
   * with one identity.
   *
   * THE SCHEMATIC TOOLS OF THE SAME FAMILY FOLLOW THE SAME RULE: the reducer, the
   * three inline symbols, the vessel, the fluid level, the free arrow, the flow
   * direction annotation, the pressure profile and the section mark each write
   * ONE block whose geometry comes from their model - never from a copy of it.
   */
  const written =
    object.type === "pipe-duct"
      ? serializeRun(object)
      : object.type === "elbow"
        ? serializeElbow(object)
        : object.type === "junction"
          ? serializeJunction(object)
          : object.type === "flow-arrow"
            ? object.attachment || object.content?.attachment
              ? serializeFlowArrow(object)
              : serializeFreeFlowArrow(object)
            : object.type === "reducer-expander"
              ? serializeReducer(object)
              : enggEquipment.isEquipmentType(object.type)
                ? serializeEquipment(object)
                : object.type === "reservoir-tank"
                  ? serializeVessel(object)
                  : object.type === "fluid-level"
                    ? serializeFluidLevel(object)
                    : object.type === "flow-direction-diagram"
                      ? serializeFlowDirection(object)
                      : object.type === "pressure-profile"
                        ? serializePressureProfile(object)
                        : object.type === "section-plane"
                          ? serializeSectionPlane(object)
                          : null;

  if (typeof written !== "string" || !written.trim()) {
    return null;
  }

  const id = ensureObjectId(object, object.type);

  return applyObjectComments({ ...object, id }, written, { type: object.type });
}

export const FLUIDS_SOURCE_TYPES = Object.freeze([
  "pipe-duct",
  "elbow",
  "junction",
  "flow-arrow",
  "reducer-expander",
  "pump",
  "valve",
  "flow-meter",
  "reservoir-tank",
  "fluid-level",
  "flow-direction-diagram",
  "pressure-profile",
  "section-plane"
]);

/* ============================================================
 * THE METADATA A SCHEMATIC OBJECT NEEDS TO BE FOUND AGAIN
 * ============================================================
 *
 * The geometry of a symbol is not its model: a pump's circle says nothing about
 * which pipe it joins or where its connection points are, and a profile's line
 * says nothing about the student's numbers. Those facts are written as the same
 * `% DAETUM FIELD: value` machinery lines the Flow Arrow uses, so the parser
 * reads them back and the block rebuilds the object it came from.
 *
 * EACH LINE IS ONE FIELD. The value is written compactly, without newlines, and
 * is stripped from the source the student reads - exactly like the object's id.
 */
function meta(field, value) {
  return `% DAETUM ${field}: ${String(value ?? "").replace(/[\r\n]+/g, " ").trim()}`;
}

/*
 * A LIST OF `name=value` PAIRS, AS ONE METADATA LINE'S VALUE.
 *
 * The source is the student's document, so every machinery line is one compact,
 * greppable row rather than a block of three or four - the same reasoning the
 * Flow Arrow's `ATTACH` line already follows.
 */
function settingsLine(pairs) {
  return pairs
    .map(([key, value]) => `${key}=${String(value ?? "").replace(/[\r\n]+/g, " ").trim()}`)
    .join(" ");
}

void meta;

/* A JSON value on one line - kept for a caller that needs it. */
function compactJSON(value) {
  return JSON.stringify(value).replace(/[\r\n]+/g, " ");
}

void compactJSON;

/* ============================================================
 * REDUCER / EXPANDER
 * ============================================================
 *
 * Two tapered walls, from the SAME endpoints and widths the canvas reads. The
 * block carries which two segments it joins and which way its taper runs, so the
 * source-to-model mapping can rebuild the connection rather than infer it from
 * coordinates.
 */
function serializeReducer(object) {
  const walls = enggReducer.wallsOf(object, drawingState.objects);

  if (!walls) {
    return null;
  }

  const { definitions, options } = styleOf(object);

  const settings = settingsLine([
    ["mode", enggReducer.normaliseMode(object.engineering?.mode)],
    ["length", number(enggReducer.transitionLengthOf(object))],
    ["start", object.engineering?.startPipeId || ""],
    ["end", object.engineering?.endPipeId || ""],
    ["ports", `${enggReducer.portsOf(object).start}|${enggReducer.portsOf(object).end}`]
  ]);

  const commands = walls.walls.map((wall) => line(wall.start, wall.end, options));

  if (object.style?.fillMode === "solid") {
    const corners = [walls.start.a, walls.end.a, walls.end.b, walls.start.b].map((corner) =>
      point(corner.x, corner.y)
    );

    return withDefinitions(definitions, [
      `% DAETUM REDUCER: ${settings}`,
      `\\draw[${options.join(", ")}] ${corners.join(" -- ")} -- cycle;`
    ]);
  }

  return withDefinitions(definitions, [`% DAETUM REDUCER: ${settings}`, ...commands]);
}

/* ============================================================
 * THE INLINE EQUIPMENT
 * ============================================================
 *
 * The symbol's own strokes, placed by its own frame - the same points the canvas
 * draws. A circle is written at the point where the stroke begins, with its
 * radius as a NUMBER, because TikZ's `circle[radius=...]` is a length and must
 * not be shifted by the export transform.
 */
function serializeEquipment(object) {
  const frame = enggEquipment.frameOf(object);

  if (!frame) {
    return null;
  }

  const { definitions, options } = styleOf(object);
  const shape = enggEquipment.symbolGeometry(object);

  const place = (local) => enggEquipment.localToWorld(frame, local);

  const commands = [];

  shape.strokes.forEach((part) => {
    if (part.kind === "circle") {
      const centre = place(part.centre);

      commands.push(
        `\\draw[${options.join(", ")}] ${point(centre.x, centre.y)} circle[radius=${number(part.radius)}];`
      );

      return;
    }

    if (part.kind === "polygon") {
      const path = part.points.map(place).map((corner) => point(corner.x, corner.y)).join(" -- ");

      commands.push(`\\draw[${options.join(", ")}] ${path} -- cycle;`);

      return;
    }

    if (part.kind === "line") {
      commands.push(line(place(part.start), place(part.end), options));
    }
  });

  /*
   * A FILLED PART IS INKED, NOT OUTLINED AGAIN. The triangle of a pump and the
   * hub of a meter are the symbol's own solid marks; a filled valve outline is
   * the student's Fill setting and is written as one closed path behind the
   * wedges.
   */
  const filledParts = shape.fills
    .filter((part) => part.kind === "polygon")
    .map((part) => part.points.map(place).map((corner) => point(corner.x, corner.y)).join(" -- ") + " -- cycle");

  const ink = colourOfHex(object.style?.stroke || "#193335") || "black";

  const inkCommands = filledParts.map((path) => `\\fill[${ink}] ${path};`);

  const dots = shape.fills
    .filter((part) => part.kind === "dot")
    .map((part) => {
      const centre = place(part.centre);

      return `\\fill[${ink}] ${point(centre.x, centre.y)} circle[radius=${number(part.radius)}];`;
    });

  const settings = settingsLine([
    ["kind", object.type],
    ["placement", enggEquipment.placementOf(object)],
    ["size", number(enggEquipment.symbolRadiusOf(object))],
    ["rotation", number(frame.rotation)],
    ["pipes", (object.engineering?.pipeIds || []).join("|")],
    ["depiction", object.engineering?.depiction || ""]
  ]);

  return withDefinitions(definitions, [
    `% DAETUM INLINE: ${settings}`,
    ...inkCommands,
    ...dots,
    ...commands
  ]);
}

/* ============================================================
 * RESERVOIR / TANK
 * ============================================================
 *
 * The outline as written: the two sides, the bottom and - for a closed tank -
 * the top. One path, one object, so the walls are never four selectable lines.
 */
function serializeVessel(object) {
  const segments = enggVessel.vesselSegments(object);

  if (!segments.length) {
    return null;
  }

  const { definitions, options } = styleOf(object);

  const corners = enggVessel.vesselOutline(object).map((corner) => point(corner.x, corner.y));

  const closed = enggVessel.vesselStyleOf(object) === enggVessel.VESSEL_STYLES.closed;

  const settings = settingsLine([
    ["style", enggVessel.vesselStyleOf(object)],
    ["width", number(enggVessel.vesselRect(object)?.width || 0)],
    ["height", number(enggVessel.vesselRect(object)?.height || 0)]
  ]);

  const body =
    object.style?.fillMode === "solid"
      ? [`\\draw[${options.join(", ")}] ${corners.join(" -- ")} -- ${closed ? "cycle" : corners[0]};`]
      : segments.map((segment) => line(segment.start, segment.end, options));

  return withDefinitions(definitions, [`% DAETUM VESSEL: ${settings}`, ...body]);
}

/* ============================================================
 * FLUID LEVEL
 * ============================================================
 *
 * One line across the vessel's interior, at the stored height - the SAME two
 * ends the canvas draws, so it cannot run through a wall.
 */
function serializeFluidLevel(object) {
  const segment = enggFluidLevel.levelSegment(object, drawingState.objects);

  if (!segment) {
    return null;
  }

  const { definitions, options } = styleOf(object);

  const settings = settingsLine([
    ["vessel", object.engineering?.vesselId || ""],
    ["level", number(object.engineering?.levelPosition ?? 0)]
  ]);

  return withDefinitions(definitions, [
    `% DAETUM LEVEL: ${settings}`,
    line(segment.start, segment.end, options)
  ]);
}

/* ============================================================
 * THE FREE FLOW ARROW
 * ============================================================
 *
 * A shaft with a drawn head, from its own two points. The head is bitmaps of the
 * same proportions the canvas paints, computed here from the arrow's length so
 * the compiled picture matches the sheet.
 */
function serializeFreeFlowArrow(object) {
  const span = enggFlowArrows.freeArrowSpan(object);

  if (!span) {
    return null;
  }

  const { definitions, options } = styleOf(object);

  const head = Math.min(span.length * 0.3, 5);
  const half = head * 0.42;

  const across = { x: -span.direction.y, y: span.direction.x };

  const base = {
    x: span.end.x - span.direction.x * head,
    y: span.end.y - span.direction.y * head
  };

  const tip = point(span.end.x, span.end.y);
  const barbFirst = point(base.x + across.x * half, base.y + across.y * half);
  const barbSecond = point(base.x - across.x * half, base.y - across.y * half);

  return withDefinitions(definitions, [
    line(span.start, base, options),
    `\\draw[${options.join(", ")}] ${tip} -- ${barbFirst} -- ${barbSecond} -- cycle;`
  ]);
}

/* ============================================================
 * THE FLOW DIRECTION DIAGRAM
 * ============================================================
 *
 * Its arrows, on its host's centreline - plus the one metadata line that says
 * WHICH pipe they belong to and how far along it, so a moved pipe takes them
 * with it.
 */
function serializeFlowDirection(object) {
  const shapes = enggFlowArrows.directionArrowShapes(object, drawingState.objects);

  if (!shapes.length) {
    return null;
  }

  const { definitions, options } = styleOf(object);

  const settings = settingsLine([
    ["pipe", object.engineering?.pipeId || ""],
    ["at", number(enggFlowArrows.directionFractionOf(object))],
    ["dir", object.engineering?.reversed ? "reverse" : "along"],
    ["spacing", enggFlowArrows.directionSpacingOf(object)],
    ["size", number(enggFlowArrows.directionArrowSizeOf(object))]
  ]);

  const commands = shapes.map((shape) => line(shape.start, shape.end, options));

  return withDefinitions(definitions, [`% DAETUM DIRECTION: ${settings}`, ...commands]);
}

/* ============================================================
 * THE PRESSURE PROFILE
 * ============================================================
 *
 * The frame, the two axes, the straight polyline through the student's OWN
 * rows, and a filled dot per row. Nothing is interpolated: the polyline has
 * exactly the points the table has.
 *
 * THE TABLE IS WRITTEN IN THE METADATA LINE, as position/pressure pairs, so the
 * numbers the source draws ARE the numbers the panel shows. The geometry of the
 * frame is in drawing coordinates, like every other writer's.
 */
function serializePressureProfile(object) {
  const frame = enggPressureProfile.profileFrame(object);
  const area = enggPressureProfile.plotArea(object);

  if (!frame || !area) {
    return null;
  }

  const { definitions, options } = styleOf(object);
  const axes = enggPressureProfile.axesOf(object);
  const rows = enggPressureProfile.dataPointsOf(object);

  /*
   * THE STUDENT'S ROWS, IN THE METADATA LINE.
   *
   * `data=` carries every position/pressure pair, `;`-separated, so the reader
   * gets the TABLE back exactly - a plotted point is a drawing position, and a
   * row is a pair of engineering values, so the line alone cannot say what the
   * student typed. The pairs are quoted so a value can never be read as another
   * setting.
   */
  const dataPairs = enggPressureProfile.dataPointsOf(object)
    .map((row) => `${number(row.position)}/${number(row.pressure)}`)
    .join(";");

  const settings = settingsLine([
    ["x", number(axes.xMin)],
    ["xmax", number(axes.xMax)],
    ["y", number(axes.yMin)],
    ["ymax", number(axes.yMax)],
    ["xunit", `"${axes.xUnit}"`],
    ["yunit", `"${axes.yUnit}"`],
    ["xtitle", `"${axes.xTitle}"`],
    ["ytitle", `"${axes.yTitle}"`],
    ["name", `"${enggPressureProfile.graphNameOf(object)}"`],
    ["grid", enggPressureProfile.showGridOf(object) ? "on" : "off"],
    ["points", enggPressureProfile.showPointsOf(object) ? "on" : "off"],
    ["data", `"${dataPairs}"`]
  ]);

  const plotPoints = rows.map((row) => {
    const at = enggPressureProfile.dataToDrawing(object, row);

    return at ? point(at.x, at.y) : null;
  }).filter(Boolean);

  const commands = [
    line(area.origin, area.xEnd, options),
    line(area.origin, area.yEnd, options)
  ];

  /* A GRID, when the student asked for one - faint, drawn under the data. */
  if (enggPressureProfile.showGridOf(object)) {
    enggPressureProfile.ticksFor(axes.xMin, axes.xMax).forEach((value) => {
      const at = enggPressureProfile.dataToDrawing(object, { position: value, pressure: axes.yMin });

      if (at) {
        commands.push(`\\draw[${options.join(", ")}, line width=0.25pt] ${point(at.x, at.y)} -- ${point(at.x, area.top)};`);
      }
    });

    enggPressureProfile.ticksFor(axes.yMin, axes.yMax).forEach((value) => {
      const at = enggPressureProfile.dataToDrawing(object, { position: axes.xMin, pressure: value });

      if (at) {
        commands.push(`\\draw[${options.join(", ")}, line width=0.25pt] ${point(at.x, at.y)} -- ${point(area.right, at.y)};`);
      }
    });
  }

  if (plotPoints.length > 1) {
    commands.push(`\\draw[${options.join(", ")}] ${plotPoints.join(" -- ")};`);
  }

  if (enggPressureProfile.showPointsOf(object)) {
    plotPoints.forEach((at) => {
      commands.push(`\\fill[${(options.find((option) => option.startsWith("draw=")) || "draw=black").replace("draw=", "")}] ${at} circle[radius=0.6];`);
    });
  }

  /* THE AXES' TEXT: the four tick values, the titles with their units, the name. */
  const tickLabel = (at, text) =>
    `\\node[font=\\scriptsize, text=${colourOfHex(object.style?.stroke) || "black"}] at ${point(at.x, at.y)} {${number(text)}};`;

  enggPressureProfile.ticksFor(axes.xMin, axes.xMax).forEach((value) => {
    const at = enggPressureProfile.dataToDrawing(object, { position: value, pressure: axes.yMin });

    if (at) {
      commands.push(tickLabel({ x: at.x, y: at.y - frame.height * 0.045 }, value));
    }
  });

  enggPressureProfile.ticksFor(axes.yMin, axes.yMax).forEach((value) => {
    const at = enggPressureProfile.dataToDrawing(object, { position: axes.xMin, pressure: value });

    if (at) {
      commands.push(tickLabel({ x: at.x - frame.width * 0.02, y: at.y }, value));
    }
  });

  const textOf = (value) => String(value ?? "").replace(/[{}\\\n\r]/g, "").trim();
  const units = (unit) => (textOf(unit) ? ` (${textOf(unit)})` : "");
  const ink = colourOfHex(object.style?.stroke) || "black";

  commands.push(
    `\\node[font=\\scriptsize, text=${ink}] at ${point(
      (area.left + area.right) / 2,
      frame.position.y + frame.height * 0.035
    )} {${textOf(axes.xTitle)}${units(axes.xUnit)}};`
  );

  commands.push(
    `\\node[font=\\scriptsize, text=${ink}] at ${point(
      frame.position.x + frame.width * 0.02,
      (area.bottom + area.top) / 2
    )} {${textOf(axes.yTitle)}${units(axes.yUnit)}};`
  );

  if (textOf(enggPressureProfile.graphNameOf(object))) {
    commands.push(
      `\\node[font=\\small, text=${ink}] at ${point(
        frame.position.x + frame.width / 2,
        frame.position.y + frame.height - frame.height * 0.025
      )} {${textOf(enggPressureProfile.graphNameOf(object))}};`
    );
  }

  return withDefinitions(definitions, [`% DAETUM PROFILE: ${settings}`, ...commands]);
}

/* ============================================================
 * THE SECTION PLANE
 * ============================================================
 *
 * The trace, the two viewing arrows and the student's identifier when there is
 * one - all in one block, all one object.
 */
function serializeSectionPlane(object) {
  const span = enggSectionPlane.sectionSpan(object);

  if (!span) {
    return null;
  }

  const { definitions, options } = styleOf(object);

  const settings = settingsLine([
    ["direction", enggSectionPlane.sectionDirectionOf(object)],
    ["identifier", enggSectionPlane.sectionIdentifierOf(object) || ""],
    ["arrows", enggSectionPlane.showSectionArrowsOf(object) ? "on" : "off"]
  ]);

  const commands = [line(span.start, span.end, options)];

  if (enggSectionPlane.showSectionArrowsOf(object)) {
    enggSectionPlane.sectionArrows(object).forEach((arrow) => {
      commands.push(`\\draw[${options.join(", ")}] ${point(arrow.start.x, arrow.start.y)} -- ${point(arrow.end.x, arrow.end.y)};`);
    });
  }

  const identifier = enggSectionPlane.sectionIdentifierOf(object).trim();

  if (identifier) {
    const at = enggSectionPlane.sectionLabelPoint(object);

    commands.push(`\\node[above right] at ${point(at.x, at.y)} {${identifier.replace(/[{}\\]/g, "")}};`);
  }

  return withDefinitions(definitions, [`% DAETUM SECTION: ${settings}`, ...commands]);
}

export default {
  FLUIDS_SOURCE_TYPES,
  fluidsSourceWriter
};
