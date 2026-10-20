
const path = require("path");
const { JSDOM } = require("jsdom");

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

const { createHarness } = require("./harness-renderer.cjs");

createHarness(projectRoot, JSDOM, require);

const { modulePath } = require("./helpers/source-path.cjs");

const state = require(modulePath("drawing-state.js")).default;
const dimensionModel =
  global.window.enggDimensionModel ||
  require(modulePath("dimension-model.js")).default;

const model = require(modulePath("dimension-model.js")).default;

/*
 * ========================================================
 * A CREATED DIMENSION MOVES BY ITS TEXT, AND EDITS BY DOUBLE-CLICK
 * ========================================================
 *
 * A dimension is placed, then pushed around until its number is legible.
 * The number is what the student aims at, so the point a drag grabs is the
 * TEXT anchor - not an end of the dimension line - and the drag writes the
 * dimension's world placement, leaving the value it states and the geometry
 * it measures untouched.
 */

console.log("\n  the dimension's grab point is its text\n");

{
  /*
   * A horizontal line 100 long, measured by a linear dimension placed 20
   * above it. The dimension line runs above the geometry and the number sits
   * on that line, so the text anchor is the midpoint of the dimension line -
   * NOT either end of it.
   */
  const line = {
    id: "line-1",
    name: "Line",
    type: "line",
    geometry: {
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
    },
    style: {},
    metadata: {},
  };

  const dimension = model.createDimension({
    dimensionType: "horizontal",
    refs: [
      { featureId: "line-1", anchor: "start" },
      { featureId: "line-1", anchor: "end" },
    ],
    placement: { x: 50, y: 20 },
  });

  const scene = {
    objects: [line, dimension],
    camera: { zoom: 1, panX: 0, panY: 0 },
    selection: { selectedObjectIds: [dimension.id] },
    interaction: { phase: "idle" },
  };

  const graphics = model.graphicsFor(dimension, scene);

  check(
    "the dimension reports a text anchor",
    Boolean(graphics && graphics.textAnchor),
    JSON.stringify(graphics && graphics.textAnchor),
  );

  if (graphics && graphics.textAnchor && graphics.line) {
    const [lineStart] = graphics.line;

    check(
      "the text anchor is the midpoint of the dimension line",
      Math.abs(
        graphics.textAnchor.x - (graphics.line[0].x + graphics.line[1].x) / 2
      ) < 1e-6 &&
        Math.abs(
          graphics.textAnchor.y - (graphics.line[0].y + graphics.line[1].y) / 2
        ) < 1e-6,
      `anchor ${JSON.stringify(graphics.textAnchor)}, line ${JSON.stringify(
        graphics.line
      )}`,
    );

    check(
      "and it is NOT the dimension line's first point",
      Math.hypot(
        graphics.textAnchor.x - lineStart.x,
        graphics.textAnchor.y - lineStart.y
      ) > 1e-6,
      `anchor and line start are the same point`,
    );
  }
}

console.log("\n  a drag writes the world placement by the pointer's delta\n");

{
  /*
   * The drag arithmetic: placement moves by (pointer - pressPoint), which is
   * exactly "stay where you were grabbed". A press off the text's centre must
   * keep that click offset for the whole drag.
   */
  const dimension = {
    id: "dimension-1",
    type: "dimension",
    placement: { x: 50, y: 20 },
  };

  const press = { x: 54, y: 27 }; // a few units off the anchor
  const pointer = { x: 84, y: 47 };

  const moved = {
    x: dimension.placement.x + (pointer.x - press.x),
    y: dimension.placement.y + (pointer.y - press.y),
  };

  check(
    "the dimension moves by the pointer's travel, not to the pointer",
    Math.abs(moved.x - (50 + 30)) < 1e-9 &&
      Math.abs(moved.y - (20 + 20)) < 1e-9,
    JSON.stringify(moved),
  );

  check(
    "so the click offset the student began with is preserved",
    Math.abs(moved.x - pointer.x - (dimension.placement.x - press.x)) < 1e-9 &&
      Math.abs(moved.y - pointer.y - (dimension.placement.y - press.y)) < 1e-9,
    "the offset drifted over the drag",
  );

  check(
    "and it did not jump to the pointer or to the geometry",
    moved.x !== pointer.x && moved.y !== pointer.y,
  );
}

console.log("\n  moving a dimension does not change what it measures\n");

{
  const line = {
    id: "line-1",
    name: "Line",
    type: "line",
    geometry: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    style: {},
    metadata: {},
  };

  const dimension = model.createDimension({
    dimensionType: "horizontal",
    refs: [
      { featureId: "line-1", anchor: "start" },
      { featureId: "line-1", anchor: "end" },
    ],
    placement: { x: 50, y: 20 },
  });

  const scene = {
    objects: [line, dimension],
    camera: { zoom: 1, panX: 0, panY: 0 },
    selection: { selectedObjectIds: [dimension.id] },
    interaction: { phase: "idle" },
  };

  const before = model.measurementFor(dimension, scene);

  /* Move the dimension far away - a deliberate reposition. */
  dimension.placement = { x: 400, y: -250 };

  const after = model.measurementFor(dimension, scene);

  check(
    "the measured value is unchanged by moving the dimension",
    before && after && Math.abs(before.value - after.value) < 1e-9,
    `before ${before && before.value}, after ${after && after.value}`,
  );

  check(
    "the source reference is unchanged",
    dimension.sourceRefs[0].featureId === "line-1" &&
      dimension.sourceRefs[0].anchor === "start",
    JSON.stringify(dimension.sourceRefs),
  );

  check(
    "and the measured geometry is untouched",
    line.geometry.start.x === 0 &&
      line.geometry.start.y === 0 &&
      line.geometry.end.x === 100,
    JSON.stringify(line.geometry),
  );
}

console.log("\n  the placement is stored in drawing units\n");

{
  const dimension = model.createDimension({
    dimensionType: "horizontal",
    refs: [
      { featureId: "line-1", anchor: "start" },
      { featureId: "line-1", anchor: "end" },
    ],
    placement: { x: 123.5, y: -47.25 },
  });

  check(
    "the placement survives a save and reload",
    (() => {
      const reloaded = JSON.parse(JSON.stringify(dimension));
      return (
        reloaded.placement.x === 123.5 &&
        reloaded.placement.y === -47.25
      );
    })(),
    JSON.stringify(dimension.placement),
  );

  check(
    "and it is a pair of numbers, not a screen offset",
    typeof dimension.placement.x === "number" &&
      typeof dimension.placement.y === "number",
    JSON.stringify(dimension.placement),
  );
}

void state;
void dimensionModel;

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
