
const { JSDOM } = require("jsdom");

const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * ========================================================
 * TICKS
 * ========================================================
 *
 * A gridded axis. This deliberately REVERSES a principle the renderer used
 * to hold - that a tick or a number on the axis "would be the tool
 * answering the exercise" - because reading a magnitude off a ruler is
 * doing the exercise, not having it done for you. The principle is
 * preserved in the check that still forbids a RANGE: the scale is the
 * student's, the application does not claim to know what the answer is.
 *
 * What matters here is that the ticks agree with the curve. A grid that
 * disagrees with the drawing is worse than no grid, because it is believed.
 */


const projectRoot = path.join(__dirname, "..");
const dir = sourceDir();

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

const dom = new JSDOM(
  '<!doctype html><html><body><div id="canvas"></div></body></html>',
  { pretendToBeVisual: true },
);

global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.window.requestAnimationFrame = global.requestAnimationFrame;
global.window.cancelAnimationFrame = (id) => clearTimeout(id);

for (const name of [
  "measurement-core.js",
  "quantities.js",
  "dimension-model.js",
  "annotation-model.js",
  "diagram-equations.js",
  "load-profile.js",
  "body-frames.js",
  "feature-geometry.js",
  "drawing-state.js",
  "analysis-dependencies.js",
  "renderer.js",
]) {
  loadModule(name);
}

for (const name of Object.keys(global.window)) {
  if (/^engg[A-Z]/.test(name) && global[name] === undefined) {
    global[name] = global.window[name];
  }
}

const renderer = global.window.enggDrawingRenderer;
const canvas = global.document.getElementById("canvas");

const scene = (objects) => ({
  objects,
  display: { showMagnitudes: true, showUnits: true },
  scale: { mmPerUnit: 1, unit: "mm" },
  selection: {
    selectedObjectIds: [],
    boxSelectionIds: [],
    hoveredObjectId: null,
  },
  interaction: { phase: "idle", preview: null, previewObjects: [] },
  camera: { zoom: 1, panX: 0, panY: 0 },
  styleDefaults: { stroke: "#000000", lineWidth: 0.5 },
  grid: { visible: false, spacing: 10 },
  snap: { enabled: false },
});

const diagram = (extra) => ({
  id: "sfd-1",
  type: "analysis-diagram",
  name: "SFD 1",
  geometry: {
    diagramType: "sfd",
    mode: "plot",
    start: { x: 0, y: 0 },
    end: { x: 500, y: 0 },
    localRange: { from: 0, to: 500 },
    showZeroAxis: true,
    expressions: [
      {
        id: "e1",
        relationType: "functionX",
        expression: "10",
        xRange: { start: 0, end: 500 },
      },
    ],
    ...extra,
  },
  style: { stroke: "#000000", lineWidth: 0.5 },
});

/* The numbers the ticks actually printed. */
const tickNumbers = (object) => {
  renderer.renderDrawing(scene([object]), canvas);

  return [...canvas.querySelectorAll("text")].map((t) => t.textContent);
};

const xNumbers = (object) =>
  tickNumbers(object).filter((t) => /^-?[\d.]+$/.test(t));

console.log("\n  off by default\n");

check(
  "no numbers on the axes unless asked for",
  xNumbers(diagram({ xTickSpacing: 100, yTickSpacing: 5 })).length === 0,
  `drew ${JSON.stringify(xNumbers(diagram({ xTickSpacing: 100 })))}`,
);

console.log("\n  x ticks are stations along the member\n");

const xed = diagram({
  showTicks: true,
  xTickSpacing: 100,
  yTickSpacing: 0,
});

const stations = xNumbers(xed);

check(
  "every 100 along a 500 member",
  stations.includes("100") &&
    stations.includes("200") &&
    stations.includes("500"),
  `got ${JSON.stringify(stations)}`,
);

check(
  "starting at zero, because the range starts there",
  !stations.includes("1000"),
  `a tick past the end of the member: ${JSON.stringify(stations)}`,
);

console.log("\n  y ticks are real values, signed both ways\n");

const yed = diagram({
  showTicks: true,
  xTickSpacing: 0,
  yTickSpacing: 5,
});

const values = xNumbers(yed);

check(
  "positive values are labelled",
  values.includes("5") && values.includes("10"),
  `got ${JSON.stringify(values)}`,
);

check(
  "and negative ones too, because a diagram has two sides",
  values.includes("-5"),
  `got ${JSON.stringify(values)} - the negative half cannot be read`,
);

console.log("\n  a spacing that would bury the diagram draws NONE\n");

/*
 * 0.001 on a 500 member is five hundred thousand marks. Drawing some
 * arbitrary subset would be worse than drawing none: it would be a scale
 * the student never asked for, over a diagram they could no longer read.
 */
const absurd = diagram({
  showTicks: true,
  xTickSpacing: 0.001,
  yTickSpacing: 0,
});

check(
  "an unreadable spacing is ignored rather than honoured",
  xNumbers(absurd).length === 0,
  `drew ${xNumbers(absurd).length} tick(s) for a spacing of 0.001`,
);

console.log("\n  and the ticks agree with the curve\n");

/*
 * ========================================================
 * THE ONE THAT ACTUALLY MATTERS
 * ========================================================
 *
 * A grid that disagrees with the drawing is worse than no grid, because it
 * is BELIEVED. A student who draws a value at 10 and reads 10 off the axis
 * beside it is checking their work correctly; if the grid's 10 is a
 * different height from where 10 is drawn, that check returns the wrong
 * answer with total confidence.
 *
 * BOTH NUMBERS COME FROM THE SAME RENDER, so they are compared directly.
 *
 * Two earlier attempts at this assertion were wrong rather than passing:
 * the first compared a screen number against a projected world one, and the
 * second projected the tick's attributes - which are ALREADY screen
 * coordinates - putting it 650px from the curve. Neither would have caught a
 * real disagreement.
 */
const ticked = diagram({
  showTicks: true,
  xTickSpacing: 0,
  yTickSpacing: 5,
});

renderer.renderDrawing(scene([ticked]), canvas);

/* The curve, as the renderer laid it out. */
const curvePath = canvas.querySelector(
  ".drawing-analysis-curve",
);

check("the curve is on the sheet", Boolean(curvePath));

/* The tick labelled 10. */
const tenLabel = [...canvas.querySelectorAll("text")].find(
  (t) => t.textContent === "10",
);

check("the 10 tick exists", Boolean(tenLabel));

if (curvePath && tenLabel) {
  /*
   * The curve is a constant 10, so it is one horizontal line and its y is
   * read from the path data rather than from a bounding box - which would
   * include the stroke width and make the comparison fuzzy.
   *
   * THE SIGN IS PART OF THE NUMBER. jsdom's canvas has no layout, so the
   * projection puts the graph above the viewport and every coordinate comes
   * out negative. A pattern of digits and dots alone does not match `-192`,
   * which made this assertion fail on a diagram that was exactly right.
   */
  const drawnY = Number(
    /M -?[\d.]+ (-?[\d.]+)/.exec(curvePath.getAttribute("d"))?.[1],
  );

  /*
   * The tick's LABEL is drawn 2.5px below its mark, because text sits on
   * its baseline; the mark itself is the line, at the value's height.
   */
  const tickY = Number(tenLabel.getAttribute("y")) - 2.5;

  check(
    "and it sits exactly where the value of 10 is drawn",
    Number.isFinite(drawnY) && Math.abs(tickY - drawnY) < 1,
    `the tick is at screen y=${tickY}, the curve at y=${drawnY}`,
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
