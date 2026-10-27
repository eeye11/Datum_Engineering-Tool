/* eslint-disable no-console */
/*
 * ========================================================
 * AUTOMATIC ELBOW CREATION, INDEPENDENT OF TOOL AND ORDER
 * ========================================================
 *
 * The reported defect: an elbow was NOT created when two pipes met at an angle
 * other than 90, and was never created at all when the two pipes already
 * existed - because the only thing that ever generated a fitting was the drawing
 * session's own "carry on from the previous run" continuation.
 *
 * These checks pin the fixed behaviour:
 *
 *   1. ANY genuine change of direction earns an elbow - 30, 45, 60, 90, 120, 135;
 *   2. a straight continuation earns none;
 *   3. two ALREADY-EXISTING pipes joined by drawing a branch onto them earn one;
 *   4. two already-existing pipes brought together by MOVING an end earn one;
 *   5. no tool selection or creation order is involved in either case;
 *   6. the bend stays tangent to both pipes at every angle;
 *   7. the configured radius survives angle changes;
 *   8. breaking and remaking the join updates the fitting, never duplicating it.
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
    tool: require(locate("pipe-duct-tool.js")),
    pipe: require(locate("model/fluids/pipe-duct.js")).default,
    state: require(locate("editor-state.js")).drawingState,
    sync: require(locate("source-synchronization.js")),
    drawingState: require(locate("drawing-state.js")).default
  };
}

function reset(state) {
  state.objects = [];
  state.selection.selectedObjectIds = [];
  state.interaction.previousRun = null;
  state.interaction.routeCommittedCount = 0;
  state.interaction.phase = "idle";
}

function elbowsIn(state) {
  return state.objects.filter((object) => object.type === "elbow");
}

function pointAt(angle, radius = 120) {
  const radians = (angle * Math.PI) / 180;

  return { x: 100 + radius * Math.cos(radians), y: radius * Math.sin(radians) };
}

/* ============================================================
 * 1. ANGLE COVERAGE, AT DRAW TIME
 * ============================================================ */

const ANGLES = [30, 45, 60, 90, 120, 135];

test("drawing a second run at ANY genuine angle earns an elbow", () => {
  const m = modules();

  ANGLES.forEach((angle) => {
    reset(m.state);

    const first = m.tool.commitRouteSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {});

    const second = m.tool.commitRouteSegment({ x: 100, y: 0 }, pointAt(angle), {
      previousRun: first.run,
      routeCommittedCount: 1
    });

    assert.ok(second.elbow, `a ${angle} degree corner must earn an elbow`);
    assert.equal(elbowsIn(m.state).length, 1, `exactly one elbow at ${angle}`);

    assert.ok(
      Math.abs(m.pipe.elbowAngleDegrees(second.elbow) - angle) < 0.5,
      `the elbow reads ${angle} degrees, got ${m.pipe.elbowAngleDegrees(second.elbow)}`
    );
  });
});

test("a straight collinear continuation earns NO elbow", () => {
  const m = modules();

  reset(m.state);

  const first = m.tool.commitRouteSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {});

  const second = m.tool.commitRouteSegment({ x: 100, y: 0 }, { x: 220, y: 0 }, {
    previousRun: first.run,
    routeCommittedCount: 1
  });

  assert.equal(second.elbow, null);
  assert.equal(elbowsIn(m.state).length, 0);
});

/* ============================================================
 * 2. EXISTING PIPES - NO DRAWING SESSION INVOLVED
 * ============================================================ */

test("two ALREADY-EXISTING pipes joined by a later branch earn an elbow", () => {
  const m = modules();

  ANGLES.forEach((angle) => {
    reset(m.state);

    /* Pipe A exists. */
    const host = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
    m.state.objects = [host];

    /* Time passes; other objects exist; no Pipe / Duct tool is involved. */
    const decoy = m.pipe.createPipeDuct({ x: 900, y: 900 }, { x: 950, y: 900 });
    m.state.objects.push(decoy);

    /* A branch is added whose end meets A's end at an angle. */
    const branch = m.pipe.createPipeDuct(pointAt(angle), { x: 100, y: 0 });
    m.state.objects.push(branch);

    const made = m.tool.connectPipeEndpoints(branch);

    assert.equal(made.length, 1, `a ${angle} degree join between existing pipes must earn an elbow`);
    assert.equal(elbowsIn(m.state).length, 1);
    assert.equal(
      elbowsIn(m.state)[0].engineering.connections.length,
      2,
      "it records the pair it joins"
    );
  });
});

test("two existing pipes brought together by MOVING an end earn an elbow", () => {
  const m = modules();

  ANGLES.forEach((angle) => {
    reset(m.state);

    const host = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
    const mover = m.pipe.createPipeDuct({ x: 400, y: 300 }, pointAt(angle));

    m.state.objects = [host, mover];

    assert.equal(elbowsIn(m.state).length, 0, "nothing is joined yet");

    /* The handle drag lands the end exactly on the other pipe's end. */
    mover.geometry.end = { x: 100, y: 0 };

    m.tool.connectPipeEndpoints(mover);

    assert.equal(elbowsIn(m.state).length, 1, `a ${angle} degree drag-join must earn an elbow`);
  });
});

test("no join earns no elbow - a shared point is required", () => {
  const m = modules();

  reset(m.state);

  const a = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
  const b = m.pipe.createPipeDuct({ x: 101, y: 5 }, { x: 200, y: 50 });

  m.state.objects = [a, b];

  m.tool.connectPipeEndpoints(b);

  assert.equal(elbowsIn(m.state).length, 0, "pipes that merely pass near each other are not joined");
});

/* ============================================================
 * 3. TANGENCY AND RADIUS
 * ============================================================ */

test("at every angle the bend is tangent to BOTH pipes", () => {
  const m = modules();

  ANGLES.forEach((angle) => {
    reset(m.state);

    const a = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
    const b = m.pipe.createPipeDuct(pointAt(angle), { x: 100, y: 0 });

    m.state.objects = [a, b];

    /*
     * THE PIPES' DIRECTIONS ARE READ BEFORE THE JOIN. Joining trims each pipe's
     * inner end back to the tangent point - which is exactly right - so measuring
     * after it would compare the arc against a wall that had already moved.
     */
    const pipeIn = m.pipe.directionOf(a.geometry.start, a.geometry.end);
    const pipeOut = m.pipe.directionOf(b.geometry.start, b.geometry.end);

    m.tool.connectPipeEndpoints(b);

    const elbow = elbowsIn(m.state)[0];
    const curves = m.pipe.elbowCurvesFor(elbow);

    assert.ok(curves, `a ${angle} degree bend is drawable`);

    /*
     * TANGENCY, MEASURED. The radius at each tangent point must be exactly
     * PERPENDICULAR to the pipe it meets - that is what "the arc touches the
     * straight wall without a kink" means.
     */
    const radialStart = m.pipe.directionOf(curves.centre, curves.start);
    const radialEnd = m.pipe.directionOf(curves.centre, curves.end);

    const dot = (u, v) => Math.abs(u.x * v.x + u.y * v.y);

    assert.ok(dot(radialStart, pipeIn) < 1e-6, `start tangent at ${angle} degrees`);
    assert.ok(dot(radialEnd, pipeOut) < 1e-6, `end tangent at ${angle} degrees`);
  });
});

test("the configured bend radius survives an angle change", () => {
  const m = modules();

  reset(m.state);

  const a = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
  const b = m.pipe.createPipeDuct({ x: 300, y: 200 }, { x: 100, y: 0 });

  m.state.objects = [a, b];

  m.tool.connectPipeEndpoints(b);

  const elbow = elbowsIn(m.state)[0];
  const radius = elbow.engineering.bendRadius;

  /* Swing the far end round: 36 degrees becomes 90. */
  b.geometry.start = { x: 100, y: 300 };

  m.tool.connectPipeEndpoints(b);
  m.tool.refreshFluidConnections(b);

  assert.equal(elbow.engineering.bendRadius, radius, "the radius must not drift with the angle");
  assert.ok(Math.abs(m.pipe.elbowAngleDegrees(elbow) - 90) < 0.5, "and the angle must follow the pipe");
});

test("the outer pipe endpoints are preserved by the join", () => {
  const m = modules();

  reset(m.state);

  const a = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
  const b = m.pipe.createPipeDuct({ x: 300, y: 150 }, { x: 100, y: 0 });

  m.state.objects = [a, b];

  m.tool.connectPipeEndpoints(b);

  assert.deepEqual(a.geometry.start, { x: 0, y: 0 }, "the host's far end is untouched");
  assert.deepEqual(b.geometry.start, { x: 300, y: 150 }, "the branch's far end is untouched");
});

/* ============================================================
 * 4. LIFECYCLE
 * ============================================================ */

test("disconnecting removes the elbow and gives the pipes their length back", () => {
  const m = modules();

  reset(m.state);

  const a = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
  const b = m.pipe.createPipeDuct({ x: 300, y: 150 }, { x: 100, y: 0 });

  m.state.objects = [a, b];

  m.tool.connectPipeEndpoints(b);

  assert.equal(elbowsIn(m.state).length, 1);

  /* Move the JOINED end away - a genuine disconnection. */
  b.geometry.end = { x: 600, y: 600 };

  m.tool.refreshFluidConnections(b);

  assert.equal(elbowsIn(m.state).length, 0, "the orphaned fitting is removed");
  assert.equal(a.geometry.trims, undefined, "and its trim goes with it");
});

test("reconnecting creates ONE new elbow, never a duplicate", () => {
  const m = modules();

  reset(m.state);

  const a = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
  const b = m.pipe.createPipeDuct({ x: 300, y: 150 }, { x: 100, y: 0 });

  m.state.objects = [a, b];

  m.tool.connectPipeEndpoints(b);
  m.tool.connectPipeEndpoints(b);
  m.tool.connectPipeEndpoints(a);

  assert.equal(elbowsIn(m.state).length, 1, "repeated discovery never duplicates");

  b.geometry.end = { x: 600, y: 600 };
  m.tool.refreshFluidConnections(b);

  assert.equal(elbowsIn(m.state).length, 0);

  b.geometry.end = { x: 100, y: 0 };
  m.tool.connectPipeEndpoints(b);

  assert.equal(elbowsIn(m.state).length, 1, "and remaking the join earns exactly one");
});

test("deleting a pipe takes its elbow, and leaves the other pipe alone", () => {
  const m = modules();

  reset(m.state);

  const a = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
  const b = m.pipe.createPipeDuct({ x: 300, y: 150 }, { x: 100, y: 0 });

  m.state.objects = [a, b];

  m.tool.connectPipeEndpoints(b);

  m.drawingState.removeObjectsAndDescendants(m.state, new Set([b.id]));

  assert.equal(elbowsIn(m.state).length, 0);
  assert.ok(
    m.state.objects.some((object) => object.id === a.id),
    "the surviving pipe is not cascade-deleted"
  );
});

/* ============================================================
 * 5. SOURCE ROUND TRIP
 * ============================================================ */

test("an automatically created non-right elbow writes and re-reads its source", () => {
  const m = modules();

  reset(m.state);

  const a = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
  const b = m.pipe.createPipeDuct({ x: 200, y: 60 }, { x: 100, y: 0 });

  m.state.objects = [a, b];

  m.tool.connectPipeEndpoints(b);

  const elbow = elbowsIn(m.state)[0];
  const source = m.sync.sourceForObject(elbow);

  assert.ok(source, "the elbow writes a source block");
  assert.ok(source.includes(elbow.id), "with its stable id");
  assert.ok(/%\s*DAETUM TYPE: elbow/.test(source));
  assert.equal((source.match(/\\draw/g) || []).length, 2, "both walls are written");
});

/* ============================================================
 * 6. THE ANGLE MODEL ITSELF
 * ============================================================ */

test("the supported-angle rule accepts any bend and refuses only straight or folded", () => {
  const m = modules();

  [30, 45, 60, 90, 120, 135, 150, 22.5].forEach((angle) => {
    assert.equal(m.pipe.supportedElbowAngle(angle), angle, `${angle} is a valid bend`);
  });

  assert.equal(m.pipe.supportedElbowAngle(0), null, "a straight continuation is not a bend");
  assert.equal(m.pipe.supportedElbowAngle(180), null, "a fold back along the same line is not a bend");
});
