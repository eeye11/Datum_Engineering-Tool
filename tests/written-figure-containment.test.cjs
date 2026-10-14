/*
 * ========================================================
 * A FIGURE IN THE WRITTEN SOLUTION STAYS IN ITS PANE
 * ========================================================
 *
 * THE DEFECT: pressing Update Output with a drawing reference in the LaTeX
 * source put the drawing over the whole page, with no way to dismiss it.
 *
 * It was NOT a modal, and nothing escaped into the document - measured, the
 * body still held only the header, the page and the script. The figure had
 * simply OVERFLOWED its container: it was sized by WIDTH alone
 * (`width: 100%; height: auto`), so its height followed the drawing's aspect
 * ratio with no ceiling, and a wide drawing in the 395px-tall Rendered Solution
 * pane came out taller than the pane and covered the workspace.
 *
 * This is the same class as the Open popup's preview escape: a replaced element
 * sized by one axis, in a container that cannot bound the other.
 *
 * The fix bounds it in BOTH directions, so the drawing is scaled down to fit and
 * never stretched.
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

/* The rule block for the frame, and for the SVG inside it. */
const frameRule = (() => {
  const match = css.match(/\.drawing-reference-frame \{[^}]*\}/);
  return match ? match[0] : "";
})();

const frameSvgRule = (() => {
  const match = css.match(/\.drawing-reference-frame svg \{[^}]*\}/);
  return match ? match[0] : "";
})();

console.log("\n  the figure is bounded by HEIGHT, not only width\n");

check(
  "the frame has a height ceiling",
  /max-height:\s*\d+vh/.test(frameRule),
  "without a ceiling the drawing is as tall as its aspect makes it",
);

check(
  "the frame can shrink rather than forcing the pane to grow",
  /min-height:\s*0/.test(frameRule),
);

check(
  "the frame clips, so nothing can be drawn outside it",
  /overflow:\s*hidden/.test(frameRule),
);

check(
  "the svg fits BOTH directions",
  /max-height:\s*\d+vh/.test(frameSvgRule) &&
    /max-width:\s*100%/.test(frameSvgRule),
  "one axis alone is what let a wide drawing overflow",
);

check(
  "the svg is NOT stretched to fill the frame",
  /object-fit:\s*contain/.test(frameSvgRule) &&
    !/width:\s*100%;\s*\n\s*height:\s*100%/.test(frameSvgRule),
  "a distorted drawing is worse than a smaller one",
);

console.log("\n  the LaTeX source is still what drives the figure\n");

{
  const written = fs.readFileSync(
    path.join(__dirname, "..", "src", "solution", "written-references.js"),
    "utf8",
  );

  check(
    "a figure is rendered from the referenced sheet",
    /renderReference\(/.test(written),
  );

  check(
    "and a figure that cannot be drawn is reported, not fatal",
    /drawing-reference-missing/.test(written) ||
      /try \{[\s\S]{0,200}appendFigure\(output, reference\)/.test(written),
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
