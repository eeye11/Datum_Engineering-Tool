export default async function run(page) {
  await page.waitForSelector(".drawing-category", { timeout: 120000 });

  /* The dialog the app opens, by the toolbar route. */
  await page.getByRole("button", { name: "MATH / ANALYSIS", exact: true }).click();
  await page.waitForSelector('#drawingToolList [data-tool-id="math-plot"]', { timeout: 30000 });
  await page.locator('#drawingToolList [data-tool-id="math-plot"]').first().click();
  await page.waitForTimeout(400);

  /* Record the DOM node the APP's open produces. */
  await page.evaluate(() => {
    window.__firstDialog = null;

    const observer = new MutationObserver(() => {
      const dialog = document.querySelector(".drawing-graph-sketch");

      if (dialog && !window.__firstDialog) {
        window.__firstDialog = dialog;
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  });

  await page.locator('.drawing-coordinate-submenu [data-submenu-id="sketch"]').first().click();
  await page.waitForTimeout(1500);

  return page.evaluate(async () => {
    const appDialog = window.__firstDialog;
    const nowLive = document.querySelector(".drawing-graph-sketch");

    const mod = await import("/src/features/workspace/math/math-sketch-editor.js");
    const mine = mod.openSketchEditor(null, { onApply: () => {}, onCancel: () => {} });

    return {
      appDialogSameAsLive: appDialog === nowLive,
      appHook: appDialog ? typeof appDialog.__datumSketch : null,
      mineHook: mine ? typeof mine.__datumSketch : null,
      appHtml: appDialog ? appDialog.innerHTML.length : 0,
      mineHtml: mine ? mine.innerHTML.length : 0,
      appTitle: appDialog?.querySelector(".sketch-app-title")?.textContent,
      mineTitle: mine?.querySelector(".sketch-app-title")?.textContent,
      appHasBounds: Boolean(appDialog?.querySelector("[data-sketch-bounds-mode]")),
      mineHasBounds: Boolean(mine?.querySelector("[data-sketch-bounds-mode]")),
    };
  });
}
