
const { JSDOM } = require("jsdom");

const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * ========================================================
 * READING A CURSOR IN THE GRAPH'S OWN UNITS
 * ========================================================
 *
 * The status readout reports world coordinates, because that is what the
 * sheet is drawn in. But a student sketching a shear diagram does not want
 * the world y of a pixel - they want the VALUE they are at, and how far
 * along the member they are.
 *
 * The property that matters is that it AGREES WITH THE DRAWING. So these
 * round-trip: a point is converted into world, then read back, and the two
 * must be the same value. A readout that disagreed with the curve beside it
 * by even a factor would be worse than no readout, because it would be
 * believed.
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

const renderer = global.window.enggDrawingRenderer;

check("the reader is exposed", typeof renderer.analysisValueAt === "function");

/* The diagram is drawn from (0,0) to (500,0), over a 0-500 member. */
const plot = {
  diagramType: "sfd",
  mode: "plot",
  start: { x: 0, y: 0 },
  end: { x: 500, y: 0 },
  localRange: { from: 0, to: 500 },
  expressions: [
    {
      id: "e1",
      relationType: "functionX",
      expression: "10",
      xRange: { start: 0, end: 500 },
    },
  ],
};

console.log("\n  x reads as a station along the member\n");

const mid = renderer.analysisValueAt(plot, { x: 250, y: 0 });

check(
  "the middle of the axis is the middle of the range",
  Math.abs(mid.x - 250) < 1e-6,
  `x=250 world read as ${mid.x}`,
);

const end = renderer.analysisValueAt(plot, { x: 500, y: 0 });

check(
  "the far end is the end of the range",
  Math.abs(end.x - 500) < 1e-6,
  `read ${end.x}`,
);

console.log("\n  y reads as a VALUE, not a pixel\n");

/*
 * A constant 10 is drawn at the same world y everywhere. Reading it back
 * must give 10 - which is only true if the reader divides by the same scale
 * the marks were built with.
 */
const marks = renderer.analysisPlotMarks(plot);

const drawnTop = marks[0].points.reduce(
  (peak, p) => Math.max(peak, p.y),
  0,
);

const readBack = renderer.analysisValueAt(plot, {
  x: 250,
  y: drawnTop,
});

check(
  "the height a value was drawn at reads back as that value",
  Math.abs(readBack.y - 10) < 1e-6,
  `a value of 10 drawn at world y=${drawnTop} read back as ${readBack.y}`,
);

console.log("\n  and a set range moves it, as the drawing does\n");

const ranged = { ...plot, yRange: { from: -20, to: 20 } };

const rangedMarks = renderer.analysisPlotMarks(ranged);

const rangedTop = rangedMarks[0].points.reduce(
  (peak, p) => Math.max(peak, p.y),
  0,
);

const rangedRead = renderer.analysisValueAt(ranged, {
  x: 250,
  y: rangedTop,
});

check(
  "with a wider range the same value sits lower and still reads as 10",
  Math.abs(rangedRead.y - 10) < 1e-6,
  `read ${rangedRead.y}`,
);

check(
  "and it really did sit lower",
  rangedTop < drawnTop,
  `range 20 drew at ${rangedTop}, auto drew at ${drawnTop}`,
);

console.log("\n  it reads a sketch too\n");

/*
 * A SKETCH IS READ AGAINST ITS OWN STORED SCALE.
 *
 * A sketch's strokes are ordinary features now, so the diagram has no list of
 * points to take a peak from. What it does have is the units-per-value the
 * strokes were drawn against (`unitHeight`), and that is what the readout
 * scales by - so a cursor over a sketched diagram still reports a value.
 */
const sketch = {
  diagramType: "bmd",
  mode: "sketch",
  start: { x: 0, y: 0 },
  end: { x: 300, y: 0 },
  localRange: { from: 0, to: 300 },
  unitHeight: 2,
};

const sketchRead = renderer.analysisValueAt(sketch, { x: 150, y: 0 });

check(
  "a sketch's zero is still the origin",
  Math.abs(sketchRead.x - 150) < 1e-6,
  `read ${sketchRead.x}`,
);

check(
  "and a sketch with a stored scale has a usable value",
  typeof sketchRead.y === "number",
  `read ${sketchRead.y}`,
);

check(
  "a sketch with no scale says nothing",
  renderer.analysisValueAt(
    { ...sketch, unitHeight: 0 },
    { x: 150, y: 0 },
  ) === null,
  "a sketch with no scale reported a value it cannot compute",
);

console.log("\n  and it refuses rather than guessing\n");

check(
  "a diagram with no range says nothing",
  renderer.analysisValueAt(
    { ...plot, localRange: null },
    { x: 0, y: 0 },
  ) === null,
);

check(
  "a zero-length member says nothing",
  renderer.analysisValueAt(
    { ...plot, start: { x: 5, y: 0 }, end: { x: 5, y: 0 } },
    { x: 5, y: 0 },
  ) === null,
);

check(
  "an empty plot has no scale to report in",
  renderer.analysisValueAt(
    { ...plot, expressions: [] },
    { x: 250, y: 0 },
  ) === null,
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
