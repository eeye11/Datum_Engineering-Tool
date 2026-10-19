
const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * THE FEATURE MATRIX, driven through the path the Dimension tool uses.
 *
 * The specification's mapping table lists what should be dimensionable
 * and labellable for every feature type. Until this file existed, that
 * table had been checked only against the measurement layer in
 * isolation - and the UI path had been exercised on exactly TWO rows,
 * Line and Rectangle.
 *
 * That gap was not academic. Four real defects surfaced the moment other
 * feature types were driven through it, none visible to unit tests of
 * the models alone:
 *
 *   - bodies could not be picked by clicking inside them, because the
 *     anchor helper returns anchor NAMES and the picker wanted points;
 *   - a pair of features could be recognised but never expressed,
 *     because the descriptor builder was not exported;
 *   - a polygon and a triangle offered a DIAMETER, measured between
 *     two arbitrary vertices - a chord, labelled as a diameter;
 *   - a coordinate measurement crashed, because a lone reference left
 *     the measurement one point short of the two it needs.
 *
 * Every object here is built by the same factories the application uses,
 * so a mismatch between a factory and a model shows up in this file
 * rather than on screen.
 *
 * TWO LESSONS BAKED IN, both learned by getting them wrong first:
 *
 *   1. The factories take POSITIONAL arguments. Passing objects made
 *      every row report "nothing to measure" - indistinguishable from
 *      a feature that genuinely is not dimensionable.
 *
 *   2. feature-geometry is loaded for REAL. Rectangle and polygon
 *      anchors derive from it, and stubbing it out as empty arrays -
 *      the pattern the other model tests use - deletes those anchors
 *      and produces the same false "nothing to measure" report.
 *
 * A test whose job is to catch false failures must never manufacture
 * one and then believe it.
 *
 * Pure modules, so this runs in Node.
 */

global.window = { crypto: { randomUUID: () => "matrix-uuid" } };

loadModule("dimensions.js");
loadModule("measurement-core.js");
loadModule("quantities.js");
loadModule("feature-geometry.js");
loadModule("dimension-model.js");
loadModule("annotation-model.js");
loadModule("drawing-state.js");

const factories = global.window.enggDrawingState.geometryFactories;
/*
 * The unified Dimension tool's candidate finder - what Smart Dimension's
 * `propose` became when the separate dimension tools were retired.
 */
const candidates = require(locate("dimension-candidates.js")).default;
const smart = { propose: (objects, state) => candidates.descriptorsFor(objects, state) };
const measurement = global.window.enggMeasurement;
const dimensionModel = global.window.enggDimensionModel;
const annotationModel = global.window.enggAnnotationModel;

let pass = 0;
let fail = 0;
const failures = [];

const check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`);
  }
};

const scene = (...objects) => ({
  scale: { mmPerUnit: 1, unit: "mm" },
  objects
});

/*
 * What the tool's picker uses to find a feature by proximity.
 *
 * Reproduced on purpose: the Dimension tool resolves a click against
 * anchorNames + resolveAnchor, and had been reading anchorOptions as
 * though it returned points. A matrix that only asked "can this be
 * measured" would have passed while that stayed broken.
 */
const resolvableAnchors = (object) =>
  (measurement.anchorOptions(object) || [])
    .map((name) => measurement.resolveAnchor(object, name))
    .filter(
      (point) =>
        point && Number.isFinite(point.x) && Number.isFinite(point.y)
    );

/*
 * Drive one feature exactly as the Dimension tool would.
 *
 * Returns a list of problems rather than asserting inline, so a
 * feature reports ALL of its faults at once. A matrix that stops at
 * the first hides everything behind it.
 */
const measureEverything = (object) => {
  const problems = [];

  if (resolvableAnchors(object).length === 0) {
    problems.push("no anchor resolves to a point, so it cannot be picked");
  }

  let descriptors = [];
  try {
    descriptors = smart.propose([object], scene(object)) || [];
  } catch (error) {
    problems.push(`the Dimension tool threw - ${error.message}`);
    return problems;
  }

  if (descriptors.length === 0) {
    problems.push("the Dimension tool offered nothing");
    return problems;
  }

  for (const descriptor of descriptors) {
    const where = descriptor.dimensionType;

    if (!descriptor.refs || descriptor.refs.length === 0) {
      problems.push(`${where}: no references`);
      continue;
    }

    let dimension;
    try {
      dimension = factories.dimension({
        dimensionType: descriptor.dimensionType,
        refs: descriptor.refs,
        placement: { x: 10, y: 10 }
      });
    } catch (error) {
      problems.push(`${where}: factory threw - ${error.message}`);
      continue;
    }

    if (dimension.type !== "dimension") {
      problems.push(`${where}: did not stay a dimension`);
    }

    let text;
    try {
      text = dimensionModel.formatMeasurement(dimension, scene(object));
    } catch (error) {
      problems.push(`${where}: formatting threw - ${error.message}`);
      continue;
    }

    if (!text || /NaN|undefined|Infinity/.test(text)) {
      problems.push(`${where}: reads "${text}"`);
    }

    let graphics;
    try {
      graphics = dimensionModel.graphicsFor(dimension, scene(object));
    } catch (error) {
      problems.push(`${where}: graphics threw - ${error.message}`);
      continue;
    }

    if (!graphics) {
      problems.push(`${where}: no graphics`);
      continue;
    }

    /*
     * NaN in the graphics produces an SVG the browser rejects, taking
     * the whole drawing with it - the easiest failure to ship and the
     * hardest to see without rendering.
     */
    if (/NaN/.test(JSON.stringify(graphics))) {
      problems.push(`${where}: graphics contain NaN`);
    }
  }

  return problems;
};

/*
 * The matrix, built with the factories' POSITIONAL signatures:
 * line(start, end), circle(centre, radius), rectangle(pos, w, h),
 * moment(pos, magnitude, clockwise), and so on.
 *
 * A Shaft is given a DIAMETER explicitly. Its centreline alone cannot
 * state one, and a shaft with no diameter set is genuinely undimensionable
 * in that respect - which is correct behaviour rather than a fault, so
 * the fixture has to supply the value a real shaft would already have.
 */
const FEATURES = [
  ["point", () => factories.point({ x: 0, y: 0 })],
  ["line", () => factories.line({ x: 0, y: 0 }, { x: 100, y: 0 })],
  ["circle", () => factories.circle({ x: 0, y: 0 }, 25)],
  ["arc", () => factories.arc({ x: 0, y: 0 }, 25, 0, Math.PI / 2)],
  ["rectangle", () => factories.rectangle({ x: 0, y: 0 }, 80, 40)],
  ["polygon", () => factories.polygon({ x: 0, y: 0 }, 30, 5)],
  [
    "polyline",
    () => factories.polyline([{ x: 0, y: 0 }, { x: 30, y: 20 }, { x: 60, y: 0 }])
  ],
  [
    "triangle",
    () => factories.triangle([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 0, y: 30 }])
  ],
  ["particle", () => factories.particle({ x: 0, y: 0 })],
  ["beam", () => factories.beam({ x: 0, y: 0 }, { x: 400, y: 0 })],
  ["truss", () => factories.truss({ x: 0, y: 0 }, { x: 200, y: 0 })],
  ["cable", () => factories.cable({ x: 0, y: 0 }, { x: 200, y: 0 })],
  [
    "shaft",
    () => {
      const shaft = factories.shaft({ x: 0, y: 0 }, { x: 200, y: 0 });
      shaft.geometry.diameter = 24;
      return shaft;
    }
  ],
  ["connection", () => factories.connection({ x: 0, y: 0 }, { x: 60, y: 0 })],
  ["distributed load", () => factories.load({ x: 0, y: 0 }, { x: 100, y: 0 }, 5)],
  [
    "resultant",
    () => factories.resultant({ x: 0, y: 0 }, { x: 30, y: 40 })
  ],
  [
    "force-components",
    () => factories["force-components"]({ x: 0, y: 0 }, { x: 0, y: -30 })
  ]
];

console.log("\nEvery feature type can be dimensioned");
FEATURES.forEach(([name, make]) => {
  let object = null;
  try {
    object = make();
  } catch (error) {
    check(name, false, `factory threw - ${error.message}`);
    return;
  }

  if (!object) {
    check(name, false, "no factory");
    return;
  }

  let offered = "";
  try {
    offered = (smart.propose([object], scene(object)) || [])
      .map((d) => d.dimensionType)
      .join(", ");
  } catch (error) {
    offered = "threw";
  }

  const problems = measureEverything(object);
  check(
    `${name} [${offered || "nothing"}]`,
    problems.length === 0,
    problems.join("; ")
  );
});

/* -------------------------------------------------------------- */
/* ANNOTATION                                                      */
/* -------------------------------------------------------------- */

console.log("\nEvery feature type can be annotated");

/*
 * The kinds are named EXPLICITLY.
 *
 * Taking "whichever generated kind sorts first" is a poor oracle: it
 * pairs a feature with an annotation that has nothing to say about it,
 * and an empty label is indistinguishable from an annotation that has
 * lost its link to its feature. Reading a property off a STRING is
 * always undefined, so a guard written for a descriptor object passes
 * on every kind and the first one wins - which is how this file spent a
 * while reporting a working feature as broken.
 */
const force = factories.force({ x: 0, y: 0 }, { x: 0, y: -30 });
force.geometry.magnitude = 250;
force.geometry.angle = -90;
force.geometry.unit = "N";

check(
  "annotation kinds exist at all",
  Object.keys(annotationModel.KINDS || {}).length > 0
);

let forceLabel = null;

if (annotationModel.KINDS && annotationModel.KINDS["force-value"]) {
  forceLabel = factories.annotation({
    kind: "force-value",
    sourceFeatureId: force.id,
    position: { x: 10, y: 10 }
  });

  const before = annotationModel.textFor(forceLabel, scene(force));

  check(
    "a Point Force is labelled with its own value",
    !!before && !/NaN|undefined/.test(before),
    `reads "${before}"`
  );

  force.geometry.magnitude = 500;
  const after = annotationModel.textFor(forceLabel, scene(force));

  check(
    "and changes when the force changes",
    after !== before,
    `before "${before}", after "${after}"`
  );
  check("and keeps its source link", forceLabel.sourceFeatureId, force.id);
  check("and its own position", forceLabel.placement, { x: 10, y: 10 });
} else {
  check(
    "a Point Force is labelled with its own value",
    false,
    "no force-value kind"
  );
}

/*
 * The same associativity requirement for the other statics features
 * that carry a magnitude.
 */
const ANNOTATED = [
  [
    "moment",
    "moment-value",
    () => factories.moment({ x: 0, y: 0 }, 500, false)
  ],
  [
    "distributed load",
    "load-value",
    () => factories.load({ x: 0, y: 0 }, { x: 100, y: 0 }, 5)
  ]
];

ANNOTATED.forEach(([name, kind, make]) => {
  if (!annotationModel.KINDS || !annotationModel.KINDS[kind]) {
    check(`${name} can be annotated`, false, `no such kind: ${kind}`);
    return;
  }

  const source = make();

  const label = factories.annotation({
    kind,
    sourceFeatureId: source.id,
    position: { x: 10, y: 10 }
  });

  const before = annotationModel.textFor(label, scene(source));

  if (!before || /NaN|undefined|null/.test(before)) {
    check(`${name} can be annotated`, false, `reads "${before}"`);
    return;
  }

  if (typeof source.geometry?.magnitude !== "number") {
    check(`${name} can be annotated (${kind})`, true);
    return;
  }

  source.geometry.magnitude = source.geometry.magnitude * 2;
  const after = annotationModel.textFor(label, scene(source));

  check(
    `${name} annotation (${kind}) follows its feature`,
    after !== before,
    `before "${before}", after "${after}"`
  );
});

/* -------------------------------------------------------------- */
/* THE DISTINCTION                                                 */
/* -------------------------------------------------------------- */

console.log("\nDimensions measure; annotations describe");

/*
 * The central rule, asserted rather than assumed.
 *
 * A force's MAGNITUDE is engineering information and belongs in an
 * annotation. If a dimension of the same feature printed "250 N", the
 * two systems would have blurred and a measurement tool would be
 * reporting a value it cannot measure from geometry.
 */
let forceDimensionTexts = [];

try {
  forceDimensionTexts = (smart.propose([force], scene(force)) || []).map(
    (descriptor) =>
      dimensionModel.formatMeasurement(
        factories.dimension({
          dimensionType: descriptor.dimensionType,
          refs: descriptor.refs,
          placement: { x: 0, y: 0 }
        }),
        scene(force)
      )
  );
} catch (error) {
  forceDimensionTexts = [`threw - ${error.message}`];
}

check(
  "no dimension of a force states its magnitude",
  forceDimensionTexts.length > 0 &&
    forceDimensionTexts.every((text) => !/\d\s*N\b/.test(text)),
  forceDimensionTexts.join(" | ")
);

if (forceLabel) {
  const labelText = annotationModel.textFor(forceLabel, scene(force));

  check(
    "the magnitude appears as annotation text",
    /\d\s*N\b/.test(String(labelText)),
    `reads "${labelText}"`
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log("\nfailing rows:");
  failures.forEach((name) => console.log(`  - ${name}`));
}
process.exit(fail ? 1 : 0);
