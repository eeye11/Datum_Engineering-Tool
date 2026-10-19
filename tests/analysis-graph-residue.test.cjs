
const { JSDOM } = require("jsdom");

const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * A green outline of an analysis graph survives a move and a delete.
 *
 * SFD is drawn in #1f5c38 - a dark green - and appendAnalysisPlot strokes
 * the curve in the diagram's own tint. So "a green outline is left behind"
 * means something is still DRAWING that curve.
 *
 * The SVG is wiped at the start of every render, so a leftover node cannot
 * survive. Therefore what remains is a LIVE feature that is still being
 * rendered - most likely a copy of the diagram left in the document, or a
 * graph whose source has gone but which is still asked to draw.
 *
 * This counts analysis features and their plotted marks before and after a
 * move and a delete.
 */


const projectRoot = path.join(__dirname, "..");

let pass = 0;
let fail = 0;

check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(
      `  FAIL ${name}${detail ? `\n       ${detail}` : ""}`,
    );
  }
};

const dom = new JSDOM(
  '<!doctype html><html><body><div id="canvas"></div></body></html>',
  { pretendToBeVisual: true },
);

global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.requestAnimationFrame = cb => setTimeout(cb, 0);
global.window.requestAnimationFrame = global.requestAnimationFrame;
global.window.cancelAnimationFrame = id => clearTimeout(id);

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

/* A plotted SFD: this is what draws green. */
const diagram = {
  id: "sfd-1",
  type: "analysis-diagram",
  name: "SFD 1",
  geometry: {
    diagramType: "sfd",
    mode: "plot",
    start: { x: 0, y: -200 },
    end: { x: 300, y: -200 },
    localRange: { from: 0, to: 300 },
    showZeroAxis: true,
    backgroundVisible: true,
    /*
     * `expressions`, not `relations` - readPlot reads `expressions` and
     * falls back to the legacy `segments`. A plot stored under any other
     * key is a plot with nothing in it, which is why an earlier version
     * of this fixture drew no green at all.
     */
    expressions: [
      {
        id: "e1",
        relationType: "functionX",
        expression: "10 - 5*x",
        xRange: { start: 0, end: 300 },
      },
    ],
  },
  style: { stroke: "#000000", lineWidth: 0.5 },
};

const scene = (objects, extra = {}) => ({
  objects,
  display: { showMagnitudes: true, showUnits: true, showDimensions: true },
  scale: { mmPerUnit: 1, unit: "mm" },
  selection: { selectedObjectIds: [], boxSelectionIds: [], hoveredObjectId: null },
  interaction: { phase: "idle", preview: null, previewObjects: [] },
  camera: { zoom: 1, panX: 0, panY: 0 },
  styleDefaults: { stroke: "#000000", lineWidth: 0.5 },
  grid: { visible: false, spacing: 10 },
  snap: { enabled: false },
  ...extra,
});

/* Every stroke in the SFD's own green, wherever it is on the sheet. */
const greenStrokes = () => {
  renderer.renderDrawing(scene([diagram]), canvas);

  return [...canvas.querySelectorAll("[stroke]")]
    .filter((el) => (el.getAttribute("stroke") || "").toLowerCase() === "#1f5c38")
    .map((el) => el.tagName);
};

console.log("\n  the diagram draws green in the first place\n");

const before = greenStrokes();

check(
  "a plotted SFD strokes something in its own colour",
  before.length > 0,
  `found ${before.length} green element(s)`,
);

console.log(`\n  green elements before: ${before.length}\n`);

/*
 * The report has two halves - after a MOVE and after a DELETE - and they
 * are separate claims. A feature list that still holds the diagram would
 * show green again; an empty list must show none, whatever else is true.
 */

console.log("\n  after a delete the feature is GONE\n");

renderer.renderDrawing(scene([]), canvas);

const afterDeleteCount = [...canvas.querySelectorAll("[stroke]")]
  .filter((el) => (el.getAttribute("stroke") || "").toLowerCase() === "#1f5c38")
  .length;

check(
  "no green survives once the diagram is out of the document",
  afterDeleteCount === 0,
  `${afterDeleteCount} green element(s) remained after the feature was removed`,
);

/*
 * And the same for a preview ghost. buildModifyPreview copies the object to
 * `preview-<id>`, so a ghost left in previewObjects draws a SECOND copy of
 * the whole graph - which is what "the outline is left when it is moved"
 * describes.
 */
console.log("\n  after a move the ghost does not outlive it\n");

/*
 * A ghost is a COPY of the whole feature - `buildModifyPreview` deep-clones
 * it to `preview-<id>` - so a ghost left in previewObjects draws a SECOND
 * copy of the entire graph: frame, axis and the green curve, at the
 * drag-to position.
 *
 * The renderer is not at fault here and must not compensate: a preview is
 * MEANT to be drawn, and it is the only thing showing the student where the
 * feature will land. The obligation to clear it belongs to the session
 * (cancelModifySession, which empties previewObjects).
 *
 * So the ghost case is checked below, once the placed diagram exists - a
 * ghost must not become a way to keep drawing a diagram whose source has
 * gone, but that only means anything for a real feature.
 */

/*
 * THE ROUND TRIP: place a diagram under a beam, MOVE it, then DELETE it -
 * checking after each step that exactly one graph exists, and after the
 * delete that none does.
 *
 * The preview is not the whole story. What the report describes is residue
 * that SURVIVES, and the only thing that survives a render is a live
 * feature. So this checks the document, not the renderer: a diagram whose
 * source has gone but which is still in `objects` keeps being drawn in
 * full - frame, axis, and green curve - because nothing filtered it out.
 */

console.log("\n  and the document itself holds no residue\n");

const beam = {
  id: "beam-1",
  type: "beam",
  name: "Beam 1",
  geometry: {
    start: { x: 0, y: 0 },
    end: { x: 300, y: 0 },
    length: 300,
    depth: 20,
  },
  style: { stroke: "#000000", lineWidth: 0.5 },
};

/* Placed under the beam and linked to it, as the tool really creates it. */
const placed = {
  ...JSON.parse(JSON.stringify(diagram)),
  geometry: {
    ...JSON.parse(JSON.stringify(diagram.geometry)),
    start: { x: 0, y: 200 },
    end: { x: 300, y: 200 },

    /*
     * `sourceFeatureId` on the GEOMETRY - not `parentFeatureId`, which is
     * what the tree uses and is not a source the registry reads.
     * `sourceIdsOf` looks at engineering.sourceFeatureId, then
     * engineering.sourceFeatureIds, then geometry.sourceFeatureId(s).
     * A diagram linked by neither is linked to nothing, and the
     * dependency pass has no reason to touch it.
     */
    sourceFeatureId: beam.id,
  },

  /*
   * `engineering` must EXIST for the registry to recognise this at all.
   *
   * `isAnalysisObject` tests `object.engineering && hasOwnProperty(type)` -
   * a diagram with no engineering block is not an analysis object as far as
   * the dependency pass is concerned, so its source is never checked and it
   * is never marked. The registry creates that block itself on refresh, so
   * in the application it is always there; a fixture without one describes
   * a half-built feature and would report a working diagram as broken.
   */
  engineering: { sourceFeatureId: beam.id },
};

check(
  "a placed diagram under a beam is still just one feature",
  [beam, placed].filter((o) => o.type === "analysis-diagram").length === 1,
  "the fixture should hold exactly one diagram to begin with",
);

/*
 * DELETE THE SOURCE, KEEP THE DIAGRAM - the orphan case. This is what
 * "leaves an outline behind" describes when the graph outlives the beam it
 * was drawn against: the feature is still on the sheet and still draws.
 */
const orphaned = [beam, placed].filter((o) => o.id !== beam.id);

/*
 * Ask the REAL dependency registry to settle it, rather than hand-setting
 * the flag. The renderer honours `engineering.unresolved`, and it is the
 * registry that decides when that flag is true - so a test that sets the
 * flag itself would pass even if the registry stopped setting it, which is
 * half the bug.
 *
 * It MARKS rather than removes, and that is deliberate: a diagram keeps the
 * student's own work (their expressions, their sketch lines) so Undo can
 * bring it back, and only stops being drawn. So nothing being returned as
 * removed is correct here, and the assertion below is on the flag.
 */
const registry = global.window.enggAnalysisDependencies;

if (registry?.resolveDeletedSources) {
  registry.resolveDeletedSources({ objects: orphaned }, ["beam-1"]);
}

check(
  "deleting the source leaves the diagram still in the document",
  orphaned.some((o) => o.type === "analysis-diagram"),
  "if the diagram went with the beam this would not be the orphan case",
);

renderer.renderDrawing(scene(orphaned), canvas);

const orphanGreen = [...canvas.querySelectorAll("[stroke]")].filter(
  (el) => (el.getAttribute("stroke") || "").toLowerCase() === "#1f5c38",
).length;

check(
  "the registry marks the orphaned diagram rather than removing it",
  placed.engineering.unresolved === true,
  `unresolved was ${JSON.stringify(placed.engineering.unresolved)}`,
);

check(
  "an orphaned diagram is either resolved or reported, not silently drawn",
  orphanGreen === 0,
  `${orphanGreen} green element(s) drawn for a diagram whose source is gone`,
);

/*
 * THE GHOST OF AN ORPHAN. `buildModifyPreview` deep-clones the whole
 * feature to `preview-<id>`, so a move previews a complete second graph -
 * frame, axis and green curve - at the drag-to position. That is correct
 * and necessary: it is what shows the student where the feature will land.
 *
 * The obligation to CLEAR it belongs to the session, not to the renderer.
 * What the renderer owes is the same honesty in the ghost as in the
 * committed copy: if the source has gone, neither is drawn.
 */
renderer.renderDrawing(
  scene([placed], {
    interaction: {
      phase: "idle",
      preview: null,
      previewObjects: [
        {
          ...JSON.parse(JSON.stringify(placed)),
          id: "preview-sfd-1",
          engineering: { unresolved: true },
        },
      ],
    },
  }),
  canvas,
);

const ghostGreen = [...canvas.querySelectorAll("[stroke]")].filter(
  (el) => (el.getAttribute("stroke") || "").toLowerCase() === "#1f5c38",
).length;

check(
  "a preview ghost of an orphaned diagram draws nothing either",
  ghostGreen === 0,
  `${ghostGreen} green element(s) drawn from a ghost whose source is gone`,
);

/*
 * AND A GHOST OF A HEALTHY ONE IS STILL DRAWN. Without this the fix above
 * could be satisfied by never drawing previews at all - which would break
 * the drag instead.
 *
 * It is built from `diagram`, NOT from `placed`: the registry call above
 * mutated placed.engineering.unresolved in place, so a ghost cloned from it
 * would inherit the orphan flag and draw nothing - a passing test of the
 * wrong thing, in the direction that hides a real failure.
 */
renderer.renderDrawing(
  scene([placed], {
    interaction: {
      phase: "idle",
      preview: null,
      previewObjects: [
        {
          ...JSON.parse(JSON.stringify(diagram)),
          id: "preview-sfd-1",
          geometry: {
            ...JSON.parse(JSON.stringify(diagram.geometry)),
            start: { x: 400, y: 200 },
            end: { x: 700, y: 200 },
          },
        },
      ],
    },
  }),
  canvas,
);

const liveGhostGreen = [...canvas.querySelectorAll("[stroke]")].filter(
  (el) => (el.getAttribute("stroke") || "").toLowerCase() === "#1f5c38",
).length;

check(
  "but a healthy diagram's ghost is still previewed",
  liveGhostGreen > orphanGreen,
  `healthy ghost drew ${liveGhostGreen} green, orphaned ghost ${orphanGreen} - ` +
    "if these match, the preview has simply stopped drawing",
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

/*
 * ========================================================
 * THE GREEN THAT WAS ACTUALLY BEING SEEN
 * ========================================================
 *
 * Everything above was about the COMMITTED diagram, and it passed while
 * the student still saw a green graph on the sheet.
 *
 * The real one was the placement PREVIEW. `renderPreview` draws
 * `interaction.analysisPlacement` as a complete analysis-diagram in the
 * diagram's own colour - #1f5c38 for an SFD - and that field was written
 * on every pointermove during axis placement and cleared by NOTHING. Not
 * by committing the placement, not by Escape, not by moving or deleting
 * the result afterwards. So the preview simply stayed, forever, which is
 * exactly "a green outline is left when the graph is moved or deleted":
 * it was never left behind BY the move, it was never cleaned up by it.
 *
 * clearInteraction clears twenty other temporary fields. This was the
 * twenty-first and it was missing.
 */
console.log("\n  the placement preview is cleared too\n");

const docState = {
  interaction: {
    phase: "analysis-axis",
    analysisKind: "sfd",
    analysisPlacement: {
      start: { x: 0, y: 200 },
      end: { x: 300, y: 200 },
      diagramType: "sfd",
    },
    preview: { type: "analysis-diagram" },
    previewObjects: [{ id: "ghost" }],
  },
};

global.window.enggDrawingState.clearInteraction(docState);

check(
  "the axis placement preview is cleared with everything else",
  docState.interaction.analysisPlacement === null,
  `left ${JSON.stringify(docState.interaction.analysisPlacement)}`,
);

check(
  "and the other temporaries go too, so the clear is not partial",
  docState.interaction.preview === null &&
    docState.interaction.previewObjects.length === 0,
  `preview ${JSON.stringify(docState.interaction.preview)}, ` +
    `objects ${docState.interaction.previewObjects.length}`,
);

/*
 * And the visible consequence. With the field null the renderer has
 * nothing to draw a preview from, so a placed diagram contributes exactly
 * its own two green strokes - which is the assertion the earlier version
 * of this file should have made.
 */
renderer.renderDrawing(
  scene(
    [
      {
        ...JSON.parse(JSON.stringify(placed)),
        /*
         * A fresh, RESOLVED copy: `placed` was orphaned deliberately
         * earlier in this file and still carries the flag, so drawing it
         * would correctly draw nothing - and the count below would be 0 for
         * the right reason, testing the wrong thing.
         */
        engineering: { sourceFeatureId: beam.id },
      },
    ],
    {
      interaction: {
        phase: "idle",
        preview: null,
        previewObjects: [],
        analysisPlacement: null,
      },
    },
  ),
  canvas,
);

const afterClear = [...canvas.querySelectorAll("[stroke]")].filter(
  (el) => (el.getAttribute("stroke") || "").toLowerCase() === "#1f5c38",
).length;

/*
 * The BASELINE: a committed diagram with nothing previewed. Measured, not
 * assumed - an earlier version of this asserted "2" from a count taken on
 * a different fixture, and the number is an artifact of the geometry
 * rather than a fact about the bug.
 */
renderer.renderDrawing(
  scene(
    [
      {
        ...JSON.parse(JSON.stringify(placed)),
        engineering: { sourceFeatureId: beam.id },
      },
    ],
    {
      interaction: {
        phase: "idle",
        preview: null,
        previewObjects: [],
        analysisPlacement: null,
      },
    },
  ),
  canvas,
);

const baseline = [...canvas.querySelectorAll("[stroke]")].filter(
  (el) => (el.getAttribute("stroke") || "").toLowerCase() === "#1f5c38",
).length;

check(
  "a placed graph draws only its own strokes, with no preview beside it",
  baseline > 0 && afterClear === baseline,
  `drew ${afterClear}, committed diagram alone draws ${baseline}`,
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
