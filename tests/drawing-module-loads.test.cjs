/*
 * THE WHOLE APPLICATION BOOTS.
 *
 * Every other test exercises a module, or a function lifted out of one. None
 * of them can see a fault that only appears when the application starts: a
 * module that throws while it is being evaluated, an import that names
 * something its target does not export, a start-up step that runs before
 * the element it needs exists. Those break the page for every student, and
 * they are invisible to a test of the parts.
 *
 * So this loads the real page - index.html's own markup - into jsdom, then
 * loads the application's entry module, src/app/entry/main.js, exactly as the browser
 * does, and checks that the editor came up in a working state.
 */
const { bootApp } = require("./helpers/boot-app.cjs");

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

console.log("\n  the application boots from its entry module\n");

const { window, document, error } = bootApp();

if (error) {
  console.log(
    `  stack: ${(error.stack || "").split("\n").slice(1, 4).map((s) => s.trim()).join(" | ")}`,
  );
}

check(
  "src/app/entry/main.js and everything it imports evaluate without throwing",
  !error,
  error ? `${error.name}: ${error.message}` : "",
);

if (error) {
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(1);
}

console.log("\n  and the editor came up in a working state\n");

const inspector = document.getElementById("drawingFeaturesPanel");

check(
  "the drawing inspector element was found",
  Boolean(inspector),
  "the editor could not locate its own panel element",
);

check(
  "the inspector exposes the Objects | Features | Source tabs in order",
  (() => {
    const tabs = document.querySelectorAll(".drawing-panel-tab[data-panel-tab]");
    const order = Array.from(tabs).map((tab) => tab.dataset.panelTab);
    return order.length === 3 && order[0] === "objects" && order[1] === "features" && order[2] === "source";
  })(),
  "the panel tabs were not found, or are not in the Objects | Features | Source order",
);

check(
  "the inspector rendered its three panes",
  document.querySelectorAll(".drawing-panel-pane[data-panel-pane]").length === 3,
  "the panel panes are missing",
);

check(
  "the tool list was rendered for the default category",
  document.querySelectorAll(".drawing-tool[data-tool-id]").length > 0,
  "no tool buttons were rendered",
);

check(
  "the sheet tab bar shows the first sheet",
  document.querySelectorAll("#drawingSheetTabs [data-sheet-id], #drawingSheetTabs .drawing-sheet-tab").length > 0,
  "no sheet tab was rendered",
);

check(
  "the automation handles are installed",
  Boolean(window.enggDrawing && window.enggDrawing.state && window.enggDrawingSheets),
  "window.enggDrawing / enggDrawingSheets are missing",
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

process.exit(fail ? 1 : 0);
