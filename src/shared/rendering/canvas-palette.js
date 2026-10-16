/*
 * ============================================================
 * THE CANVAS PALETTE: AUTHORED COLOUR -> DISPLAY COLOUR
 * ============================================================
 *
 * A feature's colour is part of the DOCUMENT. It is chosen by the student, it is
 * saved in the file, and it is exported and printed - so it must never be
 * rewritten because the interface's theme changed.
 *
 * But a drawing made on white paper is drawn in dark ink, and that ink is
 * invisible the moment the canvas turns charcoal. Something has to adapt, and
 * the only safe thing to adapt is the DISPLAY:
 *
 *     authored colour  --(this module)-->  display colour
 *
 * The authored colour is what is stored, saved, exported and shown in the
 * colour picker. The display colour exists only for the frame being painted. The
 * theme can therefore change as often as the student likes and the document never
 * moves - which is the whole point, and the reason a naive "recolour every
 * feature on theme change" would be wrong. That approach DRIFTS: each toggle
 * would transform the colour it produced last time, and a black line would walk
 * through a series of greys until it was no longer black at all.
 *
 * ============================================================
 * WHY THIS IS A MODULE AND NOT A LINE IN THE RENDERER
 * ============================================================
 *
 * Every canvas entity - geometry, dimensions, notes, forces, loads, supports,
 * analysis graphics - has to adapt, and the renderer draws all of them. If the
 * rule lived inside any one of their drawing functions the others would each need
 * their own copy, and they would disagree: this requirement explicitly forbids
 * "separate inversion logic in each individual drawing tool".
 *
 * So there is ONE function, `displayColourFor(colour, theme)`, and it is pure: it
 * reads no state and writes nothing. The renderer calls it at the moment it sets
 * an attribute. Nothing here touches the document.
 *
 * ============================================================
 * THE RULE, AND WHAT IT DELIBERATELY IS NOT
 * ============================================================
 *
 * IT IS NOT `filter: invert(1)`. That would also invert the canvas background,
 * the grid, the selection handles and the snap markers - the interface would
 * become unusable, and the requirement calls this out by name. Inverting a colour
 * VALUE, here, has none of those consequences: the background is a theme token
 * and is never passed through this function.
 *
 * IT IS NOT A BLANKET NUMERIC INVERSION EITHER. A pure inversion maps mid-greys
 * to mid-greys (a 50% grey inverts to itself, so it stays invisible on both
 * grounds - the requirement says so explicitly), and it turns colour families
 * inside out: red becomes cyan, which is a different colour with different
 * meaning. So the rule is:
 *
 *   NEUTRALS are re-pointed to the theme's counterpart. A dark neutral becomes
 *   the light theme's ink counterpart, so black-on-white becomes ice-on-charcoal.
 *   This preserves the AUTHOR'S INTENT - "I drew this in ordinary ink" - and it is
 *   the common case, because most drawings are monochrome.
 *
 *   CHROMATIC colours keep their identity. Hue and saturation are preserved and
 *   only the LIGHTNESS is adjusted, and only if the colour would not be legible on
 *   the active canvas. A red dimension stays red in both themes; it is lifted in
 *   dark mode so it can be read, and left alone entirely when it already can be.
 *
 * ============================================================
 * REVERSIBILITY
 * ============================================================
 *
 * Because the authored colour is never written, reversal is free: switching back
 * to the light theme passes the SAME authored colour through the light rule and
 * returns the original value exactly. There is no "previous colour" to restore and
 * so nothing to get wrong. `displayColourFor` is a pure function of (colour,
 * theme), which is what makes light -> dark -> light an identity.
 */

/*
 * THE CANVAS BACKGROUND OF EACH THEME, as the contrast arithmetic needs it.
 *
 * These are the values `--canvas-background` resolves to in `tokens.css`. They
 * are duplicated here because contrast is judged numerically and this module
 * cannot read a CSS variable - there is no document at the moment the renderer
 * asks. A test asserts the two agree, so the duplication cannot drift silently.
 */
export const CANVAS_BACKGROUND = {
  light: "#ffffff",
  dark: "#142426",
};

/*
 * THE NEUTRAL COUNTERPARTS.
 *
 * A neutral is a colour with no hue to preserve - greys, black and white. These
 * are the two INK values the application already uses for drawing, taken from the
 * same source the theme's default line colour uses, so a feature drawn in the
 * default ink and one drawn in pure black both land on the same answer.
 */
export const NEUTRAL_INK = {
  light: "#193335",
  dark: "#E8F5F3",
};

/*
 * HOW CLOSE TO GREY A COLOUR MUST BE TO COUNT AS A NEUTRAL.
 *
 * Judged on the spread between the max and min channel: a colour whose channels
 * are within this fraction of full scale has no hue worth preserving. Pure black
 * and white are 0; a mid grey is 0. A strongly tinted colour is well above it.
 */
const NEUTRAL_CHROMA_LIMIT = 0.12;

/* The relative luminance a colour needs against the canvas to be readable. */
const MIN_CONTRAST = 3;

const clamp255 = (value) => Math.max(0, Math.min(255, Math.round(value)));

/*
 * Parse `#rgb`, `#rrggbb` and `rgb()` into channels, or null if it is not a
 * colour this module can reason about.
 *
 * A named CSS colour ("red"), `currentColor`, `none` and a URL all return null,
 * and a null is answered by leaving the colour UNCHANGED. That is the safe
 * default: the renderer uses "none" for every unfilled shape, and turning "none"
 * into a colour would fill every rectangle in the drawing.
 */
export function parseColour(colour) {
  if (typeof colour !== "string") {
    return null;
  }

  const text = colour.trim().toLowerCase();

  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text);

  if (short) {
    return {
      r: parseInt(short[1] + short[1], 16),
      g: parseInt(short[2] + short[2], 16),
      b: parseInt(short[3] + short[3], 16),
    };
  }

  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(text);

  if (long) {
    return {
      r: parseInt(long[1], 16),
      g: parseInt(long[2], 16),
      b: parseInt(long[3], 16),
    };
  }

  const rgb =
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)$/.exec(
      text,
    );

  if (rgb) {
    return {
      r: Number(rgb[1]),
      g: Number(rgb[2]),
      b: Number(rgb[3]),
    };
  }

  return null;
}

/*
 * The relative luminance of a colour, 0 (black) to 1 (white).
 *
 * The WCAG coefficients, because they are the ones that describe how a colour
 * actually appears rather than how bright its channels happen to be - pure green
 * is far more luminous than pure blue at the same channel value.
 */
export function luminance({ r, g, b }) {
  const channel = (value) => {
    const scaled = value / 255;

    return scaled <= 0.03928
      ? scaled / 12.92
      : ((scaled + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/*
 * The contrast ratio between two luminances, 1 (identical) to 21 (black/white).
 */
export function contrastRatio(first, second) {
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);

  return (lighter + 0.05) / (darker + 0.05);
}

/*
 * IS THIS A NEUTRAL - a grey, black or white with no hue worth keeping?
 *
 * Judged on the CHANNEL SPREAD rather than on saturation in HSL, because the
 * spread is what decides whether a pure-hue-preserving adjustment would be
 * meaningful: a colour whose channels are nearly equal has no hue to preserve.
 */
export function isNeutral(colour) {
  const parsed = typeof colour === "string" ? parseColour(colour) : colour;

  if (!parsed) {
    return false;
  }

  const max = Math.max(parsed.r, parsed.g, parsed.b);
  const min = Math.min(parsed.r, parsed.g, parsed.b);

  return (max - min) / 255 <= NEUTRAL_CHROMA_LIMIT;
}

const toHex = ({ r, g, b }) =>
  `#${[r, g, b].map((channel) => clamp255(channel).toString(16).padStart(2, "0")).join("")}`;

/*
 * ============================================================
 * BRIGHTEN OR DARKEN A COLOUR, PRESERVING ITS HUE
 * ============================================================
 *
 * A chromatic colour keeps its identity; only its lightness moves, and only as
 * far as it must to clear the canvas.
 *
 * IT IS SCALED TOWARD ITS OWN COMPLEMENT'S POLE rather than converted to HSL and
 * back. Conversion would round-trip through floats and shift the hue slightly on
 * every call, which is precisely the drift this module exists to avoid. Mixing
 * toward white or black in RGB keeps the hue and saturation ratios intact and is
 * exactly reversible when the adjustment is not applied.
 */
function lighten(colour, amount) {
  return {
    r: colour.r + (255 - colour.r) * amount,
    g: colour.g + (255 - colour.g) * amount,
    b: colour.b + (255 - colour.b) * amount,
  };
}

function darken(colour, amount) {
  return {
    r: colour.r * (1 - amount),
    g: colour.g * (1 - amount),
    b: colour.b * (1 - amount),
  };
}

/*
 * Adjust a CHROMATIC colour until it clears the canvas, in the direction the
 * theme needs - lighter on a dark canvas, darker on a light one.
 *
 * The steps are searched rather than calculated, so the result is the smallest
 * change that works: a red that is already legible on white is returned
 * untouched, and one that is not moves only as far as it has to.
 */
function adjustForContrast(parsed, theme) {
  const background = parseColour(
    CANVAS_BACKGROUND[theme] || CANVAS_BACKGROUND.light,
  );
  const backgroundLuminance = luminance(background);

  if (contrastRatio(luminance(parsed), backgroundLuminance) >= MIN_CONTRAST) {
    return parsed;
  }

  const toward =
    theme === "dark"
      ? (colour, amount) => lighten(colour, amount)
      : (colour, amount) => darken(colour, amount);

  let adjusted = parsed;

  for (let step = 1; step <= 20; step += 1) {
    adjusted = toward(parsed, step / 20);

    if (
      contrastRatio(luminance(adjusted), backgroundLuminance) >= MIN_CONTRAST
    ) {
      return adjusted;
    }
  }

  /* Nothing cleared it: the extreme is the best available answer. */
  return adjusted;
}

/*
 * ============================================================
 * THE ONE FUNCTION
 * ============================================================
 *
 * The authored colour in, the colour to PAINT with out. Pure: the same inputs
 * always give the same answer, and nothing is stored.
 *
 * A colour this module cannot parse is returned UNCHANGED. "none" must stay
 * "none"; a named colour is left to the browser, where the theme's own
 * `color-scheme` handles it. Guessing would be worse than passing it through.
 */
export function displayColourFor(colour, theme = "light") {
  const parsed = parseColour(colour);

  if (!parsed) {
    return colour;
  }

  const resolvedTheme = theme === "dark" ? "dark" : "light";

  /*
   * A NEUTRAL BECOMES THE THEME'S INK.
   *
   * This is the case that matters most, because a drawing is usually
   * monochrome. It is a re-pointing rather than an inversion: the authored
   * colour is the author saying "ordinary ink", and the theme says which ink
   * that is. Black in light mode becomes ice-white in dark mode, and comes back
   * as black - because the AUTHORED value, pure black, never changed.
   */
  if (isNeutral(parsed)) {
    const ink = parseColour(NEUTRAL_INK[resolvedTheme]) || parsed;
    const background = parseColour(CANVAS_BACKGROUND[resolvedTheme]);

    /*
     * A neutral that is ALREADY legible keeps its value, so a drawing
     * deliberately made in a mid grey is not silently promoted to full ink.
     * Black on white and white on black are the cases that must move.
     */
    if (
      background &&
      contrastRatio(luminance(parsed), luminance(background)) >= MIN_CONTRAST
    ) {
      return colour;
    }

    return toHex(ink);
  }

  /*
   * A CHROMATIC COLOUR KEEPS ITS IDENTITY - hue preserved, lightness adjusted
   * only as far as legibility requires.
   */
  return toHex(adjustForContrast(parsed, resolvedTheme));
}

/*
 * The theme name a render should resolve colours for.
 *
 * The renderer is handed the drawing state, not the interface, so the theme has
 * to come from somewhere known to both. It is read off the document element -
 * the attribute `theme.js` already maintains - which means the canvas and the
 * interface can never disagree about which theme is active.
 *
 * `system` (no attribute) is resolved through the media query, exactly as
 * `theme.js` resolves it, so a machine in dark mode gets the dark palette even
 * before a preference has been stored.
 */
export function activeCanvasTheme(scope) {
  try {
    const doc = scope || globalThis.document;
    const root = doc && doc.documentElement;

    if (!root) {
      return "light";
    }

    const declared = root.getAttribute("data-theme");

    if (declared === "dark" || declared === "light") {
      return declared;
    }

    const prefersDark =
      typeof globalThis.matchMedia === "function" &&
      globalThis.matchMedia("(prefers-color-scheme: dark)").matches;

    return prefersDark ? "dark" : "light";
  } catch (error) {
    return "light";
  }
}

const enggCanvasPalette = {
  CANVAS_BACKGROUND,
  NEUTRAL_INK,
  activeCanvasTheme,
  contrastRatio,
  displayColourFor,
  isNeutral,
  luminance,
  parseColour,
};

export default enggCanvasPalette;
