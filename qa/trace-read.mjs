export default async function run(page) {
  await page.waitForSelector(".drawing-category", { timeout: 120000 });

  const before = await page.evaluate(() => ({
    trace: globalThis.__sketchTrace || null,
    opens: globalThis.__sketchOpens ?? null,
    scripts: [...document.querySelectorAll("script[type=module]")].map((s) => s.src),
  }));

  await page.getByRole("button", { name: "MATH / ANALYSIS", exact: true }).click();
  await page.waitForSelector('#drawingToolList [data-tool-id="math-plot"]', { timeout: 30000 });
  await page.locator('#drawingToolList [data-tool-id="math-plot"]').first().click();
  await page.waitForTimeout(400);
  await page.locator('.drawing-coordinate-submenu [data-submenu-id="sketch"]').first().click();
  await page.waitForTimeout(1500);

  const after = await page.evaluate(() => ({
    trace: globalThis.__sketchTrace || null,
    opens: globalThis.__sketchOpens ?? null,
    hook: typeof document.querySelector(".drawing-graph-sketch")?.__datumSketch,
  }));

  return { before, after };
}
