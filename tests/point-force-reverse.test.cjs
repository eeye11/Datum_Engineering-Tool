/*
 * ========================================================
 * REVERSING A POINT FORCE
 * ========================================================
 *
 * Reverse Direction must reverse the ACTUAL FORCE VECTOR - not merely move an
 * arrowhead. The contract:
 *
 *   the vector inverts         F becomes (-Fx, -Fy); the angle turns half a turn
 *   the magnitude is unchanged 100 N is still 100 N, only the sense differs
 *   the attachment does not move
 *   the parent relationship does not change
 *   the arrow follows the force the head crosses to the other side, the tail
 *                              stays at the application point
 *   every representation agrees arrow, angle, components and the drawn axis
 *   the axis is left CLEAN      a horizontal force has forceY of exactly 0
 *   children stay in step      Force Components and Resultant read the new value
 */

const { JSDOM } = require("jsdom");

const { modulePath } = require("./helpers/source-path.cjs");

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

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "https://datum.test/",
});

global.window = dom.window;
global.document = dom.window.document;
global.Element = dom.window.Element;

for (const name of [
  "quantities.js",
  "measurement-core.js",
  "annotation-model.js",
  "load-profile.js",
  "analysis-dependencies.js",
  "body-frames.js",
  "feature-geometry.js",
  "drawing-state.js",
]) {
  require(modulePath(name));
}

const profile = require(modulePath("load-profile.js")).default;
const state = require(modulePath("drawing-state.js")).default;
const deps = require(modulePath("analysis-dependencies.js")).default;

/*
 * WIRE THE REGISTRY, as the editor does at start-up.
 *
 * `refreshDerivedFeatures` reaches the dependency registry through a slot that
 * is empty until something fills it, so without this a child would never be
 * re-derived in a bare harness - and the check would report a defect that does
 * not exist in the running application.
 */
state.setAnalysisDependencyRegistry(deps);

const F = state.geometryFactories;

console.log("\n  the VECTOR inverts, and nothing else does\n");

{
  const st = state.createDrawingState();
  const force = F.forceFromMagnitude({ x: 0, y: 0 }, 100, 0, {});

  state.addObject(st, force);

  const before = profile.forceVector(force.geometry);

  check("it starts pointing +x", before.fx === 100 && before.fy === 0);

  profile.reverseForceDirection(force.geometry);

  const after = profile.forceVector(force.geometry);

  check(
    "the X component is inverted",
    after.fx === -100,
    `fx = ${after.fx}`,
  );

  check(
    "the magnitude is UNCHANGED - 100 N is still 100 N",
    after.magnitude === 100,
    `magnitude = ${after.magnitude}`,
  );

  check(
    "the angle turned a half turn",
    force.geometry.angle === 180,
    `angle = ${force.geometry.angle}`,
  );

  check(
    "and the stored components agree with the angle",
    force.geometry.forceX === -100 && force.geometry.forceY === 0,
    `forceX=${force.geometry.forceX} forceY=${force.geometry.forceY}`,
  );
}

console.log("\n  a horizontal force keeps a CLEAN axis\n");

{
  const force = F.forceFromMagnitude({ x: 0, y: 0 }, 100, 0, {});

  profile.reverseForceDirection(force.geometry);

  /*
   * `Math.sin(180 * PI / 180)` is 1.22e-14, not 0. If that sliver reaches the
   * stored components then a force pointing exactly west reports a trace of
   * north, and a reader asking which way it points is told "up and to the left".
   */
  check(
    "forceY is EXACTLY zero, not an arithmetic sliver",
    force.geometry.forceY === 0,
    `forceY = ${force.geometry.forceY}`,
  );
}

console.log("\n  the ATTACHMENT does not move\n");

{
  const force = F.forceFromMagnitude({ x: 40, y: 25 }, 100, 30, {});

  const attachment = { ...force.geometry.position };

  profile.reverseForceDirection(force.geometry);

  check(
    "the application point is exactly where it was",
    force.geometry.position.x === attachment.x &&
      force.geometry.position.y === attachment.y,
    `${JSON.stringify(force.geometry.position)} vs ${JSON.stringify(attachment)}`,
  );

  check(
    "and start still agrees with position",
    force.geometry.start.x === attachment.x &&
      force.geometry.start.y === attachment.y,
  );
}

console.log("\n  the ARROW follows the force\n");

{
  const st = state.createDrawingState();
  const force = F.forceFromMagnitude({ x: 0, y: 0 }, 100, 0, {});

  state.addObject(st, force);

  const before = profile.drawnForceAxis(st, force.geometry);

  check(
    "before, the head is to the right of where it acts",
    before.head.x > before.tail.x,
  );

  profile.reverseForceDirection(force.geometry);

  const after = profile.drawnForceAxis(st, force.geometry);

  check(
    "after, the head is to the LEFT",
    after.head.x < after.tail.x,
    `head ${after.head.x}, tail ${after.tail.x}`,
  );

  check(
    "and the tail is still the application point",
    after.tail.x === 0 && after.tail.y === 0,
  );
}

console.log("\n  a BODY-ATTACHED force reverses without detaching\n");

{
  const st = state.createDrawingState();

  const beam = F.beam({ x: 0, y: 0 }, { x: 200, y: 0 });
  state.addObject(st, beam);

  const force = F.forceFromMagnitude({ x: 80, y: 0 }, 150, -90, {});
  force.parentId = beam.id;
  force.geometry.attachment = { fraction: 0.4, unit: "fraction" };

  state.addObject(st, force);

  profile.reverseForceDirection(force.geometry);

  check(
    "the force is STILL attached to the beam",
    force.parentId === beam.id,
  );

  check(
    "its place along the beam is unchanged",
    force.geometry.attachment.fraction === 0.4,
  );

  check(
    "and only the sense changed - it now points up rather than down",
    force.geometry.forceY > 0,
    `forceY = ${force.geometry.forceY}`,
  );
}

console.log("\n  reversing TWICE returns the original force\n");

{
  const force = F.forceFromMagnitude({ x: 12, y: -7 }, 100, 37, {});

  const angle = force.geometry.angle;

  profile.reverseForceDirection(force.geometry);
  profile.reverseForceDirection(force.geometry);

  check(
    "the angle is back where it started",
    Math.abs(force.geometry.angle - angle) < 1e-9,
    `${force.geometry.angle} vs ${angle}`,
  );

  const vector = profile.forceVector(force.geometry);

  check(
    "and the vector is the original one",
    Math.abs(vector.fx - 100 * Math.cos((37 * Math.PI) / 180)) < 1e-9 &&
      Math.abs(vector.fy - 100 * Math.sin((37 * Math.PI) / 180)) < 1e-9,
    JSON.stringify({ fx: vector.fx, fy: vector.fy }),
  );
}

console.log("\n  the CHILDREN read the reversed force\n");

{
  const st = state.createDrawingState();

  /*
   * `addObject` RETURNS THE STORED OBJECT, which may be a copy of the one
   * passed in. Everything here works with what it returns - the alternative,
   * holding the object that was passed, is the documented trap: writes to it
   * land on something the document does not contain.
   */
  const force = state.addObject(
    st,
    F.forceFromMagnitude({ x: 0, y: 0 }, 100, 0, {}),
  );

  const components = state.addObject(
    st,
    state.geometryFactories["force-components"](
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { engineering: { discipline: "statics", analysisKind: "force-components" } },
    ),
  );

  deps.registerDependency(components, [force.id]);

  state.refreshDerivedFeatures(st);

  const before = { ...components.geometry.original.end };

  /* Reverse the parent. */
  profile.reverseForceDirection(force.geometry);

  state.refreshDerivedFeatures(st);

  const after = { ...components.geometry.original.end };

  check(
    "the child's ORIGINAL vector was re-derived from the reversed force",
    before.x > 0 && after.x < 0,
    `before ${JSON.stringify(before)} after ${JSON.stringify(after)}`,
  );

  check(
    "and the horizontal leg flipped with it",
    components.geometry.horizontal.end.x < 0,
    JSON.stringify(components.geometry.horizontal.end),
  );

  check(
    "and the source force is recorded on the child",
    deps.sourceIdsOf(components).includes(force.id),
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
