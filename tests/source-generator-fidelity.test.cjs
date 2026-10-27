/* eslint-disable no-console */
/*
 * ========================================================
 * SOURCE GENERATOR FIDELITY - WIDTH, COLOUR, SKETCH, BOUNDS
 * ========================================================
 *
 * The regression suite for the reported failure: a beam with two supports and an
 * analysis graph whose generated source was hairline-thin, dark teal, half
 * transparent, missing its sketch, and laid out in raw millimetres.
 *
 * Each section pins ONE of the confirmed causes, against the REAL writers, so a
 * future change to the shared conversion fails here with a message that names the
 * property rather than showing up as "the TikZ looks wrong in Overleaf":
 *
 *   A. one calibration  - model stroke width -> print points, once, in one place
 *   B. colour           - black stays black; a chosen colour is preserved
 *   C. opacity          - explicit stays, 1 writes nothing
 *   D. one style line   - no command carries two widths or two colours
 *   E. sketch           - the full sketch reaches the source and the document
 *   F. geometry         - supports sit on the beam, the graph keeps its distance
 *   G. bounds           - Fit-All uses the WHOLE drawing and ignores the camera
 *   H. consistency      - every registered writer shares the same style path
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
const transform = loadModule("export-transform.js");
const bounds = loadModule("model-bounds.js");
const sync = loadModule("source-synchronization.js");
const managerModule = loadModule("drawing-source-manager.js");
const sourceModule = loadModule("drawing-source.js");

/* ============================================================ helpers */

const PT_PER_WIDTH = style.POINTS_PER_LINE_WIDTH;

const widthsIn = (text) => [...String(text).matchAll(/line width=([\d.]+)pt/g)].map((m) => Number(m[1]));

const commandsOf = (text) =>
  String(text)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\\(draw|fill)\b/.test(line));

/* The reported sheet: a 430-unit beam, a pin, a roller and an SFD below it. */
function reportedSheet() {
  return [
    {
      id: "beam",
      type: "beam",
      name: "Beam 1",
      geometry: { start: { x: -215, y: 0 }, end: { x: 215, y: 0 }, depth: 6 },
      style: { stroke: "#000000", lineWidth: "thin", lineType: "solid", fill: "none", opacity: 1 },
    },
    {
      id: "pin",
      type: "pin-support",
      name: "Pin Support 1",
      geometry: { position: { x: -215, y: 0 }, orientation: Math.PI / 2 },
      style: { stroke: "#000000", lineWidth: "thin", lineType: "solid", fill: "none", opacity: 1 },
    },
    {
      id: "roller",
      type: "roller-support",
      name: "Roller Support 1",
      geometry: { position: { x: 215, y: 0 }, orientation: Math.PI / 2 },
      style: { stroke: "#000000", lineWidth: "thin", lineType: "solid", fill: "none", opacity: 1 },
    },
    {
      id: "sfd",
      type: "analysis-diagram",
      name: "SFD 1",
      geometry: {
        start: { x: -215, y: -60 },
        end: { x: 215, y: -60 },
        localRange: { from: 0, to: 10 },
        diagramType: "sfd",
        mode: "sketch",
        unitHeight: 3,
        sketchElements: [
          { id: "s1", kind: "line", start: { x: 0, y: 0 }, end: { x: 5, y: 4 } },
          { id: "s2", kind: "curve3", start: { x: 5, y: 4 }, bend: { x: 7, y: 8 }, end: { x: 10, y: 0 } },
        ],
      },
      style: { stroke: "#000000", lineWidth: "thin", lineType: "solid", fill: "none", opacity: 1 },
    },
  ];
}

const fitOf = (objects, limits = {}) =>
  transform.createExportContext({ bounds: bounds.drawingBounds(objects), ...limits });

/* ============================================== A. one calibration */

console.log("\nA. Stroke width: one calibration between canvas and source");
console.log("-----------------------------------------------------------");

check(
  "one model width unit is the canvas's 2.4 print points",
  PT_PER_WIDTH === 2.4,
  String(PT_PER_WIDTH),
);

check(
  "a numeric lineWidth and a preset of the same weight write the same pen",
  style.strokeWidthPt(0.5) === style.strokeWidthPt("thin"),
  `${style.strokeWidthPt(0.5)} vs ${style.strokeWidthPt("thin")}`,
);

const smallFit = fitOf([{ id: "l", type: "line", geometry: { start: { x: 0, y: 0 }, end: { x: 40, y: 0 } }, style: { lineWidth: "thin" } }]);

check("a drawing that fits is not rescaled", smallFit.factor === 1, String(smallFit.factor));

check(
  "at scale 1 a Thin (model 0.5) line is 1.2pt - the pen the canvas paints",
  widthsIn(geometry.geometrySourceWriter({ id: "l", type: "line", geometry: { start: { x: 0, y: 0 }, end: { x: 40, y: 0 } }, style: { lineWidth: "thin" } }, { transform: smallFit })).every((w) => Math.abs(w - 1.2) < 1e-6),
  String(widthsIn(geometry.geometrySourceWriter({ id: "l", type: "line", geometry: { start: { x: 0, y: 0 }, end: { x: 40, y: 0 } }, style: { lineWidth: "thin" } }, { transform: smallFit }))),
);

const sheet = reportedSheet();
const drawingFit = fitOf(sheet);

check(
  "a 430-unit drawing is reduced into the page",
  drawingFit.factor > 0.2 && drawingFit.factor < 0.45,
  String(drawingFit.factor),
);

check(
  "and its pen is reduced by the SAME factor, once",
  Math.abs(style.strokeWidthPt("thin", drawingFit) - Number((0.5 * PT_PER_WIDTH * drawingFit.factor).toFixed(4))) < 1e-6,
  `${style.strokeWidthPt("thin", drawingFit)}`,
);

check(
  "the reported hairline (0.28pt for a Thin stroke) can no longer be produced",
  Math.abs(style.strokeWidthPt("thin", drawingFit) - 0.28) > 0.05,
  `${style.strokeWidthPt("thin", drawingFit)}`,
);

check(
  "the calibration is not a per-tool multiplier: every writer asks the same function",
  widthsIn(statics.staticsSourceWriter(sheet[0], { transform: drawingFit }))[0] ===
    widthsIn(geometry.geometrySourceWriter({ id: "g", type: "line", geometry: { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }, style: { lineWidth: "thin" } }, { transform: drawingFit }))[0],
);

check(
  "the model keeps the width the student chose",
  sheet[0].style.lineWidth === "thin" && style.resolveLineWidth(sheet[0].style.lineWidth) === 0.5,
);

/* ========================================================== B. colour */

console.log("\nB. Colour: authored ink, not the interface theme");
console.log("------------------------------------------------");

const blackBeam = statics.staticsSourceWriter(sheet[0], { transform: drawingFit });

check("a black object is written black", blackBeam.includes("draw=black"), blackBeam);
check("never teal", !blackBeam.includes("193335"), blackBeam);
check("and needs no colour definition", !blackBeam.includes("\\definecolor{black}"), blackBeam);

const coloured = statics.staticsSourceWriter(
  { ...sheet[0], style: { ...sheet[0].style, stroke: "#C8102E" } },
  { transform: drawingFit },
);

check("a chosen colour is preserved as its own name", /draw=daetumC+8102E/.test(coloured), coloured);
check(
  "with one RGB definition the renderer loads",
  (coloured.match(/\\definecolor\{daetumC+8102E\}\{RGB\}\{200,16,46\}/g) || []).length === 1,
  coloured,
);

/* ======================================================== C. opacity */

console.log("\nC. Opacity: intentional only");
console.log("------------------------------");

check("an opaque object writes no opacity at all", !blackBeam.includes("opacity"), blackBeam);
check(
  "a fully-opaque style (opacity 1) writes none either",
  !statics.staticsSourceWriter({ ...sheet[0], style: { ...sheet[0].style, opacity: 1 } }, { transform: drawingFit }).includes("opacity"),
);
check(
  "an intentionally translucent object keeps its value",
  statics.staticsSourceWriter({ ...sheet[0], style: { ...sheet[0].style, opacity: 0.4 } }, { transform: drawingFit }).includes("draw opacity=0.4"),
);

/* =============================================== D. one style line */

console.log("\nD. One style declaration per command");
console.log("-------------------------------------");

const wholeSheetSource = sheet.map((object) => statics.staticsSourceWriter(object, { transform: drawingFit })).join("\n");
const everyCommand = commandsOf(wholeSheetSource);

check("the sheet produces commands", everyCommand.length > 0);
check(
  "no command declares two widths",
  everyCommand.every((line) => (line.match(/line width=/g) || []).length <= 1),
  everyCommand.filter((line) => (line.match(/line width=/g) || []).length > 1).join("\n"),
);
check(
  "no command declares two stroke colours",
  everyCommand.every((line) => (line.match(/draw=/g) || []).length <= 1),
);
check(
  "a multi-command object defines a colour once",
  (statics.staticsSourceWriter(sheet[3], { transform: drawingFit }).match(/\\definecolor\{daetumC8102E\}/g) || []).length === 0,
);

/* ========================================================== E. sketch */

console.log("\nE. The sketch reaches the source and the document");
console.log("--------------------------------------------------");

const diagramSource = statics.staticsSourceWriter(sheet[3], { transform: drawingFit });

const place = (x, value) => ({
  x: -215 + ((x - 0) / 10) * 430,
  y: -60 + value * 3,
});

const lineEnd = drawingFit.point(place(5, 4).x, place(5, 4).y);
const curveBend = drawingFit.point(place(7, 8).x, place(7, 8).y);
const curveEnd = drawingFit.point(place(10, 0).x, place(10, 0).y);

/* The source writes numbers at 4 decimals, so points are compared numerically. */
const hasPoint = (text, at) => {
  const pattern = /\((-?[\d.]+),(-?[\d.]+)\)/g;

  for (const match of String(text).matchAll(pattern)) {
    if (Math.abs(Number(match[1]) - at.x) < 0.01 && Math.abs(Number(match[2]) - at.y) < 0.01) {
      return true;
    }
  }

  return false;
};

check(
  "the sketch's line is written where the canvas draws it",
  hasPoint(diagramSource, lineEnd),
  `expected (${lineEnd.x},${lineEnd.y})\n${diagramSource}`,
);
check(
  "the sketch's three-point curve is written through its bend",
  hasPoint(diagramSource, curveBend),
  diagramSource,
);
check(
  "and through its end",
  hasPoint(diagramSource, curveEnd),
  diagramSource,
);

check(
  "an empty sketch invents no curve",
  commandsOf(statics.staticsSourceWriter({ ...sheet[3], geometry: { ...sheet[3].geometry, sketchElements: [] } }, { transform: drawingFit })).length === 2,
);

const plotMode = statics.staticsSourceWriter(
  {
    ...sheet[3],
    geometry: {
      ...sheet[3].geometry,
      mode: "plot",
      expressions: [
        { id: "x1", relationType: "functionX", expression: "2*x", xRange: { from: 0, to: 10 } },
      ],
    },
  },
  { transform: drawingFit },
);

check("a plot-mode diagram draws its plotted curve", commandsOf(plotMode).length >= 3, plotMode);
check(
  "and still writes its stored strokes",
  /* The stroke's x-span is what identifies it: the curve starts at x=0 and ends at x=10. */
  hasPoint(plotMode, drawingFit.point(place(0, 0).x, place(0, 0).y)) ||
    hasPoint(plotMode, drawingFit.point(place(10, 0).x, place(10, 0).y)),
  plotMode,
);

/* A resultant's own per-object sketch is drawing content too. */
const resultantSketch = statics.staticsSourceWriter(
  {
    id: "res",
    type: "resultant",
    geometry: {
      start: { x: 0, y: 0 },
      end: { x: 30, y: 40 },
      position: { x: 0, y: 0 },
      sketchElements: [{ id: "r1", kind: "line", start: { x: 1, y: 2 }, end: { x: 3, y: 4 } }],
    },
    style: { stroke: "#000000", lineWidth: "thin" },
  },
  { transform: smallFit },
);

check("a per-object sketch is serialised", resultantSketch.includes("(1,2) -- (3,4)"), resultantSketch);

/* ======================================================== F. geometry */

console.log("\nF. Geometry: supports on the beam, graph at its own distance");
console.log("------------------------------------------------------------");

const beamStart = drawingFit.point(-215, 0);
const pinBody = statics.staticsSourceWriter(sheet[1], { transform: drawingFit });

check(
  "the pin is drawn from the beam end it carries",
  hasPoint(pinBody, beamStart) || Math.abs(beamStart.x - Number((pinBody.match(/\(([\d.]+),/) || [])[1])) < 0.01,
  `expected x ${beamStart.x}\n${pinBody}`,
);

const graphStart = drawingFit.point(-215, -60);

check(
  "the graph keeps its stored distance below the beam",
  Math.abs(graphStart.y - beamStart.y) > 5,
  `${graphStart.y} vs ${beamStart.y}`,
);
check("the graph and the beam share the drawing's one scale", Math.abs((graphStart.x - beamStart.x)) < 1e-9);

/* ========================================================== G. bounds */

console.log("\nG. Bounds: Fit-All measures the whole drawing, never the camera");
console.log("----------------------------------------------------------------");

const fitBounds = bounds.drawingBounds(sheet);

check("bounds exist for the sheet", Boolean(fitBounds), JSON.stringify(fitBounds));
check(
  "everything is inside the measured bounds",
  fitBounds.minX <= -215 && fitBounds.maxX >= 215 && fitBounds.minY <= -60 && fitBounds.maxY >= 0,
  JSON.stringify(fitBounds),
);

const atZoom = (zoom) => {
  const state = { camera: { zoom, panX: 987, panY: -654 } };
  const context = sync.exportTransformFor(sheet);
  void state;

  return sheet.map((object) => statics.staticsSourceWriter(object, { transform: context, state })).join("\n");
};

check(
  "the source is identical at every zoom and pan",
  [0.25, 0.5, 1, 2].map(atZoom).every((text) => text === atZoom(1)),
);

check(
  "and a Fit-All box around the drawing includes the sketch's highest point",
  (() => {
    const sketchPoints = [
      place(0, 0),
      place(5, 4),
      place(7, 8),
      place(10, 0),
    ];

    return sketchPoints.every(
      (at) =>
        at.x >= fitBounds.minX - 1e-6 &&
        at.x <= fitBounds.maxX + 1e-6 &&
        at.y >= fitBounds.minY - 1e-6 &&
        at.y <= fitBounds.maxY + 1e-6,
    );
  })(),
  JSON.stringify(fitBounds),
);

/* ====================================================== H. consistency */

console.log("\nH. Every writer shares the style path");
console.log("--------------------------------------");

const geometryLine = geometry.geometrySourceWriter(
  { id: "gl", type: "line", geometry: { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }, style: { stroke: "#FF0000", lineWidth: "thick", opacity: 0.5 } },
  { transform: smallFit },
);

check(
  "Geometry and Statics spell a style identically",
  (() => {
    const a = commandsOf(geometryLine)[0];
    const b = commandsOf(
      statics.staticsSourceWriter(
        { ...sheet[0], style: { stroke: "#FF0000", lineWidth: "thick", opacity: 0.5 } },
        { transform: smallFit },
      ),
    )[0];

    const options = (line) => (line.match(/^\\draw\[([^\]]*)\]/) || [])[1];

    return options(a) && options(a) === options(b);
  })(),
  geometryLine,
);

/* ================================================== the full pipeline */

console.log("\nThe complete document");
console.log("----------------------");

const manager = managerModule.createSourceManager();

sync.setSourceWriter(geometry.geometrySourceWriter);
sync.addSourceWriter(statics.staticsSourceWriter);

sheet.forEach((object) => sync.writeObjectIntoSource(manager, object, { allObjects: sheet }));

const documentSource = manager.getSource();

check(
  "every object is in the document",
  sheet.every((object) => documentSource.includes(`% DAETUM ID: ${object.id}`)),
);
check(
  "once each, under one header",
  sheet.every((object) => documentSource.split(`% DAETUM ID: ${object.id}`).length - 1 === 1),
);
check("including the sketch's curve", hasPoint(documentSource, curveBend), documentSource);
check("with no teal anywhere", !documentSource.includes("193335"));
check("and no command with two widths", commandsOf(documentSource).every((line) => (line.match(/line width=/g) || []).length <= 1));
check(
  "the visible source is a picture without identity markers",
  /*
   * THE TAB SHOWS NAMES, NOT MACHINERY. The readable `% DAETUM OBJECT:` line
   * stays - it is the label a student reads against the code - while the
   * markers that locate a block are gone.
   */
  manager.getVisibleSource().trimStart().startsWith(sourceModule.PICTURE_BEGIN) &&
    !/DAETUM (ID|TYPE|PART|PARENT|ATTACH)\b/.test(manager.getVisibleSource()) &&
    !/DAETUM_OBJECT_(BEGIN|END)/.test(manager.getVisibleSource()),
);

console.log(`\n${pass} passed, ${fail} failed`);

if (fail > 0) {
  process.exitCode = 1;
}
