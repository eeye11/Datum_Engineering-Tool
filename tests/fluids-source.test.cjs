/*
 * ========================================================
 * THE FLUIDS FLOW PATHS REACH THE SOURCE
 * ========================================================
 *
 * The Drawing Space is the compiled source, so a Pipe / Duct run and an Elbow
 * need source of their own. A run is its two walls; an elbow with no bend
 * radius has no curve (the runs meet at the corner) and writes nothing, and
 * with one it writes its two arcs. A dimension - which the Fluids measurement
 * tools create - is written too.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { bootApp, whenReady } = require("./helpers/boot-app.cjs");
const { locate } = require("./helpers/source-path.cjs");

const { window, error } = bootApp();

if (error) {
  console.log(`the application did not boot: ${error.message}`);
  process.exit(1);
}

let sourceFor;
let pipeDuct;

before(async () => {
  await whenReady();

  const synchronization = require(locate("source-synchronization.js"));
  sourceFor = (object, context = {}) => synchronization.sourceForObject(object, context);
  pipeDuct = require(locate("model/fluids/pipe-duct.js")).default;
});

after(() => window.close());

test("a Pipe / Duct run is written as its two walls", () => {
  const run = { ...pipeDuct.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 }), id: "run-1" };
  const source = sourceFor(run);

  assert.ok(source, "the run wrote no source");
  assert.equal((source.match(/\\draw/g) || []).length, 2, source);
});

test("an elbow without a bend radius writes nothing; with one it writes its arcs", () => {
  const elbow = {
    id: "elbow-1",
    type: "elbow",
    geometry: { previous: { x: 0, y: 0 }, position: { x: 100, y: 0 }, next: { x: 100, y: -100 } },
    style: {},
    engineering: { shape: "circular" }
  };

  assert.equal(sourceFor(elbow), null);

  const bent = sourceFor({ ...elbow, engineering: { ...elbow.engineering, bendRadius: 30 } });

  assert.ok(bent, "an elbow with a radius wrote no source");
  assert.ok((bent.match(/\\draw/g) || []).length >= 2, bent);
});

test("a dimension is written to the source", () => {
  const line = { id: "line-1", type: "line", geometry: { start: { x: 0, y: 0 }, end: { x: 50, y: 0 } }, style: {} };
  const model = require(locate("model/dimensions/dimension-model.js")).default;
  const dimension = model.createDimension({
    dimensionType: "horizontal",
    refs: [
      { featureId: "line-1", anchor: "start" },
      { featureId: "line-1", anchor: "end" }
    ],
    placement: { x: 25, y: 10 }
  });

  const source = sourceFor({ ...dimension, id: "dimension-1" }, { state: { objects: [line], units: "mm" }, allObjects: [line] });

  assert.ok(source, "the dimension wrote no source");
});
