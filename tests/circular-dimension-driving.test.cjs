/*
 * ========================================================
 * A CIRCULAR DIMENSION DRIVES THE CIRCLE OR THE ARC
 * ========================================================
 *
 * The requirement: an explicitly entered target on a Driving circular dimension
 * must change the ACTUAL geometry - a diameter of 40 mm must leave a radius of 20,
 * a radius of 20 must leave a radius of 20, and an arc length must leave
 * `radius x |sweep|` equal to the target.
 *
 * THE ARC LENGTH IS THE ONE THIS FILE EXISTS FOR. Radius and diameter are size
 * keys the setter has always understood, but `arc-length` mapped to NO size key at
 * all: `sizeKeyFor` returned null, `dimensionEditable` said "reading only", and a
 * typed value was refused with `unsupported-type`. So an arc-length dimension
 * could be placed and measured and never driven. It is now driven by HOLDING THE
 * SWEEP AND CHANGING THE RADIUS, which is the honest reading of "make this arc
 * longer" - this file pins that the geometry follows and the sweep survives.
 *
 * The geometry is read back and the MEASURED value re-read from it, so a change
 * that moved the wrong property would show up as a value that does not match the
 * target rather than as a passing assertion about a property name.
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

const state = require(modulePath("drawing-state.js")).default;
const model = require(modulePath("dimension-model.js")).default;

/*
 * The edit module reads `enggDimensions` for its unit conversion and the drawing
 * state off the window, exactly as it does in the application - so the state is
 * published before the module is loaded.
 */
const enggDimensions = require(modulePath("dimensions.js")).default;
global.window.enggDimensions = enggDimensions;
global.enggDimensions = enggDimensions;

const edit = require(modulePath("dimension-edit.js"));

/* A drawing calibrated at 1 drawing unit = 1 mm, which makes the numbers literal. */
function calibratedState() {
  const st = state.createDrawingState();
  st.scale = { unitsPerMillimetre: 1, unit: "mm", calibrated: true };
  return st;
}

/* The measured value of a dimension, to two decimals. */
function measured(dimension, st) {
  const m = model.measurementFor(dimension, st);
  return m ? Math.round(m.value * 100) / 100 : null;
}

/* ============================================================
 * A DIAMETER DRIVES THE RADIUS THROUGH THE HALF
 * ============================================================ */

console.log("\n  a diameter target becomes a radius of half\n");

{
  const st = calibratedState();
  const F = state.geometryFactories;

  const circle = F.circle({ x: 40, y: 60 }, 15);
  state.addObject(st, circle);

  const dimension = F.dimension({
    dimensionType: "diameter",
    refs: [{ kind: "between", featureId: circle.id, anchor: "center" }],
    placement: { x: 40, y: 60 },
  });
  state.addObject(st, dimension);

  check(
    "the diameter is editable",
    edit.dimensionEditable(dimension, st) === true,
    "a circle's diameter is the most obviously editable measurement there is",
  );

  const result = edit.applyDimensionValue(dimension, st, 40);

  check(
    "applying 40 mm is accepted",
    result?.ok === true,
    `got ${JSON.stringify(result)}`,
  );

  check(
    "the circle's radius is now 20",
    Math.abs(Number(circle.geometry.radius) - 20) < 1e-6,
    `radius is ${circle.geometry.radius}`,
  );

  check(
    "and the dimension reads 40 mm back",
    measured(dimension, st) === 40,
    `reads ${measured(dimension, st)}`,
  );
}

/* ============================================================
 * A RADIUS DRIVES THE RADIUS DIRECTLY
 * ============================================================ */

console.log("\n  a radius target becomes that radius\n");

{
  const st = calibratedState();
  const F = state.geometryFactories;

  const circle = F.circle({ x: 0, y: 0 }, 15);
  state.addObject(st, circle);

  const dimension = F.dimension({
    dimensionType: "radius",
    refs: [{ kind: "between", featureId: circle.id, anchor: "center" }],
    placement: { x: 15, y: 0 },
  });
  state.addObject(st, dimension);

  const result = edit.applyDimensionValue(dimension, st, 20);

  check(
    "applying R20 is accepted",
    result?.ok === true,
    `got ${JSON.stringify(result)}`,
  );

  check(
    "the circle's radius is now 20",
    Math.abs(Number(circle.geometry.radius) - 20) < 1e-6,
    `radius is ${circle.geometry.radius}`,
  );

  check(
    "and the dimension reads 20 mm back",
    measured(dimension, st) === 20,
    `reads ${measured(dimension, st)}`,
  );
}

/* ============================================================
 * AN ARC LENGTH DRIVES THE RADIUS, AND THE SWEEP SURVIVES
 * ============================================================ */

console.log("\n  an arc length target keeps the sweep and grows the radius\n");

{
  const st = calibratedState();
  const F = state.geometryFactories;

  /* A quarter arc of radius 30: its length is 30 * pi/2 = 47.12 mm. */
  const arc = F.arc({ x: 0, y: 0 }, 30, 0, Math.PI / 2);
  state.addObject(st, arc);

  const dimension = F.dimension({
    dimensionType: "arc-length",
    refs: [{ kind: "between", featureId: arc.id, anchor: "start" }],
    placement: { x: 0, y: 0 },
  });
  state.addObject(st, dimension);

  const before = measured(dimension, st);

  check(
    "the arc length measures radius x sweep (47.12 mm)",
    Math.abs(before - 47.12) < 0.01,
    `reads ${before}`,
  );

  check(
    "an arc length on an arc is editable",
    edit.dimensionEditable(dimension, st) === true,
    "it drives the radius, so it is a size edit - but this said 'reading only'",
  );

  /*
   * Ask for a length that needs a radius of 60: 60 * pi/2 = 94.25 mm. A radius
   * that did NOT change, or a sweep that absorbed the change, would read back
   * something other than the target.
   */
  const target = 60 * (Math.PI / 2);

  const result = edit.applyDimensionValue(dimension, st, target);

  check(
    "applying the new length is accepted",
    result?.ok === true,
    `got ${JSON.stringify(result)}`,
  );

  check(
    "the arc's radius grew to 60",
    Math.abs(Number(arc.geometry.radius) - 60) < 1e-6,
    `radius is ${arc.geometry.radius}`,
  );

  check(
    "the sweep is unchanged",
    Math.abs(
      Math.abs(arc.geometry.endAngle - arc.geometry.startAngle) - Math.PI / 2,
    ) < 1e-9,
    `sweep is ${Math.abs(arc.geometry.endAngle - arc.geometry.startAngle)}`,
  );

  check(
    "and the dimension reads the target back",
    Math.abs(measured(dimension, st) - target) < 0.01,
    `asked ${target.toFixed(2)}, reads ${measured(dimension, st)}`,
  );
}

/* ============================================================
 * A DEGENERATE ARC IS REFUSED RATHER THAN DIVIDED BY
 * ============================================================ */

console.log("\n  a zero-sweep arc cannot be driven\n");

{
  const st = calibratedState();
  const F = state.geometryFactories;

  /* No sweep at all: there is no radius that yields any target length. */
  const arc = F.arc({ x: 0, y: 0 }, 30, Math.PI / 4, Math.PI / 4);
  state.addObject(st, arc);

  const dimension = F.dimension({
    dimensionType: "arc-length",
    refs: [{ kind: "between", featureId: arc.id, anchor: "start" }],
    placement: { x: 0, y: 0 },
  });
  state.addObject(st, dimension);

  check(
    "a zero-sweep arc is not editable",
    edit.dimensionEditable(dimension, st) === false,
    "there is no radius that makes a zero-length arc non-zero",
  );

  const result = edit.applyDimensionValue(dimension, st, 100);

  check(
    "and applying a value to it is refused, not applied as Infinity",
    result?.ok === false && Number.isFinite(Number(arc.geometry.radius)),
    `got ${JSON.stringify(result)}, radius ${arc.geometry.radius}`,
  );
}

/* ============================================================
 * A DRIVEN DIMENSION STILL REFUSES TO DRIVE
 * ============================================================ */

console.log("\n  a Driven circular dimension does not move the circle\n");

{
  const st = calibratedState();
  const F = state.geometryFactories;

  const circle = F.circle({ x: 0, y: 0 }, 15);
  state.addObject(st, circle);

  const dimension = F.dimension({
    dimensionType: "radius",
    refs: [{ kind: "between", featureId: circle.id, anchor: "center" }],
    placement: { x: 15, y: 0 },
    driven: true,
  });
  state.addObject(st, dimension);

  check(
    "a Driven radius is not editable",
    edit.dimensionEditable(dimension, st) === false,
    "Driven means reading only, whatever the value typed",
  );

  const result = edit.applyDimensionValue(dimension, st, 20);

  check(
    "and the circle's radius is untouched",
    Math.abs(Number(circle.geometry.radius) - 15) < 1e-6,
    `radius is ${circle.geometry.radius} - a Driven dimension must not move geometry`,
  );

  check(
    "the refusal names the Driven state",
    result?.ok === false && result.reason === "driven",
    `got ${JSON.stringify(result)}`,
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
