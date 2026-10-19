/*
 * ========================================================
 * THE .enggdraw ROUND TRIP
 * ========================================================
 *
 * THE AUDIT'S CENTRAL QUESTION, asked as a test:
 *
 *     Could Datum delete the entire in-memory document, reopen only the
 *     .enggdraw file, and reconstruct the complete editable engineering
 *     drawing with all relationships intact?
 *
 * So this builds a document containing every feature kind the model supports,
 * wraps it in the real file envelope, serialises it to TEXT, parses it back,
 * runs it through the real reader and migration, rebuilds the state, and then
 * compares the two models - structurally, field by field, not by screenshot.
 *
 * A field that is dropped on the way through shows up here as a difference,
 * which is what makes this the useful test rather than an inspection.
 */

const { JSDOM } = require("jsdom");

const { modulePath } = require("./helpers/source-path.cjs");

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

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "https://datum.test/",
});

global.window = dom.window;
global.document = dom.window.document;
global.Element = dom.window.Element;

const state = require(modulePath("drawing-state.js")).default;
const file = require(modulePath("document-file.js")).default;
const sheets = require(modulePath("sheets.js")).default;

/* ============================================================
 * THE FIXTURE: one of everything
 * ============================================================ */

/*
 * Build a document with as many feature kinds as the model supports, and as
 * many of the RELATIONSHIP shapes as possible:
 *
 *   - geometry with sub-edges (triangle, rectangle, polygon)
 *   - statics attached to a body (support, moment, load)
 *   - a load with a multi-point profile (the varying load)
 *   - analysis reading a body (a diagram with its axis)
 *   - dimensions: linear, angular across TWO EDGES OF ONE FEATURE, variable
 *   - annotations of several kinds, including a table with cells
 *   - constraints and a locked feature
 *   - a sheet saved with a (retired) world-scale calibration, which must be dropped
 */
function buildFixture() {
  const st = state.createDrawingState();

  const F = state.geometryFactories;

  const line = F.line({ x: 0, y: 0 }, { x: 120, y: 0 });
  const beam = F.beam({ x: 0, y: 60 }, { x: 160, y: 60 });
  const triangle = F.triangle([
    { x: 200, y: 0 },
    { x: 260, y: 0 },
    { x: 200, y: 40 },
  ]);
  const rectangle = F.rectangle({ x: 0, y: 120 }, 90, 50);
  const polygon = F.polygon({
    center: { x: 320, y: 160 },
    radius: 40,
    sides: 6,
    rotation: 0,
  });
  const circle = F.circle({ x: 420, y: 40 }, 25);
  const point = F.point({ x: 60, y: -40 });

  /* A support ON the beam, and a moment at a point on it. */
  const support = F["pin-support"]({ x: 40, y: 60 });
  support.parentId = beam.id;

  const moment = F.moment({ x: 120, y: 60 }, 250, 0);
  moment.parentId = beam.id;

  /* A force, so the analysis can read something. */
  const force = F.force(
    { x: 80, y: 60 },
    { x: 80, y: 20 },
    { magnitude: 500, angleDegrees: -90 },
  );
  force.parentId = beam.id;

  /*
   * A VARYING LOAD: the one with a PROFILE, whose number of points and their
   * values must survive exactly - it cannot be regenerated from a rendering.
   */
  const varying = F["varying-load"](
    { x: 0, y: 60 },
    { x: 160, y: 60 },
    10,
    30,
  );

  varying.parentId = beam.id;

  /* An analysis diagram reading the beam. */
  const diagram = F["shear-force-diagram"](
    { x: 0, y: 60 },
    { x: 160, y: 60 },
  );

  diagram.parentId = beam.id;
  diagram.engineering = {
    ...(diagram.engineering || {}),
    sourceFeatureId: beam.id,
  };

  /* A LINEAR dimension on the line. */
  const linear = F.dimension({
    dimensionType: "horizontal",
    refs: [
      { kind: "between", featureId: line.id, anchor: "start" },
      { kind: "between", featureId: line.id, anchor: "end" },
    ],
    placement: { x: 60, y: -20 },
  });

  /*
   * AN ANGULAR DIMENSION ACROSS TWO EDGES OF ONE FEATURE. This is the case the
   * audit singles out: the file must still know WHICH two edges after reload.
   */
  const angular = F.dimension({
    dimensionType: "angular",
    refs: [
      {
        kind: "between",
        featureId: triangle.id,
        anchor: "segment0Start",
        endAnchor: "segment0End",
      },
      {
        kind: "between",
        featureId: triangle.id,
        anchor: "segment2Start",
        endAnchor: "segment2End",
      },
    ],
    placement: { x: 210, y: 10 },
  });

  /*
   * A dimension whose text is a SYMBOL, not a measurement. The separate
   * Variable Dimension tool is retired; the unified Dimension carries the
   * symbol as its editable label text.
   */
  const variable = F.dimension({
    dimensionType: "aligned",
    refs: [
      { kind: "between", featureId: line.id, anchor: "start" },
      { kind: "between", featureId: line.id, anchor: "end" },
    ],
    label: "L",
    placement: { x: 30, y: -60 },
  });

  /* Annotations of several kinds, including a table with real cells. */
  const note = F.annotate({
    kind: "note",
    text: "Assume negligible self-weight",
    position: { x: 400, y: -40 },
  });

  const label = F.annotate({
    kind: "label",
    text: "A",
    position: { x: 10, y: 10 },
    targetFeatureId: point.id,
  });

  const leader = F.annotate({
    kind: "leader",
    text: "Reaction",
    targetFeatureId: support.id,
    start: { x: 40, y: 60 },
    end: { x: 90, y: 20 },
  });

  const table = F.annotate({
    kind: "table",
    position: { x: 500, y: 200 },
    rows: 2,
    columns: 3,
    cells: ["x", "2", "4", "y", "1", "3"],
  });

  const tolerance = F.annotate({
    kind: "tolerance",
    position: { x: 600, y: 40 },
    toleranceMode: "deviation",
    toleranceValues: { upper: 0.05, lower: -0.02 },
  });

  /*
   * A CONSTRAINT and a LOCK, which are different things: the constraint says
   * an ordinate is fixed, the lock says the whole feature cannot be moved.
   */
  triangle.constraints = { "position.y": true };
  rectangle.locked = true;

  [
    line,
    beam,
    triangle,
    rectangle,
    polygon,
    circle,
    point,
    support,
    moment,
    force,
    varying,
    diagram,
    linear,
    angular,
    variable,
    note,
    label,
    leader,
    table,
    tolerance,
  ].forEach((object) => state.addObject(st, object));

  /*
   * THE FIXTURE IS RETURNED WITH ITS NAMES, so the comparisons below can say
   * `support.parentId` rather than an index - which is what makes a failure
   * read as the relationship that broke.
   */
  st.__fixture = {
    line,
    beam,
    triangle,
    rectangle,
    polygon,
    circle,
    point,
    support,
    moment,
    force,
    varying,
    diagram,
    linear,
    angular,
    variable,
    note,
    label,
    leader,
    table,
    tolerance,
  };

  return st;
}

/* ============================================================
 * THE ROUND TRIP
 * ============================================================ */

const original = buildFixture();

/* The fixture's features by name, for readable assertions below. */
const {
  line,
  beam,
  triangle,
  rectangle,
  polygon,
  circle,
  point,
  support,
  moment,
  force,
  varying,
  diagram,
  linear,
  angular,
  variable,
  note,
  label,
  leader,
  table,
  tolerance,
} = original.__fixture;

/* A sheet-level calibration, so world scale is exercised. */
original.scale = {
  unitsPerMillimetre: 0.5,
  unit: "mm",
  calibrated: true,
};

const collection = sheets.createCollection();

collection.sheets[0].objects = original.objects;

original.historySinks = {
  capture: () => sheets.serializeCollection(collection).sheets,
  restore: () => {},
};

/* --- SAVE ---------------------------------------------------------------- */

const saved = file.createDocument(
  JSON.parse(state.serializeDrawing(original)),
);

/* THE FILE IS TEXT ONCE, AND ONLY TEXT COMES BACK. */
const text = JSON.stringify(saved);

check(
  "the file is JSON text, so nothing survives by memory reference",
  typeof text === "string" && text.length > 0,
);

/* --- LOAD ---------------------------------------------------------------- */

const parsed = JSON.parse(text);

const read = file.readDocument(parsed);

check(
  "the file reads back without error",
  read.ok === true,
  read.ok ? "" : `${read.failure}: ${read.detail}`,
);

const reopened = state.createDrawingState();

state.restoreDocument(reopened, read.document);

reopened.scale = read.document.scale;

/* ============================================================
 * STRUCTURAL COMPARISON
 * ============================================================ */

console.log("\n  every feature comes back, with its identity\n");

check(
  "the feature count is unchanged",
  reopened.objects.length === original.objects.length,
  `${original.objects.length} saved, ${reopened.objects.length} reloaded`,
);

check(
  "and the ids are the same, in the same order",
  reopened.objects.every(
    (object, index) => object.id === original.objects[index].id,
  ),
  "ids are what every relationship is built on",
);

check(
  "every feature type survives",
  reopened.objects.every(
    (object, index) => object.type === original.objects[index].type,
  ),
);

check(
  "the feature NAMES survive",
  reopened.objects.every(
    (object, index) => object.name === original.objects[index].name,
  ),
);

console.log("\n  geometry, to the number\n");

check(
  "geometry is identical for every feature",
  JSON.stringify(reopened.objects.map((o) => o.geometry)) ===
    JSON.stringify(original.objects.map((o) => o.geometry)),
  "coordinates, profiles, table grids and cell contents all live here",
);

check(
  "appearance (style) is identical",
  JSON.stringify(reopened.objects.map((o) => o.style)) ===
    JSON.stringify(original.objects.map((o) => o.style)),
);

console.log("\n  relationships, which are the point of the audit\n");

const byId = (list) => Object.fromEntries(list.map((o) => [o.id, o]));

const before = byId(original.objects);
const after = byId(reopened.objects);

check(
  "a support is still attached to its body",
  after[support.id].parentId === support.parentId,
  `parentId ${after[support.id].parentId} vs ${support.parentId}`,
);

check(
  "a moment is still attached to its body",
  after[moment.id].parentId === moment.parentId,
);

check(
  "an analysis diagram still names the body it reads",
  after[diagram.id].engineering?.sourceFeatureId === beam.id,
  JSON.stringify(after[diagram.id].engineering),
);

console.log("\n  the SUB-EDGE angular dimension\n");

check(
  "the angular dimension still names BOTH edges of the one triangle",
  (() => {
    const refs = after[angular.id].sourceRefs || [];

    return (
      refs.length === 2 &&
      refs[0].featureId === triangle.id &&
      refs[1].featureId === triangle.id &&
      refs[0].anchor === "segment0Start" &&
      refs[0].endAnchor === "segment0End" &&
      refs[1].anchor === "segment2Start" &&
      refs[1].endAnchor === "segment2End"
    );
  })(),
  JSON.stringify(after[angular.id].sourceRefs),
);

check(
  "and its type is preserved",
  after[angular.id].dimensionType === "angular",
);

check(
  "a linear dimension keeps both of its anchors",
  (after[linear.id].sourceRefs || []).length === 2,
);

console.log("\n  symbolic values are NOT replaced by measurements\n");

check(
  "a dimension labelled with a symbol reopens as its SYMBOL, not a number",
  after[variable.id].label === "L",
  `label is ${JSON.stringify(after[variable.id].label)}`,
);

console.log("\n  annotations, including a table's cells\n");

check(
  "a note keeps its text",
  after[note.id].text === note.text,
  after[note.id].text,
);

check(
  "a label keeps its target",
  after[label.id].targetFeatureId === point.id,
);

check(
  "a leader keeps its target AND both of its ends",
  after[leader.id].targetFeatureId === support.id &&
    after[leader.id].geometry.start.x === leader.geometry.start.x &&
    after[leader.id].geometry.end.y === leader.geometry.end.y,
);

check(
  "a table keeps its size and every cell",
  after[table.id].geometry.rows === 2 &&
    after[table.id].geometry.columns === 3 &&
    JSON.stringify(after[table.id].geometry.cells) ===
      JSON.stringify(["x", "2", "4", "y", "1", "3"]),
  JSON.stringify(after[table.id].geometry),
);

check(
  "a tolerance keeps its mode and its values",
  after[tolerance.id].geometry.toleranceMode === "deviation" &&
    after[tolerance.id].geometry.toleranceValues.upper === 0.05 &&
    after[tolerance.id].geometry.toleranceValues.lower === -0.02,
);

check(
  "and every annotate feature keeps its kind",
  reopened.objects
    .filter((o) => o.type === "annotate")
    .every((o, index) =>
      ["note", "label", "leader", "table", "tolerance"].includes(
        o.annotateKind,
      ) && o.annotateKind === [
        "note",
        "label",
        "leader",
        "table",
        "tolerance",
      ][index],
    ),
);

console.log("\n  constraints and the lock are DIFFERENT things\n");

check(
  "an ordinate constraint survives",
  after[triangle.id].constraints?.["position.y"] === true,
  JSON.stringify(after[triangle.id].constraints),
);

check(
  "a locked feature reopens locked",
  after[rectangle.id].locked === true,
);

check(
  "locking is not stored as a constraint",
  !after[rectangle.id].constraints?.["position.y"] &&
    !after[triangle.id].locked,
  "the two must not be conflated",
);

console.log("\n  units, and the retired world scale\n");

/*
 * The world-length scale is retired: a calibration left in a document from an
 * older build is not written back, so the reopened drawing has none.
 */
check(
  "a retired world-scale calibration is not carried into the reopened drawing",
  reopened.scale === undefined || reopened.scale === null,
  JSON.stringify(reopened.scale),
);

check(
  "and the working unit survives",
  Boolean(reopened.units),
);

console.log("\n  a varying load keeps its PROFILE, point for point\n");

check(
  "the profile's points survive exactly",
  JSON.stringify(after[varying.id].geometry?.profile) ===
    JSON.stringify(varying.geometry?.profile) ||
    JSON.stringify(after[varying.id].geometry) ===
      JSON.stringify(varying.geometry),
  JSON.stringify(after[varying.id].geometry),
);

console.log("\n  what must NOT be in the file\n");

check(
  "no mouse, hover, selection or preview state is saved",
  !/"cursor"/.test(text) &&
    !/"hovered/.test(text) &&
    !/"snapCandidate"/.test(text) &&
    !/"preview"/.test(text),
  "editor-only state must never become document content",
);

check(
  "and no absolute filesystem path is embedded",
  !/[A-Za-z]:\\\\/.test(text) && !/"file:\/\//.test(text),
  "a path would break the file on another machine",
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
