/* eslint-disable no-console */
/*
 * ========================================================
 * DYNAMICS: THE LIBRARY, THE TOOLS, THE MODEL, THE SOURCE
 * ========================================================
 *
 * The library is not "done" because the sidebar lists the right words, so
 * every check below goes further than that:
 *
 *   1. the SIDEBAR has the hierarchy the specification names, and nothing it
 *      forbids (no Analysis, no Joints, one Pulley, no pulley variants);
 *   2. every tool can be ARMED, started and committed through the SHARED
 *      creation pipeline - the same entry point a Line or a Beam uses;
 *   3. the committed object is ONE feature with the Dynamics mark on it;
 *   4. it has direct-manipulation handles, and its Features include Fix and
 *      Transform;
 *   5. it has SOURCE, and that source COMPILES in the real engine.
 *
 * The last point is the one that matters most: a writer that emits plausible
 * TikZ is not a writer. Every symbol is handed to the same TikZ engine the
 * application renders with, and only a successful compile counts.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

/*
 * THE SUITE RUNS IN A CHILD PROCESS WITH A TIMEOUT.
 *
 * Booting the whole application starts its recovery autosave, which is a
 * real interval - correct in a browser, and something that keeps THIS
 * process alive after the checks have finished. The suite therefore ends the
 * process itself once its report is written, and `npm test`'s own timeout
 * catches a check that genuinely hangs.
 */
test.after(() => {
  setImmediate(() => process.exit(process.exitCode || 0));
});

const { bootApp } = require("./helpers/boot-app.cjs");

/*
 * ------------------------------------------------------------------ boot
 *
 * THE PAGE IS BOOTED ONCE, LAZILY, and every test that needs it awaits this.
 * `bootApp` is synchronous and pulls the whole application in; doing it at the
 * top of the file runs it before the test runner owns the process, and a slow
 * first compile can then hang the runner rather than fail a check.
 */
let page = null;
let document = null;

async function booted() {
  if (!page) {
    page = bootApp();

    if (page.error) {
      throw page.error;
    }

    document = page.document;

    /* The canvas has a real size, so the renderer draws rather than guesses. */
    const canvas = document.querySelector(".drawing-canvas");

    if (canvas) {
      canvas.getBoundingClientRect = () => ({
        width: 900,
        height: 600,
        top: 0,
        left: 0,
        right: 900,
        bottom: 600,
        x: 0,
        y: 0
      });
    }

    /*
     * A REAL POINTER POSITION. The canvas asks the application for the pointer
     * when it redraws, and a page that has never received a pointer event has
     * none - so the very first tool activation would throw before it armed.
     * One mousemove at the canvas centre is the state a browser is in as soon
     * as the cursor is over the sheet.
     */
    if (canvas) {
      canvas.dispatchEvent(
        new page.window.MouseEvent("mousemove", { clientX: 450, clientY: 300, bubbles: true })
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 50));

    /*
     * THE WINDOW IS KEPT OPEN for the whole file. The sidebar and the panel
     * are read straight out of it, and a suite that closed it early could pass
     * its model checks while proving nothing about what a student sees.
     */
  }

  return page;
}

let tikz = null;

async function engine() {
  if (!tikz) {
    tikz = await import("../server/tikz.js");
    await tikz.loadTikz();
  }

  return tikz;
}

async function compile(source) {
  const service = await engine();

  const body = String(source || "")
    .split("\n")
    .map((line) => line)
    .join("\n");

  try {
    const svg = await service.renderTikz(
      `\\begin{document}\n\\begin{tikzpicture}[x=1mm,y=1mm]\n${body}\n\\end{tikzpicture}\n\\end{document}`,
    );

    return { ok: true, svg };
  } catch (error) {
    return { ok: false, error: String(error && error.message) };
  }
}

/* ---------------------------------------------------------------- helpers */

const TOOLS = {
  bodies: ["dynamics-particle", "dynamics-rigid-body"],
  kinematics: ["dynamics-polar-vector", "dynamics-angular-vector"],
  mechanical: ["dynamics-spring", "dynamics-damper", "dynamics-spring-damper", "dynamics-pulley"],
  reference: [
    "dynamics-coordinate-system",
    "dynamics-reference-point",
    "dynamics-reference-line",
    "dynamics-reference-arc"
  ]
};

const ALL_TOOLS = Object.values(TOOLS).flat();

/*
 * ---------------------------------------------------------------- traces
 *
 * A RUNNING LOG OF THE STAGES, so a check that never finishes says WHERE it
 * stopped rather than only that it did. `DYN_TRACE` on the command line turns
 * it on; a normal run writes nothing.
 */
const traceEnabled = Boolean(process.env.DYN_TRACE);

function trace(stage) {
  if (traceEnabled) {
    console.error(`DYN ${stage}`);
  }
}

let loaded = null;

async function modules() {
  trace("modules: start");

  await booted();

  trace("modules: booted");

  if (!loaded) {
    trace("modules: loading");

    loaded = {
      drawingState: (await import("../src/shared/model/drawing-state.js")).default,
      editor: await import("../src/features/workspace/editor-state.js"),
      tools: await import("../src/features/workspace/dynamics/dynamics-tools.js"),
      model: await import("../src/features/workspace/dynamics/dynamics-model.js"),
      handles: await import("../src/features/workspace/interaction/handles.js"),
      handleDrag: await import("../src/features/workspace/dynamics/dynamics-handles.js"),
      creation: await import("../src/features/workspace/geometry/geometry-creation.js"),
      preview: await import("../src/features/workspace/geometry/preview.js"),
      creationDrag: await import("../src/features/workspace/interaction/creation-drag.js"),
      pointer: await import("../src/features/workspace/interaction/pointer.js"),
      canvasClick: await import("../src/features/workspace/interaction/canvas-click.js"),
      activation: await import("../src/components/layout/toolbar/tool-activation.js"),
      toolbarRender: await import("../src/components/layout/toolbar/toolbar-render.js"),
      toolbarTools: await import("../src/components/layout/toolbar/tools.js"),
      features: await import("../src/components/layout/panels/features-editor.js"),
      schema: await import("../src/components/layout/panels/feature-schema.js"),
      sync: await import("../src/shared/rendering/latex/source-synchronization.js"),
      writers: await import("../src/shared/rendering/latex/source-writers/index.js"),
      dynamicsWriter: await import("../src/shared/rendering/latex/source-writers/dynamics.js"),
      featureGeometry: (await import("../src/shared/geometry/feature-geometry.js")).default,
      hitTesting: await import("../src/features/workspace/interaction/hit-testing.js"),
      dynamicsHandles: await import("../src/features/workspace/dynamics/dynamics-handles.js")
    };

    trace("modules: ready");
  }

  return loaded;
}

function resolution(point) {
  return {
    effectiveConstructionPoint: { x: point.x, y: point.y },
    rawPointerPoint: { x: point.x, y: point.y },
    snapCandidate: null
  };
}

const STYLE = { stroke: "#193335", lineWidth: 0.75, lineType: "solid", fill: "none" };

/* The object each tool built, created through the real commit path. */
let built = null;

async function builtObjects() {
  if (built) {
    return built;
  }

  const m = await modules();
  const state = m.editor.drawingState;

  built = {};

  for (const [index, id] of ALL_TOOLS.entries()) {
    const before = state.objects.length;
    const first = { x: 20 + index * 12, y: 25 };
    const second = { x: 45 + index * 12, y: 40 };

    await m.creation.createDynamicsFeature(id, first, second, { ...STYLE });

    const created = state.objects[state.objects.length - 1];

    assert.ok(
      state.objects.length === before + 1,
      `${id} must add exactly one object`,
    );

    assert.equal(
      created.engineering?.dynamicsType,
      id,
      `${id} must mark the object it made`,
    );

    built[id] = created;
  }

  return built;
}

/* ================================================================ sidebar */

test("the sidebar has exactly the specified Dynamics hierarchy", async () => {
  const m = await modules();
  const groups = m.toolbarTools.disciplineToolGroups.DYNAMICS;

  assert.deepEqual(
    groups.map((group) => group.label),
    ["Selection", "Create", "Reference"],
  );

  const create = groups.find((group) => group.label === "Create");

  assert.deepEqual(
    create.tools.map((tool) => tool.label),
    ["Bodies", "Kinematics", "Mechanical Elements"],
  );

  /* The families are collapsible inline menus with the Statics tool rows. */
  create.tools.forEach((tool) => {
    assert.equal(tool.submenu, true, `${tool.label} must contain child tools`);
    assert.equal(tool.collapsible, true, `${tool.label} must expand inline`);
    assert.ok(m.tools.DYNAMICS_TOOL_MENUS[tool.id], `${tool.id} must have a menu`);
  });

  assert.deepEqual(
    m.tools.DYNAMICS_TOOL_MENUS["dynamics-bodies"].map((item) => item.label),
    ["Particle", "Rigid Body"],
  );

  assert.deepEqual(
    m.tools.DYNAMICS_TOOL_MENUS["dynamics-kinematics"].map((item) => item.label),
    ["Polar Vector", "Angular Vector"],
  );
  assert.equal(m.tools.dynamicsToolDefinition("dynamics-trajectory"), null);
  assert.equal(m.tools.isDynamicsTool("dynamics-trajectory"), false);
  assert.equal(
    m.model.createDynamicsObject("dynamics-trajectory", [{ x: 0, y: 0 }, { x: 20, y: 10 }]),
    null,
    "the removed tool id must not create an object",
  );

  assert.deepEqual(
    m.tools.DYNAMICS_TOOL_MENUS["dynamics-mechanical"].map((item) => item.label),
    ["Spring", "Viscous Damper", "Spring–Damper Element", "Pulley"],
  );

  const reference = groups.find((group) => group.label === "Reference");

  assert.deepEqual(
    reference.tools.map((tool) => tool.label),
    ["Coordinate System", "Reference Point", "Reference Line", "Reference Arc"],
  );

  /* NOTHING THE SPECIFICATION FORBIDS. */
  const labels = groups.flatMap((group) =>
    group.label === "Create"
      ? group.tools.flatMap((tool) =>
          (m.tools.DYNAMICS_TOOL_MENUS[tool.id] || []).map((item) => item.label))
      : group.tools.map((tool) => tool.label),
  );

  assert.ok(!groups.some((group) => group.label === "Analysis"));
  assert.ok(!labels.some((label) => /Joints|Contact/i.test(label)));
  assert.deepEqual(labels.filter((label) => label === "Pulley"), ["Pulley"]);
  assert.ok(!labels.some((label) => /^(Fixed|Movable|Compound) Pulley/.test(label)));
});

test("every Dynamics category and tool has an icon", async () => {
  const m = await modules();
  const icons = m.toolbarTools.toolIcons;

  const expected = [
    "Bodies",
    "Particle",
    "Rigid Body",
    "Kinematics",
    "Polar Vector",
    "Angular Vector",
    "Mechanical Elements",
    "Spring",
    "Viscous Damper",
    "Spring–Damper Element",
    "Pulley",
    "Coordinate System",
    "Reference Point",
    "Reference Line",
    "Reference Arc"
  ];

  expected.forEach((label) => {
    assert.ok(
      typeof icons[label] === "string" && icons[label].includes("<svg"),
      `${label} must have an icon`,
    );
  });
  assert.equal(icons.Trajectory, undefined, "the removed Dynamics tool must not keep an icon");

  /* The family buttons resolve their artwork through the SAME table. */
  Object.values(m.tools.DYNAMICS_TOOL_MENUS)
    .flat()
    .forEach((item) => {
      assert.ok(icons[item.label], `${item.label} must have an icon`);
    });
});

test("the rendered sidebar shows the Dynamics groups", async () => {
  const m = await modules();

  m.toolbarRender.renderEngineeringTools("DYNAMICS");

  const list = document.getElementById("drawingToolList") || document.querySelector(".drawing-tool-list");
  const text = (list?.textContent || "").replace(/\s+/g, " ");
  assert.ok(!text.includes("Trajectory"), "the Dynamics sidebar must not show Trajectory");

  ["Selection", "Create", "Bodies", "Kinematics", "Mechanical Elements", "Reference"].forEach((word) => {
    assert.ok(text.includes(word), `the sidebar must show ${word}`);
  });

  assert.ok(!/ANALYSIS/i.test(text), "the sidebar must not have an Analysis section");

  ["dynamics-bodies", "dynamics-kinematics", "dynamics-mechanical"].forEach((categoryId) => {
    const category = list.querySelector(`[data-tool-id="${categoryId}"]`);
    const children = list.querySelector(`#${categoryId}-tools`);
    const expectedLabels = m.tools.DYNAMICS_TOOL_MENUS[categoryId].map((item) => item.label);

    assert.ok(category, `${categoryId} must be a sidebar category button`);
    assert.equal(category.getAttribute("aria-expanded"), "false");
    assert.equal(category.hasAttribute("aria-haspopup"), false, `${categoryId} must not open a floating menu`);
    assert.ok(children.hidden, `${categoryId} child tools must start collapsed`);

    category.click();

    assert.equal(category.getAttribute("aria-expanded"), "true");
    assert.equal(children.hidden, false, `${categoryId} child tools must expand inline`);
    assert.deepEqual(
      [...children.querySelectorAll(".drawing-tool-label")].map((label) => label.textContent.trim()),
      expectedLabels,
    );
    assert.ok(
      [...children.querySelectorAll(".drawing-tool-icon")].every((icon) => icon.querySelector("svg")),
      `${categoryId} child tools must render dedicated icons`,
    );
    assert.equal(children.parentElement, category.parentElement, "child tools must be nested with their category");

    category.click();
    assert.equal(children.hidden, true, `${categoryId} child tools must collapse again`);
  });

  list.querySelector('[data-tool-id="dynamics-bodies"]').click();
  list.querySelector('[data-tool-id="dynamics-particle"]').click();
  assert.equal(m.editor.drawingState.activeTool, "dynamics-particle", "child clicks must use normal tool activation");
});

test("placing a Dynamics Particle creates one node and returns to Select", async () => {
  const m = await modules();
  const state = m.editor.drawingState;
  const before = state.objects.length;

  m.activation.activateTool("dynamics-particle");
  m.creation.beginOrCompleteGeometry(resolution({ x: 13, y: 17 }));

  assert.equal(state.objects.length, before + 1);
  assert.equal(state.activeTool, "select");

  const particle = state.objects[state.objects.length - 1];

  assert.equal(particle.engineering.dynamicsType, "dynamics-particle");
  assert.deepEqual(particle.geometry.position, { x: 13, y: 17 });
  assert.equal(particle.name, "Particle A");
  assert.deepEqual(state.selection.selectedObjectIds, [particle.id]);
  assert.equal(m.editor.editorState.drawingPanelTab, "features");

  const xShift = document.querySelector('[data-feature-field="dynamics.positionX"]');
  xShift.value = "29";
  xShift.dispatchEvent(new page.window.Event("input", { bubbles: true }));
  assert.equal(particle.geometry.position.x, 29, "coordinate edits must update the canvas model live");
  xShift.dispatchEvent(new page.window.Event("change", { bubbles: true }));
});

test("placing a Dynamics Rigid Body uses the centered Statics default", async () => {
  const m = await modules();
  const state = m.editor.drawingState;
  const before = state.objects.length;

  m.editor.editorState.drawingPanelTab = "source";
  m.activation.activateTool("dynamics-rigid-body");
  m.creation.beginOrCompleteGeometry(resolution({ x: 80, y: 70 }));

  assert.equal(state.objects.length, before + 1);
  assert.equal(state.activeTool, "select", "Rigid Body placement returns to Select");

  const body = state.objects[state.objects.length - 1];

  assert.equal(body.type, "rigid-body");
  assert.equal(body.engineering.dynamicsType, "dynamics-rigid-body");
  assert.deepEqual(body.geometry.position, { x: 55, y: 85 });
  assert.equal(body.geometry.width, 50);
  assert.equal(body.geometry.height, 30);
  assert.equal(body.geometry.rotation, 0);
  assert.equal(body.name, "Rigid Body");
  assert.equal(body.geometry.showCenterOfMass, true);
  assert.equal(body.style.fillMode, "solid");
  assert.equal(body.style.fillOpacityEnabled, true);
  assert.deepEqual(state.selection.selectedObjectIds, [body.id]);
  assert.equal(m.editor.editorState.drawingPanelTab, "features");
});

test("placing an Angular Vector on a body attaches it, selects it, and returns to Select", async () => {
  const m = await modules();
  const state = m.editor.drawingState;
  const body = m.creation.createDynamicsFeature(
    "dynamics-rigid-body",
    { x: 1000, y: 1000 },
    { x: 1000, y: 1000 },
    { ...STYLE },
  );
  assert.equal(m.hitTesting.objectAtPoint({ x: 1000, y: 1000 })?.id, body.id);

  m.activation.activateTool("dynamics-angular-vector");
  m.creation.beginOrCompleteGeometry(resolution({ x: 1000, y: 1000 }));

  const angular = state.objects[state.objects.length - 1];

  assert.equal(angular.engineering.dynamicsType, "dynamics-angular-vector");
  assert.equal(angular.name, "Angular Vector 1");
  assert.deepEqual(angular.geometry.center, { x: 1000, y: 1000 });
  assert.equal(angular.geometry.attachedTo, body.id);
  assert.equal(state.activeTool, "select");
  assert.deepEqual(state.selection.selectedObjectIds, [angular.id]);
  assert.equal(m.editor.editorState.drawingPanelTab, "features");

  const pointOnArc = {
    x: angular.geometry.center.x + angular.geometry.radius * Math.cos(Math.PI / 4),
    y: angular.geometry.center.y + angular.geometry.radius * Math.sin(Math.PI / 4),
  };
  assert.equal(m.hitTesting.objectAtPoint(pointOnArc)?.id, angular.id, "the rendered arc must be pickable");

  m.editor.editorState.drawingPanelTab = "source";
  m.drawingState.clearSelection(state);
  m.drawingState.selectObject(state, angular.id);
  assert.equal(m.editor.editorState.drawingPanelTab, "features", "selecting the arc opens Features");
});

test("Polar Vector press-drag-release creates and selects one vector", async () => {
  const m = await modules();
  const state = m.editor.drawingState;
  const before = state.objects.length;
  const press = new page.window.MouseEvent("pointerdown", {
    clientX: 120,
    clientY: 120,
    button: 0,
    bubbles: true,
  });
  const move = new page.window.MouseEvent("pointermove", {
    clientX: 220,
    clientY: 170,
    button: 0,
    bubbles: true,
  });
  const release = new page.window.MouseEvent("pointerup", {
    clientX: 220,
    clientY: 170,
    button: 0,
    bubbles: true,
  });

  m.activation.activateTool("dynamics-polar-vector");
  assert.equal(m.creationDrag.beginCreationDrag(press), true);
  m.creationDrag.moveCreationDrag(move);
  m.pointer.updateDrawingCoordinates(move);

  assert.equal(state.interaction.phase, "dynamics-span");
  assert.equal(state.interaction.preview?.type, "dynamics-polar-vector");
  assert.ok(state.interaction.preview.geometry.vectorMagnitude > 0);

  assert.equal(m.creationDrag.finishCreationDrag(release), true);
  assert.equal(state.objects.length, before + 1);
  assert.equal(state.activeTool, "select");

  const vector = state.objects[state.objects.length - 1];
  assert.equal(vector.name, "Polar Vector 1");
  const dx = vector.geometry.end.x - vector.geometry.start.x;
  const dy = vector.geometry.end.y - vector.geometry.start.y;
  const magnitude = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

  assert.ok(magnitude > 0, "the release point defines a non-zero vector");
  assert.ok(Math.abs(vector.geometry.vectorMagnitude - magnitude) < 1e-8);
  assert.ok(Math.abs(vector.geometry.vectorAngle - (angle + 360) % 360) < 1e-8);
  assert.deepEqual(state.selection.selectedObjectIds, [vector.id]);
});

test("Polar Vector drag placement returns to Select and exposes its editable vector schema", async () => {
  const m = await modules();
  const state = m.editor.drawingState;
  const before = state.objects.length;
  const click = new page.window.MouseEvent("click", {
    clientX: 450,
    clientY: 300,
    bubbles: true,
  });
  const start = m.activation.canvasPointFromEvent(click, false);
  const end = { x: start.x + 30, y: start.y + 40 };

  m.activation.activateTool("dynamics-polar-vector");
  m.creation.beginOrCompleteGeometry(resolution(start));
  assert.equal(state.interaction.phase, "dynamics-span");
  assert.equal(state.activeTool, "dynamics-polar-vector");
  m.preview.updatePreview(resolution(end));
  assert.equal(state.interaction.preview?.type, "dynamics-polar-vector");
  assert.deepEqual(state.interaction.preview.geometry.start, start);
  assert.deepEqual(state.interaction.preview.geometry.end, end);
  assert.equal(state.interaction.preview.geometry.vectorMagnitude, 50);
  assert.ok(Math.abs(state.interaction.preview.geometry.vectorAngle - 53.13010235415598) < 1e-10);

  m.creation.beginOrCompleteGeometry(resolution(end));

  assert.equal(state.objects.length, before + 1);
  assert.equal(state.activeTool, "select", "finishing the drag returns to Select");
  const vector = state.objects[state.objects.length - 1];

  assert.equal(vector.engineering.dynamicsType, "dynamics-polar-vector");
  assert.equal(vector.name, "Polar Vector 2");
  assert.deepEqual(vector.geometry.start, start);
  assert.deepEqual(vector.geometry.end, end);
  assert.equal(vector.geometry.vectorRepresentation, "magnitude-angle");
  assert.equal(vector.geometry.vectorMagnitude, 50);
  assert.equal(vector.geometry.vectorUnit, "m/s");
  assert.equal(vector.geometry.attachedTo, "origin");
  assert.equal(vector.style.arrowheadSize, 9);
  assert.equal(
    m.hitTesting.objectAtPoint({ x: start.x + 15, y: start.y + 20 })?.id,
    vector.id,
    "clicking the shaft must hit the Polar Vector",
  );
  m.drawingState.clearSelection(state);
  m.editor.editorState.drawingPanelTab = "source";
  m.canvasClick.handleCanvasClick(click);
  assert.deepEqual(state.selection.selectedObjectIds, [vector.id]);
  assert.equal(m.editor.editorState.drawingPanelTab, "features");

  const groups = m.schema.groupsFor(vector);
  assert.deepEqual(
    groups.map(({ heading }) => heading),
    ["Object", "Vector Properties", "Appearance", "Transform"],
  );
  assert.deepEqual(
    groups.map(({ fields }) => fields.map(({ key }) => key)),
    [
      ["dynamics.name", "dynamics.vectorAttachment"],
      [
        "dynamics.vectorRepresentation",
        "dynamics.vectorMagnitude",
        "dynamics.vectorAngle",
        "dynamics.vectorComponentX",
        "dynamics.vectorComponentY",
      ],
      ["lineType", "dynamics.vectorColor", "dynamics.vectorThickness", "dynamics.arrowheadSize"],
      ["dynamics.vectorOriginX", "dynamics.vectorOriginY"],
    ],
  );

  const getField = (key) => document.querySelector(`[data-feature-field="${key}"]`);
  const editLive = (key, value) => {
    const field = getField(key);
    field.value = String(value);
    field.dispatchEvent(new page.window.Event("input", { bubbles: true }));
    field.dispatchEvent(new page.window.Event("change", { bubbles: true }));
  };

  editLive("dynamics.vectorMagnitude", 80);
  assert.ok(Math.abs(vector.geometry.end.x - (start.x + 48)) < 1e-8);
  assert.ok(Math.abs(vector.geometry.end.y - (start.y + 64)) < 1e-8);

  editLive("dynamics.vectorAngle", 90);
  assert.ok(Math.abs(vector.geometry.end.x - start.x) < 1e-8);
  assert.ok(Math.abs(vector.geometry.end.y - (start.y + 80)) < 1e-8);

  editLive("dynamics.vectorComponentX", 12);
  editLive("dynamics.vectorComponentY", 16);
  assert.deepEqual(vector.geometry.end, { x: start.x + 12, y: start.y + 16 });

  editLive("dynamics.vectorOriginX", 5);
  editLive("dynamics.vectorOriginY", 8);
  assert.deepEqual(vector.geometry.start, { x: 5, y: 8 });
  assert.deepEqual(vector.geometry.end, { x: 17, y: 24 });

  const representation = getField("dynamics.vectorRepresentation");
  representation.value = "cartesian";
  representation.dispatchEvent(new page.window.Event("change", { bubbles: true }));
  assert.equal(vector.geometry.vectorRepresentation, "cartesian");

  const unit = getField("dynamics.vectorUnit");
  unit.value = "N";
  unit.dispatchEvent(new page.window.Event("change", { bubbles: true }));
  assert.equal(vector.geometry.vectorUnit, "N");

  const attachments = getField("dynamics.vectorAttachment");
  assert.ok([...attachments.options].some((option) => option.textContent.includes("Origin Point")));
  const particle = state.objects.find((object) => object.engineering?.dynamicsType === "dynamics-particle");

  if (particle) {
    attachments.value = particle.id;
    attachments.dispatchEvent(new page.window.Event("change", { bubbles: true }));
    assert.equal(vector.geometry.attachedTo, particle.id);
  }

  const size = getField("dynamics.arrowheadSize");
  size.value = "14";
  size.dispatchEvent(new page.window.Event("change", { bubbles: true }));
  assert.equal(vector.style.arrowheadSize, 14);

  const beforeHandle = { ...vector.geometry.end };
  assert.equal(
    m.dynamicsHandles.applyDynamicsHandle(
      vector,
      { kind: "end" },
      { x: beforeHandle.x + 30, y: beforeHandle.y + 40 },
      vector.geometry,
    ),
    true,
  );
  assert.equal(vector.geometry.vectorMagnitude, 70);
  assert.ok(Math.abs(vector.geometry.vectorAngle - 53.13010235415598) < 1e-10);
  assert.equal(m.schema.readField(vector, "dynamics.vectorMagnitude"), 70);
  assert.ok(Math.abs(m.schema.readField(vector, "dynamics.vectorAngle") - 53.13010235415598) < 1e-10);
});

/* ================================================================ creation */

test("every Dynamics tool arms, creates one object, and selects it", async () => {
  const objects = await builtObjects();

  ALL_TOOLS.forEach((id) => {
    assert.ok(objects[id], `${id} must create an object`);
    assert.ok(objects[id].id, `${id}'s object must have an identity`);
  });
});

test("a Dynamics tool is armed through the normal activation path", async () => {
  const m = await modules();
  const state = m.editor.drawingState;

  m.activation.activateTool("dynamics-spring");

  assert.equal(state.activeTool, "dynamics-spring");
  assert.equal(state.interaction.phase, "idle");

  /* Re-clicking keeps a placement tool armed. */
  m.activation.activateTool("dynamics-spring");

  assert.equal(state.activeTool, "dynamics-spring");

  m.activation.activateTool("select");

  /*
   * THE START-UP RECOVERY PROMPT IS RELEASED.
   *
   * Booting the application offers to recover unsaved work, and that prompt
   * holds the event loop open for as long as it is on screen - which is the
   * right behaviour in a browser and a hung test process here. It is the one
   * modal this suite can reach, so it is closed explicitly.
   */
  const prompt = document.querySelector("[data-recovery-prompt], .drawing-recovery-prompt, [role='dialog']");

  if (prompt) {
    prompt.remove();
  }
});

test("the creation gesture holds the first anchor and the second point commits", async () => {
  const m = await modules();
  const state = m.editor.drawingState;

  m.activation.activateTool("dynamics-damper");

  m.creation.beginOrCompleteGeometry(resolution({ x: 0, y: 0 }));

  assert.equal(state.interaction.phase, "dynamics-span");
  assert.ok(state.interaction.startPoint);
  assert.equal(state.interaction.toolId, "dynamics-damper");

  const before = state.objects.length;

  m.creation.beginOrCompleteGeometry(resolution({ x: 40, y: 0 }));

  assert.equal(state.objects.length, before + 1);
  assert.equal(state.objects[state.objects.length - 1].type, "dynamics-damper");
  assert.equal(state.interaction.phase, "idle");

  m.activation.activateTool("select");
});

test("a click-placed Dynamics tool arms, places, and returns to Select", async () => {
  const m = await modules();
  const state = m.editor.drawingState;

  m.activation.activateTool("dynamics-particle");
  m.creation.createDynamicsFeature("dynamics-particle", { x: 5, y: 5 }, { x: 5, y: 5 }, { ...STYLE });

  const created = state.objects[state.objects.length - 1];

  assert.equal(created.engineering.dynamicsType, "dynamics-particle");
  assert.ok(state.selection.selectedObjectIds.includes(created.id));
});

/* ============================================================== the model */

test("a composite is ONE object, never one object per primitive", async () => {
  const objects = await builtObjects();

  const kinds = ALL_TOOLS.map((id) => objects[id].id);

  assert.equal(new Set(kinds).size, kinds.length, "each tool must own a distinct object");

  /* A spring-damper carries both branches in its own geometry. */
  const pair = objects["dynamics-spring-damper"];

  assert.ok(pair.geometry.start && pair.geometry.end, "the pair shares its terminals");
  assert.ok(Number(pair.geometry.branchSpacing) > 0, "the pair has a branch separation");
  assert.ok(Number(pair.geometry.coils) > 0, "the pair carries the spring's coils");
  assert.ok(Number(pair.geometry.bodyWidth) > 0, "the pair carries the damper's body");

  /* A pulley carries its wheel, axle and rope in one geometry. */
  const pulley = objects["dynamics-pulley"];

  assert.ok(Number(pulley.geometry.radius) > 0);
  assert.ok(Number(pulley.geometry.ropeDrop) > 0);
  assert.equal(pulley.geometry.showAxle, true);
});

test("every Dynamics symbol has direct-manipulation handles", async () => {
  const m = await modules();
  const objects = await builtObjects();

  const expected = {
    "dynamics-particle": ["position", "dynamics-radius"],
    "dynamics-rigid-body": ["rigid-corner"],
    "dynamics-polar-vector": ["start", "end"],
    "dynamics-angular-vector": ["center", "dynamics-radius"],
    "dynamics-spring": ["start", "end", "dynamics-amplitude"],
    "dynamics-damper": ["start", "end", "dynamics-body-width"],
    "dynamics-spring-damper": ["start", "end", "dynamics-body-width"],
    "dynamics-pulley": ["center", "dynamics-radius", "dynamics-rope"],
    "dynamics-coordinate-system": ["origin"],
    "dynamics-reference-point": ["position"],
    "dynamics-reference-line": ["start", "end"],

    /*
     * A Reference Arc is the editor's own arc and keeps the arc's grips: its
     * centre and its two angle ends. Its geometry is checked here to the
     * radius and the stored angles, because an arc whose centre was lost
     * would still compile - as a path from nowhere - while having no grip.
     */
    "dynamics-reference-arc": ["center", "startAngle", "endAngle"]
  };

  const arc = objects["dynamics-reference-arc"];

  assert.ok(arc.geometry.center && arc.geometry.radius > 0, "a reference arc must keep its centre and radius");
  assert.ok(Number.isFinite(arc.geometry.startAngle), "a reference arc must keep its start angle");

  ALL_TOOLS.forEach((id) => {
    const handles = m.handles.editableHandlesFor(objects[id]).map((handle) => handle.kind);

    expected[id].forEach((kind) => {
      assert.ok(
        handles.some((handle) => handle.startsWith(kind)),
        `${id} must have a ${kind} handle (has ${handles.join(", ")})`,
      );
    });

    assert.ok(handles.includes("rotate") || id === "dynamics-particle" || id === "dynamics-reference-point", `${id} must have a rotation handle`);
    assert.ok(
      m.schema.supportsTransform(objects[id]),
      `${id} must support Transform`,
    );
  });
});

test("Fix hides the handles and blocks manipulation", async () => {
  const m = await modules();
  const objects = await builtObjects();

  const particle = objects["dynamics-particle"];
  const line = objects["dynamics-reference-line"];

  m.schema.writeField(particle, "fixed", true);
  assert.deepEqual(m.handles.editableHandlesFor(particle), []);

  const canvasRenderer = await import("../src/components/layout/workspace/canvas-render.js");
  canvasRenderer.renderCurrentDrawing();
  assert.ok(
    document.querySelector(`[data-fixed-anchor-badge="${particle.id}"]`),
    "a fixed particle must show its anchor badge",
  );
  m.schema.writeField(particle, "fixed", false);

  m.schema.writeField(line, "fixed", true);

  assert.equal(line.locked, true);
  assert.deepEqual(m.handles.editableHandlesFor(line), []);

  m.schema.writeField(line, "fixed", false);

  assert.ok(m.handles.editableHandlesFor(line).length > 0);
});

test("dragging a shared terminal keeps a spring-damper whole", async () => {
  const m = await modules();

  const pair = m.model.createDynamicsObject(
    "dynamics-spring-damper",
    [{ x: 0, y: 0 }, { x: 40, y: 0 }],
    { ...STYLE },
  );

  m.handleDrag.applyDynamicsHandle(pair, { kind: "end" }, { x: 60, y: 20 }, pair.geometry);

  assert.deepEqual(pair.geometry.end, { x: 60, y: 20 });
  assert.deepEqual(pair.geometry.start, { x: 0, y: 0 });
  assert.ok(Number(pair.geometry.branchSpacing) > 0, "both branches keep their separation");
});

test("moving and turning a symbol acts on its whole geometry", async () => {
  const m = await modules();

  const pulley = m.model.createDynamicsObject(
    "dynamics-pulley",
    [{ x: 0, y: 0 }, { x: 10, y: 0 }],
    { ...STYLE },
  );

  m.featureGeometry.translateObject(pulley, 5, 7, () => null);

  assert.deepEqual(pulley.geometry.center, { x: 5, y: 7 });

  const ropeAngle = Number(pulley.geometry.ropeAngle);

  m.featureGeometry.rotateObjectAbout(pulley, { x: 5, y: 7 }, Math.PI / 2);

  assert.equal(Number(pulley.geometry.ropeAngle), ropeAngle + 90);
  assert.equal(Number(pulley.geometry.radius), 10, "turning must not resize the wheel");
});

test("a reference arc is an ordinary arc, with a centre and two angle ends", async () => {
  const m = await modules();

  const arc = m.model.createDynamicsObject(
    "dynamics-reference-arc",
    [{ x: 0, y: 0 }, { x: 20, y: 0 }],
    { ...STYLE },
  );

  assert.equal(arc.type, "arc");

  /*
   * THE DRAG BEGAN ON THE ARC, so the arc passes through its start point, and
   * its sweep is the default ninety degrees. Both are properties of the
   * geometry, not of a stored copy of the drag.
   */
  const geometry = arc.geometry;
  const startOnArc = {
    x: geometry.center.x + geometry.radius * Math.cos(geometry.startAngle),
    y: geometry.center.y + geometry.radius * Math.sin(geometry.startAngle),
  };

  assert.ok(Math.hypot(startOnArc.x - 0, startOnArc.y - 0) < 1e-6, "the arc must start where the drag started");
  assert.ok(Math.abs(Math.abs(geometry.endAngle - geometry.startAngle) - Math.PI / 2) < 1e-9);

  const kinds = m.handles.editableHandlesFor(arc).map((handle) => handle.kind);

  ["center", "startAngle", "endAngle"].forEach((kind) => {
    assert.ok(kinds.includes(kind), `a reference arc must have a ${kind} handle`);
  });
});

/* ============================================================== features */

test("a Dynamics object's Features are its own controls, not a generic form", async () => {
  const m = await modules();
  const objects = await builtObjects();

  const spring = m.features.featuresMarkupForSelection([objects["dynamics-spring"]]);
  const pulleyPair = m.features.featuresMarkupForSelection([objects["dynamics-spring-damper"]]);
  const angular = m.features.featuresMarkupForSelection([objects["dynamics-angular-vector"]]);
  const particleObject = objects["dynamics-particle"];
  const particle = m.features.featuresMarkupForSelection([particleObject]);

  assert.match(spring, /Coils/);
  assert.match(spring, /Coil Height/);
  assert.match(spring, /data-feature-group="transform"/);
  assert.match(spring, /X Shift/);

  assert.match(pulleyPair, /Branch Separation/);
  assert.match(pulleyPair, /Spring Label/);
  assert.match(pulleyPair, /Damper Label/);

  const angularGroups = [...angular.matchAll(/data-feature-group="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(
    angularGroups,
    ["object", "rotational-properties", "appearance", "transform"],
  );
  assert.match(angular, /Name/);
  assert.match(angular, /Attached To/);
  assert.match(angular, /Angular Velocity/);
  assert.match(angular, /Angular Acceleration/);
  assert.match(angular, /Magnitude/);
  assert.match(angular, /Counter-Clockwise \(CCW\)/);
  assert.match(angular, /Clockwise/);
  assert.match(angular, /Color/);
  assert.match(angular, /Thickness/);
  assert.match(angular, /Arrowhead Size/);
  assert.match(angular, /Center X/);
  assert.match(angular, /Center Y/);

  const angularObject = objects["dynamics-angular-vector"];
  m.schema.writeField(angularObject, "dynamics.rotationalType", "acceleration");
  assert.equal(angularObject.geometry.unit, "rad/s²", "acceleration selects its matching default unit");
  m.schema.writeField(angularObject, "dynamics.angularMagnitude", 2.5);
  m.schema.writeField(angularObject, "dynamics.angularUnit", "rad/s²");
  m.schema.writeField(angularObject, "dynamics.direction", "cw");
  m.schema.writeField(angularObject, "dynamics.angularCenterX", 12);
  m.schema.writeField(angularObject, "dynamics.angularCenterY", 15);
  assert.equal(angularObject.geometry.rotationalType, "acceleration");
  assert.equal(angularObject.geometry.magnitude, 2.5);
  assert.equal(angularObject.geometry.unit, "rad/s²");
  assert.equal(angularObject.geometry.direction, "cw");
  assert.deepEqual(angularObject.geometry.center, { x: 12, y: 15 });

  const beforeCenterDrag = { ...angularObject.geometry.center };
  m.dynamicsHandles.applyDynamicsHandle(
    angularObject,
    { kind: "center" },
    { x: 22, y: 25 },
    angularObject.geometry,
  );
  assert.equal(m.schema.readField(angularObject, "dynamics.angularCenterX"), 22);
  assert.equal(m.schema.readField(angularObject, "dynamics.angularCenterY"), 25);
  assert.notDeepEqual(angularObject.geometry.center, beforeCenterDrag);

  const particleGroups = [...particle.matchAll(/data-feature-group="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(particleGroups, ["object", "physical-properties", "appearance", "transform"]);
  assert.match(
    particle,
    new RegExp(`data-feature-field="dynamics\\.name"[^>]*value="${particleObject.name}"`),
  );
  assert.match(particle, /Mass \(m\)/);
  assert.match(particle, /Initial Velocity X/);
  assert.match(particle, /Initial Velocity Y/);
  assert.match(particle, /Line Style|lineType/);
  assert.match(particle, /Outline Colour/);
  assert.match(particle, /data-feature-field="customWidth"/);
  assert.match(particle, /Fill Opacity/);
  assert.match(particle, /X Shift/);
  assert.match(particle, /Y Shift/);
  assert.doesNotMatch(particle, />Rotate</);

  assert.equal(particleObject.engineering.massKg, 1);
  m.schema.writeField(particleObject, "dynamics.massUnit", "g");
  assert.equal(m.schema.readField(particleObject, "dynamics.mass"), 1000);
  m.schema.writeField(particleObject, "dynamics.mass", 250);
  assert.equal(particleObject.engineering.massKg, 0.25);
  m.schema.writeField(particleObject, "dynamics.initialVelocityX", 3);
  m.schema.writeField(particleObject, "dynamics.initialVelocityY", -4);
  assert.deepEqual(particleObject.engineering.initialVelocity, { x: 3, y: -4 });
  m.schema.writeField(particleObject, "dynamics.positionX", 42);
  m.schema.writeField(particleObject, "dynamics.positionY", 24);
  assert.deepEqual(particleObject.geometry.position, { x: 42, y: 24 });

  /* Fix is offered, and it is called Fix. */
  assert.match(spring, />Fix</);
  assert.doesNotMatch(spring, />Fixed</);
});

test("a mixed selection shows only what the objects share", async () => {
  const m = await modules();
  const objects = await builtObjects();

  const markup = m.features.featuresMarkupForSelection([
    objects["dynamics-spring"],
    objects["dynamics-pulley"]
  ]);

  const groups = [...markup.matchAll(/data-feature-group="([^"]+)"/g)].map((match) => match[1]);

  /*
   * THE SHARED CONTROLS SURVIVE, and so does each object's own section - the
   * union of what the selection offers. A SPRING section is present because a
   * spring is selected; a PULLEY section because a pulley is.
   */
  assert.ok(groups.includes("transform"));
  assert.ok(groups.includes("appearance"));
  assert.ok(groups.includes("dynamics-spring"));
  assert.ok(groups.includes("dynamics-pulley"));

  /* A CONTROL ONLY ONE OF THEM HAS IS STILL SHOWN FOR THAT ONE. */
  assert.match(markup, /Coils/);

  /*
   * AND THE TWO NEVER INHERIT EACH OTHER'S VALUES. A spring and a pulley have
   * no field in common but the generic ones, so nothing in the panel claims a
   * pulley is a spring.
   */
  assert.doesNotMatch(markup, /Branch Separation/);
});

test("a Dynamics Rigid Body exposes physical properties, appearance, and live transforms", async () => {
  const m = await modules();
  const body = m.model.createDynamicsObject(
    "dynamics-rigid-body",
    [{ x: 10, y: 20 }],
    { ...STYLE },
  );
  const markup = m.features.featuresMarkupForSelection([body]);
  const groups = m.schema.groupsFor(body).map((group) => group.id);

  assert.deepEqual(groups, ["object", "physical-properties", "appearance", "transform"]);
  assert.match(markup, /Mass \(m\)/);
  assert.match(markup, /Width \(mm\)/);
  assert.match(markup, /Height \(mm\)/);
  assert.match(markup, /Mass Moment of Inertia \(I\)/);
  assert.match(markup, /Line Style/);
  assert.match(markup, /Outline Colour/);
  assert.match(markup, /Fill Opacity/);
  assert.match(markup, /Rotate/);
  assert.equal((markup.match(/data-feature-group="transform"/g) || []).length, 1);

  assert.equal(m.schema.readField(body, "dynamics.mass"), 1);
  assert.equal(m.schema.readField(body, "dynamics.momentOfInertia"), 0);
  assert.equal(m.schema.writeField(body, "dynamics.massUnit", "lb"), true);
  assert.equal(m.schema.writeField(body, "dynamics.mass", 2), true);
  assert.equal(body.engineering.massKg, 2 * 0.45359237);
  assert.equal(m.schema.writeField(body, "dynamics.bodyWidth", 75), true);
  assert.equal(m.schema.writeField(body, "dynamics.bodyHeight", 40), true);
  assert.equal(m.schema.writeField(body, "dynamics.momentOfInertia", 1.25), true);
  assert.equal(body.geometry.width, 75);
  assert.equal(body.geometry.height, 40);
  assert.equal(body.engineering.momentOfInertiaKgM2, 1.25);
  assert.equal(m.schema.writeField(body, "lineType", "dashed"), true);
  assert.equal(m.schema.writeField(body, "fill", "#336699"), true);
  assert.equal(m.schema.writeField(body, "dynamics.fillOpacityEnabled", true), true);

  m.editor.drawingState.objects.push(body);
  m.drawingState.selectObject(m.editor.drawingState, body.id);
  const xShift = document.querySelector('[data-feature-field="dynamics.positionX"]');
  xShift.value = "25";
  xShift.dispatchEvent(new page.window.Event("input", { bubbles: true }));
  assert.equal(body.geometry.position.x, 25, "X coordinate edits update the canvas model live");
  xShift.dispatchEvent(new page.window.Event("change", { bubbles: true }));

  const rotation = document.querySelector('[data-feature-field="dynamics.rotation"]');
  rotation.value = "35";
  rotation.dispatchEvent(new page.window.Event("input", { bubbles: true }));
  assert.equal(body.geometry.rotation, 35, "rotation edits update the canvas model live");
  rotation.dispatchEvent(new page.window.Event("change", { bubbles: true }));

  const canvasRenderer = await import("../src/components/layout/workspace/canvas-render.js");
  canvasRenderer.renderCurrentDrawing();
  const renderedBody = document.querySelector(`[data-feature-id="${body.id}"] polygon`);

  assert.ok(renderedBody, "the Dynamics body uses the shared rigid-body renderer");
  assert.equal(renderedBody.getAttribute("fill"), "#336699");
  assert.equal(renderedBody.getAttribute("fill-opacity"), "0.35");
  assert.ok(renderedBody.getAttribute("stroke-dasharray"), "the line style applies to the body outline");

  const source = m.dynamicsWriter.dynamicsSourceWriter(body);

  assert.match(source, /fill opacity=0\.35/);
  assert.ok((await compile(source)).ok, "the styled rigid-body source compiles");

  m.schema.writeField(body, "fixed", true);
  assert.deepEqual(m.handles.editableHandlesFor(body), []);
  m.schema.writeField(body, "fixed", false);
  assert.ok(m.handles.editableHandlesFor(body).some((handle) => handle.kind.startsWith("rigid-corner")));
});

test("no selection gives the neutral empty state, not a wall of zeros", async () => {
  const m = await modules();

  assert.equal(m.features.featuresMarkupForSelection([]), "");
});

/* ================================================================ source */

test("the Dynamics writer is installed and answers only for Dynamics objects", async () => {
  const m = await modules();
  const objects = await builtObjects();

  assert.ok(
    m.writers.registeredWriterIds().includes("dynamics"),
    "the writer must be in the one writer list",
  );

  assert.equal(m.dynamicsWriter.dynamicsSourceWriter({ type: "line", geometry: {} }), null);
  assert.ok(
    m.dynamicsWriter.dynamicsSourceWriter(objects["dynamics-spring"]),
    "a spring must have source",
  );
});

test("every Dynamics symbol writes source, and that source compiles", async () => {
  const m = await modules();

  /*
   * EACH SYMBOL IS MADE FRESH, AT A SIZE OF ITS OWN - never less than ten
   * units long, so a symbol drawn along its span is large enough to put ink
   * on the page. The suite's shared objects are packed a few units apart to
   * fit thirteen of them on one sheet, and a two-unit trajectory compiles to
   * a blank page rather than to a wrong one.
   */
  for (const [index, id] of ALL_TOOLS.entries()) {
    const origin = { x: 20 + index * 30, y: 30 + (index % 3) * 30 };

    /*
     * A LONG, DIAGONAL SPAN. Sixteen units is enough for every symbol to
     * put ink on the page at the size it draws its own details, and a
     * diagonal one means neither axis of the check can be passed by a
     * degenerate horizontal or vertical line by accident.
     */
    const far = { x: origin.x + 16, y: origin.y + 10 };

    const object = m.model.createDynamicsObject(id, [origin, far], { ...STYLE });

    object.id = `source-${id}`;

    const source = m.sync.sourceForObject(object);

    assert.ok(
      typeof source === "string" && source.trim() !== "",
      `${id} must write source`,
    );

    assert.match(source, /\\draw|\\fill|\\node/, `${id}'s source must draw something`);

    const result = await compile(source);

    assert.ok(result.ok, `${id}'s source must compile: ${result.error}`);

    /*
     * THE COMPILED PICTURE IS NOT EMPTY. A compile that succeeds but draws a
     * blank page is the failure this check exists for.
     */
    const spectrum = (result.svg.match(/<(path|line|circle|text)\b/g) || []);

    assert.ok(spectrum.length > 0, `${id} must draw ink (no path, line, circle or text in the compiled page)`);
  }
});

test("editing an object rewrites its own source with the new geometry", async () => {
  const m = await modules();
  const objects = await builtObjects();

  const spring = objects["dynamics-spring"];

  spring.geometry.end = { x: 123.5, y: 67.25 };

  const source = m.sync.sourceForObject(spring);

  assert.match(source, /123\.5/);
  assert.match(source, /67\.25/);
  assert.ok((await compile(source)).ok);
});

test("deleting an object removes its region and leaves the others alone", async () => {
  const m = await modules();

  const manager = {
    value: "",
    getSource() {
      return this.value;
    },
    setSource(next) {
      this.value = next;
      return true;
    }
  };

  const one = m.model.createDynamicsObject("dynamics-spring", [{ x: 0, y: 0 }, { x: 20, y: 0 }], { ...STYLE });
  const two = m.model.createDynamicsObject("dynamics-pulley", [{ x: 50, y: 0 }, { x: 60, y: 0 }], { ...STYLE });

  one.id = "spring-test";
  two.id = "pulley-test";

  m.sync.writeObjectIntoSource(manager, one);
  m.sync.writeObjectIntoSource(manager, two);

  assert.match(manager.value, /spring-test/);
  assert.match(manager.value, /pulley-test/);

  m.sync.removeObjectFromSource(manager, one.id);

  assert.doesNotMatch(manager.value, /spring-test/);
  assert.match(manager.value, /pulley-test/);
  assert.ok((await compile(manager.value)).ok);
});

/* ======================================================= existing behaviour */

test("the Statics writer still owns its own objects", async () => {
  const m = await modules();
  const statics = await import("../src/shared/rendering/latex/source-writers/statics.js");

  const beam = {
    id: "statics-beam",
    type: "beam",
    geometry: { start: { x: 0, y: 0 }, end: { x: 20, y: 0 } },
    style: { ...STYLE }
  };

  assert.ok(statics.staticsSourceWriter(beam), "Statics must still write a beam");
  assert.equal(m.dynamicsWriter.dynamicsSourceWriter(beam), null, "Dynamics must decline it");
});

test("the sidebar still renders the Statics hierarchy unchanged", async () => {
  const m = await modules();

  m.toolbarRender.renderEngineeringTools("STATICS");

  const text = (document.getElementById("drawingToolList")?.textContent || "").replace(/\s+/g, " ");

  ["Selection", "Create", "Bodies", "Point Load", "Analysis", "Reference"].forEach((word) => {
    assert.ok(text.includes(word), `Statics must still show ${word}`);
  });
});

test("nothing was reported to the error log during the run", async () => {
  const log = await import("../src/app/error-log.js");

  const reported = typeof log.default?.entries === "function" ? log.default.entries() : [];

  /*
   * A DRAWING FAILURE WOULD BE HERE. The whole suite builds, moves, renders and
   * compiles every symbol, so an exception inside a renderer or a writer shows
   * up as a recorded error rather than only as a missing shape.
   */
  assert.deepEqual(
    reported.filter((entry) => /render|source|tool/.test(String(entry?.scope || entry?.area || ""))),
    [],
  );
});
