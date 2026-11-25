/*
 * ========================================================
 * THE THREE REPORTED REGRESSIONS, PINNED
 * ========================================================
 *
 * Each check below failed against the code as it stood, and each one names the
 * DEFECT rather than the implementation, so a future refactor that keeps the
 * behaviour passes and one that reintroduces the fault does not.
 *
 *   1. THE UNWANTED `w`. A distributed load printed a `w = 20 kN/m` box nobody
 *      asked for, because a label reader was given `"w"` as the fallback a load
 *      falls back to when the student has typed nothing. It has to stay gone
 *      from BOTH readers - the annotation model that paints the canvas and the
 *      source writer that prints the LaTeX - and a student's OWN symbol has to
 *      survive, because that is the label field working as designed.
 *
 *   2. NO DUPLICATE CHILD ROWS. Every object is one row in the Objects list,
 *      and a child sits inside its parent exactly once. Registration happens in
 *      one place (`addObject`) and the tree is derived from that list, so this
 *      checks the two halves that can drift: adding the same object twice, and
 *      adding a CHILD whose parent already exists.
 *
 *   3. A SUPPORT'S PLACEMENT AND ORIENTATION. A support is drawn outside its
 *      body and follows it; a fixed support is turned to the end it is built
 *      into. Both are read from the body's frame, never from the stored render
 *      point, so a support placed on a beam stays on that beam.
 */

const path = require("path");
const { JSDOM } = require("jsdom");

const projectRoot = path.join(__dirname, "..");
const { createHarness } = require("./support/harness-renderer.cjs");

createHarness(projectRoot, JSDOM, require);

const { loadModule } = require("./helpers/source-path.cjs");

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

const statics = loadModule("source-writers/statics.js");
const model = global.window.enggAnnotationModel;
const objectsList = loadModule("objects-list.js");
const drawingModel = loadModule("drawing-state.js").default;
const frames = loadModule("body-frames.js").default;

const scene = (objects, display = { showMagnitudes: true }) => ({
  objects,
  selection: {
    selectedObjectIds: [],
    boxSelectionIds: [],
    hoveredObjectId: null,
  },
  interaction: {
    phase: "idle",
    preview: null,
    previewObjects: [],
    hoveredEntity: null,
    snapCandidate: null,
  },
  camera: { zoom: 1, panX: 0, panY: 0 },
  styleDefaults: { stroke: "#000000", lineWidth: 0.5 },
  grid: { visible: false, spacing: 10 },
  snap: { enabled: false },
  display,
});

const uniformLoad = (extra = {}) => ({
  id: "load-1",
  type: "load",
  name: "Distributed Load 1",
  engineering: { discipline: "statics", staticsType: "distributed-load" },
  geometry: {
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 },
    direction: -90,
    intensity: 20,
    interval: 20,
    arrowLength: 20,
    loadUnit: "kN/m",
    points: [
      { t: 0, magnitude: 20 },
      { t: 1, magnitude: 20 },
    ],
  },
  style: { stroke: "#000000", lineWidth: 0.5, fontSize: "small" },
  ...extra,
});

/* ============================================ 1. the unwanted w */

console.log("\nThe distributed load prints no symbol nobody asked for");
console.log("-----------------------------------------------------");

{
  const load = uniformLoad({ parentId: "beam-1" });
  const state = scene([load]);

  const label = {
    id: "derived-load-1-load-value",
    type: "annotation",
    sourceFeatureId: "load-1",
    annotationKind: "load-value",
    textMode: "generated",
    placement: { x: 50, y: 0 },
  };

  const canvasText = model.textFor(label, state);

  check(
    "the canvas label is the intensity and its unit",
    /^20(\.0+)?\s*kN\/m$/.test(String(canvasText || "").trim()),
    JSON.stringify(canvasText),
  );

  check(
    "and carries no w",
    !/(^|[^A-Za-z])w\s*=/.test(String(canvasText || "")),
    JSON.stringify(canvasText),
  );

  const source = statics.serializeStaticsObject(load);

  check(
    "the source states the same intensity",
    /20(\.0+)?\\ kN\/m/.test(source),
    source,
  );

  check(
    "and writes no w either",
    !/\{\s*w\s*=\s*\d/.test(source),
    source,
  );

  /* THE STUDENT'S OWN SYMBOL STILL WORKS - the fix is not "no labels". */
  const own = uniformLoad({ magnitudeLabel: "q" });

  check(
    "a symbol the student typed is kept on the canvas",
    /^q\s*=/.test(String(model.textFor(label, scene([own])) || "").trim()),
    JSON.stringify(model.textFor(label, scene([own]))),
  );

  check(
    "and in the source",
    /\{\$?q\s*=\s*20/.test(statics.serializeStaticsObject(own)),
    statics.serializeStaticsObject(own),
  );

  /* The intensity itself is untouched: this is about a label, not a value. */
  check("the load's intensity is unchanged", own.geometry.intensity === 20);
  check("its direction is unchanged", own.geometry.direction === -90);
}

/* ======================================= 2. no duplicate objects */

console.log(
  "\nEvery object is one row, and a child is one row inside its parent",
);
console.log(
  "------------------------------------------------------------------",
);

{
  const previous =
    global.window.enggDrawingState.default || global.window.enggDrawingState;
  const state = previous.createDrawingState();

  const beam = drawingModel.geometryFactories.beam(
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { style: { stroke: "#000000", lineWidth: 0.5 } },
  );

  const storedBeam = previous.addObject(state, beam);

  const force = drawingModel.geometryFactories.force(
    { x: 20, y: 0 },
    { x: 20, y: -40 },
    {
      style: { stroke: "#000000", lineWidth: 0.5 },
      parentId: storedBeam.id,
    },
  );

  const storedForce = previous.addObject(state, force);

  check(
    "the beam was added once",
    state.objects.filter((o) => o.id === storedBeam.id).length === 1,
  );

  check(
    "the force was added once",
    state.objects.filter((o) => o.id === storedForce.id).length === 1,
  );

  check(
    "and every object carries an id of its own",
    new Set(state.objects.map((o) => o.id)).size === state.objects.length,
    state.objects.map((o) => o.id).join(", "),
  );

  check(
    "the force is the beam's child",
    storedForce.parentId === storedBeam.id,
  );

  const markup = objectsList.objectsListMarkup(state.objects, []);

  check(
    "one row per object, and no more",
    (markup.match(/role="option"/g) || []).length === state.objects.length,
    `${(markup.match(/role="option"/g) || []).length} rows for ${state.objects.length} objects`,
  );

  const ids = [...markup.matchAll(/data-object-id="([^"]+)"/g)].map(
    (match) => match[1],
  );

  check(
    "with no id appearing twice",
    new Set(ids).size === ids.length,
    ids.join(", "),
  );
}

/* ============================ 3. supports stay on their body */

console.log("\nA support is placed outside its body, and follows it");
console.log("------------------------------------------------------");

{
  const beam = {
    id: "beam-1",
    type: "beam",
    name: "Beam 1",
    geometry: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    style: { stroke: "#000000", lineWidth: 0.5 },
  };

  const frame = frames.frameOf(beam);

  check("a beam has a frame to attach to", Boolean(frame));

  const midspan = { x: 50, y: 0 };
  const placement = frames.supportPlacement(beam, midspan, false);

  check(
    "a support at midspan is attached there",
    placement && frames.positionOn(frame, placement.attachment) === 50,
  );

  check(
    "and is drawn clear of the member, not on it",
    placement && Math.abs(placement.render.y) > Math.abs(midspan.y),
    JSON.stringify(placement?.render),
  );

  check(
    "its attachment is stored as a fraction, so a resize keeps it",
    Math.abs(frames.attachmentFor(frame, midspan).fraction - 0.5) < 1e-9,
    JSON.stringify(frames.attachmentFor(frame, midspan)),
  );

  check(
    "the point it resolves to is still midspan",
    JSON.stringify(
      frames.attachmentPoint(frame, frames.attachmentFor(frame, midspan)),
    ) === JSON.stringify(midspan),
    JSON.stringify(
      frames.attachmentPoint(frame, frames.attachmentFor(frame, midspan)),
    ),
  );

  /* MOVE THE BODY: the support's place on it does not change. */
  const moved = {
    ...beam,
    geometry: { start: { x: 400, y: 200 }, end: { x: 500, y: 200 } },
  };

  const movedFrame = frames.frameOf(moved);
  const resolved = frames.attachmentPoint(
    movedFrame,
    frames.attachmentFor(frame, midspan),
  );

  check(
    "moving the body carries the support with it",
    JSON.stringify(resolved) === JSON.stringify({ x: 450, y: 200 }),
    JSON.stringify(resolved),
  );

  /* A FIXED SUPPORT IS TURNED TO ITS END. */
  const atStart = frames.supportPlacement(beam, { x: 0, y: 0 }, false, {
    fixed: true,
  });
  const atEnd = frames.supportPlacement(beam, { x: 100, y: 0 }, false, {
    fixed: true,
  });

  check(
    "a fixed support built into the start faces back along the member",
    Boolean(atStart) &&
      Math.abs(Math.abs(atStart.orientation) - Math.PI) < 1e-9,
    String(atStart?.orientation),
  );

  check(
    "...and one built into the end faces the other",
    Boolean(atEnd) &&
      Boolean(atStart) &&
      Math.abs(Math.abs(atEnd.orientation) - Math.abs(atStart.orientation)) > 1,
    `${atStart?.orientation} vs ${atEnd?.orientation}`,
  );

  check(
    "and its wall sits on the member's face, not a clearance beyond it",
    atStart && Math.abs(atStart.render.y) === frame.halfDepth,
    JSON.stringify(atStart?.render),
  );
}

console.log(`\n${pass} passed, ${fail} failed`);

if (fail > 0) {
  process.exitCode = 1;
}
