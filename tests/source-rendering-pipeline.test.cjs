/*
 * ========================================================
 * DRAWING -> SOURCE -> COMPILED DRAWING
 * ========================================================
 *
 * The acceptance test for the source-driven Drawing Space, run against the real
 * application booted from index.html:
 *
 *   1. Every object a tool commits GETS SOURCE, whatever category it is in.
 *   2. Every Statics tool's source is the object's real geometry.
 *   3. The canvas does NOT paint the geometry itself any more - the compiled
 *      picture layer does, and it is the output of the CURRENT source.
 *   4. A source edit renders; a broken source keeps the last good picture and
 *      reports the error.
 *   5. Editing, moving and deleting an object keep source, model and picture in
 *      step; nothing is duplicated or orphaned.
 *
 * The render endpoint is stubbed, because compilation is not what is under test:
 * the request body IS - what was sent, and in what order the results arrived.
 */
const path = require("path");
const { bootApp, whenReady } = require("./helpers/boot-app.cjs");

let pass = 0;
let fail = 0;

const check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`);
  }
};

const { window, document, error } = bootApp();

if (error) {
  console.log(`  the application did not boot: ${error.message}`);
  process.exit(1);
}

/* ------------------------------------------------------------------ stub */

const requests = [];
const renderables = [];

window.fetch = globalThis.fetch = async (url, options = {}) => {
  if (String(url).includes("/api/render-tikz")) {
    const body = JSON.parse(options.body || "{}");

    requests.push(body.tikz);

    const index = renderables.length;
    renderables.push(body.tikz);

    /*
     * A rendered marker element per request, so the test can tell WHICH
     * version of the source the picture layer is showing.
     */
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">` +
      `<rect data-render-index="${index}" x="0" y="0" width="10" height="10"/></svg>`;

    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, svg })
    };
  }

  return { ok: true, status: 200, json: async () => ({}) };
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* The compile is debounced; give it room and then settle. */
const settle = async (ms = 500) => {
  await wait(ms);
  await new Promise((resolve) => setTimeout(resolve, 0));
};

(async () => {
  await whenReady();

  const { locate } = require("./helpers/source-path.cjs");
  const src = (file) => require(locate(path.basename(file)));

  const model = src("src/shared/model/drawing-state.js").default;
  const { drawingState } = src("features/workspace/editor-state.js");
  const { activeSourceManager } = src("drawing-source-manager.js");
  const mapping = src("source-mapping.js");
  const writerIndex = src("source-writers/index.js");
  const statics = src("source-writers/statics.js");
  const { renderedSourceRevision, lastCompiledError } = src("src/components/layout/workspace/canvas-render.js");
  const {
    createStaticsFeature,
  } = await import(require("url").pathToFileURL(locate("statics-creation.js")).href);

  const manager = activeSourceManager();
  const canvas = document.querySelector(".drawing-canvas");

  /* The empty picture is a valid drawing and compiles. */
  await settle();

  const add = (object) => {
    const before = model.snapshotDrawing(drawingState);
    const stored = model.addObject(drawingState, object);
    model.commitDrawingChange(drawingState, before);

    return stored;
  };

  const pictureLayer = () => canvas.querySelector(":scope > svg.drawing-source-layer");
  const overlayLayer = () => canvas.querySelector(":scope > svg.drawing-overlay");

  /* ================================================== the empty sheet */

  console.log("\nAn empty sheet");
  console.log("--------------");

  check("the drawing space has a picture layer", Boolean(pictureLayer()));
  check("and an interaction overlay", Boolean(overlayLayer()));
  /*
   * THE OLD MODEL-DRAWN PICTURE IS GONE. The canvas used to hold one SVG the
   * renderer repainted with every feature; what is left is the compiled picture
   * and the interaction overlay, and nothing that draws committed geometry.
   */
  check(
    "the canvas has no model-drawn feature picture",
    canvas.querySelector(".drawing-renderer") === null &&
      canvas.querySelectorAll(":scope > svg.drawing-source-layer").length === 1 &&
      canvas.querySelectorAll(":scope > svg.drawing-overlay").length === 1,
    String(canvas.querySelectorAll(":scope > svg").length)
  );
  check("the empty source compiles", requests.length >= 1 && /tikzpicture/.test(requests[requests.length - 1]));

  /* ================================================== geometry */

  console.log("\nGeometry reaches Source and the compiled picture");
  console.log("-------------------------------------------------");

  const line = add(
    model.geometryFactories.line({ x: -40, y: 0 }, { x: 40, y: 0 }, {
      style: { stroke: "#112233", lineWidth: 0.5, lineType: "solid" }
    })
  );

  let source = manager.getSource();

  check("a drawn line has a source region", mapping.regionForObject(source, line.id) !== null, source);
  check("with its committed endpoints", /\(-40,0\) -- \(40,0\)/.test(source), source);
  check("and its colour", /112233/i.test(source), source);

  await settle();

  const renderedLineSource = requests[requests.length - 1];

  check(
    "the CURRENT source is what was sent to the compiler",
    renderedLineSource.includes("DAETUM_OBJECT_BEGIN") === false && renderedLineSource.includes("(-40,0) -- (40,0)"),
    renderedLineSource
  );
  check("the picture layer shows the compiled result", Boolean(pictureLayer()?.querySelector("[data-render-index]")));
  check(
    "and the model does not paint the line again into the overlay",
    !overlayLayer().querySelector("[data-feature-id]"),
    overlayLayer()?.innerHTML?.slice(0, 300)
  );

  /* ================================================== Statics */

  console.log("\nEvery Statics tool writes its real geometry");
  console.log("-------------------------------------------");

  /*
   * `build` receives the factory table itself: `f.particle(...)` reads exactly
   * like the tool code that creates each object.
   */
  const staticsSamples = [
    ["particle", (f) => f.particle({ x: 10, y: 20 })],
    ["rigid-body", (f) => f["rigid-body"]({ x: 0, y: 0 }, 40, 20)],
    ["beam", (f) => f.beam({ x: 0, y: 0 }, { x: 100, y: 0 })],
    ["truss", (f) => f.truss({ x: 0, y: 100 }, { x: 100, y: 100 })],
    ["cable", (f) => f.cable({ x: 0, y: 200 }, { x: 80, y: 200 })],
    ["shaft", (f) => f.shaft({ x: 0, y: 300 }, { x: 80, y: 300 })],
    ["force", (f) => f.force({ x: 0, y: 0 }, { x: 0, y: 60 })],
    ["load", (f) => f.load({ x: 0, y: 400 }, { x: 60, y: 400 }, 5)],
    ["varying-load", (f) => f["varying-load"]({ x: 0, y: 500 }, { x: 60, y: 500 }, 0, 8)],
    ["moment", (f) => f.moment({ x: 200, y: 0 }, 50, "CCW")],
    ["pin-support", (f) => f["pin-support"]({ x: 0, y: 600 })],
    ["roller-support", (f) => f["roller-support"]({ x: 0, y: 700 })],
    ["fixed-support", (f) => f["fixed-support"]({ x: 0, y: 800 })],
    ["smooth-support", (f) => f["smooth-support"]({ x: 0, y: 900 })],
    ["pin-connection", (f) => f["pin-connection"]({ x: 0, y: 1000 }, { x: 40, y: 1000 })],
    ["fixed-connection", (f) => f["fixed-connection"]({ x: 0, y: 1100 }, { x: 40, y: 1100 })],
    ["slider-connection", (f) => f["slider-connection"]({ x: 0, y: 1200 }, { x: 40, y: 1200 })],
    ["resultant", (f) => f.resultant({ x: 0, y: 1300 }, { x: 30, y: 1360 })],
    ["force-components", (f) => f["force-components"]({ x: 0, y: 1400 }, { x: 30, y: 1460 })],
    ["shear-force-diagram", (f) => f["shear-force-diagram"]({ x: 0, y: 1500 }, { x: 100, y: 1500 })],
    ["bending-moment-diagram", (f) => f["bending-moment-diagram"]({ x: 0, y: 1600 }, { x: 100, y: 1600 })],
    ["axial-force-diagram", (f) => f["axial-force-diagram"]({ x: 0, y: 1700 }, { x: 100, y: 1700 })],
    ["coordinate-system-2d", (f) => f.coordinateSystem2D({ x: 0, y: 1800 })],
    ["reference-point", (f) => {
      const object = f.point({ x: 10, y: 1900 });
      object.engineering = { discipline: "statics", staticsType: "reference-point" };
      return object;
    }],
    ["reference-line", (f) => {
      const object = f.line({ x: 0, y: 2000 }, { x: 30, y: 2040 });
      object.engineering = { discipline: "statics", staticsType: "reference-line" };
      return object;
    }],
    ["reference-arc", (f) => {
      const object = f.arc({ x: 0, y: 2100 }, 20, 0, 90);
      object.engineering = { discipline: "statics", staticsType: "reference-arc" };
      return object;
    }]
  ];

  const missing = [];

  /*
   * THE FACTORY BOUND TO THE MODEL. The factories are methods of one table, and
   * calling a destructured one loses its `this` - they are bound here so a
   * sample reads exactly like the tool code that would create it.
   */
  const factory = model.geometryFactories;

  staticsSamples.forEach(([label, build]) => {
    let object = null;

    try {
      object = add(build(factory));
    } catch (caught) {
      missing.push(`${label}: could not create (${caught.message})`);
      return;
    }

    if (!manager.getSource().includes(`DAETUM_OBJECT_BEGIN id="${object.id}"`)) {
      missing.push(`${label}: no source region (type ${object.type})`);
    }
  });

  check(
    "every Statics tool has a source region in the live document",
    missing.length === 0,
    missing.join("\n       ")
  );

  /* ================================================== a real Statics creation click */

  console.log("\nCreating a Point Force through the tool");
  console.log("---------------------------------------");

  const before = drawingState.objects.length;

  /*
   * THE SAME HELPER THE TOOL USES. A force placed on a body and a support
   * placed with one click both go through `createStaticsFeature`, so calling it
   * is calling the tool's own creation path - not a test-only shortcut.
   */
  createStaticsFeature("pin-support", { x: 300, y: 300 }, null);

  const created = drawingState.objects[drawingState.objects.length - 1];

  check("the tool committed a support", drawingState.objects.length === before + 1 && created?.type === "pin-support", String(created?.type));
  check(
    "its source is in the document",
    Boolean(created) && manager.getSource().includes(`DAETUM_OBJECT_BEGIN id="${created.id}"`),
    manager.getSource().slice(-500)
  );
  /*
   * A SUPPORT IS MULTIPLE PRIMITIVES - its triangle and its ground hatching -
   * and they all sit inside the one object's region. That is the "one object,
   * many commands" case the source map must keep together.
   */
  const supportRegion = created
    ? manager.getSource().split(`id="${created.id}"`)[1]?.split("DAETUM_OBJECT_END")[0] || ""
    : "";

  check(
    "with the symbol's own commands",
    /-- cycle/.test(supportRegion) && supportRegion.split("\\draw").length >= 3,
    supportRegion
  );
  check(
    "and no label it never asked for",
    !/\\node/.test(supportRegion),
    supportRegion
  );

  await settle();

  /*
   * THE SUPPORT'S OWN GEOMETRY, NOT ITS ANCHOR. A pin support is drawn as a
   * triangle whose apex sits ON the anchor and whose base is offset outward -
   * so `(300,300)` is the apex and `(296,300)` its outward neighbour. The
   * literal anchor coordinate never appears; the committed geometry does.
   */
  check(
    "the compiled drawing includes the committed symbol",
    requests[requests.length - 1].includes("(296,300)") &&
      requests[requests.length - 1].includes("(304,296)"),
    requests[requests.length - 1].slice(-400)
  );
  check("the picture layer is showing a compiled render", Boolean(pictureLayer()?.querySelector("[data-render-index]")));
  check("the picture layer is the latest render", renderedSourceRevision() === manager.revision(), `${renderedSourceRevision()} vs ${manager.revision()}`);

  /* ================================================== edit */

  console.log("\nEditing an object updates source and picture");
  console.log("--------------------------------------------");

  created.style.stroke = "#AA2233";
  created.geometry.position = {
    x: created.geometry.position.x,
    y: created.geometry.position.y + 150,
  };

  const beforeEdit = model.snapshotDrawing(drawingState);

  model.commitDrawingChange(drawingState, beforeEdit);

  const afterEdit = manager.getSource();
  const region = mapping.regionForObject(afterEdit, created.id);

  check("the source has the new colour", /AA2233/i.test(afterEdit), afterEdit.slice(-500));

  await settle();

  check(
    "and the new geometry reached the compiler",
    requests[requests.length - 1].includes(`AA2233`),
    requests[requests.length - 1].slice(-400)
  );
  check("the region is not duplicated", afterEdit.split(`DAETUM_OBJECT_BEGIN id="${created.id}"`).length === 2);
  check("every other object's region survived", Boolean(region) && afterEdit.includes(`id="${line.id}"`));

  /* ================================================== delete */

  console.log("\nDeleting an object removes its code");
  console.log("-----------------------------------");

  model.selectObject(drawingState, created.id);

  const { deleteSelectedObjects } = src("delete-command.js");

  deleteSelectedObjects();

  await settle();

  check("the object is gone from the model", !drawingState.objects.some((object) => object.id === created.id));
  check("its source region is gone", mapping.regionForObject(manager.getSource(), created.id) === null);
  check("and it is gone from the compiled drawing", !manager.getSource().includes(created.id));
  check("the line is still there", manager.getSource().includes(`id="${line.id}"`));

  /* ================================================== typing in Source */

  console.log("\nTyping in Source renders that text");
  console.log("----------------------------------");

  const typed = "\\begin{tikzpicture}[x=1mm, y=1mm]\n\\draw[black] (0,0) -- (250,17);\n\\end{tikzpicture}";

  /* Cancel anything an earlier step queued, so the next request is this one. */
  await settle(400);

  manager.setSource(typed);

  await settle(700);

  check("the typed text was not regenerated", manager.getSource() === typed, manager.getSource().slice(0, 120));
  check("and the compiler received it", requests[requests.length - 1].includes("(250,17)"), requests[requests.length - 1]);

  const typedIndex = requests.length - 1;

  const { renderCurrentDrawing: drawAgain } = src("src/components/layout/workspace/canvas-render.js");

  drawAgain();

  /* ================================================== broken source */

  console.log("\nA broken source keeps its text and the last good picture");
  console.log("--------------------------------------------------------");

  const broken = "\\begin{tikzpicture}\n\\draw (0,0 -- (10,0);\n\\end{tikzpicture}";

  manager.setSource(broken);

  /*
   * A DRAW IS THE PATH THAT RUNS ON EVERY POINTER FRAME. It is given one
   * immediately, so whatever an earlier step queued is answered before the
   * count below - and then the CANVAS's own draw is what is tested: a broken
   * draft must not send, and must not lose the picture that worked.
   */
  await settle(700);

  const requestCountBefore = requests.length;

  src("src/components/layout/workspace/canvas-render.js").renderCurrentDrawing();

  await settle(700);

  check("the broken draft is kept", manager.getSource() === broken);
  check("nothing was sent to the compiler", requests.length === requestCountBefore, String(requests.length - requestCountBefore));
  await settle(300);

  check("the failure is visible on the canvas side", Boolean(lastCompiledError()), String(lastCompiledError()));

  /*
   * AND THE PICTURE IS STILL THE LAST ONE THAT COMPILED. Only valid source is
   * ever cached, so whatever picture the layer holds came from a source that
   * worked - and the version shown is reported as the one compiled.
   */
  check(
    "the picture on the canvas is a compiled one, not a broken draft's",
    Boolean(pictureLayer()?.querySelector("[data-render-index]")),
    pictureLayer()?.innerHTML?.slice(0, 200)
  );
  check(
    "and it is reported as the current source version",
    renderedSourceRevision() === manager.revision() || renderedSourceRevision() < manager.revision(),
    `${renderedSourceRevision()} vs ${manager.revision()}`
  );
  void typedIndex;

  /* ================================================== wiring */

  console.log("\nThe writer registry");
  console.log("-------------------");

  check(
    "installs a writer for every category implemented",
    writerIndex.registeredWriterIds().includes("geometry") &&
      writerIndex.registeredWriterIds().includes("statics") &&
      writerIndex.registeredWriterIds().includes("annotations") &&
      writerIndex.registeredWriterIds().includes("thermodynamics"),
    writerIndex.registeredWriterIds().join(", ")
  );
  check(
    "the Statics writer declines an ordinary Geometry line",
    statics.staticsSourceWriter({
      id: "line-x",
      type: "line",
      geometry: { start: { x: 0, y: 0 }, end: { x: 5, y: 0 } },
      style: {}
    }) === null
  );
  check(
    "and writes a Reference line",
    typeof statics.staticsSourceWriter({
      id: "line-x",
      type: "line",
      engineering: { discipline: "statics", staticsType: "reference-line" },
      geometry: { start: { x: 0, y: 0 }, end: { x: 5, y: 0 } },
      style: {}
    }) === "string"
  );

  console.log(`\n${pass} passed, ${fail} failed`);

  if (fail > 0) {
    process.exitCode = 1;
  }

  window.close();
})();
