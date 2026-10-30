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

/* The points in one millimetre: TeX's own 72.27 pt to the inch. */
export const POINTS_PER_MM = 72.27 / 25.4;

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
 * The Features panel offers named thicknesses, and the object model stores a
 * NUMERIC `lineWidth`. This table is the one conversion between the two, so a
 * named preset chosen in the panel and a speed read back from a saved file can
 * never disagree about which width "Thin" means.
 *
 * The values are in the model's own drawing units, which the renderer scales to
 * screen pixels. They are NOT engineering measurements and carry no unit in the
 * interface.
 */
export const THICKNESS_PRESETS = {
  "very-thin": 0.25,
  thin: 0.5,
  normal: 0.75,
  medium: 1.25,
  thick: 2,
  "very-thick": 3
};

/*
 * A numeric line width from either a preset name or a number.
 *
 * Absent means Normal, which is the documented default for a new Geometry
 * object. An unknown name also falls back to Normal rather than producing
 * `undefined` and a path with no width at all.
 */
export function resolveLineWidth(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  const named = THICKNESS_PRESETS[String(value ?? "").toLowerCase()];

  return named !== undefined ? named : THICKNESS_PRESETS.normal;
}

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

function normaliseHex(value) {
  const text = String(value ?? "").trim();

  if (!text || text === "none" || text === "transparent") {
    return null;
  }

  const short = text.match(/^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/);

  if (short) {
    return short
      .slice(1)
      .map((c) => c + c)
      .join("")
      .toUpperCase();
  }

  const long = text.match(/^#([0-9a-fA-F]{6})$/);

  if (long) {
    return long[1].toUpperCase();
  }

  return null;
}

function colourNameForHex(hex) {
  // Must start with a letter for maximum TeX compatibility.
  return `daetumC${hex}`;
}

function resolveTikzColour(value) {
  if (value == null) {
    return { name: null, define: null };
  }

  const text = String(value).trim();

  if (!text || text === "none" || text === "transparent") {
    return { name: null, define: null, none: true };
  }

  const hex = normaliseHex(text);

  if (hex) {
    const name = colourNameForHex(hex);

    return {
      name,
      define: `\\definecolor{${name}}{HTML}{${hex}}`,
    };
  }

  return { name: text, define: null };
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
function strokeOptionsWithPrelude(style = {}) {
  const options = [];
  const prelude = [];

  const stroke = resolveTikzColour(style.stroke);

  if (stroke && stroke.none) {
    options.push("draw=none");
  } else if (stroke && stroke.name) {
    if (stroke.define) {
      prelude.push(stroke.define);
    }

    options.push(stroke.name);
  }

  /*
   * THE WIDTH is resolved through the shared preset table, so a style that
   * names its thickness ("thin") and one that stores a number both produce a
   * pen width. A style that names NEITHER gets the documented Normal default,
   * which keeps an absent width from silently drawing a hairline.
   */
  const width = resolveLineWidth(style.lineWidth);

  if (Number.isFinite(width) && width > 0) {
    /*
     * A PEN WIDTH IN DRAWING UNITS, NOT IN POINTS.
     *
     * `style.lineWidth` is a DAETUM width: the number the Features panel
     * stores, which the canvas paints as `lineWidth * BASE_PIXELS_PER_UNIT`
     * pixels. The picture declares `x=1mm, y=1mm`, so ONE DRAWING UNIT IS
     * `UNIT_MM` MILLIMETRES = `UNIT_MM * 72.27 / 25.4` points, and that is the
     * conversion a pen width needs.
     *
     * IT USED TO MULTIPLY BY 0.56 - a leftover from an older unit system. A
     * Normal (0.75) line therefore compiled to 0.42 pt, which the canvas draws
     * 0.35 px wide against the overlay's 1.8 px: every compiled drawing was
     * present, correctly placed, and effectively INVISIBLE. Compiling was never
     * the failure; the ink was a hairline.
     */
    const points = width * UNIT_MM * POINTS_PER_MM;

    options.push(`line width=${num(points, 3)}pt`);
  }

  if (style.lineType === "dashed") {
    options.push("dashed");
  } else if (style.lineType === "dotted") {
    /* `dotted` is TikZ's own name, so it needs no hand-written pattern. */
    options.push("dotted");
  } else if (style.lineType === "center") {
    options.push("dash pattern=on 4pt off 2pt on 1pt off 2pt");
  } else if (style.lineType === "construction") {
    options.push("dash pattern=on 1pt off 2pt");

    /*
     * THE CONSTRUCTION GREY MUST NOT EAT A CHOSEN COLOUR.
     *
     * TikZ keeps the LAST colour option, so a bare `gray` after the stroke
     * replaces it. Only a style that never named a colour gets the grey.
     * See the same rule - and the defect it fixes - in the Statics
     * primitives' `styleOptions`.
     */
    const named = String(style.stroke ?? "").trim();

    if (!named || /^(none|transparent)$/i.test(named)) {
      options.push("gray");
    }
  }

  return { options, prelude };
}

export function strokeOptions(style = {}) {
  return strokeOptionsWithPrelude(style).options;
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

  const fill = resolveTikzColour(value);

  if (!fill || fill.none || !fill.name) {
    return { option: null, prelude: [] };
  }

  return {
    option: `fill=${fill.name}`,
    prelude: fill.define ? [fill.define] : [],
  };
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
export function straightLine(from, to, style = {}, { arrow = "none", arrowStart = null, arrowEnd = null } = {}) {
  const { options, prelude } = strokeOptionsWithPrelude(style);

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
  const startTip = arrowStart === null || arrowStart === undefined
    ? (arrow === "start" || arrow === "both" ? ">" : "")
    : arrowTip(arrowStart);

  const endTip = arrowEnd === null || arrowEnd === undefined
    ? (arrow === "end" || arrow === "both" ? ">" : "")
    : arrowTip(arrowEnd);

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

  /*
   * THE RADIUS IS THE MARKER'S SIZE, NOT A FRACTION OF IT.
   *
   * `size` is the DIAMETER the Features panel calls Small / Medium / Large,
   * in drawing units, and the canvas paints the same marker at its own size.
   * The radius used to be `size * 0.35`, which drew a Medium point 0.7 units
   * across - 1.7 px at the default zoom - so a Point compiled successfully
   * and was effectively invisible on the sheet. Half the diameter is the
   * radius; anything less is a marker that does not mark.
   */
  const radius = Math.max(0.2, Number(size) / 2);

  return withPrelude(
    prelude,
    `\\fill[${name}] ${point(at.x, at.y)} circle[radius=${num(radius, 3)}];`,
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
