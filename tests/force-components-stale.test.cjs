
const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * DO THE COMPONENTS FOLLOW THEIR FORCE?
 *
 * Reported: components that do not update when the source force moves, is
 * dragged, or has its magnitude, direction or unit changed - "stale
 * geometry" that survives the change it should have followed.
 *
 * The derivation and the drawing are already proven correct by the other
 * two files. What is in question here is a different thing: whether the
 * components are a READING of the force or a SNAPSHOT of it. A snapshot
 * is correct once, at the moment it is taken, and wrong for ever after -
 * and it looks perfect right up until the force is moved.
 *
 * So every field is changed on the source in turn, and the components are
 * refreshed, and the three vectors are compared against what the source
 * NOW says. The check is against a fresh derivation rather than against
 * the numbers this file happens to know, so a change the test did not
 * anticipate is still caught.
 */

global.window = {
  crypto: { randomUUID: () => "components-stale-uuid" }
};

loadModule("feature-geometry.js");
loadModule("body-frames.js");
loadModule("load-profile.js");
loadModule("analysis-dependencies.js");
loadModule("drawing-state.js");

const deps = global.window.enggAnalysisDependencies;
const state = global.window.enggDrawingState;

let pass = 0;
let fail = 0;

const check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(
      `  FAIL ${name}${detail ? `\n       ${detail}` : ""}`
    );
  }
};

const near = (a, b) =>
  Number.isFinite(a) && Math.abs(a - b) < 1e-9;

const force = {
  id: "force-1",
  type: "force",
  geometry: {
    start: { x: 100, y: 100 },
    end: { x: 130, y: 100 },
    position: { x: 100, y: 100 },
    magnitude: 100,
    angle: 30,
    unit: "N"
  }
};

/*
 * THE COMPONENTS OBJECT, BUILT AS THE TOOL BUILDS IT: one object, one
 * dependency, created by the factory and then refreshed from the source.
 */
const components = state.geometryFactories["force-components"](
  { x: 100, y: 100 },
  { x: 186.6, y: 150 },
  {}
);

deps.registerDependency(components, [force.id]);

/*
 * THE FACTORY ALONE DOES NOT POPULATE THE SEGMENTS.
 *
 * They are written by the refresh, from the source force - which is the
 * design working as intended: a components object is a reading of a
 * force, and the reading is taken by the registry rather than assembled
 * piecemeal by the place that created it. An earlier version of this test
 * asserted against the factory's output and failed with "original is
 * missing" on all four fields, which says nothing about the app.
 */
deps.refreshAnalysis(components, {
  objects: [force, components],
  selection: { selectedObjectIds: [] },
  interaction: { phase: "idle" }
});

const drawing = {
  objects: [force, components],
  selection: { selectedObjectIds: [] },
  interaction: { phase: "idle" }
};

/*
 * WHAT THE COMPONENTS SAY RIGHT NOW, reduced to the three vectors. The
 * three segments are the whole content of a decomposition, so if they are
 * right the object is right.
 */
const reading = object => ({
  original: object.geometry.original
    ? { ...object.geometry.original.end }
    : null,
  horizontal: object.geometry.horizontal
    ? { ...object.geometry.horizontal.end }
    : null,
  vertical: object.geometry.vertical
    ? { ...object.geometry.vertical.end }
    : null,
  origin: object.geometry.origin
    ? { ...object.geometry.origin }
    : null
});

/*
 * THE TRUTH, FROM A FRESH DERIVATION OF THE CURRENT FORCE.
 *
 * Computed rather than written out, so the expected values cannot go
 * stale alongside the code under test - which is the whole failure mode
 * being looked for, and it would be a poor way to test for it.
 */
/*
 * WHAT THE COMPONENTS SHOULD BE, FROM THE FORCE AS IT IS NOW. They are DRAWN
 * as the projections of the force's drawn arrow (`derived.drawn`) and STATE
 * its value (`forceX`/`forceY`) - the retired Vector Scale used to make the
 * two the same numbers. A refresh that went stale would disagree with either.
 */
const expected = () => {
  const derived = deps.deriveForceComponents(force);

  if (!derived) return null;

  const o = derived.origin;
  const d = derived.drawn;

  return {
    original: { x: o.x + d.original.x, y: o.y + d.original.y },
    horizontal: { x: o.x + d.x.x, y: o.y + d.x.y },
    vertical: { x: o.x + d.y.x, y: o.y + d.y.y },
    origin: o,
    forceX: derived.x.x,
    forceY: derived.y.y
  };
};

/*
 * COMPARE THE WHOLE READING.
 *
 * Field by field, because "the components did not move" and "the
 * components did not change direction" are different faults and a single
 * yes/no would conflate them.
 */
const agrees = () => {
  const want = expected();
  const got = reading(components);

  if (!want) return { ok: false, why: "the force derives nothing" };

  const problems = [];

  if (!near(components.geometry.forceX, want.forceX) || !near(components.geometry.forceY, want.forceY)) {
    problems.push(
      `the components state (${components.geometry.forceX}, ${components.geometry.forceY}), the force says (${want.forceX}, ${want.forceY})`
    );
  }

  ["original", "horizontal", "vertical", "origin"].forEach(key => {
    const a = got[key];
    const b = want[key];

    if (!a) {
      problems.push(`${key} is missing`);
      return;
    }

    if (!near(a.x, b.x) || !near(a.y, b.y)) {
      problems.push(
        `${key} is (${a.x}, ${a.y}), the force says (${b.x}, ${b.y})`
      );
    }
  });

  return {
    ok: problems.length === 0,
    why: problems.join("; ")
  };
};

console.log("\n  the components follow their force\n");

/*
 * FIRST: that the refresh really does write the segments. Asserted
 * separately from whether they are RIGHT, because "nothing was written"
 * and "the wrong thing was written" are different faults and a single
 * check would report them as one.
 */
const first = reading(components);

check(
  "the refresh writes the three segments at all",
  first.original && first.horizontal && first.vertical,
  `reading = ${JSON.stringify(first)}`
);

deps.refreshAnalysis(components, drawing);

const initial = agrees();

check(
  "a freshly refreshed components object agrees with its force",
  initial.ok,
  initial.why
);

/* ============================================================
   THE FORCE MOVES
   ============================================================ */

console.log("\n  when the force moves\n");

force.geometry.start = { x: 300, y: 220 };
force.geometry.position = { x: 300, y: 220 };
force.geometry.end = { x: 330, y: 220 };

deps.refreshAnalysis(components, drawing);

const moved = agrees();

check(
  "the components follow the force to its new position",
  moved.ok,
  moved.why
);

check(
  "the origin really did move",
  reading(components).origin &&
    near(reading(components).origin.x, 300) &&
    near(reading(components).origin.y, 220),
  `origin = ${JSON.stringify(reading(components).origin)}`
);

/* ============================================================
   THE MAGNITUDE CHANGES
   ============================================================ */

console.log("\n  when the magnitude changes\n");

force.geometry.magnitude = 250;

deps.refreshAnalysis(components, drawing);

const bigger = agrees();

check(
  "the components follow a new magnitude",
  bigger.ok,
  bigger.why
);

const afterBigger = reading(components);

/*
 * A 250 N FORCE AT 30 DEGREES. The x component is most of the force and
 * the y component is a minority of it, so the x shaft is the longer one.
 *
 * The earlier version of this check compared the x component against the
 * y component's own x value - two numbers with no relationship to each
 * other - and passed whatever the force was. It is replaced with the
 * thing it should have asked: does the x component actually carry most of
 * the force?
 */
const xSpan = Math.abs(components.geometry.forceX);

const ySpan = Math.abs(components.geometry.forceY);

check(
  "a force at 30 degrees has most of itself along x",
  xSpan > ySpan,
  `Fx ${xSpan}, Fy ${ySpan}`
);

/*
 * AND THE ARITHMETIC CLOSES, which is the check that would survive a
 * regression in either component. The two components together must still
 * make the whole force: 250 at 30 degrees is about 216.5 by 125.
 */
check(
  "the larger components still square back to the new magnitude",
  near(Math.hypot(components.geometry.forceX, components.geometry.forceY), 250),
  `hypot = ${Math.hypot(components.geometry.forceX, components.geometry.forceY)}`
);

void afterBigger;

/* ============================================================
   THE DIRECTION CHANGES - INCLUDING THROUGH ZERO
   ============================================================ */

console.log("\n  when the direction changes\n");

/*
 * The direction is where a stale component is most visible, because the
 * two component arrows have to SWAP their lengths. A snapshot taken at 30
 * degrees would keep the same two lengths and only the original would be
 * wrong - which is a subtle wrong, and the reason a magnitude-only check
 * would pass it.
 */
/* Re-aimed as the panel does it: the value's direction AND the drawn arrow turn. */
global.window.enggLoadProfile.setForceVector(force.geometry, force.geometry.magnitude, 120);

deps.refreshAnalysis(components, drawing);

const reaimed = agrees();

check(
  "the components follow a new direction",
  reaimed.ok,
  reaimed.why
);

const afterAim = reading(components);

check(
  "a negative horizontal component really did become negative",
  afterAim.horizontal && afterAim.horizontal.x < afterAim.origin.x,
  `horizontal = ${JSON.stringify(afterAim.horizontal)}, origin = ${JSON.stringify(afterAim.origin)}`
);

check(
  "a positive vertical component really did become positive",
  afterAim.vertical && afterAim.vertical.y > afterAim.origin.y,
  `vertical = ${JSON.stringify(afterAim.vertical)}, origin = ${JSON.stringify(afterAim.origin)}`
);

/* ============================================================
   THE FORCE IS TURNED END OVER END
   ============================================================ */

console.log("\n  when the force is reversed\n");

/* Re-aimed as the panel does it: the value's direction AND the drawn arrow turn. */
global.window.enggLoadProfile.setForceVector(force.geometry, force.geometry.magnitude, 300);

deps.refreshAnalysis(components, drawing);

const reversed = agrees();

check(
  "the components follow a reversed force",
  reversed.ok,
  reversed.why
);

/* ============================================================
   THE FORCE SAYS NOTHING ANY MORE
   ============================================================ */

console.log("\n  when the force stops saying anything\n");

/*
 * A force the student has not finished describing must leave the
 * components with nothing to show, rather than freezing the last good
 * reading - which would be a decomposition of a force that no longer
 * says what it used to.
 */
delete force.geometry.magnitude;
delete force.geometry.angle;

/* The same value in component form - a force that says nothing has neither. */
delete force.geometry.forceX;
delete force.geometry.forceY;

deps.refreshAnalysis(components, drawing);

check(
  "an unfinished force is reported as unresolved, not frozen",
  components.engineering.unresolved === false &&
    deps.deriveForceComponents(force) === null,
  `unresolved = ${components.engineering.unresolved}`
);

/* ============================================================
   THE FORCE IS DELETED
   ============================================================ */

console.log("\n  when the force is deleted\n");

/*
 * Deleting a source is not a special case in here: findSource returns
 * null, and the object is marked rather than left drawing a decomposition
 * of something that is gone. Which is exactly the behaviour that matters -
 * a decomposition still on screen after its force has been deleted looks
 * like a working answer.
 */
/*
 * THE DELETE PATH, AS THE APP ACTUALLY DOES IT.
 *
 * The order matters and is the whole question. The delete handler filters
 * the deleted objects OUT of the model first, and only then calls
 * resolveAnalysisAfterDeletion with their ids - so the resolver is asked
 * what is still STANDING after the deletion, not what is about to be
 * removed. `findSource` finds nothing precisely because the force is
 * already gone.
 *
 * An earlier version of this test called the resolver with the force still
 * in the model, and reported "deleting the force does not remove the
 * components" as a broken cascade. That was the test's precondition being
 * wrong, not the app: the app never calls it that way.
 */
drawing.objects = drawing.objects.filter(
  object => object.id !== force.id
);

const removed = deps.resolveDeletedSources(
  drawing,
  new Set([force.id])
);

check(
  "deleting the force removes the components that depended on it",
  removed.indexOf(components.id) >= 0,
  `removed: ${JSON.stringify(removed)}, components: ${components.id}`
);

check(
  "the components are gone from the model too",
  drawing.objects.every(
    object => object.id !== components.id
  ),
  `still present: ${
    drawing.objects
      .filter(o => o.id === components.id)
      .map(o => o.id)
      .join(",") || "none"
  }`
);

/*
 * A DIAGRAM IS NOT A GENERATED OBJECT. It is a workspace the student has
 * been drawing in, so deleting the member it was read against leaves it on
 * the sheet - marked, rather than removed. Removing it would throw away
 * the student's own work on it, which is the opposite of what the delete
 * was for.
 */
console.log("\n  a diagram survives its source, marked\n");

const diagram = state.geometryFactories[
  "shear-force-diagram"
](
  { x: 0, y: -60 },
  { x: 300, y: -60 },
  {}
);

deps.registerDependency(diagram, [force.id]);

const withDiagram = {
  objects: [force, diagram],
  selection: { selectedObjectIds: [] },
  interaction: { phase: "idle" }
};

withDiagram.objects = withDiagram.objects.filter(
  object => object.id !== force.id
);

const diagramRemoved = deps.resolveDeletedSources(
  withDiagram,
  new Set([force.id])
);

check(
  "a diagram is NOT removed when its source is deleted",
  diagramRemoved.indexOf(diagram.id) < 0,
  `removed: ${JSON.stringify(diagramRemoved)}`
);

check(
  "a diagram is marked as unresolved instead",
  diagram.engineering.unresolved === true,
  `unresolved = ${diagram.engineering.unresolved}`
);

console.log(
  `\n  ${pass} passed, ${fail} failed\n`
);

if (fail) {
  process.exitCode = 1;
}
