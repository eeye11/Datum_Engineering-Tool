/*
 * ========================================================
 * ONE LOAD UNIT, READ FROM THE LOAD
 * ========================================================
 *
 * A distributed load's magnitude is a physical quantity, and it is stated
 * in kN/m or N/mm. Those two are the SAME physical value - one kilonewton
 * per metre IS one newton per millimetre - so switching between them
 * changes the LABEL and never the number.
 *
 * The unit lives on the load, once. The drawing annotation and the Features
 * panel both read it from there, so the two can never show the same load in
 * different units - which is the drift this guards against.
 *
 * These drive the shared load module and the annotation model, so they test
 * the real reading rather than a copy of it.
 */

const path = require("path");
const { JSDOM } = require("jsdom");

const projectRoot = path.join(__dirname, "..");

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

const { createHarness } = require("./harness-renderer.cjs");

createHarness(projectRoot, JSDOM, require);

const { modulePath } = require("./helpers/source-path.cjs");

/*
 * The modules publish onto `window`, which is where every other test and the
 * application itself read them from.
 */
const profile = global.window.enggLoadProfile;
const model = global.window.enggAnnotationModel;
const state = require(modulePath("drawing-state.js")).default;

const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t;

console.log("\n  the unit lives on the load\n");

/*
 * A load with no unit recorded - an older file - reads as the drawing's own
 * long-standing unit, so it displays exactly as it always did.
 */
{
  check(
    "an absent unit reads as kN/m",
    profile.loadUnit({}) === "kN/m",
    `read ${profile.loadUnit({})}`,
  );

  check(
    "an unrecognised unit falls back to kN/m",
    profile.loadUnit({ loadUnit: "kg" }) === "kN/m",
    `read ${profile.loadUnit({ loadUnit: "kg" })}`,
  );

  check(
    "a recorded unit is read back",
    profile.loadUnit({ loadUnit: "N/mm" }) === "N/mm",
    `read ${profile.loadUnit({ loadUnit: "N/mm" })}`,
  );
}

/*
 * CHANGING THE UNIT DOES NOT CHANGE THE NUMBER. kN/m and N/mm are
 * numerically identical, so the stored magnitude is untouched and only the
 * label moves.
 */
{
  const geometry = { intensity: 5, loadUnit: "kN/m" };

  profile.setLoadUnit(geometry, "N/mm");

  check(
    "switching to N/mm keeps the magnitude",
    geometry.intensity === 5 && geometry.loadUnit === "N/mm",
    `intensity ${geometry.intensity}, unit ${geometry.loadUnit}`,
  );
}

console.log("\n  the popup reads a number and a unit from one edit\n");

/*
 * A bare number is read in the fallback unit, and a value with a unit names
 * its own - so a student may type "5 kN/m" and have the unit follow.
 */
{
  const bare = profile.readLoadValue("5", "kN/m");

  check(
    "a bare number uses the fallback unit",
    bare && bare.value === 5 && bare.unit === "kN/m",
    JSON.stringify(bare),
  );

  const named = profile.readLoadValue("5 N/mm", "kN/m");

  check(
    "a typed unit overrides the fallback",
    named && named.value === 5 && named.unit === "N/mm",
    JSON.stringify(named),
  );

  const spaced = profile.readLoadValue("  2.5   kN/m  ", "N/mm");

  check(
    "spacing and a typed unit are both handled",
    spaced && near(spaced.value, 2.5) && spaced.unit === "kN/m",
    JSON.stringify(spaced),
  );

  check(
    "an empty field is not a value",
    profile.readLoadValue("", "kN/m") === null,
  );

  check(
    "a non-number is not a value",
    profile.readLoadValue("heavy", "kN/m") === null,
  );

  /*
   * A UNIT IS READ WHATEVER QUANTITY IT BELONGS TO.
   *
   * The one reader serves load magnitudes (kN/m, N/mm) and force magnitudes
   * (N), so a typed unit is taken as given and the POPUP decides which units
   * it will offer. "5 kg" is therefore a number with an unrecognised unit,
   * not a parse failure - the unit control is what keeps the value in the
   * quantity the popup is asking about.
   */
  check(
    "a number with a unit is read, with that unit",
    (() => {
      const read = profile.readLoadValue("5 kg", "kN/m");
      return read && read.value === 5 && read.unit === "kg";
    })(),
    JSON.stringify(profile.readLoadValue("5 kg", "kN/m")),
  );

  check(
    "and a bare number keeps the popup's unit",
    (() => {
      const read = profile.readLoadValue("250", "N");
      return read && read.value === 250 && read.unit === "N";
    })(),
    JSON.stringify(profile.readLoadValue("250", "N")),
  );
}

console.log("\n  the drawing and the panel read the same unit\n");

/*
 * The annotation model builds the label from the load's own unit, so the
 * drawing shows exactly what the Features panel shows.
 */
const loadObject = (unit) => {
  const geometry = {
    start: { x: 0, y: 0 },
    end: { x: 200, y: 0 },
    intensity: 5,
    direction: -90,
    interval: 20,
    loadUnit: unit,
    points: [
      { t: 0, magnitude: 5 },
      { t: 1, magnitude: 5 },
    ],
  };

  const object = state.geometryFactories.load(
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    5,
    { loadUnit: unit },
  );

  object.geometry = geometry;

  return object;
};

{
  const kN = loadObject("kN/m");
  const N = loadObject("N/mm");

  const scene = (object) => ({
    objects: [object],
    display: { showMagnitudes: true, showUnits: true },
    selection: {
      selectedObjectIds: [],
      boxSelectionIds: [],
      hoveredObjectId: null,
    },
    interaction: { phase: "idle", preview: null, previewObjects: [] },
    camera: { zoom: 1, panX: 0, panY: 0 },
    styleDefaults: { stroke: "#000000", lineWidth: 0.5 },
    grid: { visible: false, spacing: 10 },
    snap: { enabled: false },
  });

  const kNAnnotation = model.derivedAnnotation(kN, scene(kN));
  const NAnnotation = model.derivedAnnotation(N, scene(N));

  const kNText = model.textFor(kNAnnotation, scene(kN));
  const NText = model.textFor(NAnnotation, scene(N));

  check(
    "a kN/m load is annotated in kN/m",
    kNText && kNText.includes("kN/m"),
    JSON.stringify(kNText),
  );

  check(
    "an N/mm load is annotated in N/mm",
    NText && NText.includes("N/mm"),
    JSON.stringify(NText),
  );

  check(
    "the two show the same NUMBER in their own unit",
    kNText && NText && kNText.replace(/kN\/m/, "") === NText.replace(/N\/mm/, ""),
    `kN/m: ${kNText}, N/mm: ${NText}`,
  );
}

console.log("\n  the geometry factory records the unit\n");

/*
 * A load built through the factory carries the unit it was given, and one
 * built with no unit carries the default - so a load always has an
 * authoritative unit to read.
 */
{
  const withUnit = state.geometryFactories.load(
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    5,
    { loadUnit: "N/mm" },
  );

  check(
    "the load factory records the unit it was given",
    withUnit.geometry.loadUnit === "N/mm",
    `unit ${withUnit.geometry.loadUnit}`,
  );

  const withoutUnit = state.geometryFactories.load(
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    5,
  );

  check(
    "and defaults to kN/m when none is given",
    withoutUnit.geometry.loadUnit === "kN/m",
    `unit ${withoutUnit.geometry.loadUnit}`,
  );

  const varying = state.geometryFactories["varying-load"](
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    0,
    10,
    { loadUnit: "N/mm" },
  );

  check(
    "a varying load records one unit for its whole profile",
    varying.geometry.loadUnit === "N/mm",
    `unit ${varying.geometry.loadUnit}`,
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
