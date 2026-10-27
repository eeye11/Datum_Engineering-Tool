/*
 * ============================================================
 * SOURCE <-> CANVAS OBJECT SYNCHRONIZATION
 * ============================================================
 *
 * The one module that knows both the drawing source and the object model, and
 * therefore the one place the two are brought into agreement.
 *
 * THE THREE OPERATIONS, AND WHEN EACH IS RIGHT.
 *
 *   readSource(source)          DRAFT -> OBJECTS
 *     What the student typed is the document. Every supported statement inside
 *     an object's block becomes, or updates, the object that block names.
 *     Unsupported statements are left alone; invalid ones keep the object's
 *     LAST VALID representation.
 *
 *   writeObjectSource(object)   OBJECT -> DRAFT
 *     A canvas edit rewrites ONLY its own object's block. Everything else in the
 *     text - other objects, comments, custom TikZ, formatting - is preserved
 *     byte for byte.
 *
 *   removeObjectSource(id)      OBJECT DELETED -> DRAFT
 *     A committed deletion removes its block; a block that was already invalid
 *     keeps its text (it draws nothing) rather than being silently deleted.
 *
 * WHY THIS IS NOT A "GENERATE THE DOCUMENT FROM THE MODEL".
 *
 * Regeneration would be simpler to write and would destroy, every time it ran,
 * the student's own formatting and any custom TikZ the model cannot represent.
 * The document is the SOURCE. The model is a view of a part of it.
 *
 * LAST-ACTION-WINS.
 *
 * There is no ownership voting or merge dialog. Whichever side changed last
 * wrote the block last, so the later action is the one that survives - and it
 * survives only for THAT block. See `writeObjectSource`: it rewrites by block
 * identity and never touches a neighbour.
 */

import {
  emptyDrawingSource,
  parseDrawingSource
} from "./drawing-source.js";
import { blockContents, shapeFromStatement } from "./source-model.js";
import { removeObjectRegion, setObjectRegion } from "./source-mapping.js";
import { sourceForObject } from "./source-synchronization.js";
import { objectDisplayName, objectTypeLabel } from "./object-comments.js";
import { splitStatements } from "./source-statements.js";
import enggPipeDuct from "../../../features/workspace/model/fluids/pipe-duct.js";
import enggFlowArrow from "../../../features/workspace/model/fluids/flow-arrow.js";
import {
  readFreeFlowArrow,
  baseStyleFromSource,
  schematicReaderFor
} from "./source-readers/fluids-schematic-readers.js";

/*
 * THE FLOW ARROW'S READER, RESOLVED WHEN A BLOCK NEEDS IT.
 *
 * `fluids-readers.js` pulls in the tool library's style primitives, which read
 * the document at load - and the PARSER is used by tests and by the embedded
 * pipeline with no DOM. A static import would make every reader of the parser
 * need a browser, so the reader is required through a callback the caller that
 * owns the environment supplies. In the application it is registered at start-up;
 * without it an arrow block simply keeps its last valid form, which is the same
 * answer any unreadable block gets.
 */
let flowArrowReader = null;

export function setFlowArrowSourceReader(reader) {
  flowArrowReader = typeof reader === "function" ? reader : null;
}

function readFlowArrowBlock(source, options) {
  return flowArrowReader ? flowArrowReader(source, options) : null;
}

/* ============================================================
 * A STABLE ID FOR A BLOCK THAT HAS NONE
 * ============================================================
 *
 * Custom TikZ the student types is preserved and rendered but is nobody's
 * object. If the SAME custom statement is still there on the next parse there is
 * nothing to do. The identity of such a statement is its text, which is stable
 * across unrelated edits elsewhere in the document.
 */
function stableBlockId(index, text) {
  let hash = 0;

  for (let at = 0; at < text.length; at += 1) {
    hash = (hash * 31 + text.charCodeAt(at)) >>> 0;
  }

  return `source-${index}-${hash.toString(36)}`;
}

/* ============================================================
 * WHERE A CANVAS OBJECT BECOMES GEOMETRY
 * ============================================================
 *
 * Only the shapes the reader can recognise AND the writers can re-emit from
 * geometry are built here. A statement DAETUM can render but not edit stays
 * source-only: an object invented from it could not be written back, and the
 * next canvas edit would then disagree with the code it came from.
 */
/*
 * THE ELBOW AND THE JUNCTION ARE NOT CONVERTIBLE. A fitting is written as the
 * two paths its walls are, and reconstruction is a FIT round that pair round
 * round - so a one-statement block that parses as a line stays a Line. The
 * reader only recognises the syntax the tool actually emits.
 */
const CONVERTIBLE = new Set(["line", "circle", "rectangle", "arc", "point", "polyline"]);

/*
 * Apply the parts of a statement the object model carries: the stroke colour and
 * the width. Geometry already came from the statement; this is appearance.
 */
function styleFromShape(shape, existingStyle = {}) {
  const style = { ...existingStyle };

  if (shape.stroke) {
    style.stroke = shape.stroke;
  }

  /*
   * TikZ's `line width` is a print width in millimetres; the model stores a
   * multiplier of the standard 0.4pt line (`0.56` is `lineWidth: 1`). The
   * conversion is inverted here with the same constant the writer uses, so a
   * width written to source and read back is the same width.
   */
  if (Number.isFinite(shape.lineWidth) && shape.lineWidth > 0) {
    style.lineWidth = Number((shape.lineWidth / 0.56).toFixed(3));
  }

  return style;
}

/*
 * THE GEOMETRY FACTORIES, ASKED FOR LAZILY.
 *
 * The model owns how an object of each type is built (its fields, defaults and
 * labels), so the object created from source must come from the same factories a
 * tool uses. They arrive through a setter rather than an import because
 * `drawing-state.js` is the bottom of the model and importing it here would be a
 * second copy of the object shape.
 */
let factories = null;

export function setSourceGeometryFactories(table) {
  factories = table || null;
}

function factoryTable() {
  if (factories) {
    return factories;
  }

  /*
   * REGISTERED BY THE PANEL. A test or an embed that drives this module without
   * one gets no object creation rather than an exception - the source still
   * renders, which is the honest outcome.
   */
  return null;
}

/* A fresh object of `type` with `shape`'s geometry, or null. */
function createObjectFromShape(type, shape, previous) {
  const table = factoryTable();

  if (!table && type !== "pipe-duct") {
    return null;
  }

  const style = styleFromShape(shape, previous ? previous.style : {});
  const options = {
    id: previous ? previous.id : undefined,
    name: previous ? previous.name : undefined,
    style
  };

  try {
    switch (type) {
      case "line":
        return table.line(shape.from, shape.to, options);
      case "circle":
        return table.circle(shape.centre, shape.radius, options);
      case "rectangle": {
        const left = Math.min(shape.from.x, shape.to.x);
        const right = Math.max(shape.from.x, shape.to.x);
        const bottom = Math.min(shape.from.y, shape.to.y);
        const top = Math.max(shape.from.y, shape.to.y);

        return table.rectangle({ x: left, y: bottom }, right - left, top - bottom, 0, options);
      }
      case "arc":
        return table.arc(shape.centre, shape.radius, shape.startAngle, shape.endAngle, options);
      case "point":
        return table.point(shape.position, options);
      case "polyline":
        return table.polyline(shape.points, options);

      /*
       * A PIPE FROM ITS TWO WALLS. Recovered through the model's own factory, so
       * a run typed into the Source tab is the same feature a drag creates -
       * not a second kind of pipe that only source editing knows about.
       */
      case "pipe-duct": {
        const engineering = {
          ...enggPipeDuct.defaultPipeEngineering(),
          ...(Number.isFinite(shape.separation) && Math.abs(shape.separation) > 1e-9
            ? { separation: Number(shape.separation.toFixed(6)) }
            : {})
        };

        return enggPipeDuct.createPipeDuct(shape.start, shape.end, {
          ...options,
          engineering
        });
      }

      default:
        return null;
    }
  } catch {
    return null;
  }
}

/*
 * ============================================================
 * A PIPE / DUCT AS TWO WALLS
 * ============================================================
 *
 * A run is written as TWO `\draw` statements - its two walls - because that is
 * what it looks like, and because each wall is an ordinary straight line whose
 * colour and width a student can find and change. Reading it back therefore
 * cannot go through the one-shape rule: a two-statement block is a PIPE, not
 * "two lines DAETUM cannot edit".
 *
 * The two walls are recognised as a pair by their geometry, not by their text:
 * they must be equal in length, parallel, and exactly the schematic separation
 * apart. The run's centreline is the midpoint between them, so it is recovered
 * exactly - and a widened run is recovered too, because the separation it is
 * read at becomes the run's own Pipe Width Change.
 *
 * ANYTHING ELSE IS REPORTED, NOT GUESSED AT. Two lines that do not make a pair
 * leave the block in `unsupported`, so the student is told their edit could not
 * be read rather than having a wrong pipe invented from it.
 */
function pipeFromWalls(shapes) {
  if (!Array.isArray(shapes) || shapes.length !== 2) {
    return null;
  }

  const [a, b] = shapes;

  if (a?.type !== "line" || b?.type !== "line") {
    return null;
  }

  const points = [a.from, a.to, b.from, b.to];

  if (
    points.some(
      (at) => !at || !Number.isFinite(Number(at.x)) || !Number.isFinite(Number(at.y))
    )
  ) {
    return null;
  }

  const lengthOf = (line) => Math.hypot(line.to.x - line.from.x, line.to.y - line.from.y);
  const lengthA = lengthOf(a);
  const lengthB = lengthOf(b);

  if (lengthA < 1e-9 || Math.abs(lengthA - lengthB) > 1e-6 * Math.max(1, lengthA)) {
    return null;
  }

  const ua = { x: (a.to.x - a.from.x) / lengthA, y: (a.to.y - a.from.y) / lengthA };
  const ub = { x: (b.to.x - b.from.x) / lengthB, y: (b.to.y - b.from.y) / lengthB };

  /* Parallel means the same direction or exactly opposite - both draw a pair. */
  if (Math.abs(Math.abs(ua.x * ub.x + ua.y * ub.y) - 1) > 1e-6) {
    return null;
  }

  /* The offset from the first wall to the second, taken at their starts. */
  const offset = { x: b.from.x - a.from.x, y: b.from.y - a.from.y };
  const separation = Math.abs(offset.x * ua.y - offset.y * ua.x);

  if (!(separation > 0)) {
    return null;
  }

  /*
   * THE CENTRELINE. Both walls sit half the separation from it, so their starts'
   * midpoint and their ends' midpoint are its two ends - in whichever order the
   * two lines happened to be written.
   */
  const start = {
    x: (a.from.x + b.from.x) / 2,
    y: (a.from.y + b.from.y) / 2
  };

  const end = {
    x: (a.to.x + b.to.x) / 2,
    y: (a.to.y + b.to.y) / 2
  };

  return {
    type: "pipe-duct",
    start,
    end,

    /* The change from the drawing default, which is what the model stores. */
    separation: separation - enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION
  };
}

/* An object of `type` from the two walls of a pipe, or null. */
function createPipeFromWalls(walls) {
  return createObjectFromShape("pipe-duct", { ...walls, type: "pipe-duct" }, null) || null;
}

/*
 * A FLOW ARROW FROM ITS BLOCK, THROUGH THE MODEL'S OWN FACTORY.
 *
 * An arrow typed into the Source tab is the same feature a drag creates: the
 * same factory, the same attachment, the same name. The block's id is put on it
 * afterwards, so the block keeps describing the object on the next parse.
 */
function createFlowArrowFromSource(arrow, objects = []) {
  /*
   * THE HOST IS HANDED IN, NOT LOOKED UP. A parsing pass builds a whole sheet's
   * objects before any of them is in the document, so the published lookup
   * cannot see the pipe this arrow names - and an arrow without its pipe cannot
   * be placed. The host is found in the batch instead, which is the same pipe.
   */
  const host = (objects || []).find((object) => object?.id === arrow.hostId) || null;

  return enggFlowArrow.createFlowArrow(arrow.hostId, {
    fraction: arrow.fraction,
    reversed: arrow.reversed,
    size: arrow.size,
    style: arrow.style,
    host
  });
}

/* ============================================================
 * AN ELBOW AS TWO CURVED WALLS
 * ============================================================
 *
 * A fitting is written as the two `\draw` paths its walls are, and comes back in
 * as its CORNER, its two ENDS and its bend radius - never as two lines. The
 * reconstruction is a FIT, not a reading of arbitrary TikZ: the two paths must be
 * concentric circular arcs of the same sweep, their centre is the bend centre, and
 * the radial gap between them is the bend's width at that point.
 *
 * TWO WRITTEN FORMS ARE UNDERSTOOD, because the writer emits both: a SINGLE ARC
 * and a SAMPLED POLYLINE that follows one (the tapered form). Either is fitted
 * to its circle first, so the fitting comes back as the same object whichever
 * form its walls were written in.
 *
 * WHAT CAN BE RECOVERED AND WHAT IS REPORTED.
 *
 *   radius        the middle radius of the two arcs
 *   corner        where the two arms meet, from the arc's two tangent ends
 *   ends          the two tangent points (the student's own ends, for a free arm)
 *   angle         the arc's own sweep, so any bend angle round-trips
 *   width         the radial gap, at the arc's middle
 *
 * TWO PATHS THAT ARE NOT TWO WALLS OF ONE BEND - a taper whose walls diverge, a
 * mixed path, two unrelated arcs - return null, and the block is REPORTED as
 * unsupported by the existing machinery. It is never split into two independent
 * objects.
 */
function elbowShapeFromPaths(shapes) {
  if (!Array.isArray(shapes) || shapes.length !== 2) {
    return null;
  }

  const walls = [shapeAsArc(shapes[0]), shapeAsArc(shapes[1])];

  if (!walls[0] || !walls[1]) {
    return null;
  }

  const [a, b] = walls;

  const near = (left, right) => Math.abs(left - right) <= 1e-3;

  if (!near(a.centre.x, b.centre.x) || !near(a.centre.y, b.centre.y)) {
    return null;
  }

  const start = a.startAngle;
  const sweep = a.endAngle - start;
  const otherSweep = b.endAngle - b.startAngle;

  const sameSweep =
    Math.abs(sweep - otherSweep) <= 1e-3 ||
    Math.abs(normalisedDelta(sweep) - normalisedDelta(otherSweep)) <= 1e-3;

  /*
   * BOTH WALLS MUST HAVE THE WALL'S SIGNED SWEEP, whether or not their written
   * start angles happen to be the same angle. The renderer draws both from the
   * SAME start angle, so that is the ordinary case - but a hand-edited pair may
   * start elsewhere, and `normalisedDelta` compares the turns rather than the
   * numbers.
   */
  if (!sameSweep || Math.abs(normalisedDelta(sweep)) < 1e-3) {
    return null;
  }

  const signedSweep = normalisedDelta(sweep);

  const radii = [a.radius, b.radius].sort((left, right) => left - right);

  const separation = radii[1] - radii[0];

  if (!(separation > 0)) {
    return null;
  }

  const radius = (radii[0] + radii[1]) / 2;

  /* Mid-arc points on the centre circle, and their half-radius, give the chord. */
  const radians = (start * Math.PI) / 180;
  const radiansEnd = ((start + signedSweep) * Math.PI) / 180;

  const centre = { x: a.centre.x, y: a.centre.y };

  const tangentStart = {
    x: centre.x + radius * Math.cos(radians),
    y: centre.y + radius * Math.sin(radians)
  };

  const tangentEnd = {
    x: centre.x + radius * Math.cos(radiansEnd),
    y: centre.y + radius * Math.sin(radiansEnd)
  };

  /*
   * THE CORNER IS THE ARMS' INTERSECTION.
   *
   * Each arm leaves its tangent point IN THE DIRECTION THE BEND RUNS: through
   * the corner, out to that end. Taking the circle's tangent there and pointing
   * it so the two arms approach each other is what puts them on the outer side
   * of the bend, where the corner of a fitting physically is - for a 90 degree
   * bend they meet at a square corner `radius * tan(45)` from each tangent point,
   * which is the shape the student reads.
   *
   * THE TWO CONSTRUCTIONS MUST AGREE. Building the corner from each tangent point
   * independently, and requiring the two to land on the SAME point, is what
   * refuses a pair of arcs that is not one bend rather than drawing a fitting
   * with a kink in it.
   */
  const bend = Math.abs(signedSweep);

  const reach = radius * Math.tan((bend * Math.PI) / 360);

  const cornerFromStart = {
    x: tangentStart.x + Math.sin(radians) * reach,
    y: tangentStart.y - Math.cos(radians) * reach
  };

  const cornerFromEnd = {
    x: tangentEnd.x - Math.sin(radiansEnd) * reach,
    y: tangentEnd.y + Math.cos(radiansEnd) * reach
  };

  /*
   * The two constructions must agree: a pair of arcs whose arms do not meet is
   * not one bend, and is refused rather than drawn as a fitting with a kink.
   */
  const error = Math.hypot(cornerFromStart.x - cornerFromEnd.x, cornerFromStart.y - cornerFromEnd.y);

  if (error > 1e-3 * Math.max(1, radius)) {
    return null;
  }

  return {
    position: cornerFromStart,
    ends: { a: tangentStart, b: tangentEnd },
    previous: tangentStart,
    next: tangentEnd,
    bendRadius: radius,
    angleDegrees: bend,
    separation: separation - enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION
  };
}

/*
 * ONE WRITTEN WALL AS A CIRCULAR ARC.
 *
 * An `arc` statement is already one. A SAMPLED path - the polyline the writer
 * emits for a taper - is fitted to the circle through its two ends and its middle
 * point, which is exact for the arc it was sampled from. Anything else (a line, a
 * mix of chords and arcs) is not a wall and answers null.
 */
function shapeAsArc(shape) {
  if (shape?.type === "arc") {
    /*
     * A SIGNED SWEEP. TikZ's `delta angle` carries the direction the arc turns;
     * without it a bend written with a negative delta would come back mirrored,
     * because `endAngle` alone does not say which way round it ran.
     */
    const delta = Number(shape.deltaAngle);

    return {
      centre: { x: shape.centre.x, y: shape.centre.y },
      radius: shape.radius,
      startAngle: shape.startAngle,
      endAngle: shape.startAngle + (Number.isFinite(delta) ? delta : shape.endAngle - shape.startAngle)
    };
  }

  if (shape?.type !== "polyline" || !Array.isArray(shape.points) || shape.points.length < 3) {
    return null;
  }

  const points = shape.points;

  const first = points[0];
  const middle = points[Math.floor((points.length - 1) / 2)];
  const last = points[points.length - 1];

  const circle = circleThrough(first, middle, last);

  if (!circle) {
    return null;
  }

  /* A wall must be a curve, not a straight chord between two collinear ends. */
  const sagitta = Math.abs(Math.hypot(middle.x - circle.centre.x, middle.y - circle.centre.y) - circle.radius);

  if (sagitta > 1e-3) {
    return null;
  }

  const startAngle = (Math.atan2(first.y - circle.centre.y, first.x - circle.centre.x) * 180) / Math.PI;
  const endAngle = (Math.atan2(last.y - circle.centre.y, last.x - circle.centre.x) * 180) / Math.PI;

  return {
    centre: circle.centre,
    radius: circle.radius,
    startAngle,
    endAngle
  };
}

/* The shortest signed turn from one angle to another, in degrees. */
function normalisedDelta(degrees) {
  let value = degrees;

  while (value > 180) value -= 360;
  while (value < -180) value += 360;

  return value;
}

void normalisedDelta;

/* The `++(from:r)` a TikZ arc is drawn from, when the statement carries one. */
function polarOffsetOf(arc) {
  if (!arc) {
    return null;
  }

  const from = Number(arc.polarAngle);
  const delta = Number(arc.deltaAngle);

  if (!Number.isFinite(from) || !Number.isFinite(delta)) {
    return null;
  }

  return { angle: from, delta };
}

void polarOffsetOf;

/* The circle through three points, or null when they are collinear. */
function circleThrough(a, b, c) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));

  if (Math.abs(d) < 1e-12) {
    return null;
  }

  const aSq = a.x * a.x + a.y * a.y;
  const bSq = b.x * b.x + b.y * b.y;
  const cSq = c.x * c.x + c.y * c.y;

  const centre = {
    x: (aSq * (b.y - c.y) + bSq * (c.y - a.y) + cSq * (a.y - b.y)) / d,
    y: (aSq * (c.x - b.x) + bSq * (a.x - c.x) + cSq * (b.x - a.x)) / d
  };

  return { centre, radius: Math.hypot(a.x - centre.x, a.y - centre.y) };
}

/* An elbow object from the two walls of a fitting, or null. */
function createElbowFromPaths(shape, previous) {
  const created = enggPipeDuct.createElbow({
    geometry: {
      position: shape.position,
      ends: shape.ends,
      previous: shape.previous,
      next: shape.next
    },
    angleDegrees: shape.angleDegrees,
    engineering: {
      bendRadius: shape.bendRadius,
      angleDegrees: shape.angleDegrees,
      generated: false,
      connections: [null, null]
    },
    id: previous ? previous.id : undefined,
    name: previous ? previous.name : undefined,
    style: previous ? { ...(previous.style || {}) } : {}
  });

  if (!created) {
    return null;
  }

  return created;
}

/* The type an object must have for `shape`, when it can have it. */
function convertedTypeFor(shape, previous) {
  if (!shape || !CONVERTIBLE.has(shape.type)) {
    return null;
  }

  /*
   * AN EXISTING STRUCTURED OBJECT KEEPS ITS OWN TYPE. A beam that happens to be
   * drawn as a straight line must not become a plain Line because one of its
   * statements is a `\draw (a) -- (b)`: the block belongs to a beam, and the
   * beam's writer is what must rewrite it.
   */
  if (previous && previous.type !== shape.type) {
    return null;
  }

  return shape.type;
}

/*
 * THE TYPES THE SCHEMATIC READERS MAY REBUILD.
 *
 * A block is only asked what it is when it is new or when it already belongs to
 * one of these - so an ordinary Line is never re-read as something else because
 * a comment happens to carry DAETUM metadata.
 */
const SCHEMATIC_TYPES = new Set([
  "reducer-expander",
  "pump",
  "valve",
  "flow-meter",
  "reservoir-tank",
  "fluid-level",
  "flow-direction-diagram",
  "pressure-profile",
  "flow-profile",
  "section-plane"
]);

function isSchematicType(type) {
  return SCHEMATIC_TYPES.has(type);
}

/* A block that draws an arrowhead: a two-point shaft and a closed three-point head. */
function looksLikeArrow(body) {
  const closed = /\([^)]*\)\s*--\s*\([^)]*\)\s*--\s*\([^)]*\)\s*--\s*cycle/.test(String(body ?? ""));
  const open = /\([^)]*\)\s*--\s*\([^)]*\)\s*;/.test(String(body ?? ""));

  return closed && open;
}

/* ============================================================
 * THE READ
 * ============================================================
 *
 * Returns { updates, created, removed, invalid, unsupported }:
 *
 *   updates      existing objects whose block now describes a different shape
 *   created      new objects the source describes and the model does not have
 *   removed      objects whose block is gone AND whose absence is a deliberate
 *                deletion (their block was removed, not broken)
 *   invalid      blocks whose statements do not parse, with their ranges
 *   unsupported  blocks whose statements parse but cannot become objects
 *
 * THE READER NEVER WRITES. The caller decides what to do with the result; that
 * separation is what lets the Source tab preview a parse without touching the
 * document.
 */
export function readSourceIntoModel({ source, map, objects = [], isEditing = () => false }) {
  const text = String(source ?? "");
  const contents = blockContents(text, map);

  const byId = new Map(objects.map((object) => [object.id, object]));
  const seen = new Set();

  const updates = [];
  const created = [];
  const invalid = [];
  const unsupported = [];

  contents.blocks.forEach((block) => {
    const previous = byId.get(block.id);

    if (!block.statements.length) {
      /*
       * AN EMPTY BLOCK. Either the markers exist with nothing between them - a
       * block the model wrote that has no commands - or every statement in it
       * was removed. Neither is evidence of a deliberate deletion on its own, so
       * the object is left as it is.
       */
      return;
    }

    seen.add(block.id);

    const broken = block.statements.find((statement) => !statement.complete);

    if (broken) {
      invalid.push({
        id: block.id,
        beginLine: block.beginLine,
        endLine: block.endLine,
        message: `Object "${previous?.name || block.id}" keeps its last valid form: line ${broken.startLine + 1} is incomplete.`
      });
      return;
    }

    const shapes = block.statements.map((statement) => statement.shape);

    /*
     * ============================================================
     * A FLOW ARROW: A HEAD PLUS ITS ATTACHMENT
     * ============================================================
     *
     * An arrow's block is a closed arrowhead, so it would fall through to the
     * one-shape rule and come back as a TRIANGLE - a shape with no host, no
     * direction and no size, which is not the object the student has.
     *
     * It is recognised BEFORE that rule, from the metadata the writer emits
     * (see `source-readers/fluids.js`). A block that is an arrow and cannot be
     * rebuilt - a host that is not in the drawing, an `ALONG` that is not a
     * number, a statement that is not a head - falls through to the ordinary
     * report: the object keeps its last valid form and the block is listed as
     * unsupported with its own line numbers.
     */
    const blockText = [block.header || "", block.body].filter(Boolean).join("\n");

    const mayBeArrow =
      (previous == null || previous?.type === "flow-arrow") &&

      /*
       * THE COMPACT FORM THE WRITER EMITS, and the three-line form a document
       * saved before it carries. Both name the arrow's pipe, so either is
       * enough to attempt a read; a block that fails the read falls through to
       * the ordinary report like any other unsupported edit.
       */
      /^[ \t]*%[ \t]*DAETUM[ \t]+(ATTACH|HOST)[ \t]*:/m.test(blockText);

    const arrow = mayBeArrow
      ? readFlowArrowBlock(blockText, {
          previous,
          objects,
          hostExists: (hostId) =>
            byId.has(hostId) || objects.some((object) => object?.id === hostId)
        })
      : null;

    /*
     * ============================================================
     * THE SCHEMATIC TOOLS
     * ============================================================
     *
     * Each of the schematics added after the flow paths writes ONE metadata line
     * naming what it is and what it joins, and CODE that draws it. They are read
     * HERE, before the one-shape rule, because a symbol's picture is not its
     * model: a pump's circle, a profile's polyline and a valve's bow-tie would
     * otherwise come back as generic geometry with nothing connecting them.
     *
     * A block whose metadata is unreadable, or whose host is not in the drawing,
     * falls through to the ordinary report - the object keeps its last valid form
     * and the student is told the block could not be read.
     */
    /*
     * THE READER IS CHOSEN FROM THE WHOLE BLOCK, not its commands.
     *
     * A schematic's metadata sits in the block's HEADER (`% DAETUM VESSEL: ...`),
     * above the geometry, so asking only the body would never see it. The header
     * is where the block says what it is - which is exactly the question.
     */

    const schematicReader = previous == null || isSchematicType(previous?.type)
      ? schematicReaderFor(blockText)
      : null;

    const schematic = schematicReader
      ? schematicReader(blockText, {
          previous,
          hostExists: (hostId) => byId.has(hostId) || contents.blocks.some(candidate => candidate.id === hostId)
        })
      : null;

    if (schematic) {
      if (!previous) {
        /*
         * A NEW BLOCK: the object is the block's own model, carrying the
         * block's id - so the block keeps naming it on the next parse. The
         * engineering travels as `content` as well, because the factory that
         * builds the feature copies it out of there.
         */
        created.push({
          id: block.id,
          object: {
            ...schematic,
            id: block.id,
            style: { ...(schematic.style || {}) },
            engineering: { ...(schematic.engineering || {}) },
            content: { ...(schematic.engineering || {}) }
          },
          geometry: schematic.geometry,
          block
        });
        return;
      }

      updates.push({
        id: block.id,
        object: previous,
        schematic,
        type: schematic.type,
        block
      });

      return;
    }

    if (schematicReader && /DAETUM\s+REDUCER:/.test(blockText)) {
      invalid.push({ id: block.id, beginLine: block.beginLine, endLine: block.endLine,
        message: 'Reducer / Expander keeps its last valid form: invalid dimensions, route, or connections.' });
      return;
    }

    /* A FREE FLOW ARROW: a shaft plus a head, with no attachment to anything. */
    const attachedBlock = /^[ \t]*%[ \t]*DAETUM[ \t]+(ATTACH|HOST)[ \t]*:/m.test(blockText);

    const freeArrow =
      !attachedBlock &&
      (previous == null || (previous?.type === "flow-arrow" && !previous.attachment)) &&
      looksLikeArrow(block.body)
        ? readFreeFlowArrow(block.body, { previous })
        : null;

    if (freeArrow) {
        if (!previous) {
          created.push({ id: block.id, object: { ...freeArrow, id: block.id }, geometry: freeArrow.geometry, block });

          return;
        }

        updates.push({ id: block.id, object: previous, schematic: freeArrow, type: "flow-arrow", block });

      return;
    }

    if (arrow) {
      if (!previous) {
        const object = createFlowArrowFromSource(arrow, objects);

        if (object) {
          created.push({ id: block.id, object, block });
        }

        return;
      }

      updates.push({
        id: block.id,
        object: previous,
        shape: arrow,
        type: "flow-arrow",
        block
      });

      return;
    }

    /*
     * A PIPE / DUCT: TWO PARALLEL WALLS, ONE RUN.
     *
     * Recognised BEFORE the one-shape rule, because a pipe is never a single
     * statement. Its two walls are the supported syntax for the tool - see
     * `pipeFromWalls` - and a pair that does not make a pipe falls through to
     * the ordinary report rather than being silently taken as two lines.
     */
    const pipeBody = block.body.replace(/^[ \t]*\\definecolor\{[^}]*\}\{[^}]*\}\{[^}]*\}[ \t]*$/gm, "");
    const pipeShapes = splitStatements(pipeBody).map(statement => shapeFromStatement(pipeBody.slice(statement.start,statement.end)));
    const walls = previous == null || previous?.type === "pipe-duct"
      ? pipeFromWalls(pipeShapes)
      : null;

    if (walls) {
      walls.sourceStyle = baseStyleFromSource(block.body, previous?.style);
      if (!previous) {
        const object = createPipeFromWalls(walls);
        if (object) object.style = walls.sourceStyle;

        if (object) {
          created.push({ id: block.id, object, block });
        }

        return;
      }

      updates.push({
        id: block.id,
        object: previous,
        shape: walls,
        type: "pipe-duct",
        block
      });

      return;
    }

    /*
     * AN ELBOW: TWO CURVED WALLS, ONE FITTING.
     *
     * Recognised the same way a pipe's two walls are - before the one-shape rule,
     * because a fitting is never a single statement - and kept as ONE object.
     * Two paths that are not the two walls of one bend fall through to the
     * ordinary report, so an unsupported edit is explained rather than silently
     * splitting the fitting into two lines.
     */
    const elbowShape = previous == null || previous?.type === "elbow"
      ? elbowShapeFromPaths(shapes)
      : null;

    if (elbowShape) {
      if (!previous) {
        const object = createElbowFromPaths(elbowShape, null);

        if (object) {
          created.push({ id: block.id, object, block });
        }

        return;
      }

      updates.push({
        id: block.id,
        object: previous,
        shape: elbowShape,
        type: "elbow",
        block
      });

      return;
    }

    const single = shapes.length === 1;
    const shape = single ? shapes[0] : null;
    const type = single ? convertedTypeFor(shape, previous) : null;

    if (!type) {
      unsupported.push({
        id: block.id,
        beginLine: block.beginLine,
        endLine: block.endLine,
        body: block.body,
        message: previous
          ? `Object "${previous.name || block.id}" is shown as it was last valid: its new code is not a shape DAETUM can edit.`
          : "This block is not a shape DAETUM can edit. It is rendered as written."
      });
      return;
    }

    if (!previous) {
      const object = createObjectFromShape(type, shape, null);

      if (object) {
        created.push({ id: block.id, object, block });
      }

      return;
    }

    /*
     * A PATCH, NOT A REPLACEMENT. The new geometry and the new appearance are
     * merged into the object the model already holds, so every field a source
     * statement cannot express (a name, a label, a relationship, an engineering
     * role) survives.
     */
    updates.push({
      id: block.id,
      object: previous,
      shape,
      type,
      block
    });
  });

  /*
   * A BLOCK THAT IS GONE IS A DELETION - but only when the student is not in
   * the middle of editing. A re-parse while they type must never remove an
   * object whose block is momentarily not yet written.
   */
  const removed = isEditing()
    ? []
    : objects
        .filter((object) => !seen.has(object.id))
        .filter((object) => !parseBlockExists(text, object.id))
        .map((object) => object.id);

  return { updates, created, removed, invalid, unsupported };
}

/*
 * THE STATEMENTS OUTSIDE ANY BLOCK, as [first, last] statement index pairs.
 *
 * Custom TikZ belongs to nobody until DAETUM gives it a block. While the source
 * has SOME markers, unclaimed statements are the student's own drawing code and
 * are left exactly as they are - claiming one would rewrite their layout the
 * next time an object elsewhere changed. When the source has NO markers at all,
 * every command in the picture is a drawing statement (typed by hand or pasted),
 * and those are adopted - see `adoptUnclaimedStatements`.
 */
export function hasObjectMarkers(source) {
  return /^\s*%\s*DAETUM_OBJECT_(BEGIN|END)\b/m.test(String(source ?? ""));
}

/*
 * WHETHER EVERY COMMAND IN A PICTURE IS COMPLETE.
 *
 * THE SPLITTER CUTS A COMMAND AT THE NEXT LINE when it has no `;`, and reports it
 * `complete` so recovery can still send it. That is right for a diagnostic and
 * wrong for "has the student finished typing": an unterminated line is a line in
 * progress.
 *
 * EVERY OTHER KIND OF BREAKAGE IS FINE. A coordinate the parser cannot read, a
 * command it does not understand - those statements are preserved as written and
 * simply not turned into objects, which is exactly what adoption is for.
 */
function sourceIsWholePicture(text) {
  const statements = splitStatements(String(text ?? ""));

  const commands = statements.filter((statement) => statement.kind === "command");

  if (!commands.length) {
    return false;
  }

  return commands.every((statement) => statement.complete);
}

export { sourceIsWholePicture };

/*
 * ADOPT ONLY THE COMMANDS THE STUDENT JUST AUTHORED.
 *
 * The Source tab is a view of the DRAWING, so a command typed into it must become
 * a feature the student can click, drag and delete - exactly like one drawn on
 * the canvas. But rebuilding a whole typed picture on every keystroke would put
 * objects on the sheet the moment they were imagined.
 *
 * So adoption happens where the student ACTED: the command at the cursor (or the
 * one it is inside), when that command is complete and has no block yet. The line
 * is wrapped in the ordinary header, its own text untouched, and the object
 * arrives through the same parse a canvas edit uses.
 *
 * `caretLine` is the caret's line in the VISIBLE text; the caller maps it into
 * the canonical text, because the visible text has the headers stripped.
 */
export function adoptFollowedStatements(source, { caretLine = null, adoptAll = false, candidates = [] } = {}) {
  const text = String(source ?? "");

  if (!adoptAll && !Number.isFinite(Number(caretLine))) {
    return text;
  }

  const blocks = parseDrawingSource(text);
  const statements = splitStatements(text);

  const within = (line, block) => line >= block.beginLine && line <= block.endLine;

  const followed = statements.filter(
    (statement) =>
      statement.kind === "command" &&
      statement.complete &&
      (adoptAll || (statement.startLine <= caretLine && statement.endLine >= caretLine)) &&
      shapeFromStatement(statement.text) &&
      !blocks.some((block) => within(statement.startLine, block))
  );

  if (!followed.length) {
    return text;
  }

  /*
   * RE-USE THE ADOPTER BY HANDING IT A PICTURE WITH NO BLOCKS. It already knows
   * how to claim an id, avoid a duplicate header and preserve the command text,
   * and running it on the command's own lines keeps that logic in one place.
   */
  const lines = statements.length
    ? text.replace(/\r\n/g, "\n").split("\n")
    : [];

  const used = new Set(blocks.map((block) => block.id));
  const inserts = [];

  followed.forEach((statement) => {
    const shape = shapeFromStatement(statement.text);

    const match = (candidates || []).find(
      (candidate) =>
        !candidate.taken &&
        candidate.type === shape.type &&
        commandLines(candidate.source) === commandLines(statement.text)
    );

    let id = match ? match.id : stableBlockId(statement.startLine, statement.text);

    while (used.has(id)) {
      id = `${id}-1`;
    }

    used.add(id);

    if (match) {
      match.taken = true;
    }

    inserts.push({
      line: statement.startLine,
      before: [
        `% DAETUM OBJECT: ${objectTypeLabel(shape.type)}`,
        `% DAETUM ID: ${id}`,
        `% DAETUM TYPE: ${shape.type}`
      ]
    });
  });

  const out = [];

  lines.forEach((line, index) => {
    inserts
      .filter((entry) => entry.line === index)
      .forEach((entry) => out.push(...entry.before));

    out.push(line);
  });

  return out.join("\n");
}

/* The command lines in a piece of source - the `\definecolor` preludes dropped. */
function commandLines(source) {
  return String(source ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("\\") && !/^\\definecolor\b/.test(line))
    .join("\n");
}

/*
 * WHETHER A TYPED COMMAND DESCRIBES THE SAME SHAPE AS AN OBJECT.
 *
 * Retyping a command that the drawing already holds is the ordinary way a
 * student changes it - "delete the line, type it again" - and the new command
 * must be the SAME object, not a second one. Text alone is not enough to
 * recognise it: the writer emits its colour as a local definition
 * (`draw=daetumC193335`) while a hand-typed command may say `black` or name a
 * colour the object has since changed. The geometry is the same, so the geometry
 * decides - and the appearance, which the writer owns, is then re-emitted from
 * the object below.
 */
function sameGeometry(candidate, shape) {
  const object = candidate.object;
  const geometry = object && object.geometry;

  if (!geometry) {
    return false;
  }

  const close = (left, right) =>
    Math.abs(Number(left) - Number(right)) < 1e-6 && Object.is(Number(left), Number(left));

  const samePoint = (left, right) =>
    Boolean(left && right && close(left.x, right.x) && close(left.y, right.y));

  switch (shape.type) {
    case "line":
      return samePoint(geometry.start, shape.from) && samePoint(geometry.end, shape.to);
    case "circle":
      return samePoint(geometry.center, shape.centre) && close(geometry.radius, shape.radius);
    case "rectangle":
      return close(geometry.width, Math.abs(shape.to.x - shape.from.x));
    case "point":
      return samePoint(geometry.position, shape.position);
    default:
      return false;
  }
}

/*
 * ADOPT THE COMMANDS NO BLOCK CLAIMS.
 *
 * A student who types (or pastes) a picture expects what they drew to be
 * editable: to click the line, drag it, change its colour. Nothing does that
 * unless the statement has a block and an id, so this wraps each unclaimed
 * command in one - leaving the command's own text character for character, and
 * leaving the markers on their own lines.
 *
 * THE LINES ALREADY CLAIMED ARE LEFT ALONE. Inside an object's block the
 * command belongs to that object, and adoption there would replace a structured
 * object with a generic one. Outside every block, the command is nobody's: it is
 * the student's own drawing code - the line they just typed, or a picture pasted
 * whole - and it is adopted.
 *
 * ONLY statements that become a shape are adopted. A pattern, a curve or a
 * command DAETUM does not understand gets no block: it has no object to become,
 * and a block would only put markers round code nobody can edit.
 */
	export function adoptUnclaimedStatements(source, { newId, candidates = [], trackedLength = null } = {}) {
  const text = String(source ?? "");
  const blocks = parseDrawingSource(text);
  const statements = splitStatements(text);

  /*
   * ADOPTION IS FOR A PICTURE THAT HAS NO BLOCKS AT ALL.
   *
   * A source that already carries DAETUM object blocks is the document's own:
   * its commands belong to the objects those blocks name, so anything outside
   * them is preserved VERBATIM - wrapping it in a header would change text the
   * student never asked to have changed.
   *
   * A PICTURE STILL BEING TYPED IS LEFT ALONE TOO. One that will not compile -
   * an unclosed parenthesis, a line with no `;` - cannot be adopted without
   * rewriting text the model only half understands, and the student's latest
   * text is never to be rewritten.
   *
   * AND ONE HOLDING A STATEMENT THE PARSER CANNOT FULLY READ IS LEFT ALONE, for
   * the same reason: adopting half of it would put a header between two lines
   * that belong together.
   */
  if (blocks.length) {
  	return text;
  }

  /*
   * A PICTURE IS ADOPTED WHEN IT WILL COMPILE.
   *
   * A source with no object blocks at all - typed, pasted, or a `.tex` opened
   * from elsewhere - has nothing to click on the canvas, so its commands are
   * wrapped and become objects. A picture with a command whose braces, brackets
   * or parentheses are still open cannot be sent to TeX, and wrapping half a
   * statement in a header would change text DAETUM cannot make anything of - so
   * that one is left exactly as the student typed it.
   */
  if (!sourceIsWholePicture(text)) {
  	return text;
  }

  const within = (line, block) => line >= block.beginLine && line <= block.endLine;

  const commands = statements.filter(
    (statement) =>
      statement.kind === "command" &&
      statement.complete &&
      shapeFromStatement(statement.text) &&
      !blocks.some((block) => within(statement.startLine, block))
  );

  if (!commands.length) {
    return text;
  }

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const inserts = [];
  const used = new Set(blocks.map((block) => block.id));

  /*
   * THE IDS AN UNCLAIMED COMMAND MAY ALREADY HAVE.
   *
   * Retyping a line the drawing already holds is the ordinary way a student
   * changes it: delete the old command, type the new one. The new command is
   * the SAME object, not a second one - so a candidate object whose statement
   * the code now says the same thing as is given THAT object's id. The caller
   * supplies the candidates, because it is the only thing that knows the model.
   */
  const claimable = Array.isArray(candidates) ? candidates : [];

  commands.forEach((statement, index) => {
    const shape = shapeFromStatement(statement.text);

    /*
     * THE COMPARISON IS BETWEEN THE COMMANDS, NOT THE WRITERS' OUTPUT.
     *
     * A writer's source can carry a `\definecolor{...}` line above its `\draw`,
     * and the student typing the same line back does not write that definition.
     * Comparing the whole candidate text would then never match, and retyping a
     * line would duplicate its object. So the candidate's COMMAND lines are
     * compared, and so are the student's - the definition only matters to TeX.
     *
     * A LITERAL MATCH IS ONLY THE FAST PATH. The writer's text is in EXPORT
     * space (the drawing is normalised for the page) while the student types
     * MODEL coordinates, so the two texts rarely agree character for character.
     * The GEOMETRY comparison below is the authority: it reads the student's
     * shape and the object's own stored geometry, both in model space, so a
     * re-typed command claims its object whether or not its numbers happen to
     * look the same.
     */
    const commandText = commandLines(statement.text);

    const match = claimable.find(
      (candidate) =>
        !candidate.taken &&
        candidate.type === shape.type &&
        (commandLines(candidate.source) === commandText || sameGeometry(candidate, shape))
    );

    let id = match ? match.id : newId ? newId(index, shape) : stableBlockId(index, statement.text);

    if (match) {
      match.taken = true;
    }

    /* The same command typed twice must not share an id. */
    while (!match && used.has(id)) {
      id = `${id}-${index + 1}`;
    }

    used.add(id);

    /*
     * THE SAME READABLE HEADER THE WRITERS EMIT, so a block adopted from typed
     * code is indistinguishable from one DAETUM generated - and the next edit
     * of that object rewrites it in place instead of duplicating it.
     */
    inserts.push({
      line: statement.startLine,
      before: [
        `% DAETUM OBJECT: ${objectTypeLabel(shape.type)}`,
        `% DAETUM ID: ${id}`,
        `% DAETUM TYPE: ${shape.type}`
      ]
    });
  });

  /*
   * THE PICTURE'S OPENING STATEMENT IS PASSED THROUGH WHOLE. The header of the
   * first command must sit INSIDE the picture, below `\\begin{tikzpicture}` -
   * never above it, and never above a blank line the picture itself writes.
   */
  const out = [];
  let opening = true;

  lines.forEach((line, index) => {
    if (opening) {
      const isBegin = /^\s*\\begin\s*\{tikzpicture\}/.test(line);
      const isContinuation = /^\s*\[/.test(line) && !/\]\s*$/.test(line);

      if (isBegin || isContinuation || !String(line).trim()) {
        out.push(line);
        return;
      }

      opening = false;
    }

    const before = inserts.filter((entry) => entry.line === index && entry.before);

    /*
     * NOTHING IS ADDED BETWEEN THE STUDENT'S LINES. The header is written above
     * its command and the picture's own spacing already separates one object
     * from the next, so adoption never invents a blank line of its own - which
     * would show up as a change the student never made.
     */

    before.forEach((entry) => {
      out.push(...entry.before);
      entry.written = true;
    });

    out.push(line);
  });

  /*
   * A HEADER WHOSE TARGET LINE THE OPENING TOOK. The first command's own line
   * IS the opening line in a picture that was typed whole, so its header is
   * written just above that command rather than above the picture.
   */
  const pending = inserts.filter((entry) => entry.before && !entry.written);

  if (pending.length) {
    const commandAt = out.findIndex(
      (written, index) =>
        index > 0 &&
        /^\s*\\/.test(written) &&
        !/^\s*\\(begin|end)\s*\{tikzpicture\}/.test(written)
    );

    const closingAt = out.findIndex((written) => /^\s*\\end\s*\{tikzpicture\}/.test(written));

    const at = commandAt >= 0 ? commandAt : closingAt < 0 ? out.length : closingAt;

    pending.forEach((entry) => {
      out.splice(at, 0, ...entry.before);
    });
  }

  return collapseBlankRuns(out).join("\n");
}

/*
 * ONE BLANK LINE AT MOST, and none directly after the picture's opening line.
 * A header is set directly above its command, so an empty line between the
 * environment and the first header would separate the object from its picture.
 */
function collapseBlankRuns(list) {
  const out = [];

  let insideBlock = false;

  list.forEach((line) => {
    const text = String(line);

    const header = /^\s*%\s*DAETUM\s+OBJECT\s*:/.test(text);

    /*
     * A BLANK LINE INSIDE AN OBJECT IS THE STUDENT'S - OR ONE A MERGE CREATED.
     *
     * The collapse exists for spacing BETWEEN objects. Applying it inside a
     * block would delete a blank line the student typed in the middle of their
     * own code, and adoption would then change text nobody asked it to touch.
     */
    if (insideBlock || header) {
      out.push(line);

      /* A new header starts a NEW block; the picture's close ends the last. */
      insideBlock = !/^\s*\\end\s*\{tikzpicture\}/.test(text);

      return;
    }

    const blank = text.trim() === "";
    const previousBlank = out.length > 0 && String(out[out.length - 1]).trim() === "";
    const afterOpening = out.length === 1 && /^\s*\\begin\s*\{tikzpicture\}/.test(String(out[0]));

    if (blank && (previousBlank || afterOpening)) {
      return;
    }

    out.push(line);
  });

  return out;
}

/* Whether the source still holds the block's markers at all. */
function parseBlockExists(text, id) {
  return parseDrawingSource(text).some((block) => block.id === id);
}

/* ============================================================
 * THE WRITE
 * ============================================================
 *
 * Rewrite ONE object's region from the model. Returns the new source, or the
 * source unchanged when the object has no writer.
 */
export function sourceForObjectRegion(object, source, context = {}) {
  const commands = sourceForObject(object, context);

  if (typeof commands !== "string" || !commands.trim()) {
    /*
     * NO WRITER CLAIMED IT. The block is the student's own code and is left
     * exactly as it is - the alternative would be to delete a region because
     * DAETUM could not rewrite it, which is the opposite of preserving their
     * work.
     */
    return String(source ?? "");
  }

  return setObjectRegion(String(source ?? ""), object.id, object.type, commands, {
    name: objectDisplayName(object, { type: object.type }),
  });
}

/* Remove one object's block from the source. */
export function removeObjectBlock(source, objectId) {
  return removeObjectRegion(String(source ?? ""), objectId);
}

/* ============================================================
 * SOURCE THAT IS NOT INSIDE ANY BLOCK
 * ============================================================
 *
 * The blocks the source reader handles are the ones DAETUM wrote. Custom TikZ
 * the student typed outside a block has no id, so it is preserved, rendered, and
 * never claimed - and that is deliberate: an object invented for it could not be
 * written back, and the next parse would then disagree with itself.
 */
export function unclaimedStatements(source) {
  const text = String(source ?? "");
  const map = {
    blocks: []
  };

  void map;

  return text.split("\n").filter((line) => line.trim().startsWith("\\"));
}

/* A fresh picture, for a document that has none. */
export function ensurePicture(source) {
  const text = String(source ?? "");

  return text.trim() ? text : emptyDrawingSource();
}

/* The shape a block describes, for a caller that wants to inspect one. */
export function blockShape(source, objectId) {
  const text = String(source ?? "");
  const map = { blocks: parseDrawingSource(text) };
  const contents = blockContents(text, map);
  const block = contents.blocks.find((entry) => entry.id === objectId);

  return block && block.statements.length === 1 ? shapeFromStatement(block.statements[0].text) : null;
}

/* A stable id for a custom statement, used when one has to be referenced. */
export { stableBlockId };

export default {
  setSourceGeometryFactories,
  setFlowArrowSourceReader,
  adoptUnclaimedStatements,
  adoptFollowedStatements,
  sourceIsWholePicture,
  readSourceIntoModel,
  sourceForObjectRegion,
  removeObjectBlock,
  blockShape
};
