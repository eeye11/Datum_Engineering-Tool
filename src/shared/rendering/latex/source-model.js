/*
 * ============================================================
 * DRAWING SOURCE -> EDITABLE OBJECTS
 * ============================================================
 *
 * The half of the mapping that reads the student's TikZ back into structured
 * objects.
 *
 * WHY IT EXISTS.
 *
 * The source IS the document. The student types a `\draw`, and that line should
 * become a line on the canvas they can click, drag and delete - not a picture no
 * tool can reach. So a supported statement inside an object's block is converted
 * into the model's own object, and the object is then written back by the
 * writers as if it had been drawn with the tool.
 *
 * WHAT IT IS NOT.
 *
 * It is not a TikZ interpreter. It recognises the SUPPORTED commands - the ones
 * DAETUM's own writers produce and the student is documented to type: a straight
 * line, a circle, a rectangle, an arc, a node/point - and returns `null` for
 * everything else. A `null` is not a failure: the statement stays in the source,
 * TeX still renders it, and no object is invented from it. Converting arbitrary
 * TikZ into DAETUM geometry and back would not be round-trip safe, and a command
 * turned into the wrong shape is worse than a command with no handles.
 *
 * THE PARSER IS DELIBERATELY SMALL.
 *
 * Every reading below is one shape, stated in one place. Anything the parser is
 * unsure about (a curve, a mixed path, a coordinate that is an expression) reads
 * as "not a shape", so the statement is preserved and rendered but not claimed.
 */

import { splitStatements } from "./source-statements.js";

const PATH_COMMANDS = new Set(["draw", "fill", "filldraw", "shade", "shadedraw", "clip", "path"]);

/* ============================================================
 * SMALL TEXT HELPERS
 * ============================================================ */

/* The index just after the group that opens at `index`. */
function endOfGroup(text, index, open, close) {
  let depth = 0;

  for (let at = index; at < text.length; at += 1) {
    const character = text[at];

    if (character === "\\") {
      at += 1;
      continue;
    }

    if (character === open) {
      depth += 1;
    } else if (character === close) {
      depth -= 1;

      if (depth === 0) {
        return at + 1;
      }
    }
  }

  return text.length;
}

/* The index just after the `[...]` that opens at `index`, nesting-aware. */
/* The first non-space character at or after `index`, or "". */
function nextNonSpace(text, index) {
  for (let at = index; at < text.length; at += 1) {
    if (!/\s/.test(text[at])) {
      return text[at];
    }
  }

  return "";
}

function afterOptions(text, index) {
  return text[index] === "[" ? endOfGroup(text, index, "[", "]") : index;
}

/* The contents of the `[...]` at `index`, or "". */
function optionsAt(text, index) {
  if (text[index] !== "[") {
    return "";
  }

  const end = afterOptions(text, index);

  return text.slice(index + 1, Math.max(index + 1, end - 1));
}

/* A coordinate `x,y` with an optional unit. Null when it is an expression. */
function coordinateValue(text) {
  const parts = String(text ?? "").split(",");

  if (parts.length !== 2) {
    return null;
  }

  const number = (part) => {
    const cleaned = part.trim().replace(/\s*(mm|cm|pt)$/, "");

    return /^-?\d+(?:\.\d+)?$/.test(cleaned) ? Number(cleaned) : NaN;
  };

  const x = number(parts[0]);
  const y = number(parts[1]);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return { x, y };
}

/* ============================================================
 * THE OPERATIONS OF ONE PATH
 * ============================================================
 *
 * Returns a flat token list:
 *
 *   { type: "point", value }     a coordinate
 *   { type: "line" }             `--`, `-|`, `|-`
 *   { type: "cycle" }
 *   { type: "circle", radius }   `circle (r)` / `circle[radius=r]`
 *   { type: "rectangle" }
 *   { type: "arc", ... }         `arc (a:b:r)` / `arc[...]`
 *   { type: "curve" }            `..`
 *   { type: "word", name }       anything else the path asks for
 *
 * Option lists and `node` labels are skipped: neither is geometry, and both are
 * what a hand-written path is most likely to contain between its coordinates.
 */
export function pathOperations(body) {
  const operations = [];
  let index = 0;

  /*
   * THE POLAR OFFSET BEFORE AN ARC.
   *
   * TikZ writes "draw from this angle at this radius" as `++(from:r)`, and an arc
   * drawn that way states only a start angle and a delta. The offset is remembered
   * here so the arc it belongs to can be read as the one arc it is, rather than as
   * a path with an unrecognised word in it.
   */
  let lastPolarAngle = null;

  while (index < body.length) {
    const character = body[index];

    if (/[\s,]/.test(character)) {
      index += 1;
      continue;
    }

    /* ---- a node label, at any point along the path ---- */
    if (
      character === "n" &&
      body.startsWith("node", index) &&
      !/[A-Za-z]/.test(nextNonSpace(body, index + 4) || "")
    ) {
      index += 4;

      /*
       * SKIP THE LABEL WHOLE - OPTIONS, AN OPTIONAL POSITION, AND THE TEXT.
       *
       * A label's text may itself begin with a command (`{$F$}`, `{$5\,\mathrm{N}$}`),
       * which would otherwise be read as another path operation and turn a
       * labelled line into "a path this parser does not understand". A label is
       * the last thing a path says, so the statement is finished once it has
       * been read: no path continues after its node.
       */
      let cursor = index;

      while (/\s/.test(body[cursor] || "")) {
        cursor += 1;
      }

      if (body[cursor] === "[") {
        cursor = afterOptions(body, cursor);

        while (/\s/.test(body[cursor] || "")) {
          cursor += 1;
        }
      }

      if (body[cursor] === "(") {
        cursor = endOfGroup(body, cursor, "(", ")");

        while (/\s/.test(body[cursor] || "")) {
          cursor += 1;
        }
      }

      if (body[cursor] === "{") {
        cursor = endOfGroup(body, cursor, "{", "}");
      }

      index = Math.max(cursor, index + 4);

      /*
       * `cycle` AFTER A LABEL still closes the path, and is the one operation a
       * label may precede. Anything else after a label is not part of this
       * path's geometry and is skipped with it.
       */
      let after = index;

      while (/\s/.test(body[after] || "")) {
        after += 1;
      }

      if (body.startsWith("cycle", after) && !/[A-Za-z]/.test(body[after + 5] || "")) {
        operations.push({ type: "cycle" });
        index = after + 5;
      }

      continue;
    }

    /* ---- an option list on its own ---- */
    if (character === "[") {
      index = afterOptions(body, index);
      continue;
    }

    /* ---- a coordinate ---- */
    if (character === "(") {
      const end = endOfGroup(body, index, "(", ")");

      const inner = body.slice(index + 1, end - 1);

      /* `++(angle:radius)` is a polar OFFSET, not a coordinate. */
      if (body[index - 1] === "+" && body[index - 2] === "+" && inner.includes(":") && !inner.includes(",")) {
        const [angleText, radiusText] = inner.split(":");

        lastPolarAngle = Number(angleText);

        /*
         * A POLAR OFFSET IS ITS OWN OPERATION, not a coordinate: it moves the
         * pen without naming a position. Keeping it as a `polar` op is what lets
         * the ONE path that is a plain TikZ arc - a centre plus a `++` plus the
         * arc - be recognised without any other path being mistaken for a shape.
         */
        operations.push({
          type: "polar",
          angle: lastPolarAngle,
          radius: Number(radiusText)
        });

        index = end;
        continue;
      }

      operations.push({ type: "point", value: coordinateValue(inner) });
      index = end;
      continue;
    }

    /* ---- a line operation ---- */
    if ((character === "-" && (body[index + 1] === "-" || body[index + 1] === "|")) ||
        (character === "|" && body[index + 1] === "-")) {
      operations.push({ type: "line" });
      index += 2;
      continue;
    }

    /* ---- a curve ---- */
    if (character === "." && body[index + 1] === ".") {
      operations.push({ type: "curve" });
      index += 2;
      continue;
    }

    /* ---- an escaped character or the start of a label's text ---- */
    if (character === "\\") {
      let at = index;

      while (at < body.length && /\s/.test(body[at])) {
        at += 1;
      }

      if (body[at] === "{") {
        index = endOfGroup(body, at, "{", "}");
        continue;
      }

      index += 2;
      continue;
    }

    /* ---- a path operation word ---- */
    if (/[A-Za-z]/.test(character)) {
      const word = /^[A-Za-z]+\*?/.exec(body.slice(index))[0];

      index += word.length;

      if (word === "cycle") {
        operations.push({ type: "cycle" });
        continue;
      }

      if (word === "rectangle") {
        operations.push({ type: "rectangle" });
        continue;
      }

      if (word === "circle") {
        let radius = null;

        if (body[index] === "[") {
          const named = /radius\s*=\s*([\d.]+)/.exec(optionsAt(body, index));

          if (named) {
            radius = Number(named[1]);
          }

          index = afterOptions(body, index);
        }

        if (body[index] === "(") {
          const end = endOfGroup(body, index, "(", ")");
          const value = coordinateValue(body.slice(index + 1, end - 1));

          radius = value ? Math.abs(value.x) : null;
          index = end;
        }

        operations.push({ type: "circle", radius });
        continue;
      }

      if (word === "arc") {
        let startAngle = null;
        let endAngle = null;
        let radius = null;
        let deltaAngle = null;

        if (body[index] === "[") {
          const options = optionsAt(body, index);
          const start = /start\s+angle\s*=\s*(-?[\d.]+)/.exec(options);
          const finish = /end\s+angle\s*=\s*(-?[\d.]+)/.exec(options);
          const delta = /delta\s+angle\s*=\s*(-?[\d.]+)/.exec(options);
          const size = /radius\s*=\s*([\d.]+)/.exec(options);

          startAngle = start ? Number(start[1]) : null;
          endAngle = finish ? Number(finish[1]) : null;
          deltaAngle = delta ? Number(delta[1]) : null;
          radius = size ? Number(size[1]) : null;

          index = afterOptions(body, index);
        }

        if (body[index] === "(") {
          const end = endOfGroup(body, index, "(", ")");
          const parts = body.slice(index + 1, end - 1).split(":");

          startAngle = Number(parts[0]);
          endAngle = Number(parts[1]);
          index = end;
        }

        operations.push({
          type: "arc",
          startAngle,
          endAngle: Number.isFinite(endAngle)
            ? endAngle
            : Number.isFinite(startAngle) && Number.isFinite(deltaAngle)
              ? startAngle + deltaAngle
              : null,
          radius,
          deltaAngle,
          polarAngle: lastPolarAngle
        });
        lastPolarAngle = null;
        continue;
      }

      operations.push({ type: "word", name: word });
      continue;
    }

    index += 1;
  }

  return operations;
}

/* ============================================================
 * ONE PATH -> ONE SHAPE
 * ============================================================
 *
 * Only the shapes whose geometry is fully determined by the statement are
 * returned. A path that draws more than one shape (`\draw (0,0) -- (1,1) (2,2) --
 * (3,3)`) has no single counterpart in the model, so it stays custom.
 */
function shapeOfPath(body) {
  const operations = pathOperations(body);

  if (!operations.length) {
    return null;
  }

  /* Anything that is not a plain point, line, cycle, shape or curve marker. */
  const plain = operations.every((operation) =>
    ["point", "polar", "line", "cycle", "circle", "rectangle", "arc"].includes(operation.type)
  );

  if (!plain) {
    return null;
  }

  const points = operations.filter((operation) => operation.type === "point");

  if (!points.length || points.some((operation) => !operation.value)) {
    return null;
  }

  const kinds = operations.map((operation) => operation.type).join(" ");
  if (kinds === "point line point" && points.length === 2) {
    return { type: "line", from: points[0].value, to: points[1].value };
  }

  /*
   * A CLOSED PATH: `(p1) -- (p2) -- ... -- cycle`.
   *
   * Read from the OPERATIONS rather than reconstructed into a string: every
   * operation after the first must be a line, the last must be the cycle, and
   * there must be three points for it to be a shape at all. Written this way
   * it holds for any number of vertices, which is what a Freeform Polygon
   * needs - the old form only matched exactly three.
   */
  const closedPath =
    points.length >= 3 &&
    operations[operations.length - 1].type === "cycle" &&
    operations.every((operation, index) => {
      /*
       * The shape of the sequence is `point (line point)* line cycle`: the
       * cycle is its own final operation and there is a `line` immediately
       * before it, which is the drawn edge. Anything else - a curve, a
       * repeated move - is not a simple closed polygon.
       */
      if (index === operations.length - 1) {
        return operation.type === "cycle";
      }

      if (index === operations.length - 2) {
        return operation.type === "line";
      }

      return index % 2 === 0 ? operation.type === "point" : operation.type === "line";
    });

  /*
   * A RECTANGLE IS A MORE SPECIFIC READING OF FOUR POINTS, and it is written
   * as a `rectangle` operation rather than as four segments, so it never
   * matches `closedPath` - it is handled by the `point rectangle point` case
   * below.
   */
  if (closedPath) {
    return {
      type: "polyline",
      points: points.map((operation) => operation.value),
      closed: true
    };
  }

  if (kinds === "point rectangle point" && points.length === 2) {
    return { type: "rectangle", from: points[0].value, to: points[1].value };
  }

  if (kinds === "point circle" && points.length === 1) {
    const circle = operations.find((operation) => operation.type === "circle");

    return Number.isFinite(circle.radius) && circle.radius > 0
      ? { type: "circle", centre: points[0].value, radius: circle.radius }
      : null;
  }

  if (kinds === "point arc" && points.length === 1) {
    const arc = operations.find((operation) => operation.type === "arc");

    return Number.isFinite(arc.startAngle) &&
      Number.isFinite(arc.endAngle) &&
      Number.isFinite(arc.radius) &&
      arc.radius > 0
      ? {
          type: "arc",
          centre: points[0].value,
          radius: arc.radius,
          startAngle: arc.startAngle,
          endAngle: arc.endAngle,
          deltaAngle: arc.deltaAngle ?? null
        }
      : null;
  }

  /*
   * A WALL OF A FITTING: an `arc` WRITTEN AS A POINT OFFSET.
   *
   * The elbow writer emits `\draw (centre) ++(from:r) arc[start angle=..., delta
   * angle=..., radius=...]` when both of its ends are drawn at the same width -
   * the ordinary case - and this is that statement. The polar offset IS the
   * arc's position on its circle, so the whole path reduces to the one arc it
   * draws, about `centre`, from `from` sweeping by `delta`.
   *
   * WITHOUT THIS the written form of a plain elbow could not be read back, and the
   * Source tab would report DAETUM's own output as a shape it cannot edit.
   */
  if (kinds === "point polar arc" && points.length === 1) {
    const arc = operations.find((operation) => operation.type === "arc");
    const polar = polarOffsetOf(arc);

    if (!polar || !Number.isFinite(arc.radius) || !(arc.radius > 0)) {
      return null;
    }

    return {
      type: "arc",
      centre: points[0].value,
      radius: arc.radius,
      startAngle: polar.angle,
      endAngle: polar.angle + polar.delta,
      deltaAngle: polar.delta
    };
  }

  return null;
}

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

/*
 * `line width=0.28mm` -> 0.28, and `line width=1.2pt` -> 1.2.
 *
 * The unit is part of the statement but not part of the answer: the caller
 * converts a length to the model's own width, and \`pt\` is how DAETUM's writers
 * emit the named presets while \`mm\` is how a mm-scale export does.
 */
function lineWidthOf(options) {
  const match = /line\s*width\s*=\s*([\d.]+)\s*(mm|pt|cm)?/.exec(options || "");

  return match ? Number(match[1]) : null;
}

/*
 * A `\definecolor` in the same statement, `{daetumC112233}{RGB}{17,34,51}`.
 *
 * DAETUM's writers emit a hex colour as a local definition plus its name, because
 * `#RRGGBB` is not a TikZ colour. Reading it back is what makes a colour a
 * round trip: `\definecolor{daetumC112233}{RGB}{...}` then `draw=daetumC112233`
 * in the option list is the same colour as `#112233`.
 */
function definedColour(text) {
  const match = /\\definecolor\{([^}]*)\}\{RGB\}\{\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\}/.exec(text || "");

  /*
   * NO LOCAL DEFINITION: fall back to `#RRGGBB`, which DAETUM's readers also
   * accept. `named` says whether the name came from a definition, which is
   * what lets a caller add a word boundary that a hex value must not have.
   */
  if (!match) {
    const hex = /#([0-9a-fA-F]{6})\b/.exec(text || "");

    return hex ? { name: hex[1], value: `#${hex[1].toLowerCase()}`, hex: true } : null;
  }

  const value = [match[2], match[3], match[4]]
    .map((part) => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, "0"))
    .join("");

  return { name: match[1], value: `#${value}`, hex: false };
}

/*
 * The colour ONE named definition in `text` stands for, by that name.
 *
 * A statement can carry more than one `\definecolor` - an outline and a fill,
 * each written as its own local colour - so a lookup has to name the one it
 * wants rather than taking whichever came first.
 */
function definitionFor(text, name) {
  if (!name) {
    return null;
  }

  const pattern = new RegExp(`\\\\definecolor\\{${name}\\}\\{RGB\\}\\{\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*\\}`);
  const match = pattern.exec(text || "");

  if (!match) {
    return null;
  }

  return `#${[match[1], match[2], match[3]]
    .map((part) => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, "0"))
    .join("")}`;
}

/* The name a `draw=`/`color=` option refers to, if the statement defined it. */
function colourOf(options, statementText, colourContext = "") {
  /*
   * A NAMED LOCAL COLOUR IS RESOLVED BEFORE A BARE HEX.
   *
   * DAETUM writes a hex colour as `daetumC112233`, and THAT NAME CONTAINS SIX
   * HEX DIGITS (`C112233`) - so a hex matcher run first finds them inside the
   * identifier and reports the wrong colour, or none at all. The definition a
   * statement carries is the authority: when the option names a colour this
   * statement defined, that definition IS the colour.
   *
   * A SHAPE MAY HAVE TWO - an outline and a fill - so the option's own name is
   * resolved against its own definition rather than against "the" first one.
   *
   * `colourContext` is the rest of the block, for the case where the
   * `\definecolor` is its own statement on its own line (as DAETUM writes it).
   */
  const scope = [statementText, colourContext].filter(Boolean).join("\n");
  const strokeName = /(?:draw|color)\s*=\s*\{?\s*([A-Za-z#][A-Za-z0-9#_]*)/.exec(options || "");

  if (strokeName && strokeName[1].startsWith("#")) {
    return strokeName[1].toLowerCase();
  }

  if (strokeName) {
    const named = definitionFor(scope, strokeName[1]);

    if (named) {
      return named;
    }
  }

  const defined = definedColour(scope);

  if (defined && defined.hex !== true) {
    return defined.value;
  }

  const direct = /#([0-9a-fA-F]{6})\b|(?:draw|color|fill)\s*=\s*\{?\s*#?([0-9a-fA-F]{6})\b/.exec(options || "");

  if (direct) {
    return `#${(direct[1] || direct[2]).toLowerCase()}`;
  }

  return null;
}

/*
 * The fill colour a statement names, when it fills with one.
 *
 * `filled` alone says "this shape is filled"; the COLOUR is what a round trip
 * has to carry, and DAETUM writes it as `fill=<name>` joined to the same local
 * definition the stroke uses. `fill=none` is no fill at all.
 */
function fillColourOf(options, statementText, colourContext = "") {
  const option = /\bfill\s*=\s*\{?\s*(#[0-9a-fA-F]{6}|[A-Za-z][A-Za-z0-9_]*)/.exec(options || "");

  if (!option || option[1] === "none") {
    return null;
  }

  /* A literal hex colour, as `fill=#abcdef`. */
  if (option[1].startsWith("#")) {
    return option[1].toLowerCase();
  }

  /*
   * A NAMED COLOUR IS LOOKED UP BY ITS DEFINITION, whichever definition it was.
   *
   * A shape filled with one colour has TWO definitions in its block - the
   * stroke's and the fill's - so the lookup has to match the NAME the option
   * uses, not simply take "the" definition.
   */
  const named = definitionFor([statementText, colourContext].filter(Boolean).join("\n"), option[1]);

  if (named) {
    return named;
  }

  return /^[0-9a-fA-F]{6}$/.test(option[1]) ? `#${option[1].toLowerCase()}` : null;
}

/* `\node at (x,y) {$text$};` or `\node[right] at (x,y) {$text$};`. */
function nodeAt(statementText) {
  const match = /^\\node\b([^;]*?)\bat\s*\(([^)]*)\)([^;]*);\s*$/s.exec(statementText.trim());

  if (!match) {
    return null;
  }

  const position = coordinateValue(match[2]);

  if (!position) {
    return null;
  }

  const label = /\{([^}]*)\}/.exec(match[3]);

  return {
    type: "point",
    position,
    text: label ? label[1].trim() : ""
  };
}

/* `\coordinate (x,y);` - an untethered reference point. */
function coordinateAt(statementText) {
  const match = /^\\coordinate(?:\s*\[[^\]]*\])?\s*\(([^)]*)\)\s*;\s*$/s.exec(statementText.trim());

  if (!match) {
    return null;
  }

  const position = coordinateValue(match[1]);

  return position ? { type: "point", position, text: "" } : null;
}

/*
 * ONE STATEMENT -> ONE CANDIDATE SHAPE.
 *
 * `{ type, ... }` for a shape DAETUM can edit, `null` for a statement it can only
 * render. A `null` is not an error: the statement stays in the document and in
 * the picture.
 *
 * `colourContext` is the REST OF THE BLOCK, when the caller has it. A `\definecolor`
 * is written on its own line ahead of the `\draw` that uses it, so it is a
 * different statement - and the `\draw` alone cannot say what `daetumC123456`
 * means. Passing the block lets the colour resolve without merging the two
 * statements, so each keeps its own line and its own diagnostic.
 */
export function shapeFromStatement(statementText, colourContext = "") {
  const text = String(statementText ?? "").trim();
  const nameMatch = /^\\([A-Za-z]+\*?)/.exec(text);

  if (!nameMatch) {
    return null;
  }

  const name = nameMatch[1];

  if (name === "node") {
    return nodeAt(text);
  }

  if (name === "coordinate") {
    return coordinateAt(text);
  }

  /*
   * A COLOUR DEFINITION IS NOT A SHAPE, BUT IT IS PART OF ONE.
   *
   * DAETUM writes a hex colour as a local `\definecolor{daetumC...}{RGB}{...}`
   * FOLLOWED BY the `\draw` that uses it - two statements, one object. So a
   * definition is never a shape on its own, and the `\draw` beside it IS one.
   * That is why this does not return early on `definecolor`: the path command
   * is located below, wherever it sits in the statement, and a statement with
   * no path command at all answers null there.
   */
  /*
   * A PATH COMMAND BOUNDED BY WHAT CAN FOLLOW IT.
   *
   * `\b` is wrong here: a word boundary needs a word character on one side,
   * and `\draw[` / `\draw (` are both followed by a non-word character - so
   * `\draw\b` never matched and the search found nothing. The lookahead states
   * the real rule: the name must not run on into more letters.
   */
  const PATH_COMMAND = /\\(?:draw|fill|filldraw|shade|shadedraw|clip|path)(?![A-Za-z])/;

  if (!PATH_COMMANDS.has(name) && !PATH_COMMAND.test(text)) {
    return null;
  }

  /*
   * THE PATH STARTS AT THE PATH COMMAND, not at the statement's first
   * character. A block may open with `\definecolor` lines - a coloured shape
   * writes one per colour - so `\draw` is not always at the front.
   */
  const pathAt = text.search(PATH_COMMAND);

  if (pathAt < 0) {
    return null;
  }

  /*
   * EVERYTHING FROM THE PATH COMMAND ONWARD belongs to the path. A block may
   * open with `\definecolor` lines - a coloured shape writes one per colour -
   * so the statement's FIRST command is not necessarily the one that draws.
   */
  const pathText = text.slice(pathAt);
  const pathName = /^\\([A-Za-z]+)/.exec(pathText)[1];

  /*
   * THE BODY STARTS AT THE PATH'S OWN FIRST TOKEN. The text between the
   * command name and the path is options (`[draw=...]`) and whitespace; the
   * path begins at the first `(` or `++`.
   */
  const rawBody = pathText.slice(1 + pathName.length).replace(/;\s*$/, "");
  const firstToken = rawBody.search(/[()]|\+\+/);
  const body = firstToken < 0 ? "" : rawBody.slice(firstToken).trim();
  const shape = shapeOfPath(body.trim());

  if (!shape) {
    return null;
  }

  /*
   * THE PATH'S OWN OPTION LIST, READ DIRECTLY.
   *
   * `\draw[draw=..., fill=...]` - the brackets immediately after the command
   * name. Read with one small expression rather than by offset arithmetic, so
   * a `\definecolor` line ahead of the `\draw` in the same statement cannot
   * shift the index and silently produce an empty option list (which reads as
   * "this shape has no colour" rather than as a parse failure).
   */
  const optionMatch = /^\s*\[([^\]]*)\]/.exec(pathText.slice(1 + pathName.length));
  const options = optionMatch ? optionMatch[1] : "";

  /*
   * THE COLOUR LOOKUP SEES THE WHOLE STATEMENT, NOT ONLY ITS OPTION LIST.
   *
   * A `\definecolor` accompanies the `\draw` that uses it, and the definition
   * is what says what `daetumC123456` means - so the WHOLE statement text is
   * passed below, with the options still identified from it. Reading only
   * `[draw=daetumC123456]` in isolation would give a name that nothing in
   * scope defines.
   */

  return {
    ...shape,
    /** Whether a fill was requested (`\fill`, or `fill=<colour>`). */
    filled: pathName === "fill" || pathName === "filldraw" || /\bfill\s*=/.test(options),
    /** The fill colour as `#rrggbb`, when the statement fills with one. */
    fill: fillColourOf(options, text, colourContext),
    /** The stroke colour as `#rrggbb`, when the statement names one. */
    stroke: colourOf(options, text, colourContext),
    /** The stroke width in millimetres, when the statement names one. */
    lineWidth: lineWidthOf(options)
  };
}

/* ============================================================
 * THE CANDIDATES IN A SOURCE, BY OBJECT BLOCK
 * ============================================================
 *
 * Only statements INSIDE a `DAETUM_OBJECT_BEGIN ... END` block are candidates.
 * Custom TikZ in the picture belongs to nobody, and giving it an object would put
 * handles on code the student wrote as a picture.
 *
 * A block yields ALL of its statements in order. A block with one statement is
 * the ordinary case; a multi-statement block (`\node` plus a `\draw`, which is
 * what a dimension writes) keeps them all, so a block whose statements changed
 * can be compared as a whole.
 */
export function blockContents(source, map) {
  const text = String(source ?? "");
  const lines = text.split("\n");
  const statements = splitStatements(text);

  /*
   * THE MAP IS THE CALLER'S. `drawing-source.js` reaches the tool library's
   * primitives for the picture's unit, so a module that imported it would drag
   * the whole tool library into every reader of the parser - and its own module
   * cycle with it. The map is therefore passed in by the caller that already
   * has it, and this module stays a pure text reader.
   */
  const blocks = (map?.blocks || [])
    .slice()
    .sort((left, right) => left.beginLine - right.beginLine)
    .map((block) => {
      /*
       * THE PARSER'S OWN BODY BOUNDS. They account for the header's length and
       * for the blank lines that are not commands; computing them again here
       * made the statements begin on the header's last line, so a readable
       * block could not see the command beneath its own header.
       */
      const bodyStart = Number.isFinite(block.bodyStartLine) ? block.bodyStartLine : block.beginLine + 1;
      const bodyEnd = block.unclosed
        ? lines.length
        : Math.max(
            bodyStart,
            (Number.isFinite(block.bodyEndLine) ? block.bodyEndLine : block.endLine) + 1
          );
      const inside = statements.filter(
        (statement) => statement.startLine >= bodyStart && statement.startLine < bodyEnd
      );

      const bodyText = lines.slice(bodyStart, bodyEnd).join("\n");

      return {
        id: block.id,
        type: block.type,
        beginLine: block.beginLine,
        endLine: block.endLine,
        unclosed: Boolean(block.unclosed),
        /*
         * THE HEADER, AND THE BODY. A block's metadata lives in its header - an
         * arrow's attachment, a schematic's own model line - so a reader that
         * needs to know WHAT the block is must see both.
         */
        header: lines.slice(block.beginLine, Math.max(block.beginLine, bodyStart)).join("\n"),
        body: bodyText,
        statements: inside.map((statement) => {
          const statementText = text.slice(statement.start, statement.end);

          return {
            text: statementText.trim(),
            complete: statement.complete,
            startLine: statement.startLine,
            endLine: statement.endLine,
            /*
             * THE BLOCK'S OWN TEXT IS PASSED ALONGSIDE. A `\definecolor` is its
             * own statement on its own line, so the `\draw` beside it cannot
             * name its colour without it - and the block is what has it.
             */
            shape: statement.complete ? shapeFromStatement(statementText, bodyText) : null
          };
        })
      };
    });

  return { text, lines, blocks };
}

export default {
  pathOperations,
  shapeFromStatement,
  blockContents
};
