/*
 * ============================================================
 * STATICS SOURCE GENERATOR
 * ============================================================
 *
 * Turns a structured Statics object into the TikZ commands that draw it, from
 * the REAL object data - coordinates, control points, orientation, appearance,
 * arrow types, engineering values and display options. Nothing here holds a
 * sample drawing, a default coordinate or a demonstration curve: a value that
 * is not on the object is not in the code.
 *
 * WHY ONE MODULE AND NOT A WRITER PER TOOL.
 *
 * There is one object model and one drawing surface, and the 26 Statics types
 * share almost all of their source vocabulary - a point, a stroke style, an
 * arrow head, a text node, a source region. A copy of that vocabulary in each
 * tool would drift: two supports would eventually be spelled differently, and
 * one of them would stop compiling without anyone noticing which. So the
 * vocabulary lives in `statics-primitives.js`, the per-type geometry lives in
 * the serializer table below, and this module owns the things that are about
 * the DRAWING rather than about a type:
 *
 *     generateStaticsTikz(objects)              the source for a set of objects
 *     generateStaticsTikzWithSourceMap(objects) the same, plus id -> region
 *
 * HOW IT IS WIRED.
 *
 * The application already has a source pipeline - `source-synchronization.js`
 * writes one object's region at a time into the live Source, and
 * `drawing-panel.js` reconciles on every committed edit. This module is the
 * WRITER for Statics types, installed beside the Geometry writer. It is
 * therefore part of the drawing workflow, not a generator a caller has to
 * remember to run: draw a beam and its code appears in the Source tab.
 *
 * PURITY. Every function here is a pure function of the object. Nothing
 * is mutated, so the same object always produces the same code and a test can
 * call the serializer without a canvas.
 *
 * "THIS SHEET ORIGINATES AT (0,0)".
 *
 * A Statics type is written by the reader BELOW, but only for an object that is
 * actually a Statics object. The point, line and arc serializers here are the
 * FALLBACK for the Reference tools, which create ordinary geometry; a Geometry
 * tool's Point or Line is commonly above (0,0) and would otherwise be drawn at
 * the origin on top of the reference geometry when this writer was asked first.
 * Such an object is declined, which hands it to the Geometry writer - the one
 * that knows its conventions. See `isStaticsObject`.
 */

import {
  arrowHeadTip,
  bodyNormal,
  colourDefinition,
  colourOf,
  currentExportTransform,
  loadArrowLength,
  loadDirectionOf,
  loadReversed,
  loadSamples,
  num,
  point,
  sketchStrokeCommands,
  sourceMapFor,
  staticsTextNodes,
  styleOptions,
  texText,
  vector,
  withExportTransform,
} from "./statics-primitives.js";
import { clearSourceGenerationProblem, reportSourceGenerationProblem } from "../source-diagnostics.js";
import { NOMINAL_ARROW_HEAD_PT } from "../../../../tool-library/shared/primitives/tikz-style.js";
import enggDiagramEquations from "../../../../features/workspace/model/analysis/diagram-equations.js";
import { sketchPointsOf as canvasSketchPointsOf } from "../../analysis-render.js";

/* ============================================================
 * HELPERS
 * ============================================================ */

function finite(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
}

function pointOf(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return { x: 0, y: 0 };
  }

  return { x: finite(candidate.x), y: finite(candidate.y) };
}

function validPoint(candidate) {
  return Boolean(
    candidate &&
      Number.isFinite(Number(candidate.x)) &&
      Number.isFinite(Number(candidate.y)),
  );
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/*
 * ============================================================
 * WRITING A COMMAND
 * ============================================================
 *
 * An option list may carry `\definecolor` definitions, which are valid TikZ
 * but NOT valid inside a `[...]` option bracket. `splitOptions` is the only
 * place that separates them, and every command below is written through
 * `writeCommand`, so a definition can never land inside a bracket.
 */
export function splitOptions(options) {
  const definitions = [];
  const kept = [];

  (Array.isArray(options) ? options : []).forEach((option) => {
    const text = String(option ?? "");

    if (!text) {
      return;
    }

    if (/^\\definecolor/.test(text)) {
      if (!definitions.includes(text)) {
        definitions.push(text);
      }

      return;
    }

    kept.push(text);
  });

  return { definitions, options: kept };
}

function withArrow(options, arrow) {
  const split = splitOptions(options);
  const kept = [...split.options];

  if (arrow) {
    kept.push(arrow);
  }

  /* The definitions travel WITH the options, never dropped. */
  return [...split.definitions, ...kept];
}

/*
 * A colour a command USES but does not define. The definition usually travels
 * in the options; a command built from options that were already split - the
 * particle, a joint dot, a moment's centre - would otherwise lose it, and TeX
 * stops with "Undefined color". The definition is restated here whenever the
 * colour is a hex, which is valid even when the same colour was defined above.
 */
function definitionForOptions(options) {
  const definitions = [];

  splitOptions(options).options.forEach((option) => {
    const match = String(option).match(/^(?:draw|fill|text)=daetumC([0-9A-F]{6})$/);

    if (match) {
      const line = colourDefinition(`daetumC${match[1]}`, match[1]);

      if (line && !definitions.includes(line)) {
        definitions.push(line);
      }
    }
  });

  return definitions;
}

/*
 * A COLOUR IS DEFINED ONCE PER OBJECT.
 *
 * Every command of an object used to restate `\definecolor{daetumC193335}` in
 * front of itself. That is valid TeX, but a truss with twelve members wrote the
 * same line twelve times, and a diagram with an axis, its labels and its curve
 * wrote it for each. Since the definition is a property of the COLOUR and not of
 * the command, it is emitted in front of the first command only. The rewrite is
 * per serialized object, so no two objects ever depend on each other's output.
 */
function defineOncePerObject(commands) {
  const text = String(commands ?? "");
  const lines = text.split("\n");
  const seen = new Set();
  const kept = [];

  lines.forEach((line) => {
    const match = /^\s*\\definecolor\{([^}]+)\}/.exec(line);

    if (!match) {
      kept.push(line);
      return;
    }

    if (seen.has(match[1])) {
      return;
    }

    seen.add(match[1]);
    kept.push(line);
  });

  /*
   * A definition whose colour is also written in an `HTML` model is
   * re-declared in `RGB`, which DAETUM's renderer supports - so a picture that
   * mixes the two writers still compiles.
   */
  const rewritten = kept.map((line) => {
    const match = /^\s*\\definecolor\{([^}]+)\}\{HTML\}\{([0-9A-Fa-f]{6})\}\s*$/.exec(line);

    if (!match) {
      return line;
    }

    const definition = colourDefinition(match[1], match[2]);

    return definition || line;
  });

  return rewritten.join("\n");
}

function writeCommand(operator, options, body) {
  const split = splitOptions(options);

  /*
   * A `\fill` IS STILL A PATH, AND ITS COLOUR IS STILL WRITTEN AS `draw=`.
   *
   * `fill=COL` on a `\fill` selects the fill and leaves the stroke at the
   * picture's default, so the colour a filled marker was drawn in would be lost
   * the moment the document was not black. `draw=COL` on a fill draws nothing
   * extra - the operator selects the fill itself - and keeps the colour
   * explicit, which is what makes a colour edit reach the source.
   */
  const kept = operator === "fill" ? fillKeptOptions(split.options) : split.options;

  const unique = kept.filter((option, index) => kept.indexOf(option) === index);
  const bracket = unique.length ? `[${unique.join(", ")}]` : "";

  const definitions = [...new Set([...split.definitions, ...definitionForOptions(options)])];

  return [...definitions, `\\${operator}${bracket} ${body};`].join("\n");
}

function draws(options, body) {
  return writeCommand("draw", options, body);
}

function fills(options, body) {
  return writeCommand("fill", options, body);
}

/*
 * THE OPTIONS A `\fill` KEEPS.
 *
 * `draw=COL` on a `\fill` selects the fill and draws nothing extra - which is
 * why an ordinary filled shape can state its colour that way and keep it
 * explicit. But a marker whose options say `draw=none` (a particle, a joint, a
 * moment's centre) HAS no pen, and turning its `fill=` into `draw=` would give
 * the stroke back. So when the outline is suppressed:
 *
 *   - the suppression stays, once;
 *   - every blank `draw=` (what a `draw=none` style contributes) is dropped;
 *   - the colour is written as `fill=`, which is the operator's own key.
 */
function fillKeptOptions(options) {
  const list = Array.isArray(options) ? options : [];
  const noStroke = list.includes("draw=none");

  const kept = [];

  list.forEach((option) => {
    const text = String(option ?? "");

    if (/^draw=$/.test(text)) {
      return;
    }

    const colour = /^fill=(?!none$)(.+)$/.exec(text);

    if (noStroke) {
      /* A suppressed outline keeps the colour on the fill, never on a pen. */
      if (/^draw=(.+)$/.test(text) && text !== "draw=none") {
        const value = /^draw=(.+)$/.exec(text)[1];

        kept.push(`fill=${value}`);
        return;
      }

      kept.push(text);
      return;
    }

    kept.push(colour ? `draw=${colour[1]}` : text);
  });

  return kept;
}

/* One `\draw` path through a list of points. */
function drawPath(points, options, { cycle = false } = {}) {
  if (!Array.isArray(points) || points.length < 2) {
    return null;
  }

  const body = points
    .map((at, index) =>
      index === 0 ? point(at.x, at.y) : `-- ${point(at.x, at.y)}`,
    )
    .join(" ");

  return draws(options, `${body}${cycle ? " -- cycle" : ""}`);
}

function seg(from, to, options, arrow = null) {
  return draws(withArrow(options, arrow), `${point(from.x, from.y)} -- ${point(to.x, to.y)}`);
}

/* The tip token for a style's end arrow; the tool's own head by default. */
function headFor(style, fallback = "filled") {
  const declared = Object.hasOwn(style || {}, "arrowEnd") ? style.arrowEnd : fallback;

  return arrowHeadTip(declared);
}

/*
 * THE ARROW TOKEN AT THE EXPORT SCALE.
 *
 * A TikZ tip's size is PHYSICAL and does not follow the coordinates, so a head
 * on a reduced figure would stay full-size on a hairline shaft - visibly out of
 * proportion. `arrows.meta` is loaded by DAETUM's renderer and by the standalone
 * export, and lets the size be stated: `{Latex[length=.., width=..]}`. At scale
 * 1 the plain token is written, which is the code a reader expects.
 *
 * The factor comes from the transform in effect for THIS object, so the head
 * and the shaft it belongs to are always scaled by the same one.
 */
function scaledTip(tip) {
  const transform = currentExportTransform();
  const factor = Number(transform?.factor);

  if (!tip || !Number.isFinite(factor) || factor >= 1) {
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

/*
 * ============================================================
 * THE GENERATION OPTIONS
 * ============================================================
 *
 * Every object is drawn from its own stored geometry. The sheet is passed
 * through for the few things that genuinely belong to it (display switches
 * read by the text nodes); nothing here converts a magnitude into a length.
 */
export function generationOptions(state, overrides = {}) {
  return {
    units: state?.units || "mm",
    state: state || null,
    ...overrides,
  };
}

/* ============================================================
 * BODIES
 * ============================================================ */

/*
 * THE DRAWN SIZE OF A SYMBOL, AT THE EXPORT SCALE.
 *
 * The constants below are MODEL UNITS - how big a particle, a moment's arc or a
 * support's triangle is DRAWN relative to the sheet. They are part of the
 * picture's appearance, not of its coordinate system, so a reduced figure must
 * draw them smaller by the same factor as everything else - otherwise a support
 * symbol stays full-size beside a beam that has been reduced to a third.
 *
 * `symbolSize` reads the transform in effect for the object being serialized, so
 * the factor is the one the drawing was exported at and is applied exactly once.
 */
function symbolSize(modelUnits) {
  const factor = Number(currentExportTransform()?.factor);

  const size = Number(modelUnits) || 0;

  return Number.isFinite(factor) && factor > 0 ? size * factor : size;
}

const PARTICLE_RADIUS = 1;

function serializeParticle(entity, object) {
  const position = pointOf(object.geometry?.position);

  /*
   * A FILL COLOUR NEEDS ITS DEFINITION LIKE ANY OTHER COLOUR, and it is a
   * STROKE option that carries one. So the particle takes the stroke options
   * - which define `daetumC...` above the command - and changes the drawing
   * to a fill. DAETUM's particle is a filled node marker; it has no outline.
   */
  const options = [
    ...splitOptions(styleOptions(object.style)).options.filter(
      (option) =>
        !option.startsWith("draw=") &&
        !option.startsWith("fill=") &&
        !option.startsWith("fill opacity="),
    ),
    "draw=none",
    `fill=${colourOf(object.style, "stroke")}`,
  ];

/*
 * THE COMMAND THE MARKER IS WRITTEN WITH.
 *
 * A fired particle's outline is suppressed with `draw=none`; `\draw[draw=none]`
 * paints nothing in TikZ (the pen is disabled), so the circle would vanish even
 * though it carries a fill. A path that has no stroke is a `\fill`, which is
 * what the truss joints and reference points already use - and what the canvas
 * draws for this symbol.
 */
  return fills(options, `${point(position.x, position.y)} circle[radius=${num(symbolSize(PARTICLE_RADIUS))}]`);
}

function rigidBodyOutline(geometry) {
  const shape = String(geometry.shape || "rectangle").toLowerCase();

  if (shape === "circle") {
    return {
      kind: "circle",
      centre: pointOf(geometry.center || geometry.position),
      radius: finite(geometry.radius),
    };
  }

  if ((shape === "polygon" || shape === "triangle") && Array.isArray(geometry.points) && geometry.points.length >= 3) {
    return { kind: "points", points: geometry.points.filter(validPoint).map(pointOf) };
  }

  /*
   * A RECTANGLE IS FOUR ROTATED CORNERS, not a `rectangle` operation: TikZ's
   * rectangle is axis-aligned and would silently square up a body the student
   * turned. The corners are the stored position, width, height and rotation,
   * so the code describes the outline the canvas draws.
   */
  const position = pointOf(geometry.position);
  const width = finite(geometry.width);
  const height = finite(geometry.height);
  const rotation = finite(geometry.rotation);
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  const corners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ].map((corner) => ({
    x: position.x + corner.x * cos - corner.y * sin,
    y: position.y + corner.x * sin + corner.y * cos,
  }));

  return { kind: "points", points: corners };
}

function serializeRigidBody(entity, object) {
  const outline = rigidBodyOutline(object.geometry || {});
  const options = styleOptions(object.style);

  if (outline.kind === "circle") {
    if (!(outline.radius > 0)) {
      return null;
    }

    return draws(options, `${point(outline.centre.x, outline.centre.y)} circle[radius=${num(symbolSize(outline.radius))}]`);
  }

  return drawPath(outline.points, options, { cycle: true });
}

/*
 * A CABLE'S ENDS may be stored as `start`/`end` or as two suspended points in
 * `points`, which is what a cable dragged between two supports carries. Reading
 * only the first meant such a cable had no source at all.
 */
function memberCableEnds(geometry) {
  const direct = memberEnds(geometry);

  if (direct) {
    return direct;
  }

  const points = Array.isArray(geometry?.points) ? geometry.points : [];

  if (points.length >= 2 && validPoint(points[0]) && validPoint(points[points.length - 1])) {
    return { start: pointOf(points[0]), end: pointOf(points[points.length - 1]) };
  }

  return null;
}

function memberEnds(geometry) {
  const start = geometry?.start;
  const end = geometry?.end;

  if (!validPoint(start) || !validPoint(end)) {
    return null;
  }

  return { start: pointOf(start), end: pointOf(end) };
}

/* The four corners of a bar of `halfDepth` around a centreline. */
function barOutline(start, end, halfDepth) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);

  if (!(length > 1e-9)) {
    return null;
  }

  const normal = { x: -dy / length, y: dx / length };

  return [
    { x: start.x + normal.x * halfDepth, y: start.y + normal.y * halfDepth },
    { x: end.x + normal.x * halfDepth, y: end.y + normal.y * halfDepth },
    { x: end.x - normal.x * halfDepth, y: end.y - normal.y * halfDepth },
    { x: start.x - normal.x * halfDepth, y: start.y - normal.y * halfDepth },
  ];
}

const BEAM_HALF_DEPTH = 6;
const SHAFT_DEFAULT_RADIUS = 4;
const TRUSS_DEPTH = 12;
function serializeBeam(entity, object) {
  const ends = memberEnds(object.geometry);

  if (!ends) {
    return null;
  }

  /*
   * THE BEAM'S OWN DEPTH WINS.
   *
   * `geometry.depth` is stored when the student resizes the bar (and the canvas
   * draws with it - `renderedBounds` measures `depth / 2`). Using the shared
   * default unconditionally made a resized beam smaller in the source than on the
   * sheet, and made the two disagree about where its outline is. A beam with no
   * stored depth keeps the shared default.
   */
  const stored = finite(object.geometry?.depth);
  const halfDepth = stored !== null && stored > 0 ? stored / 2 : BEAM_HALF_DEPTH;

  const outline = barOutline(ends.start, ends.end, symbolSize(halfDepth));

  return outline ? drawPath(outline, styleOptions(object.style), { cycle: true }) : null;
}

function serializeCable(entity, object) {
  const geometry = object.geometry || {};
  const ends = memberCableEnds(geometry);

  if (!ends) {
    return null;
  }

  /*
   * A CABLE IS THE STORED PATH. When the object carries a control point - or a
   * sag - the curve is drawn through it; otherwise it is the straight span the
   * student drew. No sag is invented.
   */
  const control = validPoint(geometry.control)
    ? pointOf(geometry.control)
    : validPoint(geometry.sagPoint)
      ? pointOf(geometry.sagPoint)
      : null;

  const sag = finite(geometry.sag);
  const options = styleOptions(object.style);

  if (control) {
    return draws(
      options,
      `${point(ends.start.x, ends.start.y)} .. controls ${point(control.x, control.y)} .. ${point(ends.end.x, ends.end.y)}`,
    );
  }

  if (Math.abs(sag) > 1e-9) {
    const mid = {
      x: (ends.start.x + ends.end.x) / 2,
      y: (ends.start.y + ends.end.y) / 2 + sag,
    };

    return draws(
      options,
      `${point(ends.start.x, ends.start.y)} .. controls ${point(mid.x, mid.y)} and ${point(mid.x, mid.y)} .. ${point(ends.end.x, ends.end.y)}`,
    );
  }

  return seg(ends.start, ends.end, options);
}

function serializeShaft(entity, object) {
  const geometry = object.geometry || {};
  const ends = memberEnds(geometry);

  if (!ends) {
    return null;
  }

  /*
   * A SHAFT'S DIAMETER IS DRAWN SIZE, unless the object stores its own.
   *
   * The stored diameter is the student's own dimension and is scaled with the
   * geometry by `point`; the FALLBACK is a drawn symbol size, so it is scaled
   * here. Multiplying only the fallback keeps a stored diameter from being
   * reduced twice.
   */
  const storedDiameter = finite(geometry.diameter);
  const diameter = storedDiameter > 0 ? storedDiameter : symbolSize(SHAFT_DEFAULT_RADIUS * 2);
  const half = diameter / 2;
  const outline = barOutline(ends.start, ends.end, half);

  if (!outline) {
    return null;
  }

  const style = object.style || {};

  const dx = ends.end.x - ends.start.x;
  const dy = ends.end.y - ends.start.y;
  const length = Math.hypot(dx, dy) || 1;
  const normal = { x: -dy / length, y: dx / length };

  /*
   * THE SHAFT IS ITS PROFILE, ITS TWO END MARKINGS AND ITS AXIS. All three are
   * derived from the same two endpoints, so a move or a resize keeps them
   * concentric.
   */
  const commands = [drawPath(outline, styleOptions(style), { cycle: true })];

  [ends.start, ends.end].forEach((at) => {
    commands.push(
      seg(
        { x: at.x + normal.x * half, y: at.y + normal.y * half },
        { x: at.x - normal.x * half, y: at.y - normal.y * half },
        styleOptions({ ...style, lineType: "solid" }),
      ),
    );
  });

  commands.push(seg(ends.start, ends.end, styleOptions({ ...style, lineType: "center" })));

  return commands.filter(Boolean).join("\n");
}

/*
 * A TRUSS IS EVERY MEMBER AND EVERY JOINT IT ACTUALLY STORES.
 *
 * The members are drawn from their own endpoints, so shared vertices stay
 * shared - a joint reached by two members is one point, and the joints are
 * drawn once each rather than once per member. A truss from before member
 * lists existed (or one placed as a plain span) falls back to the two-chord
 * panel it is DRAWN as, derived from its span and panel count - that is the
 * object's own geometry, not an invented example.
 */
export function trussMembers(geometry) {
  if (Array.isArray(geometry?.members) && geometry.members.length) {
    return geometry.members
      .filter((member) => validPoint(member?.start) && validPoint(member?.end))
      .map((member) => ({ start: pointOf(member.start), end: pointOf(member.end) }));
  }

  const ends = memberEnds(geometry);

  if (!ends) {
    return [];
  }

  const dx = ends.end.x - ends.start.x;
  const dy = ends.end.y - ends.start.y;
  const length = Math.hypot(dx, dy);

  if (!(length > 1e-9)) {
    return [];
  }

  const depth = symbolSize(TRUSS_DEPTH);

  const normal = { x: (-dy / length) * depth, y: (dx / length) * depth };
  const panels = Math.max(2, Math.round(finite(geometry.panels, 4)));

  const top = (t) => ({
    x: ends.start.x + (ends.end.x - ends.start.x) * t + normal.x,
    y: ends.start.y + (ends.end.y - ends.start.y) * t + normal.y,
  });

  const bottom = (t) => ({
    x: ends.start.x + (ends.end.x - ends.start.x) * t - normal.x,
    y: ends.start.y + (ends.end.y - ends.start.y) * t - normal.y,
  });

  const members = [{ start: top(0), end: top(1) }, { start: bottom(0), end: bottom(1) }];

  for (let index = 0; index <= panels; index += 1) {
    const t = index / panels;

    members.push({ start: top(t), end: bottom(t) });

    if (index < panels) {
      members.push({ start: top(t), end: bottom((index + 1) / panels) });
    }
  }

  return members;
}

export function trussJoints(members) {
  const joints = [];

  members.forEach((member) => {
    [member.start, member.end].forEach((at) => {
      if (joints.some((known) => distance(known, at) < 1e-6)) {
        return;
      }

      joints.push(at);
    });
  });

  return joints;
}

function serializeTruss(entity, object) {
  const members = trussMembers(object.geometry || {});

  if (!members.length) {
    return null;
  }

  const style = object.style || {};
  const memberOptions = styleOptions({ ...style, lineType: "solid" });

  const commands = members.map((member) => seg(member.start, member.end, memberOptions));

  const jointOptions = [
    ...splitOptions(styleOptions(style)).options.filter(
      (option) => !option.startsWith("draw=") && !option.startsWith("fill="),
    ),
    "draw=none",
    `fill=${colourOf(style, "stroke")}`,
  ];

  trussJoints(members).forEach((at) => {
    commands.push(fills(jointOptions, `${point(at.x, at.y)} circle[radius=${num(symbolSize(0.75))}]`));
  });

  return commands.join("\n");
}

/* ============================================================
 * POINT FORCES AND LOADS
 * ============================================================ */

/*
 * WHERE A FORCE IS DRAWN.
 *
 * The arrow the student drew: the application point `start` to the stored
 * `end`. Its length is the gesture's and the magnitude is only its label, so
 * typing 20 N or 5 kN never resizes it. A force with no stored `end` (saved
 * before arrows kept their drawn length) is drawn along its angle at its
 * magnitude - how it looked then.
 */
function storedSpan(geometry) {
  const start = validPoint(geometry.start)
    ? pointOf(geometry.start)
    : validPoint(geometry.position)
      ? pointOf(geometry.position)
      : null;

  if (!start) {
    return null;
  }

  if (validPoint(geometry.end)) {
    const end = pointOf(geometry.end);

    if (distance(start, end) > 1e-9) {
      return { start, end };
    }
  }

  /*
   * A STORED `end` THAT IS A NUMBER IS THE ARROW'S DRAWN LENGTH.
   *
   * A force created by the factory keeps its span as `start` plus a scalar
   * `end` - how far it reaches along its own angle - while a force placed by a
   * gesture keeps a second point. Reading only the point form made every
   * factory-created force "not drawable", so it dropped out of the sheet. The
   * scalar is used exactly as the point is: `start` to `start + length x angle`.
   */
  const reach =
    typeof geometry.end === "number" && Number.isFinite(geometry.end) && Math.abs(geometry.end) > 1e-9
      ? Math.abs(geometry.end)
      : null;

  const magnitude = Number(geometry.magnitude);
  const angle = Number(geometry.angle);

  if (Number.isFinite(angle) && (reach !== null || (Number.isFinite(magnitude) && Math.abs(magnitude) > 1e-9))) {
    const direction = vector(angle);
    const length = reach !== null ? reach : Math.abs(magnitude);

    return {
      start,
      end: { x: start.x + direction.x * length, y: start.y + direction.y * length },
    };
  }

  return null;
}

function drawnForceSpan(object) {
  return storedSpan(object.geometry || {});
}

function serializePointForce(entity, object) {
  const span = drawnForceSpan(object);

  if (!span) {
    return null;
  }

  const style = object.style || {};
  const tip = headFor(style, "filled");

  return seg(span.start, span.end, styleOptions(style), tip ? `-${scaledTip(tip)}` : null);
}

/*
 * A RESULTANT IS THE STORED, CALCULATED ARROW. The analysis pass writes its
 * drawn span - the sum of the drawn source arrows - and its value separately,
 * so it is drawn exactly like a force.
 */
function resultantSpan(object) {
  return storedSpan(object.geometry || {});
}

/*
 * A DISTRIBUTED LOAD: the loaded span, one arrow per sample, the envelope and
 * the baseline. Arrow SPACING is the load's own interval (a display property);
 * arrow LENGTH is the intensity (the physical one), so respacing a load cannot
 * change how hard it presses.
 */
function loadProfileGeometry(geometry) {
  const samples = loadSamples(geometry);

  if (!samples.length) {
    return null;
  }

  const start = pointOf(geometry.start);
  const end = pointOf(geometry.end);

  return {
    samples,
    start,
    end,
    direction: vector(loadDirectionOf(geometry)),
    normal: bodyNormal(geometry),
    reversed: loadReversed(geometry),
  };
}

function serializeLoadArrows(entity, object) {
  const profile = loadProfileGeometry(object.geometry || {});

  if (!profile) {
    return null;
  }

  const { samples, start, end, direction, normal, reversed } = profile;
  const style = object.style || {};

  const arrowOptions = styleOptions(style);
  const tip = headFor(style, "filled");
  const arrow = tip ? (reversed ? `<${scaledTip(tip)}-` : `-${scaledTip(tip)}`) : null;

  const commands = [];

  /* The loaded span, as the baseline the load is applied along. */
  commands.push(seg(start, end, styleOptions({ ...style, lineType: style?.lineType || "solid" })));

  const bases = [];
  const farEnds = [];

  samples.forEach((sample) => {
    if (!(sample.magnitude > 0) || !validPoint(sample.base)) {
      return;
    }

    /*
     * THE ARROW STANDS ON THE LOADED SPAN. Its tail is the sample's own base
     * point and its length is the load's drawn height for this intensity -
     * the rule the canvas draws by (`loadArrowLength`).
     */
    const base = { x: Number(sample.base.x), y: Number(sample.base.y) };

    const reach = loadArrowLength(object.geometry || {}, sample.magnitude);

    const far = {
      x: base.x + direction.x * reach,
      y: base.y + direction.y * reach,
    };

    bases.push(base);
    farEnds.push(far);

    commands.push(seg(base, far, arrowOptions, arrow));
  });

  /*
   * THE ENVELOPE, closed back along the body. Constant intensities give the
   * rectangle a uniform load is drawn as; different ones give the taper of a
   * varying load. It is geometry, not a label, so it is always emitted.
   */
  if (farEnds.length > 1) {
    const outlineOptions = [
      ...splitOptions(styleOptions(style)).options,
      `fill=${colourOf(style, "stroke")}`,
      "fill opacity=0.12",
    ];

    commands.push(drawPath([...farEnds, ...bases.slice().reverse()], outlineOptions, { cycle: true }));
  }

  return commands.filter(Boolean).join("\n");
}

/*
 * A MOMENT: its curved arrow and its centre dot.
 *
 * THE RADIUS IS PRESENTATION. The drawn radius is a size the student chose (or
 * the shared default), never a function of the magnitude, so the symbol states
 * which way something turns rather than how hard.
 *
 * THE CURVE IS THE SAME 300-DEGREE ARC the canvas draws, placed on the
 * moment's own circle from its stored position and radius. An anticlockwise
 * moment opens on the right of the circle, so its head leaves travelling
 * upward; a clockwise one opens on the mirrored side. The angle written into
 * the source is the world angle of the arc, so the code and the picture cannot
 * be drawn at different attitudes.
 */
const MOMENT_SWEEP_DEGREES = 300;
const MOMENT_DEFAULT_RADIUS = 7;

function serializeMoment(entity, object) {
  const geometry = object.geometry || {};
  const centre = pointOf(geometry.position || geometry.start);

  const radius = finite(geometry.arcRadius) > 0 ? finite(geometry.arcRadius) : symbolSize(MOMENT_DEFAULT_RADIUS);
  const clockwise = String(geometry.direction) === "CW";

  /*
   * THE SAME OPENING AND SWEEP THE CANVAS DRAWS. The canvas opens a moment
   * 60 degrees above the +X axis (or its mirror for a clockwise moment) and
   * sweeps 300 degrees; anything else puts the head at a different place from
   * the picture even though both are "a 300-degree arc".
   */
  const MOMENT_OPENING_DEGREES = 60;
  const openingStart = clockwise ? -MOMENT_OPENING_DEGREES : MOMENT_OPENING_DEGREES;
  const openingEnd = clockwise ? openingStart - MOMENT_SWEEP_DEGREES : openingStart + MOMENT_SWEEP_DEGREES;

  const startAt = {
    x: centre.x + Math.cos((openingStart * Math.PI) / 180) * radius,
    y: centre.y + Math.sin((openingStart * Math.PI) / 180) * radius,
  };

  /*
   * THE HEAD LIES ALONG THE CURVE, not across it: a moment's head is tangent
   * to its own arc, and the head token on the arc ends it pointing along the
   * tangent already - which is why the arc is drawn in the sweep's direction
   * rather than reversed with a hand-placed marker.
   */
  const tip = headFor(object.style || {}, "filled");

  /*
   * THE HEAD IS AT THE END OF THE SWEEP FOR BOTH SENSES. The arc is already
   * drawn in the direction of rotation (decreasing angles for a clockwise
   * moment), so a head at its end points the way the moment turns. Putting a
   * clockwise moment's head at the START - as this used to - pointed it
   * against its own sweep, and every CW moment rendered as anticlockwise.
   */
  const arrow = `-${scaledTip(tip)}`;

  const options = withArrow(styleOptions(object.style), tip ? arrow : null);

  const arc = draws(
    options,
    `${point(startAt.x, startAt.y)} arc[start angle=${num(openingStart)}, end angle=${num(openingEnd)}, radius=${num(symbolSize(radius))}]`,
  );

  const centreMarkerOptions = [
    ...splitOptions(styleOptions(object.style)).options.filter(
      (option) => !option.startsWith("draw=") && !option.startsWith("fill="),
    ),
    "draw=none",
    `fill=${colourOf(object.style, "stroke")}`,
  ];

  const dotted = fills(centreMarkerOptions, `${point(centre.x, centre.y)} circle[radius=${num(symbolSize(0.6))}]`);

  return [arc, dotted].join("\n");
}

/* ============================================================
 * SUPPORTS
 * ============================================================
 *
 * Four visually distinct symbols, each in the FRAME its orientation gives:
 * every offset is measured along `out` (away from the body) and `across`
 * (along it), so a support on a sloping member turns with it rather than
 * hanging straight down. Orientation is stored in radians, which is what the
 * object model and the canvas both carry.
 */
const SUPPORT_SIZE = 4;
const SUPPORT_GROUND = 9;

function supportFrame(geometry) {
  const angle = finite(geometry.orientation);
  const out = { x: Math.cos(angle), y: Math.sin(angle) };
  const across = { x: -out.y, y: out.x };

  const anchor = pointOf(geometry.position);

  /*
   * A SYMBOL'S SIZE IS DRAWN SIZE, so every offset is reduced by the export
   * factor - at the ONE place the offset is applied, so the triangle, the
   * rollers, the wall and the hatching all shrink together and none of them is
   * reduced twice. The anchor itself is geometry, and `point` reduces it.
   */
  const factor = Number(currentExportTransform()?.factor);
  const drawn = Number.isFinite(factor) && factor > 0 ? factor : 1;

  return {
    anchor,
    out,
    across,
    at: (outward, sideways = 0) => ({
      x: anchor.x + (out.x * outward + across.x * sideways) * drawn,
      y: anchor.y + (out.y * outward + across.y * sideways) * drawn,
    }),
  };
}

function serializeSupport(entity, object) {
  const geometry = object.geometry || {};
  const frame = supportFrame(geometry);
  const options = styleOptions(object.style);

  const commands = [];

  /*
   * THE HATCHING KEEPS THE OBJECT'S OWN PEN.
   *
   * It used to append a literal `line width=0.35pt` to the object's options, so
   * every support command carried TWO widths:
   *
   *     \draw[draw=..., line width=0.28pt, line width=0.35pt] ...
   *
   * TeX silently used the last one, which meant the hatching and the triangle
   * were finely drawn at a weight the Features panel never showed. A command has
   * ONE width and it is the object's.
   */
  const hatchOptions = splitOptions(options).options;

  const hatched = (from, to) => commands.push(seg(from, to, hatchOptions));

  if (entity.type === "fixed-support") {
    /*
     * THE WALL, ACROSS THE MEMBER, WITH ITS HATCHING BEHIND IT. A member fixed
     * into a wall ends AT the wall, so the wall's line is drawn at the
     * attachment and the hatch strokes run away from the body.
     */
    const wall = 8;

    commands.push(seg(frame.at(0, -wall), frame.at(0, wall), options));

    for (let offset = -wall; offset <= wall; offset += 2.5) {
      hatched(frame.at(0, offset), frame.at(4, offset + 2.5));
    }

    return commands.join("\n");
  }

  if (entity.type === "smooth-support") {
    /* The rounded contact, its normal and the ground it rests on. */
    const centre = frame.at(2);

    commands.push(draws(options, `${point(centre.x, centre.y)} circle[radius=${num(symbolSize(2))}]`));
    hatched(frame.at(0), frame.at(8));
    hatched(frame.at(-1, -SUPPORT_GROUND / 2), frame.at(-1, SUPPORT_GROUND / 2));

    return commands.join("\n");
  }

  /* Pin and roller share the triangle; the roller adds its rollers and rail. */
  const apex = frame.at(-SUPPORT_SIZE);
  const base = frame.at(SUPPORT_SIZE);

  commands.push(
    drawPath(
      [
        apex,
        { x: base.x + frame.across.x * SUPPORT_SIZE, y: base.y + frame.across.y * SUPPORT_SIZE },
        { x: base.x - frame.across.x * SUPPORT_SIZE, y: base.y - frame.across.y * SUPPORT_SIZE },
      ],
      options,
      { cycle: true },
    ),
  );

  if (entity.type === "roller-support") {
    [-2.5, 2.5].forEach((offset) => {
      const wheel = frame.at(SUPPORT_SIZE + 1.5, offset);

      commands.push(draws(options, `${point(wheel.x, wheel.y)} circle[radius=${num(symbolSize(1.5))}]`));
    });

    hatched(frame.at(SUPPORT_SIZE + 3.5, -SUPPORT_GROUND / 2), frame.at(SUPPORT_SIZE + 3.5, SUPPORT_GROUND / 2));
  } else {
    hatched(frame.at(SUPPORT_SIZE, -SUPPORT_GROUND / 2), frame.at(SUPPORT_SIZE, SUPPORT_GROUND / 2));
  }

  return commands.join("\n");
}

/* ============================================================
 * CONNECTIONS
 * ============================================================
 *
 * Each connection is drawn at its stored anchor, in the attitude its own span
 * gives it, so a slider's slot lies along the member rather than always
 * horizontally.
 */
function connectionFrame(geometry) {
  const start = pointOf(geometry.start || geometry.position);
  const end = pointOf(geometry.end || geometry.start || geometry.position);

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);

  const along = length > 1e-9 ? { x: dx / length, y: dy / length } : { x: 1, y: 0 };
  const across = { x: -along.y, y: along.x };

  return {
    anchor: start,
    along,
    across,
    at: (forward, sideways = 0) => ({
      x: start.x + along.x * forward + across.x * sideways,
      y: start.y + along.y * forward + across.y * sideways,
    }),
  };
}

function serializeConnection(entity, object) {
  const frame = connectionFrame(object.geometry || {});
  const options = styleOptions(object.style);

  if (entity.type === "fixed-connection") {
    return drawPath([frame.at(-4, -4), frame.at(4, -4), frame.at(4, 4), frame.at(-4, 4)], options, { cycle: true });
  }

  if (entity.type === "slider-connection") {
    return [
      seg(frame.at(-8), frame.at(8), options),
      seg(frame.at(0, -5), frame.at(0, 5), options),
      drawPath([frame.at(-3, -2.5), frame.at(3, -2.5), frame.at(3, 2.5), frame.at(-3, 2.5)], options, { cycle: true }),
    ].join("\n");
  }

  /* A PIN, and the generic legacy connection, are a joint circle. */
  return draws(options, `${point(frame.anchor.x, frame.anchor.y)} circle[radius=${num(symbolSize(2))}]`);
}

/* ============================================================
 * ANALYSIS
 * ============================================================ */

function serializeResultant(entity, object) {
  const span = resultantSpan(object);

  if (!span) {
    return null;
  }

  const style = object.style || {};
  const tip = headFor(style, "filled");

  /*
   * THE DRAWN ARROW IS THE STORED, CALCULATED ONE. `start` and `end` are
   * written by the analysis dependency pass from the source forces, so the
   * code states the same result the canvas does - no component is recomputed
   * here.
   */
  return seg(span.start, span.end, styleOptions(style), tip ? `-${scaledTip(tip)}` : null);
}

/*
 * THE COMPONENTS OF A FORCE.
 *
 * The analysis pass stores each component as a `{start, end}` pair on the object
 * (`horizontal`, `vertical`, and optionally `original`). Some objects instead
 * carry the original force's own span - the factory still writes `start`/`end`
 * so a pair created before the analysis ran is still a real object - so that
 * pair is drawn as the ORIGINAL when no explicit one exists. Without it a
 * components object created but not yet analysed produced no commands at all,
 * and therefore no source region.
 */
function componentsOriginal(geometry) {
  if (geometry.original) {
    return geometry.original;
  }

  if (validPoint(geometry.start) && validPoint(geometry.end) && distance(geometry.start, geometry.end) > 1e-9) {
    return { start: geometry.start, end: geometry.end };
  }

  return null;
}

function serializeForceComponents(entity, object) {
  const geometry = object.geometry || {};
  const style = object.style || {};
  const options = styleOptions(style);
  const tip = headFor(style, "filled");
  const arrow = tip ? `-${scaledTip(tip)}` : null;

  const commands = [];

  const segment = (pair) => {
    if (!pair?.start || !pair?.end) {
      return null;
    }

    const from = pointOf(pair.start);
    const to = pointOf(pair.end);

    if (distance(from, to) < 1e-9) {
      return null;
    }

    return seg(from, to, options, arrow);
  };

  /*
   * THE ORIGINAL FORCE. Drawn when the analysis keeps it (`showOriginal`) and
   * always when there are no components to draw - an object with nothing on the
   * sheet is not an object the source can leave out.
   */
  const original = componentsOriginal(geometry);

  const hasComponents =
    (geometry.showX !== false && segment(geometry.horizontal)) ||
    (geometry.showY !== false && segment(geometry.vertical));

  if (original && (geometry.showOriginal === true || !hasComponents)) {
    commands.push(segment(original));
  }

  if (geometry.showX !== false) {
    commands.push(segment(geometry.horizontal));
  }

  if (geometry.showY !== false) {
    commands.push(segment(geometry.vertical));
  }

  /*
   * THE DASHED CLOSING LINE, so the picture reads as a decomposition rather
   * than three arrows that happen to share a start. Drawn only when both
   * components exist.
   */
  const endX = geometry.horizontal?.end ? pointOf(geometry.horizontal.end) : null;
  const endY = geometry.vertical?.end ? pointOf(geometry.vertical.end) : null;

  if (endX && endY && geometry.showX !== false && geometry.showY !== false) {
    commands.push(seg(endX, endY, styleOptions({ ...style, lineType: "dashed" })));
  }

  return commands.filter(Boolean).join("\n");
}

const DIAGRAM_AXES = {
  sfd: { y: "V", unit: "N" },
  bmd: { y: "M", unit: "N\\cdot m" },
  afd: { y: "N", unit: "N" },
};

/*
 * ============================================================
 * A SKETCH THAT BELONGS TO SOME OTHER OBJECT
 * ============================================================
 *
 * A Resultant and a Force Components object carry strokes of the student's own
 * vector diagram as `geometry.sketchElements`, in WORLD coordinates - the same
 * record shape an analysis diagram uses. The canvas draws them, so the source
 * must too: an object whose strokes are on the sheet and missing from the source
 * is exactly the "the sketch is gone" failure, and it is not specific to an SFD.
 *
 * The projection is the identity, because these points are already model-space.
 * `sketchStrokeCommands` writes each element through the object's own style, so
 * the strokes keep the colour, width and opacity of the object they belong to.
 */
export function objectSketchCommands(object) {
  const elements = object?.geometry?.sketchElements;

  if (!Array.isArray(elements) || !elements.length) {
    return [];
  }

  const options = splitOptions(styleOptions({ ...(object.style || {}), lineType: "solid" })).options;

  return sketchStrokeCommands(elements, {
    pointsOf: (element) => sketchPointsOf(element),
    toModel: (at) => ({ x: Number(at.x) || 0, y: Number(at.y) || 0 }),
    options,
  });
}

export function diagramKind(type, geometry) {
  const declared = String(geometry?.diagramType || "").toLowerCase();

  if (DIAGRAM_AXES[declared]) {
    return declared;
  }

  return (
    {
      "shear-force-diagram": "sfd",
      "bending-moment-diagram": "bmd",
      "axial-force-diagram": "afd",
    }[type] || "sfd"
  );
}

/*
 * HOW TALL ONE UNIT OF VALUE IS.
 *
 * The same mapping the canvas uses for that diagram: a set y-range widens the
 * frame, otherwise the largest value is fitted to 16% of the span's length.
 * Read anywhere else, the curve and the calculated values would quietly
 * disagree about where a number sits.
 */
function diagramValueScale(geometry, width) {
  if (!(width > 1e-9)) {
    return 0;
  }

  /*
   * THE DIAGRAM'S OWN STORED SCALE COMES FIRST.
   *
   * The Canvas fixes a sketch's units-per-value when the sketch is DRAWN, and
   * stores it on the geometry (`unitHeight` / `yRange`). Re-deriving it from the
   * strokes here fitted the scale to whatever had been sketched so far, so a
   * curve that was later shortened silently grew - the ink moved although the
   * student's values had not. The stored figure is the authoritative one; the
   * derivation below exists only for a diagram saved before it was stored.
   */
  const declared = Number(geometry.unitHeight);

  if (Number.isFinite(declared) && declared > 0) {
    return declared;
  }

  const set = geometry.yRange;
  const usable = set && finite(set.from) < finite(set.to);

  let peak = 0;

  const equations = enggDiagramEquations;

  if (geometry.mode === "plot" && equations) {
    peak = equations.peakMagnitude(equations.readPlot(geometry));
  } else {
    (Array.isArray(geometry.sketchElements) ? geometry.sketchElements : []).forEach((element) => {
      sketchPointsOf(element).forEach((at) => {
        if (Number.isFinite(at?.y)) {
          peak = Math.max(peak, Math.abs(at.y));
        }
      });
    });
  }

  const chosen = usable ? Math.max(Math.abs(finite(set.from)), Math.abs(finite(set.to)), peak) : peak;

  return chosen > 0 ? (width * 0.16) / chosen : 0;
}

function onDiagramAxis(geometry, unitHeight) {
  const start = pointOf(geometry.start);
  const end = pointOf(geometry.end);
  const range = geometry.localRange || { from: 0, to: 1 };
  const width = finite(range.to) - finite(range.from);

  return (x, value) => {
    const t = width > 1e-9 ? (finite(x) - finite(range.from)) / width : 0;

    return {
      x: start.x + (end.x - start.x) * t,
      y: start.y + finite(value) * unitHeight,
    };
  };
}

/*
 * THE POINTS A SKETCH ELEMENT IS DRAWN THROUGH.
 *
 * THIS IS THE CANVAS'S RULE, NOT A SECOND OPINION ABOUT IT. The sheet draws a
 * sketch with `sketchPointsOf` (analysis-render.js): a LINE through its two
 * ends, a THREE-POINT CURVE (the only curve the editor creates) through its
 * Start, Bend and End, and a legacy curve through as many points as were
 * clicked.
 *
 * THE RULE ITSELF NOW LIVES IN ONE PLACE. It was re-implemented here, and the
 * copy read `element.points` alone - which is what a `curve3` does not have. So
 * every curved stroke of a hand-drawn SFD, BMD or AFD was drawn on the canvas
 * and MISSING from the generated source. `sketchPointsOf` is re-exported from
 * `analysis-render.js` so the generator and the canvas cannot disagree again.
 */
export function sketchPointsOf(element) {
  return canvasSketchPointsOf(element);
}

/*
 * A DIAGRAM'S CURVE IS ITS OWN STORED RESULT.
 *
 * A Plot stores expressions and their ranges; those are evaluated with the
 * application's own equation engine and sampled exactly as the canvas samples
 * them. A Sketch stores its points. Nothing is fabricated: an empty plot
 * produces no curve rather than a demonstration one.
 */
export function diagramMarks(geometry) {
  const range = geometry.localRange;

  if (!range) {
    return { marks: [], unitHeight: 0 };
  }

  const width = finite(range.to) - finite(range.from);

  if (!(width > 0)) {
    return { marks: [], unitHeight: 0 };
  }

  const unitHeight = diagramValueScale(geometry, width);
  const place = onDiagramAxis(geometry, unitHeight);

  const equations = enggDiagramEquations;

  if (geometry.mode === "plot" && equations) {
    const entries = equations.readPlot(geometry);

    if (!entries.length) {
      return { marks: [], unitHeight };
    }

    const marks = equations.sampleExpressions(entries).map((mark) =>
      mark.kind === "verticalLine"
        ? { kind: "line", points: [place(mark.x, mark.from), place(mark.x, mark.to)] }
        : { kind: "curve", points: mark.points.map((at) => place(at.x, at.value)) },
    );

    return { marks, unitHeight };
  }

  const elements = Array.isArray(geometry.sketchElements) ? geometry.sketchElements : [];

  const marks = elements
    .map((element) => {
      const points = sketchPointsOf(element).map((at) => place(at.x, at.y));

      if (points.length < 2) {
        return null;
      }

      return { kind: element.kind === "line" ? "line" : "curve", points };
    })
    .filter(Boolean);

  return { marks, unitHeight };
}

function serializeDiagram(entity, object) {
  const geometry = object.geometry || {};

  /*
   * AN ORPHANED DIAGRAM DRAWS NOTHING, exactly as the canvas does: its source
   * body is gone, so there is no span to read the diagram against.
   */
  if (object.engineering?.unresolved === true) {
    return null;
  }

  const start = pointOf(geometry.start);
  const end = pointOf(geometry.end);

  if (distance(start, end) < 1e-9) {
    return null;
  }

  const style = object.style || {};

  const commands = [];

  /*
   * THE FRAME IS AS FAINT AS THE CANVAS DRAWS IT, AND NO FAINTER.
   *
   * The zero axis, the ordinate and the station ticks are reference marks: the
   * canvas paints them at `stroke-opacity` 0.55 / 0.4 (the ticks) so they stay
   * subordinate to the curve and to the beam above. That IS an intentional
   * translucency and it is preserved - what is NOT preserved is applying it to
   * a diagram whose object style is fully opaque everywhere else, which is what
   * an unconditional `draw opacity` did: the axis label text then disagreed
   * with the axis line it names.
   *
   * The values are the canvas's own (`draw-members.js`), restated here as
   * numbers so a diagram cannot be one translucency on screen and another in
   * TeX.
   */
  const FRAME_OPACITY = 0.55;
  const TICK_OPACITY = 0.4;

  const referenceOptions = (opacity, overrides = {}) =>
    withArrow(
      styleOptions(style, { overrides: { ...overrides, opacity: objectOpacityOf(style, opacity) } }),
      `-${scaledTip("{Latex}")}`,
    );

  /* The zero axis, with its head at the positive end. */
  if (geometry.showZeroAxis !== false) {
    const axisOptions = referenceOptions(FRAME_OPACITY);

    commands.push(seg(start, end, axisOptions));

    /* The ordinate, at the left-hand end of the drawn span. */
    const left = start.x <= end.x ? start : end;

    /*
     * THE CANVAS HAS NO ORDINATE LINE OF ITS OWN, so the source does not either.
     *
     * The axis it draws is the Y-ARROW at the left of the frame (drawn by the
     * canvas from `frame.top` to `frame.bottom`); this module writes it as the
     * short stub the source has always carried. Its length matches that stub
     * and it keeps the axis's opacity rather than the object's, so it reads as
     * part of the reference frame.
     */
    commands.push(
      seg(
        { x: left.x, y: start.y - symbolSize(12) },
        { x: left.x, y: start.y + symbolSize(12) },
        referenceOptions(FRAME_OPACITY, { lineWidth: "thin" }),
      ),
    );
  }

  /* The reference stations carried from the source body. */
  if (geometry.showReferencePositions !== false && Array.isArray(geometry.referencePositions)) {
    geometry.referencePositions.forEach((reference) => {
      if (!validPoint(reference?.position)) {
        return;
      }

      const at = pointOf(reference.position);

      commands.push(
        seg(
          { x: at.x, y: at.y - symbolSize(1.5) },
          { x: at.x, y: at.y + symbolSize(1.5) },
          styleOptions(
            {
              ...style,
              lineWidth: "very-thin",
              opacity: objectOpacityOf(style, TICK_OPACITY),
            },
          ),
        ),
      );
    });
  }

  /*
   * THE CURVE IS THE DIAGRAM'S OWN STORED RESULT, at the object's own pen.
   *
   * It used to append `line width=1.1pt` to an option list that already carried
   * the object's width, so every diagram command declared two widths - and TeX
   * used the second, which meant the plotted curve was drawn heavier than the
   * beam whose values it reports. The curve inherits the object's style and
   * nothing else; a diagram that should read heavier is a diagram whose
   * lineWidth is heavier, which the Features panel can already say.
   */
  const { marks } = diagramMarks(geometry);

  const curveOptions = splitOptions(styleOptions({ ...style, lineType: "solid" })).options;

  marks.forEach((mark) => {
    const path = drawPath(mark.points, curveOptions);

    if (path) {
      commands.push(path);
    }
  });

  /*
   * A PLOT-MODE DIAGRAM'S SKETCH IS STILL PART OF THE DRAWING.
   *
   * `diagramMarks` writes EITHER the sketch OR the plotted curve, because a
   * diagram has one mode at a time. But a diagram can still HOLD sketch strokes
   * (a student who sketched and then plotted; the Sketch Editor writes them and
   * does not clear the plot), and those strokes are geometry the model owns.
   * Writing them as well means the source never loses content the document still
   * has. An empty list writes nothing, so a pure plot is unaffected; a stroke
   * that the plot already draws identically is not repeated.
   */
  if (geometry.mode === "plot") {
    const written = new Set(commands.map((command) => command.trim()));

    objectSketchCommands(object).forEach((command) => {
      if (!written.has(command.trim())) {
        written.add(command.trim());
        commands.push(command);
      }
    });
  }

  return commands.join("\n");
}

/*
 * The opacity a reference mark is drawn at: its own, unless the object is
 * deliberately fainter still.
 */
function objectOpacityOf(style, referenceOpacity) {
  const declared = Number(style?.opacity);

  return Number.isFinite(declared) && declared > 0 && declared < 1
    ? Math.min(declared, referenceOpacity)
    : referenceOpacity;
}

/* ============================================================
 * REFERENCE TOOLS
 * ============================================================ */

export function referenceName(object) {
  return `ref${String(object.id || "point").replace(/[^A-Za-z0-9]/g, "")}`;
}

/*
 * A REFERENCE POINT.
 *
 * THE POSITION IS A POINT, NOT THE GEOMETRY OBJECT. The old fallback read
 * `geometry.position || geometry.point || geometry` - and `pointOf` turns any
 * object with finite `x`/`y` into a coordinate - so a geometry object without
 * a `position` was read as `(x: undefined, y: undefined)`, silently drawn at
 * the origin. Only real coordinates are accepted now; an object with none has
 * no source rather than a wrong one.
 */
function serializePoint(entity, object) {
  const geometry = object.geometry || {};

  const candidate = validPoint(geometry.position)
    ? geometry.position
    : validPoint(geometry.point)
      ? geometry.point
      : geometry;

  if (!validPoint(candidate)) {
    return null;
  }

  const position = pointOf(candidate);
  const style = object.style || {};
  const radius = symbolSize((finite(style.pointSize, 4) || 4) * 0.25);

  const markerOptions = [
    ...splitOptions(styleOptions(style)).options.filter(
      (option) => !option.startsWith("draw=") && !option.startsWith("fill="),
    ),
    "draw=none",
    `fill=${colourOf(style, "stroke")}`,
  ];

  return [
    fills(markerOptions, `${point(position.x, position.y)} circle[radius=${num(radius, 3)}]`),
    `\\coordinate (${referenceName(object)}) at ${point(position.x, position.y)};`,
  ].join("\n");
}

function serializeReferenceLine(entity, object) {
  const ends = memberEnds(object.geometry || {});

  if (!ends) {
    return null;
  }

  return seg(ends.start, ends.end, styleOptions(object.style));
}

function serializeReferenceArc(entity, object) {
  const geometry = object.geometry || {};
  const centre = pointOf(geometry.center);
  const radius = finite(geometry.radius);
  /* Stored in radians, as every arc is; TikZ takes degrees. */
  const startRadians = finite(geometry.startAngle);
  const endRadians = finite(geometry.endAngle);
  const startAngle = (startRadians * 180) / Math.PI;
  const endAngle = (endRadians * 180) / Math.PI;

  if (!(radius > 0) || startRadians === endRadians) {
    return null;
  }

  const startAt = {
    x: centre.x + Math.cos(startRadians) * radius,
    y: centre.y + Math.sin(startRadians) * radius,
  };

  return draws(
    styleOptions(object.style),
    `${point(startAt.x, startAt.y)} arc[start angle=${num(startAngle)}, end angle=${num(endAngle)}, radius=${num(symbolSize(radius))}]`,
  );
}

function serializeCoordinateSystem(entity, object) {
  const geometry = object.geometry || {};
  const origin = pointOf(geometry.origin);

  const arm = (value, fallback) => {
    const length = finite(value, fallback);

    return length > 0 ? length : fallback;
  };

  const fallback = arm(geometry.axisLength, 25);

  const xPositive = arm(geometry.xPositiveLength, fallback);
  const xNegative = arm(geometry.xNegativeLength, fallback);
  const yPositive = arm(geometry.yPositiveLength, fallback);
  const yNegative = arm(geometry.yNegativeLength, fallback);

  const showX = geometry.showXAxis !== false;
  const showY = geometry.showYAxis !== false;
  const showLabels = geometry.showLabels !== false;

  /*
   * THE ATTITUDE THE CROSS WAS DRAWN IN. The stored rotation (in radians)
   * turns BOTH arms by the same angle, so the Y axis stays square to the X
   * axis - a dragged X arm can never skew it.
   */
  const angle = finite(geometry.rotation);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const rotate = (dx, dy) => ({
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  });

  const options = [...splitOptions(styleOptions(object.style)).options, `-${scaledTip("{Latex}")}`];
  const colour = colourOf(object.style, "stroke");
  const commands = [];

  if (showX) {
    commands.push(seg(rotate(-xNegative, 0), rotate(xPositive, 0), options));
  }

  if (showY) {
    commands.push(seg(rotate(0, -yNegative), rotate(0, yPositive), options));
  }

  if (showLabels) {
    const xText = String(geometry.xLabel ?? "X");
    const yText = String(geometry.yLabel ?? "Y");
    const originText = String(geometry.originLabel ?? "O");

    if (showX && xText !== "") {
      const tip = rotate(xPositive, 0);

      commands.push(`\\node[anchor=west, text=${colour}] at ${point(tip.x + 2, tip.y)} {${texText(xText)}};`);
    }

    if (showY && yText !== "") {
      const tip = rotate(0, yPositive);

      commands.push(`\\node[anchor=south west, text=${colour}] at ${point(tip.x + 1, tip.y + 2)} {${texText(yText)}};`);
    }

    if (originText !== "") {
      commands.push(
        `\\node[anchor=north east, text=${colour}] at ${point(origin.x - 2, origin.y - 2)} {${texText(originText)}};`,
      );
    }
  }

  return commands.join("\n");
}

/* ============================================================
 * THE SERIALIZER TABLE
 * ============================================================ */
const SERIALIZERS = {
  particle: serializeParticle,
  "rigid-body": serializeRigidBody,
  beam: serializeBeam,
  truss: serializeTruss,
  cable: serializeCable,
  shaft: serializeShaft,

  force: serializePointForce,

  load: serializeLoadArrows,
  "varying-load": serializeLoadArrows,

  moment: serializeMoment,

  "pin-support": serializeSupport,
  "roller-support": serializeSupport,
  "fixed-support": serializeSupport,
  "smooth-support": serializeSupport,

  "pin-connection": serializeConnection,
  "fixed-connection": serializeConnection,
  "slider-connection": serializeConnection,
  connection: serializeConnection,

  resultant: serializeResultant,
  "force-components": serializeForceComponents,

  "analysis-diagram": serializeDiagram,
  "shear-force-diagram": serializeDiagram,
  "bending-moment-diagram": serializeDiagram,
  "axial-force-diagram": serializeDiagram,

  "coordinate-system-2d": serializeCoordinateSystem,
  "coordinate-system": serializeCoordinateSystem,

  point: serializePoint,
  line: serializeReferenceLine,
  arc: serializeReferenceArc,
};
export const STATICS_SOURCE_TYPES = Object.freeze(Object.keys(SERIALIZERS));

export function isStaticsSourceType(type) {
  return Object.prototype.hasOwnProperty.call(SERIALIZERS, type);
}

/*
 * ============================================================
 * ONE OBJECT
 * ============================================================
 *
 * The object's drawing commands followed by its text nodes - the order the
 * picture is read in and the order the canvas paints it. Returns null for a
 * type with no serializer, which the synchronization layer reads as "no
 * source for this object" and leaves its region alone.
 */
export function serializeStaticsObject(object, options = {}) {
  if (!object || typeof object !== "object") {
    return null;
  }

  /*
   * THE OBJECT IS SERIALIZED INSIDE ITS EXPORT TRANSFORM.
   *
   * `options.transform` is the drawing's export context (`export-transform.js`).
   * It is in effect for THIS object only: every coordinate the serializer writes
   * comes out normalized and every pen width and dash length reduced by the one
   * export factor, and no other object can inherit it. Without one the object is
   * written at its authored size, which is what a single-object preview and a
   * test want.
   */
  return withExportTransform(options.transform || null, () => serializeStaticsObjectAtScale(object, options));
}

function serializeStaticsObjectAtScale(object, options = {}) {
  const shape = SERIALIZERS[object.type];

  if (typeof shape !== "function") {
    return null;
  }

  const resolved = generationOptions(options.state || null, options);
  const entity = { ...object, __generationOptions: { ...resolved, exportTransform: options.transform || null } };

  let geometry;

  try {
    geometry = shape(entity, object);
  } catch (error) {
    /*
     * A serializer that throws writes NOTHING for this object, and says so.
     * It used to fall through with `geometry = null` and still emit the text
     * nodes - so a force whose arrow failed appeared in Source and on the sheet
     * as a floating "F" with no arrow, which is source that does not describe
     * the object and a picture that does not show it.
     */
    reportSourceGenerationProblem(object, `its ${object.type} drawing failed (${error && error.message})`);

    return null;
  }

  if (typeof geometry !== "string" || geometry.trim() === "") {
    /*
     * NO GEOMETRY, NO OBJECT. Text nodes alone are not this object - they are
     * its annotations - so an object whose shape could not be drawn from its
     * stored geometry contributes nothing rather than a label in empty space.
     */
    reportSourceGenerationProblem(object, `its stored geometry does not describe a drawable ${object.type}`);

    return null;
  }

  /*
   * A DIAGRAM'S VALUE ANNOTATIONS SIT ON ITS OWN SCALE. The unit height the
   * curve was drawn with is handed to the node generator, so a calculated
   * value is printed where it was drawn rather than at an unrelated place.
   */
  if (object.type === "analysis-diagram" || object.type.startsWith("shear-force") || object.type.startsWith("bending-moment") || object.type.startsWith("axial-force")) {
    const range = object.geometry?.localRange;

    if (range) {
      entity.__generationOptions = {
        ...resolved,
        diagramUnitHeight: diagramValueScale(object.geometry, finite(range.to) - finite(range.from)),
        diagramKind: diagramKind(object.type, object.geometry),
      };
    }
  }

  const nodes = generateStaticsTextNodes(entity);

  /*
   * THE OBJECT'S OWN SKETCH STROKES, AFTER ITS SHAPE.
   *
   * A Resultant or a Force Components object can carry the student's vector
   * diagram (see `objectSketchCommands`). They are ordinary drawing content, so
   * they are written with the object they belong to - never dropped because they
   * are not the type's main shape.
   */
  const sketches = objectSketchCommands(object).join("\n");

  const parts = [geometry, sketches, nodes].filter(
    (part) => typeof part === "string" && part.trim() !== "",
  );

  if (!parts.length) {
    return null;
  }

  const combined = parts.join("\n");

  /*
   * AN OBJECT THAT CANNOT COMPILE WRITES NOTHING, and says why.
   *
   * A TeX compile is all-or-nothing: ONE bad character in ONE label stops the
   * whole document, so a single broken Statics object used to blank EVERY
   * object on the sheet. That is the worst possible failure - the student sees
   * their drawing vanish and nothing tells them which object caused it.
   *
   * The generated text is therefore balanced before it is handed back. A
   * command with an unbalanced brace or bracket, or a raw escape sequence that
   * was never decoded into a character, would not compile, so this object
   * contributes no code - the others still draw, and the failure is reported
   * once, with the object's id, rather than as a silent blank sheet.
   */
  const problem = texProblem(combined);

  if (problem) {
    reportSourceGenerationProblem(object, problem);

    return null;
  }

  clearSourceGenerationProblem(object.id);

  return defineOncePerObject(combined);
}

/*
 * THE CHEAP CHECKS THAT DECIDE WHETHER TEQ WILL ACCEPT THIS FRAGMENT.
 *
 * Deliberately conservative: this reports only things that ALWAYS fail to
 * compile, never a stylistic opinion. A false positive would drop an object
 * that would have drawn, so the checks are narrow.
 */
function texProblem(text) {
  const value = String(text ?? "");

  let braces = 0;
  let brackets = 0;
  let math = 0;

  for (const character of value) {
    if (character === "{") {
      braces += 1;
    } else if (character === "}") {
      braces -= 1;
    } else if (character === "[") {
      brackets += 1;
    } else if (character === "]") {
      brackets -= 1;
    } else if (character === "$") {
      math += 1;
    }

    if (braces < 0 || brackets < 0) {
      return "unbalanced braces or brackets";
    }
  }

  if (braces !== 0) {
    return `${braces} unclosed brace${braces === 1 ? "" : "s"}`;
  }

  if (brackets !== 0) {
    return `${brackets} unclosed bracket${brackets === 1 ? "" : "s"}`;
  }

  if (math % 2 !== 0) {
    return "an unclosed math delimiter";
  }

  /*
   * A LITERAL ESCAPE THAT WAS NEVER DECODED. `\u00B7` inside a label is not a
   * TeX command and stops the engine; it is always a bug in the DATA, and it
   * is always visible as this exact five-character shape. `\\u` is what a real
   * TeX command would look like, so only the single-backslash form is refused.
   */
  if (/(^|[^\\])\\u[0-9a-fA-F]{4}/.test(value)) {
    return "an undecoded unicode escape in a label";
  }

  const outside = mathCommandOutsideMath(value);

  if (outside) {
    return `\\${outside} outside maths mode`;
  }

  return null;
}

/*
 * A MATHS-ONLY COMMAND IN TEXT MODE. `\cdot` in a label outside `$...$` is a
 * hard TeX error, and like every TeX error it stops the whole document - which
 * is exactly how one diagram's axis unit blanked every Statics object on a
 * sheet. Only commands that are NEVER valid in text are listed, so an ordinary
 * text command can never be mistaken for one.
 */
const MATH_ONLY_COMMANDS = new Set([
  "cdot", "times", "frac", "tfrac", "dfrac", "mathrm", "mathbf", "sqrt",
  "alpha", "beta", "gamma", "delta", "Delta", "theta", "omega", "Omega",
  "sigma", "tau", "mu", "pi", "phi", "leq", "geq", "approx", "pm"
]);

function mathCommandOutsideMath(text) {
  let inMath = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (character !== "\\") {
      if (character === "$") {
        inMath = !inMath;
      }

      continue;
    }

    const name = /^[A-Za-z]+/.exec(text.slice(index + 1));

    if (!name) {
      /* `\$`, `\\` and friends: skip the escaped character. */
      index += 1;
      continue;
    }

    if (!inMath && MATH_ONLY_COMMANDS.has(name[0])) {
      return name[0];
    }

    index += name[0].length;
  }

  return null;
}

/* ============================================================
 * TEXT NODES
 * ============================================================
 *
 * Only where the object's own drawing calls for text: a force's label and
 * value, a load's label and intensities, a moment's label and value, the
 * analysis annotations, and the coordinate system's axis names. A particle, a
 * member, a support, a connection or a reference object gets none unless the
 * student asked for one through Features (the `label` field).
 */
export function generateStaticsTextNodes(object) {
  return staticsTextNodes(object);
}

/* ============================================================
 * A SET OF OBJECTS
 * ============================================================ */
export function generateStaticsTikz(objects, options = {}) {
  const list = (Array.isArray(objects) ? objects : []).filter(Boolean);

  return list
    .map((object) => {
      const source = serializeStaticsObject(object, options);

      return source
        ? [
            `% DAETUM_OBJECT_BEGIN id="${object.id}" type="${object.type}"`,
            source,
            `% DAETUM_OBJECT_END id="${object.id}"`,
          ].join("\n")
        : null;
    })
    .filter(Boolean)
    .join("\n");
}

/*
 * ============================================================
 * SOURCE MAP
 * ============================================================
 *
 * The commands of one object mapped to that object's STABLE id. The identity
 * comes from the object, and the region is the marked block that id wrote - so
 * a multi-command object (a shaft, a truss, a diagram) maps every one of its
 * commands to the one object that owns them.
 */
export function generateStaticsTikzWithSourceMap(objects, options = {}) {
  const list = (Array.isArray(objects) ? objects : []).filter(Boolean);

  const source = generateStaticsTikz(list, options);
  const lines = source.split("\n");

  const entries = list
    .map((object) => {
      const region = sourceMapFor(lines, object.id);

      return region ? { id: object.id, type: object.type, ...region } : null;
    })
    .filter(Boolean);

  const blocks = list
    .map((object) => {
      const commands = serializeStaticsObject(object, options);

      return commands ? { id: object.id, type: object.type, source: commands } : null;
    })
    .filter(Boolean);

  return {
    source,
    blocks,
    entries,
    map: {
      ids: () => entries.map((entry) => entry.id),
      entry: (id) => entries.find((entry) => entry.id === id) || null,
      region: (id) => entries.find((entry) => entry.id === id) || null,
      all: () => [...entries],
    },
  };
}

/* ============================================================
 * STANDALONE EXPORT
 * ============================================================
 *
 * The drawing source packaged as a complete document for Overleaf or any
 * LaTeX installation. The picture is unchanged - only the preamble the
 * renderer needs is added, so the exported drawing is the drawing on screen.
 */
export const STATIC_STANDALONE_LIBRARIES = Object.freeze([
  "arrows.meta",
  "calc",
  "decorations.pathmorphing",
]);

/*
 * THE COLOUR DEFINITIONS A PICTURE USES, as preamble lines.
 *
 * Read from the picture itself, so the export can never declare a colour the
 * drawing does not use, and can never omit one it does. A name defined twice
 * resolves to one line - the picture's own spelling wins, because that is what
 * its commands refer to.
 */
export function colourDefinitionsIn(source) {
  const definitions = new Map();

  String(source ?? "")
    .split("\n")
    .forEach((line) => {
      const match = line.match(/^\s*\\definecolor\{([^}]+)\}\{([^}]+)\}\{([^}]+)\}/);

      if (match) {
        definitions.set(match[1], { model: match[2], value: match[3] });
      }
    });

  return [...definitions].map(([name, { model, value }]) => `\\definecolor{${name}}{${model}}{${value}}`);
}

export function wrapAsStandaloneTex(documentSource, requirements = {}) {
  const libraries = [...new Set([...(requirements.libraries || STATIC_STANDALONE_LIBRARIES)])];

  /*
   * EVERY COLOUR DEFINITION MOVES INTO THE PREAMBLE, ONCE.
   *
   * The picture defines a colour inline in front of the command that uses it,
   * which is valid TikZ and keeps the Source tab self-contained. A preamble
   * that repeated those definitions would define each colour twice - so the
   * inline lines are LIFTED to the preamble and removed from the body. The
   * drawing is unchanged; only where its colours are declared changes.
   */
  const colours = [...new Set([...(requirements.colours || []), ...colourDefinitionsIn(documentSource)])];

  const picture = String(documentSource ?? "")
    .split("\n")
    .filter((line) => !/^[ \t]*\\definecolor\{/.test(line))
    .join("\n")
    .trim();

  const packages = [...new Set(requirements.packages || ["tikz", "amsmath", "amssymb", "xcolor"])];

  return [
    "\\documentclass[tikz, border=5mm]{standalone}",
    "\\usepackage[T1]{fontenc}",
    ...packages.map((name) => `\\usepackage{${name}}`),
    `\\usetikzlibrary{${libraries.join(",")}}`,
    ...colours,
    "",
    "\\begin{document}",
    "",
    picture,
    "",
    "\\end{document}",
    "",
  ].join("\n");
}

/* ============================================================
 * THE WRITER REGISTERED WITH THE SOURCE PIPELINE
 * ============================================================
 *
 * `geometrySourceWriter`'s twin: given an object, the commands for it, or null
 * when this module does not write that type. The synchronization layer asks
 * each writer in turn, so the two never fight over an object.
 */
/*
 * ============================================================
 * WHICH WRITER OWNS AN OBJECT
 * ============================================================
 *
 * `point`, `line` and `arc` are produced by Geometry tools AND by the Statics
 * Reference tools, and the two write them with different conventions. The
 * object itself says which is which:
 *
 *   - a Reference tool records its statics role in `engineering.staticsType`
 *     (`reference-point`, `reference-line`, `reference-arc`);
 *   - a Geometry tool records `engineering.discipline`, which is not `statics`.
 *
 * So a geometry-shaped object belongs here only when it says it came from a
 * Statics tool. Everything else - Point, Line, Arc from Geometry - is declined
 * and left to the Geometry writer. This is what stops a Geometry Point at
 * (30,40) being serialised, by the Statics writer, as a reference marker at
 * (0,0): the fallback used `geometry.position || geometry.point || geometry`
 * and read the whole geometry object as a coordinate.
 */
export function isStaticsObject(object) {
  if (!object || !isStaticsSourceType(object.type)) {
    return false;
  }

  if (object.type !== "point" && object.type !== "line" && object.type !== "arc") {
    return true;
  }

  const engineering = object.engineering || {};

  return engineering.discipline === "statics" || typeof engineering.staticsType === "string";
}

/*
 * The synchronization layer hands every writer the sheet (`context.state`). It
 * is passed on, so a Statics object is written against the same sheet settings
 * the rest of the drawing is - not against defaults because the writer dropped
 * its second argument.
 */
export function staticsSourceWriter(object, context = {}) {
  if (!isStaticsObject(object)) {
    return null;
  }

  /*
   * THE SHEET'S EXPORT TRANSFORM REACHES THE SERIALIZERS.
   *
   * The draft is passed on, not dropped: the sync layer fitted the WHOLE drawing
   * (`exportTransformFor`), and every object must be drawn through that one
   * factor so the beam, its supports and the graph above it stay in proportion.
   */
  return serializeStaticsObject(object, {
    state: context.state || null,
    transform: context.transform || null,
    allObjects: context.allObjects || null,
  });
}

export function writtenStaticsTypes() {
  return Object.keys(SERIALIZERS);
}

export default {
  STATICS_SOURCE_TYPES,
  STATIC_STANDALONE_LIBRARIES,
  isStaticsSourceType,
  serializeStaticsObject,
  generateStaticsTextNodes,
  generateStaticsTikz,
  generateStaticsTikzWithSourceMap,
  generationOptions,
  wrapAsStandaloneTex,
  colourDefinitionsIn,
  staticsSourceWriter,
  writtenStaticsTypes,
  trussMembers,
  trussJoints,
  diagramMarks,
  referenceName,
  splitOptions,
};
