export default async function run(page) {
  await page.waitForSelector(".drawing-category", { timeout: 120000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);

  await page.getByRole("button", { name: "MATH / ANALYSIS", exact: true }).click();
  await page.waitForSelector('#drawingToolList [data-tool-id="math-plot"]', { timeout: 30000 });
  await page.locator('#drawingToolList [data-tool-id="math-plot"]').first().click();
  await page.waitForTimeout(400);
  await page.locator('.drawing-coordinate-submenu [data-submenu-id="sketch"]').first().click();
  await page.waitForTimeout(1800);

  /* READ ONLY - nothing is opened, closed or switched from here. */
  return page.evaluate(() => {
    const dialog = document.querySelector(".drawing-graph-sketch");

    if (!dialog) {
      return { open: false };
    }

    const hook = dialog.__datumSketch;
    const stats = hook && typeof hook.stats === "function" ? hook.stats() : null;

    return {
      open: true,
      hook: typeof hook,
      hasStats: Boolean(stats),
      boundsMode: stats?.boundsMode,
      limits: stats?.limits,
      origin: stats?.origin && {
        x: Math.round(stats.origin.x),
        y: Math.round(stats.origin.y),
      },
      mapping: stats?.mapping && {
        left: stats.mapping.left,
        right: Math.round(stats.mapping.right),
        top: stats.mapping.top,
        bottom: Math.round(stats.mapping.bottom),
      },
      canvas: stats?.canvas,
      axes: dialog.querySelectorAll('[data-graph-part="axis"]').length,
      ticks: dialog.querySelectorAll('[data-label="tick"]').length,
      boundsControls: dialog.querySelectorAll("[data-sketch-bounds-mode]").length,
      modeLabel: dialog.querySelector("[data-sketch-bounds-mode-label]")?.textContent,
    };
  });
}
