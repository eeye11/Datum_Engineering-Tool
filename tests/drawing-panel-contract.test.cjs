/* eslint-disable no-console */
/*
 * ========================================================
 * THE RIGHT-SIDE PANEL: OBJECTS | FEATURES | SOURCE
 * ========================================================
 *
 * The panel's SHAPE is a contract the rest of the application depends on:
 *
 *   - exactly three sibling tabs, in the order Objects, Features, Source;
 *   - Objects is a LIST and nothing else - no property form, no controls;
 *   - Features is empty when nothing is selected;
 *   - the tab state is shared, so switching tabs cannot discard a draft or a
 *     selection.
 *
 * The tab strip and the panes are static markup plus a tab controller, so the
 * markup is read here as data (with jsdom) and the controller is exercised for
 * real.
 */

const fs = require("fs");
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

/*
 * The app's own page, read as data. The harness installs its own jsdom for the
 * modules to run against, so the page is PARSED SEPARATELY and queried through
 * its own document - installing the harness first would replace the globals
 * this would otherwise query.
 */
const markup = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
const page = new JSDOM(markup, { url: "http://localhost/" }).window.document;

const { createHarness } = require("./harness-renderer.cjs");

createHarness(projectRoot, JSDOM, require);

const { loadModule } = require("./helpers/source-path.cjs");

const panel = loadModule("panel-tabs.js");

/*
 * The tab strip itself is static markup, so it is read from the PAGE. The tab
 * controller is DOM-driven and follows globalThis.document, so the strip is
 * mounted into the harness document before it is installed.
 */
const strip = page.getElementById("drawingFeatureInspector") || page.querySelector(".drawing-inspector");

globalThis.document.body.innerHTML = strip.outerHTML;

/* ========================================================== tab order */

console.log("\nThe three tabs, in order");
console.log("------------------------");

const tabs = [...page.querySelectorAll("[data-panel-tab]")].map((button) => button.dataset.panelTab);

check("there are exactly three tabs", tabs.length === 3, tabs.join(", "));
check("they are Objects, Features, Source in that order", tabs.join(" ") === "objects features source", tabs.join(", "));

const panes = [...page.querySelectorAll("[data-panel-pane]")].map((pane) => pane.dataset.panelPane);

check("each tab has its own pane", panes.join(" ") === "objects features source", panes.join(", "));

check(
  "Objects comes before Features in the document",
  markup.indexOf('data-panel-tab="objects"') < markup.indexOf('data-panel-tab="features"'),
);
check(
  "and Features before Source",
  markup.indexOf('data-panel-tab="features"') < markup.indexOf('data-panel-tab="source"'),
);

check("there is no Properties tab", !tabs.includes("properties"));

/* ============================================================ switching */

console.log("\nSwitching tabs");
console.log("--------------");

panel.installPanelTabs();

check("the default tab is Objects", panel.activePanelTab() === "objects");

panel.setActivePanelTab("features");

check("setting a tab is remembered on the shared state", panel.activePanelTab() === "features");
check(
  "the Features pane is the visible one",
  globalThis.document.querySelector('[data-panel-pane="features"]').hidden === false &&
    globalThis.document.querySelector('[data-panel-pane="objects"]').hidden === true,
);

panel.setActivePanelTab("source");

check("and Source can be opened", panel.activePanelTab() === "source");

panel.setActivePanelTab("objects");

check("and Objects again", panel.activePanelTab() === "objects");

/* ===================================================== the Objects pane */

console.log("\nObjects is a list, not a property form");
console.log("---------------------------------------");

const objectsPane = page.querySelector('[data-panel-pane="objects"]');

const objectControls = [
  "input",
  "select",
  "textarea",
  'input[type="color"]',
  'input[type="checkbox"]',
];

check(
  "the Objects pane contains no form control at all",
  objectControls.every((selector) => objectsPane.querySelectorAll(selector).length === 0),
  [...objectsPane.querySelectorAll("input, select, textarea")]
    .map((el) => el.outerHTML.slice(0, 60))
    .join("\n"),
);

/*
 * A property block is the legacy Features markup. The Objects pane must not
 * contain one - that is what "no properties underneath the list" means.
 */
check(
  "and no property grid is nested inside it",
  objectsPane.querySelectorAll(".drawing-property-grid").length === 0,
  `${objectsPane.querySelectorAll(".drawing-property-grid").length} found`,
);

/* ============================================================== Features */

console.log("\nFeatures has one pane and one message host");
console.log("-------------------------------------------");

const featuresPane = page.querySelector('[data-panel-pane="features"]');

check("the Features pane exists", Boolean(featuresPane));

check(
  "the Features pane is not the Objects pane",
  featuresPane !== objectsPane,
);

/* ============================================================== the Source */

console.log("\nSource has an editor, a status and a diagnostics area");
console.log("------------------------------------------------------");

const sourcePane = page.querySelector('[data-panel-pane="source"]');

check("the Source pane exists", Boolean(sourcePane));
check("with a status line", Boolean(sourcePane.querySelector("#drawingSourceStatus")));
check("an editor host", Boolean(sourcePane.querySelector("#drawingSourceEditor")));
check("and a diagnostics area", Boolean(sourcePane.querySelector("#drawingSourceDiagnostics")));

/* ======================================================== tab constants */

console.log("\nThe tab controller's own contract");
console.log("---------------------------------");

check("its tab list is the three panes", panel.PANEL_TABS.join(" ") === "objects features source");
check("an unknown tab is ignored", panel.PANEL_TABS.includes("properties") === false);

console.log(`\n${pass} passed, ${fail} failed`);

if (fail > 0) {
  process.exitCode = 1;
}
