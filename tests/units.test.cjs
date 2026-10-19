/*
 * ========================================================
 * EDITABLE UNITS, AND WHAT CHANGING ONE MEANS
 * ========================================================
 *
 * A feature's magnitude carries a unit, and the unit is editable from the
 * feature's own Features panel - a load in kN/m, a force in N or kN, a moment
 * in N·m or kN·m.
 *
 * THE ONE RULE THAT MATTERS: CHANGING THE UNIT RELABELS, IT DOES NOT RESCALE.
 * 1 kN and 1000 N are the same force. If choosing "kN" divided the stored number
 * by a thousand, the act of tidying up a label would silently change the
 * engineering - which is the worst kind of bug, because the drawing would still
 * look right.
 *
 * And there is ONE authoritative unit per property: the panel reads it from the
 * feature and the drawing's own label is built from the same field, so the two
 * cannot state different units for the same quantity.
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

const profile = require(modulePath("load-profile.js")).default;
const state = require(modulePath("drawing-state.js")).default;
const annotations = require(modulePath("annotation-model.js")).default;

console.log("\n  a force's unit\n");

{
  const force = state.geometryFactories.force(
    { x: 0, y: 0 },
    { x: 0, y: -100 },
    { style: {} },
  );

  force.geometry.magnitude = 250;

  check(
    "a force starts in newtons",
    profile.forceUnit(force.geometry) === "N",
    profile.forceUnit(force.geometry),
  );

  const before = force.geometry.magnitude;

  profile.setForceUnit(force.geometry, "kN");

  check(
    "choosing kN changes the unit",
    profile.forceUnit(force.geometry) === "kN",
  );

  check(
    "and does NOT change the magnitude",
    force.geometry.magnitude === before,
    `250 became ${force.geometry.magnitude}`,
  );

  profile.setForceUnit(force.geometry, "tonnes");

  check(
    "an unknown unit falls back rather than being stored",
    profile.forceUnit(force.geometry) === "N",
    profile.forceUnit(force.geometry),
  );
}

console.log("\n  a moment's unit\n");

{
  const moment = state.geometryFactories.moment({ x: 0, y: 0 }, { style: {} });

  moment.geometry.magnitude = 40;

  check(
    "a moment starts in newton-metres",
    profile.momentUnit(moment.geometry) === "N\u00b7m",
    profile.momentUnit(moment.geometry),
  );

  const before = moment.geometry.magnitude;

  profile.setMomentUnit(moment.geometry, "kN\u00b7m");

  check(
    "choosing kN\u00b7m changes the unit",
    profile.momentUnit(moment.geometry) === "kN\u00b7m",
  );

  check(
    "and does NOT change the magnitude",
    moment.geometry.magnitude === before,
    `40 became ${moment.geometry.magnitude}`,
  );

  check(
    "the units offered are the ones the module understands",
    Array.isArray(profile.MOMENT_UNITS) &&
      profile.MOMENT_UNITS.length >= 2,
  );
}

console.log("\n  the drawing's label follows the feature's unit\n");

{
  const drawingState = state.createDrawingState();

  const force = state.geometryFactories.force(
    { x: 0, y: 0 },
    { x: 0, y: -100 },
    { style: {} },
  );

  force.id = "force_1";
  force.geometry.magnitude = 250;

  const moment = state.geometryFactories.moment({ x: 0, y: 0 }, { style: {} });
  moment.id = "moment_1";
  moment.geometry.magnitude = 40;

  drawingState.objects.push(force, moment);

  const textsFor = () => {
    const derived = [
      ...annotations.derivedAnnotations(force, drawingState),
      ...annotations.derivedAnnotations(moment, drawingState),
    ];

    /*
     * `textFor` is the model's own accessor for what an annotation SAYS, so the
     * test asks the same question the renderer asks rather than reaching into
     * the annotation's fields itself.
     */
    return derived
      .map((entry) => annotations.textFor(entry, drawingState))
      .join(" | ");
  };

  profile.setForceUnit(force.geometry, "N");
  profile.setMomentUnit(moment.geometry, "N\u00b7m");

  const before = textsFor();

  profile.setForceUnit(force.geometry, "kN");
  profile.setMomentUnit(moment.geometry, "kN\u00b7m");

  const after = textsFor();

  check(
    "the force's label states the force's unit",
    after.includes("kN"),
    after,
  );

  check(
    "and the moment's label states the moment's unit",
    after.includes("kN\u00b7m") || after.includes("kN\u00b7m"),
    after,
  );

  check(
    "the two labels changed, so the unit really is read from the feature",
    before !== after,
    `before "${before}" / after "${after}"`,
  );
}

console.log("\n  a load's unit, for comparison\n");

{
  const load = state.geometryFactories.load(
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    5,
    { style: {} },
  );

  const before = load.geometry.intensity;

  profile.setLoadUnit(load.geometry, "N/mm");

  check(
    "a load's unit changes without changing the load",
    profile.loadUnit(load.geometry) === "N/mm" &&
      load.geometry.intensity === before,
    `unit ${profile.loadUnit(load.geometry)}, intensity ${load.geometry.intensity}`,
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}

void dom;
