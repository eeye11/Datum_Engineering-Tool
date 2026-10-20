/*
 * ========================================================
 * SMART DIMENSION ON A TRIANGLE DIMENSIONS THE SIDE CLICKED
 * ========================================================
 *
 * A triangle is ONE feature with THREE measurable sides. Clicking a side must
 * identify THAT side - not the whole shape, and not whichever side happened
 * to be stored first.
 *
 * These drive the real hit test and the real anchor resolution, so they test
 * the reading the tool actually uses.
 *
 * The defect they pin down: a triangle was not treated as a chain of segments
 * at all, so it fell through to the feature's own `start`/`end`. Every click
 * on the shape therefore resolved to the same two stored points, whatever the
 * student aimed at - which is why one side always won.
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

const inference = require(modulePath("dimension-inference.js"));
const measurement = global.window.enggMeasurement;
const { drawingState } = require(modulePath("editor-state.js"));

/*
 * A SCALENE TRIANGLE, so no two sides can be confused for each other and a
 * wrong answer cannot pass by coincidence:
 *
 *            A (50, 120)
 *           / \
 *          /   \
 *   B(0,0) --------- C(120, 0)
 *
 *   AB  left    ~130.0
 *   BC  bottom   120.0
 *   CA  right   ~130.0  (different from AB, so they are distinguishable)
 */
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

const anchorOf = (name) => measurement.resolveAnchor(triangle, name);

/* ---------------------------------------------------------------- */
console.log("\n  a triangle exposes its three sides\n");

const caps = measurement.capabilitiesFor("triangle");

const names =
  typeof caps?.anchorNames === "function"
    ? caps.anchorNames(triangle)
    : caps?.anchorNames || [];

for (const index of [0, 1, 2]) {
  check(
    `side ${index} publishes its own start and end`,
    names.includes(`segment${index}Start`) &&
      names.includes(`segment${index}End`),
    `names were ${JSON.stringify(names)}`,
  );
}

check(
  "and its three vertices are still there",
  ["a", "b", "c"].every((name) => names.includes(name)),
);

/* ---------------------------------------------------------------- */
console.log("\n  each side resolves to its own two vertices\n");

/*
 * The identity is stable and specific: segment0 is A-B, segment1 is B-C and
 * segment2 is C-A. Asserting the actual coordinates is what proves a click
 * cannot be answered by a different side.
 */
const expectedSides = [
  [0, triangle.geometry.points[0], triangle.geometry.points[1]],
  [1, triangle.geometry.points[1], triangle.geometry.points[2]],
  [2, triangle.geometry.points[2], triangle.geometry.points[0]],
];

for (const [index, from, to] of expectedSides) {
  const start = anchorOf(`segment${index}Start`);
  const end = anchorOf(`segment${index}End`);

  check(
    `segment${index} runs from ${from.x},${from.y} to ${to.x},${to.y}`,
    start &&
      end &&
      start.x === from.x &&
      start.y === from.y &&
      end.x === to.x &&
      end.y === to.y,
    `got ${JSON.stringify(start)} -> ${JSON.stringify(end)}`,
  );
}

/* ---------------------------------------------------------------- */
console.log("\n  a click near a side resolves to THAT side\n");

/*
 * A click a little way off each side, as a real pointer would be. Each must
 * come back naming the side it was nearest.
 */
const clicks = [
  ["left", { x: 26, y: 60 }, "segment0Start"],
  ["bottom", { x: 60, y: 1 }, "segment1Start"],
  ["right", { x: 84, y: 60 }, "segment2Start"],
];

for (const [label, point, expectedAnchor] of clicks) {
  const reference = inference.dimensionReferenceAtClick({}, point, false);

  check(
    `a click near the ${label} side names ${expectedAnchor}`,
    reference && reference.anchor === expectedAnchor,
    `got ${JSON.stringify(reference && reference.anchor)}`,
  );
}

/* ---------------------------------------------------------------- */
console.log("\n  no side is preferred: every side can win\n");

/*
 * The decisive test. The SAME click routine is used for all three sides and
 * each one returns a DIFFERENT anchor. A hardcoded side - the hypotenuse, the
 * first stored edge - could only ever return one of them.
 */
{
  const anchors = clicks.map(([, point]) => {
    const reference = inference.dimensionReferenceAtClick({}, point, false);

    return reference?.anchor || null;
  });

  check(
    "the three clicks give three different sides",
    new Set(anchors).size === 3,
    `anchors were ${JSON.stringify(anchors)}`,
  );

  check(
    "and none of them is a bare start/end of the feature",
    anchors.every(
      (anchor) =>
        anchor && anchor !== "start" && anchor !== "end",
    ),
    `anchors were ${JSON.stringify(anchors)}`,
  );
}

/* ---------------------------------------------------------------- */
console.log("\n  the nearest side wins, not the first\n");

/*
 * Clicking very close to the RIGHT side - which is segment2, the LAST one -
 * must return segment2. An implementation that returned the first matching
 * edge would return segment0 here.
 */
{
  const reference = inference.dimensionReferenceAtClick(
    {},
    { x: 95, y: 30 },
    false,
  );

  check(
    "a click on the last side returns the last side",
    reference?.anchor === "segment2Start",
    `got ${JSON.stringify(reference?.anchor)}`,
  );
}

/* ---------------------------------------------------------------- */
console.log("\n  the side keeps its identity when the triangle moves\n");

/*
 * The anchors are re-derived from the triangle's CURRENT points, so a
 * dimension that named segment2 keeps measuring C-A after the shape changes.
 * This is what stops a dimension jumping to another side when the triangle is
 * edited.
 */
{
  const moved = {
    id: "tri-2",
    type: "triangle",
    geometry: {
      points: [
        { x: 10, y: 200 },
        { x: 10, y: 0 },
        { x: 210, y: 0 },
      ],
    },
  };

  const start = measurement.resolveAnchor(moved, "segment2Start");
  const end = measurement.resolveAnchor(moved, "segment2End");

  check(
    "segment2 follows the triangle's new points",
    start &&
      end &&
      start.x === 210 &&
      start.y === 0 &&
      end.x === 10 &&
      end.y === 200,
    `got ${JSON.stringify(start)} -> ${JSON.stringify(end)}`,
  );
}

/* ---------------------------------------------------------------- */
console.log("\n  a side is dimensionable as a length\n");

{
  const candidates = measurement.dimensionCandidates(triangle);

  check(
    "a triangle still offers a measurement",
    Array.isArray(candidates) && candidates.length > 0,
    `got ${JSON.stringify(candidates)}`,
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
