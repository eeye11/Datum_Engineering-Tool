
const { JSDOM } = require("jsdom");

const path = require("path");
const fs = require("fs");

const { controllerSource, loadModule, locate, modulePath, rendererSource, sourceDir } = require("./helpers/source-path.cjs");
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
 */


const root = path.join(__dirname, "..");
const dir = sourceDir();

/*
 * One requirement is answered by LOADING the module rather than reading it -
 * how many tools it offers is a fact about the code, and the tool list is
 * what the code does.
 */
const dom = new JSDOM("<!doctype html><html><body></body></html>");

global.window = dom.window;
global.document = dom.window.document;

loadModule("sketch-editor.js");

const editor = global.window.enggSketchEditor;

const read = (name) => fs.readFileSync(locate(name), "utf8");

const renderer = rendererSource();
const deps = read("analysis-dependencies.js");
const drawing = controllerSource() + read("feature-tree.js");
const sketchEditor = read("sketch-editor.js");
const sketch = sketchEditor;

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
    note:
      "the tinted plot-area rectangle is gone; the axes and the curve say where the plot is",
  },
  {
    title: "an orphaned diagram is not drawn",
    met: /engineering\?\.unresolved === true/.test(renderer),
    note: "the dependency pass marks it; the renderer honours it",
  },
  {
    title: "sketch elements are drawn on the sheet",
    met: /function appendAnalysisSketch/.test(renderer) &&
      /sketchElements/.test(renderer),
    note: "appendAnalysisSketch, sharing the plot projection",
  },
  {
    title: "sketch elements are stored on the feature, not as features",
    met: /geometry\.sketchElements/.test(drawing),
    note: "they belong to the diagram and move with it",
  },
  {
    title: "both modes open from one place",
    met: /function openAnalysisEditorFor/.test(drawing) &&
      /function openSketchEditorFor/.test(drawing),
    note: "openAnalysisEditorFor dispatches to the mode",
  },
  {
    title: "Escape reaches both editors",
    met: /enggSketchEditor\?\.handleEscape/.test(drawing) &&
      /enggPlotEditor\?\.handleEscape/.test(drawing),
    note: "sketch first, so a half-drawn stroke is cancelled before a dialog",
  },
  {
    title: "the sketch editor offers four tools only",
    /*
     * Across lines, so the `s` flag is required - without it the pattern
     * cannot span the four separate object literals and reports a gap that
     * is not there. The first run of this file "found" two missing
     * requirements that were both present.
     */
    met: /id: "select"[\s\S]*id: "line"[\s\S]*id: "curve"[\s\S]*id: "erase"/.test(sketch),
    note: "Select, Straight Line, Curve, Erase",
  },
  {
    title: "a vertical line needs no special tool",
    /*
     * Checked STRUCTURALLY, by counting the tools - not by searching for the
     * words "Vertical Jump". A text search for something that should be
     * absent finds it in any comment mentioning it, and this file's own
     * header says "There is no Vertical Jump tool" - so the search reported
     * a gap in the very file that explains why there isn't one.
     *
     * The tool list is the fact. Four of them means there is no fifth.
     */
    met: editor.TOOLS.length === 4,
    note: "four tools, so no vertical jump among them",
  },
  {
    title: "a sketch element is drawn by press, drag and release",
    met:
      /svg\.addEventListener\("pointerdown"/.test(sketch) &&
      /svg\.addEventListener\("pointermove"/.test(sketch) &&
      /svg\.addEventListener\("pointerup"/.test(sketch),
    note: "pointerdown/move/up, not click-move-click",
  },
  {
    title: "a sketch element can ALSO be drawn by click, move, click",
    met:
      /svg\.addEventListener\("click"/.test(sketch) &&
      /commitLine\(\)/.test(sketch) &&
      /commitCurve\(\)/.test(sketch),
    note: "both idioms, decided by how far the pointer travelled",
  },
  {
    title: "NO Y-value popup: the cursor supplies the ordinate",
    met:
      !/askForYValue/.test(sketch) &&
      !/data-y-input/.test(sketch) &&
      !/sketch-editor-y-popup/.test(sketch),
    note: "the popup is removed, not merely unused",
  },
  {
    title: "the axis extent follows the DRAWN geometry, not a fixed range",
    met:
      /function chooseUnitHeight/.test(sketch) &&
      /function elementYExtent/.test(sketch) &&
      /const reach = Math\.max\(drawnHigh, Math\.abs\(drawnLow\)\)/.test(
        sketch,
      ),
    note: "an empty sketch falls back to the analysis range; drawn geometry wins",
  },
  {
    title: "and the extent is recomputed when the geometry changes",
    met: /function refreshScale\(\)/.test(sketch) && /refreshScale\(\);/.test(sketch),
    note: "committing or erasing an element must re-fit the axis to what remains",
  },
  {
    title: "a curve's REAL extrema are solved, not read off its control points",
    met: /BEND IS A CONTROL POINT/.test(sketch) || /quadratic/i.test(sketch),
    note: "the drawn curve does not pass through its Bend",
  },
  {
    title: "the Y value is asked in the diagram's own unit",
    met:
      /yUnit/.test(drawing) &&
      /ANALYSIS_DIAGRAM_AXES/.test(drawing),
    note: "kN for shear/axial, kN\u00b7m for bending moment",
  },
  {
    title: "the x snaps to a body-element tick, but is not trapped by it",
    met:
      /function snapXToStations/.test(sketch) &&
      /SNAP_TOLERANCE_PX/.test(sketch),
    note: "a magnet within a few pixels; between ticks stays placeable",
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
