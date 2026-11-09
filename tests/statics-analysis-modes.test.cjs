/* eslint-disable no-console */
/*
 * ========================================================
 * SKETCH / PLOT IN STATICS → ANALYSIS
 * ========================================================
 *
 * The three diagram tools - SFD, BMD, AFD - are ONE tool with two creation
 * approaches. This suite holds the shared behaviour that makes that true, so a
 * later section can adopt the pattern without re-deriving it:
 *
 *   the mode is recorded in the one order that works
 *   the active mode is visible on the toolbar and in the Features panel
 *   switching mode abandons the placement, never the diagram
 *   the tool stays armed after a placement, in the same mode
 *   a placement click is always an input, so empty canvas does not exit
 *   a Sketch's strokes are ordinary features belonging to the diagram
 *   a legacy sketch is converted on open, not discarded
 *   Resultant and Force Components have no mode, and are not given one
 *
 * It drives the real modules, so a rule that is only written in a comment
 * fails here rather than in a report.
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

/*
 * THE ELEMENTS THE APPLICATION EXPECTS.
 *
 * Arming a tool writes its instruction into the status line and redraws the
 * tool list, so those have to exist. A missing one fails as a null dereference
 * inside the toolbar rather than as a wrong result, which is a misleading way
 * to fail.
 */
[
  "drawingProperties",
  "drawingToolMessage",
  "drawingCoordinates",
  "drawingZoomValue",
  "drawingToolHeading",
  "drawingToolList",
  "drawingFeaturesBack",
].forEach((id) => {
  const element = dom.window.document.createElement("div");

  element.id = id;
  dom.window.document.body.appendChild(element);
});

/* The canvas is found by class, so it is added the way the shell adds it. */
const canvas = dom.window.document.createElement("div");

canvas.className = "drawing-canvas";
dom.window.document.body.appendChild(canvas);

const { loadModule } = require("./helpers/source-path.cjs");

const model = loadModule("drawing-state.js").default;
const { drawingState } = loadModule("editor-state.js");
const analysis = loadModule("analysis-tools.js");
const sketch = loadModule("analysis-sketch.js");
const features = loadModule("features-editor.js");
const classification = loadModule("tool-classification.js");
const creationDrag = loadModule("creation-drag.js");
const commit = loadModule("creation-commit.js");

const message = () =>
  dom.window.document.getElementById("drawingToolMessage")?.textContent ?? "";

/* ============================================================ fixture */

function addBeam() {
  const before = model.snapshotDrawing(drawingState);

  const beam = model.geometryFactories.beam(
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { style: { stroke: "#000000", lineWidth: 0.5 } },
  );

  model.addObject(drawingState, beam);
  model.commitDrawingChange(drawingState, before);

  return beam;
}

const beam = addBeam();

/* ====================================================== the mode table */

console.log("\nWhich tools have modes");
console.log("----------------------");

check(
  "the three diagrams are the tools with Sketch and Plot",
  Object.keys(analysis.ANALYSIS_DIAGRAM_TOOLS).sort().join(",") ===
    "axial-force-diagram,bending-moment-diagram,shear-force-diagram",
  JSON.stringify(Object.keys(analysis.ANALYSIS_DIAGRAM_TOOLS)),
);

check(
  "and there are exactly two modes",
  analysis.ANALYSIS_DIAGRAM_MODES.join(",") === "sketch,plot",
  JSON.stringify(analysis.ANALYSIS_DIAGRAM_MODES),
);

check(
  "Resultant is not a diagram tool",
  !Object.prototype.hasOwnProperty.call(
    analysis.ANALYSIS_DIAGRAM_TOOLS,
    "resultant",
  ),
);

check(
  "Force Components is not a diagram tool",
  !Object.prototype.hasOwnProperty.call(
    analysis.ANALYSIS_DIAGRAM_TOOLS,
    "force-components",
  ),
);

check(
  "Resultant and Force Components keep their input-selection workflow",
  analysis.isAnalysisInputTool("resultant") &&
    analysis.isAnalysisInputTool("force-components"),
);

/* ==================================================== arming a mode */

console.log("\nArming a diagram in a mode");
console.log("---------------------------");

const armed = analysis.armAnalysisDiagram("shear-force-diagram", "plot");

check("arming a Plot succeeds", armed === true);
check(
  "the tool is armed",
  drawingState.activeTool === "shear-force-diagram",
  drawingState.activeTool,
);
check(
  "the mode is on the interaction, where the placement reads it",
  drawingState.interaction.analysisMode === "plot",
  drawingState.interaction.analysisMode,
);
check(
  "the placement is in its first stage, waiting for the member",
  drawingState.interaction.phase === "analysis-axis" &&
    !drawingState.interaction.sourceId,
  `${drawingState.interaction.phase} / ${drawingState.interaction.sourceId}`,
);
check(
  "and nothing was created by arming",
  drawingState.objects.filter((object) => object.type === "analysis-diagram")
    .length === 0,
);

check(
  "the active mode is reported for the toolbar",
  analysis.activeAnalysisMode() === "plot",
  analysis.activeAnalysisMode(),
);

check(
  "and the status line asks for the member, not for a mode",
  /beam|member|Select/i.test(message()),
  message(),
);

check(
  "a mode that is not one of the two is refused",
  analysis.armAnalysisDiagram("shear-force-diagram", "auto") === false,
);

check(
  "and a tool that is not a diagram is refused",
  analysis.armAnalysisDiagram("resultant", "sketch") === false,
);

/* ================================================ switching the mode */

console.log("\nSwitching Sketch to Plot");
console.log("------------------------");

/*
 * The student has already named the member - the placement is in its SECOND
 * stage. Switching mode must not commit that placement, and must not leave it
 * half-built in the old mode.
 */
drawingState.interaction.sourceId = beam.id;
drawingState.interaction.placementY = -40;
drawingState.interaction.analysisPlacement = {
  start: { x: 0, y: -40 },
  end: { x: 100, y: -40 },
  diagramType: "sfd",
};

analysis.armAnalysisDiagram("shear-force-diagram", "sketch");

check(
  "switching does not create a diagram",
  drawingState.objects.filter((object) => object.type === "analysis-diagram")
    .length === 0,
  String(
    drawingState.objects.filter((object) => object.type === "analysis-diagram")
      .length,
  ),
);

check(
  "the new mode is the one recorded",
  drawingState.interaction.analysisMode === "sketch",
  drawingState.interaction.analysisMode,
);

check(
  "the abandoned placement's preview is gone",
  drawingState.interaction.analysisPlacement === null,
  JSON.stringify(drawingState.interaction.analysisPlacement),
);

check(
  "and the placement starts again from the member",
  !drawingState.interaction.sourceId,
  String(drawingState.interaction.sourceId),
);

check(
  "the tool is still armed, not toggled off",
  drawingState.activeTool === "shear-force-diagram",
  drawingState.activeTool,
);

/* ================================================== committing a mode */

console.log("\nCommitting each mode");
console.log("--------------------");

function placeDiagram(mode, kind = "shear-force-diagram") {
  const before = new Set(drawingState.objects.map((object) => object.id));

  analysis.armAnalysisDiagram(kind, mode);

  drawingState.interaction.sourceId = beam.id;
  drawingState.interaction.placementY = -40;

  const committed = analysis.commitAnalysisAxis();

  /*
   * THE DIAGRAM THIS CALL MADE, not the first one on the sheet. Asking for
   * "the" analysis diagram would return the sketch every time and quietly
   * test the wrong object.
   */
  const object = drawingState.objects.find(
    (candidate) =>
      candidate.type === "analysis-diagram" && !before.has(candidate.id),
  );

  return { committed, object };
}

const sketchDiagram = placeDiagram("sketch");

check(
  "a Sketch commits",
  sketchDiagram.committed === true && Boolean(sketchDiagram.object),
);
check(
  "and records its mode on the feature",
  sketchDiagram.object?.geometry.mode === "sketch",
  sketchDiagram.object?.geometry.mode,
);
check(
  "with no expressions - a sketch is drawn, not plotted",
  !Array.isArray(sketchDiagram.object?.geometry.expressions) ||
    sketchDiagram.object.geometry.expressions.length === 0,
  JSON.stringify(sketchDiagram.object?.geometry.expressions),
);
check(
  "and the source relationship is recorded",
  sketchDiagram.object?.engineering?.sourceFeatureIds?.includes(beam.id),
  JSON.stringify(sketchDiagram.object?.engineering?.sourceFeatureIds),
);
check(
  "the new diagram is selected",
  drawingState.selection.selectedObjectIds.includes(sketchDiagram.object?.id),
  JSON.stringify(drawingState.selection.selectedObjectIds),
);
check(
  "and the tool stays armed, in the same mode",
  drawingState.activeTool === "shear-force-diagram" &&
    analysis.activeAnalysisMode() === "sketch",
  `${drawingState.activeTool} / ${analysis.activeAnalysisMode()}`,
);

const plotDiagram = placeDiagram("plot");

check(
  "a Plot commits",
  plotDiagram.committed === true && Boolean(plotDiagram.object),
);
check(
  "and records its mode on the feature",
  plotDiagram.object?.geometry.mode === "plot",
  plotDiagram.object?.geometry.mode,
);
check(
  "seeded with one expression spanning the body",
  Array.isArray(plotDiagram.object?.geometry.expressions) &&
    plotDiagram.object.geometry.expressions.length === 1 &&
    plotDiagram.object.geometry.expressions[0].relationType === "functionX",
  JSON.stringify(plotDiagram.object?.geometry.expressions),
);
check(
  "whose range is the body's own length",
  plotDiagram.object?.geometry.localRange?.from === 0 &&
    plotDiagram.object?.geometry.localRange?.to === 100,
  JSON.stringify(plotDiagram.object?.geometry.localRange),
);
check(
  "the plot is a separate feature from the sketch",
  plotDiagram.object?.id !== sketchDiagram.object?.id,
);

check(
  "the sketch kept its own mode and its own geometry",
  drawingState.objects.find((object) => object.id === sketchDiagram.object.id)
    ?.geometry.mode === "sketch",
);

/* ============================================ the placement owns clicks */

console.log("\nA placement click is always an input");
console.log("-------------------------------------");

check(
  "a diagram tool does not exit on a bare click",
  classification.shouldExitToSelectOnClick("shear-force-diagram") === false,
);

check(
  "nor does the bending-moment or axial tool",
  classification.shouldExitToSelectOnClick("bending-moment-diagram") ===
    false &&
    classification.shouldExitToSelectOnClick("axial-force-diagram") === false,
);

check(
  "a diagram is not a drag-creation tool",
  creationDrag.isDragCreationTool("shear-force-diagram") === false,
);

/* ============================================ the sketch model */

console.log("\nA sketch is drawn in the Sketch Editor");
console.log("----------------------------------------");

check(
  "a Line, a Polyline and an Arc are the stroke types",
  sketch.SKETCH_STROKE_TYPES.join(",") === "line,polyline,arc",
  JSON.stringify(sketch.SKETCH_STROKE_TYPES),
);

check(
  "a Rectangle is not a stroke - it cannot express a graph",
  sketch.isSketchStrokeType("rectangle") === false,
);

/*
 * A STROKE IS NO LONGER ADOPTED FROM THE SHEET.
 *
 * The Sketch Editor is the one place a sketch is drawn, and it commits its own
 * features on Apply. A stroke drawn with the ordinary Line tool while a diagram
 * is selected must therefore stay an ordinary line - two ways to add ink to a
 * diagram is exactly what the editor replaces.
 */
model.selectObject(drawingState, sketchDiagram.object.id);

const stroke = model.geometryFactories.line(
  { x: 0, y: -40 },
  { x: 50, y: -20 },
  { style: { stroke: "#000000", lineWidth: 0.5 } },
);

commit.commitCreatedFeature(stroke);

check(
  "a line drawn on the sheet does not join a selected diagram",
  stroke.parentId !== sketchDiagram.object.id && !sketch.isSketchStroke(stroke),
  String(stroke.parentId),
);

check(
  "so the diagram's sketch is still empty",
  sketch.sketchHasContent(sketchDiagram.object) === false,
);

check(
  "and the line keeps its own geometry, so its handles still work",
  stroke.geometry.start.x === 0 && stroke.geometry.end.x === 50,
  JSON.stringify(stroke.geometry),
);

/* ================================================ the Features panel */

console.log("\nThe Features panel states the mode");
console.log("-----------------------------------");

const sketchMarkup = features.featuresMarkupForSelection([
  sketchDiagram.object,
]);

check(
  "the diagram's mode is stated",
  sketchMarkup.includes('data-analysis-mode-row="sketch"'),
  sketchMarkup.slice(0, 600),
);

check(
  "and offers the Sketch Editor",
  /data-analysis-editor="sketch"/.test(sketchMarkup),
  sketchMarkup.slice(0, 900),
);

const plotMarkup = features.featuresMarkupForSelection([plotDiagram.object]);

check(
  "a plot states Plot",
  plotMarkup.includes('data-analysis-mode-row="plot"'),
  plotMarkup.slice(0, 600),
);

check(
  "and offers the Plot Editor",
  /data-analysis-editor="plot"/.test(plotMarkup),
  plotMarkup.slice(0, 900),
);

/* ==================================================== legacy migration */

console.log("\nA legacy sketch is converted, not lost");
console.log("---------------------------------------");

const legacy = model.geometryFactories["shear-force-diagram"](
  { x: 0, y: -80 },
  { x: 100, y: -80 },
  { style: { stroke: "#000000", lineWidth: 0.5 } },
);

legacy.geometry.localRange = { from: 0, to: 100 };
legacy.geometry.unitHeight = 1;
legacy.geometry.sketchElements = [
  { id: "old-1", kind: "line", start: { x: 0, y: 0 }, end: { x: 50, y: 20 } },
  {
    id: "old-2",
    kind: "curve",
    points: [
      { x: 50, y: 20 },
      { x: 75, y: 30 },
      { x: 100, y: 0 },
    ],
  },
];

model.addObject(drawingState, legacy);

const converted = sketch.migrateLegacySketch(legacy, drawingState);

check(
  "the legacy strokes become features",
  converted.length === 2,
  String(converted.length),
);

check(
  "a two-point element becomes a Line",
  converted[0]?.type === "line",
  converted[0]?.type,
);

check(
  "a longer element becomes a Polyline",
  converted[1]?.type === "polyline",
  converted[1]?.type,
);

check(
  "each belongs to the diagram",
  converted.every((entry) => entry.parentId === legacy.id),
);

check(
  "and is marked as a sketch stroke",
  converted.every((entry) => sketch.isSketchStroke(entry)),
);

check(
  "the old store is removed, so nothing reads it twice",
  legacy.geometry.sketchElements === undefined,
  JSON.stringify(legacy.geometry.sketchElements),
);

check(
  "the converted stroke lands where the student saw it",
  converted[0]?.geometry.start.x === 0 &&
    converted[0]?.geometry.start.y === -80 &&
    converted[0]?.geometry.end.x === 50 &&
    converted[0]?.geometry.end.y === -60,
  JSON.stringify(converted[0]?.geometry),
);

check(
  "converting again is a no-op",
  sketch.migrateLegacySketch(legacy, drawingState).length === 0,
);

/* ==================================================== Escape / cancel */

console.log("\nEscape abandons the placement");
console.log("------------------------------");

analysis.armAnalysisDiagram("bending-moment-diagram", "plot");

const beforeCancel = drawingState.objects.length;

model.clearInteraction(drawingState);
model.setActiveTool(drawingState, "select");

check(
  "cancelling creates nothing",
  drawingState.objects.length === beforeCancel,
  `${beforeCancel} -> ${drawingState.objects.length}`,
);

check(
  "and the completed diagrams are untouched",
  drawingState.objects.filter((object) => object.type === "analysis-diagram")
    .length === 3,
  String(
    drawingState.objects.filter((object) => object.type === "analysis-diagram")
      .length,
  ),
);

check(
  "the mode is no longer reported once the tool is not armed",
  analysis.activeAnalysisMode() === null,
  String(analysis.activeAnalysisMode()),
);

/* ==================================================== undo / redo */

console.log("\nUndo and redo");
console.log("--------------");

/*
 * UNDO IS CHECKED AGAINST A COMMITTED CHANGE.
 *
 * The migration above added its strokes without a history entry of its own -
 * it is part of opening a file, not an edit the student made - so the last
 * recorded change is the stray stroke. Undoing it must remove exactly that
 * stroke and nothing else.
 */
const countBeforeUndo = drawingState.objects.length;

model.undo(drawingState);

check(
  "undo removes the last committed change",
  drawingState.objects.length < countBeforeUndo,
  `${countBeforeUndo} -> ${drawingState.objects.length}`,
);

model.redo(drawingState);

check(
  "redo puts it back",
  drawingState.objects.length === countBeforeUndo,
  `${countBeforeUndo} -> ${drawingState.objects.length}`,
);

check(
  "with the plot's mode intact",
  drawingState.objects.find((object) => object.id === plotDiagram.object.id)
    ?.geometry.mode === "plot",
);

console.log(`\n${pass} passed, ${fail} failed`);

if (fail > 0) {
  process.exitCode = 1;
}
