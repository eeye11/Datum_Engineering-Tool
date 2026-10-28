/*
 * ========================================================
 * THE FLUIDS SCHEMATIC TOOLS - THE COMPLETION PASS
 * ========================================================
 *
 * The behaviours this pass added and the earlier suites did not pin down:
 *
 *   - an inline insertion is ONE undo step and cancellation leaves nothing;
 *   - the reducer's Reduce / Expand really changes the transitioned width, and
 *     its Pipe Width field edits the SEGMENT (never the fitting);
 *   - an inline symbol slides along its host and re-seats both segments;
 *   - a section mark turns about its own middle;
 *   - a pressure profile round-trips its student rows through the source;
 *   - every new Features field is live (writes the model, redraws the answer).
 *
 * As with the other suites, every assertion is about the REAL model the canvas
 * draws from.
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

  return {
    state,
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
    schema: require(locate("feature-schema.js")),
    sync: require(locate("source-synchronization.js")),
    apply: require(locate("source-model-apply.js")),
    handles: require(locate("handles.js")),
  };
}

/* A clean sheet with one horizontal run from (0,0) to (100,0). */
function withPipe(m) {
  m.state.objects = [];
  m.state.selection.selectedObjectIds = [];
  m.state.history.past = [];
  m.state.history.future = [];
  m.state.camera.zoom = 1;

  const created = m.ds.createGeometryObject("pipe-duct", {
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 },
  });

  m.ds.addObject(m.state, created);

  return m.state.objects.find((object) => object.id === created.id) || created;
}

function pipes(m) {
  return m.state.objects.filter((object) => object.type === "pipe-duct");
}

function indexOf(m, id) {
  return m.state.objects.findIndex((object) => object.id === id);
}

/* ============================================================
 * ONE INSERTION, ONE UNDO STEP
 * ============================================================ */

test("an inline insertion is one undo step, restoring the original run", async () => {
  const m = await modules();

  const host = withPipe(m);

  const before = pipes(m).length;

  const target = m.inline.findInsertionTarget({ x: 50, y: 0 });
  const plan = m.inline.planInsertion("pump", target, { symbolSize: 6 });

  const historyBefore = m.state.history.past.length;

  const result = m.inline.insertInline("pump", plan, { symbolSize: 6 });

  assert.ok(result?.symbol);

  assert.equal(
    m.state.history.past.length,
    historyBefore + 1,
    "the split, the segment and the symbol are ONE entry",
  );

  assert.equal(pipes(m).length, before + 1, "the run was split in two");

  assert.equal(m.ds.undo(m.state), true);

  assert.equal(pipes(m).length, before, "Undo put the single run back");
  assert.equal(
    m.state.objects.some((object) => object.type === "pump"),
    false,
    "and removed the symbol",
  );

  const restored = m.state.objects.find((object) => object.id === host.id);

  assert.deepEqual(
    { start: restored.geometry.start, end: restored.geometry.end },
    { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    "the original run is exactly as it was",
  );

  assert.equal(m.ds.redo(m.state), true);
  assert.equal(pipes(m).length, before + 1, "Redo splits it again");
});

/* ============================================================
 * REDUCE / EXPAND AND THE BOUND PIPE WIDTH
 * ============================================================ */

test("Reduce narrows the transitioned segment and Expand widens it", async () => {
  const m = await modules();

  withPipe(m);

  const target = m.inline.findInsertionTarget({ x: 50, y: 0 });

  const plan = m.inline.planInsertion("reducer-expander", target, {
    mode: "reduce",
    transitionLength: 12,
  });

  const result = m.inline.insertInline("reducer-expander", plan, {
    mode: "reduce",
    transitionLength: 12,
  });

  const reducer = m.state.objects.find(
    (object) => object.id === result.symbol.id,
  );

  const runs = m.reducer.connectedRunsOf(reducer, m.state.objects);

  const startWidth = m.pipe.boundarySeparation(runs.start.engineering || {});
  const endWidth = m.pipe.boundarySeparation(runs.end.engineering || {});

  assert.ok(
    endWidth < startWidth,
    `Reduce narrowed the far segment (${startWidth} -> ${endWidth})`,
  );

  const walls = m.reducer.wallsOf(reducer, m.state.objects);

  assert.ok(
    walls.widths.end < walls.widths.start,
    "and the taper follows, because it reads both pipes",
  );

  /* EXPAND, on a fresh run. */
  withPipe(m);

  const expandTarget = m.inline.findInsertionTarget({ x: 50, y: 0 });
  const expandPlan = m.inline.planInsertion("reducer-expander", expandTarget, {
    mode: "expand",
    transitionLength: 12,
  });

  const expanded = m.inline.insertInline("reducer-expander", expandPlan, {
    mode: "expand",
    transitionLength: 12,
  });

  const expandReducer = m.state.objects.find(
    (object) => object.id === expanded.symbol.id,
  );
  const expandWalls = m.reducer.wallsOf(expandReducer, m.state.objects);

  assert.ok(
    expandWalls.widths.end > expandWalls.widths.start,
    `Expand widened the far segment (${expandWalls.widths.start} -> ${expandWalls.widths.end})`,
  );
});

test("the connected pipe's Pipe Width field edits the segment, and the taper follows", async () => {
  const m = await modules();

  withPipe(m);

  const target = m.inline.findInsertionTarget({ x: 50, y: 0 });
  const plan = m.inline.planInsertion("reducer-expander", target, {
    mode: "expand",
  });
  const result = m.inline.insertInline("reducer-expander", plan, {
    mode: "expand",
  });

  const reducer = m.state.objects.find(
    (object) => object.id === result.symbol.id,
  );

  const segment = m.reducer.connectedRunsOf(reducer, m.state.objects).end;
  assert.equal(m.schema.writeField(segment, "pipeWidth", 9), true);

  assert.equal(
    segment.engineering.schematicWidth,
    m.pipe.DEFAULT_SCHEMATIC_SEPARATION + 9,
    "the width lives on the segment",
  );

  assert.equal(
    reducer.engineering.schematicWidth,
    undefined,
    "and the fitting stores no width of its own",
  );

  assert.equal(m.schema.readField(segment, "pipeWidth"), 9);

  const walls = m.reducer.wallsOf(reducer, m.state.objects);

  assert.ok(
    Math.abs(walls.widths.end - (m.pipe.DEFAULT_SCHEMATIC_SEPARATION + 9)) <
      1e-9,
    "the taper's far end follows the segment",
  );

  assert.equal(
    m.schema.writeField(segment, "pipeWidth", -1000),
    false,
    "a width that would collapse the pipe is refused",
  );
});

/* ============================================================
 * POSITION ALONG PIPE
 * ============================================================ */

test("Position Along Pipe slides an inline symbol and re-seats both segments", async () => {
  const m = await modules();

  withPipe(m);

  const target = m.inline.findInsertionTarget({ x: 30, y: 0 });
  const plan = m.inline.planInsertion("valve", target, { symbolSize: 5 });
  const result = m.inline.insertInline("valve", plan, { symbolSize: 5 });

  const valve = m.state.objects.find(
    (object) => object.id === result.symbol.id,
  );

  assert.equal(m.schema.writeField(valve, "equipmentPosition", 0.7), true);

  const points = m.equipment.connectionPoints(valve);
  const ids = valve.engineering.pipeIds;
  const ports = valve.engineering.ports;

  const held = [
    m.state.objects.find((object) => object.id === ids[0]),
    m.state.objects.find((object) => object.id === ids[1]),
  ];

  const at = (run, port) => run.geometry[port];

  assert.ok(
    Math.hypot(
      at(held[0], ports.a).x - points.a.x,
      at(held[0], ports.a).y - points.a.y,
    ) < 1e-9,
    "the first segment still ends on the symbol",
  );

  assert.ok(
    Math.hypot(
      at(held[1], ports.b).x - points.b.x,
      at(held[1], ports.b).y - points.b.y,
    ) < 1e-9,
    "and the second begins on it - no gap",
  );

  assert.ok(valve.geometry.position.x > 60, "it moved down the run");

  for (const fraction of [0.3, 0.7, 0.5]) {
    assert.equal(m.schema.writeField(valve, "equipmentPosition", fraction), true);
    assert.ok(Math.abs(valve.geometry.position.x - fraction * 100) < 1e-9);
    assert.equal(m.schema.readField(valve, "equipmentPosition"), fraction);
    const seated = m.equipment.connectionPoints(valve);
    assert.deepEqual(at(held[0], ports.a), seated.a);
    assert.deepEqual(at(held[1], ports.b), seated.b);
    assert.deepEqual(held[0].geometry.start, { x: 0, y: 0 });
    assert.deepEqual(held[1].geometry.end, { x: 100, y: 0 });
  }

  const beforeInvalid = JSON.stringify([valve, ...held]);
  assert.equal(m.schema.writeField(valve, "equipmentPosition", 0.02), false);
  assert.equal(m.schema.writeField(valve, "equipmentPosition", 0.98), false);
  assert.equal(JSON.stringify([valve, ...held]), beforeInvalid);

  /* It never leaves the pipe. */
  assert.equal(m.schema.writeField(valve, "equipmentPosition", 3), false);

  const startHalf = held[0];

  assert.ok(
    Math.hypot(
      startHalf.geometry.end.x - startHalf.geometry.start.x,
      startHalf.geometry.end.y - startHalf.geometry.start.y,
    ) > 1,
    "and no zero-length segment was made",
  );
});

test("a standalone symbol offers X, Y and Rotate, and an inline one does not", async () => {
  const m = await modules();

  withPipe(m);

  const standalone = m.inline.insertStandalone(
    "flow-meter",
    { x: 200, y: 100 },
    { symbolSize: 6 },
  );

  const meter = standalone.symbol;

  assert.equal(m.schema.readField(meter, "equipmentX"), 200);

  assert.equal(m.schema.writeField(meter, "equipmentX", 210), true);
  assert.equal(meter.geometry.position.x, 210);

  assert.equal(m.schema.writeField(meter, "equipmentRotation", 45), true);
  assert.equal(meter.geometry.rotation, 45);

  assert.equal(
    m.schema.readField(meter, "equipmentPosition"),
    undefined,
    "no host, no position row",
  );

  /* An INLINE symbol has the position row and no free X. */
  const target = m.inline.findInsertionTarget({ x: 40, y: 0 });
  const plan = m.inline.planInsertion("pump", target, { symbolSize: 5 });
  const inlineResult = m.inline.insertInline("pump", plan, { symbolSize: 5 });

  const pump = m.state.objects.find(
    (object) => object.id === inlineResult.symbol.id,
  );

  assert.equal(
    m.schema.readField(pump, "equipmentX"),
    undefined,
    "an inline pump has no free X",
  );
  assert.ok(
    Number.isFinite(m.schema.readField(pump, "equipmentPosition")),
    "it has a position along its pipe",
  );
});

/* ============================================================
 * SECTION PLANE
 * ============================================================ */

test("a section mark turns about its middle, and its trace does not move", async () => {
  const m = await modules();

  m.state.objects = [];

  const section = m.section.createSectionPlane(
    { x: 50, y: -20 },
    { x: 50, y: 20 },
  );

  m.ds.addObject(m.state, section);

  const centreBefore = { x: 50, y: 0 };
  const span = m.section.sectionSpan(section);

  assert.equal(m.schema.writeField(section, "sectionRotation", 0), true);

  const turned = m.section.sectionSpan(section);

  assert.ok(
    Math.abs((turned.start.x + turned.end.x) / 2 - centreBefore.x) < 1e-9,
    "its middle stayed",
  );
  assert.ok(
    Math.abs((turned.start.y + turned.end.y) / 2 - centreBefore.y) < 1e-9,
  );
  assert.ok(Math.abs(turned.length - span.length) < 1e-9, "its length stayed");
  assert.ok(Math.abs(turned.direction.x - 1) < 1e-6, "it now runs along +x");

  /* X and Y move the whole marker. */
  assert.equal(m.schema.writeField(section, "sectionX", 60), true);
  assert.ok(Math.abs((turned.start.x + turned.end.x) / 2 + 10 - 60) < 1e-9);

  /* The rotation grip is one of the four handles, and one purpose each. */
  const kinds = m.handles
    .editableHandlesFor(section)
    .map((handle) => handle.kind);

  ["start", "end", "section-body", "section-rotate"].forEach((kind) =>
    assert.ok(kinds.includes(kind), `${kind} is offered`),
  );

  /* Reversing the viewing direction leaves the trace alone. */
  const before = JSON.stringify(m.section.sectionSpan(section));

  assert.equal(
    m.schema.writeField(section, "sectionDirection", "reverse"),
    true,
  );
  assert.equal(JSON.stringify(m.section.sectionSpan(section)), before);
});

/* ============================================================
 * THE PRESSURE PROFILE'S SOURCE ROUND TRIP
 * ============================================================ */

test("the profile's rows survive a source round trip, and no row is invented", async () => {
  const m = await modules();

  m.state.objects = [];

  const profile = m.profile.profileFromDrag({ x: 0, y: 0 }, { x: 120, y: 80 });

  m.profile.addPoint(profile, { position: 0, pressure: 90 });
  m.profile.addPoint(profile, { position: 25, pressure: 82 });
  m.profile.addPoint(profile, { position: 50, pressure: 65 });
  m.profile.setGraphName(profile, "Line pressure");

  m.ds.addObject(m.state, profile);

  const block = m.sync.sourceForObject(profile);

  assert.match(block, /data="/, "the rows are in the source");
  assert.match(block, /90/, "with the student's own numbers");
  assert.match(block, /Line pressure/, "and the graph's name");
  assert.match(block, /Position/, "and the axis title");

  /*
   * READ IT BACK INTO A FRESH SHEET. The parse must rebuild the same three
   * rows - not the plotted line, not interpolated stops.
   */
  const source = `\\begin{tikzpicture}[x=1mm, y=1mm]\n${block}\n\\end{tikzpicture}`;

  const report = m.apply.applyParsedSourceToDrawing({
    model: m.ds,
    state: m.state,
    source,
    editable: true,
    removeMissing: false,
  });

  assert.ok(report, "the parse ran");

  const reread = m.state.objects.find((object) => object.id === profile.id);

  assert.deepEqual(
    m.profile.dataPointsOf(reread),
    [
      { position: 0, pressure: 90 },
      { position: 25, pressure: 82 },
      { position: 50, pressure: 65 },
    ],
    "the table came back exactly",
  );

  assert.equal(m.profile.graphNameOf(reread), "Line pressure");
  assert.equal(m.profile.axesOf(reread).xTitle, "Position");
  assert.equal(
    m.profile.plottedPoints(reread).length,
    3,
    "and three points, no invented ones",
  );
});

/* ============================================================
 * THE VESSEL'S TRANSFORM
 * ============================================================ */

test("the vessel's X, Y and Rotate move the whole vessel and its level", async () => {
  const m = await modules();

  m.state.objects = [];

  const vessel = m.vessel.vesselFromDrag({ x: 0, y: 0 }, { x: 40, y: 30 });

  m.ds.addObject(m.state, vessel);

  const committed = m.state.objects.find((object) => object.id === vessel.id);

  const level = m.level.createFluidLevel(committed, 10, {});
  m.ds.addObject(m.state, level);

  const before = m.level.levelSegment(level, m.state.objects);

  assert.equal(m.schema.writeField(committed, "vesselX", 20), true);
  assert.equal(m.vessel.vesselRect(committed).position.x, 20);

  m.vessel.followVessel(committed, m.state.objects);
  m.level.refreshFluidLevel(level, m.state.objects);

  const after = m.level.levelSegment(level, m.state.objects);

  assert.ok(
    Math.abs(after.start.x - (before.start.x + 20)) < 1e-9,
    "the level followed its vessel",
  );

  assert.equal(m.schema.writeField(committed, "vesselRotation", 30), true);
  assert.ok(
    Math.abs(m.vessel.vesselRect(committed).rotation - Math.PI / 6) < 1e-9,
  );
  assert.equal(m.schema.readField(committed, "vesselRotation"), 30);
});

/* ============================================================
 * THE DIRECTION ANNOTATION'S POSITION
 * ============================================================ */

test("Position Along Path moves a direction arrow and leaves the pipe alone", async () => {
  const m = await modules();

  const host = withPipe(m);

  const annotation = m.arrows.createFlowDirection(host, {
    position: 0.2,
    host,
  });

  m.ds.addObject(m.state, annotation);

  const committed = m.state.objects.find(
    (object) => object.id === annotation.id,
  );

  const pipeBefore = JSON.stringify(host.geometry);

  assert.equal(m.schema.writeField(committed, "directionPosition", 0.6), true);

  const shapes = m.arrows.directionArrowShapes(committed, m.state.objects);

  assert.ok(shapes.length > 0);
  assert.ok(shapes[0].start.x > 50, "the arrow moved down the run");

  assert.equal(
    JSON.stringify(host.geometry),
    pipeBefore,
    "the pipe did not move",
  );
  assert.equal(
    m.schema.writeField(committed, "directionPosition", 2),
    false,
    "and it cannot leave the run",
  );
});

/* ============================================================
 * NO DEAD FIELDS
 * ============================================================ */

test("every schematic field writes something the drawing reads", async () => {
  const m = await modules();

  withPipe(m);

  const target = m.inline.findInsertionTarget({ x: 50, y: 0 });
  const plan = m.inline.planInsertion("reducer-expander", target, {
    mode: "reduce",
  });
  const result = m.inline.insertInline("reducer-expander", plan, {
    mode: "reduce",
  });

  const reducer = m.state.objects.find(
    (object) => object.id === result.symbol.id,
  );

  const groups = m.schema.groupsFor(reducer);
  const keys = groups.flatMap((group) =>
    group.fields.map((field) => field.key),
  );

  assert.deepEqual(
    groups.map((group) => group.heading),
    ["Object", "Appearance", "Transform"],
  );

  ["name", "reducerMode", "fixed"].forEach((key) =>
    assert.ok(keys.includes(key), `${key} is offered`),
  );

  /* Read-only rows are marked as such, and REFUSE a write. */
  [
    "reducerStartPipe",
    "reducerEndPipe",
    "reducerStartWidth",
    "reducerEndWidth",
  ].forEach((key) => {
    const definition = m.schema.fieldDefinition(key);

    assert.equal(definition, null, `${key} is not a separate width control`);
    assert.equal(
      m.schema.writeField(reducer, key, "x"),
      false,
      `${key} refuses a write`,
    );
  });
});
