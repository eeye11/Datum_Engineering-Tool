export default async function run(page) {
  await page.waitForSelector(".drawing-category", { timeout: 120000 });

  /* Record every module URL the page loads for this editor. */
  await page.evaluate(() => {
    window.__loadedEditorModules = [];

    const originalFetch = window.fetch;

    window.fetch = function (...args) {
      const url = String(args[0]);

      if (/sketch-editor|math-sketch|math-tools/.test(url)) {
        window.__loadedEditorModules.push(url);
      }

      return originalFetch.apply(this, args);
    };
  });

  await page.getByRole("button", { name: "MATH / ANALYSIS", exact: true }).click();
  await page.waitForSelector('#drawingToolList [data-tool-id="math-plot"]', { timeout: 30000 });
  await page.locator('#drawingToolList [data-tool-id="math-plot"]').first().click();
  await page.waitForTimeout(400);
  await page.locator('.drawing-coordinate-submenu [data-submenu-id="sketch"]').first().click();
  await page.waitForTimeout(1800);

  return page.evaluate(() => {
    const dialog = document.querySelector(".drawing-graph-sketch");

    /* Characterise the dialog by the markup it carries. */
    const markup = dialog?.querySelector(".sketch-app")?.outerHTML || "";

    return {
      fetched: window.__loadedEditorModules || [],
      dialogClass: dialog?.className || null,
      hasBoundsSection: markup.includes("data-sketch-bounds-mode"),
      hasToolPoint: Boolean(dialog?.querySelector("[data-sketch-tool-point]")),
      hasInspector: Boolean(dialog?.querySelector("[data-sketch-inspector]")),
      /* The OLD shell's markers: */
      hasOldPreview: Boolean(dialog?.querySelector("[data-sketch-preview]")),
      hasOldHeader: Boolean(dialog?.querySelector(".sketch-editor-header")),
      hook: typeof dialog?.__datumSketch,
    };
  });
}
