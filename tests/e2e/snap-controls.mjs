/*
 * Drives the Grid and Snap controls in the real UI and reports the resulting
 * state. This is the browser half of the acceptance list: the unit tests prove
 * the RESOLVER obeys the four-state table, and this proves the SWITCHES write
 * the fields the resolver reads.
 */
export default async function run(page, ui) {
  const report = { steps: [] };

  const readModel = () =>
    page.evaluate(() => {
      const s = window.enggDrawingStateLive;
      if (!s) return { error: "model not on window" };
      return {
        gridVisible: s.grid?.visible,
        gridSnap: s.grid?.snapToGrid,
        gridSpacing: s.grid?.spacing,
        objectSnap: s.objectSnap?.enabled,
        snapEnabled: s.snap?.enabled,
      };
    });

  const pressed = (id) =>
    page.evaluate(
      (i) => document.getElementById(i)?.getAttribute("aria-pressed"),
      id,
    );

  const step = async (label) => {
    report.steps.push({
      label,
      model: await readModel(),
      gridPressed: await pressed("drawingGridToggle"),
      snapPressed: await pressed("drawingSnapToggle"),
    });
  };

  /*
   * THE DRAWING EDITOR MOUNTS WHEN ITS TAB IS OPENED, so the app's automation
   * hooks - and the model they expose - do not exist until this happens. The
   * Written Solution workspace is the default view, which is why reading the
   * model before switching reports `undefined` rather than a wrong value.
   */
  await page.evaluate(() => {
    const tab = document.querySelector('.tab[data-tab="drawing"]');
    if (tab) tab.click();
  });
  await page.waitForTimeout(900);

  report.hooksPresent = await page.evaluate(
    () => typeof window.enggDrawingStateLive !== "undefined",
  );

  await step("drawing workspace open");

  const click = async (id) => {
    await page.evaluate((i) => document.getElementById(i)?.click(), id);
    await page.waitForTimeout(200);
  };

  /* ACCEPTANCE 1: hide the grid -> grid snap must go off with it. */
  await click("drawingGridToggle");
  await step("grid hidden (expect gridSnap false)");

  /* ACCEPTANCE 2: show the grid -> grid snap must come back on. */
  await click("drawingGridToggle");
  await step("grid shown (expect gridSnap true)");

  /* ACCEPTANCE 3/5: general snap off -> grid snap must stay on. */
  await click("drawingSnapToggle");
  await step("general snap OFF (expect objectSnap false, gridSnap true)");

  await click("drawingSnapToggle");
  await step("general snap ON again");

  /* ACCEPTANCE 14: rapid toggling must not desynchronise. */
  for (let i = 0; i < 7; i += 1) {
    await click("drawingGridToggle");
  }
  await step("after 7 rapid grid toggles (odd count => hidden)");

  /* Leave the app with the grid shown. */
  const final = await readModel();
  if (!final.gridVisible) {
    await click("drawingGridToggle");
  }
  report.final = await readModel();

  return report;
}