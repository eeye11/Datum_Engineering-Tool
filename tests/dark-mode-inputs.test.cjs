/*
 * ========================================================
 * DARK MODE INPUTS, AND THE PALETTE BENEATH EVERYTHING
 * ========================================================
 *
 * A dark interface with white fields in it is the single most common way a dark
 * theme is left unfinished, and it is the fault this pass exists to remove. So
 * these checks ask four questions of the real stylesheets:
 *
 *   1. IS ANY EDGE-EDITABLE FIELD LEFT WITH A HARDCODED LIGHT BACKGROUND? A
 *      form control is drawn by the BROWSER, and a rule that never sets its
 *      background leaves the browser's own white in place.
 *
 *   2. IS THE FOREGROUND SET WITH IT? Changing a background without the text
 *      colour is worse than leaving it white: the field LOOKS themed and the
 *      text cannot be read.
 *
 *   3. DOES `color-scheme` FOLLOW THE THEME? It is the only property that
 *      reaches the list of options inside a `<select>`, a date picker and a
 *      scrollbar - none of which any token can style.
 *
 *   4. IS THE DARK PALETTE FREE OF THE OLD BLUE-GREY? The theme before the Deep
 *      Teal & Ice palette was blue-grey (#202a30, #39454c, a #6fb4ff focus).
 *      The teal that replaced it is DELIBERATE and named, so the check is about
 *      the old values being gone rather than about "no blue anywhere".
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

const read = (name) => fs.readFileSync(path.join(styles, name), "utf8");

const tokens = read("tokens.css");
const editor = stylesheetSource("editor.css");
const shell = read("shell.css");
const base = read("base.css");

const interfaceCss = editor + shell + base;

console.log("\n  every editable field takes the theme's input colour\n");

/*
 * The one shared input treatment. Every field named here must carry it, and no
 * narrower rule may follow it with a light background.
 */
check(
  "there is ONE shared input treatment",
  /THE ONE INPUT TREATMENT/.test(editor),
  "a field themed in one panel and not another is the fault being fixed",
);

check(
  "and it reads the theme's input token for its background",
  /THE ONE INPUT TREATMENT[\s\S]{0,3000}?background:\s*var\(--datum-input\)/.test(
    editor,
  ),
);

check(
  "and sets the FOREGROUND with it, not only the background",
  /THE ONE INPUT TREATMENT[\s\S]{0,3000}?color:\s*var\(--datum-ink\)/.test(
    editor,
  ),
  "a dark field with dark text looks themed and cannot be read",
);

console.log("\n  no field is left with a hardcoded light background\n");

/*
 * A white background written literally on an input is the defect. Panels,
 * canvases and sheets are allowed to be light - they are paper, not fields.
 */
const literalWhiteOnField = [
  ...interfaceCss.matchAll(
    /([^{}]*(?:input|select|textarea|search)[^{}]*)\{([^}]*)\}/gi,
  ),
]
  .filter(([, , body]) =>
    /background(?:-color)?:\s*(?:#fff(?:fff)?|white)\b/i.test(body),
  )
  .map(([, selector]) => selector.trim().replace(/\s+/g, " "));

check(
  "no input carries a literal white background",
  literalWhiteOnField.length === 0,
  literalWhiteOnField.join(" | "),
);

/*
 * An input that never sets a background at all is the same fault by omission -
 * the browser's default is white. Every field must take a token.
 */
const themedFieldCount = [
  ...editor.matchAll(/background:\s*var\(--datum-input\)/g),
].length;

check(
  "a substantial set of fields take the input token",
  themedFieldCount >= 10,
  `${themedFieldCount} rules`,
);

console.log("\n  focus, placeholder and selection are designed too\n");

check(
  "placeholders use their own token, and are not left to the browser",
  /::placeholder[\s\S]{0,200}?color:\s*var\(--datum-placeholder\)/.test(editor),
  "a faint placeholder is a field whose purpose has to be guessed",
);

check(
  "the caret takes the accent rather than the browser default",
  /caret-color:\s*var\(--datum-green\)/.test(editor),
);

check(
  "selected text takes the accent rather than the browser's blue",
  /::selection[\s\S]{0,300}?background:\s*var\(--datum-green\)/.test(editor),
);

check(
  "and focus is VISIBLE, as a ring rather than a hairline",
  /:focus-visible[\s\S]{0,200}?outline:\s*2px solid var\(--datum-focus\)/.test(
    editor,
  ),
);

console.log("\n  `color-scheme` follows the theme\n");

/*
 * Without this the browser draws its OWN controls - the option list of a
 * `<select>`, a date picker, a scrollbar - in the palette of the operating
 * system rather than the one the interface is using.
 */
check(
  "the light theme declares a light colour-scheme",
  /:root\s*\{\s*color-scheme:\s*light/.test(tokens),
);

check(
  "the dark theme declares a dark colour-scheme",
  /\[data-theme="dark"\][\s\S]{0,200}?color-scheme:\s*dark/.test(tokens),
);

check(
  "and so does System Default",
  /prefers-color-scheme: dark[\s\S]{0,300}?color-scheme:\s*dark/.test(tokens),
  "a System Default user would otherwise get white native menus",
);

console.log("\n  the dark palette has no blue\n");

{
  const darkBlock = tokens.slice(
    tokens.indexOf('[data-theme="dark"]'),
    tokens.indexOf("@media (prefers-color-scheme: dark)"),
  );

  /*
   * The palette this replaced. Named rather than derived, because the check is
   * "the blue-grey theme is gone", not "nothing anywhere is blue" - a colour
   * could legitimately be blue for another reason.
   */
  const goneBlue = ["#202a30", "#182026", "#39454c", "#6fb4ff", "#263139"];

  const found = goneBlue.filter((hex) => darkBlock.includes(hex));

  check(
    "the old blue-grey surfaces and focus are gone",
    found.length === 0,
    found.join(", "),
  );

  check(
    "focus is the lifted ice-teal in the dark theme",
    /--datum-focus:\s*#4DD0C5/.test(darkBlock),
    darkBlock.match(/--datum-focus:[^;]+/)?.[0],
  );

  check(
    "and the page is the deep teal-charcoal, not a blue-black",
    /--datum-page:\s*#142426/.test(darkBlock),
    darkBlock.match(/--datum-page:[^;]+/)?.[0],
  );
}

console.log("\n  the light theme is warm, not blue-white\n");

{
  const lightBlock = tokens.slice(
    tokens.indexOf(":root {"),
    tokens.indexOf('[data-theme="dark"]'),
  );

  check(
    "the backdrop is the ice-mint",
    /--datum-page:\s*var\(--precision-slate-50\)/.test(lightBlock) &&
      /--precision-slate-50:\s*#F2F8F7/.test(lightBlock),
    lightBlock.match(/--precision-slate-50:[^;]+/)?.[0],
  );

  check(
    "the accent is the precision teal",
    /--datum-green:\s*#087E83/.test(lightBlock),
  );

  check(
    "and the ice-teal counterpoint is present",
    /--datum-gold:\s*#087E83/.test(lightBlock) &&
      /--datum-gold-tint:\s*var\(--precision-gold-100\)/.test(lightBlock),
  );
}

console.log("\n  and the DRAWING is still not themed\n");

/*
 * The one exception outside tokens.css is the LaTeX source pane, which is
 * conventionally dark in both themes. Nothing else may be hardcoded.
 */
const hardcoded = (css) => (css.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length;

check(
  "editor.css has no hardcoded colours at all",
  hardcoded(editor) === 0,
  String(hardcoded(editor)),
);

check(
  "base.css has none either",
  hardcoded(base) === 0,
  String(hardcoded(base)),
);

check(
  "shell.css keeps only the code editor's own colours",
  hardcoded(shell) === 2,
  `${hardcoded(shell)} found: ${shell.match(/#[0-9a-fA-F]{3,8}\b/g)?.join(", ")}`,
);

check(
  "and the canvas keeps its OWN colours, separate from the theme",
  /--datum-canvas:/.test(tokens) &&
    /--datum-canvas-ink:/.test(tokens),
  "a dark interface over a light sheet is a normal combination",
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
