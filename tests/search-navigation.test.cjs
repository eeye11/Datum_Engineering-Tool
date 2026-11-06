/*
 * ========================================================
 * A SEARCH RESULT ACTUALLY TAKES THE STUDENT SOMEWHERE
 * ========================================================
 *
 * Finding a result is half the job. This test BOOTS THE REAL PAGE - index.html,
 * the real entry module, the real toolbar - and activates results through the
 * search, then checks what the application did:
 *
 *   a TOOL result        opens its category, expands its group and arms the
 *                        tool, so the next click draws it
 *   a SECTION result     opens its place and arms NOTHING
 *   a PANEL result       opens that panel tab
 *   a COMMAND result     runs the menu's own handler
 *   an UNAVAILABLE one   refuses, plainly, and leaves the state alone
 *
 * It runs in a fresh page (a child process) because the application is a
 * singleton: the page this test looks at has never been navigated by anything
 * else, which is the only way to tell "the result did it" from "it was already
 * like that".
 */
const { runInFreshPage } = require("./helpers/boot-app.cjs");

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

console.log("\n  results navigate, arm and run against the real page\n");

const report = runInFreshPage(String.raw`async ({ window, document, bootError, projectRoot, require }) => {
  if (bootError) {
    return { bootError: String(bootError && bootError.stack || bootError) };
  }

  /* The SAME module instances the page booted with. */
  const index = require(projectRoot + "/src/components/layout/toolbar/command-index.js");
  const search = require(projectRoot + "/src/components/layout/toolbar/command-search.js");
  const { drawingState } = require(projectRoot + "/src/features/workspace/editor-state.js");

  void window;

  const activeCategory = () =>
    document.querySelector(".drawing-category.active")?.dataset.category || null;

  const toolButton = (id) => document.querySelector('.drawing-tool[data-tool-id="' + id + '"]');

  const groupHidden = (id) => {
    const button = toolButton(id);

    if (!button) {
      return null;
    }

    const section = document.getElementById(button.getAttribute("aria-controls"));

    return section ? section.hidden : null;
  };

  const result = (query, type, label) =>
    search.searchCommands(query, 30).find(
      (entry) => entry.type === type && (!label || entry.label === label),
    );

  const out = {};

  /* ---- a tool behind a dropdown, chosen THROUGH THE FIELD ---------------- */

  out.categoryBeforeElbow = activeCategory();

  const field = document.getElementById("drawingCommandSearch");

  field.focus();
  field.value = "elbow";
  field.dispatchEvent(new window.Event("input", { bubbles: true }));
  field.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );

  /* The activation is asynchronous: let its imports settle. */
  await new Promise((resolve) => window.setTimeout(resolve, 80));

  const elbow = result("elbow", "tool", "Elbow");

  out.elbowFound = Boolean(elbow);
  out.elbowLocation = elbow?.location || null;

  out.categoryAfterElbow = activeCategory();
  out.activeToolAfterElbow = drawingState.activeTool;
  out.fluidsToolAfterElbow = drawingState.interaction?.fluidsTool || null;
  out.flowPathsExpanded = groupHidden("fluids-flow-paths") === false;

  /*
   * THE BUTTON THE STUDENT WOULD HAVE PRESSED IS THE ONE THAT IS PRESSED. A
   * tool that is running with no lit button is a tool the student cannot see.
   */
  out.pressedAfterElbow = [...document.querySelectorAll('.drawing-tool[aria-pressed="true"]')].map(
    (button) => button.dataset.toolId,
  );

  /* ---- and the choice is written in the field that made it --------------- */

  out.fieldAfterTool = field?.value || null;
  out.fieldChosen = field?.dataset.chosen || null;
  out.fieldSelectedOnFocus = (() => {
    field.focus();
    return field.selectionStart === 0 && field.selectionEnd === field.value.length;
  })();

  /* ---- another tool, from a different section ---------------------------- */

  const pump = result("pump", "tool", "Pump");

  if (pump) {
    await pump.run();
  }

  out.activeToolAfterPump = drawingState.activeTool;
  out.pressedAfterPump = [...document.querySelectorAll('.drawing-tool[aria-pressed="true"]')].map(
    (button) => button.dataset.toolId,
  );

  /* ---- a section opens its place and arms nothing ------------------------ */

  const fluids = result("fluids", "section", "Fluids");
  const armedBeforeSection = result("pump", "tool", "Pump") ? "pump" : drawingState.activeTool;

  out.fluidsFound = Boolean(fluids);

  if (fluids) {
    await fluids.run();
  }

  out.armedBeforeSection = armedBeforeSection;
  out.activeToolAfterSection = drawingState.activeTool;
  out.categoryAfterSection = activeCategory();

  /* ---- a group opens, still arming nothing ------------------------------- */

  const flowPaths = result("flow paths", "section", "Flow Paths");
  const armedBeforeGroup = drawingState.activeTool;

  out.flowPathsFound = Boolean(flowPaths);

  if (flowPaths) {
    await flowPaths.run();
  }

  out.flowPathsExpandedBySection = groupHidden("fluids-flow-paths") === false;
  out.activeToolAfterGroup = drawingState.activeTool;
  out.armedBeforeGroup = armedBeforeGroup;

  /* ---- a panel result opens its tab -------------------------------------- */

  const source = result("open source", "panel", "Source");

  out.sourceFound = Boolean(source);

  if (source) {
    await source.run();
  }

  out.tabAfterSource = document.querySelector(".drawing-panel-tab.active")?.dataset.panelTab || null;
  out.sourcePaneVisible = document.querySelector('[data-panel-pane="source"]')?.hidden === false;

  /* ---- a command runs the menu's own handler ----------------------------- */

  const fit = result("fit to screen", "command", "Fit to Screen");
  const zoomBefore = drawingState.camera.zoom;

  drawingState.camera.zoom = zoomBefore * 2;

  const zoomChanged = drawingState.camera.zoom;

  if (fit) {
    await fit.run();
  }

  out.fitFound = Boolean(fit);
  out.zoomChanged = zoomChanged;
  out.zoomAfterFit = drawingState.camera.zoom;

  /* ---- an unavailable tool refuses --------------------------------------- */

  const threeD = result("3d coordinate system", "tool", "3D Coordinate System");

  out.threeDFound = Boolean(threeD);
  out.threeDDisabled = threeD?.disabled === true;
  out.threeDReason = threeD?.reason || null;

  /* ---- a context-dependent command says what it needs -------------------- */

  const copy = result("copy", "command", "Copy");

  out.copyFound = Boolean(copy);
  out.copyDisabled = copy?.disabled === true;
  out.copyReason = copy?.reason || null;

  /* ---- every result the search offers can be run or explains itself ------ */

  const offered = index.searchIndex();

  out.rowsWithoutHandler = offered
    .filter((entry) => !entry.disabled && typeof entry.run !== "function")
    .map((entry) => entry.id);

  out.disabledWithoutReason = offered
    .filter((entry) => entry.disabled && !entry.reason)
    .map((entry) => entry.id);

  return out;
}`);

if (report.taskError) {
  console.log(`  task error: ${report.taskError}`);
}

check("the page booted", !report.bootError, report.bootError || "");

check("the Elbow tool was found", report.elbowFound);
check(
  "and its location names Fluids and Flow Paths",
  /Fluids/.test(report.elbowLocation || "") && /Flow Paths/.test(report.elbowLocation || ""),
  report.elbowLocation,
);

check(
  "activating it opened the Fluids category it lives in",
  report.categoryBeforeElbow !== "FLUIDS" && report.categoryAfterElbow === "FLUIDS",
  `${report.categoryBeforeElbow} -> ${report.categoryAfterElbow}`,
);

check(
  "and expanded the Flow Paths dropdown it lives in",
  report.flowPathsExpanded === true,
  String(report.flowPathsExpanded),
);

check(
  "and armed the Elbow tool, recorded as the Fluids tool pressed",
  report.activeToolAfterElbow === "elbow" && report.fluidsToolAfterElbow === "elbow",
  `${report.activeToolAfterElbow} / ${report.fluidsToolAfterElbow}`,
);

check(
  "and the Elbow's own button is the one showing as selected",
  (report.pressedAfterElbow || []).includes("elbow"),
  (report.pressedAfterElbow || []).join(", "),
);

check(
  "and the search field records the tool that was chosen, ready to type over",
  report.fieldChosen === "true" &&
    report.fieldAfterTool === "Elbow" &&
    report.fieldSelectedOnFocus === true,
  `${JSON.stringify(report.fieldAfterTool)} / chosen=${report.fieldChosen} / selected=${report.fieldSelectedOnFocus}`,
);

check(
  "a second tool from the same section is armed and selected in its place",
  report.activeToolAfterPump === "pump" &&
    (report.pressedAfterPump || []).includes("pump") &&
    !(report.pressedAfterPump || []).includes("elbow"),
  `${report.activeToolAfterPump} / ${(report.pressedAfterPump || []).join(", ")}`,
);

check("the Fluids category was found as a Section", report.fluidsFound);

check(
  "activating it navigates to Fluids",
  report.categoryAfterSection === "FLUIDS",
  report.categoryAfterSection,
);

check(
  "and arms no tool of its own - what was armed before it stays armed",
  report.activeToolAfterSection === report.armedBeforeSection,
  `${report.armedBeforeSection} -> ${report.activeToolAfterSection}`,
);

check("the Flow Paths group was found as a Section", report.flowPathsFound);
check(
  "and opening it expands the group without arming anything of its own",
  report.flowPathsExpandedBySection === true &&
    report.activeToolAfterGroup === report.armedBeforeGroup,
  `${report.flowPathsExpandedBySection} / ${report.armedBeforeGroup} -> ${report.activeToolAfterGroup}`,
);

check("the Source panel was found from \"open source\"", report.sourceFound);
check("and activating it opens the Source tab", report.sourcePaneVisible === true);

check("the Fit to Screen command was found", report.fitFound);
check(
  "and running it changed the zoom through the real viewport command",
  report.zoomAfterFit !== report.zoomChanged,
  `${report.zoomChanged} -> ${report.zoomAfterFit}`,
);

check("the 3D Coordinate System is findable", report.threeDFound);
check(
  "but is marked unavailable, with the reason",
  report.threeDDisabled === true && /2D/.test(report.threeDReason || ""),
  report.threeDReason,
);

check(
  "Copy is findable with nothing selected, and says it needs a selection",
  report.copyFound && report.copyDisabled === true && /select/i.test(report.copyReason || ""),
  report.copyReason,
);

check(
  "every available result has a handler",
  report.rowsWithoutHandler.length === 0,
  (report.rowsWithoutHandler || []).join(", "),
);

check(
  "and every unavailable one says why",
  report.disabledWithoutReason.length === 0,
  (report.disabledWithoutReason || []).join(", "),
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
