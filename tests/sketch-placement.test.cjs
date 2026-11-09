/* eslint-disable no-console */
/*
 * ========================================================
 * PLACING A FINISHED SKETCH
 * ========================================================
 *
 * The student draws, DAETUM reconstructs, and the student chooses where the
 * result belongs. This suite holds that contract:
 *
 *   Apply enters a placement, it does not commit;
 *   the preview follows the cursor and matches what will be committed;
 *   the click commits at the chosen location;
 *   the page grid aligns the anchor, and a graph's origin and ticks with it;
 *   a sketch without axes gets ordinary anchor placement, not invented
 *     calibration;
 *   Escape cancels;
 *   the committed result is the preview.
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

const { createHarness } = require("./harness-renderer.cjs");

const { dom } = createHarness(projectRoot, JSDOM, require);

[
  "drawingProperties",
  "drawingToolMessage",
  "drawingCoordinates",
  "drawingZoomValue",
  "drawingToolHeading",
  "drawingToolList",
  "drawingFeaturesBack",
  "drawingFeatures",
].forEach((id) => {
  const element = dom.window.document.createElement("div");

  element.id = id;
  dom.window.document.body.appendChild(element);
});

const canvas = dom.window.document.createElement("div");

canvas.className = "drawing-canvas";
dom.window.document.body.appendChild(canvas);

const { loadModule } = require("./helpers/source-path.cjs");

const { drawingState } = loadModule("editor-state.js");
const placement = loadModule("grid-placement.js");
const session = loadModule("placement-session.js");
const mathTools = loadModule("math-tools.js").default;
const mathModel = loadModule("math-model.js").default;

const click = (element) =>
  element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

function reset() {
  drawingState.objects = [];
  drawingState.selection.selectedObjectIds = [];
  drawingState.interaction = { phase: "idle" };
  drawingState.activeTool = "select";
  drawingState.grid = { visible: true, snapToGrid: true, spacing: 10 };
}

/* A graph with an origin and a tick spacing of 2. */
const graphSketch = {
  strokes: [
    {
      points: [
        { x: -4, y: 0 },
        { x: 4, y: 0 },
      ],
    },
    {
      points: [
        { x: 0, y: -4 },
        { x: 0, y: 4 },
      ],
    },
  ],
  calibration: {
    xMin: -5,
    xMax: 5,
    yMin: -5,
    yMax: 5,
    xTick: 2,
    yTick: 2,
    equalUnits: true,
  },
};

/* A plain line with no axes at all. */
const lineSketch = {
  strokes: [
    {
      points: [
        { x: 3, y: 7 },
        { x: 13, y: 17 },
      ],
    },
  ],
  calibration: null,
};

/* ================================================== the page grid */

console.log("\nThe page grid");
console.log("--------------");

reset();

check(
  "a visible grid with snapping on is enabled",
  placement.pageGridOf(drawingState).enabled,
);

drawingState.grid = { visible: false, snapToGrid: false, spacing: 10 };

check("a hidden grid is not", !placement.pageGridOf(drawingState).enabled);

drawingState.grid = { visible: true, snapToGrid: false, spacing: 10 };

check(
  "and neither is a visible grid with snapping switched off",
  !placement.pageGridOf(drawingState).enabled,
);

/* ================================================== graph alignment */

console.log("\nA graph aligns by its origin and ticks");
console.log("---------------------------------------");

reset();

const graphPlacement = placement.placeSketch(
  graphSketch,
  { x: 103, y: 57 },
  placement.pageGridOf(drawingState),
);

check(
  "the origin is the anchor",
  graphPlacement.anchor.x === 0 && graphPlacement.anchor.y === 0,
  JSON.stringify(graphPlacement.anchor),
);

check(
  "and it snaps to a grid intersection",
  graphPlacement.target.x === 100 && graphPlacement.target.y === 60,
  JSON.stringify(graphPlacement.target),
);

const origin = placement.applyPlacement({ x: 0, y: 0 }, graphPlacement);

check(
  "so the origin lands exactly on it",
  origin.x === 100 && origin.y === 60,
  JSON.stringify(origin),
);

/*
 * THE INVARIANT IS THAT A WHOLE NUMBER OF TICKS FITS ONE CELL. A tick of 2 on
 * a 10-unit grid is five ticks to a cell, so the scale is 1 and five ticks
 * span exactly one cell - not that a single tick spans a whole cell.
 */
const ticksPerCell = 10 / (graphPlacement.scale * 2);

check(
  "a whole number of ticks fits one page cell",
  Math.abs(ticksPerCell - Math.round(ticksPerCell)) < 1e-9,
  `${ticksPerCell} ticks per cell`,
);

check(
  "and five ticks span exactly one cell",
  Math.abs(graphPlacement.scale * 2 * 5 - 10) < 1e-9,
  String(graphPlacement.scale * 2 * 5),
);

/* Equal units survive: one unit is the same length on both axes. */
const unitX = placement.applyPlacement({ x: 1, y: 0 }, graphPlacement);
const unitY = placement.applyPlacement({ x: 0, y: 1 }, graphPlacement);

check(
  "equal unit scaling is preserved",
  Math.abs(
    Math.hypot(unitX.x - origin.x, unitX.y - origin.y) -
      Math.hypot(unitY.x - origin.x, unitY.y - origin.y),
  ) < 1e-9,
);

/* A tick that does not divide the grid is not forced. */
const odd = placement.placeSketch(
  {
    strokes: graphSketch.strokes,
    calibration: { ...graphSketch.calibration, xTick: 4, yTick: 4 },
  },
  { x: 100, y: 50 },
  placement.pageGridOf(drawingState),
);

check(
  "a tick that does not match the grid is not stretched to fit",
  odd.scale === 1,
  String(odd.scale),
);

check("and the student is told why", Boolean(odd.note), String(odd.note));

/* ============================================ sketches without axes */

console.log("\nA sketch without axes is placed by its anchor");
console.log("----------------------------------------------");

const linePlacement = placement.placeSketch(
  lineSketch,
  { x: 103, y: 57 },
  placement.pageGridOf(drawingState),
);

check("no origin is invented", linePlacement.calibration === null);

check(
  "the bounding box corner is the anchor",
  linePlacement.anchor.x === 3 && linePlacement.anchor.y === 7,
  JSON.stringify(linePlacement.anchor),
);

check(
  "and it snaps like any other placement",
  linePlacement.target.x === 100 && linePlacement.target.y === 60,
  JSON.stringify(linePlacement.target),
);

check(
  "at its own scale",
  linePlacement.scale === 1,
  String(linePlacement.scale),
);

/* ================================================== grid disabled */

console.log("\nWith the grid off");
console.log("------------------");

drawingState.grid = { visible: false, snapToGrid: false, spacing: 10 };

const free = placement.placeSketch(
  graphSketch,
  { x: 103, y: 57 },
  placement.pageGridOf(drawingState),
);

check("nothing snaps", !free.snapped);

const freeOrigin = placement.applyPlacement({ x: 0, y: 0 }, free);

check(
  "the origin lands exactly where the student clicked",
  freeOrigin.x === 103 && freeOrigin.y === 57,
  JSON.stringify(freeOrigin),
);

check("and the scale is unchanged", free.scale === 1, String(free.scale));

/* ================================================== the session */

console.log("\nThe placement session");
console.log("----------------------");

reset();

let committed = null;

check(
  "a placement can begin",
  session.beginPlacement(graphSketch, {
    commit: (result) => {
      committed = result;
    },
  }),
);

check("and it is pending", session.placementPending());

session.movePlacement({ x: 103, y: 57 });

check(
  "moving publishes a preview",
  Boolean(drawingState.interaction.preview?.placement),
);

check(
  "and the preview carries the strokes",
  drawingState.interaction.preview?.strokes?.length === 2,
  String(drawingState.interaction.preview?.strokes?.length),
);

session.commitPlacement({ x: 103, y: 57 });

check("the click commits", Boolean(committed));

check(
  "at the position the preview showed",
  committed?.target?.x === 100 && committed?.target?.y === 60,
  JSON.stringify(committed?.target),
);

check("and the placement is finished", !session.placementPending());

check("and the preview is cleared", !drawingState.interaction.preview);

/* Escape. */
session.beginPlacement(graphSketch, {
  commit: () => {
    throw new Error("a cancelled placement must not commit");
  },
});

session.movePlacement({ x: 50, y: 50 });

check("Escape cancels a pending placement", session.cancelPlacement());

check("and nothing is committed", !session.placementPending());

check("and the preview is gone", !drawingState.interaction.preview);

/* ================================================== the workflow */

console.log("\nApply enters placement, the click commits");
console.log("------------------------------------------");

reset();

const editor = mathTools.openGraphEditor("plot", null);

click(editor.querySelector("[data-graph-add]"));
click(editor.querySelector("[data-graph-apply]"));

check(
  "Apply commits nothing",
  drawingState.objects.length === 0,
  String(drawingState.objects.length),
);

check("and a placement is pending", session.placementPending());

session.movePlacement({ x: 103, y: 57 });
session.commitPlacement({ x: 103, y: 57 });

check(
  "the click commits one graph",
  drawingState.objects.length === 1,
  String(drawingState.objects.length),
);

check(
  "and it is one unified math-plot",
  drawingState.objects[0]?.type === "math-plot",
  drawingState.objects[0]?.type,
);

check(
  "with its function as a component, not a second object",
  mathModel.plotFunctions(drawingState.objects[0]).length === 1 &&
    drawingState.objects.length === 1,
);

check(
  "and it sits where the student clicked",
  drawingState.objects[0]?.geometry?.position?.x === 100,
  JSON.stringify(drawingState.objects[0]?.geometry?.position),
);

/* ============================================================ summary */

console.log(`\n${pass} passed, ${fail} failed`);

if (fail > 0) {
  process.exitCode = 1;
}
