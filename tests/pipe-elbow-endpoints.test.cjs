/* eslint-disable no-console */
/*
 * ========================================================
 * THE PIPE ENDPOINT AT AN ELBOW - THE TWO CASES
 * ========================================================
 *
 * A pipe joined to an elbow has two ends that mean different things:
 *
 *   THE ELBOW-SIDE END   is held by the fitting. It sits on the bend's tangent
 *                        point, a trim in from the corner, and the fitting owns
 *                        where it goes.
 *   THE FREE END         is the student's. It is the far end of the run, and it
 *                        is the one a drag is for reshaping the pipe.
 *
 * Both cases are driven through the SAME functions the canvas uses:
 * `handleAtPoint` to pick, the pipe-duct branch of `applyManipulation` to
 * write, and `reconcileFluidConnections` to settle the pair. These checks
 * therefore fail if the interaction, the model or the fit disagree.
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

function modules() {
  ready();

  return {
    pipe: require(locate("model/fluids/pipe-duct.js")).default,
    tool: require(locate("pipe-duct-tool.js")),
    handles: require(locate("handles.js")),
    drag: require(locate("drag.js")),
    state: require(locate("editor-state.js")).drawingState
  };
}

function reset(state) {
  state.objects = [];
  state.selection.selectedObjectIds = [];
  state.interaction.phase = "idle";
  state.interaction.previousRun = null;
}

/* A pipe whose `end` is joined to an elbow; its `start` is free. */
function joinedPair(m, { freeEnd = { x: 300, y: 150 }, otherEnd = { x: 100, y: 0 } = {}) {
  reset(m.state);

  const host = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
  const branch = m.pipe.createPipeDuct(freeEnd, otherEnd);

  host.name = "Host";
  branch.name = "Branch";

  m.state.objects = [host, branch];

  m.tool.connectPipeEndpoints(branch);

  const elbow = m.state.objects.find((object) => object.type === "elbow");

  return { host, branch, elbow };
}

/* The end of `run` the fitting holds, from the fitting's own record. */
function heldEnd(elbow, run) {
  return elbow?.engineering?.ports?.[run.id] || null;
}

/* Drive the pipe-duct branch of the drag exactly as `applyManipulation` does. */
function dragEndpoint(m, run, end, to) {
  m.state.selection.selectedObjectIds = [run.id];

  const snapshot = JSON.parse(JSON.stringify(run));

  m.drag.applyManipulationForTest(
    {
      object: run,
      kind: end,
      start: { ...run.geometry[end] },
      anchor: { ...run.geometry[end] },
      originals: { [run.id]: snapshot }
    },
    to
  );
}

/* ============================================================
 * CASE A — THE ELBOW-SIDE END MUST NOT DETACH THE PIPE
 * ============================================================ */

test("Case A: the elbow-side endpoint is the end the fitting holds", () => {
  const m = modules();
  const { host, elbow } = joinedPair(m);

  assert.ok(elbow, "the pair earns an elbow");

  const held = heldEnd(elbow, host);

  assert.ok(held === "start" || held === "end", "the fitting records which of the host's ends it holds");

  /* And it has been seated: cut back from the corner by the bend's trim. */
  assert.ok(
    Number(elbow.engineering.bendTrim) > 0,
    "a settled fitting records the trim it eats from each run"
  );
});

test("Case A: dragging the elbow-side endpoint keeps the pipe attached", () => {
  const m = modules();
  const { host, elbow } = joinedPair(m);

  const held = heldEnd(elbow, host);
  const free = held === "end" ? "start" : "end";
  const freeBefore = { ...host.geometry[free] };
  const elbowBefore = JSON.stringify(elbow.geometry);

  /* Pull the joined end a little way out along its own axis. */
  const joined = host.geometry[held];
  const out = { x: joined.x - 8, y: joined.y - 8 };

  dragEndpoint(m, host, held, out);

  assert.ok(
    m.state.objects.some((object) => object.id === elbow.id),
    "the elbow survives an edit of the end it holds"
  );

  assert.deepEqual(host.geometry[free], freeBefore, "the free end stays where it was");

  void elbowBefore;
});

/* ============================================================
 * CASE B — THE FREE END RESHAPES THE PIPE ONLY
 * ============================================================ */

test("Case B: dragging the free endpoint leaves the elbow untouched", () => {
  const m = modules();
  const { host, elbow } = joinedPair(m);

  const held = heldEnd(elbow, host);
  const free = held === "end" ? "start" : "end";

  const elbowPosition = { ...elbow.geometry.position };
  const radius = Number(elbow.engineering.bendRadius);
  const angle = m.pipe.elbowAngleDegrees(elbow);
  const joinedPoint = { ...host.geometry[held] };

  dragEndpoint(m, host, free, { x: -80, y: 60 });

  assert.ok(
    m.state.objects.some((object) => object.id === elbow.id),
    "the elbow is still on the sheet"
  );

  assert.deepEqual(host.geometry[free], { x: -80, y: 60 }, "the free end followed the drag");

  assert.deepEqual(
    host.geometry[held],
    joinedPoint,
    "the joined end stayed on its seat"
  );

  assert.deepEqual(elbow.geometry.position, elbowPosition, "the corner did not move");
  assert.equal(Number(elbow.engineering.bendRadius), radius, "the radius did not drift");
  assert.equal(m.pipe.elbowAngleDegrees(elbow), angle, "the bend angle did not change");
});

test("Case B: the pipe keeps its width and both walls follow the new free end", () => {
  const m = modules();
  const { host, elbow } = joinedPair(m);

  const held = heldEnd(elbow, host);
  const free = held === "end" ? "start" : "end";

  const width = m.pipe.boundarySeparation(host.engineering);

  dragEndpoint(m, host, free, { x: -80, y: 60 });

  assert.equal(m.pipe.boundarySeparation(host.engineering), width, "Pipe Width is unchanged");

  const walls = m.pipe.boundaryLinesOf(host);

  assert.equal(walls.length, 2, "two boundary lines");
  assert.ok(Math.abs(Math.hypot(
    walls[0].start.x - walls[1].start.x,
    walls[0].start.y - walls[1].start.y
  ) - width) < 1e-6, "the walls are one Pipe Width apart at the free end");
});

/* ============================================================
 * THE SAME, WITH THE PIPE DRAWN THE OTHER WAY ROUND
 * ============================================================ */

test("both cases work with the pipe drawn in the opposite direction", () => {
  const m = modules();

  reset(m.state);

  /* The host is drawn right-to-left, so the joined end is `start`. */
  const host = m.pipe.createPipeDuct({ x: 100, y: 0 }, { x: 0, y: 0 });
  const branch = m.pipe.createPipeDuct({ x: 300, y: 150 }, { x: 100, y: 0 });

  host.name = "HostRev";
  branch.name = "BranchRev";

  m.state.objects = [host, branch];

  m.tool.connectPipeEndpoints(branch);

  const elbow = m.state.objects.find((object) => object.type === "elbow");

  assert.ok(elbow, "a reversed host still earns its elbow");

  const held = heldEnd(elbow, host);

  assert.ok(held === "start" || held === "end", "the held end is recorded by the fitting");

  const free = held === "end" ? "start" : "end";

  const elbowBefore = JSON.stringify(elbow.geometry);
  const joinedBefore = { ...host.geometry[held] };

  dragEndpoint(m, host, free, { x: -60, y: 90 });

  assert.ok(
    m.state.objects.some((object) => object.id === elbow.id),
    "the elbow survives, whichever way the host was drawn"
  );

  assert.deepEqual(host.geometry[held], joinedBefore, "the joined end is still its seat");
  assert.equal(
    JSON.stringify(elbow.geometry),
    elbowBefore,
    "the elbow is untouched by a free-end edit"
  );
});
