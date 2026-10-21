/* eslint-disable no-console */
/*
 * ========================================================
 * ENTER DRAWING, IN THE RUNNING APPLICATION
 * ========================================================
 *
 * Pressing Enter Drawing in the Written Solution asks WHICH drawing to place,
 * and only then does anything:
 *
 *   1. the choice dialog opens and names the drawings on the document;
 *   2. nothing is created and nothing is written until an answer is given;
 *   3. "Draw a new figure" creates a sheet and writes a protected REFERENCE at
 *      the caret - never a copy of the drawing's TikZ;
 *   4. cancelling leaves the document exactly as it was.
 *
 * WHY A REFERENCE AND NOT THE CODE. This suite used to describe a picker that
 * copied a sheet's complete `tikzpicture` into the answer. That made a second
 * copy of the drawing, so every later edit to the drawing was invisible to the
 * written solution. A reference keeps ONE drawing in one place, and
 * `inline-drawing-workflow.test.cjs` follows it all the way to the canvas.
 *
 * The page is booted for real, and driven through the control's own click.
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

/* Compilation is stubbed: the workflow is under test, not the TeX engine. */
window.fetch = globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    success: true,
    svg: '<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>',
  }),
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* The choice dialog DAETUM opens - the same one every "which one?" uses. */
function openDialog() {
  return document.querySelector(".engg-dialog");
}

function dialogButtons(dialog) {
  return [...(dialog?.querySelectorAll("button") || [])];
}

const status = () => document.getElementById("solutionSaveStatus")?.textContent || "";

const REFERENCE = /\\datumdrawing\{(sheet_[A-Za-z0-9]+)\}/;

/* The same pattern, global, for "how many, and which" - `matchAll` needs it. */
const ALL_REFERENCES = new RegExp(REFERENCE.source, "g");

(async () => {
  await whenReady();
  await wait(400);

  const loc = require(path.join(__dirname, "helpers", "source-path.cjs")).locate;

  const tabs = require(loc("panel-tabs.js"));
  const { enggDrawingSheets } = require(loc("sheet-controller.js"));

  const enter = document.getElementById("solutionEnterDrawing");
  const editor = document.getElementById("solutionEditor");

  tabs.setActivePanelTab("writing");
  await wait(400);

  console.log("\nEnter Drawing asks before it leaves the page");
  console.log("------------------------------------------------");

  check("the button exists in the toolbar", Boolean(enter));

  /*
   * EVERY DOCUMENT OPENS WITH ONE SHEET, so there is always something to
   * choose from - which is why the button asks rather than assuming. The
   * contract under test is that asking changes nothing.
   */
  const sheetsBefore = enggDrawingSheets.all().length;

  enter.click();
  await wait(600);

  const firstDialog = openDialog();

  check("a choice is offered", Boolean(firstDialog), "no dialog appeared");
  check(
    "nothing was created before an answer",
    enggDrawingSheets.all().length === sheetsBefore,
    `${sheetsBefore} -> ${enggDrawingSheets.all().length}`,
  );
  check(
    "and nothing was written before an answer",
    editor.value.trim() === "",
    JSON.stringify(editor.value),
  );

  /* Dismiss it, so the next section starts from a clean page. */
  dialogButtons(firstDialog)
    .find((button) => button.textContent.trim() === "Cancel")
    ?.click();

  await wait(300);

  /* ============================== 1. with drawings, it asks ============ */

  console.log("\nWith drawings already on the document, it asks first");
  console.log("-----------------------------------------------------");

  const answers = "My answer.\n\n";

  editor.value = answers;
  editor.dispatchEvent(new window.Event("input", { bubbles: true }));
  editor.setSelectionRange(editor.value.length, editor.value.length);

  await wait(200);

  const drawingsBefore = enggDrawingSheets.all().length;

  enter.click();
  await wait(500);

  const dialog = openDialog();

  check("a choice is offered", Boolean(dialog), "no dialog appeared");

  const labels = dialogButtons(dialog).map((button) => button.textContent.trim());

  check(
    "offering a new figure, an existing drawing and a way out",
    labels.includes("Draw a new figure") &&
      labels.includes("Insert an existing drawing") &&
      labels.includes("Cancel"),
    labels.join(" | "),
  );

  check(
    "nothing is created before an answer",
    enggDrawingSheets.all().length === drawingsBefore,
    `${drawingsBefore} -> ${enggDrawingSheets.all().length}`,
  );

  check(
    "and nothing is written before an answer",
    editor.value === answers,
    JSON.stringify(editor.value),
  );

  /* ==================================== 2. cancel changes nothing ===== */

  console.log("\nCancelling leaves the document alone");
  console.log("-------------------------------------");

  dialogButtons(dialog)
    .find((button) => button.textContent.trim() === "Cancel")
    ?.click();

  await wait(300);

  check("the dialog closes", !openDialog());
  check("the source is untouched", editor.value === answers, JSON.stringify(editor.value));
  check(
    "and no drawing was made",
    enggDrawingSheets.all().length === drawingsBefore,
    `${drawingsBefore} -> ${enggDrawingSheets.all().length}`,
  );

  /* ============================ 3. a new figure is a reference ======== */

  console.log("\n\"Draw a new figure\" places a reference at the cursor");
  console.log("----------------------------------------------------");

  enter.click();
  await wait(500);

  dialogButtons(openDialog())
    .find((button) => button.textContent.trim() === "Draw a new figure")
    ?.click();

  await wait(800);

  const value = editor.value;
  const created = value.match(REFERENCE);

  check("a drawing was created", enggDrawingSheets.all().length === drawingsBefore + 1);
  check("a reference was written", Boolean(created), JSON.stringify(value));
  check(
    "after the student's own text, at the caret",
    value.startsWith(answers) && value.indexOf("\\datumdrawing") >= answers.length,
    JSON.stringify(value),
  );
  check(
    "the reference names the drawing that was created",
    Boolean(created) && Boolean(enggDrawingSheets.sheetById?.(created[1])),
    created?.[1],
  );

  check(
    "the reference is the whole inclusion - no drawing code",
    value.trim() === `${answers.trimEnd()}\n\n\\datumdrawing{${created?.[1]}}`.trim(),
    JSON.stringify(value),
  );

  check(
    "no document wrapper is placed",
    !/\\documentclass|\\usepackage|tikzpicture/.test(value),
    value,
  );

  check("the status says what happened", /drawing|placed|created/i.test(status()), status());

  /* ============================ 4. an existing drawing is offered ===== */

  console.log("\nAn existing drawing can be inserted instead");
  console.log("--------------------------------------------");

  editor.value = "Second answer.\n";
  editor.dispatchEvent(new window.Event("input", { bubbles: true }));
  editor.setSelectionRange(editor.value.length, editor.value.length);

  await wait(200);

  check(
    "a replacement that deletes the reference is refused - it is protected",
    editor.value.includes("\\datumdrawing{"),
    JSON.stringify(editor.value),
  );

  /*
   * THE STUDENT'S OWN EDIT. A reference is protected against being typed over,
   * but the text around it is theirs - so the second answer is appended, exactly
   * as typing would.
   */
  editor.value = `${editor.value.trimEnd()}\n\nSecond answer.\n`;
  editor.dispatchEvent(new window.Event("input", { bubbles: true }));
  editor.setSelectionRange(editor.value.length, editor.value.length);

  await wait(200);

  enter.click();
  await wait(500);

  dialogButtons(openDialog())
    .find((button) => button.textContent.trim() === "Insert an existing drawing")
    ?.click();

  await wait(400);

  const list = dialogButtons(openDialog()).map((button) => button.textContent.trim());
  const names = enggDrawingSheets.all().map((sheet) => sheet.name);

  check(
    "the drawings on the document are listed",
    names.length > 0 && names.every((name) => list.includes(name)),
    list.join(" | "),
  );

  check(
    "no second choice creates anything",
    enggDrawingSheets.all().length === drawingsBefore + 1,
  );

  /*
   * PICK A DRAWING THAT IS NOT ALREADY IN THE TEXT.
   *
   * Every document opens with a sheet, and it is empty - so the list offers it
   * alongside the drawing just made. Choosing the one already referenced is
   * refused with "already in the solution" (checked below); choosing an unused
   * one inserts it. Both are real behaviour, and the list gives no other way to
   * ask for either.
   */
  const used = new Set(
    [...editor.value.matchAll(ALL_REFERENCES)].map((match) => match[1]),
  );

  const unused = enggDrawingSheets.all().find((sheet) => !used.has(sheet.id));

  const alreadyIncluded = enggDrawingSheets.all().find((sheet) => used.has(sheet.id));

  check("there is a drawing to insert that is not already in the text", Boolean(unused));

  if (unused && alreadyIncluded) {
    const sameName = enggDrawingSheets
      .all()
      .filter((sheet) => sheet.name === alreadyIncluded.name).length;

    if (sameName === 1) {
      dialogButtons(openDialog())
        .find((button) => button.textContent.trim() === alreadyIncluded.name)
        ?.click();

      await wait(400);

      check(
        "picking a drawing already in the text does not duplicate it",
        (editor.value.match(ALL_REFERENCES) || []).length === used.size,
        JSON.stringify(editor.value),
      );
    } else {
      console.log("  --   two drawings share a name; the duplicate check is skipped");
    }

    enter.click();
    await wait(400);

    dialogButtons(openDialog())
      .find((button) => button.textContent.trim() === "Insert an existing drawing")
      ?.click();

    await wait(400);
  }

  dialogButtons(openDialog())
    .find((button) => button.textContent.trim() === unused?.name)
    ?.click();

  await wait(500);

  check(
    "picking one places its reference at the caret",
    (editor.value.match(ALL_REFERENCES) || []).length === used.size + 1 &&
      editor.value.includes("Second answer."),
    JSON.stringify(editor.value),
  );

  check(
    "and still copies no drawing code",
    !/tikzpicture|DAETUM/i.test(editor.value),
    editor.value,
  );

  console.log(`\n${pass} passed, ${fail} failed`);

  /* The booted application leaves timers running; this suite is finished. */
  setImmediate(() => process.exit(fail ? 1 : 0));
})();
