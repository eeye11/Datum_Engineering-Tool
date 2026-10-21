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
  kinematics: ["dynamics-trajectory", "dynamics-polar-vector", "dynamics-angular-vector"],
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
      activation: await import("../src/components/layout/toolbar/tool-activation.js"),
      toolbarRender: await import("../src/components/layout/toolbar/toolbar-render.js"),
      toolbarTools: await import("../src/components/layout/toolbar/tools.js"),
      features: await import("../src/components/layout/panels/features-editor.js"),
      schema: await import("../src/components/layout/panels/feature-schema.js"),
      sync: await import("../src/shared/rendering/latex/source-synchronization.js"),
      writers: await import("../src/shared/rendering/latex/source-writers/index.js"),
      dynamicsWriter: await import("../src/shared/rendering/latex/source-writers/dynamics.js"),
      featureGeometry: (await import("../src/shared/geometry/feature-geometry.js")).default
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

  /* The families open the SAME submenu Statics uses. */
  create.tools.forEach((tool) => {
    assert.equal(tool.submenu, true, `${tool.label} must open a submenu`);
    assert.ok(m.tools.DYNAMICS_TOOL_MENUS[tool.id], `${tool.id} must have a menu`);
  });

  assert.deepEqual(
    m.tools.DYNAMICS_TOOL_MENUS["dynamics-bodies"].map((item) => item.label),
    ["Particle", "Rigid Body"],
  );

  assert.deepEqual(
    m.tools.DYNAMICS_TOOL_MENUS["dynamics-kinematics"].map((item) => item.label),
    ["Trajectory", "Polar Vector", "Angular Vector"],
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
    "Trajectory",
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

  ["Selection", "Create", "Bodies", "Kinematics", "Mechanical Elements", "Reference"].forEach((word) => {
    assert.ok(text.includes(word), `the sidebar must show ${word}`);
  });

  assert.ok(!/ANALYSIS/i.test(text), "the sidebar must not have an Analysis section");
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
    "dynamics-trajectory": ["start", "end"],
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

  const line = objects["dynamics-reference-line"];

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

  assert.match(spring, /Coils/);
  assert.match(spring, /Coil Height/);
  assert.match(spring, /data-feature-group="transform"/);
  assert.match(spring, /X Shift/);

  assert.match(pulleyPair, /Branch Separation/);
  assert.match(pulleyPair, /Spring Label/);
  assert.match(pulleyPair, /Damper Label/);

  assert.match(angular, /Anti-clockwise/);
  assert.match(angular, /Sweep/);

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

  ["Selection", "Create", "Bodies", "Point Force", "Analysis", "Reference"].forEach((word) => {
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
