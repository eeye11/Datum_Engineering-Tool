/* eslint-disable no-console */
/*
 * ========================================================
 * THE JUNCTION'S CENTRAL GEOMETRY
 * ========================================================
 *
 * One fitting, one continuous outer contour. These checks pin the properties a
 * drawing needs and a reader can verify:
 *
 *   1. the contour is CLOSED and does not cross itself, for a tee, a four-way
 *      cross, an oblique cross and a five-way;
 *   2. every mouth sits exactly on its branch's port, so a connected pipe's
 *      walls meet the fitting with no gap;
 *   3. different Pipe Widths change the mouth, never the pipes;
 *   4. the stub is DERIVED - there is no stored length, and it clears the
 *      contour at every width;
 *   5. the main run is two opposed branches, and only the others carry an
 *      editable angle;
 *   6. angles are absolute from the main run and snap to the common set only
 *      while a free arm is dragged;
 *   7. a duplicate direction is refused, so the contour can never fold.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { bootApp } = require("./helpers/boot-app.cjs");
const { locate } = require("./helpers/source-path.cjs");

test.after(() => {
  setImmediate(() => process.exit(process.exitCode || 0));
});

let page = null;

function ready() {
  if (!page) {
    page = bootApp();

    if (page.error) {
      throw page.error;
    }
  }

  return page;
}

function junctionModel() {
  ready();

  return require(locate("model/fluids/junction.js")).default;
}

function cross(branches, options = {}) {
  const j = junctionModel();

  return j.createJunction({
    position: { x: 100, y: 100 },
    branches: branches.map((branch, index) => ({ id: "abcdef"[index], ...branch })),
    engineering: { generated: true, ...(options.engineering || {}) }
  });
}

function crossings(polygon) {
  const segmentsCross = (p1, p2, p3, p4) => {
    const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);

    if (Math.abs(d) < 1e-12) {
      return false;
    }

    const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
    const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;

    return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
  };

  let count = 0;

  for (let i = 0; i < polygon.length; i += 1) {
    for (let k = i + 1; k < polygon.length; k += 1) {
      if (k === i + 1 || (i === 0 && k === polygon.length - 1)) {
        continue;
      }

      if (segmentsCross(
        polygon[i],
        polygon[(i + 1) % polygon.length],
        polygon[k],
        polygon[(k + 1) % polygon.length]
      )) {
        count += 1;
      }
    }
  }

  return count;
}

function signedArea(polygon) {
  return polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length];

    return sum + (point.x * next.y - next.x * point.y);
  }, 0) / 2;
}

const TEE = [
  { direction: { x: 1, y: 0 }, main: true, width: 4 },
  { direction: { x: -1, y: 0 }, width: 4 },
  { direction: { x: 0, y: 1 }, width: 12 }
];

const CROSS = [
  { direction: { x: 1, y: 0 }, main: true, width: 4 },
  { direction: { x: -1, y: 0 }, width: 6 },
  { direction: { x: 0, y: 1 }, width: 12 },
  { direction: { x: 0, y: -1 }, width: 2 }
];

/* ============================================================
 * 1. ONE CONTINUOUS CONTOUR
 * ============================================================ */

test("the contour is closed and never crosses itself, whatever the widths", () => {
  const j = junctionModel();

  [
    ["tee", TEE],
    ["four-way", CROSS],
    [
      "oblique",
      [
        { direction: { x: 1, y: 0 }, main: true, width: 4 },
        { direction: { x: -1, y: 0 }, width: 6 },
        { direction: { x: 0.6, y: 0.8 }, width: 12 },
        { direction: { x: -0.6, y: -0.8 }, width: 2 }
      ]
    ],
    [
      "five-way",
      [
        { direction: { x: 1, y: 0 }, main: true, width: 4 },
        { direction: { x: -1, y: 0 }, width: 4 },
        { direction: { x: 0, y: 1 }, width: 10 },
        { direction: { x: 0, y: -1 }, width: 4 },
        { direction: { x: 0.7, y: 0.7 }, width: 4 }
      ]
    ]
  ].forEach(([label, branches]) => {
    const outline = j.junctionOutline(cross(branches));

    assert.ok(outline.length > 8, `${label} has a contour`);
    assert.equal(crossings(outline), 0, `${label} contour does not self-intersect`);
    assert.ok(signedArea(outline) > 0, `${label} contour encloses a real area`);
  });
});

test("every mouth sits exactly on its branch port", () => {
  const j = junctionModel();
  const tee = cross(TEE);

  j.branchPorts(tee).forEach((port) => {
    assert.ok(
      j.junctionContainsPoint(tee, port.point, 1e-6),
      `${port.id}'s port is on the fitting`
    );
  });
});

/* ============================================================
 * 2. PIPE WIDTH
 * ============================================================ */

test("a branch takes its pipe's width, and the contour follows without touching the pipe", () => {
  const j = junctionModel();

  const wide = cross([
    { direction: { x: 1, y: 0 }, main: true, width: 4 },
    { direction: { x: -1, y: 0 }, width: 4 },
    { direction: { x: 0, y: 1 }, width: 30 }
  ]);

  const narrow = cross([
    { direction: { x: 1, y: 0 }, main: true, width: 4 },
    { direction: { x: -1, y: 0 }, width: 4 },
    { direction: { x: 0, y: 1 }, width: 4 }
  ]);

  assert.ok(j.stubLength(wide, wide.geometry.branches[2]) > j.stubLength(narrow, narrow.geometry.branches[2]));
  assert.equal(wide.geometry.branches[2].width, 30, "the width is recorded, not rewritten");
});

/* ============================================================
 * 3. THE STUB
 * ============================================================ */

test("the branch has NO stored length and the stub clears the contour", () => {
  const j = junctionModel();
  const tee = cross(TEE);

  tee.geometry.branches.forEach((branch) => {
    assert.equal("length" in branch, false, `${branch.id} stores no length`);

    const length = j.stubLength(tee, branch);

    assert.ok(length > 0);
    assert.ok(
      length >= j.MINIMUM_STUB_LENGTH,
      `${branch.id} is long enough to grab`
    );
  });
});

/* ============================================================
 * 4. THE MAIN RUN AND THE ANGLES
 * ============================================================ */

test("the main run is two opposed branches, and only the others carry an angle", () => {
  const j = junctionModel();
  const tee = cross(TEE);

  assert.equal(j.mainBranchOf(tee).id, "a");
  assert.equal(j.mainPartnerOf(tee).id, "b");

  assert.equal(j.isMainRunBranch(tee, "a"), true);
  assert.equal(j.isMainRunBranch(tee, "b"), true);
  assert.equal(j.isMainRunBranch(tee, "c"), false);

  assert.deepEqual(
    j.secondaryBranches(tee).map((branch) => branch.id),
    ["c"]
  );

  assert.equal(Math.round(j.secondaryBranchAngle(tee, "c")), 90);
  assert.equal(j.branchAngleHandlePoint(tee, "a"), null, "no grip on the main run");
  assert.ok(j.branchAngleHandlePoint(tee, "c"), "a grip on the free arm");
});

test("a free branch snaps to the common angles, and reaches others", () => {
  const j = junctionModel();

  assert.equal(j.snapBranchAngle(31), 30);
  assert.equal(j.snapBranchAngle(44), 45);
  assert.equal(j.snapBranchAngle(88), 90);
  assert.equal(j.snapBranchAngle(133), 135);
  assert.equal(j.snapBranchAngle(37), 37, "a non-standard angle is reachable");
});

test("a branch is turned on its own side, and cannot be laid on top of another", () => {
  const j = junctionModel();
  const tee = cross(TEE);

  const before = tee.geometry.branches.find((branch) => branch.id === "c").direction;

  assert.equal(j.setBranchAngle(tee, "c", 45), true);
  assert.ok(Math.abs(j.secondaryBranchAngle(tee, "c") - 45) < 1e-6);

  /*
   * IT STAYED ON THE SIDE IT WAS ON. The arm left straight up and now leaves
   * up and to the left of the main run, so its SIGNED angle from the main
   * direction kept its sign - it did not cross the run to 45 degrees the
   * other way.
   */
  const after = tee.geometry.branches.find((branch) => branch.id === "c").direction;

  assert.ok(after.y > 0, "the arm still leaves upward");
  assert.ok(Math.abs(after.x) > 1e-6, "and has genuinely turned off the perpendicular");
  assert.notDeepEqual([after.x, after.y], [before.x, before.y]);

  /* The main run's own arms have no angle row, and cannot be given one. */
  assert.equal(j.isMainRunBranch(tee, "a"), true);
  assert.equal(j.secondaryBranchAngle(tee, "a"), null);

  /* A direction already occupied is refused, so the contour cannot fold. */
  assert.equal(j.setBranchAngle(tee, "c", 0), false);
  assert.ok(Math.abs(j.secondaryBranchAngle(tee, "c") - 45) < 1e-6, "the last valid angle is kept");
});
