/*
 * ========================================================
 * THE DRAWING'S MEASUREMENT SCALE
 * ========================================================
 *
 * The contract this suite holds the coordinate system to:
 *
 *   1. One drawing unit is ONE MILLIMETRE, and that is stated once, in
 *      `drawing-units.js` - not re-derived in the ruler, the status bar or the
 *      source writer.
 *   2. The screen/USER relationship goes through the camera: at 100% zoom one
 *      millimetre is BASE_PIXELS_PER_UNIT (3.6) pixels, and zooming changes the
 *      pixels and NOTHING else.
 *   3. The unit the interface prints is `mm`, from that one place, so the
 *      status bar and the ruler cannot disagree.
 *   4. The source itself states the same conversion (`[x=1mm, y=1mm]` and the
 *      "one unit is 1 mm" header), which is what makes the claim true rather
 *      than a relabelling of pixels.
 *
 * A test that asserted only the ruler would let the coordinate system drift;
 * these checks pin the meaning of the numbers to the file that declares them.
 */

const fs = require("fs");
const { modulePath, loadModule } = require("./helpers/source-path.cjs");

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

const units = loadModule("drawing-units.js");
const state = loadModule("drawing-state.js").default;

console.log("\n  one drawing unit is one millimetre\n");

check(
  "the unit is declared as mm",
  units.DRAWING_UNIT === "mm",
  units.DRAWING_UNIT,
);

check(
  "and named in full for a tooltip or a report",
  units.DRAWING_UNIT_NAME === "millimetres",
  units.DRAWING_UNIT_NAME,
);

check(
  "the description says it is a coordinate unit, not a print scale",
  /1 drawing unit = 1 mm/.test(units.DRAWING_UNIT_DESCRIPTION) &&
    !/1:\d/.test(units.DRAWING_UNIT_DESCRIPTION),
  units.DRAWING_UNIT_DESCRIPTION,
);

console.log("\n  the pixels-per-millimetre ratio is the camera's\n");

check(
  "at 100% zoom one millimetre is BASE_PIXELS_PER_UNIT pixels",
  units.basePixelsPerUnit() === state.BASE_PIXELS_PER_UNIT &&
    units.pixelsPerUnit(1) === state.BASE_PIXELS_PER_UNIT,
  `${units.pixelsPerUnit(1)} vs ${state.BASE_PIXELS_PER_UNIT}`,
);

check(
  "zooming scales the pixels linearly",
  units.pixelsPerUnit(2) === state.BASE_PIXELS_PER_UNIT * 2 &&
    Math.abs(units.pixelsPerUnit(0.5) - state.BASE_PIXELS_PER_UNIT / 2) < 1e-12,
);

check(
  "a missing or nonsense zoom falls back to 100%, not to zero",
  units.pixelsPerUnit(NaN) === state.BASE_PIXELS_PER_UNIT &&
    units.pixelsPerUnit(0) === state.BASE_PIXELS_PER_UNIT,
);

check(
  "a screen span converts back to millimetres",
  Math.abs(units.screenPixelsToMm(360, 1) - 100) < 1e-12,
  String(units.screenPixelsToMm(360, 1)),
);

check(
  "and back again",
  Math.abs(units.mmToScreenPixels(100, 1) - 360) < 1e-12,
  String(units.mmToScreenPixels(100, 1)),
);

console.log("\n  a length is written as a readable number of mm\n");

check("a whole number has no decimal", units.formatMm(50) === "50");
check("a half is written to one place", units.formatMm(12.5) === "12.5");
check(
  "no machine precision leaks through",
  units.formatMm(1 / 3) === "0.3",
  units.formatMm(1 / 3),
);
check("negative zero reads as zero", units.formatMm(-0) === "0");
check(
  "the unit follows the number",
  units.formatMmWithUnit(75) === "75 mm",
  units.formatMmWithUnit(75),
);
check("an absent value writes nothing", units.formatMmWithUnit(null) === "");

console.log("\n  the source states the same conversion\n");

/*
 * THE CLAIM RESTS ON THE SOURCE, so the source is checked rather than trusted.
 * If the picture options ever changed to, say, centimetres, the ruler's "mm"
 * would become a quiet lie and this is the test that catches it.
 */
const sourceText = fs.readFileSync(modulePath("drawing-source.js"), "utf8");

check(
  "the drawing source declares one picture unit as one millimetre",
  /x=1mm/.test(sourceText) && /y=1mm/.test(sourceText),
  "expected [x=1mm, y=1mm] in the picture options",
);

/*
 * AND THE DOCUMENT REMEMBERS WHAT A UNIT MEANS. The header is the statement a
 * reopened file depends on, so it is checked beside the picture options.
 */
console.log("\n  and the document remembers what a unit means\n");

const latexDocument = fs.readFileSync(modulePath("latex-document.js"), "utf8");

check(
  "the saved source header says x right, y up, one unit = 1 mm",
  /on paper one unit is 1 mm/.test(latexDocument),
  "the header is the statement a reopened file depends on",
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
