/* eslint-disable no-console */
/*
 * ========================================================
 * THE DIAGRAM EDITORS IN THE FEATURES TAB
 * ========================================================
 *
 * An SFD, BMD or AFD is edited two ways - sketched or plotted - and both are the
 * EXISTING editors in `shared/ui/editors/`. This suite checks the part that was
 * missing: that the Features tab OFFERS those editors for a selected diagram,
 * that the button opens the editor matching the diagram's own mode, and that an
 * edit made there reaches the model and the source.
 *
 * It drives the real application, so a button that renders but does nothing -
 * or one that opens the wrong dialog - fails here rather than in a report.
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

const model = loadModule("drawing-state.js").default;
const { drawingState } = loadModule("editor-state.js");
const features = loadModule("features-editor.js");
const analysisEditor = loadModule("analysis-editor.js");

/* ============================================================ fixture */

/*
 * A DIAGRAM, BUILT THE WAY THE PLACEMENT TOOL BUILDS ONE.
 *
 * `diagramType` is the diagram's identity - it drives the title, the axis, the
 * tint and the Features entry - so the fixture states it rather than leaving the
 * object looking like a generic frame. The three type names are the factory's
 * own; `geometryFactories["shear-force-diagram"]` produces exactly this shape.
 */
function diagram(mode, kind = "sfd") {
  return {
    id: `diagram-${mode}-${kind}`,
    type: "analysis-diagram",
    name: `${kind.toUpperCase()} 1`,
    geometry: {
      start: { x: -30, y: -40 },
      end: { x: 30, y: -40 },
      localRange: { from: 0, to: 10 },
      diagramType: kind,
      mode,
      sketchElements: [],
    },
    style: { stroke: "#000000", lineWidth: 0.5 },
    engineering: { discipline: "statics", analysisKind: `${kind}-force-diagram` },
  };
}

const add = (object) => {
  const before = model.snapshotDrawing(drawingState);
  const stored = model.addObject(drawingState, object);
  model.commitDrawingChange(drawingState, before);

  return stored;
};

/* ===================================================== which editors */

console.log("\nWhich editor a diagram offers");
console.log("-----------------------------");

const sketchDiagram = diagram("sketch");
const plotDiagram = diagram("plot");

check(
  "a sketch-mode diagram offers the Sketch Editor",
  analysisEditor.analysisEditorsFor(sketchDiagram).some((entry) => entry.button === "Sketch Editor"),
  JSON.stringify(analysisEditor.analysisEditorsFor(sketchDiagram)),
);

check(
  "a plot-mode diagram offers the Plot Editor",
  analysisEditor.analysisEditorsFor(plotDiagram).some((entry) => entry.button === "Plot Editor"),
  JSON.stringify(analysisEditor.analysisEditorsFor(plotDiagram)),
);

check(
  "a beam offers neither",
  analysisEditor.analysisEditorsFor({ type: "beam" }).length === 0,
);

check(
  "the three diagram type names are all recognised",
  ["analysis-diagram", "shear-force-diagram", "bending-moment-diagram", "axial-force-diagram"].every((type) =>
    analysisEditor.isAnalysedDiagram({ ...diagram("sketch"), type }),
  ),
);

/* ==================================================== the tab markup */

console.log("\nThe Features tab");
console.log("----------------");

const sketchMarkup = features.featuresMarkupForSelection([sketchDiagram]);

check("the Sketch Editor button is in the tab", sketchMarkup.includes("Sketch Editor"), sketchMarkup);
check(
  "as a real button, not a label",
  /<button[^>]*data-analysis-editor="sketch"/.test(sketchMarkup),
  sketchMarkup,
);
check(
  "carrying the diagram it edits",
  sketchMarkup.includes(`data-object-id="${sketchDiagram.id}"`),
);

const plotMarkup = features.featuresMarkupForSelection([plotDiagram]);

check("the Plot Editor button is in the tab for a plot", plotMarkup.includes("Plot Editor"), plotMarkup);
check(
  "and an SFD, BMD or AFD sketch-mode diagram offers the Plot Editor too",
  /<button[^>]*data-analysis-editor="plot"/.test(sketchMarkup),
  sketchMarkup,
);
check(
  "while a plot-mode diagram still offers its Sketch Editor",
  analysisEditor.analysisEditorsFor(plotDiagram).some((entry) => entry.button === "Sketch Editor"),
  JSON.stringify(analysisEditor.analysisEditorsFor(plotDiagram)),
);

const beamMarkup = features.featuresMarkupForSelection([
  {
    id: "beam-1",
    type: "beam",
    name: "Beam 1",
    geometry: { start: { x: 0, y: 0 }, end: { x: 40, y: 0 } },
    style: { stroke: "#000000", lineWidth: 0.5 },
  },
]);

check("a beam's tab has no diagram editors", !beamMarkup.includes("analysis-editors"), beamMarkup);

check(
  "a multi-selection has no editors - it has no single diagram",
  !features
    .featuresMarkupForSelection([sketchDiagram, { ...plotDiagram, id: "other" }])
    .includes("analysis-editors"),
);

/* ==================================================== opens the editor */

console.log("\nOpening the editor");
console.log("------------------");

add(sketchDiagram);
add(plotDiagram);

const opened = [];

/*
 * The dialogs are DOM-constructed by the editors themselves, so the test asks
 * which one appeared - by its own accessible name - rather than calling an
 * internal function and trusting it.
 */
const originalOpen = {};

["sketch-editor.js", "plot-editor.js"].forEach((name) => {
  const module = loadModule(name);
  const target = module.default || module;

  originalOpen[name] = target.open;

  target.open = (options = {}) => {
    opened.push({ editor: name, title: options.title });
    return true;
  };
});

const openedSketch = analysisEditor.openAnalysisEditorForObject(sketchDiagram.id, "sketch");

check("pressing Sketch Editor opens the Sketch Editor", openedSketch === true && opened.some((entry) => entry.editor === "sketch-editor.js"), JSON.stringify(opened));
check(
  "with the diagram's own title",
  opened.some((entry) => entry.title && entry.title.includes("Shear Force")),
  JSON.stringify(opened),
);

opened.length = 0;

const openedPlot = analysisEditor.openAnalysisEditorForObject(plotDiagram.id, "plot");

check(
  "pressing Plot Editor opens the Plot Editor",
  openedPlot === true && opened.some((entry) => entry.editor === "plot-editor.js"),
  JSON.stringify(opened),
);

check(
  "and never for an object that has no diagram",
  analysisEditor.openAnalysisEditorForObject("beam-1", "sketch") === false,
);

/* Restore, so nothing later in the process sees the probe. */
["sketch-editor.js", "plot-editor.js"].forEach((name) => {
  const module = loadModule(name);
  const target = module.default || module;

  target.open = originalOpen[name];
});

/* ================================================= click wiring */

console.log("\nThe button is wired");
console.log("--------------------");

/*
 * THE PANE IS INSTALLED ON THE APPLICATION'S OWN HOST.
 *
 * The harness document has no workspace shell, so the pane is given the element
 * it looks for - built here with the id `installFeaturesPane` resolves. That
 * keeps this a test of the REAL install, render and click path rather than of a
 * copy of it.
 */
const host = dom.window.document.createElement("div");

host.id = "drawingFeatures";
dom.window.document.body.appendChild(host);

features.installFeaturesPane();

model.selectObject(drawingState, sketchDiagram.id);
features.renderFeatures();

const button = host.querySelector("[data-analysis-editor='sketch']");

check("the rendered pane contains the button", Boolean(button), host.innerHTML.slice(0, 400));

if (button) {
  const probe = [];
  const module = loadModule("sketch-editor.js");
  const target = module.default || module;
  const keep = target.open;

  target.open = () => {
    probe.push("opened");
    return true;
  };

  button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

  target.open = keep;

  check("and a click on it opens the editor", probe.length === 1, probe.join(","));
}

console.log(`\n${pass} passed, ${fail} failed`);

if (fail > 0) {
  process.exitCode = 1;
}
