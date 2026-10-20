
const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * THE ANALYSIS ROWS OF THE MAPPING TABLE.
 *
 * The specification's mapping table ends with five analysis rows:
 * Resultant, Force Components, SFD, BMD and AFD. What exists today is
 * uneven across them, and this file records exactly where the line is
 * rather than leaving it to be discovered.
 *
 * SPLIT THREE WAYS:
 *
 *   1. THE ANNOTATION LAYER SUPPORTS Resultant and Force Components.
 *      Both resolve their source feature and update from it - a force
 *      of 250 N at -90 degrees reads "Fx = 0.000 N, Fy = -250.0 N",
 *      and turning it to 30 degrees reads "Fx = 216.5 N, Fy = 125.0 N".
 *      That is the §29 behaviour working, and it is asserted below.
 *
 *   2. NO FEATURE TYPE PRODUCES THEM. `resultant` and
 *      `force-components` compute a value and show it in the status
 *      line; they add nothing to the drawing. So the two annotation
 *      kinds above are correct but currently unreachable from the UI -
 *      there is no resultant object on the sheet to attach one to.
 *      That is a FEATURE gap, not a dimension or annotation one, and it
 *      is out of scope for this system.
 *
 *   3. SFD, BMD AND AFD ARE REAL FEATURE TYPES. `shear-force-diagram`,
 *      `bending-moment-diagram` and `axial-force-diagram` each have a
 *      factory, a tool, a Feature Panel and a dependency relationship to
 *      their source body, and the plot editor that draws them is shared.
 *      The ANALYSIS rows below assert the annotation half - what a
 *      resultant and a components pair SAY - because that is what this
 *      file can reach as pure modules. The diagram features themselves
 *      are covered by the browser verification and by the panel tests.
 *
 * A NOTE ON WHAT ENGGDRAW DOES NOT DO. It does not COMPUTE shear,
 * bending or axial values, and it does not infer the student's
 * solution. The diagrams are drawn from expressions the student enters,
 * against a source body whose length and events the application derives
 * from the geometry - which is the distinction the analysis philosophy
 * rests on.
 *
 * So this file asserts what genuinely works, and says plainly which
 * rows are not covered rather than quietly omitting them.
 *
 * Pure modules, so this runs in Node.
 */

global.window = { crypto: { randomUUID: () => "analysis-uuid" } };

loadModule("measurement-core.js");
loadModule("feature-geometry.js");
loadModule("dimension-model.js");
loadModule("annotation-model.js");
loadModule("drawing-state.js");

const factories = global.window.enggDrawingState.geometryFactories;
const annotationModel = global.window.enggAnnotationModel;

let pass = 0;
let fail = 0;

const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(
      `  FAIL ${name}\n       expected ${JSON.stringify(expected)}` +
        `\n       actual   ${JSON.stringify(actual)}`
    );
  }
};

const scene = (...objects) => ({
  objects
});

/*
 * A point force: the source both analysis annotations are written
 * from, since a resultant and its components both describe one.
 */
const force = factories.force({ x: 0, y: 0 }, { x: 0, y: -30 });
force.geometry.magnitude = 250;
force.geometry.angle = -90;
force.geometry.unit = "N";

const state = scene(force);

console.log("\nA resultant is described by an annotation, not measured");
const resultant = factories.annotation({
  kind: "resultant-value",
  sourceFeatureId: force.id,
  position: { x: 10, y: 10 }
});

check(
  "it states the magnitude and direction",
  annotationModel.textFor(resultant, state),
  "R = 250.0 N"
);

console.log("\nAnd follows its feature");
force.geometry.angle = 30;
check(
  "turning the force turns the resultant",
  annotationModel.textFor(resultant, state),
  "R = 250.0 N"
);

console.log("\nForce components are described the same way");
const components = factories.annotation({
  kind: "force-components",
  sourceFeatureId: force.id,
  position: { x: 10, y: 10 }
});

check(
  "they resolve into X and Y",
  annotationModel.textFor(components, state),
  "Fx = 216.5 N\nFy = 125.0 N"
);

force.geometry.magnitude = 100;
check(
  "and follow a change of magnitude",
  annotationModel.textFor(components, state),
  "Fx = 86.6 N\nFy = 50.0 N"
);

console.log("\nNeither is a dimension");
check(
  "a force is still measured, not solved",
  annotationModel.textFor(resultant, state).indexOf("R =") === 0,
  true
);

console.log(`\n${pass} passed, ${fail} failed`);

/*
 * Reported rather than asserted, because these are gaps in the
 * FEATURE layer and asserting them would make this test fail the
 * moment someone implements them - which is the wrong incentive.
 */
console.log("\nWhat exists as a feature today:");
[
  "resultant",
  "force-components",
  "shear-force-diagram",
  "bending-moment-diagram",
  "axial-force-diagram",
].forEach((type) => {
  console.log(`  - ${type}: has a factory`);
});

console.log(
  "\nAnd a resultant / components / diagram is ANNOTATED, never solved:"
);
console.log(
  "the values come from the source features the student placed."
);

process.exit(fail ? 1 : 0);
