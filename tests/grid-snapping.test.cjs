/* eslint-disable no-console */
/*
 * ========================================================
 * GRID SNAPPING
 * ========================================================
 *
 * The grid is a DRAWING AID. It has an interval in internal coordinates and it
 * does not establish an engineering scale: five units apart is five units apart
 * whether or not the document has been calibrated. Nothing here reads
 * `state.scale`, and nothing here needs a physical unit.
 *
 * THREE THINGS ARE HELD DOWN, because each was separately wrong before:
 *
 *   1. THE ORDER. Object snapping is asked FIRST. The grid is the fallback for
 *      empty space, so a grid snap can never steal a candidate the student was
 *      aiming at. This is the requirement's stated priority and it is the one
 *      an implementation is most likely to get backwards.
 *
 *   2. THE INTERVAL. Grid snapping lands on `state.grid.spacing`, NOT on the
 *      older finer `state.snap.spacing` - the two were one setting, which is
 *      why the settings page read a field nothing wrote and the row always
 *      said "On".
 *
 *   3. THE CAMERA. The interval is in internal coordinates, so zoom and pan
 *      cannot move the lattice. A point resolves to the same coordinate, and
 *      therefore to the same grid line, at every zoom - the drawn grid and the
 *      snap arithmetic are derived from the same number.
 *
 * The engine itself is exercised for real, through `resolveConstructionPoint`
 * and `gridSnapPoint`, rather than by reading the source. The wiring assertions
 * at the end read source only where the module is DOM-coupled and cannot be
 * imported, which is the technique `drag-snap-inference.test.cjs` already uses.
 */

const fs = require("fs");
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

const { createHarness } = require("./harness-renderer.cjs");

createHarness(projectRoot, JSDOM, require);

const { modulePath, loadModule } = require("./helpers/source-path.cjs");

const snapModule = loadModule("object-snap.js");
const snap = snapModule.default || snapModule;

const stateModule = loadModule("drawing-state.js");
const enggDrawingState = stateModule.default || stateModule;

const { drawingState } = require(modulePath("editor-state.js"));

const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t;

const boundary = {
  left: -10000,
  right: 10000,
  top: -10000,
  bottom: 10000,
  width: 900,
  height: 600,
};

/* ---------------------------------------------------------------- setup */

function resetState({ objects = [] } = {}) {
  drawingState.objects = objects;
  drawingState.selection = { selectedObjectIds: [] };
  drawingState.grid = { visible: true, spacing: 5, snapToGrid: true };
  drawingState.snap = { enabled: true, spacing: 1 };
  drawingState.camera = { zoom: 1, panX: 0, panY: 0 };
}

function resolve(rawPoint, options = {}) {
  return snap.resolveConstructionPoint(
    { ...rawPoint },
    drawingState,
    boundary,
    options,
  );
}

/* ============================================================ 1. helper */

console.log("\nThe grid snap helper");
console.log("-------------------");

resetState();

check(
  "a coordinate moves to the nearest grid line",
  near(enggDrawingState.gridSnapValue(12, drawingState), 10),
  `12 with spacing 5 -> ${enggDrawingState.gridSnapValue(12, drawingState)}`,
);

check(
  "and rounds up past the midpoint",
  near(enggDrawingState.gridSnapValue(13, drawingState), 15),
  `13 with spacing 5 -> ${enggDrawingState.gridSnapValue(13, drawingState)}`,
);

check(
  "an exact multiple is left alone",
  near(enggDrawingState.gridSnapValue(20, drawingState), 20),
);

check(
  "a negative coordinate snaps symmetrically",
  near(enggDrawingState.gridSnapValue(-12, drawingState), -10),
  `-12 -> ${enggDrawingState.gridSnapValue(-12, drawingState)}`,
);

const snappedPair = enggDrawingState.gridSnapPoint({ x: 12, y: -13 }, drawingState);

check(
  "both axes snap together - a two-dimensional point lands on an intersection",
  near(snappedPair.x, 10) && near(snappedPair.y, -15),
  `(${snappedPair.x}, ${snappedPair.y})`,
);

check(
  "grid snapping uses the GRID's spacing, not the older snap spacing",
  near(enggDrawingState.gridSnapValue(12, drawingState), 10) &&
    !near(enggDrawingState.gridSnapValue(12, drawingState), 12),
  "12 must land on 10 (grid spacing 5), not on 12 (snap spacing 1)",
);

/* ================================================= 2. disabled / defaults */

console.log("\nSwitching it off, and the default");
console.log("---------------------------------");

resetState();
drawingState.grid.snapToGrid = false;

check(
  "with grid snapping off the coordinate is untouched",
  near(enggDrawingState.gridSnapValue(12, drawingState), 12),
  `12 -> ${enggDrawingState.gridSnapValue(12, drawingState)}`,
);

const freshState = enggDrawingState.createDrawingState
  ? enggDrawingState.createDrawingState()
  : null;

check(
  "a fresh document has the grid visible",
  !freshState || freshState.grid.visible !== false,
);

check(
  "and grid snapping is ON by default while the grid is shown",
  !freshState || freshState.grid.snapToGrid !== false,
  "the requirement is that a visible grid snaps by default",
);

check(
  "grid snapping has its own field, separate from the snap spacing",
  !freshState ||
    !("snapToGrid" in (freshState.snap || {})) ||
    freshState.grid.snapToGrid !== undefined,
);

/* ========================================================= 3. the order */

console.log("\nObject snaps win over the grid");
console.log("------------------------------");

/*
 * A line whose endpoint sits DELIBERATELY off the grid, at (12, 12) - a point
 * the grid would move to (10, 10). If object snapping is asked first, the
 * endpoint is what the cursor takes. If the grid were asked first, the point
 * would be dragged to the grid intersection and the object snap would be lost.
 */
resetState({
  objects: [
    {
      id: "line-1",
      type: "line",
      geometry: {
        start: { x: 12, y: 12 },
        end: { x: 312, y: 12 },
      },
    },
  ],
});

const onEndpoint = resolve({ x: 12.2, y: 12.2 });

check(
  "a cursor within object-snap tolerance takes the endpoint, not the grid",
  near(onEndpoint.effectiveConstructionPoint.x, 12) &&
    near(onEndpoint.effectiveConstructionPoint.y, 12),
  `got (${onEndpoint.effectiveConstructionPoint.x}, ${onEndpoint.effectiveConstructionPoint.y}); the grid would have given (10, 10)`,
);

check(
  "and the snap candidate really is the endpoint",
  onEndpoint.snapCandidate?.type === "endpoint",
  `type was ${onEndpoint.snapCandidate?.type}`,
);

/*
 * Far from any candidate: the grid takes over. This is the other half of the
 * order, and the one that proves the grid is actually reached rather than the
 * branch being unreachable.
 */
const offInSpace = resolve({ x: 142.3, y: 87.6 });

check(
  "far from every object snap, the grid snaps the point",
  near(offInSpace.effectiveConstructionPoint.x, 140) &&
    near(offInSpace.effectiveConstructionPoint.y, 90),
  `got (${offInSpace.effectiveConstructionPoint.x}, ${offInSpace.effectiveConstructionPoint.y})`,
);

check(
  "and nothing was reported as a snap candidate",
  offInSpace.snapCandidate === null,
  `candidate was ${JSON.stringify(offInSpace.snapCandidate)}`,
);

/* ==================================================== 4. camera invariance */

console.log("\nZoom and pan do not move the lattice");
console.log("------------------------------------");

resetState();

const atZoom1 = resolve({ x: 142.3, y: 87.6 });

drawingState.camera = { zoom: 4.7, panX: -321.5, panY: 88.25 };

const atZoom4 = resolve({ x: 142.3, y: 87.6 });

check(
  "the same internal point snaps to the same grid line at any zoom",
  near(atZoom1.effectiveConstructionPoint.x, atZoom4.effectiveConstructionPoint.x) &&
    near(atZoom1.effectiveConstructionPoint.y, atZoom4.effectiveConstructionPoint.y),
  `zoom 1 -> (${atZoom1.effectiveConstructionPoint.x}, ${atZoom1.effectiveConstructionPoint.y}); zoom 4.7 -> (${atZoom4.effectiveConstructionPoint.x}, ${atZoom4.effectiveConstructionPoint.y})`,
);

check(
  "and the result is still a grid multiple after panning",
  near(atZoom4.effectiveConstructionPoint.x % 5, 0) &&
    near(atZoom4.effectiveConstructionPoint.y % 5, 0),
);

/* ============================================ 5. no engineering scale needed */

console.log("\nIt is a drawing aid, not an engineering scale");
console.log("---------------------------------------------");

resetState();
drawingState.scale = null;

const uncalibrated = resolve({ x: 142.3, y: 87.6 });

check(
  "grid snapping works on an uncalibrated document",
  near(uncalibrated.effectiveConstructionPoint.x, 140) &&
    near(uncalibrated.effectiveConstructionPoint.y, 90),
  "an uncalibrated document still snaps to the grid",
);

drawingState.scale = { pixelsPerUnit: 2.4, units: "mm" };

const calibrated = resolve({ x: 142.3, y: 87.6 });

check(
  "and the result is identical once calibrated - the scale is not read",
  near(calibrated.effectiveConstructionPoint.x, uncalibrated.effectiveConstructionPoint.x) &&
    near(calibrated.effectiveConstructionPoint.y, uncalibrated.effectiveConstructionPoint.y),
);

/* ================================================= 6. shared with editing */

console.log("\nOne helper, used by construction and editing alike");
console.log("--------------------------------------------------");

resetState();

/*
 * Editing a handle goes through the same helper, so a handle and a freshly
 * drawn point resolve identically. This is what "the same shared snapping
 * logic" means in practice, and it is checked rather than assumed.
 */
const handlePoint = enggDrawingState.gridSnapPoint({ x: 61.4, y: 38.9 }, drawingState);

check(
  "a handle position resolves to the same lattice as a construction point",
  near(handlePoint.x, 60) && near(handlePoint.y, 40),
  `(${handlePoint.x}, ${handlePoint.y})`,
);

/* ================================================== 7. editing geometry */

console.log("\nEditing goes through the same pipeline as construction");
console.log("------------------------------------------------------");

/*
 * A handle drag resolves through `resolveConstructionPoint` with the drag's own
 * anchor and `preferInference`, exactly as `resolveManipulationPoint` calls it.
 * Driving it with those same options is what proves an EDIT snaps the same way
 * a construction does - which is the requirement that grid snapping must not be
 * restricted to drawing new objects.
 */
function dragResolve(rawCursor, anchor) {
  return snap.resolveConstructionPoint(
    { ...rawCursor },
    drawingState,
    boundary,
    {
      lineStart: anchor,
      inferenceReferences: anchor ? [anchor] : [],
      preferInference: true,
      tool: "select",
    },
  );
}

/*
 * THE SHEET IS EMPTY FOR THE PURE-GRID CHECKS, and that is deliberate.
 *
 * The first version of this test put a line in the fixture and then asserted
 * that a dragged handle lands on a grid intersection - but the line's own
 * endpoints, midpoint and row were within the alignment band of the cursors
 * used, so the resolver correctly preferred those references and the test read
 * the result as a failure. An empty sheet is the only fixture in which "nothing
 * else was found" is actually true, which is the condition the grid fallback is
 * defined for. The alignment cases are checked separately in section 7b, and
 * the object-snap priority is checked in section 3.
 */
resetState();

const NO_ALIGNMENT_ANCHOR = { x: 4001, y: 4003 };

/* A line endpoint dragged free of everything else. */
const endpointDrag = dragResolve({ x: 163.4, y: 77.9 }, NO_ALIGNMENT_ANCHOR);

check(
  "dragging a line endpoint lands on a grid intersection",
  near(endpointDrag.effectiveConstructionPoint.x, 165) &&
    near(endpointDrag.effectiveConstructionPoint.y, 80),
  `(${endpointDrag.effectiveConstructionPoint.x}, ${endpointDrag.effectiveConstructionPoint.y})`,
);

/* A circle's radius handle: the handle itself snaps. */
const radiusHandle = dragResolve({ x: 108.6, y: 108.9 }, NO_ALIGNMENT_ANCHOR);

check(
  "a circle's radius handle snaps to the grid",
  near(radiusHandle.effectiveConstructionPoint.x, 110) &&
    near(radiusHandle.effectiveConstructionPoint.y, 110),
  `(${radiusHandle.effectiveConstructionPoint.x}, ${radiusHandle.effectiveConstructionPoint.y})`,
);

/*
 * A rectangle corner, a triangle vertex, a polygon vertex, an arc control point
 * and a coordinate system origin all snap on both axes when nothing is aligning
 * them. One rule, five shapes - which is the requirement that every handle goes
 * through the same shared logic.
 */
[
  ["a rectangle corner", { x: 203.3, y: 147.6 }, { x: 205, y: 150 }],
  ["a triangle vertex", { x: 92.4, y: 47.8 }, { x: 90, y: 50 }],
  ["a polygon vertex", { x: 137.7, y: 63.1 }, { x: 140, y: 65 }],
  ["an arc control point", { x: 178.9, y: 92.2 }, { x: 180, y: 90 }],
  ["a coordinate system origin", { x: 22.6, y: 38.4 }, { x: 25, y: 40 }],
].forEach(([label, cursor, expected]) => {
  const resolution = dragResolve(cursor, NO_ALIGNMENT_ANCHOR);

  check(
    `${label} snaps to the grid`,
    near(resolution.effectiveConstructionPoint.x, expected.x) &&
      near(resolution.effectiveConstructionPoint.y, expected.y),
    `(${resolution.effectiveConstructionPoint.x}, ${resolution.effectiveConstructionPoint.y}), expected (${expected.x}, ${expected.y})`,
  );
});

/*
 * A WHOLE-OBJECT MOVE snaps its REFERENCE POINT and does not distort the object.
 *
 * The anchor is where the feature was picked up, so a drag of (+50, +20) from
 * an anchor of (40, 40) must land the reference on a grid intersection and the
 * feature must keep its own shape - the requirement that moving an object must
 * not deform it merely to line its bounding box up.
 */
resetState({
  objects: [
    {
      id: "line-moved",
      type: "line",
      geometry: {
        start: { x: 40, y: 40 },
        end: { x: 140, y: 40 },
      },
    },
  ],
});

const moved = dragResolve({ x: 91.7, y: 62.2 }, { x: 40, y: 40 });

check(
  "moving an object snaps its reference point onto the grid",
  near(moved.effectiveConstructionPoint.x, 90) &&
    near(moved.effectiveConstructionPoint.y, 60),
  `(${moved.effectiveConstructionPoint.x}, ${moved.effectiveConstructionPoint.y})`,
);

/* ============================================ 7b. alignment AND the grid */

console.log("\nAn alignment constrains one axis and the grid the other");
console.log("---------------------------------------------------------");

/*
 * This is the defect the first version of this file missed. A horizontal or
 * vertical guide fixes ONE axis and leaves the other at whatever the raw
 * pointer said - so a point placed against a guide landed on the guide at an
 * arbitrary fraction of a grid interval. Snapping has to apply to every stage
 * of a construction, not only to the stage where no guide was found.
 */
resetState({
  objects: [
    {
      id: "line-ref",
      type: "line",
      geometry: {
        start: { x: 90, y: 40 },
        end: { x: 90, y: 300 },
      },
    },
  ],
});

/* The cursor is within the vertical-alignment band of x = 90, and off-grid on y. */
const aligned = dragResolve({ x: 91.7, y: 63.2 }, { x: 90, y: 40 });

check(
  "the guide is taken on the axis it constrains",
  near(aligned.effectiveConstructionPoint.x, 90),
  `x was ${aligned.effectiveConstructionPoint.x}`,
);

check(
  "and the FREE axis is snapped to the grid, not left at the raw pointer",
  near(aligned.effectiveConstructionPoint.y, 65),
  `y was ${aligned.effectiveConstructionPoint.y}; the raw pointer said 63.2 and the grid line is 65`,
);

check(
  "so the point lands on the guide AND on a grid line",
  near(aligned.effectiveConstructionPoint.x % 5, 0) &&
    near(aligned.effectiveConstructionPoint.y % 5, 0),
  `(${aligned.effectiveConstructionPoint.x}, ${aligned.effectiveConstructionPoint.y})`,
);

/*
 * A two-reference crossing constrains BOTH axes, so neither may be re-snapped:
 * moving either would slide the corner off the reference it was aligned to.
 */
resetState({
  objects: [
    {
      id: "line-a",
      type: "line",
      geometry: { start: { x: 200, y: 147 }, end: { x: 400, y: 147 } },
    },
    {
      id: "line-b",
      type: "line",
      geometry: { start: { x: 203, y: 20 }, end: { x: 203, y: 300 } },
    },
  ],
});

const crossing = dragResolve({ x: 203.2, y: 147.2 }, { x: 4001, y: 4003 });

check(
  "a two-reference crossing is left exactly on its references",
  near(crossing.effectiveConstructionPoint.x, 203) &&
    near(crossing.effectiveConstructionPoint.y, 147),
  `(${crossing.effectiveConstructionPoint.x}, ${crossing.effectiveConstructionPoint.y}) - re-snapping either axis would slide it off the reference`,
);

/* ===================================================== 8. fixed objects */

console.log("\nA fixed object is still a snap target");
console.log("-------------------------------------");

resetState({
  objects: [
    {
      id: "line-fixed",
      type: "line",
      fixed: true,
      geometry: {
        start: { x: 12, y: 12 },
        end: { x: 312, y: 12 },
      },
    },
  ],
});

const ontoFixed = resolve({ x: 12.2, y: 12.2 });

check(
  "a fixed object's endpoint is offered as a snap candidate",
  ontoFixed.snapCandidate?.type === "endpoint" &&
    ontoFixed.snapCandidate?.objectId === "line-fixed",
  `candidate was ${JSON.stringify(ontoFixed.snapCandidate)}`,
);

check(
  "and the cursor really lands on it",
  near(ontoFixed.effectiveConstructionPoint.x, 12) &&
    near(ontoFixed.effectiveConstructionPoint.y, 12),
);

/* ========================================================== 9. the wiring */

console.log("\nThe settings control writes the field the resolver reads");
console.log("-------------------------------------------------------");

const settingsSource = fs.readFileSync(
  modulePath("settings-dialog.js"),
  "utf8",
);

check(
  "the Grid snapping row is a real control, not a read-only span",
  /data-settings-grid="snapToGrid"/.test(settingsSource),
  "the row used to be a <span> reading a field nothing wrote",
);

check(
  "and the snapping page wires it to drawingState.grid",
  /pageId === "snapping"[\s\S]{0,900}?drawingState\.grid = \{[\s\S]{0,200}?\[key\]: box\.checked/.test(
    settingsSource,
  ),
);

const snapSource = fs.readFileSync(modulePath("object-snap.js"), "utf8");

check(
  "the resolver asks the grid through the shared helper",
  /gridSnapPoint\(/.test(snapSource),
  "grid snapping must be one function, not a second copy of the arithmetic",
);

check(
  "and the object-snap branch still runs before it",
  snapSource.indexOf("snapCandidate.point") < snapSource.indexOf("gridSnapPoint("),
  "the object snap must be resolved before the grid fallback is reached",
);

const stateSource = fs.readFileSync(modulePath("drawing-state.js"), "utf8");

check(
  "the grid snap helper reads the grid's own spacing",
  /function gridSnapValue[\s\S]{0,400}?state\.grid\?\.spacing/.test(stateSource),
);

check(
  "and never reads the engineering scale",
  !/function gridSnapValue[\s\S]{0,600}?state\.scale/.test(stateSource),
  "the interval must not depend on whether the document is calibrated",
);

check(
  "an alignment's free axis is offered to the grid too",
  /inference\.type[\s\S]{0,700}?freeAxis[\s\S]{0,300}?gridSnapValue/.test(snapSource),
  "a guide constrains one axis; the other must still snap",
);

check(
  "and the constrained axis is left exactly where the guide put it",
  /ONLY THE FREE AXIS IS TOUCHED/.test(snapSource),
  "re-snapping the constrained axis would slide the point off its reference",
);

console.log(`\n${pass} passed, ${fail} failed`);

if (fail > 0) {
  process.exitCode = 1;
}
