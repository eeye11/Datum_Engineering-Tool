export default async function run(page) {
  const errors = [];

  page.on("pageerror", (error) => errors.push(String(error.stack || error).slice(0, 800)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push("console: " + message.text().slice(0, 400));
  });

  await page.waitForSelector(".drawing-category", { timeout: 120000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "MATH / ANALYSIS", exact: true }).click();
  await page.waitForSelector('#drawingToolList [data-tool-id="math-plot"]', { timeout: 30000 });
  await page.locator('#drawingToolList [data-tool-id="math-plot"]').first().click();
  await page.waitForTimeout(500);
  await page.locator('.drawing-coordinate-submenu [data-submenu-id="sketch"]').first().click();
  await page.waitForTimeout(2000);

  const state = await page.evaluate(() => {
    const dialog = document.querySelector(".drawing-graph-sketch");

    return {
      opened: Boolean(dialog),
      hook: dialog ? typeof dialog.__datumSketch : null,
      childCount: dialog ? dialog.children.length : 0,
      hasApp: Boolean(dialog?.querySelector(".sketch-app")),
      dialogCount: document.querySelectorAll(".drawing-graph-sketch").length,
    };
  });

  return { errors: errors.slice(0, 8), state };
}
