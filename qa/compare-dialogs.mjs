export default async function run(page) {
  await page.waitForSelector(".drawing-category", { timeout: 120000 });
  await page.getByRole("button", { name: "MATH / ANALYSIS", exact: true }).click();
  await page.waitForSelector('#drawingToolList [data-tool-id="math-plot"]', { timeout: 30000 });
  await page.locator('#drawingToolList [data-tool-id="math-plot"]').first().click();
  await page.waitForTimeout(400);
  await page.locator('.drawing-coordinate-submenu [data-submenu-id="sketch"]').first().click();
  await page.waitForTimeout(1500);

  return page.evaluate(async () => {
    const live = document.querySelector(".drawing-graph-sketch");
    const svg = live.querySelector("[data-sketch-svg]");

    return {
      hook: typeof live.__datumSketch,
      svgViewBox: svg.getAttribute("viewBox"),
      width: svg.getAttribute("width"),
      hasStage: Boolean(live.querySelector("[data-sketch-stage]")),
      hasBounds: Boolean(live.querySelector('[data-sketch-bounds-mode="auto"]')),
      pointCount: live.querySelector("[data-sketch-point-count]")?.textContent,
      status: live.querySelector("[data-sketch-status]")?.textContent,
      /* Both dialogs open at once? */
      count: document.querySelectorAll(".drawing-graph-sketch").length,
      /* The app's own record of the open editor: */
      toolbarActive: document.querySelector('[data-tool-id="math-plot"]')?.className,
    };
  });
}
