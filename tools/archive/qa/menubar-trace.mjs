/*
 * Trace the order of the events a single click on a second menu label
 * produces, by instrumenting the live bar.
 */
export default async function run(page) {
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    window.__trace = [];
    const log = (what) => window.__trace.push(what);

    document.addEventListener(
      "pointerdown",
      (e) =>
        log("pointerdown " + (e.target.dataset?.menuId || e.target.tagName)),
      true,
    );
    document.addEventListener(
      "pointerenter",
      (e) =>
        log("pointerenter " + (e.target.dataset?.menuId || e.target.tagName)),
      true,
    );
    document.addEventListener(
      "click",
      (e) => log("click " + (e.target.dataset?.menuId || e.target.tagName)),
      true,
    );
  });

  await page.locator('.datum-menu-label[data-menu-id="file"]').click();
  await page.waitForTimeout(150);
  await page.evaluate(() => window.__trace.push("--- now click Edit ---"));

  await page.locator('.datum-menu-label[data-menu-id="edit"]').click();
  await page.waitForTimeout(250);

  return await page.evaluate(() => ({
    trace: window.__trace,
    editPanel: document.querySelectorAll(".datum-menu-panel-edit").length,
  }));
}
