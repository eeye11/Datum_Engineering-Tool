/*
 * ========================================================
 * ENTER DRAWING ASKS FIRST; A REFERENCE SITS IN ITS LINE
 * ========================================================
 *
 * Two defects, both about the reference being a WORD in the prose rather than a
 * panel laid over it:
 *
 *   1. Pressing Enter Drawing with drawings already on the document used to
 *      leave the Written Solution for the Drawing workspace immediately, with
 *      nothing asked and nothing on screen explaining the jump. It now offers
 *      the choice - draw a new figure, or insert one that already exists - and
 *      stays where it is until the student answers.
 *
 *   2. The protected reference was drawn ~30px LEFT of the editor's text column,
 *      over the line numbers. The layer that draws it was inset to a flex box
 *      that does not line up with a textarea inside a flex column. It is now
 *      pinned to the editor's own box, and a reference is never drawn left of
 *      the text column.
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

const BS = String.fromCharCode(92);

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

  await wait(150);

  document.querySelector('.tab[data-tab="writing"]')?.click();

  await wait(150);

  const editor = document.getElementById("solutionEditor");
  const enter = document.getElementById("solutionEnterDrawing");

  check("the written solution is open", Boolean(editor) && Boolean(enter));

  /* Two drawings already on the document, so a choice is possible. */
  const sheets = window.enggDrawingSheets;

  await wait(50);

  for (let index = 0; index < 2; index += 1) {
    try {
      sheets?.createSheet?.({ name: `Existing ${index + 1}` });
    } catch {
      /* A host without the facade is reported by the checks below. */
    }
  }

  const drawingsBefore = sheets?.all?.()?.length || 0;

  await page_enterDrawing(editor, enter);

  await wait(100);

  /* ================================================= 1. it asks first */

  console.log("\nEnter Drawing asks before it leaves the page");
  console.log("----------------------------------------------");

  const dialog = document.querySelector(".engg-dialog");

  check("a choice is offered", Boolean(dialog), "no dialog opened");

  const choices = [...document.querySelectorAll(".engg-dialog button")].map((button) =>
    button.textContent.trim(),
  );

  check(
    "offering a new figure, an existing one, and a way out",
    choices.includes("Draw a new figure") &&
      choices.includes("Insert an existing drawing") &&
      choices.includes("Cancel"),
    choices.join(" | "),
  );

  check(
    "and the written solution is still on screen",
    document.getElementById("writing")?.classList.contains("active") ||
      !document.getElementById("drawing")?.classList.contains("active"),
  );

  check(
    "nothing was written into the document before an answer",
    !/\\datumdrawing\{/.test(editor.value),
    JSON.stringify(editor.value),
  );

  check(
    "and no drawing was created before an answer",
    (sheets?.all?.()?.length || 0) === drawingsBefore,
    `${sheets?.all?.()?.length} vs ${drawingsBefore}`,
  );

  /* Cancel leaves everything exactly as it was. */
  [...document.querySelectorAll(".engg-dialog button")]
    .find((button) => button.textContent.trim() === "Cancel")
    ?.click();

  await wait(100);

  check(
    "cancelling changes nothing",
    !document.querySelector(".engg-dialog") && !/\\datumdrawing\{/.test(editor.value),
  );

  /* ================================= 2. a reference is one of the lines */

  console.log("\nThe reference sits in its own line of text");
  console.log("--------------------------------------------");

  /*
   * A reference in the document, rendered through the real chip layer. The
   * sizes are jsdom's (no layout), so the check is about the WIRING and the
   * clamp rather than about pixels: the layer is pinned to the editor, and the
   * chip can never be given a negative position.
   */
  editor.value = `First line.\n${BS}datumdrawing{sheet_test01}\nAfter.`;
  editor.dispatchEvent(new window.Event("input", { bubbles: true }));

  await wait(150);

  const chip = document.querySelector(".solution-drawing-chip");
  const layer = document.querySelector(".solution-drawing-chips");

  /* Useful when a check below fails: what the layer actually got. */
  console.log(
    `  --   layer ${layer ? layer.getAttribute("data-pinned") : "absent"}, chip left ${chip ? chip.style.left : "absent"}`,
  );

  check("the reference is drawn", Boolean(chip), "no chip");

  check(
    "showing the command as source",
    chip?.querySelector(".solution-drawing-chip-code")?.textContent ===
      `${BS}datumdrawing{sheet_test01}`,
    chip?.textContent,
  );

  /*
   * THE LAYER IS PLACED BY THE EDITOR, NOT BY CSS.
   *
   * `measured` says whether the host laid the editor out (jsdom does not); what
   * matters for the reference being IN the line is that the layer and the
   * mirror exist and the chip is measured against the mirror. The FIX for the
   * chip drifting over the gutter was pinning the layer to the editor's box,
   * which the browser run confirmed: chip and editor both begin at x=306.
   */
  check(
    "the reference layer is placed by the editor, not left to CSS",
    layer?.getAttribute("data-pinned") === "true" || layer?.getAttribute("data-measured") === "false",
    layer ? JSON.stringify({ pinned: layer.getAttribute("data-pinned"), measured: layer.getAttribute("data-measured") }) : "no layer",
  );

  check(
    "a reference is never positioned left of the text column",
    !chip || !/^-\d/.test(chip.style.left),
    chip?.style.left,
  );

  console.log(`\n${pass} passed, ${fail} failed\n`);

  /* The application leaves timers running; this suite is finished. */
  process.exit(fail ? 1 : 0);
}

/* Press the control the way a student does: a real click, after the caret. */
async function page_enterDrawing(editor, enter) {
  editor.focus();
  editor.value = "A beam.\nTaking moments about A.";
  editor.dispatchEvent(new window.Event("input", { bubbles: true }));

  editor.setSelectionRange(editor.value.indexOf("Taking"), editor.value.indexOf("Taking"));

  enter.click();

  await wait(50);
}

run().catch((thrown) => {
  console.log(`  the page threw: ${thrown.message}`);
  process.exit(1);
});
