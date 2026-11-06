/*
 * ========================================================
 * AN ENDPOINT ON A PIPE'S INTERIOR MAKES A JUNCTION
 * ========================================================
 *
 * THE REPORTED FAILURE.
 *
 * A branch drawn to the middle of an existing pipe must split that pipe and
 * join all three branches with one Junction. A branch whose endpoint is DRAGGED
 * to the middle of an existing pipe must do the same. Neither did, reliably.
 *
 * WHAT IS ASSERTED, AND ON WHAT.
 *
 * The drawing is driven through the same entry points the canvas uses
 * (`commitRouteSegment` for a drawn leg, `begin/update/finishManipulationDrag`
 * for a dragged end). The result is then read from the MODEL: the pipe objects
 * and their identities, the junction's branch records, the host's style, and the
 * projected split point - never from a rendered picture or an object count
 * alone.
 *
 * The two negations matter as much as the connections: an interior crossing
 * stays unconnected, a near miss stays unconnected, two ends meeting earn an
 * elbow rather than a junction, and being near an elbow earns nothing.
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

  return {
    pipe: require(locate("model/fluids/pipe-duct.js")).default,
    junction: require(locate("model/fluids/junction.js")).default,
    tool: require(locate("pipe-duct-tool.js")),
    junctionTool: require(locate("junction-tool.js")),
    drag: require(locate("drag.js")),
    schema: require(locate("feature-schema.js")),
    sync: require(locate("source-synchronization.js")),
    state: editor.drawingState,
    editorState: editor.editorState,
    drawingState: require(locate("drawing-state.js")).default
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

const pipes = (m) => m.state.objects.filter((object) => object.type === "pipe-duct");
const junctions = (m) => m.state.objects.filter((object) => object.type === "junction");
const elbows = (m) => m.state.objects.filter((object) => object.type === "elbow");

function dragEndTo(m, runId, from, to) {
  m.state.selection.selectedObjectIds = [runId];

  assert.ok(m.drag.beginManipulationDrag(pointer("pointerdown", from)), "the press starts a drag");

  m.drag.updateManipulationDrag(pointer("pointermove", to));
  m.drag.finishManipulationDrag(pointer("pointerup", to));
}

/* The host the whole suite branches from: a red pipe running east. */
function hostRun(m) {
  reset(m);

  const host = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 200, y: 0 });

  host.name = "Supply main";
  host.style = { ...host.style, stroke: "#cc0000", lineType: "dashed", lineWidth: "thick" };
  host.engineering = { ...host.engineering, separation: 9 };

  m.state.objects = [host];

  return host;
}

/* The one junction on the sheet, asserted to be a real one. */
function onlyJunction(m) {
  const found = junctions(m);

  assert.equal(found.length, 1, "exactly one junction exists");

  return found[0];
}

function connectedIds(junction) {
  return (junction.geometry?.branches || [])
    .map((branch) => branch.connected)
    .filter(Boolean);
}

/* ============================================================
 * 1. A DRAWN BRANCH THAT LANDS ON THE INTERIOR
 * ============================================================ */

test("a branch drawn onto the middle of a host splits it and makes one junction", () => {
  const m = modules();
  const host = hostRun(m);
  const hostId = host.id;

  m.tool.commitRouteSegment({ x: 100, y: 150 }, { x: 100, y: 0 }, {});

  const junction = onlyJunction(m);

  assert.equal(pipes(m).length, 3, "the host became two segments beside the branch");

  const segments = pipes(m).map((run) => run.id);

  assert.ok(segments.includes(hostId), "one segment keeps the host's id");
  assert.equal(
    segments.filter((id) => id !== hostId).length,
    2,
    "the other host segment and the branch are the only new runs"
  );

  const joined = connectedIds(junction);

  assert.equal(joined.length, 3, "the junction joins three branches");
  assert.ok(joined.includes(hostId), "the retained host segment is joined");
  assert.ok(
    joined.every((id) => m.state.objects.some((object) => object.id === id)),
    "every recorded branch exists"
  );

  assert.ok(
    m.junction.connectedBranchCount(junction) >= m.junction.MINIMUM_BRANCHES,
    "the fitting has the minimum branch count"
  );
});

test("the host segment from the host's original start keeps the host's id", () => {
  const m = modules();
  const host = hostRun(m);
  const hostStart = { ...host.geometry.start };

  m.tool.commitRouteSegment({ x: 100, y: 150 }, { x: 100, y: 0 }, {});

  const retained = live(m, host.id);

  assert.ok(retained, "the original id still names a run");
  assert.deepEqual(retained.geometry.start, hostStart, "it still starts where the host started");

  const other = pipes(m).find((run) => run.id !== host.id && run.name === "Pipe / Duct");

  assert.ok(other, "the second half is a new Pipe / Duct object");
  assert.notEqual(other.id, host.id, "with its own stable id");
});

test("both host halves inherit the host's appearance and Pipe Width", () => {
  const m = modules();
  const host = hostRun(m);

  m.tool.commitRouteSegment({ x: 100, y: 150 }, { x: 100, y: 0 }, {});

  /* The halves are the two runs that inherited the host's stroke - not the branch. */
  const halves = pipes(m).filter((run) => run.style?.stroke === "#cc0000");

  assert.equal(halves.length, 2, "two halves of the host");

  halves.forEach((half) => {
    assert.equal(half.style.stroke, "#cc0000", "the outline colour is inherited");
    assert.equal(half.style.lineType, "dashed", "the line style is inherited");
    assert.equal(half.style.lineWidth, "thick", "the thickness is inherited");
    assert.equal(
      m.pipe.boundarySeparation(half.engineering || {}),
      m.pipe.boundarySeparation(host.engineering || {}),
      "the Pipe Width is inherited"
    );
  });
});

test("the split point is the endpoint projected onto the host's centreline", () => {
  const m = modules();
  hostRun(m);

  /* Drawn 0.6 off the centreline: INSIDE the stub, so a genuine connection. */
  const branchEnd = { x: 100, y: 0.6 };

  m.tool.commitRouteSegment({ x: 100, y: 150 }, branchEnd, {});

  const junction = onlyJunction(m);

  assert.ok(
    Math.abs(junction.geometry.position.x - 100) < 1e-6 &&
      Math.abs(junction.geometry.position.y) < 1e-6,
    "the junction sits at the projected point, not at the pointer"
  );

  /*
   * BOTH HALVES ARE CUT AT THE HUB, on the host's own centreline, and each has
   * been drawn back to its branch's stub mouth - the point a joined pipe meets
   * the fitting at. Neither has been moved off the host's line.
   */
  const joined = junction.geometry.branches.map((branch) =>
    m.state.objects.find((object) => object.id === branch.connected)
  );

  const [before, after] = joined.filter((run) => run.geometry.start.y === 0);

  assert.ok(before && after, "two host halves lie on the host's line");

  assert.ok(
    Math.abs(before.geometry.end.y) < 1e-6 && Math.abs(after.geometry.start.y) < 1e-6,
    "the cut is on the host's centreline"
  );

  assert.ok(
    before.geometry.end.x < 100 && after.geometry.start.x > 100,
    "the halves lie either side of the projected point"
  );

  /* The gap between them is the fitting's own stub, not a lost length of pipe. */
  const stub = m.junction.stubLength(junction, junction.geometry.branches[0]);

  assert.ok(
    Math.abs((after.geometry.start.x - before.geometry.end.x) - 2 * stub) < 1e-6,
    "the two mouths sit one stub either side of the hub"
  );
});

test("the branch drawn onto the host stays its own pipe object", () => {
  const m = modules();
  const host = hostRun(m);

  const branch = m.tool.commitRouteSegment({ x: 100, y: 150 }, { x: 100, y: 0 }, {}).run;

  const stillThere = live(m, branch.id);

  assert.ok(stillThere, "the branch keeps its identity");
  assert.equal(stillThere.type, "pipe-duct", "and is still a Pipe / Duct");
  assert.notEqual(stillThere.id, host.id, "and is not the host");
});

/* ============================================================
 * 2. AN EXISTING BRANCH WHOSE END IS DRAGGED ONTO THE INTERIOR
 * ============================================================ */

test("dragging an existing branch endpoint onto the host interior makes the junction", () => {
  const m = modules();
  const host = hostRun(m);
  const hostId = host.id;

  const branch = m.pipe.createPipeDuct({ x: 100, y: 150 }, { x: 100, y: 230 });

  branch.name = "Take-off";
  m.state.objects = [host, branch];

  dragEndTo(m, branch.id, { ...branch.geometry.start }, { x: 130, y: 0.3 });

  const junction = onlyJunction(m);

  assert.equal(pipes(m).length, 3, "the host was split in two beside the branch");

  const joined = connectedIds(junction);

  assert.equal(joined.length, 3, "three branches are recorded");
  assert.ok(joined.includes(hostId), "the retained half keeps the host's identity");
  assert.ok(joined.includes(branch.id), "the dragged branch is joined");

  assert.ok(
    Math.abs(junction.geometry.position.x - 127.5) < 1e-6,
    "the junction is at the projected point on the host"
  );

  /* The branch's connected end is the fitting's own mouth, not the hub. */
  const branchNow = live(m, branch.id);
  const mouth = m.junction.branchPort(
    junction,
    junction.geometry.branches.find((candidate) => candidate.connected === branch.id)
  );

  assert.ok(
    [branchNow.geometry.start, branchNow.geometry.end].some(
      (point) => Math.hypot(point.x - mouth.x, point.y - mouth.y) < 1e-6
    ),
    "the branch ends on its branch mouth"
  );
});

test("the same connection works whichever of the two pipes was drawn first", () => {
  const m = modules();

  reset(m);

  const branch = m.pipe.createPipeDuct({ x: 100, y: 150 }, { x: 100, y: 230 });
  const host = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 200, y: 0 });

  branch.name = "Take-off";
  host.name = "Supply main";

  m.state.objects = [branch, host];

  dragEndTo(m, branch.id, { ...branch.geometry.start }, { x: 60, y: 0 });

  const junction = onlyJunction(m);

  assert.equal(connectedIds(junction).length, 3);
  assert.equal(pipes(m).length, 3, "the host is split whether it was drawn first or second");
});

test("both endpoint orientations of the branch connect", () => {
  /* `end` landing on the host... */
  const m = modules();
  hostRun(m);

  m.tool.commitRouteSegment({ x: 100, y: 150 }, { x: 100, y: 0 }, {});

  assert.equal(junctions(m).length, 1, "a branch ending on the host connects");

  /* ...and `start` landing on it. */
  const m2 = modules();
  hostRun(m2);

  m2.tool.commitRouteSegment({ x: 100, y: 0 }, { x: 100, y: 150 }, {});

  assert.equal(junctions(m2).length, 1, "a branch starting on the host connects");

  onlyJunction(m2);
});

/* ============================================================
 * 3. WHAT MUST NOT BECOME A JUNCTION
 * ============================================================ */

test("two pipes crossing in their interiors stay unconnected", () => {
  const m = modules();
  hostRun(m);

  /* Drawn straight across the host, both ends free. */
  m.tool.commitRouteSegment({ x: 100, y: -80 }, { x: 100, y: 80 }, {});

  assert.equal(junctions(m).length, 0, "an interior crossing is not a connection");
  assert.equal(pipes(m).length, 2, "and nothing was split");
});

test("a near miss outside the connection tolerance stays unconnected", () => {
  const m = modules();
  hostRun(m);

  const tolerance = m.junctionTool.INTERIOR_CONNECTION_TOLERANCE;

  m.tool.commitRouteSegment({ x: 100, y: 150 }, { x: 100, y: tolerance + 3 }, {});

  assert.equal(junctions(m).length, 0, "a point outside the tolerance is not a connection");
  assert.equal(pipes(m).length, 2, "the host was not split");
});

test("two ends meeting make an elbow, not a junction", () => {
  const m = modules();
  hostRun(m);

  /* The branch ends exactly on the host's own end. */
  m.tool.commitRouteSegment({ x: 300, y: 100 }, { x: 200, y: 0 }, {});

  assert.equal(junctions(m).length, 0, "an endpoint-to-endpoint join is not a junction");
  assert.equal(elbows(m).length, 1, "it is the elbow's corner");
  assert.equal(pipes(m).length, 2, "and no host was split");
});

test("moving a pipe near an existing elbow does not make a junction", () => {
  const m = modules();

  reset(m);

  const first = m.tool.commitRouteSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {});
  m.tool.commitRouteSegment({ x: 100, y: 0 }, { x: 100, y: 100 }, {
    previousRun: first.run,
    routeCommittedCount: 1
  });

  assert.equal(elbows(m).length, 1, "the corner has its elbow");

  /* A loose pipe taken past the fitting's corner, satisfying neither rule. */
  const loose = m.pipe.createPipeDuct({ x: 60, y: -80 }, { x: 60, y: -20 });

  m.state.objects.push(loose);

  dragEndTo(m, loose.id, { ...loose.geometry.end }, { x: 90, y: 30 });

  assert.equal(junctions(m).length, 0, "proximity to a fitting connects nothing");
  assert.equal(elbows(m).length, 1, "and does not disturb the elbow");
});

/* ============================================================
 * 4. REPEATING THE EDIT DOES NOT DUPLICATE ANYTHING
 * ============================================================ */

test("moving the connected endpoint again creates no second junction or split", () => {
  const m = modules();
  hostRun(m);

  m.tool.commitRouteSegment({ x: 100, y: 150 }, { x: 100, y: 0 }, {});

  const junction = onlyJunction(m);
  const junctionId = junction.id;
  const idsBefore = pipes(m).map((run) => run.id).sort();

  /*
   * THE BRANCH IS THE PIPE THAT ARRIVES ON `c` - the incoming side of an
   * interior junction (`origin: "interior"` records the main pipe first).
   */
  const branch = live(m, (junction.geometry.branches || []).find((b) => b.id === "c")?.connected);

  assert.ok(branch, "the branch is identifiable");

  /*
   * THE BRANCH END IS SEATED ON ITS PORT - the point the model itself hands
   * back for that branch - so the distance depends on the current spacing.
   */
  const port = m.junction.branchPort(junction, (junction.geometry.branches || []).find((b) => b.id === "c"));
  const end = ["start", "end"].find(
    (candidate) => Math.hypot(branch.geometry[candidate].x - port.x, branch.geometry[candidate].y - port.y) < 10
  );

  assert.ok(end, "the branch still ends on the junction hub");

  dragEndTo(m, branch.id, { ...branch.geometry[end] }, { x: 118, y: 0.2 });

  assert.equal(junctions(m).length, 1, "still exactly one junction");
  assert.ok(live(m, junctionId), "and it is the same fitting");
  assert.equal(pipes(m).length, idsBefore.length, "no further split");
});

/* ============================================================
 * 5. THE CONTRACT A JUNCTION KEEPS
 * ============================================================ */

test("the junction contour follows a branch that changes direction", () => {
  const m = modules();
  hostRun(m);

  const branch = m.tool.commitRouteSegment({ x: 100, y: 150 }, { x: 100, y: 0 }, {}).run;

  const junction = onlyJunction(m);
  const hub = { ...junction.geometry.position };

  const contour = m.junction.junctionOutline(junction);
  const before = JSON.stringify(contour);

  assert.ok(contour, "the junction has a blended contour");
  assert.ok(before.length > 2, "which is real geometry");

  /* Swing the branch's free end. */
  dragEndTo(m, live(m, branch.id).id, { ...live(m, branch.id).geometry.end }, { x: 260, y: 120 });

  const settled = onlyJunction(m);
  const after = m.junction.junctionOutline(settled);

  assert.ok(after, "the contour still exists");
  assert.notEqual(JSON.stringify(after), before, "and follows the new branch direction");
  assert.deepEqual(settled.geometry.position, hub, "without moving the hub");

  /* The branch is still recorded, and still meets the fitting. */
  assert.ok(connectedIds(settled).includes(branch.id), "the branch is still joined");
});

test("a junction still round-trips through the source", () => {
  const m = modules();
  hostRun(m);

  m.tool.commitRouteSegment({ x: 100, y: 150 }, { x: 100, y: 0 }, {});

  const junction = onlyJunction(m);

  const source = m.sync.sourceForObject(junction);

  assert.ok(source, "the junction writes its own block");
  assert.ok(source.includes(junction.id), "with its stable id");
  assert.ok(!/Rotate|rotate/.test(source), "and no Rotate field");
  assert.ok(
    !/branch-?angle|Branch Angle/i.test(source),
    "and no user-facing branch-angle field"
  );

  pipes(m).forEach((run) => {
    assert.ok(m.sync.sourceForObject(live(m, run.id)), `${run.id} is written`);
  });
});
