/*
 * ============================================================
 * THE SHARED SKETCH APPEARANCE MODEL
 * ============================================================
 *
 * How a piece of sketch geometry LOOKS, as data rather than as a styling side
 * effect.
 *
 * Appearance is stored on the geometry, saved with it, carried through
 * placement into the main drawing, and serialised into the generated source.
 * That is the whole point: a dashed red circle in the editor must be a dashed
 * red circle on the sheet and a dashed red circle in the TikZ - produced from
 * the SAME stored numbers, not from a preview style and an export style that
 * happen to look alike today.
 *
 * TWO LEVELS
 * ----------
 *   default    what NEW geometry gets when nothing says otherwise
 *   per-element what ONE piece of geometry was given
 *
 * The two are independent by design. Changing the default must never rewrite
 * the geometry that already exists - a student who styled one curve by hand
 * does not expect it to be repainted because they changed what the next one
 * will look like.
 *
 * STYLE VALUES ARE NOT SCALED BY ZOOM. A thickness of "1.5" is 1.5 drawing
 * units in the document and 1.5 points in the source, at every zoom and every
 * canvas size. Nothing in this module multiplies a stored style by a camera
 * factor - that is what makes "11 pt must stay 11 pt at 200% zoom" true.
 */

/* The line patterns a student can choose. The names are the interface's and
 * the TikZ strings are the source's; one table, so they cannot drift apart. */
export const LINE_STYLES = Object.freeze({
  solid: { label: "Solid", tikz: "solid", dasharray: null },
  dashed: { label: "Dashed", tikz: "dashed", dasharray: "6 4" },
  dotted: { label: "Dotted", tikz: "dotted", dasharray: "1.5 3" },
  "dash-dot": { label: "Dash-dot", tikz: "dash dot", dasharray: "8 3 1.5 3" },
  "long-dash": {
    label: "Long dash",
    tikz: "loosely dashed",
    dasharray: "12 5",
  },
  dashdotdot: {
    label: "Dash-dot-dot",
    tikz: "dash dot dot",
    dasharray: "8 3 1.5 3 1.5 3",
  },
});

export const LINE_STYLE_IDS = Object.freeze(Object.keys(LINE_STYLES));

/* DAETUM's established thicknesses, shared with the rest of the drawing. */
export const THICKNESSES = Object.freeze([
  { id: "thin", label: "Thin", value: 0.6, tikz: "thin" },
  { id: "normal", label: "Normal", value: 1.2, tikz: "semithick" },
  { id: "bold", label: "Bold", value: 2.0, tikz: "thick" },
  { id: "heavy", label: "Heavy", value: 3.0, tikz: "very thick" },
]);

export const THICKNESS_IDS = Object.freeze(
  THICKNESSES.map((entry) => entry.id),
);

export const LINE_CAPS = Object.freeze({
  butt: "butt",
  round: "round",
  square: "square",
});

export const LINE_JOINS = Object.freeze({
  miter: "miter",
  round: "round",
  bevel: "bevel",
});

/*
 * THE DEFAULT APPEARANCE.
 *
 * Black in the light theme and the theme's own ink in the dark one - which is
 * exactly what "theme-aware default" means: the DEFAULT follows the theme, but
 * a colour a student PICKED does not. `isDefaultColour` is what tells the two
 * apart, so a theme switch repaints the defaults and leaves the choices alone.
 */
/* The fill a student gets when they enable one without picking a colour. */
const FILL_FALLBACK = "#999999";

export const DEFAULT_APPEARANCE = Object.freeze({
  lineStyle: "solid",
  colour: null,
  /* When true the colour follows the theme; a picked colour sets this false. */
  isDefaultColour: true,
  thickness: "normal",
  fill: null,
  fillEnabled: false,
  fillOpacity: 1,
  lineCap: "round",
  lineJoin: "round",
});

function finite(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
}

/* A colour as #rrggbb, or null if it is not one. */
export function normaliseColour(value) {
  const text = String(value ?? "").trim();

  if (!text) {
    return null;
  }

  if (/^#[0-9a-f]{6}$/i.test(text)) {
    return text.toLowerCase();
  }

  if (/^#[0-9a-f]{3}$/i.test(text)) {
    return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`.toLowerCase();
  }

  return null;
}

/* The thickness entry for an id, or by its numeric value. */
export function thicknessOf(value) {
  if (value === null || value === undefined) {
    return THICKNESSES[1];
  }

  const byId = THICKNESSES.find((entry) => entry.id === value);

  if (byId) {
    return byId;
  }

  const number = Number(value);

  if (Number.isFinite(number) && number > 0) {
    /* The nearest declared thickness, so the source always has a name too. */
    return THICKNESSES.reduce((best, entry) =>
      Math.abs(entry.value - number) < Math.abs(best.value - number)
        ? entry
        : best,
    );
  }

  return THICKNESSES[1];
}

/* The stroke width in drawing units. */
export function strokeWidthOf(appearance) {
  return thicknessOf(appearance?.thickness).value;
}

/* The dash pattern for a line style, or null for solid. */
export function dashOf(appearance) {
  const style = LINE_STYLES[appearance?.lineStyle] || LINE_STYLES.solid;

  return style.dasharray;
}

/*
 * Normalise an appearance object.
 *
 * Anything missing falls back to the defaults, so a half-written appearance is
 * still a usable one - which matters because an OLDER drawing's geometry will
 * not have every field this version knows about.
 */
export function normaliseAppearance(
  appearance = {},
  fallback = DEFAULT_APPEARANCE,
) {
  const source = appearance || {};

  const colour = normaliseColour(source.colour);

  return {
    lineStyle: LINE_STYLE_IDS.includes(source.lineStyle)
      ? source.lineStyle
      : fallback.lineStyle,
    colour: colour ?? (source.colour === undefined ? fallback.colour : null),
    isDefaultColour:
      colour !== null
        ? false
        : source.isDefaultColour !== undefined
          ? Boolean(source.isDefaultColour)
          : fallback.isDefaultColour,
    thickness: THICKNESS_IDS.includes(source.thickness)
      ? source.thickness
      : Number.isFinite(Number(source.thickness))
        ? thicknessOf(source.thickness).id
        : fallback.thickness,
    fill: normaliseColour(source.fill) ?? (source.fill ? fallback.fill : null),
    fillEnabled: Boolean(source.fillEnabled),
    fillOpacity: Math.max(0, Math.min(1, finite(source.fillOpacity, 1))),
    lineCap: Object.keys(LINE_CAPS).includes(source.lineCap)
      ? source.lineCap
      : fallback.lineCap,
    lineJoin: Object.keys(LINE_JOINS).includes(source.lineJoin)
      ? source.lineJoin
      : fallback.lineJoin,
  };
}

/* The colour actually painted, given the theme's ink. */
export function resolveColour(appearance, themeInk = "#000000") {
  const settings = normaliseAppearance(appearance);

  if (settings.isDefaultColour || !settings.colour) {
    return themeInk;
  }

  return settings.colour;
}

/*
 * CHANGE ONE PROPERTY, AND KEEP THE REST.
 *
 * Picking a colour is what "not the default any more" means, so it clears
 * `isDefaultColour` - and choosing to go back to the default sets it again.
 * That pairing is the whole mechanism behind "custom colours survive a theme
 * change, defaults follow it".
 */
export function withAppearance(geometry, change = {}) {
  const current = normaliseAppearance(geometry?.appearance);
  const next = { ...current };

  if ("lineStyle" in change && LINE_STYLE_IDS.includes(change.lineStyle)) {
    next.lineStyle = change.lineStyle;
  }

  if ("colour" in change) {
    const colour = normaliseColour(change.colour);

    next.colour = colour;
    next.isDefaultColour = colour === null;
  }

  if ("thickness" in change) {
    next.thickness = thicknessOf(change.thickness).id;
  }

  if ("fill" in change) {
    next.fill = normaliseColour(change.fill);
    next.fillEnabled = next.fill !== null;
  }

  if ("fillEnabled" in change) {
    next.fillEnabled =
      Boolean(change.fillEnabled) && Boolean(next.fill || current.fill);

    if (next.fillEnabled && !next.fill) {
      /* A fill without a colour is the stroke colour at a low opacity - a
       * sensible default the student can then change. */
      next.fill = current.colour || FILL_FALLBACK;
    }
  }

  if ("fillOpacity" in change) {
    next.fillOpacity = Math.max(0, Math.min(1, finite(change.fillOpacity, 1)));
  }

  if ("lineCap" in change && Object.keys(LINE_CAPS).includes(change.lineCap)) {
    next.lineCap = change.lineCap;
  }

  if (
    "lineJoin" in change &&
    Object.keys(LINE_JOINS).includes(change.lineJoin)
  ) {
    next.lineJoin = change.lineJoin;
  }

  return { ...geometry, appearance: next };
}



/* Back to the sketch's default appearance - the "restore" action. */
export function resetAppearance(geometry, defaults = DEFAULT_APPEARANCE) {
  return { ...geometry, appearance: normaliseAppearance(defaults) };
}

/*
 * Whether fill applies at all.
 *
 * A line has no inside, so offering it a fill would be offering a control that
 * cannot do anything. The interface reads this, so the control simply is not
 * shown - which is what "adapt to the selected geometry" means.
 */
export function supportsFill(geometry) {
  const kind = String(geometry?.kind || geometry?.type || "");

  return ["circle", "ellipse", "rectangle", "polygon", "closed-curve"].includes(
    kind,
  );
}

/* Whether the geometry is closed, for both fill and the source's own syntax. */
export function isClosed(geometry) {
  const kind = String(geometry?.kind || geometry?.type || "");

  if (["circle", "ellipse", "rectangle", "polygon"].includes(kind)) {
    return true;
  }

  return Boolean(geometry?.closed);
}

/*
 * CSS for painting this appearance in the editor and the drawing.
 *
 * `nonScaling` keeps the stroke's WIDTH constant on screen at any zoom, which is
 * DAETUM's policy for visual line work: the geometry zooms, the line thickness
 * does not. `vector-effect` is how that is done without touching the value.
 */
export function appearanceCss(
  appearance,
  { themeInk = "#000000", resolvedFill = null } = {},
) {
  const settings = normaliseAppearance(appearance);

  const dash = dashOf(settings);

  return {
    stroke: resolveColour(settings, themeInk),
    fill: settings.fillEnabled
      ? resolvedFill || settings.fill || "none"
      : "none",
    fillOpacity: settings.fillEnabled ? settings.fillOpacity : undefined,
    strokeWidth: strokeWidthOf(settings),
    strokeLinecap: settings.lineCap,
    strokeLinejoin: settings.lineJoin,
    strokeDasharray: dash || undefined,
    vectorEffect: "non-scaling-stroke",
  };
}

export default {
  LINE_STYLES,
  LINE_STYLE_IDS,
  THICKNESSES,
  THICKNESS_IDS,
  LINE_CAPS,
  LINE_JOINS,
  DEFAULT_APPEARANCE,
  normaliseColour,
  thicknessOf,
  strokeWidthOf,
  dashOf,
  normaliseAppearance,
  resolveColour,
  withAppearance,
  resetAppearance,
  supportsFill,
  isClosed,
  appearanceCss,
};
