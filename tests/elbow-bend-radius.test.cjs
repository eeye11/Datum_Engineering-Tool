/* eslint-disable no-console */
/*
 * ========================================================
 * THE ELBOW'S BEND RADIUS - ONE OPERATION, THREE HANDLES
 * ========================================================
 *
 * A bend's radius can be changed three ways, and all three must produce the
 * SAME geometry for the same radius:
 *
 *   the Features tab's Bend Radius field     (relative change -> absolute)
 *   the radius handle on the canvas           (pointer -> absolute)
 *   a transform that resizes the bend         (absolute)
 *
 * These tests drive the real paths: the pointer events the canvas delivers for
 * a handle drag, the field writer the Features tab calls, and the model
 * predicates the renderer and the source writer read. They assert on the
 * GEOMETRY - tangency, trims, the pipes' seats and their outer ends - not on
 * the handle position or the displayed number alone, because the defect this
 * suite exists for was geometry that did not follow either of them.
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

/*
 * The canvas a drag reads its coordinates from. jsdom has no layout, so the
 * element is given a real rectangle and a size - the same boot the other drag
 * suites use - and the camera is set so one drawing unit is a known number of
 * screen pixels.
 */
const PIXELS_PER_UNIT = 20;
const CANVAS = { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 };

function modules() {
  ready();

  const dom = require(locate("interaction/dom.js"));

  dom.drawingCanvas.getBoundingClientRect = () => CANVAS;
  Object.defineProperty(dom.drawingCanvas, "clientWidth", { value: CANVAS.width, configurable: true });
  Object.defineProperty(dom.drawingCanvas, "clientHeight", { value: CANVAS.height, configurable: true });
  dom.drawingCanvas.setPointerCapture = () => {};
  dom.drawingCanvas.releasePointerCapture = () => {};
  dom.drawingCanvas.hasPointerCapture = () => true;

  const state = require(locate("editor-state.js")).drawingState;

  /* The Features tab wires its radius operation in at module load. */
  require(locate("features-editor.js"));

  return {
    pipe: require(locate("model/fluids/pipe-duct.js")).default,
    tool: require(locate("pipe-duct-tool.js")),
    handles: require(locate("handles.js")),
    drag: require(locate("drag.js")),
    schema: require(locate("feature-schema.js")),
    drawingState: require(locate("drawing-state.js")).default,
    state
  };
}

/* A fresh sheet at a known scale, with nothing selected. */
function reset(m) {
  const { state } = m;

  state.objects = [];
  state.selection.selectedObjectIds = [];
  state.interaction.phase = "idle";
  state.interaction.previousRun = null;
  state.manipulationDrag = null;
  state.history = { past: [], future: [] };
  state.grid = { ...(state.grid || {}), snapToGrid: false };
  state.camera.zoom = PIXELS_PER_UNIT / m.drawingState.BASE_PIXELS_PER_UNIT;
  state.camera.panX = 0;
  state.camera.panY = 0;
}

/*
 * A connected pair: a horizontal host running east from the origin, and a
 * branch that meets its end at `angleDegrees`. The elbow between them is the
 * subject of every test here.
 */
function connectedPair(m, angleDegrees = 90, armLength = 150) {
  reset(m);

  const theta = (angleDegrees * Math.PI) / 180;

  const host = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });

  const branch = m.pipe.createPipeDuct(
    { x: 100 + armLength * Math.cos(theta), y: armLength * Math.sin(theta) },
    { x: 100, y: 0 }
  );

  host.name = "Host";
  branch.name = "Branch";

  m.state.objects = [host, branch];
  m.tool.connectPipeEndpoints(branch);

  const elbow = m.state.objects.find((object) => object.type === "elbow");

  m.state.activeTool = "select";
  m.state.selection.selectedObjectIds = [elbow.id];

  return { host, branch, elbow };
}

/* A standalone elbow: both ends free, so it has an angle handle. */
function standaloneElbow(m) {
  reset(m);

  const elbow = m.pipe.createElbow({
    geometry: {
      position: { x: 100, y: 100 },
      ends: { a: { x: 40, y: 100 }, b: { x: 100, y: 160 } },
      angleDegrees: 90
    }
  });

  elbow.name = "Manual";
  elbow.engineering = { ...(elbow.engineering || {}), generated: false };

  m.state.objects = [elbow];
  m.state.activeTool = "select";
  m.state.selection.selectedObjectIds = [elbow.id];

  return { elbow };
}

/* --- the pointer, in the units the canvas reports ------------------------- */

function pointer(type, point) {
  const event = new window.MouseEvent(type, {
    clientX: CANVAS.left + CANVAS.width / 2 + point.x * PIXELS_PER_UNIT,
    clientY: CANVAS.top + CANVAS.height / 2 - point.y * PIXELS_PER_UNIT,
    bubbles: true,
    button: 0
  });

  event.pointerId = 1;
  event.pointerType = "mouse";

  return event;
}

function handleOf(m, elbow, kind) {
  return m.handles.editableHandlesFor(elbow).find((handle) => handle.kind === kind) || null;
}

/*
 * WHERE THE RADIUS HANDLE WOULD SIT FOR `radius`.
 *
 * The handle IS the centre of curvature, so its position is the centre of the
 * arc the bend would be drawn on at that radius: moved from the current centre
 * along the direction away from the corner. That direction is read from the
 * ARC, not from `elbowBisector` - a fitting whose stored `next` points to the
 * far side of the corner has an "inward" bisector that points outwards, while
 * the centre of curvature is always on the inside of the turn.
 */
function pointForRadius(m, elbow, radius) {
  const curves = m.pipe.elbowCurvesFor(elbow);

  assert.ok(curves, "the bend has an arc to measure from");

  const corner = elbow.geometry.position;
  const away = m.pipe.directionOf(corner, curves.centre);
  const angle = m.pipe.elbowAngleDegrees(elbow);
  const half = Math.sin((angle * Math.PI) / 360);
  const distance = radius / half;

  return { x: corner.x + away.x * distance, y: corner.y + away.y * distance };
}

/* Drag the radius handle from where it is to the radius asked for. */
function live(m, elbow) {
  return m.state.objects.find((object) => object.id === elbow.id) || elbow;
}

function dragRadiusHandleTo(m, elbow, radius, { release = true } = {}) {
  /* A committed drag clears the selection; a handle is live only on a selected feature. */
  m.state.selection.selectedObjectIds = [elbow.id];

  const liveElbow = live(m, elbow);
  const grab = handleOf(m, liveElbow, "elbow-radius");

  assert.ok(grab, "the elbow offers a radius handle");

  const started = m.drag.beginManipulationDrag(pointer("pointerdown", grab.point));

  assert.ok(started, "a press on the radius handle starts a drag");

  const target = pointForRadius(m, liveElbow, radius);

  m.drag.updateManipulationDrag(pointer("pointermove", target));

  if (release) {
    m.drag.finishManipulationDrag(pointer("pointerup", target));
  }

  return target;
}

/* --- geometry predicates, measured on the sheet --------------------------- */

const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/* The end of `run` the fitting holds. */
const heldEnd = (elbow, run) => elbow.engineering?.ports?.[run.id];

/* The end of `run` the fitting does not hold - the outer end. */
const freeEnd = (elbow, run) => (heldEnd(elbow, run) === "end" ? "start" : "end");

/*
 * THE SEAM IS CLOSED: each pipe's held end sits exactly on its tangent point,
 * so the straight walls and the arcs meet with no gap and no overlap.
 */
function seamGap(m, elbow, host, branch) {
  const curves = m.pipe.elbowCurvesFor(elbow);

  assert.ok(curves, "the bend is drawable");

  return Math.max(
    near(curves.start, host.geometry[heldEnd(elbow, host)]),
    near(curves.end, branch.geometry[heldEnd(elbow, branch)])
  );
}

/*
 * TANGENT: the radius to each tangent point is perpendicular to the pipe it
 * meets, read from the pipe's OWN drawn line (its span).
 */
function tangencyError(m, elbow, host, branch) {
  const curves = m.pipe.elbowCurvesFor(elbow);

  const lineOf = (run) => {
    const span = run.geometry?.span;
    const from = span?.start || run.geometry.start;
    const to = span?.end || run.geometry.end;

    return m.pipe.directionOf(from, to);
  };

  const radial = (point) => m.pipe.directionOf(curves.centre, point);

  const dot = (u, v) => Math.abs(u.x * v.x + u.y * v.y);

  return Math.max(dot(radial(curves.start), lineOf(host)), dot(radial(curves.end), lineOf(branch)));
}

/* The wall seams the renderer draws the straight walls to. */
function seamRecord(m, run, end) {
  const seam = run.geometry?.bendJoints?.[end];

  return Array.isArray(seam) ? seam : seam || null;
}

/* ============================================================
 * 1. THE FEATURES TAB, INCREASE AND DECREASE
 * ============================================================ */

test("Features tab: increasing Bend Radius moves the tangent points along both pipes", () => {
  const m = modules();
  const { host, branch, elbow } = connectedPair(m, 90);

  const before = Number(elbow.engineering.bendRadius);
  const outerHost = { ...host.geometry[freeEnd(elbow, host)] };
  const outerBranch = { ...branch.geometry[freeEnd(elbow, branch)] };
  const trimBefore = Number(elbow.engineering.bendTrim);

  m.schema.adjustElbowRadius(elbow, 20);

  const after = Number(elbow.engineering.bendRadius);
  const curves = m.pipe.elbowCurvesFor(elbow);

  assert.ok(after > before, "the radius grew");
  assert.ok(Math.abs(after - (before + 20)) < 1e-9, "an unclamped change is applied exactly");

  /* The tangents moved FARTHER from the corner. */
  assert.ok(
    curves.trim > trimBefore,
    "a larger radius eats further along each pipe"
  );

  assert.ok(seamGap(m, elbow, host, branch) < 1e-6, "both pipes still meet their tangent points");
  assert.ok(tangencyError(m, elbow, host, branch) < 1e-6, "the arcs are tangent to both pipes");

  assert.deepEqual(host.geometry[freeEnd(elbow, host)], outerHost, "the host's outer end is fixed");
  assert.deepEqual(
    branch.geometry[freeEnd(elbow, branch)],
    outerBranch,
    "the branch's outer end is fixed"
  );
});

test("Features tab: decreasing Bend Radius moves the tangent points back toward the bend", () => {
  const m = modules();
  const { host, branch, elbow } = connectedPair(m, 90);

  m.schema.adjustElbowRadius(elbow, 20);

  const big = m.pipe.elbowCurvesFor(elbow);
  const outerHost = { ...host.geometry[freeEnd(elbow, host)] };

  m.schema.adjustElbowRadius(elbow, -15);

  const small = m.pipe.elbowCurvesFor(elbow);

  assert.ok(small.trim < big.trim, "a smaller radius eats less of each pipe");
  assert.ok(seamGap(m, elbow, host, branch) < 1e-6, "the pipes follow the tangents back");
  assert.deepEqual(host.geometry[freeEnd(elbow, host)], outerHost, "the outer end is fixed");
});

test("Features tab: a zero or out-of-range change writes nothing", () => {
  const m = modules();
  const { elbow } = connectedPair(m, 90);

  const before = JSON.stringify(elbow);

  assert.equal(m.schema.adjustElbowRadius(elbow, 0), false, "zero is no change");
  assert.equal(JSON.stringify(elbow), before, "the fitting is untouched");

  assert.equal(
    Boolean(m.schema.adjustElbowRadius(elbow, -1e9)),
    false,
    "a change that would make the radius zero or negative is refused"
  );
  assert.equal(JSON.stringify(elbow), before, "and writes nothing at all");
});

/* ============================================================
 * 2. THE RADIUS HANDLE, INCREASE AND DECREASE
 * ============================================================ */

test("radius handle: dragging outwards increases the radius to the value pointed at", () => {
  const m = modules();
  const { host, branch, elbow } = connectedPair(m, 90);

  const was = Number(elbow.engineering.bendRadius);

  dragRadiusHandleTo(m, elbow, was + 18);

  assert.ok(
    Math.abs(Number(elbow.engineering.bendRadius) - (was + 18)) < 1e-6,
    "the pointer sets the radius itself, not a delta from where the drag began"
  );

  assert.ok(seamGap(m, elbow, host, branch) < 1e-6, "the pipes followed the handle DURING the drag");
  assert.ok(tangencyError(m, elbow, host, branch) < 1e-6, "and the arcs remained tangent");
});

test("radius handle: dragging inwards decreases the radius", () => {
  const m = modules();
  const { elbow } = connectedPair(m, 90);

  dragRadiusHandleTo(m, elbow, 40);

  const afterGrow = live(m, elbow);

  assert.ok(
    Math.abs(Number(afterGrow.engineering.bendRadius) - 40) < 1e-6,
    "the larger radius is the one pointed at"
  );

  dragRadiusHandleTo(m, afterGrow, 15);

  assert.ok(
    Math.abs(Number(live(m, elbow).engineering.bendRadius) - 15) < 1e-6,
    "the smaller radius is the one pointed at"
  );
});

/*
 * THE HOLD-FREE CHECK: the handle, the displayed value and the geometry agree
 * at EVERY frame, not only when the pointer is released.
 */
test("radius handle: the handle, the stored radius and the drawn arc agree throughout the drag", () => {
  const m = modules();
  const { elbow } = connectedPair(m, 90);

  const grab = handleOf(m, elbow, "elbow-radius");

  m.drag.beginManipulationDrag(pointer("pointerdown", grab.point));

  for (const radius of [12, 18, 27, 40, 80, 34, 14, 10]) {
    const current = live(m, elbow);

    m.drag.updateManipulationDrag(pointer("pointermove", pointForRadius(m, current, radius)));

    const curves = m.pipe.elbowCurvesFor(current);
    const handle = handleOf(m, current, "elbow-radius");
    const elbowEngineering = current.engineering;

    assert.ok(curves, `an arc exists at radius ${radius}`);

    assert.ok(
      near(handle.point, curves.centre) < 1e-9,
      `the handle sits on the centre of curvature at radius ${radius}`
    );

    assert.ok(
      Math.abs(curves.radius - Number(elbowEngineering.bendRadius)) < 1e-9,
      `the drawn arc is the stored radius at ${radius}`
    );

    /* The handle's own position, read back as a radius, is the display. */
    const half = Math.sin((m.pipe.elbowAngleDegrees(current) * Math.PI) / 360);
    const implied = near(handle.point, current.geometry.position) * half;

    assert.ok(
      Math.abs(implied - Number(elbowEngineering.bendRadius)) < 1e-6,
      `the handle implies the stored radius at ${radius}`
    );
  }

  m.drag.finishManipulationDrag(pointer("pointerup", pointForRadius(m, live(m, elbow), 10)));
});

/* ============================================================
 * 3. THE FEATURES TAB AND THE HANDLE ARE ONE OPERATION
 * ============================================================ */

test("the Features tab and the radius handle produce identical geometry for the same radius", () => {
  const m = modules();

  for (const angle of [30, 45, 60, 90, 120, 135]) {
    const target = 18;

    const byHandle = connectedPair(m, angle);
    dragRadiusHandleTo(m, byHandle.elbow, target);

    const viaHandle = JSON.stringify({
      radius: byHandle.elbow.engineering.bendRadius,
      host: byHandle.host.geometry,
      branch: byHandle.branch.geometry
    });

    const byPanel = connectedPair(m, angle);

    /*
     * THE PANEL IS ASKED FOR THE RADIUS THE HANDLE ACTUALLY ACCEPTED. Where a
     * bend cannot hold the requested value the handle clamps - correctly - and
     * the two paths must still agree about what that clamped bend IS.
     */
    const accepted = Number(byHandle.elbow.engineering.bendRadius);

    m.schema.adjustElbowRadius(
      byPanel.elbow,
      accepted - Number(byPanel.elbow.engineering.bendRadius)
    );

    const viaPanel = JSON.stringify({
      radius: byPanel.elbow.engineering.bendRadius,
      host: byPanel.host.geometry,
      branch: byPanel.branch.geometry
    });

    assert.equal(viaHandle, viaPanel, `at ${angle} degrees both paths give one bend`);
  }
});

/* ============================================================
 * 4. CLAMPING AT THE LARGEST VALID RADIUS
 * ============================================================ */

test("clamping: a request beyond the maximum stops at the radius the arms can hold", () => {
  const m = modules();
  const { host, branch, elbow } = connectedPair(m, 90);

  const limit = m.tool.elbowMaxBendRadius(elbow);

  assert.ok(limit > 0 && Number.isFinite(limit), "a 90 degree pair has a real limit");

  /* A ninety degree bend eats exactly its own radius from each arm. */
  const shorterArm = Math.min(
    near(elbow.geometry.position, host.geometry[freeEnd(elbow, host)]),
    near(elbow.geometry.position, branch.geometry[freeEnd(elbow, branch)])
  );

  assert.ok(
    Math.abs(limit - shorterArm) < 1e-6,
    "at 90 degrees the limit IS the shorter arm's length"
  );

  m.schema.adjustElbowRadius(elbow, 1e6);

  assert.ok(
    Math.abs(Number(elbow.engineering.bendRadius) - limit) < 1e-6,
    "the overshoot is clamped to the maximum, not written"
  );

  assert.ok(seamGap(m, elbow, host, branch) < 1e-6, "and the clamped bend is still a closed joint");

  const curves = m.pipe.elbowCurvesFor(elbow);

  assert.ok(curves.trim <= shorterArm + 1e-6, "no tangent point runs past a pipe's outer end");
});

test("clamping: the handle stops at the maximum valid radius", () => {
  const m = modules();
  const { elbow } = connectedPair(m, 90);

  const limit = m.tool.elbowMaxBendRadius(elbow);

  dragRadiusHandleTo(m, elbow, 1e6, { release: false });

  const handle = handleOf(m, elbow, "elbow-radius");

  assert.ok(
    Math.abs(Number(elbow.engineering.bendRadius) - limit) < 1e-6,
    "the accepted radius is the maximum"
  );

  assert.ok(
    near(handle.point, m.pipe.elbowCurvesFor(elbow).centre) < 1e-9,
    "the handle sits where the maximum radius puts it, not under the pointer"
  );

  m.drag.finishManipulationDrag(pointer("pointerup", pointForRadius(m, elbow, 1e6)));

  assert.ok(
    Math.abs(Number(elbow.engineering.bendRadius) - limit) < 1e-6,
    "releasing far away commits the clamped value, not the request"
  );
});

test("clamping: at every supported angle the clamped bend leaves straight pipe on both sides", () => {
  const m = modules();

  for (const angle of [30, 45, 60, 90, 120, 135]) {
    const { host, branch, elbow } = connectedPair(m, angle);

    m.tool.applyElbowRadius(elbow, 1e6);

    assert.ok(seamGap(m, elbow, host, branch) < 1e-6, `seam closed at ${angle}`);
    assert.ok(tangencyError(m, elbow, host, branch) < 1e-6, `tangent at ${angle}`);

    const curves = m.pipe.elbowCurvesFor(elbow);

    assert.ok(
      curves.trim < near(elbow.geometry.position, host.geometry[freeEnd(elbow, host)]) + 1e-6,
      `the host keeps straight pipe at ${angle}`
    );
  }
});

/* ============================================================
 * 5. MULTIPLE ANGLES AND RADII - THE INVARIANTS
 * ============================================================ */

test("radius-only changes preserve the bend angle, the connections and the pipes' outer ends", () => {
  const m = modules();

  for (const angle of [30, 45, 60, 90, 120, 135]) {
    for (const radius of [8, 14, 22, 30]) {
      const { host, branch, elbow } = connectedPair(m, angle);

      const angleBefore = m.pipe.elbowAngleDegrees(elbow);
      const connections = JSON.stringify(elbow.engineering.connections);
      const hostId = host.id;
      const branchId = branch.id;
      const outerHost = { ...host.geometry[freeEnd(elbow, host)] };
      const outerBranch = { ...branch.geometry[freeEnd(elbow, branch)] };
      const widthHost = m.pipe.boundarySeparation(host.engineering);
      const widthBranch = m.pipe.boundarySeparation(branch.engineering);

      m.tool.applyElbowRadius(elbow, radius);

      const at = `${angle} degrees, radius ${radius}`;

      assert.ok(
        Math.abs(m.pipe.elbowAngleDegrees(elbow) - angleBefore) < 1e-9,
        `the angle is untouched at ${at}`
      );

      assert.equal(JSON.stringify(elbow.engineering.connections), connections, `connections kept at ${at}`);
      assert.equal(host.id, hostId, `the host keeps its id at ${at}`);
      assert.equal(branch.id, branchId, `the branch keeps its id at ${at}`);

      assert.deepEqual(host.geometry[freeEnd(elbow, host)], outerHost, `the host's outer end is fixed at ${at}`);
      assert.deepEqual(
        branch.geometry[freeEnd(elbow, branch)],
        outerBranch,
        `the branch's outer end is fixed at ${at}`
      );

      assert.equal(m.pipe.boundarySeparation(host.engineering), widthHost, `the host's width is kept at ${at}`);
      assert.equal(
        m.pipe.boundarySeparation(branch.engineering),
        widthBranch,
        `the branch's width is kept at ${at}`
      );

      assert.ok(seamGap(m, elbow, host, branch) < 1e-6, `no gap at ${at}`);
      assert.ok(tangencyError(m, elbow, host, branch) < 1e-6, `tangent at ${at}`);

      /* The pipes remain independent objects with their own appearance. */
      assert.notEqual(host.style, branch.style, `the pipes keep their own styles at ${at}`);
    }
  }
});

test("the double-line walls follow the new tangents, with no stale seam behind", () => {
  const m = modules();
  const { host, branch, elbow } = connectedPair(m, 90);

  const endOf = (run) => heldEnd(elbow, run);
  const seamBefore = seamRecord(m, host, endOf(host));

  m.tool.applyElbowRadius(elbow, 32);

  const curves = m.pipe.elbowCurvesFor(elbow);

  /* The wall lines the renderer draws end at the new tangent points. */
  const walls = m.pipe.boundaryLinesOf(host);

  assert.equal(walls.length, 2, "the pipe still has two walls");

  const seamAfter = seamRecord(m, host, endOf(host));

  assert.ok(seamAfter, "the held end still records a wall seam");

  /* A seam is a pair of points, one per wall: both must sit on the tangent. */
  const points = Array.isArray(seamAfter) ? seamAfter : [seamAfter];

  points.forEach((point) => {
    if (!point || !Number.isFinite(point.x)) {
      return;
    }

    const onWall = walls.some((wall) => near(wall.start, point) < 1e-6 || near(wall.end, point) < 1e-6);

    assert.ok(onWall, "every seam point is a wall end, so the walls meet the arcs exactly");
  });

  assert.notDeepEqual(seamAfter, seamBefore, "the seam moved with the radius");

  /* The branch's own wall follows its tangent too. */
  assert.ok(
    near(branch.geometry[endOf(branch)], curves.end) < 1e-6,
    "the branch's held end is its new tangent point"
  );
});

/* ============================================================
 * 6. ENDPOINT AND ANGLE HANDLES KEEP THEIR OWN JOBS
 * ============================================================ */

test("angle handle: a standalone elbow changes ANGLE and not radius", () => {
  const m = modules();
  const { elbow } = standaloneElbow(m);

  const angleBefore = m.pipe.elbowAngleDegrees(elbow);
  const radiusBefore = Number(elbow.engineering.bendRadius);
  const endsBefore = JSON.parse(JSON.stringify(elbow.geometry.ends));

  const grab = handleOf(m, elbow, "elbow-angle");

  assert.ok(grab, "a standalone elbow offers an angle handle");

  /*
   * Sweep the handle until its direction from the corner makes a DIFFERENT
   * supported bend with the fixed arm at B (which points down, +y). A handle
   * released nearly where it started is the same angle, correctly.
   */
  const target = { x: 100 - 60, y: 100 + 60 };

  m.drag.beginManipulationDrag(pointer("pointerdown", grab.point));
  m.drag.updateManipulationDrag(pointer("pointermove", target));
  m.drag.finishManipulationDrag(pointer("pointerup", target));

  assert.notEqual(m.pipe.elbowAngleDegrees(elbow), angleBefore, "the angle followed the handle");
  assert.equal(
    Number(elbow.engineering.bendRadius),
    radiusBefore,
    "the radius SETTING was not changed by the angle handle"
  );
  assert.deepEqual(elbow.geometry.ends, endsBefore, "both ends stayed where they were");
  assert.ok(m.pipe.elbowCurvesFor(elbow), "the bend is still drawable");
});

test("angle handle: the radius handle on the same elbow does not move the angle", () => {
  const m = modules();
  const { elbow } = standaloneElbow(m);

  const angleBefore = m.pipe.elbowAngleDegrees(elbow);
  const radiusBefore = Number(elbow.engineering.bendRadius);

  dragRadiusHandleTo(m, elbow, radiusBefore + 6);

  assert.ok(
    Math.abs(Number(elbow.engineering.bendRadius) - (radiusBefore + 6)) < 1e-6,
    "the radius handle changed the radius"
  );

  assert.ok(
    Math.abs(m.pipe.elbowAngleDegrees(elbow) - angleBefore) < 1e-9,
    "and left the angle alone"
  );
});

test("connected elbows offer no angle handle and keep their bend angle read-only", () => {
  const m = modules();
  const { elbow } = connectedPair(m, 90);

  assert.equal(handleOf(m, elbow, "elbow-angle"), null, "a fully connected bend has no angle handle");
  assert.equal(
    m.schema.writeElbowAngle(elbow, 45),
    false,
    "and the Features tab refuses to type a different angle"
  );
});

test("endpoint handle: dragging one end of a standalone elbow keeps the other end put", () => {
  const m = modules();
  const { elbow } = standaloneElbow(m);

  const ends = JSON.parse(JSON.stringify(elbow.geometry.ends));
  const radiusBefore = Number(elbow.engineering.bendRadius);

  m.drag.beginManipulationDrag(pointer("pointerdown", ends.b));
  m.drag.updateManipulationDrag(pointer("pointermove", { x: ends.b.x + 15, y: ends.b.y + 25 }));
  m.drag.finishManipulationDrag(pointer("pointerup", { x: ends.b.x + 15, y: ends.b.y + 25 }));

  assert.deepEqual(elbow.geometry.ends.a, ends.a, "the other end did not move");
  assert.notDeepEqual(elbow.geometry.ends.b, ends.b, "the dragged end followed the pointer");

  const curves = m.pipe.elbowCurvesFor(elbow);

  assert.ok(curves, "the bend re-solved from the new ends");

  assert.ok(
    Math.abs(Number(elbow.engineering.bendRadius) - radiusBefore) < 1e-9,
    "an endpoint drag does not re-size the bend"
  );
});

/* ============================================================
 * 7. UNDO, REDO AND CANCELLATION RECORD THE WHOLE OPERATION
 * ============================================================ */

test("undo and redo restore the fitting AND both pipes in one step", () => {
  const m = modules();
  const { host, branch, elbow } = connectedPair(m, 90);

  const before = JSON.stringify({
    host: host.geometry,
    branch: branch.geometry,
    radius: elbow.engineering.bendRadius
  });

  dragRadiusHandleTo(m, elbow, 36);

  const dragged = Number(elbow.engineering.bendRadius);

  assert.ok(Math.abs(dragged - 36) < 1e-6, "the drag landed on the requested radius");

  m.drawingState.undo(m.state);

  const undone = {
    host: m.state.objects.find((object) => object.id === host.id),
    branch: m.state.objects.find((object) => object.id === branch.id),
    elbow: m.state.objects.find((object) => object.type === "elbow")
  };

  assert.equal(
    JSON.stringify({
      host: undone.host.geometry,
      branch: undone.branch.geometry,
      radius: undone.elbow.engineering.bendRadius
    }),
    before,
    "one undo puts the fitting and both pipes back together"
  );

  m.drawingState.redo(m.state);

  const redone = m.state.objects.find((object) => object.type === "elbow");

  assert.ok(
    Math.abs(Number(redone.engineering.bendRadius) - dragged) < 1e-9,
    "one redo restores the whole edit"
  );
});

test("cancelling a radius drag leaves no part of it behind", () => {
  const m = modules();
  const { host, branch, elbow } = connectedPair(m, 90);

  const before = JSON.stringify({
    host: host.geometry,
    branch: branch.geometry,
    radius: elbow.engineering.bendRadius
  });

  const grab = handleOf(m, elbow, "elbow-radius");

  m.drag.beginManipulationDrag(pointer("pointerdown", grab.point));
  m.drag.updateManipulationDrag(pointer("pointermove", pointForRadius(m, elbow, 30)));

  assert.ok(
    Math.abs(
      Number(m.state.objects.find((object) => object.type === "elbow").engineering.bendRadius) - 30
    ) < 1e-6,
    "the drag moved the geometry before it was cancelled"
  );

  m.handles.cancelManipulationDrag();

  const cancelled = {
    host: m.state.objects.find((object) => object.id === host.id),
    branch: m.state.objects.find((object) => object.id === branch.id),
    elbow: m.state.objects.find((object) => object.type === "elbow")
  };

  assert.equal(
    JSON.stringify({
      host: cancelled.host.geometry,
      branch: cancelled.branch.geometry,
      radius: cancelled.elbow.engineering.bendRadius
    }),
    before,
    "the fitting and its pipes are exactly as they were"
  );
});

/* ============================================================
 * 8. THE SOURCE AND THE MODEL
 * ============================================================ */

test("a radius change survives a save and reopen of the document", () => {
  const m = modules();
  const { host, branch, elbow } = connectedPair(m, 90);

  m.schema.adjustElbowRadius(elbow, 14);

  const saved = JSON.parse(JSON.stringify(m.state.objects));
  const reopened = new Map(saved.map((object) => [object.id, object]));

  const reopenedElbow = reopened.get(elbow.id);
  const reopenedHost = reopened.get(host.id);
  const reopenedBranch = reopened.get(branch.id);

  assert.ok(reopenedElbow, "the elbow is in the saved document");
  assert.equal(reopenedElbow.engineering.bendRadius, elbow.engineering.bendRadius, "the radius is saved");
  assert.deepEqual(
    reopenedElbow.engineering.connections,
    elbow.engineering.connections,
    "the connections are saved"
  );
  assert.equal(reopenedHost.id, host.id, "the host keeps its id across a save");
  assert.equal(reopenedBranch.id, branch.id, "the branch keeps its id across a save");

  /*
   * And the saved geometry BUILDS THE SAME ARC, which is what the LaTeX writer
   * draws from - the source cannot disagree with the canvas.
   */
  m.state.objects = saved;

  const curves = m.pipe.elbowCurvesFor(reopenedElbow);

  assert.ok(curves, "the reopened bend is drawable");
  assert.ok(
    Math.abs(curves.radius - Number(elbow.engineering.bendRadius)) < 1e-9,
    "the reopened arc is the saved radius"
  );

  assert.ok(
    seamGap(m, reopenedElbow, reopenedHost, reopenedBranch) < 1e-6,
    "the reopened joint is still closed"
  );
});

test("no handle is left detached: every handle sits on its own control point", () => {
  const m = modules();
  const { elbow } = connectedPair(m, 90);

  m.tool.applyElbowRadius(elbow, 25);

  const handles = m.handles.editableHandlesFor(elbow);
  const curves = m.pipe.elbowCurvesFor(elbow);

  const radius = handles.find((handle) => handle.kind === "elbow-radius");

  assert.ok(near(radius.point, curves.centre) < 1e-9, "the radius handle is the centre of curvature");

  const corner = handles.find((handle) => handle.kind === "position");

  assert.ok(near(corner.point, elbow.geometry.position) < 1e-9, "the corner handle is the corner");

  const ends = handles.filter((handle) => handle.kind === "start" || handle.kind === "end");

  ends.forEach((handle) => {
    const point = handle.kind === "start" ? elbow.geometry.ends.a : elbow.geometry.ends.b;

    assert.ok(near(handle.point, point) < 1e-9, `the ${handle.kind} handle is its own end`);
  });
});
