/*
 * ========================================================
 * EVERY THERMODYNAMICS FEATURE REACHES THE SOURCE, WHERE IT IS DRAWN
 * ========================================================
 *
 * The Drawing Space is the compiled source, so a feature with no source - or
 * source in the wrong place - is missing or misplaced on the sheet. These check:
 *   - a rectangle is written DOWN from its top-left `position`, as drawn;
 *   - a saturation curve, process plot, piston-cylinder and control volume are
 *     the thermodynamics writer's, not drawn as a bare box;
 *   - a bent process segment is written curved;
 *   - electric work is written as its resistor.
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
let geometryWriter;

before(async () => {
  await whenReady();

  const synchronization = require(locate("source-synchronization.js"));
  sourceFor = (object) => synchronization.sourceForObject(object, {});
  geometryWriter = require(locate("source-writers/geometry.js")).geometrySourceWriter;
});

after(() => window.close());

const box = { position: { x: 0, y: 0 }, width: 10, height: 5, rotation: 0 };

test("a tank with valve exports its vessel, outlet, valve and handle", () => {
  const source = sourceFor({
    id: "tank-valve-1", type: "rectangle",
    geometry: { ...box, hasValve: true }, style: {},
    metadata: { thermodynamicsKind: "tank" }
  });
  assert.ok(source);
  assert.doesNotMatch(source, / rectangle /);
  assert.equal((source.match(/\\draw/g) || []).length, 6);
});

test("open and closed tank valves export distinct handle positions", () => {
  const tank = {
    id: "valve-state", type: "rectangle", style: {},
    metadata: { thermodynamicsKind: "tank" }
  };
  const closed = sourceFor({ ...tank, geometry: { ...box, hasValve: true, valveOpen: false } });
  const open = sourceFor({ ...tank, geometry: { ...box, hasValve: true, valveOpen: true } });
  assert.ok(closed && open);
  assert.notEqual(open, closed);
  assert.equal((open.match(/\\draw/g) || []).length, 6);
  assert.equal((closed.match(/\\draw/g) || []).length, 6);
});

/* The y values of every coordinate pair in a block of TikZ. */
function ys(text) {
  return [...String(text).matchAll(/\((-?[\d.]+),(-?[\d.]+)\)/g)].map((match) => Number(match[2]));
}

test("a rectangle is written down from its top-left corner, as the canvas draws it", () => {
  const source = geometryWriter({ id: "r", type: "rectangle", geometry: box, style: {} });

  assert.match(source, /\(0,-5\) rectangle \(10,0\)/);
});

test("a rotated rectangle is written through the model's own corners", () => {
  const source = geometryWriter({ id: "r", type: "rectangle", geometry: { ...box, rotation: 90 }, style: {} });
  const values = ys(source);

  /* Rotated about its centre (5, -2.5): it spans 10 units vertically around it. */
  assert.ok(Math.min(...values) < -2.5 && Math.max(...values) > -2.5, source);
  assert.ok(Math.abs(Math.max(...values) - Math.min(...values) - 10) < 1e-3, source);
});

for (const kind of ["turbine-compressor", "tank", "saturation-curve", "process-plot", "piston-cylinder", "control-volume"]) {
  test(`a ${kind} is the thermodynamics writer's, inside its own box`, () => {
    const source = sourceFor({
      id: `${kind}-1`,
      type: "rectangle",
      geometry: box,
      style: { lineType: kind === "control-volume" ? "dashed" : "solid" },
      metadata: { thermodynamicsKind: kind }
    });

    assert.ok(source, `${kind} wrote no source`);
    assert.doesNotMatch(source, / rectangle /, `${kind} was drawn as a bare box`);

    const values = ys(source);

    assert.ok(Math.max(...values) <= 1e-6 && Math.min(...values) >= -5 - 1e-6, `${kind} left its box: ${source}`);

    if (kind === "control-volume") {
      assert.match(source, /dashed/);
    }
  });
}

test("a process plot is the axes alone; a saturation curve adds the dome", () => {
  const plot = sourceFor({ id: "p", type: "rectangle", geometry: box, style: {}, metadata: { thermodynamicsKind: "process-plot" } });
  const dome = sourceFor({ id: "s", type: "rectangle", geometry: box, style: {}, metadata: { thermodynamicsKind: "saturation-curve" } });

  assert.ok(dome.split("\\draw").length > plot.split("\\draw").length, "the dome adds paths the plot does not have");
});

test("a bent process segment is written curved, and a straight one stays straight", () => {
  const path = (bends) => sourceFor({
    id: "path",
    type: "polyline",
    geometry: { points: [{ x: 0, y: 0 }, { x: 50, y: 0 }], segmentBends: bends },
    style: {},
    metadata: { thermodynamicsKind: "process-path", stateCount: 2 }
  });

  const straight = path([0]);
  const bent = path([0.3]);
  const vertices = (text) => (text.split("\n").find((line) => /line width=1\.1pt/.test(line)).match(/\(/g) || []).length;

  assert.equal(vertices(straight), 2);
  assert.ok(vertices(bent) > 10, "the bent segment follows the curve");
});

test("electric work is written as its resistor, not as an arrow", () => {
  const source = sourceFor({
    id: "arrow-1",
    type: "annotate",
    annotateKind: "arrow",
    geometry: { start: { x: 0, y: 0 }, end: { x: 0, y: -20 } },
    style: { stroke: "#000000" },
    metadata: { thermodynamicsKind: "electric-work" }
  });

  assert.ok(source, "electric work wrote no source");
  assert.doesNotMatch(source, /Latex/, "no arrowhead");
  assert.ok((source.match(/--/g) || []).length >= 10, "the zigzag's vertices are written");
});

test("mechanical work exports a side-view shaft, hub and two blades without an arrowhead", () => {
  const source = sourceFor({
    id: "fan-1", type: "annotate", annotateKind: "arrow",
    geometry: { start: { x: 0, y: 0 }, end: { x: 20, y: 0 } },
    style: { stroke: "#000000" },
    metadata: { thermodynamicsKind: "mechanical-work" }
  });
  assert.ok(source);
  assert.doesNotMatch(source, /Latex/);
  assert.equal((source.match(/\\draw/g) || []).length, 4);
});
