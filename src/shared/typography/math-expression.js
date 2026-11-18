/*
 * ============================================================
 * A SMALL MATH EXPRESSION TYPESETTER
 * ============================================================
 *
 * A student writes engineering notation as text - `T_1`, `q''_{in}`,
 * `\dot{Q}`, `T_{s}^4` - and the DRAWING must show it as mathematics, never as
 * raw underscores and braces.
 *
 * This module is that translation, in ONE place. It does not render anything
 * itself; it returns a TREE of runs, and the canvas turns a run into `<tspan>`,
 * the source writer turns it into TeX. Sharing the parse is what keeps the
 * picture, the Features field and the Source tab from disagreeing about what
 * `T_{s,1}` means.
 *
 * WHAT IT UNDERSTANDS
 * -------------------
 *   T_1  T_{s,1}  T_\infty        a SUBSCRIPT - braces group, one char otherwise
 *   T^2  10^{-3}                  a SUPERSCRIPT, same grouping rule
 *   T_s^4                         both, in either order, after one base
 *   \alpha  \Omega  \infty        a Greek or symbol command
 *   \dot{Q}  \bar{T}  \hat{T}     an ACCENT over the next group
 *   \,  \;  \;                    a thin space
 *
 * A run is one of:
 *   { type: "text",  value }              ordinary characters, on the baseline
 *   { type: "sub",   value }              lowered, reduced
 *   { type: "sup",   value }              raised, reduced
 *   { type: "accent", accent, value }     a small mark ABOVE its value
 *
 * Every run's `value` is plain text, so a renderer never has to parse again.
 * A command it does not know is left as its own literal text (`\foo`), which is
 * honest: the student sees what they typed rather than losing it.
 */

/* The Greek letters and symbols a Heat Transfer notation needs, plus the rest. */
export const MATH_SYMBOLS = Object.freeze({
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ϵ",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  vartheta: "ϑ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "ϕ",
  varphi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
  infty: "∞",
  partial: "∂",
  nabla: "∇",
  cdot: "·",
  times: "×",
  pm: "±",
  leq: "≤",
  geq: "≥",
  neq: "≠",
  approx: "≈",
  propto: "∝",
  degree: "°",
  circ: "∘",
});

/* The accents: a command and the small mark drawn above its argument. */
export const MATH_ACCENTS = Object.freeze({
  dot: "\u0307",
  ddot: "\u0308",
  bar: "\u0304",
  hat: "\u0302",
  tilde: "\u0303",
  vec: "\u20D7",
});

/* A thin space, as a command. */
const SPACES = new Set([",", ";", ":", " "]);

/*
 * READ ONE GROUP after `_` or `^`: a braced group (which may nest), or one
 * character. Returns { value, next } where `next` is the index to resume at.
 */
function readGroup(source, index) {
  let cursor = index;

  while (source[cursor] === " ") cursor += 1;

  if (cursor >= source.length) {
    return { value: "", next: cursor };
  }

  if (source[cursor] === "{") {
    let depth = 0;
    let end = cursor;

    for (; end < source.length; end += 1) {
      if (source[end] === "{") depth += 1;
      else if (source[end] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }

    const inner = source.slice(cursor + 1, end);

    return { value: inner, next: end + 1 };
  }

  /* One command is one atom: `_\infty` takes the whole command. */
  if (source[cursor] === "\\") {
    const match = /^\\[a-zA-Z]+/.exec(source.slice(cursor));

    if (match) {
      return { value: match[0], next: cursor + match[0].length };
    }
  }

  return { value: source[cursor], next: cursor + 1 };
}

/* A command name to its character, or the command text itself when unknown. */
function symbolOf(command) {
  const name = command.slice(1);

  return MATH_SYMBOLS[name] ?? command;
}

/*
 * PARSE AN EXPRESSION INTO RUNS.
 *
 * The base text runs along until `_`, `^` or `\accent` attaches to it; a script
 * after a base becomes a `sub`/`sup` run NEXT TO that base, which is how the
 * renderers lay a script out - beside the glyph it modifies rather than over it.
 */
export function parseMathExpression(input) {
  const source = String(input ?? "");

  const runs = [];

  const pushText = (value) => {
    if (!value) return;

    const last = runs[runs.length - 1];

    if (last && last.type === "text") last.value += value;
    else runs.push({ type: "text", value });
  };

  let index = 0;

  while (index < source.length) {
    const character = source[index];

    /* A command: a symbol, an accent, or a space. */
    if (character === "\\") {
      const match = /^\\[a-zA-Z]+|^\\./.exec(source.slice(index));

      if (!match) {
        pushText(character);
        index += 1;
        continue;
      }

      const command = match[0];
      const name = command.slice(1);

      if (SPACES.has(name)) {
        pushText(" ");
        index += command.length;
        continue;
      }

      if (MATH_ACCENTS[name]) {
        const group = readGroup(source, index + command.length);
        const inner = parseMathExpression(group.value);

        runs.push({
          type: "accent",
          accent: MATH_ACCENTS[name],
          value: inner.map((run) => run.value).join(""),
        });

        index = group.next;
        continue;
      }

      pushText(symbolOf(command));
      index += command.length;
      continue;
    }

    /* A script attaches to whatever came before it. */
    if (character === "_" || character === "^") {
      const group = readGroup(source, index + 1);
      const inner = parseMathExpression(group.value);
      const value = inner.map((run) => run.value).join("");

      /*
       * A SCRIPT WITH NO BASE STILL RENDERS. `_1` on its own is a subscripted
       * blank, which is what the student typed; merging it into the preceding
       * text run would silently drop the mark.
       */
      runs.push({ type: character === "_" ? "sub" : "sup", value });

      index = group.next;
      continue;
    }

    /* Braces on the baseline group nothing here; their contents just run on. */
    if (character === "{" || character === "}") {
      index += 1;
      continue;
    }

    pushText(character);
    index += 1;
  }

  return runs;
}

/*
 * THE SAME EXPRESSION AS PLAIN TEXT.
 *
 * Used where markup cannot be rendered - a list row, a tooltip, a file name -
 * so `T_{s,1}` reads "Ts,1" rather than "T_{s,1}". Subscripts and superscripts
 * become their Unicode characters where one exists, so an index stays a real
 * subscript.
 */
const SUBSCRIPT_DIGITS = "₀₁₂₃₄₅₆₇₈₉";
const SUPERSCRIPT_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";

const SUBSCRIPT_MAP = {
  "+": "₊",
  "-": "₋",
  "=": "₌",
  "(": "₍",
  ")": "₎",
  a: "ₐ",
  e: "ₑ",
  h: "ₕ",
  i: "ᵢ",
  j: "ⱼ",
  k: "ₖ",
  l: "ₗ",
  m: "ₘ",
  n: "ₙ",
  o: "ₒ",
  p: "ₚ",
  r: "ᵣ",
  s: "ₛ",
  t: "ₜ",
  u: "ᵤ",
  v: "ᵥ",
  x: "ₓ",
};

const SUPERSCRIPT_MAP = {
  0: "⁰",
  1: "¹",
  2: "²",
  3: "³",
  4: "⁴",
  5: "⁵",
  6: "⁶",
  7: "⁷",
  8: "⁸",
  9: "⁹",
  "+": "⁺",
  "-": "⁻",
  "=": "⁼",
  "(": "⁽",
  ")": "⁾",
  n: "ⁿ",
  i: "ⁱ",
};

function toScript(value, map) {
  return String(value)
    .split("")
    .map((character, position) => {
      if (position < SUBSCRIPT_DIGITS.length && /\d/.test(character)) {
        return map === SUBSCRIPT_MAP
          ? SUBSCRIPT_DIGITS[Number(character)]
          : SUPERSCRIPT_DIGITS[Number(character)];
      }

      return map[character] ?? character;
    })
    .join("");
}

export function mathExpressionToPlainText(input) {
  return parseMathExpression(input)
    .map((run) => {
      if (run.type === "sub") return toScript(run.value, SUBSCRIPT_MAP);
      if (run.type === "sup") return toScript(run.value, SUPERSCRIPT_MAP);
      if (run.type === "accent") return run.value;

      return run.value;
    })
    .join("");
}

/* Whether an expression contains any markup a maths renderer must handle. */
export function hasMathMarkup(input) {
  return /[_^\\]/.test(String(input ?? ""));
}

const enggMathExpression = {
  MATH_SYMBOLS,
  MATH_ACCENTS,
  parseMathExpression,
  mathExpressionToPlainText,
  hasMathMarkup,
};

export default enggMathExpression;
