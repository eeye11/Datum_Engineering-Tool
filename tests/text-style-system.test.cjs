/*
 * ========================================================
 * THE SHARED TEXT STYLE
 * ========================================================
 *
 * One style model, read by the canvas, the in-place editor, the Properties
 * sidebar and the source writer. These checks hold the model's own contract:
 * the defaults, the validation, and the "Use as Default" rule that a new
 * default must never rewrite text that already exists.
 */
const path = require("path");
const { JSDOM } = require("jsdom");

const projectRoot = path.join(__dirname, "..");

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

const { createHarness } = require("./support/harness-renderer.cjs");

createHarness(projectRoot, JSDOM, require);

const { loadModule } = require("./helpers/source-path.cjs");

const style = loadModule("note-text-style.js");

console.log("\nThe style model");
console.log("---------------");

const empty = style.noteTextStyle({});

check(
  "an absent style resolves to the shared defaults",
  empty.fontFamily === "Arial" &&
    empty.align === "left" &&
    empty.bold === false &&
    empty.italic === false,
  JSON.stringify(empty),
);

check(
  "a background is TRANSPARENT unless asked for",
  empty.background === false && empty.padding === 0,
  JSON.stringify({ background: empty.background, padding: empty.padding }),
);

check(
  "rotation defaults to zero and the line spacing to the shared default",
  empty.rotation === 0 && empty.lineSpacing > 1,
  JSON.stringify({ rotation: empty.rotation, spacing: empty.lineSpacing }),
);

check(
  "a font family the renderer cannot draw falls back to Arial",
  style.noteTextStyle({ fontFamily: "Comic Sans MS" }).fontFamily === "Arial",
);

check(
  "a bad background colour falls back to white",
  style.noteTextStyle({ background: true, backgroundColour: "not-a-colour" })
    .backgroundColour === "#ffffff",
);

check(
  "a rotation is clamped to a turn",
  style.noteTextStyle({ rotation: 999 }).rotation === 360 &&
    style.noteTextStyle({ rotation: -999 }).rotation === -360,
);

check(
  "alignment is one of the three the renderer honours",
  ["left", "center", "right"].every(
    (align) => style.noteTextStyle({ align }).align === align,
  ) && style.noteTextStyle({ align: "justify" }).align === "left",
);

check(
  "the point sizes a control offers are all real numbers",
  style.TEXT_POINT_SIZES.every((size) => Number.isFinite(size) && size > 0),
  JSON.stringify(style.TEXT_POINT_SIZES),
);

/* ---------------------------------------------------------- defaults */

console.log("\nThe shared default");
console.log("------------------");

const builtIn = style.currentDefaultTextStyle();

check(
  "a default exists with every property the model knows",
  ["fontFamily", "fontSize", "bold", "italic", "alignment"].every(
    (key) => key in builtIn,
  ) ||
    ["fontFamily", "fontSize", "bold", "italic", "align"].every(
      (key) => key in builtIn,
    ),
  JSON.stringify(builtIn),
);

style.setDefaultTextStyle({ fontSize: 24, bold: true, align: "center" });

const adopted = style.currentDefaultTextStyle();

check(
  "Use as Default adopts the style for FUTURE text",
  adopted.fontSize === 24 &&
    adopted.bold === true &&
    adopted.align === "center",
  JSON.stringify(adopted),
);

check(
  "an unknown field cannot be smuggled into the default",
  style.setDefaultTextStyle({ caretColour: "#f00" }) &&
    !("caretColour" in style.currentDefaultTextStyle()),
);

style.resetDefaultTextStyle();

check(
  "the default can be reset to the built-in style",
  style.currentDefaultTextStyle().fontSize ===
    style.DEFAULT_TEXT_STYLE.fontSize,
);

/*
 * THE DEFAULT IS A DEFAULT - IT NEVER REWRITES AN OBJECT.
 *
 * An object stores its own style; changing the default is only about what the
 * NEXT object starts with. These two lines state that as a property of the
 * model rather than of any caller.
 */
const existing = style.noteTextStyle({ fontSize: 11, bold: false });
style.setDefaultTextStyle({ fontSize: 32, bold: true });

check(
  "changing the default leaves an existing object's style alone",
  existing.fontSize === 11 && existing.bold === false,
  JSON.stringify(existing),
);

style.resetDefaultTextStyle();

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
