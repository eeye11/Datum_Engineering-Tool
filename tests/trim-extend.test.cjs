/*
 * ========================================================
 * TRIM AND EXTEND WORK ON ANY STRAIGHT BODY
 * ========================================================
 *
 * A Beam, a Cable, a Shaft, a Truss and a Reference Line are each a
 * straight line between two ends. Trimming one to a boundary and
 * extending one to a boundary are therefore the SAME operations as for a
 * Line - and the trim/extend code used to refuse every one of them with
 * "Only lines can be trimmed", because it tested the feature's TYPE NAME
 * rather than its geometry.
 *
 * The test is now the geometry: anything with two ends can be cut. That
 * is the same `twoPointSpanOf` the measurement layer uses, so what can
 * be trimmed is exactly what can be measured - one answer to "is this a
 * line", asked in one place.
 *
 * The functions are lifted from drawing.js by brace matching, the way
 * the other drawing.js tests do it.
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

/*
 * The straight bodies, each the same 100-unit horizontal line, and a
 * VERTICAL line crossing it. The vertical one is the boundary.
 */
const STRAIGHT_BODIES = [
  ["Line", { id: "line-1", type: "line", geometry: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } } }],
  ["Beam", { id: "beam-1", type: "beam", geometry: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, depth: 12 } }],
  ["Truss", { id: "truss-1", type: "truss", geometry: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } } }],
  ["Cable", { id: "cable-1", type: "cable", geometry: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } } }],
  ["Shaft", { id: "shaft-1", type: "shaft", geometry: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, diameter: 20 } }],
  ["Reference Line", { id: "ref-1", type: "reference-line", geometry: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } } }],
];

const BOUNDARY = {
  id: "boundary-1",
  type: "line",
  geometry: { start: { x: 50, y: -50 }, end: { x: 50, y: 50 } },
};

const stateMod = global.window.enggDrawingState;

const ALL = [...STRAIGHT_BODIES.map(([, o]) => o), BOUNDARY];
const byId = (id) => ALL.find((o) => o.id === id) || null;

/*
 * A REAL drawing state, so `commitDrawingChange` has a history to push
 * onto. The trim/extend functions commit their edit as one action, and a
 * sandbox without a history would fail for a reason that has nothing to
 * do with what is being tested.
 */
const state = stateMod.createDrawingState();
state.objects = ALL;

const sandbox = {
  console,
  enggMeasurement: measurement,
  enggDrawingState: stateMod,
  twoPointSpanOf: (o) => measurement.twoPointSpan(o),
  objectWithId: byId,
  window: { enggFeatureGeometry: global.window.enggFeatureGeometry },
  setToolMessage: () => {},
  cancelModifySession: () => {},
  renderProperties: () => {},
  renderCurrentDrawing: () => {},
  drawingState: state,
};

vm.createContext(sandbox);

const pieces = [
  "segmentIntersectionPoint",
  "segmentParameter",
  "boundarySegments",
  "nearestIntersectionOnLine",
  "trimObjectToBoundary",
  "extendObjectToBoundary",
].map(extract).filter(Boolean);

check(
  "the trim/extend functions were recovered from drawing.js",
  pieces.length >= 4,
  `only ${pieces.length} extracted`,
);

vm.runInContext(
  pieces.join("\n") +
    "\nthis.trim = trimObjectToBoundary;" +
    "\nthis.extend = extendObjectToBoundary;" +
    "\nthis.boundarySegments = boundarySegments;",
  sandbox,
);

console.log("\n  A BOUNDARY SEGMENT LIST IS BUILT FROM ANY STRAIGHT BODY\n");

for (const [label, object] of STRAIGHT_BODIES) {
  const segments = sandbox.boundarySegments(object);

  check(
    `${label}: contributes one boundary segment, its own two ends`,
    segments.length === 1 &&
      segments[0][0].x === 0 &&
      segments[0][1].x === 100,
    JSON.stringify(segments),
  );
}

console.log("\n  ANY STRAIGHT BODY CAN BE TRIMMED TO A BOUNDARY\n");

for (const [label, object] of STRAIGHT_BODIES) {
  /*
   * A fresh copy per body: trim MUTATES the target's geometry, so the
   * fixture must not be shared between checks.
   */
  const target = JSON.parse(JSON.stringify(object));

  sandbox.trim(
    target,
    BOUNDARY,
    /* The click at the far end chooses which part is removed. */
    { x: 100, y: 0 },
  );

  check(
    `${label}: is trimmed back to the crossing at x = 50`,
    Math.abs(target.geometry.end.x - 50) < 1e-6,
    `end is now ${JSON.stringify(target.geometry.end)}`,
  );

  check(
    `${label}: and the far end is what moved, not the near one`,
    Math.abs(target.geometry.start.x) < 1e-6,
    `start is now ${JSON.stringify(target.geometry.start)}`,
  );
}

console.log("\n  ANY STRAIGHT BODY CAN BE EXTENDED TO A BOUNDARY\n");

{
  const shortBoundary = {
    id: "b2",
    type: "line",
    geometry: { start: { x: 150, y: -50 }, end: { x: 150, y: 50 } },
  };

  sandbox.drawingState.objects.push(shortBoundary);

  for (const [label, object] of STRAIGHT_BODIES) {
    const target = JSON.parse(JSON.stringify(object));

    sandbox.extend(target, shortBoundary, { x: 100, y: 0 });

    check(
      `${label}: is extended out to the boundary at x = 150`,
      Math.abs(target.geometry.end.x - 150) < 1e-6,
      `end is now ${JSON.stringify(target.geometry.end)}`,
    );
  }
}

console.log("\n  GEOMETRY THAT IS NOT A STRAIGHT BODY IS REFUSED SAFELY\n");

{
  const circle = {
    id: "circle-1",
    type: "circle",
    geometry: { center: { x: 0, y: 0 }, radius: 25 },
  };

  const before = JSON.stringify(circle.geometry);

  sandbox.trim(circle, BOUNDARY, { x: 0, y: 25 });
  sandbox.extend(circle, BOUNDARY, { x: 0, y: 25 });

  check(
    "a circle is neither trimmed nor extended, and is left untouched",
    JSON.stringify(circle.geometry) === before,
    `geometry became ${JSON.stringify(circle.geometry)}`,
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail) process.exitCode = 1;
