export default async function run(page) {
  await page.waitForSelector(".drawing-category", { timeout: 120000 });

  /* Mark this module instance before the app uses its own. */
  const marker = await page.evaluate(async () => {
    const mod = await import("/src/features/workspace/math/math-sketch-editor.js");

    mod.__instanceMarker = "from-page";

    return {
      marker: mod.__instanceMarker,
      isDefault: typeof mod.default,
      defaultKeys: Object.keys(mod.default || {}),
    };
  });

  await page.getByRole("button", { name: "MATH / ANALYSIS", exact: true }).click();
  await page.waitForSelector('#drawingToolList [data-tool-id="math-plot"]', { timeout: 30000 });
  await page.locator('#drawingToolList [data-tool-id="math-plot"]').first().click();
  await page.waitForTimeout(400);
  await page.locator('.drawing-coordinate-submenu [data-submenu-id="sketch"]').first().click();
  await page.waitForTimeout(1800);

  const after = await page.evaluate(() => {
    const dialog = document.querySelector(".drawing-graph-sketch");

    return {
      hook: dialog ? typeof dialog.__datumSketch : null,
      htmlLength: dialog ? dialog.innerHTML.length : 0,
      hasApp: Boolean(dialog?.querySelector("#drawingToolList")),
    };
  });

  return { marker, after };
}
