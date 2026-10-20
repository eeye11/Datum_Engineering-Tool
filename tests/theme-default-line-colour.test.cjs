/*
 * ========================================================
 * THE DEFAULT DRAWING LINE COLOUR FOLLOWS THE THEME
 * ========================================================
 *
 * Deep Teal & Ice gives each theme a default line colour that is legible against
 * the canvas it is drawn on:
 *
 *   LIGHT   #000000 - BLACK: ordinary drawing ink on white paper
 *   DARK    #E8F5F3 - an ice-white on the dark sheet
 *
 * The rules, and the ones this pins (a colour-only feature, §4):
 *
 *   1. a NEWLY created default-colour line takes the theme's colour;
 *   2. changing the theme does NOT recolour anything that already exists - the
 *      drawing is the student's work, not a property of the interface;
 *   3. an EXPLICIT colour is the student's own choice and is never replaced by
 *      the theme default, whether it is written onto a feature or stored as the
 *      sheet's default (`styleDefaults.strokeExplicit`);
 *   4. the interface ACCENT is a separate thing from the default line colour -
 *      teal highlight must not become the colour of every entity.
 *
 * Everything is loaded from the real source modules, in a real (JSDOM) document
 * where `matchMedia` can be told what the "operating system" prefers.
 */

const { JSDOM } = require("jsdom");

const { modulePath } = require("./helpers/source-path.cjs");

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

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "https://datum.test/",
});

global.window = dom.window;
global.document = dom.window.document;

const store = new Map();

global.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

global.window.localStorage = global.localStorage;

/* What the "operating system" prefers, which System Default resolves against. */
let osPrefersDark = false;

global.matchMedia = (query) => ({
  matches: osPrefersDark && /prefers-color-scheme:\s*dark/.test(query),
  media: query,
  addEventListener() {},
  removeEventListener() {},
});

const theme = require(modulePath("theme.js"));
const engg = require(modulePath("drawing-state.js")).default;

const root = global.document.documentElement;

console.log("\n  the theme names a default line colour for each palette\n");

check(
  "light is drawing black",
  theme.DEFAULT_LINE_COLOUR.light === "#000000",
  theme.DEFAULT_LINE_COLOUR.light,
);

check(
  "dark is the ice-white",
  theme.DEFAULT_LINE_COLOUR.dark === "#E8F5F3",
  theme.DEFAULT_LINE_COLOUR.dark,
);

check(
  "the default is NOT the interface accent - the two are separate",
  theme.DEFAULT_LINE_COLOUR.light !== "#087E83" &&
    theme.DEFAULT_LINE_COLOUR.dark !== "#4DD0C5",
  `${theme.DEFAULT_LINE_COLOUR.light} / ${theme.DEFAULT_LINE_COLOUR.dark}`,
);

console.log("\n  it resolves against the theme in force, including System\n");

theme.setThemePreference("light");
check(
  "an explicit light theme gives the light line",
  theme.defaultLineColour() === "#000000",
  theme.defaultLineColour(),
);

theme.setThemePreference("dark");
check(
  "an explicit dark theme gives the ice line",
  theme.defaultLineColour() === "#E8F5F3",
  theme.defaultLineColour(),
);

osPrefersDark = true;
theme.setThemePreference("system");
check(
  "System Default follows the OS when it prefers dark",
  theme.defaultLineColour() === "#E8F5F3",
  theme.defaultLineColour(),
);

osPrefersDark = false;
check(
  "and follows it back to light",
  theme.defaultLineColour() === "#000000",
  theme.defaultLineColour(),
);

console.log("\n  a new feature is born with the theme's line colour\n");

theme.setThemePreference("light");
engg.setThemeLineColour(theme.defaultLineColour());

{
  const line = engg.geometryFactories.line(
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  );

  check(
    "a light-theme line defaults to black",
    line.style.stroke === "#000000",
    line.style.stroke,
  );
}

theme.setThemePreference("dark");
engg.setThemeLineColour(theme.defaultLineColour());

{
  const line = engg.geometryFactories.line(
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  );

  check(
    "a dark-theme line defaults to #E8F5F3",
    line.style.stroke === "#E8F5F3",
    line.style.stroke,
  );
}

console.log("\n  an EXPLICIT colour is never replaced by the theme default\n");

{
  const chosen = engg.geometryFactories.line(
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { style: { stroke: "#C0392B" } },
  );

  check(
    "a feature created with a colour keeps it, even in the dark theme",
    chosen.style.stroke === "#C0392B",
    chosen.style.stroke,
  );
}

console.log("\n  changing the theme leaves existing geometry alone\n");

{
  theme.setThemePreference("light");
  engg.setThemeLineColour(theme.defaultLineColour());

  const existing = engg.geometryFactories.line(
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  );

  const state = engg.createDrawingState();
  engg.addObject(state, existing);

  check(
    "the line is the light colour to begin with",
    existing.style.stroke === "#000000",
    existing.style.stroke,
  );

  theme.setThemePreference("dark");
  engg.setThemeLineColour(theme.defaultLineColour());

  check(
    "switching to dark does NOT recolour the existing line",
    existing.style.stroke === "#000000",
    existing.style.stroke,
  );

  check(
    "and the object the SHEET holds is unchanged too",
    state.objects[0].style.stroke === "#000000",
    state.objects[0].style.stroke,
  );

  check(
    "while a line drawn AFTERWARDS is the dark colour",
    engg.geometryFactories.line(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ).style.stroke === "#E8F5F3",
  );
}

console.log("\n  the theme default applies to default-coloured entities only\n");

/*
 * `createStyle` is the one funnel every factory uses, so an entity that carries
 * its OWN colour - a force, a moment, a support drawn in a fixed colour - is
 * unaffected because it passes that colour in. A caller passing no colour is the
 * one case the theme default answers.
 */
{
  theme.setThemePreference("dark");
  engg.setThemeLineColour(theme.defaultLineColour());

  const plain = engg.createStyle();
  const specialised = engg.createStyle({ stroke: "#059669" });

  check(
    "a default style takes the theme colour",
    plain.stroke === "#E8F5F3",
    plain.stroke,
  );

  check(
    "a style that names its own colour keeps it",
    specialised.stroke === "#059669",
    specialised.stroke,
  );
}

console.log("\n  the initial state carries the theme default and the flag\n");

{
  theme.setThemePreference("light");
  engg.setThemeLineColour(theme.defaultLineColour());

  const state = engg.createDrawingState();

  check(
    "a fresh state's default stroke is the theme's",
    state.styleDefaults.stroke === "#000000",
    state.styleDefaults.stroke,
  );

  check(
    "and it is marked as NOT an explicit choice",
    state.styleDefaults.strokeExplicit === false,
    String(state.styleDefaults.strokeExplicit),
  );
}

console.log("\n  a LOADED sheet adopts the theme unless the student chose\n");

/*
 * `sheet-controller.adoptDefaultStroke` is the ONE place a sheet's stored default
 * is decided when it is opened. It is pure - it takes the defaults and returns
 * them - so it is exercised directly here, without a document or a panel.
 *
 * The important cases are the LEGACY ones: a file saved before `strokeExplicit`
 * existed has no flag, and its colour is judged by its VALUE. The old fixed
 * default was `#000000`, so that value means "no choice" and any other does not.
 */
const adopt = (() => {
  const fs = require("fs");
  const source = fs.readFileSync(
    require("./helpers/source-path.cjs").locate("sheet-controller.js"),
    "utf8",
  );
  const match = source.match(
    /export function adoptDefaultStroke\(styleDefaults = \{\}\) \{[\s\S]*?\n\}/,
  );

  const factory = new Function(
    "defaultLineColour",
    `${match[0].replace(/^export /, "")}; return adoptDefaultStroke;`,
  );

  return factory(theme.defaultLineColour);
})();

/*
 * The expected value is whatever the live resolver answers, so the check does not
 * hard-code a palette the way the theme is set at this point in the file.
 */
const liveDefault = theme.defaultLineColour();

check(
  "a sheet that never chose a colour takes the theme default",
  adopt({ stroke: "#000000", strokeExplicit: false }).stroke === liveDefault,
  `expected ${liveDefault}`,
);

check(
  "a LEGACY sheet with no flag and the old default does too",
  adopt({ stroke: "#000000" }).stroke === liveDefault,
  `#000000 was the old fixed default; expected ${liveDefault}`,
);

check(
  "a LEGACY sheet drawn in a real colour keeps it",
  adopt({ stroke: "#AA0000" }).stroke === "#AA0000",
  "a value that is not the old default is a student's choice",
);

check(
  "an EXPLICIT choice is kept even when it is black",
  adopt({ stroke: "#000000", strokeExplicit: true }).stroke === "#000000",
  "the flag, not the value, decides once it exists",
);

check(
  "and an explicit non-default colour is kept as well",
  adopt({ stroke: "#087E83", strokeExplicit: true }).stroke === "#087E83",
);

/*
 * Put the document back the way it was found, so a later suite sharing this
 * process is not affected by the theme this test happened to leave set.
 */
theme.setThemePreference("system");

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}

