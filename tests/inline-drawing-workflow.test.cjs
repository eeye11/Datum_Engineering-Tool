/*
 * ========================================================
 * THE DRAWING WORKSPACE, END TO END
 * ========================================================
 *
 * This suite used to follow a `\datumdrawing{...}` reference from a caret in the
 * Written Solution, through Enter Drawing, into the Drawing workspace and back.
 * The written half is gone, so what is left to prove is the part that was always
 * the real subject: THE DRAWING WORKSPACE WORKS.
 *
 *   1. the page opens on it, with no tab to press;
 *   2. a sheet can be added and made active;
 *   3. an object drawn on it reaches the model AND the generated LaTeX;
 *   4. the sheet keeps that LaTeX when another sheet is opened;
 *   5. nothing from the written solution is left on the page.
 *
 * ONE BOOT, ONE PROCESS: ES modules are singletons, so the checks run in order
 * and each leaves the page ready for the next.
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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const BS = String.fromCharCode(92);

async function run() {
  const { window, document, error } = bootApp();

  if (error) {
    console.log(`  the application did not boot: ${error.message}`);
    process.exit(1);
  }

  /* Compilation is stubbed: what is under test is the workspace, not TeX. */
  window.fetch = globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><g/></svg>',
    }),
  });

  await wait(150);

  console.log("\n  the drawing workspace is what opens\n");

  check(
    "the drawing section is active",
    document.getElementById("drawing")?.classList.contains("active") === true,
  );

  check(
    "there is no workspace tab strip",
    document.querySelectorAll(".tab[data-tab]").length === 0,
  );

  check(
    "and no written solution to switch to",
    document.getElementById("writing") === null &&
      document.getElementById("solutionEditor") === null,
  );

  const sheets = window.enggDrawingSheets;

  check("the sheet controller is reachable", Boolean(sheets));

  if (!sheets) {
    console.log(`\n  ${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
  }

  console.log("\n  a sheet can be added and drawn on\n");

  const sheetCountBefore = sheets.all().length;

  const created = sheets.createSheet({ name: "Workflow sheet" });

  check("a sheet is created", sheets.all().length === sheetCountBefore + 1);
  check("with an id", Boolean(created?.id));

  sheets.activateSheet(created.id);

  check(
    "and it becomes the active sheet",
    sheets.activeSheet?.()?.id === created.id,
    `${sheets.activeSheet?.()?.id} vs ${created.id}`,
  );

  check(
    "it starts with a writable picture",
    typeof created?.source?.source === "string" &&
      created.source.source.includes(`${BS}begin{tikzpicture}`),
    JSON.stringify(created?.source),
  );

  const model = window.enggDrawingState;
  const state = window.enggDrawing?.state;

  if (model && state) {
    const before = (state.objects || []).length;
    const object = model.geometryFactories.line({ x: 0, y: 0 }, { x: 80, y: 0 }, {});

    model.addObject(state, object);
    model.commitDrawingChange(state, model.snapshotDrawing(state));

    await wait(80);

    check(
      "an object drawn on it reaches the model",
      (state.objects || []).length === before + 1,
      `${(state.objects || []).length} vs ${before}`,
    );

    const manager = window.enggActiveSourceManager
      ? window.enggActiveSourceManager()
      : null;

    await wait(150);

    if (manager && typeof manager.getSource === "function") {
      check(
        "and the live picture carries the generated LaTeX",
        manager.getSource().includes("--"),
        manager.getSource().slice(0, 120),
      );
    }
  } else {
    check("the drawing model is reachable", false, "enggDrawingState missing");
  }

  console.log("\n  the sheet keeps its LaTeX when another is opened\n");

  const other = sheets.createSheet({ name: "Another sheet" });

  sheets.activateSheet(other.id);

  await wait(80);

  check(
    "the first sheet kept the code for what was drawn on it",
    /--/.test(created?.source?.source || ""),
    (created?.source?.source || "").slice(0, 200),
  );

  check(
    "and the workspace is on the sheet that was opened",
    sheets.activeSheet?.()?.id === other.id,
  );

  console.log(`\n  ${pass} passed, ${fail} failed\n`);

  /* The application leaves timers running; this test is finished. */
  process.exit(fail ? 1 : 0);
}

run().catch((caught) => {
  console.log(`  the workflow threw: ${caught.message}`);
  process.exitCode = 1;
});
