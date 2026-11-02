/*
 * ========================================================
 * FLUIDS - NO ANGLE PROPERTIES, AND A CONNECTED ELBOW MOVES AS A JOINT
 * ========================================================
 *
 * Two changes, both asserted on the real model and the real panel schema:
 *
 *   1. Neither an Elbow nor a Junction offers a user-facing ANGLE control. The
 *      internal angle arithmetic is untouched - the checks below confirm the
 *      geometry still derives its bend correctly.
 *
 *   2. Dragging a connected Elbow body moves the JOINT: both connected pipe
 *      ends follow it, both outer ends stay where they were, and the bend angle
 *      is re-derived from the pipes' new directions rather than kept.
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

const PIXELS_PER_UNIT = 2;
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

  const editor = require(locate("editor-state.js"));

  return {
    pipe: require(locate("model/fluids/pipe-duct.js")).default,
    junction: require(locate("model/fluids/junction.js")).default,
    tool: require(locate("pipe-duct-tool.js")),
    junctionTool: require(locate("junction-tool.js")),
    schema: require(locate("feature-schema.js")),
    drag: require(locate("drag.js")),
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
}

/* A two-pipe route: A runs east from the origin, B runs from `bOuter` to A's end. */
function route(m, bOuter = { x: 250, y: 150 }) {
  reset(m);

  const a = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
  const b = m.pipe.createPipeDuct(bOuter, { x: 100, y: 0 });

  a.name = "A";
  b.name = "B";

  m.state.objects = [a, b];
  m.tool.connectPipeEndpoints(b);

  const elbow = m.state.objects.find((object) => object.type === "elbow");

  m.state.selection.selectedObjectIds = [elbow.id];

  return { a, b, elbow };
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

function dragBodyTo(m, elbow, target) {
  m.state.selection.selectedObjectIds = [elbow.id];

  const grab = { ...live(m, elbow.id).geometry.position };

  assert.ok(
    m.drag.beginManipulationDrag(pointer("pointerdown", grab)),
    "a press on the fitting starts a drag"
  );

  m.drag.updateManipulationDrag(pointer("pointermove", target));
  m.drag.finishManipulationDrag(pointer("pointerup", target));

  return { grab, target };
}

/* ============================================================
 * PART 1 - THE ANGLE PROPERTIES ARE GONE
 * ============================================================ */

test("the Elbow Features panel has no Bend Angle control", () => {
  const m = modules();
  const { elbow } = route(m);

  const groups = m.schema.groupsFor(elbow);

  const keys = groups.flatMap((group) => group.fields.map((field) => field.key));

  assert.ok(!keys.includes("bendAngle"), "no bendAngle row is listed");
  assert.ok(!keys.includes("angle"), "no angle row is listed");

  /* Nor may the field resolve by name - a stale row would still render. */
  assert.equal(m.schema.readField(elbow, "bendAngle"), undefined, "bendAngle is not a readable field");

  /* And the group that carries geometry still offers the radius. */
  const transform = groups.find((group) => group.id === "transform");

  assert.ok(transform, "the Transform group is present");
  assert.ok(
    transform.fields.some((field) => field.key === "bendRadius"),
    "Bend Radius is still offered"
  );
});

test("the Elbow panel still has Object and Appearance, and geometry still derives its angle", () => {
  const m = modules();
  const { elbow } = route(m);

  const ids = m.schema.groupsFor(elbow).map((group) => group.id);

  assert.deepEqual(ids, ["object", "appearance", "transform"], "the three sections, in order");

  /*
   * THE INTERNAL ANGLE IS UNTOUCHED. Removing the FIELD must not remove the
   * calculation: the bend is still whatever the pipes make.
   */
  const angle = m.pipe.elbowAngleDegrees(elbow);

  assert.ok(Number.isFinite(angle), "the bend still has an angle");
  assert.ok(m.pipe.elbowCurvesFor(elbow), "and the bend still builds");
});

test("the Junction Features panel has no branch-angle controls", () => {
  const m = modules();
  reset(m);

  const made = m.junctionTool.commitJunctionGesture({ x: 300, y: 300 }, { x: 400, y: 300 });

  assert.ok(made?.junction, "a junction was placed");

  const groups = m.schema.groupsFor(live(m, made.junction.id));
  const keys = groups.flatMap((group) => group.fields.map((field) => field.key));

  assert.deepEqual(
    groups.map((group) => group.id),
    ["object", "appearance", "transform"],
    "three sections, as every fitting has"
  );

  assert.ok(
    !keys.some((key) => /angle/i.test(key)),
    "no angle field of any kind is offered"
  );

  /* Nothing that reads as a length either, and no Rotate. */
  assert.ok(!keys.some((key) => /length|rotate/i.test(key)), "no branch length or rotate row");
});

/* ============================================================
 * PART 2 - A CONNECTED ELBOW MOVES AS A JOINT
 * ============================================================ */

test("moving a connected elbow moves the joint and both connected pipe ends", () => {
  const m = modules();
  const { a, b, elbow } = route(m);

  const heldA = elbow.engineering.ports[a.id];
  const heldB = elbow.engineering.ports[b.id];

  const outerA = { ...m.state.objects.find((o) => o.id === a.id).geometry[heldA === "end" ? "start" : "end"] };
  const outerB = { ...m.state.objects.find((o) => o.id === b.id).geometry[heldB === "end" ? "start" : "end"] };

  const before = { ...m.state.objects.find((o) => o.id === elbow.id).geometry.position };

  dragBodyTo(m, elbow, { x: before.x + 20, y: before.y + 30 });

  const elbowNow = live(m, elbow.id);
  const aNow = live(m, a.id);
  const bNow = live(m, b.id);

  assert.ok(
    Math.hypot(elbowNow.geometry.position.x - (before.x + 20), elbowNow.geometry.position.y - (before.y + 30)) < 1e-6,
    "the joint followed the drag exactly"
  );

  /*
   * BOTH PIPES NOW RUN TO THE JOINT.
   *
   * A pipe joined to a fitting is SEATED on the bend tangent point, so its
   * stored end is a trim short of the corner - the SPAN is the line that
   * reaches the joint. Checking the span (and the bend, below) is checking the
   * actual connection; checking the stored end alone would fail on a joint
   * that is perfectly correct.
   */
  const portsNow = elbowNow.engineering.ports;
  const aHeld = portsNow[a.id];
  const bHeld = portsNow[b.id];

  /* The nearest end of the run's DRAWN line is the one that reaches the joint. */
  const spanEndAt = (run) => {
    const span = run.geometry.span;

    if (!span) {
      return Infinity;
    }

    const joint = elbowNow.geometry.position;

    return Math.min(
      Math.hypot(span.start.x - joint.x, span.start.y - joint.y),
      Math.hypot(span.end.x - joint.x, span.end.y - joint.y)
    );
  };

  assert.ok(spanEndAt(aNow) < 1e-6, "pipe A's line now runs to the moved joint");
  assert.ok(spanEndAt(bNow) < 1e-6, "pipe B's line now runs to the moved joint");

  /* And each STORED end sits on its bend's tangent point - a closed seam. */
  const curvesNow = m.pipe.elbowCurvesFor(elbowNow);

  assert.ok(curvesNow, "the bend builds at the moved joint");

  assert.ok(
    Math.hypot(curvesNow.start.x - aNow.geometry[aHeld].x, curvesNow.start.y - aNow.geometry[aHeld].y) < 1e-6,
    "pipe A's connected end meets the arc"
  );

  assert.ok(
    Math.hypot(curvesNow.end.x - bNow.geometry[bHeld].x, curvesNow.end.y - bNow.geometry[bHeld].y) < 1e-6,
    "pipe B's connected end meets the arc"
  );

  const aFree = aHeld === "end" ? "start" : "end";
  const bFree = bHeld === "end" ? "start" : "end";

  /* ... and BOTH outer ends did NOT. */
  assert.ok(
    Math.hypot(aNow.geometry[aFree].x - outerA.x, aNow.geometry[aFree].y - outerA.y) < 1e-6,
    "pipe A's outer end is fixed"
  );

  assert.ok(
    Math.hypot(bNow.geometry[bFree].x - outerB.x, bNow.geometry[bFree].y - outerB.y) < 1e-6,
    "pipe B's outer end is fixed"
  );
});

test("moving the elbow re-derives the bend angle from the new pipe directions", () => {
  const m = modules();
  const { a, b, elbow } = route(m, { x: 250, y: 150 });

  const angleBefore = m.pipe.elbowAngleDegrees(live(m, elbow.id));
  const corner = { ...live(m, elbow.id).geometry.position };

  dragBodyTo(m, elbow, { x: corner.x - 40, y: corner.y + 10 });

  const angleAfter = m.pipe.elbowAngleDegrees(live(m, elbow.id));

  assert.ok(Number.isFinite(angleAfter), "the bend still has an angle");

  /*
   * THE ANGLE IS THE GEOMETRY'S, not the value it had. It is checked against
   * the corner the pipes now make rather than against a number written here.
   */
  const aNow = live(m, a.id);
  const bNow = live(m, b.id);
  const elbowNow = live(m, elbow.id);

  const farA = elbowNow.engineering.ports[a.id] === "end" ? aNow.geometry.start : aNow.geometry.end;
  const farB = elbowNow.engineering.ports[b.id] === "end" ? bNow.geometry.start : bNow.geometry.end;

  const expected = m.pipe.cornerAngleDegrees(farA, elbowNow.geometry.position, farB);

  assert.ok(
    Math.abs(angleAfter - expected) < 1e-6,
    "the bend angle is what the two pipes now make"
  );

  assert.notEqual(
    Number(angleBefore.toFixed(6)),
    Number(angleAfter.toFixed(6)),
    "and a move that swings a pipe really does change it"
  );
});

test("a non-90-degree elbow still works after the joint moves", () => {
  const m = modules();
  const { elbow } = route(m, { x: 250, y: 150 });

  const corner = { ...live(m, elbow.id).geometry.position };

  dragBodyTo(m, elbow, { x: corner.x + 25, y: corner.y - 20 });

  const curves = m.pipe.elbowCurvesFor(live(m, elbow.id));

  assert.ok(curves, "the bend still builds at the new angle");
  assert.ok(
    Math.abs(m.pipe.elbowAngleDegrees(live(m, elbow.id)) - 90) > 1,
    "the result is genuinely not a right angle"
  );
});

test("both connections stay valid, and both pipes meet the bend with no gap", () => {
  const m = modules();
  const { a, b, elbow } = route(m);

  const original = JSON.parse(JSON.stringify(live(m, elbow.id)));
  const corner = { ...original.geometry.position };

  for (const step of [10, 18, 12, -6]) {
    m.state.selection.selectedObjectIds = [elbow.id];

    const now = live(m, elbow.id);
    const from = { ...now.geometry.position };
    const target = { x: from.x + step, y: from.y - step / 2 };

    m.drag.beginManipulationDrag(pointer("pointerdown", from));
    m.drag.updateManipulationDrag(pointer("pointermove", target));
    m.drag.finishManipulationDrag(pointer("pointerup", target));

    const fitting = live(m, elbow.id);
    const curves = m.pipe.elbowCurvesFor(fitting);

    assert.ok(curves, `the bend builds after step ${step}`);

    const aNow = live(m, a.id);
    const bNow = live(m, b.id);

    const gapA = Math.hypot(
      curves.start.x - aNow.geometry[fitting.engineering.ports[a.id]].x,
      curves.start.y - aNow.geometry[fitting.engineering.ports[a.id]].y
    );
    const gapB = Math.hypot(
      curves.end.x - bNow.geometry[fitting.engineering.ports[b.id]].x,
      curves.end.y - bNow.geometry[fitting.engineering.ports[b.id]].y
    );

    assert.ok(gapA < 1e-6 && gapB < 1e-6, `no gap at either end after step ${step}`);
  }

  /* ONE elbow, still, after four moves. */
  assert.equal(
    m.state.objects.filter((object) => object.type === "elbow").length,
    1,
    "no duplicate fittings appeared"
  );

  assert.equal(live(m, elbow.id).id, original.id, "the elbow keeps its stable id");
  assert.deepEqual(live(m, elbow.id).engineering.connections, original.engineering.connections, "connections unchanged");
});

test("moving the elbow preserves both pipes' appearance and ids", () => {
  const m = modules();
  const { a, b, elbow } = route(m);

  const aNow = live(m, a.id);
  const bNow = live(m, b.id);

  aNow.style = { ...aNow.style, stroke: "#123456", lineWidth: 2 };
  bNow.style = { ...bNow.style, stroke: "#abcdef" };

  const aStyle = JSON.stringify(live(m, a.id).style);
  const bStyle = JSON.stringify(live(m, b.id).style);

  const corner = { ...live(m, elbow.id).geometry.position };

  dragBodyTo(m, elbow, { x: corner.x + 15, y: corner.y + 15 });

  assert.equal(JSON.stringify(live(m, a.id).style), aStyle, "pipe A keeps its appearance");
  assert.equal(JSON.stringify(live(m, b.id).style), bStyle, "pipe B keeps its appearance");
  assert.equal(live(m, a.id).name, "A", "pipe A keeps its name");
  assert.equal(live(m, b.id).name, "B", "pipe B keeps its name");
});

test("the moved elbow keeps a valid radius and stays tangent to both pipes", () => {
  const m = modules();
  const { a, b, elbow } = route(m);

  const corner = { ...live(m, elbow.id).geometry.position };

  dragBodyTo(m, elbow, { x: corner.x - 30, y: corner.y + 40 });

  const fitting = live(m, elbow.id);
  const curves = m.pipe.elbowCurvesFor(fitting);

  assert.ok(curves, "the bend builds");

  const limit = m.tool.elbowMaxBendRadius(fitting);

  if (limit !== null) {
    assert.ok(curves.radius <= limit + 1e-6, "the radius is within what the arms can hold");
  }

  /* Tangency: each radius is perpendicular to the pipe it meets. */
  const lineOf = (run) => {
    const span = run.geometry?.span;

    return m.pipe.directionOf(span?.start || run.geometry.start, span?.end || run.geometry.end);
  };

  const radialStart = m.pipe.directionOf(curves.centre, curves.start);
  const radialEnd = m.pipe.directionOf(curves.centre, curves.end);

  const dot = (u, v) => Math.abs(u.x * v.x + u.y * v.y);

  assert.ok(dot(radialStart, lineOf(live(m, a.id))) < 1e-6, "tangent to pipe A");
  assert.ok(dot(radialEnd, lineOf(live(m, b.id))) < 1e-6, "tangent to pipe B");
});

test("the source reflects the moved geometry and does not restore the old bend", () => {
  const m = modules();
  const { elbow } = route(m);

  const writer = require(locate("source-writers/fluids.js"));

  const corner = { ...live(m, elbow.id).geometry.position };

  dragBodyTo(m, elbow, { x: corner.x + 22, y: corner.y + 12 });

  const fitting = live(m, elbow.id);
  const source = writer.fluidsSourceWriter(fitting);

  assert.ok(typeof source === "string" && source.length > 0, "the elbow writes source");

  const curves = m.pipe.elbowCurvesFor(fitting);

  assert.ok(curves, "the live bend builds");

  /*
   * The compiled arc is stated from the bend's own centre, so the centre's
   * coordinates must appear in the source - proof that it describes the
   * moved fitting rather than the one the drag began on.
   */
  const centre = `${Number(curves.centre.x.toFixed(4))}`;

  assert.ok(source.includes(centre), "the source names the bend's current centre");
});

test("moving a standalone elbow is unchanged", () => {
  const m = modules();
  reset(m);

  const standalone = m.pipe.createElbow({
    geometry: {
      position: { x: 100, y: 100 },
      ends: { a: { x: 40, y: 100 }, b: { x: 100, y: 160 } },
      angleDegrees: 90
    }
  });

  standalone.name = "Manual";
  standalone.engineering = { ...(standalone.engineering || {}), generated: false };
  m.state.objects = [standalone];
  m.state.selection.selectedObjectIds = [standalone.id];

  const before = JSON.parse(JSON.stringify(standalone.geometry.ends));
  const angleBefore = m.pipe.elbowAngleDegrees(standalone);

  dragBodyTo(m, standalone, { x: 120, y: 120 });

  const now = live(m, standalone.id);

  /*
   * A standalone elbow has no pipes to hold it, so its whole shape travels: both
   * ends shift by the same delta as the corner. That is its established body
   * move, and it is deliberately NOT the connected case.
   */
  const dx = now.geometry.position.x - 100;
  const dy = now.geometry.position.y - 100;

  assert.deepEqual(
    { a: now.geometry.ends.a, b: now.geometry.ends.b },
    {
      a: { x: before.a.x + dx, y: before.a.y + dy },
      b: { x: before.b.x + dx, y: before.b.y + dy }
    },
    "a standalone elbow moves whole, ends included"
  );

  assert.ok(
    Math.abs(m.pipe.elbowAngleDegrees(now) - angleBefore) < 1e-9,
    "and its angle is still untouched"
  );
});
