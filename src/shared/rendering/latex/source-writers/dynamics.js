/*
 * ============================================================
 * DYNAMICS SOURCE WRITER
 * ============================================================
 *
 * Turns a stored Dynamics symbol into the TikZ that draws it - the twin of
 * `statics.js`, and installed in the same list (`source-writers/index.js`).
 *
 * THE SOURCE IS WRITTEN FROM THE MODEL, NEVER FROM A PICTURE, and every
 * command below is built from the SAME geometry the canvas renderer reads:
 * the two terminals of a spring, the centre and radius of a pulley, the arc
 * of a rotation symbol. So an object that is dragged, resized or rotated
 * writes different code that describes what is now on the sheet, and an
 * object that is not changed writes the same code it did before.
 *
 * THE VOCABULARY IS THE SHARED ONE. Colours, stroke styles, arrow heads,
 * text escaping and the source-map markers all come from `statics-primitives`
 * - the same helpers Statics and Geometry use - so a Dynamics spring and a
 * Statics beam cannot end up spelling the same stroke two different ways, and
 * nothing new has to be compiled: only `\draw`, `\fill` and `\node`, which
 * DAETUM's preamble already loads (tikz, arrows.meta, amsmath, xcolor).
 *
 * ONE OBJECT, ONE REGION. Every symbol is a single block under one object id,
 * however many primitives it contains, so the source map points every one of
 * its commands at the one object that owns them - and deleting the object
 * removes the whole block.
 *
 * WHAT IT DOES NOT DO. No physical value is computed: a label is the text the
 * student typed, and nothing about stiffness, damping, velocity or tension is
 * derived and written into the drawing.
 */

import {
  arrowHeadTip,
  colourOf,
  num,
  point,
  sourceMapFor,
  splitPrelude,
  styleOptions,
  texText
} from "./statics-primitives.js";
import enggFeatureGeometry from "../../../geometry/feature-geometry.js";
import { applyObjectComments, ensureObjectId, objectDisplayName } from "../object-comments.js";
import { renderObjectBlock } from "../drawing-source.js";

/* ============================================================
 * HELPERS
 * ============================================================ */

function finite(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
}

function pt(candidate) {
  return {
    x: finite(candidate?.x),
    y: finite(candidate?.y)
  };
}

function hasPoint(candidate) {
  return Boolean(
    candidate &&
      Number.isFinite(Number(candidate.x)) &&
      Number.isFinite(Number(candidate.y)),
  );
}

/*
 * One `\draw` through a list of points.
 *
 * `arrow` is a HEAD KIND (`"filled"`, `"open"`, `"bar"`) - the same word the
 * Features panel stores - and it is written as `-{Latex}` IN THE OPTION LIST,
 * which is the one form DAETUM's own Statics source uses and the one the
 * bundled engine accepts. A head written along the path (`-- (b) -{Latex}`)
 * is a parse error in this engine: "Cannot parse this coordinate".
 */
function path(points, options, { cycle = false, arrow = null } = {}) {
  if (!Array.isArray(points) || points.length < 2) {
    return null;
  }

  /*
   * THE HEAD IS AN OPTION (`->`), NOT A TIP SPLICED INTO THE PATH.
   *
   * `-- -{Latex} (x,y)` is not a straight segment with an arrow: `--` has
   * already committed to a plain line, and the next token is read as a
   * coordinate - so the engine stops with "Cannot parse this coordinate" and
   * NOTHING on the sheet compiles. Arrow tips are a path-level option in TikZ's
   * own syntax, and that is the form every other DAETUM writer uses.
   */
  const tip = arrow ? `-${arrowHeadTip(arrow)}` : "";

  const body = points
    .map((at, index) => (index === 0 ? point(at.x, at.y) : `-- ${point(at.x, at.y)}`))
    .join(" ");

  const withHead = tip ? [...options, tip] : options;

  return command("draw", withHead, `${body}${cycle ? " -- cycle" : ""}`);
}

/*
 * ONE COMMAND AT A TIME, AND EACH ONE SELF-CONTAINED.
 *
 * Every command that uses a hex colour carries its own `\definecolor`, so a
 * single command can be copied out of the Source tab and pasted into a
 * document on its own. TeX accepts the repeated definition, and the logging
 * in a TikZJax compile WRITES to the directory the compiler runs in - so a
 * second definition per command would be several extra files per symbol.
 * Each DRaw therefore defines each colour exactly once.
 */
function command(operator, options, body) {
  const split = splitPrelude(options);
  const bracket = split.options.length ? `[${split.options.join(", ")}]` : "";

  return [...new Set(split.definitions), `\\${operator}${bracket} ${body};`].join("\n");
}

function colourName(style) {
  return colourOf(style || {}, "stroke") || "black";
}

/* A label node, placed at a world point with the feature's own colour. */
function label(text, at, style, anchor = "south west") {
  const value = String(text ?? "").trim();

  if (!value || !at) {
    return "";
  }

  return `\\node[anchor=${anchor}, text=${colourName(style)}, font=\\fontsize{4.2}{5.0}\\selectfont] at ${point(at.x + 1.2, at.y + 1.2)} {${texText(value)}};`;
}

/* A point on the span, `fraction` of the way from `a` to `b`. */
function along(a, b, fraction) {
  return {
    x: a.x + (b.x - a.x) * fraction,
    y: a.y + (b.y - a.y) * fraction,
  };
}

/* A point `distance` from `a` along the unit normal of a-b. */
function offsetFrom(a, b, distance) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;

  return {
    x: a.x - (dy / length) * distance,
    y: a.y + (dx / length) * distance,
  };
}

/* ============================================================
 * THE SERIALIZERS
 * ============================================================
 *
 * Each takes the object and returns its commands, or null when the stored
 * geometry cannot describe a drawable symbol (which the caller reports as a
 * generation problem rather than writing a guess).
 */

function serializeParticle(object) {
  const position = pt(object.geometry?.position);

  if (!hasPoint(object.geometry?.position)) {
    return null;
  }

  const radius = Math.max(0.5, finite(object.geometry?.markerRadius, 1.6) / 2);
  const style = object.style || {};

  /*
   * A FILLED MARKER IS ONE `\fill`, in the feature's own colour. The colour
   * options are taken from the shared style builder rather than written
   * here, so the marker's ink is defined exactly the way every other
   * symbol's is - and a marker copied out of the Source on its own compiles.
   */
  const options = styleOptions(style);

  if (style.fillOpacityEnabled !== false) {
    options.push("fill opacity=0.35");
  }

  return command(
    "fill",
    options,
    `${point(position.x, position.y)} circle[radius=${num(radius)}]`,
  );
}

function rigidBodyCorners(geometry) {
  const shape = enggFeatureGeometry.rigidBodyShape(geometry);

  if (shape === "circle") {
    return null;
  }

  return enggFeatureGeometry.definingPoints(geometry, "rigid-body");
}

function serializeRigidBody(object) {
  const geometry = object.geometry || {};
  const options = styleOptions(object.style || {});

  if (!hasPoint(geometry.position)) {
    return null;
  }

  if (object.style?.fillMode === "solid" && object.style?.fillOpacityEnabled === true) {
    options.push("fill opacity=0.35");
  }

  if (String(geometry.shape || "rectangle").toLowerCase() === "circle") {
    return command(
      "draw",
      options,
      `${point(finite(geometry.center?.x), finite(geometry.center?.y))} circle[radius=${num(finite(geometry.radius))}]`,
    );
  }

  const outline = rigidBodyCorners(geometry);

  if (!outline) {
    return null;
  }

  const body = path(outline, options, { cycle: true });

  if (geometry.showCenterOfMass === false) {
    return body;
  }

  /*
   * The centre of mass, drawn as the conventional quartered disc. It is a
   * MARK, not a calculated property: its position is the centre of the shape
   * the student drew.
   */
  const centre = enggFeatureGeometry.rigidBodyCenter(geometry);

  if (!centre) {
    return body;
  }

  const mark = [
    command(
      "fill",
      [`fill=${colourName(object.style)}`],
      `${point(centre.x, centre.y)} circle[radius=0.9]`,
    ),
    command(
      "draw",
      [`draw=${colourName(object.style)}`],
      `${point(centre.x, centre.y)} circle[radius=1.8]`,
    ),
  ].join("\n");

  return `${body}\n${mark}`;
}

function serializePolarVector(object) {
  const geometry = object.geometry || {};

  if (!hasPoint(geometry.start) || !hasPoint(geometry.end)) {
    return null;
  }

  const a = pt(geometry.start);
  const b = pt(geometry.end);

  const line = path([a, b], styleOptions(object.style || {}), {
    arrow: object.style?.arrowEnd || "filled"
  });

  if (geometry.showAngle !== true) {
    return line;
  }

  const degrees = Math.round(
    finite(geometry.angleValue, (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI),
  );

  return `${line}\n${label(`${degrees}`, { x: a.x + 2, y: a.y - 2 }, object.style)}`;
}

function serializeAngularVector(object) {
  const geometry = object.geometry || {};

  if (!hasPoint(geometry.center) || !(finite(geometry.radius) > 0)) {
    return null;
  }

  const centre = pt(geometry.center);
  const radius = finite(geometry.radius);
  const sweep = Math.abs(finite(geometry.sweep, 270));
  const clockwise = String(geometry.direction || "ccw").toLowerCase() === "cw";
  const start = finite(geometry.startAngle);

  /*
   * THE ARC RUNS FROM WHERE IT STARTS TO WHERE THE SWEEP ENDS, and TikZ places
   * an arc on the circle from `start angle` to `end angle`. It is one path
   * operation; the coordinate before `arc` would be read as the end of a
   * segment and the keyword after it would fail.
   */
  const from = start;
  const to = start + (clockwise ? -sweep : sweep);

  const arc =
    `${point(
      centre.x + radius * Math.cos((from * Math.PI) / 180),
      centre.y + radius * Math.sin((from * Math.PI) / 180),
    )} arc[start angle=${num(from)}, end angle=${num(to)}, radius=${num(radius)}]`;

  /*
   * A HEADED ARC USES THE `->` OPTION FORM, not a tip spliced into the path.
   *
   * An `arc[...]` operation cannot carry a head on the segment that ends it
   * when the head is written inline - the engine rejects the coordinate - so
   * the head is stated as an option on the same `\draw`, which is the form
   * the rest of DAETUM's source uses. `->` always points from the start of
   * the path to its end, so a CLOCKWISE sweep is written with the head kind
   * reversed by drawing the same arc from its end: the head then travels the
   * way the student drew it.
   */
  const head = geometry.arrowHead || object.style?.arrowEnd || "filled";
  const headTip = arrowHeadTip(head);
  const options = styleOptions(object.style || {});

  return command(
    "draw",
    headTip ? [...options, `-${headTip}`] : options,
    arc,
  );
}


/* The zigzag between two points, as a list of drawing points. */
function springPoints(a, b, geometry, offset = 0) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);

  if (length < 1e-9) {
    return null;
  }

  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;

  const coils = Math.max(1, Math.round(finite(geometry.coils, 6)));
  const amplitude = finite(geometry.amplitude, 4);
  const lead = Math.max(0, Math.min(0.4, finite(geometry.lead, 0.18)));

  const startLead = { x: a.x + nx * offset, y: a.y + ny * offset };
  const endLead = { x: b.x + nx * offset, y: b.y + ny * offset };

  const bodyFrom = length * lead;
  const bodyTo = length - length * lead;
  const step = (bodyTo - bodyFrom) / (coils * 2);

  const at = (distance, side) => ({
    x: startLead.x + ux * distance + nx * side,
    y: startLead.y + uy * distance + ny * side,
  });

  const points = [startLead, at(bodyFrom, 0)];

  for (let index = 1; index <= coils * 2; index += 1) {
    points.push(at(bodyFrom + step * index, index % 2 === 1 ? amplitude : -amplitude));
  }

  points.push(endLead);

  return points;
}

function serializeSpring(object) {
  const geometry = object.geometry || {};

  if (!hasPoint(geometry.start) || !hasPoint(geometry.end)) {
    return null;
  }

  const points = springPoints(pt(geometry.start), pt(geometry.end), geometry);

  return path(points, styleOptions(object.style || {}));
}

/* The cylinder and rod of a damper, as draws. */
function damperCommands(a, b, geometry, options, offset = 0) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);

  if (length < 1e-9) {
    return null;
  }

  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;

  const from = finite(geometry.bodyFrom, 0.42);
  const to = Math.max(from + 0.05, finite(geometry.bodyTo, 0.82));
  const width = Math.max(0.5, finite(geometry.bodyWidth, 6));

  const at = (fraction, side = 0) => ({
    x: a.x + dx * fraction + nx * (offset + side),
    y: a.y + dy * fraction + ny * (offset + side),
  });

  const cylinder = [at(from), at(to), at(to, width), at(from, width)];

  return [
    path(cylinder, options, { cycle: true }),
    path([at(0), at(0.86)], options),
    path([at(0.94), at(1)], options),
    path([at(to), at(to, width)], options),
  ]
    .filter(Boolean)
    .join("\n");
}

function serializeDamper(object) {
  const geometry = object.geometry || {};

  if (!hasPoint(geometry.start) || !hasPoint(geometry.end)) {
    return null;
  }

  const options = styleOptions(object.style || {});

  return damperCommands(pt(geometry.start), pt(geometry.end), geometry, options);
}

function serializeSpringDamper(object) {
  const geometry = object.geometry || {};

  if (!hasPoint(geometry.start) || !hasPoint(geometry.end)) {
    return null;
  }

  const a = pt(geometry.start);
  const b = pt(geometry.end);
  const spacing = finite(geometry.branchSpacing, 7);
  const options = styleOptions(object.style || {});

  const springBranch = path(springPoints(a, b, geometry, spacing), options);

  /*
   * The damper branch sits on the other side, with its body width halved so
   * the two branches read as a pair rather than as two full-size symbols
   * piled together.
   */
  const damperBranch = damperCommands(
    a,
    b,
    {
      ...geometry,
      bodyWidth: finite(geometry.bodyWidth, 6) / 1.6,
    },
    options,
    -spacing,
  );

  return [springBranch, damperBranch].filter(Boolean).join("\n");
}

function serializePulley(object) {
  const geometry = object.geometry || {};

  if (!hasPoint(geometry.center) || !(finite(geometry.radius) > 0)) {
    return null;
  }

  const centre = pt(geometry.center);
  const radius = finite(geometry.radius);
  const gap = Math.max(radius, finite(geometry.ropeGap, radius * 2));
  /* The hang is measured from the hub, so it clears the rim by construction. */
  const drop = Math.max(radius * 3, finite(geometry.ropeDrop, radius * 3));
  const hang = (finite(geometry.ropeAngle) * Math.PI) / 180;

  const halfGap = gap / 2;
  const shoulder = Math.sqrt(Math.max(0, radius * radius - halfGap * halfGap));

  const left = { x: centre.x - halfGap, y: centre.y - shoulder };
  const right = { x: centre.x + halfGap, y: centre.y - shoulder };

  const hangVector = {
    x: Math.sin(hang) * drop,
    y: -Math.cos(hang) * drop,
  };

  /*
   * THE CORD IS TWO RUNS AND THE WRAP OVER THE WHEEL. The wrap is an arc on
   * the wheel's own circle, so it follows the rim at any radius - a straight
   * line across the top would cut the wheel in half.
   */
  const wrapStart = (Math.atan2(-shoulder, -halfGap) * 180) / Math.PI;
  const wrapEnd = (Math.atan2(-shoulder, halfGap) * 180) / Math.PI;

  const rope = [
    path(
      [{ x: left.x + hangVector.x, y: left.y + hangVector.y }, left],
      styleOptions(object.style || {}),
    ),
    command(
      "draw",
      styleOptions(object.style || {}),
      `${point(left.x, left.y)} arc[start angle=${num(wrapStart)}, end angle=${num(wrapEnd)}, radius=${num(radius)}]`,
    ),
    path(
      [right, { x: right.x + hangVector.x, y: right.y + hangVector.y }],
      styleOptions(object.style || {}),
    ),
  ]
    .filter(Boolean)
    .join("\n");

  const wheel = command(
    "draw",
    styleOptions(object.style || {}),
    `${point(centre.x, centre.y)} circle[radius=${num(radius)}]`,
  );

  const axle =
    geometry.showAxle === false
      ? ""
      : command(
          "fill",
          [`fill=${colourName(object.style)}`],
          `${point(centre.x, centre.y)} circle[radius=0.6]`,
        );

  return [rope, wheel, axle].filter(Boolean).join("\n");
}

function serializeCoordinateSystem(object) {
  const geometry = object.geometry || {};

  if (!hasPoint(geometry.origin)) {
    return null;
  }

  const origin = pt(geometry.origin);
  const rotation = finite(geometry.rotation) * (180 / Math.PI);
  const options = styleOptions(object.style || {});

  const positiveX = finite(geometry.xPositiveLength, 25);
  const negativeX = finite(geometry.xNegativeLength, 25);
  const positiveY = finite(geometry.yPositiveLength, 25);
  const negativeY = finite(geometry.yNegativeLength, 25);

  const radians = (rotation * Math.PI) / 180;

  const arm = (length, degrees) => {
    const angle = radians + (degrees * Math.PI) / 180;

    return {
      x: origin.x + Math.cos(angle) * length,
      y: origin.y + Math.sin(angle) * length,
    };
  };

  /*
   * THE TIP IS PASSED AS THE HEAD KIND, and `path` turns it into the arrow
   * option. Handing it the LaTeX token instead made the option list read
   * `{Latex}`, which pgf rejects as a key nobody declared.
   */
  const tip = object.style?.arrowEnd || "filled";

  const xPositive = arm(positiveX, 0);
  const xNegative = arm(negativeX, 180);
  const yPositive = arm(positiveY, 90);
  const yNegative = arm(negativeY, -90);

  const xLabel = typeof geometry.xLabel === "string" ? geometry.xLabel : "x";
  const yLabel = typeof geometry.yLabel === "string" ? geometry.yLabel : "y";

  return [
    path([xNegative, origin], options),
    path([origin, xPositive], options, { arrow: tip }),
    path([yNegative, origin], options),
    path([origin, yPositive], options, { arrow: tip }),
    command("fill", [`fill=${colourName(object.style)}`], `${point(origin.x, origin.y)} circle[radius=0.5]`),
    label(xLabel, xPositive, object.style, "north west"),
    label(yLabel, yPositive, object.style, "south east"),
  ]
    .filter(Boolean)
    .join("\n");
}

function serializeReferencePoint(object) {
  const geometry = object.geometry || {};

  if (!hasPoint(geometry.position)) {
    return null;
  }

  const at = pt(geometry.position);
  const arm = 0.9;

  return [
    command("draw", styleOptions(object.style || {}), `${point(at.x - arm, at.y)} -- ${point(at.x + arm, at.y)}`),
    command("draw", styleOptions(object.style || {}), `${point(at.x, at.y - arm)} -- ${point(at.x, at.y + arm)}`),
  ].join("\n");
}

function serializeReferenceLine(object) {
  const geometry = object.geometry || {};

  if (!hasPoint(geometry.start) || !hasPoint(geometry.end)) {
    return null;
  }

  return path([pt(geometry.start), pt(geometry.end)], styleOptions(object.style || {}));
}

function serializeReferenceArc(object) {
  const geometry = object.geometry || {};

  if (!hasPoint(geometry.center) || !(finite(geometry.radius) > 0)) {
    return null;
  }

  const centre = pt(geometry.center);
  const radius = finite(geometry.radius);

  /* - it is the editor's own arc, and
   * everything that edits it (the Features panel, the angle handles) speaks
   * radians. TikZ wants degrees, so the conversion happens here, at the one
   * boundary where the two vocabularies meet.
   */
  const start = (finite(geometry.startAngle) * 180) / Math.PI;
  const end = (finite(geometry.endAngle) * 180) / Math.PI;

  return command(
    "draw",
    styleOptions(object.style || {}),
    `${point(
      centre.x + radius * Math.cos(finite(geometry.startAngle)),
      centre.y + radius * Math.sin(finite(geometry.startAngle)),
    )} arc[start angle=${num(start)}, end angle=${num(end)}, radius=${num(radius)}]`,
  );
}

/* ============================================================
 * THE TABLE AND THE WRITER
 * ============================================================ */

const SERIALIZERS = {
  "dynamics-particle": serializeParticle,
  "dynamics-rigid-body": serializeRigidBody,
  "dynamics-polar-vector": serializePolarVector,
  "dynamics-angular-vector": serializeAngularVector,
  "dynamics-spring": serializeSpring,
  "dynamics-damper": serializeDamper,
  "dynamics-spring-damper": serializeSpringDamper,
  "dynamics-pulley": serializePulley,
  "dynamics-coordinate-system": serializeCoordinateSystem,
  "dynamics-reference-point": serializeReferencePoint,
  "dynamics-reference-line": serializeReferenceLine,
  "dynamics-reference-arc": serializeReferenceArc,
};

const SECONDARY_LABELS = {
  "dynamics-spring-damper": "labels",
};

/* A student's label, at the symbol's own anchor. */
function labelFor(object) {
  const text = typeof object.label === "string" ? object.label.trim() : "";

  if (!text) {
    return "";
  }

  const geometry = object.geometry || {};
  const anchor =
    geometry.center ||
    geometry.origin ||
    (geometry.start && geometry.end ? along(pt(geometry.start), pt(geometry.end), 0.5) : null) ||
    geometry.position;

  return label(text, anchor, object.style);
}

/* The two labels a spring-damper carries, each on its own branch. */
function secondaryLabels(object) {
  const key = SECONDARY_LABELS[object.type];

  if (!key || !object[ key ]) {
    return "";
  }

  const geometry = object.geometry || {};

  if (!hasPoint(geometry.start) || !hasPoint(geometry.end)) {
    return "";
  }

  const a = pt(geometry.start);
  const b = pt(geometry.end);
  const spacing = finite(geometry.branchSpacing, 7);

  const springAt = offsetFrom(a, b, spacing);
  const damperAt = offsetFrom(a, b, -spacing);

  return [
    label(object[key].spring, along(springAt, offsetFrom(b, a, spacing), 0.5), object.style),
    label(object[key].damper, along(damperAt, offsetFrom(b, a, -spacing), 0.5), object.style),
  ]
    .filter(Boolean)
    .join("\n");
}

/*
 * The synchronization layer's entry point. It answers ONLY for an object a
 * Dynamics tool made: everything else is declined with `null`, which hands
 * the object to the writer that knows it.
 */
export function dynamicsSourceWriter(object) {
  if (!object || typeof object !== "object") {
    return null;
  }

  const kind = object.engineering?.dynamicsType;

  if (typeof kind !== "string" || !SERIALIZERS[kind]) {
    return null;
  }

  const commands = SERIALIZERS[kind](object);

  if (typeof commands !== "string" || commands.trim() === "") {
    return null;
  }

  const body = [commands, labelFor(object), secondaryLabels(object)]
    .filter((part) => typeof part === "string" && part.trim() !== "")
    .join("\n");

  const id = ensureObjectId(object, object.type);

  return applyObjectComments({ ...object, id }, body, { type: object.type });
}

/* Every Dynamics type this writer answers for. */
export function writtenDynamicsTypes() {
  return Object.keys(SERIALIZERS);
}

/* The whole sheet's Dynamics source, with the same markers Statics writes. */
export function generateDynamicsTikz(objects) {
  return (Array.isArray(objects) ? objects : [])
    .filter(Boolean)
    .map((object) => {
      const source = dynamicsSourceWriter(object);
      const id = ensureObjectId(object, object.type);

      return source
        ? source.includes("% DAETUM ID:")
          ? source
          : renderObjectBlock({
              id,
              type: object.type,
              name: objectDisplayName(object, { type: object.type }),
              source,
            })
        : null;
    })
    .filter(Boolean)
    .join("\n\n");
}

export function generateDynamicsTikzWithSourceMap(objects) {
  const list = (Array.isArray(objects) ? objects : []).filter(Boolean);
  const source = generateDynamicsTikz(list);
  const lines = source.split("\n");

  const entries = list
    .map((object) => {
      const region = sourceMapFor(lines, object.id);

      return region ? { id: object.id, type: object.type, ...region } : null;
    })
    .filter(Boolean);

  return { source, entries };
}

export default {
  dynamicsSourceWriter,
  writtenDynamicsTypes,
  generateDynamicsTikz,
  generateDynamicsTikzWithSourceMap
};
