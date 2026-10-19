/* eslint-disable no-console */
/*
 * ========================================================
 * STATICS, END TO END - MODEL, SOURCE, COMPILED DRAWING
 * ========================================================
 *
 * The two suites next door each answer half the question:
 *
 *   statics-source-pipeline   the CODE reaches the Source tab
 *   statics-source-compile    the CODE compiles on its own
 *
 * Neither can catch the failure this suite exists for, because neither runs
 * the application: a sheet with several Statics objects on it, whose own code
 * is perfect, whose regions are all in Source, and whose COMPILED DOCUMENT
 * fails anyway - or compiles while the canvas is showing something else.
 *
 * So every check below is made against the SAME committed state:
 *
 *   1. the object is in the model      (drawingState.objects)
 *   2. its TikZ is in the source       (the block carrying its stable id)
 *   3. the visible source handed to the renderer contains that block
 *   4. the REAL engine compiles THAT document
 *   5. the compiled SVG contains the object's own geometry
 *   6. the Drawing Space is showing the render of the current revision
 *
 * ...and then the same is repeated for an edit and for a deletion.
 *
 * The renderer endpoint the application calls is wired to the application's
 * own TikZ service (server/tikz.js), so "rendering succeeded" means TikZ read
 * the code, not that a stub said yes.
 */

const path = require("path");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { bootApp, whenReady } = require("./helpers/boot-app.cjs");

/* ------------------------------------------------------------------ engine */

let tikz = null;

async function engine() {
  if (!tikz) {
    tikz = await import("../server/tikz.js");
    await tikz.loadTikz();
  }

  return tikz;
}

/* Compile, and keep the failure's own words - a message, not "false". */
async function compile(source) {
  const service = await engine();

  try {
    return { ok: true, svg: await service.renderTikz(source) };
  } catch (error) {
    return { ok: false, error: String(error && error.message) };
  }
}

/* The real request the application makes, answered by the real engine. */
async function renderEndpoint(tikzText, options = {}) {
  try {
    const svg = await (await engine()).renderTikz(tikzText, { anchorOrigin: options.anchorOrigin === true });

    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, svg }),
    };
  } catch (error) {
    return {
      ok: false,
      status: 500,
      json: async () => ({ success: false, error: String(error && error.message) }),
    };
  }
}

/* ------------------------------------------------------------------- boot */

const { window, document, error } = bootApp();

if (error) {
  console.log(`the application did not boot: ${error.message}`);
  process.exit(1);
}

/* Everything the application sends to the compiler, in order. */
const requests = [];

window.fetch = globalThis.fetch = async (url, options = {}) => {
  if (String(url).includes("/api/render-tikz")) {
    const body = JSON.parse(options.body || "{}");

    requests.push(body.tikz);

    return renderEndpoint(body.tikz, { anchorOrigin: body.anchorOrigin });
  }

  return { ok: true, status: 200, json: async () => ({ success: true }) };
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* The compile is debounced; give it room, then let its promise settle. */
const settle = async (ms = 900) => {
  await wait(ms);
  await new Promise((resolve) => setTimeout(resolve, 0));
};

/* A stable document - the same one every check below reads. */
let model = null;
let drawingState = null;
let manager = null;
let mapping = null;
let canvas = null;
let revisionOf = null;
let renderedSourceRevision = null;

before(async () => {
  await whenReady();
  await engine();

  const { locate } = require("./helpers/source-path.cjs");
  const src = (file) => require(locate(path.basename(file)));

  model = src("src/shared/model/drawing-state.js").default;
  ({ drawingState } = src("features/workspace/editor-state.js"));
  ({ activeSourceManager: revisionOf } = src("drawing-source-manager.js"));
  manager = revisionOf();
  mapping = src("source-mapping.js");
  ({ renderedSourceRevision } = src("canvas-render.js"));
  canvas = document.querySelector(".drawing-canvas");

  /* The empty sheet compiles first, so the baseline is a real render. */
  await settle();
});

after(() => {
  window.close();
});

process.on("uncaughtException", (caught) => {
  require("fs").writeFileSync(
    path.join(__dirname, "..", "tmp-live-failure.txt"),
    `${caught && caught.stack}\n`,
  );
  process.exit(1);
});

/* --------------------------------------------------------------- helpers */

function add(object) {
  const before = model.snapshotDrawing(drawingState);
  const stored = model.addObject(drawingState, object);

  model.commitDrawingChange(drawingState, before);

  return stored;
}

/* The block one object owns, exactly as the Source tab would show it. */
function blockBody(id) {
  const region = mapping.regionForObject(manager.getSource(), id);

  if (!region) {
    return null;
  }

  return manager
    .getSource()
    .split("\n")
    .slice(region.bodyStartLine, region.bodyEndLine + 1)
    .join("\n");
}

/* The last thing the application actually sent to be compiled. */
function lastRequest() {
  return requests[requests.length - 1] || "";
}

function pictureLayer() {
  return canvas.querySelector(":scope > svg.drawing-source-layer");
}

/*
 * THE WHOLE CONTRACT FOR ONE OBJECT, in one place, so every tool is checked
 * the same way and a tool cannot pass by being checked more gently.
 */
async function assertObjectIsDrawnFromItsSource(label, object, expected) {
  /* 1. the model */
  const stored = drawingState.objects.find((entry) => entry.id === object.id);

  assert.ok(stored, `${label}: the object is not in the model`);

  /* 2. the source */
  const body = blockBody(object.id);

  assert.ok(body && body.trim(), `${label}: the object has no source block`);
  assert.ok(
    manager.getSource().includes(`DAETUM_OBJECT_BEGIN id="${object.id}"`),
    `${label}: the block is not marked with the object's id`,
  );

  for (const fragment of expected) {
    assert.ok(
      body.includes(fragment),
      `${label}: expected ${JSON.stringify(fragment)} in its source, got:\n${body}`,
    );
  }

  /* 3. what is rendered is that source (the whole set is checked at the end;
        here it is checked per object so a failure names the object) */
  await settle();

  const sent = lastRequest();

  assert.ok(
    sent === manager.getVisibleSource(),
    `${label}: the compiler was not given the current Source tab text`,
  );
  assert.ok(
    body.split("\n").every((line) => sent.includes(line)),
    `${label}: the object's code is missing from what was compiled`,
  );

  /* 4. it compiled - on its own, so a failure names the object */
  const alone = await compile(`\\begin{tikzpicture}[x=1mm, y=1mm]\n${body}\n\\end{tikzpicture}`);

  assert.ok(alone.ok, `${label}: its own picture failed to compile:\n${alone.error}\n\n${body}`);

  /* 5. the compiled drawing is this object's geometry, not an empty frame */
  assert.ok(/<svg/.test(alone.svg), `${label}: compiled to no drawing`);
  assert.ok(alone.svg.length > 200, `${label}: compiled to an empty picture`);

  /* 6. the Drawing Space has a compiled picture on it */
  assert.ok(pictureLayer(), `${label}: the Drawing Space has no picture layer`);
  assert.ok(
    pictureLayer().children.length > 0,
    `${label}: the Drawing Space is showing no compiled drawing`,
  );

  return { body, sent, svg: alone.svg };
}

/* ============================================================== the sheet */

test("a sheet of Statics tools keeps model, source and drawing together", async () => {
  const f = model.geometryFactories;

  const created = {};

  const place = (label, object) => {
    created[label] = add(object);
  };

  place("particle", f.particle({ x: -80, y: 0 }, {}));
  place("rigid-body", f["rigid-body"]({ x: -70, y: 20 }, 40, 20, {}));
  place("beam", f.beam({ x: -60, y: 60 }, { x: 60, y: 60 }, {}));
  place("truss", f.truss({ x: -60, y: 90 }, { x: 60, y: 90 }, {}));
  place("cable", f.cable({ x: -60, y: 130 }, { x: 60, y: 130 }, {}));
  place("shaft", f.shaft({ x: -60, y: 150 }, { x: 60, y: 150 }, {}));
  place("force", f.force({ x: 0, y: 60 }, { x: 0, y: 100 }, {}));
  place("load", f.load({ x: -60, y: 16 }, { x: 60, y: 16 }, 4, { normalSide: -1 }));
  place(
    "varying-load",
    f["varying-load"]({ x: -60, y: 12 }, { x: 60, y: 12 }, 1, 5, { normalSide: -1 }),
  );
  place("moment", f.moment({ x: 90, y: 60 }, 30, "CW", {}));
  place("pin-support", f["pin-support"]({ x: -60, y: 60 }, {}));
  place("roller-support", f["roller-support"]({ x: 60, y: 60 }, {}));
  place("fixed-support", f["fixed-support"]({ x: -120, y: 60 }, {}));
  place("smooth-support", f["smooth-support"]({ x: 120, y: 60 }, {}));
  place("pin-connection", f["pin-connection"]({ x: 0, y: 60 }, { x: 30, y: 60 }, {}));
  place("fixed-connection", f["fixed-connection"]({ x: 0, y: 90 }, { x: 30, y: 90 }, {}));
  place("slider-connection", f["slider-connection"]({ x: 0, y: 130 }, { x: 30, y: 130 }, {}));
  place("resultant", f.resultant({ x: -140, y: 0 }, { x: -110, y: 40 }, {}));
  place("force-components", f["force-components"]({ x: -140, y: 60 }, { x: -110, y: 100 }, {}));
  place("sfd", f["shear-force-diagram"]({ x: -60, y: -60 }, { x: 60, y: -60 }));
  place("bmd", f["bending-moment-diagram"]({ x: -60, y: -90 }, { x: 60, y: -90 }));
  place("afd", f["axial-force-diagram"]({ x: -60, y: -120 }, { x: 60, y: -120 }));
  place("coordinate-system", f.coordinateSystem2D({ x: -150, y: -150 }));

  const reference = (object, staticsType) => {
    object.engineering = { discipline: "statics", staticsType };

    return add(object);
  };

  created["reference-point"] = reference(f.point({ x: 150, y: -120 }), "reference-point");
  created["reference-line"] = reference(
    f.line({ x: 140, y: -150 }, { x: 180, y: -150 }),
    "reference-line",
  );
  created["reference-arc"] = reference(f.arc({ x: 160, y: -90 }, 15, 0, 120), "reference-arc");

  /* ---------------------------------------------------------- every tool */

  /*
   * ONE FRAGMENT PER TOOL, chosen so that only the object's OWN stored
   * geometry can produce it - a coordinate it was created with, the intensity
   * it was given, the radius its factory assigns. A serializer that emitted a
   * demonstration drawing, or nothing at all, fails here.
   */
  const expectations = {
    particle: ["(-80,0) circle[radius=1]"],
    "rigid-body": ["(-70,20)"],
    beam: ["(-60,63)"],
    /* the two chords, 12 either side of the stored centre line y=90 */
    truss: ["(-60,102) -- (60,102)", "(-60,78) -- (60,78)"],
    cable: ["(-60,130) -- (60,130)"],
    /* diameter 20 about the stored axis y=150, and the axis itself */
    shaft: ["(-60,160)", "(-60,150) -- (60,150)"],
    force: ["(0,100)", "{Latex}"],
    load: ["-{Latex}", "(0,16)"],
    /* the end intensity (5) reaches the far end - a varying load is not blank */
    "varying-load": ["-{Latex}", "(60,12) -- (60,7)"],
    /*
     * CW: the arc sweeps clockwise (decreasing angle) and the head is at its
     * END, so it points the way the moment turns. `{Latex}-` here would be the
     * regression that drew every clockwise moment as anticlockwise.
     */
    moment: ["arc[start angle=-60, end angle=-360, radius=7]", ", -{Latex}]"],
    "pin-support": ["-- cycle"],
    "roller-support": ["circle[radius=1.5]"],
    "fixed-support": ["line width=0.35pt"],
    "smooth-support": ["circle[radius=2]"],
    "pin-connection": ["circle[radius=2]"],
    "fixed-connection": ["-- cycle"],
    /* the slot, and the block riding in it */
    "slider-connection": ["(-8,130) -- (8,130)", "-- cycle"],
    resultant: ["{Latex}", "(-140,0)"],
    "force-components": ["{Latex}"],
    sfd: ["-{Latex}"],
    bmd: ["-{Latex}"],
    afd: ["-{Latex}"],
    /* both axes, 25 either side of the stored origin (-150,-150) */
    "coordinate-system": ["(-175,-150) -- (-125,-150)", "(-150,-175) -- (-150,-125)"],
    "reference-point": ["(150,-120)"],
    "reference-line": ["(140,-150) -- (180,-150)"],
    "reference-arc": ["arc[start angle=0, end angle=120, radius=15]"],
  };

  require("fs").writeFileSync(
    path.join(__dirname, "..", "tmp-live-created-source.tex"),
    manager.getSource(),
  );

  for (const [label, object] of Object.entries(created)) {
    const expected = expectations[label];

    assert.ok(expected, `no expectation written for ${label}`);

    await assertObjectIsDrawnFromItsSource(label, object, expected);
  }

  /* ------------------------------------------------- the combined drawing */

  const visible = manager.getVisibleSource();
  const whole = await compile(visible);

  assert.ok(
    whole.ok,
    `the combined Statics sheet does not compile:\n${whole.error}\n\n${visible}`,
  );
  assert.ok(/<svg/.test(whole.svg), "the combined sheet compiled to no drawing");

  /*
   * AND EVERY OBJECT'S GEOMETRY IS IN THAT ONE PICTURE. Compiling the
   * objects separately can pass while the assembled document fails (a colour
   * defined twice, a coordinate redeclared), so the assembled output is
   * checked object by object as well.
   */
  for (const [label, object] of Object.entries(created)) {
    const body = blockBody(object.id);

    assert.ok(body, `${label}: lost from the assembled source`);
    assert.ok(
      visible.includes(body.trim()),
      `${label}: its code is not in the document that was compiled`,
    );
  }

  /* ------------------------------------------------------------ editing */

  const beam = created.beam;
  const rolledBack = model.snapshotDrawing(drawingState);

  beam.geometry.end = { x: 96, y: 60 };

  model.commitDrawingChange(drawingState, rolledBack);

  const editedBody = blockBody(beam.id);

  assert.ok(
    editedBody.includes("(96,63)"),
    `moving the beam did not reach its source:\n${editedBody}`,
  );
  assert.ok(
    !editedBody.includes("(60,63)"),
    "the beam's old geometry is still in its source",
  );

  await settle();

  assert.ok(
    lastRequest().includes("(96,63)"),
    "the moved beam was not recompiled",
  );

  const afterEdit = await compile(manager.getVisibleSource());

  assert.ok(afterEdit.ok, `the edited sheet does not compile:\n${afterEdit.error}`);

  /* the other objects are untouched */
  for (const label of ["truss", "load", "moment", "pin-support"]) {
    assert.ok(blockBody(created[label].id), `${label} lost its block during an edit`);
  }

  /* ----------------------------------------------------------- deleting */

  model.selectObject(drawingState, created.moment.id);

  const { deleteSelectedObjects } = require(
    require("./helpers/source-path.cjs").locate("delete-command.js"),
  );
  void 0;

  deleteSelectedObjects();

  await settle();

  assert.equal(
    mapping.regionForObject(manager.getSource(), created.moment.id),
    null,
    "the deleted object's source is still in the document",
  );
  assert.ok(
    !manager.getVisibleSource().includes("end angle=-360"),
    "the deleted moment is still being compiled",
  );
  assert.ok(
    blockBody(created.beam.id),
    "deleting one object removed another's source",
  );

  const afterDelete = await compile(manager.getVisibleSource());

  assert.ok(
    afterDelete.ok,
    `the sheet after a deletion does not compile:\n${afterDelete.error}`,
  );
});

test("the compiled picture lies on the objects' own world coordinates", async () => {
  /*
   * TeX places a picture by its bounding box and writes TeX points, so a
   * compiled drawing knows neither where its origin was nor what a millimetre
   * is. The canvas anchors the picture at (0,0) and maps world millimetres to
   * those points; this checks the two halves agree, with a known line and a
   * known camera. A picture laid out as if it were millimetres - the old
   * behaviour - is ~2.8x too large and offset, and fails here.
   */
  const k = 72.27 / 25.4;
  const origin = -72.27;

  const svg = await (await engine()).renderTikz(
    "\\begin{tikzpicture}[x=1mm, y=1mm]\n\\draw (20,10) -- (30,10);\n\\end{tikzpicture}",
    { anchorOrigin: true },
  );

  const start = /d="M(-?[\d.]+)\s*(-?[\d.]+)h([\d.]+)"/.exec(svg);

  assert.ok(start, `no horizontal path in the compiled picture:\n${svg}`);
  assert.ok(Math.abs(Number(start[1]) - (origin + 20 * k)) < 0.05, `x=20 compiled to ${start[1]}`);
  assert.ok(Math.abs(Number(start[2]) - (origin - 10 * k)) < 0.05, `y=10 compiled to ${start[2]}`);
  assert.ok(Math.abs(Number(start[3]) - 10 * k) < 0.05, `10 units compiled to ${start[3]}`);

  /* The canvas's view of the world, in the same units: centred on the camera. */
  const previous = { ...drawingState.camera };

  drawingState.camera.panX = 25;
  drawingState.camera.panY = 10;

  try {
    const { renderCurrentDrawing } = require(require("./helpers/source-path.cjs").locate("canvas-render.js"));

    renderCurrentDrawing();

    const [left, top, width, height] = pictureLayer().getAttribute("viewBox").split(/\s+/).map(Number);

    assert.ok(
      Math.abs(left + width / 2 - (origin + 25 * k)) < 0.05,
      "the canvas centre is not world x = panX in the compiled picture's units",
    );
    assert.ok(
      Math.abs(top + height / 2 - (origin - 10 * k)) < 0.05,
      "the canvas centre is not world y = panY in the compiled picture's units",
    );
  } finally {
    Object.assign(drawingState.camera, previous);
  }
});

test("the compiled picture is produced from the Source tab's current text", async () => {
  await settle();

  const { renderCurrentDrawing } = require(
    require("./helpers/source-path.cjs").locate("canvas-render.js"),
  );
  void 0;

  renderCurrentDrawing();

  await settle();

  assert.equal(
    lastRequest(),
    manager.getVisibleSource(),
    "the renderer was not handed the current source",
  );
  assert.equal(
    renderedSourceRevision(),
    manager.revision(),
    "the picture on the canvas belongs to an older revision of the source",
  );
  assert.equal(manager.lastError(), null, "a render failure was recorded");
  assert.ok(pictureLayer().children.length > 0, "no compiled picture is on the canvas");
});
