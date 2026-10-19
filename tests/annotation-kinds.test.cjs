
const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * WHICH LABELS A FEATURE CAN CARRY.
 *
 * `kindsFor` answers "what may be written on this feature", and the
 * Annotation tool is built on it - it offers exactly what it returns.
 * So the two have to agree: offering a kind that produces nothing draws
 * an empty box, and withholding one that would work leaves the student
 * with no way to label something they are looking at.
 *
 * The interesting cases here are the ones the obvious implementation
 * gets wrong.
 *
 * PROBING IS NOT ENOUGH ON ITS OWN
 * -------------------------------
 * The natural implementation asks each kind whether it can produce text
 * for this feature. That works until two kinds of feature share a
 * datum: a moment holds a magnitude, just as a force does, so a probe
 * would happily hand a moment the force label and print "F = 500 N"
 * about it - calling a moment a force, and meaning it.
 *
 * So a kind also DECLARES what it describes. That is what tells a force
 * from a moment; the probe only says whether the text came out
 * non-empty.
 *
 * Pure modules, so this runs in Node.
 */

global.window = { crypto: { randomUUID: () => "kinds-uuid" } };

loadModule("measurement-core.js");
loadModule("feature-geometry.js");
loadModule("annotation-model.js");
loadModule("drawing-state.js");

const factories = global.window.enggDrawingState.geometryFactories;
const model = global.window.enggAnnotationModel;

let pass = 0;
let fail = 0;
const failures = [];

const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(
      `  FAIL ${name}\n       expected ${JSON.stringify(expected)}` +
        `\n       actual   ${JSON.stringify(actual)}`
    );
  }
};

const scene = (...objects) => ({
  scale: { mmPerUnit: 1, unit: "mm" },
  objects
});

/*
 * A force, with the values a placed one would have.
 */
const force = factories.force({ x: 0, y: 0 }, { x: 0, y: -30 });
force.geometry.magnitude = 250;
force.geometry.angle = -90;
force.geometry.unit = "N";

const moment = factories.moment({ x: 0, y: 0 }, 500, false);
const load = factories.load({ x: 0, y: 0 }, { x: 100, y: 0 }, 5);
const line = factories.line({ x: 0, y: 0 }, { x: 100, y: 0 });
const beam = factories.beam({ x: 0, y: 0 }, { x: 400, y: 0 });

console.log("\nA force can be labelled with its value or its components");
check("force-value", model.kindsFor(force, scene(force)).includes("force-value"), true);
check("force-components", model.kindsFor(force, scene(force)).includes("force-components"), true);

console.log("\nAnd leads with the one that says the most");
check(
  "the default kind is the first offered",
  model.kindsFor(force, scene(force))[0],
  "force-value"
);

console.log("\nA moment is NOT a force");
check(
  "it offers its own value",
  model.kindsFor(moment, scene(moment)).includes("moment-value"),
  true
);
check(
  "and is never offered the force label",
  model.kindsFor(moment, scene(moment)).includes("force-value"),
  false
);

console.log("\nA load offers only load values");
check(
  "load-value",
  model.kindsFor(load, scene(load)).includes("load-value"),
  true
);
check(
  "and nothing that describes something else",
  model.kindsFor(load, scene(load)).includes("moment-value"),
  false
);

console.log("\nPlain geometry has nothing to say for itself");
check("a line offers no generated label", model.kindsFor(line, scene(line)), []);
check("a beam offers no generated label", model.kindsFor(beam, scene(beam)), []);

console.log("\nAnd nothing is offered without a feature");
check("no feature, no labels", model.kindsFor(null, scene()), []);

console.log("\nEvery offered kind really does produce text");
/*
 * The guarantee the tool relies on: what is offered is what will
 * appear. An empty box on the drawing is worse than no offer at all,
 * because it looks like a mistake in the drawing rather than in the
 * tool.
 */
[force, moment, load].forEach((feature) => {
  const kinds = model.kindsFor(feature, scene(feature));

  const empties = kinds.filter((kind) => {
    const probe = {
      annotationKind: kind,
      textMode: "auto",
      text: "",
      sourceFeatureId: feature.id
    };

    const text = model.textFor(probe, scene(feature));

    return !text || !text.trim();
  });

  check(
    `${feature.type}: ${kinds.length} kinds, none empty`,
    empties,
    []
  );
});

console.log("\nA resultant is described like the force it replaces");
const resultant = factories.resultant({ x: 0, y: 0 }, { x: 30, y: 40 });
check(
  "offered the resultant's own value",
  model.kindsFor(resultant, scene(resultant)).includes("resultant-value"),
  true
);
check(
  "and reads it",
  (() => {
    const probe = {
      annotationKind: "resultant-value",
      textMode: "auto",
      text: "",
      sourceFeatureId: resultant.id
    };
    return model.textFor(probe, scene(resultant));
  })(),
  "R = 50.0 N"
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log("\nfailing rows:");
  failures.forEach((name) => console.log(`  - ${name}`));
}
process.exit(fail ? 1 : 0);
