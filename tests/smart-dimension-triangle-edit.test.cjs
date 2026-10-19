/*
 * ========================================================
 * EDITING A TRIANGLE SIDE CHANGES THAT SIDE
 * ========================================================
 *
 * §8 of the brief: changing a dimension on AB must change AB - not the
 * hypotenuse, and not whichever side the triangle happens to store first.
 *
 * §17: selection must work at every zoom. The hit test is expressed in
 * screen pixels and converted to world units through the camera, so the same
 * physical click lands on the same side however far in or out the view is.
 */

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

const { modulePath, loadModule } = require("./helpers/source-path.cjs");

loadModule("measurement-core.js");
loadModule("dimensions.js");

const dimensionEdit = require(modulePath("dimension-edit.js")).default;
const dimensions = require(modulePath("dimensions.js")).default;
const { drawingState } = require(modulePath("editor-state.js"));

/* A CALIBRATED SHEET: 1 world unit = 4 mm. */
drawingState.scale = { mmPerUnit: 4, unit: "mm" };

const close = (a, b, t = 1e-6) => Math.abs(a - b) <= t;

const mm = (world) => dimensions.toEngineering(drawingState, world).value;

const sideLength = (tri, index) => {
  const p = tri.geometry.points;
  const from = p[index];
  const to = p[(index + 1) % 3];

  return Math.hypot(to.x - from.x, to.y - from.y);
};

/* A dimension on ONE named triangle side. */
const sideDimension = (featureId, index) => ({
  id: `dim-${index}`,
  type: "dimension",
  dimensionType: "linear",
  sourceRefs: [
    { kind: "between", featureId, anchor: `segment${index}Start` },
    { kind: "between", featureId, anchor: `segment${index}End` },
  ],
});

/* ---------------------------------------------------------------- */
console.log("\n  the dimension reports itself editable\n");

{
  const triangle = {
    id: "tri-1",
    type: "triangle",
    geometry: {
      points: [
        { x: 50, y: 120 },
        { x: 0, y: 0 },
        { x: 120, y: 0 },
      ],
    },
  };

  drawingState.objects = [triangle];

  for (const index of [0, 1, 2]) {
    check(
      `a dimension on side ${index} is editable`,
      dimensionEdit.dimensionEditable(sideDimension("tri-1", index), drawingState),
    );
  }
}

/* ---------------------------------------------------------------- */
console.log("\n  editing one side changes THAT side\n");

/*
 * Each side is edited in turn on a FRESH triangle. The side the dimension
 * names must end up exactly the requested physical length.
 *
 * THE OTHER SIDES ARE NOT EXPECTED TO STAY PUT, and asserting that they did
 * would be asserting something the geometry cannot promise: the triangle's
 * own solver treats the three sides as one SSS constraint set, so changing
 * one side legitimately rebuilds the shape. What matters - and what these
 * check - is that the side which CHANGED is the side that was CLICKED. A
 * dimension that landed on the wrong edge would show up as the requested
 * length appearing on a different side.
 */
for (const index of [0, 1, 2]) {
  const triangle = {
    id: "tri-e",
    type: "triangle",
    geometry: {
      points: [
        { x: 50, y: 120 },
        { x: 0, y: 0 },
        { x: 120, y: 0 },
      ],
    },
  };

  drawingState.objects = [triangle];

  const before = [0, 1, 2].map((i) => sideLength(triangle, i));

  const result = dimensionEdit.applyDimensionValue(
    sideDimension("tri-e", index),
    drawingState,
    200,
  );

  const after = [0, 1, 2].map((i) => sideLength(triangle, i));

  check(
    `editing side ${index} reports success`,
    result.ok === true,
    JSON.stringify(result),
  );

  check(
    `side ${index} is now exactly 200 mm`,
    close(mm(after[index]), 200, 1e-3),
    `side ${index} is ${mm(after[index])} mm`,
  );

  /*
   * The other two sides must be UNCHANGED.
   *
   * The solver rebuilds the triangle from its three sides, so it could
   * legitimately move them - but it is given the other two sides at their
   * existing values, so a correct rebuild reproduces them exactly. Asserting
   * this is what catches an edit landing on the WRONG edge: the requested
   * length would appear on one of these instead.
   */
  const others = [0, 1, 2].filter((i) => i !== index);

  for (const other of others) {
    check(
      `and side ${other} was left alone`,
      close(after[other], before[other], 1e-6),
      `side ${other} went ${before[other]} -> ${after[other]}`,
    );
  }
}

/* ---------------------------------------------------------------- */
console.log("\n  a sequence of edits on one side stays exact\n");

{
  const triangle = {
    id: "tri-seq",
    type: "triangle",
    geometry: {
      points: [
        { x: 50, y: 120 },
        { x: 0, y: 0 },
        { x: 120, y: 0 },
      ],
    },
  };

  drawingState.objects = [triangle];

  const dim = sideDimension("tri-seq", 1);

  for (const value of [300, 100, 500, 250]) {
    dimensionEdit.applyDimensionValue(dim, drawingState, value);
  }

  check(
    "the last value in the sequence is exact",
    close(mm(sideLength(triangle, 1)), 250, 1e-3),
    `side 1 is ${mm(sideLength(triangle, 1))} mm`,
  );
}

/* ---------------------------------------------------------------- */
console.log("\n  selection is zoom independent\n");

/*
 * The hit test is a screen-space tolerance converted to world units through
 * the camera, so a click the same SCREEN distance from a side must resolve to
 * that side at any zoom. These click at a world distance scaled by the zoom,
 * which is what a fixed screen distance becomes on the drawing.
 */
{
  const inference = require(modulePath("dimension-inference.js"));

  const triangle = {
    id: "tri-z",
    type: "triangle",
    geometry: {
      points: [
        { x: 50, y: 120 },
        { x: 0, y: 0 },
        { x: 120, y: 0 },
      ],
    },
  };

  drawingState.objects = [triangle];

  for (const zoom of [0.25, 1, 4, 16]) {
    drawingState.camera.zoom = zoom;

    /*
     * A click a little off the RIGHT side, in world units proportional to
     * what a fixed screen offset becomes at this zoom.
     */
    const offset = 6 / zoom;

    const reference = inference.dimensionReferenceAtClick(
      {},
      { x: 84 + offset, y: 60 },
      false,
    );

    check(
      `the right side is still identified at ${zoom}x zoom`,
      reference?.anchor === "segment2Start",
      `at ${zoom}x got ${JSON.stringify(reference?.anchor)}`,
    );
  }

  drawingState.camera.zoom = 1;
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
