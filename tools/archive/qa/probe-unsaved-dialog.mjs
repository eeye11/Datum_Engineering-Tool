/*
 * NEW-WITH-UNSAVED-CHANGES PROBE
 *
 * Checks the Unsaved Changes dialog itself: its title, its wording, and its
 * three buttons. The dialog must offer Save First / Discard Changes / Cancel,
 * and Discard must actually continue with the requested operation.
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
  });

  const tab = page.getByRole("button", { name: "Engineering Drawing" });
  if (await tab.count()) {
    await tab.first().click();
    await page.waitForTimeout(900);
  }

  /* Draw and commit, so the document is genuinely dirty. */
  const drew = await page.evaluate(() => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;
    const F = ds.geometryFactories;

    const before = ds.snapshotDrawing(st);
    ds.addObject(st, F.line({ x: 0, y: 0 }, { x: 120, y: 0 }, { style: {} }));
    ds.commitDrawingChange(st, before);

    return st.objects.length;
  });

  log("drew", drew);

  /* Click New. The dialog must appear with three explicit buttons. */
  const dialog = await page.evaluate(async () => {
    document.querySelector('[data-file-action="new"]').click();
    await new Promise((r) => setTimeout(r, 400));

    const title = (document.querySelector(".engg-dialog-title") || {})
      .textContent;
    const description = (
      document.querySelector(".engg-dialog-description") || {}
    ).textContent;
    const buttons = [...document.querySelectorAll(".engg-dialog-button")].map(
      (b) => b.textContent.trim(),
    );

    return { title, description, buttons };
  });

  log("dialog", dialog);

  /* Choose "Discard Changes": the drawing must become empty. */
  const afterDiscard = await page.evaluate(async () => {
    const discard = [...document.querySelectorAll(".engg-dialog-button")].find(
      (b) => /discard/i.test(b.textContent),
    );

    if (!discard) {
      return { error: "no discard button", objects: window.enggDrawing.state.objects.length };
    }

    discard.click();
    await new Promise((r) => setTimeout(r, 600));

    return {
      objects: window.enggDrawing.state.objects.length,
      sheetObjects: window.enggDrawingSheets.all()[0].objects.length,
      remainingDialog: Boolean(document.querySelector(".engg-dialog-backdrop")),
    };
  });

  log("afterDiscard", afterDiscard);

  return out;
}
