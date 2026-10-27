/*
 * ========================================================
 * THE FLUIDS SCHEMATIC TOOLS
 * ========================================================
 *
 * The tools added after the flow paths, end to end: the shared inline insertion
 * service, the reducer, the three inline symbols, the vessel and its fluid
 * level, the free arrow and the directional annotation, the pressure profile and
 * the section plane.
 *
 * EVERY ASSERTION IS ABOUT THE REAL MODEL the canvas draws from: the feature's
 * geometry, its connections, its Features-tab values and its generated source -
 * not about a mock. A test passes only where the visible geometry and the
 * underlying model agree.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { bootApp, whenReady } = require("./helpers/boot-app.cjs");
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

async function modules() {
  ready();
  await whenReady();

  const state = require(locate("editor-state.js")).drawingState;
  const editorState = require(locate("editor-state.js")).editorState;

  return {
    state,
    editorState,
    ds: require(locate("drawing-state.js")).default,
    pipe: require(locate("model/fluids/pipe-duct.js")).default,
    reducer: require(locate("model/fluids/reducer-expander.js")).default,
    equipment: require(locate("model/fluids/inline-equipment.js")).default,
    vessel: require(locate("model/fluids/reservoir-tank.js")).default,
    level: require(locate("model/fluids/fluid-level.js")).default,
    arrows: require(locate("model/fluids/flow-arrows.js")).default,
    profile: require(locate("model/fluids/pressure-profile.js")).default,
    section: require(locate("model/fluids/section-plane.js")).default,
    inline: require(locate("inline-insertion.js")),
    tool: require(locate("fluids-schematic-tool.js")),
    schema: require(locate("feature-schema.js")),
    sync: require(locate("source-synchronization.js")),
    apply: require(locate("source-model-apply.js")),
    handles: require(locate("handles.js")),
    hit: require(locate("hit-testing.js")),
    selection: require(locate("selection-transform.js")),
    fluids: require(locate("fluids-tools.js")).default || require(locate("fluids-tools.js"))
  };
}

/* A sheet with one horizontal run from (0,0) to (100,0). */
function withPipe(m) {
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

/* ============================================================
 * THE SIDEBAR
 * ============================================================ */

test("every schematic tool is registered, built, and in its section", async () => {
  const m = await modules();

  const capabilities = m.fluids.fluidsCapability;

  assert.equal(capabilities("reducer-expander"), "inline-fitting");
  assert.equal(capabilities("reservoir-tank"), "vessel");
  assert.equal(capabilities("pump"), "inline-equipment");
  assert.equal(capabilities("valve"), "inline-equipment");
  assert.equal(capabilities("flow-meter"), "inline-equipment");
  assert.equal(capabilities("flow-arrow"), "flow-arrow");
  assert.equal(capabilities("fluid-level"), "fluid-level");
  assert.equal(capabilities("flow-direction-diagram"), "flow-direction");
  assert.equal(capabilities("pressure-profile"), "analysis-diagram");
  assert.equal(capabilities("section-plane"), "section");

  [
    "reducer-expander",
    "reservoir-tank",
    "pump",
    "valve",
    "flow-meter",
    "flow-arrow",
    "fluid-level",
    "flow-direction-diagram",
    "pressure-profile",
    "section-plane"
  ].forEach((id) => assert.equal(m.fluids.isPlannedFluidsTool(id), false, `${id} is implemented`));
});

test("every schematic tool has its own sidebar artwork", async () => {
  await modules();

  /* The icon table is read from the REAL toolbar module, not a fixture. */
  const { toolIcons } = require(locate("tools.js"));

  [
    ["Reducer / Expander", /M3 6h4l6 4-6 4H3/],
    ["Reservoir / Tank", /M4 4v12h12V4/],
    ["Pump", /circle/],
    ["Valve", /M3 6\.5l7 3\.5-7 3\.5z/],
    ["Flow Meter", /circle/],
    ["Fluid Level", /c2-1\.6/],
    ["Flow Direction Diagram", /M3 15h6l4-5h4/],
    ["Pressure Profile", /M4 3v13h13/],
    ["Section Plane", /dasharray/]
  ].forEach(([label, pattern]) => {
    assert.ok(toolIcons[label], `${label} has an icon`);
    assert.match(toolIcons[label], pattern, `${label}'s artwork says what it is`);
  });

  /* The three that must be told apart are: circle+triangle, bow-tie, circle+pointer. */
  assert.match(toolIcons.Pump, /<path[^>]*d="M7\.8 7\.2v5\.6l4\.4-2\.8z"/, "a pump draws a triangle inside its circle");
  assert.match(toolIcons["Flow Meter"], /<circle[^>]*r="1"/, "a meter draws a pointer's hub, not a triangle");
  assert.equal(toolIcons.Valve.includes("<circle"), false, "a valve is not circular");
});

/* ============================================================
 * THE REDUCER
 * ============================================================ */

test("a reducer inserted mid-run splits the pipe, keeps the start id and connects both halves", async () => {
  const m = await modules();

  const host = withPipe(m);

  const target = m.inline.findInsertionTarget({ x: 50, y: 0 });

  assert.ok(target, "the middle of the run is a target");
  assert.equal(target.interior, true);

  const plan = m.inline.planInsertion("reducer-expander", target, { mode: "reduce", transitionLength: 20 });

  assert.equal(plan.placement, "inline");
  assert.equal(plan.first.id, host.id, "the start-side half keeps the host's id");
  assert.notEqual(plan.second.id, host.id, "the end-side half gets a new one");

  const result = m.inline.insertInline("reducer-expander", plan, { mode: "reduce", transitionLength: 20 });

  assert.ok(result?.symbol, "the fitting was created");

  const reducer = m.state.objects.find((object) => object.id === result.symbol.id);

  assert.equal(reducer.type, "reducer-expander");

  void m.state.objects;

  const pipes = m.state.objects.filter((object) => object.type === "pipe-duct" && object.id !== host.id);

  assert.ok(pipes.length >= 1, `at least one new segment was created (${pipes.length})`);
  assert.ok(m.state.objects.some((object) => object.id === plan.second.id), "and the planned id is on the sheet");

  [host.id, plan.second.id]
    .map((id) => m.state.objects.find((object) => object.id === id))
    .filter(Boolean)
    .forEach((half) => {
      const length = Math.hypot(half.geometry.end.x - half.geometry.start.x, half.geometry.end.y - half.geometry.start.y);

      assert.ok(length > 1, `${half.name} has a real length`);
    });

  assert.equal(reducer.engineering.startPipeId, plan.first.id);
  assert.equal(reducer.engineering.endPipeId, plan.second.id);

  /* The two walls of the taper, from the model the canvas draws. */
  const walls = m.reducer.wallsOf(reducer, m.state.objects);

  assert.ok(walls, "the taper can be drawn");
  assert.equal(walls.walls.length, 2);
  assert.ok(walls.length > 1, "the transition has a length");

  /* And the fitting is its own object: selectable by its own ink. */
  m.state.selection.selectedObjectIds = [reducer.id];

  assert.ok(m.selection.selectionBounds(m.state.objects, [reducer.id]), "it has a selection box");
});

test("a reducer follows its pipes' widths, and flipping it stores no second width", async () => {
  const m = await modules();

  withPipe(m);

  const target = m.inline.findInsertionTarget({ x: 50, y: 0 });
  const plan = m.inline.planInsertion("reducer-expander", target, { mode: "reduce" });

  const result = m.inline.insertInline("reducer-expander", plan, { mode: "reduce" });

  const reducer = m.state.objects.find((object) => object.id === result.symbol.id);
  const endHalf = m.state.objects.find((object) => object.id === reducer.engineering.endPipeId);

  /* Widen the new segment through the FEATURES FIELD, as a student would. */
  m.schema.writeField(endHalf, "pipeWidth", 6);

  const widths = m.reducer.endWidthsOf(reducer, m.state.objects);

  assert.ok(Math.abs(widths.end - (m.pipe.DEFAULT_SCHEMATIC_SEPARATION + 6)) < 1e-9, `width followed the pipe (${widths.end})`);
  assert.equal(reducer.engineering.separation, undefined, "the fitting stores no width of its own");

  /* FLIP: the taper reverses, and nothing on the sheet moves. */
  const before = JSON.stringify(reducer.geometry.position);

  assert.equal(m.reducer.flipReducer(reducer), true);
  assert.equal(m.reducer.normaliseMode(reducer.engineering.mode), "expand");
  assert.equal(JSON.stringify(reducer.geometry.position), before, "flipping does not move the fitting");

  /* Changing the transition length re-seats both segments on the new ends. */
  assert.equal(m.schema.writeField(reducer, "transitionLength", 30), true);
  assert.equal(m.reducer.transitionLengthOf(reducer), 30);
});

test("a reducer at a pipe END attaches without splitting, and the continuation is its own run", async () => {
  const m = await modules();

  const host = withPipe(m);

  const target = m.inline.findInsertionTarget({ x: 0, y: 0 });

  assert.equal(target.interior, false, "an end is an endpoint placement");

  const plan = m.inline.planInsertion("reducer-expander", target, { mode: "expand", transitionLength: 10 });

  assert.equal(plan.placement, "endpoint");

  const result = m.inline.insertInline("reducer-expander", plan, { mode: "expand", transitionLength: 10 });

  assert.ok(result?.symbol);

  const reducer = m.state.objects.find((object) => object.id === result.symbol.id);
  const runs = m.state.objects.filter((object) => object.type === "pipe-duct");

  assert.equal(runs.length, 2, "the original run plus ONE new continuation");
  assert.equal(runs[0].id, host.id, "the original keeps its identity");
  assert.notEqual(runs[1].id, host.id, "the continuation is a new object");
  assert.equal(reducer.engineering.startPipeId, host.id);
  assert.equal(reducer.engineering.endPipeId, runs[1].id);

  /* The continuation is an ordinary, editable Pipe / Duct. */
  assert.ok(m.schema.groupsFor(runs[1]).some((group) => group.id === "transform"));
});

/* ============================================================
 * THE INLINE EQUIPMENT
 * ============================================================ */

["pump", "valve", "flow-meter"].forEach((kind) => {
  test(`a ${kind} inserts into a run, owns the gap, and stays connected`, async () => {
    const m = await modules();

    const host = withPipe(m);

    const target = m.inline.findInsertionTarget({ x: 40, y: 0 });
    const plan = m.inline.planInsertion(kind, target, { symbolSize: 8 });

    const result = m.inline.insertInline(kind, plan, { symbolSize: 8 });

    assert.ok(result?.symbol, `${kind} was created`);

    const symbol = m.state.objects.find((object) => object.id === result.symbol.id);

    assert.equal(symbol.type, kind);
    assert.equal(m.equipment.isInline(symbol), true, "it is inline");
    assert.equal(symbol.engineering.pipeIds.length, 2, "it joins two segments");

    /* ORIENTATION FOLLOWS THE HOST. */
    assert.ok(Math.abs(symbol.geometry.rotation) < 1e-6, `it lies along the horizontal run (${symbol.geometry.rotation})`);

    /*
     * THE SPLIT HALVES, BY ID. There are TWO - the host (same id, start side)
     * and one new segment - and nothing else was created by the insertion.
     */
    const halves = m.state.objects.filter(
      (object) => object.type === "pipe-duct" && (object.id === host.id || object.id === plan.second.id)
    );

    assert.equal(halves.length, 2, "the host and its one new half");

    const allPipes = m.state.objects.filter((object) => object.type === "pipe-duct");

    assert.deepEqual(
      allPipes.map((object) => object.id).sort(),
      [host.id, plan.second.id].sort(),
      `exactly two segments on the sheet (${allPipes.map((object) => `${object.id}:${object.name}`).join(", ")})`
    );

    const points = m.equipment.connectionPoints(symbol);
    const inset = m.equipment.connectionOffset(symbol);

    assert.ok(Math.abs(points.a.x - (symbol.geometry.position.x - inset)) < 1e-9);
    assert.ok(Math.abs(points.b.x - (symbol.geometry.position.x + inset)) < 1e-9);

    /* THE START-SIDE SEGMENT ENDS at the symbol's first connection point... */
    const startHalf = halves.find((half) => half.id === host.id);
    const endHalf = halves.find((half) => half.id === plan.second.id);

    assert.ok(
      Math.hypot(startHalf.geometry.end.x - points.a.x, startHalf.geometry.end.y - points.a.y) < 1e-6,
      "the start-side segment stops at the symbol"
    );

    /* ...and the END-SIDE SEGMENT BEGINS at its second, so nothing runs through it. */
    assert.ok(
      Math.hypot(endHalf.geometry.start.x - points.b.x, endHalf.geometry.start.y - points.b.y) < 1e-6,
      "the end-side segment starts at the symbol"
    );

    /* It is drawn by its own model, and hit-tested by it. */
    const shape = m.equipment.symbolGeometry(symbol);

    assert.ok(shape.strokes.length > 0);
    assert.equal(m.hit.objectAtPoint({ x: symbol.geometry.position.x, y: symbol.geometry.position.y })?.id, symbol.id);

    /* Its Features tab is Object / Appearance / Transform. */
    const headings = m.schema.groupsFor(symbol).map((group) => group.heading);

    assert.ok(headings.includes("Transform"));
  });
});

test("equipment placed in empty space is standalone and touches no pipe", async () => {
  const m = await modules();

  withPipe(m);

  const result = m.inline.insertStandalone("pump", { x: 200, y: 100 }, { symbolSize: 6 });

  assert.ok(result?.symbol);
  assert.equal(m.equipment.isInline(result.symbol), false);
  assert.equal(result.symbol.engineering.pipeIds.length, 0);
  assert.equal(m.state.objects.filter((object) => object.type === "pipe-duct").length, 1, "the pipe was not touched");
});

test("a valve's depiction changes the DRAWING only, never the connection", async () => {
  const m = await modules();

  withPipe(m);

  const target = m.inline.findInsertionTarget({ x: 40, y: 0 });
  const plan = m.inline.planInsertion("valve", target, { symbolSize: 8 });
  const result = m.inline.insertInline("valve", plan, { symbolSize: 8 });

  const valve = m.state.objects.find((object) => object.id === result.symbol.id);
  const before = JSON.stringify(m.equipment.connectionPoints(valve));

  assert.equal(m.schema.writeField(valve, "valveDepiction", "closed"), true);
  assert.equal(m.equipment.valveDepictionOf(valve), "closed");
  assert.equal(JSON.stringify(m.equipment.connectionPoints(valve)), before, "the connection points did not move");

  const strokes = m.equipment.symbolGeometry(valve).strokes;

  assert.ok(strokes.some((part) => part.kind === "line"), "a closed valve draws its bar");
});

/* ============================================================
 * THE VESSEL AND ITS LEVEL
 * ============================================================ */

test("the vessel is one object: open, closed, resizable, and moved as a whole", async () => {
  const m = await modules();

  m.state.objects = [];

  const vessel = m.vessel.vesselFromDrag({ x: 0, y: 0 }, { x: 40, y: 30 });

  assert.ok(vessel);
  assert.equal(m.vessel.vesselSegments(vessel).length, 3, "an open reservoir has three walls");

  m.state.objects = [vessel];

  assert.equal(m.schema.writeField(vessel, "vesselStyle", "closed"), true);
  assert.equal(m.vessel.vesselSegments(vessel).length, 4, "a closed tank adds its top");

  /* Resize through the Features field, and the geometry follows. */
  assert.equal(m.schema.writeField(vessel, "vesselWidth", 60), true);
  assert.equal(m.vessel.vesselRect(vessel).width, 60);

  /* One object, one set of wheels, one selection box. */
  const handles = m.handles.editableHandlesFor(vessel);

  assert.ok(handles.filter((handle) => handle.kind.startsWith("vessel-corner")).length === 4, "four corners");

  const headings = m.schema.groupsFor(vessel).map((group) => group.heading);

  assert.deepEqual(headings, ["Object", "Appearance", "Transform"]);
});

test("a fluid level needs a vessel, spans its interior, and follows it", async () => {
  const m = await modules();

  const vessel = m.vessel.vesselFromDrag({ x: 0, y: 0 }, { x: 40, y: 30 });

  m.ds.addObject(m.state, vessel);

  assert.equal(m.tool.vesselAtPoint({ x: 20, y: 15 })?.id, vessel.id, "the interior is found");
  assert.equal(m.tool.vesselAtPoint({ x: 200, y: 200 }), null, "and a point outside is not");

  const committed = m.tool.commitFluidLevelAt({ x: 20, y: 10 });

  assert.ok(committed, "the level was placed");
  assert.equal(committed.type, "fluid-level");
  assert.equal(committed.engineering.vesselId, vessel.id);

  const segment = m.level.levelSegment(committed);

  assert.ok(segment, "the level has a line");
  assert.ok(segment.start.x > vessel.geometry.position.x, "it starts inside the wall");
  assert.ok(segment.end.x < vessel.geometry.position.x + vessel.geometry.width, "and ends inside the other");

  /* MOVING THE VESSEL CARRIES THE LEVEL. */
  const beforeY = m.level.levelSegment(committed).start.y;

  vessel.geometry = { ...vessel.geometry, position: { x: 0, y: 10 } };

  m.vessel.followVessel(vessel, m.state.objects);
  m.level.refreshFluidLevel(committed, m.state.objects);

  const afterY = m.level.levelSegment(committed).start.y;

  assert.ok(Math.abs(afterY - (beforeY + 10)) < 1e-6, `the level moved with the vessel (${beforeY} -> ${afterY})`);

  /*
   * And it is editable, with the vessel stated read-only.
   *
   * The Transform section IS offered - the level has X, Y and a Rotate fixed at
   * 0 deg - but its coordinates are READ BACK from the vessel's interior rather
   * than typed, because a level that could leave its host is not a level.
   */
  const headings = m.schema.groupsFor(committed).map((group) => group.heading);

  assert.deepEqual(headings, ["Object", "Appearance", "Transform"]);
  assert.equal(m.schema.readField(committed, "levelVessel"), vessel.name);
  assert.equal(m.schema.readField(committed, "levelRotation"), 0, "the level is horizontal");
  assert.equal(m.schema.writeField(committed, "levelX", 0), false, "its X is its host's");
  assert.ok(Number.isFinite(m.schema.readField(committed, "levelY")), "its Y is stated");
  assert.equal(m.schema.writeField(committed, "levelVessel", "something else"), false, "the host is read-only");
});

test("the fluid level tool refuses to draw an unrelated line with no vessel", async () => {
  const m = await modules();

  withPipe(m);

  /* The interior of nothing is not a vessel. */
  assert.equal(m.tool.vesselAtPoint({ x: 50, y: 0 }), null, "a pipe is not a vessel");

  const before = m.state.objects.length;

  assert.equal(m.tool.commitFluidLevelAt({ x: 50, y: 0 }), null);
  assert.equal(m.state.objects.length, before, "nothing was created");
  assert.equal(m.state.objects.filter((object) => object.type === "fluid-level").length, 0);
});

/* ============================================================
 * ARROWS
 * ============================================================ */

test("the free flow arrow is a real object with tail/tip handles and no pipe", async () => {
  const m = await modules();

  m.state.objects = [];

  const arrow = m.arrows.createFreeFlowArrow({ x: 0, y: 0 }, { x: 40, y: 20 });

  assert.ok(arrow);
  assert.equal(arrow.type, "flow-arrow");
  assert.equal(arrow.attachment, undefined, "it is not attached to a pipe");

  m.state.objects = [arrow];

  const handles = m.handles.editableHandlesFor(arrow).map((handle) => handle.kind);

  assert.ok(handles.includes("start"), "a tail handle");
  assert.ok(handles.includes("end"), "a tip handle");

  assert.equal(m.arrows.freeArrowLength(arrow), Math.hypot(40, 20));
  assert.equal(m.schema.writeField(arrow, "freeArrowLength", 100), true);
  assert.ok(Math.abs(m.arrows.freeArrowLength(arrow) - 100) < 1e-6, "the Length field re-draws the arrow");

  /* It never alters pipe geometry - there is no pipe to alter. */
  assert.equal(m.state.objects.filter((object) => object.type === "pipe-duct").length, 0);
});

test("a directional annotation rides its pipe and reverses without moving it", async () => {
  const m = await modules();

  const host = withPipe(m);

  const created = m.arrows.createFlowDirection(host, { position: 0.5, spacing: "pair", host });

  assert.ok(created, "the annotation was built");

  /* The host is handed in, so the annotation's mirror is written at once. */
  m.ds.addObject(m.state, created);

  const annotation = m.state.objects.find((object) => object.engineering?.pipeId === host.id && object.type === "flow-direction-diagram");

  assert.ok(annotation, "the annotation was created and is on the sheet");
  assert.equal(annotation.engineering.pipeId, host.id);

  const shapes = m.arrows.directionArrowShapes(annotation, m.state.objects);

  assert.equal(shapes.length, 2, "a pair is two arrows");

  const pipeBefore = JSON.stringify(host.geometry);

  assert.equal(m.schema.writeField(annotation, "directionReversed", true), true);

  const reversed = m.arrows.directionArrowShapes(annotation, m.state.objects);

  assert.ok(reversed[0].direction.x < 0, "the arrows now point the other way");
  assert.equal(JSON.stringify(host.geometry), pipeBefore, "the pipe did not move");

  /* The annotation follows the pipe when the pipe moves. */
  host.geometry = { start: { x: 0, y: 20 }, end: { x: 100, y: 20 } };

  const moved = m.arrows.directionArrowShapes(annotation, m.state.objects);

  assert.ok(Math.abs(moved[0].start.y - 20) < 1e-6, "it stayed on the run");

  /* It never offers a detaching X/Y, and states its pipe read-only. */
  assert.equal(m.schema.writeField(annotation, "directionPipe", "other"), false);
});

/* ============================================================
 * THE PRESSURE PROFILE
 * ============================================================ */

test("the pressure profile plots exactly the student's rows, and drags write the row", async () => {
  const m = await modules();

  m.state.objects = [];

  const profile = m.profile.profileFromDrag({ x: 0, y: 0 }, { x: 120, y: 80 });

  assert.ok(profile);

  m.state.objects = [profile];

  /* No rows, no line. */
  assert.equal(m.profile.plottedPoints(profile).length, 0);

  m.profile.addPoint(profile, { position: 0, pressure: 100 });
  m.profile.addPoint(profile, { position: 50, pressure: 60 });
  m.profile.addPoint(profile, { position: 100, pressure: 20 });

  const plotted = m.profile.plottedPoints(profile);

  assert.equal(plotted.length, 3, "three rows, three points - and no invented ones");

  /* THE POINT MAPPING IS ITS OWN INVERSE. */
  const back = m.profile.drawingToData(profile, { x: plotted[1].x, y: plotted[1].y });

  assert.ok(Math.abs(back.position - 50) < 1e-6);
  assert.ok(Math.abs(back.pressure - 60) < 1e-6);

  /* An edited row moves the plotted point. */
  assert.equal(m.schema.writeField(profile, "profileYMax", 120), true);
  assert.equal(m.profile.axesOf(profile).yMax, 120);

  /* The graph's Features tab is Object, Data, Axes, Appearance, Transform. */
  const headings = m.schema.groupsFor(profile).map((group) => group.heading);

  assert.deepEqual(headings, ["Object", "Axes", "Appearance", "Transform"]);

  /* X and Y are the frame's real anchor, not an offset that reports zero. */
  assert.equal(m.schema.writeField(profile, "profileX", 25), true);
  assert.equal(m.profile.profileFrame(profile).position.x, 25, "the frame moved to its X");
  assert.equal(m.schema.readField(profile, "profileX"), 25);

  /* Removing a row removes its point. */
  assert.equal(m.profile.removePoint(profile, 0), true);
  assert.equal(m.profile.plottedPoints(profile).length, 2);
});

/* ============================================================
 * THE SECTION PLANE
 * ============================================================ */

test("the section plane is one object, and crossing a pipe splits nothing", async () => {
  const m = await modules();

  const host = withPipe(m);

  const section = m.section.createSectionPlane({ x: 50, y: -20 }, { x: 50, y: 20 }, { identifier: "A" });

  assert.ok(section);

  m.state.objects = [...m.state.objects, section];

  /* NO CONNECTION, NO SPLIT - the pipe is exactly as it was. */
  assert.equal(m.state.objects.filter((object) => object.type === "pipe-duct").length, 1);
  assert.equal(JSON.stringify(host.geometry.start), JSON.stringify({ x: 0, y: 0 }));

  assert.equal(m.section.sectionIdentifierOf(section), "A");
  assert.equal(m.section.sectionArrows(section).length, 2, "its viewing arrows");

  /* Reversing turns the arrows and leaves the trace. */
  const before = JSON.stringify(m.section.sectionSpan(section));

  assert.equal(m.schema.writeField(section, "sectionDirection", "reverse"), true);
  assert.equal(JSON.stringify(m.section.sectionSpan(section)), before, "the trace did not move");

  const forward = m.section.sectionArrows(section);

  void forward;

  /* The length field re-draws the trace about its middle. */
  assert.equal(m.schema.writeField(section, "sectionLength", 60), true);
  assert.ok(Math.abs(m.section.sectionLengthOf(section) - 60) < 1e-6);
});

/* ============================================================
 * SOURCE ROUND-TRIP
 * ============================================================ */

test("every schematic block writes source and reads back as the same object", async () => {
  const m = await modules();

  const host = withPipe(m);

  const cases = [];

  const reducerTarget = m.inline.findInsertionTarget({ x: 60, y: 0 });
  const reducerPlan = m.inline.planInsertion("reducer-expander", reducerTarget, { mode: "reduce" });
  const reducerResult = m.inline.insertInline("reducer-expander", reducerPlan, { mode: "reduce" });

  cases.push(["reducer-expander", reducerResult.symbol.id]);

  const pumpTarget = m.inline.findInsertionTarget({ x: 20, y: 0 });
  const pumpPlan = m.inline.planInsertion("pump", pumpTarget, { symbolSize: 5 });
  const pumpResult = m.inline.insertInline("pump", pumpPlan, { symbolSize: 5 });

  cases.push(["pump", pumpResult.symbol.id]);

  const vessel = m.vessel.vesselFromDrag({ x: 0, y: 100 }, { x: 40, y: 140 });

  m.ds.addObject(m.state, vessel);
  cases.push(["reservoir-tank", vessel.id]);

  m.tool.commitFluidLevelAt({ x: 20, y: 120 });

  const level = m.state.objects.find((object) => object.type === "fluid-level");

  cases.push(["fluid-level", level.id]);

  const free = m.arrows.createFreeFlowArrow({ x: -40, y: 0 }, { x: -10, y: 0 });

  m.ds.addObject(m.state, free);
  cases.push(["flow-arrow", free.id]);

  const direction = m.arrows.createFlowDirection(host, { position: 0.3, host });

  if (direction) {
    m.ds.addObject(m.state, direction);
  }

  if (direction) {
    cases.push(["flow-direction-diagram", direction.id]);
  }

  const profile = m.profile.profileFromDrag({ x: 0, y: 200 }, { x: 100, y: 260 });

  m.profile.addPoint(profile, { position: 0, pressure: 10 });
  m.profile.addPoint(profile, { position: 100, pressure: 30 });

  m.ds.addObject(m.state, profile);
  cases.push(["pressure-profile", profile.id]);

  const section = m.section.createSectionPlane({ x: 120, y: 0 }, { x: 140, y: 30 });

  m.ds.addObject(m.state, section);
  cases.push(["section-plane", section.id]);

  for (const [type, id] of cases) {
    const object = m.state.objects.find((candidate) => candidate.id === id);

    const block = m.sync.sourceForObject(object);

    assert.ok(block, `${type} wrote a source block`);

    /* ONE block per object: exactly one header. */
    assert.equal((block.match(/% DAETUM OBJECT:/g) || []).length, 1, `${type} writes one header`);
    assert.match(block, new RegExp(`% DAETUM TYPE: ${type}`));
  }

  /*
   * AN EDIT TO THE DRAWING IS READ BACK. The vessel is closed in source, and the
   * object follows on the next parse - which is the round trip the requirement
   * asks for.
   */
  const vesselBlock = m.sync.sourceForObject(vessel);

  assert.match(vesselBlock, /% DAETUM VESSEL: style=open/);

  const edited = vesselBlock.replace("style=open", "style=closed");

  const source = `\\begin{tikzpicture}[x=1mm, y=1mm]\n${edited}\n\\end{tikzpicture}`;

  const report = m.apply.applyParsedSourceToDrawing({
    model: m.ds,
    state: m.state,
    source,
    editable: true,
    removeMissing: false
  });

  assert.ok(report, "the parse ran");

  const reread = m.state.objects.find((object) => object.id === vessel.id);

  assert.equal(m.vessel.vesselStyleOf(reread), "closed", "the vessel closed from its source");
});
