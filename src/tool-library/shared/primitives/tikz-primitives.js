/*
 * ============================================================
 * SHARED TIKZ PRIMITIVES
 * ============================================================
 *
 * The reusable construction patterns that several tools build on, in one place.
 *
 * WHY THEY ARE SHARED AND NOT COPIED INTO EACH TOOL.
 *
 * A line is a line. If every tool that draws one carries its own `\draw ... --`
 * there is no single place to fix a coordinate convention, a unit, or an arrow
 * style - and the copies drift, which is how two "straight lines" end up drawing
 * at different scales. The primitives below are the shared vocabulary; a tool's
 * `template.tex` composes them rather than restating them.
 *
 * Each function returns LaTeX commands as a string. They are pure: the same
 * input always produces the same output, with no state and no I/O, so they can
 * be used by a template, by the source writer, or by a test without a canvas.
 *
 * UNITS. Coordinates are DAETUM drawing units - millimetres on paper - and the
 * picture declares `[x=1mm, y=1mm]`, so a coordinate of `(30,0)` is 30 mm to the
 * right. The primitives never append a unit to a coordinate, because the
 * picture already states it; appending "mm" as well would double the scale.
 */

/*
 * ============================================================
 * THE STYLE CONVERSION IS `tikz-style.js`
 * ============================================================
 *
 * Colour, pen width, dash pattern and opacity are decided there, once, so every
 * tool serialises a given style identically and the export factor is applied in
 * exactly one place. The width presets live there too and are re-exported, so a
 * module that asks this one for them still gets the single copy.
 */
import {
  DEFAULT_STROKE,
  NOMINAL_ARROW_HEAD_PT,
  THICKNESS_PRESETS,
  resolveLineWidth,
  colourName as sharedColourName,
  colourDefinition as sharedColourDefinition,
  strokeOptions as sharedStrokeOptions,
  fillOptions as sharedFillOptions
} from "./tikz-style.js";

export { THICKNESS_PRESETS, resolveLineWidth };

/*
 * HOW LONG ONE DRAWING UNIT IS DRAWN, in millimetres.
 *
 * DAETUM stores geometry in drawing units and the canvas paints one unit as
 * `BASE_PIXELS_PER_UNIT` pixels. A LaTeX picture cannot (and should not) be
 * told about the editor's pixels, so the ONE convention both sides share is
 * that a drawing unit is a paper millimetre: the picture omits the `x`/`y`
 * lengths, so TikZ's default `x=1cm` would draw every sheet at ten times its
 * size. The drawing source therefore declares `x=<UNIT_MM>mm, y=<UNIT_MM>mm`
 * and the picture, the standalone export and the generated code all agree.
 */
export const UNIT_MM = 1;

/*
 * The options every DAETUM picture opens with. Exported so the drawing source
 * (`drawing-source.js`), the standalone export and the tool templates cannot
 * disagree about the unit or the colour model.
 */
/* A number for LaTeX: no exponent notation, no trailing zeros. */
export function num(value, precision = 4) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "0";
  }

  const rounded = Number(number.toFixed(precision));

  return String(rounded);
}

export const PICTURE_OPTIONS = `[x=${num(UNIT_MM)}mm, y=${num(UNIT_MM)}mm]`;

/* A coordinate pair, `(x,y)`, in drawing units. */
export function point(x, y) {
  return `(${num(x)},${num(y)})`;
}

/* A coordinate pair with a leading `+`, for a relative step. */
export function relativePoint(dx, dy) {
  return `+${point(dx, dy)}`;
}

/*
 * ============================================================
 * THICKNESS PRESETS
 * ============================================================
 *
 * The table and `resolveLineWidth` live in `tikz-style.js` - the ONE place that
 * turns a DAETUM style into TikZ - and are re-exported at the top of this
 * module, so every existing importer keeps working while there is still exactly
 * one copy of the numbers.
 */

/*
 * ============================================================
 * COLOURS
 * ============================================================
 *
 * DAETUM styles can carry either named xcolor colours ("black") or CSS-style
 * hex strings ("#193335"). TikZ does not accept `#RRGGBB` directly, so when a
 * hex colour is present we emit a local `\definecolor` and refer to it by a
 * deterministic name.
 */

/*
 * THE COLOUR CONVERSION IS `tikz-style.js`'s.
 *
 * A hex colour becomes its deterministic `daetumC<hex>` name with an `{RGB}`
 * definition - the one model DAETUM's renderer loads - and an absent colour is
 * BLACK, never the interface theme's ink: the theme decides how a NEW object
 * starts, not what colour an existing drawing is made of.
 */
function resolveTikzColour(value) {
  if (value == null) {
    return { name: null, define: null };
  }

  const text = String(value).trim();

  if (!text || text === "none" || text === "transparent") {
    return { name: null, define: null, none: true };
  }

  const name = sharedColourName(text, { fallback: DEFAULT_STROKE });

  return { name, define: sharedColourDefinition(name, text) };
}

function uniqueLines(lines) {
  const out = [];
  const seen = new Set();

  (lines || []).forEach((line) => {
    const text = String(line || "");

    if (!text || seen.has(text)) {
      return;
    }

    seen.add(text);
    out.push(text);
  });

  return out;
}

function withPrelude(prelude, command) {
  const lines = uniqueLines(prelude);

  if (!lines.length) {
    return command;
  }

  return `${lines.join("\n")}\n${command}`;
}

/*
 * ============================================================
 * THE STROKE OPTIONS
 * ============================================================
 *
 * The one place a `\draw` option list is assembled from a style, so colour,
 * width and dash pattern are spelled the same way wherever they are used. This
 * is what makes "change the colour" a single fact rather than a per-tool
 * convention.
 *
 * A missing value is OMITTED rather than defaulted here - the default belongs to
 * the picture or the tool - so an object that never set a width does not have
 * one written into its source as if the student had chosen it.
 */
function strokeOptionsWithPrelude(style = {}, transform = null) {
  /*
   * ONE CONVERSION, SHARED BY EVERY WRITER.
   *
   * Colour, width, dash pattern and opacity are turned into options by
   * `tikz-style.js`, so a Line drawn with a Geometry tool, a Beam drawn with a
   * Statics tool and a Note drawn with an Annotate tool, all at the same style,
   * produce exactly the same option list. `transform` is the export context: it
   * contributes the ONE factor that reduces the figure, and every width and dash
   * length is multiplied by it exactly once.
   */
  const { options, definitions } = sharedStrokeOptions(style, { transform });

  return { options, prelude: definitions };
}

export function strokeOptions(style = {}, transform = null) {
  return strokeOptionsWithPrelude(style, transform).options;
}

function fillOptionWithPrelude(value, mode) {
  /*
   * FILL MODE GATES THE FILL COLOUR.
   *
   * The panel's Fill control is None / Solid, and the colour is a second field
   * that only means anything when the mode is Solid. So the mode decides
   * whether a fill is emitted at all: `none` must draw an outline even if a
   * colour was previously chosen and left in the style.
   */
  if (String(mode ?? "").toLowerCase() === "none") {
    return { option: null, prelude: [] };
  }

  const fill = sharedFillOptions({ fillMode: mode, fill: value });

  if (!fill.option) {
    return { option: null, prelude: [] };
  }

  return { option: fill.option, prelude: fill.definitions };
}

/* The bracket after `\draw`, or nothing when there are no options. */
export function optionsBracket(options) {
  return options && options.length ? `[${options.join(", ")}]` : "";
}

/* ============================================================
 * STRAIGHT LINE / PATH
 * ============================================================ */

/*
 * A straight segment from one point to another. An arrowhead may be requested
 * at either end, or both.
 */
export function straightLine(
  from,
  to,
  style = {},
  { arrow = "none", arrowStart = null, arrowEnd = null, transform = null } = {},
) {
  const { options, prelude } = strokeOptionsWithPrelude(style, transform);

  /*
   * AN INDEPENDENT HEAD AT EITHER END.
   *
   * A Line's Begin and End arrow types are chosen separately - a bar at the
   * start and a filled head at the end is an ordinary engineering mark - so
   * the two ends are resolved independently when the caller names them.
   * `arrow` is the older single-valued form and still works, because a caller
   * that has not been taught the two-ended version must not stop drawing.
   *
   * The arrow token is placed on the side the head belongs to: `<-` puts the
   * head at `from`, `->` at `to`, and `<->` at both.
   */
  /*
   * An independent tip at each end. The tip is a TikZ arrow marker - `>` is
   * the default single-line head, `{Latex}` a filled head, `|` a bar - and no
   * tip at all writes the bare `-` side of the token, which is the plain path.
   */
  const startTip = scaleTip(
    arrowStart === null || arrowStart === undefined
      ? (arrow === "start" || arrow === "both" ? ">" : "")
      : arrowTip(arrowStart),
    transform,
  );

  const endTip = scaleTip(
    arrowEnd === null || arrowEnd === undefined
      ? (arrow === "end" || arrow === "both" ? ">" : "")
      : arrowTip(arrowEnd),
    transform,
  );

  const arrows = `${startTip}-${endTip}`;

  /* A bare `-` is TikZ's default path; writing it would add nothing. */
  if (arrows !== "-") {
    options.push(arrows);
  }

  return withPrelude(
    prelude,
    `\\draw${optionsBracket(options)} ${point(from.x, from.y)} -- ${point(to.x, to.y)};`,
  );
}

/*
 * THE ARROW TIP AT THE EXPORT SCALE.
 *
 * A TikZ tip's size is PHYSICAL and does not follow the coordinates, so a head
 * on a reduced figure would stay full-size on a hairline shaft. `arrows.meta`
 * (loaded by DAETUM's renderer AND by the standalone export) allows the size to
 * be stated: `{Latex[length=.., width=..]}`. Only the two named tips can take
 * it - `>` and `|` are the plain ones, and writing a size on them would change
 * the drawing rather than preserve it.
 */
function scaleTip(tip, transform) {
  const factor = Number(transform?.factor);

  if (!tip || tip === ">" || tip === "|" || !Number.isFinite(factor) || factor >= 1) {
    return tip;
  }

  const name = /^\{?([A-Za-z]+)\}?$/.exec(tip);

  if (!name) {
    return tip;
  }

  const length = Number((NOMINAL_ARROW_HEAD_PT * factor).toFixed(3));
  const width = Number((length * 0.6).toFixed(3));

  return `{${name[1]}[length=${length}pt, width=${width}pt]}`;
}

export { scaleTip as scaledArrowTip };

/*
 * The TikZ arrow tip for one end of a line.
 *
 * The panel offers None / Open Arrow / Filled Arrow / Bar, so those are the
 * four tokens this understands. An unknown value is treated as None rather
 * than being written into the source, where TikZ would reject it and the whole
 * picture would fail to compile.
 */
function arrowTip(kind) {
  const value = String(kind ?? "none").toLowerCase();

  if (value === "open" || value === "open-arrow" || value === "openarrow") {
    return ">";
  }

  if (value === "filled" || value === "filled-arrow" || value === "filledarrow") {
    return "{Latex}";
  }

  if (value === "bar") {
    return "|";
  }

  return "";
}

/*
 * A polyline through a list of points. The optional `closed` joins the last
 * point back to the first with `-- cycle`, which is how a triangle, a rectangle
 * and a polygon are all drawn.
 */
export function polyline(points, style = {}, { closed = false } = {}) {
  if (!Array.isArray(points) || points.length < 2) {
    return "";
  }

  const { options, prelude } = strokeOptionsWithPrelude(style);
  const [first, ...rest] = points;

  const segments = [
    point(first.x, first.y),
    ...rest.map((p) => `-- ${point(p.x, p.y)}`),
    closed ? "-- cycle" : "",
  ].filter(Boolean);

  const singleLine = segments.join(" ");
  const shouldWrap = singleLine.length > 90 || segments.length > 6;

  if (!shouldWrap) {
    return withPrelude(prelude, `\\draw${optionsBracket(options)} ${singleLine};`);
  }

  return withPrelude(
    prelude,
    `\\draw${optionsBracket(options)}\n  ${segments.join("\n  ")};`,
  );
}

/*
 * A closed shape, as a fill or as a stroke. `fill: "none"` leaves it a stroke;
 * anything else fills it, with the fill colour and the stroke colour able to
 * differ.
 */
export function closedShape(points, style = {}) {
  if (!Array.isArray(points) || points.length < 3) {
    return "";
  }

  const { options, prelude } = strokeOptionsWithPrelude(style);
  const fill = fillOptionWithPrelude(style.fill, style.fillMode);

  if (fill.option) {
    options.push(fill.option);
  }

  if (fill.prelude.length) {
    prelude.push(...fill.prelude);
  }

  const segments = [
    point(points[0].x, points[0].y),
    ...points.slice(1).map((p) => `-- ${point(p.x, p.y)}`),
    "-- cycle",
  ];

  const singleLine = segments.join(" ");
  const shouldWrap = singleLine.length > 90 || segments.length > 6;

  if (!shouldWrap) {
    return withPrelude(prelude, `\\draw${optionsBracket(options)} ${singleLine};`);
  }

  return withPrelude(
    prelude,
    `\\draw${optionsBracket(options)}\n  ${segments.join("\n  ")};`,
  );
}

/* ============================================================
 * CURVES
 * ============================================================ */

/*
 * A cubic Bezier from one point to another through two control points. This is
 * the primitive behind every "curved line": the tool decides the control points,
 * the primitive decides how a curve is spelled.
 */
export function bezier(from, control1, control2, to, style = {}) {
  const { options, prelude } = strokeOptionsWithPrelude(style);
  const bracket = optionsBracket(options);

  const singleLine = `\\draw${bracket} ${point(from.x, from.y)} .. controls ${point(
    control1.x,
    control1.y,
  )} and ${point(control2.x, control2.y)} .. ${point(to.x, to.y)};`;

  if (singleLine.length <= 110) {
    return withPrelude(prelude, singleLine);
  }

  return withPrelude(
    prelude,
    `\\draw${bracket}\n  ${point(from.x, from.y)}\n  .. controls ${point(control1.x, control1.y)} and ${point(
      control2.x,
      control2.y,
    )}\n  .. ${point(to.x, to.y)};`,
  );
}

/*
 * A circular arc, drawn with TikZ's `arc` operation. Angles are in degrees and
 * measured anticlockwise from the positive x-axis, which is the convention TikZ
 * uses and the one a student reads off the picture.
 */
export function arc({
  centre,
  radius,
  startAngle = 0,
  endAngle = 90,
  style = {},
  arrow = "none",
}) {
  const sweep = Number(endAngle) - Number(startAngle);
  const { options, prelude } = strokeOptionsWithPrelude(style);

  if (arrow === "end") {
    options.push("->");
  } else if (arrow === "both") {
    options.push("<->");
  }

  /*
   * The start point is the point on the circle at `startAngle`; the `arc`
   * operation then sweeps by the difference. Expressing it this way rather
   * than with `arc[start angle=.., end angle=..]` keeps a negative sweep
   * working, which the explicit form does not.
   */
  const startX =
    Number(centre.x) +
    Number(radius) * Math.cos((Number(startAngle) * Math.PI) / 180);
  const startY =
    Number(centre.y) +
    Number(radius) * Math.sin((Number(startAngle) * Math.PI) / 180);

  return withPrelude(
    prelude,
    `\\draw${optionsBracket(options)} ${point(startX, startY)} arc[start angle=${num(
      startAngle,
    )}, end angle=${num(endAngle)}, radius=${num(radius)}]${sweep === 0 ? "" : ""};`,
  );
}

/* ============================================================
 * SHAPES
 * ============================================================ */

/* A circle: its centre and radius. */
export function circle({ centre, radius, style = {} }) {
  const { options, prelude } = strokeOptionsWithPrelude(style);
  const fill = fillOptionWithPrelude(style.fill, style.fillMode);

  if (fill.option) {
    options.push(fill.option);
  }

  if (fill.prelude.length) {
    prelude.push(...fill.prelude);
  }

  return withPrelude(
    prelude,
    `\\draw${optionsBracket(options)} ${point(centre.x, centre.y)} circle[radius=${num(radius)}];`,
  );
}

/* An ellipse: its centre and the two radii. */
export function ellipse({ centre, radiusX, radiusY, style = {} }) {
  const { options, prelude } = strokeOptionsWithPrelude(style);
  const fill = fillOptionWithPrelude(style.fill, style.fillMode);

  if (fill.option) {
    options.push(fill.option);
  }

  if (fill.prelude.length) {
    prelude.push(...fill.prelude);
  }

  return withPrelude(
    prelude,
    `\\draw${optionsBracket(options)} ${point(centre.x, centre.y)} ellipse[x radius=${num(
      radiusX,
    )}, y radius=${num(radiusY)}];`,
  );
}

/*
 * A rectangle given two opposite corners. TikZ's own `rectangle` operation is
 * used rather than four explicit sides, so the corners are exact and the shape
 * closes without a rounding seam.
 */
export function rectangle({ from, to, style = {} }) {
  const { options, prelude } = strokeOptionsWithPrelude(style);
  const fill = fillOptionWithPrelude(style.fill, style.fillMode);

  if (fill.option) {
    options.push(fill.option);
  }

  if (fill.prelude.length) {
    prelude.push(...fill.prelude);
  }

  return withPrelude(
    prelude,
    `\\draw${optionsBracket(options)} ${point(from.x, from.y)} rectangle ${point(to.x, to.y)};`,
  );
}

/* ============================================================
 * POINTS AND ANCHORS
 * ============================================================ */

/*
 * A coordinate the rest of the picture can refer to by name. An anchor is not
 * itself drawn - it is a named position a later command can be written against.
 */
export function coordinate(name, x, y) {
  return `\\coordinate (${name}) at ${point(x, y)};`;
}

/* A drawn point: a small filled marker at a position. */
export function marker({ at, style = {}, size = 2 }) {
  const colour = resolveTikzColour(style.stroke || "black");
  const prelude = [];

  if (colour && colour.define) {
    prelude.push(colour.define);
  }

  const name = colour && colour.name ? colour.name : "black";

  return withPrelude(
    prelude,
    `\\fill[${name}] ${point(at.x, at.y)} circle[radius=${num(size * 0.35, 3)}];`,
  );
}

/* ============================================================
 * TEXT NODES AND ARROWS
 * ============================================================ */

/*
 * A text node. `anchor` decides which point of the text box sits at the
 * position, so a label can be placed above, below or beside its target without
 * the tool having to compute the offset.
 */
export function textNode({
  at,
  text,
  anchor = "center",
  style = {},
  fontSize = null,
}) {
  const options = [];
  const prelude = [];

  if (anchor && anchor !== "center") {
    options.push(`anchor=${anchor}`);
  }

  if (style.stroke) {
    const colour = resolveTikzColour(style.stroke);

    if (colour && colour.define) {
      prelude.push(colour.define);
    }

    if (colour && colour.name) {
      options.push(`text=${colour.name}`);
    }
  }

  if (Number.isFinite(fontSize)) {
    options.push(
      `font=\\fontsize{${num(fontSize, 2)}}{${num(fontSize * 1.2, 2)}}\\selectfont`,
    );
  }

  const content = String(text ?? "");
  const location = point(at.x, at.y);
  const optionText = optionsBracket(options);
  const singleLine = `\\node${optionText} at ${location} {${content}};`;

  if (singleLine.length <= 110) {
    return withPrelude(prelude, singleLine);
  }

  return withPrelude(prelude, `\\node${optionText} at ${location}\n  {${content}};`);
}

/*
 * An arrow from one point to another. A straight arrow with a head, which is
 * the primitive under every force, leader and signal arrow.
 */
export function arrow({ from, to, style = {} }) {
  return straightLine(from, to, style, { arrow: "end" });
}

export default {
  num,
  point,
  relativePoint,
  THICKNESS_PRESETS,
  resolveLineWidth,
  strokeOptions,
  optionsBracket,
  straightLine,
  polyline,
  closedShape,
  bezier,
  arc,
  circle,
  ellipse,
  rectangle,
  coordinate,
  marker,
  textNode,
  arrow,
};
