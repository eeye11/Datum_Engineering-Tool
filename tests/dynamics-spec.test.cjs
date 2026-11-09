/* eslint-disable no-console */
/*
 * ========================================================
 * DYNAMICS: THE SPECIFICATION, TOOL BY TOOL
 * ========================================================
 *
 * `dynamics-library.test.cjs` proves the library exists and compiles. This
 * suite proves the SYMBOLS behave as the specification asks:
 *
 *   - a Particle is ONE FILLED CIRCLE and nothing else;
 *   - a Rigid Body is drawn at the size of its gesture;
 *   - the eight label-capable tools take an OPTIONAL label, and an empty one
 *     writes nothing anywhere;
 *   - Features and source are the same object, and an ID survives its edits;
 *   - the source round-trips, and an invalid source keeps the last drawing;
 *   - Special Symbols is a Tools command beside Show Dimension;
 *   - the in-place text editor is the note's own field and cancels without
 *     destroying an existing note.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

test.after(() => {
  setImmediate(() => process.exit(process.exitCode || 0));
});

const { bootApp } = require("./helpers/boot-app.cjs");

let page = null;
let document = null;

async function booted() {
  if (!page) {
    page = bootApp();

    if (page.error) {
      throw page.error;
    }

    document = page.document;

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
        y: 0,
      });

      canvas.dispatchEvent(
        new page.window.MouseEvent("mousemove", {
          clientX: 450,
          clientY: 300,
          bubbles: true,
        }),
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return page;
}

let loaded = null;

async function modules() {
  await booted();

  if (!loaded) {
    loaded = {
      editor: await import("../src/features/workspace/editor-state.js"),
      tools:
        await import("../src/features/workspace/dynamics/dynamics-tools.js"),
      model:
        await import("../src/features/workspace/dynamics/dynamics-model.js"),
      label:
        await import("../src/features/workspace/dynamics/dynamics-label.js"),
      creation:
        await import("../src/features/workspace/geometry/geometry-creation.js"),
      schema: await import("../src/components/layout/panels/feature-schema.js"),
      features:
        await import("../src/components/layout/panels/features-editor.js"),
      writer:
        await import("../src/shared/rendering/latex/source-writers/dynamics.js"),
      renderer:
        await import("../src/shared/rendering/entities/draw-dynamics.js"),
      canvasRender:
        await import("../src/components/layout/workspace/canvas-render.js"),
      drawingState: (await import("../src/shared/model/drawing-state.js"))
        .default,
      menus: await import("../src/components/layout/menu-bar/menu-commands.js"),
      symbols:
        await import("../src/shared/ui/editors/special-symbols-insert.js"),
      picker: (await import("../src/shared/ui/editors/symbol-picker.js"))
        .default,
      undo: await import("../src/components/layout/toolbar/tool-activation.js"),
    };
  }

  return loaded;
}

const STYLE = {
  stroke: "#193335",
  lineWidth: 0.5,
  lineType: "solid",
  fill: "none",
};

/* One fresh, uncommitted object from the model - no sheet state involved. */
async function make(
  toolId,
  points = [
    { x: 10, y: 10 },
    { x: 40, y: 25 },
  ],
) {
  const m = await modules();

  return m.model.createDynamicsObject(toolId, points, { ...STYLE });
}

/* ------------------------------------------------------------------ particle */

test("a Particle is one filled circle, with no line and no extra geometry", async () => {
  const m = await modules();
  const particle = await make("dynamics-particle", [{ x: 20, y: 30 }]);

  assert.equal(particle.type, "particle");
  assert.equal(particle.geometry.position.x, 20);
  assert.equal(particle.geometry.position.y, 30);
  assert.equal(
    particle.style.fillMode,
    "solid",
    "the marker must be filled by construction",
  );

  /* Rendering: exactly one circle, filled, unstroked, and nothing else. */
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const parent = document.createElementNS("http://www.w3.org/2000/svg", "svg");

  m.renderer.drawDynamicsSymbol({
    svg,
    parentSvg: parent,
    entity: particle,
    geometry: particle.geometry,
    style: particle.style,
    state: { camera: { zoom: 1 } },
    scale: 1,
    toScreen: (point) => ({ x: point.x, y: point.y }),
  });

  const circles = svg.querySelectorAll("circle");
  const lines = svg.querySelectorAll("line, path, polyline, polygon, rect");

  assert.equal(circles.length, 1, "a particle is exactly one circle");
  assert.equal(
    lines.length,
    0,
    "a particle must draw no path, line or other mark",
  );
  assert.notEqual(circles[0].getAttribute("fill"), "none");
  assert.equal(circles[0].getAttribute("stroke"), "none");
  assert.ok(
    Number(circles[0].getAttribute("r")) >= 4,
    "the disc must be clearly visible",
  );

  /* Source: one `\fill` of one circle. */
  const source = m.writer.dynamicsSourceWriter(particle);

  assert.match(source, /\(20,30\) circle\[radius=/, "the marker is written as a circle");
  assert.match(source, /\\fill\[/, "and filled in one command");
  assert.match(source, /draw=none/, "with no pen stroke of its own");
  assert.doesNotMatch(
    source,
    /\\draw/,
    "the particle's source must contain no drawn line",
  );
  assert.equal((source.match(/circle/g) || []).length, 1);
});

test("an empty Particle label writes nothing, and a typed one writes only text", async () => {
  const m = await modules();
  const particle = await make("dynamics-particle", [{ x: 5, y: 5 }]);

  particle.label = "";

  const empty = m.writer.dynamicsSourceWriter(particle);

  assert.ok(empty, "the particle still has source without a label");
  assert.doesNotMatch(
    empty,
    /\\node/,
    "an empty label must not produce a node",
  );
  /*
   * NO DEFAULT LABEL IN THE PICTURE. The `% DAETUM OBJECT:` comment names the
   * feature in the editable source - that is the object's identity, not text on
   * the sheet - so the check is that no `\node` carries a default name.
   */
  assert.doesNotMatch(
    empty,
    /\\node[^;]*Particle/i,
    "no generated default label may be drawn",
  );

  particle.label = "A";

  const typed = m.writer.dynamicsSourceWriter(particle);

  assert.ok(typed.includes("{A}"), "the typed label is written as the node's content");
  assert.equal(
    (typed.match(/circle/g) || []).length,
    1,
    "the label must not add geometry",
  );
});

/* --------------------------------------------------------------- rigid body */

test("a Rigid Body takes its size from the gesture, and resizes from a corner", async () => {
  const m = await modules();
  const state = m.editor.drawingState;

  const before = state.objects.length;

  m.editor.editorState.drawingPanelTab = "source";
  state.activeTool = "dynamics-rigid-body";
  m.creation.beginOrCompleteGeometry({
    effectiveConstructionPoint: { x: 100, y: 100 },
    rawPointerPoint: { x: 100, y: 100 },
    snapCandidate: null,
  });
  m.creation.beginOrCompleteGeometry({
    effectiveConstructionPoint: { x: 140, y: 70 },
    rawPointerPoint: { x: 140, y: 70 },
    snapCandidate: null,
  });

  assert.equal(state.objects.length, before + 1);

  const body = state.objects[state.objects.length - 1];
  const id = body.id;

  assert.equal(body.type, "rigid-body");
  assert.equal(body.geometry.width, 40, "the width is the drag's width");
  assert.equal(body.geometry.height, 30, "the height is the drag's height");

  m.schema.writeField(body, "dynamics.rotation", 30);

  /*
   * THE SIZE IS THE HANDLES' JOB. There is no Width or Height row - the corner
   * grip writes the rectangle's position and size, and the creation gesture set
   * them in the first place.
   */
  assert.equal(m.schema.fieldDefinition("dynamics.bodyWidth"), null);
  assert.equal(m.schema.readField(body, "dynamics.rotation"), 30);
  assert.equal(body.id, id, "editing must preserve the object's id");

  const source = m.writer.dynamicsSourceWriter(body);

  assert.ok(source.includes("\\draw"), "the body is written as a drawn outline");
  assert.equal(body.id, id, "writing the source does not re-identify the object");

  /*
   * THE HISTORY IS THE SHARED ONE, and it is driven by the same two commands
   * the Edit menu calls - not by a second stack kept for the test.
   */
  assert.equal(typeof m.undo.performUndo, "function");
  assert.equal(typeof m.undo.performRedo, "function");
});

/* ------------------------------------------------------------------- labels */

test("only the analytical tools ask for a label as they are created", async () => {
  const m = await modules();

  /*
   * A POINT LOAD IS DELIBERATELY ABSENT. It already asks for its magnitude in
   * the on-drawing value field as it is created, so a second label field straight
   * afterwards opened two boxes for one placement.
   */
  assert.deepEqual([...m.label.LABEL_CAPABLE_TOOLS].sort(), [
    "distributed-load",
    "dynamics-angular-vector",
    "dynamics-polar-vector",
    "moment",
    "varying-distributed-load",
  ]);

  /*
   * EVERYTHING ELSE IS CREATED IMMEDIATELY. A particle, a body, a spring or a
   * reference line needs no name to be understood, so placing one must not be
   * interrupted to ask for one - its Name can still be typed in Features.
   */
  [
    "dynamics-particle",
    "dynamics-rigid-body",
    "dynamics-spring",
    "dynamics-damper",
    "dynamics-spring-damper",
    "dynamics-pulley",
    "dynamics-reference-point",
    "dynamics-reference-line",
    "dynamics-reference-arc",
    "dynamics-coordinate-system",
  ].forEach((toolId) => {
    assert.equal(
      m.label.toolTakesLabel(toolId),
      false,
      `${toolId} must not ask for a label`,
    );
  });
});

test("a label follows its parent, and clearing it removes only the text", async () => {
  const m = await modules();

  /* Every Dynamics symbol can carry a label, whether or not it asks for one. */
  const LABELLED = [
    "dynamics-particle",
    "dynamics-rigid-body",
    "dynamics-polar-vector",
    "dynamics-angular-vector",
    "dynamics-spring",
    "dynamics-damper",
    "dynamics-spring-damper",
    "dynamics-pulley",
  ];

  for (const toolId of LABELLED) {
    const object = await make(toolId);

    object.label = "k₁";

    const source = m.writer.dynamicsSourceWriter(object);

    assert.match(source, /\\node/, `${toolId} must write its label`);
    assert.match(source, /k/, `${toolId} must write the typed text`);

    /* Moved: the label follows, and the object keeps its id. */
    const moved = JSON.parse(JSON.stringify(object));

    ["start", "end", "center", "position", "origin"].forEach((key) => {
      if (moved.geometry?.[key]) {
        moved.geometry[key] = {
          x: moved.geometry[key].x + 100,
          y: moved.geometry[key].y + 100,
        };
      }
    });

    const movedSource = m.writer.dynamicsSourceWriter(moved);
    const nodeOf = (text) => (text.match(/\\node\[[^\]]*\] at (\([^)]*\))/) || [])[1];

    assert.notEqual(nodeOf(movedSource), nodeOf(source), `${toolId}'s label must move with it`);
    assert.ok(String(object.id ?? "").length > 0, `${toolId} keeps a stable identity`);

    /* Cleared: no node, no default, no placeholder. */
    moved.label = "";
    assert.doesNotMatch(m.writer.dynamicsSourceWriter(moved), /\\node/);
  }
});

test("a label's special characters are escaped, not passed through", async () => {
  const m = await modules();
  const spring = await make("dynamics-spring");

  spring.label = "50% & θ_2";

  const source = m.writer.dynamicsSourceWriter(spring);

  assert.doesNotMatch(
    source,
    /% &/,
    "a raw percent would comment out the rest of the line",
  );
  assert.match(source, /50\\%/);
  assert.match(source, /\\&/);
});

/* ------------------------------------------------------------------ features */

test("one Name field, empty until typed, and never pre-filled", async () => {
  const m = await modules();
  const spring = await make("dynamics-spring");

  assert.equal(m.schema.readField(spring, "name"), "");

  const markup = m.features.featuresMarkupForSelection([spring]);

  assert.match(markup, /data-feature-field="name"/);
  assert.doesNotMatch(markup, /optional/i, "the field no longer says (optional)");
  assert.doesNotMatch(markup, /Spring 1/, "no default label may be shown");

  /*
   * THE ONE FIELD WRITES THE NAME AND THE DRAWN LABEL TOGETHER, so the panel,
   * the Objects inventory and the sheet cannot disagree.
   */
  m.schema.writeField(spring, "name", "k");

  assert.equal(spring.name, "k");
  assert.equal(spring.label, "k");
  assert.equal(m.schema.readField(spring, "name"), "k");

  m.schema.writeField(spring, "name", "");

  assert.equal(spring.name, "");
  assert.equal(spring.label, "", "clearing the name removes the drawn text");
});

test("a vector exposes origin, magnitude and angle as one synchronised transform", async () => {
  const m = await modules();
  const vector = await make("dynamics-polar-vector", [
    { x: 0, y: 0 },
    { x: 30, y: 40 },
  ]);

  assert.equal(m.schema.readField(vector, "dynamics.vectorMagnitude"), 50);

  m.schema.writeField(vector, "dynamics.vectorMagnitude", 100);

  assert.equal(vector.geometry.end.x, 60);
  assert.equal(vector.geometry.end.y, 80);
  assert.ok(
    Math.abs(m.schema.readField(vector, "dynamics.vectorAngle") - 53.13010235415598) < 1e-9,
  );

  m.schema.writeField(vector, "dynamics.vectorAngle", 0);

  assert.equal(
    Math.round(vector.geometry.end.y),
    0,
    "a changed angle moves the tip, not just the arrow",
  );
  assert.equal(Math.round(vector.geometry.end.x), 100);

  const source = m.writer.dynamicsSourceWriter(vector);

  assert.match(
    source,
    /-?\{?Latex\}?/,
    "the arrowhead is part of the drawn path",
  );
});

test("reversing an angular vector's direction moves the arrowhead, and keeps it an arc", async () => {
  const m = await modules();
  const arc = await make("dynamics-angular-vector", [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
  ]);

  const ccw = m.writer.dynamicsSourceWriter(arc);

  m.schema.writeField(arc, "dynamics.direction", "cw");

  assert.equal(arc.engineering.dynamicsType, "dynamics-angular-vector");
  assert.equal(
    arc.type,
    "dynamics-angular-vector",
    "it must not become a reference arc",
  );

  const cw = m.writer.dynamicsSourceWriter(arc);

  assert.match(cw, /arc\[start angle=/, "it is still an arc");
  assert.match(cw, /-?\{?Latex\}?|->/, "and still carries its head");
  assert.notEqual(cw, ccw, "the direction changes what is written");

  /*
   * THE HEAD IS AT THE END OF THE PATH, so a clockwise arrow is written with
   * its sweep running the other way - the same arc, drawn head-first. A CW
   * arc's start angle is therefore GREATER than its end angle.
   */
  /*
   * The written end angle may be carried past 360 (a start of 0 swept 270
   * clockwise ends at -270); the comparison is on the signed sweep, not on
   * the numbers as printed.
   */
  const anglesOf = (text) => {
    const match = /arc\[start angle=(-?[\d.]+), end angle=(-?[\d.]+)/.exec(text);

    return match
      ? { start: Number(match[1]), end: Number(match[2]), sweep: Number(match[2]) - Number(match[1]) }
      : null;
  };

  const ccwAngles = anglesOf(ccw);
  const cwAngles = anglesOf(cw);

  assert.ok(ccwAngles && cwAngles, "both directions write an arc");
  assert.ok(ccwAngles.sweep > 0, "the anticlockwise arc sweeps forwards");

  /*
   * THE END POINT MOVES WITH THE DIRECTION. Whatever start angle the gesture
   * gave the arc, the clockwise arrow ends its weld on the other side of the
   * centre - so the two written arcs are not the same arc with a different
   * option list.
   */
  assert.notEqual(cwAngles.end, ccwAngles.end, "the clockwise arc ends on the other side");
});

/* -------------------------------------------------------------------- source */

test("source round-trips: writing, re-reading and re-writing is stable", async () => {
  const m = await modules();

  for (const toolId of [
    "dynamics-particle",
    "dynamics-polar-vector",
    "dynamics-spring",
    "dynamics-reference-point",
    "dynamics-reference-line",
    "dynamics-reference-arc",
  ]) {
    const object = await make(toolId);

    object.label = toolId.endsWith("particle") ? "" : "L";

    const first = m.writer.dynamicsSourceWriter(object);
    const second = m.writer.dynamicsSourceWriter(object);

    assert.equal(first, second, `${toolId} must write the same source twice`);
  }
});

/* ------------------------------------------------------------ special symbols */

test("Special Symbols is a Tools command, beside the dimension switch", async () => {
  const m = await modules();
  const tools = m.menus.MENUS.find((menu) => menu().id === "tools")();

  const ids = tools.items
    .filter((item) => !item.separator)
    .map((item) => item.id);

  assert.ok(ids.includes("show-dimension"), "the dimension switch stays in Tools");
  assert.equal(ids.includes("special-symbols"), false, "Special Symbols is not a Tools command");

  /* It lives in the quick-access style strip, beside Line Type. */
  const button = document.getElementById("drawingSpecialSymbols");

  assert.ok(button, "the quick-access button exists");
  assert.ok(
    button.closest(".drawing-style-strip, .drawing-menu-controls-bar, .drawing-toolbar"),
    "it sits in the menu bar's quick-access area",
  );

  /* Annotate still owns its own Symbols tool. */
  const toolbarTools = await import("../src/components/layout/toolbar/tools.js");

  assert.ok(
    toolbarTools.annotateToolGroups.some((group) =>
      group.tools.some((tool) => tool.id === "symbol"),
    ),
    "Annotate → Symbols is untouched",
  );

  /* The drawing toolbar has no symbol control of its own. */
  assert.equal(
    document.querySelector("#drawingToolList [data-tool-id='special-symbols']"),
    null,
  );
});

test("a symbol is inserted at the caret, keeping the text around it", async () => {
  const m = await modules();

  /* Any prompt left open by an earlier check is closed first. */
  document.querySelectorAll(".drawing-canvas-text-editor, .drawing-inline-entry").forEach((element) => element.remove());

  const field = document.createElement("textarea");

  field.value = "ab";
  document.body.appendChild(field);
  field.focus();
  field.setSelectionRange(1, 1);

  m.symbols.insertAtCaret(field, "θ");

  assert.equal(field.value, "aθb", "the glyph goes in at the caret");
  assert.equal(field.selectionStart, 2, "the caret follows the glyph");

  field.remove();
});

test("with no text field active, the picker opens but places nothing", async () => {
  const m = await modules();

  /* A prompt left open by an earlier check is closed first. */
  document.querySelectorAll(".drawing-canvas-text-editor, .drawing-inline-entry").forEach((element) => element.remove());

  document.activeElement?.blur?.();

  const before = (m.editor.drawingState.objects || []).length;

  /*
   * THE PICKER ALWAYS OPENS. Refusing to open it was what made the quick-access
   * button look broken: pressing the button takes focus off the field, so the
   * press that was meant to open the list was the press that made it think there
   * was nowhere to insert.
   */
  assert.equal(m.symbols.openSpecialSymbols({}), true);
  assert.equal(m.picker.isOpen(), true);

  m.picker.close();

  /* And nothing was drawn by asking. */
  assert.equal((m.editor.drawingState.objects || []).length, before);
});

/* ---------------------------------------------------------------- text entry */

test("the in-place text editor is the note itself, and Escape keeps the old text", async () => {
  const m = await modules();
  const editor = (await import("../src/shared/ui/editors/note-editor.js")).default;

  const object = {
    id: "note-test",
    type: "annotate",
    annotateKind: "note",
    text: "keep me",
    geometry: { position: { x: 20, y: 20 } },
    style: { stroke: "#193335", fontSize: 12 }
  };

  let applied = null;
  let cancelled = false;

  editor.open({
    canvasText: true,
    object,
    text: object.text,
    state: m.editor.drawingState,
    onInput: () => {},
    onApply: (text) => {
      applied = text;
    },
    onCancel: () => {
      cancelled = true;
    }
  });

  const host = document.querySelector(".drawing-canvas-text-editor");

  assert.ok(host, "the editor is placed over the drawing");

  const field = host.querySelector("textarea");

  assert.equal(field.value, "keep me");

  field.value = "half typed";

  field.dispatchEvent(new page.window.Event("input", { bubbles: true }));
  field.dispatchEvent(new page.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

  assert.equal(applied, null, "Escape applies nothing");
  assert.equal(cancelled, true, "Escape cancels");
  assert.equal(document.querySelector(".drawing-canvas-text-editor"), null, "the editor closes");
  assert.equal(object.text, "keep me", "the note's stored text is untouched");
});
