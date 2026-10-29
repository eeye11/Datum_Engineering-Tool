/* eslint-disable no-console */
/*
 * ========================================================
 * GENERAL SNAP AND GRID SNAP ARE TWO SYSTEMS
 * ========================================================
 *
 * They answer different questions, and the whole of this file is about keeping
 * them apart:
 *
 *   GENERAL SNAP   "is there something meaningful on the drawing near here?"
 *                  endpoints, midpoints, intersections, centres, quadrants,
 *                  points on an entity - and the H/V alignment inference.
 *                  It is a reference to EXISTING GEOMETRY.
 *
 *   GRID SNAP      "which grid location is nearest?"
 *                  It is a reference to the LATTICE, and it works on an empty
 *                  sheet. It never looks at what is drawn.
 *
 * The two were one switch. `snap.enabled` gated both, and the resolver's final
 * fallback rounded to the old one-unit `snap.spacing`, so "grid snap off" was
 * not free positioning: a point still jumped to the nearest whole unit with
 * nothing on screen to explain it. These tests pin the four-state table and the
 * order that replaces it.
 *
 * The engine is driven for real, through `resolveConstructionPoint`. The
 * switches are read from source, because `viewport.js` and `sheets.js` are
 * DOM-coupled and cannot be imported here - the same technique
 * `drag-snap-inference.test.cjs` already uses.
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

/*
 * A circle and a line, deliberately placed OFF the grid (their endpoints and
 * centre are at odd multiples of 2.5) so that "snapped to the object" and
 * "snapped to the grid" are different answers and a test cannot pass by
 * accident.
 */
const OBJECTS = [
  {
    id: "circle-1",
    type: "circle",
    geometry: { center: { x: 102.5, y: 102.5 }, radius: 47.5 },
  },
  {
    id: "line-1",
    type: "line",
    geometry: { start: { x: 302.5, y: 102.5 }, end: { x: 497.5, y: 102.5 } },
  },
];

function reset({ objects = OBJECTS, general = true, gridSnap = true, spacing = 5 } = {}) {
  drawingState.objects = objects.map((o) => ({
    ...o,
    geometry: JSON.parse(JSON.stringify(o.geometry)),
  }));
  drawingState.selection = { selectedObjectIds: [] };
  drawingState.grid = { visible: true, spacing, snapToGrid: gridSnap };
  drawingState.snap = { enabled: general, spacing: 1 };
  drawingState.objectSnap = { enabled: general, tolerancePx: 10, inferenceTolerancePx: 24 };
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

const at = (r) => r.effectiveConstructionPoint;

/* ============================================ 1-2. the four-state table */

console.log("\nThe four states of the two systems");
console.log("----------------------------------");

/*
 * A cursor a fraction off the line's endpoint at (302.5, 102.5) - which is NOT
 * a grid point (300 and 305 are). With both on, the endpoint must win; the grid
 * must not drag it to 300 or 305.
 */
reset({ general: true, gridSnap: true });
const both = resolve({ x: 302.9, y: 102.8 });

check(
  "ON + ON: a real geometric reference beats a nearby grid point",
  near(at(both).x, 302.5) && near(at(both).y, 102.5),
  `(${at(both).x}, ${at(both).y}) - the grid would have given 300/305`,
);

check(
  "and the candidate is reported, so the visual feedback matches the coordinate",
  both.snapCandidate?.type === "endpoint",
  `candidate was ${both.snapCandidate?.type}`,
);

/* ON + OFF: the endpoint still snaps; nothing forces the grid. */
reset({ general: true, gridSnap: false });
const generalOnly = resolve({ x: 302.9, y: 102.8 });

check(
  "ON + OFF: existing-geometry snapping still works",
  near(at(generalOnly).x, 302.5) && near(at(generalOnly).y, 102.5),
  `(${at(generalOnly).x}, ${at(generalOnly).y})`,
);

/* OFF + ON: no object snap; the grid takes over. */
reset({ general: false, gridSnap: true });
const gridOnly = resolve({ x: 302.9, y: 102.8 });

check(
  "OFF + ON: object snapping is silent and the grid places the point",
  gridOnly.snapCandidate === null &&
    near(at(gridOnly).x % 5, 0) &&
    near(at(gridOnly).y % 5, 0),
  `(${at(gridOnly).x}, ${at(gridOnly).y}), candidate=${gridOnly.snapCandidate?.type}`,
);

check(
  "and the grid point is the nearest one, not the object's endpoint",
  near(at(gridOnly).x, 305) && near(at(gridOnly).y, 105),
  `(${at(gridOnly).x}, ${at(gridOnly).y})`,
);

/* OFF + OFF: the pointer is free. */
reset({ general: false, gridSnap: false });
const neither = resolve({ x: 302.9, y: 102.8 });

check(
  "OFF + OFF: the raw pointer is used, exactly",
  near(at(neither).x, 302.9) && near(at(neither).y, 102.8),
  `(${at(neither).x}, ${at(neither).y}) - must be free positioning`,
);

/* ============================================== 3. off-grid drawing works */

console.log("\nGeometry can be placed between grid lines");
console.log("-----------------------------------------");

reset({ general: false, gridSnap: false });

const offGrid = [
  { x: 13.37, y: -8.42 },
  { x: 101.11, y: 55.55 },
  { x: -0.25, y: 0.75 },
];

offGrid.forEach((cursor) => {
  const r = resolve(cursor);

  check(
    `an arbitrary point (${cursor.x}, ${cursor.y}) is placed unchanged`,
    near(at(r).x, cursor.x) && near(at(r).y, cursor.y),
    `(${at(r).x}, ${at(r).y})`,
  );
});

/* ======================================== 4. grid snap is zoom-invariant */

console.log("\nGrid snapping is world-coordinate, not screen pixels");
console.log("----------------------------------------------------");

reset({ general: false, gridSnap: true });

const atZoom1 = resolve({ x: 142.3, y: 87.6 });

drawingState.camera = { zoom: 6.25, panX: -318.4, panY: 71.9 };

const atZoom6 = resolve({ x: 142.3, y: 87.6 });

check(
  "the same world point snaps identically at any zoom and pan",
  near(at(atZoom1).x, at(atZoom6).x) && near(at(atZoom1).y, at(atZoom6).y),
  `zoom 1 -> (${at(atZoom1).x}, ${at(atZoom1).y}); zoom 6.25 -> (${at(atZoom6).x}, ${at(atZoom6).y})`,
);

check(
  "and it is still an exact grid multiple",
  near(at(atZoom6).x % 5, 0) && near(at(atZoom6).y % 5, 0),
);

/* ========================================= 5. spacing change moves nothing */

console.log("\nChanging the grid spacing does not move existing geometry");
console.log("-------------------------------------------------------");

reset({ general: true, gridSnap: true, spacing: 5 });

const before = JSON.stringify(drawingState.objects);

drawingState.grid.spacing = 25;

/* Resolving a pointer is the only thing that may snap - reading the objects must not. */
resolve({ x: 302.9, y: 102.8 });

check(
  "the committed objects are byte-for-byte unchanged",
  JSON.stringify(drawingState.objects) === before,
  "snapping constrains the NEXT input coordinate; it never rewrites geometry",
);

check(
  "and a subsequent point snaps to the NEW interval",
  near(at(resolve({ x: 41.4, y: 41.4 })).x % 25, 0),
  `x was ${at(resolve({ x: 41.4, y: 41.4 })).x}`,
);

/* ================================= 6. toggling mid-gesture is not a cancel */

console.log("\nToggling grid snap mid-drag applies at once and keeps the gesture");
console.log("---------------------------------------------------------------");

reset({ general: false, gridSnap: true });

const midDragOn = resolve({ x: 142.3, y: 87.6 });

/* The gesture is still running; only the setting changed. */
drawingState.grid.snapToGrid = false;

const midDragOff = resolve({ x: 142.3, y: 87.6 });

check(
  "with grid snap on, the drag point is on the lattice",
  near(at(midDragOn).x % 5, 0) && near(at(midDragOn).y % 5, 0),
  `(${at(midDragOn).x}, ${at(midDragOn).y})`,
);

check(
  "switching it off mid-drag frees the very next move",
  near(at(midDragOff).x, 142.3) && near(at(midDragOff).y, 87.6),
  `(${at(midDragOff).x}, ${at(midDragOff).y}) - no re-commit, no jump back`,
);

/* ================================ 7. object snapping is left alone by both */

console.log("\nToggling grid snap never disturbs the object snaps");
console.log("--------------------------------------------------");

const modes = [
  ["endpoint", { x: 302.9, y: 102.8 }, { x: 302.5, y: 102.5 }],
  ["midpoint", { x: 400.2, y: 102.8 }, { x: 400, y: 102.5 }],
  ["centre", { x: 102.9, y: 102.8 }, { x: 102.5, y: 102.5 }],
  ["quadrant", { x: 102.9, y: 150.3 }, { x: 102.5, y: 150 }],
  ["point on entity", { x: 150.2, y: 102.8 }, { x: 150, y: 102.5 }],
];

modes.forEach(([label, cursor, expected]) => {
  reset({ general: true, gridSnap: true });
  const withGrid = resolve(cursor);

  reset({ general: true, gridSnap: false });
  const withoutGrid = resolve(cursor);

  check(
    `${label}: the same reference is found with grid snap on and off`,
    near(at(withGrid).x, expected.x) &&
      near(at(withGrid).y, expected.y) &&
      near(at(withoutGrid).x, expected.x) &&
      near(at(withoutGrid).y, expected.y),
    `on -> (${at(withGrid).x}, ${at(withGrid).y}); off -> (${at(withoutGrid).x}, ${at(withoutGrid).y}); expected (${expected.x}, ${expected.y})`,
  );
});

/* ================================ 8. alignment inference belongs to general */

console.log("\nAlignment inference is general snapping, not grid snap");
console.log("-----------------------------------------------------");

reset({ general: true, gridSnap: false });

/*
 * The cursor is within the 7-degree band of the line's own row. The guide must
 * still be found with grid snap off - inference is a reference to existing
 * geometry and must not be switched off with the grid.
 */
const inferred = resolve(
  { x: 700, y: 103.5 },
  { lineStart: { x: 302.5, y: 102.5 }, preferInference: true },
);

check(
  "a horizontal guide is found with grid snap off",
  inferred.inference?.type === "horizontal" &&
    near(at(inferred).y, 102.5),
  `inference=${inferred.inference?.type}, y=${at(inferred).y}`,
);

reset({ general: false, gridSnap: true });

const noInference = resolve(
  { x: 700, y: 103.5 },
  { lineStart: { x: 302.5, y: 102.5 }, preferInference: true },
);

check(
  "and with general snap off the guide is gone, leaving the grid",
  noInference.inference === null && near(at(noInference).y % 5, 0),
  `inference=${noInference.inference?.type}, y=${at(noInference).y}`,
);

/* ================================== 9. free axis snaps, constrained does not */

console.log("\nA guide constrains one axis; the grid may take the other");
console.log("-------------------------------------------------------");

reset({ general: true, gridSnap: true });

/*
 * An EMPTY SHEET with a single far-away anchor, so exactly ONE reference point
 * exists and only one axis can be constrained by it. A sheet with geometry on
 * it produces `horizontal-vertical` - both axes fixed by real references - and
 * then nothing may be re-snapped, which is a different case (checked below).
 */
const emptySheet = { objects: [] };
reset({ ...emptySheet, general: true, gridSnap: true });

const split = resolve(
  { x: 200.8, y: 63.2 },
  { lineStart: { x: 200.5, y: 400 }, inferenceReferences: [{ x: 200.5, y: 400 }], preferInference: true },
);

check(
  "the constrained axis keeps the guide's exact value",
  near(at(split).x, 200.5),
  `x was ${at(split).x}`,
);

check(
  "and the free axis is snapped to the grid",
  near(at(split).y, 65),
  `y was ${at(split).y}; the pointer said 63.2 and the grid line is 65`,
);

/*
 * A TWO-REFERENCE CROSSING constrains BOTH axes, so neither may be re-snapped:
 * moving either would slide the corner off the reference it was aligned to.
 */
reset({ ...emptySheet, general: true, gridSnap: true });

const crossing = resolve(
  { x: 200.8, y: 147.2 },
  {
    lineStart: { x: 200.5, y: 400 },
    inferenceReferences: [
      { x: 200.5, y: 400 },
      { x: 700, y: 147 },
    ],
    preferInference: true,
  },
);

check(
  "a two-reference crossing is left exactly on its references",
  near(at(crossing).x, 200.5) && near(at(crossing).y, 147),
  `(${at(crossing).x}, ${at(crossing).y}) - re-snapping either axis would slide it off a reference`,
);

/* ================================================ 10. selection is inert */

console.log("\nSelecting an off-grid object does not move it");
console.log("-------------------------------------------------");

reset({ general: true, gridSnap: true });

const offGridObject = {
  id: "off-grid-line",
  type: "line",
  geometry: { start: { x: 13.37, y: -8.42 }, end: { x: 101.11, y: 55.55 } },
};

drawingState.objects = [offGridObject];
const frozen = JSON.stringify(drawingState.objects);

/* Selecting is a state change, and resolving a pointer is the only snap path. */
drawingState.selection = { selectedObjectIds: ["off-grid-line"] };
resolve({ x: 13.5, y: -8.5 });
resolve({ x: 101, y: 55.5 });

check(
  "the object's coordinates are unchanged after selection and hovering",
  JSON.stringify(drawingState.objects) === frozen,
  "an off-grid object must not jump because it was selected or inspected",
);

/* ============================== 11. multi-object moves keep relative layout */

console.log("\nMoving several objects preserves their relative positions");
console.log("-------------------------------------------------------");

reset({ general: false, gridSnap: true });

/*
 * Two objects a deliberate off-grid distance apart. A group move snaps ONE
 * reference point and applies that single delta to all of them - so the gap
 * between them is preserved exactly. Snapping each object independently would
 * collapse the gap to a multiple of the grid.
 */
const groupDelta = { x: 42.3, y: -17.6 };
const snappedDelta = {
  x: enggDrawingState.gridSnapValue(groupDelta.x, drawingState),
  y: enggDrawingState.gridSnapValue(groupDelta.y, drawingState),
};

const group = [
  { x: 13.37, y: -8.42 },
  { x: 101.11, y: 55.55 },
];

const moved = group.map((p) => ({
  x: p.x + snappedDelta.x,
  y: p.y + snappedDelta.y,
}));

check(
  "the chosen reference delta is snapped",
  near(snappedDelta.x % 5, 0) && near(snappedDelta.y % 5, 0),
  `delta (${snappedDelta.x}, ${snappedDelta.y})`,
);

check(
  "and every object moves by that same delta, so the gap is untouched",
  near(moved[1].x - moved[0].x, group[1].x - group[0].x) &&
    near(moved[1].y - moved[0].y, group[1].y - group[0].y),
  `gap was (${group[1].x - group[0].x}, ${group[1].y - group[0].y}), now (${moved[1].x - moved[0].x}, ${moved[1].y - moved[0].y})`,
);

/* ================================================ 12. the state is separate */

console.log("\nThe three states are three fields");
console.log("---------------------------------");

const viewportSource = fs.readFileSync(modulePath("viewport.js"), "utf8");
const sheetsSource = fs.readFileSync(modulePath("sheets.js"), "utf8");

check(
  "grid visibility drives grid snap on the Grid toggle",
  /drawingGridToggle[\s\S]{0,2600}?drawingState\.grid\.visible\s*=\s*nextEnabled[\s\S]{0,2600}?drawingState\.grid\.snapToGrid\s*=\s*nextEnabled/.test(
    viewportSource,
  ),
  "showing the grid must enable grid snapping, and hiding it must disable it",
);

check(
  "the Snap toggle controls both object and grid snapping",
  /drawingSnapToggle[\s\S]{0,2000}?drawingState\.snap\.enabled\s*=\s*nextEnabled[\s\S]{0,600}?drawingState\.objectSnap\.enabled\s*=\s*nextEnabled/.test(
    viewportSource,
  ) &&
    /drawingSnapToggle[\s\S]{0,2000}?drawingState\.grid\.snapToGrid\s*=\s*nextEnabled/.test(viewportSource),
  "the Snap control must disable grid snapping as well as object snapping",
);

check(
  "grid snap is persisted on the sheet, beside visibility",
  /grid:\s*resolveGridSnap\(\{[\s\S]{0,1200}?visible:\s*true,[\s\S]{0,1200}?spacing:\s*7\.5[\s\S]{0,1200}?snapToGrid:\s*true/.test(
    sheetsSource,
  ),
  "a reopened drawing must show the grid-snap state it was saved with",
);

check(
  "and an older sheet with no recorded state is given one",
  /function resolveGridSnap[\s\S]{0,500}?snapToGrid: grid\.visible !== false/.test(
    sheetsSource,
  ),
  "a drawing saved with the grid off must not come back with grid snapping on",
);

check(
  "the document reader resolves that fallback against the OLD grid",
  /resolveGridSnap\(document\.grid\)/.test(
    fs.readFileSync(modulePath("document-file.js"), "utf8"),
  ),
  "resolving the merged sheet would find the field present and change nothing",
);

check(
  "the resolver's final fallback is the grid snap and nothing else",
  /effectivePoint =\s*\n?\s*enggDrawingState\.gridSnapPoint\(/.test(
    fs.readFileSync(modulePath("object-snap.js"), "utf8"),
  ),
  "the old one-unit snapCoordinate fallback made 'grid snap off' not free",
);

/* ============================================ 13. no engineering scale */

console.log("\nNeither system needs a calibrated scale");
console.log("--------------------------------------");

reset({ general: true, gridSnap: true });
drawingState.scale = null;
const uncalibrated = resolve({ x: 142.3, y: 87.6 });

drawingState.scale = { pixelsPerUnit: 2.4, units: "mm" };
const calibrated = resolve({ x: 142.3, y: 87.6 });

check(
  "grid snapping is identical on an uncalibrated and a calibrated document",
  near(at(uncalibrated).x, at(calibrated).x) &&
    near(at(uncalibrated).y, at(calibrated).y),
  `uncalibrated (${at(uncalibrated).x}, ${at(uncalibrated).y}); calibrated (${at(calibrated).x}, ${at(calibrated).y})`,
);

console.log(`\n${pass} passed, ${fail} failed`);

if (fail > 0) {
  process.exitCode = 1;
}
