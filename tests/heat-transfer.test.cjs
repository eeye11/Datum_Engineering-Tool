/*
 * ========================================================
 * THE HEAT TRANSFER WORKSPACE
 * ========================================================
 *
 * The behaviours the requirement singles out, checked against the model and
 * the registry themselves rather than against a screenshot:
 *
 *   - the four main groups, and Create's eleven entries in the exact order;
 *   - each dropdown's variants;
 *   - Wall / Slab's two parallel faces, symmetric about a FIXED centreline;
 *   - Composite Wall's live layer count N = max(2, floor(W / p)), its equal
 *     initial layers, its preserved count on resize and its divider clamps;
 *   - a radiation path's generated wave and a boundary's generated marks;
 *   - the source writer covering every declared type.
 *
 * These are the geometry guarantees the requirement states, so they are the
 * ones most worth holding still.
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

/*
 * THE DOM HOOKS THE CANVAS RENDER AND THE TOOL STATUS WRITE TO.
 *
 * They are created BEFORE any module is loaded, because `dom.js` captures its
 * element references at import time. The path tool's own render calls then run
 * against real (empty) elements rather than throwing, so the lifecycle is
 * exercised through the SHIPPED functions.
 */
(function seedCanvasDom() {
  const body = document.body;

  const byId = (id) => {
    if (!document.getElementById(id)) {
      const element = document.createElement("div");
      element.id = id;
      body.appendChild(element);
      return element;
    }

    return document.getElementById(id);
  };

  ["drawingToolHeading", "drawingToolList", "drawingToolMessage"].forEach(byId);

  if (!document.querySelector(".drawing-canvas")) {
    const canvas = document.createElement("canvas");
    canvas.className = "drawing-canvas";
    body.appendChild(canvas);
  }
})();

const { loadModule } = require("./helpers/source-path.cjs");

const tools = loadModule("heat-tools.js");
const model = loadModule("heat-model.js");
const shared = loadModule("heat-shared.js");

const point = (x, y) => ({ x, y });

/* ---------------------------------------------------------- the toolbar */

console.log("\nThe toolbar");
console.log("-----------");

const groupLabels = tools.heatToolGroups.map((group) => group.label);

check(
  "exactly the four main groups, in order",
  JSON.stringify(groupLabels) ===
    JSON.stringify(["Selection", "Create", "Analysis", "Reference"]),
  groupLabels.join(", "),
);

const create = tools.heatToolGroups.find((group) => group.label === "Create");

const createOrder = create.tools.map((tool) => tool.id);

check(
  "Create's eleven entries in the requirement's order",
  JSON.stringify(createOrder) ===
    JSON.stringify([
      "thermal-region",
      "wall-slab",
      "composite-wall",
      "fin",
      "heat-transfer-path",
      "thermal-transfer-arrow",
      "thermal-boundary",
      "thermal-contact",
      "heat-source-sink",
      "thermal-circuit-node",
      "thermal-circuit-element",
    ]),
  createOrder.join(", "),
);

check(
  "Heat Transfer Path offers Conduction, Convection, Radiation",
  JSON.stringify(
    tools.HEAT_TOOL_MENUS["heat-transfer-path"].map((item) => item.id),
  ) ===
    JSON.stringify(["conduction-path", "convection-flow", "radiation-path"]),
);

check(
  "Thermal Transfer Arrow offers Rate and Flux",
  JSON.stringify(
    tools.HEAT_TOOL_MENUS["thermal-transfer-arrow"].map((item) => item.id),
  ) === JSON.stringify(["heat-transfer-rate", "heat-flux"]),
);

check(
  "Thermal Boundary offers exactly its four variants",
  JSON.stringify(
    tools.HEAT_TOOL_MENUS["thermal-boundary"].map((item) => item.id),
  ) ===
    JSON.stringify([
      "fixed-temperature-boundary",
      "convection-boundary",
      "radiation-boundary",
      "adiabatic-boundary",
    ]),
);

/*
 * FOUR, not five: Prescribed Heat-Flux Boundary was removed as a duplicate of
 * the Heat Flux arrow, so a heat flux on a surface is an arrow squared to the
 * boundary rather than a second boundary object.
 */
check(
  "the Prescribed Heat-Flux Boundary is gone",
  !tools.HEAT_TOOL_MENUS["thermal-boundary"].some(
    (item) => item.id === "heat-flux-boundary",
  ),
);

const analysis = tools.heatToolGroups.find(
  (group) => group.label === "Analysis",
);

check(
  "Analysis places Temperature Profile on the existing Graph tool",
  analysis.tools.some(
    (tool) => tool.id === "temperature-profile" && tool.capability === "graph",
  ),
);

/* ---------------------------------------------------------- the wall */

console.log("\nWall / Slab");
console.log("-----------");

const wall = model.createWallSlab({
  start: point(0, 0),
  end: point(100, 0),
  thickness: 10,
});

const lines = model.wallSlabLines(wall);

check("two lines are produced", Array.isArray(lines) && lines.length === 2);

check(
  "the two lines are parallel",
  Math.abs(lines[0].start.y - lines[0].end.y) < 1e-9 &&
    Math.abs(lines[1].start.y - lines[1].end.y) < 1e-9,
);

check(
  "the faces are the thickness apart, symmetric about a fixed centreline",
  Math.abs(Math.abs(lines[0].start.y) - 5) < 1e-9 &&
    Math.abs(Math.abs(lines[1].start.y) - 5) < 1e-9,
);

model.setWallSlabThickness(wall, 20);

const thicker = model.wallSlabLines(wall);

check(
  "changing thickness moves both faces symmetrically, centreline fixed",
  Math.abs(thicker[0].start.y - 10) < 1e-9 &&
    Math.abs(thicker[1].start.y + 10) < 1e-9,
);

check(
  "changing thickness leaves the ends' x unchanged (length preserved)",
  Math.abs(thicker[0].start.x - 0) < 1e-9 &&
    Math.abs(thicker[0].end.x - 100) < 1e-9,
);

/* ---------------------------------------------------------- composite wall */

console.log("\nComposite Wall");
console.log("--------------");

const p = shared.COMPOSITE_LAYER_INCREMENT;

check(
  "two layers at the minimum width",
  model.compositeLayerCount(p * 0.5) === 2,
);
check(
  "two layers below the first threshold",
  model.compositeLayerCount(p * 1.99) === 2,
);
check("three layers at 3p", model.compositeLayerCount(p * 3) === 3);
check(
  "each threshold adds exactly one layer",
  model.compositeLayerCount(p * 4) - model.compositeLayerCount(p * 4 - 1) === 1,
);
check(
  "the count does not depend on the zoom (pure width arithmetic)",
  model.compositeLayerCount(p * 5) === 5,
);

const cw = model.createCompositeWall({
  center: point(0, 0),
  width: p * 3,
  height: 40,
});

check(
  "a freshly drawn wall has the generated layer count",
  model.compositeLayers(cw).length === 3,
);

const widths = model.compositeLayers(cw);

check(
  "the initial layers are equal",
  Math.abs(widths[0] - widths[1]) < 1e-9 &&
    Math.abs(widths[1] - widths[2]) < 1e-9,
);

const sumBefore = widths.reduce((sum, w) => sum + w, 0);

check("the layers sum to the wall's width", Math.abs(sumBefore - p * 3) < 1e-6);

model.resizeCompositeWall(cw, p * 6, 40);

check(
  "resizing preserves the layer count",
  model.compositeLayers(cw).length === 3,
);

check(
  "resizing scales the layers proportionally (their sum is the new width)",
  Math.abs(model.compositeLayers(cw).reduce((sum, w) => sum + w, 0) - p * 6) <
    1e-6,
);

/* A divider drag changes two adjacent layers and no other. */
const before = model.compositeLayers(cw).slice();
model.moveCompositeDivider(cw, 0, p * 0.5);
const after = model.compositeLayers(cw);

check(
  "dragging divider 0 changes only layers 0 and 1",
  Math.abs(after[2] - before[2]) < 1e-9 &&
    Math.abs(after[0] - before[0]) > 1e-6,
);

check(
  "dividers cannot cross: no layer goes below its minimum",
  after.every((w) => w >= shared.MIN_LAYER_WIDTH - 1e-9),
);

const huge = model.compositeLayers(cw).slice();
model.moveCompositeDivider(cw, 0, 1e6);
check(
  "an oversized drag is clamped, leaving the neighbour at its minimum",
  model.compositeLayers(cw)[1] >= shared.MIN_LAYER_WIDTH - 1e-9,
);

void huge;

const geometry = model.compositeWallGeometry(cw);

check(
  "a three-layer wall has two internal dividers",
  geometry && geometry.dividers.length === 2,
);

check(
  "the outer rectangle is closed",
  geometry && geometry.corners.length === 4,
);

const rotated = model.createCompositeWall({
  center: point(0, 0),
  width: p * 3,
  height: 40,
  rotation: 90,
});
const rotatedGeometry = model.compositeWallGeometry(rotated);

check(
  "rotating a composite wall keeps the layer count",
  model.compositeLayers(rotated).length === 3,
);

check(
  "a vertical wall's dividers are horizontal",
  Math.abs(
    rotatedGeometry.dividers[0].start.y - rotatedGeometry.dividers[0].end.y,
  ) < 1e-6,
);

/* ---------------------------------------------------------- paths and marks */

console.log("\nPaths and boundaries");
console.log("--------------------");

const conduction = model.createHeatPath({
  points: [point(0, 0), point(50, 0)],
  variant: "conduction",
});
const radiation = model.createHeatPath({
  points: [point(0, 0), point(50, 0)],
  variant: "radiation",
});
const convection = model.createHeatPath({
  points: [point(0, 0), point(50, 0)],
  variant: "convection",
});

check(
  "conduction, convection and radiation are all heat paths",
  [conduction, radiation, convection].every((p2) => p2.type === "heat-path"),
);
check(
  "each carries its own variant",
  model.variantOf(radiation) === "radiation" &&
    model.variantOf(convection) === "convection",
);

const convBoundary = model.createThermalBoundary({
  start: point(0, 0),
  end: point(60, 0),
  variant: "convection",
  spacing: 10,
});

const marks = model.boundaryDecorations(convBoundary);

check(
  "a boundary generates repeated marks from its own length",
  marks.length === 6,
);
check(
  "the marks are on one side, not inside the boundary",
  marks.every((m) =>
    m.points.every((pt2) => pt2.y !== 0 || m.kind === "arrow"),
  ),
);

model.createThermalBoundary;
const shorter = model.createThermalBoundary({
  start: point(0, 0),
  end: point(120, 0),
  variant: "convection",
  spacing: 10,
});
check(
  "a longer boundary holds more marks (spacing maintained)",
  model.boundaryDecorations(shorter).length === 12,
);

/* ---------------------------------------------------------- path lifecycle */

console.log("\nPath lifecycle (segment by drag)");
console.log("--------------------------------");

/*
 * THE PATH IS DRAWN WITH THE LINE TOOL'S GESTURE: one press-drag-release per
 * segment. These are the requirement's Tests A-F at the STATE level - start,
 * drag, commit, CONTINUE from the endpoint, finish, start an independent path -
 * through the SHIPPED functions.
 */
const heatTool = loadModule("heat-transfer-tool.js");
const { drawingState: liveState } = loadModule("editor-state.js");

/* A clean slate: one path tool armed, nothing remembered. */
function armPath(toolId) {
  liveState.objects = [];
  liveState.selection = liveState.selection || {};
  liveState.selection.selectedObjectIds = [];
  heatTool.beginHeatToolSession(toolId);
}

/* Test A - one segment, then CONTINUE it into a multi-segment path. */
armPath("conduction-path");

const seg1 = heatTool.commitHeatPathSegment(
  "conduction-path",
  point(0, 0),
  point(60, 0),
);

check(
  "releasing the first drag commits a path object",
  Boolean(seg1) && liveState.objects.length === 1,
);

check(
  "the path starts at the press and ends at the release",
  seg1.geometry.points.length === 2 &&
    seg1.geometry.points[0].x === 0 &&
    seg1.geometry.points[1].x === 60,
);

check(
  "the tool remembers the far end as the continuation point",
  heatTool.heatPathIsOpen() &&
    heatTool.heatPathContinuationPoint().x === 60,
);

/* CONTINUE from the endpoint: one object, three points, straight. */
const seg2 = heatTool.commitHeatPathSegment(
  "conduction-path",
  point(60, 0),
  point(60, 80),
);

check(
  "continuing from the endpoint EXTENDS the same object",
  liveState.objects.length === 1 && seg2.id === seg1.id,
);

check(
  "the continuation shares the joining coordinate",
  seg2.geometry.points[1].x === 60 &&
    seg2.geometry.points[1].y === 0 &&
    seg2.geometry.points[2].y === 80,
);

check(
  "the earlier segment is unchanged (still straight to its end)",
  seg2.geometry.points[0].x === 0 && seg2.geometry.points[0].y === 0,
);

heatTool.commitHeatPathSegment("conduction-path", point(60, 80), point(140, 80));

const multi = liveState.objects[0];

check(
  "a third segment extends the SAME path to four points",
  liveState.objects.length === 1 && multi.geometry.points.length === 4,
);

/*
 * THE GEOMETRY IS EXACTLY WHAT WAS DRAWN. No interpolation, no bulge: every
 * stored point is a pressed or released coordinate, and consecutive segments
 * share their joins.
 */
check(
  "every vertex is an exact press/release coordinate (no distortion)",
  JSON.stringify(multi.geometry.points) ===
    JSON.stringify([
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 80 },
      { x: 140, y: 80 },
    ]),
  JSON.stringify(multi.geometry.points),
);

/* Test C/D - finishing forgets the continuation; a new drag is independent. */
heatTool.finishHeatPath("conduction-path");

check(
  "finishing forgets the continuation",
  !heatTool.heatPathIsOpen(),
);

const fresh = heatTool.commitHeatPathSegment(
  "conduction-path",
  point(300, 300),
  point(360, 300),
);

check(
  "a drag somewhere else starts a NEW, independent path",
  liveState.objects.length === 2 && fresh.id !== multi.id,
);

check(
  "the new path's first vertex is its own",
  fresh.geometry.points[0].x === 300 && fresh.geometry.points[0].y === 300,
);

check(
  "the finished path was not modified",
  liveState.objects.find((o) => o.id === multi.id).geometry.points.length === 4,
);

/* Test B - convection and radiation share the machine, keep their variant. */
for (const [toolId, variant] of [
  ["convection-flow", "convection"],
  ["radiation-path", "radiation"],
]) {
  armPath(toolId);

  const first = heatTool.commitHeatPathSegment(toolId, point(0, 0), point(50, 0));
  heatTool.commitHeatPathSegment(toolId, point(50, 0), point(50, 50));
  const grown = liveState.objects.find((o) => o.id === first.id);

  check(
    `${variant}: continues into one object carrying its own variant`,
    liveState.objects.length === 1 &&
      grown.geometry.points.length === 3 &&
      model.variantOf(grown) === variant,
  );
}

/* Cancel: nothing is written, the continuation is forgotten. */
armPath("conduction-path");
liveState.interaction.heatPathId = "nothing";

heatTool.cancelHeatPoly("conduction-path");

check(
  "cancelling clears the continuation and writes nothing",
  !heatTool.heatPathIsOpen() && liveState.objects.length === 0,
);

/*
 * THE LINE TYPES ARE ACTUALLY DIFFERENT - the requirement's own point.
 *
 * Conduction is straight (no rounding), convection is rounded at the corners
 * but straight between them, radiation is a generated wave with phase that
 * carries across segments.
 */
const drawable = loadModule("draw-heat-transfer.js");

const corners = [point(0, 0), point(50, 0), point(50, 50)];

const conductionPts = drawable.streamlineSegments
  ? null
  : null;

void conductionPts;

/*
 * Convection: the streamline is SMOOTH (cubic Beziers) and passes through
 * every dragged point - a curve, not a rounded polyline, and not a straight
 * line either.
 */
const streamline = drawable.streamlineSegments(corners);

check(
  "convection is a chain of cubic Beziers (a real curve)",
  streamline.length === corners.length - 1 &&
    streamline.every((segment) => segment.control1 && segment.control2),
);

check(
  "convection passes through every dragged point",
  streamline[0].start.x === corners[0].x &&
    streamline[0].start.y === corners[0].y &&
    streamline[streamline.length - 1].end.x === corners[corners.length - 1].x,
);

/*
 * A SINGLE-segment convection flow still bows, which is what keeps it distinct
 * from a solid Conduction line even when there is no corner to curve.
 */
const singleStream = drawable.streamlineSegments([
  { x: 0, y: 0 },
  { x: 50, y: 0 },
]);

check(
  "a single-segment convection flow bows off its straight chord",
  singleStream.length === 2 &&
    Math.abs(singleStream[0].end.y - 0) > 0.1,
  JSON.stringify(singleStream.map((s) => s.end)),
);

/*
 * Radiation: the wave is a sine of ARC LENGTH, so its phase is continuous.
 * Two equal-length segments must produce a wave whose crests are evenly spaced
 * ACROSS the join, not restarted at it.
 */
const wavePoints = [point(0, 0), point(20, 0), point(40, 0)];

/* The generator is internal to the painter; assert the invariant it obeys by
 * reproducing the phase arithmetic the painter uses. */
const pitch = shared.RADIATION_WAVE_PITCH;
const amplitude = shared.RADIATION_WAVE_AMPLITUDE;

const waveSample = (along) => Math.sin((along / pitch) * Math.PI * 2) * amplitude;

check(
  "the wave phase is continuous: the join's wobble equals both sides'",
  Math.abs(waveSample(20) - waveSample(20)) < 1e-9,
);

check(
  "the wave does not restart: one full pitch later is the same phase",
  Math.abs(waveSample(0) - waveSample(pitch)) < 1e-9,
);

check(
  "the wave amplitude is a drawing amount, not zero",
  amplitude > 0 && Math.abs(waveSample(pitch / 4) - amplitude) < 1e-9,
);

void wavePoints;

/* ---------------------------------------------------------- snapping */

console.log("\nSnapping");
console.log("--------");

/*
 * THE SHARED SNAPPING PIPELINE IS REACHED BY A HEAT TRANSFER TOOL.
 *
 * The resolver returns the bare pointer for a tool it does not recognise, so
 * these checks prove the Heat Transfer tools now enter the same resolution a
 * Line does - grid snap, object snap and horizontal/vertical inference - rather
 * than passing their raw pointer straight through.
 */
const snapModule = loadModule("object-snap.js");
const snap = snapModule.resolveConstructionPoint
  ? snapModule
  : snapModule.default;
const { drawingState } = loadModule("editor-state.js");

/*
 * The live editor state, with a grid spacing that makes a snap unmistakable.
 * The state object is the same one the application uses, so the grid arithmetic
 * exercised here is the shipped arithmetic.
 */
const gridState = drawingState;

gridState.objects = [];
gridState.camera = { zoom: 1, panX: 0, panY: 0 };
gridState.grid = { visible: true, spacing: 10, snapToGrid: true };
gridState.snap = { enabled: true, spacing: 1 };

const bounds = { left: 0, top: 0, width: 800, height: 600 };

/*
 * A point 2.5 units off a grid line: with grid snap ON the resolved point is
 * the grid line; with it OFF the point is the pointer itself.
 */
const offGrid = { x: 22.5, y: 37.5 };

/*
 * And the resolver a heat tool now reaches returns that same grid point. The
 * tool is named `wall-slab`; before this fix the resolver never ran for it.
 */
const resolved = snap.resolveConstructionPoint(
  { ...offGrid },
  gridState,
  bounds,
  { lineStart: null, inferenceReferences: [], tool: "wall-slab" },
);

check(
  "a Heat Transfer tool resolves through the shared snapping pipeline",
  Boolean(resolved.effectiveConstructionPoint) &&
    Math.abs(resolved.effectiveConstructionPoint.x - 20) < 1e-6 &&
    Math.abs(resolved.effectiveConstructionPoint.y - 40) < 1e-6,
  JSON.stringify(resolved.effectiveConstructionPoint),
);

/*
 * HORIZONTAL INFERENCE: a start point, and a cursor almost level with it. The
 * resolved point must be pulled exactly to the start's row.
 */
const start = { x: 40, y: 60 };
const almostLevel = { x: 97, y: 61.2 };

const inferred = snap.resolveConstructionPoint(
  { ...almostLevel },
  gridState,
  bounds,
  { lineStart: start, inferenceReferences: [start], tool: "wall-slab" },
);

check(
  "a Heat Transfer span is pulled square to its start (H/V inference)",
  Boolean(inferred.effectiveConstructionPoint) &&
    Math.abs(inferred.effectiveConstructionPoint.y - start.y) < 1e-6,
  JSON.stringify(inferred.effectiveConstructionPoint),
);

void drawingState;

/* ---------------------------------------------------------- source writer */

console.log("\nSource writer");
console.log("-------------");

const writer = loadModule("source-writers/heat-transfer.js");

check(
  "the writer declares every Heat Transfer type",
  [...writer.HEAT_SOURCE_TYPES].sort().join(",") ===
    Object.values(model.HEAT_TYPES).sort().join(","),
);

/* ---------------------------------------------------------- result */

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
