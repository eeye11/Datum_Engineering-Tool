/*
 * ========================================================
 * THE TWO HIDE BUTTONS ARE A MATCHED PAIR
 * ========================================================
 *
 * Each panel has a Hide button, and each must sit on its panel's OUTER edge -
 * against the window, not against the canvas.
 *
 * THE BUG THIS PINS DOWN. The two rails were mirrored with `row-reverse`, which
 * reverses EVERYTHING rather than just placing the button last. Measured on a
 * 1280px window:
 *
 *     Tools     button x=21,    panel 43..222     outside-left   (right)
 *     Features  button x=1024,  panel 1046..1259  INSIDE-left    (wrong)
 *
 * Two controls doing the same job to two panels, and one of them was on the
 * wrong side - so they did not read as the same control at all.
 *
 * The rule is now stated ONCE: the button is always the outermost thing in its
 * rail. Each side says only which direction that is, and neither reverses the
 * whole row.
 */

const fs = require("fs");
const { stylesheetSource } = require("./helpers/source-path.cjs");
const path = require("path");

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

const css = stylesheetSource("editor.css");

const html = fs.readFileSync(
  path.join(__dirname, "..", "index.html"),
  "utf8",
);

console.log("\n  neither rail reverses its whole row\n");

check(
  "the right rail does NOT reverse its row",
  !/\.drawing-panel-rail-right\s*\{[^}]*flex-direction:\s*row-reverse/.test(
    css,
  ),
  "row-reverse reverses everything, which put the button on the INSIDE",
);

check(
  "both rails lay their contents out in the same direction",
  /\.drawing-panel-rail-left\s*\{[^}]*flex-direction:\s*row;/.test(css) &&
    /\.drawing-panel-rail-right\s*\{[^}]*flex-direction:\s*row;/.test(css),
  "one shared rule, and each side only says which edge is its outer one",
);

console.log("\n  the button is the OUTERMOST thing in its rail\n");

check(
  "the LEFT rail puts the button before the panel",
  /drawing-panel-rail-left[\s\S]{0,600}?drawingToolPanelToggle/.test(html) &&
    html.indexOf("drawingToolPanelToggle") <
      html.indexOf('id="drawingToolPanel"'),
  "the left panel's outer edge is the window's left",
);

check(
  "the RIGHT rail puts the button AFTER the panel",
  /drawing-panel-rail-right[\s\S]{0,400}drawing-inspector[\s\S]{0,600}drawing-panel-toggle/.test(
    html,
  ),
  "the right panel's outer edge is the window's right",
);

console.log("\n  both buttons are the same control\n");

check(
  "they share one class, so one rule styles both",
  (html.match(/class="drawing-panel-toggle"/g) || []).length === 2,
);

check(
  "each names what it hides, for the tooltip and the screen reader",
  /title="Hide tools"/.test(html) && /title="Hide features"/.test(html),
);

check(
  "and each is still wired to its own panel",
  /id="drawingToolPanelToggle"/.test(html) &&
    /aria-controls="drawingToolPanel"/.test(html) &&
    /id="drawingFeaturesPanelToggle"/.test(html) &&
    /aria-controls="drawingFeaturesPanel"/.test(html),
  "the placement changed; what each button hides must not have",
);

console.log("\n  the arrows point outwards, as a pair\n");

check(
  "the left arrow points left and the right arrow points right",
  /M10 3L5 8l5 5/.test(html) && /M6 3l5 5-5 5/.test(html),
  "each arrow says which way its panel will go",
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}