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

  if (!table) {
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
     * A PIPE / DUCT: TWO PARALLEL WALLS, ONE RUN.
     *
     * Recognised BEFORE the one-shape rule, because a pipe is never a single
     * statement. Its two walls are the supported syntax for the tool - see
     * `pipeFromWalls` - and a pair that does not make a pipe falls through to
     * the ordinary report rather than being silently taken as two lines.
     */
    const walls = previous === null || previous?.type === "pipe-duct"
      ? pipeFromWalls(shapes)
      : null;

    if (walls) {
      if (!previous) {
        const object = createPipeFromWalls(walls);

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
export function adoptUnclaimedStatements(source, { newId, candidates = [] } = {}) {
  const text = String(source ?? "");
  const blocks = parseDrawingSource(text);
  const statements = splitStatements(text);

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

  list.forEach((line) => {
    const blank = String(line).trim() === "";
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
  readSourceIntoModel,
  sourceForObjectRegion,
  removeObjectBlock,
  blockShape
};
