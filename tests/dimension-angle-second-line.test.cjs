/*
 * ========================================================
 * SMART DIMENSION: A SECOND LINE AFTER THE FIRST IS AN ANGLE
 * ========================================================
 *
 * THE DEFECT: clicking one line with the Dimension tool jumped the tool straight
 * into PLACEMENT. The very next click was therefore read as "where to stand
 * the length dimension", never as a second reference - so a student could not
 * click a second line after the first to dimension the angle between them.
 * The angle path existed (`descriptorIsComplete` -> "angular") but was
 * unreachable from the click sequence.
 *
 * The fix is an ARMED stage: the first click previews its own measurement at
 * once but the tool keeps accepting references, and only a click that lands on
 * NO reference (or Enter) places it. These checks read the flow out of the
 * source, the way the other dimension tests do, because the interaction needs
 * a real pointer sequence to run.
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

const placement = fs.readFileSync(modulePath("dimension-placement.js"), "utf8");

console.log("\n  a first line is armed, not placed\n");

check(
  "the first measurable whole enters the ARMED stage",
  /armSingleMeasurement/.test(placement) &&
    /dimensionStage:\s*"armed"/.test(placement),
  "the single measurement previews, but is not committed",
);

check(
  "arming sets up a preview that follows the cursor",
  /dimensionStage:\s*"armed"[\s\S]{0,600}dimensionPlacement/.test(placement),
  "the armed measurement must be visible, not invisible",
);

console.log("\n  the second click adds a reference while armed\n");

check(
  "an armed tool routes a resolved reference to the second-reference path",
  /dimensionStage === "armed"[\s\S]{0,900}acceptSecondDimensionReference\(\s*\n\s*interaction\.dimensionFirstRef/.test(
    placement,
  ),
  "this is the step that was missing - the second line could never be picked",
);

check(
  "the second reference is the FIRST one's partner, not a fresh start",
  /acceptSecondDimensionReference\(\s*\n\s*interaction\.dimensionFirstRef/.test(
    placement,
  ),
  "an angle needs BOTH lines, so the first must be carried forward",
);

console.log("\n  a click on empty space places what is armed\n");

check(
  "an armed tool commits when the click resolves to no reference",
  /dimensionStage === "armed"[\s\S]{0,900}commitArmedMeasurement/.test(
    placement,
  ),
  "placement is the click that lands on nothing",
);

check(
  "commitArmedMeasurement goes through the ONE commit path",
  /function commitArmedMeasurement[\s\S]{0,900}commitDimension\(/.test(
    placement,
  ),
  "the value and the undo entry must be the shared ones",
);

console.log("\n  the angle path is still reachable and complete\n");

check(
  "two references that measure move into placement",
  /refs\.length === 2[\s\S]{0,900}descriptorIsComplete\(descriptor, refs\)/.test(
    placement,
  ),
);

check(
  "an angle between two lines is a complete measurement",
  /descriptor\.dimensionType === "angular"[\s\S]{0,60}return true/.test(
    placement,
  ),
  "two lines state an angle, so nothing else is left to pick",
);

console.log("\n  Enter still works, and still means 'use what I picked'\n");

check(
  "Enter commits an armed measurement as well as a selection",
  /dimensionStage === "selecting" \|\|[\s\S]{0,80}dimensionStage === "armed"[\s\S]{0,80}commitDimensionSelection/.test(
    fs.readFileSync(modulePath("selection.js"), "utf8"),
  ),
  "the deliberate workflow is kept, not replaced",
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
