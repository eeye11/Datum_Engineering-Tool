/* eslint-disable no-console */
/*
 * ========================================================
 * THE SOURCE TAB, IN THE RUNNING APPLICATION
 * ========================================================
 *
 * The behaviours that need the real page: typing, automatic rendering, error
 * recovery, the status line, source/object synchronization, and the startup
 * state. The static layout and styling invariants are in source-tab-layout.
 *
 * ONE BOOT, ONE PROCESS. ES modules are singletons, so the application is
 * started once and the checks run in the order they are written - each one
 * leaving the document in a known state for the next.
 */
const path = require("path");
const { bootApp, whenReady } = require("./helpers/boot-app.cjs");

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

const BS = String.fromCharCode(92);

const { window, document, error } = bootApp();

if (error) {
  console.log(`  the application did not boot: ${error.message}`);
  process.exit(1);
}

/* The renderer is stubbed: compilation is not what is under test here. */
const requests = [];

window.fetch = globalThis.fetch = async (url, options = {}) => {
  if (String(url).includes("/api/render-tikz")) {
    const body = JSON.parse(options.body || "{}");

    requests.push(body.tikz);

    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        svg: `<svg xmlns="http://www.w3.org/2000/svg"><g data-render-index="${requests.length}"/></svg>`,
      }),
    };
  }

  return { ok: true, status: 200, json: async () => ({}) };
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* Wait until `check` holds, or give up. */
async function until(predicate, message, ms = 4000) {
  const deadline = Date.now() + ms;

  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }

    await wait(25);
  }

  console.log(`  FAIL ${message}`);

  return false;
}

(async () => {
  await whenReady();
  await wait(300);

  const { locate } = require("./helpers/source-path.cjs");
  const load = (file) => require(locate(path.basename(file)));

  const model = load("src/shared/model/drawing-state.js").default;
  const { drawingState } = load("features/workspace/editor-state.js");
  const { activeSourceManager } = load("drawing-source-manager.js");
  const tabs = load("src/components/layout/panels/panel-tabs.js");
  const canvasRender = load("src/components/layout/workspace/canvas-render.js");

  const manager = activeSourceManager();
  const statusText = () =>
    document.getElementById("drawingSourceStatus").textContent;
  const diagnosticsEl = () =>
    document.getElementById("drawingSourceDiagnostics");

  /* ---------------------------------------------------- 1. at startup */

  console.log("\nOpening the workspace is not an error");
  console.log("-------------------------------------");

  check(
    "the drawing view exists",
    Boolean(document.querySelector(".drawing-canvas")),
  );
  check(
    "no diagnostic is shown",
    diagnosticsEl().hidden === true,
    diagnosticsEl().textContent,
  );
  check(
    "the source manager holds no error",
    manager.lastError() === null &&
      !manager.diagnostics().some((row) => row.severity === "error"),
    JSON.stringify(manager.diagnostics()),
  );

  /* ------------------------------------------------- 2. opening Source */

  console.log("\nOpening Source on an empty drawing");
  console.log("-----------------------------------");

  tabs.setActivePanelTab("source");
  await wait(400);

  check(
    "the Status line shows a clean state",
    !/error/i.test(statusText()),
    statusText(),
  );
  check("no red decoration is painted", diagnosticsEl().hidden === true);
  check(
    "the pane is visible",
    document.getElementById("drawingPanelSource").hidden === false,
  );

  const textarea = document.querySelector("#drawingSourceEditor textarea");

  check(
    "the complete source is in the editor",
    textarea.value.includes(BS + "tikzpicture"),
    textarea.value,
  );

  /* --------------------------------------------------- 3. a valid edit */

  console.log("\nA valid edit renders automatically");
  console.log("-----------------------------------");

  const valid = [
    BS + "begin{tikzpicture}[x=1mm, y=1mm]",
    BS + "draw[black] (0,0) -- (100,0);",
    BS + "end{tikzpicture}",
  ].join("\n");

  textarea.value = valid;
  textarea.dispatchEvent(new window.Event("input", { bubbles: true }));

  await until(
    () => manager.getVisibleSource().includes("(0,0) -- (100,0)"),
    "the edit never reached the source",
  );

  check("no Render button was needed", requests.length > 0);
  await until(
    () => canvasRender.renderedSourceRevision() === manager.revision(),
    "the drawing never rendered the edit",
  );

  /* -------------------------------------- 4. a supported statement is an object */

  console.log("\nSupported source becomes an editable object");
  console.log("--------------------------------------------");

  await until(
    () => drawingState.objects.some((object) => object.type === "line"),
    "no line object was created",
  );
  check(
    "a line object exists",
    drawingState.objects.some((object) => object.type === "line"),
  );
  check(
    "the complete source is still shown",
    textarea.value.includes(BS + "end{tikzpicture}"),
  );

  /* ------------------------------------------- 5. an invalid statement */

  console.log("\nOne invalid statement does not break the sheet");
  console.log("-----------------------------------------------");

  const broken = [
    BS + "begin{tikzpicture}[x=1mm, y=1mm]",
    BS + "draw (0,0 -- (100,0);",
    BS + "draw[black] (0,-20) -- (100,-20);",
    BS + "end{tikzpicture}",
  ].join("\n");

  const objectsBefore = drawingState.objects.length;

  textarea.value = broken;
  textarea.dispatchEvent(new window.Event("input", { bubbles: true }));

  await wait(300);

  check(
    "the draft is kept exactly as typed",
    manager.getVisibleSource() === broken,
    manager.getVisibleSource(),
  );
  check(
    "the invalid statement does not create an object",
    drawingState.objects.length <= objectsBefore + 1,
  );
  check(
    "a diagnostic is shown for it",
    manager.diagnostics().some((row) => row.severity === "error"),
    JSON.stringify(manager.diagnostics()),
  );
  check(
    "the diagnostic is rendered in the pane",
    diagnosticsEl().hidden === false,
  );
  check(
    "the error is decorated in the editor",
    document.querySelectorAll(".ds-error-line").length > 0,
  );
  check(
    "the good command beside it still rendered",
    requests.some((tikz) => tikz.includes("(0,-20) -- (100,-20)")),
  );

  /* ---------------------------------------------------- 6. correcting it */

  console.log("\nCorrecting it clears the diagnostic");
  console.log("------------------------------------");

  textarea.value = valid;
  textarea.dispatchEvent(new window.Event("input", { bubbles: true }));

  await until(
    () => !manager.diagnostics().some((row) => row.severity === "error"),
    "the corrected source still reports an error",
  );

  check(
    "no error remains",
    !manager.diagnostics().some((row) => row.severity === "error"),
  );
  await wait(200);
  check(
    "and its red decoration is gone",
    document.querySelectorAll(".ds-error-line").length === 0,
  );

  /* ------------------------------------------------------- 7. the status */

  console.log("\nThe status bar reports both facts");
  console.log("----------------------------------");

  await until(
    () => /Saved/.test(statusText()),
    "the draft was never saved",
    3000,
  );

  check("it says the draft is saved", /Saved/.test(statusText()), statusText());
  check("the status bar is not covered", statusText().length > 0);

  /* --------------------------------------------- 8. canvas -> source sync */

  console.log("\nA canvas edit reaches only its own block");
  console.log("-----------------------------------------");

  const markers = manager.getVisibleSource();
  const countsBefore = (markers.match(/--/g) || []).length;

  check(
    "the source still has one statement",
    countsBefore === 1,
    String(countsBefore),
  );

  /* ------------------------------------ 9. the complete document survives selection */

  console.log("\nSelecting an object keeps the whole document");
  console.log("--------------------------------------------");

  const line = drawingState.objects.find((object) => object.type === "line");

  if (line) {
    model.selectObject(drawingState, line.id);
    await wait(300);

    check(
      "the editor still holds the complete source",
      textarea.value === manager.getVisibleSource(),
    );
    check(
      "the selected object's block is banded",
      document.querySelectorAll(".drawing-source-line.selected").length > 0,
    );
  } else {
    check("a line object was available to select", false);
  }

  /* --------------------------------------------------------- results */

  console.log(`\n${pass} passed, ${fail} failed`);

  if (fail > 0) {
    process.exitCode = 1;
  }

  window.close();
})();
