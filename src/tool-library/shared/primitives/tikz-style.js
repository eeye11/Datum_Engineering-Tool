/*
 * ============================================================
 * THE ONE CONVERSION FROM A DAETUM STYLE TO TIKZ OPTIONS
 * ============================================================
 *
 * Every source writer - Geometry, Statics, Annotations, Dynamics, Fluids and
 * Thermodynamics - has to answer the same three questions for every object it
 * writes:
 *
 *     what colour is the stroke,  how thick is it,  how opaque is it?
 *
 * They used to answer them separately, and the answers had drifted apart. The
 * Statics writer wrote `line width=0.28pt` for a 0.5 drawing-unit stroke while
 * the canvas painted that same stroke 1.2 px wide; it also read the theme's
 * default ink (`#193335`, a dark teal) as if the student had chosen a colour;
 * and it emitted `\definecolor` again in front of EVERY command of an object
 * that had several. That is the whole of "the generated code is thin, teal and
 * long": three separate defaults, each decided somewhere else.
 *
 * So the conversion lives here, once, and the writers call it. There is no
 * per-tool multiplier and no per-object special case: an object's style is
 * whatever the Features panel says it is, and this module turns it into the
 * options TikZ needs.
 *
 * A NOMINAL WIDTH IS A POINTS VALUE.
 * --------------------------------
 *
 * `thin` IS 0.4pt - the same number TikZ gives the name - and a scaled figure
 * writes `nominal x exportScale`, so a stroke keeps its weight RELATIVE to the
 * drawing wherever it is printed. The factor arrives through the export context
 * (`export-transform.js`) and is applied exactly once; with no context it is 1,
 * and the output is the nominal width itself.
 *
 * THE COLOUR IS THE AUTHORED COLOUR, NOT THE THEME'S.
 *
 * `theme.defaultLineColour()` is the ink a NEW object gets when the student has
 * not chosen one; it is a dark teal on the light sheet and an ice white on the
 * dark one, and it exists so a drawing is legible against whichever paper the
 * interface is using. It is NOT the colour the drawing is made of. Writing it
 * into the source made every black line a dark teal in TeX, and made the same
 * file change colour when the interface theme changed - which a saved document
 * must never do. An object with no authored colour is serialised as BLACK,
 * which is what the sheet prints, exports and compiles to.
 *
 * OPACITY IS A PROPERTY OF THE OBJECT.
 *
 * A fully opaque object writes no opacity option at all; a deliberately
 * translucent one writes `draw opacity=` with its own value. The shared
 * `style.opacity` (1 when absent) is the only source of that number.
 */

/*
 * THE CANVAS'S SCREEN SCALE, in pixels per nominal point.
 *
 * The model paints a stroke at `nominalWidth x STROKE_SCALE` screen pixels, and
 * the compiled picture's stated width is shown at the same size - so the canvas
 * and the source agree at scale 1. It is NOT part of the export conversion: the
 * export factor is a physical reduction, and multiplying by this as well would
 * apply a second, unrelated scale to every pen.
 *
 * Kept for the CANVAS (and for tool templates that size a stroke on screen); the
 * writers do not use it.
 */
export const STROKE_SCALE = 2.4;

/* The colour a drawing is made of when the student has not chosen one. */
export const DEFAULT_STROKE = "#000000";

/*
 * THE NOMINAL SIZE OF A FILLED ARROW HEAD, in points.
 *
 * TikZ's `Latex` tip at its default size is about 2.5 mm long, which is this
 * figure in points. It is stated here so the export can scale a head with the
 * rest of the figure - `arrows.meta` lets a size be given explicitly - and so
 * the primitives and the Statics writer cannot disagree about what "full size"
 * means.
 */
export const NOMINAL_ARROW_HEAD_PT = 7.2;

/* The model's own default width, used only to answer "how thick is absent?". */
export const DEFAULT_LINE_WIDTH = "thin";

/*
 * WHAT ONE UNIT OF `lineWidth` IS IN POINTS.
 *
 * THE ONE CALIBRATION BETWEEN THE CANVAS AND THE SOURCE.
 *
 * The canvas draws a stroke at `lineWidth x SCREEN_PIXELS_PER_LINE_WIDTH`
 * screen pixels (2.4 - see `canvas-stroke-constants.js`, which owns that
 * constant). To make the printed stroke weigh the SAME as the one on the sheet,
 * a model width of `w` must be written as `w x 2.4` POINTS:
 *
 *     print pt = model lineWidth x POINTS_PER_LINE_WIDTH
 *
 * Writing the model number through unconverted (`line width=0.5pt` for a 0.5
 * stroke, which the canvas paints 1.2 px wide) is what produced hairlines in
 * every external renderer. At 96 CSS px per inch, 1.2 px is 0.9 pt, so a 0.5
 * stroke that the sheet draws visibly was written 1.8x too thin.
 *
 * The number answers "how many points is one unit of the model's width?" - it is
 * not a preset multiplier and not a per-tool tweak. It is applied HERE, once, to
 * every object of every tool, and then multiplied by the export factor.
 */
export const POINTS_PER_LINE_WIDTH = 2.4;

/*
 * ============================================================
 * THICKNESS PRESETS
 * ============================================================
 *
 * The Features panel offers these names, and they are stored in the style as the
 * preset NAME (or, from an older file, as the number a preset used to mean).
 * This table is the one conversion between the two.
 *
 * THE VALUES ARE MODEL WIDTHS, the same scale as a numeric `lineWidth`, so
 * `thin` and `0.5` are the SAME pen - which is what the panel shows and what the
 * canvas paints. They are NOT TikZ's own point values: TikZ's `thin` is 0.4pt, a
 * print size, and a drawing authored in model units needs the conversion above
 * before it can be compared to one.
 */
export const THICKNESS_PRESETS = {
  "ultra-thin": 0.25,
  "very-thin": 0.35,
  thin: 0.5,
  "semi-thick": 0.75,
  thick: 1,
  "very-thick": 1.5,
  "ultra-thick": 2
};

/*
 * A numeric line width from either a preset name or a number.
 *
 * A NUMBER IS TAKEN AS THE NOMINAL WIDTH ITSELF, because that is what the model
 * stores once a width has been read back - and because the export multiplies it
 * by exactly one factor, a value that is written as nominal must never pick up a
 * second conversion on the way.
 */
export function resolveLineWidth(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  const named = THICKNESS_PRESETS[String(value ?? "").toLowerCase()];

  if (named !== undefined) {
    return named;
  }

  const numeric = Number(value);

  return Number.isFinite(numeric) && numeric > 0 ? numeric : THICKNESS_PRESETS.thin;
}

/* Normalise a hex colour to `RRGGBB`, or null when the value is not one. */
export function normaliseColour(value) {
  const text = String(value ?? "").trim();

  if (!text || /^none$/i.test(text) || /^transparent$/i.test(text)) {
    return null;
  }

  const short = text.match(/^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/);

  if (short) {
    return short
      .slice(1)
      .map((character) => character + character)
      .join("")
      .toUpperCase();
  }

  const long = text.match(/^#([0-9a-fA-F]{6})$/);

  return long ? long[1].toUpperCase() : null;
}

/*
 * The xcolor NAME a value is written as.
 *
 * A hex colour becomes `black` / `white` when it is literally those, and
 * `daetumC<hex>` otherwise - a name derived from the value, so the same colour
 * always gets the same name and two objects of one colour share one definition.
 * A word the student may already have typed (`red`, `blue!40`) is passed through
 * untouched: it is valid xcolor and rewriting it would change the drawing.
 */
export function colourName(value, { fallback = DEFAULT_STROKE } = {}) {
  const text = String(value ?? "").trim();

  if (!text || /^none$/i.test(text) || /^transparent$/i.test(text)) {
    return fallback === null ? null : colourName(fallback, { fallback: null });
  }

  const hex = normaliseColour(text);

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

/*
 * A `\definecolor` line for one colour name, or null when the name needs none.
 *
 * `{RGB}` rather than `{HTML}`: DAETUM's renderer (TikZJax) loads xcolor without
 * its HTML model, and `{RGB}` is a core model that compiles there AND in a full
 * TeX Live installation, so one spelling works everywhere.
 */
export function colourDefinition(name, value) {
  const hex = normaliseColour(value);

  if (!hex || !name || name === "black" || name === "white") {
    return null;
  }

  const channels = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16));

  return `\\definecolor{${name}}{RGB}{${channels.join(",")}}`;
}

/* The definition a colour NAME needs, derived from the name itself. */
export function definitionForName(name) {
  const match = /^daetumC([0-9A-F]{6})$/i.exec(String(name ?? ""));

  /*
   * THE HASH IS RESTORED BEFORE NORMALISING.
   *
   * The name carries the hex digits without one (`daetumC193335`), and
   * `normaliseColour` reads a bare six-digit string as "not a colour" - so the
   * `#` is put back here. Without it this returned null for every name, and a
   * coloured object was written with a colour nothing had defined.
   */
  return match ? colourDefinition(name, `#${match[1]}`) : null;
}

/*
 * A stroke width in points, from the model's own `lineWidth`.
 *
 * TWO MULTIPLICATIONS, AND ONLY TWO - both named:
 *
 *     nominalPt = resolveLineWidth(lineWidth) x POINTS_PER_LINE_WIDTH
 *     effective = nominalPt x transform.factor
 *
 * The first is the CANVAS CALIBRATION: the sheet paints a 0.5 stroke 1.2 px
 * wide, and the source must state the pen that draws 1.2 px (or the same weight
 * at print scale), not a 0.5pt hairline. The second is the EXPORT REDUCTION: a
 * figure fitted to 35% is drawn smaller, so its pen is reduced with it and keeps
 * its weight RELATIVE to the drawing. With no transform (or the identity one)
 * the answer is the calibrated nominal width, which is what a scale-1 export
 * states.
 *
 * THE FACTOR IS APPLIED HERE AND NOWHERE ELSE. A caller that has already been
 * handed an effective width passes it as a NUMBER, and `resolveLineWidth`
 * returns a number unchanged - so the value cannot be multiplied twice - while
 * `strokeOptions` is the only caller that passes a `lineWidth`.
 */
export function strokeWidthPt(lineWidth, transform = null) {
  const nominal = resolveLineWidth(
    lineWidth === undefined || lineWidth === null ? DEFAULT_LINE_WIDTH : lineWidth
  );

  const factor = Number(transform?.factor);

  const scaled =
    nominal * POINTS_PER_LINE_WIDTH * (Number.isFinite(factor) && factor > 0 ? factor : 1);

  return Number(scaled.toFixed(4));
}

/*
 * The same calibrated, unscaled width - for a caller that needs the print size
 * of a pen without an export context (a legend swatch, a fixed-size mark).
 */
export function nominalStrokePt(lineWidth) {
  return Number((resolveLineWidth(lineWidth) * POINTS_PER_LINE_WIDTH).toFixed(4));
}

/* A TikZ number for a pen width: no trailing zeros, no exponent. */
export function formatPt(value, precision = 4) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "0";
  }

  return String(Number(number.toFixed(precision)));
}

/*
 * An opacity the OBJECT authorises: a number in (0, 1), or null.
 *
 * Absent, 1 and anything outside the range write nothing - a source command
 * must never be translucent unless the canvas object is.
 */
export function opacityValue(value) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0 || number >= 1) {
    return null;
  }

  return Number(number.toFixed(3));
}

/*
 * A dash pattern for a line type, or null for a solid line.
 *
 * THE LENGTHS ARE NOMINAL POINTS AND SCALE WITH THE EXPORT.
 *
 * `dashed` and `dotted` are TikZ's own styles, whose dash and gap lengths are
 * PHYSICAL and do not follow the coordinates - so a figure reduced to 35% would
 * still space its dashes for a full-size drawing, and read as almost solid. The
 * explicit `dash pattern=` form states the lengths, so the pattern is multiplied
 * by the export factor with everything else. At scale 1 the named style is kept,
 * because it is the code a reader expects to see.
 */
export function dashOptions(lineType, transform = null) {
  const type = String(lineType ?? "").toLowerCase();

  const factor = Number(transform?.factor);
  const scaled = Number.isFinite(factor) && factor > 0 && factor < 1 ? factor : null;

  /* The nominal pattern for each line type, in points. */
  const pattern =
    type === "dashed"
      ? { on: 3, off: 3 }
      : type === "dotted"
        ? { on: 0.8, off: 2.4 }
        : type === "center"
          ? { sequence: [4, 2, 1, 2] }
          : type === "construction"
            ? { sequence: [1, 2] }
            : null;

  if (!pattern) {
    return null;
  }

  if (!scaled) {
    if (type === "dashed") {
      return ["dashed"];
    }

    if (type === "dotted") {
      return ["dotted"];
    }

    if (type === "center") {
      return ["dash pattern=on 4pt off 2pt on 1pt off 2pt"];
    }

    return ["dash pattern=on 1pt off 2pt"];
  }

  const sequence = pattern.sequence
    ? pattern.sequence
    : [pattern.on, pattern.off];

  const lengths = sequence.map((length) => {
    const value = Number((length * scaled).toFixed(3));

    return value > 0 ? value : 0.05;
  });

  const written = [];

  lengths.forEach((length, index) => {
    written.push(`${index % 2 === 0 ? "on" : "off"} ${length}pt`);
  });

  return [`dash pattern=${written.join(" ")}`];
}

/*
 * ============================================================
 * THE STROKE OPTIONS, WITH THEIR COLOUR DEFINITIONS
 * ============================================================
 *
 * Returns `{ options, definitions }`:
 *
 *   options      the contents of a `[...]` option list, in a FIXED order so
 *                two objects with the same style serialise identically;
 *   definitions  the `\definecolor` lines the options need, already unique.
 *
 * A caller that writes commands through `writeCommand` puts the definitions in
 * front of the FIRST command it writes - once per object, not once per command.
 *
 * `overrides` exists for the few drawing marks that are deliberately drawn with
 * a lighter pen than the object (a support's hatching, a shaft's centre line).
 * It replaces a value outright, so a command can never carry two `line width=`.
 */
export function strokeOptions(style = {}, { overrides = {}, colour = undefined, transform = null } = {}) {
  const options = [];
  const definitions = [];

  const merged = { ...style, ...overrides };

  const strokeValue =
    colour !== undefined
      ? colour
      : String(merged.stroke ?? "").toLowerCase() === "none" || merged.draw === false
        ? "none"
        : merged.stroke || DEFAULT_STROKE;

  const stroke = colourName(strokeValue, { fallback: DEFAULT_STROKE });

  if (stroke === null) {
    options.push("draw=none");
  } else {
    const definition = definitionForName(stroke);

    if (definition) {
      definitions.push(definition);
    }

    /*
     * THE COLOUR IS ALWAYS WRITTEN AS `draw=`, INCLUDING `draw=black`.
     *
     * TikZ happens to accept a bare colour word as an option, but a bare
     * UNKNOWN word is a hard `pgfkeys` error that stops the whole document - and
     * a colour the student typed (`red`, `blue!40`, a name from a palette) is
     * not something this module can enumerate. `draw=<name>` is the form that is
     * valid for every xcolor name, so one spelling covers both a colour this
     * module derived and a colour it was handed.
     */
    options.push(`draw=${stroke}`);
  }

  /*
   * THE PEN WIDTH, AT THE EXPORT SCALE.
   *
   * `merged.lineWidth` is the NOMINAL width - a preset name or its points value
   * - and `transform` contributes the one factor it gets. A colour or an
   * override never changes the factor, so the same style always writes the same
   * width for the same drawing.
   */
  const width = strokeWidthPt(merged.lineWidth, transform);

  if (width > 0) {
    options.push(`line width=${formatPt(width, 4)}pt`);
  }

  const dashes = dashOptions(merged.lineType, transform);

  if (dashes) {
    options.push(...dashes);
  }

  const opacity = opacityValue(merged.opacity);

  if (opacity !== null) {
    options.push(`draw opacity=${opacity}`);
  }

  return { options, definitions: unique(definitions) };
}

/*
 * The fill option for a style that asks for one, and its definition.
 *
 * Gated by the fill MODE, exactly as the panel is: `none` draws an outline even
 * when a colour was chosen and left behind.
 */
export function fillOptions(style = {}, { overrides = {} } = {}) {
  const merged = { ...style, ...overrides };
  const mode = String(merged.fillMode ?? "").toLowerCase();

  if (mode === "none") {
    return { option: null, definitions: [] };
  }

  const value = merged.fill && merged.fill !== "none" ? merged.fill : merged.stroke;
  const name = colourName(value, { fallback: DEFAULT_STROKE });

  if (!name || mode !== "solid") {
    return { option: null, definitions: [] };
  }

  const definition = definitionForName(name);
  const options = [`fill=${name}`];

  const opacity = opacityValue(merged.fillOpacity);

  if (opacity !== null) {
    options.push(`fill opacity=${opacity}`);
  }

  return {
    option: options.join(", "),
    definitions: definition ? [definition] : []
  };
}

/* Remove repeated entries, keeping the first occurrence's position. */
export function unique(values) {
  const seen = new Set();
  const out = [];

  (values || []).forEach((value) => {
    const text = String(value ?? "");

    if (!text || seen.has(text)) {
      return;
    }

    seen.add(text);
    out.push(value);
  });

  return out;
}

export default {
  STROKE_SCALE,
  DEFAULT_STROKE,
  DEFAULT_LINE_WIDTH,
  THICKNESS_PRESETS,
  POINTS_PER_LINE_WIDTH,
  normaliseColour,
  colourName,
  colourDefinition,
  definitionForName,
  strokeWidthPt,
  nominalStrokePt,
  formatPt,
  opacityValue,
  dashOptions,
  strokeOptions,
  fillOptions,
  unique
};
