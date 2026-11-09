export default async function run(page) {
  const errors = [];

  page.on("pageerror", (error) =>
    errors.push("pageerror: " + String(error && (error.stack || error)).slice(0, 1000)),
  );
  page.on("console", (message) => {
    if (message.type() === "error" && !/502|tikz/i.test(message.text())) {
      errors.push("console: " + message.text().slice(0, 600));
    }
  });

  await page.waitForSelector(".drawing-category", { timeout: 120000 });

  /* Wrap the dialog constructor so a throw inside openSketchEditor is recorded. */
  await page.evaluate(() => {
    window.__throws = [];

    const create = document.createElement.bind(document);

    document.createElement = function (tag, ...rest) {
      const node = create(tag, ...rest);

      if (tag === "div") {
        /* Record what happened to each div that became the editor. */
        const original = node;
        void original;
      }

      return node;
    };

    window.addEventListener("error", (event) => {
      window.__throws.push("error: " + String(event.message).slice(0, 500));
    });

    window.addEventListener("unhandledrejection", (event) => {
      window.__throws.push("rejection: " + String(event.reason).slice(0, 500));
    });
  });

  await page.getByRole("button", { name: "MATH / ANALYSIS", exact: true }).click();
  await page.waitForSelector('#drawingToolList [data-tool-id="math-plot"]', { timeout: 30000 });
  await page.locator('#drawingToolList [data-tool-id="math-plot"]').first().click();
  await page.waitForTimeout(400);
  await page.locator('.drawing-coordinate-submenu [data-submenu-id="sketch"]').first().click();
  await page.waitForTimeout(1800);

  const throws = await page.evaluate(() => window.__throws);

  return { errors: errors.slice(0, 6), throws: throws.slice(0, 6) };
}
