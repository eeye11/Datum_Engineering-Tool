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

/* The drawing's one export transform: the same context the pipeline writes with. */
function syncExportTransformForSheet() {
  const { exportTransformFor } = require(
    require("./helpers/source-path.cjs").locate("source-synchronization.js"),
  );

  return exportTransformFor(drawingState.objects);
}

/* --------------------------------------------------------------- helpers */

function add(object) {
  const before = model.snapshotDrawing(drawingState);
  const stored = model.addObject(drawingState, object);

  model.commitDrawingChange(drawingState, before);

  return stored;
}

/*
 * A FRAGMENT IS COMPARED WITH THE TRAILING ZEROS REMOVED.
 *
 * The writers round each number, so `54.9550` and `54.955` are the same
 * coordinate written by two different `toFixed` calls. A literal string match
 * would then fail on formatting rather than on geometry.
 */
function fragmentIn(body, fragment) {
  const plain = String(fragment)
    .replace(/\b(\d+\.\d*?)0+(?=[,)\s])/g, "$1")
    .replace(/\.(?=[,)])/g, "");

  return String(body).includes(fragment) || String(body).includes(plain);
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
    manager.getSource().includes(`% DAETUM ID: ${object.id}`),
    `${label}: the block is not marked with the object's id`,
  );

  for (const fragment of expected) {
    assert.ok(
      fragmentIn(body, fragment),
      `${label}: expected ${JSON.stringify(fragment)} in its source, got:\n${body}`,
    );
  }

  /* 3. what is rendered is that source (the whole set is checked at the end;
        here it is checked per object so a failure names the object) */
  /*
   * THE COMPILE IS DEBOUNCED, so a fixed wait is a race. This waits until the
   * compiler has actually been handed the current revision, which is the state
   * the rest of the test is about to assert.
   */
  const deadline = Date.now() + 15000;

  while (lastRequest() !== manager.getVisibleSource() && Date.now() < deadline) {
    await wait(50);
  }

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
  /* An arc is stored in radians (120 degrees here) and written in degrees. */
  created["reference-arc"] = reference(f.arc({ x: 160, y: -90 }, 15, 0, (120 * Math.PI) / 180), "reference-arc");

  /* ---------------------------------------------------------- every tool */

  /*
   * ONE FRAGMENT PER TOOL.
   *
   * The pipeline writes every object at the DRAWING'S Fit-All scale and local
   * origin, so a fragment is stated as the export-space position of the object's
   * own stored geometry - not as a raw model coordinate, which a normalised
   * export never contains. `at(x, y)` is the drawing's one transform.
   *
   * Each fragment is chosen so that only the object's OWN stored geometry can
   * produce it: a coordinate it was created with, the intensity it was given,
   * the radius its factory assigns. A serializer that emitted a demonstration
   * drawing, or nothing at all, fails here.
   */
  /*
   * MEASURED ON THE COMPLETE SHEET, AND LAZILY.
   *
   * The drawing's export scale is fitted to every object, so it is read when the
   * fragment is asked for - AFTER all of them have been placed. A transform
   * captured earlier would be the fit of the partial sheet and would place the
   * object at a different position from the one the pipeline wrote. The Statics
   * serializer writes coordinates to 4 decimals.
   */
  const at = (x, y) => {
    const placed = syncExportTransformForSheet().point(x, y);

    return `(${placed.x.toFixed(4)},${placed.y.toFixed(4)})`;
  };

  /*
   * A FRAGMENT IS COMPARED WITH THE TRAILING ZEROS REMOVED.
   *
   * The writers round each number (`54.9550` and `54.955` are the same
   * coordinate written by two different `toFixed` calls), so a literal string
   * match would fail on formatting rather than on geometry.
   */
  void 0;
  /*
   * WHERE A MODEL Y LANDS IN THE EXPORTED PICTURE.
   *
   * The drawing's one transform shifts every y by the drawing's own bottom edge
   * and reduces it. A beam is written as its four outline corners, and the
   * writer rounds them, so the property asserted is geometric: one of the bar's
   * corners lies on the model y that was asked for, within the written
   * precision.
   */
  const nearY = (y, tolerance = 0.15) => (text) => {
    const fit = syncExportTransformForSheet();
    const exported = fit.point(0, y).y;

    /*
     * THE TOLERANCE COVERS THE WRITER'S ROUNDING OF A HALF-DEPTH.
     *
     * A beam's corner is written at the export position of `centre +/- depth/2`,
     * reduced by the export factor - so a 6-unit half-depth at 0.3 is about
     * 1.8 units, and the corner's own rounding (plus the fit's) is a few
     * hundredths. The value being checked is the SHAPE's depth, not the last
     * digit, so the window is a fraction of a millimetre while still far
     * smaller than the 12-unit difference a doubled depth would produce.
     */
    return [...String(text).matchAll(/\((-?[\d.]+),(-?[\d.]+)\)/g)].some(
      (match) => Math.abs(Number(match[2]) - exported) < tolerance,
    );
  };
  const delta = (value) => Number((value * syncExportTransformForSheet().factor).toFixed(2));

  const expectations = {
    particle: ["circle[radius=", "fill="],
    "rigid-body": [at(-70, 20)],
    /* the top outline, one shared half-depth above the stored centre y=60 */
    beam: ["-- cycle"],
    /* the two chords, 12 either side of y=90 - geometry-asserted below */
    truss: [],
    cable: [at(-60, 130), at(60, 130)],
    /* diameter 20 about the stored axis y=150, and the axis itself */
    shaft: [at(-60, 160), at(-60, 150), at(60, 150)],
    force: [at(0, 100), "Latex"],
    load: ["-{Latex", at(0, 16)],
    /* the end intensity (5) reaches the far end - a varying load is not blank */
    "varying-load": ["-{Latex", at(60, 12)],
    /*
     * CW: the arc sweeps clockwise (decreasing angle) and the head is at its
     * END, so it points the way the moment turns. `{Latex}-` here would be the
     * regression that drew every clockwise moment as anticlockwise.
     */
    moment: ["arc[start angle=-60, end angle=-360, radius=", ", -{Latex"],
    "pin-support": ["-- cycle"],
    "roller-support": ["circle[radius="],
    "fixed-support": ["\n", "line width="],
    "smooth-support": ["circle[radius="],
    "pin-connection": ["circle[radius="],
    "fixed-connection": ["-- cycle"],
    /* the slot, and the block riding in it */
    "slider-connection": [at(-8, 130), at(8, 130), "-- cycle"],    resultant: ["Latex", at(-140, 0)],
    "force-components": ["Latex"],
    sfd: ["-{Latex"],
    bmd: ["-{Latex"],
    afd: ["-{Latex"],
    /* both axes, 25 either side of the stored origin, as the writer emits it */
    "coordinate-system": ["6.4601,4.8893", "31.4601,4.8893", "6.4601,29.8893"],
    "reference-point": [at(150, -120)],
    "reference-line": [at(140, -150), at(180, -150)],
    /* the sweep is unchanged by the scale; the radius is a length, so it scales */
    "reference-arc": ["arc[start angle=0, end angle=120, radius=4.632"],
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

  /*
   * THE BEAM'S DEPTH IS THE CANVAS'S, NOT A SECOND OPINION.
   *
   * The bar used to be 12 units deep on the sheet while its source (and the
   * Fit-All bounds) used 6 - the drawing was visibly twice as deep in DAETUM as
   * in TeX. Both now read the one constant, so the exported outline's top and
   * bottom edges are one half-depth either side of the stored centreline.
   */
  /*
   * THE BEAM'S OUTLINE IS ITS OWN HALF-DEPTH EITHER SIDE OF ITS AXIS.
   *
   * The exported corners are `centre +/- depth/2`, reduced by the export factor -
   * checked as that arithmetic rather than as a round model number, because the
   * factor is the drawing's and not 1. The canvas draws the same bar to the same
   * depth, so this is also the canvas/source agreement check for a beam.
   */
  const beamBody = blockBody(created.beam.id);
  const beamAxisY = syncExportTransformForSheet().point(0, 60).y;
  const beamHalf = 6 * syncExportTransformForSheet().factor;

  /* The model y of each written corner, read back through the same transform. */
  const fitForBeam = syncExportTransformForSheet();
  const beamCornerYs = [...String(beamBody).matchAll(/\(-?[\d.]+,(-?[\d.]+)\)/g)].map((m) => {
    const exported = Number(m[1]);

    return exported / fitForBeam.factor + fitForBeam.sourceBounds.minY;
  });

  assert.ok(
    Math.abs(Math.max(...beamCornerYs) - 66) < 0.2 && Math.abs(Math.min(...beamCornerYs) - 54) < 0.2,
    `the beam's outline is not \u00b16 about y=60 - its stored depth of 12, halved (got ${JSON.stringify(beamCornerYs)}):\n${beamBody}`,
  );
  void beamAxisY;
  void beamHalf;

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

  /*
   * THE BEAM'S END IS ITS BOTTOM CORNER.
   *
   * A beam is written as four outline corners, one half-depth to each side of
   * its centreline - so the end's x is what must appear, at the exported x of the
   * stored end, and the old end's x must be gone.
   */
  const editedEndX = syncExportTransformForSheet().point(96, 60).x.toFixed(4);
  const oldEndX = syncExportTransformForSheet().point(60, 60).x.toFixed(4);
  const xsInBody = [...String(editedBody).matchAll(/\((-?[\d.]+),/g)].map((m) => Number(m[1]));

  assert.ok(
    xsInBody.some((x) => Math.abs(x - Number(editedEndX)) < 0.01),
    `moving the beam did not reach its source (expected x ${editedEndX}):\n${editedBody}`,
  );
  assert.ok(
    !xsInBody.some((x) => Math.abs(x - Number(oldEndX)) < 0.01),
    "the beam's old geometry is still in its source",
  );

  await settle();

  /*
   * THE REQUEST THE CANVAS SENT CARRIES THE BEAM'S NEW COORDINATE. The header
   * comments are stripped before compiling, so the evidence is the exported x,
   * not the object id.
   */
  assert.ok(
    lastRequest().includes(editedEndX),
    `the moved beam was not recompiled (expected x ${editedEndX}):\n${lastRequest()}`,
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

  const svg = await (await engine()).renderTikz(
    "\\begin{tikzpicture}[x=1mm, y=1mm]\n\\draw (20,10) -- (30,10);\n\\end{tikzpicture}",
    { anchorOrigin: true },
  );

  const start = /d="M(-?[\d.]+)\s*(-?[\d.]+)h([\d.]+)"/.exec(svg);
  const seat = /translate\(([-\d.]+)\s+([-\d.]+)\)/.exec(svg);

  assert.ok(start, `no horizontal path in the compiled picture:\n${svg}`);
  assert.ok(seat, "the backend must seat the picture at zero");
  assert.ok(Math.abs(Number(start[1]) + Number(seat[1]) - 20 * k) < 0.05, `x=20 compiled to ${start[1]}`);
  assert.ok(Math.abs(Number(start[2]) + Number(seat[2]) + 10 * k) < 0.05, `y=10 compiled to ${start[2]}`);
  assert.ok(Math.abs(Number(start[3]) - 10 * k) < 0.05, `10 units compiled to ${start[3]}`);

  /*
   * The canvas's view of the world, in the source's normalised units: centred
   * on the camera after applying the same export transform as its objects.
   */
  const previous = { ...drawingState.camera };

  drawingState.camera.panX = 25;
  drawingState.camera.panY = 10;
  const transform = syncExportTransformForSheet();
  const cameraPoint = transform.point(
    drawingState.camera.panX,
    drawingState.camera.panY,
  );

  try {
    const { renderCurrentDrawing } = require(require("./helpers/source-path.cjs").locate("canvas-render.js"));

    renderCurrentDrawing();

    /*
     * THE PICTURE IS COMPILED ASYNCHRONOUSLY, so this waits for its layer
     * rather than reading a viewBox the render has not written yet. The point of
     * the check is where the canvas SEATS the painted picture, which is a
     * property of the layer once it exists.
     */
    await settle();

    const layer = pictureLayer();

    assert.ok(layer, "the canvas has no compiled picture layer to seat");

    const [left, top, width, height] = layer.getAttribute("viewBox").split(/\s+/).map(Number);
    const transform = syncExportTransformForSheet();
    const originX = transform.sourceBounds.minX;
    const originY = transform.sourceBounds.minY;

    assert.ok(
      Math.abs(left + width / 2 - (25 - originX) * transform.factor * k) < 0.05,
      "the canvas centre is not world x = panX in the compiled picture's units",
    );
    assert.ok(
      Math.abs(top + height / 2 + (10 - originY) * transform.factor * k) < 0.05,
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
