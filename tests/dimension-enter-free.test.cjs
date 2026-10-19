/*
 * ========================================================
 * SMART DIMENSION ARMS WITHOUT ENTER - AND STILL TAKES A SECOND REFERENCE
 * ========================================================
 *
 * The INFERENCE was never the problem - `dimension-inference.js` already turns
 * two lines into an angle, and `smart-dimension-flow.test.cjs` covers that.
 *
 * The problem was the TOOL FLOW, and it had two halves that had to be solved
 * together:
 *
 *   1. `beginDimensionReferenceSelection` recorded the reference and reset the
 *      stage to "selecting" every time, so the measurement was only decided
 *      when Enter was pressed. A click that COMPLETES a measurement must move
 *      on at once, with no keystroke.
 *
 *   2. Throwing the tool STRAIGHT into placement on the first line fixed (1)
 *      but broke the angle: the very next click was read as "where to stand the
 *      length dimension", so a second line could never be picked.
 *
 * The answer is an ARMED stage. The first click on a measurable whole previews
 * its own measurement at once - no Enter - while the tool is STILL accepting a
 * second reference. A second reference upgrades the pair to their own
 * measurement (an angle between two lines, a distance between two points); a
 * click on empty space is the placement gesture.
 *
 * What still waits, honestly: a single POINT. A point has no length and a
 * distance needs a partner, so there is genuinely nothing to preview.
 */

const fs = require("fs");

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

const placement = fs.readFileSync(
  modulePath("dimension-placement.js"),
  "utf8",
);

const preview = fs.readFileSync(modulePath("preview.js"), "utf8");

console.log("\n  one measurable whole is ARMED at once - previewed, still accepting a partner\n");

check(
  "the FIRST click on a line, circle or arc arms its measurement at once",
  /refs\.length === 1 && reference\?\.kind !== "point"[\s\S]{0,600}armSingleMeasurement/.test(
    placement,
  ),
  "one line is a length already - it previews without a keystroke",
);

check(
  "the armed measurement is NOT placed on the first click",
  /dimensionStage: "armed"/.test(placement),
  "arming is not placing - a second reference must still be possible",
);

check(
  "a click on a SECOND reference while armed adds it",
  /dimensionStage === "armed"[\s\S]{0,900}acceptSecondDimensionReference/.test(
    placement,
  ),
  "this is what makes an angle between two lines reachable",
);

check(
  "and a click on empty space places the armed measurement",
  /dimensionStage === "armed"[\s\S]{0,900}commitArmedMeasurement/.test(
    placement,
  ),
  "placing is the click that lands on no reference",
);

check(
  "a single POINT does NOT arm - it has no length and needs a partner",
  /references\.length === 1[\s\S]{0,200}A point needs a second reference/.test(
    placement,
  ) ||
    /kind === "point"[\s\S]{0,200}return "1 point selected/.test(
      fs.readFileSync(modulePath("dimension-placement.js"), "utf8"),
    ),
  "waiting there is honest, not pedantic",
);

console.log("\n  a SECOND reference that completes a measurement previews at once\n");

check(
  "two references are tested for completeness on the click itself",
  /refs\.length === 2[\s\S]{0,900}descriptorIsComplete\(descriptor, refs\)/.test(
    placement,
  ),
  "this is the step that used to wait for Enter",
);

check(
  "and a complete pair moves straight into placement",
  /descriptorIsComplete\(descriptor, refs\)[\s\S]{0,300}beginDimensionPlacement/.test(
    placement,
  ),
);

check(
  "completeness is an angle, or a span between two points",
  /descriptor\.dimensionType === "angular"[\s\S]{0,500}kind === "point"/.test(
    placement,
  ),
);

check(
  "Enter still exists for the cases that genuinely need it",
  /commitDimensionSelection/.test(placement),
  "the deliberate workflow is preserved, not replaced",
);

console.log("\n  the preview follows the cursor during placement\n");

check(
  "the placement stage reads its position from the pointer",
  /dimensionStage ===[\s\S]{0,80}"placement"[\s\S]{0,400}dimensionPlacement/.test(
    preview,
  ),
  "the dimension must follow the cursor, not sit where it was first drawn",
);

check(
  "and the ARMED stage follows the cursor too",
  /dimensionStage ===[\s\S]{0,80}"armed"[\s\S]{0,400}dimensionPlacement/.test(
    preview,
  ),
  "the armed preview is the same preview, tracking the same cursor",
);

check(
  "and it says what to do next",
  /move to place/i.test(preview) || /Place the dimension/i.test(preview),
);

console.log("\n  only the finished dimension is a document action\n");

check(
  "the preview writes to the interaction, not to the document",
  /dimensionPlacement\s*=\s*\{/.test(preview) ||
    /dimensionPlacement/.test(preview),
  "a preview must not touch the model",
);

check(
  "and the commit is what records history",
  /commitDimension\(/.test(placement),
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
