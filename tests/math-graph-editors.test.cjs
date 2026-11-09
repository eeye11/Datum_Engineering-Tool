/* eslint-disable no-console */
/*
 * ========================================================
 * THE GRAPH EDITORS
 * ========================================================
 *
 * Graph -> Sketch opens the Sketch Editor; Graph -> Plot opens the Plot
 * Editor. Both are dedicated working spaces, both commit ONE Graph object, and
 * both must actually draw their preview - an editor that opens onto an empty
 * box is the same failure as a graph that renders nothing.
 *
 * This suite drives the real toolbar and the real editors.
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

[
  "drawingProperties",
  "drawingToolMessage",
  "drawingCoordinates",
  "drawingZoomValue",
  "drawingToolHeading",
  "drawingToolList",
  "drawingFeaturesBack",
  "drawingFeatures",
].forEach((id) => {
  const element = dom.window.document.createElement("div");

  element.id = id;
  dom.window.document.body.appendChild(element);
});

const canvas = dom.window.document.createElement("div");

canvas.className = "drawing-canvas";
dom.window.document.body.appendChild(canvas);

const categoryButton = dom.window.document.createElement("button");

categoryButton.className = "drawing-category active";
categoryButton.dataset.category = "MATH / ANALYSIS";
dom.window.document.body.appendChild(categoryButton);

const { loadModule } = require("./helpers/source-path.cjs");

const { renderEngineeringTools } = loadModule("toolbar-render.js");
const { drawingState } = loadModule("editor-state.js");
const mathModel = loadModule("math-model.js").default;
const mathTools = loadModule("math-tools.js").default;
const placementSession = loadModule("placement-session.js");

const click = (element) =>
  element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

function openMode(mode) {
  renderEngineeringTools("MATH / ANALYSIS");

  const list = dom.window.document.getElementById("drawingToolList");

  click(list.querySelector('[data-tool-id="math-plot"]'));

  const popup = dom.window.document.querySelector(
    ".drawing-coordinate-submenu",
  );

  click(popup.querySelector(`[data-submenu-id="${mode}"]`));

  return dom.window.document.querySelector(".drawing-plot-editor");
}

function reset() {
  drawingState.objects = [];
  drawingState.selection.selectedObjectIds = [];
  drawingState.interaction = { phase: "idle" };
  drawingState.activeTool = "select";

  dom.window.document
    .querySelectorAll(".drawing-plot-editor")
    .forEach((node) => node.remove());
}

/* ====================================================== naming */

console.log("\nThe tool and its modes");
console.log("----------------------");

check(
  "the tool is called Graph",
  mathTools.MATH_TOOL_GROUPS[1].tools.some((tool) => tool.label === "Graph"),
);

check(
  "and its modes are Sketch and Plot",
  mathTools.MATH_MODE_LABELS.sketch === "Sketch" &&
    mathTools.MATH_MODE_LABELS.plot === "Plot",
  JSON.stringify(mathTools.MATH_MODE_LABELS),
);

check(
  "there is no Expression mode",
  !Object.values(mathTools.MATH_MODE_LABELS).includes("Expression"),
);

/* ====================================================== plot editor */

console.log("\nGraph -> Plot opens the Plot Editor");
console.log("-----------------------------------");

reset();

const plotEditor = openMode("plot");

check("the Plot Editor opens", Boolean(plotEditor));

check(
  "and it is titled for the graph",
  plotEditor?.querySelector(".plot-editor-title")?.textContent.trim() ===
    "Graph - Plot",
);

check(
  "it has a graph preview",
  Boolean(plotEditor?.querySelector("[data-graph-preview]")),
);

check(
  "and the preview draws the axes and grid",
  plotEditor.querySelector("[data-graph-preview]").querySelectorAll("*")
    .length > 20,
  String(
    plotEditor.querySelector("[data-graph-preview]").querySelectorAll("*")
      .length,
  ),
);

check(
  "it has the coordinate settings",
  plotEditor.querySelectorAll("[data-graph-field]").length >= 8,
  String(plotEditor.querySelectorAll("[data-graph-field]").length),
);

check(
  "and an expression list with an Add button",
  Boolean(plotEditor.querySelector("[data-graph-list]")) &&
    Boolean(plotEditor.querySelector("[data-graph-add]")),
);

check(
  "and Apply and Cancel",
  Boolean(plotEditor.querySelector("[data-graph-apply]")) &&
    Boolean(plotEditor.querySelector("[data-graph-cancel]")),
);

/* Adding an expression draws a curve. */
const beforeAdd = plotEditor
  .querySelector("[data-graph-preview]")
  .querySelectorAll("path").length;

click(plotEditor.querySelector("[data-graph-add]"));

const afterAdd = plotEditor
  .querySelector("[data-graph-preview]")
  .querySelectorAll("path").length;

check(
  "adding an expression draws its curve",
  afterAdd > beforeAdd,
  `${beforeAdd} -> ${afterAdd}`,
);

/*
 * APPLY ENTERS PLACEMENT - IT DOES NOT COMMIT.
 *
 * The graph is finished, but its POSITION is still the student's to choose, so
 * Apply returns to the page with the graph following the cursor and the click
 * is what commits it. Committing on Apply would put the graph wherever it
 * happened to be drawn.
 */
click(plotEditor.querySelector("[data-graph-apply]"));

check(
  "Apply commits nothing yet",
  drawingState.objects.length === 0,
  String(drawingState.objects.length),
);

check(
  "and the editor closes",
  !dom.window.document.querySelector(".drawing-plot-editor"),
);

check(
  "and a placement is pending",
  placementSession.placementPending(),
);

/* The click on the page is the placement. */
placementSession.movePlacement({ x: 100, y: 100 });

check(
  "the placement previews the graph",
  Boolean(drawingState.interaction.preview?.placement),
);

placementSession.commitPlacement({ x: 100, y: 100 });

check("the click commits one graph", drawingState.objects.length === 1);

check(
  "and it is a math-plot",
  drawingState.objects[0]?.type === "math-plot",
  drawingState.objects[0]?.type,
);

check(
  "with the expression the editor held",
  mathModel.plotFunctions(drawingState.objects[0]).length === 1,
  String(mathModel.plotFunctions(drawingState.objects[0]).length),
);

check(
  "and the placement is finished",
  !placementSession.placementPending(),
);

/* ====================================================== cancel */

console.log("\nCancel discards");
console.log("---------------");

reset();

const cancelEditor = openMode("plot");

click(cancelEditor.querySelector("[data-graph-add]"));
click(cancelEditor.querySelector("[data-graph-cancel]"));

check("Cancel commits nothing", drawingState.objects.length === 0);

check(
  "and closes the editor",
  !dom.window.document.querySelector(".drawing-plot-editor"),
);

/* ====================================================== sketch editor */

console.log("\nGraph -> Sketch opens the Sketch Editor");
console.log("---------------------------------------");

reset();

const sketchEditor = openMode("sketch");

check("the Sketch Editor opens", Boolean(sketchEditor));

check(
  "and it is titled for the graph",
  sketchEditor?.querySelector(".sketch-app-title")?.textContent.trim() ===
    "Graph - Sketch",
);

check(
  "it has Draw, Point and Erase",
  Boolean(sketchEditor.querySelector('[data-sketch-tool-draw]')) &&
    Boolean(sketchEditor.querySelector('[data-sketch-tool-point]')) &&
    Boolean(sketchEditor.querySelector('[data-sketch-tool-erase]')),
);

check(
  "and Undo and Redo",
  Boolean(sketchEditor.querySelector("[data-sketch-undo]")) &&
    Boolean(sketchEditor.querySelector("[data-sketch-redo]")),
);

check(
  "and Apply and Cancel",
  Boolean(sketchEditor.querySelector("[data-sketch-apply]")) &&
    Boolean(sketchEditor.querySelector("[data-sketch-cancel]")),
);

check(
  "and a drawing surface",
  Boolean(sketchEditor.querySelector("[data-sketch-svg]")),
);

/*
 * THE REDESIGNED SHELL.
 *
 * The old editor had a tall tools sidebar, a fixed-size preview and no point
 * control at all. The replacement is a compact icon toolbar, a canvas that
 * fills the stage, a collapsible inspector and a view selector - so a check for
 * "the editor opened" no longer says anything about the interface.
 */
check(
  "the canvas is the dominant element, inside a stage and not a fixed box",
  Boolean(sketchEditor.querySelector(".sketch-stage [data-sketch-svg]")) &&
    !/viewBox="0 0 900/.test(sketchEditor.innerHTML),
);

check(
  "the inspector holds the point editor and the sketch settings",
  Boolean(sketchEditor.querySelector("[data-sketch-inspector] [data-sketch-points]")) &&
    Boolean(sketchEditor.querySelector("[data-sketch-inspector] [data-sketch-field=\"xMin\"]")) &&
    Boolean(sketchEditor.querySelector("[data-sketch-inspector] [data-sketch-toggle-setting=\"snap\"]")),
);

check(
  "and the view selector offers Original, Corrected and Overlay",
  ["original", "corrected", "overlay"].every((view) =>
    Boolean(sketchEditor.querySelector(`[data-sketch-view="${view}"]`)),
  ),
);

check(
  "with Corrected chosen by default, so the result is visible at once",
  sketchEditor.querySelector('[data-sketch-view="corrected"]').classList.contains("active"),
);

check(
  "and the correction settings are present",
  Boolean(sketchEditor.querySelector("[data-sketch-strength]")) &&
    Boolean(sketchEditor.querySelector('[data-sketch-toggle-setting="straighten"]')),
);

check(
  "with no Straight Line or Curved Line choice",
  !/Straight Line|Curved Line/.test(sketchEditor.innerHTML),
);

check(
  "Apply with nothing drawn is refused",
  (() => {
    click(sketchEditor.querySelector("[data-sketch-apply]"));

    return drawingState.objects.length === 0;
  })(),
);

/* ====================================================== editing */

console.log("\nEditing an existing graph");
console.log("-------------------------");

reset();

const existing = mathModel.createMathPlot({ x: 0, y: 0 }, 200, 200, {
  style: { stroke: "#000000", lineWidth: 0.5 },
  mode: "plot",
  functions: [mathModel.createPlotFunction({ expression: "x^2" })],
});

drawingState.objects = [existing];

const editEditor = mathTools.openGraphEditor("plot", existing);

check("a Plot-created graph reopens in the Plot Editor", Boolean(editEditor));

check(
  "with its expression",
  editEditor.querySelector("[data-graph-expression]")?.value === "x^2",
  editEditor.querySelector("[data-graph-expression]")?.value,
);

check(
  "and its coordinate range",
  editEditor.querySelector('[data-graph-field="xMin"]')?.value === "-5",
  editEditor.querySelector('[data-graph-field="xMin"]')?.value,
);

click(editEditor.querySelector("[data-graph-apply]"));

check("Apply keeps the same object", drawingState.objects.length === 1);

check("and the same id", drawingState.objects[0].id === existing.id);

check(
  "and its expression survives",
  mathModel.plotFunctions(drawingState.objects[0])[0].expression === "x^2",
);

/* ====================================================== summary */

console.log(`\n${pass} passed, ${fail} failed`);

if (fail > 0) {
  process.exitCode = 1;
}
