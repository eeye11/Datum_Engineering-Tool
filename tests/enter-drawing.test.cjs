/* eslint-disable no-console */
/*
 * ========================================================
 * THE DRAWING WORKSPACE IS THE APPLICATION
 * ========================================================
 *
 * DAETUM used to open on a Written Solution page, with an "Enter Drawing"
 * control that asked which figure to place and wrote a `\datumdrawing{...}`
 * reference into the prose. The written half is gone, so this suite checks what
 * replaced it, in the running application:
 *
 *   1. the page opens ON the drawing workspace - no tab to press, no choice;
 *   2. the drawing workspace is fully wired: canvas, sheets, panels, menu bar;
 *   3. nothing from the written solution is left on the page;
 *   4. the drawing still works - a sheet can be added and drawn on.
 *
 * The page is booted for real, because the question is what the application
 * does, not what a module returns.
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

const { window, document, error } = bootApp();

if (error) {
  console.log(`  the application did not boot: ${error.message}`);
  process.exit(1);
}

/* Compilation is stubbed: the workspace is under test, not the TeX engine. */
window.fetch = globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    success: true,
    svg: '<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>',
  }),
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  await whenReady();
  await wait(400);

  const loc = require(path.join(__dirname, "helpers", "source-path.cjs")).locate;
  const { enggDrawingSheets } = require(loc("sheet-controller.js"));

  console.log("\nThe application opens on the drawing workspace");
  console.log("----------------------------------------------");

  check(
    "the drawing section is active",
    document.getElementById("drawing")?.classList.contains("active") === true,
    document.getElementById("drawing")?.className,
  );

  check(
    "and it is the only active workspace section",
    document.querySelectorAll(".review-content.active").length === 1,
  );

  check(
    "there is no tab strip to choose a workspace",
    document.querySelectorAll(".tab[data-tab]").length === 0,
  );

  console.log("\nThe written solution is gone");
  console.log("-----------------------------");

  check("no written-solution section", document.getElementById("writing") === null);
  check("no written-solution editor", document.getElementById("solutionEditor") === null);
  check("no Enter Drawing control", document.getElementById("solutionEnterDrawing") === null);
  check(
    "no return-to-solution control",
    document.getElementById("drawingReturnToSolution") === null,
  );

  console.log("\nThe drawing workspace is wired");
  console.log("-------------------------------");

  check("the canvas is there", Boolean(document.querySelector(".drawing-canvas")));
  check("the menu bar is there", Boolean(document.querySelector(".datum-menubar")));
  check(
    "the tool list is there",
    Boolean(
      document.getElementById("drawingToolList") ||
        document.querySelector(".drawing-tool-list"),
    ),
  );
  check(
    "the Objects, Features and Source tabs are there",
    ["objects", "features", "source"].every((tab) =>
      Boolean(document.querySelector(`[data-panel-tab="${tab}"], [data-tab="${tab}"]`)),
    ),
  );

  console.log("\nA drawing can still be made");
  console.log("---------------------------");

  const sheetsBefore = enggDrawingSheets.all().length;

  check("the document opens with a sheet", sheetsBefore >= 1, String(sheetsBefore));

  let created = null;

  try {
    created = enggDrawingSheets.createSheet?.({ name: "Test sheet" });
  } catch (thrown) {
    console.log(`  --   createSheet threw: ${thrown.message}`);
  }

  check(
    "a new sheet can be added",
    enggDrawingSheets.all().length === sheetsBefore + 1,
    `${sheetsBefore} -> ${enggDrawingSheets.all().length}`,
  );

  check(
    "and it is a real sheet with an id",
    Boolean(created?.id || enggDrawingSheets.all().at(-1)?.id),
  );

  console.log(`\n${pass} passed, ${fail} failed`);

  /* The booted application leaves timers running; this suite is finished. */
  setImmediate(() => process.exit(fail ? 1 : 0));
})();
