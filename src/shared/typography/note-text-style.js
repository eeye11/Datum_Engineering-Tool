/*
 * Whole-note typography shared by the canvas, editor, and document export.
 *
 * A NOTE'S SIZE IS A CANVAS FONT SIZE - a screen pixel size from the shared
 * typography system - not a paper point size and not a viewport function. This
 * module is the note-shaped view of that system: it adds the note's own family,
 * weight, alignment and indent to the shared size rules, so the canvas, the
 * in-place editor and the source writer all lay the same words out the same way.
 */
import {
  CANVAS_FONT_STACK,
  DEFAULT_CANVAS_FONT_PX,
  FONT_PX_MAX,
  FONT_PX_MIN,
  LINE_SPACING,
  fontSizeOf,
  textWidthEstimate,
} from "./canvas-typography.js";

export const NOTE_FONTS = [
  { value: "Arial", label: "Arial (sans serif)" },
  { value: "Times New Roman", label: "Times New Roman (serif)" },
  { value: "Courier New", label: "Courier New (monospace)" },
];
const clamp = (value, fallback, min, max) =>
  Number.isFinite(Number(value))
    ? Math.min(max, Math.max(min, Number(value)))
    : fallback;
export function noteTextStyle(style = {}) {
  return {
    fontFamily: NOTE_FONTS.some((font) => font.value === style.fontFamily)
      ? style.fontFamily
      : "Arial",
    /*
     * THE SHARED SIZE RULES, not a second copy of them. `fontSizeOf` clamps
     * into the canvas typography range and answers the 16 px default for an
     * absent or broken value - so a note and a label cannot disagree about
     * what "no size set" means, and the old 12 px floor that quietly
     * promoted a dimension's 11 pt to 12 is gone with it.
     */
    fontSize: fontSizeOf(style?.fontSize, DEFAULT_CANVAS_FONT_PX),
    bold: style.bold === true,
    italic: style.italic === true,
    underline: style.underline === true,
    align: ["left", "center", "right"].includes(style.align)
      ? style.align
      : "left",
    indent: clamp(style.indent ?? 0, 0, 0, 1000),
    lineSpacing: clamp(style.lineSpacing ?? LINE_SPACING, LINE_SPACING, 1, 3),

    /*
     * ========================================================
     * THE REST OF THE SHARED TEXT STYLE
     * ========================================================
     *
     * Rotation, a background fill and its padding are part of ONE style model,
     * read by the canvas, the in-place editor, the Properties sidebar and the
     * source writer - so none of them can hold a different opinion about how a
     * piece of text looks.
     *
     * A TRANSPARENT BACKGROUND IS THE DEFAULT, deliberately: a white rectangle
     * behind every note would be a change to the drawing nobody asked for. A
     * fill appears only when the student enables one.
     */
    rotation: clamp(style.rotation ?? 0, 0, -360, 360),
    background: style.background === true,
    backgroundColour:
      /^#[0-9a-f]{6}$/i.test(String(style.backgroundColour || ""))
        ? style.backgroundColour
        : "#ffffff",
    padding: clamp(style.padding ?? 0, 0, 0, 100),
  };
}

/*
 * THE POINT SIZES THE SIZE CONTROL OFFERS.
 *
 * A complete, practical ladder rather than a free number field alone: the list
 * is the fast path, and a typed value is still accepted exactly as given - the
 * field validates the RANGE but never replaces a real number with the nearest
 * preset, which would silently change what the student asked for.
 */
export const TEXT_POINT_SIZES = Object.freeze([
  8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64,
]);

/*
 * THE SHARED DEFAULT TEXT STYLE.
 *
 * One answer for every tool that creates text, held in ONE place so a Heat
 * Transfer label and a Note cannot start out differently. It is a DEFAULT only:
 * changing it never rewrites an object that already exists - that object keeps
 * its own stored style, which is the whole point of storing one.
 */
export const DEFAULT_TEXT_STYLE = Object.freeze({
  fontFamily: "Arial",
  fontSize: DEFAULT_CANVAS_FONT_PX,
  bold: false,
  italic: false,
  underline: false,
  align: "left",
  indent: 0,
  lineSpacing: LINE_SPACING,
  rotation: 0,
  background: false,
  backgroundColour: "#ffffff",
  padding: 0,
});

/*
 * THE USER'S CHOSEN DEFAULT, over the built-in one.
 *
 * `Use as Default` writes here; every new text object reads it. The store is a
 * module variable rather than a feature field because it is a property of HOW
 * the student is working, not of any one drawing - and it deliberately does not
 * touch an object that already exists.
 */
let preferredTextStyle = { ...DEFAULT_TEXT_STYLE };

export function currentDefaultTextStyle() {
  return { ...preferredTextStyle };
}

/*
 * ADOPT A STYLE AS THE DEFAULT FOR NEW TEXT.
 *
 * Only the fields the style model knows are taken, so a caller cannot smuggle
 * an editing artefact (a caret colour, a selection tint) into every future
 * object.
 */
export function setDefaultTextStyle(style = {}) {
  const known = noteTextStyle({ ...preferredTextStyle, ...style });

  preferredTextStyle = { ...known };

  return currentDefaultTextStyle();
}

/* Back to the built-in defaults, for a reset. */
export function resetDefaultTextStyle() {
  preferredTextStyle = { ...DEFAULT_TEXT_STYLE };

  return currentDefaultTextStyle();
}

/*
 * THE PIXELS A NOTE IS DRAWN AT.
 *
 * The size is a SCREEN size already, so the zoom is irrelevant to it: a 16 px
 * note is 16 px at 25% and at 400%. The parameter is kept because it is part of
 * this module's contract with its callers, and because a caller that still
 * wants to know the zoom has one place to say so - but it deliberately does not
 * reach the answer. Dark mode does not change it either: the glyph colour is
 * resolved separately by the canvas palette.
 */
export function noteFontPixels(style, zoom = 1) {
  void zoom;

  return Math.min(
    FONT_PX_MAX,
    Math.max(FONT_PX_MIN, noteTextStyle(style).fontSize),
  );
}

/* The same estimate the canvas lays the note out with, from the shared system. */
export function noteTextWidth(text, style, fontPixels) {
  const typography = noteTextStyle(style);
  const factor = typography.fontFamily === "Courier New" ? 0.61 : 0.62;

  return textWidthEstimate(text, fontPixels ?? typography.fontSize, {
    characterWidth: factor,
    bold: typography.bold,
  });
}

export { CANVAS_FONT_STACK };
