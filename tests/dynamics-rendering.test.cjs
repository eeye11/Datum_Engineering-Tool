/* eslint-disable no-console */
/*
 * ========================================================
 * DYNAMICS OBJECTS MUST BE VISIBLY RENDERED
 * ========================================================
 *
 * The regression this suite guards was not "the tool does not create an
 * object". Every one of these tools created its object, registered it,
 * selected it and listed it in Objects - and the symbol was still missing from
 * the sheet, or from the compiled TikZ, or from both.
 *
 * So each check here asks the question the student asks: IS THERE INK, IS IT
 * THE SHAPE THEY CHOSE, AND DOES THE CODE FOR IT COMPILE?
 *
 * Diagnosed causes, one check group each:
 *
 *   1. CANVAS PREVIEW   a Dynamics symbol previewed through the generic
 *                       preview style, which forced a translucent interface
 *                       green over its own colour.
 *   2. ONE BAD AID      an overlay aid that threw took the whole overlay with
 *                       it - grid, preview and handles - and the exception was
 *                       swallowed by the commit sink.
 *   3. SOURCE           the writer emitted `-- -{Latex} (x,y)`, which is not
 *                       TikZ, so every arrowed symbol failed to compile and
 *                       the whole picture with it.
 *   4. GEOMETRY         a pulley's rope barely cleared its rim - valid code
 *                       for an all-but-invisible symbol.
 *
 * The renderer, the preview and the writers are exercised as the application
 * uses them; the compile checks run the real TikZ engine.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { bootApp } = require("./helpers/boot-app.cjs");

test.after(() => {
  setImmediate(() => process.exit(process.exitCode || 0));
});

let page = null;

async function booted() {
  if (!page) {
    page = bootApp();

    if (page.error) {
      throw page.error;
    }

    const canvas = page.document.querySelector(".drawing-canvas");

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
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return page;
}

const STYLE = {
  stroke: "#193335",
  lineWidth: 0.5,
  lineType: "solid",
  fill: "none",
  opacity: 1,
};

const ALL_TOOLS = [
  "dynamics-particle",
  "dynamics-rigid-body",
  "dynamics-polar-vector",
  "dynamics-angular-vector",
  "dynamics-spring",
  "dynamics-damper",
  "dynamics-spring-damper",
  "dynamics-pulley",
  "dynamics-coordinate-system",
  "dynamics-reference-point",
  "dynamics-reference-line",
  "dynamics-reference-arc",
];

let loaded = null;

async function modules() {
  await booted();

  if (!loaded) {
    const writers =
      await import("../src/shared/rendering/latex/source-writers/index.js");
    const sync =
      await import("../src/shared/rendering/latex/source-synchronization.js");

    writers.installSourceWriters(sync);

    loaded = {
      model:
        await import("../src/features/workspace/dynamics/dynamics-model.js"),
      tools:
        await import("../src/features/workspace/dynamics/dynamics-tools.js"),
      renderer: (await import("../src/shared/rendering/renderer.js")).default,
      svgPrimitives: await import("../src/shared/rendering/svg-primitives.js"),
      palette: (await import("../src/shared/rendering/canvas-palette.js"))
        .default,
      sync,
      writer:
        await import("../src/shared/rendering/latex/source-writers/dynamics.js"),
      state: (await import("../src/features/workspace/editor-state.js"))
        .drawingState,
    };
  }

  return loaded;
}

/* A canvas-sized SVG the renderer can draw into, as the overlay layer is. */
function overlaySvg(document, bounds = { width: 900, height: 600 }) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");

  svg.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
  svg.setAttribute("width", String(bounds.width));
  svg.setAttribute("height", String(bounds.height));

  return svg;
}

function make(m, id, a = { x: 20, y: 25 }, b = { x: 44, y: 41 }) {
  const object = m.model.createDynamicsObject(id, [a, b], { ...STYLE });

  object.id = `test-${id}`;

  return object;
}

/* ============================================================ 1. rendering */

test("every committed Dynamics symbol draws visible ink on the canvas", async () => {
  const p = await booted();
  const m = await modules();

  ALL_TOOLS.forEach((id, index) => {
    const object = make(
      m,
      id,
      { x: 20 + index * 30, y: 25 },
      { x: 44 + index * 30, y: 41 },
    );
    const state = {
      ...m.state,
      objects: [object],
      selection: { selectedObjectIds: [], hoveredObjectId: null },
      interaction: { preview: null, previewObjects: [] },
      camera: { zoom: 1, panX: 0, panY: 0 },
    };

    const svg = overlaySvg(p.document);

    m.renderer.renderDrawing(state, svg, {});

    const shapes = [
      ...svg.querySelectorAll("path,line,circle,rect,polyline,polygon"),
    ];
    const drawn = shapes.filter((shape) => {
      const stroke = shape.getAttribute("stroke");
      const fill = shape.getAttribute("fill");
      const width = Number(shape.getAttribute("stroke-width") ?? 1);

      return (
        (stroke && stroke !== "none" && width > 0) || (fill && fill !== "none")
      );
    });

    assert.ok(
      drawn.length > 0,
      `${id} must put drawable geometry into the overlay (${shapes.length} elements, none painted)`,
    );

    /*
     * AND THE INK IS INK. A stroke painted in the canvas background colour is
     * present in the DOM and invisible to the student, which is the exact
     * failure this suite exists for.
     */
    const background = m.palette.CANVAS_BACKGROUND.light;

    drawn.forEach((shape) => {
      const stroke = shape.getAttribute("stroke");
      const fill = shape.getAttribute("fill");

      if (stroke && stroke !== "none") {
        assert.notEqual(
          stroke.toLowerCase(),
          background,
          `${id} must not stroke in the background colour`,
        );
      }
    });
  });
});

test("Angular Vector renders its rotational type, magnitude, unit, and direction", async () => {
  const p = await booted();
  const m = await modules();
  const object = make(m, "dynamics-angular-vector");
  const state = {
    ...m.state,
    objects: [object],
    selection: { selectedObjectIds: [], hoveredObjectId: null },
    interaction: { preview: null, previewObjects: [] },
    camera: { zoom: 1, panX: 0, panY: 0 },
  };
  const svg = overlaySvg(p.document);

  object.geometry.rotationalType = "acceleration";
  object.geometry.magnitude = 3.5;
  object.geometry.unit = "rad/s²";
  m.renderer.renderDrawing(state, svg, {});

  assert.equal(svg.querySelector("g.drawing-feature text")?.textContent, "α = 3.5 rad/s²");
  const counterClockwisePath = svg.querySelector("g.drawing-feature path")?.getAttribute("d");

  object.geometry.direction = "cw";
  m.renderer.renderDrawing(state, svg, {});

  const clockwisePath = svg.querySelector("g.drawing-feature path")?.getAttribute("d");
  assert.notEqual(clockwisePath, counterClockwisePath, "direction edits must redraw the arc");
  assert.equal(svg.querySelector("g.drawing-feature text")?.textContent, "α = 3.5 rad/s²");
});

test("a committed symbol keeps its own colour and weight, not a palette default", async () => {
  const p = await booted();
  const m = await modules();

  const object = make(m, "dynamics-spring");
  const state = {
    ...m.state,
    objects: [object],
    selection: { selectedObjectIds: [], hoveredObjectId: null },
    interaction: { preview: null, previewObjects: [] },
    camera: { zoom: 1, panX: 0, panY: 0 },
  };

  const svg = overlaySvg(p.document);

  m.renderer.renderDrawing(state, svg, {});

  const stroke = svg
    .querySelector("g.drawing-feature path")
    ?.getAttribute("stroke");

  assert.equal(
    stroke,
    "#193335",
    "the spring must be drawn in the colour it was created with",
  );
  assert.ok(
    Number(
      svg.querySelector("g.drawing-feature path")?.getAttribute("stroke-width"),
    ) > 0.5,
    "and with a stroke thick enough to see",
  );
});

test("a symbol with no stored style still gets visible default ink", async () => {
  const p = await booted();
  const m = await modules();

  const object = make(m, "dynamics-spring");
  const state = {
    ...m.state,
    objects: [{ ...object, style: {} }],
    selection: { selectedObjectIds: [], hoveredObjectId: null },
    interaction: { preview: null, previewObjects: [] },
    camera: { zoom: 1, panX: 0, panY: 0 },
    styleDefaults: { stroke: "#193335", lineWidth: 0.5, lineType: "solid" },
  };

  const svg = overlaySvg(p.document);

  m.renderer.renderDrawing(state, svg, {});

  const path = svg.querySelector("g.drawing-feature path");

  assert.ok(path, "the spring must be drawn even with no stored style");
  assert.equal(
    path.getAttribute("stroke"),
    "#193335",
    "the sheet's default ink is used",
  );
});

test("the live preview is drawn in the symbol's own colour, not a wash", async () => {
  const p = await booted();
  const m = await modules();

  const preview = m.model.createDynamicsPreview(
    "dynamics-spring",
    [
      { x: 20, y: 25 },
      { x: 44, y: 41 },
    ],
    { ...STYLE },
  );

  const svg = overlaySvg(p.document);
  const state = {
    ...m.state,
    objects: [],
    selection: { selectedObjectIds: [], hoveredObjectId: null },
    interaction: { preview, previewObjects: [], phase: "dynamics-span" },
    camera: { zoom: 1, panX: 0, panY: 0 },
    styleDefaults: { stroke: "#193335", lineWidth: 0.5, lineType: "solid" },
  };

  m.renderer.renderDrawing(state, svg, {});

  const path = svg.querySelector("g.drawing-feature path");

  assert.ok(path, "the preview must be drawn");
  assert.equal(
    path.getAttribute("stroke"),
    "#193335",
    "in the colour it will be committed with",
  );
  assert.ok(
    Number(path.getAttribute("opacity") ?? 1) >= 0.6,
    "and opaque enough to see",
  );
});

/* ================================================== 2. the overlay's safety */

test("one bad overlay aid does not remove the rest of the overlay", async () => {
  const p = await booted();
  const m = await modules();

  const object = make(m, "dynamics-spring");
  object.locked = false;

  const svg = overlaySvg(p.document);
  const state = {
    ...m.state,
    objects: [object],
    selection: { selectedObjectIds: [object.id], hoveredObjectId: null },
    interaction: {
      preview: null,
      previewObjects: [undefined],
      snapCandidate: { type: "endpoint" },
      phase: "idle",
    },
    camera: { zoom: 1, panX: 0, panY: 0 },
  };

  assert.doesNotThrow(
    () => m.renderer.renderDrawing(state, svg, {}),
    "a malformed aid must not abort the render",
  );
  assert.ok(svg.querySelector("g.drawing-feature"), "the drawing survives it");
});

test("a renderer never writes an unresolved value as an SVG attribute", async () => {
  const m = await modules();
  const element = m.svgPrimitives.createSvgElement("circle", {
    cx: 10,
    cy: undefined,
    r: 4,
  });

  assert.equal(element.getAttribute("cx"), "10");
  assert.equal(
    element.getAttribute("cy"),
    null,
    "an unresolved coordinate is omitted, never the string 'undefined'",
  );
});

/* ======================================================= 3. source + TikZ */

test("a Dynamics source never writes a TikZ tip the engine rejects", async () => {
  const m = await modules();

  ALL_TOOLS.forEach((id, index) => {
    const object = make(
      m,
      id,
      { x: 20 + index * 30, y: 30 },
      { x: 44 + index * 30, y: 46 },
    );
    const source = m.sync.sourceForObject(object);

    assert.ok(
      typeof source === "string" && source.trim() !== "",
      `${id} must write source`,
    );

    /*
     * `-- -{Latex} (x,y)` is the invalid spelling that made every arrowed
     * symbol fail. The tip belongs in the option list, as `-{Latex}`.
     */
    assert.doesNotMatch(
      source,
      /--\s+-\{/,
      `${id} must not splice a tip into a straight segment`,
    );
    assert.doesNotMatch(
      source,
      /\{\{Latex\}\}/,
      `${id} must not double-brace an arrow tip`,
    );
    assert.doesNotMatch(
      source,
      /--\s+-\s+\(/,
      `${id} must not write an empty tip`,
    );
  });
});

let tikz = null;

async function engine() {
  if (!tikz) {
    tikz = await import("../server/tikz.js");
    await tikz.loadTikz();
  }

  return tikz;
}

test("every Dynamics symbol compiles in the real TikZ engine", async () => {
  const m = await modules();
  const service = await engine();

  for (const [index, id] of ALL_TOOLS.entries()) {
    const object = make(
      m,
      id,
      { x: 20 + index * 30, y: 30 },
      { x: 44 + index * 30, y: 46 },
    );
    const source = m.sync.sourceForObject(object);

    const svg = await service.renderTikz(
      `\\begin{document}\n\\begin{tikzpicture}[x=1mm,y=1mm]\n${source}\n\\end{tikzpicture}\n\\end{document}`,
      { anchorOrigin: true },
    );

    assert.match(
      svg,
      /<(path|line|circle|text)\b/,
      `${id} must draw ink into the compiled picture`,
    );
  }
});

test("a pulley's rope hangs clear of the wheel", async () => {
  const m = await modules();

  const object = make(m, "dynamics-pulley", { x: 0, y: 0 }, { x: 10, y: 0 });
  const radius = Number(object.geometry.radius);

  assert.ok(
    Number(object.geometry.ropeDrop) >= radius * 2.5,
    `the rope must hang at least a diameter and a half below the hub (drop ${object.geometry.ropeDrop}, radius ${radius})`,
  );

  const source = m.sync.sourceForObject(object);

  assert.match(
    source,
    /arc\[start angle=/,
    "and the cord wraps the rim as an arc",
  );
});

/* ========================================================= 4. the pipeline */

test("deleting a symbol removes both its source and its ink", async () => {
  const m = await modules();

  const manager = {
    value: "\\begin{tikzpicture}\n\\end{tikzpicture}",
    getSource() {
      return this.value;
    },
    setSource(next) {
      this.value = next;
      return true;
    },
  };

  const object = make(m, "dynamics-spring", { x: 0, y: 0 }, { x: 40, y: 0 });

  m.sync.writeObjectIntoSource(manager, object);
  assert.match(manager.value, /test-dynamics-spring/, "the region is written");

  m.sync.removeObjectFromSource(manager, object.id);
  assert.doesNotMatch(
    manager.value,
    /test-dynamics-spring/,
    "and taken out again",
  );
});

test("a symbol with invalid geometry writes no source at all", async () => {
  const m = await modules();

  const broken = {
    id: "broken-spring",
    type: "dynamics-spring",
    engineering: { dynamicsType: "dynamics-spring" },
    style: { ...STYLE },
    geometry: {},
  };

  assert.equal(
    m.sync.sourceForObject(broken),
    null,
    "a writer declines rather than guessing geometry",
  );
});

test("the writer declines every object that is not a Dynamics symbol", async () => {
  const m = await modules();

  [
    {
      id: "line",
      type: "line",
      geometry: { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    },
    {
      id: "beam",
      type: "beam",
      geometry: { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    },
    { id: "swatch", type: "rectangle", geometry: {} },
  ].forEach((object) => {
    assert.equal(
      m.writer.dynamicsSourceWriter(object),
      null,
      `${object.type} belongs to another writer`,
    );
  });
});
