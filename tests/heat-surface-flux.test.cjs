/*
 * ========================================================
 * HEAT FLUX ON A SURFACE
 * ========================================================
 *
 * The Prescribed Heat-Flux Boundary was removed as a duplicate of the Heat Flux
 * arrow. This suite proves the arrow really does that job:
 *
 *   - a flux dropped on a boundary is SQUARED to it, at its midpoint;
 *   - it points OUT or IN, and the control flips it;
 *   - it re-squares when the boundary moves or turns;
 *   - it keeps the arrow's own object, label and editing.
 */
const { JSDOM } = require("jsdom");
const path = require("path");

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

const { createHarness } = require("./support/harness-renderer.cjs");

createHarness(projectRoot, JSDOM, require);

const { loadModule } = require("./helpers/source-path.cjs");

const model = loadModule("heat-model.js");

const point = (x, y) => ({ x, y });

/* ---------------------------------------------------------- the normal */

console.log("\nThe surface normal");
console.log("------------------");

const horizontal = model.createThermalBoundary({
  start: point(0, 0),
  end: point(100, 0),
  variant: "convection",
});

const outSpan = model.surfaceNormalArrow(horizontal);
const inSpan = model.surfaceNormalArrow(horizontal, undefined, true);

check(
  "the arrow starts at the boundary's midpoint",
  Math.abs(outSpan.start.x - 50) < 1e-9 && Math.abs(outSpan.start.y - 0) < 1e-9,
  JSON.stringify(outSpan.start),
);

check(
  "an OUTWARD flux is perpendicular to the boundary",
  Math.abs(outSpan.end.x - outSpan.start.x) < 1e-9 &&
    Math.abs(outSpan.end.y) > 1,
  JSON.stringify(outSpan.end),
);

check(
  "an INWARD flux points the other way",
  Math.sign(outSpan.end.y) === -Math.sign(inSpan.end.y),
  `${outSpan.end.y} vs ${inSpan.end.y}`,
);

/* A VERTICAL boundary gives a HORIZONTAL normal. */
const vertical = model.createThermalBoundary({
  start: point(0, 0),
  end: point(0, 100),
  variant: "convection",
});

const verticalNormal = model.surfaceNormalArrow(vertical);

check(
  "a vertical boundary's normal is horizontal",
  Math.abs(verticalNormal.end.y - verticalNormal.start.y) < 1e-9 &&
    Math.abs(verticalNormal.end.x) > 1,
  JSON.stringify(verticalNormal.end),
);

/* ---------------------------------------------------------- creation */

console.log("\nCreating a flux on a surface");
console.log("----------------------------");

const flux = model.createThermalArrow({
  start: point(40, -5),
  end: point(60, 30),
  variant: "heat-flux",
  surface: horizontal,
});

check(
  "the arrow records its host surface",
  flux.geometry.surfaceId === horizontal.id,
  flux.geometry.surfaceId,
);

check(
  "the student's own two points are OVERRIDDEN by the normal",
  Math.abs(flux.geometry.start.x - 50) < 1e-9 &&
    Math.abs(flux.geometry.start.y) < 1e-9,
  JSON.stringify(flux.geometry.start),
);

check(
  "it points outward by default",
  flux.geometry.inward === false && flux.geometry.end.y > 0,
  JSON.stringify(flux.geometry),
);

check(
  "it keeps the arrow's own type, variant and label family",
  flux.type === "thermal-arrow" && model.variantOf(flux) === "heat-flux",
);

/* A flux with NO surface is an ordinary free arrow. */
const freeFlux = model.createThermalArrow({
  start: point(0, 0),
  end: point(30, 40),
  variant: "heat-flux",
});

check(
  "a flux drawn in empty space is an ordinary free arrow",
  !freeFlux.geometry.surfaceId &&
    Math.abs(freeFlux.geometry.end.x - 30) < 1e-9 &&
    Math.abs(freeFlux.geometry.end.y - 40) < 1e-9,
  JSON.stringify(freeFlux.geometry),
);

/* ---------------------------------------------------------- direction */

console.log("\nFlipping the direction");
console.log("----------------------");

const objects = [horizontal, flux];

const before = { ...flux.geometry.end };

model.setSurfaceArrowInward(flux, true, objects);

check(
  "Into Surface points the other way through the boundary",
  Math.sign(flux.geometry.end.y) === -Math.sign(before.y) &&
    flux.geometry.inward === true,
  JSON.stringify(flux.geometry),
);

model.setSurfaceArrowInward(flux, false, objects);

check(
  "Out of Surface returns it",
  Math.sign(flux.geometry.end.y) === Math.sign(before.y) &&
    flux.geometry.inward === false,
);

/* ---------------------------------------------------------- reconcile */

console.log("\nFollowing its boundary");
console.log("----------------------");

/* Move the boundary: the flux must re-square to the new line. */
horizontal.geometry = {
  ...horizontal.geometry,
  start: point(0, 200),
  end: point(100, 200),
};

const moved = model.reconcileSurfaceArrows(objects);

check("a moved boundary reports the arrow it re-squared", moved === 1);

check(
  "the arrow follows the boundary to its new midpoint",
  Math.abs(flux.geometry.start.x - 50) < 1e-9 &&
    Math.abs(flux.geometry.start.y - 200) < 1e-9,
  JSON.stringify(flux.geometry.start),
);

check(
  "and stays perpendicular to it",
  Math.abs(flux.geometry.end.x - flux.geometry.start.x) < 1e-9,
  JSON.stringify(flux.geometry.end),
);

/* Turn the boundary 90 degrees: the flux becomes horizontal. */
horizontal.geometry = { start: point(0, 0), end: point(0, 100) };

model.reconcileSurfaceArrows(objects);

check(
  "a TURNED boundary turns its flux with it",
  Math.abs(flux.geometry.end.y - flux.geometry.start.y) < 1e-9 &&
    Math.abs(flux.geometry.end.x - flux.geometry.start.x) > 1,
  JSON.stringify(flux.geometry),
);

/* An unchanged boundary must not be "reconciled" into a fake edit. */
const settled = model.reconcileSurfaceArrows(objects);

check("a settled arrow is left alone (no spurious edit)", settled === 0);

/* A deleted boundary leaves the arrow readable, not deleted. */
check(
  "an orphaned flux is left as it was, never destroyed",
  model.reconcileSurfaceArrows([flux]) === 0,
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
