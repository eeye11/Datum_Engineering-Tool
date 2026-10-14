/*
 * ========================================================
 * ONE UNIT CONTROL FOR EVERY UNIT-BEARING FEATURE
 * ========================================================
 *
 * Every feature with a value and a unit must let the student SEE and CHANGE
 * that unit from the Features panel - a force, a moment, a distributed load, a
 * dimension. The unit control is ONE component, the units come from ONE table,
 * and changing the unit is a CONVERSION, not a relabel.
 *
 * The defects this pins:
 *
 *   1. EVERY PANEL BUILT ITS OWN UNIT SELECT. A force, a moment and a load
 *      each assembled a `<select>` by hand, so their widths, their options and
 *      their behaviour could drift apart - and did.
 *
 *   2. THE UNIT WAS WRITTEN AS A BOOLEAN. The generic panel select handler wrote
 *      `geometry[key] = value === "true"`, which is right for a checkbox-shaped
 *      select and wrong for a unit: choosing kN stored `forceUnit = false`, the
 *      dropdown snapped back on the next repaint, and nothing said why. That is
 *      what made a Moment's unit control look decorative.
 *
 *   3. THE UNIT LISTS WERE DUPLICATED. `["kN/m","N/mm"]` was written out beside
 *      the quantity table's own list, so a unit could exist in one and not the
 *      other.
 *
 *   4. A DIMENSION HAD NO UNIT CONTROL AT ALL. Its value is measured in the
 *      sheet's own unit, and there was no way to READ it in cm or m without
 *      changing the geometry. It now converts for display only, so the
 *      dimension stays DRIVING.
 */

const fs = require("fs");
const { stylesheetSource } = require("./helpers/source-path.cjs");
const path = require("path");

const { locate } = require("./helpers/source-path.cjs");

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

const panel = fs.readFileSync(locate("property-panel.js"), "utf8");
const markup = fs.readFileSync(locate("feature-panel-markup.js"), "utf8");
const staticsPanel = fs.readFileSync(locate("statics-panel.js"), "utf8");
const binding = fs.readFileSync(locate("property-binding.js"), "utf8");
const dimensionModel = fs.readFileSync(
  locate("dimension-model.js"),
  "utf8",
);
const loadProfile = fs.readFileSync(locate("load-profile.js"), "utf8");
const css = stylesheetSource("editor.css");

console.log("\n  ONE unit control, built once\n");

check(
  "the shared panel owns a unit selector",
  /const unitSelect\s*=/.test(panel) &&
    /unitSelect,/.test(panel),
  "every panel must build its unit from the same component",
);

check(
  "it is a select, so the unit can only be one the application knows",
  /<select[\s\S]{0,200}drawing-property-unit-select/.test(panel),
);

check(
  "the force/moment magnitude pair uses the shared control",
  /panels\.unitSelect\(/.test(markup),
  "assembling a <select> by hand is how the panels drift apart",
);

check(
  "the load's unit selector resolves to the shared control too",
  /panels\.unitSelect\(\{/.test(staticsPanel) &&
    /unitSelectMarkup/.test(staticsPanel),
);

console.log("\n  the unit is WIDE ENOUGH to be read\n");

check(
  "the shared select carries its own width class",
  /drawing-property-unit-select/.test(panel),
);

check(
  "and the class has a minimum width, not a shrink-to-nothing",
  /\.drawing-property-unit-select[\s\S]{0,400}min-width:\s*\d+px/.test(css),
  "a unit that is clipped is a unit that is wrong",
);

check(
  "the font is the panel's own size, not shrunk to fit",
  /\.drawing-property-unit-select[\s\S]{0,300}font-size:\s*9px/.test(css),
  "solving a width problem by shrinking the type is refused",
);

console.log("\n  the unit lists come from ONE table\n");

check(
  "a load's accepted units are the quantity table's own",
  /LOAD_UNITS\s*=\s*enggQuantities\.unitsFor\(/.test(loadProfile) ||
    /unitsFor\(["']distributedLoad["']\)/.test(loadProfile),
  "a second list is a list that can disagree",
);

check(
  "and the load validates a unit against the table",
  /isUnitFor\(\s*["']distributedLoad["']/.test(loadProfile),
);

check(
  "the load panel offers the table's units rather than a literal pair",
  /unitsFor\?\.\(["']distributedLoad["']\)/.test(staticsPanel) ||
    /unitsFor\(["']distributedLoad["']\)/.test(staticsPanel),
);

console.log("\n  a unit change is WRITTEN as a unit\n");

check(
  "a select's value is routed through the ONE setter",
  /updateFeatureProperty\(\s*object,\s*key,\s*select\.value\s*\)/.test(binding),
  "writing geometry[key] = value === 'true' stores a unit as a boolean",
);

check(
  "and the boolean-write that broke unit selects is gone",
  !/object\.geometry\[key\]\s*=\s*key === "direction"[\s\S]{0,200}select\.value === "true"/.test(
    binding,
  ),
);

check(
  "a direction is still a word, not a flag",
  /key === ['"]direction['"][\s\S]{0,120}CCW/.test(binding),
);

console.log("\n  a dimension can be READ in another length unit\n");

check(
  "a dimension records the unit it is read in",
  /displayUnit/.test(dimensionModel),
);

check(
  "and the conversion is a CONVERSION, through the shared table",
  /convertValue\([\s\S]{0,200}["']length["'][\s\S]{0,120}displayUnit/.test(
    dimensionModel,
  ),
  "100 mm read in cm must be 10 cm, not 100 cm",
);

check(
  "the geometry is not touched by the unit change",
  !/displayUnit[\s\S]{0,200}(geometry|sourceRefs)\s*=/.test(dimensionModel),
  "the association with the geometry must survive a unit change",
);

check(
  "the dimension panel offers the control",
  /dimensionUnitRow/.test(markup) &&
    /rows\.push\(dimensionUnitRow\(object\)\)/.test(markup),
);

check(
  "an angle dimension has no length unit offered",
  /angular[\s\S]{0,200}return "";/.test(markup),
);

check(
  "the dimension write stores no value, only the unit",
  /key === ['"]displayUnit['"]/.test(
    fs.readFileSync(locate("property-update.js"), "utf8"),
  ),
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
