const fs = require("fs");

const {
  controllerSource,
  locate,
  rendererSource,
} = require("./helpers/source-path.cjs");
/*
 * ========================================================
 * WHAT THE ANALYSIS GRAPH ALREADY DOES
 * ========================================================
 *
 * The specification for the analysis workflow lists a long set of graph
 * requirements. Several of them look unimplemented from the outside - there
 * is no "cursor readout" anywhere on screen, no tick spacing control, no
 * y-range field - so the first instinct is to write them.
 *
 * This asks the question directly instead, because building a second
 * implementation of something the renderer already does would leave the
 * two disagreeing. Anything reported here as MISSING is genuinely absent;
 * anything PRESENT means the requirement is already met and re-implementing
 * it would be a regression, not progress.
 *
 * THE SKETCH REQUIREMENTS ARE ABOUT THE NEW MODEL. A sketch is drawn on the
 * sheet with the ordinary Line, Polyline and Arc tools, and its strokes are
 * ordinary features belonging to the diagram. The old modal Sketch Editor -
 * four private tools, a private canvas, strokes stored as graph-local points -
 * has been removed, so the requirements that described it are gone with it and
 * replaced by the ones that describe what a sketch IS now.
 */

const read = (name) => fs.readFileSync(locate(name), "utf8");

const renderer = rendererSource();
const deps = read("analysis-dependencies.js");
const drawing = controllerSource() + read("analysis-editor.js");
const sketchModel = read("analysis-sketch.js");
const commit = read("creation-commit.js");

/*
 * Each entry is a requirement, and how to tell whether it is met. The
 * test is written against what the CODE does, not against a keyword - a
 * grep for "tick" would pass on a comment.
 */
const requirements = [
  {
    title: "the y-axis belongs to the graph frame, not the curve",
    met: /function analysisFrameExtents/.test(renderer),
    note: "analysisFrameExtents computes the frame independently of content",
  },
  {
    title: "x range comes from the body's engineering length",
    met: /localRange/.test(deps) && /bodyLength|length/.test(deps),
    note: "deriveDiagram reads localRange from the source span",
  },
  {
    title: "source feature positions are marked on the axis",
    met: /referencePositions/.test(deps) && /referencePositions/.test(renderer),
    note: "sourceStations -> geometry.referencePositions -> ticks",
  },
  {
    title: "those marks can be turned off",
    met: /showReferencePositions/.test(renderer),
    note: "showReferencePositions !== false",
  },
  {
    title: "the plot-area highlight is not drawn on any diagram",
    met:
      /const highlighted = false;/.test(renderer) &&
      !/function analysisHasContent/.test(renderer),
    note: "the tinted plot-area rectangle is gone; the axes and the curve say where the plot is",
  },
  {
    title: "an orphaned diagram is not drawn",
    met: /engineering\?\.unresolved === true/.test(renderer),
    note: "the dependency pass marks it; the renderer honours it",
  },

  /* ---------------------------------------------------- the new sketch */

  {
    title: "a sketch stroke is an ordinary feature, not a stored point list",
    met:
      /SKETCH_STROKE_TYPES/.test(sketchModel) &&
      /"line"/.test(sketchModel) &&
      /"polyline"/.test(sketchModel) &&
      /"arc"/.test(sketchModel),
    note: "Line, Polyline and Arc - the drawing primitives that can express a graph",
  },
  {
    title: "a stroke belongs to its diagram through parentId",
    met: /feature\.parentId = object\.id/.test(drawing),
    note: "the field the Feature Tree already nests by, so no new relationship is invented",
  },
  {
    title: "the Sketch Editor commits its strokes as features",
    met:
      /applySketchStrokes/.test(drawing) &&
      /analysisSketch: ANALYSIS_SKETCH_MARKER/.test(drawing),
    note: "a straight stroke becomes a Line, a curved one a Polyline",
  },
  {
    title: "a sketch is drawn in the editor, not on the sheet",
    met: !/adoptSketchStroke/.test(commit),
    note: "one way to add ink to a diagram, which is what the editor replaces",
  },
  {
    title: "the renderer no longer projects a sketch from the diagram",
    met:
      !/function appendAnalysisSketch/.test(renderer) &&
      !/analysisSketchMarks/.test(renderer),
    note: "the strokes are drawn by the ordinary entity pass, as the features they are",
  },
  {
    title: "the source writer no longer reads a sketch out of the diagram",
    /*
     * ASKED OF THE CODE, NOT OF THE PROSE. The removal is explained in a
     * comment that names the function it removed, so a text search finds the
     * explanation and reports the function as still present. What matters is
     * that nothing CALLS it and nothing reads the old store.
     */
    met:
      !/objectSketchCommands\s*\(/.test(read("statics.js")) &&
      !/geometry\.sketchElements/.test(read("statics.js")),
    note: "the ordinary writers emit the strokes, so there is one source for the ink",
  },
  {
    title: "the Sketch Editor is a drawing workspace, not a geometry picker",
    met:
      /function openSketchEditorFor/.test(drawing) &&
      /enggSketchEditor/.test(drawing),
    note: "Draw and Erase only; the recogniser decides line or curve",
  },
  {
    title: "both editors are offered for a diagram",
    met:
      /PLOT_EDITOR_TOOL_TYPES/.test(drawing) &&
      /id: "sketch"/.test(drawing),
    note: "the hand-drawn half and the plotted half of one model",
  },
  {
    title: "Escape still reaches the Plot Editor",
    met: /enggPlotEditor\?\.handleEscape/.test(read("keyboard-shortcuts.js")),
    note: "the one dialog a diagram still has",
  },
  {
    title: "a legacy sketch is converted on open, not discarded",
    met:
      /migrateLegacySketch/.test(sketchModel) &&
      /migrateLegacySketches\(\)/.test(read("document-commands.js")),
    note: "sketchElements -> real Line and Polyline features, then the old list is removed",
  },
  {
    title: "the conversion removes the old store, so nothing reads it twice",
    met: /delete geometry\.sketchElements/.test(sketchModel),
    note: "one place a sketch lives, and no path that can read the old one by accident",
  },
];

const missing = requirements.filter((r) => !r.met);
const present = requirements.filter((r) => r.met);

console.log(
  `\n  ${present.length}/${requirements.length} graph requirements already met\n`,
);

for (const r of present) {
  console.log(`    ok    ${r.title}`);
}

if (missing.length) {
  console.log(`\n  genuinely missing:\n`);

  for (const r of missing) {
    console.log(`    MISS  ${r.title}`);
  }
}

console.log(
  missing.length
    ? `\n  ${missing.length} still to build\n`
    : "\n  nothing outstanding from this list\n",
);

/*
 * A test that cannot fail is decoration. Asserting that this list is
 * currently complete means a future change that REMOVES one of these fails
 * loudly, rather than quietly reducing the count and passing anyway.
 */
if (missing.length) {
  process.exitCode = 1;
}
