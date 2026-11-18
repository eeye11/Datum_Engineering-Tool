/*
 * ============================================================
 * TIKZ SOURCE -> THE ONE GEOMETRY MODEL
 * ============================================================
 *
 * The other direction of the synchronisation. A student edits the source, and
 * the drawing must follow - not by re-rendering the text, but by turning the
 * supported constructs back into the SAME document the canvas draws.
 *
 * WHAT IS SUPPORTED, AND WHAT IS NOT
 * ----------------------------------
 * Supported: `\draw` paths (lines, polylines, polygons, cubic Beziers, circles,
 * ellipses, rectangles, arcs), their style options (thickness, colour, dash,
 * fill), and `\definecolor`. That is the set the generator emits, so a
 * round trip is lossless for everything DAETUM can draw.
 *
 * Anything else - a `\node`, a `\fill`, a macro, a `\foreach` - is REPORTED as
 * unsupported rather than guessed at. A parser that silently dropped what it
 * did not understand would let a student's edit vanish while the interface said
 * it had been applied, which is the one outcome the task forbids.
 *
 * ERRORS ARE DATA. `parseSource` never throws: it returns the geometry it could
 * read, the problems it found with their line numbers, and whether the result
 * is safe to apply. The caller keeps the last valid drawing when it is not.
 */

import {
  LINE_STYLES,
  THICKNESSES,
  normaliseColour,
  normaliseAppearance,
} from "./sketch-appearance.js";
import { makeGeometry } from "./sketch-document.js";

/* The sampled outline of a circle, in model coordinates. */
function circleOutline(centre, radius, count = 64) {
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;

    return {
      x: centre.x + radius * Math.cos(angle),
      y: centre.y + radius * Math.sin(angle),
    };
  });
}

/* The sampled outline of an axis-aligned ellipse. */
function ellipseOutline(centre, radiusX, radiusY, count = 64) {
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;

    return {
      x: centre.x + radiusX * Math.cos(angle),
      y: centre.y + radiusY * Math.sin(angle),
    };
  });
}

/* The sampled points of an arc, in its own direction. */
function arcOutline(centre, radius, startAngle, endAngle, count = 32) {
  let from = startAngle;
  let to = endAngle;

  if (to < from) {
    while (to < from) to += Math.PI * 2;
  }

  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = from + ((to - from) * index) / count;

    return {
      x: centre.x + radius * Math.cos(angle),
      y: centre.y + radius * Math.sin(angle),
    };
  });
}

/* A number, or null. */
function number(text) {
  const value = Number(text);

  return Number.isFinite(value) ? value : null;
}



/* Every `(x,y)` in a string, in order. */
function parseCoords(text) {
  const list = [];
  const pattern = /\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g;

  let match = pattern.exec(text);

  while (match) {
    list.push({ x: Number(match[1]), y: Number(match[2]) });
    match = pattern.exec(text);
  }

  return list;
}

/* The `[...]` options of a command, as a list of strings. */
function parseOptions(text) {
  const match = String(text).match(/^\s*\[([^\]]*)\]/);

  if (!match) {
    return { options: [], rest: String(text) };
  }

  const options = match[1]
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return { options, rest: String(text).slice(match[0].length) };
}

/* The colour names the file defines, so a name can be turned back into a hex. */
function parseColours(source) {
  const colours = new Map();
  const pattern = /\\definecolor\{([^}]+)\}\{HTML\}\{([0-9A-Fa-f]{6})\}/g;

  let match = pattern.exec(source);

  while (match) {
    colours.set(match[1], `#${match[2].toLowerCase()}`);
    match = pattern.exec(source);
  }

  return colours;
}

/* A colour option value -> hex, or null for "the default". */
function colourOf(value, colours) {
  const text = String(value || "").trim();

  if (!text || text === "black") {
    return null;
  }

  if (colours.has(text)) {
    return colours.get(text);
  }

  return normaliseColour(text);
}

/* The appearance an option list describes. */
function appearanceOf(options, colours) {
  const appearance = {};

  options.forEach((option) => {
    const [rawKey, rawValue] = option.split("=").map((part) => part.trim());
    const key = rawKey.toLowerCase();

    if (key === "draw") {
      const colour = colourOf(rawValue, colours);

      if (colour) {
        appearance.colour = colour;
        appearance.isDefaultColour = false;
      }
    }

    if (key === "fill") {
      const colour = colourOf(rawValue, colours);

      appearance.fillEnabled = true;
      appearance.fill = colour || "#999999";
    }

    if (key === "fill opacity") {
      appearance.fillOpacity = number(rawValue) ?? 1;
    }

    if (key === "line width") {
      const points = number(String(rawValue).replace(/pt$/, ""));

      if (points !== null) {
        appearance.thickness = THICKNESSES.reduce((best, entry) =>
          Math.abs(entry.value - points) < Math.abs(best.value - points)
            ? entry
            : best,
        ).id;
      }
    }

    if (key === "line cap") {
      appearance.lineCap = rawValue;
    }

    if (key === "line join") {
      appearance.lineJoin = rawValue;
    }

    /* A named thickness, or a named dash pattern. */
    const thickness = THICKNESSES.find((entry) => entry.tikz === key);

    if (thickness) {
      appearance.thickness = thickness.id;
    }

    const style = Object.entries(LINE_STYLES).find(
      ([, entry]) => entry.tikz === key,
    );

    if (style) {
      appearance.lineStyle = style[0];
    }
  });

  return normaliseAppearance(appearance);
}

/* ============================================================
 * ONE COMMAND
 * ============================================================ */

/*
 * A `\draw` command -> a geometry element, or a problem.
 *
 * The order of the tests matters: a circle is a path with a `circle` keyword, a
 * rectangle is a path with `rectangle`, and a Bezier is a path with `controls`.
 * Testing the keywords before the point count is what keeps a two-point circle
 * from being read as a line.
 */
function parseDraw(command, colours, index) {
  const { options, rest } = parseOptions(command);

  const appearance = appearanceOf(options, colours);

  const body = rest.replace(/;\s*$/, "").trim();

  const circle = body.match(
    /^\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)\s*circle\s*\[\s*radius\s*=\s*(-?[\d.]+)\s*\]/,
  );

  if (circle) {
    const centre = { x: Number(circle[1]), y: Number(circle[2]) };
    const radius = Number(circle[3]);

    return {
      element: makeGeometry({
        kind: "circle",
        name: `C${index}`,
        centre,
        radius,
        /* The circumference, so the model's own points agree with the maths. */
        points: circleOutline(centre, radius),
        appearance,
      }),
    };
  }

  const ellipse = body.match(
    /^\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)\s*ellipse\s*\[\s*x radius\s*=\s*(-?[\d.]+)\s*,\s*y radius\s*=\s*(-?[\d.]+)\s*(?:,\s*rotate\s*=\s*(-?[\d.]+))?\s*\]/,
  );

  if (ellipse) {
    const centre = { x: Number(ellipse[1]), y: Number(ellipse[2]) };
    const radiusX = Number(ellipse[3]);
    const radiusY = Number(ellipse[4]);

    return {
      element: makeGeometry({
        kind: "ellipse",
        name: `E${index}`,
        centre,
        radiusX,
        radiusY,
        rotation: ellipse[5] ? (Number(ellipse[5]) * Math.PI) / 180 : 0,
        points: ellipseOutline(centre, radiusX, radiusY),
        appearance,
      }),
    };
  }

  const rectangle = body.match(
    /^\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)\s*rectangle\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/,
  );

  if (rectangle) {
    const x1 = Number(rectangle[1]);
    const y1 = Number(rectangle[2]);
    const x2 = Number(rectangle[3]);
    const y2 = Number(rectangle[4]);

    const corner = { x: Math.min(x1, x2), y: Math.min(y1, y2) };
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);

    return {
      element: makeGeometry({
        kind: "rectangle",
        name: `R${index}`,
        corner,
        width,
        height,
        /*
         * THE RECTANGLE'S OWN CORNERS ARE PART OF THE MODEL - a point can be
         * placed on an edge and a bounds calculation must see all four - so the
         * path is stored beside the parameters rather than derived by each
         * reader.
         */
        points: [
          corner,
          { x: corner.x + width, y: corner.y },
          { x: corner.x + width, y: corner.y + height },
          { x: corner.x, y: corner.y + height },
        ],
        closed: true,
        appearance,
      }),
    };
  }

  const arc = body.match(
    /^\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)\s*arc\s*\[\s*start angle\s*=\s*(-?[\d.]+)\s*,\s*end angle\s*=\s*(-?[\d.]+)\s*,\s*radius\s*=\s*(-?[\d.]+)\s*\]\s*(?:\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\))?/,
  );

  if (arc) {
    const startAngle = (Number(arc[3]) * Math.PI) / 180;
    const endAngle = (Number(arc[4]) * Math.PI) / 180;
    const radius = Number(arc[5]);

    /* The centre is the start point walked back along the start radius. */
    const centre = {
      x: Number(arc[1]) - radius * Math.cos(startAngle),
      y: Number(arc[2]) - radius * Math.sin(startAngle),
    };

    /*
     * THE WRITTEN END POINT IS THE ONE THE GENERATOR WROTE, so it is the one
     * the model keeps. Recomputing it from the rounded angles lands a thousandth
     * away and makes a round trip produce different source; the sampled outline
     * therefore uses the angles, which are the arc's mathematics, and the end
     * coordinate only when the source gave one.
     */
    const outline = arcOutline(centre, radius, startAngle, endAngle);

    if (arc[6] !== undefined && arc[7] !== undefined) {
      outline[outline.length - 1] = { x: Number(arc[6]), y: Number(arc[7]) };
    }

    return {
      element: makeGeometry({
        kind: "arc",
        name: `A${index}`,
        centre,
        radius,
        /*
         * THE ANGLES ARE THE ARC'S MATHEMATICS; `rotation` used to carry the
         * start angle, which made the shape's rotation and its extent the same
         * field and lost the end angle entirely. Both angles are now stored as
         * what they are, and the points are sampled from them.
         */
        startAngle,
        endAngle,
        clockwise: endAngle < startAngle,
        appearance,
        points: outline,
        closed: false,
      }),
    };
  }

  if (/\bcontrols\b/.test(body)) {
    /*
     * CHAINED BEZIERS SHARE THEIR JOINING POINT.
     *
     * Segments read `A .. controls ..B.. C .. controls ..D.. E`, so the `E` of
     * one segment is the `A` of the next. A single greedy global match consumes
     * that shared point and skips the following segment - which is how a
     * three-segment curve came back as two. Each match therefore restarts at
     * the shared coordinate rather than after it.
     */
    const segments = [];

    let cursor = 0;
    let match;

    do {
      const pattern =
        /\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)\s*\.\.\s*controls\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)\s*and\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)\s*\.\.\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g;

      pattern.lastIndex = cursor;
      match = pattern.exec(body);

      if (match) {
        segments.push({
          from: { x: Number(match[1]), y: Number(match[2]) },
          control1: { x: Number(match[3]), y: Number(match[4]) },
          control2: { x: Number(match[5]), y: Number(match[6]) },
          to: { x: Number(match[7]), y: Number(match[8]) },
        });

        /*
         * RESUME AT THE SHARED POINT, not after it. The next segment begins
         * with the coordinate this one ended on, so the scan restarts at the
         * `(` that opens it - which is the last `(` in this match.
         */
        const shared = match[0].lastIndexOf("(");

        cursor = match.index + shared;
      }
    } while (match);

    if (!segments.length) {
      return { problem: "A curve with controls could not be read." };
    }

    return {
      element: makeGeometry({
        kind: "curve",
        name: `K${index}`,
        points: [segments[0].from, ...segments.map((segment) => segment.to)],
        segments,
        closed: /--\s*cycle/.test(body),
        appearance,
      }),
    };
  }

  const points = parseCoords(body);

  /*
   * A PATH MUST HAVE COORDINATES, AND EVERY `--` MUST JOIN TWO OF THEM.
   * `\draw (0,0) -- ;` is a typo, and reading it as a one-point line would
   * report success for source that cannot possibly be the drawing.
   */
  if (!points.length) {
    return { problem: "A \\draw command has no coordinates." };
  }

  /* `-- cycle` closes a path and is not a separator with a missing point. */
  const withoutCycle = body.replace(/--\s*cycle/g, "");

  const separators = (withoutCycle.match(/--/g) || []).length;

  if (separators > points.length - 1) {
    return { problem: "A path has a `--` with no coordinate after it." };
  }

  if (/--\s*$/.test(withoutCycle)) {
    return { problem: "A path ends with `--` and no coordinate." };
  }

  const closed = /--\s*cycle/.test(body);

  return {
    element: makeGeometry({
      kind: closed ? "polygon" : points.length === 2 ? "line" : "polyline",
      name: `L${index}`,
      points,
      closed,
      appearance,
    }),
  };
}

/* ============================================================
 * THE WHOLE SOURCE
 * ============================================================ */

/*
 * Parse a sketch's TikZ.
 *
 * Returns `{ geometry, problems, ok }`. `ok` is false when anything could not
 * be read, and the caller must then keep the drawing it already has - a partial
 * parse applied over a good drawing is how a student loses work to a typo.
 */
export function parseSource(source) {
  const text = String(source ?? "");

  const problems = [];

  if (!/\\begin\{tikzpicture\}/.test(text)) {
    return {
      geometry: [],
      problems: [{ line: 1, message: "No \\begin{tikzpicture} found." }],
      ok: false,
    };
  }

  if (!/\\end\{tikzpicture\}/.test(text)) {
    return {
      geometry: [],
      problems: [
        {
          line: 1,
          message: "The picture is not closed with \\end{tikzpicture}.",
        },
      ],
      ok: false,
    };
  }

  const colours = parseColours(text);

  const geometry = [];

  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("%")) {
      return;
    }

    if (
      /^\\(definecolor|tikzset|usetikzlibrary|usepackage|begin|end)\b/.test(
        trimmed,
      )
    ) {
      return;
    }

    if (/^\\draw\b/.test(trimmed)) {
      const command = trimmed.replace(/^\\draw/, "");

      const parsed = parseDraw(command, colours, geometry.length + 1);

      if (parsed.problem) {
        problems.push({ line: index + 1, message: parsed.problem });
        return;
      }

      geometry.push(parsed.element);
      return;
    }

    /*
     * ANYTHING ELSE IS REPORTED, NOT IGNORED. A `\node`, a `\fill` or a macro is
     * a construct this parser does not model, and pretending it was applied
     * would be the silent loss the task forbids.
     */
    problems.push({
      line: index + 1,
      message: `Unsupported command: ${trimmed.split(/\s/)[0]}`,
    });
  });

  return { geometry, problems, ok: problems.length === 0 };
}

/*
 * Reconcile a parsed source with the document it came from.
 *
 * The geometry is replaced wholesale, because the source IS the geometry once
 * the student has edited it - but the document's own settings (grid, bounds,
 * default appearance, transform) are kept, since the source does not carry
 * them. That is the update rule: the source owns geometry, the document owns
 * the view.
 */
export function applyParsedSource(document, parsed) {
  if (!parsed?.ok) {
    return { document, applied: false, problems: parsed?.problems || [] };
  }

  return {
    document: {
      ...document,
      geometry: parsed.geometry,
      revision: (Number(document.revision) || 0) + 1,
    },
    applied: true,
    problems: [],
  };
}

export default {
  parseSource,
  applyParsedSource,
};
