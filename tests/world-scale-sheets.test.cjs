/*
 * ========================================================
 * THE SHEET'S WORLD SCALE, AND THE UNITS IT CAN BE GIVEN IN
 * ========================================================
 *
 * Two facts that the rest of the length system depends on:
 *
 *   1. A sheet's calibration is part of the SHEET and must survive
 *      serialisation, duplication and a reload. It used to be written by
 *      `captureSheetContent` and read by `loadSheet`, but NOT copied by
 *      `createSheet`/`createCollection` - so a reopened file had no scale
 *      at all and measured everything at the 1:1 default, silently.
 *
 *   2. A calibration may be given in inches or feet as well as mm/cm/m.
 *      The dialog offered them, but the conversion table did not define
 *      them, so `calibrate(..., "in")` fell back to millimetres and a
 *      4 in calibration was stored as 4 mm.
 *
 * Both are data facts about the sheet, so they are checked in Node.
 */

const { loadModule } = require("./helpers/source-path.cjs");

global.window = { crypto: { randomUUID: () => "world-scale-uuid" } };

loadModule("dimensions.js");
loadModule("sheets.js");

const scale = global.window.enggDimensions;
const sheets = global.window.enggSheets;

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

const near = (a, b, tolerance = 1e-9) => Math.abs(a - b) <= tolerance;

const mmScale = {
  mmPerUnit: 100 / 240,
  unit: "mm",
  reference: { drawingUnits: 240, realValue: 100, unit: "mm" },
};

const inchScale = {
  mmPerUnit: (4 * 25.4) / 200,
  unit: "in",
  reference: { drawingUnits: 200, realValue: 4, unit: "in" },
};

console.log("\n  the first measurement's unit is a real conversion\n");

/*
 * Each unit is defined against the millimetre, so a calibration in it must
 * actually scale in that unit - not silently fall back to millimetres.
 */
{
  const state = {};

  const result = scale.calibrate(state, 200, 4, "in");

  check(
    "a calibration can be given in inches",
    result.ok === true && state.scale.unit === "in",
    JSON.stringify(state.scale),
  );

  check(
    "and an inch is 25.4 mm in the conversion",
    near(state.scale.mmPerUnit, (4 * 25.4) / 200, 1e-12),
    `mmPerUnit ${state.scale.mmPerUnit}`,
  );

  /*
   * THE VALUE IS ALWAYS MILLIMETRES, whatever unit the sheet is labelled in.
   *
   * This used to assert 8 in, because `toEngineering` divided the millimetres by
   * the sheet's own unit. On an inch sheet that made the number "of inches"; on
   * a METRE sheet it divided by a thousand, and a panel that asks for millimetres
   * then converted them into the field's display unit received a metre figure
   * labelled as millimetres - so 5 m came back as 0.005. The reported defect.
   *
   * The unit is a LABEL, not part of the value: 400 drawing units at 25.4/50 mm
   * each is 203.2 mm, and it is the reader - the panel - that shows it as 8 in.
   */
  check(
    "a line twice as long is 203.2 mm, whatever the sheet is labelled",
    near(scale.toEngineering(state, 400).value, 203.2, 1e-9) &&
      scale.toEngineering(state, 400).unit === "mm",
    JSON.stringify(scale.toEngineering(state, 400)),
  );
}

{
  const state = {};

  scale.calibrate(state, 100, 2, "ft");

  check(
    "a calibration can be given in feet",
    state.scale.unit === "ft" &&
      near(state.scale.mmPerUnit, (2 * 304.8) / 100, 1e-12),
    JSON.stringify(state.scale),
  );
}

console.log("\n  the scale belongs to the sheet and survives a reload\n");

/*
 * Save, then read the file back the way the application does. The scale must
 * come back with the geometry.
 */
{
  const collection = sheets.createCollection();

  const first = collection.sheets[0];

  first.objects = [
    {
      id: "beam-1",
      type: "beam",
      geometry: {
        start: { x: 0, y: 0 },
        end: { x: 240, y: 0 },
      },
    },
  ];

  first.scale = JSON.parse(JSON.stringify(mmScale));

  const saved = sheets.serializeCollection(collection);

  const reopened = sheets.createCollection(
    JSON.parse(JSON.stringify(saved)),
  );

  check(
    "a reopened sheet keeps its world scale",
    reopened.sheets[0].scale &&
      near(reopened.sheets[0].scale.mmPerUnit, mmScale.mmPerUnit, 1e-12),
    `scale = ${JSON.stringify(reopened.sheets[0].scale)}`,
  );

  check(
    "and its working unit",
    reopened.sheets[0].scale.unit === "mm",
    `unit = ${reopened.sheets[0].scale?.unit}`,
  );

  check(
    "and the reference that established it",
    reopened.sheets[0].scale.reference?.realValue === 100,
    JSON.stringify(reopened.sheets[0].scale.reference),
  );

  /*
   * THE LENGTH THE STUDENT SEES is the real test: reading a length off the
   * reopened sheet must give the same physical value as before it was saved.
   */
  const before = scale.toEngineering(first, 240).value;
  const after = scale.toEngineering(reopened.sheets[0], 240).value;

  check(
    "so a 100 mm beam still measures 100 mm after reopening",
    near(after, before, 1e-9) && near(after, 100, 1e-9),
    `before ${before}, after ${after}`,
  );
}

console.log("\n  and each sheet keeps its own, independently\n");

{
  const collection = sheets.createCollection({
    sheets: [
      {
        id: "sheet_aaaaaaaa",
        name: "Sheet 1",
        objects: [],
        scale: mmScale,
      },
      {
        id: "sheet_bbbbbbbb",
        name: "Sheet 2",
        objects: [],
        scale: inchScale,
      },
    ],
    activeSheetId: "sheet_aaaaaaaa",
  });

  check(
    "sheet 1 is calibrated in millimetres",
    collection.sheets[0].scale.unit === "mm",
    JSON.stringify(collection.sheets[0].scale),
  );

  check(
    "sheet 2 is calibrated in inches",
    collection.sheets[1].scale.unit === "in",
    JSON.stringify(collection.sheets[1].scale),
  );

  check(
    "and the two scales are genuinely different",
    !near(
      collection.sheets[0].scale.mmPerUnit,
      collection.sheets[1].scale.mmPerUnit,
    ),
  );

  /*
   * A blank sheet arrives UNCALIBRATED, which is a different state from
   * "calibrated at 1:1" - the next measurement on it establishes a scale
   * rather than inheriting a neighbour's.
   */
  const blank = sheets.addSheet(collection);

  check(
    "a new sheet starts uncalibrated",
    blank.scale === null &&
      scale.isCalibrated(blank) === false,
    `scale = ${JSON.stringify(blank.scale)}`,
  );
}

console.log("\n  a duplicate is calibrated like its original\n");

{
  const collection = sheets.createCollection();

  collection.sheets[0].scale = JSON.parse(
    JSON.stringify(mmScale),
  );

  const copy = sheets.duplicateSheet(
    collection,
    collection.sheets[0].id,
  );

  check(
    "the copy carries the scale it was copied from",
    copy.scale &&
      near(copy.scale.mmPerUnit, mmScale.mmPerUnit, 1e-12),
    `copy scale = ${JSON.stringify(copy.scale)}`,
  );

  /*
   * And an independent one: recalibrating the copy must not touch the
   * original.
   */
  copy.scale = {
    ...copy.scale,
    mmPerUnit: 5,
  };

  check(
    "recalibrating the copy leaves the original alone",
    near(
      collection.sheets[0].scale.mmPerUnit,
      mmScale.mmPerUnit,
      1e-12,
    ),
    JSON.stringify(collection.sheets[0].scale),
  );
}

console.log("\n  zoom never reaches the measurement\n");

{
  const state = { scale: JSON.parse(JSON.stringify(mmScale)) };

  [0.25, 1, 8].forEach((zoom) => {
    state.camera = { zoom };

    check(
      `240 units is 100 mm at ${zoom}x zoom`,
      near(scale.toEngineering(state, 240).value, 100, 1e-9),
      `got ${scale.toEngineering(state, 240).value}`,
    );
  });
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
