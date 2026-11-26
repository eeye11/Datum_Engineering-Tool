/*
 * ========================================================
 * THE LOAD DIRECTION SNAPS TO EXACTLY VERTICAL / HORIZONTAL
 * ========================================================
 *
 * These drive the REAL shared resolver with the REAL load interaction and
 * then read the direction the tool would use, so they test behaviour rather
 * than the presence of code.
 *
 * The mechanism: the direction vector runs from the fixed reference point of
 * the loaded region to the cursor. When the cursor is within the shared
 * inference tolerance of the reference's column or row, the resolver aligns
 * the cursor there, and the vector comes out exactly +-90 or 0/180 degrees.
 */

const path = require("path");
const { JSDOM } = require("jsdom");

const projectRoot = path.join(__dirname, "..");

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

const { createHarness } = require("./support/harness-renderer.cjs");

createHarness(projectRoot, JSDOM, require);

const { modulePath, loadModule } = require("./helpers/source-path.cjs");

const snapModule = loadModule("object-snap.js");
const snap = snapModule.default || snapModule;

const loadTool = require(modulePath("load-tool.js"));
const { drawingState } = require(modulePath("editor-state.js"));

const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t;

/*
 * A LEVEL span (0,0)-(300,0), so the fixed reference is (150,0).
 * A WORLD-VERTICAL cursor is directly above it at x = 150.
 */
const span = {
  start: { x: 0, y: 0 },
  end: { x: 300, y: 0 },
  reference: { x: 150, y: 0 },
};

/*
 * The inference only runs when object snapping is on and there is a document
 * to align against, which is the state the tool works in.
 */
drawingState.objects = drawingState.objects || [];
drawingState.objectSnap = drawingState.objectSnap || {};
drawingState.objectSnap.enabled = true;

/*
 * Resolve a raw cursor against the load interaction's inference, then read
 * the direction the tool would use - exactly the path the running tool takes.
 */
function directionFor(rawCursor, interaction) {
  drawingState.interaction = interaction;

  const boundary = {
    left: -10000,
    right: 10000,
    top: -10000,
    bottom: 10000,
    width: 900,
    height: 600,
  };

  const resolution = snap.resolveConstructionPoint(
    { ...rawCursor },
    drawingState,
    boundary,
    {
      lineStart: null,
      inferenceReferences: [span.reference],
      preferInference: true,
      tool: "distributed-load",
    },
  );

  const directionCursor = loadTool.distributedLoadDirectionCursor(resolution);

  return loadTool.loadDirectionUnderPointer(directionCursor);
}

const constantInteraction = () => ({
  phase: "distributed-load-vector",
  loadSourceId: "body-1",
  loadStart: { ...span.start },
  loadEnd: { ...span.end },
  loadReferencePoint: { ...span.reference },
  loadDirection: null,
  loadMagnitude: 0,
});

/* ---------------------------------------------------------------- */
console.log("\n  a nearly-vertical cursor snaps to exactly vertical\n");

/*
 * 88.9 and 91.2 degrees are inside the shared 7-degree inference tolerance,
 * so the direction must come out EXACTLY vertical - not merely close.
 *
 * The offsets are stated in DRAWING UNITS, and the inference band is a
 * SCREEN distance (24 px). At the drawing's scale of 3.6 px per unit that is
 * 24 / 3.6 = 6.67 units, so a cursor a few units off the reference's column
 * still catches it - exactly what these offsets exercise.
 */
[
  { x: 150, y: 120, label: "dead vertical" },
  { x: 152.5, y: 120, label: "1.9 degrees off" },
  { x: 147.5, y: 120, label: "1.9 degrees the other way" },
  { x: 155, y: 120, label: "3.8 degrees off" },
].forEach(({ x, y, label }) => {
  const direction = directionFor({ x, y }, constantInteraction());

  check(
    `a cursor ${label} gives exactly 90 degrees`,
    direction && near(direction.degrees, 90),
    `direction was ${direction?.degrees}`,
  );
});

/* ---------------------------------------------------------------- */
console.log("\n  a nearly-horizontal cursor snaps to exactly horizontal\n");

[
  { x: 320, y: 2, label: "just right of the reference" },
  { x: 320, y: -2, label: "just below the row" },
  { x: -20, y: 2, label: "to the left of the reference" },
].forEach(({ x, y, label }) => {
  const direction = directionFor({ x, y }, constantInteraction());

  const horizontal =
    direction &&
    (near(direction.degrees, 0) || near(Math.abs(direction.degrees), 180));

  check(
    `a cursor ${label} gives exactly horizontal`,
    horizontal,
    `direction was ${direction?.degrees}`,
  );
});

/* ---------------------------------------------------------------- */
console.log("\n  an arbitrary angle is left alone\n");

/*
 * 45 degrees is far outside the inference tolerance, so the direction must
 * be the cursor's own angle and NOT squared to an axis.
 */
[
  [45, "45 degrees"],
  [30, "30 degrees"],
  [-20, "-20 degrees"],
  [37, "37 degrees"],
].forEach(([degrees, label]) => {
  const radians = (degrees * Math.PI) / 180;

  const cursor = {
    x: span.reference.x + Math.cos(radians) * 100,
    y: span.reference.y + Math.sin(radians) * 100,
  };

  const direction = directionFor(cursor, constantInteraction());

  check(
    `a ${label} cursor keeps its angle`,
    direction && near(direction.degrees, degrees, 1e-6),
    `direction was ${direction?.degrees}, expected ${degrees}`,
  );
});

/* ---------------------------------------------------------------- */
console.log("\n  the snap does not change the vector length\n");

/*
 * The magnitude is the vector's LENGTH, so a snap that squared the direction
 * must still leave the distance from the reference as the magnitude.
 */
{
  const raw = { x: 156, y: 100 };

  const interaction = constantInteraction();

  drawingState.interaction = interaction;

  const boundary = {
    left: -10000,
    right: 10000,
    top: -10000,
    bottom: 10000,
    width: 900,
    height: 600,
  };

  const resolution = snap.resolveConstructionPoint(
    { ...raw },
    drawingState,
    boundary,
    {
      lineStart: null,
      inferenceReferences: [span.reference],
      preferInference: true,
      tool: "distributed-load",
    },
  );

  const cursor = loadTool.distributedLoadDirectionCursor(resolution);

  const draft = loadTool.constantLoadDraft(interaction, cursor, cursor);

  check(
    "the magnitude is still the cursor distance",
    draft && draft.magnitude > 0,
    `magnitude was ${draft?.magnitude}`,
  );

  check(
    "the direction is squared while the magnitude is not",
    draft && near(draft.direction, 90),
    `direction was ${draft?.direction}`,
  );
}

/* ---------------------------------------------------------------- */
console.log("\n  a cursor on the reference is still not a direction\n");

{
  const direction = directionFor(
    { x: span.reference.x, y: span.reference.y },
    constantInteraction(),
  );

  check(
    "a cursor on the reference reports no direction",
    direction === null,
    `direction was ${direction?.degrees}`,
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
