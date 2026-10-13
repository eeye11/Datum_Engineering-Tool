/* eslint-disable no-console */
const { controllerSource, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * ========================================================
 * RELATIVE TO IS A MEASUREMENT IN BOTH DIRECTIONS
 * ========================================================
 *
 * `Relative To` says how far a child sits from the parent it belongs to, and it
 * is PRINTED in millimetres, because the panel prints every physical quantity
 * that way.
 *
 * It has to be READ and WRITTEN under the same conversion. Reading it through
 * the sheet's Universal Length Scale while writing it straight into world
 * coordinates would place the child somewhere the number on screen never
 * described - and the row would stop being the measurement it claims to let you
 * edit. On a sheet calibrated to anything but 1:1 the error is large and
 * immediate; on an uncalibrated sheet it hides, which is why it survived.
 *
 * So the rule this file holds is narrow and checkable:
 *
 *     What the panel prints is exactly what the panel accepts.
 *
 * It is asserted at source level, between markers that delimit the relative
 * branch of the writer, because a same-named conversion elsewhere in a
 * 21k-line file must not be able to satisfy it.
 */
const fs = require("fs");
const path = require("path");

const code = controllerSource();

let pass = 0;
let fail = 0;

const check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(
      `  FAIL ${name}${detail ? `\n       ${detail}` : ""}`,
    );
  }
};

/* THE SOURCE BETWEEN TWO MARKERS. */
const section = (startMarker, endMarker) => {
  const start = code.indexOf(startMarker);

  if (start < 0) {
    return "";
  }

  const end = code.indexOf(endMarker, start + startMarker.length);

  return code.slice(start, end < 0 ? undefined : end);
};

console.log("\n  Relative To is written in the units it is read in\n");

/* The writer itself, so the assertions below cannot be satisfied elsewhere. */
const writer = section(
  "function updateFeatureProperty(object, key, value, typedUnit)",
  "\nfunction syncStyleControls() {",
);

check("the feature-property writer is found", writer.length > 0);

/*
 * The relative branch: everything from where a `relative.x` / `relative.y` key
 * is recognised to where the branch gives up.
 */
const relativeBranch = section(
  "if (relative) {",
  "\n    if (key === \"start x\")",
);

check("the relative branch is found", relativeBranch.length > 0);

/*
 * IT CONVERTS THROUGH THE SHEET'S OWN SCALE.
 *
 * `fromEngineering` is the same conversion the creation popup and the Length
 * row use, so a relative offset cannot mean millimetres in one place and world
 * units in another.
 */
check(
  "a relative offset is converted from engineering units before it is stored",
  /fromEngineering\(\s*drawingState,\s*value,\s*['"]mm['"]\s*\)/.test(
    relativeBranch
  ) || /worldLengthInDisplayUnits\(object, value\)/.test(relativeBranch),
  "no millimetre conversion found in the relative branch"
);

/*
 * AND BOTH WRITES USE THE CONVERTED VALUE.
 *
 * A conversion that is computed and then not used is the same defect in a new
 * coat: the branch would contain the right call and still store the raw number.
 */
check(
  "the span-carrying write uses the converted value",
  /axis === "x"\s*\?\s*worldValue\s*-\s*\(g\.start\.x - origin\.x\)/.test(
    relativeBranch
  ) &&
    /axis === "y"\s*\?\s*worldValue\s*-\s*\(g\.start\.y - origin\.y\)/.test(
      relativeBranch
    ),
  "the start/end shift still uses the unconverted value"
);

check(
  "the position write uses the converted value",
  /g\.position\.x = origin\.x \+ worldValue/.test(relativeBranch) &&
    /g\.position\.y = origin\.y \+ worldValue/.test(relativeBranch),
  "a position write still uses the unconverted value"
);

/*
 * AND THE RAW TYPED NUMBER APPEARS NOWHERE ELSE IN THE BRANCH.
 *
 * This is the catch-all. If `value` - the millimetres the panel printed - were
 * still written into geometry anywhere in here, the conversions above would be
 * decoration.
 */
const rawWrites = relativeBranch.match(
  /(origin\.[xy]\s*[+-]\s*value|value\s*-\s*\(g\.(start|position)\.[xy]\s*-\s*origin\.[xy]\))/g,
);

check(
  "the unconverted millimetre value is never written into geometry",
  rawWrites === null,
  rawWrites ? `found: ${rawWrites.join(", ")}` : ""
);

/*
 * THE SAME CONVERSION THE READER USES.
 *
 * The reader prints through `mmOf`, the module-scope conversion over the sheet
 * scale. Confirming it still exists pins the two halves together: if the reader
 * were changed to something else this test should fail too, rather than
 * quietly keep approving a pair that no longer matches.
 */
check(
  "the reader still prints through the module-scope mmOf conversion",
  /function mmOf\(worldLength\)/.test(code) &&
    /enggDimensions\?\.toEngineering/.test(
      section("function mmOf(worldLength)", "\nlet featurePanelView"),
    ),
);

/* ============================================================
 * AND THE SECOND WRITER, WHICH IS A DIFFERENT KIND OF RELATIVE
 * ============================================================ */

console.log("\n  Along Body is written in the units it is read in\n");

/*
 * "Along Body" and "Relative To" are two rows with two writers.
 *
 * "Relative To" is an offset from the parent's origin in x or y; "Along Body"
 * is a STATION - one distance measured along the parent's own axis - and it is
 * resolved by projecting onto that axis. They are not two spellings of one
 * value: the first is a component, the second is a distance along the member.
 *
 * So the station writer needs its own conversion, and it was missed when the
 * offset writer was fixed. It reads millimetres and projects them in world
 * units, which put the child at a distance the displayed number never
 * described - and because the fault cancels exactly on an uncalibrated sheet,
 * a student drawing their first support never sees it happen.
 */
const stationWriter = section(
  "A CHILD'S `relative.x` IS ITS STATION",
  "\n        if (\n            key === 'magnitude'",
);

check("the station writer is found", stationWriter.length > 0);

check(
  "a station is converted from engineering units before it is projected",
  /fromEngineering\(\s*drawingState,\s*value,\s*['"]mm['"]\s*\)/.test(
    stationWriter,
  ) || /worldLengthInDisplayUnits\(object, value\)/.test(stationWriter),
  "no millimetre conversion found before pointAtStation",
);

/*
 * THE RAW NUMBER MUST NOT REACH THE PROJECTION.
 *
 * `pointAtStation` works in world units, so handing it the millimetres the
 * panel printed is the defect itself. This is the assertion that would have
 * caught the miss.
 */
check(
  "the unconverted value is never projected onto the parent's axis",
  !/pointAtStation\(\s*parent\s*,\s*value\s*\)/.test(stationWriter),
  "pointAtStation is still being handed the raw panel value",
);

check(
  "the converted station is what gets projected",
  /pointAtStation\(\s*parent\s*,\s*station\s*\)/.test(stationWriter),
);

/*
 * A PARENTLESS CHILD IS AN ABSOLUTE POSITION, NOT A LENGTH.
 *
 * A force placed on empty canvas has no axis to measure along. Its value is a
 * coordinate in world units and must stay untouched by a length conversion -
 * converting it would move a correctly-placed force the first time the sheet
 * was calibrated.
 */
check(
  "a child with no parent keeps its absolute world position",
  /target\.x = value;|target\.x = worldLengthInDisplayUnits\(object, value\);/.test(
    stationWriter,
  ),
  "the parentless branch no longer writes the absolute value",
);

/* ============================================================
 * AND THE THIRD CASE, WHICH WAS A READER NOT A WRITER
 * ============================================================ */

console.log("\n  a load's Start and End are lengths, and say so\n");

/*
 * A LOAD'S START AND END ARE STATIONS ON THE SAME AXIS.
 *
 * This is the third place the same measurement appears, and it was broken in
 * the opposite direction to the other two: the writer was already correct, and
 * the READER was wrong.
 *
 * That asymmetry is why it needs stating rather than a blanket rule. `Start` and
 * `End` hand the raw value to pointAtStation, which projects in world units -
 * correct. But the panel printed `stationOf(...)` unconverted while tagging it
 * "mm", so the two halves disagreed about units while agreeing about numbers.
 *
 * The obvious fix - convert on write, as with "Along Body" - would have made
 * the pair agree numerically and still disagreed, just differently. Converting
 * the reader is the only change that makes the label true.
 */
const loadRows = section(
  'if (\n            object.type === "load" ||',
  "\n    const anchor = relativeChildAnchor(",
);

check("the load station rows are found", loadRows.length > 0);

check(
  "a load's Start is printed as a physical length",
  /"start\.x",\s*mmOf\(stationOf\(geometry\.start, parent\)\)\.value/.test(
    loadRows,
  ),
  "Start is still printed as a raw world-unit station",
);

check(
  "a load's End is printed as a physical length",
  /"end\.x",\s*mmOf\(stationOf\(geometry\.end, parent\)\)\.value/.test(
    loadRows,
  ),
  "End is still printed as a raw world-unit station",
);

/*
 * AND THE WRITER MUST STAY UNCONVERTED.
 *
 * This is the assertion that stops a later reader of this test "fixing" the
 * writer for symmetry. It would break every load on a calibrated sheet, and it
 * would do so silently, because the failure looks like a load that is in the
 * wrong place rather than an obvious error.
 */
const loadWriter = section(
  "A LOAD'S X IS A STATION, NOT A COORDINATE",
  "A CHILD'S `relative.x` IS ITS STATION",
);

check("the load station writer is found", loadWriter.length > 0);

check(
  "the load writer converts the displayed length back before projecting",
  /pointAtStation\(\s*parent,\s*worldLengthInDisplayUnits\(object, value\)\s*\)/.test(
    loadWriter,
  ) ||
    (/pointAtStation\(\s*parent,\s*value\s*\)/.test(loadWriter) &&
      !/fromEngineering/.test(loadWriter)),
  "the load writer must undo exactly the conversion its reader applies, " +
    "or the station typed on a calibrated sheet lands somewhere else",
);

console.log(`\nrelative-to-scale: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);