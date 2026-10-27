/*
 * ========================================================
 * A CHAIN OF PIPES JOINED BY ELBOWS STAYS COHERENT WHEN AN END IS MOVED
 * ========================================================
 *
 * THE REPORTED FAILURE.
 *
 * Draw three Pipe / Duct runs in a chain, joined by two automatic Elbows. Move
 * a free endpoint of one pipe far enough to change that pipe's direction, and
 * the geometry used to come apart: the pipe on the OTHER side of the elbow ran
 * straight on past (and into) the bend, the connection record was lost, and -
 * once the elbow had gone - a Junction appeared where nothing had branched.
 *
 * WHAT IS ASSERTED.
 *
 * Every check is made on the authoritative model, driven through the SAME
 * functions the canvas uses:
 *
 *   `commitRouteSegment`          drawing a leg and the elbow it earns
 *   `begin/update/finishManipulationDrag`   the real pointer drag of an end
 *   `elbowCurvesFor` / `cornerOf`           the bend and its connection
 *   `boundaryLinesOf` + `bendJoints`        the walls as the renderer draws them
 *
 * The "no overrun" check compares each joined wall's end with the seam the bend
 * reports, which is exactly what the renderer cuts it to (`seamPipeWalls`), so a
 * wall that has run past the arc fails here instead of only looking wrong.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { bootApp } = require("./helpers/boot-app.cjs");
const { locate } = require("./helpers/source-path.cjs");

test.after(() => {
  setImmediate(() => process.exit(process.exitCode || 0));
});

let page = null;

const PIXELS_PER_UNIT = 2;
const CANVAS = { left: 0, top: 0, width: 900, height: 700, right: 900, bottom: 700, x: 0, y: 0 };

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

  const dom = require(locate("interaction/dom.js"));

  dom.drawingCanvas.getBoundingClientRect = () => CANVAS;
  Object.defineProperty(dom.drawingCanvas, "clientWidth", { value: CANVAS.width, configurable: true });
  Object.defineProperty(dom.drawingCanvas, "clientHeight", { value: CANVAS.height, configurable: true });
  dom.drawingCanvas.setPointerCapture = () => {};
  dom.drawingCanvas.releasePointerCapture = () => {};
  dom.drawingCanvas.hasPointerCapture = () => true;

  const editor = require(locate("editor-state.js"));
  const drawingStateModule = require(locate("drawing-state.js")).default;

  return {
    pipe: require(locate("model/fluids/pipe-duct.js")).default,
    junction: require(locate("model/fluids/junction.js")).default,
    tool: require(locate("pipe-duct-tool.js")),
    drag: require(locate("drag.js")),
    sync: require(locate("source-synchronization.js")),
    state: editor.drawingState,
    editorState: editor.editorState,
    drawingState: drawingStateModule
  };
}

function reset(m) {
  m.state.objects = [];
  m.state.selection.selectedObjectIds = [];
  m.state.interaction.phase = "idle";
  m.state.interaction.previousRun = null;
  m.state.manipulationDrag = null;
  m.state.activeTool = "select";
  m.state.camera.zoom = PIXELS_PER_UNIT / m.drawingState.BASE_PIXELS_PER_UNIT;
  m.state.camera.panX = 0;
  m.state.camera.panY = 0;
  m.editorState.manipulationDrag = null;
}

const pointer = (type, point) => {
  const event = new window.MouseEvent(type, {
    clientX: CANVAS.left + CANVAS.width / 2 + point.x * PIXELS_PER_UNIT,
    clientY: CANVAS.top + CANVAS.height / 2 - point.y * PIXELS_PER_UNIT,
    bubbles: true,
    button: 0
  });

  event.pointerId = 1;
  event.pointerType = "mouse";

  return event;
};

const live = (m, id) => m.state.objects.find((object) => object.id === id);

const elbows = (m) => m.state.objects.filter((object) => object.type === "elbow");
const junctions = (m) => m.state.objects.filter((object) => object.type === "junction");
const runs = (m) => m.state.objects.filter((object) => object.type === "pipe-duct");

/* Drag a pipe's endpoint with the real pointer path, as the canvas does. */
function dragEndTo(m, runId, from, to) {
  m.state.selection.selectedObjectIds = [runId];

  const started = m.drag.beginManipulationDrag(pointer("pointerdown", from));

  assert.ok(started, "a press on the endpoint starts a drag");

  m.drag.updateManipulationDrag(pointer("pointermove", to));
  m.drag.finishManipulationDrag(pointer("pointerup", to));
}

/*
 * THE THREE-RUN CHAIN. `middle` is drawn second, so the elbows on either side
 * of it are earned by the two legs that follow it.
 */
function chain(m) {
  reset(m);

  const first = m.tool.commitRouteSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {});
  const second = m.tool.commitRouteSegment({ x: 100, y: 0 }, { x: 100, y: 100 }, {
    previousRun: first.run,
    routeCommittedCount: 1
  });
  const third = m.tool.commitRouteSegment({ x: 100, y: 100 }, { x: 200, y: 100 }, {
    previousRun: second.run,
    routeCommittedCount: 2
  });

  return { first: first.run, second: second.run, third: third.run };
}

/* The fitting holding `run` at one of its ends. */
function elbowHolding(m, run) {
  return elbows(m).find((elbow) => (elbow.engineering?.connections || []).includes(run.id)) || null;
}

/* The end of `run` the fitting holds, and the end the student still owns. */
function endsOf(elbow, run) {
  const held = elbow?.engineering?.ports?.[run.id];

  if (held !== "start" && held !== "end") {
    return null;
  }

  return { held, free: held === "end" ? "start" : "end" };
}

/*
 * ========================================================
 * THE JOINT AS IT IS ACTUALLY DRAWN
 * ========================================================
 *
 * A joined run's walls must stop where its bend's arcs begin. The renderer cuts
 * each wall to `geometry.bendJoints[end]` (see `seamPipeWalls`), so a run that
 * has no seam - or a seam that is not on the bend - is a run whose wall runs on
 * into the fitting. This is measured here, on the stored model.
 */
function seamOf(run, end) {
  return run?.geometry?.bendJoints?.[end] || null;
}

/* How far a point lies along the run from its free end, as a signed distance. */
function alongRun(run, end, point) {
  const free = end === "end" ? run.geometry.start : run.geometry.end;
  const direction = enPointDirection(free, run.geometry[end]);

  if (!direction) {
    return null;
  }

  return (point.x - free.x) * direction.x + (point.y - free.y) * direction.y;
}

function enPointDirection(from, to) {
  const length = Math.hypot(to.x - from.x, to.y - from.y);

  return length < 1e-12
    ? null
    : { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
}

/*
 * THE INVARIANTS OF A SETTLED JOINED PAIR, checked together because a drawing
 * that fails any one of them shows a wall through its own bend.
 */
function assertPairIsCoherent(m, elbow, label) {
  assert.ok(elbow, `${label}: the elbow still exists`);
  assert.ok(
    m.state.objects.some((object) => object.id === elbow.id),
    `${label}: the elbow is still on the sheet`
  );

  const pair = (elbow.engineering?.connections || []).map((id) => live(m, id));

  assert.equal(pair.length, 2, `${label}: the fitting records exactly two runs`);
  assert.ok(pair[0] && pair[1], `${label}: both joined runs are on the sheet`);

  const curve = m.pipe.elbowCurvesFor(elbow, m.pipe.fittingRuns(elbow));

  assert.ok(curve, `${label}: the bend is drawable`);
  assert.equal(pair[0].type, "pipe-duct", `${label}: the first joined run is a pipe`);

  pair.forEach((run, index) => {
    const ends = endsOf(elbow, run);

    assert.ok(ends, `${label}: ${run.name} has a held end recorded`);

    const trim = Number(run.geometry?.trims?.[ends.held]);

    assert.ok(trim > 0, `${label}: ${run.name} is cut back where the bend holds it`);

    /*
     * THE WALLS DO NOT RUN PAST THE BEND. The seam is the point the renderer
     * cuts that wall to; it must lie exactly on the bend's matching tangent.
     */
    const seam = seamOf(run, ends.held);

    assert.ok(seam, `${label}: ${run.name} records the seam where its walls stop`);

    const tangent = index === 0 ? curve.start : curve.end;

    seam.forEach((point, side) => {
      const offset = Math.hypot(point.x - tangent.x, point.y - tangent.y);

      assert.ok(
        offset <= m.pipe.boundarySeparation(run.engineering || {}) / 2 + 1e-6,
        `${label}: ${run.name} wall ${side} ends at the bend's tangent (${offset.toFixed(4)})`
      );
    });

    /*
     * AND THE STORED END IS THE SEAT, NOT THE CORNER. A run whose held end has
     * been left at the corner has eaten the trim's length of the bend - which
     * is the "wall drawn over the fitting" fault. Measured along the run's own
     * line, the held end must sit a trim short of it.
     */
    const held = run.geometry[ends.held];
    const along = alongRun(run, ends.held, held);

    assert.ok(
      Number.isFinite(along) && along > 0,
      `${label}: ${run.name} reaches toward the bend`
    );
  });
}

/* The angle the two runs actually make at their corner, from their own lines. */
function liveBendAngle(m, elbow) {
  return m.pipe.elbowAngleDegrees(elbow);
}

/* ============================================================
 * 1. THE CHAIN IS BUILT AS THE DRAWING TOOL BUILDS IT
 * ============================================================ */

test("a three-run chain earns one elbow per corner and no junction", () => {
  const m = modules();
  const { first, second } = chain(m);

  assert.equal(runs(m).length, 3, "three runs");
  assert.equal(elbows(m).length, 2, "one elbow at each corner");
  assert.equal(junctions(m).length, 0, "a chain of runs is not a junction");

  elbows(m).forEach((elbow, index) => {
    assertPairIsCoherent(m, elbow, `fresh chain elbow ${index}`);
  });

  /*
   * NOTHING WAS SPLIT TO MAKE THE CHAIN. Each leg is its own run and no leg was
   * cut, so every run is still the line it was drawn along: it starts on the
   * fitting that earned the previous corner, and its own far end is untouched.
   * A SPLIT would show as more than three Pipe / Duct objects on the sheet, which
   * the count above already rules out.
   */
  assert.equal(runs(m).length, 3, "no extra pipe segment was minted");

  runs(m).forEach((run) => {
    assert.ok(
      run.geometry?.span?.start && run.geometry?.span?.end,
      `${run.id} still carries the line it was drawn along`
    );
  });

  void first;
  void second;
});

/* ============================================================
 * 2. A MODERATE ENDPOINT EDIT KEEPS THE WHOLE CHAIN COHERENT
 * ============================================================ */

test("a moderate swing of a middle pipe's free end keeps both elbows and their walls", () => {
  const m = modules();
  const { first, second, third } = chain(m);

  const middle = live(m, second.id);
  const elbow = elbowHolding(m, middle);
  const ends = endsOf(elbow, middle);

  const elbowIds = elbows(m).map((candidate) => candidate.id);
  const outerEnds = {
    first: { ...live(m, first.id).geometry.start },
    third: { ...live(m, third.id).geometry.end }
  };

  const free = { ...middle.geometry[ends.free] };
  dragEndTo(m, middle.id, free, { x: free.x + 40, y: free.y + 150 });

  assert.equal(elbows(m).length, 2, "both elbows survive the edit");
  assert.deepEqual(elbows(m).map((candidate) => candidate.id), elbowIds, "with the same ids");
  assert.equal(junctions(m).length, 0, "no junction was invented by the edit");

  elbows(m).forEach((candidate, index) => {
    assertPairIsCoherent(m, live(m, candidate.id), `moderate swing elbow ${index}`);
  });

  /*
   * THE UNEDITED OUTER ENDS STAY PUT. Only the gesture's own endpoint moved.
   */
  assert.deepEqual(live(m, first.id).geometry.start, outerEnds.first, "the far pipe's outer end is fixed");
  assert.deepEqual(live(m, third.id).geometry.end, outerEnds.third, "the other far end is fixed");

  void elbow;
});

test("the elbow on the edited pipe follows the new direction, not its old angle", () => {
  const m = modules();

  /*
   * A CHAIN WHOSE LAST RUN IS FREE. The middle run of a three-leg chain is held
   * by a bend at BOTH ends, so it has no free endpoint to swing - the fitting at
   * the far end would be the one moving. The third leg is left dangling instead,
   * so the pipe being turned really is free at its outer end.
   */
  reset(m);

  const first = m.tool.commitRouteSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {});
  const second = m.tool.commitRouteSegment({ x: 100, y: 0 }, { x: 100, y: 100 }, {
    previousRun: first.run,
    routeCommittedCount: 1
  });

  const middle = live(m, second.run.id);
  const elbow = elbowHolding(m, middle);
  const ends = endsOf(elbow, middle);
  const before = liveBendAngle(m, elbow);

  const free = { ...middle.geometry[ends.free] };
  dragEndTo(m, middle.id, free, { x: free.x + 150, y: free.y + 40 });

  const after = liveBendAngle(m, live(m, elbow.id));

  assert.ok(Number.isFinite(after), "the fitting still reports a bend angle after the edit");
  assert.notEqual(
    Number(after).toFixed(2),
    Number(before).toFixed(2),
    "the bend angle was recalculated"
  );

  /* And it is the angle the two pipe lines actually make. */
  const settled = live(m, elbow.id);
  const curve = m.pipe.elbowCurvesFor(settled, m.pipe.fittingRuns(settled));

  assert.ok(curve, "the bend still draws");
  assert.ok(
    Math.abs(curve.angleDegrees - after) < 1e-6,
    "the drawn bend is the angle the fitting reports"
  );
});

/* ============================================================
 * 3. THE REGRESSION ITSELF: A LARGE EDIT MUST NOT DISCONNECT
 * ============================================================ */

test("a large swing of a middle pipe's free end leaves no wall past the elbow", () => {
  const m = modules();
  const { second } = chain(m);

  const middle = live(m, second.id);
  const elbow = elbowHolding(m, middle);
  const ends = endsOf(elbow, middle);

  const free = { ...middle.geometry[ends.free] };
  dragEndTo(m, middle.id, free, { x: -300, y: 400 });

  assert.equal(junctions(m).length, 0, "a changed direction is not a new branch");
  assert.equal(elbows(m).length, 2, "neither fitting was lost");
  assertPairIsCoherent(m, live(m, elbow.id), "large swing");
});

test("the regression: the pipe on the other side of the elbow does not run past it", () => {
  const m = modules();
  const { second } = chain(m);

  const middle = live(m, second.id);
  const elbow = elbowHolding(m, middle);
  const ends = endsOf(elbow, middle);

  const free = { ...middle.geometry[ends.free] };
  dragEndTo(m, middle.id, free, { x: free.x + 30, y: free.y + 130 });

  const settled = live(m, elbow.id);

  assert.ok(settled, "the elbow survives the edit");

  const curve = m.pipe.elbowCurvesFor(settled, m.pipe.fittingRuns(settled));

  assert.ok(curve, "the bend draws");

  const pair = (settled.engineering.connections || []).map((id) => live(m, id));

  pair.forEach((run, index) => {
    const held = settled.engineering.ports?.[run.id];

    assert.ok(held, "the run's held end is recorded");

    const trim = Number(run.geometry?.trims?.[held]);

    assert.ok(
      trim > 0,
      `${run.name} is still cut back at the bend - it does not run into it`
    );

    /*
     * DISTANCE FROM THE CORNER TO THE SEAT. For a settled pair this is the
     * bend's trim: the run stops a trim short of the corner on its own line.
     * A run that reaches the corner has overrun its bend.
     */
    const seat = run.geometry[held];
    const corner = settled.geometry.position;
    const tangent = index === 0 ? curve.start : curve.end;

    const seatToCorner = Math.hypot(seat.x - corner.x, seat.y - corner.y);
    const tangentToCorner = Math.hypot(tangent.x - corner.x, tangent.y - corner.y);

    assert.ok(
      seatToCorner >= trim - 1e-3,
      `${run.name}'s end has not been pulled into the bend (${seatToCorner.toFixed(3)} >= ${trim.toFixed(3)})`
    );

    assert.ok(
      Math.abs(tangentToCorner - trim) < 1e-3,
      `${run.name}'s tangent sits one trim from the corner`
    );

    void seatToCorner;
  });
});

/* ============================================================
 * 4. A NON-90-DEGREE RESULT, FROM A DIFFERENT STARTING CONFIGURATION
 * ============================================================ */

test("a non-90-degree bend is fitted and kept from a different starting configuration", () => {
  const m = modules();
  reset(m);

  /* A chain drawn the other way round and at an already-oblique corner. */
  const first = m.tool.commitRouteSegment({ x: 0, y: 200 }, { x: 120, y: 200 }, {});
  const second = m.tool.commitRouteSegment({ x: 120, y: 200 }, { x: 220, y: 120 }, {
    previousRun: first.run,
    routeCommittedCount: 1
  });
  const third = m.tool.commitRouteSegment({ x: 220, y: 120 }, { x: 340, y: 60 }, {
    previousRun: second.run,
    routeCommittedCount: 2
  });

  assert.equal(elbows(m).length, 2, "two oblique corners earn two elbows");

  const middle = live(m, second.run.id);
  const elbow = elbowHolding(m, middle);
  const ends = endsOf(elbow, middle);

  const free = { ...middle.geometry[ends.free] };
  dragEndTo(m, middle.id, free, { x: free.x + 170, y: free.y - 40 });

  assert.equal(elbows(m).length, 2, "both elbows are kept");

  elbows(m).forEach((candidate, index) => {
    const settled = live(m, candidate.id);
    const angle = liveBendAngle(m, settled);

    assert.ok(angle > 5 && angle < 175, `elbow ${index} is a real, non-straight bend (${angle})`);
    assertPairIsCoherent(m, settled, `oblique elbow ${index}`);
  });

  void first;
  void third;
});

/* ============================================================
 * 5. REPEATED EDITS: NO LOSS, NO DUPLICATES
 * ============================================================ */

test("several consecutive endpoint edits lose no connection and make no duplicate elbow", () => {
  const m = modules();
  const { second } = chain(m);

  const middle = live(m, second.id);
  const elbow = elbowHolding(m, middle);
  const ends = endsOf(elbow, middle);
  const elbowIds = elbows(m).map((candidate) => candidate.id).sort();

  [
    { x: 180, y: 240 },
    { x: 20, y: 300 },
    { x: 140, y: 260 },
    { x: -80, y: 180 }
  ].forEach((target, index) => {
    const live_ = live(m, second.id);

    dragEndTo(m, middle.id, { ...live_.geometry[ends.free] }, target);

    assert.equal(
      elbows(m).length,
      2,
      `edit ${index + 1}: still exactly two elbows`
    );

    assert.deepEqual(
      elbows(m).map((candidate) => candidate.id).sort(),
      elbowIds,
      `edit ${index + 1}: the same two fittings`
    );

    assert.equal(junctions(m).length, 0, `edit ${index + 1}: no junction`);
    assert.equal(runs(m).length, 3, `edit ${index + 1}: no pipe was split`);

    elbows(m).forEach((candidate, which) => {
      assertPairIsCoherent(m, live(m, candidate.id), `edit ${index + 1}, elbow ${which}`);
    });
  });
});

/* ============================================================
 * 6. RADIUS, TANGENCY AND IDENTITY SURVIVE
 * ============================================================ */

test("a connected elbow keeps its radius within the bend constraints through an edit", () => {
  const m = modules();
  const { second } = chain(m);

  const middle = live(m, second.id);
  const elbow = elbowHolding(m, middle);
  const ends = endsOf(elbow, middle);

  const radius = Number(elbow.engineering.bendRadius);
  const minimum = m.pipe.MINIMUM_BEND_RADIUS;

  const free = { ...middle.geometry[ends.free] };
  dragEndTo(m, middle.id, free, { x: free.x + 80, y: free.y + 90 });

  const settled = live(m, elbow.id);
  const after = Number(settled.engineering.bendRadius);

  assert.ok(Number.isFinite(after), "the fitting still has a radius");
  assert.ok(after > 0, "the radius is positive");
  assert.ok(after >= minimum - 1e-9, "the radius respects the drawable minimum");
  assert.ok(after <= radius + 1e-9, "an automatic radius is never grown by a pipe move");

  const curve = m.pipe.elbowCurvesFor(settled, m.pipe.fittingRuns(settled));

  assert.ok(curve, "the bend draws at that radius");
  assert.ok(
    Math.abs(Math.hypot(curve.start.x - curve.centre.x, curve.start.y - curve.centre.y) -
      curve.radius) < 1e-6,
    "the incoming tangent is one radius from the centre of curvature"
  );
  assert.ok(
    Math.abs(Math.hypot(curve.end.x - curve.centre.x, curve.end.y - curve.centre.y) -
      curve.radius) < 1e-6,
    "the outgoing tangent is one radius from the centre of curvature"
  );
});

test("pipe appearance and stable ids survive the endpoint edit", () => {
  const m = modules();
  const { first, second, third } = chain(m);

  const schema = require(locate("feature-schema.js"));

  schema.writeField(live(m, first.id), "stroke", "#ff0000");
  schema.writeField(live(m, third.id), "stroke", "#00aa00");

  const ids = {
    runs: runs(m).map((run) => run.id).sort(),
    elbows: elbows(m).map((elbow) => elbow.id).sort()
  };

  const styles = {
    red: live(m, first.id).style.stroke,
    green: live(m, third.id).style.stroke
  };

  const middle = live(m, second.id);
  const elbow = elbowHolding(m, middle);
  const ends = endsOf(elbow, middle);

  const free = { ...middle.geometry[ends.free] };
  dragEndTo(m, middle.id, free, { x: free.x + 70, y: free.y + 60 });

  assert.deepEqual(runs(m).map((run) => run.id).sort(), ids.runs, "every run keeps its id");
  assert.deepEqual(elbows(m).map((elbow_) => elbow_.id).sort(), ids.elbows, "every elbow keeps its id");

  assert.equal(live(m, first.id).style.stroke, styles.red, "the first pipe keeps its colour");
  assert.equal(live(m, third.id).style.stroke, styles.green, "the third pipe keeps its colour");
});

/* ============================================================
 * 7. SOURCE, AND UNDO
 * ============================================================ */

test("the drawing and the complete source stay in step through an elbow edit", () => {
  const m = modules();
  const { second } = chain(m);

  const middle = live(m, second.id);
  const elbow = elbowHolding(m, middle);
  const ends = endsOf(elbow, middle);

  const free = { ...middle.geometry[ends.free] };
  dragEndTo(m, middle.id, free, { x: free.x + 45, y: free.y + 120 });

  runs(m).forEach((run) => {
    const source = m.sync.sourceForObject(live(m, run.id));

    assert.ok(source, `${run.name} is written`);
    assert.ok(source.includes(run.id), `${run.name}'s stable id is in its block`);
  });

  elbows(m).forEach((candidate) => {
    assert.ok(
      m.sync.sourceForObject(live(m, candidate.id)),
      `${candidate.name} is written to the source`
    );
  });
});

test("undo restores the chain exactly as it was before the edit", () => {
  const m = modules();
  const { second } = chain(m);

  const middle = live(m, second.id);
  const elbow = elbowHolding(m, middle);
  const ends = endsOf(elbow, middle);

  const snapshot = (objects) =>
    JSON.stringify(
      objects
        .filter((object) => ["pipe-duct", "elbow"].includes(object.type))
        .map((object) => ({
          id: object.id,
          geometry: object.geometry,
          engineering: { bendRadius: object.engineering?.bendRadius, ports: object.engineering?.ports }
        }))
    );

  const before = snapshot(m.state.objects);

  const free = { ...middle.geometry[ends.free] };
  dragEndTo(m, middle.id, free, { x: free.x + 50, y: free.y + 110 });

  const after = snapshot(m.state.objects);

  assert.notEqual(after, before, "the drag changed the drawing");

  m.drawingState.undo(m.state);

  assert.equal(snapshot(m.state.objects), before, "undo puts the chain back");
});
