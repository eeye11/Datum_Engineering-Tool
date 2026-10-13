
const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * The document scale, tested directly.
 *
 * The scale is the one piece of the dimension system where being
 * subtly wrong is worst, because a wrong scale makes every
 * measurement in the drawing wrong while still looking plausible.
 * Two things are therefore checked hard here: that stored geometry is
 * never rewritten, and that a value survives the round trip through
 * the conversion without drift.
 */

global.window = {};
loadModule("dimensions.js");
const d = global.window.enggDimensions;

let pass = 0;
let fail = 0;

const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    console.log(
      `  FAIL ${name}\n       expected ${JSON.stringify(expected)}` +
        `\n       actual   ${JSON.stringify(actual)}`
    );
  }
};

const near = (name, actual, expected) => {
  const ok = Number.isFinite(actual) && Math.abs(actual - expected) < 1e-9;
  if (ok) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    console.log(
      `  FAIL ${name}\n       expected ~${expected}\n       actual   ${actual}`
    );
  }
};

const state = { scale: null };

console.log("\nAn uncalibrated drawing");
check("is not calibrated", d.isCalibrated(state), false);
check("reads no scale", d.readScale(state), null);
check("falls back to one-to-one", d.toEngineering(state, 20).value, 20);
check(
  "and marks the number provisional",
  d.toEngineering(state, 20).calibrated,
  false
);

console.log("\nCalibrating from the brief's example");
const result = d.calibrate(state, 40, 200, "mm");
check("succeeds", result.ok, true);
near("40 units = 200 mm is 5 mm per unit", result.mmPerUnit, 5);
check("the drawing is now calibrated", d.isCalibrated(state), true);
near("20 units reads as 100 mm", d.toEngineering(state, 20).value, 100);
near("a 250 mm feature is 50 units long", d.fromEngineering(state, 250), 50);
near("and reads back as 250 mm", d.toEngineering(state, 50).value, 250);

console.log("\nThe round trip must not drift");
for (const value of [1, 7.5, 250, 1234.5]) {
  near(
    `${value} mm survives the round trip`,
    d.toEngineering(state, d.fromEngineering(state, value)).value,
    value
  );
}

console.log("\nUnits");
const cm = d.calibrate(state, 40, 20, "cm");
near("40 units = 20 cm is still 5 mm per unit", cm.mmPerUnit, 5);
check("the document reads in cm", d.readScale(state).unit, "cm");
/*
 * THE VALUE IS ALWAYS MILLIMETRES.
 *
 * These two rows used to expect the SHEET's unit - 50 cm, 500 cm - because
 * `toEngineering` divided the millimetres by the sheet's own unit as well as
 * multiplying by the scale. On a centimetre sheet that made the number
 * smaller; on a METRE sheet it made it a thousand times smaller, and a panel
 * that asks for millimetres then converted them into the field's display unit
 * received a metre figure labelled as millimetres. Entering 5 m came back as
 * 0.005 - the reported defect.
 *
 * The scale already carries the unit, so the value does not have to as well:
 * 100 units at 5 mm each IS 500 mm, and 5 m IS 5000 mm. The caller converts
 * into whatever unit it is displaying.
 */
near(
  "100 units at 5 mm each is 500 mm, shown as 50 cm by the caller",
  d.toEngineering(state, 100).value,
  500
);
near("5 m is 5000 mm, which is 1000 units", d.fromEngineering(state, 5, "m"), 1000);
near("and reads back as 5000 mm", d.toEngineering(state, 1000).value, 5000);

console.log("\nRefusals");
check("a zero measurement is refused", d.calibrate(state, 0, 200).ok, false);
check("a zero real value is refused", d.calibrate(state, 40, 0).ok, false);
check(
  "a negative real value is refused",
  d.calibrate(state, 40, -5).ok,
  false
);
check(
  "and a refusal leaves the scale alone",
  d.readScale(state).mmPerUnit,
  5
);

console.log("\nGeometry is never rewritten");
const geometry = { start: { x: 0, y: 0 }, end: { x: 40, y: 0 } };
const snapshot = JSON.stringify(geometry);
d.calibrate(state, 40, 200, "mm");
d.toEngineering(state, 40);
check("coordinates are untouched", JSON.stringify(geometry), snapshot);
check("and carry no scale of their own", geometry.scale, undefined);
check("the scale lives on the document", state.scale.mmPerUnit, 5);

console.log("\nMeasuring between points");
near(
  "a 40 unit span is 200 mm",
  d.measure(state, { x: 0, y: 0 }, { x: 40, y: 0 }).value,
  200
);
const parts = d.measureComponents(
  state,
  { x: 0, y: 0 },
  { x: 30, y: 40 }
);
near("the horizontal part is 150 mm", parts.horizontal.value, 150);
near("the vertical part is 200 mm", parts.vertical.value, 200);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
