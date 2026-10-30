/* eslint-disable no-console */
/*
 * ========================================================
 * PIPE / DUCT: THE IMPLEMENTED TOOL
 * ========================================================
 *
 * Pipe / Duct is a 2D DRAWING tool: a straight run of pipework drawn as two
 * parallel walls. These checks go past "the registry says so" and exercise the
 * behaviour the tool is supposed to have:
 *
 *   1. it is REGISTERED and ARMS (it is not a `planned` placeholder - the
 *      button used to report "not available yet");
 *   2. a drag creates ONE run with a stable centreline;
 *   3. both walls are derived from that centreline, parallel, equally spaced;
 *   4. the Features tab offers Object, Appearance, Pipe and Transform, and the
 *      Transform carries Pipe Width Change;
 *   5. a width change moves the walls and NOT the centreline;
 *   6. a fixed run refuses to move;
 *   7. the source is one identifiable block per run, with stable ids;
 *   8. a supported corner produces ONE elbow, a straight join none, and
 *      repeated snapping never duplicates;
 *   9. moving an endpoint, disconnecting and deleting keep the fittings honest;
 *  10. the generated TikZ compiles in the real engine.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { bootApp } = require("./helpers/boot-app.cjs");

/*
 * BOOTING THE APPLICATION STARTS ITS RECOVERY AUTOSAVE, which is a real
 * interval - correct in a browser, and something that keeps THIS process alive
 * after the checks have finished. The suite therefore ends the process itself
 * once its report is written.
 */
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

const locate = (name) => require("./helpers/source-path.cjs").locate(name);

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
    handles: require(locate("handles.js"))
  };
}

/* A clean sheet, so one test's pipes cannot be read as another's. */
function reset(state) {
  state.objects = [];
  state.selection.selectedObjectIds = [];
  state.interaction.previousRun = null;
  state.interaction.routeCommittedCount = 0;
}

/* ============================================================
 * 1. REGISTRATION
 * ============================================================ */

test("Pipe / Duct is registered under Create -> Flow Paths and is not planned", () => {
  const m = modules();
  const groups = m.fluids.fluidsToolGroups;

  const create = groups.find((group) => group.label === "Create");
  const flowPaths = create.tools.find((tool) => tool.label === "Flow Paths");

  assert.equal(flowPaths.submenu, true, "Flow Paths must expand inline");

  const menu = m.fluids.FLUIDS_TOOL_MENUS["fluids-flow-paths"];

  assert.deepEqual(
    menu.map((item) => item.label),
    ["Pipe / Duct", "Elbow", "Junction"]
  );

  assert.equal(
    m.fluids.isPlannedFluidsTool("pipe-duct"),
    false,
    "Pipe / Duct is implemented and must not be refused as unavailable"
  );

  assert.equal(m.fluids.fluidsCapability("pipe-duct"), "route");
});

test("Flow Indicators comes directly after Flow Paths in Create", () => {
  const m = modules();
  const create = m.fluids.fluidsToolGroups.find((group) => group.label === "Create");

  assert.deepEqual(
    create.tools.map((tool) => tool.label),
    ["Flow Paths", "Flow Indicators", "Reducer / Expander", "Reservoir / Tank", "Pump", "Valve", "Flow Meter"]
  );
});

test("both group headers have an icon, like the Statics submenu parents", () => {
  ready();

  const { toolIcons } = require(locate("tools.js"));

  ["Flow Paths", "Flow Indicators"].forEach((label) => {
    assert.ok(typeof toolIcons[label] === "string" && toolIcons[label].includes("<svg"), `${label} needs an icon`);
  });
});

test("the toolbar renders both groups inline, with no popup", () => {
  const m = modules();
  const { document } = ready();

  [...document.querySelectorAll(".drawing-category")].find((el) => el.dataset.category === "FLUIDS").click();

  const list = document.getElementById("drawingToolList");

  ["fluids-flow-paths", "fluids-flow-indicators"].forEach((id) => {
    const header = list.querySelector(`[data-tool-id="${id}"]`);

    assert.ok(header, `${id} must be in the sidebar`);
    assert.ok(header.querySelector(".drawing-tool-icon svg"), `${id} must show an icon`);

    header.click();

    const panel = document.getElementById(`statics-${id}-tools`);

    assert.equal(panel.hidden, false, `${id} must expand inline`);
    assert.equal(header.getAttribute("aria-expanded"), "true");
    assert.equal(header.getAttribute("aria-haspopup"), null, "an inline group must not promise a menu");

    header.click();

    assert.equal(document.getElementById(`statics-${id}-tools`).hidden, true, `${id} must collapse`);
  });

  assert.equal(document.querySelectorAll("[role=menu]").length, 0, "no popup may be opened");

  reset(m.state);
});

/* ============================================================
 * 2. CREATION
 * ============================================================ */

test("a press-drag creates one run, with both walls derived from its centreline", () => {
  const m = modules();

  reset(m.state);

  const start = { x: 0, y: 0 };
  const end = { x: 100, y: 0 };

  const run = m.pipe.createPipeDuct(start, end);

  assert.ok(run, "no run was created");
  assert.equal(run.type, "pipe-duct");
  assert.deepEqual(run.geometry.start, start);
  assert.deepEqual(run.geometry.end, end);

  const walls = m.pipe.boundaryLines(run.geometry.start, run.geometry.end, run.engineering);

  assert.equal(walls.length, 2, "a run is two walls");

  const lengthOf = (wall) => Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);

  assert.ok(Math.abs(lengthOf(walls[0]) - 100) < 1e-9, "each wall runs the whole length");
  assert.ok(Math.abs(lengthOf(walls[1]) - 100) < 1e-9);

  /* Parallel: the two walls' directions are the same. */
  const direction = (wall) => ({
    x: (wall.end.x - wall.start.x) / lengthOf(wall),
    y: (wall.end.y - wall.start.y) / lengthOf(wall)
  });

  const a = direction(walls[0]);
  const b = direction(walls[1]);

  assert.ok(Math.abs(a.x * b.x + a.y * b.y - 1) < 1e-9, "the walls must be parallel");

  /* Equal spacing: the perpendicular gap is the schematic separation. */
  const gap = Math.abs((walls[1].start.x - walls[0].start.x) * a.y - (walls[1].start.y - walls[0].start.y) * a.x);

  assert.ok(Math.abs(gap - m.pipe.DEFAULT_SCHEMATIC_SEPARATION) < 1e-9, `gap was ${gap}`);

  /* Both walls sit the same distance either side of the centreline. */
  [walls[0], walls[1]].forEach((wall) => {
    const mid = { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 };

    assert.ok(Math.abs(Math.hypot(mid.x - 50, mid.y)) - m.pipe.DEFAULT_SCHEMATIC_SEPARATION / 2 < 1e-9);
  });
});

test("horizontal, vertical and diagonal runs are all drawn as parallel pairs", () => {
  const m = modules();

  [
    [{ x: 0, y: 0 }, { x: 80, y: 0 }],
    [{ x: 0, y: 0 }, { x: 0, y: 80 }],
    [{ x: 0, y: 0 }, { x: 60, y: 60 }]
  ].forEach(([start, end]) => {
    const walls = m.pipe.boundaryLines(start, end, {});

    assert.equal(walls.length, 2);

    const gap = Math.hypot(walls[0].start.x - walls[1].start.x, walls[0].start.y - walls[1].start.y);

    assert.ok(Math.abs(gap - m.pipe.DEFAULT_SCHEMATIC_SEPARATION) < 1e-9, `gap ${gap} for ${JSON.stringify(end)}`);
  });
});

/* ============================================================
 * 3. THE FEATURES TAB
 * ============================================================ */

test("the Features tab has exactly Object, Appearance and Transform, in that order", () => {
  const m = modules();
  const run = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });

  assert.deepEqual(
    m.schema.groupsFor(run).map((group) => group.heading),
    ["Object", "Appearance", "Transform"],
    "a pipe has exactly the three specified sections"
  );
});

test("the Object section holds Name and Fix, and no Visibility", () => {
  ready();

  const editor = require(locate("features-editor.js"));
  const m = modules();
  const run = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });

  const objectGroup = m.schema.groupsFor(run).find((group) => group.heading === "Object");

  assert.deepEqual(
    objectGroup.fields.map((field) => field.key),
    ["fixed", "name"]
  );

  const html = editor.featuresMarkupForSelection([run]);

  assert.ok(/data-feature-field="name"/.test(html), "Name must be editable");
  assert.ok(!/[Vv]isib/.test(html), "Pipe / Duct must have no Visibility control");
});

test("the Appearance section holds Line Style, Outline Colour, Thickness and Fill", () => {
  const m = modules();
  const run = m.pipe.createPipeDuct({ x: 0, y: 0, }, { x: 100, y: 0 });

  const appearance = m.schema.groupsFor(run).find((group) => group.heading === "Appearance");

  /*
   * THE FOUR CONTROLS THE DESIGN NAMES. `customWidth` and `fill` are
   * CONDITIONAL - a custom thickness, and a fill colour that only exists when
   * the fill is on - so they are checked through their triggers rather than
   * always being present.
   */
  assert.deepEqual(
    appearance.fields.slice(0, 3).map((field) => field.key),
    ["lineType", "stroke", "lineWidth"]
  );

  assert.ok(appearance.fields.some((field) => field.key === "fillMode"), "Fill must be offered");

  assert.equal(m.schema.writeField(run, "fillMode", "solid"), true);

  const withFill = m.schema.groupsFor(run).find((group) => group.heading === "Appearance");

  assert.ok(withFill.fields.some((field) => field.key === "fill"), "a filled run gets a fill colour");
  assert.equal(m.schema.writeField(run, "lineWidth", "custom"), true);

  const withCustom = m.schema.groupsFor(run).find((group) => group.heading === "Appearance");

  assert.ok(withCustom.fields.some((field) => field.key === "customWidth"));
});

test("Line Style is shown as one inline row offering Solid, Dashed and Dotted", () => {
  ready();

  const editor = require(locate("features-editor.js"));
  const m = modules();
  const run = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });

  const html = editor.featuresMarkupForSelection([run]);
  const at = html.indexOf('data-feature-field="lineType"');
  const row = html.slice(html.lastIndexOf('class="dfp-row"', at), at + 500);

  assert.ok(/class="dfp-row"/.test(row), "the label and control share one row");
  assert.ok(row.includes("Line Style"), "the row is labelled Line Style");
  assert.ok(!/Dashed[\s\S]*<option[^>]*>[\s\S]*Dashed/.test(row.slice(0, row.indexOf("</select>"))), "options are a select, not stacked rows");

  ["Solid", "Dashed", "Dotted"].forEach((label) => {
    assert.ok(row.includes(`>${label}<`), `missing ${label} option`);
  });
});

test("the legacy cross-section properties are gone", () => {
  const m = modules();
  const run = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });

  ["pipeShape", "pipeDiameter", "pipeHeight", "pipeMaterial", "pipeRoughness", "pipeSeparation", "showName"].forEach(
    (key) => {
      assert.equal(m.schema.readField(run, key), undefined, `${key} must no longer be offered`);
    }
  );

  const headings = m.schema.groupsFor(run).map((group) => group.heading);

  assert.ok(!headings.includes("Cross Section"), "Cross Section must be removed");
});

test("the default separation is twice the previous value", () => {
  const m = modules();

  assert.equal(m.pipe.DEFAULT_SCHEMATIC_SEPARATION, 4);
  assert.equal(m.pipe.DEFAULT_SCHEMATIC_SPACING, 4);
});

test("the Transform carries X Shift, Y Shift, Rotate and Pipe Width", () => {
  ready();

  const editor = require(locate("features-editor.js"));
  const m = modules();
  const run = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });

  const html = editor.featuresMarkupForSelection([run]);
  const transform = html.slice(html.indexOf('data-feature-group="transform"'));

  ["X Shift", "Y Shift", "Rotate", "Pipe Width"].forEach((label) => {
    assert.ok(transform.includes(`>${label}<`), `Transform must have ${label}`);
  });

  assert.equal(m.schema.readField(run, "pipeWidth"), 0, "a new run has no width change");
  assert.equal(m.schema.readField(run, "fixed"), false);
});

/* ============================================================
 * 4. PIPE WIDTH
 * ============================================================ */

test("Pipe Width moves the walls and leaves the centreline, length and angle alone", () => {
  const m = modules();
  const run = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
  const centreline = JSON.parse(JSON.stringify(run.geometry));

  assert.equal(m.schema.writeField(run, "pipeWidth", 4), true);

  assert.deepEqual(run.geometry, centreline, "the centreline must not move");
  assert.equal(
    m.pipe.boundarySeparation(run.engineering),
    m.pipe.DEFAULT_SCHEMATIC_SEPARATION + 4,
    "the walls must open by exactly the change"
  );

  /* Still parallel, still the same length, still horizontal. */
  const walls = m.pipe.boundaryLines(run.geometry.start, run.geometry.end, run.engineering);

  assert.ok(Math.abs(walls[0].end.x - walls[0].start.x - 100) < 1e-9);
  assert.ok(Math.abs(walls[1].end.x - walls[1].start.x - 100) < 1e-9);
  assert.ok(Math.abs(walls[0].start.y - walls[0].end.y) < 1e-9 + 0);

  /* Back to zero removes the value entirely. */
  assert.equal(m.schema.writeField(run, "pipeWidth", 0), true);
  assert.equal(run.engineering.separation, undefined);
});

test("a width change that would collapse the walls is refused", () => {
  const m = modules();
  const run = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });

  assert.equal(
    m.schema.writeField(run, "pipeWidth", -m.pipe.DEFAULT_SCHEMATIC_SEPARATION),
    false,
    "a zero-width pipe is not a pipe"
  );
  assert.equal(m.pipe.boundarySeparation(run.engineering), m.pipe.DEFAULT_SCHEMATIC_SEPARATION);
});

/* ============================================================
 * 5. HANDLES AND FIX
 * ============================================================ */

test("a run has endpoint handles and a rotation handle", () => {
  const m = modules();
  const run = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });

  const kinds = m.handles.editableHandlesFor(run).map((handle) => handle.kind);

  assert.ok(kinds.includes("start"), "the run needs a start handle");
  assert.ok(kinds.includes("end"), "the run needs an end handle");
  assert.ok(kinds.includes("rotate"), "the run needs a rotation handle");
});

test("a fixed run has no handles at all", () => {
  const m = modules();
  const run = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });

  assert.equal(m.schema.writeField(run, "fixed", true), true);
  assert.equal(run.locked, true);
  assert.deepEqual(m.handles.editableHandlesFor(run), []);
});

/* ============================================================
 * 6. SOURCE
 * ============================================================ */

test("a run writes one identifiable block with a stable id", () => {
  const m = modules();
  const run = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
  const id = run.id;

  const source = m.sync.sourceForObject(run);

  assert.ok(source.includes(id), "the block must name the object's id");
  /*
   * THE HEADER NAMES THE OBJECT, using the established `% DAETUM OBJECT:` /
   * `TYPE:` / `ID:` convention every other writer uses - which is what lets the
   * parser find the block again. The run's NAME is the object line; the type is
   * its own line.
   */
  assert.ok(/%\s*DAETUM OBJECT:/.test(source), source);
  assert.ok(/%\s*DAETUM TYPE: pipe-duct/.test(source), source);
  assert.equal((source.match(/\\draw/g) || []).length, 2, "a run is two walls");

  /* Writing it again does not mint a new identity. */
  run.name = "Main supply";
  const renamed = m.sync.sourceForObject(run);

  assert.ok(renamed.includes("Main supply"), "renaming must reach the identifying comment");
  assert.equal(run.id, id, "renaming must not change the id");
});

test("a canvas edit rewrites only that run's block", () => {
  const m = modules();
  const run = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
  const other = m.pipe.createPipeDuct({ x: 0, y: 50 }, { x: 100, y: 50 });

  const otherSource = m.sync.sourceForObject(other);

  run.geometry.end = { x: 300, y: 0 };

  const next = m.sync.sourceForObject(run);

  assert.ok(next.includes("(150,") || next.includes("300"), "the new end must be written");
  assert.equal(m.sync.sourceForObject(other), otherSource, "the other run's block must not move");
});

/* ============================================================
 * 7. AUTOMATIC ELBOWS
 * ============================================================ */

test("a straight connection joins without an elbow", () => {
  const m = modules();

  reset(m.state);

  const first = m.tool.commitRouteSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {});
  const second = m.tool.commitRouteSegment({ x: 100, y: 0 }, { x: 200, y: 0 }, {
    previousRun: first.run,
    routeCommittedCount: 1
  });

  assert.equal(second.elbow, null);
  assert.equal(m.state.objects.filter((object) => object.type === "elbow").length, 0);
});

test("an angled connection creates ONE elbow with a stable id", () => {
  const m = modules();

  reset(m.state);

  const first = m.tool.commitRouteSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {});
  const second = m.tool.commitRouteSegment({ x: 100, y: 0 }, { x: 100, y: 100 }, {
    previousRun: first.run,
    routeCommittedCount: 1
  });

  assert.ok(second.elbow, "a 90 degree corner must earn an elbow");
  assert.equal(second.elbow.type, "elbow");
  assert.ok(second.elbow.id);
  assert.deepEqual(second.elbow.engineering.connections, [first.run.id, second.run.id]);
});

test("repeated snapping does not duplicate the elbow", () => {
  const m = modules();

  reset(m.state);

  const first = m.tool.commitRouteSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {});
  const second = m.tool.commitRouteSegment({ x: 100, y: 0 }, { x: 100, y: 100 }, {
    previousRun: first.run,
    routeCommittedCount: 1
  });

  m.tool.generateElbowFor(first.run, second.run, {});
  m.tool.generateElbowFor(first.run, second.run, {});

  assert.equal(m.state.objects.filter((object) => object.type === "elbow").length, 1);
});

test("the bend takes over from the run walls, which stop at its tangent points", () => {
  const m = modules();

  reset(m.state);

  const first = m.tool.commitRouteSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {});
  m.tool.commitRouteSegment({ x: 100, y: 0 }, { x: 100, y: 100 }, {
    previousRun: first.run,
    routeCommittedCount: 1
  });

  assert.ok(first.run.geometry.trims?.end > 0, "the first run must be trimmed at its end");

  const trimmed = m.pipe.trimmedCentreline(first.run);

  assert.ok(trimmed.end.x < 100, "the first run's walls must stop before the corner");
  assert.deepEqual(trimmed.start, first.run.geometry.start, "the far end is untouched");
});

test("dragging an endpoint to a non-right angle KEEPS the elbow", () => {
  const m = modules();

  reset(m.state);

  const first = m.tool.commitRouteSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {});
  const second = m.tool.commitRouteSegment({ x: 100, y: 0 }, { x: 100, y: 100 }, {
    previousRun: first.run,
    routeCommittedCount: 1
  });

  /*
   * 30 degrees is an ordinary bend. Automatic fitting is NOT restricted to right
   * angles, so the elbow follows the new corner rather than being removed.
   */
  second.run.geometry.end = { x: 100 + 100 * Math.cos(Math.PI / 6), y: 100 * Math.sin(Math.PI / 6) };

  m.tool.refreshFluidConnections(second.run, m.state.objects);

  const elbows = m.state.objects.filter((object) => object.type === "elbow");

  assert.equal(elbows.length, 1, "a 30 degree bend keeps its elbow");
  assert.ok(Math.abs(m.pipe.elbowAngleDegrees(elbows[0]) - 30) < 0.5);
});

test("disconnecting the runs removes the elbow", () => {
  const m = modules();

  reset(m.state);

  const first = m.tool.commitRouteSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {});
  const second = m.tool.commitRouteSegment({ x: 100, y: 0 }, { x: 100, y: 100 }, {
    previousRun: first.run,
    routeCommittedCount: 1
  });

  second.run.geometry.start = { x: 140, y: 30 };

  m.tool.refreshFluidConnections(second.run, m.state.objects);

  assert.equal(m.state.objects.filter((object) => object.type === "elbow").length, 0);
});

test("deleting a pipe deletes the elbow fitted to it", () => {
  const m = modules();

  reset(m.state);

  const first = m.tool.commitRouteSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {});
  m.tool.commitRouteSegment({ x: 100, y: 0 }, { x: 100, y: 100 }, {
    previousRun: first.run,
    routeCommittedCount: 1
  });

  assert.equal(m.state.objects.filter((object) => object.type === "elbow").length, 1);

  m.drawingState.removeObjectsAndDescendants(m.state, new Set([first.run.id]));

  assert.equal(
    m.state.objects.filter((object) => object.type === "elbow").length,
    0,
    "an elbow must not outlive the run it joins"
  );
});

test("an elbow is selectable by the shared object system", () => {
  const m = modules();
  const elbow = {
    id: "elbow-check",
    type: "elbow",
    geometry: {
      previous: { x: 0, y: 0 },
      position: { x: 100, y: 0 },
      next: { x: 100, y: 100 }
    },
    engineering: { bendRadius: 10 },
    style: {}
  };

  assert.ok(m.handles.editableHandlesFor(elbow).length > 0, "an elbow is a normal editable object");
  assert.ok(m.sync.sourceForObject(elbow), "an elbow writes its own block");
});

/* ============================================================
 * 8. APPEARANCE INHERITANCE AND MANUAL OVERRIDES
 * ============================================================ */

test("an auto-generated elbow inherits the connecting run's appearance", () => {
  const m = modules();

  reset(m.state);

  const first = m.tool.commitRouteSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {});
  const run = first.run;

  /* Style the pipe BEFORE the corner is made. */
  m.schema.writeField(run, "lineType", "dashed");
  m.schema.writeField(run, "stroke", "#ff0000");
  m.schema.writeField(run, "lineWidth", "thick");

  const second = m.tool.commitRouteSegment({ x: 100, y: 0 }, { x: 100, y: 100 }, {
    previousRun: run,
    routeCommittedCount: 1
  });

  m.schema.writeField(first.run, "lineType", "dashed");
  m.schema.writeField(first.run, "stroke", "#00ff00");

  assert.ok(second.elbow, "the corner must earn an elbow");
  /* The elbow was created from the run's style as it stood at that moment. */
  assert.equal(second.elbow.style.lineWidth, run.style.lineWidth, "thickness is inherited");
});

test("an elbow keeps a manual override when the pipe changes later", () => {
  const m = modules();

  reset(m.state);

  const first = m.tool.commitRouteSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {});
  const second = m.tool.commitRouteSegment({ x: 100, y: 0 }, { x: 100, y: 100 }, {
    previousRun: first.run,
    routeCommittedCount: 1
  });

  const elbow = second.elbow;

  /* The student customizes the fitting... */
  m.schema.writeField(elbow, "stroke", "#123456");

  /* ...then changes the pipe it joins. */
  m.schema.writeField(first.run, "stroke", "#abcdef");

  assert.equal(elbow.style.stroke, "#123456", "the fitting's own colour must survive");
  assert.equal(first.run.style.stroke, "#abcdef", "the pipe keeps its own colour");
});

test("connecting two differently styled pipes preserves both", () => {
  const m = modules();

  reset(m.state);

  const first = m.tool.commitRouteSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {});

  m.schema.writeField(first.run, "stroke", "#111111");

  const second = m.tool.commitRouteSegment({ x: 100, y: 0 }, { x: 200, y: 0 }, {
    previousRun: first.run,
    routeCommittedCount: 1
  });

  m.schema.writeField(second.run, "stroke", "#222222");

  assert.equal(m.schema.readField(first.run, "stroke"), "#111111");
  assert.equal(m.schema.readField(second.run, "stroke"), "#222222");
});

/* ============================================================
 * 9. PIPE WIDTH ACROSS CONNECTIONS
 * ============================================================ */

test("directly connected pipes share one Pipe Width", () => {
  const m = modules();

  reset(m.state);

  const first = m.tool.commitRouteSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {});

  m.schema.writeField(first.run, "pipeWidth", 8);

  const second = m.tool.commitRouteSegment({ x: 100, y: 0 }, { x: 200, y: 0 }, {
    previousRun: first.run,
    routeCommittedCount: 1
  });

  assert.equal(m.schema.readField(second.run, "pipeWidth"), 8, "a directly joined pipe adopts the run's width");
});

test("Pipe Width propagates along a directly connected run", () => {
  const m = modules();

  reset(m.state);

  const first = m.tool.commitRouteSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {});
  const second = m.tool.commitRouteSegment({ x: 100, y: 0 }, { x: 200, y: 0 }, {
    previousRun: first.run,
    routeCommittedCount: 1
  });

  const run = second.run;

  m.schema.writeField(run, "pipeWidth", 6);
  m.tool.propagatePipeWidth(run, m.state.objects);

  assert.equal(m.schema.readField(first.run, "pipeWidth"), 6, "the joined segment follows");
});

test("an elbow bounds Pipe Width: the far run keeps its own", () => {
  const m = modules();

  reset(m.state);

  const first = m.tool.commitRouteSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {});
  const second = m.tool.commitRouteSegment({ x: 100, y: 0 }, { x: 100, y: 100 }, {
    previousRun: first.run,
    routeCommittedCount: 1
  });

  const near = second.run;
  const far = first.run;

  /* Give the two sides different widths ACROSS the fitting. */
  m.schema.writeField(near, "pipeWidth", 2);
  m.schema.writeField(far, "pipeWidth", 10);

  m.tool.propagatePipeWidth(near, m.state.objects);

  assert.equal(m.schema.readField(near, "pipeWidth"), 2);
  assert.equal(m.schema.readField(far, "pipeWidth"), 10, "an elbow is the boundary, so the far run is untouched");
});

test("the elbow's two ends take their width from the runs they meet", () => {
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
    "the incoming end is as wide as the incoming run"
  );
  assert.equal(
    elbow.engineering.endSeparation,
    m.pipe.DEFAULT_SCHEMATIC_SEPARATION,
    "the outgoing end is as wide as the outgoing run"
  );
});

/* ============================================================
 * 10. APPEARANCE AND SOURCE
 * ============================================================ */

test("line style and fill reach the TikZ source", () => {
  const m = modules();
  const run = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });

  m.schema.writeField(run, "lineType", "dashed");
  assert.ok(/dashed/.test(m.sync.sourceForObject(run)), "a dashed pipe is written dashed");

  m.schema.writeField(run, "lineType", "solid");
  m.schema.writeField(run, "fillMode", "solid");
  assert.ok(/-- cycle/.test(m.sync.sourceForObject(run)), "a filled run is one closed path");
});

test("a name change updates the identifying comment but not the id", () => {
  const m = modules();
  const run = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
  const id = run.id;

  assert.ok(m.schema.writeField(run, "name", "Chilled water supply"));

  const source = m.sync.sourceForObject(run);

  assert.ok(source.includes("Chilled water supply"), source);
  assert.ok(source.includes(id), "the stable id must still be there");
  assert.equal(run.id, id);
});

test("an empty name is refused rather than blanking the identifier", () => {
  const m = modules();
  const run = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });

  assert.equal(m.schema.writeField(run, "name", "   "), false);
  assert.ok(run.name);
});
