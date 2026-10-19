/*
 * ============================================================
 * ANNOTATION SOURCE WRITER
 * ============================================================
 *
 * Turns the Annotate features into TikZ, from their REAL stored data.
 *
 *   text / note       a `\node` at the text's own position
 *   label             the marker at its anchor and, when the text stands off
 *                     it, a leader - exactly the two things the canvas draws
 *   leader / callout  the stored pen path, its head, and the text box
 *   arrow             the stored pen path with its head
 *   symbol            the symbol's own glyph
 *   tolerance         the glyph in its frame
 *   table             the grid and its cells
 *   centre mark       a cross at its position
 *   centreline        the stored dash-dot line
 *   hatch             the stored region's boundary and its hatch strokes
 *
 * WHY ONE MODULE FOR ALL OF THEM. They are one object type (`annotate`), whose
 * `annotateKind` chooses the shape - the same reason the canvas draws them with
 * one function. A writer per kind would repeat the text placement, the colour
 * resolution and the anchor rules in eight places.
 *
 * TEXT IS LATEX, NOT A PICTURE OF TEXT. Every string goes through the shared
 * escaping (`texText`), so a student's "Ø25" or "50%" compiles. A value that is
 * already mathematics (a dimension's "500 mm") is passed through unescaped by
 * its own writer.
 *
 * NOTHING IS INVENTED. An empty note produces no text node, a table produces the
 * cells it stores, and a dimension whose references no longer resolve produces
 * no geometry - the same answer the canvas gives.
 */

import { num, point, texText } from "./statics-primitives.js";

function finite(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
}

function valid(pointLike) {
  return Boolean(
    pointLike &&
      Number.isFinite(Number(pointLike.x)) &&
      Number.isFinite(Number(pointLike.y))
  );
}

/* ------------------------------------------------------------------ colours */

function normaliseHex(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^#([0-9a-fA-F]{6})$/);

  return match ? match[1].toUpperCase() : null;
}

function colourNameOf(value) {
  const text = String(value ?? "").trim();

  if (!text || /^none$/i.test(text) || /^transparent$/i.test(text)) {
    return null;
  }

  const hex = normaliseHex(text);

  if (!hex) {
    return text;
  }

  if (hex === "000000") {
    return "black";
  }

  if (hex === "FFFFFF") {
    return "white";
  }

  return `daetumC${hex}`;
}

function colourPrelude(values) {
  const seen = new Set();

  (values || []).forEach((value) => {
    const hex = normaliseHex(value);

    if (hex && hex !== "000000" && hex !== "FFFFFF") {
      seen.add(`\\definecolor{daetumC${hex}}{HTML}{${hex}}`);
    }
  });

  return [...seen];
}

function defaultColour() {
  const theme = globalThis.enggTheme;

  return (theme && typeof theme.defaultLineColour === "function" && theme.defaultLineColour()) || "#193335";
}

function strokeOf(object) {
  return colourNameOf(object?.style?.stroke) || colourNameOf(defaultColour()) || "black";
}

/* ------------------------------------------------------------------ helpers */

function join(definitions, command) {
  return definitions.length ? `${definitions.join("\n")}\n${command}` : command;
}

/*
 * A segment or polyline through the given points, in the feature's own stroke.
 * `arrow` is a TikZ head token or null.
 */
function pathThrough(points, colour, options = {}, arrow = null) {
  const usable = (points || []).filter(valid);

  if (usable.length < 2) {
    return null;
  }

  const body = usable
    .map((at, index) => `${index === 0 ? "" : "-- "}${point(finite(at.x), finite(at.y))}`)
    .join(" ");

  const list = [colour, ...options];

  if (arrow) {
    list.push(arrow);
  }

  return `\\draw[${list.join(", ")}] ${body};`;
}

function textAnchor(align) {
  if (align === "center") {
    return "center";
  }

  if (align === "right") {
    return "east";
  }

  return "west";
}

/*
 * Multiline text as one node whose lines are stacked with `\\`.
 *
 * TikZ does not accept a bare newline in a node's content, so a note with two
 * lines must be ONE node with a line break inside it. Writing it as two nodes
 * at guessed offsets would space the lines by a number that is not the font's
 * leading, and the second node would not move with the first.
 */
function multiLineNode(at, text, colour, options = []) {
  const lines = String(text ?? "").split("\n");
  const content = lines.map((line) => texText(line)).join(" \\\\ ");

  return `\\node[${[`text=${colour}`, ...options].join(", ")}] at ${point(at.x, at.y)} {${content}};`;
}

/* -------------------------------------------------------------------- kinds */

const FONT_FOR_SIZE = { small: 8, medium: 10, large: 12 };

function fontFor(style) {
  return FONT_FOR_SIZE[String(style?.fontSize ?? "").toLowerCase()] || 9;
}

/*
 * A NOTE, A SYMBOL OR A TOLERANCE: text at its own stored position.
 *
 * The `position` is where the annotation was placed. An annotation that has
 * only a `start` (the kind that marks a point on a feature) uses that, which is
 * what the canvas does when no placement has been given.
 */
function textAtPosition(object) {
  const geometry = object.geometry || {};
  const at = valid(geometry.position) ? geometry.position : valid(geometry.start) ? geometry.start : null;

  if (!at) {
    return null;
  }

  const text = String(object.text ?? "");

  if (!text.trim()) {
    /*
     * AN EMPTY ANNOTATION DRAWS NOTHING IN SOURCE. The canvas draws a muted
     * "Enter note" placeholder so the feature is visible while it is empty;
     * the placeholder is an editor aid, never the student's content, so it
     * must not be compiled into the drawing or into an export.
     */
    return null;
  }

  const colour = strokeOf(object);

  return join(
    colourPrelude([object.style?.stroke]),
    multiLineNode({ x: finite(at.x), y: finite(at.y) }, text, colour, [
      `anchor=${textAnchor(object.style?.align)}`,
      `font=\\fontsize{${num(fontFor(object.style), 2)}}{${num(fontFor(object.style) * 1.2, 2)}}\\selectfont`
    ])
  );
}

/*
 * A LABEL: the anchor dot, the leader when the text has been moved away, and
 * the text itself.
 *
 * The gap that turns the leader on is the canvas's own rule (text taller than
 * roughly two and a half lines), restated here so the code and the picture
 * agree about when a line appears.
 */
function serializeLabel(object) {
  const geometry = object.geometry || {};
  const colour = strokeOf(object);

  const commands = [];
  const definitions = colourPrelude([object.style?.stroke]);

  if (valid(geometry.start)) {
    commands.push(
      `\\fill[${colour}] ${point(finite(geometry.start.x), finite(geometry.start.y))} circle[radius=0.35];`
    );
  }

  if (valid(geometry.position)) {
    if (valid(geometry.start)) {
      const dx = finite(geometry.position.x) - finite(geometry.start.x);
      const dy = finite(geometry.position.y) - finite(geometry.start.y);
      const fontSize = fontFor(object.style);

      if (Math.hypot(dx, dy) > 2.5 * fontSize * 0.25) {
        commands.push(
          pathThrough([geometry.start, geometry.position], colour)
        );
      }
    }

    const text = String(object.text ?? "");

    if (text.trim()) {
      commands.push(
        multiLineNode(
          { x: finite(geometry.position.x), y: finite(geometry.position.y) },
          text,
          colour,
          [`anchor=${textAnchor(object.style?.align)}`]
        )
      );
    }
  }

  return commands.filter(Boolean).length
    ? join(definitions, commands.filter(Boolean).join("\n"))
    : null;
}

/*
 * A LEADER, A CALLOUT OR AN ARROW.
 *
 * The pen is `leaderPathPoints`' list - attachment, every bend, the endpoint -
 * which is one ordered path in the object itself. The head is at the pointed
 * end: the attachment for a leader or callout, the endpoint for an arrow.
 * A callout also carries its text box, drawn as the rectangle the canvas draws
 * around the words.
 */
function serializePen(object) {
  const geometry = object.geometry || {};
  const kind = object.annotateKind;
  const colour = strokeOf(object);
  const definitions = colourPrelude([object.style?.stroke]);

  const path = [
    geometry.start,
    ...(Array.isArray(geometry.bends) ? geometry.bends : []),
    geometry.end
  ].filter(valid);

  const commands = [];

  const pointingAt =
    kind === "arrow" ? path[path.length - 1] : path[0];

  const fromEnd = kind === "arrow" ? path[0] : path[1];

  let arrow = null;

  if (pointingAt && fromEnd && valid(pointingAt) && valid(fromEnd)) {
    const dx = finite(pointingAt.x) - finite(fromEnd.x);
    const dy = finite(pointingAt.y) - finite(fromEnd.y);

    if (Math.hypot(dx, dy) > 1e-6 && object.style?.arrowhead !== "none") {
      const filled = object.style?.arrowhead !== "open";
      const head = filled ? "{Latex}" : ">";

      arrow = kind === "arrow" ? `-${head}` : `<${head}-`;
    }
  }

  if (path.length >= 2) {
    commands.push(pathThrough(path, colour, [], arrow));
  }

  const text = String(object.text ?? "");
  const textAt = valid(geometry.position) ? geometry.position : valid(geometry.end) ? geometry.end : null;

  if (text.trim() && textAt) {
    const fontSize = fontFor(object.style);

    if (kind === "callout") {
      const widest = Math.max(1, ...text.split("\n").map((line) => line.length));
      const width = widest * fontSize * 0.58 + 8;
      const height = text.split("\n").length * fontSize * 1.2 + 4;

      commands.push(
        `\\draw[${colour}] (${num(finite(textAt.x) - width / 2)},${num(finite(textAt.y) - height / 2)}) rectangle (${num(
          finite(textAt.x) + width / 2
        )},${num(finite(textAt.y) + height / 2)});`
      );
    }

    if (kind !== "arrow") {
      commands.push(
        multiLineNode({ x: finite(textAt.x), y: finite(textAt.y) }, text, colour, [
          "anchor=center",
          `font=\\fontsize{${num(fontSize, 2)}}{${num(fontSize * 1.2, 2)}}\\selectfont`
        ])
      );
    }
  }

  const kept = commands.filter(Boolean);

  return kept.length ? join(definitions, kept.join("\n")) : null;
}

/*
 * A TABLE: its grid lines and its cells, from the stored size and contents.
 *
 * The cell text is placed at each cell's centre. The size is derived from the
 * same character-width estimate the canvas uses, so the grid and the words
 * inside it are the same rectangle.
 */
function serializeTable(object) {
  const geometry = object.geometry || {};
  const rows = Math.max(1, Math.round(finite(geometry.rows, 1)));
  const columns = Math.max(1, Math.round(finite(geometry.columns, 1)));
  const cells = Array.isArray(geometry.cells) ? geometry.cells : [];
  const origin = valid(geometry.position)
    ? geometry.position
    : valid(geometry.start)
      ? geometry.start
      : { x: 0, y: 0 };

  const colour = strokeOf(object);
  const fontSize = fontFor(object.style);

  const cellWidth = Math.max(18, fontSize * 3);
  const cellHeight = Math.max(10, fontSize * 1.8);

  const left = finite(origin.x);
  const top = finite(origin.y);

  const commands = [];

  for (let row = 0; row <= rows; row += 1) {
    commands.push(
      pathThrough(
        [
          { x: left, y: top - row * cellHeight },
          { x: left + columns * cellWidth, y: top - row * cellHeight }
        ],
        colour
      )
    );
  }

  for (let column = 0; column <= columns; column += 1) {
    commands.push(
      pathThrough(
        [
          { x: left + column * cellWidth, y: top },
          { x: left + column * cellWidth, y: top - rows * cellHeight }
        ],
        colour
      )
    );
  }

  cells.forEach((cell, index) => {
    const text = String(cell ?? "");

    if (!text.trim()) {
      return;
    }

    const row = Math.floor(index / columns);
    const column = index % columns;

    commands.push(
      multiLineNode(
        {
          x: left + (column + 0.5) * cellWidth,
          y: top - (row + 0.5) * cellHeight
        },
        text,
        colour,
        ["anchor=center"]
      )
    );
  });

  return join(colourPrelude([object.style?.stroke]), commands.filter(Boolean).join("\n"));
}

/* ------------------------------------------------------------------ routes */

function annotateCommands(object) {
  const kind = String(object.annotateKind || "").toLowerCase();
  const geometry = object.geometry || {};

  /*
   * A HIDDEN ANNOTATION PRODUCES NO CODE. `visible: false` is a display state,
   * and the canvas draws nothing for it; emitting its commands would make the
   * compiled drawing show a classification the student had switched off.
   */
  if (object.visible === false) {
    return null;
  }

  switch (kind) {
    case "note":
    case "symbol":
    case "tolerance":
    case "text":
      return textAtPosition(object);

    case "label":
      return serializeLabel(object);

    case "leader":
    case "callout":
    case "arrow":
      return serializePen(object);

    case "table":
      return serializeTable(object);

    case "centre-mark":
    case "center-mark":
    case "centreline":
    case "centerline":
    case "hatch":
    case "section-fill":
      return serializeMarks(object, kind);

    default:
      break;
  }

  /*
   * A KIND THIS WRITER DOES NOT KNOW is still a placed annotation. If it has
   * text and a position, that text is drawn - writing nothing would make an
   * implemented tool silently absent from Source.
   */
  if (valid(geometry.position) && String(object.text ?? "").trim()) {
    return textAtPosition(object);
  }

  return null;
}

/*
 * CENTRE MARKS, CENTRELINES AND HATCHES.
 *
 * These are drawn from their stored geometry: a centre mark is its cross at the
 * stored centre, a centreline the stored dash-dot segment(s), and a hatch the
 * stored region's outline with strokes through it. None of them is a symbol
 * stamped at an assumed size - the size and extent are the object's.
 */
function serializeMarks(object, kind) {
  const geometry = object.geometry || {};
  const colour = strokeOf(object);
  const definitions = colourPrelude([object.style?.stroke]);

  const centre = valid(geometry.position)
    ? geometry.position
    : valid(geometry.center)
      ? geometry.center
      : valid(geometry.start)
        ? geometry.start
        : null;

  if ((kind === "centre-mark" || kind === "center-mark") && centre) {
    const size = Math.max(1, finite(geometry.size, finite(object.style?.markerSize, 4)));

    const cx = finite(centre.x);
    const cy = finite(centre.y);

    return join(definitions, [
      pathThrough([{ x: cx - size, y: cy }, { x: cx + size, y: cy }], colour),
      pathThrough([{ x: cx, y: cy - size }, { x: cx, y: cy + size }], colour)
    ].filter(Boolean).join("\n"));
  }

  if (kind === "centreline" || kind === "centerline") {
    const points = Array.isArray(geometry.points) ? geometry.points : [];

    if (points.length >= 2) {
      return join(
        definitions,
        pathThrough(points, colour, ["dash pattern=on 4pt off 2pt on 1pt off 2pt"])
      );
    }

    if (valid(geometry.start) && valid(geometry.end)) {
      return join(
        definitions,
        pathThrough([geometry.start, geometry.end], colour, ["dash pattern=on 4pt off 2pt on 1pt off 2pt"])
      );
    }

    return null;
  }

  /* HATCH / SECTION FILL: the region, then strokes at the stored spacing. */
  const region = (Array.isArray(geometry.points) ? geometry.points : []).filter(valid);

  if (region.length < 3) {
    return null;
  }

  const commands = [];

  commands.push(
    pathThrough(
      [...region, region[0]],
      colour,
      ["fill=" + colour, "fill opacity=0.08"]
    )
  );

  const spacing = Math.max(1, finite(geometry.spacing, 4));
  const xs = region.map((at) => finite(at.x));
  const ys = region.map((at) => finite(at.y));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  for (let x = minX + spacing; x < maxX; x += spacing) {
    commands.push(
      pathThrough([{ x, y: minY }, { x, y: maxY }], colour, ["line width=0.3pt"])
    );
  }

  return join(definitions, commands.filter(Boolean).join("\n"));
}

/*
 * ============================================================
 * DIMENSIONS
 * ============================================================
 *
 * A dimension's geometry is DERIVED, not stored: the extension lines, the
 * dimension line, the arrowheads and the text frame are computed from the
 * references it measures, every time it is asked. The model already performs
 * that derivation for the canvas (`graphicsFor`), and the source uses the SAME
 * result - so a dimension's compiled picture and its canvas picture cannot
 * state different numbers or sit in different places.
 */

function dimensionModel() {
  return globalThis.enggDimensionModel || null;
}

function stateWithObjects(_object, allObjects, state) {
  if (state && Array.isArray(state.objects)) {
    return state;
  }

  return { objects: Array.isArray(allObjects) ? allObjects : [], units: "mm" };
}

function dimensionToTikz(graphics, colour, lineWidthPt) {
  if (!graphics) {
    return null;
  }

  const commands = [];

  const thin = `line width=${num(lineWidthPt, 3)}pt`;

  (graphics.witnesses || []).forEach((witness) => {
    const pair = Array.isArray(witness) ? witness : [witness?.from, witness?.to];

    if (pair.length >= 2) {
      commands.push(pathThrough(pair, colour, [thin, "dash pattern=on 4pt off 3pt"]));
    }
  });

  const line = graphics.line;

  if (Array.isArray(line) && line.length >= 2) {
    const filled = graphics.arrowStyle !== "outside";

    commands.push(
      pathThrough(line, colour, [thin], filled ? "<{Latex}-{Latex}" : "{Latex}-{Latex}")
    );
  }

  const arcPoints = (graphics.arc || []).filter(valid);

  if (graphics.kind === "angular" && arcPoints.length >= 2) {
    commands.push(pathThrough(arcPoints, colour, [thin]));
  }

  if (graphics.kind === "arc-length" && arcPoints.length >= 2) {
    commands.push(pathThrough(arcPoints, colour, [thin, "-{Latex}"]));
  }

  const leader = graphics.leader;

  if (leader?.from && leader?.to) {
    commands.push(pathThrough([leader.from, leader.to], colour, [thin, "dash pattern=on 4pt off 3pt"]));
  }

  const frame = graphics.textFrame;

  if (frame && valid(frame.center)) {
    const width = Math.max(1, finite(frame.width, 8));
    const height = Math.max(1, finite(frame.height, 5));

    commands.push(
      `\\draw[${colour}] (${num(finite(frame.center.x) - width / 2)},${num(
        finite(frame.center.y) - height / 2
      )}) rectangle (${num(finite(frame.center.x) + width / 2)},${num(
        finite(frame.center.y) + height / 2
      )});`
    );
  }

  const textAt =
    frame && valid(frame.center)
      ? frame.center
      : Array.isArray(line) && line.length === 2
        ? {
            x: (finite(line[0].x) + finite(line[1].x)) / 2,
            y: (finite(line[0].y) + finite(line[1].y)) / 2
          }
        : null;

  if (textAt && String(graphics.text ?? "").trim()) {
    commands.push(
      `\\node[anchor=center, text=${colour}] at ${point(finite(textAt.x), finite(textAt.y))} {${graphics.text}};`
    );
  }

  return commands.filter(Boolean).join("\n");
}

function serializeDimension(object, options) {
  const model = dimensionModel();

  if (!model || typeof model.graphicsFor !== "function") {
    return null;
  }

  const state = stateWithObjects(object, options.allObjects, options.state);
  const graphics = model.graphicsFor(object, state);

  if (!graphics) {
    return null;
  }

  const colour = strokeOf(object);
  const lineWidth = Number(object.style?.lineWidth) || 0.5;

  const body = dimensionToTikz(
    graphics,
    colour,
    Math.max(0.4, lineWidth * 0.56)
  );

  return body ? join(colourPrelude([object.style?.stroke]), body) : null;
}

/*
 * ============================================================
 * THE WRITER
 * ============================================================
 */
export function annotationSourceWriter(object, options = {}) {
  if (!object || typeof object !== "object") {
    return null;
  }

  if (object.type === "annotate") {
    return annotateCommands(object);
  }

  if (object.type === "annotation") {
    const at = object.placement;

    if (!valid(at)) {
      return null;
    }

    const text = String(object.text ?? "");

    if (!text.trim()) {
      return null;
    }

    return textAtPosition({ ...object, geometry: { position: at } });
  }

  if (object.type === "dimension") {
    return serializeDimension(object, options);
  }

  return null;
}

export const ANNOTATION_SOURCE_TYPES = Object.freeze([
  "annotate",
  "annotation",
  "dimension"
]);

export default {
  ANNOTATION_SOURCE_TYPES,
  annotationSourceWriter
};
