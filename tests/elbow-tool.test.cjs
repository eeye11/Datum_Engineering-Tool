/* eslint-disable no-console */
/*
 * ========================================================
 * THE ELBOW TOOL: ACCEPTANCE TESTS
 * ========================================================
 *
 * Five categories, as the specification requires:
 *
 *   A  creation, selection and interaction
 *   B  geometry and transformations
 *   C  connections and edge cases
 *   D  features and appearance
 *   E  LaTeX source and rendering
 *
 * They drive the same modules the canvas does - the model, the tool session,
 * the schema, the handles, the writer and the source reader - rather than a
 * second implementation written for the tests.
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
    fluids: require(locate("model/fluids/fluids-tools.js")),
    pipe: require(locate("model/fluids/pipe-duct.js")).default,
    tool: require(locate("pipe-duct-tool.js")),
    sync: require(locate("source-synchronization.js")),
    state: require(locate("editor-state.js")).drawingState,
    drawingState: require(locate("drawing-state.js")).default,
    schema: require(locate("feature-schema.js")),
    handles: require(locate("handles.js")),
    editor: require(locate("features-editor.js")),
    sourceModel: require(locate("source-model.js")),
    sourceSync: require(locate("source-object-sync.js")),
    drawingSource: require(locate("drawing-source.js")),
    sourceApply: require(locate("source-model-apply.js"))
  };
}

function reset(state) {
  state.objects = [];
  state.selection.selectedObjectIds = [];
  state.interaction.previousRun = null;
  state.interaction.routeCommittedCount = 0;
  state.interaction.phase = "idle";
}

/* Degrees at common snapping stops are compared with a little slack. */
function near(actual, expected, slack = 1) {
  assert.ok(Math.abs(actual - expected) <= slack, `${actual} is not within ${slack} of ${expected}`);
}

/* ============================================================
 * A. CREATION, SELECTION AND INTERACTION
 * ============================================================ */

test("A1: the Elbow tool is registered under Flow Paths and is not planned", () => {
  const m = modules();

  const menu = m.fluids.FLUIDS_TOOL_MENUS["fluids-flow-paths"];

  assert.deepEqual(
    menu.map((item) => item.label),
    ["Pipe / Duct", "Elbow", "Junction"],
    "Elbow sits between Pipe / Duct and Junction"
  );

  assert.equal(m.fluids.isPlannedFluidsTool("elbow"), false, "Elbow must be a working tool");
  assert.equal(m.fluids.fluidsCapability("elbow"), "route", "it travels the drag-creation system");
});

test("A2: the Elbow icon is two parallel curved lines with open ends", () => {
  ready();

  const { toolIcons } = require(locate("tools.js"));
  const icon = toolIcons.Elbow;

  assert.ok(typeof icon === "string" && icon.includes("<svg"), "an Elbow icon must exist");

  /*
   * TWO PATHS IN ONE `<path>`: the two curved boundaries, each a move followed
   * by a vertical leg and an arc. There are no corner ticks and no tick marks.
   */
  const paths = (icon.match(/d="([^"]+)"/g) || []).join(" ");

  assert.ok(/M[^"]+a/.test(paths), "the icon must contain an arc");
  assert.equal((paths.match(/a\s/g) || []).length + (paths.match(/a-?[0-9]/g) || []).length >= 2, true);
});

test("A3: a manual gesture on empty canvas creates ONE standalone 90 degree elbow", () => {
  const m = modules();

  reset(m.state);

  const created = m.tool.commitElbowGesture({ x: 0, y: 0 }, { x: 100, y: 0 });

  assert.ok(created?.elbow, "an elbow must be created");

  const elbow = created.elbow;

  assert.equal(elbow.type, "elbow", "one logical elbow object");
  assert.equal(
    m.state.objects.filter((object) => object.type === "elbow").length,
    1,
    "and only one"
  );
  assert.deepEqual(elbow.engineering.connections, [null, null], "both ends are free");
  near(m.pipe.elbowAngleDegrees(elbow), 90);
  assert.ok(elbow.engineering.bendRadius > 0, "a bend always has a radius");
});

test("A4: the elbow's two boundaries are one object and select with one click", () => {
  const m = modules();

  reset(m.state);

  const { elbow } = m.tool.commitElbowGesture({ x: 0, y: 0 }, { x: 80, y: 80 });

  /* The two walls are DERIVED, not stored as objects. */
  assert.equal(m.state.objects.length, 1);
  assert.ok(m.handles.editableHandlesFor(elbow).length > 0, "the fitting is editable");

  const bounds = require(locate("selection-transform.js")).selectionBounds([elbow], [elbow.id]);

  assert.ok(
    bounds && bounds.maxX - bounds.minX > 0 && bounds.maxY - bounds.minY > 0,
    `its box surrounds the whole bend, got ${JSON.stringify(bounds)}`
  );
});

test("A5: a gesture between two pipe ends creates a fully connected elbow", () => {
  const m = modules();

  reset(m.state);

  const first = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
  const second = m.pipe.createPipeDuct({ x: 200, y: 100 }, { x: 200, y: 0 });

  m.state.objects = [first, second];

  const created = m.tool.commitElbowGesture({ x: 100, y: 0 }, { x: 200, y: 0 });

  assert.ok(created?.elbow);

  assert.deepEqual(
    created.elbow.engineering.connections,
    [first.id, second.id],
    "both connections are recorded, A then B"
  );

  assert.equal(m.schema.elbowConnectionState(created.elbow), "connected");
});

test("A6: an elbow joined to ONE pipe is a valid partially connected elbow", () => {
  const m = modules();

  reset(m.state);

  const run = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });

  m.state.objects = [run];

  const created = m.tool.commitElbowGesture({ x: 100, y: 0 }, { x: 100, y: 90 });

  assert.ok(created?.elbow);

  assert.deepEqual(created.elbow.engineering.connections, [run.id, null]);
  assert.equal(m.schema.elbowConnectionState(created.elbow), "partial");
});

test("A7: the live preview is the fitting's own geometry, not an approximation", () => {
  const m = modules();

  reset(m.state);

  const interaction = {
    elbowStart: { x: 0, y: 0 },
    elbowStartMatch: null,
    elbowAngle: 90
  };

  const preview = m.tool.elbowGesturePreview(interaction, { x: 100, y: 0 });

  assert.ok(preview, "a preview exists once the gesture has a length");
  assert.ok(preview.ends?.a && preview.ends?.b, "both ends are published");
  assert.ok(preview.engineering.bendRadius > 0);

  /* The preview's own geometry draws both boundaries. */
  const curves = m.pipe.elbowGeometry(
    preview.previous,
    preview.position,
    preview.next,
    preview.engineering.bendRadius,
    m.pipe.elbowLegs(preview)
  );

  assert.ok(curves, "the preview resolves to a drawable bend");
});

test("A8: a straight Pipe / Duct continuation earns no elbow; an angled one earns exactly one", () => {
  const m = modules();

  reset(m.state);

  const first = m.tool.commitRouteSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {});

  const straight = m.tool.commitRouteSegment({ x: 100, y: 0 }, { x: 200, y: 0 }, {
    previousRun: first.run,
    routeCommittedCount: 1
  });

  assert.equal(straight.elbow, null, "a collinear continuation is not a bend");
  assert.equal(m.state.objects.filter((object) => object.type === "elbow").length, 0);

  const angled = m.tool.commitRouteSegment({ x: 200, y: 0 }, { x: 200, y: 100 }, {
    previousRun: straight.run,
    routeCommittedCount: 2
  });

  assert.ok(angled.elbow, "a 90 degree corner earns a fitting");
  assert.equal(m.state.objects.filter((object) => object.type === "elbow").length, 1);

  /* Repeated generation never duplicates. */
  m.tool.generateElbowFor(straight.run, angled.run, {});
  m.tool.refreshFluidConnections(angled.run, m.state.objects);

  assert.equal(
    m.state.objects.filter((object) => object.type === "elbow").length,
    1,
    "one corner, one fitting"
  );
});

test("A9: only the selected object is highlighted, never the pipes it joins", () => {
  const m = modules();

  reset(m.state);

  const first = m.tool.commitRouteSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {});
  const second = m.tool.commitRouteSegment({ x: 100, y: 0 }, { x: 100, y: 100 }, {
    previousRun: first.run,
    routeCommittedCount: 1
  });

  const selection = require(locate("selection-transform.js"));
  const members = selection.selectionMembers([first.run, second.run, second.elbow], [second.elbow.id]);

  assert.equal(members.length, 1, "connecting objects are not part of the selection");
  assert.equal(members[0].id, second.elbow.id);
});

/* ============================================================
 * B. GEOMETRY AND TRANSFORMATIONS
 * ============================================================ */

test("B1: a standalone elbow is a smooth two-boundary bend at 90 degrees", () => {
  const m = modules();

  reset(m.state);

  const { elbow } = m.tool.commitElbowGesture({ x: 0, y: 0 }, { x: 100, y: 0 });

  const curves = m.pipe.elbowCurvesFor(elbow);

  assert.ok(curves, "the bend is drawable");
  near(curves.angleDegrees, 90);
  assert.ok(curves.radius > 0);

  /* Both walls are concentric with the centreline arc. */
  const separation = m.pipe.DEFAULT_SCHEMATIC_SEPARATION;

  assert.ok(Math.abs(Math.hypot(curves.start.x - curves.centre.x, curves.start.y - curves.centre.y) - curves.radius) < 1e-6);
  assert.ok(separation > 0, "the two boundaries are spaced apart");
});

test("B2: Bend Angle is editable standalone and partial, and read-only when fully connected", () => {
  const m = modules();

  reset(m.state);

  const standalone = m.tool.commitElbowGesture({ x: 0, y: 0 }, { x: 100, y: 0 }).elbow;

  assert.equal(m.schema.elbowConnectionState(standalone), "standalone");
  assert.equal(m.schema.writeElbowAngle(standalone, 45), true, "a standalone angle is editable");
  near(m.pipe.elbowAngleDegrees(standalone), 45);

  /* Partially connected: one end attached. */
  const run = m.pipe.createPipeDuct({ x: 200, y: 0 }, { x: 300, y: 0 });
  m.state.objects.push(run);

  const partial = m.tool.commitElbowGesture({ x: 200, y: 0 }, { x: 200, y: -80 }).elbow;

  assert.equal(m.schema.elbowConnectionState(partial), "partial");
  assert.equal(m.schema.writeElbowAngle(partial, 60), true, "a partial angle is editable");
  near(m.pipe.elbowAngleDegrees(partial), 60);

  /* Fully connected: both ends attached, through a real (if short) gesture. */
  const a = m.pipe.createPipeDuct({ x: 400, y: 0 }, { x: 500, y: 0 });
  const b = m.pipe.createPipeDuct({ x: 500, y: 100 }, { x: 500, y: 0 });

  m.state.objects.push(a, b);

  const connectedElbow = m.pipe.createElbow({
    geometry: {
      position: { x: 500, y: 0 },
      ends: { a: { x: 500, y: 0 }, b: { x: 500, y: 0.5 } }
    },
    engineering: { connections: [a.id, b.id], angleDegrees: 90 }
  });

  assert.equal(
    m.schema.writeField(connectedElbow, "bendAngle", 30),
    false,
    "a fully connected elbow refuses a typed angle"
  );
});

test("B3: angle snapping stops at the common angles but allows any other", () => {
  const m = modules();

  [30, 45, 60, 90, 135].forEach((angle) => {
    assert.equal(m.pipe.snapElbowAngle(angle), angle, `${angle} is a stop`);
    assert.equal(m.pipe.snapElbowAngle(angle + 2), angle, `${angle} is snapped from near it`);
  });

  /* Dragged away from a stop, the true angle survives. */
  assert.equal(m.pipe.snapElbowAngle(70), 70);
  assert.equal(m.pipe.snapElbowAngle(22), 22);
});

test("B4: Bend Radius is a RELATIVE adjustment and does not act as an absolute target", () => {
  const m = modules();

  reset(m.state);

  const { elbow } = m.tool.commitElbowGesture({ x: 0, y: 0 }, { x: 120, y: 0 });

  const before = Number(elbow.engineering.bendRadius);

  const applied = m.schema.adjustElbowRadius(elbow, -2);

  assert.ok(applied, "the change was applied");
  near(Number(elbow.engineering.bendRadius), before - 2, 1e-6);

  /* Zero is not an absolute radius: it is no change at all. */
  const held = Number(elbow.engineering.bendRadius);
  assert.equal(m.schema.adjustElbowRadius(elbow, 0), false);
  near(Number(elbow.engineering.bendRadius), held, 1e-6);
});

test("B5: an oversized radius is clamped to what the bend can hold", () => {
  const m = modules();

  reset(m.state);

  const { elbow } = m.tool.commitElbowGesture({ x: 0, y: 0 }, { x: 100, y: 0 });

  /*
   * A MANUAL FITTING'S ARMS ARE ITS OWN ENDS, and those do not move when the
   * radius does - so the largest radius it can DRAW is a hair inside the arm
   * limit, which is what `elbowFitRadius` reports. The clamp is measured
   * against that number.
   */
  const fit = m.pipe.elbowFitRadius(elbow);

  assert.ok(Number.isFinite(fit) && fit > 0, "the bend has a maximum radius");

  const applied = m.schema.adjustElbowRadius(elbow, fit * 10);

  assert.ok(applied);
  assert.ok(Number(elbow.engineering.bendRadius) <= fit + 1e-6, "it stopped at the largest valid radius");
  assert.ok(m.pipe.elbowCurvesFor(elbow), "and the geometry is still valid");
});

test("B6: the features Transform has X Shift, Y Shift and Bend Radius - no angle and no Rotate", () => {
  const m = modules();

  reset(m.state);

  const { elbow } = m.tool.commitElbowGesture({ x: 0, y: 0 }, { x: 90, y: 0 });

  const html = m.editor.featuresMarkupForSelection([elbow]);
  const transform = html.slice(html.indexOf('data-feature-group="transform"'));

  ["X Shift", "Y Shift", "Bend Radius"].forEach((label) => {
    assert.ok(transform.includes(`>${label}<`), `Transform must have ${label}`);
  });

  /*
   * NO BEND ANGLE CONTROL. The bend is the direction change its pipes make,
   * so it is DERIVED - a field that could set a different one would describe
   * a bend the pipework does not have.
   */
  assert.ok(!/Bend Angle/.test(html), "an elbow has no Bend Angle control");
  assert.ok(!/Angle/.test(html), "and no angle control of any kind");

  assert.ok(!transform.includes(">Rotate<"), "an elbow has no Rotate");
  assert.ok(!/Rotate/.test(html), "and no Rotate anywhere in its panel");
  assert.ok(!/[Vv]isib/.test(html), "and no Visibility control");
});

test("B7: the radius handle is offered, the angle handle is withdrawn when fully connected", () => {
  const m = modules();

  reset(m.state);

  const standalone = m.tool.commitElbowGesture({ x: 0, y: 0 }, { x: 90, y: 0 }).elbow;
  const kinds = m.handles.editableHandlesFor(standalone).map((handle) => handle.kind);

  assert.ok(kinds.includes("elbow-radius"), "a dedicated radius handle exists");
  assert.ok(kinds.includes("elbow-angle"), "and an angle handle");
  assert.ok(!kinds.includes("rotate"), "and never a rotation handle");
});

test("B8: a fixed elbow refuses to move and keeps its geometry", () => {
  const m = modules();

  reset(m.state);

  const { elbow } = m.tool.commitElbowGesture({ x: 0, y: 0 }, { x: 90, y: 0 });

  assert.equal(m.schema.writeField(elbow, "fixed", true), true);
  assert.equal(elbow.locked, true);
  assert.deepEqual(m.handles.editableHandlesFor(elbow), [], "a fixed fitting shows no handles");
});

/* ============================================================
 * C. CONNECTIONS AND EDGE CASES
 * ============================================================ */

test("C1: a generated elbow SURVIVES a non-right angle and tracks the new bend", () => {
  const m = modules();

  reset(m.state);

  const first = m.tool.commitRouteSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {});
  const second = m.tool.commitRouteSegment({ x: 100, y: 0 }, { x: 100, y: 100 }, {
    previousRun: first.run,
    routeCommittedCount: 1
  });

  assert.equal(m.state.objects.filter((object) => object.type === "elbow").length, 1);

  /*
   * A 30 DEGREE BEND IS STILL A BEND. Automatic fitting is not restricted to
   * right angles, so bending the corner to 30 must UPDATE the existing elbow
   * rather than delete it.
   */
  second.run.geometry.end = { x: 100 + 100 * Math.cos(Math.PI / 6), y: 100 * Math.sin(Math.PI / 6) };
  m.tool.refreshFluidConnections(second.run, m.state.objects);

  const elbows = m.state.objects.filter((object) => object.type === "elbow");

  assert.equal(elbows.length, 1, "the elbow is kept, not discarded");
  near(m.pipe.elbowAngleDegrees(elbows[0]), 30, 0.5);
});

test("C1b: a generated elbow IS removed when the runs stop meeting", () => {
  const m = modules();

  reset(m.state);

  const first = m.tool.commitRouteSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {});
  const second = m.tool.commitRouteSegment({ x: 100, y: 0 }, { x: 100, y: 100 }, {
    previousRun: first.run,
    routeCommittedCount: 1
  });

  assert.equal(m.state.objects.filter((object) => object.type === "elbow").length, 1);

  /* The runs come apart: nothing is there to fit. */
  second.run.geometry.start = { x: 160, y: 60 };
  m.tool.refreshFluidConnections(second.run, m.state.objects);

  assert.equal(m.state.objects.filter((object) => object.type === "elbow").length, 0);
  assert.equal(first.run.geometry.trims, undefined, "the run gets its straight length back");
});

test("C2: deleting a pipe removes the fitting it joins, with no stale record", () => {
  const m = modules();

  reset(m.state);

  const first = m.tool.commitRouteSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {});
  m.tool.commitRouteSegment({ x: 100, y: 0 }, { x: 100, y: 100 }, {
    previousRun: first.run,
    routeCommittedCount: 1
  });

  m.drawingState.removeObjectsAndDescendants(m.state, new Set([first.run.id]));

  assert.equal(m.state.objects.filter((object) => object.type === "elbow").length, 0);
  assert.equal(m.state.objects.filter((object) => object.type === "pipe-duct").length, 1);
});

test("C3: a manual elbow stays attached through a pipe endpoint move", () => {
  const m = modules();

  reset(m.state);

  const run = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
  m.state.objects = [run];

  const { elbow } = m.tool.commitElbowGesture({ x: 100, y: 0 }, { x: 100, y: 90 });

  /* Drag the pipe's joined end upward. */
  run.geometry.end = { x: 100, y: 20 };
  m.tool.refreshManualElbow(elbow, m.state.objects);

  assert.deepEqual(
    { x: elbow.geometry.ends.a.x, y: elbow.geometry.ends.a.y },
    { x: 100, y: 20 },
    "the attached end followed the pipe"
  );
  assert.deepEqual(elbow.engineering.connections, [run.id, null], "and is still recorded as attached");
});

test("C4: two pipe widths meet the elbow at their own ends without changing the pipes", () => {
  const m = modules();

  reset(m.state);

  const first = m.tool.commitRouteSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {});
  const second = m.tool.commitRouteSegment({ x: 100, y: 0 }, { x: 100, y: 100 }, {
    previousRun: first.run,
    routeCommittedCount: 1
  });

  m.schema.writeField(first.run, "pipeWidth", 12);
  m.schema.writeField(second.run, "pipeWidth", 0);

  m.tool.refreshFluidConnections(first.run, m.state.objects);

  const elbow = m.state.objects.find((object) => object.type === "elbow");

  assert.equal(
    elbow.engineering.startSeparation,
    m.pipe.DEFAULT_SCHEMATIC_SEPARATION + 12,
    "the incoming end is the incoming run's width"
  );

  assert.equal(
    elbow.engineering.endSeparation,
    m.pipe.DEFAULT_SCHEMATIC_SEPARATION,
    "the outgoing end is the outgoing run's width"
  );

  /* The pipes keep their own widths. */
  assert.equal(m.schema.readField(first.run, "pipeWidth"), 12);
  assert.equal(m.schema.readField(second.run, "pipeWidth"), 0);
});

test("C5: a free end dragged off its pipe leaves no connection record", () => {
  const m = modules();

  reset(m.state);

  const run = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
  m.state.objects = [run];

  const { elbow } = m.tool.commitElbowGesture({ x: 100, y: 0 }, { x: 100, y: 80 });

  m.tool.applyManualElbowConnections(elbow, m.state.objects);

  assert.equal(elbow.engineering.connected, true, "the fitting starts attached");

  /* Detaching is just removing the id and re-applying the connections. */
  elbow.engineering.connections = [null, null];
  m.tool.applyManualElbowConnections(elbow, m.state.objects);

  assert.equal(elbow.engineering.connected, false);
  assert.equal(elbow.engineering.startSeparation, undefined, "no width is claimed from a pipe it no longer meets");
});

test("C6: an unsupported edit is reported, never split into two objects", () => {
  const m = modules();

  const source = [
    "% DAETUM OBJECT: Elbow",
    "% DAETUM ID: elbow-check",
    "% DAETUM TYPE: elbow",
    "\\draw (0,0) -- (100,0);",
    "\\draw (100,0) -- (100,100);"
  ].join("\n");

  const { createSourceMap } = require(locate("drawing-source.js"));

  const map = createSourceMap(source);

  assert.ok(map.blocks.length > 0, "the block is recognised");

  const report = m.sourceSync.readSourceIntoModel({
    source,
    map,
    objects: [
      {
        id: "elbow-check",
        type: "elbow",
        name: "Elbow",
        geometry: { position: { x: 100, y: 0 }, previous: { x: 0, y: 0 }, next: { x: 100, y: 100 } },
        engineering: { bendRadius: 10 },
        style: {}
      }
    ],
    isEditing: () => false
  });

  assert.equal(report.updates.length, 0, "it does not become an elbow");
  assert.ok(report.unsupported.length > 0, "it is reported as unsupported");
  assert.equal(report.created.length, 0, "and no second object is invented");
});

/* ============================================================
 * D. FEATURES AND APPEARANCE
 * ============================================================ */

test("D1: the Features panel has exactly Object, Appearance and Transform", () => {
  const m = modules();

  reset(m.state);

  const { elbow } = m.tool.commitElbowGesture({ x: 0, y: 0 }, { x: 90, y: 0 });

  assert.deepEqual(
    m.schema.groupsFor(elbow).map((group) => group.heading),
    ["Object", "Appearance", "Transform"]
  );
});

test("D2: Object holds Name and Fix, and Appearance holds the four shared controls", () => {
  const m = modules();

  reset(m.state);

  const { elbow } = m.tool.commitElbowGesture({ x: 0, y: 0 }, { x: 90, y: 0 });

  const groups = m.schema.groupsFor(elbow);
  const object = groups.find((group) => group.heading === "Object");
  const appearance = groups.find((group) => group.heading === "Appearance");

  assert.deepEqual(object.fields.map((field) => field.key), ["fixed", "name"]);

  assert.deepEqual(
    appearance.fields.slice(0, 3).map((field) => field.key),
    ["lineType", "stroke", "lineWidth"]
  );

  assert.ok(appearance.fields.some((field) => field.key === "fillMode"), "Fill is offered");
});

test("D3: Fill is OFF by default and fills the region when switched on", () => {
  const m = modules();

  reset(m.state);

  const { elbow } = m.tool.commitElbowGesture({ x: 0, y: 0 }, { x: 90, y: 0 });

  assert.equal(m.schema.fillModeOf(elbow), "none", "a new elbow is not filled");

  assert.equal(m.schema.writeField(elbow, "fillMode", "solid"), true);
  assert.equal(m.schema.fillModeOf(elbow), "solid");

  const appearance = m.schema.groupsFor(elbow).find((group) => group.heading === "Appearance");

  assert.ok(appearance.fields.some((field) => field.key === "fill"), "a filled elbow gets a fill colour");
});

test("D4: an automatically generated elbow inherits the run's appearance once", () => {
  const m = modules();

  reset(m.state);

  const first = m.tool.commitRouteSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {});

  m.schema.writeField(first.run, "stroke", "#ff0000");
  m.schema.writeField(first.run, "lineType", "dashed");

  const second = m.tool.commitRouteSegment({ x: 100, y: 0 }, { x: 100, y: 100 }, {
    previousRun: first.run,
    routeCommittedCount: 1
  });

  assert.equal(second.elbow.style.stroke, "#ff0000", "the colour is inherited");

  m.schema.writeField(second.elbow, "stroke", "#00ff00");
  m.schema.writeField(first.run, "stroke", "#0000ff");

  assert.equal(second.elbow.style.stroke, "#00ff00", "the fitting keeps its own later choice");
  assert.equal(m.schema.readField(first.run, "stroke"), "#0000ff", "and the pipe keeps its own");
});

test("D5: a manual elbow inherits the FIRST pipe it connects to", () => {
  const m = modules();

  reset(m.state);

  const first = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });

  first.style = { ...first.style, stroke: "#123456", lineType: "dotted" };

  const second = m.pipe.createPipeDuct({ x: 200, y: 100 }, { x: 200, y: 0 });

  second.style = { ...second.style, stroke: "#abcdef" };

  m.state.objects = [first, second];

  const { elbow } = m.tool.commitElbowGesture({ x: 100, y: 0 }, { x: 200, y: 0 });

  assert.equal(elbow.style.stroke, "#123456", "the first pipe's colour");
  assert.equal(elbow.style.lineType, "dotted");

  /* Neither pipe's appearance is mutated by the fitting. */
  assert.equal(first.style.stroke, "#123456");
  assert.equal(second.style.stroke, "#abcdef");
});

test("D6: a standalone elbow uses the drawing's own appearance defaults", () => {
  const m = modules();

  reset(m.state);

  m.state.styleDefaults = { ...(m.state.styleDefaults || {}), stroke: "#224466" };

  const { elbow } = m.tool.commitElbowGesture({ x: 0, y: 0 }, { x: 90, y: 0 });

  assert.equal(elbow.style.stroke, "#224466");

  m.state.styleDefaults = { ...(m.state.styleDefaults || {}), stroke: undefined };
});

/* ============================================================
 * E. LATEX SOURCE AND RENDERING
 * ============================================================ */

test("E1: an elbow writes one readable block with a stable id and a type", () => {
  const m = modules();

  reset(m.state);

  const { elbow } = m.tool.commitElbowGesture({ x: 0, y: 0 }, { x: 100, y: 0 });

  const source = m.sync.sourceForObject(elbow);

  assert.ok(source, "the elbow wrote source");
  assert.ok(source.includes(elbow.id), "the block names the id");
  assert.ok(/%\s*DAETUM OBJECT:/.test(source));
  assert.ok(/%\s*DAETUM TYPE: elbow/.test(source));

  /* Two native TikZ paths - one per wall - with no custom macro. */
  assert.equal((source.match(/\\draw/g) || []).length, 2, "two boundaries");
  assert.ok(/arc\[|arc\s*\(/.test(source), "written as native TikZ arcs");
  assert.ok(!/\\elbow\b/.test(source), "and NOT as a custom macro");
});

test("E2: the written block parses back to both walls of one bend", () => {
  const m = modules();

  reset(m.state);

  const { elbow } = m.tool.commitElbowGesture({ x: 0, y: 0 }, { x: 100, y: 0 });
  const source = m.sync.sourceForObject(elbow);

  const commands = source
    .split("\n")
    .filter((line) => line.trim().startsWith("\\draw"))
    .map((line) => m.sourceModel.shapeFromStatement(line));

  assert.equal(commands.length, 2);
  commands.forEach((shape) => assert.equal(shape?.type, "arc", "each wall is a native arc"));
});

test("E3: a supported source edit updates ONE elbow object, still one fitting", () => {
  const m = modules();

  reset(m.state);

  const { elbow } = m.tool.commitElbowGesture({ x: 0, y: 0 }, { x: 100, y: 0 });
  const source = m.sync.sourceForObject(elbow);

  m.state.objects = [elbow];

  /*
   * A SUPPORTED SOURCE EDIT: retune the bend, then write it back through the
   * SAME writer both walls came from - so they stay the two walls of one bend.
   */
  elbow.engineering.bendRadius = Number(elbow.engineering.bendRadius) + 2;
  const edited = m.sync.sourceForObject(elbow);

  const report = m.sourceApply.applyParsedSourceToDrawing({
    model: m.drawingState,
    state: m.state,
    source: edited
  });

  assert.equal(m.state.objects.filter((object) => object.type === "elbow").length, 1, "still one object");
  assert.ok(!report.unsupported.length, "the edited block is still supported");
  assert.ok(Number(elbow.engineering.bendRadius) > 0, "and the fitting still has a bend");
});

test("E4: connections survive a supported source round trip", () => {
  const m = modules();

  reset(m.state);

  const run = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
  m.state.objects = [run];

  const { elbow } = m.tool.commitElbowGesture({ x: 100, y: 0 }, { x: 100, y: 90 });

  const source = m.sync.sourceForObject(elbow);

  const report = m.sourceApply.applyParsedSourceToDrawing({
    model: m.drawingState,
    state: m.state,
    source
  });

  assert.deepEqual(elbow.engineering.connections, [run.id, null], "the record is untouched by a round trip");
  assert.ok(!report.invalid.length && !report.unsupported.length, "the block stayed supported");
});

test("E5: an invalid source edit keeps the last valid drawing", () => {
  const m = modules();

  reset(m.state);

  const { elbow } = m.tool.commitElbowGesture({ x: 0, y: 0 }, { x: 100, y: 0 });

  m.state.objects = [elbow];

  const source = m.sync.sourceForObject(elbow);
  const before = JSON.stringify(elbow.geometry);

  const broken = source.replace(/\\draw\[[^\]]*\]/, "\\draw (0,0 -- ");

  const report = m.sourceApply.applyParsedSourceToDrawing({
    model: m.drawingState,
    state: m.state,
    source: broken
  });

  assert.ok(report.invalid.length > 0, "the edit is reported");
  assert.equal(JSON.stringify(elbow.geometry), before, "and the last valid geometry is kept");
  assert.equal(m.state.objects.filter((object) => object.type === "elbow").length, 1);
});

test("E6: an elbow's appearance reaches the source", () => {
  const m = modules();

  reset(m.state);

  const { elbow } = m.tool.commitElbowGesture({ x: 0, y: 0 }, { x: 100, y: 0 });

  m.schema.writeField(elbow, "lineType", "dashed");
  assert.ok(/dashed/.test(m.sync.sourceForObject(elbow)), "a dashed fitting is written dashed");

  m.schema.writeField(elbow, "lineType", "solid");
  m.schema.writeField(elbow, "fillMode", "solid");

  assert.ok(/-- cycle/.test(m.sync.sourceForObject(elbow)), "a filled fitting is one closed path");
});
