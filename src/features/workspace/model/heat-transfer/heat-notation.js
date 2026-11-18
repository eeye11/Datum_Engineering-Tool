/*
 * ========================================================
 * HEAT TRANSFER: DEFAULT NOTATION AND ITS COUNTERS
 * ========================================================
 *
 * Every Heat Transfer tool that carries a label starts with a conventional
 * engineering notation, and successive objects of the same notation FAMILY are
 * numbered: T₁, T₂, T₃ …
 *
 * ========================================================
 * A FAMILY IS A PHYSICAL QUANTITY, NOT A TOOL
 * ========================================================
 *
 * Two tools may name the SAME quantity - a Heat Transfer Rate and a Heat Source
 * both express Q̇ - so they share ONE counter. Otherwise a sheet soon holds Q̇₁
 * beside Q̇₁, which is two different things wearing one symbol. The families:
 *
 *   Q   Q̇   Heat Transfer Rate, Heat Source, Heat Sink
 *   q   q″  Heat Flux, Prescribed Heat-Flux Boundary
 *   T   T   Thermal Circuit Node, Temperature Marker, Isotherm
 *   Ts  Tₛ  Fixed Temperature Boundary
 *   h   h   Convection Boundary
 *   e   ε   Radiation Boundary
 *   Rc  R꜀  Thermal Contact / Interface
 *   Rth Rₜₕ Thermal Resistance
 *   Cth Cₜₕ Thermal Capacitance
 *   CV  CV  Control Volume Boundary
 *
 * ========================================================
 * THE COUNTER IS PER DRAWING, AND IS READ FROM THE DRAWING
 * ========================================================
 *
 * The next index is NOT a module variable. It is computed from the labels
 * already on the sheet every time a default is asked for, which gives exactly
 * the behaviour the requirement asks for, with no bookkeeping to drift:
 *
 *   - three Temperature Markers          T₁ T₂ T₃
 *   - then a Thermal Circuit Node        T₄     (the same T family)
 *   - change T₂ to T∞                    the counter is unchanged - T∞ is not a
 *                                        plain T index, so the highest T index
 *                                        is still 3 and the next is T₄
 *   - delete T₃                          nothing is renumbered; the next is
 *                                        still chosen past the highest
 *   - open a saved drawing               the labels are on it, so numbering
 *                                        continues from them
 *   - a different drawing                a different sheet, so it starts at 1
 *
 * A user-edited label that no longer matches the family's pattern simply stops
 * contributing an index - it never resets the family, and it is never
 * overwritten.
 *
 * ========================================================
 * THE NOTATION IS REAL TEXT, NOT RAW TEX
 * ========================================================
 *
 * A default label is stored as PLAIN UNICODE with proper subscripts and Greek
 * letters ("T₁", "Rₜₕ₁", "Q̇₂", "q″₁"), so the canvas, the Features field and a
 * plain-text copy all read it directly. It is NOT stored as "\mathrm{T}_1":
 * the drawing must never show raw LaTeX. The mathematical text renderer then
 * renders those characters normally, exactly as it renders any other Greek or
 * subscript a student types.
 */

/*
 * THE FAMILIES.
 *
 *   key      the counter's identity
 *   base     what the plain label is when it is the first of its family - the
 *            index is appended directly (T + 1 = T₁), or after the base for a
 *            multi-character base (CV + 1 = CV₁)
 *   pattern  how an EXISTING label is recognised as belonging to the family,
 *            as a regular expression over the plain text
 *   digits   the subscript characters 0-9, so a counted index never falls back
 *            to a plain numeral
 *   suffix   subscripts that are part of the SYMBOL, not the index (Rₜₕ, so a
 *            counted one is Rₜₕ₁, not Rₜₕ followed by a stray)
 */
const SUBSCRIPTS = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];

/* A counted index as subscript characters: 12 -> "₁₂". */
export function subscriptIndex(index) {
  return String(Math.max(0, Math.round(Number(index) || 0)))
    .split("")
    .map((digit) => SUBSCRIPTS[Number(digit)] ?? digit)
    .join("");
}

/* The reverse: a run of subscript characters as a number, or 0. */
function readSubscript(text) {
  const digits = String(text || "")
    .split("")
    .map((character) => SUBSCRIPTS.indexOf(character))
    .filter((value) => value >= 0);

  if (!digits.length) {
    return 0;
  }

  return Number(digits.join(""));
}

/*
 * THE FAMILY TABLE.
 *
 * `symbol`   the stored symbol as PLAIN UNICODE with its own subscripts
 * `withIndex` how a counted label is spelled; the index goes after the symbol
 * `match`     the pattern an existing label must match to belong to the family
 *             (capture group 1 is the subscript index run)
 */
/*
 * THE NOTATION IS WRITTEN WITH MATHEMATICAL MARKUP.
 *
 * A default is `T_1`, `\dot{Q}_1`, `R_{th,1}` - NOT a pre-composed "T₁". That
 * matters for three reasons, and they are the same reason:
 *
 *   THE STUDENT CAN EDIT IT AS MATHEMATICS. Typing `T_\infty` beside a `T_1`
 *   uses one notation, and the same parser reads both.
 *   THE CANVAS TYPESETS IT, the Features field shows it, and the SOURCE writes
 *   it as TeX - all from the same string, so the three cannot disagree.
 *   A MULTI-CHARACTER SUBSCRIPT IS EXPRESSIBLE: `R_{th,1}` groups `th` and the
 *   index together, which no pre-composed string can do.
 *
 * The family's `match` therefore accepts BOTH forms: the markup a tool writes
 * (`T_1`) and the Unicode a student may paste (`T₁`), so counting works across a
 * document written either way.
 */
export const HEAT_NOTATION_FAMILIES = Object.freeze({
  Q: {
    symbol: "\\dot{Q}",
    label: (index) => `\\dot{Q}_${index}`,
    match: /^(?:\\dot\{Q\}|Q̇)((?:[₀-₉])+|_\d+)?$/u,
  },

  q: {
    symbol: "q''",
    label: (index) => `q''_${index}`,
    match: /^(?:q''|q″)((?:[₀-₉])+|_\d+)?$/u,
  },

  T: {
    symbol: "T",
    label: (index) => `T_${index}`,
    match: /^T((?:[₀-₉])+|_\d+)?$/u,
  },

  Ts: {
    symbol: "T_s",
    /* `T_{s,1}` - the s and the index share one grouped subscript. */
    label: (index) => `T_{s,${index}}`,
    /*
     * THREE SPELLINGS ARE THE FAMILY'S OWN:
     *   T_{s,1}   the grouped subscript the tool writes
     *   T_s1      a bare s with the index beside it
     *   Tₛ₁      the Unicode a paste may carry
     * Each alternative captures the INDEX on its own, so a counter reads the
     * number whatever form the label arrived in.
     */
    match:
      /^T(?:_\{s,?((?:[₀-₉])+|\d+)\}|_s(\d+)|ₛ((?:[₀-₉])+|\d+)?)$/u,
  },

  h: {
    symbol: "h",
    label: (index) => `h_${index}`,
    match: /^h((?:[₀-₉])+|_\d+)?$/u,
  },

  e: {
    symbol: "\\varepsilon",
    label: (index) => `\\varepsilon_${index}`,
    match: /^(?:\\varepsilon|ε)((?:[₀-₉])+|_\d+)?$/u,
  },

  Rc: {
    symbol: "R_c",
    label: (index) => `R_{c,${index}}`,
    match:
      /^R(?:_\{c,?((?:[₀-₉])+|\d+)\}|_c(\d+)|꜀((?:[₀-₉])+|\d+)?)$/u,
  },

  Rth: {
    symbol: "R_{th}",
    label: (index) => `R_{th,${index}}`,
    match:
      /^R(?:_\{th,?((?:[₀-₉])+|\d+)\}|_th(\d+)|ₜₕ((?:[₀-₉])+|\d+)?)$/u,
  },

  Cth: {
    symbol: "C_{th}",
    label: (index) => `C_{th,${index}}`,
    match:
      /^C(?:_\{th,?((?:[₀-₉])+|\d+)\}|_th(\d+)|ₜₕ((?:[₀-₉])+|\d+)?)$/u,
  },

  CV: {
    symbol: "CV",
    label: (index) => `CV_${index}`,
    match: /^CV((?:[₀-₉])+|_\d+)?$/u,
  },
});

/*
 * WHICH FAMILY EACH TOOL USES.
 *
 * Keyed by the STORED TYPE and, where the tool is a dropdown variant, its
 * variant - so a Heat Transfer Rate and a Heat Flux, which share the
 * `thermal-arrow` type, land in different families. A tool absent from this
 * table carries NO automatic label (a Wall / Slab, a Path, a Region), which is
 * the requirement's explicit list of tools that communicate themselves by
 * their geometry.
 */
export const HEAT_LABEL_FAMILY = Object.freeze({
  /* stored type                    variant                family */
  "thermal-arrow": {
    "heat-rate": "Q",
    "heat-flux": "q",
  },

  "thermal-boundary": {
    "fixed-temperature": "Ts",
    convection: "h",
    radiation: "e",
    /* An insulation symbol is its own mark; q″ = 0 is added separately. */
    adiabatic: null,
  },

  "thermal-contact": { "*": "Rc" },
  "heat-source-sink": { source: "Q", sink: "Q" },
  "thermal-circuit-node": { "*": "T" },
  "thermal-circuit-element": { resistance: "Rth", capacitance: "Cth" },
  "temperature-marker": { "*": "T" },
  isotherm: { "*": "T" },
  "control-volume": { "*": "CV" },
});

/* The family a tool uses, or null when it carries no automatic label. */
export function heatLabelFamily(type, variant) {
  const entry = HEAT_LABEL_FAMILY[type];

  if (!entry) {
    return null;
  }

  const key = entry[variant] !== undefined ? entry[variant] : entry["*"];

  return key && HEAT_NOTATION_FAMILIES[key] ? key : null;
}

/*
 * THE NEXT INDEX FOR A FAMILY, READ FROM THE LABELS ALREADY ON THE SHEET.
 *
 * Only labels that MATCH the family's pattern contribute an index, so a label
 * the student has rewritten (T∞, T_hot) neither advances the count nor resets
 * it. The answer is one past the HIGHEST index found, so deleting an object
 * leaves every other name alone and the next index is never reused.
 */
export function nextHeatNotationIndex(familyKey, objects = []) {
  const family = HEAT_NOTATION_FAMILIES[familyKey];

  if (!family) {
    return 1;
  }

  let highest = 0;

  (Array.isArray(objects) ? objects : []).forEach((object) => {
    const text = String(object?.label ?? object?.name ?? "");

    const match = family.match.exec(text);

    if (!match) {
      return;
    }

    /*
     * THE INDEX, in either form the notation allows: the MARKUP a tool writes
     * (`_3`, `_?3` from a grouped subscript) or the UNICODE a paste may carry
     * (`₃`). A bare family symbol counts as its first index.
     */
    /*
     * THE INDEX MAY BE IN ANY CAPTURE GROUP, because a family recognises more
     * than one spelling (`T_{s,1}`, `T_s1`, `Tₛ₁`). The first group holding a
     * digit run or subscripts is the index; none at all means the bare symbol,
     * which is its first.
     */
    const captured = match.slice(1).find(Boolean) || "";

    const index = captured
      ? (() => {
          const plain = /(\d+)/.exec(captured);

          return plain ? Number(plain[1]) : readSubscript(captured);
        })()
      : 1;

    if (index > highest) {
      highest = index;
    }
  });

  return highest + 1;
}

/* The default label for a family, at the next free index. */
export function defaultHeatNotation(familyKey, objects = []) {
  const family = HEAT_NOTATION_FAMILIES[familyKey];

  if (!family) {
    return "";
  }

  return family.label(nextHeatNotationIndex(familyKey, objects));
}

/*
 * WHETHER A LABEL IS STILL THE FAMILY'S OWN GENERATED NOTATION.
 *
 * Used to decide whether a default may be replaced without disturbing a label
 * the student has taken over. A label that matches its family pattern is
 * generated; anything else is the student's.
 */
export function isGeneratedHeatNotation(familyKey, text) {
  const family = HEAT_NOTATION_FAMILIES[familyKey];

  return Boolean(family && family.match.test(String(text ?? "")));
}

const enggHeatNotation = {
  HEAT_NOTATION_FAMILIES,
  HEAT_LABEL_FAMILY,
  subscriptIndex,
  heatLabelFamily,
  nextHeatNotationIndex,
  defaultHeatNotation,
  isGeneratedHeatNotation,
};

export default enggHeatNotation;
