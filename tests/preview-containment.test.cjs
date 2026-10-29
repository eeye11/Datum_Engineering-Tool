/*
 * ========================================================
 * A PREVIEW CANNOT ESCAPE ITS THUMBNAIL
 * ========================================================
 *
 * The Open popup injects a stored preview as an SVG STRING. That is what made
 * pressing Open put a full-size drawing on the page: the box had a fixed height
 * but the `<svg>` inside was a flex item on the default `display: inline`, and a
 * replaced element in that state keeps its own intrinsic `width="760"` - so it
 * drew at its own pixel size and burst out of a 54px square.
 *
 * Three rules have to hold together, and the CLIP is the one that actually
 * guarantees it: whatever dimensions a stored preview carries - including one
 * written by an older build before previews were fitted - it can only ever be
 * drawn INSIDE its box.
 */

const fs = require("fs");
const { stylesheetSource } = require("./helpers/source-path.cjs");
const path = require("path");

/*
 * The stylesheet, read by path - the source-path helper indexes `.js` modules
 * only, and a stylesheet is not one.
 */
const css = stylesheetSource("editor.css");

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

/* The rule block that governs a preview SVG, however it is laid out. */
const svgRule = (() => {
  const match = css.match(
    /\.datum-open-thumb svg,\s*\n\.datum-open-template-preview svg \{[^}]*\}/
  );

  return match ? match[0] : "";
})();

console.log("\n  the preview box clips\n");

check(
  "both preview boxes clip their contents",
  /\.datum-open-thumb,\s*\n\.datum-open-template-preview \{[^}]*overflow:\s*hidden/.test(
    css
  ),
  "without a clip, a wider preview is drawn outside its square",
);

check(
  "and the template box had a clip of its own",
  (css.match(/\.datum-open-template-preview\s*\{[^}]*overflow:\s*hidden/g) || [])
    .length >= 1,
);

console.log("\n  the svg takes the box's size, not its own\n");

check(
  "the preview svg is a BLOCK, so its intrinsic width does not win",
  /display:\s*block/.test(svgRule),
  "an inline replaced element keeps its width attribute",
);

check(
  "it is capped in BOTH directions",
  /max-width:\s*100%/.test(svgRule) && /max-height:\s*100%/.test(svgRule),
);

check(
  "and floored at zero so the flex parent is not stretched to fit it",
  /min-width:\s*0/.test(svgRule) && /min-height:\s*0/.test(svgRule),
);

check(
  "the preview never swallows clicks meant for the card",
  /pointer-events:\s*none/.test(svgRule),
);

console.log("\n  a preview is generated fitted in the first place\n");

check(
  "the fitted renderer sizes the output to the drawing's own aspect",
  /const aspect = spanX \/ spanY;/.test(
    fs.readFileSync(
      path.join(__dirname, "..", "src", "shared", "file", "document-export.js"),
      "utf8",
    ),
  ),
  "the clip is the guarantee; the fit is what makes it look right",
);

console.log("\n  the view switcher cannot render an enormous icon\n");

{
  const popup = fs.readFileSync(
    path.join(__dirname, "..", "src", "components", "layout", "toolbar", "open-popup.js"),
    "utf8",
  );

  check(
    "the view buttons draw PATHS, not Unicode glyphs",
    /function viewSwitcher[\s\S]{0,3000}button\.innerHTML = iconFor\(option\.id\)/.test(
      popup,
    ) &&
      /* The glyphs must not appear as CODE - only in the comment that explains
         why they were removed. */
      !/label: "\\u25a6"/.test(popup) &&
      !/label: "\\u2637"/.test(popup),
    "a font without the glyph substitutes one that can be many times larger",
  );

  check(
    "the icon svg carries a viewBox, so it scales rather than guessing",
    /iconFor = \(id\)[\s\S]{0,600}viewBox="0 0 16 16"/.test(popup),
  );

  check(
    "and its size is pinned in CSS, with a clip",
    /\.datum-open-view-button \{[\s\S]{0,600}overflow: hidden/.test(css) &&
      /\.datum-open-view-button svg \{[\s\S]{0,200}width: 12px/.test(css),
    "the control must not be able to grow whatever it is drawn with",
  );

  check(
    "both view icons are paths, not text",
    (popup.match(/<rect x=/g) || []).length >= 8,
    "one grid of four squares and one list of three rows",
  );
}

console.log("\n  the preview svg cannot fall back to its own size\n");

{
  /*
   * `height: 100%` only resolves when the PARENT has a definite height. In the
   * grid the thumbnail is a fixed-height block, so it worked; in the LIST the
   * box sits in a flex row whose height is auto, so the percentage resolved to
   * `auto` and the svg fell back to its own `viewBox` size - which put a
   * full-size drawing on the page the moment List was chosen.
   */
  check(
    "the preview boxes are positioning contexts",
    /\.datum-open-thumb,\s*\n\.datum-open-template-preview \{[^}]*position:\s*relative/.test(
      css,
    ),
    "an absolutely positioned child needs its containing block to be positioned",
  );

  check(
    "the preview svg is ABSOLUTELY positioned, so it is measured against the box",
    /position:\s*absolute/.test(svgRule) && /inset:\s*0/.test(svgRule),
    "a percentage height on an auto-height flex parent resolves to auto",
  );

  check(
    "and the list thumbnail is given an explicit size",
    /\.datum-open-recents \.datum-open-thumb \{[^}]*height:\s*34px[^}]*width:\s*46px/.test(
      css,
    ),
    "a definite box is what the absolute child fills",
  );
}

console.log("\n  the picture is not cut off by its own box\n");

{
  /*
   * A PREVIEW BOX IS SIZED BY ITS BORDER BOX.
   *
   * Nothing in the editor's stylesheets gives every element
   * `box-sizing: border-box`, so a `<span>` preview box was CONTENT-box: its
   * declared `width: 100%` plus a 1px border on each side came out 2px wider
   * than the grid cell, and the picture inside - `inset: 0`, so filling the
   * padding box - no longer lined up with the outline drawn around it. In the
   * list the box overflowed its column; in the grid it pushed the card past the
   * popup's last track. That is the "recent images are cut off" defect.
   */
  check(
    "both preview boxes size themselves by the border box",
    /\.datum-open-thumb,\s*\n\.datum-open-template-preview \{[^}]*box-sizing:\s*border-box/.test(
      css,
    ),
    "a content-box preview is 2px wider than the slot it sits in",
  );

  check(
    "and so does the thumbnail on its own",
    /\.datum-open-thumb \{[^}]*box-sizing:\s*border-box/.test(css),
    "the base rule is what the list square and the grid card both inherit",
  );

  check(
    "the grid track and the card may shrink to the column, not past it",
    /\.datum-open-recents-grid \{[^}]*min-width:\s*0/.test(css) &&
      /\.datum-open-recents-grid \.datum-open-recent \{[^}]*min-width:\s*0/.test(css),
    "a `1fr` track grows to fit a wide item and pushes the last card out of view",
  );

  check(
    "and the grid thumbnail is capped at its cell's width",
    /\.datum-open-recents-grid \.datum-open-thumb \{[^}]*max-width:\s*100%/.test(css),
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
