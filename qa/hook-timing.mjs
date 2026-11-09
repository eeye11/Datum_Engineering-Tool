export default async function run(page) {
  const errors = [];

  page.on("pageerror", (error) => errors.push("page: " + String(error && (error.stack || error)).slice(0, 900)));
  page.on("console", (message) => {
    if (message.type() === "error" && !/502|tikz/i.test(message.text())) {
      errors.push("console: " + message.text().slice(0, 500));
    }
  });

  await page.waitForSelector(".drawing-category", { timeout: 120000 });

  /* Watch the hook appear, and disappears, as the dialog is built. */
  await page.evaluate(() => {
    window.__watch = [];

    const observer = new MutationObserver(() => {
      const dialog = document.querySelector(".drawing-graph-sketch");

      if (dialog) {
        window.__watch.push({
          at: Math.round(performance.now()),
          hook: typeof dialog.__datumSketch,
          svg: dialog.querySelector("[data-sketch-svg]")?.getAttribute("viewBox") || null,
        });
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  });

  await page.getByRole("button", { name: "MATH / ANALYSIS", exact: true }).click();
  await page.waitForSelector('#drawingToolList [data-tool-id="math-plot"]', { timeout: 30000 });
  await page.locator('#drawingToolList [data-tool-id="math-plot"]').first().click();
  await page.waitForTimeout(400);
  await page.locator('.drawing-coordinate-submenu [data-submenu-id="sketch"]').first().click();
  await page.waitForTimeout(1800);

  return page.evaluate(() => ({
    watch: window.__watch.slice(-8),
  }));
}
