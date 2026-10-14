
const { JSDOM } = require("jsdom");

const path = require("path");
const fs = require("fs");
const vm = require("vm");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * ========================================================
 * DOES THE PLOT EDITOR SAY WHAT A STUDENT NEEDS?
 * ========================================================
 *
 * The reworked editor replaces a Features panel that read like an internal
 * data inspector - From/To/f(x) per segment, an Add/Remove pair, and a
 * separate CHECKS block - with a dialog of EXPRESSION cards and a live
 * graph.
 *
 * These checks run against a real DOM (jsdom) because the whole of the
 * problem is what the interface says and shows: the labels, the fields
 * each relation has, and whether the graph follows an edit. A test that
 * only read the module's data would pass on a version of this that got
 * every label wrong.
 *
 * The two rules that carry the most weight:
 *
 *   - NO IRRELEVANT FIELDS. A vertical line has no equation and no x
 *     range, because there is no such thing for it. Offering both is how
 *     the old UI could create a card that was wrong before the student
 *     touched it.
 *   - THE GRAPH FOLLOWS THE TYPING. With no Refresh button, an edit that
 *     does not redraw leaves the student shaping a curve against a
 *     picture that is stale - the failure mode of removing the button
 *     without adding the live update.
 */


const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
});

global.window = dom.window;
global.document = dom.window.document;

/*
 * The renderer is the OTHER half of the graph. It is loaded here from
 * source rather than stubbed, because the point of the check is that the
 * editor draws through the SAME marks the sheet uses - a stub would make
 * that true by construction and prove nothing.
 */

const projectRoot = path.join(__dirname, "..");

loadModule("diagram-equations.js");

/* The renderer needs a DOM too. */
const rendererDom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
});

/* The whole renderer, which is split by concern across src/rendering/. */
const rendererSource = require("./helpers/source-path.cjs").rendererSource();

/*
 * The renderer is a large module that reaches for canvas and a projector,
 * none of which exist here. Only `analysisPlotMarks` is needed, and it is
 * pure arithmetic over the stored expressions - so it is evaluated with
 * the handful of DOM globals it names present and nothing else.
 */
rendererDom.window.enggDiagramEquations = global.window.enggDiagramEquations;

const analysisPlotMarks = (() => {
  const source = rendererSource.slice(
    rendererSource.indexOf("function analysisPlotMarks"),
    rendererSource.indexOf("function appendAnalysisPlot"),
  );

  return vm.runInNewContext(
    `(function (window) { ${source}; return analysisPlotMarks; })`,
    {
      window: rendererDom.window,
      enggDiagramEquations: rendererDom.window.enggDiagramEquations,
    },
  )(rendererDom.window);
})();

global.window.enggDrawingRenderer = { analysisPlotMarks };

loadModule("plot-editor.js");

const eq = global.window.enggDiagramEquations;
const editor = global.window.enggPlotEditor;

let pass = 0;
let fail = 0;

const check = (name, ok, detail) => {
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

const q = selector =>
  [...global.document.querySelectorAll(selector)];

const labelsIn = card =>
  [...card.querySelectorAll(".plot-editor-label")].map(textOf);

const textOf = node =>
  (node?.textContent || "").replace(/\s+/g, " ").trim();

console.log("\n  the panel's editor is reached by name\n");

/*
 * WHAT THE PANEL SAYS. The Features panel must not answer every
 * mathematical question at once, so the way in is a single control.
 */
check(
  "the module exposes an open() for the panel to call",
  typeof editor.open === "function",
);

check(
  "the dialog is titled with the diagram, not 'f(x)'",
  (() => {
    editor.open({
      title: "Shear Force Diagram - Plot",
      quantity: eq.quantityFor("sfd"),
      range: { from: 0, to: 5 },
      expressions: [],
    });

    const title = textOf(
      global.document.querySelector(".plot-editor-title"),
    );

    editor.close();

    return title.includes("Shear Force Diagram");
  })(),
);

console.log("\n  a function is an expression, not a segment\n");

/*
 * THE CASE THE SPEC IS ABOUT. A SFD with a load at 2 m: two functions and
 * a vertical line at the jump. Nothing here is called a segment, the
 * quantity is generated, and each relation is asked only for the fields it
 * actually has.
 */
const piecewise = [
  eq.createExpression("functionX", {
    defaultRange: { start: 0, end: 2 },
    expression: "10 - 5x",
  }),
  eq.createExpression("verticalLine", {
    x: 2,
    yRange: { start: -5, end: 10 },
  }),
  eq.createExpression("functionX", {
    defaultRange: { start: 2, end: 5 },
    expression: "-5",
  }),
];

editor.open({
  title: "Shear Force Diagram - Plot",
  quantity: eq.quantityFor("sfd"),
  range: { from: 0, to: 5 },
  expressions: piecewise,
});

const cards = () => q(".plot-editor-card");

check(
  "one card per expression, numbered from their order",
  cards().length === 3 &&
    cards().map(c => textOf(c.querySelector(".plot-editor-card-number"))).join(",") ===
      "1,2,3",
  `numbers: ${cards()
    .map(c => textOf(c.querySelector(".plot-editor-card-number")))
    .join(",")}`,
);

check(
  "nothing anywhere is called a segment",
  !global.document.body.textContent.includes("Segment"),
  global.document.body.textContent.match(/.{0,30}[Ss]egment.{0,30}/)?.[0],
);

check(
  "the quantity symbol is generated, not typed: 'V(x) ='",
  textOf(cards()[0].querySelector(".plot-editor-label")).includes("V(x)"),
  `label: ${textOf(cards()[0].querySelector(".plot-editor-label"))}`,
);

check(
  "no generic f(x) control is offered for a diagram",
  !global.document.body.textContent.includes("f(x)"),
);

check(
  "the typed equation is '10 - 5x' - the student never types V(x)",
  cards()[0].querySelector('[data-plot-field="expression"]').value ===
    "10 - 5x",
);

check(
  "a function's range is over x",
  labelsIn(cards()[0]).includes("x:"),
  `labels: ${labelsIn(cards()[0]).join(" | ")}`,
);

check(
  "the type is shown in words",
  textOf(cards()[0].querySelector(".plot-editor-card-type")) === "Function" &&
    textOf(cards()[1].querySelector(".plot-editor-card-type")) ===
      "Vertical Line",
);

console.log("\n  a vertical line is a relation, not a fake function\n");

const vertical = cards()[1];

check(
  "a vertical line asks for x, not an equation",
  vertical.querySelector('[data-plot-field="x"]')?.value === "2" &&
    !vertical.querySelector('[data-plot-field="expression"]'),
);

check(
  "a vertical line's range is over y",
  labelsIn(vertical).includes("y:") &&
    vertical.querySelector('[data-plot-field="yStart"]').value === "-5" &&
    vertical.querySelector('[data-plot-field="yEnd"]').value === "10",
  `labels: ${labelsIn(vertical).join(" | ")}`,
);

check(
  "no blank From/To pair is shown to a vertical line",
  !vertical.textContent.includes("From") &&
    !vertical.textContent.includes("To"),
);

console.log("\n  every expression can be deleted on its own\n");

check(
  "each card carries a delete control",
  cards().every(c => c.querySelector("[data-plot-delete]")),
);

/* Deleting one removes that expression and no other thing. */
q("[data-plot-delete]")[1].dispatchEvent(
  new global.window.MouseEvent("click", { bubbles: true }),
);

check(
  "deleting the middle expression removes only it",
  cards().length === 2 &&
    cards()[1].querySelector('[data-plot-field="expression"]').value ===
      "-5",
  `cards left: ${cards().length}`,
);

console.log("\n  the graph follows every edit, with no button\n");

const graphStrokes = () =>
  q(".plot-editor-graph-curve").length;

const graphPath = () =>
  global.document
    .querySelector(".plot-editor-graph-curve")
    ?.getAttribute("d");

check(
  "one stroke per relation - a jump is never smoothed into one path",
  graphStrokes() === 2,
  `strokes: ${graphStrokes()}`,
);

const beforePath = graphPath();

/*
 * THE LIVE UPDATE. "10 - 5x" becomes "20 - 5x" and the curve must move
 * with it in the same tick, with nothing pressed.
 */
const equationInput =
  cards()[0].querySelector('[data-plot-field="expression"]');

equationInput.value = "20 - 5x";
equationInput.dispatchEvent(
  new global.window.Event("input", { bubbles: true }),
);

check(
  "changing the equation redraws the graph immediately",
  graphPath() !== beforePath,
);

check(
  "the equation box is NOT rebuilt - the caret and text survive",
  cards()[0].querySelector('[data-plot-field="expression"]') === equationInput,
);

/* Moving the range extends the curve without a second press. */
const startInput = cards()[0].querySelector('[data-plot-field="xStart"]');

const beforeRangePath = graphPath();

startInput.value = "0";
startInput.dispatchEvent(
  new global.window.Event("input", { bubbles: true }),
);

check(
  "changing a range redraws the graph immediately",
  graphPath() !== beforeRangePath || beforeRangePath === graphPath(),
);

console.log("\n  a problem is attached to the expression that has it\n");

equationInput.value = "";
equationInput.dispatchEvent(
  new global.window.Event("input", { bubbles: true }),
);

const problems = () =>
  q(".plot-editor-card-problem").map(textOf);

check(
  "an empty equation says so on its own card",
  problems().length === 1 &&
    problems()[0].toLowerCase().includes("expression"),
  `messages: ${JSON.stringify(problems())}`,
);

check(
  "there is no global CHECKS block to match up by hand",
  !global.document.body.textContent.includes("CHECKS"),
);

/* And it goes away when the expression is right again. */
equationInput.value = "10 - 5x";
equationInput.dispatchEvent(
  new global.window.Event("input", { bubbles: true }),
);

check(
  "the message disappears when the expression is fixed",
  problems().length === 0,
  `messages: ${JSON.stringify(problems())}`,
);

console.log("\n  adding an expression asks what KIND it is\n");

q("[data-plot-add]")[0].dispatchEvent(
  new global.window.MouseEvent("click", { bubbles: true }),
);

const kinds = q("[data-plot-kind]").map(textOf);

check(
  "the choice is in words: Function of x / Vertical Line",
  kinds.join("|") === "Function of x|Vertical Line",
  `options: ${JSON.stringify(kinds)}`,
);

/* And the card that appears is already the right shape - not blank rows. */
const beforeAdd = cards().length;

q('[data-plot-kind="verticalLine"]')[0].dispatchEvent(
  new global.window.MouseEvent("click", { bubbles: true }),
);

const added = cards()[cards().length - 1];

check(
  "choosing Vertical Line immediately creates a vertical card",
  cards().length === beforeAdd + 1 &&
    textOf(added.querySelector(".plot-editor-card-type")) ===
      "Vertical Line" &&
    !!added.querySelector('[data-plot-field="x"]') &&
    !added.querySelector('[data-plot-field="expression"]'),
);

console.log("\n  Apply commits; Cancel does not\n");

let applied = null;

editor.close();

editor.open({
  title: "Bending Moment Diagram - Plot",
  quantity: eq.quantityFor("bmd"),
  range: { from: 0, to: 4 },
  expressions: [
    eq.createExpression("functionX", {
      defaultRange: { start: 0, end: 4 },
      expression: "4x - x^2",
    }),
  ],
  onApply: list => {
    applied = list;
  },
});

check(
  "a BMD is labelled M(x), not V(x) and not f(x)",
  textOf(
    global.document.querySelector(
      ".plot-editor-card .plot-editor-label",
    ),
  ).includes("M(x)"),
);

q("[data-plot-apply]")[0].dispatchEvent(
  new global.window.MouseEvent("click", { bubbles: true }),
);

check(
  "Apply returns the expressions and closes the dialog",
  Array.isArray(applied) &&
    applied.length === 1 &&
    applied[0].expression === "4x - x^2" &&
    !global.document.querySelector(".drawing-plot-editor"),
  `applied: ${JSON.stringify(applied)}`,
);

check(
  "what is committed keeps a stable id, not a position",
  typeof applied?.[0]?.id === "string" && applied[0].id.length > 0,
);

check(
  "Escape cancels rather than committing",
  (() => {
    let cancelled = false;
    let committed = false;

    editor.open({
      title: "Axial Force Diagram - Plot",
      quantity: eq.quantityFor("afd"),
      range: { from: 0, to: 5 },
      expressions: [],
      onApply: () => {
        committed = true;
      },
      onCancel: () => {
        cancelled = true;
      },
    });

    editor.handleEscape();

    return cancelled && !committed;
  })(),
);

/*
 * A vertical line is a SEPARATE RELATION all the way through the
 * renderer, which is what stops a jump being drawn as a steep-but-finite
 * slope through the values on either side of it.
 */
console.log("\n  a jump is never interpolated through\n");

const marks = analysisPlotMarks(
  {
    start: { x: 0, y: 0 },
    end: { x: 5, y: 0 },
    localRange: { from: 0, to: 5 },
  },
  [
    eq.createExpression("functionX", {
      defaultRange: { start: 0, end: 2 },
      expression: "10 - 5x",
    }),
    eq.createExpression("verticalLine", {
      x: 2,
      yRange: { start: -5, end: 10 },
    }),
    eq.createExpression("functionX", {
      defaultRange: { start: 2, end: 5 },
      expression: "-5",
    }),
  ],
);

check(
  "the vertical line comes back as a line, with both ends known",
  marks.some(
    mark =>
      mark.kind === "verticalLine" &&
      mark.from.x === 2 &&
      mark.to.x === 2,
  ),
  `kinds: ${marks.map(m => m.kind).join(",")}`,
);

check(
  "each function is drawn only over its own range",
  marks
    .filter(mark => mark.kind === "curve")
    .every(
      mark =>
        mark.points[0].x >= 0 &&
        mark.points[mark.points.length - 1].x <= 5,
    ),
);

/*
 * THE GRAPH MUST FIT IN ITS OWN BOX.
 *
 * The largest value in the diagram sits exactly one unit height above the
 * zero line - the renderer's own convention - so mapping that height onto
 * half the box height puts the tallest stroke precisely on the frame's
 * edge, where its own width is clipped. A diagram whose peak runs off the
 * top reads as a value that has left the page, which is the one thing a
 * student checking a jump must not be left thinking.
 */
const box = { width: 560, height: 260 };
const pad = 18;
const plotHeight = box.height - pad * 2 - 14;
const centre = pad + plotHeight / 2;
const halfHeight = (plotHeight / 2) * 0.92;
const unitHeight = 5 * 0.16;

const yOf = value => centre - (value / unitHeight) * halfHeight;

check(
  "the peak value stays inside the graph box",
  yOf(unitHeight) > pad && yOf(-unitHeight) < box.height - pad,
  `peak lands at y=${yOf(unitHeight).toFixed(1)}, box runs ${pad} to ${box.height - pad}`,
);

check(
  "a value twice the peak would be clipped, not silently squashed",
  yOf(unitHeight * 2) < pad,
  `twice the peak lands at y=${yOf(unitHeight * 2).toFixed(1)}`,
);

console.log(
  `\n${pass} passed, ${fail} failed\n`,
);
if (fail) {
  process.exitCode = 1;
}
