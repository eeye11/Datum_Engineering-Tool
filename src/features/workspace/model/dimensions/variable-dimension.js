/*
 * ========================================================
 * THE VARIABLE DIMENSION
 * ========================================================
 *
 * A dimension STATES a measured quantity. A Variable Dimension NAMES an unknown
 * one:
 *
 *     Smart Dimension          Variable Dimension
 *     ───────────────          ──────────────────
 *     500 mm                   x
 *     25 mm                    L
 *     50°                      θ
 *     Ø100 mm                  R
 *
 * That difference is the whole reason this is a separate feature rather than a
 * differently-styled dimension. A dimension MEASURES - the number comes from the
 * geometry and changes when the geometry does. A variable is SYMBOLIC - the
 * student writes `x` and it means "the unknown", and nothing about the drawing
 * can compute it or should try to.
 *
 * WHY IT IS NOT A DIMENSION WITH AN EMPTY VALUE
 * ---------------------------------------------
 * A measured dimension with no measurement is a broken dimension: the value is
 * unknown because something failed. A variable's value is unknown ON PURPOSE, and
 * that is a complete, correct state. Rendering one as `0` or `?` - which is what
 * happens when a symbolic quantity is pushed through a numeric field - turns the
 * student's own statement into an error message.
 *
 * WHAT IT SHARES WITH A DIMENSION
 * -------------------------------
 * Everything except the value. It attaches to the same geometry through the same
 * reference kinds, sits at a placement the student chose, is drawn by the same
 * renderer in the same style, persists in the same file, and is selected and
 * moved in the same way. A variable is an engineering statement about the
 * drawing, not a note beside it, so it belongs to the drawing's own geometry
 * model rather than to the written side.
 */
import enggMeasurement from "../../../../shared/geometry/measurement-core.js";

/*
 * The default symbol a new variable is created with.
 *
 * `x` rather than nothing: a variable with no symbol would be an annotation with
 * no text, which is a thing the student cannot see, select or reason about. They
 * change it to whatever their problem uses.
 */
const DEFAULT_SYMBOL = "x";

/*
 * The symbols a variable most often carries, offered as the panel's choices.
 *
 * A SHORT LIST, and deliberately not exhaustive. These are the quantities an
 * assignment actually names; a student needing something else types it. The list
 * is here to save typing the common case, not to constrain what a variable can
 * be called.
 */
const COMMON_SYMBOLS = [
  "x",
  "y",
  "z",
  "L",
  "W",
  "H",
  "R",
  "r",
  "θ",
  "α",
  "β",
  "F",
  "P",
  "M",
  "d",
  "t"
];

function newVariableId() {
  const random =
    typeof globalThis.crypto === "object" &&
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(16).slice(2);

  return `variable-${random.slice(0, 8)}`;
}

/*
 * Build a Variable Dimension.
 *
 *   refs       one or two references, exactly as a dimension takes
 *   symbol     the name the student gives the unknown
 *   placement  where it sits, in drawing units
 *   style      overrides from the document defaults
 *
 * The reference kinds are the measurement core's own, so a variable can attach
 * to the same anchors a dimension attaches to - a point, an edge, the span
 * between two features. Attaching is what lets a variable sit BESIDE the thing it
 * names rather than floating free.
 */
function createVariableDimension({
  refs,
  symbol,
  unknown,
  placement,
  style = {},
  name,
} = {}) {
  const normalisedRefs = enggMeasurement.normaliseReferences
    ? enggMeasurement.normaliseReferences(refs)
    : Array.isArray(refs)
      ? refs
      : [];

  return {
    id: newVariableId(),
    name: name || "Variable Dimension",
    type: "variable-dimension",

    /*
     * WHO and WHAT this variable is about.
     *
     * The same shape a dimension uses, read by the same code, so a variable
     * follows its geometry when the geometry moves - which is the difference
     * between naming a length and writing a note near one.
     */
    sourceRefs: normalisedRefs,

    /*
     * THE SYMBOL IS THE VALUE.
     *
     * There is no number and no measurement. `x` is what this feature states,
     * and it is stored as the student typed it - including an empty string,
     * which is the state "named but not yet written".
     */
    symbol:
      symbol === undefined || symbol === null
        ? DEFAULT_SYMBOL
        : String(symbol),

    /*
     * WHETHER THE STUDENT SAID "NOT KNOWN".
     *
     * The third of the three states a variable can be in. It is stored rather
     * than inferred from an empty symbol, because "the student was asked and
     * answered unknown" and "nothing has been written yet" are different
     * statements and the sheet prints them differently - see `variableText`.
     */
    unknown: unknown === true,

    /*
     * A free label, like a dimension's: an override written alongside the
     * symbol rather than instead of it. Kept because a dimension has one and a
     * variable is drawn by the same panel vocabulary.
     */
    label: null,

    placement: {
      x: Number(placement?.x) || 0,
      y: Number(placement?.y) || 0
    },

    orientation: "auto",

    style: {
      fontSize: 12,
      ...style
    }
  };
}

/*
 * What a variable DISPLAYS.
 *
 * A SYMBOL, an "Unknown" marker, or nothing - and the three are DIFFERENT
 * STATES rather than one empty box:
 *
 *   symbol = "L/2"     what the student wrote
 *   unknown = true     the student was asked and said "not known"
 *   symbol = ""        named but not yet written - the state a new one starts in
 *
 * A unit would be a claim the student has not made - an unknown length is not
 * "x mm" until they say so - and a number would be a lie, so neither appears.
 */
function variableText(variable) {
  if (!variable) {
    return "";
  }

  const symbol = String(variable.symbol ?? "");

  /*
   * AN EXPLICIT UNKNOWN OUTRANKS AN EMPTY SYMBOL. A student who was asked and
   * answered "unknown" has made a statement; one who has not written anything
   * yet has not. Showing the same blank for both would lose that distinction,
   * and it is the distinction the Features panel and the sheet report.
   */
  if (!symbol && variable.unknown === true) {
    return "Unknown";
  }

  return symbol;
}

const enggVariableDimension = {
  COMMON_SYMBOLS,
  DEFAULT_SYMBOL,
  createVariableDimension,
  variableText
};

export default enggVariableDimension;
