/*
 * ========================================================
 * ONE CLICK ON A LENGTH-BEARING OBJECT IS A WHOLE REFERENCE
 * ========================================================
 *
 * The workflow this file pins down:
 *
 *     Dimension
 *       -> click a Beam (the object itself, not its endpoints)
 *       -> press Enter
 *       -> a LENGTH dimension is produced, with its measured value
 *       -> placement follows the cursor
 *       -> click commits it
 *
 * The regression it exists to catch is the one where Enter on a SINGLE
 * reference produced nothing at all: the tool accepted the click, told
 * the student to press Enter, and then failed silently because the
 * inference was asked only for PAIRS. A lone line is not half a
 * measurement - it is a complete one - and a lone point is the only
 * reference that is genuinely incomplete.
 *
 * The functions are lifted out of drawing.js by brace matching, the way
 * the other drawing.js tests do it, because the question is what THESE
 * functions do and not what a reimplementation would do.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const { controllerSource, loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
const dir = path.join(__dirname, "..");
const source = controllerSource();

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

function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return null;
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
});
global.window = dom.window;
global.document = dom.window.document;

for (const name of [
  "measurement-core.js",
  "quantities.js",
  "dimension-model.js",
  "drawing-state.js",
  "feature-geometry.js",
]) {
  loadModule(name);
}

const measurement = global.window.enggMeasurement;
const dimModel = global.window.enggDimensionModel;
const stateMod = global.window.enggDrawingState;

/*
 * The features the specification names, each a straight body whose
 * intrinsic measurement is its own length. A Cable and a Shaft carry
 * extra fields because that is what those features really have, and a
 * dimension must not depend on which of them it is.
 */
const LENGTH_BEARING = [
  ["Line", { id: "line-1", type: "line", geometry: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } } }],
  ["Beam", { id: "beam-1", type: "beam", geometry: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, depth: 12 } }],
  ["Truss", { id: "truss-1", type: "truss", geometry: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } } }],
  ["Cable", { id: "cable-1", type: "cable", geometry: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } } }],
  ["Shaft", { id: "shaft-1", type: "shaft", geometry: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, diameter: 20 } }],
  ["Reference Line", { id: "ref-1", type: "reference-line", geometry: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } } }],
];

const OBJECTS = LENGTH_BEARING.map(([, object]) => object).concat([
  { id: "circle-1", type: "circle", geometry: { center: { x: 0, y: 0 }, radius: 25 } },
  { id: "arc-1", type: "arc", geometry: { center: { x: 0, y: 0 }, radius: 10, startAngle: 0, endAngle: Math.PI / 2 } },
  { id: "refarc-1", type: "reference-arc", geometry: { center: { x: 0, y: 0 }, radius: 10, startAngle: 0, endAngle: Math.PI } },
  { id: "pt-1", type: "point", geometry: { position: { x: 0, y: 0 } } },
  { id: "pt-2", type: "point", geometry: { position: { x: 100, y: 0 } } },
  ["polyline", { id: "pl-1", type: "polyline", geometry: { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }] } }],
].map((entry) => (Array.isArray(entry) ? entry[1] : entry)));

const byId = (id) => OBJECTS.find((o) => o.id === id) || null;

const sandbox = {
  console,
  enggMeasurement: measurement,
  enggDimensionModel: dimModel,
  objectWithId: byId,
  twoPointSpanOf: (o) => measurement.twoPointSpan(o),
  window: { enggFeatureGeometry: global.window.enggFeatureGeometry || {} },
  findDimensionTarget: () => null,
  distanceToSegment: () => Infinity,
  pointInsideOutline: () => false,
  drawingState: { objects: OBJECTS },
  engDrawingState: stateMod,
};

vm.createContext(sandbox);

const pieces = [
  "distanceToSegment",
  "pointInsideOutline",
  "compositeSegmentPoints",
  "compositeSegmentReference",
  "dimensionReferenceForFeature",
  "directionOfFeature",
  "referenceSpan",
  "spanUnitDirection",
  "lineLengthDescriptor",
  "spanDimensionType",
  "resolveRefPoint",
  "pairOrientation",
  "pointPairDescriptor",
  "pointToLineDescriptor",
  "sameLineReference",
  "perpendicularDistanceDescriptor",
  "inferDimensionDescriptor",
  "inferDimensionSelection",
  /*
   * THE CIRCULAR HELPERS TOO.
   *
   * `dimensionReferenceForFeature` asks `circularMeasurementTypes` which
   * measurements a circle or an arc offers, and `circularPreference` which one the
   * cursor is pointing at. They live beside it in drawing.js and are lifted out
   * the same way, so the circle and arc references below are resolved by the real
   * implementation rather than by a stand-in - which is the whole point of
   * extracting the functions instead of reimplementing them.
   */
  "circularMeasurementTypes",
  "preferredCircularType",
].map(extract).filter(Boolean);

check(
  "the inference functions were recovered from drawing.js",
  pieces.length >= 10,
  `only ${pieces.length} functions extracted`,
);

vm.runInContext(
  /*
   * `circularMeasurementTypes` filters the layer's declared measurements to the
   * circular ones, and the list it filters is a module-level constant rather than
   * a function - the extractor finds functions by brace matching, so the constant
   * is restored here, at the same value, before the functions run.
   */
  'const CIRCULAR_MEASUREMENTS = ["diameter", "radius", "arc-length"];' +
    pieces.join("\n") +
    "\nthis.refForFeature = dimensionReferenceForFeature;" +
    "\nthis.infer = inferDimensionDescriptor;" +
    "\nthis.inferSelection = inferDimensionSelection;",
  sandbox,
);

const refForFeature = sandbox.refForFeature;
const infer = sandbox.infer;

/*
 * THE ENTER PATH, reproduced exactly as commitDimensionSelection now
 * routes it. Kept as a small local mirror so the test states the RULE
 * rather than merely calling the implementation back.
 */
const descriptorFor = (picked) =>
  picked.length === 1
    ? infer(picked[0], null)
    : picked.length === 2
      ? infer(picked[0], picked[1])
      : sandbox.inferSelection(picked);

const stateFor = () => {
  const state = stateMod.createDrawingState();
  state.objects = OBJECTS;
  return state;
};

console.log("\n  A SINGLE LENGTH-BEARING OBJECT IS A WHOLE REFERENCE\n");

for (const [label, object] of LENGTH_BEARING) {
  const reference = refForFeature(object, {
    x: 50,
    y: 0,
  });

  check(
    `${label}: one click is resolved as a line, not a point`,
    reference?.kind === "line",
    `resolved to ${JSON.stringify(reference?.kind)}`,
  );

  const descriptor = descriptorFor([reference]);

  check(
    `${label}: Enter on that one reference yields a descriptor`,
    Boolean(descriptor?.refs?.length),
    `got ${JSON.stringify(descriptor)}`,
  );

  if (!descriptor?.refs?.length) continue;

  const state = stateFor();
  const dimension = dimModel.createDimension({
    dimensionType: descriptor.dimensionType,
    refs: descriptor.refs,
    placement: { x: 50, y: 20 },
  });

  const text = dimModel.formatMeasurement(dimension, state);

  check(
    `${label}: and the dimension states its measured length with a unit`,
    /^100(\.0+)?\s*mm$/.test(String(text)),
    `read ${JSON.stringify(text)} - a blank or unitless value is the defect`,
  );

  check(
    `${label}: with no approximation mark`,
    !String(text).includes("~"),
    `read ${JSON.stringify(text)}`,
  );
}

console.log("\n  A CIRCLE AND AN ARC ARE WHOLE REFERENCES TOO\n");

{
  const circleRef = refForFeature(byId("circle-1"), { x: 25, y: 0 });
  const circleDescriptor = descriptorFor([circleRef]);
  const state = stateFor();
  const dim = dimModel.createDimension({
    dimensionType: circleDescriptor.dimensionType,
    refs: circleDescriptor.refs,
    placement: { x: 0, y: 0 },
  });

  check(
    "a circle yields a diameter, and a diameter of 50 mm",
    circleDescriptor.dimensionType === "diameter" &&
      /50(\.0+)?\s*mm/.test(String(dimModel.formatMeasurement(dim, state))),
    `${circleDescriptor.dimensionType} :: ${dimModel.formatMeasurement(dim, state)}`,
  );

  const arcRef = refForFeature(byId("arc-1"), { x: 10, y: 0 });
  const arcDescriptor = descriptorFor([arcRef]);

  check(
    "an arc yields a radius",
    arcDescriptor?.dimensionType === "radius",
    JSON.stringify(arcDescriptor?.dimensionType),
  );
}

console.log("\n  A SINGLE POINT IS THE ONLY INCOMPLETE REFERENCE\n");

{
  const pointRef = { kind: "point", featureId: "pt-1", anchor: "position", ref: { featureId: "pt-1", anchor: "position" } };

  check(
    "a lone point infers no measurement",
    descriptorFor([pointRef]) === null,
    JSON.stringify(descriptorFor([pointRef])),
  );

  const distance = descriptorFor([
    pointRef,
    { kind: "point", featureId: "pt-2", anchor: "position", ref: { featureId: "pt-2", anchor: "position" } },
  ]);

  check(
    "but two points still produce a distance",
    Boolean(distance?.refs?.length),
    JSON.stringify(distance),
  );
}

console.log("\n  MULTI-REFERENCE SELECTION STILL WORKS\n");

{
  const lineA = refForFeature(byId("line-1"), { x: 50, y: 0 });
  const lineB = refForFeature(
    { id: "line-2", type: "line", geometry: { start: { x: 0, y: 0 }, end: { x: 0, y: 100 } } },
    { x: 0, y: 50 },
  );

  const angle = descriptorFor([lineA, lineB]);

  check(
    "two lines still produce an angle",
    angle?.dimensionType === "angular",
    JSON.stringify(angle?.dimensionType),
  );
}

console.log("\n  THE PROMPT TELLS THE TRUTH ABOUT WHAT ENTER WILL DO\n");

/*
 * As the drawing controller words it. A complete object says its length
 * is available; only a set that cannot measure asks for another
 * reference. The old wording told a student who had just clicked a Beam
 * to "keep picking", which was a lie about a complete reference.
 */
const instruction = (refs) => {
  const count = refs.length;
  if (count === 1) {
    return refs[0].kind === "point"
      ? "1 point selected - pick another reference, or press Enter"
      : "1 selected - Length available - press Enter to dimension";
  }
  const lines = refs.filter((r) => r.kind === "line");
  if (lines.length === count && count >= 2) {
    return `${count} lines selected - press Enter to create angle`;
  }
  return `${count} references selected - press Enter to dimension`;
};

{
  const beam = refForFeature(byId("beam-1"), { x: 50, y: 0 });

  const beamPrompt = instruction([beam]);

  check(
    "a selected Beam is told its Length is already available",
    /Length available/i.test(beamPrompt) &&
      !/keep picking|second point/i.test(beamPrompt),
    JSON.stringify(beamPrompt),
  );

  const pointPrompt = instruction([
    { kind: "point", featureId: "pt-1", anchor: "position" },
  ]);

  check(
    "a lone point is asked for another reference",
    /another reference/i.test(pointPrompt),
    JSON.stringify(pointPrompt),
  );
}

console.log("\n  TWO SIDES OF ONE PART: PARALLEL IS A DISTANCE, ELSE AN ANGLE\n");

/*
 * A RECTANGLE IS ONE FEATURE WITH FOUR EDGES.
 *
 * Two of those edges are two different lines, and which measurement they
 * make follows from the geometry, not from the fact that they belong to
 * the same body:
 *
 *   adjacent edges (perpendicular) -> the angle between them
 *   opposite edges (parallel)      -> the distance between them
 *
 * The identity of a reference is its ANCHOR, not its feature, and the
 * direction used is the DIRECTION OF THE EDGE rather than of the whole
 * closed chain - a rectangle has no overall start-to-end span, so a
 * direction taken from the body measured nothing at all.
 */
{
  const rectangle = {
    id: "rect-1",
    type: "rectangle",
    geometry: {
      position: { x: 0, y: 0 },
      width: 100,
      height: 40,
      rotation: 0,
    },
    style: {},
    metadata: {},
  };

  OBJECTS.push(rectangle);

  const edge = (index) => ({
    kind: "line",
    featureId: "rect-1",
    anchor: `segment${index}Start`,
    endAnchor: `segment${index}End`,
    object: rectangle,
  });

  const bottom = edge(0);
  const right = edge(1);
  const top = edge(2);

  const adjacent = descriptorFor([bottom, right]);

  check(
    "two adjacent edges of one part give an ANGLE",
    adjacent?.dimensionType === "angular",
    JSON.stringify(adjacent?.dimensionType),
  );

  const opposite = descriptorFor([bottom, top]);

  check(
    "two parallel edges of one part give a DISTANCE, not a zero angle",
    opposite?.dimensionType === "point-line",
    JSON.stringify(opposite?.dimensionType),
  );

  if (opposite?.refs?.length) {
    const state = stateFor();
    const dim = dimModel.createDimension({
      dimensionType: opposite.dimensionType,
      refs: opposite.refs,
      placement: { x: 50, y: 20 },
    });

    check(
      "and that distance is the 40 mm between them",
      /40(\.0+)?\s*mm/.test(String(dimModel.formatMeasurement(dim, state))),
      String(dimModel.formatMeasurement(dim, state)),
    );
  }

  check(
    "the SAME edge twice is still refused - it is one line, not two",
    descriptorFor([bottom, edge(0)]) === null,
    JSON.stringify(descriptorFor([bottom, edge(0)])),
  );
}

console.log("\n  AN ANGLE DOES NOT DEPEND ON WHICH WAY A LINE WAS DRAWN\n");

/*
 * The defect this pins down: taking the angle between each span's raw
 * start-to-end vector made the SAME two lines read 60 or 120 degrees
 * according to nothing but the order their endpoints happened to be
 * saved in. The angle between two lines is a fact about the lines, so
 * reversing one must not change it.
 */
{
  const outward = (id, end) => ({
    id,
    type: "line",
    geometry: { start: { x: 0, y: 0 }, end },
    style: {},
    metadata: {},
  });

  const axis = outward("ax", { x: 100, y: 0 });
  const tilted = outward("tl", { x: 50, y: 86.60254037844386 });

  const reversed = (object) => ({
    ...object,
    geometry: { start: object.geometry.end, end: object.geometry.start },
  });

  const angleOf = (a, b) => {
    const state = stateMod.createDrawingState();
    state.objects = [a, b];

    const dim = dimModel.createDimension({
      dimensionType: "angular",
      refs: [
        { featureId: a.id, anchor: "start" },
        { featureId: b.id, anchor: "start" },
      ],
      placement: { x: 30, y: 30 },
    });

    return String(dimModel.formatMeasurement(dim, state));
  };

  const baseline = angleOf(axis, tilted);

  check(
    "two lines 60 degrees apart read 60",
    /^60(\.0+)?°$/.test(baseline),
    baseline,
  );

  check(
    "reversing the first line does not change the angle",
    angleOf(reversed(axis), tilted) === baseline,
    `${angleOf(reversed(axis), tilted)} vs ${baseline}`,
  );

  check(
    "nor does reversing the second",
    angleOf(axis, reversed(tilted)) === baseline,
    `${angleOf(axis, reversed(tilted))} vs ${baseline}`,
  );

  check(
    "nor does reversing both",
    angleOf(reversed(axis), reversed(tilted)) === baseline,
    `${angleOf(reversed(axis), reversed(tilted))} vs ${baseline}`,
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail) process.exitCode = 1;
