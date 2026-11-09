export default async function run(page) {
  await page.waitForSelector(".drawing-category", { timeout: 120000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "MATH / ANALYSIS", exact: true }).click();
  await page.waitForSelector('#drawingToolList [data-tool-id="math-plot"]', { timeout: 30000 });
  await page.locator('#drawingToolList [data-tool-id="math-plot"]').first().click();
  await page.waitForTimeout(500);
  await page.locator('.drawing-coordinate-submenu [data-submenu-id="sketch"]').first().click();
  await page.waitForTimeout(1500);

  return page.evaluate(() => {
    const dialog = document.querySelector(".drawing-graph-sketch");
    const svg = dialog.querySelector("[data-sketch-svg]");

    /* Does the canvas carry a stale size, i.e. did the app's own setup run? */
    const app = dialog.querySelector(".sketch-app");

    return {
      dialogKeys: Object.getOwnPropertyNames(dialog).length,
      dialogOwn: Object.getOwnPropertyNames(dialog),
      appKeys: Object.getOwnPropertyNames(app).filter((k) => k.startsWith("__")),
      svgViewBox: svg.getAttribute("viewBox"),
      canvasCount: dialog.querySelectorAll(".sketch-canvas").length,
      appCount: dialog.querySelectorAll(".sketch-app").length,
      statusText: dialog.querySelector("[data-sketch-status]")?.textContent,
      pointCount: dialog.querySelector("[data-sketch-point-count]")?.textContent,
      boundsNote: dialog.querySelector("[data-sketch-bounds-note]")?.textContent,
    };
  });
}
