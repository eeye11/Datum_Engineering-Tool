/*
 * ========================================================
 * THE INTERFACE IS STYLED THROUGH TOKENS, IN BOTH THEMES
 * ========================================================
 *
 * A theme is only complete if EVERY interface surface goes through a token. A
 * single hardcoded colour is a surface that stays light in dark mode, and the
 * fault is invisible until somebody switches.
 *
 * So this asserts, on the real stylesheets:
 *
 *   1. NO hex literal remains in the interface stylesheet - every colour is a
 *      token reference, so the palette is decided in one file;
 *   2. every token the interface USES is DEFINED, in the light theme and again
 *      in the dark theme and in the system block - a token defined only for
 *      light would silently fall back to nothing when the theme flips;
 *   3. the dark theme is a designed palette, not an inversion: the surfaces are
 *      not pure black and the accent is not the light theme's dark teal;
 *   4. the DRAWING is not themed - the drawing's own colours live in the model,
 *      never in these stylesheets.
 *
 * THE PALETTE IS DEEP TEAL & ICE. The accent is a TEAL (#087E83 light, #4DD0C5
 * dark) - green and blue close together, so it reads cool rather than as a green
 * - and the surfaces are an ice-mint on the light theme and a deep teal-charcoal
 * on the dark one.
 */

const fs = require("fs");
const { stylesheetSource } = require("./helpers/source-path.cjs");
const path = require("path");

const { SOURCE_ROOT } = require("./helpers/source-path.cjs");

let pass = 0;
let fail = 0;

const check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`);
  }
};

const styles = path.join(SOURCE_ROOT, "styles");

const tokens = fs.readFileSync(path.join(styles, "tokens.css"), "utf8");
const editor = stylesheetSource("editor.css");

/*
 * THE ALIASES COUNT TOO.
 *
 * The interface also uses a set of `--cad-*` names, which are aliases declared
 * in `editor.css` and pointed at the `--datum-*` tokens. A name that resolves
 * to a token DOES follow the theme, so the two files are searched together -
 * checking only `tokens.css` would report correct aliases as missing.
 */

console.log("\n  every interface colour is a token\n");

const remainingEditor = editor.match(/#[0-9a-fA-F]{3,8}\b/g) || [];

check(
  "editor.css contains NO hex literals",
  remainingEditor.length === 0,
  remainingEditor.length
    ? `still hardcoded: ${[...new Set(remainingEditor)].join(", ")}`
    : "",
);

check(
  "so the palette is decided in tokens.css alone",
  /:root\s*\{/.test(tokens),
);

console.log("\n  every token the interface uses is DEFINED for both themes\n");

/* Tokens the interface refers to. */
const used = [
  ...new Set(
    [...editor.matchAll(/var\((--[a-z0-9-]+)\)/gi)].map((m) => m[1]),
  ),
];

const lightBlock = tokens.slice(
  tokens.indexOf(":root {"),
  tokens.indexOf('[data-theme="dark"]'),
);

/*
 * THE DARK BLOCK ENDS WHERE THE SYSTEM BLOCK BEGINS.
 *
 * Slicing dark to the END OF THE FILE would swallow the
 * `prefers-color-scheme` block that follows it - which defines the same names -
 * so a token missing from the explicit dark palette would be found in the system
 * block and reported as present. The two are checked separately and each must
 * stand on its own.
 */
const darkBlock = tokens.slice(
  tokens.indexOf('[data-theme="dark"]'),
  tokens.indexOf("@media (prefers-color-scheme: dark)"),
);

/*
 * A token is AVAILABLE if it is defined in the palette we are asking about, OR
 * if it is an alias that resolves to one. The `--cad-*` names are aliases, so
 * they are answered from `editor.css` rather than looked for in the theme blocks.
 */
const aliasFor = (name) => {
  const match = editor.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));

  return match ? match[1] : null;
};

const definedIn = (block, name) => {
  if (new RegExp(`${name}\\s*:`).test(block)) {
    return true;
  }

  const alias = aliasFor(name);

  /* An alias is fine when it is itself a token reference. */
  return Boolean(alias && /var\(--datum-/.test(alias));
};

const missingLight = used.filter((t) => !definedIn(lightBlock, t));
const missingDark = used.filter((t) => !definedIn(darkBlock, t));

check(
  "all of them are defined in the LIGHT palette",
  missingLight.length === 0,
  missingLight.join(", "),
);

check(
  "and all of them AGAIN in the dark palette",
  missingDark.length === 0,
  `missing from dark: ${missingDark.join(", ")}`,
);

check(
  "the interface really does use a substantial token set",
  used.length > 15,
  `${used.length} tokens`,
);

console.log("\n  the system block mirrors the dark palette\n");

/*
 * The `prefers-color-scheme` block must define the SAME names as the explicit
 * dark theme, or a user on System Default gets a partially dark interface.
 */
const systemBlock = tokens.slice(tokens.indexOf("@media (prefers-color-scheme: dark)"));

const missingSystem = used.filter((t) => !definedIn(systemBlock, t));

check(
  "System Default defines the same tokens as explicit dark",
  missingSystem.length === 0,
  `missing: ${missingSystem.join(", ")}`,
);

console.log("\n  the dark theme is DESIGNED, not inverted\n");

const darkValue = (name) => {
  const match = darkBlock.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  return match ? match[1].trim() : null;
};

/* The same reader for the light block, so the two can be compared. */
const lightValue = (name) => {
  const match = lightBlock.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  return match ? match[1].trim() : null;
};

check(
  "the dark surface is graphite, not pure black",
  darkValue("--datum-surface") !== "#000000" &&
    darkValue("--datum-surface") !== "#000",
  darkValue("--datum-surface"),
);

check(
  "and the dark panel is not pure black either",
  darkValue("--datum-panel") !== "#000000",
  darkValue("--datum-panel"),
);

check(
  "the dark ink is light, so text is readable",
  /^#[c-f]/i.test(darkValue("--datum-ink") || ""),
  darkValue("--datum-ink"),
);

/*
 * The accent must be LIGHTENED for dark, not reused: `#087E83` on a deep
 * teal-charcoal panel is nearly invisible.
 */
check(
  "the accent is lifted for the dark theme",
  darkValue("--datum-green") !== "#087E83",
  darkValue("--datum-green"),
);

/*
 * A TEAL is blue and green close together, both clearly above red. The check is
 * the SHAPE of the hue rather than a named family, so a future teal is still
 * pinned as a teal.
 */
const isTeal = (hex) => {
  const value = (hex || "#000000").replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);

  return g > r && b > r;
};

check(
  "and it is still a teal, so the identity survives",
  isTeal(darkValue("--datum-green")),
  darkValue("--datum-green"),
);

console.log("\n  the accent is ONE colour, and it is not pink\n");

check(
  "the light accent is a precision teal of the same family",
  (() => {
    if (isTeal(lightValue("--datum-green")) === false) {
      return false;
    }

    /*
     * AND DARK ENOUGH TO READ ON A LIGHT SURFACE. The light teal has to carry
     * white text and mark active tools, so it is a deep teal rather than a bright
     * one - the bright teal is the DARK theme's lifted accent.
     */
    const hex = (lightValue("--datum-green") || "").replace("#", "");
    const sum = (value) =>
      parseInt(value.slice(0, 2), 16) +
      parseInt(value.slice(2, 4), 16) +
      parseInt(value.slice(4, 6), 16);

    return sum(hex) < 500;
  })(),
  lightValue("--datum-green"),
  "the identity is precision teal; the exact hex is the specified palette",
);

check(
  "and the dark accent is a LIFTED teal of the same family",
  (() => {
    const light = (lightValue("--datum-green") || "").replace("#", "");
    const dark = (darkValue("--datum-green") || "").replace("#", "");

    const sum = (hex) =>
      parseInt(hex.slice(0, 2), 16) +
      parseInt(hex.slice(2, 4), 16) +
      parseInt(hex.slice(4, 6), 16);

    return sum(dark) > sum(light);
  })(),
  `${lightValue("--datum-green")} -> ${darkValue("--datum-green")}`,
  "a dark teal on the deep teal-charcoal is nearly invisible",
);

check(
  "there is no pink accent",
  !/#(ff[0-9a-f]{2}[0-9a-f]{2}ff|[ef][0-9a-f]c0d[0-9a-f])/i.test(tokens),
);

console.log("\n  the DRAWING is not themed by these stylesheets\n");

/*
 * The ENTITY's own stroke and fill come from the DOCUMENT and are written by
 * the renderer as attributes. These stylesheets must not give a renderer element
 * a themed `stroke` or `fill` - with ONE exception, and it is the right one:
 * SELECTION FEEDBACK is interface state, not content, and it is always scoped to
 * `.drawing-entity-selected`.
 *
 * Expressed as a rule about the SELECTOR rather than a list of the classes that
 * happen to exist today, so a rule added later is covered by the same test.
 */
const rendererRules = [
  ...editor.matchAll(/([^{}]*\.drawing-(?:entity|renderer)[^{}]*)\{([^}]*)\}/g),
];

const unthemedContent = rendererRules.filter(([, selector, body]) => {
  const setsPaint = /(?:^|[;\s])(fill|stroke)\s*:/i.test(body);

  return setsPaint && !/drawing-entity-selected/.test(selector);
});

check(
  "no renderer CONTENT is given a themed fill or stroke",
  unthemedContent.length === 0,
  unthemedContent.map(([, sel]) => sel.trim()).join(" | "),
);

check(
  "while selection feedback IS themed - it is interface state",
  /\.drawing-entity-selected[\s\S]{0,500}?var\(--datum-focus\)/.test(editor),
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
