/*
 * ========================================================
 * ACCEPTANCE TEST - INSERT REFERENCE MUST NOT TRAP THE USER
 * ========================================================
 *
 * Inserting a reference must be an ordinary action inside the workspace: the
 * figure appears in the solution, and the user can still switch tabs, reach the
 * drawing, and come back. Nothing about it may take over the screen or make the
 * workspace unusable.
 *
 * A reference that cannot be drawn must be CONTAINED - the rest of the solution
 * still renders, and the failure is reported rather than freezing the editor.
 */

export default async function run(page) {
  const out = { steps: [] };
  const log = (name, value) => out.steps.push({ name, value });

  await page.waitForFunction(() => typeof window.datum === "object", null, {
    timeout: 20000,
  });

  await page.evaluate(async () => {
    if (typeof window.enggDrawing !== "object") {
      const mod = await import("/src/app/automation-hooks.js");
      mod.installAutomationHooks();
    }

    window.__qaAlerts = [];
    window.alert = (message) => window.__qaAlerts.push(String(message));
  });

  /* ---------------------------------------------------------------- */
  /* 1. Insert a reference from the written-solution side.              */
  /* ---------------------------------------------------------------- */

  const inserted = await page.evaluate(async () => {
    const code = document.getElementById("writingCode");
    const select = document.getElementById("referenceSheetSelect");

    if (!code || !select) {
      return { error: "the written-solution editor is not present" };
    }

    /* A sheet must exist to refer to; the workspace has one by default. */
    const sheetId = window.enggDrawingSheets.activeSheetId();

    select.value = sheetId;
    select.dispatchEvent(new Event("change", { bubbles: true }));

    code.value = "The beam is shown below.\n";

    document.getElementById("referenceInsert").click();

    await new Promise((r) => setTimeout(r, 800));

    const output = document.getElementById("writingOutput");

    return {
      tokenWritten: code.value.includes("[DRAWING_REFERENCE:"),
      hasFigure: Boolean(
        output.querySelector(".drawing-reference-figure, .drawing-reference-empty"),
      ),
      outputLength: (output.textContent || "").length,
    };
  });

  log("inserted", inserted);

  /* ---------------------------------------------------------------- */
  /* 2. The workspace is still usable: both tabs can be reached.         */
  /* ---------------------------------------------------------------- */

  const switchable = await page.evaluate(async () => {
    const drawingTab = [...document.querySelectorAll(".tab")].find((t) =>
      /engineering drawing/i.test(t.textContent),
    );

    const solutionTab = [...document.querySelectorAll(".tab")].find((t) =>
      /written solution/i.test(t.textContent),
    );

    drawingTab.click();
    await new Promise((r) => setTimeout(r, 500));

    const drawingVisible = Boolean(
      document.querySelector("#drawing.active"),
    );

    solutionTab.click();
    await new Promise((r) => setTimeout(r, 500));

    const solutionVisible = Boolean(
      document.querySelector("#writing.active"),
    );

    return {
      drawingVisible,
      solutionVisible,
      /* No full-screen overlay should be present. */
      overlays: document.querySelectorAll(
        ".engg-dialog-backdrop, [style*='position: fixed'][style*='inset']",
      ).length,
    };
  });

  log("switchable", switchable);

  /* ---------------------------------------------------------------- */
  /* 3. A reference to a sheet that cannot be drawn is CONTAINED.        */
  /* ---------------------------------------------------------------- */

  const brokenReference = await page.evaluate(async () => {
    const code = document.getElementById("writingCode");

    /* A reference naming a sheet id that does not exist. */
    code.value =
      "Before.\n[DRAWING_REFERENCE:sheet_that_does_not_exist]\nAfter.\n";

    code.dispatchEvent(new Event("input", { bubbles: true }));

    await new Promise((r) => setTimeout(r, 800));

    const output = document.getElementById("writingOutput");

    return {
      stillRenders: (output.textContent || "").includes("Before"),
      reported: (window.enggErrorLog.recent() || []).length,
      pageStillThere: Boolean(document.getElementById("writingCode")),
    };
  });

  log("brokenReference", brokenReference);

  return out;
}