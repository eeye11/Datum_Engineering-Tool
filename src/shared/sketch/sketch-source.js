/*
 * ============================================================
 * SKETCH -> TIKZ SOURCE, FROM THE ONE MODEL
 * ============================================================
 *
 * This module reads the SAME document the canvas draws. There is no second
 * geometry model for the source, no "export path" that re-derives coordinates,
 * and no place where a pixel value could get in: every number here comes from
 * model-space geometry the student can see in the editor.
 *
 * That is the requirement in its strongest form - the source must recreate what
 * DAETUM actually draws, and DAETUM must not display geometry its source cannot
 * reproduce. It is met by construction rather than by care: if a property is
 * not in the document, it is not in the source, and if it IS in the document
 * then both the canvas and this file read the same field.
 *
 * WHAT IS EMITTED, IN WHAT ORDER
 * ------------------------------
 *
 *   1. the document's own preamble - `\begin{tikzpicture}`, transforms
 *   2. optional coordinate geometry: axes, ticks, grid, when the student has
 *      asked for them to be part of the drawing
 *   3. the geometry, element by element, in document order
 *
 * EDITING AIDS ARE NEVER EMITTED. Anchor markers, guide markers, control
 * handles, selection outlines and the correction preview are things the editor
 * draws; they are not the student's geometry. Points, labels and axes are
 * emitted only when explicitly included, which is what
 * `includeInSource(element)` answers per element.
 *
 * STYLE
 * -----
 * A colour is a name plus a definition, so the output compiles with plain TikZ
 * and the colour a student picked is exactly the colour in the PDF. Thickness
 * and line style come from the same tables the canvas uses, so the two cannot
 * disagree.
 */

import {
  LINE_STYLES,
  THICKNESSES,
  thicknessOf,
  normaliseAppearance,
  supportsFill,
  isClosed,
} from "./sketch-appearance.js";
import {
  formatTick,
  gridValues,
  minorSpacing,
  normaliseGrid,
} from "./sketch-grid.js";
import { adapterFor } from "./sketch-geometry-adapters.js";

/* How many decimals a coordinate is written with. */
const COORD_DECIMALS = 3;

/* A model number, as TikZ syntax. */
function num(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "0";
  }

  const rounded = Number(number.toFixed(COORD_DECIMALS));

  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/* `(x,y)` as TikZ writes a coordinate. */
function coord(point) {
  return `(${num(point?.x)},${num(point?.y)})`;
}

/*
 * A COLOUR NAME FOR A HEX VALUE.
 *
 * TikZ has no hex syntax in its core colour set, so each colour the student
 * picks becomes a named colour defined at the top of the file. The name is
 * derived from the hex value, so the same colour used twice is defined once.
 */
export function colourName(hex) {
  return `sketch${String(hex || "#000000")
    .replace("#", "")
    .toLowerCase()}`;
}

/*
 * THE TRANSFORM.
 *
 * Placement translates (and optionally rotates and scales) the whole sketch. It
 * is applied ONCE, around the drawing, rather than being baked into every
 * coordinate - so the numbers in the source are the student's own model
 * coordinates, and the placement is visible and editable as what it is.
 */
function transformOf(document) {
  const transform = document.transform || {};

  const x = Number(transform.x) || 0;
  const y = Number(transform.y) || 0;
  const rotation = Number(transform.rotation) || 0;
  const scale = Number(transform.scale) || 1;

  return { x, y, rotation, scale };
}

/*
 * THE PLACEMENT, AS A SCOPE OPTION.
 *
 * TikZ applies these in order, so rotate and scale happen about the ORIGIN and
 * the shift then moves the whole sketch - which is exactly what placing it at a
 * point means.
 */
function transformCommand(transform) {
  const parts = [];

  if (transform.rotation) {
    parts.push(`rotate=${num(transform.rotation)}`);
  }

  if (transform.scale !== 1) {
    parts.push(`scale=${num(transform.scale)}`);
  }

  if (transform.x || transform.y) {
    parts.push(`shift={${coord({ x: transform.x, y: transform.y })}}`);
  }

  return parts.length ? `[${parts.join(", ")}]` : "";
}

/* ============================================================
 * ONE ELEMENT
 * ============================================================ */

/*
 * A geometry's path, in TikZ.
 *
 * Every kind is expressed with standard TikZ: a curve is a chain of cubic
 * `.. controls ..` segments through its own points, a circle is a circle, an
 * arc is an arc. Nothing here needs a DAETUM macro, which is what makes the
 * output portable.
 */
export function pathOf(element) {
  const kind = String(element?.kind || element?.type || "curve");

  if (kind === "circle" && element.centre && element.radius !== null) {
    return {
      shape: "circle",
      centre: element.centre,
      radius: element.radius,
    };
  }

  if (kind === "ellipse" && element.centre) {
    return {
      shape: "ellipse",
      centre: element.centre,
      radiusX: element.radiusX ?? 1,
      radiusY: element.radiusY ?? 1,
      rotation: element.rotation || 0,
    };
  }

  if (kind === "arc" && element.centre) {
    return { shape: "arc", adapter: adapterFor(element) };
  }

  if (kind === "rectangle" && element.corner) {
    return {
      shape: "rectangle",
      from: element.corner,
      to: {
        x: element.corner.x + (element.width || 0),
        y: element.corner.y + (element.height || 0),
      },
    };
  }

  /* A polyline, a polygon, a line or a curve is a path of points. */
  const points = element?.points || [];

  if (element?.segments?.length && kind === "curve") {
    return {
      shape: "bezier",
      segments: element.segments,
      closed: Boolean(element.closed),
    };
  }

  return {
    shape: "polyline",
    points,
    closed: isClosed(element) || kind === "polygon",
  };
}

/*
 * The style string for an element: thickness, colour, dash, and fill when the
 * student asked for one on something that has an inside.
 */
export function styleOf(element) {
  const appearance = normaliseAppearance(element?.appearance);
  const thickness = thicknessOf(appearance.thickness);

  const parts = [];

  parts.push(thickness.tikz);

  if (appearance.isDefaultColour || !appearance.colour) {
    parts.push("draw=black");
  } else {
    parts.push(`draw=${colourName(appearance.colour)}`);
  }

  const lineStyle = LINE_STYLES[appearance.lineStyle] || LINE_STYLES.solid;

  if (appearance.lineStyle !== "solid" && lineStyle.tikz) {
    parts.push(lineStyle.tikz);
  }

  if (appearance.fillEnabled && supportsFill(element)) {
    parts.push(
      appearance.fill ? `fill=${colourName(appearance.fill)}` : "fill",
    );
    parts.push(`fill opacity=${num(appearance.fillOpacity)}`);
  }

  parts.push(`line cap=${appearance.lineCap}`);
  parts.push(`line join=${appearance.lineJoin}`);

  return `[${parts.join(", ")}]`;
}

/* One element's TikZ, as a complete command. */
export function elementSource(element, options = {}) {
  const path = pathOf(element);
  const style = styleOf(element);

  if (!element.visible) {
    return null;
  }

  if (path.shape === "circle") {
    return `\\draw${style} ${coord(path.centre)} circle[radius=${num(path.radius)}]${nodeSuffix(options, element)};`;
  }

  if (path.shape === "ellipse") {
    const rotate = path.rotation
      ? `, rotate=${num((path.rotation * 180) / Math.PI)}`
      : "";

    return `\\draw${style} ${coord(path.centre)} ellipse[x radius=${num(path.radiusX)}, y radius=${num(path.radiusY)}${rotate}]${nodeSuffix(options, element)};`;
  }

  if (path.shape === "rectangle") {
    return `\\draw${style} ${coord(path.from)} rectangle ${coord(path.to)}${nodeSuffix(options, element)};`;
  }

  if (path.shape === "arc") {
    const adapter = path.adapter;

    /*
     * THE ARC'S OWN END POINTS, NOT ONES DERIVED FROM ITS ANGLES.
     *
     * The angles are written rounded to three decimals, so recomputing the end
     * from them lands a thousandth away from the point the geometry actually
     * has - and a round trip then produces different source. The stored points
     * are the truth, so they are what is written.
     */
    const start = element.points?.[0] || adapter.pointAt(0);
    const end = element.points?.[element.points.length - 1] || adapter.pointAt(1);

    return `\\draw${style} ${coord(start)} arc[start angle=${num((adapter.startAngle * 180) / Math.PI)}, end angle=${num((adapter.endAngle * 180) / Math.PI)}, radius=${num(adapter.radius)}]${coord(end)}${nodeSuffix(options, element)};`;
  }

  if (path.shape === "bezier") {
    const segments = path.segments;

    if (!segments.length) {
      return `\\draw${style} ${coord(element.points[0] || { x: 0, y: 0 })};`;
    }

    const body = segments
      .map(
        (segment) =>
          `.. controls ${coord(segment.control1)} and ${coord(segment.control2)} .. ${coord(segment.to)}`,
      )
      .join(" ");

    return `\\draw${style} ${coord(segments[0].from)} ${body}${path.closed ? " -- cycle" : ""}${nodeSuffix(options, element)};`;
  }

  const points = path.points || [];

  if (!points.length) {
    return null;
  }

  const body = points.map(coord).join(" -- ");

  return `\\draw${style} ${body}${path.closed ? " -- cycle" : ""}${nodeSuffix(options, element)};`;
}

/*
 * A LABEL, AT THE ELEMENT'S OWN ANCHOR.
 *
 * Only a label the student actually gave the element, and only when they asked
 * for labels in the output. The editor's own point names are not geometry.
 */
function nodeSuffix(options, element) {
  if (!options.includeLabels || !element.label) {
    return "";
  }

  return ` node[${element.labelPosition || "above"}] {${escapeText(element.label)}}`;
}

/* TikZ special characters, escaped in text. */
export function escapeText(text) {
  return String(text ?? "")
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

/* ============================================================
 * AXES, TICKS AND GRID
 * ============================================================ */

/*
 * THE COORDINATE GEOMETRY, WHEN IT IS ASKED FOR.
 *
 * The editor's grid is a WORKING AID and is not emitted by default. When the
 * student ticks "include in placed sketch" the axes, ticks, labels and grid
 * become real drawing geometry - drawn with their own appearance, so they can be
 * styled like anything else.
 */
export function coordinateSource(document, options = {}) {
  const grid = normaliseGrid(document.grid);
  const include = options.include || {};

  const lines = [];

  const bounds = document.bounds || { xMin: -5, xMax: 5, yMin: -5, yMax: 5 };

  if (include.axes) {
    const colour = grid.axisColour
      ? `[${colourName(grid.axisColour)}, ${THICKNESSES[1].tikz}]`
      : "";

    if (grid.showXAxis && bounds.yMin <= 0 && bounds.yMax >= 0) {
      lines.push(
        `\\draw${colour} ${coord({ x: bounds.xMin, y: 0 })} -- ${coord({ x: bounds.xMax, y: 0 })};`,
      );
    }

    if (grid.showYAxis && bounds.xMin <= 0 && bounds.xMax >= 0) {
      lines.push(
        `\\draw${colour} ${coord({ x: 0, y: bounds.yMin })} -- ${coord({ x: 0, y: bounds.yMax })};`,
      );
    }
  }

  const tickLength = 0.12;
  const inner = normaliseGrid(grid);

  if (include.ticks) {
    gridValues(bounds.xMin, bounds.xMax, inner.majorX).forEach((value) => {
      if (inner.showXAxis) {
        lines.push(
          `\\draw ${coord({ x: value, y: -tickLength })} -- ${coord({ x: value, y: tickLength })};`,
        );
      }
    });

    gridValues(bounds.yMin, bounds.yMax, inner.majorY).forEach((value) => {
      if (inner.showYAxis) {
        lines.push(
          `\\draw ${coord({ x: -tickLength, y: value })} -- ${coord({ x: tickLength, y: value })};`,
        );
      }
    });
  }

  if (include.labels) {
    gridValues(bounds.xMin, bounds.xMax, inner.majorX).forEach((value) => {
      if (value === 0) {
        return;
      }

      lines.push(
        `\\node[below, font=\\scriptsize] at ${coord({ x: value, y: 0 })} {${formatTick(value, inner)}};`,
      );
    });

    gridValues(bounds.yMin, bounds.yMax, inner.majorY).forEach((value) => {
      if (value === 0) {
        return;
      }

      lines.push(
        `\\node[left, font=\\scriptsize] at ${coord({ x: 0, y: value })} {${formatTick(value, inner)}};`,
      );
    });
  }

  if (include.majorGrid) {
    gridValues(bounds.xMin, bounds.xMax, inner.majorX).forEach((value) => {
      lines.push(
        `\\draw[gridmajor] ${coord({ x: value, y: bounds.yMin })} -- ${coord({ x: value, y: bounds.yMax })};`,
      );
    });

    gridValues(bounds.yMin, bounds.yMax, inner.majorY).forEach((value) => {
      lines.push(
        `\\draw[gridmajor] ${coord({ x: bounds.xMin, y: value })} -- ${coord({ x: bounds.xMax, y: value })};`,
      );
    });
  }

  if (include.minorGrid) {
    const minor = minorSpacing(inner);

    gridValues(bounds.xMin, bounds.xMax, minor.x).forEach((value) => {
      lines.push(
        `\\draw[gridminor] ${coord({ x: value, y: bounds.yMin })} -- ${coord({ x: value, y: bounds.yMax })};`,
      );
    });

    gridValues(bounds.yMin, bounds.yMax, minor.y).forEach((value) => {
      lines.push(
        `\\draw[gridminor] ${coord({ x: bounds.xMin, y: value })} -- ${coord({ x: bounds.xMax, y: value })};`,
      );
    });
  }

  return lines;
}

/* ============================================================
 * THE WHOLE DOCUMENT
 * ============================================================ */

/* Every colour an element (or the grid) uses, defined once each. */
export function colourDefinitions(document, include = {}) {
  const colours = new Set();

  (document.geometry || []).forEach((element) => {
    const appearance = normaliseAppearance(element.appearance);

    if (appearance.colour && !appearance.isDefaultColour) {
      colours.add(appearance.colour);
    }

    if (appearance.fillEnabled && appearance.fill) {
      colours.add(appearance.fill);
    }
  });

  if (include.grid && document.grid?.gridColour) {
    colours.add(document.grid.gridColour);
  }

  return [...colours]
    .map(
      (hex) =>
        `\\definecolor{${colourName(hex)}}{HTML}{${String(hex).replace("#", "").toUpperCase()}}`,
    )
    .join("\n");
}

/*
 * THE STYLE DEFINITIONS THE COORDINATE GEOMETRY REFERS TO.
 *
 * One `\tikzset` with one style per line, so the block is valid TikZ AND reads
 * back cleanly: a parser that skips `\tikzset` lines must not have to know how
 * many lines the block spans.
 */
const GRID_STYLES = [
  "\\tikzset{gridmajor/.style={draw=black!18, line width=0.4pt, dotted}}",
  "\\tikzset{gridminor/.style={draw=black!10, line width=0.3pt, dotted}}",
];

/* Libraries a generated sketch may need. */
const LIBRARIES = "calc, arrows.meta, positioning, patterns";

/*
 * THE SOURCE FOR A SKETCH.
 *
 * Deterministic: the same document always produces byte-identical output, which
 * is what makes "edit, regenerate, compare" a usable test of round-trip
 * fidelity.
 */
export function generateSource(document, options = {}) {
  const transform = transformOf(document);
  const include =
    options.include || (document.grid?.includeInOutput ? document.grid : {});

  const colours = colourDefinitions(document, include);

  const lines = [];

  lines.push("% Generated by DAETUM - Sketch Editor");

  /*
   * THE PLACEMENT IS AN OPTION OF THE PICTURE, NOT A SCOPE AROUND IT.
   *
   * A `scope` may not wrap a `tikzpicture`, and baking the transform into every
   * coordinate would make the source's numbers differ from the editor's - so
   * the transform goes on the picture itself. The coordinates inside stay the
   * student's own model coordinates, and the placement is visible as what it is.
   */
  const command = transformCommand(transform);

  lines.push(
    `\\begin{tikzpicture}[x=1mm, y=1mm, line cap=round, line join=round${command ? `, ${command.slice(1, -1)}` : ""}]`,
  );

  if (colours) {
    lines.push(colours);
  }

  lines.push(...GRID_STYLES);

  const coordinates = coordinateSource(document, { include });

  if (coordinates.length) {
    lines.push("");
    lines.push("% coordinate system");
    lines.push(...coordinates);
  }

  lines.push("");
  lines.push("% geometry");

  (document.geometry || []).forEach((element) => {
    const source = elementSource(element, {
      includeLabels: Boolean(include.labels) || Boolean(element.showLabel),
      includePoints: Boolean(include.points),
    });

    if (source) {
      lines.push(source);
    }
  });

  lines.push("");
  lines.push("\\end{tikzpicture}");

  return {
    source: lines.join("\n"),
    libraries: LIBRARIES,
    preamble: `\\usepackage{tikz}\n\\usetikzlibrary{${LIBRARIES}}`,
  };
}

/* The libraries, for a document that needs to declare them. */
export const SKETCH_TIKZ_LIBRARIES = LIBRARIES;

export default {
  colourName,
  pathOf,
  styleOf,
  elementSource,
  escapeText,
  coordinateSource,
  colourDefinitions,
  generateSource,
  SKETCH_TIKZ_LIBRARIES,
};
