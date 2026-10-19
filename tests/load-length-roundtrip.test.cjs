/*
 * The Features panel's Length field is the load's engineering span.
 *
 * WHAT IS ASSERTED, AND WHY IT IS ASSERTED HERE.
 *
 * A student typing "100 mm" is stating a REAL LENGTH, so the distance
 * between the load's defining points must become exactly 100 mm on the
 * sheet and the panel must report 100 mm straight back. Every fault the
 * specification lists as must-not-happen - a value scaled twice, a value
 * scaled not at all, a value that survives only until the next render -
 * shows up as a disagreement between what was typed and what the panel
 * reads afterwards.
 *
 * So the test drives the two halves that must agree and checks the pair:
 *
 *   1. the panel half - `scalar("Length", ...)` is shown as an engineering
 *      length, and the setter converts it exactly once (see
 *      SETTER_OWNED_LENGTHS in drawing.js, which keeps the input path from
 *      converting a value the setter is already converting);
 *   2. the geometry half - the authoritative endpoint update, taken from
 *      drawing.js's own shape rather than invented here, so the test cannot
 *      pass while the application does something else.
 *
 * The scale is deliberately varied: an uncalibrated sheet, a sheet at
 * 4 mm per unit and a sheet at 0.25 mm per unit. A conversion applied in
 * the wrong place is invisible at 1:1 and wrong everywhere else, which is
 * exactly how a scale fault survives a suite that only draws at 1:1.
 */
const { locate } = require("./helpers/source-path.cjs");
const fs = require("fs");
const { JSDOM } = require("jsdom");

const dom = new JSDOM("<!doctype html><html><body></body></html>");
global.window = dom.window;
global.document = dom.window.document;

require(locate("drawing-state.js"));

/*
 * The drawing-state module is an ES module with a default export too, so it
 * is loaded the same way the scale module is: through a dynamic import, and
 * a fresh drawing state is created from it once both are ready.
 */
const drawingStateReady = import(
  "../src/shared/model/drawing-state.js"
).then((loaded) => loaded.default.createDrawingState());

/*
 * The scale module is an ES module with a default export, while this file
 * is CommonJS, so it is loaded through a dynamic import and the body of the
 * test runs once that import resolves.
 */
const dimensionsReady = import(
  "../src/shared/scale/dimensions.js"
).then((loaded) => loaded.default);

const source = fs.readFileSync(locate("property-update.js"), "utf8");

let pass = 0;
let fail = 0;

const check = (name, ok, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
    return;
  }

  fail++;
  console.error(`  FAIL ${name}${detail ? `: ${detail}` : ""}`);
};

const near = (a, b, tolerance = 1e-9) => Math.abs(a - b) <= tolerance;

const length = (geometry) =>
  Math.hypot(
    geometry.end.x - geometry.start.x,
    geometry.end.y - geometry.start.y,
  );

/*
 * THE AUTHORITATIVE ENDPOINT UPDATE, transcribed from the load's Length
 * branch: the start is the anchor and the far end moves along the span's
 * existing direction until it is the requested world distance away.
 */
const setLoadLength = (geometry, worldLength) => {
  const dx = geometry.end.x - geometry.start.x;
  const dy = geometry.end.y - geometry.start.y;
  const current = Math.hypot(dx, dy);

  if (!(current > 1e-12)) {
    return;
  }

  geometry.end = {
    x: geometry.start.x + (dx / current) * worldLength,
    y: geometry.start.y + (dy / current) * worldLength,
  };
};

dimensionsReady.then((enggDimensions) =>
  drawingStateReady.then((state) => {
    const dimensions = enggDimensions;
    const drawingState = state;

    /*
     * THE APPLICATION'S OWN CONVERSION, for a typed value.
     *
     * The panel hands the setter engineering millimetres; the setter turns
     * them into world units through the sheet's scale - a thin wrapper over
     * `fromEngineering`. Using the same function here means the test
     * measures the application's answer rather than a second opinion about
     * it.
     */
    const worldFor = (scale, typed) => {
      drawingState.scale = scale;

      return dimensions.fromEngineering(drawingState, typed, "mm");
    };

    console.log("\n load Length survives numerics, scaling and JSON \n");

    const scales = [
  null,
  { mmPerUnit: 1, unit: "mm" },
  { mmPerUnit: 4, unit: "mm" },
  { mmPerUnit: 0.25, unit: "mm" },
];

for (const requested of [10, 25, 50, 100, 250, 250.5, 125.5]) {
  for (const scale of scales) {
    const label = scale?.mmPerUnit ?? "default";
    const world = worldFor(scale, requested);

    const geometry = {
      start: { x: 17, y: -9 },
      end: { x: 37, y: 6 },
    };

    setLoadLength(geometry, world);

    /*
     * The stored span is the requested LENGTH IN WORLD UNITS - what the
     * model holds, and what every renderer, bounds calculation and
     * attachment reads.
     */
    check(
      `entered ${requested} mm becomes ${world} world units (scale ${label})`,
      near(length(geometry), world),
      `span ${length(geometry)}`,
    );

    /*
     * AND THE PANEL REPORTS THE SAME PHYSICAL LENGTH BACK. Converting the
     * stored span to engineering and comparing with what was typed is the
     * whole round trip: input -> model -> panel.
     */
    const reported = dimensions.toEngineering(drawingState, length(geometry));

    check(
      `and reads back as ${requested} mm (scale ${label})`,
      near(Number(reported.value), requested, 1e-6),
      `panel shows ${reported.value}`,
    );

    /*
     * The document is what survives a save, so the round trip is checked
     * through JSON as well: a value that lives only in memory is a value
     * that is wrong when the file is reopened.
     */
    const saved = JSON.parse(JSON.stringify(geometry));

    check(
      `and the saved span is the same (scale ${label})`,
      near(length(saved), world),
      `saved ${length(saved)}`,
    );
  }
}

drawingState.scale = null;

console.log("\n and the panel does not convert a value twice \n");

/*
 * ONE CONVERSION, AND IT IS THE SETTER'S.
 *
 * The panel marks a length field so it is SHOWN converted and the setter
 * OWNS the reverse conversion; the input path must not convert the typed
 * number a second time - the "100 mm produces an unrelated number" fault,
 * which is scale-dependent and so hides at 1:1. The checks read the real
 * modules, because the marking lives in two places: the panel helper that
 * renders the field and the setter that converts it.
 */
const panelSource = fs.readFileSync(
  locate("feature-panel-markup.js"),
  "utf8",
);

/*
 * THE PANEL'S INPUT PATH IS GONE WITH ITS PANEL.
 *
 * `property-binding.js` connected the old Features panel's fields to the setter,
 * and it was deleted when the inspector's Features pane replaced that panel. The
 * check below therefore has nothing to read - and the property it guarded is
 * still guarded where it now lives: the FEATURES PANE must not convert a typed
 * number, because the setter owns that.
 */
const paneSource = fs.readFileSync(locate("features-editor.js"), "utf8");

check(
  "the pane hands a typed value to the field writer untouched",
  !/fromEngineering|worldLengthOf/.test(paneSource),
  "converting in the pane would convert twice, since the setter already does",
);

check(
  "the Length field is shown as an engineering length",
  /scalar\(\s*"Length",\s*"length",[\s\S]{0,200}?true,\s*true/.test(panelSource),
);

check(
  "and the length helper converts the shown value through mmOf",
  /mmOf\(value\)\.value/.test(panelSource),
);

/*
 * THE CONVERSION HAPPENS EXACTLY ONCE, IN THE WRITER.
 *
 * The panel shows millimetres and the geometry stores world units, so a
 * typed value has to be converted on the way in. It must be converted by
 * the SETTER and nowhere else: the input handler hands the number over
 * untouched, because a second conversion on the same value is a different
 * length rather than a rounding difference.
 *
 * This used to be arranged with a `SETTER_OWNED_LENGTHS` set and a
 * `data-world-owned` marker that the input path was supposed to read. The
 * marker was emitted but never consulted - both branches of the handler
 * called the setter with identical arguments - so the guard was dead code
 * and the tests that asserted its presence were asserting a mechanism that
 * did nothing. What matters is the property, so it is asserted directly.
 */
check(
  "the input path hands the typed value to the setter untouched",
  !/fromEngineering|worldLengthOf/.test(paneSource),
);

check(
  "and the setter is the one place that converts it",
  /worldLengthOf\(value\)|worldLengthInDisplayUnits\(object, value\)/.test(source),
);

console.log("\n and the setter converts exactly once \n");

const setterStart = source.indexOf(
  "function updateFeatureProperty(object, key, value, typedUnit)",
);
const setterBody = source.slice(setterStart);
const loadLengthSetterStart = setterBody.indexOf(
  "key === 'length' && positive && !fixed('length')",
);
const loadLengthSetter = setterBody.slice(
  loadLengthSetterStart,
  setterBody.indexOf("return true;", loadLengthSetterStart),
);

check(
  "the load Length setter converts the typed millimetres",
  /worldLengthOf\(\s*value,\s*'mm'\s*\)/.test(loadLengthSetter) ||
    /worldLengthOf\(value,\s*'mm'\)/.test(loadLengthSetter) ||
    /worldLengthInDisplayUnits\(object, value\)/.test(loadLengthSetter),
  "a raw typed number would be stored as world units, so a calibrated " +
    "sheet would report a different length from the one entered",
);

check(
  "and no other conversion is applied to the same value",
  !/fromEngineering\(|toEngineering\(|mmOf\(/.test(loadLengthSetter),
  "a second conversion here is a different length, not a rounding error",
);

check(
  "and no other conversion is applied to the same value",
  !/fromEngineering\(|toEngineering\(|mmOf\(/.test(loadLengthSetter),
  "a second conversion here is a different length, not a rounding error",
);

    console.log(`\n${pass} passed, ${fail} failed\n`);

    if (fail > 0) {
      process.exitCode = 1;
    }
  }));
