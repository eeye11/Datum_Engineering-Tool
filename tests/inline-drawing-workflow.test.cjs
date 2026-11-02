/*
 * ========================================================
 * ENTER DRAWING, IN THE RUNNING APPLICATION
 * ========================================================
 *
 * The whole chain, through the real page: a caret in the written solution, the
 * Enter Drawing control, a drawing created and opened in the Drawing workspace,
 * the protected reference in the source, and the way back.
 *
 * This is the defect the workflow exists to fix: the control had no handler and
 * the insertion path wrote a drawing's complete TikZ into the answer, so there
 * was nothing to re-enter and nothing that could stay in step with a drawing.
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

const until = async (predicate, message, timeout = 2500) => {
  const started = Date.now();

  while (Date.now() - started < timeout) {
    if (predicate()) return true;

    await wait(25);
  }

  throw new Error(message);
};

void until;

const BS = String.fromCharCode(92);

async function run() {
  const { window, document, error } = bootApp();

  if (error) {
    console.log(`  the application did not boot: ${error.message}`);
    process.exit(1);
  }

  /* Compilation is stubbed: what is under test is the workflow, not TeX. */
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
          svg: `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><g data-render-index="${requests.length}"/></svg>`,
        }),
      };
    }

    return { ok: true, status: 200, json: async () => ({}) };
  };

  const editor = document.getElementById("solutionEditor");
  const enter = document.getElementById("solutionEnterDrawing");

  await wait(50);

  console.log("\n  the control exists, and is wired\n");

  check("the Enter Drawing control is in the toolbar", Boolean(enter));
  check("and it says what it does", enter?.textContent.trim() === "Enter Drawing");

  const sheets = window.enggDrawingSheets;

  check("the sheet controller is reachable", Boolean(sheets));

  const sheetCountBefore = sheets.all().length;

  editor.value = [
    `${BS}section{Question 1}`,
    "The free body diagram is shown below.",
    "",
    "Taking moments about A:",
    `${BS}[ ${BS}sum M_A = 0 ${BS}]`,
    "",
  ].join("\n");

  editor.dispatchEvent(new window.Event("input", { bubbles: true }));

  /* The caret goes where the drawing belongs: before "Taking moments". */
  const caret = editor.value.indexOf("Taking moments");

  editor.focus();
  editor.setSelectionRange(caret, caret);

  enter.click();

  await wait(50);

  /*
   * ENTER DRAWING ASKS FIRST. It offers a new figure or an existing one, so the
   * workflow is driven through that answer - the same click a student makes.
   */
  const chooser = document.querySelector(".engg-dialog");

  [...(chooser?.querySelectorAll("button") || [])]
    .find((button) => button.textContent.trim() === "Draw a new figure")
    ?.click();

  await wait(150);

  console.log("\n  a drawing is created, placed, and opened\n");

  const source = editor.value;

  check(
    "one reference is written at the cursor",
    (source.match(/\\datumdrawing\{sheet_[A-Za-z0-9]+\}/g) || []).length === 1,
    source,
  );

  const reference = source.match(/\\datumdrawing\{(sheet_[A-Za-z0-9]+)\}/);

  check("and it names a drawing", Boolean(reference), source);
  check(
    "at the position the cursor was at - before the sentence that follows it",
    source.indexOf("\\datumdrawing") < source.indexOf("Taking moments"),
    source,
  );

  check(
    "and the prose either side is untouched",
    source.includes("The free body diagram is shown below.") &&
      source.includes(`${BS}[ ${BS}sum M_A = 0 ${BS}]`),
  );

  check(
    "no drawing code is in the written solution",
    !/tikzpicture|DAETUM_OBJECT/.test(source),
  );

  check("one drawing was created", sheets.all().length === sheetCountBefore + 1);

  const created = reference ? sheets.sheetById(reference[1]) : null;

  check("with the id the reference names", Boolean(created), reference?.[1]);

  check(
    "the Drawing workspace is showing",
    document.getElementById("drawing").classList.contains("active"),
  );

  check(
    "and it is editing THAT drawing",
    sheets.activeSheet?.()?.id === created?.id,
    `${sheets.activeSheet?.()?.id} vs ${created?.id}`,
  );

  console.log("\n  the canvas is real, and so is what is drawn on it\n");

  /*
   * A DRAWING THAT CAN BE DRAWN ON.
   *
   * Enter Drawing creates a sheet, and that sheet arrives with a writable empty
   * picture rather than nothing - which is what the canvas and the Source tab
   * both open on. The object is then added through the model, exactly as a tool
   * adds one, and committed: that is the path the canvas and the generated
   * source both read.
   */
  check(
    "the drawing starts with an empty, writable picture",
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

    await wait(50);

    check(
      "an object drawn on it reaches the drawing",
      (state.objects || []).length === before + 1,
      `${(state.objects || []).length} vs ${before}`,
    );

    const manager = window.enggActiveSourceManager
      ? window.enggActiveSourceManager()
      : null;

    await wait(120);

    if (manager && typeof manager.getSource === "function") {
      check(
        "the drawing's live picture carries the generated LaTeX",
        manager.getSource().includes("--"),
        manager.getSource().slice(0, 120),
      );
    }
  } else {
    check("the drawing model is reachable", false, "enggDrawingState missing");
  }

  console.log("\n  the reference is protected in the Source panel\n");

  const chips = () => [...document.querySelectorAll(".solution-drawing-chip")];

  await wait(50);

  check("it is drawn as one protected element", chips().length === 1);
  check(
    "showing the inclusion command itself",
    chips()[0]?.querySelector(".solution-drawing-chip-code")?.textContent ===
      reference?.[0],
    chips()[0]?.querySelector(".solution-drawing-chip-code")?.textContent,
  );
  check(
    "with no padlock - the reference reads as one of the lines of text",
    !chips()[0]?.querySelector(".solution-drawing-chip-lock"),
  );

  /* A click selects - and does not open anything. */
  document.querySelector('.tab[data-tab="writing"]').click();

  await wait(20);

  chips()[0].dispatchEvent(new window.Event("pointerdown", { bubbles: true }));

  await wait(20);

  check(
    "clicking it selects the whole reference",
    chips()[0]?.classList.contains("selected"),
  );

  check(
    "and the Edit Drawing action appears beside it, compactly",
    chips()[0]?.querySelector(".solution-drawing-chip-edit")?.textContent ===
      "Edit Drawing",
  );

  check(
    "selecting did not change the document",
    editor.value === source,
  );

  /* An edit through the command is refused. */
  const inside = source.indexOf(reference[0]) + 5;

  editor.value = source.slice(0, inside) + "X" + source.slice(inside);
  editor.dispatchEvent(new window.Event("input", { bubbles: true }));

  await wait(20);

  check(
    "typing inside the command is refused, and the source is put back",
    editor.value === source,
    editor.value,
  );

  check(
    "and the refusal says what to do instead",
    /protected/i.test(document.getElementById("solutionSaveStatus")?.textContent || ""),
    document.getElementById("solutionSaveStatus")?.textContent,
  );

  /* Ordinary text still edits. */
  editor.value = `${source}\n\nA closing remark.`;
  editor.dispatchEvent(new window.Event("input", { bubbles: true }));

  await wait(20);

  check(
    "ordinary text around it is still editable",
    editor.value.includes("A closing remark.") && editor.value.includes(reference[0]),
  );

  console.log("\n  Edit Drawing reopens the same drawing\n");

  document.querySelector('.tab[data-tab="drawing"]').click();

  await wait(20);

  /* Another drawing is made active by hand, to prove the wrong one is not used. */

  const other = sheets.createSheet({ name: "Some other drawing" });

  sheets.activateSheet(other.id);

  document.querySelector('.tab[data-tab="writing"]').click();

  await wait(20);

  const chipsNow = chips();

  chipsNow[0].dispatchEvent(new window.Event("pointerdown", { bubbles: true }));

  await wait(10);

  chipsNow[0]
    .querySelector(".solution-drawing-chip-edit")
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  await wait(30);

  check(
    "the workspace opens again on Enter Drawing's target",
    sheets.activeSheet?.()?.id === created?.id,
    `${sheets.activeSheet?.()?.id} vs ${created?.id}`,
  );

  check(
    "and not on whichever drawing was open last",
    sheets.activeSheet?.()?.id !== other.id,
  );

  /*
   * THE SHEET RECEIVES ITS SOURCE WHEN ANOTHER IS OPENED. Leaving a sheet is
   * when the live picture is written back to it, so this is where the drawing
   * the student started acquires the code for what they drew.
   */
  check(
    "the drawing's sheet kept the LaTeX for what was drawn on it",
    /--/.test(created?.source?.source || ""),
    (created?.source?.source || "").slice(0, 200),
  );

  console.log("\n  back to the solution, where the student left it\n");

  document.getElementById("drawingReturnToSolution").click();

  await wait(30);

  check(
    "the written solution is showing again",
    document.getElementById("writing").classList.contains("active"),
  );

  check(
    "with the reference it came from selected",
    chips()[0]?.classList.contains("selected"),
  );

  check(
    "and still a single element",
    chips().length === 1,
    String(chips().length),
  );

  check(
    "and the document is unchanged by the round trip",
    editor.value.includes(reference[0]) && editor.value.includes("A closing remark."),
  );

  console.log("\n  the reference resolves in the preview\n");

  const figure = document.querySelector(".linked-drawing-figure");

  check("the preview draws it as a figure", Boolean(figure));
  check(
    "identified by the block, so a click can select its reference",
    figure?.dataset.blockId === `dwg${reference?.[1]}`,
    figure?.dataset.blockId,
  );

  console.log(`\n  ${pass} passed, ${fail} failed\n`);

  /* The application leaves timers running; this test is finished. */
  process.exit(fail ? 1 : 0);
}

run().catch((caught) => {
  console.log(`  the workflow threw: ${caught.message}`);
  process.exitCode = 1;
});
