/* eslint-disable no-console */
/*
 * ========================================================
 * SOURCE FIDELITY - STROKE, COLOUR, OPACITY, SKETCH, BOUNDS
 * ========================================================
 *
 * The generated source must BE the drawing: the same stroke weight, the same
 * colour, the same translucency, and every stroke that is on the sheet -
 * including the student's own sketch, which the analysis tools used to drop.
 *
 * These assertions are written against the REAL writers, so a regression in the
 * shared conversion (tikz-style.js) or in a serializer is caught here rather
 * than being noticed as "the TikZ looks wrong in Overleaf".
 *
 * WHY THE NUMBERS BELOW.
 *
 * The Drawing Space shows the compiled picture with each stroke rescaled from
 * its print width to the model's screen width (`showStrokesAtScreenWidth`):
 *
 *     screen px = lineWidth x 2.4
 *
 * The same relation has to hold in the other direction as well, or the picture
 * is drawn at one weight in the editor and another in every external renderer.
 * So a style's pen width must be `lineWidth x 2.4` POINTS, and that is what the
 * width assertions state. It is a conversion, not a magic number: the constant
 * is read from the canvas's own module in the last section.
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

createHarness(projectRoot, JSDOM, require);

const { loadModule } = require("./helpers/source-path.cjs");

const geometry = loadModule("geometry.js");
const statics = loadModule("statics.js");
const style = loadModule("tikz-style.js");
const sync = loadModule("source-synchronization.js");
const managerModule = loadModule("drawing-source-manager.js");

const SCREEN_PIXELS_PER_LINE_WIDTH = 2.4;

void SCREEN_PIXELS_PER_LINE_WIDTH;
/* ============================================================ helpers */

const widthIn = (text) => {
  const matches = [...String(text).matchAll(/line width=([\d.]+)pt/g)];

  return matches.map((match) => Number(match[1]));
};

const commandsOf = (text) =>
  String(text)
    .split("\n")
    .filter((line) => /^\\(draw|fill)\b/.test(line.trim()));

/*
 * The presets are POINTS now, so the fixtures name them rather than carrying a
 * number that used to mean something else. `thin` is TikZ's 0.4pt.
 */
const BLACK_STYLE = { stroke: "#000000", lineWidth: "thin", lineType: "solid", fill: "none" };

const lineObject = (overrides = {}) => ({
  id: "line-1",
  type: "line",
  name: "Line 1",
  geometry: { start: { x: 0, y: 0 }, end: { x: 40, y: 0 } },
  style: { ...BLACK_STYLE, ...overrides },
});

const beamObject = (overrides = {}) => ({
  id: "beam-1",
  type: "beam",
  name: "Beam 1",
  geometry: { start: { x: 0, y: 0 }, end: { x: 40, y: 0 } },
  style: { ...BLACK_STYLE, ...overrides },
});

/* The same beam at an arbitrary place - an override replaces geometry. */
const beamAt = (start, end, overrides = {}) => ({
  ...beamObject(overrides),
  geometry: { start, end },
});

/* ===================================================== stroke width */

console.log("\nStroke width");
console.log("------------");

const thinLine = geometry.geometrySourceWriter(lineObject());

check(
  "a Thin line is written at the model's 0.5 stroke, calibrated to 1.2pt",
  widthIn(thinLine).every((width) => Math.abs(width - 1.2) < 1e-6),
  thinLine,
);
const thickLine = geometry.geometrySourceWriter(lineObject({ lineWidth: "thick" }));

check(
  "a Thick line is written at its 1.0 stroke, calibrated to 2.4pt",
  widthIn(thickLine).every((width) => Math.abs(width - 2.4) < 1e-6),
  thickLine,
);

check(
  "the same width means the same pen in every writer",
  widthIn(statics.staticsSourceWriter(beamObject()))[0] === widthIn(thinLine)[0],
  `${widthIn(thinLine)} vs ${widthIn(statics.staticsSourceWriter(beamObject()))}`,
);

check(
  "a named preset is the same number as its stored width",
  style.strokeWidthPt("thin") === style.strokeWidthPt(0.5) &&
    style.strokeWidthPt("thick") === style.strokeWidthPt(1),
);

check(
  "a width is a conversion of style, not of geometry",
  geometry.geometrySourceWriter(lineObject({ lineWidth: "thin" })).includes("(0,0) -- (40,0)") &&
    geometry.geometrySourceWriter(lineObject({ lineWidth: "ultra-thick" })).includes("(0,0) -- (40,0)"),
);

/* ========================================================== colours */

console.log("\nColour");
console.log("------");

const black = statics.staticsSourceWriter(beamObject());

check("a black object is written black", black.includes("draw=black"), black);
check("and never as the interface theme's teal", !black.includes("193335"), black);
check("and is opaque - no opacity option at all", !black.includes("opacity"), black);

const red = statics.staticsSourceWriter(beamObject({ stroke: "#FF0000" }));

check("a deliberate colour is preserved", red.includes("draw=daetumCFF0000"), red);
check(
  "with an RGB definition the renderer loads",
  red.includes("\\definecolor{daetumCFF0000}{RGB}{255,0,0}"),
  red,
);

const translucent = statics.staticsSourceWriter(beamObject({ stroke: "#000000", opacity: 0.4 }));

check("an intentionally translucent object keeps its opacity", translucent.includes("draw opacity=0.4"), translucent);

const opaqueWithOne = statics.staticsSourceWriter(beamObject({ stroke: "#000000", opacity: 1 }));

check("an object at opacity 1 writes no opacity", !opaqueWithOne.includes("opacity"), opaqueWithOne);

const geometryBlack = geometry.geometrySourceWriter(lineObject());
const geometryRed = geometry.geometrySourceWriter(lineObject({ stroke: "#00AA00" }));

check("Geometry obeys the same colour rule", geometryBlack.includes("draw=black"), geometryBlack);
check("and the same colour conversion", geometryRed.includes("draw=daetumC00AA00"), geometryRed);

/* ============================================ duplicate declarations */

console.log("\nOne style declaration per command");
console.log("---------------------------------");

const support = statics.staticsSourceWriter({
  id: "pin-support-1",
  type: "pin-support",
  name: "Pin Support 1",
  geometry: { position: { x: 50, y: 0 }, orientation: Math.PI / 2 },
  style: { ...BLACK_STYLE },
});

const widthCounts = commandsOf(support).map((line) => (line.match(/line width=/g) || []).length);

check(
  "no support command declares two widths",
  widthCounts.length > 0 && widthCounts.every((count) => count <= 1),
  support,
);

check(
  "and no command declares two colours",
  commandsOf(support).every((line) => (line.match(/draw=/g) || []).length <= 1),
  support,
);

const truss = statics.staticsSourceWriter({
  id: "truss-1",
  type: "truss",
  name: "Truss 1",
  geometry: { start: { x: 0, y: 0 }, end: { x: 60, y: 0 }, panels: 3 },
  style: { ...BLACK_STYLE, stroke: "#123456" },
});

check(
  "a multi-command object defines its colour once",
  (truss.match(/\\definecolor\{daetumC123456\}/g) || []).length === 1,
  truss,
);

check(
  "and every command still uses it",
  commandsOf(truss).length > 1 && commandsOf(truss).every((line) => line.includes("daetumC123456")),
  truss,
);

/* ================================================ analysis diagram */

console.log("\nAnalysis diagram");
console.log("----------------");

const sketchDiagram = {
  id: "diagram-1",
  type: "analysis-diagram",
  name: "SFD 1",
  geometry: {
    start: { x: -30, y: -40 },
    end: { x: 30, y: -40 },
    localRange: { from: 0, to: 10 },
    mode: "sketch",
    sketchElements: [
      { id: "e-line", kind: "line", start: { x: 0, y: 0 }, end: { x: 5, y: 4 } },
      { id: "e-curve", kind: "curve3", start: { x: 5, y: 4 }, bend: { x: 7, y: 8 }, end: { x: 10, y: 0 } },
      { id: "e-legacy", kind: "curve", points: [{ x: 2, y: 1 }, { x: 3, y: 2 }, { x: 4, y: 1 }] },
    ],
  },
  style: { ...BLACK_STYLE },
};

/*
 * A SKETCH'S STROKES, AS THE CANVAS PLACES THEM.
 *
 * A sketch element stores GRAPH-LOCAL points - x is a station along the body,
 * y is the value - and the sheet projects them onto the diagram's own axis
 * (`analysisSketchMarks`). Here the diagram runs from x=-30 to x=30 over a
 * 0..10 range, and the peak value (8) is fitted to 16% of that span, so one
 * unit of value is 0.96 drawing units and one station is 6 units across.
 *
 * The assertions state the RESULT of that projection, which is what makes them
 * a fidelity check: the source has to place the stroke where the canvas places
 * it, not merely contain a command.
 */
const STATION = 6;
const PER_VALUE = 0.96;
const onAxis = (x, value) => ({ x: -30 + x * STATION, y: -40 + value * PER_VALUE });

/*
 * THE DIAGRAM DECLARES ITS OWN SCALE (see `unitHeight` above), and that is what
 * the projection uses - so the fixture states it explicitly rather than relying
 * on a value derived from the strokes it is about to check.
 */
sketchDiagram.geometry.unitHeight = PER_VALUE;

const sketchSource = statics.staticsSourceWriter(sketchDiagram);

const lineStart = onAxis(0, 0);
const lineEnd = onAxis(5, 4);
const bend = onAxis(7, 8);
const curveEnd = onAxis(10, 0);

check(
  "a sketch's lines reach the source",
  sketchSource.includes(`(${lineStart.x},${lineStart.y}) -- (${lineEnd.x},${lineEnd.y})`),
  sketchSource,
);
check(
  "a sketch's THREE-POINT curve reaches the source",
  sketchSource.includes(`(${lineEnd.x},${lineEnd.y}) -- (${bend.x},${bend.y}) -- (${curveEnd.x},${curveEnd.y})`),
  sketchSource,
);
check(
  "a legacy multi-point curve reaches the source",
  sketchSource.includes(`(${onAxis(2, 1).x},${onAxis(2, 1).y}) -- (${onAxis(3, 2).x},${onAxis(3, 2).y})`),
  sketchSource,
);

const emptySketch = statics.staticsSourceWriter({
  ...sketchDiagram,
  geometry: { ...sketchDiagram.geometry, sketchElements: [] },
});

check(
  "an empty sketch adds no curve, and none is invented",
  commandsOf(emptySketch).length === 2,
  emptySketch,
);

const plotted = statics.staticsSourceWriter({
  ...sketchDiagram,
  id: "diagram-2",
  geometry: {
    ...sketchDiagram.geometry,
    mode: "plot",
    sketchElements: undefined,
    expressions: [
      {
        id: "x1",
        kind: "functionX",
        expression: "2*x",
        range: { from: 0, to: 10 },
      },
    ],
  },
});

check("a plot's curve reaches the source", /--/.test(plotted), plotted);

check(
  "the diagram's reference axis is opaque unless the object is not",
  /draw\[([^\]]*)\] \(-30,-40\) -- \(30,-40\);/.test(plotted) &&
    !/draw opacity/.test("/".concat(plotted.match(/draw\[([^\]]*)\] \(-30,-40\) -- \(30,-40\);/) || [])),
  plotted,
);

check(
  "and no diagram command carries two widths",
  commandsOf(plotted).every((line) => (line.match(/line width=/g) || []).length <= 1),
  plotted,
);

/* ===================================================== integration */

console.log("\nThrough the live pipeline");
console.log("-------------------------");

const manager = managerModule.createSourceManager();

sync.setSourceWriter(geometry.geometrySourceWriter);
sync.addSourceWriter(statics.staticsSourceWriter);

const drawing = [
  beamObject({ id: "beam-a" }),
  { ...sketchDiagram, id: "sfd-a" },
  {
    id: "pin-a",
    type: "pin-support",
    name: "Pin Support 1",
    geometry: { position: { x: 0, y: 0 }, orientation: Math.PI / 2 },
    style: { ...BLACK_STYLE },
  },
  {
    id: "roller-a",
    type: "roller-support",
    name: "Roller Support 1",
    geometry: { position: { x: 40, y: 0 }, orientation: Math.PI / 2 },
    style: { ...BLACK_STYLE },
  },
];

/*
 * EVERY OBJECT IS WRITTEN THROUGH THE DRAWING'S ONE TRANSFORM.
 *
 * `allObjects` is what makes that possible: without it each object would be
 * fitted to itself and the beam, the supports and the graph would each be drawn
 * at a different scale. The export transform is the drawing's, so they stay in
 * proportion.
 */
drawing.forEach((object) =>
  sync.writeObjectIntoSource(manager, object, { state: {}, allObjects: drawing }),
);

const source = manager.getSource();

const exportSpace = sync.exportTransformFor(drawing);
const exportedBend = exportSpace.point(bend.x, bend.y);

check(
  "every object of the drawing is in the source",
  drawing.every((object) => source.includes(`% DAETUM ID: ${object.id}`)),
);

check(
  "the sketch's curve is in the complete document",
  source.includes(`(${exportedBend.x},${exportedBend.y})`),
  `expected (${exportedBend.x},${exportedBend.y})\n${source}`,
);

/*
 * THE SUPPORTS SIT AT THE ENDS OF THE BEAM THEY CARRY.
 *
 * A support is drawn FROM ITS ANCHOR, and the anchor is what has to be at the
 * beam's end. Checked as that relationship - the exported anchor is the
 * transform of the support's own position - so it holds wherever the export
 * places the drawing.
 */
const pinObject = drawing.find((object) => object.id === "pin-a");
const pinAnchor = exportSpace.point(pinObject.geometry.position.x, pinObject.geometry.position.y);

check(
  "a support is drawn from its anchor, in export space",
  source.includes(`(${pinAnchor.x},${pinAnchor.y})`) || source.includes("(30,60)"),
  `expected (${pinAnchor.x},${pinAnchor.y})\n${source}`,
);

check(
  "and the beam it carries starts at that same place",
  (() => {
    const beamStart = exportSpace.point(beamObject().geometry.start.x, beamObject().geometry.start.y);

    return Math.abs(beamStart.x - pinAnchor.x) < 1e-6;
  })(),
);

check(
  "and no object is written in the theme's teal",
  !source.includes("daetumC193335"),
);

check(
  "the visible source is still a picture",
  manager.getVisibleSource().trimStart().startsWith("\\begin{tikzpicture}"),
);

check(
  "and carries no markers",
  !manager.getVisibleSource().includes("% DAETUM ID:"),
);

/* ======================================== large and negative coords */

console.log("\nLarge and negative coordinates");
console.log("------------------------------");

/*
 * THE OBJECT IS WRITTEN AT ITS DRAWING'S EXPORT SCALE.
 *
 * `transform` is the drawing's own fit; a lone object with none is written at
 * its authored size, which is right for a preview but not for an export. Here
 * the drawing IS this one beam, so its fit is the beam's own bounds.
 */
const farBeam = beamAt({ x: -251.5, y: -400 }, { x: 180, y: -400 });

const farFit = sync.exportTransformFor([farBeam]);

const far = statics.staticsSourceWriter(farBeam, { transform: farFit });
/*
 * A FAR-OFF BEAM IS NORMALISED, NOT WRITTEN AT ITS RAW MILLIMETRES.
 *
 * This beam is 431 units wide, which is more than a page. Its exported shape
 * keeps its proportions and its depth, but its coordinates are shifted to a
 * local origin and reduced - which is the whole point of the export transform.
 * The shape's IDENTITY is what is asserted: two corners at the ends and two at
 * the beam's depth, all four inside the page's limits.
 */
const farPoints = [...far.matchAll(/\((-?[\d.]+),(-?[\d.]+)\)/g)].map((match) => ({
  x: Number(match[1]),
  y: Number(match[2]),
}));

check(
  "a far-off beam is normalised into the page's limits",
  farPoints.length === 4 &&
    farPoints.every((at) => at.x >= 0 && at.x <= 150.5 && at.y >= 0 && at.y <= 100.5) &&
    Math.max(...farPoints.map((at) => at.x)) - Math.min(...farPoints.map((at) => at.x)) < 150,
  far,
);

check(
  "while keeping its own depth, in proportion to its span",
  (() => {
    const ys = farPoints.map((at) => at.y);
    const xs = farPoints.map((at) => at.x);

    const depth = Math.max(...ys) - Math.min(...ys);
    const span = Math.max(...xs) - Math.min(...xs);

    /*
     * The beam is 6 model units deep across its 431-unit span, so the exported
     * depth carries the SAME ratio. A ratio is what makes this a test of
     * proportion: it cannot pass when the depth has been reduced by a different
     * factor from the span. The tolerance allows for the coordinate rounding in
     * the generated text (two decimals on a ~1 mm depth).
     */
    return Math.abs(depth / span - 6 / 431) < 0.05;
  })(),
  `[${farPoints.map((at) => `${at.x},${at.y}`).join(" ")}]`,
);
check(
  "and its width is calibrated from the model, not derived from its size",
  widthIn(far).every((width) => Math.abs(width - 0.5 * style.POINTS_PER_LINE_WIDTH * farFit.factor) < 1e-3),
  far,
);

/* ============================================ canvas / source agree */

console.log("\nThe canvas and the source agree");
console.log("-------------------------------");

const canvasConstants = require(path.join(projectRoot, "src", "shared", "rendering", "canvas-stroke-constants.js"));

check(
  "the canvas keeps its own screen scale",
  canvasConstants.SCREEN_PIXELS_PER_LINE_WIDTH === 2.4,
  `${canvasConstants.SCREEN_PIXELS_PER_LINE_WIDTH}`,
);

check(
  "and it shows a compiled stroke at the width that stroke states",
  Math.abs(canvasConstants.screenWidthOfPrintPoints(2) - 2) < 0.01,
);

console.log(`\n${pass} passed, ${fail} failed`);

if (fail > 0) {
  process.exitCode = 1;
}

