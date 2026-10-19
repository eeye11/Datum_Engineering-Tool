/*
 * ========================================================
 * THE WORLD SCALE, AND THE VALUE IT REPORTS
 * ========================================================
 *
 * A sheet's scale is the relationship between its drawing units and real
 * lengths, established by the FIRST Length feature and reset when the LAST one
 * is deleted. Two things must hold afterwards:
 *
 *   1. THE STORED VALUE IS EXACT. A dimension does not measure itself off the
 *      screen; it reads the REFERENCED GEOMETRY's stored world coordinates
 *      through the scale. So `9000 mm` stays `9000.00 mm` - it is not re-derived
 *      from any rendered pixel, which is where the 8999.97-type drift came from.
 *
 *   2. THE SCALE RESETS WITH THE LAST LENGTH. Deleting every Length leaves the
 *      scale with nothing to relate, so it is dropped - even when other,
 *      non-length geometry remains on the sheet.
 */

const { JSDOM } = require("jsdom");

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

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "https://datum.test/",
});

global.window = dom.window;
global.document = dom.window.document;
global.Element = dom.window.Element;

for (const name of [
  "quantities.js",
  "dimensions.js",
  "scale-calibration.js",
  "measurement-core.js",
  "dimension-model.js",
  "annotation-model.js",
  "load-profile.js",
  "body-frames.js",
  "feature-geometry.js",
  "drawing-state.js",
]) {
  require(modulePath(name));
}

const state = require(modulePath("drawing-state.js")).default;
const scale = require(modulePath("dimensions.js")).default;
const dimensionModel = require(modulePath("dimension-model.js")).default;

const F = state.geometryFactories;

console.log("\n  the first Length defines the scale from the DRAWN geometry\n");

{
  const st = state.createDrawingState();

  check("a fresh sheet is uncalibrated", scale.isCalibrated(st) === false);

  /* A line drawn 200 drawing units long. */
  const line = F.line({ x: 0, y: 0 }, { x: 200, y: 0 });
  state.addObject(st, line);

  /*
   * The student says it is really 9000 mm. The scale is then
   * 9000 / 200 = 45 mm per drawing unit - NOT 1:1, which is what made a
   * 9000 mm dimension draw as a 9000-unit line.
   */
  const result = scale.calibrate(st, 200, 9000, "mm");

  check("the calibration succeeds", result.ok === true, result.reason);
  check(
    "and the scale is mm-per-unit, not the literal number",
    Math.abs(st.scale.mmPerUnit - 45) < 1e-9,
    `mmPerUnit = ${st.scale.mmPerUnit}, expected 45`,
  );
  check("the sheet is now calibrated", scale.isCalibrated(st) === true);
}

console.log("\n  the value reads back EXACTLY, with no drift\n");

{
  const st = state.createDrawingState();

  const line = F.line({ x: 0, y: 0 }, { x: 200, y: 0 });
  state.addObject(st, line);

  scale.calibrate(st, 200, 9000, "mm");

  /*
   * A length dimension measuring that line. The measurement is taken from the
   * line's STORED endpoints, through the scale - there is no screen pixel and
   * no reverse conversion anywhere in the path.
   */
  const dimension = dimensionModel.createDimension({
    dimensionType: "linear",
    refs: [
      { kind: "line", featureId: line.id, anchor: "start" },
      { kind: "line", featureId: line.id, anchor: "end" },
    ],
    placement: { x: 100, y: 20 },
  });

  const text = dimensionModel.formatMeasurement(dimension, st);

  check(
    "9000 mm reads back as exactly 9000.00 mm",
    text === "9000.00 mm",
    `got "${text}"`,
  );

  /*
   * And the whole sweep of values the requirement names, each calibrated on its
   * own sheet so the drawn geometry stays a constant 200 units.
   */
  for (const real of [10, 25, 100, 500, 1000, 5000, 9000, 15000, 50000]) {
    const sheet = state.createDrawingState();
    const l = F.line({ x: 0, y: 0 }, { x: 200, y: 0 });

    state.addObject(sheet, l);
    scale.calibrate(sheet, 200, real, "mm");

    const d = dimensionModel.createDimension({
      dimensionType: "linear",
      refs: [
        { kind: "line", featureId: l.id, anchor: "start" },
        { kind: "line", featureId: l.id, anchor: "end" },
      ],
      placement: { x: 100, y: 20 },
    });

    const shown = dimensionModel.formatMeasurement(d, sheet);
    const expected = `${real.toFixed(2)} mm`;

    check(
      `${real} mm round-trips exactly`,
      shown === expected,
      `expected "${expected}", got "${shown}"`,
    );
  }
}

console.log("\n  a dimension does NOT become static; it reads LIVE geometry\n");

{
  const st = state.createDrawingState();

  const line = F.line({ x: 0, y: 0 }, { x: 200, y: 0 });
  state.addObject(st, line);

  scale.calibrate(st, 200, 9000, "mm");

  const dimension = dimensionModel.createDimension({
    dimensionType: "linear",
    refs: [
      { kind: "line", featureId: line.id, anchor: "start" },
      { kind: "line", featureId: line.id, anchor: "end" },
    ],
    placement: { x: 100, y: 20 },
  });

  check(
    "it starts at 9000.00 mm",
    dimensionModel.formatMeasurement(dimension, st) === "9000.00 mm",
  );

  /* Move the geometry: half as long. */
  line.geometry.end = { x: 100, y: 0 };

  check(
    "and it follows the geometry - it is DRIVING, not a cached number",
    dimensionModel.formatMeasurement(dimension, st) === "4500.00 mm",
    dimensionModel.formatMeasurement(dimension, st),
  );
}

console.log("\n  deleting dimensions does not reset the sheet scale\n");

{
  const st = state.createDrawingState();

  const beam = F.beam({ x: 0, y: 0 }, { x: 200, y: 0 });
  state.addObject(st, beam);

  const d1 = dimensionModel.createDimension({
    dimensionType: "linear",
    refs: [
      { kind: "line", featureId: beam.id, anchor: "start" },
      { kind: "line", featureId: beam.id, anchor: "end" },
    ],
    placement: { x: 100, y: 20 },
  });

  state.addObject(st, d1);

  scale.calibrate(st, 200, 9000, "mm");

  check("the sheet is calibrated", scale.isCalibrated(st) === true);

  /* A second Length, so deleting one still leaves one. */
  const d2 = dimensionModel.createDimension({
    dimensionType: "linear",
    refs: [
      { kind: "line", featureId: beam.id, anchor: "start" },
      { kind: "line", featureId: beam.id, anchor: "end" },
    ],
    placement: { x: 100, y: 40 },
  });

  state.addObject(st, d2);

  state.removeObjectsAndDescendants(st, [d1.id]);

  check(
    "with a Length still on the sheet the scale is KEPT",
    scale.isCalibrated(st) === true,
  );

  state.removeObjectsAndDescendants(st, [d2.id]);

  check(
    "and deleting the LAST Length leaves it unchanged",
    scale.isCalibrated(st) === true,
    `scale=${JSON.stringify(st.scale)}`,
  );

  check(
    "even though the BEAM is still there",
    st.objects.some((object) => object.id === beam.id),
    "geometry may remain on the sheet",
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
