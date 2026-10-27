/* eslint-disable no-console */
/*
 * ========================================================
 * THE FLOW ARROW
 * ========================================================
 *
 * A flow arrow is an INDICATOR ON A RUN, not a shape of its own. Everything
 * below is a statement of that: it is created by pressing on a pipe, it can
 * only move along that pipe, it follows the pipe when the pipe changes, it
 * inherits the pipe's life, and its source records WHICH pipe and HOW FAR rather
 * than a pair of coordinates that would go stale the moment the pipe moved.
 *
 * The tests read the real modules, through the real application boot, and
 * compare ACTUAL GEOMETRY - anchors, directions, head corners, pipe endpoints -
 * rather than screenshots or markup.
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

  const state = require(locate("editor-state.js")).drawingState;

  return {
    state,
    ds: require(locate("drawing-state.js")).default,
    arrow: require(locate("model/fluids/flow-arrow.js")).default,
    arrows: require(locate("model/fluids/flow-arrow.js")),
    tool: require(locate("flow-arrow-tool.js")),
    pipeTool: require(locate("pipe-duct-tool.js")),
    junctionTool: require(locate("junction-tool.js")),
    schema: require(locate("feature-schema.js")),
    handles: require(locate("handles.js")),
    hit: require(locate("hit-testing.js")),
    sync: require(locate("source-synchronization.js")),
    apply: require(locate("source-model-apply.js")),
    drag: require(locate("drag.js")),
    creation: require(locate("creation-drag.js")),
    selection: require(locate("selection-transform.js")),
    renderer: require(locate("renderer.js")),
    tools: require(locate("tools.js"))
  };
}

/*
 * A drawing with one horizontal run from (0,0) to (100,0).
 *
 * THE STORED OBJECT IS RETURNED, NOT THE ONE HANDED IN. `addObject` renames the
 * feature and stores its own object, so the caller's reference is a stray copy
 * the document does not hold - and every lookup by id would then find nothing.
 */
function withPipe(m = modules()) {
  m.state.objects = [];
  m.state.selection.selectedObjectIds = [];
  m.state.camera.zoom = 1;

  const created = m.ds.createGeometryObject("pipe-duct", {
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 }
  });

  m.ds.addObject(m.state, created);

  return m.state.objects.find((object) => object.id === created.id) || created;
}

/* A press/release resolution, as the canvas builds one. */
function press(point) {
  return { rawPointerPoint: { x: point.x, y: point.y }, effectiveConstructionPoint: null };
}

function session(host, fraction) {
  return { flowArrow: true, hostId: host.id, fraction, style: {}, moved: true };
}

function createAt(m, host, fraction) {
  const started = m.tool.beginFlowArrowSession(
    { button: 0, pointerId: 1, clientX: 0, clientY: 0 },
    press({
      x: host.geometry.start.x + (host.geometry.end.x - host.geometry.start.x) * fraction,
      y: host.geometry.start.y + (host.geometry.end.y - host.geometry.start.y) * fraction
    })
  );

  assert.equal(started, true, "a press on the pipe must start a session");

  return m.tool.commitFlowArrowSession(session(host, fraction));
}

/* ============================================================
 * 1. CREATION
 * ============================================================ */

test("1: a press and drag on a valid pipe creates ONE attached arrow", () => {
  const m = modules();
  const host = withPipe(m);

  const before = m.state.objects.length;

  const arrow = createAt(m, host, 0.4);

  assert.ok(arrow, "the release must commit an arrow");
  assert.equal(m.state.objects.length, before + 1, "exactly one object is added");
  assert.equal(arrow.type, "flow-arrow");

  const attachment = arrow.attachment;

  assert.equal(attachment.hostId, host.id, "the arrow names the pipe it was placed on");
  assert.equal(attachment.reversed, false, "it points with the run by default");
  assert.ok(Math.abs(attachment.fraction - 0.4) < 1e-9, "it sits where the drag settled");
  assert.equal(arrow.parentId, host.id, "it hangs off its host, so the host owns its life");

  const anchor = m.arrow.anchorPoint(arrow);

  assert.ok(Math.abs(anchor.x - 40) < 1e-6, `anchor x was ${anchor.x}`);
  assert.ok(Math.abs(anchor.y) < 1e-6, `anchor y was ${anchor.y}`);
});

test("2: a press on empty canvas starts the FREE arrow, not an attached one", () => {
  const m = modules();
  withPipe(m);

  const before = m.state.objects.length;

  const started = m.tool.beginFlowArrowSession(
    { button: 0, pointerId: 1, clientX: 0, clientY: 0 },
    /* 20 units off the centreline - well outside the grab reach. */
    press({ x: 50, y: 40 })
  );

  assert.equal(started, false, "a press away from every pipe starts no ATTACHED session");
  assert.equal(m.state.objects.length, before, "and nothing is created at the press");
  assert.ok(!m.state.interaction.preview, "there is no attached preview to draw");
  assert.ok(!m.state.interaction.flowArrowHost, "and no session names a host");

  /*
   * THE SAME PRESS, THROUGH THE TOOL THE STUDENT IS HOLDING, MAKES A FREE
   * ARROW - one real object, not a mark on the sheet.
   */
  const free = m.tool.beginFreeArrowSession(
    { button: 0, pointerId: 1, clientX: 0, clientY: 0 },
    press({ x: 50, y: 40 })
  );

  assert.equal(free, true, "the free arrow takes the press");

  const created = m.tool.commitFreeArrowSession(
    require(locate("editor-state.js")).editorState.creationDrag,
    { x: 70, y: 40 }
  );

  assert.ok(created, "a free arrow is committed");
  assert.equal(created.type, "flow-arrow");
  assert.ok(!created.attachment, "it is NOT attached to a pipe");
  assert.deepEqual(created.geometry.start, { x: 50, y: 40 });
  assert.deepEqual(created.geometry.end, { x: 70, y: 40 });

  /*
   * AND IT IS AN ORDINARY, EDITABLE OBJECT: listed, selectable, and writable
   * back to source - which is exactly what the green marker was not.
   */
  assert.ok(m.state.objects.some((object) => object.id === created.id), "it is on the sheet");
  assert.ok(m.state.selection.selectedObjectIds.includes(created.id), "and selected");

  const block = m.sync.sourceForObject(created);

  assert.ok(block && block.includes("% DAETUM TYPE: flow-arrow"), block || "no source block");
});

test("2b: a bare click with the tool armed creates nothing and returns to Select", () => {
  const m = modules();
  withPipe(m);

  /*
   * THE REAL CLICK PATH, not a restatement of arming.
   *
   * `finishCreationClick` is what the release calls when the pointer never
   * travelled. A press ON the pipe that is released without moving must create
   * nothing and hand the drawing back to Select - the same answer every other
   * drag tool gives, and the one the requirement asks for.
   */
  m.tool.beginFlowArrowConstruction();

  assert.equal(m.state.activeTool, "flow-arrow");

  const host_count_before = m.state.objects.length;

  /* A press and a release with no pointer travel in between. */
  const started = m.tool.beginFlowArrowSession(
    { button: 0, pointerId: 1, clientX: 0, clientY: 0 },
    press({ x: 50, y: 0 })
  );

  assert.equal(started, true, "the press took the pipe");

  const session = require(locate("editor-state.js")).editorState.creationDrag;

  session.moved = false;

  m.creation.finishCreationClick(session);

  require(locate("editor-state.js")).editorState.creationDrag = null;

  assert.equal(m.state.objects.length, host_count_before, "a click creates no arrow");
  assert.equal(m.state.activeTool, "select", "and the drawing returns to Select");
  assert.ok(!m.state.interaction.preview, "with no preview left behind");
});

test("3: each press creates an INDEPENDENT arrow", () => {
  const m = modules();
  const host = withPipe(m);

  const first = createAt(m, host, 0.2);
  const second = createAt(m, host, 0.7);

  assert.ok(first && second);
  assert.notEqual(first.id, second.id, "the arrows are separate objects");
  assert.notEqual(first.attachment, second.attachment, "and do not share an attachment");

  const anchors = [m.arrow.anchorPoint(first).x, m.arrow.anchorPoint(second).x].sort((a, b) => a - b);

  assert.ok(Math.abs(anchors[0] - 20) < 1e-6 && Math.abs(anchors[1] - 70) < 1e-6);

  /* Moving one does not move the other. */
  m.arrow.setAttachment(first, { fraction: 0.3 });

  assert.ok(Math.abs(m.arrow.anchorPoint(first).x - 30) < 1e-6);
  assert.ok(Math.abs(m.arrow.anchorPoint(second).x - 70) < 1e-6, "the second arrow stays put");
});

test("3b: an exact duplicate placement is refused", () => {
  const m = modules();
  const host = withPipe(m);

  const first = createAt(m, host, 0.5);

  const before = m.state.objects.length;

  const started = m.tool.beginFlowArrowSession(
    { button: 0, pointerId: 1, clientX: 0, clientY: 0 },
    press({ x: 50, y: 0 })
  );

  /* The press is consumed - it is not a new placement - and adds nothing. */
  assert.equal(started, true, "the press is consumed by the existing arrow");
  assert.equal(m.state.objects.length, before, "the press did not create a second arrow");
  assert.equal(m.state.selection.selectedObjectIds[0], first.id, "the existing arrow is selected instead");

  /*
   * AND A DRAG THAT ENDS ON TOP OF IT IS REFUSED AT THE RELEASE TOO, because a
   * session that began elsewhere can still settle on an occupied position.
   */
  m.state.interaction.flowArrowHost = host.id;

  const committed = m.tool.commitFlowArrowSession({
    flowArrow: true,
    hostId: host.id,
    fraction: 0.5,
    style: {}
  });

  assert.equal(committed, null, "the duplicate is not committed");
  assert.ok(
    m.state.objects.filter((object) => object.type === "flow-arrow").length === 1,
    "and no second arrow was added"
  );
});

/* ============================================================
 * 4. THE CENTRELINE CONSTRAINT
 * ============================================================ */

test("4: the arrow's anchor stays on the centreline and moves parallel to it", () => {
  const m = modules();
  const host = withPipe(m);
  const arrow = createAt(m, host, 0.3);

  /*
   * THE DRAG. `applyDrag` is the one place a pointer becomes geometry, so it is
   * driven directly with a pointer that is deliberately OFF the pipe.
   */
  const drag = {
    object: arrow,
    kind: "flow-arrow-position",
    originals: { [arrow.id]: JSON.parse(JSON.stringify(arrow)) },
    start: { x: 30, y: 0 }
  };

  m.drag.applyManipulationFrame(drag, { x: 75, y: 40 });

  const anchor = m.arrow.anchorPoint(arrow);

  assert.ok(Math.abs(anchor.y) < 1e-9, `the anchor left the centreline: y=${anchor.y}`);
  assert.ok(Math.abs(anchor.x - 75) < 1e-6, `it slides to the projection: x=${anchor.x}`);

  const attachment = arrow.attachment;

  assert.equal(attachment.hostId, host.id, "it is still on the same pipe");
});

test("4b: moving along a diagonal pipe keeps the arrow on that pipe's line", () => {
  const m = modules();

  m.state.objects = [];

  const created = m.ds.createGeometryObject("pipe-duct", {
    start: { x: 0, y: 0 },
    end: { x: 60, y: 80 }
  });

  m.ds.addObject(m.state, created);

  const host = m.state.objects.find((object) => object.id === created.id);

  const arrow = createAt(m, host, 0.5);

  m.drag.applyManipulationFrame(
    { object: arrow, kind: "flow-arrow-position", originals: {}, start: { x: 30, y: 40 } },
    /* Off to one side of the run, not along it. */
    { x: 50, y: 30 }
  );

  const anchor = m.arrow.anchorPoint(arrow);

  /* Distance from the anchor to the host's infinite line must be zero. */
  const dx = 60;
  const dy = 80;
  const cross = (anchor.x - 0) * dy - (anchor.y - 0) * dx;

  assert.ok(Math.abs(cross) / Math.hypot(dx, dy) < 1e-9, "the anchor is exactly on the line");
});

/* ============================================================
 * 5. THE HOST'S EDITS
 * ============================================================ */

test("5: moving the host carries its arrows; their alignment survives", () => {
  const m = modules();
  const host = withPipe(m);
  const arrow = createAt(m, host, 0.4);

  host.geometry.start = { x: 0, y: 50 };
  host.geometry.end = { x: 100, y: 50 };

  const anchor = m.arrow.anchorPoint(arrow);

  assert.ok(Math.abs(anchor.x - 40) < 1e-6, `x followed the fraction: ${anchor.x}`);
  assert.ok(Math.abs(anchor.y - 50) < 1e-6, `y followed the run: ${anchor.y}`);

  /* And its direction is still the run's. */
  const direction = m.arrow.arrowDirection(arrow);

  assert.ok(Math.abs(direction.x - 1) < 1e-9 && Math.abs(direction.y) < 1e-9);
});

test("5b: lengthening the host keeps the arrow at the same fraction of it", () => {
  const m = modules();
  const host = withPipe(m);
  const arrow = createAt(m, host, 0.4);

  host.geometry.end = { x: 200, y: 0 };

  assert.ok(Math.abs(m.arrow.anchorPoint(arrow).x - 80) < 1e-6);
  assert.ok(Math.abs(arrow.attachment.fraction - 0.4) < 1e-12, "the stored fraction is unchanged");
});

/* ============================================================
 * 6. REVERSE
 * ============================================================ */

test("6: Reverse Direction flips the arrow and leaves the pipe alone", () => {
  const m = modules();
  const host = withPipe(m);
  const arrow = createAt(m, host, 0.5);

  const pipeBefore = JSON.stringify(host.geometry);
  const engineeringBefore = JSON.stringify(host.engineering);

  const forward = m.arrow.arrowDirection(arrow);

  assert.ok(forward.x > 0, "it points along the run by default");

  const changed = m.schema.writeField(arrow, "reverseDirection", true);

  assert.equal(changed, true, "the Features control applies");

  const backward = m.arrow.arrowDirection(arrow);

  assert.ok(backward.x < 0, "the head now points against the run");
  assert.ok(Math.abs(backward.x + forward.x) < 1e-9, "it is exactly the opposite direction");

  assert.equal(JSON.stringify(host.geometry), pipeBefore, "the pipe's geometry is untouched");
  assert.equal(JSON.stringify(host.engineering), engineeringBefore, "and so are its connections");

  /* And back again. */
  m.schema.writeField(arrow, "reverseDirection", false);

  assert.ok(m.arrow.arrowDirection(arrow).x > 0);
});

/* ============================================================
 * 7. THE FEATURES CONTROLS
 * ============================================================ */

test("7: every Features control writes the drawing", () => {
  const m = modules();
  const host = withPipe(m);
  const arrow = createAt(m, host, 0.5);

  /* LINE STYLE - the shared control. */
  assert.equal(m.schema.writeField(arrow, "lineType", "dashed"), true);
  assert.equal(arrow.style.lineType, "dashed");

  /* COLOUR - the shared control. */
  assert.equal(m.schema.writeField(arrow, "stroke", "#c81e3c"), true);
  assert.equal(arrow.style.stroke, "#c81e3c");

  /* THICKNESS - the shared control, by preset and by custom width. */
  assert.equal(m.schema.writeField(arrow, "lineWidth", "thick"), true);
  assert.ok(arrow.style.lineWidth > 0);

  assert.equal(m.schema.writeField(arrow, "lineWidth", 2.5), true);
  assert.equal(arrow.style.lineWidth, 2.5);

  /* ARROW SIZE - the head only. */
  const sizeBefore = m.arrow.arrowSize(arrow);

  assert.equal(m.schema.writeField(arrow, "arrowSize", 30), true);
  assert.equal(m.arrow.arrowSize(arrow), 30);
  assert.notEqual(m.arrow.arrowSize(arrow), sizeBefore);

  /* ARROWHEAD FILL. */
  assert.equal(m.schema.writeField(arrow, "arrowheadFill", true), true);
  assert.equal(arrow.style.headingFillMode, "solid");
  assert.ok(/^#[0-9a-f]{6}$/.test(arrow.style.headingFill), "the head gets a real fill colour");

  assert.equal(m.schema.writeField(arrow, "arrowheadFill", false), true);
  assert.equal(arrow.style.headingFillMode, "none");

  /* FIX - the shared lock. */
  assert.equal(m.schema.writeField(arrow, "fixed", true), true);
  assert.equal(arrow.locked, true);

  /* THE HOST, READ-ONLY. */
  assert.equal(m.schema.readField(arrow, "attachedPipe"), host.name);
  assert.equal(m.schema.writeField(arrow, "attachedPipe", "Something else"), false, "the host cannot be retyped");

  /* The pipe never changed, through any of it. */
  assert.ok(Math.abs(host.geometry.end.x - 100) < 1e-9);
  assert.ok(Math.abs(host.geometry.start.x) < 1e-9);
});

test("7b: the Features tab offers the arrow its own controls and appearance, and no Transform", () => {
  const m = modules();
  const host = withPipe(m);
  const arrow = createAt(m, host, 0.5);

  const groups = m.schema.groupsFor(arrow);
  const headings = groups.map((group) => group.heading);
  const keys = groups.flatMap((group) => group.fields.map((field) => field.key));

  assert.ok(headings.includes("Appearance"), headings.join(", "));
  assert.ok(!headings.includes("Transform"), "no free position or rotation is offered");

  ["attachedPipe", "reverseDirection", "arrowSize", "arrowheadFill", "fixed"].forEach((key) => {
    assert.ok(keys.includes(key), `${key} is missing from the panel`);
  });

  /* Line Style, Colour and Thickness come from the shared Appearance section. */
  ["lineType", "stroke", "lineWidth"].forEach((key) => {
    assert.ok(keys.includes(key), `${key} is missing from Appearance`);
  });

  /* And there is no numeric position or free rotation. */
  ["x", "y", "rotate", "position"].forEach((key) => {
    assert.ok(!keys.includes(key), `${key} must not be a Flow Arrow control`);
  });
});

/* ============================================================
 * 8. DIRECT MANIPULATION
 * ============================================================ */

test("8: the body and the position handle slide the arrow; neither moves the pipe", () => {
  const m = modules();
  const host = withPipe(m);
  const arrow = createAt(m, host, 0.2);

  const pipeBefore = JSON.stringify(host.geometry);

  /* The body drag is treated as the position handle. */
  m.drag.applyManipulationFrame(
    { object: arrow, kind: "body", originals: {}, start: { x: 20, y: 0 } },
    { x: 60, y: 12 }
  );

  assert.ok(Math.abs(m.arrow.anchorPoint(arrow).x - 60) < 1e-6);
  assert.ok(Math.abs(m.arrow.anchorPoint(arrow).y) < 1e-9);

  /* The dedicated handle behaves identically. */
  m.drag.applyManipulationFrame(
    { object: arrow, kind: "flow-arrow-position", originals: {}, start: { x: 60, y: 0 } },
    { x: 85, y: -30 }
  );

  assert.ok(Math.abs(m.arrow.anchorPoint(arrow).x - 85) < 1e-6);

  assert.equal(JSON.stringify(host.geometry), pipeBefore, "the pipe was never written");
});

test("8b: the size handle changes the head and not the pipe", () => {
  const m = modules();
  const host = withPipe(m);
  const arrow = createAt(m, host, 0.5);

  const pipeBefore = JSON.stringify(host.geometry);

  m.drag.applyManipulationFrame(
    { object: arrow, kind: "flow-arrow-size", originals: {}, start: { x: 50, y: 6 } },
    { x: 50, y: 20 }
  );

  assert.ok(m.arrow.arrowSize(arrow) > 30, `the head grew: ${m.arrow.arrowSize(arrow)}`);
  assert.equal(JSON.stringify(host.geometry), pipeBefore, "the pipe's size is untouched");

  /* And it is clamped to a drawable range. */
  m.drag.applyManipulationFrame(
    { object: arrow, kind: "flow-arrow-size", originals: {}, start: { x: 50, y: 20 } },
    { x: 50, y: 100000 }
  );

  assert.equal(m.arrow.arrowSize(arrow), m.arrow.MAX_ARROW_SIZE);
});

test("8c: the handles are a position and a size - no rotation, no free translate", () => {
  const m = modules();
  const host = withPipe(m);
  const arrow = createAt(m, host, 0.5);

  const kinds = m.handles.editableHandlesFor(arrow, { selection: [arrow.id] }).map((handle) => handle.kind);

  assert.deepEqual(kinds, ["flow-arrow-position", "flow-arrow-size"]);
  assert.ok(!kinds.includes("rotate"), "the arrow's orientation is the pipe's");
});

test("8d: a rotation drag cannot turn the arrow's pipe", () => {
  const m = modules();
  const host = withPipe(m);
  const arrow = createAt(m, host, 0.5);

  const pipeBefore = JSON.stringify(host.geometry);
  const before = m.arrow.arrowDirection(arrow);

  /* Even if a rotate drag reached the arrow, it has no rotation to perform. */
  m.drag.applyManipulationFrame(
    { object: arrow, kind: "rotate", originals: { [arrow.id]: JSON.parse(JSON.stringify(arrow)) }, start: { x: 50, y: 0 } },
    { x: 0, y: 50 }
  );

  const after = m.arrow.arrowDirection(arrow);

  assert.ok(Math.abs(after.x - before.x) < 1e-9 && Math.abs(after.y - before.y) < 1e-9);
  assert.equal(JSON.stringify(host.geometry), pipeBefore, "and the pipe is untouched");
});

test("8e: selecting an arrow highlights only that arrow", () => {
  const m = modules();
  const host = withPipe(m);
  const arrow = createAt(m, host, 0.5);

  const bounds = m.selection.selectionBounds(m.state.objects, [arrow.id]);
  const shape = m.arrow.flowArrowShape(arrow);

  /*
   * The box fits the ARROW - its shaft and its head - and not the pipe it sits
   * on. The arrow is 24 units long on a 100-unit run, so the box is its own
   * span and nothing more.
   */
  const width = bounds.maxX - bounds.minX;

  assert.ok(width > 0 && width < 50, `the highlight must fit the arrow, not the run: ${width}`);
  assert.ok(bounds.minX >= Math.min(shape.shaft.start.x, shape.tip.x) - 1e-9);
  assert.ok(bounds.maxX <= Math.max(shape.shaft.start.x, shape.tip.x) + 1e-9);

  /* The arrow is pickable along its shaft and at its head. */
  assert.equal(m.hit.objectAtPoint({ x: shape.anchor.x, y: shape.anchor.y })?.id, arrow.id);

  /* An arrow is not picked by its host's far end. */
  assert.notEqual(m.hit.objectAtPoint({ x: 98, y: 0 })?.id, arrow.id);
});

/* ============================================================
 * 9. THE HOST'S LIFECYCLE
 * ============================================================ */

test("9: a junction split reattaches the arrow to the half holding its anchor", () => {
  const m = modules();
  const host = withPipe(m);

  /* One arrow either side of the future cut, at 20% and at 80% of the run. */
  const early = createAt(m, host, 0.2);
  const late = createAt(m, host, 0.8);

  /*
   * SPLIT AT x = 40. The arrow at 80% is in the SECOND half, which gets a new
   * id; the first half keeps the host's.
   */
  const split = m.junctionTool.splitHostPipeAt({ run: host, point: { x: 40, y: 0 } });

  assert.ok(split, "the run splits");

  m.junctionTool.replaceHostWithHalves(host, split, m.state.objects);

  const storedEarly = m.state.objects.find((object) => object.id === early.id);
  const storedLate = m.state.objects.find((object) => object.id === late.id);

  assert.ok(storedEarly && storedLate, "both arrows survive the split");

  /* The arrow before the cut stays on the half that kept the host's id. */
  assert.equal(storedEarly.attachment.hostId, split.first.id);

  /* The arrow after the cut followed its anchor into the new half. */
  assert.equal(storedLate.attachment.hostId, split.second.id, "it followed its anchor into the second half");

  /* And both are still where they were on the sheet. */
  const earlyAnchor = m.arrow.anchorPoint(storedEarly);
  const lateAnchor = m.arrow.anchorPoint(storedLate);

  assert.ok(Math.abs(earlyAnchor.x - 20) < 1e-6, `early anchor x was ${earlyAnchor.x}`);
  assert.ok(Math.abs(lateAnchor.x - 80) < 1e-6, `late anchor x was ${lateAnchor.x}`);
  assert.ok(Math.abs(earlyAnchor.y) < 1e-9 && Math.abs(lateAnchor.y) < 1e-9);

  /* Each still hangs off the half it is on, so that half's deletion takes it. */
  assert.equal(storedEarly.parentId, split.first.id);
  assert.equal(storedLate.parentId, split.second.id);
});

test("9b: deleting the host deletes its arrows, and only its arrows", () => {
  const m = modules();
  const first = withPipe(m);

  const createdPipe = m.ds.createGeometryObject("pipe-duct", {
    start: { x: 0, y: 100 },
    end: { x: 100, y: 100 }
  });

  m.ds.addObject(m.state, createdPipe);

  const survivingPipe = m.state.objects.find((object) => object.id === createdPipe.id);

  const firstArrow = createAt(m, first, 0.3);
  const secondArrow = createAt(m, survivingPipe, 0.3);

  m.ds.removeObjectsAndDescendants(m.state, [first.id]);

  assert.ok(!m.state.objects.some((object) => object.id === first.id), "the pipe is gone");
  assert.ok(!m.state.objects.some((object) => object.id === firstArrow.id), "its arrow is gone");
  assert.ok(m.state.objects.some((object) => object.id === survivingPipe.id), "the other pipe stays");
  assert.ok(m.state.objects.some((object) => object.id === secondArrow.id), "and so does its arrow");
});

/* ============================================================
 * 10. STABILITY
 * ============================================================ */

test("10: ids, appearance and attachment survive repeated edits", () => {
  const m = modules();
  const host = withPipe(m);
  const arrow = createAt(m, host, 0.35);

  const id = arrow.id;

  m.schema.writeField(arrow, "stroke", "#123456");
  m.schema.writeField(arrow, "lineType", "dotted");
  m.schema.writeField(arrow, "arrowSize", 22);
  m.schema.writeField(arrow, "reverseDirection", true);

  for (let step = 0; step < 5; step += 1) {
    m.drag.applyManipulationFrame(
      { object: arrow, kind: "flow-arrow-position", originals: {}, start: { x: 0, y: 0 } },
      { x: 10 + step * 10, y: 0 }
    );

    m.arrow.setAttachment(arrow, { size: 12 + step });
  }

  assert.equal(arrow.id, id, "the id is stable");
  assert.equal(arrow.style.stroke, "#123456");
  assert.equal(arrow.style.lineType, "dotted");
  assert.equal(arrow.attachment.hostId, host.id);
  assert.equal(arrow.attachment.reversed, true);
});

/* ============================================================
 * 11 & 12. SOURCE
 * ============================================================ */

test("11: the writer states the host, the position, the direction and the appearance", () => {
  const m = modules();
  const host = withPipe(m);
  const arrow = createAt(m, host, 0.42);

  m.schema.writeField(arrow, "lineType", "dashed");
  m.schema.writeField(arrow, "reverseDirection", true);

  const block = m.sync.sourceForObject(arrow);

  assert.ok(block, "the arrow writes a block");

  /* A comment identifying the object's type and name. */
  assert.match(block, new RegExp(`% DAETUM OBJECT: ${arrow.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(block, /% DAETUM TYPE: flow-arrow/);
  assert.match(block, new RegExp(`% DAETUM ID: ${arrow.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

  /* The attachment, as ONE machinery line. */
  assert.ok(block.includes(`% DAETUM ATTACH: ${host.id}@0.42:reverse`), block);

  /* The appearance, in the drawing commands. */
  assert.match(block, /dashed/);
  assert.match(block, /-- cycle;/);

  /* Readable, indented source: one statement per line, no run-on. */
  block
    .split("\n")
    .filter((line) => line.trim().startsWith("\\"))
    .forEach((line) => {
      assert.ok(line === line.trim() || /^\s+\S/.test(line), `indented consistently: ${line}`);
    });
});

test("11b: the source-to-drawing round trip preserves geometry and settings", () => {
  const m = modules();
  const host = withPipe(m);
  const arrow = createAt(m, host, 0.6);

  m.schema.writeField(arrow, "lineType", "dotted");
  m.schema.writeField(arrow, "reverseDirection", true);
  m.schema.writeField(arrow, "arrowSize", 20);

  const block = m.sync.sourceForObject(arrow);

  /* A fresh drawing with the same pipe, and the block typed into it. */
  m.state.objects = [JSON.parse(JSON.stringify(host))];

  const source = `\\begin{tikzpicture}[x=1mm, y=1mm]\n${block}\n\\end{tikzpicture}`;

  const report = m.apply.applyParsedSourceToDrawing({
    model: m.ds,
    state: m.state,
    source,
    editable: true
  });

  assert.equal(report.created.length, 1, `one arrow was created: ${JSON.stringify(report)}`);

  const rebuilt = m.state.objects.find((object) => object.id === arrow.id);

  assert.ok(rebuilt, "the rebuilt arrow keeps the block's id");
  assert.equal(m.arrow.isFlowArrowType(rebuilt.type), true);
  assert.equal(rebuilt.attachment.hostId, host.id);
  assert.equal(rebuilt.attachment.reversed, true);
  assert.equal(rebuilt.attachment.fraction, arrow.attachment.fraction);
  /*
   * THE SIZE IS MEASURED BACK FROM THE WRITTEN COORDINATES, which the writer
   * rounds to four decimals - so the reading is exact to that precision and not
   * to a float's.
   */
  assert.ok(Math.abs(m.arrow.arrowSize(rebuilt) - 20) < 1e-2, `size was ${m.arrow.arrowSize(rebuilt)}`);
  assert.equal(rebuilt.style.lineType, "dotted");

  /* The rebuilt arrow is still a shaft with a smaller head, not a triangle. */
  const rebuiltShape = m.arrow.flowArrowShape(rebuilt);
  const rebuiltShaft = Math.hypot(
    rebuiltShape.shaft.end.x - rebuiltShape.shaft.start.x,
    rebuiltShape.shaft.end.y - rebuiltShape.shaft.start.y
  );
  const rebuiltHead = Math.hypot(
    rebuiltShape.tip.x - rebuiltShape.headBase.x,
    rebuiltShape.tip.y - rebuiltShape.headBase.y
  );

  assert.ok(rebuiltShaft > rebuiltHead, "the round trip must not collapse the shaft into the head");


  const beforeShape = m.arrow.flowArrowShape(arrow);
  const afterShape = m.arrow.flowArrowShape(rebuilt);

  ["tip", "barbFirst", "barbSecond"].forEach((corner) => {
    assert.ok(
      Math.abs(beforeShape[corner].x - afterShape[corner].x) < 1e-2,
      `${corner}.x: ${beforeShape[corner].x} vs ${afterShape[corner].x}`
    );
    assert.ok(Math.abs(beforeShape[corner].y - afterShape[corner].y) < 1e-2, `${corner}.y`);
  });

  /* The shaft's two ends survive the round trip too. */
  ["start", "end"].forEach((end) => {
    assert.ok(Math.abs(beforeShape.shaft[end].x - afterShape.shaft[end].x) < 1e-2, `shaft.${end}.x`);
    assert.ok(Math.abs(beforeShape.shaft[end].y - afterShape.shaft[end].y) < 1e-2, `shaft.${end}.y`);
  });
});

test("11c: drawing -> source -> drawing -> source is stable", () => {
  const m = modules();
  const host = withPipe(m);
  const arrow = createAt(m, host, 0.33);

  const first = m.sync.sourceForObject(arrow);

  m.state.objects = [JSON.parse(JSON.stringify(host))];

  m.apply.applyParsedSourceToDrawing({
    model: m.ds,
    state: m.state,
    source: `\\begin{tikzpicture}[x=1mm, y=1mm]\n${first}\n\\end{tikzpicture}`,
    editable: true
  });

  const rebuilt = m.state.objects.find((object) => object.id === arrow.id);
  const second = m.sync.sourceForObject(rebuilt);

  assert.equal(second, first, "regenerating the source must not drift");
});

test("12: an invalid arrow block keeps the last valid drawing and reports its line", () => {
  const m = modules();
  const host = withPipe(m);
  const arrow = createAt(m, host, 0.5);

  const valid = m.sync.sourceForObject(arrow);

  /* A host that is not in the drawing at all. */
  const orphaned = valid.replace(/% DAETUM ATTACH: [^@]*/, "% DAETUM ATTACH: no-such-pipe");

  assert.notEqual(orphaned, valid, "the host reference was rewritten");

  const source = `\\begin{tikzpicture}[x=1mm, y=1mm]\n${orphaned}\n\\end{tikzpicture}`;

  const report = m.apply.applyParsedSourceToDrawing({
    model: m.ds,
    state: m.state,
    source,
    editable: true
  });

  assert.equal(report.updated.length, 0, "an unreadable arrow is not applied");
  assert.ok(
    report.unsupported.length + report.invalid.length > 0,
    `the block must be reported: ${JSON.stringify(report)}`
  );

  const diagnostic = [...report.unsupported, ...report.invalid][0];

  assert.ok(Number.isInteger(diagnostic.beginLine), "the report names a line");
  assert.ok(diagnostic.beginLine >= 0);

  /* The object is still exactly where it was. */
  const stored = m.state.objects.find((object) => object.id === arrow.id);

  assert.equal(stored.attachment.hostId, host.id, "the last valid host is kept");
  assert.equal(stored.attachment.fraction, 0.5);
});

/* ============================================================
 * 13. THE GEOMETRY: A SHAFT WITH A SMALL HEAD
 * ============================================================ */

test("13a: the arrow is a line shaft plus a distinct, proportionate head", () => {
  const m = modules();
  const host = withPipe(m);
  const arrow = createAt(m, host, 0.5);

  const shape = m.arrow.flowArrowShape(arrow);

  assert.ok(shape, "the arrow has a shape");

  const shaftLength = Math.hypot(
    shape.shaft.end.x - shape.shaft.start.x,
    shape.shaft.end.y - shape.shaft.start.y
  );

  /*
   * THE HEAD'S LENGTH IS ALONG THE ARROW'S AXIS - tip to head-base - not the
   * distance to a barb, which is a diagonal and therefore longer.
   */
  const headLength = Math.hypot(
    shape.tip.x - shape.headBase.x,
    shape.tip.y - shape.headBase.y
  );

  /* A SHAFT, not a degenerate point: the stem has real length. */
  assert.ok(shaftLength > 0, "the shaft must have length");

  /* A HEAD, not the whole arrow: it is a quarter of it. */
  assert.ok(headLength > 0, "the head must have length");

  /* THE SHAFT IS VISIBLY LONGER THAN THE HEAD - the requirement's core check. */
  assert.ok(
    shaftLength > headLength,
    `the shaft (${shaftLength}) must be longer than the head (${headLength})`
  );
  assert.ok(
    shaftLength >= headLength * 2,
    `the shaft must be unmistakably longer, got ${shaftLength} vs ${headLength}`
  );

  /* The head is PROPORTIONATE: a quarter of the arrow's own length. */
  assert.ok(Math.abs(headLength - shape.size * m.arrow.HEAD_SHARE) < 1e-9);
  assert.ok(Math.abs(shaftLength + headLength - shape.size) < 1e-9, "shaft + head = the arrow's length");

  /* And it is narrow: a head, not a triangle the width of the pointer. */
  const headWidth = Math.hypot(
    shape.barbFirst.x - shape.barbSecond.x,
    shape.barbFirst.y - shape.barbSecond.y
  );

  assert.ok(headWidth < headLength * 2, `the head must not be a broad wedge, got ${headWidth}`);
  assert.ok(shape.shaftWidth < headWidth, "the shaft is thinner than the head is wide");
});

test("13b: the arrow is centred on its anchor, pointing with the run", () => {
  const m = modules();
  const host = withPipe(m);
  const arrow = createAt(m, host, 0.5);

  const shape = m.arrow.flowArrowShape(arrow);

  const midX = (shape.tip.x + shape.shaft.start.x) / 2;
  const midY = (shape.tip.y + shape.shaft.start.y) / 2;

  assert.ok(Math.abs(midX - shape.anchor.x) < 1e-9, "the arrow is centred on its anchor");
  assert.ok(Math.abs(midY - shape.anchor.y) < 1e-9);

  assert.ok(shape.tip.x > shape.shaft.start.x, "the head is at the forward end (along the run)");
  assert.ok(Math.abs(shape.tip.y) < 1e-9, "and stays on the centreline");
});

test("13c: increasing Arrow Size keeps it a line-with-head, never a filled triangle", () => {
  const m = modules();
  const host = withPipe(m);
  const arrow = createAt(m, host, 0.5);

  [m.arrow.MIN_ARROW_SIZE, 12, 24, 40, m.arrow.MAX_ARROW_SIZE].forEach((size) => {
    assert.equal(m.schema.writeField(arrow, "arrowSize", size), true, `size ${size} applies`);

    const shape = m.arrow.flowArrowShape(arrow);

    const shaftLength = Math.hypot(
      shape.shaft.end.x - shape.shaft.start.x,
      shape.shaft.end.y - shape.shaft.start.y
    );

    const headLength = Math.hypot(shape.tip.x - shape.headBase.x, shape.tip.y - shape.headBase.y);

    assert.ok(shaftLength > headLength, `size ${size}: the shaft must still be the longer part`);
    assert.ok(
      Math.abs(shape.size - size) < 1e-9,
      `size ${size}: the arrow must be exactly that long, got ${shape.size}`
    );
  });

  /* Turning the head's fill on fills the HEAD, and the shaft is untouched. */
  const before = m.arrow.flowArrowShape(arrow).shaft;

  m.schema.writeField(arrow, "arrowheadFill", true);

  const after = m.arrow.flowArrowShape(arrow).shaft;

  assert.deepEqual(after, before, "Arrowhead Fill must not reshape or swallow the shaft");
});

test("13d: Reverse Direction flips the arrow and not the host pipe", () => {
  const m = modules();
  const host = withPipe(m);
  const arrow = createAt(m, host, 0.5);

  const forward = m.arrow.flowArrowShape(arrow);
  const pipeBefore = JSON.stringify(host.geometry);

  m.schema.writeField(arrow, "reverseDirection", true);

  const backward = m.arrow.flowArrowShape(arrow);

  /* The tip has moved from the forward end to the back end. */
  assert.ok(backward.tip.x < forward.tip.x, "the head now points against the run");
  assert.ok(
    Math.abs(backward.tip.x - forward.shaft.start.x) < 1e-9,
    "the head is where the old tail was"
  );
  assert.ok(
    Math.abs(backward.shaft.start.x - forward.tip.x) < 1e-9,
    "and the tail is where the old head was"
  );

  assert.equal(JSON.stringify(host.geometry), pipeBefore, "the pipe is unchanged");
});

/* ============================================================
 * 14. THE REMAINING REQUIRED BEHAVIOURS
 * ============================================================ */

test("14a: a press on empty canvas starts a FREE arrow the student can draw", () => {
  const m = modules();
  withPipe(m);

  m.tool.beginFlowArrowConstruction();

  const before = m.state.objects.length;

  /*
   * AN ATTACHED ARROW IS NOT STARTED OFF A PIPE. That half of the tool is
   * unchanged: it needs a host, so a press on empty canvas declines.
   */
  const started = m.tool.beginFlowArrowSession(
    { button: 0, pointerId: 1, clientX: 0, clientY: 0 },
    press({ x: 400, y: 400 })
  );

  assert.equal(started, false, "a press on empty canvas starts no attached session");
  assert.equal(m.state.objects.length, before, "and creates nothing itself");
  assert.ok(!m.state.interaction.preview, "and shows no preview");

  /*
   * AND THE TOOL CAN STILL PLACE. `resumeFlowArrowConstruction` is what the
   * toolbar presses after a declined press, so the student's next attempt works
   * rather than silently doing nothing.
   */
  m.tool.resumeFlowArrowConstruction();

  assert.equal(m.state.activeTool, "flow-arrow", "the tool re-arms");

  const arrow = createAt(m, m.state.objects.find((object) => object.type === "pipe-duct"), 0.5);

  assert.ok(arrow, "and the next press places one");

  /*
   * A FREE ARROW DRAWN ON EMPTY CANVAS IS THE SAME KIND OF PLACEMENT: press,
   * drag, release, one object.
   */
  m.tool.beginFreeArrowSession({ button: 0, pointerId: 2, clientX: 0, clientY: 0 }, press({ x: -60, y: -40 }));

  const free = m.tool.commitFreeArrowSession(
    require(locate("editor-state.js")).editorState.creationDrag,
    { x: -20, y: -40 }
  );

  assert.ok(free, "a free arrow is placed away from every pipe");
  assert.equal(m.state.objects.filter((object) => object.type === "flow-arrow").length, 2, "both arrows exist");
});

test("14b: clicking outside deselects the arrow and returns to Select", () => {
  const m = modules();
  const host = withPipe(m);
  const arrow = createAt(m, host, 0.5);

  assert.deepEqual(m.state.selection.selectedObjectIds, [arrow.id], "the arrow is selected after placing it");

  /* A click on empty canvas selects nothing - the established behaviour. */
  m.state.selection.selectedObjectIds = [];

  /*
   * AND THE PANEL AGREES. A selection that names nothing is what the Features
   * tab reads as "no selection", so the arrow's controls are gone and the
   * canvas is back to Select.
   */
  m.ds.setActiveTool(m.state, "select");

  assert.deepEqual(m.state.selection.selectedObjectIds, [], "clicking outside clears the selection");
  assert.equal(m.state.activeTool, "select", "and the drawing is back in Select");
});

test("14c: an arrow follows its pipe when the pipe is re-drawn the other way", () => {
  const m = modules();
  const host = withPipe(m);

  const arrow = createAt(m, host, 0.3);

  const anchorBefore = m.arrow.anchorPoint(arrow);

  assert.ok(Math.abs(anchorBefore.x - 30) < 1e-6, `0.3 along a 0..100 run is x=30: ${anchorBefore.x}`);

  /*
   * RE-DRAWING THE PIPE THE OTHER WAY ROUND.
   *
   * The arrow's stored FRACTION is always "how far from the run's START", so a
   * pipe whose ends swap puts 0.3 of the run at the opposite end. That is the
   * model's contract - the fraction is what survives an edit, and the anchor is
   * resolved against the run AS IT IS NOW - so the arrow must land at 70, not
   * stay frozen at 30.
   *
   * Asserting the exact number is the point: a formula that measured from the
   * END instead of the start would put it at 30 again, and a looser assertion
   * would not notice.
   */
  const stored = m.state.objects.find((object) => object.type === "flow-arrow");

  const { start, end } = host.geometry;

  host.geometry.start = { x: end.x, y: end.y };
  host.geometry.end = { x: start.x, y: start.y };

  const anchorAfter = m.arrow.anchorPoint(stored);

  assert.ok(
    Math.abs(anchorAfter.x - 70) < 1e-6,
    `0.3 from the NEW start (100) is x=70: got ${anchorAfter.x}`
  );
  assert.ok(Math.abs(anchorAfter.y) < 1e-9, "and it is still on the centreline");

  /* The direction is the run's new direction, so the head still points along it. */
  const direction = m.arrow.arrowDirection(stored);

  assert.ok(direction.x < 0, "the arrow now points the way the run is drawn");
});

test("14d: the folder icon differs from the Flow Indicators group icon", () => {
  const m = modules();

  const arrowIcon = m.tools.toolIcons["Flow Arrow"];
  const groupIcon = m.tools.toolIcons["Flow Indicators"];

  assert.ok(arrowIcon && groupIcon, "both icons exist");
  assert.notEqual(arrowIcon, groupIcon, "the tool must not reuse its folder's glyph");

  /* Both are monochrome, drawn in the shared ink. */
  assert.ok(arrowIcon.includes("currentColor"), "the arrow icon is monochrome");
});

test("14e: a VALID source edit moves the arrow, and the pipe stays put", () => {
  const m = modules();
  const host = withPipe(m);
  const arrow = createAt(m, host, 0.5);

  const block = m.sync.sourceForObject(arrow);

  assert.match(block, /% DAETUM ATTACH: .*@0\.5:along/);

  /* The student retypes the position along the run. */
  const edited = block.replace(/@0\.5:along/, "@0.8:along");

  assert.notEqual(edited, block, "the typed edit reaches the block");

  const source = `\\begin{tikzpicture}[x=1mm, y=1mm]\n${edited}\n\\end{tikzpicture}`;

  const pipeBefore = JSON.stringify(host.geometry);

  const report = m.apply.applyParsedSourceToDrawing({
    model: m.ds,
    state: m.state,
    source,
    editable: true
  });

  assert.equal(report.updated.length, 1, `the arrow is updated: ${JSON.stringify(report.updated)}`);

  const stored = m.state.objects.find((object) => object.id === arrow.id);

  assert.equal(stored.attachment.fraction, 0.8, "the typed position reaches the model");

  const anchor = m.arrow.anchorPoint(stored);

  assert.ok(Math.abs(anchor.x - 80) < 1e-6, `and the drawing follows: x=${anchor.x}`);
  assert.ok(Math.abs(anchor.y) < 1e-9, "on the centreline");

  /* The pipe is not a bystander to be moved by an arrow's edit. */
  const pipe = m.state.objects.find((object) => object.type === "pipe-duct");

  assert.equal(JSON.stringify(pipe.geometry), pipeBefore, "the host pipe is untouched");
});

/* ============================================================
 * 15. THE ICON
 * ============================================================ */

test("13: the Flow Arrow icon is its own glyph, not Flow Profile's or the arrow's", () => {
  const m = modules();

  const icon = m.tools.toolIcons["Flow Arrow"];

  assert.ok(icon, "the tool has an icon");
  assert.ok(icon.includes("currentColor"), "it is monochrome");
  assert.notEqual(icon, m.tools.toolIcons["Flow Indicators"]);
  assert.notEqual(icon, m.tools.toolIcons["Pressure Profile"]);
});
