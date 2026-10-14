/*
 * Reproduction: a bare number in a length field must be read in the field's
 * own selected unit, not in millimetres.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
/* Source modules are found by file name, so they can move between folders. */
const { locate } = require("./helpers/source-path.cjs");
const read = p => fs.readFileSync(p.startsWith("src/") ? locate(path.basename(p)) : path.join(root, p), "utf8");

test("REPRO: worldLengthOf must forward the unit it was handed", () => {
  const source = read("src/editor/handles.js");
  assert.match(
    source,
    /worldLengthOf[\s\S]{0,200}fromEngineering\(\s*drawingState,\s*typed,\s*unit/,
    "worldLengthOf forwards its unit argument to fromEngineering"
  );
});

/*
 * The metre/millimetre defect, reproduced.
 *
 * A Point's X field calls `coordinate("X", "position.x", position.x, "mm", true)`.
 * The field is a LENGTH, so the display converts world -> mm. The unit selector
 * it offers writes `object.lengthUnit`, which is what the setter reads back.
 * The two halves must agree, and a bare number must mean "in the selected unit".
 */
test("the coordinate helper renders exactly one unit selector, not a static label", () => {
  const source = read("src/editor/feature-panel-markup.js");

  assert.match(
    source,
    /const coordinate = \([\s\S]{0,4000}lengthUnitControl/,
    "coordinate() hands a unit control to scalar()"
  );
});

test("the shared conversion takes both units and is the one implementation", () => {
  const quantities = read("src/core/units/quantities.js");
  assert.match(quantities, /function convertValue\(value, quantityType, fromUnit, toUnit\)/);
  assert.match(quantities, /base: "mm"/);
});

test("quantity table: metre and millimetre are distinct, both-way conversion", () => {
  const quantities = require(path.join(root, "src/core/units/quantities.js"));
  const q = quantities.default || quantities;

  assert.equal(q.convertValue(5, "length", "m", "mm"), 5000);
  assert.equal(q.convertValue(5000, "length", "mm", "m"), 5);
  assert.equal(q.convertValue(5, "length", "m", "cm"), 500);
  assert.equal(q.convertValue(5, "length", "m", "in"), 5 * 1000 / 25.4);
});

test("unitsFor returns no duplicates", () => {
  const quantities = require(path.join(root, "src/core/units/quantities.js"));
  const q = quantities.default || quantities;

  for (const type of ["length", "force", "moment", "distributedLoad", "angle", "area"]) {
    const units = q.unitsFor(type);
    assert.equal(new Set(units).size, units.length, `${type} units are unique`);
  }
});

/*
 * ============================================================
 * THE ACTUAL DEFECT, AS ARITHMETIC
 * ============================================================
 *
 * A Point's X field reads "5" with metres selected. The student presses Enter.
 *
 * The DISPLAY half divides by the chosen unit's factor, so the row is set to
 * "5 m" - and `chosenUnit` is handed to `scalar()` as the row's STATIC unit,
 * which the row prints BESIDE the selector. That is the duplicate label.
 *
 * The WRITE half must then convert 5 m to world units. On an uncalibrated sheet
 * the scale is 1 mm per world unit, so 5 m = 5000 mm = 5000 world units, and the
 * row re-reads "5" - correct.
 *
 * On a CALIBRATED sheet the same write lands somewhere else, and the re-read
 * does not come back to 5. That is the "0.005" the report describes: the
 * DISPLAY unit and the STORED unit are resolved by two different functions, so
 * the panel and the setter disagree about what the field is denominated in.
 */
test("REPRO: a length row must not print a static unit beside its selector", () => {
  const markup = read("src/editor/feature-panel-markup.js");

  /*
   * `coordinate()` hands the chosen unit to `scalar()` as the row's unit
   * AND hands a unit selector in `unitControl`. The row then renders
   * `<static unit><selector>` - "5 m [m v]" - the exact duplication the
   * specification calls out in section 4.1.
   */
  const coordinateBody = markup.slice(
    markup.indexOf("const coordinate = ("),
    markup.indexOf("const coordinate = (") + 4000
  );

  const passesStaticUnit = /unit:\s*converts\s*\?\s*chosenUnit\s*:\s*unit/.test(
    coordinateBody
  );
  const passesSelector = /unitControl:\s*lengthUnitControl/.test(coordinateBody);

  assert.ok(
    !(passesStaticUnit && passesSelector),
    "a row must not render BOTH a static unit label and a unit selector"
  );
});

test("REPRO: the setter and the reader must resolve the unit the same way", () => {
  const update = read("src/editor/property-update.js");

  /*
   * The setter resolves the display unit from `object.lengthUnit` through the
   * ONE shared helper, so the panel and the setter cannot disagree about what
   * the field is denominated in. Both the inline resolution this test used to
   * assert and the helper version satisfy the property; the helper is what the
   * rest of the length branches share.
   */
  const setter =
    /const displayUnit =\s*[\s\S]{0,200}?\?\s*object\.lengthUnit\s*:\s*'mm'/.test(
      update
    ) ||
    /function displayLengthUnitOf\(object\)[\s\S]{0,300}isUnitFor\("length", stored\)/.test(
      update
    );

  assert.ok(setter, "setter resolves displayUnit");
});

test("quantity table round-trips: 5 m in, 5000 mm out, and back", () => {
  const quantities = require(path.join(root, "src/core/units/quantities.js"));
  const q = quantities.default || quantities;

  const world = 5000; // mm on an uncalibrated 1 mm-per-unit sheet
  const asMetres = q.convertValue(world, "length", "mm", "m");
  assert.equal(asMetres, 5, "5000 mm reads as 5 m");

  const backToWorld = q.convertValue(asMetres, "length", "m", "mm");
  assert.equal(backToWorld, world, "and back to 5000 mm - no drift");
});
/*
 * ============================================================
 * END-TO-END: WHAT "5" MEANS ON A CALIBRATED SHEET
 * ============================================================
 *
 * The report's symptom: enter 5 with metres selected, press Enter, the field
 * shows 0.005. Reproduce it as arithmetic through the REAL shared functions.
 */
test("E2E: a bare 5 in a metre field, on a calibrated sheet", () => {
  const quantities = require(path.join(root, "src/core/units/quantities.js"));
  const dimensions = require(path.join(root, "src/core/scale/dimensions.js"));
  const q = quantities.default || quantities;
  const d = dimensions.default || dimensions;

  /*
   * A sheet calibrated so that ONE DRAWING UNIT IS ONE MILLIMETRE is the
   * default. Calibrate a sheet where 1 drawing unit = 1 mm for the test.
   */
  const state = {};
  d.calibrate(state, 1, 1, "mm"); // 1 drawing unit = 1 mm

  const displayUnit = "m";
  const typed = 5;

  /* WRITE: the setter converts the typed value from the display unit to world. */
  const world = d.fromEngineering(state, typed, displayUnit);
  assert.equal(world, 5000, "5 m becomes 5000 world units on a 1 mm-per-unit sheet");

  /* READ: the panel converts world back to millimetres, then into the display unit. */
  const mm = d.toEngineering(state, world);
  const shown = q.convertValue(mm.value, "length", "mm", displayUnit);

  assert.equal(
    shown,
    5,
    "and the field must read 5 back, not 0.005"
  );
});

test("E2E: the SAME flow when the sheet's own unit is not mm", () => {
  const quantities = require(path.join(root, "src/core/units/quantities.js"));
  const dimensions = require(path.join(root, "src/core/scale/dimensions.js"));
  const q = quantities.default || quantities;
  const d = dimensions.default || dimensions;

  /*
   * A sheet calibrated in METRES: the student said "this drawing distance is
   * 2 metres", so the scale's unit is "m". This is where the two halves of the
   * application stop agreeing, because the display unit on the field and the
   * unit on the sheet are resolved by different code.
   */
  const state = {};
  d.calibrate(state, 2, 2, "m"); // 2 drawing units = 2 m => 1 unit = 1 m = 1000 mm

  const displayUnit = "m";
  const typed = 5;

  const world = d.fromEngineering(state, typed, displayUnit);
  const mm = d.toEngineering(state, world);
  const shown = q.convertValue(mm.value, "length", "mm", displayUnit);

  assert.equal(shown, 5, "a metre field must round-trip through a metre sheet");
});

test("E2E: an INCH field on a MILLIMETRE sheet", () => {
  const quantities = require(path.join(root, "src/core/units/quantities.js"));
  const dimensions = require(path.join(root, "src/core/scale/dimensions.js"));
  const q = quantities.default || quantities;
  const d = dimensions.default || dimensions;

  const state = {};
  d.calibrate(state, 1, 1, "mm"); // 1 drawing unit = 1 mm

  const world = d.fromEngineering(state, 2, "in");
  assert.ok(Math.abs(world - 50.8) < 1e-9, "2 in is 50.8 world units");

  const mm = d.toEngineering(state, world);
  const shown = q.convertValue(mm.value, "length", "mm", "in");
  assert.ok(Math.abs(shown - 2) < 1e-9, "and reads back as 2 in");
});
/*
 * ============================================================
 * THE SUFFIX RULE AND THE REFUSAL RULE
 * ============================================================
 *
 * The three cases the specification names, read through the shared parser:
 *
 *   1. A BARE NUMBER is in the unit the field is showing.
 *   2. AN EXPLICIT SUFFIX overrides the field's unit.
 *   3. A MALFORMED ENTRY is refused, never read as zero.
 */
const q = (() => {
  const quantities = require(path.join(root, "src/core/units/quantities.js"));
  return quantities.default || quantities;
})();
const readQuantity = q.readQuantity;

test("RULE 1: a bare number is read in the field's unit", () => {
  assert.deepEqual(readQuantity("5", "length", "m"), {
    value: 5,
    unit: "m",
    explicit: false,
  });

  assert.deepEqual(readQuantity("5", "length", "mm"), {
    value: 5,
    unit: "mm",
    explicit: false,
  });
});

test("RULE 2: an explicit suffix overrides the field's unit", () => {
  assert.deepEqual(readQuantity("5 mm", "length", "m"), {
    value: 5,
    unit: "mm",
    explicit: true,
  });

  assert.deepEqual(readQuantity("5 m", "length", "mm"), {
    value: 5,
    unit: "m",
    explicit: true,
  });

  assert.deepEqual(readQuantity("2 in", "length", "mm"), {
    value: 2,
    unit: "in",
    explicit: true,
  });
});

test("RULE 2: a suffix is matched case-insensitively", () => {
  assert.equal(readQuantity("5 MM", "length", "m").unit, "mm");
  assert.equal(readQuantity("5 Mm", "length", "m").unit, "mm");
  assert.equal(readQuantity("2 kN", "force", "N").unit, "kN");
  assert.equal(readQuantity("2 KN", "force", "N").unit, "kN");
});

test("RULE 3: a malformed or empty entry is refused, not zeroed", () => {
  assert.equal(readQuantity("", "length", "m"), null);
  assert.equal(readQuantity("   ", "length", "m"), null);
  assert.equal(readQuantity("abc", "length", "m"), null);
  assert.equal(readQuantity("5 furlongs", "length", "m"), null);

  /* A force unit in a length field is refused rather than half-read. */
  assert.equal(readQuantity("5 N", "length", "m"), null);

  /* So is a length unit in a force field. */
  assert.equal(readQuantity("5 mm", "force", "N"), null);
});

test("RULE 3: a refusal is distinguishable from a real zero", () => {
  /* "0" is a valid length and must not be confused with a refusal. */
  assert.deepEqual(readQuantity("0", "length", "m"), {
    value: 0,
    unit: "m",
    explicit: false,
  });

  assert.notEqual(readQuantity("0", "length", "m"), null);
  assert.equal(readQuantity("", "length", "m"), null);
});

test("an exponent is read as a number, not refused", () => {
  assert.equal(readQuantity("1e3", "length", "m").value, 1000);
  assert.equal(readQuantity("2.5e-2", "length", "m").value, 0.025);
});
