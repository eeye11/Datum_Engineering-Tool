import enggAnnotate from "../../../../features/workspace/model/annotations/annotate-model.js";
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

import { noteTextStyle } from "../../../typography/note-text-style.js";
import { num, point, texText } from "./statics-primitives.js";
import { applyObjectComments, ensureObjectId } from "../object-comments.js";
import { resistorPoints } from "../../../../features/workspace/model/thermodynamics/resistor.js";
import { fanPaths } from "../../../../features/workspace/model/thermodynamics/fan.js";
import { workArrowPoints } from "../../../../features/workspace/model/thermodynamics/work-arrow.js";
import { annotationSubscript } from "../../../../features/workspace/model/annotations/math-label.js";
import enggTheme from "../../../../components/layout/workspace/theme.js";
import enggDimensionModel from "../../../../features/workspace/model/dimensions/dimension-model.js";
import {
  dimensionArrowMm,
  dimensionPens,
  POINTS_PER_MM,
} from "../../../geometry/dimension-layout.js";

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
  const theme = enggTheme;

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
function multiLineNode(at, text, colour, options = [], typography = {}, mathSubscript = null, mathSymbol = null, mathSuffix = "") {
  const lines = String(text ?? "").split("\n");
  const math = lines.length === 1 && annotationSubscript(text, { mathSubscript, mathSymbol, mathSuffix });
  const content = math
    ? `$${math.base}_{${math.subscript}}$${texText(math.suffix)}`
    : lines.map((line) => typography.underline ? `\\underline{${texText(line)}}` : texText(line)).join(" \\\\ ");

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

  const text = object.annotateKind === "symbol" ? enggAnnotate.textOf(object) : String(object.text ?? "");

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

  const note = object.annotateKind === "note";
  const typography = noteTextStyle(object.style);
  const fontSize = note ? typography.fontSize * 0.75 : fontFor(object.style);
  const family = typography.fontFamily === "Courier New" ? "\\ttfamily"
    : typography.fontFamily === "Times New Roman" ? "\\rmfamily" : "\\sffamily";
  const emphasis = `${typography.bold ? "\\bfseries" : ""}${typography.italic ? "\\itshape" : ""}`;
  return join(
    colourPrelude([object.style?.stroke]),
    multiLineNode({ x: finite(at.x) + (note ? typography.indent : 0), y: finite(at.y) }, text, colour, [
      `anchor=${textAnchor(object.style?.align)}`,
      `align=${typography.align}`,
      `font=\\fontsize{${num(fontSize, 2)}}{${num(fontSize * (note ? typography.lineSpacing : 1.2), 2)}}\\selectfont${note ? family + emphasis : ""}`
    ], note ? typography : {}, object.metadata?.mathSubscript, object.metadata?.mathSymbol, object.metadata?.mathSuffix)
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

  if (object.metadata?.thermodynamicsKind === "mechanical-work") {
    const paths = fanPaths(geometry);
    return paths.length ? join(definitions, paths.map(points => pathThrough(points, colour, [])).join("\n")) : null;
  }

  /*
   * ELECTRIC WORK IS A RESISTOR, not an arrow: two leads and the zigzag between
   * them, through the same points the canvas draws (`resistorPoints`).
   */
  if (object.metadata?.thermodynamicsKind === "electric-work") {
    const leads = resistorPoints(geometry).filter(valid);

    return leads.length >= 2 ? join(definitions, pathThrough(leads, colour, [])) : null;
  }

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

  const blockArrow = object.metadata?.thermodynamicsKind === "work-arrow" ? workArrowPoints(geometry) : [];
  if (blockArrow.length) {
    commands.push(pathThrough([...blockArrow, blockArrow[0]], colour, [`fill=${colour}`, "line join=miter"]));
  } else if (path.length >= 2) {
    commands.push(pathThrough(path, colour, [], arrow));
  }

  const text = String(object.text ?? "");
  const textAt = kind === "callout" ? geometry.end || geometry.position : valid(geometry.position) ? geometry.position : valid(geometry.end) ? geometry.end : null;

  if (text.trim() && textAt) {
    const fontSize = fontFor(object.style);

    if (kind === "callout") {
      const box = enggAnnotate.calloutBox(object);
      commands.push(object.style?.calloutShape === "circle"
        ? `\\draw[${colour}, fill=white] ${point((box.minX+box.maxX)/2,(box.minY+box.maxY)/2)} circle[radius=${num((box.maxX-box.minX)/2)}];`
        : `\\draw[${colour}, fill=white] ${point(box.minX,box.minY)} rectangle ${point(box.maxX,box.maxY)};`);
    }

    if (kind !== "arrow" || object.metadata?.thermodynamicsKind === "work-arrow") {
      commands.push(
        multiLineNode({ x: finite(textAt.x), y: finite(textAt.y) }, text, colour, [
          "anchor=center",
          `font=\\fontsize{${num(fontSize, 2)}}{${num(fontSize * 1.2, 2)}}\\selectfont`
        ], object.metadata?.mathSubscript, object.metadata?.mathSymbol, object.metadata?.mathSuffix)
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
 *
 * A COMPLETE DIMENSION IS WRITTEN, NOT A LINE AND A NUMBER. The witness lines,
 * the dimension line with its heads, the arc of an angle and the leader of a
 * radius are all emitted, because that is what the canvas draws and what makes
 * the exported picture a dimension rather than an arrow with a label near it.
 *
 * LINE WEIGHTS COME FROM THE ONE SHARED CONVERSION. `styleOptions` turns the
 * model's own style into millimetres of paper (`dimensionPens` in
 * `dimension-layout.js`) and writes that in printed points, and the witness
 * lines and the heads are then scaled DOWN from it by the same ratios the canvas
 * uses - so the printed hierarchy is the sheet's hierarchy, not a hairline
 * beside a heavy outline. The one unit conversion is the shared `POINTS_PER_MM`.
 */



function dimensionModel() {
  return enggDimensionModel || null;
}

function stateWithObjects(_object, allObjects, state) {
  if (state && Array.isArray(state.objects)) {
    return state;
  }

  return { objects: Array.isArray(allObjects) ? allObjects : [], units: "mm" };
}

/*
 * ONE STROKE OF A DIMENSION, IN MILLIMETRES OF PAPER.
 *
 * The pens are the SHARED document-space ones the canvas paints
 * (`dimensionPens` in `dimension-layout.js`), converted to printed points by
 * the one unit conversion - not derived from a screen pixel figure and not
 * scaled by an export reduction that would make the dimension thinner than the
 * outline it sits beside. `arrows.meta` sizes are millimetres, so the head's
 * length is the document's own `dimensionArrowMm`.
 */
function dimensionStroke(object, colour, pens, { dash = null } = {}) {
  const style = object?.style || {};

  const width = Number((pens * POINTS_PER_MM).toFixed(3));

  const options = [`draw=${colour}`, `line width=${num(width, 3)}pt`];

  if (dash) {
    options.push(`dash pattern=${dash}`);
  }

  const strokeOpacity = Number(style.opacity);

  if (Number.isFinite(strokeOpacity) && strokeOpacity > 0 && strokeOpacity < 1) {
    options.push(`draw opacity=${num(strokeOpacity, 3)}`);
  }

  return options;
}

/* A segment through world points, in EXPORT space, with its own options. */
function dimensionPath(points, options) {
  const usable = (points || []).filter(valid);

  if (usable.length < 2) {
    return null;
  }

  const body = usable
    .map((at, index) => `${index === 0 ? "" : "-- "}${point(finite(at.x), finite(at.y))}`)
    .join(" ");

  return `\\draw[${options.join(", ")}] ${body};`;
}



/*
 * ONE ARROWHEAD, at a place, pointing a way.
 *
 * Written as a short line from a point BEHIND the tip to the tip itself,
 * drawn with a `Latex` head on its END and sized from the document's own
 * `dimensionArrowMm` - so the head points the way the canvas triangle points
 * and is the same length, in millimetres, as the triangle on the sheet. The
 * head is filled in the dimension's colour, as the triangle is.
 *
 * `arrows.meta` supplies `{Latex[length=...]}`; the export's preamble loads
 * it (STANDALONE_LIBRARIES), so the block is a complete dimension in a clean
 * editor.
 */
function dimensionArrowhead(tip, direction, options, lengthMm) {
  if (!valid(tip) || !valid(direction)) {
    return null;
  }

  const length = Math.hypot(Number(direction.x), Number(direction.y)) || 1;

  const unit = { x: Number(direction.x) / length, y: Number(direction.y) / length };

  /* A short back-off - the head is drawn ON the end of the run. */
  const stub = Math.max(0.6, lengthMm * 0.6);

  const from = { x: finite(tip.x) - unit.x * stub, y: finite(tip.y) - unit.y * stub };

  /*
   * THE HEAD IS THE PLAIN `{Latex}` EVERY TIKZ EDITOR KNOWS.
   *
   * Its length is the document's own `dimensionArrowMm`, which has a legible
   * floor and is tied to the dimension line's pen - so the printed head keeps the
   * sheet's proportion without needing a per-head size declaration. That
   * declaration would have to be braced twice (`{{Latex[...]}}`) to survive the
   * comma inside a `\draw[...]` option list, and a form a reader cannot easily
   * edit is not what an export is for.
   */
  void lengthMm;

  const head = "{Latex}";

  return `\\draw[${[...options, `-${head}`].join(", ")}] ${point(
    from.x,
    from.y,
  )} -- ${point(finite(tip.x), finite(tip.y))};`;
}

/*
 * THE ONE TRANSFORM THAT APPLIES TO EVERY COORDINATE OF A DIMENSION.
 *
 * `point()` already maps a model coordinate through the export transform, so a
 * dimension's coordinates are its measured points through that one transform -
 * the same one the object outline beside it is written through. Nothing here
 * invents a coordinate: the dimension line's ends come from the defining points,
 * its position from the student's placement.
 */
function dimensionToTikz(object, graphics, colour) {
  if (!graphics) {
    return null;
  }

  const pens = dimensionPens(object?.style || {});

  const definitions = [];
  const commands = [];

  const push = (written, defs) => {
    if (written) {
      commands.push(written);
    }

    (defs || []).forEach((definition) => {
      if (!definitions.includes(definition)) {
        definitions.push(definition);
      }
    });
  };

  const main = dimensionStroke(object, colour, pens.line);
  const fine = dimensionStroke(object, colour, pens.witness, {
    dash: "on 2pt off 1.5pt",
  });
  const leader = dimensionStroke(object, colour, pens.witness, {
    dash: "on 2pt off 1.5pt",
  });

  /*
   * THE WITNESS LINES, FIRST - they are what ties the measurement to the
   * geometry, and their absence is what made an earlier export look like a
   * floating arrow.
   */
  (graphics.extensions || []).forEach((pair) => {
    if (Array.isArray(pair) && pair.length >= 2) {
      push(dimensionPath(pair, fine));
    }
  });

  const line = graphics.line;

  if (Array.isArray(line) && line.length >= 2) {
    push(dimensionPath(line, main));
  }

  /*
   * THE ANGLE'S ARC OR THE ARC LENGTH'S SWEEP, drawn only where the dimension
   * is that kind - a straight dimension has no arc and must not invent one.
   */
  const arcPoints = (graphics.arc || []).filter(valid);

  if (
    (graphics.kind === "angular" || graphics.kind === "arc-length") &&
    arcPoints.length >= 2
  ) {
    push(dimensionPath(arcPoints, main));
  }

  const lineLeader = graphics.leader;

  if (lineLeader?.from && lineLeader?.to) {
    push(dimensionPath([lineLeader.from, lineLeader.to], leader));
  }



  /*
   * THE HEADS, AT THE PLACES AND DIRECTIONS THE MODEL STATES.
   *
   * A linear, radial or angular dimension states them explicitly - including
   * the inside/outside convention and the diameter's two heads - so the source
   * carries exactly the heads the canvas draws. A footprint with no list falls
   * back to the ends of its own line, which is what every dimension drawn before
   * the list existed meant.
   */
  const heads = Array.isArray(graphics.arrowheads) && graphics.arrowheads.length
    ? graphics.arrowheads
    : Array.isArray(line) && line.length === 2
      ? [
          { at: line[0], direction: { x: line[1].x - line[0].x, y: line[1].y - line[0].y } },
          { at: line[1], direction: { x: line[0].x - line[1].x, y: line[0].y - line[1].y } },
        ]
      : [];

  const arrowMm = dimensionArrowMm(object?.style || {});

  heads.forEach((head) => {
    push(dimensionArrowhead(head.at, head.direction, main, arrowMm), [...definitions]);
  });

  /*
   * THE TEXT.
   *
   * At the frame's centre, in the frame's own type size and rotation, with a
   * `fill=white` backing so the dimension line does not run through the number -
   * the same clearance the canvas's glyph halo gives it. The size is the model's
   * PRINT size in points - the number in the Features panel and the quick-access
   * control - so the exported figure carries the sheet's physical type. The
   * family and weight are the label's own, and the alignment is carried by the
   * anchor, exactly as the canvas draws it.
   */
  const frame = graphics.textFrame;

  const textAt = frame ? { x: frame.x ?? frame.center?.x, y: frame.y ?? frame.center?.y } : null;

  if (valid(textAt) && String(graphics.text ?? "").trim()) {
    const sizePt = Number(graphics.label?.fontPt) || Number(frame?.fontSize) || 11;

    const rotation = Number.isFinite(Number(frame?.angle)) && Math.abs(Number(frame.angle)) > 1e-6
      ? `, rotate=${num(frame.angle)}`
      : "";

    const alignment = String(frame?.alignment || "center");

    const anchor = alignment === "left" ? "west" : alignment === "right" ? "east" : "center";

    const weight = String(object?.style?.bold) === "true" ? `\\bfseries` : "";

    const family = labelFamily(object?.style);

    push(
      `\\node[anchor=${anchor}, fill=white, inner sep=1.5pt, font=${family}\\fontsize{${num(sizePt, 2)}}{${num(
        sizePt * 1.2,
        2,
      )}}\\selectfont${weight}, text=${colour}${rotation}] at ${point(
        finite(textAt.x),
        finite(textAt.y),
      )} {${texText(graphics.text)}};`,
    );
  }

  return join(definitions, commands.filter(Boolean).join("\n"));
}

/*
 * THE LABEL'S FONT FAMILY, AS LATEX SELECTS IT.
 *
 * The canvas paints a dimension's number in the sans-serif face it states. A
 * sans face needs no package in a `standalone` document (`\sffamily` is what the
 * default family already is), and a serif note chooses `\rmfamily` - so the
 * printed number is in the same face as the one on the sheet, with no package
 * the preamble does not already load.
 */
function labelFamily(style) {
  const family = String(style?.fontFamily || "");

  if (/times/i.test(family)) {
    return "\\rmfamily ";
  }

  if (/courier/i.test(family)) {
    return "\\ttfamily ";
  }

  return "\\sffamily ";
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

  return dimensionToTikz(object, graphics, colour);
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

  const written = annotationCommands(object, options);

  if (typeof written !== "string" || !written.trim()) {
    return null;
  }

  /*
   * THE HEADER NAMES THE OBJECT AND ITS STABLE ID. A dimension or a callout is
   * several commands - witnesses, the line, the text - and they are ONE object;
   * the header says which, and the commands below it are that object's source.
   */
  const id = ensureObjectId(object, object.type);

  return applyObjectComments({ ...object, id }, written, { type: object.type });
}

/* The commands of one annotation object, without its header. */
function annotationCommands(object, options = {}) {
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
