export default async function run(page) {
  await page.waitForSelector(".drawing-category", { timeout: 120000 });

  /* Mark THIS module instance before the toolbar uses it. */
  await page.evaluate(async () => {
    const mod = await import("/src/features/workspace/math/math-sketch-editor.js");
    mod.__marked = true;
  });

  await page.getByRole("button", { name: "MATH / ANALYSIS", exact: true }).click();
  await page.waitForSelector('#drawingToolList [data-tool-id="math-plot"]', { timeout: 30000 });
  await page.locator('#drawingToolList [data-tool-id="math-plot"]').first().click();
  await page.waitForTimeout(400);
  await page.locator('.drawing-coordinate-submenu [data-submenu-id="sketch"]').first().click();
  await page.waitForTimeout(1500);

  return page.evaluate(async () => {
    const mod = await import("/src/features/workspace/math/math-sketch-editor.js");

    return {
      marked: Boolean(mod.__marked),
      hook: typeof document.querySelector(".drawing-graph-sketch")?.__datumSketch,
    };
  });
}
