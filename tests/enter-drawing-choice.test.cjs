/*
 * ========================================================
 * ENGINEERING DRAWING IS THE WHOLE WORKSPACE
 * ========================================================
 *
 * DAETUM used to open on a Written Solution page with a tab strip choosing
 * between it and Engineering Drawing. The written half is gone, so this suite
 * checks the replacement contract:
 *
 *   1. the page opens ON the drawing workspace, with no tab to press;
 *   2. there is no Written Solution section, tab or return control left;
 *   3. the drawing workspace itself is intact - canvas, panels, menu bar;
 *   4. nothing is left behind where the tab strip used to be.
 *
 * The app is booted for real, in jsdom, because the question is what the page
 * does - not what a module returns.
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

async function run() {
  const { window, document, error } = bootApp();

  if (error) {
    console.log(`  the application did not boot: ${error.message}`);
    process.exit(1);
  }

  window.fetch = globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ svg: "<svg></svg>", log: "" }),
    text: async () => "",
  });

  await wait(200);

  console.log("\nThe drawing workspace is the page");
  console.log("---------------------------------");

  check(
    "the drawing section is active on load",
    document.getElementById("drawing")?.classList.contains("active") === true,
    document.getElementById("drawing")?.className,
  );

  check(
    "and it is the only active workspace section",
    document.querySelectorAll(".review-content.active").length === 1,
    [...document.querySelectorAll(".review-content.active")]
      .map((n) => n.id)
      .join(", "),
  );

  console.log("\nWritten Solution is gone");
  console.log("------------------------");

  check(
    "there is no written-solution section",
    document.getElementById("writing") === null,
  );

  check(
    "there is no written-solution editor",
    document.getElementById("solutionEditor") === null,
  );

  check(
    "there is no Enter Drawing control",
    document.getElementById("solutionEnterDrawing") === null,
  );

  check(
    "there is no return-to-solution control",
    document.getElementById("drawingReturnToSolution") === null,
  );

  check(
    "there is no workspace tab strip",
    document.querySelectorAll(".tab[data-tab]").length === 0,
    [...document.querySelectorAll(".tab[data-tab]")]
      .map((n) => n.dataset.tab)
      .join(", "),
  );

  check(
    "and no tab names Written Solution",
    !/Written Solution/.test(document.body.textContent || ""),
  );

  console.log("\nThe drawing workspace is intact");
  console.log("-------------------------------");

  check(
    "the canvas is there",
    Boolean(document.querySelector(".drawing-canvas")),
  );
  check(
    "the menu bar is there",
    Boolean(document.querySelector(".datum-menubar")),
  );
  check(
    "the Objects, Features and Source tabs are there",
    ["objects", "features", "source"].every((tab) =>
      Boolean(
        document.querySelector(
          `[data-panel-tab="${tab}"], [data-tab="${tab}"]`,
        ),
      ),
    ),
  );
  check(
    "the drawing tool list is there",
    Boolean(
      document.getElementById("drawingToolList") ||
      document.querySelector(".drawing-tool-list"),
    ),
  );

  console.log(`\n${pass} passed, ${fail} failed\n`);

  /* The application leaves timers running; this suite is finished. */
  process.exit(fail ? 1 : 0);
}

run().catch((thrown) => {
  console.log(`  the page threw: ${thrown.message}`);
  process.exit(1);
});
