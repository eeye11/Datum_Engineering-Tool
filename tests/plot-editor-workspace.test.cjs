/* eslint-disable no-console */
/*
 * ========================================================
 * THE PLOT EDITOR IS A GRAPH WORKSPACE
 * ========================================================
 *
 * The Plot Editor was rebuilt from a flat coordinate form into an organised
 * graph workspace: a dominant preview, a function list, and grouped settings.
 * This suite holds the new layout to its promises - and, just as importantly,
 * holds the OLD layout out.
 *
 * The assertions are on the rendered SVG and the rendered controls, because
 * "the editor opened" is exactly the check that let an empty preview through.
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

const { loadModule } = require("./helpers/source-path.cjs");

const plotEditor = loadModule("math-plot-editor.js");
const mathModel = loadModule("math-model.js").default;

const click = (element) =>
  element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

const type = (input, value) => {
  input.value = value;
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
};

/* ====================================================== the layout */

console.log("\nThe workspace layout");
console.log("---------------------");

const dialog = plotEditor.openPlotEditor(null, {
  onApply: () => {},
  onCancel: () => {},
});

const preview = dialog.querySelector("[data-graph-preview]");

check("the editor opens", Boolean(dialog));

check(
  "with a title",
  dialog.querySelector(".plot-editor-title")?.textContent.trim() ===
    "Graph - Plot",
  dialog.querySelector(".plot-editor-title")?.textContent,
);

check(
  "and a description of the task",
  Boolean(dialog.querySelector(".plot-editor-description")),
);

check(
  "and a close control",
  Boolean(dialog.querySelector(".plot-editor-close")),
);

check(
  "the preview is the stage, not a side pane",
  Boolean(dialog.querySelector(".plot-editor-stage")),
);

check(
  "the functions are their own panel",
  Boolean(dialog.querySelector("[data-graph-functions]")),
);

check(
  "and the settings are their own panel",
  Boolean(dialog.querySelector("[data-graph-settings]")),
);

check(
  "the settings are grouped, not a flat list",
  dialog.querySelectorAll(".plot-editor-group").length === 4,
  String(dialog.querySelectorAll(".plot-editor-group").length),
);

check(
  "with Range, Ticks, Display and Labels",
  [...dialog.querySelectorAll(".plot-editor-group-title")]
    .map((node) => node.textContent.trim())
    .join(",") === "Range,Ticks,Display,Labels",
  [...dialog.querySelectorAll(".plot-editor-group-title")]
    .map((node) => node.textContent.trim())
    .join(","),
);

check(
  "every required coordinate control is present",
  [
    "xMin",
    "xMax",
    "yMin",
    "yMax",
    "xTickSpacing",
    "yTickSpacing",
    "xLabel",
    "yLabel",
  ].every((key) => dialog.querySelector(`[data-graph-field="${key}"]`)),
);

check(
  "and every required display switch",
  [
    "equalUnits",
    "showXAxis",
    "showYAxis",
    "showGrid",
    "showMinorGrid",
    "showTickLabels",
  ].every((key) => dialog.querySelector(`[data-graph-toggle="${key}"]`)),
);

check(
  "the footer has Cancel and Apply",
  Boolean(dialog.querySelector("[data-graph-cancel]")) &&
    Boolean(dialog.querySelector("[data-graph-apply]")),
);

/* ================================================== the empty preview */

console.log("\nThe preview is never empty");
console.log("---------------------------");

check(
  "axes and grid draw with no functions at all",
  preview.querySelectorAll("line").length > 20,
  String(preview.querySelectorAll("line").length),
);

check(
  "and tick labels draw",
  preview.querySelectorAll("text").length > 0,
  String(preview.querySelectorAll("text").length),
);

check(
  "and the empty state says what to do",
  Boolean(dialog.querySelector(".plot-editor-empty")),
);

/* ====================================================== the functions */

console.log("\nThe functions");
console.log("--------------");

click(dialog.querySelector("[data-graph-add]"));
click(dialog.querySelector("[data-graph-add]"));

const inputs = dialog.querySelectorAll("[data-graph-expression]");

check("Add Function adds a card", inputs.length === 2, String(inputs.length));

type(inputs[0], "x^2");
type(inputs[1], "2x + 1");

check(
  "two functions draw two curves on the same graph",
  preview.querySelectorAll("path").length === 2,
  String(preview.querySelectorAll("path").length),
);

check(
  "and there is still only one graph",
  dialog.querySelectorAll("[data-graph-preview]").length === 1,
);

/* An invalid expression must not take the other curve with it. */
type(inputs[1], "sin(x)");

check(
  "an invalid expression leaves the valid curve drawn",
  preview.querySelectorAll("path").length === 1,
  String(preview.querySelectorAll("path").length),
);

check("and the frame survives", preview.querySelectorAll("line").length > 20);

check(
  "and the problem is reported on its own card",
  [...dialog.querySelectorAll("[data-graph-problem]")].some(
    (node) => !node.hidden && /cannot be plotted/.test(node.textContent),
  ),
);

/* Visibility. */
type(inputs[1], "2x + 1");

const beforeHide = preview.querySelectorAll("path").length;

click(dialog.querySelector("[data-graph-visible]"));

check(
  "hiding a function removes its curve",
  preview.querySelectorAll("path").length < beforeHide,
  `${beforeHide} -> ${preview.querySelectorAll("path").length}`,
);

click(dialog.querySelector("[data-graph-visible]"));

check(
  "and showing it again brings it back",
  preview.querySelectorAll("path").length === beforeHide,
);

/* Settings redraw. */
const beforeRange = preview.querySelectorAll("line").length;

type(dialog.querySelector('[data-graph-field="xMin"]'), "-10");

check(
  "changing the range redraws the graph",
  preview.querySelectorAll("line").length !== beforeRange,
  `${beforeRange} -> ${preview.querySelectorAll("line").length}`,
);

/* ====================================================== apply/cancel */

console.log("\nApply and Cancel");
console.log("-----------------");

let applied = null;

plotEditor.closePlotEditor();

const applyDialog = plotEditor.openPlotEditor(null, {
  onApply: (result) => {
    applied = result;
  },
  onCancel: () => {},
});

click(applyDialog.querySelector("[data-graph-add]"));
click(applyDialog.querySelector("[data-graph-apply]"));

check("Apply hands back the geometry", Boolean(applied?.geometry));

check(
  "with the function the editor held",
  applied?.geometry?.functions?.length === 1,
  String(applied?.geometry?.functions?.length),
);

check(
  "and the editor closes",
  !dom.window.document.querySelector(".drawing-plot-editor"),
);

let cancelled = false;

const cancelDialog = plotEditor.openPlotEditor(null, {
  onApply: () => {},
  onCancel: () => {
    cancelled = true;
  },
});

click(cancelDialog.querySelector("[data-graph-add]"));
click(cancelDialog.querySelector("[data-graph-cancel]"));

check("Cancel reports the cancellation", cancelled);

check(
  "and closes the editor",
  !dom.window.document.querySelector(".drawing-plot-editor"),
);

/* ====================================================== the old layout */

console.log("\nThe legacy coordinate interface is gone");
console.log("----------------------------------------");

const source = require("fs").readFileSync(
  require("./helpers/source-path.cjs").locate("math-plot-editor.js"),
  "utf8",
);

const markup = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/[^\n]*$/gm, "");

check("there is no COORDINATES section heading", !/COORDINATES/.test(markup));

check(
  "and no two-pane left/right split",
  !/plot-editor-left|plot-editor-right/.test(markup),
);

check("and no expression-kind chooser", !/plot-editor-choose/.test(markup));

/*
 * THE MODE IS CALLED PLOT. "Expression" is still the right word for the
 * mathematics a function is written as - "Enter an expression" is a sentence
 * about a formula, not a mode name - so the check is on the MODE LABEL, not on
 * the word appearing anywhere.
 */
check(
  "the mode is still called Plot, not Expression",
  !/Plot Editor|Graph - Plot/.test(markup) === false &&
    !/title>Expression|mode: "expression"|Expression Editor/.test(markup),
);

void mathModel;

/* ============================================================ summary */

console.log(`\n${pass} passed, ${fail} failed`);

if (fail > 0) {
  process.exitCode = 1;
}
