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
function joinedPair(m, { freeEnd = { x: 300, y: 150 }, otherEnd = { x: 100, y: 0 } } = {}) {
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

/*
 * THE OUTER END OF THE OTHER RUN the fitting holds - the end the bend does NOT
 * place, and therefore the one an edit must leave exactly where it was.
 */
function liveOuter(m, elbow, heldOfEdited) {
  const other = (elbow.engineering.connections || [])
    .map((id) => (id ? m.state.objects.find((object) => object.id === id) : null))
    .find((run) => run && heldEnd(elbow, run) !== heldOfEdited);

  if (!other) {
    return null;
  }

  const held = heldEnd(elbow, other);

  return held ? { ...other.geometry[held === "end" ? "start" : "end"] } : null;
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

test("Case B: dragging the free endpoint keeps the elbow and follows the new direction", () => {
  const m = modules();
  const { host, elbow } = joinedPair(m);

  const held = heldEnd(elbow, host);
  const free = held === "end" ? "start" : "end";

  const radius = Number(elbow.engineering.bendRadius);
  const angle = m.pipe.elbowAngleDegrees(elbow);
  const outerEnd = liveOuter(m, elbow, held);

  dragEndpoint(m, host, free, { x: -80, y: 60 });

  const settled = m.state.objects.find((object) => object.id === elbow.id);

  /*
   * THE JOIN SURVIVES THE RESHAPE. Swinging a pipe's free end changes the
   * DIRECTION it arrives at the corner from, not whether it is joined - so the
   * fitting must still be there, still holding both runs.
   */
  assert.ok(settled, "the elbow is still on the sheet");
  assert.equal(
    (settled.engineering.connections || []).filter(Boolean).length,
    2,
    "and still joins both runs"
  );

  assert.deepEqual(host.geometry[free], { x: -80, y: 60 }, "the free end followed the drag");

  /*
   * THE OUTER END OF THE OTHER PIPE IS UNTOUCHED. Only the gesture's own endpoint
   * moved; the pipe on the far side of the bend keeps the end the student set.
   */
  assert.deepEqual(liveOuter(m, elbow, held), outerEnd, "the unedited pipe's outer end is fixed");

  assert.equal(Number(settled.engineering.bendRadius), radius, "the radius did not drift");

  /*
   * AND THE BEND FOLLOWS. The two arms now meet at 55.3 degrees, so the fitting
   * is re-derived at that angle, from the pipes' current lines.
   */
  const expected = m.pipe.cornerAngleFromArms(
    host.geometry[free],
    { x: 100, y: 0 },
    { x: 300, y: 150 }
  );

  assert.ok(
    Math.abs(m.pipe.elbowAngleDegrees(settled) - expected) < 1e-6,
    `the bend follows the pipes' new direction (${m.pipe.elbowAngleDegrees(settled)} against ${expected})`
  );

  assert.notEqual(m.pipe.elbowAngleDegrees(settled), angle, "which is not the angle it had");
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

  const angleBefore = m.pipe.elbowAngleDegrees(elbow);

  const joinedBefore = { ...host.geometry[held] };

  dragEndpoint(m, host, free, { x: -60, y: 90 });

  const settled = m.state.objects.find((object) => object.id === elbow.id);

  assert.ok(settled, "the elbow survives, whichever way the host was drawn");

  /*
   * THE RUN IS STILL HELD BY THE BEND. Its joined end sits on the bend's tangent
   * point for that arm - which moves when the bend is re-derived at the new angle,
   * so the test is that the end IS the tangent, not that it never moved.
   */
  const curve = settled && m.pipe.elbowCurvesFor(settled, m.pipe.fittingRuns(settled));
  const tangent = held === "end" ? curve?.end : curve?.start;

  assert.ok(
    tangent && Math.hypot(host.geometry[held].x - tangent.x, host.geometry[held].y - tangent.y) < 1e-6,
    "the joined end is the bend's tangent point"
  );

  void joinedBefore;

  /*
   * AND IT HAS FOLLOWED THE PIPE. Its arms are the two runs' own far ends, so the
   * fitting is rebuilt around the corner the student now has - not left at the
   * geometry it was drawn with.
   */
  assert.deepEqual(settled.geometry.previous, { x: -60, y: 90 }, "the swung arm is the host's far end");
  assert.ok(
    Math.abs(m.pipe.elbowAngleDegrees(settled) - angleBefore) > 1e-3,
    "the bend angle followed the new direction"
  );
});
