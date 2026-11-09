export default async function run(page) {
  await page.waitForSelector(".drawing-category", { timeout: 120000 });
  await page.getByRole("button", { name: "MATH / ANALYSIS", exact: true }).click();
  await page.waitForSelector('#drawingToolList [data-tool-id="math-plot"]', { timeout: 30000 });
  await page.locator('#drawingToolList [data-tool-id="math-plot"]').first().click();
  await page.waitForTimeout(400);
  await page.locator('.drawing-coordinate-submenu [data-submenu-id="sketch"]').first().click();
  await page.waitForTimeout(1800);

  return page.evaluate(() => ({
    opens: globalThis.__sketchOpens || 0,
    trace: globalThis.__sketchOpenTrace || [],
    hook: typeof document.querySelector(".drawing-graph-sketch")?.__datumSketch,
  }));
}
