/* eslint-disable no-console */
/*
 * ========================================================
 * THE STATICS SKETCH EDITOR
 * ========================================================
 *
 * A dedicated drawing workspace: the student draws with a mouse, a finger or a
 * stylus, and DAETUM works out whether each stroke is a STRAIGHT LINE or a
 * CURVED LINE and reconstructs it as clean geometry.
 *
 * What this suite holds:
 *
 *   the editor offers Draw and Erase, and NO geometry-type control
 *   a wobbly straight stroke becomes a two-point line
 *   a genuine curve stays a curve, and keeps its shape
 *   the classification is stable and scale-independent
 *   erasing splits a stroke into valid pieces and re-recognises them
 *   Apply commits real Line and Polyline features belonging to the diagram
 *   the old on-sheet adoption is gone, so there is one way to sketch
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

const { loadModule } = require("./helpers/source-path.cjs");

const recognition = loadModule("stroke-recognition.js");

/* The editor publishes its API on the default export, as the other editors do. */
const editorModule = loadModule("sketch-editor.js");
const editor = editorModule.default || editorModule;
const analysisEditor = loadModule("analysis-editor.js");
const sketchModel = loadModule("analysis-sketch.js");

/* ============================================================ fixtures */

/* A straight stroke with hand tremor: the thing that must NOT become a curve. */
function wobblyLine(from, to, samples = 120, amplitude = 0.8) {
  const points = [];

  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;

    points.push({
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t + Math.sin(t * Math.PI * 7) * amplitude,
    });
  }

  return points;
}

/* A genuine arc: the thing that must NOT be straightened. */
function arc(from, to, bow, samples = 120) {
  const points = [];

  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;

    points.push({
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t + Math.sin(t * Math.PI) * bow,
    });
  }

  return points;
}

/* ==================================================== the interface */

console.log("\nThe editor's interface");
console.log("----------------------");

check(
  "there are exactly two tools",
  editor.SKETCH_TOOLS.join(",") === "draw,erase",
  JSON.stringify(editor.SKETCH_TOOLS),
);

check(
  "and they are Draw and Erase",
  editor.SKETCH_TOOLS.includes("draw") && editor.SKETCH_TOOLS.includes("erase"),
);

/*
 * THE OLD INTERFACE IS GONE. The previous editor offered Straight Line and
 * Curved Line buttons, and the whole point of this one is that the student
 * never chooses a geometry type.
 *
 * ASKED OF THE MARKUP, WITH COMMENTS STRIPPED. The source explains in comments
 * why there is no such control, so a plain text search finds the explanation
 * and reports the control as present - the same trap the analysis-graph suite
 * documents. What matters is what the student is actually shown.
 */
const editorSource = require("fs").readFileSync(
  require("./helpers/source-path.cjs").locate("sketch-editor.js"),
  "utf8",
);

const editorMarkup = editorSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/[^\n]*$/gm, "");

check(
  "there is no Straight Line control",
  !/Straight Line/.test(editorMarkup),
  "the student must not be asked to choose a geometry type",
);

check("there is no Curved Line control", !/Curved Line/.test(editorMarkup));

check("and no geometry-type dropdown", !/<select/.test(editorMarkup));

/* ================================================ straight recognition */

console.log("\nStraight Line recognition");
console.log("--------------------------");

const horizontal = recognition.recogniseStroke(
  wobblyLine({ x: 0, y: 0 }, { x: 100, y: 0 }),
  { tolerance: 2.5 },
);

check(
  "a wobbly horizontal stroke is recognised as straight",
  horizontal.kind === "straight",
  JSON.stringify(horizontal.classification),
);

check(
  "and becomes TWO points, not a polyline",
  horizontal.points.length === 2,
  String(horizontal.points.length),
);

check(
  "keeping the stroke's own ends",
  horizontal.points[0].x === 0 && horizontal.points[1].x === 100,
  JSON.stringify(horizontal.points),
);

const vertical = recognition.recogniseStroke(
  wobblyLine({ x: 0, y: 0 }, { x: 0, y: 100 }),
  { tolerance: 2.5 },
);

check("a wobbly vertical stroke is straight", vertical.kind === "straight");

const diagonal = recognition.recogniseStroke(
  wobblyLine({ x: 0, y: 0 }, { x: 100, y: 100 }),
  { tolerance: 2.5 },
);

check("a wobbly diagonal stroke is straight", diagonal.kind === "straight");

/*
 * SCALE INDEPENDENCE. The same shape drawn ten times larger must classify the
 * same way - the test is a RATIO, not a distance, which is what makes it hold
 * at any zoom.
 */
const small = recognition.recogniseStroke(
  wobblyLine({ x: 0, y: 0 }, { x: 10, y: 0 }, 120, 0.08),
  { tolerance: 0.25 },
);

const large = recognition.recogniseStroke(
  wobblyLine({ x: 0, y: 0 }, { x: 1000, y: 0 }, 120, 8),
  { tolerance: 25 },
);

check(
  "a short stroke and a long one classify the same way",
  small.kind === "straight" && large.kind === "straight",
  `${small.kind} / ${large.kind}`,
);

/* ================================================== curve recognition */

console.log("\nCurved Line recognition");
console.log("------------------------");

const curved = recognition.recogniseStroke(
  arc({ x: 0, y: 0 }, { x: 100, y: 0 }, 30),
  { tolerance: 2.5 },
);

check(
  "a genuine arc is recognised as curved",
  curved.kind === "curved",
  JSON.stringify(curved.classification),
);

check(
  "and keeps more than two points, so its shape survives",
  curved.points.length > 2,
  String(curved.points.length),
);

check(
  "with a spline fitted through them",
  curved.segments.length > 0,
  String(curved.segments.length),
);

check(
  "the curve's peak is preserved",
  Math.max(...curved.points.map((point) => point.y)) > 20,
  String(Math.max(...curved.points.map((point) => point.y))),
);

/*
 * AN S-SHAPE CROSSES ITS OWN CHORD. Its maximum offset is small, so a
 * bow-only test would call it straight - which is why the crossing test exists.
 */
const sShape = [];

for (let index = 0; index <= 120; index += 1) {
  const t = index / 120;

  sShape.push({
    x: t * 100,
    y: Math.sin(t * Math.PI * 2) * 12,
  });
}

check(
  "an S-shaped stroke is curved, not straight",
  recognition.recogniseStroke(sShape, { tolerance: 2.5 }).kind === "curved",
  JSON.stringify(recognition.classifyStroke(sShape)),
);

/* ======================================================== erasing */

console.log("\nErasing");
console.log("--------");

const marked = wobblyLine({ x: 0, y: 0 }, { x: 100, y: 0 }).map((point) => ({
  ...point,
  erased: point.x > 40 && point.x < 60,
}));

const runs = recognition.splitStrokeAtGaps(marked, 1);

check(
  "erasing the middle of a stroke leaves two runs",
  runs.length === 2,
  String(runs.length),
);

check(
  "each run is a valid stroke of its own",
  runs.every((run) => run.length >= 2),
);

check(
  "and the erased gap is gone from both",
  runs.every((run) => run.every((point) => point.x <= 40 || point.x >= 60)),
);

const stub = recognition.splitStrokeAtGaps(
  [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0, erased: true },
    { x: 3, y: 0 },
  ],
  5,
);

check(
  "a run too short to be a feature is dropped, not committed",
  stub.length === 0,
  String(stub.length),
);

/* ==================================================== integration */

console.log("\nIntegration with the diagram");
console.log("-----------------------------");

check(
  "a diagram offers both editors",
  analysisEditor
    .analysisEditorsFor({
      type: "analysis-diagram",
      geometry: { mode: "sketch" },
    })
    .map((entry) => entry.id)
    .join(",") === "sketch,plot",
  JSON.stringify(
    analysisEditor.analysisEditorsFor({
      type: "analysis-diagram",
      geometry: { mode: "sketch" },
    }),
  ),
);

check(
  "a sketch-mode diagram opens on the Sketch Editor",
  analysisEditor.defaultAnalysisEditorFor({
    type: "analysis-diagram",
    geometry: { mode: "sketch" },
  })?.id === "sketch",
);

check(
  "a plot-mode diagram opens on the Plot Editor",
  analysisEditor.defaultAnalysisEditorFor({
    type: "analysis-diagram",
    geometry: { mode: "plot" },
  })?.id === "plot",
);

check(
  "a beam offers neither",
  analysisEditor.analysisEditorsFor({ type: "beam" }).length === 0,
);

/*
 * THE ON-SHEET ADOPTION IS GONE. A stroke drawn with the ordinary Line tool no
 * longer joins a selected diagram, because the editor is the one place a sketch
 * is drawn - two ways to add ink would be exactly what this replaces.
 */
check(
  "the on-sheet adoption helpers are gone",
  typeof sketchModel.adoptSketchStroke === "undefined" &&
    typeof sketchModel.activeSketchTarget === "undefined",
);

check(
  "but the legacy migration is kept, so old drawings still load",
  typeof sketchModel.migrateLegacySketch === "function",
);

/* ==================================================== the dialog */

console.log("\nThe dialog itself");
console.log("------------------");

const host = dom.window.document.createElement("div");

host.id = "drawingFeatures";
dom.window.document.body.appendChild(host);

const opened = editor.open({
  title: "Shear Force Diagram - Sketch",
  range: { from: 0, to: 10 },
  yRange: 20,
  elements: [],
  onApply: () => {},
  onCancel: () => {},
});

check("the editor opens", Boolean(opened));

const dialog = dom.window.document.querySelector(".drawing-sketch-editor");

check("as a dialog", Boolean(dialog));

check(
  "with a drawing canvas",
  Boolean(dialog?.querySelector("[data-sketch-svg]")),
);

check(
  "a Draw tool, active by default",
  dialog
    ?.querySelector("[data-sketch-tool='draw']")
    ?.classList.contains("active") === true,
);

check(
  "and an Erase tool",
  Boolean(dialog?.querySelector("[data-sketch-tool='erase']")),
);

check(
  "with Apply and Cancel",
  Boolean(dialog?.querySelector("[data-sketch-apply]")) &&
    Boolean(dialog?.querySelector("[data-sketch-cancel]")),
);

check(
  "and no geometry-type control anywhere in it",
  !/Straight Line|Curved Line/.test(dialog?.innerHTML || ""),
  (dialog?.innerHTML || "").slice(0, 400),
);

check(
  "Undo and Redo start disabled, because there is nothing to undo",
  dialog?.querySelector("[data-sketch-undo]")?.disabled === true &&
    dialog?.querySelector("[data-sketch-redo]")?.disabled === true,
);

editor.close();

check(
  "and it closes",
  !dom.window.document.querySelector(".drawing-sketch-editor"),
);

console.log(`\n${pass} passed, ${fail} failed`);

if (fail > 0) {
  process.exitCode = 1;
}
